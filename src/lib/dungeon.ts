// 던전 RPG 모드 - 로그라이크 (방-복도 절차 생성, 범프 전투, 등급 장비, 액트/보스/스토리)
// 대전 모드(6x6 미로)와 완전히 독립된 게임 방식

// ===== 시드 난수 (같은 시드 = 같은 던전) =====
export function mulberry32(seed: number) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export type RNG = () => number;
export const randInt = (rng: RNG, n: number) => Math.floor(rng() * n);

// ===== 좌표 =====
export interface Cell {
  x: number;
  y: number;
}
export const sameCell = (a: Cell, b: Cell) => a.x === b.x && a.y === b.y;
export const dist2 = (a: Cell, b: Cell) => (a.x - b.x) ** 2 + (a.y - b.y) ** 2;

export const MAP_W = 21;
export const MAP_H = 21;
export const TILE_WALL = 0;
export const TILE_FLOOR = 1;
export const TILE_STAIRS = 2;

// ===== 등급 =====
export type Rarity = 'common' | 'rare' | 'epic' | 'legendary';
export const RARITY_LABEL: Record<Rarity, string> = { common: '일반', rare: '희귀', epic: '영웅', legendary: '전설' };
export const RARITY_ORDER: Rarity[] = ['common', 'rare', 'epic', 'legendary'];
export const RARITY_TEXT: Record<Rarity, string> = {
  common: 'text-slate-300',
  rare: 'text-blue-300',
  epic: 'text-purple-300',
  legendary: 'text-amber-300',
};
export const RARITY_BORDER: Record<Rarity, string> = {
  common: 'border-slate-400/60',
  rare: 'border-blue-400/70',
  epic: 'border-purple-400/70',
  legendary: 'border-amber-400/80',
};

// 등급 확률: 일반 55 / 희귀 28 / 영웅 13 / 전설 4
export function rollRarity(rng: RNG, luckBonus = 0): Rarity {
  const r = rng() - luckBonus;
  if (r < 0.04) return 'legendary';
  if (r < 0.17) return 'epic';
  if (r < 0.45) return 'rare';
  return 'common';
}

// ===== 아이템 (장비 + 소모품) =====
export type EquipSlot = 'weapon' | 'armor' | 'charm';

export interface EquipItem {
  kind: 'equip';
  slot: EquipSlot;
  name: string;
  emoji: string;
  rarity: Rarity;
  atk: number;
  def: number;
  maxHp: number;
}

export type ConsumableId = 'potion' | 'bigPotion' | 'bomb' | 'scroll' | 'elixir';

export interface ConsumableItem {
  kind: 'consumable';
  id: ConsumableId;
  name: string;
  emoji: string;
  rarity: Rarity;
  desc: string;
}

export type DungeonItem = EquipItem | ConsumableItem;

const WEAPON_NAMES = ['나뭇가지 검', '돌도끼', '사냥꾼의 활', '기사의 검', '마목 지팡이'];
const ARMOR_NAMES = ['천 갑옷', '가죽 갑옷', '사슬 갑옷', '기사의 판금', '마목 껍질'];
const CHARM_NAMES = ['이끼 목걸이', '반딧불 병', '수호 반지', '요정의 눈물', '숲의 심장 조각'];
const RARITY_PREFIX: Record<Rarity, string> = { common: '', rare: '정교한 ', epic: '영웅의 ', legendary: '전설의 ' };
const RARITY_BONUS: Record<Rarity, number> = { common: 0, rare: 1, epic: 3, legendary: 5 };

export function rollEquip(rng: RNG, floor: number, forcedRarity?: Rarity): EquipItem {
  const rarity = forcedRarity ?? rollRarity(rng);
  const slot: EquipSlot = (['weapon', 'armor', 'charm'] as EquipSlot[])[randInt(rng, 3)];
  const tier = Math.min(4, Math.floor(floor / 2));
  const bonus = RARITY_BONUS[rarity];
  const base = 1 + Math.floor(floor / 3);
  if (slot === 'weapon') {
    return {
      kind: 'equip', slot, rarity,
      name: RARITY_PREFIX[rarity] + WEAPON_NAMES[tier],
      emoji: '🗡️',
      atk: base + bonus + randInt(rng, 2),
      def: 0,
      maxHp: 0,
    };
  }
  if (slot === 'armor') {
    return {
      kind: 'equip', slot, rarity,
      name: RARITY_PREFIX[rarity] + ARMOR_NAMES[tier],
      emoji: '🛡️',
      atk: 0,
      def: Math.max(1, Math.floor((base + bonus) / 2) + randInt(rng, 2)),
      maxHp: 0,
    };
  }
  return {
    kind: 'equip', slot, rarity,
    name: RARITY_PREFIX[rarity] + CHARM_NAMES[tier],
    emoji: '📿',
    atk: 0,
    def: 0,
    maxHp: (base + bonus) * 2 + randInt(rng, 3),
  };
}

