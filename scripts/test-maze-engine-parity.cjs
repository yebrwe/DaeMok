#!/usr/bin/env node

'use strict';

const assert = require('node:assert/strict');
const childProcess = require('node:child_process');
const fs = require('node:fs');
const Module = require('node:module');
const os = require('node:os');
const path = require('node:path');
const ts = require('typescript');

const ROOT = path.resolve(__dirname, '..');
const VENDOR_ROOT = path.join(ROOT, 'functions', 'vendor', 'maze-engine');
const VENDOR_DIST = path.join(VENDOR_ROOT, 'dist');
const FIXED_NOW = 1_720_000_000_000;

function runNodeScript(args, label) {
  const result = childProcess.spawnSync(process.execPath, args, {
    cwd: ROOT,
    encoding: 'utf8',
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error([
      `${label} failed with exit code ${result.status}`,
      result.stdout,
      result.stderr,
    ].filter(Boolean).join('\n'));
  }
}

function relativeArtifacts(directory) {
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      return relativeArtifacts(absolute).map((file) => path.join(entry.name, file));
    }
    return entry.name.endsWith('.js') || entry.name.endsWith('.d.ts') ? [entry.name] : [];
  }).sort();
}

function assertVendorArtifactsAreFresh() {
  runNodeScript(
    [path.join(ROOT, 'scripts', 'generate-maze-engine-vendor.cjs'), '--check'],
    'maze vendor source drift check'
  );

  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'daemok-maze-engine-parity-'));
  try {
    runNodeScript([
      require.resolve('typescript/bin/tsc'),
      '-p',
      path.join(VENDOR_ROOT, 'tsconfig.json'),
      '--outDir',
      temporaryRoot,
    ], 'maze vendor temporary compilation');

    const expectedArtifacts = relativeArtifacts(temporaryRoot);
    const committedArtifacts = relativeArtifacts(VENDOR_DIST);
    assert.deepEqual(
      committedArtifacts,
      expectedArtifacts,
      'functions/vendor/maze-engine/dist artifact set drifted from generated vendor source'
    );

    for (const relativePath of expectedArtifacts) {
      const expected = fs.readFileSync(path.join(temporaryRoot, relativePath));
      const committed = fs.readFileSync(path.join(VENDOR_DIST, relativePath));
      assert.deepEqual(
        committed,
        expected,
        `functions/vendor/maze-engine/dist/${relativePath} is stale or manually modified`
      );
    }
  } finally {
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }
}

function loadTypeScript(relativePath, aliases = {}) {
  const filename = path.join(ROOT, relativePath);
  const source = fs.readFileSync(filename, 'utf8');
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
    fileName: filename,
    reportDiagnostics: true,
  });
  const diagnostics = compiled.diagnostics || [];
  if (diagnostics.length > 0) {
    throw new Error(ts.formatDiagnosticsWithColorAndContext(diagnostics, {
      getCanonicalFileName: (fileName) => fileName,
      getCurrentDirectory: () => ROOT,
      getNewLine: () => '\n',
    }));
  }

  const loaded = new Module(filename, module);
  loaded.filename = filename;
  loaded.paths = Module._nodeModulePaths(path.dirname(filename));
  loaded.require = (request) => Object.prototype.hasOwnProperty.call(aliases, request)
    ? aliases[request]
    : require(request);
  loaded._compile(compiled.outputText, filename);
  return loaded.exports;
}

