'use client';

import React from 'react';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getAuth, onAuthStateChanged, type User } from 'firebase/auth';
import GameRoom from '@/components/GameRoom';
import AuthorityGameRoom from '@/components/AuthorityGameRoom';
import MazeShell from '@/components/maze/MazeShell';
import { useAuth } from '@/hooks/useAuth';
import { useRoomPresence } from '@/hooks/useRoomPresence';
import { firebaseInitPromise } from '@/lib/firebase';
import {
  MAZE_AUTHORITY_ROOM_PREFIX,
  isMazeAuthorityRoomId,
} from '@/lib/mazeAuthorityRuntime';
import { getDatabase, ref, get, update, serverTimestamp } from 'firebase/database';

export default function RoomPage({ params }: { params: Promise<{ id: string }> }) {
  const unwrappedParams = React.use(params);
  const roomId = unwrappedParams.id;

  // The mz1_ namespace is reserved for Authority rooms. A malformed ID must
  // never fall through to legacy presence or legacy RTDB room paths.
  if (roomId.startsWith(MAZE_AUTHORITY_ROOM_PREFIX)) {
    return isMazeAuthorityRoomId(roomId)
      ? <AuthorityRoomPage roomId={roomId} />
      : <InvalidAuthorityRoomPage />;
  }

  return <LegacyRoomPage roomId={roomId} />;
}

function AuthorityRoomPage({ roomId }: { roomId: string }) {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [authError, setAuthError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    let unsubscribe: (() => void) | null = null;

    void firebaseInitPromise.then((initialized) => {
      if (!active) return;
      if (!initialized?.auth) {
        setAuthError('인증 서버를 초기화하지 못했습니다.');
        setLoading(false);
        return;
      }
      unsubscribe = onAuthStateChanged(
        initialized.auth,
        (currentUser) => {
          if (!active) return;
          setUser(currentUser);
          setLoading(false);
        },
        () => {
          if (!active) return;
          setAuthError('로그인 상태를 확인하지 못했습니다.');
          setLoading(false);
        },
      );
    }).catch(() => {
      if (!active) return;
      setAuthError('인증 서버를 초기화하지 못했습니다.');
      setLoading(false);
    });

    return () => {
      active = false;
      unsubscribe?.();
    };
  }, []);

  useEffect(() => {
    if (!loading && !authError && !user) router.replace('/login');
  }, [authError, loading, router, user]);

  if (loading || (!user && !authError)) {
    return <div className="p-8 text-center">로딩 중...</div>;
  }

  if (authError) {
    return (
      <div className="p-8 text-center text-red-500" role="alert">
        {authError}
      </div>
    );
  }

  if (!user) return <div className="p-8 text-center">로그인 화면으로 이동 중...</div>;

  return <AuthorityGameRoom userId={user.uid} roomId={roomId} />;
}

function InvalidAuthorityRoomPage() {
  const router = useRouter();

  return (
    <div className="flex min-h-svh flex-col items-center justify-center gap-4 p-8 text-center">
      <p className="font-bold" role="alert">올바르지 않은 게임 방 주소입니다.</p>
      <button type="button" className="btn-game min-h-11 px-5" onClick={() => router.replace('/rooms')}>
        방 목록으로
      </button>
    </div>
  );
}

function LegacyRoomPage({ roomId }: { roomId: string }) {
  const { user, loading } = useAuth();
  const router = useRouter();
  const [joining, setJoining] = useState(true);
  const [authConfirmed, setAuthConfirmed] = useState(false);
  const [retryCount, setRetryCount] = useState(0);
  const [authVerified, setAuthVerified] = useState(false);
  
  const { error } = useRoomPresence(
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
    const hasLeftRoom = sessionStorage.getItem(`left_room_${roomId}`) === 'true';
    
    if (hasLeftRoom) {
      console.log('현재 세션에서 나간 방입니다. 세션 데이터 초기화 후 계속합니다.');
      // 세션 데이터 초기화하여 재입장 가능하게 함
      sessionStorage.removeItem(`left_room_${roomId}`);
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
  
  return (
    <MazeShell screen="room" phase="play">
      <GameRoom userId={userId} roomId={roomId} />
    </MazeShell>
  );
}