export const CONSUMABLES: Record<ConsumableId, Omit<ConsumableItem, 'kind'>> = {
  potion: { id: 'potion', name: '회복 물약', emoji: '🧪', rarity: 'common', desc: 'HP를 절반 회복합니다.' },
  bigPotion: { id: 'bigPotion', name: '큰 물약', emoji: '💖', rarity: 'rare', desc: 'HP를 전부 회복합니다.' },
  bomb: { id: 'bomb', name: '폭탄', emoji: '💣', rarity: 'rare', desc: '주변 한 칸의 모든 적에게 큰 피해를 줍니다.' },
  scroll: { id: 'scroll', name: '천리안 두루마리', emoji: '📜', rarity: 'epic', desc: '이 층 전체 지형을 밝혀냅니다.' },
  elixir: { id: 'elixir', name: '숲의 정수', emoji: '✨', rarity: 'legendary', desc: '완전 회복 + 최대 HP가 5 늘어납니다.' },
};

export function rollConsumable(rng: RNG): ConsumableItem {
  const rarity = rollRarity(rng);
  const pool: ConsumableId[] =
    rarity === 'legendary' ? ['elixir'] : rarity === 'epic' ? ['scroll'] : rarity === 'rare' ? ['bigPotion', 'bomb'] : ['potion'];
  const id = pool[randInt(rng, pool.length)];
  return { kind: 'consumable', ...CONSUMABLES[id] };
}

// 상자/드롭: 장비 60% / 소모품 40%
export function rollChestItem(rng: RNG, floor: number, forcedRarity?: Rarity): DungeonItem {
  if (forcedRarity) return rollEquip(rng, floor, forcedRarity);
  return rng() < 0.6 ? rollEquip(rng, floor) : rollConsumable(rng);
}

// ===== 몬스터 =====
export interface MonsterDef {
  type: string;
  name: string;
  emoji: string;
  color: string;
  hp: number;
  atk: number;
  def: number;
  exp: number;
  boss?: boolean;
}

export interface Monster extends MonsterDef {
  id: number;
  pos: Cell;
  maxHp: number;
}

const ACT_MONSTERS: MonsterDef[][] = [
  [
    { type: 'slime', name: '숲 슬라임', emoji: '🟢', color: '#4ade80', hp: 6, atk: 2, def: 0, exp: 5 },
    { type: 'bat', name: '가시 박쥐', emoji: '🦇', color: '#a78bfa', hp: 5, atk: 3, def: 0, exp: 6 },
  ],
  [
    { type: 'skeleton', name: '동굴 해골', emoji: '💀', color: '#e2e8f0', hp: 12, atk: 5, def: 1, exp: 10 },
    { type: 'spider', name: '독거미', emoji: '🕷️', color: '#84cc16', hp: 9, atk: 5, def: 0, exp: 11 },
  ],
  [
    { type: 'wraith', name: '어둠 정령', emoji: '👻', color: '#818cf8', hp: 16, atk: 7, def: 2, exp: 18 },
    { type: 'guardian', name: '마목 수호자', emoji: '🌳', color: '#c084fc', hp: 18, atk: 8, def: 3, exp: 20 },
  ],
];

const ACT_BOSSES: MonsterDef[] = [
  { type: 'boss1', name: '숲의 골렘', emoji: '🗿', color: '#65a30d', hp: 28, atk: 4, def: 1, exp: 40, boss: true },
  { type: 'boss2', name: '박쥐 군주', emoji: '🦇', color: '#7c3aed', hp: 45, atk: 6, def: 2, exp: 70, boss: true },
  { type: 'boss3', name: '마목(魔木)', emoji: '🌲', color: '#9d174d', hp: 70, atk: 10, def: 3, exp: 0, boss: true },
];

// ===== 액트/스토리 =====
export interface ActTheme {
  name: string;
  floorA: string;
  floorB: string;
  wall: string;
  fog: string;
  sky: string;
}

