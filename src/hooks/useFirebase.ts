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