import assert from 'node:assert/strict';
import test from 'node:test';
import {
  resolveTurnAction,
  type TurnAction,
} from '../vendor/maze-engine/dist/lib/gameTurn';
import {
  GamePhase,
  type GameMap,
  type MazeSkillId,
  type Position,
} from '../vendor/maze-engine/dist/types/game';
import {
  MAZE_AUTHORITY_MAX_RECEIPTS,
  MazeAuthorityDomainError,
  parseMazeAuthorityCommand,
  parseMazeAuthorityState,
  reduceMazeAuthorityCommand,
  reduceMazeAuthorityOfflineTurn,
  type CreateRoomCommand,
  type MazeAuthorityState,
  type TurnResult,
} from './mazeAuthorityDomain';

const OWNER = 'owner-user-001';
const GUEST = 'guest-user-001';
const THIRD = 'third-user-001';
const FOURTH = 'fourth-user-001';
const REPLACEMENT = 'replacement-user-001';
const ROOM_ID = 'room-authority-001';

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function simulateRealtimeDatabase(value: unknown): unknown {
  if (value === null || value === undefined) return undefined;
  if (Array.isArray(value)) {
    if (value.length === 0) return undefined;
    return value.map(simulateRealtimeDatabase);
  }
  if (typeof value !== 'object') return value;
  const entries = Object.entries(value as Record<string, unknown>)
    .map(([key, child]) => [key, simulateRealtimeDatabase(child)] as const)
    .filter((entry): entry is readonly [string, unknown] => entry[1] !== undefined);
  if (entries.length === 0) return undefined;
  return Object.fromEntries(entries);
}

function simpleMap(
  startPosition: Position = { row: 0, col: 0 },
  endPosition: Position = { row: 0, col: 1 },
  skillLoadout: MazeSkillId = 'scoutPulse',
): GameMap {
  return {
    rulesVersion: 3,
    startPosition,
    endPosition,
    obstacles: [],
    items: [],
    skillLoadout,
  };
}

function createCommand(commandId = 'command-create-001'): CreateRoomCommand {
  return {
    type: 'createRoom',
    commandId,
    roomId: ROOM_ID,
    expectedGeneration: 0,
    expectedRevision: 0,
    name: 'Authority Room',
    maxPlayers: 2,
  };
}

function createRoom(now = 1_000): MazeAuthorityState {
  return reduceMazeAuthorityCommand(null, OWNER, createCommand(), now).state;
}

function joinRoom(state: MazeAuthorityState, now = 1_100): MazeAuthorityState {
  return reduceMazeAuthorityCommand(state, GUEST, {
    type: 'joinRoom',
    commandId: 'command-join-0001',
    roomId: ROOM_ID,
    expectedGeneration: state.meta.generation,
    expectedRevision: state.meta.revision,
  }, now).state;
}

function submitMap(
  state: MazeAuthorityState,
  actorId: string,
  map: GameMap,
  commandId: string,
  now: number,
): MazeAuthorityState {
  return reduceMazeAuthorityCommand(state, actorId, {
    type: 'submitMap',
    commandId,
    roomId: ROOM_ID,
    expectedGeneration: state.meta.generation,
    expectedRevision: state.meta.revision,
    map,
  }, now).state;
}

function readyTwoPlayerRoom(
  ownerMap = simpleMap(),
  guestMap = simpleMap({ row: 5, col: 5 }, { row: 5, col: 4 }),
): MazeAuthorityState {
  let state = createRoom();
  state = joinRoom(state);
  state = submitMap(state, OWNER, ownerMap, 'command-map-owner-01', 1_200);
  return submitMap(state, GUEST, guestMap, 'command-map-guest-01', 1_300);
}

function startMatch(
  state: MazeAuthorityState,
  now = 1_400,
  actorId = OWNER,
): MazeAuthorityState {
  return reduceMazeAuthorityCommand(state, actorId, {
    type: 'startMatch',
    commandId: 'command-start-0001',
    roomId: ROOM_ID,
    expectedGeneration: state.meta.generation,
    expectedRevision: state.meta.revision,
  }, now).state;
}

function commandFor(
  state: MazeAuthorityState,
  type: 'resetMap' | 'leaveRoom' | 'restartMatch' | 'closeRoom',
  commandId: string,
): Record<string, unknown> {
  return {
    type,
    commandId,
    roomId: ROOM_ID,
    expectedGeneration: state.meta.generation,
    expectedRevision: state.meta.revision,
  };
}

function createRoomWithPlayers(playerIds: readonly string[]): MazeAuthorityState {
  assert.ok(playerIds.length >= 1 && playerIds.length <= 4);
  assert.equal(playerIds[0], OWNER);
  let state = reduceMazeAuthorityCommand(null, OWNER, {
    ...createCommand(`create-${playerIds.length}-player-room`),
    maxPlayers: Math.max(2, playerIds.length),
  }, 10_000).state;
  playerIds.slice(1).forEach((uid, index) => {
    state = reduceMazeAuthorityCommand(state, uid, {
      type: 'joinRoom',
      commandId: `join-player-${index + 2}-command`,
      roomId: ROOM_ID,
      expectedGeneration: state.meta.generation,
      expectedRevision: state.meta.revision,
    }, 10_100 + index).state;
  });
  return state;
}

function readyRoomWithPlayers(playerIds: readonly string[]): MazeAuthorityState {
  let state = createRoomWithPlayers(playerIds);
  playerIds.forEach((uid, index) => {
    state = submitMap(
      state,
      uid,
      simpleMap(
        { row: index, col: 0 },
        { row: index, col: 1 },
      ),
      `submit-player-${index + 1}-map`,
      10_200 + index,
    );
  });
  return state;
}

function orderedKeysBySlot(state: MazeAuthorityState): string[] {
  return Object.values(state.lobby.members)
    .slice()
    .sort((left, right) => left.slot - right.slot)
    .map((member) => member.uid);
}

function expectDomainError(
  operation: () => unknown,
  code: MazeAuthorityDomainError['code'],
  reason: string,
): void {
  assert.throws(operation, (error: unknown) => {
    assert.ok(error instanceof MazeAuthorityDomainError);
    assert.equal(error.code, code);
    assert.equal(error.reason, reason);
    return true;
  });
}

