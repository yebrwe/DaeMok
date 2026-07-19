import assert from 'node:assert/strict';
import test from 'node:test';
import { HttpsError } from 'firebase-functions/v2/https';
import type { GameMap } from '../vendor/maze-engine/dist/types/game';
import {
  parseMazeAuthorityState,
  reduceMazeAuthorityCommand,
  type CreateRoomCommand,
  type JoinRoomCommand,
  type MazeAuthorityCommand,
  type MazeAuthorityState,
} from './mazeAuthorityDomain';
import {
  createMazeAuthorityCommandCallableHandler,
  mazeAuthorityStatePath,
  runMazeAuthorityCommandInTransaction,
  type MazeAuthorityCallableDependencies,
  type MazeAuthorityTransactionReference,
  type MazeAuthorityTransactionResult,
} from './mazeAuthorityAdapter';

const OWNER = 'maze-owner-001';
const GUEST = 'maze-guest-001';
const THIRD = 'maze-third-001';
const ROOM_ID = 'maze-room-adapter-001';

function clone<T>(value: T): T {
  return value == null ? value : structuredClone(value);
}

/** Mimics RTDB's removal of null values and empty collection children. */
function simulateRealtimeDatabase(value: unknown): unknown {
  if (value === null || value === undefined) return undefined;
  if (Array.isArray(value)) {
    if (value.length === 0) return undefined;
    return value.map(simulateRealtimeDatabase);
  }
  if (typeof value !== 'object') return value;
  const children = Object.entries(value as Record<string, unknown>)
    .map(([key, child]) => [key, simulateRealtimeDatabase(child)] as const)
    .filter((entry): entry is readonly [string, unknown] => entry[1] !== undefined);
  return children.length === 0 ? undefined : Object.fromEntries(children);
}

class OptimisticMazeStore {
  readonly requestedPaths: string[] = [];
  callbackCount = 0;
  commitCount = 0;

  private readonly values = new Map<string, unknown>();
  private readonly versions = new Map<string, number>();
  private firstAttemptBarrier: {
    parties: number;
    arrivals: number;
    promise: Promise<void>;
    release: () => void;
  } | null = null;

  seed(path: string, value: unknown): void {
    this.values.set(path, clone(simulateRealtimeDatabase(value)));
    this.versions.set(path, (this.versions.get(path) ?? 0) + 1);
  }

  read(path: string): unknown {
    return clone(this.values.get(path));
  }

  armFirstAttemptBarrier(parties: number): void {
    let release = (): void => undefined;
    const promise = new Promise<void>((resolve) => { release = resolve; });
    this.firstAttemptBarrier = { parties, arrivals: 0, promise, release };
  }

  private async waitAtFirstAttemptBarrier(attempt: number): Promise<void> {
    const barrier = this.firstAttemptBarrier;
    if (!barrier || attempt !== 1) return;
    barrier.arrivals += 1;
    if (barrier.arrivals === barrier.parties) barrier.release();
    await barrier.promise;
  }

  readonly getStateReference = (path: string): MazeAuthorityTransactionReference => {
    this.requestedPaths.push(path);
    return {
      transaction: async (update): Promise<MazeAuthorityTransactionResult> => {
        let attempt = 0;
        while (true) {
          attempt += 1;
          const version = this.versions.get(path) ?? 0;
          const candidate = update(clone(this.values.get(path)));
          this.callbackCount += 1;
          if (candidate === undefined) {
            return {
              committed: false,
              snapshot: { val: () => clone(this.values.get(path)) },
            };
          }

          await this.waitAtFirstAttemptBarrier(attempt);
          if ((this.versions.get(path) ?? 0) !== version) continue;

          const stored = simulateRealtimeDatabase(candidate);
          this.values.set(path, clone(stored));
          this.versions.set(path, version + 1);
          this.commitCount += 1;
          return {
            committed: true,
            snapshot: { val: () => clone(stored) },
          };
        }
      },
    };
  };
}

function createCommand(overrides: Partial<CreateRoomCommand> = {}): CreateRoomCommand {
  return {
    type: 'createRoom',
    commandId: 'adapter-create-001',
    roomId: ROOM_ID,
    expectedGeneration: 0,
    expectedRevision: 0,
    name: 'Adapter Room',
    maxPlayers: 4,
    ...overrides,
  };
}

