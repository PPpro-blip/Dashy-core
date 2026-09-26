-- =====================================================================
-- DashyCore v7 — Dashy Studio shared assets (public share hub)
--
-- One row per shared Studio image. `slug` powers /s/<slug>; anonymous
-- visitors can read a row only while is_public = true.
-- =====================================================================

create table if not exists public.shared_assets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid null references auth.users (id) on delete cascade,
  slug text not null unique,
  image_url text not null,
  title text not null default 'Dashy Studio image',
  is_public boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists shared_assets_user_created_idx
  on public.shared_assets (user_id, created_at desc);

alter table public.shared_assets enable row level security;

create policy "shared_assets_select_own"
  on public.shared_assets for select
  using (auth.uid() = user_id);

create policy "shared_assets_select_public"
  on public.shared_assets for select
  using (is_public = true);

create policy "shared_assets_insert_own"
  on public.shared_assets for insert
  with check (auth.uid() = user_id);

create policy "shared_assets_update_own"
  on public.shared_assets for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "shared_assets_delete_own"
  on public.shared_assets for delete
  using (auth.uid() = user_id);
