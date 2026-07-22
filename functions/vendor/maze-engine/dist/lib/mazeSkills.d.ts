export declare const DEFAULT_MAZE_BOARD_SIZE = 6;
export declare const MAX_MAZE_SKILL_LOADOUT = 1;
export declare const RANKED_MAZE_SKILL_LOADOUT = 1;
export declare const MAZE_SKILL_IDS: readonly ["scoutPulse", "breach", "anchor", "dash"];
export type MazeSkillId = (typeof MAZE_SKILL_IDS)[number];
export type MazeDirection = 'up' | 'down' | 'left' | 'right';
export interface MazePosition {
    row: number;
    col: number;
}
export type MazeSpecialWallKind = 'fireWall' | 'poisonWall' | 'iceWall' | 'windWall' | 'collapseWall' | 'phaseWall' | 'mirrorWall' | 'thornWall' | 'crystalWall';
export type MazeWallKind = 'normalWall' | 'fakeWall' | 'steelWall' | MazeSpecialWallKind;
export interface MazeWall {
    id: string;
    position: MazePosition;
    direction: MazeDirection;
    kind: MazeWallKind;
    active?: boolean;
    consumed?: boolean;
}
export type MazeConsumedWallIds = ReadonlySet<string> | Readonly<Record<string, boolean>>;
export interface MazeBoardSnapshot {
    boardSize?: number;
    goal: MazePosition;
    walls: readonly MazeWall[];
    consumedWallIds?: MazeConsumedWallIds;
}
export type ForcedMovementSource = 'mine' | 'wormhole' | 'ice' | 'wind' | 'mirror' | 'thorn';
export interface MazeSkillBalanceMeta {
    useLimit: 1;
    turnCost: 0 | 1;
    failureConsumesUse: false;
    rankedLoadoutCost: 1;
    targetNetTurnValue: readonly [number, number];
    safetyRule: string;
}
export interface MazeSkillDefinition {
    id: MazeSkillId;
    label: string;
    description: string;
    activation: 'active' | 'passive';
    targeting: 'none' | 'direction' | 'forcedMovement';
    balance: MazeSkillBalanceMeta;
}
export declare const MAZE_SKILL_DEFINITIONS: Readonly<Record<MazeSkillId, MazeSkillDefinition>>;
export interface MazeSkillState {
    version: 1;
    loadout: MazeSkillId[];
    consumed: Partial<Record<MazeSkillId, boolean>>;
}
export type MazeSkillFailureReason = 'notEquipped' | 'alreadyConsumed' | 'invalidOrigin' | 'invalidDirection' | 'outOfBounds' | 'noWall' | 'multipleWalls' | 'steelWall' | 'blockedSegment' | 'unsafeGoalPath' | 'unsupportedForcedMovement' | 'invalidEntry';
export interface MazeSkillFailure {
    ok: false;
    skillId: MazeSkillId;
    reason: MazeSkillFailureReason;
    turnsSpent: 0;
    state: MazeSkillState;
}
export interface MazeSkillConsumptionResult {
    ok: boolean;
    reason?: 'notEquipped' | 'alreadyConsumed';
    state: MazeSkillState;
}
export interface MazeWallReveal {
    segmentKey: string;
    position: MazePosition;
    direction: 'right' | 'down';
    apparentKind: 'wall';
    sourceWallIds: string[];
}
export interface ScoutPulseSuccess {
    ok: true;
    skillId: 'scoutPulse';
    turnsSpent: 1;
    state: MazeSkillState;
    reveals: MazeWallReveal[];
}
export interface BreachSuccess {
    ok: true;
    skillId: 'breach';
    turnsSpent: 1;
    state: MazeSkillState;
    origin: MazePosition;
    position: MazePosition;
    direction: MazeDirection;
    wallKind: MazeWallKind;
    bypassedWallIds: string[];
}
export interface AnchorSuccess {
    ok: true;
    skillId: 'anchor';
    turnsSpent: 0;
    state: MazeSkillState;
    position: MazePosition;
    negatedSource: ForcedMovementSource;
    discardedDestination?: MazePosition;
    consumeSourceEffect: true;
}
export interface DashSuccess {
    ok: true;
    skillId: 'dash';
    turnsSpent: 1;
    state: MazeSkillState;
    origin: MazePosition;
    position: MazePosition;
    direction: MazeDirection;
    via: MazePosition[];
}
export type ScoutPulseResolution = ScoutPulseSuccess | MazeSkillFailure;
export type BreachResolution = BreachSuccess | MazeSkillFailure;
export type AnchorResolution = AnchorSuccess | MazeSkillFailure;
export type DashResolution = DashSuccess | MazeSkillFailure;
export interface ScoutPulseInput {
    position: MazePosition;
    board: MazeBoardSnapshot;
}
export interface BreachInput {
    position: MazePosition;
    direction: MazeDirection;
    board: MazeBoardSnapshot;
}
export interface AnchorInput {
    from: MazePosition;
    entered: MazePosition;
    forcedDestination?: MazePosition;
    source: ForcedMovementSource;
    boardSize?: number;
}
export interface DashInput {
    position: MazePosition;
    direction: MazeDirection;
    board: MazeBoardSnapshot;
    stopAtFirst?: boolean;
}
export interface MazePathOptions {
    boardSize?: number;
    consumedWallIds?: MazeConsumedWallIds;
    ignoredWallIds?: ReadonlySet<string>;
}
export declare function isMazeSkillId(value: unknown): value is MazeSkillId;
export declare function isMazeDirection(value: unknown): value is MazeDirection;
export declare function normalizeMazeBoardSize(value: unknown): number;
export declare function isMazePosition(value: unknown, boardSize?: number): value is MazePosition;
export declare function isSameMazePosition(a: MazePosition, b: MazePosition): boolean;
export declare function moveMazePosition(position: MazePosition, direction: MazeDirection): MazePosition;
export declare function mazeWallSegmentKey(position: MazePosition, direction: MazeDirection, boardSize?: number): string | null;
export declare function isMazeWallActive(wall: MazeWall, consumedWallIds?: MazeConsumedWallIds, ignoredWallIds?: ReadonlySet<string>): boolean;
export declare function getBlockingMazeWalls(board: MazeBoardSnapshot, position: MazePosition, direction: MazeDirection): MazeWall[];
export declare function findSafeMazePath(start: MazePosition, goal: MazePosition, walls: readonly MazeWall[], options?: MazePathOptions): MazePosition[] | null;
export declare function hasSafeMazeGoalPath(start: MazePosition, board: MazeBoardSnapshot): boolean;
export declare function normalizeMazeSkillLoadout(value: unknown): MazeSkillId[];
export declare function normalizeMazeSkillState(value: unknown): MazeSkillState;
export declare function createMazeSkillState(loadout: unknown): MazeSkillState;
export declare function consumeMazeSkill(value: unknown, skillId: MazeSkillId): MazeSkillConsumptionResult;
export declare function getScoutPulseReveals(input: ScoutPulseInput): MazeWallReveal[];
export declare function resolveScoutPulse(value: unknown, input: ScoutPulseInput): ScoutPulseResolution;
export declare function resolveBreach(value: unknown, input: BreachInput): BreachResolution;
export declare function resolveAnchor(value: unknown, input: AnchorInput): AnchorResolution;
export declare function resolveDash(value: unknown, input: DashInput): DashResolution;
