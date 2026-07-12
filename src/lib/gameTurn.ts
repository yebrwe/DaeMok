import {
  CollisionWall,
  Direction,
  GameMap,
  GamePhase,
  GameState,
  Obstacle,
  Position,
} from '@/types/game';
import {
  canMove,
  findBlockingOneTimeWall,
  getMapItems,
  getNewPosition,
  getNextTurnPlayerId,
  isPositionInBoard,
  isSamePosition,
  isSameWallSegment,
} from '@/lib/gameUtils';

export type TurnMoveEffect = 'move' | 'bump' | 'mine' | 'wormhole' | 'smoke';

export type TurnAction =
  | { type: 'move'; direction: Direction }
  | { type: 'radar'; itemIndex?: number };

export interface MoveTurnOutcome {
  type: 'move';
  direction: Direction;
  origin: Position;
  attempted: Position;
  position: Position;
  moves: number;
  effect: TurnMoveEffect;
  consumedItemIndex: number | null;
  itemPosition?: Position;
  wormholeExit?: Position;
  reachedGoal: boolean;
  message: string;
}

export interface RadarTurnOutcome {
  type: 'radar';
  itemIndex: number;
  found: Obstacle[];
  position: Position;
  moves: number;
  message: string;
}

export type TurnOutcome = MoveTurnOutcome | RadarTurnOutcome;

export interface TurnResolution {
  state: GameState;
  outcome: TurnOutcome;
}

export function normalizeConsumed(value: unknown): Record<number, boolean> {
  if (value === true) return { 0: true };
  return value && typeof value === 'object' ? { ...(value as Record<number, boolean>) } : {};
}

export function isVisionObscuredForPlayer(
  state: GameState | null | undefined,
  playerId: string
): boolean {
  const player = state?.players?.[playerId];
  const effect = state?.visionEffectsByPlayer?.[playerId];
  return !!player && !player.finished && !player.forfeited && !player.hasLeft &&
    effect?.type === 'smoke' && (player.moves || 0) < effect.expiresAtTargetMove;
}

export function mergeWallSegments(current: Obstacle[], incoming: Obstacle[]): Obstacle[] {
  const merged = [...current];
  incoming.forEach((wall) => {
    if (!merged.some((item) => isSameWallSegment(item.position, item.direction, wall.position, wall.direction))) {
      merged.push(wall);
    }
  });
  return merged;
}

export function findRadarWalls(
  position: Position,
  playedMap: GameMap,
  consumed: Record<number, boolean>
): Obstacle[] {
  const mapItems = getMapItems(playedMap);
  const found: Obstacle[] = [];

  for (let dr = -1; dr <= 1; dr += 1) {
    for (let dc = -1; dc <= 1; dc += 1) {
      const cell = { row: position.row + dr, col: position.col + dc };
      if (!isPositionInBoard(cell)) continue;

      (['up', 'down', 'left', 'right'] as Direction[]).forEach((direction) => {
        const target = getNewPosition(cell, direction);
        if (!isPositionInBoard(target)) return;
        const hasWall =
          playedMap.obstacles.some((wall) => isSameWallSegment(cell, direction, wall.position, wall.direction)) ||
          findBlockingOneTimeWall(cell, direction, mapItems, (index) => !!consumed[index]) >= 0;
        if (hasWall) found.push({ position: cell, direction });
      });
    }
  }

  return mergeWallSegments([], found);
}

export function appendTurnPosition(
  history: Position[] | undefined,
  fallback: Position,
  result: Position
): Position[] {
  const current = Array.isArray(history) && history.length > 0 ? history : [fallback];
  return [...current, result].slice(-8);
}

function collisionRecord(
  value: GameState['collisionWalls']
): Record<string, CollisionWall> {
  if (!value) return {};
  if (!Array.isArray(value)) return { ...value };
  return Object.fromEntries(value.filter(Boolean).map((wall, index) => [`legacy_${index}`, wall]));
}

