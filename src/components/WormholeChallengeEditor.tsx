'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Check, Redo2, Undo2, Wand2, X } from 'lucide-react';
import type {
  Direction,
  LegacyWormholeChallenge as WormholeChallenge,
  Obstacle,
  Position,
} from '@/types/game';
import {
  BOARD_SIZE,
  getWormholeChallengeCompletionSteps,
  getWormholeChallengeError,
  WORMHOLE_CHALLENGE_MAX_WALLS,
  WORMHOLE_CHALLENGE_MAX_STEPS,
  WORMHOLE_CHALLENGE_MIN_STEPS,
  WORMHOLE_CHALLENGE_SEAL_COUNT,
} from '@/lib/gameUtils';
import { findNearestWallPointerTarget } from '@/lib/wallPointer';

type ChallengeStep = 'start' | 'seals' | 'end' | 'walls';

interface ChallengeDraft {
  step: ChallengeStep;
  startPosition: Position | null;
  endPosition: Position | null;
  seals: Position[];
  obstacles: Obstacle[];
}

interface ChallengeHistory {
  past: ChallengeDraft[];
  present: ChallengeDraft;
  future: ChallengeDraft[];
}

interface GridCoordinate {
  row: number;
  col: number;
}

export interface WormholeChallengeEditorProps {
  entrance: Position;
  returnExit: Position;
  onComplete: (challenge: WormholeChallenge) => void;
  onCancel: () => void;
}

const HISTORY_LIMIT = 100;
const GRID_LENGTH = BOARD_SIZE * 2 - 1;
const NORMAL_WALL_STYLE = 'bg-[#6b1111] ring-2 ring-[#fecaca] shadow-sm shadow-red-950/70';
const PASSABLE_FLOOR_STYLES = ['bg-[#fffaf0]', 'bg-[#eff7df]'] as const;
const BOARD_FLOOR_STYLE = 'bg-[#c7d7b3]';

const STEP_ORDER: ChallengeStep[] = ['start', 'seals', 'end', 'walls'];

function samePosition(left: Position | null | undefined, right: Position | null | undefined): boolean {
  return !!left && !!right && left.row === right.row && left.col === right.col;
}

function clonePosition(position: Position | null): Position | null {
  return position ? { ...position } : null;
}

function cloneObstacle(obstacle: Obstacle): Obstacle {
  return {
    position: { ...obstacle.position },
    direction: obstacle.direction,
  };
}

function cloneDraft(draft: ChallengeDraft): ChallengeDraft {
  return {
    step: draft.step,
    startPosition: clonePosition(draft.startPosition),
    endPosition: clonePosition(draft.endPosition),
    seals: draft.seals.map((position) => ({ ...position })),
    obstacles: draft.obstacles.map(cloneObstacle),
  };
}

function cloneChallenge(challenge: WormholeChallenge): WormholeChallenge {
  return {
    version: 1,
    startPosition: { ...challenge.startPosition },
    endPosition: { ...challenge.endPosition },
    seals: challenge.seals.map((position) => ({ ...position })),
    obstacles: challenge.obstacles.map(cloneObstacle),
  };
}

function wallKey(obstacle: Obstacle): string {
  return `${obstacle.position.row},${obstacle.position.col}:${obstacle.direction}`;
}

function cellLabel(position: Position): string {
  return `${position.row + 1}행 ${position.col + 1}열`;
}

function shuffle<T>(values: readonly T[]): T[] {
  const shuffled = [...values];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
  }
  return shuffled;
}

function allCells(): Position[] {
  return Array.from({ length: BOARD_SIZE * BOARD_SIZE }, (_, index) => ({
    row: Math.floor(index / BOARD_SIZE),
    col: index % BOARD_SIZE,
  }));
}

/** Every physical edge is emitted once, from its top or left cell. */
function allCanonicalWalls(): Obstacle[] {
  const walls: Obstacle[] = [];
  for (let row = 0; row < BOARD_SIZE; row += 1) {
    for (let col = 0; col < BOARD_SIZE; col += 1) {
      if (col < BOARD_SIZE - 1) {
        walls.push({ position: { row, col }, direction: 'right' });
      }
      if (row < BOARD_SIZE - 1) {
        walls.push({ position: { row, col }, direction: 'down' });
      }
    }
  }
  return walls;
}

