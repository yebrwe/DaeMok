import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  eslint: {
    // 빌드 시 ESLint 실행을 비활성화
    ignoreDuringBuilds: true,
  },
};

export default nextConfig;