function resolveMove(
  state: GameState,
  actorId: string,
  direction: Direction,
  playedMap: GameMap,
  mapOwnerId: string,
  now: number
): TurnResolution | null {
  const player = state.players[actorId];
  const origin = player.position || playedMap.startPosition;
  const attempted = getNewPosition(origin, direction);
  if (!isPositionInBoard(attempted)) return null;

  const mapItems = getMapItems(playedMap);
  const consumed = normalizeConsumed(state.itemState?.[mapOwnerId]?.consumed);
  const passesStaticWall = canMove(origin, direction, playedMap.obstacles || []);
  const oneTimeWallIndex = passesStaticWall
    ? findBlockingOneTimeWall(origin, direction, mapItems, (index) => !!consumed[index])
    : -1;
  const blocked = !passesStaticWall || oneTimeWallIndex >= 0;
  const moves = (player.moves || 0) + 1;
  let position = origin;
  let effect: TurnMoveEffect = blocked ? 'bump' : 'move';
  let consumedItemIndex: number | null = null;
  let itemPosition: Position | undefined;
  let wormholeExit: Position | undefined;
  let message = blocked
    ? `${player.displayName || '플레이어'}가 벽에 부딪혔습니다.`
    : `${player.displayName || '플레이어'}가 한 칸 이동했습니다.`;

  if (oneTimeWallIndex >= 0) {
    consumedItemIndex = oneTimeWallIndex;
    consumed[oneTimeWallIndex] = true;
  }

  if (!blocked) {
    position = attempted;
    const mineIndex = mapItems.findIndex(
      (item, index) => item.type === 'mine' && !!item.position && !consumed[index] && isSamePosition(attempted, item.position)
    );
    const wormholeIndex = mapItems.findIndex(
      (item, index) => item.type === 'wormhole' && !!item.entrance && !consumed[index] && isSamePosition(attempted, item.entrance)
    );
    const smokeIndex = mapItems.findIndex(
      (item, index) => item.type === 'smoke' && !!item.position && !consumed[index] && isSamePosition(attempted, item.position)
    );

    if (mineIndex >= 0) {
      const history = Array.isArray(player.positionHistory) && player.positionHistory.length > 0
        ? player.positionHistory
        : [origin];
      position = history.length >= 2 ? history[history.length - 2] : history[0];
      effect = 'mine';
      consumedItemIndex = mineIndex;
      itemPosition = mapItems[mineIndex].position;
      consumed[mineIndex] = true;
      message = `${player.displayName || '플레이어'}가 지뢰를 밟아 2턴 전 위치로 돌아갔습니다.`;
    } else if (wormholeIndex >= 0) {
      position = mapItems[wormholeIndex].exit || attempted;
      effect = 'wormhole';
      consumedItemIndex = wormholeIndex;
      itemPosition = mapItems[wormholeIndex].entrance;
      wormholeExit = mapItems[wormholeIndex].exit;
      consumed[wormholeIndex] = true;
      message = `${player.displayName || '플레이어'}가 웜홀을 통과했습니다.`;
    } else if (smokeIndex >= 0) {
      effect = 'smoke';
      consumedItemIndex = smokeIndex;
      itemPosition = mapItems[smokeIndex].position;
      consumed[smokeIndex] = true;
      message = `${player.displayName || '플레이어'}가 연막 함정을 밟았습니다. 다음 차례의 시야가 가려집니다.`;
    }
  }

  const reachedGoal = isSamePosition(position, playedMap.endPosition);
  const updatedPlayer = {
    ...player,
    position,
    moves,
    positionHistory: appendTurnPosition(player.positionHistory, origin, position),
    ...(reachedGoal ? { finished: true, finishMoves: moves } : {}),
  };
  const players = { ...state.players, [actorId]: updatedPlayer };
  const nextState: GameState = {
    ...state,
    players,
    currentTurn: getNextTurnPlayerId(players, actorId, state.turnOrder),
    turnNumber: (state.turnNumber || 1) + 1,
    turnMessage: message,
    turnMessageTimestamp: now,
  };

  if (consumedItemIndex !== null) {
    nextState.itemState = {
      ...(state.itemState || {}),
      [mapOwnerId]: {
        ...(state.itemState?.[mapOwnerId] || {}),
        consumed,
        consumedAt: now,
      },
    };
  }

  if (effect === 'smoke') {
    nextState.visionEffectsByPlayer = {
      ...(state.visionEffectsByPlayer || {}),
      [actorId]: {
        type: 'smoke',
        sourcePlayerId: mapOwnerId,
        appliedAtTurn: state.turnNumber || 1,
        expiresAtTargetMove: moves + 1,
      },
    };
  }

  if (blocked) {
    const collision: CollisionWall = {
      playerId: actorId,
      position: origin,
      direction,
      timestamp: now,
      mapOwnerId,
    };
    const safePlayerId = actorId.replace(/[.#$\[\]/]/g, '_');
    const collisionKey = `turn_${state.turnNumber || 1}_${safePlayerId}`;
    nextState.collisionWalls = {
      ...collisionRecord(state.collisionWalls),
      [collisionKey]: collision,
    };
  }

  return {
    state: nextState,
    outcome: {
      type: 'move',
      direction,
      origin,
      attempted,
      position,
      moves,
      effect,
      consumedItemIndex,
      itemPosition,
      wormholeExit,
      reachedGoal,
      message,
    },
  };
}

function resolveRadar(
  state: GameState,
  actorId: string,
  requestedIndex: number | undefined,
  playedMap: GameMap,
  ownMap: GameMap,
  mapOwnerId: string,
  now: number
): TurnResolution | null {
  const player = state.players[actorId];
  const ownItems = getMapItems(ownMap);
  const ownConsumed = normalizeConsumed(state.itemState?.[actorId]?.consumed);
  const itemIndex = requestedIndex ?? ownItems.findIndex(
    (item, index) => item.type === 'radar' && !ownConsumed[index]
  );
  if (itemIndex < 0 || ownItems[itemIndex]?.type !== 'radar' || ownConsumed[itemIndex]) return null;

  const mapConsumed = normalizeConsumed(state.itemState?.[mapOwnerId]?.consumed);
  const found = findRadarWalls(player.position, playedMap, mapConsumed);
  const moves = (player.moves || 0) + 1;
  const updatedPlayer = {
    ...player,
    moves,
    positionHistory: appendTurnPosition(player.positionHistory, player.position, player.position),
  };
  const players = { ...state.players, [actorId]: updatedPlayer };
  const revealed = mergeWallSegments(state.revealedWallsByPlayer?.[actorId] || [], found);
  const message = `${player.displayName || '플레이어'}가 탐지기를 사용했습니다.`;

  return {
    state: {
      ...state,
      players,
      itemState: {
        ...(state.itemState || {}),
        [actorId]: {
          ...(state.itemState?.[actorId] || {}),
          consumed: { ...ownConsumed, [itemIndex]: true },
          consumedAt: now,
        },
      },
      revealedWallsByPlayer: {
        ...(state.revealedWallsByPlayer || {}),
        [actorId]: revealed,
      },
      currentTurn: getNextTurnPlayerId(players, actorId, state.turnOrder),
      turnNumber: (state.turnNumber || 1) + 1,
      turnMessage: message,
      turnMessageTimestamp: now,
    },
    outcome: {
      type: 'radar',
      itemIndex,
      found,
      position: player.position,
      moves,
      message,
    },
  };
}

export function resolveTurnAction(
  state: GameState | null | undefined,
  actorId: string,
  action: TurnAction,
  now = Date.now()
): TurnResolution | null {
  if (!state || state.phase !== GamePhase.PLAY || state.currentTurn !== actorId) return null;
  const player = state.players?.[actorId];
  const mapOwnerId = state.assignments?.[actorId];
  const playedMap = mapOwnerId ? state.maps?.[mapOwnerId] : null;
  const ownMap = state.maps?.[actorId];
  if (!player || player.finished || player.forfeited || player.hasLeft || !mapOwnerId || !playedMap || !ownMap) {
    return null;
  }

  const resolved = action.type === 'move'
    ? resolveMove(state, actorId, action.direction, playedMap, mapOwnerId, now)
    : resolveRadar(state, actorId, action.itemIndex, playedMap, ownMap, mapOwnerId, now);

  if (!resolved) return null;

  const previousEffect = state.visionEffectsByPlayer?.[actorId];
  const nextEffect = resolved.state.visionEffectsByPlayer?.[actorId];
  if (
    previousEffect?.type === 'smoke' &&
    nextEffect?.type === 'smoke' &&
    nextEffect.appliedAtTurn === previousEffect.appliedAtTurn &&
    !isVisionObscuredForPlayer(resolved.state, actorId)
  ) {
    const visionEffectsByPlayer = { ...(resolved.state.visionEffectsByPlayer || {}) };
    delete visionEffectsByPlayer[actorId];
    resolved.state = { ...resolved.state, visionEffectsByPlayer };
  }

  return resolved;
}

export function settleCompletedGameState(state: GameState): GameState {
  const participantIds = (state.turnOrder || Object.keys(state.players)).filter((id) => !!state.players[id]);
  const allDone = participantIds.length > 0 && participantIds.every((id) => {
    const player = state.players[id];
    return !!player && (player.finished || player.forfeited || player.hasLeft);
  });
  if (!allDone) return state;

  const finishers = participantIds
    .filter((id) => state.players[id]?.finished && !state.players[id]?.forfeited)
    .map((id) => ({ id, moves: state.players[id].finishMoves ?? Number.MAX_SAFE_INTEGER }));
  const minMoves = finishers.length > 0 ? Math.min(...finishers.map((entry) => entry.moves)) : null;
  const winners = minMoves === null ? [] : finishers.filter((entry) => entry.moves === minMoves).map((entry) => entry.id);

  return {
    ...state,
    phase: GamePhase.END,
    currentTurn: null,
    winner: winners.length === 1 ? winners[0] : null,
    draw: winners.length === 1 ? null : true,
    turnMessage: winners.length === 1 ? `${state.players[winners[0]]?.displayName || '플레이어'} 승리` : '공동 우승',
  };
}
