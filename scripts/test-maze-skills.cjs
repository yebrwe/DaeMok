#!/usr/bin/env node

'use strict';


const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const ROOT = path.join(__dirname, '..');
const SOURCE = path.join(ROOT, 'src', 'lib', 'mazeSkills.ts');
const sourceText = fs.readFileSync(SOURCE, 'utf8');
const transpiled = ts.transpileModule(sourceText, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2020,
    esModuleInterop: true,
  },
  fileName: SOURCE,
  reportDiagnostics: true,
});

const diagnostics = transpiled.diagnostics || [];
if (diagnostics.length > 0) {
  const formatted = ts.formatDiagnosticsWithColorAndContext(diagnostics, {
    getCanonicalFileName: (fileName) => fileName,
    getCurrentDirectory: () => ROOT,
    getNewLine: () => '\n',
  });
  throw new Error(formatted);
}

const moduleRecord = { exports: {} };
new Function('require', 'module', 'exports', transpiled.outputText)(
  require,
  moduleRecord,
  moduleRecord.exports
);
const skills = moduleRecord.exports;

const SIZE = 6;
const CELL_COUNT = SIZE * SIZE;
const MIN_TRIALS = 100_000;
const requestedTrials = Number(process.env.MAZE_SKILL_TRIALS || MIN_TRIALS);
const TRIALS = Number.isSafeInteger(requestedTrials) && requestedTrials >= MIN_TRIALS
  ? requestedTrials
  : MIN_TRIALS;
const SEED = 0x0dae2026;

const DIRECTIONS = ['up', 'right', 'down', 'left'];
const FORCED_SOURCES = ['mine', 'wormhole', 'ice', 'wind', 'mirror', 'thorn'];
const SPECIAL_WALLS = [
  'fireWall',
  'poisonWall',
  'iceWall',
  'windWall',
  'collapseWall',
  'phaseWall',
  'mirrorWall',
  'thornWall',
  'crystalWall',
];

function position(row, col) {
  return { row, col };
}

function wall(id, row, col, direction, kind = 'normalWall', extra = {}) {
  return { id, position: position(row, col), direction, kind, ...extra };
}

function board(walls, goal = position(5, 5), consumedWallIds) {
  return { boardSize: SIZE, goal, walls, consumedWallIds };
}

function state(skillId) {
  return skills.createMazeSkillState([skillId]);
}

