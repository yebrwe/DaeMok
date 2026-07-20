'use client';

import React, { useMemo, useRef, useState, useCallback, useEffect } from 'react';
import { Canvas, useFrame, useThree, ThreeEvent } from '@react-three/fiber';
import { RoundedBox } from '@react-three/drei';
import * as THREE from 'three';
import {
  CollisionWall,
  Direction,
  GamePhase,
  ItemType,
  MapItem,
  Obstacle,
  Position,
  SpecialWallType,
} from '@/types/game';
import { BOARD_SIZE, isSamePosition, isWallItemType } from '@/lib/gameUtils';
import {
  applyMazeToonRendering,
  MAZE_TOON_RENDER_CONTRACT,
  uninstallMazeToonRendering,
} from '@/lib/mazeToonRendering';

// ===== 보드 배치 상수 =====
const TILE = 1; // 타일 한 변 크기
const GAP = 0.14; // 타일 사이 간격 (벽이 놓이는 자리)
const SPACING = TILE + GAP; // 셀 중심 간 거리
const WALL_HEIGHT = 0.5;
const WALL_THICKNESS = 0.16;
const CENTER = ((BOARD_SIZE - 1) * SPACING) / 2;

// 고정 직교 카메라: 방향 조작과 화면 방향이 항상 일치하는 토이 디오라마 시점
const SPAN = BOARD_SIZE * SPACING;
const ORTHO_CAMERA_POS: [number, number, number] = [CENTER, SPAN * 1.35, CENTER + SPAN * 1.45];
const BOARD_BACKGROUND = 'radial-gradient(circle at 50% 4%, #3f7377 0%, #24515b 48%, #112f3a 100%)';

// 색상 팔레트
const COLORS = {
  tileA: '#fffaf0',
  tileB: '#eff7df',
  tileHover: '#31b7a6',
  base: '#c7d7b3',
  baseSide: '#557568',
  wall: '#6b1111', // 2D 보드와 같은 짙은 적색 일반 벽
  wallPreview: '#b91c1c',
  collision: '#ff334f', // 충돌한 벽 (일반벽보다 밝은 빨강)
  reveal: '#991b1b', // 게임 종료 후 공개된 일반벽
  start: '#12a66a',
  end: '#d9365f',
  player: '#2674d9',
};

function usePrefersReducedMotion() {
  const [reducedMotion, setReducedMotion] = useState(false);

  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setReducedMotion(media.matches);
    update();
    media.addEventListener?.('change', update);
    return () => media.removeEventListener?.('change', update);
  }, []);

  return reducedMotion;
}

// 보드 위 액션 이펙트 (지뢰 폭발/웜홀/탐지 파동/충돌 스파크/골인 축포)
export interface BoardFx {
  key: number;
  type: 'bump' | 'mine' | 'wormhole' | 'radar' | 'goal' | 'fire' | 'poison';
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
    <RoundedBox
      args={[size[0], height, size[2]]}
      radius={Math.min(0.055, height * 0.16)}
      smoothness={3}
      position={[x, height / 2, z]}
      castShadow
      receiveShadow
    >
      <meshStandardMaterial
        color={color}
        emissive={color}
        emissiveIntensity={opacity < 1 ? 0.04 : 0.1}
        transparent={opacity < 1}
        opacity={opacity}
        roughness={0.74}
      />
    </RoundedBox>
  );
}

interface SpecialWallStyle {
  color: string;
  accent: string;
  emissive: string;
  emissiveIntensity: number;
  metalness: number;
  roughness: number;
  opacity: number;
  wireframe?: boolean;
}

const SPECIAL_WALL_STYLES: Record<SpecialWallType, SpecialWallStyle> = {
  steelWall: {
    color: '#526579', accent: '#d7e1e8', emissive: '#000000', emissiveIntensity: 0,
    metalness: 0.74, roughness: 0.34, opacity: 1,
  },
  fireWall: {
    color: '#d94b2b', accent: '#ffc43d', emissive: '#c73520', emissiveIntensity: 0.46,
    metalness: 0.03, roughness: 0.62, opacity: 0.96,
  },
  poisonWall: {
    color: '#4d8b21', accent: '#b7e33f', emissive: '#3f741b', emissiveIntensity: 0.14,
    metalness: 0, roughness: 0.78, opacity: 0.94,
  },
  iceWall: {
    color: '#3ba7c4', accent: '#e8fbff', emissive: '#237e9a', emissiveIntensity: 0.12,
    metalness: 0.08, roughness: 0.16, opacity: 0.84,
  },
  windWall: {
    color: '#168aa3', accent: '#e5fbff', emissive: '#0d677a', emissiveIntensity: 0.18,
    metalness: 0, roughness: 0.36, opacity: 0.72, wireframe: true,
  },
  collapseWall: {
    color: '#5a4335', accent: '#bf9a72', emissive: '#000000', emissiveIntensity: 0,
    metalness: 0.04, roughness: 1, opacity: 1,
  },
  phaseWall: {
    color: '#7048b6', accent: '#eb62c1', emissive: '#593296', emissiveIntensity: 0.32,
    metalness: 0.1, roughness: 0.34, opacity: 0.72,
  },
  mirrorWall: {
    color: '#81959d', accent: '#f2fbfb', emissive: '#52676e', emissiveIntensity: 0.04,
    metalness: 0.82, roughness: 0.08, opacity: 0.96,
  },
  thornWall: {
    color: '#b72b4d', accent: '#ff9d94', emissive: '#821b35', emissiveIntensity: 0.08,
    metalness: 0.04, roughness: 0.84, opacity: 1,
  },
  crystalWall: {
    color: '#008e83', accent: '#f064b5', emissive: '#006c65', emissiveIntensity: 0.32,
    metalness: 0.14, roughness: 0.26, opacity: 0.9,
  },
};

