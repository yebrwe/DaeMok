'use client';

import React, { useMemo, useRef, useState, useCallback, useEffect } from 'react';
import { Canvas, useFrame, useThree, ThreeEvent } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import * as THREE from 'three';
import { CollisionWall, Direction, GamePhase, ItemType, MapItem, Obstacle, Position } from '@/types/game';
import { BOARD_SIZE, isSamePosition } from '@/lib/gameUtils';

// ===== 보드 배치 상수 =====
const TILE = 1; // 타일 한 변 크기
const GAP = 0.14; // 타일 사이 간격 (벽이 놓이는 자리)
const SPACING = TILE + GAP; // 셀 중심 간 거리
const WALL_HEIGHT = 0.5;
const WALL_THICKNESS = 0.16;
const CENTER = ((BOARD_SIZE - 1) * SPACING) / 2;

// 3인칭 카메라: 보드 전체가 여유 있게 보이는 최대 시야 (줌 고정)
const SPAN = BOARD_SIZE * SPACING;
const TP_CAMERA_POS: [number, number, number] = [CENTER, SPAN * 1.6, CENTER + SPAN * 1.7];

// 색상 팔레트
const COLORS = {
  tileA: '#f1e9d8',
  tileB: '#e0d3b8',
  tileHover: '#bfdbfe',
  base: '#7c5a3a',
  baseSide: '#5f452d',
  wall: '#eab308', // 노란 벽 (설치된 장애물)
  wallPreview: '#fde047',
  fakeWall: '#22d3ee',
  collision: '#ef4444', // 충돌한 벽 (빨강)
  reveal: '#f59e0b', // 게임 종료 후 공개된 벽
  start: '#22c55e',
  end: '#ef4444',
  player: '#3b82f6',
};

// 보드 위 액션 이펙트 (지뢰 폭발/웜홀/탐지 파동/충돌 스파크/골인 축포)
export interface BoardFx {
  key: number;
  type: 'bump' | 'mine' | 'wormhole' | 'radar' | 'goal';
  at?: Position;
  to?: Position;
  dir?: Direction;
  delay?: number; // 발동 연출 지연 (말이 해당 칸에 도착하는 시점과 동기화)
}

// 셀 좌표 -> 3D 위치
function cellToWorld(position: Position): [number, number, number] {
  return [position.col * SPACING, 0, position.row * SPACING];
}

const DIR_VECTOR: Record<Direction, [number, number]> = {
  up: [0, -1],
  down: [0, 1],
  left: [-1, 0],
  right: [1, 0],
};

// ===== 벽 세그먼트 모델 =====
interface WallSegment {
  type: 'H' | 'V';
  row: number;
  col: number;
}

function segmentKey(seg: WallSegment): string {
  return `${seg.type}:${seg.row}:${seg.col}`;
}

function obstacleToSegment(position: Position, direction: Direction): WallSegment | null {
  const { row, col } = position;
  switch (direction) {
    case 'up':
      return row > 0 ? { type: 'H', row: row - 1, col } : null;
    case 'down':
      return row < BOARD_SIZE - 1 ? { type: 'H', row, col } : null;
    case 'left':
      return col > 0 ? { type: 'V', row, col: col - 1 } : null;
    case 'right':
      return col < BOARD_SIZE - 1 ? { type: 'V', row, col } : null;
    default:
      return null;
  }
}

function dedupeSegments(items: { position: Position; direction: Direction }[]): WallSegment[] {
  const map = new Map<string, WallSegment>();
  for (const item of items) {
    const seg = obstacleToSegment(item.position, item.direction);
    if (seg) map.set(segmentKey(seg), seg);
  }
  return Array.from(map.values());
}

function segmentToWorld(seg: WallSegment): [number, number, number] {
  if (seg.type === 'H') {
    return [seg.col * SPACING, WALL_HEIGHT / 2, seg.row * SPACING + SPACING / 2];
  }
  return [seg.col * SPACING + SPACING / 2, WALL_HEIGHT / 2, seg.row * SPACING];
}

function segmentSize(seg: WallSegment): [number, number, number] {
  return seg.type === 'H'
    ? [TILE + GAP * 0.6, WALL_HEIGHT, WALL_THICKNESS]
    : [WALL_THICKNESS, WALL_HEIGHT, TILE + GAP * 0.6];
}

function segmentToObstacle(seg: WallSegment): { position: Position; direction: Direction } {
  return seg.type === 'H'
    ? { position: { row: seg.row, col: seg.col }, direction: 'down' }
    : { position: { row: seg.row, col: seg.col }, direction: 'right' };
}

// ===== 개별 3D 요소 =====

function WallBox({ seg, color, opacity = 1, height = WALL_HEIGHT }: { seg: WallSegment; color: string; opacity?: number; height?: number }) {
  const [x, , z] = segmentToWorld(seg);
  const size = segmentSize(seg);
  return (
    <mesh position={[x, height / 2, z]} castShadow>
      <boxGeometry args={[size[0], height, size[2]]} />
      <meshStandardMaterial
        color={color}
        transparent={opacity < 1}
        opacity={opacity}
        roughness={0.4}
      />
    </mesh>
  );
}

function FakeWallBox({ seg, consumed = false }: { seg: WallSegment; consumed?: boolean }) {
  const [x, , z] = segmentToWorld(seg);
  const size = segmentSize(seg);
  const length = seg.type === 'H' ? size[0] : size[2];
  const pieceLength = length * 0.27;
  const offsets = [-length * 0.36, 0, length * 0.36];
  const height = consumed ? WALL_HEIGHT * 0.45 : WALL_HEIGHT;

  return (
    <group>
      {offsets.map((offset) => (
        <mesh
          key={offset}
          position={seg.type === 'H' ? [x + offset, height / 2, z] : [x, height / 2, z + offset]}
          castShadow={!consumed}
        >
          <boxGeometry
            args={seg.type === 'H'
              ? [pieceLength, height, WALL_THICKNESS]
              : [WALL_THICKNESS, height, pieceLength]}
          />
          <meshStandardMaterial
            color={COLORS.fakeWall}
            emissive={COLORS.fakeWall}
            emissiveIntensity={consumed ? 0.05 : 0.25}
            transparent={consumed}
            opacity={consumed ? 0.32 : 1}
            roughness={0.35}
          />
        </mesh>
      ))}
    </group>
  );
}

