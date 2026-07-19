import { createHash } from 'node:crypto';
import {
  createCanonicalGameRuleSnapshot,
  isValidGameRuleSnapshot,
  isValidNewMapForRuleSnapshot,
  type GameRuleSnapshot,
} from '../vendor/maze-engine/dist/lib/gameRules';
import {
  resolveTurnAction,
  type TurnAction,
  type TurnOutcome,
} from '../vendor/maze-engine/dist/lib/gameTurn';
import {
  GAME_RULES_VERSION,
  getMapItems,
  getFirstTurnPlayerId,
  getNextTurnPlayerId,
  getTurnOrder,
} from '../vendor/maze-engine/dist/lib/gameUtils';
import {
  GamePhase,
  type Direction,
  type GameMap,
  type GameState,
  type ItemType,
  type MapItem,
  type MazeSkillId,
  type Obstacle,
  type Player,
  type Position,
} from '../vendor/maze-engine/dist/types/game';

export const MAZE_AUTHORITY_SCHEMA_VERSION = 1 as const;
export const MAZE_AUTHORITY_INITIAL_GENERATION = 1 as const;
export const MAZE_AUTHORITY_MAX_RECEIPTS = 64 as const;

const MAX_ROOM_NAME_LENGTH = 50;
const MAX_ROOM_ID_LENGTH = 64;
const MAX_COMMAND_ID_LENGTH = 64;
const MAX_UID_LENGTH = 128;
const MAX_MAP_OBSTACLE_INPUTS = 64;
const MAX_MAP_ITEM_INPUTS = 16;
const INVALID_FIREBASE_KEY = /[.#$\[\]\/\u0000-\u001F\u007F-\u009F]/u;
const SAFE_IDENTIFIER = /^[A-Za-z0-9_-]+$/u;
const SHA256_HEX = /^[a-f0-9]{64}$/u;
const RESERVED_RECORD_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

const DIRECTIONS = new Set<Direction>(['up', 'down', 'left', 'right']);
const MAZE_SKILLS = new Set<MazeSkillId>(['scoutPulse', 'breach', 'anchor', 'dash']);
const ITEM_TYPES = new Set<ItemType>([
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
]);
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
]);

export type MazeAuthorityCommandType =
  | 'createRoom'
  | 'joinRoom'
  | 'submitMap'
  | 'resetMap'
  | 'startMatch'
  | 'turn'
  | 'forfeit'
  | 'skipOfflineTurn'
  | 'leaveRoom'
  | 'restartMatch'
  | 'closeRoom';

export type MazeAuthorityDomainErrorCode =
  | 'invalid-argument'
  | 'not-found'
  | 'already-exists'
  | 'permission-denied'
  | 'failed-precondition'
  | 'aborted'
  | 'resource-exhausted'
  | 'data-loss';

export class MazeAuthorityDomainError extends Error {
  readonly code: MazeAuthorityDomainErrorCode;
  readonly reason: string;

  constructor(code: MazeAuthorityDomainErrorCode, reason: string, message: string) {
    super(message);
    this.name = 'MazeAuthorityDomainError';
    this.code = code;
    this.reason = reason;
  }
}

interface CommandCas {
  commandId: string;
  roomId: string;
  expectedGeneration: number;
  expectedRevision: number;
}

export interface CreateRoomCommand extends CommandCas {
  type: 'createRoom';
  name: string;
  maxPlayers: number;
}

export interface JoinRoomCommand extends CommandCas {
  type: 'joinRoom';
}

export interface SubmitMapCommand extends CommandCas {
  type: 'submitMap';
  map: GameMap;
}

export interface ResetMapCommand extends CommandCas {
  type: 'resetMap';
}

export interface StartMatchCommand extends CommandCas {
  type: 'startMatch';
}

export interface TurnCommand extends CommandCas {
  type: 'turn';
  action: TurnAction;
}

export interface ForfeitCommand extends CommandCas {
  type: 'forfeit';
}

/**
 * Server-only command used by the offline-turn callable. It is deliberately
 * excluded from MazeAuthorityCommand and the public command parser.
 */
export interface MazeAuthorityOfflineTurnCommand extends CommandCas {
  type: 'skipOfflineTurn';
  turnNumber: number;
  leaseEpoch: number;
}

export interface LeaveRoomCommand extends CommandCas {
  type: 'leaveRoom';
}

export interface RestartMatchCommand extends CommandCas {
  type: 'restartMatch';
}

export interface CloseRoomCommand extends CommandCas {
  type: 'closeRoom';
}

export type MazeAuthorityCommand =
  | CreateRoomCommand
  | JoinRoomCommand
  | SubmitMapCommand
  | ResetMapCommand
  | StartMatchCommand
  | TurnCommand
  | LeaveRoomCommand
  | RestartMatchCommand
  | CloseRoomCommand;

export interface MazeAuthorityMember {
  uid: string;
  slot: number;
  joinedAt: number;
}

export interface MazeAuthorityActorProfile {
  displayName: string;
  photoURL?: string;
}

export interface MazeAuthorityMeta {
  schemaVersion: typeof MAZE_AUTHORITY_SCHEMA_VERSION;
  roomId: string;
  generation: number;
  revision: number;
  createdAt: number;
  updatedAt: number;
}

export interface MazeAuthorityLobby {
  name: string;
  ownerId: string;
  maxPlayers: number;
  status: 'waiting' | 'playing' | 'ended' | 'closed';
  members: Record<string, MazeAuthorityMember>;
}

interface MazeAuthorityResultBase {
  type: MazeAuthorityCommandType;
  roomId: string;
  generation: number;
  revision: number;
}

export interface CreateRoomResult extends MazeAuthorityResultBase {
  type: 'createRoom';
}

export interface JoinRoomResult extends MazeAuthorityResultBase {
  type: 'joinRoom';
  slot: number;
}

export interface SubmitMapResult extends MazeAuthorityResultBase {
  type: 'submitMap';
  ready: true;
}

export interface ResetMapResult extends MazeAuthorityResultBase {
  type: 'resetMap';
  ready: false;
}

export interface StartMatchResult extends MazeAuthorityResultBase {
  type: 'startMatch';
  phase: GamePhase.PLAY;
  currentTurn: string;
  matchNumber: number;
}

export interface TurnResult extends MazeAuthorityResultBase {
  type: 'turn';
  phase: GamePhase;
  currentTurn: string | null;
  winner: string | null;
  draw: boolean | null;
  outcome: TurnOutcome;
}

export interface ForfeitResult extends MazeAuthorityResultBase {
  type: 'forfeit';
  phase: GamePhase;
  currentTurn: string | null;
  winner: string | null;
  draw: boolean | null;
}

export interface MazeAuthorityOfflineTurnResult extends MazeAuthorityResultBase {
  type: 'skipOfflineTurn';
  phase: GamePhase.PLAY;
  skippedPlayerId: string;
  currentTurn: string;
  turnNumber: number;
}

export interface LeaveRoomResult extends MazeAuthorityResultBase {
  type: 'leaveRoom';
  phase: GamePhase;
  closed: boolean;
  ownerId: string;
  remainingMembers: number;
}

export interface RestartMatchResult extends MazeAuthorityResultBase {
  type: 'restartMatch';
  phase: GamePhase.SETUP;
  currentTurn: string;
  matchNumber: number;
}

export interface CloseRoomResult extends MazeAuthorityResultBase {
  type: 'closeRoom';
  closed: true;
}

export type MazeAuthorityCommandResult =
  | CreateRoomResult
  | JoinRoomResult
  | SubmitMapResult
  | ResetMapResult
  | StartMatchResult
  | TurnResult
  | ForfeitResult
  | MazeAuthorityOfflineTurnResult
  | LeaveRoomResult
  | RestartMatchResult
  | CloseRoomResult;

export interface MazeAuthorityReceipt {
  actorId: string;
  payloadHash: string;
  commandType: MazeAuthorityCommandType;
  generation: number;
  revision: number;
  result: MazeAuthorityCommandResult;
}

export interface MazeAuthorityReceiptLedger {
  order: string[];
  byId: Record<string, MazeAuthorityReceipt>;
}

export interface MazeAuthorityState {
  meta: MazeAuthorityMeta;
  lobby: MazeAuthorityLobby;
  ruleSnapshot: GameRuleSnapshot;
  gameState: GameState;
  receipts: MazeAuthorityReceiptLedger;
}

export interface MazeAuthorityReduction {
  state: MazeAuthorityState;
  result: MazeAuthorityCommandResult;
  replayed: boolean;
}

type MazeAuthorityReceiptCommand = MazeAuthorityCommand | MazeAuthorityOfflineTurnCommand;

