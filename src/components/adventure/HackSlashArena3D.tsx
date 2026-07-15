'use client';

import { Html } from '@react-three/drei';
import { Canvas, useFrame, useThree, type ThreeEvent } from '@react-three/fiber';
import {
  memo,
  useMemo,
  useRef,
  type MutableRefObject,
  type ReactNode,
} from 'react';
import * as THREE from 'three';
import type { CharacterClassId, EquipmentRarity } from '@/lib/adventure';
import AdventureWorldLayer3D, {
  type AdventureWorldLayer3DProps,
} from './AdventureWorldLayer3D';
import {
  ARENA_WORLD_HEIGHT,
  ARENA_WORLD_SCALE,
  ARENA_WORLD_WIDTH,
  arenaWorldToScene,
  projectArenaMotion,
  resolveArena3DAnimationClock,
  type Arena3DActorAnimationState,
  type Arena3DAttackKind,
  type Arena3DAnimationClock,
  type Arena3DDirection,
  type Arena3DEffect,
  type Arena3DEnemy,
  type Arena3DEquippedWeapon,
  type Arena3DProjectile,
  type Arena3DUnitId,
  type HackSlashArena3DSnapshot,
} from './HackSlashArena3D.types';
import styles from './HackSlashArena3D.module.css';

const PLAYER_TIMING_KEY = 'player';
const DIRECTION_YAW: Record<Arena3DDirection, number> = {
  south: 0,
  southwest: -Math.PI / 4,
  west: -Math.PI / 2,
  northwest: -Math.PI * 0.75,
  north: Math.PI,
  northeast: Math.PI * 0.75,
  east: Math.PI / 2,
  southeast: Math.PI / 4,
};

const RARITY_COLOR: Record<EquipmentRarity, string> = {
  common: '#c7c4b8',
  uncommon: '#72c98d',
  rare: '#62a8ef',
  epic: '#c879e4',
  legendary: '#f1b956',
};

const HERO_PALETTE: Record<CharacterClassId, HumanoidPalette> = {
  vanguard: {
    skin: '#b98a6c',
    cloth: '#472527',
    armor: '#41484b',
    trim: '#81765f',
    dark: '#1b1f21',
  },
  ranger: {
    skin: '#bd8c68',
    cloth: '#405248',
    armor: '#654d3d',
    trim: '#9f946e',
    dark: '#25332a',
  },
  mystic: {
    skin: '#a97b69',
    cloth: '#41445b',
    armor: '#3b5a5c',
    trim: '#579c99',
    dark: '#24263b',
  },
};

const ENEMY_PALETTE: Record<'bandit' | 'sentinel' | 'demon', HumanoidPalette> = {
  bandit: {
    skin: '#936650',
    cloth: '#55332c',
    armor: '#6b5a4a',
    trim: '#b07446',
    dark: '#24201f',
  },
  sentinel: {
    skin: '#595f5d',
    cloth: '#3a403e',
    armor: '#777f78',
    trim: '#5f968b',
    dark: '#252b2a',
  },
  demon: {
    skin: '#843e36',
    cloth: '#402026',
    armor: '#29272b',
    trim: '#e06a3e',
    dark: '#151419',
  },
};

const HUMANOID_TORSO_PROFILE = [
  new THREE.Vector2(0.26, 0),
  new THREE.Vector2(0.31, 0.1),
  new THREE.Vector2(0.32, 0.3),
  new THREE.Vector2(0.39, 0.54),
  new THREE.Vector2(0.35, 0.68),
  new THREE.Vector2(0.24, 0.75),
];

const HUMANOID_PELVIS_PROFILE = [
  new THREE.Vector2(0.27, 0),
  new THREE.Vector2(0.34, 0.12),
  new THREE.Vector2(0.31, 0.26),
  new THREE.Vector2(0.27, 0.34),
];

const VANGUARD_SHIELD_SHAPE = new THREE.Shape();
VANGUARD_SHIELD_SHAPE.moveTo(0, 0.38);
VANGUARD_SHIELD_SHAPE.lineTo(0.29, 0.24);
VANGUARD_SHIELD_SHAPE.lineTo(0.25, -0.12);
VANGUARD_SHIELD_SHAPE.quadraticCurveTo(0.16, -0.39, 0, -0.52);
VANGUARD_SHIELD_SHAPE.quadraticCurveTo(-0.16, -0.39, -0.25, -0.12);
VANGUARD_SHIELD_SHAPE.lineTo(-0.29, 0.24);
VANGUARD_SHIELD_SHAPE.closePath();

const VANGUARD_SHIELD_EXTRUDE: THREE.ExtrudeGeometryOptions = {
  depth: 0.065,
  bevelEnabled: true,
  bevelSegments: 1,
  bevelSize: 0.018,
  bevelThickness: 0.018,
  curveSegments: 2,
  steps: 1,
};

const ROBE_PROFILE = [
  new THREE.Vector2(0.44, 0),
  new THREE.Vector2(0.4, 0.12),
  new THREE.Vector2(0.32, 0.42),
  new THREE.Vector2(0.27, 0.72),
];

const TREANT_TRUNK_PROFILE = [
  new THREE.Vector2(0.31, 0),
  new THREE.Vector2(0.25, 0.22),
  new THREE.Vector2(0.3, 0.5),
  new THREE.Vector2(0.37, 0.78),
  new THREE.Vector2(0.29, 1.08),
  new THREE.Vector2(0.2, 1.25),
];

const SPIDER_LEG_LAYOUT = [
  { side: -1 as const, z: 0.38 },
  { side: -1 as const, z: 0.14 },
  { side: -1 as const, z: -0.12 },
  { side: -1 as const, z: -0.36 },
  { side: 1 as const, z: 0.38 },
  { side: 1 as const, z: 0.14 },
  { side: 1 as const, z: -0.12 },
  { side: 1 as const, z: -0.36 },
];

type HumanoidVariant = CharacterClassId | 'bandit' | 'sentinel' | 'demon';

type WeaponRegion = 'field' | 'forest' | 'ruins' | 'crater';

interface WeaponVisualProfile {
  swordLength: number;
  swordWidth: number;
  bowRadius: number;
  bowArc: number;
  staffLength: number;
  staffHead: 'crystal' | 'antler' | 'halo' | 'ember';
}

const WEAPON_VISUAL_PROFILES: Record<WeaponRegion, WeaponVisualProfile> = {
  field: { swordLength: 0.68, swordWidth: 0.068, bowRadius: 0.3, bowArc: 1.5, staffLength: 1.48, staffHead: 'crystal' },
  forest: { swordLength: 0.82, swordWidth: 0.076, bowRadius: 0.37, bowArc: 1.68, staffLength: 1.62, staffHead: 'antler' },
  ruins: { swordLength: 0.63, swordWidth: 0.105, bowRadius: 0.32, bowArc: 1.34, staffLength: 1.52, staffHead: 'halo' },
  crater: { swordLength: 0.78, swordWidth: 0.09, bowRadius: 0.34, bowArc: 1.82, staffLength: 1.68, staffHead: 'ember' },
};

function getWeaponVisualProfile(itemKey: string): WeaponVisualProfile {
  const region = (Object.keys(WEAPON_VISUAL_PROFILES) as WeaponRegion[])
    .find((candidate) => itemKey.startsWith(`${candidate}_`));
  return WEAPON_VISUAL_PROFILES[region ?? 'field'];
}

export interface HackSlashArena3DProps {
  snapshot: HackSlashArena3DSnapshot;
  classId: CharacterClassId;
  equippedWeapon?: Arena3DEquippedWeapon | null;
  /** Positive animation-rate multipliers. Runtime positions remain authoritative. */
  attackSpeed?: number;
  moveSpeed?: number;
  castSpeed?: number;
  /** Absolute timestamps keyed by `player` or enemy id. These override fallback strike timing. */
  impactTimes?: Readonly<Record<string, number | null | undefined>>;
  worldScene?: AdventureWorldLayer3DProps & {
    centerChunkId: string;
    /** Arena-space delta from the stable world projection origin. */
    arenaOffsetX?: number;
    arenaOffsetY?: number;
  };
  onGroundPoint?: (position: { x: number; y: number }, pointerType: string) => void;
  onGroundHover?: (position: { x: number; y: number }) => void;
  onEnemyPoint?: (enemyId: string) => void;
  className?: string;
}

interface AnimationRates {
  attackSpeed: number;
  moveSpeed: number;
  castSpeed: number;
}

interface HumanoidPalette {
  skin: string;
  cloth: string;
  armor: string;
  trim: string;
  dark: string;
}

interface AnimatedActorProps extends Arena3DActorAnimationState {
  unitId: Arena3DUnitId;
  now: number;
  attackKind?: Arena3DAttackKind;
  rates: AnimationRates;
  impactAt?: number | null;
}

interface LimbRefs {
  root: MutableRefObject<THREE.Group | null>;
  joint: MutableRefObject<THREE.Group | null>;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function easeInOut(value: number) {
  const bounded = clamp(value, 0, 1);
  return bounded * bounded * (3 - 2 * bounded);
}

function easeOut(value: number) {
  const bounded = clamp(value, 0, 1);
  return 1 - (1 - bounded) ** 3;
}

interface GaitSample {
  hip: number;
  knee: number;
  lift: number;
  contact: number;
}

/**
 * Splits a step into a short airborne swing and a longer planted stance.
 * Keeping the planted part almost flat prevents the feet from looking like
 * pendulums while the actor translates through the world.
 */
function sampleGait(loopProgress: number, offset = 0): GaitSample {
  const phase = ((loopProgress + offset) % 1 + 1) % 1;
  const swingEnd = 0.38;
  if (phase < swingEnd) {
    const swing = easeInOut(phase / swingEnd);
    return {
      hip: -0.82 + swing * 1.64,
      knee: Math.sin(swing * Math.PI) * 0.92 + 0.08,
      lift: Math.sin(swing * Math.PI),
      contact: 0,
    };
  }
  const stance = easeInOut((phase - swingEnd) / (1 - swingEnd));
  return {
    hip: 0.82 - stance * 1.64,
    knee: 0.08 + Math.sin(stance * Math.PI) * 0.08,
    lift: 0,
    contact: Math.sin(stance * Math.PI),
  };
}

function applyRotation(ref: MutableRefObject<THREE.Group | null>, x: number, y = 0, z = 0) {
  ref.current?.rotation.set(x, y, z);
}

function actorClock(props: AnimatedActorProps) {
  return resolveArena3DAnimationClock({
    unitId: props.unitId,
    animation: props.animation,
    animationStartedAt: props.animationStartedAt,
    // The simulation snapshot is intentionally 30 Hz. Pose evaluation must use
    // the current render timestamp or every limb also moves at only 30 fps.
    now: typeof performance === 'undefined' ? props.now : performance.now(),
    attackKind: props.attackKind,
    impactAt: props.impactAt,
    animationDurationMs: props.animationDurationMs,
    impactAtMs: props.impactAtMs,
    animationRate: props.animationRate,
    attackSpeed: props.rates.attackSpeed,
    moveSpeed: props.moveSpeed ?? props.rates.moveSpeed,
    castSpeed: props.rates.castSpeed,
  });
}

function actorYaw(direction: Arena3DDirection) {
  return DIRECTION_YAW[direction];
}

function equipmentColor(rarity: EquipmentRarity) {
  return RARITY_COLOR[rarity];
}

interface ArenaRenderOffset {
  x: number;
  y: number;
}

function renderPosition(
  x: number,
  y: number,
  offset: ArenaRenderOffset,
): [number, number, number] {
  return arenaWorldToScene(x + offset.x, y + offset.y);
}

function SmoothArenaPosition({
  x,
  y,
  vx,
  vy,
  sampledAt,
  offset,
  height = 0,
  children,
}: {
  x: number;
  y: number;
  vx: number;
  vy: number;
  sampledAt: number;
  offset: ArenaRenderOffset;
  height?: number;
  children: ReactNode;
}) {
  const group = useRef<THREE.Group>(null);
  const sample = useRef({ x, y, vx, vy, sampledAt, offsetX: offset.x, offsetY: offset.y });
  sample.current = { x, y, vx, vy, sampledAt, offsetX: offset.x, offsetY: offset.y };
  const initialPosition = useRef(renderPosition(x, y, offset));

  useFrame(() => {
    if (!group.current) return;
    const current = sample.current;
    const projected = projectArenaMotion(current, performance.now());
    const [sceneX, , sceneZ] = arenaWorldToScene(
      projected.x + current.offsetX,
      projected.y + current.offsetY,
    );
    group.current.position.set(sceneX, height, sceneZ);
  });

  return <group ref={group} position={initialPosition.current}>{children}</group>;
}

function ArenaCamera({
  playerX,
  playerY,
  playerVx,
  playerVy,
  sampledAt,
  offset,
}: {
  playerX: number;
  playerY: number;
  playerVx: number;
  playerVy: number;
  sampledAt: number;
  offset: ArenaRenderOffset;
}) {
  const { camera, size } = useThree();
  const smoothedTarget = useRef(new THREE.Vector3());
  const desiredTarget = useRef(new THREE.Vector3());
  const initialized = useRef(false);
  const sample = useRef({
    x: playerX,
    y: playerY,
    vx: playerVx,
    vy: playerVy,
    sampledAt,
    offsetX: offset.x,
    offsetY: offset.y,
  });
  sample.current = {
    x: playerX,
    y: playerY,
    vx: playerVx,
    vy: playerVy,
    sampledAt,
    offsetX: offset.x,
    offsetY: offset.y,
  };

  useFrame((_, delta) => {
    if (!(camera instanceof THREE.OrthographicCamera)) return;
    const current = sample.current;
    const projected = projectArenaMotion(current, performance.now());
    const [followX, , followZ] = arenaWorldToScene(
      projected.x + current.offsetX,
      projected.y + current.offsetY,
    );
    desiredTarget.current.set(followX, 0.55, followZ);
    if (!initialized.current) {
      smoothedTarget.current.copy(desiredTarget.current);
      initialized.current = true;
    }
    const smoothing = 1 - Math.exp(-delta * 5.5);
    smoothedTarget.current.lerp(desiredTarget.current, smoothing);
    // Position and look target share the same smoothed origin. This preserves a
    // fixed isometric angle instead of tilting the camera on every movement step.
    camera.position.set(
      smoothedTarget.current.x + 8.4,
      smoothedTarget.current.y + 10.25,
      smoothedTarget.current.z + 8.4,
    );
    camera.lookAt(smoothedTarget.current);

    const portrait = size.width / Math.max(1, size.height) < 0.9;
    const visibleWidth = portrait ? 11.2 : 16.2;
    const visibleHeight = portrait ? 11.8 : 10.7;
    const nextZoom = Math.max(20, Math.min(size.width / visibleWidth, size.height / visibleHeight));
    if (Math.abs(camera.zoom - nextZoom) > 0.01) {
      camera.zoom = nextZoom;
      camera.updateProjectionMatrix();
    }
  });

  return null;
}

function ArenaLighting({
  playerX,
  playerY,
  playerVx,
  playerVy,
  sampledAt,
  offset,
}: {
  playerX: number;
  playerY: number;
  playerVx: number;
  playerVy: number;
  sampledAt: number;
  offset: ArenaRenderOffset;
}) {
  const { size } = useThree();
  const directional = useRef<THREE.DirectionalLight>(null);
  const fill = useRef<THREE.PointLight>(null);
  const frontFill = useRef<THREE.PointLight>(null);
  const target = useMemo(() => new THREE.Object3D(), []);
  const shadowMapSize = size.width < 600 ? 512 : 1024;
  const sample = useRef({
    x: playerX,
    y: playerY,
    vx: playerVx,
    vy: playerVy,
    sampledAt,
    offsetX: offset.x,
    offsetY: offset.y,
  });
  sample.current = {
    x: playerX,
    y: playerY,
    vx: playerVx,
    vy: playerVy,
    sampledAt,
    offsetX: offset.x,
    offsetY: offset.y,
  };

  useFrame(() => {
    const current = sample.current;
    const projected = projectArenaMotion(current, performance.now());
    const [sceneX, , sceneZ] = arenaWorldToScene(
      projected.x + current.offsetX,
      projected.y + current.offsetY,
    );
    target.position.set(sceneX, 0, sceneZ);
    directional.current?.position.set(sceneX - 5, 10, sceneZ + 4);
    fill.current?.position.set(sceneX, 4, sceneZ - 2);
    frontFill.current?.position.set(sceneX + 3.5, 4.8, sceneZ + 4.5);
  });

  return (
    <>
      <primitive object={target} />
      <directionalLight
        ref={directional}
        target={target}
        castShadow={size.width >= 600}
        color="#f1d5ab"
        intensity={3.35}
        position={[-5, 10, 4]}
        shadow-mapSize-width={shadowMapSize}
        shadow-mapSize-height={shadowMapSize}
        shadow-camera-left={-9}
        shadow-camera-right={9}
        shadow-camera-top={7}
        shadow-camera-bottom={-7}
        shadow-bias={-0.00015}
      />
      <pointLight ref={fill} color="#83b1aa" intensity={1.38} distance={13} position={[0, 4, -2]} />
      <pointLight ref={frontFill} color="#e2bd98" intensity={1.9} distance={11} position={[3.5, 4.8, 4.5]} />
    </>
  );
}

function StoneFloor() {
  const tiles = useMemo(() => {
    const values: Array<{ key: string; x: number; z: number; lift: number; tone: string }> = [];
    for (let row = -4; row <= 4; row += 1) {
      for (let column = -7; column <= 7; column += 1) {
        const seed = Math.abs((column * 37 + row * 71) % 9);
        values.push({
          key: `${column}:${row}`,
          x: column * 1.02 + (row % 2 === 0 ? 0 : 0.16),
          z: row * 1.02,
          lift: seed % 3 === 0 ? 0.015 : 0,
          tone: seed < 3 ? '#242725' : seed < 6 ? '#2b2d29' : '#30312d',
        });
      }
    }
    return values;
  }, []);

  return (
    <group>
      <mesh receiveShadow rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.075, 0]}>
        <planeGeometry args={[19, 12]} />
        <meshStandardMaterial color="#171a18" roughness={1} />
      </mesh>
      {tiles.map((tile) => (
        <mesh key={tile.key} receiveShadow position={[tile.x, -0.035 + tile.lift, tile.z]}>
          <boxGeometry args={[0.98, 0.07, 0.98]} />
          <meshStandardMaterial color={tile.tone} roughness={0.92} metalness={0.03} />
        </mesh>
      ))}
      <ArenaBoundary />
      <DungeonProps />
    </group>
  );
}

function ArenaBoundary() {
  return (
    <group>
      {[-4.75, 4.75].map((z) => (
        <mesh key={`edge-z-${z}`} receiveShadow castShadow position={[0, 0.22, z]}>
          <boxGeometry args={[16.4, 0.5, 0.36]} />
          <meshStandardMaterial color="#292723" roughness={0.95} />
        </mesh>
      ))}
      {[-8.1, 8.1].map((x) => (
        <mesh key={`edge-x-${x}`} receiveShadow castShadow position={[x, 0.22, 0]}>
          <boxGeometry args={[0.36, 0.5, 9.2]} />
          <meshStandardMaterial color="#292723" roughness={0.95} />
        </mesh>
      ))}
    </group>
  );
}

function Brazier({ position, color }: { position: [number, number, number]; color: string }) {
  return (
    <group position={position}>
      <mesh castShadow position={[0, 0.38, 0]}>
        <cylinderGeometry args={[0.22, 0.15, 0.65, 8]} />
        <meshStandardMaterial color="#3a3430" roughness={0.72} metalness={0.35} />
      </mesh>
      <mesh castShadow position={[0, 0.76, 0]}>
        <dodecahedronGeometry args={[0.19, 0]} />
        <meshStandardMaterial color={color} emissive={color} emissiveIntensity={3.4} roughness={0.35} />
      </mesh>
      <pointLight color={color} intensity={2.5} distance={4.4} decay={2} position={[0, 1, 0]} />
    </group>
  );
}

function BrokenColumn({ position, rotation = 0 }: { position: [number, number, number]; rotation?: number }) {
  return (
    <group position={position} rotation={[0, rotation, 0]}>
      <mesh castShadow receiveShadow position={[0, 0.13, 0]}>
        <cylinderGeometry args={[0.42, 0.48, 0.26, 8]} />
        <meshStandardMaterial color="#44443e" roughness={0.97} />
      </mesh>
      <mesh castShadow receiveShadow position={[0.04, 0.66, 0]} rotation={[0.07, 0, 0.08]}>
        <cylinderGeometry args={[0.27, 0.33, 0.92, 8]} />
        <meshStandardMaterial color="#3d403c" roughness={0.96} />
      </mesh>
      <mesh castShadow receiveShadow position={[0.56, 0.13, 0.2]} rotation={[0.12, 0.4, Math.PI / 2]}>
        <cylinderGeometry args={[0.17, 0.22, 0.72, 7]} />
        <meshStandardMaterial color="#343734" roughness={0.98} />
      </mesh>
    </group>
  );
}

function DungeonProps() {
  return (
    <group>
      <Brazier position={[-6.7, 0, -3.65]} color="#df7438" />
      <Brazier position={[6.65, 0, 3.55]} color="#49aeb2" />
      <BrokenColumn position={[6.65, 0, -3.5]} rotation={0.4} />
      <BrokenColumn position={[-6.5, 0, 3.45]} rotation={-0.7} />
      <mesh castShadow receiveShadow position={[4.75, 0.12, -3.85]} rotation={[0.1, 0.25, 0.06]}>
        <dodecahedronGeometry args={[0.42, 0]} />
        <meshStandardMaterial color="#353934" roughness={1} />
      </mesh>
      <mesh castShadow receiveShadow position={[-4.9, 0.1, 3.88]} rotation={[0.12, -0.3, 0]}>
        <dodecahedronGeometry args={[0.36, 0]} />
        <meshStandardMaterial color="#373632" roughness={1} />
      </mesh>
    </group>
  );
}