function joinCommand(
  commandId: string,
  expectedRevision = 1,
): JoinRoomCommand {
  return {
    type: 'joinRoom',
    commandId,
    roomId: ROOM_ID,
    expectedGeneration: 1,
    expectedRevision,
  };
}

function simpleMap(): GameMap {
  return {
    rulesVersion: 3,
    startPosition: { row: 0, col: 0 },
    endPosition: { row: 0, col: 1 },
    obstacles: [],
    items: [],
    skillLoadout: 'scoutPulse',
  };
}

function createState(now = 1_000): MazeAuthorityState {
  return reduceMazeAuthorityCommand(null, OWNER, createCommand(), now).state;
}

function handlerFor(
  store: OptimisticMazeStore,
  now: number,
): ReturnType<typeof createMazeAuthorityCommandCallableHandler> {
  return createMazeAuthorityCommandCallableHandler({
    now: () => now,
    getStateReference: store.getStateReference,
  });
}

async function rejectsHttpsError(
  promise: Promise<unknown>,
  code: HttpsError['code'],
  reason?: string,
): Promise<HttpsError> {
  let caught: HttpsError | null = null;
  await assert.rejects(promise, (error: unknown) => {
    assert.ok(error instanceof HttpsError);
    assert.equal(error.code, code);
    if (reason !== undefined) assert.deepEqual(error.details, { reason });
    else assert.equal(error.details, undefined);
    caught = error;
    return true;
  });
  assert.ok(caught);
  return caught;
}

test('callable rejects unauthenticated and malformed commands before database access', async () => {
  const store = new OptimisticMazeStore();
  const handler = handlerFor(store, 1_000);

  await rejectsHttpsError(
    handler({ auth: null, data: createCommand() }),
    'unauthenticated',
  );
  await rejectsHttpsError(
    handler({
      auth: { uid: OWNER },
      data: { ...createCommand(), forgedOwnerId: OWNER },
    }),
    'invalid-argument',
    'create-room-command',
  );
  await rejectsHttpsError(
    handler({
      auth: { uid: OWNER },
      data: { ...joinCommand('adapter-join-bad-001'), expectedRevision: 1.5 },
    }),
    'invalid-argument',
    'command-cas',
  );
  assert.equal(store.requestedPaths.length, 0);
});

test('create and join commit through the requested room path with canonical receipts', async () => {
  const store = new OptimisticMazeStore();
  const path = mazeAuthorityStatePath(ROOM_ID);

  const created = await handlerFor(store, 1_000)({
    auth: { uid: OWNER },
    data: createCommand(),
  });
  assert.equal(created.ok, true);
  assert.equal(created.replayed, false);
  assert.deepEqual(created.result, {
    type: 'createRoom',
    roomId: ROOM_ID,
    generation: 1,
    revision: 1,
  });

  const joined = await handlerFor(store, 1_100)({
    auth: { uid: GUEST },
    data: joinCommand('adapter-join-0001'),
  });
  assert.equal(joined.replayed, false);
  assert.equal(joined.result.type, 'joinRoom');
  assert.equal(joined.result.revision, 2);
  if (joined.result.type === 'joinRoom') assert.equal(joined.result.slot, 1);

  assert.deepEqual(store.requestedPaths, [path, path]);
  assert.equal(store.commitCount, 2);
  const state = parseMazeAuthorityState(store.read(path));
  assert.equal(state.meta.revision, 2);
  assert.deepEqual(Object.keys(state.lobby.members).sort(), [GUEST, OWNER].sort());
  assert.deepEqual(state.receipts.order, ['adapter-create-001', 'adapter-join-0001']);
});

