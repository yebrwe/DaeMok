import {
  INVENTORY_LIMIT,
  REGION_DEFINITIONS,
  deriveStats,
  enhanceGear,
  generateGear,
  getGearSellPrice,
  isRegionUnlocked,
  restAtTown,
  resolveArenaDefeat,
  resolveArenaKill,
  sanitizeEquipmentInstance,
  sellItem,
  type AdventureLogEntry,
  type AdventureResult,
  type AdventureState,
  type ArenaDefeatOptions,
  type ArenaKillOptions,
  type EquipmentInstance,
  type EquipmentSlot,
  type RNG,
  type RegionId,
} from './adventure';

export const TOWN_STASH_LIMIT = 120;
export const TOWN_MERCHANT_STOCK_SIZE = 8;
export const TOWN_MERCHANT_REFRESH_MS = 30 * 60 * 1000;
export const TOWN_POTION_PRICE = 35;

export type AdventureLocationKind = 'town' | 'wilderness';
export type TownServiceId = 'merchant' | 'blacksmith' | 'healer' | 'stash' | 'waypoint';

export interface AdventureTownState {
  location: AdventureLocationKind;
  townId: string;
  lastFieldRegionId: RegionId;
  stash: EquipmentInstance[];
  merchantStock: EquipmentInstance[];
  merchantSoldOut: boolean;
  merchantRefreshAt: number;
}

export type TownAdventureState = AdventureState & { town: AdventureTownState };

export const TOWN_SERVICE_DEFINITIONS: ReadonlyArray<{
  id: TownServiceId;
  name: string;
  role: string;
  description: string;
}> = [
  { id: 'merchant', name: '마라', role: '장비 상인', description: '지역에서 조달한 장비와 물약을 판매합니다.' },
  { id: 'blacksmith', name: '오르딘', role: '대장장이', description: '장비를 강화하고 전투 준비를 점검합니다.' },
  { id: 'healer', name: '세라', role: '치유사', description: '상처를 회복해 다시 길을 나설 수 있게 합니다.' },
  { id: 'stash', name: '여행자의 궤짝', role: '개인 보관함', description: '계정 캐릭터의 장비를 안전하게 보관합니다.' },
  { id: 'waypoint', name: '경계의 문', role: '필드 출구', description: '현재 지역의 야외로 이어지는 성문입니다.' },
] as const;