function Arm({
  side,
  refs,
  palette,
  armored,
  hand,
}: {
  side: -1 | 1;
  refs: LimbRefs;
  palette: HumanoidPalette;
  armored: boolean;
  hand?: ReactNode;
}) {
  return (
    <group ref={refs.root} position={[side * 0.45, 1.57, 0]}>
      <mesh castShadow position={[0, -0.02, 0]} scale={[1.08, 0.9, 1]}>
        {armored
          ? <dodecahedronGeometry args={[0.145, 1]} />
          : <sphereGeometry args={[0.12, 10, 8]} />}
        <meshStandardMaterial
          color={armored ? palette.armor : palette.cloth}
          roughness={armored ? 0.48 : 0.83}
          metalness={armored ? 0.42 : 0.02}
        />
      </mesh>
      <mesh castShadow position={[0, -0.27, 0]} scale={[1, 1, 0.92]}>
        <capsuleGeometry args={[0.1, 0.37, 5, 9]} />
        <meshStandardMaterial color={palette.cloth} roughness={0.84} />
      </mesh>
      <group ref={refs.joint} position={[0, -0.56, 0]}>
        <mesh castShadow position={[0, 0, 0]}>
          <sphereGeometry args={[0.105, 9, 7]} />
          <meshStandardMaterial color={armored ? palette.armor : palette.cloth} roughness={0.7} metalness={armored ? 0.32 : 0.02} />
        </mesh>
        <mesh castShadow position={[0, -0.23, 0]} scale={[0.92, 1, 0.88]}>
          <capsuleGeometry args={[0.084, 0.33, 5, 9]} />
          <meshStandardMaterial color={palette.skin} roughness={0.88} />
        </mesh>
        {armored && (
          <mesh castShadow position={[0, -0.23, 0]}>
            <cylinderGeometry args={[0.1, 0.082, 0.35, 9]} />
            <meshStandardMaterial color={palette.armor} roughness={0.48} metalness={0.42} />
          </mesh>
        )}
        <group position={[0, -0.49, 0]}>
          <mesh castShadow scale={[0.78, 1, 0.68]}>
            <sphereGeometry args={[0.115, 9, 7]} />
            <meshStandardMaterial color={armored ? palette.dark : palette.skin} roughness={0.82} />
          </mesh>
          {[-0.045, 0, 0.045].map((fingerX) => (
            <mesh key={fingerX} position={[fingerX, -0.08, 0.025]}>
              <capsuleGeometry args={[0.014, 0.065, 3, 5]} />
              <meshStandardMaterial color={armored ? palette.dark : palette.skin} roughness={0.86} />
            </mesh>
          ))}
          {hand}
        </group>
      </group>
    </group>
  );
}

function Leg({
  side,
  refs,
  palette,
  armored,
}: {
  side: -1 | 1;
  refs: LimbRefs;
  palette: HumanoidPalette;
  armored: boolean;
}) {
  return (
    <group ref={refs.root} position={[side * 0.2, 0.95, 0]}>
      <mesh castShadow position={[0, 0, 0]} scale={[1, 0.9, 0.92]}>
        <sphereGeometry args={[0.15, 9, 7]} />
        <meshStandardMaterial color={palette.cloth} roughness={0.84} />
      </mesh>
      <mesh castShadow position={[0, -0.29, 0]} scale={[1.02, 1, 0.92]}>
        <capsuleGeometry args={[0.12, 0.42, 5, 9]} />
        <meshStandardMaterial color={palette.cloth} roughness={0.84} />
      </mesh>
      <group ref={refs.joint} position={[0, -0.58, 0]}>
        <mesh castShadow position={[0, 0, 0]} scale={[1, 0.82, 0.9]}>
          <sphereGeometry args={[0.13, 9, 7]} />
          <meshStandardMaterial color={armored ? palette.armor : palette.dark} roughness={armored ? 0.5 : 0.8} metalness={armored ? 0.38 : 0.02} />
        </mesh>
        <mesh castShadow position={[0, -0.25, 0]} scale={[0.94, 1, 0.88]}>
          <capsuleGeometry args={[0.1, 0.37, 5, 9]} />
          <meshStandardMaterial color={palette.dark} roughness={0.82} />
        </mesh>
        {armored && (
          <>
            <mesh castShadow position={[0, -0.25, 0.045]} scale={[1, 1, 0.72]}>
              <cylinderGeometry args={[0.11, 0.09, 0.4, 9]} />
              <meshStandardMaterial color={palette.armor} roughness={0.48} metalness={0.4} />
            </mesh>
            <mesh castShadow position={[0, 0, 0.105]} scale={[1.16, 0.8, 0.46]}>
              <dodecahedronGeometry args={[0.125, 0]} />
              <meshStandardMaterial color={palette.trim} roughness={0.38} metalness={0.5} />
            </mesh>
          </>
        )}
        <mesh castShadow position={[0, -0.5, 0.095]} rotation={[Math.PI / 2, 0, 0]} scale={[1.08, 1.26, 0.74]}>
          <capsuleGeometry args={[0.105, 0.2, 5, 9]} />
          <meshStandardMaterial color={palette.dark} roughness={0.76} />
        </mesh>
        <mesh castShadow position={[0, -0.5, 0.24]} scale={[1.03, 0.62, 1.2]}>
          <sphereGeometry args={[0.105, 8, 6]} />
          <meshStandardMaterial color={palette.dark} roughness={0.8} />
        </mesh>
      </group>
    </group>
  );
}

function Sword({
  color,
  profile = WEAPON_VISUAL_PROFILES.field,
}: {
  color: string;
  profile?: WeaponVisualProfile;
}) {
  const bladeWidth = profile.swordWidth * 1.28;
  const swordLength = profile.swordLength * 1.28;
  const bladeShoulder = -0.24;
  const bladeCenter = bladeShoulder - swordLength / 2;
  const bladeTip = bladeShoulder - swordLength;
  return (
    <group position={[0.035, -0.01, 0.1]} rotation={[-0.14, 0.08, 0.86]}>
      <mesh castShadow position={[0, -0.055, 0]}>
        <cylinderGeometry args={[0.038, 0.038, 0.27, 8]} />
        <meshStandardMaterial color="#47372c" roughness={0.72} />
      </mesh>
      <mesh castShadow position={[0, -0.19, 0]} rotation={[0, 0, Math.PI / 2]}>
        <capsuleGeometry args={[0.028, 0.28, 4, 6]} />
        <meshStandardMaterial color="#a7854e" metalness={0.68} roughness={0.3} />
      </mesh>
      <mesh castShadow position={[0, bladeCenter, 0]} rotation={[0, Math.PI / 4, 0]}>
        <cylinderGeometry args={[0.018, bladeWidth, swordLength, 4]} />
        <meshStandardMaterial color="#cbd3d2" emissive="#718080" emissiveIntensity={0.16} metalness={0.9} roughness={0.18} />
      </mesh>
      <mesh castShadow position={[0, bladeCenter, bladeWidth * 0.38]}>
        <cylinderGeometry args={[0.012, 0.018, swordLength * 0.9, 6]} />
        <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.48} metalness={0.76} roughness={0.24} />
      </mesh>
      <mesh castShadow position={[0, bladeTip - 0.055, 0]} rotation={[Math.PI, 0, 0]}>
        <coneGeometry args={[bladeWidth * 0.72, 0.14, 4]} />
        <meshStandardMaterial color="#d7dddc" metalness={0.9} roughness={0.16} />
      </mesh>
    </group>
  );
}

function Shield({ color }: { color: string }) {
  return (
    <group position={[0, -0.05, 0.17]}>
      <mesh castShadow position={[0, 0, -0.035]}>
        <extrudeGeometry args={[VANGUARD_SHIELD_SHAPE, VANGUARD_SHIELD_EXTRUDE]} />
        <meshStandardMaterial color="#30383b" metalness={0.62} roughness={0.5} />
      </mesh>
      <mesh position={[0, 0, 0.052]} scale={0.83}>
        <shapeGeometry args={[VANGUARD_SHIELD_SHAPE, 2]} />
        <meshStandardMaterial color="#1b2224" metalness={0.46} roughness={0.6} />
      </mesh>
      <mesh castShadow position={[0, -0.05, 0.075]}>
        <capsuleGeometry args={[0.025, 0.55, 4, 6]} />
        <meshStandardMaterial color={color} metalness={0.74} roughness={0.32} />
      </mesh>
      <mesh castShadow position={[0, 0.03, 0.1]} scale={[0.85, 1, 0.7]}>
        <dodecahedronGeometry args={[0.085, 0]} />
        <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.1} metalness={0.78} roughness={0.28} />
      </mesh>
    </group>
  );
}

function Bow({
  color,
  profile = WEAPON_VISUAL_PROFILES.field,
  animationProps,
}: {
  color: string;
  profile?: WeaponVisualProfile;
  animationProps?: AnimatedActorProps;
}) {
  const halfHeight = profile.bowRadius * 1.48;
  const stringX = -0.075;
  const upperString = useRef<THREE.Mesh>(null);
  const lowerString = useRef<THREE.Mesh>(null);
  const arrow = useRef<THREE.Group>(null);
  const bowCurve = useMemo(() => new THREE.QuadraticBezierCurve3(
    new THREE.Vector3(stringX, -halfHeight, 0),
    new THREE.Vector3(-profile.bowRadius * 2.25, 0, 0),
    new THREE.Vector3(stringX, halfHeight, 0),
  ), [halfHeight, profile.bowRadius, stringX]);

  useFrame(() => {
    let pull = 0;
    let arrowVisible = false;
    if (animationProps && (
      animationProps.animation === 'attack'
      || animationProps.animation === 'skill1'
      || animationProps.animation === 'skill2'
    )) {
      const clock = actorClock(animationProps);
      const { anticipation, strike, recovery } = combatPoseProgress(clock);
      pull = anticipation * (1 - strike) * (1 - recovery) * 0.34;
      arrowVisible = clock.phase === 'windup' && anticipation > 0.08;
    }

    const angle = Math.atan2(pull, halfHeight);
    const segmentLength = Math.hypot(halfHeight, pull);
    if (upperString.current) {
      upperString.current.position.set(stringX, halfHeight * 0.5, -pull * 0.5);
      upperString.current.rotation.set(angle, 0, 0);
      upperString.current.scale.set(1, segmentLength, 1);
    }
    if (lowerString.current) {
      lowerString.current.position.set(stringX, -halfHeight * 0.5, -pull * 0.5);
      lowerString.current.rotation.set(-angle, 0, 0);
      lowerString.current.scale.set(1, segmentLength, 1);
    }
    if (arrow.current) {
      arrow.current.visible = arrowVisible;
      arrow.current.position.z = -pull + 0.33;
    }
  });

  return (
    <group position={[-stringX, -0.035, 0.08]} rotation={[-0.1, 0.38, -0.04]}>
      <mesh castShadow>
        <tubeGeometry args={[bowCurve, 32, 0.03 + (profile.bowArc - 1.3) * 0.008, 7, false]} />
        <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.1} metalness={0.25} roughness={0.58} />
      </mesh>
      <mesh ref={upperString}>
        <cylinderGeometry args={[0.008, 0.008, 1, 5]} />
        <meshStandardMaterial color="#d7d0b9" roughness={0.8} />
      </mesh>
      <mesh ref={lowerString}>
        <cylinderGeometry args={[0.008, 0.008, 1, 5]} />
        <meshStandardMaterial color="#d7d0b9" roughness={0.8} />
      </mesh>
      <group ref={arrow} position={[stringX, 0, 0.33]} visible={false}>
        <mesh rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[0.012, 0.012, 0.92, 5]} />
          <meshStandardMaterial color="#9a7049" roughness={0.8} />
        </mesh>
        <mesh position={[0, 0, 0.52]} rotation={[Math.PI / 2, 0, 0]}>
          <coneGeometry args={[0.035, 0.14, 5]} />
          <meshStandardMaterial color="#b9b8ad" metalness={0.5} roughness={0.45} />
        </mesh>
        {[-1, 1].map((side) => (
          <mesh key={`nocked-arrow-fletching-${side}`} position={[side * 0.035, 0, -0.4]} rotation={[0, 0, side * 0.45]}>
            <boxGeometry args={[0.055, 0.012, 0.15]} />
            <meshStandardMaterial color={color} roughness={0.72} />
          </mesh>
        ))}
      </group>
      <mesh castShadow position={[stringX, 0, 0.018]}>
        <cylinderGeometry args={[0.043, 0.036, 0.23, 7]} />
        <meshStandardMaterial color="#483326" roughness={0.86} />
      </mesh>
      {[-1, 1].map((side) => (
        <mesh key={`bow-nock-${side}`} castShadow position={[stringX, side * halfHeight, 0]}>
          <sphereGeometry args={[0.045, 7, 5]} />
          <meshStandardMaterial color="#b89b64" metalness={0.2} roughness={0.62} />
        </mesh>
      ))}
    </group>
  );
}

function Staff({
  color,
  profile = WEAPON_VISUAL_PROFILES.field,
}: {
  color: string;
  profile?: WeaponVisualProfile;
}) {
  const lowerLength = 0.58;
  const upperLength = profile.staffLength - lowerLength;
  const headY = upperLength + 0.02;
  return (
    <group position={[0.035, -0.02, 0.09]} rotation={[-0.1, 0.08, 0.13]}>
      <mesh castShadow position={[0, (upperLength - lowerLength) / 2, 0]}>
        <cylinderGeometry args={[0.036, 0.052, profile.staffLength, 9]} />
        <meshStandardMaterial color="#4b3428" roughness={0.84} />
      </mesh>
      <mesh castShadow position={[0, -0.015, 0.008]}>
        <cylinderGeometry args={[0.05, 0.05, 0.27, 9]} />
        <meshStandardMaterial color={color} metalness={0.36} roughness={0.46} />
      </mesh>
      {profile.staffHead === 'crystal' && (
        <mesh castShadow position={[0, headY, 0]}>
          <dodecahedronGeometry args={[0.16, 0]} />
          <meshStandardMaterial color={color} emissive={color} emissiveIntensity={2.2} roughness={0.28} />
        </mesh>
      )}
      {profile.staffHead === 'antler' && (
        <group position={[0, headY, 0]}>
          {[-1, 1].map((side) => (
            <group key={`staff-antler-${side}`} rotation={[0, 0, side * -0.52]}>
              <mesh castShadow position={[side * 0.08, 0.08, 0]}>
                <cylinderGeometry args={[0.025, 0.04, 0.42, 6]} />
                <meshStandardMaterial color="#5a3c2c" roughness={0.88} />
              </mesh>
              <mesh castShadow position={[side * 0.16, 0.23, 0]} rotation={[0, 0, side * -0.55]}>
                <coneGeometry args={[0.035, 0.22, 6]} />
                <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.8} roughness={0.45} />
              </mesh>
            </group>
          ))}
        </group>
      )}
      {profile.staffHead === 'halo' && (
        <group position={[0, headY, 0]}>
          <mesh>
            <torusGeometry args={[0.18, 0.035, 7, 24]} />
            <meshStandardMaterial color={color} emissive={color} emissiveIntensity={1.4} metalness={0.5} roughness={0.3} />
          </mesh>
          <mesh>
            <octahedronGeometry args={[0.09, 0]} />
            <meshStandardMaterial color={color} emissive={color} emissiveIntensity={2.1} roughness={0.25} />
          </mesh>
        </group>
      )}
      {profile.staffHead === 'ember' && (
        <group position={[0, headY, 0]}>
          <mesh rotation={[0.18, 0, 0.2]}>
            <icosahedronGeometry args={[0.18, 1]} />
            <meshStandardMaterial color={color} emissive={color} emissiveIntensity={2.5} roughness={0.24} />
          </mesh>
          {[-1, 1].map((side) => (
            <mesh key={`ember-prong-${side}`} position={[side * 0.13, 0.11, 0]} rotation={[0, 0, side * -0.34]}>
              <coneGeometry args={[0.035, 0.3, 6]} />
              <meshStandardMaterial color="#3c2824" roughness={0.7} />
            </mesh>
          ))}
        </group>
      )}
      <mesh position={[0, headY, 0]} scale={0.24}>
        <sphereGeometry args={[1, 9, 7]} />
        <meshBasicMaterial
          color={color}
          transparent
          opacity={0.16}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
          toneMapped={false}
        />
      </mesh>
    </group>
  );
}

function EnemyBlade({ variant }: { variant: 'bandit' | 'sentinel' | 'demon' }) {
  if (variant === 'sentinel') {
    return (
      <group position={[0, -0.05, 0.1]} rotation={[0, 0, -0.08]}>
        <mesh castShadow position={[0, 0.35, 0]}>
          <cylinderGeometry args={[0.04, 0.05, 1.05, 7]} />
          <meshStandardMaterial color="#3a3833" roughness={0.78} />
        </mesh>
        <mesh castShadow position={[0, 0.9, 0]}>
          <dodecahedronGeometry args={[0.2, 0]} />
          <meshStandardMaterial color="#6f7770" metalness={0.34} roughness={0.58} />
        </mesh>
      </group>
    );
  }
  if (variant === 'demon') return <Staff color="#ef7043" />;
  return <Sword color="#a9a29a" />;
}

function HeroHandEquipment({
  classId,
  equipment,
  hand,
  animationProps,
}: {
  classId: CharacterClassId;
  equipment: Arena3DEquippedWeapon;
  hand: 'left' | 'right';
  animationProps: AnimatedActorProps;
}) {
  const color = equipmentColor(equipment.rarity);
  const profile = getWeaponVisualProfile(equipment.itemKey);
  if (classId === 'vanguard') return hand === 'right' ? <Sword color={color} profile={profile} /> : <Shield color={color} />;
  if (classId === 'ranger') return hand === 'left' ? <Bow color={color} profile={profile} animationProps={animationProps} /> : null;
  return hand === 'right' ? <Staff color={color} profile={profile} /> : null;
}

