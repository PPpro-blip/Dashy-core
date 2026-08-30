import { AppShell } from "@/components/AppShell";

export default function ProjectsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <AppShell title="Projects">{children}</AppShell>;
}
