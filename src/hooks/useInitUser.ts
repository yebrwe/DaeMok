'use client';

import { useEffect, useState } from 'react';
import { getAuth, onAuthStateChanged } from 'firebase/auth';
import { useRouter } from 'next/navigation';
import { firebaseInitPromise } from '../lib/firebase';

export function useInitUser(redirectTo: string = '', redirectIfFound: boolean = false) {
  const [user, setUser] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const router = useRouter();

  useEffect(() => {
    const initializeUser = async () => {
      try {
        await firebaseInitPromise;
        const auth = getAuth();
        
        return onAuthStateChanged(auth, (authUser) => {
          setLoading(false);
          
          if (authUser) {
            // 사용자가 인증되어 있는 경우
            setUser(authUser);
            
            if (redirectIfFound && redirectTo) {
              router.push(redirectTo);
            }
          } else {
            // 사용자가 인증되어 있지 않은 경우
            setUser(null);
            
            if (!redirectIfFound && redirectTo) {
              router.push(redirectTo);
            }
          }
        });
      } catch (error) {
        console.error('사용자 초기화 오류:', error);
        setLoading(false);
        return () => {};
      }
    };

    const unsubscribe = initializeUser();
    
    return () => {
      unsubscribe.then(fn => {
        if (fn) fn();
      });
    };
  }, [redirectIfFound, redirectTo, router]);

  return { user, loading };
} 