import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Minimal self-contained server for the Docker image (node server.js).
  output: "standalone",
  poweredByHeader: false,
};

export default nextConfig;
