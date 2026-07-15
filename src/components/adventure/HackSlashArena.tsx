'use client';

import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Crosshair,
  RotateCcw,
  ShieldAlert,
  Sparkles,
  Swords,
  Zap,
} from 'lucide-react';
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import {
  CLASS_DEFINITIONS,
  ELITE_AFFIX_IDS,
  ELITE_AFFIX_LABELS,
  ENEMY_DEFINITIONS,
  REGION_DEFINITIONS,
  type AdventureElement,
  type AdventureCombatModifiers,
  type ArenaCheckpointState,
  type CharacterClassId,
  type EliteAffix,
  type EquipmentRarity,
  type RegionId,
} from '@/lib/adventure';
import HackSlashArena3D, {
  type HackSlashArena3DSnapshot,
} from './HackSlashArena3D';
import {
  createAdventureWorldRuntime,
  createWorldArenaProjection,
  getAdventureRegionFrontierPosition,
  getOverworldChunkId,
  worldToChunkCoordinate,
  type WorldArenaProjection,
  type WorldChunkRenderData,
  type WorldObstacleRenderData,
} from '@/lib/adventureWorld';
import {
  ARENA_UNIT_FOR_ENEMY,
  cancelFuturePendingImpacts,
  getMeleeWeaponReach,
  isFuturePendingImpact,
  selectForwardMeleeTarget,
} from './HackSlashArena.logic';
import styles from './HackSlashArena.module.css';

const WORLD_WIDTH = 960;
const WORLD_HEIGHT = 540;
const PLAYABLE_BOTTOM = 390;
const PLAYER_RADIUS = 29;
const ENEMY_RADIUS = 25;
const RENDER_INTERVAL = 1000 / 30;
const WORLD_UNITS_PER_ARENA_PIXEL = 1 / 5;
const REBASE_X_MIN = WORLD_WIDTH * 0.3;
const REBASE_X_MAX = WORLD_WIDTH * 0.7;
const REBASE_Y_MIN = WORLD_HEIGHT * 0.32;
const REBASE_Y_MAX = WORLD_HEIGHT * 0.68;
const FIELD_TARGET_POPULATION = 9;
const FIELD_RESPAWN_MIN_MS = 650;
const FIELD_RESPAWN_MAX_MS = 1250;
const FIELD_DESPAWN_DISTANCE = 820;
const PLAYER_HIT_RECOVERY_MS = 360;
const ENEMY_HIT_RECOVERY_MS = 360;

export type ArenaDirection =
  | 'south'
  | 'southwest'
  | 'west'
  | 'northwest'
  | 'north'
  | 'northeast'
  | 'east'
  | 'southeast';
export type ArenaAnimation = 'idle' | 'walk' | 'attack' | 'skill1' | 'skill2' | 'hit' | 'death';
export type ArenaUnitId = CharacterClassId
  | 'slime'
  | 'boar'
  | 'bandit'
  | 'sentinel'
  | 'drake'
  | 'demon'
  | 'wolf'
  | 'spider'
  | 'treant'
  | 'gargoyle'
  | 'golem';
export type ArenaProjectileId = 'arrow' | 'arcane' | 'fire';
export type ArenaEffectId = 'slash' | 'arrow' | 'nova' | 'impact' | 'loot' | 'heal';
export type ArenaSkillKind = 'melee' | 'projectile' | 'area' | 'dash';

export interface ArenaSkillLoadout {
  id: string;
  name: string;
  kind: ArenaSkillKind;
  damageMultiplier: number;
  range: number;
  cooldownMs?: number;
  cooldown?: number;
  animationKey: string;
  projectileKey?: string | null;
  effectKey?: string;
  projectileCount?: number;
  pierce?: number;
  healingRatio?: number;
  hotkey?: string;
  unlockLevel?: number;
  disabled?: boolean;
}

export interface ArenaKillEvent {
  runId: string;
  checkpoint: number;
  enemyId: string;
  elite: boolean;
  boss: boolean;
  affixes: EliteAffix[];
  wave: number;
  totalWaves: number;
  expeditionComplete: boolean;
  damageTaken: number;
  damageDealt: number;
  remainingHp: number;
}

export interface ArenaDefeatEvent {
  runId: string;
  checkpoint: number;
  wave: number;
  totalWaves: number;
  kills: number;
  damageTaken: number;
  damageDealt: number;
}

export interface HackSlashArenaProps {
  classId: CharacterClassId;
  playerName: string;
  level: number;
  hp: number;
  maxHp: number;
  attack: number;
  defense: number;
  crit?: number;
  /** Multipliers drive both simulation timings and the matching 3D animation timeline. */
  attackSpeed?: number;
  castSpeed?: number;
  moveSpeed?: number;
  projectileSpeed?: number;
  combatModifiers?: AdventureCombatModifiers;
  worldSeed?: string;
  regionId: RegionId;
  enemyIds?: readonly string[];
  skills?: readonly ArenaSkillLoadout[];
  paused?: boolean;
  initialCheckpoint?: ArenaCheckpointState | null;
  equippedWeapon?: {
    itemKey: string;
    rarity: EquipmentRarity;
    classId: CharacterClassId;
  } | null;
  onEnemyDefeated?: (event: ArenaKillEvent) => void;
  onPlayerDefeated?: (event: ArenaDefeatEvent) => void;
  onRunExited?: (event: ArenaDefeatEvent) => void;
}

type MoveInput = 'up' | 'down' | 'left' | 'right';
type ActionInput = { type: 'attack' } | { type: 'skill'; skillId: string };
type FxKind = ArenaEffectId;

interface ArenaConfig {
  classId: CharacterClassId;
  playerName: string;
  level: number;
  hp: number;
  maxHp: number;
  attack: number;
  defense: number;
  crit: number;
  attackSpeed: number;
  castSpeed: number;
  moveSpeed: number;
  projectileSpeed: number;
  meleeReach: number;
  combatModifiers: AdventureCombatModifiers | null;
  worldMinX: number;
  worldMaxX: number;
  worldMinZ: number;
  worldMaxZ: number;
  worldCollisionObstacles: readonly WorldObstacleRenderData[];
  regionId: RegionId;
  enemyIds: readonly string[];
  skills: readonly ArenaSkillLoadout[];
  paused: boolean;
}

interface ActorAnimationState {
  animation: ArenaAnimation;
  animationStartedAt: number;
  animationDurationMs: number;
  animationImpactAt: number | null;
  animationRate: number;
  direction: ArenaDirection;
}

interface ArenaEnemy extends ActorAnimationState {
  id: string;
  enemyId: string;
  unitId: ArenaUnitId;
  name: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  hp: number;
  maxHp: number;
  damage: number;
  speed: number;
  awarenessRange: number;
  engaged: boolean;
  elite: boolean;
  boss: boolean;
  affixes: EliteAffix[];
  attackKind: 'melee' | 'arcane' | 'fire';
  nextAttackAt: number;
  pendingAttackAt: number | null;
  pendingAimX: number;
  pendingAimY: number;
  hurtUntil: number;
  attackUntil: number;
  deadAt: number | null;
}

interface ArenaProjectile {
  id: number;
  kind: ArenaProjectileId;
  owner: string;
  team: 'friendly' | 'hostile';
  startedAt: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  damage: number;
  element: AdventureElement;
  canProc: boolean;
  radius: number;
  expiresAt: number;
  pierce: number;
  hitIds: Set<string>;
}

interface ArenaFx {
  id: number;
  kind: FxKind;
  source: 'player' | 'enemy' | 'system';
  startedAt: number;
  x: number;
  y: number;
  angle: number;
  expiresAt: number;
  size: number;
}

interface FloatingText {
  id: number;
  x: number;
  y: number;
  text: string;
  tone: 'damage' | 'player' | 'elite' | 'heal';
  expiresAt: number;
}

interface PendingPlayerAction {
  id: number;
  executeAt: number;
  action: ActionInput;
  classId: CharacterClassId;
  angle: number;
  aimX: number;
  aimY: number;
  baseDamage: number;
  damageScale: number;
  canProc: boolean;
  projectileSpeed: number;
  skill?: ArenaSkillLoadout;
}

interface ArenaRuntime {
  runId: string;
  checkpoint: number;
  kills: number;
  damageSinceCheckpoint: number;
  damageDealtSinceCheckpoint: number;
  player: ActorAnimationState & {
    x: number;
    y: number;
    vx: number;
    vy: number;
    hp: number;
    maxHp: number;
    nextAttackAt: number;
    skillReadyAt: Record<string, number>;
    attackUntil: number;
    hurtUntil: number;
    invulnerableUntil: number;
    dead: boolean;
  };
  aimX: number;
  aimY: number;
  moveTargetX: number | null;
  moveTargetY: number | null;
  attackTargetId: string | null;
  enemies: ArenaEnemy[];
  projectiles: ArenaProjectile[];
  effects: ArenaFx[];
  floatingTexts: FloatingText[];
  pendingActions: PendingPlayerAction[];
  nextSpawnAt: number | null;
  bossAnnouncedId: string | null;
  announcement: string;
  announcementUntil: number;
  entitySequence: number;
  lastFrameAt: number;
  worldCenterX: number;
  worldCenterZ: number;
}

interface ArenaSnapshot {
  now: number;
  runId: string;
  kills: number;
  announcement: string;
  player: ArenaRuntime['player'];
  aimX: number;
  aimY: number;
  enemies: ArenaEnemy[];
  projectiles: Array<Omit<ArenaProjectile, 'hitIds'>>;
  effects: ArenaFx[];
  floatingTexts: FloatingText[];
}

interface ArenaWorldScene {
  projection: WorldArenaProjection;
  chunks: readonly WorldChunkRenderData[];
  centerChunkId: string;
  arenaOffsetX: number;
  arenaOffsetY: number;
}

interface ArenaWorldSceneCache extends ArenaWorldScene {
  seed: string;
  activeChunkIds: readonly string[];
}

const DEFAULT_SKILL_HOTKEYS = ['KeyQ', 'KeyE', 'KeyR', 'KeyF', 'Digit1', 'Digit2'] as const;

function defaultSkills(classId: CharacterClassId): ArenaSkillLoadout[] {
  const definitions = CLASS_DEFINITIONS[classId].skills;
  if (classId === 'vanguard') return [
    { id: 'skill1', name: definitions.skill1.name, kind: 'melee', damageMultiplier: 1.5, range: 176, cooldownMs: 3600, animationKey: 'skill1', effectKey: 'nova', hotkey: 'KeyQ', unlockLevel: definitions.skill1.unlockLevel },
    { id: 'skill2', name: definitions.skill2.name, kind: 'area', damageMultiplier: 1.25, range: 215, cooldownMs: 6800, animationKey: 'skill2', effectKey: 'heal', healingRatio: 0.1, hotkey: 'KeyE', unlockLevel: definitions.skill2.unlockLevel },
  ];
  if (classId === 'ranger') return [
    { id: 'skill1', name: definitions.skill1.name, kind: 'projectile', damageMultiplier: 0.86, range: 560, cooldownMs: 3600, animationKey: 'skill1', projectileKey: 'fan-arrow', projectileCount: 3, pierce: 1, hotkey: 'KeyQ', unlockLevel: definitions.skill1.unlockLevel },
    { id: 'skill2', name: definitions.skill2.name, kind: 'projectile', damageMultiplier: 1.12, range: 620, cooldownMs: 6800, animationKey: 'skill2', projectileKey: 'piercing-arrow', projectileCount: 5, pierce: 4, hotkey: 'KeyE', unlockLevel: definitions.skill2.unlockLevel },
  ];
  return [
    { id: 'skill1', name: definitions.skill1.name, kind: 'projectile', damageMultiplier: 1.85, range: 450, cooldownMs: 3600, animationKey: 'skill1', projectileKey: 'arcane', pierce: 3, effectKey: 'nova', hotkey: 'KeyQ', unlockLevel: definitions.skill1.unlockLevel },
    { id: 'skill2', name: definitions.skill2.name, kind: 'area', damageMultiplier: 2.2, range: 185, cooldownMs: 6800, animationKey: 'skill2', effectKey: 'star-meteor', healingRatio: 0.06, hotkey: 'KeyE', unlockLevel: definitions.skill2.unlockLevel },
  ];
}