function automaticChallenge(): WormholeChallenge | null {
  const cells = allCells();
  const wallTarget = Math.min(Math.max(WORMHOLE_CHALLENGE_MAX_WALLS, 0), 12);

  for (let attempt = 0; attempt < 40; attempt += 1) {
    const positions = shuffle(cells);
    const startPosition = positions[0];
    const farthest = [...positions.slice(1)].sort((left, right) => {
      const leftDistance = Math.abs(left.row - startPosition.row) + Math.abs(left.col - startPosition.col);
      const rightDistance = Math.abs(right.row - startPosition.row) + Math.abs(right.col - startPosition.col);
      return rightDistance - leftDistance;
    });
    const endPosition = farthest[0];
    const seals = shuffle(
      positions.filter(
        (position) => !samePosition(position, startPosition) && !samePosition(position, endPosition)
      )
    ).slice(0, WORMHOLE_CHALLENGE_SEAL_COUNT);

    let candidate: WormholeChallenge = {
      version: 1,
      startPosition: { ...startPosition },
      endPosition: { ...endPosition },
      seals: seals.map((position) => ({ ...position })),
      obstacles: [],
    };

    const initialSteps = getWormholeChallengeCompletionSteps(candidate);
    if (initialSteps === null || initialSteps < WORMHOLE_CHALLENGE_MIN_STEPS
      || initialSteps > WORMHOLE_CHALLENGE_MAX_STEPS) continue;

    for (const wall of shuffle(allCanonicalWalls())) {
      if (candidate.obstacles.length >= wallTarget) break;
      const next: WormholeChallenge = {
        ...candidate,
        obstacles: [...candidate.obstacles, cloneObstacle(wall)],
      };
      const completionSteps = getWormholeChallengeCompletionSteps(next);
      if (completionSteps !== null
        && completionSteps >= WORMHOLE_CHALLENGE_MIN_STEPS
        && completionSteps <= WORMHOLE_CHALLENGE_MAX_STEPS) candidate = next;
    }

    if (getWormholeChallengeError(candidate) === null) return candidate;
  }

  const fallback: WormholeChallenge = {
    version: 1,
    startPosition: { row: 0, col: 0 },
    endPosition: { row: 2, col: 2 },
    seals: [{ row: 0, col: 5 }, { row: 5, col: 5 }, { row: 5, col: 0 }],
    obstacles: [
      { position: { row: 0, col: 1 }, direction: 'down' },
      { position: { row: 0, col: 2 }, direction: 'down' },
      { position: { row: 1, col: 3 }, direction: 'right' },
      { position: { row: 2, col: 3 }, direction: 'right' },
      { position: { row: 3, col: 1 }, direction: 'right' },
      { position: { row: 4, col: 1 }, direction: 'right' },
      { position: { row: 4, col: 3 }, direction: 'down' },
      { position: { row: 4, col: 4 }, direction: 'down' },
    ],
  };
  return getWormholeChallengeError(fallback) === null ? fallback : null;
}

function draftChallenge(draft: ChallengeDraft): WormholeChallenge | null {
  if (
    !draft.startPosition ||
    !draft.endPosition ||
    draft.seals.length !== WORMHOLE_CHALLENGE_SEAL_COUNT
  ) {
    return null;
  }

  return {
    version: 1,
    startPosition: { ...draft.startPosition },
    endPosition: { ...draft.endPosition },
    seals: draft.seals.map((position) => ({ ...position })),
    obstacles: draft.obstacles.map(cloneObstacle),
  };
}

function stepAvailable(step: ChallengeStep, draft: ChallengeDraft): boolean {
  if (step === 'start') return true;
  if (!draft.startPosition) return false;
  if (step === 'seals') return true;
  if (draft.seals.length !== WORMHOLE_CHALLENGE_SEAL_COUNT) return false;
  if (step === 'end') return true;
  return !!draft.endPosition;
}

