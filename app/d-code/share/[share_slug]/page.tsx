import { notFound, redirect } from "next/navigation";
import { getSharedDCodeProject } from "@/lib/dcode-shares";

type LegacyShareProps = { params: Promise<{ share_slug: string }> };

/** Preserve previously copied D-Code links; new links use /s/<slug>. */
export default async function LegacyDCodeSharePage({
  params,
}: LegacyShareProps) {
  const { share_slug } = await params;
  // Middleware returns 403 for non-owners when private. RLS keeps this
  // redirect from being a route around that check.
  if (!(await getSharedDCodeProject(share_slug))) notFound();
  redirect(`/s/${share_slug}`);
}
