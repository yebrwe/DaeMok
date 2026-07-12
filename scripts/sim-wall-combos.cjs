/**
 * Fixed-seed paired loadout simulation for DaeMok wall combinations.
 *
 * Usage:
 *   node scripts/sim-wall-combos.cjs
 *   node scripts/sim-wall-combos.cjs --trials 10000 --seed smoke
 *   node scripts/sim-wall-combos.cjs --cost-sensitivity
 *   node scripts/sim-wall-combos.cjs --final-cost-sensitivity
 *
 * Main loadouts run on every trial. The 66 unordered pairs of ten special
 * walls plus fake wall and wormhole are assigned round-robin for synergy.
 */

'use strict';

const { createHash } = require('node:crypto');

const SIZE = 6;
const CELLS = SIZE * SIZE;
const TOTAL_BUDGET = 24;
const DEFAULT_TRIALS = 100_000;
const DEFAULT_SEED = 'daemok-wall-combos-v1';
const DEFAULT_SENSITIVITY_TRIALS = 50_000;
const DEFAULT_SENSITIVITY_SEED = 'daemok-wall-cost-sensitivity-v1';
const MAX_ACTIONS = 500;
const SOFTLOCK_VISITS = 12;
const POLICIES = ['believer', 'adaptive'];
const LOADOUT_SCENARIOS = [
  { id: 'none', anchor: false },
  { id: 'anchor', anchor: true },
];

const COSTS = {
  steel: 1,
  fire: 1,
  poison: 1,
  ice: 1,
  wind: 1,
  collapse: 1,
  phase: 1,
  mirror: 5,
  thorn: 1,
  crystal: 1,
  fake: 7,
  wormhole: 7,
};
const COST_SENSITIVITY_BASE_COSTS = {
  ...COSTS,
  mirror: 2,
  fake: 5,
};
const WALL_KINDS = new Set(Object.keys(COSTS).filter((kind) => kind !== 'wormhole'));
const PERSISTENT_EFFECTS = new Set(['ice', 'wind', 'mirror']);
const ALL_KINDS = Object.keys(COSTS);

const LOADOUTS = [
  { id: 'special-3-balanced', kinds: ['steel', 'phase', 'thorn'] },
  { id: 'special-5-dynamic', kinds: ['fire', 'ice', 'wind', 'collapse', 'mirror'] },
  { id: 'special-10-all', kinds: ['steel', 'fire', 'poison', 'ice', 'wind', 'collapse', 'phase', 'mirror', 'thorn', 'crystal'] },
  { id: 'mixed-fake-3', kinds: ['fake', 'fire', 'crystal'] },
  { id: 'mixed-wormhole-3', kinds: ['wormhole', 'ice', 'collapse'] },
  { id: 'mixed-both-5', kinds: ['fake', 'wormhole', 'wind', 'phase', 'mirror'] },
];
const COST_SENSITIVITY_PAIRS = [
  ['collapse', 'fake'],
  ['mirror', 'crystal'],
  ['mirror', 'thorn'],
];
const COST_INCREMENTS = [0, 1, 2];
const FINAL_COST_INCREMENTS = [0, 1, 2, 3, 4];

function parseArgs(argv) {
  let trials = DEFAULT_TRIALS;
  let seed = DEFAULT_SEED;
  let costSensitivity = false;
  let finalCostSensitivity = false;
  let trialsProvided = false;
  let seedProvided = false;
  const positional = [];
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--help' || argument === '-h') {
      console.log('Usage: node scripts/sim-wall-combos.cjs [trials] [seed] [--trials N] [--seed VALUE] [--cost-sensitivity] [--final-cost-sensitivity]');
      process.exit(0);
    }
    if (argument === '--cost-sensitivity') costSensitivity = true;
    else if (argument === '--final-cost-sensitivity') finalCostSensitivity = true;
    else if (argument === '--trials') {
      trials = argv[++index];
      trialsProvided = true;
    } else if (argument.startsWith('--trials=')) {
      trials = argument.slice(9);
      trialsProvided = true;
    } else if (argument === '--seed') {
      seed = argv[++index];
      seedProvided = true;
    } else if (argument.startsWith('--seed=')) {
      seed = argument.slice(7);
      seedProvided = true;
    } else if (argument.startsWith('-')) throw new Error(`Unknown option: ${argument}`);
    else positional.push(argument);
  }
  if (positional[0] != null) {
    trials = positional[0];
    trialsProvided = true;
  }
  if (positional[1] != null) {
    seed = positional[1];
    seedProvided = true;
  }
  if (positional.length > 2) throw new Error('Too many positional arguments.');
  if (costSensitivity && !trialsProvided) trials = DEFAULT_SENSITIVITY_TRIALS;
  if (costSensitivity && !seedProvided) seed = DEFAULT_SENSITIVITY_SEED;
  if (finalCostSensitivity && !trialsProvided) trials = DEFAULT_SENSITIVITY_TRIALS;
  if (finalCostSensitivity && !seedProvided) seed = 'daemok-wall-final-cost-sensitivity-v1';
  if (costSensitivity && finalCostSensitivity) throw new Error('Choose only one cost sensitivity mode.');
  trials = Number(trials);
  if (!Number.isSafeInteger(trials) || trials <= 0) throw new Error('trials must be a positive integer.');
  return { trials, seed: String(seed || DEFAULT_SEED), costSensitivity, finalCostSensitivity };
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
  let result = value >>> 0;
  result ^= result >>> 16;
  result = Math.imul(result, 0x7feb352d);
  result ^= result >>> 15;
  result = Math.imul(result, 0x846ca68b);
  return (result ^ (result >>> 16)) >>> 0;
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

const rowOf = (cell) => Math.floor(cell / SIZE);
const colOf = (cell) => cell % SIZE;
const cellId = (row, col) => row * SIZE + col;
const manhattan = (a, b) => Math.abs(rowOf(a) - rowOf(b)) + Math.abs(colOf(a) - colOf(b));

