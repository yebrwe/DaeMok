'use client';

import React, { useMemo, useRef, useState, useCallback, useEffect } from 'react';
import { Canvas, useFrame, useThree, ThreeEvent } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import * as THREE from 'three';
import { CollisionWall, Direction, GamePhase, MapItem, Obstacle, Position } from '@/types/game';
import { BOARD_SIZE, isSamePosition } from '@/lib/gameUtils';

// 1인칭 시점 상수
const EYE_HEIGHT = 0.55; // 말 눈높이
const FP_WALL_HEIGHT = 1.35; // 1인칭에서 벽 높이 (눈높이보다 높아 시야 차단)
const FACING_VECTOR: Record<Direction, [number, number]> = {
  up: [0, -1], // -Z
  down: [0, 1], // +Z
  left: [-1, 0], // -X
  right: [1, 0], // +X
};

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
  collision: '#ef4444', // 충돌한 벽 (빨강)
  reveal: '#f59e0b', // 게임 종료 후 공개된 벽
  start: '#22c55e',
  end: '#ef4444',
  player: '#3b82f6',
};

// 셀 좌표 -> 3D 위치
function cellToWorld(position: Position): [number, number, number] {
  return [position.col * SPACING, 0, position.row * SPACING];
}

// ===== 벽 세그먼트 모델 =====
// 같은 벽을 양쪽 셀에서 두 번 그리지 않도록 정규화한 표현
// H(r,c): (r,c)와 (r+1,c) 사이의 가로 벽 / V(r,c): (r,c)와 (r,c+1) 사이의 세로 벽
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
    // 행 사이 벽: X축 방향으로 길게
    return [seg.col * SPACING, WALL_HEIGHT / 2, seg.row * SPACING + SPACING / 2];
  }
  // 열 사이 벽: Z축 방향으로 길게
  return [seg.col * SPACING + SPACING / 2, WALL_HEIGHT / 2, seg.row * SPACING];
}

function segmentSize(seg: WallSegment): [number, number, number] {
  return seg.type === 'H'
    ? [TILE + GAP * 0.6, WALL_HEIGHT, WALL_THICKNESS]
    : [WALL_THICKNESS, WALL_HEIGHT, TILE + GAP * 0.6];
}

// 세그먼트 -> 콜백용 (position, direction) 변환
function segmentToObstacle(seg: WallSegment): { position: Position; direction: Direction } {
  return seg.type === 'H'
    ? { position: { row: seg.row, col: seg.col }, direction: 'down' }
    : { position: { row: seg.row, col: seg.col }, direction: 'right' };
}

// ===== 개별 3D 요소 =====

// 벽 박스 (설치됨/충돌/공개)
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

// 1인칭용 보드 외곽 벽 (미로에 갇힌 느낌 + 보드 밖 방향 시각화)
function BorderWalls() {
  const span = BOARD_SIZE * SPACING - GAP;
  const half = span / 2;
  const t = 0.18;
  const walls: Array<{ pos: [number, number, number]; size: [number, number, number] }> = [
    { pos: [CENTER, FP_WALL_HEIGHT / 2, CENTER - half - GAP / 2 - t / 2], size: [span + t * 2, FP_WALL_HEIGHT, t] },
    { pos: [CENTER, FP_WALL_HEIGHT / 2, CENTER + half + GAP / 2 + t / 2], size: [span + t * 2, FP_WALL_HEIGHT, t] },
    { pos: [CENTER - half - GAP / 2 - t / 2, FP_WALL_HEIGHT / 2, CENTER], size: [t, FP_WALL_HEIGHT, span + t * 2] },
    { pos: [CENTER + half + GAP / 2 + t / 2, FP_WALL_HEIGHT / 2, CENTER], size: [t, FP_WALL_HEIGHT, span + t * 2] },
  ];
  return (
    <group>
      {walls.map((w, i) => (
        <mesh key={`border-${i}`} position={w.pos} castShadow receiveShadow>
          <boxGeometry args={w.size} />
          <meshStandardMaterial color={COLORS.base} roughness={0.85} />
        </mesh>
      ))}
    </group>
  );
}

