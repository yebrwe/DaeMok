'use client';

import React from 'react';
import { CloudFog, Eye } from 'lucide-react';
import {
  CollisionWall,
  DiceWormholeRunState,
  GameMap,
  GamePhase,
  LegacyWormholeRunState,
  Obstacle,
  Position,
  WormholeRunState,
} from '@/types/game';
import { getMapItems, getVisibleCollisionWalls } from '@/lib/gameUtils';
import type {
  MazeAuthorityDiceWormholeRunView,
  MazeAuthorityLegacyWormholeRunView,
  MazeAuthorityWormholeRunView,
} from '@/lib/mazeAuthorityClient';
import { getDiceOrientationFaces } from '@/lib/diceWormhole';
import GameBoard3D, { BoardFx } from './three/GameBoard3D';
import DiceWormholeBoard from './DiceWormholeBoard';
import type { LiveBoardVisualAction } from '@/lib/liveBoardVisuals';

type LiveWormholeRun = WormholeRunState | MazeAuthorityWormholeRunView;
type LiveDiceWormholeRun = DiceWormholeRunState | MazeAuthorityDiceWormholeRunView;
type LiveLegacyWormholeRun = LegacyWormholeRunState | MazeAuthorityLegacyWormholeRunView;

function isDiceWormholeRun(run: LiveWormholeRun | null): run is LiveDiceWormholeRun {
  return run?.challenge.version === 2;
}

function isLegacyWormholeRun(run: LiveWormholeRun | null): run is LiveLegacyWormholeRun {
  return run?.challenge.version === 1;
}

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
  // Practice, legacy rooms, and Authority projections may carry either version.
  wormholeRun?: LiveWormholeRun | null;
  fireAffected?: boolean;
  // Read-only compatibility for old callers. Heat hallucinations are no longer rendered.
  heatWalls?: Obstacle[];
  poisonAffected?: boolean;
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

const WORMHOLE_ENTRY_TRANSITION_MS = 920;

function usePrefersReducedMotion(): boolean {
  const [reducedMotion, setReducedMotion] = React.useState(false);

  React.useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setReducedMotion(media.matches);
    update();
    media.addEventListener?.('change', update);
    return () => media.removeEventListener?.('change', update);
  }, []);

  return reducedMotion;
}

interface LiveBoardRealmProps {
  board: LiveBoardEntry;
  wormholeRun: LiveWormholeRun | null;
  showMapSecrets: boolean;
  effectiveRevealObstacles: boolean;
  reducedMotion: boolean;
}

