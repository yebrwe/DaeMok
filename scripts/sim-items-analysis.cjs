/**
 * Policy-sensitive balance analysis for the 6x6 hidden-wall turn game.
 *
 * Unlike sim-items.cjs, this runner uses a seeded RNG, paired wall-growth
 * sequences, exact wall counts, and three knowledge policies:
 *   naive    - trusts discovered walls unless every open-looking route is bad
 *   adaptive - will re-probe a discovered wall when the detour is expensive
 *   oracle   - knows the real map and one-use effects and minimizes actions
 *
 * Usage: node scripts/sim-items-analysis.cjs [trials=600] [seed=20260713]
 */

'use strict';

const SIZE = 6;
const MAX_WALLS = 35;
const MIN_BUDGET = 10;
const MAX_BUDGET = 35;
const TRIALS = Math.max(50, Number(process.argv[2]) || 600);
const SEED = Number(process.argv[3]) || 20260713;

const ITEM_COSTS = {
  fake: 5,
  mine: 1,
  wormhole: 7,
  wind: 1,
};

const POLICIES = ['naive', 'adaptive', 'oracle'];
const DIRS = [
  { name: 'up', dr: -1, dc: 0 },
  { name: 'right', dr: 0, dc: 1 },
  { name: 'down', dr: 1, dc: 0 },
  { name: 'left', dr: 0, dc: -1 },
];

function mulberry32(seed) {
  let value = seed >>> 0;
  return () => {
    value += 0x6d2b79f5;
    let result = value;
    result = Math.imul(result ^ (result >>> 15), result | 1);
    result ^= result + Math.imul(result ^ (result >>> 7), result | 61);
    return ((result ^ (result >>> 14)) >>> 0) / 4294967296;
  };
}

const random = mulberry32(SEED);
const randInt = (limit) => Math.floor(random() * limit);
const pick = (items) => items[randInt(items.length)];
const cell = (row, col) => row * SIZE + col;
const rowOf = (id) => Math.floor(id / SIZE);
const colOf = (id) => id % SIZE;
const inBoard = (row, col) => row >= 0 && row < SIZE && col >= 0 && col < SIZE;
const edgeKey = (a, b) => (a < b ? `${a}:${b}` : `${b}:${a}`);
const manhattan = (a, b) => Math.abs(rowOf(a) - rowOf(b)) + Math.abs(colOf(a) - colOf(b));

function neighbor(id, directionIndex) {
  const direction = DIRS[directionIndex];
  const row = rowOf(id) + direction.dr;
  const col = colOf(id) + direction.dc;
  return inBoard(row, col) ? cell(row, col) : null;
}

function directionBetween(from, to) {
  for (let index = 0; index < DIRS.length; index += 1) {
    if (neighbor(from, index) === to) return index;
  }
  return null;
}

function neighbors(id) {
  const result = [];
  for (let directionIndex = 0; directionIndex < DIRS.length; directionIndex += 1) {
    const target = neighbor(id, directionIndex);
    if (target !== null) result.push({ target, directionIndex });
  }
  return result;
}

const ALL_EDGES = (() => {
  const edges = [];
  for (let id = 0; id < SIZE * SIZE; id += 1) {
    for (const directionIndex of [1, 2]) {
      const target = neighbor(id, directionIndex);
      if (target !== null) edges.push([id, target]);
    }
  }
  return edges;
})();

function bfsPath(start, end, walls, blockedCells = null) {
  if (blockedCells?.has(start) || blockedCells?.has(end)) return null;
  if (start === end) return [start];
  const previous = new Int16Array(SIZE * SIZE).fill(-1);
  previous[start] = start;
  const queue = [start];
  let head = 0;

  while (head < queue.length) {
    const current = queue[head++];
    for (const { target } of neighbors(current)) {
      if (previous[target] !== -1 || blockedCells?.has(target)) continue;
      if (walls.has(edgeKey(current, target))) continue;
      previous[target] = current;
      if (target === end) {
        const path = [end];
        let cursor = end;
        while (cursor !== start) {
          cursor = previous[cursor];
          path.push(cursor);
        }
        return path.reverse();
      }
      queue.push(target);
    }
  }
  return null;
}

