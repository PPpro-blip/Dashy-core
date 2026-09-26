-- =====================================================================
-- DashyCore v7 — Dashy Studio Share Hub (public, slug-addressable assets)
--
-- One row per shared Studio image. `slug` is the public token used at
-- /s/<slug> — anyone (including anonymous visitors) can read a row while
-- is_public = true, matching the d-code share pattern
-- (supabase/migrations/20260829100000_create_dcode_projects.sql).
--
-- Studio itself keeps the *gallery* of generated images in the browser
-- (localStorage `dashy.media.library`) — this table only stores the
-- lightweight metadata needed to power a public share link + OpenGraph
-- preview card.
-- =====================================================================

create table if not exists public.shared_assets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid null references auth.users (id) on delete cascade,
  slug text unique not null,
  title text not null default 'A Dashy Studio creation',
  image_url text not null,
  is_public boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Owner's Studio / Analytics list query.
create index if not exists shared_assets_user_updated_idx
  on public.shared_assets (user_id, updated_at desc);

-- Public share-link lookup: exact slug fetch by anonymous visitors.
create index if not exists shared_assets_slug_idx
  on public.shared_assets (slug);

-- ---------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------

alter table public.shared_assets enable row level security;

-- Owner: full CRUD on their own shared assets.
create policy "shared_assets_select_own"
  on public.shared_assets for select
  using (auth.uid() = user_id);

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

-- Public: read-only access to assets explicitly marked is_public.
-- This is what powers /s/<slug> for signed-out visitors.
create policy "shared_assets_select_public"
  on public.shared_assets for select
  using (is_public = true);
