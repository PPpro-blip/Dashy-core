import type { Metadata, Viewport } from "next";
import "@fontsource-variable/inter";
import { ToastProvider } from "@/components/Toast";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "DashyCore AI",
    template: "%s · DashyCore AI",
  },
  description: "Next-gen AI Ecosystem & Model Routing",
  icons: {
    icon: "/icon-512.png",
    apple: "/icon-512.png",
  },
};

export const viewport: Viewport = {
  themeColor: "#0a0a0b",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className="dark">
      <body className="font-sans bg-neutral-950 text-neutral-50 antialiased">
        <ToastProvider>{children}</ToastProvider>
      </body>
    </html>
  );
}