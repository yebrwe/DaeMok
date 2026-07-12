#!/usr/bin/env node

'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');
const ts = require('typescript');

const ROOT = path.join(__dirname, '..');

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
const gameUtils = loadTypeScript('src/lib/gameUtils.ts', { '@/types/game': types });
const gameTurn = loadTypeScript('src/lib/gameTurn.ts', {
  '@/types/game': types,
  '@/lib/gameUtils': gameUtils,
  '@/lib/mazeSkills': mazeSkills,
});
const offlineTurn = loadTypeScript('src/lib/offlineTurn.ts', {
  '@/types/game': types,
  '@/lib/gameUtils': gameUtils,
});
const roomLifecycle = loadTypeScript('src/lib/roomLifecycle.ts', {
  '@/types/game': types,
});

const LAST_SEEN = 1_000_000;
const GRACE = offlineTurn.OFFLINE_TURN_FORFEIT_GRACE_MS;

function player(id, overrides = {}) {
  return {
    id,
    position: { row: 0, col: 0 },
    isReady: true,
    isOnline: true,
    finished: false,
    forfeited: false,
    moves: 0,
    ...overrides,
  };
}

function playState(overrides = {}) {
  return {
    rulesVersion: 3,
    matchNumber: 1,
    phase: types.GamePhase.PLAY,
    players: {
      a: player('a', { displayName: 'A', isOnline: false, lastSeen: LAST_SEEN }),
      b: player('b', { displayName: 'B' }),
      c: player('c', { displayName: 'C' }),
    },
    currentTurn: 'a',
    turnOrder: ['a', 'b', 'c'],
    ...overrides,
  };
}

const beforeGrace = offlineTurn.getOfflineTurnForfeitCandidate(
  playState(),
  'b',
  LAST_SEEN + GRACE - 1
);
assert.equal(beforeGrace.playerId, 'a');
assert.equal(beforeGrace.delayMs, 1, 'temporary disconnect keeps its turn during the grace period');
assert.equal(
  offlineTurn.applyOfflineTurnForfeit(playState(), 'a', 'b', LAST_SEEN + GRACE - 1),
  null,
  'a player cannot be forfeited before 45 seconds'
);

const reconnected = playState();
reconnected.players.a.isOnline = true;
assert.equal(
  offlineTurn.getOfflineTurnForfeitCandidate(reconnected, 'b', LAST_SEEN + GRACE),
  null,
  'reconnection cancels offline forfeiture'
);

const disconnectedObserver = playState();
disconnectedObserver.players.b.isOnline = false;
assert.equal(
  offlineTurn.getOfflineTurnForfeitCandidate(disconnectedObserver, 'b', LAST_SEEN + GRACE),
  null,
  'an offline participant cannot recover another turn'
);

const recovered = offlineTurn.applyOfflineTurnForfeit(
  playState(),
  'a',
  'b',
  LAST_SEEN + GRACE
);
assert.ok(recovered, 'eligible offline current player is forfeited');
assert.equal(recovered.players.a.forfeited, true);
assert.equal(recovered.currentTurn, 'b', 'turn advances using the canonical turn order');
assert.match(recovered.turnMessage, /45초간/);
assert.equal(
  offlineTurn.applyOfflineTurnForfeit(playState(), 'c', 'b', LAST_SEEN + GRACE),
  null,
  'a stale timer cannot forfeit a different current player'
);

const finalRecoveryInput = playState();
finalRecoveryInput.players.b = player('b', { finished: true, finishMoves: 8 });
finalRecoveryInput.players.c = player('c', { forfeited: true });
const finalRecovery = offlineTurn.applyOfflineTurnForfeit(
  finalRecoveryInput,
  'a',
  'b',
  LAST_SEEN + GRACE
);
const settled = gameTurn.settleCompletedGameState(finalRecovery);
assert.equal(settled.phase, types.GamePhase.END, 'offline recovery settles END when everyone is done');
assert.equal(settled.winner, 'b');
assert.equal(settled.currentTurn, null);

assert.equal(
  roomLifecycle.shouldPreserveGamePlayerOnLeave(types.GamePhase.END),
  true,
  'END player records remain available until idempotent stats settlement completes'
);
assert.equal(roomLifecycle.shouldPreserveGamePlayerOnLeave(types.GamePhase.PLAY), true);
assert.equal(
  roomLifecycle.shouldPreserveGamePlayerOnLeave(types.GamePhase.SETUP),
  false,
  'setup-only player records can be removed immediately'
);
assert.equal(
  roomLifecycle.shouldIncludeGamePlayerOnRestart(player('online')),
  true,
  'an online participant remains in the restart roster'
);
assert.equal(
  roomLifecycle.shouldIncludeGamePlayerOnRestart(player('offline', { isOnline: false })),
  false,
  'a disconnected participant is excluded from the restart roster'
);
assert.equal(
  roomLifecycle.shouldIncludeGamePlayerOnRestart(player('left', { hasLeft: true })),
  false,
  'a participant who left is excluded from the restart roster'
);

console.log('OFFLINE TURN: 45s grace, reconnect cancellation, atomic turn advance, END settlement, and record retention passed');
