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
  runTransaction,
  serverTimestamp,
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
import { withAdventureTownState, type TownAdventureState } from '@/lib/adventureTown';
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
  resetGeneration: number;
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
    resetGeneration: state.resetGeneration,
    updatedAt: serverTimestamp(),
  };
}

export async function saveAdventureStateAndRanking(user: AdventureUser, state: TownAdventureState): Promise<void> {
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

export async function loadAdventureState(uid: string): Promise<TownAdventureState | null> {
  assertValidUid(uid);
  const database = await getAdventureDatabase();
  const snapshot = await get(ref(database, `users/${uid}/${ADVENTURE_STATE_PATH}`));
  if (!snapshot.exists()) return null;
  const raw = snapshot.val();
  return withAdventureTownState(sanitizeAdventureState(raw), isRecord(raw) ? raw.town : undefined);
}

export async function loadAdventureGeneration(uid: string): Promise<number> {
  assertValidUid(uid);
  const database = await getAdventureDatabase();
  const snapshot = await get(ref(database, `users/${uid}/adventureGeneration`));
  return typeof snapshot.val() === 'number' ? snapshot.val() : 0;
}

export async function resetAdventureStateAndRanking(uid: string): Promise<number> {
  assertValidUid(uid);
  const database = await getAdventureDatabase();
  let lastError: unknown = new Error('모험 초기화에 실패했습니다.');

  for (let attempt = 0; attempt < 8; attempt += 1) {
    const generationSnapshot = await get(ref(database, `users/${uid}/adventureGeneration`));
    const current = generationSnapshot.val();
    const generation = typeof current === 'number' && Number.isSafeInteger(current) ? current + 1 : 1;
    if (generation > 1_000_000) throw new Error('모험 초기화 횟수 제한을 초과했습니다.');

    try {
      await update(ref(database), {
        [`users/${uid}/adventureGeneration`]: generation,
        [`users/${uid}/${ADVENTURE_STATE_PATH}`]: null,
        [`adventureRankings/${uid}`]: null,
      });
      return generation;
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError;
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
  const resetGeneration = value.resetGeneration == null ? 0 : value.resetGeneration;
  if (!isNonNegativeInteger(resetGeneration)) return null;
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
    resetGeneration,
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
  callback: (state: TownAdventureState | null, generation: number) => void,
): Unsubscribe {
  assertValidUid(uid);
  return subscribeAfterInitialization((database) => onValue(
    ref(database, `users/${uid}`),
    (snapshot) => {
      const stateSnapshot = snapshot.child(ADVENTURE_STATE_PATH);
      const generation = snapshot.child('adventureGeneration').val();
      const raw = stateSnapshot.val();
      callback(stateSnapshot.exists()
        ? withAdventureTownState(sanitizeAdventureState(raw), isRecord(raw) ? raw.town : undefined)
        : null, typeof generation === 'number' ? generation : 0);
    },
    (error) => {
      console.error('모험 상태 구독 오류:', error);
    },
  ), (error) => {
    console.error('모험 상태 초기화 오류:', error);
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
  const startSlot = Math.floor(Math.random() * 8);
  let active = true;
  let connectionEpoch = 0;
  let stopConnectionListener: Unsubscribe | null = null;
  let presenceRef: ReturnType<typeof ref> | null = null;
  let disconnectRegistration: OnDisconnect | null = null;
  let heartbeatTimer: ReturnType<typeof setInterval> | null = null;

  void getAdventureDatabase()
    .then((database) => {
      if (!active) return;
      const connectedRef = ref(database, '.info/connected');

      stopConnectionListener = onValue(connectedRef, (snapshot) => {
        const epoch = ++connectionEpoch;
        if (snapshot.val() !== true || !active) {
          if (heartbeatTimer) clearInterval(heartbeatTimer);
          heartbeatTimer = null;
          presenceRef = null;
          disconnectRegistration = null;
          return;
        }

        void (async () => {
          for (let offset = 0; offset < 8; offset += 1) {
            const slot = String((startSlot + offset) % 8);
            const candidateRef = ref(database, `adventurePresence/${user.uid}/${slot}`);
            const registration = onDisconnect(candidateRef);
            await registration.remove();
            const now = Date.now();
            const result = await runTransaction(candidateRef, (current) => current == null ? {
              ...createPresenceEntry(user),
              connectedAt: now,
              lastSeen: now,
            } : undefined, { applyLocally: false });
            if (!result.committed) {
              await registration.cancel();
              continue;
            }

            if (!active || epoch !== connectionEpoch) {
              await registration.cancel();
              await remove(candidateRef);
              return;
            }
            presenceRef = candidateRef;
            disconnectRegistration = registration;
            if (heartbeatTimer) clearInterval(heartbeatTimer);
            heartbeatTimer = setInterval(() => {
              if (!active || epoch !== connectionEpoch) return;
              void update(candidateRef, { lastSeen: serverTimestamp() });
            }, 25_000);
            return;
          }
          throw new Error('모험 접속 슬롯 8개가 모두 사용 중입니다.');
        })().catch((error: unknown) => {
          if (active && epoch === connectionEpoch) console.error('모험 접속 상태 등록 오류:', error);
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
    if (heartbeatTimer) clearInterval(heartbeatTimer);
    if (disconnectRegistration) void disconnectRegistration.cancel();
    if (presenceRef) void remove(presenceRef);
  };
}

export function subscribeAdventureOnlineCount(callback: (count: number) => void): Unsubscribe {
  return subscribeAfterInitialization((database) => {
    let latestPresence: Record<string, Record<string, { lastSeen?: number }> | null> = {};
    const emitCount = () => {
      const cutoff = Date.now() - 90_000;
      const count = Object.values(latestPresence).filter((connections) =>
        connections && Object.values(connections).some((entry) =>
          typeof entry?.lastSeen === 'number' && entry.lastSeen >= cutoff
        )
      ).length;
      callback(count);
    };
    const stop = onValue(
      ref(database, 'adventurePresence'),
      (snapshot) => {
        latestPresence = snapshot.val() || {};
        emitCount();
      },
      (error) => {
        console.error('모험 접속자 수 구독 오류:', error);
        callback(0);
      },
    );
    const expiryTimer = setInterval(emitCount, 30_000);
    return () => {
      stop();
      clearInterval(expiryTimer);
    };
  }, (error) => {
    console.error('모험 접속자 수 초기화 오류:', error);
    callback(0);
  });
}
