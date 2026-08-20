-- Tightens the access rules created by 0001 and 0002.
--
-- IMPORTANT — this migration is only half of the story. The whole security model
-- is "you are an authenticated user", and the browser anon key is public by
-- design, so it only holds if nobody can hand themselves an account. Supabase
-- enables the /auth/v1/signup endpoint by default. Before relying on this:
--
--   Authentication -> Providers -> Email -> turn OFF "Enable sign-ups"
--
-- and create staff logins by hand under Authentication -> Users -> Add user.
-- Without that step anyone who reads the anon key out of the JS bundle can
-- register and then read, overwrite and delete everything below.

-- Re-runnable: every create policy is preceded by a drop. Run the migrations in
-- order — 0003 references public.app_state_history, which 0002 creates, and
-- "drop policy if exists" still requires the table to exist.
--
-- 1. app_state: keep read/insert/update for authenticated users, but stop the
--    table being used as scratch space for arbitrary keys, and stop deletes.
--    The app only ever touches the one workspace row.
drop policy if exists "authenticated read"  on public.app_state;
drop policy if exists "authenticated write" on public.app_state;

drop policy if exists "app_state select" on public.app_state;
create policy "app_state select" on public.app_state
  for select to authenticated using (true);

drop policy if exists "app_state insert" on public.app_state;
create policy "app_state insert" on public.app_state
  for insert to authenticated with check (id = 'fuvarterv:v1');

drop policy if exists "app_state update" on public.app_state;
create policy "app_state update" on public.app_state
  for update to authenticated using (id = 'fuvarterv:v1') with check (id = 'fuvarterv:v1');

-- Deliberately no delete policy: nothing in the app deletes the workspace row,
-- and losing it would drop the whole dataset in one request.

-- 2. app_state_history: an audit trail that every client can rewrite is not an
--    audit trail. Insert and select only.
drop policy if exists "authenticated read history"  on public.app_state_history;
drop policy if exists "authenticated write history" on public.app_state_history;

drop policy if exists "history select" on public.app_state_history;
create policy "history select" on public.app_state_history
  for select to authenticated using (true);

drop policy if exists "history insert" on public.app_state_history;
create policy "history insert" on public.app_state_history
  for insert to authenticated with check (workspace_id = 'fuvarterv:v1');

-- The client prunes to the last 20 snapshots, which needs delete. Restrict it to
-- the workspace so a client cannot clear another key's history.
drop policy if exists "history prune" on public.app_state_history;
create policy "history prune" on public.app_state_history
  for delete to authenticated using (workspace_id = 'fuvarterv:v1');

-- 3. updated_at must come from the server, not the browser clock, so it stays a
--    trustworthy "last modified" (and cannot be spoofed by a client).
--    The client still sends an updated_at on every write; that is deliberate, so
--    the optimistic-concurrency guard keeps working on installs that have not run
--    this migration. Where the trigger exists it simply wins.
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
