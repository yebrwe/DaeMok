/**
 * 아이템 밸런스 몬테카를로 시뮬레이션
 *
 * 앱 규칙 그대로:
 *  - 6x6, 자유 이동, 턴 = 이동 + 벽 충돌 (보드 밖 이동은 턴 미소모라 시뮬 러너는 시도 안 함)
 *  - 러너는 벽/아이템을 모름. "아는 정보"로 BFS 최단 경로를 계획하고 걷다가
 *    부딪히면(+1턴) 그 벽을 기억하고 재계획 (합리적 무정보 러너)
 *  - 지뢰: 밟으면(+1턴) 위치 히스토리 기준 2턴 전 위치로 (1회성)
 *  - 웜홀: 입구 밟으면(+1턴) 출구로 순간이동 (1회성)
 *  - 1회성 벽: 한 번 막고(+1턴) 소멸. 러너는 일반 벽으로 기억해 영구히 우회
 *    (믿는 그래프가 막히면 그 벽을 다시 시도해 통과 - 인간의 재시도 모델)
 *  - 탐지기: 내 주변 3x3 칸의 벽(위장벽 포함)을 공개. 첫 충돌 직후 사용 전략.
 *
 * 실행: node scripts/sim-items.cjs [trials]
 */
const SIZE = 6;
const TRIALS = Number(process.argv[2]) || 4000;

const DIRS = [
  { dr: -1, dc: 0 }, { dr: 1, dc: 0 }, { dr: 0, dc: -1 }, { dr: 0, dc: 1 },
];

const cellId = (r, c) => r * SIZE + c;
const inBoard = (r, c) => r >= 0 && r < SIZE && c >= 0 && c < SIZE;
// 벽 세그먼트 키: 두 인접 셀 사이 (작은 id 우선)
const segKey = (a, b) => (a < b ? `${a}:${b}` : `${b}:${a}`);

function neighbors(id) {
  const r = Math.floor(id / SIZE), c = id % SIZE;
  const out = [];
  for (const { dr, dc } of DIRS) {
    const nr = r + dr, nc = c + dc;
    if (inBoard(nr, nc)) out.push(cellId(nr, nc));
  }
  return out;
}

// walls: Set<segKey> 기준 BFS 최단 경로 (from -> to), 경로 배열 반환 (없으면 null)
function bfsPath(from, to, walls) {
  if (from === to) return [from];
  const prev = new Array(SIZE * SIZE).fill(-1);
  prev[from] = from;
  const queue = [from];
  while (queue.length) {
    const cur = queue.shift();
    for (const nb of neighbors(cur)) {
      if (prev[nb] !== -1) continue;
      if (walls.has(segKey(cur, nb))) continue;
      prev[nb] = cur;
      if (nb === to) {
        const path = [to];
        let p = to;
        while (p !== from) { p = prev[p]; path.push(p); }
        return path.reverse();
      }
      queue.push(nb);
    }
  }
  return null;
}

function bfsDistances(from, walls) {
  const dist = new Array(SIZE * SIZE).fill(Infinity);
  dist[from] = 0;
  const queue = [from];
  while (queue.length) {
    const cur = queue.shift();
    for (const nb of neighbors(cur)) {
      if (walls.has(segKey(cur, nb))) continue;
      if (dist[nb] !== Infinity) continue;
      dist[nb] = dist[cur] + 1;
      queue.push(nb);
    }
  }
  return dist;
}

const randInt = (n) => Math.floor(Math.random() * n);
const pick = (arr) => arr[randInt(arr.length)];

// 모든 내부 세그먼트 목록
const ALL_SEGS = (() => {
  const segs = [];
  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      const id = cellId(r, c);
      if (r + 1 < SIZE) segs.push([id, cellId(r + 1, c)]);
      if (c + 1 < SIZE) segs.push([id, cellId(r, c + 1)]);
    }
  }
  return segs;
})();

// 적대적 맵 생성: 현재 최단 경로 위 세그먼트를 우선으로 벽 배치 (유효성 유지)
function generateMap(wallCount) {
  // 시작/도착: 맨해튼 거리 5 이상 (실전형 맵)
  let start, end;
  do {
    start = randInt(SIZE * SIZE);
    end = randInt(SIZE * SIZE);
  } while (
    Math.abs(Math.floor(start / SIZE) - Math.floor(end / SIZE)) +
      Math.abs((start % SIZE) - (end % SIZE)) < 5
  );

  const walls = new Set();
  let placed = 0;
  let guard = 0;
  while (placed < wallCount && guard < 4000) {
    guard++;
    const path = bfsPath(start, end, walls);
    // 70%: 경로 위 세그먼트 차단 시도(미로 길게), 30%: 무작위 (가지치기 차단)
    let a, b;
    if (path && path.length >= 2 && Math.random() < 0.7) {
      const i = randInt(path.length - 1);
      a = path[i]; b = path[i + 1];
    } else {
      const seg = pick(ALL_SEGS);
      a = seg[0]; b = seg[1];
    }
    const key = segKey(a, b);
    if (walls.has(key)) continue;
    walls.add(key);
    if (!bfsPath(start, end, walls)) walls.delete(key); // 유효성 유지
    else placed++;
  }
  return { start, end, walls };
}

