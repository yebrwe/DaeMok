'use client';

import type { User } from 'firebase/auth';
import {
  limitToLast,
  onValue,
  orderByChild,
  query,
  ref,
  runTransaction,
  serverTimestamp,
  type Database,
  type Unsubscribe,
} from 'firebase/database';
import { firebaseInitPromise } from '@/lib/firebase';

const MAX_RANKING_ENTRIES = 500;
const INVALID_FIREBASE_KEY = /[.#$\[\]\/]/;

export type MazeMatchResult = 'win' | 'draw' | 'loss';
export type MazeRankingUser = Pick<User, 'uid' | 'displayName' | 'photoURL'>;

export const MAZE_INITIAL_RATING = 1000;

export const MAZE_RATING_CHANGE: Readonly<Record<MazeMatchResult, number>> = Object.freeze({
  win: 20,
  draw: 0,
  loss: -12,
});

export interface MazeRankingEntry {
  uid: string;
  displayName: string;
  photoURL?: string;
  wins: number;
  losses: number;
  draws: number;
  played: number;
  rating: number;
  bestMoves: number | null;
  lastRoomId: string;
  lastMatchNumber: number;
  updatedAt: number;
}

interface PersistedMazeRankingEntry extends Omit<MazeRankingEntry, 'bestMoves' | 'updatedAt'> {
  // Realtime Database removes null fields. Zero means the player has not finished a match yet.
  bestMoves: number;
  updatedAt: number | ReturnType<typeof serverTimestamp>;
  settlementCount: number;
  settledMatches: Record<string, true>;
  settlementTrail: string;
}

export interface MazeRankingSettlement {
  roomId: string;
  matchNumber: number;
  result: MazeMatchResult;
  // Pass finishMoves only when this player reached the goal.
  moves?: number | null;
}

export interface MazeRankingSettlementResult {
  applied: boolean;
  key: string;
  entry: MazeRankingEntry | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

function isValidFirebaseKey(value: unknown): value is string {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= 128
    && !INVALID_FIREBASE_KEY.test(value);
}

function assertValidFirebaseKey(value: string, label: string): void {
  if (!isValidFirebaseKey(value)) {
    throw new Error(`유효하지 않은 ${label}입니다.`);
  }
}

async function getMazeRankingDatabase(): Promise<Database> {
  const initialized = await firebaseInitPromise;
  if (!initialized?.database) {
    throw new Error('Firebase Database를 초기화하지 못했습니다.');
  }
  return initialized.database;
}

function normalizedDisplayName(user: MazeRankingUser): string {
  return (user.displayName?.trim() || '플레이어').slice(0, 50);
}

function normalizedPhotoURL(user: MazeRankingUser): string | undefined {
  const photoURL = user.photoURL?.trim();
  if (!photoURL || photoURL.length > 2048) return undefined;

  try {
    const parsed = new URL(photoURL);
    return parsed.protocol === 'https:' && parsed.hostname === 'lh3.googleusercontent.com'
      ? photoURL
      : undefined;
  } catch {
    return undefined;
  }
}

function parseSettledMatches(value: unknown): Record<string, true> {
  if (!isRecord(value)) return {};

  return Object.entries(value).reduce<Record<string, true>>((matches, [key, settled]) => {
    if (settled === true && key.length <= 160 && !INVALID_FIREBASE_KEY.test(key)) {
      matches[key] = true;
    }
    return matches;
  }, {});
}

function normalizePersistedEntry(
  value: unknown,
  user: MazeRankingUser,
  preservePersistedProfile = false,
): PersistedMazeRankingEntry {
  const raw = isRecord(value) ? value : {};
  const wins = isNonNegativeInteger(raw.wins) ? raw.wins : 0;
  const losses = isNonNegativeInteger(raw.losses) ? raw.losses : 0;
  const draws = isNonNegativeInteger(raw.draws) ? raw.draws : 0;
  const persistedDisplayName = typeof raw.displayName === 'string' && raw.displayName.length > 0 && raw.displayName.length <= 50
    ? raw.displayName
    : null;
  const persistedPhotoURL = typeof raw.photoURL === 'string'
    ? normalizedPhotoURL({ uid: user.uid, displayName: persistedDisplayName, photoURL: raw.photoURL })
    : undefined;
  const photoURL = preservePersistedProfile && persistedPhotoURL
    ? persistedPhotoURL
    : normalizedPhotoURL(user);

  const settledMatches = parseSettledMatches(raw.settledMatches);
  return {
    uid: user.uid,
    displayName: preservePersistedProfile && persistedDisplayName
      ? persistedDisplayName
      : normalizedDisplayName(user),
    ...(photoURL ? { photoURL } : {}),
    wins,
    losses,
    draws,
    played: wins + losses + draws,
    rating: isNonNegativeInteger(raw.rating) ? raw.rating : MAZE_INITIAL_RATING,
    bestMoves: isPositiveInteger(raw.bestMoves) ? raw.bestMoves : 0,
    lastRoomId: typeof raw.lastRoomId === 'string' ? raw.lastRoomId : '',
    lastMatchNumber: isPositiveInteger(raw.lastMatchNumber) ? raw.lastMatchNumber : 0,
    updatedAt: isNonNegativeInteger(raw.updatedAt) ? raw.updatedAt : 0,
    settlementCount: isNonNegativeInteger(raw.settlementCount)
      ? raw.settlementCount
      : Object.keys(settledMatches).length,
    settledMatches,
    settlementTrail: typeof raw.settlementTrail === 'string' && raw.settlementTrail.startsWith('|')
      ? raw.settlementTrail
      : '|',
  };
}

function parseRankingEntry(key: string | null, value: unknown): MazeRankingEntry | null {
  if (!key || !isRecord(value) || value.uid !== key) return null;
  if (typeof value.displayName !== 'string' || value.displayName.length === 0) return null;
  if (!isNonNegativeInteger(value.wins) || !isNonNegativeInteger(value.losses)) return null;
  if (!isNonNegativeInteger(value.draws) || !isNonNegativeInteger(value.played)) return null;
  if (!isNonNegativeInteger(value.rating) || !isNonNegativeInteger(value.updatedAt)) return null;
  if (!isNonNegativeInteger(value.bestMoves)) return null;
  if (!isValidFirebaseKey(value.lastRoomId)) return null;
  if (!isPositiveInteger(value.lastMatchNumber)) return null;

  const photoURL = typeof value.photoURL === 'string'
    ? normalizedPhotoURL({ uid: key, displayName: value.displayName, photoURL: value.photoURL })
    : undefined;

  return {
    uid: key,
    displayName: value.displayName,
    ...(photoURL ? { photoURL } : {}),
    wins: value.wins,
    losses: value.losses,
    draws: value.draws,
    played: value.played,
    rating: value.rating,
    bestMoves: value.bestMoves > 0 ? value.bestMoves : null,
    lastRoomId: value.lastRoomId,
    lastMatchNumber: value.lastMatchNumber,
    updatedAt: value.updatedAt,
  };
}

function compareRankingEntries(left: MazeRankingEntry, right: MazeRankingEntry): number {
  return right.rating - left.rating
    || right.wins - left.wins
    || left.losses - right.losses
    || (left.bestMoves ?? Number.MAX_SAFE_INTEGER) - (right.bestMoves ?? Number.MAX_SAFE_INTEGER)
    || left.uid.localeCompare(right.uid);
}

export function getMazeRankingSettlementKey(roomId: string, matchNumber: number): string {
  assertValidFirebaseKey(roomId, '방 ID');
  if (!isPositiveInteger(matchNumber)) {
    throw new Error('경기 번호는 1 이상의 정수여야 합니다.');
  }
  return `${roomId}:${matchNumber}`;
}

async function settleMazeRanking(
  user: MazeRankingUser,
  settlement: MazeRankingSettlement,
): Promise<MazeRankingSettlementResult> {
  assertValidFirebaseKey(user.uid, 'Firebase 사용자 ID');
  if (!(['win', 'draw', 'loss'] as MazeMatchResult[]).includes(settlement.result)) {
    throw new Error('유효하지 않은 경기 결과입니다.');
  }
  if (settlement.moves != null && !isPositiveInteger(settlement.moves)) {
    throw new Error('완주 턴은 1 이상의 정수여야 합니다.');
  }

  const key = getMazeRankingSettlementKey(settlement.roomId, settlement.matchNumber);
  const initialized = await firebaseInitPromise;
  const actorId = initialized?.auth.currentUser?.uid;
  if (!initialized?.database || !actorId) {
    throw new Error('인증된 경기 참가자만 랭킹을 정산할 수 있습니다.');
  }

  let applied = false;
  const result = await runTransaction(
    ref(initialized.database, `mazeRankings/${user.uid}`),
    (currentValue: unknown) => {
      const current = normalizePersistedEntry(currentValue, user, actorId !== user.uid);
      if (current.settledMatches[key]) {
        applied = false;
        return;
      }

      applied = true;
      const wins = current.wins + (settlement.result === 'win' ? 1 : 0);
      const losses = current.losses + (settlement.result === 'loss' ? 1 : 0);
      const draws = current.draws + (settlement.result === 'draw' ? 1 : 0);
      const completedMoves = settlement.moves ?? 0;
      const bestMoves = completedMoves > 0 && (current.bestMoves === 0 || completedMoves < current.bestMoves)
        ? completedMoves
        : current.bestMoves;

      return {
        ...current,
        wins,
        losses,
        draws,
        played: current.played + 1,
        rating: Math.max(0, current.rating + MAZE_RATING_CHANGE[settlement.result]),
        bestMoves,
        lastRoomId: settlement.roomId,
        lastMatchNumber: settlement.matchNumber,
        updatedAt: serverTimestamp(),
        settlementCount: current.settlementCount + 1,
        settledMatches: {
          ...current.settledMatches,
          [key]: true,
        },
        settlementTrail: `${current.settlementTrail}${key}|`,
      } satisfies PersistedMazeRankingEntry;
    },
    { applyLocally: false },
  );

  return {
    applied: result.committed && applied,
    key,
    entry: parseRankingEntry(user.uid, result.snapshot.val()),
  };
}

/**
 * Settles a terminal participant from any authenticated participant's client.
 * Database Rules derive the exact outcome from the immutable END state.
 */
export function settleMazeRankingParticipant(
  user: MazeRankingUser,
  settlement: MazeRankingSettlement,
): Promise<MazeRankingSettlementResult> {
  return settleMazeRanking(user, settlement);
}

function subscribeAfterInitialization(
  attach: (database: Database) => Unsubscribe,
  onError: (error: unknown) => void,
): Unsubscribe {
  let active = true;
  let unsubscribe: Unsubscribe | null = null;

  void getMazeRankingDatabase()
    .then((database) => {
      if (!active) return;
      unsubscribe = attach(database);
    })
    .catch((error: unknown) => {
      if (active) onError(error);
    });

  return () => {
    active = false;
    unsubscribe?.();
  };
}

export function subscribeMazeRankings(
  callback: (entries: MazeRankingEntry[]) => void,
  limit = 10,
): Unsubscribe {
  const safeLimit = Number.isFinite(limit)
    ? Math.max(1, Math.min(MAX_RANKING_ENTRIES, Math.floor(limit)))
    : 10;

  return subscribeAfterInitialization((database) => {
    const rankingsQuery = query(
      ref(database, 'mazeRankings'),
      orderByChild('rating'),
      limitToLast(safeLimit),
    );

    return onValue(rankingsQuery, (snapshot) => {
      const entries: MazeRankingEntry[] = [];
      snapshot.forEach((childSnapshot) => {
        const entry = parseRankingEntry(childSnapshot.key, childSnapshot.val());
        if (entry) entries.push(entry);
      });
      callback(entries.sort(compareRankingEntries));
    }, (error) => {
      console.error('미로 랭킹 구독 오류:', error);
      callback([]);
    });
  }, (error) => {
    console.error('미로 랭킹 초기화 오류:', error);
    callback([]);
  });
}

export function subscribeOwnMazeRanking(
  uid: string,
  callback: (entry: MazeRankingEntry | null) => void,
): Unsubscribe {
  assertValidFirebaseKey(uid, 'Firebase 사용자 ID');

  return subscribeAfterInitialization((database) => onValue(
    ref(database, `mazeRankings/${uid}`),
    (snapshot) => callback(parseRankingEntry(snapshot.key, snapshot.val())),
    (error) => {
      console.error('내 미로 랭킹 구독 오류:', error);
      callback(null);
    },
  ), (error) => {
    console.error('내 미로 랭킹 초기화 오류:', error);
    callback(null);
  });
}