function CharacterHead({
  variant,
  palette,
}: {
  variant: HumanoidVariant;
  palette: HumanoidPalette;
}) {
  const faceVisible = variant === 'ranger' || variant === 'mystic' || variant === 'bandit';
  return (
    <group position={[0, 2.03, 0.01]} scale={0.78}>
      <mesh castShadow scale={[0.92, 1.06, 0.94]}>
        <sphereGeometry args={[0.25, 12, 9]} />
        <meshStandardMaterial color={palette.skin} roughness={0.82} />
      </mesh>
      {[-1, 1].map((side) => (
        <mesh key={`ear-${side}`} castShadow position={[side * 0.235, 0, 0]} scale={[0.55, 0.85, 0.42]}>
          <sphereGeometry args={[0.065, 7, 5]} />
          <meshStandardMaterial color={palette.skin} roughness={0.86} />
        </mesh>
      ))}
      {faceVisible && (
        <group>
          {[-1, 1].map((side) => (
            <mesh key={`face-eye-${side}`} position={[side * 0.082, 0.035, 0.225]} scale={[1, 0.68, 0.45]}>
              <sphereGeometry args={[0.025, 7, 5]} />
              <meshBasicMaterial color={variant === 'mystic' ? palette.trim : '#241d1b'} />
            </mesh>
          ))}
          <mesh castShadow position={[0, -0.005, 0.245]} rotation={[Math.PI / 2, 0, 0]} scale={[0.58, 1, 0.52]}>
            <capsuleGeometry args={[0.035, 0.06, 3, 6]} />
            <meshStandardMaterial color={palette.skin} roughness={0.88} />
          </mesh>
        </group>
      )}
      {variant === 'vanguard' && (
        <group>
          <mesh castShadow position={[0, 0.1, -0.01]} scale={[1.12, 0.82, 1.1]}>
            <dodecahedronGeometry args={[0.265, 1]} />
            <meshStandardMaterial color={palette.armor} metalness={0.42} roughness={0.52} />
          </mesh>
          <mesh castShadow position={[0, -0.105, 0.13]} scale={[1.12, 0.72, 0.62]}>
            <dodecahedronGeometry args={[0.205, 0]} />
            <meshStandardMaterial color={palette.dark} metalness={0.34} roughness={0.62} />
          </mesh>
          <mesh castShadow position={[0, 0.055, 0.238]} rotation={[0, 0, Math.PI / 2]} scale={[1, 0.78, 0.7]}>
            <capsuleGeometry args={[0.032, 0.27, 4, 7]} />
            <meshStandardMaterial color="#141718" metalness={0.26} roughness={0.7} />
          </mesh>
          <mesh castShadow position={[0, 0.045, 0.245]} rotation={[0, 0, Math.PI / 2]}>
            <capsuleGeometry args={[0.026, 0.26, 4, 7]} />
            <meshStandardMaterial color={palette.dark} metalness={0.35} roughness={0.55} />
          </mesh>
          <mesh castShadow position={[0, -0.035, 0.255]}>
            <capsuleGeometry args={[0.028, 0.19, 4, 7]} />
            <meshStandardMaterial color={palette.trim} metalness={0.6} roughness={0.32} />
          </mesh>
          {[-1, 1].map((side) => (
            <mesh key={`vanguard-cheek-${side}`} castShadow position={[side * 0.175, -0.08, 0.155]} rotation={[0, 0, side * 0.08]}>
              <capsuleGeometry args={[0.04, 0.18, 4, 7]} />
              <meshStandardMaterial color={palette.armor} metalness={0.45} roughness={0.44} />
            </mesh>
          ))}
          {[-0.09, 0, 0.09].map((offset) => (
            <mesh key={`plume-${offset}`} castShadow position={[offset, 0.34 - Math.abs(offset), -0.04]} rotation={[0.18, 0, offset * -2.2]}>
              <coneGeometry args={[0.04, 0.25, 6]} />
              <meshStandardMaterial color={palette.cloth} roughness={0.94} />
            </mesh>
          ))}
        </group>
      )}
      {variant === 'ranger' && (
        <group>
          <mesh castShadow position={[0, 0.045, 0.015]}>
            <torusGeometry args={[0.255, 0.065, 7, 20]} />
            <meshStandardMaterial color={palette.dark} roughness={0.94} />
          </mesh>
          <mesh castShadow position={[0, 0.11, -0.12]} scale={[1.15, 1.18, 0.9]}>
            <sphereGeometry args={[0.25, 11, 8]} />
            <meshStandardMaterial color={palette.dark} roughness={0.94} />
          </mesh>
          {[-1, 1].map((side) => (
            <mesh key={`ranger-hair-${side}`} castShadow position={[side * 0.16, -0.17, 0.07]} rotation={[0.03, 0, side * 0.12]}>
              <capsuleGeometry args={[0.035, 0.19, 4, 7]} />
              <meshStandardMaterial color="#32241d" roughness={0.96} />
            </mesh>
          ))}
        </group>
      )}
      {variant === 'mystic' && (
        <group>
          <mesh castShadow position={[0, 0.12, -0.04]} scale={[1.04, 0.66, 1.05]}>
            <sphereGeometry args={[0.28, 12, 9]} />
            <meshStandardMaterial color={palette.dark} roughness={0.88} />
          </mesh>
          <mesh position={[0, 0.105, 0.225]}>
            <torusGeometry args={[0.175, 0.018, 6, 22, Math.PI]} />
            <meshStandardMaterial color={palette.trim} emissive={palette.trim} emissiveIntensity={0.6} metalness={0.35} roughness={0.36} />
          </mesh>
          {[-1, -0.5, 0, 0.5, 1].map((strand) => (
            <mesh key={`mystic-hair-${strand}`} castShadow position={[strand * 0.16, -0.16 + Math.abs(strand) * 0.025, -0.09]} rotation={[0.04, 0, strand * -0.12]}>
              <capsuleGeometry args={[0.035, 0.27 - Math.abs(strand) * 0.055, 4, 7]} />
              <meshStandardMaterial color={palette.dark} roughness={0.93} />
            </mesh>
          ))}
        </group>
      )}
      {variant === 'bandit' && (
        <group>
          <mesh castShadow position={[0, 0.06, -0.08]} scale={[1.15, 1.12, 0.96]}>
            <sphereGeometry args={[0.26, 11, 8]} />
            <meshStandardMaterial color={palette.dark} roughness={0.96} />
          </mesh>
          <mesh castShadow position={[0, 0.03, 0.02]}>
            <torusGeometry args={[0.255, 0.055, 7, 20]} />
            <meshStandardMaterial color={palette.dark} roughness={0.94} />
          </mesh>
          <mesh castShadow position={[0, -0.1, 0.205]} scale={[1.18, 0.52, 0.68]}>
            <cylinderGeometry args={[0.19, 0.16, 0.2, 10]} />
            <meshStandardMaterial color={palette.cloth} roughness={0.92} />
          </mesh>
        </group>
      )}
      {variant === 'sentinel' && (
        <group>
          <mesh castShadow position={[0, 0.04, 0]} scale={[1.15, 1.08, 1.12]}>
            <sphereGeometry args={[0.255, 12, 9]} />
            <meshStandardMaterial color={palette.armor} metalness={0.23} roughness={0.76} />
          </mesh>
          <mesh castShadow position={[0, -0.1, 0]}>
            <cylinderGeometry args={[0.245, 0.205, 0.23, 10]} />
            <meshStandardMaterial color={palette.armor} metalness={0.28} roughness={0.68} />
          </mesh>
          <mesh position={[0, 0.015, 0.245]} rotation={[0, 0, Math.PI / 2]}>
            <capsuleGeometry args={[0.022, 0.23, 4, 7]} />
            <meshStandardMaterial color={palette.trim} emissive={palette.trim} emissiveIntensity={1.2} />
          </mesh>
          <mesh castShadow position={[0, 0.3, -0.03]}>
            <coneGeometry args={[0.075, 0.36, 5]} />
            <meshStandardMaterial color={palette.dark} roughness={0.75} metalness={0.22} />
          </mesh>
        </group>
      )}
      {variant === 'demon' && (
        <group>
          {[-1, 1].map((side) => (
            <group key={side} position={[side * 0.18, 0.2, -0.03]} rotation={[0.08, 0, side * -0.44]}>
              <mesh castShadow position={[0, 0.1, 0]}>
                <coneGeometry args={[0.075, 0.28, 7]} />
                <meshStandardMaterial color="#332126" roughness={0.72} />
              </mesh>
              <mesh castShadow position={[side * 0.055, 0.3, -0.005]} rotation={[0, 0, side * -0.24]}>
                <coneGeometry args={[0.045, 0.22, 7]} />
                <meshStandardMaterial color="#1d171a" roughness={0.76} />
              </mesh>
            </group>
          ))}
          <mesh castShadow position={[0, -0.1, 0.17]} scale={[1, 0.6, 0.72]}>
            <sphereGeometry args={[0.2, 9, 7]} />
            <meshStandardMaterial color="#4a2625" roughness={0.82} />
          </mesh>
          {[-1, 1].map((side) => (
            <mesh key={`eye-${side}`} position={[side * 0.09, 0.03, 0.23]}>
              <sphereGeometry args={[0.025, 6, 5]} />
              <meshBasicMaterial color="#ff9a55" />
            </mesh>
          ))}
        </group>
      )}
    </group>
  );
}

function HumanoidOutfit({ variant, palette }: { variant: HumanoidVariant; palette: HumanoidPalette }) {
  if (variant === 'vanguard') {
    return (
      <group>
        <mesh castShadow position={[0, 1.28, 0.035]} scale={[1, 0.9, 0.7]}>
          <sphereGeometry args={[0.41, 14, 10]} />
          <meshStandardMaterial color={palette.armor} metalness={0.48} roughness={0.43} />
        </mesh>
        <mesh castShadow position={[0, 1.31, 0.292]} scale={[1.28, 1, 0.26]}>
          <capsuleGeometry args={[0.18, 0.34, 5, 9]} />
          <meshStandardMaterial color={palette.dark} metalness={0.34} roughness={0.48} />
        </mesh>
        <mesh castShadow position={[0, 1.34, 0.319]} scale={[1.06, 0.86, 0.24]}>
          <capsuleGeometry args={[0.16, 0.27, 5, 9]} />
          <meshStandardMaterial color={palette.armor} metalness={0.56} roughness={0.34} />
        </mesh>
        <mesh castShadow position={[0, 1.32, 0.357]}>
          <capsuleGeometry args={[0.022, 0.38, 4, 6]} />
          <meshStandardMaterial color={palette.trim} metalness={0.68} roughness={0.28} />
        </mesh>
        <mesh castShadow position={[0, 1.28, 0.31]}>
          <torusGeometry args={[0.22, 0.026, 6, 22, Math.PI]} />
          <meshStandardMaterial color={palette.trim} metalness={0.63} roughness={0.3} />
        </mesh>
        <mesh castShadow position={[0, 0.94, 0.02]} scale={[1, 0.55, 0.76]}>
          <torusGeometry args={[0.31, 0.046, 7, 24]} />
          <meshStandardMaterial color="#352a26" roughness={0.68} metalness={0.18} />
        </mesh>
        <mesh castShadow position={[0, 0.93, 0.285]} scale={[1, 0.82, 0.42]}>
          <dodecahedronGeometry args={[0.095, 0]} />
          <meshStandardMaterial color={palette.trim} metalness={0.62} roughness={0.3} />
        </mesh>
        <mesh castShadow position={[0, 0.66, 0.275]} rotation={[-0.05, 0, 0]}>
          <planeGeometry args={[0.24, 0.48]} />
          <meshStandardMaterial color={palette.cloth} roughness={0.92} side={THREE.DoubleSide} />
        </mesh>
        <mesh castShadow position={[0, 0.43, 0.284]} rotation={[Math.PI / 2, 0, 0]}>
          <capsuleGeometry args={[0.018, 0.19, 4, 6]} />
          <meshStandardMaterial color={palette.trim} metalness={0.3} roughness={0.58} />
        </mesh>
        {[-1, 1].map((side) => (
          <group key={`vanguard-plate-${side}`} position={[side * 0.42, 1.43, 0]}>
            <mesh castShadow scale={[1.18, 0.72, 1]}>
              <dodecahedronGeometry args={[0.145, 1]} />
              <meshStandardMaterial color={palette.armor} metalness={0.45} roughness={0.45} />
            </mesh>
            <mesh castShadow position={[side * 0.07, 0.04, 0]} rotation={[0, 0, side * -0.4]}>
              <coneGeometry args={[0.055, 0.2, 6]} />
              <meshStandardMaterial color={palette.trim} metalness={0.54} roughness={0.37} />
            </mesh>
            <mesh castShadow position={[side * -0.21, -0.53, 0.04]} rotation={[0.02, 0, side * 0.08]}>
              <capsuleGeometry args={[0.08, 0.27, 4, 7]} />
              <meshStandardMaterial color={palette.armor} metalness={0.38} roughness={0.5} />
            </mesh>
          </group>
        ))}
        <mesh castShadow position={[0, 1.34, -0.27]}>
          <circleGeometry args={[0.57, 16, Math.PI, Math.PI]} />
          <meshStandardMaterial color={palette.cloth} roughness={0.95} side={THREE.DoubleSide} />
        </mesh>
      </group>
    );
  }

  if (variant === 'ranger') {
    return (
      <group>
        <mesh castShadow position={[0, 1.25, 0.02]} scale={[0.96, 0.92, 0.68]}>
          <sphereGeometry args={[0.38, 13, 9]} />
          <meshStandardMaterial color={palette.armor} roughness={0.86} />
        </mesh>
        <mesh castShadow position={[0, 1.42, 0]} rotation={[Math.PI / 2, 0, 0]} scale={[1, 1, 0.6]}>
          <torusGeometry args={[0.34, 0.065, 7, 24, Math.PI * 1.35]} />
          <meshStandardMaterial color={palette.dark} roughness={0.94} />
        </mesh>
        <mesh castShadow position={[0, 0.92, 0]} scale={[1, 1, 0.72]}>
          <torusGeometry args={[0.3, 0.045, 6, 22]} />
          <meshStandardMaterial color={palette.trim} roughness={0.68} metalness={0.18} />
        </mesh>
        <group position={[0.31, 1.16, -0.29]} rotation={[0.18, 0, -0.16]}>
          <mesh castShadow>
            <cylinderGeometry args={[0.11, 0.09, 0.74, 9]} />
            <meshStandardMaterial color="#4a3025" roughness={0.9} />
          </mesh>
          {[-0.06, 0, 0.06].map((arrowX) => (
            <group key={`arrow-${arrowX}`} position={[arrowX, 0.46, 0]}>
              <mesh castShadow>
                <cylinderGeometry args={[0.009, 0.009, 0.46, 5]} />
                <meshStandardMaterial color="#c4ae7c" roughness={0.74} />
              </mesh>
              <mesh castShadow position={[0, 0.27, 0]}>
                <coneGeometry args={[0.025, 0.12, 4]} />
                <meshStandardMaterial color={palette.trim} roughness={0.68} />
              </mesh>
            </group>
          ))}
        </group>
      </group>
    );
  }

  if (variant === 'mystic') {
    return (
      <group>
        <mesh castShadow position={[0, 0.14, 0]} scale={[1, 1, 0.72]}>
          <latheGeometry args={[ROBE_PROFILE, 14]} />
          <meshStandardMaterial color={palette.cloth} roughness={0.9} side={THREE.DoubleSide} />
        </mesh>
        <mesh castShadow position={[0, 1.38, 0]} rotation={[Math.PI / 2, 0, 0]} scale={[1, 1, 0.62]}>
          <torusGeometry args={[0.37, 0.075, 8, 26]} />
          <meshStandardMaterial color={palette.armor} roughness={0.65} metalness={0.14} />
        </mesh>
        <mesh castShadow position={[0, 0.88, 0]} scale={[1, 1, 0.7]}>
          <torusGeometry args={[0.29, 0.04, 6, 22]} />
          <meshStandardMaterial color={palette.trim} emissive={palette.trim} emissiveIntensity={0.35} roughness={0.4} />
        </mesh>
        {[-1, 0, 1].map((orb) => (
          <group key={`mystic-orb-${orb}`} position={[orb * 0.26, 1.16 + Math.abs(orb) * 0.05, -0.27]}>
            <mesh>
              <sphereGeometry args={[0.055, 9, 7]} />
              <meshStandardMaterial color={palette.trim} emissive={palette.trim} emissiveIntensity={1.2} roughness={0.3} />
            </mesh>
          </group>
        ))}
      </group>
    );
  }

  if (variant === 'bandit') {
    return (
      <group>
        <mesh castShadow position={[-0.08, 1.25, 0.25]} rotation={[0, 0, -0.48]}>
          <capsuleGeometry args={[0.045, 0.76, 5, 8]} />
          <meshStandardMaterial color={palette.armor} roughness={0.9} />
        </mesh>
        <mesh castShadow position={[0.38, 1.43, 0]} scale={[1.1, 0.7, 1]}>
          <sphereGeometry args={[0.14, 10, 7]} />
          <meshStandardMaterial color={palette.armor} roughness={0.83} metalness={0.12} />
        </mesh>
        <mesh castShadow position={[0, 0.91, 0]} scale={[1, 1, 0.72]}>
          <torusGeometry args={[0.3, 0.05, 6, 22]} />
          <meshStandardMaterial color={palette.dark} roughness={0.9} />
        </mesh>
      </group>
    );
  }

  if (variant === 'sentinel') {
    return (
      <group>
        <mesh castShadow position={[0, 1.28, 0.02]} scale={[1.08, 0.94, 0.76]}>
          <sphereGeometry args={[0.43, 14, 10]} />
          <meshStandardMaterial color={palette.armor} metalness={0.34} roughness={0.58} />
        </mesh>
        {[-1, 1].map((side) => (
          <group key={`sentinel-shoulder-${side}`} position={[side * 0.48, 1.44, 0]}>
            <mesh castShadow scale={[1.22, 0.86, 1]}>
              <dodecahedronGeometry args={[0.16, 0]} />
              <meshStandardMaterial color={palette.armor} metalness={0.32} roughness={0.62} />
            </mesh>
            <mesh castShadow position={[side * 0.12, 0.14, 0]} rotation={[0, 0, side * -0.42]}>
              <coneGeometry args={[0.055, 0.25, 6]} />
              <meshStandardMaterial color={palette.dark} metalness={0.28} roughness={0.68} />
            </mesh>
          </group>
        ))}
        {[-0.22, 0, 0.22].map((plateX) => (
          <mesh key={`sentinel-tasset-${plateX}`} castShadow position={[plateX, 0.77, 0.03]}>
            <capsuleGeometry args={[0.085, 0.3, 4, 7]} />
            <meshStandardMaterial color={palette.armor} metalness={0.3} roughness={0.62} />
          </mesh>
        ))}
      </group>
    );
  }

  return (
    <group>
      <mesh castShadow position={[0, 0.12, 0]} scale={[1.04, 1, 0.74]}>
        <latheGeometry args={[ROBE_PROFILE, 13]} />
        <meshStandardMaterial color={palette.cloth} roughness={0.88} side={THREE.DoubleSide} />
      </mesh>
      {[-1, 1].map((side) => (
        <mesh key={`demon-shoulder-${side}`} castShadow position={[side * 0.43, 1.46, 0]} rotation={[0.1, 0, side * -0.52]}>
          <coneGeometry args={[0.12, 0.46, 7]} />
          <meshStandardMaterial color={palette.dark} roughness={0.72} />
        </mesh>
      ))}
      {[-0.2, 0, 0.2].map((ribY, index) => (
        <mesh key={`demon-rib-${ribY}`} position={[0, 1.25 + ribY, 0.27]} scale={[1 - index * 0.08, 1, 0.8]}>
          <torusGeometry args={[0.25, 0.025, 5, 18, Math.PI]} />
          <meshStandardMaterial color={palette.armor} metalness={0.2} roughness={0.63} />
        </mesh>
      ))}
      <mesh position={[0, 1.22, 0.3]}>
        <dodecahedronGeometry args={[0.085, 0]} />
        <meshStandardMaterial color={palette.trim} emissive={palette.trim} emissiveIntensity={2.1} roughness={0.3} />
      </mesh>
    </group>
  );
}

interface HumanoidRig {
  root: MutableRefObject<THREE.Group | null>;
  torso: MutableRefObject<THREE.Group | null>;
  head: MutableRefObject<THREE.Group | null>;
  leftArm: LimbRefs;
  rightArm: LimbRefs;
  leftLeg: LimbRefs;
  rightLeg: LimbRefs;
}

function resetHumanoidRig(rig: HumanoidRig) {
  if (rig.root.current) {
    rig.root.current.position.set(0, 0, 0);
    rig.root.current.rotation.set(0, 0, 0);
  }
  applyRotation(rig.torso, 0, 0, 0);
  applyRotation(rig.head, 0, 0, 0);
  applyRotation(rig.leftArm.root, 0.05, 0, 0.08);
  applyRotation(rig.rightArm.root, 0.05, 0, -0.08);
  applyRotation(rig.leftArm.joint, -0.08, 0, 0);
  applyRotation(rig.rightArm.joint, -0.08, 0, 0);
  applyRotation(rig.leftLeg.root, 0, 0, 0);
  applyRotation(rig.rightLeg.root, 0, 0, 0);
  applyRotation(rig.leftLeg.joint, 0.04, 0, 0);
  applyRotation(rig.rightLeg.joint, 0.04, 0, 0);
}

function combatPoseProgress(clock: Arena3DAnimationClock) {
  if (clock.phase === 'windup') {
    const anticipation = easeInOut(clamp(clock.phaseProgress / 0.72, 0, 1));
    const strike = easeInOut(clamp((clock.phaseProgress - 0.72) / 0.28, 0, 1));
    return { anticipation, strike, recovery: 0 };
  }
  if (clock.phase === 'impact') return { anticipation: 1, strike: 1, recovery: 0 };
  if (clock.phase === 'recovery' || clock.phase === 'complete') {
    return { anticipation: 1, strike: 1, recovery: easeInOut(clock.phaseProgress) };
  }
  return { anticipation: 0, strike: 0, recovery: 1 };
}

function hitReactionAmount(progress: number) {
  if (progress < 0.14) return easeOut(progress / 0.14);
  if (progress < 0.46) return 1;
  return 1 - easeInOut((progress - 0.46) / 0.54);
}

function HitFlash({
  animationProps,
  radius,
  height,
}: {
  animationProps: AnimatedActorProps;
  radius: number;
  height: number;
}) {
  const clock = actorClock(animationProps);
  if (clock.phase !== 'hit' || clock.progress >= 0.48) return null;
  const flash = 1 - easeOut(clock.progress / 0.48);
  return (
    <group position={[0, height * 0.5, 0]}>
      <mesh scale={[radius, height * 0.52, radius]}>
        <sphereGeometry args={[1, 10, 8]} />
        <meshBasicMaterial
          color="#ffd6ad"
          transparent
          opacity={flash * 0.2}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
          side={THREE.BackSide}
          toneMapped={false}
        />
      </mesh>
      <mesh scale={radius * (0.18 + flash * 0.2)}>
        <icosahedronGeometry args={[1, 1]} />
        <meshBasicMaterial
          color="#ffd5aa"
          transparent
          opacity={flash * 0.42}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
          toneMapped={false}
        />
      </mesh>
    </group>
  );
}