function loadCanonicalEngine() {
  const GameTypes = loadTypeScript('src/types/game.ts');
  const DiceWormhole = loadTypeScript('src/lib/diceWormhole.ts', {
    '@/types/game': GameTypes,
  });
  const GameUtils = loadTypeScript('src/lib/gameUtils.ts', {
    '@/types/game': GameTypes,
    '@/lib/diceWormhole': DiceWormhole,
  });
  const MazeSkills = loadTypeScript('src/lib/mazeSkills.ts');
  const GameRules = loadTypeScript('src/lib/gameRules.ts', {
    '@/types/game': GameTypes,
    '@/lib/gameUtils': GameUtils,
    '@/lib/mazeSkills': MazeSkills,
  });
  const GameTurn = loadTypeScript('src/lib/gameTurn.ts', {
    '@/types/game': GameTypes,
    '@/lib/gameUtils': GameUtils,
    '@/lib/diceWormhole': DiceWormhole,
    '@/lib/mazeSkills': MazeSkills,
  });
  return { GameTypes, DiceWormhole, GameUtils, MazeSkills, GameRules, GameTurn };
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function position(row, col) {
  return { row, col };
}

function wall(row, col, direction) {
  return { position: position(row, col), direction };
}

function wallItem(type, row, col, direction = 'right', extra = {}) {
  return {
    type,
    wallPosition: position(row, col),
    wallDirection: direction,
    ...extra,
  };
}

const DICE_WORMHOLE_CHALLENGE = {
  version: 2,
  boardSize: 4,
  startPosition: position(0, 0),
  endPosition: position(3, 3),
  blockedCells: [position(1, 1), position(2, 2)],
  initialOrientation: 0,
  targetTop: 2,
};

const LEGACY_WORMHOLE_CHALLENGE = {
  version: 1,
  startPosition: position(0, 0),
  endPosition: position(1, 0),
  seals: [position(0, 5), position(5, 5), position(5, 0)],
  obstacles: [
    wall(0, 0, 'right'),
    wall(2, 1, 'right'),
    wall(3, 2, 'right'),
    wall(4, 3, 'right'),
  ],
};

function gameMap(overrides = {}) {
  return {
    rulesVersion: 4,
    skillLoadout: 'scoutPulse',
    runnerGear: 'none',
    startPosition: position(0, 0),
    endPosition: position(5, 5),
    obstacles: [],
    items: [],
    ...overrides,
  };
}

function skillState(skillId) {
  return {
    version: 1,
    loadout: [skillId],
    consumed: {},
  };
}

function runtimeState(playedMap, options = {}) {
  const actorPosition = options.position || playedMap.startPosition;
  const equippedSkill = options.skill || 'scoutPulse';
  const ownMap = gameMap({
    skillLoadout: equippedSkill,
    items: options.ownItems || [],
  });
  return {
    rulesVersion: 4,
    matchNumber: 1,
    phase: 'play',
    currentTurn: 'a',
    turnOrder: ['a'],
    turnNumber: options.turnNumber || 1,
    players: {
      a: {
        id: 'a',
        displayName: 'A',
        position: actorPosition,
        positionHistory: options.history || [actorPosition],
        moves: options.moves || 0,
        isReady: true,
        isOnline: true,
        finished: false,
        forfeited: false,
      },
    },
    maps: { a: ownMap, b: playedMap },
    assignments: { a: 'b' },
    itemState: {
      a: { consumed: {}, mazeSkill: skillState(equippedSkill) },
      b: { consumed: {}, ...(options.playedItemState || {}) },
    },
    collisionWalls: {},
    revealedWallsByPlayer: {},
    visionEffectsByPlayer: {},
  };
}

function terminalState(opponentFinishMoves) {
  const state = runtimeState(gameMap({ endPosition: position(0, 5) }), {
    position: position(0, 4),
    history: [position(0, 3), position(0, 4)],
    moves: 2,
    skill: 'dash',
  });
  state.turnOrder = ['a', 'b'];
  state.players.b = {
    id: 'b',
    displayName: 'B',
    position: position(0, 5),
    positionHistory: [position(0, 5)],
    moves: opponentFinishMoves,
    finishMoves: opponentFinishMoves,
    isReady: true,
    isOnline: true,
    finished: true,
    forfeited: false,
  };
  state.assignments.b = 'a';
  return state;
}

function resolutionAt(run, index = 0) {
  const resolution = run.resolutions[index];
  assert.ok(resolution, `expected transcript step ${index + 1} to resolve`);
  return resolution;
}

function runTranscript(engine, fixture) {
  let state = clone(fixture.state);
  const resolutions = [];
  fixture.steps.forEach((step, index) => {
    const resolution = engine.GameTurn.resolveTurnAction(
      state,
      step.actorId || 'a',
      clone(step.action),
      step.now || FIXED_NOW + index
    );
    resolutions.push(resolution);
    if (resolution) state = resolution.state;
  });
  return { resolutions, state };
}

function deterministicFixtures() {
  const fixtures = [
    {
      name: 'open movement',
      state: runtimeState(gameMap()),
      steps: [{ action: { type: 'move', direction: 'right' } }],
      verify(run) {
        const resolved = resolutionAt(run);
        assert.equal(resolved.outcome.effect, 'move');
        assert.deepEqual(resolved.outcome.position, position(0, 1));
      },
    },
    {
      name: 'ordinary wall collision',
      state: runtimeState(gameMap({ obstacles: [wall(0, 0, 'right')] })),
      steps: [{ action: { type: 'move', direction: 'right' } }],
      verify(run) {
        const resolved = resolutionAt(run);
        assert.equal(resolved.outcome.effect, 'bump');
        assert.equal(Object.keys(resolved.state.collisionWalls).length, 1);
      },
    },
  ];

  const specialWalls = [
    {
      type: 'oneTimeWall',
      verify(resolved) {
        assert.equal(resolved.outcome.effect, 'bump');
        assert.equal(resolved.state.itemState.b.consumed[0], true);
      },
    },
    {
      type: 'steelWall',
      verify(resolved) {
        assert.equal(resolved.outcome.effect, 'bump');
        assert.equal(resolved.outcome.consumedItemIndex, null);
      },
    },
    {
      type: 'fireWall',
      verify(resolved) {
        assert.equal(resolved.outcome.effect, 'bump');
        assert.equal(resolved.outcome.moves, 1);
        assert.deepEqual(resolved.state.visionEffectsByPlayer.a, {
          type: 'fire',
          sourcePlayerId: 'b',
          appliedAtTurn: 1,
          expiresAtTargetMove: 5,
        });
        assert.equal(Object.keys(resolved.state.collisionWalls).length, 0);
      },
    },
    {
      type: 'fogWall',
      verify(resolved) {
        assert.equal(resolved.outcome.effect, 'move');
        assert.deepEqual(resolved.outcome.position, position(0, 1));
        assert.equal(resolved.state.itemState.b.consumed[0], true);
        assert.equal(resolved.state.visionEffectsByPlayer.a.type, 'smoke');
      },
    },
    {
      type: 'illusionWall',
      verify(resolved) {
        assert.equal(resolved.outcome.effect, 'move');
        assert.equal(resolved.outcome.illusionTransition, 'activated');
        assert.deepEqual(resolved.state.illusionEffectsByPlayer.a, {
          sourcePlayerId: 'b',
          appliedAtTurn: 1,
          actionsRemaining: 3,
        });
      },
    },
    {
      type: 'poisonWall',
      verify(resolved) {
        assert.deepEqual(resolved.outcome.position, position(0, 1));
        assert.equal(resolved.outcome.moves, 1);
        assert.equal(resolved.state.poisonEffectsByPlayer.a.expiresAtTargetMove, 5);
      },
    },
    {
      type: 'iceWall',
      verify(resolved) {
        assert.equal(resolved.outcome.effect, 'bump');
        assert.deepEqual(resolved.outcome.position, position(0, 0));
        assert.equal(resolved.outcome.moves, 2);
        assert.equal(resolved.state.itemState.b.consumed[0], true);
      },
    },
    {
      type: 'windWall',
      extra: { effectDirection: 'down' },
      verify(resolved) {
        assert.equal(resolved.outcome.effect, 'bump');
        assert.deepEqual(resolved.outcome.position, position(1, 0));
        assert.equal(resolved.state.itemState.b.consumed[0], true);
      },
    },
    {
      type: 'collapseWall',
      verify(resolved) {
        assert.deepEqual(resolved.outcome.position, position(0, 1));
        assert.equal(resolved.state.itemState.b.activeWalls[0], true);
      },
    },
    {
      type: 'mirrorWall',
      verify(resolved) {
        assert.deepEqual(resolved.outcome.position, position(5, 4));
        assert.equal(resolved.state.itemState.b.consumed[0], true);
      },
    },
    {
      type: 'crystalWall',
      obstacles: [wall(1, 0, 'right'), wall(4, 4, 'right')],
      verify(resolved) {
        assert.equal(resolved.outcome.effect, 'bump');
        assert.deepEqual(resolved.state.revealedWallsByPlayer.a, [wall(1, 0, 'right')]);
      },
    },
  ];

  for (const special of specialWalls) {
    fixtures.push({
      name: `${special.type} resolution`,
      state: runtimeState(gameMap({
        obstacles: special.obstacles || [],
        items: [wallItem(special.type, 0, 0, 'right', special.extra)],
      })),
      steps: [{ action: { type: 'move', direction: 'right' } }],
      verify(run) {
        special.verify(resolutionAt(run));
      },
    });
  }

  fixtures.push({
    name: 'illusion keeps first wall origin and returns after three affected actions',
    state: runtimeState(gameMap({
      obstacles: [wall(0, 1, 'right'), wall(0, 2, 'right')],
      items: [wallItem('illusionWall', 0, 0, 'right')],
    })),
    steps: Array.from({ length: 4 }, (_, index) => ({
      action: { type: 'move', direction: 'right' },
      now: FIXED_NOW + index,
    })),
    verify(run) {
      assert.equal(resolutionAt(run, 0).outcome.illusionTransition, 'activated');
      assert.deepEqual(
        resolutionAt(run, 1).state.illusionEffectsByPlayer.a.firstWallOrigin,
        position(0, 1)
      );
      assert.deepEqual(
        resolutionAt(run, 2).state.illusionEffectsByPlayer.a.firstWallOrigin,
        position(0, 1)
      );
      const returned = resolutionAt(run, 3);
      assert.equal(returned.outcome.illusionTransition, 'returned');
      assert.deepEqual(returned.outcome.position, position(0, 1));
      assert.equal(returned.state.illusionEffectsByPlayer, undefined);
      assert.deepEqual(returned.state.collisionWalls || {}, {});
    },
  });

  const fireKnowledgeState = runtimeState(gameMap({
    obstacles: [wall(2, 2, 'left')],
    items: [wallItem('fireWall', 2, 2, 'right')],
  }), {
    position: position(2, 2),
  });
  fireKnowledgeState.collisionWalls = {
    actorOld: {
      playerId: 'a',
      position: position(1, 1),
      direction: 'right',
      timestamp: FIXED_NOW - 2,
      mapOwnerId: 'b',
    },
    otherOld: {
      playerId: 'other',
      position: position(4, 4),
      direction: 'right',
      timestamp: FIXED_NOW - 1,
      mapOwnerId: 'b',
    },
  };
  fireKnowledgeState.revealedWallsByPlayer = {
    a: [wall(1, 1, 'right')],
    other: [wall(4, 4, 'right')],
  };
  fixtures.push({
    name: 'fire four-action knowledge burn transcript',
    state: fireKnowledgeState,
    steps: [
      { action: { type: 'move', direction: 'right' } },
      ...Array.from({ length: 5 }, () => ({ action: { type: 'move', direction: 'left' } })),
    ],
    verify(run) {
      const ignition = resolutionAt(run, 0);
      assert.deepEqual(ignition.state.visionEffectsByPlayer.a, {
        type: 'fire',
        sourcePlayerId: 'b',
        appliedAtTurn: 1,
        expiresAtTargetMove: 5,
      });
      assert.deepEqual(Object.keys(ignition.state.collisionWalls), ['otherOld']);
      assert.equal(ignition.state.revealedWallsByPlayer.a, undefined);
      assert.deepEqual(ignition.state.revealedWallsByPlayer.other, [wall(4, 4, 'right')]);

      for (let index = 1; index <= 4; index += 1) {
        const actorCollisions = Object.values(resolutionAt(run, index).state.collisionWalls)
          .filter((collision) => collision.playerId === 'a');
        assert.equal(actorCollisions.length, 1, `affected fire action ${index} keeps only its new collision`);
        assert.equal(actorCollisions[0].timestamp, FIXED_NOW + index);
      }
      const fifthAction = resolutionAt(run, 5);
      assert.equal(fifthAction.state.visionEffectsByPlayer.a, undefined);
      const permanentCollisions = Object.values(fifthAction.state.collisionWalls)
        .filter((collision) => collision.playerId === 'a');
      assert.equal(permanentCollisions.length, 1);
      assert.equal(permanentCollisions[0].timestamp, FIXED_NOW + 5);
    },
  });

  const fireSmokeState = runtimeState(gameMap({
    obstacles: [wall(1, 0, 'right')],
    items: [
      wallItem('fireWall', 0, 0, 'right'),
      { type: 'smoke', position: position(1, 0) },
    ],
  }));
  fixtures.push({
    name: 'active fire consumes smoke without truncation transcript',
    state: fireSmokeState,
    steps: [
      { action: { type: 'move', direction: 'right' } },
      { action: { type: 'move', direction: 'down' } },
      { action: { type: 'move', direction: 'right' } },
      { action: { type: 'move', direction: 'up' } },
    ],
    verify(run) {
      const fireLedger = resolutionAt(run, 0).state.visionEffectsByPlayer.a;
      const smokeLanding = resolutionAt(run, 1);
      assert.equal(smokeLanding.outcome.effect, 'smoke');
      assert.equal(smokeLanding.state.itemState.b.consumed[1], true);
      assert.deepEqual(smokeLanding.state.visionEffectsByPlayer.a, fireLedger);
      assert.match(smokeLanding.outcome.message, /연막.*불길.*화염 상태/u);
      assert.equal(
        Object.values(resolutionAt(run, 2).state.collisionWalls)
          .filter((collision) => collision.playerId === 'a').length,
        1
      );
      assert.equal(
        Object.values(resolutionAt(run, 3).state.collisionWalls)
          .filter((collision) => collision.playerId === 'a').length,
        0
      );
      assert.deepEqual(resolutionAt(run, 3).state.visionEffectsByPlayer.a, fireLedger);
    },
  });

  const burningLegacyWormholeState = runtimeState(gameMap({
    items: [{
      type: 'wormhole',
      entrance: position(0, 1),
      exit: position(4, 4),
      challenge: LEGACY_WORMHOLE_CHALLENGE,
    }],
  }), {
    position: position(0, 1),
  });
  const actorLegacyRun = {
    mapOwnerId: 'b',
    itemIndex: 0,
    position: position(0, 0),
    challenge: LEGACY_WORMHOLE_CHALLENGE,
    enteredAtTurn: 1,
    discoveredWalls: [wall(0, 0, 'right')],
  };
  const otherLegacyRun = {
    ...clone(actorLegacyRun),
    mapOwnerId: 'a',
    discoveredWalls: [wall(2, 1, 'right')],
  };
  burningLegacyWormholeState.wormholeRunsByPlayer = {
    a: actorLegacyRun,
    other: otherLegacyRun,
  };
  burningLegacyWormholeState.visionEffectsByPlayer.a = {
    type: 'fire',
    sourcePlayerId: 'b',
    appliedAtTurn: 1,
    expiresAtTargetMove: 4,
  };
  fixtures.push({
    name: 'active fire clears only actor V1 wormhole discoveries transcript',
    state: burningLegacyWormholeState,
    steps: [{ action: { type: 'move', direction: 'down' } }],
    verify(run) {
      const resolved = resolutionAt(run);
      assert.equal(resolved.state.wormholeRunsByPlayer.a.discoveredWalls, undefined);
      assert.deepEqual(resolved.state.wormholeRunsByPlayer.other, otherLegacyRun);
    },
  });

  const poisonState = runtimeState(gameMap(), { position: position(2, 2) });
  poisonState.poisonEffectsByPlayer = {
    a: {
      sourcePlayerId: 'b',
      appliedAtTurn: 1,
      expiresAtTargetMove: 4,
      seed: 0,
    },
  };
  fixtures.push({
    name: 'poison deterministic four-direction transcript',
    state: poisonState,
    steps: Array.from({ length: 4 }, () => ({ action: { type: 'move', direction: 'up' } })),
    verify(run) {
      assert.deepEqual(
        run.resolutions.map((resolution) => resolution?.outcome.direction),
        ['left', 'down', 'up', 'right'],
        'seed plus action number selects all four directions independently of the requested input'
      );
      run.resolutions.forEach((resolution, index) => {
        assert.ok(resolution);
        assert.equal(resolution.outcome.moves, index + 1);
      });
      assert.equal(resolutionAt(run, 3).state.poisonEffectsByPlayer.a, undefined);
    },
  });

  const poisonBoundaryState = runtimeState(gameMap(), { position: position(0, 2) });
  poisonBoundaryState.poisonEffectsByPlayer = {
    a: {
      sourcePlayerId: 'b',
      appliedAtTurn: 1,
      expiresAtTargetMove: 4,
      seed: 2,
    },
  };
  fixtures.push({
    name: 'poison boundary consumes one action without collision knowledge',
    state: poisonBoundaryState,
    steps: [{ action: { type: 'move', direction: 'down' } }],
    verify(run) {
      const resolved = resolutionAt(run);
      assert.equal(resolved.outcome.direction, 'up');
      assert.equal(resolved.outcome.effect, 'bump');
      assert.equal(resolved.outcome.moves, 1);
      assert.deepEqual(resolved.outcome.position, position(0, 2));
      assert.deepEqual(resolved.outcome.attempted, position(-1, 2));
      assert.equal(Object.keys(resolved.state.collisionWalls).length, 0);
    },
  });

  fixtures.push(
    {
      name: 'phase wall close-open transcript',
      state: runtimeState(gameMap({ items: [wallItem('phaseWall', 0, 0)] })),
      steps: [
        { action: { type: 'move', direction: 'right' } },
        { action: { type: 'move', direction: 'right' } },
      ],
      verify(run) {
        assert.equal(resolutionAt(run, 0).outcome.effect, 'bump');
        assert.equal(resolutionAt(run, 0).state.itemState.b.phaseOpen[0], true);
        assert.deepEqual(resolutionAt(run, 1).outcome.position, position(0, 1));
        assert.equal(resolutionAt(run, 1).state.itemState.b.phaseOpen[0], false);
      },
    },
    {
      name: 'thorn opposite-direction rebound transcript',
      state: runtimeState(gameMap({ items: [wallItem('thornWall', 0, 1)] }), {
        position: position(0, 1),
        history: [position(5, 5), position(0, 1)],
      }),
      steps: [{ action: { type: 'move', direction: 'right' } }],
      verify(run) {
        const resolved = resolutionAt(run);
        assert.equal(resolved.outcome.effect, 'bump');
        assert.deepEqual(resolved.outcome.position, position(0, 0));
        assert.equal(resolved.state.itemState.b.consumed[0], true);
      },
    },
    {
      name: 'mine landing',
      state: runtimeState(gameMap({ items: [{ type: 'mine', position: position(0, 1) }] })),
      steps: [{ action: { type: 'move', direction: 'right' } }],
      verify(run) {
        const resolved = resolutionAt(run);
        assert.equal(resolved.outcome.effect, 'mine');
        assert.deepEqual(resolved.outcome.position, position(0, 0));
      },
    },
    {
      name: 'wormhole landing',
      state: runtimeState(gameMap({
        items: [{ type: 'wormhole', entrance: position(0, 1), exit: position(3, 3) }],
      })),
      steps: [{ action: { type: 'move', direction: 'right' } }],
      verify(run) {
        const resolved = resolutionAt(run);
        assert.equal(resolved.outcome.effect, 'wormhole');
        assert.deepEqual(resolved.outcome.position, position(3, 3));
      },
    },
    {
      name: 'V2 dice wormhole entry and internal roll',
      state: runtimeState(gameMap({
        items: [{
          type: 'wormhole',
          entrance: position(0, 1),
          exit: position(4, 4),
          challenge: DICE_WORMHOLE_CHALLENGE,
        }],
      })),
      steps: [
        { action: { type: 'move', direction: 'right' } },
        { action: { type: 'move', direction: 'right' } },
      ],
      verify(run) {
        const entered = resolutionAt(run, 0);
        assert.equal(entered.outcome.wormholeTransition, 'entered');
        assert.equal(entered.state.wormholeRunsByPlayer.a.challenge.version, 2);
        assert.equal(entered.state.wormholeRunsByPlayer.a.orientation, 0);
        assert.equal(entered.state.wormholeRunsByPlayer.a.actionsTaken, 0);
        const rolled = resolutionAt(run, 1);
        assert.equal(rolled.outcome.realm, 'wormhole');
        assert.deepEqual(rolled.outcome.position, position(0, 1));
        assert.equal(rolled.state.wormholeRunsByPlayer.a.actionsTaken, 1);
        assert.notEqual(rolled.state.wormholeRunsByPlayer.a.orientation, 0);
      },
    },
    {
      name: 'smoke apply and expire transcript',
      state: runtimeState(gameMap({ items: [{ type: 'smoke', position: position(0, 1) }] })),
      steps: [
        { action: { type: 'move', direction: 'right' } },
        { action: { type: 'move', direction: 'right' } },
      ],
      verify(run) {
        assert.equal(resolutionAt(run, 0).outcome.effect, 'smoke');
        assert.equal(resolutionAt(run, 0).state.visionEffectsByPlayer.a.type, 'smoke');
        assert.equal(resolutionAt(run, 1).state.visionEffectsByPlayer.a, undefined);
      },
    },
    {
      name: 'retired detector action',
      state: runtimeState(gameMap({
        obstacles: [wall(0, 0, 'right')],
        items: [wallItem('oneTimeWall', 1, 0, 'right')],
      }), {
        ownItems: [{ type: 'radar' }],
      }),
      steps: [{ action: { type: 'radar', itemIndex: 0 } }],
      verify(run) {
        assert.equal(run.resolutions[0], null);
      },
    },
    {
      name: 'retired scout pulse skill',
      state: runtimeState(gameMap({ obstacles: [wall(0, 0, 'right')] }), {
        skill: 'scoutPulse',
      }),
      steps: [{ action: { type: 'skill', skillId: 'scoutPulse' } }],
      verify(run) {
        assert.equal(run.resolutions[0], null);
      },
    },
    {
      name: 'retired breach skill',
      state: runtimeState(gameMap({ obstacles: [wall(0, 0, 'right')] }), {
        skill: 'breach',
      }),
      steps: [{ action: { type: 'skill', skillId: 'breach', direction: 'right' } }],
      verify(run) {
        assert.equal(run.resolutions[0], null);
      },
    },
    {
      name: 'retired anchor passive',
      state: runtimeState(gameMap({ items: [{ type: 'mine', position: position(0, 1) }] }), {
        skill: 'anchor',
      }),
      steps: [{ action: { type: 'move', direction: 'right' } }],
      verify(run) {
        const resolved = resolutionAt(run);
        assert.equal(resolved.outcome.skillEffect, undefined);
        assert.equal(resolved.outcome.effect, 'mine');
        assert.deepEqual(resolved.outcome.position, position(0, 0));
        assert.equal(resolved.state.itemState.a.mazeSkill.consumed.anchor, undefined);
      },
    },
    {
      name: 'retired dash skill',
      state: runtimeState(gameMap(), { skill: 'dash' }),
      steps: [{ action: { type: 'skill', skillId: 'dash', direction: 'right' } }],
      verify(run) {
        assert.equal(run.resolutions[0], null);
      },
    },
    {
      name: 'unique winner termination',
      state: terminalState(8),
      steps: [{ action: { type: 'move', direction: 'right' } }],
      verify(run) {
        const resolved = resolutionAt(run);
        assert.equal(resolved.state.phase, 'end');
        assert.equal(resolved.state.winner, 'a');
        assert.equal(resolved.state.draw, null);
        assert.equal(resolved.state.currentTurn, null);
      },
    },
    {
      name: 'minimum-move draw termination',
      state: terminalState(3),
      steps: [{ action: { type: 'move', direction: 'right' } }],
      verify(run) {
        const resolved = resolutionAt(run);
        assert.equal(resolved.state.phase, 'end');
        assert.equal(resolved.state.winner, null);
        assert.equal(resolved.state.draw, true);
      },
    }
  );

  return fixtures;
}

function assertCatalogParity(canonical, vendor) {
  assert.deepEqual(
    vendor.GameRules.createCanonicalGameRuleSnapshot(),
    canonical.GameRules.createCanonicalGameRuleSnapshot(),
    'canonical V4 rule snapshot differs between browser and Functions vendor engines'
  );
  for (const key of [
    'BOARD_SIZE',
    'GAME_RULES_VERSION',
    'MAX_OBSTACLES',
    'RUNNER_GEAR_WALL_BUDGET',
    'RUNNER_GEARS',
    'CARDINAL_DIRECTIONS',
    'MAZE_SKILL_IDS',
    'SPECIAL_WALL_TYPES',
    'WALL_ITEM_TYPES',
    'ITEM_COSTS',
    'ITEM_LIMITS',
  ]) {
    assert.deepEqual(
      vendor.GameUtils[key],
      canonical.GameUtils[key],
      `GameUtils.${key} differs between browser and Functions vendor engines`
    );
  }
  assert.deepEqual(
    vendor.MazeSkills.MAZE_SKILL_DEFINITIONS,
    canonical.MazeSkills.MAZE_SKILL_DEFINITIONS,
    'maze skill definitions differ between browser and Functions vendor engines'
  );
  for (const key of [
    'DICE_WORMHOLE_BOARD_SIZE',
    'DICE_WORMHOLE_MIN_BLOCKED_CELLS',
    'DICE_WORMHOLE_MAX_BLOCKED_CELLS',
    'DICE_WORMHOLE_MIN_STEPS',
    'DICE_WORMHOLE_MAX_STEPS',
    'DICE_ORIENTATION_COUNT',
    'DICE_WORMHOLE_DIRECTIONS',
    'DICE_ORIENTATIONS',
    'DICE_ORIENTATION_TRANSITIONS',
    'DICE_WORMHOLE_FALLBACK_CHALLENGE',
  ]) {
    assert.deepEqual(
      vendor.DiceWormhole[key],
      canonical.DiceWormhole[key],
      `DiceWormhole.${key} differs between browser and Functions vendor engines`
    );
  }
}

function assertSettlementParity(canonical, vendor) {
  const allForfeited = {
    phase: 'play',
    currentTurn: null,
    turnOrder: ['a', 'b'],
    players: {
      a: { id: 'a', position: position(0, 0), isReady: true, forfeited: true, moves: 2 },
      b: { id: 'b', position: position(5, 5), isReady: true, forfeited: true, moves: 4 },
    },
  };
  const canonicalSettled = canonical.GameTurn.settleCompletedGameState(clone(allForfeited));
  const vendorSettled = vendor.GameTurn.settleCompletedGameState(clone(allForfeited));
  assert.deepEqual(vendorSettled, canonicalSettled, 'all-forfeit END settlement parity failed');
  assert.equal(canonicalSettled.phase, 'end');
  assert.equal(canonicalSettled.draw, true);
  assert.equal(canonicalSettled.winner, null);
}

function main() {
  assertVendorArtifactsAreFresh();

  const canonical = loadCanonicalEngine();
  const vendor = require(path.join(VENDOR_DIST, 'index.js'));
  assertCatalogParity(canonical, vendor);

  const fixtures = deterministicFixtures();
  for (const fixture of fixtures) {
    const canonicalRun = runTranscript(canonical, fixture);
    fixture.verify(canonicalRun);
    const vendorRun = runTranscript(vendor, fixture);
    assert.deepEqual(
      vendorRun,
      canonicalRun,
      `${fixture.name}: full turn resolution transcript drifted`
    );
  }
  assertSettlementParity(canonical, vendor);

  console.log(
    `MAZE ENGINE PARITY: ${fixtures.length} deterministic transcripts, full resolutions, catalog, settlement, and vendor artifacts matched`
  );
}

main();
