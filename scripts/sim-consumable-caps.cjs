/**
 * Paired Monte Carlo for mine/smoke/radar caps at total budget 24.
 *
 * Comparisons:
 *   pure24
 *   walls23 + mine1, walls22 + mine2
 *   walls23 + smoke1 cost-1 candidate
 *   walls22 + smoke1, walls20 + smoke2
 *   walls22 + radar1, walls20 + radar2
 *
 * Smoke policies:
 *   memorizer   - keeps following its normal hidden-wall route
 *   disoriented - the next action chooses uniformly among in-board directions
 *
 * Usage: node scripts/sim-consumable-caps.cjs [trials=100000] [seed=20260714-caps]
 */

'use strict';

const SIZE = 6;
const TOTAL_BUDGET = 24;
const TRIALS = Math.max(100000, Number(process.argv[2]) || 100000);
const SEED_LABEL = process.argv[3] || '20260714-caps';
const DIRS = [
  { dr: -1, dc: 0 },
  { dr: 0, dc: 1 },
  { dr: 1, dc: 0 },
  { dr: 0, dc: -1 },
];

function hashString(value) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

const BASE_SEED = hashString(SEED_LABEL);

function mix32(value) {
  let result = value >>> 0;
  result ^= result >>> 16;
  result = Math.imul(result, 0x7feb352d);
  result ^= result >>> 15;
  result = Math.imul(result, 0x846ca68b);
  result ^= result >>> 16;
  return result >>> 0;
}

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

const cell = (row, col) => row * SIZE + col;
const rowOf = (id) => Math.floor(id / SIZE);
const colOf = (id) => id % SIZE;
const inBoard = (row, col) => row >= 0 && row < SIZE && col >= 0 && col < SIZE;
const manhattan = (a, b) => Math.abs(rowOf(a) - rowOf(b)) + Math.abs(colOf(a) - colOf(b));

function neighbor(id, directionIndex) {
  const direction = DIRS[directionIndex];
  const row = rowOf(id) + direction.dr;
  const col = colOf(id) + direction.dc;
  return inBoard(row, col) ? cell(row, col) : -1;
}

const EDGE_INDEX = Array.from({ length: SIZE * SIZE }, () => new Int8Array(4).fill(-1));
const EDGES = [];
for (let id = 0; id < SIZE * SIZE; id += 1) {
  for (const directionIndex of [1, 2]) {
    const target = neighbor(id, directionIndex);
    if (target < 0) continue;
    const edgeIndex = EDGES.length;
    EDGES.push([id, target]);
    EDGE_INDEX[id][directionIndex] = edgeIndex;
    EDGE_INDEX[target][(directionIndex + 2) % 4] = edgeIndex;
  }
}

function hasWall(walls, edgeIndex) {
  if (edgeIndex < 0) return true;
  return edgeIndex < 32
    ? ((walls.lo >>> edgeIndex) & 1) === 1
    : ((walls.hi >>> (edgeIndex - 32)) & 1) === 1;
}

function withWall(walls, edgeIndex) {
  return edgeIndex < 32
    ? { lo: (walls.lo | (1 << edgeIndex)) >>> 0, hi: walls.hi }
    : { lo: walls.lo, hi: (walls.hi | (1 << (edgeIndex - 32))) >>> 0 };
}

function addKnownWall(known, edgeIndex) {
  if (edgeIndex < 32) known.lo = (known.lo | (1 << edgeIndex)) >>> 0;
  else known.hi = (known.hi | (1 << (edgeIndex - 32))) >>> 0;
}

function revealRadarWalls(position, walls, known) {
  const centerRow = rowOf(position);
  const centerCol = colOf(position);
  for (let rowOffset = -1; rowOffset <= 1; rowOffset += 1) {
    for (let colOffset = -1; colOffset <= 1; colOffset += 1) {
      const row = centerRow + rowOffset;
      const col = centerCol + colOffset;
      if (!inBoard(row, col)) continue;
      const id = cell(row, col);
      for (let directionIndex = 0; directionIndex < 4; directionIndex += 1) {
        const target = neighbor(id, directionIndex);
        if (target < 0) continue;
        const edgeIndex = EDGE_INDEX[id][directionIndex];
        if (hasWall(walls, edgeIndex)) addKnownWall(known, edgeIndex);
      }
    }
  }
}

