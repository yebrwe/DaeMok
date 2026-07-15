export const ADVENTURE_WORLD_VERSION = 1;
export const WORLD_CHUNK_SIZE = 128;
export const WORLD_GRID_WIDTH = 48;
export const WORLD_GRID_HEIGHT = 48;
export const WORLD_NAV_CELLS = 16;
export const WORLD_NAV_CELL_SIZE = WORLD_CHUNK_SIZE / WORLD_NAV_CELLS;
export const DEFAULT_STREAM_RADIUS = 2;
export const MAX_STREAM_RADIUS = 4;
export const MAX_DISCOVERED_CHUNKS = 4_096;

export type WorldBiomeId =
  | 'greenmarch'
  | 'whisperwood'
  | 'sunscorch'
  | 'drownedfen'
  | 'frostfang'
  | 'stormhighlands'
  | 'emberwaste'
  | 'crystalcoast';

export type WorldZoneKind =
  | 'town'
  | 'wilderness'
  | 'dungeonEntrance'
  | 'dungeonRoom'
  | 'dungeonBoss';

export type WorldFogState = 'hidden' | 'discovered' | 'visible';
export type WorldDimension = 'overworld' | 'dungeon';

export type AdventureFieldRegionId = 'sunnyField' | 'mistForest' | 'ancientRuins' | 'dragonCrater';

export interface WorldPosition {
  x: number;
  z: number;
}

export interface WorldVector3 extends WorldPosition {
  y: number;
}

export interface WorldSize3 {
  x: number;
  y: number;
  z: number;
}

export interface WorldChunkCoordinate {
  x: number;
  z: number;
}

export interface WorldBounds {
  minX: number;
  minZ: number;
  maxX: number;
  maxZ: number;
}

export interface WorldBiomeDefinition {
  id: WorldBiomeId;
  name: string;
  materialKey: string;
  roadMaterialKey: string;
  primaryColor: string;
  secondaryColor: string;
  fogColor: string;
  ambientColor: string;
  propKeys: readonly string[];
  monsterTags: readonly string[];
}

export interface WorldRegionDefinition {
  id: string;
  name: string;
  biomeId: WorldBiomeId;
  recommendedLevel: readonly [number, number];
  anchorChunk: WorldChunkCoordinate;
  townId: string;
  dungeonId: string;
}

export interface WorldTownDefinition {
  id: string;
  name: string;
  regionId: string;
  chunk: WorldChunkCoordinate;
  position: WorldPosition;
  waypointId: string;
  services: readonly ('healer' | 'blacksmith' | 'stash' | 'merchant' | 'mercenary')[];
}

export interface WorldWaypointDefinition {
  id: string;
  name: string;
  regionId: string;
  chunk: WorldChunkCoordinate;
  position: WorldPosition;
  kind: 'town' | 'wilderness';
}

export interface WorldDungeonFloorDefinition {
  floor: number;
  name: string;
  gridWidth: number;
  gridHeight: number;
  entryChunk: WorldChunkCoordinate;
  exitChunk: WorldChunkCoordinate | null;
  bossChunk: WorldChunkCoordinate | null;
}

export interface WorldDungeonDefinition {
  id: string;
  name: string;
  regionId: string;
  biomeId: WorldBiomeId;
  entranceChunk: WorldChunkCoordinate;
  entrancePosition: WorldPosition;
  floors: readonly WorldDungeonFloorDefinition[];
  bossName: string;
}

export interface AdventureWorldDefinition {
  version: number;
  seed: string;
  chunkSize: number;
  gridWidth: number;
  gridHeight: number;
  bounds: WorldBounds;
  regions: readonly WorldRegionDefinition[];
  towns: readonly WorldTownDefinition[];
  waypoints: readonly WorldWaypointDefinition[];
  dungeons: readonly WorldDungeonDefinition[];
  startingTownId: string;
  startingWaypointId: string;
  startingPosition: WorldPosition;
}

export interface WorldTerrainRenderData {
  materialKey: string;
  primaryColor: string;
  secondaryColor: string;
  resolution: number;
  heightSamples: readonly number[];
  minHeight: number;
  maxHeight: number;
}

export interface WorldRoadRenderData {
  id: string;
  materialKey: string;
  width: number;
  points: readonly WorldVector3[];
}

export interface WorldObstacleRenderData {
  id: string;
  assetKey: string;
  position: WorldVector3;
  shape: 'circle' | 'box';
  radius: number;
  halfExtents: WorldPosition;
  height: number;
  blocksMovement: true;
  blocksProjectiles: boolean;
}

export interface WorldPropRenderData {
  id: string;
  assetKey: string;
  position: WorldVector3;
  rotationY: number;
  scale: WorldSize3;
  tint: string;
  castsShadow: boolean;
  obstacleId: string | null;
}

export type WorldSpawnKind = 'monsterPack' | 'elite' | 'boss' | 'npc' | 'ambient' | 'loot';

export interface WorldSpawnNode {
  id: string;
  kind: WorldSpawnKind;
  position: WorldVector3;
  radius: number;
  minCount: number;
  maxCount: number;
  levelRange: readonly [number, number];
  tags: readonly string[];
  respawnSeconds: number;
}

export type WorldPointOfInterestKind =
  | 'townCenter'
  | 'waypoint'
  | 'dungeonEntrance'
  | 'floorEntrance'
  | 'floorExit'
  | 'bossGate';

export interface WorldPointOfInterest {
  id: string;
  kind: WorldPointOfInterestKind;
  name: string;
  position: WorldVector3;
  interactionRadius: number;
  targetId: string | null;
}

export interface WorldWalkabilityGrid {
  origin: WorldPosition;
  columns: number;
  rows: number;
  cellSize: number;
  blocked: readonly number[];
}

export interface WorldChunkRenderData {
  id: string;
  dimension: WorldDimension;
  dungeonId: string | null;
  dungeonFloor: number;
  coordinate: WorldChunkCoordinate;
  origin: WorldPosition;
  center: WorldPosition;
  bounds: WorldBounds;
  neighborIds: readonly string[];
  regionId: string;
  biomeId: WorldBiomeId;
  zoneKind: WorldZoneKind;
  recommendedLevel: readonly [number, number];
  fogState: WorldFogState;
  terrain: WorldTerrainRenderData;
  roads: readonly WorldRoadRenderData[];
  obstacles: readonly WorldObstacleRenderData[];
  props: readonly WorldPropRenderData[];
  spawnNodes: readonly WorldSpawnNode[];
  pointsOfInterest: readonly WorldPointOfInterest[];
  walkability: WorldWalkabilityGrid;
}

export interface WorldChunkStreamOptions {
  radius?: number;
  revealRadius?: number;
  previouslyActiveChunkIds?: readonly string[];
  discoveredChunkIds?: readonly string[];
}

export interface WorldChunkStreamResult {
  centerChunkId: string;
  activeChunkIds: readonly string[];
  chunks: readonly WorldChunkRenderData[];
  load: readonly WorldChunkRenderData[];
  retain: readonly string[];
  unload: readonly string[];
  newlyDiscoveredChunkIds: readonly string[];
}

export interface WorldArenaProjection {
  center: WorldPosition;
  arenaWidth: number;
  arenaHeight: number;
  visibleWorldWidth: number;
  visibleWorldHeight: number;
}

export interface ArenaPosition {
  x: number;
  y: number;
}

export interface WorldNavigationCell {
  chunkId: string;
  column: number;
  row: number;
  center: WorldPosition;
  walkable: boolean;
}

export interface WorldPathOptions {
  maxVisitedCells?: number;
  allowDiagonal?: boolean;
}

export interface AdventureWorldProgress {
  worldSeed: string;
  worldPlayerPosition: WorldPosition;
  discoveredChunkIds: string[];
  unlockedWaypointIds: string[];
  activeDungeonId: string | null;
  activeDungeonFloor: number;
}

export interface WorldProgressUpdateResult {
  progress: AdventureWorldProgress;
  stream: WorldChunkStreamResult;
}

export interface AdventureWorldRuntimeOptions {
  maxCachedChunks?: number;
}

export type WorldEnabledAdventureSave<T extends object> = T & AdventureWorldProgress;

interface RegionTemplate {
  id: string;
  name: string;
  biomeId: WorldBiomeId;
  anchor: readonly [number, number];
  recommendedLevel: readonly [number, number];
  townName: string;
  dungeonName: string;
  bossName: string;
}

export const WORLD_BIOMES: Readonly<Record<WorldBiomeId, WorldBiomeDefinition>> = {
  greenmarch: {
    id: 'greenmarch', name: '푸른 변경', materialKey: 'ground-meadow', roadMaterialKey: 'road-earth',
    primaryColor: '#293126', secondaryColor: '#414a35', fogColor: '#39413a', ambientColor: '#938b73',
    propKeys: ['oak', 'field-boulder', 'fallen-log', 'thorn-bush'], monsterTags: ['beast', 'fallen', 'vermin'],
  },
  whisperwood: {
    id: 'whisperwood', name: '속삭임 숲', materialKey: 'ground-forest', roadMaterialKey: 'road-roots',
    primaryColor: '#1c2d27', secondaryColor: '#304039', fogColor: '#2d3a35', ambientColor: '#7f8c7e',
    propKeys: ['ancient-oak', 'pine', 'moss-rock', 'deadfall'], monsterTags: ['beast', 'spirit', 'cultist'],
  },
  sunscorch: {
    id: 'sunscorch', name: '태양 작열지', materialKey: 'ground-desert', roadMaterialKey: 'road-sandstone',
    primaryColor: '#58442f', secondaryColor: '#766044', fogColor: '#5d5147', ambientColor: '#b29a75',
    propKeys: ['sandstone', 'dry-tree', 'cactus', 'buried-bones'], monsterTags: ['scarab', 'raider', 'undead'],
  },
  drownedfen: {
    id: 'drownedfen', name: '침수 습지', materialKey: 'ground-bog', roadMaterialKey: 'road-boardwalk',
    primaryColor: '#26362f', secondaryColor: '#3b493d', fogColor: '#36433e', ambientColor: '#879083',
    propKeys: ['bog-tree', 'peat-rock', 'reeds', 'rotted-stump'], monsterTags: ['drowned', 'poison', 'vermin'],
  },
  frostfang: {
    id: 'frostfang', name: '서리송곳 산맥', materialKey: 'ground-snow', roadMaterialKey: 'road-packed-snow',
    primaryColor: '#687373', secondaryColor: '#8e9590', fogColor: '#778181', ambientColor: '#aeb9b7',
    propKeys: ['snow-pine', 'ice-spire', 'granite', 'frozen-log'], monsterTags: ['goatman', 'wraith', 'frost'],
  },
  stormhighlands: {
    id: 'stormhighlands', name: '폭풍 고원', materialKey: 'ground-highland', roadMaterialKey: 'road-gravel',
    primaryColor: '#41453f', secondaryColor: '#5b5f53', fogColor: '#505753', ambientColor: '#929b96',
    propKeys: ['standing-stone', 'highland-rock', 'wind-tree', 'heather'], monsterTags: ['goatman', 'harpy', 'construct'],
  },
  emberwaste: {
    id: 'emberwaste', name: '잿불 황무지', materialKey: 'ground-ash', roadMaterialKey: 'road-basalt',
    primaryColor: '#292526', secondaryColor: '#4b3530', fogColor: '#493d3b', ambientColor: '#9c674f',
    propKeys: ['basalt-column', 'lava-vent', 'obsidian', 'charred-tree'], monsterTags: ['demon', 'construct', 'fire'],
  },
  crystalcoast: {
    id: 'crystalcoast', name: '수정 해안', materialKey: 'ground-coast', roadMaterialKey: 'road-shell',
    primaryColor: '#30494a', secondaryColor: '#49655f', fogColor: '#46605d', ambientColor: '#8eaaa1',
    propKeys: ['sea-crystal', 'driftwood', 'coast-rock', 'coral'], monsterTags: ['siren', 'drowned', 'crystal'],
  },
};

