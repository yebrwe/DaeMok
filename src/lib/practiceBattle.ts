import {
  CollisionWall,
  Direction,
  GameMap,
  GamePhase,
  GameState,
  MapItem,
  Obstacle,
  Player,
  Position,
} from '@/types/game';
import {
  BOARD_SIZE,
  canMove,
  findShortestPath,
  getMapBudgetUsed,
  getMapItems,
  getNewPosition,
  GAME_RULES_VERSION,
  isSameWallSegment,
  isPositionInBoard,
  isSamePosition,
  isValidMap,
  MAX_OBSTACLES,
} from '@/lib/gameUtils';
import {
  isVisionObscuredForPlayer,
  mergeWallSegments,
} from '@/lib/gameTurn';
import { createMazeSkillState } from '@/lib/mazeSkills';

export const PRACTICE_USER_ID = 'practice-user';
export const PRACTICE_AI_IDS = ['practice-ai-1', 'practice-ai-2', 'practice-ai-3'] as const;

export const PRACTICE_AI_NAMES: Record<string, string> = {
  'practice-ai-1': 'AI 루키',
  'practice-ai-2': 'AI 탐험가',
  'practice-ai-3': 'AI 길잡이',
};

export const PRACTICE_PAWN_COLORS: Record<string, string> = {
  [PRACTICE_USER_ID]: '#3b82f6',
  'practice-ai-1': '#ef4444',
  'practice-ai-2': '#22c55e',
  'practice-ai-3': '#a855f7',
};

const wall = (row: number, col: number, direction: Direction): Obstacle => ({
  position: { row, col },
  direction,
});

const mine = (row: number, col: number): MapItem => ({
  type: 'mine',
  position: { row, col },
});

const oneTimeWall = (row: number, col: number, direction: Direction): MapItem => ({
  type: 'oneTimeWall',
  wallPosition: { row, col },
  wallDirection: direction,
});

const specialWall = (
  type: MapItem['type'],
  row: number,
  col: number,
  direction: Direction,
  effectDirection?: Direction
): MapItem => ({
  type,
  wallPosition: { row, col },
  wallDirection: direction,
  ...(effectDirection ? { effectDirection } : {}),
});

const wormhole = (entrance: Position, exit: Position): MapItem => ({
  type: 'wormhole',
  entrance,
  exit,
});

const smoke = (row: number, col: number): MapItem => ({
  type: 'smoke',
  position: { row, col },
});

const BASE_PRACTICE_MAP_TEMPLATES: GameMap[] = [
  {
    skillLoadout: 'scoutPulse',
    startPosition: { row: 0, col: 0 },
    endPosition: { row: 5, col: 5 },
    obstacles: [
      wall(0, 0, 'right'),
      wall(1, 0, 'right'),
      wall(2, 1, 'down'),
      wall(2, 2, 'down'),
      wall(3, 2, 'right'),
      wall(4, 3, 'right'),
      wall(3, 4, 'down'),
    ],
    items: [
      oneTimeWall(5, 2, 'right'),
      mine(3, 0),
      smoke(4, 0),
      specialWall('fireWall', 0, 1, 'down'),
      specialWall('poisonWall', 2, 3, 'right'),
      specialWall('iceWall', 4, 1, 'right'),
      specialWall('thornWall', 2, 5, 'down'),
      specialWall('crystalWall', 0, 2, 'right'),
    ],
  },
  {
    skillLoadout: 'scoutPulse',
    startPosition: { row: 5, col: 0 },
    endPosition: { row: 5, col: 5 },
    obstacles: [
      wall(5, 0, 'right'),
      wall(4, 0, 'right'),
      wall(3, 1, 'up'),
      wall(3, 2, 'right'),
      wall(2, 3, 'down'),
      wall(1, 4, 'left'),
    ],
    items: [
      wormhole({ row: 2, col: 0 }, { row: 4, col: 1 }),
      specialWall('steelWall', 5, 1, 'up'),
      specialWall('windWall', 4, 3, 'up', 'right'),
      specialWall('crystalWall', 1, 2, 'right'),
    ],
  },
  {
    skillLoadout: 'scoutPulse',
    startPosition: { row: 0, col: 5 },
    endPosition: { row: 5, col: 0 },
    obstacles: [],
    items: [
      oneTimeWall(5, 3, 'left'),
      specialWall('phaseWall', 0, 4, 'down'),
      specialWall('steelWall', 3, 3, 'down'),
    ],
  },
  {
    skillLoadout: 'scoutPulse',
    startPosition: { row: 5, col: 5 },
    endPosition: { row: 0, col: 0 },
    obstacles: [
      wall(5, 5, 'left'),
      wall(4, 5, 'left'),
      wall(3, 4, 'up'),
      wall(3, 3, 'left'),
      wall(2, 2, 'down'),
      wall(1, 2, 'left'),
      wall(1, 1, 'down'),
    ],
    items: [
      oneTimeWall(0, 3, 'left'),
      mine(3, 4),
      smoke(4, 5),
      specialWall('thornWall', 4, 4, 'up'),
      specialWall('crystalWall', 2, 3, 'left'),
    ],
  },
];

