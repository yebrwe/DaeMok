'use client';

import React from 'react';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import GameRoom from '@/components/GameRoom';
import { useAuth } from '@/hooks/useAuth';
import { useRoomPresence } from '@/hooks/useRoomPresence';
import { getDatabase, ref, get, update, serverTimestamp } from 'firebase/database';
import { getAuth, onAuthStateChanged } from 'firebase/auth';

export default function RoomPage({ params }: { params: { id: string } }) {
  const unwrappedParams = React.use(params);
  const roomId = unwrappedParams.id;
  const { user, loading } = useAuth();
  const router = useRouter();
  const [joining, setJoining] = useState(true);
  const [authConfirmed, setAuthConfirmed] = useState(false);
  const [retryCount, setRetryCount] = useState(0);
  const [authVerified, setAuthVerified] = useState(false);
  
  const { isConnected, error } = useRoomPresence(
    authVerified ? user?.uid || '' : '', 
    authVerified ? roomId : ''
  );
  
  useEffect(() => {
    if (loading && retryCount < 10) {
      const timer = setTimeout(() => {
        setRetryCount(prev => prev + 1);
        console.log(`인증 상태 대기 중... (${retryCount + 1}/10)`);
      }, 500);
      
      return () => clearTimeout(timer);
    }
    
    if (retryCount >= 10 && loading) {
      console.log('인증 시간 초과, 로그인 페이지로 리디렉션');
      router.push('/login');
    }
  }, [loading, retryCount, router]);
  
  useEffect(() => {
    if (!loading && user) {
      const auth = getAuth();
      
      const verifyAuth = () => {
        if (auth.currentUser) {
          console.log('Firebase 인증 상태 확인됨:', auth.currentUser.uid);
          auth.currentUser.getIdToken(true).then(() => {
            console.log('인증 토큰 갱신 성공, 방 접속 시도 허용');
            setAuthVerified(true);
          }).catch(err => {
            console.error('인증 토큰 갱신 실패:', err);
            router.push('/login');
          });
        } else {
          console.error('Firebase 인증 상태 없음, 로그인 페이지로 이동');
          router.push('/login');
        }
      };
      
      const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
        if (currentUser) {
          verifyAuth();
        } else {
          router.push('/login');
        }
      });
      
      verifyAuth();
      
      return () => unsubscribe();
    }
  }, [loading, user, router]);
  
  useEffect(() => {
    if (!loading) {
      if (!user) {
        console.log('인증되지 않은, 로그인 페이지로 이동');
        router.push('/login');
      } else {
        if (user.uid) {
          setAuthConfirmed(true);
          user.getIdToken(true).then(() => {
            console.log('인증 토큰 갱신 성공');
            const database = getDatabase();
            if (database) {
              const userRoomRef = ref(database, `userRooms/${user.uid}/${roomId}`);
              update(userRoomRef, {
                lastAttempt: serverTimestamp()
              });
            }
          }).catch(err => {
            console.error('인증 토큰 갱신 실패:', err);
          });
          console.log('인증된 사용자:', user.uid);
        } else {
          console.error('사용자 인증은 되었지만 ID가 없음');
          router.push('/login');
        }
      }
    }
  }, [user, loading, router, roomId]);
  
  useEffect(() => {
    const checkRoom = async () => {
      if (!roomId || !authVerified) return;
      
      try {
        const database = getDatabase();
        const roomRef = ref(database, `rooms/${roomId}`);
        const snapshot = await get(roomRef);
        
        if (!snapshot.exists()) {
          console.log('방을 찾을 수 없음, 방 목록으로 이동');
          router.push('/rooms');
          return;
        }
        
        setJoining(false);
      } catch (error) {
        console.error('방 확인 중 오류:', error);
        router.push('/rooms');
      }
    };
    
    checkRoom();
  }, [roomId, router, authVerified]);
  
  useEffect(() => {
    if (error) {
      console.error('방 참여 오류:', error);
      router.push('/rooms');
    }
  }, [error, router]);
  
  useEffect(() => {
    // 이전에 명시적으로 나간 방인지 확인
    const hasLeftRoom = sessionStorage.getItem(`left_room_${roomId}`) === 'true' || 
                        localStorage.getItem(`left_room_${roomId}`) === 'true';
    
    if (hasLeftRoom) {
      console.log('이전에 명시적으로 나간 방입니다. 로비로 리디렉션합니다.');
      router.push('/rooms');
    }
  }, [roomId, router]);
  
  if (loading || !user || !authConfirmed || !authVerified) {
    return <div className="p-8 text-center">로딩 중...</div>;
  }
  
  if (joining) {
    return <div className="p-8 text-center">방에 참여하는 중...</div>;
  }
  
  const userId = user.uid;
  if (!userId) {
    return <div className="p-8 text-center text-red-500">사용자 ID를 확인할 수 없습니다. 다시 로그인해주세요.</div>;
  }
  
  return <GameRoom userId={userId} roomId={roomId} />;
} 