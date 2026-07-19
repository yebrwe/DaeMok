'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import Image from 'next/image';
import { Flag, LogOut, Target, Trophy } from 'lucide-react';
import RoomList from '@/components/RoomList';
import CreateRoomForm from '@/components/CreateRoomForm';
import MazeShell from '@/components/maze/MazeShell';
import { useAuth } from '@/hooks/useAuth';
import { restoreRoomSession, signOutUser, cleanupGhostRooms } from '@/lib/firebase';
import type { MazeAuthorityRankingView } from '@/lib/mazeAuthorityClient';
import { useMazeAuthorityMemberRooms, useMazeAuthorityRankings } from '@/hooks/useMazeAuthority';
import styles from './page.module.css';

const RANKING_LOOKUP_LIMIT = 500;
const MAZE_INITIAL_RATING = 1_000;

interface MazeRankingPanelProps {
  userId: string;
}

function RankingAvatar({ entry }: { entry: MazeAuthorityRankingView }) {
  if (entry.photoURL) {
    return (
      <Image
        src={entry.photoURL}
        alt=""
        width={24}
        height={24}
        className={styles.rankingAvatar}
      />
    );
  }

  return (
    <span className={styles.rankingAvatarFallback} aria-hidden="true">
      {entry.displayName[0] || 'P'}
    </span>
  );
}

