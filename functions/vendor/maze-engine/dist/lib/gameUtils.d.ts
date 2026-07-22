import { CollisionWall, Direction, GameMap, ItemType, LegacyWormholeChallenge, MazeSkillId, MapItem, Obstacle, Player, Position, RunnerGear, SpecialWallType, WallItemType, WormholeChallenge } from '../types/game';
export declare const BOARD_SIZE = 6;
export declare const CARDINAL_DIRECTIONS: Direction[];
export declare const GAME_RULES_VERSION = 5;
export declare const MAZE_SKILL_IDS: MazeSkillId[];
export declare const DEFAULT_MAZE_SKILL: MazeSkillId;
export declare function isMazeSkillId(value: unknown): value is MazeSkillId;
export declare const MAX_OBSTACLES = 25;
export declare const RUNNER_GEAR_WALL_BUDGET = 15;
export declare const RUNNER_GEARS: readonly RunnerGear[];
export declare const DEFAULT_RUNNER_GEAR: RunnerGear;
export declare function isRunnerGear(value: unknown): value is RunnerGear;
export declare function getMapRunnerGear(map: Pick<GameMap, 'runnerGear'> | null | undefined): RunnerGear;
export declare function getMapWallBudget(runnerGear: RunnerGear): number;
export declare function getMapWallBudget(map: Pick<GameMap, 'runnerGear'> | null | undefined): number;
export declare const WORMHOLE_CHALLENGE_SEAL_COUNT = 3;
export declare const WORMHOLE_CHALLENGE_MIN_WALLS = 4;
export declare const WORMHOLE_CHALLENGE_MAX_WALLS = 12;
export declare const WORMHOLE_CHALLENGE_MIN_STEPS = 12;
export declare const WORMHOLE_CHALLENGE_MAX_STEPS = 28;
export declare const SPECIAL_WALL_TYPES: SpecialWallType[];
export declare const WALL_ITEM_TYPES: WallItemType[];
export declare const RETIRED_NEW_MAP_ITEM_TYPES: readonly ItemType[];
export declare function isRetiredNewMapItemType(value: unknown): value is ItemType;
export declare const ITEM_COSTS: Record<ItemType, number>;
export declare const ITEM_LIMITS: Record<ItemType, number>;
export declare const ITEM_LABELS: Record<ItemType, string>;
export declare function isWallItemType(type: ItemType): type is WallItemType;
export declare function isTurnEligible(player: Player | null | undefined): boolean;
export declare function getTurnOrder(players: Record<string, Player>, preferredOrder?: string[] | null): string[];
export declare function getFirstTurnPlayerId(players: Record<string, Player>, preferredOrder?: string[] | null): string | null;
export declare function getNextTurnPlayerId(players: Record<string, Player>, currentPlayerId: string | null | undefined, preferredOrder?: string[] | null): string | null;
export declare function isSameWallSegment(posA: Position, dirA: Direction, posB: Position, dirB: Direction): boolean;
export declare function getMapItems(map: {
    items?: MapItem[] | null;
    item?: MapItem | null;
} | null | undefined): MapItem[];
export declare function cloneWormholeChallenge(challenge: WormholeChallenge): WormholeChallenge;
export declare function cloneMapItem(item: MapItem): MapItem;
export declare function cloneGameMap(map: GameMap): GameMap;
/**
 * V5 still carries one skill field on the wire. New clients always write the
 * inert compatibility value so a stale draft cannot re-enable a retired
 * loadout. Retired items are deliberately preserved here and rejected by the
 * new-map validator instead of being removed without the author noticing.
 */
export declare function normalizeNewMapForSubmission(map: GameMap): GameMap;
export declare function getVisibleCollisionWalls(collisionWalls: readonly CollisionWall[], map: GameMap, consumed: Readonly<Record<number, boolean>>): CollisionWall[];
export declare function getWormholeExitOpenDirections(map: GameMap, exit: Position): Direction[];
export declare function getWormholeExitSafetyError(map: GameMap, exit: Position): string | null;
export declare function isWormholeExitSafe(map: GameMap, exit: Position | null | undefined): boolean;
/**
 * New-map-only reachability rule for wormhole exits. Only ordinary walls in
 * `map.obstacles` participate: item walls are intentionally ignored because
 * every wall available to new map authors is transient and can disappear.
 */
export declare function getWormholeExitGoalPathError(map: GameMap | null | undefined): string | null;
export declare function areWormholeExitsReachableFromGoal(map: GameMap | null | undefined): boolean;
export declare function isPositionInBoard(position: Position | null | undefined): position is Position;
export declare function isSamePosition(pos1: Position, pos2: Position): boolean;
export declare function getNewPosition(position: Position, direction: Direction): Position;
export declare function canMove(currentPosition: Position, direction: Direction, obstacles: Obstacle[]): boolean;
export declare function getOppositeDirection(direction: Direction): Direction;
export declare function findShortestPath(start: Position, end: Position, obstacles: Obstacle[]): Position[] | null;
export declare function getWormholeChallengeCompletionSteps(challenge: LegacyWormholeChallenge): number | null;
export declare function getWormholeChallengeError(value: unknown): string | null;
export declare function isValidWormholeChallenge(value: unknown): value is WormholeChallenge;
export declare function countUniqueMapWalls(obstacles: Obstacle[]): number;
export declare function getMapBudgetUsed(map: Pick<GameMap, 'obstacles' | 'items' | 'item'>): number;
export declare function isValidMap(map: GameMap, expectedRulesVersion?: number): boolean;
/**
 * Strict boundary for newly saved maps. `isValidMap` remains intentionally
 * backward-compatible so already persisted legacy maps can still be read
 * while an older match drains.
 */
export declare function isValidNewMap(map: GameMap, expectedRulesVersion?: number): boolean;
