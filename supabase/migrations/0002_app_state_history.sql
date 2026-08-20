-- Snapshot history for the single app_state blob. On every successful save the
-- client writes the *previous* blob here (keeping the last 20 per workspace),
-- so a bad overwrite can be rolled back. Same authenticated-only access model
-- as app_state; there is no per-user data.

create table if not exists public.app_state_history (
  id           bigint generated always as identity primary key,
  workspace_id text        not null,
  data         jsonb       not null,
  saved_at     timestamptz not null default now()
);

-- Newest-first lookups per workspace (list + prune both use this order).
create index if not exists app_state_history_ws_saved_idx
  on public.app_state_history (workspace_id, saved_at desc);

alter table public.app_state_history enable row level security;

-- Every create policy is preceded by a drop, so this file can be re-run safely.
-- (create policy has no IF NOT EXISTS; without the drop a re-run fails with 42710
-- and, since the SQL editor is not one transaction, can stop half-way.)
drop policy if exists "authenticated read history"  on public.app_state_history;
drop policy if exists "authenticated write history" on public.app_state_history;

create policy "authenticated read history" on public.app_state_history
  for select to authenticated using (true);
create policy "authenticated write history" on public.app_state_history
  for all    to authenticated using (true) with check (true);
