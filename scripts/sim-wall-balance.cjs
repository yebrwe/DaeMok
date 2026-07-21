/**
 * Seeded wall-budget and hidden-item Monte Carlo simulation.
 *
 * Usage:
 *   node scripts/sim-wall-balance.cjs
 *   node scripts/sim-wall-balance.cjs 25000 balance-v2
 *   node scripts/sim-wall-balance.cjs --trials 25000 --seed balance-v2
 *
 * `trials` is the number of paired map blueprints generated for each map
 * aggressiveness. Budgets 10..35 are assigned round-robin, so the default
 * 10,000 trials yields about 385 samples per budget and aggressiveness.
 *
 * Every comparison is paired:
 *   - pure budget B uses the first B walls from a seeded wall sequence;
 *   - an item of cost C uses the first B-C walls from the same sequence;
 *   - the item's raw effect is compared with no item on that exact B-C map.
 *
 * Placement modes:
 *   - strong: map-aware shortest-path heuristic, independent of runner policy;
 *   - optimized: policy-aware placement using the paired no-item runner trace.
 *     This is an oracle upper bound, not a claim about normal player accuracy.
 */

'use strict';

const SIZE = 6;
const CELL_COUNT = SIZE * SIZE;
const MIN_BUDGET = 10;
// The live validator only preserves a start-to-goal path; it does not require
// every cell to stay connected. Sample well beyond the 24-wall live baseline.
const MAX_BUDGET = 35;
const BUDGETS = Array.from(
  { length: MAX_BUDGET - MIN_BUDGET + 1 },
  (_, index) => MIN_BUDGET + index,
);
const DEFAULT_TRIALS = 10_000;
const DEFAULT_SEED = 'daemok-wall-balance-v1';
const MAX_TURNS = 500;

const AGGRESSIVENESS = ['casual', 'adversarial'];
const POLICIES = ['believer', 'adaptive', 'skeptic'];
const PLACEMENT_MODES = ['strong', 'optimized'];
const ITEM_DEFS = [
  { id: 'fake', label: 'fake-wall', cost: 7 },
  { id: 'mine', label: 'mine', cost: 1 },
  { id: 'wormhole', label: 'wormhole', cost: 7 },
];

function usage() {
  console.log(`Usage:
  node scripts/sim-wall-balance.cjs [trials] [seed]
  node scripts/sim-wall-balance.cjs --trials <count> --seed <value>

Defaults: trials=${DEFAULT_TRIALS} per aggressiveness, seed=${DEFAULT_SEED}`);
}

function parseArgs(argv) {
  let trials;
  let seed;
  const positional = [];

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--help' || argument === '-h') {
      usage();
      process.exit(0);
    }
    if (argument === '--trials') {
      trials = argv[++index];
      continue;
    }
    if (argument.startsWith('--trials=')) {
      trials = argument.slice('--trials='.length);
      continue;
    }
    if (argument === '--seed') {
      seed = argv[++index];
      continue;
    }
    if (argument.startsWith('--seed=')) {
      seed = argument.slice('--seed='.length);
      continue;
    }
    if (argument.startsWith('-')) {
      throw new Error(`Unknown option: ${argument}`);
    }
    positional.push(argument);
  }

  if (trials == null && positional.length > 0) trials = positional[0];
  if (seed == null && positional.length > 1) seed = positional[1];
  if (positional.length > 2) throw new Error('Too many positional arguments.');

  const parsedTrials = trials == null ? DEFAULT_TRIALS : Number(trials);
  if (!Number.isSafeInteger(parsedTrials) || parsedTrials <= 0) {
    throw new Error(`trials must be a positive integer, received ${JSON.stringify(trials)}`);
  }

  return {
    trials: parsedTrials,
    seed: seed == null || seed === '' ? DEFAULT_SEED : String(seed),
  };
}

function hashString(value) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function mix32(value) {
  let mixed = value >>> 0;
  mixed ^= mixed >>> 16;
  mixed = Math.imul(mixed, 0x7feb352d);
  mixed ^= mixed >>> 15;
  mixed = Math.imul(mixed, 0x846ca68b);
  mixed ^= mixed >>> 16;
  return mixed >>> 0;
}

function mulberry32(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 0x100000000;
  };
}