function clonePosition(position: Position): Position {
  return { row: position.row, col: position.col };
}

export function clonePracticeMap(map: GameMap): GameMap {
  return {
    rulesVersion: map.rulesVersion || GAME_RULES_VERSION,
    startPosition: clonePosition(map.startPosition),
    endPosition: clonePosition(map.endPosition),
    obstacles: (map.obstacles || []).map((entry) => ({
      position: clonePosition(entry.position),
      direction: entry.direction,
    })),
    items: getMapItems(map).map((item) => ({
      ...item,
      position: item.position ? clonePosition(item.position) : undefined,
      wallPosition: item.wallPosition ? clonePosition(item.wallPosition) : undefined,
      entrance: item.entrance ? clonePosition(item.entrance) : undefined,
      exit: item.exit ? clonePosition(item.exit) : undefined,
    })),
    // 연습전에서는 스킬을 노출하거나 사용하지 않는다. V3 맵 필드는 유지하되
    // 자동 발동형 anchor가 이동 결과에 개입하지 않도록 수동형 기본값으로 통일한다.
    skillLoadout: 'scoutPulse',
  };
}

function canonicalWallCandidates(seed: number): Obstacle[] {
  const candidates: Obstacle[] = [];
  for (let row = 0; row < BOARD_SIZE; row += 1) {
    for (let col = 0; col < BOARD_SIZE; col += 1) {
      if (col < BOARD_SIZE - 1) candidates.push(wall(row, col, 'right'));
      if (row < BOARD_SIZE - 1) candidates.push(wall(row, col, 'down'));
    }
  }
  const offset = ((seed % candidates.length) + candidates.length) % candidates.length;
  return [...candidates.slice(offset), ...candidates.slice(0, offset)];
}

function permanentPracticeWalls(map: GameMap): Obstacle[] {
  const steelWalls = getMapItems(map).flatMap((item) =>
    item.type === 'steelWall' && item.wallPosition && item.wallDirection
      ? [{ position: item.wallPosition, direction: item.wallDirection }]
      : []
  );
  return [...(map.obstacles || []), ...steelWalls];
}

export function getPracticeMapRouteLength(map: GameMap): number {
  const path = findShortestPath(map.startPosition, map.endPosition, permanentPracticeWalls(map));
  return path ? path.length - 1 : -1;
}

