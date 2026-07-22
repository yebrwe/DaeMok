import type { GameMap, Room } from '../types/game';
export type GameRuleSnapshot = NonNullable<Room['ruleSnapshot']>;
export interface GameRuleSnapshotValidation {
    valid: boolean;
    issues: string[];
}
export declare function createCanonicalGameRuleSnapshot(): GameRuleSnapshot;
export declare const createGameRuleSnapshot: typeof createCanonicalGameRuleSnapshot;
export declare function validateGameRuleSnapshot(value: unknown): GameRuleSnapshotValidation;
export declare function isValidGameRuleSnapshot(value: unknown): value is GameRuleSnapshot;
export declare function areGameRuleSnapshotsEqual(left: unknown, right: unknown): boolean;
export declare const gameRuleSnapshotsEqual: typeof areGameRuleSnapshotsEqual;
export declare function isValidMapForRuleSnapshot(map: GameMap | null | undefined, snapshot: unknown): boolean;
/**
 * Validation used only when a map is about to be saved or submitted. The
 * compatibility validator above continues accepting old V3 radar/skill maps
 * for read-only rendering and in-flight legacy matches.
 */
export declare function isValidNewMapForRuleSnapshot(map: GameMap | null | undefined, snapshot: unknown): boolean;
/** Normalizes the retired skill field, then applies the strict write boundary. */
export declare function normalizeNewMapForRuleSnapshot(map: GameMap | null | undefined, snapshot: unknown): GameMap | null;
