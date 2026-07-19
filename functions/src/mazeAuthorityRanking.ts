import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { HttpsError, type FunctionsErrorCode } from 'firebase-functions/v2/https';
import { mazeAuthorityStatePath } from './mazeAuthorityAdapter';
import {
  MazeAuthorityDomainError,
  parseMazeAuthorityState,
  type MazeAuthorityState,
} from './mazeAuthorityDomain';

export const MAZE_AUTHORITY_RANKING_COMPAT_ROOT = 'mazeRankings';
export const MAZE_AUTHORITY_RANKING_VIEW_ROOT = 'mazeAuthorityRankings/v1';
export const MAZE_AUTHORITY_RANKING_MIRROR_VERSION = 1 as const;
export const MAZE_AUTHORITY_INITIAL_RATING = 1_000 as const;

const MAX_UID_LENGTH = 128;
const MAX_NAME_LENGTH = 50;
const MAX_PHOTO_URL_LENGTH = 2_048;
const MAX_COUNTER = 1_000_000_000;
const MAX_BEST_MOVES = 1_000_000;
const MAX_SETTLEMENT_TRAIL_LENGTH = 1_000_000;
const INVALID_FIREBASE_KEY = /[.#$\[\]\/\u0000-\u001F\u007F-\u009F]/u;
const SAFE_ROOM_ID = /^[A-Za-z0-9_-]+$/u;

export type MazeAuthorityMatchResult = 'win' | 'draw' | 'loss';

export interface MazeAuthorityRankingProfile {
  displayName: string;
  photoURL?: string;
}

export interface MazeAuthorityRankingSettlement {
  settlementKey: string;
  roomId: string;
  generation: number;
  matchNumber: number;
  uid: string;
  result: MazeAuthorityMatchResult;
  finishMoves: number | null;
}

export interface MazeAuthorityRankingSourceRow {
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
  settlementCount: number;
  settledMatches: Record<string, true>;
  settlementTrail: string;
  lastGeneration?: number;
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
  source: 'mazeRankings-compat-v1';
  mirrorVersion: typeof MAZE_AUTHORITY_RANKING_MIRROR_VERSION;
  sourceSettlementCount: number;
  lastGeneration: number;
}

export interface MazeAuthorityRankingSnapshot {
  val(): unknown;
}

export interface MazeAuthorityRankingReadReference {
  get(): Promise<MazeAuthorityRankingSnapshot>;
}

export interface MazeAuthorityRankingTransactionResult {
  committed: boolean;
  snapshot: MazeAuthorityRankingSnapshot;
}

export interface MazeAuthorityRankingTransactionReference {
  get(): Promise<MazeAuthorityRankingSnapshot>;
  transaction(
    update: (current: unknown) => unknown,
    onComplete?: undefined,
    applyLocally?: boolean,
  ): Promise<MazeAuthorityRankingTransactionResult>;
}

export interface MazeAuthorityRankingDependencies {
  getAuthorityReference(path: string): MazeAuthorityRankingReadReference;
  getProfileReference(path: string): MazeAuthorityRankingReadReference;
  getRankingReference(path: string): MazeAuthorityRankingTransactionReference;
  getRankingViewReference(path: string): MazeAuthorityRankingTransactionReference;
}

export interface MazeAuthorityRankingSyncResponse {
  ok: true;
  roomId: string;
  generation: number;
  revision: number;
  matchNumber: number;
  terminal: boolean;
  settlementKey: string | null;
  participants: number;
  applied: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function safeInteger(value: unknown, minimum: number, maximum: number): value is number {
  return typeof value === 'number'
    && Number.isSafeInteger(value)
    && value >= minimum
    && value <= maximum;
}

function validUid(value: unknown): value is string {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= MAX_UID_LENGTH
    && value.trim() === value
    && !INVALID_FIREBASE_KEY.test(value);
}

function validRoomId(value: unknown): value is string {
  return typeof value === 'string'
    && value.length >= 8
    && value.length <= 64
    && SAFE_ROOM_ID.test(value)
    && !INVALID_FIREBASE_KEY.test(value);
}

function validDisplayName(value: unknown): value is string {
  return typeof value === 'string'
    && value.trim() === value
    && value.length > 0
    && value.length <= MAX_NAME_LENGTH;
}

function normalizedDisplayName(value: unknown, fallback: unknown): string {
  if (typeof value === 'string') {
    const candidate = value.trim().slice(0, MAX_NAME_LENGTH);
    if (candidate.length > 0) return candidate;
  }
  return validDisplayName(fallback) ? fallback : '플레이어';
}

function normalizedPhotoURL(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.length === 0 || value.length > MAX_PHOTO_URL_LENGTH) {
    return undefined;
  }
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'https:' && parsed.hostname === 'lh3.googleusercontent.com'
      ? value
      : undefined;
  } catch {
    return undefined;
  }
}