export function fillPracticeMapBudget(map: GameMap, seed = 0): GameMap {
  let candidate = clonePracticeMap(map);
  const wallItems = getMapItems(candidate).flatMap((item) =>
    item.wallPosition && item.wallDirection
      ? [{ position: item.wallPosition, direction: item.wallDirection }]
      : []
  );

  while (getMapBudgetUsed(candidate) < MAX_OBSTACLES) {
    let best: GameMap | null = null;
    let bestScore = Number.NEGATIVE_INFINITY;
    const currentPath = findShortestPath(
      candidate.startPosition,
      candidate.endPosition,
      permanentPracticeWalls(candidate)
    ) || [];

    canonicalWallCandidates(seed + candidate.obstacles.length).forEach((nextWall, index) => {
      const occupied = [...candidate.obstacles, ...wallItems].some((existing) =>
        isSameWallSegment(
          existing.position,
          existing.direction,
          nextWall.position,
          nextWall.direction
        )
      );
      if (occupied) return;

      const nextMap = {
        ...candidate,
        obstacles: [...candidate.obstacles, nextWall],
      };
      if (getMapBudgetUsed(nextMap) > MAX_OBSTACLES || !isValidMap(nextMap)) return;

      const routeLength = getPracticeMapRouteLength(nextMap);
      const blocksCurrentRoute = currentPath.slice(0, -1).some((position, pathIndex) => {
        const direction = directionBetween(position, currentPath[pathIndex + 1]);
        return !!direction && isSameWallSegment(
          position,
          direction,
          nextWall.position,
          nextWall.direction
        );
      });
      const score = routeLength * 1_000_000 + (blocksCurrentRoute ? 10_000 : 0) - index;
      if (score > bestScore) {
        best = nextMap;
        bestScore = score;
      }
    });

    if (!best) break;
    candidate = best;
  }

  return candidate;
}

export const PRACTICE_MAP_TEMPLATES: GameMap[] = BASE_PRACTICE_MAP_TEMPLATES.map(
  (map, index) => fillPracticeMapBudget(map, index * 17 + 3)
);

export function createQuickPracticeMap(): GameMap {
  return clonePracticeMap(PRACTICE_MAP_TEMPLATES[3]);
}

export function createAiPracticeMap(index: number): GameMap {
  const candidate = clonePracticeMap(PRACTICE_MAP_TEMPLATES[index % 3]);
  return isValidMap(candidate) && getMapBudgetUsed(candidate) === MAX_OBSTACLES
    ? candidate
    : fillPracticeMapBudget({
        startPosition: { row: 0, col: 0 },
        endPosition: { row: 5, col: 5 },
        obstacles: [],
        items: [],
        skillLoadout: 'scoutPulse',
      }, index + 101);
}

export function createMapTestGameState(playerMap: GameMap): GameState {
  const map = clonePracticeMap(playerMap);
  if (!isValidMap(map) || getMapBudgetUsed(map) !== MAX_OBSTACLES) {
    throw new Error(`Map test requires a valid ${MAX_OBSTACLES}/${MAX_OBSTACLES} map.`);
  }
  const player: Player = {
    id: PRACTICE_USER_ID,
    displayName: '나',
    position: clonePosition(map.startPosition),
    positionHistory: [clonePosition(map.startPosition)],
    moves: 0,
    isReady: true,
    isOnline: true,
    finished: false,
    forfeited: false,
  };

  return {
    phase: GamePhase.PLAY,
    players: { [PRACTICE_USER_ID]: player },
    maps: { [PRACTICE_USER_ID]: map },
    assignments: { [PRACTICE_USER_ID]: PRACTICE_USER_ID },
    currentTurn: PRACTICE_USER_ID,
    turnOrder: [PRACTICE_USER_ID],
    turnNumber: 1,
    winner: null,
    draw: null,
    collisionWalls: {},
    itemState: {
      [PRACTICE_USER_ID]: {
        consumed: {},
        mazeSkill: createMazeSkillState(map.skillLoadout),
      },
    },
    revealedWallsByPlayer: {},
    visionEffectsByPlayer: {},
    turnMessage: '내 맵 테스트를 시작합니다.',
    turnMessageTimestamp: Date.now(),
  };
}

