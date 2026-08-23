-- The app went back to its original name, Fuvarterv, and with it the workspace
-- key the client sends: 'vector:v1' became 'fuvarterv:v1' again
-- (src/data/storage.js STORAGE_KEY and src/supabaseClient.js WORKSPACE_ID).
--
-- This is the mirror image of 0005, and the same two things have to move for an
-- existing install, or the app comes up empty and every save is rejected:
--
--   1. the stored rows, which are still keyed by the old value;
--   2. the RLS policies from 0003/0004/0005, which hard-code the key in their
--      USING / WITH CHECK clauses.
--
-- 0001-0005 are left exactly as they were shipped: they are the history of what
-- was already run against live databases, not a description of today's key. On a
-- fresh database 0005 and 0006 simply cancel out — 0005 moves nothing (there is
-- no data yet) and this file has the last word on the policies. Whatever state
-- your database is in, running the files in order lands on 'fuvarterv:v1'.
--
-- Re-runnable, like the other migrations: the renames only match the old key,
-- and every create policy is preceded by a drop.

-- 1. Move the data. Do this before swapping the policies: the SQL editor runs as
--    postgres and bypasses RLS, so the order does not actually matter here, but
--    it keeps the window where policies and data disagree at zero.
--
--    The 'fuvarterv:v1' guard covers the case where both rows somehow exist (an
--    admin saved after the client was deployed but before this ran): then the
--    new row is the live one and the stale 'vector:v1' row is left in place
--    rather than colliding with the primary key. Delete it by hand once you have
--    confirmed which one you want to keep.
update public.app_state
   set id = 'fuvarterv:v1'
 where id = 'vector:v1'
   and not exists (select 1 from public.app_state where id = 'fuvarterv:v1');

update public.app_state_history
   set workspace_id = 'fuvarterv:v1'
 where workspace_id = 'vector:v1';

-- 2. Re-create the workspace-scoped policies with the restored key. These are
--    still the 0004 versions (admin-gated); the names are unchanged, so the
--    README's diagnostic query keeps working.
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
