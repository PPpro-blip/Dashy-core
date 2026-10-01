import { AppShell } from "@/components/AppShell";

export default function ShareLayout({ children }: { children: React.ReactNode }) {
  return <AppShell title="Share Hub">{children}</AppShell>;
}
