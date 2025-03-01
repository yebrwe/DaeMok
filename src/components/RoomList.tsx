'use client';

import { useState, useEffect } from 'react';
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
    return <div className="text-center py-4">방 목록을 불러오는 중...</div>;
  }

  if (!rooms || rooms.length === 0) {
    return <div className="text-center py-4">현재 생성된 방이 없습니다.</div>;
  }

  return (
    <div>
      {joinError && (
        <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded mb-4">
          {joinError}
        </div>
      )}
      
      <div className="space-y-3">
        {rooms.map((room, index) => (
          <div 
            key={room.id || `room-${index}`} 
            className="border rounded-lg p-3 shadow-sm hover:shadow-md transition-shadow bg-white"
          >
            <div className="flex justify-between items-start">
              <div>
                <h3 className="text-lg font-medium truncate">{room.name}</h3>
                <div className="flex items-center gap-2 mt-1">
                  <div className="text-xs bg-blue-100 text-blue-800 rounded-full px-2 py-0.5">
                    {room.players?.length || 0} / {room.maxPlayers || 2} 명
                  </div>
                  <div className="text-xs text-gray-500">
                    {new Date((room as any).createdAt || Date.now()).toLocaleString(undefined, {
                      month: 'short',
                      day: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit'
                    })}
                  </div>
                </div>
              </div>
              
              <button
                onClick={() => handleJoinRoom(room.id)}
                disabled={joining === room.id || (room.players?.length >= room.maxPlayers)}
                className={`px-3 py-1.5 rounded text-white text-sm ${
                  joining === room.id ? 'bg-gray-400' : 
                  room.players?.length >= room.maxPlayers ? 'bg-red-400 cursor-not-allowed' : 'bg-blue-500 hover:bg-blue-600'
                }`}
              >
                {joining === room.id ? '참가 중...' : 
                 room.players?.length >= room.maxPlayers ? '방 가득 참' : '참가하기'}
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default RoomList; 