function outsideRadarArea(position, center) {
  return Math.abs(rowOf(position) - rowOf(center)) > 1 ||
    Math.abs(colOf(position) - colOf(center)) > 1;
}

function findPath(start, end, walls) {
  if (start === end) return [start];
  const previous = new Int8Array(SIZE * SIZE).fill(-1);
  previous[start] = start;
  const queue = new Int8Array(SIZE * SIZE);
  let head = 0;
  let tail = 0;
  queue[tail++] = start;

  while (head < tail) {
    const current = queue[head++];
    for (let directionIndex = 0; directionIndex < 4; directionIndex += 1) {
      const target = neighbor(current, directionIndex);
      if (target < 0 || previous[target] !== -1) continue;
      if (hasWall(walls, EDGE_INDEX[current][directionIndex])) continue;
      previous[target] = current;
      if (target === end) {
        const reversed = [end];
        let cursor = end;
        while (cursor !== start) {
          cursor = previous[cursor];
          reversed.push(cursor);
        }
        return reversed.reverse();
      }
      queue[tail++] = target;
    }
  }
  return null;
}

function distancesFrom(start, walls) {
  const distances = new Int8Array(SIZE * SIZE).fill(-1);
  distances[start] = 0;
  const queue = new Int8Array(SIZE * SIZE);
  let head = 0;
  let tail = 0;
  queue[tail++] = start;
  while (head < tail) {
    const current = queue[head++];
    for (let directionIndex = 0; directionIndex < 4; directionIndex += 1) {
      const target = neighbor(current, directionIndex);
      if (target < 0 || distances[target] !== -1) continue;
      if (hasWall(walls, EDGE_INDEX[current][directionIndex])) continue;
      distances[target] = distances[current] + 1;
      queue[tail++] = target;
    }
  }
  return distances;
}

function directionBetween(from, to) {
  for (let directionIndex = 0; directionIndex < 4; directionIndex += 1) {
    if (neighbor(from, directionIndex) === to) return directionIndex;
  }
  return -1;
}

function generateTrialMap(trialIndex) {
  const random = mulberry32(mix32(BASE_SEED ^ Math.imul(trialIndex + 1, 0x9e3779b1)));
  const randInt = (limit) => Math.floor(random() * limit);
  let start;
  let end;
  do {
    start = randInt(SIZE * SIZE);
    end = randInt(SIZE * SIZE);
  } while (start === end || manhattan(start, end) < 5);

  let walls = { lo: 0, hi: 0 };
  const snapshots = [{ ...walls }];

  for (let targetCount = 1; targetCount <= TOTAL_BUDGET; targetCount += 1) {
    let placed = false;
    for (let attempt = 0; attempt < 5000 && !placed; attempt += 1) {
      const currentPath = findPath(start, end, walls);
      let edgeIndex;
      if (currentPath && currentPath.length >= 2 && random() < 0.7) {
        const pathIndex = randInt(currentPath.length - 1);
        const directionIndex = directionBetween(currentPath[pathIndex], currentPath[pathIndex + 1]);
        edgeIndex = EDGE_INDEX[currentPath[pathIndex]][directionIndex];
      } else {
        edgeIndex = randInt(EDGES.length);
      }
      if (hasWall(walls, edgeIndex)) continue;
      const candidate = withWall(walls, edgeIndex);
      if (!findPath(start, end, candidate)) continue;
      walls = candidate;
      snapshots[targetCount] = { ...walls };
      placed = true;
    }
    if (!placed) return generateTrialMap(trialIndex + 0x100000);
  }

  return { start, end, snapshots };
}

function smokeChoice(trialIndex, activationOrdinal, validDirectionCount) {
  const seed = mix32(
    BASE_SEED ^
    Math.imul(trialIndex + 1, 0x85ebca6b) ^
    Math.imul(activationOrdinal + 1, 0xc2b2ae35),
  );
  return Math.floor(mulberry32(seed)() * validDirectionCount);
}

