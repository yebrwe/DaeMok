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
const GRACE = offlineTurn.OFFLINE_TURN_SKIP_GRACE_MS;

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

const beforeGrace = offlineTurn.getOfflineTurnSkipCandidate(
  playState(),
  'b',
  LAST_SEEN + GRACE - 1
);
assert.equal(beforeGrace.playerId, 'a');
assert.equal(beforeGrace.delayMs, 1, 'temporary disconnect keeps its turn during the grace period');
assert.equal(
  offlineTurn.applyOfflineTurnSkip(playState(), 'a', 'b', LAST_SEEN + GRACE - 1),
  null,
  'a player turn cannot be skipped before 45 seconds'
);

const reconnected = playState();
reconnected.players.a.isOnline = true;
assert.equal(
  offlineTurn.getOfflineTurnSkipCandidate(reconnected, 'b', LAST_SEEN + GRACE),
  null,
  'reconnection cancels the offline turn skip'
);

const disconnectedObserver = playState();
disconnectedObserver.players.b.isOnline = false;
assert.equal(
  offlineTurn.getOfflineTurnSkipCandidate(disconnectedObserver, 'b', LAST_SEEN + GRACE),
  null,
  'an offline participant cannot recover another turn'
);

const recovered = offlineTurn.applyOfflineTurnSkip(
  playState(),
  'a',
  'b',
  LAST_SEEN + GRACE
);
assert.ok(recovered, 'eligible offline current player turn is skipped');
assert.equal(recovered.players.a.forfeited, false, 'a turn skip never forfeits the runner');
assert.deepEqual(recovered.players.a.position, { row: 0, col: 0 });
assert.equal(recovered.players.a.moves, 0, 'a turn skip never fabricates a move');
assert.equal(recovered.currentTurn, 'b', 'turn advances using the canonical turn order');
assert.equal(recovered.turnNumber, 1);
assert.match(recovered.turnMessage, /턴을 넘겼습니다/);
assert.equal(
  offlineTurn.applyOfflineTurnSkip(playState(), 'c', 'b', LAST_SEEN + GRACE),
  null,
  'a stale timer cannot skip a different current player'
);

const finalRecoveryInput = playState();
finalRecoveryInput.players.b = player('b', { finished: true, finishMoves: 8 });
finalRecoveryInput.players.c = player('c', { forfeited: true });
const finalRecovery = offlineTurn.applyOfflineTurnSkip(
  finalRecoveryInput,
  'a',
  'b',
  LAST_SEEN + GRACE
);
assert.equal(finalRecovery, null, 'the final unfinished runner must reconnect and finish');
const unsettled = gameTurn.settleCompletedGameState(finalRecoveryInput);
assert.equal(unsettled.phase, types.GamePhase.PLAY, 'disconnect cannot settle the match');
assert.equal(unsettled.winner ?? null, null, 'disconnect cannot manufacture a winner');
assert.equal(unsettled.currentTurn, 'a');

assert.equal(
  roomLifecycle.shouldPreserveGamePlayerOnLeave(types.GamePhase.END),
  true,
  'END player records remain available until idempotent stats settlement completes'
);
assert.equal(roomLifecycle.shouldPreserveGamePlayerOnLeave(types.GamePhase.PLAY), true);
assert.equal(
  roomLifecycle.canLeaveRoomWithoutForfeit(types.GamePhase.PLAY, true),
  false,
  'a PLAY participant cannot leave through the legacy API either'
);
assert.equal(
  roomLifecycle.canLeaveRoomWithoutForfeit(types.GamePhase.PLAY, false),
  true,
  'a PLAY spectator can leave without changing the match'
);
assert.equal(
  roomLifecycle.canLeaveRoomWithoutForfeit(types.GamePhase.END, true),
  true,
  'a participant may leave after every runner has finished'
);
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

console.log('OFFLINE TURN: 45s grace, reconnect cancellation, non-forfeit turn skip, mandatory finish, and record retention passed');
