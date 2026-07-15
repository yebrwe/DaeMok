#!/usr/bin/env node

'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');
const ts = require('typescript');

const ROOT = path.join(__dirname, '..');
const AUTH_URL = process.env.FIREBASE_AUTH_EMULATOR_URL || 'http://127.0.0.1:9099';
const DATABASE_URL = process.env.FIREBASE_DATABASE_EMULATOR_URL || 'http://127.0.0.1:9000';
const NAMESPACE = process.env.FIREBASE_DATABASE_NAMESPACE || 'daemok-155c1-default-rtdb';
const API_KEY = 'AIzaSyBxHJ14JjS3DOHHR9xwLGjIKdBJp8cD448';

function loadTypeScript(relativePath, aliases = {}) {
  const filename = path.join(ROOT, relativePath);
  const source = fs.readFileSync(filename, 'utf8');
  const output = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true,
    },
    fileName: filename,
  }).outputText;
  const loaded = new Module(filename, module);
  loaded.filename = filename;
  loaded.paths = Module._nodeModulePaths(path.dirname(filename));
  loaded.require = (request) => aliases[request] || require(request);
  loaded._compile(output, filename);
  return loaded.exports;
}

const types = loadTypeScript('src/types/game.ts');
const mazeSkills = loadTypeScript('src/lib/mazeSkills.ts');
const utils = loadTypeScript('src/lib/gameUtils.ts', { '@/types/game': types });
const gameRules = loadTypeScript('src/lib/gameRules.ts', {
  '@/types/game': types,
  '@/lib/gameUtils': utils,
  '@/lib/mazeSkills': mazeSkills,
});
const adventure = loadTypeScript('src/lib/adventure.ts');
const adventureTown = loadTypeScript('src/lib/adventureTown.ts', { './adventure': adventure });

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

async function signUp(label) {
  const endpoint = new URL('/identitytoolkit.googleapis.com/v1/accounts:signUp', AUTH_URL);
  endpoint.searchParams.set('key', API_KEY);
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      email: `${label}-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`,
      password: 'daemok-rules-test-password',
      returnSecureToken: true,
    }),
  });
  const payload = await response.json();
  assert.equal(response.ok, true, `auth signup failed: ${JSON.stringify(payload)}`);
  return { uid: payload.localId, token: payload.idToken };
}