function runMemorizer({
  start,
  end,
  walls,
  mineCells = [],
  smokeCells = [],
  smokePolicy = 'memorizer',
  radarUses = 0,
  trialIndex = 0,
  collectTrace = false,
}) {
  const activeMines = new Set(mineCells);
  const activeSmokes = new Set(smokeCells);
  const known = { lo: 0, hi: 0 };
  const history = [start];
  const trace = [];
  const seenTraceCells = new Set();
  let position = start;
  let plan = null;
  let turns = 0;
  let mineActivations = 0;
  let smokeActivations = 0;
  let radarActivations = 0;
  let firstRadarCenter = -1;
  let smokePending = false;
  let disorientationOrdinal = 0;

  while (position !== end && turns < 500) {
    const shouldUseRadar = radarActivations < radarUses && (
      radarActivations === 0 || outsideRadarArea(position, firstRadarCenter)
    );
    if (shouldUseRadar) {
      revealRadarWalls(position, walls, known);
      if (radarActivations === 0) firstRadarCenter = position;
      radarActivations += 1;
      turns += 1;
      history.push(position);
      plan = null;
      continue;
    }

    const obscuredThisAction = smokePending;
    smokePending = false;
    let directionIndex = -1;
    let followedPlan = false;

    if (obscuredThisAction && smokePolicy === 'disoriented') {
      const validDirections = [];
      for (let candidateDirection = 0; candidateDirection < 4; candidateDirection += 1) {
        if (neighbor(position, candidateDirection) >= 0) validDirections.push(candidateDirection);
      }
      directionIndex = validDirections[
        smokeChoice(trialIndex, disorientationOrdinal++, validDirections.length)
      ];
      plan = null;
    } else {
      if (!plan || plan[0] !== position || plan.length < 2) {
        plan = findPath(position, end, known);
      }
      if (!plan || plan.length < 2) {
        return {
          turns,
          mineActivations,
          smokeActivations,
          radarActivations,
          failed: true,
          trace,
        };
      }
      directionIndex = directionBetween(position, plan[1]);
      followedPlan = true;
    }

    const attempted = neighbor(position, directionIndex);
    const edgeIndex = EDGE_INDEX[position][directionIndex];
    if (attempted < 0) throw new Error('Runner selected an out-of-board action.');

    if (hasWall(walls, edgeIndex)) {
      turns += 1;
      history.push(position);
      addKnownWall(known, edgeIndex);
      plan = null;
      continue;
    }

    const origin = position;
    const rewindPosition = history.length >= 2 ? history[history.length - 2] : history[0];
    let finalPosition = attempted;
    let triggered = false;

    if (activeMines.delete(attempted)) {
      mineActivations += 1;
      finalPosition = rewindPosition;
      triggered = true;
    } else if (activeSmokes.delete(attempted)) {
      smokeActivations += 1;
      smokePending = true;
      triggered = true;
    }

    turns += 1;
    history.push(finalPosition);
    position = finalPosition;

    if (collectTrace && attempted !== start && attempted !== end && !seenTraceCells.has(attempted)) {
      seenTraceCells.add(attempted);
      trace.push({
        cell: attempted,
        turn: turns,
        rewindPosition,
        known: { ...known },
      });
    }

    if (followedPlan && !triggered && finalPosition === attempted) {
      plan.shift();
    } else {
      plan = null;
    }

    // Keep the compiler/runtime honest about the turn-history origin used above.
    if (origin < 0) throw new Error('Invalid origin.');
  }

  return {
    turns,
    mineActivations,
    smokeActivations,
    radarActivations,
    failed: position !== end,
    trace,
  };
}

function ensureCandidates(trace, count, start, end, walls) {
  const candidates = [...trace];
  const knownCells = new Set(candidates.map((entry) => entry.cell));
  const path = findPath(start, end, walls) || [];
  for (const pathCell of path.slice(1, -1)) {
    if (knownCells.has(pathCell)) continue;
    knownCells.add(pathCell);
    candidates.push({
      cell: pathCell,
      turn: 0,
      rewindPosition: start,
      known: { lo: 0, hi: 0 },
    });
  }
  return candidates.slice(0, Math.max(count, candidates.length));
}

function selectMineCells(traceResult, count, start, end, walls) {
  const distances = distancesFrom(end, walls);
  const candidates = ensureCandidates(traceResult.trace, count, start, end, walls);
  candidates.sort((left, right) => {
    const leftScore = distances[left.rewindPosition] - distances[left.cell];
    const rightScore = distances[right.rewindPosition] - distances[right.cell];
    return rightScore - leftScore || right.turn - left.turn || left.cell - right.cell;
  });
  return candidates.slice(0, count).map((entry) => entry.cell);
}

