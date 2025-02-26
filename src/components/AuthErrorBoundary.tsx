'use client';

import { useEffect } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { useRouter } from 'next/navigation';

export function AuthErrorBoundary({
  children,
}: {
  children: React.ReactNode;
}) {
  const { authError } = useAuth();
  const router = useRouter();
  
  // 심각한 인증 오류가 발생한 경우 리디렉션
  useEffect(() => {
    if (authError) {
      console.error('심각한 인증 오류 발생:', authError);
      // 세션 스토리지에 오류 메시지 저장 (로그인 페이지에서 표시용)
      sessionStorage.setItem('authError', authError);
      router.push('/login');
    }
  }, [authError, router]);
  
  return <>{children}</>;
} 