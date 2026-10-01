-- =====================================================================
-- DashyCore — fix public share reads on `dcode_projects`.
--
-- Bug: the base migration created RLS policies but never GRANTed the
-- table to the `anon` / `authenticated` roles. In Supabase, RLS policies
-- alone are NOT enough — without an explicit GRANT, anonymous visitors
-- get zero rows even when `is_public = true`, so /d-code/share/<slug>
-- shows "private or no longer exists" in incognito windows.
--
-- Fix: grant SELECT to anon (public reads only — the
-- `dcode_projects_select_public` policy still restricts rows to
-- is_public = true), full CRUD to authenticated (still owner-scoped by
-- the *_own policies), and re-create the public policy idempotently.
-- =====================================================================

-- Belt-and-braces: RLS must stay on for the policies below to apply.
alter table public.dcode_projects enable row level security;

-- Role grants (the actual missing piece).
grant select on public.dcode_projects to anon;
grant select, insert, update, delete on public.dcode_projects to authenticated;

-- Public read access for explicitly shared projects (idempotent).
drop policy if exists "dcode_projects_select_public" on public.dcode_projects;
create policy "dcode_projects_select_public"
  on public.dcode_projects for select
  using (is_public = true);
