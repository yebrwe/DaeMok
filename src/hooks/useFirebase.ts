'use client';

import { useState, useEffect } from 'react';
import { 
  signInAnonymousUser, 
  getRooms, 
  getGameState, 
  generateUserId as generateFirebaseUserId
} from '@/lib/firebase';
import { Room, GameState } from '@/types/game';

// 사용자 인증 및 ID 관리
export const useAuth = () => {
  const [userId, setUserId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  
  useEffect(() => {
    const initAuth = async () => {
      setIsLoading(true);
      
      // 로컬 스토리지에서 사용자 ID 확인
      let storedUserId = localStorage.getItem('daemok_user_id');
      
      if (!storedUserId) {
        // 익명 로그인 또는 ID 생성
        storedUserId = await signInAnonymousUser() || generateFirebaseUserId();
        localStorage.setItem('daemok_user_id', storedUserId);
      }
      
      setUserId(storedUserId);
      setIsLoading(false);
    };
    
    initAuth();
  }, []);
  
  return { userId, isLoading };
};

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
export const useGameState = (roomId: string) => {
  const [gameState, setGameState] = useState<GameState | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  
  useEffect(() => {
    if (!roomId) {
      setIsLoading(false);
      return;
    }
    
    setIsLoading(true);
    
    // 게임 상태 구독
    const unsubscribe = getGameState(roomId, (state) => {
      setGameState(state);
      setIsLoading(false);
    });
    
    return () => {
      unsubscribe();
    };
  }, [roomId]);
  
  return { gameState, isLoading };
}; 