function poseHumanoid(
  rig: HumanoidRig,
  clock: Arena3DAnimationClock,
  animation: Arena3DActorAnimationState['animation'],
  unitId: Arena3DUnitId,
  attackKind: Arena3DAttackKind | undefined,
) {
  resetHumanoidRig(rig);
  const root = rig.root.current;
  const torso = rig.torso.current;
  const head = rig.head.current;
  if (!root || !torso || !head) return;

  if (clock.phase === 'idle') {
    const breath = Math.sin(clock.loopProgress * Math.PI * 2);
    root.position.y = breath * 0.012;
    torso.rotation.x = breath * 0.025;
    head.rotation.y = Math.sin(clock.loopProgress * Math.PI * 2 + 0.7) * 0.035;
    return;
  }

  if (clock.phase === 'locomotion') {
    const cycle = clock.loopProgress * Math.PI * 2;
    const left = sampleGait(clock.loopProgress);
    const right = sampleGait(clock.loopProgress, 0.5);
    const heavy = unitId === 'golem' ? 0.58 : unitId === 'treant' ? 0.72 : unitId === 'vanguard' ? 0.88 : 1;
    const stride = unitId === 'ranger' ? 0.84 : 0.7;
    const weightShift = Math.sin(cycle) * heavy;
    const footfall = Math.abs(Math.sin(cycle * 2));

    root.position.x = weightShift * 0.035;
    root.position.y = footfall * (unitId === 'golem' ? 0.025 : 0.045) + (left.lift + right.lift) * 0.012;
    root.rotation.x = unitId === 'golem' ? 0.055 : 0.025;
    root.rotation.y = Math.sin(cycle * 2) * 0.025 * heavy;
    root.rotation.z = -weightShift * 0.028;
    torso.rotation.x = 0.035 + footfall * 0.012;
    torso.rotation.y = -(left.hip - right.hip) * 0.07 * heavy;
    torso.rotation.z = weightShift * 0.055;
    head.rotation.x = -0.02 - footfall * 0.018;
    head.rotation.y = (left.hip - right.hip) * 0.025;
    head.rotation.z = -weightShift * 0.025;

    applyRotation(rig.leftLeg.root, left.hip * stride * heavy, 0, -weightShift * 0.018);
    applyRotation(rig.rightLeg.root, right.hip * stride * heavy, 0, -weightShift * 0.018);
    applyRotation(rig.leftLeg.joint, left.knee * (unitId === 'golem' ? 0.54 : 0.82) + 0.04);
    applyRotation(rig.rightLeg.joint, right.knee * (unitId === 'golem' ? 0.54 : 0.82) + 0.04);
    applyRotation(rig.leftArm.root, -left.hip * 0.48 * heavy, 0, 0.08 + weightShift * 0.025);
    applyRotation(rig.rightArm.root, -right.hip * 0.48 * heavy, 0, -0.08 + weightShift * 0.025);
    applyRotation(rig.leftArm.joint, -0.12 - Math.max(0, -left.hip) * 0.25);
    applyRotation(rig.rightArm.joint, -0.12 - Math.max(0, -right.hip) * 0.25);
    return;
  }

  if (clock.phase === 'hit') {
    const recoil = hitReactionAmount(clock.progress);
    root.position.z = -recoil * 0.38;
    root.position.y = recoil * 0.035;
    root.rotation.x = -recoil * 0.27;
    torso.rotation.z = recoil * 0.28;
    torso.rotation.y = -recoil * 0.16;
    head.rotation.x = recoil * 0.38;
    applyRotation(rig.leftArm.root, 0.56 * recoil, 0, 0.3);
    applyRotation(rig.rightArm.root, 0.62 * recoil, 0, -0.32);
    applyRotation(rig.leftLeg.root, -0.2 * recoil);
    applyRotation(rig.rightLeg.root, 0.24 * recoil);
    return;
  }

  if (clock.phase === 'death') {
    const fall = easeInOut(clock.progress);
    root.rotation.z = fall * 1.38;
    root.rotation.x = -fall * 0.2;
    root.position.y = -fall * 0.55;
    root.position.x = fall * 0.25;
    applyRotation(rig.leftArm.root, -0.45 * fall, 0, 0.5 * fall);
    applyRotation(rig.rightArm.root, 0.3 * fall, 0, -0.4 * fall);
    return;
  }

  if (animation !== 'attack' && animation !== 'skill1' && animation !== 'skill2') return;
  const { anticipation, strike, recovery } = combatPoseProgress(clock);
  const active = 1 - recovery;
  const caster = unitId === 'mystic' || unitId === 'demon' || attackKind === 'arcane' || attackKind === 'fire';
  const archer = unitId === 'ranger';

  if (archer) {
    const draw = anticipation * (1 - strike);
    const released = strike * active;
    torso.rotation.y = -0.35 * draw + 0.16 * released;
    applyRotation(rig.leftArm.root, -1.34 * active, -0.1, 0.16);
    applyRotation(rig.leftArm.joint, -0.34 * active);
    applyRotation(rig.rightArm.root, -1.1 * active + released * 0.38, 0.34 * draw, -0.18);
    applyRotation(rig.rightArm.joint, -1.18 * draw + released * 0.4);
    head.rotation.y = -0.12 * active;
    return;
  }

  if (unitId === 'golem') {
    const brace = anticipation * (1 - strike);
    const slam = strike * active;
    root.position.y = -brace * 0.1 + slam * 0.05;
    root.position.z = slam * 0.18;
    torso.rotation.x = -0.2 * brace + 0.46 * slam;
    applyRotation(rig.leftArm.root, -2.2 * brace + 0.5 * slam, 0, 0.18);
    applyRotation(rig.rightArm.root, -2.2 * brace + 0.5 * slam, 0, -0.18);
    applyRotation(rig.leftArm.joint, -0.58 * brace - 0.2 * slam);
    applyRotation(rig.rightArm.joint, -0.58 * brace - 0.2 * slam);
    applyRotation(rig.leftLeg.root, -0.18 * active, 0, 0.08 * active);
    applyRotation(rig.rightLeg.root, 0.12 * active, 0, -0.08 * active);
    head.rotation.x = -0.18 * brace + 0.34 * slam;
    return;
  }

  if (unitId === 'treant') {
    const coil = anticipation * (1 - strike);
    const sweep = strike * active;
    torso.rotation.y = 0.72 * coil - 0.78 * sweep;
    torso.rotation.z = -0.08 * coil + 0.15 * sweep;
    applyRotation(rig.leftArm.root, -0.44 * active, 0.12, 0.48 * active);
    applyRotation(rig.leftArm.joint, -0.62 * active);
    applyRotation(rig.rightArm.root, 1.18 * coil - 1.5 * sweep, -0.2, -0.35 * active);
    applyRotation(rig.rightArm.joint, -0.82 * coil + 0.24 * sweep);
    root.position.z = sweep * 0.16;
    head.rotation.y = -0.25 * coil + 0.2 * sweep;
    return;
  }

  if (caster || animation === 'skill2') {
    const gather = anticipation * (1 - strike * 0.35);
    const release = strike * active;
    root.position.y = Math.sin(anticipation * Math.PI) * 0.04 * active;
    torso.rotation.x = -0.16 * gather + 0.18 * release;
    torso.rotation.y = Math.sin(anticipation * Math.PI) * 0.2 * active;
    applyRotation(rig.leftArm.root, -1.2 * gather - 0.35 * release, -0.18, 0.36 * active);
    applyRotation(rig.rightArm.root, -1.35 * gather - 0.55 * release, 0.2, -0.3 * active);
    applyRotation(rig.leftArm.joint, -0.82 * gather + 0.18 * release);
    applyRotation(rig.rightArm.joint, -0.48 * gather + 0.25 * release);
    head.rotation.x = -0.1 * gather + 0.16 * release;
    return;
  }

  const wind = anticipation * (1 - strike);
  const hit = strike * active;
  torso.rotation.y = 0.58 * wind - 0.54 * hit;
  torso.rotation.x = -0.08 * wind + 0.22 * hit;
  root.position.z = hit * 0.11;
  applyRotation(rig.rightArm.root, 1.02 * wind - 1.42 * hit, 0.14, -0.24 - 0.18 * wind);
  applyRotation(rig.rightArm.joint, -0.9 * wind - 0.28 * hit);
  applyRotation(rig.leftArm.root, -0.34 * active - 0.3 * hit, -0.08, 0.24 * active);
  applyRotation(rig.leftArm.joint, -0.5 * active);
  applyRotation(rig.leftLeg.root, -0.2 * hit);
  applyRotation(rig.rightLeg.root, 0.22 * hit);
  head.rotation.y = -0.22 * wind + 0.18 * hit;
}

function HumanoidActor({
  animationProps,
  variant,
  palette,
  scale,
  equipment,
  elite = false,
}: {
  animationProps: AnimatedActorProps;
  variant: HumanoidVariant;
  palette: HumanoidPalette;
  scale: number;
  equipment?: Arena3DEquippedWeapon | null;
  elite?: boolean;
}) {
  const rig: HumanoidRig = {
    root: useRef<THREE.Group>(null),
    torso: useRef<THREE.Group>(null),
    head: useRef<THREE.Group>(null),
    leftArm: { root: useRef<THREE.Group>(null), joint: useRef<THREE.Group>(null) },
    rightArm: { root: useRef<THREE.Group>(null), joint: useRef<THREE.Group>(null) },
    leftLeg: { root: useRef<THREE.Group>(null), joint: useRef<THREE.Group>(null) },
    rightLeg: { root: useRef<THREE.Group>(null), joint: useRef<THREE.Group>(null) },
  };

  useFrame(() => {
    poseHumanoid(
      rig,
      actorClock(animationProps),
      animationProps.animation,
      animationProps.unitId,
      animationProps.attackKind,
    );
  });

  const isHero = variant === 'vanguard' || variant === 'ranger' || variant === 'mystic';
  const heroVariant = isHero ? variant as CharacterClassId : null;
  const armored = variant === 'vanguard' || variant === 'sentinel' || variant === 'demon';
  const heroEquipment = isHero ? equipment : undefined;
  const rightHand = heroEquipment && heroVariant
    ? <HeroHandEquipment classId={heroVariant} equipment={heroEquipment} hand="right" animationProps={animationProps} />
    : !isHero ? <EnemyBlade variant={variant} /> : null;
  const leftHand = heroEquipment && heroVariant
    ? <HeroHandEquipment classId={heroVariant} equipment={heroEquipment} hand="left" animationProps={animationProps} />
    : null;

  return (
    <group rotation={[0, actorYaw(animationProps.direction), 0]} scale={scale}>
      <group ref={rig.root}>
        <Leg side={-1} refs={rig.leftLeg} palette={palette} armored={armored} />
        <Leg side={1} refs={rig.rightLeg} palette={palette} armored={armored} />
        <group ref={rig.torso}>
          <mesh castShadow position={[0, 0.93, 0]} scale={[1, 1, 0.7]}>
            <latheGeometry args={[HUMANOID_TORSO_PROFILE, 14]} />
            <meshStandardMaterial color={palette.cloth} roughness={0.82} />
          </mesh>
          <mesh castShadow position={[0, 0.73, 0]} scale={[1, 1, 0.74]}>
            <latheGeometry args={[HUMANOID_PELVIS_PROFILE, 12]} />
            <meshStandardMaterial color={palette.dark} roughness={0.78} />
          </mesh>
          <mesh castShadow position={[0, 1.03, 0]} scale={[1, 1, 0.72]}>
            <torusGeometry args={[0.29, 0.04, 6, 22]} />
            <meshStandardMaterial color={palette.dark} roughness={0.74} />
          </mesh>
          <mesh castShadow position={[0, 1.75, 0]}>
            <cylinderGeometry args={[0.09, 0.115, 0.2, 10]} />
            <meshStandardMaterial color={palette.skin} roughness={0.85} />
          </mesh>
          <group position={[0, 0.1, 0]}>
            <HumanoidOutfit variant={variant} palette={palette} />
          </group>
          <group ref={rig.head}>
            <CharacterHead variant={variant} palette={palette} />
          </group>
          <Arm side={-1} refs={rig.leftArm} palette={palette} armored={armored} hand={leftHand} />
          <Arm side={1} refs={rig.rightArm} palette={palette} armored={armored} hand={rightHand} />
        </group>
      </group>
      <HitFlash animationProps={animationProps} radius={0.58} height={2.2} />
      {elite && (
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.03, 0]}>
          <torusGeometry args={[0.63, 0.035, 6, 28]} />
          <meshBasicMaterial color="#e3a33f" transparent opacity={0.9} />
        </mesh>
      )}
    </group>
  );
}

function SlimeActor({ animationProps, elite }: { animationProps: AnimatedActorProps; elite: boolean }) {
  const root = useRef<THREE.Group>(null);
  const body = useRef<THREE.Group>(null);
  const crown = useRef<THREE.Group>(null);

  useFrame(() => {
    const clock = actorClock(animationProps);
    if (!root.current || !body.current || !crown.current) return;
    root.current.position.set(0, 0, 0);
    root.current.rotation.set(0, 0, 0);
    body.current.scale.set(1, 1, 1);
    crown.current.rotation.set(0, 0, 0);

    if (clock.phase === 'idle' || clock.phase === 'locomotion') {
      const phase = clock.loopProgress * Math.PI * 2;
      const pulse = Math.sin(phase);
      root.current.position.y = Math.abs(pulse) * (clock.phase === 'locomotion' ? 0.11 : 0.035);
      body.current.scale.set(1 + pulse * 0.055, 1 - pulse * 0.09, 1 + pulse * 0.055);
      crown.current.rotation.z = pulse * 0.08;
      return;
    }
    if (clock.phase === 'hit') {
      const recoil = hitReactionAmount(clock.progress);
      body.current.scale.set(1 + recoil * 0.38, 1 - recoil * 0.43, 1 + recoil * 0.16);
      root.current.position.z = -recoil * 0.34;
      root.current.rotation.z = recoil * 0.16;
      return;
    }
    if (clock.phase === 'death') {
      const collapse = easeInOut(clock.progress);
      body.current.scale.set(1 + collapse * 0.7, 1 - collapse * 0.88, 1 + collapse * 0.7);
      root.current.position.y = -collapse * 0.12;
      return;
    }
    const { anticipation, strike, recovery } = combatPoseProgress(clock);
    const active = 1 - recovery;
    const squash = anticipation * (1 - strike);
    const leap = strike * active;
    body.current.scale.set(1 + squash * 0.25 - leap * 0.12, 1 - squash * 0.34 + leap * 0.28, 1 + squash * 0.25 - leap * 0.12);
    root.current.position.y = leap * 0.16;
    root.current.position.z = leap * 0.38;
  });

  return (
    <group rotation={[0, actorYaw(animationProps.direction), 0]} scale={0.92}>
      <group ref={root}>
        <group ref={body} position={[0, 0.34, 0]}>
          <mesh castShadow position={[0.02, 0.02, 0]} rotation={[0.04, 0.12, -0.08]} scale={[0.68, 0.34, 0.68]}>
            <dodecahedronGeometry args={[0.72, 0]} />
            <meshPhysicalMaterial
              color={elite ? '#545126' : '#2d3731'}
              emissive={elite ? '#514817' : '#111813'}
              emissiveIntensity={elite ? 0.28 : 0.05}
              roughness={0.78}
              clearcoat={0.04}
            />
          </mesh>
          <mesh castShadow position={[-0.37, -0.02, 0.02]} rotation={[0.08, 0.2, -0.16]} scale={[0.62, 0.38, 0.52]}>
            <dodecahedronGeometry args={[0.55, 1]} />
            <meshPhysicalMaterial color={elite ? '#5a5527' : '#394139'} roughness={0.8} clearcoat={0.03} />
          </mesh>
          <mesh castShadow position={[0.35, -0.06, 0.13]} rotation={[-0.04, -0.2, 0.12]} scale={[0.58, 0.36, 0.6]}>
            <dodecahedronGeometry args={[0.55, 1]} />
            <meshPhysicalMaterial color={elite ? '#4c4f25' : '#27332e'} roughness={0.82} clearcoat={0.03} />
          </mesh>
          <mesh castShadow position={[0.04, -0.11, -0.38]} rotation={[0.1, 0, 0]} scale={[0.6, 0.32, 0.46]}>
            <dodecahedronGeometry args={[0.52, 1]} />
            <meshPhysicalMaterial color={elite ? '#565127' : '#343d34'} roughness={0.84} clearcoat={0.02} />
          </mesh>
          <mesh castShadow position={[-0.19, 0.2, -0.04]} rotation={[0.1, 0.4, -0.18]} scale={[0.72, 0.58, 0.7]}>
            <dodecahedronGeometry args={[0.34, 1]} />
            <meshStandardMaterial color={elite ? '#504c23' : '#252f2a'} roughness={0.86} />
          </mesh>
          <mesh castShadow position={[0.23, 0.13, -0.01]} rotation={[-0.18, -0.32, 0.16]} scale={[0.62, 0.52, 0.7]}>
            <dodecahedronGeometry args={[0.3, 1]} />
            <meshStandardMaterial color="#303a32" roughness={0.84} />
          </mesh>
          {[-1, 1].map((side) => (
            <group key={`slime-tendril-${side}`} position={[side * 0.44, -0.03, 0.16]} rotation={[0.18, side * 0.16, side * -1.02]}>
              <mesh castShadow position={[0, 0.17, 0]}>
                <capsuleGeometry args={[0.055, 0.28, 4, 7]} />
                <meshPhysicalMaterial color={elite ? '#5b5628' : '#303b33'} roughness={0.8} clearcoat={0.03} />
              </mesh>
              <mesh position={[0, 0.39, 0]} rotation={[0, 0, side * 0.22]}>
                <coneGeometry args={[0.05, 0.24, 7]} />
                <meshStandardMaterial color="#252f29" roughness={0.62} />
              </mesh>
            </group>
          ))}
          <group position={[0.26, 0.08, -0.22]} rotation={[0.3, -0.2, -0.62]}>
            <mesh castShadow position={[0, 0.15, 0]}>
              <capsuleGeometry args={[0.045, 0.24, 4, 7]} />
              <meshPhysicalMaterial color="#2b3630" roughness={0.82} clearcoat={0.02} />
            </mesh>
            <mesh position={[0, 0.34, 0]} rotation={[0, 0, -0.2]}>
              <coneGeometry args={[0.04, 0.2, 6]} />
              <meshStandardMaterial color="#202925" roughness={0.65} />
            </mesh>
          </group>
          <group ref={crown} position={[0.17, 0.13, 0.42]} rotation={[0.08, 0.2, 0.32]}>
            <mesh scale={[1, 0.72, 0.4]}>
              <dodecahedronGeometry args={[0.14, 1]} />
              <meshStandardMaterial color="#221a1c" roughness={0.88} />
            </mesh>
            {[-0.62, 0, 0.62].map((angle, index) => (
              <mesh key={`slime-core-crack-${angle}`} position={[angle * 0.04, (index - 1) * 0.035, 0.055]} rotation={[0, 0, angle]}>
                <capsuleGeometry args={[0.012, 0.11 + index * 0.025, 3, 5]} />
                <meshStandardMaterial color="#8b4034" emissive="#6a2b2b" emissiveIntensity={1.1} roughness={0.42} />
              </mesh>
            ))}
          </group>
          {[-0.29, 0.3].map((x, index) => (
            <mesh key={`slime-drip-${x}`} castShadow position={[x, -0.29 + index * 0.025, 0.37]} rotation={[0.1, 0, index === 0 ? -0.08 : 0.12]}>
              <capsuleGeometry args={[0.055, 0.22 + index * 0.07, 4, 7]} />
              <meshPhysicalMaterial color={index === 0 ? '#26312c' : '#303a33'} roughness={0.82} clearcoat={0.03} />
            </mesh>
          ))}
          {[-0.24, 0.22].map((x, index) => (
            <mesh key={`slime-fissure-${x}`} position={[x, 0.12 - index * 0.16, 0.53]} rotation={[0, 0, index === 0 ? -0.6 : 0.48]} scale={[1, 0.45, 0.5]}>
              <capsuleGeometry args={[0.025, 0.17, 3, 6]} />
              <meshStandardMaterial color="#111914" roughness={0.8} />
            </mesh>
          ))}
        </group>
      </group>
      <HitFlash animationProps={animationProps} radius={0.72} height={0.92} />
      {elite && (
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.025, 0]}>
          <torusGeometry args={[0.68, 0.035, 6, 26]} />
          <meshBasicMaterial color="#e3a33f" />
        </mesh>
      )}
    </group>
  );
}

function CreatureLeg({
  refs,
  position,
  color,
  footColor,
  scale = 1,
}: {
  refs: LimbRefs;
  position: [number, number, number];
  color: string;
  footColor: string;
  scale?: number;
}) {
  return (
    <group ref={refs.root} position={position} scale={scale}>
      <mesh castShadow position={[0, -0.17, 0]}>
        <capsuleGeometry args={[0.095, 0.22, 5, 8]} />
        <meshStandardMaterial color={color} roughness={0.84} />
      </mesh>
      <group ref={refs.joint} position={[0, -0.37, 0]}>
        <mesh castShadow>
          <sphereGeometry args={[0.1, 8, 6]} />
          <meshStandardMaterial color={color} roughness={0.84} />
        </mesh>
        <mesh castShadow position={[0, -0.15, 0]}>
          <capsuleGeometry args={[0.078, 0.18, 5, 8]} />
          <meshStandardMaterial color={color} roughness={0.86} />
        </mesh>
        <mesh castShadow position={[0, -0.3, 0.08]} rotation={[Math.PI / 2, 0, 0]} scale={[1, 1.2, 0.7]}>
          <capsuleGeometry args={[0.08, 0.16, 4, 7]} />
          <meshStandardMaterial color={footColor} roughness={0.72} />
        </mesh>
        {[-1, 1].map((side) => (
          <mesh key={`claw-${side}`} position={[side * 0.045, -0.31, 0.23]} rotation={[Math.PI / 2.3, 0, 0]}>
            <coneGeometry args={[0.022, 0.12, 5]} />
            <meshStandardMaterial color="#c9bea1" roughness={0.52} />
          </mesh>
        ))}
      </group>
    </group>
  );
}

interface QuadrupedRig {
  root: MutableRefObject<THREE.Group | null>;
  head: MutableRefObject<THREE.Group | null>;
  frontLeft: LimbRefs;
  frontRight: LimbRefs;
  backLeft: LimbRefs;
  backRight: LimbRefs;
}

function resetQuadrupedRig(rig: QuadrupedRig) {
  if (rig.root.current) {
    rig.root.current.position.set(0, 0, 0);
    rig.root.current.rotation.set(0, 0, 0);
  }
  applyRotation(rig.head, 0, 0, 0);
  for (const leg of [rig.frontLeft, rig.frontRight, rig.backLeft, rig.backRight]) {
    applyRotation(leg.root, 0, 0, 0);
    applyRotation(leg.joint, 0.08, 0, 0);
  }
}

