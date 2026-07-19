import { normalizeConsumed } from '../vendor/maze-engine/dist/lib/gameTurn';
import { getVisibleCollisionWalls } from '../vendor/maze-engine/dist/lib/gameUtils';
import {
  GamePhase,
  type CollisionWall,
  type Direction,
  type GameMap,
  type GameRuleSnapshot,
  type ItemType,
  type MapItem,
  type MazeSkillId,
  type Obstacle,
  type Position,
  type VisionEffect,
} from '../vendor/maze-engine/dist/types/game';
import {
  MAZE_AUTHORITY_SCHEMA_VERSION,
  MazeAuthorityDomainError,
  parseMazeAuthorityState,
  type MazeAuthorityLobby,
  type MazeAuthorityState,
} from './mazeAuthorityDomain';

export const MAZE_AUTHORITY_VIEW_VERSION = 1 as const;

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
];
const ITEM_TYPE_SET = new Set<ItemType>(ITEM_TYPES);
const WALL_ITEM_TYPE_SET = new Set<ItemType>([
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
const MAZE_SKILL_IDS: readonly MazeSkillId[] = ['scoutPulse', 'breach', 'anchor', 'dash'];
const MAZE_SKILL_ID_SET = new Set<MazeSkillId>(MAZE_SKILL_IDS);
const DIRECTIONS = new Set<Direction>(['up', 'down', 'left', 'right']);
const MAX_ITEM_STATE_INDEX = 15;

export interface MazeAuthorityLobbyMemberView {
  uid: string;
  slot: number;
}

export interface MazeAuthorityLobbyView {
  name: string;
  ownerId: string;
  maxPlayers: number;
  status: MazeAuthorityLobby['status'];
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

/** The only board geometry that is safe to publish while a match is active. */
export interface MazeAuthorityBoardBoundaryView {
  startPosition: Position;
  endPosition: Position;
}

export type MazeAuthorityMapView = MazeAuthorityBoardBoundaryView | GameMap;

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

function hasOwn(value: object, key: PropertyKey): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function clonePosition(position: Position): Position {
  return { row: position.row, col: position.col };
}

function cloneObstacle(obstacle: Obstacle): Obstacle {
  return {
    position: clonePosition(obstacle.position),
    direction: obstacle.direction,
  };
}

function projectMapItem(item: MapItem): MapItem {
  if (WALL_ITEM_TYPE_SET.has(item.type)) {
    return {
      type: item.type,
      ...(item.wallPosition ? { wallPosition: clonePosition(item.wallPosition) } : {}),
      ...(item.wallDirection ? { wallDirection: item.wallDirection } : {}),
      ...(item.type === 'windWall' && item.effectDirection
        ? { effectDirection: item.effectDirection }
        : {}),
    };
  }
  if (item.type === 'mine' || item.type === 'smoke') {
    return {
      type: item.type,
      ...(item.position ? { position: clonePosition(item.position) } : {}),
    };
  }
  if (item.type === 'wormhole') {
    return {
      type: item.type,
      ...(item.entrance ? { entrance: clonePosition(item.entrance) } : {}),
      ...(item.exit ? { exit: clonePosition(item.exit) } : {}),
    };
  }
  return { type: 'radar' };
}

function projectFullMap(map: GameMap): GameMap {
  const projected: GameMap = {
    startPosition: clonePosition(map.startPosition),
    endPosition: clonePosition(map.endPosition),
    obstacles: map.obstacles.map(cloneObstacle),
  };
  if (typeof map.rulesVersion === 'number') projected.rulesVersion = map.rulesVersion;
  if (map.items === null) projected.items = null;
  if (Array.isArray(map.items)) projected.items = map.items.map(projectMapItem);
  if (map.item === null) projected.item = null;
  if (map.item) projected.item = projectMapItem(map.item);
  if (map.skillLoadout === null) projected.skillLoadout = null;
  if (map.skillLoadout && MAZE_SKILL_ID_SET.has(map.skillLoadout)) {
    projected.skillLoadout = map.skillLoadout;
  }
  return projected;
}

function projectBoardBoundary(map: GameMap): MazeAuthorityBoardBoundaryView {
  return {
    startPosition: clonePosition(map.startPosition),
    endPosition: clonePosition(map.endPosition),
  };
}

function projectRuleNumberRecord(
  source: Readonly<Record<ItemType, number>>,
): Record<ItemType, number> {
  const projected = {} as Record<ItemType, number>;
  for (const itemType of ITEM_TYPES) projected[itemType] = source[itemType];
  return projected;
}

function projectRuleSnapshot(snapshot: GameRuleSnapshot): GameRuleSnapshot {
  return {
    version: snapshot.version,
    wallBudget: snapshot.wallBudget,
    itemCosts: projectRuleNumberRecord(snapshot.itemCosts),
    itemLimits: projectRuleNumberRecord(snapshot.itemLimits),
    maxSkillLoadout: snapshot.maxSkillLoadout,
    skillIds: snapshot.skillIds.filter((skillId) => MAZE_SKILL_ID_SET.has(skillId)),
  };
}

function orderedMemberIds(state: MazeAuthorityState): string[] {
  return Object.values(state.lobby.members)
    .slice()
    .sort((left, right) => left.slot - right.slot)
    .map((member) => member.uid);
}

function projectLobby(state: MazeAuthorityState, memberIds: readonly string[]): MazeAuthorityLobbyView {
  const members: Record<string, MazeAuthorityLobbyMemberView> = {};
  for (const uid of memberIds) {
    const member = state.lobby.members[uid];
    members[uid] = { uid: member.uid, slot: member.slot };
  }
  return {
    name: state.lobby.name,
    ownerId: state.lobby.ownerId,
    maxPlayers: state.lobby.maxPlayers,
    status: state.lobby.status,
    members,
  };
}

function projectPlayer(
  state: MazeAuthorityState,
  uid: string,
): MazeAuthorityPlayerView {
  const player = state.gameState.players[uid];
  const projected: MazeAuthorityPlayerView = {
    id: player.id,
    isReady: player.isReady,
  };
  if (state.gameState.phase !== GamePhase.SETUP) projected.position = clonePosition(player.position);
  if (player.displayName !== undefined) projected.displayName = player.displayName;
  if (player.hasLeft !== undefined) projected.hasLeft = player.hasLeft;
  if (player.isOnline !== undefined) projected.isOnline = player.isOnline;
  if (player.photoURL !== undefined) projected.photoURL = player.photoURL;
  if (player.finished !== undefined) projected.finished = player.finished;
  if (player.finishMoves !== undefined) projected.finishMoves = player.finishMoves;
  if (player.forfeited !== undefined) projected.forfeited = player.forfeited;
  if (player.moves !== undefined) projected.moves = player.moves;
  return projected;
}

function projectPlayers(
  state: MazeAuthorityState,
  memberIds: readonly string[],
): Record<string, MazeAuthorityPlayerView> {
  const players: Record<string, MazeAuthorityPlayerView> = {};
  for (const uid of memberIds) players[uid] = projectPlayer(state, uid);
  return players;
}

function projectMaps(
  state: MazeAuthorityState,
  memberIds: readonly string[],
  viewerUid: string | null,
): Record<string, MazeAuthorityMapView> {
  const maps: Record<string, MazeAuthorityMapView> = {};
  const sourceMaps = state.gameState.maps ?? {};
  for (const mapOwnerId of memberIds) {
    if (!hasOwn(sourceMaps, mapOwnerId)) continue;
    const map = sourceMaps[mapOwnerId];
    if (state.gameState.phase === GamePhase.SETUP) {
      if (viewerUid === mapOwnerId) maps[mapOwnerId] = projectFullMap(map);
      continue;
    }
    if (state.gameState.phase === GamePhase.END || viewerUid === mapOwnerId) {
      maps[mapOwnerId] = projectFullMap(map);
    } else {
      maps[mapOwnerId] = projectBoardBoundary(map);
    }
  }
  return maps;
}

function projectBooleanIndexRecord(value: unknown): Record<number, boolean> | undefined {
  if (!isRecord(value)) return undefined;
  const projected: Record<number, boolean> = {};
  for (let index = 0; index <= MAX_ITEM_STATE_INDEX; index += 1) {
    const raw = value[String(index)];
    if (typeof raw === 'boolean') projected[index] = raw;
  }
  return projected;
}

function projectNumberIndexRecord(value: unknown): Record<number, number> | undefined {
  if (!isRecord(value)) return undefined;
  const projected: Record<number, number> = {};
  for (let index = 0; index <= MAX_ITEM_STATE_INDEX; index += 1) {
    const raw = value[String(index)];
    if (typeof raw === 'number' && Number.isFinite(raw)) projected[index] = raw;
  }
  return projected;
}

function projectItemStateEntry(
  entry: NonNullable<MazeAuthorityState['gameState']['itemState']>[string],
): MazeAuthorityItemStateView {
  const projected: MazeAuthorityItemStateView = {};
  if (typeof entry.consumed === 'boolean') {
    projected.consumed = entry.consumed;
  } else {
    const consumed = projectBooleanIndexRecord(entry.consumed);
    if (consumed) projected.consumed = consumed;
  }
  const activeWalls = projectBooleanIndexRecord(entry.activeWalls);
  if (activeWalls) projected.activeWalls = activeWalls;
  const phaseOpen = projectBooleanIndexRecord(entry.phaseOpen);
  if (phaseOpen) projected.phaseOpen = phaseOpen;
  if (typeof entry.durability === 'number' && Number.isFinite(entry.durability)) {
    projected.durability = entry.durability;
  } else {
    const durability = projectNumberIndexRecord(entry.durability);
    if (durability) projected.durability = durability;
  }
  if (entry.mazeSkill) {
    const skillConsumed: Partial<Record<MazeSkillId, boolean>> = {};
    for (const skillId of MAZE_SKILL_IDS) {
      const consumed = entry.mazeSkill.consumed?.[skillId];
      if (typeof consumed === 'boolean') skillConsumed[skillId] = consumed;
    }
    projected.mazeSkill = {
      version: 1,
      loadout: entry.mazeSkill.loadout.filter((skillId) => MAZE_SKILL_ID_SET.has(skillId)),
      consumed: skillConsumed,
    };
  }
  if (entry.type && ITEM_TYPE_SET.has(entry.type)) projected.type = entry.type;
  return projected;
}

function projectItemState(
  state: MazeAuthorityState,
  memberIds: readonly string[],
  viewerUid: string | null,
): Record<string, MazeAuthorityItemStateView> {
  const projected: Record<string, MazeAuthorityItemStateView> = {};
  const source = state.gameState.itemState ?? {};
  const visibleIds = state.gameState.phase === GamePhase.END
    ? memberIds
    : state.gameState.phase === GamePhase.PLAY && viewerUid
      ? [viewerUid]
      : [];
  for (const uid of visibleIds) {
    if (hasOwn(source, uid)) projected[uid] = projectItemStateEntry(source[uid]);
  }
  return projected;
}

function projectAssignments(
  state: MazeAuthorityState,
  memberIds: readonly string[],
): Record<string, string> {
  const projected: Record<string, string> = {};
  const assignments = state.gameState.assignments ?? {};
  const memberSet = new Set(memberIds);
  for (const runnerId of memberIds) {
    const mapOwnerId = assignments[runnerId];
    if (memberSet.has(mapOwnerId)) projected[runnerId] = mapOwnerId;
  }
  return projected;
}

function isCollisionWall(
  value: unknown,
  memberSet: ReadonlySet<string>,
): value is CollisionWall {
  if (!isRecord(value)
    || typeof value.playerId !== 'string'
    || typeof value.mapOwnerId !== 'string'
    || !memberSet.has(value.playerId)
    || !memberSet.has(value.mapOwnerId)
    || !isRecord(value.position)
    || typeof value.position.row !== 'number'
    || typeof value.position.col !== 'number'
    || typeof value.direction !== 'string'
    || !DIRECTIONS.has(value.direction as Direction)
    || typeof value.timestamp !== 'number'
    || !Number.isFinite(value.timestamp)) return false;
  return true;
}

function collisionValues(value: MazeAuthorityState['gameState']['collisionWalls']): unknown[] {
  if (!value) return [];
  return Array.isArray(value) ? value : Object.values(value);
}

function projectCollisionWalls(
  state: MazeAuthorityState,
  memberIds: readonly string[],
): CollisionWall[] {
  if (state.gameState.phase === GamePhase.SETUP) return [];
  const memberSet = new Set(memberIds);
  const maps = state.gameState.maps ?? {};
  const itemState = state.gameState.itemState ?? {};
  const projected: CollisionWall[] = [];
  for (const candidate of collisionValues(state.gameState.collisionWalls)) {
    if (!isCollisionWall(candidate, memberSet)) continue;
    const privateMap = maps[candidate.mapOwnerId];
    if (!privateMap) continue;
    const consumed = normalizeConsumed(itemState[candidate.mapOwnerId]?.consumed);
    if (getVisibleCollisionWalls([candidate], privateMap, consumed).length === 0) continue;
    projected.push({
      playerId: candidate.playerId,
      position: clonePosition(candidate.position),
      direction: candidate.direction,
      timestamp: candidate.timestamp,
      mapOwnerId: candidate.mapOwnerId,
    });
  }
  return projected;
}

function projectRevealedWalls(
  state: MazeAuthorityState,
  memberIds: readonly string[],
  viewerUid: string | null,
): Record<string, Obstacle[]> {
  const projected: Record<string, Obstacle[]> = {};
  const source = state.gameState.revealedWallsByPlayer ?? {};
  const visibleIds = state.gameState.phase === GamePhase.END
    ? memberIds
    : state.gameState.phase === GamePhase.PLAY && viewerUid
      ? [viewerUid]
      : [];
  for (const uid of visibleIds) {
    if (hasOwn(source, uid) && Array.isArray(source[uid])) {
      projected[uid] = source[uid].map(cloneObstacle);
    }
  }
  return projected;
}

function projectVisionEffects(
  state: MazeAuthorityState,
  memberIds: readonly string[],
  viewerUid: string | null,
): Record<string, VisionEffect> {
  const projected: Record<string, VisionEffect> = {};
  const source = state.gameState.visionEffectsByPlayer;
  if (!source) return projected;
  const visibleIds = state.gameState.phase === GamePhase.END
    ? memberIds
    : state.gameState.phase === GamePhase.PLAY && viewerUid
      ? [viewerUid]
      : [];
  for (const uid of visibleIds) {
    const effect = source[uid];
    if (!effect) continue;
    projected[uid] = {
      type: 'smoke',
      sourcePlayerId: effect.sourcePlayerId,
      appliedAtTurn: effect.appliedAtTurn,
      expiresAtTargetMove: effect.expiresAtTargetMove,
    };
  }
  return projected;
}

function projectGameState(
  state: MazeAuthorityState,
  memberIds: readonly string[],
  viewerUid: string | null,
): MazeAuthorityGameStateView {
  const currentTurn = state.gameState.currentTurn ?? null;
  const winner = state.gameState.winner ?? null;
  const draw = state.gameState.draw ?? null;
  const memberSet = new Set(memberIds);
  const projected: MazeAuthorityGameStateView = {
    phase: state.gameState.phase,
    players: projectPlayers(state, memberIds),
    maps: projectMaps(state, memberIds, viewerUid),
    assignments: projectAssignments(state, memberIds),
    currentTurn: currentTurn !== null && memberSet.has(currentTurn) ? currentTurn : null,
    turnOrder: (state.gameState.turnOrder ?? []).filter((uid) => memberSet.has(uid)),
    winner: winner !== null && memberSet.has(winner) ? winner : null,
    draw: typeof draw === 'boolean' ? draw : null,
    collisionWalls: projectCollisionWalls(state, memberIds),
    itemState: projectItemState(state, memberIds, viewerUid),
    revealedWallsByPlayer: projectRevealedWalls(state, memberIds, viewerUid),
    visionEffectsByPlayer: projectVisionEffects(state, memberIds, viewerUid),
  };
  if (typeof state.gameState.rulesVersion === 'number') {
    projected.rulesVersion = state.gameState.rulesVersion;
  }
  if (typeof state.gameState.matchNumber === 'number') {
    projected.matchNumber = state.gameState.matchNumber;
  }
  if (typeof state.gameState.turnNumber === 'number') projected.turnNumber = state.gameState.turnNumber;
  if (typeof state.gameState.turnMessage === 'string') projected.turnMessage = state.gameState.turnMessage;
  if (typeof state.gameState.turnMessageTimestamp === 'number'
    && Number.isFinite(state.gameState.turnMessageTimestamp)) {
    projected.turnMessageTimestamp = state.gameState.turnMessageTimestamp;
  }
  return projected;
}

function projectBase(
  state: MazeAuthorityState,
  viewerUid: string | null,
): MazeAuthorityViewBase {
  const memberIds = orderedMemberIds(state);
  return {
    viewVersion: MAZE_AUTHORITY_VIEW_VERSION,
    authoritySchemaVersion: state.meta.schemaVersion,
    roomId: state.meta.roomId,
    generation: state.meta.generation,
    revision: state.meta.revision,
    sourceCreatedAt: state.meta.createdAt,
    sourceUpdatedAt: state.meta.updatedAt,
    lobby: projectLobby(state, memberIds),
    ruleSnapshot: projectRuleSnapshot(state.ruleSnapshot),
    gameState: projectGameState(state, memberIds, viewerUid),
  };
}

/** Builds a spectator-safe projection and never exposes command receipts. */
export function projectMazeAuthorityPublicView(rawState: unknown): MazeAuthorityPublicView {
  const state = parseMazeAuthorityState(rawState);
  return { audience: 'public', ...projectBase(state, null) };
}

/** Builds a member projection after proving that the viewer belongs to this room. */
export function projectMazeAuthorityMemberView(
  rawState: unknown,
  viewerUid: string,
): MazeAuthorityMemberView {
  const state = parseMazeAuthorityState(rawState);
  if (!hasOwn(state.lobby.members, viewerUid)) {
    throw new MazeAuthorityDomainError(
      'permission-denied',
      'not-a-member',
      'Only a room member can receive a Maze Authority member view.',
    );
  }
  return { audience: 'member', viewerUid, ...projectBase(state, viewerUid) };
}

export const buildMazeAuthorityPublicView = projectMazeAuthorityPublicView;
export const buildMazeAuthorityMemberView = projectMazeAuthorityMemberView;
