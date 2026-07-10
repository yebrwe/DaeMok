'use client';

// 던전 RPG 3D 씬 - 방/복도 타일 던전, 시야(전장의 안개), 카메라 추적, 범프 전투 연출
import React, { useMemo, useRef, useState } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { Cell, Monster, TILE_STAIRS, TILE_WALL, ActTheme, MAP_H, MAP_W } from '@/lib/dungeon';

const TILE = 1;
const WALL_H = 1.1;

export interface DungeonFx {
  key: number;
  type: 'hit' | 'playerHit' | 'death' | 'levelup' | 'pickup' | 'stairs' | 'bomb';
  at: Cell;
}

const toWorld = (c: Cell): [number, number, number] => [c.x * TILE, 0, c.y * TILE];
const cellKey = (c: Cell) => `${c.x},${c.y}`;

// ===== 카메라 추적 =====
function FollowCamera({ target }: { target: Cell }) {
  const goal = useMemo(() => new THREE.Vector3(), []);
  useFrame((state, delta) => {
    const [x, , z] = toWorld(target);
    goal.set(x, 8.4, z + 6.6);
    const t = 1 - Math.pow(0.001, delta);
    state.camera.position.lerp(goal, t);
    state.camera.lookAt(x, 0, z - 0.6);
  });
  return null;
}

// ===== 플레이어 캐릭터 (눈 달린 파란 말 - 호핑 이동) =====
function Hero({ pos, hurtKey }: { pos: Cell; hurtKey: number }) {
  const outerRef = useRef<THREE.Group>(null);
  const innerRef = useRef<THREE.Group>(null);
  const yawRef = useRef(0);
  const lastHurtRef = useRef(0);
  const hurtUntilRef = useRef(0);
  const target = useMemo(() => {
    const [x, , z] = toWorld(pos);
    return new THREE.Vector3(x, 0, z);
  }, [pos]);
  const initRef = useRef<[number, number, number] | null>(null);
  if (initRef.current === null) initRef.current = [target.x, 0, target.z];

  useFrame((state, delta) => {
    const outer = outerRef.current;
    const inner = innerRef.current;
    if (!outer || !inner) return;
    const now = state.clock.elapsedTime;

    if (hurtKey !== lastHurtRef.current) {
      lastHurtRef.current = hurtKey;
      hurtUntilRef.current = now + 0.45;
    }

    const dist = outer.position.distanceTo(target);
    if (dist > TILE * 3.5) outer.position.copy(target);
    else outer.position.lerp(target, 1 - Math.pow(0.0003, delta));

    const dx = target.x - outer.position.x;
    const dz = target.z - outer.position.z;
    if (Math.abs(dx) + Math.abs(dz) > 0.02) yawRef.current = Math.atan2(dx, dz);
    inner.rotation.y += (yawRef.current - inner.rotation.y) * Math.min(1, delta * 10);

    const hop = Math.sin(Math.min(dist / TILE, 1) * Math.PI) * 0.3;
    const idle = dist < 0.02 ? Math.abs(Math.sin(now * 2.2)) * 0.03 : 0;
    let jx = 0;
    let jz = 0;
    if (now < hurtUntilRef.current) {
      const k = (hurtUntilRef.current - now) / 0.45;
      jx = Math.sin(now * 55) * 0.07 * k;
      jz = Math.cos(now * 43) * 0.06 * k;
    }
    inner.position.set(jx, hop + idle, jz);
  });

  return (
    <group ref={outerRef} position={initRef.current}>
      <group ref={innerRef}>
        <mesh position={[0, 0.3, 0]} castShadow>
          <cylinderGeometry args={[0.13, 0.22, 0.4, 20]} />
          <meshStandardMaterial color="#3b82f6" roughness={0.35} />
        </mesh>
        <mesh position={[0, 0.58, 0]} castShadow>
          <sphereGeometry args={[0.16, 20, 20]} />
          <meshStandardMaterial color="#3b82f6" roughness={0.3} />
        </mesh>
        <mesh position={[0.055, 0.62, 0.12]}>
          <sphereGeometry args={[0.04, 10, 10]} />
          <meshStandardMaterial color="#ffffff" />
        </mesh>
        <mesh position={[-0.055, 0.62, 0.12]}>
          <sphereGeometry args={[0.04, 10, 10]} />
          <meshStandardMaterial color="#ffffff" />
        </mesh>
        <mesh position={[0.055, 0.62, 0.152]}>
          <sphereGeometry args={[0.018, 8, 8]} />
          <meshStandardMaterial color="#1e293b" />
        </mesh>
        <mesh position={[-0.055, 0.62, 0.152]}>
          <sphereGeometry args={[0.018, 8, 8]} />
          <meshStandardMaterial color="#1e293b" />
        </mesh>
      </group>
      {/* 횃불 조명 */}
      <pointLight position={[0, 1.7, 0]} intensity={20} distance={9} decay={1.85} color="#ffd9a0" />
    </group>
  );
}

