// GENERATED FILE. Edit the canonical source under src/ and regenerate.
// Source: src/lib/gameUtils.ts

import {
  CollisionWall,
  Direction,
  GameMap,
  ItemType,
  LegacyWormholeChallenge,
  MazeSkillId,
  MapItem,
  Obstacle,
  Player,
  Position,
  RunnerGear,
  SpecialWallType,
  WallItemType,
  WormholeChallenge,
} from '../types/game';
import {
  getDiceWormholeChallengeError,
  isValidNewDiceWormholeChallenge,
} from './diceWormhole';

// 보드 크기 상수
export const BOARD_SIZE = 6;
export const CARDINAL_DIRECTIONS: Direction[] = ['up', 'down', 'left', 'right'];
export const GAME_RULES_VERSION = 5;

export const MAZE_SKILL_IDS: MazeSkillId[] = ['scoutPulse', 'breach', 'anchor', 'dash'];
export const DEFAULT_MAZE_SKILL: MazeSkillId = 'scoutPulse';

export function isMazeSkillId(value: unknown): value is MazeSkillId {
  return typeof value === 'string' && MAZE_SKILL_IDS.includes(value as MazeSkillId);
}

// 벽 예산 (아이템 비용 포함). 장비가 없을 때만 절대 최대치를 쓸 수 있다.
export const MAX_OBSTACLES = 25;
export const RUNNER_GEAR_WALL_BUDGET = 15;
export const RUNNER_GEARS: readonly RunnerGear[] = [
  'none',
  'wormholeEscapeKit',
  'insight',
];
export const DEFAULT_RUNNER_GEAR: RunnerGear = 'none';

export function isRunnerGear(value: unknown): value is RunnerGear {
  return typeof value === 'string' && RUNNER_GEARS.includes(value as RunnerGear);
}

export function getMapRunnerGear(
  map: Pick<GameMap, 'runnerGear'> | null | undefined
): RunnerGear {
  return isRunnerGear(map?.runnerGear) ? map.runnerGear : DEFAULT_RUNNER_GEAR;
}

export function getMapWallBudget(runnerGear: RunnerGear): number;
export function getMapWallBudget(
  map: Pick<GameMap, 'runnerGear'> | null | undefined
): number;
export function getMapWallBudget(
  value: RunnerGear | Pick<GameMap, 'runnerGear'> | null | undefined
): number {
  const runnerGear = typeof value === 'string'
    ? value
    : getMapRunnerGear(value);
  return runnerGear === 'none' ? MAX_OBSTACLES : RUNNER_GEAR_WALL_BUDGET;
}
export const WORMHOLE_CHALLENGE_SEAL_COUNT = 3;
export const WORMHOLE_CHALLENGE_MIN_WALLS = 4;
export const WORMHOLE_CHALLENGE_MAX_WALLS = 12;
export const WORMHOLE_CHALLENGE_MIN_STEPS = 12;
export const WORMHOLE_CHALLENGE_MAX_STEPS = 28;

export const SPECIAL_WALL_TYPES: SpecialWallType[] = [
  'steelWall',
  'fireWall',
  'fogWall',
  'illusionWall',
  'poisonWall',
  'iceWall',
  'windWall',
  'collapseWall',
  'phaseWall',
  'mirrorWall',
  'thornWall',
  'crystalWall',
];

export const WALL_ITEM_TYPES: WallItemType[] = ['oneTimeWall', ...SPECIAL_WALL_TYPES];

// New maps may no longer place these items. Runtime/type support remains so
// an already-running legacy room can finish without corrupting its match.
export const RETIRED_NEW_MAP_ITEM_TYPES: readonly ItemType[] = [
  'radar',
  'mine',
  'smoke',
  'steelWall',
  'collapseWall',
  'phaseWall',
  'mirrorWall',
  'crystalWall',
];

export function isRetiredNewMapItemType(value: unknown): value is ItemType {
  return typeof value === 'string'
    && RETIRED_NEW_MAP_ITEM_TYPES.includes(value as ItemType);
}

