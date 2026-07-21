import type {
  Direction,
  MapItem,
  Obstacle,
  Position,
  WallItemType,
} from '@/types/game';
import type { WallPointerTarget } from '@/lib/wallPointer';

export type WallActionPreviewType = WallItemType | 'wormhole';

export interface WallActionPreviewPlan {
  type: WallActionPreviewType;
  kind: 'wall' | 'wormhole';
  from: Position;
  to: Position;
  direction: Direction;
  resultDirection?: Direction;
  orientation?: 'horizontal' | 'vertical';
  wall?: WallPointerTarget;
  segment?: string;
}
export interface WallPreviewContext {
  boardSize: number;
  obstacles: readonly Obstacle[];
  items: readonly MapItem[];
  reservedPositions?: readonly (Position | null | undefined)[];
}

interface RankedWallCandidate {
  wall: WallPointerTarget;
  from: Position;
  to: Position;
  distance: number;
  clutter: number;
}

const DIRECTIONS: readonly Direction[] = ['up', 'right', 'down', 'left'];

function positionKey(position: Position): string {
  return `${position.row},${position.col}`;
}

function samePosition(left: Position, right: Position): boolean {
  return left.row === right.row && left.col === right.col;
}

function isInsideBoard(position: Position, boardSize: number): boolean {
  return position.row >= 0 && position.col >= 0 &&
    position.row < boardSize && position.col < boardSize;
}

function adjacentPosition(position: Position, direction: Direction): Position {
  if (direction === 'up') return { row: position.row - 1, col: position.col };
  if (direction === 'down') return { row: position.row + 1, col: position.col };
  if (direction === 'left') return { row: position.row, col: position.col - 1 };
  return { row: position.row, col: position.col + 1 };
}

function canonicalWall(
  wall: WallPointerTarget,
  boardSize: number
): WallPointerTarget | null {
  let position = { ...wall.position };
  let direction = wall.direction;

  if (direction === 'up') {
    position = { row: position.row - 1, col: position.col };
    direction = 'down';
  } else if (direction === 'left') {
    position = { row: position.row, col: position.col - 1 };
    direction = 'right';
  }

  const adjacent = adjacentPosition(position, direction);
  if (!isInsideBoard(position, boardSize) || !isInsideBoard(adjacent, boardSize)) return null;
  return { position, direction };
}

export function wallPreviewSegmentKey(wall: WallPointerTarget, boardSize: number): string | null {
  const canonical = canonicalWall(wall, boardSize);
  return canonical
    ? `${canonical.position.row},${canonical.position.col}:${canonical.direction}`
    : null;
}

function occupiedWallKeys(context: WallPreviewContext): Set<string> {
  const occupied = new Set<string>();

  for (const obstacle of context.obstacles) {
    const key = wallPreviewSegmentKey(obstacle, context.boardSize);
    if (key) occupied.add(key);
  }

  for (const item of context.items) {
    if (!item.wallPosition || !item.wallDirection) continue;
    const key = wallPreviewSegmentKey(
      { position: item.wallPosition, direction: item.wallDirection },
      context.boardSize
    );
    if (key) occupied.add(key);
  }

  return occupied;
}

function reservedCellKeys(context: WallPreviewContext): Set<string> {
  const reserved = new Set<string>();
  const add = (position: Position | null | undefined) => {
    if (position && isInsideBoard(position, context.boardSize)) reserved.add(positionKey(position));
  };

  for (const position of context.reservedPositions || []) add(position);
  for (const item of context.items) {
    add(item.position);
    add(item.entrance);
    add(item.exit);
  }

  return reserved;
}

function candidateClutter(
  from: Position,
  to: Position,
  context: WallPreviewContext,
  occupied: ReadonlySet<string>,
  reserved: ReadonlySet<string>
): number {
  let clutter = 0;
  const visitedWalls = new Set<string>();

  for (const endpoint of [from, to]) {
    for (const direction of DIRECTIONS) {
      const neighbor = adjacentPosition(endpoint, direction);
      if (!isInsideBoard(neighbor, context.boardSize)) continue;
      const wallKey = wallPreviewSegmentKey({ position: endpoint, direction }, context.boardSize);
      if (wallKey && !visitedWalls.has(wallKey)) {
        visitedWalls.add(wallKey);
        if (occupied.has(wallKey)) clutter += 2;
      }
      if (reserved.has(positionKey(neighbor))) clutter += 1;
    }
  }

  return clutter;
}

function rankedWallCandidate(
  wall: WallPointerTarget,
  context: WallPreviewContext,
  occupied: ReadonlySet<string>,
  reserved: ReadonlySet<string>
): RankedWallCandidate | null {
  const canonical = canonicalWall(wall, context.boardSize);
  if (!canonical) return null;

  const segment = wallPreviewSegmentKey(canonical, context.boardSize);
  if (!segment || occupied.has(segment)) return null;

  const from = { ...canonical.position };
  const to = adjacentPosition(from, canonical.direction);
  if (reserved.has(positionKey(from)) || reserved.has(positionKey(to))) return null;

  const center = (context.boardSize - 1) / 2;
  const midpointRow = (from.row + to.row) / 2;
  const midpointCol = (from.col + to.col) / 2;

  return {
    wall: canonical,
    from,
    to,
    distance: Math.abs(midpointRow - center) + Math.abs(midpointCol - center),
    clutter: candidateClutter(from, to, context, occupied, reserved),
  };
}

