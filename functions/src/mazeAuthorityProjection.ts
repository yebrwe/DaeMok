import { HttpsError, type FunctionsErrorCode } from 'firebase-functions/v2/https';
import { isValidMazeAuthorityRoomId } from './mazeAuthorityAdapter';
import {
  MazeAuthorityDomainError,
  parseMazeAuthorityState,
  type MazeAuthorityState,
} from './mazeAuthorityDomain';
import {
  buildMazeAuthorityMemberView,
  buildMazeAuthorityPublicView,
  MAZE_AUTHORITY_VIEW_VERSION,
  type MazeAuthorityMemberView,
  type MazeAuthorityPublicView,
} from './mazeAuthorityView';

export const MAZE_AUTHORITY_PUBLIC_VIEW_ROOT = 'mazeViews/v1/publicRooms';
export const MAZE_AUTHORITY_MEMBER_VIEW_ROOT = 'mazeViews/v1/memberRooms';
export const MAZE_AUTHORITY_VIEW_MANIFEST_ROOT = 'mazeViewManifests/v1/rooms';
export const MAZE_AUTHORITY_VIEW_MANIFEST_VERSION = 1;
export const MAZE_AUTHORITY_VIEW_MAX_BYTES = 256 * 1024;

const MAX_UID_LENGTH = 128;
const MAX_PROJECTION_DEPTH = 32;
const MAX_PROJECTION_NODES = 30_000;
const INVALID_FIREBASE_KEY = /[.#$\[\]\/\u0000-\u001F\u007F-\u009F]/u;
const OMIT = Symbol('omit-rtdb');

export type MazeAuthorityProjectionCandidate = MazeAuthorityPublicView | MazeAuthorityMemberView;

export interface MazeAuthorityProjectionTransactionSnapshot {
  val(): unknown;
}

export interface MazeAuthorityProjectionTransactionResult {
  committed: boolean;
  snapshot: MazeAuthorityProjectionTransactionSnapshot;
}

export interface MazeAuthorityProjectionTransactionReference {
  get?(): Promise<MazeAuthorityProjectionTransactionSnapshot>;
  transaction(
    update: (current: unknown) => unknown,
    onComplete?: undefined,
    applyLocally?: boolean,
  ): Promise<MazeAuthorityProjectionTransactionResult>;
}

export interface MazeAuthorityProjectionDependencies {
  getViewReference(path: string): MazeAuthorityProjectionTransactionReference;
}

export interface MazeAuthorityProjectionWriteResult {
  audience: 'public' | 'member';
  viewerUid?: string;
  path: string;
  replayed: boolean;
}

export interface MazeAuthorityProjectionResponse {
  ok: true;
  roomId: string;
  generation: number;
  revision: number;
  replayed: boolean;
  writes: MazeAuthorityProjectionWriteResult[];
}

export interface MazeAuthorityViewManifest {
  manifestVersion: typeof MAZE_AUTHORITY_VIEW_MANIFEST_VERSION;
  roomId: string;
  generation: number;
  revision: number;
  memberUids: string[];
}

export interface MazeAuthorityProjectionCleanupResult {
  audience: 'public' | 'member';
  viewerUid?: string;
  path: string;
  replayed: boolean;
}

export interface MazeAuthorityProjectionFinalizationResponse {
  ok: true;
  roomId: string;
  generation: number;
  revision: number;
  closed: boolean;
  manifestPath: string;
  manifestReplayed: boolean;
  cleanups: MazeAuthorityProjectionCleanupResult[];
}

interface ProjectionBudget {
  nodes: number;
  bytes: number;
  ancestors: WeakSet<object>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function isValidMazeAuthorityViewUid(value: unknown): value is string {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= MAX_UID_LENGTH
    && value.trim() === value
    && !INVALID_FIREBASE_KEY.test(value);
}

export function mazeAuthorityPublicViewPath(roomId: string): string {
  if (!isValidMazeAuthorityRoomId(roomId)) throw new Error('Invalid Maze Authority room id');
  return `${MAZE_AUTHORITY_PUBLIC_VIEW_ROOT}/${roomId}`;
}

export function mazeAuthorityMemberViewPath(uid: string, roomId: string): string {
  if (!isValidMazeAuthorityViewUid(uid) || !isValidMazeAuthorityRoomId(roomId)) {
    throw new Error('Invalid Maze Authority member view target');
  }
  return `${MAZE_AUTHORITY_MEMBER_VIEW_ROOT}/${uid}/${roomId}`;
}

export function mazeAuthorityViewManifestPath(roomId: string): string {
  if (!isValidMazeAuthorityRoomId(roomId)) {
    throw new Error('Invalid Maze Authority view manifest room id');
  }
  return `${MAZE_AUTHORITY_VIEW_MANIFEST_ROOT}/${roomId}`;
}

function normalizeValue(
  value: unknown,
  budget: ProjectionBudget,
  depth: number,
  preserveArrays: boolean,
): unknown | typeof OMIT {
  budget.nodes += 1;
  if (budget.nodes > MAX_PROJECTION_NODES || depth > MAX_PROJECTION_DEPTH) {
    throw new Error('projection structural bound');
  }
  if (value == null || value === undefined) return OMIT;
  if (typeof value === 'string') {
    budget.bytes += Buffer.byteLength(value, 'utf8');
    if (budget.bytes > MAZE_AUTHORITY_VIEW_MAX_BYTES) throw new Error('projection byte bound');
    return value;
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('projection number');
    return value;
  }
  if (typeof value === 'boolean') return value;
  if (typeof value !== 'object') throw new Error('projection value');
  if (budget.ancestors.has(value)) throw new Error('projection cycle');

  budget.ancestors.add(value);
  if (Array.isArray(value) && preserveArrays) {
    if (value.length === 0) {
      budget.ancestors.delete(value);
      return OMIT;
    }
    const normalized: unknown[] = [];
    for (let index = 0; index < value.length; index += 1) {
      const child = normalizeValue(value[index], budget, depth + 1, true);
      if (child === OMIT) throw new Error('projection sparse array');
      normalized.push(child);
    }
    budget.ancestors.delete(value);
    return normalized;
  }

  // Firebase's compat transaction validator calls obj.hasOwnProperty directly,
  // so persisted values must be ordinary objects. defineProperty keeps special
  // keys such as "__proto__" inert instead of invoking Object.prototype setters.
  const normalized: Record<string, unknown> = {};
  const entries = Array.isArray(value)
    ? value.map((entry, index) => [String(index), entry] as const)
    : Object.entries(value).sort(([left], [right]) => left.localeCompare(right));
  for (const [key, childValue] of entries) {
    budget.bytes += Buffer.byteLength(key, 'utf8');
    if (budget.bytes > MAZE_AUTHORITY_VIEW_MAX_BYTES) throw new Error('projection byte bound');
    const child = normalizeValue(childValue, budget, depth + 1, preserveArrays);
    if (child !== OMIT) {
      Object.defineProperty(normalized, key, {
        value: child,
        enumerable: true,
        configurable: true,
        writable: true,
      });
    }
  }
  budget.ancestors.delete(value);
  return Object.keys(normalized).length === 0 ? OMIT : normalized;
}

function normalizeRoot(value: unknown, preserveArrays: boolean): Record<string, unknown> | null {
  try {
    const normalized = normalizeValue(value, {
      nodes: 0,
      bytes: 0,
      ancestors: new WeakSet<object>(),
    }, 0, preserveArrays);
    if (!isRecord(normalized)) return null;
    if (Buffer.byteLength(JSON.stringify(normalized), 'utf8') > MAZE_AUTHORITY_VIEW_MAX_BYTES) {
      return null;
    }
    return normalized;
  } catch {
    return null;
  }
}

export function serializeMazeAuthorityViewForRtdb(
  candidate: MazeAuthorityProjectionCandidate,
): Record<string, unknown> {
  const serialized = normalizeRoot(candidate, true);
  if (!serialized) throw new Error('Maze Authority view exceeds its persistence bound');
  return serialized;
}

function projectionFingerprint(value: unknown): string | null {
  const normalized = normalizeRoot(value, false);
  return normalized ? JSON.stringify(normalized) : null;
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Reflect.ownKeys(value);
  return actual.length === keys.length
    && keys.every((key) => Object.prototype.hasOwnProperty.call(value, key));
}

function materializeDenseStringArray(value: unknown): string[] | null {
  if (Array.isArray(value)) {
    return value.every((entry) => typeof entry === 'string') ? value.slice() : null;
  }
  if (!isRecord(value)) return null;
  const keys = Object.keys(value);
  if (!keys.every((key, index) => key === String(index))) return null;
  const entries = keys.map((key) => value[key]);
  if (!entries.every((entry) => typeof entry === 'string')) return null;
  return entries as string[];
}

function parsePersistedManifest(
  value: unknown,
  roomId: string,
): MazeAuthorityViewManifest | null {
  if (value == null) return null;
  if (!isRecord(value)) {
    throw new HttpsError('data-loss', 'The Maze Authority view manifest is malformed.');
  }
  const hasMembers = Object.prototype.hasOwnProperty.call(value, 'memberUids');
  const expectedKeys = hasMembers
    ? ['manifestVersion', 'roomId', 'generation', 'revision', 'memberUids']
    : ['manifestVersion', 'roomId', 'generation', 'revision'];
  const memberUids = hasMembers ? materializeDenseStringArray(value.memberUids) : [];
  if (!hasExactKeys(value, expectedKeys)
    || value.manifestVersion !== MAZE_AUTHORITY_VIEW_MANIFEST_VERSION
    || value.roomId !== roomId
    || !Number.isSafeInteger(value.generation)
    || (value.generation as number) < 0
    || !Number.isSafeInteger(value.revision)
    || (value.revision as number) < 0
    || !memberUids
    || memberUids.some((uid) => !isValidMazeAuthorityViewUid(uid))
    || new Set(memberUids).size !== memberUids.length) {
    throw new HttpsError('data-loss', 'The Maze Authority view manifest is malformed.');
  }
  return {
    manifestVersion: MAZE_AUTHORITY_VIEW_MANIFEST_VERSION,
    roomId,
    generation: value.generation as number,
    revision: value.revision as number,
    memberUids,
  };
}

function manifestMatchesCandidate(
  value: unknown,
  candidate: MazeAuthorityViewManifest,
): boolean {
  try {
    const persisted = parsePersistedManifest(value, candidate.roomId);
    return persisted !== null
      && persisted.generation === candidate.generation
      && persisted.revision === candidate.revision
      && persisted.memberUids.length === candidate.memberUids.length
      && persisted.memberUids.every((uid, index) => uid === candidate.memberUids[index]);
  } catch {
    return false;
  }
}

function versionIsNewer(
  value: unknown,
  source: Pick<MazeAuthorityState['meta'], 'generation' | 'revision'>,
  schemaVersionKey: 'viewVersion' | 'manifestVersion',
  currentSchemaVersion: number,
): boolean {
  if (!isRecord(value)) return false;
  const schemaVersion = value[schemaVersionKey];
  if (typeof schemaVersion === 'number' && Number.isSafeInteger(schemaVersion)) {
    if (schemaVersion > currentSchemaVersion) return true;
  }
  if (!Number.isSafeInteger(value.generation) || !Number.isSafeInteger(value.revision)) {
    return false;
  }
  if ((value.generation as number) !== source.generation) {
    return (value.generation as number) > source.generation;
  }
  return (value.revision as number) > source.revision;
}

export function persistedMazeAuthorityViewMatches(
  persisted: unknown,
  candidate: MazeAuthorityProjectionCandidate,
): boolean {
  const candidateFingerprint = projectionFingerprint(candidate);
  return candidateFingerprint !== null && projectionFingerprint(persisted) === candidateFingerprint;
}

function existingProjectionIsNewer(
  existing: unknown,
  candidate: MazeAuthorityProjectionCandidate,
): boolean {
  return versionIsNewer(existing, candidate, 'viewVersion', MAZE_AUTHORITY_VIEW_VERSION);
}

function transactionFailureStatus(error: unknown): FunctionsErrorCode {
  try {
    const code = isRecord(error) && typeof error.code === 'string'
      ? error.code.toLowerCase()
      : '';
    const message = error instanceof Error ? error.message.toLowerCase() : '';
    const signal = `${code} ${message}`.replace(/[_-]+/gu, ' ');
    return /max\s*retr(?:y|i)/u.test(signal)
      || signal.includes('aborted')
      ? 'aborted'
      : 'unavailable';
  } catch {
    return 'unavailable';
  }
}

async function writeCandidate(
  candidate: MazeAuthorityProjectionCandidate,
  path: string,
  dependencies: MazeAuthorityProjectionDependencies,
): Promise<MazeAuthorityProjectionWriteResult> {
  let persistedCandidate: Record<string, unknown>;
  try {
    persistedCandidate = serializeMazeAuthorityViewForRtdb(candidate);
  } catch {
    throw new HttpsError('resource-exhausted', 'The Maze Authority view is too large.');
  }
  const candidateFingerprint = projectionFingerprint(persistedCandidate);
  if (!candidateFingerprint) {
    throw new HttpsError('resource-exhausted', 'The Maze Authority view is too large.');
  }

  let transact: MazeAuthorityProjectionTransactionReference['transaction'] | null = null;
  try {
    const reference = dependencies.getViewReference(path);
    if (typeof reference?.transaction === 'function') {
      transact = reference.transaction.bind(reference);
    }
  } catch (error) {
    throw new HttpsError(
      transactionFailureStatus(error),
      'The Maze Authority view store is unavailable.',
    );
  }
  if (!transact) throw new HttpsError('internal', 'The Maze Authority view service is misconfigured.');

  let result: MazeAuthorityProjectionTransactionResult;
  try {
    result = await transact((existing) => {
      if (existingProjectionIsNewer(existing, candidate)) return undefined;
      if (projectionFingerprint(existing) === candidateFingerprint) return undefined;
      return persistedCandidate;
    }, undefined, false);
  } catch (error) {
    throw new HttpsError(
      transactionFailureStatus(error),
      'The Maze Authority view transaction did not complete.',
    );
  }

  let snapshotValue: unknown;
  try {
    if (!result
      || typeof result.committed !== 'boolean'
      || !result.snapshot
      || typeof result.snapshot.val !== 'function') throw new Error('invalid projection result');
    snapshotValue = result.snapshot.val();
  } catch {
    throw new HttpsError('data-loss', 'The Maze Authority view transaction returned invalid data.');
  }

  if (projectionFingerprint(snapshotValue) === candidateFingerprint) {
    return {
      audience: candidate.audience,
      ...(candidate.audience === 'member' ? { viewerUid: candidate.viewerUid } : {}),
      path,
      replayed: !result.committed,
    };
  }
  if (existingProjectionIsNewer(snapshotValue, candidate)) {
    throw new HttpsError('aborted', 'A newer Maze Authority view is already committed.');
  }
  throw new HttpsError('data-loss', 'The committed Maze Authority view is inconsistent.');
}

function getProjectionTransaction(
  path: string,
  dependencies: MazeAuthorityProjectionDependencies,
): MazeAuthorityProjectionTransactionReference['transaction'] {
  try {
    const reference = dependencies.getViewReference(path);
    if (typeof reference?.transaction === 'function') {
      return reference.transaction.bind(reference);
    }
  } catch (error) {
    throw new HttpsError(
      transactionFailureStatus(error),
      'The Maze Authority projection store is unavailable.',
    );
  }
  throw new HttpsError('internal', 'The Maze Authority projection service is misconfigured.');
}

function projectionTransactionValue(
  result: MazeAuthorityProjectionTransactionResult,
  message: string,
): unknown {
  try {
    if (!result
      || typeof result.committed !== 'boolean'
      || !result.snapshot
      || typeof result.snapshot.val !== 'function') throw new Error('invalid transaction result');
    return result.snapshot.val();
  } catch {
    throw new HttpsError('data-loss', message);
  }
}

async function readViewManifest(
  roomId: string,
  dependencies: MazeAuthorityProjectionDependencies,
): Promise<MazeAuthorityViewManifest | null> {
  const path = mazeAuthorityViewManifestPath(roomId);
  let reference: MazeAuthorityProjectionTransactionReference;
  try {
    reference = dependencies.getViewReference(path);
  } catch (error) {
    throw new HttpsError(
      transactionFailureStatus(error),
      'The Maze Authority view manifest could not be read.',
    );
  }
  if (typeof reference?.get === 'function') {
    try {
      const snapshot = await reference.get();
      if (!snapshot || typeof snapshot.val !== 'function') {
        throw new HttpsError(
          'data-loss',
          'The Maze Authority view manifest returned an invalid snapshot.',
        );
      }
      return parsePersistedManifest(snapshot.val(), roomId);
    } catch (error) {
      if (error instanceof HttpsError) throw error;
      throw new HttpsError(
        transactionFailureStatus(error),
        'The Maze Authority view manifest could not be read.',
      );
    }
  }
  const transact = reference?.transaction?.bind(reference);
  if (!transact) {
    throw new HttpsError('internal', 'The Maze Authority projection service is misconfigured.');
  }
  let result: MazeAuthorityProjectionTransactionResult;
  try {
    // A no-op undefined transaction aborts against an optimistic cold-cache
    // null without ever reading the remote manifest. Returning the observed
    // value forces the server CAS to retry with the authoritative snapshot.
    result = await transact((existing) => existing ?? null, undefined, false);
  } catch (error) {
    throw new HttpsError(
      transactionFailureStatus(error),
      'The Maze Authority view manifest could not be read.',
    );
  }
  return parsePersistedManifest(
    projectionTransactionValue(
      result,
      'The Maze Authority view manifest transaction returned invalid data.',
    ),
    roomId,
  );
}

async function deleteProjectionAtSourceVersion(input: {
  source: MazeAuthorityState;
  path: string;
  audience: 'public' | 'member';
  viewerUid?: string;
}, dependencies: MazeAuthorityProjectionDependencies): Promise<MazeAuthorityProjectionCleanupResult> {
  const transact = getProjectionTransaction(input.path, dependencies);
  let result: MazeAuthorityProjectionTransactionResult;
  let sawExisting = false;
  try {
    result = await transact((existing) => {
      if (existing == null) return null;
      sawExisting = true;
      if (versionIsNewer(
        existing,
        input.source.meta,
        'viewVersion',
        MAZE_AUTHORITY_VIEW_VERSION,
      )) return undefined;
      return null;
    }, undefined, false);
  } catch (error) {
    throw new HttpsError(
      transactionFailureStatus(error),
      'The Maze Authority stale view cleanup did not complete.',
    );
  }
  const persisted = projectionTransactionValue(
    result,
    'The Maze Authority stale view cleanup returned invalid data.',
  );
  if (persisted == null) {
    return {
      audience: input.audience,
      ...(input.viewerUid ? { viewerUid: input.viewerUid } : {}),
      path: input.path,
      replayed: !sawExisting,
    };
  }
  if (versionIsNewer(
    persisted,
    input.source.meta,
    'viewVersion',
    MAZE_AUTHORITY_VIEW_VERSION,
  )) {
    throw new HttpsError('aborted', 'A newer Maze Authority view is already committed.');
  }
  throw new HttpsError('data-loss', 'The Maze Authority stale view cleanup is inconsistent.');
}

async function commitViewManifest(
  candidate: MazeAuthorityViewManifest,
  dependencies: MazeAuthorityProjectionDependencies,
): Promise<boolean> {
  const path = mazeAuthorityViewManifestPath(candidate.roomId);
  const persistedCandidate = normalizeRoot(candidate, true);
  if (!persistedCandidate) {
    throw new HttpsError('resource-exhausted', 'The Maze Authority view manifest is too large.');
  }
  const transact = getProjectionTransaction(path, dependencies);
  let result: MazeAuthorityProjectionTransactionResult;
  try {
    result = await transact((existing) => {
      if (versionIsNewer(
        existing,
        candidate,
        'manifestVersion',
        MAZE_AUTHORITY_VIEW_MANIFEST_VERSION,
      )) return undefined;
      if (manifestMatchesCandidate(existing, candidate)) return undefined;
      return persistedCandidate;
    }, undefined, false);
  } catch (error) {
    throw new HttpsError(
      transactionFailureStatus(error),
      'The Maze Authority view manifest transaction did not complete.',
    );
  }
  const persisted = projectionTransactionValue(
    result,
    'The Maze Authority view manifest transaction returned invalid data.',
  );
  if (manifestMatchesCandidate(persisted, candidate)) return !result.committed;
  if (versionIsNewer(
    persisted,
    candidate,
    'manifestVersion',
    MAZE_AUTHORITY_VIEW_MANIFEST_VERSION,
  )) {
    throw new HttpsError('aborted', 'A newer Maze Authority view manifest is already committed.');
  }
  throw new HttpsError('data-loss', 'The committed Maze Authority view manifest is inconsistent.');
}

async function deleteViewManifest(
  source: MazeAuthorityState,
  dependencies: MazeAuthorityProjectionDependencies,
): Promise<boolean> {
  const path = mazeAuthorityViewManifestPath(source.meta.roomId);
  const transact = getProjectionTransaction(path, dependencies);
  let result: MazeAuthorityProjectionTransactionResult;
  let sawExisting = false;
  try {
    result = await transact((existing) => {
      if (existing == null) return null;
      sawExisting = true;
      if (versionIsNewer(
        existing,
        source.meta,
        'manifestVersion',
        MAZE_AUTHORITY_VIEW_MANIFEST_VERSION,
      )) return undefined;
      return null;
    }, undefined, false);
  } catch (error) {
    throw new HttpsError(
      transactionFailureStatus(error),
      'The Maze Authority view manifest cleanup did not complete.',
    );
  }
  const persisted = projectionTransactionValue(
    result,
    'The Maze Authority view manifest cleanup returned invalid data.',
  );
  if (persisted == null) return !sawExisting;
  if (versionIsNewer(
    persisted,
    source.meta,
    'manifestVersion',
    MAZE_AUTHORITY_VIEW_MANIFEST_VERSION,
  )) {
    throw new HttpsError('aborted', 'A newer Maze Authority view manifest is already committed.');
  }
  throw new HttpsError('data-loss', 'The Maze Authority view manifest cleanup is inconsistent.');
}

function orderedMemberIds(state: MazeAuthorityState): string[] {
  return Object.values(state.lobby.members)
    .slice()
    .sort((left, right) => left.slot - right.slot)
    .map((member) => member.uid);
}

function knownProjectionMemberIds(
  state: MazeAuthorityState,
  previousManifest: MazeAuthorityViewManifest | null,
): string[] {
  const known = new Set(previousManifest?.memberUids ?? []);
  const manifestPredatesSource = previousManifest === null
    || previousManifest.generation < state.meta.generation
    || (previousManifest.generation === state.meta.generation
      && previousManifest.revision < state.meta.revision);
  if (manifestPredatesSource) {
    for (const receipt of Object.values(state.receipts.byId)) known.add(receipt.actorId);
    for (const uid of Object.keys(state.lobby.members)) known.add(uid);
    for (const uid of Object.keys(state.gameState.players)) known.add(uid);
    for (const uid of Object.keys(state.gameState.maps ?? {})) known.add(uid);
    if (isValidMazeAuthorityViewUid(state.lobby.ownerId)) known.add(state.lobby.ownerId);
  }
  return [...known];
}

export async function finalizeMazeAuthorityViewProjection(
  rawAuthorityState: unknown,
  dependencies: MazeAuthorityProjectionDependencies,
): Promise<MazeAuthorityProjectionFinalizationResponse> {
  let state: MazeAuthorityState;
  try {
    state = parseMazeAuthorityState(rawAuthorityState);
  } catch (error) {
    if (error instanceof MazeAuthorityDomainError) {
      throw new HttpsError('data-loss', 'The Maze Authority source failed validation.', {
        reason: error.reason,
      });
    }
    throw new HttpsError('data-loss', 'The Maze Authority source failed validation.');
  }

  const manifestPath = mazeAuthorityViewManifestPath(state.meta.roomId);
  const previousManifest = await readViewManifest(state.meta.roomId, dependencies);
  const knownMemberUids = knownProjectionMemberIds(state, previousManifest);
  const cleanups: MazeAuthorityProjectionCleanupResult[] = [];

  if (state.lobby.status === 'closed') {
    cleanups.push(await deleteProjectionAtSourceVersion({
      source: state,
      path: mazeAuthorityPublicViewPath(state.meta.roomId),
      audience: 'public',
    }, dependencies));
    for (const uid of knownMemberUids) {
      cleanups.push(await deleteProjectionAtSourceVersion({
        source: state,
        path: mazeAuthorityMemberViewPath(uid, state.meta.roomId),
        audience: 'member',
        viewerUid: uid,
      }, dependencies));
    }
    const manifestReplayed = await deleteViewManifest(state, dependencies);
    return {
      ok: true,
      roomId: state.meta.roomId,
      generation: state.meta.generation,
      revision: state.meta.revision,
      closed: true,
      manifestPath,
      manifestReplayed,
      cleanups,
    };
  }

  const memberUids = orderedMemberIds(state);
  const currentMembers = new Set(memberUids);
  for (const uid of knownMemberUids) {
    if (currentMembers.has(uid)) continue;
    cleanups.push(await deleteProjectionAtSourceVersion({
      source: state,
      path: mazeAuthorityMemberViewPath(uid, state.meta.roomId),
      audience: 'member',
      viewerUid: uid,
    }, dependencies));
  }
  const manifestReplayed = await commitViewManifest({
    manifestVersion: MAZE_AUTHORITY_VIEW_MANIFEST_VERSION,
    roomId: state.meta.roomId,
    generation: state.meta.generation,
    revision: state.meta.revision,
    memberUids,
  }, dependencies);
  return {
    ok: true,
    roomId: state.meta.roomId,
    generation: state.meta.generation,
    revision: state.meta.revision,
    closed: false,
    manifestPath,
    manifestReplayed,
    cleanups,
  };
}

export async function syncMazeAuthorityViewProjection(
  rawAuthorityState: unknown,
  dependencies: MazeAuthorityProjectionDependencies,
): Promise<MazeAuthorityProjectionResponse> {
  let state: MazeAuthorityState;
  try {
    state = parseMazeAuthorityState(rawAuthorityState);
  } catch (error) {
    if (error instanceof MazeAuthorityDomainError) {
      throw new HttpsError('data-loss', 'The Maze Authority source failed validation.', {
        reason: error.reason,
      });
    }
    throw new HttpsError('data-loss', 'The Maze Authority source failed validation.');
  }

  if (state.lobby.status === 'closed') {
    return {
      ok: true,
      roomId: state.meta.roomId,
      generation: state.meta.generation,
      revision: state.meta.revision,
      replayed: true,
      writes: [],
    };
  }

  const publicCandidate = buildMazeAuthorityPublicView(state);
  const memberIds = orderedMemberIds(state);
  const candidates: Array<{ candidate: MazeAuthorityProjectionCandidate; path: string }> = [
    { candidate: publicCandidate, path: mazeAuthorityPublicViewPath(state.meta.roomId) },
    ...memberIds.map((uid) => ({
      candidate: buildMazeAuthorityMemberView(state, uid),
      path: mazeAuthorityMemberViewPath(uid, state.meta.roomId),
    })),
  ];

  const writes: MazeAuthorityProjectionWriteResult[] = [];
  for (const { candidate, path } of candidates) {
    writes.push(await writeCandidate(candidate, path, dependencies));
  }
  return {
    ok: true,
    roomId: state.meta.roomId,
    generation: state.meta.generation,
    revision: state.meta.revision,
    replayed: writes.every((write) => write.replayed),
    writes,
  };
}