function MazeRankingPanel({ userId }: MazeRankingPanelProps) {
  const { entries: rankings, isLoading, error } = useMazeAuthorityRankings();

  const rankingIndex = rankings.findIndex((entry) => entry.uid === userId);
  const displayedOwnRanking = rankingIndex >= 0 ? rankings[rankingIndex] : null;
  const topTen = rankings.slice(0, 10);
  const rankLabel = displayedOwnRanking
    ? rankingIndex >= 0
      ? `${rankingIndex + 1}위`
      : `${RANKING_LOOKUP_LIMIT}위 밖`
    : '첫 경기 전';

  return (
    <aside className={`${styles.rankingPanel} game-panel`} aria-labelledby="maze-ranking-title" data-testid="maze-ranking">
      <div className={styles.rankingHeading}>
        <div className={styles.rankingTitleRow}>
          <Trophy size={17} strokeWidth={2.2} aria-hidden="true" />
          <h2 id="maze-ranking-title">미로 랭킹</h2>
        </div>
        <span className={styles.betaBadge}>서버 검증</span>
      </div>

      <div className={styles.ownRankingBand}>
        <div>
          <span className={styles.ownRankingLabel}>내 순위</span>
          <strong className={styles.ownRankingPosition}>{rankLabel}</strong>
        </div>
        <div className={styles.ownRating}>
          <strong>{displayedOwnRanking?.rating ?? MAZE_INITIAL_RATING}</strong>
          <span>RP</span>
        </div>
        <div className={styles.ownRecord}>
          <span><b>{displayedOwnRanking?.wins ?? 0}</b>승</span>
          <span><b>{displayedOwnRanking?.draws ?? 0}</b>무</span>
          <span><b>{displayedOwnRanking?.losses ?? 0}</b>패</span>
          <span>최고 <b>{displayedOwnRanking?.bestMoves ? `${displayedOwnRanking.bestMoves}턴` : '-'}</b></span>
        </div>
      </div>

      {isLoading ? (
        <div className={styles.rankingStatus} role="status">
          <span className={styles.smallSpinner} aria-hidden="true" />
          랭킹 불러오는 중
        </div>
      ) : error ? (
        <div className={styles.rankingStatus} role="alert">{error}</div>
      ) : topTen.length === 0 ? (
        <div className={styles.rankingStatus}>Authority 경기 기록을 기다리고 있습니다.</div>
      ) : (
        <div className={styles.rankingTableScroll}>
          <table className={styles.rankingTable}>
            <caption className="sr-only">서버 검증 미로 랭킹 상위 10명</caption>
            <thead>
              <tr>
                <th scope="col">#</th>
                <th scope="col">플레이어</th>
                <th scope="col">RP</th>
                <th scope="col">전적</th>
                <th scope="col">최고</th>
              </tr>
            </thead>
            <tbody>
              {topTen.map((entry, index) => (
                <tr key={entry.uid} className={entry.uid === userId ? styles.myRankingRow : undefined}>
                  <td className={styles.rankNumber}>{index + 1}</td>
                  <td>
                    <span className={styles.rankingPlayer}>
                      <RankingAvatar entry={entry} />
                      <span title={entry.displayName}>{entry.displayName}</span>
                    </span>
                  </td>
                  <td className={styles.ratingCell}>{entry.rating}</td>
                  <td className={styles.recordCell}>{entry.wins}-{entry.draws}-{entry.losses}</td>
                  <td className={styles.bestMovesCell}>{entry.bestMoves ? entry.bestMoves : '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className={styles.betaNote}>
        서버가 확정한 경기 결과만 RP와 전적에 반영됩니다.
      </p>
    </aside>
  );
}

export default function RoomsPage() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const [restoringSession, setRestoringSession] = useState(true);
  const authorityMemberships = useMazeAuthorityMemberRooms(user?.uid ?? '');

  useEffect(() => {
    if (!restoringSession) return;
    // 브라우저 재시작 감지를 위한 세션 스토리지 확인
    const isNewBrowserSession = !sessionStorage.getItem('browser_session');

    if (isNewBrowserSession) {
      sessionStorage.setItem('browser_session', Date.now().toString());
      console.log('새 브라우저 세션 감지, 진행 중인 Authority 경기를 확인합니다.');
    }

    if (loading || (user && authorityMemberships.isLoading)) return;

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

          if (authorityMemberships.error) {
            console.error('Authority 세션 복원 오류:', authorityMemberships.error);
          } else {
            const authorityRoom = authorityMemberships.rooms.find(
              (view) => view.gameState.phase === 'play',
            ) ?? authorityMemberships.rooms.find(
              (view) => view.gameState.phase === 'setup',
            );
            if (authorityRoom) {
              console.log('Authority 게임 세션으로 복원:', authorityRoom.roomId);
              router.replace(`/rooms/${authorityRoom.roomId}`);
              return;
            }
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
  }, [authorityMemberships, user, loading, restoringSession, router]);

  const handleLogout = async () => {
    const success = await signOutUser();
    if (success) {
      router.push('/login');
    }
  };

  if (loading || !user || restoringSession) {
    return (
      <MazeShell screen="lobby" phase="configure">
        <div className="flex min-h-svh items-center justify-center">
          <div className="text-center text-[#3d352d]">
            <div className="mx-auto h-12 w-12 animate-spin rounded-full border-4 border-[#69cdb7] border-t-transparent" />
            <p className="mt-4 font-bold">놀이판을 펼치는 중...</p>
          </div>
        </div>
      </MazeShell>
    );
  }

  return (
    <MazeShell screen="lobby" phase="waiting">
      <div className={`${styles.page} container mx-auto max-w-6xl p-3 sm:p-4`}>
      {/* 상단 헤더 - 게임 로고 + 사용자 메뉴 */}
      <header className={`${styles.header} game-panel !rounded-xl px-4 py-3 mb-4`}>
        <div className={styles.brand}>
          <Flag size={24} className="shrink-0 text-[#b36c4c]" aria-hidden="true" />
          <div className="leading-tight">
            <h1 className="text-xl font-black tracking-tight text-[#3d352d]">대목</h1>
            <p className="text-[11px] font-medium text-[#74685c]">숨겨진 벽을 피해 더 적은 턴으로 골인하세요</p>
          </div>
        </div>

        <div className={styles.headerActions}>
          <Link href="/practice" className="btn-sub px-3 py-2 text-xs">
            <Target size={15} aria-hidden="true" /> <span className={styles.desktopActionLabel}>연습 모드</span><span className={styles.mobileActionLabel}>연습</span>
          </Link>
          <div className={styles.profileBadge}>
            {user.photoURL ? (
              <Image src={user.photoURL} alt="프로필" width={24} height={24} className="w-6 h-6 rounded-full ring-1 ring-amber-400/60" />
            ) : (
              <div className="w-6 h-6 rounded-full bg-blue-500 flex items-center justify-center text-[10px] font-bold text-white">
                {user.displayName?.[0] || 'P'}
              </div>
            )}
            <span className="hidden max-w-[80px] truncate text-xs font-bold text-[#3d352d] sm:block">
              {user.displayName || '플레이어'}
            </span>
          </div>
          <button onClick={handleLogout} className="btn-sub px-3 py-2 text-xs">
            <LogOut size={15} aria-hidden="true" /> 로그아웃
          </button>
        </div>
      </header>

      <main className={styles.lobbyGrid}>
        <section className={styles.roomColumn}>
          <CreateRoomForm userId={user.uid} />
          <div className="mt-4">
            <RoomList userId={user.uid} />
          </div>
        </section>
        <MazeRankingPanel userId={user.uid} />
      </main>
      </div>
    </MazeShell>
  );
}
