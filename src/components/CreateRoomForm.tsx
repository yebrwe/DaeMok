'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createRoom } from '@/lib/firebase';

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
    
    try {
      setIsCreating(true);
      setError(null);
      
      console.log('방 생성 시도:', { roomName, maxPlayers });
      const roomId = await createRoom(roomName, userId, maxPlayers);
      
      if (roomId) {
        console.log('방 생성 성공:', roomId);
        router.push(`/rooms/${roomId}`);
      } else {
        console.error('방 생성 실패');
        setError('방을 생성할 수 없습니다.');
      }
    } catch (error) {
      console.error('방 생성 오류:', error);
      setError('방 생성 중 오류가 발생했습니다.');
    } finally {
      setIsCreating(false);
    }
  };

  return (
    <div className="bg-white shadow-md rounded-lg p-4">
      {!isFormOpen ? (
        <button
          onClick={() => setIsFormOpen(true)}
          className="w-full py-3 bg-green-500 text-white rounded-lg hover:bg-green-600 transition"
        >
          새 게임 방 만들기
        </button>
      ) : (
        <>
          <h2 className="text-xl font-semibold mb-4">새 게임 방 만들기</h2>
          
          {error && (
            <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded mb-4">
              {error}
            </div>
          )}
          
          <form onSubmit={handleCreateRoom}>
            <div className="mb-4">
              <label htmlFor="roomName" className="block text-sm font-medium text-gray-700 mb-1">
                방 이름
              </label>
              <input
                type="text"
                id="roomName"
                value={roomName}
                onChange={(e) => setRoomName(e.target.value)}
                placeholder="방 이름을 입력하세요"
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                disabled={isCreating}
              />
            </div>
            
            <div className="mb-4">
              <label htmlFor="maxPlayers" className="block text-sm font-medium text-gray-700 mb-1">
                최대 플레이어 수
              </label>
              <select
                id="maxPlayers"
                value={maxPlayers}
                onChange={(e) => setMaxPlayers(Number(e.target.value))}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                disabled={isCreating}
              >
                <option value={2}>2명</option>
                <option value={3}>3명</option>
                <option value={4}>4명</option>
              </select>
            </div>
            
            <div className="flex space-x-2">
              <button
                type="submit"
                disabled={isCreating}
                className={`flex-1 py-2 rounded-md ${
                  isCreating ? 'bg-gray-400' : 'bg-blue-500 hover:bg-blue-600'
                } text-white transition`}
              >
                {isCreating ? '생성 중...' : '방 만들기'}
              </button>
              
              <button
                type="button"
                onClick={() => setIsFormOpen(false)}
                disabled={isCreating}
                className="flex-1 py-2 bg-gray-200 text-gray-800 rounded-md hover:bg-gray-300 transition"
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