export function createPracticeGameState(playerMap: GameMap, requestedAiCount: number): GameState {
  const aiCount = Math.max(1, Math.min(3, Math.trunc(requestedAiCount)));
  const aiIds = PRACTICE_AI_IDS.slice(0, aiCount);
  const turnOrder = [PRACTICE_USER_ID, ...aiIds];
  const maps: Record<string, GameMap> = {
    [PRACTICE_USER_ID]: clonePracticeMap(playerMap),
  };
  aiIds.forEach((id, index) => {
    maps[id] = createAiPracticeMap(index);
  });

  const assignments: Record<string, string> = {};
  turnOrder.forEach((runnerId, index) => {
    assignments[runnerId] = turnOrder[(index + 1) % turnOrder.length];
  });

  const players: Record<string, Player> = {};
  turnOrder.forEach((id) => {
    const playedMap = maps[assignments[id]];
    players[id] = {
      id,
      displayName: id === PRACTICE_USER_ID ? '나' : PRACTICE_AI_NAMES[id],
      position: clonePosition(playedMap.startPosition),
      positionHistory: [clonePosition(playedMap.startPosition)],
      moves: 0,
      isReady: true,
      isOnline: true,
      finished: false,
      forfeited: false,
    };
  });

  const itemState = Object.fromEntries(turnOrder.map((id) => [id, {
    consumed: {},
    mazeSkill: createMazeSkillState(maps[id].skillLoadout),
  }]));

  return {
    phase: GamePhase.PLAY,
    players,
    maps,
    assignments,
    currentTurn: PRACTICE_USER_ID,
    turnOrder,
    turnNumber: 1,
    winner: null,
    draw: null,
    collisionWalls: {},
    itemState,
    revealedWallsByPlayer: {},
    visionEffectsByPlayer: {},
    turnMessage: '내 턴입니다.',
    turnMessageTimestamp: Date.now(),
  };
}

export function getPracticeCollisionWalls(state: GameState): CollisionWall[] {
  return Object.values(state.collisionWalls || {}).filter(Boolean) as CollisionWall[];
}

export function practiceWallKey(position: Position, direction: Direction): string {
  const target = getNewPosition(position, direction);
  const points = [`${position.row},${position.col}`, `${target.row},${target.col}`].sort();
  return points.join('|');
}

function knownWallsForRunner(state: GameState, runnerId: string): Obstacle[] {
  const mapOwnerId = state.assignments?.[runnerId];
  const collisions = getPracticeCollisionWalls(state)
    .filter((entry) => entry.playerId === runnerId && entry.mapOwnerId === mapOwnerId)
    .map((entry) => ({ position: entry.position, direction: entry.direction }));
  return mergeWallSegments(collisions, state.revealedWallsByPlayer?.[runnerId] || []);
}

function directionBetween(from: Position, to: Position): Direction | null {
  if (to.row === from.row - 1 && to.col === from.col) return 'up';
  if (to.row === from.row + 1 && to.col === from.col) return 'down';
  if (to.row === from.row && to.col === from.col - 1) return 'left';
  if (to.row === from.row && to.col === from.col + 1) return 'right';
  return null;
}

