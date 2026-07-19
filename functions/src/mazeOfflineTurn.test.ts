import assert from 'node:assert/strict';
import test from 'node:test';
import { HttpsError } from 'firebase-functions/v2/https';
import type { GameMap } from '../vendor/maze-engine/dist/types/game';
import {
  parseMazeAuthorityState,
  reduceMazeAuthorityCommand,
  type MazeAuthorityState,
} from './mazeAuthorityDomain';
import {
  createMazeOfflineTurnCallableHandler,
  mazeOfflineTurnClaimId,
  parseMazeOfflineTurnRequest,
  type MazeOfflineTurnAuthorityReference,
} from './mazeOfflineTurn';
import type { MazePresenceTransactionReference } from './mazePresence';

const OWNER = 'offline-owner-001';
const GUEST = 'offline-guest-001';
const ROOM_ID = 'offline-room-001';
const NOW = 1_000_000;

function map(): GameMap {
  return {
    rulesVersion: 3,
    startPosition: { row: 0, col: 0 },
    endPosition: { row: 5, col: 5 },
    obstacles: [],
    items: [],
    skillLoadout: 'scoutPulse',
  };
}

function apply(
  state: MazeAuthorityState | null,
  uid: string,
  command: Record<string, unknown>,
  now: number,
): MazeAuthorityState {
  return reduceMazeAuthorityCommand(state, uid, {
    ...command,
    roomId: ROOM_ID,
    expectedGeneration: state?.meta.generation ?? 0,
    expectedRevision: state?.meta.revision ?? 0,
  }, now).state;
}