function poseQuadruped(rig: QuadrupedRig, clock: Arena3DAnimationClock, unitId: Arena3DUnitId) {
  resetQuadrupedRig(rig);
  const root = rig.root.current;
  const head = rig.head.current;
  if (!root || !head) return;

  if (clock.phase === 'idle') {
    const breath = Math.sin(clock.loopProgress * Math.PI * 2);
    root.position.y = breath * 0.018;
    head.rotation.x = breath * 0.035;
    return;
  }
  if (clock.phase === 'locomotion') {
    const cycle = clock.loopProgress * Math.PI * 2;
    const diagonalA = sampleGait(clock.loopProgress);
    const diagonalB = sampleGait(clock.loopProgress, 0.5);
    const heavy = unitId === 'boar' || unitId === 'gargoyle' ? 0.84 : 1;
    const stride = unitId === 'wolf' ? 0.78 : 0.66;
    const sway = Math.sin(cycle) * heavy;
    const footfall = Math.abs(Math.sin(cycle * 2));

    root.position.x = sway * 0.025;
    root.position.y = footfall * 0.035 + (diagonalA.lift + diagonalB.lift) * 0.012;
    root.rotation.x = (diagonalA.contact - diagonalB.contact) * 0.018;
    root.rotation.y = Math.sin(cycle * 2) * 0.018;
    root.rotation.z = sway * 0.032;
    applyRotation(rig.frontLeft.root, diagonalA.hip * stride, 0, -sway * 0.02);
    applyRotation(rig.backRight.root, diagonalA.hip * stride * 0.92, 0, -sway * 0.02);
    applyRotation(rig.frontRight.root, diagonalB.hip * stride, 0, -sway * 0.02);
    applyRotation(rig.backLeft.root, diagonalB.hip * stride * 0.92, 0, -sway * 0.02);
    applyRotation(rig.frontLeft.joint, diagonalA.knee * 0.68 + 0.08);
    applyRotation(rig.backRight.joint, diagonalA.knee * 0.72 + 0.08);
    applyRotation(rig.frontRight.joint, diagonalB.knee * 0.68 + 0.08);
    applyRotation(rig.backLeft.joint, diagonalB.knee * 0.72 + 0.08);
    head.rotation.x = -0.1 + footfall * 0.07;
    head.rotation.y = -Math.sin(cycle * 2) * 0.035;
    head.rotation.z = -sway * 0.025;
    return;
  }
  if (clock.phase === 'hit') {
    const recoil = hitReactionAmount(clock.progress);
    root.position.z = -recoil * 0.44;
    root.position.y = recoil * 0.035;
    root.rotation.x = -recoil * 0.24;
    root.rotation.z = recoil * 0.1;
    head.rotation.x = recoil * 0.64;
    applyRotation(rig.frontLeft.root, 0.34 * recoil);
    applyRotation(rig.frontRight.root, 0.34 * recoil);
    applyRotation(rig.backLeft.root, -0.2 * recoil);
    applyRotation(rig.backRight.root, -0.2 * recoil);
    return;
  }
  if (clock.phase === 'death') {
    const fall = easeInOut(clock.progress);
    root.rotation.z = fall * 1.28;
    root.position.y = -fall * 0.48;
    head.rotation.x = fall * 0.45;
    return;
  }
  const { anticipation, strike, recovery } = combatPoseProgress(clock);
  const wind = anticipation * (1 - strike);
  const hit = strike * (1 - recovery);

  if (unitId === 'boar') {
    root.position.z = -wind * 0.22 + hit * 0.58;
    root.position.y = -wind * 0.1 + hit * 0.035;
    root.rotation.x = wind * 0.08 - hit * 0.1;
    head.rotation.x = 0.48 * wind - 0.58 * hit;
    applyRotation(rig.frontLeft.root, 0.28 * wind - 0.36 * hit);
    applyRotation(rig.frontRight.root, 0.28 * wind - 0.36 * hit);
    applyRotation(rig.backLeft.root, -0.32 * hit);
    applyRotation(rig.backRight.root, -0.32 * hit);
    return;
  }

  if (unitId === 'wolf') {
    root.position.z = -wind * 0.28 + hit * 0.62;
    root.position.y = -wind * 0.14 + Math.sin(hit * Math.PI) * 0.2;
    head.rotation.x = 0.26 * wind - 0.86 * hit;
    applyRotation(rig.frontLeft.root, 0.48 * wind - 0.62 * hit);
    applyRotation(rig.frontRight.root, 0.48 * wind - 0.62 * hit);
    applyRotation(rig.backLeft.root, -0.38 * wind + 0.22 * hit);
    applyRotation(rig.backRight.root, -0.38 * wind + 0.22 * hit);
    return;
  }

  if (unitId === 'drake') {
    root.position.z = -wind * 0.1 + hit * 0.18;
    root.position.y = wind * 0.08;
    root.rotation.x = -wind * 0.15 + hit * 0.12;
    head.rotation.x = -0.58 * wind + 0.82 * hit;
    applyRotation(rig.frontLeft.root, -0.24 * wind + 0.18 * hit);
    applyRotation(rig.frontRight.root, -0.24 * wind + 0.18 * hit);
    return;
  }

  if (unitId === 'gargoyle') {
    root.position.z = -wind * 0.2 + hit * 0.46;
    root.position.y = wind * 0.12 + Math.sin(hit * Math.PI) * 0.14;
    root.rotation.x = -wind * 0.12 + hit * 0.18;
    head.rotation.x = 0.32 * wind - 0.7 * hit;
    applyRotation(rig.frontLeft.root, -0.42 * wind + 0.55 * hit);
    applyRotation(rig.frontRight.root, -0.42 * wind + 0.55 * hit);
    return;
  }
  root.position.z = -wind * 0.16 + hit * 0.42;
  root.position.y = hit * 0.06;
  head.rotation.x = 0.38 * wind - 0.72 * hit;
  applyRotation(rig.frontLeft.root, 0.3 * wind - 0.24 * hit);
  applyRotation(rig.frontRight.root, 0.3 * wind - 0.24 * hit);
  applyRotation(rig.backLeft.root, -0.2 * hit);
  applyRotation(rig.backRight.root, -0.2 * hit);
}

function BoarActor({ animationProps, elite }: { animationProps: AnimatedActorProps; elite: boolean }) {
  const rig: QuadrupedRig = {
    root: useRef<THREE.Group>(null),
    head: useRef<THREE.Group>(null),
    frontLeft: { root: useRef<THREE.Group>(null), joint: useRef<THREE.Group>(null) },
    frontRight: { root: useRef<THREE.Group>(null), joint: useRef<THREE.Group>(null) },
    backLeft: { root: useRef<THREE.Group>(null), joint: useRef<THREE.Group>(null) },
    backRight: { root: useRef<THREE.Group>(null), joint: useRef<THREE.Group>(null) },
  };
  useFrame(() => poseQuadruped(rig, actorClock(animationProps), animationProps.unitId));

  return (
    <group rotation={[0, actorYaw(animationProps.direction), 0]} scale={0.9}>
      <group ref={rig.root}>
        <mesh castShadow position={[0, 0.69, 0]} scale={[0.62, 0.52, 0.95]}>
          <sphereGeometry args={[0.7, 13, 9]} />
          <meshStandardMaterial color={elite ? '#75513b' : '#60473a'} roughness={0.94} />
        </mesh>
        <mesh castShadow position={[0, 0.75, 0.42]} scale={[0.68, 0.74, 0.58]}>
          <sphereGeometry args={[0.55, 12, 9]} />
          <meshStandardMaterial color={elite ? '#825942' : '#6b4b3d'} roughness={0.95} />
        </mesh>
        <mesh castShadow position={[0, 0.83, -0.52]} scale={[0.55, 0.75, 0.56]}>
          <sphereGeometry args={[0.5, 10, 8]} />
          <meshStandardMaterial color="#342c29" roughness={0.98} />
        </mesh>
        {[-0.55, -0.36, -0.17, 0.02, 0.21, 0.4].map((spineZ, index) => (
          <mesh
            key={`boar-mane-${spineZ}`}
            position={[0, 1.11 + Math.sin((index / 5) * Math.PI) * 0.1, spineZ]}
            rotation={[0.12, 0, index % 2 === 0 ? 0.05 : -0.05]}
          >
            <coneGeometry args={[0.075, 0.34 - index * 0.018, 6]} />
            <meshStandardMaterial color="#292526" roughness={0.98} />
          </mesh>
        ))}
        {[-0.3, 0.02, 0.32].map((plateZ, index) => (
          <mesh
            key={`boar-bone-plate-${plateZ}`}
            castShadow
            position={[0.17, 0.98 + index * 0.025, plateZ]}
            rotation={[0.08, index % 2 === 0 ? 0.14 : -0.12, -0.08]}
            scale={[1.45, 0.38, 1]}
          >
            <dodecahedronGeometry args={[0.22, 0]} />
            <meshStandardMaterial color="#797364" metalness={0.08} roughness={0.82} />
          </mesh>
        ))}
        <group position={[0.42, 0.69, 0.06]} rotation={[0.08, 0, -0.18]}>
          {[-0.11, 0, 0.11].map((scarY, index) => (
            <mesh key={`boar-scar-${scarY}`} position={[0, scarY, index * 0.025]} rotation={[0, 0, 0.72]}>
              <capsuleGeometry args={[0.018, 0.2, 3, 6]} />
              <meshStandardMaterial color="#542b28" emissive="#321615" emissiveIntensity={0.18} roughness={0.7} />
            </mesh>
          ))}
        </group>
        <group position={[0, 0.84, -0.82]} rotation={[0.15, 0, 0]}>
          <mesh castShadow rotation={[Math.PI / 2, 0, 0]}>
            <torusGeometry args={[0.16, 0.04, 6, 16, Math.PI * 1.45]} />
            <meshStandardMaterial color="#3d302c" roughness={0.96} />
          </mesh>
        </group>
        <group ref={rig.head} position={[0, 0.66, 0.74]}>
          <mesh castShadow scale={[0.56, 0.5, 0.7]}>
            <sphereGeometry args={[0.62, 12, 9]} />
            <meshStandardMaterial color="#70503e" roughness={0.95} />
          </mesh>
          <mesh castShadow position={[0, -0.04, 0.42]} scale={[0.76, 0.58, 1]}>
            <sphereGeometry args={[0.35, 10, 7]} />
            <meshStandardMaterial color="#4a3530" roughness={0.9} />
          </mesh>
          <mesh castShadow position={[0, -0.24, 0.28]} scale={[0.72, 0.45, 0.86]}>
            <sphereGeometry args={[0.34, 10, 7]} />
            <meshStandardMaterial color="#3f302c" roughness={0.94} />
          </mesh>
          <mesh castShadow position={[0.08, 0.18, 0.3]} rotation={[-0.16, 0.08, -0.08]} scale={[1.35, 0.42, 0.72]}>
            <dodecahedronGeometry args={[0.25, 0]} />
            <meshStandardMaterial color="#777061" metalness={0.06} roughness={0.84} />
          </mesh>
          {[-1, 1].map((side) => (
            <mesh key={`boar-nostril-${side}`} position={[side * 0.09, 0, 0.72]} scale={[1, 0.7, 0.45]}>
              <sphereGeometry args={[0.027, 6, 5]} />
              <meshBasicMaterial color="#191718" />
            </mesh>
          ))}
          {[-1, 1].map((side) => (
            <group key={side}>
              <mesh castShadow position={[side * 0.29, 0.3, -0.02]} rotation={[0.12, 0, side * -0.45]}>
                <coneGeometry args={[0.13, 0.34, 5]} />
                <meshStandardMaterial color="#4b352e" roughness={0.94} />
              </mesh>
              <mesh castShadow position={[side * 0.3, -0.11, 0.56]} rotation={[Math.PI / 2.45, 0, side * 0.25]}>
                <coneGeometry args={[0.072, 0.48, 8]} />
                <meshStandardMaterial color="#d5c8a5" roughness={0.54} />
              </mesh>
              <mesh castShadow position={[side * 0.22, -0.2, 0.48]} rotation={[Math.PI / 2.2, 0, side * 0.34]}>
                <coneGeometry args={[0.04, 0.27, 7]} />
                <meshStandardMaterial color="#a99f84" roughness={0.62} />
              </mesh>
              <mesh position={[side * 0.2, 0.1, 0.44]}>
                <sphereGeometry args={[0.027, 6, 5]} />
                <meshBasicMaterial color="#e1a34f" />
              </mesh>
            </group>
          ))}
        </group>
        <CreatureLeg refs={rig.frontLeft} position={[-0.32, 0.48, 0.45]} color="#49372f" footColor="#252121" />
        <CreatureLeg refs={rig.frontRight} position={[0.32, 0.48, 0.45]} color="#49372f" footColor="#252121" />
        <CreatureLeg refs={rig.backLeft} position={[-0.32, 0.48, -0.43]} color="#49372f" footColor="#252121" />
        <CreatureLeg refs={rig.backRight} position={[0.32, 0.48, -0.43]} color="#49372f" footColor="#252121" />
      </group>
      <HitFlash animationProps={animationProps} radius={0.86} height={1.32} />
      {elite && (
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.025, 0]}>
          <torusGeometry args={[0.82, 0.04, 6, 28]} />
          <meshBasicMaterial color="#e3a33f" />
        </mesh>
      )}
    </group>
  );
}

function DrakeWing({ side, wingRef }: { side: -1 | 1; wingRef: MutableRefObject<THREE.Group | null> }) {
  return (
    <group ref={wingRef} position={[side * 0.34, 0.92, -0.12]} rotation={[0.1, 0, side * -0.35]}>
      {[0, 1, 2, 3].map((panel) => (
        <mesh
          key={`drake-wing-panel-${panel}`}
          castShadow
          position={[side * (0.24 + panel * 0.17), 0.05 - panel * 0.045, -0.03 - panel * 0.075]}
          rotation={[Math.PI / 2, 0, side * (-0.4 - panel * 0.16)]}
          scale={[1, 0.56 - panel * 0.05, 1]}
        >
          <circleGeometry args={[0.45 - panel * 0.045, 3]} />
          <meshStandardMaterial
            color={panel % 2 === 0 ? '#603940' : '#4b3036'}
            side={THREE.DoubleSide}
            roughness={0.84}
          />
        </mesh>
      ))}
      <mesh castShadow position={[side * 0.24, 0, 0]} rotation={[0, 0, side * -0.62]}>
        <cylinderGeometry args={[0.035, 0.055, 0.72, 6]} />
        <meshStandardMaterial color="#332a2d" roughness={0.78} />
      </mesh>
      <mesh castShadow position={[side * 0.69, -0.09, -0.08]} rotation={[0.05, 0.1, side * -0.92]}>
        <cylinderGeometry args={[0.025, 0.04, 0.78, 6]} />
        <meshStandardMaterial color="#2b2529" roughness={0.8} />
      </mesh>
      {[0, 1, 2].map((finger) => (
        <group
          key={`wing-finger-${finger}`}
          position={[side * (0.48 + finger * 0.17), -0.1 - finger * 0.03, -0.08 - finger * 0.1]}
          rotation={[0.08, 0, side * (-0.78 - finger * 0.11)]}
        >
          <mesh>
            <cylinderGeometry args={[0.015, 0.026, 0.52 - finger * 0.07, 5]} />
            <meshStandardMaterial color="#342a2e" roughness={0.8} />
          </mesh>
          <mesh position={[0, 0.29 - finger * 0.035, 0]}>
            <coneGeometry args={[0.025, 0.12, 5]} />
            <meshStandardMaterial color="#c5b793" roughness={0.55} />
          </mesh>
        </group>
      ))}
    </group>
  );
}

function DrakeActor({ animationProps, elite }: { animationProps: AnimatedActorProps; elite: boolean }) {
  const rig: QuadrupedRig = {
    root: useRef<THREE.Group>(null),
    head: useRef<THREE.Group>(null),
    frontLeft: { root: useRef<THREE.Group>(null), joint: useRef<THREE.Group>(null) },
    frontRight: { root: useRef<THREE.Group>(null), joint: useRef<THREE.Group>(null) },
    backLeft: { root: useRef<THREE.Group>(null), joint: useRef<THREE.Group>(null) },
    backRight: { root: useRef<THREE.Group>(null), joint: useRef<THREE.Group>(null) },
  };
  const leftWing = useRef<THREE.Group>(null);
  const rightWing = useRef<THREE.Group>(null);
  const tailBase = useRef<THREE.Group>(null);
  const tailTip = useRef<THREE.Group>(null);

  useFrame(() => {
    const clock = actorClock(animationProps);
    poseQuadruped(rig, clock, animationProps.unitId);
    const flap = clock.phase === 'locomotion'
      ? Math.sin(clock.loopProgress * Math.PI * 4) * 0.22
      : Math.sin(clock.elapsedMs / 420) * 0.055;
    if (leftWing.current) leftWing.current.rotation.z = -0.34 - flap;
    if (rightWing.current) rightWing.current.rotation.z = 0.34 + flap;
    if (tailBase.current) tailBase.current.rotation.y = Math.sin(clock.elapsedMs / 310) * 0.16;
    if (tailTip.current) tailTip.current.rotation.y = Math.sin(clock.elapsedMs / 270 + 0.7) * 0.2;
  });

  return (
    <group rotation={[0, actorYaw(animationProps.direction), 0]} scale={1.06}>
      <group ref={rig.root}>
        <mesh castShadow position={[0, 0.76, -0.05]} scale={[0.62, 0.52, 1]}>
          <sphereGeometry args={[0.67, 14, 10]} />
          <meshStandardMaterial color={elite ? '#62363d' : '#49343a'} metalness={0.08} roughness={0.7} />
        </mesh>
        <mesh castShadow position={[0, 0.79, 0.39]} scale={[0.68, 0.66, 0.62]}>
          <sphereGeometry args={[0.56, 13, 9]} />
          <meshStandardMaterial color={elite ? '#704047' : '#54373c'} metalness={0.1} roughness={0.68} />
        </mesh>
        <mesh castShadow position={[0, 0.79, 0.51]} rotation={[0.28, 0, 0]}>
          <capsuleGeometry args={[0.23, 0.48, 5, 8]} />
          <meshStandardMaterial color="#583a3d" roughness={0.74} />
        </mesh>
        {[-0.53, -0.3, -0.07, 0.16, 0.39].map((spineZ, index) => (
          <mesh
            key={`drake-spine-${spineZ}`}
            position={[0, 1.18 + Math.sin((index / 4) * Math.PI) * 0.1, spineZ]}
            rotation={[0.12, 0, index % 2 === 0 ? 0.04 : -0.04]}
          >
            <coneGeometry args={[0.07, 0.31 - index * 0.02, 6]} />
            <meshStandardMaterial color="#2c272c" roughness={0.74} />
          </mesh>
        ))}
        {[-0.18, 0, 0.18].map((plateX) => (
          <mesh key={`drake-belly-${plateX}`} castShadow position={[plateX, 0.61, 0.5]} rotation={[0.42, 0, 0]} scale={[0.92, 0.55, 0.55]}>
            <sphereGeometry args={[0.16, 8, 6]} />
            <meshStandardMaterial color="#7a5650" metalness={0.08} roughness={0.62} />
          </mesh>
        ))}
        <group ref={rig.head} position={[0, 0.96, 0.9]}>
          <mesh castShadow scale={[0.52, 0.43, 0.7]}>
            <sphereGeometry args={[0.58, 12, 9]} />
            <meshStandardMaterial color="#654043" roughness={0.72} />
          </mesh>
          <mesh castShadow position={[0, -0.06, 0.42]} scale={[0.62, 0.42, 1]}>
            <sphereGeometry args={[0.34, 10, 7]} />
            <meshStandardMaterial color="#3c2d31" roughness={0.77} />
          </mesh>
          <mesh castShadow position={[0, -0.22, 0.3]} rotation={[0.16, 0, 0]} scale={[0.64, 0.26, 0.9]}>
            <sphereGeometry args={[0.34, 10, 7]} />
            <meshStandardMaterial color="#35282c" roughness={0.8} />
          </mesh>
          {[-1, 1].map((side) => (
            <group key={`drake-face-${side}`}>
              <mesh position={[side * 0.105, 0.02, 0.72]} scale={[1, 0.7, 0.45]}>
                <sphereGeometry args={[0.025, 6, 5]} />
                <meshBasicMaterial color="#171416" />
              </mesh>
              <mesh position={[side * 0.12, -0.2, 0.5]} rotation={[Math.PI / 2.5, 0, side * 0.08]}>
                <coneGeometry args={[0.025, 0.16, 5]} />
                <meshStandardMaterial color="#d7c9a8" roughness={0.52} />
              </mesh>
            </group>
          ))}
          {[-1, 1].map((side) => (
            <group key={side}>
              <mesh castShadow position={[side * 0.22, 0.3, -0.12]} rotation={[0.08, 0, side * -0.28]}>
                <coneGeometry args={[0.065, 0.38, 6]} />
                <meshStandardMaterial color="#2e282b" roughness={0.7} />
              </mesh>
              <mesh position={[side * 0.16, 0.07, 0.42]}>
                <sphereGeometry args={[0.034, 6, 5]} />
                <meshBasicMaterial color="#ff874c" />
              </mesh>
            </group>
          ))}
        </group>
        <DrakeWing side={-1} wingRef={leftWing} />
        <DrakeWing side={1} wingRef={rightWing} />
        <CreatureLeg refs={rig.frontLeft} position={[-0.32, 0.48, 0.4]} color="#52373b" footColor="#292326" scale={0.92} />
        <CreatureLeg refs={rig.frontRight} position={[0.32, 0.48, 0.4]} color="#52373b" footColor="#292326" scale={0.92} />
        <CreatureLeg refs={rig.backLeft} position={[-0.35, 0.48, -0.42]} color="#52373b" footColor="#292326" scale={1.08} />
        <CreatureLeg refs={rig.backRight} position={[0.35, 0.48, -0.42]} color="#52373b" footColor="#292326" scale={1.08} />
        <group ref={tailBase} position={[0, 0.72, -0.7]} rotation={[-Math.PI / 2.5, 0, 0]}>
          <mesh castShadow position={[0, 0.42, 0]}>
            <coneGeometry args={[0.22, 0.95, 9]} />
            <meshStandardMaterial color="#49343a" roughness={0.76} />
          </mesh>
          {[0.2, 0.46, 0.7].map((tailY, index) => (
            <mesh key={`tail-spine-${tailY}`} position={[0, tailY, -0.16 + index * 0.025]} rotation={[0.18, 0, 0]}>
              <coneGeometry args={[0.045, 0.2 - index * 0.025, 5]} />
              <meshStandardMaterial color="#2a252a" roughness={0.78} />
            </mesh>
          ))}
          <group ref={tailTip} position={[0, 0.86, 0]} rotation={[0.14, 0, 0]}>
            <mesh castShadow position={[0, 0.3, 0]}>
              <coneGeometry args={[0.12, 0.68, 8]} />
              <meshStandardMaterial color="#3b2e33" roughness={0.8} />
            </mesh>
          </group>
        </group>
      </group>
      <HitFlash animationProps={animationProps} radius={1} height={1.62} />
      {elite && (
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.025, 0]}>
          <torusGeometry args={[0.94, 0.045, 6, 30]} />
          <meshBasicMaterial color="#e3a33f" />
        </mesh>
      )}
    </group>
  );
}

