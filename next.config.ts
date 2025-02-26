import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  eslint: {
    // 빌드 시 ESLint 실행을 비활성화
    ignoreDuringBuilds: true,
    // 개발 중 경고 무시 추가
    ignoreDuringDevelopment: true,
  },
  typescript: {
    // 빌드 시 TypeScript 타입 검사 비활성화
    ignoreBuildErrors: true,
  },
  images: {
    domains: ['lh3.googleusercontent.com'],
  },
  reactStrictMode: true,
  // 추가 로거 레벨 조정
  logging: {
    level: 'error', // 'info', 'warn', 'error' 중 하나
  },
  // 환경 변수 설정
  env: {
    NEXT_DISABLE_WARNINGS: 'true',
  },
  // 콘솔 출력 설정 (개발 모드에만 적용)
  webpack: (config, { dev }) => {
    if (dev) {
      // 개발 모드에서 특정 경고 필터링
      config.infrastructureLogging = {
        level: 'error',
      };
    }
    return config;
  },
};

export default nextConfig;
