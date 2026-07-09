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

      {/* 완주 축하 카드 - 보드(세리머니)가 계속 보이도록 하단에 컴팩트하게 표시 */}
      {map && gameComplete && (
        <div className="absolute inset-x-0 bottom-6 z-40 flex justify-center pointer-events-none px-3">
          <div className="pointer-events-auto game-panel !rounded-2xl px-4 py-3 text-center shadow-2xl !border-green-400/50 max-w-[94vw]">
            <div className="flex items-center justify-center gap-3 flex-wrap">
              <p className="text-sm font-black text-green-400 whitespace-nowrap">
                🎉 축하합니다! <span className="text-amber-300">{moves}</span>턴 완주
              </p>
              <div className="flex gap-1.5 flex-wrap justify-center">
                <button className="btn-game px-4 py-1.5 text-xs" onClick={handleRestartSameMap}>
                  같은 맵에서 다시 시작
                </button>
                <button className="btn-sub px-3 py-1.5 text-xs" onClick={handleNewGame}>
                  새 맵 만들기
                </button>
                <Link href="/rooms" className="btn-sub px-3 py-1.5 text-xs inline-flex items-center">
                  대기실로
                </Link>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
