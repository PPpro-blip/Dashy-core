import path from "node:path";
import { fileURLToPath } from "node:url";
import { HTML_LIMITED_BOT_PATTERN } from "./lib/link-preview-bots.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Link-preview crawlers get BLOCKING metadata in <head> (Next.js streams it
  // into <body> for everyone else). Next's default list + the social/chat
  // unfurlers the share links target — see lib/link-preview-bots.mjs.
  htmlLimitedBots: new RegExp(HTML_LIMITED_BOT_PATTERN, "i"),
  images: {
    unoptimized: true,
    // Documents the upstream image engine. Harmless while `unoptimized`
    // is true (no Next optimization pass runs), and keeps next/image
    // working if optimization is ever re-enabled.
    remotePatterns: [
      {
        protocol: "https",
        hostname: "image.pollinations.ai",
        pathname: "/**",
      },
    ],
  },
  async rewrites() {
    return [
      // The <IMG> engine's "Buster" fallback is documented/wired as
      // /api/img-proxy; tolerate the doubled /api/api/img-proxy spelling
      // too so a stale client build can never 404 its fallback lane.
      {
        source: "/api/api/img-proxy",
        destination: "/api/img-proxy",
      },
    ];
  },
  webpack: (config) => {
    config.resolve.alias = {
      ...config.resolve.alias,
      "@": path.resolve(__dirname),
    };
    return config;
  },
};

export default nextConfig;