const REGION_TEMPLATES: readonly RegionTemplate[] = [
  { id: 'greenmarch', name: '푸른 변경', biomeId: 'greenmarch', anchor: [0.14, 0.52], recommendedLevel: [1, 12], townName: '새벽 보루', dungeonName: '버려진 지하묘지', bossName: '뼈의 집정관' },
  { id: 'whisperwood', name: '속삭임 숲', biomeId: 'whisperwood', anchor: [0.29, 0.20], recommendedLevel: [9, 22], townName: '삼나무 야영지', dungeonName: '뿌리감옥', bossName: '공허뿌리 어머니' },
  { id: 'sunscorch', name: '태양 작열지', biomeId: 'sunscorch', anchor: [0.52, 0.12], recommendedLevel: [18, 34], townName: '황동 교역소', dungeonName: '가라앉은 왕릉', bossName: '모래왕 아케멘' },
  { id: 'drownedfen', name: '침수 습지', biomeId: 'drownedfen', anchor: [0.34, 0.75], recommendedLevel: [27, 43], townName: '갈대 피난처', dungeonName: '침수 성소', bossName: '수렁의 성녀' },
  { id: 'frostfang', name: '서리송곳 산맥', biomeId: 'frostfang', anchor: [0.78, 0.15], recommendedLevel: [38, 56], townName: '화롯불 성채', dungeonName: '얼어붙은 갱도', bossName: '백색 거인 흐룸' },
  { id: 'stormhighlands', name: '폭풍 고원', biomeId: 'stormhighlands', anchor: [0.55, 0.48], recommendedLevel: [49, 68], townName: '천둥 관문', dungeonName: '무너진 천문대', bossName: '폭풍술사 카일' },
  { id: 'emberwaste', name: '잿불 황무지', biomeId: 'emberwaste', anchor: [0.82, 0.53], recommendedLevel: [62, 82], townName: '검은 모루', dungeonName: '불씨 심연', bossName: '용광로 군주' },
  { id: 'crystalcoast', name: '수정 해안', biomeId: 'crystalcoast', anchor: [0.68, 0.84], recommendedLevel: [76, 99], townName: '유리 항구', dungeonName: '조수의 수정궁', bossName: '심해의 여왕' },
];

const DEFAULT_WORLD_SEED = 'daemok-eternal-frontier';
const TERRAIN_RESOLUTION = 8;
const ROAD_WIDTH = 14;
const DUNGEON_CHUNK_SIZE = 72;

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function finiteNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function integer(value: unknown, fallback: number, min: number, max: number): number {
  return clamp(Math.floor(finiteNumber(value, fallback)), min, max);
}

