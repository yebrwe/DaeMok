export interface ArenaTargetPoint {
  id: string;
  x: number;
  y: number;
  hp: number;
  deadAt: number | null;
}

export interface ArenaPendingImpact {
  executeAt: number;
}

export interface ArenaImpactCancellation<T extends ArenaPendingImpact> {
  retained: T[];
  canceledCount: number;
}

export type ArenaEnemyUnitId = 'slime'
  | 'boar'
  | 'bandit'
  | 'sentinel'
  | 'drake'
  | 'demon'
  | 'wolf'
  | 'spider'
  | 'treant'
  | 'gargoyle'
  | 'golem';

export const ARENA_UNIT_FOR_ENEMY: Readonly<Record<string, ArenaEnemyUnitId>> = {
  field_slime: 'slime',
  field_boar: 'boar',
  field_bandit: 'bandit',
  field_boss: 'boar',
  forest_wolf: 'wolf',
  forest_spider: 'spider',
  forest_treant: 'treant',
  forest_boss: 'treant',
  ruins_sentinel: 'sentinel',
  ruins_gargoyle: 'gargoyle',
  ruins_mage: 'demon',
  ruins_boss: 'sentinel',
  crater_drake: 'drake',
  crater_golem: 'golem',
  crater_cultist: 'demon',
  crater_boss: 'drake',
};

const MELEE_REACH_BY_WEAPON: Readonly<Record<string, number>> = {
  field_vanguard_weapon: 108,
  forest_vanguard_weapon: 128,
  ruins_vanguard_weapon: 116,
  crater_vanguard_weapon: 134,
};

export function getMeleeWeaponReach(itemKey?: string | null): number {
  const definitionId = itemKey?.split(':', 1)[0] ?? '';
  return MELEE_REACH_BY_WEAPON[definitionId] ?? 92;
}

export function isFuturePendingImpact(impactAt: number | null, now: number): impactAt is number {
  return impactAt !== null && impactAt > now;
}

export function cancelFuturePendingImpacts<T extends ArenaPendingImpact>(
  pending: readonly T[],
  now: number,
): ArenaImpactCancellation<T> {
  const retained = pending.filter((action) => action.executeAt <= now);
  return {
    retained,
    canceledCount: pending.length - retained.length,
  };
}

export function selectForwardMeleeTarget<T extends ArenaTargetPoint>(
  targets: readonly T[],
  origin: { x: number; y: number },
  direction: { x: number; y: number },
  reach: number,
  targetRadius: number,
): T | null {
  const directionLength = Math.hypot(direction.x, direction.y);
  if (directionLength < 0.001 || reach <= 0) return null;
  const directionX = direction.x / directionLength;
  const directionY = direction.y / directionLength;
  let selected: T | null = null;
  let selectedDistance = Number.POSITIVE_INFINITY;

  for (const target of targets) {
    if (target.deadAt !== null || target.hp <= 0) continue;
    const offsetX = target.x - origin.x;
    const offsetY = target.y - origin.y;
    const distance = Math.hypot(offsetX, offsetY);
    if (distance > reach + targetRadius || distance >= selectedDistance) continue;
    const facingDot = distance < 0.001
      ? 1
      : (offsetX / distance) * directionX + (offsetY / distance) * directionY;
    if (facingDot < 0.42) continue;
    selected = target;
    selectedDistance = distance;
  }

  return selected;
}
