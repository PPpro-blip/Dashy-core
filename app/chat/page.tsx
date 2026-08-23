import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { SignOutButton } from "@/components/SignOutButton";

/**
 * Temporary chat placeholder — Phase 1 skeleton.
 * The full Chat UI arrives in a later phase.
 */
export default async function ChatPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  return (
    <main className="relative flex min-h-screen flex-col items-center justify-center bg-neutral-950 px-6">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -top-40 left-1/2 h-[420px] w-[640px] -translate-x-1/2 rounded-full bg-cyan-500/[0.06] blur-[120px]"
      />

      <section className="relative z-10 w-full max-w-md text-center">
        <div className="mb-8 flex items-center justify-center gap-3 font-mono text-[11px] tracking-[0.25em] text-neutral-500 uppercase">
          <span className="text-cyan-400">01</span>
          <span className="h-px w-16 bg-neutral-800" />
          <span>Chat · Placeholder</span>
        </div>

        <h1 className="text-3xl font-semibold tracking-tight text-neutral-50">
          Chat UI coming soon.
        </h1>
        <p className="mt-4 text-sm leading-relaxed text-neutral-400">
          You're signed in as{" "}
          <span className="font-medium text-neutral-200">
            {user.email ?? "unknown"}
          </span>
          . The full DashyCore conversation interface is being built in the
          next phase.
        </p>

        <div className="mt-10">
          <SignOutButton />
        </div>
      </section>
    </main>
  );
}