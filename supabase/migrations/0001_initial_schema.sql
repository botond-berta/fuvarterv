-- Fuvarterv — complete database schema.
--
-- Run this once in the Supabase SQL editor (or via the Supabase CLI) on a fresh
-- project. It is the whole server side of the application: three tables, one
-- helper function, one trigger, and the row level security policies that are the
-- real access boundary.
--
-- Re-runnable. Every table uses "if not exists" and every policy is preceded by a
-- drop, because "create policy" has no IF NOT EXISTS: without the drop a re-run
-- fails with 42710 and, since the SQL editor is not one transaction, can stop
-- half-way.
--
-- BEFORE YOU RELY ON THIS, close the open door:
--
--   Authentication -> Providers -> Email -> turn OFF "Enable sign-ups"
--
-- The whole model is "you are an authenticated user", and the browser anon key is
-- public by design, so it only holds if nobody can hand themselves an account.
-- Supabase enables the /auth/v1/signup endpoint by default. Create staff logins by
-- hand under Authentication -> Users -> Add user.


-- ---------------------------------------------------------------------------
-- 0. The workspace key.
-- ---------------------------------------------------------------------------
-- The client stores the entire application state under one key, which must match
-- STORAGE_KEY in src/data/storage.js. It appears in several policies below, so it
-- lives in a function rather than being repeated as a literal: renaming the
-- workspace is then one edit here plus one in the client, not a hunt through
-- every USING and WITH CHECK clause.

create or replace function public.workspace_id()
returns text language sql immutable as $$
  select 'fuvarterv:v1'::text;
$$;

grant execute on function public.workspace_id() to authenticated;


-- ---------------------------------------------------------------------------
-- 1. app_state — the whole application state as a single JSON blob.
-- ---------------------------------------------------------------------------
create table if not exists public.app_state (
  id         text primary key,          -- workspace key, see workspace_id()
  data       jsonb not null,
  updated_at timestamptz not null default now()
);

alter table public.app_state enable row level security;

-- updated_at must come from the server, not the browser clock, so it stays a
-- trustworthy "last modified" and cannot be spoofed. The client still sends an
-- updated_at on every write and the optimistic-concurrency guard compares against
-- the value it last read; where this trigger exists it simply wins.
create or replace function public.app_state_touch()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists app_state_touch on public.app_state;
create trigger app_state_touch
  before update on public.app_state
  for each row execute function public.app_state_touch();


-- ---------------------------------------------------------------------------
-- 2. app_state_history — rollback snapshots.
-- ---------------------------------------------------------------------------
-- On every successful save the client writes the *previous* blob here and prunes
-- to the newest 20 per workspace, so a bad overwrite can be rolled back from
-- inside the app. There is no per-user data.

create table if not exists public.app_state_history (
  id           bigint generated always as identity primary key,
  workspace_id text        not null,
  data         jsonb       not null,
  saved_at     timestamptz not null default now()
);

-- Newest-first lookups per workspace; the restore list and the prune both use
-- exactly this order.
create index if not exists app_state_history_ws_saved_idx
  on public.app_state_history (workspace_id, saved_at desc);

alter table public.app_state_history enable row level security;


-- ---------------------------------------------------------------------------
-- 3. user_roles — who may write.
-- ---------------------------------------------------------------------------
-- Two kinds of user: 'admin' (full access) and 'sofor' (driver: may read
-- everything, may write nothing). The role is keyed by E-MAIL ADDRESS, not by
-- user id, so an admin can grant roles from inside the app (Adatok -> Felhasznalok)
-- without ever opening the Supabase dashboard: the e-mail is verified by Supabase
-- auth and arrives in the JWT, where these policies read it back.
--
-- A user with NO row here is a driver. That is deliberate and fail-closed: a
-- forgotten account can look at the schedule but cannot touch the data.
--
-- The role value 'sofor' is Hungarian ("driver") because it is also a stored data
-- value: it lives in this table, in the JWT-driven policies below, and in the
-- client's role check. Renaming it would be a data migration, not a translation.

create table if not exists public.user_roles (
  email      text primary key check (email = lower(email)),
  role       text not null check (role in ('admin', 'sofor')),
  created_at timestamptz not null default now()
);

alter table public.user_roles enable row level security;

-- is_admin(): true when the calling JWT's e-mail has an admin row.
-- SECURITY DEFINER so the check runs with the function owner's rights, otherwise
-- the user_roles policies below (which themselves call is_admin) would recurse.
-- search_path is pinned empty, so every name inside must be schema-qualified;
-- that is what makes a definer function safe to expose.
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.user_roles
    where email = lower(coalesce(auth.jwt() ->> 'email', ''))
      and role = 'admin'
  );
$$;

grant execute on function public.is_admin() to authenticated;


-- ---------------------------------------------------------------------------
-- 4. Policies.
-- ---------------------------------------------------------------------------
-- Reads are open to every authenticated user: drivers must see the schedule.
-- Writes are admin-only, and scoped to the one workspace row so the tables cannot
-- be used as scratch space for arbitrary keys.

-- 4a. app_state. Deliberately no delete policy: nothing in the app deletes the
--     workspace row, and losing it would drop the whole dataset in one request.
drop policy if exists "app_state select" on public.app_state;
create policy "app_state select" on public.app_state
  for select to authenticated using (true);

drop policy if exists "app_state insert" on public.app_state;
create policy "app_state insert" on public.app_state
  for insert to authenticated
  with check (id = public.workspace_id() and public.is_admin());

drop policy if exists "app_state update" on public.app_state;
create policy "app_state update" on public.app_state
  for update to authenticated
  using (id = public.workspace_id() and public.is_admin())
  with check (id = public.workspace_id() and public.is_admin());

-- 4b. app_state_history. An audit trail every client can rewrite is not an audit
--     trail, so there is no update policy. Delete exists only because the client
--     prunes to the newest 20, and it is scoped to the workspace.
drop policy if exists "history select" on public.app_state_history;
create policy "history select" on public.app_state_history
  for select to authenticated using (true);

drop policy if exists "history insert" on public.app_state_history;
create policy "history insert" on public.app_state_history
  for insert to authenticated
  with check (workspace_id = public.workspace_id() and public.is_admin());

drop policy if exists "history prune" on public.app_state_history;
create policy "history prune" on public.app_state_history
  for delete to authenticated
  using (workspace_id = public.workspace_id() and public.is_admin());

-- 4c. user_roles. Everyone may read their OWN row (the app needs it to decide
--     which screens to show); admins may read and manage every row.
drop policy if exists "roles select" on public.user_roles;
create policy "roles select" on public.user_roles
  for select to authenticated
  using (email = lower(coalesce(auth.jwt() ->> 'email', '')) or public.is_admin());

drop policy if exists "roles insert" on public.user_roles;
create policy "roles insert" on public.user_roles
  for insert to authenticated with check (public.is_admin());

drop policy if exists "roles update" on public.user_roles;
create policy "roles update" on public.user_roles
  for update to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists "roles delete" on public.user_roles;
create policy "roles delete" on public.user_roles
  for delete to authenticated using (public.is_admin());


-- ---------------------------------------------------------------------------
-- 5. Bootstrap — run once, with your own address, to create the first admin.
-- ---------------------------------------------------------------------------
-- Until a row exists here, nobody can write anything: every account is a driver.
-- The SQL editor runs as postgres and bypasses row level security, so this same
-- statement is also the recovery path if the admins ever lock themselves out.
--
--   insert into public.user_roles (email, role)
--   values (lower('you@example.com'), 'admin')
--   on conflict (email) do update set role = 'admin';
