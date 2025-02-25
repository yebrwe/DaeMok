'use client';

import React, { useState, useRef } from 'react';
import Link from 'next/link';
import GameSetup from '@/components/GameSetup';
import GamePlay from '@/components/GamePlay';
import { GameMap } from '@/types/game';

export default function PracticePage() {
  const [map, setMap] = useState<GameMap | null>(null);
  const [gameComplete, setGameComplete] = useState<boolean>(false);
  const [moves, setMoves] = useState<number>(0);
  // 재시작 기능을 위한 key 추가
  const [gameKey, setGameKey] = useState<number>(0);
  
  // 맵 설정 완료 처리
  const handleMapComplete = (completedMap: GameMap) => {
    setMap(completedMap);
    setGameComplete(false);
  };
  
  // 게임 완료 처리
  const handleGameComplete = (moveCount: number) => {
    setGameComplete(true);
    setMoves(moveCount);
  };
  
  // 새 게임 시작 (새 맵 생성)
  const handleNewGame = () => {
    setMap(null);
    setGameComplete(false);
    setMoves(0);
    setGameKey(0);
  };
  
  // 같은 맵에서 다시 시작
  const handleRestartSameMap = () => {
    setGameComplete(false);
    setMoves(0);
    // key를 변경하여 컴포넌트 강제 리렌더링
    setGameKey(prev => prev + 1);
  };
  
  return (
    <div className="container mx-auto p-4">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold">연습 모드</h1>
        <Link 
          href="/"
          className="px-4 py-2 bg-gray-200 rounded hover:bg-gray-300 transition"
        >
          홈으로
        </Link>
      </div>
      
      {!map ? (
        // 맵 설정 단계
        <div>
          <div className="bg-blue-50 p-4 rounded-lg mb-6">
            <h2 className="text-lg font-semibold mb-2">맵 설정 방법</h2>
            <ol className="list-decimal pl-5 space-y-1">
              <li>시작점을 선택하세요 (녹색)</li>
              <li>도착점을 선택하세요 (빨간색)</li>
              <li>장애물을 배치하세요 (노란선, 최대 15개)</li>
              <li>시작점에서 도착점까지의 경로가 존재하는지 확인하세요</li>
            </ol>
          </div>
          
          <GameSetup onMapComplete={handleMapComplete} />
        </div>
      ) : gameComplete ? (
        // 게임 완료 화면
        <div className="text-center py-8">
          <h2 className="text-3xl font-bold text-green-600 mb-4">
            축하합니다!
          </h2>
          <p className="text-xl mb-6">
            총 <span className="font-bold">{moves}</span>턴 만에 목적지에 도달했습니다.
          </p>
          <div className="flex gap-4 justify-center">
            <button
              className="px-6 py-3 bg-green-500 text-white rounded-lg hover:bg-green-600 transition"
              onClick={handleRestartSameMap}
            >
              같은 맵에서 다시 시작
            </button>
            <button
              className="px-6 py-3 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition"
              onClick={handleNewGame}
            >
              새 맵 만들기
            </button>
            <Link
              href="/"
              className="px-6 py-3 bg-gray-500 text-white rounded-lg hover:bg-gray-600 transition"
            >
              메인으로
            </Link>
          </div>
        </div>
      ) : (
        // 게임 플레이 화면
        <div>
          <div className="bg-blue-50 p-4 rounded-lg mb-6">
            <h2 className="text-lg font-semibold mb-2">게임 방법</h2>
            <ul className="list-disc pl-5 space-y-1">
              <li>시작점(녹색)에서 도착점(빨간색)까지 이동하세요</li>
              <li>화살표 버튼이나 키보드 방향키를 사용해 이동할 수 있습니다</li>
              <li>장애물(노란선)은 보이지 않지만 지나갈 수 없습니다</li>
            </ul>
          </div>
          
          <GamePlay 
            key={gameKey}
            map={map} 
            onGameComplete={handleGameComplete} 
            userId="practice-user" 
            roomId="practice-room" 
            currentTurn="practice-user" 
          />
        </div>
      )}
    </div>
  );
} 