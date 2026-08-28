"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { LogOutIcon } from "@/components/icons";

interface SignOutButtonProps {
  /** Compact inline style for embedding inside popups / cards. */
  compact?: boolean;
  /** Bare icon button (old peak sidebar profile card). */
  iconOnly?: boolean;
}

export function SignOutButton({
  compact = false,
  iconOnly = false,
}: SignOutButtonProps) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  const handleSignOut = async () => {
    setLoading(true);
    try {
      const supabase = createClient();
      await supabase.auth.signOut();
    } catch {
      // Even if the session call fails, drop the user back to /login.
    }
    router.replace("/login");
    router.refresh();
  };

  if (iconOnly) {
    return (
      <button
        type="button"
        onClick={handleSignOut}
        disabled={loading}
        aria-label="Sign out"
        title="Sign out"
        className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg text-zinc-500 transition-colors hover:bg-white/[0.06] hover:text-red-300 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {loading ? (
          <span
            aria-hidden="true"
            className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-zinc-600 border-t-zinc-300"
          />
        ) : (
          <LogOutIcon className="h-4 w-4" />
        )}
      </button>
    );
  }

  if (compact) {
    return (
      <button
        type="button"
        onClick={handleSignOut}
        disabled={loading}
        className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13px] font-medium text-zinc-300 transition-colors hover:bg-red-500/10 hover:text-red-300 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {loading ? (
          <span
            aria-hidden="true"
            className="h-4 w-4 animate-spin rounded-full border-2 border-zinc-600 border-t-zinc-300"
          />
        ) : (
          <LogOutIcon className="h-4 w-4" />
        )}
        Sign out
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={handleSignOut}
      disabled={loading}
      className="inline-flex items-center gap-2 rounded-xl border border-zinc-700/80 bg-zinc-900 px-5 py-3 text-sm font-medium text-zinc-200 transition-all duration-200 hover:border-red-400/50 hover:text-red-300 hover:shadow-[0_0_20px_rgba(248,113,113,0.1)] disabled:cursor-not-allowed disabled:opacity-60"
    >
      {loading ? (
        <span
          aria-hidden="true"
          className="h-4 w-4 animate-spin rounded-full border-2 border-zinc-600 border-t-zinc-300"
        />
      ) : (
        <LogOutIcon className="h-4 w-4" />
      )}
      Sign out
    </button>
  );
}
