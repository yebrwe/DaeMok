// GENERATED FILE. Edit the canonical source under src/ and regenerate.
// Source: src/lib/gameRules.ts

import type { GameMap, ItemType, Obstacle, Room } from '../types/game';
import {
  GAME_RULES_VERSION,
  ITEM_COSTS,
  ITEM_LIMITS,
  MAZE_SKILL_IDS,
  MAX_OBSTACLES,
  RUNNER_GEAR_WALL_BUDGET,
  getMapItems,
  getMapRunnerGear,
  isSameWallSegment,
  isValidMap,
  isValidNewMap,
  normalizeNewMapForSubmission,
} from './gameUtils';
import { MAX_MAZE_SKILL_LOADOUT } from './mazeSkills';

export type GameRuleSnapshot = NonNullable<Room['ruleSnapshot']>;

export interface GameRuleSnapshotValidation {
  valid: boolean;
  issues: string[];
}

const SNAPSHOT_KEYS = [
  'version',
  'wallBudget',
  'runnerGearWallBudget',
  'itemCosts',
  'itemLimits',
  'maxSkillLoadout',
  'skillIds',
] as const;

const CANONICAL_ITEM_TYPES = Object.keys(ITEM_COSTS) as ItemType[];

const CANONICAL_RULE_TEMPLATE: GameRuleSnapshot = {
  version: GAME_RULES_VERSION,
  wallBudget: MAX_OBSTACLES,
  runnerGearWallBudget: RUNNER_GEAR_WALL_BUDGET,
  itemCosts: { ...ITEM_COSTS },
  itemLimits: { ...ITEM_LIMITS },
  maxSkillLoadout: MAX_MAZE_SKILL_LOADOUT,
  skillIds: [...MAZE_SKILL_IDS],
};

Object.freeze(CANONICAL_RULE_TEMPLATE.itemCosts);
Object.freeze(CANONICAL_RULE_TEMPLATE.itemLimits);
Object.freeze(CANONICAL_RULE_TEMPLATE.skillIds);
Object.freeze(CANONICAL_RULE_TEMPLATE);

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasExactKeys(record: Record<string, unknown>, expected: readonly string[]): boolean {
  const keys = Reflect.ownKeys(record);
  return keys.length === expected.length &&
    expected.every((key) => Object.prototype.hasOwnProperty.call(record, key));
}

function validateNumberRecord(
  value: unknown,
  canonical: Record<ItemType, number>,
  label: string,
  issues: string[]
): value is Record<ItemType, number> {
  if (!isPlainRecord(value)) {
    issues.push(`${label}:record`);
    return false;
  }
  if (!hasExactKeys(value, CANONICAL_ITEM_TYPES)) {
    issues.push(`${label}:keys`);
    return false;
  }

  let valid = true;
  for (const itemType of CANONICAL_ITEM_TYPES) {
    if (!Object.is(value[itemType], canonical[itemType])) {
      issues.push(`${label}:${itemType}`);
      valid = false;
    }
  }
  return valid;
}

function validateSkillIds(value: unknown, issues: string[]): boolean {
  if (!Array.isArray(value)) {
    issues.push('skillIds:array');
    return false;
  }
  if (value.length !== CANONICAL_RULE_TEMPLATE.skillIds.length) {
    issues.push('skillIds:length');
    return false;
  }
  const arrayKeys = Reflect.ownKeys(value);
  const expectedArrayKeys = new Set([
    'length',
    ...Array.from({ length: value.length }, (_, index) => String(index)),
  ]);
  if (
    arrayKeys.length !== value.length + 1 ||
    !arrayKeys.every((key) => typeof key === 'string' && expectedArrayKeys.has(key)) ||
    !Array.from({ length: value.length }, (_, index) => index).every((index) =>
      Object.prototype.hasOwnProperty.call(value, index)
    ) ||
    value.some((skillId, index) => skillId !== CANONICAL_RULE_TEMPLATE.skillIds[index])
  ) {
    issues.push('skillIds:order');
    return false;
  }
  if (new Set(value).size !== value.length) {
    issues.push('skillIds:duplicate');
    return false;
  }
  return true;
}

export function createCanonicalGameRuleSnapshot(): GameRuleSnapshot {
  return {
    version: CANONICAL_RULE_TEMPLATE.version,
    wallBudget: CANONICAL_RULE_TEMPLATE.wallBudget,
    runnerGearWallBudget: CANONICAL_RULE_TEMPLATE.runnerGearWallBudget,
    itemCosts: { ...CANONICAL_RULE_TEMPLATE.itemCosts },
    itemLimits: { ...CANONICAL_RULE_TEMPLATE.itemLimits },
    maxSkillLoadout: CANONICAL_RULE_TEMPLATE.maxSkillLoadout,
    skillIds: [...CANONICAL_RULE_TEMPLATE.skillIds],
  };
}

export const createGameRuleSnapshot = createCanonicalGameRuleSnapshot;

