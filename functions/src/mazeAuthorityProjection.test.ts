import assert from 'node:assert/strict';
import { setImmediate as nextImmediate } from 'node:timers/promises';
import { test } from 'node:test';
import { HttpsError } from 'firebase-functions/v2/https';
import type { GameMap } from '../vendor/maze-engine/dist/types/game';
import {
  reduceMazeAuthorityCommand,
  type MazeAuthorityState,
} from './mazeAuthorityDomain';
import {
  buildMazeAuthorityMemberView,
  buildMazeAuthorityPublicView,
} from './mazeAuthorityView';
import {
  MAZE_AUTHORITY_MEMBER_VIEW_ROOT,
  MAZE_AUTHORITY_PUBLIC_VIEW_ROOT,
  MAZE_AUTHORITY_VIEW_MANIFEST_ROOT,
  MAZE_AUTHORITY_VIEW_MANIFEST_VERSION,
  finalizeMazeAuthorityViewProjection,
  isValidMazeAuthorityViewUid,
  mazeAuthorityMemberViewPath,
  mazeAuthorityPublicViewPath,
  mazeAuthorityViewManifestPath,
  persistedMazeAuthorityViewMatches,
  serializeMazeAuthorityViewForRtdb,
  syncMazeAuthorityViewProjection,
  type MazeAuthorityProjectionTransactionReference,
} from './mazeAuthorityProjection';

const OWNER = 'projection-owner-001';
const GUEST = 'projection-guest-001';
const ROOM_ID = 'projection-room-001';
const PRIVATE_ERROR = 'private-maze-projection-secret';