function runUnitTests() {
  assert.deepEqual(skills.MAZE_SKILL_IDS, ['scoutPulse', 'breach', 'anchor', 'dash']);
  assert.equal(skills.MAX_MAZE_SKILL_LOADOUT, 1);
  assert.equal(skills.RANKED_MAZE_SKILL_LOADOUT, 1);
  assert.deepEqual(
    skills.normalizeMazeSkillLoadout(['dash', 'breach', 'dash', 'invalid']),
    ['dash']
  );
  assert.deepEqual(skills.normalizeMazeSkillLoadout('anchor'), ['anchor']);

  const normalized = skills.normalizeMazeSkillState({
    version: 999,
    loadout: ['breach', 'dash'],
    consumed: { breach: true, dash: 'yes', invalid: true },
  });
  assert.deepEqual(normalized, {
    version: 1,
    loadout: ['breach'],
    consumed: { breach: true },
  });
  assert.equal(skills.consumeMazeSkill(state('dash'), 'breach').reason, 'notEquipped');
  const consumedDash = skills.consumeMazeSkill(state('dash'), 'dash');
  assert.equal(consumedDash.ok, true);
  assert.equal(skills.consumeMazeSkill(consumedDash.state, 'dash').reason, 'alreadyConsumed');

  const scoutWalls = [
    wall('normal-a', 2, 2, 'right'),
    wall('normal-a-reciprocal', 2, 3, 'left'),
    wall('fake-near', 1, 1, 'right', 'fakeWall'),
    wall('fake-used', 3, 3, 'right', 'fakeWall'),
    wall('special-near', 2, 1, 'down', 'fireWall'),
    wall('far', 5, 4, 'right'),
  ];
  const scoutBoard = board(scoutWalls, position(5, 5), { 'fake-used': true });
  const scout = skills.resolveScoutPulse(state('scoutPulse'), {
    position: position(2, 2),
    board: scoutBoard,
  });
  assert.equal(scout.ok, true);
  assert.equal(scout.turnsSpent, 1);
  assert.equal(scout.state.consumed.scoutPulse, true);
  assert.equal(scout.reveals.length, 3);
  assert.ok(scout.reveals.every((reveal) => reveal.apparentKind === 'wall'));
  assert.ok(
    scout.reveals.some((reveal) =>
      reveal.sourceWallIds.includes('normal-a') &&
      reveal.sourceWallIds.includes('normal-a-reciprocal')
    )
  );
  assert.ok(!scout.reveals.some((reveal) => reveal.sourceWallIds.includes('fake-used')));
  assert.ok(!scout.reveals.some((reveal) => reveal.sourceWallIds.includes('far')));
  assert.equal(
    skills.resolveScoutPulse(scout.state, { position: position(2, 2), board: scoutBoard }).reason,
    'alreadyConsumed'
  );

  const breachBoard = board([wall('normal', 2, 2, 'right')]);
  const breach = skills.resolveBreach(state('breach'), {
    position: position(2, 2),
    direction: 'right',
    board: breachBoard,
  });
  assert.equal(breach.ok, true);
  assert.deepEqual(breach.position, position(2, 3));
  assert.equal(breach.wallKind, 'normalWall');
  assert.equal(breach.state.consumed.breach, true);
  assert.equal(
    skills.resolveBreach(state('breach'), {
      position: position(2, 2),
      direction: 'right',
      board: board([wall('steel', 2, 2, 'right', 'steelWall')]),
    }).reason,
    'steelWall'
  );
  assert.equal(
    skills.resolveBreach(state('breach'), {
      position: position(2, 2),
      direction: 'right',
      board: board([
        wall('normal-layer', 2, 2, 'right'),
        wall('fire-layer', 2, 3, 'left', 'fireWall'),
      ]),
    }).reason,
    'multipleWalls'
  );
  const reciprocalBreach = skills.resolveBreach(state('breach'), {
    position: position(2, 2),
    direction: 'right',
    board: board([
      wall('normal-left', 2, 2, 'right'),
      wall('normal-right', 2, 3, 'left'),
    ]),
  });
  assert.equal(reciprocalBreach.ok, true);
  assert.deepEqual(reciprocalBreach.bypassedWallIds.sort(), ['normal-left', 'normal-right']);
  assert.equal(
    skills.resolveBreach(state('breach'), {
      position: position(2, 2),
      direction: 'right',
      board: board([]),
    }).reason,
    'noWall'
  );
  assert.equal(
    skills.resolveBreach(state('breach'), {
      position: position(0, 0),
      direction: 'left',
      board: board([]),
    }).reason,
    'outOfBounds'
  );
  const trappedTarget = board([
    wall('entry-wall', 0, 0, 'right'),
    wall('target-right', 0, 1, 'right'),
    wall('target-down', 0, 1, 'down'),
  ]);
  const unsafeBreach = skills.resolveBreach(state('breach'), {
    position: position(0, 0),
    direction: 'right',
    board: trappedTarget,
  });
  assert.equal(unsafeBreach.reason, 'unsafeGoalPath');
  assert.equal(unsafeBreach.state.consumed.breach, undefined);

  for (const source of FORCED_SOURCES) {
    const anchor = skills.resolveAnchor(state('anchor'), {
      from: position(2, 2),
      entered: position(2, 3),
      forcedDestination: position(5, 0),
      source,
    });
    assert.equal(anchor.ok, true);
    assert.deepEqual(anchor.position, position(2, 3));
    assert.equal(anchor.negatedSource, source);
    assert.equal(anchor.consumeSourceEffect, true);
    assert.equal(anchor.turnsSpent, 0);
  }
  assert.equal(
    skills.resolveAnchor(state('anchor'), {
      from: position(2, 2),
      entered: position(2, 4),
      source: 'mine',
    }).reason,
    'invalidEntry'
  );
  assert.equal(
    skills.resolveAnchor(state('anchor'), {
      from: position(2, 2),
      entered: position(2, 3),
      source: 'teleport',
    }).reason,
    'unsupportedForcedMovement'
  );

  const dash = skills.resolveDash(state('dash'), {
    position: position(0, 0),
    direction: 'right',
    board: board([]),
  });
  assert.equal(dash.ok, true);
  assert.deepEqual(dash.position, position(0, 2));
  assert.deepEqual(dash.via, [position(0, 1), position(0, 2)]);
  assert.equal(dash.state.consumed.dash, true);
  const dashGoalStop = skills.resolveDash(state('dash'), {
    position: position(0, 0),
    direction: 'right',
    board: board([wall('after-goal', 0, 1, 'right')], position(0, 1)),
  });
  assert.equal(dashGoalStop.ok, true);
  assert.deepEqual(dashGoalStop.position, position(0, 1));
  assert.deepEqual(dashGoalStop.via, [position(0, 1)]);
  const dashTrapStop = skills.resolveDash(state('dash'), {
    position: position(0, 0),
    direction: 'right',
    board: board([wall('after-trap', 0, 1, 'right')]),
    stopAtFirst: true,
  });
  assert.equal(dashTrapStop.ok, true);
  assert.deepEqual(dashTrapStop.position, position(0, 1));
  assert.equal(
    skills.resolveDash(state('dash'), {
      position: position(0, 0),
      direction: 'right',
      board: board([wall('dash-block', 0, 1, 'right')]),
    }).reason,
    'blockedSegment'
  );
  assert.equal(
    skills.resolveDash(state('dash'), {
      position: position(0, 0),
      direction: 'left',
      board: board([]),
    }).reason,
    'outOfBounds'
  );
  const unsafeDashBoard = board([
    wall('pocket-down-0', 0, 0, 'down'),
    wall('pocket-down-1', 0, 1, 'down'),
    wall('pocket-down-2', 0, 2, 'down'),
    wall('pocket-right', 0, 2, 'right'),
  ]);
  assert.equal(
    skills.resolveDash(state('dash'), {
      position: position(0, 0),
      direction: 'right',
      board: unsafeDashBoard,
    }).reason,
    'unsafeGoalPath'
  );

  const singleExitBoard = board([
    wall('only-edge', 0, 0, 'right'),
    wall('down-block', 0, 0, 'down'),
  ]);
  assert.equal(skills.hasSafeMazeGoalPath(position(0, 0), singleExitBoard), false);
  assert.equal(
    skills.hasSafeMazeGoalPath(position(0, 0), {
      ...singleExitBoard,
      consumedWallIds: new Set(['only-edge', 'down-block']),
    }),
    true
  );

  console.log('UNIT: maze skill rules passed');
}

