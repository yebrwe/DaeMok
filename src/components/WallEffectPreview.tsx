'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { X } from 'lucide-react';
import { GameMap, GamePhase, GameState, MapItem, Position, WallItemType } from '@/types/game';
import GameBoard from '@/components/GameBoard';
import GameBoard3D, { BoardFx } from '@/components/three/GameBoard3D';
import { createMazeSkillState } from '@/lib/mazeSkills';
import { normalizeConsumed, resolveTurnAction, TurnOutcome } from '@/lib/gameTurn';
import { getVisibleCollisionWalls, isSamePosition, ITEM_LABELS } from '@/lib/gameUtils';

const PREVIEW_PLAYER_ID = 'wall-preview-player';
const PREVIEW_ORIGIN: Position = { row: 2, col: 1 };

interface PreviewFrame {
  state: GameState;
  outcome: TurnOutcome | null;
}

interface WallEffectPreviewProps {
  type: WallItemType;
  onClose: () => void;
}

function previewItem(type: WallItemType): MapItem {
  return {
    type,
    wallPosition: { ...PREVIEW_ORIGIN },
    wallDirection: 'right',
    ...(type === 'windWall' ? { effectDirection: 'down' as const } : {}),
  };
}

function createInitialState(type: WallItemType): GameState {
  const map: GameMap = {
    startPosition: { ...PREVIEW_ORIGIN },
    endPosition: { row: 5, col: 5 },
    obstacles: [
      { position: { row: 1, col: 1 }, direction: 'right' },
      { position: { row: 3, col: 3 }, direction: 'down' },
    ],
    items: [previewItem(type)],
    skillLoadout: 'scoutPulse',
  };

  return {
    phase: GamePhase.PLAY,
    players: {
      [PREVIEW_PLAYER_ID]: {
        id: PREVIEW_PLAYER_ID,
        displayName: '주자',
        position: { ...PREVIEW_ORIGIN },
        positionHistory: [{ row: 2, col: 0 }, { ...PREVIEW_ORIGIN }],
        moves: 0,
        isReady: true,
        isOnline: true,
        finished: false,
        forfeited: false,
      },
    },
    maps: { [PREVIEW_PLAYER_ID]: map },
    assignments: { [PREVIEW_PLAYER_ID]: PREVIEW_PLAYER_ID },
    currentTurn: PREVIEW_PLAYER_ID,
    turnOrder: [PREVIEW_PLAYER_ID],
    turnNumber: 1,
    collisionWalls: {},
    itemState: {
      [PREVIEW_PLAYER_ID]: {
        consumed: {},
        mazeSkill: createMazeSkillState('scoutPulse'),
      },
    },
    revealedWallsByPlayer: {},
    visionEffectsByPlayer: {},
    turnMessage: '오른쪽 벽을 향해 이동합니다.',
    turnMessageTimestamp: 1,
  };
}

function buildFrames(type: WallItemType): PreviewFrame[] {
  const initial = createInitialState(type);
  const frames: PreviewFrame[] = [{ state: initial, outcome: null }];
  let current = initial;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const player = current.players[PREVIEW_PLAYER_ID];
    if (!player || (attempt > 0 && player.position.col !== PREVIEW_ORIGIN.col)) break;
    const resolved = resolveTurnAction(
      current,
      PREVIEW_PLAYER_ID,
      { type: 'move', direction: 'right' },
      attempt + 10
    );
    if (!resolved) break;
    current = resolved.state;
    frames.push({ state: current, outcome: resolved.outcome });
  }

  return frames;
}

function frameFx(frame: PreviewFrame, key: number): BoardFx | null {
  const outcome = frame.outcome;
  if (!outcome || outcome.type !== 'move') return null;
  if (outcome.effect === 'bump') {
    return { key, type: 'bump', at: outcome.origin, dir: outcome.direction };
  }
  if (outcome.reachedGoal) return { key, type: 'goal', at: outcome.position };
  return null;
}

