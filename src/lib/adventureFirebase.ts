'use client';

import type { User } from 'firebase/auth';
import {
  get,
  limitToLast,
  onDisconnect,
  onValue,
  orderByChild,
  query,
  ref,
  remove,
  serverTimestamp,
  set,
  update,
  type Database,
  type OnDisconnect,
  type Unsubscribe,
} from 'firebase/database';
import {
  CLASS_IDS,
  deriveStats,
  sanitizeAdventureState,
  type AdventureState,
  type CharacterClassId,
} from '@/lib/adventure';
import { firebaseInitPromise } from '@/lib/firebase';

const ADVENTURE_STATE_PATH = 'adventure/v1';
const MAX_RANKING_ENTRIES = 100;
const INVALID_FIREBASE_KEY = /[.#$\[\]/]/;

export type AdventureTimestamp = number | ReturnType<typeof serverTimestamp>;
export type AdventureUser = Pick<User, 'uid' | 'displayName' | 'photoURL'>;

export interface AdventureRankingEntry {
  uid: string;
  displayName: string;
  photoURL?: string;
  classId: CharacterClassId;
  level: number;
  masteryLevel: number;
  power: number;
  totalKills: number;
  bossesKilled: number;
  collectionCount: number;
  updatedAt: AdventureTimestamp;
}

export interface AdventurePresenceEntry {
  uid: string;
  displayName: string;
  photoURL?: string;
  connectedAt: AdventureTimestamp;
  lastSeen: AdventureTimestamp;
}

function assertValidUid(uid: string): void {
  if (!uid || INVALID_FIREBASE_KEY.test(uid)) {
    throw new Error('유효하지 않은 Firebase 사용자 ID입니다.');
  }
}

async function getAdventureDatabase(): Promise<Database> {
  const initialized = await firebaseInitPromise;
  if (!initialized?.database) {
    throw new Error('Firebase Database를 초기화하지 못했습니다.');
  }
  return initialized.database;
}

function displayNameFor(user: AdventureUser, fallback: string): string {
  return (user.displayName?.trim() || fallback.trim() || '모험가').slice(0, 50);
}

function optionalPhotoURL(user: AdventureUser): Pick<AdventureRankingEntry, 'photoURL'> {
  const photoURL = user.photoURL?.trim();
  return photoURL ? { photoURL: photoURL.slice(0, 2048) } : {};
}

function createRankingEntry(user: AdventureUser, state: AdventureState): AdventureRankingEntry {
  return {
    uid: user.uid,
    displayName: (state.name.trim() || user.displayName?.trim() || '모험가').slice(0, 50),
    ...optionalPhotoURL(user),
    classId: state.classId,
    level: state.level,
    masteryLevel: state.mastery.level,
    power: deriveStats(state).power,
    totalKills: state.statistics.totalKills,
    bossesKilled: state.statistics.bossesKilled,
    collectionCount: state.discoveredItemKeys.length,
    updatedAt: serverTimestamp(),
  };
}

export async function saveAdventureStateAndRanking(user: AdventureUser, state: AdventureState): Promise<void> {
  assertValidUid(user.uid);
  const database = await getAdventureDatabase();
  const ranking = createRankingEntry(user, state);
  const persistedState = {
    ...state,
    rankingPower: ranking.power,
    rankingCollectionCount: ranking.collectionCount,
  };

  await update(ref(database), {
    [`users/${user.uid}/${ADVENTURE_STATE_PATH}`]: persistedState,
    [`adventureRankings/${user.uid}`]: ranking,
  });
}

export async function loadAdventureState(uid: string): Promise<AdventureState | null> {
  assertValidUid(uid);
  const database = await getAdventureDatabase();
  const snapshot = await get(ref(database, `users/${uid}/${ADVENTURE_STATE_PATH}`));
  return snapshot.exists() ? sanitizeAdventureState(snapshot.val()) : null;
}

export async function resetAdventureStateAndRanking(uid: string): Promise<void> {
  assertValidUid(uid);
  const database = await getAdventureDatabase();
  await update(ref(database), {
    [`users/${uid}/${ADVENTURE_STATE_PATH}`]: null,
    [`adventureRankings/${uid}`]: null,
  });
}

function subscribeAfterInitialization(
  attach: (database: Database) => Unsubscribe,
  onError: (error: unknown) => void,
): Unsubscribe {
  let active = true;
  let unsubscribe: Unsubscribe | null = null;

  void getAdventureDatabase()
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function parseRankingEntry(key: string | null, value: unknown): AdventureRankingEntry | null {
  if (!key || !isRecord(value) || value.uid !== key) return null;
  if (typeof value.displayName !== 'string' || !CLASS_IDS.includes(value.classId as CharacterClassId)) return null;
  if (!isNonNegativeInteger(value.level) || !isNonNegativeInteger(value.masteryLevel)) return null;
  if (!isNonNegativeInteger(value.power) || !isNonNegativeInteger(value.totalKills)) return null;
  if (!isNonNegativeInteger(value.bossesKilled) || !isNonNegativeInteger(value.collectionCount)) return null;
  if (!isNonNegativeInteger(value.updatedAt)) return null;

  const photoURL = typeof value.photoURL === 'string' && value.photoURL ? value.photoURL : undefined;
  return {
    uid: key,
    displayName: value.displayName,
    ...(photoURL ? { photoURL } : {}),
    classId: value.classId as CharacterClassId,
    level: value.level,
    masteryLevel: value.masteryLevel,
    power: value.power,
    totalKills: value.totalKills,
    bossesKilled: value.bossesKilled,
    collectionCount: value.collectionCount,
    updatedAt: value.updatedAt,
  };
}

function compareRankingEntries(left: AdventureRankingEntry, right: AdventureRankingEntry): number {
  return right.power - left.power
    || right.level - left.level
    || right.totalKills - left.totalKills
    || right.bossesKilled - left.bossesKilled
    || left.uid.localeCompare(right.uid);
}

export function subscribeAdventureRankings(
  callback: (entries: AdventureRankingEntry[]) => void,
  limit = MAX_RANKING_ENTRIES,
): Unsubscribe {
  const safeLimit = Number.isFinite(limit)
    ? Math.max(1, Math.min(MAX_RANKING_ENTRIES, Math.floor(limit)))
    : MAX_RANKING_ENTRIES;

  return subscribeAfterInitialization((database) => {
    const rankingsQuery = query(
      ref(database, 'adventureRankings'),
      orderByChild('power'),
      limitToLast(safeLimit),
    );
    return onValue(rankingsQuery, (snapshot) => {
      const entries: AdventureRankingEntry[] = [];
      snapshot.forEach((childSnapshot) => {
        const entry = parseRankingEntry(childSnapshot.key, childSnapshot.val());
        if (entry) entries.push(entry);
      });
      callback(entries.sort(compareRankingEntries));
    }, (error) => {
      console.error('모험 랭킹 구독 오류:', error);
      callback([]);
    });
  }, (error) => {
    console.error('모험 랭킹 초기화 오류:', error);
    callback([]);
  });
}

export function subscribeAdventureState(
  uid: string,
  callback: (state: AdventureState | null) => void,
): Unsubscribe {
  assertValidUid(uid);
  return subscribeAfterInitialization((database) => onValue(
    ref(database, `users/${uid}/${ADVENTURE_STATE_PATH}`),
    (snapshot) => callback(snapshot.exists() ? sanitizeAdventureState(snapshot.val()) : null),
    (error) => {
      console.error('모험 상태 구독 오류:', error);
      callback(null);
    },
  ), (error) => {
    console.error('모험 상태 초기화 오류:', error);
    callback(null);
  });
}

function createPresenceEntry(user: AdventureUser): AdventurePresenceEntry {
  const timestamp = serverTimestamp();
  return {
    uid: user.uid,
    displayName: displayNameFor(user, '모험가'),
    ...optionalPhotoURL(user),
    connectedAt: timestamp,
    lastSeen: timestamp,
  };
}

export function startAdventurePresence(user: AdventureUser): Unsubscribe {
  assertValidUid(user.uid);
  let active = true;
  let connectionEpoch = 0;
  let stopConnectionListener: Unsubscribe | null = null;
  let presenceRef: ReturnType<typeof ref> | null = null;
  let disconnectRegistration: OnDisconnect | null = null;

  void getAdventureDatabase()
    .then((database) => {
      if (!active) return;
      presenceRef = ref(database, `adventurePresence/${user.uid}`);
      const connectedRef = ref(database, '.info/connected');

      stopConnectionListener = onValue(connectedRef, (snapshot) => {
        if (snapshot.val() !== true || !active || !presenceRef) return;
        const epoch = ++connectionEpoch;
        const currentPresenceRef = presenceRef;
        const registration = onDisconnect(currentPresenceRef);
        disconnectRegistration = registration;

        void registration.remove()
          .then(async () => {
            if (!active || epoch !== connectionEpoch) {
              await registration.cancel();
              return;
            }
            await set(currentPresenceRef, createPresenceEntry(user));
          })
          .catch((error: unknown) => {
            if (active) console.error('모험 접속 상태 등록 오류:', error);
          });
      }, (error) => {
        console.error('Firebase 연결 상태 구독 오류:', error);
      });
    })
    .catch((error: unknown) => {
      if (active) console.error('모험 접속 상태 초기화 오류:', error);
    });

  return () => {
    active = false;
    connectionEpoch += 1;
    stopConnectionListener?.();
    if (disconnectRegistration) void disconnectRegistration.cancel();
    if (presenceRef) void remove(presenceRef);
  };
}

export function subscribeAdventureOnlineCount(callback: (count: number) => void): Unsubscribe {
  return subscribeAfterInitialization((database) => onValue(
    ref(database, 'adventurePresence'),
    (snapshot) => callback(snapshot.size),
    (error) => {
      console.error('모험 접속자 수 구독 오류:', error);
      callback(0);
    },
  ), (error) => {
    console.error('모험 접속자 수 초기화 오류:', error);
    callback(0);
  });
}