function findExplorationPath(
  start: Position,
  end: Position,
  knownWalls: Obstacle[],
  probeCounts: Record<string, number>
): Position[] | null {
  const key = (position: Position) => `${position.row},${position.col}`;
  const knownWallKeys = new Set(
    knownWalls.map((entry) => practiceWallKey(entry.position, entry.direction))
  );
  const positions = Array.from({ length: BOARD_SIZE * BOARD_SIZE }, (_, index) => ({
    row: Math.floor(index / BOARD_SIZE),
    col: index % BOARD_SIZE,
  }));
  const unvisited = new Set(positions.map(key));
  const distances = new Map<string, number>([[key(start), 0]]);
  const previous = new Map<string, Position>();
  const byKey = new Map(positions.map((position) => [key(position), position]));
  const directions: Direction[] = ['up', 'right', 'down', 'left'];

  while (unvisited.size > 0) {
    let currentKey: string | null = null;
    let currentDistance = Number.POSITIVE_INFINITY;
    unvisited.forEach((candidateKey) => {
      const candidateDistance = distances.get(candidateKey) ?? Number.POSITIVE_INFINITY;
      if (candidateDistance < currentDistance) {
        currentKey = candidateKey;
        currentDistance = candidateDistance;
      }
    });
    if (!currentKey || !Number.isFinite(currentDistance)) break;

    unvisited.delete(currentKey);
    const current = byKey.get(currentKey);
    if (!current) break;
    if (isSamePosition(current, end)) break;

    directions.forEach((direction) => {
      const next = getNewPosition(current, direction);
      if (!isPositionInBoard(next) || !unvisited.has(key(next))) return;
      const segmentKey = practiceWallKey(current, direction);
      const knownPenalty = knownWallKeys.has(segmentKey)
        ? 8 + (probeCounts[segmentKey] || 0) * 18
        : 0;
      const candidateDistance = currentDistance + 1 + knownPenalty;
      if (candidateDistance < (distances.get(key(next)) ?? Number.POSITIVE_INFINITY)) {
        distances.set(key(next), candidateDistance);
        previous.set(key(next), current);
      }
    });
  }

  if (!distances.has(key(end))) return null;
  const path: Position[] = [end];
  let cursor = end;
  while (!isSamePosition(cursor, start)) {
    const parent = previous.get(key(cursor));
    if (!parent) return null;
    path.push(parent);
    cursor = parent;
  }
  return path.reverse();
}

export function choosePracticeAiAction(
  state: GameState,
  runnerId: string,
  probeCounts: Record<string, number> = {}
): { type: 'move'; direction: Direction } | null {
  if (state.phase !== GamePhase.PLAY || state.currentTurn !== runnerId) return null;
  const player = state.players[runnerId];
  const mapOwnerId = state.assignments?.[runnerId];
  const playedMap = mapOwnerId ? state.maps?.[mapOwnerId] : null;
  if (!player || player.finished || !playedMap) return null;

  if (isVisionObscuredForPlayer(state, runnerId)) {
    const knownWalls = knownWallsForRunner(state, runnerId);
    const directions: Direction[] = ['up', 'right', 'down', 'left'];
    const offset = (state.turnNumber || 1) % directions.length;
    for (let index = 0; index < directions.length; index += 1) {
      const direction = directions[(index + offset) % directions.length];
      if (
        isPositionInBoard(getNewPosition(player.position, direction)) &&
        canMove(player.position, direction, knownWalls)
      ) {
        return { type: 'move', direction };
      }
    }
  }

  const knownWalls = knownWallsForRunner(state, runnerId);
  const path = findExplorationPath(player.position, playedMap.endPosition, knownWalls, probeCounts);
  if (!path || path.length < 2) return null;

  const direction = directionBetween(player.position, path[1]);
  if (!direction) return null;

  return { type: 'move', direction };
}

export interface PracticeStanding {
  id: string;
  name: string;
  moves: number;
  finished: boolean;
  rank: number;
}

export function getPracticeStandings(state: GameState): PracticeStanding[] {
  const order = state.turnOrder || Object.keys(state.players);
  const entries = order.map((id, orderIndex) => {
    const player = state.players[id];
    return {
      id,
      name: player.displayName || id,
      moves: player.finished ? (player.finishMoves ?? player.moves ?? 0) : (player.moves ?? 0),
      finished: !!player.finished,
      orderIndex,
    };
  });
  entries.sort((a, b) => {
    if (a.finished !== b.finished) return a.finished ? -1 : 1;
    return a.moves - b.moves || a.orderIndex - b.orderIndex;
  });

  let previousRank = 0;
  return entries.map((entry, index, sorted) => {
    const tied = index > 0 &&
      sorted[index - 1].moves === entry.moves &&
      sorted[index - 1].finished === entry.finished;
    const rank = tied ? previousRank : index + 1;
    previousRank = rank;
    return {
      id: entry.id,
      name: entry.name,
      moves: entry.moves,
      finished: entry.finished,
      rank,
    };
  });
}