function parseSettledMatches(value: unknown): Record<string, true> | null {
  if (value == null) return {};
  if (!isRecord(value)) return null;
  const entries = Object.entries(value);
  const parsed: Record<string, true> = {};
  for (const [key, settled] of entries) {
    if (settled !== true
      || key.length === 0
      || key.length > 160
      || INVALID_FIREBASE_KEY.test(key)) return null;
    parsed[key] = true;
  }
  return parsed;
}

function parseSourceRow(value: unknown, uid: string): MazeAuthorityRankingSourceRow | null {
  if (!isRecord(value) || value.uid !== uid || !validDisplayName(value.displayName)) return null;
  const settledMatches = parseSettledMatches(value.settledMatches);
  if (!settledMatches
    || !safeInteger(value.wins, 0, MAX_COUNTER)
    || !safeInteger(value.losses, 0, MAX_COUNTER)
    || !safeInteger(value.draws, 0, MAX_COUNTER)
    || !safeInteger(value.played, 0, MAX_COUNTER)
    || value.played !== value.wins + value.losses + value.draws
    || !safeInteger(value.rating, 0, MAX_COUNTER)
    || !safeInteger(value.bestMoves, 0, MAX_BEST_MOVES)
    || typeof value.lastRoomId !== 'string'
    || value.lastRoomId.length > 128
    || !safeInteger(value.lastMatchNumber, 0, MAX_COUNTER)
    || !safeInteger(value.updatedAt, 0, Number.MAX_SAFE_INTEGER)
    || !safeInteger(value.settlementCount, 0, MAX_COUNTER)
    || value.settlementCount !== Object.keys(settledMatches).length
    || typeof value.settlementTrail !== 'string'
    || !value.settlementTrail.startsWith('|')
    || value.settlementTrail.length > MAX_SETTLEMENT_TRAIL_LENGTH
    || (value.lastGeneration != null
      && !safeInteger(value.lastGeneration, 1, Number.MAX_SAFE_INTEGER))) return null;

  const photoURL = normalizedPhotoURL(value.photoURL);
  return {
    uid,
    displayName: value.displayName,
    ...(photoURL ? { photoURL } : {}),
    wins: value.wins,
    losses: value.losses,
    draws: value.draws,
    played: value.played,
    rating: value.rating,
    bestMoves: value.bestMoves,
    lastRoomId: value.lastRoomId,
    lastMatchNumber: value.lastMatchNumber,
    updatedAt: value.updatedAt,
    settlementCount: value.settlementCount,
    settledMatches,
    settlementTrail: value.settlementTrail,
    ...(value.lastGeneration == null ? {} : { lastGeneration: value.lastGeneration }),
  };
}

function emptySourceRow(
  uid: string,
  profile: MazeAuthorityRankingProfile,
): MazeAuthorityRankingSourceRow {
  return {
    uid,
    displayName: profile.displayName,
    ...(profile.photoURL ? { photoURL: profile.photoURL } : {}),
    wins: 0,
    losses: 0,
    draws: 0,
    played: 0,
    rating: MAZE_AUTHORITY_INITIAL_RATING,
    bestMoves: 0,
    lastRoomId: '',
    lastMatchNumber: 0,
    updatedAt: 0,
    settlementCount: 0,
    settledMatches: {},
    settlementTrail: '|',
  };
}

export function mazeAuthorityRankingSettlementKey(
  roomId: string,
  generation: number,
  matchNumber: number,
): string {
  if (!validRoomId(roomId)
    || !safeInteger(generation, 1, Number.MAX_SAFE_INTEGER)
    || !safeInteger(matchNumber, 1, MAX_COUNTER)) {
    throw new Error('Invalid Maze Authority ranking settlement identity');
  }
  const digest = createHash('sha256')
    .update(`maze-ranking:v1\0${roomId}\0${generation}\0${matchNumber}`, 'utf8')
    .digest('hex');
  return `a_${digest}`;
}

