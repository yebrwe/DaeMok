'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createRoom } from '@/lib/firebase';
import {
  buildMazeAuthorityCreateRoomCommand,
  createMazeAuthorityRoomId,
  invokeMazeAuthorityCommand,
} from '@/lib/mazeAuthorityClient';
import { mazeAuthorityNewRoomsEnabled } from '@/lib/mazeAuthorityRuntime';

interface CreateRoomFormProps {
  userId: string;
}

const CreateRoomForm: React.FC<CreateRoomFormProps> = ({ userId }) => {
  const [roomName, setRoomName] = useState('');
  const [maxPlayers, setMaxPlayers] = useState(2);
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const router = useRouter();

  const handleCreateRoom = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!roomName.trim()) {
      setError('방 이름을 입력해주세요.');
      return;
    }

    if (isCreating) {
      console.log('이미 방 생성이 진행 중입니다.');
      return;
    }

    try {
      setIsCreating(true);
      setError(null);

      console.log('방 생성 시도:', { roomName, maxPlayers });

      const useAuthority = mazeAuthorityNewRoomsEnabled();
      let roomId: string | null;
      if (useAuthority) {
        roomId = createMazeAuthorityRoomId();
        await invokeMazeAuthorityCommand(buildMazeAuthorityCreateRoomCommand({
          roomId,
          name: roomName.trim(),
          maxPlayers,
        }));
      } else {
        roomId = await createRoom(roomName, userId, maxPlayers);
      }

      if (roomId) {
        console.log('방 생성 성공:', roomId);
        localStorage.setItem('last_created_room', roomId);
        router.push(`/rooms/${roomId}`);
      } else {
        console.error('방 생성 실패');
        setError('방을 생성할 수 없습니다.');
      }
    } catch (error) {
      console.error('방 생성 오류:', error);
      setError(error instanceof Error ? error.message : '방 생성 중 오류가 발생했습니다.');
    } finally {
      setIsCreating(false);
    }
  };

  return (
    <div className="game-panel p-4">
      {!isFormOpen ? (
        <button
          type="button"
          onClick={() => setIsFormOpen(true)}
          className="btn-game flex min-h-11 w-full items-center justify-center gap-2 py-3 text-sm"
          aria-expanded={isFormOpen}
          aria-controls="maze-create-room-form"
        >
          <span className="text-base" aria-hidden="true">🧸</span>
          새 게임 방 만들기
        </button>
      ) : (
        <div id="maze-create-room-form">
          <h2 className="mb-3 flex items-center gap-1.5 text-sm font-black text-[#3d352d]">
            <span aria-hidden="true">🧸</span> 새 게임 방 만들기
          </h2>

          {error && (
            <div className="mb-3 rounded-xl border-2 border-[#b94646] bg-[#fff1ec] px-3 py-2 text-xs font-bold text-[#8a2e2e]" role="alert">
              {error}
            </div>
          )}

          <form onSubmit={handleCreateRoom} className="space-y-3">
            <div>
              <label htmlFor="roomName" className="mb-1 block text-xs font-bold text-[#5d5146]">
                방 이름
              </label>
              <input
                type="text"
                id="roomName"
                value={roomName}
                onChange={(e) => setRoomName(e.target.value)}
                placeholder="방 이름을 입력하세요"
                className="min-h-11 w-full rounded-xl border-2 border-[#cfa87a] bg-[#fffef9] px-3 py-2 text-sm font-semibold
                  text-[#3d352d] placeholder:text-[#8b7e70]
                  focus:border-transparent focus:outline-none focus:ring-2 focus:ring-[#1f708b]"
                disabled={isCreating}
                maxLength={30}
              />
            </div>

            <fieldset>
              <legend className="mb-1 block text-xs font-bold text-[#5d5146]">인원 (각자 다음 사람의 맵을 달려요)</legend>
              <div className="flex gap-1.5">
                {[2, 3, 4].map((n) => (
                  <button
                    key={n}
                    type="button"
                    className={`min-h-11 flex-1 rounded-xl border-2 py-2 text-sm font-black transition-colors ${
                      maxPlayers === n
                        ? 'border-[#5d4635] bg-[#f4c64f] text-[#3d352d]'
                        : 'border-[#cfa87a] bg-[#fffef9] text-[#5d5146] hover:border-[#5d4635]'
                    }`}
                    onClick={() => setMaxPlayers(n)}
                    disabled={isCreating}
                    aria-pressed={maxPlayers === n}
                  >
                    {n}명
                  </button>
                ))}
              </div>
            </fieldset>

            <div className="flex space-x-2 pt-1">
              <button
                type="submit"
                disabled={isCreating}
                className="btn-game min-h-11 flex-1 py-2 text-sm"
              >
                {isCreating ? '생성 중...' : '방 만들기'}
              </button>

              <button
                type="button"
                onClick={() => {
                  setIsFormOpen(false);
                  setError(null);
                }}
                disabled={isCreating}
                className="btn-sub min-h-11 flex-1 py-2 text-sm"
              >
                취소
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};

export default CreateRoomForm;
