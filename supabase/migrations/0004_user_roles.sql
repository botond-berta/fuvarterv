-- Two kinds of user: 'admin' (full access — the behaviour every user had until
-- now) and 'sofor' (driver: may read everything, may write nothing). The role
-- lives in a table keyed by E-MAIL ADDRESS, not by user id, so an admin can
-- grant roles from inside the app (Adatok → Felhasználók) without ever opening
-- the Supabase dashboard: the e-mail is verified by Supabase auth and arrives
-- in the JWT, where these policies read it back with auth.jwt()->>'email'.
--
-- A user with NO row here is a driver. That is deliberate (fail-closed): a
-- forgotten account can look at the schedule but cannot touch the data.
--
-- BOOTSTRAP — run once, with your own address, to create the first admin:
--
--   insert into public.user_roles (email, role)
--   values (lower('you@example.com'), 'admin')
--   on conflict (email) do update set role = 'admin';
--
-- The SQL editor runs as postgres and bypasses row level security, so this same
-- line is also the recovery path if the admins ever lock themselves out.
--
-- Re-runnable, like the other migrations: create table/policy guarded by
-- if-not-exists / a preceding drop. Run after 0003 (it recreates the 0003
-- policies under the same names, with the admin condition added).

-- 1. The roles table.
create table if not exists public.user_roles (
  email      text primary key check (email = lower(email)),
  role       text not null check (role in ('admin', 'sofor')),
  created_at timestamptz not null default now()
);

alter table public.user_roles enable row level security;

-- 2. is_admin(): true when the calling JWT's e-mail has an admin row.
--    SECURITY DEFINER so the check runs with the function owner's rights —
--    otherwise the user_roles policies below (which themselves call is_admin)
--    would recurse. search_path is pinned empty, so every name inside must be
--    schema-qualified; that is what makes definer functions safe to expose.
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

-- 3. Policies on user_roles: everyone may read their OWN row (the app needs it
--    to decide which screens to show); admins may read and manage all rows.
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

-- 4. Writes to the workspace and its history become admin-only. Reads stay open
--    to every authenticated user — drivers must see the schedule. The policy
--    names are kept from 0003 so the README's diagnostic query needs no special
--    cases; the drop+create simply swaps in the stricter condition.
drop policy if exists "app_state insert" on public.app_state;
create policy "app_state insert" on public.app_state
  for insert to authenticated
  with check (id = 'fuvarterv:v1' and public.is_admin());

drop policy if exists "app_state update" on public.app_state;
create policy "app_state update" on public.app_state
  for update to authenticated
  using (id = 'fuvarterv:v1' and public.is_admin())
  with check (id = 'fuvarterv:v1' and public.is_admin());

drop policy if exists "history insert" on public.app_state_history;
create policy "history insert" on public.app_state_history
  for insert to authenticated
  with check (workspace_id = 'fuvarterv:v1' and public.is_admin());

drop policy if exists "history prune" on public.app_state_history;
create policy "history prune" on public.app_state_history
  for delete to authenticated
  using (workspace_id = 'fuvarterv:v1' and public.is_admin());
