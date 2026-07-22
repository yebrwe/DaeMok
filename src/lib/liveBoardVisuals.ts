import type { BoardFx } from '@/components/three/GameBoard3D';
import type { CollisionWall, Direction, GameState, MapItem, MazeSkillId, Position } from '@/types/game';
import type { MoveTurnOutcome } from '@/lib/gameTurn';
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

function appendDistinctWaypoint(route: Position[], position: Position | null | undefined): void {
  if (!position || (route.length > 0 && isSamePosition(route[route.length - 1], position))) return;
  route.push({ ...position });
}

function wallReboundVia(
  origin: Position,
  attempted: Position,
  position: Position,
  landingPosition?: Position | null
): Position[] | null {
  const landing = landingPosition || position;
  if (isSamePosition(position, origin) && isSamePosition(landing, origin)) return null;

  const route: Position[] = [];
  appendDistinctWaypoint(route, attempted);
  // A sideways/backward rebound must visibly return to the origin side of the
  // collided segment before travelling to its result cell. This also prevents
  // the pawn renderer from treating the two-cell gap as a teleport.
  if (!isSamePosition(landing, attempted)) appendDistinctWaypoint(route, origin);
  if (!isSamePosition(landing, position)) appendDistinctWaypoint(route, landing);
  return route.length > 0 ? route : null;
}

/**
 * Builds presentation-only waypoints from the authoritative move outcome.
 * New wind/thorn walls are blocking rebounds, while legacy pass-through wind
 * and the other forced walls retain their existing attempted-cell route.
 */
export function getWallReboundOutcomeVia(outcome: MoveTurnOutcome): Position[] | null {
  if (outcome.wallEffect !== 'windWall' && outcome.wallEffect !== 'thornWall') return null;

  const landedOnTrap = outcome.effect === 'smoke' ||
    outcome.effect === 'mine' ||
    outcome.effect === 'wormhole';
  if (outcome.effect !== 'bump' && !landedOnTrap) return null;

  return wallReboundVia(
    outcome.origin,
    outcome.attempted,
    outcome.position,
    landedOnTrap ? outcome.itemPosition : null
  );
}

/**
 * The third affected action is shown before the pawn wakes at its fixed return
 * point. `position` already is that final point, so the renderer only needs
 * the attempted cell as its presentation waypoint.
 */
export function getIllusionReturnOutcomeVia(outcome: MoveTurnOutcome): Position[] | null {
  if (outcome.illusionTransition !== 'returned' || !outcome.illusionReturnPosition) return null;
  // A wormhole action uses private 4x4 coordinates. The main board remounts at
  // the authoritative return point, so give it only that same-cell waypoint
  // instead of briefly sending the pawn through an unrelated outer-board cell.
  return outcome.illusionReturnFromWormhole
    ? [{ ...outcome.illusionReturnPosition }]
    : [{ ...outcome.attempted }];
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

interface SnapshotWallImpact {
  direction: Direction;
  via: Position[] | null;
}

function oppositeDirection(direction: Direction): Direction {
  if (direction === 'up') return 'down';
  if (direction === 'down') return 'up';
  if (direction === 'left') return 'right';
  return 'left';
}

function wallImpactFromSnapshots(
  origin: Position,
  position: Position,
  collision: CollisionWall | null,
  newlyConsumed: Array<{ item: MapItem }>
): SnapshotWallImpact | null {
  const wall = newlyConsumed.find(({ item }) => (
    item.type === 'iceWall' || item.type === 'windWall' || item.type === 'thornWall'
  ))?.item;
  if (!wall) return null;
  const crossed = crossedDirection(origin, wall);
  if (!crossed || (collision && crossed !== collision.direction)) return null;

  if (wall.type === 'iceWall') {
    // The redesigned ice wall always consumes itself and leaves the pawn at
    // the origin. Legacy pass-through ice remains distinguishable by movement.
    return isSamePosition(position, origin) ? { direction: crossed, via: null } : null;
  }

  const landingItem = newlyConsumed.find(({ item }) => (
    item.type === 'mine' || item.type === 'smoke' || item.type === 'wormhole'
  ))?.item;
  const landingPosition = landingItem?.type === 'wormhole'
    ? landingItem.entrance
    : landingItem?.position;
  const reboundDirection = wall.type === 'thornWall'
    ? oppositeDirection(crossed)
    : wall.effectDirection || crossed;
  const expectedLanding = getNewPosition(origin, reboundDirection);
  const actualLanding = landingPosition || position;

  // Authority projections can intentionally omit a consumed special-wall
  // collision. Geometry still distinguishes the redesigned origin-based
  // rebound from legacy pass-through wind (which pushes from attempted).
  if (!collision &&
    !isSamePosition(actualLanding, expectedLanding) &&
    !(!landingPosition && isSamePosition(position, origin))) return null;

  return {
    direction: crossed,
    via: wallReboundVia(
      origin,
      getNewPosition(origin, crossed),
      position,
      landingPosition
    ),
  };
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
  const collision = newCollision(previous, next, runnerId, mapOwnerId, origin);
  const wallImpact = anchorStoppedForcedMove
    ? null
    : wallImpactFromSnapshots(origin, position, collision, consumedOnPlayedMap);
  const reboundVia = wallImpact?.via || null;

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
      via: reboundVia || [...(route.length > 0 ? route : [mine.position]), origin],
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
      via: reboundVia || (route.length > 0 ? route : [wormhole.entrance]),
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

  if (collision || wallImpact) {
    const impactDirection = collision?.direction || wallImpact!.direction;
    return {
      action: 'bump',
      sequence,
      fx: { key: sequence, type: 'bump', at: origin, dir: impactDirection },
      via: reboundVia || (isSamePosition(position, origin) ? null : [origin]),
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
