'use client';

import { useState, useEffect } from 'react';
import { User, Unsubscribe, onAuthStateChanged, onIdTokenChanged } from 'firebase/auth';
import { getFirebaseAuth, firebaseInitPromise } from '@/lib/firebase';
import { getDatabase, ref, update, serverTimestamp } from 'firebase/database';

export function useAuth() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [authError, setAuthError] = useState<string | null>(null);

  useEffect(() => {
    let unsubscribe: Unsubscribe;
    let tokenRefreshInterval: NodeJS.Timeout;
    
    const initAuth = async () => {
      try {
        // Firebase 초기화 및 auth 객체 가져오기
        await firebaseInitPromise;
        const auth = getFirebaseAuth();
        const database = getDatabase();
        
        // 인증 상태 변경 감지 (unsubscribe 변수에 할당)
        unsubscribe = onAuthStateChanged(auth, (user) => {
          console.log('인증 상태 변경:', user ? `${user.displayName}(${user.uid})` : '로그아웃');
          setUser(user);
          setLoading(false);
          
          // 인증 토큰 주기적 리프레시 설정
          if (user) {
            // 1시간마다 토큰 리프레시 (토큰 만료 방지)
            tokenRefreshInterval = setInterval(async () => {
              try {
                const currentUser = auth.currentUser;
                if (currentUser) {
                  await currentUser.getIdToken(true);
                  console.log('인증 토큰 리프레시 성공');
                  
                  // Firebase 데이터베이스에 인증 상태 직접 기록
                  if (database) {
                    const userStatusRef = ref(database, `userStatus/${currentUser.uid}`);
                    update(userStatusRef, {
                      lastTokenRefresh: serverTimestamp(),
                      authValid: true
                    });
                  }
                }
              } catch (error) {
                console.error('토큰 리프레시 오류:', error);
              }
            }, 55 * 60 * 1000); // 55분마다 실행 (토큰 만료 시간보다 약간 일찍)
          }
        }, (error) => {
          console.error('인증 상태 감지 중 오류:', error);
          setAuthError(error.message);
          setLoading(false);
        });
        
        // 토큰 변경 감지 (ID 토큰 변경 시마다 호출)
        const tokenUnsubscribe = onIdTokenChanged(auth, async (user) => {
          if (user) {
            // 토큰이 변경되었을 때 처리
            console.log('ID 토큰 변경 감지');
            // Firebase 데이터베이스에 토큰 변경 상태 기록
            if (database) {
              const userStatusRef = ref(database, `userStatus/${user.uid}`);
              update(userStatusRef, {
                tokenChanged: serverTimestamp()
              });
            }
          }
        });
      } catch (error) {
        console.error('인증 초기화 중 오류:', error);
        setAuthError(error instanceof Error ? error.message : '인증 초기화 오류');
        setLoading(false);
      }
    };

    // 인증 초기화 시작
    initAuth();
    
    // 클린업 함수
    return () => {
      if (unsubscribe) {
        unsubscribe();
      }
      if (tokenRefreshInterval) {
        clearInterval(tokenRefreshInterval);
      }
    };
  }, []);

  return { user, loading, authError };
} 