function bfsDistances(start, walls) {
  const distances = new Int16Array(SIZE * SIZE).fill(-1);
  distances[start] = 0;
  const queue = [start];
  let head = 0;
  while (head < queue.length) {
    const current = queue[head++];
    for (const { target } of neighbors(current)) {
      if (distances[target] !== -1 || walls.has(edgeKey(current, target))) continue;
      distances[target] = distances[current] + 1;
      queue.push(target);
    }
  }
  return distances;
}

function openDegree(position, walls) {
  return neighbors(position).filter(({ target }) => !walls.has(edgeKey(position, target))).length;
}

function makeWallGrowthCase() {
  for (let restart = 0; restart < 100; restart += 1) {
    let start;
    let end;
    do {
      start = randInt(SIZE * SIZE);
      end = randInt(SIZE * SIZE);
    } while (start === end || manhattan(start, end) < 5);

    const walls = new Set();
    const snapshots = [new Set()];
    let failed = false;

    for (let targetCount = 1; targetCount <= MAX_WALLS; targetCount += 1) {
      let placed = false;
      for (let attempt = 0; attempt < 6000 && !placed; attempt += 1) {
        const path = bfsPath(start, end, walls);
        const pair = path && path.length >= 2 && random() < 0.7
          ? [path[randInt(path.length - 1)], null]
          : pick(ALL_EDGES);
        const a = pair[0];
        const b = pair[1] === null ? path[path.indexOf(a) + 1] : pair[1];
        const key = edgeKey(a, b);
        if (walls.has(key)) continue;
        walls.add(key);
        if (!bfsPath(start, end, walls)) {
          walls.delete(key);
          continue;
        }
        snapshots[targetCount] = new Set(walls);
        placed = true;
      }
      if (!placed) {
        failed = true;
        break;
      }
    }

    if (!failed) return { start, end, snapshots };
  }
  throw new Error(`Could not generate an exact ${MAX_WALLS}-wall growth sequence.`);
}

function emptyRuntime(start, kind) {
  return {
    pos: start,
    prior: start,
    fakeActive: kind === 'fake',
    mineActive: kind === 'mine',
    wormholeActive: kind === 'wormhole',
    windActive: kind === 'wind',
  };
}

function runtimeKey(state) {
  return [
    state.pos,
    state.prior,
    state.fakeActive ? 1 : 0,
    state.mineActive ? 1 : 0,
    state.wormholeActive ? 1 : 0,
    state.windActive ? 1 : 0,
  ].join(',');
}

function placeItem(kind, start, end, walls) {
  const path = bfsPath(start, end, walls);
  if (!path || path.length < 2) return null;

  if (kind === 'fake') {
    const index = Math.floor((path.length - 1) / 2);
    return { kind, edge: edgeKey(path[index], path[index + 1]) };
  }

  if (kind === 'mine') {
    const candidates = path.slice(1, -1);
    if (candidates.length === 0) return null;
    return { kind, position: candidates[Math.floor(candidates.length / 2)] };
  }

  if (kind === 'wormhole') {
    const candidates = path.slice(1, -1);
    if (candidates.length === 0) return null;
    const entrance = candidates[Math.floor(candidates.length / 2)];
    const distances = bfsDistances(end, walls);
    let exit = null;
    let bestDistance = -1;
    for (let id = 0; id < SIZE * SIZE; id += 1) {
      if (id === start || id === end || id === entrance || distances[id] < 0) continue;
      if (openDegree(id, walls) < 2) continue;
      if (distances[id] > bestDistance) {
        bestDistance = distances[id];
        exit = id;
      }
    }
    return exit === null ? null : { kind, entrance, exit, designedSetback: bestDistance - distances[entrance] };
  }

  if (kind === 'wind') {
    const index = Math.floor((path.length - 1) / 2);
    const from = path[index];
    const to = path[index + 1];
    const edge = edgeKey(from, to);
    const distances = bfsDistances(end, walls);
    let pushDirection = null;
    let pushedTo = null;
    let bestDistance = distances[to];

    for (let directionIndex = 0; directionIndex < DIRS.length; directionIndex += 1) {
      const candidate = neighbor(to, directionIndex);
      if (candidate === null || walls.has(edgeKey(to, candidate)) || distances[candidate] < 0) continue;
      if (distances[candidate] > bestDistance) {
        bestDistance = distances[candidate];
        pushDirection = directionIndex;
        pushedTo = candidate;
      }
    }

    // A safe but neutral direction still exercises the one-use transition.
    if (pushDirection === null) {
      pushDirection = directionBetween(to, from);
      pushedTo = from;
    }
    return {
      kind,
      edge,
      pushDirection,
      designedSetback: pushedTo === null ? 0 : distances[pushedTo] - distances[to],
    };
  }

  return { kind: 'none' };
}

