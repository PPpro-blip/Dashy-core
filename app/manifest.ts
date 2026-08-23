import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "DashyCore AI",
    short_name: "DashyCore",
    description: "Next-gen AI Ecosystem & Model Routing",
    start_url: "/",
    display: "standalone",
    orientation: "portrait-primary",
    background_color: "#0b0c10",
    theme_color: "#0b0c10",
    categories: ["productivity", "developer", "utilities"],
    icons: [
      {
        src: "/icon-512.png",
        sizes: "192x192",
        type: "image/png",
      },
      {
        src: "/icon-512.png",
        sizes: "512x512",
        type: "image/png",
      },
      {
        src: "/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
    shortcuts: [
      {
        name: "New Chat",
        short_name: "Chat",
        description: "Start a new conversation with Dashy AI",
        url: "/",
      },
      {
        name: "D-Code Workspace",
        short_name: "D-Code",
        description: "Open the D-Code developer workspace",
        url: "/dcode",
      },
      {
        name: "Settings",
        short_name: "Settings",
        description: "Manage your DashyCore preferences",
        url: "/settings",
      },
    ],
  };
}