'use client';

import React from 'react';
import { CollisionWall, GameMap, GamePhase, Obstacle, Position } from '@/types/game';
import { getMapItems } from '@/lib/gameUtils';
import GameBoard from './GameBoard';
import GameBoard3D, { BoardFx } from './three/GameBoard3D';

export type LiveBoardViewMode = 'third' | '2d';

export interface LiveBoardEntry {
  runnerId: string;
  runnerName: string;
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
  revealedWalls?: Obstacle[];
  fx?: BoardFx | null;
  via?: Position[] | null;
  celebrating?: boolean;
  revealObstacles?: boolean;
  pawnColor?: string;
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
      ? 'grid-cols-2 grid-rows-1'
      : 'grid-cols-2 grid-rows-2';
  const twoDimensionalScaleClass = visibleBoards.length <= 2
    ? 'scale-[0.48] sm:scale-[0.72] md:scale-[0.9] lg:scale-100'
    : 'scale-[0.48] sm:scale-[0.68] md:scale-[0.72] lg:scale-[0.82] xl:scale-[0.9]';

  return (
    <div className={`grid h-full w-full min-h-0 min-w-0 gap-1.5 sm:gap-2 ${layoutClass} ${className}`}>
      {visibleBoards.map((board) => {
        const isCurrentTurn = !gameEnded && currentTurnId === board.runnerId;
        const isMine = myPlayerId === board.runnerId;
        const revealObstacles = gameEnded || !!board.revealObstacles;
        const status = boardStatus(board, isCurrentTurn, isMine);

        return (
          <section
            key={board.runnerId}
            data-player-board={board.runnerId}
            data-current-turn={isCurrentTurn ? 'true' : undefined}
            data-my-player={isMine ? 'true' : undefined}
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
                collisionWalls={board.collisions || []}
                readOnly
                revealObstacles={revealObstacles}
                pawnColor={board.pawnColor}
                items={getMapItems(board.map)}
                itemsConsumed={board.itemsConsumed || {}}
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
                    collisionWalls={board.collisions || []}
                    readOnly
                    playerPhotoURL={board.runnerPhotoURL || undefined}
                    revealObstacles={revealObstacles}
                    items={getMapItems(board.map)}
                    itemsConsumed={board.itemsConsumed || {}}
                    revealedWalls={board.revealedWalls || []}
                  />
                </div>
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
                {board.mapOwnerName && (
                  <span className="hidden truncate text-[9px] text-slate-500 sm:inline">
                    {board.mapOwnerName} 맵
                  </span>
                )}
              </div>
              <div className="flex shrink-0 items-center gap-1">
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