test('create and join inject only trusted bounded profile fields outside the command hash', async () => {
  const store = new OptimisticMazeStore();
  const profiles: Record<string, unknown> = {
    [OWNER]: {
      displayName: '  토끼 방장  ',
      photoURL: 'https://lh3.googleusercontent.com/maze-owner',
      forgedWins: 999,
    },
    [GUEST]: {
      displayName: '',
      photoURL: 'https://example.invalid/forged.png',
    },
  };
  const handler = createMazeAuthorityCommandCallableHandler({
    now: () => 1_000,
    getStateReference: store.getStateReference,
    readActorProfile: async (uid) => profiles[uid],
  });
  await handler({
    auth: { uid: OWNER },
    data: createCommand({ commandId: 'adapter-profile-create' }),
  });
  const join = joinCommand('adapter-profile-join');
  await createMazeAuthorityCommandCallableHandler({
    now: () => 1_100,
    getStateReference: store.getStateReference,
    readActorProfile: async (uid) => profiles[uid],
  })({ auth: { uid: GUEST }, data: join });

  const state = parseMazeAuthorityState(store.read(mazeAuthorityStatePath(ROOM_ID)));
  assert.equal(state.gameState.players[OWNER].displayName, '토끼 방장');
  assert.equal(
    state.gameState.players[OWNER].photoURL,
    'https://lh3.googleusercontent.com/maze-owner',
  );
  assert.equal(state.gameState.players[GUEST].displayName, '플레이어');
  assert.equal(state.gameState.players[GUEST].photoURL, undefined);
  assert.equal('forgedWins' in state.gameState.players[OWNER], false);
});

test('non-membership commands never depend on an unrelated profile read', async () => {
  const store = new OptimisticMazeStore();
  const path = mazeAuthorityStatePath(ROOM_ID);
  const state = createState();
  store.seed(path, state);
  let profileReads = 0;
  const handler = createMazeAuthorityCommandCallableHandler({
    now: () => 1_100,
    getStateReference: store.getStateReference,
    readActorProfile: async () => {
      profileReads += 1;
      throw new Error('profile unavailable');
    },
  });
  const response = await handler({
    auth: { uid: OWNER },
    data: {
      type: 'closeRoom',
      commandId: 'adapter-close-no-profile',
      roomId: ROOM_ID,
      expectedGeneration: state.meta.generation,
      expectedRevision: state.meta.revision,
    },
  });
  assert.equal(response.result.type, 'closeRoom');
  assert.equal(profileReads, 0);
});

