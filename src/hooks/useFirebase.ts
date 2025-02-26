'use client';

import { useState, useEffect } from 'react';
import { 
  signInWithGoogle,
  signOutUser,
  getCurrentUser,
  getRooms, 
  getGameState
} from '@/lib/firebase';
import { Room, GameState, UserProfile } from '@/types/game';
import { getDatabase, ref, onValue } from 'firebase/database';

// 사용자 인증 및 ID 관리
export const useAuth = () => {
  const [userId, setUserId] = useState<string | null>(null);
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isLoggedIn, setIsLoggedIn] = useState<boolean>(false);
  
  useEffect(() => {
    const initAuth = async () => {
      setIsLoading(true);
      
      // 현재 로그인된 사용자 확인
      const currentUser = getCurrentUser();
      
      if (currentUser) {
        // 이미 로그인된 사용자가 있으면 프로필 정보 설정
        setUserId(currentUser.uid);
        setUserProfile({
          uid: currentUser.uid,
          displayName: currentUser.displayName,
          email: currentUser.email,
          photoURL: currentUser.photoURL
        });
        setIsLoggedIn(true);
        setIsLoading(false);
        return;
      }
      
      // 로그인된 사용자가 없으면 상태 업데이트
      setUserId(null);
      setUserProfile(null);
      setIsLoggedIn(false);
      setIsLoading(false);
    };
    
    initAuth();
  }, []);
  
  // 구글 로그인 함수
  const loginWithGoogle = async () => {
    setIsLoading(true);
    const userInfo = await signInWithGoogle();
    
    if (userInfo) {
      localStorage.setItem('daemok_user_id', userInfo.uid);
      setUserId(userInfo.uid);
      setUserProfile(userInfo);
      setIsLoggedIn(true);
    }
    
    setIsLoading(false);
    return !!userInfo;
  };
  
  // 로그아웃 함수
  const logout = async () => {
    setIsLoading(true);
    const success = await signOutUser();
    
    if (success) {
      localStorage.removeItem('daemok_user_id');
      setUserId(null);
      setUserProfile(null);
      setIsLoggedIn(false);
    }
    
    setIsLoading(false);
    return success;
  };
  
  return { userId, userProfile, isLoading, isLoggedIn, loginWithGoogle, logout };
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
    const eventsRef = ref(database, `rooms/${roomId}/events`);
    
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
    
    // 방 이벤트 감지 (선택 사항)
    const eventsUnsubscribe = onValue(eventsRef, (snapshot) => {
      if (snapshot.exists()) {
        const events = snapshot.val();
        const eventsList = Object.values(events);
        
        // 가장 최근 이벤트 확인
        const lastEvent = eventsList[eventsList.length - 1];
        if (lastEvent && lastEvent.type === 'PLAYER_LEFT') {
          console.log('플레이어가 방을 나갔습니다:', lastEvent.displayName);
          // 필요한 경우 UI에 알림 표시
        }
      }
    });
    
    return () => {
      unsubscribe();
      eventsUnsubscribe();
    };
  }, [roomId]);

  return { gameState, isLoading, error };
} 