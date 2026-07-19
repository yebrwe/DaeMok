import type { NextConfig } from "next";

const requestedDistDir = process.env.NEXT_DIST_DIR?.trim();
const distDir = requestedDistDir && /^\.next(?:-[a-z0-9-]+)?$/.test(requestedDistDir)
  ? requestedDistDir
  : '.next';

const nextConfig: NextConfig = {
  devIndicators: false,
  distDir,
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'lh3.googleusercontent.com',
      },
    ],
  },
  reactStrictMode: true,
};

export default nextConfig;
