'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Anchor,
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Box,
  FastForward,
  Grid2X2,
  ScanSearch,
  ShieldAlert,
} from 'lucide-react';
import LiveBoardGrid, { LiveBoardEntry, LiveBoardViewMode } from '@/components/LiveBoardGrid';
import MobileDirectionPad from '@/components/MobileDirectionPad';
import { BoardFx } from '@/components/three/GameBoard3D';
import { Direction, GameMap, GamePhase, GameState, MazeSkillId } from '@/types/game';
import {
  MoveTurnOutcome,
  getPlayerMazeSkillState,
  isVisionObscuredForPlayer,
  normalizeConsumed,
  resolveTurnAction,
  settleCompletedGameState,
  TurnAction,
  TurnOutcome,
} from '@/lib/gameTurn';
import { MAZE_SKILL_DEFINITIONS } from '@/lib/mazeSkills';
import {
  choosePracticeAiAction,
  createMapTestGameState,
  createPracticeGameState,
  getPracticeCollisionWalls,
  getPracticeStandings,
  PRACTICE_AI_IDS,
  PRACTICE_PAWN_COLORS,
  PRACTICE_USER_ID,
  PracticeStanding,
  practiceWallKey,
} from '@/lib/practiceBattle';
import { getMapItems, getNextTurnPlayerId, isSamePosition } from '@/lib/gameUtils';

const MAX_AI_MOVES = 200;

const SKILL_ICONS: Record<MazeSkillId, typeof ScanSearch> = {
  scoutPulse: ScanSearch,
  breach: ShieldAlert,
  anchor: Anchor,
  dash: FastForward,
};

interface RacerVisualState {
  fx: BoardFx | null;
  via: MoveTurnOutcome['attempted'][] | null;
}

export interface PracticeBattleResult {
  standings: PracticeStanding[];
  winnerId: string | null;
  draw: boolean;
}

interface PracticeBattleProps {
  playerMap: GameMap;
  aiCount: number;
  mode?: 'race' | 'mapTest';
  onComplete: (result: PracticeBattleResult) => void;
}

function outcomeVisual(outcome: TurnOutcome, key: number): RacerVisualState {
  if (outcome.type === 'radar') {
    return {
      fx: { key, type: 'radar', at: outcome.position },
      via: null,
    };
  }

  if (outcome.type === 'skill') {
    if (outcome.reachedGoal) {
      return {
        fx: { key, type: 'goal', at: outcome.position },
        via: outcome.via || null,
      };
    }
    if (outcome.landingEffect === 'mine') {
      return {
        fx: { key, type: 'mine', at: outcome.itemPosition, delay: 0.35 },
        via: outcome.via || null,
      };
    }
    if (outcome.landingEffect === 'wormhole') {
      return {
        fx: { key, type: 'wormhole', at: outcome.itemPosition, to: outcome.wormholeExit, delay: 0.35 },
        via: outcome.via || null,
      };
    }
    if (outcome.skillId === 'scoutPulse') {
      return {
        fx: { key, type: 'radar', at: outcome.position },
        via: null,
      };
    }
    return { fx: null, via: outcome.via || null };
  }

  if (outcome.reachedGoal) {
    return {
      fx: { key, type: 'goal', at: outcome.position },
      via: outcome.effect === 'wormhole' ? [outcome.attempted] : null,
    };
  }
  if (outcome.effect === 'bump') {
    return {
      fx: { key, type: 'bump', at: outcome.origin, dir: outcome.direction },
      via:
        outcome.wallEffect === 'thornWall' && !isSamePosition(outcome.position, outcome.origin)
          ? [outcome.origin]
          : null,
    };
  }
  if (outcome.effect === 'mine') {
    return {
      fx: { key, type: 'mine', at: outcome.itemPosition, delay: 0.35 },
      via: [outcome.attempted, outcome.origin],
    };
  }
  if (outcome.effect === 'wormhole') {
    return {
      fx: { key, type: 'wormhole', at: outcome.itemPosition, to: outcome.wormholeExit, delay: 0.35 },
      via: [outcome.attempted],
    };
  }
  if (
    (outcome.wallEffect === 'iceWall' ||
      outcome.wallEffect === 'windWall' ||
      outcome.wallEffect === 'mirrorWall') &&
    !isSamePosition(outcome.position, outcome.attempted)
  ) {
    return { fx: null, via: [outcome.attempted] };
  }
  return { fx: null, via: null };
}

