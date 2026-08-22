-- The app was renamed to Vector, and with it the workspace key the client
-- sends: 'fuvarterv:v1' became 'vector:v1' (src/data/storage.js STORAGE_KEY and
-- src/supabaseClient.js WORKSPACE_ID).
--
-- Two things have to move for an existing install, or the app comes up empty
-- and every save is rejected:
--
--   1. the stored rows, which are still keyed by the old value;
--   2. the RLS policies from 0003/0004, which hard-code the key in their
--      USING / WITH CHECK clauses.
--
-- A fresh database needs nothing from this file — 0003 and 0004 already create
-- the policies with the new key, and there is no old data to move. Running it
-- anyway is harmless.
--
-- Re-runnable, like the other migrations: the renames only match the old key,
-- and every create policy is preceded by a drop.

-- 1. Move the data. Do this before swapping the policies: the SQL editor runs as
--    postgres and bypasses RLS, so the order does not actually matter here, but
--    it keeps the window where policies and data disagree at zero.
--
--    The 'vector:v1' guard covers the case where both rows somehow exist (an
--    admin saved after the client was deployed but before this ran): then the
--    new row is the live one and the stale 'fuvarterv:v1' row is left in place
--    rather than colliding with the primary key. Delete it by hand once you have
--    confirmed which one you want to keep.
update public.app_state
   set id = 'vector:v1'
 where id = 'fuvarterv:v1'
   and not exists (select 1 from public.app_state where id = 'vector:v1');

update public.app_state_history
   set workspace_id = 'vector:v1'
 where workspace_id = 'fuvarterv:v1';

-- 2. Re-create the workspace-scoped policies with the new key. These are the
--    0004 versions (admin-gated); the names are unchanged, so the README's
--    diagnostic query keeps working.
drop policy if exists "app_state insert" on public.app_state;
create policy "app_state insert" on public.app_state
  for insert to authenticated
  with check (id = 'vector:v1' and public.is_admin());

drop policy if exists "app_state update" on public.app_state;
create policy "app_state update" on public.app_state
  for update to authenticated
  using (id = 'vector:v1' and public.is_admin())
  with check (id = 'vector:v1' and public.is_admin());

drop policy if exists "history insert" on public.app_state_history;
create policy "history insert" on public.app_state_history
  for insert to authenticated
  with check (workspace_id = 'vector:v1' and public.is_admin());

drop policy if exists "history prune" on public.app_state_history;
create policy "history prune" on public.app_state_history
  for delete to authenticated
  using (workspace_id = 'vector:v1' and public.is_admin());
