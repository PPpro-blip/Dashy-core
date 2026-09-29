import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { WorkspaceShell } from "@/components/WorkspaceShell";

/**
 * DashyCore v7 — shared authenticated app layout.
 *
 * Server half: the session guard (unauthenticated → /login). Everything
 * responsive lives in <WorkspaceShell>. Every authenticated route group
 * uses this one shell, so navigation can never diverge per section.
 */
export async function AppShell({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  return <WorkspaceShell title={title}>{children}</WorkspaceShell>;
}
