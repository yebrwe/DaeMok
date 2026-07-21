'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');
const ts = require('typescript');

const ROOT = path.join(__dirname, '..');
const ROOM_ID = 'room_client_01';
const OWNER = 'owner-client';
const GUEST = 'guest-client';
const COMMAND_ID = '123e4567-e89b-42d3-a456-426614174000';

function loadTypeScript(relativePath, aliases = {}) {
  const filename = path.join(ROOT, relativePath);
  const source = fs.readFileSync(filename, 'utf8');
  const output = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
    fileName: filename,
  }).outputText;
  const loaded = new Module(filename, module);
  loaded.filename = filename;
  loaded.paths = Module._nodeModulePaths(path.dirname(filename));
  loaded.require = (request) => (
    Object.prototype.hasOwnProperty.call(aliases, request)
      ? aliases[request]
      : require(request)
  );
  loaded._compile(output, filename);
  return loaded.exports;
}

function clone(value) {
  return structuredClone(value);
}

const gameTypes = loadTypeScript('src/types/game.ts');
const diceWormhole = loadTypeScript('src/lib/diceWormhole.ts');
const gameUtils = loadTypeScript('src/lib/gameUtils.ts', {
  '@/types/game': gameTypes,
  '@/lib/diceWormhole': diceWormhole,
});

const ITEM_COSTS = {
  oneTimeWall: 7,
  mine: 1,
  wormhole: 7,
  radar: 4,
  smoke: 1,
  steelWall: 1,
  fireWall: 1,
  poisonWall: 3,
  iceWall: 1,
  windWall: 1,
  collapseWall: 1,
  phaseWall: 1,
  mirrorWall: 5,
  thornWall: 1,
  crystalWall: 1,
};
const ITEM_LIMITS = Object.fromEntries(Object.keys(ITEM_COSTS).map((key) => [key, 1]));

function ruleSnapshot() {
  return {
    version: 3,
    wallBudget: 24,
    itemCosts: { ...ITEM_COSTS },
    itemLimits: { ...ITEM_LIMITS },
    maxSkillLoadout: 1,
    skillIds: ['scoutPulse', 'breach', 'anchor', 'dash'],
  };
}

function isValidRuleSnapshot(value) {
  try {
    return JSON.stringify(value) === JSON.stringify(ruleSnapshot());
  } catch {
    return false;
  }
}

function isValidMapForRuleSnapshot(map, snapshot) {
  return isValidRuleSnapshot(snapshot)
    && map?.rulesVersion === 3
    && ['scoutPulse', 'breach', 'anchor', 'dash'].includes(map?.skillLoadout)
    && Array.isArray(map?.obstacles)
    && (!Object.prototype.hasOwnProperty.call(map, 'items') || Array.isArray(map.items) || map.items === null)
    && map?.startPosition?.row >= 0
    && map?.endPosition?.row >= 0;
}

function isValidNewMapForRuleSnapshot(map, snapshot) {
  return isValidMapForRuleSnapshot(map, snapshot);
}

function validMap(overrides = {}) {
  return {
    rulesVersion: 3,
    startPosition: { row: 0, col: 0 },
    endPosition: { row: 5, col: 5 },
    obstacles: [],
    items: [],
    skillLoadout: 'scoutPulse',
    ...overrides,
  };
}

function diceWormholeItem(challenge = diceWormhole.generateDiceWormholeChallenge(0xDAE0C)) {
  return {
    type: 'wormhole',
    entrance: { row: 0, col: 1 },
    exit: { row: 4, col: 4 },
    challenge,
  };
}

function legacyWormholeChallenge() {
  return {
    version: 1,
    startPosition: { row: 0, col: 0 },
    endPosition: { row: 1, col: 0 },
    seals: [{ row: 0, col: 5 }, { row: 5, col: 5 }, { row: 5, col: 0 }],
    obstacles: [
      { position: { row: 0, col: 0 }, direction: 'right' },
      { position: { row: 2, col: 1 }, direction: 'right' },
      { position: { row: 3, col: 2 }, direction: 'right' },
      { position: { row: 4, col: 3 }, direction: 'right' },
    ],
  };
}

function baseView(audience, overrides = {}) {
  const member = audience === 'member';
  return {
    audience,
    ...(member ? { viewerUid: OWNER } : {}),
    viewVersion: 1,
    authoritySchemaVersion: 1,
    roomId: ROOM_ID,
    generation: 1,
    revision: 8,
    sourceCreatedAt: 10_000,
    sourceUpdatedAt: 10_800,
    lobby: {
      name: '작은 장난감 미로',
      ownerId: OWNER,
      maxPlayers: 2,
      status: 'playing',
      members: {
        [OWNER]: { uid: OWNER, slot: 0 },
        [GUEST]: { uid: GUEST, slot: 1 },
      },
    },
    ruleSnapshot: ruleSnapshot(),
    gameState: {
      rulesVersion: 3,
      matchNumber: 1,
      phase: 'play',
      players: {
        [OWNER]: {
          id: OWNER,
          isReady: true,
          position: { row: 0, col: 0 },
          moves: 0,
        },
        [GUEST]: {
          id: GUEST,
          isReady: true,
          position: { row: 5, col: 5 },
          moves: 1,
        },
      },
      maps: {
        [OWNER]: member
          ? {
            rulesVersion: 3,
            startPosition: { row: 0, col: 0 },
            endPosition: { row: 5, col: 5 },
            // Empty arrays are deliberately absent after RTDB persistence.
            skillLoadout: 'scoutPulse',
          }
          : {
            startPosition: { row: 0, col: 0 },
            endPosition: { row: 5, col: 5 },
          },
        [GUEST]: {
          startPosition: { row: 5, col: 5 },
          endPosition: { row: 0, col: 0 },
        },
      },
      assignments: {
        [OWNER]: GUEST,
        [GUEST]: OWNER,
      },
      currentTurn: OWNER,
      // A numeric-key RTDB object must canonicalize to a dense list.
      turnOrder: { 0: OWNER, 1: GUEST },
      turnNumber: 4,
      // null and empty branches are deliberately absent after RTDB persistence.
      ...(member ? {
        itemState: {
          [OWNER]: {
            consumed: [true],
            mazeSkill: {
              version: 1,
              loadout: { 0: 'scoutPulse' },
            },
          },
        },
      } : {}),
    },
    ...overrides,
  };
}

function turnResponse(command, overrides = {}) {
  return {
    ok: true,
    replayed: false,
    result: {
      type: 'turn',
      roomId: command.roomId,
      generation: command.expectedGeneration,
      revision: command.expectedRevision + 1,
      phase: 'play',
      currentTurn: GUEST,
      winner: null,
      draw: null,
      outcome: {
        type: 'move',
        direction: 'right',
        origin: { row: 0, col: 0 },
        attempted: { row: 0, col: 1 },
        position: { row: 0, col: 1 },
        moves: 1,
        effect: 'move',
        consumedItemIndex: null,
        reachedGoal: false,
        message: '이동했습니다.',
      },
    },
    ...overrides,
  };
}