test('strict tagged parsing rejects unknown command, action, map, and array fields', () => {
  const create = createCommand();
  assert.deepEqual(parseMazeAuthorityCommand(create), create);

  expectDomainError(
    () => parseMazeAuthorityCommand({ ...create, privileged: true }),
    'invalid-argument',
    'create-room-command',
  );
  expectDomainError(
    () => parseMazeAuthorityCommand({ ...create, type: 'deleteRoom' }),
    'invalid-argument',
    'command-type',
  );
  for (const type of [
    'resetMap', 'leaveRoom', 'restartMatch', 'closeRoom',
  ] as const) {
    const lifecycleCommand = {
      type,
      commandId: `strict-${type}-command`,
      roomId: ROOM_ID,
      expectedGeneration: 1,
      expectedRevision: 5,
    };
    assert.deepEqual(parseMazeAuthorityCommand(lifecycleCommand), lifecycleCommand);
    expectDomainError(
      () => parseMazeAuthorityCommand({ ...lifecycleCommand, force: true }),
      'invalid-argument',
      `${type}-command`,
    );
  }
  expectDomainError(
    () => parseMazeAuthorityCommand({
      type: 'forfeit',
      commandId: 'strict-forfeit-retired',
      roomId: ROOM_ID,
      expectedGeneration: 1,
      expectedRevision: 5,
    }),
    'failed-precondition',
    'forfeit-retired',
  );
  expectDomainError(
    () => parseMazeAuthorityCommand({ ...create, commandId: '__proto__' }),
    'invalid-argument',
    'command-cas',
  );

  const submit = {
    type: 'submitMap',
    commandId: 'command-map-strict-01',
    roomId: ROOM_ID,
    expectedGeneration: 1,
    expectedRevision: 1,
    map: simpleMap(),
  };
  assert.deepEqual(parseMazeAuthorityCommand(submit), submit);
  expectDomainError(
    () => parseMazeAuthorityCommand({
      ...submit,
      map: { ...submit.map, serverApproved: true },
    }),
    'invalid-argument',
    'map-shape',
  );
  expectDomainError(
    () => parseMazeAuthorityCommand({
      ...submit,
      map: {
        ...submit.map,
        startPosition: { row: 0, col: 0, hidden: true },
      },
    }),
    'invalid-argument',
    'map-start-invalid',
  );
  expectDomainError(
    () => parseMazeAuthorityCommand({
      ...submit,
      map: {
        ...submit.map,
        items: [],
        item: { type: 'radar' },
      },
    }),
    'invalid-argument',
    'map-mixed-item-formats',
  );

  const sparseObstacles: unknown[] = [];
  sparseObstacles[1] = { position: { row: 0, col: 0 }, direction: 'right' };
  expectDomainError(
    () => parseMazeAuthorityCommand({
      ...submit,
      map: { ...submit.map, obstacles: sparseObstacles },
    }),
    'invalid-argument',
    'map-obstacles',
  );
  expectDomainError(
    () => parseMazeAuthorityCommand({
      type: 'turn',
      commandId: 'command-turn-strict-1',
      roomId: ROOM_ID,
      expectedGeneration: 1,
      expectedRevision: 5,
      action: { type: 'move', direction: 'right', distance: 2 },
    }),
    'invalid-argument',
    'move-action-keys',
  );
  expectDomainError(
    () => parseMazeAuthorityCommand({
      type: 'turn',
      commandId: 'command-skill-strict',
      roomId: ROOM_ID,
      expectedGeneration: 1,
      expectedRevision: 5,
      action: { type: 'skill', skillId: 'dash' },
    }),
    'failed-precondition',
    'skill-retired',
  );
  expectDomainError(
    () => parseMazeAuthorityCommand({
      type: 'turn',
      commandId: 'command-radar-retired',
      roomId: ROOM_ID,
      expectedGeneration: 1,
      expectedRevision: 5,
      action: { type: 'radar', itemIndex: 0 },
    }),
    'failed-precondition',
    'radar-retired',
  );
});

test('create, join, and submitMap apply exact generation/revision CAS without mutating failures', () => {
  const created = reduceMazeAuthorityCommand(null, OWNER, createCommand(), 1_000);
  assert.equal(created.replayed, false);
  assert.equal(created.state.meta.generation, 1);
  assert.equal(created.state.meta.revision, 1);
  assert.equal(created.state.gameState.phase, GamePhase.SETUP);
  assert.deepEqual(created.state.gameState.turnOrder, [OWNER]);

  const beforeFailure = cloneJson(created.state);
  expectDomainError(
    () => reduceMazeAuthorityCommand(created.state, GUEST, {
      type: 'joinRoom',
      commandId: 'command-join-bad-gen',
      roomId: ROOM_ID,
      expectedGeneration: 2,
      expectedRevision: 1,
    }, 1_100),
    'failed-precondition',
    'generation-mismatch',
  );
  assert.deepEqual(created.state, beforeFailure);
  expectDomainError(
    () => reduceMazeAuthorityCommand(created.state, GUEST, {
      type: 'joinRoom',
      commandId: 'command-join-bad-rev',
      roomId: ROOM_ID,
      expectedGeneration: 1,
      expectedRevision: 0,
    }, 1_100),
    'aborted',
    'revision-mismatch',
  );

  const joined = joinRoom(created.state);
  assert.equal(joined.meta.revision, 2);
  assert.equal(joined.lobby.members[GUEST].slot, 1);
  assert.deepEqual(joined.gameState.turnOrder, [OWNER, GUEST]);

  expectDomainError(
    () => reduceMazeAuthorityCommand(joined, OWNER, {
      type: 'submitMap',
      commandId: 'command-time-regression',
      roomId: ROOM_ID,
      expectedGeneration: joined.meta.generation,
      expectedRevision: joined.meta.revision,
      map: simpleMap(),
    }, 1_050),
    'failed-precondition',
    'server-time-regression',
  );

  expectDomainError(
    () => reduceMazeAuthorityCommand(joined, OWNER, {
      type: 'submitMap',
      commandId: 'command-retired-collapse',
      roomId: ROOM_ID,
      expectedGeneration: joined.meta.generation,
      expectedRevision: joined.meta.revision,
      map: {
        ...simpleMap(),
        items: [{
          type: 'collapseWall',
          wallPosition: { row: 2, col: 2 },
          wallDirection: 'right',
        }],
      },
    }, 1_200),
    'failed-precondition',
    'retired-wall-item',
  );

  expectDomainError(
    () => reduceMazeAuthorityCommand(joined, OWNER, {
      type: 'submitMap',
      commandId: 'command-retired-mirror',
      roomId: ROOM_ID,
      expectedGeneration: joined.meta.generation,
      expectedRevision: joined.meta.revision,
      map: {
        ...simpleMap(),
        items: [{
          type: 'mirrorWall',
          wallPosition: { row: 2, col: 2 },
          wallDirection: 'right',
        }],
      },
    }, 1_200),
    'failed-precondition',
    'retired-wall-item',
  );

  expectDomainError(
    () => reduceMazeAuthorityCommand(joined, OWNER, {
      type: 'submitMap',
      commandId: 'command-retired-radar',
      roomId: ROOM_ID,
      expectedGeneration: joined.meta.generation,
      expectedRevision: joined.meta.revision,
      map: {
        ...simpleMap(),
        items: [{ type: 'radar' }],
      },
    }, 1_200),
    'failed-precondition',
    'retired-wall-item',
  );

  for (const skillLoadout of ['breach', 'anchor', 'dash'] as const) {
    expectDomainError(
      () => reduceMazeAuthorityCommand(joined, OWNER, {
        type: 'submitMap',
        commandId: `command-retired-skill-${skillLoadout}`,
        roomId: ROOM_ID,
        expectedGeneration: joined.meta.generation,
        expectedRevision: joined.meta.revision,
        map: simpleMap(undefined, undefined, skillLoadout),
      }, 1_200),
      'failed-precondition',
      'skill-loadout-retired',
    );
  }

  const submitted = submitMap(joined, OWNER, simpleMap(), 'command-map-owner-02', 1_200);
  assert.equal(submitted.meta.revision, 3);
  assert.equal(submitted.gameState.players[OWNER].isReady, true);
  assert.deepEqual(submitted.gameState.maps?.[OWNER], simpleMap());

  expectDomainError(
    () => reduceMazeAuthorityCommand(submitted, THIRD, {
      type: 'joinRoom',
      commandId: 'command-join-third-01',
      roomId: ROOM_ID,
      expectedGeneration: submitted.meta.generation,
      expectedRevision: submitted.meta.revision,
    }, 1_300),
    'resource-exhausted',
    'room-full',
  );
});

