'use client';

import React, { use } from 'react';
import { useRouter } from 'next/navigation';
import GameRoom from '@/components/GameRoom';
import { useAuth } from '@/hooks/useFirebase';

interface GamePageProps {
  params: Promise<{
    roomId: string;
  }>;
}

interface RouteParams {
  roomId: string;
}

export default function GamePage(props: GamePageProps) {
  // React.use()를 사용하여 params Promise 언래핑
  const params = use(props.params as any) as RouteParams;
  const roomId = params.roomId;
  const { userId, isLoading } = useAuth();
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
  
  if (!userId) {
    // ID가 없으면 홈으로 리다이렉트
    router.push('/');
    return null;
  }
  
  return (
    <div className="container mx-auto p-4">
      <GameRoom userId={userId} roomId={roomId} />
    </div>
  );
} 