function mulberry32(seed) {
  let value = seed >>> 0;
  return () => {
    value = (value + 0x6d2b79f5) >>> 0;
    let result = value;
    result = Math.imul(result ^ (result >>> 15), result | 1);
    result ^= result + Math.imul(result ^ (result >>> 7), result | 61);
    return ((result ^ (result >>> 14)) >>> 0) / 0x100000000;
  };
}

function randomInt(rng, limit) {
  return Math.floor(rng() * limit);
}

function rowOf(cell) {
  return Math.floor(cell / SIZE);
}

function colOf(cell) {
  return cell % SIZE;
}

function cellPosition(cell) {
  return position(rowOf(cell), colOf(cell));
}

function cellId(row, col) {
  return row * SIZE + col;
}

function manhattan(a, b) {
  return Math.abs(rowOf(a) - rowOf(b)) + Math.abs(colOf(a) - colOf(b));
}

function moveCell(cell, direction) {
  const next = skills.moveMazePosition(cellPosition(cell), direction);
  return skills.isMazePosition(next, SIZE) ? cellId(next.row, next.col) : -1;
}

function directionBetween(from, to) {
  const rowDelta = rowOf(to) - rowOf(from);
  const colDelta = colOf(to) - colOf(from);
  if (rowDelta === -1 && colDelta === 0) return 'up';
  if (rowDelta === 1 && colDelta === 0) return 'down';
  if (rowDelta === 0 && colDelta === -1) return 'left';
  if (rowDelta === 0 && colDelta === 1) return 'right';
  return null;
}

