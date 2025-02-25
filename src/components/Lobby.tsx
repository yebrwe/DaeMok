'use client';

import React, { useState, useEffect } from 'react';
import { Room } from '@/types/game';
import { useRouter } from 'next/navigation';
import { useRooms } from '@/hooks/useFirebase';
import { createRoom, joinRoom } from '@/lib/firebase';

interface LobbyProps {
  userId: string;
}

const Lobby: React.FC<LobbyProps> = ({ userId }) => {
  const { rooms, isLoading } = useRooms();
  const [newRoomName, setNewRoomName] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  // 방 참가 함수
  const handleJoinRoom = async (roomId: string) => {
    try {
      setError(null);
      const success = await joinRoom(roomId, userId);
      
      if (success) {
        router.push(`/game/${roomId}`);
      } else {
        setError('방에 참가할 수 없습니다.');
      }
    } catch (err) {
      console.error('방 참가 오류:', err);
      setError('방 참가 중 오류가 발생했습니다.');
    }
  };

  // 방 생성 함수
  const handleCreateRoom = async () => {
    if (newRoomName.trim() === '') return;
    
    try {
      setError(null);
      const roomId = await createRoom(newRoomName, userId);
      router.push(`/game/${roomId}`);
    } catch (err) {
      console.error('방 생성 오류:', err);
      setError('방 생성 중 오류가 발생했습니다.');
    } finally {
      setNewRoomName('');
      setIsCreating(false);
    }
  };

  return (
    <div className="w-full max-w-4xl mx-auto p-4">
      <h1 className="text-3xl font-bold mb-6 text-center">게임 로비</h1>
      
      <div className="flex justify-between mb-6">
        <h2 className="text-xl font-semibold">게임 방 목록</h2>
        <button
          className="bg-blue-500 text-white px-4 py-2 rounded hover:bg-blue-600 transition"
          onClick={() => setIsCreating(true)}
        >
          방 만들기
        </button>
      </div>
      
      {error && (
        <div className="mb-4 p-2 bg-red-100 text-red-700 rounded">
          {error}
        </div>
      )}
      
      {isCreating && (
        <div className="mb-6 p-4 bg-gray-100 rounded-lg">
          <h3 className="text-lg font-medium mb-2">새 방 만들기</h3>
          <div className="flex gap-2">
            <input
              type="text"
              className="flex-1 px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="방 이름 입력"
              value={newRoomName}
              onChange={(e) => setNewRoomName(e.target.value)}
            />
            <button
              className="bg-green-500 text-white px-4 py-2 rounded hover:bg-green-600 transition"
              onClick={handleCreateRoom}
            >
              만들기
            </button>
            <button
              className="bg-gray-500 text-white px-4 py-2 rounded hover:bg-gray-600 transition"
              onClick={() => setIsCreating(false)}
            >
              취소
            </button>
          </div>
        </div>
      )}
      
      {isLoading ? (
        <div className="flex justify-center py-8">
          <div className="w-12 h-12 border-4 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
        </div>
      ) : rooms.length === 0 ? (
        <div className="text-center py-8 bg-gray-50 rounded-lg">
          <p className="text-gray-500">게임 방이 없습니다. 새로운 방을 만들어보세요!</p>
        </div>
      ) : (
        <div className="grid gap-4 grid-cols-1 md:grid-cols-2">
          {rooms.map((room) => (
            <div
              key={room.id}
              className="border border-gray-200 rounded-lg p-4 hover:shadow-md transition"
            >
              <div className="flex justify-between items-center mb-2">
                <h3 className="text-lg font-medium">{room.name}</h3>
                <span className="text-sm text-gray-500">
                  {room.players?.length || 0}/{room.maxPlayers}
                </span>
              </div>
              
              <div className="flex justify-between items-center mt-4">
                <span className="text-sm text-gray-500">
                  {room.gameState ? '게임 중' : '대기 중'}
                </span>
                <button
                  className={`px-4 py-1 rounded text-white ${
                    room.players?.length >= room.maxPlayers || room.gameState?.phase !== 'setup'
                      ? 'bg-gray-400 cursor-not-allowed'
                      : 'bg-blue-500 hover:bg-blue-600'
                  }`}
                  onClick={() => handleJoinRoom(room.id)}
                  disabled={room.players?.length >= room.maxPlayers || room.gameState?.phase !== 'setup'}
                >
                  참가하기
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default Lobby; 