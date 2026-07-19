import { isDeepStrictEqual } from 'node:util';
import { isValidMazeAuthorityRoomId } from './mazeAuthorityAdapter';

export const MAZE_PRESENCE_ROOM_ROOT = 'mazePresence/v1/rooms';
export const MAZE_PRESENCE_LEASE_ROOT = 'mazePresence/v1/leases';
export const MAZE_PRESENCE_STATUS_ROOT = 'mazePresence/v1/status';
export const MAZE_PRESENCE_FRESHNESS_MS = 60_000 as const;
export const MAZE_PRESENCE_OFFLINE_TURN_GRACE_MS = 45_000 as const;
// The callable itself may run for 30 seconds. Keep the lease lock alive for a
// full minute so a slow-but-valid authority transaction cannot lose its race
// token before it commits.
export const MAZE_PRESENCE_TIMEOUT_CLAIM_TTL_MS = 60_000 as const;
export const MAZE_PRESENCE_MAX_CONNECTIONS = 8 as const;
export const MAZE_PRESENCE_MAX_CONVERGENCE_ATTEMPTS = 4 as const;

const MAX_UID_LENGTH = 128;
const MAX_SESSION_LENGTH = 80;
const INVALID_FIREBASE_KEY = /[.#$\[\]\/\u0000-\u001F\u007F-\u009F]/u;

export interface MazePresenceConnection {
  uid: string;
  generation: number;
  session: string;
  connectedAt: number;
  lastSeen: number;
}

export interface MazePresenceLease {
  uid: string;
  roomId: string;
  generation: number;
  epoch: number;
  online: boolean;
  lastSeen: number;
  offlineSince?: number;
  timeoutClaim?: MazePresenceTimeoutClaim;
  updatedAt: number;
}

export interface MazePresenceTimeoutClaim {
  claimId: string;
  epoch: number;
  claimedBy: string;
  claimedAt: number;
}

export interface MazePresenceStatus {
  uid: string;
  roomId: string;
  generation: number;
  epoch: number;
  online: boolean;
  lastSeen: number;
  offlineSince?: number;
  updatedAt: number;
}

export interface MazePresenceSnapshot {
  val(): unknown;
}

export interface MazePresenceReadReference {
  get(): Promise<MazePresenceSnapshot>;
}

export interface MazePresenceTransactionResult {
  committed: boolean;
  snapshot: MazePresenceSnapshot;
}

export interface MazePresenceTransactionReference extends MazePresenceReadReference {
  transaction(
    update: (current: unknown) => unknown,
    onComplete?: undefined,
    applyLocally?: boolean,
  ): Promise<MazePresenceTransactionResult>;
}

export interface MazePresenceDependencies {
  getConnectionsReference(path: string): MazePresenceReadReference;
  getPublicRoomReference(path: string): MazePresenceReadReference;
  getLeaseReference(path: string): MazePresenceTransactionReference;
  getStatusReference(path: string): MazePresenceTransactionReference;
}

export interface MazePresenceSyncResponse {
  ok: true;
  roomId: string;
  uid: string;
  generation: number | null;
  online: boolean;
  epoch: number | null;
  activeConnections: number;
  convergenceAttempts: number;
  removed: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function safeInteger(value: unknown, minimum = 0): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= minimum;
}

export function isValidMazePresenceUid(value: unknown): value is string {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= MAX_UID_LENGTH
    && value.trim() === value
    && !INVALID_FIREBASE_KEY.test(value);
}

export function mazePresenceConnectionsPath(roomId: string, uid: string): string {
  if (!isValidMazeAuthorityRoomId(roomId) || !isValidMazePresenceUid(uid)) {
    throw new Error('Invalid Maze presence connection identity');
  }
  return `${MAZE_PRESENCE_ROOM_ROOT}/${roomId}/${uid}`;
}

export function mazePresenceLeasePath(roomId: string, uid: string): string {
  if (!isValidMazeAuthorityRoomId(roomId) || !isValidMazePresenceUid(uid)) {
    throw new Error('Invalid Maze presence lease identity');
  }
  return `${MAZE_PRESENCE_LEASE_ROOT}/${roomId}/${uid}`;
}

export function mazePresenceStatusPath(roomId: string, uid: string): string {
  if (!isValidMazeAuthorityRoomId(roomId) || !isValidMazePresenceUid(uid)) {
    throw new Error('Invalid Maze presence status identity');
  }
  return `${MAZE_PRESENCE_STATUS_ROOT}/${roomId}/${uid}`;
}

export function retainMazePresenceRoomGeneration(
  value: unknown,
  generation: number,
  connectionTree: boolean,
): unknown {
  if (!safeInteger(generation, 1)
    || !isRecord(value)) return null;
  const retained: Array<[string, unknown]> = [];
  for (const [uid, entry] of Object.entries(value)) {
    if (!isValidMazePresenceUid(uid) || (!isRecord(entry) && !Array.isArray(entry))) continue;
    if (!connectionTree) {
      if (!isRecord(entry)) continue;
      if (entry.generation === generation) retained.push([uid, entry]);
      continue;
    }
    const connections = Object.entries(entry)
      .filter(([slot, connection]) => /^[0-7]$/u.test(slot)
        && isRecord(connection)
        && connection.generation === generation);
    if (connections.length > 0) retained.push([uid, Object.fromEntries(connections)]);
  }
  return retained.length > 0 ? Object.fromEntries(retained) : null;
}

function parsePublicGeneration(
  value: unknown,
  roomId: string,
  uid: string,
): number | null {
  if (!isRecord(value)
    || value.roomId !== roomId
    || !safeInteger(value.generation, 1)
    || !isRecord(value.lobby)
    || !isRecord(value.lobby.members)
    || !Object.prototype.hasOwnProperty.call(value.lobby.members, uid)) return null;
  return value.generation;
}

function parseConnection(
  value: unknown,
  uid: string,
  generation: number,
  now: number,
): MazePresenceConnection | null {
  if (!isRecord(value)
    || Reflect.ownKeys(value).length !== 5
    || value.uid !== uid
    || value.generation !== generation
    || typeof value.session !== 'string'
    || value.session.length === 0
    || value.session.length > MAX_SESSION_LENGTH
    || !safeInteger(value.connectedAt)
    || !safeInteger(value.lastSeen)
    || value.connectedAt > now + MAZE_PRESENCE_FRESHNESS_MS
    || value.lastSeen > now + MAZE_PRESENCE_FRESHNESS_MS
    || value.lastSeen < now - MAZE_PRESENCE_FRESHNESS_MS) return null;
  return {
    uid,
    generation,
    session: value.session,
    connectedAt: value.connectedAt,
    lastSeen: value.lastSeen,
  };
}

export function collectActiveMazePresenceConnections(
  value: unknown,
  uid: string,
  generation: number,
  now: number,
): MazePresenceConnection[] {
  // RTDB materializes dense numeric slot keys (notably a single "0" slot) as
  // arrays. Object and array representations are semantically identical here.
  if (!isRecord(value) && !Array.isArray(value)) return [];
  return Object.entries(value)
    .filter(([slot]) => /^[0-7]$/u.test(slot))
    .map(([, connection]) => parseConnection(connection, uid, generation, now))
    .filter((connection): connection is MazePresenceConnection => connection !== null)
    .sort((left, right) => right.lastSeen - left.lastSeen || left.session.localeCompare(right.session))
    .slice(0, MAZE_PRESENCE_MAX_CONNECTIONS);
}

function parseLease(value: unknown, roomId: string, uid: string): MazePresenceLease | null {
  if (!isRecord(value)
    || value.uid !== uid
    || value.roomId !== roomId
    || !safeInteger(value.generation, 1)
    || !safeInteger(value.epoch, 1)
    || typeof value.online !== 'boolean'
    || !safeInteger(value.lastSeen)
    || !safeInteger(value.updatedAt)
    || (value.online === false && !safeInteger(value.offlineSince))
    || (value.online === true && value.offlineSince != null)) return null;
  let timeoutClaim: MazePresenceTimeoutClaim | undefined;
  if (value.timeoutClaim != null) {
    const claim = value.timeoutClaim;
    if (!isRecord(claim)
      || Reflect.ownKeys(claim).length !== 4
      || typeof claim.claimId !== 'string'
      || claim.claimId.length < 8
      || claim.claimId.length > 64
      || INVALID_FIREBASE_KEY.test(claim.claimId)
      || !safeInteger(claim.epoch, 1)
      || !isValidMazePresenceUid(claim.claimedBy)
      || !safeInteger(claim.claimedAt)) return null;
    timeoutClaim = {
      claimId: claim.claimId,
      epoch: claim.epoch,
      claimedBy: claim.claimedBy,
      claimedAt: claim.claimedAt,
    };
  }
  return {
    uid,
    roomId,
    generation: value.generation,
    epoch: value.epoch,
    online: value.online,
    lastSeen: value.lastSeen,
    ...(value.online ? {} : { offlineSince: value.offlineSince as number }),
    ...(timeoutClaim ? { timeoutClaim } : {}),
    updatedAt: value.updatedAt,
  };
}

export function buildMazePresenceLease(
  existingValue: unknown,
  roomId: string,
  uid: string,
  generation: number,
  activeConnections: MazePresenceConnection[],
  now: number,
): MazePresenceLease {
  if (!isValidMazeAuthorityRoomId(roomId)
    || !isValidMazePresenceUid(uid)
    || !safeInteger(generation, 1)
    || !safeInteger(now)) throw new Error('Invalid Maze presence lease input');
  const existing = parseLease(existingValue, roomId, uid);
  const activeTimeoutClaim = existing?.timeoutClaim
    && existing.timeoutClaim.epoch === existing.epoch
    && existing.timeoutClaim.claimedAt + MAZE_PRESENCE_TIMEOUT_CLAIM_TTL_MS >= now
    ? existing.timeoutClaim
    : undefined;
  if (existing?.generation === generation && activeTimeoutClaim) {
    return {
      ...existing,
      timeoutClaim: activeTimeoutClaim,
      updatedAt: Math.max(now, existing.updatedAt),
    };
  }
  const online = activeConnections.length > 0;
  const sameGeneration = existing?.generation === generation;
  const sameState = sameGeneration && existing?.online === online;
  const epoch = sameState && existing ? existing.epoch : (existing?.epoch ?? 0) + 1;
  const latestSeen = online
    ? Math.max(...activeConnections.map((connection) => connection.lastSeen))
    : sameGeneration && existing ? existing.lastSeen : now;
  return {
    uid,
    roomId,
    generation,
    epoch,
    online,
    lastSeen: latestSeen,
    ...(online
      ? {}
      : {
        offlineSince: sameGeneration && existing?.online === false
          ? (existing.offlineSince ?? now)
          : now,
      }),
    updatedAt: Math.max(now, existing?.updatedAt ?? 0),
  };
}

function statusFromLease(lease: MazePresenceLease): MazePresenceStatus {
  const status = { ...lease };
  delete status.timeoutClaim;
  return status;
}

export class MazePresenceTimeoutClaimError extends Error {
  readonly reason: 'lease-mismatch' | 'target-online' | 'grace-active' | 'claim-conflict';

  constructor(reason: MazePresenceTimeoutClaimError['reason']) {
    super(`Maze presence timeout claim rejected: ${reason}`);
    this.name = 'MazePresenceTimeoutClaimError';
    this.reason = reason;
  }
}

export async function claimMazePresenceTimeout(
  reference: MazePresenceTransactionReference,
  input: {
    roomId: string;
    targetUid: string;
    claimantUid: string;
    generation: number;
    epoch: number;
    claimId: string;
    now: number;
  },
): Promise<MazePresenceLease> {
  let rejection: MazePresenceTimeoutClaimError | null = null;
  const result = await reference.transaction((current) => {
    if (current == null) {
      rejection = new MazePresenceTimeoutClaimError('lease-mismatch');
      return null;
    }
    const lease = parseLease(current, input.roomId, input.targetUid);
    if (!lease || lease.generation !== input.generation || lease.epoch !== input.epoch) {
      rejection = new MazePresenceTimeoutClaimError('lease-mismatch');
      return undefined;
    }
    if (lease.online) {
      rejection = new MazePresenceTimeoutClaimError('target-online');
      return undefined;
    }
    if ((lease.offlineSince ?? input.now) > input.now - MAZE_PRESENCE_OFFLINE_TURN_GRACE_MS) {
      rejection = new MazePresenceTimeoutClaimError('grace-active');
      return undefined;
    }
    const existingClaim = lease.timeoutClaim;
    if (existingClaim?.claimId === input.claimId
      && existingClaim.epoch === input.epoch
      && existingClaim.claimedBy === input.claimantUid) return undefined;
    if (existingClaim
      && existingClaim.claimedAt + MAZE_PRESENCE_TIMEOUT_CLAIM_TTL_MS >= input.now) {
      rejection = new MazePresenceTimeoutClaimError('claim-conflict');
      return undefined;
    }
    rejection = null;
    return {
      ...lease,
      timeoutClaim: {
        claimId: input.claimId,
        epoch: input.epoch,
        claimedBy: input.claimantUid,
        claimedAt: input.now,
      },
      updatedAt: Math.max(input.now, lease.updatedAt),
    } satisfies MazePresenceLease;
  }, undefined, false);
  if (!result || !result.snapshot || typeof result.snapshot.val !== 'function') {
    throw new Error('Invalid Maze presence timeout claim result');
  }
  const lease = parseLease(result.snapshot.val(), input.roomId, input.targetUid);
  if (lease?.timeoutClaim?.claimId === input.claimId
    && lease.timeoutClaim.epoch === input.epoch
    && lease.timeoutClaim.claimedBy === input.claimantUid) return lease;
  throw rejection ?? new MazePresenceTimeoutClaimError('claim-conflict');
}

export async function releaseMazePresenceTimeoutClaim(
  reference: MazePresenceTransactionReference,
  input: {
    roomId: string;
    targetUid: string;
    claimId: string;
    claimedBy?: string;
    epoch?: number;
  },
): Promise<void> {
  const result = await reference.transaction((current) => {
    if (current == null) return null;
    const lease = parseLease(current, input.roomId, input.targetUid);
    if (!lease?.timeoutClaim
      || lease.timeoutClaim.claimId !== input.claimId
      || (input.claimedBy != null && lease.timeoutClaim.claimedBy !== input.claimedBy)
      || (input.epoch != null && lease.timeoutClaim.epoch !== input.epoch)) return undefined;
    const next = { ...lease };
    delete next.timeoutClaim;
    return next;
  }, undefined, false);
  if (!result || !result.snapshot || typeof result.snapshot.val !== 'function') {
    throw new Error('Invalid Maze presence timeout release result');
  }
  const lease = parseLease(result.snapshot.val(), input.roomId, input.targetUid);
  if (lease?.timeoutClaim?.claimId === input.claimId
    && (input.claimedBy == null || lease.timeoutClaim.claimedBy === input.claimedBy)
    && (input.epoch == null || lease.timeoutClaim.epoch === input.epoch)) {
    throw new Error('Maze presence timeout claim was not released');
  }
}

async function readValue(reference: MazePresenceReadReference): Promise<unknown> {
  const snapshot = await reference.get();
  if (!snapshot || typeof snapshot.val !== 'function') throw new Error('Invalid presence snapshot');
  return snapshot.val();
}

async function transactExact(
  reference: MazePresenceTransactionReference,
  candidate: unknown,
): Promise<unknown> {
  const result = await reference.transaction((current) => (
    isDeepStrictEqual(current, candidate)
      ? (candidate === null ? null : undefined)
      : candidate
  ), undefined, false);
  if (!result || !result.snapshot || typeof result.snapshot.val !== 'function') {
    throw new Error('Invalid presence transaction result');
  }
  const committed = result.snapshot.val();
  if (!isDeepStrictEqual(committed, candidate)) throw new Error('Presence transaction diverged');
  return committed;
}

export async function syncMazePresenceLease(
  input: { roomId: string; uid: string; now: number },
  dependencies: MazePresenceDependencies,
): Promise<MazePresenceSyncResponse> {
  const { roomId, uid, now } = input;
  if (!isValidMazeAuthorityRoomId(roomId)
    || !isValidMazePresenceUid(uid)
    || !safeInteger(now)) throw new Error('Invalid Maze presence sync input');
  const connectionsPath = mazePresenceConnectionsPath(roomId, uid);
  const publicPath = `mazeViews/v1/publicRooms/${roomId}`;
  const leasePath = mazePresenceLeasePath(roomId, uid);
  const statusPath = mazePresenceStatusPath(roomId, uid);

  for (let attempt = 1; attempt <= MAZE_PRESENCE_MAX_CONVERGENCE_ATTEMPTS; attempt += 1) {
    const [connectionsRaw, publicRaw] = await Promise.all([
      readValue(dependencies.getConnectionsReference(connectionsPath)),
      readValue(dependencies.getPublicRoomReference(publicPath)),
    ]);
    const generation = parsePublicGeneration(publicRaw, roomId, uid);
    if (generation === null) {
      await Promise.all([
        transactExact(dependencies.getLeaseReference(leasePath), null),
        transactExact(dependencies.getStatusReference(statusPath), null),
      ]);
      return {
        ok: true,
        roomId,
        uid,
        generation: null,
        online: false,
        epoch: null,
        activeConnections: 0,
        convergenceAttempts: attempt,
        removed: true,
      };
    }
    const activeConnections = collectActiveMazePresenceConnections(
      connectionsRaw,
      uid,
      generation,
      now,
    );
    const leaseReference = dependencies.getLeaseReference(leasePath);
    const leaseResult = await leaseReference.transaction((existing) => (
      buildMazePresenceLease(existing, roomId, uid, generation, activeConnections, now)
    ), undefined, false);
    if (!leaseResult || !leaseResult.snapshot || typeof leaseResult.snapshot.val !== 'function') {
      throw new Error('Invalid Maze presence lease transaction result');
    }
    const lease = parseLease(leaseResult.snapshot.val(), roomId, uid);
    const activeTimeoutClaim = lease?.timeoutClaim
      && lease.timeoutClaim.epoch === lease.epoch
      && lease.timeoutClaim.claimedAt + MAZE_PRESENCE_TIMEOUT_CLAIM_TTL_MS >= now;
    if (!lease
      || lease.generation !== generation
      || (!activeTimeoutClaim && lease.online !== (activeConnections.length > 0))) {
      throw new Error('Maze presence lease failed validation');
    }
    await transactExact(dependencies.getStatusReference(statusPath), statusFromLease(lease));

    const [latestConnections, latestPublic] = await Promise.all([
      readValue(dependencies.getConnectionsReference(connectionsPath)),
      readValue(dependencies.getPublicRoomReference(publicPath)),
    ]);
    if (isDeepStrictEqual(latestConnections, connectionsRaw)
      && isDeepStrictEqual(latestPublic, publicRaw)) {
      return {
        ok: true,
        roomId,
        uid,
        generation,
        online: lease.online,
        epoch: lease.epoch,
        activeConnections: activeConnections.length,
        convergenceAttempts: attempt,
        removed: false,
      };
    }
  }
  throw new Error('Maze presence lease did not converge');
}