test('idempotency receipts bind command ids to the exact actor and canonical payload', () => {
  const command = createCommand('command-idempotent-01');
  const first = reduceMazeAuthorityCommand(null, OWNER, command, 2_000);
  const replay = reduceMazeAuthorityCommand(first.state, OWNER, command, 9_999);
  assert.equal(replay.replayed, true);
  assert.strictEqual(replay.state, first.state);
  assert.deepEqual(replay.result, first.result);

  expectDomainError(
    () => reduceMazeAuthorityCommand(first.state, GUEST, command, 2_100),
    'already-exists',
    'idempotency-conflict',
  );
  expectDomainError(
    () => reduceMazeAuthorityCommand(first.state, OWNER, {
      ...command,
      name: 'Different payload',
    }, 2_100),
    'already-exists',
    'idempotency-conflict',
  );
});

test('one-time wall Authority outcomes and receipts are indistinguishable from static wall bumps', () => {
  const wallPosition = { row: 2, col: 2 };
  const wallDirection = 'right' as const;
  const playedMapBase = simpleMap(wallPosition, { row: 2, col: 4 });
  const staticWallState = startMatch(readyTwoPlayerRoom(
    simpleMap(),
    {
      ...playedMapBase,
      obstacles: [{ position: wallPosition, direction: wallDirection }],
    },
  ));
  const oneTimeWallState = startMatch(readyTwoPlayerRoom(
    simpleMap(),
    {
      ...playedMapBase,
      items: [{
        type: 'oneTimeWall',
        wallPosition,
        wallDirection,
      }],
    },
  ));
  assert.equal(staticWallState.gameState.currentTurn, OWNER);
  assert.equal(oneTimeWallState.gameState.currentTurn, OWNER);
  assert.equal(oneTimeWallState.gameState.assignments?.[OWNER], GUEST);

  const staticCommand = {
    type: 'turn',
    commandId: 'command-static-wall-bump',
    roomId: ROOM_ID,
    expectedGeneration: staticWallState.meta.generation,
    expectedRevision: staticWallState.meta.revision,
    action: { type: 'move', direction: wallDirection },
  } as const;
  const oneTimeCommand = {
    ...staticCommand,
    commandId: 'command-one-time-wall-bump',
    expectedGeneration: oneTimeWallState.meta.generation,
    expectedRevision: oneTimeWallState.meta.revision,
  } as const;
  const staticTurn = reduceMazeAuthorityCommand(
    staticWallState,
    OWNER,
    staticCommand,
    2_000,
  );
  const oneTimeTurn = reduceMazeAuthorityCommand(
    oneTimeWallState,
    OWNER,
    oneTimeCommand,
    2_000,
  );
  assert.equal(staticTurn.result.type, 'turn');
  assert.equal(oneTimeTurn.result.type, 'turn');
  assert.deepEqual(oneTimeTurn.result.outcome, staticTurn.result.outcome);
  assert.deepEqual(
    Object.keys(oneTimeTurn.result.outcome).sort(),
    Object.keys(staticTurn.result.outcome).sort(),
  );
  assert.equal(oneTimeTurn.result.outcome.type, 'move');
  assert.equal(oneTimeTurn.result.outcome.effect, 'bump');
  assert.equal(oneTimeTurn.result.outcome.consumedItemIndex, null);
  assert.equal(oneTimeTurn.result.outcome.message, '플레이어가 벽에 부딪혔습니다.');
  assert.equal(
    oneTimeTurn.state.gameState.turnMessage,
    staticTurn.state.gameState.turnMessage,
  );
  for (const leakedField of ['wallEffect', 'wallItemIndex', 'itemPosition']) {
    assert.equal(
      Object.prototype.hasOwnProperty.call(oneTimeTurn.result.outcome, leakedField),
      false,
      `Authority outcome leaked ${leakedField}`,
    );
  }

  const consumed = oneTimeTurn.state.gameState.itemState?.[GUEST]?.consumed;
  assert.ok(consumed && typeof consumed === 'object');
  assert.equal((consumed as Record<number, boolean>)[0], true);
  const storedReceipt = oneTimeTurn.state.receipts.byId[oneTimeCommand.commandId];
  assert.deepEqual(storedReceipt.result, oneTimeTurn.result);
  assert.equal(
    JSON.stringify(storedReceipt.result).includes('wallItemIndex'),
    false,
  );

  const persistedState = simulateRealtimeDatabase(oneTimeTurn.state);
  assert.ok(persistedState);
  const replay = reduceMazeAuthorityCommand(
    persistedState as MazeAuthorityState,
    OWNER,
    oneTimeCommand,
    9_999,
  );
  assert.equal(replay.replayed, true);
  assert.deepEqual(replay.result, oneTimeTurn.result);
  assert.deepEqual(
    (replay.result as TurnResult).outcome,
    staticTurn.result.outcome,
  );
});

test('Realtime Database sparse values rehydrate to canonical maps and exactly replay nullable outcomes', () => {
  const created = reduceMazeAuthorityCommand(null, OWNER, createCommand('command-rtdb-create'), 2_500);
  const persistedCreate = simulateRealtimeDatabase(created.state);
  assert.ok(persistedCreate);
  const rehydratedCreate = parseMazeAuthorityState(persistedCreate);
  assert.deepEqual(rehydratedCreate, created.state);

  const ready = readyTwoPlayerRoom(
    simpleMap({ row: 0, col: 0 }, { row: 0, col: 1 }, 'scoutPulse'),
    simpleMap({ row: 5, col: 5 }, { row: 5, col: 4 }),
  );
  const persistedReady = simulateRealtimeDatabase(ready);
  assert.ok(persistedReady);
  const started = startMatch(parseMazeAuthorityState(persistedReady));
  const persistedStarted = simulateRealtimeDatabase(started);
  assert.ok(persistedStarted);

  const command = {
    type: 'turn',
    commandId: 'command-rtdb-turn-01',
    roomId: ROOM_ID,
    expectedGeneration: started.meta.generation,
    expectedRevision: started.meta.revision,
    action: { type: 'move', direction: 'left' },
  } as const;
  const first = reduceMazeAuthorityCommand(
    parseMazeAuthorityState(persistedStarted),
    OWNER,
    command,
    2_600,
  );
  assert.equal(first.result.type, 'turn');
  assert.equal(first.result.currentTurn, GUEST);
  assert.equal(first.result.winner, null);
  assert.equal(first.result.draw, null);
  assert.equal(first.result.outcome.type, 'move');
  assert.equal(first.result.outcome.consumedItemIndex, null);

  const persistedTurn = simulateRealtimeDatabase(first.state);
  assert.ok(persistedTurn);
  const replay = reduceMazeAuthorityCommand(
    persistedTurn as MazeAuthorityState,
    OWNER,
    command,
    9_999,
  );
  assert.equal(replay.replayed, true);
  assert.deepEqual(replay.result, first.result);
});

