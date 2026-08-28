import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { Sidebar } from "@/components/Sidebar";
import { Header } from "@/components/Header";

export default async function ChatLayout({
  children,
}: {
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
        <Header sessionTitle="New Chat" />
        <main className="flex-1 overflow-auto">{children}</main>
      </div>
    </div>
  );
}