function smokePlacementScore(entry, end, walls, distances) {
  const normalPath = findPath(entry.cell, end, entry.known);
  if (!normalPath || normalPath.length < 2) return Number.NEGATIVE_INFINITY;
  const normalDirection = directionBetween(entry.cell, normalPath[1]);
  const normalEdge = EDGE_INDEX[entry.cell][normalDirection];
  const normalFinal = hasWall(walls, normalEdge) ? entry.cell : normalPath[1];
  let totalDistance = 0;
  let choices = 0;

  for (let directionIndex = 0; directionIndex < 4; directionIndex += 1) {
    const target = neighbor(entry.cell, directionIndex);
    if (target < 0) continue;
    const edgeIndex = EDGE_INDEX[entry.cell][directionIndex];
    const finalPosition = hasWall(walls, edgeIndex) ? entry.cell : target;
    totalDistance += distances[finalPosition];
    choices += 1;
  }

  return choices > 0 ? totalDistance / choices - distances[normalFinal] : 0;
}

function selectSmokeCells(traceResult, count, start, end, walls) {
  const distances = distancesFrom(end, walls);
  const candidates = ensureCandidates(traceResult.trace, count, start, end, walls);
  candidates.sort((left, right) => {
    const scoreDifference =
      smokePlacementScore(right, end, walls, distances) -
      smokePlacementScore(left, end, walls, distances);
    return scoreDifference || right.turn - left.turn || left.cell - right.cell;
  });
  return candidates.slice(0, count).map((entry) => entry.cell);
}

function trapPlacementIsSafe(cells, count, start, end, walls) {
  if (!findPath(start, end, walls) || cells.length !== count || new Set(cells).size !== count) {
    return false;
  }
  const reachable = distancesFrom(start, walls);
  return cells.every((trapCell) =>
    trapCell !== start && trapCell !== end && reachable[trapCell] >= 0
  );
}

const CONFIGS = {
  pure24: { cap: 0 },
  mine1: { cap: 1 },
  mine2: { cap: 2 },
  smoke1_cost1_memorizer: { cap: 1 },
  smoke1_cost1_disoriented: { cap: 1 },
  smoke1_memorizer: { cap: 1 },
  smoke2_memorizer: { cap: 2 },
  smoke1_disoriented: { cap: 1 },
  smoke2_disoriented: { cap: 2 },
  radar1: { cap: 1 },
  radar2: { cap: 2 },
};

const results = Object.fromEntries(
  Object.keys(CONFIGS).map((key) => [key, {
    turns: [],
    rawDelta: [],
    opportunityDelta: [],
    activations: 0,
    anyActivation: 0,
    failures: 0,
    structuralHardlocks: 0,
  }]),
);

const RADAR_COST_CANDIDATES = [1, 2, 3, 4, 5, 6, 7, 8];
const radarCrossMap = Object.fromEntries(
  RADAR_COST_CANDIDATES.map((cost) => [cost, {
    selfDelta: [],
    defenseDelta: [],
    competitiveDelta: [],
  }]),
);

function pushResult(key, run, noTrapTurns, pureTurns, cap, structuralHardlock) {
  const target = results[key];
  const activations = run.mineActivations + run.smokeActivations + run.radarActivations;
  target.turns.push(run.turns);
  target.rawDelta.push(run.turns - noTrapTurns);
  target.opportunityDelta.push(run.turns - pureTurns);
  target.activations += activations;
  if (activations > 0) target.anyActivation += 1;
  if (run.failed) target.failures += 1;
  if (structuralHardlock) target.structuralHardlocks += 1;
  if (activations > cap) throw new Error(`Activation count exceeded cap for ${key}.`);
}