test('receipt ledger stays bounded and a retained command remains replayable only by its actor/payload', () => {
  let state = reduceMazeAuthorityCommand(
    null,
    OWNER,
    createCommand('command-bounded-create'),
    3_000,
  ).state;
  const map = simpleMap();
  let lastCommand: Record<string, unknown> | null = null;

  for (let index = 0; index < 70; index += 1) {
    const command = {
      type: 'submitMap',
      commandId: `bounded-submit-${String(index).padStart(3, '0')}`,
      roomId: ROOM_ID,
      expectedGeneration: state.meta.generation,
      expectedRevision: state.meta.revision,
      map,
    };
    state = reduceMazeAuthorityCommand(state, OWNER, command, 3_100 + index).state;
    lastCommand = command;
  }

  assert.equal(state.receipts.order.length, MAZE_AUTHORITY_MAX_RECEIPTS);
  assert.equal(Object.keys(state.receipts.byId).length, MAZE_AUTHORITY_MAX_RECEIPTS);
  assert.equal(state.receipts.byId['command-bounded-create'], undefined);
  assert.equal(state.receipts.byId['bounded-submit-005'], undefined);
  assert.ok(state.receipts.byId['bounded-submit-006']);
  assert.equal(state.receipts.order.at(-1), 'bounded-submit-069');
  assert.ok(lastCommand);

  const replay = reduceMazeAuthorityCommand(state, OWNER, lastCommand, 99_000);
  assert.equal(replay.replayed, true);
  expectDomainError(
    () => reduceMazeAuthorityCommand(state, GUEST, lastCommand, 99_000),
    'already-exists',
    'idempotency-conflict',
  );
  expectDomainError(
    () => reduceMazeAuthorityCommand(state, OWNER, {
      ...lastCommand,
      map: simpleMap({ row: 0, col: 0 }, { row: 0, col: 2 }),
    }, 99_000),
    'already-exists',
    'idempotency-conflict',
  );
});

test('startMatch preserves the current V3 relay assignment and initialization contract', () => {
  const ownerMap = simpleMap({ row: 0, col: 0 }, { row: 0, col: 1 }, 'scoutPulse');
  const guestMap = simpleMap({ row: 5, col: 5 }, { row: 5, col: 4 });
  const setup = readyTwoPlayerRoom(ownerMap, guestMap);

  const legacySetups = [
    (() => {
      const legacy = cloneJson(setup);
      legacy.gameState.maps![GUEST].skillLoadout = 'dash';
      return legacy;
    })(),
    (() => {
      const legacy = cloneJson(setup);
      legacy.gameState.maps![GUEST].items = [{ type: 'radar' }];
      return legacy;
    })(),
  ];
  legacySetups.forEach((legacy, index) => {
    assert.deepEqual(
      parseMazeAuthorityState(legacy),
      legacy,
      'legacy map content remains readable for view/history compatibility',
    );
    expectDomainError(
      () => reduceMazeAuthorityCommand(legacy, OWNER, {
        type: 'startMatch',
        commandId: `command-start-retired-map-${index}`,
        roomId: ROOM_ID,
        expectedGeneration: legacy.meta.generation,
        expectedRevision: legacy.meta.revision,
      }, 1_400),
      'failed-precondition',
      'stored-map-retired',
    );
  });

  const reduction = reduceMazeAuthorityCommand(setup, OWNER, {
    type: 'startMatch',
    commandId: 'command-start-parity',
    roomId: ROOM_ID,
    expectedGeneration: setup.meta.generation,
    expectedRevision: setup.meta.revision,
  }, 1_400);
  const state = reduction.state;

  assert.equal(state.meta.revision, setup.meta.revision + 1);
  assert.equal(state.lobby.status, 'playing');
  assert.equal(state.gameState.phase, GamePhase.PLAY);
  assert.equal(state.gameState.matchNumber, 1);
  assert.deepEqual(state.gameState.assignments, { [OWNER]: GUEST, [GUEST]: OWNER });
  assert.deepEqual(state.gameState.players[OWNER].position, guestMap.startPosition);
  assert.deepEqual(state.gameState.players[GUEST].position, ownerMap.startPosition);
  assert.deepEqual(state.gameState.players[OWNER].positionHistory, [guestMap.startPosition]);
  assert.deepEqual(state.gameState.players[GUEST].positionHistory, [ownerMap.startPosition]);
  assert.equal(state.gameState.currentTurn, OWNER);
  assert.deepEqual(state.gameState.turnOrder, [OWNER, GUEST]);
  assert.equal(state.gameState.turnNumber, 1);
  assert.equal(state.gameState.itemState, undefined);
  assert.deepEqual(state.gameState.maps, { [OWNER]: ownerMap, [GUEST]: guestMap });
  assert.deepEqual(state.gameState.collisionWalls, {});
  assert.deepEqual(state.gameState.revealedWallsByPlayer, {});
  assert.deepEqual(state.gameState.visionEffectsByPlayer, {});
  assert.equal(state.gameState.turnMessageTimestamp, 1_400);

  const unchanged = cloneJson(state);
  for (const [action, reason] of [
    [{ type: 'radar', itemIndex: 0 }, 'radar-retired'],
    [{ type: 'skill', skillId: 'scoutPulse' }, 'skill-retired'],
    [{ type: 'skill', skillId: 'breach', direction: 'right' }, 'skill-retired'],
    [{ type: 'skill', skillId: 'anchor' }, 'skill-retired'],
    [{ type: 'skill', skillId: 'dash', direction: 'right' }, 'skill-retired'],
  ] as const) {
    expectDomainError(
      () => reduceMazeAuthorityCommand(state, OWNER, {
        type: 'turn',
        commandId: `retired-${action.type}-${String('skillId' in action ? action.skillId : 'detector')}`,
        roomId: ROOM_ID,
        expectedGeneration: state.meta.generation,
        expectedRevision: state.meta.revision,
        action,
      }, 1_450),
      'failed-precondition',
      reason,
    );
  }
  assert.deepEqual(state, unchanged, 'retired actions cannot mutate authority state');
});

function applyTurnWithParity(
  state: MazeAuthorityState,
  actorId: string,
  action: TurnAction,
  commandId: string,
  now: number,
): MazeAuthorityState {
  const expected = resolveTurnAction(cloneJson(state.gameState), actorId, action, now);
  assert.ok(expected, 'the canonical V3 engine must accept the parity action');
  const reduction = reduceMazeAuthorityCommand(state, actorId, {
    type: 'turn',
    commandId,
    roomId: ROOM_ID,
    expectedGeneration: state.meta.generation,
    expectedRevision: state.meta.revision,
    action,
  }, now);
  assert.deepEqual(reduction.state.gameState, cloneJson(expected.state));
  assert.deepEqual((reduction.result as TurnResult).outcome, cloneJson(expected.outcome));
  return reduction.state;
}

function finishStartedRoomWithRealMoves(
  state: MazeAuthorityState,
  playerIds: readonly string[],
  now: number,
): MazeAuthorityState {
  playerIds.forEach((uid, index) => {
    state = applyTurnWithParity(
      state,
      uid,
      { type: 'move', direction: 'right' },
      `real-finish-${index}-${uid}`,
      now + index,
    );
  });
  assert.equal(state.gameState.phase, GamePhase.END);
  return state;
}

