'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useRooms } from '@/hooks/useFirebase';
import { useMazeAuthorityRooms } from '@/hooks/useMazeAuthority';
import { joinRoom } from '@/lib/firebase';
import {
  buildMazeAuthorityJoinRoomCommand,
  invokeMazeAuthorityCommand,
  type MazeAuthorityPublicView,
} from '@/lib/mazeAuthorityClient';

interface RoomListProps {
  userId: string;
}

const RoomList: React.FC<RoomListProps> = ({ userId }) => {
  const { rooms: legacyRooms, isLoading: legacyLoading } = useRooms();
  const {
    rooms: authorityRooms,
    isLoading: authorityLoading,
    error: authorityError,
  } = useMazeAuthorityRooms();
  const [joining, setJoining] = useState<string | null>(null);
  const [joinError, setJoinError] = useState<string | null>(null);
  const router = useRouter();

  const handleJoinRoom = async (room: {
    id: string;
    source: 'authority-v1' | 'legacy-v3';
    authorityView?: MazeAuthorityPublicView;
  }) => {
    try {
      setJoining(room.id);
      setJoinError(null);

      console.log('방 참가 시도:', room.id, room.source);
      let success = true;
      if (room.source === 'authority-v1' && room.authorityView) {
        const view = room.authorityView;
        const isMember = !!view.lobby.members[userId];
        if (view.lobby.status === 'waiting' && !isMember) {
          await invokeMazeAuthorityCommand(buildMazeAuthorityJoinRoomCommand({
            roomId: room.id,
            expectedGeneration: view.generation,
            expectedRevision: view.revision,
          }));
        }
      } else {
        success = await joinRoom(room.id, userId);
      }

      if (success) {
        console.log('방 참가 성공:', room.id);
        router.push(`/rooms/${room.id}`);
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

  const rooms = [
    ...authorityRooms.map((view) => ({
      id: view.roomId,
      source: 'authority-v1' as const,
      authorityView: view,
      name: view.lobby.name,
      playerCount: Object.keys(view.lobby.members).length,
      maxPlayers: view.lobby.maxPlayers,
      isPlaying: view.lobby.status !== 'waiting',
      isMember: !!view.lobby.members[userId],
      createdAt: view.sourceUpdatedAt,
    })),
    ...legacyRooms.map((room) => ({
      id: room.id,
      source: 'legacy-v3' as const,
      name: room.name,
      playerCount: room.players?.length || 0,
      maxPlayers: room.maxPlayers || 2,
      isPlaying: !!room.gameState?.phase && room.gameState.phase !== 'setup',
      isMember: room.players?.includes(userId) ?? false,
      createdAt: room.createdAt || Date.now(),
    })),
  ].sort((left, right) => right.createdAt - left.createdAt || left.id.localeCompare(right.id));
  const isLoading = legacyLoading || authorityLoading;

  if (isLoading) {
    return (
      <div className="game-panel p-8 flex items-center justify-center">
        <div className="text-center">
          <div className="mx-auto h-8 w-8 animate-spin rounded-full border-2 border-[#69cdb7] border-t-transparent" />
          <p className="mt-3 text-sm font-bold text-[#74685c]">방 목록을 불러오는 중...</p>
        </div>
      </div>
    );
  }

  if (!rooms || rooms.length === 0) {
    return (
      <div className="game-panel p-8 text-center">
        <div className="text-4xl mb-2">🎲</div>
        <p className="text-sm font-black text-[#3d352d]">아직 열린 게임이 없습니다</p>
        <p className="mt-1 text-xs font-medium text-[#74685c]">첫 번째 방을 만들고 상대를 기다려보세요!</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col">
      <h2 className="mb-2 flex items-center gap-1.5 text-sm font-black text-[#3d352d]">
        <span aria-hidden="true">🎲</span> 대전 목록
        <span className="text-[11px] font-semibold text-[#74685c]">({rooms.length}개)</span>
      </h2>

      {joinError && (
        <div className="mb-3 rounded-xl border-2 border-[#b94646] bg-[#fff1ec] px-3 py-2 text-xs font-bold text-[#8a2e2e]" role="alert">
          {joinError}
        </div>
      )}
      {authorityError && (
        <div className="mb-3 rounded-xl border-2 border-[#b94646] bg-[#fff1ec] px-3 py-2 text-xs font-bold text-[#8a2e2e]" role="alert">
          {authorityError}
        </div>
      )}

      <div className="space-y-2.5 sm:max-h-[calc(100vh-360px)] sm:overflow-y-auto sm:pr-1">
        {rooms.map((room, index) => {
          const playerCount = room.playerCount;
          const maxPlayers = room.maxPlayers;
          const isFull = playerCount >= maxPlayers;
          const isPlaying = room.isPlaying;

          return (
            <div
              key={`${room.source}:${room.id || `room-${index}`}`}
              data-room-card
              data-room-backend={room.source}
              className="game-panel min-h-16 !rounded-2xl p-3 transition-colors hover:!border-[#c58d58]"
            >
              <div className="flex justify-between items-center gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <h3 className="truncate text-sm font-black text-[#3d352d]">{room.name}</h3>
                    {isPlaying ? (
                      <span className="shrink-0 rounded-full border border-[#d46f5e] bg-[#fff0eb] px-2 py-0.5 text-[11px] font-black text-[#8a3a2c]">
                        게임중
                      </span>
                    ) : (
                      <span className="shrink-0 rounded-full border border-[#72b86b] bg-[#eff9e9] px-2 py-0.5 text-[11px] font-black text-[#315f2d]">
                        대기중
                      </span>
                    )}
                  </div>
                  <div className="mt-1 flex items-center gap-2 text-[11px] font-semibold text-[#74685c]">
                    <span className={playerCount > 0 ? 'text-[#795d12]' : ''}>
                      👥 {playerCount} / {maxPlayers}
                    </span>
                    <span>
                      {new Date(room.createdAt).toLocaleString(undefined, {
                        month: 'short',
                        day: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit'
                      })}
                    </span>
                  </div>
                </div>

                <button
                  onClick={() => handleJoinRoom(room)}
                  disabled={joining === room.id || (isFull && !isPlaying && !room.isMember)}
                  className={`min-h-11 shrink-0 px-4 py-2 text-xs ${
                    joining === room.id || (isFull && !isPlaying && !room.isMember) ? 'btn-sub' : 'btn-game'
                  }`}
                >
                  {joining === room.id
                    ? '입장 중...'
                      : room.isMember
                        ? '계속하기'
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
