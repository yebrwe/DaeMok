/**
 * Fixed-seed paired Monte Carlo simulation for DaeMok special walls.
 *
 * Usage:
 *   node scripts/sim-special-walls.cjs
 *   node scripts/sim-special-walls.cjs --trials 10000 --seed smoke
 *
 * The primary table evaluates every wall on every paired map. Cost sensitivity
 * is stratified round-robin across costs 1..5, so 100,000 primary trials give
 * 20,000 maps (60,000 policy runs) per sensitivity cost. The strategic mirror
 * upper bound uses at most 5,000 of those maps, stratified to 1,000 per cost,
 * and tests every empty segment without multiplying the full 100,000-run cost.
 */

'use strict';

const { createHash } = require('node:crypto');

const SIZE = 6;
const CELLS = SIZE * SIZE;
const TOTAL_BUDGET = 24;
const DEFAULT_TRIALS = 100_000;
const DEFAULT_SEED = 'daemok-special-walls-v1';
const MAX_MOVES = 500;
const STRATEGIC_MIRROR_TRIAL_LIMIT = 5_000;
const POLICIES = ['believer', 'adaptive', 'skeptic'];
const PERSISTENT_EFFECTS = new Set();
const FORCED_EFFECTS = new Set(['wind', 'thorn', 'mirror']);

const SPECIALS = [
  { kind: 'fire', initialCost: 1 },
  { kind: 'poison', initialCost: 2 },
  { kind: 'ice', initialCost: 1 },
  { kind: 'wind', initialCost: 1 },
  { kind: 'collapse', initialCost: 1 },
  { kind: 'mirror', initialCost: 5 },
  { kind: 'thorn', initialCost: 1 },
];

function parseArgs(argv) {
  let trials = DEFAULT_TRIALS;
  let seed = DEFAULT_SEED;
  const positional = [];

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--help' || argument === '-h') {
      console.log('Usage: node scripts/sim-special-walls.cjs [trials] [seed] [--trials N] [--seed VALUE]');
      process.exit(0);
    }
    if (argument === '--trials') {
      trials = argv[++index];
    } else if (argument.startsWith('--trials=')) {
      trials = argument.slice('--trials='.length);
    } else if (argument === '--seed') {
      seed = argv[++index];
    } else if (argument.startsWith('--seed=')) {
      seed = argument.slice('--seed='.length);
    } else if (argument.startsWith('-')) {
      throw new Error(`Unknown option: ${argument}`);
    } else {
      positional.push(argument);
    }
  }

  if (positional[0] != null) trials = positional[0];
  if (positional[1] != null) seed = positional[1];
  if (positional.length > 2) throw new Error('Too many positional arguments.');
  trials = Number(trials);
  if (!Number.isSafeInteger(trials) || trials <= 0) throw new Error('trials must be a positive integer.');
  return { trials, seed: String(seed || DEFAULT_SEED) };
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

function trialRng(seedHash, trial) {
  return mulberry32(mix32(seedHash ^ Math.imul(trial + 1, 0x9e3779b1)));
}

const rowOf = (cell) => Math.floor(cell / SIZE);
const colOf = (cell) => cell % SIZE;
const cellId = (row, col) => row * SIZE + col;
const manhattan = (a, b) => Math.abs(rowOf(a) - rowOf(b)) + Math.abs(colOf(a) - colOf(b));

const EDGE_INDEX = Array.from({ length: CELLS }, () => {
  const values = new Int16Array(CELLS);
  values.fill(-1);
  return values;
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
    NEIGHBORS[cell].push({ target, edge: EDGE_INDEX[cell][target], direction });
  }
}

const BFS_QUEUE = new Int16Array(CELLS * 3);
const BFS_PREVIOUS = new Int16Array(CELLS * 3);

function neighborInDirection(cell, direction) {
  const entry = NEIGHBORS[cell].find((neighbor) => neighbor.direction === direction);
  return entry ? entry.target : -1;
}

function directionBetween(from, to) {
  const entry = NEIGHBORS[from].find((neighbor) => neighbor.target === to);
  return entry ? entry.direction : -1;
}

function isBlocked(walls, edge, extraBlockedEdge = -1) {
  return !!walls[edge] || edge === extraBlockedEdge;
}

