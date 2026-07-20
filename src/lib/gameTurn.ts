import {
  CollisionWall,
  Direction,
  GameMap,
  GamePhase,
  GameState,
  MapItem,
  MazeSkillId,
  Obstacle,
  PoisonEffect,
  Position,
  SpecialWallType,
  FireVisionEffect,
  WormholeRunState,
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
  isValidWormholeChallenge,
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
  realm?: 'main' | 'wormhole';
  wormholeTransition?: 'entered' | 'seal' | 'returned';
  requestedDirection?: Direction;
  poisonMisdirected?: boolean;
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

function isTimedEffectActive(
  state: GameState | null | undefined,
  playerId: string,
  effect: { expiresAtTargetMove: number } | null | undefined
): boolean {
  const player = state?.players?.[playerId];
  return !!player && !player.finished && !player.forfeited && !player.hasLeft &&
    !!effect && (player.moves || 0) < effect.expiresAtTargetMove;
}

export function getActiveFireVisionEffect(
  state: GameState | null | undefined,
  playerId: string
): FireVisionEffect | null {
  const effect = state?.visionEffectsByPlayer?.[playerId];
  return effect?.type === 'fire' && isTimedEffectActive(state, playerId, effect) ? effect : null;
}

export function getActivePoisonEffect(
  state: GameState | null | undefined,
  playerId: string
): PoisonEffect | null {
  const effect = state?.poisonEffectsByPlayer?.[playerId];
  return effect && isTimedEffectActive(state, playerId, effect) ? effect : null;
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

const FIRE_HALLUCINATION_WALL_COUNT = 6;
const POISON_ACTION_DURATION = 4;
const CARDINAL_DIRECTIONS: Direction[] = ['up', 'down', 'left', 'right'];
const DIRECTION_LABELS: Record<Direction, string> = {
  up: '위',
  right: '오른쪽',
  down: '아래',
  left: '왼쪽',
};

function stableEffectHash(value: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function canonicalInnerWallSlots(): Obstacle[] {
  const slots: Obstacle[] = [];
  for (let row = 0; row < BOARD_SIZE; row += 1) {
    for (let col = 0; col < BOARD_SIZE; col += 1) {
      if (col < BOARD_SIZE - 1) slots.push({ position: { row, col }, direction: 'right' });
      if (row < BOARD_SIZE - 1) slots.push({ position: { row, col }, direction: 'down' });
    }
  }
  return slots;
}

function wallDistanceFrom(position: Position, wall: Obstacle): number {
  const adjacent = getNewPosition(wall.position, wall.direction);
  return Math.min(
    Math.abs(position.row - wall.position.row) + Math.abs(position.col - wall.position.col),
    Math.abs(position.row - adjacent.row) + Math.abs(position.col - adjacent.col)
  );
}

function createFireHallucinationWalls(
  state: GameState,
  actorId: string,
  mapOwnerId: string,
  playedMap: GameMap,
  mapItems: MapItem[],
  consumed: Record<number, boolean>,
  origin: Position
): Obstacle[] {
  const activePhysicalWalls: Obstacle[] = [
    ...(playedMap.obstacles || []),
    ...mapItems.flatMap((item, index) =>
      isWallItemType(item.type) && item.wallPosition && item.wallDirection &&
      (item.type === 'steelWall' || !consumed[index])
        ? [{ position: item.wallPosition, direction: item.wallDirection }]
        : []
    ),
  ];
  const alreadyKnown = Object.values(collisionRecord(state.collisionWalls)).filter(
    (wall) => wall.playerId === actorId && wall.mapOwnerId === mapOwnerId
  );
  const seed = `${actorId}:${mapOwnerId}:${state.turnNumber || 1}`;
  const rank = (wall: Obstacle) =>
    wallDistanceFrom(origin, wall) * 0x1_0000 +
    stableEffectHash(`${seed}:${wall.position.row},${wall.position.col}:${wall.direction}`) % 0x1_0000;
  const slots = canonicalInnerWallSlots().filter((slot) => !alreadyKnown.some((wall) =>
    isSameWallSegment(slot.position, slot.direction, wall.position, wall.direction)
  ));
  const real = slots
    .filter((slot) => activePhysicalWalls.some((wall) =>
      isSameWallSegment(slot.position, slot.direction, wall.position, wall.direction)
    ))
    .sort((left, right) => rank(left) - rank(right));
  const empty = slots
    .filter((slot) => !activePhysicalWalls.some((wall) =>
      isSameWallSegment(slot.position, slot.direction, wall.position, wall.direction)
    ))
    .sort((left, right) => rank(left) - rank(right));
  const selected = [
    ...real.slice(0, Math.min(3, real.length)),
    ...empty.slice(0, FIRE_HALLUCINATION_WALL_COUNT - Math.min(3, real.length)),
  ];
  if (selected.length < FIRE_HALLUCINATION_WALL_COUNT) {
    selected.push(...real.slice(selected.filter((wall) => real.includes(wall)).length)
      .slice(0, FIRE_HALLUCINATION_WALL_COUNT - selected.length));
  }
  return selected
    .sort((left, right) => stableEffectHash(`${seed}:mix:${left.position.row},${left.position.col}:${left.direction}`) -
      stableEffectHash(`${seed}:mix:${right.position.row},${right.position.col}:${right.direction}`))
    .map((wall) => ({ position: { ...wall.position }, direction: wall.direction }));
}

function poisonDirectionForAction(
  state: GameState,
  actorId: string,
  requestedDirection: Direction,
  currentPosition: Position,
  playedMap: GameMap,
  mapOwnerId: string
): Direction {
  const effect = getActivePoisonEffect(state, actorId);
  if (!effect) return requestedDirection;
  const actionNumber = state.players[actorId]?.moves || 0;
  const roll = stableEffectHash(`${effect.seed}:roll:${actionNumber}`) % 4;
  if (roll !== 0) return requestedDirection;
  const wormholeRun = state.wormholeRunsByPlayer?.[actorId];
  const mapItems = getMapItems(playedMap);
  const consumed = normalizeConsumed(state.itemState?.[mapOwnerId]?.consumed);
  const activeWalls = normalizeItemFlags(state.itemState?.[mapOwnerId]?.activeWalls);
  const alternatives = CARDINAL_DIRECTIONS.filter((direction) => {
    if (direction === requestedDirection) return false;
    const target = getNewPosition(currentPosition, direction);
    if (!isPositionInBoard(target)) return false;

    if (wormholeRun) {
      return isValidWormholeChallenge(wormholeRun.challenge) &&
        canMove(currentPosition, direction, wormholeRun.challenge.obstacles);
    }

    if (!canMove(currentPosition, direction, playedMap.obstacles || [])) return false;
    if (matchingWallItemIndex(
      currentPosition,
      direction,
      mapItems,
      consumed,
      activeWalls
    ) >= 0) return false;

    // Poison should redirect into a guaranteed one-cell move. Avoid consuming a
    // landing trap or turning the redirect into a rollback/teleport/smoke event.
    return !mapItems.some((item, index) => {
      if (consumed[index]) return false;
      const trapPosition = item.type === 'wormhole' ? item.entrance : item.position;
      return (item.type === 'mine' || item.type === 'wormhole' || item.type === 'smoke') &&
        !!trapPosition && isSamePosition(target, trapPosition);
    });
  });
  if (alternatives.length === 0) return requestedDirection;
  return alternatives[stableEffectHash(`${effect.seed}:direction:${actionNumber}`) % alternatives.length];
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

function resolveWormholeMove(
  state: GameState,
  actorId: string,
  direction: Direction,
  playedMap: GameMap,
  mapOwnerId: string,
  now: number
): TurnResolution | null {
  const player = state.players[actorId];
  const run = state.wormholeRunsByPlayer?.[actorId];
  if (!player || !run || run.mapOwnerId !== mapOwnerId || !isValidWormholeChallenge(run.challenge)) {
    return null;
  }
  const wormhole = getMapItems(playedMap)[run.itemIndex];
  if (!wormhole || wormhole.type !== 'wormhole' || !wormhole.exit || !wormhole.challenge) return null;

  const origin = run.position;
  const attempted = getNewPosition(origin, direction);
  if (!isPositionInBoard(attempted)) return null;
  const blocked = !canMove(origin, direction, run.challenge.obstacles);
  const position = blocked ? origin : attempted;
  const activatedSeals = { ...(run.activatedSeals || {}) };
  const sealIndex = blocked
    ? -1
    : run.challenge.seals.findIndex((seal) => isSamePosition(seal, position));
  const activatedNewSeal = sealIndex >= 0 && !activatedSeals[sealIndex];
  if (activatedNewSeal) activatedSeals[sealIndex] = true;
  const activatedSealCount = run.challenge.seals.reduce(
    (count, _, index) => count + (activatedSeals[index] ? 1 : 0),
    0
  );
  const allSealsActivated = activatedSealCount === run.challenge.seals.length;
  const returned = !blocked && allSealsActivated && isSamePosition(position, run.challenge.endPosition);
  const moves = (player.moves || 0) + 1;
  const discoveredWalls = blocked
    ? mergeWallSegments(run.discoveredWalls || [], [{ position: origin, direction }])
    : [...(run.discoveredWalls || [])];

  let message = blocked
    ? '웜홀 내부의 숨은 벽에 부딪혔습니다.'
    : `${player.displayName || '플레이어'}가 웜홀 내부에서 한 칸 이동했습니다.`;
  let wormholeTransition: MoveTurnOutcome['wormholeTransition'];
  if (activatedNewSeal) {
    wormholeTransition = 'seal';
    message = `웜홀 봉인을 해제했습니다. ${activatedSealCount}/${run.challenge.seals.length}`;
  } else if (!blocked && isSamePosition(position, run.challenge.endPosition) && !allSealsActivated) {
    message = `내부 출구가 잠겨 있습니다. 봉인 ${run.challenge.seals.length - activatedSealCount}개가 남았습니다.`;
  }

  const players = {
    ...state.players,
    [actorId]: returned
      ? {
          ...player,
          position: { ...wormhole.exit },
          moves,
          positionHistory: appendTurnPosition(
            player.positionHistory,
            player.position || playedMap.startPosition,
            wormhole.exit
          ),
        }
      : { ...player, moves },
  };
  const runs = { ...(state.wormholeRunsByPlayer || {}) };
  if (returned) {
    delete runs[actorId];
    wormholeTransition = 'returned';
    message = `${player.displayName || '플레이어'}가 모든 봉인을 풀고 웜홀에서 탈출했습니다.`;
  } else {
    runs[actorId] = {
      ...run,
      position,
      ...(Object.keys(activatedSeals).length > 0 ? { activatedSeals } : {}),
      ...(discoveredWalls.length > 0 ? { discoveredWalls } : {}),
    };
  }

  const nextState: GameState = {
    ...state,
    players,
    currentTurn: getNextTurnPlayerId(players, actorId, state.turnOrder),
    turnNumber: (state.turnNumber || 1) + 1,
    turnMessage: message,
    turnMessageTimestamp: now,
  };
  if (Object.keys(runs).length > 0) nextState.wormholeRunsByPlayer = runs;
  else delete nextState.wormholeRunsByPlayer;

  return {
    state: nextState,
    outcome: {
      type: 'move',
      direction,
      origin,
      attempted,
      position: returned ? { ...wormhole.exit } : position,
      moves,
      effect: blocked ? 'bump' : returned ? 'wormhole' : 'move',
      consumedItemIndex: null,
      ...(returned ? {
        itemPosition: player.position || playedMap.startPosition,
        wormholeExit: wormhole.exit,
      } : {}),
      realm: returned ? 'main' : 'wormhole',
      ...(wormholeTransition ? { wormholeTransition } : {}),
      reachedGoal: false,
      message,
    },
  };
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
  const moves = (player.moves || 0) + 1;
  let position = origin;
  let effect: TurnMoveEffect = 'move';
  let consumedItemIndex: number | null = null;
  let wallEffect: SpecialWallType | undefined;
  let wallItemIndex: number | undefined;
  let itemPosition: Position | undefined;
  let wormholeExit: Position | undefined;
  let wormholeTransition: MoveTurnOutcome['wormholeTransition'];
  let wormholeRunToCreate: WormholeRunState | null = null;
  let crystalRevealed: Obstacle[] = [];
  let needsFinalLandingTrapCheck = false;
  let smokeTriggered = false;
  let fireTriggered = false;
  let poisonTriggered = false;
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
      const wormhole = mapItems[wormholeIndex];
      const exit = wormhole.exit;
      const exitIsSafe = isWormholeExitSafe(playedMap, exit);
      effect = 'wormhole';
      consumeItem(wormholeIndex);
      itemPosition = wormhole.entrance;
      if (exitIsSafe && exit && isValidWormholeChallenge(wormhole.challenge)) {
        position = landingPosition;
        wormholeExit = wormhole.challenge.startPosition;
        wormholeTransition = 'entered';
        wormholeRunToCreate = {
          mapOwnerId,
          itemIndex: wormholeIndex,
          position: { ...wormhole.challenge.startPosition },
          challenge: {
            version: 1,
            startPosition: { ...wormhole.challenge.startPosition },
            endPosition: { ...wormhole.challenge.endPosition },
            seals: wormhole.challenge.seals.map((seal) => ({ ...seal })),
            obstacles: wormhole.challenge.obstacles.map((obstacle) => ({
              position: { ...obstacle.position },
              direction: obstacle.direction,
            })),
          },
          enteredAtTurn: state.turnNumber || 1,
        };
        message = `${player.displayName || '플레이어'}가 웜홀 내부 미로로 끌려갔습니다.`;
      } else {
        const destination = exitIsSafe && exit ? exit : fallbackPosition;
        position = destination;
        wormholeExit = position;
        message = exitIsSafe
          ? `${player.displayName || '플레이어'}가 웜홀을 통과했습니다.`
          : '불안정한 출구로 웜홀이 붕괴했습니다.';
      }
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
        consumeItem(matchingIndex);
        fireTriggered = true;
        message = '화염벽에 부딪혀 불이 붙었습니다. 열기 속 진짜벽과 환영벽이 뒤섞입니다.';
        break;
      case 'poisonWall':
        consumeItem(matchingIndex);
        poisonTriggered = true;
        message = '독벽을 통과해 중독됐습니다. 다음 4번의 행동은 25% 확률로 방향이 뒤틀립니다.';
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

  if (fireTriggered) {
    nextState.visionEffectsByPlayer = {
      ...(state.visionEffectsByPlayer || {}),
      [actorId]: {
        type: 'fire',
        sourcePlayerId: mapOwnerId,
        appliedAtTurn: state.turnNumber || 1,
        expiresAtTargetMove: moves + 2,
        phantomWalls: createFireHallucinationWalls(
          state,
          actorId,
          mapOwnerId,
          playedMap,
          mapItems,
          consumed,
          origin
        ),
      },
    };
  }

  if (poisonTriggered && !updatedPlayer.finished) {
    nextState.poisonEffectsByPlayer = {
      ...(state.poisonEffectsByPlayer || {}),
      [actorId]: {
        sourcePlayerId: mapOwnerId,
        appliedAtTurn: state.turnNumber || 1,
        expiresAtTargetMove: moves + POISON_ACTION_DURATION,
        seed: stableEffectHash(`${actorId}:${mapOwnerId}:${state.turnNumber || 1}:poison`),
      },
    };
  }

  if (wormholeRunToCreate) {
    nextState.wormholeRunsByPlayer = {
      ...(state.wormholeRunsByPlayer || {}),
      [actorId]: wormholeRunToCreate,
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
      ...(wormholeTransition ? { realm: 'main' as const, wormholeTransition } : {}),
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
  const actionPosition = state.wormholeRunsByPlayer?.[actorId]?.position ||
    player.position || playedMap.startPosition;
  const resolvedDirection = poisonDirectionForAction(
    state,
    actorId,
    action.direction,
    actionPosition,
    playedMap,
    mapOwnerId
  );
  const resolved = state.wormholeRunsByPlayer?.[actorId]
    ? resolveWormholeMove(state, actorId, resolvedDirection, playedMap, mapOwnerId, now)
    : resolveMove(state, actorId, resolvedDirection, playedMap, mapOwnerId, now);

  if (!resolved) return null;

  if (resolvedDirection !== action.direction && resolved.outcome.type === 'move') {
    resolved.outcome.requestedDirection = action.direction;
    resolved.outcome.poisonMisdirected = true;
    resolved.outcome.message = `중독으로 ${DIRECTION_LABELS[action.direction]} 입력이 ${DIRECTION_LABELS[resolvedDirection]} 방향으로 뒤틀렸습니다. ${resolved.outcome.message}`;
    resolved.state.turnMessage = resolved.outcome.message;
  }

  const previousEffect = state.visionEffectsByPlayer?.[actorId];
  const nextEffect = resolved.state.visionEffectsByPlayer?.[actorId];
  if (
    previousEffect &&
    nextEffect &&
    nextEffect.type === previousEffect.type &&
    nextEffect.appliedAtTurn === previousEffect.appliedAtTurn &&
    !isTimedEffectActive(resolved.state, actorId, nextEffect)
  ) {
    const visionEffectsByPlayer = { ...(resolved.state.visionEffectsByPlayer || {}) };
    delete visionEffectsByPlayer[actorId];
    resolved.state = { ...resolved.state, visionEffectsByPlayer };
  }

  const previousPoison = state.poisonEffectsByPlayer?.[actorId];
  const nextPoison = resolved.state.poisonEffectsByPlayer?.[actorId];
  if (
    previousPoison &&
    nextPoison &&
    nextPoison.appliedAtTurn === previousPoison.appliedAtTurn &&
    !isTimedEffectActive(resolved.state, actorId, nextPoison)
  ) {
    const poisonEffectsByPlayer = { ...(resolved.state.poisonEffectsByPlayer || {}) };
    delete poisonEffectsByPlayer[actorId];
    resolved.state = { ...resolved.state, poisonEffectsByPlayer };
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