export function validateGameRuleSnapshot(value: unknown): GameRuleSnapshotValidation {
  const issues: string[] = [];
  if (!isPlainRecord(value)) return { valid: false, issues: ['snapshot:record'] };
  if (!hasExactKeys(value, SNAPSHOT_KEYS)) issues.push('snapshot:keys');

  if (!Object.is(value.version, CANONICAL_RULE_TEMPLATE.version)) issues.push('version');
  if (!Object.is(value.wallBudget, CANONICAL_RULE_TEMPLATE.wallBudget)) issues.push('wallBudget');
  if (!Object.is(
    value.runnerGearWallBudget,
    CANONICAL_RULE_TEMPLATE.runnerGearWallBudget
  )) issues.push('runnerGearWallBudget');
  if (!Object.is(value.maxSkillLoadout, CANONICAL_RULE_TEMPLATE.maxSkillLoadout)) {
    issues.push('maxSkillLoadout');
  }
  validateNumberRecord(
    value.itemCosts,
    CANONICAL_RULE_TEMPLATE.itemCosts,
    'itemCosts',
    issues
  );
  validateNumberRecord(
    value.itemLimits,
    CANONICAL_RULE_TEMPLATE.itemLimits,
    'itemLimits',
    issues
  );
  validateSkillIds(value.skillIds, issues);

  return { valid: issues.length === 0, issues };
}

export function isValidGameRuleSnapshot(value: unknown): value is GameRuleSnapshot {
  return validateGameRuleSnapshot(value).valid;
}

export function areGameRuleSnapshotsEqual(left: unknown, right: unknown): boolean {
  if (!isValidGameRuleSnapshot(left) || !isValidGameRuleSnapshot(right)) return false;
  if (
    left.version !== right.version ||
    left.wallBudget !== right.wallBudget ||
    left.runnerGearWallBudget !== right.runnerGearWallBudget ||
    left.maxSkillLoadout !== right.maxSkillLoadout ||
    left.skillIds.length !== right.skillIds.length
  ) {
    return false;
  }
  for (let index = 0; index < left.skillIds.length; index += 1) {
    if (left.skillIds[index] !== right.skillIds[index]) return false;
  }
  return CANONICAL_ITEM_TYPES.every(
    (itemType) =>
      left.itemCosts[itemType] === right.itemCosts[itemType] &&
      left.itemLimits[itemType] === right.itemLimits[itemType]
  );
}

export const gameRuleSnapshotsEqual = areGameRuleSnapshotsEqual;

function countUniqueWalls(obstacles: readonly Obstacle[]): number {
  const unique: Obstacle[] = [];
  for (const obstacle of obstacles) {
    if (
      !unique.some((existing) =>
        isSameWallSegment(
          existing.position,
          existing.direction,
          obstacle.position,
          obstacle.direction
        )
      )
    ) {
      unique.push(obstacle);
    }
  }
  return unique.length;
}

export function isValidMapForRuleSnapshot(
  map: GameMap | null | undefined,
  snapshot: unknown
): boolean {
  if (!isValidGameRuleSnapshot(snapshot) || !map || typeof map !== 'object') return false;
  if (map.rulesVersion !== snapshot.version) return false;
  if (typeof map.skillLoadout !== 'string' || !snapshot.skillIds.includes(map.skillLoadout)) {
    return false;
  }
  if (snapshot.maxSkillLoadout !== 1) return false;
  if (!isValidMap(map, snapshot.version)) return false;

  const itemCounts: Partial<Record<ItemType, number>> = {};
  let itemCost = 0;
  for (const item of getMapItems(map)) {
    if (
      !Object.prototype.hasOwnProperty.call(snapshot.itemCosts, item.type) ||
      !Object.prototype.hasOwnProperty.call(snapshot.itemLimits, item.type)
    ) {
      return false;
    }
    itemCounts[item.type] = (itemCounts[item.type] || 0) + 1;
    if (itemCounts[item.type]! > snapshot.itemLimits[item.type]) return false;
    itemCost += snapshot.itemCosts[item.type];
  }

  const wallBudget = getMapRunnerGear(map) === 'none'
    ? snapshot.wallBudget
    : snapshot.runnerGearWallBudget;
  return countUniqueWalls(map.obstacles || []) + itemCost <= wallBudget;
}

/**
 * Validation used only when a map is about to be saved or submitted. The
 * compatibility validator above continues accepting old V3 radar/skill maps
 * for read-only rendering and in-flight legacy matches.
 */
export function isValidNewMapForRuleSnapshot(
  map: GameMap | null | undefined,
  snapshot: unknown
): boolean {
  if (!isValidGameRuleSnapshot(snapshot) || !map) return false;
  return isValidNewMap(map, snapshot.version)
    && isValidMapForRuleSnapshot(map, snapshot);
}

/** Normalizes the retired skill field, then applies the strict write boundary. */
export function normalizeNewMapForRuleSnapshot(
  map: GameMap | null | undefined,
  snapshot: unknown
): GameMap | null {
  if (!map || !isValidMapForRuleSnapshot(map, snapshot)) return null;
  const normalized = normalizeNewMapForSubmission(map);
  return isValidNewMapForRuleSnapshot(normalized, snapshot) ? normalized : null;
}
