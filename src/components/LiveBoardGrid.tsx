'use client';

import React from 'react';
import { CloudFog, Eye } from 'lucide-react';
import { CollisionWall, GameMap, GamePhase, Obstacle, Position } from '@/types/game';
import { getMapItems, getVisibleCollisionWalls } from '@/lib/gameUtils';
import GameBoard3D, { BoardFx } from './three/GameBoard3D';
import type { LiveBoardVisualAction } from '@/lib/liveBoardVisuals';

export interface LiveBoardEntry {
  runnerId: string;
  runnerName: string;
  runnerKind?: 'human' | 'ai';
  runnerPhotoURL?: string | null;
  mapOwnerId: string;
  mapOwnerName?: string | null;
  map: GameMap;
  position: Position;
  moves: number;
  finished?: boolean;
  finishMoves?: number | null;
  forfeited?: boolean;
  collisions?: CollisionWall[];
  itemsConsumed?: Record<number, boolean> | null;
  itemActiveWalls?: Record<number, boolean> | null;
  itemPhaseOpen?: Record<number, boolean> | null;
  revealedWalls?: Obstacle[];
  fx?: BoardFx | null;
  via?: Position[] | null;
  visualAction?: LiveBoardVisualAction;
  visualSequence?: number;
  celebrating?: boolean;
  revealObstacles?: boolean;
  revealMapSecrets?: boolean;
  pawnColor?: string;
  smokeAffected?: boolean;
  visionObscured?: boolean;
}

interface LiveBoardGridProps {
  boards: LiveBoardEntry[];
  currentTurnId?: string | null;
  myPlayerId?: string | null;
  gameEnded?: boolean;
  className?: string;
  emptyState?: React.ReactNode;
}

function boardStatus(board: LiveBoardEntry, isCurrentTurn: boolean, isMine: boolean): string {
  if (board.forfeited) return '이전 기록';
  if (board.finished) return `${board.finishMoves ?? board.moves}턴 완주`;
  if (isCurrentTurn) return isMine ? '내 턴' : '현재 턴';
  return '대기';
}

