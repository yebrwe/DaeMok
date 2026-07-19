import assert from 'node:assert/strict';
import test from 'node:test';
import {
  MAZE_PRESENCE_FRESHNESS_MS,
  MAZE_PRESENCE_TIMEOUT_CLAIM_TTL_MS,
  MazePresenceTimeoutClaimError,
  buildMazePresenceLease,
  claimMazePresenceTimeout,
  collectActiveMazePresenceConnections,
  releaseMazePresenceTimeoutClaim,
  retainMazePresenceRoomGeneration,
  syncMazePresenceLease,
  type MazePresenceDependencies,
  type MazePresenceTransactionReference,
} from './mazePresence';

const ROOM_ID = 'presence-room-001';
const UID = 'presence-user-001';
const NOW = 1_000_000;

function connection(session: string, lastSeen = NOW) {
  return {
    uid: UID,
    generation: 1,
    session,
    connectedAt: NOW - 10_000,
    lastSeen,
  };
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

class Store {
  readonly values = new Map<string, unknown>();

  seed(path: string, value: unknown): void {
    if (value == null) this.values.delete(path);
    else this.values.set(path, clone(value));
  }

  read(path: string): unknown {
    return clone(this.values.get(path) ?? null);
  }

  reference(path: string): MazePresenceTransactionReference {
    return {
      get: async () => ({ val: () => this.read(path) }),
      transaction: async (update) => {
        const candidate = update(this.read(path));
        const committed = candidate !== undefined;
        if (committed) this.seed(path, candidate);
        return { committed, snapshot: { val: () => this.read(path) } };
      },
    };
  }
}

function coldReference(store: Store, path: string): MazePresenceTransactionReference {
  const warm = store.reference(path);
  return {
    get: warm.get,
    transaction: async (update, onComplete, applyLocally) => {
      const optimistic = update(null);
      if (optimistic === undefined) {
        return { committed: false, snapshot: { val: () => null } };
      }
      return warm.transaction(update, onComplete, applyLocally);
    },
  };
}

function dependencies(store: Store): MazePresenceDependencies {
  return {
    getConnectionsReference: (path) => store.reference(path),
    getPublicRoomReference: (path) => store.reference(path),
    getLeaseReference: (path) => store.reference(path),
    getStatusReference: (path) => store.reference(path),
  };
}

test('connection parser keeps eight fresh exact-generation tabs and ignores stale or forged input', () => {
  const raw: Record<string, unknown> = {};
  for (let slot = 0; slot < 8; slot += 1) raw[String(slot)] = connection(`tab-${slot}`);
  raw.bad = connection('not-a-slot');
  raw['7'] = connection('stale', NOW - MAZE_PRESENCE_FRESHNESS_MS - 1);
  raw['6'] = { ...connection('wrong-generation'), generation: 2 };
  const active = collectActiveMazePresenceConnections(raw, UID, 1, NOW);
  assert.equal(active.length, 6);
  assert.ok(active.every((entry) => entry.uid === UID && entry.generation === 1));

  const materializedArray = [connection('rtdb-zero-slot')];
  assert.deepEqual(
    collectActiveMazePresenceConnections(materializedArray, UID, 1, NOW),
    [connection('rtdb-zero-slot')],
    'RTDB numeric-key array materialization must keep the live slot online',
  );
});

test('lease epoch changes only across online/offline or generation transitions', () => {
  const active = collectActiveMazePresenceConnections({ 0: connection('primary') }, UID, 1, NOW);
  const online = buildMazePresenceLease(null, ROOM_ID, UID, 1, active, NOW);
  assert.equal(online.online, true);
  assert.equal(online.epoch, 1);
  const heartbeat = buildMazePresenceLease(online, ROOM_ID, UID, 1, active, NOW + 1_000);
  assert.equal(heartbeat.epoch, 1);
  const offline = buildMazePresenceLease(heartbeat, ROOM_ID, UID, 1, [], NOW + 2_000);
  assert.equal(offline.online, false);
  assert.equal(offline.epoch, 2);
  assert.equal(offline.offlineSince, NOW + 2_000);
  const stillOffline = buildMazePresenceLease(offline, ROOM_ID, UID, 1, [], NOW + 3_000);
  assert.equal(stillOffline.epoch, 2);
  assert.equal(stillOffline.offlineSince, NOW + 2_000);
  const reconnected = buildMazePresenceLease(stillOffline, ROOM_ID, UID, 1, active, NOW + 4_000);
  assert.equal(reconnected.online, true);
  assert.equal(reconnected.epoch, 3);
  const nextGeneration = buildMazePresenceLease(reconnected, ROOM_ID, UID, 2, [], NOW + 5_000);
  assert.equal(nextGeneration.epoch, 4);
});

test('generation cleanup preserves only current bounded connections, leases, and statuses', () => {
  assert.deepEqual(retainMazePresenceRoomGeneration({
    [UID]: {
      0: connection('old-generation'),
      1: { ...connection('current-generation'), generation: 2 },
      8: { ...connection('out-of-range'), generation: 2 },
    },
    'presence-current-user': {
      0: { ...connection('current-only'), uid: 'presence-current-user', generation: 2 },
    },
  }, 2, true), {
    [UID]: {
      1: { ...connection('current-generation'), generation: 2 },
    },
    'presence-current-user': {
      0: { ...connection('current-only'), uid: 'presence-current-user', generation: 2 },
    },
  });
  assert.deepEqual(retainMazePresenceRoomGeneration({
    [UID]: [{ ...connection('array-current'), generation: 2 }],
  }, 2, true), {
    [UID]: {
      0: { ...connection('array-current'), generation: 2 },
    },
  });
  assert.deepEqual(retainMazePresenceRoomGeneration({
    [UID]: { uid: UID, generation: 1 },
    'presence-current-user': { uid: 'presence-current-user', generation: 2 },
  }, 2, false), {
    'presence-current-user': { uid: 'presence-current-user', generation: 2 },
  });
  assert.equal(retainMazePresenceRoomGeneration({
    [UID]: { uid: UID, generation: 1 },
  }, 2, false), null);
});

test('coordinator preserves online state while any tab remains and publishes a read-only status', async () => {
  const store = new Store();
  const connectionsPath = `mazePresence/v1/rooms/${ROOM_ID}/${UID}`;
  const leasePath = `mazePresence/v1/leases/${ROOM_ID}/${UID}`;
  const statusPath = `mazePresence/v1/status/${ROOM_ID}/${UID}`;
  store.seed(`mazeViews/v1/publicRooms/${ROOM_ID}`, {
    roomId: ROOM_ID,
    generation: 1,
    revision: 4,
    lobby: { members: { [UID]: { uid: UID, slot: 0 } } },
  });
  store.seed(connectionsPath, { 0: connection('primary'), 1: connection('secondary') });

  const first = await syncMazePresenceLease(
    { roomId: ROOM_ID, uid: UID, now: NOW },
    dependencies(store),
  );
  assert.equal(first.online, true);
  assert.equal(first.activeConnections, 2);
  assert.equal(first.epoch, 1);
  assert.deepEqual(store.read(statusPath), store.read(leasePath));

  store.seed(connectionsPath, { 1: connection('secondary', NOW + 1_000) });
  const oneTab = await syncMazePresenceLease(
    { roomId: ROOM_ID, uid: UID, now: NOW + 1_000 },
    dependencies(store),
  );
  assert.equal(oneTab.online, true);
  assert.equal(oneTab.epoch, 1);

  store.seed(connectionsPath, null);
  const offline = await syncMazePresenceLease(
    { roomId: ROOM_ID, uid: UID, now: NOW + 2_000 },
    dependencies(store),
  );
  assert.equal(offline.online, false);
  assert.equal(offline.epoch, 2);
  assert.equal((store.read(statusPath) as Record<string, unknown>).offlineSince, NOW + 2_000);

  store.seed(connectionsPath, { 0: connection('reconnect', NOW + 3_000) });
  const reconnect = await syncMazePresenceLease(
    { roomId: ROOM_ID, uid: UID, now: NOW + 3_000 },
    dependencies(store),
  );
  assert.equal(reconnect.online, true);
  assert.equal(reconnect.epoch, 3);
});

test('closed or missing public rooms remove both private lease and public status', async () => {
  const store = new Store();
  const leasePath = `mazePresence/v1/leases/${ROOM_ID}/${UID}`;
  const statusPath = `mazePresence/v1/status/${ROOM_ID}/${UID}`;
  store.seed(leasePath, { stale: true });
  store.seed(statusPath, { stale: true });
  const response = await syncMazePresenceLease(
    { roomId: ROOM_ID, uid: UID, now: NOW },
    dependencies(store),
  );
  assert.equal(response.removed, true);
  assert.equal(store.read(leasePath), null);
  assert.equal(store.read(statusPath), null);
});

test('a departed uid is removed even while the public room remains open', async () => {
  const store = new Store();
  const leasePath = `mazePresence/v1/leases/${ROOM_ID}/${UID}`;
  const statusPath = `mazePresence/v1/status/${ROOM_ID}/${UID}`;
  store.seed(`mazeViews/v1/publicRooms/${ROOM_ID}`, {
    roomId: ROOM_ID,
    generation: 1,
    revision: 5,
    lobby: {
      members: {
        'presence-other-user': { uid: 'presence-other-user', slot: 0 },
      },
    },
  });
  store.seed(leasePath, { stale: true });
  store.seed(statusPath, { stale: true });
  const response = await syncMazePresenceLease(
    { roomId: ROOM_ID, uid: UID, now: NOW },
    dependencies(store),
  );
  assert.equal(response.removed, true);
  assert.equal(store.read(leasePath), null);
  assert.equal(store.read(statusPath), null);
});

test('cold-cache cleanup reaches the server instead of mistaking optimistic null for deletion', async () => {
  const store = new Store();
  const leasePath = `mazePresence/v1/leases/${ROOM_ID}/${UID}`;
  const statusPath = `mazePresence/v1/status/${ROOM_ID}/${UID}`;
  store.seed(leasePath, { stale: true });
  store.seed(statusPath, { stale: true });
  const response = await syncMazePresenceLease(
    { roomId: ROOM_ID, uid: UID, now: NOW },
    {
      getConnectionsReference: (path) => store.reference(path),
      getPublicRoomReference: (path) => store.reference(path),
      getLeaseReference: (path) => coldReference(store, path),
      getStatusReference: (path) => coldReference(store, path),
    },
  );
  assert.equal(response.removed, true);
  assert.equal(store.read(leasePath), null);
  assert.equal(store.read(statusPath), null);
});

test('cold-cache timeout claim and release retry against the remote lease', async () => {
  const store = new Store();
  const leasePath = `mazePresence/v1/leases/${ROOM_ID}/${UID}`;
  const offlineSince = NOW - 50_000;
  store.seed(leasePath, {
    uid: UID,
    roomId: ROOM_ID,
    generation: 1,
    epoch: 2,
    online: false,
    lastSeen: offlineSince,
    offlineSince,
    updatedAt: offlineSince,
  });
  const claimed = await claimMazePresenceTimeout(coldReference(store, leasePath), {
    roomId: ROOM_ID,
    targetUid: UID,
    claimantUid: 'presence-cold-claimant',
    generation: 1,
    epoch: 2,
    claimId: 'presence-cold-timeout-claim',
    now: NOW,
  });
  assert.equal(claimed.timeoutClaim?.claimedBy, 'presence-cold-claimant');
  await releaseMazePresenceTimeoutClaim(coldReference(store, leasePath), {
    roomId: ROOM_ID,
    targetUid: UID,
    claimId: 'presence-cold-timeout-claim',
    claimedBy: 'presence-cold-claimant',
    epoch: 2,
  });
  assert.equal((store.read(leasePath) as Record<string, unknown>).timeoutClaim, undefined);
});

test('timeout claim and reconnect use one lease epoch to choose a deterministic winner', async () => {
  const store = new Store();
  const leasePath = `mazePresence/v1/leases/${ROOM_ID}/${UID}`;
  const offlineSince = NOW - 50_000;
  store.seed(leasePath, {
    uid: UID,
    roomId: ROOM_ID,
    generation: 1,
    epoch: 2,
    online: false,
    lastSeen: offlineSince,
    offlineSince,
    updatedAt: offlineSince,
  });
  const reference = store.reference(leasePath);
  const claimed = await claimMazePresenceTimeout(reference, {
    roomId: ROOM_ID,
    targetUid: UID,
    claimantUid: 'presence-claimant-001',
    generation: 1,
    epoch: 2,
    claimId: 'presence-timeout-claim-001',
    now: NOW,
  });
  assert.equal(claimed.timeoutClaim?.epoch, 2);

  const active = collectActiveMazePresenceConnections(
    { 0: connection('late-reconnect') },
    UID,
    1,
    NOW + 1_000,
  );
  const frozen = buildMazePresenceLease(
    store.read(leasePath),
    ROOM_ID,
    UID,
    1,
    active,
    NOW + 1_000,
  );
  assert.equal(frozen.online, false, 'a reconnect after the claim cannot reverse the timeout race');
  assert.equal(frozen.epoch, 2);

  const connectionsPath = `mazePresence/v1/rooms/${ROOM_ID}/${UID}`;
  const statusPath = `mazePresence/v1/status/${ROOM_ID}/${UID}`;
  store.seed(`mazeViews/v1/publicRooms/${ROOM_ID}`, {
    roomId: ROOM_ID,
    generation: 1,
    revision: 4,
    lobby: { members: { [UID]: { uid: UID, slot: 0 } } },
  });
  store.seed(connectionsPath, { 0: connection('late-reconnect', NOW + 1_000) });
  const duringClaim = await syncMazePresenceLease(
    { roomId: ROOM_ID, uid: UID, now: NOW + 1_000 },
    dependencies(store),
  );
  assert.equal(duringClaim.online, false);
  assert.equal(duringClaim.activeConnections, 1);
  assert.equal((store.read(statusPath) as Record<string, unknown>).online, false);
  assert.equal(
    (store.read(statusPath) as Record<string, unknown>).timeoutClaim,
    undefined,
    'the private race token never leaks into public status',
  );

  await assert.rejects(
    claimMazePresenceTimeout(reference, {
      roomId: ROOM_ID,
      targetUid: UID,
      claimantUid: 'presence-other-claimant',
      generation: 1,
      epoch: 2,
      claimId: 'presence-timeout-claim-002',
      now: NOW + 1_000,
    }),
    (error: unknown) => error instanceof MazePresenceTimeoutClaimError
      && error.reason === 'claim-conflict',
  );

  await releaseMazePresenceTimeoutClaim(reference, {
    roomId: ROOM_ID,
    targetUid: UID,
    claimId: 'presence-timeout-claim-001',
  });
  const afterResolution = buildMazePresenceLease(
    store.read(leasePath),
    ROOM_ID,
    UID,
    1,
    active,
    NOW + 2_000,
  );
  assert.equal(afterResolution.online, true);
  assert.equal(afterResolution.epoch, 3);

  store.seed(leasePath, afterResolution);
  await assert.rejects(
    claimMazePresenceTimeout(reference, {
      roomId: ROOM_ID,
      targetUid: UID,
      claimantUid: 'presence-claimant-001',
      generation: 1,
      epoch: 2,
      claimId: 'presence-timeout-claim-003',
      now: NOW + 3_000,
    }),
    (error: unknown) => error instanceof MazePresenceTimeoutClaimError
      && error.reason === 'lease-mismatch',
  );
});

test('a stale claimant cannot release a successor lock with the same deterministic id', async () => {
  const store = new Store();
  const leasePath = `mazePresence/v1/leases/${ROOM_ID}/${UID}`;
  const claimId = 'presence-same-timeout-claim';
  const offlineSince = NOW - 50_000;
  store.seed(leasePath, {
    uid: UID,
    roomId: ROOM_ID,
    generation: 1,
    epoch: 2,
    online: false,
    lastSeen: offlineSince,
    offlineSince,
    updatedAt: offlineSince,
  });
  const reference = store.reference(leasePath);
  await claimMazePresenceTimeout(reference, {
    roomId: ROOM_ID,
    targetUid: UID,
    claimantUid: 'presence-old-claimant',
    generation: 1,
    epoch: 2,
    claimId,
    now: NOW,
  });
  await claimMazePresenceTimeout(reference, {
    roomId: ROOM_ID,
    targetUid: UID,
    claimantUid: 'presence-new-claimant',
    generation: 1,
    epoch: 2,
    claimId,
    now: NOW + MAZE_PRESENCE_TIMEOUT_CLAIM_TTL_MS + 1,
  });

  await releaseMazePresenceTimeoutClaim(reference, {
    roomId: ROOM_ID,
    targetUid: UID,
    claimId,
    claimedBy: 'presence-old-claimant',
    epoch: 2,
  });
  assert.equal(
    ((store.read(leasePath) as Record<string, unknown>).timeoutClaim as Record<string, unknown>)
      .claimedBy,
    'presence-new-claimant',
  );
  await releaseMazePresenceTimeoutClaim(reference, {
    roomId: ROOM_ID,
    targetUid: UID,
    claimId,
    claimedBy: 'presence-new-claimant',
    epoch: 2,
  });
  assert.equal((store.read(leasePath) as Record<string, unknown>).timeoutClaim, undefined);
});
