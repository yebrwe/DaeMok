'use client';

import React from 'react';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getAuth, onAuthStateChanged } from 'firebase/auth';
import { getDatabase, ref, get } from 'firebase/database';
import { firebaseInitPromise, handleDirectRoomAccess } from '@/lib/firebase';

export default function GamePage({ params }: { params: { id: string } }) {
  const unwrappedParams = React.use(params);
  const gameId = unwrappedParams.id;
  
  const [loading, setLoading] = useState(true);
  const router = useRouter();
  
  useEffect(() => {
    const initPage = async () => {
      try {
        // 1. Firebase 초기화 대기
        await firebaseInitPromise;
        console.log('Firebase 초기화 완료, 인증 상태 확인 중...');
        
        // 2. 인증 상태 확인
        const auth = getAuth();
        
        if (!auth.currentUser) {
          console.log('인증되지 않은 사용자, 로그인 페이지로 이동');
          router.push('/login');
          return;
        }
        
        // 3. 게임 ID 유효성 검증
        const database = getDatabase();
        const roomRef = ref(database, `rooms/${gameId}`);
        const snapshot = await get(roomRef);
        
        if (!snapshot.exists()) {
          console.error('존재하지 않는 게임:', gameId);
          router.push('/rooms');
          return;
        }
        
        // 4. 정상적인 URL로 리디렉션
        console.log('정상적인 URL로 리디렉션');
        router.push(`/rooms/${gameId}`);
      } catch (error) {
        console.error('게임 페이지 초기화 오류:', error);
        router.push('/rooms');
      } finally {
        setLoading(false);
      }
    };
    
    initPage();
  }, [gameId, router]);
  
  return (
    <div className="flex items-center justify-center min-h-screen">
      <div className="text-center">
        <h1 className="text-2xl font-bold mb-4">게임으로 이동 중...</h1>
        <div className="w-12 h-12 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto"></div>
        <p className="mt-4 text-gray-600">곧 게임 화면으로 이동합니다.</p>
      </div>
    </div>
  );
} 