function trialRng(seedHash, aggressiveness, trialIndex) {
  return mulberry32(
    mix32(
      seedHash ^
        hashString(aggressiveness) ^
        Math.imul((trialIndex + 1) >>> 0, 0x9e3779b1),
    ),
  );
}

function randomInt(rng, limit) {
  return Math.floor(rng() * limit);
}

function cellId(row, col) {
  return row * SIZE + col;
}

function rowOf(cell) {
  return Math.floor(cell / SIZE);
}

function colOf(cell) {
  return cell % SIZE;
}

function manhattan(a, b) {
  return Math.abs(rowOf(a) - rowOf(b)) + Math.abs(colOf(a) - colOf(b));
}

const EDGE_INDEX = Array.from({ length: CELL_COUNT }, () => {
  const row = new Int16Array(CELL_COUNT);
  row.fill(-1);
  return row;
});
const EDGES = [];

for (let row = 0; row < SIZE; row += 1) {
  for (let col = 0; col < SIZE; col += 1) {
    const from = cellId(row, col);
    if (row + 1 < SIZE) {
      const to = cellId(row + 1, col);
      const edge = EDGES.length;
      EDGES.push([from, to]);
      EDGE_INDEX[from][to] = edge;
      EDGE_INDEX[to][from] = edge;
    }
    if (col + 1 < SIZE) {
      const to = cellId(row, col + 1);
      const edge = EDGES.length;
      EDGES.push([from, to]);
      EDGE_INDEX[from][to] = edge;
      EDGE_INDEX[to][from] = edge;
    }
  }
}

const EDGE_COUNT = EDGES.length;
const NEIGHBORS = Array.from({ length: CELL_COUNT }, () => []);
const DIRECTION_DELTAS = [
  [-1, 0],
  [1, 0],
  [0, -1],
  [0, 1],
];

for (let cell = 0; cell < CELL_COUNT; cell += 1) {
  const row = rowOf(cell);
  const col = colOf(cell);
  for (const [deltaRow, deltaCol] of DIRECTION_DELTAS) {
    const nextRow = row + deltaRow;
    const nextCol = col + deltaCol;
    if (nextRow < 0 || nextRow >= SIZE || nextCol < 0 || nextCol >= SIZE) continue;
    const next = cellId(nextRow, nextCol);
    NEIGHBORS[cell].push({ cell: next, edge: EDGE_INDEX[cell][next] });
  }
}

const PATH_PREV = new Int16Array(CELL_COUNT);
const BFS_QUEUE = new Int16Array(CELL_COUNT);

function bfsPath(from, to, blockedEdges, extraBlockedEdge = -1) {
  if (from === to) return [from];
  PATH_PREV.fill(-1);
  PATH_PREV[from] = from;
  let head = 0;
  let tail = 0;
  BFS_QUEUE[tail++] = from;

  while (head < tail) {
    const current = BFS_QUEUE[head++];
    for (const neighbor of NEIGHBORS[current]) {
      if (PATH_PREV[neighbor.cell] !== -1) continue;
      if (blockedEdges[neighbor.edge] || neighbor.edge === extraBlockedEdge) continue;
      PATH_PREV[neighbor.cell] = current;
      if (neighbor.cell === to) {
        const reversed = [to];
        let cursor = to;
        while (cursor !== from) {
          cursor = PATH_PREV[cursor];
          reversed.push(cursor);
        }
        reversed.reverse();
        return reversed;
      }
      BFS_QUEUE[tail++] = neighbor.cell;
    }
  }

  return null;
}

function bfsDistances(from, blockedEdges, extraBlockedEdge = -1) {
  const distances = new Int16Array(CELL_COUNT);
  distances.fill(-1);
  distances[from] = 0;
  let head = 0;
  let tail = 0;
  BFS_QUEUE[tail++] = from;

  while (head < tail) {
    const current = BFS_QUEUE[head++];
    for (const neighbor of NEIGHBORS[current]) {
      if (distances[neighbor.cell] !== -1) continue;
      if (blockedEdges[neighbor.edge] || neighbor.edge === extraBlockedEdge) continue;
      distances[neighbor.cell] = distances[current] + 1;
      BFS_QUEUE[tail++] = neighbor.cell;
    }
  }

  return distances;
}

function bfsDistance(from, to, blockedEdges, extraBlockedEdge = -1) {
  if (from === to) return 0;
  const distances = bfsDistances(from, blockedEdges, extraBlockedEdge);
  return distances[to];
}

