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
  const GameUtils = loadTypeScript('src/lib/gameUtils.ts', {
    '@/types/game': GameTypes,
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
    '@/lib/mazeSkills': MazeSkills,
  });
  return { GameTypes, GameUtils, MazeSkills, GameRules, GameTurn };
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

function gameMap(overrides = {}) {
  return {
    rulesVersion: 3,
    skillLoadout: 'scoutPulse',
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
    rulesVersion: 3,
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
        assert.equal(resolved.state.visionEffectsByPlayer.a.type, 'fire');
        assert.equal(resolved.state.visionEffectsByPlayer.a.phantomWalls.length, 6);
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
        assert.deepEqual(resolved.outcome.position, position(0, 2));
      },
    },
    {
      type: 'windWall',
      extra: { effectDirection: 'down' },
      verify(resolved) {
        assert.deepEqual(resolved.outcome.position, position(1, 1));
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
      name: 'thorn rewind transcript',
      state: runtimeState(gameMap({ items: [wallItem('thornWall', 0, 1)] }), {
        position: position(0, 1),
        history: [position(0, 0), position(0, 1)],
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
    'canonical V3 rule snapshot differs between browser and Functions vendor engines'
  );
  for (const key of [
    'BOARD_SIZE',
    'GAME_RULES_VERSION',
    'MAX_OBSTACLES',
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
