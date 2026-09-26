import { AppShell } from "@/components/AppShell";

export default function AnalyticsLayout({ children }: { children: React.ReactNode }) {
  return <AppShell title="Analytics">{children}</AppShell>;
}
