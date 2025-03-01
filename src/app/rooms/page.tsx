'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import RoomList from '@/components/RoomList';
import CreateRoomForm from '@/components/CreateRoomForm';
import LobbyChat from '@/components/LobbyChat';
import { useAuth } from '@/hooks/useAuth';
import { restoreRoomSession } from '@/lib/firebase';

export default function RoomsPage() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const [restoringSession, setRestoringSession] = useState(true);
  
  useEffect(() => {
    if (!loading && !user) {
      console.log('인증되지 않은 사용자, 로그인 페이지로 이동');
      router.push('/login');
      return;
    }
    
    // 세션 복원 시도
    if (user) {
      const attemptRestore = async () => {
        try {
          const restoredRoomId = await restoreRoomSession();
          if (restoredRoomId) {
            console.log('이전 게임 세션으로 복원:', restoredRoomId);
            router.push(`/rooms/${restoredRoomId}`);
          } else {
            setRestoringSession(false);
          }
        } catch (error) {
          console.error('세션 복원 오류:', error);
          setRestoringSession(false);
        }
      };
      
      attemptRestore();
    } else {
      setRestoringSession(false);
    }
  }, [user, loading, router]);
  
  if (loading || !user || restoringSession) {
    return (
      <div className="flex justify-center items-center min-h-screen">
        <div className="text-center">
          <div className="w-12 h-12 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto"></div>
          <p className="mt-4">로딩 중...</p>
        </div>
      </div>
    );
  }
  
  return (
    <div className="container mx-auto p-4">
      <h1 className="text-2xl font-bold mb-6 text-center">게임 대기실</h1>
      
      {/* 모바일에서는 상하 배치, 데스크탑에서는 좌우 배치 */}
      <div className="flex flex-col md:flex-row md:space-x-4 h-[calc(100vh-120px)]">
        {/* 방 생성 및 목록 (모바일에서는 상단, 데스크탑에서는 좌측) */}
        <div className="flex-1 overflow-y-auto mb-4 md:mb-0 md:w-1/2">
          <CreateRoomForm userId={user.uid} />
          
          <div className="mt-4">
            <RoomList userId={user.uid} />
          </div>
        </div>
        
        {/* 채팅과 유저 목록 (모바일에서는 하단, 데스크탑에서는 우측) */}
        <div className="flex-1 md:w-1/2">
          <LobbyChat currentUserId={user.uid} />
        </div>
      </div>
    </div>
  );
} 