function makeWorld(start, end, walls, item) {
  return { start, end, walls, item: item || { kind: 'none' } };
}

function transition(world, state, directionIndex) {
  const target = neighbor(state.pos, directionIndex);
  if (target === null) return null;
  const edge = edgeKey(state.pos, target);
  if (world.walls.has(edge)) return null;

  if (state.fakeActive && world.item.kind === 'fake' && world.item.edge === edge) {
    return {
      ...state,
      prior: state.pos,
      fakeActive: false,
      event: 'fake',
      blocked: true,
      directionIndex,
    };
  }

  let finalPosition = target;
  let event = null;
  const next = { ...state };

  if (state.mineActive && world.item.kind === 'mine' && world.item.position === target) {
    finalPosition = state.prior;
    next.mineActive = false;
    event = 'mine';
  } else if (
    state.wormholeActive &&
    world.item.kind === 'wormhole' &&
    world.item.entrance === target
  ) {
    finalPosition = world.item.exit;
    next.wormholeActive = false;
    event = 'wormhole';
  } else if (state.windActive && world.item.kind === 'wind' && world.item.edge === edge) {
    next.windActive = false;
    event = 'wind';
    const pushed = neighbor(target, world.item.pushDirection);
    if (
      pushed !== null &&
      !world.walls.has(edgeKey(target, pushed)) &&
      bfsPath(pushed, world.end, world.walls)
    ) {
      finalPosition = pushed;
    } else {
      event = 'wind-cancelled';
    }
  }

  next.prior = state.pos;
  next.pos = finalPosition;
  next.event = event;
  next.blocked = false;
  next.directionIndex = directionIndex;
  next.entered = target;
  return next;
}

function oraclePlan(world, initialState) {
  if (initialState.pos === world.end) return [];
  const queue = [initialState];
  let head = 0;
  const seen = new Map([[runtimeKey(initialState), { parent: null, directionIndex: null, state: initialState }]]);
  let goalKey = null;

  while (head < queue.length && seen.size < 20000) {
    const state = queue[head++];
    const parentKey = runtimeKey(state);
    for (let directionIndex = 0; directionIndex < DIRS.length; directionIndex += 1) {
      const next = transition(world, state, directionIndex);
      if (!next) continue;
      const key = runtimeKey(next);
      if (seen.has(key)) continue;
      seen.set(key, { parent: parentKey, directionIndex, state: next });
      if (next.pos === world.end) {
        goalKey = key;
        head = queue.length;
        break;
      }
      queue.push(next);
    }
  }

  if (!goalKey) return null;
  const directions = [];
  let cursor = goalKey;
  while (seen.get(cursor).parent !== null) {
    const record = seen.get(cursor);
    directions.push(record.directionIndex);
    cursor = record.parent;
  }
  return directions.reverse();
}

function hardlockAudit(world) {
  const initial = emptyRuntime(world.start, world.item.kind);
  const queue = [initial];
  let head = 0;
  const states = new Map([[runtimeKey(initial), initial]]);
  const reverse = new Map();
  const goals = [];

  while (head < queue.length && states.size < 20000) {
    const state = queue[head++];
    const fromKey = runtimeKey(state);
    if (state.pos === world.end) goals.push(fromKey);
    for (let directionIndex = 0; directionIndex < DIRS.length; directionIndex += 1) {
      const next = transition(world, state, directionIndex);
      if (!next) continue;
      const toKey = runtimeKey(next);
      if (!reverse.has(toKey)) reverse.set(toKey, []);
      reverse.get(toKey).push(fromKey);
      if (!states.has(toKey)) {
        states.set(toKey, next);
        queue.push(next);
      }
    }
  }

  const canReachGoal = new Set(goals);
  const stack = [...goals];
  while (stack.length > 0) {
    const key = stack.pop();
    for (const previous of reverse.get(key) || []) {
      if (canReachGoal.has(previous)) continue;
      canReachGoal.add(previous);
      stack.push(previous);
    }
  }

  let hardlocked = 0;
  for (const [key, state] of states) {
    if (state.pos !== world.end && !canReachGoal.has(key)) hardlocked += 1;
  }
  return { states: states.size, hardlocked, truncated: states.size >= 20000 };
}

