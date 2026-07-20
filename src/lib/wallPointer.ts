import type { Direction, Position } from '@/types/game';

export interface WallPointerTarget {
  position: Position;
  direction: Direction;
}

const WALL_POINTER_SLOP_PX = 18;
const WALL_POINTER_TIE_PX = 1;
const WALL_DIRECTIONS = new Set<Direction>(['up', 'down', 'left', 'right']);

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

function distanceFromRect(clientX: number, clientY: number, rect: DOMRect): number {
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

/**
 * Expanded wall hit areas overlap on the compact editor board. Resolve a pointer
 * against the visible wall slots instead of trusting whichever pseudo-element
 * happens to be on top in DOM paint order.
 */
export function findNearestWallPointerTarget(
  container: HTMLElement,
  clientX: number,
  clientY: number,
  attributeName: 'data-wall-segment' | 'data-challenge-wall'
): WallPointerTarget | null {
  let closest: WallPointerTarget | null = null;
  let closestDistance = Number.POSITIVE_INFINITY;
  let secondClosestDistance = Number.POSITIVE_INFINITY;

  for (const element of container.querySelectorAll<HTMLElement>(`[${attributeName}]`)) {
    const target = parseWallTarget(element.getAttribute(attributeName));
    if (!target) continue;

    const distance = distanceFromRect(clientX, clientY, element.getBoundingClientRect());
    if (distance < closestDistance) {
      secondClosestDistance = closestDistance;
      closestDistance = distance;
      closest = target;
    } else if (distance < secondClosestDistance) {
      secondClosestDistance = distance;
    }
  }

  if (!closest || closestDistance > WALL_POINTER_SLOP_PX) return null;

  // The exact crossing between two wall slots has no unambiguous orientation.
  // Ignoring that tiny tie area is safer than installing a different wall.
  if (secondClosestDistance - closestDistance < WALL_POINTER_TIE_PX) return null;

  return closest;
}
