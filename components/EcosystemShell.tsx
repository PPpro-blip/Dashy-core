"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { MobileNav } from "./MobileNav";

interface EcosystemShellProps {
  children: React.ReactNode;
}

export function EcosystemShell({ children }: EcosystemShellProps) {
  const pathname = usePathname();
  const isDCode = pathname.startsWith("/dcode");
  const isLogin = pathname === "/login";

  // The login screen renders standalone — no app chrome.
  if (isLogin) {
    return <>{children}</>;
  }

  return (
    <div className="ecosystem">
      <header className="ecosystem-topbar">
        <div className="ecosystem-brand">
          <div className="ecosystem-brand-mark" aria-hidden="true">
            <svg viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
              <rect width="32" height="32" rx="8" fill="url(#ecosystem-grad)" />
              <path d="M10 22V14l3.5 0 3.2 7 3.2-7H23v8h-3v-7l-3 6h-3l-3-6v7z" fill="#0b0c10" />
              <defs>
                <linearGradient id="ecosystem-grad" x1="0" y1="0" x2="32" y2="32">
                  <stop stopColor="#00f2fe" />
                  <stop offset="1" stopColor="#9b51e0" />
                </linearGradient>
              </defs>
            </svg>
          </div>
          <span className="ecosystem-brand-name">DashyCore</span>
          <span className="ecosystem-brand-version">v7</span>
        </div>

        <nav className="ecosystem-tabs" aria-label="Ecosystem workspaces">
          <Link
            href="/"
            className={`ecosystem-tab${!isDCode ? " active" : ""}`}
            aria-current={!isDCode ? "page" : undefined}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M12 2l8 4v6c0 5-3.5 8-8 10-4.5-2-8-5-8-10V6l8-4z" />
              <path d="M9 12l2 2 4-4" />
            </svg>
            <span>Dashy AI</span>
          </Link>
          <Link
            href="/dcode"
            className={`ecosystem-tab dcode${isDCode ? " active" : ""}`}
            aria-current={isDCode ? "page" : undefined}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M16 18l6-6-6-6M8 6l-6 6 6 6" />
            </svg>
            <span>D-Code</span>
          </Link>
        </nav>

        <div className="ecosystem-actions">
          <Link
            href="/settings"
            className="icon-button"
            aria-label="Settings"
            title="Settings"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
            </svg>
          </Link>
          <span className="ecosystem-status" aria-hidden="true" />
        </div>
      </header>

      <div className="ecosystem-content">{children}</div>

      <MobileNav />
    </div>
  );
}