const EDGE_INDEX = Array.from({ length: CELLS }, () => {
  const row = new Int16Array(CELLS);
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
const DELTAS = [[-1, 0], [1, 0], [0, -1], [0, 1]];
const NEIGHBORS = Array.from({ length: CELLS }, () => []);
for (let cell = 0; cell < CELLS; cell += 1) {
  for (let direction = 0; direction < DELTAS.length; direction += 1) {
    const [dr, dc] = DELTAS[direction];
    const row = rowOf(cell) + dr;
    const col = colOf(cell) + dc;
    if (row < 0 || row >= SIZE || col < 0 || col >= SIZE) continue;
    const target = cellId(row, col);
    NEIGHBORS[cell].push({ target, direction, edge: EDGE_INDEX[cell][target] });
  }
}

const BFS_QUEUE = new Int16Array(CELLS);
const BFS_PREVIOUS = new Int16Array(CELLS);

function neighborInDirection(cell, direction) {
  const neighbor = NEIGHBORS[cell].find((entry) => entry.direction === direction);
  return neighbor ? neighbor.target : -1;
}

function directionBetween(from, to) {
  const neighbor = NEIGHBORS[from].find((entry) => entry.target === to);
  return neighbor ? neighbor.direction : -1;
}

function bfsPath(from, goal, walls, extraBlocked = null) {
  if (from === goal) return [from];
  BFS_PREVIOUS.fill(-1);
  BFS_PREVIOUS[from] = from;
  let head = 0;
  let tail = 0;
  BFS_QUEUE[tail++] = from;
  while (head < tail) {
    const current = BFS_QUEUE[head++];
    for (const neighbor of NEIGHBORS[current]) {
      if (BFS_PREVIOUS[neighbor.target] !== -1 || walls[neighbor.edge] || extraBlocked?.has(neighbor.edge)) continue;
      BFS_PREVIOUS[neighbor.target] = current;
      if (neighbor.target === goal) {
        const path = [goal];
        let cursor = goal;
        while (cursor !== from) {
          cursor = BFS_PREVIOUS[cursor];
          path.push(cursor);
        }
        path.reverse();
        return path;
      }
      BFS_QUEUE[tail++] = neighbor.target;
    }
  }
  return null;
}

function bfsDistances(from, walls, extraBlocked = null) {
  const distances = new Int16Array(CELLS);
  distances.fill(-1);
  distances[from] = 0;
  let head = 0;
  let tail = 0;
  BFS_QUEUE[tail++] = from;
  while (head < tail) {
    const current = BFS_QUEUE[head++];
    for (const neighbor of NEIGHBORS[current]) {
      if (distances[neighbor.target] !== -1 || walls[neighbor.edge] || extraBlocked?.has(neighbor.edge)) continue;
      distances[neighbor.target] = distances[current] + 1;
      BFS_QUEUE[tail++] = neighbor.target;
    }
  }
  return distances;
}

function chooseEndpoints(rng) {
  let start;
  let goal;
  do {
    start = Math.floor(rng() * CELLS);
    goal = Math.floor(rng() * CELLS);
  } while (start === goal || manhattan(start, goal) < 5);
  return { start, goal };
}

function generateBlueprint(rng, aggressiveness) {
  const pathBias = aggressiveness === 'adversarial' ? 0.82 : 0.18;
  for (let restart = 0; restart < 40; restart += 1) {
    const { start, goal } = chooseEndpoints(rng);
    const walls = new Uint8Array(EDGE_COUNT);
    const rejected = new Uint8Array(EDGE_COUNT);
    const wallOrder = [];
    let guard = 0;
    while (wallOrder.length < TOTAL_BUDGET && guard++ < 6000) {
      let edge = -1;
      if (rng() < pathBias) {
        const path = bfsPath(start, goal, walls);
        if (path && path.length > 1) {
          const index = Math.floor(rng() * (path.length - 1));
          edge = EDGE_INDEX[path[index]][path[index + 1]];
        }
      }
      if (edge < 0 || walls[edge] || rejected[edge]) edge = Math.floor(rng() * EDGE_COUNT);
      if (walls[edge] || rejected[edge]) continue;
      walls[edge] = 1;
      if (!bfsPath(start, goal, walls)) {
        walls[edge] = 0;
        rejected[edge] = 1;
      } else {
        wallOrder.push(edge);
      }
    }
    if (wallOrder.length === TOTAL_BUDGET) return { start, goal, wallOrder };
  }
  throw new Error('Unable to generate paired 24-wall blueprint.');
}

function mapFromBlueprint(blueprint, count) {
  const walls = new Uint8Array(EDGE_COUNT);
  for (let index = 0; index < count; index += 1) walls[blueprint.wallOrder[index]] = 1;
  return { start: blueprint.start, goal: blueprint.goal, walls };
}

function loadoutCost(kinds, costs = COSTS) {
  return kinds.reduce((total, kind) => total + costs[kind], 0);
}

function permanentEdges(items, state) {
  const edges = new Set();
  items.forEach((item, index) => {
    if (item.kind === 'steel' || (item.kind === 'collapse' && state.activeCollapse[index])) edges.add(item.edge);
  });
  return edges;
}

function hasGoalPath(map, position, items, state, additionalEdges = []) {
  const blockers = permanentEdges(items, state);
  const extra = Array.isArray(additionalEdges) ? additionalEdges : [additionalEdges];
  for (const edge of extra) if (edge >= 0) blockers.add(edge);
  return !!bfsPath(position, map.goal, map.walls, blockers);
}

function unconsumedFakeEdges(items, state) {
  return items.flatMap((item, index) =>
    item.kind === 'fake' && !state.consumed[index] ? [item.edge] : []);
}

function edgeStrength(map, edge) {
  const path = bfsPath(map.start, map.goal, map.walls);
  const onPath = path?.some((cell, index) => index + 1 < path.length && EDGE_INDEX[cell][path[index + 1]] === edge);
  const blockers = new Set([edge]);
  const blockedPath = bfsPath(map.start, map.goal, map.walls, blockers);
  const detour = blockedPath && path ? blockedPath.length - path.length : 100;
  return (onPath ? 10000 : 0) + detour * 100;
}

function bestWindDirection(map, edge) {
  const [a, b] = EDGES[edge];
  const startDistances = bfsDistances(map.start, map.walls);
  const goalDistances = bfsDistances(map.goal, map.walls);
  const expectedTarget = startDistances[a] <= startDistances[b] ? b : a;
  let bestDirection = directionBetween(expectedTarget, startDistances[a] <= startDistances[b] ? a : b);
  let bestScore = -1;
  for (let direction = 0; direction < 4; direction += 1) {
    const target = neighborInDirection(expectedTarget, direction);
    if (target >= 0 && goalDistances[target] > bestScore) {
      bestScore = goalDistances[target];
      bestDirection = direction;
    }
  }
  return bestDirection;
}

function placeLoadout(kinds, blueprint, map, effectiveCost = loadoutCost(kinds)) {
  const cost = effectiveCost;
  if (cost > TOTAL_BUDGET || new Set(kinds).size !== kinds.length) return null;
  const omitted = blueprint.wallOrder.slice(TOTAL_BUDGET - cost, TOTAL_BUDGET);
  const available = [...omitted].sort((a, b) => edgeStrength(map, b) - edgeStrength(map, a));
  const items = [];
  for (const kind of kinds) {
    if (!WALL_KINDS.has(kind)) continue;
    const edge = available.shift();
    if (edge == null) return null;
    items.push({ kind, edge, effectDirection: kind === 'wind' ? bestWindDirection(map, edge) : -1 });
  }

  if (kinds.includes('wormhole')) {
    const path = bfsPath(map.start, map.goal, map.walls);
    if (!path || path.length < 3) return null;
    const entrance = path[Math.max(1, Math.min(path.length - 2, Math.floor(path.length * 0.55)))];
    const guaranteed = new Set(items.map((item) => item.edge));
    const goalDistances = bfsDistances(map.goal, map.walls, guaranteed);
    let exit = -1;
    let best = -1;
    for (let cell = 0; cell < CELLS; cell += 1) {
      if (cell === map.start || cell === map.goal || cell === entrance || goalDistances[cell] < 0) continue;
      const open = NEIGHBORS[cell].filter((neighbor) => !map.walls[neighbor.edge] && !guaranteed.has(neighbor.edge)).length;
      if (open >= 2 && goalDistances[cell] > best) {
        best = goalDistances[cell];
        exit = cell;
      }
    }
    if (exit < 0) return null;
    items.push({ kind: 'wormhole', entrance, exit, edge: -1, effectDirection: -1 });
  }
  return items;
}

function matchingWallIndex(items, state, edge, ignoredIndex = -1) {
  return items.findIndex((item, index) => {
    if (index === ignoredIndex) return false;
    if (!WALL_KINDS.has(item.kind) || item.edge !== edge) return false;
    if (item.kind === 'steel') return true;
    if (item.kind === 'collapse' && state.activeCollapse[index]) return true;
    return !state.consumed[index];
  });
}

function forcedStepBlocked(map, items, state, from, to, ignoredIndex = -1) {
  const edge = EDGE_INDEX[from][to];
  return map.walls[edge] || matchingWallIndex(items, state, edge, ignoredIndex) >= 0;
}

function forcedDestination(map, items, state, item, from, target) {
  let destination = target;
  if (item.kind === 'ice' || item.kind === 'wind') {
    const direction = item.kind === 'ice' ? directionBetween(from, target) : item.effectDirection;
    const forced = neighborInDirection(target, direction);
    const triggeringIndex = items.indexOf(item);
    if (forced >= 0 && !forcedStepBlocked(map, items, state, target, forced, triggeringIndex) && hasGoalPath(map, forced, items, state)) {
      destination = forced;
    }
  } else if (item.kind === 'mirror') {
    const mirrored = cellId(SIZE - 1 - rowOf(target), SIZE - 1 - colOf(target));
    if (hasGoalPath(map, mirrored, items, state)) destination = mirrored;
  }
  return destination;
}

function matchingKnownWallIndex(items, state, edge, ignoredIndex = -1) {
  return items.findIndex((item, index) => {
    if (index === ignoredIndex) return false;
    if (!state.known[index] || !WALL_KINDS.has(item.kind) || item.edge !== edge) return false;
    if (item.kind === 'steel') return true;
    if (item.kind === 'collapse' && state.activeCollapse[index]) return true;
    return !state.consumed[index];
  });
}

function plannerHasGoalPath(map, items, state, believed, position) {
  const knownPermanent = new Set();
  items.forEach((item, index) => {
    if (!state.known[index]) return;
    if (item.kind === 'steel' || (item.kind === 'collapse' && state.activeCollapse[index])) {
      knownPermanent.add(item.edge);
    }
  });
  return !!bfsPath(position, map.goal, believed, knownPermanent);
}

function plannerForcedDestination(map, items, state, believed, item, from, target) {
  let destination = target;
  if (item.kind === 'ice' || item.kind === 'wind') {
    const direction = item.kind === 'ice' ? directionBetween(from, target) : item.effectDirection;
    const forced = neighborInDirection(target, direction);
    if (forced >= 0) {
      const edge = EDGE_INDEX[target][forced];
      const triggeringIndex = items.indexOf(item);
      const predictedBlocked = believed[edge] ||
        matchingKnownWallIndex(items, state, edge, triggeringIndex) >= 0;
      if (!predictedBlocked && plannerHasGoalPath(map, items, state, believed, forced)) destination = forced;
    }
  } else if (item.kind === 'mirror') {
    const mirrored = cellId(SIZE - 1 - rowOf(target), SIZE - 1 - colOf(target));
    if (plannerHasGoalPath(map, items, state, believed, mirrored)) destination = mirrored;
  }
  return destination;
}

function createItemState(items) {
  return {
    consumed: new Uint8Array(items.length),
    activeCollapse: new Uint8Array(items.length),
    phaseOpen: new Uint8Array(items.length),
    known: new Uint8Array(items.length),
    anchorUsed: false,
  };
}

function cloneItems(items) {
  return items.map((item) => ({ ...item }));
}

function plannerTransition(map, items, state, believed, anchorEnabled, anchorUsed, from, neighbor) {
  const index = items.findIndex((item, itemIndex) => item.edge === neighbor.edge && state.known[itemIndex]);
  if (index < 0) return { destination: neighbor.target, phaseOpen: -1, anchorUsed };
  const item = items[index];
  if (item.kind === 'steel' || (item.kind === 'collapse' && state.activeCollapse[index])) return null;
  if (item.kind === 'phase' && !state.consumed[index]) {
    return state.phaseOpen[index]
      ? { destination: neighbor.target, phaseOpen: 0, anchorUsed }
      : { destination: from, phaseOpen: 1, anchorUsed };
  }
  if (!state.consumed[index] && PERSISTENT_EFFECTS.has(item.kind) && neighbor.target !== map.goal) {
    const forced = plannerForcedDestination(map, items, state, believed, item, from, neighbor.target);
    if (anchorEnabled && !anchorUsed && forced !== neighbor.target) {
      return { destination: neighbor.target, phaseOpen: -1, anchorUsed: 1 };
    }
    return { destination: forced, phaseOpen: -1, anchorUsed };
  }
  return { destination: neighbor.target, phaseOpen: -1, anchorUsed };
}

function planFirstStep(map, items, state, believed, position, anchorEnabled) {
  const phaseIndex = items.findIndex((item, index) => item.kind === 'phase' && state.known[index] && !state.consumed[index]);
  const phaseStates = phaseIndex >= 0 ? 2 : 1;
  const anchorStates = anchorEnabled ? 2 : 1;
  const multiplier = phaseStates * anchorStates;
  const stateCount = CELLS * multiplier;
  const visited = new Uint8Array(stateCount);
  const first = new Int16Array(stateCount);
  const queue = new Int16Array(stateCount);
  first.fill(-1);
  const initialPhase = phaseIndex >= 0 && state.phaseOpen[phaseIndex] ? 1 : 0;
  const initialAnchor = anchorEnabled && state.anchorUsed ? 1 : 0;
  const initial = position * multiplier + initialPhase * anchorStates + initialAnchor;
  visited[initial] = 1;
  let head = 0;
  let tail = 0;
  queue[tail++] = initial;
  while (head < tail) {
    const plannerState = queue[head++];
    const from = Math.floor(plannerState / multiplier);
    const dynamicState = plannerState % multiplier;
    const phaseValue = phaseIndex >= 0 ? Math.floor(dynamicState / anchorStates) : -1;
    const anchorValue = anchorEnabled ? dynamicState % anchorStates : 0;
    if (phaseIndex >= 0) state.phaseOpen[phaseIndex] = phaseValue;
    for (const neighbor of NEIGHBORS[from]) {
      if (believed[neighbor.edge]) continue;
      const transition = plannerTransition(map, items, state, believed, anchorEnabled, anchorValue, from, neighbor);
      if (!transition) continue;
      const nextPhase = transition.phaseOpen >= 0 ? transition.phaseOpen : phaseValue;
      const nextState = transition.destination * multiplier +
        (phaseIndex >= 0 ? nextPhase * anchorStates : 0) + transition.anchorUsed;
      if (visited[nextState]) continue;
      visited[nextState] = 1;
      first[nextState] = plannerState === initial ? neighbor.target : first[plannerState];
      if (transition.destination === map.goal) {
        if (phaseIndex >= 0) state.phaseOpen[phaseIndex] = initialPhase;
        return first[nextState];
      }
      queue[tail++] = nextState;
    }
  }
  if (phaseIndex >= 0) state.phaseOpen[phaseIndex] = initialPhase;
  return -1;
}

function beliefMasks(believed) {
  let low = 0;
  let high = 0;
  for (let edge = 0; edge < EDGE_COUNT; edge += 1) {
    if (!believed[edge]) continue;
    if (edge < 30) low |= 1 << edge;
    else high |= 1 << (edge - 30);
  }
  return `${low >>> 0}:${high >>> 0}`;
}

function dynamicMask(values) {
  let result = 0;
  for (let index = 0; index < values.length; index += 1) if (values[index]) result |= 1 << index;
  return result >>> 0;
}

function adaptiveKnowledgeKey(believed, hits, learnedAt) {
  const timestamps = [];
  for (let edge = 0; edge < EDGE_COUNT; edge += 1) {
    if (believed[edge] || hits[edge] > 0) timestamps.push(learnedAt[edge]);
  }
  const orderedTimestamps = [...new Set(timestamps)].sort((left, right) => left - right);
  const timestampRanks = new Map(orderedTimestamps.map((timestamp, rank) => [timestamp, rank]));
  const entries = [];
  for (let edge = 0; edge < EDGE_COUNT; edge += 1) {
    if (!believed[edge] && hits[edge] === 0) continue;
    entries.push(`${edge}:${believed[edge]}:${hits[edge]}:${timestampRanks.get(learnedAt[edge])}`);
  }
  return entries.join(',');
}

function forgetWeakest(believed, hits, learnedAt) {
  let candidate = -1;
  for (let edge = 0; edge < EDGE_COUNT; edge += 1) {
    if (!believed[edge]) continue;
    if (candidate < 0 || hits[edge] < hits[candidate] ||
      (hits[edge] === hits[candidate] && learnedAt[edge] < learnedAt[candidate])) candidate = edge;
  }
  if (candidate < 0) return false;
  believed[candidate] = 0;
  return true;
}

function revealCrystal(map, believed, center) {
  for (let dr = -1; dr <= 1; dr += 1) {
    for (let dc = -1; dc <= 1; dc += 1) {
      const row = rowOf(center) + dr;
      const col = colOf(center) + dc;
      if (row < 0 || row >= SIZE || col < 0 || col >= SIZE) continue;
      for (const neighbor of NEIGHBORS[cellId(row, col)]) {
        if (map.walls[neighbor.edge]) believed[neighbor.edge] = 1;
      }
    }
  }
}

function runGame(map, policy, sourceItems, options = {}) {
  const anchorEnabled = options.anchor === true;
  const items = cloneItems(sourceItems);
  const state = createItemState(items);
  const believed = new Uint8Array(EDGE_COUNT);
  const hits = new Uint16Array(EDGE_COUNT);
  const learnedAt = new Uint16Array(EDGE_COUNT);
  const history = [map.start];
  const visits = new Map();
  const activatedKinds = new Set();
  let position = map.start;
  let moves = 0;
  let actions = 0;
  let runtimeSafetyFailure = false;

  const learn = (edge) => {
    believed[edge] = 1;
    hits[edge] += 1;
    learnedAt[edge] = actions;
  };

  while (position !== map.goal && actions < MAX_ACTIONS) {
    const previous = history.length >= 2 ? history[history.length - 2] : history[0];
    const policyState = policy === 'adaptive'
      ? adaptiveKnowledgeKey(believed, hits, learnedAt)
      : beliefMasks(believed);
    const key = `${position}|${previous}|${dynamicMask(state.consumed)}|${dynamicMask(state.activeCollapse)}|${dynamicMask(state.phaseOpen)}|${dynamicMask(state.known)}|${state.anchorUsed ? 1 : 0}|${policyState}`;
    const visitCount = (visits.get(key) || 0) + 1;
    visits.set(key, visitCount);
    if (visitCount >= SOFTLOCK_VISITS) {
      return { completed: false, hardlock: false, softlock: true, runtimeSafetyFailure, moves, activatedKinds, anchorUsed: state.anchorUsed };
    }

    const target = planFirstStep(map, items, state, believed, position, anchorEnabled);
    if (target < 0) {
      if (policy === 'adaptive' && forgetWeakest(believed, hits, learnedAt)) continue;
      return { completed: false, hardlock: true, softlock: false, runtimeSafetyFailure, moves, activatedKinds, anchorUsed: state.anchorUsed };
    }

    const origin = position;
    const edge = EDGE_INDEX[origin][target];
    const itemIndex = matchingWallIndex(items, state, edge);
    const item = itemIndex >= 0 ? items[itemIndex] : null;
    let blocked = !!map.walls[edge];
    let actionCost = 1;
    let attempted = target;
    let cellEffect = false;

    if (item) {
      state.known[itemIndex] = 1;
      activatedKinds.add(item.kind);
      if (item.kind === 'fake') {
        blocked = true;
        state.consumed[itemIndex] = 1;
      } else if (item.kind === 'steel') {
        blocked = true;
      } else if (item.kind === 'fire') {
        blocked = true;
        actionCost = 2;
        state.consumed[itemIndex] = 1;
      } else if (item.kind === 'poison') {
        actionCost = 3;
        state.consumed[itemIndex] = 1;
      } else if (item.kind === 'collapse') {
        blocked = !!state.activeCollapse[itemIndex];
      } else if (item.kind === 'phase') {
        if (state.phaseOpen[itemIndex]) state.phaseOpen[itemIndex] = 0;
        else {
          blocked = true;
          state.phaseOpen[itemIndex] = 1;
        }
      } else if (item.kind === 'thorn') {
        blocked = true;
        state.consumed[itemIndex] = 1;
      } else if (item.kind === 'crystal') {
        blocked = true;
        state.consumed[itemIndex] = 1;
        revealCrystal(map, believed, origin);
      }
    }

    if (blocked) {
      position = origin;
      if (item?.kind === 'thorn') {
        const rewind = history.length >= 2 ? history[history.length - 2] : history[0];
        const canRewind = rewind !== origin && hasGoalPath(map, rewind, items, state);
        if (canRewind) {
          if (anchorEnabled && !state.anchorUsed) state.anchorUsed = true;
          else position = rewind;
        }
      }
      if (
        !item ||
        item.kind === 'steel' ||
        (item.kind === 'collapse' && state.activeCollapse[itemIndex])
      ) learn(edge);
    } else {
      position = attempted;
      const wormholeIndex = items.findIndex((entry, index) =>
        entry.kind === 'wormhole' && !state.consumed[index] && entry.entrance === attempted);
      if (wormholeIndex >= 0) {
        state.consumed[wormholeIndex] = 1;
        state.known[wormholeIndex] = 1;
        activatedKinds.add('wormhole');
        if (anchorEnabled && !state.anchorUsed) {
          state.anchorUsed = true;
          position = attempted;
        } else {
          position = items[wormholeIndex].exit;
        }
        cellEffect = true;
      }

      if (!cellEffect && item && PERSISTENT_EFFECTS.has(item.kind) && position !== map.goal) {
        const forced = forcedDestination(map, items, state, item, origin, attempted);
        if (anchorEnabled && !state.anchorUsed && forced !== attempted) {
          state.anchorUsed = true;
          position = attempted;
        } else {
          position = forced;
        }
      }
      if (item?.kind === 'wind' || item?.kind === 'mirror') state.consumed[itemIndex] = 1;

      if (item?.kind === 'collapse' && !state.activeCollapse[itemIndex]) {
        const beliefSafeEdges = [edge, ...unconsumedFakeEdges(items, state)];
        const canClose = hasGoalPath(map, attempted, items, state, beliefSafeEdges) &&
          hasGoalPath(map, position, items, state, beliefSafeEdges);
        if (canClose) {
          state.activeCollapse[itemIndex] = 1;
          learn(edge);
        } else {
          state.consumed[itemIndex] = 1;
        }
      }
    }

    actions += 1;
    moves += actionCost;
    history.push(position);
    if (!hasGoalPath(map, position, items, state)) {
      runtimeSafetyFailure = true;
      return { completed: false, hardlock: true, softlock: false, runtimeSafetyFailure, moves, activatedKinds, anchorUsed: state.anchorUsed };
    }
  }

  if (position === map.goal) {
    return { completed: true, hardlock: false, softlock: false, runtimeSafetyFailure, moves, activatedKinds, anchorUsed: state.anchorUsed };
  }
  return { completed: false, hardlock: false, softlock: true, runtimeSafetyFailure, moves, activatedKinds, anchorUsed: state.anchorUsed };
}

function createAccumulator() {
  return {
    total: 0,
    completed: 0,
    hardlocks: 0,
    softlocks: 0,
    safetyFailures: 0,
    placementFailures: 0,
    anchorUses: 0,
    turns: [],
    prefixDeltas: [],
    pureDeltas: [],
    activation: new Map(),
  };
}

function record(acc, result, prefixBaseline, pureBaseline, itemsPlaced) {
  acc.total += 1;
  if (!itemsPlaced || !result) {
    acc.placementFailures += 1;
    return;
  }
  if (result.completed) {
    acc.completed += 1;
    acc.turns.push(result.moves);
    if (prefixBaseline.completed) acc.prefixDeltas.push(result.moves - prefixBaseline.moves);
    if (pureBaseline.completed) acc.pureDeltas.push(result.moves - pureBaseline.moves);
  }
  if (result.hardlock) acc.hardlocks += 1;
  if (result.softlock) acc.softlocks += 1;
  if (result.runtimeSafetyFailure) acc.safetyFailures += 1;
  if (result.anchorUsed) acc.anchorUses += 1;
  for (const item of itemsPlaced) {
    if (!acc.activation.has(item.kind)) acc.activation.set(item.kind, { placed: 0, activated: 0 });
    const activation = acc.activation.get(item.kind);
    activation.placed += 1;
    if (result.activatedKinds.has(item.kind)) activation.activated += 1;
  }
}

function createPairAccumulator() {
  return { ...createAccumulator(), synergies: [] };
}

function summarize(values) {
  if (values.length === 0) return { mean: NaN, p95: NaN };
  const sorted = [...values].sort((a, b) => a - b);
  let total = 0;
  for (const value of sorted) total += value;
  return { mean: total / sorted.length, p95: sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1)] };
}