// ===== 몬스터 (색 블롭 + 눈 + HP바, 보스는 크게) =====
function MonsterBlob({ monster, hitKey }: { monster: Monster; hitKey: number }) {
  const outerRef = useRef<THREE.Group>(null);
  const innerRef = useRef<THREE.Group>(null);
  const matRef = useRef<THREE.MeshStandardMaterial>(null);
  const headMatRef = useRef<THREE.MeshStandardMaterial>(null);
  const lastHitRef = useRef(0);
  const flashUntilRef = useRef(0);
  const target = useMemo(() => {
    const [x, , z] = toWorld(monster.pos);
    return new THREE.Vector3(x, 0, z);
  }, [monster.pos]);
  const initRef = useRef<[number, number, number] | null>(null);
  if (initRef.current === null) initRef.current = [target.x, 0, target.z];

  const scale = monster.boss ? 1.8 : 1;
  const hpRatio = Math.max(0, monster.hp / monster.maxHp);

  useFrame((state, delta) => {
    const outer = outerRef.current;
    const inner = innerRef.current;
    if (!outer || !inner) return;
    const now = state.clock.elapsedTime;

    if (hitKey !== lastHitRef.current) {
      lastHitRef.current = hitKey;
      flashUntilRef.current = now + 0.3;
    }

    const dist = outer.position.distanceTo(target);
    if (dist > TILE * 3.5) outer.position.copy(target);
    else outer.position.lerp(target, 1 - Math.pow(0.0008, delta));

    const hop = Math.sin(Math.min(dist / TILE, 1) * Math.PI) * 0.22;
    inner.position.y = hop + Math.abs(Math.sin(now * 3 + monster.id)) * 0.05;

    const flash = now < flashUntilRef.current ? 1.2 : 0.12;
    if (matRef.current) matRef.current.emissiveIntensity = flash;
    if (headMatRef.current) headMatRef.current.emissiveIntensity = flash;
  });

  return (
    <group ref={outerRef} position={initRef.current}>
      <group ref={innerRef} scale={scale}>
        <mesh position={[0, 0.26, 0]} castShadow>
          <sphereGeometry args={[0.24, 18, 18]} />
          <meshStandardMaterial ref={matRef} color={monster.color} emissive="#ff4444" emissiveIntensity={0.12} roughness={0.5} />
        </mesh>
        <mesh position={[0, 0.5, 0]} castShadow>
          <sphereGeometry args={[0.15, 16, 16]} />
          <meshStandardMaterial ref={headMatRef} color={monster.color} emissive="#ff4444" emissiveIntensity={0.12} roughness={0.45} />
        </mesh>
        {/* 성난 눈 */}
        <mesh position={[0.05, 0.54, 0.12]}>
          <sphereGeometry args={[0.035, 8, 8]} />
          <meshStandardMaterial color="#fef2f2" />
        </mesh>
        <mesh position={[-0.05, 0.54, 0.12]}>
          <sphereGeometry args={[0.035, 8, 8]} />
          <meshStandardMaterial color="#fef2f2" />
        </mesh>
        <mesh position={[0.05, 0.54, 0.148]}>
          <sphereGeometry args={[0.016, 8, 8]} />
          <meshStandardMaterial color="#7f1d1d" />
        </mesh>
        <mesh position={[-0.05, 0.54, 0.148]}>
          <sphereGeometry args={[0.016, 8, 8]} />
          <meshStandardMaterial color="#7f1d1d" />
        </mesh>
        {/* HP 바 */}
        <group position={[0, 0.82, 0]}>
          <mesh>
            <boxGeometry args={[0.5, 0.055, 0.02]} />
            <meshBasicMaterial color="#111827" />
          </mesh>
          <mesh position={[-0.25 * (1 - hpRatio), 0, 0.012]}>
            <boxGeometry args={[Math.max(0.02, 0.5 * hpRatio), 0.04, 0.02]} />
            <meshBasicMaterial color={hpRatio > 0.5 ? '#22c55e' : hpRatio > 0.25 ? '#eab308' : '#ef4444'} />
          </mesh>
        </group>
      </group>
    </group>
  );
}

