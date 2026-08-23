import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { EcosystemShell } from "../components/EcosystemShell";
import { AuthProvider } from "../components/AuthProvider";
import { ToastProvider } from "../components/ToastProvider";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: "DashyCore AI",
    template: "%s · DashyCore AI",
  },
  description: "Next-gen AI Ecosystem & Model Routing",
  applicationName: "DashyCore AI",
  appleWebApp: {
    capable: true,
    title: "DashyCore AI",
    statusBarStyle: "black-translucent",
  },
  icons: {
    icon: "/icon-512.png",
    apple: "/icon-512.png",
  },
  manifest: "/manifest.webmanifest",
};

export const viewport: Viewport = {
  themeColor: "#0b0c10",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" data-theme="dark" suppressHydrationWarning>
      <body className={inter.variable}>
        <ToastProvider>
          <AuthProvider>
            <EcosystemShell>{children}</EcosystemShell>
          </AuthProvider>
        </ToastProvider>
      </body>
    </html>
  );
}