function playingRoom(): MazeAuthorityState {
  let state = apply(null, OWNER, {
    type: 'createRoom',
    commandId: 'offline-create-001',
    name: 'Offline room',
    maxPlayers: 2,
  }, 1_000);
  state = apply(state, GUEST, {
    type: 'joinRoom',
    commandId: 'offline-join-0001',
  }, 1_100);
  state = apply(state, OWNER, {
    type: 'submitMap',
    commandId: 'offline-owner-map',
    map: map(),
  }, 1_200);
  state = apply(state, GUEST, {
    type: 'submitMap',
    commandId: 'offline-guest-map',
    map: map(),
  }, 1_300);
  return apply(state, OWNER, {
    type: 'startMatch',
    commandId: 'offline-start-001',
  }, 1_400);
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

  reference(path: string): MazeOfflineTurnAuthorityReference & MazePresenceTransactionReference {
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

function coldReference(
  store: Store,
  path: string,
): MazeOfflineTurnAuthorityReference & MazePresenceTransactionReference {
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

function offlineLease() {
  return {
    uid: OWNER,
    roomId: ROOM_ID,
    generation: 1,
    epoch: 2,
    online: false,
    lastSeen: NOW - 50_000,
    offlineSince: NOW - 50_000,
    updatedAt: NOW - 50_000,
  };
}

async function rejectsReason(promise: Promise<unknown>, reason: string): Promise<void> {
  await assert.rejects(promise, (error: unknown) => {
    assert.ok(error instanceof HttpsError);
    assert.deepEqual(error.details, { reason });
    return true;
  });
}

test('strict request and deterministic claim identity contain no client-owned result fields', () => {
  const request = parseMazeOfflineTurnRequest({
    roomId: ROOM_ID,
    targetUid: OWNER,
    generation: 1,
    leaseEpoch: 2,
    turnNumber: 1,
  });
  assert.deepEqual(request, {
    roomId: ROOM_ID,
    targetUid: OWNER,
    generation: 1,
    leaseEpoch: 2,
    turnNumber: 1,
  });
  assert.match(mazeOfflineTurnClaimId(request), /^timeout_[a-f0-9]{48}$/u);
  assert.notEqual(
    mazeOfflineTurnClaimId(request),
    mazeOfflineTurnClaimId({ ...request, turnNumber: 2 }),
    'each canonical turn rotation has its own idempotency identity',
  );
  assert.throws(() => parseMazeOfflineTurnRequest({ ...request, result: 'forfeit' }), HttpsError);
});

test('an online member claims an expired current turn once and the server skips without settling', async () => {
  const store = new Store();
  const authorityPath = `mazeAuthority/v1/rooms/${ROOM_ID}`;
  const leasePath = `mazePresence/v1/leases/${ROOM_ID}/${OWNER}`;
  store.seed(authorityPath, playingRoom());
  store.seed(leasePath, offlineLease());
  const handler = createMazeOfflineTurnCallableHandler({
    now: () => NOW,
    getAuthorityReference: (path) => coldReference(store, path),
    getLeaseReference: (path) => coldReference(store, path),
  });
  const data = {
    roomId: ROOM_ID,
    targetUid: OWNER,
    generation: 1,
    leaseEpoch: 2,
    turnNumber: 1,
  };
  const first = await handler({ auth: { uid: GUEST }, data });
  assert.equal(first.ok, true);
  assert.equal(first.replayed, false);
  assert.equal(first.result.type, 'skipOfflineTurn');
  const committed = parseMazeAuthorityState(store.read(authorityPath));
  assert.equal(committed.gameState.players[OWNER].forfeited, false);
  assert.deepEqual(committed.gameState.players[OWNER].position, { row: 0, col: 0 });
  assert.equal(committed.gameState.players[OWNER].moves, 0);
  assert.equal(committed.gameState.currentTurn, GUEST);
  assert.equal(committed.gameState.turnNumber, 2);
  assert.equal(committed.gameState.phase, 'play');
  assert.equal(committed.gameState.winner, null);
  assert.equal(committed.gameState.draw, null);
  assert.equal(
    committed.receipts.byId[first.claimId].actorId,
    OWNER,
    'the timeout skip is bound to the target player, never to the claimant',
  );
  assert.equal(
    (store.read(leasePath) as Record<string, unknown>).timeoutClaim,
    undefined,
    'the lease lock is released after the Authority commit',
  );

  store.seed(leasePath, { ...offlineLease(), online: true, offlineSince: undefined, epoch: 3 });
  const replay = await handler({ auth: { uid: GUEST }, data });
  assert.equal(replay.replayed, true);
  assert.deepEqual(replay.result, first.result);
  assert.equal(parseMazeAuthorityState(store.read(authorityPath)).meta.revision, committed.meta.revision);
});

test('reconnect and grace checks reject before any Authority mutation', async () => {
  const store = new Store();
  const authorityPath = `mazeAuthority/v1/rooms/${ROOM_ID}`;
  const leasePath = `mazePresence/v1/leases/${ROOM_ID}/${OWNER}`;
  const initial = playingRoom();
  store.seed(authorityPath, initial);
  store.seed(leasePath, {
    ...offlineLease(),
    online: true,
    epoch: 3,
    offlineSince: undefined,
  });
  const handler = createMazeOfflineTurnCallableHandler({
    now: () => NOW,
    getAuthorityReference: (path) => store.reference(path),
    getLeaseReference: (path) => store.reference(path),
  });
  await rejectsReason(handler({
    auth: { uid: GUEST },
    data: {
      roomId: ROOM_ID,
      targetUid: OWNER,
      generation: 1,
      leaseEpoch: 3,
      turnNumber: 1,
    },
  }), 'target-online');
  assert.deepEqual(parseMazeAuthorityState(store.read(authorityPath)), initial);

  store.seed(leasePath, {
    ...offlineLease(),
    offlineSince: NOW - 44_999,
    lastSeen: NOW - 44_999,
  });
  await rejectsReason(handler({
    auth: { uid: GUEST },
    data: {
      roomId: ROOM_ID,
      targetUid: OWNER,
      generation: 1,
      leaseEpoch: 2,
      turnNumber: 1,
    },
  }), 'grace-active');
  assert.deepEqual(parseMazeAuthorityState(store.read(authorityPath)), initial);
});

test('spectators and stale turn targets cannot claim an offline participant', async () => {
  const store = new Store();
  const authorityPath = `mazeAuthority/v1/rooms/${ROOM_ID}`;
  const leasePath = `mazePresence/v1/leases/${ROOM_ID}/${OWNER}`;
  store.seed(authorityPath, playingRoom());
  store.seed(leasePath, offlineLease());
  const handler = createMazeOfflineTurnCallableHandler({
    now: () => NOW,
    getAuthorityReference: (path) => store.reference(path),
    getLeaseReference: (path) => store.reference(path),
  });
  await rejectsReason(handler({
    auth: { uid: 'offline-spectator-001' },
    data: {
      roomId: ROOM_ID,
      targetUid: OWNER,
      generation: 1,
      leaseEpoch: 2,
      turnNumber: 1,
    },
  }), 'member-required');

  const state = parseMazeAuthorityState(store.read(authorityPath));
  state.gameState.currentTurn = GUEST;
  store.seed(authorityPath, state);
  await rejectsReason(handler({
    auth: { uid: GUEST },
    data: {
      roomId: ROOM_ID,
      targetUid: OWNER,
      generation: 1,
      leaseEpoch: 2,
      turnNumber: 1,
    },
  }), 'turn-changed');
});

test('the same offline lease can skip a later rotation with a distinct turn receipt', async () => {
  const store = new Store();
  const authorityPath = `mazeAuthority/v1/rooms/${ROOM_ID}`;
  const leasePath = `mazePresence/v1/leases/${ROOM_ID}/${OWNER}`;
  store.seed(authorityPath, playingRoom());
  store.seed(leasePath, offlineLease());
  const firstHandler = createMazeOfflineTurnCallableHandler({
    now: () => NOW,
    getAuthorityReference: (path) => store.reference(path),
    getLeaseReference: (path) => store.reference(path),
  });
  const first = await firstHandler({
    auth: { uid: GUEST },
    data: {
      roomId: ROOM_ID,
      targetUid: OWNER,
      generation: 1,
      leaseEpoch: 2,
      turnNumber: 1,
    },
  });

  let state = parseMazeAuthorityState(store.read(authorityPath));
  state = apply(state, GUEST, {
    type: 'turn',
    commandId: 'offline-guest-normal-turn',
    action: { type: 'move', direction: 'right' },
  }, NOW + 1);
  assert.equal(state.gameState.currentTurn, OWNER);
  assert.equal(state.gameState.turnNumber, 3);
  store.seed(authorityPath, state);

  const secondHandler = createMazeOfflineTurnCallableHandler({
    now: () => NOW + 2,
    getAuthorityReference: (path) => store.reference(path),
    getLeaseReference: (path) => store.reference(path),
  });
  const second = await secondHandler({
    auth: { uid: GUEST },
    data: {
      roomId: ROOM_ID,
      targetUid: OWNER,
      generation: 1,
      leaseEpoch: 2,
      turnNumber: 3,
    },
  });
  assert.notEqual(second.claimId, first.claimId);
  assert.equal(second.result.currentTurn, GUEST);
  assert.equal(second.result.turnNumber, 4);
  const committed = parseMazeAuthorityState(store.read(authorityPath));
  assert.equal(committed.receipts.byId[first.claimId].commandType, 'skipOfflineTurn');
  assert.equal(committed.receipts.byId[second.claimId].commandType, 'skipOfflineTurn');
  assert.deepEqual(committed.gameState.players[OWNER].position, { row: 0, col: 0 });
  assert.equal(committed.gameState.players[OWNER].forfeited, false);
  assert.equal(committed.gameState.phase, 'play');
  assert.equal(committed.gameState.winner, null);
  assert.equal(committed.gameState.draw, null);
});

test('an offline final active runner is never skipped or synthetically settled', async () => {
  const store = new Store();
  const authorityPath = `mazeAuthority/v1/rooms/${ROOM_ID}`;
  const leasePath = `mazePresence/v1/leases/${ROOM_ID}/${OWNER}`;
  const state = playingRoom();
  state.gameState.players[GUEST] = {
    ...state.gameState.players[GUEST],
    finished: true,
    finishMoves: 1,
  };
  store.seed(authorityPath, state);
  store.seed(leasePath, offlineLease());
  const handler = createMazeOfflineTurnCallableHandler({
    now: () => NOW,
    getAuthorityReference: (path) => store.reference(path),
    getLeaseReference: (path) => store.reference(path),
  });
  await rejectsReason(handler({
    auth: { uid: GUEST },
    data: {
      roomId: ROOM_ID,
      targetUid: OWNER,
      generation: 1,
      leaseEpoch: 2,
      turnNumber: 1,
    },
  }), 'no-other-active-runner');
  const committed = parseMazeAuthorityState(store.read(authorityPath));
  assert.equal(committed.meta.revision, state.meta.revision);
  assert.equal(committed.gameState.currentTurn, OWNER);
  assert.equal(committed.gameState.phase, 'play');
  assert.equal(committed.gameState.winner, null);
  assert.equal(committed.gameState.draw, null);
  assert.equal(committed.gameState.players[OWNER].forfeited, false);
  assert.equal((store.read(leasePath) as Record<string, unknown>).timeoutClaim, undefined);
});
