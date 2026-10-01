-- =====================================================================
-- DashyCore v7 — D-Code Source Control: GitHub repo bind
--
-- ONE additive migration, strictly nullable columns on dcode_projects.
-- No RLS change: rows stay user-owned exactly as before (owner CRUD +
-- public read via is_public). The GitHub provider token is NEVER stored
-- here — it is read from the Supabase session (provider_token) at
-- request time and only ever used server-side by app/api/github/[...].
--
-- Run this in the Supabase SQL editor if the CLI is not used.
-- =====================================================================

alter table public.dcode_projects
  add column if not exists github_repo_full_name text null,
  add column if not exists github_default_branch text null default 'main',
  add column if not exists github_last_synced_sha text null;

comment on column public.dcode_projects.github_repo_full_name is
  'Bound GitHub repository "owner/name" for the Source Control panel (null = not bound).';
comment on column public.dcode_projects.github_default_branch is
  'Branch the project is bound to (e.g. main).';
comment on column public.dcode_projects.github_last_synced_sha is
  'Commit SHA of the last Pull/Load from GitHub — the change-model baseline.';