function WolfActor({ animationProps, elite }: { animationProps: AnimatedActorProps; elite: boolean }) {
  const rig: QuadrupedRig = {
    root: useRef<THREE.Group>(null),
    head: useRef<THREE.Group>(null),
    frontLeft: { root: useRef<THREE.Group>(null), joint: useRef<THREE.Group>(null) },
    frontRight: { root: useRef<THREE.Group>(null), joint: useRef<THREE.Group>(null) },
    backLeft: { root: useRef<THREE.Group>(null), joint: useRef<THREE.Group>(null) },
    backRight: { root: useRef<THREE.Group>(null), joint: useRef<THREE.Group>(null) },
  };
  const tailBase = useRef<THREE.Group>(null);
  const tailTip = useRef<THREE.Group>(null);

  useFrame(() => {
    const clock = actorClock(animationProps);
    poseQuadruped(rig, clock, animationProps.unitId);
    const stride = clock.phase === 'locomotion' ? Math.sin(clock.loopProgress * Math.PI * 2) : 0;
    const droop = clock.phase === 'death' ? easeInOut(clock.progress) * 0.75 : 0;
    if (tailBase.current) tailBase.current.rotation.y = stride * 0.16;
    if (tailBase.current) tailBase.current.rotation.x = -0.82 - droop;
    if (tailTip.current) tailTip.current.rotation.y = Math.sin(clock.elapsedMs / 230) * 0.12;
  });

  return (
    <group rotation={[0, actorYaw(animationProps.direction), 0]} scale={0.88}>
      <group ref={rig.root}>
        <mesh castShadow position={[0, 0.7, -0.08]} scale={[0.5, 0.46, 0.76]}>
          <dodecahedronGeometry args={[0.68, 1]} />
          <meshStandardMaterial color={elite ? '#6b6259' : '#4b4947'} roughness={0.94} />
        </mesh>
        <mesh castShadow position={[0, 0.77, -0.48]} rotation={[-0.08, 0.06, 0]} scale={[0.68, 0.68, 0.62]}>
          <dodecahedronGeometry args={[0.47, 1]} />
          <meshStandardMaterial color={elite ? '#6d645b' : '#454441'} roughness={0.96} />
        </mesh>
        <mesh castShadow position={[0, 0.8, 0.39]} rotation={[0.08, -0.04, 0]} scale={[0.68, 0.78, 0.62]}>
          <dodecahedronGeometry args={[0.49, 1]} />
          <meshStandardMaterial color={elite ? '#7b7063' : '#56514d'} roughness={0.95} />
        </mesh>
        <mesh castShadow position={[0, 0.86, 0.63]} rotation={[0.16, 0, 0]} scale={[0.74, 0.9, 0.72]}>
          <dodecahedronGeometry args={[0.27, 1]} />
          <meshStandardMaterial color="#5c5550" roughness={0.95} />
        </mesh>
        <group ref={rig.head} position={[0, 0.91, 0.82]}>
          <mesh castShadow scale={[0.47, 0.45, 0.55]}>
            <dodecahedronGeometry args={[0.48, 1]} />
            <meshStandardMaterial color="#625a54" roughness={0.94} />
          </mesh>
          <mesh castShadow position={[0, -0.09, 0.38]} scale={[0.48, 0.36, 0.92]}>
            <dodecahedronGeometry args={[0.32, 1]} />
            <meshStandardMaterial color="#3c3938" roughness={0.92} />
          </mesh>
          <mesh position={[0, -0.07, 0.67]} scale={[1.1, 0.72, 0.7]}>
            <sphereGeometry args={[0.055, 8, 6]} />
            <meshStandardMaterial color="#171719" roughness={0.5} />
          </mesh>
          {[-1, 1].map((side) => (
            <group key={`wolf-face-${side}`}>
              <mesh castShadow position={[side * 0.17, 0.25, -0.02]} rotation={[0.12, 0, side * -0.2]}>
                <coneGeometry args={[0.105, 0.34, 6]} />
                <meshStandardMaterial color="#383739" roughness={0.94} />
              </mesh>
              <mesh position={[side * 0.105, 0.04, 0.36]}>
                <sphereGeometry args={[0.028, 7, 5]} />
                <meshBasicMaterial color="#e4a64e" />
              </mesh>
              <mesh position={[side * 0.08, -0.2, 0.45]} rotation={[Math.PI / 2.4, 0, side * 0.07]}>
                <coneGeometry args={[0.018, 0.11, 5]} />
                <meshStandardMaterial color="#d7ceb6" roughness={0.5} />
              </mesh>
            </group>
          ))}
        </group>
        <CreatureLeg refs={rig.frontLeft} position={[-0.24, 0.5, 0.42]} color="#4c4845" footColor="#28282a" scale={0.86} />
        <CreatureLeg refs={rig.frontRight} position={[0.24, 0.5, 0.42]} color="#4c4845" footColor="#28282a" scale={0.86} />
        <CreatureLeg refs={rig.backLeft} position={[-0.25, 0.5, -0.42]} color="#44413f" footColor="#252527" scale={0.9} />
        <CreatureLeg refs={rig.backRight} position={[0.25, 0.5, -0.42]} color="#44413f" footColor="#252527" scale={0.9} />
        <group ref={tailBase} position={[0, 0.76, -0.67]} rotation={[-0.82, 0, 0]}>
          <mesh castShadow position={[0, 0.31, 0]}>
            <capsuleGeometry args={[0.1, 0.46, 5, 9]} />
            <meshStandardMaterial color="#454240" roughness={0.96} />
          </mesh>
          <group ref={tailTip} position={[0, 0.58, 0]}>
            <mesh castShadow position={[0, 0.23, 0]}>
              <capsuleGeometry args={[0.07, 0.34, 5, 8]} />
              <meshStandardMaterial color="#363536" roughness={0.96} />
            </mesh>
          </group>
        </group>
      </group>
      <HitFlash animationProps={animationProps} radius={0.78} height={1.38} />
    </group>
  );
}

function SpiderLeg({
  refs,
  side,
  z,
}: {
  refs: LimbRefs;
  side: -1 | 1;
  z: number;
}) {
  return (
    <group ref={refs.root} position={[side * 0.25, 0.48, z]} rotation={[0, 0, side * -0.9]}>
      <mesh castShadow position={[0, 0.25, 0]}>
        <capsuleGeometry args={[0.055, 0.38, 4, 7]} />
        <meshStandardMaterial color="#34262e" metalness={0.08} roughness={0.72} />
      </mesh>
      <group ref={refs.joint} position={[0, 0.48, 0]} rotation={[0, 0, side * 0.62]}>
        <mesh castShadow position={[0, 0.28, 0]}>
          <cylinderGeometry args={[0.022, 0.05, 0.54, 7]} />
          <meshStandardMaterial color="#211d24" metalness={0.1} roughness={0.68} />
        </mesh>
        <mesh position={[0, 0.58, 0]}>
          <coneGeometry args={[0.025, 0.17, 5]} />
          <meshStandardMaterial color="#a58f7f" roughness={0.52} />
        </mesh>
      </group>
    </group>
  );
}

function SpiderActor({ animationProps, elite }: { animationProps: AnimatedActorProps; elite: boolean }) {
  const root = useRef<THREE.Group>(null);
  const body = useRef<THREE.Group>(null);
  const legs: LimbRefs[] = [
    { root: useRef<THREE.Group>(null), joint: useRef<THREE.Group>(null) },
    { root: useRef<THREE.Group>(null), joint: useRef<THREE.Group>(null) },
    { root: useRef<THREE.Group>(null), joint: useRef<THREE.Group>(null) },
    { root: useRef<THREE.Group>(null), joint: useRef<THREE.Group>(null) },
    { root: useRef<THREE.Group>(null), joint: useRef<THREE.Group>(null) },
    { root: useRef<THREE.Group>(null), joint: useRef<THREE.Group>(null) },
    { root: useRef<THREE.Group>(null), joint: useRef<THREE.Group>(null) },
    { root: useRef<THREE.Group>(null), joint: useRef<THREE.Group>(null) },
  ];

  useFrame(() => {
    const clock = actorClock(animationProps);
    if (!root.current || !body.current) return;
    root.current.position.set(0, 0, 0);
    root.current.rotation.set(0, 0, 0);
    body.current.scale.set(1, 1, 1);
    legs.forEach((leg, index) => {
      const layout = SPIDER_LEG_LAYOUT[index];
      if (!layout) return;
      leg.root.current?.rotation.set(0, 0, layout.side * -0.9);
      leg.joint.current?.rotation.set(0, 0, layout.side * 0.62);
    });

    if (clock.phase === 'idle') {
      root.current.position.y = Math.sin(clock.loopProgress * Math.PI * 2) * 0.018;
      return;
    }
    if (clock.phase === 'locomotion') {
      const cycle = clock.loopProgress * Math.PI * 2;
      root.current.position.y = Math.abs(Math.sin(cycle * 2)) * 0.055;
      legs.forEach((leg, index) => {
        const gait = Math.sin(cycle + (index % 2) * Math.PI) * 0.32;
        if (leg.root.current) leg.root.current.rotation.x = gait;
        if (leg.joint.current) leg.joint.current.rotation.x = -gait * 0.6;
      });
      return;
    }
    if (clock.phase === 'hit') {
      const recoil = hitReactionAmount(clock.progress);
      root.current.position.z = -recoil * 0.36;
      root.current.rotation.x = -recoil * 0.18;
      body.current.scale.set(1 + recoil * 0.22, 1 - recoil * 0.28, 1 + recoil * 0.12);
      return;
    }
    if (clock.phase === 'death') {
      const collapse = easeInOut(clock.progress);
      root.current.position.y = -collapse * 0.32;
      body.current.scale.set(1 + collapse * 0.2, 1 - collapse * 0.58, 1 + collapse * 0.16);
      legs.forEach((leg, index) => {
        const side = SPIDER_LEG_LAYOUT[index]?.side ?? 1;
        if (leg.root.current) leg.root.current.rotation.z = side * (-0.9 - collapse * 0.48);
        if (leg.joint.current) leg.joint.current.rotation.z = side * (0.62 + collapse * 0.52);
      });
      return;
    }
    const { anticipation, strike, recovery } = combatPoseProgress(clock);
    const wind = anticipation * (1 - strike);
    const hit = strike * (1 - recovery);
    root.current.position.z = -wind * 0.18 + hit * 0.42;
    root.current.position.y = hit * 0.08;
    [0, 3, 4, 7].forEach((index) => {
      if (legs[index]?.root.current) legs[index].root.current.rotation.x = -wind * 0.45 + hit * 0.72;
    });
  });

  return (
    <group rotation={[0, actorYaw(animationProps.direction), 0]} scale={0.92}>
      <group ref={root}>
        <group ref={body}>
          <mesh castShadow position={[0, 0.55, -0.27]} scale={[0.66, 0.52, 0.82]}>
            <sphereGeometry args={[0.57, 14, 10]} />
            <meshPhysicalMaterial color={elite ? '#61334e' : '#44293c'} roughness={0.5} clearcoat={0.25} />
          </mesh>
          <mesh castShadow position={[0, 0.55, 0.32]} scale={[0.62, 0.48, 0.58]}>
            <sphereGeometry args={[0.48, 13, 9]} />
            <meshStandardMaterial color="#30232f" metalness={0.08} roughness={0.66} />
          </mesh>
          {SPIDER_LEG_LAYOUT.map((layout, index) => (
            <SpiderLeg key={`${layout.side}:${layout.z}`} refs={legs[index]} side={layout.side} z={layout.z} />
          ))}
          {[-1, -0.35, 0.35, 1].map((eye, index) => (
            <mesh key={`spider-eye-${eye}`} position={[eye * 0.12, 0.68 - Math.abs(eye) * 0.025, 0.69]}>
              <sphereGeometry args={[index === 1 || index === 2 ? 0.045 : 0.032, 7, 5]} />
              <meshStandardMaterial color="#f05a48" emissive="#c13d35" emissiveIntensity={1.1} roughness={0.3} />
            </mesh>
          ))}
          {[-1, 1].map((side) => (
            <mesh key={`spider-fang-${side}`} position={[side * 0.11, 0.43, 0.68]} rotation={[Math.PI / 2.6, 0, side * 0.16]}>
              <coneGeometry args={[0.035, 0.22, 6]} />
              <meshStandardMaterial color="#d3c1ae" roughness={0.48} />
            </mesh>
          ))}
        </group>
      </group>
      <HitFlash animationProps={animationProps} radius={0.98} height={1.2} />
    </group>
  );
}

function TreantArm({ side, refs }: { side: -1 | 1; refs: LimbRefs }) {
  return (
    <group ref={refs.root} position={[side * 0.43, 1.38, 0]}>
      <mesh castShadow position={[0, -0.22, 0]} rotation={[0.04, 0, side * 0.08]}>
        <cylinderGeometry args={[0.09, 0.14, 0.48, 8]} />
        <meshStandardMaterial color="#4c3828" roughness={1} />
      </mesh>
      <mesh position={[side * 0.1, -0.1, 0]} rotation={[0, 0, side * -0.7]}>
        <coneGeometry args={[0.045, 0.28, 6]} />
        <meshStandardMaterial color="#35291f" roughness={1} />
      </mesh>
      <group ref={refs.joint} position={[0, -0.48, 0]}>
        <mesh castShadow>
          <sphereGeometry args={[0.105, 8, 6]} />
          <meshStandardMaterial color="#3d3025" roughness={1} />
        </mesh>
        <mesh castShadow position={[0, -0.21, 0]}>
          <cylinderGeometry args={[0.055, 0.095, 0.42, 7]} />
          <meshStandardMaterial color="#513a29" roughness={1} />
        </mesh>
        {[-1, 0, 1].map((finger) => (
          <mesh key={`root-finger-${finger}`} position={[finger * 0.065, -0.48, 0]} rotation={[0, 0, finger * -0.18]}>
            <coneGeometry args={[0.025, 0.24 - Math.abs(finger) * 0.03, 5]} />
            <meshStandardMaterial color="#372a20" roughness={1} />
          </mesh>
        ))}
      </group>
    </group>
  );
}

function TreantLeg({ side, refs }: { side: -1 | 1; refs: LimbRefs }) {
  return (
    <group ref={refs.root} position={[side * 0.19, 0.72, 0]}>
      <mesh castShadow position={[0, -0.2, 0]}>
        <cylinderGeometry args={[0.11, 0.15, 0.42, 8]} />
        <meshStandardMaterial color="#463426" roughness={1} />
      </mesh>
      <group ref={refs.joint} position={[0, -0.42, 0]}>
        <mesh castShadow position={[0, -0.18, 0]}>
          <cylinderGeometry args={[0.08, 0.12, 0.38, 7]} />
          <meshStandardMaterial color="#3c2e23" roughness={1} />
        </mesh>
        {[-1, 0, 1].map((rootToe) => (
          <mesh
            key={`treant-root-${rootToe}`}
            position={[rootToe * 0.09, -0.39, 0.11 + Math.abs(rootToe) * 0.02]}
            rotation={[Math.PI / 2.5, 0, rootToe * -0.16]}
          >
            <coneGeometry args={[0.045, 0.3 - Math.abs(rootToe) * 0.04, 6]} />
            <meshStandardMaterial color="#32271e" roughness={1} />
          </mesh>
        ))}
      </group>
    </group>
  );
}

function TreantActor({ animationProps, elite }: { animationProps: AnimatedActorProps; elite: boolean }) {
  const rig: HumanoidRig = {
    root: useRef<THREE.Group>(null),
    torso: useRef<THREE.Group>(null),
    head: useRef<THREE.Group>(null),
    leftArm: { root: useRef<THREE.Group>(null), joint: useRef<THREE.Group>(null) },
    rightArm: { root: useRef<THREE.Group>(null), joint: useRef<THREE.Group>(null) },
    leftLeg: { root: useRef<THREE.Group>(null), joint: useRef<THREE.Group>(null) },
    rightLeg: { root: useRef<THREE.Group>(null), joint: useRef<THREE.Group>(null) },
  };
  useFrame(() => poseHumanoid(
    rig,
    actorClock(animationProps),
    animationProps.animation,
    animationProps.unitId,
    animationProps.attackKind,
  ));

  return (
    <group rotation={[0, actorYaw(animationProps.direction), 0]} scale={1.02}>
      <group ref={rig.root}>
        <TreantLeg side={-1} refs={rig.leftLeg} />
        <TreantLeg side={1} refs={rig.rightLeg} />
        <group ref={rig.torso}>
          <mesh castShadow position={[0, 0.72, 0]} scale={[1, 1, 0.72]}>
            <latheGeometry args={[TREANT_TRUNK_PROFILE, 11]} />
            <meshStandardMaterial color={elite ? '#61432d' : '#4b3829'} roughness={1} />
          </mesh>
          <mesh castShadow position={[0, 1.22, 0.22]} rotation={[0, 0, Math.PI / 2]}>
            <torusGeometry args={[0.2, 0.038, 5, 14, Math.PI * 1.25]} />
            <meshStandardMaterial color="#2f291f" roughness={1} />
          </mesh>
          <TreantArm side={-1} refs={rig.leftArm} />
          <TreantArm side={1} refs={rig.rightArm} />
          <group ref={rig.head} position={[0, 1.63, 0]}>
            <mesh castShadow scale={[0.82, 0.9, 0.7]}>
              <dodecahedronGeometry args={[0.28, 1]} />
              <meshStandardMaterial color="#4d3827" roughness={1} />
            </mesh>
            {[-1, 1].map((side) => (
              <group key={`treant-eye-${side}`}>
                <mesh position={[side * 0.095, 0.02, 0.19]}>
                  <sphereGeometry args={[0.028, 7, 5]} />
                  <meshStandardMaterial color="#9fcb69" emissive="#6f9b42" emissiveIntensity={1.2} roughness={0.36} />
                </mesh>
                <mesh castShadow position={[side * 0.16, 0.31, -0.03]} rotation={[0, 0, side * -0.55]}>
                  <coneGeometry args={[0.045, 0.4, 6]} />
                  <meshStandardMaterial color="#35291f" roughness={1} />
                </mesh>
              </group>
            ))}
            <mesh castShadow position={[0, -0.1, 0.2]} rotation={[0, 0, Math.PI / 2]}>
              <torusGeometry args={[0.075, 0.02, 5, 12, Math.PI]} />
              <meshStandardMaterial color="#211c17" roughness={1} />
            </mesh>
          </group>
          {[-1, 1].map((side) => (
            <group
              key={`treant-upper-branch-${side}`}
              position={[side * 0.17, 1.48, -0.08]}
              rotation={[side * 0.08, side * 0.18, side * -0.56]}
            >
              <mesh castShadow position={[0, 0.34, 0]}>
                <cylinderGeometry args={[0.055, 0.1, 0.72, 7]} />
                <meshStandardMaterial color="#3f3024" roughness={1} />
              </mesh>
              <group position={[0, 0.69, 0]}>
                <mesh castShadow position={[side * 0.1, 0.18, 0]} rotation={[0.04, 0, side * -0.48]}>
                  <cylinderGeometry args={[0.026, 0.05, 0.42, 6]} />
                  <meshStandardMaterial color="#36291f" roughness={1} />
                </mesh>
                <mesh castShadow position={[side * -0.12, 0.13, -0.04]} rotation={[-0.08, 0, side * 0.64]}>
                  <cylinderGeometry args={[0.022, 0.045, 0.34, 6]} />
                  <meshStandardMaterial color="#33271e" roughness={1} />
                </mesh>
                <mesh castShadow position={[side * 0.22, 0.36, 0]} scale={[1, 0.72, 0.86]}>
                  <dodecahedronGeometry args={[0.15, 0]} />
                  <meshStandardMaterial color={elite ? '#455c35' : '#2d422d'} roughness={0.98} />
                </mesh>
                <mesh castShadow position={[side * -0.2, 0.28, -0.05]} scale={[1, 0.76, 0.9]}>
                  <dodecahedronGeometry args={[0.12, 0]} />
                  <meshStandardMaterial color={elite ? '#3f5733' : '#293b2b'} roughness={0.98} />
                </mesh>
              </group>
            </group>
          ))}
          <group position={[0.03, 1.76, -0.12]} rotation={[0.12, 0.18, -0.08]}>
            <mesh castShadow position={[0, 0.31, 0]}>
              <cylinderGeometry args={[0.045, 0.085, 0.64, 7]} />
              <meshStandardMaterial color="#3a2c22" roughness={1} />
            </mesh>
            <mesh castShadow position={[-0.12, 0.58, 0]} rotation={[0, 0, 0.58]}>
              <cylinderGeometry args={[0.022, 0.04, 0.3, 6]} />
              <meshStandardMaterial color="#32261d" roughness={1} />
            </mesh>
          </group>
          {[
            [-0.32, 1.82, -0.02, 0.16],
            [0, 2.04, -0.08, 0.18],
            [0.34, 1.84, -0.03, 0.15],
            [-0.2, 2.16, -0.1, 0.12],
            [0.22, 2.17, -0.1, 0.13],
          ].map(([x, y, z, size], index) => (
            <mesh key={`treant-crown-${index}`} castShadow position={[x, y, z]} scale={[1, 0.8, 0.9]}>
              <dodecahedronGeometry args={[size, 0]} />
              <meshStandardMaterial color={elite ? '#466338' : '#354e32'} roughness={0.95} />
            </mesh>
          ))}
        </group>
      </group>
      <HitFlash animationProps={animationProps} radius={0.86} height={2.25} />
    </group>
  );
}

