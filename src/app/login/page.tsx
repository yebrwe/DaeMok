'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { getAuth, signInWithEmailAndPassword, createUserWithEmailAndPassword, updateProfile } from 'firebase/auth';
import { useAuth } from '@/hooks/useAuth';
import { getDatabase, ref, set, serverTimestamp } from 'firebase/database';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [isSignUp, setIsSignUp] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();
  const { user, loading } = useAuth();

  // 이미 로그인된 사용자는 방 목록 페이지로 리디렉션
  useEffect(() => {
    if (!loading && user) {
      router.push('/rooms');
    }
  }, [user, loading, router]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    try {
      const auth = getAuth();
      
      if (isSignUp) {
        // 회원가입 처리
        const userCredential = await createUserWithEmailAndPassword(auth, email, password);
        const user = userCredential.user;
        
        // 사용자 프로필 업데이트
        await updateProfile(user, {
          displayName: displayName || email.split('@')[0]
        });
        
        // 사용자 정보 데이터베이스에 저장
        const database = getDatabase();
        await set(ref(database, `users/${user.uid}`), {
          email: user.email,
          displayName: displayName || email.split('@')[0],
          createdAt: serverTimestamp()
        });
        
        console.log('회원가입 성공:', user);
        router.push('/rooms');
      } else {
        // 로그인 처리
        const userCredential = await signInWithEmailAndPassword(auth, email, password);
        console.log('로그인 성공:', userCredential.user);
        router.push('/rooms');
      }
    } catch (error: any) {
      console.error('인증 오류:', error);
      
      // 에러 메시지 설정
      if (error.code === 'auth/user-not-found' || error.code === 'auth/wrong-password') {
        setError('이메일 또는 비밀번호가 올바르지 않습니다.');
      } else if (error.code === 'auth/email-already-in-use') {
        setError('이미 사용 중인 이메일입니다.');
      } else if (error.code === 'auth/weak-password') {
        setError('비밀번호는 6자 이상이어야 합니다.');
      } else {
        setError('인증 중 오류가 발생했습니다. 다시 시도해주세요.');
      }
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
      <div className="w-full max-w-md p-8 bg-white rounded-lg shadow-md">
        <h1 className="text-2xl font-bold text-center mb-6">
          {isSignUp ? '회원가입' : '로그인'}
        </h1>
        
        {error && (
          <div className="mb-4 p-3 bg-red-100 text-red-700 rounded">
            {error}
          </div>
        )}
        
        <form onSubmit={handleSubmit}>
          {isSignUp && (
            <div className="mb-4">
              <label className="block text-gray-700 mb-2" htmlFor="displayName">
                닉네임
              </label>
              <input
                id="displayName"
                type="text"
                className="w-full px-3 py-2 border rounded"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="닉네임을 입력하세요"
              />
            </div>
          )}
          
          <div className="mb-4">
            <label className="block text-gray-700 mb-2" htmlFor="email">
              이메일
            </label>
            <input
              id="email"
              type="email"
              className="w-full px-3 py-2 border rounded"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              placeholder="이메일을 입력하세요"
            />
          </div>
          
          <div className="mb-6">
            <label className="block text-gray-700 mb-2" htmlFor="password">
              비밀번호
            </label>
            <input
              id="password"
              type="password"
              className="w-full px-3 py-2 border rounded"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              placeholder="비밀번호를 입력하세요"
            />
          </div>
          
          <div className="flex flex-col gap-4">
            <button
              type="submit"
              className="w-full py-2 px-4 bg-blue-500 text-white rounded hover:bg-blue-600 transition-colors"
            >
              {isSignUp ? '가입하기' : '로그인'}
            </button>
            
            <button
              type="button"
              className="w-full py-2 px-4 bg-gray-200 text-gray-700 rounded hover:bg-gray-300 transition-colors"
              onClick={() => setIsSignUp(!isSignUp)}
            >
              {isSignUp ? '이미 계정이 있으신가요? 로그인' : '계정이 없으신가요? 회원가입'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
} 