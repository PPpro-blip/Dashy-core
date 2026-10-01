import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  images: {
    unoptimized: true,
  },
  async redirects() {
    return [
      // IA consolidation: Analytics now lives inside the D-Code group.
      { source: "/analytics", destination: "/d-code/analytics", permanent: false },
      // IA consolidation: exactly ONE Share Hub, at /share.
      { source: "/share-hub", destination: "/share", permanent: false },
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