export function buildMazeAuthorityRankingSettlements(
  state: MazeAuthorityState,
): MazeAuthorityRankingSettlement[] {
  if (state.gameState.phase !== 'end') return [];
  const matchNumber = state.gameState.matchNumber;
  if (!safeInteger(matchNumber, 1, MAX_COUNTER)) {
    throw new Error('Terminal Maze Authority state has no match number');
  }
  const participantIds = state.gameState.turnOrder ?? [];
  if (participantIds.length < 2 || participantIds.length > 4 || new Set(participantIds).size !== participantIds.length) {
    throw new Error('Terminal Maze Authority roster is malformed');
  }
  const settlementKey = mazeAuthorityRankingSettlementKey(
    state.meta.roomId,
    state.meta.generation,
    matchNumber,
  );
  const draw = state.gameState.draw === true;
  const winner = state.gameState.winner;
  if (!draw && !validUid(winner)) throw new Error('Terminal Maze Authority result is malformed');

  return participantIds.map((uid) => {
    if (!validUid(uid)) throw new Error('Terminal Maze Authority participant is malformed');
    const player = state.gameState.players[uid];
    if (!player) throw new Error('Terminal Maze Authority participant is missing');
    const finishMoves = player.finished === true
      && player.forfeited !== true
      && safeInteger(player.finishMoves, 1, MAX_BEST_MOVES)
      ? player.finishMoves
      : null;
    return {
      settlementKey,
      roomId: state.meta.roomId,
      generation: state.meta.generation,
      matchNumber,
      uid,
      result: draw ? 'draw' : winner === uid ? 'win' : 'loss',
      finishMoves,
    };
  });
}

export function applyMazeAuthorityRankingSettlement(
  currentValue: unknown,
  profile: MazeAuthorityRankingProfile,
  settlement: MazeAuthorityRankingSettlement,
  now: number,
): { row: MazeAuthorityRankingSourceRow; applied: boolean } {
  if (!validUid(settlement.uid)
    || !validRoomId(settlement.roomId)
    || !safeInteger(settlement.generation, 1, Number.MAX_SAFE_INTEGER)
    || !safeInteger(settlement.matchNumber, 1, MAX_COUNTER)
    || !['win', 'draw', 'loss'].includes(settlement.result)
    || (settlement.finishMoves != null
      && !safeInteger(settlement.finishMoves, 1, MAX_BEST_MOVES))
    || settlement.settlementKey !== mazeAuthorityRankingSettlementKey(
      settlement.roomId,
      settlement.generation,
      settlement.matchNumber,
    )
    || !safeInteger(now, 0, Number.MAX_SAFE_INTEGER)) {
    throw new Error('Invalid Maze Authority ranking settlement');
  }

  const current = currentValue == null
    ? emptySourceRow(settlement.uid, profile)
    : parseSourceRow(currentValue, settlement.uid);
  if (!current) throw new Error('Existing maze ranking row is malformed');
  if (current.settledMatches[settlement.settlementKey]) return { row: current, applied: false };
  if (current.settlementCount >= MAX_COUNTER || current.played >= MAX_COUNTER) {
    throw new Error('Maze ranking counter capacity reached');
  }
  const trailAppend = `${settlement.settlementKey}|`;
  if (current.settlementTrail.length + trailAppend.length > MAX_SETTLEMENT_TRAIL_LENGTH) {
    throw new Error('Maze ranking settlement ledger capacity reached');
  }

  const displayName = normalizedDisplayName(profile.displayName, current.displayName);
  const photoURL = normalizedPhotoURL(profile.photoURL) ?? current.photoURL;
  const wins = current.wins + (settlement.result === 'win' ? 1 : 0);
  const losses = current.losses + (settlement.result === 'loss' ? 1 : 0);
  const draws = current.draws + (settlement.result === 'draw' ? 1 : 0);
  const ratingDelta = settlement.result === 'win' ? 20 : settlement.result === 'loss' ? -12 : 0;
  const bestMoves = settlement.finishMoves != null
    && (current.bestMoves === 0 || settlement.finishMoves < current.bestMoves)
    ? settlement.finishMoves
    : current.bestMoves;
  return {
    applied: true,
    row: {
      ...current,
      displayName,
      ...(photoURL ? { photoURL } : {}),
      wins,
      losses,
      draws,
      played: current.played + 1,
      rating: Math.max(0, current.rating + ratingDelta),
      bestMoves,
      lastRoomId: settlement.roomId,
      lastMatchNumber: settlement.matchNumber,
      updatedAt: Math.max(now, current.updatedAt),
      settlementCount: current.settlementCount + 1,
      settledMatches: {
        ...current.settledMatches,
        [settlement.settlementKey]: true,
      },
      settlementTrail: `${current.settlementTrail}${trailAppend}`,
      lastGeneration: settlement.generation,
    },
  };
}

