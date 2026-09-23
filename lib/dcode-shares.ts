import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import {
  rowToProject,
  type DCodeProject,
  type DCodeProjectRow,
} from "@/lib/dcode";

/**
 * The server-side read for share pages and metadata. Supabase RLS admits only
 * public rows or the owner's own row; the explicit owner check also makes the
 * intended private-link contract clear. Never use a service-role key here.
 * React cache deduplicates the page and generateMetadata lookups per request.
 */
export const getSharedDCodeProject = cache(
  async (
    slug: string,
  ): Promise<{ project: DCodeProject; isOwner: boolean } | null> => {
    if (!/^[a-z0-9]{12}$/.test(slug)) return null;

    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    const { data, error } = await supabase
      .from("dcode_projects")
      .select("*")
      .eq("share_slug", slug)
      .maybeSingle();
    if (error) throw error;
    if (!data) return null;

    const row = data as DCodeProjectRow;
    const isOwner = row.user_id === user?.id;
    if (!row.is_public && !isOwner) return null;
    return { project: rowToProject(row), isOwner };
  },
);
