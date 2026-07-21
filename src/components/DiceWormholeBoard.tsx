'use client';

import React, { useEffect, useRef, useState } from 'react';
import type {
  DiceFace,
  DiceWormholeRunState,
  Direction,
  Position,
} from '@/types/game';
import {
  getDiceOrientationFaces,
} from '@/lib/diceWormhole';
import DiceWormholeBoard3D from '@/components/three/DiceWormholeBoard3D';

interface DiceWormholeBoardProps {
  run: DiceWormholeRunState;
}

interface DiceRunSnapshot {
  position: Position;
  orientation: number;
  actionsTaken: number;
}

const PIP_POSITIONS: Record<DiceFace, readonly number[]> = {
  1: [4],
  2: [0, 8],
  3: [0, 4, 8],
  4: [0, 2, 6, 8],
  5: [0, 2, 4, 6, 8],
  6: [0, 2, 3, 5, 6, 8],
};

function samePosition(left: Position, right: Position): boolean {
  return left.row === right.row && left.col === right.col;
}

function positionKey(position: Position): string {
  return `${position.row},${position.col}`;
}

function movementDirection(previous: Position, current: Position): Direction | null {
  const rowDelta = current.row - previous.row;
  const colDelta = current.col - previous.col;
  if (rowDelta === -1 && colDelta === 0) return 'up';
  if (rowDelta === 1 && colDelta === 0) return 'down';
  if (rowDelta === 0 && colDelta === -1) return 'left';
  if (rowDelta === 0 && colDelta === 1) return 'right';
  return null;
}

function directionStyle(direction: Direction | null): React.CSSProperties {
  const [x, y] = direction === 'up'
    ? [0, 1]
    : direction === 'down'
      ? [0, -1]
      : direction === 'left'
        ? [1, 0]
        : direction === 'right'
          ? [-1, 0]
          : [0, 0];
  return {
    '--dice-roll-enter-x': x,
    '--dice-roll-enter-y': y,
  } as React.CSSProperties;
}

type DiceVisualSide = 'top' | 'bottom' | 'front' | 'back' | 'right' | 'left';

const DICE_SIDE_LABELS: Record<DiceVisualSide, string> = {
  top: '윗면',
  bottom: '아랫면',
  front: '앞면',
  back: '뒷면',
  right: '오른쪽 면',
  left: '왼쪽 면',
};

function DicePipFace({ face, side }: { face: DiceFace; side: DiceVisualSide }) {
  const active = new Set(PIP_POSITIONS[face]);
  return (
    <span
      className={`dice-wormhole-face dice-wormhole-face-${side}`}
      data-dice-face={side}
      data-dice-face-value={face}
      aria-label={`${DICE_SIDE_LABELS[side]} ${face}`}
      aria-hidden="true"
    >
      {Array.from({ length: 9 }, (_, index) => (
        <span
          key={index}
          className="dice-wormhole-pip"
          data-pip-active={active.has(index) ? 'true' : 'false'}
          aria-hidden="true"
        />
      ))}
    </span>
  );
}

function snapshot(run: DiceWormholeRunState): DiceRunSnapshot {
  return {
    position: { ...run.position },
    orientation: run.orientation,
    actionsTaken: run.actionsTaken,
  };
}

function usePrefersReducedMotion() {
  const [reducedMotion, setReducedMotion] = useState(false);

  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setReducedMotion(media.matches);
    update();
    media.addEventListener?.('change', update);
    return () => media.removeEventListener?.('change', update);
  }, []);

  return reducedMotion;
}

