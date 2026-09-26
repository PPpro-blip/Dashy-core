import { AppShell } from "@/components/AppShell";

export default function StudioLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <AppShell title="Studio">{children}</AppShell>;
}