const PracticeBattle: React.FC<PracticeBattleProps> = ({
  playerMap,
  aiCount,
  mode = 'race',
  onComplete,
}) => {
  const [gameState, setGameState] = useState<GameState>(() =>
    mode === 'mapTest' ? createMapTestGameState(playerMap) : createPracticeGameState(playerMap, aiCount)
  );
  const [viewMode, setViewMode] = useState<LiveBoardViewMode>('2d');
  const [visuals, setVisuals] = useState<Record<string, RacerVisualState>>({});
  const [armedSkill, setArmedSkill] = useState<'breach' | 'dash' | null>(null);
  const [skillNotice, setSkillNotice] = useState<string>('');
  const stateRef = useRef(gameState);
  const visualKeyRef = useRef(0);
  const completedRef = useRef(false);
  const actedTurnRef = useRef<string | null>(null);
  const probeCountsRef = useRef<Record<string, Record<string, number>>>({});

  const dispatchAction = useCallback((runnerId: string, action: TurnAction, expectedTurn?: number) => {
    const current = stateRef.current;
    if (expectedTurn !== undefined && current.turnNumber !== expectedTurn) return null;
    const resolved = resolveTurnAction(current, runnerId, action);
    if (!resolved) return null;

    const nextState = settleCompletedGameState(resolved.state);
    stateRef.current = nextState;
    setGameState(nextState);

    visualKeyRef.current += 1;
    setVisuals((previous) => ({
      ...previous,
      [runnerId]: outcomeVisual(resolved.outcome, visualKeyRef.current),
    }));

    if (resolved.outcome.type === 'move' && resolved.outcome.effect === 'bump') {
      const key = practiceWallKey(resolved.outcome.origin, resolved.outcome.direction);
      const currentCounts = probeCountsRef.current[runnerId] || {};
      probeCountsRef.current[runnerId] = {
        ...currentCounts,
        [key]: (currentCounts[key] || 0) + 1,
      };
    }

    return resolved.outcome;
  }, []);

  const retireAi = useCallback((runnerId: string, expectedTurn: number) => {
    const current = stateRef.current;
    if (
      current.phase !== GamePhase.PLAY ||
      current.currentTurn !== runnerId ||
      current.turnNumber !== expectedTurn ||
      !current.players[runnerId]
    ) {
      return false;
    }

    const players = {
      ...current.players,
      [runnerId]: {
        ...current.players[runnerId],
        forfeited: true,
      },
    };
    const nextState = settleCompletedGameState({
      ...current,
      players,
      currentTurn: getNextTurnPlayerId(players, runnerId, current.turnOrder),
      turnNumber: (current.turnNumber || 1) + 1,
      turnMessage: `${players[runnerId].displayName || 'AI'}가 경로 탐색을 중단했습니다.`,
      turnMessageTimestamp: Date.now(),
    });
    stateRef.current = nextState;
    setGameState(nextState);
    return true;
  }, []);

  useEffect(() => {
    stateRef.current = gameState;
  }, [gameState]);

  useEffect(() => {
    if (gameState.phase !== GamePhase.END || completedRef.current) return;
    completedRef.current = true;
    onComplete({
      standings: getPracticeStandings(gameState),
      winnerId: gameState.winner ?? null,
      draw: !!gameState.draw,
    });
  }, [gameState, onComplete]);

  const currentTurnId = gameState.currentTurn;
  const aiThinking = gameState.phase === GamePhase.PLAY && !!currentTurnId && PRACTICE_AI_IDS.includes(
    currentTurnId as (typeof PRACTICE_AI_IDS)[number]
  );

  useEffect(() => {
    if (!aiThinking || !currentTurnId) return;
    const expectedTurn = gameState.turnNumber || 1;
    const turnToken = `${currentTurnId}:${expectedTurn}`;
    if (actedTurnRef.current === turnToken) return;

    const timer = window.setTimeout(() => {
      if (stateRef.current.currentTurn !== currentTurnId || stateRef.current.turnNumber !== expectedTurn) return;
      if ((stateRef.current.players[currentTurnId]?.moves || 0) >= MAX_AI_MOVES) {
        if (retireAi(currentTurnId, expectedTurn)) actedTurnRef.current = turnToken;
        return;
      }
      const action = choosePracticeAiAction(
        stateRef.current,
        currentTurnId,
        probeCountsRef.current[currentTurnId] || {}
      );
      let outcome = action ? dispatchAction(currentTurnId, action, expectedTurn) : null;
      if (!outcome && action?.type === 'skill' && action.direction) {
        outcome = dispatchAction(
          currentTurnId,
          { type: 'move', direction: action.direction },
          expectedTurn
        );
      }
      if (outcome) {
        actedTurnRef.current = turnToken;
      } else if (retireAi(currentTurnId, expectedTurn)) {
        actedTurnRef.current = turnToken;
      }
    }, 420);

    return () => window.clearTimeout(timer);
  }, [aiThinking, currentTurnId, gameState.turnNumber, dispatchAction, retireAi]);

  const isHumanTurn = gameState.phase === GamePhase.PLAY && currentTurnId === PRACTICE_USER_ID;
  const humanFinished = !!gameState.players[PRACTICE_USER_ID]?.finished;

  useEffect(() => {
    if (!isHumanTurn) {
      setArmedSkill(null);
      setSkillNotice('');
    }
  }, [isHumanTurn]);

  const handleHumanMove = useCallback((direction: Direction) => {
    if (!isHumanTurn || humanFinished) return;
    if (armedSkill) {
      const outcome = dispatchAction(PRACTICE_USER_ID, {
        type: 'skill',
        skillId: armedSkill,
        direction,
      });
      setArmedSkill(null);
      setSkillNotice(outcome ? '' : '그 방향으로는 스킬을 사용할 수 없습니다.');
      return;
    }
    setSkillNotice('');
    dispatchAction(PRACTICE_USER_ID, { type: 'move', direction });
  }, [armedSkill, dispatchAction, humanFinished, isHumanTurn]);

  useEffect(() => {
    const keyDirections: Record<string, Direction> = {
      ArrowUp: 'up',
      ArrowDown: 'down',
      ArrowLeft: 'left',
      ArrowRight: 'right',
      w: 'up',
      W: 'up',
      s: 'down',
      S: 'down',
      a: 'left',
      A: 'left',
      d: 'right',
      D: 'right',
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
      const direction = keyDirections[event.key];
      if (!direction) return;
      event.preventDefault();
      handleHumanMove(direction);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [handleHumanMove]);

  const ownMap = gameState.maps?.[PRACTICE_USER_ID];
  const ownItems = getMapItems(ownMap);
  const ownConsumed = normalizeConsumed(gameState.itemState?.[PRACTICE_USER_ID]?.consumed);
  const radarIndex = ownItems.findIndex((item, index) => item.type === 'radar' && !ownConsumed[index]);
  const mazeSkill = getPlayerMazeSkillState(gameState, PRACTICE_USER_ID, ownMap);
  const equippedSkill = mazeSkill.loadout[0];
  const skillConsumed = !equippedSkill || !!mazeSkill.consumed[equippedSkill];
  const SkillIcon = equippedSkill ? SKILL_ICONS[equippedSkill] : ScanSearch;

  const handleRadar = () => {
    if (!isHumanTurn || humanFinished || radarIndex < 0) return;
    dispatchAction(PRACTICE_USER_ID, { type: 'radar', itemIndex: radarIndex });
  };

  const handleSkill = () => {
    if (!isHumanTurn || humanFinished || !equippedSkill || skillConsumed) return;
    if (equippedSkill === 'anchor') {
      setSkillNotice('공간 닻은 첫 강제 이동에 자동 발동합니다.');
      return;
    }
    if (equippedSkill === 'scoutPulse') {
      const outcome = dispatchAction(PRACTICE_USER_ID, { type: 'skill', skillId: 'scoutPulse' });
      setSkillNotice(outcome ? '' : '현재 정찰 파동을 사용할 수 없습니다.');
      return;
    }
    setSkillNotice('방향을 선택하세요.');
    setArmedSkill((current) => current === equippedSkill ? null : equippedSkill);
  };

  const boards = useMemo<LiveBoardEntry[]>(() => {
    const collisions = getPracticeCollisionWalls(gameState);
    return (gameState.turnOrder || []).flatMap((runnerId) => {
      const player = gameState.players[runnerId];
      const ownerId = gameState.assignments?.[runnerId];
      const playedMap = ownerId ? gameState.maps?.[ownerId] : null;
      if (!player || !ownerId || !playedMap) return [];
      const mapItemState = gameState.itemState?.[ownerId];

      return [{
        runnerId,
        runnerName: player.displayName || runnerId,
        runnerKind: runnerId === PRACTICE_USER_ID ? 'human' as const : 'ai' as const,
        mapOwnerId: ownerId,
        mapOwnerName: gameState.players[ownerId]?.displayName || null,
        map: playedMap,
        position: player.position || playedMap.startPosition,
        moves: player.moves || 0,
        finished: !!player.finished,
        finishMoves: player.finishMoves ?? null,
        forfeited: !!player.forfeited,
        collisions: collisions.filter(
          (entry) => entry.playerId === runnerId && entry.mapOwnerId === ownerId
        ),
        itemsConsumed: normalizeConsumed(mapItemState?.consumed),
        itemActiveWalls: normalizeConsumed(mapItemState?.activeWalls),
        itemPhaseOpen: normalizeConsumed(mapItemState?.phaseOpen),
        revealedWalls: gameState.revealedWallsByPlayer?.[runnerId] || [],
        fx: visuals[runnerId]?.fx || null,
        via: visuals[runnerId]?.via || null,
        celebrating: !!player.finished,
        revealObstacles: mode === 'mapTest' || !!player.finished,
        revealMapSecrets: mode === 'mapTest',
        pawnColor: PRACTICE_PAWN_COLORS[runnerId],
        smokeAffected: isVisionObscuredForPlayer(gameState, runnerId),
        visionObscured:
          mode === 'race' &&
          runnerId === PRACTICE_USER_ID &&
          gameState.currentTurn === runnerId &&
          isVisionObscuredForPlayer(gameState, runnerId),
      }];
    });
  }, [gameState, mode, visuals]);

  const currentTurnName = currentTurnId
    ? gameState.players[currentTurnId]?.displayName || '플레이어'
    : '경기 종료';
  const turnLabel = gameState.phase === GamePhase.END
    ? mode === 'mapTest' ? '테스트 완료' : '경기 종료'
    : humanFinished
      ? `${currentTurnName} 차례 · 관전 중`
      : isHumanTurn
        ? mode === 'mapTest' ? '내 맵 테스트' : '내 차례'
        : `${currentTurnName} 차례`;

  const controlDisabled = !isHumanTurn || humanFinished || gameState.phase === GamePhase.END;
  const moveButton = (direction: Direction, label: string, Icon: typeof ArrowUp) => (
    <button
      type="button"
      className="btn-dpad !h-11 !w-11 !rounded-lg sm:!h-12 sm:!w-12"
      onClick={() => handleHumanMove(direction)}
      disabled={controlDisabled}
      title={label}
      aria-label={label}
    >
      <Icon size={19} aria-hidden="true" />
    </button>
  );

  return (
    <div
      className="absolute inset-0 overflow-hidden bg-slate-950"
      data-testid="practice-match"
      data-practice-mode={mode}
      data-ai-count={mode === 'mapTest' ? 0 : aiCount}
      data-ai-thinking={aiThinking ? 'true' : 'false'}
    >
      <div className="absolute inset-x-1 top-1 z-20 h-12 sm:inset-x-2">
        <div className="game-panel flex h-full min-w-0 items-center justify-between gap-2 !rounded-lg px-2 sm:px-3">
          <div className="flex min-w-0 items-center gap-2">
            <span className="shrink-0 text-[10px] font-black text-slate-500" data-testid="turn-number">
              전체 {Math.max(0, (gameState.turnNumber || 1) - 1)}턴
            </span>
            <span
              className={isHumanTurn ? 'badge-turn shrink-0 !px-2 !py-0.5' : 'shrink-0 text-[11px] font-bold text-amber-300'}
              data-testid="turn-owner"
              aria-live="polite"
            >
              {turnLabel}
            </span>
            <span className="hidden min-w-0 truncate text-[10px] text-slate-400 min-[430px]:block">
              {gameState.turnMessage}
            </span>
          </div>

          <div className="flex shrink-0 items-center gap-1" aria-label="보드 시점">
            <button
              type="button"
              className={`flex size-11 items-center justify-center rounded-md border ${
                viewMode === '2d' ? 'border-amber-400 bg-amber-400 text-slate-950' : 'border-slate-600 bg-slate-800 text-slate-300'
              }`}
              onClick={() => setViewMode('2d')}
              title="2D 보드"
              aria-label="2D 보드"
              aria-pressed={viewMode === '2d'}
            >
              <Grid2X2 size={15} aria-hidden="true" />
            </button>
            <button
              type="button"
              className={`flex size-11 items-center justify-center rounded-md border ${
                viewMode === 'third' ? 'border-amber-400 bg-amber-400 text-slate-950' : 'border-slate-600 bg-slate-800 text-slate-300'
              }`}
              onClick={() => setViewMode('third')}
              title="3D 보드"
              aria-label="3D 보드"
              aria-pressed={viewMode === 'third'}
            >
              <Box size={15} aria-hidden="true" />
            </button>
          </div>
        </div>
      </div>

      <div
        className="pointer-events-none absolute inset-x-2 top-[54px] z-30 flex h-5 items-center justify-center min-[430px]:hidden"
        aria-live="polite"
        data-testid="mobile-turn-message"
      >
        <span className="max-w-full truncate rounded border border-slate-700 bg-slate-950/90 px-2 py-0.5 text-[10px] text-slate-300">
          {gameState.turnMessage || '행동 결과 대기 중'}
        </span>
      </div>

      <div
        className="absolute inset-x-1 top-[76px] min-h-0 min-[430px]:top-[54px] sm:inset-x-2"
        style={{ bottom: 'calc(60px + env(safe-area-inset-bottom))' }}
      >
        <LiveBoardGrid
          boards={boards}
          currentTurnId={currentTurnId}
          myPlayerId={PRACTICE_USER_ID}
          viewMode={viewMode}
          gameEnded={gameState.phase === GamePhase.END}
          className="h-full"
          renderOverlay={(board) => board.runnerId === PRACTICE_USER_ID && !humanFinished ? (
            <MobileDirectionPad
              disabled={controlDisabled}
              active={isHumanTurn}
              onMove={handleHumanMove}
              testId="practice-mobile-direction-pad"
            />
          ) : null}
        />
      </div>

      {skillNotice && (
        <div
          className="pointer-events-none absolute inset-x-2 bottom-[64px] z-40 flex justify-center"
          aria-live="polite"
        >
          <span className="rounded border border-emerald-400/50 bg-slate-950/95 px-2 py-1 text-[10px] font-bold text-emerald-200">
            {skillNotice}
          </span>
        </div>
      )}

      <div
        className="absolute inset-x-0 bottom-0 z-30 flex h-[58px] items-center justify-center gap-1.5 border-t border-slate-800 bg-slate-950/95 px-2 backdrop-blur-sm"
        style={{ paddingBottom: 'env(safe-area-inset-bottom)', height: 'calc(58px + env(safe-area-inset-bottom))' }}
        data-testid="practice-controls"
      >
        <div className="hidden items-center gap-1.5 sm:flex">
          {moveButton('left', '왼쪽으로 이동', ArrowLeft)}
          {moveButton('up', '위로 이동', ArrowUp)}
          {moveButton('down', '아래로 이동', ArrowDown)}
          {moveButton('right', '오른쪽으로 이동', ArrowRight)}
        </div>
        <button
          type="button"
          className={`ml-1 flex h-11 min-w-11 items-center justify-center gap-1 rounded-lg border px-2 text-[10px] font-bold sm:h-12 ${
            armedSkill
              ? 'border-emerald-300 bg-emerald-400 text-slate-950'
              : equippedSkill === 'anchor' && !skillConsumed
                ? 'border-cyan-400 bg-cyan-500/15 text-cyan-200'
                : 'border-emerald-500/60 bg-slate-900 text-emerald-200'
          } disabled:opacity-35`}
          onClick={handleSkill}
          disabled={controlDisabled || skillConsumed}
          title={equippedSkill ? `${MAZE_SKILL_DEFINITIONS[equippedSkill].label}${equippedSkill === 'anchor' ? ' · 자동 발동' : ''}` : '스킬 없음'}
          aria-label={equippedSkill ? `${MAZE_SKILL_DEFINITIONS[equippedSkill].label}${equippedSkill === 'anchor' ? ' 자동 발동' : ' 사용'}` : '스킬 없음'}
          aria-pressed={!!armedSkill}
        >
          <SkillIcon size={17} aria-hidden="true" />
          <span className="hidden min-[430px]:inline">
            {equippedSkill ? MAZE_SKILL_DEFINITIONS[equippedSkill].label : '스킬'}
          </span>
        </button>
        <button
          type="button"
          className="btn-game ml-1 flex h-11 min-w-11 items-center justify-center gap-1 !rounded-lg px-2 text-[10px] sm:h-12"
          onClick={handleRadar}
          disabled={controlDisabled || radarIndex < 0}
          title="탐지기 사용"
          aria-label="탐지기 사용"
        >
          <ScanSearch size={17} aria-hidden="true" />
          {radarIndex >= 0 && <span className="hidden min-[390px]:inline">탐지</span>}
        </button>
      </div>
    </div>
  );
};

export default PracticeBattle;
