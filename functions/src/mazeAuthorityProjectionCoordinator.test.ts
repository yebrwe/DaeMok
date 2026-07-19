import assert from 'node:assert/strict';
import { setImmediate as nextImmediate } from 'node:timers/promises';
import { test } from 'node:test';
import { HttpsError } from 'firebase-functions/v2/https';
import type { GameMap } from '../vendor/maze-engine/dist/types/game';
import { mazeAuthorityStatePath } from './mazeAuthorityAdapter';
import {
  reduceMazeAuthorityCommand,
  type MazeAuthorityState,
} from './mazeAuthorityDomain';
import {
  buildMazeAuthorityMemberView,
  buildMazeAuthorityPublicView,
} from './mazeAuthorityView';
import {
  mazeAuthorityMemberViewPath,
  mazeAuthorityPublicViewPath,
  mazeAuthorityViewManifestPath,
  persistedMazeAuthorityViewMatches,
  type MazeAuthorityProjectionTransactionReference,
} from './mazeAuthorityProjection';
import {
  MAZE_AUTHORITY_PROJECTION_MAX_CONVERGENCE_ATTEMPTS,
  createMazeAuthoritySyncCallableHandler,
  runMazeAuthorityCommandWithProjection,
  syncCurrentMazeAuthorityViewProjection,
  type MazeAuthorityProjectionCoordinatorDependencies,
  type MazeAuthoritySourceReference,
} from './mazeAuthorityProjectionCoordinator';

const OWNER = 'coordinator-owner-001';
const GUEST = 'coordinator-guest-001';
const ROOM_ID = 'coordinator-room-001';
const PRIVATE_ERROR = 'private-maze-coordinator-secret';

