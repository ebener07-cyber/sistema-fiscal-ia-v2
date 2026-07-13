import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  typescript: {
    ignoreBuildErrors: true,
  },
  reactStrictMode: false,
  // Marcar 'canvas' como externo — pdfjs-dist lo requiere opcionalmente
  // pero no es necesario para extracción de texto en Vercel
  serverExternalPackages: ['canvas', 'pdfjs-dist'],
};

export default nextConfig;
