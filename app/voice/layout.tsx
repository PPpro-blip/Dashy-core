import { AppShell } from "@/components/AppShell";

export default function VoiceLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <AppShell title="Voice">{children}</AppShell>;
}
