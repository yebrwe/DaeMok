'use client';

import React, { useState } from 'react';
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
    <div className="fixed inset-0 overflow-hidden bg-slate-950">
      {/* 게임 스테이지 (헤더 아래 영역) */}
      <div className="absolute inset-x-0 bottom-0 top-[60px]">
        {!map ? (
          <GameSetup onMapComplete={handleMapComplete} />
        ) : (
          <GamePlay
            key={gameKey}
            map={map}
            onGameComplete={handleGameComplete}
            userId="practice-user"
            roomId="practice-room"
            isPractice
          />
        )}
      </div>

      {/* 상단 헤더 */}
      <header className="absolute top-0 inset-x-0 z-30 px-2 pt-2 flex justify-center pointer-events-none">
        <div className="pointer-events-auto game-panel !rounded-xl px-3 py-1.5 w-full max-w-3xl flex justify-between items-center">
          <div className="flex items-center gap-2">
            <span className="text-lg">🎯</span>
            <div className="leading-tight">
              <h1 className="text-sm font-black text-amber-300">연습 모드</h1>
              <p className="text-[9px] text-slate-500">직접 만든 맵에서 혼자 길찾기 연습</p>
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            {map && (
              <button className="btn-sub px-2.5 py-1 text-[11px]" onClick={handleNewGame}>
                새 맵 만들기
              </button>
            )}
            <Link href="/rooms" className="btn-sub px-2.5 py-1 text-[11px] inline-flex items-center">
              ← 대기실로
            </Link>
          </div>
        </div>
      </header>

      {/* 완주 축하 모달 */}
      {map && gameComplete && (
        <div className="absolute inset-0 z-40 flex items-center justify-center pointer-events-none">
          <div className="pointer-events-auto game-panel !rounded-2xl px-12 py-7 text-center shadow-2xl !border-green-400/50">
            <div className="text-5xl mb-3">🎉</div>
            <h2 className="text-2xl font-black text-green-400 mb-2">축하합니다!</h2>
            <p className="text-sm text-slate-300 mb-5">
              총 <span className="font-black text-amber-300 text-lg">{moves}</span>턴 만에 목적지에 도달했습니다.
            </p>
            <div className="flex flex-wrap gap-2 justify-center">
              <button className="btn-game px-5 py-2 text-sm" onClick={handleRestartSameMap}>
                같은 맵에서 다시 시작
              </button>
              <button className="btn-sub px-5 py-2 text-sm" onClick={handleNewGame}>
                새 맵 만들기
              </button>
              <Link href="/rooms" className="btn-sub px-5 py-2 text-sm inline-flex items-center">
                대기실로
              </Link>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