const percent = (part, total) => total ? (part / total) * 100 : NaN;
const format = (value, digits = 2) => Number.isFinite(value) ? value.toFixed(digits) : '-';

function resultRow(acc) {
  const turns = summarize(acc.turns);
  const prefixDeltas = summarize(acc.prefixDeltas);
  const pureDeltas = summarize(acc.pureDeltas);
  return {
    n: acc.total,
    completion: percent(acc.completed, acc.total),
    mean: turns.mean,
    p95: turns.p95,
    prefixDeltaMean: prefixDeltas.mean,
    prefixDeltaP95: prefixDeltas.p95,
    pureDeltaMean: pureDeltas.mean,
    pureDeltaP95: pureDeltas.p95,
    hardlock: percent(acc.hardlocks, acc.total),
    softlock: percent(acc.softlocks, acc.total),
    safetyFailure: percent(acc.safetyFailures, acc.total),
    placementFailure: percent(acc.placementFailures, acc.total),
    anchorUse: percent(acc.anchorUses, acc.total),
  };
}

function allPairs() {
  const pairs = [];
  for (let left = 0; left < ALL_KINDS.length; left += 1) {
    for (let right = left + 1; right < ALL_KINDS.length; right += 1) pairs.push([ALL_KINDS[left], ALL_KINDS[right]]);
  }
  return pairs;
}

