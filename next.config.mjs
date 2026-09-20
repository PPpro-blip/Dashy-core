import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  images: {
    unoptimized: true,
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