export function buildMazeAuthorityRankingView(
  row: MazeAuthorityRankingSourceRow,
): MazeAuthorityRankingView {
  if (!safeInteger(row.lastGeneration, 1, Number.MAX_SAFE_INTEGER)
    || row.settlementCount < 1
    || !validRoomId(row.lastRoomId)
    || row.lastMatchNumber < 1) {
    throw new Error('Maze Authority ranking source has no Authority settlement');
  }
  return {
    uid: row.uid,
    displayName: row.displayName,
    ...(row.photoURL ? { photoURL: row.photoURL } : {}),
    wins: row.wins,
    losses: row.losses,
    draws: row.draws,
    played: row.played,
    rating: row.rating,
    bestMoves: row.bestMoves,
    lastRoomId: row.lastRoomId,
    lastMatchNumber: row.lastMatchNumber,
    updatedAt: row.updatedAt,
    source: 'mazeRankings-compat-v1',
    mirrorVersion: MAZE_AUTHORITY_RANKING_MIRROR_VERSION,
    sourceSettlementCount: row.settlementCount,
    lastGeneration: row.lastGeneration,
  };
}

function transactionFailureStatus(error: unknown): FunctionsErrorCode {
  try {
    const record = isRecord(error) ? error : null;
    const code = typeof record?.code === 'string' ? record.code.toLowerCase() : '';
    const message = error instanceof Error ? error.message.toLowerCase() : '';
    const signal = `${code} ${message}`.replace(/[_-]+/gu, ' ');
    return /max\s*retr(?:y|i)/u.test(signal) || signal.includes('aborted')
      ? 'aborted'
      : 'unavailable';
  } catch {
    return 'unavailable';
  }
}

async function readAuthorityState(
  roomId: string,
  dependencies: MazeAuthorityRankingDependencies,
): Promise<MazeAuthorityState> {
  let raw: unknown;
  try {
    const snapshot = await dependencies.getAuthorityReference(mazeAuthorityStatePath(roomId)).get();
    if (!snapshot || typeof snapshot.val !== 'function') throw new Error('invalid snapshot');
    raw = snapshot.val();
  } catch {
    throw new HttpsError('unavailable', 'The Maze Authority ranking source could not be read.');
  }
  if (raw == null) throw new HttpsError('not-found', 'The Maze Authority room does not exist.');
  try {
    const state = parseMazeAuthorityState(raw);
    if (state.meta.roomId !== roomId) throw new Error('foreign state');
    return state;
  } catch (error) {
    const reason = error instanceof MazeAuthorityDomainError ? error.reason : undefined;
    throw new HttpsError('data-loss', 'The Maze Authority ranking source failed validation.', reason ? { reason } : undefined);
  }
}

async function readProfile(
  uid: string,
  dependencies: MazeAuthorityRankingDependencies,
): Promise<MazeAuthorityRankingProfile> {
  try {
    const [nameSnapshot, photoSnapshot] = await Promise.all([
      dependencies.getProfileReference(`users/${uid}/displayName`).get(),
      dependencies.getProfileReference(`users/${uid}/photoURL`).get(),
    ]);
    return {
      displayName: normalizedDisplayName(nameSnapshot.val(), '플레이어'),
      ...(normalizedPhotoURL(photoSnapshot.val())
        ? { photoURL: normalizedPhotoURL(photoSnapshot.val()) }
        : {}),
    };
  } catch {
    throw new HttpsError('unavailable', 'The Maze Authority player profile could not be read.');
  }
}

