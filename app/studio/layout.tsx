import type { Metadata } from "next";
import { AppShell } from "@/components/AppShell";

export const metadata: Metadata = {
  title: "Studio",
};

/**
 * DashyCore v7 — Studio (AI image generation) shell.
 * Authenticated route: sidebar + header + session guard via AppShell.
 */
export default function StudioLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <AppShell title="Studio">{children}</AppShell>;
}
