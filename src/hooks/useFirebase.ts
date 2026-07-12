'use client';

import { useState, useEffect } from 'react';
import { getRooms } from '@/lib/firebase';
import { Room, GameMap, GameState } from '@/types/game';
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
    const mapsRef = ref(database, `rooms/${roomId}/maps`);
    let latestState: GameState | null = null;
    let latestMaps: Record<string, GameMap> | null = null;
    let stateLoaded = false;
    let mapsLoaded = false;

    const publish = () => {
      if (!stateLoaded || !mapsLoaded) return;
      setIsLoading(false);
      if (!latestState) {
        setGameState(null);
        return;
      }

      const persistentState = { ...latestState };
      delete persistentState.maps;
      setGameState({
        ...persistentState,
        ...(latestMaps && Object.keys(latestMaps).length > 0 ? { maps: latestMaps } : {}),
      });
    };

    const unsubscribeState = onValue(gameStateRef, (snapshot) => {
      stateLoaded = true;
      latestState = snapshot.exists() ? snapshot.val() : null;
      publish();
    }, (error) => {
      console.error('게임 상태 구독 오류:', error);
      setError('게임 상태를 불러올 수 없습니다.');
      setIsLoading(false);
    });

    const unsubscribeMaps = onValue(mapsRef, (snapshot) => {
      mapsLoaded = true;
      latestMaps = snapshot.exists() ? snapshot.val() : null;
      publish();
    }, (error) => {
      console.error('게임 맵 구독 오류:', error);
      setError('게임 맵을 불러올 수 없습니다.');
      setIsLoading(false);
    });

    return () => {
      unsubscribeState();
      unsubscribeMaps();
    };
  }, [roomId]);

  return { gameState, isLoading, error };
}
