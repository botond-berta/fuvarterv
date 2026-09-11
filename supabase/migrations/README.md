# Database setup

One file, `0001_initial_schema.sql`. Paste it into the Supabase **SQL editor** and
run it. That is the entire server side of Fuvarterv.

It is **re-runnable**: tables, indexes and triggers are guarded, and every
`create policy` is preceded by a `drop policy if exists`, so running it again after a
partial failure is safe.

## Two steps you must not skip

**1. Turn off public sign-ups.** Authentication → Providers → Email → uncheck
**Enable sign-ups**. Every policy grants access to any *authenticated* user, and the
anon key ships in the public JS bundle. While sign-ups are open, anyone who reads
that key out of the bundle can register and then read, overwrite and delete
everything. Create staff logins by hand under Authentication → Users → Add user.

**2. Create the first admin.** Writes are admin-only and a user with no `user_roles`
row is a driver, read-only — including you, until you run this once with your own
address:

```sql
insert into public.user_roles (email, role)
values (lower('you@example.com'), 'admin')
on conflict (email) do update set role = 'admin';
```

From then on roles are managed inside the app (Adatok → Felhasználók). The SQL editor
runs as `postgres` and bypasses row level security, so this same statement is also the
recovery path if the admins ever lock themselves out. A role change takes effect the
next time that user logs in or reloads.

## What the end state looks like

| Object | Kind | Purpose |
|---|---|---|
| `app_state` | table | One row holding the whole application state as `jsonb`. |
| `app_state_history` | table | The previous blob on every save, newest 20 kept per workspace. |
| `user_roles` | table | E-mail → `admin` or `sofor`. No row means driver. |
| `workspace_id()` | function | The workspace key, in one place instead of every policy. |
| `is_admin()` | function | True when the caller's JWT e-mail has an admin row. `security definer`, so the roles policies cannot recurse. |
| `app_state_touch` | trigger | Sets `updated_at := now()` on update, so the concurrency timestamp comes from the server rather than the browser clock. |

Reads are open to every authenticated user, because drivers must see the schedule.
Writes are admin-only and scoped to the one workspace row.

Two omissions are deliberate. There is **no delete policy on `app_state`**: nothing in
the app deletes the workspace row, and losing it would drop the entire dataset in one
request. There is **no update policy on `app_state_history`**: an audit trail every
client can rewrite is not an audit trail. Delete exists there only because the client
prunes to the newest 20.

These map exactly onto `src/supabaseStorage.js`: `get` → select, `set` → insert or
guarded update on that one id, history write → insert, pruning → delete. The
`delete(key)` method on the storage contract is never called by the app, which is why
no policy grants it.

## Checking what is applied

Read-only, and safe on an empty database. It deliberately avoids `::regclass`, which
throws when a table is missing.

```sql
with expected(kind, name) as (
  values ('table'::text,  'app_state'::text),
         ('table',        'app_state_history'),
         ('table',        'user_roles'),
         ('function',     'workspace_id'),
         ('function',     'is_admin'),
         ('trigger',      'app_state_touch'),
         ('policy',       'app_state select'),
         ('policy',       'app_state insert'),
         ('policy',       'app_state update'),
         ('policy',       'history select'),
         ('policy',       'history insert'),
         ('policy',       'history prune'),
         ('policy',       'roles select'),
         ('policy',       'roles insert'),
         ('policy',       'roles update'),
         ('policy',       'roles delete')
),
present as (
  select 'table'::text as kind, tablename::text as name
    from pg_tables
   where schemaname = 'public'
     and tablename in ('app_state', 'app_state_history', 'user_roles')
  union all
  select 'policy', policyname::text
    from pg_policies
   where schemaname = 'public'
     and tablename in ('app_state', 'app_state_history', 'user_roles')
  union all
  select 'function', p.proname::text
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname in ('is_admin', 'workspace_id')
  union all
  select 'trigger', t.tgname::text
    from pg_trigger t
    join pg_class c     on c.oid = t.tgrelid
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relname = 'app_state' and not t.tgisinternal
)
select e.kind, e.name,
       case when p.name is null then 'MISSING' else 'OK' end as status
  from expected e left join present p on p.kind = e.kind and p.name = e.name
 order by 1, 2;
```

All sixteen rows should read `OK`.

## Changing the workspace key

The key lives in two places that must agree: `workspace_id()` in the schema file, and
`STORAGE_KEY` in `src/data/storage.js`. If they disagree the app loads an empty
workspace and every save is rejected by row level security.

To rename it, change both, then move the existing rows:

```sql
update public.app_state         set id           = 'new-key' where id           = 'old-key';
update public.app_state_history set workspace_id = 'new-key' where workspace_id = 'old-key';
```
