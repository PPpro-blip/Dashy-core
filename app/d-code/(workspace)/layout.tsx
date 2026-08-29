import type { Metadata } from "next";
import { AppShell } from "@/components/AppShell";

export const metadata: Metadata = {
  title: "D-Code",
};

/**
 * DashyCore v7 — authenticated D-Code shell (sidebar + header + guard).
 *
 * The public share viewer lives outside this route group
 * (app/d-code/share/[share_slug]) so anonymous visitors can open shared
 * projects without a session.
 */
export default function DCodeWorkspaceLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <AppShell title="D-Code">{children}</AppShell>;
}