// ===== 오브젝트 =====
function Chest({ pos }: { pos: Cell }) {
  const ref = useRef<THREE.Group>(null);
  useFrame((state) => {
    if (ref.current) ref.current.position.y = Math.abs(Math.sin(state.clock.elapsedTime * 1.8)) * 0.05;
  });
  const [x, , z] = toWorld(pos);
  return (
    <group position={[x, 0.02, z]}>
      <group ref={ref}>
        <mesh position={[0, 0.14, 0]} castShadow>
          <boxGeometry args={[0.42, 0.26, 0.3]} />
          <meshStandardMaterial color="#92400e" roughness={0.6} />
        </mesh>
        <mesh position={[0, 0.3, 0]} castShadow>
          <boxGeometry args={[0.44, 0.1, 0.32]} />
          <meshStandardMaterial color="#b45309" roughness={0.55} />
        </mesh>
        <mesh position={[0, 0.2, 0.16]}>
          <boxGeometry args={[0.08, 0.12, 0.03]} />
          <meshStandardMaterial color="#fbbf24" emissive="#fbbf24" emissiveIntensity={0.5} />
        </mesh>
      </group>
    </group>
  );
}

function GoldPile({ pos }: { pos: Cell }) {
  const [x, , z] = toWorld(pos);
  return (
    <group position={[x, 0.05, z]}>
      {[[-0.08, 0], [0.09, 0.04], [0, -0.09]].map(([ox, oz], i) => (
        <mesh key={i} position={[ox, 0.02 + i * 0.015, oz]} rotation={[-Math.PI / 2, 0, i]}>
          <cylinderGeometry args={[0.07, 0.07, 0.03, 12]} />
          <meshStandardMaterial color="#fbbf24" emissive="#f59e0b" emissiveIntensity={0.4} metalness={0.6} roughness={0.3} />
        </mesh>
      ))}
    </group>
  );
}

