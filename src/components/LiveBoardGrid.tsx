'use client';

import React from 'react';
import { CloudFog, Eye } from 'lucide-react';
import { CollisionWall, GameMap, GamePhase, Obstacle, Position } from '@/types/game';
import { getMapItems, getVisibleCollisionWalls } from '@/lib/gameUtils';
import GameBoard from './GameBoard';
import GameBoard3D, { BoardFx } from './three/GameBoard3D';

export type LiveBoardViewMode = 'third' | '2d';

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
  celebrating?: boolean;
  revealObstacles?: boolean;
  pawnColor?: string;
  smokeAffected?: boolean;
  visionObscured?: boolean;
}

export interface LiveBoardGridProps {
  boards: LiveBoardEntry[];
  currentTurnId?: string | null;
  myPlayerId?: string | null;
  viewMode?: LiveBoardViewMode;
  gameEnded?: boolean;
  className?: string;
  emptyState?: React.ReactNode;
  renderOverlay?: (board: LiveBoardEntry) => React.ReactNode;
}

function boardStatus(board: LiveBoardEntry, isCurrentTurn: boolean, isMine: boolean): string {
  if (board.forfeited) return '포기';
  if (board.finished) return `${board.finishMoves ?? board.moves}턴 완주`;
  if (isCurrentTurn) return isMine ? '내 턴' : '현재 턴';
  return '대기';
}

const LiveBoardGrid: React.FC<LiveBoardGridProps> = ({
  boards,
  currentTurnId = null,
  myPlayerId = null,
  viewMode = 'third',
  gameEnded = false,
  className = '',
  emptyState = null,
  renderOverlay,
}) => {
  const visibleBoards = boards.slice(0, 4);

  if (visibleBoards.length === 0) {
    return <div className={`flex h-full w-full items-center justify-center ${className}`}>{emptyState}</div>;
  }

  const layoutClass = visibleBoards.length === 1
    ? 'grid-cols-1 grid-rows-1'
    : visibleBoards.length === 2
      ? 'grid-cols-1 grid-rows-2 sm:grid-cols-2 sm:grid-rows-1'
      : 'grid-cols-2 grid-rows-2';
  const twoDimensionalScaleClass = visibleBoards.length <= 2
    ? 'scale-[0.92] sm:scale-[0.82] md:scale-[0.92] lg:scale-100'
    : 'scale-[0.56] sm:scale-[0.82] md:scale-[0.84] lg:scale-[0.9] xl:scale-100';

  return (
    <div className={`grid h-full w-full min-h-0 min-w-0 gap-1.5 sm:gap-2 ${layoutClass} ${className}`}>
      {visibleBoards.map((board) => {
        const isCurrentTurn = !gameEnded && currentTurnId === board.runnerId;
        const isMine = myPlayerId === board.runnerId;
        const isMapOwner = !!myPlayerId && myPlayerId === board.mapOwnerId && myPlayerId !== board.runnerId;
        const showMapSecrets = gameEnded || isMapOwner;
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
            data-player-board={board.runnerId}
            data-player-kind={board.runnerKind}
            data-player-position={`${board.position.row},${board.position.col}`}
            data-current-turn={isCurrentTurn ? 'true' : undefined}
            data-my-player={isMine ? 'true' : undefined}
            data-map-owner-preview={isMapOwner ? 'true' : undefined}
            data-vision-effect={board.smokeAffected ? 'smoke' : undefined}
            data-vision-obscured={board.visionObscured ? 'true' : undefined}
            aria-label={`${board.runnerName} 게임 보드`}
            className={`relative min-h-0 min-w-0 overflow-hidden rounded-lg border bg-slate-950 ${
              isCurrentTurn
                ? 'border-amber-300 ring-2 ring-amber-300/40'
                : isMine
                  ? 'border-blue-400/80 ring-1 ring-blue-400/30'
                  : 'border-slate-700/80'
            }`}
          >
            {viewMode === 'third' ? (
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
            ) : (
              <div className="absolute inset-0 flex items-center justify-center overflow-hidden bg-slate-900">
                <div className={`inline-flex shrink-0 origin-center ${twoDimensionalScaleClass}`}>
                  <GameBoard
                    gamePhase={GamePhase.PLAY}
                    startPosition={board.map.startPosition}
                    endPosition={board.map.endPosition}
                    playerPosition={board.position}
                    obstacles={board.map.obstacles}
                    collisionWalls={visibleCollisions}
                    readOnly
                    playerPhotoURL={board.runnerPhotoURL || undefined}
                    revealObstacles={revealObstacles}
                    revealItems={showMapSecrets}
                    distinguishOneTimeWalls={showMapSecrets}
                    items={visibleItems}
                    itemsConsumed={board.itemsConsumed || {}}
                    itemActiveWalls={board.itemActiveWalls || {}}
                    itemPhaseOpen={board.itemPhaseOpen || {}}
                    revealedWalls={board.revealedWalls || []}
                  />
                </div>
              </div>
            )}

            {board.visionObscured && (
              <div
                className="pointer-events-none absolute inset-x-0 bottom-0 top-7 z-[5] flex flex-col items-center justify-center bg-slate-950 px-4 text-center"
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

            <div className="pointer-events-none absolute inset-x-0 top-0 z-10 flex min-w-0 items-center justify-between gap-1 bg-slate-950/85 px-2 py-1 backdrop-blur-sm">
              <div className="flex min-w-0 items-center gap-1.5">
                <span
                  aria-hidden="true"
                  className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[8px] font-black text-white ${
                    isMine ? 'bg-blue-500' : 'bg-red-500'
                  }`}
                >
                  {(board.runnerName.trim()[0] || '?').toUpperCase()}
                </span>
                <span className={`truncate text-[10px] font-bold sm:text-[11px] ${isMine ? 'text-blue-200' : 'text-slate-100'}`}>
                  {board.runnerName}
                </span>
                {isMapOwner && (
                  <span title="내 맵 제작자 시점" aria-label="내 맵 제작자 시점" className="text-cyan-300">
                    <Eye size={12} aria-hidden="true" />
                  </span>
                )}
                {board.mapOwnerName && (
                  <span className="hidden truncate text-[9px] text-slate-500 sm:inline">
                    {board.mapOwnerName} 맵
                  </span>
                )}
              </div>
              <div className="flex shrink-0 items-center gap-1">
                {board.smokeAffected && (
                  <span title="연막 영향" aria-label="연막 영향" className="text-slate-300">
                    <CloudFog size={12} aria-hidden="true" />
                  </span>
                )}
                <span className="text-[9px] text-slate-400">턴: {board.moves}</span>
                <span className={`rounded px-1.5 py-0.5 text-[9px] font-bold ${
                  isCurrentTurn
                    ? 'bg-amber-400 text-slate-950'
                    : board.forfeited
                      ? 'bg-red-500/20 text-red-300'
                      : board.finished
                        ? 'bg-green-500/20 text-green-300'
                        : 'bg-slate-800 text-slate-400'
                }`}>
                  {status}
                </span>
              </div>
            </div>

            {renderOverlay && (
              <div className="pointer-events-none absolute inset-0 z-20">
                {renderOverlay(board)}
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
};

export default LiveBoardGrid;
