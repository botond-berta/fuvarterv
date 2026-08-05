-- Fuvarterv persistence: one shared-workspace row holding the whole app state.
-- Run this in the Supabase SQL editor (or via the Supabase CLI).

create table if not exists public.app_state (
  id         text primary key,          -- workspace key, e.g. 'fuvarterv:v1'
  data       jsonb not null,
  updated_at timestamptz not null default now()
);

alter table public.app_state enable row level security;

-- Shared workspace: any authenticated user can read/write the row.
-- (The browser anon key is public by design; RLS is what protects the data,
--  so only logged-in users can touch it.)
drop policy if exists "authenticated read"  on public.app_state;
drop policy if exists "authenticated write" on public.app_state;

create policy "authenticated read" on public.app_state
  for select to authenticated using (true);

create policy "authenticated write" on public.app_state
  for all to authenticated using (true) with check (true);