function Stairs({ pos, locked }: { pos: Cell; locked: boolean }) {
  const matRef = useRef<THREE.MeshStandardMaterial>(null);
  useFrame((state) => {
    if (matRef.current) {
      matRef.current.emissiveIntensity = locked ? 0.05 : 0.4 + Math.abs(Math.sin(state.clock.elapsedTime * 2)) * 0.5;
    }
  });
  const [x, , z] = toWorld(pos);
  return (
    <group position={[x, 0, z]}>
      <mesh position={[0, 0.03, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.22, 0.4, 24]} />
        <meshStandardMaterial ref={matRef} color={locked ? '#475569' : '#38bdf8'} emissive={locked ? '#475569' : '#38bdf8'} emissiveIntensity={0.3} side={THREE.DoubleSide} />
      </mesh>
      <mesh position={[0, 0.02, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[0.24, 24]} />
        <meshBasicMaterial color="#020617" />
      </mesh>
    </group>
  );
}

// ===== 이펙트 =====
const BURSTS: Array<[number, number, number]> = [
  [0.9, 1.6, 0.2], [-0.7, 1.9, 0.5], [0.3, 1.4, -0.9], [-0.4, 2.1, -0.5],
  [1.1, 1.2, -0.3], [-1.0, 1.5, -0.1], [0.1, 2.3, 0.8], [0.6, 1.1, 1.0],
];

function BurstFx({ at, color, count = 6, life = 0.55, up = 1 }: { at: Cell; color: string; count?: number; life?: number; up?: number }) {
  const refs = useRef<Array<THREE.Mesh | null>>([]);
  const startRef = useRef<number | null>(null);
  const [done, setDone] = useState(false);
  useFrame((state, delta) => {
    if (startRef.current === null) startRef.current = state.clock.elapsedTime;
    const t = state.clock.elapsedTime - startRef.current;
    if (t > life) {
      if (!done) setDone(true);
      return;
    }
    refs.current.forEach((m, i) => {
      if (!m) return;
      const d = BURSTS[i % BURSTS.length];
      m.position.x += d[0] * delta * 1.4;
      m.position.z += d[2] * delta * 1.4;
      m.position.y = Math.max(0.05, 0.3 + d[1] * up * t - 4 * t * t);
      m.scale.setScalar(Math.max(0.01, 1 - t / life));
    });
  });
  if (done) return null;
  const [x, , z] = toWorld(at);
  return (
    <group position={[x, 0.2, z]}>
      {Array.from({ length: count }).map((_, i) => (
        <mesh key={i} ref={(el) => { refs.current[i] = el; }} position={[0, 0.2, 0]}>
          <sphereGeometry args={[0.055, 8, 8]} />
          <meshStandardMaterial color={color} emissive={color} emissiveIntensity={2} />
        </mesh>
      ))}
    </group>
  );
}

function RingFx({ at, color, life = 0.8, maxR = 1.6 }: { at: Cell; color: string; life?: number; maxR?: number }) {
  const ref = useRef<THREE.Mesh>(null);
  const matRef = useRef<THREE.MeshStandardMaterial>(null);
  const startRef = useRef<number | null>(null);
  const [done, setDone] = useState(false);
  useFrame((state) => {
    if (startRef.current === null) startRef.current = state.clock.elapsedTime;
    const t = state.clock.elapsedTime - startRef.current;
    if (t > life) {
      if (!done) setDone(true);
      return;
    }
    const p = t / life;
    if (ref.current && matRef.current) {
      ref.current.scale.setScalar(0.2 + p * maxR);
      matRef.current.opacity = Math.max(0, 0.9 * (1 - p));
    }
  });
  if (done) return null;
  const [x, , z] = toWorld(at);
  return (
    <mesh ref={ref} position={[x, 0.12, z]} rotation={[-Math.PI / 2, 0, 0]}>
      <torusGeometry args={[1, 0.05, 10, 40]} />
      <meshStandardMaterial ref={matRef} color={color} emissive={color} emissiveIntensity={1.5} transparent opacity={0.9} />
    </mesh>
  );
}

function FxLayer({ fx }: { fx: DungeonFx | null }) {
  if (!fx) return null;
  switch (fx.type) {
    case 'hit':
      return <BurstFx key={fx.key} at={fx.at} color="#fbbf24" />;
    case 'playerHit':
      return <BurstFx key={fx.key} at={fx.at} color="#ef4444" />;
    case 'death':
      return <BurstFx key={fx.key} at={fx.at} color="#a3a3a3" count={8} life={0.7} />;
    case 'levelup':
      return <RingFx key={fx.key} at={fx.at} color="#facc15" life={1.0} maxR={1.8} />;
    case 'pickup':
      return <BurstFx key={fx.key} at={fx.at} color="#34d399" count={5} life={0.5} up={1.3} />;
    case 'stairs':
      return <RingFx key={fx.key} at={fx.at} color="#38bdf8" life={0.9} maxR={2.2} />;
    case 'bomb':
      return <BurstFx key={fx.key} at={fx.at} color="#f97316" count={8} life={0.8} />;
    default:
      return null;
  }
}

// ===== 씬 본체 =====
export interface DungeonSceneProps {
  grid: number[][];
  explored: boolean[][];
  visibleSet: Set<string>;
  player: Cell;
  playerHurtKey: number;
  monsters: Monster[];
  monsterHitKey: Record<number, number>;
  chests: Cell[];
  golds: Cell[];
  stairs: Cell;
  stairsLocked: boolean;
  theme: ActTheme;
  fx: DungeonFx | null;
  revealAll?: boolean;
}

function SceneContents(props: DungeonSceneProps) {
  const { grid, explored, visibleSet, player, monsters, chests, golds, stairs, stairsLocked, theme, fx, revealAll, playerHurtKey, monsterHitKey } = props;

  // 탐험했지만 시야 밖인 타일: 테마색을 어둡게 (완전 검정이면 지형이 안 읽힘)
  const dimColors = useMemo(() => {
    const dim = (hex: string, k: number) => '#' + new THREE.Color(hex).multiplyScalar(k).getHexString();
    return {
      floorA: dim(theme.floorA, 0.38),
      floorB: dim(theme.floorB, 0.38),
      wall: dim(theme.wall, 0.5),
    };
  }, [theme]);

  // 탐험한 바닥/벽 타일 (전장의 안개: 미탐험 = 검정, 탐험+비가시 = 어둑)
  const tiles = useMemo(() => {
    const floors: Array<{ c: Cell; stairs: boolean }> = [];
    const walls: Cell[] = [];
    for (let y = 0; y < MAP_H; y++) {
      for (let x = 0; x < MAP_W; x++) {
        const c = { x, y };
        const isExplored = revealAll || explored[y][x];
        if (!isExplored) continue;
        if (grid[y][x] === TILE_WALL) continue;
        floors.push({ c, stairs: grid[y][x] === TILE_STAIRS });
        // 인접 벽 노출
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, 1], [1, -1], [-1, -1]]) {
          const wx = x + dx;
          const wy = y + dy;
          if (wy < 0 || wy >= MAP_H || wx < 0 || wx >= MAP_W) continue;
          if (grid[wy][wx] === TILE_WALL) walls.push({ x: wx, y: wy });
        }
      }
    }
    const wallKeys = new Set<string>();
    const uniqueWalls = walls.filter((w) => {
      const k = cellKey(w);
      if (wallKeys.has(k)) return false;
      wallKeys.add(k);
      return true;
    });
    return { floors, walls: uniqueWalls };
  }, [grid, explored, revealAll]);

  const isVisible = (c: Cell) => revealAll || visibleSet.has(cellKey(c));

  return (
    <group>
      {/* 바닥 */}
      {tiles.floors.map(({ c }) => {
        const vis = isVisible(c);
        const checker = (c.x + c.y) % 2 === 0;
        const base = checker ? theme.floorA : theme.floorB;
        return (
          <mesh key={`f-${cellKey(c)}`} position={[c.x, -0.05, c.y]} receiveShadow>
            <boxGeometry args={[TILE, 0.1, TILE]} />
            <meshStandardMaterial color={vis ? base : checker ? dimColors.floorA : dimColors.floorB} roughness={0.9} />
          </mesh>
        );
      })}

      {/* 벽 */}
      {tiles.walls.map((c) => {
        const vis = isVisible(c);
        return (
          <mesh key={`w-${cellKey(c)}`} position={[c.x, WALL_H / 2 - 0.05, c.y]} castShadow>
            <boxGeometry args={[TILE, WALL_H, TILE]} />
            <meshStandardMaterial color={vis ? theme.wall : dimColors.wall} roughness={0.85} />
          </mesh>
        );
      })}

      {/* 계단 */}
      {(revealAll || explored[stairs.y][stairs.x]) && <Stairs pos={stairs} locked={stairsLocked} />}

      {/* 상자 / 금화 (시야 안일 때만) */}
      {chests.filter(isVisible).map((c) => (
        <Chest key={`c-${cellKey(c)}`} pos={c} />
      ))}
      {golds.filter(isVisible).map((c) => (
        <GoldPile key={`g-${cellKey(c)}`} pos={c} />
      ))}

      {/* 몬스터 (시야 안일 때만) */}
      {monsters
        .filter((m) => m.hp > 0 && isVisible(m.pos))
        .map((m) => (
          <MonsterBlob key={m.id} monster={m} hitKey={monsterHitKey[m.id] ?? 0} />
        ))}

      {/* 플레이어 */}
      <Hero pos={player} hurtKey={playerHurtKey} />

      {/* 이펙트 */}
      <FxLayer fx={fx} />

      <FollowCamera target={player} />
    </group>
  );
}

const DungeonScene: React.FC<DungeonSceneProps> = (props) => {
  return (
    <div className={`absolute inset-0 bg-gradient-to-b ${props.theme.sky}`}>
      <Canvas shadows dpr={[1, 1.75]} camera={{ position: [props.player.x, 8.4, props.player.y + 6.6], fov: 52 }}>
        <ambientLight intensity={0.42} />
        <hemisphereLight args={['#cbd5e1', props.theme.fog, 0.42]} />
        <fog attach="fog" args={[props.theme.fog, 8, 20]} />
        <SceneContents {...props} />
      </Canvas>
    </div>
  );
};

export default DungeonScene;
