-- Restrict public D-Code project data to the server-side share resolver.
-- Public viewers now resolve only valid share slugs through /api/share/[key],
-- which selects a render-only field set and hard-filters is_public = true.
-- Never grant anon direct table access: RLS row policies cannot column-mask
-- owner IDs or other internal project metadata.

alter table public.dcode_projects enable row level security;

drop policy if exists "dcode_projects_select_public" on public.dcode_projects;
revoke all on table public.dcode_projects from anon;
revoke all on table public.dcode_projects from public;

grant select, insert, update, delete on table public.dcode_projects to authenticated;