// 1인칭 카메라 리그 - 플레이어 위치/방향으로 부드럽게 이동·회전
function FirstPersonRig({ position, facing }: { position: Position; facing: Direction }) {
  const { camera } = useThree();
  // lookAt은 일반 Object3D에선 +Z, 카메라에선 -Z를 대상으로 향하게 하므로
  // 반드시 카메라 타입 더미로 쿼터니언을 계산해야 시선 방향이 뒤집히지 않는다
  const dummyRef = useRef(new THREE.PerspectiveCamera());

  const targetPos = useMemo(() => {
    const [x, , z] = cellToWorld(position);
    return new THREE.Vector3(x, EYE_HEIGHT, z);
  }, [position]);

  // 마운트 시 시야각을 1인칭에 맞게 확장
  useEffect(() => {
    const cam = camera as THREE.PerspectiveCamera;
    const prevFov = cam.fov;
    cam.fov = 72;
    cam.updateProjectionMatrix();
    return () => {
      cam.fov = prevFov;
      cam.updateProjectionMatrix();
    };
  }, [camera]);

  useFrame((_, delta) => {
    const t = 1 - Math.pow(0.0002, delta);
    camera.position.lerp(targetPos, t);

    // 바라볼 방향 쿼터니언 계산 후 슬러프 (부드러운 회전)
    const [dx, dz] = FACING_VECTOR[facing];
    const dummy = dummyRef.current;
    dummy.position.copy(camera.position);
    dummy.lookAt(camera.position.x + dx, EYE_HEIGHT, camera.position.z + dz);
    camera.quaternion.slerp(dummy.quaternion, t);
  });

  return null;
}

// 3인칭 복귀 시 카메라를 오버헤드 기본 위치로 되돌림
function ThirdPersonReset() {
  const { camera } = useThree();
  useEffect(() => {
    camera.position.set(...TP_CAMERA_POS);
    camera.lookAt(CENTER, 0, CENTER);
    const cam = camera as THREE.PerspectiveCamera;
    cam.fov = 42;
    cam.updateProjectionMatrix();
  }, [camera]);
  return null;
}

// 설치 단계에서 클릭할 수 있는 벽 슬롯 (호버 시 미리보기 표시)
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
      // 카메라 드래그와 클릭 구분
      if (e.delta > 4) return;
      const { position, direction } = segmentToObstacle(seg);
      onPlace(position, direction);
    },
    [seg, onPlace]
  );

  const size = segmentSize(seg);

  return (
    <group>
      {/* 넉넉한 히트 영역 (투명) */}
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

      {/* 호버 미리보기 (빈 슬롯일 때만) */}
      {hovered && !occupied && <WallBox seg={seg} color={previewColor} opacity={0.55} />}
    </group>
  );
}