function chooseEndpoints(rng) {
  let start;
  let end;
  do {
    start = randomInt(rng, CELL_COUNT);
    end = randomInt(rng, CELL_COUNT);
  } while (start === end || manhattan(start, end) < 5);
  return { start, end };
}

function generateBlueprint(maxWalls, aggressiveness, rng) {
  const pathBias = aggressiveness === 'adversarial' ? 0.82 : 0.18;

  for (let restart = 0; restart < 30; restart += 1) {
    const { start, end } = chooseEndpoints(rng);
    const walls = new Uint8Array(EDGE_COUNT);
    const rejected = new Uint8Array(EDGE_COUNT);
    const wallOrder = [];
    let guard = 0;

    while (wallOrder.length < maxWalls && guard++ < 5_000) {
      let edge = -1;
      if (rng() < pathBias) {
        const path = bfsPath(start, end, walls);
        if (path && path.length > 1) {
          const pathIndex = randomInt(rng, path.length - 1);
          edge = EDGE_INDEX[path[pathIndex]][path[pathIndex + 1]];
        }
      }
      if (edge < 0 || walls[edge] || rejected[edge]) {
        edge = randomInt(rng, EDGE_COUNT);
      }
      if (walls[edge] || rejected[edge]) continue;

      walls[edge] = 1;
      if (!bfsPath(start, end, walls)) {
        walls[edge] = 0;
        rejected[edge] = 1;
        continue;
      }
      wallOrder.push(edge);
    }

    if (wallOrder.length === maxWalls) return { start, end, wallOrder };
  }

  throw new Error(`Could not generate a valid ${aggressiveness} map with ${maxWalls} walls.`);
}

function mapFromBlueprint(blueprint, wallCount) {
  const walls = new Uint8Array(EDGE_COUNT);
  for (let index = 0; index < wallCount; index += 1) {
    walls[blueprint.wallOrder[index]] = 1;
  }
  return {
    start: blueprint.start,
    end: blueprint.end,
    walls,
    wallCount,
    goalDistances: null,
    safeExitCells: null,
  };
}

function goalDistances(map) {
  if (!map.goalDistances) map.goalDistances = bfsDistances(map.end, map.walls);
  return map.goalDistances;
}

function openDegree(map, cell) {
  let degree = 0;
  for (const neighbor of NEIGHBORS[cell]) {
    if (!map.walls[neighbor.edge]) degree += 1;
  }
  return degree;
}

function safeExitCells(map) {
  if (map.safeExitCells) return map.safeExitCells;
  const candidates = [];
  for (let cell = 0; cell < CELL_COUNT; cell += 1) {
    if (cell === map.start || cell === map.end) continue;
    if (openDegree(map, cell) < 1) continue;
    candidates.push(cell);
  }
  map.safeExitCells = candidates;
  return candidates;
}

function forgetWeakestBelief(believed, hitCounts, learnedAt) {
  let candidate = -1;
  for (let edge = 0; edge < EDGE_COUNT; edge += 1) {
    if (!believed[edge]) continue;
    if (
      candidate < 0 ||
      hitCounts[edge] < hitCounts[candidate] ||
      (hitCounts[edge] === hitCounts[candidate] && learnedAt[edge] < learnedAt[candidate])
    ) {
      candidate = edge;
    }
  }
  if (candidate < 0) return false;
  believed[candidate] = 0;
  return true;
}