function chooseBeliefDirection(position, end, knownBlocked, probeCounts, policy) {
  const distance = new Float64Array(SIZE * SIZE).fill(Number.POSITIVE_INFINITY);
  const previous = new Int16Array(SIZE * SIZE).fill(-1);
  distance[position] = 0;
  const unvisited = new Set(Array.from({ length: SIZE * SIZE }, (_, index) => index));

  while (unvisited.size > 0) {
    let current = null;
    let best = Number.POSITIVE_INFINITY;
    for (const candidate of unvisited) {
      if (distance[candidate] < best) {
        best = distance[candidate];
        current = candidate;
      }
    }
    if (current === null || !Number.isFinite(best)) break;
    unvisited.delete(current);
    if (current === end) break;

    for (const { target } of neighbors(current)) {
      if (!unvisited.has(target)) continue;
      const edge = edgeKey(current, target);
      const probes = probeCounts.get(edge) || 0;
      const edgeCost = knownBlocked.has(edge)
        ? policy === 'naive'
          ? 100 + probes * 100
          : 2 + probes * 5
        : 1;
      const candidateDistance = best + edgeCost;
      if (candidateDistance < distance[target]) {
        distance[target] = candidateDistance;
        previous[target] = current;
      }
    }
  }

  if (position === end || previous[end] === -1) return null;
  let cursor = end;
  while (previous[cursor] !== position) {
    cursor = previous[cursor];
    if (cursor < 0) return null;
  }
  return directionBetween(position, cursor);
}

function applyActualAction(world, state, directionIndex, metrics) {
  const target = neighbor(state.pos, directionIndex);
  if (target === null) return { ...state, prior: state.pos, blocked: true, event: 'boundary' };
  const edge = edgeKey(state.pos, target);

  if (world.walls.has(edge)) {
    metrics.wallCollisions += 1;
    return { ...state, prior: state.pos, blocked: true, event: 'wall', edge };
  }

  const next = transition(world, state, directionIndex);
  if (!next) throw new Error('Actual transition unexpectedly failed.');
  if (next.event) {
    metrics.triggered = true;
    metrics.events += 1;
  }
  if (next.event === 'fake') metrics.fakeCollisions += 1;
  if (next.event === 'mine') metrics.mineRewind += manhattan(next.entered, next.pos);
  if (next.event === 'wind-cancelled') metrics.windCancelled += 1;
  return { ...next, edge };
}

function runKnownPolicy(world, policy, options = {}) {
  const state = emptyRuntime(world.start, world.item.kind);
  let runtime = state;
  const knownBlocked = new Set();
  const probeCounts = new Map();
  if (options.preRevealFake && world.item.kind === 'fake') knownBlocked.add(world.item.edge);
  const metrics = {
    turns: 0,
    triggered: false,
    events: 0,
    wallCollisions: 0,
    fakeCollisions: 0,
    successfulReprobes: 0,
    mineRewind: 0,
    windCancelled: 0,
    failed: false,
  };

  while (runtime.pos !== world.end && metrics.turns < 500) {
    const directionIndex = chooseBeliefDirection(
      runtime.pos,
      world.end,
      knownBlocked,
      probeCounts,
      policy,
    );
    if (directionIndex === null) {
      metrics.failed = true;
      break;
    }
    const target = neighbor(runtime.pos, directionIndex);
    const edge = edgeKey(runtime.pos, target);
    const wasKnownBlocked = knownBlocked.has(edge);
    const next = applyActualAction(world, runtime, directionIndex, metrics);
    metrics.turns += 1;

    if (next.blocked) {
      knownBlocked.add(edge);
      probeCounts.set(edge, (probeCounts.get(edge) || 0) + 1);
      if (next.event === 'fake' && options.discloseFakeAfterHit) knownBlocked.delete(edge);
    } else if (wasKnownBlocked) {
      knownBlocked.delete(edge);
      metrics.successfulReprobes += 1;
    }
    runtime = next;
  }
  if (runtime.pos !== world.end) metrics.failed = true;
  return metrics;
}