async function databaseRequest(databasePath, token, method, body) {
  const encoded = databasePath.split('/').filter(Boolean).map(encodeURIComponent).join('/');
  const endpoint = new URL(`/${encoded}.json`, DATABASE_URL);
  endpoint.searchParams.set('ns', NAMESPACE);
  endpoint.searchParams.set('auth', token);
  const response = await fetch(endpoint, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let payload = text;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {}
  return { ok: response.ok, status: response.status, payload };
}

function createRoomPayload(ownerId, snapshot) {
  return {
    createdBy: ownerId,
    lastActivity: Date.now(),
    maxPlayers: 4,
    players: [ownerId],
    rulesVersion: 3,
    ruleSnapshot: snapshot,
    gameState: {
      rulesVersion: 3,
      matchNumber: 0,
      phase: 'setup',
      currentTurn: ownerId,
      turnOrder: [ownerId],
      players: {
        [ownerId]: {
          id: ownerId,
          position: { row: 0, col: 0 },
          isReady: false,
          isOnline: true,
          lastSeen: Date.now(),
        },
      },
    },
  };
}

function validMap(skillLoadout = 'dash') {
  return {
    rulesVersion: 3,
    skillLoadout,
    startPosition: { row: 0, col: 0 },
    endPosition: { row: 5, col: 5 },
    obstacles: [],
    items: [],
  };
}

async function expectAllowed(label, promise) {
  const result = await promise;
  assert.equal(result.ok, true, `${label} should be allowed (${result.status}): ${JSON.stringify(result.payload)}`);
}

async function expectDenied(label, promise) {
  const result = await promise;
  assert.equal(result.ok, false, `${label} should be denied`);
  assert.ok(result.status === 401 || result.status === 403, `${label} unexpected status ${result.status}`);
}

async function main() {
  const [owner, outsider, drawTarget] = await Promise.all([
    signUp('rules-owner'),
    signUp('rules-outsider'),
    signUp('rules-draw-target'),
  ]);
  const canonical = gameRules.createCanonicalGameRuleSnapshot();
  const roomId = `rules-${Date.now()}`;

  await expectAllowed(
    'canonical room creation',
    databaseRequest(`rooms/${roomId}`, owner.token, 'PUT', createRoomPayload(owner.uid, canonical))
  );
  await expectAllowed(
    'canonical owner map and readiness update',
    databaseRequest(`rooms/${roomId}`, owner.token, 'PATCH', {
      [`maps/${owner.uid}`]: validMap(),
      [`gameState/players/${owner.uid}/isReady`]: true,
    })
  );

  const missingSkill = validMap();
  delete missingSkill.skillLoadout;
  await expectDenied(
    'map without skill loadout',
    databaseRequest(`rooms/${roomId}/maps/${owner.uid}`, owner.token, 'PUT', missingSkill)
  );
  await expectDenied(
    'non-member map injection',
    databaseRequest(`rooms/${roomId}/maps/${outsider.uid}`, outsider.token, 'PUT', validMap())
  );
  await expectAllowed(
    'owner may reset own setup map and readiness',
    databaseRequest(`rooms/${roomId}`, owner.token, 'PATCH', {
      [`maps/${owner.uid}`]: null,
      [`gameState/players/${owner.uid}/isReady`]: false,
    })
  );
  await expectAllowed(
    'owner may atomically save setup map again',
    databaseRequest(`rooms/${roomId}`, owner.token, 'PATCH', {
      [`maps/${owner.uid}`]: validMap(),
      [`gameState/players/${owner.uid}/isReady`]: true,
    })
  );
  await expectDenied(
    'room snapshot mutation',
    databaseRequest(
      `rooms/${roomId}/ruleSnapshot/itemCosts/mine`,
      owner.token,
      'PUT',
      9
    )
  );
  await expectDenied(
    'room rules version mutation',
    databaseRequest(`rooms/${roomId}/rulesVersion`, owner.token, 'PUT', 4)
  );
  await expectDenied(
    'match number cannot skip a room-local sequence',
    databaseRequest(`rooms/${roomId}/gameState/matchNumber`, owner.token, 'PUT', 2)
  );

  await expectAllowed(
    'second player atomically claims a setup roster slot',
    databaseRequest(`rooms/${roomId}/players/1`, outsider.token, 'PUT', outsider.uid)
  );
  await expectDenied(
    'the same participant cannot occupy multiple roster slots',
    databaseRequest(`rooms/${roomId}/players/2`, outsider.token, 'PUT', outsider.uid)
  );
  await expectAllowed(
    'second player joins setup after claiming a slot',
    databaseRequest(`rooms/${roomId}/gameState/players/${outsider.uid}`, outsider.token, 'PUT', {
      id: outsider.uid,
      position: { row: 0, col: 0 },
      isReady: false,
    })
  );
  await expectDenied(
    'authenticated outsiders cannot replace the secured room roster',
    databaseRequest(`rooms/${roomId}/players`, outsider.token, 'PUT', [outsider.uid])
  );
  await expectAllowed(
    'second player map and readiness update',
    databaseRequest(`rooms/${roomId}`, outsider.token, 'PATCH', {
      [`maps/${outsider.uid}`]: validMap('anchor'),
      [`gameState/players/${outsider.uid}/isReady`]: true,
    })
  );
  const setupRead = await databaseRequest(`rooms/${roomId}/gameState`, owner.token, 'GET');
  assert.equal(setupRead.ok, true, 'setup state should be readable');
  assert.equal(setupRead.payload.maps, undefined, 'persistent game state must not contain maps');
  const mapBeforePlay = await databaseRequest(`rooms/${roomId}/maps/${owner.uid}`, owner.token, 'GET');
  assert.equal(mapBeforePlay.ok, true, 'setup map should be readable');
  await expectDenied(
    'ready owner cannot rewrite a frozen setup map',
    databaseRequest(`rooms/${roomId}/maps/${owner.uid}`, owner.token, 'PUT', validMap('breach'))
  );
  const playState = {
    ...setupRead.payload,
    matchNumber: 1,
    phase: 'play',
    turnNumber: 1,
    currentTurn: owner.uid,
    turnOrder: [owner.uid, outsider.uid],
    assignments: {
      [owner.uid]: outsider.uid,
      [outsider.uid]: owner.uid,
    },
    itemState: {
      [owner.uid]: { type: 'radar' },
      [outsider.uid]: { type: 'radar' },
    },
    players: {
      ...setupRead.payload.players,
      [owner.uid]: {
        ...setupRead.payload.players[owner.uid],
        isReady: true,
        isOnline: true,
        lastSeen: Date.now(),
        finished: false,
        forfeited: false,
        moves: 0,
        position: { row: 5, col: 4 },
      },
      [outsider.uid]: {
        ...setupRead.payload.players[outsider.uid],
        isReady: true,
        isOnline: true,
        lastSeen: Date.now(),
        finished: false,
        forfeited: false,
        moves: 0,
      },
    },
  };
  await expectAllowed(
    'owner starts canonical play state',
    databaseRequest(`rooms/${roomId}/gameState`, owner.token, 'PUT', playState)
  );
  await expectDenied(
    'current player cannot mutate opponent state',
    databaseRequest(`rooms/${roomId}/gameState/players/${outsider.uid}/moves`, owner.token, 'PUT', 999)
  );
  await expectDenied(
    'current player cannot delete opponent',
    databaseRequest(`rooms/${roomId}/gameState/players/${outsider.uid}`, owner.token, 'DELETE')
  );
  await expectDenied(
    'current player cannot replace a live map',
    databaseRequest(`rooms/${roomId}/maps/${owner.uid}`, owner.token, 'PUT', validMap('breach'))
  );
  await expectDenied(
    'current player cannot delete a live map',
    databaseRequest(`rooms/${roomId}/maps/${owner.uid}`, owner.token, 'DELETE')
  );
  await expectDenied(
    'current player cannot inject a live map item',
    databaseRequest(`rooms/${roomId}/maps/${owner.uid}/items`, owner.token, 'PUT', [{ type: 'radar' }])
  );
  await expectDenied(
    'current player cannot inject maps into live game state',
    databaseRequest(`rooms/${roomId}/gameState/maps/${owner.uid}`, owner.token, 'PUT', validMap())
  );
  await expectDenied(
    'current player cannot rewrite assignments',
    databaseRequest(`rooms/${roomId}/gameState/assignments/${owner.uid}`, owner.token, 'PUT', owner.uid)
  );
  await expectDenied(
    'current player cannot rewrite turn order',
    databaseRequest(`rooms/${roomId}/gameState/turnOrder`, owner.token, 'PUT', [outsider.uid, owner.uid])
  );
  await expectDenied(
    'current player cannot increment moves outside an atomic turn',
    databaseRequest(`rooms/${roomId}/gameState/players/${owner.uid}/moves`, owner.token, 'PUT', 1)
  );

  const liveRead = await databaseRequest(`rooms/${roomId}/gameState`, owner.token, 'GET');
  assert.equal(liveRead.ok, true, 'live state should be readable');
  const validItemState = clone(liveRead.payload);
  validItemState.itemState[outsider.uid].consumed = { 0: true };
  await expectAllowed(
    'current player may update assigned map state',
    databaseRequest(`rooms/${roomId}/gameState`, owner.token, 'PUT', validItemState)
  );
  const itemRead = await databaseRequest(`rooms/${roomId}/gameState`, owner.token, 'GET');
  assert.equal(itemRead.ok, true, 'item state should be readable');
  const validTurnState = clone(itemRead.payload);
  validTurnState.players[owner.uid].moves = 1;
  validTurnState.currentTurn = outsider.uid;
  validTurnState.turnNumber = 2;
  await expectAllowed(
    'current player may commit own move and next turn',
    databaseRequest(`rooms/${roomId}/gameState`, owner.token, 'PUT', validTurnState)
  );
  const persistentMapRead = await databaseRequest(`rooms/${roomId}/maps/${owner.uid}`, owner.token, 'GET');
  assert.deepEqual(persistentMapRead.payload, mapBeforePlay.payload, 'valid live turns must leave sibling maps unchanged');

  await expectAllowed(
    'current player may publish a temporary disconnect',
    databaseRequest(`rooms/${roomId}/gameState/players/${outsider.uid}`, outsider.token, 'PATCH', {
      isOnline: false,
      lastSeen: Date.now(),
    })
  );
  const temporaryOfflineRead = await databaseRequest(`rooms/${roomId}/gameState`, owner.token, 'GET');
  const prematureForfeit = clone(temporaryOfflineRead.payload);
  prematureForfeit.players[outsider.uid].forfeited = true;
  prematureForfeit.currentTurn = owner.uid;
  await expectDenied(
    'connected participant cannot forfeit a temporary disconnect before 45 seconds',
    databaseRequest(`rooms/${roomId}/gameState`, owner.token, 'PUT', prematureForfeit)
  );

  await expectAllowed(
    'offline current player may publish an expired server timestamp',
    databaseRequest(`rooms/${roomId}/gameState/players/${outsider.uid}/lastSeen`, outsider.token, 'PUT', Date.now() - 46_000)
  );
  const expiredOfflineRead = await databaseRequest(`rooms/${roomId}/gameState`, owner.token, 'GET');
  const recoveredOfflineTurn = clone(expiredOfflineRead.payload);
  recoveredOfflineTurn.players[outsider.uid].forfeited = true;
  recoveredOfflineTurn.currentTurn = owner.uid;
  recoveredOfflineTurn.turnMessage = 'offline timeout';
  recoveredOfflineTurn.turnMessageTimestamp = Date.now();
  await expectAllowed(
    'connected participant atomically forfeits an offline current player after 45 seconds',
    databaseRequest(`rooms/${roomId}/gameState`, owner.token, 'PUT', recoveredOfflineTurn)
  );
  const recoveredOfflineRead = await databaseRequest(`rooms/${roomId}/gameState`, owner.token, 'GET');
  assert.equal(recoveredOfflineRead.payload.players[outsider.uid].forfeited, true);
  assert.equal(recoveredOfflineRead.payload.currentTurn, owner.uid);

  const forgedEndState = clone(recoveredOfflineRead.payload);
  forgedEndState.phase = 'end';
  forgedEndState.currentTurn = null;
  forgedEndState.winner = owner.uid;
  forgedEndState.draw = null;
  forgedEndState.turnNumber = 3;
  forgedEndState.players[owner.uid].finished = true;
  forgedEndState.players[owner.uid].finishMoves = 2;
  forgedEndState.players[owner.uid].moves = 2;
  await expectDenied(
    'current player cannot forge completion away from the assigned goal',
    databaseRequest(`rooms/${roomId}/gameState`, owner.token, 'PUT', forgedEndState)
  );

  const rankedEndState = clone(forgedEndState);
  rankedEndState.players[owner.uid].position = { row: 5, col: 5 };
  const forgedWinnerState = clone(rankedEndState);
  forgedWinnerState.winner = outsider.uid;
  await expectDenied(
    'terminal winner must be a non-forfeited minimum-move finisher',
    databaseRequest(`rooms/${roomId}/gameState`, owner.token, 'PUT', forgedWinnerState)
  );
  const forgedDrawState = clone(rankedEndState);
  forgedDrawState.winner = null;
  forgedDrawState.draw = true;
  await expectDenied(
    'a unique finisher cannot forge a draw',
    databaseRequest(`rooms/${roomId}/gameState`, owner.token, 'PUT', forgedDrawState)
  );
  await expectAllowed(
    'owner atomically finishes ranked match',
    databaseRequest(`rooms/${roomId}/gameState`, owner.token, 'PUT', rankedEndState)
  );

  await expectDenied(
    'host cannot delete an unsettled END room',
    databaseRequest(`rooms/${roomId}`, owner.token, 'DELETE')
  );
  await expectDenied(
    'host cannot restart an unsettled END room',
    databaseRequest(`rooms/${roomId}/gameState/phase`, owner.token, 'PUT', 'setup')
  );

  const ownerRanking = {
    uid: owner.uid,
    displayName: 'Owner',
    wins: 1,
    losses: 0,
    draws: 0,
    played: 1,
    rating: 1020,
    bestMoves: 2,
    lastRoomId: roomId,
    lastMatchNumber: 1,
    updatedAt: Date.now(),
    settlementCount: 1,
    settledMatches: { [`${roomId}:1`]: true },
    settlementTrail: `|${roomId}:1|`,
  };
  await expectAllowed(
    'winner creates one idempotent persistent maze ranking entry',
    databaseRequest(`mazeRankings/${owner.uid}`, owner.token, 'PUT', ownerRanking)
  );
  await expectDenied(
    'same room match cannot be settled twice',
    databaseRequest(`mazeRankings/${owner.uid}`, owner.token, 'PUT', {
      ...ownerRanking,
      wins: 2,
      played: 2,
      rating: 1040,
      settlementCount: 2,
      updatedAt: Date.now(),
    })
  );
  await expectDenied(
    'single-winner match cannot be claimed as a draw',
    databaseRequest(`mazeRankings/${outsider.uid}`, outsider.token, 'PUT', {
      uid: outsider.uid,
      displayName: 'Outsider',
      wins: 0,
      losses: 0,
      draws: 1,
      played: 1,
      rating: 1000,
      bestMoves: 0,
      lastRoomId: roomId,
      lastMatchNumber: 1,
      updatedAt: Date.now(),
      settlementCount: 1,
      settledMatches: { [`${roomId}:1`]: true },
      settlementTrail: `|${roomId}:1|`,
    })
  );
  const outsiderRanking = {
    uid: outsider.uid,
    displayName: 'Outsider',
    wins: 0,
    losses: 1,
    draws: 0,
    played: 1,
    rating: 988,
    bestMoves: 0,
    lastRoomId: roomId,
    lastMatchNumber: 1,
    updatedAt: Date.now(),
    settlementCount: 1,
    settledMatches: { [`${roomId}:1`]: true },
    settlementTrail: `|${roomId}:1|`,
  };
  await expectAllowed(
    'another participant may settle the exact loser ranking',
    databaseRequest(`mazeRankings/${outsider.uid}`, owner.token, 'PUT', outsiderRanking)
  );
  await expectDenied(
    'another user cannot rewrite a ranking entry',
    databaseRequest(`mazeRankings/${owner.uid}`, outsider.token, 'PUT', ownerRanking)
  );
  await expectDenied(
    'ranking entries cannot be deleted to reset rating or settlement markers',
    databaseRequest(`mazeRankings/${owner.uid}`, owner.token, 'DELETE')
  );
  await expectDenied(
    'ranking cannot claim an unrecorded room match number',
    databaseRequest(`mazeRankings/${owner.uid}`, owner.token, 'PUT', {
      ...ownerRanking,
      wins: 2,
      played: 2,
      rating: 1040,
      lastMatchNumber: 2,
      settlementCount: 2,
      updatedAt: Date.now(),
      settledMatches: {
        ...ownerRanking.settledMatches,
        [`${roomId}:2`]: true,
      },
      settlementTrail: `${ownerRanking.settlementTrail}${roomId}:2|`,
    })
  );

  const alternateRoomId = `alternate-${Date.now()}`;
  await expectAllowed(
    'alternate match room creation',
    databaseRequest(`rooms/${alternateRoomId}`, owner.token, 'PUT', createRoomPayload(owner.uid, canonical))
  );
  await expectAllowed(
    'alternate match map setup',
    databaseRequest(`rooms/${alternateRoomId}`, owner.token, 'PATCH', {
      [`maps/${owner.uid}`]: validMap(),
      [`gameState/players/${owner.uid}/isReady`]: true,
    })
  );
  const alternateSetup = await databaseRequest(`rooms/${alternateRoomId}/gameState`, owner.token, 'GET');
  const alternatePlay = {
    ...alternateSetup.payload,
    matchNumber: 1,
    phase: 'play',
    turnNumber: 1,
    currentTurn: owner.uid,
    turnOrder: [owner.uid],
    assignments: { [owner.uid]: owner.uid },
    itemState: { [owner.uid]: { type: 'radar' } },
    players: {
      [owner.uid]: {
        ...alternateSetup.payload.players[owner.uid],
        position: { row: 5, col: 4 },
        isReady: true,
        finished: false,
        forfeited: false,
        moves: 0,
      },
    },
  };
  await expectAllowed(
    'alternate match starts',
    databaseRequest(`rooms/${alternateRoomId}/gameState`, owner.token, 'PUT', alternatePlay)
  );
  const alternateEnd = clone(alternatePlay);
  alternateEnd.phase = 'end';
  alternateEnd.currentTurn = null;
  alternateEnd.turnNumber = 2;
  alternateEnd.winner = owner.uid;
  alternateEnd.players[owner.uid].position = { row: 5, col: 5 };
  alternateEnd.players[owner.uid].finished = true;
  alternateEnd.players[owner.uid].finishMoves = 1;
  alternateEnd.players[owner.uid].moves = 1;
  await expectAllowed(
    'alternate match finishes legally',
    databaseRequest(`rooms/${alternateRoomId}/gameState`, owner.token, 'PUT', alternateEnd)
  );
  const alternateRanking = {
    ...ownerRanking,
    wins: 2,
    played: 2,
    rating: 1040,
    bestMoves: 1,
    lastRoomId: alternateRoomId,
    settlementCount: 2,
    updatedAt: Date.now(),
    settledMatches: {
      ...ownerRanking.settledMatches,
      [`${alternateRoomId}:1`]: true,
    },
    settlementTrail: `${ownerRanking.settlementTrail}${alternateRoomId}:1|`,
  };
  await expectDenied(
    'alternate settlement cannot drop an old marker to enable replay',
    databaseRequest(`mazeRankings/${owner.uid}`, owner.token, 'PUT', {
      ...alternateRanking,
      settledMatches: { [`${alternateRoomId}:1`]: true },
    })
  );
  await expectAllowed(
    'alternate settlement appends its immutable replay trail',
    databaseRequest(`mazeRankings/${owner.uid}`, owner.token, 'PUT', alternateRanking)
  );

  const drawRoomId = `draw-${Date.now()}`;
  await expectAllowed(
    'draw settlement room creation',
    databaseRequest(`rooms/${drawRoomId}`, owner.token, 'PUT', createRoomPayload(owner.uid, canonical))
  );
  await expectAllowed(
    'owner marks per-connection presence ready',
    databaseRequest(`rooms/${drawRoomId}/ownerPresenceReady`, owner.token, 'PUT', true)
  );
  await expectAllowed(
    'owner registers the active room connection',
    databaseRequest(`rooms/${drawRoomId}/connections/${owner.uid}/0`, owner.token, 'PUT', {
      connectedAt: Date.now(),
      lastSeen: Date.now(),
      session: 'rules-owner-primary',
    })
  );
  await expectDenied(
    'non-member cannot create a room connection',
    databaseRequest(`rooms/${drawRoomId}/connections/${outsider.uid}/0`, outsider.token, 'PUT', {
      connectedAt: Date.now(),
      lastSeen: Date.now(),
      session: 'rules-outsider',
    })
  );
  await expectDenied(
    'room connection slots are capped at eight per user',
    databaseRequest(`rooms/${drawRoomId}/connections/${owner.uid}/8`, owner.token, 'PUT', {
      connectedAt: Date.now(),
      lastSeen: Date.now(),
      session: 'rules-owner-overflow',
    })
  );
  await expectAllowed(
    'draw target claims a setup roster slot',
    databaseRequest(`rooms/${drawRoomId}/players/1`, drawTarget.token, 'PUT', drawTarget.uid)
  );
  await expectAllowed(
    'draw target joins setup after claiming a slot',
    databaseRequest(`rooms/${drawRoomId}/gameState/players/${drawTarget.uid}`, drawTarget.token, 'PUT', {
      id: drawTarget.uid,
      position: { row: 0, col: 0 },
      isReady: true,
    })
  );
  const drawSetup = await databaseRequest(`rooms/${drawRoomId}/gameState`, owner.token, 'GET');
  const drawPlay = {
    ...drawSetup.payload,
    matchNumber: 1,
    phase: 'play',
    turnNumber: 1,
    currentTurn: owner.uid,
    turnOrder: [owner.uid, drawTarget.uid],
    assignments: { [owner.uid]: drawTarget.uid, [drawTarget.uid]: owner.uid },
    itemState: { [owner.uid]: { type: 'radar' }, [drawTarget.uid]: { type: 'radar' } },
    players: {
      [owner.uid]: {
        ...drawSetup.payload.players[owner.uid],
        isReady: true,
        finished: false,
        forfeited: false,
        moves: 0,
      },
      [drawTarget.uid]: {
        ...drawSetup.payload.players[drawTarget.uid],
        finished: false,
        forfeited: true,
        moves: 0,
      },
    },
  };
  await expectAllowed(
    'draw settlement match starts',
    databaseRequest(`rooms/${drawRoomId}/gameState`, owner.token, 'PUT', drawPlay)
  );
  const drawEnd = clone(drawPlay);
  drawEnd.phase = 'end';
  drawEnd.currentTurn = null;
  drawEnd.draw = true;
  drawEnd.players[owner.uid].forfeited = true;
  await expectAllowed(
    'all-forfeit match ends as a global draw',
    databaseRequest(`rooms/${drawRoomId}/gameState`, owner.token, 'PUT', drawEnd)
  );
  await expectAllowed(
    'participant may settle another participant in a global draw',
    databaseRequest(`mazeRankings/${drawTarget.uid}`, owner.token, 'PUT', {
      uid: drawTarget.uid,
      displayName: 'Draw Target',
      wins: 0,
      losses: 0,
      draws: 1,
      played: 1,
      rating: 1000,
      bestMoves: 0,
      lastRoomId: drawRoomId,
      lastMatchNumber: 1,
      updatedAt: Date.now(),
      settlementCount: 1,
      settledMatches: { [`${drawRoomId}:1`]: true },
      settlementTrail: `|${drawRoomId}:1|`,
    })
  );
  await expectAllowed(
    'owner global disconnect state is recorded independently from the room',
    databaseRequest(`userStatus/${owner.uid}/online`, owner.token, 'PUT', false)
  );
  await expectAllowed(
    'owner room connection is removed on disconnect',
    databaseRequest(`rooms/${drawRoomId}/connections/${owner.uid}/0`, owner.token, 'DELETE')
  );
  await expectAllowed(
    'owner disconnect records a server-authorized cleanup lease',
    databaseRequest(`rooms/${drawRoomId}/ownerDisconnectedAt`, owner.token, 'PUT', Date.now())
  );
  await expectDenied(
    'participant cannot clean up an offline-owner room during reconnect grace',
    databaseRequest(`rooms/${drawRoomId}`, drawTarget.token, 'DELETE')
  );
  await new Promise((resolve) => setTimeout(resolve, 2_600));
  await expectDenied(
    'offline-owner END room remains until every ranking is settled',
    databaseRequest(`rooms/${drawRoomId}`, drawTarget.token, 'DELETE')
  );
  await expectAllowed(
    'participant settles the offline owner before cleanup',
    databaseRequest(`mazeRankings/${owner.uid}`, drawTarget.token, 'PUT', {
      ...alternateRanking,
      draws: 1,
      played: 3,
      lastRoomId: drawRoomId,
      lastMatchNumber: 1,
      updatedAt: Date.now(),
      settlementCount: 3,
      settledMatches: {
        ...alternateRanking.settledMatches,
        [`${drawRoomId}:1`]: true,
      },
      settlementTrail: `${alternateRanking.settlementTrail}${drawRoomId}:1|`,
    })
  );
  await expectAllowed(
    'owner reconnect is visible independently from the ended room',
    databaseRequest(`userStatus/${owner.uid}/online`, owner.token, 'PUT', true)
  );
  await expectAllowed(
    'owner reconnect registers a new active tab connection',
    databaseRequest(`rooms/${drawRoomId}/connections/${owner.uid}/1`, owner.token, 'PUT', {
      connectedAt: Date.now(),
      lastSeen: Date.now(),
      session: 'rules-owner-secondary',
    })
  );
  await expectAllowed(
    'owner reconnect clears the disconnect cleanup lease',
    databaseRequest(`rooms/${drawRoomId}/ownerDisconnectedAt`, owner.token, 'DELETE')
  );
  await expectDenied(
    'participant cannot remove a settled END room while its owner is online',
    databaseRequest(`rooms/${drawRoomId}`, drawTarget.token, 'DELETE')
  );
  await expectAllowed(
    'owner disconnect is visible independently from the ended room',
    databaseRequest(`userStatus/${owner.uid}/online`, owner.token, 'PUT', false)
  );
  await expectAllowed(
    'last owner tab connection disappears',
    databaseRequest(`rooms/${drawRoomId}/connections/${owner.uid}/1`, owner.token, 'DELETE')
  );
  await expectAllowed(
    'last owner tab disconnect renews the cleanup lease',
    databaseRequest(`rooms/${drawRoomId}/ownerDisconnectedAt`, owner.token, 'PUT', Date.now())
  );
  await new Promise((resolve) => setTimeout(resolve, 2_600));
  await expectAllowed(
    'participant cleans up the fully settled END room after owner disconnect',
    databaseRequest(`rooms/${drawRoomId}`, drawTarget.token, 'DELETE')
  );

  const endedRestartState = await databaseRequest(`rooms/${roomId}/gameState`, owner.token, 'GET');
  const resetRestartState = {
    ...endedRestartState.payload,
    phase: 'setup',
    winner: null,
    draw: null,
    currentTurn: owner.uid,
    turnOrder: [owner.uid],
    players: {
      [owner.uid]: {
        ...endedRestartState.payload.players[owner.uid],
        isReady: false,
        finished: false,
        forfeited: false,
        hasLeft: false,
        moves: 0,
      },
    },
  };
  await expectAllowed(
    'owner may restart only after every ranking marker is settled',
    databaseRequest(`rooms/${roomId}`, owner.token, 'PATCH', {
      maps: null,
      'players/0': owner.uid,
      'players/1': null,
      gameState: resetRestartState,
      status: 'waiting',
    })
  );
  const clearedMaps = await databaseRequest(`rooms/${roomId}/maps`, owner.token, 'GET');
  assert.equal(clearedMaps.payload, null, 'restart must clear sibling maps');
  const restartedState = await databaseRequest(`rooms/${roomId}/gameState`, owner.token, 'GET');
  assert.equal(restartedState.payload.phase, 'setup', 'restart must return to setup atomically');

  const capacityRoomId = `capacity-${Date.now()}`;
  const capacityRoom = createRoomPayload(owner.uid, canonical);
  capacityRoom.maxPlayers = 2;
  await expectAllowed(
    'two-player capacity room creation',
    databaseRequest(`rooms/${capacityRoomId}`, owner.token, 'PUT', capacityRoom)
  );
  await expectAllowed(
    'second player claims the final configured room slot',
    databaseRequest(`rooms/${capacityRoomId}/players/1`, outsider.token, 'PUT', outsider.uid)
  );
  await expectAllowed(
    'second player fills the configured room capacity',
    databaseRequest(`rooms/${capacityRoomId}/gameState/players/${outsider.uid}`, outsider.token, 'PUT', {
      id: outsider.uid,
      position: { row: 0, col: 0 },
      isReady: false,
    })
  );
  await expectDenied(
    'a concurrent third player cannot exceed the configured room capacity',
    databaseRequest(`rooms/${capacityRoomId}/players/2`, drawTarget.token, 'PUT', drawTarget.uid)
  );

  const tampered = clone(canonical);
  tampered.itemCosts.fireWall = 9;
  await expectDenied(
    'tampered room snapshot',
    databaseRequest(
      `rooms/tampered-${Date.now()}`,
      owner.token,
      'PUT',
      createRoomPayload(owner.uid, tampered)
    )
  );
  const missingSnapshotRoom = createRoomPayload(owner.uid, canonical);
  delete missingSnapshotRoom.ruleSnapshot;
  await expectDenied(
    'missing room snapshot',
    databaseRequest(
      `rooms/missing-${Date.now()}`,
      owner.token,
      'PUT',
      missingSnapshotRoom
    )
  );

  const legacyAdventureNow = Date.now();
  const legacyAdventureState = adventure.createInitialState('vanguard', 'Legacy Skill Adventurer', legacyAdventureNow);
  const legacyGear = adventure.generateGear({
    classId: 'vanguard', regionId: 'sunnyField', level: 1, slot: 'weapon', forcedTier: 'normal', now: legacyAdventureNow, rng: () => 0,
  });
  for (const key of ['tier', 'itemLevel', 'socketCount', 'socketedRunes', 'setId', 'uniqueId']) delete legacyGear[key];
  const legacyAdventure = {
    ...legacyAdventureState,
    skillRanks: { skill1: 1, skill2: 0 },
    inventory: [legacyGear],
    rankingPower: adventure.deriveStats(legacyAdventureState).power,
    rankingCollectionCount: 0,
  };
  delete legacyAdventure.runeInventory;
  delete legacyAdventure.skillLoadout;
  delete legacyAdventure.town;
  await expectAllowed(
    'v1 adventure save with legacy skills, gear, no rune inventory, and no town remains valid',
    databaseRequest(`users/${drawTarget.uid}/adventure/v1`, drawTarget.token, 'PUT', legacyAdventure)
  );
  await expectDenied(
    'expanded skill ranks reject values above the maximum',
    databaseRequest(`users/${drawTarget.uid}/adventure/v1`, drawTarget.token, 'PUT', {
      ...legacyAdventure,
      skillRanks: { ...legacyAdventure.skillRanks, skill6: 11 },
      updatedAt: legacyAdventureNow + 1,
      lastActiveAt: legacyAdventureNow + 1,
    })
  );
  await expectDenied(
    'expanded skill ranks reject unknown slots',
    databaseRequest(`users/${drawTarget.uid}/adventure/v1`, drawTarget.token, 'PUT', {
      ...legacyAdventure,
      skillRanks: { ...legacyAdventure.skillRanks, skill7: 1 },
      updatedAt: legacyAdventureNow + 2,
      lastActiveAt: legacyAdventureNow + 2,
    })
  );
  await expectAllowed(
    'v1 adventure save can add the four expanded skill ranks',
    databaseRequest(`users/${drawTarget.uid}/adventure/v1`, drawTarget.token, 'PUT', {
      ...legacyAdventure,
      skillRanks: { skill1: 1, skill2: 0, skill3: 0, skill4: 0, skill5: 0, skill6: 0 },
      updatedAt: legacyAdventureNow + 3,
      lastActiveAt: legacyAdventureNow + 3,
    })
  );
  await expectAllowed(
    'adventure save accepts an ordered six-slot skill loadout',
    databaseRequest(`users/${drawTarget.uid}/adventure/v1`, drawTarget.token, 'PUT', {
      ...legacyAdventure,
      skillRanks: { skill1: 1, skill2: 1, skill3: 1, skill4: 0, skill5: 0, skill6: 0 },
      skillLoadout: ['skill3', 'skill1', 'skill2'],
      updatedAt: legacyAdventureNow + 4,
      lastActiveAt: legacyAdventureNow + 4,
    })
  );
  await expectDenied(
    'adventure skill loadout rejects unknown skills',
    databaseRequest(`users/${drawTarget.uid}/adventure/v1`, drawTarget.token, 'PUT', {
      ...legacyAdventure,
      skillLoadout: ['skill1', 'teleport'],
      updatedAt: legacyAdventureNow + 5,
      lastActiveAt: legacyAdventureNow + 5,
    })
  );
  await expectDenied(
    'adventure skill loadout rejects more than six slots',
    databaseRequest(`users/${drawTarget.uid}/adventure/v1`, drawTarget.token, 'PUT', {
      ...legacyAdventure,
      skillLoadout: ['skill1', 'skill2', 'skill3', 'skill4', 'skill5', 'skill6', 'skill1'],
      updatedAt: legacyAdventureNow + 6,
      lastActiveAt: legacyAdventureNow + 6,
    })
  );

  const socketedGear = adventure.generateGear({
    classId: 'vanguard', regionId: 'sunnyField', level: 30, slot: 'weapon', forcedTier: 'normal', now: legacyAdventureNow, rng: () => 0,
  });
  socketedGear.socketedRunes = ['void', 'ember'];
  const runeInventory = Object.fromEntries(adventure.RUNE_IDS.map((runeId) => [runeId, runeId === 'dusk' ? 2 : 0]));
  const socketAdventure = {
    ...legacyAdventure,
    skillRanks: { skill1: 1, skill2: 0, skill3: 0, skill4: 0, skill5: 0, skill6: 0 },
    inventory: [socketedGear],
    runeInventory,
    updatedAt: legacyAdventureNow + 4,
    lastActiveAt: legacyAdventureNow + 4,
  };
  await expectAllowed(
    'typed item tier, item level, ordered sockets, and rune inventory are persisted',
    databaseRequest(`users/${drawTarget.uid}/adventure/v1`, drawTarget.token, 'PUT', socketAdventure)
  );
  await expectDenied(
    'item tier must agree with the legacy rarity used by existing UI clients',
    databaseRequest(`users/${drawTarget.uid}/adventure/v1`, drawTarget.token, 'PUT', {
      ...socketAdventure,
      inventory: [{ ...socketedGear, tier: 'unique' }],
      updatedAt: legacyAdventureNow + 5,
    })
  );
  await expectDenied(
    'ordered socket payload rejects unknown runes',
    databaseRequest(`users/${drawTarget.uid}/adventure/v1`, drawTarget.token, 'PUT', {
      ...socketAdventure,
      inventory: [{ ...socketedGear, socketedRunes: ['void', 'not-a-rune'] }],
      updatedAt: legacyAdventureNow + 5,
    })
  );
  await expectDenied(
    'socket payload cannot exceed the declared capacity',
    databaseRequest(`users/${drawTarget.uid}/adventure/v1`, drawTarget.token, 'PUT', {
      ...socketAdventure,
      inventory: [{ ...socketedGear, socketCount: 1 }],
      updatedAt: legacyAdventureNow + 5,
    })
  );
  await expectDenied(
    'rune stacks are capped by the save schema',
    databaseRequest(`users/${drawTarget.uid}/adventure/v1`, drawTarget.token, 'PUT', {
      ...socketAdventure,
      runeInventory: { ...runeInventory, crown: 1_000 },
      updatedAt: legacyAdventureNow + 5,
    })
  );
  await expectDenied(
    'rune inventory rejects unknown keys',
    databaseRequest(`users/${drawTarget.uid}/adventure/v1`, drawTarget.token, 'PUT', {
      ...socketAdventure,
      runeInventory: { ...runeInventory, forgedRune: 1 },
      updatedAt: legacyAdventureNow + 5,
    })
  );

  const adventureNow = Date.now();
  const adventureState = adventure.createInitialState('ranger', 'Rules Adventurer', adventureNow);
  const adventurePower = adventure.deriveStats(adventureState).power;
  const persistedAdventure = {
    ...adventureState,
    rankingPower: adventurePower,
    rankingCollectionCount: 0,
  };
  const adventureRanking = {
    uid: owner.uid,
    displayName: adventureState.name,
    classId: adventureState.classId,
    resetGeneration: adventureState.resetGeneration,
    level: adventureState.level,
    masteryLevel: adventureState.mastery.level,
    power: adventurePower,
    totalKills: adventureState.statistics.totalKills,
    bossesKilled: adventureState.statistics.bossesKilled,
    collectionCount: 0,
    updatedAt: adventureNow,
  };
  await expectAllowed(
    'adventure state and public ranking save atomically',
    databaseRequest('', owner.token, 'PATCH', {
      [`users/${owner.uid}/adventure/v1`]: persistedAdventure,
      [`adventureRankings/${owner.uid}`]: adventureRanking,
    })
  );
  const initialTown = adventureTown.createInitialTownState(persistedAdventure, adventureNow);
  const townAdventure = {
    ...persistedAdventure,
    town: initialTown,
    updatedAt: adventureNow + 1,
    lastActiveAt: adventureNow + 1,
  };
  await expectAllowed(
    'adventure save accepts a validated town hub state',
    databaseRequest(`users/${owner.uid}/adventure/v1`, owner.token, 'PUT', townAdventure)
  );
  await expectAllowed(
    'sold-out merchant stock survives Firebase as an absent array with an explicit marker',
    databaseRequest(`users/${owner.uid}/adventure/v1`, owner.token, 'PUT', {
      ...townAdventure,
      town: { ...initialTown, merchantStock: [], merchantSoldOut: true },
      updatedAt: adventureNow + 2,
      lastActiveAt: adventureNow + 2,
    })
  );
  const soldOutRoundTrip = await databaseRequest(`users/${owner.uid}/adventure/v1`, owner.token, 'GET');
  assert.equal(soldOutRoundTrip.ok, true, 'sold-out town state remains readable');
  assert.equal(soldOutRoundTrip.payload.town.merchantSoldOut, true);
  assert.equal(soldOutRoundTrip.payload.town.merchantStock, undefined, 'RTDB removes the empty merchant array');
  await expectDenied(
    'town state rejects an unknown location',
    databaseRequest(`users/${owner.uid}/adventure/v1`, owner.token, 'PUT', {
      ...townAdventure,
      town: { ...initialTown, location: 'dungeon' },
      updatedAt: adventureNow + 2,
      lastActiveAt: adventureNow + 2,
    })
  );
  await expectDenied(
    'town sold-out marker must be boolean',
    databaseRequest(`users/${owner.uid}/adventure/v1`, owner.token, 'PUT', {
      ...townAdventure,
      town: { ...initialTown, merchantSoldOut: 'yes' },
      updatedAt: adventureNow + 2,
      lastActiveAt: adventureNow + 2,
    })
  );
  await expectDenied(
    'town sold-out marker cannot hide remaining merchant stock',
    databaseRequest(`users/${owner.uid}/adventure/v1`, owner.token, 'PUT', {
      ...townAdventure,
      town: { ...initialTown, merchantSoldOut: true },
      updatedAt: adventureNow + 2,
      lastActiveAt: adventureNow + 2,
    })
  );
  await expectDenied(
    'town waypoint destination must match the active region',
    databaseRequest(`users/${owner.uid}/adventure/v1`, owner.token, 'PUT', {
      ...townAdventure,
      town: { ...initialTown, lastFieldRegionId: 'mistForest' },
      updatedAt: adventureNow + 2,
      lastActiveAt: adventureNow + 2,
    })
  );
  await expectDenied(
    'town identifier must match its waypoint region',
    databaseRequest(`users/${owner.uid}/adventure/v1`, owner.token, 'PUT', {
      ...townAdventure,
      town: { ...initialTown, townId: 'mistForest-town' },
      updatedAt: adventureNow + 2,
      lastActiveAt: adventureNow + 2,
    })
  );
  await expectDenied(
    'town waypoint cannot select a level-locked active region',
    databaseRequest(`users/${owner.uid}/adventure/v1`, owner.token, 'PUT', {
      ...townAdventure,
      currentRegionId: 'mistForest',
      town: { ...initialTown, townId: 'mistForest-town', lastFieldRegionId: 'mistForest' },
      updatedAt: adventureNow + 2,
      lastActiveAt: adventureNow + 2,
    })
  );
  await expectDenied(
    'town merchant stock cannot exceed eight items',
    databaseRequest(`users/${owner.uid}/adventure/v1`, owner.token, 'PUT', {
      ...townAdventure,
      town: {
        ...initialTown,
        merchantStock: [
          ...initialTown.merchantStock,
          { ...initialTown.merchantStock[0], instanceId: 'rules-merchant-extra' },
        ],
      },
      updatedAt: adventureNow + 2,
      lastActiveAt: adventureNow + 2,
    })
  );
  const oversizedStash = Array.from({ length: 121 }, (_, index) => ({
    ...initialTown.merchantStock[0],
    instanceId: `rules-stash-${index}`,
  }));
  await expectDenied(
    'town stash cannot exceed one hundred twenty items',
    databaseRequest(`users/${owner.uid}/adventure/v1`, owner.token, 'PUT', {
      ...townAdventure,
      town: { ...initialTown, stash: oversizedStash },
      updatedAt: adventureNow + 2,
      lastActiveAt: adventureNow + 2,
    })
  );
  await expectDenied(
    'an arena checkpoint cannot be created while the character is in town',
    databaseRequest(`users/${owner.uid}/adventure/v1`, owner.token, 'PUT', {
      ...townAdventure,
      arenaCheckpoint: {
        runId: 'rules-town-arena-run',
        checkpoint: 1,
        wave: 1,
        totalWaves: 5,
        outcome: 'ongoing',
      },
      updatedAt: adventureNow + 2,
      lastActiveAt: adventureNow + 2,
    })
  );
  const checkpointAdventure = {
    ...townAdventure,
    town: { ...initialTown, location: 'wilderness' },
    arenaCheckpoint: {
      runId: 'rules-arena-run',
      checkpoint: 1,
      wave: 1,
      totalWaves: 5,
      outcome: 'ongoing',
    },
    updatedAt: adventureNow + 3,
    lastActiveAt: adventureNow + 3,
  };
  await expectAllowed(
    'first arena checkpoint is persisted with the private character',
    databaseRequest(`users/${owner.uid}/adventure/v1`, owner.token, 'PUT', checkpointAdventure)
  );
  await expectDenied(
    'an ongoing arena checkpoint cannot be replaced by a different run ID',
    databaseRequest(`users/${owner.uid}/adventure/v1`, owner.token, 'PUT', {
      ...checkpointAdventure,
      arenaCheckpoint: {
        ...checkpointAdventure.arenaCheckpoint,
        runId: 'rules-replayed-arena-run',
      },
      updatedAt: adventureNow + 4,
      lastActiveAt: adventureNow + 4,
    })
  );
  await expectAllowed(
    'an unchanged arena checkpoint may be carried by a later character save',
    databaseRequest(`users/${owner.uid}/adventure/v1`, owner.token, 'PUT', {
      ...checkpointAdventure,
      updatedAt: adventureNow + 4,
      lastActiveAt: adventureNow + 4,
    })
  );
  await expectDenied(
    'coalesced checkpoints cannot advance waves faster than their checkpoint delta',
    databaseRequest(`users/${owner.uid}/adventure/v1`, owner.token, 'PUT', {
      ...checkpointAdventure,
      arenaCheckpoint: { ...checkpointAdventure.arenaCheckpoint, checkpoint: 3, wave: 4 },
      updatedAt: adventureNow + 5,
    })
  );
  await expectDenied(
    'an arena checkpoint cannot jump more than one wave',
    databaseRequest(`users/${owner.uid}/adventure/v1`, owner.token, 'PUT', {
      ...checkpointAdventure,
      arenaCheckpoint: { ...checkpointAdventure.arenaCheckpoint, checkpoint: 2, wave: 3 },
      updatedAt: adventureNow + 5,
    })
  );
  await expectDenied(
    'a new arena run cannot begin after wave one',
    databaseRequest(`users/${owner.uid}/adventure/v1`, owner.token, 'PUT', {
      ...checkpointAdventure,
      arenaCheckpoint: {
        ...checkpointAdventure.arenaCheckpoint,
        runId: 'rules-skipped-arena-run',
        wave: 3,
      },
      updatedAt: adventureNow + 5,
    })
  );
  await expectDenied(
    'an existing arena checkpoint cannot be erased by a stale character save',
    databaseRequest(`users/${owner.uid}/adventure/v1`, owner.token, 'PUT', {
      ...checkpointAdventure,
      arenaCheckpoint: null,
      updatedAt: adventureNow + 5,
    })
  );
  await expectDenied(
    'arena checkpoint schema rejects unrecognized fields',
    databaseRequest(`users/${owner.uid}/adventure/v1`, owner.token, 'PUT', {
      ...checkpointAdventure,
      arenaCheckpoint: { ...checkpointAdventure.arenaCheckpoint, unexpected: true },
      updatedAt: adventureNow + 5,
    })
  );
  const advancedCheckpointAdventure = {
    ...checkpointAdventure,
    arenaCheckpoint: { ...checkpointAdventure.arenaCheckpoint, checkpoint: 2, wave: 2 },
    updatedAt: adventureNow + 5,
    lastActiveAt: adventureNow + 5,
  };
  await expectAllowed(
    'the next arena checkpoint advances exactly once',
    databaseRequest(`users/${owner.uid}/adventure/v1`, owner.token, 'PUT', advancedCheckpointAdventure)
  );
  await expectDenied(
    'an older checkpoint cannot replay after the run advances',
    databaseRequest(`users/${owner.uid}/adventure/v1`, owner.token, 'PUT', checkpointAdventure)
  );
  const coalescedCheckpointAdventure = {
    ...advancedCheckpointAdventure,
    arenaCheckpoint: { ...advancedCheckpointAdventure.arenaCheckpoint, checkpoint: 4, wave: 3 },
    updatedAt: adventureNow + 6,
    lastActiveAt: adventureNow + 6,
  };
  await expectAllowed(
    'multiple locally settled kills may coalesce into one monotonic Firebase save',
    databaseRequest(`users/${owner.uid}/adventure/v1`, owner.token, 'PUT', coalescedCheckpointAdventure)
  );
  await expectAllowed(
    'returning to town may atomically clear the active arena checkpoint',
    databaseRequest(`users/${owner.uid}/adventure/v1`, owner.token, 'PUT', {
      ...coalescedCheckpointAdventure,
      town: { ...coalescedCheckpointAdventure.town, location: 'town' },
      arenaCheckpoint: null,
      updatedAt: adventureNow + 7,
      lastActiveAt: adventureNow + 7,
    })
  );
  const initialCoalescedCheckpointAdventure = {
    ...townAdventure,
    town: { ...initialTown, location: 'wilderness' },
    arenaCheckpoint: {
      runId: 'rules-initial-coalesced-run',
      checkpoint: 2,
      wave: 1,
      totalWaves: 1,
      outcome: 'ongoing',
    },
    updatedAt: adventureNow + 8,
    lastActiveAt: adventureNow + 8,
  };
  await expectAllowed(
    'the first Firebase checkpoint may contain multiple same-frame kills',
    databaseRequest(`users/${owner.uid}/adventure/v1`, owner.token, 'PUT', initialCoalescedCheckpointAdventure)
  );
  const defeatedCoalescedCheckpointAdventure = {
    ...initialCoalescedCheckpointAdventure,
    arenaCheckpoint: {
      ...initialCoalescedCheckpointAdventure.arenaCheckpoint,
      checkpoint: 3,
      outcome: 'defeat',
    },
    updatedAt: adventureNow + 9,
    lastActiveAt: adventureNow + 9,
  };
  await expectAllowed(
    'the coalesced run can settle its next checkpoint as a defeat',
    databaseRequest(`users/${owner.uid}/adventure/v1`, owner.token, 'PUT', defeatedCoalescedCheckpointAdventure)
  );
  await expectAllowed(
    'the first save of a restarted run may also contain multiple same-frame kills',
    databaseRequest(`users/${owner.uid}/adventure/v1`, owner.token, 'PUT', {
      ...defeatedCoalescedCheckpointAdventure,
      arenaCheckpoint: {
        ...defeatedCoalescedCheckpointAdventure.arenaCheckpoint,
        runId: 'rules-restarted-coalesced-run',
        checkpoint: 2,
        outcome: 'ongoing',
      },
      updatedAt: adventureNow + 10,
      lastActiveAt: adventureNow + 10,
    })
  );
  await expectDenied(
    'other users cannot read a private adventure character',
    databaseRequest(`users/${owner.uid}/adventure/v1`, outsider.token, 'GET')
  );
  await expectDenied(
    'other users cannot overwrite an adventure character',
    databaseRequest(`users/${owner.uid}/adventure/v1`, outsider.token, 'PUT', persistedAdventure)
  );
  await expectDenied(
    'adventure ranking cannot disagree with the persisted character',
    databaseRequest(`adventureRankings/${owner.uid}`, owner.token, 'PUT', {
      ...adventureRanking,
      power: adventurePower + 1,
      updatedAt: adventureNow + 1,
    })
  );
  await expectDenied(
    'an older adventure save cannot overwrite newer progress',
    databaseRequest(`users/${owner.uid}/adventure/v1`, owner.token, 'PUT', {
      ...persistedAdventure,
      updatedAt: adventureNow - 1,
    })
  );
  await expectDenied(
    'adventure reset generation cannot advance without clearing state and ranking',
    databaseRequest(`users/${owner.uid}/adventureGeneration`, owner.token, 'PUT', 1)
  );
  await expectDenied(
    'adventure reset generation cannot skip forward',
    databaseRequest('', owner.token, 'PATCH', {
      [`users/${owner.uid}/adventureGeneration`]: 2,
      [`users/${owner.uid}/adventure/v1`]: null,
      [`adventureRankings/${owner.uid}`]: null,
    })
  );
  await expectAllowed(
    'adventure reset atomically advances one generation and clears state and ranking',
    databaseRequest('', owner.token, 'PATCH', {
      [`users/${owner.uid}/adventureGeneration`]: 1,
      [`users/${owner.uid}/adventure/v1`]: null,
      [`adventureRankings/${owner.uid}`]: null,
    })
  );
  await expectDenied(
    'a previous-generation save cannot resurrect the character',
    databaseRequest(`users/${owner.uid}/adventure/v1`, owner.token, 'PUT', persistedAdventure)
  );
  const nextGenerationAdventure = {
    ...persistedAdventure,
    resetGeneration: 1,
    updatedAt: adventureNow + 1,
    lastActiveAt: adventureNow + 1,
  };
  const nextGenerationRanking = {
    ...adventureRanking,
    resetGeneration: 1,
    updatedAt: adventureNow + 1,
  };
  await expectAllowed(
    'a new character and ranking save in the current reset generation',
    databaseRequest('', owner.token, 'PATCH', {
      [`users/${owner.uid}/adventure/v1`]: nextGenerationAdventure,
      [`adventureRankings/${owner.uid}`]: nextGenerationRanking,
    })
  );
  const presence = (connectionId) => ({
    uid: owner.uid,
    displayName: `Rules Adventurer ${connectionId}`,
    connectedAt: Date.now(),
    lastSeen: Date.now(),
  });
  await expectAllowed(
    'first adventure tab registers presence',
    databaseRequest(`adventurePresence/${owner.uid}/0`, owner.token, 'PUT', presence('A'))
  );
  await expectAllowed(
    'second adventure tab registers presence independently',
    databaseRequest(`adventurePresence/${owner.uid}/1`, owner.token, 'PUT', presence('B'))
  );
  await expectDenied(
    'another user cannot forge adventure presence',
    databaseRequest(`adventurePresence/${owner.uid}/2`, outsider.token, 'PUT', presence('X'))
  );
  await expectDenied(
    'adventure presence slots are capped at eight per user',
    databaseRequest(`adventurePresence/${owner.uid}/8`, owner.token, 'PUT', presence('overflow'))
  );
  await expectDenied(
    'stale adventure presence cannot be registered permanently',
    databaseRequest(`adventurePresence/${owner.uid}/2`, owner.token, 'PUT', {
      ...presence('stale'),
      connectedAt: 0,
      lastSeen: 0,
    })
  );
  await expectAllowed(
    'one adventure tab disconnects without deleting the other',
    databaseRequest(`adventurePresence/${owner.uid}/0`, owner.token, 'DELETE')
  );
  const remainingPresence = await databaseRequest(`adventurePresence/${owner.uid}`, owner.token, 'GET');
  assert.deepEqual(
    Object.entries(remainingPresence.payload || {}).filter(([, value]) => value != null).map(([key]) => key),
    ['1'],
    'one adventure connection remains online'
  );
  await expectAllowed(
    'last adventure tab disconnects',
    databaseRequest(`adventurePresence/${owner.uid}/1`, owner.token, 'DELETE')
  );

  console.log('DATABASE RULES: maze turns/rankings and private adventure item/rune/state/ranking/presence validation passed');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
