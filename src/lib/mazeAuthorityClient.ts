'use client';

import { httpsCallable } from 'firebase/functions';
import {
  createCanonicalGameRuleSnapshot,
  isValidGameRuleSnapshot,
  isValidMapForRuleSnapshot,
  isValidNewMapForRuleSnapshot,
  type GameRuleSnapshot,
} from '@/lib/gameRules';
import { firebaseInitPromise } from '@/lib/firebase';
import {
  GAME_RULES_VERSION,
  WORMHOLE_CHALLENGE_MAX_WALLS,
  WORMHOLE_CHALLENGE_SEAL_COUNT,
  isValidWormholeChallenge,
} from '@/lib/gameUtils';
import {
  DICE_WORMHOLE_BOARD_SIZE,
  DICE_WORMHOLE_COMPAT_MAX_BLOCKED_CELLS,
  DICE_WORMHOLE_COMPAT_MIN_BLOCKED_CELLS,
  isDiceOrientationId,
  isValidDiceWormholeChallenge,
} from '@/lib/diceWormhole';
import type { TurnAction, TurnMoveEffect, TurnOutcome } from '@/lib/gameTurn';
import type {
  CollisionWall,
  DiceFace,
  DiceOrientationId,
  DiceWormholeChallenge,
  Direction,
  GameMap,
  GamePhase,
  ItemType,
  MapItem,
  MazeSkillId,
  LegacyWormholeChallenge,
  Obstacle,
  Position,
  RunnerGear,
  SpecialWallType,
  VisionEffect,
  WormholeChallenge,
} from '@/types/game';

export const MAZE_AUTHORITY_FUNCTIONS_REGION = 'asia-southeast1' as const;
export const MAZE_AUTHORITY_VIEW_VERSION = 1 as const;
export const MAZE_AUTHORITY_SCHEMA_VERSION = 1 as const;
export const MAZE_AUTHORITY_RULES_VERSION = GAME_RULES_VERSION;

export const MAZE_AUTHORITY_CALLABLES = Object.freeze({
  command: 'mazeV1Command',
  syncRoom: 'mazeV1SyncRoom',
  claimOfflineTurn: 'mazeV1ClaimOfflineTurn',
});

export const MAZE_AUTHORITY_OFFLINE_TURN_GRACE_MS = 45_000 as const;

export const MAZE_AUTHORITY_PUBLIC_VIEW_ROOT = 'mazeViews/v1/publicRooms' as const;
export const MAZE_AUTHORITY_MEMBER_VIEW_ROOT = 'mazeViews/v1/memberRooms' as const;
export const MAZE_AUTHORITY_RANKING_VIEW_ROOT = 'mazeAuthorityRankings/v1' as const;
export const MAZE_AUTHORITY_RANKING_MIRROR_VERSION = 1 as const;
export const MAZE_AUTHORITY_RANKING_SOURCE = 'mazeRankings-compat-v1' as const;
export const MAZE_AUTHORITY_PRESENCE_ROOM_ROOT = 'mazePresence/v1/rooms' as const;
export const MAZE_AUTHORITY_PRESENCE_STATUS_ROOT = 'mazePresence/v1/status' as const;
export const MAZE_AUTHORITY_PRESENCE_MAX_CONNECTIONS = 8 as const;
export const MAZE_AUTHORITY_PRESENCE_SLOTS = Object.freeze([
  '0', '1', '2', '3', '4', '5', '6', '7',
] as const);