/**
 * 러너 시뮬레이션.
 * items: { mines:Set<cell>, wormholes:Map<entranceCell, exitCell>, fakeWalls:Set<segKey>, radarUses:number }
 * 반환: 소모 턴 수
 */
function runGame(map, items = {}) {
  const mines = new Set(items.mines || []);
  const wormholes = new Map(items.wormholes || []);
  const fakeWalls = new Set(items.fakeWalls || []);
  let radarLeft = items.radarUses || 0;

  const { start, end, walls } = map;
  const believed = new Set(); // 러너가 알게 된 벽 (위장벽 포함 - 진짜라고 믿음)
  const history = [start]; // 성공 이동마다 기록 (지뢰 넉백용)
  let pos = start;
  let turns = 0;
  let bumped = false;
  const consumedFake = new Set();

  const useRadar = () => {
    // 내 주변 3x3 칸의 모든 벽 세그먼트 공개 (위장벽은 일반 벽으로 인식)
    const r0 = Math.floor(pos / SIZE), c0 = pos % SIZE;
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        const r = r0 + dr, c = c0 + dc;
        if (!inBoard(r, c)) continue;
        const id = cellId(r, c);
        for (const nb of neighbors(id)) {
          const key = segKey(id, nb);
          if (walls.has(key) || (fakeWalls.has(key) && !consumedFake.has(key))) {
            believed.add(key);
          }
        }
      }
    }
    radarLeft--;
  };

  let safety = 0;
  while (pos !== end && safety++ < 800) {
    let path = bfsPath(pos, end, believed);
    if (!path) {
      // 믿는 그래프가 막힘 -> 위장벽 의심 지점 재시도 (인간의 재시도 모델)
      let removed = false;
      for (const key of believed) {
        if (fakeWalls.has(key) && consumedFake.has(key)) {
          believed.delete(key);
          removed = true;
        }
      }
      if (!removed) return turns + 100; // 이론상 도달 불가 (일어나면 큰 패널티로 기록)
      continue;
    }
    const next = path[1];
    const key = segKey(pos, next);

    // 진짜 벽 충돌
    if (walls.has(key)) {
      turns++;
      believed.add(key);
      if (radarLeft > 0) { useRadar(); }
      bumped = true;
      continue;
    }
    // 위장 1회성 벽: 한 번 막고 소멸, 러너는 일반 벽으로 기억
    if (fakeWalls.has(key) && !consumedFake.has(key)) {
      turns++;
      believed.add(key);
      consumedFake.add(key);
      if (radarLeft > 0) { useRadar(); }
      bumped = true;
      continue;
    }

    // 이동 성공
    turns++;
    // 지뢰
    if (mines.has(next)) {
      mines.delete(next);
      const back = history.length >= 2 ? history[history.length - 2] : history[0];
      pos = back;
      history.push(back);
      continue;
    }
    // 웜홀
    if (wormholes.has(next)) {
      const exit = wormholes.get(next);
      wormholes.delete(next);
      pos = exit;
      history.push(exit);
      continue;
    }
    pos = next;
    history.push(next);
  }
  return turns;
}

// ===== 아이템 배치 휴리스틱 (적대적 방장) =====
function placeMine(map) {
  const path = bfsPath(map.start, map.end, map.walls);
  const candidates = path.slice(1, -1);
  if (!candidates.length) return null;
  return candidates[Math.floor(candidates.length / 2)]; // 경로 중간
}

function placeWormhole(map) {
  const path = bfsPath(map.start, map.end, map.walls);
  const candidates = path.slice(1, -1);
  if (!candidates.length) return null;
  const entrance = candidates[Math.floor(candidates.length / 2)];
  // 출구: 도착점에서 가장 먼 칸 (진짜 벽 기준 BFS)
  const distFromEnd = bfsDistances(map.end, map.walls);
  let exit = map.start, best = -1;
  for (let id = 0; id < SIZE * SIZE; id++) {
    if (id === entrance || id === map.end || id === map.start) continue;
    if (distFromEnd[id] !== Infinity && distFromEnd[id] > best) {
      best = distFromEnd[id];
      exit = id;
    }
  }
  return [entrance, exit];
}