function runOracle(world) {
  const initial = emptyRuntime(world.start, world.item.kind);
  const directions = oraclePlan(world, initial);
  const metrics = {
    turns: 0,
    triggered: false,
    events: 0,
    wallCollisions: 0,
    fakeCollisions: 0,
    successfulReprobes: 0,
    mineRewind: 0,
    windCancelled: 0,
    failed: directions === null,
  };
  if (!directions) return metrics;

  let runtime = initial;
  for (const directionIndex of directions) {
    runtime = applyActualAction(world, runtime, directionIndex, metrics);
    metrics.turns += 1;
  }
  if (runtime.pos !== world.end) metrics.failed = true;
  return metrics;
}

function run(world, policy, options) {
  return policy === 'oracle' ? runOracle(world) : runKnownPolicy(world, policy, options);
}

function makeRecord() {
  return {
    turns: [],
    raw: [],
    opportunity: [],
    information: [],
    preRevealDelta: [],
    triggerCount: 0,
    mineRewind: [],
    windCancelled: 0,
    failures: 0,
    hardlockStates: 0,
    auditedStates: 0,
    truncatedAudits: 0,
  };
}

const records = new Map();
const baselines = new Map();
const wallMarginals = new Map(POLICIES.map((policy) => [policy, []]));

function recordFor(key) {
  if (!records.has(key)) records.set(key, makeRecord());
  return records.get(key);
}

function baselineFor(policy, budget) {
  const key = `${policy}|${budget}`;
  if (!baselines.has(key)) baselines.set(key, []);
  return baselines.get(key);
}

for (let trial = 0; trial < TRIALS; trial += 1) {
  const generated = makeWallGrowthCase();
  const cache = new Map();

  const noItemRun = (policy, wallCount) => {
    const key = `${policy}|${wallCount}`;
    if (!cache.has(key)) {
      cache.set(
        key,
        run(makeWorld(generated.start, generated.end, generated.snapshots[wallCount], null), policy),
      );
    }
    return cache.get(key);
  };

  for (const policy of POLICIES) {
    for (let budget = MIN_BUDGET; budget <= MAX_BUDGET; budget += 1) {
      const result = noItemRun(policy, budget);
      baselineFor(policy, budget).push(result.turns);
      if (budget > MIN_BUDGET) {
        wallMarginals.get(policy).push(result.turns - noItemRun(policy, budget - 1).turns);
      }
    }
  }

  for (const [kind, cost] of Object.entries(ITEM_COSTS)) {
    for (let budget = MIN_BUDGET; budget <= MAX_BUDGET; budget += 1) {
      const wallCount = budget - cost;
      if (wallCount < 0) continue;
      const walls = generated.snapshots[wallCount];
      const item = placeItem(kind, generated.start, generated.end, walls);
      if (!item) continue;
      const world = makeWorld(generated.start, generated.end, walls, item);
      const audit = hardlockAudit(world);

      for (const policy of POLICIES) {
        const result = run(world, policy);
        const withoutItem = noItemRun(policy, wallCount);
        const fullWalls = noItemRun(policy, budget);
        const record = recordFor(`${kind}|${policy}|${budget}`);
        record.turns.push(result.turns);
        record.raw.push(result.turns - withoutItem.turns);
        record.opportunity.push(result.turns - fullWalls.turns);
        if (result.triggered) record.triggerCount += 1;
        if (result.mineRewind > 0) record.mineRewind.push(result.mineRewind);
        record.windCancelled += result.windCancelled;
        if (result.failed) record.failures += 1;
        record.hardlockStates += audit.hardlocked;
        record.auditedStates += audit.states;
        if (audit.truncated) record.truncatedAudits += 1;

        if (kind === 'fake') {
          const disclosed = run(world, policy, { discloseFakeAfterHit: true });
          record.information.push(result.turns - disclosed.turns);
          const preRevealed = run(world, policy, { preRevealFake: true });
          record.preRevealDelta.push(preRevealed.turns - result.turns);
        }
      }
    }
  }
}

