import type { DiceFace, DiceOrientationId, DiceWormholeChallenge, Direction, Position } from '../types/game';
export declare const DICE_WORMHOLE_BOARD_SIZE: 4;
export declare const DICE_WORMHOLE_MIN_BLOCKED_CELLS: 2;
export declare const DICE_WORMHOLE_MAX_BLOCKED_CELLS: 4;
export declare const DICE_WORMHOLE_MIN_STEPS: 9;
export declare const DICE_WORMHOLE_MAX_STEPS: 12;
export declare const DICE_WORMHOLE_COMPAT_MIN_BLOCKED_CELLS: 1;
export declare const DICE_WORMHOLE_COMPAT_MAX_BLOCKED_CELLS: 4;
export declare const DICE_ORIENTATION_COUNT: 24;
export declare const DICE_WORMHOLE_DIRECTIONS: readonly Direction[];
export interface DiceOrientationFaces {
    readonly top: DiceFace;
    readonly bottom: DiceFace;
    readonly north: DiceFace;
    readonly south: DiceFace;
    readonly east: DiceFace;
    readonly west: DiceFace;
}
export interface DiceWormholeProgress {
    position: Position;
    orientation: DiceOrientationId;
    actionsTaken: number;
}
export declare const DICE_ORIENTATIONS: readonly DiceOrientationFaces[];
export declare const DICE_ORIENTATION_TRANSITIONS: readonly Readonly<Record<Direction, number>>[];
export declare function isDiceOrientationId(value: unknown): value is DiceOrientationId;
export declare function getDiceOrientationFaces(orientation: DiceOrientationId): DiceOrientationFaces;
export declare function rollDiceOrientation(orientation: DiceOrientationId, direction: Direction): DiceOrientationId;
export declare function isDiceWormholePosition(value: unknown): value is Position;
export declare function getDiceWormholeShortestPath(challenge: DiceWormholeChallenge, progress?: Pick<DiceWormholeProgress, 'position' | 'orientation'>): Direction[] | null;
export declare function getDiceWormholeShortestSteps(challenge: DiceWormholeChallenge, progress?: Pick<DiceWormholeProgress, 'position' | 'orientation'>): number | null;
export declare function getDiceWormholeChallengeError(value: unknown): string | null;
export declare function isValidDiceWormholeChallenge(value: unknown): value is DiceWormholeChallenge;
export declare function getNewDiceWormholeChallengeError(value: unknown): string | null;
export declare function isValidNewDiceWormholeChallenge(value: unknown): value is DiceWormholeChallenge;
export declare const DICE_WORMHOLE_FALLBACK_CHALLENGE: Readonly<DiceWormholeChallenge>;
export declare function generateDiceWormholeChallenge(seed: number): DiceWormholeChallenge;