function runExperiment(options) {
  const seedHash = hashString(options.seed);
  const loadoutResults = new Map();
  const policyGapTurns = new Map(LOADOUTS.flatMap((loadout) =>
    LOADOUT_SCENARIOS.map((scenario) => [`${loadout.id}|${scenario.id}`, []])));
  const anchorSensitivityTurns = new Map(LOADOUTS.flatMap((loadout) =>
    POLICIES.map((policy) => [`${loadout.id}|${policy}`, []])));
  const pairResults = new Map();
  const pairs = allPairs();
  const startedAt = Date.now();

  for (let trial = 0; trial < options.trials; trial += 1) {
    const rng = mulberry32(mix32(seedHash ^ Math.imul(trial + 1, 0x9e3779b1)));
    const blueprint = generateBlueprint(rng, trial % 2 ? 'adversarial' : 'casual');
    const pureMap = mapFromBlueprint(blueprint, TOTAL_BUDGET);
    const pure = Object.fromEntries(POLICIES.map((policy) => [policy, runGame(pureMap, policy, [])]));

    for (const loadout of LOADOUTS) {
      const cost = loadoutCost(loadout.kinds);
      const map = mapFromBlueprint(blueprint, TOTAL_BUDGET - cost);
      const items = placeLoadout(loadout.kinds, blueprint, map);
      const prefix = Object.fromEntries(POLICIES.map((policy) => [policy, runGame(map, policy, [])]));
      const scenarioRuns = {};
      for (const scenario of LOADOUT_SCENARIOS) {
        const runs = Object.fromEntries(POLICIES.map((policy) => [
          policy,
          items ? runGame(map, policy, items, scenario) : null,
        ]));
        scenarioRuns[scenario.id] = runs;
        for (const policy of POLICIES) {
          const key = `${loadout.id}|${scenario.id}|${policy}`;
          if (!loadoutResults.has(key)) loadoutResults.set(key, createAccumulator());
          record(loadoutResults.get(key), runs[policy], prefix[policy], pure[policy], items);
        }
        if (runs.believer?.completed && runs.adaptive?.completed) {
          const gapKey = `${loadout.id}|${scenario.id}`;
          policyGapTurns.get(gapKey).push(runs.adaptive.moves - runs.believer.moves);
        }
      }
      for (const policy of POLICIES) {
        const withoutAnchor = scenarioRuns.none[policy];
        const withAnchor = scenarioRuns.anchor[policy];
        if (withoutAnchor?.completed && withAnchor?.completed) {
          anchorSensitivityTurns.get(`${loadout.id}|${policy}`).push(withAnchor.moves - withoutAnchor.moves);
        }
      }
    }

    const pair = pairs[(Math.floor(trial / 2) + seedHash) % pairs.length];
    const pairId = pair.join('+');
    const cost = loadoutCost(pair);
    const map = mapFromBlueprint(blueprint, TOTAL_BUDGET - cost);
    const items = placeLoadout(pair, blueprint, map);
    for (const policy of POLICIES) {
      const pairKey = `${pairId}|${policy}`;
      if (!pairResults.has(pairKey)) pairResults.set(pairKey, createPairAccumulator());
      const pairAcc = pairResults.get(pairKey);
      if (!items) {
        record(pairAcc, null, pure[policy], pure[policy], null);
        continue;
      }
      const noItem = runGame(map, policy, []);
      const left = runGame(map, policy, items.filter((item) => item.kind === pair[0]));
      const right = runGame(map, policy, items.filter((item) => item.kind === pair[1]));
      const together = runGame(map, policy, items);
      record(pairAcc, together, noItem, pure[policy], items);
      if (noItem.completed && left.completed && right.completed && together.completed) {
        pairAcc.synergies.push(together.moves - left.moves - right.moves + noItem.moves);
      }
    }
  }
  return { loadoutResults, policyGapTurns, anchorSensitivityTurns, pairResults, elapsedMs: Date.now() - startedAt };
}

