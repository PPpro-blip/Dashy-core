import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

/**
 * Root route — server-side session check.
 * Unauthenticated → /login · Authenticated → /chat
 */
export default async function HomePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  redirect("/chat");
}