test('turn delegates to the generated V3 engine and preserves winner/end settlement parity', () => {
  const finishMap = simpleMap({ row: 0, col: 0 }, { row: 0, col: 1 });
  let state = startMatch(readyTwoPlayerRoom(finishMap, finishMap));

  state = applyTurnWithParity(
    state,
    OWNER,
    { type: 'move', direction: 'right' },
    'command-turn-owner-goal',
    1_500,
  );
  assert.equal(state.gameState.players[OWNER].finished, true);
  assert.equal(state.gameState.players[OWNER].finishMoves, 1);
  assert.equal(state.gameState.currentTurn, GUEST);
  assert.equal(state.gameState.phase, GamePhase.PLAY);

  state = applyTurnWithParity(
    state,
    GUEST,
    { type: 'move', direction: 'down' },
    'command-turn-guest-detour-1',
    1_600,
  );
  assert.equal(state.gameState.players[GUEST].moves, 1);
  assert.equal(state.gameState.currentTurn, GUEST);

  state = applyTurnWithParity(
    state,
    GUEST,
    { type: 'move', direction: 'up' },
    'command-turn-guest-detour-2',
    1_700,
  );
  assert.equal(state.gameState.players[GUEST].moves, 2);
  assert.equal(state.gameState.currentTurn, GUEST);

  state = applyTurnWithParity(
    state,
    GUEST,
    { type: 'move', direction: 'right' },
    'command-turn-guest-goal',
    1_800,
  );
  assert.equal(state.gameState.phase, GamePhase.END);
  assert.equal(state.lobby.status, 'ended');
  assert.equal(state.gameState.currentTurn, null);
  assert.equal(state.gameState.winner, OWNER);
  assert.equal(state.gameState.draw, null);
  assert.equal(state.gameState.players[GUEST].finishMoves, 3);
});

test('Authority replaces a new poison effect seed with deterministic private-state entropy', () => {
  const poisonMap = (hiddenWallDirection: 'right' | 'down'): GameMap => ({
    rulesVersion: 3,
    startPosition: { row: 2, col: 2 },
    endPosition: { row: 5, col: 5 },
    obstacles: [{ position: { row: 4, col: 4 }, direction: hiddenWallDirection }],
    items: [{
      type: 'poisonWall',
      wallPosition: { row: 2, col: 2 },
      wallDirection: 'right',
    }],
    skillLoadout: 'scoutPulse',
  });
  const poisonTurn = (state: MazeAuthorityState) => ({
    type: 'turn' as const,
    commandId: 'authority-private-poison-turn',
    roomId: ROOM_ID,
    expectedGeneration: state.meta.generation,
    expectedRevision: state.meta.revision,
    action: { type: 'move' as const, direction: 'right' as const },
  });

  const initial = startMatch(readyTwoPlayerRoom(simpleMap(), poisonMap('right')));
  const command = poisonTurn(initial);
  const first = reduceMazeAuthorityCommand(initial, OWNER, command, 1_500);
  const retried = reduceMazeAuthorityCommand(initial, OWNER, command, 9_999);
  const firstEffect = first.state.gameState.poisonEffectsByPlayer?.[OWNER];
  const retriedEffect = retried.state.gameState.poisonEffectsByPlayer?.[OWNER];
  assert.ok(firstEffect);
  assert.ok(retriedEffect);
  assert.equal(firstEffect.seed, retriedEffect.seed);
  assert.ok(Number.isInteger(firstEffect.seed));
  assert.ok(firstEffect.seed >= 0 && firstEffect.seed <= 0xffff_ffff);

  const hiddenMapChanged = startMatch(readyTwoPlayerRoom(simpleMap(), poisonMap('down')));
  assert.equal(hiddenMapChanged.meta.generation, initial.meta.generation);
  assert.equal(hiddenMapChanged.meta.revision, initial.meta.revision);
  const changed = reduceMazeAuthorityCommand(
    hiddenMapChanged,
    OWNER,
    poisonTurn(hiddenMapChanged),
    1_500,
  );
  const changedEffect = changed.state.gameState.poisonEffectsByPlayer?.[OWNER];
  assert.ok(changedEffect);
  assert.notEqual(
    changedEffect.seed,
    firstEffect.seed,
    'a hidden full-map/receipt change must perturb the server-only poison seed',
  );

  const missingSeed = cloneJson(first.state);
  delete (missingSeed.gameState.poisonEffectsByPlayer?.[OWNER] as Partial<typeof firstEffect>).seed;
  expectDomainError(
    () => parseMazeAuthorityState(missingSeed),
    'data-loss',
    'authority-poison-effect',
  );
});

test('stored fire effects accept the new exact shape and the six-wall legacy shape', () => {
  const active = startMatch(readyTwoPlayerRoom());
  active.gameState.players[OWNER].moves = 4;
  active.gameState.visionEffectsByPlayer = {
    [OWNER]: {
      type: 'fire',
      sourcePlayerId: GUEST,
      appliedAtTurn: 1,
      expiresAtTargetMove: 4,
    },
  };

  const parsedActive = parseMazeAuthorityState(active);
  const exactEffect = parsedActive.gameState.visionEffectsByPlayer?.[OWNER];
  assert.deepEqual(exactEffect, {
    type: 'fire',
    sourcePlayerId: GUEST,
    appliedAtTurn: 1,
    expiresAtTargetMove: 4,
  });
  assert.equal(
    Object.prototype.hasOwnProperty.call(exactEffect ?? {}, 'phantomWalls'),
    false,
    'the canonical fire shape must not be materialized with an empty phantom list',
  );

  const legacyPhantomWalls = [
    { position: { row: 0, col: 0 }, direction: 'right' as const },
    { position: { row: 0, col: 1 }, direction: 'right' as const },
    { position: { row: 0, col: 2 }, direction: 'right' as const },
    { position: { row: 0, col: 3 }, direction: 'right' as const },
    { position: { row: 0, col: 4 }, direction: 'right' as const },
    { position: { row: 1, col: 0 }, direction: 'right' as const },
  ];
  const legacy = cloneJson(active);
  const legacyEffect = {
    type: 'fire' as const,
    sourcePlayerId: GUEST,
    appliedAtTurn: 1,
    expiresAtTargetMove: 4,
    phantomWalls: legacyPhantomWalls,
  };
  legacy.gameState.visionEffectsByPlayer = {
    [OWNER]: legacyEffect,
  };
  assert.deepEqual(
    parseMazeAuthorityState(legacy).gameState.visionEffectsByPlayer?.[OWNER],
    legacy.gameState.visionEffectsByPlayer[OWNER],
  );

  const malformedLegacy = cloneJson(legacy);
  malformedLegacy.gameState.visionEffectsByPlayer![OWNER] = {
    ...legacyEffect,
    phantomWalls: legacyPhantomWalls.slice(0, 5),
  };
  expectDomainError(
    () => parseMazeAuthorityState(malformedLegacy),
    'data-loss',
    'authority-vision-effect',
  );

  const tooOld = cloneJson(active);
  tooOld.gameState.players[OWNER].moves = 5;
  expectDomainError(
    () => parseMazeAuthorityState(tooOld),
    'data-loss',
    'authority-private-effect-reference',
  );
});

