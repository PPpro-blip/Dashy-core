import { AppShell } from "@/components/AppShell";

export default function KnowledgeLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <AppShell title="Knowledge">{children}</AppShell>;
}