async function settleParticipant(
  settlement: MazeAuthorityRankingSettlement,
  profile: MazeAuthorityRankingProfile,
  now: number,
  dependencies: MazeAuthorityRankingDependencies,
): Promise<boolean> {
  const sourcePath = `${MAZE_AUTHORITY_RANKING_COMPAT_ROOT}/${settlement.uid}`;
  const viewPath = `${MAZE_AUTHORITY_RANKING_VIEW_ROOT}/${settlement.uid}`;
  let applied = false;
  let result: MazeAuthorityRankingTransactionResult;
  try {
    result = await dependencies.getRankingReference(sourcePath).transaction((current) => {
      const mutation = applyMazeAuthorityRankingSettlement(current, profile, settlement, now);
      applied = mutation.applied;
      return mutation.applied ? mutation.row : undefined;
    }, undefined, false);
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    const capacity = message.includes('capacity');
    const malformed = message.includes('malformed');
    throw new HttpsError(
      capacity ? 'resource-exhausted' : malformed ? 'data-loss' : transactionFailureStatus(error),
      capacity
        ? 'The Maze Authority ranking ledger is full.'
        : malformed
          ? 'The existing Maze ranking row failed validation.'
          : 'The Maze Authority ranking transaction did not complete.',
    );
  }
  if (!result || !result.snapshot || typeof result.snapshot.val !== 'function') {
    throw new HttpsError('data-loss', 'The Maze Authority ranking transaction returned invalid data.');
  }
  const row = parseSourceRow(result.snapshot.val(), settlement.uid);
  if (!row || row.settledMatches[settlement.settlementKey] !== true) {
    throw new HttpsError('data-loss', 'The Maze Authority ranking settlement did not commit.');
  }
  const candidate = buildMazeAuthorityRankingView(row);
  let viewResult: MazeAuthorityRankingTransactionResult;
  try {
    viewResult = await dependencies.getRankingViewReference(viewPath).transaction((current) => {
      if (isRecord(current)
        && safeInteger(current.sourceSettlementCount, 0, MAX_COUNTER)
        && current.sourceSettlementCount > candidate.sourceSettlementCount) return undefined;
      return isDeepStrictEqual(current, candidate) ? undefined : candidate;
    }, undefined, false);
  } catch (error) {
    throw new HttpsError(
      transactionFailureStatus(error),
      'The Maze Authority ranking view transaction did not complete.',
    );
  }
  if (!viewResult || !viewResult.snapshot || typeof viewResult.snapshot.val !== 'function'
    || !isDeepStrictEqual(viewResult.snapshot.val(), candidate)) {
    throw new HttpsError('data-loss', 'The Maze Authority ranking view did not converge.');
  }
  return applied;
}

export async function syncCurrentMazeAuthorityRankingSettlement(
  roomId: string,
  now: number,
  dependencies: MazeAuthorityRankingDependencies,
): Promise<MazeAuthorityRankingSyncResponse> {
  if (!safeInteger(now, 0, Number.MAX_SAFE_INTEGER)) {
    throw new HttpsError('internal', 'The Maze Authority ranking service is misconfigured.');
  }
  const state = await readAuthorityState(roomId, dependencies);
  if (state.gameState.phase !== 'end') {
    return {
      ok: true,
      roomId,
      generation: state.meta.generation,
      revision: state.meta.revision,
      matchNumber: state.gameState.matchNumber ?? 0,
      terminal: false,
      settlementKey: null,
      participants: 0,
      applied: 0,
    };
  }
  let settlements: MazeAuthorityRankingSettlement[];
  try {
    settlements = buildMazeAuthorityRankingSettlements(state);
  } catch {
    throw new HttpsError('data-loss', 'The terminal Maze Authority result is malformed.');
  }
  let applied = 0;
  for (const settlement of settlements) {
    const profile = await readProfile(settlement.uid, dependencies);
    if (await settleParticipant(settlement, profile, now, dependencies)) applied += 1;
  }
  return {
    ok: true,
    roomId,
    generation: state.meta.generation,
    revision: state.meta.revision,
    matchNumber: settlements[0]?.matchNumber ?? 0,
    terminal: true,
    settlementKey: settlements[0]?.settlementKey ?? null,
    participants: settlements.length,
    applied,
  };
}
