export type CellType = 'empty' | 'start' | 'end' | 'player';
export type Direction = 'up' | 'down' | 'left' | 'right';
export interface UserProfile {
    uid: string;
    displayName: string | null;
    email?: string | null;
    photoURL: string | null;
    isOnline?: boolean;
    lastSeen?: unknown;
}
export interface Position {
    row: number;
    col: number;
}
export interface Obstacle {
    position: Position;
    direction: Direction;
}
export declare enum GamePhase {
    SETUP = "setup",// 맵 제작 단계
    PLAY = "play",// 게임 플레이 단계
    END = "end"
}
export interface Player {
    id: string;
    position: Position;
    isReady: boolean;
    displayName?: string | null;
    hasLeft?: boolean;
    lastPosition?: Position;
    isOnline?: boolean;
    lastSeen?: unknown;
    photoURL?: string | null;
    finished?: boolean;
    finishMoves?: number;
    forfeited?: boolean;
    moves?: number;
    positionHistory?: Position[];
}
export type SpecialWallType = 'steelWall' | 'fireWall' | 'fogWall' | 'illusionWall' | 'poisonWall' | 'iceWall' | 'windWall' | 'collapseWall' | 'phaseWall' | 'mirrorWall' | 'thornWall' | 'crystalWall';
export type WallItemType = 'oneTimeWall' | SpecialWallType;
export type ItemType = WallItemType | 'mine' | 'wormhole' | 'radar' | 'smoke';
export type MazeSkillId = 'scoutPulse' | 'breach' | 'anchor' | 'dash';
export type RunnerGear = 'none' | 'wormholeEscapeKit' | 'insight';
export interface LegacyWormholeChallenge {
    version: 1;
    startPosition: Position;
    endPosition: Position;
    seals: Position[];
    obstacles: Obstacle[];
}
export type DiceFace = 1 | 2 | 3 | 4 | 5 | 6;
export type DiceOrientationId = number;
export interface DiceWormholeChallenge {
    version: 2;
    boardSize: 4;
    startPosition: Position;
    endPosition: Position;
    blockedCells: Position[];
    initialOrientation: DiceOrientationId;
    targetTop: DiceFace;
}
export type WormholeChallenge = LegacyWormholeChallenge | DiceWormholeChallenge;
export interface MazeSkillStateData {
    version: 1;
    loadout: MazeSkillId[];
    consumed: Partial<Record<MazeSkillId, boolean>>;
}
export interface MapItem {
    type: ItemType;
    wallPosition?: Position;
    wallDirection?: Direction;
    effectDirection?: Direction;
    position?: Position;
    entrance?: Position;
    exit?: Position;
    challenge?: WormholeChallenge;
}
export interface GameMap {
    rulesVersion?: number;
    startPosition: Position;
    endPosition: Position;
    obstacles: Obstacle[];
    items?: MapItem[] | null;
    item?: MapItem | null;
    skillLoadout?: MazeSkillId | null;
    runnerGear?: RunnerGear;
}
export interface CollisionWall {
    playerId: string;
    position: Position;
    direction: Direction;
    timestamp: number;
    mapOwnerId: string;
    identifiedAsFake?: true;
}
export interface ItemStateEntry {
    consumed?: Record<number, boolean> | boolean;
    activeWalls?: Record<number, boolean>;
    phaseOpen?: Record<number, boolean>;
    durability?: Record<number, number> | number;
    mazeSkill?: MazeSkillStateData;
    type?: ItemType;
    consumedAt?: unknown;
}
export interface SmokeVisionEffect {
    type: 'smoke';
    sourcePlayerId: string;
    appliedAtTurn: number;
    expiresAtTargetMove: number;
}
export interface FireVisionEffect {
    type: 'fire';
    sourcePlayerId: string;
    appliedAtTurn: number;
    expiresAtTargetMove: number;
    phantomWalls?: Obstacle[];
}
export type VisionEffect = SmokeVisionEffect | FireVisionEffect;
export interface PoisonEffect {
    sourcePlayerId: string;
    appliedAtTurn: number;
    expiresAtTargetMove: number;
    seed: number;
}
export interface IllusionEffect {
    sourcePlayerId: string;
    appliedAtTurn: number;
    actionsRemaining: number;
    firstWallOrigin?: Position;
}
interface WormholeRunStateBase {
    mapOwnerId: string;
    itemIndex: number;
    position: Position;
    enteredAtTurn: number;
}
export interface LegacyWormholeRunState extends WormholeRunStateBase {
    challenge: LegacyWormholeChallenge;
    activatedSeals?: Record<number, boolean>;
    discoveredWalls?: Obstacle[];
}
export interface DiceWormholeRunState extends WormholeRunStateBase {
    challenge: DiceWormholeChallenge;
    orientation: DiceOrientationId;
    actionsTaken: number;
}
export type WormholeRunState = LegacyWormholeRunState | DiceWormholeRunState;
export interface GameRuleSnapshot {
    version: number;
    wallBudget: number;
    runnerGearWallBudget: number;
    itemCosts: Record<ItemType, number>;
    itemLimits: Record<ItemType, number>;
    maxSkillLoadout: number;
    skillIds: MazeSkillId[];
}
export interface GameState {
    rulesVersion?: number;
    matchNumber?: number;
    phase: GamePhase;
    players: Record<string, Player>;
    maps?: Record<string, GameMap>;
    assignments?: Record<string, string>;
    currentTurn?: string | null;
    turnOrder?: string[];
    turnNumber?: number;
    winner?: string | null;
    draw?: boolean | null;
    collisionWalls?: Record<string, CollisionWall> | CollisionWall[];
    itemState?: Record<string, ItemStateEntry>;
    revealedWallsByPlayer?: Record<string, Obstacle[]>;
    visionEffectsByPlayer?: Record<string, VisionEffect> | null;
    poisonEffectsByPlayer?: Record<string, PoisonEffect> | null;
    illusionEffectsByPlayer?: Record<string, IllusionEffect> | null;
    wormholeRunsByPlayer?: Record<string, WormholeRunState>;
    turnMessage?: string;
    turnMessageTimestamp?: unknown;
}
export interface Room {
    id: string;
    name: string;
    players?: string[];
    gameState: GameState | null;
    maps?: Record<string, GameMap>;
    maxPlayers: number;
    rulesVersion?: number;
    ruleSnapshot?: GameRuleSnapshot;
    createdAt?: number | null;
    createdBy?: string;
    ownerPresenceReady?: boolean;
    ownerDisconnectedAt?: number;
    status?: 'waiting' | 'playing' | 'ended';
    lastActivity?: number | null;
}
export {};