for (let trialIndex = 0; trialIndex < TRIALS; trialIndex += 1) {
  const generated = generateTrialMap(trialIndex);
  const walls24 = generated.snapshots[24];
  const walls23 = generated.snapshots[23];
  const walls22 = generated.snapshots[22];
  const walls20 = generated.snapshots[20];

  const pure = runMemorizer({
    start: generated.start,
    end: generated.end,
    walls: walls24,
    trialIndex,
  });
  const radarOnFullMap = runMemorizer({
    start: generated.start,
    end: generated.end,
    walls: walls24,
    radarUses: 1,
    trialIndex,
  });
  const radarSelfDelta = radarOnFullMap.turns - pure.turns;
  for (const cost of RADAR_COST_CANDIDATES) {
    const defenseRun = runMemorizer({
      start: generated.start,
      end: generated.end,
      walls: generated.snapshots[TOTAL_BUDGET - cost],
      trialIndex,
    });
    const defenseDelta = defenseRun.turns - pure.turns;
    radarCrossMap[cost].selfDelta.push(radarSelfDelta);
    radarCrossMap[cost].defenseDelta.push(defenseDelta);
    radarCrossMap[cost].competitiveDelta.push(radarSelfDelta - defenseDelta);
  }
  const trace23 = runMemorizer({
    start: generated.start,
    end: generated.end,
    walls: walls23,
    trialIndex,
    collectTrace: true,
  });
  const trace22 = runMemorizer({
    start: generated.start,
    end: generated.end,
    walls: walls22,
    trialIndex,
    collectTrace: true,
  });
  const trace20 = runMemorizer({
    start: generated.start,
    end: generated.end,
    walls: walls20,
    trialIndex,
    collectTrace: true,
  });

  const mine1Cells = selectMineCells(trace23, 1, generated.start, generated.end, walls23);
  const mine2Cells = selectMineCells(trace22, 2, generated.start, generated.end, walls22);
  const smoke1Cost1Cells = selectSmokeCells(trace23, 1, generated.start, generated.end, walls23);
  const smoke1Cells = selectSmokeCells(trace22, 1, generated.start, generated.end, walls22);
  const smoke2Cells = selectSmokeCells(trace20, 2, generated.start, generated.end, walls20);

  const pureHardlock = !findPath(generated.start, generated.end, walls24);
  const mine1Hardlock = !trapPlacementIsSafe(
    mine1Cells, 1, generated.start, generated.end, walls23,
  );
  const mine2Hardlock = !trapPlacementIsSafe(
    mine2Cells, 2, generated.start, generated.end, walls22,
  );
  const smoke1Cost1Hardlock = !trapPlacementIsSafe(
    smoke1Cost1Cells, 1, generated.start, generated.end, walls23,
  );
  const smoke1Hardlock = !trapPlacementIsSafe(
    smoke1Cells, 1, generated.start, generated.end, walls22,
  );
  const smoke2Hardlock = !trapPlacementIsSafe(
    smoke2Cells, 2, generated.start, generated.end, walls20,
  );
  const radar1Hardlock = !findPath(generated.start, generated.end, walls22);
  const radar2Hardlock = !findPath(generated.start, generated.end, walls20);

  pushResult('pure24', pure, pure.turns, pure.turns, 0, pureHardlock);

  const mine1 = runMemorizer({
    start: generated.start,
    end: generated.end,
    walls: walls23,
    mineCells: mine1Cells,
    trialIndex,
  });
  pushResult('mine1', mine1, trace23.turns, pure.turns, 1, mine1Hardlock);

  const mine2 = runMemorizer({
    start: generated.start,
    end: generated.end,
    walls: walls22,
    mineCells: mine2Cells,
    trialIndex,
  });
  pushResult('mine2', mine2, trace22.turns, pure.turns, 2, mine2Hardlock);

  for (const smokePolicy of ['memorizer', 'disoriented']) {
    const key = `smoke1_cost1_${smokePolicy}`;
    const run = runMemorizer({
      start: generated.start,
      end: generated.end,
      walls: walls23,
      smokeCells: smoke1Cost1Cells,
      smokePolicy,
      trialIndex,
    });
    pushResult(key, run, trace23.turns, pure.turns, 1, smoke1Cost1Hardlock);
  }

  for (const [cap, walls, traceResult, smokeCells] of [
    [1, walls22, trace22, smoke1Cells],
    [2, walls20, trace20, smoke2Cells],
  ]) {
    for (const smokePolicy of ['memorizer', 'disoriented']) {
      const key = `smoke${cap}_${smokePolicy}`;
      const run = runMemorizer({
        start: generated.start,
        end: generated.end,
        walls,
        smokeCells,
        smokePolicy,
        trialIndex,
      });
      pushResult(
        key,
        run,
        traceResult.turns,
        pure.turns,
        cap,
        cap === 1 ? smoke1Hardlock : smoke2Hardlock,
      );
    }
  }

  const radar1 = runMemorizer({
    start: generated.start,
    end: generated.end,
    walls: walls22,
    radarUses: 1,
    trialIndex,
  });
  pushResult('radar1', radar1, trace22.turns, pure.turns, 1, radar1Hardlock);

  const radar2 = runMemorizer({
    start: generated.start,
    end: generated.end,
    walls: walls20,
    radarUses: 2,
    trialIndex,
  });
  pushResult('radar2', radar2, trace20.turns, pure.turns, 2, radar2Hardlock);

  if ((trialIndex + 1) % 10000 === 0) {
    process.stderr.write(`completed ${trialIndex + 1}/${TRIALS}\n`);
  }
}

