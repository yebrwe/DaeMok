'use client';

import React from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/hooks/useFirebase';

export default function Home() {
  const { userId, isLoading } = useAuth();
  const router = useRouter();
  
  // 로비로 이동
  const handleJoinLobby = () => {
    router.push('/lobby');
  };
  
  // 연습 게임 시작
  const handlePracticeGame = () => {
    router.push('/practice');
  };
  
  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-4 bg-gradient-to-b from-blue-50 to-white">
      <div className="max-w-3xl w-full mx-auto px-4 py-8 bg-white rounded-lg shadow-lg">
        <div className="text-center">
          <h1 className="text-5xl font-bold text-blue-600 mb-6">대목</h1>
          <p className="text-xl text-gray-700 mb-8">전략적 경로 찾기 게임</p>
          
          {isLoading ? (
            <div className="text-sm text-gray-500 mb-8 flex items-center justify-center">
              <span className="mr-2">로그인 중...</span>
              <div className="w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
            </div>
          ) : userId ? (
            <div className="text-sm text-gray-500 mb-8">
              사용자 ID: {userId}
            </div>
          ) : null}
          
          <div className="flex flex-col gap-4 max-w-md mx-auto">
            <button
              onClick={handleJoinLobby}
              className="bg-blue-600 text-white font-bold py-3 px-6 rounded-lg hover:bg-blue-700 transition duration-300 shadow-md"
              disabled={isLoading}
            >
              게임 로비 입장
            </button>
            
            <button
              onClick={handlePracticeGame}
              className="bg-green-600 text-white font-bold py-3 px-6 rounded-lg hover:bg-green-700 transition duration-300 shadow-md"
              disabled={isLoading}
            >
              연습 게임 시작
            </button>
          </div>
          
          <div className="mt-12 grid grid-cols-1 md:grid-cols-2 gap-6 text-left">
            <div className="p-4 border border-gray-200 rounded-lg">
              <h2 className="text-xl font-semibold mb-2">게임 개요</h2>
              <p className="text-gray-700">
                '대목'은 전략적 사고와 경로 찾기를 즐길 수 있는 온라인 턴제 보드 게임입니다. 
                8x8 크기의 격자판에서 진행되며, 플레이어가 직접 시작점과 도착점을 설정하고 
                장애물을 배치하는 방식의 게임입니다.
              </p>
            </div>
            
            <div className="p-4 border border-gray-200 rounded-lg">
              <h2 className="text-xl font-semibold mb-2">게임 규칙</h2>
              <ul className="list-disc pl-5 text-gray-700 space-y-1">
                <li>각 플레이어는 맵을 직접 만들어 상대방에게 제공합니다.</li>
                <li>15개의 장애물(노란선)을 배치할 수 있습니다.</li>
                <li>턴마다 상하좌우로 한 칸씩 이동할 수 있습니다.</li>
                <li>먼저 도착점에 골인하는 플레이어가 승리합니다.</li>
              </ul>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
