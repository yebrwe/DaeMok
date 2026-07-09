'use client';

import { useState, useEffect } from 'react';
import { getRooms } from '@/lib/firebase';
import { Room, GameState } from '@/types/game';
import { getDatabase, ref, onValue } from 'firebase/database';

// 방 목록 관리
export const useRooms = () => {
  const [rooms, setRooms] = useState<Room[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);

  useEffect(() => {
    setIsLoading(true);

    // 방 목록 구독
    const unsubscribe = getRooms((roomsList) => {
      setRooms(roomsList);
      setIsLoading(false);
    });

    return () => {
      unsubscribe();
    };
  }, []);

  return { rooms, isLoading };
};

// 게임 상태 관리
export function useGameState(roomId: string) {
  const [gameState, setGameState] = useState<GameState | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!roomId) {
      setIsLoading(false);
      return;
    }

    const database = getDatabase();
    const gameStateRef = ref(database, `rooms/${roomId}/gameState`);

    // 게임 상태 변경 감지
    const unsubscribe = onValue(gameStateRef, (snapshot) => {
      setIsLoading(false);

      if (snapshot.exists()) {
        setGameState(snapshot.val());
      } else {
        setGameState(null);
      }
    }, (error) => {
      console.error('게임 상태 구독 오류:', error);
      setError('게임 상태를 불러올 수 없습니다.');
      setIsLoading(false);
    });

    return () => {
      unsubscribe();
    };
  }, [roomId]);

  return { gameState, isLoading, error };
}
