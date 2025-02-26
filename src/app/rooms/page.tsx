'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import RoomList from '@/components/RoomList';
import CreateRoomForm from '@/components/CreateRoomForm';
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
      <h1 className="text-2xl font-bold mb-6 text-center">게임 방 목록</h1>
      
      <CreateRoomForm userId={user.uid} />
      
      <div className="mt-8">
        <RoomList userId={user.uid} />
      </div>
    </div>
  );
} 