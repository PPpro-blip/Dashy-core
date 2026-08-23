"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

export function SignOutButton() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  const handleSignOut = async () => {
    setLoading(true);
    const supabase = createClient();
    await supabase.auth.signOut();
    router.replace("/login");
    router.refresh();
  };

  return (
    <button
      type="button"
      onClick={handleSignOut}
      disabled={loading}
      className="inline-flex items-center gap-2 rounded-xl border border-neutral-700/80 bg-neutral-900 px-5 py-3 text-sm font-medium text-neutral-200 transition-all duration-200 hover:border-red-400/50 hover:text-red-300 hover:shadow-[0_0_20px_rgba(248,113,113,0.1)] disabled:cursor-not-allowed disabled:opacity-60"
    >
      {loading ? (
        <span
          aria-hidden="true"
          className="h-4 w-4 animate-spin rounded-full border-2 border-neutral-600 border-t-neutral-300"
        />
      ) : (
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="h-4 w-4"
          aria-hidden="true"
        >
          <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9" />
        </svg>
      )}
      Sign out
    </button>
  );
}