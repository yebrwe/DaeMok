'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createRoom } from '@/lib/firebase';

interface CreateRoomFormProps {
  userId: string;
}

const CreateRoomForm: React.FC<CreateRoomFormProps> = ({ userId }) => {
  const [roomName, setRoomName] = useState('');
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

      console.log('방 생성 시도:', { roomName, maxPlayers: 2 });

      const roomId = await createRoom(roomName, userId, 2);

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
          onClick={() => setIsFormOpen(true)}
          className="btn-game w-full py-3 text-sm flex items-center justify-center gap-2"
        >
          <span className="text-base">⚔️</span>
          새 게임 방 만들기
        </button>
      ) : (
        <>
          <h2 className="text-sm font-bold mb-3 text-slate-200 flex items-center gap-1.5">
            ⚔️ 새 게임 방 만들기
          </h2>

          {error && (
            <div className="bg-red-500/10 border border-red-500/40 text-red-300 px-3 py-2 rounded-xl mb-3 text-xs">
              {error}
            </div>
          )}

          <form onSubmit={handleCreateRoom} className="space-y-3">
            <div>
              <label htmlFor="roomName" className="block text-xs font-medium text-slate-400 mb-1">
                방 이름
              </label>
              <input
                type="text"
                id="roomName"
                value={roomName}
                onChange={(e) => setRoomName(e.target.value)}
                placeholder="방 이름을 입력하세요"
                className="w-full px-3 py-2 text-sm bg-slate-800/80 border border-slate-600/70 rounded-xl
                  text-slate-100 placeholder:text-slate-500
                  focus:outline-none focus:ring-2 focus:ring-amber-400/60 focus:border-transparent"
                disabled={isCreating}
                maxLength={30}
              />
            </div>

            <div className="flex space-x-2 pt-1">
              <button
                type="submit"
                disabled={isCreating}
                className="btn-game flex-1 py-2 text-sm"
              >
                {isCreating ? '생성 중...' : '방 만들기'}
              </button>

              <button
                type="button"
                onClick={() => setIsFormOpen(false)}
                disabled={isCreating}
                className="btn-sub flex-1 py-2 text-sm"
              >
                취소
              </button>
            </div>
          </form>
        </>
      )}
    </div>
  );
};

export default CreateRoomForm;
