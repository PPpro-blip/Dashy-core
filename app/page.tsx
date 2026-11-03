import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

/**
 * Root route — server-side session check.
 * Unauthenticated (or unconfigured Supabase env) → /login · Authenticated → /chat
 */
export default async function HomePage() {
  let user = null;
  try {
    const supabase = await createClient();
    const {
      data: { user: authUser },
    } = await supabase.auth.getUser();
    user = authUser;
  } catch {
    // Missing/invalid Supabase env or session-read failure: treat as signed
    // out. The login screen shows a clear configuration error on submit.
    user = null;
  }

  if (!user) {
    redirect("/login");
  }

  redirect("/chat");
}
