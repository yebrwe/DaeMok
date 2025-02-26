'use client';

import React from 'react';
import { useRouter } from 'next/navigation';
import Lobby from '@/components/Lobby';
import { useAuth } from '@/hooks/useFirebase';

export default function LobbyPage() {
  const { userId, userProfile, isLoading, isLoggedIn } = useAuth();
  const router = useRouter();
  
  // 사용자 ID 확인
  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="text-center">
          <h2 className="text-2xl font-bold mb-4">사용자 정보 로딩 중...</h2>
          <div className="w-12 h-12 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto"></div>
        </div>
      </div>
    );
  }
  
  if (!isLoggedIn || !userProfile) {
    // 로그인되지 않은 경우 홈으로 리다이렉트
    router.push('/');
    return null;
  }
  
  return (
    <div className="container mx-auto p-4">
      <Lobby userId={userProfile.uid} />
    </div>
  );
} 