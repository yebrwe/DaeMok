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
    // 브라우저 재시작 감지를 위한 세션 스토리지 확인
    const isNewBrowserSession = !sessionStorage.getItem('browser_session');
    
    if (isNewBrowserSession) {
      // 새 브라우저 세션 표시
      sessionStorage.setItem('browser_session', Date.now().toString());
      // 방 복원 건너뛰기 플래그 설정
      sessionStorage.setItem('skip_room_restore', 'true');
      console.log('새 브라우저 세션 감지, 방 복원을 건너뜁니다.');
    }
    
    if (!loading && !user) {
      console.log('인증되지 않은 사용자, 로그인 페이지로 이동');
      router.push('/login');
      return;
    }
    
    // 세션 복원 시도 - 여기서 변경이 필요
    if (user) {
      const attemptRestore = async () => {
        try {
          // 명시적으로 방 복원을 건너뛰게 하기 위한 플래그 확인
          const skipRestore = sessionStorage.getItem('skip_room_restore') === 'true';
          
          if (skipRestore) {
            console.log('사용자가 명시적으로 방을 나갔습니다. 세션 복원을 건너뜁니다.');
            sessionStorage.removeItem('skip_room_restore'); // 플래그 제거
            setRestoringSession(false);
            return;
          }
          
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