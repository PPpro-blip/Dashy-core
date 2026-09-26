import { AppShell } from "@/components/AppShell";

export default function AgentsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <AppShell title="Agents">{children}</AppShell>;
}