function mean(values) {
  return values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;
}

function quantile(values, probability) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * probability));
  return sorted[index];
}

function ci95(values) {
  if (values.length < 2) return 0;
  const average = mean(values);
  const variance = values.reduce((sum, value) => sum + (value - average) ** 2, 0) / (values.length - 1);
  return 1.96 * Math.sqrt(variance / values.length);
}

function fixed(value) {
  return Number.isFinite(value) ? value.toFixed(2) : 'n/a';
}

console.log(`# Policy-sensitive hidden-wall analysis`);
console.log(`trials=${TRIALS}, seed=${SEED}, board=${SIZE}x${SIZE}, paired exact wall budgets=${MIN_BUDGET}..${MAX_BUDGET}`);
console.log('policies: naive=only re-probe when forced, adaptive=low-cost re-probe, oracle=full map/effect knowledge\n');

console.log('## Baseline mean turns');
console.log('budget\tnaive\tadaptive\toracle');
for (let budget = MIN_BUDGET; budget <= MAX_BUDGET; budget += 1) {
  console.log([
    budget,
    ...POLICIES.map((policy) => fixed(mean(baselineFor(policy, budget)))),
  ].join('\t'));
}

console.log('\n## Current-cost item results');
console.log('item\tcost\tpolicy\tbudget\ttrigger\traw_mean+/-95ci\traw_p50\traw_p90\tvs_full_walls\tinfo\tradar_pre_reveal');
for (const [kind, cost] of Object.entries(ITEM_COSTS)) {
  for (const policy of POLICIES) {
    for (const budget of [10, 15, 20, 22, 24, 25, 28, 30, 35]) {
      const record = records.get(`${kind}|${policy}|${budget}`);
      if (!record) continue;
      console.log([
        kind,
        cost,
        policy,
        budget,
        `${fixed((record.triggerCount / record.turns.length) * 100)}%`,
        `${fixed(mean(record.raw))}+/-${fixed(ci95(record.raw))}`,
        fixed(quantile(record.raw, 0.5)),
        fixed(quantile(record.raw, 0.9)),
        fixed(mean(record.opportunity)),
        kind === 'fake' ? fixed(mean(record.information)) : '-',
        kind === 'fake' ? fixed(mean(record.preRevealDelta)) : '-',
      ].join('\t'));
    }
  }
}

console.log(`\n## Aggregate break-even estimates across budgets ${MIN_BUDGET}..${MAX_BUDGET}`);
console.log('item\tpolicy\traw_delay\twall_marginal\testimated_fair_cost\tcurrent_cost\tfailures\thardlocked_states');
for (const [kind, currentCost] of Object.entries(ITEM_COSTS)) {
  for (const policy of POLICIES) {
    const combinedRaw = [];
    let failures = 0;
    let hardlockedStates = 0;
    let auditedStates = 0;
    for (let budget = MIN_BUDGET; budget <= MAX_BUDGET; budget += 1) {
      const record = records.get(`${kind}|${policy}|${budget}`);
      if (!record) continue;
      combinedRaw.push(...record.raw);
      failures += record.failures;
      hardlockedStates += record.hardlockStates;
      auditedStates += record.auditedStates;
    }
    const rawDelay = mean(combinedRaw);
    const marginal = mean(wallMarginals.get(policy));
    console.log([
      kind,
      policy,
      fixed(rawDelay),
      fixed(marginal),
      fixed(marginal > 0 ? rawDelay / marginal : 0),
      currentCost,
      failures,
      `${hardlockedStates}/${auditedStates}`,
    ].join('\t'));
  }
}

console.log('\nNotes:');
console.log('- raw_mean compares the item to the same lower-wall map; vs_full_walls includes opportunity cost.');
console.log('- fake info is hidden-after-hit minus disclosed-after-hit. radar_pre_reveal is pre-revealed fake minus normally hidden fake.');
console.log('- wind is bidirectional and one-use. Its push is cancelled if blocked, off-board, or statically unable to reach the goal.');
console.log('- hardlock audit explores every reachable (position, prior-position, one-use-state) node, not only the played policy path.');