function cellInstruction(step: ChallengeStep): string {
  if (step === 'start') return '내부 시작점으로 선택';
  if (step === 'seals') return '봉인 지점으로 전환';
  if (step === 'end') return '내부 출구로 선택';
  return '벽 편집 중인 내부 칸';
}

function draftHint(draft: ChallengeDraft): string {
  if (!draft.startPosition) return '내부 시작점을 선택하세요.';
  if (draft.seals.length !== WORMHOLE_CHALLENGE_SEAL_COUNT) {
    return `봉인 지점을 ${WORMHOLE_CHALLENGE_SEAL_COUNT - draft.seals.length}개 더 선택하세요.`;
  }
  if (!draft.endPosition) return '내부 출구를 선택하세요.';
  return '벽을 배치한 뒤 구성이 유효하면 완료할 수 있습니다.';
}

const WormholeChallengeEditor: React.FC<WormholeChallengeEditorProps> = ({
  entrance,
  returnExit,
  onComplete,
  onCancel,
}) => {
  const [history, setHistory] = useState<ChallengeHistory>(() => ({
    past: [],
    present: {
      step: 'start',
      startPosition: null,
      endPosition: null,
      seals: [],
      obstacles: [],
    },
    future: [],
  }));
  const [announcement, setAnnouncement] = useState('내부 시작점을 선택하세요.');
  const [activeGridCoordinate, setActiveGridCoordinate] = useState<GridCoordinate>({ row: 0, col: 0 });
  const headingRef = useRef<HTMLHeadingElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);

  const draft = history.present;
  const candidate = useMemo(() => draftChallenge(draft), [draft]);
  const validationError = useMemo(
    () => candidate ? getWormholeChallengeError(candidate) : draftHint(draft),
    [candidate, draft]
  );
  const canComplete = !!candidate && validationError === null;

  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  const pushDraft = useCallback((update: (current: ChallengeDraft) => ChallengeDraft) => {
    setHistory((current) => {
      const next = cloneDraft(update(cloneDraft(current.present)));
      if (JSON.stringify(next) === JSON.stringify(current.present)) return current;
      return {
        past: [...current.past, cloneDraft(current.present)].slice(-HISTORY_LIMIT),
        present: next,
        future: [],
      };
    });
  }, []);

  const navigateToStep = (step: ChallengeStep) => {
    if (!stepAvailable(step, draft)) return;
    setHistory((current) => ({
      ...current,
      present: { ...current.present, step },
    }));
    setAnnouncement(
      step === 'start'
        ? '내부 시작점 단계입니다.'
        : step === 'seals'
          ? `봉인 지점 단계입니다. ${draft.seals.length}/${WORMHOLE_CHALLENGE_SEAL_COUNT}`
          : step === 'end'
            ? '내부 출구 단계입니다.'
            : '벽 배치 단계입니다.'
    );
  };

  const undo = () => {
    setHistory((current) => {
      const previous = current.past.at(-1);
      if (!previous) return current;
      return {
        past: current.past.slice(0, -1),
        present: cloneDraft(previous),
        future: [cloneDraft(current.present), ...current.future].slice(0, HISTORY_LIMIT),
      };
    });
    setAnnouncement('내부 미로 편집을 한 단계 취소했습니다.');
  };

  const redo = () => {
    setHistory((current) => {
      const next = current.future[0];
      if (!next) return current;
      return {
        past: [...current.past, cloneDraft(current.present)].slice(-HISTORY_LIMIT),
        present: cloneDraft(next),
        future: current.future.slice(1),
      };
    });
    setAnnouncement('취소한 내부 미로 편집을 다시 적용했습니다.');
  };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== 'z') return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (event.shiftKey) redo();
      else undo();
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  });

  const handleCell = (position: Position) => {
    if (draft.step === 'walls') return;

    if (draft.step === 'start') {
      pushDraft((current) => ({
        ...current,
        startPosition: { ...position },
        endPosition: samePosition(current.endPosition, position) ? null : current.endPosition,
        seals: current.seals.filter((seal) => !samePosition(seal, position)),
        step: 'seals',
      }));
      setAnnouncement(`${cellLabel(position)}을 내부 시작점으로 정했습니다. 봉인 지점을 선택하세요.`);
      return;
    }

    if (draft.step === 'seals') {
      if (samePosition(draft.startPosition, position) || samePosition(draft.endPosition, position)) {
        setAnnouncement('시작점이나 내부 출구에는 봉인을 놓을 수 없습니다.');
        return;
      }
      const existing = draft.seals.some((seal) => samePosition(seal, position));
      if (!existing && draft.seals.length >= WORMHOLE_CHALLENGE_SEAL_COUNT) {
        setAnnouncement(`봉인은 정확히 ${WORMHOLE_CHALLENGE_SEAL_COUNT}개만 놓을 수 있습니다.`);
        return;
      }
      const nextCount = existing ? draft.seals.length - 1 : draft.seals.length + 1;
      pushDraft((current) => ({
        ...current,
        seals: existing
          ? current.seals.filter((seal) => !samePosition(seal, position))
          : [...current.seals, { ...position }],
        step: !existing && nextCount === WORMHOLE_CHALLENGE_SEAL_COUNT ? 'end' : 'seals',
      }));
      setAnnouncement(
        existing
          ? `${cellLabel(position)}의 봉인을 제거했습니다. ${nextCount}/${WORMHOLE_CHALLENGE_SEAL_COUNT}`
          : `${cellLabel(position)}에 봉인을 놓았습니다. ${nextCount}/${WORMHOLE_CHALLENGE_SEAL_COUNT}${
              nextCount === WORMHOLE_CHALLENGE_SEAL_COUNT ? ' · 내부 출구를 선택하세요.' : ''
            }`
      );
      return;
    }

    if (
      samePosition(draft.startPosition, position) ||
      draft.seals.some((seal) => samePosition(seal, position))
    ) {
      setAnnouncement('시작점이나 봉인 지점에는 내부 출구를 놓을 수 없습니다.');
      return;
    }
    pushDraft((current) => ({ ...current, endPosition: { ...position }, step: 'walls' }));
    setAnnouncement(`${cellLabel(position)}을 내부 출구로 정했습니다. 벽을 배치하세요.`);
  };

  const toggleWall = (wall: Obstacle) => {
    if (draft.step !== 'walls') return;
    const key = wallKey(wall);
    const exists = draft.obstacles.some((obstacle) => wallKey(obstacle) === key);
    if (!exists && draft.obstacles.length >= WORMHOLE_CHALLENGE_MAX_WALLS) {
      setAnnouncement(`내부 벽은 최대 ${WORMHOLE_CHALLENGE_MAX_WALLS}개까지 놓을 수 있습니다.`);
      return;
    }
    pushDraft((current) => ({
      ...current,
      obstacles: exists
        ? current.obstacles.filter((obstacle) => wallKey(obstacle) !== key)
        : [...current.obstacles, cloneObstacle(wall)],
    }));
    setAnnouncement(
      `${cellLabel(wall.position)} ${wall.direction} 벽을 ${exists ? '제거' : '설치'}했습니다.`
    );
  };

  const applyAutomaticChallenge = () => {
    const generated = automaticChallenge();
    if (!generated) {
      setAnnouncement('유효한 자동 구성을 만들지 못했습니다. 다시 시도해 주세요.');
      return;
    }
    pushDraft(() => ({
      step: 'walls',
      startPosition: { ...generated.startPosition },
      endPosition: { ...generated.endPosition },
      seals: generated.seals.map((position) => ({ ...position })),
      obstacles: generated.obstacles.map(cloneObstacle),
    }));
    setAnnouncement(`자동 구성을 만들었습니다. 내부 벽 ${generated.obstacles.length}개입니다.`);
  };

  const complete = () => {
    if (!candidate || getWormholeChallengeError(candidate) !== null) return;
    onComplete(cloneChallenge(candidate));
  };

  const stepLabels: Record<ChallengeStep, string> = {
    start: '내부 시작',
    seals: `봉인 ${draft.seals.length}/${WORMHOLE_CHALLENGE_SEAL_COUNT}`,
    end: '내부 출구',
    walls: `벽 ${draft.obstacles.length}/${WORMHOLE_CHALLENGE_MAX_WALLS}`,
  };

  const gridMode = draft.step === 'walls' ? 'walls' : 'cells';
  const defaultCoordinate: GridCoordinate = gridMode === 'walls' ? { row: 0, col: 1 } : { row: 0, col: 0 };
  const activeCoordinateMatchesMode = gridMode === 'cells'
    ? activeGridCoordinate.row % 2 === 0 && activeGridCoordinate.col % 2 === 0
    : (activeGridCoordinate.row + activeGridCoordinate.col) % 2 === 1;
  const rovingCoordinate = activeCoordinateMatchesMode ? activeGridCoordinate : defaultCoordinate;

  const focusCoordinate = (coordinate: GridCoordinate) => {
    setActiveGridCoordinate(coordinate);
    requestAnimationFrame(() => {
      const target = gridRef.current?.querySelector<HTMLElement>(
        `[data-grid-row="${coordinate.row}"][data-grid-col="${coordinate.col}"]`
      );
      target?.focus();
    });
  };

  const moveGridFocus = (event: React.KeyboardEvent, coordinate: GridCoordinate) => {
    if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();

    if (gridMode === 'cells') {
      if (event.key === 'Home') return focusCoordinate({ row: 0, col: 0 });
      if (event.key === 'End') {
        return focusCoordinate({ row: GRID_LENGTH - 1, col: GRID_LENGTH - 1 });
      }
      const rowDelta = event.key === 'ArrowUp' ? -2 : event.key === 'ArrowDown' ? 2 : 0;
      const colDelta = event.key === 'ArrowLeft' ? -2 : event.key === 'ArrowRight' ? 2 : 0;
      focusCoordinate({
        row: Math.min(GRID_LENGTH - 1, Math.max(0, coordinate.row + rowDelta)),
        col: Math.min(GRID_LENGTH - 1, Math.max(0, coordinate.col + colDelta)),
      });
      return;
    }

    const walls = allCanonicalWalls().map((wall) =>
      wall.direction === 'right'
        ? { row: wall.position.row * 2, col: wall.position.col * 2 + 1 }
        : { row: wall.position.row * 2 + 1, col: wall.position.col * 2 }
    );
    const currentIndex = Math.max(
      0,
      walls.findIndex((wall) => wall.row === coordinate.row && wall.col === coordinate.col)
    );
    const nextIndex = event.key === 'Home'
      ? 0
      : event.key === 'End'
        ? walls.length - 1
        : event.key === 'ArrowUp' || event.key === 'ArrowLeft'
          ? Math.max(0, currentIndex - 1)
          : Math.min(walls.length - 1, currentIndex + 1);
    focusCoordinate(walls[nextIndex]);
  };

  const renderCell = (row: number, col: number) => {
    const position = { row, col };
    const gridCoordinate = { row: row * 2, col: col * 2 };
    const isStart = samePosition(draft.startPosition, position);
    const isEnd = samePosition(draft.endPosition, position);
    const isSeal = draft.seals.some((seal) => samePosition(seal, position));
    const marker = isStart ? 'S' : isEnd ? 'E' : isSeal ? '◆' : null;
    const markerLabel = isStart ? '내부 시작점' : isEnd ? '내부 출구' : isSeal ? '봉인 지점' : '빈 칸';
    const interactive = gridMode === 'cells';
    const active = interactive && rovingCoordinate.row === gridCoordinate.row && rovingCoordinate.col === gridCoordinate.col;
    const floorStyle = PASSABLE_FLOOR_STYLES[(row + col) % 2];

    return (
      <button
        key={`cell-${row}-${col}`}
        type="button"
        role="gridcell"
        data-challenge-cell={`${row},${col}`}
        data-grid-row={gridCoordinate.row}
        data-grid-col={gridCoordinate.col}
        className={`relative flex h-10 w-10 items-center justify-center ${floorStyle} text-slate-900 shadow-[inset_0_0_0_1px_rgb(100_116_139/0.22)] transition-colors focus-visible:z-20 focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-500 sm:h-[41px] sm:w-[41px] ${
          interactive ? 'cell-hit-target cursor-pointer hover:brightness-[0.97]' : 'cursor-default'
        }`}
        tabIndex={active ? 0 : -1}
        aria-selected={isStart || isEnd || isSeal}
        aria-disabled={!interactive || undefined}
        aria-label={`${cellLabel(position)} · ${markerLabel} · ${cellInstruction(draft.step)}`}
        onFocus={() => setActiveGridCoordinate(gridCoordinate)}
        onKeyDown={(event) => moveGridFocus(event, gridCoordinate)}
        onClick={() => {
          // 포인터 포커스를 막았으므로 클릭이 직접 로빙 좌표를 옮긴다.
          setActiveGridCoordinate(gridCoordinate);
          handleCell(position);
        }}
      >
        {marker && (
          <span
            aria-hidden="true"
            className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-black text-white ${
              isStart ? 'bg-emerald-600' : isEnd ? 'bg-rose-600' : 'bg-amber-600'
            }`}
          >
            {marker}
          </span>
        )}
      </button>
    );
  };

  const renderWall = (
    gridRow: number,
    gridCol: number,
    position: Position,
    direction: Direction,
    orientation: 'horizontal' | 'vertical'
  ) => {
    const obstacle = { position, direction };
    const installed = draft.obstacles.some((wall) => wallKey(wall) === wallKey(obstacle));
    const active = gridMode === 'walls' && rovingCoordinate.row === gridRow && rovingCoordinate.col === gridCol;
    const horizontal = orientation === 'horizontal';
    const adjacent = direction === 'right'
      ? { row: position.row, col: position.col + 1 }
      : { row: position.row + 1, col: position.col };

    return (
      <button
        key={`wall-${gridRow}-${gridCol}`}
        type="button"
        role="gridcell"
        data-challenge-wall={`${position.row},${position.col}:${direction}`}
        data-wall-installed={installed ? 'true' : 'false'}
        data-grid-row={gridRow}
        data-grid-col={gridCol}
        className={`relative z-10 flex items-center justify-center bg-transparent transition-colors focus-visible:bg-red-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-red-500 ${
          horizontal ? 'wall-hit-horizontal h-2 w-full' : 'wall-hit-vertical h-full w-2'
        } ${gridMode === 'walls' ? 'cursor-pointer hover:bg-red-100' : 'cursor-default'}`}
        tabIndex={active ? 0 : -1}
        aria-selected={installed}
        aria-disabled={gridMode !== 'walls' || undefined}
        aria-label={`${cellLabel(position)}과 ${cellLabel(adjacent)} 사이 벽 · ${
          installed ? '설치됨, 제거' : '비어 있음, 설치'
        }`}
        onFocus={() => setActiveGridCoordinate({ row: gridRow, col: gridCol })}
        onKeyDown={(event) => moveGridFocus(event, { row: gridRow, col: gridCol })}
        onClick={() => {
          setActiveGridCoordinate({ row: gridRow, col: gridCol });
          toggleWall(obstacle);
        }}
      >
        {installed && (
          <span
            aria-hidden="true"
            className={`${horizontal ? 'h-1/2 w-3/4' : 'h-3/4 w-1/2'} rounded-sm ${NORMAL_WALL_STYLE}`}
          />
        )}
      </button>
    );
  };

  const gridItems: React.ReactNode[] = [];
  for (let gridRow = 0; gridRow < GRID_LENGTH; gridRow += 1) {
    for (let gridCol = 0; gridCol < GRID_LENGTH; gridCol += 1) {
      if (gridRow % 2 === 0 && gridCol % 2 === 0) {
        gridItems.push(renderCell(gridRow / 2, gridCol / 2));
      } else if (gridRow % 2 === 0 && gridCol % 2 === 1) {
        gridItems.push(renderWall(
          gridRow,
          gridCol,
          { row: gridRow / 2, col: (gridCol - 1) / 2 },
          'right',
          'vertical'
        ));
      } else if (gridRow % 2 === 1 && gridCol % 2 === 0) {
        gridItems.push(renderWall(
          gridRow,
          gridCol,
          { row: (gridRow - 1) / 2, col: gridCol / 2 },
          'down',
          'horizontal'
        ));
      } else {
        gridItems.push(<span key={`intersection-${gridRow}-${gridCol}`} aria-hidden="true" className="h-2 w-2" />);
      }
    }
  }

  return (
    <section
      className="mx-auto flex w-full max-w-md min-w-0 flex-col gap-2 overflow-x-hidden rounded-xl border border-cyan-400/50 bg-slate-900/95 p-2 text-slate-100 shadow-xl shadow-black/40"
      data-testid="wormhole-challenge-editor"
      aria-labelledby="wormhole-challenge-title"
    >
      <div className="flex min-w-0 items-start justify-between gap-2">
        <div className="min-w-0">
          <h2
            id="wormhole-challenge-title"
            ref={headingRef}
            tabIndex={-1}
            className="text-sm font-black text-cyan-100 outline-none"
          >
            웜홀 내부 미로
          </h2>
          <p className="mt-0.5 flex flex-wrap gap-1 text-[10px] font-bold text-slate-300">
            <span className="rounded bg-violet-950 px-1.5 py-0.5">입구 {cellLabel(entrance)}</span>
            <span className="rounded bg-cyan-950 px-1.5 py-0.5">복귀 {cellLabel(returnExit)}</span>
          </p>
        </div>
        <button
          type="button"
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-slate-600 bg-slate-800 text-slate-200 hover:border-red-400 hover:text-red-200"
          onClick={onCancel}
          aria-label="웜홀 내부 미로 편집 취소"
        >
          <X size={18} aria-hidden="true" />
        </button>
      </div>

      <div className="grid grid-cols-4 gap-1" aria-label="웜홀 내부 미로 설정 단계">
        {STEP_ORDER.map((step, index) => {
          const available = stepAvailable(step, draft);
          const current = draft.step === step;
          return (
            <button
              key={step}
              type="button"
              className={`min-h-11 min-w-0 rounded-md border px-1 text-[10px] font-black leading-tight ${
                current
                  ? 'border-amber-300 bg-amber-400 text-slate-950'
                  : available
                    ? 'border-slate-600 bg-slate-800 text-slate-200'
                    : 'border-slate-800 bg-slate-950 text-slate-600'
              }`}
              disabled={!available}
              aria-current={current ? 'step' : undefined}
              onClick={() => navigateToStep(step)}
            >
              <span className="block text-[9px] opacity-70">{index + 1}</span>
              <span className="block truncate">{stepLabels[step]}</span>
            </button>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-1.5">
        <button
          type="button"
          className="flex h-11 items-center gap-1 rounded-lg border border-violet-400/60 bg-violet-950 px-3 text-xs font-black text-violet-100 hover:bg-violet-900"
          onClick={applyAutomaticChallenge}
        >
          <Wand2 size={15} aria-hidden="true" /> 자동 구성
        </button>
        <div className="flex gap-1" aria-label="웜홀 내부 미로 편집 기록">
          <button
            type="button"
            className="flex h-11 w-11 items-center justify-center rounded-lg border border-slate-600 bg-slate-800 disabled:cursor-not-allowed disabled:opacity-35"
            onClick={undo}
            disabled={history.past.length === 0}
            aria-label="내부 미로 실행 취소"
          >
            <Undo2 size={17} aria-hidden="true" />
          </button>
          <button
            type="button"
            className="flex h-11 w-11 items-center justify-center rounded-lg border border-slate-600 bg-slate-800 disabled:cursor-not-allowed disabled:opacity-35"
            onClick={redo}
            disabled={history.future.length === 0}
            aria-label="내부 미로 다시 실행"
          >
            <Redo2 size={17} aria-hidden="true" />
          </button>
        </div>
      </div>

      <p className="text-center text-[10px] font-semibold text-slate-300">
        {draft.step === 'start' && '내부에서 시작할 칸을 선택하세요.'}
        {draft.step === 'seals' && `서로 다른 봉인 지점 ${WORMHOLE_CHALLENGE_SEAL_COUNT}개를 선택하세요.`}
        {draft.step === 'end' && '봉인을 모두 지난 뒤 도달할 내부 출구를 선택하세요.'}
        {draft.step === 'walls' && '빈 벽선을 눌러 벽을 설치하거나 다시 눌러 제거하세요.'}
      </p>

      <div className="flex w-full min-w-0 justify-center overflow-x-hidden px-1 py-0.5">
        <div
          ref={gridRef}
          role="grid"
          aria-label={`웜홀 내부 ${BOARD_SIZE}행 ${BOARD_SIZE}열 미로 · 화살표 키로 이동하고 Enter 또는 Space로 선택`}
          aria-rowcount={BOARD_SIZE}
          aria-colcount={BOARD_SIZE}
          data-wormhole-challenge-grid
          data-maze-floor-tone="cream-sage"
          data-wall-pointer-routing="nearest"
          className={`grid max-w-full touch-action-none gap-0 rounded-xl border-4 border-slate-950 ${BOARD_FLOOR_STYLE} p-1 shadow-[0_5px_0_#0f172a,0_12px_22px_rgb(0_0_0/0.35)]`}
          style={{
            gridTemplateColumns: `repeat(${GRID_LENGTH}, auto)`,
            gridTemplateRows: `repeat(${GRID_LENGTH}, auto)`,
          }}
          onPointerDownCapture={(event) => {
            // 포인터 클릭이 셀/벽 버튼에 포커스를 주며 스크롤 컨테이너를
            // 튕기지 않게 막는다 (키보드 로빙 포커스는 그대로 동작한다).
            const target = event.target as HTMLElement | null;
            if (target?.closest?.('[data-challenge-cell], [data-challenge-wall]')) {
              event.preventDefault();
            }
          }}
          onClickCapture={(event) => {
            if (gridMode !== 'walls' || event.detail === 0) return;

            event.preventDefault();
            event.stopPropagation();
            const target = findNearestWallPointerTarget(
              event.currentTarget,
              event.clientX,
              event.clientY,
              'data-challenge-wall'
            );
            if (!target) return;
            setActiveGridCoordinate(target.direction === 'right'
              ? { row: target.position.row * 2, col: target.position.col * 2 + 1 }
              : { row: target.position.row * 2 + 1, col: target.position.col * 2 });
            toggleWall({ position: target.position, direction: target.direction });
          }}
        >
          {gridItems}
        </div>
      </div>

      <div
        className={`min-h-9 rounded-lg border px-2 py-1.5 text-[10px] font-bold ${
          canComplete
            ? 'border-emerald-400/60 bg-emerald-950/70 text-emerald-100'
            : 'border-amber-400/50 bg-amber-950/60 text-amber-100'
        }`}
        role="status"
        aria-live="polite"
        data-testid="wormhole-challenge-status"
      >
        {canComplete ? '내부 미로가 유효합니다. 완료할 수 있습니다.' : validationError}
        <span className="sr-only">{announcement}</span>
      </div>

      <div className="flex gap-2">
        <button
          type="button"
          className="btn-sub h-11 flex-1 text-sm"
          onClick={onCancel}
        >
          취소
        </button>
        <button
          type="button"
          className="btn-game flex h-11 flex-[1.4] items-center justify-center gap-1 text-sm disabled:cursor-not-allowed disabled:opacity-40"
          onClick={complete}
          disabled={!canComplete}
        >
          <Check size={16} aria-hidden="true" /> 내부 미로 완료
        </button>
      </div>
    </section>
  );
};

export default WormholeChallengeEditor;