function runGame(map, policy, placement = null, collectTrace = false) {
  const believed = new Uint8Array(EDGE_COUNT);
  const hitCounts = new Uint16Array(EDGE_COUNT);
  const learnedAt = new Uint16Array(EDGE_COUNT);
  const history = [map.start];
  const trace = collectTrace ? { moves: [] } : null;
  let position = map.start;
  let turns = 0;
  let fakeConsumed = false;
  let activated = false;
  let pendingRetry = null;
  let planningGuard = 0;

  while (position !== map.end && turns < MAX_TURNS && planningGuard++ < MAX_TURNS * 8) {
    let next;
    if (pendingRetry && pendingRetry.from === position) {
      next = pendingRetry.to;
    } else {
      pendingRetry = null;
      let path = bfsPath(position, map.end, believed);
      if (!path) {
        if (policy === 'adaptive' && forgetWeakestBelief(believed, hitCounts, learnedAt)) {
          continue;
        }
        return { turns, hardlock: true, activated, trace };
      }
      next = path[1];
    }

    const edge = EDGE_INDEX[position][next];
    const hitStaticWall = !!map.walls[edge];
    const hitFakeWall =
      placement?.kind === 'fake' && placement.edge === edge && !fakeConsumed;

    if (hitStaticWall || hitFakeWall) {
      turns += 1;
      history.push(position);
      if (hitFakeWall) {
        fakeConsumed = true;
        activated = true;
      }

      const wasRetry = !!pendingRetry && pendingRetry.edge === edge;
      if (policy === 'skeptic' && !wasRetry) {
        pendingRetry = { from: position, to: next, edge };
      } else {
        hitCounts[edge] += 1;
        learnedAt[edge] = turns;
        believed[edge] = 1;
        pendingRetry = null;
      }
      continue;
    }

    pendingRetry = null;
    const rollback = history.length >= 2 ? history[history.length - 2] : history[0];
    if (trace) {
      trace.moves.push({
        from: position,
        to: next,
        edge,
        rollback,
        turn: turns + 1,
      });
    }

    if (placement?.kind === 'mine' && placement.cell === next && !activated) {
      position = rollback;
      activated = true;
    } else if (
      placement?.kind === 'wormhole' &&
      placement.entrance === next &&
      !activated
    ) {
      position = placement.exit;
      activated = true;
    } else {
      position = next;
    }
    turns += 1;
    history.push(position);
  }

  return {
    turns,
    hardlock: position !== map.end,
    activated,
    trace,
  };
}

function strongFakePlacement(map) {
  const path = bfsPath(map.start, map.end, map.walls);
  if (!path || path.length < 2) return null;
  const pathIndex = Math.floor((path.length - 1) / 2);
  return { kind: 'fake', edge: EDGE_INDEX[path[pathIndex]][path[pathIndex + 1]] };
}

function optimizedFakePlacement(map, trace) {
  if (!trace || trace.moves.length === 0) return null;
  const seen = new Uint8Array(EDGE_COUNT);
  let best = null;
  let bestScore = -Infinity;

  for (const move of trace.moves) {
    if (seen[move.edge] || map.walls[move.edge]) continue;
    seen[move.edge] = 1;
    const normalDistance = goalDistances(map)[move.from];
    const blockedDistance = bfsDistance(move.from, map.end, map.walls, move.edge);
    const detour = blockedDistance < 0 ? 1_000 : blockedDistance - normalDistance;
    const score = detour * 1_000 + move.turn;
    if (score > bestScore) {
      bestScore = score;
      best = { kind: 'fake', edge: move.edge };
    }
  }

  return best;
}

function strongMinePlacement(map) {
  const path = bfsPath(map.start, map.end, map.walls);
  if (!path || path.length < 3) return null;
  const lastCandidateIndex = path.length - 2;
  const index = Math.max(1, Math.min(lastCandidateIndex, Math.floor((path.length - 1) * 0.65)));
  return { kind: 'mine', cell: path[index] };
}

function optimizedMinePlacement(map, trace) {
  if (!trace || trace.moves.length === 0) return null;
  const distances = goalDistances(map);
  const seen = new Uint8Array(CELL_COUNT);
  let best = null;
  let bestScore = -Infinity;

  for (const move of trace.moves) {
    if (move.to === map.start || move.to === map.end || seen[move.to]) continue;
    seen[move.to] = 1;
    const setback = distances[move.rollback] - distances[move.to];
    const score = setback * 1_000 + move.turn;
    if (score > bestScore) {
      bestScore = score;
      best = { kind: 'mine', cell: move.to };
    }
  }

  return best;
}

function bestSafeWormhole(map, entrances) {
  const exits = safeExitCells(map);
  const distances = goalDistances(map);
  let best = null;
  let bestScore = -Infinity;

  for (const candidate of entrances) {
    const entrance = candidate.cell;
    if (entrance === map.start || entrance === map.end) continue;
    for (const exit of exits) {
      if (exit === entrance) continue;
      // A valid exit only needs one immediately open adjacent cell. Goal
      // reachability is intentionally not part of the placement contract.
      const setback = distances[exit] - distances[entrance];
      const score = setback * 1_000 + candidate.tieBreaker;
      if (score > bestScore) {
        bestScore = score;
        best = { kind: 'wormhole', entrance, exit };
      }
    }
  }

  return best;
}

