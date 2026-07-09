'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/hooks/useAuth';
import { signInWithGoogle } from '@/lib/firebase';
import { getDatabase, ref, update, serverTimestamp } from 'firebase/database';

export default function LoginPage() {
  const [isSigningIn, setIsSigningIn] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();
  const { user, loading } = useAuth();

  // 이미 로그인된 사용자는 방 목록 페이지로 리디렉션
  useEffect(() => {
    if (!loading && user) {
      router.push('/rooms');
    }
  }, [user, loading, router]);

  const handleGoogleLogin = async () => {
    if (isSigningIn) return;

    setError(null);
    setIsSigningIn(true);

    try {
      const userInfo = await signInWithGoogle();

      if (!userInfo) {
        setError('로그인에 실패했습니다. 팝업 차단 여부를 확인하고 다시 시도해주세요.');
        return;
      }

      // 사용자 프로필 정보 저장 (있으면 갱신)
      try {
        const database = getDatabase();
        await update(ref(database, `users/${userInfo.uid}`), {
          displayName: userInfo.displayName || '익명 사용자',
          email: userInfo.email || null,
          photoURL: userInfo.photoURL || null,
          lastLogin: serverTimestamp(),
        });
      } catch (dbError) {
        // 프로필 저장 실패는 로그인 자체를 막지 않음
        console.error('사용자 프로필 저장 오류:', dbError);
      }

      router.push('/rooms');
    } catch (err) {
      console.error('구글 로그인 오류:', err);
      setError('로그인 중 오류가 발생했습니다. 다시 시도해주세요.');
    } finally {
      setIsSigningIn(false);
    }
  };

  // 로딩 중에는 로딩 화면 표시
  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="text-center">
          <div className="w-12 h-12 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto"></div>
          <p className="mt-4">로딩 중...</p>
        </div>
      </div>
    );
  }

  // 이미 로그인된 경우 빈 화면 표시 (리디렉션 처리 중)
  if (user) {
    return <div className="h-screen"></div>;
  }

  return (
    <div className="flex items-center justify-center min-h-screen bg-gray-100">
      <div className="w-full max-w-md p-8 bg-white rounded-lg shadow-md text-center">
        <h1 className="text-3xl font-bold mb-2">대목</h1>
        <p className="text-sm text-gray-500 mb-8">
          상대가 숨겨둔 벽을 피해 더 적은 턴으로 골인하세요
        </p>

        {error && (
          <div className="mb-4 p-3 bg-red-100 text-red-700 rounded text-sm">
            {error}
          </div>
        )}

        <button
          onClick={handleGoogleLogin}
          disabled={isSigningIn}
          className="w-full py-3 px-4 flex items-center justify-center gap-3 border border-gray-300 rounded-lg bg-white hover:bg-gray-50 transition-colors disabled:opacity-60 shadow-sm"
        >
          {/* Google 로고 */}
          <svg width="20" height="20" viewBox="0 0 48 48" aria-hidden="true">
            <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
            <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
            <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
            <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
          </svg>
          <span className="text-sm font-medium text-gray-700">
            {isSigningIn ? '로그인 중...' : 'Google 계정으로 시작하기'}
          </span>
        </button>

        <p className="mt-6 text-xs text-gray-400">
          Google 계정으로 간편하게 로그인하고 바로 게임을 시작하세요.
        </p>
      </div>
    </div>
  );
}