function fail(
  code: MazeAuthorityDomainErrorCode,
  reason: string,
  message: string,
): never {
  throw new MazeAuthorityDomainError(code, reason, message);
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasExactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const expectedSet = new Set(expected);
  const keys = Reflect.ownKeys(value);
  return keys.length === expected.length
    && keys.every((key) => typeof key === 'string' && expectedSet.has(key));
}

function hasRequiredAndAllowedKeys(
  value: Record<string, unknown>,
  required: readonly string[],
  allowed: readonly string[],
): boolean {
  const allowedSet = new Set(allowed);
  const keys = Reflect.ownKeys(value);
  return required.every((key) => Object.prototype.hasOwnProperty.call(value, key))
    && keys.every((key) => typeof key === 'string' && allowedSet.has(key));
}

function isDenseArray(value: unknown, maxLength: number): value is unknown[] {
  if (!Array.isArray(value) || value.length > maxLength) return false;
  const expectedKeys = new Set([
    'length',
    ...Array.from({ length: value.length }, (_, index) => String(index)),
  ]);
  const keys = Reflect.ownKeys(value);
  return keys.length === value.length + 1
    && keys.every((key) => typeof key === 'string' && expectedKeys.has(key));
}

function isSafeIntegerInRange(value: unknown, minimum: number, maximum: number): value is number {
  return typeof value === 'number'
    && Number.isSafeInteger(value)
    && value >= minimum
    && value <= maximum;
}