function runCostSensitivity(options) {
  const seedHash = hashString(options.seed);
  const results = new Map();
  const pairedTurnDeltas = new Map();
  const startedAt = Date.now();

  for (let trial = 0; trial < options.trials; trial += 1) {
    const rng = mulberry32(mix32(seedHash ^ Math.imul(trial + 1, 0x9e3779b1)));
    const blueprint = generateBlueprint(rng, trial % 2 ? 'adversarial' : 'casual');

    for (const pair of COST_SENSITIVITY_PAIRS) {
      const pairId = pair.join('+');
      const baseCost = loadoutCost(pair, COST_SENSITIVITY_BASE_COSTS);
      const placementMap = mapFromBlueprint(blueprint, TOTAL_BUDGET - baseCost);
      const items = placeLoadout(pair, blueprint, placementMap);

      for (const policy of POLICIES) {
        const trialResults = new Map();
        for (const increment of COST_INCREMENTS) {
          const effectiveCost = baseCost + increment;
          const map = mapFromBlueprint(blueprint, TOTAL_BUDGET - effectiveCost);
          const result = items ? runGame(map, policy, items) : null;
          const key = `${pairId}|${policy}|${increment}`;
          if (!results.has(key)) results.set(key, createAccumulator());
          record(results.get(key), result, result, result, items);
          trialResults.set(increment, result);
        }

        const baseline = trialResults.get(0);
        for (const increment of COST_INCREMENTS.slice(1)) {
          const result = trialResults.get(increment);
          if (!baseline?.completed || !result?.completed) continue;
          const key = `${pairId}|${policy}|${increment}`;
          if (!pairedTurnDeltas.has(key)) pairedTurnDeltas.set(key, []);
          pairedTurnDeltas.get(key).push(result.moves - baseline.moves);
        }
      }
    }
  }

  return { results, pairedTurnDeltas, elapsedMs: Date.now() - startedAt };
}