function SpecialWallBox({
  seg,
  type,
  consumed = false,
  active = false,
  phaseOpen = false,
  reducedMotion = false,
}: {
  seg: WallSegment;
  type: SpecialWallType;
  consumed?: boolean;
  active?: boolean;
  phaseOpen?: boolean;
  reducedMotion?: boolean;
}) {
  const style = SPECIAL_WALL_STYLES[type];
  const bodyMaterialRef = useRef<THREE.MeshPhysicalMaterial>(null);
  const accentMaterialRef = useRef<THREE.MeshStandardMaterial>(null);
  const [x, , z] = segmentToWorld(seg);
  const size = segmentSize(seg);
  const inactiveCollapse = type === 'collapseWall' && !active && !consumed;
  const openedPhase = type === 'phaseWall' && phaseOpen && !consumed;
  const height = consumed
    ? WALL_HEIGHT * 0.34
    : inactiveCollapse
      ? WALL_HEIGHT * 0.24
      : WALL_HEIGHT;
  const opacity = consumed
    ? Math.min(style.opacity, 0.3)
    : openedPhase
      ? Math.min(style.opacity, 0.16)
      : inactiveCollapse
        ? Math.min(style.opacity, 0.58)
        : style.opacity;
  const length = seg.type === 'H' ? size[0] : size[2];
  const detailOffsets = [-length * 0.31, 0, length * 0.31];
  const detailedCrystals = type === 'iceWall' || type === 'crystalWall';
  const detailedCones = type === 'fireWall' || type === 'thornWall';
  const detailedRivets = type === 'steelWall' || type === 'poisonWall';

  useFrame((state) => {
    const body = bodyMaterialRef.current;
    const accent = accentMaterialRef.current;
    if (!body || !accent) return;

    const baseBody = consumed ? 0 : style.emissiveIntensity;
    const baseAccent = consumed ? 0 : style.emissiveIntensity * 0.55;
    if (reducedMotion || consumed || style.emissiveIntensity === 0) {
      body.emissiveIntensity = baseBody;
      accent.emissiveIntensity = baseAccent;
      body.opacity = opacity;
      accent.opacity = opacity;
      return;
    }

    const speed = type === 'fireWall'
      ? 7
      : type === 'windWall'
        ? 4.5
        : type === 'crystalWall'
          ? 3.8
          : type === 'phaseWall'
            ? 2.6
            : 2.1;
    const wave = (Math.sin(state.clock.elapsedTime * speed) + 1) / 2;
    const strength = type === 'fireWall' || type === 'crystalWall' ? 0.9 : 0.48;
    body.emissiveIntensity = baseBody * (0.72 + wave * strength);
    accent.emissiveIntensity = baseAccent * (0.8 + wave * 1.1);

    if (type === 'windWall' || type === 'phaseWall') {
      const opacityWave = type === 'phaseWall' ? 0.38 + wave * 0.62 : 0.72 + wave * 0.28;
      body.opacity = Math.min(1, opacity * opacityWave);
      accent.opacity = Math.min(1, opacity * (0.78 + wave * 0.22));
    } else {
      body.opacity = opacity;
      accent.opacity = opacity;
    }
  });

  const detailPosition = (offset: number, y: number): [number, number, number] =>
    seg.type === 'H' ? [x + offset, y, z] : [x, y, z + offset];

  return (
    <group name={`${type}:${consumed ? 'consumed' : inactiveCollapse ? 'armed' : openedPhase ? 'open' : 'closed'}`}>
      <RoundedBox
        args={[size[0], height, size[2]]}
        radius={Math.min(0.052, height * 0.16)}
        smoothness={3}
        position={[x, height / 2, z]}
        castShadow={!consumed}
        receiveShadow
      >
        <meshPhysicalMaterial
          ref={bodyMaterialRef}
          color={style.color}
          emissive={style.emissive}
          emissiveIntensity={consumed ? 0 : style.emissiveIntensity}
          metalness={style.metalness}
          roughness={style.roughness}
          clearcoat={type === 'mirrorWall' || type === 'iceWall' ? 1 : 0.15}
          clearcoatRoughness={type === 'mirrorWall' ? 0.02 : 0.2}
          transparent={opacity < 1}
          opacity={opacity}
          depthWrite={opacity >= 0.7}
          wireframe={style.wireframe || openedPhase}
        />
      </RoundedBox>

      <RoundedBox
        args={seg.type === 'H'
          ? [size[0] * 0.82, 0.05, WALL_THICKNESS * 0.55]
          : [WALL_THICKNESS * 0.55, 0.05, size[2] * 0.82]}
        radius={0.018}
        smoothness={2}
        position={[x, height + 0.025, z]}
        castShadow={false}
      >
        <meshStandardMaterial
          ref={accentMaterialRef}
          color={style.accent}
          emissive={style.emissive}
          emissiveIntensity={consumed ? 0 : style.emissiveIntensity * 0.55}
          transparent={opacity < 1}
          opacity={opacity}
          roughness={style.roughness}
          metalness={style.metalness}
        />
      </RoundedBox>

      {!consumed && detailedCrystals && detailOffsets.map((offset) => (
        <mesh key={`crystal-${offset}`} position={detailPosition(offset, height + 0.11)}>
          <octahedronGeometry args={[type === 'iceWall' ? 0.075 : 0.09, 0]} />
          <meshStandardMaterial
            color={style.accent}
            emissive={style.emissive}
            emissiveIntensity={style.emissiveIntensity}
            roughness={style.roughness}
          />
        </mesh>
      ))}

      {!consumed && detailedCones && detailOffsets.map((offset) => (
        <mesh key={`cone-${offset}`} position={detailPosition(offset, height + 0.1)}>
          <coneGeometry args={[0.075, 0.2, type === 'thornWall' ? 5 : 8]} />
          <meshStandardMaterial
            color={style.accent}
            emissive={style.emissive}
            emissiveIntensity={style.emissiveIntensity}
            roughness={style.roughness}
          />
        </mesh>
      ))}

      {!consumed && detailedRivets && detailOffsets.map((offset) => (
        <mesh key={`rivet-${offset}`} position={detailPosition(offset, height + 0.075)}>
          <sphereGeometry args={[type === 'steelWall' ? 0.055 : 0.07, 10, 8]} />
          <meshStandardMaterial
            color={style.accent}
            emissive={style.emissive}
            emissiveIntensity={style.emissiveIntensity}
            roughness={style.roughness}
            metalness={style.metalness}
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
  reducedMotion = false,
  goalLocked = false,
}: {
  position: Position;
  selectable: boolean;
  selectionMode: 'start' | 'end' | 'none';
  isStart: boolean;
  isEnd: boolean;
  onCellClick?: (p: Position) => void;
  placeMode?: 'wall' | ItemType;
  isPendingEntrance?: boolean;
  reducedMotion?: boolean;
  goalLocked?: boolean;
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
      <RoundedBox
        args={[TILE, 0.16, TILE]}
        radius={0.065}
        smoothness={3}
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
        <meshStandardMaterial color={color} roughness={0.88} />
      </RoundedBox>

      {/* 시작점 패드 (은은한 펄스) */}
      {isStart && <StartPad reducedMotion={reducedMotion} />}

      {/* 도착점 패드 + 펄럭이는 깃발 */}
      {isEnd && <GoalFlag reducedMotion={reducedMotion} locked={goalLocked} />}

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
function StartPad({ reducedMotion = false }: { reducedMotion?: boolean }) {
  const matRef = useRef<THREE.MeshStandardMaterial>(null);
  useFrame((state) => {
    if (matRef.current) {
      matRef.current.emissiveIntensity = reducedMotion
        ? 0.25
        : 0.2 + Math.abs(Math.sin(state.clock.elapsedTime * 1.6)) * 0.25;
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
function GoalFlag({ reducedMotion = false, locked = false }: { reducedMotion?: boolean; locked?: boolean }) {
  const flagRef = useRef<THREE.Mesh>(null);
  useFrame((state) => {
    if (flagRef.current) {
      flagRef.current.rotation.y = reducedMotion ? 0 : Math.sin(state.clock.elapsedTime * 2.4) * 0.35;
    }
  });
  return (
    <group position={[0, 0.09, 0]}>
      <mesh receiveShadow>
        <cylinderGeometry args={[0.36, 0.36, 0.05, 32]} />
        <meshStandardMaterial
          color={locked ? '#6b4b7a' : COLORS.end}
          emissive={locked ? '#7e22ce' : COLORS.end}
          emissiveIntensity={locked ? 0.12 : 0.2}
        />
      </mesh>
      <mesh position={[0, 0.4, 0]} castShadow>
        <cylinderGeometry args={[0.03, 0.03, 0.8, 8]} />
        <meshStandardMaterial color="#78716c" />
      </mesh>
      <group position={[0, 0.66, 0]}>
        <mesh ref={flagRef} position={[0.16, 0, 0]} castShadow>
          <boxGeometry args={[0.32, 0.2, 0.02]} />
          <meshStandardMaterial color={locked ? '#a78bfa' : COLORS.end} side={THREE.DoubleSide} />
        </mesh>
      </group>
      {locked && (
        <mesh position={[0, 0.23, 0]} rotation={[Math.PI / 2, 0, 0]}>
          <torusGeometry args={[0.17, 0.045, 10, 22]} />
          <meshStandardMaterial color="#c4b5fd" emissive="#7c3aed" emissiveIntensity={0.45} />
        </mesh>
      )}
    </group>
  );
}

function WormholeSealMarker({ position, activated }: { position: Position; activated: boolean }) {
  const [x, , z] = cellToWorld(position);
  return (
    <group position={[x, 0.26, z]}>
      <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <torusGeometry args={[0.24, 0.045, 10, 28]} />
        <meshStandardMaterial
          color={activated ? '#34d399' : '#e879f9'}
          emissive={activated ? '#059669' : '#a21caf'}
          emissiveIntensity={activated ? 0.35 : 0.7}
          transparent
          opacity={activated ? 0.52 : 0.94}
        />
      </mesh>
      <mesh position={[0, 0.08, 0]} rotation={[0, Math.PI / 4, 0]} castShadow={!activated}>
        <octahedronGeometry args={[0.15, 0]} />
        <meshStandardMaterial
          color={activated ? '#a7f3d0' : '#f5d0fe'}
          emissive={activated ? '#10b981' : '#d946ef'}
          emissiveIntensity={activated ? 0.2 : 0.75}
          transparent
          opacity={activated ? 0.45 : 1}
        />
      </mesh>
    </group>
  );
}

const FIRE_AURA_POINTS: Array<[number, number, number]> = [
  [-0.19, 0.24, 0.08],
  [0.2, 0.28, 0.03],
  [-0.12, 0.5, -0.08],
  [0.13, 0.56, 0.03],
  [0, 0.75, -0.08],
];

function PawnFireAura({ reducedMotion = false }: { reducedMotion?: boolean }) {
  const flameRefs = useRef<Array<THREE.Group | null>>([]);

  useFrame((state) => {
    flameRefs.current.forEach((flame, index) => {
      if (!flame) return;
      if (reducedMotion) {
        flame.position.y = FIRE_AURA_POINTS[index][1];
        flame.scale.setScalar(1);
        return;
      }
      const phase = state.clock.elapsedTime * 8.5 + index * 1.7;
      flame.position.y = FIRE_AURA_POINTS[index][1] + Math.sin(phase) * 0.035;
      flame.scale.set(0.84 + Math.sin(phase * 1.19) * 0.13, 0.92 + Math.cos(phase) * 0.18, 0.84);
    });
  });

  return (
    <group name="maze-toon-effect-fire-status">
      {FIRE_AURA_POINTS.map(([x, y, z], index) => (
        <group
          key={`pawn-fire-${index}`}
          ref={(element) => { flameRefs.current[index] = element; }}
          position={[x, y, z]}
          rotation={[0, index * 1.31, index % 2 === 0 ? -0.12 : 0.12]}
        >
          <mesh position={[0, 0.085, 0]}>
            <coneGeometry args={[0.105, 0.28, 9]} />
            <meshStandardMaterial
              color="#ff5a1f"
              emissive="#f97316"
              emissiveIntensity={1.8}
              transparent
              opacity={0.88}
              depthWrite={false}
            />
          </mesh>
          <mesh position={[0, 0.035, 0.012]}>
            <coneGeometry args={[0.052, 0.16, 8]} />
            <meshStandardMaterial
              color="#fde047"
              emissive="#facc15"
              emissiveIntensity={2.2}
              transparent
              opacity={0.96}
              depthWrite={false}
            />
          </mesh>
        </group>
      ))}
    </group>
  );
}

const POISON_AURA_POINTS: Array<[number, number, number, number]> = [
  [-0.24, 0.2, 0.06, 0.065],
  [0.23, 0.31, -0.04, 0.08],
  [-0.17, 0.52, -0.1, 0.055],
  [0.17, 0.62, 0.02, 0.07],
  [0.02, 0.82, -0.08, 0.045],
];

function PawnPoisonAura({ reducedMotion = false }: { reducedMotion?: boolean }) {
  const bubbleRefs = useRef<Array<THREE.Mesh | null>>([]);
  const mistRef = useRef<THREE.Mesh>(null);

  useFrame((state) => {
    const time = state.clock.elapsedTime;
    bubbleRefs.current.forEach((bubble, index) => {
      if (!bubble) return;
      const [baseX, baseY, baseZ] = POISON_AURA_POINTS[index];
      if (reducedMotion) {
        bubble.position.set(baseX, baseY, baseZ);
        bubble.scale.setScalar(1);
        return;
      }
      const phase = time * 2.7 + index * 1.53;
      bubble.position.set(
        baseX + Math.sin(phase * 0.83) * 0.035,
        baseY + Math.sin(phase) * 0.1,
        baseZ + Math.cos(phase * 0.71) * 0.03,
      );
      bubble.scale.setScalar(0.78 + (Math.sin(phase * 1.4) + 1) * 0.18);
    });
    if (mistRef.current) {
      mistRef.current.rotation.z = reducedMotion ? 0 : time * 0.32;
      mistRef.current.scale.setScalar(reducedMotion ? 1 : 0.92 + Math.sin(time * 2.2) * 0.08);
    }
  });

  return (
    <group name="maze-toon-effect-poison-status">
      <mesh ref={mistRef} position={[0, 0.17, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <torusGeometry args={[0.25, 0.09, 10, 24]} />
        <meshStandardMaterial
          color="#65a30d"
          emissive="#4d7c0f"
          emissiveIntensity={0.75}
          transparent
          opacity={0.38}
          depthWrite={false}
        />
      </mesh>
      {POISON_AURA_POINTS.map(([x, y, z, radius], index) => (
        <mesh
          key={`pawn-poison-${index}`}
          ref={(element) => { bubbleRefs.current[index] = element; }}
          position={[x, y, z]}
        >
          <sphereGeometry args={[radius, 12, 10]} />
          <meshStandardMaterial
            color={index % 2 === 0 ? '#a3e635' : '#4ade80'}
            emissive="#3f6212"
            emissiveIntensity={0.9}
            transparent
            opacity={0.68}
            depthWrite={false}
          />
        </mesh>
      ))}
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
  fireAffected = false,
  poisonAffected = false,
  reducedMotion = false,
}: {
  position: Position;
  via?: Position[] | null; // 경유지 - 지뢰 넉백(뒤로 폴짝 2번) 등 경로 이동
  color: string;
  fx?: BoardFx | null;
  celebrating?: boolean;
  fireAffected?: boolean;
  poisonAffected?: boolean;
  reducedMotion?: boolean;
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
  const viaKey = (via ?? []).map((point) => `${point.row},${point.col}`).join('|');
  const waypoints = useMemo(() => {
    return [...(via ?? []), position].map((p) => {
      const [x, , z] = cellToWorld(p);
      return new THREE.Vector3(x, 0, z);
    });
    // Coordinates, rather than Firebase object identity, define an animation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [position.row, position.col, viaKey]);

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

    if (reducedMotion && transitRef.current) {
      transitRef.current = null;
      wormholePendingRef.current = false;
      inner.position.set(0, 0, 0);
      inner.rotation.set(0, yawRef.current, 0);
      inner.scale.set(1, 1, 1);
    }

    // 이펙트 트리거 감지
    if (fx && fx.key !== lastFxKeyRef.current) {
      lastFxKeyRef.current = fx.key;
      if (fx.type === 'bump') bumpUntilRef.current = now + 0.5;
      if (fx.type === 'wormhole' && !reducedMotion) wormholePendingRef.current = true;
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
    const transit = reducedMotion ? null : transitRef.current;
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
    if (reducedMotion) {
      outer.position.copy(target);
      dist = 0;
    } else if (dist > SPACING * 1.6) {
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
    const hop = reducedMotion ? 0 : Math.sin(Math.min(dist / SPACING, 1) * Math.PI) * 0.34;
    const idle = reducedMotion || dist >= 0.02 ? 0 : Math.abs(Math.sin(now * 2.2)) * 0.03;
    let y = hop + idle;

    // 골인 세리머니: 빙글빙글 + 폴짝폴짝
    if (celebrating && !reducedMotion) {
      inner.rotation.y += delta * 7;
      y += Math.abs(Math.sin(now * 6)) * 0.35;
    }

    // 충돌 부들부들
    let jx = 0;
    let jz = 0;
    if (!reducedMotion && now < bumpUntilRef.current) {
      const k = (bumpUntilRef.current - now) / 0.5;
      jx = Math.sin(now * 55) * 0.06 * k;
      jz = Math.cos(now * 43) * 0.05 * k;
    }

    // 순간이동 팝 (작아졌다 커지며 등장)
    let scale = 1;
    if (!reducedMotion && now < popUntilRef.current) {
      const p = 1 - (popUntilRef.current - now) / 0.4;
      scale = 0.3 + 0.7 * (1 - Math.pow(1 - p, 2));
    }

    let statusTiltX = 0;
    let statusTiltZ = 0;
    if (!reducedMotion && fireAffected && !celebrating) {
      // 화염 상태에서는 열기를 떨쳐 내듯 빠르게 몸을 턴다.
      jx += Math.sin(now * 21) * 0.035;
      jz += Math.cos(now * 17) * 0.025;
      y += Math.abs(Math.sin(now * 10)) * 0.045;
      statusTiltX += Math.cos(now * 13) * 0.075;
      statusTiltZ += Math.sin(now * 17) * 0.13;
    }
    if (!reducedMotion && poisonAffected && !celebrating) {
      // 중독 상태는 빠른 떨림과 구분되는 느린 비틀거림으로 보인다.
      jx += Math.sin(now * 3.1) * 0.055;
      jz += Math.cos(now * 2.7) * 0.04;
      statusTiltX += Math.cos(now * 2.4) * 0.08;
      statusTiltZ += Math.sin(now * 3.2) * 0.17;
    }

    inner.position.set(jx, y, jz);
    inner.rotation.x = statusTiltX;
    inner.rotation.z = statusTiltZ;
    inner.scale.setScalar(scale);

    // 숨쉬기 스쿼시
    const breathe = !reducedMotion && dist < 0.02 && !celebrating ? 1 + Math.sin(now * 2.2) * 0.02 : 1;
    inner.scale.y = scale * breathe;
  });

  return (
    <group name="maze-toon-actor-pawn" ref={outerRef} position={initialPosRef.current}>
      <group ref={innerRef}>
        {/* 둥근 귀와 팔다리를 더한 작은 원목 동물 말 */}
        <mesh position={[0.115, 0.79, 0]} scale={[0.72, 1.05, 0.72]} castShadow>
          <sphereGeometry args={[0.09, 16, 12]} />
          <meshStandardMaterial color={color} roughness={0.78} />
        </mesh>
        <mesh position={[-0.115, 0.79, 0]} scale={[0.72, 1.05, 0.72]} castShadow>
          <sphereGeometry args={[0.09, 16, 12]} />
          <meshStandardMaterial color={color} roughness={0.78} />
        </mesh>
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
        {/* 주둥이와 코 */}
        <mesh position={[0, 0.61, 0.155]} scale={[1.25, 0.78, 0.58]}>
          <sphereGeometry args={[0.085, 14, 10]} />
          <meshStandardMaterial color="#ffe8cf" roughness={0.9} />
        </mesh>
        <mesh position={[0, 0.645, 0.204]}>
          <sphereGeometry args={[0.025, 10, 8]} />
          <meshStandardMaterial color="#59443e" roughness={0.85} />
        </mesh>
        {/* 짧은 팔과 발 */}
        <mesh position={[0.2, 0.38, 0.025]} scale={[0.65, 1.25, 0.65]} rotation={[0, 0, -0.35]} castShadow>
          <sphereGeometry args={[0.075, 12, 10]} />
          <meshStandardMaterial color={color} roughness={0.8} />
        </mesh>
        <mesh position={[-0.2, 0.38, 0.025]} scale={[0.65, 1.25, 0.65]} rotation={[0, 0, 0.35]} castShadow>
          <sphereGeometry args={[0.075, 12, 10]} />
          <meshStandardMaterial color={color} roughness={0.8} />
        </mesh>
        <mesh position={[0.105, 0.115, 0.08]} scale={[1.1, 0.55, 1.35]} castShadow>
          <sphereGeometry args={[0.09, 12, 10]} />
          <meshStandardMaterial color="#ffe8cf" roughness={0.9} />
        </mesh>
        <mesh position={[-0.105, 0.115, 0.08]} scale={[1.1, 0.55, 1.35]} castShadow>
          <sphereGeometry args={[0.09, 12, 10]} />
          <meshStandardMaterial color="#ffe8cf" roughness={0.9} />
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
        {fireAffected && <PawnFireAura reducedMotion={reducedMotion} />}
        {poisonAffected && <PawnPoisonAura reducedMotion={reducedMotion} />}
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
function MineExplosionFX({ at, delay = 0, reducedMotion = false }: { at: Position; delay?: number; reducedMotion?: boolean }) {
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
      fireRef.current.scale.setScalar(reducedMotion ? 0.85 : 0.2 + p * 1.6);
      fireMatRef.current.opacity = Math.max(0, 0.95 * (1 - p * 1.2));
    }
    debrisRefs.current.forEach((m, i) => {
      if (!m) return;
      if (reducedMotion) return;
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
function WormholeFX({ at, to, delay = 0, reducedMotion = false }: { at: Position; to?: Position; delay?: number; reducedMotion?: boolean }) {
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
      inRef.current.scale.setScalar(reducedMotion ? 1 : 0.4 + p1 * 2.2);
      if (!reducedMotion) inRef.current.rotation.z += 0.15;
      inMat.current.opacity = t < 0 ? 0 : Math.max(0, 0.9 * (1 - p1));
    }
    // 출구 링: 말이 솟아나오는 시점(흡입 완료 후)에 확장
    const p2 = Math.max(0, Math.min(1, (t - 0.5) / 0.6));
    if (outRef.current && outMat.current) {
      outRef.current.scale.setScalar(reducedMotion ? 1 : 0.4 + p2 * 2.2);
      if (!reducedMotion) outRef.current.rotation.z -= 0.15;
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
function RadarFX({ at, reducedMotion = false }: { at: Position; reducedMotion?: boolean }) {
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
      const r = reducedMotion ? SPACING : 0.3 + p * SPACING * 2.2;
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
function BumpFX({ at, dir, reducedMotion = false }: { at: Position; dir?: Direction; reducedMotion?: boolean }) {
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
      if (reducedMotion) {
        m.scale.setScalar(Math.max(0.01, 1 - t / LIFE));
        return;
      }
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

function ElementalBurstFX({
  at,
  dir,
  kind,
  delay = 0,
  reducedMotion = false,
}: {
  at: Position;
  dir?: Direction;
  kind: 'fire' | 'poison';
  delay?: number;
  reducedMotion?: boolean;
}) {
  const [x, , z] = cellToWorld(at);
  const offset = dir ? DIR_VECTOR[dir] : [0, 0];
  const px = x + offset[0] * (SPACING / 2);
  const pz = z + offset[1] * (SPACING / 2);
  const coreRef = useRef<THREE.Mesh>(null);
  const coreMaterialRef = useRef<THREE.MeshStandardMaterial>(null);
  const particleRefs = useRef<Array<THREE.Mesh | null>>([]);
  const startRef = useRef<number | null>(null);
  const [started, setStarted] = useState(delay === 0);
  const [done, setDone] = useState(false);
  const life = kind === 'fire' ? 0.82 : 1.05;

  useFrame((state, delta) => {
    if (startRef.current === null) startRef.current = state.clock.elapsedTime;
    const elapsed = state.clock.elapsedTime - startRef.current - delay;
    if (elapsed < 0) return;
    if (!started) setStarted(true);
    if (elapsed > life) {
      if (!done) setDone(true);
      return;
    }

    const progress = Math.max(0, Math.min(1, elapsed / life));
    if (coreRef.current && coreMaterialRef.current) {
      const baseScale = reducedMotion ? 0.9 : 0.28 + progress * (kind === 'fire' ? 1.9 : 1.45);
      coreRef.current.scale.setScalar(baseScale);
      coreMaterialRef.current.opacity = Math.max(0, (kind === 'fire' ? 0.88 : 0.62) * (1 - progress));
    }
    particleRefs.current.forEach((particle, index) => {
      if (!particle) return;
      if (reducedMotion) {
        particle.scale.setScalar(Math.max(0.05, 1 - progress));
        return;
      }
      const vector = BURST_DIRS[index % BURST_DIRS.length];
      const speed = kind === 'fire' ? 1.25 : 0.62;
      particle.position.x += vector[0] * delta * speed;
      particle.position.z += vector[2] * delta * speed;
      particle.position.y = kind === 'fire'
        ? Math.max(0.02, 0.18 + vector[1] * elapsed - 3.2 * elapsed * elapsed)
        : 0.12 + vector[1] * elapsed * 0.36;
      particle.scale.setScalar(Math.max(0.04, 1 - progress * 0.82));
    });
  });

  if (done) return null;

  const coreColor = kind === 'fire' ? '#ff5a1f' : '#65a30d';
  const glowColor = kind === 'fire' ? '#facc15' : '#a3e635';
  return (
    <group
      name={`maze-toon-effect-${kind}-burst`}
      position={[px, 0.26, pz]}
      visible={started}
    >
      <mesh ref={coreRef}>
        <sphereGeometry args={[kind === 'fire' ? 0.24 : 0.28, 18, 14]} />
        <meshStandardMaterial
          ref={coreMaterialRef}
          color={coreColor}
          emissive={coreColor}
          emissiveIntensity={kind === 'fire' ? 2 : 1.2}
          transparent
          opacity={kind === 'fire' ? 0.88 : 0.62}
          depthWrite={false}
        />
      </mesh>
      {BURST_DIRS.map((_, index) => (
        <mesh
          key={`${kind}-particle-${index}`}
          ref={(element) => { particleRefs.current[index] = element; }}
          position={[0, 0.08, 0]}
          rotation={kind === 'fire' ? [0, 0, index * 0.39] : undefined}
        >
          {kind === 'fire'
            ? <coneGeometry args={[0.055, 0.16, 7]} />
            : <sphereGeometry args={[0.065 + (index % 3) * 0.012, 10, 8]} />}
          <meshStandardMaterial
            color={index % 2 === 0 ? glowColor : coreColor}
            emissive={coreColor}
            emissiveIntensity={kind === 'fire' ? 1.8 : 0.9}
            transparent
            opacity={0.88}
            depthWrite={false}
          />
        </mesh>
      ))}
    </group>
  );
}

// 골인: 도착점에서 터지는 축포
function GoalFX({ at, reducedMotion = false }: { at: Position; reducedMotion?: boolean }) {
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
      if (reducedMotion) return;
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

function FxLayer({ fx, reducedMotion = false }: { fx?: BoardFx | null; reducedMotion?: boolean }) {
  if (!fx || !fx.at) return null;
  let effect: React.ReactNode = null;
  switch (fx.type) {
    case 'mine':
      effect = <MineExplosionFX key={fx.key} at={fx.at} delay={fx.delay ?? 0} reducedMotion={reducedMotion} />;
      break;
    case 'wormhole':
      effect = <WormholeFX key={fx.key} at={fx.at} to={fx.to} delay={fx.delay ?? 0} reducedMotion={reducedMotion} />;
      break;
    case 'radar':
      effect = <RadarFX key={fx.key} at={fx.at} reducedMotion={reducedMotion} />;
      break;
    case 'bump':
      effect = <BumpFX key={fx.key} at={fx.at} dir={fx.dir} reducedMotion={reducedMotion} />;
      break;
    case 'fire':
      effect = <ElementalBurstFX key={fx.key} at={fx.at} dir={fx.dir} kind="fire" delay={fx.delay ?? 0} reducedMotion={reducedMotion} />;
      break;
    case 'poison':
      effect = <ElementalBurstFX key={fx.key} at={fx.at} dir={fx.dir} kind="poison" delay={fx.delay ?? 0} reducedMotion={reducedMotion} />;
      break;
    case 'goal':
      effect = <GoalFX key={fx.key} at={fx.at} reducedMotion={reducedMotion} />;
      break;
    default:
      return null;
  }
  return <group name="maze-toon-effect-action">{effect}</group>;
}

// ===== 맵 아이템 표시 =====
function ItemVisuals({
  item,
  consumed,
  active,
  phaseOpen,
  visible,
  setup,
  revealObstacles,
  collided,
  reducedMotion = false,
}: {
  item: MapItem;
  consumed: boolean;
  active: boolean;
  phaseOpen: boolean;
  visible: boolean;
  setup: boolean;
  revealObstacles: boolean;
  collided: boolean;
  reducedMotion?: boolean;
}) {
  if (!visible) return null;

  if (item.type === 'oneTimeWall' && item.wallPosition && item.wallDirection) {
    const seg = obstacleToSegment(item.wallPosition, item.wallDirection);
    if (!seg) return null;
    // 가짜벽은 어느 시점에서도 별도 재질이나 형상을 갖지 않는다. 일반벽이
    // 숨겨진 동안 함께 숨고, 설정/공개/충돌 레이어도 같은 WallBox 인자를 쓴다.
    if (consumed || collided || (!setup && !revealObstacles)) return null;
    return setup
      ? <WallBox seg={seg} color={COLORS.wall} />
      : <WallBox seg={seg} color={COLORS.reveal} opacity={0.75} />;
  }

  if (
    isWallItemType(item.type) &&
    item.type !== 'oneTimeWall' &&
    item.wallPosition &&
    item.wallDirection
  ) {
    const seg = obstacleToSegment(item.wallPosition, item.wallDirection);
    return seg ? (
      <SpecialWallBox
        seg={seg}
        type={item.type}
        consumed={consumed}
        active={active}
        phaseOpen={phaseOpen}
        reducedMotion={reducedMotion}
      />
    ) : null;
  }

  if (item.type === 'mine' && item.position) {
    return <MineVisual position={item.position} consumed={consumed} reducedMotion={reducedMotion} />;
  }

  if (item.type === 'smoke' && item.position) {
    return <SmokeVisual position={item.position} consumed={consumed} />;
  }

  if (item.type === 'wormhole' && item.entrance && item.exit) {
    return <WormholeVisual entrance={item.entrance} exit={item.exit} consumed={consumed} reducedMotion={reducedMotion} />;
  }

  return null;
}

function MineVisual({ position, consumed, reducedMotion = false }: { position: Position; consumed: boolean; reducedMotion?: boolean }) {
  const lampRef = useRef<THREE.MeshStandardMaterial>(null);
  const [x, , z] = cellToWorld(position);

  useFrame((state) => {
    if (lampRef.current) {
      lampRef.current.emissiveIntensity = reducedMotion
        ? 0.72
        : 0.4 + Math.abs(Math.sin(state.clock.elapsedTime * 3)) * 1.2;
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

function WormholeVisual({ entrance, exit, consumed, reducedMotion = false }: { entrance: Position; exit: Position; consumed: boolean; reducedMotion?: boolean }) {
  const entranceRef = useRef<THREE.Group>(null);
  const exitRef = useRef<THREE.Group>(null);
  const [ex, , ez] = cellToWorld(entrance);
  const [xx, , xz] = cellToWorld(exit);
  const opacity = consumed ? 0.35 : 0.9;

  useFrame((_, delta) => {
    if (reducedMotion) return;
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
interface GameBoard3DProps {
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
  pawnColor?: string; // 말 색상 (기본 파랑, 관전 시 상대 말은 빨강)
  items?: MapItem[] | null;
  itemsConsumed?: Record<number, boolean> | null; // 인덱스별 사용 여부
  itemActiveWalls?: Record<number, boolean> | null;
  itemPhaseOpen?: Record<number, boolean> | null;
  revealedWalls?: Obstacle[]; // 탐지기로 밝혀낸 벽들
  heatWalls?: Obstacle[]; // 화염 상태의 열기 환영. 공개 벽과 완전히 같은 외형으로 그린다.
  placeMode?: 'wall' | ItemType;
  pendingCell?: Position | null;
  fx?: BoardFx | null; // 액션 이펙트
  pawnVia?: Position[] | null; // 말 이동 경유지 (지뢰 넉백 등 경로 연출)
  celebrating?: boolean; // 골인 세리머니
  fullscreen?: boolean;
  heightClassName?: string;
  compact?: boolean; // 동시 보드용 저비용 렌더링
  challengeSeals?: Position[];
  challengeActivatedSeals?: Record<number, boolean> | null;
  wormholeChallenge?: boolean;
  fireAffected?: boolean;
  poisonAffected?: boolean;
}

function FixedBoardCamera({ compact }: { compact: boolean }) {
  const { camera, gl, size } = useThree();

  useEffect(() => {
    if (!(camera instanceof THREE.OrthographicCamera)) return;

    const boardWidth = BOARD_SIZE * SPACING - GAP + (compact ? 1.25 : 1.5);
    const projectedBoardHeight = (BOARD_SIZE * SPACING - GAP) * 0.72 + (compact ? 1.45 : 1.7);
    const usableWidth = size.width * (compact ? 0.9 : 0.88);
    const usableHeight = size.height * (compact ? 0.88 : 0.84);
    const nextZoom = Math.max(
      8,
      Math.min(usableWidth / boardWidth, usableHeight / projectedBoardHeight),
    );

    camera.position.set(...ORTHO_CAMERA_POS);
    camera.lookAt(CENTER, 0, CENTER);
    camera.zoom = nextZoom;
    camera.near = 0.1;
    camera.far = 80;
    camera.updateProjectionMatrix();
    gl.domElement.dataset.mazeCamera = 'fixed-orthographic';
    gl.domElement.dataset.mazeCameraZoom = nextZoom.toFixed(2);
  }, [camera, compact, gl, size.height, size.width]);

  useEffect(() => () => {
    delete gl.domElement.dataset.mazeCamera;
    delete gl.domElement.dataset.mazeCameraZoom;
  }, [gl]);

  return null;
}

function ResponsiveBoardQuality({ compact }: { compact: boolean }) {
  const gl = useThree((state) => state.gl);
  const size = useThree((state) => state.size);
  const setDpr = useThree((state) => state.setDpr);

  useEffect(() => {
    const deviceDpr = typeof window === 'undefined' ? 1 : window.devicePixelRatio;
    const maximumDpr = compact ? 1.25 : size.width <= 700 ? 1.5 : 2;
    const dpr = Math.max(1, Math.min(deviceDpr || 1, maximumDpr));
    setDpr(dpr);
    gl.domElement.dataset.mazeRenderDpr = dpr.toFixed(2);
    gl.domElement.dataset.mazeRenderQuality = compact ? 'compact' : 'full';
    return () => {
      delete gl.domElement.dataset.mazeRenderDpr;
      delete gl.domElement.dataset.mazeRenderQuality;
    };
  }, [compact, gl, setDpr, size.width]);

  return null;
}

function MazeToonRenderController() {
  const gl = useThree((state) => state.gl);
  const scene = useThree((state) => state.scene);
  const elapsed = useRef(0);

  const reconcile = useCallback(() => {
    const diagnostics = applyMazeToonRendering(scene);
    gl.domElement.dataset.mazeToonVersion = MAZE_TOON_RENDER_CONTRACT.version;
    gl.domElement.dataset.mazeToonMaterials = String(diagnostics.materialCount);
    gl.domElement.dataset.mazeToonDrawCalls = String(gl.info.render.calls);
  }, [gl, scene]);

  useEffect(() => {
    reconcile();
    const initialFrame = window.requestAnimationFrame(reconcile);
    return () => {
      window.cancelAnimationFrame(initialFrame);
      uninstallMazeToonRendering(scene);
      delete gl.domElement.dataset.mazeToonVersion;
      delete gl.domElement.dataset.mazeToonMaterials;
      delete gl.domElement.dataset.mazeToonDrawCalls;
    };
  }, [gl, reconcile, scene]);

  useFrame((_, delta) => {
    elapsed.current += delta;
    if (elapsed.current < 0.1) return;
    elapsed.current = 0;
    reconcile();
  });

  return null;
}

const BoardContents: React.FC<GameBoard3DProps & { reducedMotion?: boolean }> = ({
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
  pawnColor,
  items = null,
  itemsConsumed = null,
  itemActiveWalls = null,
  itemPhaseOpen = null,
  revealedWalls = [],
  heatWalls = [],
  placeMode = 'wall',
  pendingCell = null,
  fx = null,
  pawnVia = null,
  celebrating = false,
  challengeSeals = [],
  challengeActivatedSeals = null,
  wormholeChallenge = false,
  fireAffected = false,
  poisonAffected = false,
  reducedMotion = false,
}) => {
  const isSetup = gamePhase === GamePhase.SETUP;

  const obstacleSegments = dedupeSegments(obstacles || []);
  const collisionSegments = dedupeSegments(collisionWalls || []);
  // 열기 환영은 탐지/공개 벽과 같은 변환 및 WallBox를 공유해야 진짜 벽과
  // 렌더 단서로 구분되지 않는다.
  const sensedWallSegments = dedupeSegments([...(revealedWalls || []), ...(heatWalls || [])]);
  const collisionKeys = new Set(collisionSegments.map(segmentKey));
  const allChallengeSealsActivated = challengeSeals.length > 0 && challengeSeals.every(
    (_, index) => !!challengeActivatedSeals?.[index]
  );
  const allSlots: WallSegment[] = [];
  for (let row = 0; row < BOARD_SIZE - 1; row += 1) {
    for (let col = 0; col < BOARD_SIZE; col += 1) allSlots.push({ type: 'H', row, col });
  }
  for (let row = 0; row < BOARD_SIZE; row += 1) {
    for (let col = 0; col < BOARD_SIZE - 1; col += 1) allSlots.push({ type: 'V', row, col });
  }
  const occupiedKeys = new Set(obstacleSegments.map(segmentKey));
  (items || []).forEach((item) => {
    if (isWallItemType(item.type) && item.wallPosition && item.wallDirection) {
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
          reducedMotion={reducedMotion}
          goalLocked={wormholeChallenge && !allChallengeSealsActivated}
        />
      );
    }
  }

  const boardSpan = BOARD_SIZE * SPACING - GAP;

  return (
    <group name="maze-toon-environment-board">
      {/* 보드 받침대 */}
      <RoundedBox
        args={[boardSpan + 0.7, 0.28, boardSpan + 0.7]}
        radius={0.12}
        smoothness={4}
        position={[CENTER, -0.22, CENTER]}
        receiveShadow
        castShadow
      >
        <meshStandardMaterial color={COLORS.base} roughness={0.9} />
      </RoundedBox>
      <RoundedBox
        args={[boardSpan + 1.0, 0.12, boardSpan + 1.0]}
        radius={0.05}
        smoothness={3}
        position={[CENTER, -0.4, CENTER]}
        receiveShadow
      >
        <meshStandardMaterial color={COLORS.baseSide} roughness={1} />
      </RoundedBox>

      {/* 타일 */}
      {tiles}

      {challengeSeals.map((position, index) => (
        <WormholeSealMarker
          key={`wormhole-seal-${index}`}
          position={position}
          activated={!!challengeActivatedSeals?.[index]}
        />
      ))}

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
        sensedWallSegments
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
          active={!!itemActiveWalls?.[idx]}
          phaseOpen={!!itemPhaseOpen?.[idx]}
          visible={isSetup || revealItems}
          setup={isSetup}
          revealObstacles={revealObstacles}
          collided={(() => {
            if (!isWallItemType(it.type) || !it.wallPosition || !it.wallDirection) return false;
            const segment = obstacleToSegment(it.wallPosition, it.wallDirection);
            return !!segment && collisionKeys.has(segmentKey(segment));
          })()}
          reducedMotion={reducedMotion}
        />
      ))}

      {/* 액션 이펙트 */}
      <FxLayer fx={fx} reducedMotion={reducedMotion} />

      {/* 플레이어 캐릭터 */}
      {playerPosition && (
        <Pawn
          position={playerPosition}
          via={pawnVia}
          color={pawnColor || COLORS.player}
          fx={fx}
          celebrating={celebrating}
          fireAffected={fireAffected}
          poisonAffected={poisonAffected}
          reducedMotion={reducedMotion}
        />
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
  const reducedMotion = usePrefersReducedMotion();

  useEffect(() => {
    return () => {
      document.body.style.cursor = 'auto';
    };
  }, []);

  return (
    <div
      data-testid="game-board-3d"
      data-maze-render-style="inked-toy"
      data-maze-floor-tone="cream-sage"
      data-reduced-motion={reducedMotion ? 'true' : 'false'}
      data-board-realm={props.wormholeChallenge ? 'wormhole' : 'main'}
      data-fire-affected={props.fireAffected ? 'true' : 'false'}
      data-poison-affected={props.poisonAffected ? 'true' : 'false'}
      data-heat-wall-count={props.heatWalls?.length || 0}
      style={{ background: BOARD_BACKGROUND }}
      className={
        fullscreen
          ? 'absolute inset-0'
          : `w-full max-w-2xl mx-auto ${heightClassName} rounded-2xl overflow-hidden border border-amber-900/20 shadow-xl shadow-emerald-950/20`
      }
    >
      <Canvas
        orthographic
        shadows
        dpr={[1, 2]}
        camera={{ position: ORTHO_CAMERA_POS, zoom: 48, near: 0.1, far: 80 }}
        gl={{ antialias: true, alpha: true, powerPreference: 'high-performance' }}
        onCreated={({ gl }) => {
          gl.outputColorSpace = THREE.SRGBColorSpace;
          gl.toneMapping = THREE.ACESFilmicToneMapping;
          gl.toneMappingExposure = 0.98;
          gl.shadowMap.type = THREE.PCFShadowMap;
        }}
      >
        <ResponsiveBoardQuality compact={compact} />
        <FixedBoardCamera compact={compact} />
        <MazeToonRenderController />

        {/* 선명한 명암 밴드와 따뜻한 키라이트를 함께 쓰는 잉크드 토이 조명 */}
        <ambientLight intensity={0.52} color="#fff0d0" />
        <directionalLight
          position={[CENTER + 6, 10, CENTER - 5]}
          color="#ffd18a"
          intensity={1.45}
          castShadow
          shadow-mapSize-width={compact ? 512 : 1024}
          shadow-mapSize-height={compact ? 512 : 1024}
          shadow-camera-left={-8}
          shadow-camera-right={8}
          shadow-camera-top={8}
          shadow-camera-bottom={-8}
          shadow-bias={-0.00025}
          shadow-radius={compact ? 2 : 4}
        />
        <directionalLight position={[CENTER - 5, 5, CENTER + 6]} color="#76bcc2" intensity={0.24} />
        <hemisphereLight args={['#dff6ef', '#557568', 0.32]} />

        <BoardContents {...props} reducedMotion={reducedMotion} />
      </Canvas>
    </div>
  );
};

export default GameBoard3D;