function edgeKey(a, b) {
  return a < b ? `${a}:${b}` : `${b}:${a}`;
}

const EDGES = [];
const EDGE_BY_KEY = new Map();
const NEIGHBORS = Array.from({ length: CELL_COUNT }, () => []);

for (let row = 0; row < SIZE; row += 1) {
  for (let col = 0; col < SIZE; col += 1) {
    const from = cellId(row, col);
    if (col + 1 < SIZE) {
      const to = cellId(row, col + 1);
      const edge = { index: EDGES.length, a: from, b: to, direction: 'right' };
      EDGES.push(edge);
      EDGE_BY_KEY.set(edgeKey(from, to), edge);
      NEIGHBORS[from].push(to);
      NEIGHBORS[to].push(from);
    }
    if (row + 1 < SIZE) {
      const to = cellId(row + 1, col);
      const edge = { index: EDGES.length, a: from, b: to, direction: 'down' };
      EDGES.push(edge);
      EDGE_BY_KEY.set(edgeKey(from, to), edge);
      NEIGHBORS[from].push(to);
      NEIGHBORS[to].push(from);
    }
  }
}

function shuffledEdgeIndexes(rng) {
  const indexes = Array.from({ length: EDGES.length }, (_, index) => index);
  for (let index = indexes.length - 1; index > 0; index -= 1) {
    const swap = randomInt(rng, index + 1);
    [indexes[index], indexes[swap]] = [indexes[swap], indexes[index]];
  }
  return indexes;
}

function createDisjointSet() {
  const parent = Int16Array.from({ length: CELL_COUNT }, (_, index) => index);
  const rank = new Uint8Array(CELL_COUNT);
  const find = (value) => {
    let cursor = value;
    while (parent[cursor] !== cursor) {
      parent[cursor] = parent[parent[cursor]];
      cursor = parent[cursor];
    }
    return cursor;
  };
  const union = (a, b) => {
    let rootA = find(a);
    let rootB = find(b);
    if (rootA === rootB) return false;
    if (rank[rootA] < rank[rootB]) [rootA, rootB] = [rootB, rootA];
    parent[rootB] = rootA;
    if (rank[rootA] === rank[rootB]) rank[rootA] += 1;
    return true;
  };
  return { union };
}

function chooseWallKind(rng) {
  const roll = rng();
  if (roll < 0.08) return 'steelWall';
  if (roll < 0.16) return 'fakeWall';
  if (roll < 0.29) return SPECIAL_WALLS[randomInt(rng, SPECIAL_WALLS.length)];
  return 'normalWall';
}

function generateSimulationCase(rng) {
  const order = shuffledEdgeIndexes(rng);
  const dsu = createDisjointSet();
  const open = new Set();
  const rejected = [];

  for (const edgeIndex of order) {
    const edge = EDGES[edgeIndex];
    if (dsu.union(edge.a, edge.b)) open.add(edgeIndex);
    else rejected.push(edgeIndex);
  }

  const extraOpen = 3 + randomInt(rng, 10);
  for (let index = 0; index < extraOpen && index < rejected.length; index += 1) {
    open.add(rejected[index]);
  }

  let start;
  let goal;
  do {
    start = randomInt(rng, CELL_COUNT);
    goal = randomInt(rng, CELL_COUNT);
  } while (start === goal || manhattan(start, goal) < 5);

  const walls = [];
  const blocked = new Set();
  const wallByKey = new Map();
  for (const edge of EDGES) {
    if (open.has(edge.index)) continue;
    const key = edgeKey(edge.a, edge.b);
    const descriptor = wall(
      `w${edge.index}`,
      rowOf(edge.a),
      colOf(edge.a),
      edge.direction,
      chooseWallKind(rng)
    );
    walls.push(descriptor);
    blocked.add(key);
    wallByKey.set(key, descriptor);
  }

  return { start, goal, walls, blocked, wallByKey };
}