const WallEffectPreview: React.FC<WallEffectPreviewProps> = ({ type, onClose }) => {
  const frames = useMemo(() => buildFrames(type), [type]);
  const [frameIndex, setFrameIndex] = useState(0);

  useEffect(() => {
    setFrameIndex(0);
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const timer = window.setInterval(() => {
      setFrameIndex((current) => (current + 1) % frames.length);
    }, 1_200);
    return () => window.clearInterval(timer);
  }, [frames]);

  const frame = frames[frameIndex];
  const map = frame.state.maps?.[PREVIEW_PLAYER_ID];
  if (!map) return null;
  const player = frame.state.players[PREVIEW_PLAYER_ID];
  const itemState = frame.state.itemState?.[PREVIEW_PLAYER_ID];
  const consumed = normalizeConsumed(itemState?.consumed);
  const activeWalls = normalizeConsumed(itemState?.activeWalls);
  const phaseOpen = normalizeConsumed(itemState?.phaseOpen);
  const collisions = getVisibleCollisionWalls(
    Object.values(frame.state.collisionWalls || {}).filter(Boolean),
    map,
    consumed
  );
  const fx = frameFx(frame, frameIndex + 1);
  const outcome = frame.outcome?.type === 'move' ? frame.outcome : null;
  const via = outcome?.wallEffect === 'thornWall' && !isSamePosition(outcome.position, outcome.origin)
    ? [outcome.origin]
    : outcome && ['iceWall', 'windWall', 'mirrorWall'].includes(outcome.wallEffect || '') &&
      !isSamePosition(outcome.position, outcome.attempted)
      ? [outcome.attempted]
      : null;

  return (
    <section
      className="pointer-events-none absolute left-1/2 top-[92px] z-40 h-[236px] w-[96%] max-w-[430px] -translate-x-1/2 overflow-hidden rounded-lg border border-cyan-400/60 bg-slate-950/95 shadow-2xl shadow-black/70 backdrop-blur-md"
      data-testid="wall-effect-preview"
      data-preview-wall={type}
      data-preview-frame={frameIndex}
      aria-label={`${ITEM_LABELS[type]} 효과 미리보기`}
    >
      <div className="flex h-11 items-center justify-between border-b border-slate-700 px-2.5">
        <div className="min-w-0">
          <span className="text-[11px] font-black text-cyan-200">{ITEM_LABELS[type]}</span>
          <span className="ml-2 text-[9px] font-bold text-slate-500">실제 턴 예시 · {player.moves || 0}턴</span>
        </div>
        <button
          type="button"
          className="pointer-events-auto flex size-11 shrink-0 items-center justify-center text-slate-300 hover:text-white"
          onClick={onClose}
          title="벽 효과 미리보기 닫기"
          aria-label="벽 효과 미리보기 닫기"
        >
          <X size={16} aria-hidden="true" />
        </button>
      </div>

      <div className="grid h-[148px] grid-cols-2 gap-px bg-slate-700">
        <div className="relative overflow-hidden bg-slate-900" data-testid="wall-preview-2d">
          <span className="absolute left-1.5 top-1 z-10 rounded bg-slate-950/80 px-1.5 py-0.5 text-[8px] font-black text-slate-300">2D</span>
          <div className="absolute inset-0 flex items-center justify-center overflow-hidden">
            <div className="origin-center scale-[0.34] min-[390px]:scale-[0.38] sm:scale-[0.42]">
              <GameBoard
                gamePhase={GamePhase.PLAY}
                startPosition={map.startPosition}
                endPosition={map.endPosition}
                playerPosition={player.position}
                obstacles={map.obstacles}
                collisionWalls={collisions}
                readOnly
                revealObstacles
                revealItems
                distinguishOneTimeWalls
                items={map.items}
                itemsConsumed={consumed}
                itemActiveWalls={activeWalls}
                itemPhaseOpen={phaseOpen}
                revealedWalls={frame.state.revealedWallsByPlayer?.[PREVIEW_PLAYER_ID] || []}
              />
            </div>
          </div>
        </div>

        <div className="relative overflow-hidden bg-slate-900" data-testid="wall-preview-3d">
          <span className="absolute left-1.5 top-1 z-10 rounded bg-slate-950/80 px-1.5 py-0.5 text-[8px] font-black text-slate-300">3D</span>
          <GameBoard3D
            gamePhase={GamePhase.PLAY}
            startPosition={map.startPosition}
            endPosition={map.endPosition}
            playerPosition={player.position}
            obstacles={map.obstacles}
            collisionWalls={collisions}
            readOnly
            revealObstacles
            revealItems
            distinguishOneTimeWalls
            pawnColor="#38bdf8"
            items={map.items}
            itemsConsumed={consumed}
            itemActiveWalls={activeWalls}
            itemPhaseOpen={phaseOpen}
            revealedWalls={frame.state.revealedWallsByPlayer?.[PREVIEW_PLAYER_ID] || []}
            fx={fx}
            pawnVia={via}
            fullscreen
            compact
          />
        </div>
      </div>

      <div className="flex h-10 items-center px-2.5">
        <p className="w-full whitespace-normal break-keep text-[9px] font-bold leading-[1.35] text-slate-200">
          {frame.outcome?.message || '벽을 향해 이동해 발동 결과를 확인합니다.'}
        </p>
      </div>
    </section>
  );
};

export default WallEffectPreview;
