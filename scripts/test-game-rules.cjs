'use strict';

/* eslint-disable @typescript-eslint/no-require-imports */
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
const utils = loadTypeScript('src/lib/gameUtils.ts', { '@/types/game': types });
const turns = loadTypeScript('src/lib/gameTurn.ts', {
  '@/types/game': types,
  '@/lib/gameUtils': utils,
});

const pos = (row, col) => ({ row, col });
const baseMap = (overrides = {}) => ({
  startPosition: pos(0, 0),
  endPosition: pos(0, 5),
  obstacles: [],
  items: [],
  ...overrides,
});

function candidateWalls() {
  const walls = [];
  for (let row = 0; row < utils.BOARD_SIZE; row += 1) {
    for (let col = 0; col < utils.BOARD_SIZE; col += 1) {
      if (row + 1 < utils.BOARD_SIZE) walls.push({ position: pos(row, col), direction: 'down' });
      if (col + 1 < utils.BOARD_SIZE && row !== 0) {
        walls.push({ position: pos(row, col), direction: 'right' });
      }
    }
  }
  return walls;
}

const walls = candidateWalls();
assert.equal(utils.isValidMap(baseMap(), utils.GAME_RULES_VERSION), false, 'missing rules version');
assert.equal(
  utils.isValidMap(baseMap({ rulesVersion: utils.GAME_RULES_VERSION }), utils.GAME_RULES_VERSION),
  true,
  'matching rules version'
);
assert.equal(utils.isValidMap(baseMap({ obstacles: walls.slice(0, 22) })), true, '22-wall map');
assert.equal(utils.isValidMap(baseMap({ obstacles: walls.slice(0, 23) })), false, '23-wall budget');

const fake = (row, col, direction = 'right') => ({
  type: 'oneTimeWall',
  wallPosition: pos(row, col),
  wallDirection: direction,
});
const mine = (row, col) => ({ type: 'mine', position: pos(row, col) });
const smoke = (row, col) => ({ type: 'smoke', position: pos(row, col) });
const radar = () => ({ type: 'radar' });
const wormhole = (entrance, exit) => ({ type: 'wormhole', entrance, exit });

assert.equal(utils.isValidMap(baseMap({ items: [fake(1, 1)] })), true, 'fake cap exact');
assert.equal(utils.isValidMap(baseMap({ items: [fake(1, 1), fake(2, 1)] })), false, 'fake cap exceeded');
assert.equal(utils.isValidMap(baseMap({ items: [mine(1, 1)] })), true, 'mine cap exact');
assert.equal(utils.isValidMap(baseMap({ items: [mine(1, 1), mine(1, 2)] })), false, 'mine cap exceeded');
assert.equal(utils.isValidMap(baseMap({ items: [smoke(1, 1)] })), true, 'smoke cap exact');
assert.equal(utils.isValidMap(baseMap({ items: [smoke(1, 1), smoke(1, 2)] })), false, 'smoke cap exceeded');
assert.equal(utils.isValidMap(baseMap({ items: [radar()] })), true, 'radar cap exact');
assert.equal(utils.isValidMap(baseMap({ items: [radar(), radar()] })), false, 'radar cap exceeded');

const safeWormhole = wormhole(pos(2, 1), pos(3, 3));
assert.equal(utils.isValidMap(baseMap({ items: [safeWormhole] })), true, 'wormhole cap exact');
assert.equal(
  utils.isValidMap(baseMap({ items: [safeWormhole, wormhole(pos(2, 4), pos(4, 2))] })),
  false,
  'wormhole cap exceeded'
);

const isolatedExitWalls = [
  { position: pos(3, 4), direction: 'down' },
  { position: pos(3, 5), direction: 'down' },
  { position: pos(4, 3), direction: 'right' },
  { position: pos(5, 3), direction: 'right' },
];
assert.equal(
  utils.isValidMap(baseMap({
    obstacles: isolatedExitWalls,
    items: [wormhole(pos(2, 2), pos(5, 5))],
  })),
  false,
  'two-open-direction exit disconnected from goal'
);
assert.equal(
  utils.isValidMap(baseMap({
    items: [fake(5, 4), wormhole(pos(2, 2), pos(5, 5))],
  })),
  false,
  'fake wall cannot count as an open exit direction'
);

assert.equal(
  turns.getMineRollbackPosition([pos(0, 0), pos(0, 1), pos(0, 1)], pos(0, 1)).col,
  1,
  'mine uses turn history including stationary turns'
);
assert.deepEqual(
  turns.findRadarWalls(pos(0, 0), baseMap({ obstacles: undefined }), {}),
  [],
  'Firebase-omitted empty obstacle arrays remain radar-safe'
);

const unsafeRuntimeMap = baseMap({
  obstacles: [{ position: pos(5, 4), direction: 'right' }],
  items: [wormhole(pos(0, 1), pos(5, 5))],
});
const ownMap = baseMap();
const state = {
  phase: types.GamePhase.PLAY,
  currentTurn: 'a',
  turnOrder: ['a', 'b'],
  players: {
    a: { id: 'a', position: pos(0, 0), positionHistory: [pos(0, 0)], isReady: true },
    b: { id: 'b', position: pos(0, 0), positionHistory: [pos(0, 0)], isReady: true },
  },
  assignments: { a: 'b', b: 'a' },
  maps: { a: ownMap, b: unsafeRuntimeMap },
};
const collapsed = turns.resolveTurnAction(state, 'a', { type: 'move', direction: 'right' }, 1);
assert.ok(collapsed, 'unsafe legacy wormhole turn resolves');
assert.deepEqual(collapsed.state.players.a.position, pos(0, 0), 'unsafe wormhole returns to origin');
assert.match(collapsed.outcome.message, /붕괴/, 'unsafe wormhole reports collapse');

console.log('game rule regression tests passed');