function strongWormholePlacement(map) {
  const path = bfsPath(map.start, map.end, map.walls);
  if (!path || path.length < 3) return null;
  return bestSafeWormhole(
    map,
    path.slice(1, -1).map((cell, index) => ({ cell, tieBreaker: index })),
  );
}

function optimizedWormholePlacement(map, trace) {
  if (!trace || trace.moves.length === 0) return null;
  const seen = new Uint8Array(CELL_COUNT);
  const entrances = [];
  for (const move of trace.moves) {
    if (move.to === map.start || move.to === map.end || seen[move.to]) continue;
    seen[move.to] = 1;
    entrances.push({ cell: move.to, tieBreaker: move.turn });
  }
  return bestSafeWormhole(map, entrances);
}

function strongPlacement(itemId, map) {
  if (itemId === 'fake') return strongFakePlacement(map);
  if (itemId === 'mine') return strongMinePlacement(map);
  if (itemId === 'wormhole') return strongWormholePlacement(map);
  return null;
}

function optimizedPlacement(itemId, map, trace) {
  if (itemId === 'fake') return optimizedFakePlacement(map, trace);
  if (itemId === 'mine') return optimizedMinePlacement(map, trace);
  if (itemId === 'wormhole') return optimizedWormholePlacement(map, trace);
  return null;
}

function createBaselineAccumulator() {
  return { total: 0, hardlocks: 0, turns: [] };
}

function createItemAccumulator() {
  return {
    total: 0,
    placed: 0,
    activated: 0,
    hardlocks: 0,
    turns: [],
    sameMapDelta: [],
    budgetDelta: [],
  };
}

function getOrCreate(map, key, factory) {
  let value = map.get(key);
  if (!value) {
    value = factory();
    map.set(key, value);
  }
  return value;
}

function recordBaseline(accumulator, result) {
  accumulator.total += 1;
  if (result.hardlock) accumulator.hardlocks += 1;
  else accumulator.turns.push(result.turns);
}

function recordItem(accumulator, result, noItemResult, fullBudgetResult, wasPlaced) {
  accumulator.total += 1;
  if (!wasPlaced) return;
  accumulator.placed += 1;
  if (result.activated) accumulator.activated += 1;
  if (result.hardlock) {
    accumulator.hardlocks += 1;
    return;
  }

  accumulator.turns.push(result.turns);
  if (!noItemResult.hardlock) accumulator.sameMapDelta.push(result.turns - noItemResult.turns);
  if (!fullBudgetResult.hardlock) accumulator.budgetDelta.push(result.turns - fullBudgetResult.turns);
}

function mean(values) {
  if (values.length === 0) return NaN;
  let total = 0;
  for (const value of values) total += value;
  return total / values.length;
}

function summarize(values) {
  if (values.length === 0) {
    return { mean: NaN, p50: NaN, p90: NaN, p95: NaN };
  }
  const sorted = [...values].sort((a, b) => a - b);
  const percentile = (ratio) => sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * ratio) - 1)];
  return {
    mean: mean(sorted),
    p50: percentile(0.5),
    p90: percentile(0.9),
    p95: percentile(0.95),
  };
}

function number(value, digits = 2) {
  return Number.isFinite(value) ? value.toFixed(digits) : '-';
}

function percent(numerator, denominator) {
  return denominator > 0 ? `${((numerator / denominator) * 100).toFixed(2)}%` : '-';
}

function baselineKey(budget, policy) {
  return `${budget}|${policy}`;
}

function itemKey(budget, itemId, placementMode, policy) {
  return `${budget}|${itemId}|${placementMode}|${policy}`;
}

