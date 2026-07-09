'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useRooms } from '@/hooks/useFirebase';
import { joinRoom } from '@/lib/firebase';

interface RoomListProps {
  userId: string;
}

const RoomList: React.FC<RoomListProps> = ({ userId }) => {
  const { rooms, isLoading } = useRooms();
  const [joining, setJoining] = useState<string | null>(null);
  const [joinError, setJoinError] = useState<string | null>(null);
  const router = useRouter();

  const handleJoinRoom = async (roomId: string) => {
    try {
      setJoining(roomId);
      setJoinError(null);

      console.log('방 참가 시도:', roomId);
      const success = await joinRoom(roomId, userId);

      if (success) {
        console.log('방 참가 성공:', roomId);
        router.push(`/rooms/${roomId}`);
      } else {
        console.error('방 참가 실패');
        setJoinError('방에 참가할 수 없습니다.');
      }
    } catch (error) {
      console.error('방 참가 오류:', error);
      setJoinError('방 참가 중 오류가 발생했습니다.');
    } finally {
      setJoining(null);
    }
  };

  if (isLoading) {
    return (
      <div className="game-panel p-8 flex items-center justify-center">
        <div className="text-center">
          <div className="w-8 h-8 border-2 border-amber-400 border-t-transparent rounded-full animate-spin mx-auto"></div>
          <p className="mt-3 text-sm text-slate-400">방 목록을 불러오는 중...</p>
        </div>
      </div>
    );
  }

  if (!rooms || rooms.length === 0) {
    return (
      <div className="game-panel p-8 text-center">
        <div className="text-4xl mb-2">🎲</div>
        <p className="text-sm text-slate-300 font-medium">아직 열린 게임이 없습니다</p>
        <p className="text-xs text-slate-500 mt-1">첫 번째 방을 만들고 상대를 기다려보세요!</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col">
      <h2 className="text-sm font-bold mb-2 text-slate-300 flex items-center gap-1.5">
        ⚔️ 대전 목록
        <span className="text-[10px] font-normal text-slate-500">({rooms.length}개)</span>
      </h2>

      {joinError && (
        <div className="bg-red-500/10 border border-red-500/40 text-red-300 px-3 py-2 rounded-xl mb-3 text-xs">
          {joinError}
        </div>
      )}

      <div className="space-y-2.5 overflow-y-auto max-h-[calc(100vh-360px)] pr-1">
        {rooms.map((room, index) => {
          const playerCount = room.players?.length || 0;
          const maxPlayers = room.maxPlayers || 2;
          const isFull = playerCount >= maxPlayers;
          // status 필드는 갱신되지 않는 레거시 - 게임 진행 여부는 gameState.phase로 판정
          const isPlaying = !!room.gameState?.phase && room.gameState.phase !== 'setup';

          return (
            <div
              key={room.id || `room-${index}`}
              data-room-card
              className="game-panel !rounded-xl p-3 hover:!border-amber-400/40 transition-colors"
            >
              <div className="flex justify-between items-center gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <h3 className="text-sm font-bold truncate text-slate-100">{room.name}</h3>
                    {isPlaying ? (
                      <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-red-400/10 text-red-300 border border-red-400/40 shrink-0">
                        게임중
                      </span>
                    ) : (
                      <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-green-400/10 text-green-300 border border-green-400/40 shrink-0">
                        대기중
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2 mt-1 text-[11px] text-slate-500">
                    <span className={playerCount > 0 ? 'text-amber-300' : ''}>
                      👥 {playerCount} / {maxPlayers}
                    </span>
                    <span>
                      {new Date((room as any).createdAt || Date.now()).toLocaleString(undefined, {
                        month: 'short',
                        day: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit'
                      })}
                    </span>
                  </div>
                </div>

                <button
                  onClick={() => handleJoinRoom(room.id)}
                  disabled={joining === room.id || (isFull && !isPlaying)}
                  className={`shrink-0 px-4 py-2 text-xs ${
                    joining === room.id || (isFull && !isPlaying) ? 'btn-sub' : 'btn-game'
                  }`}
                >
                  {joining === room.id
                    ? '입장 중...'
                    : isPlaying
                      ? '👁 관전하기'
                      : isFull
                        ? '가득 참'
                        : '참가하기'}
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default RoomList;
