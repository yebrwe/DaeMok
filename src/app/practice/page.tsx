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
    <div className="container mx-auto p-3 sm:p-4 max-w-3xl">
      {/* 헤더 */}
      <header className="game-panel !rounded-xl px-4 py-3 mb-4 flex justify-between items-center">
        <div className="flex items-center gap-2">
          <span className="text-2xl">🎯</span>
          <div className="leading-tight">
            <h1 className="text-lg font-black text-amber-300">연습 모드</h1>
            <p className="text-[10px] text-slate-500">직접 만든 맵에서 혼자 길찾기 연습</p>
          </div>
        </div>
        <Link href="/rooms" className="btn-sub px-3 py-1.5 text-xs">
          ← 대기실로
        </Link>
      </header>

      {!map ? (
        // 맵 설정 단계
        <div>
          <div className="game-panel !rounded-xl px-4 py-3 mb-4 text-xs text-slate-300">
            <h2 className="text-sm font-bold mb-1.5 text-slate-200">🗺️ 맵 설정 방법</h2>
            <ol className="list-decimal pl-5 space-y-0.5 text-slate-400">
              <li>시작점을 선택하세요 <span className="text-green-400">(녹색)</span></li>
              <li>도착점을 선택하세요 <span className="text-red-400">(빨간색)</span></li>
              <li>벽을 배치하세요 <span className="text-amber-300">(노란선, 최대 15개)</span></li>
              <li>시작점에서 도착점까지의 경로가 존재해야 완료할 수 있습니다</li>
            </ol>
          </div>

          <GameSetup onMapComplete={handleMapComplete} />
        </div>
      ) : gameComplete ? (
        // 게임 완료 화면
        <div className="text-center py-10">
          <div className="game-panel inline-block px-12 py-8">
            <div className="text-5xl mb-3">🎉</div>
            <h2 className="text-2xl font-black text-green-400 mb-2">축하합니다!</h2>
            <p className="text-sm text-slate-300 mb-6">
              총 <span className="font-black text-amber-300 text-lg">{moves}</span>턴 만에 목적지에 도달했습니다.
            </p>
            <div className="flex flex-wrap gap-2 justify-center">
              <button
                className="btn-game px-5 py-2.5 text-sm"
                onClick={handleRestartSameMap}
              >
                같은 맵에서 다시 시작
              </button>
              <button
                className="btn-sub px-5 py-2.5 text-sm"
                onClick={handleNewGame}
              >
                새 맵 만들기
              </button>
              <Link
                href="/rooms"
                className="btn-sub px-5 py-2.5 text-sm inline-flex items-center"
              >
                대기실로
              </Link>
            </div>
          </div>
        </div>
      ) : (
        // 게임 플레이 화면
        <div>
          <div className="game-panel !rounded-xl px-4 py-2.5 mb-3 text-[11px] text-slate-400 flex flex-wrap gap-x-4 gap-y-1 justify-center">
            <span>🏁 시작(녹색)에서 도착(깃발)까지 이동</span>
            <span>⌨️ 방향키 또는 버튼으로 이동</span>
            <span>🧱 벽은 보이지 않지만 부딪히면 턴 소모</span>
          </div>

          <GamePlay
            key={gameKey}
            map={map}
            onGameComplete={handleGameComplete}
            userId="practice-user"
            roomId="practice-room"
            isPractice
          />

          <div className="flex justify-center mt-3">
            <button className="btn-sub px-4 py-1.5 text-xs" onClick={handleNewGame}>
              새 맵 만들기
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