const LiveBoardGrid: React.FC<LiveBoardGridProps> = ({
  boards,
  currentTurnId = null,
  myPlayerId = null,
  gameEnded = false,
  className = '',
  emptyState = null,
}) => {
  const visibleBoards = boards.slice(0, 4);
  if (visibleBoards.length === 0) {
    return <div className={`flex h-full w-full items-center justify-center ${className}`}>{emptyState}</div>;
  }

  const layoutClass = visibleBoards.length === 1
    ? 'grid-cols-1 grid-rows-1'
    : visibleBoards.length === 2
      ? 'grid-cols-2 grid-rows-1'
      : 'grid-cols-2 grid-rows-2';
  return (
    <div
      className={`flex h-full w-full min-h-0 min-w-0 flex-col gap-1.5 sm:gap-2 ${className}`}
      data-mounted-board-count={visibleBoards.length}
    >
      <div className={`grid h-full w-full min-h-0 min-w-0 flex-1 gap-1.5 sm:gap-2 ${layoutClass}`}>
        {visibleBoards.map((board) => {
          const isCurrentTurn = !gameEnded && currentTurnId === board.runnerId;
          const isMine = myPlayerId === board.runnerId;
          const isMapOwner = !!myPlayerId && myPlayerId === board.mapOwnerId && myPlayerId !== board.runnerId;
          const showMapSecrets = gameEnded || isMapOwner || !!board.revealMapSecrets;
          const revealObstacles = gameEnded || isMapOwner || !!board.revealObstacles;
          const visibleItems = showMapSecrets ? getMapItems(board.map) : [];
          const visibleCollisions = getVisibleCollisionWalls(
            board.collisions || [],
            board.map,
            board.itemsConsumed || {}
          );
          const status = boardStatus(board, isCurrentTurn, isMine);

          return (
            <section
              key={board.runnerId}
            id={`maze-board-panel-${board.runnerId}`}
            data-player-board={board.runnerId}
            data-player-kind={board.runnerKind}
            data-player-position={`${board.position.row},${board.position.col}`}
            data-current-turn={isCurrentTurn ? 'true' : undefined}
            data-my-player={isMine ? 'true' : undefined}
            data-map-owner-preview={isMapOwner ? 'true' : undefined}
            data-map-secrets-visible={showMapSecrets ? 'true' : 'false'}
            data-obstacles-revealed={revealObstacles ? 'true' : 'false'}
            data-visual-action={board.visualAction}
            data-visual-sequence={board.visualSequence}
            data-visual-fx={board.fx?.type}
            data-vision-effect={board.smokeAffected ? 'smoke' : undefined}
            data-vision-obscured={board.visionObscured ? 'true' : undefined}
            aria-label={`${board.runnerName} 게임 보드`}
            className={`relative min-h-0 min-w-0 touch-none overflow-hidden rounded-2xl border-2 bg-[#eff7f2] ${
              isCurrentTurn
                ? 'border-[#f4c64f] ring-2 ring-[#f4c64f]/35'
                : isMine
                  ? 'border-[#69cdb7] ring-1 ring-[#69cdb7]/30'
                  : 'border-[#e5cfad]'
            }`}
          >
            <GameBoard3D
              gamePhase={GamePhase.PLAY}
              startPosition={board.map.startPosition}
              endPosition={board.map.endPosition}
              playerPosition={board.position}
              obstacles={board.map.obstacles}
              collisionWalls={visibleCollisions}
              readOnly
              revealObstacles={revealObstacles}
              revealItems={showMapSecrets}
              distinguishOneTimeWalls={showMapSecrets}
              pawnColor={board.pawnColor}
              items={visibleItems}
              itemsConsumed={board.itemsConsumed || {}}
              itemActiveWalls={board.itemActiveWalls || {}}
              itemPhaseOpen={board.itemPhaseOpen || {}}
              revealedWalls={board.revealedWalls || []}
              fx={board.fx || null}
              pawnVia={board.via || null}
              celebrating={!!board.celebrating}
              fullscreen
              compact
            />

            {board.visionObscured && (
              <div
                className="pointer-events-none absolute inset-x-0 bottom-0 top-7 z-[5] flex flex-col items-center justify-center bg-[#5d5146]/90 px-4 text-center"
                data-testid="board-obscure-overlay"
              >
                <CloudFog size={34} className="mb-2 text-slate-300" aria-hidden="true" />
                <p className="text-xs font-black text-slate-100">연막으로 시야 차단</p>
                <p className="mt-1 text-[10px] text-slate-400">이번 행동 후 해제됩니다</p>
                <span className="sr-only" role="status">
                  연막이 적용되어 주행 보드 시야가 가려졌습니다. 이번 행동 후 해제됩니다.
                </span>
              </div>
            )}

            <div className="pointer-events-none absolute inset-x-0 top-0 z-10 flex min-w-0 items-center justify-between gap-1 border-b border-[#e5cfad] bg-[#fffaf0]/90 px-2 py-1 backdrop-blur-sm">
              <div className="flex min-w-0 items-center gap-1.5">
                <span
                  aria-hidden="true"
                  className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[8px] font-black text-white ${
                    isMine ? 'bg-[#4e9ad8]' : 'bg-[#f08b78]'
                  }`}
                >
                  {(board.runnerName.trim()[0] || '?').toUpperCase()}
                </span>
                <span className="truncate text-[10px] font-bold text-[#3d352d] sm:text-[11px]">
                  {board.runnerName}
                </span>
                {isMapOwner && (
                  <span title="내 맵 제작자 시점" aria-label="내 맵 제작자 시점" className="text-[#1f708b]">
                    <Eye size={12} aria-hidden="true" />
                  </span>
                )}
                {board.mapOwnerName && (
                  <span className="hidden truncate text-[9px] text-[#74685c] sm:inline">
                    {board.mapOwnerName} 맵
                  </span>
                )}
              </div>
              <div className="flex shrink-0 items-center gap-1">
                {board.smokeAffected && (
                  <span title="연막 영향" aria-label="연막 영향" className="text-[#74685c]">
                    <CloudFog size={12} aria-hidden="true" />
                  </span>
                )}
                <span className="text-[9px] text-[#74685c]">턴: {board.moves}</span>
                <span className={`rounded px-1.5 py-0.5 text-[9px] font-bold ${
                  isCurrentTurn
                    ? 'bg-[#f4c64f] text-[#3d352d]'
                    : board.forfeited
                      ? 'bg-[#f2e4cf] text-[#74685c]'
                      : board.finished
                        ? 'bg-[#e8f5df] text-[#315f2d]'
                        : 'bg-[#f2e4cf] text-[#74685c]'
                }`}>
                  {status}
                </span>
              </div>
            </div>

            </section>
          );
        })}
      </div>
    </div>
  );
};

export default LiveBoardGrid;
