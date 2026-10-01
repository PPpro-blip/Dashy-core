-- =====================================================================
-- DashyCore — public Studio image shares
--
-- Studio keeps a private browser library in localStorage. This table stores
-- only items a signed-in owner explicitly makes public, so /s/<slug> works
-- in another browser (including an anonymous/incognito session).
-- =====================================================================

create table if not exists public.shared_assets (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  -- Browser-local Studio asset id. It is scoped by owner and lets a re-share
  -- update the original record rather than minting a misleading new URL.
  source_asset_id text not null,
  slug text not null unique,
  title text not null default 'Untitled Studio image',
  prompt text not null default '',
  image_url text not null,
  is_public boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_id, source_asset_id)
);

create index if not exists shared_assets_owner_created_idx
  on public.shared_assets (owner_id, created_at desc);

-- The unique constraint on slug creates its lookup index. The partial index
-- still accelerates owner analytics queries for records that are public.
create index if not exists shared_assets_owner_public_created_idx
  on public.shared_assets (owner_id, created_at desc)
  where is_public = true;

alter table public.shared_assets enable row level security;

-- Policies use guarded creation so the migration stays safe to apply in a
-- database where an earlier preview may already have created the table.
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'shared_assets'
      and policyname = 'shared_assets_select_own'
  ) then
    create policy "shared_assets_select_own"
      on public.shared_assets for select
      using (auth.uid() = owner_id);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'shared_assets'
      and policyname = 'shared_assets_insert_own'
  ) then
    create policy "shared_assets_insert_own"
      on public.shared_assets for insert
      with check (auth.uid() = owner_id);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'shared_assets'
      and policyname = 'shared_assets_update_own'
  ) then
    create policy "shared_assets_update_own"
      on public.shared_assets for update
      using (auth.uid() = owner_id)
      with check (auth.uid() = owner_id);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'shared_assets'
      and policyname = 'shared_assets_delete_own'
  ) then
    create policy "shared_assets_delete_own"
      on public.shared_assets for delete
      using (auth.uid() = owner_id);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'shared_assets'
      and policyname = 'shared_assets_select_public'
  ) then
    create policy "shared_assets_select_public"
      on public.shared_assets for select
      using (is_public = true);
  end if;
end $$;