// 아이템 비용 (벽 개수 기준)
export const ITEM_COSTS: Record<ItemType, number> = {
  oneTimeWall: 7,
  mine: 1,
  wormhole: 7,
  radar: 4,
  smoke: 1,
  steelWall: 1,
  fireWall: 1,
  fogWall: 1,
  illusionWall: 2,
  poisonWall: 1,
  iceWall: 1,
  windWall: 1,
  collapseWall: 1,
  phaseWall: 1,
  mirrorWall: 1,
  thornWall: 1,
  crystalWall: 1,
};

export const ITEM_LIMITS: Record<ItemType, number> = {
  oneTimeWall: 1,
  mine: 1,
  wormhole: 1,
  radar: 1,
  smoke: 1,
  steelWall: 1,
  fireWall: 1,
  fogWall: 1,
  illusionWall: 1,
  poisonWall: 1,
  iceWall: 1,
  windWall: 1,
  collapseWall: 1,
  phaseWall: 1,
  mirrorWall: 1,
  thornWall: 1,
  crystalWall: 1,
};

export const ITEM_LABELS: Record<ItemType, string> = {
  oneTimeWall: '가짜벽',
  mine: '지뢰',
  wormhole: '웜홀',
  radar: '탐지기',
  smoke: '연막 함정',
  steelWall: '강철벽',
  fireWall: '화염벽',
  fogWall: '안개벽',
  illusionWall: '환영벽',
  poisonWall: '독벽',
  iceWall: '빙결벽',
  windWall: '바람벽',
  collapseWall: '붕괴벽',
  phaseWall: '위상벽',
  mirrorWall: '거울벽',
  thornWall: '가시벽',
  crystalWall: '수정벽',
};

export function isWallItemType(type: ItemType): type is WallItemType {
  return WALL_ITEM_TYPES.includes(type as WallItemType);
}