test('V2 wormhole parsing keeps a strict run union while map validity stays canonical', () => {
  const challenge = {
    version: 2 as const,
    boardSize: 4 as const,
    startPosition: { row: 0, col: 0 },
    endPosition: { row: 3, col: 3 },
    blockedCells: [{ row: 1, col: 1 }, { row: 2, col: 2 }],
    initialOrientation: 0,
    targetTop: 2 as const,
  };
  const state = startMatch(readyTwoPlayerRoom());
  const entrance = { row: 5, col: 5 };
  state.gameState.maps![GUEST] = {
    rulesVersion: 3,
    startPosition: entrance,
    endPosition: { row: 5, col: 4 },
    obstacles: [],
    items: [{
      type: 'wormhole',
      entrance,
      exit: { row: 4, col: 4 },
      challenge,
    }],
    skillLoadout: 'scoutPulse',
  };
  state.gameState.players[OWNER].position = entrance;
  state.gameState.players[OWNER].positionHistory = [entrance];
  state.gameState.itemState = { [GUEST]: { consumed: { 0: true } } };
  state.gameState.wormholeRunsByPlayer = {
    [OWNER]: {
      mapOwnerId: GUEST,
      itemIndex: 0,
      position: challenge.startPosition,
      challenge,
      orientation: challenge.initialOrientation,
      actionsTaken: 0,
      enteredAtTurn: 1,
    },
  };

  assert.deepEqual(
    parseMazeAuthorityState(state).gameState.wormholeRunsByPlayer?.[OWNER],
    state.gameState.wormholeRunsByPlayer![OWNER],
  );

  const missingProgress = cloneJson(state);
  delete (missingProgress.gameState.wormholeRunsByPlayer?.[OWNER] as unknown as Record<string, unknown>)
    .actionsTaken;
  expectDomainError(
    () => parseMazeAuthorityState(missingProgress),
    'data-loss',
    'authority-wormhole-run',
  );

  const mixedVersionFields = cloneJson(state);
  (mixedVersionFields.gameState.wormholeRunsByPlayer?.[OWNER] as unknown as Record<string, unknown>)
    .discoveredWalls = [];
  expectDomainError(
    () => parseMazeAuthorityState(mixedVersionFields),
    'data-loss',
    'authority-wormhole-run',
  );

  const setup = createRoom();
  const semanticallyInvalidChallenge = {
    ...challenge,
    endPosition: challenge.startPosition,
    blockedCells: [],
  };
  const command = {
    type: 'submitMap' as const,
    commandId: 'command-v2-canonical-map',
    roomId: ROOM_ID,
    expectedGeneration: setup.meta.generation,
    expectedRevision: setup.meta.revision,
    map: {
      ...simpleMap(),
      items: [{
        type: 'wormhole' as const,
        entrance: { row: 1, col: 1 },
        exit: { row: 4, col: 4 },
        challenge: semanticallyInvalidChallenge,
      }],
    },
  };
  assert.deepEqual(parseMazeAuthorityCommand(command), command);
  expectDomainError(
    () => reduceMazeAuthorityCommand(setup, OWNER, command, 1_500),
    'failed-precondition',
    'invalid-v3-map',
  );
});

test('forfeit is retired while a server-owned offline skip preserves every runner and result field', () => {
  const state = startMatch(readyTwoPlayerRoom());
  const originalPlayers = cloneJson(state.gameState.players);
  const originalPositions = Object.fromEntries(Object.entries(originalPlayers).map(
    ([uid, player]) => [uid, cloneJson(player.position)],
  ));
  expectDomainError(
    () => reduceMazeAuthorityCommand(state, OWNER, {
      type: 'forfeit',
      commandId: 'command-forfeit-retired',
      roomId: ROOM_ID,
      expectedGeneration: state.meta.generation,
      expectedRevision: state.meta.revision,
    }, 2_000),
    'failed-precondition',
    'forfeit-retired',
  );

  const command = {
    type: 'skipOfflineTurn',
    commandId: 'command-offline-skip-owner',
    roomId: ROOM_ID,
    expectedGeneration: state.meta.generation,
    expectedRevision: state.meta.revision,
    turnNumber: 1,
    leaseEpoch: 2,
  } as const;
  const skipped = reduceMazeAuthorityOfflineTurn(state, OWNER, command, 2_000);
  assert.deepEqual(skipped.result, {
    type: 'skipOfflineTurn',
    roomId: ROOM_ID,
    generation: 1,
    revision: state.meta.revision + 1,
    phase: GamePhase.PLAY,
    skippedPlayerId: OWNER,
    currentTurn: GUEST,
    turnNumber: 2,
  });
  assert.equal(skipped.state.gameState.phase, GamePhase.PLAY);
  assert.equal(skipped.state.lobby.status, 'playing');
  assert.equal(skipped.state.gameState.winner, null);
  assert.equal(skipped.state.gameState.draw, null);
  assert.deepEqual(skipped.state.gameState.players, originalPlayers);
  assert.deepEqual(
    Object.fromEntries(Object.entries(skipped.state.gameState.players).map(
      ([uid, player]) => [uid, cloneJson(player.position)],
    )),
    originalPositions,
  );
  assert.equal(skipped.state.receipts.byId[command.commandId].commandType, 'skipOfflineTurn');

  const replay = reduceMazeAuthorityOfflineTurn(skipped.state, OWNER, command, 9_999);
  assert.equal(replay.replayed, true);
  assert.strictEqual(replay.state, skipped.state);
  assert.deepEqual(replay.result, skipped.result);
});

test('resetMap has no setup timer, is SETUP-only, obeys CAS, and replays after RTDB elision', () => {
  let state = joinRoom(createRoom(20_000), 20_100);
  expectDomainError(
    () => reduceMazeAuthorityCommand(
      state,
      OWNER,
      commandFor(state, 'resetMap', 'reset-map-before-submit'),
      20_200,
    ),
    'failed-precondition',
    'map-not-submitted',
  );

  state = submitMap(state, OWNER, simpleMap(), 'reset-map-submit-first', 20_200);
  const resetCommand = commandFor(state, 'resetMap', 'reset-map-command-001');
  const beforeCasFailure = cloneJson(state);
  expectDomainError(
    () => reduceMazeAuthorityCommand(state, OWNER, {
      ...resetCommand,
      expectedRevision: state.meta.revision - 1,
    }, 20_300),
    'aborted',
    'revision-mismatch',
  );
  assert.deepEqual(state, beforeCasFailure);

  const reset = reduceMazeAuthorityCommand(
    state,
    OWNER,
    resetCommand,
    320_300,
  );
  assert.deepEqual(reset.result, {
    type: 'resetMap',
    roomId: ROOM_ID,
    generation: state.meta.generation,
    revision: state.meta.revision + 1,
    ready: false,
  });
  assert.equal(reset.state.gameState.players[OWNER].isReady, false);
  assert.equal(reset.state.gameState.maps?.[OWNER], undefined);
  assert.ok(reset.state.gameState.players[GUEST]);
  assert.equal(
    reset.state.meta.updatedAt,
    320_300,
    'map reset remains available after more than five minutes in setup',
  );

  const persisted = simulateRealtimeDatabase(reset.state);
  assert.ok(persisted);
  assert.deepEqual(parseMazeAuthorityState(persisted), reset.state);
  const replay = reduceMazeAuthorityCommand(
    persisted as MazeAuthorityState,
    OWNER,
    resetCommand,
    99_999,
  );
  assert.equal(replay.replayed, true);
  assert.deepEqual(replay.result, reset.result);

  const playing = startMatch(readyTwoPlayerRoom(), 20_400);
  expectDomainError(
    () => reduceMazeAuthorityCommand(
      playing,
      OWNER,
      commandFor(playing, 'resetMap', 'reset-map-during-play'),
      20_500,
    ),
    'failed-precondition',
    'not-setup',
  );
});