function mean(values) {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function percentile(values, probability) {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.floor((sorted.length - 1) * probability)];
}

function ci95(values) {
  const average = mean(values);
  const variance = values.reduce((sum, value) => sum + (value - average) ** 2, 0) / (values.length - 1);
  return 1.96 * Math.sqrt(variance / values.length);
}

const fixed = (value) => value.toFixed(3);

console.log('# Consumable cap analysis');
console.log(`trials=${TRIALS}, seed=${SEED_LABEL}, pairedBudget=${TOTAL_BUDGET}, board=${SIZE}x${SIZE}`);
console.log('budget=pure24; mine1/smoke1_cost1=walls23; mine2/smoke1/radar1=walls22; smoke2/radar2=walls20');
console.log('placement=strong deterministic memorizer-trace cells, distinct, start/end excluded');
console.log('history=every consumed action records its final position, including duplicate collision positions\n');
console.log('radar=first use at start; second use on first exit from the initial 3x3; each use costs one stationary turn');
console.log('config\tactivation/item\tany_activation\tmean_turns\tp95_turns\traw_mean\traw_p95\topportunity_mean+/-95ci\topportunity_p95\tfailures\thardlocks');

for (const [key, config] of Object.entries(CONFIGS)) {
  const result = results[key];
  const denominator = TRIALS * Math.max(1, config.cap);
  console.log([
    key,
    config.cap === 0 ? '-' : `${fixed((result.activations / denominator) * 100)}%`,
    config.cap === 0 ? '-' : `${fixed((result.anyActivation / TRIALS) * 100)}%`,
    fixed(mean(result.turns)),
    percentile(result.turns, 0.95),
    fixed(mean(result.rawDelta)),
    percentile(result.rawDelta, 0.95),
    `${fixed(mean(result.opportunityDelta))}+/-${fixed(ci95(result.opportunityDelta))}`,
    percentile(result.opportunityDelta, 0.95),
    result.failures,
    result.structuralHardlocks,
  ].join('\t'));
}

console.log('\ncap_increment\tmean_turn_delta+/-95ci\tpaired_p95_delta');
for (const [label, cap1Key, cap2Key] of [
  ['mine', 'mine1', 'mine2'],
  ['smoke_memorizer', 'smoke1_memorizer', 'smoke2_memorizer'],
  ['smoke_disoriented', 'smoke1_disoriented', 'smoke2_disoriented'],
  ['radar', 'radar1', 'radar2'],
]) {
  const differences = results[cap2Key].turns.map(
    (turns, index) => turns - results[cap1Key].turns[index],
  );
  console.log([
    `${label}:cap2-cap1`,
    `${fixed(mean(differences))}+/-${fixed(ci95(differences))}`,
    percentile(differences, 0.95),
  ].join('\t'));
}

console.log('\nradar_cost\tself_turn_delta\topponent_turn_delta\tcompetitive_delta+/-95ci');
for (const cost of RADAR_COST_CANDIDATES) {
  const record = radarCrossMap[cost];
  console.log([
    cost,
    fixed(mean(record.selfDelta)),
    fixed(mean(record.defenseDelta)),
    `${fixed(mean(record.competitiveDelta))}+/-${fixed(ci95(record.competitiveDelta))}`,
  ].join('\t'));
}
console.log('competitive_delta = own radar turn change - opponent turn change from sacrificed defense walls; zero is break-even.');

console.log('\nSafety invariant: walls never change, every placed trap is on the start-goal component,');
console.log('mine only returns to a previously reachable position, smoke only stays or crosses an open edge,');
console.log('and radar only adds real walls in the current 3x3 to runner knowledge.');