function isDirection(value: unknown): value is Direction {
  return typeof value === 'string' && CARDINAL_DIRECTIONS.includes(value as Direction);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function isDenseRecordArray(values: unknown[]): boolean {
  for (let index = 0; index < values.length; index += 1) {
    if (!Object.prototype.hasOwnProperty.call(values, index) || !isRecord(values[index])) {
      return false;
    }
  }
  return true;
}

export function isTurnEligible(player: Player | null | undefined): boolean {
  return !!player && !player.finished && !player.forfeited && !player.hasLeft;
}

export function getTurnOrder(
  players: Record<string, Player>,
  preferredOrder?: string[] | null
): string[] {
  const playerIds = Object.keys(players);
  const known = new Set(playerIds);
  const ordered = (preferredOrder || []).filter(
    (id, index, ids) => known.has(id) && ids.indexOf(id) === index
  );
  const missing = playerIds.filter((id) => !ordered.includes(id)).sort();
  return [...ordered, ...missing];
}

export function getFirstTurnPlayerId(
  players: Record<string, Player>,
  preferredOrder?: string[] | null
): string | null {
  return getTurnOrder(players, preferredOrder).find((id) => isTurnEligible(players[id])) ?? null;
}

export function getNextTurnPlayerId(
  players: Record<string, Player>,
  currentPlayerId: string | null | undefined,
  preferredOrder?: string[] | null
): string | null {
  const order = getTurnOrder(players, preferredOrder);
  if (order.length === 0) return null;

  const currentIndex = currentPlayerId ? order.indexOf(currentPlayerId) : -1;
  for (let offset = 1; offset <= order.length; offset += 1) {
    const candidate = order[(currentIndex + offset + order.length) % order.length];
    if (isTurnEligible(players[candidate])) return candidate;
  }
  return null;
}

// 두 (위치, 방향) 쌍이 같은 벽 세그먼트를 가리키는지 확인
// 예: (2,3)의 'right'와 (2,4)의 'left'는 같은 벽
export function isSameWallSegment(
  posA: Position,
  dirA: Direction,
  posB: Position,
  dirB: Direction
): boolean {
  if (posA.row === posB.row && posA.col === posB.col && dirA === dirB) return true;

  const adjacent = getNewPosition(posA, dirA);
  return (
    adjacent.row === posB.row &&
    adjacent.col === posB.col &&
    getOppositeDirection(dirA) === dirB
  );
}

// 아이템이 특정 이동을 막는 1회성 벽인지 확인
// 맵의 아이템 목록 (레거시 단일 item 필드 하위호환)
export function getMapItems(map: { items?: MapItem[] | null; item?: MapItem | null } | null | undefined): MapItem[] {
  if (!map) return [];
  if (Array.isArray(map.items)) return map.items.filter((item): item is MapItem => isRecord(item));
  return isRecord(map.item) ? [map.item as unknown as MapItem] : [];
}

export function cloneWormholeChallenge(challenge: WormholeChallenge): WormholeChallenge {
  if (challenge.version === 2) {
    return {
      version: 2,
      boardSize: 4,
      startPosition: { ...challenge.startPosition },
      endPosition: { ...challenge.endPosition },
      blockedCells: challenge.blockedCells.map((position) => ({ ...position })),
      initialOrientation: challenge.initialOrientation,
      targetTop: challenge.targetTop,
    };
  }
  return {
    version: 1,
    startPosition: { ...challenge.startPosition },
    endPosition: { ...challenge.endPosition },
    seals: challenge.seals.map((position) => ({ ...position })),
    obstacles: challenge.obstacles.map((obstacle) => ({
      position: { ...obstacle.position },
      direction: obstacle.direction,
    })),
  };
}

export function cloneMapItem(item: MapItem): MapItem {
  return {
    type: item.type,
    ...(item.wallPosition ? { wallPosition: { ...item.wallPosition } } : {}),
    ...(item.wallDirection ? { wallDirection: item.wallDirection } : {}),
    ...(item.effectDirection ? { effectDirection: item.effectDirection } : {}),
    ...(item.position ? { position: { ...item.position } } : {}),
    ...(item.entrance ? { entrance: { ...item.entrance } } : {}),
    ...(item.exit ? { exit: { ...item.exit } } : {}),
    ...(item.challenge ? { challenge: cloneWormholeChallenge(item.challenge) } : {}),
  };
}

export function cloneGameMap(map: GameMap): GameMap {
  return {
    ...(typeof map.rulesVersion === 'number' ? { rulesVersion: map.rulesVersion } : {}),
    startPosition: { ...map.startPosition },
    endPosition: { ...map.endPosition },
    obstacles: (map.obstacles || []).map((obstacle) => ({
      position: { ...obstacle.position },
      direction: obstacle.direction,
    })),
    items: getMapItems(map).map(cloneMapItem),
    ...(map.skillLoadout ? { skillLoadout: map.skillLoadout } : {}),
    runnerGear: getMapRunnerGear(map),
  };
}

/**
 * V5 still carries one skill field on the wire. New clients always write the
 * inert compatibility value so a stale draft cannot re-enable a retired
 * loadout. Retired items are deliberately preserved here and rejected by the
 * new-map validator instead of being removed without the author noticing.
 */
export function normalizeNewMapForSubmission(map: GameMap): GameMap {
  return {
    ...cloneGameMap(map),
    skillLoadout: DEFAULT_MAZE_SKILL,
  };
}

export function getVisibleCollisionWalls(
  collisionWalls: readonly CollisionWall[],
  map: GameMap,
  consumed: Readonly<Record<number, boolean>>
): CollisionWall[] {
  const items = getMapItems(map);

  return collisionWalls.filter((collision) => {
    // Only the insight runner receives this private marker. Hiding the marker's
    // collision removes the fake normal-wall model for that runner, while
    // public/opponent projections keep the unmarked disguise intact.
    if (collision.identifiedAsFake === true) return false;

    const hasStaticWall = (map.obstacles || []).some((wall) =>
      isSameWallSegment(collision.position, collision.direction, wall.position, wall.direction)
    );
    if (hasStaticWall) return true;

    const consumedBlockingWall = items.some((item, index) =>
      consumed[index] === true &&
      item.type !== 'steelWall' &&
      // A fake wall stays visually indistinguishable from a discovered normal
      // wall after its first collision even though the engine now lets the
      // runner pass through it. Removing this collision made it look
      // transparent and revealed the deception immediately.
      item.type !== 'oneTimeWall' &&
      isWallItemType(item.type) &&
      !!item.wallPosition &&
      !!item.wallDirection &&
      isSameWallSegment(
        collision.position,
        collision.direction,
        item.wallPosition,
        item.wallDirection
      )
    );

    return !consumedBlockingWall;
  });
}

function getGuaranteedBlockingWalls(map: GameMap): Obstacle[] {
  // Newly placeable item walls disappear after activation. Treating them as
  // permanent here prevented authors from putting one on a wormhole exit's
  // sole route even though that route reopens during play. Steel is retained
  // for already persisted maps because it is the only non-disappearing item
  // wall supported by the legacy runtime.
  const itemWalls = getMapItems(map).flatMap((item) =>
    item.type === 'steelWall' &&
      isPositionInBoard(item.wallPosition) &&
      isDirection(item.wallDirection)
      ? [{ position: item.wallPosition, direction: item.wallDirection }]
      : []
  );
  const obstacles = Array.isArray(map.obstacles)
    ? map.obstacles.filter(
        (obstacle) =>
          isRecord(obstacle) && isPositionInBoard(obstacle.position) && isDirection(obstacle.direction)
      )
    : [];
  return [...obstacles, ...itemWalls];
}

export function getWormholeExitOpenDirections(map: GameMap, exit: Position): Direction[] {
  const guaranteedWalls = getGuaranteedBlockingWalls(map);
  return CARDINAL_DIRECTIONS.filter((direction) => {
    const target = getNewPosition(exit, direction);
    return isPositionInBoard(target) && canMove(exit, direction, guaranteedWalls);
  });
}

export function getWormholeExitSafetyError(map: GameMap, exit: Position): string | null {
  if (!isPositionInBoard(exit)) return '웜홀 출구가 보드 밖에 있습니다.';

  const openDirections = getWormholeExitOpenDirections(map, exit);
  if (openDirections.length < 1) {
    return '웜홀 출구에는 즉시 이동할 수 있는 인접 칸이 최소 1개 필요합니다.';
  }

  return null;
}

export function isWormholeExitSafe(map: GameMap, exit: Position | null | undefined): boolean {
  return !!exit && getWormholeExitSafetyError(map, exit) === null;
}

const WORMHOLE_EXIT_GOAL_PATH_ERROR =
  '웜홀 출구에서 도착점까지 갈 수 있는 길이 필요합니다.';

/**
 * New-map-only reachability rule for wormhole exits. Only ordinary walls in
 * `map.obstacles` participate: item walls are intentionally ignored because
 * every wall available to new map authors is transient and can disappear.
 */
export function getWormholeExitGoalPathError(
  map: GameMap | null | undefined
): string | null {
  if (!isRecord(map) || !isPositionInBoard(map.endPosition)) {
    return WORMHOLE_EXIT_GOAL_PATH_ERROR;
  }

  const rawObstacles = (map as unknown as { obstacles?: unknown }).obstacles;
  if (rawObstacles != null && !Array.isArray(rawObstacles)) {
    return WORMHOLE_EXIT_GOAL_PATH_ERROR;
  }
  const obstacles = (Array.isArray(rawObstacles) ? rawObstacles : []) as unknown[];
  if (
    !isDenseRecordArray(obstacles) ||
    obstacles.some((obstacle) =>
      !isRecord(obstacle) ||
      !isPositionInBoard(obstacle.position as Position | undefined) ||
      !isDirection(obstacle.direction) ||
      !isPositionInBoard(
        getNewPosition(obstacle.position as Position, obstacle.direction as Direction)
      )
    )
  ) {
    return WORMHOLE_EXIT_GOAL_PATH_ERROR;
  }

  const rawItems = (map as unknown as { items?: unknown }).items;
  const rawLegacyItem = (map as unknown as { item?: unknown }).item;
  if (rawItems != null && !Array.isArray(rawItems)) {
    return WORMHOLE_EXIT_GOAL_PATH_ERROR;
  }
  if (rawLegacyItem != null && !isRecord(rawLegacyItem)) {
    return WORMHOLE_EXIT_GOAL_PATH_ERROR;
  }
  const itemValues = Array.isArray(rawItems)
    ? rawItems
    : rawLegacyItem == null
      ? []
      : [rawLegacyItem];
  if (!isDenseRecordArray(itemValues)) return WORMHOLE_EXIT_GOAL_PATH_ERROR;

  const permanentWalls = obstacles as Obstacle[];
  for (const item of itemValues as MapItem[]) {
    if (item.type !== 'wormhole') continue;
    if (
      !isPositionInBoard(item.exit) ||
      !findShortestPath(item.exit, map.endPosition, permanentWalls)
    ) {
      return WORMHOLE_EXIT_GOAL_PATH_ERROR;
    }
  }

  return null;
}

export function areWormholeExitsReachableFromGoal(
  map: GameMap | null | undefined
): boolean {
  return getWormholeExitGoalPathError(map) === null;
}

// 위치가 보드 내에 있는지 확인
export function isPositionInBoard(position: Position | null | undefined): position is Position {
  return !!position &&
    Number.isInteger(position.row) &&
    Number.isInteger(position.col) &&
    position.row >= 0 &&
    position.row < BOARD_SIZE &&
    position.col >= 0 &&
    position.col < BOARD_SIZE;
}

// 두 위치가 동일한지 확인
export function isSamePosition(pos1: Position, pos2: Position): boolean {
  return pos1.row === pos2.row && pos1.col === pos2.col;
}

// 특정 방향으로 이동했을 때의 새 위치 계산
export function getNewPosition(position: Position, direction: Direction): Position {
  const { row, col } = position;

  switch (direction) {
    case 'up':
      return { row: row - 1, col };
    case 'down':
      return { row: row + 1, col };
    case 'left':
      return { row, col: col - 1 };
    case 'right':
      return { row, col: col + 1 };
    default:
      return position;
  }
}

// 장애물 검사: 현재 위치에서 특정 방향으로 이동할 수 있는지 확인
export function canMove(currentPosition: Position, direction: Direction, obstacles: Obstacle[]): boolean {
  // 이동할 위치가 보드 내에 있는지 확인
  const newPosition = getNewPosition(currentPosition, direction);
  if (!isPositionInBoard(newPosition)) {
    return false;
  }

  // 해당 방향에 장애물이 있는지 확인
  const safeObstacles = Array.isArray(obstacles) ? obstacles : [];
  return !safeObstacles.some(obstacle => {
    if (!isRecord(obstacle) || !isPositionInBoard(obstacle.position) || !isDirection(obstacle.direction)) {
      return false;
    }
    const { position, direction: obstacleDirection } = obstacle;

    // 현재 위치에서 해당 방향으로 이동할 때 장애물 확인
    if (isSamePosition(position, currentPosition)) {
      return direction === obstacleDirection;
    }

    // 이동하려는 위치에서 역방향으로 장애물 확인
    if (isSamePosition(position, newPosition)) {
      return getOppositeDirection(direction) === obstacleDirection;
    }

    return false;
  });
}

// 방향의 반대 방향 반환
export function getOppositeDirection(direction: Direction): Direction {
  switch (direction) {
    case 'up': return 'down';
    case 'down': return 'up';
    case 'left': return 'right';
    case 'right': return 'left';
  }
}

// 최단 경로 탐색 (BFS 알고리즘 사용)
export function findShortestPath(
  start: Position,
  end: Position,
  obstacles: Obstacle[]
): Position[] | null {
  if (!isPositionInBoard(start) || !isPositionInBoard(end)) return null;

  // 방문 여부를 저장하는 배열
  const visited: boolean[][] = Array(BOARD_SIZE)
    .fill(null)
    .map(() => Array(BOARD_SIZE).fill(false));

  // 각 위치까지의 경로를 저장
  const paths: Record<string, Position[]> = {};
  const key = (pos: Position) => `${pos.row},${pos.col}`;

  // 시작 위치 초기화
  const queue: Position[] = [start];
  visited[start.row][start.col] = true;
  paths[key(start)] = [start];

  // BFS 탐색
  while (queue.length > 0) {
    const current = queue.shift()!;

    // 목적지에 도달한 경우
    if (isSamePosition(current, end)) {
      return paths[key(current)];
    }

    // 상하좌우 방향 탐색
    const directions: Direction[] = ['up', 'down', 'left', 'right'];

    for (const direction of directions) {
      if (canMove(current, direction, obstacles)) {
        const next = getNewPosition(current, direction);

        if (!visited[next.row][next.col]) {
          visited[next.row][next.col] = true;
          queue.push(next);
          paths[key(next)] = [...paths[key(current)], next];
        }
      }
    }
  }

  // 경로를 찾지 못한 경우
  return null;
}

function positionKey(position: Position): string {
  return `${position.row},${position.col}`;
}

function positionPermutations(positions: readonly Position[]): Position[][] {
  if (positions.length <= 1) return [positions.map((position) => ({ ...position }))];
  return positions.flatMap((position, index) =>
    positionPermutations(positions.filter((_, candidate) => candidate !== index))
      .map((remaining) => [{ ...position }, ...remaining])
  );
}

export function getWormholeChallengeCompletionSteps(
  challenge: LegacyWormholeChallenge
): number | null {
  let shortest: number | null = null;
  for (const sealOrder of positionPermutations(challenge.seals)) {
    const checkpoints = [challenge.startPosition, ...sealOrder, challenge.endPosition];
    let steps = 0;
    let valid = true;
    for (let index = 1; index < checkpoints.length; index += 1) {
      const route = findShortestPath(
        checkpoints[index - 1],
        checkpoints[index],
        challenge.obstacles
      );
      if (!route) {
        valid = false;
        break;
      }
      steps += route.length - 1;
    }
    if (valid && (shortest === null || steps < shortest)) shortest = steps;
  }
  return shortest;
}

export function getWormholeChallengeError(value: unknown): string | null {
  if (!isRecord(value)) return '웜홀 내부 맵 정보가 없습니다.';
  if (value.version === 2) return getDiceWormholeChallengeError(value);
  const keys = Object.keys(value).sort();
  if (keys.join('|') !== 'endPosition|obstacles|seals|startPosition|version') {
    return '웜홀 내부 맵 형식이 올바르지 않습니다.';
  }
  if (value.version !== 1) return '지원하지 않는 웜홀 내부 맵 버전입니다.';
  if (!isPositionInBoard(value.startPosition as Position | undefined) ||
      !isPositionInBoard(value.endPosition as Position | undefined)) {
    return '웜홀 내부 시작점과 출구를 보드 안에 배치해야 합니다.';
  }
  const startPosition = value.startPosition as Position;
  const endPosition = value.endPosition as Position;
  if (isSamePosition(startPosition, endPosition)) {
    return '웜홀 내부 시작점과 출구는 서로 달라야 합니다.';
  }

  if (!Array.isArray(value.seals) ||
      value.seals.length !== WORMHOLE_CHALLENGE_SEAL_COUNT ||
      !isDenseRecordArray(value.seals) ||
      value.seals.some((position) => !isPositionInBoard(position as Position))) {
    return `웜홀 내부 봉인을 정확히 ${WORMHOLE_CHALLENGE_SEAL_COUNT}개 배치해야 합니다.`;
  }
  const seals = value.seals as Position[];
  const specialPositions = [startPosition, endPosition, ...seals].map(positionKey);
  if (new Set(specialPositions).size !== specialPositions.length) {
    return '웜홀 내부 시작점·출구·봉인은 서로 다른 칸이어야 합니다.';
  }

  if (!Array.isArray(value.obstacles) ||
      value.obstacles.length < WORMHOLE_CHALLENGE_MIN_WALLS ||
      value.obstacles.length > WORMHOLE_CHALLENGE_MAX_WALLS ||
      !isDenseRecordArray(value.obstacles)) {
    return `웜홀 내부 벽은 ${WORMHOLE_CHALLENGE_MIN_WALLS}~${WORMHOLE_CHALLENGE_MAX_WALLS}개를 배치해야 합니다.`;
  }
  const obstacles = value.obstacles as Obstacle[];
  for (const obstacle of obstacles) {
    if (
      Object.keys(obstacle).sort().join('|') !== 'direction|position' ||
      !isPositionInBoard(obstacle.position) ||
      !isDirection(obstacle.direction) ||
      !isPositionInBoard(getNewPosition(obstacle.position, obstacle.direction))
    ) {
      return '웜홀 내부 벽이 유효한 두 칸 사이에 있지 않습니다.';
    }
  }
  for (let index = 0; index < obstacles.length; index += 1) {
    if (obstacles.slice(0, index).some((existing) =>
      isSameWallSegment(
        obstacles[index].position,
        obstacles[index].direction,
        existing.position,
        existing.direction
      )
    )) {
      return '웜홀 내부의 같은 물리 벽을 중복 배치할 수 없습니다.';
    }
  }

  const challenge = value as unknown as LegacyWormholeChallenge;
  const completionSteps = getWormholeChallengeCompletionSteps(challenge);
  if (completionSteps === null) return '모든 봉인을 거쳐 내부 출구로 갈 수 있는 경로가 필요합니다.';
  if (completionSteps < WORMHOLE_CHALLENGE_MIN_STEPS) {
    return `최단 봉인 해제 동선이 ${WORMHOLE_CHALLENGE_MIN_STEPS}칸 이상이어야 합니다.`;
  }
  if (completionSteps > WORMHOLE_CHALLENGE_MAX_STEPS) {
    return `최단 봉인 해제 동선은 ${WORMHOLE_CHALLENGE_MAX_STEPS}칸을 넘을 수 없습니다.`;
  }
  return null;
}

export function isValidWormholeChallenge(value: unknown): value is WormholeChallenge {
  return getWormholeChallengeError(value) === null;
}

export function countUniqueMapWalls(obstacles: Obstacle[]): number {
  const unique: Obstacle[] = [];
  for (const obstacle of obstacles || []) {
    if (
      !unique.some((existing) =>
        isSameWallSegment(existing.position, existing.direction, obstacle.position, obstacle.direction)
      )
    ) {
      unique.push(obstacle);
    }
  }
  return unique.length;
}

export function getMapBudgetUsed(
  map: Pick<GameMap, 'obstacles' | 'items' | 'item'>
): number {
  const itemCost = getMapItems(map).reduce(
    (total, item) => total + (ITEM_COSTS[item.type] || 0),
    0
  );
  return countUniqueMapWalls(map.obstacles || []) + itemCost;
}

// 게임맵이 유효한지 확인 (시작점에서 끝점까지 경로가 존재하는지)
export function isValidMap(map: GameMap, expectedRulesVersion?: number): boolean {
  if (!isRecord(map)) return false;
  if (expectedRulesVersion != null && map.rulesVersion !== expectedRulesVersion) return false;
  if (!isPositionInBoard(map.startPosition) || !isPositionInBoard(map.endPosition)) return false;
  if (isSamePosition(map.startPosition, map.endPosition)) return false;
  if (map.skillLoadout != null && !isMazeSkillId(map.skillLoadout)) return false;
  if (map.runnerGear !== undefined && !isRunnerGear(map.runnerGear)) return false;

  const rawObstacles = (map as unknown as { obstacles?: unknown }).obstacles;
  if (rawObstacles != null && !Array.isArray(rawObstacles)) return false;
  const obstacles = (Array.isArray(rawObstacles) ? rawObstacles : []) as unknown[];
  if (!isDenseRecordArray(obstacles)) return false;
  if (
    obstacles.some(
      (obstacle) =>
        !isRecord(obstacle) ||
        !isPositionInBoard(obstacle.position as Position | undefined) ||
        !isDirection(obstacle.direction) ||
        !isPositionInBoard(
          getNewPosition(obstacle.position as Position, obstacle.direction as Direction)
        )
    )
  ) {
    return false;
  }
  const validObstacles = obstacles as Obstacle[];

  const rawItems = (map as unknown as { items?: unknown }).items;
  const rawLegacyItem = (map as unknown as { item?: unknown }).item;
  if (rawItems != null && !Array.isArray(rawItems)) return false;
  if (rawLegacyItem != null && !isRecord(rawLegacyItem)) return false;
  const itemValues = Array.isArray(rawItems)
    ? rawItems
    : rawLegacyItem == null
      ? []
      : [rawLegacyItem];
  if (!isDenseRecordArray(itemValues)) return false;
  const items = itemValues as MapItem[];

  const itemCounts: Partial<Record<ItemType, number>> = {};
  const occupiedCells = new Set<string>();
  const itemWalls: Obstacle[] = [];
  const permanentItemWalls: Obstacle[] = [];
  let itemCost = 0;

  const reserveCell = (position: Position | null | undefined): boolean => {
    if (!isPositionInBoard(position)) return false;
    if (isSamePosition(position, map.startPosition) || isSamePosition(position, map.endPosition)) {
      return false;
    }
    const key = `${position.row},${position.col}`;
    if (occupiedCells.has(key)) return false;
    occupiedCells.add(key);
    return true;
  };

  for (const item of items) {
    if (!Object.prototype.hasOwnProperty.call(ITEM_COSTS, item.type)) return false;
    const itemCount = (itemCounts[item.type] || 0) + 1;
    itemCounts[item.type] = itemCount;
    if (itemCount > ITEM_LIMITS[item.type]) return false;
    itemCost += ITEM_COSTS[item.type];

    if (isWallItemType(item.type)) {
      if (!isPositionInBoard(item.wallPosition) || !isDirection(item.wallDirection)) return false;
      if (!isPositionInBoard(getNewPosition(item.wallPosition, item.wallDirection))) return false;
      if (item.type === 'windWall' && item.effectDirection != null && !isDirection(item.effectDirection)) {
        return false;
      }
      const overlapsWall = [...validObstacles, ...itemWalls].some((wall) =>
        isSameWallSegment(item.wallPosition!, item.wallDirection!, wall.position, wall.direction)
      );
      if (overlapsWall) return false;
      const wall = { position: item.wallPosition, direction: item.wallDirection };
      itemWalls.push(wall);
      if (item.type === 'steelWall') permanentItemWalls.push(wall);
    } else if (item.type === 'mine' || item.type === 'smoke') {
      if (!reserveCell(item.position)) return false;
    } else if (item.type === 'wormhole') {
      if (!reserveCell(item.entrance) || !reserveCell(item.exit)) return false;
      if (item.challenge != null && !isValidWormholeChallenge(item.challenge)) return false;
    }
  }

  if (countUniqueMapWalls(validObstacles) + itemCost > getMapWallBudget(map)) return false;

  const basePath = findShortestPath(
    map.startPosition,
    map.endPosition,
    [...validObstacles, ...permanentItemWalls]
  );
  if (!basePath) return false;

  return items.every((item) => {
    if (item.type !== 'wormhole') return true;
    if (!item.entrance || !item.exit) return false;
    return isWormholeExitSafe(map, item.exit);
  });
}

/**
 * Strict boundary for newly saved maps. `isValidMap` remains intentionally
 * backward-compatible so already persisted legacy maps can still be read
 * while an older match drains.
 */
export function isValidNewMap(map: GameMap, expectedRulesVersion?: number): boolean {
  return isRunnerGear(map?.runnerGear)
    && map?.skillLoadout === DEFAULT_MAZE_SKILL
    && !getMapItems(map).some((item) => isRetiredNewMapItemType(item.type))
    && getMapItems(map).every((item) => item.type !== 'wormhole'
      || (item.challenge?.version === 2 && isValidNewDiceWormholeChallenge(item.challenge)))
    && isValidMap(map, expectedRulesVersion)
    && areWormholeExitsReachableFromGoal(map);
}