function round(value: number, digits = 4): number {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hashString(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function hashParts(...parts: readonly (string | number)[]): number {
  return hashString(parts.join('|'));
}

function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function normalizeSeed(value: unknown, fallback = DEFAULT_WORLD_SEED): string {
  if (typeof value === 'number' && Number.isFinite(value)) return `seed-${Math.floor(value).toString(36)}`;
  if (typeof value !== 'string') return fallback;
  const source = value.trim().slice(0, 128);
  if (!source) return fallback;
  const normalized = source.replace(/[^a-zA-Z0-9_-]/g, '-').replace(/-+/g, '-').slice(0, 64);
  return /[a-zA-Z0-9_]/.test(normalized) ? normalized : `seed-${hashString(source).toString(36)}`;
}

function sameChunk(left: WorldChunkCoordinate, right: WorldChunkCoordinate): boolean {
  return left.x === right.x && left.z === right.z;
}

function chunkPosition(
  coordinate: WorldChunkCoordinate,
  localX = WORLD_CHUNK_SIZE / 2,
  localZ = WORLD_CHUNK_SIZE / 2,
): WorldPosition {
  const minX = -(WORLD_GRID_WIDTH * WORLD_CHUNK_SIZE) / 2;
  const minZ = -(WORLD_GRID_HEIGHT * WORLD_CHUNK_SIZE) / 2;
  return {
    x: minX + coordinate.x * WORLD_CHUNK_SIZE + localX,
    z: minZ + coordinate.z * WORLD_CHUNK_SIZE + localZ,
  };
}

function offsetChunk(anchor: WorldChunkCoordinate, dx: number, dz: number): WorldChunkCoordinate {
  return {
    x: clamp(anchor.x + dx, 1, WORLD_GRID_WIDTH - 2),
    z: clamp(anchor.z + dz, 1, WORLD_GRID_HEIGHT - 2),
  };
}

function biomeHeight(seed: string, x: number, z: number): number {
  const sample = (gridX: number, gridZ: number, octave: number): number => {
    return (hashParts(seed, 'height', octave, gridX, gridZ) / 0xffffffff) * 2 - 1;
  };
  const valueNoise = (frequency: number, octave: number): number => {
    const scaledX = x / frequency;
    const scaledZ = z / frequency;
    const x0 = Math.floor(scaledX);
    const z0 = Math.floor(scaledZ);
    const tx = scaledX - x0;
    const tz = scaledZ - z0;
    const smoothX = tx * tx * (3 - 2 * tx);
    const smoothZ = tz * tz * (3 - 2 * tz);
    const top = sample(x0, z0, octave) * (1 - smoothX) + sample(x0 + 1, z0, octave) * smoothX;
    const bottom = sample(x0, z0 + 1, octave) * (1 - smoothX) + sample(x0 + 1, z0 + 1, octave) * smoothX;
    return top * (1 - smoothZ) + bottom * smoothZ;
  };
  return round(valueNoise(310, 1) * 5.2 + valueNoise(96, 2) * 1.6 + valueNoise(38, 3) * 0.35, 3);
}

function servicesForRegion(index: number): WorldTownDefinition['services'] {
  if (index === 0) return ['healer', 'blacksmith', 'stash', 'merchant', 'mercenary'];
  return index % 2 === 0
    ? ['healer', 'blacksmith', 'stash', 'merchant']
    : ['healer', 'stash', 'merchant', 'mercenary'];
}

function buildDungeonFloors(seed: string, template: RegionTemplate, regionIndex: number): WorldDungeonFloorDefinition[] {
  const floorCount = 3 + (hashParts(seed, template.id, 'floors') % 3);
  return Array.from({ length: floorCount }, (_, index) => {
    const floor = index + 1;
    const gridWidth = 5 + ((regionIndex + floor) % 2);
    const gridHeight = 5 + ((regionIndex + floor + 1) % 2);
    const entryChunk = { x: 0, z: Math.floor(gridHeight / 2) };
    const finalFloor = floor === floorCount;
    return {
      floor,
      name: finalFloor ? `${template.dungeonName} · 군주의 방` : `${template.dungeonName} · 지하 ${floor}층`,
      gridWidth,
      gridHeight,
      entryChunk,
      exitChunk: finalFloor ? null : { x: gridWidth - 1, z: Math.floor(gridHeight / 2) },
      bossChunk: finalFloor ? { x: gridWidth - 1, z: Math.floor(gridHeight / 2) } : null,
    };
  });
}

export function createAdventureWorld(seedValue: string | number = DEFAULT_WORLD_SEED): AdventureWorldDefinition {
  const seed = normalizeSeed(seedValue);
  const bounds: WorldBounds = {
    minX: -(WORLD_GRID_WIDTH * WORLD_CHUNK_SIZE) / 2,
    minZ: -(WORLD_GRID_HEIGHT * WORLD_CHUNK_SIZE) / 2,
    maxX: (WORLD_GRID_WIDTH * WORLD_CHUNK_SIZE) / 2,
    maxZ: (WORLD_GRID_HEIGHT * WORLD_CHUNK_SIZE) / 2,
  };
  const regions: WorldRegionDefinition[] = REGION_TEMPLATES.map((template) => {
    const random = seededRandom(hashParts(seed, template.id, 'anchor'));
    const jitterX = Math.floor(random() * 3) - 1;
    const jitterZ = Math.floor(random() * 3) - 1;
    const anchorChunk = {
      x: clamp(Math.round(template.anchor[0] * (WORLD_GRID_WIDTH - 1)) + jitterX, 2, WORLD_GRID_WIDTH - 3),
      z: clamp(Math.round(template.anchor[1] * (WORLD_GRID_HEIGHT - 1)) + jitterZ, 2, WORLD_GRID_HEIGHT - 3),
    };
    return {
      id: template.id,
      name: template.name,
      biomeId: template.biomeId,
      recommendedLevel: template.recommendedLevel,
      anchorChunk,
      townId: `town-${template.id}`,
      dungeonId: `dungeon-${template.id}`,
    };
  });

  const towns: WorldTownDefinition[] = regions.map((region, index) => ({
    id: region.townId,
    name: REGION_TEMPLATES[index].townName,
    regionId: region.id,
    chunk: { ...region.anchorChunk },
    position: chunkPosition(region.anchorChunk),
    waypointId: `waypoint-${region.id}-town`,
    services: servicesForRegion(index),
  }));

  const waypoints: WorldWaypointDefinition[] = regions.flatMap((region, index) => {
    const direction = index % 2 === 0 ? 1 : -1;
    const frontierChunk = offsetChunk(region.anchorChunk, direction * (2 + index % 3), direction * (index % 2 + 1));
    return [
      {
        id: `waypoint-${region.id}-town`,
        name: `${REGION_TEMPLATES[index].townName} 귀환진`,
        regionId: region.id,
        chunk: { ...region.anchorChunk },
        position: chunkPosition(region.anchorChunk, WORLD_CHUNK_SIZE / 2 + 12, WORLD_CHUNK_SIZE / 2),
        kind: 'town' as const,
      },
      {
        id: `waypoint-${region.id}-frontier`,
        name: `${region.name} 전초 귀환진`,
        regionId: region.id,
        chunk: frontierChunk,
        position: chunkPosition(frontierChunk, WORLD_CHUNK_SIZE / 2, WORLD_CHUNK_SIZE / 2 + 14),
        kind: 'wilderness' as const,
      },
    ];
  });

  const dungeons: WorldDungeonDefinition[] = regions.map((region, index) => {
    const directionX = index % 2 === 0 ? 1 : -1;
    const directionZ = index % 3 === 0 ? -1 : 1;
    const entranceChunk = offsetChunk(region.anchorChunk, directionX * (3 + index % 2), directionZ * (2 + index % 3));
    const template = REGION_TEMPLATES[index];
    return {
      id: region.dungeonId,
      name: template.dungeonName,
      regionId: region.id,
      biomeId: region.biomeId,
      entranceChunk,
      entrancePosition: chunkPosition(entranceChunk),
      floors: buildDungeonFloors(seed, template, index),
      bossName: template.bossName,
    };
  });

  return {
    version: ADVENTURE_WORLD_VERSION,
    seed,
    chunkSize: WORLD_CHUNK_SIZE,
    gridWidth: WORLD_GRID_WIDTH,
    gridHeight: WORLD_GRID_HEIGHT,
    bounds,
    regions,
    towns,
    waypoints,
    dungeons,
    startingTownId: towns[0].id,
    startingWaypointId: waypoints[0].id,
    startingPosition: { ...towns[0].position },
  };
}

const WORLD_REGION_FOR_ADVENTURE_FIELD: Record<AdventureFieldRegionId, WorldBiomeId> = {
  sunnyField: 'greenmarch',
  mistForest: 'whisperwood',
  ancientRuins: 'stormhighlands',
  dragonCrater: 'emberwaste',
};

export function getAdventureRegionFrontierPosition(
  world: AdventureWorldDefinition,
  regionId: AdventureFieldRegionId,
): WorldPosition {
  const worldRegionId = WORLD_REGION_FOR_ADVENTURE_FIELD[regionId];
  const frontier = world.waypoints.find((waypoint) => (
    waypoint.regionId === worldRegionId && waypoint.kind === 'wilderness'
  ));
  if (frontier) return { ...frontier.position };
  const region = world.regions.find((candidate) => candidate.id === worldRegionId);
  return region ? chunkPosition(region.anchorChunk) : { ...world.startingPosition };
}

export function getOverworldChunkId(coordinate: WorldChunkCoordinate): string {
  return `ow:${coordinate.x}:${coordinate.z}`;
}

export function getDungeonChunkId(dungeonId: string, floor: number, coordinate: WorldChunkCoordinate): string {
  return `dg:${dungeonId}:${floor}:${coordinate.x}:${coordinate.z}`;
}

export function isOverworldChunkCoordinate(
  world: AdventureWorldDefinition,
  coordinate: WorldChunkCoordinate,
): boolean {
  return Number.isInteger(coordinate.x)
    && Number.isInteger(coordinate.z)
    && coordinate.x >= 0
    && coordinate.z >= 0
    && coordinate.x < world.gridWidth
    && coordinate.z < world.gridHeight;
}

export function parseOverworldChunkId(world: AdventureWorldDefinition, id: string): WorldChunkCoordinate | null {
  const match = /^ow:(\d+):(\d+)$/.exec(id);
  if (!match) return null;
  const coordinate = { x: Number(match[1]), z: Number(match[2]) };
  return isOverworldChunkCoordinate(world, coordinate) ? coordinate : null;
}

export function worldToChunkCoordinate(
  world: AdventureWorldDefinition,
  position: WorldPosition,
): WorldChunkCoordinate | null {
  if (!Number.isFinite(position.x) || !Number.isFinite(position.z)) return null;
  if (position.x < world.bounds.minX || position.z < world.bounds.minZ) return null;
  if (position.x >= world.bounds.maxX || position.z >= world.bounds.maxZ) return null;
  return {
    x: Math.floor((position.x - world.bounds.minX) / world.chunkSize),
    z: Math.floor((position.z - world.bounds.minZ) / world.chunkSize),
  };
}

export function getOverworldChunkBounds(
  world: AdventureWorldDefinition,
  coordinate: WorldChunkCoordinate,
): WorldBounds | null {
  if (!isOverworldChunkCoordinate(world, coordinate)) return null;
  const minX = world.bounds.minX + coordinate.x * world.chunkSize;
  const minZ = world.bounds.minZ + coordinate.z * world.chunkSize;
  return { minX, minZ, maxX: minX + world.chunkSize, maxZ: minZ + world.chunkSize };
}

export function getRegionForChunk(
  world: AdventureWorldDefinition,
  coordinate: WorldChunkCoordinate,
): WorldRegionDefinition {
  const town = world.towns.find((candidate) => sameChunk(candidate.chunk, coordinate));
  if (town) return world.regions.find((region) => region.id === town.regionId) ?? world.regions[0];
  const dungeon = world.dungeons.find((candidate) => sameChunk(candidate.entranceChunk, coordinate));
  if (dungeon) return world.regions.find((region) => region.id === dungeon.regionId) ?? world.regions[0];

  let closest = world.regions[0];
  let closestDistance = Number.POSITIVE_INFINITY;
  for (const region of world.regions) {
    const dx = coordinate.x - region.anchorChunk.x;
    const dz = coordinate.z - region.anchorChunk.z;
    const boundaryNoise = ((hashParts(world.seed, 'region-edge', region.id, coordinate.x, coordinate.z) % 2_001) - 1_000) / 1_000;
    const distance = dx * dx + dz * dz + boundaryNoise * 3.5;
    if (distance < closestDistance) {
      closest = region;
      closestDistance = distance;
    }
  }
  return closest;
}

function getOverworldNeighborIds(
  world: AdventureWorldDefinition,
  coordinate: WorldChunkCoordinate,
): string[] {
  return [
    { x: coordinate.x - 1, z: coordinate.z },
    { x: coordinate.x + 1, z: coordinate.z },
    { x: coordinate.x, z: coordinate.z - 1 },
    { x: coordinate.x, z: coordinate.z + 1 },
  ].filter((candidate) => isOverworldChunkCoordinate(world, candidate)).map(getOverworldChunkId);
}

function createTerrainRenderData(
  world: AdventureWorldDefinition,
  biome: WorldBiomeDefinition,
  bounds: WorldBounds,
  flat = false,
): WorldTerrainRenderData {
  const heightSamples: number[] = [];
  for (let row = 0; row <= TERRAIN_RESOLUTION; row += 1) {
    for (let column = 0; column <= TERRAIN_RESOLUTION; column += 1) {
      const x = bounds.minX + ((bounds.maxX - bounds.minX) * column) / TERRAIN_RESOLUTION;
      const z = bounds.minZ + ((bounds.maxZ - bounds.minZ) * row) / TERRAIN_RESOLUTION;
      heightSamples.push(flat ? 0 : biomeHeight(world.seed, x, z));
    }
  }
  return {
    materialKey: biome.materialKey,
    primaryColor: biome.primaryColor,
    secondaryColor: biome.secondaryColor,
    resolution: TERRAIN_RESOLUTION,
    heightSamples,
    minHeight: Math.min(...heightSamples),
    maxHeight: Math.max(...heightSamples),
  };
}

function createCrossRoads(
  chunkId: string,
  bounds: WorldBounds,
  materialKey: string,
  width = ROAD_WIDTH,
): WorldRoadRenderData[] {
  const centerX = (bounds.minX + bounds.maxX) / 2;
  const centerZ = (bounds.minZ + bounds.maxZ) / 2;
  return [
    {
      id: `${chunkId}:road-x`, materialKey, width,
      points: [{ x: bounds.minX, y: 0.08, z: centerZ }, { x: bounds.maxX, y: 0.08, z: centerZ }],
    },
    {
      id: `${chunkId}:road-z`, materialKey, width,
      points: [{ x: centerX, y: 0.08, z: bounds.minZ }, { x: centerX, y: 0.08, z: bounds.maxZ }],
    },
  ];
}

function createWalkabilityGrid(bounds: WorldBounds, chunkSize: number): WorldWalkabilityGrid {
  const columns = WORLD_NAV_CELLS;
  const rows = WORLD_NAV_CELLS;
  return {
    origin: { x: bounds.minX, z: bounds.minZ },
    columns,
    rows,
    cellSize: chunkSize / columns,
    blocked: Array.from({ length: columns * rows }, () => 0),
  };
}

function isPositionOnRoad(position: WorldPosition, bounds: WorldBounds, clearance = ROAD_WIDTH): boolean {
  const centerX = (bounds.minX + bounds.maxX) / 2;
  const centerZ = (bounds.minZ + bounds.maxZ) / 2;
  return Math.abs(position.x - centerX) <= clearance || Math.abs(position.z - centerZ) <= clearance;
}

function markObstacleOnGrid(grid: WorldWalkabilityGrid, obstacle: WorldObstacleRenderData): void {
  const blocked = grid.blocked as number[];
  for (let row = 0; row < grid.rows; row += 1) {
    for (let column = 0; column < grid.columns; column += 1) {
      const x = grid.origin.x + (column + 0.5) * grid.cellSize;
      const z = grid.origin.z + (row + 0.5) * grid.cellSize;
      const dx = Math.abs(x - obstacle.position.x);
      const dz = Math.abs(z - obstacle.position.z);
      const padding = grid.cellSize * 0.36;
      const collides = obstacle.shape === 'circle'
        ? Math.hypot(dx, dz) <= obstacle.radius + padding
        : dx <= obstacle.halfExtents.x + padding && dz <= obstacle.halfExtents.z + padding;
      if (collides) blocked[row * grid.columns + column] = 1;
    }
  }
}

function clearRoadCells(grid: WorldWalkabilityGrid, bounds: WorldBounds): void {
  const blocked = grid.blocked as number[];
  const centerX = (bounds.minX + bounds.maxX) / 2;
  const centerZ = (bounds.minZ + bounds.maxZ) / 2;
  for (let row = 0; row < grid.rows; row += 1) {
    for (let column = 0; column < grid.columns; column += 1) {
      const x = grid.origin.x + (column + 0.5) * grid.cellSize;
      const z = grid.origin.z + (row + 0.5) * grid.cellSize;
      if (Math.abs(x - centerX) <= ROAD_WIDTH / 2 || Math.abs(z - centerZ) <= ROAD_WIDTH / 2) {
        blocked[row * grid.columns + column] = 0;
      }
    }
  }
}

function isGridPositionWalkable(grid: WorldWalkabilityGrid, position: WorldPosition): boolean {
  const column = Math.floor((position.x - grid.origin.x) / grid.cellSize);
  const row = Math.floor((position.z - grid.origin.z) / grid.cellSize);
  if (column < 0 || row < 0 || column >= grid.columns || row >= grid.rows) return false;
  return grid.blocked[row * grid.columns + column] === 0;
}

interface ChunkObjectGenerationOptions {
  world: AdventureWorldDefinition;
  chunkId: string;
  bounds: WorldBounds;
  biome: WorldBiomeDefinition;
  zoneKind: WorldZoneKind;
  recommendedLevel: readonly [number, number];
  pointsOfInterest: readonly WorldPointOfInterest[];
  dungeonBossName?: string;
}

function generateChunkObjects(options: ChunkObjectGenerationOptions): {
  obstacles: WorldObstacleRenderData[];
  props: WorldPropRenderData[];
  spawnNodes: WorldSpawnNode[];
  walkability: WorldWalkabilityGrid;
} {
  const { world, chunkId, bounds, biome, zoneKind, recommendedLevel, pointsOfInterest } = options;
  const chunkSize = bounds.maxX - bounds.minX;
  const random = seededRandom(hashParts(world.seed, chunkId, 'objects'));
  const obstacleTarget = zoneKind === 'town' ? 10 : zoneKind === 'dungeonBoss' ? 7 : zoneKind === 'dungeonRoom' ? 9 : 13 + Math.floor(random() * 7);
  const obstacles: WorldObstacleRenderData[] = [];
  const props: WorldPropRenderData[] = [];
  const tintChoices = [biome.primaryColor, biome.secondaryColor, biome.ambientColor];

  for (let attempt = 0; attempt < obstacleTarget * 12 && obstacles.length < obstacleTarget; attempt += 1) {
    const position = {
      x: bounds.minX + 8 + random() * (chunkSize - 16),
      z: bounds.minZ + 8 + random() * (chunkSize - 16),
    };
    if (isPositionOnRoad(position, bounds, ROAD_WIDTH + 4)) continue;
    if (pointsOfInterest.some((poi) => Math.hypot(poi.position.x - position.x, poi.position.z - position.z) < poi.interactionRadius + 9)) continue;
    const radius = round(2.3 + random() * (zoneKind === 'town' ? 4.2 : 3.8), 2);
    if (obstacles.some((obstacle) => Math.hypot(obstacle.position.x - position.x, obstacle.position.z - position.z) < obstacle.radius + radius + 3)) continue;
    const assetKey = zoneKind === 'town'
      ? `building-${1 + Math.floor(random() * 4)}`
      : zoneKind === 'dungeonRoom' || zoneKind === 'dungeonBoss'
        ? ['dungeon-pillar', 'rubble', 'broken-wall', 'urn-cluster'][Math.floor(random() * 4)]
        : biome.propKeys[Math.floor(random() * biome.propKeys.length)];
    const shape = random() < 0.42 ? 'box' as const : 'circle' as const;
    const height = round(3 + random() * (zoneKind === 'town' ? 9 : 6), 2);
    const obstacle: WorldObstacleRenderData = {
      id: `${chunkId}:obstacle-${obstacles.length}`,
      assetKey,
      position: { ...position, y: zoneKind.startsWith('dungeon') ? 0 : biomeHeight(world.seed, position.x, position.z) },
      shape,
      radius,
      halfExtents: { x: radius, z: round(radius * (0.72 + random() * 0.55), 2) },
      height,
      blocksMovement: true,
      blocksProjectiles: assetKey !== 'reeds' && assetKey !== 'heather',
    };
    obstacles.push(obstacle);
    props.push({
      id: `${chunkId}:prop-${props.length}`,
      assetKey,
      position: { ...obstacle.position },
      rotationY: round(random() * Math.PI * 2),
      scale: {
        x: round(0.82 + random() * 0.48),
        y: round(0.85 + random() * 0.52),
        z: round(0.82 + random() * 0.48),
      },
      tint: tintChoices[Math.floor(random() * tintChoices.length)],
      castsShadow: true,
      obstacleId: obstacle.id,
    });
  }

  const decorativeTarget = zoneKind.startsWith('dungeon') ? 8 : 15;
  for (let index = 0; index < decorativeTarget; index += 1) {
    const position = {
      x: bounds.minX + 3 + random() * (chunkSize - 6),
      z: bounds.minZ + 3 + random() * (chunkSize - 6),
    };
    const assetKey = zoneKind.startsWith('dungeon')
      ? ['torch', 'debris', 'floor-rune'][Math.floor(random() * 3)]
      : `${biome.propKeys[Math.floor(random() * biome.propKeys.length)]}-small`;
    props.push({
      id: `${chunkId}:prop-${props.length}`,
      assetKey,
      position: { ...position, y: zoneKind.startsWith('dungeon') ? 0 : biomeHeight(world.seed, position.x, position.z) },
      rotationY: round(random() * Math.PI * 2),
      scale: { x: round(0.3 + random() * 0.45), y: round(0.3 + random() * 0.55), z: round(0.3 + random() * 0.45) },
      tint: tintChoices[Math.floor(random() * tintChoices.length)],
      castsShadow: false,
      obstacleId: null,
    });
  }

  const walkability = createWalkabilityGrid(bounds, chunkSize);
  for (const obstacle of obstacles) markObstacleOnGrid(walkability, obstacle);
  clearRoadCells(walkability, bounds);

  const spawnNodes: WorldSpawnNode[] = [];
  const spawnPlan: WorldSpawnKind[] = zoneKind === 'town'
    ? ['npc', 'npc', 'npc', 'ambient']
    : zoneKind === 'dungeonBoss'
      ? ['boss', 'monsterPack', 'loot']
      : zoneKind === 'dungeonRoom'
        ? ['monsterPack', 'monsterPack', 'elite', 'loot']
        : ['monsterPack', 'monsterPack', 'monsterPack', 'elite', 'ambient', 'loot'];
  for (let index = 0; index < spawnPlan.length; index += 1) {
    let position: WorldPosition | null = null;
    for (let attempt = 0; attempt < 32 && !position; attempt += 1) {
      const candidate = {
        x: bounds.minX + 10 + random() * (chunkSize - 20),
        z: bounds.minZ + 10 + random() * (chunkSize - 20),
      };
      if (isGridPositionWalkable(walkability, candidate)
        && !pointsOfInterest.some((poi) => Math.hypot(poi.position.x - candidate.x, poi.position.z - candidate.z) < poi.interactionRadius + 8)) {
        position = candidate;
      }
    }
    if (!position) position = { x: (bounds.minX + bounds.maxX) / 2, z: (bounds.minZ + bounds.maxZ) / 2 };
    const kind = spawnPlan[index];
    const bossTags = kind === 'boss' && options.dungeonBossName ? ['boss', options.dungeonBossName] : [];
    spawnNodes.push({
      id: `${chunkId}:spawn-${index}`,
      kind,
      position: { ...position, y: zoneKind.startsWith('dungeon') ? 0 : biomeHeight(world.seed, position.x, position.z) },
      radius: kind === 'boss' ? 12 : kind === 'monsterPack' ? 9 : 5,
      minCount: kind === 'monsterPack' ? 3 : 1,
      maxCount: kind === 'monsterPack' ? 6 : kind === 'ambient' ? 4 : 1,
      levelRange: recommendedLevel,
      tags: bossTags.length > 0 ? bossTags : kind === 'npc' ? ['townsperson'] : biome.monsterTags,
      respawnSeconds: kind === 'boss' ? 900 : kind === 'npc' ? 0 : kind === 'loot' ? 600 : 75 + Math.floor(random() * 60),
    });
  }

  return { obstacles, props, spawnNodes, walkability };
}

function overworldPointsOfInterest(
  world: AdventureWorldDefinition,
  coordinate: WorldChunkCoordinate,
): WorldPointOfInterest[] {
  const points: WorldPointOfInterest[] = [];
  const town = world.towns.find((candidate) => sameChunk(candidate.chunk, coordinate));
  if (town) {
    points.push({
      id: town.id, kind: 'townCenter', name: town.name,
      position: { ...town.position, y: biomeHeight(world.seed, town.position.x, town.position.z) },
      interactionRadius: 18, targetId: town.id,
    });
  }
  for (const waypoint of world.waypoints.filter((candidate) => sameChunk(candidate.chunk, coordinate))) {
    points.push({
      id: waypoint.id, kind: 'waypoint', name: waypoint.name,
      position: { ...waypoint.position, y: biomeHeight(world.seed, waypoint.position.x, waypoint.position.z) },
      interactionRadius: 7, targetId: waypoint.id,
    });
  }
  const dungeon = world.dungeons.find((candidate) => sameChunk(candidate.entranceChunk, coordinate));
  if (dungeon) {
    points.push({
      id: dungeon.id, kind: 'dungeonEntrance', name: dungeon.name,
      position: { ...dungeon.entrancePosition, y: biomeHeight(world.seed, dungeon.entrancePosition.x, dungeon.entrancePosition.z) },
      interactionRadius: 9, targetId: dungeon.id,
    });
  }
  return points;
}

export function getWorldChunkRenderData(
  world: AdventureWorldDefinition,
  coordinate: WorldChunkCoordinate,
  fogState: WorldFogState = 'visible',
): WorldChunkRenderData | null {
  const bounds = getOverworldChunkBounds(world, coordinate);
  if (!bounds) return null;
  const id = getOverworldChunkId(coordinate);
  const region = getRegionForChunk(world, coordinate);
  const biome = WORLD_BIOMES[region.biomeId];
  const pointsOfInterest = overworldPointsOfInterest(world, coordinate);
  const town = world.towns.find((candidate) => sameChunk(candidate.chunk, coordinate));
  const dungeon = world.dungeons.find((candidate) => sameChunk(candidate.entranceChunk, coordinate));
  const zoneKind: WorldZoneKind = town ? 'town' : dungeon ? 'dungeonEntrance' : 'wilderness';
  const objects = generateChunkObjects({
    world, chunkId: id, bounds, biome, zoneKind,
    recommendedLevel: region.recommendedLevel,
    pointsOfInterest,
  });
  return {
    id,
    dimension: 'overworld',
    dungeonId: null,
    dungeonFloor: 0,
    coordinate: { ...coordinate },
    origin: { x: bounds.minX, z: bounds.minZ },
    center: { x: (bounds.minX + bounds.maxX) / 2, z: (bounds.minZ + bounds.maxZ) / 2 },
    bounds,
    neighborIds: getOverworldNeighborIds(world, coordinate),
    regionId: region.id,
    biomeId: region.biomeId,
    zoneKind,
    recommendedLevel: region.recommendedLevel,
    fogState,
    terrain: createTerrainRenderData(world, biome, bounds),
    roads: createCrossRoads(id, bounds, biome.roadMaterialKey, zoneKind === 'town' ? ROAD_WIDTH + 6 : ROAD_WIDTH),
    obstacles: objects.obstacles,
    props: objects.props,
    spawnNodes: objects.spawnNodes,
    pointsOfInterest,
    walkability: objects.walkability,
  };
}

export function getDungeonDefinition(
  world: AdventureWorldDefinition,
  dungeonId: string,
): WorldDungeonDefinition | null {
  return world.dungeons.find((dungeon) => dungeon.id === dungeonId) ?? null;
}

export function getDungeonFloorDefinition(
  world: AdventureWorldDefinition,
  dungeonId: string,
  floor: number,
): WorldDungeonFloorDefinition | null {
  const dungeon = getDungeonDefinition(world, dungeonId);
  return dungeon?.floors.find((candidate) => candidate.floor === floor) ?? null;
}

function isDungeonChunkCoordinate(
  floor: WorldDungeonFloorDefinition,
  coordinate: WorldChunkCoordinate,
): boolean {
  return Number.isInteger(coordinate.x)
    && Number.isInteger(coordinate.z)
    && coordinate.x >= 0
    && coordinate.z >= 0
    && coordinate.x < floor.gridWidth
    && coordinate.z < floor.gridHeight;
}

function getDungeonChunkBounds(
  floor: WorldDungeonFloorDefinition,
  coordinate: WorldChunkCoordinate,
): WorldBounds | null {
  if (!isDungeonChunkCoordinate(floor, coordinate)) return null;
  const floorWidth = floor.gridWidth * DUNGEON_CHUNK_SIZE;
  const floorHeight = floor.gridHeight * DUNGEON_CHUNK_SIZE;
  const minX = -floorWidth / 2 + coordinate.x * DUNGEON_CHUNK_SIZE;
  const minZ = -floorHeight / 2 + coordinate.z * DUNGEON_CHUNK_SIZE;
  return { minX, minZ, maxX: minX + DUNGEON_CHUNK_SIZE, maxZ: minZ + DUNGEON_CHUNK_SIZE };
}

export function dungeonPositionToChunkCoordinate(
  floor: WorldDungeonFloorDefinition,
  position: WorldPosition,
): WorldChunkCoordinate | null {
  const minX = -(floor.gridWidth * DUNGEON_CHUNK_SIZE) / 2;
  const minZ = -(floor.gridHeight * DUNGEON_CHUNK_SIZE) / 2;
  const x = Math.floor((position.x - minX) / DUNGEON_CHUNK_SIZE);
  const z = Math.floor((position.z - minZ) / DUNGEON_CHUNK_SIZE);
  const coordinate = { x, z };
  return isDungeonChunkCoordinate(floor, coordinate) ? coordinate : null;
}

function dungeonChunkCenter(
  floor: WorldDungeonFloorDefinition,
  coordinate: WorldChunkCoordinate,
): WorldPosition {
  const bounds = getDungeonChunkBounds(floor, coordinate);
  return bounds
    ? { x: (bounds.minX + bounds.maxX) / 2, z: (bounds.minZ + bounds.maxZ) / 2 }
    : { x: 0, z: 0 };
}

function getDungeonNeighborIds(
  dungeon: WorldDungeonDefinition,
  floor: WorldDungeonFloorDefinition,
  coordinate: WorldChunkCoordinate,
): string[] {
  return [
    { x: coordinate.x - 1, z: coordinate.z },
    { x: coordinate.x + 1, z: coordinate.z },
    { x: coordinate.x, z: coordinate.z - 1 },
    { x: coordinate.x, z: coordinate.z + 1 },
  ].filter((candidate) => isDungeonChunkCoordinate(floor, candidate))
    .map((candidate) => getDungeonChunkId(dungeon.id, floor.floor, candidate));
}

function dungeonPointsOfInterest(
  dungeon: WorldDungeonDefinition,
  floor: WorldDungeonFloorDefinition,
  coordinate: WorldChunkCoordinate,
): WorldPointOfInterest[] {
  const points: WorldPointOfInterest[] = [];
  if (sameChunk(floor.entryChunk, coordinate)) {
    const position = dungeonChunkCenter(floor, coordinate);
    points.push({
      id: `${dungeon.id}:floor-${floor.floor}:entry`,
      kind: 'floorEntrance',
      name: floor.floor === 1 ? `${dungeon.name} 입구` : `${floor.name} 입구`,
      position: { x: position.x - 13, y: 0, z: position.z },
      interactionRadius: 7,
      targetId: floor.floor === 1 ? dungeon.id : `${dungeon.id}:floor-${floor.floor - 1}`,
    });
  }
  if (floor.exitChunk && sameChunk(floor.exitChunk, coordinate)) {
    const position = dungeonChunkCenter(floor, coordinate);
    points.push({
      id: `${dungeon.id}:floor-${floor.floor}:exit`,
      kind: 'floorExit',
      name: `${floor.floor + 1}층으로 내려가는 길`,
      position: { x: position.x + 13, y: 0, z: position.z },
      interactionRadius: 7,
      targetId: `${dungeon.id}:floor-${floor.floor + 1}`,
    });
  }
  if (floor.bossChunk && sameChunk(floor.bossChunk, coordinate)) {
    const position = dungeonChunkCenter(floor, coordinate);
    points.push({
      id: `${dungeon.id}:boss-gate`,
      kind: 'bossGate',
      name: `${dungeon.bossName}의 문`,
      position: { x: position.x + 12, y: 0, z: position.z },
      interactionRadius: 10,
      targetId: `${dungeon.id}:boss`,
    });
  }
  return points;
}

export function getDungeonChunkRenderData(
  world: AdventureWorldDefinition,
  dungeonId: string,
  floorNumber: number,
  coordinate: WorldChunkCoordinate,
  fogState: WorldFogState = 'visible',
): WorldChunkRenderData | null {
  const dungeon = getDungeonDefinition(world, dungeonId);
  const floor = getDungeonFloorDefinition(world, dungeonId, floorNumber);
  if (!dungeon || !floor) return null;
  const bounds = getDungeonChunkBounds(floor, coordinate);
  if (!bounds) return null;
  const id = getDungeonChunkId(dungeon.id, floor.floor, coordinate);
  const region = world.regions.find((candidate) => candidate.id === dungeon.regionId) ?? world.regions[0];
  const sourceBiome = WORLD_BIOMES[dungeon.biomeId];
  const dungeonBiome: WorldBiomeDefinition = {
    ...sourceBiome,
    materialKey: `dungeon-${dungeon.biomeId}`,
    roadMaterialKey: 'dungeon-floor-path',
    primaryColor: '#302f2b',
    secondaryColor: sourceBiome.primaryColor,
  };
  const bossRoom = Boolean(floor.bossChunk && sameChunk(floor.bossChunk, coordinate));
  const zoneKind: WorldZoneKind = bossRoom ? 'dungeonBoss' : 'dungeonRoom';
  const pointsOfInterest = dungeonPointsOfInterest(dungeon, floor, coordinate);
  const floorOffset = (floor.floor - 1) * 4;
  const recommendedLevel: readonly [number, number] = [
    Math.min(99, region.recommendedLevel[0] + floorOffset),
    Math.min(99, region.recommendedLevel[1] + floorOffset + (bossRoom ? 3 : 0)),
  ];
  const objects = generateChunkObjects({
    world, chunkId: id, bounds, biome: dungeonBiome, zoneKind, recommendedLevel,
    pointsOfInterest, dungeonBossName: dungeon.bossName,
  });
  const terrain = createTerrainRenderData(world, dungeonBiome, bounds, true);
  return {
    id,
    dimension: 'dungeon',
    dungeonId: dungeon.id,
    dungeonFloor: floor.floor,
    coordinate: { ...coordinate },
    origin: { x: bounds.minX, z: bounds.minZ },
    center: dungeonChunkCenter(floor, coordinate),
    bounds,
    neighborIds: getDungeonNeighborIds(dungeon, floor, coordinate),
    regionId: region.id,
    biomeId: dungeon.biomeId,
    zoneKind,
    recommendedLevel,
    fogState,
    terrain,
    roads: createCrossRoads(id, bounds, dungeonBiome.roadMaterialKey, 12),
    obstacles: objects.obstacles,
    props: objects.props,
    spawnNodes: objects.spawnNodes,
    pointsOfInterest,
    walkability: objects.walkability,
  };
}

export function getDungeonFloorRenderData(
  world: AdventureWorldDefinition,
  dungeonId: string,
  floorNumber: number,
  discoveredChunkIds: readonly string[] = [],
): WorldChunkRenderData[] {
  const floor = getDungeonFloorDefinition(world, dungeonId, floorNumber);
  if (!floor) return [];
  const discovered = new Set(discoveredChunkIds);
  const chunks: WorldChunkRenderData[] = [];
  for (let z = 0; z < floor.gridHeight; z += 1) {
    for (let x = 0; x < floor.gridWidth; x += 1) {
      const coordinate = { x, z };
      const id = getDungeonChunkId(dungeonId, floorNumber, coordinate);
      const chunk = getDungeonChunkRenderData(world, dungeonId, floorNumber, coordinate, discovered.has(id) ? 'discovered' : 'hidden');
      if (chunk) chunks.push(chunk);
    }
  }
  return chunks;
}

function fogStateForChunk(
  coordinate: WorldChunkCoordinate,
  center: WorldChunkCoordinate,
  revealRadius: number,
  discovered: ReadonlySet<string>,
  chunkId: string,
): WorldFogState {
  const visible = Math.max(Math.abs(coordinate.x - center.x), Math.abs(coordinate.z - center.z)) <= revealRadius;
  return visible ? 'visible' : discovered.has(chunkId) ? 'discovered' : 'hidden';
}

export function streamWorldChunksAroundPlayer(
  world: AdventureWorldDefinition,
  playerPosition: WorldPosition,
  options: WorldChunkStreamOptions = {},
): WorldChunkStreamResult {
  const center = worldToChunkCoordinate(world, playerPosition)
    ?? worldToChunkCoordinate(world, world.startingPosition)
    ?? { x: 0, z: 0 };
  const radius = integer(options.radius, DEFAULT_STREAM_RADIUS, 1, MAX_STREAM_RADIUS);
  const revealRadius = integer(options.revealRadius, 1, 0, radius);
  const discovered = new Set(options.discoveredChunkIds ?? []);
  const previous = new Set(options.previouslyActiveChunkIds ?? []);
  const chunks: WorldChunkRenderData[] = [];
  const activeChunkIds: string[] = [];
  const newlyDiscoveredChunkIds: string[] = [];

  for (let z = Math.max(0, center.z - radius); z <= Math.min(world.gridHeight - 1, center.z + radius); z += 1) {
    for (let x = Math.max(0, center.x - radius); x <= Math.min(world.gridWidth - 1, center.x + radius); x += 1) {
      const coordinate = { x, z };
      const id = getOverworldChunkId(coordinate);
      const fogState = fogStateForChunk(coordinate, center, revealRadius, discovered, id);
      if (fogState === 'visible' && !discovered.has(id)) newlyDiscoveredChunkIds.push(id);
      const chunk = getWorldChunkRenderData(world, coordinate, fogState);
      if (chunk) {
        activeChunkIds.push(id);
        chunks.push(chunk);
      }
    }
  }

  const active = new Set(activeChunkIds);
  return {
    centerChunkId: getOverworldChunkId(center),
    activeChunkIds,
    chunks,
    load: chunks.filter((chunk) => !previous.has(chunk.id)),
    retain: activeChunkIds.filter((id) => previous.has(id)),
    unload: [...previous].filter((id) => !active.has(id)),
    newlyDiscoveredChunkIds,
  };
}

export function streamDungeonChunksAroundPlayer(
  world: AdventureWorldDefinition,
  dungeonId: string,
  floorNumber: number,
  playerPosition: WorldPosition,
  options: WorldChunkStreamOptions = {},
): WorldChunkStreamResult | null {
  const floor = getDungeonFloorDefinition(world, dungeonId, floorNumber);
  if (!floor) return null;
  const center = dungeonPositionToChunkCoordinate(floor, playerPosition) ?? floor.entryChunk;
  const radius = integer(options.radius, DEFAULT_STREAM_RADIUS, 1, MAX_STREAM_RADIUS);
  const revealRadius = integer(options.revealRadius, 1, 0, radius);
  const discovered = new Set(options.discoveredChunkIds ?? []);
  const previous = new Set(options.previouslyActiveChunkIds ?? []);
  const chunks: WorldChunkRenderData[] = [];
  const activeChunkIds: string[] = [];
  const newlyDiscoveredChunkIds: string[] = [];

  for (let z = Math.max(0, center.z - radius); z <= Math.min(floor.gridHeight - 1, center.z + radius); z += 1) {
    for (let x = Math.max(0, center.x - radius); x <= Math.min(floor.gridWidth - 1, center.x + radius); x += 1) {
      const coordinate = { x, z };
      const id = getDungeonChunkId(dungeonId, floorNumber, coordinate);
      const fogState = fogStateForChunk(coordinate, center, revealRadius, discovered, id);
      if (fogState === 'visible' && !discovered.has(id)) newlyDiscoveredChunkIds.push(id);
      const chunk = getDungeonChunkRenderData(world, dungeonId, floorNumber, coordinate, fogState);
      if (chunk) {
        activeChunkIds.push(id);
        chunks.push(chunk);
      }
    }
  }
  const active = new Set(activeChunkIds);
  return {
    centerChunkId: getDungeonChunkId(dungeonId, floorNumber, center),
    activeChunkIds,
    chunks,
    load: chunks.filter((chunk) => !previous.has(chunk.id)),
    retain: activeChunkIds.filter((id) => previous.has(id)),
    unload: [...previous].filter((id) => !active.has(id)),
    newlyDiscoveredChunkIds,
  };
}

export function getNavigationCell(
  chunk: WorldChunkRenderData,
  position: WorldPosition,
): WorldNavigationCell | null {
  const grid = chunk.walkability;
  const column = Math.floor((position.x - grid.origin.x) / grid.cellSize);
  const row = Math.floor((position.z - grid.origin.z) / grid.cellSize);
  if (column < 0 || row < 0 || column >= grid.columns || row >= grid.rows) return null;
  return {
    chunkId: chunk.id,
    column,
    row,
    center: {
      x: grid.origin.x + (column + 0.5) * grid.cellSize,
      z: grid.origin.z + (row + 0.5) * grid.cellSize,
    },
    walkable: grid.blocked[row * grid.columns + column] === 0,
  };
}

export function isWorldPositionWalkable(
  world: AdventureWorldDefinition,
  position: WorldPosition,
): boolean {
  const coordinate = worldToChunkCoordinate(world, position);
  if (!coordinate) return false;
  const chunk = getWorldChunkRenderData(world, coordinate);
  const cell = chunk ? getNavigationCell(chunk, position) : null;
  return Boolean(cell?.walkable);
}

function nearestWalkableCell(
  chunks: readonly WorldChunkRenderData[],
  position: WorldPosition,
): WorldNavigationCell | null {
  let nearest: WorldNavigationCell | null = null;
  let nearestDistance = Number.POSITIVE_INFINITY;
  for (const chunk of chunks) {
    const direct = getNavigationCell(chunk, position);
    if (direct?.walkable) return direct;
    const grid = chunk.walkability;
    for (let row = 0; row < grid.rows; row += 1) {
      for (let column = 0; column < grid.columns; column += 1) {
        if (grid.blocked[row * grid.columns + column] !== 0) continue;
        const center = {
          x: grid.origin.x + (column + 0.5) * grid.cellSize,
          z: grid.origin.z + (row + 0.5) * grid.cellSize,
        };
        const distance = Math.hypot(center.x - position.x, center.z - position.z);
        if (distance < nearestDistance) {
          nearestDistance = distance;
          nearest = { chunkId: chunk.id, column, row, center, walkable: true };
        }
      }
    }
  }
  return nearest;
}

interface PathCell {
  key: string;
  x: number;
  z: number;
  center: WorldPosition;
}

function pathCellKey(x: number, z: number): string {
  return `${x}:${z}`;
}

/**
 * Finds a path over an already streamed set of chunks. Keeping this API bounded to
 * loaded chunks lets enemy AI reuse renderer streaming data without generating the world.
 */
export function findPathAcrossChunks(
  chunks: readonly WorldChunkRenderData[],
  start: WorldPosition,
  destination: WorldPosition,
  options: WorldPathOptions = {},
): WorldPosition[] {
  if (chunks.length === 0) return [];
  const cellSize = chunks[0].walkability.cellSize;
  if (chunks.some((chunk) => Math.abs(chunk.walkability.cellSize - cellSize) > 0.0001)) return [];
  const startCell = nearestWalkableCell(chunks, start);
  const destinationCell = nearestWalkableCell(chunks, destination);
  if (!startCell || !destinationCell) return [];

  const walkable = new Map<string, PathCell>();
  for (const chunk of chunks) {
    const grid = chunk.walkability;
    for (let row = 0; row < grid.rows; row += 1) {
      for (let column = 0; column < grid.columns; column += 1) {
        if (grid.blocked[row * grid.columns + column] !== 0) continue;
        const center = {
          x: grid.origin.x + (column + 0.5) * grid.cellSize,
          z: grid.origin.z + (row + 0.5) * grid.cellSize,
        };
        const globalX = Math.round(center.x / cellSize - 0.5);
        const globalZ = Math.round(center.z / cellSize - 0.5);
        const key = pathCellKey(globalX, globalZ);
        walkable.set(key, { key, x: globalX, z: globalZ, center });
      }
    }
  }

  const startX = Math.round(startCell.center.x / cellSize - 0.5);
  const startZ = Math.round(startCell.center.z / cellSize - 0.5);
  const endX = Math.round(destinationCell.center.x / cellSize - 0.5);
  const endZ = Math.round(destinationCell.center.z / cellSize - 0.5);
  const startKey = pathCellKey(startX, startZ);
  const endKey = pathCellKey(endX, endZ);
  if (!walkable.has(startKey) || !walkable.has(endKey)) return [];

  const diagonal = options.allowDiagonal !== false;
  const directions = diagonal
    ? [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]] as const
    : [[1, 0], [-1, 0], [0, 1], [0, -1]] as const;
  const maxVisitedCells = integer(options.maxVisitedCells, 25_000, 100, 250_000);
  const open = new Set<string>([startKey]);
  const cameFrom = new Map<string, string>();
  const gScore = new Map<string, number>([[startKey, 0]]);
  const fScore = new Map<string, number>([[startKey, Math.hypot(endX - startX, endZ - startZ)]]);
  let visited = 0;

  while (open.size > 0 && visited < maxVisitedCells) {
    let currentKey = '';
    let currentScore = Number.POSITIVE_INFINITY;
    for (const candidate of open) {
      const score = fScore.get(candidate) ?? Number.POSITIVE_INFINITY;
      if (score < currentScore || (score === currentScore && candidate < currentKey)) {
        currentKey = candidate;
        currentScore = score;
      }
    }
    if (!currentKey) break;
    if (currentKey === endKey) {
      const path: WorldPosition[] = [];
      let cursor: string | undefined = currentKey;
      while (cursor) {
        const cell = walkable.get(cursor);
        if (cell) path.push(cell.center);
        cursor = cameFrom.get(cursor);
      }
      return path.reverse();
    }

    open.delete(currentKey);
    visited += 1;
    const current = walkable.get(currentKey);
    if (!current) continue;
    for (const [dx, dz] of directions) {
      const neighborKey = pathCellKey(current.x + dx, current.z + dz);
      const neighbor = walkable.get(neighborKey);
      if (!neighbor) continue;
      if (dx !== 0 && dz !== 0) {
        if (!walkable.has(pathCellKey(current.x + dx, current.z)) || !walkable.has(pathCellKey(current.x, current.z + dz))) continue;
      }
      const tentative = (gScore.get(currentKey) ?? Number.POSITIVE_INFINITY) + (dx !== 0 && dz !== 0 ? Math.SQRT2 : 1);
      if (tentative >= (gScore.get(neighborKey) ?? Number.POSITIVE_INFINITY)) continue;
      cameFrom.set(neighborKey, currentKey);
      gScore.set(neighborKey, tentative);
      fScore.set(neighborKey, tentative + Math.hypot(endX - neighbor.x, endZ - neighbor.z));
      open.add(neighborKey);
    }
  }
  return [];
}

export function createWorldArenaProjection(
  center: WorldPosition,
  options: Partial<Omit<WorldArenaProjection, 'center'>> = {},
): WorldArenaProjection {
  const arenaWidth = Math.max(1, finiteNumber(options.arenaWidth, 960));
  const arenaHeight = Math.max(1, finiteNumber(options.arenaHeight, 540));
  const visibleWorldWidth = Math.max(1, finiteNumber(options.visibleWorldWidth, 192));
  const visibleWorldHeight = Math.max(
    1,
    finiteNumber(options.visibleWorldHeight, visibleWorldWidth * (arenaHeight / arenaWidth)),
  );
  return {
    center: { x: finiteNumber(center.x, 0), z: finiteNumber(center.z, 0) },
    arenaWidth,
    arenaHeight,
    visibleWorldWidth,
    visibleWorldHeight,
  };
}

export function worldToArenaCoordinates(
  position: WorldPosition,
  projection: WorldArenaProjection,
): ArenaPosition {
  return {
    x: ((position.x - projection.center.x) / projection.visibleWorldWidth + 0.5) * projection.arenaWidth,
    y: ((position.z - projection.center.z) / projection.visibleWorldHeight + 0.5) * projection.arenaHeight,
  };
}

export function arenaToWorldCoordinates(
  position: ArenaPosition,
  projection: WorldArenaProjection,
): WorldPosition {
  return {
    x: projection.center.x + (position.x / projection.arenaWidth - 0.5) * projection.visibleWorldWidth,
    z: projection.center.z + (position.y / projection.arenaHeight - 0.5) * projection.visibleWorldHeight,
  };
}

export function deriveWorldSeedFromAdventureSave(raw: unknown): string {
  if (!isRecord(raw)) return DEFAULT_WORLD_SEED;
  const identity = [
    typeof raw.name === 'string' ? raw.name : '',
    typeof raw.classId === 'string' ? raw.classId : typeof raw.job === 'string' ? raw.job : '',
    finiteNumber(raw.createdAt, 0),
    finiteNumber(raw.resetGeneration, 0),
  ].join('|');
  return `adventure-${hashString(identity).toString(36)}`;
}

function getProgressSource(raw: unknown): Record<string, unknown> {
  if (!isRecord(raw)) return {};
  if (isRecord(raw.worldProgress)) return { ...raw, ...raw.worldProgress };
  if (isRecord(raw.world)) return { ...raw, ...raw.world };
  return raw;
}

function parseDungeonChunkId(
  world: AdventureWorldDefinition,
  id: string,
): { dungeonId: string; floor: number; coordinate: WorldChunkCoordinate } | null {
  const match = /^dg:([a-zA-Z0-9_-]+):(\d+):(\d+):(\d+)$/.exec(id);
  if (!match) return null;
  const dungeonId = match[1];
  const floor = Number(match[2]);
  const coordinate = { x: Number(match[3]), z: Number(match[4]) };
  const floorDefinition = getDungeonFloorDefinition(world, dungeonId, floor);
  if (!floorDefinition || !isDungeonChunkCoordinate(floorDefinition, coordinate)) return null;
  return { dungeonId, floor, coordinate };
}

export function isValidWorldChunkId(world: AdventureWorldDefinition, id: string): boolean {
  return Boolean(parseOverworldChunkId(world, id) || parseDungeonChunkId(world, id));
}

function sanitizeUniqueIds(
  value: unknown,
  predicate: (id: string) => boolean,
  limit: number,
): string[] {
  if (!Array.isArray(value)) return [];
  const result: string[] = [];
  const seen = new Set<string>();
  for (const candidate of value) {
    if (typeof candidate !== 'string' || candidate.length > 120 || seen.has(candidate) || !predicate(candidate)) continue;
    seen.add(candidate);
    result.push(candidate);
    if (result.length >= limit) break;
  }
  return result;
}

function sanitizeOverworldPosition(
  world: AdventureWorldDefinition,
  value: unknown,
): WorldPosition {
  const rawPosition = isRecord(value) ? value : {};
  const position = {
    x: clamp(finiteNumber(rawPosition.x, world.startingPosition.x), world.bounds.minX + 0.001, world.bounds.maxX - 0.001),
    z: clamp(finiteNumber(rawPosition.z ?? rawPosition.y, world.startingPosition.z), world.bounds.minZ + 0.001, world.bounds.maxZ - 0.001),
  };
  const coordinate = worldToChunkCoordinate(world, position);
  const chunk = coordinate ? getWorldChunkRenderData(world, coordinate) : null;
  const cell = chunk ? getNavigationCell(chunk, position) : null;
  return cell?.walkable ? position : nearestWalkableCell(chunk ? [chunk] : [], position)?.center ?? world.startingPosition;
}

function sanitizeDungeonPosition(
  world: AdventureWorldDefinition,
  dungeon: WorldDungeonDefinition,
  floor: WorldDungeonFloorDefinition,
  value: unknown,
): WorldPosition {
  const rawPosition = isRecord(value) ? value : {};
  const fallback = dungeonChunkCenter(floor, floor.entryChunk);
  const minX = -(floor.gridWidth * DUNGEON_CHUNK_SIZE) / 2;
  const minZ = -(floor.gridHeight * DUNGEON_CHUNK_SIZE) / 2;
  const position = {
    x: clamp(finiteNumber(rawPosition.x, fallback.x), minX + 0.001, -minX - 0.001),
    z: clamp(finiteNumber(rawPosition.z ?? rawPosition.y, fallback.z), minZ + 0.001, -minZ - 0.001),
  };
  const coordinate = dungeonPositionToChunkCoordinate(floor, position);
  const chunk = coordinate ? getDungeonChunkRenderData(world, dungeon.id, floor.floor, coordinate) : null;
  const cell = chunk ? getNavigationCell(chunk, position) : null;
  return cell?.walkable ? position : nearestWalkableCell(chunk ? [chunk] : [], position)?.center ?? fallback;
}

export function createInitialAdventureWorldProgress(
  seedValue: string | number = DEFAULT_WORLD_SEED,
): AdventureWorldProgress {
  const world = createAdventureWorld(seedValue);
  const initialStream = streamWorldChunksAroundPlayer(world, world.startingPosition, { radius: 1, revealRadius: 1 });
  return {
    worldSeed: world.seed,
    worldPlayerPosition: { ...world.startingPosition },
    discoveredChunkIds: [...initialStream.newlyDiscoveredChunkIds],
    unlockedWaypointIds: [world.startingWaypointId],
    activeDungeonId: null,
    activeDungeonFloor: 0,
  };
}

export function sanitizeAdventureWorldProgress(
  raw: unknown,
  fallbackSeed?: string | number,
): AdventureWorldProgress {
  const source = getProgressSource(raw);
  const seedFallback = fallbackSeed == null ? deriveWorldSeedFromAdventureSave(raw) : normalizeSeed(fallbackSeed);
  const worldSeed = normalizeSeed(source.worldSeed ?? source.seed, seedFallback);
  const world = createAdventureWorld(worldSeed);
  const dungeonCandidate = typeof source.activeDungeonId === 'string'
    ? source.activeDungeonId
    : typeof source.dungeonId === 'string'
      ? source.dungeonId
      : null;
  const activeDungeon = dungeonCandidate ? getDungeonDefinition(world, dungeonCandidate) : null;
  const activeDungeonFloor = activeDungeon
    ? integer(source.activeDungeonFloor ?? source.dungeonFloor, 1, 1, activeDungeon.floors.length)
    : 0;
  const floor = activeDungeon ? getDungeonFloorDefinition(world, activeDungeon.id, activeDungeonFloor) : null;
  const rawPosition = source.worldPlayerPosition ?? source.playerWorldPosition ?? source.position;
  const worldPlayerPosition = activeDungeon && floor
    ? sanitizeDungeonPosition(world, activeDungeon, floor, rawPosition)
    : sanitizeOverworldPosition(world, rawPosition);
  const discoveredRaw = source.discoveredChunkIds ?? source.discoveredWorldChunkIds;
  const discoveredChunkIds = sanitizeUniqueIds(
    discoveredRaw,
    (id) => isValidWorldChunkId(world, id),
    MAX_DISCOVERED_CHUNKS,
  );
  const validWaypointIds = new Set(world.waypoints.map((waypoint) => waypoint.id));
  const unlockedWaypointIds = sanitizeUniqueIds(
    source.unlockedWaypointIds ?? source.waypoints,
    (id) => validWaypointIds.has(id),
    world.waypoints.length,
  );

  if (!unlockedWaypointIds.includes(world.startingWaypointId)) unlockedWaypointIds.unshift(world.startingWaypointId);
  const currentChunkId = activeDungeon && floor
    ? getDungeonChunkId(
      activeDungeon.id,
      floor.floor,
      dungeonPositionToChunkCoordinate(floor, worldPlayerPosition) ?? floor.entryChunk,
    )
    : getOverworldChunkId(worldToChunkCoordinate(world, worldPlayerPosition) ?? { x: 0, z: 0 });
  const startingChunkId = getOverworldChunkId(worldToChunkCoordinate(world, world.startingPosition) ?? { x: 0, z: 0 });
  for (const requiredId of [startingChunkId, currentChunkId]) {
    if (!discoveredChunkIds.includes(requiredId) && discoveredChunkIds.length < MAX_DISCOVERED_CHUNKS) discoveredChunkIds.push(requiredId);
  }

  return {
    worldSeed: world.seed,
    worldPlayerPosition,
    discoveredChunkIds,
    unlockedWaypointIds,
    activeDungeonId: activeDungeon?.id ?? null,
    activeDungeonFloor,
  };
}

export function withAdventureWorldProgress<T extends object>(
  save: T,
  progressRaw: unknown = save,
  fallbackSeed?: string | number,
): WorldEnabledAdventureSave<T> {
  return {
    ...save,
    ...sanitizeAdventureWorldProgress(progressRaw, fallbackSeed),
  };
}

export function updateWorldDiscovery(
  progressRaw: unknown,
  position: WorldPosition,
  radius = 1,
): WorldProgressUpdateResult {
  const progress = sanitizeAdventureWorldProgress(progressRaw);
  const world = createAdventureWorld(progress.worldSeed);
  const discovered = new Set(progress.discoveredChunkIds);
  let stream: WorldChunkStreamResult;
  let worldPlayerPosition: WorldPosition;

  if (progress.activeDungeonId) {
    const dungeon = getDungeonDefinition(world, progress.activeDungeonId);
    const floor = dungeon && getDungeonFloorDefinition(world, dungeon.id, progress.activeDungeonFloor);
    if (dungeon && floor) {
      worldPlayerPosition = sanitizeDungeonPosition(world, dungeon, floor, position);
      stream = streamDungeonChunksAroundPlayer(world, dungeon.id, floor.floor, worldPlayerPosition, {
        radius: clamp(radius + 1, 1, MAX_STREAM_RADIUS), revealRadius: radius,
        discoveredChunkIds: progress.discoveredChunkIds,
      }) as WorldChunkStreamResult;
    } else {
      worldPlayerPosition = sanitizeOverworldPosition(world, position);
      stream = streamWorldChunksAroundPlayer(world, worldPlayerPosition, {
        radius: clamp(radius + 1, 1, MAX_STREAM_RADIUS), revealRadius: radius,
        discoveredChunkIds: progress.discoveredChunkIds,
      });
    }
  } else {
    worldPlayerPosition = sanitizeOverworldPosition(world, position);
    stream = streamWorldChunksAroundPlayer(world, worldPlayerPosition, {
      radius: clamp(radius + 1, 1, MAX_STREAM_RADIUS), revealRadius: radius,
      discoveredChunkIds: progress.discoveredChunkIds,
    });
  }
  for (const id of stream.newlyDiscoveredChunkIds) {
    if (discovered.size >= MAX_DISCOVERED_CHUNKS) break;
    discovered.add(id);
  }
  return {
    progress: { ...progress, worldPlayerPosition, discoveredChunkIds: [...discovered] },
    stream,
  };
}

export function unlockWorldWaypoint(
  progressRaw: unknown,
  waypointId: string,
): AdventureWorldProgress {
  const progress = sanitizeAdventureWorldProgress(progressRaw);
  const world = createAdventureWorld(progress.worldSeed);
  if (!world.waypoints.some((waypoint) => waypoint.id === waypointId)) return progress;
  if (progress.unlockedWaypointIds.includes(waypointId)) return progress;
  return { ...progress, unlockedWaypointIds: [...progress.unlockedWaypointIds, waypointId] };
}

export function travelToWorldWaypoint(
  progressRaw: unknown,
  waypointId: string,
): AdventureWorldProgress {
  const progress = sanitizeAdventureWorldProgress(progressRaw);
  if (!progress.unlockedWaypointIds.includes(waypointId)) return progress;
  const world = createAdventureWorld(progress.worldSeed);
  const waypoint = world.waypoints.find((candidate) => candidate.id === waypointId);
  if (!waypoint) return progress;
  return {
    ...progress,
    activeDungeonId: null,
    activeDungeonFloor: 0,
    worldPlayerPosition: sanitizeOverworldPosition(world, waypoint.position),
  };
}

export function enterWorldDungeon(
  progressRaw: unknown,
  dungeonId: string,
): AdventureWorldProgress {
  const progress = sanitizeAdventureWorldProgress(progressRaw);
  const world = createAdventureWorld(progress.worldSeed);
  const dungeon = getDungeonDefinition(world, dungeonId);
  if (!dungeon) return progress;
  const floor = dungeon.floors[0];
  return {
    ...progress,
    activeDungeonId: dungeon.id,
    activeDungeonFloor: floor.floor,
    worldPlayerPosition: dungeonChunkCenter(floor, floor.entryChunk),
  };
}

export function changeWorldDungeonFloor(
  progressRaw: unknown,
  floorNumber: number,
): AdventureWorldProgress {
  const progress = sanitizeAdventureWorldProgress(progressRaw);
  if (!progress.activeDungeonId) return progress;
  const world = createAdventureWorld(progress.worldSeed);
  const floor = getDungeonFloorDefinition(world, progress.activeDungeonId, floorNumber);
  if (!floor) return progress;
  return {
    ...progress,
    activeDungeonFloor: floor.floor,
    worldPlayerPosition: dungeonChunkCenter(floor, floor.entryChunk),
  };
}

export function leaveWorldDungeon(progressRaw: unknown): AdventureWorldProgress {
  const progress = sanitizeAdventureWorldProgress(progressRaw);
  if (!progress.activeDungeonId) return progress;
  const world = createAdventureWorld(progress.worldSeed);
  const dungeon = getDungeonDefinition(world, progress.activeDungeonId);
  return {
    ...progress,
    activeDungeonId: null,
    activeDungeonFloor: 0,
    worldPlayerPosition: dungeon ? { ...dungeon.entrancePosition } : { ...world.startingPosition },
  };
}

export class AdventureWorldRuntime {
  readonly world: AdventureWorldDefinition;
  private readonly maxCachedChunks: number;
  private readonly chunkCache = new Map<string, WorldChunkRenderData>();

  constructor(
    worldOrSeed: AdventureWorldDefinition | string | number = DEFAULT_WORLD_SEED,
    options: AdventureWorldRuntimeOptions = {},
  ) {
    this.world = isRecord(worldOrSeed) && Array.isArray(worldOrSeed.regions)
      ? worldOrSeed as unknown as AdventureWorldDefinition
      : createAdventureWorld(worldOrSeed as string | number);
    this.maxCachedChunks = integer(options.maxCachedChunks, 96, 9, 256);
  }

  private remember(chunk: WorldChunkRenderData): WorldChunkRenderData {
    const cached = { ...chunk, fogState: 'visible' as const };
    this.chunkCache.delete(chunk.id);
    this.chunkCache.set(chunk.id, cached);
    while (this.chunkCache.size > this.maxCachedChunks) {
      const oldest = this.chunkCache.keys().next().value as string | undefined;
      if (!oldest) break;
      this.chunkCache.delete(oldest);
    }
    return cached;
  }

  private cached(id: string, fogState: WorldFogState): WorldChunkRenderData | null {
    const chunk = this.chunkCache.get(id);
    if (!chunk) return null;
    this.chunkCache.delete(id);
    this.chunkCache.set(id, chunk);
    return fogState === chunk.fogState ? chunk : { ...chunk, fogState };
  }

  getOverworldChunk(
    coordinate: WorldChunkCoordinate,
    fogState: WorldFogState = 'visible',
  ): WorldChunkRenderData | null {
    const id = getOverworldChunkId(coordinate);
    const cached = this.cached(id, fogState);
    if (cached) return cached;
    const generated = getWorldChunkRenderData(this.world, coordinate, fogState);
    if (!generated) return null;
    const remembered = this.remember(generated);
    return fogState === 'visible' ? remembered : { ...remembered, fogState };
  }

  getDungeonChunk(
    dungeonId: string,
    floor: number,
    coordinate: WorldChunkCoordinate,
    fogState: WorldFogState = 'visible',
  ): WorldChunkRenderData | null {
    const id = getDungeonChunkId(dungeonId, floor, coordinate);
    const cached = this.cached(id, fogState);
    if (cached) return cached;
    const generated = getDungeonChunkRenderData(this.world, dungeonId, floor, coordinate, fogState);
    if (!generated) return null;
    const remembered = this.remember(generated);
    return fogState === 'visible' ? remembered : { ...remembered, fogState };
  }

  streamOverworld(
    playerPosition: WorldPosition,
    options: WorldChunkStreamOptions = {},
  ): WorldChunkStreamResult {
    const center = worldToChunkCoordinate(this.world, playerPosition)
      ?? worldToChunkCoordinate(this.world, this.world.startingPosition)
      ?? { x: 0, z: 0 };
    const radius = integer(options.radius, DEFAULT_STREAM_RADIUS, 1, MAX_STREAM_RADIUS);
    const revealRadius = integer(options.revealRadius, 1, 0, radius);
    const discovered = new Set(options.discoveredChunkIds ?? []);
    const previous = new Set(options.previouslyActiveChunkIds ?? []);
    const chunks: WorldChunkRenderData[] = [];
    const newlyDiscoveredChunkIds: string[] = [];
    for (let z = Math.max(0, center.z - radius); z <= Math.min(this.world.gridHeight - 1, center.z + radius); z += 1) {
      for (let x = Math.max(0, center.x - radius); x <= Math.min(this.world.gridWidth - 1, center.x + radius); x += 1) {
        const coordinate = { x, z };
        const id = getOverworldChunkId(coordinate);
        const fogState = fogStateForChunk(coordinate, center, revealRadius, discovered, id);
        if (fogState === 'visible' && !discovered.has(id)) newlyDiscoveredChunkIds.push(id);
        const chunk = this.getOverworldChunk(coordinate, fogState);
        if (chunk) chunks.push(chunk);
      }
    }
    return this.buildStreamResult(getOverworldChunkId(center), chunks, previous, newlyDiscoveredChunkIds);
  }

  streamDungeon(
    dungeonId: string,
    floorNumber: number,
    playerPosition: WorldPosition,
    options: WorldChunkStreamOptions = {},
  ): WorldChunkStreamResult | null {
    const floor = getDungeonFloorDefinition(this.world, dungeonId, floorNumber);
    if (!floor) return null;
    const center = dungeonPositionToChunkCoordinate(floor, playerPosition) ?? floor.entryChunk;
    const radius = integer(options.radius, DEFAULT_STREAM_RADIUS, 1, MAX_STREAM_RADIUS);
    const revealRadius = integer(options.revealRadius, 1, 0, radius);
    const discovered = new Set(options.discoveredChunkIds ?? []);
    const previous = new Set(options.previouslyActiveChunkIds ?? []);
    const chunks: WorldChunkRenderData[] = [];
    const newlyDiscoveredChunkIds: string[] = [];
    for (let z = Math.max(0, center.z - radius); z <= Math.min(floor.gridHeight - 1, center.z + radius); z += 1) {
      for (let x = Math.max(0, center.x - radius); x <= Math.min(floor.gridWidth - 1, center.x + radius); x += 1) {
        const coordinate = { x, z };
        const id = getDungeonChunkId(dungeonId, floorNumber, coordinate);
        const fogState = fogStateForChunk(coordinate, center, revealRadius, discovered, id);
        if (fogState === 'visible' && !discovered.has(id)) newlyDiscoveredChunkIds.push(id);
        const chunk = this.getDungeonChunk(dungeonId, floorNumber, coordinate, fogState);
        if (chunk) chunks.push(chunk);
      }
    }
    return this.buildStreamResult(
      getDungeonChunkId(dungeonId, floorNumber, center),
      chunks,
      previous,
      newlyDiscoveredChunkIds,
    );
  }

  private buildStreamResult(
    centerChunkId: string,
    chunks: readonly WorldChunkRenderData[],
    previous: ReadonlySet<string>,
    newlyDiscoveredChunkIds: readonly string[],
  ): WorldChunkStreamResult {
    const activeChunkIds = chunks.map((chunk) => chunk.id);
    const active = new Set(activeChunkIds);
    return {
      centerChunkId,
      activeChunkIds,
      chunks,
      load: chunks.filter((chunk) => !previous.has(chunk.id)),
      retain: activeChunkIds.filter((id) => previous.has(id)),
      unload: [...previous].filter((id) => !active.has(id)),
      newlyDiscoveredChunkIds,
    };
  }

  get cacheSize(): number {
    return this.chunkCache.size;
  }

  clear(): void {
    this.chunkCache.clear();
  }
}

export function createAdventureWorldRuntime(
  worldOrSeed: AdventureWorldDefinition | string | number = DEFAULT_WORLD_SEED,
  options: AdventureWorldRuntimeOptions = {},
): AdventureWorldRuntime {
  return new AdventureWorldRuntime(worldOrSeed, options);
}
