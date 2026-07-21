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
const diceWormhole = loadTypeScript('src/lib/diceWormhole.ts');
const utils = loadTypeScript('src/lib/gameUtils.ts', {
  '@/types/game': types,
  '@/lib/diceWormhole': diceWormhole,
});
const mazeSkills = loadTypeScript('src/lib/mazeSkills.ts');
const turns = loadTypeScript('src/lib/gameTurn.ts', {
  '@/types/game': types,
  '@/lib/gameUtils': utils,
  '@/lib/diceWormhole': diceWormhole,
  '@/lib/mazeSkills': mazeSkills,
});
const practice = loadTypeScript('src/lib/practiceBattle.ts', {
  '@/types/game': types,
  '@/lib/gameUtils': utils,
  '@/lib/gameTurn': turns,
  '@/lib/diceWormhole': diceWormhole,
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
const wormhole = (entrance, exit, challenge) => ({
  type: 'wormhole',
  entrance,
  exit,
  ...(challenge ? { challenge } : {}),
});
const specialWall = (type, row, col, wallDirection = 'right', extra = {}) => ({
  type,
  wallPosition: pos(row, col),
  wallDirection,
  ...extra,
});

const mapToClone = {
  ...baseMap({ rulesVersion: utils.GAME_RULES_VERSION }),
  skillLoadout: 'scoutPulse',
  items: [
    { type: 'mine', position: pos(1, 1), wallPosition: undefined },
    { type: 'oneTimeWall', wallPosition: pos(2, 2), wallDirection: 'right', position: undefined },
  ],
};
const clonedMap = utils.cloneGameMap(mapToClone);
assert.deepEqual(clonedMap.items, [
  { type: 'mine', position: pos(1, 1) },
  { type: 'oneTimeWall', wallPosition: pos(2, 2), wallDirection: 'right' },
]);
assert.equal(Object.prototype.hasOwnProperty.call(clonedMap.items[0], 'wallPosition'), false);
assert.equal(Object.prototype.hasOwnProperty.call(clonedMap.items[1], 'position'), false);
assert.notStrictEqual(
  clonedMap.items[0].position,
  mapToClone.items[0].position,
  'cloned item position should be detached'
);

const specialWallCosts = {
  steelWall: 1,
  fireWall: 1,
  poisonWall: 2,
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
assert.equal(
  utils.isValidNewMap(baseMap({ skillLoadout: 'scoutPulse' })),
  true,
  'new maps keep the inert V3 compatibility loadout'
);
for (const retiredSkillLoadout of ['breach', 'anchor', 'dash']) {
  assert.equal(
    utils.isValidMap(baseMap({ skillLoadout: retiredSkillLoadout })),
    true,
    `legacy ${retiredSkillLoadout} map remains readable`
  );
  assert.equal(
    utils.isValidNewMap(baseMap({ skillLoadout: retiredSkillLoadout })),
    false,
    `new ${retiredSkillLoadout} map is rejected`
  );
}
assert.equal(
  utils.isValidNewMap(baseMap({ skillLoadout: 'scoutPulse', items: [radar()] })),
  false,
  'new radar map is rejected while the compatibility validator remains readable'
);
for (const retiredWallType of [
  'steelWall',
  'collapseWall',
  'phaseWall',
  'mirrorWall',
  'crystalWall',
]) {
  const legacyMap = baseMap({
    skillLoadout: 'scoutPulse',
    items: [specialWall(retiredWallType, 1, 1)],
  });
  assert.equal(
    utils.isValidMap(legacyMap),
    true,
    `legacy ${retiredWallType} map remains readable`
  );
  assert.equal(
    utils.isValidNewMap(legacyMap),
    false,
    `new ${retiredWallType} map is rejected`
  );
}
const normalizedNewMap = utils.normalizeNewMapForSubmission(
  baseMap({ skillLoadout: 'anchor' })
);
assert.equal(normalizedNewMap.skillLoadout, 'scoutPulse', 'stale skill loadout normalizes to compatibility');
assert.equal(utils.isValidNewMap(normalizedNewMap), true, 'normalized map passes the new-map boundary');

const safeWormhole = wormhole(pos(2, 1), pos(3, 3));
assert.equal(utils.isValidMap(baseMap({ items: [safeWormhole] })), true, 'wormhole cap exact');
assert.equal(
  utils.isValidMap(baseMap({ items: [safeWormhole, wormhole(pos(2, 4), pos(4, 2))] })),
  false,
  'wormhole cap exceeded'
);

const sealedWormholeChallenge = {
  version: 1,
  startPosition: pos(0, 0),
  endPosition: pos(1, 0),
  seals: [pos(0, 5), pos(5, 5), pos(5, 0)],
  obstacles: [
    { position: pos(0, 0), direction: 'right' },
    { position: pos(2, 1), direction: 'right' },
    { position: pos(3, 2), direction: 'right' },
    { position: pos(4, 3), direction: 'right' },
  ],
};
const sealedWormhole = wormhole(pos(0, 1), pos(4, 4), sealedWormholeChallenge);
assert.equal(
  utils.getWormholeChallengeCompletionSteps(sealedWormholeChallenge),
  21,
  'configured challenge measures the shortest route through all three seals'
);
assert.equal(
  utils.isValidWormholeChallenge(sealedWormholeChallenge),
  true,
  'a solvable three-seal challenge inside the difficulty window is valid'
);
assert.equal(
  utils.isValidWormholeChallenge({
    ...sealedWormholeChallenge,
    obstacles: sealedWormholeChallenge.obstacles.slice(0, 3),
  }),
  false,
  'new wormhole challenges keep at least four persisted internal walls'
);
assert.equal(
  utils.isValidMap(baseMap({ items: [safeWormhole] })),
  true,
  'legacy challenge-less wormholes remain readable'
);
assert.equal(
  utils.isValidNewMap(baseMap({ skillLoadout: 'scoutPulse', items: [safeWormhole] })),
  false,
  'new maps cannot submit a challenge-less wormhole'
);
assert.equal(
  utils.isValidNewMap(baseMap({ skillLoadout: 'scoutPulse', items: [sealedWormhole] })),
  false,
  'new maps reject the retired hand-authored three-seal wormhole challenge'
);
const clonedWormholeMap = utils.cloneGameMap(baseMap({ items: [sealedWormhole] }));
assert.deepEqual(clonedWormholeMap.items[0].challenge, sealedWormholeChallenge);
assert.notStrictEqual(
  clonedWormholeMap.items[0].challenge,
  sealedWormholeChallenge,
  'wormhole challenge clone is detached from the submitted object'
);
assert.notStrictEqual(
  clonedWormholeMap.items[0].challenge.seals[0],
  sealedWormholeChallenge.seals[0],
  'wormhole seals are deep-cloned'
);
assert.notStrictEqual(
  clonedWormholeMap.items[0].challenge.obstacles[0],
  sealedWormholeChallenge.obstacles[0],
  'wormhole challenge walls are deep-cloned'
);

assert.equal(diceWormhole.DICE_ORIENTATIONS.length, 24, 'the die exposes all 24 physical orientations');
assert.equal(
  new Set(diceWormhole.DICE_ORIENTATIONS.map((faces) => (
    [faces.top, faces.bottom, faces.north, faces.south, faces.east, faces.west].join(',')
  ))).size,
  24,
  'every persisted orientation id has a unique physical face layout'
);
const oppositeDirection = { up: 'down', right: 'left', down: 'up', left: 'right' };
for (let orientation = 0; orientation < 24; orientation += 1) {
  const faces = diceWormhole.getDiceOrientationFaces(orientation);
  assert.equal(faces.top + faces.bottom, 7, `orientation ${orientation} keeps top/bottom opposite`);
  assert.equal(faces.north + faces.south, 7, `orientation ${orientation} keeps north/south opposite`);
  assert.equal(faces.east + faces.west, 7, `orientation ${orientation} keeps east/west opposite`);
  for (const direction of diceWormhole.DICE_WORMHOLE_DIRECTIONS) {
    const rolled = diceWormhole.rollDiceOrientation(orientation, direction);
    assert.equal(
      diceWormhole.rollDiceOrientation(rolled, oppositeDirection[direction]),
      orientation,
      `orientation ${orientation} ${direction} roll is reversible`
    );
  }
}

assert.equal(
  diceWormhole.isValidDiceWormholeChallenge(diceWormhole.DICE_WORMHOLE_FALLBACK_CHALLENGE),
  true,
  'the fixed generator fallback is always a valid 4x4 dice challenge'
);
assert.equal(
  diceWormhole.getDiceWormholeShortestSteps(diceWormhole.DICE_WORMHOLE_FALLBACK_CHALLENGE),
  6,
  'the fixed fallback has a six-action optimal solution'
);

for (let seed = 0; seed < 256; seed += 1) {
  const generated = diceWormhole.generateDiceWormholeChallenge(seed);
  const repeated = diceWormhole.generateDiceWormholeChallenge(seed);
  assert.deepEqual(repeated, generated, `dice challenge seed ${seed} is deterministic`);
  assert.equal(
    diceWormhole.isValidDiceWormholeChallenge(generated),
    true,
    `dice challenge seed ${seed} satisfies the complete V2 contract`
  );
  assert.equal(generated.boardSize, 4);
  assert.ok(generated.blockedCells.length >= 1 && generated.blockedCells.length <= 3);
  const shortestSteps = diceWormhole.getDiceWormholeShortestSteps(generated);
  assert.ok(shortestSteps >= 6 && shortestSteps <= 8, `seed ${seed} shortest route is 6-8 actions`);
}

const diceChallenge = diceWormhole.generateDiceWormholeChallenge(0xDAE0C);
const diceWormholeItem = wormhole(pos(0, 1), pos(4, 4), diceChallenge);
assert.equal(utils.isValidWormholeChallenge(diceChallenge), true, 'generic validator accepts V2 dice challenge');
assert.equal(
  utils.isValidNewMap(baseMap({ skillLoadout: 'scoutPulse', items: [diceWormholeItem] })),
  true,
  'new maps accept an auto-generated V2 dice wormhole'
);
assert.equal(
  diceWormhole.getDiceWormholeChallengeError({ ...diceChallenge, boardSize: 6 }),
  '지원하지 않는 주사위 웜홀 버전 또는 크기입니다.',
  'V2 challenges cannot silently expand back to the outer 6x6 board'
);
assert.equal(
  diceWormhole.isValidDiceWormholeChallenge({
    ...diceChallenge,
    blockedCells: [diceChallenge.startPosition],
  }),
  false,
  'a blocked cell cannot overlap the internal start'
);

const dicePath = diceWormhole.getDiceWormholeShortestPath(diceChallenge);
assert.ok(dicePath && dicePath.length >= 6, 'generated challenge exposes an optimal orientation-aware route');
const firstPathDirection = dicePath[0];
const firstPathPosition = {
  row: diceChallenge.startPosition.row + (firstPathDirection === 'up' ? -1 : firstPathDirection === 'down' ? 1 : 0),
  col: diceChallenge.startPosition.col + (firstPathDirection === 'left' ? -1 : firstPathDirection === 'right' ? 1 : 0),
};
const firstPathOrientation = diceWormhole.rollDiceOrientation(
  diceChallenge.initialOrientation,
  firstPathDirection
);
assert.equal(
  diceWormhole.getDiceWormholeShortestSteps(diceChallenge, {
    position: firstPathPosition,
    orientation: firstPathOrientation,
  }),
  dicePath.length - 1,
  'following the computed shortest path reduces the route by one action'
);

const clonedDiceMap = utils.cloneGameMap(baseMap({ items: [diceWormholeItem] }));
assert.deepEqual(clonedDiceMap.items[0].challenge, diceChallenge);
assert.notStrictEqual(clonedDiceMap.items[0].challenge, diceChallenge, 'V2 challenge clone is detached');
assert.notStrictEqual(
  clonedDiceMap.items[0].challenge.blockedCells[0],
  diceChallenge.blockedCells[0],
  'V2 blocked cells are deep-cloned'
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
  true,
  'an exit with an adjacent space does not need a guaranteed route to the goal'
);
assert.equal(
  utils.isValidMap(baseMap({
    items: [fake(5, 4), wormhole(pos(2, 2), pos(5, 5))],
  })),
  true,
  'one immediately open adjacent space is enough beside a wormhole exit'
);
const sealedExitWalls = [
  { position: pos(4, 5), direction: 'down' },
  { position: pos(5, 4), direction: 'right' },
];
assert.equal(
  utils.getWormholeExitOpenDirections(
    baseMap({ obstacles: sealedExitWalls }),
    pos(5, 5)
  ).length,
  0,
  'a corner exit with both inward edges blocked has no adjacent movement space'
);
assert.equal(
  utils.isValidMap(baseMap({
    obstacles: sealedExitWalls,
    items: [wormhole(pos(2, 2), pos(5, 5))],
  })),
  false,
  'a completely sealed wormhole exit remains invalid'
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

const fireKnowledgeMap = baseMap({
  obstacles: [{ position: pos(0, 0), direction: 'down' }],
  items: [specialWall('fireWall', 0, 0)],
});
const fireKnowledgeState = runtimeState(fireKnowledgeMap);
const actorKnownCollision = {
  playerId: 'a',
  position: pos(1, 1),
  direction: 'right',
  timestamp: 1,
  mapOwnerId: 'b',
};
const otherKnownCollision = {
  playerId: 'other',
  position: pos(2, 2),
  direction: 'down',
  timestamp: 2,
  mapOwnerId: 'b',
};
const actorRevealedWall = { position: pos(3, 3), direction: 'right' };
const otherRevealedWall = { position: pos(4, 4), direction: 'down' };
fireKnowledgeState.collisionWalls = {
  actor_old: actorKnownCollision,
  other_old: otherKnownCollision,
};
fireKnowledgeState.revealedWallsByPlayer = {
  a: [actorRevealedWall],
  other: [otherRevealedWall],
};
const fireHit = turns.resolveTurnAction(fireKnowledgeState, 'a', {
  type: 'move',
  direction: 'right',
}, 100);
assert.ok(fireHit, 'fire wall turn resolves');
assert.deepEqual(fireHit.outcome.position, pos(0, 0), 'fire blocks once');
assert.equal(fireHit.outcome.moves, 1, 'fire no longer adds a numeric move penalty');
assert.equal(fireHit.state.itemState.b.consumed[0], true, 'fire is consumed');
assert.equal(fireHit.state.visionEffectsByPlayer.a.type, 'fire', 'fire ignites the runner');
assert.equal(
  Object.values(fireHit.state.collisionWalls || {}).some((wall) => wall.playerId === 'a'),
  false,
  'ignition immediately erases only the burned runner\'s collision knowledge'
);
assert.deepEqual(fireHit.state.revealedWallsByPlayer.a, undefined);
assert.deepEqual(
  Object.values(fireHit.state.collisionWalls || {}).filter((wall) => wall.playerId === 'other'),
  [otherKnownCollision],
  'ignition preserves another runner\'s collision knowledge'
);
assert.deepEqual(fireHit.state.revealedWallsByPlayer.other, [otherRevealedWall]);
assert.equal(
  fireHit.state.visionEffectsByPlayer.a.expiresAtTargetMove,
  5,
  'fire burns learned wall knowledge for the next four actions'
);

let burningState = fireHit.state;
for (let actionNumber = 1; actionNumber <= 5; actionNumber += 1) {
  const staleReveal = { position: pos(actionNumber - 1, 5), direction: 'left' };
  burningState.revealedWallsByPlayer = {
    ...(burningState.revealedWallsByPlayer || {}),
    a: [staleReveal],
  };
  const burnedAction = turns.resolveTurnAction(burningState, 'a', {
    type: 'move',
    direction: 'down',
  }, 200 + actionNumber);
  assert.ok(burnedAction, `fire follow-up action ${actionNumber} resolves`);
  const actorCollisions = Object.values(burnedAction.state.collisionWalls || {})
    .filter((wall) => wall.playerId === 'a');
  assert.equal(actorCollisions.length, 1, 'each affected action forgets the previous collision');
  assert.equal(
    actorCollisions[0].timestamp,
    200 + actionNumber,
    'the collision learned by the current action remains visible until the next action'
  );
  assert.equal(
    burnedAction.state.revealedWallsByPlayer?.a,
    undefined,
    'each fire-ledger action deletes prior explicit wall reveals'
  );
  assert.deepEqual(
    Object.values(burnedAction.state.collisionWalls || {})
      .filter((wall) => wall.playerId === 'other'),
    [otherKnownCollision],
    'repeated burning never deletes another runner\'s wall knowledge'
  );
  assert.deepEqual(burnedAction.state.revealedWallsByPlayer.other, [otherRevealedWall]);
  if (actionNumber <= 4) {
    assert.equal(
      burnedAction.state.visionEffectsByPlayer?.a?.type,
      'fire',
      'the fire ledger remains through the fourth affected action'
    );
  } else {
    assert.equal(
      burnedAction.state.visionEffectsByPlayer?.a,
      undefined,
      'the fifth action clears the expired fire ledger after its pre-action wipe'
    );
  }
  burningState = burnedAction.state;
}
assert.equal(
  Object.values(burningState.collisionWalls || {})
    .find((wall) => wall.playerId === 'a')?.timestamp,
  205,
  'the fourth discovery is deleted before action five while action five\'s discovery is retained'
);

const fireSmokeMap = baseMap({
  obstacles: [{ position: pos(1, 0), direction: 'right' }],
  items: [
    specialWall('fireWall', 0, 0),
    smoke(1, 0),
  ],
});
const fireSmokeIgnition = turns.resolveTurnAction(runtimeState(fireSmokeMap), 'a', {
  type: 'move',
  direction: 'right',
}, 300);
assert.ok(fireSmokeIgnition, 'fire-smoke precedence fixture ignites');
const originalFireLedger = structuredClone(fireSmokeIgnition.state.visionEffectsByPlayer.a);
const smokeDuringFire = turns.resolveTurnAction(fireSmokeIgnition.state, 'a', {
  type: 'move',
  direction: 'down',
}, 301);
assert.ok(smokeDuringFire, 'an active fire runner can consume a smoke trap');
assert.equal(smokeDuringFire.outcome.effect, 'smoke');
assert.equal(smokeDuringFire.state.itemState.b.consumed[1], true, 'smoke is consumed under fire');
assert.deepEqual(
  smokeDuringFire.state.visionEffectsByPlayer.a,
  originalFireLedger,
  'smoke cannot replace or shorten an active four-action fire ledger'
);
assert.match(
  smokeDuringFire.outcome.message,
  /연막.*불길.*화염 상태/u,
  'the overlap message explains that fire continues after consuming smoke'
);
const collisionAfterBurnedSmoke = turns.resolveTurnAction(smokeDuringFire.state, 'a', {
  type: 'move',
  direction: 'right',
}, 302);
assert.ok(collisionAfterBurnedSmoke, 'fire remains active after the consumed smoke');
assert.equal(
  Object.values(collisionAfterBurnedSmoke.state.collisionWalls || {})
    .filter((wall) => wall.playerId === 'a').length,
  1,
  'the next affected action can temporarily learn a collision'
);
const cleanupAfterBurnedSmoke = turns.resolveTurnAction(collisionAfterBurnedSmoke.state, 'a', {
  type: 'move',
  direction: 'up',
}, 303);
assert.ok(cleanupAfterBurnedSmoke, 'the following active-fire action resolves');
assert.equal(
  Object.values(cleanupAfterBurnedSmoke.state.collisionWalls || {})
    .filter((wall) => wall.playerId === 'a').length,
  0,
  'fire still erases the prior collision after a smoke overlap'
);
assert.deepEqual(cleanupAfterBurnedSmoke.state.visionEffectsByPlayer.a, originalFireLedger);

const fakeHitMap = baseMap({ items: [fake(0, 0)] });
const fakeHit = resolveSpecial(fakeHitMap);
assert.deepEqual(fakeHit.outcome.position, pos(0, 0), 'fake wall blocks the first collision');
assert.equal(fakeHit.state.itemState.b.consumed[0], true, 'first collision consumes the fake wall');
const fakePass = turns.resolveTurnAction(fakeHit.state, 'a', {
  type: 'move',
  direction: 'right',
}, 101);
assert.ok(fakePass, 'the next move against a consumed fake wall resolves');
assert.deepEqual(fakePass.outcome.position, pos(0, 1), 'fake wall is passable after the first collision');
assert.equal(fakePass.outcome.wallEffect ?? null, null, 'the consumed fake wall no longer blocks');
const fakeCollisions = Object.values(fakeHit.state.collisionWalls || {});
assert.equal(fakeCollisions.length, 1, 'fake wall collision remains in the persisted turn history');
assert.deepEqual(
  utils.getVisibleCollisionWalls(fakeCollisions, fakeHitMap, fakeHit.state.itemState.b.consumed),
  fakeCollisions,
  'consumed fake wall stays rendered as an opaque discovered wall while becoming passable'
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
assert.equal(
  utils.getVisibleCollisionWalls(
    fakeCollisions,
    baseMap({ items: [specialWall('fireWall', 0, 0)] }),
    { 0: true }
  ).length,
  0,
  'a consumed non-fake dynamic wall still disappears from the rendered board'
);

const poisonPass = resolveSpecial(baseMap({ items: [specialWall('poisonWall', 0, 0)] }));
assert.deepEqual(poisonPass.outcome.position, pos(0, 1), 'poison allows passage');
assert.equal(poisonPass.outcome.moves, 1, 'poison no longer adds a numeric move penalty');
assert.equal(poisonPass.state.itemState.b.consumed[0], true, 'poison is consumed');
assert.equal(
  poisonPass.state.poisonEffectsByPlayer.a.expiresAtTargetMove,
  5,
  'poison lasts for the next four runner actions'
);

const cardinalDirections = ['up', 'right', 'down', 'left'];
function runtimeStateWithPoison(seed, {
  position = pos(2, 2),
  moves = 1,
  playedMap = baseMap(),
  expiresAtTargetMove = 10,
} = {}) {
  const poisonedState = runtimeState(playedMap, {
    position,
    history: [position],
    moves,
  });
  poisonedState.poisonEffectsByPlayer = {
    a: {
      sourcePlayerId: 'b',
      appliedAtTurn: 1,
      expiresAtTargetMove,
      seed,
    },
  };
  return poisonedState;
}

const poisonSeedByDirection = {};
for (let seed = 0; seed < 2_048 && Object.keys(poisonSeedByDirection).length < 4; seed += 1) {
  const sampled = turns.resolveTurnAction(runtimeStateWithPoison(seed), 'a', {
    type: 'move',
    direction: 'right',
  }, 300 + seed);
  assert.ok(sampled, `poison direction sample ${seed} resolves`);
  poisonSeedByDirection[sampled.outcome.direction] ??= seed;
}
assert.deepEqual(
  Object.keys(poisonSeedByDirection).sort(),
  [...cardinalDirections].sort(),
  'deterministic poison seeds cover all four cardinal results'
);

const requestIndependentResults = cardinalDirections.map((requestedDirection) => {
  const resolved = turns.resolveTurnAction(
    runtimeStateWithPoison(poisonSeedByDirection.down),
    'a',
    { type: 'move', direction: requestedDirection },
    500
  );
  assert.ok(resolved, `poison request ${requestedDirection} resolves`);
  return resolved.outcome.direction;
});
assert.deepEqual(
  new Set(requestIndependentResults),
  new Set(['down']),
  'the same poison seed and action choose the same direction regardless of requested input'
);

let poisonSequenceState = runtimeStateWithPoison(poisonSeedByDirection.left, {
  expiresAtTargetMove: 5,
});
for (let actionNumber = 1; actionNumber <= 4; actionNumber += 1) {
  const requestedSamples = cardinalDirections.map((requestedDirection) => {
    const sample = turns.resolveTurnAction(
      structuredClone(poisonSequenceState),
      'a',
      { type: 'move', direction: requestedDirection },
      600 + actionNumber
    );
    assert.ok(sample, `poisoned action ${actionNumber}/${requestedDirection} resolves`);
    return sample.outcome.direction;
  });
  assert.equal(
    new Set(requestedSamples).size,
    1,
    `poisoned action ${actionNumber} resolves randomly without consulting the requested direction`
  );
  const randomDirection = requestedSamples[0];
  const requestedDirection = cardinalDirections.find((direction) => direction !== randomDirection);
  const beforeMoves = poisonSequenceState.players.a.moves;
  const resolved = turns.resolveTurnAction(poisonSequenceState, 'a', {
    type: 'move',
    direction: requestedDirection,
  }, 700 + actionNumber);
  assert.ok(resolved, `poisoned sequence action ${actionNumber} resolves`);
  assert.equal(resolved.outcome.direction, randomDirection);
  assert.equal(resolved.outcome.requestedDirection, requestedDirection);
  assert.equal(resolved.outcome.poisonMisdirected, true);
  assert.equal(
    resolved.state.players.a.moves,
    beforeMoves + 1,
    'every random poison result consumes exactly one action, including a boundary bump'
  );
  poisonSequenceState = resolved.state;
}
assert.equal(
  poisonSequenceState.poisonEffectsByPlayer?.a,
  undefined,
  'the poison ledger expires after four randomized actions'
);
const poisonSequencePosition = poisonSequenceState.players.a.position;
const normalDirection = cardinalDirections.find((direction) => {
  const target = utils.getNewPosition(poisonSequencePosition, direction);
  return utils.isPositionInBoard(target)
    && !utils.isSamePosition(target, poisonSequenceState.maps.b.endPosition);
});
assert.ok(normalDirection, 'the fifth-action fixture has a safe ordinary direction');
const poisonFifthAction = turns.resolveTurnAction(poisonSequenceState, 'a', {
  type: 'move',
  direction: normalDirection,
}, 705);
assert.ok(poisonFifthAction, 'the fifth post-poison action resolves normally');
assert.equal(poisonFifthAction.outcome.direction, normalDirection);
assert.equal(poisonFifthAction.outcome.poisonMisdirected, undefined);

const poisonMainBoundaryState = runtimeStateWithPoison(poisonSeedByDirection.up, {
  position: pos(0, 0),
});
const poisonMainBoundary = turns.resolveTurnAction(poisonMainBoundaryState, 'a', {
  type: 'move',
  direction: 'right',
}, 800);
assert.ok(poisonMainBoundary, 'a poisoned out-of-bounds main-map action still resolves');
assert.equal(poisonMainBoundary.outcome.direction, 'up');
assert.equal(poisonMainBoundary.outcome.effect, 'bump');
assert.deepEqual(poisonMainBoundary.outcome.position, pos(0, 0));
assert.equal(poisonMainBoundary.state.players.a.moves, 2);
assert.equal(poisonMainBoundary.state.turnNumber, poisonMainBoundaryState.turnNumber + 1);

const icePass = resolveSpecial(baseMap({ items: [specialWall('iceWall', 0, 0)] }));
assert.equal(icePass.outcome.effect, 'bump', 'ice blocks the triggering crossing');
assert.deepEqual(icePass.outcome.position, pos(0, 0), 'ice keeps the runner at the origin');
assert.equal(icePass.outcome.moves, 2, 'ice makes the triggering input cost two moves total');
assert.equal(icePass.state.itemState.b.consumed[0], true, 'ice is consumed on its first collision');

const iceMineLanding = resolveSpecial(baseMap({
  items: [specialWall('iceWall', 0, 0), mine(0, 2)],
}));
assert.equal(iceMineLanding.outcome.effect, 'bump', 'ice no longer force-lands on a distant mine');
assert.deepEqual(iceMineLanding.outcome.position, pos(0, 0), 'ice collision remains at origin');
assert.equal(
  iceMineLanding.state.itemState.b.consumed[1],
  undefined,
  'a mine beyond ice remains armed'
);

const iceBlockedByCollapse = resolveSpecial(baseMap({
  items: [
    specialWall('iceWall', 0, 0),
    specialWall('collapseWall', 0, 1),
  ],
}), 'right', { itemState: { activeWalls: { 1: true } } });
assert.deepEqual(
  iceBlockedByCollapse.outcome.position,
  pos(0, 0),
  'ice never crosses its own triggering segment'
);
const afterIceDissipates = turns.resolveTurnAction(
  icePass.state,
  'a',
  { type: 'move', direction: 'right' },
  101
);
assert.ok(afterIceDissipates, 'movement resolves after ice dissipates');
assert.deepEqual(afterIceDissipates.outcome.position, pos(0, 1), 'consumed ice is passable');
assert.equal(afterIceDissipates.outcome.moves, 3, 'the next ordinary input costs one more move');

const windPass = resolveSpecial(baseMap({
  items: [specialWall('windWall', 0, 0, 'right', { effectDirection: 'down' })],
}));
assert.equal(windPass.outcome.effect, 'bump', 'wind blocks the triggering crossing');
assert.deepEqual(windPass.outcome.position, pos(1, 0), 'wind rebounds from origin in its selected direction');
assert.equal(windPass.state.itemState.b.consumed[0], true, 'wind wall is consumed after its first collision');

const windDefaultsToInput = resolveSpecial(baseMap({
  items: [specialWall('windWall', 0, 0)],
}));
assert.equal(windDefaultsToInput.outcome.effect, 'bump', 'wind remains a collision when direction is omitted');
assert.deepEqual(
  windDefaultsToInput.outcome.position,
  pos(0, 1),
  'wind defaults to the attempted direction and rebounds from origin'
);

const windReverse = resolveSpecial(baseMap({
  items: [specialWall('windWall', 0, 0, 'right', { effectDirection: 'left' })],
}));
assert.deepEqual(
  windReverse.outcome.position,
  pos(0, 0),
  'wind stays at origin when its rebound leaves the board'
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
  obstacles: [{ position: pos(0, 0), direction: 'down' }],
  items: [specialWall('windWall', 0, 0, 'right', { effectDirection: 'down' })],
}));
assert.deepEqual(blockedWindPush.outcome.position, pos(0, 0), 'wind stays at origin when a static wall blocks its rebound');
assert.match(blockedWindPush.state.turnMessage, /밀릴 칸이 막혀/, 'blocked wind message describes the actual outcome');
assert.equal(blockedWindPush.state.itemState.b.consumed[0], true, 'blocked wind still dissipates after collision');

const dynamicallyBlockedWindPush = resolveSpecial(baseMap({
  items: [
    specialWall('windWall', 0, 0, 'right', { effectDirection: 'down' }),
    specialWall('collapseWall', 0, 0, 'down'),
  ],
}), 'right', { itemState: { activeWalls: { 1: true } } });
assert.deepEqual(
  dynamicallyBlockedWindPush.outcome.position,
  pos(0, 0),
  'wind stays at origin when an active dynamic wall blocks its rebound'
);
assert.equal(dynamicallyBlockedWindPush.state.itemState.b.consumed[0], true, 'blocked wind is consumed');
assert.equal(
  dynamicallyBlockedWindPush.state.itemState.b.consumed[1],
  undefined,
  'the blocking dynamic wall is not consumed by the rebound'
);

const windGoalFallback = resolveSpecial(baseMap({
  endPosition: pos(1, 0),
  items: [specialWall('windWall', 0, 0, 'right', { effectDirection: 'down' })],
}));
assert.deepEqual(windGoalFallback.outcome.position, pos(0, 0), 'wind cannot rebound directly onto the goal');
assert.equal(windGoalFallback.outcome.reachedGoal, false, 'a wind rebound cannot finish the run');

const windSmokeLanding = resolveSpecial(baseMap({
  items: [
    specialWall('windWall', 0, 0, 'right', { effectDirection: 'down' }),
    smoke(1, 0),
  ],
}));
assert.equal(windSmokeLanding.outcome.effect, 'smoke', 'wind final landing triggers smoke');
assert.deepEqual(windSmokeLanding.outcome.position, pos(1, 0), 'smoke keeps the wind rebound cell');
assert.equal(windSmokeLanding.state.itemState.b.consumed[1], true, 'wind landing smoke is consumed');
assert.equal(
  windSmokeLanding.state.visionEffectsByPlayer.a.type,
  'smoke',
  'wind landing smoke applies the shared vision state'
);

const windWormholeLanding = resolveSpecial(baseMap({
  items: [
    specialWall('windWall', 0, 0, 'right', { effectDirection: 'down' }),
    wormhole(pos(1, 0), pos(3, 3)),
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
    history: [pos(5, 5), pos(4, 5), pos(0, 2)],
  }
);
assert.deepEqual(thornHit.outcome.position, pos(0, 1), 'thorn rebounds one cell opposite the attempted input');
assert.equal(thornHit.state.itemState.b.consumed[0], true, 'thorn is consumed');

const thornSmokeLanding = resolveSpecial(
  baseMap({ items: [specialWall('thornWall', 0, 2), smoke(0, 1)] }),
  'right',
  {
    position: pos(0, 2),
    history: [pos(0, 0), pos(0, 1), pos(0, 2)],
  }
);
assert.equal(thornSmokeLanding.outcome.effect, 'smoke', 'thorn rebound landing triggers smoke');
assert.deepEqual(thornSmokeLanding.outcome.position, pos(0, 1), 'thorn landing smoke keeps rebound cell');
assert.equal(thornSmokeLanding.state.itemState.b.consumed[0], true, 'thorn remains consumed');
assert.equal(thornSmokeLanding.state.itemState.b.consumed[1], true, 'thorn landing smoke is consumed');

const thornSafeFallback = resolveSpecial(
  baseMap({
    obstacles: [{ position: pos(0, 0), direction: 'right' }],
    items: [
      specialWall('thornWall', 0, 1),
    ],
  }),
  'right',
  {
    position: pos(0, 1),
    history: [pos(1, 1), pos(0, 1)],
  }
);
assert.deepEqual(
  thornSafeFallback.outcome.position,
  pos(0, 1),
  'thorn stays at origin when a static wall blocks the opposite step'
);

const thornDynamicFallback = resolveSpecial(
  baseMap({
    items: [
      specialWall('thornWall', 0, 1),
      specialWall('collapseWall', 0, 0),
    ],
  }),
  'right',
  {
    position: pos(0, 1),
    history: [pos(1, 1), pos(0, 1)],
    itemState: { activeWalls: { 1: true } },
  }
);
assert.deepEqual(
  thornDynamicFallback.outcome.position,
  pos(0, 1),
  'thorn stays at origin when an active dynamic wall blocks the opposite step'
);
assert.equal(thornDynamicFallback.state.itemState.b.consumed[0], true, 'dynamically blocked thorn is consumed');
assert.equal(
  thornDynamicFallback.state.itemState.b.consumed[1],
  undefined,
  'the dynamic rebound blocker remains active'
);

const thornBoundaryFallback = resolveSpecial(
  baseMap({ items: [specialWall('thornWall', 0, 0)] })
);
assert.deepEqual(thornBoundaryFallback.outcome.position, pos(0, 0), 'thorn stays at origin at the board edge');
assert.equal(thornBoundaryFallback.state.itemState.b.consumed[0], true, 'boundary thorn is consumed');

const thornGoalFallback = resolveSpecial(
  baseMap({
    endPosition: pos(0, 1),
    items: [specialWall('thornWall', 0, 2)],
  }),
  'right',
  { position: pos(0, 2), history: [pos(0, 2)] }
);
assert.deepEqual(thornGoalFallback.outcome.position, pos(0, 2), 'thorn cannot rebound directly onto the goal');
assert.equal(thornGoalFallback.outcome.reachedGoal, false, 'a thorn rebound cannot finish the run');
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

const legacyWormholePass = resolveSpecial(baseMap({
  items: [wormhole(pos(0, 1), pos(3, 3))],
}));
assert.equal(legacyWormholePass.outcome.effect, 'wormhole', 'legacy wormhole still triggers');
assert.deepEqual(
  legacyWormholePass.state.players.a.position,
  pos(3, 3),
  'legacy challenge-less wormhole keeps its immediate teleport behavior'
);
assert.equal(
  legacyWormholePass.state.wormholeRunsByPlayer,
  undefined,
  'legacy wormhole does not create an internal challenge run'
);

const diceRuntimeMap = baseMap({ items: [diceWormholeItem] });
const enteredDiceWormhole = resolveSpecial(diceRuntimeMap);
assert.equal(enteredDiceWormhole.outcome.effect, 'wormhole');
assert.equal(enteredDiceWormhole.outcome.realm, 'main');
assert.equal(enteredDiceWormhole.outcome.wormholeTransition, 'entered');
assert.deepEqual(enteredDiceWormhole.state.players.a.position, diceWormholeItem.entrance);
assert.deepEqual(
  enteredDiceWormhole.state.wormholeRunsByPlayer.a.position,
  diceChallenge.startPosition,
  'V2 entry starts at the generated internal start cell'
);
assert.equal(
  enteredDiceWormhole.state.wormholeRunsByPlayer.a.orientation,
  diceChallenge.initialOrientation,
  'V2 entry uses the generated initial die orientation'
);
assert.equal(
  enteredDiceWormhole.state.wormholeRunsByPlayer.a.actionsTaken,
  0,
  'entering the V2 room does not count as an internal die action'
);

function resolveSingleActorDiceMove(state, direction, now) {
  const resolved = turns.resolveTurnAction(state, 'a', { type: 'move', direction }, now);
  assert.ok(resolved, `V2 dice move ${direction} resolves`);
  return resolved;
}

let dicePathRuntimeState = structuredClone(enteredDiceWormhole.state);
let expectedDiceOrientation = diceChallenge.initialOrientation;
for (let index = 0; index < dicePath.length; index += 1) {
  const direction = dicePath[index];
  const previousExternalPosition = { ...dicePathRuntimeState.players.a.position };
  expectedDiceOrientation = diceWormhole.rollDiceOrientation(expectedDiceOrientation, direction);
  const rolled = resolveSingleActorDiceMove(dicePathRuntimeState, direction, 2_000 + index);
  if (index < dicePath.length - 1) {
    assert.equal(
      rolled.state.wormholeRunsByPlayer.a.orientation,
      expectedDiceOrientation,
      'each legal internal step rolls the physical die orientation'
    );
    assert.equal(rolled.state.wormholeRunsByPlayer.a.actionsTaken, index + 1);
    assert.deepEqual(
      rolled.state.players.a.position,
      previousExternalPosition,
      'the outer pawn stays pinned while the die moves internally'
    );
  } else {
    assert.equal(rolled.outcome.wormholeTransition, 'returned');
    assert.equal(rolled.outcome.realm, 'main');
    assert.equal(rolled.outcome.effect, 'wormhole');
    assert.deepEqual(
      rolled.state.players.a.position,
      diceWormholeItem.exit,
      'the correct exit orientation returns the pawn to the configured outer exit'
    );
    assert.equal(rolled.state.wormholeRunsByPlayer, undefined);
  }
  dicePathRuntimeState = rolled.state;
}
assert.equal(
  dicePathRuntimeState.players.a.moves,
  1 + dicePath.length,
  'entry and every shortest-path die roll each cost exactly one move'
);

function findWrongTopDicePath(challenge) {
  const queue = [{
    position: challenge.startPosition,
    orientation: challenge.initialOrientation,
    path: [],
  }];
  const visited = new Set([
    `${challenge.startPosition.row},${challenge.startPosition.col}:${challenge.initialOrientation}`,
  ]);
  while (queue.length > 0) {
    const current = queue.shift();
    for (const direction of diceWormhole.DICE_WORMHOLE_DIRECTIONS) {
      const position = utils.getNewPosition(current.position, direction);
      if (!diceWormhole.isDiceWormholePosition(position)
        || challenge.blockedCells.some((cell) => utils.isSamePosition(cell, position))) continue;
      const orientation = diceWormhole.rollDiceOrientation(current.orientation, direction);
      const path = [...current.path, direction];
      const atExit = utils.isSamePosition(position, challenge.endPosition);
      const correctTop = diceWormhole.getDiceOrientationFaces(orientation).top === challenge.targetTop;
      if (atExit && !correctTop) return path;
      // A real run would already have returned at the solved exit state.
      if (atExit && correctTop) continue;
      const key = `${position.row},${position.col}:${orientation}`;
      if (visited.has(key)) continue;
      visited.add(key);
      queue.push({ position, orientation, path });
    }
  }
  return null;
}

const wrongTopPath = findWrongTopDicePath(diceChallenge);
assert.ok(wrongTopPath?.length, 'the generated fixture has a physically reachable wrong-top exit');
let wrongTopState = structuredClone(enteredDiceWormhole.state);
let wrongTopArrival;
for (let index = 0; index < wrongTopPath.length; index += 1) {
  wrongTopArrival = resolveSingleActorDiceMove(wrongTopState, wrongTopPath[index], 2_100 + index);
  wrongTopState = wrongTopArrival.state;
}
assert.ok(wrongTopArrival, 'the wrong-top fixture reaches the internal exit');
assert.deepEqual(wrongTopArrival.outcome.position, diceChallenge.endPosition);
assert.match(wrongTopArrival.outcome.message, /출구.*윗면|윗면.*맞춰/u);
assert.ok(
  wrongTopArrival.state.wormholeRunsByPlayer.a,
  'reaching the V2 exit with the wrong top face keeps the player locked inside'
);
assert.deepEqual(wrongTopArrival.state.players.a.position, diceWormholeItem.entrance);

function isolatedDiceRunState({ position, orientation, actionsTaken }) {
  const state = structuredClone(enteredDiceWormhole.state);
  state.wormholeRunsByPlayer.a.position = { ...position };
  state.wormholeRunsByPlayer.a.orientation = orientation;
  state.wormholeRunsByPlayer.a.actionsTaken = actionsTaken;
  state.players.a.moves = 1 + actionsTaken;
  return state;
}

let blockerFixture = null;
for (let row = 0; row < 4 && !blockerFixture; row += 1) {
  for (let col = 0; col < 4 && !blockerFixture; col += 1) {
    const origin = pos(row, col);
    if (diceChallenge.blockedCells.some((cell) => utils.isSamePosition(cell, origin))) continue;
    for (const direction of diceWormhole.DICE_WORMHOLE_DIRECTIONS) {
      const target = utils.getNewPosition(origin, direction);
      if (diceChallenge.blockedCells.some((cell) => utils.isSamePosition(cell, target))) {
        blockerFixture = { origin, direction };
        break;
      }
    }
  }
}
assert.ok(blockerFixture, 'the generated blocker has an adjacent walkable test cell');
const blockerState = isolatedDiceRunState({
  position: blockerFixture.origin,
  orientation: diceChallenge.initialOrientation,
  actionsTaken: 3,
});
const blockerHit = resolveSingleActorDiceMove(blockerState, blockerFixture.direction, 2_200);
assert.equal(blockerHit.outcome.effect, 'bump');
assert.deepEqual(blockerHit.state.wormholeRunsByPlayer.a.position, blockerFixture.origin);
assert.equal(
  blockerHit.state.wormholeRunsByPlayer.a.orientation,
  diceChallenge.initialOrientation,
  'a blocked cell consumes an action without rolling the die'
);
assert.equal(blockerHit.state.wormholeRunsByPlayer.a.actionsTaken, 4);
assert.equal(blockerHit.state.players.a.moves, blockerState.players.a.moves + 1);

const boundaryFixture = (() => {
  for (let row = 0; row < 4; row += 1) {
    for (let col = 0; col < 4; col += 1) {
      const position = pos(row, col);
      if (diceChallenge.blockedCells.some((cell) => utils.isSamePosition(cell, position))) continue;
      if (row === 0) return { position, direction: 'up' };
      if (row === 3) return { position, direction: 'down' };
      if (col === 0) return { position, direction: 'left' };
      if (col === 3) return { position, direction: 'right' };
    }
  }
  return null;
})();
assert.ok(boundaryFixture, 'the V2 board exposes a non-blocked boundary cell');
const boundaryState = isolatedDiceRunState({
  position: boundaryFixture.position,
  orientation: diceChallenge.initialOrientation,
  actionsTaken: 4,
});
const boundaryHit = resolveSingleActorDiceMove(boundaryState, boundaryFixture.direction, 2_201);
assert.equal(boundaryHit.outcome.effect, 'bump');
assert.deepEqual(boundaryHit.state.wormholeRunsByPlayer.a.position, boundaryFixture.position);
assert.equal(boundaryHit.state.wormholeRunsByPlayer.a.orientation, diceChallenge.initialOrientation);
assert.equal(boundaryHit.state.wormholeRunsByPlayer.a.actionsTaken, 5);
assert.equal(boundaryHit.state.players.a.moves, boundaryState.players.a.moves + 1);

const noHintState = isolatedDiceRunState({
  position: diceChallenge.startPosition,
  orientation: diceChallenge.initialOrientation,
  actionsTaken: 9,
});
const noHintRoll = resolveSingleActorDiceMove(noHintState, dicePath[0], 2_300);
assert.equal(noHintRoll.state.wormholeRunsByPlayer.a.actionsTaken, 10);
assert.doesNotMatch(
  noHintRoll.outcome.message,
  /힌트|다음 방향|방향을 알려줍니다/u,
  'the tenth and later internal actions never reveal a route hint'
);

let wormholeRelayState = {
  phase: types.GamePhase.PLAY,
  currentTurn: 'a',
  turnNumber: 1,
  turnOrder: ['a', 'b'],
  players: {
    a: {
      id: 'a',
      position: pos(0, 0),
      positionHistory: [pos(0, 0)],
      moves: 0,
      isReady: true,
    },
    b: {
      id: 'b',
      position: pos(0, 0),
      positionHistory: [pos(0, 0)],
      moves: 0,
      isReady: true,
    },
  },
  assignments: { a: 'b', b: 'a' },
  maps: {
    a: baseMap(),
    b: baseMap({ items: [sealedWormhole] }),
  },
};
let wormholeNow = 1_000;

function resolveRelayMove(actorId, direction) {
  assert.equal(wormholeRelayState.currentTurn, actorId, `${actorId} owns the current relay turn`);
  const beforeTurn = wormholeRelayState.turnNumber;
  const beforeMoves = wormholeRelayState.players[actorId].moves || 0;
  const resolved = turns.resolveTurnAction(
    wormholeRelayState,
    actorId,
    { type: 'move', direction },
    wormholeNow++
  );
  assert.ok(resolved, `${actorId} relay move resolves`);
  assert.equal(
    resolved.state.turnNumber,
    beforeTurn + 1,
    'every outer or wormhole action advances the shared turn number exactly once'
  );
  assert.equal(
    resolved.state.players[actorId].moves,
    beforeMoves + 1,
    'every outer or wormhole action costs the acting player exactly one move'
  );
  assert.equal(
    resolved.state.currentTurn,
    actorId === 'a' ? 'b' : 'a',
    'outer and wormhole actions both alternate the relay turn'
  );
  wormholeRelayState = resolved.state;
  return resolved;
}

function resolveChallengeMove(direction) {
  if (wormholeRelayState.currentTurn === 'b') {
    const relayDirection = wormholeRelayState.players.b.position.row === 0 ? 'down' : 'up';
    resolveRelayMove('b', relayDirection);
  }
  const externalPosition = { ...wormholeRelayState.players.a.position };
  const resolved = resolveRelayMove('a', direction);
  if (resolved.outcome.wormholeTransition !== 'returned') {
    assert.deepEqual(
      wormholeRelayState.players.a.position,
      externalPosition,
      'external player position stays pinned to the entrance during the challenge'
    );
  }
  return resolved;
}

const enteredWormhole = resolveRelayMove('a', 'right');
assert.equal(enteredWormhole.outcome.effect, 'wormhole');
assert.equal(enteredWormhole.outcome.realm, 'main');
assert.equal(enteredWormhole.outcome.wormholeTransition, 'entered');
assert.deepEqual(
  enteredWormhole.state.players.a.position,
  sealedWormhole.entrance,
  'challenge entry pins the external player to the configured entrance'
);
assert.deepEqual(
  enteredWormhole.state.wormholeRunsByPlayer.a.position,
  sealedWormholeChallenge.startPosition,
  'challenge entry starts the internal run at its configured start cell'
);
assert.deepEqual(
  enteredWormhole.outcome.wormholeExit,
  sealedWormholeChallenge.startPosition,
  'entry outcome points the board transition at the internal start cell'
);
assert.equal(enteredWormhole.state.itemState.b.consumed[0], true, 'entry consumes the outer wormhole once');

const poisonedWormholeState = structuredClone(enteredWormhole.state);
poisonedWormholeState.currentTurn = 'a';
poisonedWormholeState.poisonEffectsByPlayer = {
  a: {
    sourcePlayerId: 'b',
    appliedAtTurn: 1,
    expiresAtTargetMove: 10,
    seed: poisonSeedByDirection.up,
  },
};
const poisonedWormholeMove = turns.resolveTurnAction(poisonedWormholeState, 'a', {
  type: 'move',
  direction: 'right',
}, wormholeNow++);
assert.ok(poisonedWormholeMove, 'poison direction selection resolves inside a wormhole challenge');
assert.equal(poisonedWormholeMove.outcome.poisonMisdirected, true);
assert.equal(poisonedWormholeMove.outcome.requestedDirection, 'right');
assert.equal(poisonedWormholeMove.outcome.direction, 'up');
assert.equal(poisonedWormholeMove.outcome.effect, 'bump');
assert.deepEqual(
  poisonedWormholeMove.state.wormholeRunsByPlayer.a.position,
  pos(0, 0),
  'a randomized V1 wormhole boundary hit keeps the internal position fixed'
);
assert.equal(
  poisonedWormholeMove.state.players.a.moves,
  enteredWormhole.state.players.a.moves + 1,
  'a randomized V1 wormhole boundary hit consumes exactly one action'
);
assert.equal(
  poisonedWormholeMove.state.turnNumber,
  enteredWormhole.state.turnNumber + 1,
  'a randomized V1 wormhole boundary hit advances the shared turn once'
);

const internalWallHit = resolveChallengeMove('right');
assert.equal(internalWallHit.outcome.effect, 'bump', 'an internal challenge wall blocks movement');
assert.equal(internalWallHit.outcome.realm, 'wormhole');
assert.deepEqual(internalWallHit.outcome.position, pos(0, 0));
assert.deepEqual(
  internalWallHit.state.wormholeRunsByPlayer.a.discoveredWalls,
  [{ position: pos(0, 0), direction: 'right' }],
  'an internal collision is remembered inside the private wormhole run'
);
assert.equal(
  Object.keys(internalWallHit.state.collisionWalls || {}).length,
  0,
  'an internal collision does not leak into the outer map collision history'
);

const burningWormholeState = structuredClone(internalWallHit.state);
burningWormholeState.currentTurn = 'a';
burningWormholeState.visionEffectsByPlayer = {
  a: {
    type: 'fire',
    sourcePlayerId: 'b',
    appliedAtTurn: burningWormholeState.turnNumber,
    expiresAtTargetMove: burningWormholeState.players.a.moves + 2,
  },
};
const otherRunnerWall = { position: pos(2, 1), direction: 'right' };
const otherWormholeRun = {
  ...structuredClone(burningWormholeState.wormholeRunsByPlayer.a),
  mapOwnerId: 'a',
  discoveredWalls: [otherRunnerWall],
};
burningWormholeState.wormholeRunsByPlayer.b = otherWormholeRun;
const burningWormholeMove = turns.resolveTurnAction(burningWormholeState, 'a', {
  type: 'move',
  direction: 'down',
}, wormholeNow++);
assert.ok(burningWormholeMove, 'an active-fire V1 wormhole action resolves');
assert.equal(
  burningWormholeMove.state.wormholeRunsByPlayer.a.discoveredWalls,
  undefined,
  'fire erases the acting runner\'s previously discovered V1 internal wall'
);
assert.deepEqual(
  burningWormholeMove.state.wormholeRunsByPlayer.b,
  otherWormholeRun,
  'fire never erases another runner\'s V1 internal wall knowledge'
);

const lockedExit = resolveChallengeMove('down');
assert.deepEqual(lockedExit.outcome.position, sealedWormholeChallenge.endPosition);
assert.match(lockedExit.outcome.message, /잠겨/, 'the internal exit reports that it is locked');
assert.ok(
  lockedExit.state.wormholeRunsByPlayer.a,
  'reaching the internal exit before all seals does not return to the main map'
);
assert.deepEqual(lockedExit.state.players.a.position, sealedWormhole.entrance);

for (let step = 0; step < 5; step += 1) resolveChallengeMove('right');
const firstSeal = resolveChallengeMove('up');
assert.equal(firstSeal.outcome.wormholeTransition, 'seal');
assert.equal(firstSeal.state.wormholeRunsByPlayer.a.activatedSeals[0], true);

let secondSeal;
for (let step = 0; step < 5; step += 1) secondSeal = resolveChallengeMove('down');
assert.equal(secondSeal.outcome.wormholeTransition, 'seal');
assert.equal(secondSeal.state.wormholeRunsByPlayer.a.activatedSeals[1], true);

let thirdSeal;
for (let step = 0; step < 5; step += 1) thirdSeal = resolveChallengeMove('left');
assert.equal(thirdSeal.outcome.wormholeTransition, 'seal');
assert.deepEqual(
  thirdSeal.state.wormholeRunsByPlayer.a.activatedSeals,
  { 0: true, 1: true, 2: true },
  'all three configured seals activate independently'
);
assert.deepEqual(
  thirdSeal.state.players.a.position,
  sealedWormhole.entrance,
  'activating the final seal alone does not teleport the player out'
);

for (let step = 0; step < 3; step += 1) resolveChallengeMove('up');
const returnedFromWormhole = resolveChallengeMove('up');
assert.equal(returnedFromWormhole.outcome.realm, 'main');
assert.equal(returnedFromWormhole.outcome.wormholeTransition, 'returned');
assert.equal(returnedFromWormhole.outcome.effect, 'wormhole');
assert.deepEqual(
  returnedFromWormhole.state.players.a.position,
  sealedWormhole.exit,
  'the unlocked internal exit returns to the creator-configured outer exit'
);
assert.equal(
  returnedFromWormhole.state.wormholeRunsByPlayer,
  undefined,
  'the private challenge run is removed after a successful return'
);
assert.deepEqual(
  returnedFromWormhole.state.players.a.positionHistory,
  [pos(0, 0), sealedWormhole.entrance, sealedWormhole.exit],
  'internal steps stay out of outer history while entry and return are recorded'
);
assert.equal(
  returnedFromWormhole.state.players.a.moves,
  23,
  'entry, collision, locked-exit visit, seal route, and return all count toward moves'
);

const unsafeRuntimeMap = baseMap({
  obstacles: [
    { position: pos(4, 5), direction: 'down' },
    { position: pos(5, 4), direction: 'right' },
  ],
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

const forcedGoalFallbackMap = baseMap({
  endPosition: pos(5, 4),
  items: [specialWall('mirrorWall', 0, 0), mine(5, 4)],
});
const forcedGoalFallback = resolveSpecial(forcedGoalFallbackMap);
assert.equal(forcedGoalFallback.outcome.reachedGoal, false, 'forced movement cannot finish on the goal');
assert.deepEqual(
  forcedGoalFallback.outcome.position,
  pos(0, 1),
  'a goal-targeted forced effect falls back to the ordinary crossed cell'
);
assert.equal(
  forcedGoalFallback.state.itemState?.b?.consumed?.[1],
  undefined,
  'a trap on the rejected forced destination remains armed'
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

for (const [skillId, direction] of [
  ['scoutPulse', undefined],
  ['breach', 'right'],
  ['anchor', undefined],
  ['dash', 'right'],
]) {
  const action = { type: 'skill', skillId, ...(direction ? { direction } : {}) };
  assert.equal(
    turns.resolveTurnAction(skillRuntimeState(skillId, baseMap()), 'a', action, 200),
    null,
    `${skillId} is rejected after skill retirement`
  );
}

const retiredDetectorState = skillRuntimeState('scoutPulse', baseMap());
retiredDetectorState.maps.a.items = [radar()];
assert.equal(
  turns.resolveTurnAction(retiredDetectorState, 'a', { type: 'radar', itemIndex: 0 }, 201),
  null,
  'detector action is rejected even when a legacy map still contains one'
);

const legacyAnchorState = skillRuntimeState(
  'anchor',
  baseMap({ items: [mine(0, 1)] }),
  {
    itemState: {
      a: { mazeSkill: { version: 1, loadout: ['anchor'], consumed: {} } },
    },
  }
);
const ordinaryMine = turns.resolveTurnAction(
  legacyAnchorState,
  'a',
  { type: 'move', direction: 'right' },
  204
);
assert.ok(ordinaryMine, 'legacy anchor map still resolves ordinary movement');
assert.equal(ordinaryMine.outcome.effect, 'mine', 'retired anchor cannot cancel a mine');
assert.deepEqual(ordinaryMine.outcome.position, pos(0, 0), 'mine performs its normal rollback');
assert.equal(ordinaryMine.outcome.skillEffect, undefined, 'no passive skill effect is reported');
assert.deepEqual(
  ordinaryMine.state.itemState.a.mazeSkill,
  legacyAnchorState.itemState.a.mazeSkill,
  'legacy skill state remains inert and unconsumed'
);
assert.equal(ordinaryMine.state.itemState.b.consumed[0], true, 'ordinary mine is consumed');

const legacyAnchorItemState = {
  a: { mazeSkill: { version: 1, loadout: ['anchor'], consumed: {} } },
};
const ordinaryWormhole = turns.resolveTurnAction(
  skillRuntimeState(
    'anchor',
    baseMap({ items: [wormhole(pos(0, 1), pos(3, 3))] }),
    { itemState: legacyAnchorItemState }
  ),
  'a',
  { type: 'move', direction: 'right' },
  205
);
assert.ok(ordinaryWormhole, 'legacy anchor map resolves wormhole movement');
assert.equal(ordinaryWormhole.outcome.effect, 'wormhole', 'retired anchor cannot cancel a wormhole');
assert.deepEqual(ordinaryWormhole.outcome.position, pos(3, 3), 'wormhole teleports normally');

const ordinaryIceWall = turns.resolveTurnAction(
  skillRuntimeState(
    'anchor',
    baseMap({ items: [specialWall('iceWall', 0, 0)] }),
    { itemState: legacyAnchorItemState }
  ),
  'a',
  { type: 'move', direction: 'right' },
  206
);
assert.ok(ordinaryIceWall, 'legacy anchor map resolves ice wall movement');
assert.deepEqual(ordinaryIceWall.outcome.position, pos(0, 0), 'retired anchor cannot cancel an ice block');
assert.equal(ordinaryIceWall.outcome.moves, 2, 'retired anchor cannot cancel the ice move penalty');

const practiceAiItemTypes = new Set();
for (const [index, map] of practice.PRACTICE_MAP_TEMPLATES.entries()) {
  assert.equal(utils.isValidMap(map), true, `practice template ${index + 1} remains valid`);
  assert.equal(
    utils.isValidNewMap(map),
    true,
    `practice template ${index + 1} uses only the active new-map catalog`
  );
  assert.equal(
    utils.getMapBudgetUsed(map),
    utils.MAX_OBSTACLES,
    `practice template ${index + 1} spends the full wall budget`
  );
  const manhattan = Math.abs(map.startPosition.row - map.endPosition.row) +
    Math.abs(map.startPosition.col - map.endPosition.col);
  assert.ok(
    practice.getPracticeMapRouteLength(map) >= manhattan,
    `practice template ${index + 1} keeps a reachable non-shortcut route to the exit`
  );
  assert.equal(
    map.skillLoadout,
    utils.DEFAULT_MAZE_SKILL,
    `practice template ${index + 1} keeps only the inert V3 compatibility loadout`
  );
  for (const retiredItemType of utils.RETIRED_NEW_MAP_ITEM_TYPES) {
    assert.equal(
      (map.items || []).some((item) => item.type === retiredItemType),
      false,
      `practice template ${index + 1} does not include retired ${retiredItemType}`
    );
  }
}
for (let index = 0; index < 3; index += 1) {
  for (const item of practice.createAiPracticeMap(index).items || []) {
    practiceAiItemTypes.add(item.type);
  }
}
assert.deepEqual(
  [...practiceAiItemTypes].sort(),
  Object.keys(utils.ITEM_COSTS)
    .filter((itemType) => !utils.isRetiredNewMapItemType(itemType))
    .sort(),
  'the three AI maps use every currently available trap and special wall'
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
    assert.equal(action.type, 'move', `${label}: ${actorId} only uses movement actions`);
    const resolved = turns.resolveTurnAction(state, actorId, action, 10_000 + step);
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
const sparseMapTestState = practice.createMapTestGameState(baseMap());
assert.equal(
  utils.getMapBudgetUsed(sparseMapTestState.maps[practice.PRACTICE_USER_ID]),
  0,
  'solo map test accepts a valid 0/24 map without auto-filling the unused budget'
);
assert.deepEqual(
  sparseMapTestState.maps[practice.PRACTICE_USER_ID].obstacles,
  [],
  'solo map test preserves the creator\'s sparse wall list'
);
assert.throws(
  () => practice.createMapTestGameState(baseMap({
    obstacles: [
      { position: pos(0, 0), direction: 'right' },
      { position: pos(0, 0), direction: 'down' },
    ],
  })),
  /valid map/,
  'solo map test still rejects a map whose start is isolated'
);
const completedMapTest = simulatePracticeState(
  practice.createMapTestGameState(practice.PRACTICE_MAP_TEMPLATES[0]),
  'solo creator map test'
);
assert.equal(completedMapTest.winner, practice.PRACTICE_USER_ID, 'solo map test records the creator as winner');

console.log('game rule regression tests passed');