function bfs(start, goal, blocked) {
  const previous = new Int16Array(CELL_COUNT);
  previous.fill(-1);
  const distance = new Int16Array(CELL_COUNT);
  distance.fill(-1);
  previous[start] = start;
  distance[start] = 0;
  const queue = new Int16Array(CELL_COUNT);
  let head = 0;
  let tail = 0;
  queue[tail++] = start;

  while (head < tail) {
    const current = queue[head++];
    for (const next of NEIGHBORS[current]) {
      if (distance[next] !== -1 || blocked.has(edgeKey(current, next))) continue;
      previous[next] = current;
      distance[next] = distance[current] + 1;
      queue[tail++] = next;
    }
  }

  let path = null;
  if (distance[goal] >= 0) {
    path = [goal];
    let cursor = goal;
    while (cursor !== start) {
      cursor = previous[cursor];
      path.push(cursor);
    }
    path.reverse();
  }
  return { distance, previous, path };
}

function runHiddenExplorer(simCase, withScout) {
  let current = simCase.start;
  let turns = 0;
  let skillState = state('scoutPulse');
  let activated = false;
  let failures = 0;
  const knownWalls = new Set();
  const activeWalls = new Set(simCase.blocked);
  const consumedWallIds = new Set();
  let guard = 0;

  while (current !== simCase.goal && guard++ < 500) {
    const plan = bfs(current, simCase.goal, knownWalls).path;
    if (!plan || plan.length < 2) {
      return { turns, activated, failures, hardlock: true };
    }
    const next = plan[1];
    const key = edgeKey(current, next);
    if (activeWalls.has(key)) {
      turns += 1;
      knownWalls.add(key);
      const hitWall = simCase.wallByKey.get(key);
      if (hitWall?.kind === 'fakeWall') {
        activeWalls.delete(key);
        consumedWallIds.add(hitWall.id);
      }

      if (withScout && !activated) {
        const result = skills.resolveScoutPulse(skillState, {
          position: cellPosition(current),
          board: {
            boardSize: SIZE,
            goal: cellPosition(simCase.goal),
            walls: simCase.walls,
            consumedWallIds,
          },
        });
        if (result.ok) {
          activated = true;
          skillState = result.state;
          turns += result.turnsSpent;
          for (const reveal of result.reveals) knownWalls.add(reveal.segmentKey);
        } else {
          failures += 1;
        }
      }
      continue;
    }
    current = next;
    turns += 1;
  }

  return { turns, activated, failures, hardlock: current !== simCase.goal };
}

function directionForEdge(from, to) {
  return directionBetween(from, to);
}

function evaluateBreach(simCase, fromStart, fromGoal) {
  const baseline = fromStart.distance[simCase.goal];
  let best = baseline;
  let choice = null;
  let available = false;

  for (const edge of EDGES) {
    const descriptor = simCase.wallByKey.get(edgeKey(edge.a, edge.b));
    if (!descriptor || descriptor.kind === 'steelWall') continue;
    for (const [from, to] of [[edge.a, edge.b], [edge.b, edge.a]]) {
      if (fromStart.distance[from] < 0 || fromGoal.distance[to] < 0) continue;
      available = true;
      const turns = fromStart.distance[from] + 1 + fromGoal.distance[to];
      if (turns < best) {
        best = turns;
        choice = { from, to, direction: directionForEdge(from, to) };
      }
    }
  }

  if (!choice) {
    return { baseline, skillTurns: baseline, activated: false, available, failures: 0, hardlock: false };
  }
  const result = skills.resolveBreach(state('breach'), {
    position: cellPosition(choice.from),
    direction: choice.direction,
    board: { boardSize: SIZE, goal: cellPosition(simCase.goal), walls: simCase.walls },
  });
  if (!result.ok) {
    return { baseline, skillTurns: baseline, activated: false, available, failures: 1, hardlock: false };
  }
  const hardlock = !skills.hasSafeMazeGoalPath(result.position, {
    boardSize: SIZE,
    goal: cellPosition(simCase.goal),
    walls: simCase.walls,
  });
  return { baseline, skillTurns: best, activated: true, available, failures: 0, hardlock };
}