test('SETUP leave returns slots, transfers ownership by lowest slot, and last leave closes safely', () => {
  let state = createRoomWithPlayers([OWNER, GUEST, THIRD, FOURTH]);
  state = submitMap(state, OWNER, simpleMap(), 'setup-leave-owner-map', 20_600);

  const ownerLeaveCommand = commandFor(state, 'leaveRoom', 'setup-owner-leave-001');
  let leave = reduceMazeAuthorityCommand(state, OWNER, ownerLeaveCommand, 20_700);
  state = leave.state;
  assert.equal(leave.result.type, 'leaveRoom');
  assert.equal(leave.result.closed, false);
  assert.equal(leave.result.ownerId, GUEST);
  assert.equal(leave.result.remainingMembers, 3);
  assert.equal(state.lobby.ownerId, GUEST);
  assert.equal(state.lobby.members[OWNER], undefined);
  assert.equal(state.gameState.players[OWNER], undefined);
  assert.equal(state.gameState.maps?.[OWNER], undefined);
  assert.deepEqual(state.gameState.turnOrder, [GUEST, THIRD, FOURTH]);
  assert.equal(state.gameState.currentTurn, GUEST);

  leave = reduceMazeAuthorityCommand(
    state,
    THIRD,
    commandFor(state, 'leaveRoom', 'setup-third-leave-001'),
    20_800,
  );
  state = leave.state;
  state = reduceMazeAuthorityCommand(state, REPLACEMENT, {
    type: 'joinRoom',
    commandId: 'setup-replacement-join',
    roomId: ROOM_ID,
    expectedGeneration: state.meta.generation,
    expectedRevision: state.meta.revision,
  }, 20_900).state;
  assert.equal(state.lobby.members[REPLACEMENT].slot, 0);
  assert.equal(state.lobby.ownerId, GUEST, 'joining a lower slot does not steal ownership');

  state = reduceMazeAuthorityCommand(
    state,
    GUEST,
    commandFor(state, 'leaveRoom', 'setup-guest-leave-001'),
    21_000,
  ).state;
  assert.equal(state.lobby.ownerId, REPLACEMENT);
  assert.equal(state.gameState.currentTurn, REPLACEMENT);
  state = reduceMazeAuthorityCommand(
    state,
    FOURTH,
    commandFor(state, 'leaveRoom', 'setup-fourth-leave-01'),
    21_100,
  ).state;

  const lastLeaveCommand = commandFor(state, 'leaveRoom', 'setup-last-leave-0001');
  const closed = reduceMazeAuthorityCommand(state, REPLACEMENT, lastLeaveCommand, 21_200);
  assert.equal(closed.result.type, 'leaveRoom');
  assert.equal(closed.result.closed, true);
  assert.equal(closed.result.remainingMembers, 0);
  assert.equal(closed.state.meta.generation, state.meta.generation);
  assert.equal(closed.state.meta.revision, state.meta.revision + 1);
  assert.equal(closed.state.lobby.status, 'closed');
  assert.equal(closed.state.lobby.ownerId, REPLACEMENT);
  assert.deepEqual(closed.state.lobby.members, {});
  assert.deepEqual(closed.state.gameState, {
    rulesVersion: 3,
    matchNumber: 0,
    phase: GamePhase.SETUP,
    currentTurn: null,
    turnOrder: [],
    players: {},
    maps: {},
    winner: null,
    draw: null,
  });

  const persisted = simulateRealtimeDatabase(closed.state);
  assert.ok(persisted);
  assert.deepEqual(parseMazeAuthorityState(persisted), closed.state);
  const replay = reduceMazeAuthorityCommand(
    persisted as MazeAuthorityState,
    REPLACEMENT,
    lastLeaveCommand,
    90_000,
  );
  assert.equal(replay.replayed, true);
  assert.deepEqual(replay.result, closed.result);
  expectDomainError(
    () => reduceMazeAuthorityCommand(closed.state, OWNER, {
      type: 'joinRoom',
      commandId: 'closed-room-join-command',
      roomId: ROOM_ID,
      expectedGeneration: closed.state.meta.generation,
      expectedRevision: closed.state.meta.revision,
    }, 21_300),
    'failed-precondition',
    'room-closed',
  );
});

test('PLAY leave is presence-only and cannot mutate a 2-4 player Authority match', () => {
  for (const playerIds of [
    [OWNER, GUEST],
    [OWNER, GUEST, THIRD],
    [OWNER, GUEST, THIRD, FOURTH],
  ] as const) {
    const state = startMatch(readyRoomWithPlayers(playerIds), 21_500);
    const before = cloneJson(state);
    expectDomainError(
      () => reduceMazeAuthorityCommand(
        state,
        OWNER,
        commandFor(state, 'leaveRoom', `play-owner-leave-${playerIds.length}`),
        21_600,
      ),
      'failed-precondition',
      'active-match-leave-disabled',
    );
    assert.deepEqual(state, before);
    assert.equal(state.lobby.members[OWNER].uid, OWNER);
    assert.notEqual(state.gameState.players[OWNER].forfeited, true);
    assert.notEqual(state.gameState.players[OWNER].hasLeft, true);
    assert.equal(state.gameState.currentTurn, OWNER);
  }
});

test('even a finished runner stays in membership until the real match reaches END', () => {
  const finishMap = simpleMap({ row: 0, col: 0 }, { row: 0, col: 1 });
  let state = startMatch(readyTwoPlayerRoom(finishMap, finishMap), 22_000);
  state = applyTurnWithParity(
    state,
    OWNER,
    { type: 'move', direction: 'right' },
    'finish-before-leave-turn',
    22_100,
  );
  const before = cloneJson(state);
  expectDomainError(
    () => reduceMazeAuthorityCommand(
      state,
      OWNER,
      commandFor(state, 'leaveRoom', 'finished-player-leave'),
      22_200,
    ),
    'failed-precondition',
    'active-match-leave-disabled',
  );
  assert.deepEqual(state, before);
  assert.equal(state.gameState.phase, GamePhase.PLAY);
  assert.equal(state.gameState.players[OWNER].finished, true);
  assert.notEqual(state.gameState.players[OWNER].forfeited, true);
  assert.notEqual(state.gameState.players[OWNER].hasLeft, true);
  assert.equal(state.lobby.members[OWNER].uid, OWNER);
});

test('END leave revokes only membership, retains settlement exactly, and permits historical-owner close', () => {
  let state = startMatch(readyRoomWithPlayers([OWNER, GUEST]), 22_500);
  state = finishStartedRoomWithRealMoves(state, [OWNER, GUEST], 22_600);
  const terminal = cloneJson(state.gameState);

  state = reduceMazeAuthorityCommand(
    state,
    OWNER,
    commandFor(state, 'leaveRoom', 'end-owner-leave-command'),
    22_800,
  ).state;
  assert.deepEqual(state.gameState, terminal);
  assert.equal(state.lobby.ownerId, GUEST);
  state = reduceMazeAuthorityCommand(
    state,
    GUEST,
    commandFor(state, 'leaveRoom', 'end-guest-leave-command'),
    22_900,
  ).state;
  assert.deepEqual(state.gameState, terminal);
  assert.deepEqual(state.lobby.members, {});
  assert.equal(state.lobby.ownerId, GUEST);
  assert.equal(state.lobby.status, 'ended');
  assert.deepEqual(parseMazeAuthorityState(simulateRealtimeDatabase(state)), state);

  const close = reduceMazeAuthorityCommand(
    state,
    GUEST,
    commandFor(state, 'closeRoom', 'historical-owner-close'),
    23_000,
  );
  assert.equal(close.state.lobby.status, 'closed');
  assert.equal(close.result.type, 'closeRoom');
  assert.equal(close.result.closed, true);
});