function clone<T>(value: T): T {
  return structuredClone(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Mirrors snapshots returned after RTDB removes empty/null children. */
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
    skillLoadout: 'dash',
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

/** Revisions 1..5: create, join, owner map, guest map, start. */
function createTimeline(): MazeAuthorityState[] {
  const states: MazeAuthorityState[] = [];
  let state = reduceMazeAuthorityCommand(null, OWNER, {
    type: 'createRoom',
    commandId: 'coordinator-create-0001',
    roomId: ROOM_ID,
    expectedGeneration: 0,
    expectedRevision: 0,
    name: 'Coordinator Room',
    maxPlayers: 2,
  }, 2_000).state;
  states.push(state);
  state = applyCommand(state, GUEST, {
    type: 'joinRoom',
    commandId: 'coordinator-join-00001',
  }, 2_100);
  states.push(state);
  state = applyCommand(state, OWNER, {
    type: 'submitMap',
    commandId: 'coordinator-owner-map-01',
    map: ownerMap(),
  }, 2_200);
  states.push(state);
  state = applyCommand(state, GUEST, {
    type: 'submitMap',
    commandId: 'coordinator-guest-map-01',
    map: guestMap(),
  }, 2_300);
  states.push(state);
  state = applyCommand(state, OWNER, {
    type: 'startMatch',
    commandId: 'coordinator-start-0001',
  }, 2_400);
  states.push(state);
  return states;
}

class SequencedAuthorityStore {
  readonly requestedPaths: string[] = [];
  readCount = 0;

  constructor(private readonly values: readonly unknown[]) {}

  getAuthorityReference = (path: string): MazeAuthoritySourceReference => {
    this.requestedPaths.push(path);
    return {
      get: async () => {
        const index = Math.min(this.readCount, this.values.length - 1);
        this.readCount += 1;
        return {
          val: () => clone(rtdbEncode(this.values[index]) ?? null),
        };
      },
    };
  };
}

interface ProjectionGate {
  path: string;
  used: boolean;
  reached: Promise<void>;
  markReached(): void;
  released: Promise<void>;
  release(): void;
}

class ProjectionStore {
  private readonly values = new Map<string, unknown>();
  private gate: ProjectionGate | null = null;
  readonly requestedPaths: string[] = [];
  commitCount = 0;

  seed(path: string, value: unknown): void {
    this.values.set(path, clone(rtdbEncode(value) ?? null));
  }

  read(path: string): unknown {
    return clone(this.values.get(path) ?? null);
  }

  blockNext(path: string): { reached: Promise<void>; release(): void } {
    let markReached = (): void => undefined;
    let release = (): void => undefined;
    const reached = new Promise<void>((resolve) => { markReached = resolve; });
    const released = new Promise<void>((resolve) => { release = resolve; });
    this.gate = { path, used: false, reached, markReached, released, release };
    return { reached, release };
  }

  getViewReference = (path: string): MazeAuthorityProjectionTransactionReference => {
    this.requestedPaths.push(path);
    return {
      get: async () => ({ val: () => this.read(path) }),
      transaction: async (update, _onComplete, applyLocally) => {
        assert.equal(applyLocally, false);
        const candidate = update(this.read(path));
        if (candidate === undefined) {
          return {
            committed: false,
            snapshot: { val: () => this.read(path) },
          };
        }

        const gate = this.gate;
        if (gate && gate.path === path && !gate.used) {
          gate.used = true;
          gate.markReached();
          await gate.released;
        }
        this.values.set(path, clone(rtdbEncode(candidate) ?? null));
        this.commitCount += 1;
        return {
          committed: true,
          snapshot: { val: () => this.read(path) },
        };
      },
    };
  };
}

function dependencies(
  authority: SequencedAuthorityStore,
  projection: ProjectionStore,
): MazeAuthorityProjectionCoordinatorDependencies {
  return {
    getAuthorityReference: authority.getAuthorityReference,
    getViewReference: projection.getViewReference,
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

test('rereads source N and converges all public/member views to N+1', async () => {
  const timeline = createTimeline();
  const revisionN = timeline[3];
  const revisionN1 = timeline[4];
  const authority = new SequencedAuthorityStore([revisionN, revisionN1, revisionN1]);
  const projection = new ProjectionStore();

  const result = await syncCurrentMazeAuthorityViewProjection(
    ROOM_ID,
    dependencies(authority, projection),
  );

  assert.equal(result.ok, true);
  assert.equal(result.convergenceAttempts, 2);
  assert.equal(result.generation, revisionN1.meta.generation);
  assert.equal(result.revision, revisionN1.meta.revision);
  assert.equal(authority.readCount, 4);
  assert.deepEqual(authority.requestedPaths, Array(4).fill(mazeAuthorityStatePath(ROOM_ID)));
  assert.equal(projection.commitCount, 7);
  assert.equal(
    persistedMazeAuthorityViewMatches(
      projection.read(mazeAuthorityPublicViewPath(ROOM_ID)),
      buildMazeAuthorityPublicView(revisionN1),
    ),
    true,
  );
  for (const uid of [OWNER, GUEST]) {
    assert.equal(
      persistedMazeAuthorityViewMatches(
        projection.read(mazeAuthorityMemberViewPath(uid, ROOM_ID)),
        buildMazeAuthorityMemberView(revisionN1, uid),
      ),
      true,
    );
  }
  assert.deepEqual(projection.read(mazeAuthorityViewManifestPath(ROOM_ID)), {
    manifestVersion: 1,
    roomId: ROOM_ID,
    generation: revisionN1.meta.generation,
    revision: revisionN1.meta.revision,
    memberUids: [OWNER, GUEST],
  });
});

test('converges a partially newer multi-view projection without rolling it back', async () => {
  const timeline = createTimeline();
  const revisionN = timeline[3];
  const revisionN1 = timeline[4];
  const authority = new SequencedAuthorityStore([revisionN, revisionN1, revisionN1]);
  const projection = new ProjectionStore();
  const ownerPath = mazeAuthorityMemberViewPath(OWNER, ROOM_ID);
  projection.seed(ownerPath, buildMazeAuthorityMemberView(revisionN1, OWNER));

  const result = await syncCurrentMazeAuthorityViewProjection(
    ROOM_ID,
    dependencies(authority, projection),
  );

  assert.equal(result.convergenceAttempts, 2);
  assert.equal(result.revision, revisionN1.meta.revision);
  assert.equal(
    projection.commitCount,
    4,
    'public N, public N+1, guest N+1, and the stable manifest commit',
  );
  assert.equal(
    persistedMazeAuthorityViewMatches(
      projection.read(ownerPath),
      buildMazeAuthorityMemberView(revisionN1, OWNER),
    ),
    true,
  );
  assert.deepEqual(result.writes.map((write) => write.replayed), [false, true, false]);
});

test('retries when membership advances after manifest finalization and then removes the departed view', async () => {
  const setup = createTimeline()[3];
  const departed = applyCommand(setup, GUEST, {
    type: 'leaveRoom',
    commandId: 'coordinator-guest-leave',
  }, 2_500);
  const authority = new SequencedAuthorityStore([
    setup,
    setup,
    departed,
    departed,
    departed,
  ]);
  const projection = new ProjectionStore();

  const result = await syncCurrentMazeAuthorityViewProjection(
    ROOM_ID,
    dependencies(authority, projection),
  );

  assert.equal(result.convergenceAttempts, 2);
  assert.equal(result.revision, departed.meta.revision);
  assert.equal(authority.readCount, 5);
  assert.equal(projection.read(mazeAuthorityMemberViewPath(GUEST, ROOM_ID)), null);
  assert.deepEqual(projection.read(mazeAuthorityViewManifestPath(ROOM_ID)), {
    manifestVersion: 1,
    roomId: ROOM_ID,
    generation: departed.meta.generation,
    revision: departed.meta.revision,
    memberUids: [OWNER],
  });
});

test('a stable closed tombstone removes the public view, manifested members, and manifest', async () => {
  const setup = createTimeline()[3];
  const projection = new ProjectionStore();
  await syncCurrentMazeAuthorityViewProjection(
    ROOM_ID,
    dependencies(new SequencedAuthorityStore([setup, setup, setup]), projection),
  );

  const closed = applyCommand(setup, OWNER, {
    type: 'closeRoom',
    commandId: 'coordinator-close-room',
  }, 2_600);
  const result = await syncCurrentMazeAuthorityViewProjection(
    ROOM_ID,
    dependencies(new SequencedAuthorityStore([closed, closed, closed]), projection),
  );

  assert.equal(result.convergenceAttempts, 1);
  assert.deepEqual(result.writes, []);
  assert.equal(projection.read(mazeAuthorityPublicViewPath(ROOM_ID)), null);
  assert.equal(projection.read(mazeAuthorityMemberViewPath(OWNER, ROOM_ID)), null);
  assert.equal(projection.read(mazeAuthorityMemberViewPath(GUEST, ROOM_ID)), null);
  assert.equal(projection.read(mazeAuthorityViewManifestPath(ROOM_ID)), null);
});

test('fails data-loss when a source mutates without advancing generation/revision', async () => {
  const source = createTimeline()[3];
  const mutated = clone(source);
  mutated.lobby.name = 'Mutated Without Revision';
  const authority = new SequencedAuthorityStore([source, mutated]);
  const projection = new ProjectionStore();

  await rejectsHttpsError(
    syncCurrentMazeAuthorityViewProjection(ROOM_ID, dependencies(authority, projection)),
    'data-loss',
  );
  assert.equal(authority.readCount, 2);
  assert.equal(projection.commitCount, 3);
});

test('fails data-loss when the protected source version regresses', async () => {
  const timeline = createTimeline();
  const authority = new SequencedAuthorityStore([timeline[4], timeline[3]]);
  const projection = new ProjectionStore();

  await rejectsHttpsError(
    syncCurrentMazeAuthorityViewProjection(ROOM_ID, dependencies(authority, projection)),
    'data-loss',
  );
  assert.equal(authority.readCount, 2);
  assert.equal(projection.commitCount, 3);
});

test('aborts at the bounded convergence limit while a source keeps advancing', async () => {
  const timeline = createTimeline();
  assert.equal(timeline.length, MAZE_AUTHORITY_PROJECTION_MAX_CONVERGENCE_ATTEMPTS + 1);
  const authority = new SequencedAuthorityStore(timeline);
  const projection = new ProjectionStore();

  await rejectsHttpsError(
    syncCurrentMazeAuthorityViewProjection(ROOM_ID, dependencies(authority, projection)),
    'aborted',
  );
  assert.equal(
    authority.readCount,
    MAZE_AUTHORITY_PROJECTION_MAX_CONVERGENCE_ATTEMPTS + 1,
  );
  assert.equal(projection.commitCount, 11, '2 + 3 + 3 + 3 views must commit');
  const publicValue = projection.read(mazeAuthorityPublicViewPath(ROOM_ID));
  assert.ok(isRecord(publicValue));
  assert.equal(publicValue.revision, timeline[3].meta.revision);
});

test('sync callable enforces auth and an exact payload, then returns only public metadata', async () => {
  const state = createTimeline()[4];
  const authority = new SequencedAuthorityStore([state, state]);
  const projection = new ProjectionStore();
  const handler = createMazeAuthoritySyncCallableHandler(dependencies(authority, projection));

  await rejectsHttpsError(handler({ auth: null, data: { roomId: ROOM_ID } }), 'unauthenticated');
  await rejectsHttpsError(handler({
    auth: { uid: 'invalid/member' },
    data: { roomId: ROOM_ID },
  }), 'unauthenticated');
  await rejectsHttpsError(handler({
    auth: { uid: 'sync-spectator-001' },
    data: { roomId: ROOM_ID, extra: true },
  }), 'invalid-argument');
  await rejectsHttpsError(handler({
    auth: { uid: 'sync-spectator-001' },
    data: { roomId: 'short' },
  }), 'invalid-argument');
  assert.equal(authority.readCount, 0);
  assert.deepEqual(projection.requestedPaths, []);

  const response = await handler({
    auth: { uid: 'sync-spectator-001' },
    data: { roomId: ROOM_ID },
  });
  assert.deepEqual(response, {
    ok: true,
    roomId: ROOM_ID,
    generation: state.meta.generation,
    revision: state.meta.revision,
    convergenceAttempts: 1,
  });
  assert.deepEqual(Object.keys(response).sort(), [
    'convergenceAttempts',
    'generation',
    'ok',
    'revision',
    'roomId',
  ]);
  assert.deepEqual(authority.requestedPaths, [
    mazeAuthorityStatePath(ROOM_ID),
    mazeAuthorityStatePath(ROOM_ID),
    mazeAuthorityStatePath(ROOM_ID),
  ]);
});

test('command wrapper invokes the command once and waits until projection convergence', async () => {
  const state = createTimeline()[4];
  const authority = new SequencedAuthorityStore([state, state]);
  const projection = new ProjectionStore();
  const gate = projection.blockNext(mazeAuthorityPublicViewPath(ROOM_ID));
  const commandResponse = { ok: true, revision: state.meta.revision };
  let commandCalls = 0;
  let settled = false;

  const wrapped = runMazeAuthorityCommandWithProjection({
    roomId: ROOM_ID,
    runCommand: async () => {
      commandCalls += 1;
      return commandResponse;
    },
  }, dependencies(authority, projection)).finally(() => { settled = true; });

  await gate.reached;
  await nextImmediate();
  assert.equal(commandCalls, 1);
  assert.equal(settled, false, 'the wrapper must remain pending while projection is blocked');
  gate.release();

  const response = await wrapped;
  assert.strictEqual(response, commandResponse);
  assert.equal(commandCalls, 1);
  assert.equal(settled, true);
  assert.equal(projection.commitCount, 4);

  const failingAuthority = new SequencedAuthorityStore([state]);
  let failingCommandCalls = 0;
  const throwingViewReference = (): MazeAuthorityProjectionTransactionReference => {
    throw new Error(PRIVATE_ERROR);
  };
  await rejectsHttpsError(runMazeAuthorityCommandWithProjection({
    roomId: ROOM_ID,
    runCommand: async () => {
      failingCommandCalls += 1;
      return { ok: true };
    },
  }, {
    getAuthorityReference: failingAuthority.getAuthorityReference,
    getViewReference: throwingViewReference,
  }), 'unavailable', PRIVATE_ERROR);
  assert.equal(failingCommandCalls, 1, 'projection failure must never replay the command');
});

test('maps source read/snapshot failures without exposing private data', async () => {
  const projection = new ProjectionStore();
  const throwingRead: MazeAuthoritySourceReference = {
    get: async () => { throw new Error(PRIVATE_ERROR); },
  };
  await rejectsHttpsError(syncCurrentMazeAuthorityViewProjection(ROOM_ID, {
    getAuthorityReference: () => throwingRead,
    getViewReference: projection.getViewReference,
  }), 'unavailable', PRIVATE_ERROR);

  const malformedSnapshot = { get: async () => ({}) } as MazeAuthoritySourceReference;
  await rejectsHttpsError(syncCurrentMazeAuthorityViewProjection(ROOM_ID, {
    getAuthorityReference: () => malformedSnapshot,
    getViewReference: projection.getViewReference,
  }), 'data-loss');

  const missing = new SequencedAuthorityStore([null]);
  await rejectsHttpsError(
    syncCurrentMazeAuthorityViewProjection(ROOM_ID, dependencies(missing, projection)),
    'not-found',
  );
  assert.deepEqual(projection.requestedPaths, []);
});
