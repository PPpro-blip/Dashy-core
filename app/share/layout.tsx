import type { Metadata } from "next";
import { AppShell } from "@/components/AppShell";

export const metadata: Metadata = { title: "Share Hub" };

export default function ShareLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <AppShell title="Share Hub">{children}</AppShell>;
}
