'use client';

import React, { useCallback, useState } from 'react';
import Link from 'next/link';
import {
  Bot,
  ChevronLeft,
  Map,
  Pencil,
  RotateCcw,
  Route,
  Settings2,
  Swords,
  Trophy,
  Zap,
} from 'lucide-react';
import GameSetup from '@/components/GameSetup';
import PracticeBattle, { PracticeBattleResult } from '@/components/PracticeBattle';
import MazeShell from '@/components/maze/MazeShell';
import { GameMap } from '@/types/game';
import { createQuickPracticeMap, PRACTICE_USER_ID } from '@/lib/practiceBattle';

type PracticeStage = 'configure' | 'setup' | 'battle';
type PracticeMode = 'race' | 'mapTest';

export default function PracticePage() {
  const [stage, setStage] = useState<PracticeStage>('configure');
  const [mode, setMode] = useState<PracticeMode>('race');
  const [aiCount, setAiCount] = useState(3);
  const [playerMap, setPlayerMap] = useState<GameMap | null>(null);
  const [result, setResult] = useState<PracticeBattleResult | null>(null);
  const [matchKey, setMatchKey] = useState(0);

  const startQuickMatch = () => {
    setMode('race');
    setPlayerMap(createQuickPracticeMap());
    setResult(null);
    setMatchKey((current) => current + 1);
    setStage('battle');
  };

  const startCustomSetup = (nextMode: PracticeMode) => {
    setMode(nextMode);
    setPlayerMap(null);
    setResult(null);
    setStage('setup');
  };

  const editCurrentMap = () => {
    setResult(null);
    setMatchKey((current) => current + 1);
    setStage('setup');
  };

  const handleMapComplete = (map: GameMap) => {
    setPlayerMap(map);
    setResult(null);
    setMatchKey((current) => current + 1);
    setStage('battle');
  };

  const restartMatch = () => {
    setResult(null);
    setMatchKey((current) => current + 1);
  };

  const returnToSettings = () => {
    setStage('configure');
    setPlayerMap(null);
    setResult(null);
    setMatchKey((current) => current + 1);
  };

  const handleBattleComplete = useCallback((completed: PracticeBattleResult) => {
    setResult(completed);
  }, []);

  const resultTitle = result?.draw
    ? '공동 우승'
    : result?.winnerId === PRACTICE_USER_ID
      ? '연습 대전 승리'
      : `${result?.standings.find((entry) => entry.id === result?.winnerId)?.name || 'AI'} 승리`;
  const mapTestMoves = result?.standings.find((entry) => entry.id === PRACTICE_USER_ID)?.moves;
  const finalResultTitle = mode === 'mapTest'
    ? `테스트 완료 · ${mapTestMoves ?? 0}턴`
    : resultTitle;

  const subtitle = stage === 'configure'
    ? '연습 방식 선택'
    : stage === 'setup'
      ? mode === 'mapTest' ? '최대 24 · 필요한 만큼 배치' : `AI ${aiCount}명 · 24벽 맵 제작`
      : mode === 'mapTest' ? '제작자·상대 시점 · 단독 주행' : `나 + AI ${aiCount}명 · 교대 대전`;

  return (
    <MazeShell screen="practice" phase={stage === 'battle' ? 'play' : stage}>
    <main className="fixed inset-0 h-[100dvh] overflow-hidden bg-transparent text-[#3d352d]">
      <header
        className="absolute inset-x-0 top-0 z-40 flex justify-center px-2 pointer-events-none"
        style={{ paddingTop: 'max(8px, env(safe-area-inset-top))' }}
      >
        <div className="game-panel pointer-events-auto flex h-11 w-full max-w-3xl items-center justify-between gap-2 !rounded-lg px-2.5 sm:px-3">
          <div className="flex min-w-0 items-center gap-2">
            <Bot size={19} className="shrink-0 text-[#b36c4c]" aria-hidden="true" />
            <div className="min-w-0 leading-tight">
              <h1 className="text-sm font-black text-[#3d352d]">{mode === 'mapTest' ? '내 맵 테스트' : 'AI 연습'}</h1>
              <p className="hidden truncate text-[9px] text-[#74685c] min-[390px]:block">{subtitle}</p>
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-1.5">
            {stage === 'battle' && (
              <button
                type="button"
                className="btn-sub flex h-11 min-w-11 items-center justify-center gap-1 !rounded-md px-2 text-[10px]"
                onClick={editCurrentMap}
                title="현재 맵 수정"
                aria-label="현재 맵 수정"
              >
                <Pencil size={14} aria-hidden="true" />
                <span className="hidden sm:inline">맵 수정</span>
              </button>
            )}
            {stage !== 'configure' && (
              <button
                type="button"
                className="btn-sub flex h-11 min-w-11 items-center justify-center gap-1 !rounded-md px-2 text-[10px]"
                onClick={returnToSettings}
                title="연습 설정"
                aria-label="연습 설정"
              >
                <Settings2 size={14} aria-hidden="true" />
                <span className="hidden sm:inline">설정</span>
              </button>
            )}
            <Link
              href="/rooms"
              className="btn-sub flex h-11 min-w-11 items-center justify-center gap-1 !rounded-md px-2 text-[10px]"
              title="대기실로"
              aria-label="대기실로"
            >
              <ChevronLeft size={14} aria-hidden="true" />
              <span className="hidden sm:inline">대기실</span>
            </Link>
          </div>
        </div>
      </header>

      <section
        className="absolute inset-x-0 bottom-0 overflow-hidden"
        style={{ top: 'calc(59px + env(safe-area-inset-top))' }}
      >
        {stage === 'configure' && (
          <div className="absolute inset-0 flex items-center justify-center overflow-auto p-3" data-testid="practice-config">
            <div className="game-panel w-full max-w-sm !rounded-lg p-4 sm:p-5">
              <div className="mb-4 flex items-center gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border-2 border-[#cfa87a] bg-[#fff8de] text-[#b36c4c]">
                  <Swords size={21} aria-hidden="true" />
                </div>
                <div>
                  <h2 className="text-base font-black text-[#3d352d]">AI 교대 대전</h2>
                  <p className="text-[11px] text-[#74685c]">참가 인원</p>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-1.5" role="radiogroup" aria-label="AI 수">
                {[1, 2, 3].map((count) => (
                  <button
                    key={count}
                    type="button"
                    role="radio"
                    aria-checked={aiCount === count}
                    className={`h-11 rounded-xl border-2 text-sm font-black transition-colors ${
                      aiCount === count
                        ? 'border-[#5d4635] bg-[#f4c64f] text-[#3d352d]'
                        : 'border-[#cfa87a] bg-[#fffef9] text-[#5d5146] hover:border-[#5d4635]'
                    }`}
                    onClick={() => setAiCount(count)}
                  >
                    AI {count}명
                  </button>
                ))}
              </div>

              <div className="mt-4 grid grid-cols-2 gap-2">
                <button
                  type="button"
                  className="btn-game flex h-12 items-center justify-center gap-2 !rounded-md px-3 text-sm"
                  onClick={startQuickMatch}
                >
                  <Zap size={17} aria-hidden="true" />
                  빠른 대전
                </button>
                <button
                  type="button"
                  className="btn-sub flex h-12 items-center justify-center gap-2 !rounded-md px-3 text-sm font-bold"
                  onClick={() => startCustomSetup('race')}
                >
                  <Map size={17} aria-hidden="true" />
                  맵 만들기
                </button>
                <button
                  type="button"
                  className="btn-sub col-span-2 flex h-12 items-center justify-center gap-2 !rounded-md px-3 text-sm font-bold"
                  onClick={() => startCustomSetup('mapTest')}
                >
                  <Route size={17} aria-hidden="true" />
                  내 맵 테스트
                </button>
              </div>
            </div>
          </div>
        )}

        {stage === 'setup' && (
          <GameSetup
            key={`practice-setup-${matchKey}`}
            onMapComplete={handleMapComplete}
            initialMap={playerMap}
            requireFullBudget={mode !== 'mapTest'}
          />
        )}

        {stage === 'battle' && playerMap && (
          <PracticeBattle
            key={matchKey}
            playerMap={playerMap}
            aiCount={mode === 'mapTest' ? 0 : aiCount}
            mode={mode}
            onComplete={handleBattleComplete}
          />
        )}
      </section>

      {result && stage === 'battle' && (
        <div
          className="absolute inset-0 z-50 flex items-center justify-center bg-[#5d4635]/35 p-3 backdrop-blur-sm"
          data-testid="practice-result"
          role="dialog"
          aria-modal="true"
          aria-labelledby="practice-result-title"
        >
          <div className="game-panel w-full max-w-sm !rounded-lg p-4 shadow-2xl">
            <div className="mb-3 flex items-center justify-center gap-2 text-center">
              <Trophy size={22} className="text-[#b36c4c]" aria-hidden="true" />
              <h2 id="practice-result-title" className="text-lg font-black text-[#3d352d]">{finalResultTitle}</h2>
            </div>

            <ol className="space-y-1.5">
              {result.standings.map((entry) => (
                <li
                  key={entry.id}
                  className={`flex h-9 items-center justify-between rounded-md border px-3 text-xs ${
                    entry.id === PRACTICE_USER_ID
                      ? 'border-[#69cdb7] bg-[#e4f6ef] text-[#315f54]'
                      : 'border-[#e5cfad] bg-[#fffaf0] text-[#3d352d]'
                  }`}
                >
                  <span className="font-bold">{entry.rank}위 · {entry.name}</span>
                  <span className="text-[#74685c]">{entry.moves}턴</span>
                </li>
              ))}
            </ol>

            <div className="mt-4 grid grid-cols-2 gap-2">
              <button type="button" autoFocus className="btn-game flex h-11 items-center justify-center gap-1.5 !rounded-md text-xs" onClick={restartMatch}>
                <RotateCcw size={15} aria-hidden="true" />
                {mode === 'mapTest' ? '다시 테스트' : '재대결'}
              </button>
              <button type="button" className="btn-sub flex h-11 items-center justify-center gap-1.5 !rounded-md text-xs" onClick={editCurrentMap}>
                <Pencil size={15} aria-hidden="true" />
                맵 수정
              </button>
              <button type="button" className="btn-sub col-span-2 flex h-11 items-center justify-center gap-1.5 !rounded-md text-xs" onClick={returnToSettings}>
                <Settings2 size={15} aria-hidden="true" />
                연습 설정
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
    </MazeShell>
  );
}
