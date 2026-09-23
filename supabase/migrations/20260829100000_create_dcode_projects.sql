-- =====================================================================
-- DashyCore v7 — D-Code projects (Monaco multi-file IDE, shareable)
--
-- One row per D-Code project. Files live in a jsonb array so a whole
-- project loads in a single round-trip:
--   [{ id, name, language, content }, ...]
--
-- Sharing: `share_slug` is written when the owner makes a project
-- public (unique, 12-char url-safe token). Public read access is
-- granted by RLS only when is_public = true, so anonymous visitors
-- can open /d-code/share/<share_slug> but see nothing else.
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

-- Projects grid query: own projects, most recently touched first.
create index if not exists dcode_projects_user_updated_idx
  on public.dcode_projects (user_id, updated_at desc);

-- Share-link lookup: exact slug fetch by anonymous visitors.
-- (A unique index on share_slug is created by the column constraint;
-- this extra index is unnecessary, kept implicit.)

-- ---------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------

alter table public.dcode_projects enable row level security;

-- Owner: full CRUD on their own projects.
create policy "dcode_projects_select_own"
  on public.dcode_projects for select
  using (auth.uid() = user_id);

create policy "dcode_projects_insert_own"
  on public.dcode_projects for insert
  with check (auth.uid() = user_id);

create policy "dcode_projects_update_own"
  on public.dcode_projects for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "dcode_projects_delete_own"
  on public.dcode_projects for delete
  using (auth.uid() = user_id);

-- Public: read-only access to projects explicitly marked is_public.
-- This is what powers /d-code/share/<share_slug> for signed-out visitors.
create policy "dcode_projects_select_public"
  on public.dcode_projects for select
  using (is_public = true);
