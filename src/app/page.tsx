'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/hooks/useAuth';

export default function Home() {
  const { user, loading } = useAuth();
  const router = useRouter();
  
  useEffect(() => {
    // 로딩이 완료되면 로그인 상태에 따라 리디렉션
    if (!loading) {
      if (user) {
        // 로그인된 상태면 방 목록 페이지로 이동
        router.push('/rooms');
      } else {
        // 로그인되지 않은 상태면 로그인 페이지로 이동
        router.push('/login');
      }
    }
  }, [user, loading, router]);

  // 로딩 중에는 로딩 화면 표시
  return (
    <div className="flex items-center justify-center h-screen">
      <div className="text-center">
        <div className="text-4xl mb-4">🏁</div>
        <div className="w-12 h-12 border-4 border-amber-400 border-t-transparent rounded-full animate-spin mx-auto"></div>
        <p className="mt-4 text-slate-400">로딩 중...</p>
      </div>
    </div>
  );
}
