import type { Direction, Position } from '@/types/game';

export interface WallPointerTarget {
  position: Position;
  direction: Direction;
}

const WALL_POINTER_SLOP_PX = 18;
const WALL_POINTER_TIE_EPSILON_PX = 0.01;
const WALL_DIRECTIONS = new Set<Direction>(['up', 'down', 'left', 'right']);

export interface WallPointerRect {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

export interface WallPointerCandidate {
  target: WallPointerTarget;
  rect: WallPointerRect;
}

function parseWallTarget(value: string | null): WallPointerTarget | null {
  const match = value?.match(/^(\d+),(\d+):(up|down|left|right)$/);
  if (!match) return null;

  const row = Number(match[1]);
  const col = Number(match[2]);
  const direction = match[3] as Direction;
  if (!Number.isInteger(row) || !Number.isInteger(col) || !WALL_DIRECTIONS.has(direction)) {
    return null;
  }

  return { position: { row, col }, direction };
}

function distanceFromRect(clientX: number, clientY: number, rect: WallPointerRect): number {
  const xDistance = clientX < rect.left
    ? rect.left - clientX
    : clientX > rect.right
      ? clientX - rect.right
      : 0;
  const yDistance = clientY < rect.top
    ? rect.top - clientY
    : clientY > rect.bottom
      ? clientY - rect.bottom
      : 0;

  return Math.hypot(xDistance, yDistance);
}

function isSamePointerTarget(
  left: WallPointerTarget,
  right: WallPointerTarget
): boolean {
  return left.position.row === right.position.row &&
    left.position.col === right.position.col &&
    left.direction === right.direction;
}

/**
 * Exact diagonals through an 8px board intersection are inherently tied. They
 * still need to install one predictable wall instead of becoming a dead zone.
 * Rank the four rays clockwise (up, right, down, left); an already highlighted
 * ray is kept ahead of this fallback so pointer movement does not flicker.
 */
function rayTieRank(
  clientX: number,
  clientY: number,
  rect: WallPointerRect
): number {
  const xDelta = (rect.left + rect.right) / 2 - clientX;
  const yDelta = (rect.top + rect.bottom) / 2 - clientY;

  if (Math.abs(yDelta) >= Math.abs(xDelta)) return yDelta <= 0 ? 0 : 2;
  return xDelta >= 0 ? 1 : 3;
}

export function chooseWallPointerTarget(
  candidates: readonly WallPointerCandidate[],
  clientX: number,
  clientY: number,
  preferredTarget: WallPointerTarget | null = null,
  slopPx = WALL_POINTER_SLOP_PX
): WallPointerTarget | null {
  const ranked = candidates
    .map((candidate, index) => ({
      ...candidate,
      index,
      distance: distanceFromRect(clientX, clientY, candidate.rect),
      preferred: preferredTarget && isSamePointerTarget(candidate.target, preferredTarget) ? 0 : 1,
      rayRank: rayTieRank(clientX, clientY, candidate.rect),
    }))
    .filter((candidate) => candidate.distance <= slopPx)
    .sort((left, right) => {
      const distanceDelta = left.distance - right.distance;
      if (Math.abs(distanceDelta) > WALL_POINTER_TIE_EPSILON_PX) return distanceDelta;

      return left.preferred - right.preferred ||
        left.rayRank - right.rayRank ||
        left.target.position.row - right.target.position.row ||
        left.target.position.col - right.target.position.col ||
        left.target.direction.localeCompare(right.target.direction) ||
        left.index - right.index;
    });

  return ranked[0]?.target || null;
}

/**
 * Expanded wall hit areas overlap on the compact editor board. Resolve a pointer
 * against the visible wall slots instead of trusting whichever pseudo-element
 * happens to be on top in DOM paint order.
 */
export function findNearestWallPointerTarget(
  container: HTMLElement,
  clientX: number,
  clientY: number,
  attributeName: 'data-wall-segment' | 'data-challenge-wall',
  preferredTarget: WallPointerTarget | null = null
): WallPointerTarget | null {
  const candidates: WallPointerCandidate[] = [];

  for (const element of container.querySelectorAll<HTMLElement>(`[${attributeName}]`)) {
    const target = parseWallTarget(element.getAttribute(attributeName));
    if (!target) continue;

    candidates.push({ target, rect: element.getBoundingClientRect() });
  }

  return chooseWallPointerTarget(candidates, clientX, clientY, preferredTarget);
}
