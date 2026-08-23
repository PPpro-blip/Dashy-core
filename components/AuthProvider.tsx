"use client";

import { usePathname, useRouter } from "next/navigation";
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  applyAccent,
  getSettings,
  getUser,
  isAuthenticated,
  signOut as clearAuth,
  type DashyUser,
} from "@/lib/ui/auth";

interface AuthContextValue {
  /** null = still resolving (avoid redirect flash). */
  authed: boolean | null;
  user: DashyUser | null;
  signOut: () => void;
}

const AuthContext = createContext<AuthContextValue>({
  authed: null,
  user: null,
  signOut: () => {},
});

export function useAuth(): AuthContextValue {
  return useContext(AuthContext);
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [user, setUser] = useState<DashyUser | null>(null);
  const router = useRouter();
  const pathname = usePathname();
  const isLoginPage = pathname === "/login";

  // Resolve the fake auth session on client mount.
  useEffect(() => {
    const authedNow = isAuthenticated();
    setAuthed(authedNow);
    setUser(authedNow ? getUser() : null);
    // Apply persisted accent theme.
    applyAccent(getSettings());
  }, []);

  // Auth guard: redirect unauthenticated users to /login (and back out of it).
  useEffect(() => {
    if (authed === null) return;
    if (!authed && !isLoginPage) {
      router.replace("/login");
    } else if (authed && isLoginPage) {
      router.replace("/");
    }
  }, [authed, isLoginPage, router]);

  const handleSignOut = () => {
    clearAuth();
    setAuthed(false);
    setUser(null);
    router.replace("/login");
  };

  const value = useMemo(
    () => ({ authed, user, signOut: handleSignOut }),
    [authed, user]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}