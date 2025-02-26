import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  eslint: {
    // 빌드 시 ESLint 실행을 비활성화
    ignoreDuringBuilds: true,
  },
  typescript: {
    // 빌드 시 TypeScript 타입 검사 비활성화
    ignoreBuildErrors: true,
  },
  images: {
    domains: ['lh3.googleusercontent.com'],
  },
};

export default nextConfig;
