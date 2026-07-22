import { Direction, GameMap, GameState, MazeSkillId, Obstacle, PoisonEffect, Position, SpecialWallType, FireVisionEffect } from '../types/game';
export type TurnMoveEffect = 'move' | 'bump' | 'mine' | 'wormhole' | 'smoke';
export type TurnAction = {
    type: 'move';
    direction: Direction;
} | {
    type: 'radar';
    itemIndex?: number;
} | {
    type: 'skill';
    skillId: MazeSkillId;
    direction?: Direction;
};
export interface MoveTurnOutcome {
    type: 'move';
    direction: Direction;
    origin: Position;
    attempted: Position;
    position: Position;
    moves: number;
    effect: TurnMoveEffect;
    consumedItemIndex: number | null;
    wallEffect?: SpecialWallType;
    wallItemIndex?: number;
    skillEffect?: MazeSkillId;
    itemPosition?: Position;
    wormholeExit?: Position;
    realm?: 'main' | 'wormhole';
    wormholeTransition?: 'entered' | 'seal' | 'returned';
    illusionTransition?: 'activated' | 'phased' | 'returned' | 'expired';
    illusionReturnPosition?: Position;
    illusionReturnFromWormhole?: true;
    requestedDirection?: Direction;
    poisonMisdirected?: boolean;
    identifiedFakeWall?: true;
    reachedGoal: boolean;
    message: string;
}
export interface RadarTurnOutcome {
    type: 'radar';
    itemIndex: number;
    found: Obstacle[];
    position: Position;
    moves: number;
    message: string;
}
export interface SkillTurnOutcome {
    type: 'skill';
    skillId: Exclude<MazeSkillId, 'anchor'>;
    direction?: Direction;
    origin: Position;
    position: Position;
    moves: number;
    found?: Obstacle[];
    via?: Position[];
    landingEffect?: 'mine' | 'wormhole' | 'smoke';
    itemPosition?: Position;
    wormholeExit?: Position;
    reachedGoal: boolean;
    message: string;
}
export type TurnOutcome = MoveTurnOutcome | RadarTurnOutcome | SkillTurnOutcome;
export interface TurnResolution {
    state: GameState;
    outcome: TurnOutcome;
}
export declare function normalizeConsumed(value: unknown): Record<number, boolean>;
export declare function isVisionObscuredForPlayer(state: GameState | null | undefined, playerId: string): boolean;
export declare function getActiveFireVisionEffect(state: GameState | null | undefined, playerId: string): FireVisionEffect | null;
export declare function getActivePoisonEffect(state: GameState | null | undefined, playerId: string): PoisonEffect | null;
export declare function mergeWallSegments(current: Obstacle[], incoming: Obstacle[]): Obstacle[];
export declare function findRadarWalls(position: Position, playedMap: GameMap, consumed: Record<number, boolean>): Obstacle[];
export declare function appendTurnPosition(history: Position[] | undefined, fallback: Position, result: Position): Position[];
export declare function getMineRollbackPosition(history: Position[] | undefined, fallback: Position): Position;
/**
 * Illusion activation and progress are trusted reducer details, not player
 * feedback. Keep those markers available to Authority validation, then pass
 * the result through this boundary before showing or returning it to a player.
 * The wake-up return is deliberately public because the board really rewinds.
 */
export declare function sanitizeHiddenIllusionOutcomeForPresentation(outcome: TurnOutcome, playerDisplayName?: string): TurnOutcome;
export declare function sanitizeHiddenIllusionResolutionForPresentation(resolution: TurnResolution, actorId: string): TurnResolution;
export declare function resolveTurnAction(state: GameState | null | undefined, actorId: string, action: TurnAction, now?: number): TurnResolution | null;
export declare function settleCompletedGameState(state: GameState): GameState;