function printableCostSensitivity(options, experiment) {
  const rows = COST_SENSITIVITY_PAIRS.flatMap((pair) => POLICIES.flatMap((policy) =>
    COST_INCREMENTS.map((increment) => {
      const pairId = pair.join('+');
      const baseCost = loadoutCost(pair, COST_SENSITIVITY_BASE_COSTS);
      const key = `${pairId}|${policy}|${increment}`;
      const pairedTurns = increment === 0 ? [] : experiment.pairedTurnDeltas.get(key) || [];
      const paired = summarize(pairedTurns);
      return {
        pair: pairId,
        policy,
        increment,
        effectiveCost: baseCost + increment,
        staticPrefix: TOTAL_BUDGET - baseCost - increment,
        ...resultRow(experiment.results.get(key) || createAccumulator()),
        pairedN: pairedTurns.length,
        pairedMean: paired.mean,
        pairedP95: paired.p95,
      };
    })));

  for (const row of rows) {
    const baseline = rows.find((candidate) =>
      candidate.pair === row.pair && candidate.policy === row.policy && candidate.increment === 0);
    row.completionDelta = row.completion - baseline.completion;
    row.hardlockDelta = row.hardlock - baseline.hardlock;
    row.softlockDelta = row.softlock - baseline.softlock;
    row.totalLock = row.hardlock + row.softlock;
  }

  return {
    mode: 'cost-sensitivity',
    seed: options.seed,
    trials: options.trials,
    boardSize: SIZE,
    totalBudget: TOTAL_BUDGET,
    maxActions: MAX_ACTIONS,
    softlockVisits: SOFTLOCK_VISITS,
    policies: POLICIES,
    costs: COST_SENSITIVITY_BASE_COSTS,
    pairs: COST_SENSITIVITY_PAIRS,
    increments: COST_INCREMENTS,
    placement: 'base-cost item positions reused; prefix-only walls removed for +1/+2',
    scenario: { mazeSkill: 'none', actions: 'move-only' },
    rows,
  };
}

function printCostSensitivity(options, experiment) {
  const output = printableCostSensitivity(options, experiment);
  const resultHash = createHash('sha256').update(JSON.stringify(output)).digest('hex');
  console.log('# DaeMok risky-pair cost sensitivity');
  console.log(`seed=${JSON.stringify(options.seed)} trials=${options.trials} totalBudget=${TOTAL_BUDGET}`);
  console.log('item positions are fixed at current cost; +1/+2 removes only trailing static prefix walls.');
  console.log(`elapsed=${(experiment.elapsedMs / 1000).toFixed(2)}s resultHash=${resultHash}`);
  console.log('pair policy increment effective_cost static_prefix n completion mean p95 paired_n paired_mean paired_p95 hardlock softlock total_lock safety_failure placement_failure completion_pp hardlock_pp softlock_pp');
  for (const row of output.rows) {
    console.log([
      row.pair, row.policy, `+${row.increment}`, row.effectiveCost, row.staticPrefix, row.n,
      `${format(row.completion)}%`, format(row.mean), format(row.p95, 0), row.pairedN,
      format(row.pairedMean), format(row.pairedP95, 0), `${format(row.hardlock)}%`,
      `${format(row.softlock)}%`, `${format(row.totalLock)}%`, `${format(row.safetyFailure)}%`,
      `${format(row.placementFailure)}%`, format(row.completionDelta), format(row.hardlockDelta),
      format(row.softlockDelta),
    ].join(' '));
  }
}

