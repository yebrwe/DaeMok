import type { BoardFx } from '@/components/three/GameBoard3D';
import type { CollisionWall, Direction, GameState, MapItem, MazeSkillId, Position } from '@/types/game';
import { getMapItems, getNewPosition, isSamePosition, isSameWallSegment } from '@/lib/gameUtils';

export type LiveBoardVisualAction = 'move' | 'bump' | 'fire' | 'poison' | 'mine' | 'wormhole' | 'radar' | 'goal';

export interface LiveBoardVisualTransition {
  action: LiveBoardVisualAction;
  sequence: number;
  fx: BoardFx | null;
  via: Position[] | null;
}

export interface LocalBoardVisualRoute {
  destination: Position;
  moves: number;
  via: Position[];
}

export function createLocalBoardVisualRoute(
  via: Position[] | null | undefined,
  destination: Position,
  moves: number
): LocalBoardVisualRoute | null {
  if (!via || via.length === 0) return null;
  return {
    destination: { ...destination },
    moves,
    via: via.map((point) => ({ ...point })),
  };
}

export function getActiveLocalBoardVia(
  route: LocalBoardVisualRoute | null,
  position: Position,
  moves: number
): Position[] | null {
  return route && route.moves === moves && isSamePosition(route.destination, position)
    ? route.via
    : null;
}

const DIRECTIONS: Direction[] = ['up', 'down', 'left', 'right'];

function flags(value: unknown): Record<number, boolean> {
  if (value === true) return { 0: true };
  return value && typeof value === 'object' ? value as Record<number, boolean> : {};
}

function collisions(value: GameState['collisionWalls']): CollisionWall[] {
  return Object.values(value || {}).filter(Boolean) as CollisionWall[];
}

function collisionSignature(wall: CollisionWall): string {
  return [
    wall.playerId,
    wall.mapOwnerId,
    wall.position.row,
    wall.position.col,
    wall.direction,
    wall.timestamp,
  ].join(':');
}

function newCollision(
  previous: GameState,
  next: GameState,
  runnerId: string,
  mapOwnerId: string,
  origin: Position
): CollisionWall | null {
  const prior = new Set(collisions(previous.collisionWalls).map(collisionSignature));
  return collisions(next.collisionWalls)
    .filter((wall) => (
      wall.playerId === runnerId &&
      wall.mapOwnerId === mapOwnerId &&
      isSamePosition(wall.position, origin) &&
      !prior.has(collisionSignature(wall))
    ))
    .sort((a, b) => Number(b.timestamp) - Number(a.timestamp))[0] || null;
}

function newlyConsumedItems(
  previous: GameState,
  next: GameState,
  mapOwnerId: string,
  items: MapItem[]
): Array<{ item: MapItem; index: number }> {
  const before = flags(previous.itemState?.[mapOwnerId]?.consumed);
  const after = flags(next.itemState?.[mapOwnerId]?.consumed);
  return items.flatMap((item, index) => (
    !before[index] && after[index] ? [{ item, index }] : []
  ));
}

function cardinalPath(from: Position, to: Position, includeDestination: boolean): Position[] {
  const distance = Math.abs(to.row - from.row) + Math.abs(to.col - from.col);
  if (distance <= 1 || (from.row !== to.row && from.col !== to.col)) return [];
  const rowStep = Math.sign(to.row - from.row);
  const colStep = Math.sign(to.col - from.col);
  const limit = includeDestination ? distance : distance - 1;
  return Array.from({ length: limit }, (_, index) => ({
    row: from.row + rowStep * (index + 1),
    col: from.col + colStep * (index + 1),
  }));
}

function crossedDirection(origin: Position, item: MapItem): Direction | null {
  if (!item.wallPosition || !item.wallDirection) return null;
  return DIRECTIONS.find((direction) => (
    isSameWallSegment(origin, direction, item.wallPosition!, item.wallDirection!)
  )) || null;
}

function forcedMoveVia(
  origin: Position,
  position: Position,
  newlyConsumed: Array<{ item: MapItem }>
): Position[] | null {
  const wall = newlyConsumed.find(({ item }) => (
    item.type === 'windWall' || item.type === 'mirrorWall'
  ))?.item;
  const direction = wall ? crossedDirection(origin, wall) : null;
  if (direction) return [getNewPosition(origin, direction)];

  const intermediate = cardinalPath(origin, position, false);
  return intermediate.length > 0 ? intermediate : null;
}