export const ACTS: Array<{ title: string; story: string; theme: ActTheme }> = [
  {
    title: 'ACT 1 · 길잃은 숲',
    story:
      '어느 밤, 숲의 요정 "모크"가 검은 뿌리에 끌려 사라졌습니다.\n오래된 나무들이 속삭입니다 — "미로 아래, 마목(魔木)의 심장으로."\n당신은 나뭇가지 하나를 검 삼아 어둠 속으로 걸어 들어갑니다.',
    theme: { name: '숲', floorA: '#3f5232', floorB: '#465c38', wall: '#22301b', fog: '#0a120a', sky: 'from-emerald-950 via-slate-950 to-black' },
  },
  {
    title: 'ACT 2 · 메아리 동굴',
    story:
      '숲의 뿌리는 깊은 동굴로 이어집니다.\n발소리가 벽에 부딪혀 몇 번이고 되돌아오고,\n어둠 속에서 뼈 부딪히는 소리가 들립니다.',
    theme: { name: '동굴', floorA: '#3a4450', floorB: '#414c59', wall: '#1c232b', fog: '#05070a', sky: 'from-slate-950 via-slate-950 to-black' },
  },
  {
    title: 'ACT 3 · 마목의 심장',
    story:
      '심장이 뛰는 소리가 벽을 타고 울립니다.\n미로가 숨을 쉬고, 벽이 스스로 자라납니다.\n모크의 목소리가 아주 가까이에서 들립니다 — 마지막 시험입니다.',
    theme: { name: '마목', floorA: '#43314f', floorB: '#4b3759', wall: '#241730', fog: '#0a050f', sky: 'from-purple-950 via-slate-950 to-black' },
  },
];

export const ENDING_STORY =
  '마목이 쓰러지자 검은 뿌리가 풀리며 모크가 떨어져 내립니다.\n"길을 잃은 적은 없었어. 처음부터 너는 길을 만들고 있었으니까."\n숲이 스스로 길을 열어 두 사람을 배웅합니다.';

export const DEATH_STORY = '숲이 당신을 삼켰습니다...\n하지만 나무들은 용감한 발소리를 오래 기억합니다.';

export const FLOORS_PER_ACT = 3;
export const TOTAL_FLOORS = 9;

// ===== 플레이어 성장 =====
export const BASE_PLAYER = { maxHp: 24, atk: 3, def: 0 };
export const expNeeded = (level: number) => 8 + level * 7;

// ===== 층 생성 (방 + 복도) =====
export interface FloorData {
  act: number; // 0-based
  grid: number[][]; // [y][x] TILE_*
  start: Cell;
  stairs: Cell;
  monsters: Monster[];
  chests: Cell[];
  golds: Cell[];
  bossFloor: boolean;
}

interface Room {
  x: number;
  y: number;
  w: number;
  h: number;
}
const roomCenter = (r: Room): Cell => ({ x: r.x + Math.floor(r.w / 2), y: r.y + Math.floor(r.h / 2) });

