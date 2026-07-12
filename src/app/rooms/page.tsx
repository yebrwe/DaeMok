'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import Image from 'next/image';
import RoomList from '@/components/RoomList';
import CreateRoomForm from '@/components/CreateRoomForm';
import { useAuth } from '@/hooks/useAuth';
import { restoreRoomSession, signOutUser, cleanupGhostRooms } from '@/lib/firebase';

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

    // 세션 복원 시도
    if (user) {
      const attemptRestore = async () => {
        try {
          // 명시적으로 방 복원을 건너뛰게 하기 위한 플래그 확인
          const skipRestore = sessionStorage.getItem('skip_room_restore') === 'true';

          if (skipRestore) {
            console.log('사용자가 명시적으로 방을 나갔습니다. 세션 복원을 건너뜁니다.');
            sessionStorage.removeItem('skip_room_restore'); // 플래그 제거
            setRestoringSession(false);
            // 유령/폐기된 방 자동 정리
            cleanupGhostRooms(user.uid).catch(() => {});
            return;
          }

          const restoredRoomId = await restoreRoomSession();
          if (restoredRoomId) {
            console.log('이전 게임 세션으로 복원:', restoredRoomId);
            router.push(`/rooms/${restoredRoomId}`);
          } else {
            setRestoringSession(false);
            // 유령/폐기된 방 자동 정리 (내 빈 방 + 2시간 이상 방치된 방)
            cleanupGhostRooms(user.uid).catch(() => {});
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

  const handleLogout = async () => {
    const success = await signOutUser();
    if (success) {
      router.push('/login');
    }
  };

  if (loading || !user || restoringSession) {
    return (
      <div className="flex justify-center items-center min-h-screen">
        <div className="text-center">
          <div className="w-12 h-12 border-4 border-amber-400 border-t-transparent rounded-full animate-spin mx-auto"></div>
          <p className="mt-4 text-slate-400">로딩 중...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto p-3 sm:p-4 max-w-4xl">
      {/* 상단 헤더 - 게임 로고 + 사용자 메뉴 */}
      <header className="game-panel !rounded-xl px-4 py-3 mb-4 flex justify-between items-center">
        <div className="flex items-center gap-2">
          <span className="text-2xl">🏁</span>
          <div className="leading-tight">
            <h1 className="text-xl font-black tracking-tight text-amber-300">대목</h1>
            <p className="text-[10px] text-slate-500">숨겨진 벽을 피해 더 적은 턴으로 골인하세요</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Link href="/adventure" className="btn-game px-3 py-1.5 text-xs">
            🗡️ 모험가 길드
          </Link>
          <Link href="/practice" className="btn-sub px-3 py-1.5 text-xs">
            🎯 연습 모드
          </Link>
          <div className="flex items-center gap-1.5 px-2 py-1 rounded-lg bg-slate-800/60 border border-slate-700/60">
            {user.photoURL ? (
              <Image src={user.photoURL} alt="프로필" width={24} height={24} className="w-6 h-6 rounded-full ring-1 ring-amber-400/60" />
            ) : (
              <div className="w-6 h-6 rounded-full bg-blue-500 flex items-center justify-center text-[10px] font-bold text-white">
                {user.displayName?.[0] || 'P'}
              </div>
            )}
            <span className="text-xs text-slate-300 max-w-[80px] truncate hidden sm:block">
              {user.displayName || '플레이어'}
            </span>
          </div>
          <button onClick={handleLogout} className="btn-sub px-3 py-1.5 text-xs">
            로그아웃
          </button>
        </div>
      </header>

      <section className="min-h-[420px]">
        <CreateRoomForm userId={user.uid} />
        <div className="mt-4">
          <RoomList userId={user.uid} />
        </div>
      </section>
    </div>
  );
}
