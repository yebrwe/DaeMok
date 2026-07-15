import type {
  CharacterClassId,
  EliteAffix,
  EquipmentRarity,
} from '@/lib/adventure';

export const ARENA_WORLD_WIDTH = 960;
export const ARENA_WORLD_HEIGHT = 540;
export const ARENA_WORLD_SCALE = 70;

export type Arena3DDirection =
  | 'south'
  | 'southwest'
  | 'west'
  | 'northwest'
  | 'north'
  | 'northeast'
  | 'east'
  | 'southeast';

export type Arena3DAnimation = 'idle' | 'walk' | 'attack' | 'skill1' | 'skill2' | 'hit' | 'death';
export type Arena3DUnitId = CharacterClassId
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
export type Arena3DProjectileId = 'arrow' | 'arcane' | 'fire';
export type Arena3DEffectId = 'slash' | 'arrow' | 'nova' | 'impact' | 'loot' | 'heal';
export type Arena3DAttackKind = 'melee' | 'arcane' | 'fire';

export interface Arena3DActorAnimationState {
  animation: Arena3DAnimation;
  animationStartedAt: number;
  direction: Arena3DDirection;
  /** Absolute runtime timestamp. Supplying this keeps the visual strike on the damage-resolution frame. */
  impactAt?: number | null;
  /** Optional base duration before `animationRate` is applied. */
  animationDurationMs?: number;
  /** Optional base strike offset from `animationStartedAt`, before `animationRate` is applied. */
  impactAtMs?: number;
  /** Per-actor playback multiplier. Attack/cast speed can be folded into this by the runtime. */
  animationRate?: number;
  /** Normalized locomotion-rate multiplier used by walk cycles. */
  moveSpeed?: number;
}

export interface Arena3DPlayer extends Arena3DActorAnimationState {
  x: number;
  y: number;
  vx: number;
  vy: number;
  hp: number;
  maxHp: number;
  dead?: boolean;
  hurtUntil?: number;
}

export interface Arena3DEnemy extends Arena3DActorAnimationState {
  id: string;
  unitId: Arena3DUnitId;
  name: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  hp: number;
  maxHp: number;
  speed: number;
  elite: boolean;
  boss: boolean;
  affixes: EliteAffix[];
  attackKind: Arena3DAttackKind;
  pendingAttackAt?: number | null;
  hurtUntil?: number;
  deadAt: number | null;
}

export interface Arena3DProjectile {
  id: number;
  kind: Arena3DProjectileId;
  team: 'friendly' | 'hostile';
  startedAt: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  expiresAt: number;
}

export interface Arena3DEffect {
  id: number;
  kind: Arena3DEffectId;
  source: 'player' | 'enemy' | 'system';
  startedAt: number;
  x: number;
  y: number;
  angle: number;
  expiresAt: number;
  size: number;
}

export interface HackSlashArena3DSnapshot {
  now: number;
  player: Arena3DPlayer;
  aimX: number;
  aimY: number;
  enemies: Arena3DEnemy[];
  projectiles: Arena3DProjectile[];
  effects: Arena3DEffect[];
}

export interface Arena3DMotionSample {
  x: number;
  y: number;
  vx: number;
  vy: number;
  sampledAt: number;
}

/**
 * Projects a simulation sample to the render timestamp. The short prediction
 * window fills the gap between 30 Hz combat snapshots without letting a stale
 * input keep an actor moving after the simulation has stopped.
 */
export function projectArenaMotion(
  sample: Arena3DMotionSample,
  renderAt: number,
  maxPredictionMs = 75,
) {
  const elapsedSeconds = Math.min(
    Math.max(0, maxPredictionMs),
    Math.max(0, renderAt - sample.sampledAt),
  ) / 1000;
  return {
    x: sample.x + sample.vx * elapsedSeconds,
    y: sample.y + sample.vy * elapsedSeconds,
  };
}

export interface Arena3DEquippedWeapon {
  itemKey: string;
  rarity: EquipmentRarity;
  classId: CharacterClassId;
}

export interface Arena3DAnimationTiming {
  impactMs: number;
  durationMs: number;
  impactHoldMs: number;
}

export type Arena3DAnimationPhase =
  | 'idle'
  | 'locomotion'
  | 'windup'
  | 'impact'
  | 'recovery'
  | 'hit'
  | 'death'
  | 'complete';

export interface ResolveArena3DAnimationInput {
  unitId: Arena3DUnitId;
  animation: Arena3DAnimation;
  animationStartedAt: number;
  now: number;
  attackKind?: Arena3DAttackKind;
  /** Absolute runtime timestamp, normally PendingPlayerAction.executeAt or enemy.pendingAttackAt. */
  impactAt?: number | null;
  animationDurationMs?: number;
  impactAtMs?: number;
  animationRate?: number;
  /** Positive multipliers. A value of 1 uses the combat runtime's current baseline timings. */
  attackSpeed?: number;
  moveSpeed?: number;
  castSpeed?: number;
}

export interface Arena3DAnimationClock {
  elapsedMs: number;
  durationMs: number;
  impactMs: number;
  progress: number;
  phase: Arena3DAnimationPhase;
  phaseProgress: number;
  loopProgress: number;
}

export const DEFAULT_ARENA_3D_TIMINGS = {
  playerAttackImpactMs: {
    vanguard: 260,
    ranger: 390,
    mystic: 430,
  },
  skillImpactMs: {
    skill1: 410,
    skill2: 520,
  },
  enemyAttackImpactMs: {
    melee: 360,
    arcane: 460,
    fire: 580,
  },
  combatDurationMs: 1000,
  impactHoldMs: 90,
  hitDurationMs: 360,
  deathDurationMs: 820,
  walkCycleMs: 640,
  idleCycleMs: 1800,
} as const;