function bfsPath(from, to, walls, extraBlockedEdge = -1) {
  if (from === to) return [from];
  BFS_PREVIOUS.fill(-1, 0, CELLS);
  BFS_PREVIOUS[from] = from;
  let head = 0;
  let tail = 0;
  BFS_QUEUE[tail++] = from;
  while (head < tail) {
    const current = BFS_QUEUE[head++];
    for (const neighbor of NEIGHBORS[current]) {
      if (BFS_PREVIOUS[neighbor.target] !== -1 || isBlocked(walls, neighbor.edge, extraBlockedEdge)) continue;
      BFS_PREVIOUS[neighbor.target] = current;
      if (neighbor.target === to) {
        const path = [to];
        let cursor = to;
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

function bfsDistances(from, walls, extraBlockedEdge = -1) {
  const distances = new Int16Array(CELLS);
  distances.fill(-1);
  distances[from] = 0;
  let head = 0;
  let tail = 0;
  BFS_QUEUE[tail++] = from;
  while (head < tail) {
    const current = BFS_QUEUE[head++];
    for (const neighbor of NEIGHBORS[current]) {
      if (distances[neighbor.target] !== -1 || isBlocked(walls, neighbor.edge, extraBlockedEdge)) continue;
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
    if (wallOrder.length === TOTAL_BUDGET) return { start, goal, wallOrder, aggressiveness };
  }
  throw new Error(`Unable to generate ${aggressiveness} ${TOTAL_BUDGET}-wall blueprint.`);
}

function mapFromBlueprint(blueprint, wallCount) {
  const walls = new Uint8Array(EDGE_COUNT);
  for (let index = 0; index < wallCount; index += 1) walls[blueprint.wallOrder[index]] = 1;
  return { start: blueprint.start, goal: blueprint.goal, walls, wallCount };
}

function effectiveExtraBlock(special, runtime) {
  if (!special) return -1;
  if (special.kind === 'steel') return special.edge;
  if (special.kind === 'collapse' && runtime?.collapseClosed) return special.edge;
  return -1;
}

function safeDestination(map, destination, special, runtime) {
  if (destination < 0 || destination >= CELLS) return false;
  return !!bfsPath(destination, map.goal, map.walls, effectiveExtraBlock(special, runtime));
}

function effectDestination(kind, map, special, from, target, runtime) {
  if (kind === 'ice') return from;
  if (kind === 'wind' || kind === 'thorn') {
    const attemptedDirection = directionBetween(from, target);
    const reboundDirection = kind === 'wind'
      ? special.effectDirection
      : attemptedDirection ^ 1;
    const rebound = neighborInDirection(from, reboundDirection);
    if (rebound >= 0 && rebound !== map.goal) {
      const edge = EDGE_INDEX[from][rebound];
      if (!isBlocked(map.walls, edge, effectiveExtraBlock(special, runtime)) && safeDestination(map, rebound, special, runtime)) {
        return rebound;
      }
    }
    return from;
  }
  if (kind === 'mirror') {
    const mirrored = cellId(SIZE - 1 - rowOf(target), SIZE - 1 - colOf(target));
    return safeDestination(map, mirrored, special, runtime) ? mirrored : target;
  }
  return target;
}

function persistentGraphAudit(map, special) {
  const reachable = new Uint8Array(CELLS);
  const reverse = Array.from({ length: CELLS }, () => []);
  const queue = [map.start];
  reachable[map.start] = 1;
  for (let head = 0; head < queue.length; head += 1) {
    const from = queue[head];
    for (const neighbor of NEIGHBORS[from]) {
      let destination = from;
      if (!map.walls[neighbor.edge]) {
        destination = neighbor.edge === special.edge && neighbor.target !== map.goal
          ? effectDestination(special.kind, map, special, from, neighbor.target, {})
          : neighbor.target;
      }
      reverse[destination].push(from);
      if (!reachable[destination]) {
        reachable[destination] = 1;
        queue.push(destination);
      }
    }
  }
  const canReachGoal = new Uint8Array(CELLS);
  const reverseQueue = [map.goal];
  canReachGoal[map.goal] = 1;
  for (let head = 0; head < reverseQueue.length; head += 1) {
    for (const previous of reverse[reverseQueue[head]]) {
      if (!canReachGoal[previous]) {
        canReachGoal[previous] = 1;
        reverseQueue.push(previous);
      }
    }
  }
  let unsafeStates = 0;
  for (let cell = 0; cell < CELLS; cell += 1) {
    if (reachable[cell] && !canReachGoal[cell]) unsafeStates += 1;
  }
  return { ok: unsafeStates === 0, reachableStates: queue.length, unsafeStates };
}

function collapseGraphAudit(map, special) {
  // mode 0: active/open, 1: closed, 2: consumed without closing.
  const stateCount = CELLS * 3;
  const reachable = new Uint8Array(stateCount);
  const reverse = Array.from({ length: stateCount }, () => []);
  const initial = map.start * 3;
  const queue = [initial];
  reachable[initial] = 1;
  for (let head = 0; head < queue.length; head += 1) {
    const state = queue[head];
    const cell = Math.floor(state / 3);
    const mode = state % 3;
    for (const neighbor of NEIGHBORS[cell]) {
      let destination = cell;
      let nextMode = mode;
      const blocked = map.walls[neighbor.edge] || (mode === 1 && neighbor.edge === special.edge);
      if (!blocked) {
        destination = neighbor.target;
        if (mode === 0 && neighbor.edge === special.edge) {
          nextMode = bfsPath(destination, map.goal, map.walls, special.edge) ? 1 : 2;
        }
      }
      const nextState = destination * 3 + nextMode;
      reverse[nextState].push(state);
      if (!reachable[nextState]) {
        reachable[nextState] = 1;
        queue.push(nextState);
      }
    }
  }
  const canReachGoal = new Uint8Array(stateCount);
  const reverseQueue = [];
  for (let mode = 0; mode < 3; mode += 1) {
    const state = map.goal * 3 + mode;
    canReachGoal[state] = 1;
    reverseQueue.push(state);
  }
  for (let head = 0; head < reverseQueue.length; head += 1) {
    for (const previous of reverse[reverseQueue[head]]) {
      if (!canReachGoal[previous]) {
        canReachGoal[previous] = 1;
        reverseQueue.push(previous);
      }
    }
  }
  let unsafeStates = 0;
  for (let state = 0; state < stateCount; state += 1) {
    if (reachable[state] && !canReachGoal[state]) unsafeStates += 1;
  }
  return { ok: unsafeStates === 0, reachableStates: queue.length, unsafeStates };
}

function phaseGraphAudit(map, special) {
  // Per-item interaction toggle: 0 closed, 1 open.
  const stateCount = CELLS * 2;
  const reachable = new Uint8Array(stateCount);
  const reverse = Array.from({ length: stateCount }, () => []);
  const queue = [map.start * 2];
  reachable[map.start * 2] = 1;
  for (let head = 0; head < queue.length; head += 1) {
    const state = queue[head];
    const cell = Math.floor(state / 2);
    const open = state % 2;
    for (const neighbor of NEIGHBORS[cell]) {
      let destination = cell;
      let nextOpen = open;
      if (!map.walls[neighbor.edge]) {
        if (neighbor.edge === special.edge) {
          if (open) {
            destination = neighbor.target;
            nextOpen = 0;
          } else {
            nextOpen = 1;
          }
        } else {
          destination = neighbor.target;
        }
      }
      const nextState = destination * 2 + nextOpen;
      reverse[nextState].push(state);
      if (!reachable[nextState]) {
        reachable[nextState] = 1;
        queue.push(nextState);
      }
    }
  }
  const canReachGoal = new Uint8Array(stateCount);
  const reverseQueue = [map.goal * 2, map.goal * 2 + 1];
  canReachGoal[map.goal * 2] = 1;
  canReachGoal[map.goal * 2 + 1] = 1;
  for (let head = 0; head < reverseQueue.length; head += 1) {
    for (const previous of reverse[reverseQueue[head]]) {
      if (!canReachGoal[previous]) {
        canReachGoal[previous] = 1;
        reverseQueue.push(previous);
      }
    }
  }
  let unsafeStates = 0;
  for (let state = 0; state < stateCount; state += 1) {
    if (reachable[state] && !canReachGoal[state]) unsafeStates += 1;
  }
  return { ok: unsafeStates === 0, reachableStates: queue.length, unsafeStates };
}

function oneUseForcedGraphAudit(map, special) {
  // mode 1 means the one-use wall is armed; mode 0 is consumed.
  const stateCount = CELLS * 2;
  const reachable = new Uint8Array(stateCount);
  const reverse = Array.from({ length: stateCount }, () => []);
  const initial = map.start * 2 + 1;
  const queue = [initial];
  reachable[initial] = 1;

  for (let head = 0; head < queue.length; head += 1) {
    const state = queue[head];
    const cell = Math.floor(state / 2);
    const active = state % 2;
    for (const neighbor of NEIGHBORS[cell]) {
      let destination = cell;
      let nextActive = active;
      if (!map.walls[neighbor.edge]) {
        destination = neighbor.target;
        if (active && neighbor.edge === special.edge) {
          destination = effectDestination(special.kind, map, special, cell, neighbor.target, { active: true });
          nextActive = 0;
        }
      }
      const nextState = destination * 2 + nextActive;
      reverse[nextState].push(state);
      if (!reachable[nextState]) {
        reachable[nextState] = 1;
        queue.push(nextState);
      }
    }
  }

  const canReachGoal = new Uint8Array(stateCount);
  const reverseQueue = [map.goal * 2, map.goal * 2 + 1];
  canReachGoal[map.goal * 2] = 1;
  canReachGoal[map.goal * 2 + 1] = 1;
  for (let head = 0; head < reverseQueue.length; head += 1) {
    for (const previous of reverse[reverseQueue[head]]) {
      if (!canReachGoal[previous]) {
        canReachGoal[previous] = 1;
        reverseQueue.push(previous);
      }
    }
  }

  let unsafeStates = 0;
  for (let state = 0; state < stateCount; state += 1) {
    if (reachable[state] && !canReachGoal[state]) unsafeStates += 1;
  }
  return { ok: unsafeStates === 0, reachableStates: queue.length, unsafeStates };
}

function safetyAudit(map, special) {
  if (PERSISTENT_EFFECTS.has(special.kind)) return persistentGraphAudit(map, special);
  if (['ice', 'wind', 'thorn', 'mirror'].includes(special.kind)) {
    return oneUseForcedGraphAudit(map, special);
  }
  if (special.kind === 'collapse') return collapseGraphAudit(map, special);
  if (special.kind === 'phase') return phaseGraphAudit(map, special);
  return { ok: true, reachableStates: 0, unsafeStates: 0 };
}

function edgeStrength(map, edge) {
  const path = bfsPath(map.start, map.goal, map.walls);
  const onPath = path?.some((cell, index) => index + 1 < path.length && EDGE_INDEX[cell][path[index + 1]] === edge);
  const normal = path ? path.length - 1 : -1;
  const blocked = bfsPath(map.start, map.goal, map.walls, edge);
  const detour = blocked ? blocked.length - 1 - normal : 100;
  return (onPath ? 10_000 : 0) + detour * 100;
}

function windDirections(map, edge) {
  const [a, b] = EDGES[edge];
  const fromStart = bfsDistances(map.start, map.walls);
  const origin = fromStart[a] <= fromStart[b] ? a : b;
  const fromGoal = bfsDistances(map.goal, map.walls);
  return [0, 1, 2, 3].sort((left, right) => {
    const leftCell = neighborInDirection(origin, left);
    const rightCell = neighborInDirection(origin, right);
    const leftScore = leftCell < 0 || fromGoal[leftCell] < 0 ? -1 : fromGoal[leftCell];
    const rightScore = rightCell < 0 || fromGoal[rightCell] < 0 ? -1 : fromGoal[rightCell];
    return rightScore - leftScore;
  });
}

function placeSpecial(kind, cost, blueprint, map, safetyCounters) {
  const omitted = blueprint.wallOrder.slice(TOTAL_BUDGET - cost, TOTAL_BUDGET);
  const candidates = [...omitted].sort((a, b) => edgeStrength(map, b) - edgeStrength(map, a));
  for (const edge of candidates) {
    const directions = kind === 'wind' ? windDirections(map, edge) : [-1];
    for (const effectDirection of directions) {
      const special = { kind, edge, effectDirection };
      const audit = safetyAudit(map, special);
      const counter = safetyCounters[kind];
      counter.audits += 1;
      counter.maxReachableStates = Math.max(counter.maxReachableStates, audit.reachableStates);
      if (audit.ok) return special;
      counter.auditFailures += 1;
    }
  }
  safetyCounters[kind].placementFailures += 1;
  return null;
}

function forgetWeakest(believed, hitCounts, learnedAt) {
  let candidate = -1;
  for (let edge = 0; edge < EDGE_COUNT; edge += 1) {
    if (!believed[edge]) continue;
    if (candidate < 0 || hitCounts[edge] < hitCounts[candidate] ||
      (hitCounts[edge] === hitCounts[candidate] && learnedAt[edge] < learnedAt[candidate])) {
      candidate = edge;
    }
  }
  if (candidate < 0) return false;
  believed[candidate] = 0;
  return true;
}

function knownTransition(map, special, runtime, from, neighbor) {
  let destination = neighbor.target;
  let phaseOpen = runtime.phaseOpen;
  if (!runtime.knownSpecial || neighbor.edge !== special.edge) return { destination, phaseOpen };
  if (special.kind === 'steel' || (special.kind === 'collapse' && runtime.collapseClosed)) return null;
  if (special.kind === 'phase') {
    if (phaseOpen) return { destination, phaseOpen: false };
    return { destination: from, phaseOpen: true };
  }
  if (runtime.active && (special.kind === 'ice' || FORCED_EFFECTS.has(special.kind))) {
    destination = effectDestination(special.kind, map, special, from, neighbor.target, runtime);
  }
  return { destination, phaseOpen };
}

function planFirstStep(map, special, runtime, believed) {
  const hasPhaseState = special?.kind === 'phase' && runtime.knownSpecial;
  const multiplier = hasPhaseState ? 2 : 1;
  const stateCount = CELLS * multiplier;
  const previous = new Int16Array(stateCount);
  const firstNeighbor = new Int16Array(stateCount);
  // Effect prediction performs nested path checks, so the planner cannot share
  // the module-level BFS queue with those checks.
  const planningQueue = new Int16Array(stateCount);
  previous.fill(-1);
  firstNeighbor.fill(-1);
  const initial = runtime.position * multiplier + (hasPhaseState && runtime.phaseOpen ? 1 : 0);
  previous[initial] = initial;
  let head = 0;
  let tail = 0;
  planningQueue[tail++] = initial;
  while (head < tail) {
    const state = planningQueue[head++];
    const from = Math.floor(state / multiplier);
    const statePhaseOpen = hasPhaseState ? !!(state % 2) : runtime.phaseOpen;
    const planningRuntime = { ...runtime, phaseOpen: statePhaseOpen };
    for (const neighbor of NEIGHBORS[from]) {
      if (believed[neighbor.edge]) continue;
      const transition = special
        ? knownTransition(map, special, planningRuntime, from, neighbor)
        : { destination: neighbor.target, phaseOpen: statePhaseOpen };
      if (!transition) continue;
      const nextState = transition.destination * multiplier + (hasPhaseState && transition.phaseOpen ? 1 : 0);
      if (previous[nextState] !== -1) continue;
      previous[nextState] = state;
      firstNeighbor[nextState] = state === initial ? neighbor.target : firstNeighbor[state];
      if (transition.destination === map.goal) return firstNeighbor[nextState];
      planningQueue[tail++] = nextState;
    }
  }
  return -1;
}

function revealCrystalWalls(map, believed, center) {
  const centerRow = rowOf(center);
  const centerCol = colOf(center);
  for (let dr = -1; dr <= 1; dr += 1) {
    for (let dc = -1; dc <= 1; dc += 1) {
      const row = centerRow + dr;
      const col = centerCol + dc;
      if (row < 0 || row >= SIZE || col < 0 || col >= SIZE) continue;
      const cell = cellId(row, col);
      for (const neighbor of NEIGHBORS[cell]) {
        if (map.walls[neighbor.edge]) believed[neighbor.edge] = 1;
      }
    }
  }
}

function runGame(map, policy, special = null) {
  const believed = new Uint8Array(EDGE_COUNT);
  const hitCounts = new Uint16Array(EDGE_COUNT);
  const learnedAt = new Uint16Array(EDGE_COUNT);
  const history = [map.start];
  const runtime = {
    position: map.start,
    active: !!special,
    knownSpecial: false,
    phaseOpen: false,
    collapseClosed: false,
    fireActions: 0,
    fireCleanupPending: false,
    poisonActions: 0,
    poisonSeed: 0,
  };
  let moves = 0;
  let activated = false;
  let pendingRetry = null;
  let safetyFailure = false;
  let guard = 0;

  const record = (position, cost) => {
    moves += cost;
    for (let index = 0; index < cost; index += 1) history.push(position);
  };

  const learnCollision = (edge, from, target, resolvedPosition) => {
    const wasRetry = pendingRetry?.edge === edge && pendingRetry.from === from;
    if (policy === 'skeptic' && !wasRetry && resolvedPosition === from) {
      pendingRetry = { edge, from, target };
      return;
    }
    hitCounts[edge] += 1;
    learnedAt[edge] = moves;
    believed[edge] = 1;
    pendingRetry = null;
  };

  const forgetWallKnowledge = () => {
    believed.fill(0);
    hitCounts.fill(0);
    learnedAt.fill(0);
    pendingRetry = null;
  };

  while (runtime.position !== map.goal && moves < MAX_MOVES && guard++ < MAX_MOVES * 10) {
    if (runtime.fireActions > 0) {
      forgetWallKnowledge();
      runtime.fireActions -= 1;
    } else if (runtime.fireCleanupPending) {
      // The fourth affected action's collision remains visible until the fifth
      // action begins, when it is erased before permanent knowledge resumes.
      forgetWallKnowledge();
      runtime.fireCleanupPending = false;
    }

    let target = -1;
    if (runtime.poisonActions > 0) {
      const direction = hashString(`${runtime.poisonSeed}:direction:${moves}`) % DELTAS.length;
      target = neighborInDirection(runtime.position, direction);
      runtime.poisonActions -= 1;
      pendingRetry = null;
    } else if (pendingRetry?.from === runtime.position) target = pendingRetry.target;
    else {
      pendingRetry = null;
      target = planFirstStep(map, special, runtime, believed);
      if (target < 0) {
        if (policy === 'adaptive' && forgetWeakest(believed, hitCounts, learnedAt)) continue;
        return { moves, activated, hardlock: true, safetyFailure };
      }
    }

    if (target < 0) {
      // Poison can choose an out-of-board direction. It consumes the action
      // without teaching the runner a synthetic boundary wall.
      record(runtime.position, 1);
      pendingRetry = null;
      continue;
    }

    const origin = runtime.position;
    const edge = EDGE_INDEX[origin][target];
    const onSpecial = !!special && edge === special.edge;
    const staticBlocked = !!map.walls[edge];
    const steelBlocked = onSpecial && special.kind === 'steel';
    const collapseBlocked = onSpecial && special.kind === 'collapse' && runtime.collapseClosed;

    if (staticBlocked || steelBlocked || collapseBlocked) {
      if (steelBlocked) {
        activated = true;
        runtime.knownSpecial = true;
      }
      record(origin, 1);
      learnCollision(edge, origin, target, origin);
      continue;
    }

    if (onSpecial && special.kind === 'phase') {
      activated = true;
      runtime.knownSpecial = true;
      if (!runtime.phaseOpen) {
        runtime.phaseOpen = true;
        record(origin, 1);
        pendingRetry = null;
        continue;
      }
      runtime.phaseOpen = false;
      runtime.position = target;
      record(runtime.position, 1);
      pendingRetry = null;
      continue;
    }

    if (onSpecial && runtime.active) {
      activated = true;
      runtime.knownSpecial = true;
      if (special.kind === 'fire') {
        runtime.active = false;
        runtime.fireActions = 4;
        runtime.fireCleanupPending = true;
        forgetWallKnowledge();
        record(origin, 1);
        continue;
      }
      if (special.kind === 'poison') {
        runtime.active = false;
        runtime.position = target;
        runtime.poisonActions = 4;
        runtime.poisonSeed = hashString(`${map.start}:${map.goal}:${special.edge}:${moves}:poison`);
        record(runtime.position, 1);
        pendingRetry = null;
        continue;
      }
      if (special.kind === 'ice' || special.kind === 'wind' || special.kind === 'thorn') {
        runtime.active = false;
        runtime.position = effectDestination(special.kind, map, special, origin, target, runtime);
        if (!safeDestination(map, runtime.position, special, runtime)) safetyFailure = true;
        record(runtime.position, special.kind === 'ice' ? 2 : 1);
        pendingRetry = null;
        continue;
      }
      if (special.kind === 'crystal') {
        runtime.active = false;
        revealCrystalWalls(map, believed, origin);
        record(origin, 1);
        learnCollision(edge, origin, target, origin);
        continue;
      }
      if (special.kind === 'collapse') {
        runtime.active = false;
        runtime.position = target;
        runtime.collapseClosed = !!bfsPath(target, map.goal, map.walls, special.edge);
        if (runtime.collapseClosed) believed[special.edge] = 1;
        if (!safeDestination(map, runtime.position, special, runtime)) safetyFailure = true;
        record(runtime.position, 1);
        pendingRetry = null;
        continue;
      }
    }

    if (
      onSpecial &&
      target !== map.goal &&
      FORCED_EFFECTS.has(special.kind) &&
      runtime.active
    ) {
      activated = true;
      runtime.knownSpecial = true;
      runtime.position = effectDestination(special.kind, map, special, origin, target, runtime);
      if (special.kind === 'wind' || special.kind === 'mirror') runtime.active = false;
      if (!safeDestination(map, runtime.position, special, runtime)) safetyFailure = true;
    } else {
      runtime.position = target;
    }
    record(runtime.position, 1);
    pendingRetry = null;
  }

  return {
    moves,
    activated,
    hardlock: runtime.position !== map.goal,
    safetyFailure,
  };
}

function createAccumulator() {
  return {
    total: 0,
    placed: 0,
    activated: 0,
    hardlocks: 0,
    safetyFailures: 0,
    failures: 0,
    turns: [],
    deltas: [],
  };
}

function record(accumulator, result, baseline, placed) {
  accumulator.total += 1;
  if (!placed) {
    accumulator.failures += 1;
    return;
  }
  accumulator.placed += 1;
  if (result.activated) accumulator.activated += 1;
  if (result.hardlock) accumulator.hardlocks += 1;
  if (result.safetyFailure) accumulator.safetyFailures += 1;
  if (result.hardlock || result.safetyFailure) {
    accumulator.failures += 1;
    return;
  }
  accumulator.turns.push(result.moves);
  if (!baseline.hardlock && !baseline.safetyFailure) accumulator.deltas.push(result.moves - baseline.moves);
}

function getAccumulator(map, key) {
  if (!map.has(key)) map.set(key, createAccumulator());
  return map.get(key);
}

function createStrategicAccumulator() {
  return {
    ...createAccumulator(),
    maps: 0,
    candidateSegments: 0,
    placementFailures: 0,
  };
}

function getStrategicAccumulator(map, cost) {
  if (!map.has(cost)) map.set(cost, createStrategicAccumulator());
  return map.get(cost);
}

function strategicOutcomeScore(result) {
  if (result.safetyFailure) return MAX_MOVES * 4;
  if (result.hardlock) return MAX_MOVES * 2;
  return result.moves;
}

function selectStrategicMirrorPlacement(map) {
  let selected = null;
  let bestScore = -Infinity;
  let candidateSegments = 0;

  for (let edge = 0; edge < EDGE_COUNT; edge += 1) {
    if (map.walls[edge]) continue;
    candidateSegments += 1;
    const special = { kind: 'mirror', edge, effectDirection: -1 };
    const results = Object.fromEntries(POLICIES.map((policy) => [policy, runGame(map, policy, special)]));
    const score = POLICIES.reduce((total, policy) => total + strategicOutcomeScore(results[policy]), 0);

    // Edge order is stable, so equal scores retain a deterministic placement.
    if (score > bestScore) {
      bestScore = score;
      selected = { special, results };
    }
  }

  return { ...selected, candidateSegments };
}

function summarize(values) {
  if (values.length === 0) return { mean: NaN, p50: NaN, p90: NaN, p95: NaN };
  const sorted = [...values].sort((a, b) => a - b);
  let total = 0;
  for (const value of sorted) total += value;
  const percentile = (ratio) => sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * ratio) - 1)];
  return { mean: total / sorted.length, p50: percentile(0.5), p90: percentile(0.9), p95: percentile(0.95) };
}

const percentage = (part, total) => total ? (part / total) * 100 : NaN;
const format = (value, digits = 2) => Number.isFinite(value) ? value.toFixed(digits) : '-';
const primaryKey = (kind, policy) => `${kind}|${policy}`;
const sensitivityKey = (kind, cost) => `${kind}|${cost}`;

function runExperiment(options) {
  const seedHash = hashString(options.seed);
  const primary = new Map();
  const sensitivity = new Map();
  const strategicMirror = new Map();
  const safetyCounters = Object.fromEntries(SPECIALS.map(({ kind }) => [kind, {
    audits: 0,
    auditFailures: 0,
    placementFailures: 0,
    maxReachableStates: 0,
  }]));
  const startedAt = Date.now();

  for (let trial = 0; trial < options.trials; trial += 1) {
    const aggressiveness = trial % 2 === 0 ? 'casual' : 'adversarial';
    const rng = trialRng(seedHash, trial);
    const blueprint = generateBlueprint(rng, aggressiveness);
    const fullMap = mapFromBlueprint(blueprint, TOTAL_BUDGET);
    const baselines = Object.fromEntries(POLICIES.map((policy) => [policy, runGame(fullMap, policy)]));
    const sensitivityCost = 1 + ((trial + seedHash) % 5);
    const mapCache = new Map();
    const placementCache = new Map();
    const resultCache = new Map();

    const evaluate = (definition, cost, policy) => {
      const cacheKey = `${definition.kind}|${cost}|${policy}`;
      if (resultCache.has(cacheKey)) return resultCache.get(cacheKey);
      if (!mapCache.has(cost)) mapCache.set(cost, mapFromBlueprint(blueprint, TOTAL_BUDGET - cost));
      const map = mapCache.get(cost);
      const placementKey = `${definition.kind}|${cost}`;
      if (!placementCache.has(placementKey)) {
        placementCache.set(
          placementKey,
          placeSpecial(definition.kind, cost, blueprint, map, safetyCounters),
        );
      }
      const special = placementCache.get(placementKey);
      const result = special ? runGame(map, policy, special) : null;
      const evaluated = { result, placed: !!special };
      resultCache.set(cacheKey, evaluated);
      return evaluated;
    };

    for (const definition of SPECIALS) {
      for (const policy of POLICIES) {
        const primaryResult = evaluate(definition, definition.initialCost, policy);
        record(
          getAccumulator(primary, primaryKey(definition.kind, policy)),
          primaryResult.result || { hardlock: false, safetyFailure: false, activated: false, moves: 0 },
          baselines[policy],
          primaryResult.placed,
        );

        const sensitivityResult = evaluate(definition, sensitivityCost, policy);
        record(
          getAccumulator(sensitivity, sensitivityKey(definition.kind, sensitivityCost)),
          sensitivityResult.result || { hardlock: false, safetyFailure: false, activated: false, moves: 0 },
          baselines[policy],
          sensitivityResult.placed,
        );
      }
    }

    if (trial < STRATEGIC_MIRROR_TRIAL_LIMIT) {
      const strategicCost = 1 + ((trial + seedHash) % 5);
      const strategicMap = mapCache.get(strategicCost) || mapFromBlueprint(
        blueprint,
        TOTAL_BUDGET - strategicCost,
      );
      const strategic = selectStrategicMirrorPlacement(strategicMap);
      const accumulator = getStrategicAccumulator(strategicMirror, strategicCost);
      accumulator.maps += 1;
      accumulator.candidateSegments += strategic.candidateSegments;
      if (!strategic.special) accumulator.placementFailures += 1;

      for (const policy of POLICIES) {
        record(
          accumulator,
          strategic.results?.[policy] || { hardlock: false, safetyFailure: false, activated: false, moves: 0 },
          baselines[policy],
          !!strategic.special,
        );
      }
    }
  }

  return { primary, sensitivity, strategicMirror, safetyCounters, elapsedMs: Date.now() - startedAt };
}

function summaryRow(accumulator) {
  const turns = summarize(accumulator.turns);
  const deltas = summarize(accumulator.deltas);
  return {
    n: accumulator.total,
    activation: percentage(accumulator.activated, accumulator.placed),
    mean: turns.mean,
    p90: turns.p90,
    p95: turns.p95,
    opportunityMean: deltas.mean,
    opportunityP90: deltas.p90,
    opportunityP95: deltas.p95,
    hardlock: percentage(accumulator.hardlocks, accumulator.placed),
    safetyFailure: percentage(accumulator.safetyFailures, accumulator.placed),
    failure: percentage(accumulator.failures, accumulator.total),
  };
}

function strategicSummaryRow(accumulator) {
  return {
    maps: accumulator.maps,
    candidateSegments: accumulator.candidateSegments,
    completion: percentage(accumulator.turns.length, accumulator.total),
    placementFailure: percentage(accumulator.placementFailures, accumulator.maps),
    ...summaryRow(accumulator),
  };
}

function recommendationFor(kind, sensitivity, strategicMirror) {
  if (kind === 'mirror') {
    const cost = 5;
    const pooled = summaryRow(sensitivity.get(sensitivityKey(kind, cost)) || createAccumulator());
    const strategic = strategicSummaryRow(strategicMirror.get(cost) || createStrategicAccumulator());
    return {
      cost,
      cap: 1,
      score: strategic.opportunityMean,
      delta: pooled.opportunityMean,
      strategicDelta: strategic.opportunityMean,
      basis: 'strategic-upper-bound',
    };
  }

  let best = null;
  for (let cost = 1; cost <= 5; cost += 1) {
    const row = summaryRow(sensitivity.get(sensitivityKey(kind, cost)) || createAccumulator());
    const score = Math.abs(row.opportunityMean) + (row.hardlock || 0) * 2 + (row.safetyFailure || 0) * 10;
    if (!best || score < best.score) {
      best = { cost, cap: 1, score, delta: row.opportunityMean, basis: 'pooled-neutral' };
    }
  }
  return best;
}

function printableResults(options, experiment) {
  const primary = [];
  for (const definition of SPECIALS) {
    for (const policy of POLICIES) {
      primary.push({
        kind: definition.kind,
        cost: definition.initialCost,
        policy,
        ...summaryRow(experiment.primary.get(primaryKey(definition.kind, policy)) || createAccumulator()),
      });
    }
  }
  const sensitivity = [];
  for (const definition of SPECIALS) {
    for (let cost = 1; cost <= 5; cost += 1) {
      sensitivity.push({
        kind: definition.kind,
        cost,
        ...summaryRow(experiment.sensitivity.get(sensitivityKey(definition.kind, cost)) || createAccumulator()),
      });
    }
  }
  const strategicMirrorRows = [];
  for (let cost = 1; cost <= 5; cost += 1) {
    strategicMirrorRows.push({
      cost,
      ...strategicSummaryRow(experiment.strategicMirror.get(cost) || createStrategicAccumulator()),
    });
  }
  const recommendations = SPECIALS.map(({ kind }) => ({
    kind,
    ...recommendationFor(kind, experiment.sensitivity, experiment.strategicMirror),
  }));
  return {
    seed: options.seed,
    seedHash: hashString(options.seed),
    trials: options.trials,
    totalBudget: TOTAL_BUDGET,
    primary,
    sensitivity,
    strategicMirror: {
      trialLimit: STRATEGIC_MIRROR_TRIAL_LIMIT,
      evaluatedTrials: Math.min(options.trials, STRATEGIC_MIRROR_TRIAL_LIMIT),
      placement: 'highest policy-pooled turns across every non-static board segment',
      rows: strategicMirrorRows,
    },
    safety: experiment.safetyCounters,
    recommendations,
  };
}

function printResults(options, experiment) {
  const output = printableResults(options, experiment);
  const resultHash = createHash('sha256').update(JSON.stringify(output)).digest('hex');
  console.log('# DaeMok special-wall paired simulation');
  console.log(`seed=${JSON.stringify(options.seed)} seedHash=${output.seedHash} trials=${options.trials}`);
  console.log(`board=6x6 totalBudget=${TOTAL_BUDGET} elapsed=${(experiment.elapsedMs / 1000).toFixed(2)}s resultHash=${resultHash}`);
  console.log('turn and delta percentiles exclude failed/hardlocked runs; opportunity delta is special minus paired pure24.');
  console.log('\n## Initial costs');
  console.log('kind cost policy n activation mean p90 p95 opportunity_mean opportunity_p90 opportunity_p95 hardlock safety_failure failures');
  for (const row of output.primary) {
    console.log([
      row.kind, row.cost, row.policy, row.n,
      `${format(row.activation)}%`, format(row.mean), format(row.p90, 0), format(row.p95, 0),
      format(row.opportunityMean), format(row.opportunityP90, 0), format(row.opportunityP95, 0),
      `${format(row.hardlock)}%`, `${format(row.safetyFailure)}%`, `${format(row.failure)}%`,
    ].join(' '));
  }
  console.log('\n## Cost sensitivity (policies pooled)');
  console.log('kind cost n activation mean p90 p95 opportunity_mean opportunity_p90 opportunity_p95 hardlock safety_failure failures');
  for (const row of output.sensitivity) {
    console.log([
      row.kind, row.cost, row.n,
      `${format(row.activation)}%`, format(row.mean), format(row.p90, 0), format(row.p95, 0),
      format(row.opportunityMean), format(row.opportunityP90, 0), format(row.opportunityP95, 0),
      `${format(row.hardlock)}%`, `${format(row.safetyFailure)}%`, `${format(row.failure)}%`,
    ].join(' '));
  }
  console.log('\n## Strategic mirror placement upper bound');
  console.log(`evaluated_trials=${output.strategicMirror.evaluatedTrials} trial_limit=${output.strategicMirror.trialLimit}`);
  console.log(`placement=${output.strategicMirror.placement}`);
  console.log('cost maps candidate_segments policy_runs completion activation mean p95 opportunity_mean opportunity_p95 hardlock safety_failure placement_failure');
  for (const row of output.strategicMirror.rows) {
    console.log([
      row.cost, row.maps, row.candidateSegments, row.n,
      `${format(row.completion)}%`, `${format(row.activation)}%`, format(row.mean), format(row.p95, 0),
      format(row.opportunityMean), format(row.opportunityP95, 0), `${format(row.hardlock)}%`,
      `${format(row.safetyFailure)}%`, `${format(row.placementFailure)}%`,
    ].join(' '));
  }
  console.log('\n## Safety audit');
  console.log('kind audits audit_failures placement_failures max_reachable_states');
  for (const definition of SPECIALS) {
    const safety = output.safety[definition.kind];
    console.log(`${definition.kind} ${safety.audits} ${safety.auditFailures} ${safety.placementFailures} ${safety.maxReachableStates}`);
  }
  console.log('\n## Recommended cost/cap');
  for (const recommendation of output.recommendations) {
    const strategicDelta = recommendation.strategicDelta == null
      ? ''
      : ` strategic_delta=${format(recommendation.strategicDelta)}`;
    console.log(`${recommendation.kind} cost=${recommendation.cost} cap=${recommendation.cap} pooled_delta=${format(recommendation.delta)} basis=${recommendation.basis}${strategicDelta}`);
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
