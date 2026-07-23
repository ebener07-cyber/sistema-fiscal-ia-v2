import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  typescript: {
    ignoreBuildErrors: true,
  },
  reactStrictMode: false,
  serverExternalPackages: ['canvas', 'pdfjs-dist', 'pdf-parse'],
};

export default nextConfig;