function positiveSpeed(value: number | undefined) {
  return Number.isFinite(value) && value! > 0 ? value! : 1;
}

function clamp01(value: number) {
  return Math.min(1, Math.max(0, value));
}

function defaultImpactMs(
  unitId: Arena3DUnitId,
  animation: Arena3DAnimation,
  attackKind: Arena3DAttackKind | undefined,
) {
  if (animation === 'skill1' || animation === 'skill2') {
    return DEFAULT_ARENA_3D_TIMINGS.skillImpactMs[animation];
  }
  if (unitId === 'vanguard' || unitId === 'ranger' || unitId === 'mystic') {
    return DEFAULT_ARENA_3D_TIMINGS.playerAttackImpactMs[unitId];
  }
  return DEFAULT_ARENA_3D_TIMINGS.enemyAttackImpactMs[attackKind ?? 'melee'];
}

/**
 * Resolves a deterministic animation clock from combat runtime timestamps.
 * The explicit impact timestamp always wins, so hit visuals can share the exact damage frame.
 */
export function resolveArena3DAnimationClock({
  unitId,
  animation,
  animationStartedAt,
  now,
  attackKind,
  impactAt,
  animationDurationMs,
  impactAtMs,
  animationRate,
  attackSpeed,
  moveSpeed,
  castSpeed,
}: ResolveArena3DAnimationInput): Arena3DAnimationClock {
  const elapsedMs = Math.max(0, now - animationStartedAt);

  if (animation === 'idle') {
    const durationMs = DEFAULT_ARENA_3D_TIMINGS.idleCycleMs;
    return {
      elapsedMs,
      durationMs,
      impactMs: 0,
      progress: (elapsedMs % durationMs) / durationMs,
      phase: 'idle',
      phaseProgress: (elapsedMs % durationMs) / durationMs,
      loopProgress: (elapsedMs % durationMs) / durationMs,
    };
  }

  if (animation === 'walk') {
    const durationMs = DEFAULT_ARENA_3D_TIMINGS.walkCycleMs / positiveSpeed(moveSpeed);
    const loopProgress = (elapsedMs % durationMs) / durationMs;
    return {
      elapsedMs,
      durationMs,
      impactMs: 0,
      progress: loopProgress,
      phase: 'locomotion',
      phaseProgress: loopProgress,
      loopProgress,
    };
  }

  if (animation === 'hit') {
    const durationMs = DEFAULT_ARENA_3D_TIMINGS.hitDurationMs;
    const progress = clamp01(elapsedMs / durationMs);
    return { elapsedMs, durationMs, impactMs: 0, progress, phase: 'hit', phaseProgress: progress, loopProgress: 0 };
  }

  if (animation === 'death') {
    const durationMs = DEFAULT_ARENA_3D_TIMINGS.deathDurationMs;
    const progress = clamp01(elapsedMs / durationMs);
    return { elapsedMs, durationMs, impactMs: 0, progress, phase: 'death', phaseProgress: progress, loopProgress: 0 };
  }

  const speed = animationRate == null
    ? positiveSpeed(animation === 'attack' ? attackSpeed : castSpeed)
    : positiveSpeed(animationRate);
  const fallbackImpactMs = (impactAtMs ?? defaultImpactMs(unitId, animation, attackKind)) / speed;
  const explicitImpactMs = impactAt == null ? null : Math.max(0, impactAt - animationStartedAt);
  const resolvedImpactMs = explicitImpactMs ?? fallbackImpactMs;
  const impactHoldMs = DEFAULT_ARENA_3D_TIMINGS.impactHoldMs / speed;
  // Runtime-provided durations are already scaled alongside their absolute impact timestamp.
  const baselineDurationMs = animationDurationMs
    ?? DEFAULT_ARENA_3D_TIMINGS.combatDurationMs / speed;
  const durationMs = Math.max(baselineDurationMs, resolvedImpactMs + impactHoldMs + 160 / speed);
  const progress = clamp01(elapsedMs / durationMs);

  if (elapsedMs < resolvedImpactMs) {
    return {
      elapsedMs,
      durationMs,
      impactMs: resolvedImpactMs,
      progress,
      phase: 'windup',
      phaseProgress: clamp01(elapsedMs / Math.max(1, resolvedImpactMs)),
      loopProgress: 0,
    };
  }
  if (elapsedMs < resolvedImpactMs + impactHoldMs) {
    return {
      elapsedMs,
      durationMs,
      impactMs: resolvedImpactMs,
      progress,
      phase: 'impact',
      phaseProgress: clamp01((elapsedMs - resolvedImpactMs) / impactHoldMs),
      loopProgress: 0,
    };
  }
  if (elapsedMs < durationMs) {
    return {
      elapsedMs,
      durationMs,
      impactMs: resolvedImpactMs,
      progress,
      phase: 'recovery',
      phaseProgress: clamp01((elapsedMs - resolvedImpactMs - impactHoldMs) / Math.max(1, durationMs - resolvedImpactMs - impactHoldMs)),
      loopProgress: 0,
    };
  }
  return {
    elapsedMs,
    durationMs,
    impactMs: resolvedImpactMs,
    progress: 1,
    phase: 'complete',
    phaseProgress: 1,
    loopProgress: 0,
  };
}

export function arenaWorldToScene(x: number, y: number): [number, number, number] {
  return [
    (x - ARENA_WORLD_WIDTH / 2) / ARENA_WORLD_SCALE,
    0,
    (y - ARENA_WORLD_HEIGHT / 2) / ARENA_WORLD_SCALE,
  ];
}