const DIRECTION_VECTOR: Record<ArenaDirection, { x: number; y: number }> = {
  south: { x: 0, y: 1 },
  southwest: { x: -Math.SQRT1_2, y: Math.SQRT1_2 },
  west: { x: -1, y: 0 },
  northwest: { x: -Math.SQRT1_2, y: -Math.SQRT1_2 },
  north: { x: 0, y: -1 },
  northeast: { x: Math.SQRT1_2, y: -Math.SQRT1_2 },
  east: { x: 1, y: 0 },
  southeast: { x: Math.SQRT1_2, y: Math.SQRT1_2 },
};

function createRunId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return `arena-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function playbackRate(value: number | undefined) {
  return clamp(Number.isFinite(value) ? value! : 1, 0.35, 4);
}

function magnitude(x: number, y: number) {
  return Math.sqrt(x * x + y * y);
}

function directionFromVector(x: number, y: number, fallback: ArenaDirection): ArenaDirection {
  if (Math.abs(x) < 0.01 && Math.abs(y) < 0.01) return fallback;
  const octant = (Math.round(Math.atan2(y, x) / (Math.PI / 4)) + 8) % 8;
  return (['east', 'southeast', 'south', 'southwest', 'west', 'northwest', 'north', 'northeast'] as const)[octant];
}

function animationForActor(
  dead: boolean,
  now: number,
  hurtUntil: number,
  attackUntil: number,
  vx: number,
  vy: number,
  current: ArenaAnimation,
): ArenaAnimation {
  if (dead) return 'death';
  if (now < hurtUntil) return 'hit';
  if (now < attackUntil && (current === 'attack' || current === 'skill1' || current === 'skill2')) return current;
  return magnitude(vx, vy) > 1 ? 'walk' : 'idle';
}

function setAnimation(
  actor: ActorAnimationState,
  animation: ArenaAnimation,
  now: number,
  timing?: { durationMs: number; impactAt?: number | null; rate?: number },
) {
  if (actor.animation === animation && !timing) return;
  actor.animation = animation;
  actor.animationStartedAt = now;
  actor.animationDurationMs = Math.max(1, timing?.durationMs ?? (animation === 'death' ? 1000 : 800));
  actor.animationImpactAt = timing?.impactAt ?? null;
  actor.animationRate = playbackRate(timing?.rate);
}

function interruptPlayerWindup(runtime: ArenaRuntime, now: number) {
  const cancellation = cancelFuturePendingImpacts(runtime.pendingActions, now);
  if (cancellation.canceledCount === 0) return false;
  runtime.pendingActions = cancellation.retained;
  runtime.player.attackUntil = now;
  runtime.player.animationImpactAt = null;
  return true;
}

function interruptEnemyWindup(enemy: ArenaEnemy, now: number) {
  if (!isFuturePendingImpact(enemy.pendingAttackAt, now)) return false;
  enemy.pendingAttackAt = null;
  enemy.pendingAimX = enemy.x;
  enemy.pendingAimY = enemy.y;
  enemy.attackUntil = now;
  enemy.animationImpactAt = null;
  enemy.nextAttackAt = Math.max(enemy.nextAttackAt, enemy.hurtUntil);
  return true;
}

function makeInitialRuntime(config: ArenaConfig): ArenaRuntime {
  return {
    runId: 'pending',
    checkpoint: 0,
    kills: 0,
    damageSinceCheckpoint: 0,
    damageDealtSinceCheckpoint: 0,
    player: {
      x: WORLD_WIDTH / 2,
      y: WORLD_HEIGHT / 2,
      vx: 0,
      vy: 0,
      hp: clamp(config.hp, 1, config.maxHp),
      maxHp: config.maxHp,
      nextAttackAt: 0,
      skillReadyAt: {},
      attackUntil: 0,
      hurtUntil: 0,
      invulnerableUntil: 0,
      dead: false,
      animation: 'idle',
      animationStartedAt: 0,
      animationDurationMs: 1000,
      animationImpactAt: null,
      animationRate: 1,
      direction: 'south',
    },
    aimX: WORLD_WIDTH / 2 + 100,
    aimY: WORLD_HEIGHT / 2,
    moveTargetX: null,
    moveTargetY: null,
    attackTargetId: null,
    enemies: [],
    projectiles: [],
    effects: [],
    floatingTexts: [],
    pendingActions: [],
    nextSpawnAt: null,
    bossAnnouncedId: null,
    announcement: '',
    announcementUntil: 0,
    entitySequence: 0,
    lastFrameAt: 0,
    worldCenterX: 0,
    worldCenterZ: 0,
  };
}

function makeSnapshot(runtime: ArenaRuntime, now: number): ArenaSnapshot {
  return {
    now,
    runId: runtime.runId,
    kills: runtime.kills,
    announcement: now < runtime.announcementUntil ? runtime.announcement : '',
    player: { ...runtime.player, skillReadyAt: { ...runtime.player.skillReadyAt } },
    aimX: runtime.aimX,
    aimY: runtime.aimY,
    enemies: runtime.enemies.map((enemy) => ({ ...enemy, affixes: [...enemy.affixes] })),
    projectiles: runtime.projectiles.map(({ hitIds, ...projectile }) => {
      void hitIds;
      return { ...projectile };
    }),
    effects: runtime.effects.map((effect) => ({ ...effect })),
    floatingTexts: runtime.floatingTexts.map((floatingText) => ({ ...floatingText })),
  };
}

function make3DSnapshot(snapshot: ArenaSnapshot): HackSlashArena3DSnapshot {
  return {
    now: snapshot.now,
    aimX: snapshot.aimX,
    aimY: snapshot.aimY,
    player: {
      x: snapshot.player.x,
      y: snapshot.player.y,
      vx: snapshot.player.vx,
      vy: snapshot.player.vy,
      hp: snapshot.player.hp,
      maxHp: snapshot.player.maxHp,
      dead: snapshot.player.dead,
      hurtUntil: snapshot.player.hurtUntil,
      animation: snapshot.player.animation,
      animationStartedAt: snapshot.player.animationStartedAt,
      animationDurationMs: snapshot.player.animationDurationMs,
      animationRate: snapshot.player.animationRate,
      impactAt: snapshot.player.animationImpactAt,
      direction: snapshot.player.direction,
      moveSpeed: magnitude(snapshot.player.vx, snapshot.player.vy) > 0 ? 1 : 0,
    },
    enemies: snapshot.enemies.map((enemy) => ({
      id: enemy.id,
      unitId: enemy.unitId,
      name: enemy.name,
      x: enemy.x,
      y: enemy.y,
      vx: enemy.vx,
      vy: enemy.vy,
      hp: enemy.hp,
      maxHp: enemy.maxHp,
      speed: enemy.speed,
      elite: enemy.elite,
      boss: enemy.boss,
      affixes: enemy.affixes,
      attackKind: enemy.attackKind,
      pendingAttackAt: enemy.pendingAttackAt,
      hurtUntil: enemy.hurtUntil,
      deadAt: enemy.deadAt,
      animation: enemy.animation,
      animationStartedAt: enemy.animationStartedAt,
      animationDurationMs: enemy.animationDurationMs,
      animationRate: enemy.animationRate,
      impactAt: enemy.animationImpactAt,
      direction: enemy.direction,
    })),
    projectiles: snapshot.projectiles.map((projectile) => ({
      id: projectile.id,
      kind: projectile.kind,
      team: projectile.team,
      startedAt: projectile.startedAt,
      x: projectile.x,
      y: projectile.y,
      vx: projectile.vx,
      vy: projectile.vy,
      radius: projectile.radius,
      expiresAt: projectile.expiresAt,
    })),
    effects: snapshot.effects,
  };
}

function announce(runtime: ArenaRuntime, text: string, now: number, duration = 1200) {
  runtime.announcement = text;
  runtime.announcementUntil = now + duration;
}

function addEffect(
  runtime: ArenaRuntime,
  kind: FxKind,
  x: number,
  y: number,
  now: number,
  size = 86,
  angle = 0,
  source: ArenaFx['source'] = 'player',
) {
  runtime.entitySequence += 1;
  runtime.effects.push({
    id: runtime.entitySequence,
    kind,
    source,
    startedAt: now,
    x,
    y,
    angle,
    size,
    expiresAt: now + 1000,
  });
}

function addFloatingText(
  runtime: ArenaRuntime,
  x: number,
  y: number,
  text: string,
  tone: FloatingText['tone'],
  now: number,
) {
  runtime.entitySequence += 1;
  runtime.floatingTexts.push({ id: runtime.entitySequence, x, y, text, tone, expiresAt: now + 850 });
  if (runtime.floatingTexts.length > 24) runtime.floatingTexts.splice(0, runtime.floatingTexts.length - 24);
}

function enemyPool(config: ArenaConfig) {
  const requested = config.enemyIds.filter((enemyId) => ENEMY_DEFINITIONS[enemyId]);
  if (requested.length > 0) return requested;
  return [...REGION_DEFINITIONS[config.regionId].enemyIds];
}

function regularEnemyPool(config: ArenaConfig) {
  const regular = enemyPool(config).filter((enemyId) => !ENEMY_DEFINITIONS[enemyId].boss);
  return regular.length > 0 ? regular : [...REGION_DEFINITIONS[config.regionId].enemyIds];
}

function availableFieldBoss(config: ArenaConfig) {
  return enemyPool(config).find((enemyId) => ENEMY_DEFINITIONS[enemyId].boss) ?? null;
}

function fieldSpawnPosition(runtime: ArenaRuntime, config: ArenaConfig, index: number, initial: boolean) {
  const closePack = initial && index < 3;
  const minimumDistance = closePack ? 175 : initial ? 285 : 390;
  const maximumDistance = closePack ? 245 : initial ? 455 : 520;
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const angle = index * 2.39996 + attempt * 0.71 + (Math.random() - 0.5) * 0.46;
    const distance = minimumDistance + Math.random() * (maximumDistance - minimumDistance);
    const x = runtime.player.x + Math.cos(angle) * distance;
    const y = runtime.player.y + Math.sin(angle) * distance * 0.62;
    if (magnitude(x - runtime.player.x, y - runtime.player.y) < minimumDistance * 0.72) continue;
    if (!arenaPointBlocked(runtime, config, x, y, ENEMY_RADIUS * 0.72)) return { x, y };
  }
  const side = index % 2 === 0 ? -1 : 1;
  return {
    x: runtime.player.x + side * minimumDistance,
    y: runtime.player.y + ((index % 3) - 1) * 92,
  };
}

function createFieldEnemy(
  runtime: ArenaRuntime,
  config: ArenaConfig,
  enemyId: string,
  now: number,
  index: number,
  initial: boolean,
  forceElite = false,
): ArenaEnemy {
  const definition = ENEMY_DEFINITIONS[enemyId];
  const boss = definition.boss;
  const elite = !boss && forceElite;
  const affixes = elite ? [ELITE_AFFIX_IDS[(runtime.checkpoint + index) % ELITE_AFFIX_IDS.length]] : [];
  const ironclad = affixes.includes('ironclad');
  const berserker = affixes.includes('berserker');
  const baseHp = Math.max(28, Math.round(definition.maxHp * (boss ? 0.82 : 0.62)));
  const maxEnemyHp = Math.round(baseHp * (ironclad ? 1.45 : elite ? 1.22 : 1));
  const unitId = ARENA_UNIT_FOR_ENEMY[enemyId] ?? 'demon';
  const attackKind = unitId === 'demon' ? 'arcane' : unitId === 'drake' ? 'fire' : 'melee';
  const position = fieldSpawnPosition(runtime, config, index, initial);
  runtime.entitySequence += 1;
  return {
    id: `${runtime.runId}:field:${runtime.entitySequence}`,
    enemyId,
    unitId,
    name: definition.name,
    x: position.x,
    y: position.y,
    vx: 0,
    vy: 0,
    hp: maxEnemyHp,
    maxHp: maxEnemyHp,
    damage: Math.max(4, definition.attack * (boss ? 0.72 : 0.505) * (berserker ? 1.3 : 1)),
    speed: (68 + Math.min(48, definition.level * 1.8)) * (berserker ? 1.22 : 1),
    awarenessRange: boss ? 520 : elite ? 390 : 270 + Math.random() * 55,
    engaged: boss || (initial && index < 3),
    elite,
    boss,
    affixes,
    attackKind,
    nextAttackAt: now + 550 + Math.random() * 500,
    pendingAttackAt: null,
    pendingAimX: runtime.player.x,
    pendingAimY: runtime.player.y,
    hurtUntil: 0,
    attackUntil: 0,
    deadAt: null,
    animation: 'idle',
    animationStartedAt: now,
    animationDurationMs: 1000,
    animationImpactAt: null,
    animationRate: 1,
    direction: directionFromVector(runtime.player.x - position.x, runtime.player.y - position.y, 'south'),
  };
}

function spawnNextFieldEnemy(runtime: ArenaRuntime, config: ArenaConfig, now: number, initial = false) {
  const bossId = availableFieldBoss(config);
  if (!bossId) runtime.bossAnnouncedId = null;
  const shouldSpawnBoss = Boolean(bossId && runtime.bossAnnouncedId !== bossId);
  const pool = regularEnemyPool(config);
  const index = runtime.enemies.length + runtime.checkpoint;
  const enemyId = shouldSpawnBoss ? bossId! : pool[index % pool.length];
  const livingElites = runtime.enemies.filter((enemy) => enemy.deadAt === null && enemy.elite).length;
  const forceElite = !shouldSpawnBoss && livingElites < 2 && (initial ? index === 5 : (runtime.checkpoint + 1) % 7 === 0);
  const enemy = createFieldEnemy(runtime, config, enemyId, now, index, initial, forceElite);
  runtime.enemies.push(enemy);
  if (shouldSpawnBoss) {
    runtime.bossAnnouncedId = bossId;
    announce(runtime, `${enemy.name}의 기척이 느껴집니다`, now, 1800);
  }
}

function populateField(runtime: ArenaRuntime, config: ArenaConfig, now: number) {
  runtime.enemies = [];
  for (let index = 0; index < FIELD_TARGET_POPULATION; index += 1) {
    spawnNextFieldEnemy(runtime, config, now, true);
  }
  runtime.nextSpawnAt = null;
}

function resetRun(
  runtime: ArenaRuntime,
  config: ArenaConfig,
  now: number,
  initialCheckpoint?: ArenaCheckpointState | null,
) {
  const resumed = initialCheckpoint?.outcome === 'ongoing'
    && initialCheckpoint.wave === 1
    && initialCheckpoint.totalWaves === 1
    ? initialCheckpoint
    : null;
  runtime.runId = resumed?.runId ?? createRunId();
  runtime.checkpoint = resumed?.checkpoint ?? 0;
  runtime.kills = 0;
  runtime.damageSinceCheckpoint = 0;
  runtime.damageDealtSinceCheckpoint = 0;
  runtime.player.x = WORLD_WIDTH / 2;
  runtime.player.y = WORLD_HEIGHT / 2;
  runtime.player.vx = 0;
  runtime.player.vy = 0;
  runtime.player.hp = clamp(config.hp, 1, config.maxHp);
  runtime.player.maxHp = config.maxHp;
  runtime.player.dead = false;
  runtime.player.invulnerableUntil = now + 900;
  runtime.player.hurtUntil = 0;
  runtime.player.attackUntil = 0;
  runtime.player.nextAttackAt = 0;
  runtime.player.skillReadyAt = {};
  runtime.player.animation = 'idle';
  runtime.player.animationStartedAt = now;
  runtime.player.animationDurationMs = 1000;
  runtime.player.animationImpactAt = null;
  runtime.player.animationRate = 1;
  runtime.projectiles = [];
  runtime.effects = [];
  runtime.floatingTexts = [];
  runtime.pendingActions = [];
  runtime.moveTargetX = null;
  runtime.moveTargetY = null;
  runtime.attackTargetId = null;
  runtime.nextSpawnAt = null;
  runtime.bossAnnouncedId = null;
  populateField(runtime, config, now);
}

function aimDirection(runtime: ArenaRuntime) {
  let dx = runtime.aimX - runtime.player.x;
  let dy = runtime.aimY - runtime.player.y;
  const length = magnitude(dx, dy);
  if (length < 0.01) {
    const fallback = DIRECTION_VECTOR[runtime.player.direction];
    dx = fallback.x;
    dy = fallback.y;
  } else {
    dx /= length;
    dy /= length;
  }
  return { x: dx, y: dy, angle: Math.atan2(dy, dx) };
}

function aimAtNearest(runtime: ArenaRuntime) {
  let nearest: ArenaEnemy | null = null;
  let nearestDistance = Number.POSITIVE_INFINITY;
  for (const enemy of runtime.enemies) {
    if (enemy.deadAt !== null) continue;
    const distance = magnitude(enemy.x - runtime.player.x, enemy.y - runtime.player.y);
    if (distance < nearestDistance) {
      nearest = enemy;
      nearestDistance = distance;
    }
  }
  if (nearest) {
    runtime.aimX = nearest.x;
    runtime.aimY = nearest.y;
  }
}

function addProjectile(
  runtime: ArenaRuntime,
  kind: ArenaProjectile['kind'],
  angle: number,
  damage: number,
  now: number,
  pierce = 0,
  speed = 510,
  source?: { x: number; y: number; owner: string; team: ArenaProjectile['team'] },
  element: AdventureElement = kind === 'fire' ? 'fire' : kind === 'arcane' ? 'arcane' : 'physical',
  canProc = true,
) {
  runtime.entitySequence += 1;
  const directionX = Math.cos(angle);
  const directionY = Math.sin(angle);
  runtime.projectiles.push({
    id: runtime.entitySequence,
    kind,
    owner: source?.owner ?? 'player',
    team: source?.team ?? 'friendly',
    startedAt: now,
    x: (source?.x ?? runtime.player.x) + directionX * 38,
    y: (source?.y ?? runtime.player.y) + directionY * 38,
    vx: directionX * speed,
    vy: directionY * speed,
    damage,
    element,
    canProc,
    radius: kind === 'arrow' ? 13 : kind === 'fire' ? 23 : 20,
    expiresAt: now + (source?.team === 'hostile' ? 2600 : 1450),
    pierce,
    hitIds: new Set(),
  });
}

function enemiesInRadius(runtime: ArenaRuntime, x: number, y: number, radius: number) {
  return runtime.enemies.filter(
    (enemy) => enemy.deadAt === null && enemy.hp > 0 && magnitude(enemy.x - x, enemy.y - y) <= radius + ENEMY_RADIUS,
  );
}

function skillMotionKey(skill: ArenaSkillLoadout, index: number): 'skill1' | 'skill2' {
  if (skill.animationKey === 'skill1' || skill.animationKey === 'skill2') return skill.animationKey;
  const numericSuffix = Number(skill.id.match(/(\d+)$/)?.[1]);
  if (Number.isFinite(numericSuffix) && numericSuffix > 0) return numericSuffix % 2 === 0 ? 'skill2' : 'skill1';
  return index % 2 === 0 ? 'skill1' : 'skill2';
}

function projectileKind(projectileKey: string | null | undefined, classId: CharacterClassId): ArenaProjectileId {
  if (projectileKey?.includes('arrow')) return 'arrow';
  if (projectileKey?.includes('bolt') || projectileKey?.includes('meteor') || projectileKey?.includes('orb')) return 'arcane';
  return classId === 'ranger' ? 'arrow' : 'arcane';
}

function effectKind(effectKey: string | undefined, skillKind: ArenaSkillKind): ArenaEffectId {
  if (effectKey?.includes('heal')) return 'heal';
  if (effectKey?.includes('impact') || effectKey?.includes('bash')) return 'impact';
  if (effectKey?.includes('arrow')) return 'arrow';
  if (effectKey?.includes('slash') || effectKey?.includes('cleave')) return 'slash';
  return skillKind === 'melee' || skillKind === 'dash' ? 'slash' : 'nova';
}

function actionElement(classId: CharacterClassId, skill: ArenaSkillLoadout | undefined): AdventureElement {
  const key = `${skill?.projectileKey ?? ''}:${skill?.effectKey ?? ''}`;
  if (key.includes('fire') || key.includes('meteor')) return 'fire';
  if (key.includes('frost') || key.includes('ice')) return 'cold';
  if (key.includes('poison') || key.includes('venom')) return 'poison';
  if (key.includes('storm') || key.includes('lightning')) return 'lightning';
  if (classId === 'mystic') return 'arcane';
  return 'physical';
}

function lowLifeModifiers(runtime: ArenaRuntime, config: ArenaConfig) {
  const ratio = runtime.player.hp / Math.max(1, runtime.player.maxHp);
  let damageMultiplier = 1;
  let damageTakenMultiplier = 1;
  let lifeOnHit = 0;
  for (const resolved of config.combatModifiers?.effects ?? []) {
    const effect = resolved.effect;
    if (effect.kind !== 'lowLife' || ratio > effect.threshold) continue;
    damageMultiplier *= effect.damageMultiplier;
    damageTakenMultiplier *= effect.damageTakenMultiplier;
    lifeOnHit += effect.lifeOnHit ?? 0;
  }
  return { damageMultiplier, damageTakenMultiplier, lifeOnHit };
}

function healPlayer(runtime: ArenaRuntime, amount: number, now: number, label?: string) {
  const healing = Math.min(
    Math.max(0, Math.round(amount)),
    Math.max(0, runtime.player.maxHp - runtime.player.hp),
  );
  if (healing <= 0) return 0;
  runtime.player.hp += healing;
  runtime.damageSinceCheckpoint = Math.max(0, runtime.damageSinceCheckpoint - healing);
  addEffect(runtime, 'heal', runtime.player.x, runtime.player.y, now, 82);
  addFloatingText(runtime, runtime.player.x, runtime.player.y - 44, label ? `${label} +${healing}` : `+${healing}`, 'heal', now);
  return healing;
}

function worldRange(range: number) {
  return range <= 20 ? range * 48 : range;
}

function performPlayerAction(
  runtime: ArenaRuntime,
  config: ArenaConfig,
  action: ActionInput,
  now: number,
  preserveAim = false,
) {
  if (runtime.player.dead || config.paused || now < runtime.player.hurtUntil) return;
  const skillIndex = action.type === 'skill' ? config.skills.findIndex((candidate) => candidate.id === action.skillId) : -1;
  const skill = skillIndex >= 0 ? config.skills[skillIndex] : undefined;
  if (action.type === 'skill' && !skill) return;
  if (skill && (skill.disabled || config.level < (skill.unlockLevel ?? 1))) return;
  if (action.type === 'attack' && now < runtime.player.nextAttackAt) return;
  if (skill && now < (runtime.player.skillReadyAt[skill.id] ?? 0)) return;

  runtime.moveTargetX = null;
  runtime.moveTargetY = null;
  runtime.attackTargetId = null;

  if (!preserveAim) aimAtNearest(runtime);
  const direction = aimDirection(runtime);
  runtime.player.direction = directionFromVector(direction.x, direction.y, runtime.player.direction);

  const actionRate = skill ? config.castSpeed : config.attackSpeed;
  const baseDuration = skill
    ? (skillMotionKey(skill, skillIndex) === 'skill2' ? 1050 : 860)
    : config.classId === 'ranger' ? 760 : config.classId === 'mystic' ? 900 : 820;
  const baseWindUp = skill
    ? (skillMotionKey(skill, skillIndex) === 'skill2' ? 520 : 410)
    : config.classId === 'vanguard' ? 260 : config.classId === 'ranger' ? 390 : 430;
  const duration = Math.max(180, baseDuration / actionRate);
  const windUp = Math.min(duration * 0.8, Math.max(70, baseWindUp / actionRate));
  const impactAt = now + windUp;
  runtime.player.attackUntil = now + duration;
  setAnimation(runtime.player, skill ? skillMotionKey(skill, skillIndex) : 'attack', now, {
    durationMs: duration,
    impactAt,
    rate: actionRate,
  });

  const baseDamage = Math.max(
    5,
    (config.attack + config.level * 0.8) * (config.combatModifiers?.damageMultiplier ?? 1),
  );
  if (action.type === 'attack') {
    runtime.player.nextAttackAt = now + duration;
  } else {
    runtime.player.skillReadyAt[skill!.id] = now
      + (skill!.cooldownMs ?? Math.max(1, skill!.cooldown ?? 4) * 1000)
      * (config.combatModifiers?.cooldownMultiplier ?? 1);
  }

  runtime.entitySequence += 1;
  runtime.pendingActions.push({
    id: runtime.entitySequence,
    executeAt: impactAt,
    action,
    classId: config.classId,
    angle: direction.angle,
    aimX: runtime.aimX,
    aimY: runtime.aimY,
    baseDamage,
    damageScale: 1,
    canProc: true,
    projectileSpeed: config.projectileSpeed,
    skill,
  });

  if (!skill) return;
  for (const resolved of config.combatModifiers?.effects ?? []) {
    const effect = resolved.effect;
    if (!resolved.active || effect.kind !== 'onCast' || (effect.skill && effect.skill !== skill.id)) continue;
    if (Math.random() > effect.chance) continue;
    const refundMs = Math.max(0, (effect.cooldownRefundSeconds ?? 0) * 1000);
    runtime.player.skillReadyAt[skill.id] = Math.max(now, runtime.player.skillReadyAt[skill.id] - refundMs);
    if ((effect.echoDamageMultiplier ?? 0) > 0) {
      runtime.entitySequence += 1;
      runtime.pendingActions.push({
        id: runtime.entitySequence,
        executeAt: impactAt + 130,
        action,
        classId: config.classId,
        angle: direction.angle,
        aimX: runtime.aimX,
        aimY: runtime.aimY,
        baseDamage,
        damageScale: effect.echoDamageMultiplier!,
        canProc: false,
        projectileSpeed: config.projectileSpeed,
        skill,
      });
    }
    addFloatingText(runtime, runtime.player.x, runtime.player.y - 52, effect.name, 'elite', now);
  }
}

function damageEnemyRaw(
  runtime: ArenaRuntime,
  enemy: ArenaEnemy,
  damage: number,
  now: number,
  tone: FloatingText['tone'] = 'damage',
) {
  const actualDamage = Math.min(damage, Math.max(0, enemy.hp));
  enemy.hp -= damage;
  enemy.vx = 0;
  enemy.vy = 0;
  enemy.hurtUntil = now + ENEMY_HIT_RECOVERY_MS;
  interruptEnemyWindup(enemy, now);
  setAnimation(enemy, 'hit', now);
  runtime.damageDealtSinceCheckpoint += actualDamage;
  addEffect(runtime, 'impact', enemy.x, enemy.y, now, 65);
  addFloatingText(runtime, enemy.x, enemy.y - 35, `${Math.round(damage)}`, tone, now);
  return actualDamage;
}

function enemyElementResistance(enemy: ArenaEnemy, element: AdventureElement) {
  if (element === 'physical') return enemy.unitId === 'sentinel' ? 0.16 : 0;
  if (element === 'arcane' && enemy.attackKind === 'arcane') return 0.18;
  if (element === 'fire' && enemy.attackKind === 'fire') return 0.2;
  if (element === 'poison' && enemy.unitId === 'slime') return 0.12;
  return enemy.elite ? 0.08 : 0.03;
}

function damageEnemy(
  runtime: ArenaRuntime,
  config: ArenaConfig,
  enemy: ArenaEnemy,
  rawDamage: number,
  now: number,
  options: {
    element?: AdventureElement;
    canProc?: boolean;
    tone?: FloatingText['tone'];
    canCrit?: boolean;
  } = {},
) {
  if (enemy.deadAt !== null || enemy.hp <= 0) return 0;
  enemy.engaged = true;
  const element = options.element ?? 'physical';
  const lowLife = lowLifeModifiers(runtime, config);
  const elementMultiplier = config.combatModifiers?.elementalDamageMultipliers[element] ?? 1;
  const penetration = config.combatModifiers?.elementalPenetration[element] ?? 0;
  const resistance = Math.max(0, enemyElementResistance(enemy, element) - penetration);
  const critChance = clamp(config.crit + (config.combatModifiers?.critChanceBonus ?? 0), 0, 95) / 100;
  const critical = options.canCrit !== false && Math.random() < critChance;
  const critMultiplier = critical ? 1.65 + (config.combatModifiers?.critDamageBonus ?? 0) : 1;
  const damage = Math.max(1, rawDamage * lowLife.damageMultiplier * elementMultiplier * (1 - resistance) * critMultiplier);
  const actualDamage = damageEnemyRaw(runtime, enemy, damage, now, critical ? 'elite' : options.tone);
  const lifeOnHit = (config.combatModifiers?.lifeOnHit ?? 0) + lowLife.lifeOnHit;
  if (lifeOnHit > 0 && actualDamage > 0) healPlayer(runtime, lifeOnHit, now);

  if (options.canProc === false) return actualDamage;
  for (const resolved of config.combatModifiers?.effects ?? []) {
    const effect = resolved.effect;
    if (!resolved.active || effect.kind !== 'onHit' || Math.random() > effect.chance) continue;
    const candidates = runtime.enemies
      .filter((candidate) => candidate.deadAt === null && candidate.hp > 0)
      .sort((left, right) => (
        magnitude(left.x - enemy.x, left.y - enemy.y) - magnitude(right.x - enemy.x, right.y - enemy.y)
      ))
      .slice(0, Math.max(1, effect.chainTargets ?? 1));
    let procDamage = 0;
    for (const target of candidates) {
      const procElementMultiplier = config.combatModifiers.elementalDamageMultipliers[effect.element] ?? 1;
      const procPenetration = config.combatModifiers.elementalPenetration[effect.element] ?? 0;
      const procResistance = Math.max(0, enemyElementResistance(target, effect.element) - procPenetration);
      procDamage += damageEnemyRaw(
        runtime,
        target,
        rawDamage * effect.damageMultiplier * procElementMultiplier * (1 - procResistance),
        now,
        'elite',
      );
      addEffect(runtime, effect.element === 'physical' ? 'slash' : 'nova', target.x, target.y, now, 78);
    }
    if ((effect.lifeStealPercent ?? 0) > 0) healPlayer(runtime, procDamage * effect.lifeStealPercent!, now, effect.name);
    else addFloatingText(runtime, enemy.x, enemy.y - 52, effect.name, 'elite', now);
  }
  return actualDamage;
}

function executePlayerAction(runtime: ArenaRuntime, pending: PendingPlayerAction, now: number, config: ArenaConfig) {
  if (runtime.player.dead) return;
  const directionX = Math.cos(pending.angle);
  const directionY = Math.sin(pending.angle);
  const element = actionElement(pending.classId, pending.skill);
  if (pending.action.type === 'attack') {
    if (pending.classId === 'vanguard') {
      addEffect(
        runtime,
        'slash',
        runtime.player.x + directionX * config.meleeReach * 0.58,
        runtime.player.y + directionY * config.meleeReach * 0.58,
        now,
        Math.min(118, config.meleeReach * 0.92),
        pending.angle,
      );
      const target = selectForwardMeleeTarget(
        runtime.enemies,
        runtime.player,
        { x: directionX, y: directionY },
        config.meleeReach,
        ENEMY_RADIUS,
      );
      if (target) {
        target.engaged = true;
        damageEnemy(runtime, config, target, pending.baseDamage * pending.damageScale, now, {
          element,
          canProc: pending.canProc,
        });
      }
    } else {
      const count = Math.max(1, 1 + (config.combatModifiers?.projectileCountBonus ?? 0));
      const midpoint = (count - 1) / 2;
      for (let index = 0; index < count; index += 1) {
        addProjectile(
          runtime,
          pending.classId === 'ranger' ? 'arrow' : 'arcane',
          pending.angle + (index - midpoint) * 0.11,
          pending.baseDamage
            * pending.damageScale
            * (config.combatModifiers?.projectileDamageMultiplier ?? 1),
          now,
          Math.max(0, config.combatModifiers?.projectilePierceBonus ?? 0),
          510 * pending.projectileSpeed,
          undefined,
          element,
          pending.canProc,
        );
      }
    }
    return;
  }

  const skill = pending.skill;
  if (!skill) return;
  const damage = pending.baseDamage * skill.damageMultiplier * pending.damageScale;
  const range = worldRange(skill.range)
    * (skill.kind === 'area' ? config.combatModifiers?.areaMultiplier ?? 1 : 1);
  if (skill.healingRatio && skill.healingRatio > 0) {
    const healing = Math.min(
      runtime.damageSinceCheckpoint,
      runtime.player.maxHp - runtime.player.hp,
      Math.max(2, Math.round(runtime.player.maxHp * skill.healingRatio)),
    );
    runtime.player.hp += healing;
    runtime.damageSinceCheckpoint = Math.max(0, runtime.damageSinceCheckpoint - healing);
    addEffect(runtime, 'heal', runtime.player.x, runtime.player.y, now, 96);
    if (healing > 0) addFloatingText(runtime, runtime.player.x, runtime.player.y - 44, `+${healing}`, 'heal', now);
  }

  if (skill.kind === 'projectile') {
    const inferredCount = skill.projectileKey?.includes('fan') ? 5 : skill.projectileKey?.includes('rain') || skill.projectileKey?.includes('storm') ? 7 : 1;
    const inferredPierce = skill.projectileKey?.includes('piercing') ? 4 : 0;
    const count = Math.max(
      1,
      Math.min(12, (skill.projectileCount ?? inferredCount) + (config.combatModifiers?.projectileCountBonus ?? 0)),
    );
    const midpoint = (count - 1) / 2;
    for (let index = 0; index < count; index += 1) {
      addProjectile(
        runtime,
        projectileKind(skill.projectileKey, pending.classId),
        pending.angle + (index - midpoint) * 0.13,
        damage * (config.combatModifiers?.projectileDamageMultiplier ?? 1),
        now,
        Math.max(0, (skill.pierce ?? inferredPierce) + (config.combatModifiers?.projectilePierceBonus ?? 0)),
        Math.max(400, range) * pending.projectileSpeed,
        undefined,
        element,
        pending.canProc,
      );
    }
    if (skill.effectKey) addEffect(runtime, effectKind(skill.effectKey, skill.kind), runtime.player.x + directionX * 48, runtime.player.y + directionY * 48, now, 112);
    return;
  }

  if (skill.kind === 'dash') {
    const dashDistance = Math.min(190, Math.max(65, range * 0.55));
    const startX = runtime.player.x;
    const startY = runtime.player.y;
    const steps = Math.max(2, Math.ceil(dashDistance / 18));
    for (let step = 1; step <= steps; step += 1) {
      const ratio = step / steps;
      const nextX = clamp(startX + directionX * dashDistance * ratio, 48, WORLD_WIDTH - 48);
      const nextY = clamp(startY + directionY * dashDistance * ratio, 62, PLAYABLE_BOTTOM);
      if (arenaPointBlocked(runtime, config, nextX, nextY, PLAYER_RADIUS * 0.65)) break;
      runtime.player.x = nextX;
      runtime.player.y = nextY;
    }
  }
  const centeredOnPlayer = skill.kind === 'melee' || skill.kind === 'dash' || skill.effectKey?.includes('heal');
  const targetX = centeredOnPlayer ? runtime.player.x : clamp(pending.aimX, 60, WORLD_WIDTH - 60);
  const targetY = centeredOnPlayer ? runtime.player.y : clamp(pending.aimY, 60, WORLD_HEIGHT - 60);
  if (skill.projectileKey) {
    const visualCount = skill.projectileKey.includes('fan') ? 5 : skill.projectileKey.includes('rain') ? 7 : 1;
    const midpoint = (visualCount - 1) / 2;
    for (let index = 0; index < visualCount; index += 1) {
      addProjectile(
        runtime,
        projectileKind(skill.projectileKey, pending.classId),
        pending.angle + (index - midpoint) * 0.14,
        0,
        now,
        0,
        520 * pending.projectileSpeed,
        undefined,
        element,
        pending.canProc,
      );
    }
  }
  addEffect(runtime, effectKind(skill.effectKey, skill.kind), targetX, targetY, now, Math.min(250, range * 1.25));
  for (const enemy of enemiesInRadius(runtime, targetX, targetY, range)) {
    damageEnemy(runtime, config, enemy, damage, now, {
      element,
      canProc: pending.canProc,
      tone: skill.kind === 'area' ? 'elite' : 'damage',
    });
  }
}

function executePendingActions(runtime: ArenaRuntime, config: ArenaConfig, now: number) {
  const pending = runtime.pendingActions;
  runtime.pendingActions = [];
  for (const action of pending) {
    if (action.executeAt <= now) executePlayerAction(runtime, action, now, config);
    else runtime.pendingActions.push(action);
  }
}

function settleEnemyDeaths(
  runtime: ArenaRuntime,
  config: ArenaConfig,
  now: number,
  onEnemyDefeated: HackSlashArenaProps['onEnemyDefeated'],
) {
  const newlyDefeated = runtime.enemies.filter((enemy) => enemy.hp <= 0 && enemy.deadAt === null);
  for (const enemy of newlyDefeated) {
    enemy.hp = 0;
    enemy.deadAt = now;
    enemy.vx = 0;
    enemy.vy = 0;
    setAnimation(enemy, 'death', now);
    runtime.kills += 1;
    runtime.checkpoint += 1;
    const boss = ENEMY_DEFINITIONS[enemy.enemyId].boss;
    addEffect(runtime, 'loot', enemy.x, enemy.y, now, enemy.elite ? 125 : 92);
    addFloatingText(
      runtime,
      enemy.x,
      enemy.y - 48,
      boss ? '우두머리 처치' : enemy.elite ? '정예 격파' : '처치',
      boss || enemy.elite ? 'elite' : 'damage',
      now,
    );
    if ((config.combatModifiers?.lifeOnKill ?? 0) > 0) {
      healPlayer(runtime, config.combatModifiers!.lifeOnKill, now);
    }
    for (const resolved of config.combatModifiers?.effects ?? []) {
      const effect = resolved.effect;
      if (!resolved.active || effect.kind !== 'onKill' || Math.random() > effect.chance) continue;
      if ((effect.healPercent ?? 0) > 0) {
        healPlayer(runtime, runtime.player.maxHp * effect.healPercent!, now, effect.name);
      }
      if ((effect.cooldownReductionSeconds ?? 0) > 0) {
        const refund = effect.cooldownReductionSeconds! * 1000;
        for (const skillId of Object.keys(runtime.player.skillReadyAt)) {
          runtime.player.skillReadyAt[skillId] = Math.max(now, runtime.player.skillReadyAt[skillId] - refund);
        }
      }
      if ((effect.explosionDamageMultiplier ?? 0) > 0) {
        addEffect(runtime, effect.element === 'physical' ? 'slash' : 'nova', enemy.x, enemy.y, now, 160);
        const explosionDamage = (config.attack + config.level * 0.8) * effect.explosionDamageMultiplier!;
        for (const target of enemiesInRadius(runtime, enemy.x, enemy.y, 178)) {
          if (target.id === enemy.id) continue;
          damageEnemy(runtime, config, target, explosionDamage, now, {
            element: effect.element ?? 'physical',
            canProc: false,
            canCrit: false,
            tone: 'elite',
          });
        }
      }
      addFloatingText(runtime, enemy.x, enemy.y - 62, effect.name, 'elite', now);
    }
    onEnemyDefeated?.({
      runId: runtime.runId,
      checkpoint: runtime.checkpoint,
      enemyId: enemy.enemyId,
      elite: enemy.elite,
      boss: enemy.boss,
      affixes: [...enemy.affixes],
      wave: 1,
      totalWaves: 1,
      expeditionComplete: false,
      damageTaken: runtime.damageSinceCheckpoint,
      damageDealt: Math.max(0, Math.round(runtime.damageDealtSinceCheckpoint)),
      remainingHp: Math.max(0, Math.round(runtime.player.hp)),
    });
    runtime.damageSinceCheckpoint = 0;
    runtime.damageDealtSinceCheckpoint = 0;
  }
}

function damagePlayer(
  runtime: ArenaRuntime,
  config: ArenaConfig,
  rawDamage: number,
  now: number,
  onPlayerDefeated: HackSlashArenaProps['onPlayerDefeated'],
  sourceEnemy?: ArenaEnemy,
) {
  if (runtime.player.dead || now < runtime.player.invulnerableUntil) return;
  const mitigation = config.defense * 0.42;
  const lowLife = lowLifeModifiers(runtime, config);
  const damage = Math.max(
    1,
    Math.round(
      (rawDamage - mitigation)
      * (config.combatModifiers?.damageTakenMultiplier ?? 1)
      * lowLife.damageTakenMultiplier,
    ),
  );
  runtime.player.hp = Math.max(0, runtime.player.hp - damage);
  runtime.damageSinceCheckpoint += damage;
  runtime.player.vx = 0;
  runtime.player.vy = 0;
  runtime.player.hurtUntil = now + PLAYER_HIT_RECOVERY_MS;
  runtime.player.invulnerableUntil = now + 430;
  interruptPlayerWindup(runtime, now);
  setAnimation(runtime.player, 'hit', now);
  addEffect(runtime, 'impact', runtime.player.x, runtime.player.y, now, 78, 0, sourceEnemy ? 'enemy' : 'system');
  addFloatingText(runtime, runtime.player.x, runtime.player.y - 48, `-${damage}`, 'player', now);

  if (sourceEnemy?.affixes.includes('vampiric')) {
    const healing = Math.max(1, Math.round(damage * 0.7));
    sourceEnemy.hp = Math.min(sourceEnemy.maxHp, sourceEnemy.hp + healing);
    addEffect(runtime, 'heal', sourceEnemy.x, sourceEnemy.y, now, 68, 0, 'enemy');
  }

  if (runtime.player.hp > 0) return;
  runtime.player.dead = true;
  runtime.player.vx = 0;
  runtime.player.vy = 0;
  runtime.checkpoint += 1;
  setAnimation(runtime.player, 'death', now);
  announce(runtime, '전투 불능', now, 2000);
  onPlayerDefeated?.({
    runId: runtime.runId,
    checkpoint: runtime.checkpoint,
    wave: 1,
    totalWaves: 1,
    kills: runtime.kills,
    damageTaken: runtime.damageSinceCheckpoint,
    damageDealt: Math.max(0, Math.round(runtime.damageDealtSinceCheckpoint)),
  });
  runtime.damageSinceCheckpoint = 0;
  runtime.damageDealtSinceCheckpoint = 0;
}

function checkpointRunExit(
  runtime: ArenaRuntime,
  onRunExited: HackSlashArenaProps['onRunExited'],
  emittedCheckpoints: Set<string>,
) {
  if (runtime.player.dead || runtime.runId === 'pending' || runtime.damageSinceCheckpoint <= 0) return;
  const checkpoint = runtime.checkpoint + 1;
  const identity = `${runtime.runId}:${checkpoint}`;
  if (emittedCheckpoints.has(identity)) return;
  emittedCheckpoints.add(identity);
  runtime.checkpoint = checkpoint;
  onRunExited?.({
    runId: runtime.runId,
    checkpoint,
    wave: 1,
    totalWaves: 1,
    kills: runtime.kills,
    damageTaken: runtime.damageSinceCheckpoint,
    damageDealt: Math.max(0, Math.round(runtime.damageDealtSinceCheckpoint)),
  });
  runtime.damageSinceCheckpoint = 0;
  runtime.damageDealtSinceCheckpoint = 0;
}

function startEnemyAttack(runtime: ArenaRuntime, enemy: ArenaEnemy, now: number) {
  const ranged = enemy.attackKind !== 'melee';
  const rate = enemy.affixes.includes('berserker') ? 1.38 : 1;
  const baseWindUp = enemy.attackKind === 'melee' ? 360 : enemy.attackKind === 'fire' ? 580 : 460;
  const duration = 1000 / rate;
  const impactAt = now + baseWindUp / rate;
  enemy.vx = 0;
  enemy.vy = 0;
  enemy.pendingAimX = runtime.player.x;
  enemy.pendingAimY = runtime.player.y;
  enemy.pendingAttackAt = impactAt;
  enemy.attackUntil = now + duration;
  enemy.direction = directionFromVector(runtime.player.x - enemy.x, runtime.player.y - enemy.y, enemy.direction);
  setAnimation(enemy, 'attack', now, { durationMs: duration, impactAt, rate });
  if (ranged) addEffect(runtime, enemy.attackKind === 'fire' ? 'nova' : 'arrow', enemy.x, enemy.y, now, 72, 0, 'enemy');
}

function resolveEnemyAttack(
  runtime: ArenaRuntime,
  config: ArenaConfig,
  enemy: ArenaEnemy,
  now: number,
  onPlayerDefeated: HackSlashArenaProps['onPlayerDefeated'],
) {
  if (enemy.pendingAttackAt === null || now < enemy.pendingAttackAt || runtime.player.dead) return false;
  enemy.pendingAttackAt = null;
  const cooldown = enemy.attackKind === 'melee' ? 1120 : enemy.attackKind === 'fire' ? 2250 : 1850;
  enemy.nextAttackAt = now + cooldown * (enemy.affixes.includes('berserker') ? 0.72 : 1) + Math.random() * 220;

  if (enemy.attackKind === 'melee') {
    const distance = magnitude(runtime.player.x - enemy.x, runtime.player.y - enemy.y);
    if (distance <= PLAYER_RADIUS + ENEMY_RADIUS + 24) {
      damagePlayer(runtime, config, enemy.damage, now, onPlayerDefeated, enemy);
    }
    return true;
  }

  const angle = Math.atan2(enemy.pendingAimY - enemy.y, enemy.pendingAimX - enemy.x);
  const fire = enemy.attackKind === 'fire';
  addProjectile(
    runtime,
    fire ? 'fire' : 'arcane',
    angle,
    enemy.damage * (fire ? 1.12 : 0.92),
    now,
    0,
    fire ? 270 : 335,
    { x: enemy.x, y: enemy.y, owner: enemy.id, team: 'hostile' },
  );
  return true;
}

function arenaPointToRuntimeWorld(runtime: ArenaRuntime, x: number, y: number) {
  return {
    x: runtime.worldCenterX + (x - WORLD_WIDTH / 2) * WORLD_UNITS_PER_ARENA_PIXEL,
    z: runtime.worldCenterZ + (y - WORLD_HEIGHT / 2) * WORLD_UNITS_PER_ARENA_PIXEL,
  };
}

function arenaPointBlocked(
  runtime: ArenaRuntime,
  config: ArenaConfig,
  x: number,
  y: number,
  radiusPixels: number,
  projectile = false,
) {
  const position = arenaPointToRuntimeWorld(runtime, x, y);
  const radius = radiusPixels * WORLD_UNITS_PER_ARENA_PIXEL;
  if (
    position.x - radius < config.worldMinX
    || position.x + radius > config.worldMaxX
    || position.z - radius < config.worldMinZ
    || position.z + radius > config.worldMaxZ
  ) return true;
  for (const obstacle of config.worldCollisionObstacles) {
    if (projectile && !obstacle.blocksProjectiles) continue;
    const dx = position.x - obstacle.position.x;
    const dz = position.z - obstacle.position.z;
    if (Math.abs(dx) > obstacle.radius + radius + 2 || Math.abs(dz) > obstacle.radius + radius + 2) continue;
    if (obstacle.shape === 'circle') {
      if (Math.hypot(dx, dz) < obstacle.radius + radius) return true;
    } else if (
      Math.abs(dx) < obstacle.halfExtents.x + radius
      && Math.abs(dz) < obstacle.halfExtents.z + radius
    ) return true;
  }
  return false;
}

function projectilePathBlocked(
  runtime: ArenaRuntime,
  config: ArenaConfig,
  projectile: ArenaProjectile,
  nextX: number,
  nextY: number,
) {
  const distance = magnitude(nextX - projectile.x, nextY - projectile.y);
  const steps = Math.max(1, Math.ceil(distance / 12));
  for (let step = 1; step <= steps; step += 1) {
    const ratio = step / steps;
    if (arenaPointBlocked(
      runtime,
      config,
      projectile.x + (nextX - projectile.x) * ratio,
      projectile.y + (nextY - projectile.y) * ratio,
      projectile.radius,
      true,
    )) return true;
  }
  return false;
}

function rebaseRuntimeToWorld(runtime: ArenaRuntime, config: ArenaConfig) {
  const player = runtime.player;
  const requestedX = player.x < REBASE_X_MIN || player.x > REBASE_X_MAX
    ? player.x - WORLD_WIDTH / 2
    : 0;
  const requestedY = player.y < REBASE_Y_MIN || player.y > REBASE_Y_MAX
    ? player.y - WORLD_HEIGHT / 2
    : 0;
  const nextCenterX = clamp(
    runtime.worldCenterX + requestedX * WORLD_UNITS_PER_ARENA_PIXEL,
    config.worldMinX,
    config.worldMaxX,
  );
  const nextCenterZ = clamp(
    runtime.worldCenterZ + requestedY * WORLD_UNITS_PER_ARENA_PIXEL,
    config.worldMinZ,
    config.worldMaxZ,
  );
  const shiftX = (nextCenterX - runtime.worldCenterX) / WORLD_UNITS_PER_ARENA_PIXEL;
  const shiftY = (nextCenterZ - runtime.worldCenterZ) / WORLD_UNITS_PER_ARENA_PIXEL;
  runtime.worldCenterX = nextCenterX;
  runtime.worldCenterZ = nextCenterZ;

  if (shiftX !== 0 || shiftY !== 0) {
    player.x -= shiftX;
    player.y -= shiftY;
    runtime.aimX -= shiftX;
    runtime.aimY -= shiftY;
    if (runtime.moveTargetX !== null) runtime.moveTargetX -= shiftX;
    if (runtime.moveTargetY !== null) runtime.moveTargetY -= shiftY;
    for (const enemy of runtime.enemies) {
      enemy.x -= shiftX;
      enemy.y -= shiftY;
      enemy.pendingAimX -= shiftX;
      enemy.pendingAimY -= shiftY;
    }
    for (const projectile of runtime.projectiles) {
      projectile.x -= shiftX;
      projectile.y -= shiftY;
    }
    for (const effect of runtime.effects) {
      effect.x -= shiftX;
      effect.y -= shiftY;
    }
    for (const floatingText of runtime.floatingTexts) {
      floatingText.x -= shiftX;
      floatingText.y -= shiftY;
    }
    for (const action of runtime.pendingActions) {
      action.aimX -= shiftX;
      action.aimY -= shiftY;
    }
  }

  const actualX = runtime.worldCenterX + (player.x - WORLD_WIDTH / 2) * WORLD_UNITS_PER_ARENA_PIXEL;
  const actualZ = runtime.worldCenterZ + (player.y - WORLD_HEIGHT / 2) * WORLD_UNITS_PER_ARENA_PIXEL;
  const clampedX = clamp(actualX, config.worldMinX + 8, config.worldMaxX - 8);
  const clampedZ = clamp(actualZ, config.worldMinZ + 8, config.worldMaxZ - 8);
  player.x += (clampedX - actualX) / WORLD_UNITS_PER_ARENA_PIXEL;
  player.y += (clampedZ - actualZ) / WORLD_UNITS_PER_ARENA_PIXEL;
}

function updateRuntime(
  runtime: ArenaRuntime,
  config: ArenaConfig,
  heldDirections: Set<MoveInput>,
  now: number,
  deltaSeconds: number,
  callbacks: Pick<HackSlashArenaProps, 'onEnemyDefeated' | 'onPlayerDefeated'>,
) {
  if (config.paused) return;

  const player = runtime.player;
  if (!player.dead) {
    const attackTarget = runtime.attackTargetId
      ? runtime.enemies.find((enemy) => enemy.id === runtime.attackTargetId && enemy.deadAt === null && enemy.hp > 0)
      : null;
    if (runtime.attackTargetId && !attackTarget) runtime.attackTargetId = null;
    if (attackTarget) {
      runtime.aimX = attackTarget.x;
      runtime.aimY = attackTarget.y;
      const targetDistance = magnitude(attackTarget.x - player.x, attackTarget.y - player.y);
      const attackRange = config.classId === 'vanguard'
        ? config.meleeReach + ENEMY_RADIUS
        : config.classId === 'ranger' ? 520 : 440;
      if (targetDistance <= attackRange) {
        performPlayerAction(runtime, config, { type: 'attack' }, now, true);
      } else {
        runtime.moveTargetX = attackTarget.x;
        runtime.moveTargetY = attackTarget.y;
      }
    }
    const actionLocked = now < player.hurtUntil || (
      now < player.attackUntil
      && (player.animation === 'attack' || player.animation === 'skill1' || player.animation === 'skill2')
    );
    let moveX = actionLocked ? 0 : Number(heldDirections.has('right')) - Number(heldDirections.has('left'));
    let moveY = actionLocked ? 0 : Number(heldDirections.has('down')) - Number(heldDirections.has('up'));
    const keyboardMoving = moveX !== 0 || moveY !== 0;
    if (keyboardMoving) {
      runtime.moveTargetX = null;
      runtime.moveTargetY = null;
    } else if (!actionLocked && runtime.moveTargetX !== null && runtime.moveTargetY !== null) {
      const targetX = runtime.moveTargetX - player.x;
      const targetY = runtime.moveTargetY - player.y;
      const targetDistance = magnitude(targetX, targetY);
      if (targetDistance <= 9) {
        runtime.moveTargetX = null;
        runtime.moveTargetY = null;
      } else {
        moveX = targetX / targetDistance;
        moveY = targetY / targetDistance;
      }
    }
    const moveLength = magnitude(moveX, moveY);
    if (moveLength > 0) {
      moveX /= moveLength;
      moveY /= moveLength;
    }
    const playerSpeed = (225 + Math.min(45, config.level * 1.5)) * config.moveSpeed;
    player.vx = moveX * playerSpeed;
    player.vy = moveY * playerSpeed;
    const nextX = clamp(player.x + player.vx * deltaSeconds, 48, WORLD_WIDTH - 48);
    const nextY = clamp(player.y + player.vy * deltaSeconds, 62, PLAYABLE_BOTTOM);
    if (!arenaPointBlocked(runtime, config, nextX, player.y, PLAYER_RADIUS * 0.72)) player.x = nextX;
    else player.vx = 0;
    if (!arenaPointBlocked(runtime, config, player.x, nextY, PLAYER_RADIUS * 0.72)) player.y = nextY;
    else player.vy = 0;
    if (moveLength > 0) player.direction = directionFromVector(moveX, moveY, player.direction);
    rebaseRuntimeToWorld(runtime, config);
  }

  // Actions are resolved before enemy turns so a defeated enemy cannot land a late hit.
  executePendingActions(runtime, config, now);
  settleEnemyDeaths(runtime, config, now, callbacks.onEnemyDefeated);
  runtime.enemies = runtime.enemies.filter((enemy) => (
    enemy.deadAt !== null
    || ENEMY_DEFINITIONS[enemy.enemyId].boss
    || magnitude(enemy.x - player.x, enemy.y - player.y) <= FIELD_DESPAWN_DISTANCE
  ));

  for (const enemy of runtime.enemies) {
    if (enemy.deadAt !== null || enemy.hp <= 0) continue;
    if (player.dead) {
      enemy.vx = 0;
      enemy.vy = 0;
      enemy.pendingAttackAt = null;
      continue;
    }
    const dx = player.x - enemy.x;
    const dy = player.y - enemy.y;
    const distance = Math.max(0.001, magnitude(dx, dy));
    if (!enemy.engaged) {
      if (distance <= enemy.awarenessRange || now < enemy.hurtUntil) enemy.engaged = true;
      else {
        enemy.vx = 0;
        enemy.vy = 0;
        enemy.direction = directionFromVector(player.x - enemy.x, player.y - enemy.y, enemy.direction);
        continue;
      }
    }

    if (enemy.pendingAttackAt !== null) {
      enemy.vx = 0;
      enemy.vy = 0;
      resolveEnemyAttack(runtime, config, enemy, now, callbacks.onPlayerDefeated);
      continue;
    }
    if (now < enemy.hurtUntil) {
      enemy.vx = 0;
      enemy.vy = 0;
      continue;
    }
    if (now < enemy.attackUntil) {
      enemy.vx = 0;
      enemy.vy = 0;
      continue;
    }

    const ranged = enemy.attackKind !== 'melee';
    const preferredRange = enemy.attackKind === 'fire' ? 235 : 285;
    const minimumRange = preferredRange - 55;
    const maximumRange = preferredRange + 70;
    const retreat = ranged && distance < minimumRange;
    if (ranged && !retreat && now >= enemy.nextAttackAt && distance <= maximumRange + 35) {
      startEnemyAttack(runtime, enemy, now);
      continue;
    }
    if (!ranged && distance <= PLAYER_RADIUS + ENEMY_RADIUS + 9) {
      enemy.vx = 0;
      enemy.vy = 0;
      if (now >= enemy.nextAttackAt) startEnemyAttack(runtime, enemy, now);
      continue;
    }

    const holdPosition = ranged && !retreat && distance <= maximumRange;
    if (holdPosition) {
      enemy.vx = 0;
      enemy.vy = 0;
      enemy.direction = directionFromVector(dx, dy, enemy.direction);
      continue;
    }
    const movementSign = retreat ? -1 : 1;
    enemy.vx = (dx / distance) * enemy.speed * movementSign;
    enemy.vy = (dy / distance) * enemy.speed * movementSign;
    const nextEnemyX = enemy.x + enemy.vx * deltaSeconds;
    const nextEnemyY = enemy.y + enemy.vy * deltaSeconds;
    if (!arenaPointBlocked(runtime, config, nextEnemyX, enemy.y, ENEMY_RADIUS * 0.66)) enemy.x = nextEnemyX;
    else enemy.vx = 0;
    if (!arenaPointBlocked(runtime, config, enemy.x, nextEnemyY, ENEMY_RADIUS * 0.66)) enemy.y = nextEnemyY;
    else enemy.vy = 0;
    enemy.direction = ranged
      ? directionFromVector(dx, dy, enemy.direction)
      : directionFromVector(enemy.vx, enemy.vy, enemy.direction);
  }

  for (let first = 0; first < runtime.enemies.length; first += 1) {
    const a = runtime.enemies[first];
    if (a.deadAt !== null || a.hp <= 0) continue;
    for (let second = first + 1; second < runtime.enemies.length; second += 1) {
      const b = runtime.enemies[second];
      if (b.deadAt !== null || b.hp <= 0) continue;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const distance = magnitude(dx, dy);
      if (distance <= 0 || distance >= ENEMY_RADIUS * 1.55) continue;
      const push = (ENEMY_RADIUS * 1.55 - distance) * 0.5;
      a.x -= (dx / distance) * push;
      a.y -= (dy / distance) * push;
      b.x += (dx / distance) * push;
      b.y += (dy / distance) * push;
    }
  }

  if (!player.dead) {
    for (const projectile of runtime.projectiles) {
      if (player.dead) break;
      const nextProjectileX = projectile.x + projectile.vx * deltaSeconds;
      const nextProjectileY = projectile.y + projectile.vy * deltaSeconds;
      if (projectilePathBlocked(runtime, config, projectile, nextProjectileX, nextProjectileY)) {
        projectile.expiresAt = 0;
        addEffect(runtime, 'impact', projectile.x, projectile.y, now, projectile.kind === 'fire' ? 92 : 58, 0, projectile.team === 'hostile' ? 'enemy' : 'player');
        continue;
      }
      projectile.x = nextProjectileX;
      projectile.y = nextProjectileY;
      if (projectile.team === 'hostile') {
        if (
          !projectile.hitIds.has('player')
          && magnitude(projectile.x - player.x, projectile.y - player.y) <= projectile.radius + PLAYER_RADIUS
        ) {
          projectile.hitIds.add('player');
          projectile.expiresAt = 0;
          const sourceEnemy = runtime.enemies.find((enemy) => enemy.id === projectile.owner);
          damagePlayer(runtime, config, projectile.damage, now, callbacks.onPlayerDefeated, sourceEnemy);
          if (projectile.kind === 'fire') addEffect(runtime, 'nova', player.x, player.y, now, 92, 0, 'enemy');
        }
        continue;
      }
      for (const enemy of runtime.enemies) {
        if (enemy.deadAt !== null || enemy.hp <= 0 || projectile.hitIds.has(enemy.id)) continue;
        if (magnitude(projectile.x - enemy.x, projectile.y - enemy.y) > projectile.radius + ENEMY_RADIUS) continue;
        projectile.hitIds.add(enemy.id);
        if (projectile.damage > 0) {
          damageEnemy(runtime, config, enemy, projectile.damage, now, {
            element: projectile.element,
            canProc: projectile.canProc,
          });
        }
        if (projectile.pierce <= 0) projectile.expiresAt = 0;
        else projectile.pierce -= 1;
        break;
      }
    }
    if (player.dead) runtime.projectiles = [];
    else settleEnemyDeaths(runtime, config, now, callbacks.onEnemyDefeated);
  } else {
    runtime.projectiles = [];
  }

  const livingEnemies = runtime.enemies.filter((enemy) => enemy.deadAt === null && enemy.hp > 0);
  const fieldBossId = availableFieldBoss(config);
  if (!fieldBossId) runtime.bossAnnouncedId = null;
  const fieldBossPending = Boolean(fieldBossId && runtime.bossAnnouncedId !== fieldBossId);
  if (!player.dead && fieldBossPending) {
    spawnNextFieldEnemy(runtime, config, now);
    runtime.nextSpawnAt = null;
  } else if (!player.dead && livingEnemies.length < FIELD_TARGET_POPULATION) {
    if (runtime.nextSpawnAt === null) {
      runtime.nextSpawnAt = now + FIELD_RESPAWN_MIN_MS
        + Math.random() * (FIELD_RESPAWN_MAX_MS - FIELD_RESPAWN_MIN_MS);
    } else if (now >= runtime.nextSpawnAt) {
      spawnNextFieldEnemy(runtime, config, now);
      runtime.nextSpawnAt = null;
    }
  } else {
    runtime.nextSpawnAt = null;
  }

  setAnimation(
    player,
    animationForActor(player.dead, now, player.hurtUntil, player.attackUntil, player.vx, player.vy, player.animation),
    now,
  );
  for (const enemy of runtime.enemies) {
    setAnimation(
      enemy,
      animationForActor(enemy.deadAt !== null, now, enemy.hurtUntil, enemy.attackUntil, enemy.vx, enemy.vy, enemy.animation),
      now,
    );
  }

  runtime.enemies = runtime.enemies.filter((enemy) => enemy.deadAt === null || now - enemy.deadAt < 1050);
  runtime.projectiles = runtime.projectiles.filter(
    (projectile) => projectile.expiresAt > now
      && projectile.x > -40
      && projectile.x < WORLD_WIDTH + 40
      && projectile.y > -40
      && projectile.y < WORLD_HEIGHT + 40,
  );
  runtime.effects = runtime.effects.filter((effect) => effect.expiresAt > now);
  runtime.floatingTexts = runtime.floatingTexts.filter((floatingText) => floatingText.expiresAt > now);
}

function positionStyle(x: number, y: number): CSSProperties {
  return {
    left: `${(x / WORLD_WIDTH) * 100}%`,
    top: `${(y / WORLD_HEIGHT) * 100}%`,
    zIndex: Math.round(y),
  };
}

export default function HackSlashArena({
  classId,
  playerName,
  level,
  hp,
  maxHp,
  attack,
  defense,
  crit = 0,
  attackSpeed = 1,
  castSpeed = 1,
  moveSpeed = 1,
  projectileSpeed = 1,
  combatModifiers,
  worldSeed,
  regionId,
  enemyIds,
  skills: skillLoadout,
  paused = false,
  initialCheckpoint = null,
  equippedWeapon = null,
  onEnemyDefeated,
  onPlayerDefeated,
  onRunExited,
}: HackSlashArenaProps) {
  const region = REGION_DEFINITIONS[regionId];
  const classDefinition = CLASS_DEFINITIONS[classId];
  const activeSkills = (skillLoadout !== undefined ? [...skillLoadout] : defaultSkills(classId)).slice(0, 6);
  const resolvedWorldSeed = worldSeed?.trim() || `${playerName}-${classId}-eternal-frontier`;
  const worldRuntimeRef = useRef<{
    seed: string;
    runtime: ReturnType<typeof createAdventureWorldRuntime>;
  } | null>(null);
  if (!worldRuntimeRef.current || worldRuntimeRef.current.seed !== resolvedWorldSeed) {
    worldRuntimeRef.current = {
      seed: resolvedWorldSeed,
      runtime: createAdventureWorldRuntime(resolvedWorldSeed, { maxCachedChunks: 72 }),
    };
  }
  const adventureWorldRuntime = worldRuntimeRef.current.runtime;
  const adventureWorld = adventureWorldRuntime.world;
  const fieldStartPosition = getAdventureRegionFrontierPosition(adventureWorld, regionId);
  const configRef = useRef<ArenaConfig>({
    classId,
    playerName,
    level,
    hp,
    maxHp,
    attack,
    defense,
    crit: clamp(crit, 0, 100),
    attackSpeed: playbackRate(attackSpeed * (combatModifiers?.attackSpeedMultiplier ?? 1)),
    castSpeed: playbackRate(castSpeed),
    moveSpeed: playbackRate(moveSpeed * (combatModifiers?.movementSpeedMultiplier ?? 1)),
    projectileSpeed: playbackRate(projectileSpeed * (combatModifiers?.projectileSpeedMultiplier ?? 1)),
    meleeReach: getMeleeWeaponReach(equippedWeapon?.itemKey),
    combatModifiers: combatModifiers ?? null,
    worldMinX: adventureWorld.bounds.minX,
    worldMaxX: adventureWorld.bounds.maxX,
    worldMinZ: adventureWorld.bounds.minZ,
    worldMaxZ: adventureWorld.bounds.maxZ,
    worldCollisionObstacles: [],
    regionId,
    enemyIds: enemyIds ?? region.enemyIds,
    skills: activeSkills,
    paused,
  });
  configRef.current = {
    classId,
    playerName,
    level,
    hp,
    maxHp,
    attack,
    defense,
    crit: clamp(crit, 0, 100),
    attackSpeed: playbackRate(attackSpeed * (combatModifiers?.attackSpeedMultiplier ?? 1)),
    castSpeed: playbackRate(castSpeed),
    moveSpeed: playbackRate(moveSpeed * (combatModifiers?.movementSpeedMultiplier ?? 1)),
    projectileSpeed: playbackRate(projectileSpeed * (combatModifiers?.projectileSpeedMultiplier ?? 1)),
    meleeReach: getMeleeWeaponReach(equippedWeapon?.itemKey),
    combatModifiers: combatModifiers ?? null,
    worldMinX: adventureWorld.bounds.minX,
    worldMaxX: adventureWorld.bounds.maxX,
    worldMinZ: adventureWorld.bounds.minZ,
    worldMaxZ: adventureWorld.bounds.maxZ,
    worldCollisionObstacles: configRef.current.worldCollisionObstacles,
    regionId,
    enemyIds: enemyIds ?? region.enemyIds,
    skills: activeSkills,
    paused,
  };

  const callbacksRef = useRef({ onEnemyDefeated, onPlayerDefeated, onRunExited });
  callbacksRef.current = { onEnemyDefeated, onPlayerDefeated, onRunExited };
  const initialCheckpointRef = useRef(initialCheckpoint);
  const runtimeRef = useRef<ArenaRuntime | null>(null);
  if (!runtimeRef.current) {
    runtimeRef.current = makeInitialRuntime(configRef.current);
    runtimeRef.current.worldCenterX = fieldStartPosition.x;
    runtimeRef.current.worldCenterZ = fieldStartPosition.z;
  }
  const [snapshot, setSnapshot] = useState<ArenaSnapshot>(() => makeSnapshot(runtimeRef.current!, 0));
  const heldDirectionsRef = useRef(new Set<MoveInput>());
  const animationFrameRef = useRef<number | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const threePointerHandledAtRef = useRef(0);
  const snapshotRef = useRef(0);
  const exitedCheckpointRef = useRef(new Set<string>());
  const discoveredChunksRef = useRef(new Set<string>());
  const worldSceneCacheRef = useRef<ArenaWorldSceneCache | null>(null);

  useEffect(() => {
    const runtime = runtimeRef.current!;
    const emittedCheckpoints = exitedCheckpointRef.current;
    const now = performance.now();
    runtime.worldCenterX = fieldStartPosition.x;
    runtime.worldCenterZ = fieldStartPosition.z;
    discoveredChunksRef.current.clear();
    worldSceneCacheRef.current = null;
    resetRun(runtime, configRef.current, now, initialCheckpointRef.current);
    runtime.lastFrameAt = now;
    heldDirectionsRef.current.clear();
    setSnapshot(makeSnapshot(runtime, now));
    return () => checkpointRunExit(runtime, callbacksRef.current.onRunExited, emittedCheckpoints);
  }, [classId, fieldStartPosition.x, fieldStartPosition.z, regionId, resolvedWorldSeed]);

  useEffect(() => {
    const runtime = runtimeRef.current!;
    const maxHpDifference = maxHp - runtime.player.maxHp;
    runtime.player.maxHp = maxHp;
    runtime.player.hp = clamp(runtime.player.hp + Math.max(0, maxHpDifference), 0, maxHp);
  }, [maxHp]);

  useEffect(() => {
    const runtime = runtimeRef.current!;
    runtime.player.hp = clamp(hp, 0, runtime.player.maxHp);
  }, [hp]);

  useEffect(() => {
    const tick = (now: number) => {
      const runtime = runtimeRef.current!;
      const deltaSeconds = Math.min(0.05, Math.max(0, (now - runtime.lastFrameAt) / 1000));
      runtime.lastFrameAt = now;
      updateRuntime(runtime, configRef.current, heldDirectionsRef.current, now, deltaSeconds, callbacksRef.current);
      if (now - snapshotRef.current >= RENDER_INTERVAL) {
        snapshotRef.current = now;
        setSnapshot(makeSnapshot(runtime, now));
      }
      animationFrameRef.current = requestAnimationFrame(tick);
    };
    animationFrameRef.current = requestAnimationFrame(tick);
    return () => {
      if (animationFrameRef.current !== null) cancelAnimationFrame(animationFrameRef.current);
    };
  }, []);

  const triggerAction = useCallback((action: ActionInput, aim?: { x: number; y: number }) => {
    const runtime = runtimeRef.current!;
    if (aim) {
      runtime.aimX = aim.x;
      runtime.aimY = aim.y;
    }
    performPlayerAction(runtime, configRef.current, action, performance.now(), Boolean(aim));
  }, []);

  useEffect(() => {
    const movementKeys: Record<string, MoveInput> = {
      ArrowUp: 'up',
      KeyW: 'up',
      ArrowDown: 'down',
      KeyS: 'down',
      ArrowLeft: 'left',
      KeyA: 'left',
      ArrowRight: 'right',
      KeyD: 'right',
    };
    const isEditable = (target: EventTarget | null) => {
      const element = target as HTMLElement | null;
      return element?.tagName === 'INPUT' || element?.tagName === 'TEXTAREA' || element?.isContentEditable;
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (isEditable(event.target)) return;
      const movement = movementKeys[event.code];
      if (movement) {
        heldDirectionsRef.current.add(movement);
        event.preventDefault();
        return;
      }
      if (event.code === 'Space') {
        triggerAction({ type: 'attack' });
        event.preventDefault();
        return;
      }
      const skill = configRef.current.skills.find((candidate, index) => (
        candidate.hotkey ?? DEFAULT_SKILL_HOTKEYS[index]
      ) === event.code);
      if (skill) {
        triggerAction({ type: 'skill', skillId: skill.id });
        event.preventDefault();
      }
    };
    const handleKeyUp = (event: KeyboardEvent) => {
      const movement = movementKeys[event.code];
      if (movement) heldDirectionsRef.current.delete(movement);
    };
    const clearKeys = () => heldDirectionsRef.current.clear();
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    window.addEventListener('blur', clearKeys);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      window.removeEventListener('blur', clearKeys);
    };
  }, [triggerAction]);

  const aimFromPointer = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const rect = stageRef.current?.getBoundingClientRect();
    if (!rect) return null;
    return {
      x: clamp(((event.clientX - rect.left) / rect.width) * WORLD_WIDTH, 0, WORLD_WIDTH),
      y: clamp(((event.clientY - rect.top) / rect.height) * WORLD_HEIGHT, 0, WORLD_HEIGHT),
    };
  }, []);

  const handleStagePointerMove = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.pointerType === 'touch') return;
    const aim = aimFromPointer(event);
    if (!aim) return;
    runtimeRef.current!.aimX = aim.x;
    runtimeRef.current!.aimY = aim.y;
  }, [aimFromPointer]);

  const handleStagePointerDown = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (performance.now() - threePointerHandledAtRef.current < 32) return;
    if ((event.target as HTMLElement).closest('button')) return;
    const aim = aimFromPointer(event);
    if (aim) {
      const runtime = runtimeRef.current!;
      runtime.attackTargetId = null;
      runtime.aimX = aim.x;
      runtime.aimY = aim.y;
      runtime.moveTargetX = aim.x;
      runtime.moveTargetY = aim.y;
    }
    stageRef.current?.focus({ preventScroll: true });
  }, [aimFromPointer]);

  const handle3DGroundPoint = useCallback((position: { x: number; y: number }) => {
    threePointerHandledAtRef.current = performance.now();
    const runtime = runtimeRef.current!;
    runtime.attackTargetId = null;
    runtime.aimX = clamp(position.x, 0, WORLD_WIDTH);
    runtime.aimY = clamp(position.y, 0, WORLD_HEIGHT);
    runtime.moveTargetX = runtime.aimX;
    runtime.moveTargetY = runtime.aimY;
    stageRef.current?.focus({ preventScroll: true });
  }, []);

  const handle3DGroundHover = useCallback((position: { x: number; y: number }) => {
    threePointerHandledAtRef.current = performance.now();
    const runtime = runtimeRef.current!;
    runtime.aimX = clamp(position.x, 0, WORLD_WIDTH);
    runtime.aimY = clamp(position.y, 0, WORLD_HEIGHT);
  }, []);

  const handle3DEnemyPoint = useCallback((enemyId: string) => {
    threePointerHandledAtRef.current = performance.now();
    const runtime = runtimeRef.current!;
    const enemy = runtime.enemies.find((candidate) => candidate.id === enemyId);
    if (!enemy || enemy.deadAt !== null || enemy.hp <= 0) return;
    runtime.attackTargetId = enemy.id;
    runtime.aimX = enemy.x;
    runtime.aimY = enemy.y;
    stageRef.current?.focus({ preventScroll: true });
  }, []);

  const pressDirection = useCallback((direction: MoveInput, pressed: boolean) => {
    if (pressed) heldDirectionsRef.current.add(direction);
    else heldDirectionsRef.current.delete(direction);
  }, []);

  const restart = useCallback(() => {
    const runtime = runtimeRef.current!;
    const now = performance.now();
    runtime.worldCenterX = fieldStartPosition.x;
    runtime.worldCenterZ = fieldStartPosition.z;
    discoveredChunksRef.current.clear();
    worldSceneCacheRef.current = null;
    resetRun(runtime, configRef.current, now);
    runtime.lastFrameAt = now;
    setSnapshot(makeSnapshot(runtime, now));
  }, [fieldStartPosition.x, fieldStartPosition.z]);

  const attackCooldown = Math.max(0, snapshot.player.nextAttackAt - snapshot.now);
  const playerRecovering = snapshot.now < snapshot.player.hurtUntil;
  const hpRatio = snapshot.player.maxHp > 0 ? snapshot.player.hp / snapshot.player.maxHp : 0;
  const livingEnemies = snapshot.enemies.filter((enemy) => enemy.deadAt === null && enemy.hp > 0);
  const engagedEnemies = livingEnemies.filter((enemy) => enemy.engaged);
  const livingBoss = livingEnemies.find((enemy) => ENEMY_DEFINITIONS[enemy.enemyId].boss);
  const arena3DSnapshot = make3DSnapshot(snapshot);
  let worldSceneCache = worldSceneCacheRef.current;
  const runtime = runtimeRef.current!;
  // Keep the render projection stable for the entire run. Combat coordinates
  // periodically rebase around the player, but moving the projection with them
  // forced every streamed terrain geometry to be rebuilt and caused a visible
  // hitch roughly once per second.
  const projection = !worldSceneCache || worldSceneCache.seed !== resolvedWorldSeed
    ? createWorldArenaProjection(
      fieldStartPosition,
      { arenaWidth: WORLD_WIDTH, arenaHeight: WORLD_HEIGHT, visibleWorldWidth: 192, visibleWorldHeight: 108 },
    )
    : worldSceneCache.projection;
  const playerWorldPosition = arenaPointToRuntimeWorld(runtime, snapshot.player.x, snapshot.player.y);
  const arenaOffsetX = (runtime.worldCenterX - projection.center.x) / WORLD_UNITS_PER_ARENA_PIXEL;
  const arenaOffsetY = (runtime.worldCenterZ - projection.center.z) / WORLD_UNITS_PER_ARENA_PIXEL;
  const playerChunk = worldToChunkCoordinate(adventureWorld, playerWorldPosition);
  const playerChunkId = playerChunk ? getOverworldChunkId(playerChunk) : '';
  if (!worldSceneCache || worldSceneCache.seed !== resolvedWorldSeed || worldSceneCache.centerChunkId !== playerChunkId) {
    const stream = adventureWorldRuntime.streamOverworld(playerWorldPosition, {
      radius: 2,
      revealRadius: 1,
      previouslyActiveChunkIds: worldSceneCache?.activeChunkIds,
      discoveredChunkIds: [...discoveredChunksRef.current],
    });
    for (const chunkId of stream.newlyDiscoveredChunkIds) discoveredChunksRef.current.add(chunkId);
    worldSceneCache = {
      seed: resolvedWorldSeed,
      projection,
      chunks: stream.chunks,
      centerChunkId: stream.centerChunkId,
      activeChunkIds: stream.activeChunkIds,
      arenaOffsetX,
      arenaOffsetY,
    };
  } else if (
    worldSceneCache.arenaOffsetX !== arenaOffsetX
    || worldSceneCache.arenaOffsetY !== arenaOffsetY
  ) {
    worldSceneCache = {
      ...worldSceneCache,
      arenaOffsetX,
      arenaOffsetY,
    };
  }
  worldSceneCacheRef.current = worldSceneCache;
  const worldScene: ArenaWorldScene = worldSceneCache;
  configRef.current.worldCollisionObstacles = worldScene.chunks
    .filter((chunk) => chunk.fogState === 'visible')
    .flatMap((chunk) => chunk.obstacles);

  return (
    <section className={styles.arenaShell} data-testid="hackslash-arena" aria-label={`${region.name} 실시간 전장`}>
      <div
        ref={stageRef}
        className={`${styles.stage} ${snapshot.player.dead ? styles.stageDefeat : ''}`}
        data-testid="hackslash-stage"
        onPointerDown={handleStagePointerDown}
        onPointerMove={handleStagePointerMove}
        role="application"
        tabIndex={0}
      >
        <HackSlashArena3D
          snapshot={arena3DSnapshot}
          classId={classId}
          equippedWeapon={equippedWeapon}
          attackSpeed={configRef.current.attackSpeed}
          castSpeed={configRef.current.castSpeed}
          moveSpeed={configRef.current.moveSpeed}
          worldScene={worldScene}
          onGroundPoint={handle3DGroundPoint}
          onGroundHover={handle3DGroundHover}
          onEnemyPoint={handle3DEnemyPoint}
        />

        <header className={styles.hud}>
          <div className={styles.playerHud}>
            <span className={styles.classSigil}><Swords size={18} /></span>
            <span className={styles.playerVitals}>
              <strong>{playerName}</strong>
              <span className={styles.healthTrack} role="progressbar" aria-label="생명력" aria-valuemin={0} aria-valuemax={snapshot.player.maxHp} aria-valuenow={Math.round(snapshot.player.hp)}>
                <span className={styles.healthFill} style={{ width: `${clamp(hpRatio * 100, 0, 100)}%` }} />
                <small>{Math.ceil(snapshot.player.hp)} / {snapshot.player.maxHp}</small>
              </span>
            </span>
          </div>
          <div className={styles.fieldHud} data-testid="field-status">
            <span>{region.name}</span>
            <strong>{livingBoss ? '우두머리 출현' : engagedEnemies.length > 0 ? '교전 중' : '필드 탐색'}</strong>
            <small>주변 {livingEnemies.length} · 누적 {snapshot.kills} 처치</small>
          </div>
        </header>

        <span className={styles.srOnly} data-testid="arena-player">
          레벨 {level} {classDefinition.name} {playerName}
        </span>
        {snapshot.enemies.map((enemy) => (
          <span
            className={styles.srOnly}
            data-attack-kind={enemy.attackKind}
            data-attack-pending={enemy.pendingAttackAt !== null || undefined}
            data-enemy-id={enemy.id}
            data-hp={Math.max(0, Math.round(enemy.hp))}
            data-max-hp={Math.round(enemy.maxHp)}
            data-testid="arena-enemy"
            data-elite={enemy.elite || undefined}
            key={enemy.id}
          >
            {enemy.elite ? `${ELITE_AFFIX_LABELS[enemy.affixes[0]]} ${enemy.name}` : enemy.name}
          </span>
        ))}

        {snapshot.floatingTexts.map((floatingText) => (
          <span
            key={floatingText.id}
            className={`${styles.floatingText} ${styles[`floating_${floatingText.tone}`]}`}
            style={positionStyle(floatingText.x, floatingText.y)}
          >
            {floatingText.text}
          </span>
        ))}

        {snapshot.announcement && <div className={styles.announcement} role="status">{snapshot.announcement}</div>}
        {paused && <div className={styles.pausedOverlay} role="status">일시 정지</div>}

        <div className={styles.touchControls} aria-label="이동 및 전투 조작">
          <div className={styles.directionPad}>
            {([
              ['up', styles.padUp, ArrowUp],
              ['left', styles.padLeft, ArrowLeft],
              ['right', styles.padRight, ArrowRight],
              ['down', styles.padDown, ArrowDown],
            ] as const).map(([direction, positionClass, Icon]) => (
              <button
                key={direction}
                type="button"
                className={`${styles.controlButton} ${styles.directionButton} ${positionClass}`}
                aria-label={`${direction === 'up' ? '위' : direction === 'down' ? '아래' : direction === 'left' ? '왼쪽' : '오른쪽'} 이동`}
                onPointerDown={(event) => {
                  event.stopPropagation();
                  event.currentTarget.setPointerCapture(event.pointerId);
                  pressDirection(direction, true);
                }}
                onPointerUp={(event) => {
                  event.stopPropagation();
                  pressDirection(direction, false);
                }}
                onPointerCancel={() => pressDirection(direction, false)}
              >
                <Icon size={20} />
              </button>
            ))}
            <span className={styles.padCenter} aria-hidden="true" />
          </div>

          <div className={styles.actionPad}>
            <div className={styles.skillGrid}>
              {activeSkills.map((skill, index) => {
                const cooldown = Math.max(0, Math.ceil(((snapshot.player.skillReadyAt[skill.id] ?? 0) - snapshot.now) / 1000));
                const hotkey = skill.hotkey ?? DEFAULT_SKILL_HOTKEYS[index];
                const Icon = index % 3 === 0 ? Zap : index % 3 === 1 ? Sparkles : Crosshair;
                return (
                  <button
                    key={skill.id}
                    type="button"
                    className={`${styles.controlButton} ${styles.skillButton} ${index % 2 === 1 ? styles.skillTwoButton : ''}`}
                    aria-label={skill.name}
                    aria-keyshortcuts={hotkey.startsWith('Key') ? hotkey.slice(3) : hotkey.startsWith('Digit') ? hotkey.slice(5) : hotkey}
                    title={skill.name}
                    disabled={playerRecovering || cooldown > 0 || snapshot.player.dead || skill.disabled || level < (skill.unlockLevel ?? 1)}
                    onPointerDown={(event) => {
                      event.stopPropagation();
                      triggerAction({ type: 'skill', skillId: skill.id });
                    }}
                  >
                    <Icon size={19} />
                    {cooldown > 0 && <span>{cooldown}</span>}
                  </button>
                );
              })}
            </div>
            <button
              type="button"
              className={`${styles.controlButton} ${styles.attackButton}`}
              aria-label="기본 공격"
              aria-keyshortcuts="Space"
              disabled={playerRecovering || attackCooldown > 0 || snapshot.player.dead}
              onPointerDown={(event) => { event.stopPropagation(); triggerAction({ type: 'attack' }); }}
            >
              <Swords size={27} />
            </button>
          </div>
        </div>

        {snapshot.player.dead && (
          <div className={styles.defeatPanel} role="status" aria-label="전투 불능">
            <ShieldAlert size={30} />
            <strong>전투 불능</strong>
            <span>{region.name} · {snapshot.kills} 처치</span>
            <button type="button" onClick={restart}><RotateCcw size={17} /> 야영지에서 회복</button>
          </div>
        )}
      </div>
      <span className={styles.srOnly} aria-live="polite">
        생명력 {Math.ceil(snapshot.player.hp)}, 주변 적 {livingEnemies.length}명, 누적 {snapshot.kills} 처치
      </span>
    </section>
  );
}