// 바닥 타일
function Tile({
  position,
  selectable,
  selectionMode,
  isStart,
  isEnd,
  onCellClick,
  beaconFlag = false,
  placeMode = 'wall',
  isPendingEntrance = false,
}: {
  position: Position;
  selectable: boolean;
  selectionMode: 'start' | 'end' | 'none';
  isStart: boolean;
  isEnd: boolean;
  onCellClick?: (p: Position) => void;
  beaconFlag?: boolean; // 1인칭: 벽 너머로 보이는 높은 깃발
  placeMode?: 'wall' | 'oneTimeWall' | 'mine' | 'wormhole' | 'radar';
  isPendingEntrance?: boolean; // 웜홀 입구로 지정됨 (출구 선택 대기)
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

      {/* 시작점 패드 */}
      {isStart && (
        <mesh position={[0, 0.09, 0]} receiveShadow>
          <cylinderGeometry args={[0.36, 0.36, 0.05, 32]} />
          <meshStandardMaterial color={COLORS.start} emissive={COLORS.start} emissiveIntensity={0.25} />
        </mesh>
      )}

      {/* 도착점 패드 + 깃발 (1인칭에서는 벽 너머로 보이도록 높게 - 길잡이 역할) */}
      {isEnd && (
        <group position={[0, 0.09, 0]}>
          <mesh receiveShadow>
            <cylinderGeometry args={[0.36, 0.36, 0.05, 32]} />
            <meshStandardMaterial color={COLORS.end} emissive={COLORS.end} emissiveIntensity={0.2} />
          </mesh>
          <mesh position={[0, beaconFlag ? 1.1 : 0.4, 0]} castShadow>
            <cylinderGeometry args={[0.03, 0.03, beaconFlag ? 2.2 : 0.8, 8]} />
            <meshStandardMaterial color="#78716c" />
          </mesh>
          <mesh position={[0.16, beaconFlag ? 2.06 : 0.66, 0]} castShadow>
            <boxGeometry args={[0.32, 0.2, 0.02]} />
            <meshStandardMaterial
              color={COLORS.end}
              emissive={COLORS.end}
              emissiveIntensity={beaconFlag ? 0.5 : 0}
              side={THREE.DoubleSide}
            />
          </mesh>
        </group>
      )}

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

// 플레이어 말 (이동 애니메이션 포함)
function Pawn({ position, color }: { position: Position; color: string }) {
  const groupRef = useRef<THREE.Group>(null);
  const target = useMemo(() => {
    const [x, , z] = cellToWorld(position);
    return new THREE.Vector3(x, 0, z);
  }, [position]);

  useFrame((state, delta) => {
    const g = groupRef.current;
    if (!g) return;
    // 부드러운 이동 (프레임레이트 독립적인 지수 감쇠)
    const t = 1 - Math.pow(0.0005, delta);
    g.position.lerp(target, t);
    // 이동 중 살짝 통통 튀는 효과
    const dist = g.position.distanceTo(target);
    g.position.y = Math.min(dist * 1.2, 0.35) * Math.abs(Math.sin(state.clock.elapsedTime * 8));
  });

  return (
    <group ref={groupRef} position={target.toArray()}>
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
  pawnColor?: string; // 말 색상 (기본 파랑, 관전 시 상대 말은 빨강)
  viewMode?: 'first' | 'third'; // 1인칭(미로 체험) / 3인칭(오버헤드)
  facing?: Direction; // 1인칭에서 바라보는 방향
  item?: MapItem | null; // 맵 아이템 (1회성 벽/지뢰/웜홀)
  itemConsumed?: boolean; // 아이템 사용됨 여부
  revealedWalls?: Obstacle[]; // 탐지기로 밝혀낸 벽들 (일반 벽처럼 노란색)
  placeMode?: 'wall' | 'oneTimeWall' | 'mine' | 'wormhole' | 'radar'; // 제작 중 배치 모드 (호버 미리보기)
  pendingCell?: Position | null; // 웜홀 입구로 지정된 셀 (출구 선택 대기)
  fullscreen?: boolean; // 화면 전체를 채우는 스테이지 모드
  heightClassName?: string;
}

// 맵 아이템 3D 렌더링 (1회성 벽 / 지뢰 / 웜홀)
function ItemVisuals({
  item,
  consumed,
  visible,
  wallHeight,
}: {
  item: MapItem;
  consumed: boolean;
  visible: boolean; // 미사용 상태도 표시할지 (제작/공개), consumed면 항상 흔적 표시
  wallHeight: number;
}) {
  if (!visible && !consumed) return null;

  if (item.type === 'oneTimeWall' && item.wallPosition && item.wallDirection) {
    const seg = obstacleToSegment(item.wallPosition, item.wallDirection);
    if (!seg) return null;
    // 위장 벽: 공개 시에도 일반 벽과 동일하게 표시 (가짜라는 표시 없음)
    // 이미 통과된 경우엔 표시하지 않음 (실제로 사라진 벽)
    if (consumed) return null;
    return <WallBox seg={seg} color={COLORS.reveal} opacity={0.75} height={wallHeight} />;
  }

  if (item.type === 'mine' && item.position) {
    return <MineVisual position={item.position} consumed={consumed} />;
  }

  if (item.type === 'wormhole' && item.entrance && item.exit) {
    return <WormholeVisual entrance={item.entrance} exit={item.exit} consumed={consumed} />;
  }

  return null;
}

// 지뢰 - 빨간 램프가 깜빡이는 애니메이션
function MineVisual({ position, consumed }: { position: Position; consumed: boolean }) {
  const lampRef = useRef<THREE.MeshStandardMaterial>(null);
  const [x, , z] = cellToWorld(position);

  useFrame((state) => {
    if (lampRef.current) {
      lampRef.current.emissiveIntensity = 0.4 + Math.abs(Math.sin(state.clock.elapsedTime * 3)) * 1.2;
    }
  });

  if (consumed) {
    // 폭발 흔적 (검게 그을린 자국)
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

// 웜홀 - 회전하는 소용돌이 애니메이션
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
      {/* 입구 - 진한 보라 소용돌이 */}
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
      {/* 출구 - 밝은 보라 고리 (반대 방향 회전) */}
      <group ref={exitRef} position={[xx, 0.1, xz]}>
        <mesh rotation={[-Math.PI / 2, 0, 0]}>
          <torusGeometry args={[0.3, 0.05, 12, 32]} />
          <meshStandardMaterial color="#d8b4fe" emissive="#d8b4fe" emissiveIntensity={consumed ? 0.1 : 0.5} transparent opacity={opacity} />
        </mesh>
      </group>
    </group>
  );
}

function BoardContents({
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
  pawnColor,
  viewMode = 'third',
  item = null,
  itemConsumed = false,
  revealedWalls = [],
  placeMode = 'wall',
  pendingCell = null,
}: GameBoard3DProps) {
  const isSetup = gamePhase === GamePhase.SETUP;
  const isFirstPerson = viewMode === 'first';
  const wallHeight = isFirstPerson ? FP_WALL_HEIGHT : WALL_HEIGHT;

  // 설치된 장애물 세그먼트 (설정 단계 또는 게임 종료 후 공개)
  const obstacleSegments = useMemo(
    () => dedupeSegments(obstacles || []),
    [obstacles]
  );

  // 충돌한 벽 세그먼트 (플레이 중 빨간색)
  const collisionSegments = useMemo(
    () => dedupeSegments(collisionWalls || []),
    [collisionWalls]
  );

  // 탐지기로 밝혀낸 벽 세그먼트 (노란색 - 일반 벽과 동일하게 표시)
  const radarSegments = useMemo(
    () => dedupeSegments(revealedWalls || []),
    [revealedWalls]
  );
  const collisionKeys = useMemo(
    () => new Set(collisionSegments.map(segmentKey)),
    [collisionSegments]
  );

  // 모든 벽 슬롯 (설치 단계 전용)
  const allSlots = useMemo(() => {
    const slots: WallSegment[] = [];
    for (let r = 0; r < BOARD_SIZE - 1; r++)
      for (let c = 0; c < BOARD_SIZE; c++) slots.push({ type: 'H', row: r, col: c });
    for (let r = 0; r < BOARD_SIZE; r++)
      for (let c = 0; c < BOARD_SIZE - 1; c++) slots.push({ type: 'V', row: r, col: c });
    return slots;
  }, []);

  const occupiedKeys = useMemo(() => {
    const keys = new Set(obstacleSegments.map(segmentKey));
    // 1회성 벽 아이템 자리도 점유된 것으로 취급 (호버 미리보기 방지)
    if (item?.type === 'oneTimeWall' && item.wallPosition && item.wallDirection) {
      const seg = obstacleToSegment(item.wallPosition, item.wallDirection);
      if (seg) keys.add(segmentKey(seg));
    }
    return keys;
  }, [obstacleSegments, item]);

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
          beaconFlag={isFirstPerson}
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
            previewColor={placeMode === 'oneTimeWall' ? '#22d3ee' : COLORS.wallPreview}
          />
        ))}

      {/* 플레이 단계: 충돌한 벽 (빨간색) - 1인칭에서는 시야를 가리는 높은 벽 */}
      {gamePhase === GamePhase.PLAY &&
        collisionSegments.map((seg) => (
          <WallBox key={`col-${segmentKey(seg)}`} seg={seg} color={COLORS.collision} height={wallHeight} />
        ))}

      {/* 게임 종료: 공개된 벽 (반투명 주황) - 충돌한 벽은 빨간색 유지 */}
      {gamePhase === GamePhase.PLAY && revealObstacles &&
        obstacleSegments
          .filter((seg) => !collisionKeys.has(segmentKey(seg)))
          .map((seg) => (
            <WallBox key={`rev-${segmentKey(seg)}`} seg={seg} color={COLORS.reveal} opacity={0.75} height={wallHeight} />
          ))}

      {/* 탐지기로 밝혀낸 벽 (게임 종료 공개 전까지만 - 이후엔 정식 공개와 겹침 방지) */}
      {gamePhase === GamePhase.PLAY && !revealObstacles &&
        radarSegments
          .filter((seg) => !collisionKeys.has(segmentKey(seg)))
          .map((seg) => (
            <WallBox key={`radar-${segmentKey(seg)}`} seg={seg} color={COLORS.wall} height={wallHeight} />
          ))}

      {/* 맵 아이템 (제작/공개 시 전체 표시, 사용된 뒤엔 흔적 표시) */}
      {item && (
        <ItemVisuals
          item={item}
          consumed={!!itemConsumed}
          visible={isSetup || !!revealObstacles}
          wallHeight={wallHeight}
        />
      )}

      {/* 1인칭: 보드 외곽 벽 (미로 느낌) */}
      {isFirstPerson && <BorderWalls />}

      {/* 플레이어 말 (1인칭에서는 내가 말 그 자체이므로 숨김) */}
      {playerPosition && !isFirstPerson && (
        <Pawn position={playerPosition} color={pawnColor || COLORS.player} />
      )}
    </group>
  );
}