function validFirebaseIdentifier(
  value: unknown,
  minimumLength: number,
  maximumLength: number,
): value is string {
  return typeof value === 'string'
    && value.length >= minimumLength
    && value.length <= maximumLength
    && value.trim() === value
    && SAFE_IDENTIFIER.test(value)
    && !INVALID_FIREBASE_KEY.test(value)
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

function parsePosition(value: unknown, label: string): Position {
  if (!isPlainRecord(value)
    || !hasExactKeys(value, ['row', 'col'])
    || !isSafeIntegerInRange(value.row, 0, 5)
    || !isSafeIntegerInRange(value.col, 0, 5)) {
    fail('invalid-argument', `${label}-invalid`, `The ${label} position is malformed.`);
  }
  return { row: value.row, col: value.col };
}

function parseDirection(value: unknown, label: string): Direction {
  if (typeof value !== 'string' || !DIRECTIONS.has(value as Direction)) {
    fail('invalid-argument', `${label}-invalid`, `The ${label} direction is malformed.`);
  }
  return value as Direction;
}

function parseObstacle(value: unknown, label: string): Obstacle {
  if (!isPlainRecord(value) || !hasExactKeys(value, ['position', 'direction'])) {
    fail('invalid-argument', `${label}-invalid`, `The ${label} obstacle is malformed.`);
  }
  return {
    position: parsePosition(value.position, `${label}-position`),
    direction: parseDirection(value.direction, `${label}-direction`),
  };
}

function parseMapItem(value: unknown, label: string): MapItem {
  if (!isPlainRecord(value) || typeof value.type !== 'string' || !ITEM_TYPES.has(value.type as ItemType)) {
    fail('invalid-argument', `${label}-invalid`, `The ${label} item is malformed.`);
  }
  const type = value.type as ItemType;

  if (WALL_ITEM_TYPES.has(type)) {
    const expectedKeys = type === 'windWall' && Object.prototype.hasOwnProperty.call(value, 'effectDirection')
      ? ['type', 'wallPosition', 'wallDirection', 'effectDirection']
      : ['type', 'wallPosition', 'wallDirection'];
    if (!hasExactKeys(value, expectedKeys)) {
      fail('invalid-argument', `${label}-keys`, `The ${label} wall item has unknown fields.`);
    }
    const item: MapItem = {
      type,
      wallPosition: parsePosition(value.wallPosition, `${label}-wall-position`),
      wallDirection: parseDirection(value.wallDirection, `${label}-wall-direction`),
    };
    if (type === 'windWall' && Object.prototype.hasOwnProperty.call(value, 'effectDirection')) {
      item.effectDirection = parseDirection(value.effectDirection, `${label}-effect-direction`);
    }
    return item;
  }

  if (type === 'mine' || type === 'smoke') {
    if (!hasExactKeys(value, ['type', 'position'])) {
      fail('invalid-argument', `${label}-keys`, `The ${label} cell item has unknown fields.`);
    }
    return { type, position: parsePosition(value.position, `${label}-position`) };
  }

  if (type === 'wormhole') {
    if (!hasExactKeys(value, ['type', 'entrance', 'exit'])) {
      fail('invalid-argument', `${label}-keys`, `The ${label} wormhole has unknown fields.`);
    }
    return {
      type,
      entrance: parsePosition(value.entrance, `${label}-entrance`),
      exit: parsePosition(value.exit, `${label}-exit`),
    };
  }

  if (!hasExactKeys(value, ['type'])) {
    fail('invalid-argument', `${label}-keys`, `The ${label} radar has unknown fields.`);
  }
  return { type: 'radar' };
}

function parseGameMap(value: unknown): GameMap {
  const required = ['rulesVersion', 'startPosition', 'endPosition', 'obstacles', 'skillLoadout'];
  const allowed = [...required, 'items', 'item'];
  if (!isPlainRecord(value) || !hasRequiredAndAllowedKeys(value, required, allowed)) {
    fail('invalid-argument', 'map-shape', 'The submitted map is malformed.');
  }
  if (value.rulesVersion !== GAME_RULES_VERSION) {
    fail('invalid-argument', 'map-rules-version', 'The submitted map does not use V3 rules.');
  }
  if (typeof value.skillLoadout !== 'string' || !MAZE_SKILLS.has(value.skillLoadout as MazeSkillId)) {
    fail('invalid-argument', 'map-skill', 'The submitted map skill is malformed.');
  }
  if (!isDenseArray(value.obstacles, MAX_MAP_OBSTACLE_INPUTS)) {
    fail('invalid-argument', 'map-obstacles', 'The submitted map obstacles are malformed.');
  }

  const map: GameMap = {
    rulesVersion: GAME_RULES_VERSION,
    startPosition: parsePosition(value.startPosition, 'map-start'),
    endPosition: parsePosition(value.endPosition, 'map-end'),
    obstacles: value.obstacles.map((obstacle, index) => parseObstacle(obstacle, `map-obstacle-${index}`)),
    skillLoadout: value.skillLoadout as MazeSkillId,
  };

  const hasItems = Object.prototype.hasOwnProperty.call(value, 'items');
  const hasLegacyItem = Object.prototype.hasOwnProperty.call(value, 'item');
  if (hasItems) {
    if (value.items !== null && !isDenseArray(value.items, MAX_MAP_ITEM_INPUTS)) {
      fail('invalid-argument', 'map-items', 'The submitted map items are malformed.');
    }
    map.items = value.items === null
      ? null
      : value.items.map((item, index) => parseMapItem(item, `map-item-${index}`));
  }
  if (hasLegacyItem) {
    map.item = value.item === null ? null : parseMapItem(value.item, 'map-legacy-item');
  }
  if (hasItems
    && hasLegacyItem
    && Array.isArray(map.items)
    && map.item !== null) {
    fail('invalid-argument', 'map-mixed-item-formats', 'A map cannot mix V3 and legacy item formats.');
  }
  return map;
}

function parseTurnAction(value: unknown): TurnAction {
  if (!isPlainRecord(value) || typeof value.type !== 'string') {
    fail('invalid-argument', 'turn-action-shape', 'The turn action is malformed.');
  }
  if (value.type === 'move') {
    if (!hasExactKeys(value, ['type', 'direction'])) {
      fail('invalid-argument', 'move-action-keys', 'The move action has unknown fields.');
    }
    return { type: 'move', direction: parseDirection(value.direction, 'move') };
  }
  if (value.type === 'radar') {
    fail('failed-precondition', 'radar-retired', 'The detector action has been retired.');
  }
  if (value.type === 'skill') {
    fail('failed-precondition', 'skill-retired', 'Maze skills have been retired.');
  }
  fail('invalid-argument', 'turn-action-type', 'The turn action type is unsupported.');
}

function parseCas(value: Record<string, unknown>, create: boolean): CommandCas {
  if (!validFirebaseIdentifier(value.commandId, 8, MAX_COMMAND_ID_LENGTH)
    || !validFirebaseIdentifier(value.roomId, 8, MAX_ROOM_ID_LENGTH)
    || !isSafeIntegerInRange(value.expectedGeneration, 0, Number.MAX_SAFE_INTEGER)
    || !isSafeIntegerInRange(value.expectedRevision, 0, Number.MAX_SAFE_INTEGER)) {
    fail('invalid-argument', 'command-cas', 'The command identity or CAS fence is malformed.');
  }
  if (create && (value.expectedGeneration !== 0 || value.expectedRevision !== 0)) {
    fail('invalid-argument', 'create-cas', 'Room creation must start from generation and revision zero.');
  }
  if (!create && value.expectedGeneration < 1) {
    fail('invalid-argument', 'generation-cas', 'Existing-room commands require a positive generation.');
  }
  return {
    commandId: value.commandId,
    roomId: value.roomId,
    expectedGeneration: value.expectedGeneration,
    expectedRevision: value.expectedRevision,
  };
}

export function parseMazeAuthorityCommand(value: unknown): MazeAuthorityCommand {
  if (!isPlainRecord(value) || typeof value.type !== 'string') {
    fail('invalid-argument', 'command-shape', 'The Maze Authority command is malformed.');
  }

  switch (value.type) {
    case 'createRoom': {
      if (!hasExactKeys(value, [
        'type', 'commandId', 'roomId', 'expectedGeneration', 'expectedRevision', 'name', 'maxPlayers',
      ])
        || !validRoomName(value.name)
        || !isSafeIntegerInRange(value.maxPlayers, 2, 4)) {
        fail('invalid-argument', 'create-room-command', 'The create-room command is malformed.');
      }
      return {
        type: 'createRoom',
        ...parseCas(value, true),
        name: value.name,
        maxPlayers: value.maxPlayers,
      };
    }
    case 'joinRoom':
    case 'resetMap':
    case 'startMatch':
    case 'leaveRoom':
    case 'restartMatch':
    case 'closeRoom': {
      if (!hasExactKeys(value, [
        'type', 'commandId', 'roomId', 'expectedGeneration', 'expectedRevision',
      ])) {
        fail('invalid-argument', `${value.type}-command`, `The ${value.type} command is malformed.`);
      }
      return { type: value.type, ...parseCas(value, false) };
    }
    case 'forfeit':
      fail(
        'failed-precondition',
        'forfeit-retired',
        'Forfeit is retired. Active matches continue until every runner finishes.',
      );
    case 'submitMap': {
      if (!hasExactKeys(value, [
        'type', 'commandId', 'roomId', 'expectedGeneration', 'expectedRevision', 'map',
      ])) {
        fail('invalid-argument', 'submit-map-command', 'The submit-map command is malformed.');
      }
      return { type: 'submitMap', ...parseCas(value, false), map: parseGameMap(value.map) };
    }
    case 'turn': {
      if (!hasExactKeys(value, [
        'type', 'commandId', 'roomId', 'expectedGeneration', 'expectedRevision', 'action',
      ])) {
        fail('invalid-argument', 'turn-command', 'The turn command is malformed.');
      }
      return { type: 'turn', ...parseCas(value, false), action: parseTurnAction(value.action) };
    }
    default:
      fail('invalid-argument', 'command-type', 'The Maze Authority command type is unsupported.');
  }
}

function parseMazeAuthorityOfflineTurnCommand(
  value: unknown,
): MazeAuthorityOfflineTurnCommand {
  if (!isPlainRecord(value)
    || value.type !== 'skipOfflineTurn'
    || !hasExactKeys(value, [
      'type', 'commandId', 'roomId', 'expectedGeneration', 'expectedRevision',
      'turnNumber', 'leaseEpoch',
    ])
    || !isSafeIntegerInRange(value.turnNumber, 1, Number.MAX_SAFE_INTEGER)
    || !isSafeIntegerInRange(value.leaseEpoch, 1, Number.MAX_SAFE_INTEGER)) {
    fail(
      'invalid-argument',
      'offline-turn-command',
      'The server-owned offline-turn command is malformed.',
    );
  }
  return {
    type: 'skipOfflineTurn',
    ...parseCas(value, false),
    turnNumber: value.turnNumber,
    leaseEpoch: value.leaseEpoch,
  };
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function stableSerialize(value: unknown): string {
  if (value === null) return 'null';
  if (typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) fail('invalid-argument', 'payload-number', 'The command contains a non-finite number.');
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(',')}]`;
  if (isPlainRecord(value)) {
    return `{${Object.keys(value).sort().map((key) => (
      `${JSON.stringify(key)}:${stableSerialize(value[key])}`
    )).join(',')}}`;
  }
  fail('invalid-argument', 'payload-value', 'The command contains an unsupported value.');
}

function commandPayloadHash(actorId: string, command: MazeAuthorityReceiptCommand): string {
  const payload: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(command)) {
    if (key !== 'commandId') payload[key] = value;
  }
  return createHash('sha256')
    .update(stableSerialize([actorId, payload]), 'utf8')
    .digest('hex');
}

function validTimestamp(value: unknown): value is number {
  return isSafeIntegerInRange(value, 0, Number.MAX_SAFE_INTEGER);
}

function validPlayerEnvelope(player: unknown, uid: string): player is Player {
  return isPlainRecord(player)
    && player.id === uid
    && typeof player.isReady === 'boolean'
    && isPlainRecord(player.position)
    && isSafeIntegerInRange(player.position.row, 0, 5)
    && isSafeIntegerInRange(player.position.col, 0, 5);
}

function sameIdentifierSet(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length
    && new Set(left).size === left.length
    && left.every((identifier) => right.includes(identifier));
}

function validReceiptResult(
  result: Record<string, unknown>,
  commandType: MazeAuthorityCommandType,
  state: MazeAuthorityState,
  receipt: MazeAuthorityReceipt,
): boolean {
  const validBase = result.type === commandType
    && result.roomId === state.meta.roomId
    && result.generation === state.meta.generation
    && result.revision === receipt.revision;
  if (!validBase) return false;

  switch (commandType) {
    case 'createRoom':
      return hasExactKeys(result, ['type', 'roomId', 'generation', 'revision']);
    case 'joinRoom':
      return hasExactKeys(result, ['type', 'roomId', 'generation', 'revision', 'slot'])
        && isSafeIntegerInRange(result.slot, 0, state.lobby.maxPlayers - 1);
    case 'submitMap':
      return hasExactKeys(result, ['type', 'roomId', 'generation', 'revision', 'ready'])
        && result.ready === true;
    case 'resetMap':
      return hasExactKeys(result, ['type', 'roomId', 'generation', 'revision', 'ready'])
        && result.ready === false;
    case 'startMatch':
      return hasExactKeys(result, [
        'type', 'roomId', 'generation', 'revision', 'phase', 'currentTurn', 'matchNumber',
      ])
        && result.phase === GamePhase.PLAY
        && validUid(result.currentTurn)
        && isSafeIntegerInRange(result.matchNumber, 1, Number.MAX_SAFE_INTEGER);
    case 'turn':
      return hasExactKeys(result, [
        'type', 'roomId', 'generation', 'revision', 'phase', 'currentTurn', 'winner', 'draw', 'outcome',
      ])
        && Object.values(GamePhase).includes(result.phase as GamePhase)
        && (result.currentTurn === null || validUid(result.currentTurn))
        && (result.winner === null || validUid(result.winner))
        && (result.draw === null || typeof result.draw === 'boolean')
        && isPlainRecord(result.outcome);
    case 'forfeit':
      return hasExactKeys(result, [
        'type', 'roomId', 'generation', 'revision', 'phase', 'currentTurn', 'winner', 'draw',
      ])
        && Object.values(GamePhase).includes(result.phase as GamePhase)
        && (result.currentTurn === null || validUid(result.currentTurn))
        && (result.winner === null || validUid(result.winner))
        && (result.draw === null || typeof result.draw === 'boolean');
    case 'skipOfflineTurn':
      return hasExactKeys(result, [
        'type', 'roomId', 'generation', 'revision', 'phase', 'skippedPlayerId',
        'currentTurn', 'turnNumber',
      ])
        && result.phase === GamePhase.PLAY
        && validUid(result.skippedPlayerId)
        && validUid(result.currentTurn)
        && result.currentTurn !== result.skippedPlayerId
        && isSafeIntegerInRange(result.turnNumber, 2, Number.MAX_SAFE_INTEGER);
    case 'leaveRoom':
      return hasExactKeys(result, [
        'type', 'roomId', 'generation', 'revision', 'phase', 'closed', 'ownerId', 'remainingMembers',
      ])
        && Object.values(GamePhase).includes(result.phase as GamePhase)
        && typeof result.closed === 'boolean'
        && validUid(result.ownerId)
        && isSafeIntegerInRange(result.remainingMembers, 0, state.lobby.maxPlayers);
    case 'restartMatch':
      return hasExactKeys(result, [
        'type', 'roomId', 'generation', 'revision', 'phase', 'currentTurn', 'matchNumber',
      ])
        && result.phase === GamePhase.SETUP
        && validUid(result.currentTurn)
        && isSafeIntegerInRange(result.matchNumber, 0, Number.MAX_SAFE_INTEGER);
    case 'closeRoom':
      return hasExactKeys(result, ['type', 'roomId', 'generation', 'revision', 'closed'])
        && result.closed === true;
    default:
      return false;
  }
}

function assertValidCurrentState(state: MazeAuthorityState): void {
  if (!isPlainRecord(state)
    || !hasExactKeys(state, ['meta', 'lobby', 'ruleSnapshot', 'gameState', 'receipts'])
    || !isPlainRecord(state.meta)
    || !hasExactKeys(state.meta, [
      'schemaVersion', 'roomId', 'generation', 'revision', 'createdAt', 'updatedAt',
    ])
    || state.meta.schemaVersion !== MAZE_AUTHORITY_SCHEMA_VERSION
    || !validFirebaseIdentifier(state.meta.roomId, 8, MAX_ROOM_ID_LENGTH)
    || !isSafeIntegerInRange(state.meta.generation, 1, Number.MAX_SAFE_INTEGER)
    || !isSafeIntegerInRange(state.meta.revision, 1, Number.MAX_SAFE_INTEGER)
    || !validTimestamp(state.meta.createdAt)
    || !validTimestamp(state.meta.updatedAt)
    || state.meta.updatedAt < state.meta.createdAt
    || !isPlainRecord(state.lobby)
    || !hasExactKeys(state.lobby, ['name', 'ownerId', 'maxPlayers', 'status', 'members'])
    || !validRoomName(state.lobby.name)
    || !validUid(state.lobby.ownerId)
    || !isSafeIntegerInRange(state.lobby.maxPlayers, 2, 4)
    || !['waiting', 'playing', 'ended', 'closed'].includes(state.lobby.status)
    || !isPlainRecord(state.lobby.members)
    || !isValidGameRuleSnapshot(state.ruleSnapshot)
    || state.ruleSnapshot.version !== GAME_RULES_VERSION
    || !isPlainRecord(state.gameState)
    || state.gameState.rulesVersion !== GAME_RULES_VERSION
    || !Object.values(GamePhase).includes(state.gameState.phase)
    || !isPlainRecord(state.gameState.players)
    || !isPlainRecord(state.gameState.maps)
    || !isPlainRecord(state.receipts)
    || !hasExactKeys(state.receipts, ['order', 'byId'])
    || !isDenseArray(state.receipts.order, MAZE_AUTHORITY_MAX_RECEIPTS)
    || !isPlainRecord(state.receipts.byId)) {
    fail('data-loss', 'authority-state-shape', 'The stored Maze Authority state is malformed.');
  }

  const memberEntries = Object.entries(state.lobby.members);
  const memberIds = memberEntries.map(([uid]) => uid);
  const playerEntries = Object.entries(state.gameState.players);
  const playerIds = playerEntries.map(([uid]) => uid);
  const slots = new Set<number>();
  if (memberEntries.length > state.lobby.maxPlayers) {
    fail('data-loss', 'authority-members', 'The stored Maze Authority membership is inconsistent.');
  }
  for (const [uid, member] of memberEntries) {
    if (!validUid(uid)
      || !isPlainRecord(member)
      || !hasExactKeys(member, ['uid', 'slot', 'joinedAt'])
      || member.uid !== uid
      || !isSafeIntegerInRange(member.slot, 0, state.lobby.maxPlayers - 1)
      || !validTimestamp(member.joinedAt)
      || slots.has(member.slot)) {
      fail('data-loss', 'authority-member-entry', 'A stored Maze Authority member is malformed.');
    }
    slots.add(member.slot);
  }
  if (playerEntries.some(([uid, player]) => !validUid(uid) || !validPlayerEnvelope(player, uid))) {
    fail('data-loss', 'authority-player-entry', 'A stored Maze Authority player is malformed.');
  }

  const turnOrder = state.gameState.turnOrder;
  if (!isDenseArray(turnOrder, state.lobby.maxPlayers)
    || turnOrder.some((uid) => !validUid(uid))
    || !sameIdentifierSet(turnOrder, playerIds)) {
    fail('data-loss', 'authority-turn-order', 'The stored Maze Authority turn order is inconsistent.');
  }

  const mapIds = Object.keys(state.gameState.maps);
  if (mapIds.some((uid) => !validUid(uid))) {
    fail('data-loss', 'authority-map-roster', 'A stored Maze Authority map owner is malformed.');
  }

  if (state.lobby.status === 'closed') {
    const tombstoneKeys = [
      'rulesVersion', 'matchNumber', 'phase', 'currentTurn', 'turnOrder', 'players', 'maps', 'winner', 'draw',
    ];
    if (memberIds.length !== 0
      || playerIds.length !== 0
      || mapIds.length !== 0
      || state.gameState.phase !== GamePhase.SETUP
      || state.gameState.currentTurn !== null
      || state.gameState.winner !== null
      || state.gameState.draw !== null
      || !hasExactKeys(state.gameState as unknown as Record<string, unknown>, tombstoneKeys)
      || !isSafeIntegerInRange(state.gameState.matchNumber, 0, Number.MAX_SAFE_INTEGER)) {
      fail('data-loss', 'authority-closed-tombstone', 'The closed room tombstone is malformed.');
    }
  } else {
    if (memberIds.length === 0 && state.gameState.phase !== GamePhase.END) {
      fail('data-loss', 'authority-members', 'An open room must retain an active member.');
    }
    if (memberIds.length > 0
      && !Object.prototype.hasOwnProperty.call(state.lobby.members, state.lobby.ownerId)) {
      fail('data-loss', 'authority-owner', 'The stored Maze Authority owner is not an active member.');
    }
    if (state.gameState.phase === GamePhase.SETUP) {
      if (!sameIdentifierSet(playerIds, memberIds)
        || mapIds.some((uid) => !memberIds.includes(uid))
        || !validUid(state.gameState.currentTurn)
        || !memberIds.includes(state.gameState.currentTurn)) {
        fail('data-loss', 'authority-setup-roster', 'The setup roster does not match room membership.');
      }
    } else {
      if (playerIds.length < 2
        || playerIds.length > state.lobby.maxPlayers
        || memberIds.some((uid) => !playerIds.includes(uid))
        || !sameIdentifierSet(mapIds, playerIds)
        || !isPlainRecord(state.gameState.assignments)
        || !sameIdentifierSet(Object.keys(state.gameState.assignments), playerIds)
        || Object.values(state.gameState.assignments).some(
          (mapOwnerId) => !validUid(mapOwnerId) || !playerIds.includes(mapOwnerId),
        )
        || (state.gameState.phase === GamePhase.PLAY
          && playerIds.some((uid) => !memberIds.includes(uid) && !state.gameState.players[uid].hasLeft))) {
        fail('data-loss', 'authority-match-roster', 'The immutable match roster is inconsistent.');
      }
    }
  }

  if (state.lobby.status !== 'closed') {
    const expectedStatus = state.gameState.phase === GamePhase.SETUP
      ? 'waiting'
      : state.gameState.phase === GamePhase.PLAY
        ? 'playing'
        : 'ended';
    if (state.lobby.status !== expectedStatus) {
      fail('data-loss', 'authority-phase-status', 'The room phase and status are inconsistent.');
    }
  }

  const receiptIds = state.receipts.order;
  if (new Set(receiptIds).size !== receiptIds.length
    || Object.keys(state.receipts.byId).length !== receiptIds.length
    || receiptIds.some((commandId) => !Object.prototype.hasOwnProperty.call(state.receipts.byId, commandId))) {
    fail('data-loss', 'authority-receipt-ledger', 'The Maze Authority receipt ledger is inconsistent.');
  }
  for (const commandId of receiptIds) {
    const receipt = state.receipts.byId[commandId];
    if (!validFirebaseIdentifier(commandId, 8, MAX_COMMAND_ID_LENGTH)
      || !isPlainRecord(receipt)
      || !hasExactKeys(receipt, [
        'actorId', 'payloadHash', 'commandType', 'generation', 'revision', 'result',
      ])
      || !validUid(receipt.actorId)
      || typeof receipt.payloadHash !== 'string'
      || !SHA256_HEX.test(receipt.payloadHash)
      || ![
        'createRoom', 'joinRoom', 'submitMap', 'resetMap', 'startMatch', 'turn', 'forfeit',
        'skipOfflineTurn', 'leaveRoom', 'restartMatch', 'closeRoom',
      ]
        .includes(receipt.commandType)
      || receipt.generation !== state.meta.generation
      || !isSafeIntegerInRange(receipt.revision, 1, state.meta.revision)
      || !isPlainRecord(receipt.result)
      || !validReceiptResult(
        receipt.result,
        receipt.commandType,
        state,
        receipt,
      )) {
      fail('data-loss', 'authority-receipt', 'A stored Maze Authority receipt is malformed.');
    }
  }
  const latestReceiptId = receiptIds[receiptIds.length - 1];
  if (!latestReceiptId || state.receipts.byId[latestReceiptId].revision !== state.meta.revision) {
    fail('data-loss', 'authority-latest-receipt', 'The latest receipt does not match the authority revision.');
  }
}

function needsRealtimeDatabaseMaterialization(value: unknown): boolean {
  if (!isPlainRecord(value) || !isPlainRecord(value.gameState)) return false;
  const gameState = value.gameState;
  const closed = isPlainRecord(value.lobby) && value.lobby.status === 'closed';
  if (!Object.prototype.hasOwnProperty.call(gameState, 'maps')
    || !Object.prototype.hasOwnProperty.call(gameState, 'winner')
    || !Object.prototype.hasOwnProperty.call(gameState, 'draw')
    || ((gameState.phase === GamePhase.END || closed)
      && !Object.prototype.hasOwnProperty.call(gameState, 'currentTurn'))
    || (closed
      && (!Object.prototype.hasOwnProperty.call(gameState, 'players')
        || !Object.prototype.hasOwnProperty.call(gameState, 'turnOrder')
        || !Object.prototype.hasOwnProperty.call(value.lobby as Record<string, unknown>, 'members')))
    || (isPlainRecord(value.lobby)
      && value.lobby.status === 'ended'
      && !Object.prototype.hasOwnProperty.call(value.lobby, 'members'))) {
    return true;
  }
  if (isPlainRecord(gameState.maps)) {
    for (const map of Object.values(gameState.maps)) {
      if (isPlainRecord(map)
        && (!Object.prototype.hasOwnProperty.call(map, 'obstacles')
          || (!Object.prototype.hasOwnProperty.call(map, 'items')
            && !Object.prototype.hasOwnProperty.call(map, 'item')))) {
        return true;
      }
    }
  }
  if (!isPlainRecord(value.receipts) || !isPlainRecord(value.receipts.byId)) return false;
  for (const receipt of Object.values(value.receipts.byId)) {
    if (!isPlainRecord(receipt) || !isPlainRecord(receipt.result)) continue;
    const result = receipt.result;
    if ((result.type === 'turn' || result.type === 'forfeit')
      && (!Object.prototype.hasOwnProperty.call(result, 'currentTurn')
        || !Object.prototype.hasOwnProperty.call(result, 'winner')
        || !Object.prototype.hasOwnProperty.call(result, 'draw'))) {
      return true;
    }
    if (result.type === 'turn' && isPlainRecord(result.outcome)) {
      if (result.outcome.type === 'move'
        && !Object.prototype.hasOwnProperty.call(result.outcome, 'consumedItemIndex')) return true;
      if (result.outcome.type === 'radar'
        && !Object.prototype.hasOwnProperty.call(result.outcome, 'found')) return true;
      if (result.outcome.type === 'skill' && result.outcome.skillId === 'scoutPulse'
        && !Object.prototype.hasOwnProperty.call(result.outcome, 'found')) return true;
    }
  }
  return false;
}

export function parseMazeAuthorityState(value: unknown): MazeAuthorityState {
  const state = cloneJson(value) as MazeAuthorityState;

  // Realtime Database removes null values, empty objects, and empty arrays.
  // Materialize the canonical in-memory shape before validation/reduction so a
  // state read after a successful transaction behaves exactly like the state
  // that was committed in that transaction.
  if (isPlainRecord(state) && isPlainRecord(state.lobby)
    && (state.lobby.status === 'closed' || state.lobby.status === 'ended')
    && !Object.prototype.hasOwnProperty.call(state.lobby, 'members')) {
    state.lobby.members = {};
  }

  if (isPlainRecord(state) && isPlainRecord(state.gameState)) {
    const closed = isPlainRecord(state.lobby) && state.lobby.status === 'closed';
    if (!Object.prototype.hasOwnProperty.call(state.gameState, 'maps')) {
      state.gameState.maps = {};
    }
    if (!Object.prototype.hasOwnProperty.call(state.gameState, 'winner')) {
      state.gameState.winner = null;
    }
    if (!Object.prototype.hasOwnProperty.call(state.gameState, 'draw')) {
      state.gameState.draw = null;
    }
    if ((state.gameState.phase === GamePhase.END || closed)
      && !Object.prototype.hasOwnProperty.call(state.gameState, 'currentTurn')) {
      state.gameState.currentTurn = null;
    }
    if (closed && !Object.prototype.hasOwnProperty.call(state.gameState, 'players')) {
      state.gameState.players = {};
    }
    if (closed && !Object.prototype.hasOwnProperty.call(state.gameState, 'turnOrder')) {
      state.gameState.turnOrder = [];
    }
    if (state.gameState.phase !== GamePhase.SETUP) {
      if (!Object.prototype.hasOwnProperty.call(state.gameState, 'collisionWalls')) {
        state.gameState.collisionWalls = {};
      }
      if (!Object.prototype.hasOwnProperty.call(state.gameState, 'revealedWallsByPlayer')) {
        state.gameState.revealedWallsByPlayer = {};
      }
      if (!Object.prototype.hasOwnProperty.call(state.gameState, 'visionEffectsByPlayer')) {
        state.gameState.visionEffectsByPlayer = {};
      }
      if (isPlainRecord(state.gameState.itemState)) {
        for (const entry of Object.values(state.gameState.itemState)) {
          if (!isPlainRecord(entry)) continue;
          if (!Object.prototype.hasOwnProperty.call(entry, 'consumed')) entry.consumed = {};
          if (isPlainRecord(entry.mazeSkill)
            && !Object.prototype.hasOwnProperty.call(entry.mazeSkill, 'consumed')) {
            entry.mazeSkill.consumed = {};
          }
        }
      }
    }

    if (isPlainRecord(state.gameState.maps)) {
      for (const map of Object.values(state.gameState.maps)) {
        if (!isPlainRecord(map)) continue;
        if (!Object.prototype.hasOwnProperty.call(map, 'obstacles')) map.obstacles = [];
        if (!Object.prototype.hasOwnProperty.call(map, 'items')
          && !Object.prototype.hasOwnProperty.call(map, 'item')) {
          map.items = [];
        }
      }
    }
  }

  if (isPlainRecord(state) && isPlainRecord(state.receipts)
    && isPlainRecord(state.receipts.byId)) {
    for (const receipt of Object.values(state.receipts.byId)) {
      if (!isPlainRecord(receipt) || !isPlainRecord(receipt.result)) continue;
      const result = receipt.result;
      if (result.type === 'turn' || result.type === 'forfeit') {
        if (!Object.prototype.hasOwnProperty.call(result, 'currentTurn')) result.currentTurn = null;
        if (!Object.prototype.hasOwnProperty.call(result, 'winner')) result.winner = null;
        if (!Object.prototype.hasOwnProperty.call(result, 'draw')) result.draw = null;
      }
      if (result.type === 'turn' && isPlainRecord(result.outcome)) {
        if (result.outcome.type === 'move'
          && !Object.prototype.hasOwnProperty.call(result.outcome, 'consumedItemIndex')) {
          result.outcome.consumedItemIndex = null;
        }
        if (result.outcome.type === 'radar'
          && !Object.prototype.hasOwnProperty.call(result.outcome, 'found')) {
          result.outcome.found = [];
        }
        if (result.outcome.type === 'skill' && result.outcome.skillId === 'scoutPulse'
          && !Object.prototype.hasOwnProperty.call(result.outcome, 'found')) {
          result.outcome.found = [];
        }
      }
    }
  }

  assertValidCurrentState(state);
  return state;
}

function requireMember(state: MazeAuthorityState, actorId: string): MazeAuthorityMember {
  const member = Object.prototype.hasOwnProperty.call(state.lobby.members, actorId)
    ? state.lobby.members[actorId]
    : undefined;
  if (!member) fail('permission-denied', 'not-a-member', 'The actor is not a room member.');
  return member;
}

function requireSetup(state: MazeAuthorityState): void {
  if (state.gameState.phase !== GamePhase.SETUP) {
    fail('failed-precondition', 'not-setup', 'The room is not in map setup.');
  }
}

function nextRevision(state: MazeAuthorityState): number {
  if (state.meta.revision >= Number.MAX_SAFE_INTEGER) {
    fail('resource-exhausted', 'revision-exhausted', 'The room revision is exhausted.');
  }
  return state.meta.revision + 1;
}

function resultBase(
  type: MazeAuthorityCommandType,
  state: MazeAuthorityState,
): MazeAuthorityResultBase {
  return {
    type,
    roomId: state.meta.roomId,
    generation: state.meta.generation,
    revision: state.meta.revision,
  };
}

function appendReceipt(
  state: MazeAuthorityState,
  command: MazeAuthorityReceiptCommand,
  actorId: string,
  payloadHash: string,
  result: MazeAuthorityCommandResult,
): MazeAuthorityState {
  const order = [...state.receipts.order, command.commandId];
  const byId: Record<string, MazeAuthorityReceipt> = {
    ...state.receipts.byId,
    [command.commandId]: {
      actorId,
      payloadHash,
      commandType: command.type,
      generation: state.meta.generation,
      revision: state.meta.revision,
      result: cloneJson(result),
    },
  };
  while (order.length > MAZE_AUTHORITY_MAX_RECEIPTS) {
    const evicted = order.shift();
    if (evicted) delete byId[evicted];
  }
  return { ...state, receipts: { order, byId } };
}

function replayReceipt(
  state: MazeAuthorityState,
  command: MazeAuthorityReceiptCommand,
  actorId: string,
  payloadHash: string,
): MazeAuthorityReduction | null {
  const receipt = Object.prototype.hasOwnProperty.call(state.receipts.byId, command.commandId)
    ? state.receipts.byId[command.commandId]
    : undefined;
  if (!receipt) return null;
  if (receipt.actorId !== actorId
    || receipt.payloadHash !== payloadHash
    || receipt.commandType !== command.type) {
    fail(
      'already-exists',
      'idempotency-conflict',
      'The command id is already bound to a different actor or payload.',
    );
  }
  return { state, result: cloneJson(receipt.result), replayed: true };
}

function normalizedActorProfile(profile: MazeAuthorityActorProfile | undefined): MazeAuthorityActorProfile {
  const displayName = typeof profile?.displayName === 'string'
    ? profile.displayName.trim().slice(0, 50)
    : '';
  const photoURL = typeof profile?.photoURL === 'string'
    && profile.photoURL.length <= 2_048
    && /^https:\/\/lh3\.googleusercontent\.com\//u.test(profile.photoURL)
    ? profile.photoURL
    : undefined;
  return {
    displayName: displayName || '플레이어',
    ...(photoURL ? { photoURL } : {}),
  };
}

function initialPlayer(uid: string, profile?: MazeAuthorityActorProfile): Player {
  const normalized = normalizedActorProfile(profile);
  return {
    id: uid,
    displayName: normalized.displayName,
    ...(normalized.photoURL ? { photoURL: normalized.photoURL } : {}),
    position: { row: 0, col: 0 },
    isReady: false,
  };
}

function createRoomState(
  command: CreateRoomCommand,
  actorId: string,
  now: number,
  actorProfile?: MazeAuthorityActorProfile,
): MazeAuthorityState {
  const ruleSnapshot = createCanonicalGameRuleSnapshot();
  return {
    meta: {
      schemaVersion: MAZE_AUTHORITY_SCHEMA_VERSION,
      roomId: command.roomId,
      generation: MAZE_AUTHORITY_INITIAL_GENERATION,
      revision: 1,
      createdAt: now,
      updatedAt: now,
    },
    lobby: {
      name: command.name,
      ownerId: actorId,
      maxPlayers: command.maxPlayers,
      status: 'waiting',
      members: {
        [actorId]: { uid: actorId, slot: 0, joinedAt: now },
      },
    },
    ruleSnapshot,
    gameState: {
      rulesVersion: GAME_RULES_VERSION,
      matchNumber: 0,
      phase: GamePhase.SETUP,
      currentTurn: actorId,
      turnOrder: [actorId],
      players: { [actorId]: initialPlayer(actorId, actorProfile) },
      maps: {},
      winner: null,
      draw: null,
    },
    receipts: { order: [], byId: {} },
  };
}

function withAdvancedMeta(state: MazeAuthorityState, now: number): MazeAuthorityState {
  return {
    ...state,
    meta: {
      ...state.meta,
      revision: nextRevision(state),
      updatedAt: Math.max(now, state.meta.updatedAt),
    },
  };
}

function reduceJoinRoom(
  state: MazeAuthorityState,
  command: JoinRoomCommand,
  actorId: string,
  now: number,
  actorProfile?: MazeAuthorityActorProfile,
): { state: MazeAuthorityState; result: JoinRoomResult } {
  requireSetup(state);
  if (Object.prototype.hasOwnProperty.call(state.lobby.members, actorId)) {
    fail('already-exists', 'already-a-member', 'The actor has already joined this room.');
  }
  const members = Object.values(state.lobby.members);
  if (members.length >= state.lobby.maxPlayers) {
    fail('resource-exhausted', 'room-full', 'The room has no open player slot.');
  }
  const occupied = new Set(members.map((member) => member.slot));
  const slot = Array.from({ length: state.lobby.maxPlayers }, (_, index) => index)
    .find((candidate) => !occupied.has(candidate));
  if (slot === undefined) fail('data-loss', 'room-slots', 'The room slot ledger is inconsistent.');

  const next = withAdvancedMeta(cloneJson(state), now);
  next.lobby.members[actorId] = { uid: actorId, slot, joinedAt: now };
  next.gameState.players[actorId] = initialPlayer(actorId, actorProfile);
  next.gameState.turnOrder = getTurnOrder(
    next.gameState.players,
    [...(next.gameState.turnOrder || []), actorId],
  );
  return { state: next, result: { ...resultBase('joinRoom', next), type: 'joinRoom', slot } };
}

function reduceSubmitMap(
  state: MazeAuthorityState,
  command: SubmitMapCommand,
  actorId: string,
  now: number,
): { state: MazeAuthorityState; result: SubmitMapResult } {
  requireSetup(state);
  requireMember(state, actorId);
  if (command.map.skillLoadout !== 'scoutPulse') {
    fail(
      'failed-precondition',
      'skill-loadout-retired',
      'Custom maze skill loadouts have been retired.',
    );
  }
  if (getMapItems(command.map).some(
    (item) => item.type === 'radar' || item.type === 'collapseWall' || item.type === 'mirrorWall',
  )) {
    fail(
      'failed-precondition',
      'retired-wall-item',
      'This retired item can no longer be submitted in new maps.',
    );
  }
  if (!isValidNewMapForRuleSnapshot(command.map, state.ruleSnapshot)) {
    fail('failed-precondition', 'invalid-v3-map', 'The submitted map violates the room V3 rules.');
  }
  const next = withAdvancedMeta(cloneJson(state), now);
  const maps = next.gameState.maps || {};
  maps[actorId] = cloneJson(command.map);
  next.gameState.maps = maps;
  next.gameState.players[actorId] = {
    ...next.gameState.players[actorId],
    isReady: true,
  };
  return {
    state: next,
    result: { ...resultBase('submitMap', next), type: 'submitMap', ready: true },
  };
}

function reduceResetMap(
  state: MazeAuthorityState,
  actorId: string,
  now: number,
): { state: MazeAuthorityState; result: ResetMapResult } {
  requireSetup(state);
  requireMember(state, actorId);
  if (!Object.prototype.hasOwnProperty.call(state.gameState.maps, actorId)) {
    fail('failed-precondition', 'map-not-submitted', 'The player has no submitted map to reset.');
  }

  const next = withAdvancedMeta(cloneJson(state), now);
  delete next.gameState.maps?.[actorId];
  next.gameState.players[actorId] = {
    ...next.gameState.players[actorId],
    isReady: false,
  };
  return {
    state: next,
    result: { ...resultBase('resetMap', next), type: 'resetMap', ready: false },
  };
}

function reduceStartMatch(
  state: MazeAuthorityState,
  actorId: string,
  now: number,
): { state: MazeAuthorityState; result: StartMatchResult } {
  requireSetup(state);
  requireMember(state, actorId);
  if (state.lobby.ownerId !== actorId) {
    fail('permission-denied', 'owner-required', 'Only the room owner can start the match.');
  }

  const gameState = cloneJson(state.gameState);
  const maps = gameState.maps || {};
  const playerIds = getTurnOrder(gameState.players || {}, gameState.turnOrder);
  if (playerIds.length < 2) {
    fail('failed-precondition', 'not-enough-players', 'At least two players are required.');
  }
  if (!playerIds.every((uid) => gameState.players[uid]?.isReady && maps[uid])) {
    fail('failed-precondition', 'players-not-ready', 'Every player must submit a map.');
  }
  if (!playerIds.every((uid) => isValidNewMapForRuleSnapshot(maps[uid], state.ruleSnapshot))) {
    fail(
      'failed-precondition',
      'stored-map-retired',
      'A stored player map contains retired gameplay content and cannot start a new match.',
    );
  }

  const assignments: Record<string, string> = {};
  playerIds.forEach((runnerId, index) => {
    const mapOwnerId = playerIds[(index + 1) % playerIds.length];
    const start = maps[mapOwnerId].startPosition;
    assignments[runnerId] = mapOwnerId;
    gameState.players[runnerId] = {
      ...gameState.players[runnerId],
      position: cloneJson(start),
      positionHistory: [cloneJson(start)],
      moves: 0,
      finished: false,
      forfeited: false,
    };
  });

  const turnOrder = getTurnOrder(gameState.players, playerIds);
  const preferredFirst = gameState.currentTurn && gameState.players[gameState.currentTurn]
    ? gameState.currentTurn
    : null;
  const currentTurn = preferredFirst || getFirstTurnPlayerId(gameState.players, turnOrder);
  if (!currentTurn) fail('data-loss', 'missing-first-turn', 'The match has no eligible first player.');

  // Runtime item state is created lazily only when an effect is actually used.
  // This avoids reviving the retired per-player skill state and round-trips
  // cleanly through RTDB, which elides empty objects.
  delete gameState.itemState;
  const nextGameState: GameState = {
    ...gameState,
    rulesVersion: state.ruleSnapshot.version,
    matchNumber: (gameState.matchNumber || 0) + 1,
    phase: GamePhase.PLAY,
    assignments,
    currentTurn,
    turnOrder,
    turnNumber: 1,
    collisionWalls: {},
    revealedWallsByPlayer: {},
    visionEffectsByPlayer: {},
    winner: null,
    draw: null,
    turnMessage: `${gameState.players[currentTurn]?.displayName || '플레이어'}의 턴`,
    turnMessageTimestamp: now,
  };
  const next = withAdvancedMeta(cloneJson(state), now);
  next.gameState = cloneJson(nextGameState);
  next.lobby.status = 'playing';
  return {
    state: next,
    result: {
      ...resultBase('startMatch', next),
      type: 'startMatch',
      phase: GamePhase.PLAY,
      currentTurn,
      matchNumber: nextGameState.matchNumber as number,
    },
  };
}

function reduceTurn(
  state: MazeAuthorityState,
  command: TurnCommand,
  actorId: string,
  now: number,
): { state: MazeAuthorityState; result: TurnResult } {
  requireMember(state, actorId);
  if (state.gameState.phase !== GamePhase.PLAY) {
    fail('failed-precondition', 'not-playing', 'The match is not active.');
  }
  if (command.action.type !== 'move') {
    fail(
      'failed-precondition',
      command.action.type === 'radar' ? 'radar-retired' : 'skill-retired',
      'Only movement actions are supported.',
    );
  }
  const resolution = resolveTurnAction(cloneJson(state.gameState), actorId, command.action, now);
  if (!resolution) {
    fail('failed-precondition', 'turn-rejected', 'The V3 engine rejected the turn action.');
  }
  const next = withAdvancedMeta(cloneJson(state), now);
  next.gameState = cloneJson(resolution.state);
  if (next.gameState.phase === GamePhase.END) next.lobby.status = 'ended';
  return {
    state: next,
    result: {
      ...resultBase('turn', next),
      type: 'turn',
      phase: next.gameState.phase,
      currentTurn: next.gameState.currentTurn ?? null,
      winner: next.gameState.winner ?? null,
      draw: next.gameState.draw ?? null,
      outcome: cloneJson(resolution.outcome),
    },
  };
}

function orderedMemberIds(state: MazeAuthorityState): string[] {
  return Object.values(state.lobby.members)
    .slice()
    .sort((left, right) => left.slot - right.slot)
    .map((member) => member.uid);
}

function transferOwnerAfterLeave(state: MazeAuthorityState, actorId: string): void {
  if (state.lobby.ownerId !== actorId) return;
  const nextOwnerId = orderedMemberIds(state)[0];
  if (nextOwnerId) state.lobby.ownerId = nextOwnerId;
}

function createClosedTombstone(state: MazeAuthorityState): MazeAuthorityState {
  const matchNumber = state.gameState.matchNumber ?? 0;
  return {
    ...state,
    lobby: {
      ...state.lobby,
      status: 'closed',
      members: {},
    },
    gameState: {
      rulesVersion: state.ruleSnapshot.version,
      matchNumber,
      phase: GamePhase.SETUP,
      currentTurn: null,
      turnOrder: [],
      players: {},
      maps: {},
      winner: null,
      draw: null,
    },
  };
}

function reduceLeaveRoom(
  state: MazeAuthorityState,
  actorId: string,
  now: number,
): { state: MazeAuthorityState; result: LeaveRoomResult } {
  requireMember(state, actorId);
  if (state.gameState.phase === GamePhase.PLAY) {
    fail(
      'failed-precondition',
      'active-match-leave-disabled',
      'Leaving is disabled during an active match. Disconnects are tracked as presence only.',
    );
  }
  let next = withAdvancedMeta(cloneJson(state), now);
  delete next.lobby.members[actorId];

  if (state.gameState.phase === GamePhase.SETUP) {
    delete next.gameState.players[actorId];
    delete next.gameState.maps?.[actorId];
    next.gameState.turnOrder = (next.gameState.turnOrder || []).filter((uid) => uid !== actorId);
    if (Object.keys(next.lobby.members).length === 0) {
      next = createClosedTombstone(next);
    } else {
      transferOwnerAfterLeave(next, actorId);
      if (next.gameState.currentTurn === actorId) {
        next.gameState.currentTurn = orderedMemberIds(next)[0];
      }
    }
  } else {
    // Terminal results, maps, and the immutable match roster are historical
    // settlement input. Leaving END only revokes live membership.
    transferOwnerAfterLeave(next, actorId);
  }

  const remainingMembers = Object.keys(next.lobby.members).length;
  return {
    state: next,
    result: {
      ...resultBase('leaveRoom', next),
      type: 'leaveRoom',
      phase: next.gameState.phase,
      closed: next.lobby.status === 'closed',
      ownerId: next.lobby.ownerId,
      remainingMembers,
    },
  };
}

function resetPlayerForSetup(player: Player): Player {
  const reset: Player = {
    ...cloneJson(player),
    position: { row: 0, col: 0 },
    isReady: false,
    finished: false,
    forfeited: false,
    hasLeft: false,
    moves: 0,
  };
  delete reset.finishMoves;
  delete reset.positionHistory;
  delete reset.lastPosition;
  delete reset.isOnline;
  delete reset.lastSeen;
  return reset;
}

function reduceRestartMatch(
  state: MazeAuthorityState,
  actorId: string,
  now: number,
): { state: MazeAuthorityState; result: RestartMatchResult } {
  if (state.lobby.ownerId !== actorId) {
    fail('permission-denied', 'owner-required', 'Only the room owner can restart the match.');
  }
  if (state.gameState.phase !== GamePhase.END) {
    fail('failed-precondition', 'not-ended', 'Only an ended match can be restarted.');
  }
  if (state.meta.generation >= Number.MAX_SAFE_INTEGER) {
    fail('resource-exhausted', 'generation-exhausted', 'The room generation is exhausted.');
  }

  const playerIds = orderedMemberIds(state);
  if (playerIds.length === 0) {
    fail('failed-precondition', 'no-members-to-restart', 'No active members remain for a rematch.');
  }
  const players = Object.fromEntries(playerIds.map((uid) => {
    const player = state.gameState.players[uid];
    if (!player) fail('data-loss', 'missing-player', 'A rematch member has no historical player.');
    return [uid, resetPlayerForSetup(player)];
  }));
  const currentTurn = Object.prototype.hasOwnProperty.call(
    state.lobby.members,
    state.lobby.ownerId,
  )
    ? state.lobby.ownerId
    : playerIds[0];
  const matchNumber = state.gameState.matchNumber ?? 0;
  const next: MazeAuthorityState = {
    ...cloneJson(state),
    meta: {
      ...cloneJson(state.meta),
      generation: state.meta.generation + 1,
      revision: 1,
      updatedAt: now,
    },
    lobby: {
      ...cloneJson(state.lobby),
      status: 'waiting',
    },
    gameState: {
      rulesVersion: state.ruleSnapshot.version,
      matchNumber,
      phase: GamePhase.SETUP,
      currentTurn,
      turnOrder: playerIds,
      players,
      maps: {},
      winner: null,
      draw: null,
    },
    receipts: { order: [], byId: {} },
  };
  return {
    state: next,
    result: {
      ...resultBase('restartMatch', next),
      type: 'restartMatch',
      phase: GamePhase.SETUP,
      currentTurn,
      matchNumber,
    },
  };
}

function reduceCloseRoom(
  state: MazeAuthorityState,
  actorId: string,
  now: number,
): { state: MazeAuthorityState; result: CloseRoomResult } {
  if (state.lobby.ownerId !== actorId) {
    fail('permission-denied', 'owner-required', 'Only the room owner can close the room.');
  }
  if (state.gameState.phase === GamePhase.PLAY) {
    fail('failed-precondition', 'match-in-progress', 'An active match cannot be closed.');
  }
  const next = createClosedTombstone(withAdvancedMeta(cloneJson(state), now));
  return {
    state: next,
    result: { ...resultBase('closeRoom', next), type: 'closeRoom', closed: true },
  };
}

/**
 * Advances an expired offline player's turn without changing any runner state
 * or settling the match. This entry point is intentionally separate from the
 * public command reducer so browsers cannot manufacture timeout transitions.
 */
export function reduceMazeAuthorityOfflineTurn(
  currentState: MazeAuthorityState | null | undefined,
  targetPlayerId: string,
  rawCommand: unknown,
  now: number,
): { state: MazeAuthorityState; result: MazeAuthorityOfflineTurnResult; replayed: boolean } {
  if (!validUid(targetPlayerId)) {
    fail('invalid-argument', 'actor-id', 'The offline target player id is malformed.');
  }
  if (!validTimestamp(now)) {
    fail('invalid-argument', 'server-time', 'The trusted server time is malformed.');
  }
  const command = parseMazeAuthorityOfflineTurnCommand(rawCommand);
  const payloadHash = commandPayloadHash(targetPlayerId, command);

  if (currentState == null) {
    fail('not-found', 'room-not-found', 'The authoritative room does not exist.');
  }
  if (needsRealtimeDatabaseMaterialization(currentState)) {
    currentState = parseMazeAuthorityState(currentState);
  } else {
    assertValidCurrentState(currentState);
  }
  if (currentState.meta.roomId !== command.roomId) {
    fail('failed-precondition', 'room-id-mismatch', 'The command targets a different room.');
  }
  const replay = replayReceipt(currentState, command, targetPlayerId, payloadHash);
  if (replay) {
    if (replay.result.type !== 'skipOfflineTurn') {
      fail('data-loss', 'offline-turn-receipt', 'The offline-turn receipt is inconsistent.');
    }
    return {
      state: replay.state,
      result: replay.result,
      replayed: true,
    };
  }
  if (currentState.lobby.status === 'closed') {
    fail('failed-precondition', 'room-closed', 'The authoritative room is closed.');
  }
  if (command.expectedGeneration !== currentState.meta.generation) {
    fail('failed-precondition', 'generation-mismatch', 'The room generation has changed.');
  }
  if (command.expectedRevision !== currentState.meta.revision) {
    fail('aborted', 'revision-mismatch', 'The room revision has changed.');
  }
  if (now < currentState.meta.updatedAt) {
    fail('failed-precondition', 'server-time-regression', 'Trusted server time moved backwards.');
  }
  requireMember(currentState, targetPlayerId);
  if (currentState.gameState.phase !== GamePhase.PLAY) {
    fail('failed-precondition', 'not-playing', 'The match is not active.');
  }
  if (currentState.gameState.currentTurn !== targetPlayerId) {
    fail('failed-precondition', 'turn-changed', 'The offline player no longer owns the turn.');
  }
  if (currentState.gameState.turnNumber !== command.turnNumber) {
    fail('failed-precondition', 'turn-number-changed', 'The offline turn identity has changed.');
  }
  const target = currentState.gameState.players[targetPlayerId];
  if (!target || target.finished || target.forfeited || target.hasLeft) {
    fail('failed-precondition', 'player-inactive', 'The offline player is no longer active.');
  }
  const currentTurnNumber = currentState.gameState.turnNumber;
  if (!isSafeIntegerInRange(currentTurnNumber, 1, Number.MAX_SAFE_INTEGER - 1)) {
    fail('resource-exhausted', 'turn-number-exhausted', 'The match turn counter is exhausted.');
  }
  const nextPlayerId = getNextTurnPlayerId(
    currentState.gameState.players,
    targetPlayerId,
    currentState.gameState.turnOrder,
  );
  if (!nextPlayerId || nextPlayerId === targetPlayerId) {
    fail(
      'failed-precondition',
      'no-other-active-runner',
      'No other active runner can receive the turn. The match must wait for reconnect.',
    );
  }

  let next = withAdvancedMeta(cloneJson(currentState), now);
  next.gameState.currentTurn = nextPlayerId;
  next.gameState.turnNumber = currentTurnNumber + 1;
  next.gameState.turnMessage = `${target.displayName || '플레이어'}의 연결 대기로 턴을 넘겼습니다. ${next.gameState.players[nextPlayerId]?.displayName || '플레이어'}의 턴`;
  next.gameState.turnMessageTimestamp = now;
  const result: MazeAuthorityOfflineTurnResult = {
    ...resultBase('skipOfflineTurn', next),
    type: 'skipOfflineTurn',
    phase: GamePhase.PLAY,
    skippedPlayerId: targetPlayerId,
    currentTurn: nextPlayerId,
    turnNumber: currentTurnNumber + 1,
  };
  next = appendReceipt(next, command, targetPlayerId, payloadHash, result);
  assertValidCurrentState(next);
  return { state: next, result, replayed: false };
}

function assertNever(value: never): never {
  return fail('data-loss', 'command-exhaustiveness', `Unhandled command: ${String(value)}`);
}

export function reduceMazeAuthorityCommand(
  currentState: MazeAuthorityState | null | undefined,
  actorId: string,
  rawCommand: unknown,
  now: number,
  actorProfile?: MazeAuthorityActorProfile,
): MazeAuthorityReduction {
  if (!validUid(actorId)) {
    fail('invalid-argument', 'actor-id', 'The authenticated actor id is malformed.');
  }
  if (!validTimestamp(now)) {
    fail('invalid-argument', 'server-time', 'The trusted server time is malformed.');
  }
  const command = parseMazeAuthorityCommand(rawCommand);
  const payloadHash = commandPayloadHash(actorId, command);

  if (currentState != null) {
    if (needsRealtimeDatabaseMaterialization(currentState)) {
      currentState = parseMazeAuthorityState(currentState);
    } else {
      assertValidCurrentState(currentState);
    }
    if (currentState.meta.roomId !== command.roomId) {
      fail('failed-precondition', 'room-id-mismatch', 'The command targets a different room.');
    }
    const replay = replayReceipt(currentState, command, actorId, payloadHash);
    if (replay) return replay;
    if (currentState.lobby.status === 'closed') {
      fail('failed-precondition', 'room-closed', 'The authoritative room is closed.');
    }
  }

  if (command.type === 'createRoom') {
    if (currentState != null) {
      fail('already-exists', 'room-exists', 'The authoritative room already exists.');
    }
    let state = createRoomState(command, actorId, now, actorProfile);
    const result: CreateRoomResult = {
      ...resultBase('createRoom', state),
      type: 'createRoom',
    };
    state = appendReceipt(state, command, actorId, payloadHash, result);
    assertValidCurrentState(state);
    return { state, result, replayed: false };
  }

  if (currentState == null) {
    fail('not-found', 'room-not-found', 'The authoritative room does not exist.');
  }
  if (command.expectedGeneration !== currentState.meta.generation) {
    fail('failed-precondition', 'generation-mismatch', 'The room generation has changed.');
  }
  if (command.expectedRevision !== currentState.meta.revision) {
    fail('aborted', 'revision-mismatch', 'The room revision has changed.');
  }
  if (now < currentState.meta.updatedAt) {
    fail('failed-precondition', 'server-time-regression', 'Trusted server time moved backwards.');
  }

  let mutation: { state: MazeAuthorityState; result: MazeAuthorityCommandResult };
  switch (command.type) {
    case 'joinRoom':
      mutation = reduceJoinRoom(currentState, command, actorId, now, actorProfile);
      break;
    case 'submitMap':
      mutation = reduceSubmitMap(currentState, command, actorId, now);
      break;
    case 'resetMap':
      mutation = reduceResetMap(currentState, actorId, now);
      break;
    case 'startMatch':
      mutation = reduceStartMatch(currentState, actorId, now);
      break;
    case 'turn':
      mutation = reduceTurn(currentState, command, actorId, now);
      break;
    case 'leaveRoom':
      mutation = reduceLeaveRoom(currentState, actorId, now);
      break;
    case 'restartMatch':
      mutation = reduceRestartMatch(currentState, actorId, now);
      break;
    case 'closeRoom':
      mutation = reduceCloseRoom(currentState, actorId, now);
      break;
    default:
      return assertNever(command);
  }

  const state = appendReceipt(
    mutation.state,
    command,
    actorId,
    payloadHash,
    mutation.result,
  );
  assertValidCurrentState(state);
  return { state, result: mutation.result, replayed: false };
}
