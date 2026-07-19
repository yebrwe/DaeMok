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
const utils = loadTypeScript('src/lib/gameUtils.ts', { '@/types/game': types });
const visuals = loadTypeScript('src/lib/liveBoardVisuals.ts', {
  '@/lib/gameUtils': utils,
});

const pos = (row, col) => ({ row, col });
const clone = (value) => JSON.parse(JSON.stringify(value));

function stateWithPlayedItems(items = [], endPosition = pos(5, 5)) {
  return {
    phase: types.GamePhase.PLAY,
    matchNumber: 3,
    currentTurn: 'runner-a',
    turnOrder: ['runner-a', 'runner-b'],
    turnNumber: 1,
    players: {
      'runner-a': { id: 'runner-a', position: pos(0, 0), moves: 0, isReady: true },
      'runner-b': { id: 'runner-b', position: pos(5, 5), moves: 0, isReady: true },
    },
    assignments: { 'runner-a': 'runner-b', 'runner-b': 'runner-a' },
    maps: {
      'runner-a': {
        startPosition: pos(0, 0),
        endPosition: pos(5, 5),
        obstacles: [],
        items: [{ type: 'radar' }],
      },
      'runner-b': {
        startPosition: pos(0, 0),
        endPosition,
        obstacles: [],
        items,
      },
    },
    itemState: {
      'runner-a': { consumed: {} },
      'runner-b': { consumed: {} },
    },
    collisionWalls: {},
  };
}

function advance(previous, position, moves = 1) {
  const next = clone(previous);
  next.turnNumber += 1;
  next.currentTurn = 'runner-b';
  next.players['runner-a'].position = position;
  next.players['runner-a'].moves = moves;
  return next;
}

{
  const previous = stateWithPlayedItems();
  const next = advance(previous, pos(0, 1));
  const visual = visuals.deriveLiveBoardVisualTransition(previous, next, 'runner-a', 7);
  assert.deepEqual(visual, { action: 'move', sequence: 7, fx: null, via: null });
  assert.equal(
    visuals.deriveLiveBoardVisualTransition(next, clone(next), 'runner-a', 8),
    null,
    'an unrelated duplicate snapshot must not replay the previous action'
  );

  const skipped = advance(previous, pos(0, 2), 2);
  skipped.turnNumber += 1;
  assert.equal(
    visuals.deriveLiveBoardVisualTransition(previous, skipped, 'runner-a', 8),
    null,
    'a multi-turn reconnect snapshot must not invent an animation'
  );
}

{
  const route = visuals.createLocalBoardVisualRoute(
    [pos(0, 1), pos(0, 0)],
    pos(0, 0),
    3
  );
  assert.deepEqual(
    visuals.getActiveLocalBoardVia(route, pos(0, 0), 3),
    [pos(0, 1), pos(0, 0)],
    'the committed action can use its own waypoint route'
  );
  assert.equal(
    visuals.getActiveLocalBoardVia(route, pos(0, 0), 4),
    null,
    'the previous route must not replay when a later action stays on the same cell'
  );
  assert.equal(
    visuals.getActiveLocalBoardVia(route, pos(0, 1), 3),
    null,
    'the route must not apply to a different synchronized destination'
  );
}

{
  const previous = stateWithPlayedItems();
  const next = advance(previous, pos(0, 0));
  next.collisionWalls.turn_1_runner_a = {
    playerId: 'runner-a',
    mapOwnerId: 'runner-b',
    position: pos(0, 0),
    direction: 'right',
    timestamp: 101,
  };
  const visual = visuals.deriveLiveBoardVisualTransition(previous, next, 'runner-a', 2);
  assert.equal(visual.action, 'bump');
  assert.deepEqual(visual.fx, { key: 2, type: 'bump', at: pos(0, 0), dir: 'right' });
  assert.equal(visual.via, null);
}

{
  const previous = stateWithPlayedItems([{ type: 'mine', position: pos(0, 1) }]);
  const next = advance(previous, pos(0, 0));
  next.itemState['runner-b'].consumed[0] = true;
  const visual = visuals.deriveLiveBoardVisualTransition(previous, next, 'runner-a', 3);
  assert.equal(visual.action, 'mine');
  assert.deepEqual(visual.fx.at, pos(0, 1));
  assert.deepEqual(visual.via, [pos(0, 1), pos(0, 0)]);
}

{
  const previous = stateWithPlayedItems([{
    type: 'wormhole',
    entrance: pos(0, 1),
    exit: pos(4, 4),
  }]);
  const next = advance(previous, pos(4, 4));
  next.itemState['runner-b'].consumed[0] = true;
  const visual = visuals.deriveLiveBoardVisualTransition(previous, next, 'runner-a', 4);
  assert.equal(visual.action, 'wormhole');
  assert.deepEqual(visual.fx.to, pos(4, 4));
  assert.deepEqual(visual.via, [pos(0, 1)]);
}

{
  const previous = stateWithPlayedItems([], pos(0, 2));
  const next = advance(previous, pos(0, 2));
  next.players['runner-a'].finished = true;
  next.players['runner-a'].finishMoves = 1;
  const visual = visuals.deriveLiveBoardVisualTransition(previous, next, 'runner-a', 5);
  assert.equal(visual.action, 'goal');
  assert.deepEqual(visual.fx.at, pos(0, 2));
  assert.deepEqual(visual.via, [pos(0, 1)]);
}

{
  const previous = stateWithPlayedItems();
  const next = advance(previous, pos(0, 0));
  next.itemState['runner-a'].consumed[0] = true;
  const visual = visuals.deriveLiveBoardVisualTransition(previous, next, 'runner-a', 6);
  assert.equal(visual.action, 'radar');
  assert.deepEqual(visual.fx, { key: 6, type: 'radar', at: pos(0, 0) });
}

console.log('live board visual regression tests passed');