function runFinalCostSensitivity(options) {
  const seedHash = hashString(options.seed);
  const results = new Map();
  const pairedTurnDeltas = new Map();
  const startedAt = Date.now();

  for (let trial = 0; trial < options.trials; trial += 1) {
    const rng = mulberry32(mix32(seedHash ^ Math.imul(trial + 1, 0x9e3779b1)));
    const blueprint = generateBlueprint(rng, trial % 2 ? 'adversarial' : 'casual');

    for (const pair of COST_SENSITIVITY_PAIRS) {
      const pairId = pair.join('+');
      const baseCost = loadoutCost(pair);

      for (const policy of POLICIES) {
        const trialResults = new Map();
        for (const increment of FINAL_COST_INCREMENTS) {
          const effectiveCost = baseCost + increment;
          const map = mapFromBlueprint(blueprint, TOTAL_BUDGET - effectiveCost);
          const items = placeLoadout(pair, blueprint, map, effectiveCost);
          const result = items ? runGame(map, policy, items) : null;
          const key = `${pairId}|${policy}|${increment}`;
          if (!results.has(key)) results.set(key, createAccumulator());
          record(results.get(key), result, result, result, items);
          trialResults.set(increment, result);
        }

        const baseline = trialResults.get(0);
        for (const increment of FINAL_COST_INCREMENTS.slice(1)) {
          const result = trialResults.get(increment);
          if (!baseline?.completed || !result?.completed) continue;
          const key = `${pairId}|${policy}|${increment}`;
          if (!pairedTurnDeltas.has(key)) pairedTurnDeltas.set(key, []);
          pairedTurnDeltas.get(key).push(result.moves - baseline.moves);
        }
      }
    }
  }

  return { results, pairedTurnDeltas, elapsedMs: Date.now() - startedAt };
}

function printableFinalCostSensitivity(options, experiment) {
  const rows = COST_SENSITIVITY_PAIRS.flatMap((pair) => POLICIES.flatMap((policy) =>
    FINAL_COST_INCREMENTS.map((increment) => {
      const pairId = pair.join('+');
      const baseCost = loadoutCost(pair);
      const key = `${pairId}|${policy}|${increment}`;
      const pairedTurns = increment === 0 ? [] : experiment.pairedTurnDeltas.get(key) || [];
      const paired = summarize(pairedTurns);
      const row = resultRow(experiment.results.get(key) || createAccumulator());
      return {
        pair: pairId,
        policy,
        increment,
        effectiveCost: baseCost + increment,
        staticPrefix: TOTAL_BUDGET - baseCost - increment,
        ...row,
        totalLock: row.hardlock + row.softlock,
        pairedN: pairedTurns.length,
        pairedMean: paired.mean,
        pairedP95: paired.p95,
      };
    })));

  for (const row of rows) {
    const baseline = rows.find((candidate) =>
      candidate.pair === row.pair && candidate.policy === row.policy && candidate.increment === 0);
    row.completionDelta = row.completion - baseline.completion;
    row.hardlockDelta = row.hardlock - baseline.hardlock;
    row.softlockDelta = row.softlock - baseline.softlock;
  }

  return {
    mode: 'final-cost-sensitivity',
    seed: options.seed,
    trials: options.trials,
    boardSize: SIZE,
    totalBudget: TOTAL_BUDGET,
    maxActions: MAX_ACTIONS,
    softlockVisits: SOFTLOCK_VISITS,
    policies: POLICIES,
    costs: COSTS,
    pairs: COST_SENSITIVITY_PAIRS,
    increments: FINAL_COST_INCREMENTS,
    placement: 'items repositioned independently from each effective-cost wall pool',
    scenario: { mazeSkill: 'none', actions: 'move-only' },
    rows,
  };
}

function printFinalCostSensitivity(options, experiment) {
  const output = printableFinalCostSensitivity(options, experiment);
  const resultHash = createHash('sha256').update(JSON.stringify(output)).digest('hex');
  console.log('# DaeMok risky-pair final cost sensitivity');
  console.log(`seed=${JSON.stringify(options.seed)} trials=${options.trials} totalBudget=${TOTAL_BUDGET}`);
  console.log('item positions are regenerated from the omitted wall pool at every effective cost.');
  console.log(`elapsed=${(experiment.elapsedMs / 1000).toFixed(2)}s resultHash=${resultHash}`);
  console.log('pair policy increment effective_cost static_prefix n completion mean p95 paired_n paired_mean paired_p95 hardlock softlock total_lock safety_failure placement_failure completion_pp hardlock_pp softlock_pp');
  for (const row of output.rows) {
    console.log([
      row.pair, row.policy, `+${row.increment}`, row.effectiveCost, row.staticPrefix, row.n,
      `${format(row.completion)}%`, format(row.mean), format(row.p95, 0), row.pairedN,
      format(row.pairedMean), format(row.pairedP95, 0), `${format(row.hardlock)}%`,
      `${format(row.softlock)}%`, `${format(row.totalLock)}%`, `${format(row.safetyFailure)}%`,
      `${format(row.placementFailure)}%`, format(row.completionDelta), format(row.hardlockDelta),
      format(row.softlockDelta),
    ].join(' '));
  }
}