function evaluateDash(simCase, fromStart, fromGoal) {
  const baseline = fromStart.distance[simCase.goal];
  let best = baseline;
  let choice = null;
  let available = false;

  for (let from = 0; from < CELL_COUNT; from += 1) {
    if (fromStart.distance[from] < 0) continue;
    for (const direction of DIRECTIONS) {
      const first = moveCell(from, direction);
      if (first < 0 || simCase.blocked.has(edgeKey(from, first))) continue;
      const second = moveCell(first, direction);
      if (second < 0 || simCase.blocked.has(edgeKey(first, second))) continue;
      if (fromGoal.distance[second] < 0) continue;
      available = true;
      const turns = fromStart.distance[from] + 1 + fromGoal.distance[second];
      if (turns < best) {
        best = turns;
        choice = { from, direction };
      }
    }
  }

  if (!choice) {
    return { baseline, skillTurns: baseline, activated: false, available, failures: 0, hardlock: false };
  }
  const result = skills.resolveDash(state('dash'), {
    position: cellPosition(choice.from),
    direction: choice.direction,
    board: { boardSize: SIZE, goal: cellPosition(simCase.goal), walls: simCase.walls },
  });
  if (!result.ok) {
    return { baseline, skillTurns: baseline, activated: false, available, failures: 1, hardlock: false };
  }
  const hardlock = !skills.hasSafeMazeGoalPath(result.position, {
    boardSize: SIZE,
    goal: cellPosition(simCase.goal),
    walls: simCase.walls,
  });
  return { baseline, skillTurns: best, activated: true, available, failures: 0, hardlock };
}

function evaluateAnchor(simCase, shortestPath, fromGoal, rng) {
  const entryIndex = 1 + randomInt(rng, shortestPath.length - 2);
  const from = shortestPath[entryIndex - 1];
  const entered = shortestPath[entryIndex];
  const source = FORCED_SOURCES[randomInt(rng, FORCED_SOURCES.length)];
  const enteredDistance = fromGoal.distance[entered];
  const preferredSetback = {
    mine: 2,
    wormhole: 5,
    ice: 2,
    wind: 1,
    mirror: 2,
    thorn: 1,
  }[source];
  const candidates = [];
  for (let candidate = 0; candidate < CELL_COUNT; candidate += 1) {
    const candidateDistance = fromGoal.distance[candidate];
    if (candidateDistance <= enteredDistance) continue;
    candidates.push({
      cell: candidate,
      delta: candidateDistance - enteredDistance,
      score: Math.abs(candidateDistance - enteredDistance - preferredSetback),
    });
  }
  candidates.sort((a, b) => a.score - b.score || a.delta - b.delta || a.cell - b.cell);
  const shortlist = candidates.slice(0, Math.min(4, candidates.length));
  const forced = shortlist[randomInt(rng, shortlist.length)].cell;
  const baseline = entryIndex + fromGoal.distance[forced];
  const skillTurns = entryIndex + enteredDistance;
  const result = skills.resolveAnchor(state('anchor'), {
    from: cellPosition(from),
    entered: cellPosition(entered),
    forcedDestination: cellPosition(forced),
    source,
    boardSize: SIZE,
  });
  if (!result.ok) {
    return { baseline, skillTurns: baseline, activated: false, available: true, failures: 1, hardlock: false };
  }
  return {
    baseline,
    skillTurns,
    activated: true,
    available: true,
    failures: 0,
    hardlock: fromGoal.distance[forced] < 0,
  };
}

function createStats(id) {
  return {
    id,
    trials: 0,
    baselineTurns: 0,
    skillTurns: 0,
    activated: 0,
    available: 0,
    failures: 0,
    hardlocks: 0,
    savings: [],
  };
}