function resultDirectionFor(candidate: RankedWallCandidate, context: WallPreviewContext): Direction {
  const preferred: Direction[] = candidate.wall.direction === 'right'
    ? ['down', 'up', 'right', 'left']
    : ['right', 'left', 'down', 'up'];

  return preferred.find((direction) =>
    isInsideBoard(adjacentPosition(candidate.to, direction), context.boardSize)
  ) || candidate.wall.direction;
}

function wallPlan(
  type: WallItemType,
  candidate: RankedWallCandidate,
  context: WallPreviewContext
): WallActionPreviewPlan {
  const direction = candidate.wall.direction;
  return {
    type,
    kind: 'wall',
    from: candidate.from,
    to: candidate.to,
    direction,
    ...(type === 'poisonWall' ? { resultDirection: resultDirectionFor(candidate, context) } : {}),
    orientation: direction === 'right' ? 'vertical' : 'horizontal',
    wall: candidate.wall,
    segment: wallPreviewSegmentKey(candidate.wall, context.boardSize) || undefined,
  };
}

export function createWallActionPreviewPlanAtTarget(
  type: WallItemType,
  wall: WallPointerTarget,
  context: WallPreviewContext
): WallActionPreviewPlan | null {
  const occupied = occupiedWallKeys(context);
  const reserved = reservedCellKeys(context);
  const candidate = rankedWallCandidate(wall, context, occupied, reserved);
  return candidate ? wallPlan(type, candidate, context) : null;
}

function findWallActionPreviewPlan(
  type: WallItemType,
  context: WallPreviewContext
): WallActionPreviewPlan | null {
  const occupied = occupiedWallKeys(context);
  const reserved = reservedCellKeys(context);
  const candidates: RankedWallCandidate[] = [];

  for (let row = 0; row < context.boardSize; row += 1) {
    for (let col = 0; col < context.boardSize; col += 1) {
      if (col < context.boardSize - 1) {
        const candidate = rankedWallCandidate(
          { position: { row, col }, direction: 'right' },
          context,
          occupied,
          reserved
        );
        if (candidate) candidates.push(candidate);
      }
      if (row < context.boardSize - 1) {
        const candidate = rankedWallCandidate(
          { position: { row, col }, direction: 'down' },
          context,
          occupied,
          reserved
        );
        if (candidate) candidates.push(candidate);
      }
    }
  }

  candidates.sort((left, right) =>
    left.clutter - right.clutter ||
    left.distance - right.distance ||
    left.from.row - right.from.row ||
    left.from.col - right.from.col ||
    left.wall.direction.localeCompare(right.wall.direction)
  );

  return candidates[0] ? wallPlan(type, candidates[0], context) : null;
}

function findWormholeActionPreviewPlan(context: WallPreviewContext): WallActionPreviewPlan | null {
  const reserved = reservedCellKeys(context);
  const center = (context.boardSize - 1) / 2;
  const cells: Position[] = [];

  for (let row = 0; row < context.boardSize; row += 1) {
    for (let col = 0; col < context.boardSize; col += 1) {
      const position = { row, col };
      if (!reserved.has(positionKey(position))) cells.push(position);
    }
  }

  cells.sort((left, right) =>
    Math.abs(left.row - center) + Math.abs(left.col - center) -
      (Math.abs(right.row - center) + Math.abs(right.col - center)) ||
    left.row - right.row ||
    left.col - right.col
  );

  const from = cells[0];
  if (!from) return null;
  const destinations = cells.filter((position) => !samePosition(position, from));
  destinations.sort((left, right) => {
    const leftDistance = Math.abs(left.row - from.row) + Math.abs(left.col - from.col);
    const rightDistance = Math.abs(right.row - from.row) + Math.abs(right.col - from.col);
    const leftIdealPenalty = Math.abs(leftDistance - 3);
    const rightIdealPenalty = Math.abs(rightDistance - 3);
    return leftIdealPenalty - rightIdealPenalty ||
      Math.abs(left.row - center) + Math.abs(left.col - center) -
        (Math.abs(right.row - center) + Math.abs(right.col - center)) ||
      left.row - right.row ||
      left.col - right.col;
  });

  const to = destinations[0];
  if (!to) return null;

  return {
    type: 'wormhole',
    kind: 'wormhole',
    from,
    to,
    direction: 'right',
  };
}

export function findSafeWallActionPreviewPlan(
  type: WallActionPreviewType,
  context: WallPreviewContext
): WallActionPreviewPlan | null {
  return type === 'wormhole'
    ? findWormholeActionPreviewPlan(context)
    : findWallActionPreviewPlan(type, context);
}
