# Database migrations

Run these in the Supabase **SQL editor**, in numerical order. All three are
**re-runnable** — every `create policy` is preceded by a `drop policy if exists`, and
tables, indexes and triggers are guarded — so if you are unsure what has already been
applied, running them all in order is safe.

| File | What it does |
|---|---|
| `0001_app_state.sql` | The `app_state` table (one shared workspace row) + RLS. |
| `0002_app_state_history.sql` | `app_state_history` — the snapshot list behind the **Korábbi mentések** panel. |
| `0003_tighten_rls.sql` | Scopes writes to the workspace row, makes history append-only, moves `updated_at` onto the server clock. |

**Order matters.** `0003` references `public.app_state_history`, which `0002` creates.
`drop policy if exists` tolerates a missing *policy*, but not a missing *table*, so
running `0003` before `0002` fails with `relation "public.app_state_history" does not
exist`.

> **`0003` is only half of the security model.** The other half is a console setting:
> **Authentication → Providers → Email → turn off "Enable sign-ups"**. Every policy
> grants access to any *authenticated* user, and the anon key ships in the public JS
> bundle — so while sign-ups are open, anyone can register and read, overwrite and
> delete everything.

## Which migrations have been applied?

This query is **read-only** and safe to run at any time, including on an empty database
(it deliberately avoids `::regclass`, which throws when a table is missing). It lists
the objects that *should* exist and tells you which migration is still outstanding.

```sql
with expected(step, kind, name) as (
  values ('0001'::text, 'table'::text,  'app_state'::text),
         ('0002',       'table',        'app_state_history'),
         ('0003',       'policy',       'app_state select'),
         ('0003',       'policy',       'app_state insert'),
         ('0003',       'policy',       'app_state update'),
         ('0003',       'policy',       'history select'),
         ('0003',       'policy',       'history insert'),
         ('0003',       'policy',       'history prune'),
         ('0003',       'trigger',      'app_state_touch')
),
superseded(kind, name) as (
  values ('policy'::text, 'authenticated read'::text),
         ('policy',       'authenticated write'),
         ('policy',       'authenticated read history'),
         ('policy',       'authenticated write history')
),
present as (
  select 'table'::text as kind, tablename::text as name
    from pg_tables
   where schemaname = 'public' and tablename in ('app_state', 'app_state_history')
  union all
  select 'policy', policyname::text
    from pg_policies
   where schemaname = 'public' and tablename in ('app_state', 'app_state_history')
  union all
  select 'trigger', t.tgname::text
    from pg_trigger t
    join pg_class c     on c.oid = t.tgrelid
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relname = 'app_state' and not t.tgisinternal
)
select e.step, e.kind, e.name,
       case when p.name is null
            then 'MISSING -- run migration ' || e.step
            else 'OK' end as status
  from expected e left join present p on p.kind = e.kind and p.name = e.name
union all
select '0003', s.kind, s.name,
       case when p.name is null
            then 'not present (fine)'
            else 'STALE -- migration 0003 will remove it' end
  from superseded s left join present p on p.kind = s.kind and p.name = s.name
order by 1, 2, 3;
```

When everything is applied, the nine `expected` rows all read `OK` and the four
`superseded` rows all read `not present (fine)`.

## What the end state should look like

- **Tables:** `app_state`, `app_state_history`, both with RLS enabled.
- **Policies on `app_state`:** `app_state select` (read all), `app_state insert` and
  `app_state update` (both scoped to `id = 'fuvarterv:v1'`). Deliberately **no delete
  policy** — nothing in the app deletes the workspace row, and losing it would drop the
  entire dataset in one request.
- **Policies on `app_state_history`:** `history select`, `history insert`, and
  `history prune` (delete, scoped to the workspace). Append-only apart from the client's
  20-snapshot pruning; an audit trail every client can rewrite is not an audit trail.
- **Trigger:** `app_state_touch` sets `updated_at := now()` on update, so the optimistic
  concurrency timestamp comes from the server rather than the browser clock.

These map exactly onto what `src/supabaseStorage.js` does: `get` → select, `set` →
insert or guarded update on that one id, history write → insert, pruning → delete. The
`delete(key)` method on the storage contract is never called by the app, which is why no
policy grants it.