const MAX_SAFE_COUNTER = Number.MAX_SAFE_INTEGER;
const MAX_ROOM_ID_LENGTH = 64;
const MAX_UID_LENGTH = 128;
const MAX_ROOM_NAME_LENGTH = 50;
const MAX_PHOTO_URL_LENGTH = 2_048;
const MAX_RANKING_COUNTER = 1_000_000_000;
const MAX_RANKING_BEST_MOVES = 1_000_000;
const MAX_PRESENCE_SESSION_LENGTH = 80;
const MAX_MAP_OBSTACLES = 64;
const MAX_MAP_ITEMS = 16;
const MAX_VIEW_LIST_LENGTH = 256;
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const OFFLINE_TURN_CLAIM_ID = /^timeout_[a-f0-9]{48}$/u;
const SAFE_ROOM_ID = /^[A-Za-z0-9_-]+$/u;
const INVALID_FIREBASE_KEY = /[.#$\[\]\/\u0000-\u001F\u007F-\u009F]/u;
const RESERVED_RECORD_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const DIRECTIONS: readonly Direction[] = ['up', 'down', 'left', 'right'];
const MAZE_SKILLS: readonly MazeSkillId[] = ['scoutPulse', 'breach', 'anchor', 'dash'];
const NEW_MAP_SKILL_LOADOUT = 'scoutPulse' as const satisfies MazeSkillId;
const RUNNER_GEARS = ['none', 'wormholeEscapeKit', 'insight'] as const satisfies readonly RunnerGear[];
const ACTIVE_MAZE_SKILLS: readonly Exclude<MazeSkillId, 'anchor'>[] = [
  'scoutPulse',
  'breach',
  'dash',
];
const ITEM_TYPES: readonly ItemType[] = [
  'oneTimeWall',
  'mine',
  'wormhole',
  'radar',
  'smoke',
  'steelWall',
  'fireWall',
  'poisonWall',
  'iceWall',
  'windWall',
  'collapseWall',
  'phaseWall',
  'mirrorWall',
  'thornWall',
  'crystalWall',
  'fogWall',
  'illusionWall',
];
const RETIRED_NEW_MAP_ITEM_TYPES = new Set<ItemType>([
  'radar',
  'mine',
  'smoke',
  'steelWall',
  'collapseWall',
  'phaseWall',
  'mirrorWall',
  'crystalWall',
]);
const NEW_MAP_ITEM_TYPES = ITEM_TYPES.filter((itemType) => !RETIRED_NEW_MAP_ITEM_TYPES.has(itemType));
const WALL_ITEM_TYPES = new Set<ItemType>([
  'oneTimeWall',
  'steelWall',
  'fireWall',
  'poisonWall',
  'iceWall',
  'windWall',
  'collapseWall',
  'phaseWall',
  'mirrorWall',
  'thornWall',
  'crystalWall',
  'fogWall',
  'illusionWall',
]);
const SPECIAL_WALL_TYPES = new Set<ItemType>([
  'steelWall',
  'fireWall',
  'poisonWall',
  'iceWall',
  'windWall',
  'collapseWall',
  'phaseWall',
  'mirrorWall',
  'thornWall',
  'crystalWall',
  'fogWall',
  'illusionWall',
]);
const TURN_MOVE_EFFECTS = new Set(['move', 'bump', 'mine', 'wormhole', 'smoke']);

export interface MazeAuthorityCasFence {
  roomId: string;
  expectedGeneration: number;
  expectedRevision: number;
  commandId?: string;
}

interface MazeAuthorityCommandBase {
  commandId: string;
  roomId: string;
  expectedGeneration: number;
  expectedRevision: number;
}

export interface MazeAuthorityCreateRoomCommand extends MazeAuthorityCommandBase {
  type: 'createRoom';
  name: string;
  maxPlayers: number;
}

export interface MazeAuthorityJoinRoomCommand extends MazeAuthorityCommandBase {
  type: 'joinRoom';
}

export interface MazeAuthoritySubmitMapCommand extends MazeAuthorityCommandBase {
  type: 'submitMap';
  map: GameMap;
}

export interface MazeAuthorityResetMapCommand extends MazeAuthorityCommandBase {
  type: 'resetMap';
}

export interface MazeAuthorityStartMatchCommand extends MazeAuthorityCommandBase {
  type: 'startMatch';
}

export interface MazeAuthorityTurnCommand extends MazeAuthorityCommandBase {
  type: 'turn';
  action: TurnAction;
}

export interface MazeAuthorityLeaveRoomCommand extends MazeAuthorityCommandBase {
  type: 'leaveRoom';
}

export interface MazeAuthorityRestartMatchCommand extends MazeAuthorityCommandBase {
  type: 'restartMatch';
}

export interface MazeAuthorityCloseRoomCommand extends MazeAuthorityCommandBase {
  type: 'closeRoom';
}

export type MazeAuthorityCommand =
  | MazeAuthorityCreateRoomCommand
  | MazeAuthorityJoinRoomCommand
  | MazeAuthoritySubmitMapCommand
  | MazeAuthorityResetMapCommand
  | MazeAuthorityStartMatchCommand
  | MazeAuthorityTurnCommand
  | MazeAuthorityLeaveRoomCommand
  | MazeAuthorityRestartMatchCommand
  | MazeAuthorityCloseRoomCommand;

interface MazeAuthorityCommandResultBase {
  type: MazeAuthorityCommand['type'] | 'forfeit';
  roomId: string;
  generation: number;
  revision: number;
}

export interface MazeAuthorityCreateRoomResult extends MazeAuthorityCommandResultBase {
  type: 'createRoom';
}

export interface MazeAuthorityJoinRoomResult extends MazeAuthorityCommandResultBase {
  type: 'joinRoom';
  slot: number;
}

export interface MazeAuthoritySubmitMapResult extends MazeAuthorityCommandResultBase {
  type: 'submitMap';
  ready: true;
}

export interface MazeAuthorityResetMapResult extends MazeAuthorityCommandResultBase {
  type: 'resetMap';
  ready: false;
}

export interface MazeAuthorityStartMatchResult extends MazeAuthorityCommandResultBase {
  type: 'startMatch';
  phase: GamePhase.PLAY;
  currentTurn: string;
  matchNumber: number;
}

export interface MazeAuthorityTurnResult extends MazeAuthorityCommandResultBase {
  type: 'turn';
  phase: GamePhase;
  currentTurn: string | null;
  winner: string | null;
  draw: boolean | null;
  outcome: TurnOutcome;
}

export interface MazeAuthorityForfeitResult extends MazeAuthorityCommandResultBase {
  type: 'forfeit';
  phase: GamePhase;
  currentTurn: string | null;
  winner: string | null;
  draw: boolean | null;
}

export interface MazeAuthorityLeaveRoomResult extends MazeAuthorityCommandResultBase {
  type: 'leaveRoom';
  phase: GamePhase;
  closed: boolean;
  ownerId: string;
  remainingMembers: number;
}

export interface MazeAuthorityRestartMatchResult extends MazeAuthorityCommandResultBase {
  type: 'restartMatch';
  phase: GamePhase.SETUP;
  currentTurn: string;
  matchNumber: number;
}

export interface MazeAuthorityCloseRoomResult extends MazeAuthorityCommandResultBase {
  type: 'closeRoom';
  closed: true;
}

export type MazeAuthorityCommandResult =
  | MazeAuthorityCreateRoomResult
  | MazeAuthorityJoinRoomResult
  | MazeAuthoritySubmitMapResult
  | MazeAuthorityResetMapResult
  | MazeAuthorityStartMatchResult
  | MazeAuthorityTurnResult
  | MazeAuthorityForfeitResult
  | MazeAuthorityLeaveRoomResult
  | MazeAuthorityRestartMatchResult
  | MazeAuthorityCloseRoomResult;

export interface MazeAuthorityCommandResponse {
  ok: true;
  replayed: boolean;
  result: MazeAuthorityCommandResult;
}

export interface MazeAuthoritySyncRoomRequest {
  roomId: string;
}

export interface MazeAuthoritySyncRoomResponse {
  ok: true;
  roomId: string;
  generation: number;
  revision: number;
  convergenceAttempts: number;
}

export interface MazeAuthorityOfflineTurnRequest {
  roomId: string;
  targetUid: string;
  generation: number;
  leaseEpoch: number;
  turnNumber: number;
}

export interface MazeAuthorityOfflineTurnResult {
  type: 'skipOfflineTurn';
  roomId: string;
  generation: number;
  revision: number;
  phase: GamePhase.PLAY;
  skippedPlayerId: string;
  currentTurn: string;
  turnNumber: number;
}

export interface MazeAuthorityOfflineTurnResponse {
  ok: true;
  replayed: boolean;
  claimId: string;
  result: MazeAuthorityOfflineTurnResult;
}

export interface MazeAuthorityLobbyMemberView {
  uid: string;
  slot: number;
}

export interface MazeAuthorityLobbyView {
  name: string;
  ownerId: string;
  maxPlayers: number;
  status: 'waiting' | 'playing' | 'ended';
  members: Record<string, MazeAuthorityLobbyMemberView>;
}

export interface MazeAuthorityPlayerView {
  id: string;
  position?: Position;
  isReady: boolean;
  displayName?: string | null;
  hasLeft?: boolean;
  isOnline?: boolean;
  photoURL?: string | null;
  finished?: boolean;
  finishMoves?: number;
  forfeited?: boolean;
  moves?: number;
}

export interface MazeAuthorityBoardBoundaryView {
  startPosition: Position;
  endPosition: Position;
}

export type MazeAuthorityMapView = MazeAuthorityBoardBoundaryView | GameMap;

/**
 * Authority never sends internal wormhole walls while a match is active.
 * `obstacles` is present only in an END projection.
 */
export interface MazeAuthorityLegacyWormholeChallengeView {
  version: 1;
  startPosition: Position;
  endPosition: Position;
  seals: Position[];
  obstacles?: Obstacle[];
}

export interface MazeAuthorityDiceWormholeChallengeView {
  version: 2;
  boardSize: 4;
  startPosition: Position;
  endPosition: Position;
  blockedCells: Position[];
  initialOrientation: DiceOrientationId;
  targetTop: DiceFace;
}

export type MazeAuthorityWormholeChallengeView =
  | MazeAuthorityLegacyWormholeChallengeView
  | MazeAuthorityDiceWormholeChallengeView;

interface MazeAuthorityWormholeRunViewBase {
  mapOwnerId: string;
  itemIndex: number;
  position: Position;
  enteredAtTurn: number;
}

export interface MazeAuthorityLegacyWormholeRunView extends MazeAuthorityWormholeRunViewBase {
  challenge: MazeAuthorityLegacyWormholeChallengeView;
  activatedSeals?: Record<number, boolean>;
  discoveredWalls?: Obstacle[];
}

export interface MazeAuthorityDiceWormholeRunView extends MazeAuthorityWormholeRunViewBase {
  challenge: MazeAuthorityDiceWormholeChallengeView;
  orientation: DiceOrientationId;
  actionsTaken: number;
}

export type MazeAuthorityWormholeRunView =
  | MazeAuthorityLegacyWormholeRunView
  | MazeAuthorityDiceWormholeRunView;

/** Redacted poison status. The server's direction seed is never part of an Authority view. */
export interface MazeAuthorityPoisonEffectView {
  sourcePlayerId: string;
  appliedAtTurn: number;
  expiresAtTargetMove: number;
}

export interface MazeAuthorityItemStateView {
  consumed?: Record<number, boolean> | boolean;
  activeWalls?: Record<number, boolean>;
  phaseOpen?: Record<number, boolean>;
  durability?: Record<number, number> | number;
  mazeSkill?: {
    version: 1;
    loadout: MazeSkillId[];
    consumed: Partial<Record<MazeSkillId, boolean>>;
  };
  type?: ItemType;
}

export interface MazeAuthorityGameStateView {
  rulesVersion?: number;
  matchNumber?: number;
  phase: GamePhase;
  players: Record<string, MazeAuthorityPlayerView>;
  maps: Record<string, MazeAuthorityMapView>;
  assignments: Record<string, string>;
  currentTurn: string | null;
  turnOrder: string[];
  turnNumber?: number;
  winner: string | null;
  draw: boolean | null;
  collisionWalls: CollisionWall[];
  itemState: Record<string, MazeAuthorityItemStateView>;
  revealedWallsByPlayer: Record<string, Obstacle[]>;
  visionEffectsByPlayer: Record<string, VisionEffect>;
  poisonEffectsByPlayer: Record<string, MazeAuthorityPoisonEffectView>;
  /** Always empty while projected; illusion state is authority-internal. */
  illusionEffectsByPlayer: Record<string, never>;
  wormholeRunsByPlayer: Record<string, MazeAuthorityWormholeRunView>;
  turnMessage?: string;
  turnMessageTimestamp?: number;
}

interface MazeAuthorityViewBase {
  viewVersion: typeof MAZE_AUTHORITY_VIEW_VERSION;
  authoritySchemaVersion: typeof MAZE_AUTHORITY_SCHEMA_VERSION;
  roomId: string;
  generation: number;
  revision: number;
  sourceCreatedAt: number;
  sourceUpdatedAt: number;
  lobby: MazeAuthorityLobbyView;
  ruleSnapshot: GameRuleSnapshot;
  gameState: MazeAuthorityGameStateView;
}

export interface MazeAuthorityPublicView extends MazeAuthorityViewBase {
  audience: 'public';
}

export interface MazeAuthorityMemberView extends MazeAuthorityViewBase {
  audience: 'member';
  viewerUid: string;
}

export interface MazeAuthorityRankingView {
  uid: string;
  displayName: string;
  photoURL?: string;
  wins: number;
  losses: number;
  draws: number;
  played: number;
  rating: number;
  bestMoves: number;
  lastRoomId: string;
  lastMatchNumber: number;
  updatedAt: number;
  source: typeof MAZE_AUTHORITY_RANKING_SOURCE;
  mirrorVersion: typeof MAZE_AUTHORITY_RANKING_MIRROR_VERSION;
  sourceSettlementCount: number;
  lastGeneration: number;
}

export type MazeAuthorityRankingSubscription =
  | { status: 'missing'; entries: [] }
  | { status: 'invalid'; entries: [] }
  | { status: 'ready'; entries: MazeAuthorityRankingView[] };

export type MazeAuthorityPresenceSlot = (typeof MAZE_AUTHORITY_PRESENCE_SLOTS)[number];

export interface MazeAuthorityPresenceConnection {
  uid: string;
  generation: number;
  session: string;
  connectedAt: number;
  lastSeen: number;
}

export interface MazeAuthorityPresenceStatus {
  uid: string;
  roomId: string;
  generation: number;
  epoch: number;
  online: boolean;
  lastSeen: number;
  offlineSince?: number;
  updatedAt: number;
}

export type MazeAuthorityRetryClass = 'none' | 'retry-same-command' | 'refresh-view';

export type MazeAuthorityClientErrorCode =
  | 'unauthenticated'
  | 'invalid-command'
  | 'not-found'
  | 'conflict'
  | 'forbidden'
  | 'precondition'
  | 'exhausted'
  | 'unavailable'
  | 'invalid-response'
  | 'rejected';

export class MazeAuthorityClientError extends Error {
  readonly code: MazeAuthorityClientErrorCode;
  readonly reason: string | null;
  readonly retry: MazeAuthorityRetryClass;

  constructor(
    code: MazeAuthorityClientErrorCode,
    message: string,
    options: { reason?: string | null; retry?: MazeAuthorityRetryClass } = {},
  ) {
    super(message);
    this.name = 'MazeAuthorityClientError';
    this.code = code;
    this.reason = options.reason ?? null;
    this.retry = options.retry ?? 'none';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const keys = Object.keys(value).sort();
  const canonical = [...expected].sort();
  return keys.length === canonical.length
    && keys.every((key, index) => key === canonical[index]);
}

function hasRequiredAllowedKeys(
  value: Record<string, unknown>,
  required: readonly string[],
  allowed: readonly string[],
): boolean {
  const allowedSet = new Set(allowed);
  return required.every((key) => Object.prototype.hasOwnProperty.call(value, key))
    && Object.keys(value).every((key) => allowedSet.has(key));
}

function integerInRange(value: unknown, minimum: number, maximum: number): value is number {
  return typeof value === 'number'
    && Number.isSafeInteger(value)
    && !Object.is(value, -0)
    && value >= minimum
    && value <= maximum;
}

function oneOf<T extends string>(value: unknown, options: readonly T[]): value is T {
  return typeof value === 'string' && (options as readonly string[]).includes(value);
}

function validRoomId(value: unknown): value is string {
  return typeof value === 'string'
    && value.length >= 8
    && value.length <= MAX_ROOM_ID_LENGTH
    && value.trim() === value
    && SAFE_ROOM_ID.test(value)
    && !RESERVED_RECORD_KEYS.has(value);
}

function validUid(value: unknown): value is string {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= MAX_UID_LENGTH
    && value.trim() === value
    && !INVALID_FIREBASE_KEY.test(value)
    && !RESERVED_RECORD_KEYS.has(value);
}

function validRoomName(value: unknown): value is string {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= MAX_ROOM_NAME_LENGTH
    && value.trim() === value
    && !/[\u0000-\u001F\u007F-\u009F]/u.test(value);
}

function validCommandId(value: unknown): value is string {
  return typeof value === 'string' && UUID_V4.test(value);
}

function validMessage(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 1_000;
}

function parsePosition(
  value: unknown,
  minimum = 0,
  maximum = 5,
): Position | null {
  if (!isRecord(value)
    || !hasExactKeys(value, ['row', 'col'])
    || !integerInRange(value.row, minimum, maximum)
    || !integerInRange(value.col, minimum, maximum)) return null;
  return { row: value.row, col: value.col };
}

function parseObstacle(value: unknown): Obstacle | null {
  if (!isRecord(value) || !hasExactKeys(value, ['position', 'direction'])) return null;
  const position = parsePosition(value.position);
  if (!position || !oneOf(value.direction, DIRECTIONS)) return null;
  return { position, direction: value.direction };
}

/** Converts the two shapes emitted by RTDB for a dense list into one dense array. */
function canonicalRtdbList(
  value: unknown,
  maximumLength: number,
  missingIsEmpty = false,
): unknown[] | null {
  if (value == null) return missingIsEmpty ? [] : null;
  if (Array.isArray(value)) {
    if (value.length > maximumLength
      || Object.keys(value).length !== value.length
      || value.some((entry) => entry == null)) return null;
    return [...value];
  }
  if (!isRecord(value)) return null;
  const keys = Object.keys(value);
  if (keys.length > maximumLength) return null;
  if (keys.length === 0) return [];
  if (!keys.every((key) => /^(0|[1-9][0-9]*)$/u.test(key))) return null;
  const indices = keys.map(Number).sort((left, right) => left - right);
  if (indices.some((index, offset) => index !== offset)) return null;
  return indices.map((index) => value[String(index)]);
}

function parseObstacleList(value: unknown, maximum = MAX_MAP_OBSTACLES): Obstacle[] | null {
  const raw = canonicalRtdbList(value, maximum, true);
  if (!raw) return null;
  const parsed: Obstacle[] = [];
  for (const entry of raw) {
    const obstacle = parseObstacle(entry);
    if (!obstacle) return null;
    parsed.push(obstacle);
  }
  return parsed;
}

function parseLegacyWormholeChallenge(value: unknown): LegacyWormholeChallenge | null {
  if (!isRecord(value) || !hasExactKeys(value, [
    'version', 'startPosition', 'endPosition', 'seals', 'obstacles',
  ]) || value.version !== 1) return null;
  const startPosition = parsePosition(value.startPosition);
  const endPosition = parsePosition(value.endPosition);
  const rawSeals = canonicalRtdbList(value.seals, WORMHOLE_CHALLENGE_SEAL_COUNT);
  const obstacles = parseObstacleList(value.obstacles, WORMHOLE_CHALLENGE_MAX_WALLS);
  if (!startPosition || !endPosition || !rawSeals
    || rawSeals.length !== WORMHOLE_CHALLENGE_SEAL_COUNT || !obstacles) return null;
  const seals = rawSeals.map((entry) => parsePosition(entry));
  if (seals.some((position) => !position)) return null;
  const challenge: LegacyWormholeChallenge = {
    version: 1,
    startPosition,
    endPosition,
    seals: seals as Position[],
    obstacles,
  };
  return isValidWormholeChallenge(challenge) ? challenge : null;
}

function parseDiceWormholeChallenge(value: unknown): DiceWormholeChallenge | null {
  if (!isRecord(value) || !hasExactKeys(value, [
    'version', 'boardSize', 'startPosition', 'endPosition', 'blockedCells',
    'initialOrientation', 'targetTop',
  ]) || value.version !== 2 || value.boardSize !== DICE_WORMHOLE_BOARD_SIZE) return null;
  const startPosition = parsePosition(value.startPosition, 0, DICE_WORMHOLE_BOARD_SIZE - 1);
  const endPosition = parsePosition(value.endPosition, 0, DICE_WORMHOLE_BOARD_SIZE - 1);
  const rawBlockedCells = canonicalRtdbList(
    value.blockedCells,
    DICE_WORMHOLE_COMPAT_MAX_BLOCKED_CELLS,
  );
  if (!startPosition || !endPosition || !rawBlockedCells
    || rawBlockedCells.length < DICE_WORMHOLE_COMPAT_MIN_BLOCKED_CELLS
    || !isDiceOrientationId(value.initialOrientation)
    || !integerInRange(value.targetTop, 1, 6)) return null;
  const blockedCells = rawBlockedCells.map((entry) => (
    parsePosition(entry, 0, DICE_WORMHOLE_BOARD_SIZE - 1)
  ));
  if (blockedCells.some((position) => !position)) return null;
  const challenge: DiceWormholeChallenge = {
    version: 2,
    boardSize: DICE_WORMHOLE_BOARD_SIZE,
    startPosition,
    endPosition,
    blockedCells: blockedCells as Position[],
    initialOrientation: value.initialOrientation,
    targetTop: value.targetTop as DiceFace,
  };
  return isValidDiceWormholeChallenge(challenge) ? challenge : null;
}

function parseWormholeChallenge(
  value: unknown,
  allowLegacy = true,
): WormholeChallenge | null {
  if (!isRecord(value)) return null;
  if (value.version === 2) return parseDiceWormholeChallenge(value);
  return allowLegacy && value.version === 1 ? parseLegacyWormholeChallenge(value) : null;
}

function parseMapItem(value: unknown, allowLegacyCollapseWall = true): MapItem | null {
  const allowedItemTypes = allowLegacyCollapseWall ? ITEM_TYPES : NEW_MAP_ITEM_TYPES;
  if (!isRecord(value) || !oneOf(value.type, allowedItemTypes)) return null;
  const type = value.type;
  if (WALL_ITEM_TYPES.has(type)) {
    const hasEffectDirection = type === 'windWall'
      && Object.prototype.hasOwnProperty.call(value, 'effectDirection');
    if (!hasExactKeys(value, hasEffectDirection
      ? ['type', 'wallPosition', 'wallDirection', 'effectDirection']
      : ['type', 'wallPosition', 'wallDirection'])) return null;
    const wallPosition = parsePosition(value.wallPosition);
    if (!wallPosition || !oneOf(value.wallDirection, DIRECTIONS)) return null;
    if (hasEffectDirection && !oneOf(value.effectDirection, DIRECTIONS)) return null;
    return {
      type,
      wallPosition,
      wallDirection: value.wallDirection,
      ...(hasEffectDirection ? { effectDirection: value.effectDirection as Direction } : {}),
    };
  }
  if (type === 'mine' || type === 'smoke') {
    if (!hasExactKeys(value, ['type', 'position'])) return null;
    const position = parsePosition(value.position);
    return position ? { type, position } : null;
  }
  if (type === 'wormhole') {
    const hasChallenge = Object.prototype.hasOwnProperty.call(value, 'challenge');
    if (!hasExactKeys(value, hasChallenge
      ? ['type', 'entrance', 'exit', 'challenge']
      : ['type', 'entrance', 'exit'])) return null;
    const entrance = parsePosition(value.entrance);
    const exit = parsePosition(value.exit);
    const challenge = hasChallenge
      ? parseWormholeChallenge(value.challenge, allowLegacyCollapseWall)
      : null;
    if (!allowLegacyCollapseWall && (!challenge || challenge.version !== 2)) return null;
    return entrance && exit && (!hasChallenge || challenge)
      ? { type, entrance, exit, ...(challenge ? { challenge } : {}) }
      : null;
  }
  return hasExactKeys(value, ['type']) ? { type: 'radar' } : null;
}

function parseMapItemList(value: unknown, allowLegacyCollapseWall = true): MapItem[] | null {
  const raw = canonicalRtdbList(value, MAX_MAP_ITEMS, true);
  if (!raw) return null;
  const items: MapItem[] = [];
  for (const entry of raw) {
    const item = parseMapItem(entry, allowLegacyCollapseWall);
    if (!item) return null;
    items.push(item);
  }
  return items;
}

function parseSubmittedGameMap(value: unknown): GameMap | null {
  const required = [
    'rulesVersion', 'startPosition', 'endPosition', 'obstacles', 'skillLoadout', 'runnerGear',
  ];
  const allowed = [...required, 'items', 'item'];
  if (!isRecord(value)
    || !hasRequiredAllowedKeys(value, required, allowed)
    || value.rulesVersion !== MAZE_AUTHORITY_RULES_VERSION
    || value.skillLoadout !== NEW_MAP_SKILL_LOADOUT
    || !oneOf(value.runnerGear, RUNNER_GEARS)) return null;
  const startPosition = parsePosition(value.startPosition);
  const endPosition = parsePosition(value.endPosition);
  const obstacles = parseObstacleList(value.obstacles);
  if (!startPosition || !endPosition || !obstacles) return null;
  const map: GameMap = {
    rulesVersion: MAZE_AUTHORITY_RULES_VERSION,
    startPosition,
    endPosition,
    obstacles,
    skillLoadout: value.skillLoadout,
    runnerGear: value.runnerGear,
  };
  if (Object.prototype.hasOwnProperty.call(value, 'items')) {
    if (value.items === null) map.items = null;
    else {
      const items = parseMapItemList(value.items, false);
      if (!items) return null;
      map.items = items;
    }
  }
  if (Object.prototype.hasOwnProperty.call(value, 'item')) {
    if (value.item === null) map.item = null;
    else {
      const item = parseMapItem(value.item, false);
      if (!item) return null;
      map.item = item;
    }
  }
  if (Array.isArray(map.items) && map.item != null) return null;
  return isValidNewMapForRuleSnapshot(map, canonicalRuleSnapshotForMapValidation()) ? map : null;
}

function canonicalRuleSnapshotForMapValidation(): GameRuleSnapshot {
  // The room projection is validated separately. This fixed snapshot prevents a
  // caller from weakening V5 validation while constructing a submit command.
  return createCanonicalGameRuleSnapshot();
}

function parseTurnAction(value: unknown): TurnAction | null {
  if (!isRecord(value) || typeof value.type !== 'string') return null;
  if (value.type === 'move') {
    return hasExactKeys(value, ['type', 'direction']) && oneOf(value.direction, DIRECTIONS)
      ? { type: 'move', direction: value.direction }
      : null;
  }
  // Detector and skill actions are retained only in legacy result/view decoders.
  // New commands may submit movement actions exclusively.
  if (value.type === 'radar' || value.type === 'skill') return null;
  return null;
}

function parseCommandCas(value: Record<string, unknown>, create: boolean) {
  if (!validCommandId(value.commandId)
    || !validRoomId(value.roomId)
    || !integerInRange(value.expectedGeneration, create ? 0 : 1, MAX_SAFE_COUNTER)
    || !integerInRange(value.expectedRevision, 0, MAX_SAFE_COUNTER)
    || (create && (value.expectedGeneration !== 0 || value.expectedRevision !== 0))) return null;
  return {
    commandId: value.commandId,
    roomId: value.roomId,
    expectedGeneration: value.expectedGeneration,
    expectedRevision: value.expectedRevision,
  };
}

export function parseMazeAuthorityCommand(value: unknown): MazeAuthorityCommand | null {
  if (!isRecord(value) || typeof value.type !== 'string') return null;
  if (value.type === 'createRoom') {
    if (!hasExactKeys(value, [
      'type', 'commandId', 'roomId', 'expectedGeneration', 'expectedRevision', 'name', 'maxPlayers',
    ]) || !validRoomName(value.name) || !integerInRange(value.maxPlayers, 2, 4)) return null;
    const cas = parseCommandCas(value, true);
    return cas ? { type: 'createRoom', ...cas, name: value.name, maxPlayers: value.maxPlayers } : null;
  }
  if (value.type === 'joinRoom'
    || value.type === 'resetMap'
    || value.type === 'startMatch'
    || value.type === 'leaveRoom'
    || value.type === 'restartMatch'
    || value.type === 'closeRoom') {
    if (!hasExactKeys(value, [
      'type', 'commandId', 'roomId', 'expectedGeneration', 'expectedRevision',
    ])) return null;
    const cas = parseCommandCas(value, false);
    return cas ? { type: value.type, ...cas } : null;
  }
  if (value.type === 'submitMap') {
    if (!hasExactKeys(value, [
      'type', 'commandId', 'roomId', 'expectedGeneration', 'expectedRevision', 'map',
    ])) return null;
    const cas = parseCommandCas(value, false);
    const map = parseSubmittedGameMap(value.map);
    return cas && map ? { type: 'submitMap', ...cas, map } : null;
  }
  if (value.type === 'turn') {
    if (!hasExactKeys(value, [
      'type', 'commandId', 'roomId', 'expectedGeneration', 'expectedRevision', 'action',
    ])) return null;
    const cas = parseCommandCas(value, false);
    const action = parseTurnAction(value.action);
    return cas && action ? { type: 'turn', ...cas, action } : null;
  }
  return null;
}

function requireCommand<T extends MazeAuthorityCommand>(value: T | null): T {
  if (!value) {
    throw new MazeAuthorityClientError('invalid-command', '미로 Authority 명령이 올바르지 않습니다.');
  }
  return value;
}

export function createMazeAuthorityCommandId(): string {
  const webCrypto = globalThis.crypto;
  if (typeof webCrypto?.randomUUID === 'function') {
    const commandId = webCrypto.randomUUID();
    if (validCommandId(commandId)) return commandId;
  }
  if (typeof webCrypto?.getRandomValues === 'function') {
    const bytes = webCrypto.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
    const commandId = [
      hex.slice(0, 8),
      hex.slice(8, 12),
      hex.slice(12, 16),
      hex.slice(16, 20),
      hex.slice(20),
    ].join('-');
    if (validCommandId(commandId)) return commandId;
  }
  throw new MazeAuthorityClientError(
    'unavailable',
    '안전한 명령 ID를 만들 수 없어 미로 Authority 요청을 시작하지 못했습니다.',
  );
}

function createSecureRandomHex(byteLength: number, label: string): string {
  const webCrypto = globalThis.crypto;
  if (typeof webCrypto?.getRandomValues !== 'function') {
    throw new MazeAuthorityClientError(
      'unavailable',
      `안전한 ${label}를 만들 수 없어 미로 Authority 요청을 시작하지 못했습니다.`,
    );
  }
  const bytes = webCrypto.getRandomValues(new Uint8Array(byteLength));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** Generates an Authority-only room id with 128 cryptographically random bits. */
export function createMazeAuthorityRoomId(): string {
  const roomId = `mz1_${createSecureRandomHex(16, '방 ID')}`;
  if (validRoomId(roomId)) return roomId;
  throw new MazeAuthorityClientError('unavailable', '안전한 미로 Authority 방 ID를 만들 수 없습니다.');
}

/** One browser tab keeps one stable session id for the lifetime of its presence lease. */
export function createMazeAuthorityPresenceSessionId(): string {
  const session = `mps1_${createSecureRandomHex(16, '접속 세션 ID')}`;
  if (session.length <= MAX_PRESENCE_SESSION_LENGTH) return session;
  throw new MazeAuthorityClientError('unavailable', '안전한 미로 접속 세션 ID를 만들 수 없습니다.');
}

function commandIdOrNew(commandId: string | undefined): string {
  return commandId ?? createMazeAuthorityCommandId();
}

export function buildMazeAuthorityCreateRoomCommand(input: {
  roomId: string;
  name: string;
  maxPlayers: number;
  commandId?: string;
}): MazeAuthorityCreateRoomCommand {
  return requireCommand(parseMazeAuthorityCommand({
    type: 'createRoom',
    commandId: commandIdOrNew(input.commandId),
    roomId: input.roomId,
    expectedGeneration: 0,
    expectedRevision: 0,
    name: input.name,
    maxPlayers: input.maxPlayers,
  })) as MazeAuthorityCreateRoomCommand;
}

function fencedCommandInput(input: MazeAuthorityCasFence) {
  return {
    commandId: commandIdOrNew(input.commandId),
    roomId: input.roomId,
    expectedGeneration: input.expectedGeneration,
    expectedRevision: input.expectedRevision,
  };
}

export function buildMazeAuthorityJoinRoomCommand(
  input: MazeAuthorityCasFence,
): MazeAuthorityJoinRoomCommand {
  return requireCommand(parseMazeAuthorityCommand({
    type: 'joinRoom',
    ...fencedCommandInput(input),
  })) as MazeAuthorityJoinRoomCommand;
}

export function buildMazeAuthoritySubmitMapCommand(
  input: MazeAuthorityCasFence & { map: GameMap },
): MazeAuthoritySubmitMapCommand {
  return requireCommand(parseMazeAuthorityCommand({
    type: 'submitMap',
    ...fencedCommandInput(input),
    map: {
      ...input.map,
      // V5 retains this compatibility field, but skills remain retired.
      skillLoadout: NEW_MAP_SKILL_LOADOUT,
      // Old local drafts predate runner gear; no gear is the safe compatible default.
      runnerGear: input.map.runnerGear ?? 'none',
    },
  })) as MazeAuthoritySubmitMapCommand;
}

export function buildMazeAuthorityResetMapCommand(
  input: MazeAuthorityCasFence,
): MazeAuthorityResetMapCommand {
  return requireCommand(parseMazeAuthorityCommand({
    type: 'resetMap',
    ...fencedCommandInput(input),
  })) as MazeAuthorityResetMapCommand;
}

export function buildMazeAuthorityStartMatchCommand(
  input: MazeAuthorityCasFence,
): MazeAuthorityStartMatchCommand {
  return requireCommand(parseMazeAuthorityCommand({
    type: 'startMatch',
    ...fencedCommandInput(input),
  })) as MazeAuthorityStartMatchCommand;
}

export function buildMazeAuthorityTurnCommand(
  input: MazeAuthorityCasFence & { action: TurnAction },
): MazeAuthorityTurnCommand {
  return requireCommand(parseMazeAuthorityCommand({
    type: 'turn',
    ...fencedCommandInput(input),
    action: input.action,
  })) as MazeAuthorityTurnCommand;
}

export function buildMazeAuthorityLeaveRoomCommand(
  input: MazeAuthorityCasFence,
): MazeAuthorityLeaveRoomCommand {
  return requireCommand(parseMazeAuthorityCommand({
    type: 'leaveRoom',
    ...fencedCommandInput(input),
  })) as MazeAuthorityLeaveRoomCommand;
}

export function buildMazeAuthorityRestartMatchCommand(
  input: MazeAuthorityCasFence,
): MazeAuthorityRestartMatchCommand {
  return requireCommand(parseMazeAuthorityCommand({
    type: 'restartMatch',
    ...fencedCommandInput(input),
  })) as MazeAuthorityRestartMatchCommand;
}

export function buildMazeAuthorityCloseRoomCommand(
  input: MazeAuthorityCasFence,
): MazeAuthorityCloseRoomCommand {
  return requireCommand(parseMazeAuthorityCommand({
    type: 'closeRoom',
    ...fencedCommandInput(input),
  })) as MazeAuthorityCloseRoomCommand;
}

export function buildMazeAuthoritySyncRoomRequest(roomId: string): MazeAuthoritySyncRoomRequest {
  const request = { roomId };
  if (!parseMazeAuthoritySyncRoomRequest(request)) {
    throw new MazeAuthorityClientError('invalid-command', '미로 Authority 동기화 대상이 올바르지 않습니다.');
  }
  return request;
}

export function parseMazeAuthoritySyncRoomRequest(value: unknown): MazeAuthoritySyncRoomRequest | null {
  return isRecord(value) && hasExactKeys(value, ['roomId']) && validRoomId(value.roomId)
    ? { roomId: value.roomId }
    : null;
}

export function parseMazeAuthorityOfflineTurnRequest(
  value: unknown,
): MazeAuthorityOfflineTurnRequest | null {
  if (!isRecord(value)
    || !hasExactKeys(value, [
      'roomId', 'targetUid', 'generation', 'leaseEpoch', 'turnNumber',
    ])
    || !validRoomId(value.roomId)
    || !validUid(value.targetUid)
    || !integerInRange(value.generation, 1, MAX_SAFE_COUNTER)
    || !integerInRange(value.leaseEpoch, 1, MAX_SAFE_COUNTER)
    || !integerInRange(value.turnNumber, 1, MAX_SAFE_COUNTER)) return null;
  return {
    roomId: value.roomId,
    targetUid: value.targetUid,
    generation: value.generation,
    leaseEpoch: value.leaseEpoch,
    turnNumber: value.turnNumber,
  };
}

export function buildMazeAuthorityOfflineTurnRequest(
  input: MazeAuthorityOfflineTurnRequest,
): MazeAuthorityOfflineTurnRequest {
  const request = parseMazeAuthorityOfflineTurnRequest(input);
  if (!request) {
    throw new MazeAuthorityClientError(
      'invalid-command',
      '오프라인 턴 요청이 올바르지 않습니다.',
    );
  }
  return request;
}

export function getMazeAuthorityOfflineTurnGraceRemainingMs(input: {
  offlineSince: number;
  serverTimeOffsetMs: number;
  clientNow?: number;
}): number {
  const clientNow = input.clientNow ?? Date.now();
  if (!integerInRange(input.offlineSince, 0, MAX_SAFE_COUNTER)
    || !Number.isFinite(input.serverTimeOffsetMs)
    || !integerInRange(clientNow, 0, MAX_SAFE_COUNTER)) {
    throw new MazeAuthorityClientError(
      'invalid-command',
      '오프라인 턴 대기 시간을 계산할 수 없습니다.',
    );
  }
  const serverNow = clientNow + input.serverTimeOffsetMs;
  if (!Number.isFinite(serverNow)) {
    throw new MazeAuthorityClientError(
      'invalid-command',
      '오프라인 턴 대기 시간을 계산할 수 없습니다.',
    );
  }
  return Math.max(
    0,
    input.offlineSince + MAZE_AUTHORITY_OFFLINE_TURN_GRACE_MS - serverNow,
  );
}

function parseStringList(
  value: unknown,
  maximumLength: number,
  validator: (entry: unknown) => entry is string,
): string[] | null {
  const raw = canonicalRtdbList(value, maximumLength, true);
  if (!raw || !raw.every(validator)) return null;
  return raw as string[];
}

function parseTurnOutcome(value: unknown): TurnOutcome | null {
  if (!isRecord(value) || typeof value.type !== 'string') return null;
  if (value.type === 'move') {
    const required = [
      'type', 'direction', 'origin', 'attempted', 'position', 'moves', 'effect',
      'consumedItemIndex', 'reachedGoal', 'message',
    ];
  const allowed = [
      ...required, 'wallEffect', 'wallItemIndex', 'skillEffect', 'itemPosition', 'wormholeExit',
      'realm', 'wormholeTransition', 'requestedDirection', 'poisonMisdirected',
      'identifiedFakeWall', 'illusionTransition', 'illusionReturnPosition',
      'illusionReturnFromWormhole',
    ];
    const origin = parsePosition(value.origin);
    const attempted = parsePosition(value.attempted, -1, 6);
    const position = parsePosition(value.position);
    if (!hasRequiredAllowedKeys(value, required, allowed)
      || !oneOf(value.direction, DIRECTIONS)
      || !origin || !attempted || !position
      || !integerInRange(value.moves, 1, MAX_SAFE_COUNTER)
      || typeof value.effect !== 'string' || !TURN_MOVE_EFFECTS.has(value.effect)
      || (value.consumedItemIndex !== null
        && !integerInRange(value.consumedItemIndex, 0, MAX_MAP_ITEMS - 1))
      || typeof value.reachedGoal !== 'boolean'
      || !validMessage(value.message)
      || (Object.prototype.hasOwnProperty.call(value, 'wallEffect')
        && (!oneOf(value.wallEffect, ITEM_TYPES) || !SPECIAL_WALL_TYPES.has(value.wallEffect)))
      || (Object.prototype.hasOwnProperty.call(value, 'wallItemIndex')
        && !integerInRange(value.wallItemIndex, 0, MAX_MAP_ITEMS - 1))
      || (Object.prototype.hasOwnProperty.call(value, 'skillEffect')
        && !oneOf(value.skillEffect, MAZE_SKILLS))
      || (Object.prototype.hasOwnProperty.call(value, 'realm')
        && !oneOf(value.realm, ['main', 'wormhole'] as const))
      || (Object.prototype.hasOwnProperty.call(value, 'wormholeTransition')
        && !oneOf(value.wormholeTransition, ['entered', 'seal', 'returned'] as const))
      || (Object.prototype.hasOwnProperty.call(value, 'illusionTransition')
        && value.illusionTransition !== 'returned')
      || (Object.prototype.hasOwnProperty.call(value, 'illusionReturnFromWormhole')
        && (value.illusionReturnFromWormhole !== true
          || value.illusionTransition !== 'returned'))
      || (Object.prototype.hasOwnProperty.call(value, 'identifiedFakeWall')
        && (value.identifiedFakeWall !== true || value.effect !== 'bump'))
      || (Object.prototype.hasOwnProperty.call(value, 'requestedDirection')
        !== Object.prototype.hasOwnProperty.call(value, 'poisonMisdirected'))
      || (Object.prototype.hasOwnProperty.call(value, 'requestedDirection')
        && (!oneOf(value.requestedDirection, DIRECTIONS)
          || value.requestedDirection === value.direction
          || value.poisonMisdirected !== true))) return null;
    const itemPosition = Object.prototype.hasOwnProperty.call(value, 'itemPosition')
      ? parsePosition(value.itemPosition)
      : undefined;
    const wormholeExit = Object.prototype.hasOwnProperty.call(value, 'wormholeExit')
      ? parsePosition(value.wormholeExit)
      : undefined;
    const illusionReturnPosition = Object.prototype.hasOwnProperty.call(value, 'illusionReturnPosition')
      ? parsePosition(value.illusionReturnPosition)
      : undefined;
    if ((Object.prototype.hasOwnProperty.call(value, 'itemPosition') && !itemPosition)
      || (Object.prototype.hasOwnProperty.call(value, 'wormholeExit') && !wormholeExit)
      || (Object.prototype.hasOwnProperty.call(value, 'illusionReturnPosition')
        && !illusionReturnPosition)
      || ((value.illusionTransition === 'returned') !== !!illusionReturnPosition)
      || (illusionReturnPosition
        && (value.realm !== 'main'
          || value.reachedGoal
          || Object.prototype.hasOwnProperty.call(value, 'wormholeTransition')
          || Object.prototype.hasOwnProperty.call(value, 'wormholeExit')
          || illusionReturnPosition.row !== position.row
          || illusionReturnPosition.col !== position.col))) return null;
    return {
      type: 'move',
      direction: value.direction,
      origin,
      attempted,
      position,
      moves: value.moves,
      effect: value.effect as TurnMoveEffect,
      consumedItemIndex: value.consumedItemIndex,
      ...(Object.prototype.hasOwnProperty.call(value, 'wallEffect')
        ? { wallEffect: value.wallEffect as SpecialWallType }
        : {}),
      ...(Object.prototype.hasOwnProperty.call(value, 'wallItemIndex')
        ? { wallItemIndex: value.wallItemIndex as number }
        : {}),
      ...(Object.prototype.hasOwnProperty.call(value, 'skillEffect')
        ? { skillEffect: value.skillEffect as MazeSkillId }
        : {}),
      ...(itemPosition ? { itemPosition } : {}),
      ...(wormholeExit ? { wormholeExit } : {}),
      ...(Object.prototype.hasOwnProperty.call(value, 'realm')
        ? { realm: value.realm as 'main' | 'wormhole' }
        : {}),
      ...(Object.prototype.hasOwnProperty.call(value, 'wormholeTransition')
        ? { wormholeTransition: value.wormholeTransition as 'entered' | 'seal' | 'returned' }
        : {}),
      ...(Object.prototype.hasOwnProperty.call(value, 'illusionTransition')
        ? {
            illusionTransition: value.illusionTransition as
              'returned',
          }
        : {}),
      ...(illusionReturnPosition ? { illusionReturnPosition } : {}),
      ...(value.illusionReturnFromWormhole === true
        ? { illusionReturnFromWormhole: true as const }
        : {}),
      ...(Object.prototype.hasOwnProperty.call(value, 'requestedDirection')
        ? {
            requestedDirection: value.requestedDirection as Direction,
            poisonMisdirected: true,
          }
        : {}),
      ...(value.identifiedFakeWall === true ? { identifiedFakeWall: true } : {}),
      reachedGoal: value.reachedGoal,
      message: value.message,
    } as TurnOutcome;
  }
  if (value.type === 'radar') {
    if (!hasExactKeys(value, ['type', 'itemIndex', 'found', 'position', 'moves', 'message'])
      || !integerInRange(value.itemIndex, 0, MAX_MAP_ITEMS - 1)
      || !integerInRange(value.moves, 1, MAX_SAFE_COUNTER)
      || !validMessage(value.message)) return null;
    const found = parseObstacleList(value.found, MAX_VIEW_LIST_LENGTH);
    const position = parsePosition(value.position);
    return found && position ? {
      type: 'radar',
      itemIndex: value.itemIndex,
      found,
      position,
      moves: value.moves,
      message: value.message,
    } : null;
  }
  if (value.type === 'skill') {
    const required = ['type', 'skillId', 'origin', 'position', 'moves', 'reachedGoal', 'message'];
    const allowed = [
      ...required, 'direction', 'found', 'via', 'landingEffect', 'itemPosition', 'wormholeExit',
    ];
    const origin = parsePosition(value.origin);
    const position = parsePosition(value.position);
    if (!hasRequiredAllowedKeys(value, required, allowed)
      || !oneOf(value.skillId, ACTIVE_MAZE_SKILLS)
      || !origin || !position
      || !integerInRange(value.moves, 1, MAX_SAFE_COUNTER)
      || typeof value.reachedGoal !== 'boolean'
      || !validMessage(value.message)
      || (Object.prototype.hasOwnProperty.call(value, 'direction')
        && !oneOf(value.direction, DIRECTIONS))
      || ((value.skillId === 'breach' || value.skillId === 'dash')
        !== Object.prototype.hasOwnProperty.call(value, 'direction'))
      || (Object.prototype.hasOwnProperty.call(value, 'landingEffect')
        && !['mine', 'wormhole', 'smoke'].includes(String(value.landingEffect)))) return null;
    const found = Object.prototype.hasOwnProperty.call(value, 'found')
      ? parseObstacleList(value.found, MAX_VIEW_LIST_LENGTH)
      : undefined;
    const rawVia = Object.prototype.hasOwnProperty.call(value, 'via')
      ? canonicalRtdbList(value.via, 8, true)
      : undefined;
    const via = rawVia?.map((entry) => parsePosition(entry));
    const itemPosition = Object.prototype.hasOwnProperty.call(value, 'itemPosition')
      ? parsePosition(value.itemPosition)
      : undefined;
    const wormholeExit = Object.prototype.hasOwnProperty.call(value, 'wormholeExit')
      ? parsePosition(value.wormholeExit)
      : undefined;
    if ((Object.prototype.hasOwnProperty.call(value, 'found') && !found)
      || (Object.prototype.hasOwnProperty.call(value, 'via')
        && (!rawVia || !via || via.some((entry) => !entry)))
      || (Object.prototype.hasOwnProperty.call(value, 'itemPosition') && !itemPosition)
      || (Object.prototype.hasOwnProperty.call(value, 'wormholeExit') && !wormholeExit)) return null;
    return {
      type: 'skill',
      skillId: value.skillId,
      ...(Object.prototype.hasOwnProperty.call(value, 'direction')
        ? { direction: value.direction as Direction }
        : {}),
      origin,
      position,
      moves: value.moves,
      ...(found ? { found } : {}),
      ...(via ? { via: via as Position[] } : {}),
      ...(Object.prototype.hasOwnProperty.call(value, 'landingEffect')
        ? { landingEffect: value.landingEffect as 'mine' | 'wormhole' | 'smoke' }
        : {}),
      ...(itemPosition ? { itemPosition } : {}),
      ...(wormholeExit ? { wormholeExit } : {}),
      reachedGoal: value.reachedGoal,
      message: value.message,
    };
  }
  return null;
}

function parseNullableUid(value: unknown): string | null | undefined {
  if (value === null) return null;
  return validUid(value) ? value : undefined;
}

function parseCommandResult(value: unknown): MazeAuthorityCommandResult | null {
  if (!isRecord(value) || typeof value.type !== 'string') return null;
  const baseValid = validRoomId(value.roomId)
    && integerInRange(value.generation, 1, MAX_SAFE_COUNTER)
    && integerInRange(value.revision, 1, MAX_SAFE_COUNTER);
  if (!baseValid) return null;
  const base = {
    roomId: value.roomId as string,
    generation: value.generation as number,
    revision: value.revision as number,
  };
  if (value.type === 'createRoom') {
    return hasExactKeys(value, ['type', 'roomId', 'generation', 'revision'])
      ? { type: 'createRoom', ...base }
      : null;
  }
  if (value.type === 'resetMap') {
    return hasExactKeys(value, ['type', 'roomId', 'generation', 'revision', 'ready'])
      && value.ready === false
      ? { type: 'resetMap', ...base, ready: false }
      : null;
  }
  if (value.type === 'joinRoom') {
    return hasExactKeys(value, ['type', 'roomId', 'generation', 'revision', 'slot'])
      && integerInRange(value.slot, 0, 3)
      ? { type: 'joinRoom', ...base, slot: value.slot }
      : null;
  }
  if (value.type === 'submitMap') {
    return hasExactKeys(value, ['type', 'roomId', 'generation', 'revision', 'ready'])
      && value.ready === true
      ? { type: 'submitMap', ...base, ready: true }
      : null;
  }
  if (value.type === 'startMatch') {
    return hasExactKeys(value, [
      'type', 'roomId', 'generation', 'revision', 'phase', 'currentTurn', 'matchNumber',
    ])
      && value.phase === 'play'
      && validUid(value.currentTurn)
      && integerInRange(value.matchNumber, 1, MAX_SAFE_COUNTER)
      ? {
        type: 'startMatch',
        ...base,
        phase: value.phase as GamePhase.PLAY,
        currentTurn: value.currentTurn,
        matchNumber: value.matchNumber,
      }
      : null;
  }
  if (value.type === 'turn') {
    if (!hasExactKeys(value, [
      'type', 'roomId', 'generation', 'revision', 'phase', 'currentTurn',
      'winner', 'draw', 'outcome',
    ]) || !oneOf(value.phase, ['setup', 'play', 'end'] as const)) return null;
    const currentTurn = parseNullableUid(value.currentTurn);
    const winner = parseNullableUid(value.winner);
    const outcome = parseTurnOutcome(value.outcome);
    if (currentTurn === undefined || winner === undefined || !outcome
      || (value.draw !== null && typeof value.draw !== 'boolean')) return null;
    return {
      type: 'turn',
      ...base,
      phase: value.phase as GamePhase,
      currentTurn,
      winner,
      draw: value.draw as boolean | null,
      outcome,
    };
  }
  if (value.type === 'forfeit') {
    if (!hasExactKeys(value, [
      'type', 'roomId', 'generation', 'revision', 'phase', 'currentTurn', 'winner', 'draw',
    ]) || !oneOf(value.phase, ['setup', 'play', 'end'] as const)) return null;
    const currentTurn = parseNullableUid(value.currentTurn);
    const winner = parseNullableUid(value.winner);
    if (currentTurn === undefined || winner === undefined
      || (value.draw !== null && typeof value.draw !== 'boolean')) return null;
    return {
      type: 'forfeit',
      ...base,
      phase: value.phase as GamePhase,
      currentTurn,
      winner,
      draw: value.draw as boolean | null,
    };
  }
  if (value.type === 'leaveRoom') {
    if (!hasExactKeys(value, [
      'type', 'roomId', 'generation', 'revision', 'phase', 'closed', 'ownerId',
      'remainingMembers',
    ])
      || !oneOf(value.phase, ['setup', 'play', 'end'] as const)
      || typeof value.closed !== 'boolean'
      || !validUid(value.ownerId)
      || !integerInRange(value.remainingMembers, 0, 4)
      || (value.closed && (value.phase !== 'setup' || value.remainingMembers !== 0))) return null;
    return {
      type: 'leaveRoom',
      ...base,
      phase: value.phase as GamePhase,
      closed: value.closed,
      ownerId: value.ownerId,
      remainingMembers: value.remainingMembers,
    };
  }
  if (value.type === 'restartMatch') {
    return hasExactKeys(value, [
      'type', 'roomId', 'generation', 'revision', 'phase', 'currentTurn', 'matchNumber',
    ])
      && value.phase === 'setup'
      && validUid(value.currentTurn)
      && integerInRange(value.matchNumber, 0, MAX_SAFE_COUNTER)
      ? {
        type: 'restartMatch',
        ...base,
        phase: value.phase as GamePhase.SETUP,
        currentTurn: value.currentTurn,
        matchNumber: value.matchNumber,
      }
      : null;
  }
  if (value.type === 'closeRoom') {
    return hasExactKeys(value, ['type', 'roomId', 'generation', 'revision', 'closed'])
      && value.closed === true
      ? { type: 'closeRoom', ...base, closed: true }
      : null;
  }
  return null;
}

export function decodeMazeAuthorityCommandResponse(
  value: unknown,
  expectedCommand?: MazeAuthorityCommand,
): MazeAuthorityCommandResponse | null {
  if (!isRecord(value)
    || !hasExactKeys(value, ['ok', 'replayed', 'result'])
    || value.ok !== true
    || typeof value.replayed !== 'boolean') return null;
  const result = parseCommandResult(value.result);
  if (!result) return null;
  const expectedGeneration = expectedCommand?.type === 'createRoom'
    ? 1
    : expectedCommand?.type === 'restartMatch'
      ? expectedCommand.expectedGeneration + 1
      : expectedCommand?.expectedGeneration;
  const expectedRevision = expectedCommand?.type === 'restartMatch'
    ? 1
    : expectedCommand === undefined
      ? undefined
      : expectedCommand.expectedRevision + 1;
  if (expectedCommand && (
    result.type !== expectedCommand.type
    || result.roomId !== expectedCommand.roomId
    || result.generation !== expectedGeneration
    || result.revision !== expectedRevision
  )) return null;
  return { ok: true, replayed: value.replayed, result };
}

export function decodeMazeAuthorityOfflineTurnResponse(
  value: unknown,
  expectedRequest?: MazeAuthorityOfflineTurnRequest,
): MazeAuthorityOfflineTurnResponse | null {
  if (!isRecord(value)
    || !hasExactKeys(value, ['ok', 'replayed', 'claimId', 'result'])
    || value.ok !== true
    || typeof value.replayed !== 'boolean'
    || typeof value.claimId !== 'string'
    || !OFFLINE_TURN_CLAIM_ID.test(value.claimId)
    || !isRecord(value.result)
    || !hasExactKeys(value.result, [
      'type', 'roomId', 'generation', 'revision', 'phase', 'skippedPlayerId',
      'currentTurn', 'turnNumber',
    ])
    || value.result.type !== 'skipOfflineTurn'
    || !validRoomId(value.result.roomId)
    || !integerInRange(value.result.generation, 1, MAX_SAFE_COUNTER)
    || !integerInRange(value.result.revision, 1, MAX_SAFE_COUNTER)
    || value.result.phase !== 'play'
    || !validUid(value.result.skippedPlayerId)
    || !validUid(value.result.currentTurn)
    || value.result.currentTurn === value.result.skippedPlayerId
    || !integerInRange(value.result.turnNumber, 2, MAX_SAFE_COUNTER)) return null;

  if (expectedRequest && (
    value.result.roomId !== expectedRequest.roomId
    || value.result.generation !== expectedRequest.generation
    || value.result.skippedPlayerId !== expectedRequest.targetUid
    || value.result.turnNumber !== expectedRequest.turnNumber + 1
  )) return null;

  return {
    ok: true,
    replayed: value.replayed,
    claimId: value.claimId,
    result: {
      type: 'skipOfflineTurn',
      roomId: value.result.roomId,
      generation: value.result.generation,
      revision: value.result.revision,
      phase: value.result.phase as GamePhase.PLAY,
      skippedPlayerId: value.result.skippedPlayerId,
      currentTurn: value.result.currentTurn,
      turnNumber: value.result.turnNumber,
    },
  };
}

export function decodeMazeAuthoritySyncRoomResponse(
  value: unknown,
  expectedRoomId?: string,
): MazeAuthoritySyncRoomResponse | null {
  if (!isRecord(value)
    || !hasExactKeys(value, [
      'ok', 'roomId', 'generation', 'revision', 'convergenceAttempts',
    ])
    || value.ok !== true
    || !validRoomId(value.roomId)
    || (expectedRoomId !== undefined && value.roomId !== expectedRoomId)
    || !integerInRange(value.generation, 1, MAX_SAFE_COUNTER)
    || !integerInRange(value.revision, 1, MAX_SAFE_COUNTER)
    || !integerInRange(value.convergenceAttempts, 1, 4)) return null;
  return {
    ok: true,
    roomId: value.roomId,
    generation: value.generation,
    revision: value.revision,
    convergenceAttempts: value.convergenceAttempts,
  };
}

function parseLobby(value: unknown): MazeAuthorityLobbyView | null {
  if (!isRecord(value)
    || !hasRequiredAllowedKeys(value, ['name', 'ownerId', 'maxPlayers', 'status'], [
      'name', 'ownerId', 'maxPlayers', 'status', 'members',
    ])
    || !validRoomName(value.name)
    || !validUid(value.ownerId)
    || !integerInRange(value.maxPlayers, 2, 4)
    || !oneOf(value.status, ['waiting', 'playing', 'ended'] as const)) return null;
  const rawMembers = value.members ?? {};
  if (!isRecord(rawMembers)) return null;
  const members: Record<string, MazeAuthorityLobbyMemberView> = {};
  const slots = new Set<number>();
  for (const [uid, rawMember] of Object.entries(rawMembers)) {
    if (!validUid(uid)
      || !isRecord(rawMember)
      || !hasExactKeys(rawMember, ['uid', 'slot'])
      || rawMember.uid !== uid
      || !integerInRange(rawMember.slot, 0, value.maxPlayers - 1)
      || slots.has(rawMember.slot)) return null;
    slots.add(rawMember.slot);
    members[uid] = { uid, slot: rawMember.slot };
  }
  const memberCount = Object.keys(members).length;
  if (memberCount > value.maxPlayers
    || (value.status !== 'ended' && memberCount < 1)
    || (memberCount > 0 && !Object.prototype.hasOwnProperty.call(members, value.ownerId))) return null;
  return {
    name: value.name,
    ownerId: value.ownerId,
    maxPlayers: value.maxPlayers,
    status: value.status,
    members,
  };
}

function parseRuleSnapshot(value: unknown): GameRuleSnapshot | null {
  if (!isRecord(value)) return null;
  const rawSkillIds = canonicalRtdbList(value.skillIds, MAZE_SKILLS.length);
  if (!rawSkillIds) return null;
  const candidate = { ...value, skillIds: rawSkillIds };
  return isValidGameRuleSnapshot(candidate) ? candidate : null;
}

function parsePlayerView(value: unknown, uid: string, phase: GamePhase): MazeAuthorityPlayerView | null {
  const required = ['id', 'isReady'];
  const allowed = [
    ...required, 'position', 'displayName', 'hasLeft', 'isOnline', 'photoURL',
    'finished', 'finishMoves', 'forfeited', 'moves',
  ];
  if (!isRecord(value)
    || !hasRequiredAllowedKeys(value, required, allowed)
    || value.id !== uid
    || typeof value.isReady !== 'boolean') return null;
  const hasPosition = Object.prototype.hasOwnProperty.call(value, 'position');
  const position = hasPosition ? parsePosition(value.position) : undefined;
  if ((phase === ('setup' as GamePhase)) === hasPosition || (hasPosition && !position)) return null;
  if (Object.prototype.hasOwnProperty.call(value, 'displayName')
    && value.displayName !== null && typeof value.displayName !== 'string') return null;
  if (Object.prototype.hasOwnProperty.call(value, 'photoURL')
    && value.photoURL !== null && typeof value.photoURL !== 'string') return null;
  for (const booleanKey of ['hasLeft', 'isOnline', 'finished', 'forfeited'] as const) {
    if (Object.prototype.hasOwnProperty.call(value, booleanKey)
      && typeof value[booleanKey] !== 'boolean') return null;
  }
  for (const numberKey of ['finishMoves', 'moves'] as const) {
    if (Object.prototype.hasOwnProperty.call(value, numberKey)
      && !integerInRange(value[numberKey], 0, MAX_SAFE_COUNTER)) return null;
  }
  return {
    id: uid,
    isReady: value.isReady,
    ...(position ? { position } : {}),
    ...(Object.prototype.hasOwnProperty.call(value, 'displayName')
      ? { displayName: value.displayName as string | null }
      : {}),
    ...(Object.prototype.hasOwnProperty.call(value, 'hasLeft')
      ? { hasLeft: value.hasLeft as boolean }
      : {}),
    ...(Object.prototype.hasOwnProperty.call(value, 'isOnline')
      ? { isOnline: value.isOnline as boolean }
      : {}),
    ...(Object.prototype.hasOwnProperty.call(value, 'photoURL')
      ? { photoURL: value.photoURL as string | null }
      : {}),
    ...(Object.prototype.hasOwnProperty.call(value, 'finished')
      ? { finished: value.finished as boolean }
      : {}),
    ...(Object.prototype.hasOwnProperty.call(value, 'finishMoves')
      ? { finishMoves: value.finishMoves as number }
      : {}),
    ...(Object.prototype.hasOwnProperty.call(value, 'forfeited')
      ? { forfeited: value.forfeited as boolean }
      : {}),
    ...(Object.prototype.hasOwnProperty.call(value, 'moves')
      ? { moves: value.moves as number }
      : {}),
  };
}

function parseBoundaryMap(value: unknown): MazeAuthorityBoardBoundaryView | null {
  if (!isRecord(value) || !hasExactKeys(value, ['startPosition', 'endPosition'])) return null;
  const startPosition = parsePosition(value.startPosition);
  const endPosition = parsePosition(value.endPosition);
  return startPosition && endPosition ? { startPosition, endPosition } : null;
}

function parseProjectedFullMap(value: unknown, ruleSnapshot: GameRuleSnapshot): GameMap | null {
  const required = ['startPosition', 'endPosition', 'runnerGear'];
  const allowed = [
    ...required, 'rulesVersion', 'obstacles', 'items', 'item', 'skillLoadout',
  ];
  if (!isRecord(value)
    || !hasRequiredAllowedKeys(value, required, allowed)
    || value.rulesVersion !== MAZE_AUTHORITY_RULES_VERSION
    || !oneOf(value.skillLoadout, MAZE_SKILLS)
    || !oneOf(value.runnerGear, RUNNER_GEARS)) return null;
  const startPosition = parsePosition(value.startPosition);
  const endPosition = parsePosition(value.endPosition);
  const obstacles = parseObstacleList(value.obstacles);
  const hasItems = Object.prototype.hasOwnProperty.call(value, 'items');
  const hasLegacyItem = Object.prototype.hasOwnProperty.call(value, 'item');
  const items = hasItems ? parseMapItemList(value.items) : [];
  if (!startPosition || !endPosition || !obstacles || !items) return null;
  const map: GameMap = {
    rulesVersion: MAZE_AUTHORITY_RULES_VERSION,
    startPosition,
    endPosition,
    obstacles,
    skillLoadout: value.skillLoadout,
    runnerGear: value.runnerGear,
  };
  if (hasItems || !hasLegacyItem) map.items = items;
  if (hasLegacyItem) {
    if (value.item === null) map.item = null;
    else {
      const item = parseMapItem(value.item);
      if (!item) return null;
      map.item = item;
    }
  }
  if (map.item != null && Array.isArray(map.items) && map.items.length > 0) return null;
  return isValidMapForRuleSnapshot(map, ruleSnapshot) ? map : null;
}

function parseBooleanIndexRecord(
  value: unknown,
  maximumLength = MAX_MAP_ITEMS,
): Record<number, boolean> | null {
  if (!isRecord(value) && !Array.isArray(value)) return null;
  if (Array.isArray(value) && value.length > maximumLength) return null;
  const result: Record<number, boolean> = {};
  for (const [rawIndex, rawValue] of Object.entries(value)) {
    if (Array.isArray(value) && rawValue == null) continue;
    const index = Number(rawIndex);
    if (!/^(0|[1-9][0-9]*)$/u.test(rawIndex)
      || !integerInRange(index, 0, maximumLength - 1)
      || typeof rawValue !== 'boolean') return null;
    result[index] = rawValue;
  }
  return result;
}

function parseNumberIndexRecord(value: unknown): Record<number, number> | null {
  if (!isRecord(value)) return null;
  const result: Record<number, number> = {};
  for (const [rawIndex, rawValue] of Object.entries(value)) {
    const index = Number(rawIndex);
    if (!/^(0|[1-9][0-9]*)$/u.test(rawIndex)
      || !integerInRange(index, 0, MAX_MAP_ITEMS - 1)
      || typeof rawValue !== 'number' || !Number.isFinite(rawValue)) return null;
    result[index] = rawValue;
  }
  return result;
}

function parseItemStateView(value: unknown): MazeAuthorityItemStateView | null {
  const allowed = ['consumed', 'activeWalls', 'phaseOpen', 'durability', 'mazeSkill', 'type'];
  if (!isRecord(value) || !Object.keys(value).every((key) => allowed.includes(key))) return null;
  const result: MazeAuthorityItemStateView = {};
  if (Object.prototype.hasOwnProperty.call(value, 'consumed')) {
    if (typeof value.consumed === 'boolean') result.consumed = value.consumed;
    else {
      const consumed = parseBooleanIndexRecord(value.consumed);
      if (!consumed) return null;
      result.consumed = consumed;
    }
  }
  for (const key of ['activeWalls', 'phaseOpen'] as const) {
    if (!Object.prototype.hasOwnProperty.call(value, key)) continue;
    const parsed = parseBooleanIndexRecord(value[key]);
    if (!parsed) return null;
    result[key] = parsed;
  }
  if (Object.prototype.hasOwnProperty.call(value, 'durability')) {
    if (typeof value.durability === 'number' && Number.isFinite(value.durability)) {
      result.durability = value.durability;
    } else {
      const durability = parseNumberIndexRecord(value.durability);
      if (!durability) return null;
      result.durability = durability;
    }
  }
  if (Object.prototype.hasOwnProperty.call(value, 'mazeSkill')) {
    if (!isRecord(value.mazeSkill)
      || !hasRequiredAllowedKeys(value.mazeSkill, ['version', 'loadout'], [
        'version', 'loadout', 'consumed',
      ])
      || value.mazeSkill.version !== 1) return null;
    const loadout = parseStringList(value.mazeSkill.loadout, 1, (entry): entry is string => (
      oneOf(entry, MAZE_SKILLS)
    ));
    const consumed = Object.prototype.hasOwnProperty.call(value.mazeSkill, 'consumed')
      ? value.mazeSkill.consumed
      : {};
    if (!loadout || !isRecord(consumed)
      || Object.entries(consumed).some(([skillId, flag]) => (
        !oneOf(skillId, MAZE_SKILLS) || typeof flag !== 'boolean'
      ))) return null;
    result.mazeSkill = {
      version: 1,
      loadout: loadout as MazeSkillId[],
      consumed: { ...consumed } as Partial<Record<MazeSkillId, boolean>>,
    };
  }
  if (Object.prototype.hasOwnProperty.call(value, 'type')) {
    if (!oneOf(value.type, ITEM_TYPES)) return null;
    result.type = value.type;
  }
  return result;
}

function parseCollisionWall(value: unknown, memberIds: ReadonlySet<string>): CollisionWall | null {
  const identifiedAsFake = isRecord(value) && value.identifiedAsFake === true;
  if (!isRecord(value)
    || !hasExactKeys(value, identifiedAsFake
      ? ['playerId', 'position', 'direction', 'timestamp', 'mapOwnerId', 'identifiedAsFake']
      : ['playerId', 'position', 'direction', 'timestamp', 'mapOwnerId'])
    || !validUid(value.playerId) || !memberIds.has(value.playerId)
    || !validUid(value.mapOwnerId) || !memberIds.has(value.mapOwnerId)
    || !oneOf(value.direction, DIRECTIONS)
    || !integerInRange(value.timestamp, 0, MAX_SAFE_COUNTER)) return null;
  const position = parsePosition(value.position);
  return position ? {
    playerId: value.playerId,
    position,
    direction: value.direction,
    timestamp: value.timestamp,
    mapOwnerId: value.mapOwnerId,
    ...(identifiedAsFake ? { identifiedAsFake: true } : {}),
  } : null;
}

function parseVisionEffect(value: unknown, memberIds: ReadonlySet<string>): VisionEffect | null {
  if (!isRecord(value)
    || !validUid(value.sourcePlayerId) || !memberIds.has(value.sourcePlayerId)
    || !integerInRange(value.appliedAtTurn, 0, MAX_SAFE_COUNTER)
    || !integerInRange(value.expiresAtTargetMove, 0, MAX_SAFE_COUNTER)) return null;
  if (value.type === 'smoke') {
    if (!hasExactKeys(value, ['type', 'sourcePlayerId', 'appliedAtTurn', 'expiresAtTargetMove'])) {
      return null;
    }
    return {
      type: 'smoke',
      sourcePlayerId: value.sourcePlayerId,
      appliedAtTurn: value.appliedAtTurn,
      expiresAtTargetMove: value.expiresAtTargetMove,
    };
  }
  if (value.type === 'fire') {
    const commonKeys = ['type', 'sourcePlayerId', 'appliedAtTurn', 'expiresAtTargetMove'];
    const hasLegacyPhantomWalls = Object.prototype.hasOwnProperty.call(value, 'phantomWalls');
    if (!hasExactKeys(value, hasLegacyPhantomWalls
      ? [...commonKeys, 'phantomWalls']
      : commonKeys)) return null;
    const phantomWalls = hasLegacyPhantomWalls
      ? parseObstacleList(value.phantomWalls, 6)
      : null;
    if (hasLegacyPhantomWalls && (!phantomWalls || phantomWalls.length !== 6)) return null;
    return {
      type: 'fire',
      sourcePlayerId: value.sourcePlayerId,
      appliedAtTurn: value.appliedAtTurn,
      expiresAtTargetMove: value.expiresAtTargetMove,
      ...(phantomWalls ? { phantomWalls } : {}),
    };
  }
  return null;
}

function parsePoisonEffect(
  value: unknown,
  memberIds: ReadonlySet<string>,
): MazeAuthorityPoisonEffectView | null {
  if (!isRecord(value)
    || !hasExactKeys(value, [
      'sourcePlayerId', 'appliedAtTurn', 'expiresAtTargetMove',
    ])
    || !validUid(value.sourcePlayerId) || !memberIds.has(value.sourcePlayerId)
    || !integerInRange(value.appliedAtTurn, 0, MAX_SAFE_COUNTER)
    || !integerInRange(value.expiresAtTargetMove, 0, MAX_SAFE_COUNTER)) return null;
  return {
    sourcePlayerId: value.sourcePlayerId,
    appliedAtTurn: value.appliedAtTurn,
    expiresAtTargetMove: value.expiresAtTargetMove,
  };
}

function parseProjectedWormholeChallenge(
  value: unknown,
  revealObstacles: boolean,
): MazeAuthorityWormholeChallengeView | null {
  if (!isRecord(value)) return null;
  if (value.version === 2) return parseDiceWormholeChallenge(value);
  const baseKeys = ['version', 'startPosition', 'endPosition', 'seals'];
  const exactKeys = revealObstacles ? [...baseKeys, 'obstacles'] : baseKeys;
  if (!hasExactKeys(value, exactKeys)
    || value.version !== 1) return null;
  const startPosition = parsePosition(value.startPosition);
  const endPosition = parsePosition(value.endPosition);
  const rawSeals = canonicalRtdbList(value.seals, WORMHOLE_CHALLENGE_SEAL_COUNT);
  if (!startPosition || !endPosition || !rawSeals
    || rawSeals.length !== WORMHOLE_CHALLENGE_SEAL_COUNT) return null;
  const seals = rawSeals.map((entry) => parsePosition(entry));
  if (seals.some((position) => !position)) return null;
  const positions = [startPosition, endPosition, ...(seals as Position[])];
  if (new Set(positions.map(({ row, col }) => `${row},${col}`)).size !== positions.length) {
    return null;
  }
  const challenge: MazeAuthorityLegacyWormholeChallengeView = {
    version: 1,
    startPosition,
    endPosition,
    seals: seals as Position[],
  };
  if (!revealObstacles) return challenge;
  const obstacles = parseObstacleList(value.obstacles, WORMHOLE_CHALLENGE_MAX_WALLS);
  if (!obstacles) return null;
  const fullChallenge: LegacyWormholeChallenge = { ...challenge, obstacles };
  return isValidWormholeChallenge(fullChallenge) ? fullChallenge : null;
}

function parseWormholeRunView(
  value: unknown,
  memberIds: ReadonlySet<string>,
  phase: GamePhase,
): MazeAuthorityWormholeRunView | null {
  const required = ['mapOwnerId', 'itemIndex', 'position', 'challenge', 'enteredAtTurn'];
  if (!isRecord(value)
    || !required.every((key) => Object.prototype.hasOwnProperty.call(value, key))
    || !validUid(value.mapOwnerId)
    || !memberIds.has(value.mapOwnerId)
    || !integerInRange(value.itemIndex, 0, MAX_MAP_ITEMS - 1)
    || !integerInRange(value.enteredAtTurn, 1, MAX_SAFE_COUNTER)) return null;
  if (!isRecord(value.challenge)) return null;

  if (value.challenge.version === 2) {
    if (!hasExactKeys(value, [...required, 'orientation', 'actionsTaken'])) return null;
    const position = parsePosition(value.position, 0, DICE_WORMHOLE_BOARD_SIZE - 1);
    const challenge = parseDiceWormholeChallenge(value.challenge);
    if (!position || !challenge
      || !isDiceOrientationId(value.orientation)
      || !integerInRange(value.actionsTaken, 0, MAX_SAFE_COUNTER)) return null;
    return {
      mapOwnerId: value.mapOwnerId,
      itemIndex: value.itemIndex,
      position,
      challenge,
      enteredAtTurn: value.enteredAtTurn,
      orientation: value.orientation,
      actionsTaken: value.actionsTaken,
    };
  }

  const allowed = [...required, 'activatedSeals', 'discoveredWalls'];
  if (!hasRequiredAllowedKeys(value, required, allowed)) return null;
  const position = parsePosition(value.position);
  const challenge = parseProjectedWormholeChallenge(
    value.challenge,
    phase === ('end' as GamePhase),
  );
  if (!position || !challenge || challenge.version !== 1) return null;
  const activatedSeals = Object.prototype.hasOwnProperty.call(value, 'activatedSeals')
    ? parseBooleanIndexRecord(value.activatedSeals, WORMHOLE_CHALLENGE_SEAL_COUNT)
    : null;
  const discoveredWalls = Object.prototype.hasOwnProperty.call(value, 'discoveredWalls')
    ? parseObstacleList(value.discoveredWalls, WORMHOLE_CHALLENGE_MAX_WALLS)
    : null;
  if ((Object.prototype.hasOwnProperty.call(value, 'activatedSeals') && !activatedSeals)
    || (activatedSeals && Object.keys(activatedSeals).some(
      (index) => Number(index) >= WORMHOLE_CHALLENGE_SEAL_COUNT
    ))
    || (Object.prototype.hasOwnProperty.call(value, 'discoveredWalls') && !discoveredWalls)) return null;
  return {
    mapOwnerId: value.mapOwnerId,
    itemIndex: value.itemIndex,
    position,
    challenge,
    enteredAtTurn: value.enteredAtTurn,
    ...(activatedSeals ? { activatedSeals } : {}),
    ...(discoveredWalls ? { discoveredWalls } : {}),
  };
}

function parseGameStateView(input: {
  value: unknown;
  audience: 'public' | 'member';
  viewerUid: string | null;
  lobby: MazeAuthorityLobbyView;
  ruleSnapshot: GameRuleSnapshot;
}): MazeAuthorityGameStateView | null {
  const required = ['phase', 'players'];
  const allowed = [
    ...required, 'rulesVersion', 'matchNumber', 'maps', 'assignments', 'currentTurn',
    'turnOrder', 'turnNumber', 'winner', 'draw', 'collisionWalls', 'itemState',
    'revealedWallsByPlayer', 'visionEffectsByPlayer', 'turnMessage', 'turnMessageTimestamp',
    'wormholeRunsByPlayer', 'poisonEffectsByPlayer', 'illusionEffectsByPlayer',
  ];
  const value = input.value;
  if (!isRecord(value)
    || !hasRequiredAllowedKeys(value, required, allowed)
    || !oneOf(value.phase, ['setup', 'play', 'end'] as const)
    || value.rulesVersion !== MAZE_AUTHORITY_RULES_VERSION
    || !integerInRange(value.matchNumber, 0, MAX_SAFE_COUNTER)
    || !isRecord(value.players)) return null;
  const phase = value.phase as GamePhase;
  const memberIds = Object.keys(input.lobby.members);
  const players: Record<string, MazeAuthorityPlayerView> = {};
  for (const [uid, rawPlayer] of Object.entries(value.players)) {
    if (!validUid(uid)) return null;
    const player = parsePlayerView(rawPlayer, uid, phase);
    if (!player) return null;
    players[uid] = player;
  }
  const playerIds = Object.keys(players);
  const playerSet = new Set(playerIds);
  const exactSetupRoster = phase === ('setup' as GamePhase)
    && playerIds.length === memberIds.length
    && playerIds.every((uid) => Object.prototype.hasOwnProperty.call(input.lobby.members, uid));
  const validMatchRoster = phase !== ('setup' as GamePhase)
    && playerIds.length >= 2
    && playerIds.length <= input.lobby.maxPlayers
    && memberIds.every((uid) => playerSet.has(uid));
  if (!exactSetupRoster && !validMatchRoster) return null;
  const rosterIds = phase === ('setup' as GamePhase) ? memberIds : playerIds;
  const rosterSet = new Set(rosterIds);

  const rawMaps = value.maps ?? {};
  if (!isRecord(rawMaps)) return null;
  const maps: Record<string, MazeAuthorityMapView> = {};
  for (const [mapOwnerId, rawMap] of Object.entries(rawMaps)) {
    if (!rosterSet.has(mapOwnerId)) return null;
    const mustBeFull = phase === ('end' as GamePhase)
      || (input.audience === 'member' && input.viewerUid === mapOwnerId);
    const map = mustBeFull
      ? parseProjectedFullMap(rawMap, input.ruleSnapshot)
      : parseBoundaryMap(rawMap);
    if (!map) return null;
    maps[mapOwnerId] = map;
  }
  if (phase === ('setup' as GamePhase)) {
    const allowedSetupIds = input.audience === 'member' && input.viewerUid
      ? new Set([input.viewerUid])
      : new Set<string>();
    if (Object.keys(maps).some((uid) => !allowedSetupIds.has(uid))) return null;
  } else if (Object.keys(maps).length !== rosterIds.length) return null;

  const rawAssignments = value.assignments ?? {};
  if (!isRecord(rawAssignments)) return null;
  const assignments: Record<string, string> = {};
  for (const [runnerId, mapOwnerId] of Object.entries(rawAssignments)) {
    if (!rosterSet.has(runnerId) || !validUid(mapOwnerId) || !rosterSet.has(mapOwnerId)) return null;
    assignments[runnerId] = mapOwnerId;
  }
  if (phase === ('setup' as GamePhase) && Object.keys(assignments).length > 0) return null;
  if (phase !== ('setup' as GamePhase) && Object.keys(assignments).length !== rosterIds.length) return null;

  const currentTurnRaw = Object.prototype.hasOwnProperty.call(value, 'currentTurn')
    ? value.currentTurn
    : null;
  const winnerRaw = Object.prototype.hasOwnProperty.call(value, 'winner') ? value.winner : null;
  const drawRaw = Object.prototype.hasOwnProperty.call(value, 'draw') ? value.draw : null;
  const currentTurn = parseNullableUid(currentTurnRaw);
  const winner = parseNullableUid(winnerRaw);
  if (currentTurn === undefined || (currentTurn !== null && !rosterSet.has(currentTurn))
    || winner === undefined || (winner !== null && !rosterSet.has(winner))
    || (drawRaw !== null && typeof drawRaw !== 'boolean')) return null;

  const turnOrder = parseStringList(value.turnOrder, 4, validUid);
  if (!turnOrder
    || new Set(turnOrder).size !== turnOrder.length
    || turnOrder.length !== rosterIds.length
    || turnOrder.some((uid) => !rosterSet.has(uid))) return null;

  const rawCollisions = canonicalRtdbList(value.collisionWalls, MAX_VIEW_LIST_LENGTH, true);
  if (!rawCollisions) return null;
  const collisionWalls: CollisionWall[] = [];
  for (const rawCollision of rawCollisions) {
    const collision = parseCollisionWall(rawCollision, rosterSet);
    if (!collision) return null;
    if (collision.identifiedAsFake === true) {
      const ownProjectedMap = input.viewerUid ? maps[input.viewerUid] : null;
      if (input.audience !== 'member'
        || input.viewerUid !== collision.playerId
        || !ownProjectedMap
        || !('runnerGear' in ownProjectedMap)
        || ownProjectedMap.runnerGear !== 'insight') return null;
    }
    collisionWalls.push(collision);
  }

  const rawItemState = value.itemState ?? {};
  if (!isRecord(rawItemState)) return null;
  const itemState: Record<string, MazeAuthorityItemStateView> = {};
  for (const [uid, rawEntry] of Object.entries(rawItemState)) {
    if (!rosterSet.has(uid)) return null;
    const entry = parseItemStateView(rawEntry);
    if (!entry) return null;
    itemState[uid] = entry;
  }

  const rawRevealed = value.revealedWallsByPlayer ?? {};
  if (!isRecord(rawRevealed)) return null;
  const revealedWallsByPlayer: Record<string, Obstacle[]> = {};
  for (const [uid, rawWalls] of Object.entries(rawRevealed)) {
    if (!rosterSet.has(uid)) return null;
    const walls = parseObstacleList(rawWalls, MAX_VIEW_LIST_LENGTH);
    if (!walls) return null;
    revealedWallsByPlayer[uid] = walls;
  }

  const rawVision = value.visionEffectsByPlayer ?? {};
  if (!isRecord(rawVision)) return null;
  const visionEffectsByPlayer: Record<string, VisionEffect> = {};
  for (const [uid, rawEffect] of Object.entries(rawVision)) {
    if (!rosterSet.has(uid)) return null;
    const effect = parseVisionEffect(rawEffect, rosterSet);
    if (!effect) return null;
    visionEffectsByPlayer[uid] = effect;
  }

  const rawWormholeRuns = value.wormholeRunsByPlayer ?? {};
  if (!isRecord(rawWormholeRuns)) return null;
  if (phase === ('setup' as GamePhase) && Object.keys(rawWormholeRuns).length > 0) return null;
  const wormholeRunsByPlayer: Record<string, MazeAuthorityWormholeRunView> = {};
  for (const [uid, rawRun] of Object.entries(rawWormholeRuns)) {
    if (!rosterSet.has(uid)) return null;
    const run = parseWormholeRunView(rawRun, rosterSet, phase);
    if (!run) return null;
    wormholeRunsByPlayer[uid] = run;
  }

  const rawPoisonEffects = value.poisonEffectsByPlayer ?? {};
  if (!isRecord(rawPoisonEffects)) return null;
  const poisonEffectsByPlayer: Record<string, MazeAuthorityPoisonEffectView> = {};
  for (const [uid, rawEffect] of Object.entries(rawPoisonEffects)) {
    if (!rosterSet.has(uid)) return null;
    const effect = parsePoisonEffect(rawEffect, rosterSet);
    if (!effect) return null;
    poisonEffectsByPlayer[uid] = effect;
  }

  const rawIllusionEffects = value.illusionEffectsByPlayer ?? {};
  if (!isRecord(rawIllusionEffects) || Object.keys(rawIllusionEffects).length > 0) return null;
  const illusionEffectsByPlayer: Record<string, never> = {};

  const privateIds = new Set([
    ...Object.keys(itemState),
    ...Object.keys(revealedWallsByPlayer),
    ...Object.keys(visionEffectsByPlayer),
    ...Object.keys(wormholeRunsByPlayer),
    ...Object.keys(poisonEffectsByPlayer),
    ...Object.keys(illusionEffectsByPlayer),
  ]);
  if (phase !== ('end' as GamePhase)) {
    if (input.audience === 'public' && privateIds.size > 0) return null;
    if (input.audience === 'member'
      && [...privateIds].some((uid) => uid !== input.viewerUid)) return null;
  }

  if (Object.prototype.hasOwnProperty.call(value, 'turnNumber')
    && !integerInRange(value.turnNumber, 1, MAX_SAFE_COUNTER)) return null;
  if (Object.prototype.hasOwnProperty.call(value, 'turnMessage')
    && !validMessage(value.turnMessage)) return null;
  if (Object.prototype.hasOwnProperty.call(value, 'turnMessageTimestamp')
    && !integerInRange(value.turnMessageTimestamp, 0, MAX_SAFE_COUNTER)) return null;

  return {
    rulesVersion: MAZE_AUTHORITY_RULES_VERSION,
    matchNumber: value.matchNumber,
    phase,
    players,
    maps,
    assignments,
    currentTurn,
    turnOrder,
    ...(Object.prototype.hasOwnProperty.call(value, 'turnNumber')
      ? { turnNumber: value.turnNumber as number }
      : {}),
    winner,
    draw: drawRaw as boolean | null,
    collisionWalls,
    itemState,
    revealedWallsByPlayer,
    visionEffectsByPlayer,
    wormholeRunsByPlayer,
    poisonEffectsByPlayer,
    illusionEffectsByPlayer,
    ...(Object.prototype.hasOwnProperty.call(value, 'turnMessage')
      ? { turnMessage: value.turnMessage as string }
      : {}),
    ...(Object.prototype.hasOwnProperty.call(value, 'turnMessageTimestamp')
      ? { turnMessageTimestamp: value.turnMessageTimestamp as number }
      : {}),
  };
}

function canonicalizeMazeAuthorityView(
  value: unknown,
  audience: 'public' | 'member',
  expected: { roomId?: string; viewerUid?: string } = {},
): MazeAuthorityPublicView | MazeAuthorityMemberView | null {
  const expectedKeys = audience === 'member'
    ? [
      'audience', 'viewerUid', 'viewVersion', 'authoritySchemaVersion', 'roomId',
      'generation', 'revision', 'sourceCreatedAt', 'sourceUpdatedAt', 'lobby',
      'ruleSnapshot', 'gameState',
    ]
    : [
      'audience', 'viewVersion', 'authoritySchemaVersion', 'roomId', 'generation',
      'revision', 'sourceCreatedAt', 'sourceUpdatedAt', 'lobby', 'ruleSnapshot', 'gameState',
    ];
  if (!isRecord(value)
    || !hasExactKeys(value, expectedKeys)
    || value.audience !== audience
    || value.viewVersion !== MAZE_AUTHORITY_VIEW_VERSION
    || value.authoritySchemaVersion !== MAZE_AUTHORITY_SCHEMA_VERSION
    || !validRoomId(value.roomId)
    || (expected.roomId !== undefined && value.roomId !== expected.roomId)
    || !integerInRange(value.generation, 1, MAX_SAFE_COUNTER)
    || !integerInRange(value.revision, 1, MAX_SAFE_COUNTER)
    || !integerInRange(value.sourceCreatedAt, 0, MAX_SAFE_COUNTER)
    || !integerInRange(value.sourceUpdatedAt, value.sourceCreatedAt, MAX_SAFE_COUNTER)) return null;
  const viewerUid = audience === 'member' && validUid(value.viewerUid) ? value.viewerUid : null;
  if (audience === 'member' && (!viewerUid
    || (expected.viewerUid !== undefined && viewerUid !== expected.viewerUid))) return null;
  const lobby = parseLobby(value.lobby);
  const ruleSnapshot = parseRuleSnapshot(value.ruleSnapshot);
  if (!lobby || !ruleSnapshot || (viewerUid && !lobby.members[viewerUid])) return null;
  const expectedStatus = isRecord(value.gameState) && value.gameState.phase === 'setup'
    ? 'waiting'
    : isRecord(value.gameState) && value.gameState.phase === 'play'
      ? 'playing'
      : 'ended';
  if (lobby.status !== expectedStatus) return null;
  const gameState = parseGameStateView({
    value: value.gameState,
    audience,
    viewerUid,
    lobby,
    ruleSnapshot,
  });
  if (!gameState) return null;
  const base: MazeAuthorityViewBase = {
    viewVersion: MAZE_AUTHORITY_VIEW_VERSION,
    authoritySchemaVersion: MAZE_AUTHORITY_SCHEMA_VERSION,
    roomId: value.roomId,
    generation: value.generation,
    revision: value.revision,
    sourceCreatedAt: value.sourceCreatedAt,
    sourceUpdatedAt: value.sourceUpdatedAt,
    lobby,
    ruleSnapshot,
    gameState,
  };
  return audience === 'member'
    ? { audience: 'member', viewerUid: viewerUid!, ...base }
    : { audience: 'public', ...base };
}

export function canonicalizeMazeAuthorityPublicView(
  value: unknown,
  expectedRoomId?: string,
): MazeAuthorityPublicView | null {
  return canonicalizeMazeAuthorityView(value, 'public', { roomId: expectedRoomId }) as
    MazeAuthorityPublicView | null;
}

export function canonicalizeMazeAuthorityMemberView(
  value: unknown,
  expectedViewerUid?: string,
  expectedRoomId?: string,
): MazeAuthorityMemberView | null {
  return canonicalizeMazeAuthorityView(value, 'member', {
    viewerUid: expectedViewerUid,
    roomId: expectedRoomId,
  }) as MazeAuthorityMemberView | null;
}

export const parseMazeAuthorityPublicView = canonicalizeMazeAuthorityPublicView;
export const parseMazeAuthorityMemberView = canonicalizeMazeAuthorityMemberView;

export function mazeAuthorityPublicViewPath(roomId: string): string {
  if (!validRoomId(roomId)) {
    throw new MazeAuthorityClientError('invalid-command', '미로 Authority 방 ID가 올바르지 않습니다.');
  }
  return `${MAZE_AUTHORITY_PUBLIC_VIEW_ROOT}/${roomId}`;
}

export function mazeAuthorityMemberViewPath(uid: string, roomId: string): string {
  if (!validUid(uid) || !validRoomId(roomId)) {
    throw new MazeAuthorityClientError('invalid-command', '미로 Authority 멤버 뷰 경로가 올바르지 않습니다.');
  }
  return `${MAZE_AUTHORITY_MEMBER_VIEW_ROOT}/${uid}/${roomId}`;
}

export function mazeAuthorityMemberRoomsPath(uid: string): string {
  if (!validUid(uid)) {
    throw new MazeAuthorityClientError('invalid-command', '미로 Authority 멤버 방 경로가 올바르지 않습니다.');
  }
  return `${MAZE_AUTHORITY_MEMBER_VIEW_ROOT}/${uid}`;
}

function validAuthorityPhotoURL(value: unknown): value is string {
  if (typeof value !== 'string' || value.length === 0 || value.length > MAX_PHOTO_URL_LENGTH) {
    return false;
  }
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'https:' && parsed.hostname === 'lh3.googleusercontent.com';
  } catch {
    return false;
  }
}

export function mazeAuthorityRankingViewPath(uid: string): string {
  if (!validUid(uid)) {
    throw new MazeAuthorityClientError('invalid-command', '미로 Authority 랭킹 경로가 올바르지 않습니다.');
  }
  return `${MAZE_AUTHORITY_RANKING_VIEW_ROOT}/${uid}`;
}

export function parseMazeAuthorityRankingView(
  uid: string | null,
  value: unknown,
): MazeAuthorityRankingView | null {
  const required = [
    'uid', 'displayName', 'wins', 'losses', 'draws', 'played', 'rating', 'bestMoves',
    'lastRoomId', 'lastMatchNumber', 'updatedAt', 'source', 'mirrorVersion',
    'sourceSettlementCount', 'lastGeneration',
  ] as const;
  if (!validUid(uid)
    || !isRecord(value)
    || value.uid !== uid
    || !hasRequiredAllowedKeys(value, required, [...required, 'photoURL'])
    || typeof value.displayName !== 'string'
    || value.displayName.length === 0
    || value.displayName.length > MAX_ROOM_NAME_LENGTH
    || value.displayName.trim() !== value.displayName
    || !integerInRange(value.wins, 0, MAX_RANKING_COUNTER)
    || !integerInRange(value.losses, 0, MAX_RANKING_COUNTER)
    || !integerInRange(value.draws, 0, MAX_RANKING_COUNTER)
    || !integerInRange(value.played, 0, MAX_RANKING_COUNTER)
    || value.played !== value.wins + value.losses + value.draws
    || !integerInRange(value.rating, 0, MAX_RANKING_COUNTER)
    || !integerInRange(value.bestMoves, 0, MAX_RANKING_BEST_MOVES)
    || !validRoomId(value.lastRoomId)
    || !integerInRange(value.lastMatchNumber, 1, MAX_RANKING_COUNTER)
    || !integerInRange(value.updatedAt, 0, MAX_SAFE_COUNTER)
    || value.source !== MAZE_AUTHORITY_RANKING_SOURCE
    || value.mirrorVersion !== MAZE_AUTHORITY_RANKING_MIRROR_VERSION
    || !integerInRange(value.sourceSettlementCount, 1, MAX_RANKING_COUNTER)
    || !integerInRange(value.lastGeneration, 1, MAX_SAFE_COUNTER)
    || (Object.prototype.hasOwnProperty.call(value, 'photoURL')
      && !validAuthorityPhotoURL(value.photoURL))) return null;
  return {
    uid,
    displayName: value.displayName,
    ...(typeof value.photoURL === 'string' ? { photoURL: value.photoURL } : {}),
    wins: value.wins,
    losses: value.losses,
    draws: value.draws,
    played: value.played,
    rating: value.rating,
    bestMoves: value.bestMoves,
    lastRoomId: value.lastRoomId,
    lastMatchNumber: value.lastMatchNumber,
    updatedAt: value.updatedAt,
    source: MAZE_AUTHORITY_RANKING_SOURCE,
    mirrorVersion: MAZE_AUTHORITY_RANKING_MIRROR_VERSION,
    sourceSettlementCount: value.sourceSettlementCount,
    lastGeneration: value.lastGeneration,
  };
}

function compareMazeAuthorityRankings(
  left: MazeAuthorityRankingView,
  right: MazeAuthorityRankingView,
): number {
  return right.rating - left.rating
    || right.wins - left.wins
    || left.losses - right.losses
    || (left.bestMoves || Number.MAX_SAFE_INTEGER)
      - (right.bestMoves || Number.MAX_SAFE_INTEGER)
    || left.uid.localeCompare(right.uid);
}

export function decodeMazeAuthorityRankingSubscription(
  exists: boolean,
  value: unknown,
): MazeAuthorityRankingSubscription {
  if (!exists) return { status: 'missing', entries: [] };
  if (!isRecord(value)) return { status: 'invalid', entries: [] };
  const entries: MazeAuthorityRankingView[] = [];
  for (const [uid, rawEntry] of Object.entries(value)) {
    const entry = parseMazeAuthorityRankingView(uid, rawEntry);
    if (!entry) return { status: 'invalid', entries: [] };
    entries.push(entry);
  }
  if (entries.length === 0) return { status: 'missing', entries: [] };
  return { status: 'ready', entries: entries.sort(compareMazeAuthorityRankings) };
}

function validPresenceSlot(value: unknown): value is MazeAuthorityPresenceSlot {
  return typeof value === 'string'
    && (MAZE_AUTHORITY_PRESENCE_SLOTS as readonly string[]).includes(value);
}

function validPresenceSession(value: unknown): value is string {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= MAX_PRESENCE_SESSION_LENGTH;
}

export function mazeAuthorityPresenceConnectionsPath(roomId: string, uid: string): string {
  if (!validRoomId(roomId) || !validUid(uid)) {
    throw new MazeAuthorityClientError('invalid-command', '미로 Authority 접속 경로가 올바르지 않습니다.');
  }
  return `${MAZE_AUTHORITY_PRESENCE_ROOM_ROOT}/${roomId}/${uid}`;
}

export function mazeAuthorityPresenceConnectionPath(
  roomId: string,
  uid: string,
  slot: MazeAuthorityPresenceSlot,
): string {
  if (!validPresenceSlot(slot)) {
    throw new MazeAuthorityClientError('invalid-command', '미로 Authority 접속 슬롯이 올바르지 않습니다.');
  }
  return `${mazeAuthorityPresenceConnectionsPath(roomId, uid)}/${slot}`;
}

export function mazeAuthorityPresenceRoomStatusPath(roomId: string): string {
  if (!validRoomId(roomId)) {
    throw new MazeAuthorityClientError('invalid-command', '미로 Authority 접속 상태 경로가 올바르지 않습니다.');
  }
  return `${MAZE_AUTHORITY_PRESENCE_STATUS_ROOT}/${roomId}`;
}

export function mazeAuthorityPresenceStatusPath(roomId: string, uid: string): string {
  if (!validUid(uid)) {
    throw new MazeAuthorityClientError('invalid-command', '미로 Authority 사용자 접속 상태 경로가 올바르지 않습니다.');
  }
  return `${mazeAuthorityPresenceRoomStatusPath(roomId)}/${uid}`;
}

export function parseMazeAuthorityPresenceConnection(
  value: unknown,
  expected: { uid?: string; generation?: number; session?: string } = {},
): MazeAuthorityPresenceConnection | null {
  if (!isRecord(value)
    || !hasExactKeys(value, ['uid', 'generation', 'session', 'connectedAt', 'lastSeen'])
    || !validUid(value.uid)
    || !integerInRange(value.generation, 1, MAX_SAFE_COUNTER)
    || !validPresenceSession(value.session)
    || !integerInRange(value.connectedAt, 0, MAX_SAFE_COUNTER)
    || !integerInRange(value.lastSeen, 0, MAX_SAFE_COUNTER)
    || (expected.uid !== undefined && value.uid !== expected.uid)
    || (expected.generation !== undefined && value.generation !== expected.generation)
    || (expected.session !== undefined && value.session !== expected.session)) return null;
  return {
    uid: value.uid,
    generation: value.generation,
    session: value.session,
    connectedAt: value.connectedAt,
    lastSeen: value.lastSeen,
  };
}

export function buildMazeAuthorityPresenceConnection(
  input: MazeAuthorityPresenceConnection,
): MazeAuthorityPresenceConnection {
  const parsed = parseMazeAuthorityPresenceConnection(input);
  if (!parsed) {
    throw new MazeAuthorityClientError('invalid-command', '미로 Authority 접속 정보가 올바르지 않습니다.');
  }
  return parsed;
}

/**
 * Builds the update value for a Web RTDB heartbeat transaction.
 *
 * The Web SDK may invoke a transaction with an optimistic `null` before it has
 * fetched the server value. Returning `undefined` for that first callback would
 * abort locally and make a healthy connection look deleted. Returning our
 * signed-by-identity candidate forces the compare-and-put round trip; if the
 * server slot belongs to another session, the retry still aborts safely.
 */
export function buildMazeAuthorityPresenceHeartbeatTransactionValue(
  current: unknown,
  heartbeat: MazeAuthorityPresenceConnection,
): MazeAuthorityPresenceConnection | undefined {
  const candidate = buildMazeAuthorityPresenceConnection(heartbeat);
  if (current == null) return candidate;
  const existing = parseMazeAuthorityPresenceConnection(current, {
    uid: candidate.uid,
    generation: candidate.generation,
    session: candidate.session,
  });
  if (!existing) return undefined;
  return {
    ...existing,
    lastSeen: Math.max(existing.lastSeen, candidate.lastSeen),
  };
}

/**
 * Builds the update value for an ownership-checked connection release.
 * `null` on an optimistic cache miss makes RTDB consult the server; a slot that
 * has since been claimed by another session is preserved on the retry.
 */
export function buildMazeAuthorityPresenceReleaseTransactionValue(
  current: unknown,
  expected: { uid: string; generation: number; session: string },
): null | undefined {
  if (current == null) return null;
  return parseMazeAuthorityPresenceConnection(current, expected) ? null : undefined;
}

export function parseMazeAuthorityPresenceStatus(
  value: unknown,
  expected: { roomId?: string; uid?: string } = {},
): MazeAuthorityPresenceStatus | null {
  if (!isRecord(value)
    || !hasRequiredAllowedKeys(value, [
      'uid', 'roomId', 'generation', 'epoch', 'online', 'lastSeen', 'updatedAt',
    ], [
      'uid', 'roomId', 'generation', 'epoch', 'online', 'lastSeen', 'offlineSince',
      'updatedAt',
    ])
    || !validUid(value.uid)
    || !validRoomId(value.roomId)
    || !integerInRange(value.generation, 1, MAX_SAFE_COUNTER)
    || !integerInRange(value.epoch, 1, MAX_SAFE_COUNTER)
    || typeof value.online !== 'boolean'
    || !integerInRange(value.lastSeen, 0, MAX_SAFE_COUNTER)
    || !integerInRange(value.updatedAt, 0, MAX_SAFE_COUNTER)
    || (value.online
      ? Object.prototype.hasOwnProperty.call(value, 'offlineSince')
      : !integerInRange(value.offlineSince, 0, MAX_SAFE_COUNTER))
    || (expected.roomId !== undefined && value.roomId !== expected.roomId)
    || (expected.uid !== undefined && value.uid !== expected.uid)) return null;
  return {
    uid: value.uid,
    roomId: value.roomId,
    generation: value.generation,
    epoch: value.epoch,
    online: value.online,
    lastSeen: value.lastSeen,
    ...(value.online ? {} : { offlineSince: value.offlineSince as number }),
    updatedAt: value.updatedAt,
  };
}

function errorReason(error: unknown): string | null {
  if (!isRecord(error)) return null;
  const details = isRecord(error.details) ? error.details : null;
  return details && typeof details.reason === 'string' ? details.reason : null;
}

export function mapMazeAuthorityClientError(error: unknown): MazeAuthorityClientError {
  if (error instanceof MazeAuthorityClientError) return error;
  const rawCode = isRecord(error) && typeof error.code === 'string' ? error.code : '';
  const code = rawCode.replace(/^functions\//u, '');
  const reason = errorReason(error);
  if (code === 'unauthenticated') {
    return new MazeAuthorityClientError('unauthenticated', '로그인이 필요합니다.', { reason });
  }
  if (code === 'invalid-argument') {
    return new MazeAuthorityClientError('invalid-command', '미로 Authority 명령이 거부되었습니다.', { reason });
  }
  if (code === 'not-found') {
    return new MazeAuthorityClientError('not-found', '미로 방을 찾을 수 없습니다.', { reason });
  }
  if (code === 'permission-denied') {
    return new MazeAuthorityClientError('forbidden', '이 미로 작업을 수행할 권한이 없습니다.', { reason });
  }
  if (code === 'already-exists') {
    return new MazeAuthorityClientError('conflict', '이미 반영되었거나 명령 ID가 충돌했습니다.', { reason });
  }
  if (code === 'aborted') {
    return new MazeAuthorityClientError('conflict', '다른 미로 갱신이 먼저 반영되었습니다.', {
      reason,
      retry: reason === 'revision-mismatch' ? 'refresh-view' : 'retry-same-command',
    });
  }
  if (code === 'failed-precondition') {
    return new MazeAuthorityClientError('precondition', '현재 미로 상태에서는 이 작업을 수행할 수 없습니다.', {
      reason,
      retry: reason === 'generation-mismatch' ? 'refresh-view' : 'none',
    });
  }
  if (code === 'resource-exhausted') {
    return new MazeAuthorityClientError('exhausted', '미로 방의 허용 한도에 도달했습니다.', { reason });
  }
  if (code === 'unavailable' || code === 'deadline-exceeded' || code === 'internal') {
    return new MazeAuthorityClientError('unavailable', '미로 Authority 서버에 연결할 수 없습니다.', {
      reason,
      retry: 'retry-same-command',
    });
  }
  if (code === 'data-loss') {
    return new MazeAuthorityClientError('invalid-response', '미로 Authority 상태 검증에 실패했습니다.', {
      reason,
    });
  }
  return new MazeAuthorityClientError('rejected', '미로 Authority 요청을 완료하지 못했습니다.', {
    reason,
  });
}

export function classifyMazeAuthorityRetry(error: unknown): MazeAuthorityRetryClass {
  return mapMazeAuthorityClientError(error).retry;
}

async function invokeMazeAuthorityCallable<T>(
  name: string,
  payload: Record<string, unknown>,
  decoder: (value: unknown) => T | null,
): Promise<T> {
  try {
    const initialized = await firebaseInitPromise;
    if (!initialized?.functions) {
      throw new MazeAuthorityClientError(
        'unavailable',
        'Firebase Functions가 초기화되지 않았습니다.',
        { retry: 'retry-same-command' },
      );
    }
    if (initialized.appCheckStatus === 'missing-config') {
      throw new MazeAuthorityClientError(
        'unavailable',
        'Firebase App Check가 구성되지 않아 미로 Authority 요청을 시작할 수 없습니다.',
      );
    }
    // App Check attestation is attached by the Firebase callable SDK. Never add
    // a client-managed token or custom authority secret to this payload.
    const result = await httpsCallable<Record<string, unknown>, unknown>(
      initialized.functions,
      name,
    )(payload);
    const decoded = decoder(result.data);
    if (!decoded) {
      throw new MazeAuthorityClientError(
        'invalid-response',
        '미로 Authority 응답이 올바르지 않습니다.',
      );
    }
    return decoded;
  } catch (error) {
    throw mapMazeAuthorityClientError(error);
  }
}

export async function invokeMazeAuthorityCommand(
  command: MazeAuthorityCommand,
): Promise<MazeAuthorityCommandResponse> {
  const canonical = requireCommand(parseMazeAuthorityCommand(command));
  return invokeMazeAuthorityCallable(
    MAZE_AUTHORITY_CALLABLES.command,
    canonical as unknown as Record<string, unknown>,
    (value) => decodeMazeAuthorityCommandResponse(value, canonical),
  );
}

export async function invokeMazeAuthorityOfflineTurn(
  input: MazeAuthorityOfflineTurnRequest,
): Promise<MazeAuthorityOfflineTurnResponse> {
  const request = buildMazeAuthorityOfflineTurnRequest(input);
  return invokeMazeAuthorityCallable(
    MAZE_AUTHORITY_CALLABLES.claimOfflineTurn,
    request as unknown as Record<string, unknown>,
    (value) => decodeMazeAuthorityOfflineTurnResponse(value, request),
  );
}

export async function syncMazeAuthorityRoom(
  requestOrRoomId: MazeAuthoritySyncRoomRequest | string,
): Promise<MazeAuthoritySyncRoomResponse> {
  const rawRequest = typeof requestOrRoomId === 'string'
    ? buildMazeAuthoritySyncRoomRequest(requestOrRoomId)
    : requestOrRoomId;
  const request = parseMazeAuthoritySyncRoomRequest(rawRequest);
  if (!request) {
    throw new MazeAuthorityClientError('invalid-command', '미로 Authority 동기화 요청이 올바르지 않습니다.');
  }
  return invokeMazeAuthorityCallable(
    MAZE_AUTHORITY_CALLABLES.syncRoom,
    request as unknown as Record<string, unknown>,
    (value) => decodeMazeAuthoritySyncRoomResponse(value, request.roomId),
  );
}

// Concise aliases for route/session integration while keeping the contract name explicit.
export const mazeV1Command = invokeMazeAuthorityCommand;
export const mazeV1SyncRoom = syncMazeAuthorityRoom;
export const mazeV1ClaimOfflineTurn = invokeMazeAuthorityOfflineTurn;