function GolemArm({ side, refs }: { side: -1 | 1; refs: LimbRefs }) {
  return (
    <group ref={refs.root} position={[side * 0.64, 1.38, 0]}>
      <mesh castShadow position={[0, -0.02, 0]} scale={[1.22, 0.92, 1.08]}>
        <dodecahedronGeometry args={[0.27, 0]} />
        <meshStandardMaterial color="#5d5c55" metalness={0.12} roughness={0.88} />
      </mesh>
      <mesh castShadow position={[0, -0.25, 0]} scale={[1.08, 1.2, 0.94]}>
        <dodecahedronGeometry args={[0.2, 0]} />
        <meshStandardMaterial color="#4c4d49" metalness={0.1} roughness={0.9} />
      </mesh>
      <group ref={refs.joint} position={[0, -0.46, 0]}>
        <mesh castShadow>
          <dodecahedronGeometry args={[0.13, 0]} />
          <meshStandardMaterial color="#2f3938" emissive="#3c7771" emissiveIntensity={0.34} roughness={0.58} />
        </mesh>
        <mesh castShadow position={[0, -0.21, 0]} scale={[1.08, 1.18, 0.94]}>
          <dodecahedronGeometry args={[0.2, 0]} />
          <meshStandardMaterial color="#55554f" metalness={0.1} roughness={0.9} />
        </mesh>
        <mesh castShadow position={[0, -0.43, 0.02]} scale={[1.28, 0.9, 1.1]}>
          <dodecahedronGeometry args={[0.23, 0]} />
          <meshStandardMaterial color="#41433f" roughness={0.92} />
        </mesh>
      </group>
    </group>
  );
}

function GolemLeg({ side, refs }: { side: -1 | 1; refs: LimbRefs }) {
  return (
    <group ref={refs.root} position={[side * 0.27, 0.78, 0]}>
      <mesh castShadow position={[0, -0.19, 0]} scale={[1.02, 1.18, 0.94]}>
        <dodecahedronGeometry args={[0.21, 0]} />
        <meshStandardMaterial color="#555650" roughness={0.9} />
      </mesh>
      <group ref={refs.joint} position={[0, -0.4, 0]}>
        <mesh castShadow>
          <dodecahedronGeometry args={[0.125, 0]} />
          <meshStandardMaterial color="#30413f" emissive="#4a7771" emissiveIntensity={0.26} roughness={0.62} />
        </mesh>
        <mesh castShadow position={[0, -0.18, 0]} scale={[0.96, 1.12, 0.9]}>
          <dodecahedronGeometry args={[0.19, 0]} />
          <meshStandardMaterial color="#494b47" roughness={0.92} />
        </mesh>
        <mesh castShadow position={[0, -0.36, 0.11]} scale={[1.18, 0.7, 1.48]}>
          <dodecahedronGeometry args={[0.21, 0]} />
          <meshStandardMaterial color="#3e403d" roughness={0.94} />
        </mesh>
      </group>
    </group>
  );
}

function GolemActor({ animationProps, elite }: { animationProps: AnimatedActorProps; elite: boolean }) {
  const rig: HumanoidRig = {
    root: useRef<THREE.Group>(null),
    torso: useRef<THREE.Group>(null),
    head: useRef<THREE.Group>(null),
    leftArm: { root: useRef<THREE.Group>(null), joint: useRef<THREE.Group>(null) },
    rightArm: { root: useRef<THREE.Group>(null), joint: useRef<THREE.Group>(null) },
    leftLeg: { root: useRef<THREE.Group>(null), joint: useRef<THREE.Group>(null) },
    rightLeg: { root: useRef<THREE.Group>(null), joint: useRef<THREE.Group>(null) },
  };
  useFrame(() => poseHumanoid(
    rig,
    actorClock(animationProps),
    animationProps.animation,
    animationProps.unitId,
    animationProps.attackKind,
  ));

  return (
    <group rotation={[0, actorYaw(animationProps.direction), 0]} scale={0.98}>
      <group ref={rig.root}>
        <GolemLeg side={-1} refs={rig.leftLeg} />
        <GolemLeg side={1} refs={rig.rightLeg} />
        <group ref={rig.torso}>
          <mesh castShadow position={[0, 1.2, 0]} scale={[1.55, 1.08, 0.82]}>
            <dodecahedronGeometry args={[0.46, 1]} />
            <meshStandardMaterial color={elite ? '#706d60' : '#5a5a53'} metalness={0.12} roughness={0.87} />
          </mesh>
          <mesh castShadow position={[0, 0.86, 0]} scale={[1.05, 0.66, 0.76]}>
            <dodecahedronGeometry args={[0.3, 0]} />
            <meshStandardMaterial color="#464944" metalness={0.09} roughness={0.92} />
          </mesh>
          {[
            { position: [-0.48, 1.43, -0.06] as [number, number, number], size: 0.25, scale: [1.25, 0.8, 1] as [number, number, number] },
            { position: [0.52, 1.36, 0.03] as [number, number, number], size: 0.3, scale: [1.15, 0.9, 1.08] as [number, number, number] },
            { position: [-0.27, 1.57, -0.12] as [number, number, number], size: 0.18, scale: [1, 0.82, 0.94] as [number, number, number] },
          ].map((rock, index) => (
            <mesh key={`golem-shoulder-rock-${index}`} castShadow position={rock.position} scale={rock.scale} rotation={[0.1 * index, 0.22 * index, -0.08 * index]}>
              <dodecahedronGeometry args={[rock.size, 0]} />
              <meshStandardMaterial color={index === 1 ? '#66645a' : '#50524d'} metalness={0.08} roughness={0.92} />
            </mesh>
          ))}
          <mesh position={[0, 1.24, 0.35]}>
            <icosahedronGeometry args={[0.12, 1]} />
            <meshStandardMaterial color="#68b7ab" emissive="#5aa99f" emissiveIntensity={1.7} roughness={0.3} />
          </mesh>
          <GolemArm side={-1} refs={rig.leftArm} />
          <GolemArm side={1} refs={rig.rightArm} />
          <group ref={rig.head} position={[0.04, 1.7, 0.02]}>
            <mesh castShadow scale={[0.9, 0.82, 0.84]}>
              <dodecahedronGeometry args={[0.24, 0]} />
              <meshStandardMaterial color="#555851" metalness={0.11} roughness={0.9} />
            </mesh>
            {[-1, 1].map((side) => (
              <mesh key={`golem-eye-${side}`} position={[side * 0.085, 0.025, 0.225]} scale={[1, 0.62, 0.55]}>
                <sphereGeometry args={[0.035, 7, 5]} />
                <meshStandardMaterial color="#81d0c3" emissive="#61b6aa" emissiveIntensity={1.5} roughness={0.26} />
              </mesh>
            ))}
            <mesh castShadow position={[0, -0.13, 0.17]} scale={[1, 0.55, 0.7]}>
              <dodecahedronGeometry args={[0.16, 0]} />
              <meshStandardMaterial color="#3e413d" roughness={0.92} />
            </mesh>
          </group>
        </group>
      </group>
      <HitFlash animationProps={animationProps} radius={0.9} height={2.12} />
    </group>
  );
}

function GargoyleWing({ side, wingRef }: { side: -1 | 1; wingRef: MutableRefObject<THREE.Group | null> }) {
  return (
    <group ref={wingRef} position={[side * 0.34, 0.93, -0.2]} rotation={[0.12, 0, side * -0.38]}>
      <mesh castShadow position={[side * 0.22, 0.12, 0]} rotation={[0, 0, side * -0.58]}>
        <cylinderGeometry args={[0.05, 0.08, 0.66, 7]} />
        <meshStandardMaterial color="#4e504f" metalness={0.08} roughness={0.94} />
      </mesh>
      <mesh castShadow position={[side * 0.57, 0.18, -0.04]} rotation={[0, 0, side * -0.82]}>
        <cylinderGeometry args={[0.03, 0.055, 0.62, 7]} />
        <meshStandardMaterial color="#424544" metalness={0.08} roughness={0.94} />
      </mesh>
      {[0, 1, 2, 3].map((panel) => (
        <group key={`gargoyle-wing-panel-${panel}`}>
          <mesh
            castShadow
            position={[side * (0.2 + panel * 0.17), 0.08 - panel * 0.035, -0.04 - panel * 0.055]}
            rotation={[Math.PI / 2, 0, side * (-0.46 - panel * 0.15)]}
            scale={[1, 0.54 - panel * 0.045, 1]}
          >
            <circleGeometry args={[0.42 - panel * 0.035, 3]} />
            <meshStandardMaterial color={panel % 2 === 0 ? '#5c5e5d' : '#4c504f'} side={THREE.DoubleSide} roughness={0.98} />
          </mesh>
          {panel > 0 && (
            <mesh
              castShadow
              position={[side * (0.3 + panel * 0.16), 0.15 - panel * 0.02, -0.05 - panel * 0.05]}
              rotation={[0.02, 0, side * (-0.58 - panel * 0.14)]}
            >
              <cylinderGeometry args={[0.018, 0.035, 0.52 - panel * 0.045, 6]} />
              <meshStandardMaterial color="#3f4342" metalness={0.06} roughness={0.96} />
            </mesh>
          )}
        </group>
      ))}
      {[-0.08, 0.11].map((zOffset, index) => (
        <mesh
          key={`gargoyle-wing-claw-${zOffset}`}
          position={[side * (0.76 + index * 0.12), 0.38 - index * 0.08, zOffset]}
          rotation={[0, 0, side * -0.72]}
        >
          <coneGeometry args={[0.035, 0.18, 5]} />
          <meshStandardMaterial color="#a39e8e" roughness={0.56} />
        </mesh>
      ))}
    </group>
  );
}

function GargoyleActor({ animationProps, elite }: { animationProps: AnimatedActorProps; elite: boolean }) {
  const rig: QuadrupedRig = {
    root: useRef<THREE.Group>(null),
    head: useRef<THREE.Group>(null),
    frontLeft: { root: useRef<THREE.Group>(null), joint: useRef<THREE.Group>(null) },
    frontRight: { root: useRef<THREE.Group>(null), joint: useRef<THREE.Group>(null) },
    backLeft: { root: useRef<THREE.Group>(null), joint: useRef<THREE.Group>(null) },
    backRight: { root: useRef<THREE.Group>(null), joint: useRef<THREE.Group>(null) },
  };
  const leftWing = useRef<THREE.Group>(null);
  const rightWing = useRef<THREE.Group>(null);
  const tail = useRef<THREE.Group>(null);

  useFrame(() => {
    const clock = actorClock(animationProps);
    poseQuadruped(rig, clock, animationProps.unitId);
    const attackLift = clock.phase === 'windup'
      ? easeInOut(clock.phaseProgress) * 0.24
      : clock.phase === 'death' ? -easeInOut(clock.progress) * 0.45 : 0;
    const idleFlex = Math.sin(clock.elapsedMs / 520) * 0.035;
    if (leftWing.current) leftWing.current.rotation.z = -0.38 - idleFlex - attackLift;
    if (rightWing.current) rightWing.current.rotation.z = 0.38 + idleFlex + attackLift;
    if (tail.current) tail.current.rotation.y = Math.sin(clock.elapsedMs / 340) * 0.13;
  });

  return (
    <group rotation={[0, actorYaw(animationProps.direction), 0]} scale={0.98}>
      <group ref={rig.root}>
        <mesh castShadow position={[0, 0.72, -0.05]} scale={[0.72, 0.55, 0.88]}>
          <dodecahedronGeometry args={[0.62, 1]} />
          <meshStandardMaterial color={elite ? '#727471' : '#565a58'} metalness={0.08} roughness={0.94} />
        </mesh>
        <mesh castShadow position={[0, 0.78, 0.46]} scale={[0.72, 0.72, 0.55]}>
          <dodecahedronGeometry args={[0.48, 0]} />
          <meshStandardMaterial color="#626461" metalness={0.08} roughness={0.94} />
        </mesh>
        <group ref={rig.head} position={[0, 0.88, 0.78]}>
          <mesh castShadow scale={[0.58, 0.5, 0.64]}>
            <dodecahedronGeometry args={[0.48, 0]} />
            <meshStandardMaterial color="#656765" metalness={0.09} roughness={0.92} />
          </mesh>
          <mesh castShadow position={[0, -0.22, 0.3]} scale={[0.64, 0.3, 0.78]}>
            <dodecahedronGeometry args={[0.34, 0]} />
            <meshStandardMaterial color="#444846" roughness={0.94} />
          </mesh>
          {[-1, 1].map((side) => (
            <group key={`gargoyle-face-${side}`}>
              <mesh castShadow position={[side * 0.21, 0.23, -0.04]} rotation={[0.16, 0, side * -0.45]}>
                <coneGeometry args={[0.075, 0.42, 6]} />
                <meshStandardMaterial color="#3d4240" roughness={0.94} />
              </mesh>
              <mesh castShadow position={[side * 0.31, 0.08, -0.02]} rotation={[0.08, 0, side * -0.72]}>
                <coneGeometry args={[0.05, 0.3, 6]} />
                <meshStandardMaterial color="#4b4f4d" roughness={0.94} />
              </mesh>
              <mesh position={[side * 0.12, 0.02, 0.31]}>
                <sphereGeometry args={[0.032, 7, 5]} />
                <meshStandardMaterial color="#d8a75a" emissive="#b47a38" emissiveIntensity={1.1} roughness={0.35} />
              </mesh>
              <mesh position={[side * 0.1, -0.28, 0.42]} rotation={[Math.PI / 2.5, 0, side * 0.08]}>
                <coneGeometry args={[0.025, 0.16, 5]} />
                <meshStandardMaterial color="#c9c3af" roughness={0.52} />
              </mesh>
            </group>
          ))}
        </group>
        <GargoyleWing side={-1} wingRef={leftWing} />
        <GargoyleWing side={1} wingRef={rightWing} />
        <CreatureLeg refs={rig.frontLeft} position={[-0.34, 0.49, 0.37]} color="#4f5351" footColor="#373b3a" />
        <CreatureLeg refs={rig.frontRight} position={[0.34, 0.49, 0.37]} color="#4f5351" footColor="#373b3a" />
        <CreatureLeg refs={rig.backLeft} position={[-0.36, 0.49, -0.4]} color="#494d4b" footColor="#333736" scale={1.06} />
        <CreatureLeg refs={rig.backRight} position={[0.36, 0.49, -0.4]} color="#494d4b" footColor="#333736" scale={1.06} />
        <group ref={tail} position={[0, 0.65, -0.63]} rotation={[-Math.PI / 2.35, 0, 0]}>
          <mesh castShadow position={[0, 0.38, 0]}>
            <coneGeometry args={[0.16, 0.82, 8]} />
            <meshStandardMaterial color="#484c4a" roughness={0.94} />
          </mesh>
        </group>
      </group>
      <HitFlash animationProps={animationProps} radius={1.02} height={1.7} />
    </group>
  );
}

function impactOverride(
  impactTimes: HackSlashArena3DProps['impactTimes'],
  key: string,
  fallback: number | null | undefined,
) {
  if (!impactTimes || !(key in impactTimes)) return fallback;
  return impactTimes[key];
}

function GroundMarker({ color, radius }: { color: string; radius: number }) {
  return (
    <group position={[0, 0.03, 0]}>
      <mesh rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[radius * 0.82, radius, 36]} />
        <meshBasicMaterial color={color} transparent opacity={0.72} depthWrite={false} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[radius * 0.78, 36]} />
        <meshBasicMaterial color="#080a09" transparent opacity={0.2} depthWrite={false} />
      </mesh>
    </group>
  );
}

function BlobShadow({ radius }: { radius: number }) {
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.025, 0]} scale={[radius, radius * 0.72, 1]}>
      <circleGeometry args={[1, 20]} />
      <meshBasicMaterial color="#080a09" transparent opacity={0.2} depthWrite={false} />
    </mesh>
  );
}

function EnemyHealthBar({ enemy, height }: { enemy: Arena3DEnemy; height: number }) {
  const ratio = enemy.maxHp > 0 ? clamp(enemy.hp / enemy.maxHp, 0, 1) : 0;
  return (
    <Html center position={[0, height, 0]} zIndexRange={[20, 0]}>
      <div className={`${styles.enemyPlate} ${enemy.elite ? styles.enemyPlateElite : ''}`}>
        <span className={styles.enemyName}>{enemy.name}</span>
        <span className={styles.enemyHealthTrack}>
          <span className={styles.enemyHealthFill} style={{ width: `${ratio * 100}%` }} />
        </span>
      </div>
    </Html>
  );
}

function BossAdornment({ height, radius }: { height: number; radius: number }) {
  return (
    <group>
      <group position={[0, height, 0]}>
        <mesh rotation={[Math.PI / 2, 0, 0]}>
          <torusGeometry args={[0.2, 0.025, 6, 20]} />
          <meshStandardMaterial color="#d1a54d" emissive="#8a5f22" emissiveIntensity={0.5} metalness={0.62} roughness={0.32} />
        </mesh>
        {[-1, 0, 1].map((spire) => (
          <mesh key={`boss-crown-${spire}`} position={[spire * 0.13, 0.12 + Math.abs(spire) * -0.025, 0]}>
            <coneGeometry args={[0.045, spire === 0 ? 0.28 : 0.22, 5]} />
            <meshStandardMaterial color="#d8ac52" emissive="#8a5f22" emissiveIntensity={0.45} metalness={0.58} roughness={0.34} />
          </mesh>
        ))}
      </group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.035, 0]}>
        <torusGeometry args={[radius, 0.045, 6, 32]} />
        <meshBasicMaterial color="#d2a34c" transparent opacity={0.92} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.042, 0]}>
        <ringGeometry args={[radius * 0.76, radius * 0.82, 32]} />
        <meshBasicMaterial color="#7f5423" transparent opacity={0.48} depthWrite={false} />
      </mesh>
    </group>
  );
}

function PlayerVisual({
  snapshot,
  classId,
  equippedWeapon,
  rates,
  impactTimes,
  offset,
}: {
  snapshot: HackSlashArena3DSnapshot;
  classId: CharacterClassId;
  equippedWeapon: Arena3DEquippedWeapon | null;
  rates: AnimationRates;
  impactTimes: HackSlashArena3DProps['impactTimes'];
  offset: ArenaRenderOffset;
}) {
  const animationProps: AnimatedActorProps = {
    ...snapshot.player,
    unitId: classId,
    now: snapshot.now,
    rates,
    impactAt: impactOverride(impactTimes, PLAYER_TIMING_KEY, snapshot.player.impactAt),
  };
  return (
    <SmoothArenaPosition
      x={snapshot.player.x}
      y={snapshot.player.y}
      vx={snapshot.player.vx}
      vy={snapshot.player.vy}
      sampledAt={snapshot.now}
      offset={offset}
    >
      <GroundMarker color="#d8b867" radius={0.56} />
      <HumanoidActor
        animationProps={animationProps}
        variant={classId}
        palette={HERO_PALETTE[classId]}
        scale={0.78}
        equipment={equippedWeapon}
      />
    </SmoothArenaPosition>
  );
}