function clampInteger(value: unknown, fallback: number, min: number, max: number) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(value)));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hashSeed(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function seededRandom(seed: number) {
  let value = seed >>> 0;
  return () => {
    value += 0x6d2b79f5;
    let mixed = value;
    mixed = Math.imul(mixed ^ (mixed >>> 15), mixed | 1);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
}

function regionTownId(regionId: RegionId) {
  return `${regionId}-town`;
}

export function getTownMerchantPrice(item: EquipmentInstance) {
  return Math.max(40, Math.ceil(getGearSellPrice(item) * 2.75 / 5) * 5);
}

export function createTownMerchantStock(
  state: Pick<AdventureState, 'classId' | 'currentRegionId' | 'level'>,
  now = Date.now(),
): Pick<AdventureTownState, 'merchantStock' | 'merchantSoldOut' | 'merchantRefreshAt'> {
  const cycle = Math.floor(now / TOWN_MERCHANT_REFRESH_MS);
  const rng = seededRandom(hashSeed(`${state.classId}:${state.currentRegionId}:${state.level}:${cycle}`));
  const slots: Array<EquipmentSlot | undefined> = ['weapon', 'armor', 'accessory', undefined, undefined, undefined, undefined, undefined];
  const merchantStock = slots.slice(0, TOWN_MERCHANT_STOCK_SIZE).map((slot, index) => generateGear({
    classId: state.classId,
    regionId: state.currentRegionId,
    level: Math.max(1, state.level + Math.floor(rng() * 3) - 1),
    slot,
    now: cycle * TOWN_MERCHANT_REFRESH_MS + index + 1,
    rng,
  }));
  return {
    merchantStock,
    merchantSoldOut: false,
    merchantRefreshAt: (cycle + 1) * TOWN_MERCHANT_REFRESH_MS,
  };
}

export function createInitialTownState(
  state: Pick<AdventureState, 'classId' | 'currentRegionId' | 'level'>,
  now = Date.now(),
): AdventureTownState {
  return {
    location: 'town',
    townId: regionTownId(state.currentRegionId),
    lastFieldRegionId: state.currentRegionId,
    stash: [],
    ...createTownMerchantStock(state, now),
  };
}

export function sanitizeAdventureTownState(
  raw: unknown,
  state: Pick<AdventureState, 'classId' | 'currentRegionId' | 'level' | 'inventory' | 'equipment'>,
  now = Date.now(),
): AdventureTownState {
  const fallback = createInitialTownState(state, now);
  if (!isRecord(raw)) return fallback;
  const regionId = raw.lastFieldRegionId;
  const lastFieldRegionId = typeof regionId === 'string'
    && REGION_DEFINITIONS[regionId as RegionId]
    && isRegionUnlocked(state, regionId as RegionId)
    ? regionId as RegionId
    : state.currentRegionId;
  const usedIds = new Set<string>(state.inventory.map((item) => item.instanceId));
  for (const item of Object.values(state.equipment)) if (item) usedIds.add(item.instanceId);
  const readItems = (value: unknown, limit: number, prefix: string) => {
    if (!Array.isArray(value)) return [];
    const items: EquipmentInstance[] = [];
    for (let index = 0; index < value.length && items.length < limit; index += 1) {
      const item = sanitizeEquipmentInstance(value[index], `${prefix}-${index}-${now.toString(36)}`, now, state.classId);
      if (!item) continue;
      let instanceId = item.instanceId;
      let suffix = 1;
      while (usedIds.has(instanceId)) instanceId = `${item.instanceId}-${suffix++}`;
      usedIds.add(instanceId);
      items.push(instanceId === item.instanceId ? item : { ...item, instanceId });
    }
    return items;
  };
  const merchantRefreshAt = clampInteger(raw.merchantRefreshAt, 0, 0, Number.MAX_SAFE_INTEGER);
  const stockExpired = merchantRefreshAt <= now;
  const generated = createTownMerchantStock({ ...state, currentRegionId: lastFieldRegionId }, now);
  const merchantSoldOut = !stockExpired && raw.merchantSoldOut === true;
  const merchantStock = stockExpired
    ? generated.merchantStock
    : merchantSoldOut
      ? []
      : readItems(raw.merchantStock, TOWN_MERCHANT_STOCK_SIZE, 'merchant');
  return {
    location: raw.location === 'wilderness' ? 'wilderness' : 'town',
    townId: regionTownId(lastFieldRegionId),
    lastFieldRegionId,
    stash: readItems(raw.stash, TOWN_STASH_LIMIT, 'stash'),
    merchantStock: merchantSoldOut || merchantStock.length > 0 ? merchantStock : generated.merchantStock,
    merchantSoldOut: stockExpired ? false : merchantSoldOut,
    merchantRefreshAt: stockExpired ? generated.merchantRefreshAt : merchantRefreshAt,
  };
}

export function withAdventureTownState(
  state: AdventureState,
  rawTown?: unknown,
  now = Date.now(),
): TownAdventureState {
  const town = sanitizeAdventureTownState(rawTown, state, now);
  return {
    ...state,
    combat: null,
    arenaCheckpoint: town.location === 'town' ? null : state.arenaCheckpoint,
    currentRegionId: town.lastFieldRegionId,
    town,
  };
}

function townLog(state: TownAdventureState, text: string, now: number): AdventureLogEntry[] {
  return [...state.logs, {
    id: `town-${Math.floor(now).toString(36)}-${state.logs.length.toString(36)}`,
    at: now,
    type: 'system' as const,
    text,
  }].slice(-80);
}

function townResult(state: TownAdventureState, text: string, now: number): AdventureResult {
  return {
    ok: true,
    state: {
      ...state,
      logs: townLog(state, text, now),
      updatedAt: now,
      lastActiveAt: now,
    },
    events: [text],
  };
}

function townFailure(state: TownAdventureState, message: string): AdventureResult {
  return { ok: false, state, events: [], message };
}

export function resolveWildernessArenaKill(
  state: TownAdventureState,
  enemyId: string,
  options: ArenaKillOptions,
  rng: RNG = Math.random,
  now = Date.now(),
): AdventureResult {
  if (state.town.location !== 'wilderness') return townFailure(state, '마을에서는 필드 처치를 정산할 수 없습니다.');
  return resolveArenaKill(state, enemyId, options, rng, now);
}

export function resolveWildernessArenaDefeat(
  state: TownAdventureState,
  options: ArenaDefeatOptions,
  now = Date.now(),
): AdventureResult {
  if (state.town.location !== 'wilderness') return townFailure(state, '마을에서는 필드 패배를 정산할 수 없습니다.');
  return resolveArenaDefeat(state, options, now);
}

export function leaveTown(state: TownAdventureState, now = Date.now()): AdventureResult {
  if (state.town.location === 'wilderness') return townFailure(state, '이미 야외에 있습니다.');
  return townResult({
    ...state,
    combat: null,
    arenaCheckpoint: null,
    currentRegionId: state.town.lastFieldRegionId,
    town: { ...state.town, location: 'wilderness' },
  }, `${REGION_DEFINITIONS[state.town.lastFieldRegionId].name} 야외로 나섰습니다.`, now);
}

export function returnToTown(state: TownAdventureState, now = Date.now()): AdventureResult {
  if (state.town.location === 'town') return townFailure(state, '이미 마을에 있습니다.');
  const refreshed = state.town.merchantRefreshAt <= now ? createTownMerchantStock(state, now) : null;
  return townResult({
    ...state,
    combat: null,
    arenaCheckpoint: null,
    town: {
      ...state.town,
      location: 'town',
      townId: regionTownId(state.currentRegionId),
      lastFieldRegionId: state.currentRegionId,
      ...(refreshed ?? {}),
    },
  }, `${REGION_DEFINITIONS[state.currentRegionId].name} 거점으로 귀환했습니다.`, now);
}

export function selectTownDestination(
  state: TownAdventureState,
  regionId: RegionId,
  now = Date.now(),
): AdventureResult {
  if (state.town.location !== 'town') return townFailure(state, '목적지는 마을 웨이포인트에서만 선택할 수 있습니다.');
  const region = REGION_DEFINITIONS[regionId];
  if (!region) return townFailure(state, '존재하지 않는 지역입니다.');
  if (!isRegionUnlocked(state, regionId)) return townFailure(state, `레벨 ${region.unlockLevel}에 해금되는 지역입니다.`);
  if (state.town.lastFieldRegionId === regionId) return townFailure(state, '이미 선택한 목적지입니다.');
  return townResult({
    ...state,
    currentRegionId: regionId,
    town: {
      ...state.town,
      townId: regionTownId(regionId),
      lastFieldRegionId: regionId,
    },
  }, `웨이포인트 목적지를 ${region.name}(으)로 맞췄습니다.`, now);
}

export function buyTownMerchantItem(
  state: TownAdventureState,
  instanceId: string,
  now = Date.now(),
): AdventureResult {
  if (state.town.location !== 'town') return townFailure(state, '장비 상인은 마을에서만 이용할 수 있습니다.');
  if (state.inventory.length >= INVENTORY_LIMIT) return townFailure(state, '가방이 가득 찼습니다.');
  const item = state.town.merchantStock.find((candidate) => candidate.instanceId === instanceId);
  if (!item) return townFailure(state, '상인이 더 이상 보유하지 않은 장비입니다.');
  const price = getTownMerchantPrice(item);
  if (state.gold < price) return townFailure(state, `골드가 부족합니다. (${price.toLocaleString()} 골드)`);
  const text = `${getGearSellPrice(item).toLocaleString()}G 가치의 장비를 상인에게서 ${price.toLocaleString()}G에 구입했습니다.`;
  const merchantStock = state.town.merchantStock.filter((candidate) => candidate.instanceId !== instanceId);
  return townResult({
    ...state,
    gold: state.gold - price,
    inventory: [...state.inventory, { ...item, acquiredAt: now }],
    town: {
      ...state.town,
      merchantStock,
      merchantSoldOut: merchantStock.length === 0,
    },
    discoveredItemKeys: state.discoveredItemKeys.includes(item.itemKey)
      ? state.discoveredItemKeys
      : [...state.discoveredItemKeys, item.itemKey],
    statistics: {
      ...state.statistics,
      goldSpent: state.statistics.goldSpent + price,
      equipmentFound: state.statistics.equipmentFound + 1,
    },
  }, text, now);
}

export function buyTownPotion(state: TownAdventureState, amount = 1, now = Date.now()): AdventureResult {
  if (state.town.location !== 'town') return townFailure(state, '물약 상인은 마을에서만 이용할 수 있습니다.');
  const count = Math.min(20, Math.max(1, Math.floor(amount)));
  const price = count * TOWN_POTION_PRICE;
  if (state.gold < price) return townFailure(state, `골드가 부족합니다. (${price.toLocaleString()} 골드)`);
  return townResult({
    ...state,
    gold: state.gold - price,
    potions: state.potions + count,
    statistics: { ...state.statistics, goldSpent: state.statistics.goldSpent + price },
  }, `회복 물약 ${count}개를 ${price.toLocaleString()}G에 구입했습니다.`, now);
}

export function sellItemToTownMerchant(
  state: TownAdventureState,
  instanceId: string,
  now = Date.now(),
): AdventureResult {
  if (state.town.location !== 'town') return townFailure(state, '장비 판매는 마을 상인에게서만 할 수 있습니다.');
  return sellItem(state, instanceId, now);
}

export function enhanceAtBlacksmith(
  state: TownAdventureState,
  instanceId: string,
  now = Date.now(),
): AdventureResult {
  if (state.town.location !== 'town') return townFailure(state, '장비 강화는 마을 대장장이에게서만 할 수 있습니다.');
  return enhanceGear(state, instanceId, now);
}

export function healAtTown(state: TownAdventureState, now = Date.now()): AdventureResult {
  if (state.town.location !== 'town') return townFailure(state, '치유사는 마을에서만 만날 수 있습니다.');
  const maxHp = deriveStats(state).maxHp;
  return restAtTown(state, state.hp < maxHp * 0.5 ? 'free' : 'gold', now);
}

export function depositTownStash(
  state: TownAdventureState,
  instanceId: string,
  now = Date.now(),
): AdventureResult {
  if (state.town.location !== 'town') return townFailure(state, '보관함은 마을에서만 이용할 수 있습니다.');
  if (state.town.stash.length >= TOWN_STASH_LIMIT) return townFailure(state, '보관함이 가득 찼습니다.');
  const item = state.inventory.find((candidate) => candidate.instanceId === instanceId);
  if (!item) return townFailure(state, '보관할 장비를 찾을 수 없습니다.');
  return townResult({
    ...state,
    inventory: state.inventory.filter((candidate) => candidate.instanceId !== instanceId),
    town: { ...state.town, stash: [...state.town.stash, item] },
  }, '장비를 개인 보관함에 넣었습니다.', now);
}

export function withdrawTownStash(
  state: TownAdventureState,
  instanceId: string,
  now = Date.now(),
): AdventureResult {
  if (state.town.location !== 'town') return townFailure(state, '보관함은 마을에서만 이용할 수 있습니다.');
  if (state.inventory.length >= INVENTORY_LIMIT) return townFailure(state, '가방이 가득 찼습니다.');
  const item = state.town.stash.find((candidate) => candidate.instanceId === instanceId);
  if (!item) return townFailure(state, '꺼낼 장비를 찾을 수 없습니다.');
  return townResult({
    ...state,
    inventory: [...state.inventory, item],
    town: { ...state.town, stash: state.town.stash.filter((candidate) => candidate.instanceId !== instanceId) },
  }, '장비를 개인 보관함에서 꺼냈습니다.', now);
}