const LiveBoardRealm: React.FC<LiveBoardRealmProps> = ({
  board,
  wormholeRun,
  showMapSecrets,
  effectiveRevealObstacles,
  reducedMotion,
}) => {
  const isInsideWormhole = !!wormholeRun;
  const previousInsideRef = React.useRef(isInsideWormhole);
  const [showInsideWormhole, setShowInsideWormhole] = React.useState(isInsideWormhole);
  const [enteringWormhole, setEnteringWormhole] = React.useState(false);
  const [entryTransitionElapsedMs, setEntryTransitionElapsedMs] = React.useState<number | null>(null);

  React.useEffect(() => {
    const wasInsideWormhole = previousInsideRef.current;
    previousInsideRef.current = isInsideWormhole;

    if (!wasInsideWormhole && isInsideWormhole && !reducedMotion) {
      const startedAt = performance.now();
      setShowInsideWormhole(false);
      setEnteringWormhole(true);
      setEntryTransitionElapsedMs(null);
      const timer = window.setTimeout(() => {
        setEntryTransitionElapsedMs(performance.now() - startedAt);
        setShowInsideWormhole(true);
        setEnteringWormhole(false);
      }, WORMHOLE_ENTRY_TRANSITION_MS);
      return () => window.clearTimeout(timer);
    }

    setShowInsideWormhole(isInsideWormhole);
    setEnteringWormhole(false);
  }, [isInsideWormhole, reducedMotion]);

  const visibleRun = showInsideWormhole ? wormholeRun : null;
  const diceWormholeRun = isDiceWormholeRun(visibleRun) ? visibleRun : null;
  const legacyWormholeRun = isLegacyWormholeRun(visibleRun) ? visibleRun : null;
  const renderedMap: GameMap = legacyWormholeRun
    ? {
        rulesVersion: board.map.rulesVersion,
        startPosition: legacyWormholeRun.challenge.startPosition,
        endPosition: legacyWormholeRun.challenge.endPosition,
        obstacles: legacyWormholeRun.challenge.obstacles ?? [],
        items: [],
        skillLoadout: board.map.skillLoadout,
      }
    : board.map;
  const visibleItems = visibleRun ? [] : showMapSecrets ? getMapItems(board.map) : [];
  const visibleCollisions = legacyWormholeRun
    ? (legacyWormholeRun.discoveredWalls || []).map((wall, index): CollisionWall => ({
        playerId: board.runnerId,
        mapOwnerId: board.mapOwnerId,
        position: wall.position,
        direction: wall.direction,
        timestamp: legacyWormholeRun.enteredAtTurn + index,
      }))
    : diceWormholeRun
      ? []
      : getVisibleCollisionWalls(
          board.collisions || [],
          board.map,
          board.itemsConsumed || {}
        );
  const activatedSealCount = legacyWormholeRun
    ? legacyWormholeRun.challenge.seals.reduce(
        (count, _, index) => count + (legacyWormholeRun.activatedSeals?.[index] ? 1 : 0),
        0
      )
    : 0;

  return (
    <div
      className="absolute inset-0"
      data-testid="live-board-realm-stage"
      data-displayed-realm={visibleRun ? 'wormhole' : 'main'}
      data-realm-transition={enteringWormhole ? 'entering' : 'idle'}
      data-realm-transition-elapsed-ms={entryTransitionElapsedMs === null
        ? undefined
        : Math.round(entryTransitionElapsedMs)}
    >
      {diceWormholeRun ? (
        <DiceWormholeBoard run={diceWormholeRun} />
      ) : (
        <GameBoard3D
          key={legacyWormholeRun ? `wormhole-${legacyWormholeRun.mapOwnerId}-${legacyWormholeRun.itemIndex}` : 'main'}
          gamePhase={GamePhase.PLAY}
          startPosition={renderedMap.startPosition}
          endPosition={renderedMap.endPosition}
          playerPosition={legacyWormholeRun?.position || board.position}
          obstacles={renderedMap.obstacles}
          collisionWalls={visibleCollisions}
          readOnly
          revealObstacles={effectiveRevealObstacles}
          revealItems={showMapSecrets}
          pawnColor={board.pawnColor}
          items={visibleItems}
          itemsConsumed={board.itemsConsumed || {}}
          itemActiveWalls={board.itemActiveWalls || {}}
          itemPhaseOpen={board.itemPhaseOpen || {}}
          revealedWalls={board.revealedWalls || []}
          fx={board.fx || null}
          pawnVia={board.via || null}
          celebrating={!!board.celebrating}
          fireAffected={!!board.fireAffected}
          poisonAffected={!!board.poisonAffected}
          challengeSeals={legacyWormholeRun?.challenge.seals}
          challengeActivatedSeals={legacyWormholeRun?.activatedSeals}
          wormholeChallenge={!!legacyWormholeRun}
          fullscreen
          compact
        />
      )}

      {enteringWormhole && !showInsideWormhole && (
        <div
          className="wormhole-realm-transition"
          data-testid="wormhole-realm-transition"
          aria-hidden="true"
        >
          <span className="wormhole-realm-transition-vortex" />
          <span className="wormhole-realm-transition-core" />
        </div>
      )}

      {legacyWormholeRun && (
        <div className="pointer-events-none absolute left-1/2 top-7 z-10 -translate-x-1/2 rounded-full border border-fuchsia-300/70 bg-slate-950/90 px-2 py-0.5 text-[9px] font-black text-fuchsia-100 shadow-lg">
          웜홀 내부 · 봉인 {activatedSealCount}/{legacyWormholeRun.challenge.seals.length}
        </div>
      )}
    </div>
  );
};