export function generateFloor(seed: number, globalFloor: number): FloorData {
  const rng = mulberry32(seed * 7919 + globalFloor * 104729 + 977);
  const act = Math.floor(globalFloor / FLOORS_PER_ACT);
  const bossFloor = globalFloor % FLOORS_PER_ACT === FLOORS_PER_ACT - 1;

  const grid: number[][] = Array.from({ length: MAP_H }, () => Array(MAP_W).fill(TILE_WALL));
  const rooms: Room[] = [];

  // 방 배치 (겹침 방지, 1칸 패딩)
  for (let tries = 0; tries < 60 && rooms.length < 8; tries++) {
    const w = 3 + randInt(rng, 4);
    const h = 3 + randInt(rng, 4);
    const x = 1 + randInt(rng, MAP_W - w - 2);
    const y = 1 + randInt(rng, MAP_H - h - 2);
    const overlaps = rooms.some((r) => x < r.x + r.w + 1 && x + w + 1 > r.x && y < r.y + r.h + 1 && y + h + 1 > r.y);
    if (overlaps) continue;
    rooms.push({ x, y, w, h });
    for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) grid[yy][xx] = TILE_FLOOR;
  }

  // 복도 연결 (순차 L자)
  for (let i = 0; i + 1 < rooms.length; i++) {
    const a = roomCenter(rooms[i]);
    const b = roomCenter(rooms[i + 1]);
    let x = a.x;
    let y = a.y;
    while (x !== b.x) {
      grid[y][x] = grid[y][x] === TILE_WALL ? TILE_FLOOR : grid[y][x];
      x += x < b.x ? 1 : -1;
    }
    while (y !== b.y) {
      grid[y][x] = grid[y][x] === TILE_WALL ? TILE_FLOOR : grid[y][x];
      y += y < b.y ? 1 : -1;
    }
    grid[y][x] = grid[y][x] === TILE_WALL ? TILE_FLOOR : grid[y][x];
  }

  const start = roomCenter(rooms[0]);
  const lastRoom = rooms[rooms.length - 1];
  const stairs = roomCenter(lastRoom);
  grid[stairs.y][stairs.x] = TILE_STAIRS;

  // 바닥 칸 수집 (방 안, 시작에서 충분히 먼 곳)
  const floorCells: Cell[] = [];
  for (const r of rooms.slice(1)) {
    for (let yy = r.y; yy < r.y + r.h; yy++) {
      for (let xx = r.x; xx < r.x + r.w; xx++) {
        const c = { x: xx, y: yy };
        if (grid[yy][xx] === TILE_FLOOR && dist2(c, start) > 25 && !sameCell(c, stairs)) floorCells.push(c);
      }
    }
  }
  const takeCell = (): Cell | null => {
    if (!floorCells.length) return null;
    const i = randInt(rng, floorCells.length);
    const c = floorCells[i];
    floorCells.splice(i, 1);
    return c;
  };

  // 몬스터
  const monsters: Monster[] = [];
  let mid = 1;
  const monsterCount = 3 + act * 2 + (globalFloor % FLOORS_PER_ACT);
  const pool = ACT_MONSTERS[act];
  for (let i = 0; i < monsterCount; i++) {
    const c = takeCell();
    if (!c) break;
    const def = pool[randInt(rng, pool.length)];
    monsters.push({ ...def, id: mid++, pos: c, maxHp: def.hp });
  }
  if (bossFloor) {
    const def = ACT_BOSSES[act];
    // 보스는 계단 방 중앙 근처
    const c = { x: Math.min(lastRoom.x + lastRoom.w - 1, stairs.x + 1), y: stairs.y };
    monsters.push({ ...def, id: mid++, pos: grid[c.y]?.[c.x] !== TILE_WALL ? c : stairs, maxHp: def.hp });
  }

  // 상자/금화
  const chests: Cell[] = [];
  for (let i = 0; i < 2; i++) {
    const c = takeCell();
    if (c) chests.push(c);
  }
  const golds: Cell[] = [];
  for (let i = 0; i < 3 + randInt(rng, 3); i++) {
    const c = takeCell();
    if (c) golds.push(c);
  }

  return { act, grid, start, stairs, monsters, chests, golds, bossFloor };
}

// 통행 가능 여부
export function walkable(grid: number[][], c: Cell): boolean {
  return c.y >= 0 && c.y < MAP_H && c.x >= 0 && c.x < MAP_W && grid[c.y][c.x] !== TILE_WALL;
}

// 몬스터 한 걸음: 플레이어를 향해 (막히면 보조축, 그래도 막히면 제자리)
export function monsterStep(grid: number[][], monster: Cell, player: Cell, occupied: (c: Cell) => boolean, rng: RNG): Cell {
  const dx = player.x - monster.x;
  const dy = player.y - monster.y;
  const tryOrder: Cell[] = [];
  const hx = { x: monster.x + Math.sign(dx), y: monster.y };
  const vy = { x: monster.x, y: monster.y + Math.sign(dy) };
  if (Math.abs(dx) >= Math.abs(dy)) tryOrder.push(hx, vy);
  else tryOrder.push(vy, hx);
  for (const c of tryOrder) {
    if (sameCell(c, monster)) continue;
    if (walkable(grid, c) && !occupied(c) && !sameCell(c, player)) return c;
  }
  // 배회 (막혔을 때 30%)
  if (rng() < 0.3) {
    const dirs = [
      { x: monster.x + 1, y: monster.y },
      { x: monster.x - 1, y: monster.y },
      { x: monster.x, y: monster.y + 1 },
      { x: monster.x, y: monster.y - 1 },
    ];
    const c = dirs[randInt(rng, 4)];
    if (walkable(grid, c) && !occupied(c) && !sameCell(c, player)) return c;
  }
  return monster;
}

// 전투 데미지
export function rollDamage(atk: number, def: number, rng: RNG): number {
  return Math.max(1, atk - def + randInt(rng, 3) - 1);
}

export const VISION_RADIUS = 4.5;

export function computeVisible(player: Cell): (c: Cell) => boolean {
  const r2 = VISION_RADIUS * VISION_RADIUS;
  return (c: Cell) => dist2(c, player) <= r2;
}