test('post-commit derivation accepts RTDB-elided maps, nulls, and empty arrays', async () => {
  const store = new OptimisticMazeStore();
  const path = mazeAuthorityStatePath(ROOM_ID);
  const handler = handlerFor(store, 1_000);

  const response = await handler({ auth: { uid: OWNER }, data: createCommand() });
  assert.equal(response.replayed, false);
  const raw = store.read(path) as Record<string, unknown>;
  const rawGame = raw.gameState as Record<string, unknown>;
  assert.equal(Object.prototype.hasOwnProperty.call(rawGame, 'maps'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(rawGame, 'winner'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(rawGame, 'draw'), false);

  const joined = await handlerFor(store, 1_100)({
    auth: { uid: GUEST },
    data: joinCommand('adapter-elided-join-01'),
  });
  assert.equal(joined.result.revision, 2);
  const canonical = parseMazeAuthorityState(store.read(path));
  assert.deepEqual(canonical.gameState.maps, {});
  assert.equal(canonical.gameState.winner, null);
  assert.equal(canonical.gameState.draw, null);
});

test('an SDK retry may invoke the reducer callback repeatedly without duplicating effects', async () => {
  const initial = simulateRealtimeDatabase(createState());
  let callbacks = 0;
  let firstCandidate: unknown;
  const reference: MazeAuthorityTransactionReference = {
    transaction: async (update) => {
      firstCandidate = update(clone(initial));
      callbacks += 1;
      const secondCandidate = update(clone(initial));
      callbacks += 1;
      assert.deepEqual(secondCandidate, firstCandidate);
      return {
        committed: true,
        snapshot: { val: () => clone(simulateRealtimeDatabase(secondCandidate)) },
      };
    },
  };

  const response = await runMazeAuthorityCommandInTransaction({
    uid: GUEST,
    command: joinCommand('adapter-sdk-retry-01'),
    now: 1_100,
    reference,
  });
  assert.equal(callbacks, 2);
  assert.equal(response.replayed, false);
  assert.equal(response.result.revision, 2);
});

test('a cold RTDB null callback retries against the existing remote room', async () => {
  const initial = simulateRealtimeDatabase(createState());
  let callbacks = 0;
  const reference: MazeAuthorityTransactionReference = {
    transaction: async (update) => {
      const coldCandidate = update(null);
      callbacks += 1;
      assert.equal(coldCandidate, null, 'null must continue the server CAS instead of aborting');
      const committedCandidate = update(clone(initial));
      callbacks += 1;
      assert.ok(committedCandidate);
      return {
        committed: true,
        snapshot: { val: () => clone(simulateRealtimeDatabase(committedCandidate)) },
      };
    },
  };

  const response = await runMazeAuthorityCommandInTransaction({
    uid: GUEST,
    command: joinCommand('adapter-cold-null-join'),
    now: 1_100,
    reference,
  });
  assert.equal(callbacks, 2);
  assert.equal(response.replayed, false);
  assert.equal(response.result.type, 'joinRoom');
  assert.equal(response.result.revision, 2);
});

test('concurrent commands on one CAS fence commit exactly one winner', async () => {
  const store = new OptimisticMazeStore();
  const path = mazeAuthorityStatePath(ROOM_ID);
  store.seed(path, createState());
  store.armFirstAttemptBarrier(2);

  const commands = [
    runMazeAuthorityCommandInTransaction({
      uid: GUEST,
      command: joinCommand('adapter-race-guest-01'),
      now: 1_100,
      reference: store.getStateReference(path),
    }),
    runMazeAuthorityCommandInTransaction({
      uid: THIRD,
      command: joinCommand('adapter-race-third-01'),
      now: 1_100,
      reference: store.getStateReference(path),
    }),
  ];
  const outcomes = await Promise.allSettled(commands);
  const fulfilled = outcomes.filter((outcome) => outcome.status === 'fulfilled');
  const rejected = outcomes.filter((outcome) => outcome.status === 'rejected');
  assert.equal(fulfilled.length, 1);
  assert.equal(rejected.length, 1);
  if (rejected[0].status === 'rejected') {
    assert.ok(rejected[0].reason instanceof HttpsError);
    assert.equal(rejected[0].reason.code, 'aborted');
    assert.deepEqual(rejected[0].reason.details, { reason: 'revision-mismatch' });
  }
  assert.equal(store.commitCount, 1);
  assert.equal(store.callbackCount, 3, 'the CAS loser must be retried against the winning state');
  const state = parseMazeAuthorityState(store.read(path));
  assert.equal(state.meta.revision, 2);
  assert.equal(Object.keys(state.lobby.members).length, 2);
});

test('a lost response is recovered by exact command replay without a second commit', async () => {
  const store = new OptimisticMazeStore();
  const path = mazeAuthorityStatePath(ROOM_ID);
  store.seed(path, createState());
  const inner = store.getStateReference(path);
  let loseResponse = true;
  const lossyReference: MazeAuthorityTransactionReference = {
    transaction: async (update) => {
      const result = await inner.transaction(update, undefined, false);
      if (loseResponse) {
        loseResponse = false;
        throw new Error('connection lost after the server committed');
      }
      return result;
    },
  };
  const command = joinCommand('adapter-lost-response-01');

  await rejectsHttpsError(runMazeAuthorityCommandInTransaction({
    uid: GUEST,
    command,
    now: 1_100,
    reference: lossyReference,
  }), 'unavailable');
  assert.equal(store.commitCount, 1);

  const replay = await runMazeAuthorityCommandInTransaction({
    uid: GUEST,
    command,
    now: 1_100,
    reference: store.getStateReference(path),
  });
  assert.equal(replay.replayed, true);
  assert.equal(replay.result.revision, 2);
  assert.equal(store.commitCount, 1);
  assert.equal(parseMazeAuthorityState(store.read(path)).lobby.members[GUEST].slot, 1);
});

test('a reused command id with a different binding fails with an idempotency reason', async () => {
  const store = new OptimisticMazeStore();
  const path = mazeAuthorityStatePath(ROOM_ID);
  store.seed(path, createState());
  const command = joinCommand('adapter-conflict-id-01');
  await runMazeAuthorityCommandInTransaction({
    uid: GUEST,
    command,
    now: 1_100,
    reference: store.getStateReference(path),
  });

  await rejectsHttpsError(runMazeAuthorityCommandInTransaction({
    uid: THIRD,
    command,
    now: 1_100,
    reference: store.getStateReference(path),
  }), 'already-exists', 'idempotency-conflict');
  assert.equal(store.commitCount, 1);
});

test('the response is derived from the final committed snapshot after SDK retries', async () => {
  const created = createState();
  const ownerMapCommand: MazeAuthorityCommand = {
    type: 'submitMap',
    commandId: 'adapter-owner-map-001',
    roomId: ROOM_ID,
    expectedGeneration: 1,
    expectedRevision: 1,
    map: simpleMap(),
  };
  const slotOneFree = reduceMazeAuthorityCommand(
    created,
    OWNER,
    ownerMapCommand,
    1_050,
  ).state;
  const slotOneOccupied = reduceMazeAuthorityCommand(
    created,
    THIRD,
    joinCommand('adapter-third-first-01'),
    1_050,
  ).state;
  const command = joinCommand('adapter-snapshot-join-01', 2);
  let callbackCount = 0;
  const reference: MazeAuthorityTransactionReference = {
    transaction: async (update) => {
      const abandonedCandidate = update(simulateRealtimeDatabase(slotOneFree));
      callbackCount += 1;
      assert.ok(abandonedCandidate);
      const committedCandidate = update(simulateRealtimeDatabase(slotOneOccupied));
      callbackCount += 1;
      assert.ok(committedCandidate);
      return {
        committed: true,
        snapshot: { val: () => clone(simulateRealtimeDatabase(committedCandidate)) },
      };
    },
  };

  const response = await runMazeAuthorityCommandInTransaction({
    uid: GUEST,
    command,
    now: 1_100,
    reference,
  });
  assert.equal(callbackCount, 2);
  assert.equal(response.result.type, 'joinRoom');
  if (response.result.type === 'joinRoom') {
    assert.equal(response.result.slot, 2, 'must use the committed retry snapshot, not attempt one');
  }
});

test('malformed transaction results fail closed as data-loss', async () => {
  const malformedReferences: MazeAuthorityTransactionReference[] = [
    {
      transaction: async () => null as unknown as MazeAuthorityTransactionResult,
    },
    {
      transaction: async () => ({
        committed: true,
        snapshot: { val: () => { throw new Error('broken snapshot'); } },
      }),
    },
  ];
  for (const reference of malformedReferences) {
    await rejectsHttpsError(runMazeAuthorityCommandInTransaction({
      uid: OWNER,
      command: createCommand(),
      now: 1_000,
      reference,
    }), 'data-loss');
  }
});

test('transaction transport failures map retry exhaustion to aborted and others to unavailable', async () => {
  const failureReference = (error: unknown): MazeAuthorityTransactionReference => ({
    transaction: async () => { throw error; },
  });
  for (const error of [
    { code: 'DATABASE/MAX_RETRIES' },
    new Error('transaction aborted after max retries'),
  ]) {
    await rejectsHttpsError(runMazeAuthorityCommandInTransaction({
      uid: OWNER,
      command: createCommand(),
      now: 1_000,
      reference: failureReference(error),
    }), 'aborted');
  }
  await rejectsHttpsError(runMazeAuthorityCommandInTransaction({
    uid: OWNER,
    command: createCommand(),
    now: 1_000,
    reference: failureReference(new Error('socket disconnected')),
  }), 'unavailable');
});

test('invalid trusted dependencies fail closed without leaking implementation errors', async () => {
  const store = new OptimisticMazeStore();
  const dependencies: MazeAuthorityCallableDependencies = {
    now: () => Number.NaN,
    getStateReference: store.getStateReference,
  };
  const handler = createMazeAuthorityCommandCallableHandler(dependencies);
  await rejectsHttpsError(handler({
    auth: { uid: OWNER },
    data: createCommand(),
  }), 'internal');
});