test('restartMatch fences a new generation, resets only active members, and replays exactly', () => {
  let state = startMatch(readyRoomWithPlayers([OWNER, GUEST, THIRD, FOURTH]), 23_500);
  state = finishStartedRoomWithRealMoves(
    state,
    [OWNER, GUEST, THIRD, FOURTH],
    23_600,
  );
  state = reduceMazeAuthorityCommand(
    state,
    OWNER,
    commandFor(state, 'leaveRoom', 'restart-owner-end-leave'),
    23_700,
  ).state;
  state = reduceMazeAuthorityCommand(
    state,
    GUEST,
    commandFor(state, 'leaveRoom', 'restart-guest-end-leave'),
    23_800,
  ).state;
  assert.equal(state.lobby.ownerId, THIRD);
  assert.deepEqual(orderedKeysBySlot(state), [THIRD, FOURTH]);

  const previousGeneration = state.meta.generation;
  const previousRevision = state.meta.revision;
  const restartCommand = commandFor(state, 'restartMatch', 'restart-match-command-01');
  const restarted = reduceMazeAuthorityCommand(state, THIRD, restartCommand, 23_900);
  assert.deepEqual(restarted.result, {
    type: 'restartMatch',
    roomId: ROOM_ID,
    generation: previousGeneration + 1,
    revision: 1,
    phase: GamePhase.SETUP,
    currentTurn: THIRD,
    matchNumber: 1,
  });
  assert.equal(restarted.state.meta.generation, previousGeneration + 1);
  assert.equal(restarted.state.meta.revision, 1);
  assert.deepEqual(restarted.state.receipts.order, ['restart-match-command-01']);
  assert.deepEqual(Object.keys(restarted.state.receipts.byId), ['restart-match-command-01']);
  assert.deepEqual(Object.keys(restarted.state.gameState.players), [THIRD, FOURTH]);
  assert.deepEqual(restarted.state.gameState.turnOrder, [THIRD, FOURTH]);
  assert.deepEqual(restarted.state.gameState.maps, {});
  assert.equal(restarted.state.gameState.assignments, undefined);
  assert.equal(restarted.state.gameState.collisionWalls, undefined);
  assert.equal(restarted.state.gameState.itemState, undefined);
  assert.equal(restarted.state.gameState.winner, null);
  assert.equal(restarted.state.gameState.draw, null);
  assert.equal(restarted.state.gameState.matchNumber, 1);
  for (const uid of [THIRD, FOURTH]) {
    const player = restarted.state.gameState.players[uid];
    assert.deepEqual(player.position, { row: 0, col: 0 });
    assert.equal(player.isReady, false);
    assert.equal(player.finished, false);
    assert.equal(player.forfeited, false);
    assert.equal(player.hasLeft, false);
    assert.equal(player.moves, 0);
    assert.equal(player.positionHistory, undefined);
    assert.equal(player.finishMoves, undefined);
  }

  expectDomainError(
    () => reduceMazeAuthorityCommand(restarted.state, THIRD, {
      type: 'resetMap',
      commandId: 'restart-stale-generation',
      roomId: ROOM_ID,
      expectedGeneration: previousGeneration,
      expectedRevision: previousRevision,
    }, 24_000),
    'failed-precondition',
    'generation-mismatch',
  );

  const persisted = simulateRealtimeDatabase(restarted.state);
  assert.ok(persisted);
  assert.deepEqual(parseMazeAuthorityState(persisted), restarted.state);
  const replay = reduceMazeAuthorityCommand(
    persisted as MazeAuthorityState,
    THIRD,
    restartCommand,
    99_999,
  );
  assert.equal(replay.replayed, true);
  assert.deepEqual(replay.result, restarted.result);

  state = submitMap(
    restarted.state,
    THIRD,
    simpleMap({ row: 2, col: 0 }, { row: 2, col: 1 }),
    'restart-third-new-map',
    24_100,
  );
  state = submitMap(
    state,
    FOURTH,
    simpleMap({ row: 3, col: 0 }, { row: 3, col: 1 }),
    'restart-fourth-new-map',
    24_200,
  );
  state = startMatch(state, 24_300, THIRD);
  assert.equal(state.gameState.matchNumber, 2);
  assert.equal(state.gameState.currentTurn, THIRD);
});

test('closeRoom is owner-only, rejects PLAY, strips secrets, and rejects every post-close mutation', () => {
  let setup = readyTwoPlayerRoom();
  expectDomainError(
    () => reduceMazeAuthorityCommand(
      setup,
      GUEST,
      commandFor(setup, 'closeRoom', 'close-by-non-owner'),
      25_000,
    ),
    'permission-denied',
    'owner-required',
  );
  const closeCommand = commandFor(setup, 'closeRoom', 'close-room-command-001');
  const closed = reduceMazeAuthorityCommand(setup, OWNER, closeCommand, 25_000);
  assert.equal(closed.state.lobby.status, 'closed');
  assert.deepEqual(closed.state.gameState.maps, {});
  assert.deepEqual(closed.state.gameState.players, {});
  assert.equal(JSON.stringify(closed.state).includes('skillLoadout'), false);
  const persisted = simulateRealtimeDatabase(closed.state);
  assert.ok(persisted);
  const replay = reduceMazeAuthorityCommand(
    persisted as MazeAuthorityState,
    OWNER,
    closeCommand,
    99_999,
  );
  assert.equal(replay.replayed, true);
  assert.deepEqual(replay.result, closed.result);

  expectDomainError(
    () => reduceMazeAuthorityCommand(closed.state, OWNER, {
      ...createCommand('create-over-closed-room'),
      name: 'Replacement room',
    }, 25_100),
    'failed-precondition',
    'room-closed',
  );

  setup = startMatch(readyTwoPlayerRoom(), 25_200);
  expectDomainError(
    () => reduceMazeAuthorityCommand(
      setup,
      OWNER,
      commandFor(setup, 'closeRoom', 'close-during-play-001'),
      25_300,
    ),
    'failed-precondition',
    'match-in-progress',
  );
});

test('state parsing enforces exact SETUP roster and immutable PLAY roster membership rules', () => {
  const setup = createRoom();
  const malformedSetup = cloneJson(setup);
  malformedSetup.gameState.players[GUEST] = {
    id: GUEST,
    position: { row: 0, col: 0 },
    isReady: false,
  };
  malformedSetup.gameState.turnOrder?.push(GUEST);
  expectDomainError(
    () => parseMazeAuthorityState(malformedSetup),
    'data-loss',
    'authority-setup-roster',
  );

  const playing = startMatch(readyTwoPlayerRoom(), 26_000);
  const malformedPlay = cloneJson(playing);
  delete malformedPlay.lobby.members[OWNER];
  malformedPlay.lobby.ownerId = GUEST;
  expectDomainError(
    () => parseMazeAuthorityState(malformedPlay),
    'data-loss',
    'authority-match-roster',
  );
});
