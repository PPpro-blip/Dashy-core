import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { Sidebar } from "@/components/Sidebar";
import { Header } from "@/components/Header";

/**
 * DashyCore v7 — shared authenticated app layout.
 *
 * Server-side session guard (unauthenticated → /login) + sidebar + header,
 * identical to the chat and settings layouts. Route layouts stay thin.
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

  return (
    <div className="flex min-h-screen bg-navy">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <Header sessionTitle={title} />
        <main className="flex-1 overflow-auto">{children}</main>
      </div>
    </div>
  );
}
