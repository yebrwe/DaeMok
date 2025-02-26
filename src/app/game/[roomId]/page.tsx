'use client';

import React, { useEffect } from 'react';
import { useRouter, useParams } from 'next/navigation';
import GameRoom from '@/components/GameRoom';
import { useAuth } from '@/hooks/useFirebase';

interface GamePageProps {
  params: {
    roomId: string;
  };
}

export default function GamePage(props: GamePageProps) {
  const { roomId } = useParams();
  const { userId, userProfile, isLoading, isLoggedIn } = useAuth();
  const router = useRouter();
  
  // 인증 정보가 미완료일 때 강제로 리다이렉트하지 않고,
  // localStorage에 저장된 'currentRoom'이 현재 roomId와 일치하면 방을 계속 유지하도록 처리
  useEffect(() => {
    if (!isLoading) {
      const savedRoom = localStorage.getItem('currentRoom');
      if ((!isLoggedIn || !userProfile) && savedRoom !== roomId) {
        router.push('/');
      }
    }
  }, [isLoading, isLoggedIn, userProfile, router, roomId]);
  
  // isLoading 상태만 체크하여 로딩 UI를 표시 (인증 정보 미완료 상태여도 방 정보가 있다면 GameRoom을 렌더링)
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
  
  return (
    <div className="container mx-auto p-4">
      <GameRoom userId={userProfile?.uid || userId} roomId={roomId} />
    </div>
  );
} 