function record(stats, result) {
  stats.trials += 1;
  stats.baselineTurns += result.baseline;
  stats.skillTurns += result.skillTurns;
  if (result.activated) stats.activated += 1;
  if (result.available) stats.available += 1;
  stats.failures += result.failures;
  if (result.hardlock) stats.hardlocks += 1;
  stats.savings.push(result.baseline - result.skillTurns);
}

function quantile(values, probability) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * probability))];
}

function percent(value, total) {
  return `${((value / total) * 100).toFixed(2)}%`;
}

function summarize(stats) {
  const meanBaseline = stats.baselineTurns / stats.trials;
  const meanSkill = stats.skillTurns / stats.trials;
  return {
    id: stats.id,
    trials: stats.trials,
    baseline: meanBaseline,
    skill: meanSkill,
    saved: meanBaseline - meanSkill,
    p50: quantile(stats.savings, 0.5),
    p90: quantile(stats.savings, 0.9),
    activation: percent(stats.activated, stats.trials),
    unavailable: percent(stats.trials - stats.available, stats.trials),
    failure: percent(stats.failures, stats.trials),
    hardlock: percent(stats.hardlocks, stats.trials),
  };
}

function runSimulation() {
  const rng = mulberry32(SEED);
  const scoutStats = createStats('scoutPulse');
  const breachStats = createStats('breach');
  const anchorStats = createStats('anchor');
  const dashStats = createStats('dash');
  const startedAt = Date.now();

  for (let trial = 0; trial < TRIALS; trial += 1) {
    const simCase = generateSimulationCase(rng);
    const fromStart = bfs(simCase.start, simCase.goal, simCase.blocked);
    const fromGoal = bfs(simCase.goal, simCase.start, simCase.blocked);
    assert.ok(fromStart.path && fromStart.path.length >= 3);

    const scoutBaseline = runHiddenExplorer(simCase, false);
    const scoutSkill = runHiddenExplorer(simCase, true);
    record(scoutStats, {
      baseline: scoutBaseline.turns,
      skillTurns: scoutSkill.turns,
      activated: scoutSkill.activated,
      available: scoutSkill.activated,
      failures: scoutSkill.failures,
      hardlock: scoutBaseline.hardlock || scoutSkill.hardlock,
    });
    record(breachStats, evaluateBreach(simCase, fromStart, fromGoal));
    record(anchorStats, evaluateAnchor(simCase, fromStart.path, fromGoal, rng));
    record(dashStats, evaluateDash(simCase, fromStart, fromGoal));
  }

  const summaries = [scoutStats, breachStats, anchorStats, dashStats].map(summarize);
  console.log(`SIM: fixed-seed paired trials=${TRIALS}/skill seed=0x${SEED.toString(16)} elapsed=${((Date.now() - startedAt) / 1000).toFixed(2)}s`);
  console.log('skill       baseline skill    meanSaved p50 p90 activation unavailable failure hardlock');
  for (const summary of summaries) {
    console.log([
      summary.id.padEnd(11),
      summary.baseline.toFixed(3).padStart(8),
      summary.skill.toFixed(3).padStart(8),
      summary.saved.toFixed(3).padStart(9),
      String(summary.p50).padStart(3),
      String(summary.p90).padStart(3),
      summary.activation.padStart(10),
      summary.unavailable.padStart(11),
      summary.failure.padStart(7),
      summary.hardlock.padStart(8),
    ].join(' '));
  }

  for (const stats of [scoutStats, breachStats, anchorStats, dashStats]) {
    assert.equal(stats.trials, TRIALS);
    assert.equal(stats.failures, 0, `${stats.id} resolver failure in paired simulation`);
    assert.equal(stats.hardlocks, 0, `${stats.id} produced a hardlock`);
  }
  const dashSummary = summaries.find((summary) => summary.id === 'dash');
  assert.ok(dashSummary.saved >= 0 && dashSummary.saved <= 1);

  console.log('RECOMMENDATION: ranked matches should keep exactly one equipped skill and one use per match.');
  console.log('RECOMMENDATION: dash is the stable low-variance option; breach and anchor are situational swing picks; scoutPulse should remain a post-collision information trade.');
  return summaries;
}

runUnitTests();
runSimulation();