function WallSlot({
  seg,
  occupied,
  onPlace,
  previewColor = COLORS.wallPreview,
}: {
  seg: WallSegment;
  occupied: boolean;
  onPlace: (position: Position, direction: Direction) => void;
  previewColor?: string;
}) {
  const [hovered, setHovered] = useState(false);

  const handleClick = useCallback(
    (e: ThreeEvent<MouseEvent>) => {
      e.stopPropagation();
      if (e.delta > 4) return;
      const { position, direction } = segmentToObstacle(seg);
      onPlace(position, direction);
    },
    [seg, onPlace]
  );

  const size = segmentSize(seg);

  return (
    <group>
      <mesh
        position={segmentToWorld(seg)}
        onClick={handleClick}
        onPointerOver={(e) => {
          e.stopPropagation();
          setHovered(true);
          document.body.style.cursor = 'pointer';
        }}
        onPointerOut={() => {
          setHovered(false);
          document.body.style.cursor = 'auto';
        }}
      >
        <boxGeometry args={[size[0] + 0.08, WALL_HEIGHT + 0.2, size[2] + 0.08]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>

      {hovered && !occupied && <WallBox seg={seg} color={previewColor} opacity={0.55} />}
    </group>
  );
}

function Tile({
  position,
  selectable,
  selectionMode,
  isStart,
  isEnd,
  onCellClick,
  placeMode = 'wall',
  isPendingEntrance = false,
}: {
  position: Position;
  selectable: boolean;
  selectionMode: 'start' | 'end' | 'none';
  isStart: boolean;
  isEnd: boolean;
  onCellClick?: (p: Position) => void;
  placeMode?: 'wall' | ItemType;
  isPendingEntrance?: boolean;
}) {
  const [hovered, setHovered] = useState(false);
  const checker = (position.row + position.col) % 2 === 0;

  let color = checker ? COLORS.tileA : COLORS.tileB;
  if (hovered && selectable) color = COLORS.tileHover;

  const handleClick = useCallback(
    (e: ThreeEvent<MouseEvent>) => {
      e.stopPropagation();
      if (e.delta > 4) return;
      if (selectable && onCellClick) onCellClick(position);
    },
    [selectable, onCellClick, position]
  );

  return (
    <group position={cellToWorld(position)}>
      <mesh
        receiveShadow
        onClick={handleClick}
        onPointerOver={(e) => {
          if (!selectable) return;
          e.stopPropagation();
          setHovered(true);
          document.body.style.cursor = 'pointer';
        }}
        onPointerOut={() => {
          setHovered(false);
          if (selectable) document.body.style.cursor = 'auto';
        }}
      >
        <boxGeometry args={[TILE, 0.16, TILE]} />
        <meshStandardMaterial color={color} roughness={0.8} />
      </mesh>

      {/* 시작점 패드 (은은한 펄스) */}
      {isStart && <StartPad />}

      {/* 도착점 패드 + 펄럭이는 깃발 */}
      {isEnd && <GoalFlag />}

      {/* 시작/도착 선택 모드 호버 미리보기 */}
      {hovered && selectable && selectionMode !== 'none' && !isStart && !isEnd && (
        <mesh position={[0, 0.1, 0]}>
          <cylinderGeometry args={[0.34, 0.34, 0.04, 32]} />
          <meshStandardMaterial
            color={selectionMode === 'start' ? COLORS.start : COLORS.end}
            transparent
            opacity={0.55}
          />
        </mesh>
      )}

      {/* 지뢰 배치 미리보기 */}
      {hovered && selectable && placeMode === 'mine' && !isStart && !isEnd && (
        <mesh position={[0, 0.2, 0]}>
          <sphereGeometry args={[0.15, 16, 16]} />
          <meshStandardMaterial color="#374151" transparent opacity={0.6} />
        </mesh>
      )}

      {/* 웜홀 배치 미리보기 */}
      {hovered && selectable && placeMode === 'wormhole' && !isStart && !isEnd && !isPendingEntrance && (
        <mesh position={[0, 0.1, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <torusGeometry args={[0.3, 0.05, 10, 28]} />
          <meshStandardMaterial color="#a855f7" emissive="#a855f7" emissiveIntensity={0.4} transparent opacity={0.6} />
        </mesh>
      )}

      {/* 웜홀 입구 지정됨 (출구 선택 대기 중 표시) */}
      {isPendingEntrance && (
        <mesh position={[0, 0.1, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <torusGeometry args={[0.3, 0.06, 12, 32]} />
          <meshStandardMaterial color="#a855f7" emissive="#a855f7" emissiveIntensity={0.8} />
        </mesh>
      )}
    </group>
  );
}

// 시작점 패드 - 은은한 펄스
function StartPad() {
  const matRef = useRef<THREE.MeshStandardMaterial>(null);
  useFrame((state) => {
    if (matRef.current) {
      matRef.current.emissiveIntensity = 0.2 + Math.abs(Math.sin(state.clock.elapsedTime * 1.6)) * 0.25;
    }
  });
  return (
    <mesh position={[0, 0.09, 0]} receiveShadow>
      <cylinderGeometry args={[0.36, 0.36, 0.05, 32]} />
      <meshStandardMaterial ref={matRef} color={COLORS.start} emissive={COLORS.start} emissiveIntensity={0.25} />
    </mesh>
  );
}

// 도착점 깃발 - 좌우로 살랑이는 애니메이션
function GoalFlag() {
  const flagRef = useRef<THREE.Mesh>(null);
  useFrame((state) => {
    if (flagRef.current) {
      flagRef.current.rotation.y = Math.sin(state.clock.elapsedTime * 2.4) * 0.35;
    }
  });
  return (
    <group position={[0, 0.09, 0]}>
      <mesh receiveShadow>
        <cylinderGeometry args={[0.36, 0.36, 0.05, 32]} />
        <meshStandardMaterial color={COLORS.end} emissive={COLORS.end} emissiveIntensity={0.2} />
      </mesh>
      <mesh position={[0, 0.4, 0]} castShadow>
        <cylinderGeometry args={[0.03, 0.03, 0.8, 8]} />
        <meshStandardMaterial color="#78716c" />
      </mesh>
      <group position={[0, 0.66, 0]}>
        <mesh ref={flagRef} position={[0.16, 0, 0]} castShadow>
          <boxGeometry args={[0.32, 0.2, 0.02]} />
          <meshStandardMaterial color={COLORS.end} side={THREE.DoubleSide} />
        </mesh>
      </group>
    </group>
  );
}

// ===== 캐릭터 (플레이어 말) =====
// 대기 숨쉬기 / 칸 이동 폴짝폴짝 호핑(경유지 경로 지원) + 이동 방향 바라보기
// 충돌 부들부들 / 웜홀 스파게티화 흡입·방출 / 골인 세리머니
function Pawn({
  position,
  via = null,
  color,
  fx,
  celebrating = false,
}: {
  position: Position;
  via?: Position[] | null; // 경유지 - 지뢰 넉백(뒤로 폴짝 2번) 등 경로 이동
  color: string;
  fx?: BoardFx | null;
  celebrating?: boolean;
}) {
  const outerRef = useRef<THREE.Group>(null); // 위치 이동 담당
  const innerRef = useRef<THREE.Group>(null); // 점프/흔들림/회전/스케일 담당
  const yawRef = useRef(0);
  const bumpUntilRef = useRef(0);
  const popUntilRef = useRef(0);
  const lastFxKeyRef = useRef(0);
  // 웜홀 트랜싯: 다음 원거리 점프를 스파게티화 흡입/방출로 연출
  const wormholePendingRef = useRef(false);
  const transitRef = useRef<{ phase: 'suck' | 'emerge'; progress: number } | null>(null);

  // 이동 경로: 경유지(via)를 거쳐 최종 칸까지 한 칸씩 폴짝폴짝
  const waypoints = useMemo(() => {
    return [...(via ?? []), position].map((p) => {
      const [x, , z] = cellToWorld(p);
      return new THREE.Vector3(x, 0, z);
    });
  }, [position, via]);

  const queueRef = useRef<THREE.Vector3[]>([]);
  const lastWaypointsRef = useRef<THREE.Vector3[] | null>(null);
  if (lastWaypointsRef.current !== waypoints) {
    lastWaypointsRef.current = waypoints;
    queueRef.current = [...waypoints];
  }

  // 첫 렌더 위치. 이후에는 useFrame이 위치를 전담한다 -
  // position을 그대로 group prop으로 넘기면 React가 매 렌더마다 위치를 목표점으로
  // 덮어써서 lerp/호핑이 전부 무효화된다 (스냅 버그)
  const initialPosRef = useRef<[number, number, number] | null>(null);
  if (initialPosRef.current === null) {
    const last = waypoints[waypoints.length - 1];
    initialPosRef.current = [last.x, 0, last.z];
  }

  useFrame((state, delta) => {
    const outer = outerRef.current;
    const inner = innerRef.current;
    if (!outer || !inner) return;

    const now = state.clock.elapsedTime;

    // 이펙트 트리거 감지
    if (fx && fx.key !== lastFxKeyRef.current) {
      lastFxKeyRef.current = fx.key;
      if (fx.type === 'bump') bumpUntilRef.current = now + 0.5;
      if (fx.type === 'wormhole') wormholePendingRef.current = true;
    }

    // 다음 웨이포인트 (도착하면 큐에서 꺼내 다음 칸으로)
    let target = queueRef.current[0];
    if (!target) return;
    let dist = outer.position.distanceTo(target);
    while (dist < 0.07 && queueRef.current.length > 1) {
      queueRef.current.shift();
      target = queueRef.current[0];
      dist = outer.position.distanceTo(target);
    }

    // ---- 웜홀 트랜싯 (스파게티화) ----
    const transit = transitRef.current;
    if (transit) {
      transit.progress = Math.min(1, transit.progress + delta / 0.5);
      const p = transit.progress;
      if (transit.phase === 'suck') {
        // 가늘고 길게 늘어나며 회전 가속, 포탈 속으로 침몰
        const sy = 1 + 1.5 * p;
        const sxz = Math.max(0.03, 1 - p);
        inner.scale.set(sxz, sy, sxz);
        inner.position.set(0, -2.3 * Math.pow(p, 1.6), 0);
        inner.rotation.y += delta * (6 + 20 * p);
        if (p >= 1) {
          outer.position.copy(target); // 출구로 순간 이동 (화면상으론 이미 사라진 상태)
          transitRef.current = { phase: 'emerge', progress: 0 };
        }
      } else {
        // 출구에서 늘어난 채 솟아나와 원래 모습으로
        const q = 1 - p;
        const sy = 1 + 1.5 * q;
        const sxz = Math.max(0.03, p);
        inner.scale.set(sxz, sy, sxz);
        inner.position.set(0, -2.3 * Math.pow(q, 1.6), 0);
        inner.rotation.y += delta * (6 + 20 * q);
        if (p >= 1) {
          transitRef.current = null;
          inner.scale.set(1, 1, 1);
        }
      }
      return; // 트랜싯 중엔 호핑/숨쉬기/흔들림 스킵
    }

    // 원거리 점프: 웜홀이면 스파게티화 트랜싯, 그 외(관전 전환 등)는 뿅 팝
    if (dist > SPACING * 1.6) {
      if (wormholePendingRef.current) {
        wormholePendingRef.current = false;
        transitRef.current = { phase: 'suck', progress: 0 };
        return;
      }
      outer.position.copy(target);
      popUntilRef.current = now + 0.4;
      dist = 0;
    } else {
      const t = 1 - Math.pow(0.0004, delta);
      outer.position.lerp(target, t);
    }

    // 이동 방향 바라보기
    const dx = target.x - outer.position.x;
    const dz = target.z - outer.position.z;
    if (Math.abs(dx) + Math.abs(dz) > 0.02) {
      yawRef.current = Math.atan2(dx, dz);
    }
    if (!celebrating) {
      inner.rotation.y += (yawRef.current - inner.rotation.y) * Math.min(1, delta * 10);
    }

    // 칸 이동 호핑 (한 칸 = 한 번의 포물선 점프) + 대기 숨쉬기
    const hop = Math.sin(Math.min(dist / SPACING, 1) * Math.PI) * 0.34;
    const idle = dist < 0.02 ? Math.abs(Math.sin(now * 2.2)) * 0.03 : 0;
    let y = hop + idle;

    // 골인 세리머니: 빙글빙글 + 폴짝폴짝
    if (celebrating) {
      inner.rotation.y += delta * 7;
      y += Math.abs(Math.sin(now * 6)) * 0.35;
    }

    // 충돌 부들부들
    let jx = 0;
    let jz = 0;
    if (now < bumpUntilRef.current) {
      const k = (bumpUntilRef.current - now) / 0.5;
      jx = Math.sin(now * 55) * 0.06 * k;
      jz = Math.cos(now * 43) * 0.05 * k;
    }

    // 순간이동 팝 (작아졌다 커지며 등장)
    let scale = 1;
    if (now < popUntilRef.current) {
      const p = 1 - (popUntilRef.current - now) / 0.4;
      scale = 0.3 + 0.7 * (1 - Math.pow(1 - p, 2));
    }

    inner.position.set(jx, y, jz);
    inner.scale.setScalar(scale);

    // 숨쉬기 스쿼시
    const breathe = dist < 0.02 && !celebrating ? 1 + Math.sin(now * 2.2) * 0.02 : 1;
    inner.scale.y = scale * breathe;
  });

  return (
    <group ref={outerRef} position={initialPosRef.current}>
      <group ref={innerRef}>
        {/* 몸통 */}
        <mesh position={[0, 0.33, 0]} castShadow>
          <cylinderGeometry args={[0.14, 0.24, 0.42, 24]} />
          <meshStandardMaterial color={color} roughness={0.35} />
        </mesh>
        {/* 머리 */}
        <mesh position={[0, 0.64, 0]} castShadow>
          <sphereGeometry args={[0.17, 24, 24]} />
          <meshStandardMaterial color={color} roughness={0.3} />
        </mesh>
        {/* 눈 (이동 방향을 바라보는 캐릭터 느낌) */}
        <mesh position={[0.06, 0.68, 0.13]}>
          <sphereGeometry args={[0.045, 12, 12]} />
          <meshStandardMaterial color="#ffffff" />
        </mesh>
        <mesh position={[-0.06, 0.68, 0.13]}>
          <sphereGeometry args={[0.045, 12, 12]} />
          <meshStandardMaterial color="#ffffff" />
        </mesh>
        <mesh position={[0.06, 0.68, 0.165]}>
          <sphereGeometry args={[0.02, 8, 8]} />
          <meshStandardMaterial color="#1e293b" />
        </mesh>
        <mesh position={[-0.06, 0.68, 0.165]}>
          <sphereGeometry args={[0.02, 8, 8]} />
          <meshStandardMaterial color="#1e293b" />
        </mesh>
      </group>
    </group>
  );
}

// ===== 액션 이펙트 =====

// 파편 방향 (고정 시드 - 매 렌더 동일)
const BURST_DIRS: Array<[number, number, number]> = [
  [0.9, 1.6, 0.2], [-0.7, 1.9, 0.5], [0.3, 1.4, -0.9], [-0.4, 2.1, -0.5],
  [1.1, 1.2, -0.3], [-1.0, 1.5, -0.1], [0.1, 2.3, 0.8], [0.6, 1.1, 1.0],
];

// 지뢰 폭발: 팽창하는 화염구 + 사방으로 튀는 파편
function MineExplosionFX({ at, delay = 0 }: { at: Position; delay?: number }) {
  const [x, , z] = cellToWorld(at);
  const fireRef = useRef<THREE.Mesh>(null);
  const fireMatRef = useRef<THREE.MeshStandardMaterial>(null);
  const debrisRefs = useRef<Array<THREE.Mesh | null>>([]);
  const startRef = useRef<number | null>(null);
  const [started, setStarted] = useState(delay === 0);
  const [done, setDone] = useState(false);
  const LIFE = 0.9;

  useFrame((state, delta) => {
    if (startRef.current === null) startRef.current = state.clock.elapsedTime;
    const t = state.clock.elapsedTime - startRef.current - delay;
    if (t < 0) return; // 말이 지뢰 칸에 도착할 때까지 대기
    if (!started) setStarted(true);
    if (t > LIFE) {
      if (!done) setDone(true);
      return;
    }
    const p = t / LIFE;

    if (fireRef.current && fireMatRef.current) {
      fireRef.current.scale.setScalar(0.2 + p * 1.6);
      fireMatRef.current.opacity = Math.max(0, 0.95 * (1 - p * 1.2));
    }
    debrisRefs.current.forEach((m, i) => {
      if (!m) return;
      const d = BURST_DIRS[i % BURST_DIRS.length];
      m.position.x += d[0] * delta * 1.6;
      m.position.z += d[2] * delta * 1.6;
      m.position.y = Math.max(0.05, 0.2 + d[1] * t - 4.5 * t * t);
      m.rotation.x += delta * 9;
      m.rotation.y += delta * 7;
    });
  });

  if (done) return null;

  return (
    <group position={[x, 0.2, z]} visible={started}>
      <mesh ref={fireRef}>
        <sphereGeometry args={[0.3, 20, 20]} />
        <meshStandardMaterial ref={fireMatRef} color="#f97316" emissive="#f97316" emissiveIntensity={1.6} transparent opacity={0.95} />
      </mesh>
      {BURST_DIRS.map((_, i) => (
        <mesh key={i} ref={(el) => { debrisRefs.current[i] = el; }} position={[0, 0.1, 0]} castShadow>
          <boxGeometry args={[0.07, 0.07, 0.07]} />
          <meshStandardMaterial color={i % 2 ? '#57534e' : '#f59e0b'} />
        </mesh>
      ))}
    </group>
  );
}

// 웜홀 이동: 입구/출구에서 확장되며 사라지는 보라 고리
function WormholeFX({ at, to, delay = 0 }: { at: Position; to?: Position; delay?: number }) {
  const [ex, , ez] = cellToWorld(at);
  const exit = to ? cellToWorld(to) : null;
  const inRef = useRef<THREE.Mesh>(null);
  const inMat = useRef<THREE.MeshStandardMaterial>(null);
  const outRef = useRef<THREE.Mesh>(null);
  const outMat = useRef<THREE.MeshStandardMaterial>(null);
  const startRef = useRef<number | null>(null);
  const [done, setDone] = useState(false);
  const LIFE = 1.7; // 흡입(0.5s) + 방출(0.5s)에 맞춰 링 연출

  useFrame((state) => {
    if (startRef.current === null) startRef.current = state.clock.elapsedTime;
    const t = state.clock.elapsedTime - startRef.current - delay;
    if (t > LIFE) {
      if (!done) setDone(true);
      return;
    }
    // 입구 링: 말이 빨려들어가는 동안 확장
    const p1 = Math.max(0, Math.min(1, t / 0.6));
    if (inRef.current && inMat.current) {
      inRef.current.scale.setScalar(0.4 + p1 * 2.2);
      inRef.current.rotation.z += 0.15;
      inMat.current.opacity = t < 0 ? 0 : Math.max(0, 0.9 * (1 - p1));
    }
    // 출구 링: 말이 솟아나오는 시점(흡입 완료 후)에 확장
    const p2 = Math.max(0, Math.min(1, (t - 0.5) / 0.6));
    if (outRef.current && outMat.current) {
      outRef.current.scale.setScalar(0.4 + p2 * 2.2);
      outRef.current.rotation.z -= 0.15;
      outMat.current.opacity = p2 > 0 ? Math.max(0, 0.9 * (1 - p2)) : 0;
    }
  });

  if (done) return null;

  return (
    <group>
      <mesh ref={inRef} position={[ex, 0.15, ez]} rotation={[-Math.PI / 2, 0, 0]}>
        <torusGeometry args={[0.3, 0.05, 10, 32]} />
        <meshStandardMaterial ref={inMat} color="#a855f7" emissive="#a855f7" emissiveIntensity={1.4} transparent opacity={0.9} />
      </mesh>
      {exit && (
        <mesh ref={outRef} position={[exit[0], 0.15, exit[2]]} rotation={[-Math.PI / 2, 0, 0]}>
          <torusGeometry args={[0.3, 0.05, 10, 32]} />
          <meshStandardMaterial ref={outMat} color="#d8b4fe" emissive="#d8b4fe" emissiveIntensity={1.4} transparent opacity={0} />
        </mesh>
      )}
    </group>
  );
}

// 탐지기: 바닥을 훑고 지나가는 레이더 파동
function RadarFX({ at }: { at: Position }) {
  const [x, , z] = cellToWorld(at);
  const ringRef = useRef<THREE.Mesh>(null);
  const matRef = useRef<THREE.MeshStandardMaterial>(null);
  const startRef = useRef<number | null>(null);
  const [done, setDone] = useState(false);
  const LIFE = 1.1;

  useFrame((state) => {
    if (startRef.current === null) startRef.current = state.clock.elapsedTime;
    const t = state.clock.elapsedTime - startRef.current;
    if (t > LIFE) {
      if (!done) setDone(true);
      return;
    }
    const p = t / LIFE;
    if (ringRef.current && matRef.current) {
      const r = 0.3 + p * SPACING * 2.2;
      ringRef.current.scale.setScalar(r);
      matRef.current.opacity = Math.max(0, 0.8 * (1 - p));
    }
  });

  if (done) return null;

  return (
    <mesh ref={ringRef} position={[x, 0.12, z]} rotation={[-Math.PI / 2, 0, 0]}>
      <torusGeometry args={[1, 0.035, 10, 48]} />
      <meshStandardMaterial ref={matRef} color="#fbbf24" emissive="#fbbf24" emissiveIntensity={1.4} transparent opacity={0.8} />
    </mesh>
  );
}

// 벽 충돌: 부딪힌 지점에서 튀는 스파크
function BumpFX({ at, dir }: { at: Position; dir?: Direction }) {
  const [x, , z] = cellToWorld(at);
  const offset = dir ? DIR_VECTOR[dir] : [0, 0];
  const px = x + offset[0] * (SPACING / 2);
  const pz = z + offset[1] * (SPACING / 2);
  const sparkRefs = useRef<Array<THREE.Mesh | null>>([]);
  const startRef = useRef<number | null>(null);
  const [done, setDone] = useState(false);
  const LIFE = 0.5;

  useFrame((state, delta) => {
    if (startRef.current === null) startRef.current = state.clock.elapsedTime;
    const t = state.clock.elapsedTime - startRef.current;
    if (t > LIFE) {
      if (!done) setDone(true);
      return;
    }
    sparkRefs.current.forEach((m, i) => {
      if (!m) return;
      const d = BURST_DIRS[(i * 2) % BURST_DIRS.length];
      m.position.x += d[0] * delta * 0.9;
      m.position.z += d[2] * delta * 0.9;
      m.position.y = Math.max(0.05, 0.3 + d[1] * 0.5 * t - 3.5 * t * t);
      const s = Math.max(0.01, 1 - t / LIFE);
      m.scale.setScalar(s);
    });
  });

  if (done) return null;

  return (
    <group position={[px, 0.1, pz]}>
      {[0, 1, 2, 3, 4].map((i) => (
        <mesh key={i} ref={(el) => { sparkRefs.current[i] = el; }} position={[0, 0.25, 0]}>
          <sphereGeometry args={[0.05, 8, 8]} />
          <meshStandardMaterial color="#fbbf24" emissive="#fbbf24" emissiveIntensity={2} />
        </mesh>
      ))}
    </group>
  );
}

// 골인: 도착점에서 터지는 축포
function GoalFX({ at }: { at: Position }) {
  const [x, , z] = cellToWorld(at);
  const confettiRefs = useRef<Array<THREE.Mesh | null>>([]);
  const startRef = useRef<number | null>(null);
  const [done, setDone] = useState(false);
  const LIFE = 1.4;
  const CONFETTI_COLORS = ['#f59e0b', '#22c55e', '#3b82f6', '#ef4444', '#a855f7', '#eab308', '#14b8a6', '#f97316'];

  useFrame((state, delta) => {
    if (startRef.current === null) startRef.current = state.clock.elapsedTime;
    const t = state.clock.elapsedTime - startRef.current;
    if (t > LIFE) {
      if (!done) setDone(true);
      return;
    }
    confettiRefs.current.forEach((m, i) => {
      if (!m) return;
      const d = BURST_DIRS[i % BURST_DIRS.length];
      m.position.x += d[0] * delta * 1.1;
      m.position.z += d[2] * delta * 1.1;
      m.position.y = Math.max(0.05, 0.3 + d[1] * 1.2 * t - 3.2 * t * t);
      m.rotation.x += delta * 8;
      m.rotation.z += delta * 6;
    });
  });

  if (done) return null;

  return (
    <group position={[x, 0.3, z]}>
      {CONFETTI_COLORS.map((c, i) => (
        <mesh key={i} ref={(el) => { confettiRefs.current[i] = el; }} position={[0, 0.2, 0]}>
          <boxGeometry args={[0.09, 0.02, 0.09]} />
          <meshStandardMaterial color={c} emissive={c} emissiveIntensity={0.5} />
        </mesh>
      ))}
    </group>
  );
}

function FxLayer({ fx }: { fx?: BoardFx | null }) {
  if (!fx || !fx.at) return null;
  switch (fx.type) {
    case 'mine':
      return <MineExplosionFX key={fx.key} at={fx.at} delay={fx.delay ?? 0} />;
    case 'wormhole':
      return <WormholeFX key={fx.key} at={fx.at} to={fx.to} delay={fx.delay ?? 0} />;
    case 'radar':
      return <RadarFX key={fx.key} at={fx.at} />;
    case 'bump':
      return <BumpFX key={fx.key} at={fx.at} dir={fx.dir} />;
    case 'goal':
      return <GoalFX key={fx.key} at={fx.at} />;
    default:
      return null;
  }
}

// ===== 맵 아이템 표시 =====
function ItemVisuals({
  item,
  consumed,
  visible,
  setup = false,
  distinguishOneTimeWalls = false,
}: {
  item: MapItem;
  consumed: boolean;
  visible: boolean;
  setup?: boolean;
  distinguishOneTimeWalls?: boolean;
}) {
  if (!visible) return null;

  if (item.type === 'oneTimeWall' && item.wallPosition && item.wallDirection) {
    const seg = obstacleToSegment(item.wallPosition, item.wallDirection);
    if (!seg) return null;
    // 위장 벽: 어디서든 일반 벽과 픽셀 단위로 동일하게 - 제작 중엔 노란 벽,
    // 종료 공개 시엔 공개 벽과 같은 색. 통과된 뒤엔 표시하지 않음
    if (consumed) return distinguishOneTimeWalls ? <FakeWallBox seg={seg} consumed /> : null;
    if (setup || distinguishOneTimeWalls) return <FakeWallBox seg={seg} />;
    return <WallBox seg={seg} color={COLORS.reveal} opacity={0.75} />;
  }

  if (item.type === 'mine' && item.position) {
    return <MineVisual position={item.position} consumed={consumed} />;
  }

  if (item.type === 'smoke' && item.position) {
    return <SmokeVisual position={item.position} consumed={consumed} />;
  }

  if (item.type === 'wormhole' && item.entrance && item.exit) {
    return <WormholeVisual entrance={item.entrance} exit={item.exit} consumed={consumed} />;
  }

  return null;
}

function MineVisual({ position, consumed }: { position: Position; consumed: boolean }) {
  const lampRef = useRef<THREE.MeshStandardMaterial>(null);
  const [x, , z] = cellToWorld(position);

  useFrame((state) => {
    if (lampRef.current) {
      lampRef.current.emissiveIntensity = 0.4 + Math.abs(Math.sin(state.clock.elapsedTime * 3)) * 1.2;
    }
  });

  if (consumed) {
    return (
      <mesh position={[x, 0.09, z]}>
        <cylinderGeometry args={[0.3, 0.3, 0.03, 24]} />
        <meshStandardMaterial color="#1c1917" roughness={1} />
      </mesh>
    );
  }

  return (
    <group position={[x, 0.2, z]}>
      <mesh castShadow>
        <sphereGeometry args={[0.15, 20, 20]} />
        <meshStandardMaterial color="#374151" roughness={0.3} metalness={0.5} />
      </mesh>
      <mesh position={[0, 0.13, 0]}>
        <cylinderGeometry args={[0.02, 0.02, 0.1, 8]} />
        <meshStandardMaterial ref={lampRef} color="#ef4444" emissive="#ef4444" emissiveIntensity={0.6} />
      </mesh>
    </group>
  );
}

function SmokeVisual({ position, consumed }: { position: Position; consumed: boolean }) {
  const [x, , z] = cellToWorld(position);

  if (consumed) {
    return (
      <mesh position={[x, 0.06, z]}>
        <cylinderGeometry args={[0.24, 0.3, 0.04, 16]} />
        <meshStandardMaterial color="#475569" roughness={1} />
      </mesh>
    );
  }

  return (
    <group position={[x, 0.2, z]}>
      <mesh castShadow>
        <cylinderGeometry args={[0.13, 0.16, 0.3, 16]} />
        <meshStandardMaterial color="#64748b" roughness={0.45} metalness={0.35} />
      </mesh>
      <mesh position={[0, 0.17, 0]}>
        <cylinderGeometry args={[0.07, 0.09, 0.05, 12]} />
        <meshStandardMaterial color="#cbd5e1" roughness={0.3} metalness={0.5} />
      </mesh>
    </group>
  );
}

function WormholeVisual({ entrance, exit, consumed }: { entrance: Position; exit: Position; consumed: boolean }) {
  const entranceRef = useRef<THREE.Group>(null);
  const exitRef = useRef<THREE.Group>(null);
  const [ex, , ez] = cellToWorld(entrance);
  const [xx, , xz] = cellToWorld(exit);
  const opacity = consumed ? 0.35 : 0.9;

  useFrame((_, delta) => {
    const speed = consumed ? 0.4 : 2.2;
    if (entranceRef.current) entranceRef.current.rotation.y += delta * speed;
    if (exitRef.current) exitRef.current.rotation.y -= delta * speed * 0.7;
  });

  return (
    <group>
      <group ref={entranceRef} position={[ex, 0.1, ez]}>
        <mesh rotation={[-Math.PI / 2, 0, 0]}>
          <torusGeometry args={[0.3, 0.06, 12, 32]} />
          <meshStandardMaterial color="#a855f7" emissive="#a855f7" emissiveIntensity={consumed ? 0.1 : 0.7} transparent opacity={opacity} />
        </mesh>
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.06, 0]}>
          <torusGeometry args={[0.18, 0.035, 10, 28]} />
          <meshStandardMaterial color="#c084fc" emissive="#c084fc" emissiveIntensity={consumed ? 0.1 : 0.5} transparent opacity={opacity} />
        </mesh>
        <mesh position={[0, -0.02, 0]}>
          <cylinderGeometry args={[0.24, 0.24, 0.03, 24]} />
          <meshStandardMaterial color="#581c87" transparent opacity={opacity} />
        </mesh>
      </group>
      <group ref={exitRef} position={[xx, 0.1, xz]}>
        <mesh rotation={[-Math.PI / 2, 0, 0]}>
          <torusGeometry args={[0.3, 0.05, 12, 32]} />
          <meshStandardMaterial color="#d8b4fe" emissive="#d8b4fe" emissiveIntensity={consumed ? 0.1 : 0.5} transparent opacity={opacity} />
        </mesh>
      </group>
    </group>
  );
}

// ===== 보드 내용물 =====
export interface GameBoard3DProps {
  gamePhase: GamePhase;
  startPosition?: Position;
  endPosition?: Position;
  playerPosition?: Position;
  obstacles: Obstacle[];
  collisionWalls?: CollisionWall[];
  onCellClick?: (position: Position) => void;
  onDirectionClick?: (position: Position, direction: Direction) => void;
  readOnly?: boolean;
  selectionMode?: 'start' | 'end' | 'none';
  revealObstacles?: boolean; // 게임 종료 후 상대 벽 공개
  revealItems?: boolean; // 맵 제작자 시점 또는 게임 종료 후 숨은 아이템 공개
  distinguishOneTimeWalls?: boolean;
  pawnColor?: string; // 말 색상 (기본 파랑, 관전 시 상대 말은 빨강)
  items?: MapItem[] | null;
  itemsConsumed?: Record<number, boolean> | null; // 인덱스별 사용 여부
  revealedWalls?: Obstacle[]; // 탐지기로 밝혀낸 벽들
  placeMode?: 'wall' | ItemType;
  pendingCell?: Position | null;
  fx?: BoardFx | null; // 액션 이펙트
  pawnVia?: Position[] | null; // 말 이동 경유지 (지뢰 넉백 등 경로 연출)
  celebrating?: boolean; // 골인 세리머니
  fullscreen?: boolean;
  heightClassName?: string;
  compact?: boolean; // 동시 보드용 저비용 렌더링
}

function CompactBoardCamera({ enabled }: { enabled: boolean }) {
  const { camera, size } = useThree();

  useEffect(() => {
    if (!enabled || !(camera instanceof THREE.PerspectiveCamera)) return;

    // 2x2 타일에서는 시점을 더 높이고, 세로로 긴 모바일 칸은 거리를 늘린다.
    const aspect = size.width / Math.max(size.height, 1);
    const distanceScale = Math.min(2.4, Math.max(1, 0.92 / Math.max(aspect, 0.4)));
    camera.position.set(
      CENTER,
      SPAN * 2.1 * distanceScale,
      CENTER + SPAN * 1.1 * distanceScale
    );
    camera.lookAt(CENTER, 0, CENTER);
    camera.updateProjectionMatrix();
  }, [camera, enabled, size.height, size.width]);

  return null;
}

const BoardContents: React.FC<GameBoard3DProps> = ({
  gamePhase,
  startPosition,
  endPosition,
  playerPosition,
  obstacles,
  collisionWalls = [],
  onCellClick,
  onDirectionClick,
  readOnly = false,
  selectionMode = 'none',
  revealObstacles = false,
  revealItems = false,
  distinguishOneTimeWalls = false,
  pawnColor,
  items = null,
  itemsConsumed = null,
  revealedWalls = [],
  placeMode = 'wall',
  pendingCell = null,
  fx = null,
  pawnVia = null,
  celebrating = false,
}) => {
  const isSetup = gamePhase === GamePhase.SETUP;

  const obstacleSegments = dedupeSegments(obstacles || []);
  const collisionSegments = dedupeSegments(collisionWalls || []);
  const radarSegments = dedupeSegments(revealedWalls || []);
  const collisionKeys = new Set(collisionSegments.map(segmentKey));
  const allSlots: WallSegment[] = [];
  for (let row = 0; row < BOARD_SIZE - 1; row += 1) {
    for (let col = 0; col < BOARD_SIZE; col += 1) allSlots.push({ type: 'H', row, col });
  }
  for (let row = 0; row < BOARD_SIZE; row += 1) {
    for (let col = 0; col < BOARD_SIZE - 1; col += 1) allSlots.push({ type: 'V', row, col });
  }
  const occupiedKeys = new Set(obstacleSegments.map(segmentKey));
  (items || []).forEach((item) => {
    if (item.type === 'oneTimeWall' && item.wallPosition && item.wallDirection) {
      const segment = obstacleToSegment(item.wallPosition, item.wallDirection);
      if (segment) occupiedKeys.add(segmentKey(segment));
    }
  });

  const tiles = [];
  for (let row = 0; row < BOARD_SIZE; row++) {
    for (let col = 0; col < BOARD_SIZE; col++) {
      const position = { row, col };
      tiles.push(
        <Tile
          key={`tile-${row}-${col}`}
          position={position}
          selectable={!readOnly && isSetup && !!onCellClick}
          selectionMode={selectionMode}
          isStart={!!startPosition && isSamePosition(position, startPosition)}
          isEnd={!!endPosition && isSamePosition(position, endPosition)}
          onCellClick={onCellClick}
          placeMode={placeMode}
          isPendingEntrance={!!pendingCell && isSamePosition(position, pendingCell)}
        />
      );
    }
  }

  const boardSpan = BOARD_SIZE * SPACING - GAP;

  return (
    <group>
      {/* 보드 받침대 */}
      <mesh position={[CENTER, -0.22, CENTER]} receiveShadow>
        <boxGeometry args={[boardSpan + 0.7, 0.28, boardSpan + 0.7]} />
        <meshStandardMaterial color={COLORS.base} roughness={0.9} />
      </mesh>
      <mesh position={[CENTER, -0.4, CENTER]}>
        <boxGeometry args={[boardSpan + 1.0, 0.12, boardSpan + 1.0]} />
        <meshStandardMaterial color={COLORS.baseSide} roughness={1} />
      </mesh>

      {/* 타일 */}
      {tiles}

      {/* 설치 단계: 배치된 노란 벽 */}
      {isSetup &&
        obstacleSegments.map((seg) => (
          <WallBox key={`ob-${segmentKey(seg)}`} seg={seg} color={COLORS.wall} />
        ))}

      {/* 설치 단계: 클릭 가능한 벽 슬롯 */}
      {isSetup && !readOnly && onDirectionClick &&
        allSlots.map((seg) => (
          <WallSlot
            key={`slot-${segmentKey(seg)}`}
            seg={seg}
            occupied={occupiedKeys.has(segmentKey(seg))}
            onPlace={onDirectionClick}
            previewColor={COLORS.wallPreview}
          />
        ))}

      {/* 플레이 단계: 충돌한 벽 (빨간색) */}
      {gamePhase === GamePhase.PLAY &&
        collisionSegments.map((seg) => (
          <WallBox key={`col-${segmentKey(seg)}`} seg={seg} color={COLORS.collision} />
        ))}

      {/* 게임 종료: 공개된 벽 (반투명 주황) - 충돌한 벽은 빨간색 유지 */}
      {gamePhase === GamePhase.PLAY && revealObstacles &&
        obstacleSegments
          .filter((seg) => !collisionKeys.has(segmentKey(seg)))
          .map((seg) => (
            <WallBox key={`rev-${segmentKey(seg)}`} seg={seg} color={COLORS.reveal} opacity={0.75} />
          ))}

      {/* 탐지기로 밝혀낸 벽 (게임 종료 공개 전까지만) */}
      {gamePhase === GamePhase.PLAY && !revealObstacles &&
        radarSegments
          .filter((seg) => !collisionKeys.has(segmentKey(seg)))
          .map((seg) => (
            <WallBox key={`radar-${segmentKey(seg)}`} seg={seg} color={COLORS.wall} />
          ))}

      {/* 맵 아이템들 */}
      {(items || []).map((it, idx) => (
        <ItemVisuals
          key={`item-${idx}`}
          item={it}
          consumed={!!itemsConsumed?.[idx]}
          visible={isSetup || revealItems}
          setup={isSetup}
          distinguishOneTimeWalls={distinguishOneTimeWalls}
        />
      ))}

      {/* 액션 이펙트 */}
      <FxLayer fx={fx} />

      {/* 플레이어 캐릭터 */}
      {playerPosition && (
        <Pawn position={playerPosition} via={pawnVia} color={pawnColor || COLORS.player} fx={fx} celebrating={celebrating} />
      )}
    </group>
  );
};

// ===== 메인 컴포넌트 (Canvas 래퍼) =====
const GameBoard3D: React.FC<GameBoard3DProps> = (props) => {
  const {
    heightClassName = 'h-[340px] sm:h-[420px] md:h-[460px]',
    fullscreen = false,
    compact = false,
  } = props;

  useEffect(() => {
    return () => {
      document.body.style.cursor = 'auto';
    };
  }, []);

  return (
    <div
      className={
        fullscreen
          ? 'absolute inset-0 bg-gradient-to-b from-slate-800 via-slate-900 to-slate-950'
          : `w-full max-w-2xl mx-auto ${heightClassName} rounded-2xl overflow-hidden border border-slate-700/60 shadow-xl shadow-black/50 bg-gradient-to-b from-slate-800 via-slate-900 to-slate-950`
      }
    >
      <Canvas
        shadows={!compact}
        dpr={compact ? [1, 1.25] : [1, 2]}
        camera={{ position: TP_CAMERA_POS, fov: 42 }}
      >
        <CompactBoardCamera enabled={compact} />

        {/* 조명 */}
        <ambientLight intensity={0.75} />
        <directionalLight
          position={[CENTER + 6, 10, CENTER - 5]}
          intensity={1.2}
          castShadow={!compact}
          shadow-mapSize-width={1024}
          shadow-mapSize-height={1024}
          shadow-camera-left={-8}
          shadow-camera-right={8}
          shadow-camera-top={8}
          shadow-camera-bottom={-8}
        />
        <hemisphereLight args={['#bfdbfe', '#a8a29e', 0.4]} />

        <BoardContents {...props} />

        {!compact && (
          <OrbitControls
            makeDefault
            target={[CENTER, 0, CENTER]}
            enablePan={false}
            enableZoom={false}
            maxPolarAngle={Math.PI * 0.44}
          />
        )}
      </Canvas>
    </div>
  );
};

export default GameBoard3D;
