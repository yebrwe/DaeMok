import {
  CollisionWall,
  Direction,
  GameMap,
  GamePhase,
  GameState,
  MapItem,
  MazeSkillId,
  Obstacle,
  Position,
  SpecialWallType,
} from '@/types/game';
import {
  BOARD_SIZE,
  canMove,
  findShortestPath,
  getMapItems,
  getNewPosition,
  getNextTurnPlayerId,
  isPositionInBoard,
  isSamePosition,
  isSameWallSegment,
  isWallItemType,
  isWormholeExitSafe,
} from '@/lib/gameUtils';

export type TurnMoveEffect = 'move' | 'bump' | 'mine' | 'wormhole' | 'smoke';

export type TurnAction =
  | { type: 'move'; direction: Direction }
  | { type: 'radar'; itemIndex?: number }
  // Kept in the wire type only so older persisted commands can still be decoded.
  // resolveTurnAction deliberately rejects every skill action.
  | { type: 'skill'; skillId: MazeSkillId; direction?: Direction };

export interface MoveTurnOutcome {
  type: 'move';
  direction: Direction;
  origin: Position;
  attempted: Position;
  position: Position;
  moves: number;
  effect: TurnMoveEffect;
  consumedItemIndex: number | null;
  wallEffect?: SpecialWallType;
  wallItemIndex?: number;
  skillEffect?: MazeSkillId;
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

export interface SkillTurnOutcome {
  type: 'skill';
  skillId: Exclude<MazeSkillId, 'anchor'>;
  direction?: Direction;
  origin: Position;
  position: Position;
  moves: number;
  found?: Obstacle[];
  via?: Position[];
  landingEffect?: 'mine' | 'wormhole' | 'smoke';
  itemPosition?: Position;
  wormholeExit?: Position;
  reachedGoal: boolean;
  message: string;
}

export type TurnOutcome = MoveTurnOutcome | RadarTurnOutcome | SkillTurnOutcome;

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
          (playedMap.obstacles || []).some(
            (wall) => isSameWallSegment(cell, direction, wall.position, wall.direction)
          ) ||
          mapItems.some(
            (item, index) =>
              isWallItemType(item.type) &&
              !!item.wallPosition &&
              !!item.wallDirection &&
              (item.type === 'steelWall' || !consumed[index]) &&
              isSameWallSegment(cell, direction, item.wallPosition, item.wallDirection)
          );
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

export function getMineRollbackPosition(
  history: Position[] | undefined,
  fallback: Position
): Position {
  const turns = Array.isArray(history) && history.length > 0 ? history : [fallback];
  return turns.length >= 2 ? turns[turns.length - 2] : turns[0];
}

function collisionRecord(
  value: GameState['collisionWalls']
): Record<string, CollisionWall> {
  if (!value) return {};
  if (!Array.isArray(value)) return { ...value };
  return Object.fromEntries(value.filter(Boolean).map((wall, index) => [`legacy_${index}`, wall]));
}

function normalizeItemFlags(value: unknown): Record<number, boolean> {
  if (value === true) return { 0: true };
  return value && typeof value === 'object' ? { ...(value as Record<number, boolean>) } : {};
}

function matchingWallItemIndex(
  position: Position,
  direction: Direction,
  items: MapItem[],
  consumed: Record<number, boolean>,
  activeWalls: Record<number, boolean>,
  ignoredItemIndex: number | null = null
): number {
  return items.findIndex((item, index) => {
    if (index === ignoredItemIndex) return false;
    if (!isWallItemType(item.type) || !item.wallPosition || !item.wallDirection) return false;
    if (!isSameWallSegment(position, direction, item.wallPosition, item.wallDirection)) return false;
    if (item.type === 'steelWall') return true;
    if (item.type === 'collapseWall' && activeWalls[index]) return true;
    return !consumed[index];
  });
}

function permanentBlockingWalls(
  playedMap: GameMap,
  items: MapItem[],
  activeWalls: Record<number, boolean>,
  extra: Obstacle[] = []
): Obstacle[] {
  const itemWalls = items.flatMap((item, index) => {
    const isPermanent = item.type === 'steelWall' ||
      (item.type === 'collapseWall' && !!activeWalls[index]);
    return isPermanent && item.wallPosition && item.wallDirection
      ? [{ position: item.wallPosition, direction: item.wallDirection }]
      : [];
  });
  return [...(playedMap.obstacles || []), ...itemWalls, ...extra];
}

function hasGoalPath(
  position: Position,
  playedMap: GameMap,
  items: MapItem[],
  activeWalls: Record<number, boolean>,
  extra: Obstacle[] = []
): boolean {
  return !!findShortestPath(
    position,
    playedMap.endPosition,
    permanentBlockingWalls(playedMap, items, activeWalls, extra)
  );
}

function unconsumedFakeWallObstacles(
  items: MapItem[],
  consumed: Record<number, boolean>
): Obstacle[] {
  return items.flatMap((item, index) =>
    item.type === 'oneTimeWall' &&
    !consumed[index] &&
    item.wallPosition &&
    item.wallDirection
      ? [{ position: item.wallPosition, direction: item.wallDirection }]
      : []
  );
}

function isBlockedForForcedStep(
  position: Position,
  direction: Direction,
  playedMap: GameMap,
  items: MapItem[],
  consumed: Record<number, boolean>,
  activeWalls: Record<number, boolean>,
  ignoredItemIndex: number | null = null
): boolean {
  if (!canMove(position, direction, playedMap.obstacles || [])) return true;
  return matchingWallItemIndex(
    position,
    direction,
    items,
    consumed,
    activeWalls,
    ignoredItemIndex
  ) >= 0;
}

function findNearbyStaticWalls(position: Position, playedMap: GameMap): Obstacle[] {
  const found: Obstacle[] = [];
  for (let rowOffset = -1; rowOffset <= 1; rowOffset += 1) {
    for (let colOffset = -1; colOffset <= 1; colOffset += 1) {
      const cell = { row: position.row + rowOffset, col: position.col + colOffset };
      if (!isPositionInBoard(cell)) continue;
      for (const wall of playedMap.obstacles || []) {
        if (
          isSamePosition(wall.position, cell) ||
          isSamePosition(getNewPosition(wall.position, wall.direction), cell)
        ) {
          found.push(wall);
        }
      }
    }
  }
  return mergeWallSegments([], found);
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
  const mapItemState = state.itemState?.[mapOwnerId];
  const consumed = normalizeConsumed(mapItemState?.consumed);
  const activeWalls = normalizeItemFlags(mapItemState?.activeWalls);
  const phaseOpen = normalizeItemFlags(mapItemState?.phaseOpen);
  let consumedChanged = false;
  let activeWallsChanged = false;
  let phaseOpenChanged = false;
  let moves = (player.moves || 0) + 1;
  let position = origin;
  let effect: TurnMoveEffect = 'move';
  let consumedItemIndex: number | null = null;
  let wallEffect: SpecialWallType | undefined;
  let wallItemIndex: number | undefined;
  let itemPosition: Position | undefined;
  let wormholeExit: Position | undefined;
  let crystalRevealed: Obstacle[] = [];
  let needsFinalLandingTrapCheck = false;
  let smokeTriggered = false;
  let message = `${player.displayName || '플레이어'}가 한 칸 이동했습니다.`;

  const consumeItem = (index: number) => {
    consumed[index] = true;
    consumedChanged = true;
    consumedItemIndex = index;
  };

  const applyLandingTrap = (landingPosition: Position, fallbackPosition: Position): boolean => {
    // Goal arrival is terminal. Valid V3 maps cannot place a cell trap on the goal,
    // but this also gives legacy/malformed maps deterministic ordering.
    if (isSamePosition(landingPosition, playedMap.endPosition)) return false;

    const mineIndex = mapItems.findIndex(
      (item, index) =>
        item.type === 'mine' &&
        !!item.position &&
        !consumed[index] &&
        isSamePosition(landingPosition, item.position)
    );
    const wormholeIndex = mapItems.findIndex(
      (item, index) =>
        item.type === 'wormhole' &&
        !!item.entrance &&
        !consumed[index] &&
        isSamePosition(landingPosition, item.entrance)
    );
    const smokeIndex = mapItems.findIndex(
      (item, index) =>
        item.type === 'smoke' &&
        !!item.position &&
        !consumed[index] &&
        isSamePosition(landingPosition, item.position)
    );

    if (mineIndex >= 0) {
      const rollback = getMineRollbackPosition(player.positionHistory, fallbackPosition);
      const rollbackIsSafe = hasGoalPath(rollback, playedMap, mapItems, activeWalls);
      position = rollbackIsSafe ? rollback : landingPosition;
      effect = 'mine';
      consumeItem(mineIndex);
      itemPosition = mapItems[mineIndex].position;
      message = rollbackIsSafe
        ? `${player.displayName || '플레이어'}가 지뢰를 밟아 2턴 전 위치로 돌아갔습니다.`
        : '지뢰가 폭발했지만 안전한 되감기 경로가 없어 착지 칸에 남았습니다.';
      return true;
    }

    if (wormholeIndex >= 0) {
      const exit = mapItems[wormholeIndex].exit;
      const exitIsSafe = isWormholeExitSafe(playedMap, exit);
      const destination = exitIsSafe && exit ? exit : fallbackPosition;
      position = destination;
      effect = 'wormhole';
      consumeItem(wormholeIndex);
      itemPosition = mapItems[wormholeIndex].entrance;
      wormholeExit = position;
      message = exitIsSafe
        ? `${player.displayName || '플레이어'}가 웜홀을 통과했습니다.`
        : '불안정한 출구로 웜홀이 붕괴했습니다.';
      return true;
    }

    if (smokeIndex >= 0) {
      position = landingPosition;
      effect = 'smoke';
      smokeTriggered = true;
      consumeItem(smokeIndex);
      itemPosition = mapItems[smokeIndex].position;
      message = `${player.displayName || '플레이어'}가 연막 함정을 밟았습니다. 다음 차례의 시야가 가려집니다.`;
      return true;
    }

    return false;
  };

  const passesStaticWall = canMove(origin, direction, playedMap.obstacles || []);
  const matchingIndex = passesStaticWall
    ? matchingWallItemIndex(origin, direction, mapItems, consumed, activeWalls)
    : -1;
  const wallItem = matchingIndex >= 0 ? mapItems[matchingIndex] : null;
  let blocked = !passesStaticWall;

  if (wallItem) {
    wallItemIndex = matchingIndex;
    itemPosition = wallItem.wallPosition;
    if (wallItem.type !== 'oneTimeWall') wallEffect = wallItem.type as SpecialWallType;

    switch (wallItem.type) {
      case 'oneTimeWall':
        blocked = true;
        consumeItem(matchingIndex);
        message = `${player.displayName || '플레이어'}가 벽에 부딪혔습니다.`;
        break;
      case 'steelWall':
        blocked = true;
        message = '강철벽은 파괴되지 않고 이동을 막습니다.';
        break;
      case 'fireWall':
        blocked = true;
        moves += 1;
        consumeItem(matchingIndex);
        message = '화염벽에 막혀 추가 1턴을 소모했습니다.';
        break;
      case 'poisonWall':
        moves += 2;
        consumeItem(matchingIndex);
        message = '독벽을 통과해 추가 2턴을 소모했습니다.';
        break;
      case 'collapseWall':
        blocked = !!activeWalls[matchingIndex];
        message = blocked
          ? '이미 붕괴한 벽이 이동을 막습니다.'
          : '붕괴벽을 통과했습니다.';
        break;
      case 'phaseWall':
        if (phaseOpen[matchingIndex]) {
          phaseOpen[matchingIndex] = false;
          phaseOpenChanged = true;
          message = '열린 위상벽을 통과했습니다.';
        } else {
          blocked = true;
          phaseOpen[matchingIndex] = true;
          phaseOpenChanged = true;
          message = '위상벽에 막혔습니다. 다음 시도에는 통과할 수 있습니다.';
        }
        break;
      case 'thornWall':
        blocked = true;
        consumeItem(matchingIndex);
        message = '가시벽에 막혀 2턴 전 위치로 밀려났습니다.';
        break;
      case 'crystalWall':
        blocked = true;
        consumeItem(matchingIndex);
        crystalRevealed = findNearbyStaticWalls(origin, playedMap);
        message = '수정벽이 부서지며 주변의 진짜 벽을 드러냈습니다.';
        break;
      case 'iceWall':
        message = '빙결벽을 통과했습니다.';
        break;
      case 'windWall':
        consumeItem(matchingIndex);
        message = '바람벽을 통과했지만 밀릴 칸이 막혀 벽만 소멸했습니다.';
        break;
      case 'mirrorWall':
        consumeItem(matchingIndex);
        message = '거울벽을 통과해 반전된 뒤 벽이 깨졌습니다.';
        break;
    }
  }

  if (blocked) {
    effect = 'bump';
    if (!wallItem) message = `${player.displayName || '플레이어'}가 벽에 부딪혔습니다.`;
    if (wallItem?.type === 'thornWall') {
      const rewind = getMineRollbackPosition(player.positionHistory, origin);
      const canRewind = !isSamePosition(rewind, origin) &&
        hasGoalPath(rewind, playedMap, mapItems, activeWalls);
      if (canRewind) {
        position = rewind;
        needsFinalLandingTrapCheck = true;
      } else {
        message = '가시벽이 부서졌지만 안전한 되감기 경로가 없어 제자리에 남았습니다.';
      }
    }
  }

  if (!blocked) {
    position = attempted;
    const cellEffectTriggered = applyLandingTrap(attempted, origin);

    if (!cellEffectTriggered && wallItem && !isSamePosition(attempted, playedMap.endPosition)) {
      let forcedDirection: Direction | null = null;
      if (wallItem.type === 'iceWall') forcedDirection = direction;
      if (wallItem.type === 'windWall') forcedDirection = wallItem.effectDirection || direction;

      if (forcedDirection) {
        const forcedTarget = getNewPosition(attempted, forcedDirection);
        const canForce = isPositionInBoard(forcedTarget) &&
          !isBlockedForForcedStep(
            attempted,
            forcedDirection,
            playedMap,
            mapItems,
            consumed,
            activeWalls,
            matchingIndex
          ) &&
          hasGoalPath(forcedTarget, playedMap, mapItems, activeWalls);
        if (canForce) {
          position = forcedTarget;
          needsFinalLandingTrapCheck = true;
          if (wallItem.type === 'windWall') {
            message = '바람벽을 통과해 지정 방향으로 밀려난 뒤 벽이 소멸했습니다.';
          }
        }
      } else if (wallItem.type === 'mirrorWall') {
        const mirrorTarget = {
          row: BOARD_SIZE - 1 - attempted.row,
          col: BOARD_SIZE - 1 - attempted.col,
        };
        if (
          !isSamePosition(mirrorTarget, playedMap.endPosition) &&
          hasGoalPath(mirrorTarget, playedMap, mapItems, activeWalls)
        ) {
          position = mirrorTarget;
          needsFinalLandingTrapCheck = true;
        }
      }
    }

    if (wallItem?.type === 'collapseWall' && !activeWalls[matchingIndex]) {
      const collapsedWall = wallItem.wallPosition && wallItem.wallDirection
        ? [{ position: wallItem.wallPosition, direction: wallItem.wallDirection }]
        : [];
      const beliefSafeWalls = [
        ...collapsedWall,
        ...unconsumedFakeWallObstacles(mapItems, consumed),
      ];
      const targetRemainsSafe = collapsedWall.length > 0 &&
        hasGoalPath(attempted, playedMap, mapItems, activeWalls, beliefSafeWalls) &&
        hasGoalPath(position, playedMap, mapItems, activeWalls, beliefSafeWalls);
      if (targetRemainsSafe) {
        activeWalls[matchingIndex] = true;
        activeWallsChanged = true;
        message = '통과한 붕괴벽이 뒤에서 영구적으로 닫혔습니다.';
      } else {
        consumeItem(matchingIndex);
        message = '붕괴벽이 경로를 막을 수 있어 활성화되지 않고 사라졌습니다.';
      }
    }
  }

  if (needsFinalLandingTrapCheck) {
    applyLandingTrap(position, blocked ? origin : attempted);
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

  if (consumedChanged || activeWallsChanged || phaseOpenChanged) {
    nextState.itemState = {
      ...(state.itemState || {}),
      [mapOwnerId]: {
        ...(mapItemState || {}),
        ...(consumedChanged ? { consumed, consumedAt: now } : {}),
        ...(activeWallsChanged ? { activeWalls } : {}),
        ...(phaseOpenChanged ? { phaseOpen } : {}),
      },
    };
  }

  if (crystalRevealed.length > 0) {
    nextState.revealedWallsByPlayer = {
      ...(state.revealedWallsByPlayer || {}),
      [actorId]: mergeWallSegments(
        state.revealedWallsByPlayer?.[actorId] || [],
        crystalRevealed
      ),
    };
  }

  if (smokeTriggered) {
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
      wallEffect,
      wallItemIndex,
      itemPosition,
      wormholeExit,
      reachedGoal,
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

  // Retired detector/skill commands can still appear in legacy receipts and
  // payload types, but movement is now the only legal runtime action.
  if (action.type !== 'move') return null;
  const resolved = resolveMove(state, actorId, action.direction, playedMap, mapOwnerId, now);

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

  // Online turns commit this reducer result directly. Settling here keeps the
  // last goal move and END/winner transition in the same Firebase transaction.
  resolved.state = settleCompletedGameState(resolved.state);

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