// ===== 메인 컴포넌트 (Canvas 래퍼) =====
const GameBoard3D: React.FC<GameBoard3DProps> = (props) => {
  const { heightClassName = 'h-[340px] sm:h-[420px] md:h-[460px]', fullscreen = false } = props;

  // 언마운트 시 커서 상태 복원
  useEffect(() => {
    return () => {
      document.body.style.cursor = 'auto';
    };
  }, []);

  const span = BOARD_SIZE * SPACING;

  return (
    <div
      className={
        fullscreen
          ? 'absolute inset-0 bg-gradient-to-b from-slate-800 via-slate-900 to-slate-950'
          : `w-full max-w-2xl mx-auto ${heightClassName} rounded-2xl overflow-hidden border border-slate-700/60 shadow-xl shadow-black/50 bg-gradient-to-b from-slate-800 via-slate-900 to-slate-950`
      }
    >
      <Canvas
        shadows
        dpr={[1, 2]}
        camera={{ position: TP_CAMERA_POS, fov: 42 }}
      >
        {/* 조명 */}
        <ambientLight intensity={0.75} />
        <directionalLight
          position={[CENTER + 6, 10, CENTER - 5]}
          intensity={1.2}
          castShadow
          shadow-mapSize-width={1024}
          shadow-mapSize-height={1024}
          shadow-camera-left={-8}
          shadow-camera-right={8}
          shadow-camera-top={8}
          shadow-camera-bottom={-8}
        />
        <hemisphereLight args={['#bfdbfe', '#a8a29e', 0.4]} />

        <BoardContents {...props} />

        {props.viewMode === 'first' && props.playerPosition ? (
          <FirstPersonRig position={props.playerPosition} facing={props.facing || 'up'} />
        ) : (
          <>
            <ThirdPersonReset />
            <OrbitControls
              makeDefault
              target={[CENTER, 0, CENTER]}
              enablePan={false}
              enableZoom={false}
              maxPolarAngle={Math.PI * 0.44}
            />
          </>
        )}
      </Canvas>
    </div>
  );
};

export default GameBoard3D;