function EnemyVisual({
  enemy,
  now,
  rates,
  impactTimes,
  onPoint,
  sampledAt,
  offset,
}: {
  enemy: Arena3DEnemy;
  now: number;
  rates: AnimationRates;
  impactTimes: HackSlashArena3DProps['impactTimes'];
  onPoint?: (enemyId: string) => void;
  sampledAt: number;
  offset: ArenaRenderOffset;
}) {
  const normalizedMoveSpeed = enemy.moveSpeed ?? clamp(enemy.speed / 105, 0.62, 1.85);
  const animationProps: AnimatedActorProps = {
    ...enemy,
    now,
    rates,
    moveSpeed: normalizedMoveSpeed,
    impactAt: impactOverride(impactTimes, enemy.id, enemy.impactAt ?? enemy.pendingAttackAt),
  };
  let model: ReactNode;
  let healthHeight = 1.72;

  if (enemy.unitId === 'slime') {
    model = <SlimeActor animationProps={animationProps} elite={enemy.elite} />;
    healthHeight = 1.38;
  } else if (enemy.unitId === 'boar') {
    model = <BoarActor animationProps={animationProps} elite={enemy.elite} />;
    healthHeight = 1.62;
  } else if (enemy.unitId === 'drake') {
    model = <DrakeActor animationProps={animationProps} elite={enemy.elite} />;
    healthHeight = 2.08;
  } else if (enemy.unitId === 'wolf') {
    model = <WolfActor animationProps={animationProps} elite={enemy.elite} />;
    healthHeight = 1.56;
  } else if (enemy.unitId === 'spider') {
    model = <SpiderActor animationProps={animationProps} elite={enemy.elite} />;
    healthHeight = 1.42;
  } else if (enemy.unitId === 'treant') {
    model = <TreantActor animationProps={animationProps} elite={enemy.elite} />;
    healthHeight = 2.46;
  } else if (enemy.unitId === 'gargoyle') {
    model = <GargoyleActor animationProps={animationProps} elite={enemy.elite} />;
    healthHeight = 1.92;
  } else if (enemy.unitId === 'golem') {
    model = <GolemActor animationProps={animationProps} elite={enemy.elite} />;
    healthHeight = 2.32;
  } else {
    const variant = enemy.unitId === 'sentinel' || enemy.unitId === 'demon' ? enemy.unitId : 'bandit';
    model = (
      <HumanoidActor
        animationProps={animationProps}
        variant={variant}
        palette={ENEMY_PALETTE[variant]}
        scale={variant === 'sentinel' ? 0.77 : variant === 'demon' ? 0.74 : 0.68}
        elite={enemy.elite}
      />
    );
    healthHeight = variant === 'sentinel' ? 1.78 : 1.64;
  }

  const bossScale = enemy.boss
    ? enemy.unitId === 'drake' || enemy.unitId === 'boar' ? 1.35 : 1.28
    : 1;
  const scaledHealthHeight = healthHeight * bossScale + (enemy.boss ? 0.16 : 0);

  return (
    <group
      onPointerDown={(event) => {
        event.stopPropagation();
        onPoint?.(enemy.id);
      }}
    >
      <SmoothArenaPosition
        x={enemy.x}
        y={enemy.y}
        vx={enemy.vx}
        vy={enemy.vy}
        sampledAt={sampledAt}
        offset={offset}
      >
        <BlobShadow radius={0.6 * bossScale} />
        <group scale={bossScale}>{model}</group>
        {enemy.boss && <BossAdornment height={scaledHealthHeight - 0.34} radius={0.74 * bossScale} />}
        {enemy.deadAt === null && <EnemyHealthBar enemy={enemy} height={scaledHealthHeight} />}
      </SmoothArenaPosition>
    </group>
  );
}

function arenaPointFromIntersection(point: THREE.Vector3) {
  return {
    x: point.x * ARENA_WORLD_SCALE + ARENA_WORLD_WIDTH / 2,
    y: point.z * ARENA_WORLD_SCALE + ARENA_WORLD_HEIGHT / 2,
  };
}

function InteractionPlane({
  onGroundPoint,
  onGroundHover,
  offset,
}: Pick<HackSlashArena3DProps, 'onGroundPoint' | 'onGroundHover'> & { offset: ArenaRenderOffset }) {
  const point = (event: ThreeEvent<PointerEvent>) => {
    const arenaPoint = arenaPointFromIntersection(event.point);
    return { x: arenaPoint.x - offset.x, y: arenaPoint.y - offset.y };
  };
  const [planeX, , planeZ] = arenaWorldToScene(
    ARENA_WORLD_WIDTH / 2 + offset.x,
    ARENA_WORLD_HEIGHT / 2 + offset.y,
  );
  return (
    <mesh
      position={[planeX, -0.6, planeZ]}
      rotation={[-Math.PI / 2, 0, 0]}
      onPointerDown={(event) => {
        event.stopPropagation();
        onGroundPoint?.(point(event), event.nativeEvent.pointerType);
      }}
      onPointerMove={(event) => {
        if (event.nativeEvent.pointerType !== 'touch') onGroundHover?.(point(event));
      }}
    >
      <planeGeometry args={[180, 180]} />
      <meshBasicMaterial transparent opacity={0} depthWrite={false} />
    </mesh>
  );
}

const ProjectileVisual = memo(function ProjectileVisual({
  projectile,
  now,
  sampledAt,
  offset,
}: {
  projectile: Arena3DProjectile;
  now: number;
  sampledAt: number;
  offset: ArenaRenderOffset;
}) {
  const yaw = Math.atan2(projectile.vx, projectile.vy);
  const friendly = projectile.team === 'friendly';
  const age = Math.max(0, now - projectile.startedAt);
  const pulse = 1 + Math.sin(age / 55) * 0.08;
  const radiusScale = clamp(projectile.radius / 18, 0.72, 1.45);
  const friendlyColor = projectile.kind === 'fire' ? '#ffb04d' : projectile.kind === 'arcane' ? '#65d9d3' : '#e8d5a0';
  const hostileColor = projectile.kind === 'fire' ? '#ff593b' : '#d05aeb';
  const color = friendly ? friendlyColor : hostileColor;

  if (projectile.kind === 'arrow') {
    return (
      <SmoothArenaPosition
        x={projectile.x}
        y={projectile.y}
        vx={projectile.vx}
        vy={projectile.vy}
        sampledAt={sampledAt}
        offset={offset}
        height={0.45}
      >
        <group rotation={[0, yaw, 0]} scale={radiusScale}>
          <mesh castShadow rotation={[Math.PI / 2, 0, 0]}>
            <cylinderGeometry args={[0.018, 0.018, 0.62, 6]} />
            <meshStandardMaterial color="#b39161" roughness={0.66} />
          </mesh>
          <mesh castShadow position={[0, 0, 0.35]} rotation={[Math.PI / 2, 0, 0]}>
            <coneGeometry args={[0.06, 0.16, 6]} />
            <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.55} metalness={0.5} roughness={0.28} />
          </mesh>
          <mesh position={[0, 0, -0.34]} rotation={[Math.PI / 2, 0, 0]}>
            <coneGeometry args={[0.09, 0.16, 4]} />
            <meshStandardMaterial color={friendly ? '#5d744f' : '#7f3243'} roughness={0.8} />
          </mesh>
        </group>
      </SmoothArenaPosition>
    );
  }

  if (projectile.kind === 'fire') {
    return (
      <SmoothArenaPosition
        x={projectile.x}
        y={projectile.y}
        vx={projectile.vx}
        vy={projectile.vy}
        sampledAt={sampledAt}
        offset={offset}
        height={0.48}
      >
        <group rotation={[0, yaw, 0]} scale={radiusScale * pulse}>
          <mesh castShadow>
            <icosahedronGeometry args={[0.18, 1]} />
            <meshStandardMaterial color={color} emissive={color} emissiveIntensity={3.2} roughness={0.3} />
          </mesh>
          {[0.2, 0.38, 0.54].map((offset, index) => (
            <mesh key={offset} position={[0, 0.02 + index * 0.025, -offset]} scale={1 - index * 0.2}>
              <dodecahedronGeometry args={[0.11, 0]} />
              <meshBasicMaterial color={index === 2 ? '#752d31' : color} transparent opacity={0.58 - index * 0.1} />
            </mesh>
          ))}
        </group>
      </SmoothArenaPosition>
    );
  }

  return (
    <SmoothArenaPosition
      x={projectile.x}
      y={projectile.y}
      vx={projectile.vx}
      vy={projectile.vy}
      sampledAt={sampledAt}
      offset={offset}
      height={0.5}
    >
      <group rotation={[0, yaw, 0]} scale={radiusScale * pulse}>
        <mesh castShadow>
          <octahedronGeometry args={[0.18, 1]} />
          <meshStandardMaterial color={color} emissive={color} emissiveIntensity={2.8} roughness={0.24} />
        </mesh>
        <mesh rotation={[-Math.PI / 2, 0, 0]}>
          <torusGeometry args={[0.25, 0.018, 5, 20]} />
          <meshBasicMaterial color={color} transparent opacity={0.72} />
        </mesh>
        {[0.27, 0.46].map((offset, index) => (
          <mesh key={offset} position={[0, 0, -offset]} scale={1 - index * 0.28}>
            <sphereGeometry args={[0.09, 8, 6]} />
            <meshBasicMaterial color={color} transparent opacity={0.42 - index * 0.12} />
          </mesh>
        ))}
      </group>
    </SmoothArenaPosition>
  );
});

function SlashEffect({ effect, radius, opacity }: { effect: Arena3DEffect; radius: number; opacity: number }) {
  const color = effect.source === 'enemy' ? '#e45b47' : '#efcf79';
  return (
    <group rotation={[0, Math.PI / 2 - effect.angle, 0]}>
      <mesh rotation={[-Math.PI / 2, 0, 0]}>
        <torusGeometry args={[radius * 0.68, 0.055, 6, 28, Math.PI * 1.15]} />
        <meshBasicMaterial color={color} transparent opacity={opacity} depthWrite={false} />
      </mesh>
      <mesh position={[0, 0.04, radius * 0.26]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[radius * 0.25, radius * 0.31, 24, 1, 0, Math.PI * 1.2]} />
        <meshBasicMaterial color="#fff0b7" transparent opacity={opacity * 0.5} side={THREE.DoubleSide} depthWrite={false} />
      </mesh>
    </group>
  );
}

function NovaEffect({ color, radius, opacity, progress }: { color: string; radius: number; opacity: number; progress: number }) {
  return (
    <group>
      {[0.45, 0.72, 1].map((factor, index) => {
        const ringScale = Math.max(0.001, radius * factor * easeOut(progress));
        return (
        <mesh key={factor} rotation={[-Math.PI / 2, 0, 0]} position={[0, index * 0.025, 0]} scale={[ringScale, ringScale, 1]}>
          <torusGeometry args={[1, 0.035 - index * 0.006, 6, 34]} />
          <meshBasicMaterial color={color} transparent opacity={opacity * (1 - index * 0.18)} depthWrite={false} />
        </mesh>
        );
      })}
      <mesh position={[0, 0.12 + progress * 0.22, 0]} scale={radius * 0.18 * (0.4 + progress * 0.8)}>
        <octahedronGeometry args={[1, 1]} />
        <meshBasicMaterial color={color} wireframe transparent opacity={opacity * 0.45} depthWrite={false} />
      </mesh>
    </group>
  );
}

function EffectVisual({ effect, now, offset }: { effect: Arena3DEffect; now: number; offset: ArenaRenderOffset }) {
  const [x, , z] = renderPosition(effect.x, effect.y, offset);
  const duration = Math.max(1, effect.expiresAt - effect.startedAt);
  const progress = clamp((now - effect.startedAt) / duration, 0, 1);
  const opacity = 1 - easeInOut(progress);
  const radius = clamp(effect.size / ARENA_WORLD_SCALE / 2, 0.28, 1.8);
  const sourceColor = effect.source === 'enemy' ? '#d55248' : '#64c8c0';
  let visual: ReactNode;

  if (effect.kind === 'slash') {
    visual = <SlashEffect effect={effect} radius={radius} opacity={opacity} />;
  } else if (effect.kind === 'nova') {
    visual = <NovaEffect color={sourceColor} radius={radius} opacity={opacity} progress={progress} />;
  } else if (effect.kind === 'impact') {
    const strikeFlash = 1 - easeOut(clamp(progress / 0.22, 0, 1));
    visual = (
      <group>
        <mesh rotation={[-Math.PI / 2, 0, 0]} scale={Math.max(0.001, radius * progress)}>
          <ringGeometry args={[0.7, 1, 28]} />
          <meshBasicMaterial color="#ff8b55" transparent opacity={opacity * 0.82} depthWrite={false} />
        </mesh>
        {[0, 1, 2, 3, 4, 5].map((index) => {
          const angle = (index / 6) * Math.PI * 2;
          return (
            <mesh key={index} position={[Math.cos(angle) * radius * progress * 0.7, 0.08 + progress * 0.3, Math.sin(angle) * radius * progress * 0.7]}>
              <tetrahedronGeometry args={[0.055, 0]} />
              <meshBasicMaterial color="#f5c477" transparent opacity={opacity} />
            </mesh>
          );
        })}
        <mesh position={[0, 0.2, 0]} scale={0.16 + strikeFlash * 0.32}>
          <icosahedronGeometry args={[1, 1]} />
          <meshBasicMaterial
            color="#fff1c7"
            transparent
            opacity={strikeFlash * 0.68}
            blending={THREE.AdditiveBlending}
            depthWrite={false}
            toneMapped={false}
          />
        </mesh>
      </group>
    );
  } else if (effect.kind === 'heal') {
    visual = (
      <group>
        <NovaEffect color="#65d894" radius={radius} opacity={opacity} progress={progress} />
        <mesh position={[0, 0.35 + progress * 0.5, 0]}>
          <boxGeometry args={[0.12, 0.48, 0.12]} />
          <meshBasicMaterial color="#a6f3b5" transparent opacity={opacity} />
        </mesh>
        <mesh position={[0, 0.35 + progress * 0.5, 0]}>
          <boxGeometry args={[0.38, 0.12, 0.12]} />
          <meshBasicMaterial color="#a6f3b5" transparent opacity={opacity} />
        </mesh>
      </group>
    );
  } else if (effect.kind === 'loot') {
    visual = (
      <group position={[0, 0.25 + Math.sin(progress * Math.PI) * 0.28, 0]} rotation={[0, progress * Math.PI * 2, 0]}>
        <mesh scale={radius * 0.26}>
          <octahedronGeometry args={[1, 0]} />
          <meshStandardMaterial color="#f0bd57" emissive="#f0bd57" emissiveIntensity={2} roughness={0.25} />
        </mesh>
        <mesh rotation={[-Math.PI / 2, 0, 0]} scale={radius * (0.28 + progress * 0.16)}>
          <torusGeometry args={[1, 0.06, 6, 20]} />
          <meshBasicMaterial
            color="#f0bd57"
            transparent
            opacity={opacity * 0.48}
            blending={THREE.AdditiveBlending}
            depthWrite={false}
            toneMapped={false}
          />
        </mesh>
      </group>
    );
  } else {
    visual = (
      <group rotation={[0, Math.PI / 2 - effect.angle, 0]}>
        <mesh position={[0, 0.2, radius * progress]} rotation={[Math.PI / 2, 0, 0]}>
          <coneGeometry args={[0.09, 0.38, 6]} />
          <meshBasicMaterial color={sourceColor} transparent opacity={opacity} />
        </mesh>
      </group>
    );
  }

  return <group position={[x, 0.08, z]}>{visual}</group>;
}

function AimMarker({ x, y, offset }: { x: number; y: number; offset: ArenaRenderOffset }) {
  const [sceneX, , sceneZ] = renderPosition(x, y, offset);
  return (
    <group position={[sceneX, 0.045, sceneZ]}>
      <mesh rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.14, 0.2, 20]} />
        <meshBasicMaterial color="#d9d3bd" transparent opacity={0.58} depthWrite={false} />
      </mesh>
      {[0, Math.PI / 2].map((rotation) => (
        <mesh key={rotation} rotation={[-Math.PI / 2, 0, rotation]}>
          <planeGeometry args={[0.5, 0.018]} />
          <meshBasicMaterial color="#d9d3bd" transparent opacity={0.42} depthWrite={false} />
        </mesh>
      ))}
    </group>
  );
}

function ArenaScene({
  snapshot,
  classId,
  equippedWeapon,
  rates,
  impactTimes,
  worldScene,
  onGroundPoint,
  onGroundHover,
  onEnemyPoint,
}: {
  snapshot: HackSlashArena3DSnapshot;
  classId: CharacterClassId;
  equippedWeapon: Arena3DEquippedWeapon | null;
  rates: AnimationRates;
  impactTimes: HackSlashArena3DProps['impactTimes'];
  worldScene: HackSlashArena3DProps['worldScene'];
  onGroundPoint: HackSlashArena3DProps['onGroundPoint'];
  onGroundHover: HackSlashArena3DProps['onGroundHover'];
  onEnemyPoint: HackSlashArena3DProps['onEnemyPoint'];
}) {
  const renderOffset = useMemo<ArenaRenderOffset>(() => ({
    x: worldScene?.arenaOffsetX ?? 0,
    y: worldScene?.arenaOffsetY ?? 0,
  }), [worldScene?.arenaOffsetX, worldScene?.arenaOffsetY]);

  return (
    <>
      <color attach="background" args={['#0d100f']} />
      <fog attach="fog" args={['#0d100f', 13, 25]} />
      <ambientLight intensity={0.82} color="#b5baad" />
      <hemisphereLight args={['#a9b6ac', '#1c1916', 1.26]} />
      <ArenaLighting
        playerX={snapshot.player.x}
        playerY={snapshot.player.y}
        playerVx={snapshot.player.vx}
        playerVy={snapshot.player.vy}
        sampledAt={snapshot.now}
        offset={renderOffset}
      />
      {worldScene
        ? <AdventureWorldLayer3D chunks={worldScene.chunks} projection={worldScene.projection} />
        : <StoneFloor />}
      <AimMarker x={snapshot.aimX} y={snapshot.aimY} offset={renderOffset} />
      <PlayerVisual
        snapshot={snapshot}
        classId={classId}
        equippedWeapon={equippedWeapon}
        rates={rates}
        impactTimes={impactTimes}
        offset={renderOffset}
      />
      {snapshot.enemies.map((enemy) => (
        <EnemyVisual
          key={enemy.id}
          enemy={enemy}
          now={snapshot.now}
          sampledAt={snapshot.now}
          rates={rates}
          impactTimes={impactTimes}
          onPoint={onEnemyPoint}
          offset={renderOffset}
        />
      ))}
      {snapshot.projectiles.map((projectile) => (
        <ProjectileVisual
          key={projectile.id}
          projectile={projectile}
          now={snapshot.now}
          sampledAt={snapshot.now}
          offset={renderOffset}
        />
      ))}
      {snapshot.effects.map((effect) => (
        <EffectVisual key={effect.id} effect={effect} now={snapshot.now} offset={renderOffset} />
      ))}
      <ArenaCamera
        playerX={snapshot.player.x}
        playerY={snapshot.player.y}
        playerVx={snapshot.player.vx}
        playerVy={snapshot.player.vy}
        sampledAt={snapshot.now}
        offset={renderOffset}
      />
      <InteractionPlane onGroundPoint={onGroundPoint} onGroundHover={onGroundHover} offset={renderOffset} />
    </>
  );
}

export default function HackSlashArena3D({
  snapshot,
  classId,
  equippedWeapon = null,
  attackSpeed = 1,
  moveSpeed = 1,
  castSpeed = 1,
  impactTimes,
  worldScene,
  onGroundPoint,
  onGroundHover,
  onEnemyPoint,
  className,
}: HackSlashArena3DProps) {
  const rates = useMemo<AnimationRates>(() => ({
    attackSpeed: Math.max(0.1, attackSpeed),
    moveSpeed: Math.max(0.1, moveSpeed),
    castSpeed: Math.max(0.1, castSpeed),
  }), [attackSpeed, castSpeed, moveSpeed]);

  return (
    <div
      className={`${styles.scene}${className ? ` ${className}` : ''}`}
      data-testid="hackslash-arena-3d"
      data-world-chunk={worldScene?.centerChunkId}
      data-player-x={Math.round(snapshot.player.x)}
      data-player-y={Math.round(snapshot.player.y)}
      aria-hidden="true"
    >
      <Canvas
        orthographic
        shadows="percentage"
        dpr={[1, 1.25]}
        camera={{ position: [8.4, 10.8, 8.4], near: 0.1, far: 120, zoom: 48 }}
        className={styles.canvas}
        gl={{ antialias: true, alpha: false, powerPreference: 'high-performance' }}
        onCreated={({ gl }) => {
          gl.outputColorSpace = THREE.SRGBColorSpace;
          gl.toneMapping = THREE.ACESFilmicToneMapping;
          gl.toneMappingExposure = 1.32;
          gl.shadowMap.type = THREE.PCFShadowMap;
        }}
      >
        <ArenaScene
          snapshot={snapshot}
          classId={classId}
          equippedWeapon={equippedWeapon}
          rates={rates}
          impactTimes={impactTimes}
          worldScene={worldScene}
          onGroundPoint={onGroundPoint}
          onGroundHover={onGroundHover}
          onEnemyPoint={onEnemyPoint}
        />
      </Canvas>
    </div>
  );
}

export {
  ARENA_WORLD_HEIGHT,
  ARENA_WORLD_SCALE,
  ARENA_WORLD_WIDTH,
  PLAYER_TIMING_KEY as ARENA_3D_PLAYER_TIMING_KEY,
  arenaWorldToScene,
  resolveArena3DAnimationClock,
};
export type {
  Arena3DAnimationClock,
  Arena3DEquippedWeapon,
  HackSlashArena3DSnapshot,
};
