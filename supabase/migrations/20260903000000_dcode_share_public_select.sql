-- =====================================================================
-- DashyCore v7 — Share Hub hardening (ONE additive policy, idempotent)
--
-- The public Share viewer (/d-code/share/<share_slug>) needs a SELECT
-- policy that lets ANONYMOUS visitors read rows explicitly marked
-- is_public = true. The owning user already has full CRUD via the
-- auth.uid() = user_id policies (created in 20260829100000), so private
-- rows stay invisible to everyone but their owner.
--
-- This migration is safe to run on any state:
--   * creates public.dcode_projects if the table was never created;
--   * enables RLS (never disables it);
--   * creates each policy only when it is missing (no drops, no
--     redefinitions — existing policies are left exactly as they are).
--
-- If the Supabase CLI is not used, run this file as-is in the Supabase
-- SQL editor.
-- =====================================================================

create table if not exists public.dcode_projects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  title text not null default 'Untitled project',
  description text null,
  language text not null default 'typescript',
  files jsonb not null default '[]'::jsonb,
  is_public boolean not null default false,
  share_slug text unique null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.dcode_projects enable row level security;

-- Owner: full CRUD on their own projects (created only if absent — e.g. a
-- hand-made table that predates 20260829100000).
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'dcode_projects'
      and policyname = 'dcode_projects_select_own'
  ) then
    create policy "dcode_projects_select_own"
      on public.dcode_projects for select
      using (auth.uid() = user_id);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'dcode_projects'
      and policyname = 'dcode_projects_update_own'
  ) then
    create policy "dcode_projects_update_own"
      on public.dcode_projects for update
      using (auth.uid() = user_id)
      with check (auth.uid() = user_id);
  end if;

  -- Public: anonymous read of rows the owner explicitly published. This is
  -- what makes /d-code/share/<share_slug> open in an incognito window.
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'dcode_projects'
      and policyname = 'dcode_projects_select_public'
  ) then
    create policy "dcode_projects_select_public"
      on public.dcode_projects for select
      using (is_public = true);
  end if;
end
$$;