const LiveBoardGrid: React.FC<LiveBoardGridProps> = ({
  boards,
  currentTurnId = null,
  myPlayerId = null,
  gameEnded = false,
  className = '',
  emptyState = null,
}) => {
  const reducedMotion = usePrefersReducedMotion();
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
          const effectiveRevealObstacles = revealObstacles && !board.fireAffected;
          const wormholeRun = board.wormholeRun || null;
          const diceWormholeRun = isDiceWormholeRun(wormholeRun) ? wormholeRun : null;
          const legacyWormholeRun = isLegacyWormholeRun(wormholeRun) ? wormholeRun : null;
          const diceFaces = diceWormholeRun
            ? getDiceOrientationFaces(diceWormholeRun.orientation)
            : null;
          const activatedSealCount = legacyWormholeRun
            ? legacyWormholeRun.challenge.seals.reduce(
                (count, _, index) => count + (legacyWormholeRun.activatedSeals?.[index] ? 1 : 0),
                0
              )
            : 0;
          const status = boardStatus(board, isCurrentTurn, isMine);
          return (
            <section
              key={board.runnerId}
            id={`maze-board-panel-${board.runnerId}`}
            data-player-board={board.runnerId}
            data-player-kind={board.runnerKind}
            data-player-position={`${(wormholeRun?.position || board.position).row},${(wormholeRun?.position || board.position).col}`}
            data-current-turn={isCurrentTurn ? 'true' : undefined}
            data-my-player={isMine ? 'true' : undefined}
            data-map-owner-preview={isMapOwner ? 'true' : undefined}
            data-map-secrets-visible={showMapSecrets ? 'true' : 'false'}
            data-obstacles-revealed={effectiveRevealObstacles ? 'true' : 'false'}
            data-visual-action={board.visualAction}
            data-visual-sequence={board.visualSequence}
            data-visual-fx={board.fx?.type}
            data-vision-effect={board.smokeAffected ? 'smoke' : board.fireAffected ? 'fire' : undefined}
            data-vision-obscured={board.visionObscured ? 'true' : undefined}
            data-fire-affected={board.fireAffected ? 'true' : 'false'}
            data-poison-affected={board.poisonAffected ? 'true' : 'false'}
            data-board-realm={wormholeRun ? 'wormhole' : 'main'}
            data-wormhole-version={wormholeRun?.challenge.version}
            data-dice-top={diceFaces?.top}
            data-dice-target={diceWormholeRun?.challenge.targetTop}
            data-dice-actions={diceWormholeRun?.actionsTaken}
            data-dice-hint={diceWormholeRun ? 'none' : undefined}
            data-wormhole-seals={legacyWormholeRun ? `${activatedSealCount}/${legacyWormholeRun.challenge.seals.length}` : undefined}
            aria-label={`${board.runnerName} 게임 보드`}
            className={`relative min-h-0 min-w-0 touch-none overflow-hidden rounded-2xl border-2 bg-[#eff7f2] ${
              isCurrentTurn
                ? 'border-[#f4c64f] ring-2 ring-[#f4c64f]/35'
                : isMine
                  ? 'border-[#69cdb7] ring-1 ring-[#69cdb7]/30'
                  : 'border-[#e5cfad]'
            }`}
          >
            <LiveBoardRealm
              board={board}
              wormholeRun={wormholeRun}
              showMapSecrets={showMapSecrets}
              effectiveRevealObstacles={effectiveRevealObstacles}
              reducedMotion={reducedMotion}
            />

            {(board.fireAffected || board.poisonAffected) && (
              <div
                className="pointer-events-none absolute right-1.5 top-7 z-10 flex max-w-[58%] flex-col items-end gap-1"
                role="status"
                aria-label={[
                  board.fireAffected ? '화염 상태: 지도가 소각되어 새 벽 기억도 다음 행동에 사라집니다.' : '',
                  board.poisonAffected ? '중독 상태: 모든 입력이 상하좌우 네 방향 중 하나로 무작위 변환됩니다.' : '',
                ].filter(Boolean).join(' ')}
              >
                {board.fireAffected && (
                  <span
                    data-status-badge="fire"
                    className="rounded-full border border-orange-300/80 bg-[#661c0f]/90 px-2 py-0.5 text-[8px] font-black leading-tight text-orange-100 shadow-lg sm:text-[9px]"
                  >
                    🔥 지도 소각 · 새 벽 기억도 다음 행동에 사라짐
                  </span>
                )}
                {board.poisonAffected && (
                  <span
                    data-status-badge="poison"
                    className="rounded-full border border-lime-300/80 bg-[#274e13]/90 px-2 py-0.5 text-[8px] font-black leading-tight text-lime-50 shadow-lg sm:text-[9px]"
                  >
                    ☠ 중독 · 모든 입력 4방향 무작위
                  </span>
                )}
              </div>
            )}

            {board.visionObscured && (
              <div
                className="pointer-events-none absolute inset-x-0 bottom-0 top-7 z-[5] flex flex-col items-center justify-center bg-[#5d5146]/90 px-4 text-center"
                data-testid="board-obscure-overlay"
              >
                <CloudFog size={34} className="mb-2 text-slate-300" aria-hidden="true" />
                <p className="text-xs font-black text-slate-100">안개로 시야 차단</p>
                <p className="mt-1 text-[10px] text-slate-400">이번 행동 후 해제됩니다</p>
                <span className="sr-only" role="status">
                  안개가 적용되어 주행 보드 시야가 가려졌습니다. 이번 행동 후 해제됩니다.
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
                  <span title="안개 영향" aria-label="안개 영향" className="text-[#74685c]">
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
