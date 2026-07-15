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
const mazeSkills = loadTypeScript('src/lib/mazeSkills.ts');
const turns = loadTypeScript('src/lib/gameTurn.ts', {
  '@/types/game': types,
  '@/lib/gameUtils': utils,
  '@/lib/mazeSkills': mazeSkills,
});
const practice = loadTypeScript('src/lib/practiceBattle.ts', {
  '@/types/game': types,
  '@/lib/gameUtils': utils,
  '@/lib/gameTurn': turns,
  '@/lib/mazeSkills': mazeSkills,
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
assert.equal(utils.isValidMap(baseMap({ obstacles: walls.slice(0, 24) })), true, '24-wall map');
assert.equal(utils.isValidMap(baseMap({ obstacles: walls.slice(0, 25) })), false, '25-wall budget');

const fake = (row, col, direction = 'right') => ({
  type: 'oneTimeWall',
  wallPosition: pos(row, col),
  wallDirection: direction,
});
const mine = (row, col) => ({ type: 'mine', position: pos(row, col) });
const smoke = (row, col) => ({ type: 'smoke', position: pos(row, col) });
const radar = () => ({ type: 'radar' });
const wormhole = (entrance, exit) => ({ type: 'wormhole', entrance, exit });
const specialWall = (type, row, col, wallDirection = 'right', extra = {}) => ({
  type,
  wallPosition: pos(row, col),
  wallDirection,
  ...extra,
});

const specialWallCosts = {
  steelWall: 1,
  fireWall: 1,
  poisonWall: 1,
  iceWall: 1,
  windWall: 1,
  collapseWall: 1,
  phaseWall: 1,
  mirrorWall: 5,
  thornWall: 1,
  crystalWall: 1,
};

for (const [type, cost] of Object.entries(specialWallCosts)) {
  assert.equal(utils.ITEM_COSTS[type], cost, `${type} candidate cost`);
  assert.equal(utils.ITEM_LIMITS[type], 1, `${type} cap one`);
  assert.equal(
    utils.isValidMap(baseMap({ items: [specialWall(type, 1, 1)] })),
    true,
    `${type} valid interior segment`
  );
  assert.equal(
    utils.isValidMap(baseMap({
      items: [specialWall(type, 1, 1), specialWall(type, 2, 1)],
    })),
    false,
    `${type} cap exceeded`
  );
  assert.equal(
    utils.isValidMap(baseMap({ items: [specialWall(type, 0, 0, 'up')] })),
    false,
    `${type} exterior segment rejected`
  );
}

assert.equal(
  utils.isValidMap(baseMap({
    obstacles: [{ position: pos(1, 2), direction: 'left' }],
    items: [specialWall('fireWall', 1, 1)],
  })),
  false,
  'ordinary and special walls cannot overlap'
);
assert.equal(
  utils.isValidMap(baseMap({
    items: [specialWall('iceWall', 1, 1), specialWall('windWall', 1, 2, 'left')],
  })),
  false,
  'special walls cannot overlap each other'
);
assert.equal(
  utils.isValidMap(baseMap({
    items: [specialWall('windWall', 1, 1, 'right', { effectDirection: 'diagonal' })],
  })),
  false,
  'wind direction must be cardinal when provided'
);
assert.equal(
  utils.isValidMap(baseMap({
    obstacles: [{ position: pos(0, 0), direction: 'down' }],
    items: [specialWall('steelWall', 0, 0)],
  })),
  false,
  'steel wall participates in base hardlock validation'
);

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
assert.deepEqual(
  turns.findRadarWalls(
    pos(0, 0),
    baseMap({ items: [specialWall('steelWall', 0, 0)] }),
    { 0: true }
  ),
  [{ position: pos(0, 0), direction: 'right' }],
  'radar detects special walls and steel ignores stale consumed state'
);

function runtimeState(playedMap, {
  position = pos(0, 0),
  history = [position],
  moves = 0,
  turnNumber = 1,
  itemState,
} = {}) {
  return {
    phase: types.GamePhase.PLAY,
    currentTurn: 'a',
    turnNumber,
    turnOrder: ['a'],
    players: {
      a: { id: 'a', position, positionHistory: history, moves, isReady: true },
    },
    assignments: { a: 'b' },
    maps: { a: baseMap(), b: playedMap },
    ...(itemState ? { itemState: { b: itemState } } : {}),
  };
}

function resolveSpecial(playedMap, direction = 'right', options = {}) {
  const resolved = turns.resolveTurnAction(runtimeState(playedMap, options), 'a', {
    type: 'move',
    direction,
  }, 100);
  assert.ok(resolved, 'special wall turn resolves');
  return resolved;
}

const steelMap = baseMap({ items: [specialWall('steelWall', 0, 0)] });
const steelHit = resolveSpecial(steelMap, 'right', { itemState: { consumed: { 0: true } } });
assert.deepEqual(steelHit.outcome.position, pos(0, 0), 'steel always blocks');
assert.equal(steelHit.outcome.wallEffect, 'steelWall', 'steel effect identified');
assert.equal(steelHit.outcome.consumedItemIndex, null, 'steel ignores consumed/breach state');

const fireHit = resolveSpecial(baseMap({ items: [specialWall('fireWall', 0, 0)] }));
assert.deepEqual(fireHit.outcome.position, pos(0, 0), 'fire blocks once');
assert.equal(fireHit.outcome.moves, 2, 'fire adds one move penalty');
assert.equal(fireHit.state.itemState.b.consumed[0], true, 'fire is consumed');

const fakeHitMap = baseMap({ items: [fake(0, 0)] });
const fakeHit = resolveSpecial(fakeHitMap);
const fakeCollisions = Object.values(fakeHit.state.collisionWalls || {});
assert.equal(fakeCollisions.length, 1, 'fake wall collision remains in the persisted turn history');
assert.deepEqual(
  utils.getVisibleCollisionWalls(fakeCollisions, fakeHitMap, fakeHit.state.itemState.b.consumed),
  [],
  'consumed fake wall collision is hidden from the rendered board'
);
assert.equal(
  utils.getVisibleCollisionWalls(
    [{ ...fakeCollisions[0], position: pos(0, 1), direction: 'left' }],
    fakeHitMap,
    {}
  ).length,
  1,
  'an unconsumed disguised wall collision remains visible from the opposite segment direction'
);
assert.equal(
  utils.getVisibleCollisionWalls(
    fakeCollisions,
    baseMap({ obstacles: [{ position: pos(0, 0), direction: 'right' }] }),
    { 0: true }
  ).length,
  1,
  'static wall collision remains visible even with stale consumed flags'
);
assert.equal(
  utils.getVisibleCollisionWalls(
    fakeCollisions,
    baseMap({ items: [specialWall('steelWall', 0, 0)] }),
    { 0: true }
  ).length,
  1,
  'steel wall collision remains visible even with stale consumed state'
);

const poisonPass = resolveSpecial(baseMap({ items: [specialWall('poisonWall', 0, 0)] }));
assert.deepEqual(poisonPass.outcome.position, pos(0, 1), 'poison allows passage');
assert.equal(poisonPass.outcome.moves, 3, 'poison adds two move penalty');
assert.equal(poisonPass.state.itemState.b.consumed[0], true, 'poison is consumed');

const icePass = resolveSpecial(baseMap({ items: [specialWall('iceWall', 0, 0)] }));
assert.deepEqual(icePass.outcome.position, pos(0, 2), 'ice safely slides one extra cell');

const iceMineLanding = resolveSpecial(baseMap({
  items: [specialWall('iceWall', 0, 0), mine(0, 2)],
}));
assert.equal(iceMineLanding.outcome.effect, 'mine', 'ice final landing triggers a mine');
assert.deepEqual(iceMineLanding.outcome.position, pos(0, 0), 'ice landing mine applies rollback');
assert.equal(iceMineLanding.state.itemState.b.consumed[1], true, 'ice landing mine is consumed');

const iceBlockedByCollapse = resolveSpecial(baseMap({
  items: [
    specialWall('iceWall', 0, 0),
    specialWall('collapseWall', 0, 1),
  ],
}), 'right', { itemState: { activeWalls: { 1: true } } });
assert.deepEqual(
  iceBlockedByCollapse.outcome.position,
  pos(0, 1),
  'ice does not cross an active collapsed wall'
);

const windPass = resolveSpecial(baseMap({
  items: [specialWall('windWall', 0, 0, 'right', { effectDirection: 'down' })],
}));
assert.deepEqual(windPass.outcome.position, pos(1, 1), 'wind pushes in selected direction');
assert.equal(windPass.state.itemState.b.consumed[0], true, 'wind wall is consumed after its first push');

const windReverse = resolveSpecial(baseMap({
  items: [specialWall('windWall', 0, 0, 'right', { effectDirection: 'left' })],
}));
assert.deepEqual(
  windReverse.outcome.position,
  pos(0, 0),
  'reverse wind crosses its own triggering segment instead of blocking itself'
);
const windAfterDissipating = turns.resolveTurnAction(
  windReverse.state,
  'a',
  { type: 'move', direction: 'right' },
  101
);
assert.ok(windAfterDissipating, 'movement resolves after reverse wind dissipates');
assert.deepEqual(windAfterDissipating.outcome.position, pos(0, 1), 'consumed wind no longer pushes');

const blockedWindPush = resolveSpecial(baseMap({
  items: [specialWall('windWall', 0, 0, 'right', { effectDirection: 'up' })],
}));
assert.deepEqual(blockedWindPush.outcome.position, pos(0, 1), 'wind stays on the crossed cell when push leaves the board');
assert.match(blockedWindPush.state.turnMessage, /밀릴 칸이 막혀/, 'blocked wind message describes the actual outcome');
assert.equal(blockedWindPush.state.itemState.b.consumed[0], true, 'blocked wind still dissipates after crossing');

const windSmokeLanding = resolveSpecial(baseMap({
  items: [
    specialWall('windWall', 0, 0, 'right', { effectDirection: 'down' }),
    smoke(1, 1),
  ],
}));
assert.equal(windSmokeLanding.outcome.effect, 'smoke', 'wind final landing triggers smoke');
assert.deepEqual(windSmokeLanding.outcome.position, pos(1, 1), 'smoke keeps the wind landing cell');
assert.equal(windSmokeLanding.state.itemState.b.consumed[1], true, 'wind landing smoke is consumed');
assert.equal(
  windSmokeLanding.state.visionEffectsByPlayer.a.type,
  'smoke',
  'wind landing smoke applies the shared vision state'
);

const windWormholeLanding = resolveSpecial(baseMap({
  items: [
    specialWall('windWall', 0, 0, 'right', { effectDirection: 'down' }),
    wormhole(pos(1, 1), pos(3, 3)),
  ],
}));
assert.equal(windWormholeLanding.outcome.effect, 'wormhole', 'wind final landing triggers a wormhole');
assert.deepEqual(windWormholeLanding.outcome.position, pos(3, 3), 'wind landing wormhole applies its exit');
assert.equal(windWormholeLanding.state.itemState.b.consumed[1], true, 'wind landing wormhole is consumed');

const collapseMap = baseMap({ items: [specialWall('collapseWall', 0, 0)] });
const collapsePass = resolveSpecial(collapseMap);
assert.deepEqual(collapsePass.outcome.position, pos(0, 1), 'collapse allows first passage');
assert.equal(collapsePass.state.itemState.b.activeWalls[0], true, 'collapse becomes active');
const collapseReturn = turns.resolveTurnAction(
  collapsePass.state,
  'a',
  { type: 'move', direction: 'left' },
  101
);
assert.ok(collapseReturn, 'active collapse retry resolves');
assert.deepEqual(collapseReturn.outcome.position, pos(0, 1), 'active collapse blocks permanently');

const collapseFakeBeliefSafety = resolveSpecial(baseMap({
  obstacles: [{ position: pos(0, 1), direction: 'down' }],
  items: [
    specialWall('collapseWall', 0, 0),
    fake(0, 1),
  ],
}));
assert.deepEqual(collapseFakeBeliefSafety.outcome.position, pos(0, 1), 'collapse and fake combo still allows passage');
assert.equal(
  collapseFakeBeliefSafety.state.itemState.b.consumed[0],
  true,
  'collapse disappears when an untested fake wall would leave no believable exit'
);
assert.equal(
  collapseFakeBeliefSafety.state.itemState.b.activeWalls,
  undefined,
  'belief-unsafe collapse never closes behind the player'
);

const unsafeCollapseMap = baseMap({
  obstacles: [
    { position: pos(1, 0), direction: 'right' },
    { position: pos(1, 0), direction: 'down' },
  ],
  items: [specialWall('collapseWall', 0, 0, 'down')],
});
assert.equal(
  utils.isValidMap(unsafeCollapseMap),
  true,
  'collapse map is valid because unsafe activation has a runtime fallback'
);
const unsafeCollapse = resolveSpecial(unsafeCollapseMap, 'down');
assert.deepEqual(unsafeCollapse.outcome.position, pos(1, 0), 'unsafe collapse still allows passage');
assert.equal(unsafeCollapse.state.itemState.b.consumed[0], true, 'unsafe collapse is consumed');
assert.equal(unsafeCollapse.state.itemState.b.activeWalls, undefined, 'unsafe collapse never activates');

const phaseMap = baseMap({ items: [specialWall('phaseWall', 0, 0)] });
const phaseClosed = resolveSpecial(phaseMap, 'right', { turnNumber: 2 });
assert.deepEqual(phaseClosed.outcome.position, pos(0, 0), 'phase starts closed');
assert.equal(phaseClosed.state.itemState.b.phaseOpen[0], true, 'phase opens after blocking');
const phasePassed = turns.resolveTurnAction(
  phaseClosed.state,
  'a',
  { type: 'move', direction: 'right' },
  102
);
assert.ok(phasePassed, 'open phase retry resolves');
assert.deepEqual(phasePassed.outcome.position, pos(0, 1), 'phase passes on next edge attempt');
assert.equal(phasePassed.state.itemState.b.phaseOpen[0], false, 'phase closes after passage');

const mirrorPass = resolveSpecial(baseMap({ items: [specialWall('mirrorWall', 0, 0)] }));
assert.deepEqual(mirrorPass.outcome.position, pos(5, 4), 'mirror moves to 180-degree cell');
assert.equal(mirrorPass.state.itemState.b.consumed[0], true, 'mirror wall is consumed after its first reflection');
const mirrorAfterShattering = turns.resolveTurnAction(
  mirrorPass.state,
  'a',
  { type: 'move', direction: 'right' },
  102
);
assert.ok(mirrorAfterShattering, 'movement resolves after mirror shatters');
assert.deepEqual(mirrorAfterShattering.outcome.position, pos(5, 5), 'consumed mirror no longer reflects');

const mirrorMineLanding = resolveSpecial(baseMap({
  items: [specialWall('mirrorWall', 0, 0), mine(5, 4)],
}));
assert.equal(mirrorMineLanding.outcome.effect, 'mine', 'mirror final landing triggers a mine');
assert.deepEqual(mirrorMineLanding.outcome.position, pos(0, 0), 'mirror landing mine applies rollback');
assert.equal(mirrorMineLanding.state.itemState.b.consumed[0], true, 'mirror shatters before its landing trap resolves');
assert.equal(mirrorMineLanding.state.itemState.b.consumed[1], true, 'mirror landing mine is consumed');

const mirrorSafeFallback = resolveSpecial(baseMap({
  obstacles: [
    { position: pos(5, 4), direction: 'up' },
    { position: pos(5, 4), direction: 'left' },
  ],
  items: [
    specialWall('mirrorWall', 0, 0),
    specialWall('steelWall', 5, 4, 'right'),
  ],
}));
assert.deepEqual(
  mirrorSafeFallback.outcome.position,
  pos(0, 1),
  'mirror falls back to normal passage when permanent walls isolate its target'
);
assert.equal(mirrorSafeFallback.state.itemState.b.consumed[0], true, 'unsafe mirror fallback still shatters');

const mirrorGoalFallback = resolveSpecial(baseMap({
  endPosition: pos(5, 4),
  items: [specialWall('mirrorWall', 0, 0)],
}));
assert.deepEqual(
  mirrorGoalFallback.outcome.position,
  pos(0, 1),
  'mirror cannot finish a ranked run with a long-distance reflection'
);
assert.equal(!!mirrorGoalFallback.outcome.finished, false, 'mirror goal fallback does not finish');

const thornHit = resolveSpecial(
  baseMap({ items: [specialWall('thornWall', 0, 2)] }),
  'right',
  {
    position: pos(0, 2),
    history: [pos(0, 0), pos(0, 1), pos(0, 2)],
  }
);
assert.deepEqual(thornHit.outcome.position, pos(0, 1), 'thorn uses actual two-turn history');
assert.equal(thornHit.state.itemState.b.consumed[0], true, 'thorn is consumed');

const thornSmokeLanding = resolveSpecial(
  baseMap({ items: [specialWall('thornWall', 0, 2), smoke(0, 1)] }),
  'right',
  {
    position: pos(0, 2),
    history: [pos(0, 0), pos(0, 1), pos(0, 2)],
  }
);
assert.equal(thornSmokeLanding.outcome.effect, 'smoke', 'thorn rewind final landing triggers smoke');
assert.deepEqual(thornSmokeLanding.outcome.position, pos(0, 1), 'thorn landing smoke keeps rewind cell');
assert.equal(thornSmokeLanding.state.itemState.b.consumed[0], true, 'thorn remains consumed');
assert.equal(thornSmokeLanding.state.itemState.b.consumed[1], true, 'thorn landing smoke is consumed');

const thornSafeFallback = resolveSpecial(
  baseMap({
    obstacles: [
      { position: pos(1, 0), direction: 'right' },
      { position: pos(1, 0), direction: 'down' },
    ],
    items: [
      specialWall('thornWall', 0, 1),
      specialWall('collapseWall', 1, 0, 'up'),
    ],
  }),
  'right',
  {
    position: pos(0, 1),
    history: [pos(1, 0), pos(0, 1)],
    itemState: { activeWalls: { 1: true } },
  }
);
assert.deepEqual(
  thornSafeFallback.outcome.position,
  pos(0, 1),
  'thorn stays at origin when active walls isolate rewind position'
);
const anchoredThornSafeFallback = turns.resolveTurnAction(
  skillRuntimeState(
    'anchor',
    baseMap({
      obstacles: [
        { position: pos(1, 0), direction: 'right' },
        { position: pos(1, 0), direction: 'down' },
      ],
      items: [
        specialWall('thornWall', 0, 1),
        specialWall('collapseWall', 1, 0, 'up'),
      ],
    }),
    {
      position: pos(0, 1),
      history: [pos(1, 0), pos(0, 1)],
      itemState: { b: { activeWalls: { 1: true } } },
    }
  ),
  'a',
  { type: 'move', direction: 'right' },
  100
);
assert.ok(anchoredThornSafeFallback, 'anchored thorn safety fallback resolves');
assert.equal(
  anchoredThornSafeFallback.state.itemState.a?.mazeSkill?.consumed?.anchor,
  undefined,
  'anchor is preserved when thorn cannot perform a safe rewind'
);

const mineHardlockFallback = resolveSpecial(
  baseMap({
    obstacles: [
      { position: pos(1, 0), direction: 'right' },
      { position: pos(1, 0), direction: 'down' },
    ],
    items: [
      specialWall('collapseWall', 1, 0, 'up'),
      mine(0, 2),
    ],
  }),
  'right',
  {
    position: pos(0, 1),
    history: [pos(1, 0), pos(0, 1)],
    itemState: { activeWalls: { 0: true } },
  }
);
assert.deepEqual(
  mineHardlockFallback.outcome.position,
  pos(0, 2),
  'mine stays on its safe landing cell when active walls isolate the rollback cell'
);
assert.equal(mineHardlockFallback.state.itemState.b.consumed[1], true, 'unsafe rollback still consumes mine');

const nearbyTrueWall = { position: pos(1, 0), direction: 'right' };
const farTrueWall = { position: pos(5, 0), direction: 'right' };
const crystalHit = resolveSpecial(baseMap({
  obstacles: [nearbyTrueWall, farTrueWall],
  items: [specialWall('crystalWall', 0, 0)],
}));
assert.deepEqual(crystalHit.outcome.position, pos(0, 0), 'crystal blocks once');
assert.equal(crystalHit.state.itemState.b.consumed[0], true, 'crystal is consumed');
assert.deepEqual(
  crystalHit.state.revealedWallsByPlayer.a,
  [nearbyTrueWall],
  'crystal reveals only nearby true walls'
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

const terminalGoalMap = baseMap({
  endPosition: pos(0, 2),
  items: [specialWall('iceWall', 0, 0), mine(0, 2)],
});
const terminalGoal = resolveSpecial(terminalGoalMap);
assert.equal(terminalGoal.outcome.reachedGoal, true, 'forced movement checks the final goal cell');
assert.deepEqual(terminalGoal.outcome.position, pos(0, 2), 'goal arrival wins before malformed goal trap');
assert.equal(
  terminalGoal.state.itemState?.b?.consumed?.[1],
  undefined,
  'goal-terminal ordering does not consume a trap on the goal'
);

const finalTurnState = {
  phase: types.GamePhase.PLAY,
  matchNumber: 3,
  currentTurn: 'a',
  turnNumber: 7,
  turnOrder: ['a', 'b'],
  players: {
    a: {
      id: 'a',
      displayName: 'A',
      position: pos(0, 4),
      positionHistory: [pos(0, 3), pos(0, 4)],
      moves: 2,
      isReady: true,
    },
    b: {
      id: 'b',
      displayName: 'B',
      position: pos(0, 5),
      positionHistory: [pos(0, 5)],
      moves: 8,
      finished: true,
      finishMoves: 8,
      isReady: true,
    },
  },
  assignments: { a: 'b', b: 'a' },
  maps: { a: baseMap(), b: baseMap() },
};
const finalTurn = turns.resolveTurnAction(finalTurnState, 'a', { type: 'move', direction: 'right' }, 300);
assert.ok(finalTurn, 'last goal turn resolves');
assert.equal(finalTurn.outcome.reachedGoal, true, 'last turn reaches goal');
assert.equal(finalTurn.state.phase, types.GamePhase.END, 'last goal move atomically commits END');
assert.equal(finalTurn.state.currentTurn, null, 'settled game has no current turn');
assert.equal(finalTurn.state.winner, 'a', 'minimum-turn finisher wins in the same reducer result');
assert.equal(finalTurn.state.draw, null, 'single minimum-turn finisher is not a draw');

function skillRuntimeState(skillId, playedMap, options = {}) {
  const position = options.position || pos(0, 0);
  return {
    phase: types.GamePhase.PLAY,
    currentTurn: 'a',
    turnNumber: 1,
    turnOrder: ['a'],
    players: {
      a: {
        id: 'a',
        position,
        positionHistory: options.history || [position],
        moves: 0,
        isReady: true,
      },
    },
    assignments: { a: 'b' },
    maps: {
      a: baseMap({ skillLoadout: skillId }),
      b: playedMap,
    },
    itemState: options.itemState || {},
  };
}

const scoutState = skillRuntimeState(
  'scoutPulse',
  baseMap({ obstacles: [{ position: pos(0, 0), direction: 'right' }] })
);
const scoutPulse = turns.resolveTurnAction(
  scoutState,
  'a',
  { type: 'skill', skillId: 'scoutPulse' },
  200
);
assert.ok(scoutPulse, 'scout skill resolves');
assert.equal(scoutPulse.outcome.type, 'skill', 'scout uses skill outcome');
assert.equal(scoutPulse.outcome.moves, 1, 'scout spends one turn');
assert.equal(scoutPulse.outcome.found.length, 1, 'scout reveals nearby wall');
assert.equal(scoutPulse.state.itemState.a.mazeSkill.consumed.scoutPulse, true, 'scout consumes once');

const breachState = skillRuntimeState(
  'breach',
  baseMap({ obstacles: [{ position: pos(0, 0), direction: 'right' }] })
);
const breach = turns.resolveTurnAction(
  breachState,
  'a',
  { type: 'skill', skillId: 'breach', direction: 'right' },
  201
);
assert.ok(breach, 'breach skill resolves against a wall');
assert.deepEqual(breach.outcome.position, pos(0, 1), 'breach crosses exactly one wall');
assert.equal(breach.state.itemState.a.mazeSkill.consumed.breach, true, 'breach consumes once');
assert.equal(
  turns.resolveTurnAction(
    skillRuntimeState('breach', baseMap({ items: [specialWall('steelWall', 0, 0)] })),
    'a',
    { type: 'skill', skillId: 'breach', direction: 'right' },
    202
  ),
  null,
  'breach cannot cross steel'
);

const dash = turns.resolveTurnAction(
  skillRuntimeState('dash', baseMap()),
  'a',
  { type: 'skill', skillId: 'dash', direction: 'right' },
  203
);
assert.ok(dash, 'dash skill resolves on two open segments');
assert.deepEqual(dash.outcome.position, pos(0, 2), 'dash moves two cells in one turn');
assert.deepEqual(dash.outcome.via, [pos(0, 1)], 'dash exposes a stable animation waypoint');

const dashIntoMine = turns.resolveTurnAction(
  skillRuntimeState('dash', baseMap({ items: [mine(0, 2)] })),
  'a',
  { type: 'skill', skillId: 'dash', direction: 'right' },
  203
);
assert.ok(dashIntoMine, 'dash landing item resolves');
assert.equal(dashIntoMine.outcome.landingEffect, 'mine', 'dash does not bypass a landing trap');
assert.deepEqual(dashIntoMine.outcome.position, pos(0, 0), 'dash mine uses turn history rollback');
assert.equal(dashIntoMine.state.itemState.b.consumed[0], true, 'dash landing mine is consumed');

const dashThroughMine = turns.resolveTurnAction(
  skillRuntimeState('dash', baseMap({ items: [mine(0, 1)] })),
  'a',
  { type: 'skill', skillId: 'dash', direction: 'right' },
  203
);
assert.ok(dashThroughMine, 'dash intermediate mine resolves');
assert.equal(dashThroughMine.outcome.landingEffect, 'mine', 'dash stops on an intermediate mine');
assert.deepEqual(dashThroughMine.outcome.position, pos(0, 0), 'intermediate mine rolls back from its cell');
assert.equal(dashThroughMine.state.itemState.b.consumed[0], true, 'intermediate mine is consumed');

const dashThroughWormhole = turns.resolveTurnAction(
  skillRuntimeState('dash', baseMap({ items: [wormhole(pos(0, 1), pos(5, 5))] })),
  'a',
  { type: 'skill', skillId: 'dash', direction: 'right' },
  203
);
assert.ok(dashThroughWormhole, 'dash intermediate wormhole resolves');
assert.equal(dashThroughWormhole.outcome.landingEffect, 'wormhole', 'dash stops on an intermediate wormhole');
assert.deepEqual(dashThroughWormhole.outcome.position, pos(5, 5), 'intermediate wormhole teleports normally');

const dashThroughSmoke = turns.resolveTurnAction(
  skillRuntimeState('dash', baseMap({ items: [{ type: 'smoke', position: pos(0, 1) }] })),
  'a',
  { type: 'skill', skillId: 'dash', direction: 'right' },
  203
);
assert.ok(dashThroughSmoke, 'dash intermediate smoke resolves');
assert.equal(dashThroughSmoke.outcome.landingEffect, 'smoke', 'dash stops on intermediate smoke');
assert.deepEqual(dashThroughSmoke.outcome.position, pos(0, 1), 'smoke keeps the intermediate landing cell');

const dashIntoGoal = turns.resolveTurnAction(
  skillRuntimeState('dash', baseMap({
    endPosition: pos(0, 1),
    obstacles: [{ position: pos(0, 1), direction: 'right' }],
  })),
  'a',
  { type: 'skill', skillId: 'dash', direction: 'right' },
  203
);
assert.ok(dashIntoGoal, 'dash may stop at an intermediate goal before a blocked second segment');
assert.equal(dashIntoGoal.outcome.reachedGoal, true, 'intermediate goal completes the run');
assert.deepEqual(dashIntoGoal.outcome.position, pos(0, 1), 'dash stops exactly on the goal');

const dashThroughOpenPhase = turns.resolveTurnAction(
  skillRuntimeState(
    'dash',
    baseMap({ items: [specialWall('phaseWall', 0, 0)] }),
    { itemState: { b: { phaseOpen: { 0: true } } } }
  ),
  'a',
  { type: 'skill', skillId: 'dash', direction: 'right' },
  203
);
assert.ok(dashThroughOpenPhase, 'dash crosses an already-open phase wall');
assert.deepEqual(dashThroughOpenPhase.outcome.position, pos(0, 2), 'open phase keeps both dash segments usable');
assert.equal(dashThroughOpenPhase.state.itemState.b.phaseOpen[0], false, 'phase wall closes after dash passage');

const dashThroughArmedCollapse = turns.resolveTurnAction(
  skillRuntimeState('dash', baseMap({ items: [specialWall('collapseWall', 0, 0)] })),
  'a',
  { type: 'skill', skillId: 'dash', direction: 'right' },
  203
);
assert.ok(dashThroughArmedCollapse, 'dash crosses a not-yet-collapsed wall');
assert.deepEqual(dashThroughArmedCollapse.outcome.position, pos(0, 2), 'armed collapse does not block dash');
assert.equal(
  dashThroughArmedCollapse.state.itemState.b.activeWalls[0],
  true,
  'collapse wall activates safely behind the dash'
);

assert.equal(
  turns.resolveTurnAction(
    skillRuntimeState(
      'dash',
      baseMap({ items: [specialWall('collapseWall', 0, 0)] }),
      { itemState: { b: { activeWalls: { 0: true } } } }
    ),
    'a',
    { type: 'skill', skillId: 'dash', direction: 'right' },
    203
  ),
  null,
  'active collapse wall blocks dash'
);

assert.equal(
  turns.resolveTurnAction(
    skillRuntimeState(
      'breach',
      baseMap({ items: [specialWall('phaseWall', 0, 0)] }),
      { itemState: { b: { phaseOpen: { 0: true } } } }
    ),
    'a',
    { type: 'skill', skillId: 'breach', direction: 'right' },
    203
  ),
  null,
  'breach is not consumed against an already-open phase segment'
);

const anchoredMine = turns.resolveTurnAction(
  skillRuntimeState('anchor', baseMap({ items: [mine(0, 1)] })),
  'a',
  { type: 'move', direction: 'right' },
  204
);
assert.ok(anchoredMine, 'anchor integration resolves');
assert.deepEqual(anchoredMine.outcome.position, pos(0, 1), 'anchor keeps the normally entered cell');
assert.equal(anchoredMine.outcome.skillEffect, 'anchor', 'anchor effect is reported');
assert.equal(anchoredMine.state.itemState.a.mazeSkill.consumed.anchor, true, 'anchor consumes automatically');
assert.equal(anchoredMine.state.itemState.b.consumed[0], true, 'negated mine still consumes');

const practiceAiItemTypes = new Set();
for (const [index, map] of practice.PRACTICE_MAP_TEMPLATES.entries()) {
  assert.equal(utils.isValidMap(map), true, `practice template ${index + 1} remains valid`);
  assert.equal(
    utils.getMapBudgetUsed(map),
    utils.MAX_OBSTACLES,
    `practice template ${index + 1} spends the full wall budget`
  );
  const manhattan = Math.abs(map.startPosition.row - map.endPosition.row) +
    Math.abs(map.startPosition.col - map.endPosition.col);
  assert.ok(
    practice.getPracticeMapRouteLength(map) > manhattan,
    `practice template ${index + 1} forces a real detour to the exit`
  );
  assert.equal(utils.isMazeSkillId(map.skillLoadout), true, `practice template ${index + 1} equips a skill`);
}
for (let index = 0; index < 3; index += 1) {
  for (const item of practice.createAiPracticeMap(index).items || []) {
    practiceAiItemTypes.add(item.type);
  }
}
assert.deepEqual(
  [...practiceAiItemTypes].sort(),
  Object.keys(utils.ITEM_COSTS).sort(),
  'the three AI maps collectively use every trap and all ten special walls'
);

function simulatePracticeState(initialState, label) {
  let state = initialState;
  const probeCounts = {};
  for (let step = 0; step < 800 && state.phase === types.GamePhase.PLAY; step += 1) {
    const actorId = state.currentTurn;
    assert.ok(actorId, `${label}: current turn exists`);
    probeCounts[actorId] ||= {};
    const action = practice.choosePracticeAiAction(state, actorId, probeCounts[actorId]);
    assert.ok(action, `${label}: ${actorId} finds an action`);
    let resolved = turns.resolveTurnAction(state, actorId, action, 10_000 + step);
    if (!resolved && action.type === 'skill' && action.direction) {
      resolved = turns.resolveTurnAction(
        state,
        actorId,
        { type: 'move', direction: action.direction },
        10_000 + step
      );
    }
    assert.ok(resolved, `${label}: ${actorId} resolves an action`);
    if (resolved.outcome.type === 'move' && resolved.outcome.effect === 'bump') {
      const key = practice.practiceWallKey(resolved.outcome.origin, resolved.outcome.direction);
      probeCounts[actorId][key] = (probeCounts[actorId][key] || 0) + 1;
    }
    state = resolved.state;
  }
  assert.equal(state.phase, types.GamePhase.END, `${label}: simulation reaches END`);
  assert.equal(
    Object.values(state.players).every((player) => player.finished && !player.forfeited),
    true,
    `${label}: every runner escapes without retirement`
  );
  return state;
}

for (const [templateIndex, map] of practice.PRACTICE_MAP_TEMPLATES.entries()) {
  for (const aiCount of [1, 2, 3]) {
    simulatePracticeState(
      practice.createPracticeGameState(map, aiCount),
      `practice template ${templateIndex + 1} with ${aiCount} AI`
    );
  }
}

const mapTestState = practice.createMapTestGameState(practice.PRACTICE_MAP_TEMPLATES[0]);
assert.deepEqual(mapTestState.turnOrder, [practice.PRACTICE_USER_ID]);
assert.equal(mapTestState.assignments[practice.PRACTICE_USER_ID], practice.PRACTICE_USER_ID);
assert.deepEqual(
  mapTestState.players[practice.PRACTICE_USER_ID].position,
  practice.PRACTICE_MAP_TEMPLATES[0].startPosition,
  'map test starts the creator on their own map'
);
const mapTestMove = turns.resolveTurnAction(
  mapTestState,
  practice.PRACTICE_USER_ID,
  { type: 'move', direction: 'down' },
  301
);
assert.ok(mapTestMove, 'solo map test resolves through the shared turn engine');
assert.equal(
  mapTestMove.state.currentTurn,
  practice.PRACTICE_USER_ID,
  'solo map test immediately returns the next turn to the creator'
);
assert.throws(
  () => practice.createMapTestGameState(baseMap()),
  /valid 24\/24 map/,
  'solo map test rejects incomplete maps outside the setup UI'
);
const completedMapTest = simulatePracticeState(
  practice.createMapTestGameState(practice.PRACTICE_MAP_TEMPLATES[0]),
  'solo creator map test'
);
assert.equal(completedMapTest.winner, practice.PRACTICE_USER_ID, 'solo map test records the creator as winner');

console.log('game rule regression tests passed');