export default function DiceWormholeBoard({ run }: DiceWormholeBoardProps) {
  const faces = getDiceOrientationFaces(run.orientation);
  const front = faces.south;
  const right = faces.east;
  const previousRef = useRef<DiceRunSnapshot>(snapshot(run));
  const previous = previousRef.current;
  const actionChanged = previous.actionsTaken !== run.actionsTaken;
  const orientationChanged = previous.orientation !== run.orientation;
  const rollDirection = actionChanged
    ? movementDirection(previous.position, run.position)
    : null;
  const blocked = new Set(run.challenge.blockedCells.map(positionKey));
  const reducedMotion = usePrefersReducedMotion();

  useEffect(() => {
    previousRef.current = snapshot(run);
  }, [run]);

  return (
    <div
      className="dice-wormhole-board absolute inset-0 flex min-h-0 flex-col items-center px-2 pb-2 pt-7"
      data-testid="dice-wormhole-board"
      data-board-realm="wormhole"
      data-wormhole-version="2"
      data-dice-top={faces.top}
      data-dice-front={front}
      data-dice-right={right}
      data-dice-target={run.challenge.targetTop}
      data-dice-actions={run.actionsTaken}
      data-dice-hint="none"
      data-reduced-motion={reducedMotion ? 'true' : 'false'}
      aria-label={`주사위 웜홀. 현재 윗면 ${faces.top}, 목표 윗면 ${run.challenge.targetTop}, 내부 행동 ${run.actionsTaken}회`}
    >
      <div className="dice-wormhole-hud flex w-full shrink-0 items-center justify-between gap-1 px-1 py-0.5 text-[8px] font-black sm:text-[9px]">
        <span className="rounded border border-violet-300/70 bg-violet-950/90 px-1.5 py-0.5 text-violet-100">
          목표 윗면 {run.challenge.targetTop}
        </span>
        <span className="truncate text-slate-700">
          위 {faces.top} · 앞 {front} · 오른쪽 {right}
        </span>
        <span className="rounded border border-slate-400/70 bg-slate-950/85 px-1.5 py-0.5 text-slate-100">
          {run.actionsTaken}행동
        </span>
      </div>

      <DiceWormholeBoard3D
        run={run}
        previousPosition={previous.position}
        previousOrientation={previous.orientation}
        actionChanged={actionChanged}
        rollDirection={rollDirection}
        reducedMotion={reducedMotion}
      />

      {/*
        Canvas owns the visible world. This compact DOM mirror preserves the
        six-face and cell semantics used by screen-reader diagnostics and the
        deterministic browser contract without drawing a second CSS board.
      */}
      <div
        className="sr-only"
        role="grid"
        aria-label="주사위 웜홀 4×4 칸 상태"
        data-dice-accessibility-contract="true"
      >
        {Array.from({ length: run.challenge.boardSize * run.challenge.boardSize }, (_, index) => {
          const position = {
            row: Math.floor(index / run.challenge.boardSize),
            col: index % run.challenge.boardSize,
          };
          const isBlocked = blocked.has(positionKey(position));
          const isStart = samePosition(position, run.challenge.startPosition);
          const isExit = samePosition(position, run.challenge.endPosition);
          const hasDice = samePosition(position, run.position);
          return (
            <div
              key={positionKey(position)}
              role="gridcell"
              aria-label={
                isBlocked
                  ? `${position.row + 1}행 ${position.col + 1}열, 이동할 수 없는 차원석`
                  : hasDice
                    ? `${position.row + 1}행 ${position.col + 1}열, 현재 주사위 윗면 ${faces.top}`
                    : isExit
                      ? `${position.row + 1}행 ${position.col + 1}열, 출구 목표 윗면 ${run.challenge.targetTop}`
                      : isStart
                        ? `${position.row + 1}행 ${position.col + 1}열, 진입점`
                        : `${position.row + 1}행 ${position.col + 1}열`
              }
              data-dice-cell={positionKey(position)}
              data-dice-blocked={isBlocked ? 'true' : 'false'}
              data-dice-exit={isExit ? 'true' : undefined}
            >
              {isBlocked && <span>이동할 수 없는 차원석</span>}
              {!isBlocked && isStart && !hasDice && <span>진입</span>}
              {!isBlocked && isExit && <span>출구 목표 윗면 {run.challenge.targetTop}</span>}
              {!isBlocked && hasDice && (
                <div
                  key={`${run.actionsTaken}:${run.orientation}:${positionKey(position)}`}
                  className={`dice-wormhole-piece ${
                    actionChanged
                      ? rollDirection && orientationChanged
                        ? 'dice-wormhole-piece-roll'
                        : 'dice-wormhole-piece-bump'
                      : ''
                  }`}
                  data-dice-piece="true"
                  data-roll-direction={rollDirection || (actionChanged ? 'bump' : 'idle')}
                  style={directionStyle(rollDirection)}
                  aria-label={`현재 주사위 윗면 ${faces.top}, 앞면 ${front}, 오른쪽 면 ${right}`}
                >
                  <span
                    className="dice-wormhole-cube"
                    data-dice-face-count="6"
                    aria-label={`윗면 ${faces.top}, 앞면 ${front}, 오른쪽 면 ${right}`}
                  >
                    <DicePipFace face={faces.top} side="top" />
                    <DicePipFace face={faces.bottom} side="bottom" />
                    <DicePipFace face={front} side="front" />
                    <DicePipFace face={faces.north} side="back" />
                    <DicePipFace face={right} side="right" />
                    <DicePipFace face={faces.west} side="left" />
                  </span>
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="flex h-5 w-full shrink-0 items-center justify-center" aria-live="polite">
        <span className="text-[8px] font-bold text-slate-600">
          출구에서 목표 눈을 위로 맞추세요
        </span>
      </div>
    </div>
  );
}