function runExperiment(options) {
  const seedHash = hashString(options.seed);
  const results = new Map();
  const startedAt = Date.now();

  for (const aggressiveness of AGGRESSIVENESS) {
    const baselines = new Map();
    const items = new Map();

    for (let trial = 0; trial < options.trials; trial += 1) {
      const budgetOffset = (trial + (seedHash % BUDGETS.length)) % BUDGETS.length;
      const budget = BUDGETS[budgetOffset];
      const rng = trialRng(seedHash, aggressiveness, trial);
      const blueprint = generateBlueprint(budget, aggressiveness, rng);
      const mapCache = new Map();
      const mapForWalls = (wallCount) => {
        if (!mapCache.has(wallCount)) {
          mapCache.set(wallCount, mapFromBlueprint(blueprint, wallCount));
        }
        return mapCache.get(wallCount);
      };

      const fullMap = mapForWalls(budget);
      const fullResults = new Map();
      for (const policy of POLICIES) {
        const result = runGame(fullMap, policy);
        fullResults.set(policy, result);
        recordBaseline(
          getOrCreate(baselines, baselineKey(budget, policy), createBaselineAccumulator),
          result,
        );
      }

      for (const item of ITEM_DEFS) {
        const itemMap = mapForWalls(budget - item.cost);
        const strong = strongPlacement(item.id, itemMap);

        for (const policy of POLICIES) {
          const noItem = runGame(itemMap, policy, null, true);
          const placements = {
            strong,
            optimized: optimizedPlacement(item.id, itemMap, noItem.trace),
          };

          for (const placementMode of PLACEMENT_MODES) {
            const placement = placements[placementMode];
            const result = placement
              ? runGame(itemMap, policy, placement)
              : { turns: 0, hardlock: false, activated: false };
            recordItem(
              getOrCreate(
                items,
                itemKey(budget, item.id, placementMode, policy),
                createItemAccumulator,
              ),
              result,
              noItem,
              fullResults.get(policy),
              !!placement,
            );
          }
        }
      }
    }

    results.set(aggressiveness, { baselines, items });
  }

  return { results, elapsedMs: Date.now() - startedAt };
}

function printResults(options, experiment) {
  console.log('# DaeMok wall/item paired balance simulation');
  console.log(`seed=${JSON.stringify(options.seed)} seedHash=${hashString(options.seed)} trials=${options.trials}/aggressiveness`);
  console.log(`board=${SIZE}x${SIZE} budgets=${MIN_BUDGET}..${MAX_BUDGET} elapsed=${(experiment.elapsedMs / 1000).toFixed(2)}s`);
  console.log('hardlock runs are reported separately and excluded from turn/delta percentiles.');
  console.log('activation is activated/placed; optimized placement is a policy-aware oracle upper bound.');
  console.log('wormhole exits always have >=1 open edge; exit-to-goal reachability is unrestricted.');

  for (const aggressiveness of AGGRESSIVENESS) {
    const { baselines, items } = experiment.results.get(aggressiveness);
    console.log(`\n## ${aggressiveness}: pure walls`);
    console.log('budget policy n mean p50 p90 p95 hardlock');
    for (const budget of BUDGETS) {
      for (const policy of POLICIES) {
        const accumulator = baselines.get(baselineKey(budget, policy)) || createBaselineAccumulator();
        const stats = summarize(accumulator.turns);
        console.log(
          [
            budget,
            policy,
            accumulator.total,
            number(stats.mean),
            number(stats.p50, 0),
            number(stats.p90, 0),
            number(stats.p95, 0),
            percent(accumulator.hardlocks, accumulator.total),
          ].join(' '),
        );
      }
    }

    console.log(`\n## ${aggressiveness}: items paired against same map and pure budget`);
    console.log(
      'budget item placement policy n placed activation turn_mean turn_p50 turn_p90 turn_p95 hardlock same_mean same_p50 same_p90 same_p95 budget_mean',
    );
    for (const budget of BUDGETS) {
      for (const item of ITEM_DEFS) {
        for (const placementMode of PLACEMENT_MODES) {
          for (const policy of POLICIES) {
            const accumulator =
              items.get(itemKey(budget, item.id, placementMode, policy)) ||
              createItemAccumulator();
            const turnStats = summarize(accumulator.turns);
            const sameStats = summarize(accumulator.sameMapDelta);
            console.log(
              [
                budget,
                item.label,
                placementMode,
                policy,
                accumulator.total,
                percent(accumulator.placed, accumulator.total),
                percent(accumulator.activated, accumulator.placed),
                number(turnStats.mean),
                number(turnStats.p50, 0),
                number(turnStats.p90, 0),
                number(turnStats.p95, 0),
                percent(accumulator.hardlocks, accumulator.placed),
                number(sameStats.mean),
                number(sameStats.p50, 0),
                number(sameStats.p90, 0),
                number(sameStats.p95, 0),
                number(mean(accumulator.budgetDelta)),
              ].join(' '),
            );
          }
        }
      }
    }
  }
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const experiment = runExperiment(options);
  printResults(options, experiment);
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