function placeFakeWall(map) {
  // 최단 경로 위 세그먼트 중 하나 (막아도 유효성은 무관 - 어차피 통과 가능)
  const path = bfsPath(map.start, map.end, map.walls);
  if (!path || path.length < 2) return null;
  const i = Math.floor((path.length - 1) / 2);
  return segKey(path[i], path[i + 1]);
}

// ===== 실험 =====
function avg(arr) { return arr.reduce((a, b) => a + b, 0) / arr.length; }

function experiment() {
  console.log(`# 대목 아이템 밸런스 시뮬레이션 (${TRIALS}판/조건, 6x6, 적대적 맵)\n`);

  // 1) 벽 개수별 기대 턴 (벽 1개의 한계 가치)
  const wallCounts = [8, 10, 12, 13, 15, 17, 20];
  const baseline = {};
  for (const w of wallCounts) {
    const turns = [];
    for (let t = 0; t < TRIALS; t++) {
      const map = generateMap(w);
      turns.push(runGame(map));
    }
    baseline[w] = avg(turns);
  }
  console.log('## 1. 벽 개수별 기대 턴 (아이템 없음)');
  for (const w of wallCounts) console.log(`  벽 ${w}개: ${baseline[w].toFixed(2)}턴`);
  const marginal15 = (baseline[20] - baseline[15]) / 5;
  const marginal13 = (baseline[15] - baseline[13]) / 2;
  console.log(`  -> 벽 1개의 한계 피해 (13->15 구간): ${marginal13.toFixed(2)}턴`);
  console.log(`  -> 벽 1개의 한계 피해 (15->20 구간): ${marginal15.toFixed(2)}턴\n`);

  // 2) 함정 아이템: 같은 예산 20을 "벽만" vs "벽 (20-c) + 아이템"으로 비교
  const configs = [
    { name: '1회성 벽', cost: 5, apply: (map) => ({ fakeWalls: new Set([placeFakeWall(map)].filter(Boolean)) }) },
    { name: '지뢰', cost: 3, apply: (map) => { const m = placeMine(map); return m == null ? {} : { mines: new Set([m]) }; } },
    { name: '웜홀', cost: 7, apply: (map) => { const wh = placeWormhole(map); return wh ? { wormholes: new Map([wh]) } : {}; } },
  ];

  console.log('## 2. 함정 아이템 (예산 20 고정: 벽 20개 vs 벽 (20-비용)개 + 아이템)');
  const pure20 = baseline[20];
  for (const cfg of configs) {
    const turns = [];
    for (let t = 0; t < TRIALS; t++) {
      const map = generateMap(20 - cfg.cost);
      turns.push(runGame(map, cfg.apply(map)));
    }
    const combo = avg(turns);
    const diff = combo - pure20;
    // 아이템 자체 피해량 (같은 벽 수에서 아이템 추가 효과)
    const noItem = baseline[20 - cfg.cost];
    const rawDamage = combo - noItem;
    console.log(
      `  ${cfg.name} (비용 ${cfg.cost}): 순수 피해 +${rawDamage.toFixed(2)}턴, ` +
      `예산 대비 ${diff >= 0 ? '+' : ''}${diff.toFixed(2)}턴 (벽 20개 대비) ` +
      `-> ${diff > 0.3 ? '벽보다 이득 (비용 인상 여지)' : diff < -0.3 ? '벽보다 손해 (비용 인하 여지)' : '균형'}`
    );
  }

  // 3) 탐지기: 내 완주 턴 절약량 vs 그 비용으로 상대를 방해했을 피해
  console.log('\n## 3. 탐지기 (비용 5): 상대 맵(벽 15개 가정)에서 내 턴 절약');
  for (const radarUses of [1, 2]) {
    const withR = [], withoutR = [];
    for (let t = 0; t < TRIALS; t++) {
      const map = generateMap(15);
      withoutR.push(runGame(map));
      withR.push(runGame(map, { radarUses }));
    }
    const saving = avg(withoutR) - avg(withR);
    console.log(`  탐지기 x${radarUses}: 평균 ${saving.toFixed(2)}턴 절약`);
  }
  const wallDamage5 = baseline[20] - baseline[15];
  console.log(`  (참고) 그 5 예산을 벽 5개로 쓰면 상대에게 +${wallDamage5.toFixed(2)}턴 피해`);
  console.log('  -> 절약량이 벽 5개 피해량보다 크면 탐지기가 이득\n');
}

experiment();