function consumedSkill(previous: GameState, next: GameState, runnerId: string, skillId: MazeSkillId): boolean {
  const before = previous.itemState?.[runnerId]?.mazeSkill?.consumed?.[skillId];
  const after = next.itemState?.[runnerId]?.mazeSkill?.consumed?.[skillId];
  return before !== true && after === true;
}

/**
 * Reconstructs presentation-only animation data from two authoritative RTDB snapshots.
 * It deliberately does not write an action log back to the room.
 */
export function deriveLiveBoardVisualTransition(
  previous: GameState,
  next: GameState,
  runnerId: string,
  sequence: number
): LiveBoardVisualTransition | null {
  if (previous.currentTurn !== runnerId) return null;
  if ((next.turnNumber || 0) !== (previous.turnNumber || 0) + 1) return null;

  const beforeRunner = previous.players?.[runnerId];
  const afterRunner = next.players?.[runnerId];
  const mapOwnerId = previous.assignments?.[runnerId] || next.assignments?.[runnerId];
  const map = mapOwnerId ? previous.maps?.[mapOwnerId] || next.maps?.[mapOwnerId] : null;
  if (!beforeRunner || !afterRunner || !mapOwnerId || !map) return null;

  const origin = beforeRunner.position || map.startPosition;
  const position = afterRunner.position || origin;
  const items = getMapItems(map);
  const consumedOnPlayedMap = newlyConsumedItems(previous, next, mapOwnerId, items);
  const anchorStoppedForcedMove = consumedSkill(previous, next, runnerId, 'anchor');

  if (!beforeRunner.finished && afterRunner.finished) {
    const via = forcedMoveVia(origin, position, consumedOnPlayedMap);
    return {
      action: 'goal',
      sequence,
      fx: { key: sequence, type: 'goal', at: position },
      via,
    };
  }

  const mine = !anchorStoppedForcedMove
    ? consumedOnPlayedMap.find(({ item }) => item.type === 'mine')?.item
    : null;
  if (mine?.position) {
    const route = cardinalPath(origin, mine.position, true);
    return {
      action: 'mine',
      sequence,
      fx: { key: sequence, type: 'mine', at: mine.position, delay: 0.35 },
      via: [...(route.length > 0 ? route : [mine.position]), origin],
    };
  }

  const wormhole = !anchorStoppedForcedMove
    ? consumedOnPlayedMap.find(({ item }) => item.type === 'wormhole')?.item
    : null;
  if (wormhole?.entrance) {
    const route = cardinalPath(origin, wormhole.entrance, true);
    const enteredInternalRoom = !previous.wormholeRunsByPlayer?.[runnerId]
      && !!next.wormholeRunsByPlayer?.[runnerId];
    return {
      action: 'wormhole',
      sequence,
      fx: {
        key: sequence,
        type: 'wormhole',
        at: wormhole.entrance,
        to: position,
        delay: 0.35,
        ...(enteredInternalRoom ? { wormholeTransition: 'entered' as const } : {}),
      },
      via: route.length > 0 ? route : [wormhole.entrance],
    };
  }

  const fireWall = consumedOnPlayedMap.find(({ item }) => item.type === 'fireWall')?.item;
  const fireDirection = fireWall ? crossedDirection(origin, fireWall) : null;
  if (fireWall && fireDirection) {
    return {
      action: 'fire',
      sequence,
      fx: { key: sequence, type: 'fire', at: origin, dir: fireDirection },
      via: null,
    };
  }

  const collision = newCollision(previous, next, runnerId, mapOwnerId, origin);
  if (collision) {
    return {
      action: 'bump',
      sequence,
      fx: { key: sequence, type: 'bump', at: origin, dir: collision.direction },
      via: isSamePosition(position, origin) ? null : [origin],
    };
  }

  const ownMap = previous.maps?.[runnerId] || next.maps?.[runnerId];
  const consumedOwnItems = ownMap
    ? newlyConsumedItems(previous, next, runnerId, getMapItems(ownMap))
    : [];
  const usedRadar = consumedOwnItems.some(({ item }) => item.type === 'radar') ||
    consumedSkill(previous, next, runnerId, 'scoutPulse');
  if (usedRadar) {
    return {
      action: 'radar',
      sequence,
      fx: { key: sequence, type: 'radar', at: position },
      via: null,
    };
  }

  const moved = !isSamePosition(position, origin);
  const spentTurn = (afterRunner.moves || 0) > (beforeRunner.moves || 0);
  if (!moved && !spentTurn) return null;
  return {
    action: 'move',
    sequence,
    fx: null,
    via: forcedMoveVia(origin, position, consumedOnPlayedMap),
  };
}