function printable(options, experiment) {
  const loadouts = LOADOUTS.flatMap((loadout) => LOADOUT_SCENARIOS.flatMap((scenario) =>
    POLICIES.map((policy) => ({
      id: loadout.id,
      kinds: loadout.kinds,
      cost: loadoutCost(loadout.kinds),
      scenario: scenario.id,
      policy,
      ...resultRow(experiment.loadoutResults.get(`${loadout.id}|${scenario.id}|${policy}`) || createAccumulator()),
    }))));
  const policyGaps = LOADOUTS.flatMap((loadout) => LOADOUT_SCENARIOS.map((scenario) => {
    const believer = loadouts.find((row) =>
      row.id === loadout.id && row.scenario === scenario.id && row.policy === 'believer');
    const adaptive = loadouts.find((row) =>
      row.id === loadout.id && row.scenario === scenario.id && row.policy === 'adaptive');
    const gapKey = `${loadout.id}|${scenario.id}`;
    const pairedTurns = experiment.policyGapTurns.get(gapKey) || [];
    const paired = summarize(pairedTurns);
    return {
      id: loadout.id,
      scenario: scenario.id,
      pairedN: pairedTurns.length,
      adaptiveMinusBelieverMean: paired.mean,
      adaptiveMinusBelieverP95: paired.p95,
      adaptiveMinusBelieverCompletion: adaptive.completion - believer.completion,
      adaptiveMinusBelieverHardlock: adaptive.hardlock - believer.hardlock,
      adaptiveMinusBelieverSoftlock: adaptive.softlock - believer.softlock,
    };
  }));
  const anchorSensitivity = LOADOUTS.flatMap((loadout) => POLICIES.map((policy) => {
    const withoutAnchor = loadouts.find((row) =>
      row.id === loadout.id && row.scenario === 'none' && row.policy === policy);
    const withAnchor = loadouts.find((row) =>
      row.id === loadout.id && row.scenario === 'anchor' && row.policy === policy);
    const pairedTurns = experiment.anchorSensitivityTurns.get(`${loadout.id}|${policy}`) || [];
    const paired = summarize(pairedTurns);
    return {
      id: loadout.id,
      policy,
      pairedN: pairedTurns.length,
      anchorMinusNoneMean: paired.mean,
      anchorMinusNoneP95: paired.p95,
      anchorMinusNoneCompletion: withAnchor.completion - withoutAnchor.completion,
      anchorMinusNoneHardlock: withAnchor.hardlock - withoutAnchor.hardlock,
      anchorMinusNoneSoftlock: withAnchor.softlock - withoutAnchor.softlock,
      anchorUse: withAnchor.anchorUse,
    };
  }));
  const pairs = [...experiment.pairResults.entries()].map(([key, acc]) => {
    const [id, policy] = key.split('|');
    const row = resultRow(acc);
    const synergy = summarize(acc.synergies);
    const riskScore = (Number.isFinite(synergy.mean) ? synergy.mean : 0) + row.hardlock * 2 + row.softlock + row.safetyFailure * 10;
    return {
      id,
      policy,
      cost: loadoutCost(id.split('+')),
      ...row,
      synergyN: acc.synergies.length,
      synergyMean: synergy.mean,
      synergyP95: synergy.p95,
      riskScore,
    };
  }).sort((left, right) => right.riskScore - left.riskScore);
  return {
    seed: options.seed,
    trials: options.trials,
    boardSize: SIZE,
    totalBudget: TOTAL_BUDGET,
    maxActions: MAX_ACTIONS,
    softlockVisits: SOFTLOCK_VISITS,
    policies: POLICIES,
    loadoutScenarios: LOADOUT_SCENARIOS.map((scenario) => scenario.id),
    pairScenario: { mazeSkill: 'none', actions: 'move-only' },
    costs: COSTS,
    loadouts,
    policyGaps,
    anchorSensitivity,
    pairs,
  };
}

function printResults(options, experiment) {
  const output = printable(options, experiment);
  const resultHash = createHash('sha256').update(JSON.stringify(output)).digest('hex');
  console.log('# DaeMok wall-combination paired simulation');
  console.log(`seed=${JSON.stringify(options.seed)} trials=${options.trials} totalBudget=${TOTAL_BUDGET}`);
  console.log(`costs=${Object.entries(COSTS).map(([kind, cost]) => `${kind}:${cost}`).join(',')}`);
  console.log('loadout_scenarios=none,anchor(one-shot passive); pair_scenario=none; actions=move-only.');
  console.log('safety failures are also counted as hardlocks.');
  console.log(`elapsed=${(experiment.elapsedMs / 1000).toFixed(2)}s resultHash=${resultHash}`);
  console.log('\n## Loadouts');
  console.log('turn deltas are paired loadout minus the same static wall-prefix and paired pure24, respectively.');
  console.log('loadout scenario policy kinds cost static_prefix n completion mean p95 same_prefix_mean same_prefix_p95 pure24_mean pure24_p95 hardlock softlock safety_failure placement_failure anchor_use');
  for (const row of output.loadouts) {
    console.log([
      row.id, row.scenario, row.policy, row.kinds.join(','), row.cost, TOTAL_BUDGET - row.cost, row.n,
      `${format(row.completion)}%`, format(row.mean), format(row.p95, 0),
      format(row.prefixDeltaMean), format(row.prefixDeltaP95, 0), format(row.pureDeltaMean), format(row.pureDeltaP95, 0),
      `${format(row.hardlock)}%`, `${format(row.softlock)}%`, `${format(row.safetyFailure)}%`, `${format(row.placementFailure)}%`,
      `${format(row.anchorUse)}%`,
    ].join(' '));
  }
  console.log('\n## Adaptive minus believer policy gap');
  console.log('turn gap uses only trials completed by both policies; percentage-point gaps use all paired trials.');
  console.log('loadout scenario paired_n mean p95 completion_pp hardlock_pp softlock_pp');
  for (const gap of output.policyGaps) {
    console.log([
      gap.id, gap.scenario, gap.pairedN, format(gap.adaptiveMinusBelieverMean), format(gap.adaptiveMinusBelieverP95, 0),
      format(gap.adaptiveMinusBelieverCompletion), format(gap.adaptiveMinusBelieverHardlock),
      format(gap.adaptiveMinusBelieverSoftlock),
    ].join(' '));
  }
  console.log('\n## Anchor minus no-skill sensitivity');
  console.log('turn gap uses only trials completed in both scenarios; percentage-point gaps use all paired trials.');
  console.log('loadout policy paired_n mean p95 completion_pp hardlock_pp softlock_pp anchor_use');
  for (const row of output.anchorSensitivity) {
    console.log([
      row.id, row.policy, row.pairedN, format(row.anchorMinusNoneMean), format(row.anchorMinusNoneP95, 0),
      format(row.anchorMinusNoneCompletion), format(row.anchorMinusNoneHardlock),
      format(row.anchorMinusNoneSoftlock), `${format(row.anchorUse)}%`,
    ].join(' '));
  }
  console.log('\n## Highest-risk pair synergy');
  console.log('synergy is together-left-only-right-only+no-item on the same prefix, when all four complete.');
  console.log('risk_score=synergy_mean+2*hardlock_pct+softlock_pct+10*safety_failure_pct.');
  console.log('pair policy cost static_prefix n completion synergy_n synergy_mean synergy_p95 hardlock softlock safety_failure risk_score');
  for (const row of output.pairs.slice(0, 15)) {
    console.log([
      row.id, row.policy, row.cost, TOTAL_BUDGET - row.cost, row.n, `${format(row.completion)}%`, row.synergyN,
      format(row.synergyMean), format(row.synergyP95, 0),
      `${format(row.hardlock)}%`, `${format(row.softlock)}%`, `${format(row.safetyFailure)}%`, format(row.riskScore),
    ].join(' '));
  }
  console.log('\n## Pair coverage');
  console.log(`pairs=${new Set(output.pairs.map((row) => row.id)).size} policy_rows=${output.pairs.length} min_n=${Math.min(...output.pairs.map((row) => row.n))} max_n=${Math.max(...output.pairs.map((row) => row.n))}`);
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.costSensitivity) {
    const experiment = runCostSensitivity(options);
    printCostSensitivity(options, experiment);
    return;
  }
  if (options.finalCostSensitivity) {
    const experiment = runFinalCostSensitivity(options);
    printFinalCostSensitivity(options, experiment);
    return;
  }
  const experiment = runExperiment(options);
  printResults(options, experiment);
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