function clone<T>(value: T): T {
  return structuredClone(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function assertFirebaseCompatibleObjectTree(value: unknown): void {
  if (Array.isArray(value)) {
    value.forEach(assertFirebaseCompatibleObjectTree);
    return;
  }
  if (!isRecord(value)) return;
  assert.equal(
    Object.getPrototypeOf(value),
    Object.prototype,
    'Firebase transaction values must expose Object.prototype.hasOwnProperty',
  );
  Object.values(value).forEach(assertFirebaseCompatibleObjectTree);
}

/** Mirrors RTDB's removal of null/undefined and empty collection children. */
function rtdbEncode(value: unknown): unknown {
  if (value === null || value === undefined) return undefined;
  if (Array.isArray(value)) {
    if (value.length === 0) return undefined;
    const encoded = value.map((entry) => rtdbEncode(entry) ?? null);
    return encoded.every((entry) => entry === null) ? undefined : encoded;
  }
  if (!isRecord(value)) return value;
  const encoded: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    const encodedChild = rtdbEncode(child);
    if (encodedChild !== undefined) encoded[key] = encodedChild;
  }
  return Object.keys(encoded).length === 0 ? undefined : encoded;
}

function ownerMap(): GameMap {
  return {
    rulesVersion: 3,
    startPosition: { row: 0, col: 0 },
    endPosition: { row: 0, col: 2 },
    obstacles: [{ position: { row: 3, col: 3 }, direction: 'right' }],
    items: [{ type: 'mine', position: { row: 4, col: 4 } }],
    skillLoadout: 'scoutPulse',
  };
}

function guestMap(): GameMap {
  return {
    rulesVersion: 3,
    startPosition: { row: 5, col: 5 },
    endPosition: { row: 5, col: 3 },
    obstacles: [{ position: { row: 1, col: 1 }, direction: 'right' }],
    items: [{ type: 'smoke', position: { row: 2, col: 2 } }],
    skillLoadout: 'scoutPulse',
  };
}

function applyCommand(
  state: MazeAuthorityState,
  actorId: string,
  command: Record<string, unknown>,
  now: number,
): MazeAuthorityState {
  return reduceMazeAuthorityCommand(state, actorId, {
    ...command,
    roomId: ROOM_ID,
    expectedGeneration: state.meta.generation,
    expectedRevision: state.meta.revision,
  }, now).state;
}

function createPlayState(): MazeAuthorityState {
  let state = reduceMazeAuthorityCommand(null, OWNER, {
    type: 'createRoom',
    commandId: 'projection-create-0001',
    roomId: ROOM_ID,
    expectedGeneration: 0,
    expectedRevision: 0,
    name: 'Projection Room',
    maxPlayers: 2,
  }, 1_000).state;
  state = applyCommand(state, GUEST, {
    type: 'joinRoom',
    commandId: 'projection-join-00001',
  }, 1_100);
  state = applyCommand(state, OWNER, {
    type: 'submitMap',
    commandId: 'projection-owner-map-01',
    map: ownerMap(),
  }, 1_200);
  state = applyCommand(state, GUEST, {
    type: 'submitMap',
    commandId: 'projection-guest-map-01',
    map: guestMap(),
  }, 1_300);
  return applyCommand(state, OWNER, {
    type: 'startMatch',
    commandId: 'projection-start-0001',
  }, 1_400);
}

function createReadySetupState(): MazeAuthorityState {
  let state = reduceMazeAuthorityCommand(null, OWNER, {
    type: 'createRoom',
    commandId: 'manifest-create-0001',
    roomId: ROOM_ID,
    expectedGeneration: 0,
    expectedRevision: 0,
    name: 'Manifest Room',
    maxPlayers: 2,
  }, 3_000).state;
  state = applyCommand(state, GUEST, {
    type: 'joinRoom',
    commandId: 'manifest-join-00001',
  }, 3_100);
  state = applyCommand(state, OWNER, {
    type: 'submitMap',
    commandId: 'manifest-owner-map-01',
    map: ownerMap(),
  }, 3_200);
  return applyCommand(state, GUEST, {
    type: 'submitMap',
    commandId: 'manifest-guest-map-01',
    map: guestMap(),
  }, 3_300);
}

function allObjectKeys(value: unknown, keys = new Set<string>()): Set<string> {
  if (Array.isArray(value)) {
    for (const entry of value) allObjectKeys(entry, keys);
    return keys;
  }
  if (!isRecord(value)) return keys;
  for (const [key, child] of Object.entries(value)) {
    keys.add(key);
    allObjectKeys(child, keys);
  }
  return keys;
}

class OptimisticProjectionStore {
  private readonly records = new Map<string, { value: unknown; version: number }>();
  private readonly retries = new Map<string, number>();
  private readonly failures = new Map<string, unknown[]>();
  readonly requestedPaths: string[] = [];
  callbackCount = 0;
  commitCount = 0;

  seed(path: string, value: unknown): void {
    this.records.set(path, { value: clone(rtdbEncode(value) ?? null), version: 0 });
  }

  read(path: string): unknown {
    return clone(this.records.get(path)?.value ?? null);
  }

  forceRetries(path: string, count: number): void {
    this.retries.set(path, count);
  }

  failNext(path: string, error: unknown): void {
    const queue = this.failures.get(path) ?? [];
    queue.push(error);
    this.failures.set(path, queue);
  }

  getViewReference = (path: string): MazeAuthorityProjectionTransactionReference => {
    this.requestedPaths.push(path);
    return {
      get: async () => ({ val: () => this.read(path) }),
      transaction: async (update, _onComplete, applyLocally) => {
        assert.equal(applyLocally, false);
        const failureQueue = this.failures.get(path);
        if (failureQueue && failureQueue.length > 0) throw failureQueue.shift();

        for (let attempt = 0; attempt < 100; attempt += 1) {
          const record = this.records.get(path) ?? { value: null, version: 0 };
          if (!this.records.has(path)) this.records.set(path, record);
          const observedVersion = record.version;
          const candidate = update(clone(record.value));
          this.callbackCount += 1;
          await nextImmediate();

          if (candidate === undefined) {
            return {
              committed: false,
              snapshot: { val: () => this.read(path) },
            };
          }
          const retryCount = this.retries.get(path) ?? 0;
          if (retryCount > 0) {
            this.retries.set(path, retryCount - 1);
            record.version += 1;
            continue;
          }
          if (record.version !== observedVersion) continue;

          record.value = clone(rtdbEncode(candidate) ?? null);
          record.version += 1;
          this.commitCount += 1;
          return {
            committed: true,
            snapshot: { val: () => this.read(path) },
          };
        }
        throw Object.assign(new Error(`maxretry ${PRIVATE_ERROR}`), {
          code: 'DATABASE/TRANSACTION_MAXRETRY',
        });
      },
    };
  };
}

async function rejectsHttpsError(
  promise: Promise<unknown>,
  code: HttpsError['code'],
  forbiddenText?: string,
): Promise<void> {
  await assert.rejects(promise, (error: unknown) => {
    assert.ok(error instanceof HttpsError);
    assert.equal(error.code, code);
    if (forbiddenText) {
      assert.doesNotMatch(error.message, new RegExp(forbiddenText));
      assert.equal(error.details, undefined);
    }
    return true;
  });
}

test('uses only bounded public/member paths and rejects unsafe identifiers', () => {
  assert.equal(isValidMazeAuthorityViewUid(OWNER), true);
  assert.equal(
    mazeAuthorityPublicViewPath(ROOM_ID),
    `${MAZE_AUTHORITY_PUBLIC_VIEW_ROOT}/${ROOM_ID}`,
  );
  assert.equal(
    mazeAuthorityMemberViewPath(OWNER, ROOM_ID),
    `${MAZE_AUTHORITY_MEMBER_VIEW_ROOT}/${OWNER}/${ROOM_ID}`,
  );
  assert.equal(
    mazeAuthorityViewManifestPath(ROOM_ID),
    `${MAZE_AUTHORITY_VIEW_MANIFEST_ROOT}/${ROOM_ID}`,
  );

  for (const uid of [
    '',
    '   ',
    'member/child',
    'member.with-dot',
    'member#fragment',
    'member$money',
    'member[0]',
    'member\u0000control',
    'x'.repeat(129),
  ]) {
    assert.equal(isValidMazeAuthorityViewUid(uid), false, uid);
    assert.throws(() => mazeAuthorityMemberViewPath(uid, ROOM_ID));
  }
  for (const roomId of ['', 'short', 'room/child', 'room.with-dot']) {
    assert.throws(() => mazeAuthorityPublicViewPath(roomId));
    assert.throws(() => mazeAuthorityMemberViewPath(OWNER, roomId));
    assert.throws(() => mazeAuthorityViewManifestPath(roomId));
  }
});

test('persists exact public/member projections with only allowlisted view fields', async () => {
  const state = createPlayState();
  const store = new OptimisticProjectionStore();
  const result = await syncMazeAuthorityViewProjection(state, store);
  const publicPath = mazeAuthorityPublicViewPath(ROOM_ID);
  const ownerPath = mazeAuthorityMemberViewPath(OWNER, ROOM_ID);
  const guestPath = mazeAuthorityMemberViewPath(GUEST, ROOM_ID);

  assert.equal(result.ok, true);
  assert.equal(result.generation, state.meta.generation);
  assert.equal(result.revision, state.meta.revision);
  assert.equal(result.replayed, false);
  assert.deepEqual(store.requestedPaths, [publicPath, ownerPath, guestPath]);
  assert.deepEqual(result.writes, [
    { audience: 'public', path: publicPath, replayed: false },
    { audience: 'member', viewerUid: OWNER, path: ownerPath, replayed: false },
    { audience: 'member', viewerUid: GUEST, path: guestPath, replayed: false },
  ]);

  const publicValue = store.read(publicPath);
  const ownerValue = store.read(ownerPath);
  assert.ok(isRecord(publicValue));
  assert.ok(isRecord(ownerValue));
  assert.deepEqual(Object.keys(publicValue).sort(), [
    'audience',
    'authoritySchemaVersion',
    'gameState',
    'generation',
    'lobby',
    'revision',
    'roomId',
    'ruleSnapshot',
    'sourceCreatedAt',
    'sourceUpdatedAt',
    'viewVersion',
  ].sort());
  assert.deepEqual(Object.keys(ownerValue).sort(), [
    'audience',
    'authoritySchemaVersion',
    'gameState',
    'generation',
    'lobby',
    'revision',
    'roomId',
    'ruleSnapshot',
    'sourceCreatedAt',
    'sourceUpdatedAt',
    'viewerUid',
    'viewVersion',
  ].sort());

  const publicGame = publicValue.gameState;
  const ownerGame = ownerValue.gameState;
  assert.ok(isRecord(publicGame));
  assert.ok(isRecord(ownerGame));
  assert.deepEqual(publicGame.maps, {
    [OWNER]: {
      endPosition: ownerMap().endPosition,
      startPosition: ownerMap().startPosition,
    },
    [GUEST]: {
      endPosition: guestMap().endPosition,
      startPosition: guestMap().startPosition,
    },
  });
  assert.ok(isRecord(ownerGame.maps));
  assert.deepEqual(ownerGame.maps[OWNER], rtdbEncode(ownerMap()));
  assert.deepEqual(ownerGame.maps[GUEST], publicGame.maps[GUEST]);
  assert.equal(publicValue.audience, 'public');
  assert.equal('viewerUid' in publicValue, false);
  assert.equal(ownerValue.audience, 'member');
  assert.equal(ownerValue.viewerUid, OWNER);

  const allKeys = new Set([
    ...allObjectKeys(publicValue),
    ...allObjectKeys(ownerValue),
    ...allObjectKeys(store.read(guestPath)),
  ]);
  for (const forbidden of [
    'receipts',
    'byId',
    'payloadHash',
    'commandType',
    'joinedAt',
    'positionHistory',
    'lastPosition',
    'lastSeen',
  ]) assert.equal(allKeys.has(forbidden), false, `persisted projection leaked ${forbidden}`);
  for (const receipt of Object.values(state.receipts.byId)) {
    const persistedJson = JSON.stringify([
      store.read(publicPath),
      store.read(ownerPath),
      store.read(guestPath),
    ]);
    assert.equal(persistedJson.includes(receipt.payloadHash), false);
  }
});

test('matches canonical views after RTDB empty/null elision and numeric-array materialization', () => {
  const state = createPlayState();
  const candidate = buildMazeAuthorityPublicView(state);
  const unchangedCandidate = clone(candidate);
  const serialized = serializeMazeAuthorityViewForRtdb(candidate);

  assert.deepEqual(candidate, unchangedCandidate, 'serialization must not mutate the view');
  assertFirebaseCompatibleObjectTree(serialized);
  assert.ok(isRecord(serialized.gameState));
  assert.equal('winner' in serialized.gameState, false);
  assert.equal('draw' in serialized.gameState, false);
  assert.equal('collisionWalls' in serialized.gameState, false);
  assert.equal('itemState' in serialized.gameState, false);
  assert.equal(persistedMazeAuthorityViewMatches(rtdbEncode(serialized), candidate), true);

  const objectMaterialized = clone(serialized) as unknown as {
    gameState: { turnOrder: unknown };
    ruleSnapshot: { skillIds: unknown };
  };
  const turnOrder = candidate.gameState.turnOrder;
  objectMaterialized.gameState.turnOrder = Object.fromEntries(
    turnOrder.map((uid, index) => [String(index), uid]),
  );
  objectMaterialized.ruleSnapshot.skillIds = Object.fromEntries(
    candidate.ruleSnapshot.skillIds.map((skillId, index) => [String(index), skillId]),
  );
  assert.equal(persistedMazeAuthorityViewMatches(objectMaterialized, candidate), true);
});

test('repairs corrupt same-version projections instead of trusting metadata alone', async () => {
  const state = createPlayState();
  const publicCandidate = buildMazeAuthorityPublicView(state);
  const ownerCandidate = buildMazeAuthorityMemberView(state, OWNER);
  const guestCandidate = buildMazeAuthorityMemberView(state, GUEST);
  const publicPath = mazeAuthorityPublicViewPath(ROOM_ID);
  const ownerPath = mazeAuthorityMemberViewPath(OWNER, ROOM_ID);
  const guestPath = mazeAuthorityMemberViewPath(GUEST, ROOM_ID);
  const store = new OptimisticProjectionStore();

  store.seed(publicPath, {
    ...serializeMazeAuthorityViewForRtdb(publicCandidate),
    receipts: { private: true },
    audience: 'member',
  });
  store.seed(ownerPath, serializeMazeAuthorityViewForRtdb(ownerCandidate));
  store.seed(guestPath, serializeMazeAuthorityViewForRtdb(guestCandidate));

  const result = await syncMazeAuthorityViewProjection(state, store);
  assert.equal(result.replayed, false);
  assert.equal(store.commitCount, 1);
  assert.deepEqual(result.writes.map((write) => write.replayed), [false, true, true]);
  assert.deepEqual(
    store.read(publicPath),
    rtdbEncode(serializeMazeAuthorityViewForRtdb(publicCandidate)),
  );
});

test('never lets stale writers overwrite a newer view schema, generation, or revision', async () => {
  const state = createPlayState();
  const candidate = buildMazeAuthorityPublicView(state);
  const publicPath = mazeAuthorityPublicViewPath(ROOM_ID);
  const newerValues = [
    { ...candidate, viewVersion: candidate.viewVersion + 1, generation: 0, revision: 0 },
    { ...candidate, generation: candidate.generation + 1, revision: 0 },
    {
      ...candidate,
      viewVersion: candidate.viewVersion - 1,
      generation: candidate.generation + 1,
      revision: 0,
    },
    { ...candidate, revision: candidate.revision + 1 },
  ];

  for (const newerValue of newerValues) {
    const store = new OptimisticProjectionStore();
    store.seed(publicPath, newerValue);
    await rejectsHttpsError(syncMazeAuthorityViewProjection(state, store), 'aborted');
    assert.equal(store.commitCount, 0);
    assert.deepEqual(store.requestedPaths, [publicPath]);
    assert.deepEqual(store.read(publicPath), rtdbEncode(newerValue));
  }

  const oldGenerationStore = new OptimisticProjectionStore();
  oldGenerationStore.seed(publicPath, {
    ...candidate,
    generation: candidate.generation - 1,
    revision: 999_999,
  });
  const upgraded = await syncMazeAuthorityViewProjection(state, oldGenerationStore);
  assert.equal(upgraded.writes[0].replayed, false);
  assert.equal(oldGenerationStore.commitCount, 3);
});

test('survives repeated optimistic transaction callbacks without duplicate commits', async () => {
  const state = createPlayState();
  const publicPath = mazeAuthorityPublicViewPath(ROOM_ID);
  const retryStore = new OptimisticProjectionStore();
  retryStore.forceRetries(publicPath, 2);
  const retried = await syncMazeAuthorityViewProjection(state, retryStore);
  assert.equal(retried.ok, true);
  assert.equal(retryStore.commitCount, 3);
  assert.equal(retryStore.callbackCount, 5);
});

test('maps max-retry and unavailable transaction failures without private text', async () => {
  const state = createPlayState();
  const publicPath = mazeAuthorityPublicViewPath(ROOM_ID);
  const maxRetryStore = new OptimisticProjectionStore();
  maxRetryStore.failNext(publicPath, Object.assign(
    new Error(`maxretry ${PRIVATE_ERROR}`),
    { code: 'DATABASE/TRANSACTION_MAXRETRY' },
  ));
  await rejectsHttpsError(
    syncMazeAuthorityViewProjection(state, maxRetryStore),
    'aborted',
    PRIVATE_ERROR,
  );

  const unavailableStore = new OptimisticProjectionStore();
  unavailableStore.failNext(publicPath, new Error(`network ${PRIVATE_ERROR}`));
  await rejectsHttpsError(
    syncMazeAuthorityViewProjection(state, unavailableStore),
    'unavailable',
    PRIVATE_ERROR,
  );
});

test('fails closed on corrupt or throwing transaction snapshots', async () => {
  const state = createPlayState();
  const corruptSnapshot: MazeAuthorityProjectionTransactionReference = {
    transaction: async (update) => {
      assert.ok(update(null));
      return { committed: true, snapshot: { val: () => ({ corrupt: true }) } };
    },
  };
  await rejectsHttpsError(syncMazeAuthorityViewProjection(state, {
    getViewReference: () => corruptSnapshot,
  }), 'data-loss');

  const throwingSnapshot: MazeAuthorityProjectionTransactionReference = {
    transaction: async (update) => {
      assert.ok(update(null));
      return {
        committed: true,
        snapshot: { val: () => { throw new Error(PRIVATE_ERROR); } },
      };
    },
  };
  await rejectsHttpsError(syncMazeAuthorityViewProjection(state, {
    getViewReference: () => throwingSnapshot,
  }), 'data-loss', PRIVATE_ERROR);
});

test('a retry converges every view after a partial multi-view commit', async () => {
  const state = createPlayState();
  const publicPath = mazeAuthorityPublicViewPath(ROOM_ID);
  const ownerPath = mazeAuthorityMemberViewPath(OWNER, ROOM_ID);
  const guestPath = mazeAuthorityMemberViewPath(GUEST, ROOM_ID);
  const store = new OptimisticProjectionStore();
  store.failNext(ownerPath, new Error(`partial ${PRIVATE_ERROR}`));

  await rejectsHttpsError(
    syncMazeAuthorityViewProjection(state, store),
    'unavailable',
    PRIVATE_ERROR,
  );
  assert.equal(store.commitCount, 1);
  assert.deepEqual(store.requestedPaths, [publicPath, ownerPath]);
  assert.equal(
    persistedMazeAuthorityViewMatches(store.read(publicPath), buildMazeAuthorityPublicView(state)),
    true,
  );
  assert.equal(store.read(ownerPath), null);
  assert.equal(store.read(guestPath), null);

  const resumed = await syncMazeAuthorityViewProjection(state, store);
  assert.deepEqual(resumed.writes.map((write) => write.replayed), [true, false, false]);
  assert.equal(store.commitCount, 3);
  assert.equal(
    persistedMazeAuthorityViewMatches(store.read(ownerPath), buildMazeAuthorityMemberView(state, OWNER)),
    true,
  );
  assert.equal(
    persistedMazeAuthorityViewMatches(store.read(guestPath), buildMazeAuthorityMemberView(state, GUEST)),
    true,
  );
});

test('commits a manifest after views and prunes departed members on a retry-safe pass', async () => {
  const setup = createReadySetupState();
  const store = new OptimisticProjectionStore();
  const manifestPath = mazeAuthorityViewManifestPath(ROOM_ID);
  const guestPath = mazeAuthorityMemberViewPath(GUEST, ROOM_ID);

  await syncMazeAuthorityViewProjection(setup, store);
  const initial = await finalizeMazeAuthorityViewProjection(setup, store);
  assert.equal(initial.manifestReplayed, false);
  assert.deepEqual(initial.cleanups, []);
  assert.deepEqual(store.read(manifestPath), {
    manifestVersion: MAZE_AUTHORITY_VIEW_MANIFEST_VERSION,
    roomId: ROOM_ID,
    generation: setup.meta.generation,
    revision: setup.meta.revision,
    memberUids: [OWNER, GUEST],
  });

  const departed = applyCommand(setup, GUEST, {
    type: 'leaveRoom',
    commandId: 'manifest-guest-leave-1',
  }, 3_400);
  await syncMazeAuthorityViewProjection(departed, store);
  store.failNext(guestPath, new Error(`partial-cleanup ${PRIVATE_ERROR}`));
  await rejectsHttpsError(
    finalizeMazeAuthorityViewProjection(departed, store),
    'unavailable',
    PRIVATE_ERROR,
  );
  assert.notEqual(store.read(guestPath), null);
  assert.equal((store.read(manifestPath) as { revision: number }).revision, setup.meta.revision);

  const resumed = await finalizeMazeAuthorityViewProjection(departed, store);
  assert.deepEqual(resumed.cleanups, [{
    audience: 'member',
    viewerUid: GUEST,
    path: guestPath,
    replayed: false,
  }]);
  assert.equal(store.read(guestPath), null);
  assert.deepEqual(store.read(manifestPath), {
    manifestVersion: MAZE_AUTHORITY_VIEW_MANIFEST_VERSION,
    roomId: ROOM_ID,
    generation: departed.meta.generation,
    revision: departed.meta.revision,
    memberUids: [OWNER],
  });

  const replay = await finalizeMazeAuthorityViewProjection(departed, store);
  assert.equal(replay.manifestReplayed, true);
  assert.deepEqual(replay.cleanups, []);
});

test('cold-cache finalization reads the remote manifest and really deletes departed views', async () => {
  const setup = createReadySetupState();
  const store = new OptimisticProjectionStore();
  const guestPath = mazeAuthorityMemberViewPath(GUEST, ROOM_ID);
  const manifestPath = mazeAuthorityViewManifestPath(ROOM_ID);
  await syncMazeAuthorityViewProjection(setup, store);
  await finalizeMazeAuthorityViewProjection(setup, store);
  const departed = applyCommand(setup, GUEST, {
    type: 'leaveRoom',
    commandId: 'manifest-cold-leave-001',
  }, 3_450);
  await syncMazeAuthorityViewProjection(departed, store);

  const coldDependencies = {
    getViewReference: (path: string): MazeAuthorityProjectionTransactionReference => {
      const warm = store.getViewReference(path);
      return {
        transaction: async (update, onComplete, applyLocally) => {
          const optimistic = update(null);
          if (optimistic === undefined) {
            return { committed: false, snapshot: { val: () => null } };
          }
          return warm.transaction(update, onComplete, applyLocally);
        },
      };
    },
  };
  const finalized = await finalizeMazeAuthorityViewProjection(departed, coldDependencies);
  assert.deepEqual(finalized.cleanups.map((cleanup) => cleanup.path), [guestPath]);
  assert.equal(store.read(guestPath), null);
  assert.deepEqual(store.read(manifestPath), {
    manifestVersion: MAZE_AUTHORITY_VIEW_MANIFEST_VERSION,
    roomId: ROOM_ID,
    generation: departed.meta.generation,
    revision: departed.meta.revision,
    memberUids: [OWNER],
  });
});

test('never deletes a departed member view from a newer generation', async () => {
  const setup = createReadySetupState();
  const store = new OptimisticProjectionStore();
  const guestPath = mazeAuthorityMemberViewPath(GUEST, ROOM_ID);
  const manifestPath = mazeAuthorityViewManifestPath(ROOM_ID);
  await syncMazeAuthorityViewProjection(setup, store);
  await finalizeMazeAuthorityViewProjection(setup, store);

  const departed = applyCommand(setup, GUEST, {
    type: 'leaveRoom',
    commandId: 'manifest-newer-leave-1',
  }, 3_500);
  const newerGuestView = {
    ...buildMazeAuthorityMemberView(setup, GUEST),
    viewVersion: buildMazeAuthorityMemberView(setup, GUEST).viewVersion - 1,
    generation: departed.meta.generation + 1,
    revision: 0,
  };
  store.seed(guestPath, newerGuestView);

  await rejectsHttpsError(finalizeMazeAuthorityViewProjection(departed, store), 'aborted');
  assert.deepEqual(store.read(guestPath), rtdbEncode(newerGuestView));
  assert.equal((store.read(manifestPath) as { revision: number }).revision, setup.meta.revision);
});

test('a closed tombstone removes public, manifested or receipt-known member views, and manifest', async () => {
  const setup = createReadySetupState();
  const store = new OptimisticProjectionStore();
  const publicPath = mazeAuthorityPublicViewPath(ROOM_ID);
  const ownerPath = mazeAuthorityMemberViewPath(OWNER, ROOM_ID);
  const guestPath = mazeAuthorityMemberViewPath(GUEST, ROOM_ID);
  const manifestPath = mazeAuthorityViewManifestPath(ROOM_ID);
  await syncMazeAuthorityViewProjection(setup, store);
  await finalizeMazeAuthorityViewProjection(setup, store);
  store.seed(manifestPath, {
    manifestVersion: MAZE_AUTHORITY_VIEW_MANIFEST_VERSION,
    roomId: ROOM_ID,
    generation: setup.meta.generation,
    revision: setup.meta.revision,
    memberUids: [OWNER],
  });

  const closed = applyCommand(setup, OWNER, {
    type: 'closeRoom',
    commandId: 'manifest-close-room-01',
  }, 3_600);
  const projection = await syncMazeAuthorityViewProjection(closed, store);
  assert.deepEqual(projection.writes, []);
  const finalization = await finalizeMazeAuthorityViewProjection(closed, store);

  assert.equal(finalization.closed, true);
  assert.deepEqual(finalization.cleanups.map((cleanup) => cleanup.path), [
    publicPath,
    ownerPath,
    guestPath,
  ]);
  assert.equal(store.read(publicPath), null);
  assert.equal(store.read(ownerPath), null);
  assert.equal(store.read(guestPath), null);
  assert.equal(store.read(manifestPath), null);

  const replay = await finalizeMazeAuthorityViewProjection(closed, store);
  assert.equal(replay.manifestReplayed, true);
  assert.equal(replay.cleanups.every((cleanup) => cleanup.replayed), true);
});