function rankingEntry(uid, overrides = {}) {
  return {
    uid,
    displayName: uid === OWNER ? '토끼 대장' : '별빛 손님',
    wins: uid === OWNER ? 3 : 1,
    losses: uid === OWNER ? 1 : 2,
    draws: 1,
    played: uid === OWNER ? 5 : 4,
    rating: uid === OWNER ? 1_048 : 1_008,
    bestMoves: uid === OWNER ? 9 : 0,
    lastRoomId: ROOM_ID,
    lastMatchNumber: 3,
    updatedAt: 20_000,
    source: 'mazeRankings-compat-v1',
    mirrorVersion: 1,
    sourceSettlementCount: uid === OWNER ? 5 : 4,
    lastGeneration: 2,
    ...overrides,
  };
}

async function main() {
  const calls = [];
  let callableResponse = null;
  let callableError = null;
  const firebaseFunctions = { region: 'asia-southeast1' };
  const client = loadTypeScript('src/lib/mazeAuthorityClient.ts', {
    '@/lib/gameRules': {
      createCanonicalGameRuleSnapshot: ruleSnapshot,
      isValidGameRuleSnapshot: isValidRuleSnapshot,
      isValidMapForRuleSnapshot,
      isValidNewMapForRuleSnapshot,
    },
    '@/lib/firebase': {
      firebaseInitPromise: Promise.resolve({
        functions: firebaseFunctions,
        appCheckStatus: 'emulator',
      }),
    },
    '@/lib/gameUtils': gameUtils,
    '@/lib/diceWormhole': diceWormhole,
    'firebase/functions': {
      httpsCallable(functions, name) {
        assert.strictEqual(functions, firebaseFunctions);
        return async (payload) => {
          calls.push({ name, payload: clone(payload) });
          if (callableError) throw callableError;
          return { data: clone(callableResponse) };
        };
      },
    },
  });
  const presentation = loadTypeScript('src/lib/mazeAuthorityPresentation.ts', {
    '@/lib/mazeAuthorityClient': client,
    '@/types/game': gameTypes,
  });

  assert.equal(client.MAZE_AUTHORITY_FUNCTIONS_REGION, 'asia-southeast1');
  assert.deepEqual(client.MAZE_AUTHORITY_CALLABLES, {
    command: 'mazeV1Command',
    syncRoom: 'mazeV1SyncRoom',
    claimOfflineTurn: 'mazeV1ClaimOfflineTurn',
  });
  assert.equal(client.MAZE_AUTHORITY_OFFLINE_TURN_GRACE_MS, 45_000);
  assert.equal(
    client.mazeAuthorityPublicViewPath(ROOM_ID),
    `mazeViews/v1/publicRooms/${ROOM_ID}`,
  );
  assert.equal(
    client.mazeAuthorityMemberViewPath(OWNER, ROOM_ID),
    `mazeViews/v1/memberRooms/${OWNER}/${ROOM_ID}`,
  );
  assert.equal(
    client.mazeAuthorityMemberRoomsPath(OWNER),
    `mazeViews/v1/memberRooms/${OWNER}`,
  );
  assert.equal(
    client.mazeAuthorityRankingViewPath(OWNER),
    `mazeAuthorityRankings/v1/${OWNER}`,
  );
  assert.throws(
    () => client.mazeAuthorityPublicViewPath('bad/room'),
    (error) => error?.code === 'invalid-command',
  );
  assert.throws(
    () => client.mazeAuthorityMemberViewPath('bad/user', ROOM_ID),
    (error) => error?.code === 'invalid-command',
  );
  assert.throws(
    () => client.mazeAuthorityMemberRoomsPath('bad/user'),
    (error) => error?.code === 'invalid-command',
  );

  const generatedIds = new Set(Array.from({ length: 64 }, () => (
    client.createMazeAuthorityCommandId()
  )));
  assert.equal(generatedIds.size, 64);
  for (const commandId of generatedIds) {
    assert.match(commandId, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  }
  const generatedRoomIds = new Set(Array.from({ length: 64 }, () => (
    client.createMazeAuthorityRoomId()
  )));
  assert.equal(generatedRoomIds.size, 64);
  for (const roomId of generatedRoomIds) assert.match(roomId, /^mz1_[0-9a-f]{32}$/);
  const generatedPresenceSessions = new Set(Array.from({ length: 16 }, () => (
    client.createMazeAuthorityPresenceSessionId()
  )));
  assert.equal(generatedPresenceSessions.size, 16);
  for (const session of generatedPresenceSessions) assert.match(session, /^mps1_[0-9a-f]{32}$/);

  const create = client.buildMazeAuthorityCreateRoomCommand({
    roomId: ROOM_ID,
    name: '작은 미로',
    maxPlayers: 4,
    commandId: COMMAND_ID,
  });
  assert.deepEqual(create, {
    type: 'createRoom',
    commandId: COMMAND_ID,
    roomId: ROOM_ID,
    expectedGeneration: 0,
    expectedRevision: 0,
    name: '작은 미로',
    maxPlayers: 4,
  });
  const fence = {
    roomId: ROOM_ID,
    expectedGeneration: 1,
    expectedRevision: 7,
    commandId: COMMAND_ID,
  };
  assert.equal(client.buildMazeAuthorityJoinRoomCommand(fence).type, 'joinRoom');
  assert.equal(client.buildMazeAuthorityResetMapCommand(fence).type, 'resetMap');
  assert.equal(client.buildMazeAuthorityStartMatchCommand(fence).type, 'startMatch');
  assert.equal(client.buildMazeAuthorityForfeitCommand, undefined, 'voluntary surrender has no client builder');
  assert.equal(client.parseMazeAuthorityCommand({
    type: 'forfeit',
    commandId: COMMAND_ID,
    roomId: ROOM_ID,
    expectedGeneration: 1,
    expectedRevision: 7,
  }), null, 'voluntary surrender is rejected by the strict command parser');
  assert.equal(client.buildMazeAuthorityLeaveRoomCommand(fence).type, 'leaveRoom');
  assert.equal(client.buildMazeAuthorityRestartMatchCommand(fence).type, 'restartMatch');
  assert.equal(client.buildMazeAuthorityCloseRoomCommand(fence).type, 'closeRoom');
  assert.deepEqual(client.buildMazeAuthoritySyncRoomRequest(ROOM_ID), { roomId: ROOM_ID });
  assert.equal(client.parseMazeAuthoritySyncRoomRequest({ roomId: ROOM_ID, extra: true }), null);
  const offlineTurnRequest = client.buildMazeAuthorityOfflineTurnRequest({
    roomId: ROOM_ID,
    targetUid: OWNER,
    generation: 1,
    leaseEpoch: 3,
    turnNumber: 4,
  });
  assert.deepEqual(offlineTurnRequest, {
    roomId: ROOM_ID,
    targetUid: OWNER,
    generation: 1,
    leaseEpoch: 3,
    turnNumber: 4,
  });
  assert.equal(client.parseMazeAuthorityOfflineTurnRequest({
    ...offlineTurnRequest,
    expectedRevision: 8,
  }), null, 'offline timeout requests never accept a client-owned revision or result');
  assert.throws(
    () => client.buildMazeAuthorityOfflineTurnRequest({
      ...offlineTurnRequest,
      leaseEpoch: 0,
    }),
    (error) => error?.code === 'invalid-command',
  );
  const offlineSince = 50_000;
  assert.equal(client.getMazeAuthorityOfflineTurnGraceRemainingMs({
    offlineSince,
    serverTimeOffsetMs: 500,
    clientNow: offlineSince + 45_000 - 501,
  }), 1, 'the Authority effect cannot schedule a callable before the trusted 45s grace');
  assert.equal(client.getMazeAuthorityOfflineTurnGraceRemainingMs({
    offlineSince,
    serverTimeOffsetMs: 500,
    clientNow: offlineSince + 45_000 - 500,
  }), 0, 'the Authority effect becomes eligible exactly at the trusted 45s boundary');
  assert.throws(
    () => client.getMazeAuthorityOfflineTurnGraceRemainingMs({
      offlineSince: -1,
      serverTimeOffsetMs: 0,
      clientNow: 1,
    }),
    (error) => error?.code === 'invalid-command',
  );

  const inputMap = validMap();
  const submit = client.buildMazeAuthoritySubmitMapCommand({ ...fence, map: inputMap });
  inputMap.startPosition.row = 5;
  inputMap.obstacles.push({ position: { row: 0, col: 0 }, direction: 'right' });
  assert.deepEqual(submit.map.startPosition, { row: 0, col: 0 }, 'the builder snapshots map bytes');
  assert.deepEqual(submit.map.obstacles, [], 'later map mutations cannot change an in-flight command');
  const normalizedSubmit = client.buildMazeAuthoritySubmitMapCommand({
    ...fence,
    map: validMap({ skillLoadout: 'anchor' }),
  });
  assert.equal(
    normalizedSubmit.map.skillLoadout,
    'scoutPulse',
    'the client normalizes stale skill drafts to the inert V3 compatibility value',
  );
  assert.equal(client.parseMazeAuthorityCommand({
    ...normalizedSubmit,
    map: { ...normalizedSubmit.map, skillLoadout: 'dash' },
  }), null, 'the strict wire parser rejects retired skill loadouts');

  const submittedDiceChallenge = diceWormhole.generateDiceWormholeChallenge(0xA11CE);
  const diceSubmit = client.buildMazeAuthoritySubmitMapCommand({
    ...fence,
    map: validMap({ items: [diceWormholeItem(submittedDiceChallenge)] }),
  });
  assert.deepEqual(
    diceSubmit.map.items[0].challenge,
    submittedDiceChallenge,
    'new Authority commands preserve the canonical V2 dice challenge',
  );
  assert.throws(
    () => client.buildMazeAuthoritySubmitMapCommand({
      ...fence,
      map: validMap({ items: [diceWormholeItem(legacyWormholeChallenge())] }),
    }),
    (error) => error?.code === 'invalid-command',
    'new Authority commands reject a valid legacy V1 challenge',
  );
  assert.throws(
    () => client.buildMazeAuthoritySubmitMapCommand({
      ...fence,
      map: validMap({
        items: [{
          type: 'wormhole',
          entrance: { row: 0, col: 1 },
          exit: { row: 4, col: 4 },
        }],
      }),
    }),
    (error) => error?.code === 'invalid-command',
    'new Authority commands reject challenge-less legacy wormholes',
  );
  assert.equal(client.parseMazeAuthorityCommand({
    ...diceSubmit,
    map: {
      ...diceSubmit.map,
      items: [{
        ...diceSubmit.map.items[0],
        challenge: { ...submittedDiceChallenge, boardSize: 6 },
      }],
    },
  }), null, 'new Authority commands reject non-canonical V2 challenge fields');

  const turn = client.buildMazeAuthorityTurnCommand({
    ...fence,
    action: { type: 'move', direction: 'right' },
  });
  assert.deepEqual(turn.action, { type: 'move', direction: 'right' });
  assert.equal(client.parseMazeAuthorityCommand({ ...turn, privateState: true }), null);
  for (const lifecycleType of ['resetMap', 'leaveRoom', 'restartMatch', 'closeRoom']) {
    const command = client.parseMazeAuthorityCommand({
      type: lifecycleType,
      commandId: COMMAND_ID,
      roomId: ROOM_ID,
      expectedGeneration: 1,
      expectedRevision: 7,
    });
    assert.equal(command?.type, lifecycleType);
    assert.equal(client.parseMazeAuthorityCommand({ ...command, extra: true }), null);
  }
  for (const retiredAction of [
    { type: 'radar', itemIndex: 0 },
    { type: 'skill', skillId: 'scoutPulse' },
    { type: 'skill', skillId: 'breach', direction: 'right' },
    { type: 'skill', skillId: 'anchor' },
    { type: 'skill', skillId: 'dash', direction: 'right' },
  ]) {
    assert.equal(
      client.parseMazeAuthorityCommand({ ...turn, action: retiredAction }),
      null,
      `${retiredAction.type} command parsing is retired`,
    );
    assert.throws(
      () => client.buildMazeAuthorityTurnCommand({ ...fence, action: retiredAction }),
      (error) => error?.code === 'invalid-command',
      `${retiredAction.type} command building is retired`,
    );
  }
  assert.throws(
    () => client.buildMazeAuthorityJoinRoomCommand({ ...fence, expectedGeneration: 0 }),
    (error) => error?.code === 'invalid-command',
  );
  assert.throws(
    () => client.buildMazeAuthorityJoinRoomCommand({ ...fence, commandId: 'not-a-uuid' }),
    (error) => error?.code === 'invalid-command',
  );
  assert.throws(
    () => client.buildMazeAuthoritySubmitMapCommand({
      ...fence,
      map: validMap({ items: [{ type: 'radar' }] }),
    }),
    (error) => error?.code === 'invalid-command',
    'new Authority maps reject radar',
  );
  for (const retiredWall of ['collapseWall', 'mirrorWall']) {
    assert.throws(
      () => client.buildMazeAuthoritySubmitMapCommand({
        ...fence,
        map: validMap({
          items: [{
            type: retiredWall,
            wallPosition: { row: 0, col: 0 },
            wallDirection: 'right',
          }],
        }),
      }),
      (error) => error?.code === 'invalid-command',
      `new Authority maps reject the retired ${retiredWall}`,
    );
  }

  const lifecycleResponses = [
    {
      command: client.buildMazeAuthorityResetMapCommand(fence),
      result: {
        type: 'resetMap', roomId: ROOM_ID, generation: 1, revision: 8, ready: false,
      },
    },
    {
      command: client.buildMazeAuthorityLeaveRoomCommand(fence),
      result: {
        type: 'leaveRoom', roomId: ROOM_ID, generation: 1, revision: 8,
        phase: 'play', closed: false, ownerId: OWNER, remainingMembers: 1,
      },
    },
    {
      command: client.buildMazeAuthorityRestartMatchCommand(fence),
      result: {
        type: 'restartMatch', roomId: ROOM_ID, generation: 2, revision: 1,
        phase: 'setup', currentTurn: OWNER, matchNumber: 1,
      },
    },
    {
      command: client.buildMazeAuthorityCloseRoomCommand(fence),
      result: {
        type: 'closeRoom', roomId: ROOM_ID, generation: 1, revision: 8, closed: true,
      },
    },
  ];
  for (const { command, result } of lifecycleResponses) {
    const response = { ok: true, replayed: false, result };
    assert.deepEqual(client.decodeMazeAuthorityCommandResponse(response, command), response);
    assert.equal(
      client.decodeMazeAuthorityCommandResponse({
        ...response,
        result: { ...result, leaked: true },
      }, command),
      null,
      `${command.type} result decoder requires an exact result shape`,
    );
  }
  const restartCommand = client.buildMazeAuthorityRestartMatchCommand(fence);
  assert.equal(client.decodeMazeAuthorityCommandResponse({
    ok: true,
    replayed: false,
    result: {
      type: 'restartMatch', roomId: ROOM_ID, generation: 1, revision: 8,
      phase: 'setup', currentTurn: OWNER, matchNumber: 1,
    },
  }, restartCommand), null, 'restart must cross to generation + 1 and revision 1');
  const lastLeave = client.buildMazeAuthorityLeaveRoomCommand(fence);
  assert.ok(client.decodeMazeAuthorityCommandResponse({
    ok: true,
    replayed: true,
    result: {
      type: 'leaveRoom', roomId: ROOM_ID, generation: 1, revision: 8,
      phase: 'setup', closed: true, ownerId: OWNER, remainingMembers: 0,
    },
  }, lastLeave));
  assert.equal(client.decodeMazeAuthorityCommandResponse({
    ok: true,
    replayed: false,
    result: {
      type: 'leaveRoom', roomId: ROOM_ID, generation: 1, revision: 8,
      phase: 'play', closed: true, ownerId: OWNER, remainingMembers: 1,
    },
  }, lastLeave), null, 'a closed leave result is an exact empty SETUP tombstone transition');

  const offlineTurnResponse = {
    ok: true,
    replayed: false,
    claimId: `timeout_${'a'.repeat(48)}`,
    result: {
      type: 'skipOfflineTurn',
      roomId: ROOM_ID,
      generation: 1,
      revision: 9,
      phase: 'play',
      skippedPlayerId: OWNER,
      currentTurn: GUEST,
      turnNumber: 5,
    },
  };
  assert.deepEqual(
    client.decodeMazeAuthorityOfflineTurnResponse(offlineTurnResponse, offlineTurnRequest),
    offlineTurnResponse,
  );
  for (const invalidOfflineResponse of [
    { ...offlineTurnResponse, winner: GUEST },
    {
      ...offlineTurnResponse,
      result: { ...offlineTurnResponse.result, winner: GUEST },
    },
    {
      ...offlineTurnResponse,
      result: { ...offlineTurnResponse.result, forfeited: true },
    },
    {
      ...offlineTurnResponse,
      result: { ...offlineTurnResponse.result, type: 'forfeit' },
    },
    {
      ...offlineTurnResponse,
      result: { ...offlineTurnResponse.result, currentTurn: OWNER },
    },
    {
      ...offlineTurnResponse,
      result: { ...offlineTurnResponse.result, turnNumber: 6 },
    },
    { ...offlineTurnResponse, claimId: 'timeout_not-a-server-claim' },
  ]) {
    assert.equal(
      client.decodeMazeAuthorityOfflineTurnResponse(invalidOfflineResponse, offlineTurnRequest),
      null,
      'offline-turn response is exact and cannot manufacture a surrender or winner',
    );
  }

  assert.deepEqual(client.decodeMazeAuthorityRankingSubscription(false, null), {
    status: 'missing',
    entries: [],
  });
  const rankingSubscription = client.decodeMazeAuthorityRankingSubscription(true, {
    [GUEST]: rankingEntry(GUEST),
    [OWNER]: rankingEntry(OWNER, {
      photoURL: 'https://lh3.googleusercontent.com/owner-avatar',
    }),
  });
  assert.equal(rankingSubscription.status, 'ready');
  assert.deepEqual(rankingSubscription.entries.map((entry) => entry.uid), [OWNER, GUEST]);
  assert.equal(rankingSubscription.entries[0].photoURL, 'https://lh3.googleusercontent.com/owner-avatar');
  assert.deepEqual(client.decodeMazeAuthorityRankingSubscription(true, {}), {
    status: 'missing',
    entries: [],
  });
  for (const invalidRankings of [
    null,
    { [OWNER]: { ...rankingEntry(OWNER), privateSettlementTrail: '|secret|' } },
    { [OWNER]: rankingEntry(GUEST) },
    { [OWNER]: rankingEntry(OWNER, { played: 999 }) },
    { [OWNER]: rankingEntry(OWNER, { photoURL: 'https://example.com/avatar.png' }) },
  ]) {
    assert.deepEqual(client.decodeMazeAuthorityRankingSubscription(true, invalidRankings), {
      status: 'invalid',
      entries: [],
    });
  }
  assert.throws(
    () => client.mazeAuthorityRankingViewPath('bad/user'),
    (error) => error?.code === 'invalid-command',
  );

  assert.deepEqual(client.MAZE_AUTHORITY_PRESENCE_SLOTS, [
    '0', '1', '2', '3', '4', '5', '6', '7',
  ]);
  assert.equal(
    client.mazeAuthorityPresenceConnectionsPath(ROOM_ID, OWNER),
    `mazePresence/v1/rooms/${ROOM_ID}/${OWNER}`,
  );
  assert.equal(
    client.mazeAuthorityPresenceConnectionPath(ROOM_ID, OWNER, '7'),
    `mazePresence/v1/rooms/${ROOM_ID}/${OWNER}/7`,
  );
  assert.equal(
    client.mazeAuthorityPresenceRoomStatusPath(ROOM_ID),
    `mazePresence/v1/status/${ROOM_ID}`,
  );
  assert.equal(
    client.mazeAuthorityPresenceStatusPath(ROOM_ID, OWNER),
    `mazePresence/v1/status/${ROOM_ID}/${OWNER}`,
  );
  assert.throws(
    () => client.mazeAuthorityPresenceConnectionPath(ROOM_ID, OWNER, '8'),
    (error) => error?.code === 'invalid-command',
  );
  const presenceConnection = {
    uid: OWNER,
    generation: 2,
    session: 'mps1_1234567890abcdef1234567890abcdef',
    connectedAt: 30_000,
    lastSeen: 31_000,
  };
  assert.deepEqual(
    client.buildMazeAuthorityPresenceConnection(presenceConnection),
    presenceConnection,
  );
  assert.deepEqual(client.parseMazeAuthorityPresenceConnection(presenceConnection, {
    uid: OWNER,
    generation: 2,
    session: presenceConnection.session,
  }), presenceConnection);
  assert.equal(client.parseMazeAuthorityPresenceConnection({
    ...presenceConnection,
    actorSecret: 'must-not-be-written',
  }), null);
  assert.equal(client.parseMazeAuthorityPresenceConnection(presenceConnection, {
    generation: 3,
  }), null);
  assert.throws(
    () => client.buildMazeAuthorityPresenceConnection({
      ...presenceConnection,
      session: '',
    }),
    (error) => error?.code === 'invalid-command',
  );
  const heartbeatConnection = {
    ...presenceConnection,
    lastSeen: 50_000,
  };
  assert.deepEqual(
    client.buildMazeAuthorityPresenceHeartbeatTransactionValue(null, heartbeatConnection),
    heartbeatConnection,
    'a cold Web RTDB cache must send a candidate so the transaction reaches the server',
  );
  assert.deepEqual(
    client.buildMazeAuthorityPresenceHeartbeatTransactionValue(
      presenceConnection,
      heartbeatConnection,
    ),
    heartbeatConnection,
  );
  assert.equal(
    client.buildMazeAuthorityPresenceHeartbeatTransactionValue({
      ...presenceConnection,
      session: 'mps1_abcdefabcdefabcdefabcdefabcdefab',
    }, heartbeatConnection),
    undefined,
    'a heartbeat must not overwrite a slot claimed by another browser session',
  );
  assert.equal(
    client.buildMazeAuthorityPresenceReleaseTransactionValue(null, {
      uid: OWNER,
      generation: 2,
      session: presenceConnection.session,
    }),
    null,
    'a cold-cache release must reach the server instead of aborting locally',
  );
  assert.equal(
    client.buildMazeAuthorityPresenceReleaseTransactionValue(presenceConnection, {
      uid: OWNER,
      generation: 2,
      session: presenceConnection.session,
    }),
    null,
  );
  assert.equal(
    client.buildMazeAuthorityPresenceReleaseTransactionValue({
      ...presenceConnection,
      session: 'mps1_abcdefabcdefabcdefabcdefabcdefab',
    }, {
      uid: OWNER,
      generation: 2,
      session: presenceConnection.session,
    }),
    undefined,
    'a stale cleanup must preserve a slot claimed by another browser session',
  );
  const onlineStatus = {
    uid: OWNER,
    roomId: ROOM_ID,
    generation: 2,
    epoch: 3,
    online: true,
    lastSeen: 31_000,
    updatedAt: 31_100,
  };
  assert.deepEqual(client.parseMazeAuthorityPresenceStatus(onlineStatus, {
    uid: OWNER,
    roomId: ROOM_ID,
  }), onlineStatus);
  const offlineStatus = {
    ...onlineStatus,
    online: false,
    offlineSince: 31_500,
    updatedAt: 31_500,
  };
  assert.deepEqual(client.parseMazeAuthorityPresenceStatus(offlineStatus), offlineStatus);
  assert.equal(client.parseMazeAuthorityPresenceStatus({
    ...onlineStatus,
    offlineSince: 31_500,
  }), null, 'online status cannot retain a stale offlineSince field');

  const publicRaw = baseView('public');
  const publicView = client.canonicalizeMazeAuthorityPublicView(publicRaw, ROOM_ID);
  assert.ok(publicView);
  assert.deepEqual(publicView.gameState.turnOrder, [OWNER, GUEST]);
  assert.equal(publicView.gameState.currentTurn, OWNER);
  assert.equal(publicView.gameState.winner, null);
  assert.equal(publicView.gameState.draw, null);
  assert.deepEqual(publicView.gameState.collisionWalls, []);
  assert.deepEqual(publicView.gameState.itemState, {});
  assert.deepEqual(publicView.gameState.revealedWallsByPlayer, {});
  assert.deepEqual(publicView.gameState.visionEffectsByPlayer, {});
  assert.deepEqual(Object.keys(publicView.gameState.maps[OWNER]).sort(), [
    'endPosition', 'startPosition',
  ]);

  const memberRaw = baseView('member');
  const memberView = client.canonicalizeMazeAuthorityMemberView(memberRaw, OWNER, ROOM_ID);
  assert.ok(memberView);
  assert.deepEqual(memberView.gameState.maps[OWNER].obstacles, []);
  assert.deepEqual(memberView.gameState.maps[OWNER].items, []);
  assert.deepEqual(memberView.gameState.itemState[OWNER].mazeSkill, {
    version: 1,
    loadout: ['scoutPulse'],
    consumed: {},
  });
  assert.deepEqual(
    memberView.gameState.itemState[OWNER].consumed,
    { 0: true },
    'RTDB numeric-key arrays canonicalize back to boolean index records',
  );

  const projectedMapDiceChallenge = diceWormhole.generateDiceWormholeChallenge(0x4D4150);
  const memberWithDiceMap = clone(memberRaw);
  memberWithDiceMap.gameState.maps[OWNER].items = {
    0: diceWormholeItem(projectedMapDiceChallenge),
  };
  const memberDiceMapView = client.canonicalizeMazeAuthorityMemberView(
    memberWithDiceMap,
    OWNER,
    ROOM_ID,
  );
  assert.ok(memberDiceMapView, 'a projected full map reads the canonical V2 challenge');
  assert.deepEqual(
    memberDiceMapView.gameState.maps[OWNER].items[0].challenge,
    projectedMapDiceChallenge,
  );
  const memberWithLegacyMap = clone(memberRaw);
  memberWithLegacyMap.gameState.maps[OWNER].items = {
    0: diceWormholeItem(legacyWormholeChallenge()),
  };
  assert.ok(
    client.canonicalizeMazeAuthorityMemberView(memberWithLegacyMap, OWNER, ROOM_ID),
    'projected legacy V1 authored maps remain readable during drain',
  );

  const memberWithFire = clone(memberRaw);
  memberWithFire.gameState.visionEffectsByPlayer = {
    [OWNER]: {
      type: 'fire',
      sourcePlayerId: GUEST,
      appliedAtTurn: 4,
      expiresAtTargetMove: 8,
    },
  };
  const memberFireView = client.canonicalizeMazeAuthorityMemberView(
    memberWithFire,
    OWNER,
    ROOM_ID,
  );
  assert.ok(memberFireView, 'the new common-only fire projection is readable');
  assert.deepEqual(memberFireView.gameState.visionEffectsByPlayer[OWNER], {
    type: 'fire',
    sourcePlayerId: GUEST,
    appliedAtTurn: 4,
    expiresAtTargetMove: 8,
  });
  const fireBoard = presentation.buildMazeAuthorityLiveBoards({
    gameState: memberFireView.gameState,
    viewerUid: OWNER,
  }).find((board) => board.runnerId === OWNER);
  assert.equal(fireBoard?.fireAffected, true, 'presentation trusts the projected active fire status');
  assert.deepEqual(fireBoard?.heatWalls, [], 'new fire effects need no legacy phantom walls');

  const legacyHeatWalls = Array.from({ length: 6 }, (_, index) => ({
    position: { row: index, col: 0 },
    direction: 'right',
  }));
  const memberWithLegacyFire = clone(memberWithFire);
  memberWithLegacyFire.gameState.visionEffectsByPlayer[OWNER].phantomWalls = legacyHeatWalls;
  const memberLegacyFireView = client.canonicalizeMazeAuthorityMemberView(
    memberWithLegacyFire,
    OWNER,
    ROOM_ID,
  );
  assert.ok(memberLegacyFireView, 'legacy six-wall fire projections remain readable');
  const legacyFireBoard = presentation.buildMazeAuthorityLiveBoards({
    gameState: memberLegacyFireView.gameState,
    viewerUid: OWNER,
  }).find((board) => board.runnerId === OWNER);
  assert.deepEqual(legacyFireBoard?.heatWalls, legacyHeatWalls);
  const malformedLegacyFire = clone(memberWithLegacyFire);
  malformedLegacyFire.gameState.visionEffectsByPlayer[OWNER].phantomWalls.pop();
  assert.equal(
    client.canonicalizeMazeAuthorityMemberView(malformedLegacyFire, OWNER, ROOM_ID),
    null,
    'legacy fire projections still require exactly six phantom walls',
  );

  const memberWithPoison = clone(memberRaw);
  memberWithPoison.gameState.poisonEffectsByPlayer = {
    [OWNER]: {
      sourcePlayerId: GUEST,
      appliedAtTurn: 4,
      expiresAtTargetMove: 7,
    },
  };
  const memberPoisonView = client.canonicalizeMazeAuthorityMemberView(
    memberWithPoison,
    OWNER,
    ROOM_ID,
  );
  assert.ok(memberPoisonView, 'a redacted poison status remains readable by its affected member');
  assert.deepEqual(memberPoisonView.gameState.poisonEffectsByPlayer[OWNER], {
    sourcePlayerId: GUEST,
    appliedAtTurn: 4,
    expiresAtTargetMove: 7,
  });
  const memberWithInjectedPoisonSeed = clone(memberWithPoison);
  memberWithInjectedPoisonSeed.gameState.poisonEffectsByPlayer[OWNER].seed = 0x1234_5678;
  assert.equal(
    client.canonicalizeMazeAuthorityMemberView(
      memberWithInjectedPoisonSeed,
      OWNER,
      ROOM_ID,
    ),
    null,
    'the exact poison view parser rejects an injected server-only seed',
  );

  const hiddenWormholeWalls = [
    { position: { row: 0, col: 1 }, direction: 'down' },
    { position: { row: 0, col: 2 }, direction: 'down' },
    { position: { row: 1, col: 3 }, direction: 'right' },
    { position: { row: 2, col: 3 }, direction: 'right' },
    { position: { row: 3, col: 1 }, direction: 'right' },
    { position: { row: 4, col: 1 }, direction: 'right' },
    { position: { row: 4, col: 3 }, direction: 'down' },
    { position: { row: 4, col: 4 }, direction: 'down' },
  ];
  const memberWithSparseSeals = clone(memberRaw);
  memberWithSparseSeals.gameState.wormholeRunsByPlayer = {
    [OWNER]: {
      mapOwnerId: GUEST,
      itemIndex: 0,
      position: { row: 0, col: 0 },
      enteredAtTurn: 4,
      activatedSeals: [true, null, true],
      discoveredWalls: [hiddenWormholeWalls[0]],
      challenge: {
        version: 1,
        startPosition: { row: 0, col: 0 },
        endPosition: { row: 2, col: 2 },
        seals: [{ row: 0, col: 5 }, { row: 5, col: 5 }, { row: 5, col: 0 }],
      },
    },
  };
  const sparseSealView = client.canonicalizeMazeAuthorityMemberView(
    memberWithSparseSeals,
    OWNER,
    ROOM_ID,
  );
  assert.ok(sparseSealView, 'RTDB sparse activated-seal arrays remain readable');
  assert.deepEqual(
    sparseSealView.gameState.wormholeRunsByPlayer[OWNER].activatedSeals,
    { 0: true, 2: true },
  );
  assert.deepEqual(
    sparseSealView.gameState.wormholeRunsByPlayer[OWNER].discoveredWalls,
    [hiddenWormholeWalls[0]],
  );
  assert.equal(
    Object.prototype.hasOwnProperty.call(
      sparseSealView.gameState.wormholeRunsByPlayer[OWNER].challenge,
      'obstacles',
    ),
    false,
    'a parsed member PLAY run never materializes hidden challenge walls',
  );
  const legacyRunBoard = presentation.buildMazeAuthorityLiveBoards({
    gameState: sparseSealView.gameState,
    viewerUid: OWNER,
  }).find((board) => board.runnerId === OWNER);
  assert.deepEqual(
    legacyRunBoard?.wormholeRun?.challenge.obstacles,
    [],
    'active V1 presentation keeps undiscovered internal walls redacted',
  );

  const memberWithLeakedWormholeWalls = clone(memberWithSparseSeals);
  memberWithLeakedWormholeWalls.gameState.wormholeRunsByPlayer[OWNER]
    .challenge.obstacles = hiddenWormholeWalls;
  assert.equal(
    client.canonicalizeMazeAuthorityMemberView(
      memberWithLeakedWormholeWalls,
      OWNER,
      ROOM_ID,
    ),
    null,
    'a member PLAY projection rejects injected hidden wormhole walls',
  );
  const publicWithLeakedWormholeWalls = clone(publicRaw);
  publicWithLeakedWormholeWalls.gameState.wormholeRunsByPlayer = clone(
    memberWithLeakedWormholeWalls.gameState.wormholeRunsByPlayer,
  );
  assert.equal(
    client.canonicalizeMazeAuthorityPublicView(publicWithLeakedWormholeWalls, ROOM_ID),
    null,
    'a public PLAY projection rejects injected hidden wormhole walls',
  );

  const projectedDiceChallenge = diceWormhole.generateDiceWormholeChallenge(0xB0A4D);
  const memberWithDiceRun = clone(memberRaw);
  memberWithDiceRun.gameState.wormholeRunsByPlayer = {
    [OWNER]: {
      mapOwnerId: GUEST,
      itemIndex: 0,
      position: clone(projectedDiceChallenge.startPosition),
      enteredAtTurn: 4,
      challenge: clone(projectedDiceChallenge),
      orientation: projectedDiceChallenge.initialOrientation,
      actionsTaken: 10,
    },
  };
  const memberDiceRunView = client.canonicalizeMazeAuthorityMemberView(
    memberWithDiceRun,
    OWNER,
    ROOM_ID,
  );
  assert.ok(memberDiceRunView, 'an active V2 dice run preserves its full public puzzle state');
  assert.deepEqual(
    memberDiceRunView.gameState.wormholeRunsByPlayer[OWNER].challenge,
    projectedDiceChallenge,
  );
  assert.equal(memberDiceRunView.gameState.wormholeRunsByPlayer[OWNER].actionsTaken, 10);
  const diceRunBoard = presentation.buildMazeAuthorityLiveBoards({
    gameState: memberDiceRunView.gameState,
    viewerUid: OWNER,
  }).find((board) => board.runnerId === OWNER);
  assert.deepEqual(diceRunBoard?.wormholeRun, {
    ...memberDiceRunView.gameState.wormholeRunsByPlayer[OWNER],
    position: clone(projectedDiceChallenge.startPosition),
    challenge: clone(projectedDiceChallenge),
  }, 'presentation materializes every V2 run field without V1 redaction');
  for (const missingField of ['orientation', 'actionsTaken']) {
    const invalidDiceRun = clone(memberWithDiceRun);
    delete invalidDiceRun.gameState.wormholeRunsByPlayer[OWNER][missingField];
    assert.equal(
      client.canonicalizeMazeAuthorityMemberView(invalidDiceRun, OWNER, ROOM_ID),
      null,
      `a V2 run requires ${missingField}`,
    );
  }
  const diceRunWithLegacyState = clone(memberWithDiceRun);
  diceRunWithLegacyState.gameState.wormholeRunsByPlayer[OWNER].activatedSeals = { 0: true };
  assert.equal(
    client.canonicalizeMazeAuthorityMemberView(diceRunWithLegacyState, OWNER, ROOM_ID),
    null,
    'the V2 run union rejects legacy seal state',
  );
  const diceRunOutsideBoard = clone(memberWithDiceRun);
  diceRunOutsideBoard.gameState.wormholeRunsByPlayer[OWNER].position = { row: 4, col: 0 };
  assert.equal(
    client.canonicalizeMazeAuthorityMemberView(diceRunOutsideBoard, OWNER, ROOM_ID),
    null,
    'the V2 run position is confined to its 4x4 board',
  );

  assert.equal(
    client.canonicalizeMazeAuthorityPublicView({
      ...publicRaw,
      receipts: { stolen: true },
    }),
    null,
    'private receipt fields cannot cross the exact public projection boundary',
  );
  assert.equal(
    client.canonicalizeMazeAuthorityPublicView({
      ...publicRaw,
      gameState: {
        ...publicRaw.gameState,
        maps: {
          ...publicRaw.gameState.maps,
          [OWNER]: {
            ...validMap(),
          },
        },
      },
    }),
    null,
    'a public PLAY projection cannot disclose a full authored map',
  );
  assert.equal(
    client.canonicalizeMazeAuthorityMemberView({
      ...memberRaw,
      gameState: {
        ...memberRaw.gameState,
        maps: {
          ...memberRaw.gameState.maps,
          [GUEST]: validMap(),
        },
      },
    }, OWNER),
    null,
    'a member PLAY projection cannot disclose another author\'s map',
  );
  assert.equal(client.canonicalizeMazeAuthorityMemberView(memberRaw, GUEST), null);

  const endedLegacy = baseView('public');
  endedLegacy.lobby.status = 'ended';
  endedLegacy.gameState.phase = 'end';
  endedLegacy.gameState.currentTurn = undefined;
  delete endedLegacy.gameState.currentTurn;
  endedLegacy.gameState.players[OWNER].finished = true;
  endedLegacy.gameState.players[GUEST].finished = true;
  endedLegacy.gameState.maps = {
    [OWNER]: {
      rulesVersion: 3,
      startPosition: { row: 0, col: 0 },
      endPosition: { row: 5, col: 5 },
      skillLoadout: 'scoutPulse',
      items: {
        0: {
          type: 'collapseWall',
          wallPosition: { row: 0, col: 0 },
          wallDirection: 'right',
        },
        1: {
          type: 'mirrorWall',
          wallPosition: { row: 0, col: 1 },
          wallDirection: 'right',
        },
        2: {
          type: 'radar',
        },
      },
    },
    [GUEST]: {
      rulesVersion: 3,
      startPosition: { row: 5, col: 5 },
      endPosition: { row: 0, col: 0 },
      skillLoadout: 'anchor',
    },
  };
  const endedView = client.canonicalizeMazeAuthorityPublicView(endedLegacy);
  assert.ok(endedView, 'legacy ended projections remain readable during drain');
  assert.equal(endedView.gameState.maps[OWNER].items[0].type, 'collapseWall');
  assert.equal(endedView.gameState.maps[OWNER].items[1].type, 'mirrorWall');
  assert.equal(endedView.gameState.maps[OWNER].items[2].type, 'radar');
  for (const retiredWall of ['radar', 'collapseWall', 'mirrorWall']) {
    assert.ok(
      Object.prototype.hasOwnProperty.call(endedView.ruleSnapshot.itemCosts, retiredWall),
      `the legacy V3 rule snapshot keeps ${retiredWall} on the wire`,
    );
  }
  const endedWithFullWormholeRun = clone(endedLegacy);
  endedWithFullWormholeRun.gameState.wormholeRunsByPlayer = {
    [OWNER]: {
      ...clone(memberWithSparseSeals.gameState.wormholeRunsByPlayer[OWNER]),
      challenge: {
        ...clone(memberWithSparseSeals.gameState.wormholeRunsByPlayer[OWNER].challenge),
        obstacles: hiddenWormholeWalls,
      },
    },
  };
  const endedWithFullWormholeView = client.canonicalizeMazeAuthorityPublicView(
    endedWithFullWormholeRun,
  );
  assert.ok(endedWithFullWormholeView, 'an END projection may reveal the full wormhole maze');
  assert.deepEqual(
    endedWithFullWormholeView.gameState.wormholeRunsByPlayer[OWNER].challenge.obstacles,
    hiddenWormholeWalls,
  );
  const departedRoster = clone(endedLegacy);
  departedRoster.lobby.members = {
    [OWNER]: { uid: OWNER, slot: 0 },
  };
  departedRoster.gameState.players[GUEST].hasLeft = true;
  const departedRosterView = client.canonicalizeMazeAuthorityPublicView(departedRoster);
  assert.ok(departedRosterView, 'PLAY/END keeps the immutable match roster after a member leaves');
  assert.deepEqual(Object.keys(departedRosterView.gameState.players).sort(), [GUEST, OWNER].sort());
  assert.deepEqual(Object.keys(departedRosterView.lobby.members), [OWNER]);

  const historicalRoster = clone(departedRoster);
  delete historicalRoster.lobby.members;
  const historicalRosterView = client.canonicalizeMazeAuthorityPublicView(historicalRoster);
  assert.ok(historicalRosterView, 'an END public view may retain history after every live member leaves');
  assert.deepEqual(historicalRosterView.lobby.members, {});
  assert.deepEqual(Object.keys(historicalRosterView.gameState.players).sort(), [GUEST, OWNER].sort());
  assert.equal(client.canonicalizeMazeAuthorityMemberView({
    ...historicalRoster,
    audience: 'member',
    viewerUid: OWNER,
  }, OWNER), null, 'departed member projections are deleted, never treated as live member views');
  assert.equal(client.canonicalizeMazeAuthorityPublicView(null), null);
  assert.equal(client.canonicalizeMazeAuthorityPublicView({
    ...historicalRoster,
    lobby: {
      name: historicalRoster.lobby.name,
      ownerId: OWNER,
      maxPlayers: 2,
      status: 'closed',
    },
    gameState: {
      rulesVersion: 3,
      matchNumber: 1,
      phase: 'setup',
    },
  }), null, 'closed Authority tombstones are private and public projection cleanup is null');

  callableResponse = turnResponse(turn);
  const commandResponse = await client.invokeMazeAuthorityCommand(turn);
  assert.deepEqual(commandResponse, callableResponse);
  assert.deepEqual(calls.at(-1), {
    name: 'mazeV1Command',
    payload: turn,
  });

  callableResponse = offlineTurnResponse;
  assert.deepEqual(
    await client.invokeMazeAuthorityOfflineTurn(offlineTurnRequest),
    offlineTurnResponse,
  );
  assert.deepEqual(calls.at(-1), {
    name: 'mazeV1ClaimOfflineTurn',
    payload: offlineTurnRequest,
  });
  callableResponse = {
    ...offlineTurnResponse,
    result: { ...offlineTurnResponse.result, winner: GUEST },
  };
  await assert.rejects(
    client.invokeMazeAuthorityOfflineTurn(offlineTurnRequest),
    (error) => error?.code === 'invalid-response',
    'the offline-turn invoker rejects any response that tries to create a winner',
  );
  callableError = {
    code: 'functions/failed-precondition',
    details: { reason: 'no-other-active-runner' },
  };
  await assert.rejects(
    client.invokeMazeAuthorityOfflineTurn(offlineTurnRequest),
    (error) => error?.code === 'precondition'
      && error?.reason === 'no-other-active-runner'
      && error?.retry === 'none',
    'the final unfinished runner is a reconnect wait, never a synthetic settlement',
  );
  callableError = null;

  callableResponse = {
    ok: true,
    roomId: ROOM_ID,
    generation: 1,
    revision: 8,
    convergenceAttempts: 2,
  };
  assert.deepEqual(await client.syncMazeAuthorityRoom(ROOM_ID), callableResponse);
  assert.deepEqual(calls.at(-1), {
    name: 'mazeV1SyncRoom',
    payload: { roomId: ROOM_ID },
  });
  assert.equal(
    client.decodeMazeAuthoritySyncRoomResponse({ ...callableResponse, publicView: publicRaw }),
    null,
    'sync returns metadata only; projections are read from RTDB paths',
  );

  callableResponse = {
    ...turnResponse(turn),
    result: { ...turnResponse(turn).result, revision: 999 },
  };
  await assert.rejects(
    client.invokeMazeAuthorityCommand(turn),
    (error) => error?.code === 'invalid-response' && error?.retry === 'none',
    'a response that does not match the command CAS is rejected',
  );

  callableError = {
    code: 'functions/aborted',
    details: { reason: 'revision-mismatch' },
  };
  await assert.rejects(
    client.invokeMazeAuthorityCommand(turn),
    (error) => error?.code === 'conflict'
      && error?.reason === 'revision-mismatch'
      && error?.retry === 'refresh-view',
  );
  callableError = { code: 'functions/unavailable' };
  await assert.rejects(
    client.invokeMazeAuthorityCommand(turn),
    (error) => error?.code === 'unavailable' && error?.retry === 'retry-same-command',
    'an uncertain callable failure retries the byte-identical command ID and payload',
  );
  callableError = null;
  assert.equal(
    client.classifyMazeAuthorityRetry({
      code: 'functions/failed-precondition',
      details: { reason: 'generation-mismatch' },
    }),
    'refresh-view',
  );
  assert.equal(
    client.classifyMazeAuthorityRetry({ code: 'functions/permission-denied' }),
    'none',
  );

  let missingAppCheckInvocation = false;
  const missingAppCheckClient = loadTypeScript('src/lib/mazeAuthorityClient.ts', {
    '@/lib/gameRules': {
      createCanonicalGameRuleSnapshot: ruleSnapshot,
      isValidGameRuleSnapshot: isValidRuleSnapshot,
      isValidMapForRuleSnapshot,
      isValidNewMapForRuleSnapshot,
    },
    '@/lib/firebase': {
      firebaseInitPromise: Promise.resolve({
        functions: {},
        appCheckStatus: 'missing-config',
      }),
    },
    '@/lib/gameUtils': gameUtils,
    '@/lib/diceWormhole': diceWormhole,
    'firebase/functions': {
      httpsCallable: () => {
        missingAppCheckInvocation = true;
        throw new Error('must not create a callable without App Check');
      },
    },
  });
  await assert.rejects(
    missingAppCheckClient.invokeMazeAuthorityCommand(turn),
    (error) => error?.code === 'unavailable' && /App Check/.test(error.message),
  );
  assert.equal(missingAppCheckInvocation, false);

  const source = fs.readFileSync(path.join(ROOT, 'src/lib/mazeAuthorityClient.ts'), 'utf8');
  assert.match(source, /asia-southeast1/);
  assert.match(source, /mazeViews\/v1\/publicRooms/);
  assert.match(source, /mazeViews\/v1\/memberRooms/);
  assert.match(source, /mazeAuthorityRankings\/v1/);
  assert.match(source, /mazePresence\/v1\/rooms/);
  assert.match(source, /mz1_/);
  assert.doesNotMatch(source, /resolveTurnAction/);
  assert.doesNotMatch(source, /firebase\/database/);
  assert.doesNotMatch(source, /getToken\s*\(/);
  assert.doesNotMatch(source, /Math\.random/);

  console.log('Maze Authority callable client and sparse projection contract test passed.');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
