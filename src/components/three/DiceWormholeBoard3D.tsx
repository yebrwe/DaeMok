'use client';

import React, { Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import type {
  DiceFace,
  DiceOrientationId,
  DiceWormholeRunState,
  Direction,
  Position,
} from '@/types/game';
import { getDiceOrientationFaces } from '@/lib/diceWormhole';
import {
  MAZE_CARTOON_ASSET_VERSION,
  MazeCartoonAsset,
  MazeCartoonAssetLoadingState,
  MazeCartoonAssetProvider,
  preloadMazeCartoonAssets,
  useMazeCartoonAssetInstance,
  type MazeCartoonAssetId,
} from '@/components/three/MazeCartoonAssets';
import {
  applyMazeToonRendering,
  MAZE_TOON_RENDER_CONTRACT,
  uninstallMazeToonRendering,
} from '@/lib/mazeToonRendering';

const TILE = 1;
const GAP = 0.14;
const SPACING = TILE + GAP;
const BOARD_SIZE = 4;
const BOARD_CENTER = ((BOARD_SIZE - 1) * SPACING) / 2;
const BOARD_SPAN = BOARD_SIZE * SPACING;
const TILE_TOP = 0.08;
const TARGET_FACE_SURFACE_LOCAL_Y = 0.18;
const TARGET_FACE_SURFACE_Y = TILE_TOP + TARGET_FACE_SURFACE_LOCAL_Y;
const CAMERA_ELEVATION_DEG = 59;
const CAMERA_DISTANCE = BOARD_SPAN * 2.15;
const ROLL_DURATION = 0.62;
const BUMP_DURATION = 0.42;

// These IDs are part of the Blender maze-v1 contract. The casts let this
// component land independently while the generated manifest and asset library
// are updated in the same change set.
const WORMHOLE_ASSETS = {
  boardBase: 'wormholeBoardBase' as MazeCartoonAssetId,
  die: 'wormholeDie' as MazeCartoonAssetId,
  rock: 'wormholeRock' as MazeCartoonAssetId,
  targetPad: 'wormholeTargetPad' as MazeCartoonAssetId,
} as const;

type AnimationKind = 'idle' | 'roll' | 'bump';

interface DiceWormholeBoard3DProps {
  run: DiceWormholeRunState;
  previousPosition: Position;
  previousOrientation: DiceOrientationId;
  actionChanged: boolean;
  rollDirection: Direction | null;
  reducedMotion: boolean;
}

function positionKey(position: Position): string {
  return `${position.row},${position.col}`;
}

function samePosition(left: Position, right: Position): boolean {
  return left.row === right.row && left.col === right.col;
}

function cellToWorld(position: Position): THREE.Vector3 {
  return new THREE.Vector3(position.col * SPACING, 0, position.row * SPACING);
}

const WORLD_FACE_NORMALS = {
  top: new THREE.Vector3(0, 1, 0),
  bottom: new THREE.Vector3(0, -1, 0),
  north: new THREE.Vector3(0, 0, -1),
  south: new THREE.Vector3(0, 0, 1),
  east: new THREE.Vector3(1, 0, 0),
  west: new THREE.Vector3(-1, 0, 0),
} as const;

function worldNormalForFace(orientation: DiceOrientationId, face: number): THREE.Vector3 {
  const faces = getDiceOrientationFaces(orientation);
  const entry = (Object.keys(WORLD_FACE_NORMALS) as Array<keyof typeof WORLD_FACE_NORMALS>)
    .find((side) => faces[side] === face);
  if (!entry) throw new Error(`Dice face ${face} is missing from orientation ${orientation}.`);
  return WORLD_FACE_NORMALS[entry];
}

/**
 * Blender's authored base is the persisted orientation 0:
 * 1=+Y, 3=+X and 5=+Z. The three resulting world-space axes fully describe
 * every one of the 24 legal die orientations without Euler-angle drift.
 */
function quaternionForOrientation(orientation: DiceOrientationId): THREE.Quaternion {
  const basis = new THREE.Matrix4().makeBasis(
    worldNormalForFace(orientation, 3),
    worldNormalForFace(orientation, 1),
    worldNormalForFace(orientation, 5),
  );
  return new THREE.Quaternion().setFromRotationMatrix(basis).normalize();
}

function easeRoll(value: number): number {
  const inverse = 1 - value;
  return 1 - inverse * inverse * inverse;
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

function ResponsiveWormholeCamera() {
  const gl = useThree((state) => state.gl);
  const camera = useThree((state) => state.camera) as THREE.OrthographicCamera;
  const size = useThree((state) => state.size);

  useLayoutEffect(() => {
    const elevation = THREE.MathUtils.degToRad(CAMERA_ELEVATION_DEG);
    camera.position.set(
      BOARD_CENTER,
      Math.sin(elevation) * CAMERA_DISTANCE,
      BOARD_CENTER + Math.cos(elevation) * CAMERA_DISTANCE,
    );
    camera.up.set(0, 1, 0);
    camera.lookAt(BOARD_CENTER, 0, BOARD_CENTER);
    const widthZoom = size.width / (BOARD_SPAN + 0.5);
    const heightZoom = size.height / (BOARD_SPAN * 0.93 + 0.72);
    camera.zoom = Math.max(34, Math.min(widthZoom, heightZoom) * 0.96);
    camera.near = 0.1;
    camera.far = 60;
    camera.updateProjectionMatrix();
    gl.domElement.dataset.mazeCamera = 'fixed-orthographic';
    gl.domElement.dataset.mazeCameraElevation = String(CAMERA_ELEVATION_DEG);
    gl.domElement.dataset.mazeCameraZoom = camera.zoom.toFixed(2);
    gl.domElement.dataset.boardRealm = 'wormhole';
    return () => {
      delete gl.domElement.dataset.mazeCamera;
      delete gl.domElement.dataset.mazeCameraElevation;
      delete gl.domElement.dataset.mazeCameraZoom;
      delete gl.domElement.dataset.boardRealm;
    };
  }, [camera, gl, size.height, size.width]);

  return null;
}

function ResponsiveWormholeQuality() {
  const gl = useThree((state) => state.gl);
  const setDpr = useThree((state) => state.setDpr);

  useEffect(() => {
    const dpr = Math.max(1, Math.min(window.devicePixelRatio || 1, 1.5));
    setDpr(dpr);
    gl.domElement.dataset.mazeRenderDpr = dpr.toFixed(2);
    gl.domElement.dataset.mazeRenderQuality = 'wormhole';
    return () => {
      delete gl.domElement.dataset.mazeRenderDpr;
      delete gl.domElement.dataset.mazeRenderQuality;
    };
  }, [gl, setDpr]);

  return null;
}

const TARGET_PIP_POSITIONS: Readonly<Record<DiceFace, readonly [number, number][]>> = {
  1: [[0, 0]],
  2: [[-0.13, -0.13], [0.13, 0.13]],
  3: [[-0.13, -0.13], [0, 0], [0.13, 0.13]],
  4: [[-0.13, -0.13], [0.13, -0.13], [-0.13, 0.13], [0.13, 0.13]],
  5: [[-0.13, -0.13], [0.13, -0.13], [0, 0], [-0.13, 0.13], [0.13, 0.13]],
  6: [[-0.13, -0.15], [0.13, -0.15], [-0.13, 0], [0.13, 0], [-0.13, 0.15], [0.13, 0.15]],
};

function TargetFacePips({ face }: { face: DiceFace }) {
  const pipsRef = useRef<THREE.InstancedMesh>(null);
  const positions = TARGET_PIP_POSITIONS[face];

  useLayoutEffect(() => {
    const pips = pipsRef.current;
    if (!pips) return;
    const matrix = new THREE.Matrix4();
    for (let index = 0; index < positions.length; index += 1) {
      const [x, z] = positions[index];
      matrix.makeTranslation(x, 0.16, z);
      pips.setMatrixAt(index, matrix);
    }
    pips.count = positions.length;
    pips.instanceMatrix.needsUpdate = true;
  }, [positions]);

  return (
    <group name={`wormhole-target-face-${face}`}>
      {/* A raised ivory face keeps every pip legible over the violet GLB pad. */}
      <mesh
        position={[0, 0.125, 0]}
        receiveShadow
        userData={{ mazeToonProfile: 'environment' }}
      >
        <cylinderGeometry args={[0.255, 0.255, 0.028, 32]} />
        <meshStandardMaterial color="#f7f2ff" roughness={0.72} metalness={0.02} />
      </mesh>
      <instancedMesh
        ref={pipsRef}
        args={[undefined, undefined, 6]}
        count={positions.length}
        castShadow
        userData={{ mazeToonProfile: 'actor', mazeToonNoOutline: true }}
      >
        <cylinderGeometry args={[0.055, 0.055, 0.036, 16]} />
        <meshStandardMaterial
          color="#21134f"
          emissive="#6d28d9"
          emissiveIntensity={0.34}
          roughness={0.56}
          metalness={0.04}
        />
      </instancedMesh>
    </group>
  );
}

function ExitPad({
  position,
  targetTop,
  reducedMotion,
}: {
  position: Position;
  targetTop: DiceFace;
  reducedMotion: boolean;
}) {
  const rootRef = useRef<THREE.Group>(null);
  const gl = useThree((state) => state.gl);

  useEffect(() => {
    gl.domElement.dataset.targetFloorFace = String(targetTop);
    return () => {
      delete gl.domElement.dataset.targetFloorFace;
    };
  }, [gl, targetTop]);

  useFrame(({ clock }) => {
    if (!rootRef.current) return;
    const scale = reducedMotion ? 1 : 1 + Math.sin(clock.elapsedTime * 3.8) * 0.045;
    rootRef.current.scale.setScalar(scale);
  });

  return (
    <group ref={rootRef} position={[position.col * SPACING, TILE_TOP, position.row * SPACING]}>
      <MazeCartoonAsset
        assetId={WORMHOLE_ASSETS.targetPad}
        variant="wormhole-exit"
        emissiveScale={reducedMotion ? 0.9 : 1.1}
      />
      <TargetFacePips face={targetTop} />
    </group>
  );
}

function DimensionRock({ position }: { position: Position }) {
  const rotation = useMemo(() => {
    const hash = position.row * BOARD_SIZE + position.col;
    return (hash % 7 - 3) * 0.12;
  }, [position.col, position.row]);

  return (
    <group position={[position.col * SPACING, TILE_TOP, position.row * SPACING]} rotation={[0, rotation, 0]}>
      <MazeCartoonAsset assetId={WORMHOLE_ASSETS.rock} variant={`rock-${positionKey(position)}`} />
    </group>
  );
}

interface DieAnimation {
  kind: AnimationKind;
  elapsed: number;
  duration: number;
  fromPosition: THREE.Vector3;
  toPosition: THREE.Vector3;
  fromQuaternion: THREE.Quaternion;
  toQuaternion: THREE.Quaternion;
}

function WormholeDie({
  run,
  previousPosition,
  previousOrientation,
  actionChanged,
  rollDirection,
  reducedMotion,
}: DiceWormholeBoard3DProps) {
  const rootRef = useRef<THREE.Group>(null);
  const gl = useThree((state) => state.gl);
  const { object } = useMazeCartoonAssetInstance(WORMHOLE_ASSETS.die, {
    profile: 'actor',
    variant: 'wormhole-die',
  });
  const dimensions = useMemo(() => {
    const bounds = new THREE.Box3().setFromObject(object);
    const center = bounds.getCenter(new THREE.Vector3());
    const size = bounds.getSize(new THREE.Vector3());
    return { center, halfHeight: size.y / 2 };
  }, [object]);
  const animationRef = useRef<DieAnimation>({
    kind: 'idle',
    elapsed: 0,
    duration: 0,
    fromPosition: cellToWorld(run.position),
    toPosition: cellToWorld(run.position),
    fromQuaternion: quaternionForOrientation(run.orientation),
    toQuaternion: quaternionForOrientation(run.orientation),
  });

  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) return;

    const fromPosition = cellToWorld(previousPosition);
    const toPosition = cellToWorld(run.position);
    fromPosition.y = (
      samePosition(previousPosition, run.challenge.endPosition)
        ? TARGET_FACE_SURFACE_Y
        : TILE_TOP
    ) + dimensions.halfHeight;
    toPosition.y = (
      samePosition(run.position, run.challenge.endPosition)
        ? TARGET_FACE_SURFACE_Y
        : TILE_TOP
    ) + dimensions.halfHeight;
    const fromQuaternion = quaternionForOrientation(previousOrientation);
    const toQuaternion = quaternionForOrientation(run.orientation);
    const kind: AnimationKind = actionChanged
      ? rollDirection
        ? 'roll'
        : 'bump'
      : 'idle';
    const duration = kind === 'roll' ? ROLL_DURATION : kind === 'bump' ? BUMP_DURATION : 0;

    animationRef.current = {
      kind: reducedMotion ? 'idle' : kind,
      elapsed: 0,
      duration,
      fromPosition,
      toPosition,
      fromQuaternion,
      toQuaternion,
    };
    root.position.copy(reducedMotion || kind === 'idle' ? toPosition : fromPosition);
    root.quaternion.copy(reducedMotion || kind === 'idle' ? toQuaternion : fromQuaternion);
    gl.domElement.dataset.diceAnimation = reducedMotion ? 'idle' : kind;
    gl.domElement.dataset.diceRollDirection = rollDirection || (actionChanged ? 'bump' : 'idle');
    gl.domElement.dataset.diceOrientation = String(run.orientation);
    gl.domElement.dataset.dicePosition = positionKey(run.position);
    gl.domElement.dataset.diceFaceCount = '6';
  }, [
    actionChanged,
    dimensions.halfHeight,
    gl,
    previousOrientation,
    previousPosition,
    reducedMotion,
    rollDirection,
    run.orientation,
    run.position,
    run.challenge.endPosition,
  ]);

  useEffect(() => () => {
    delete gl.domElement.dataset.diceAnimation;
    delete gl.domElement.dataset.diceRollDirection;
    delete gl.domElement.dataset.diceOrientation;
    delete gl.domElement.dataset.dicePosition;
    delete gl.domElement.dataset.diceFaceCount;
  }, [gl]);

  useFrame((_, delta) => {
    const root = rootRef.current;
    const animation = animationRef.current;
    if (!root || animation.kind === 'idle') return;

    animation.elapsed = Math.min(animation.duration, animation.elapsed + delta);
    const progress = animation.duration === 0 ? 1 : animation.elapsed / animation.duration;
    if (animation.kind === 'roll') {
      const eased = easeRoll(progress);
      root.position.lerpVectors(animation.fromPosition, animation.toPosition, eased);
      // Lifting the centre through the roll keeps the rounded Blender die from
      // visually cutting into the tile while its quaternion turns exactly 90°.
      root.position.y += Math.sin(Math.PI * progress) * 0.105;
      root.quaternion.slerpQuaternions(
        animation.fromQuaternion,
        animation.toQuaternion,
        eased,
      );
    } else {
      root.position.copy(animation.toPosition);
      const shake = Math.sin(progress * Math.PI * 4) * (1 - progress) * 0.095;
      root.position.x += shake;
      root.position.y += Math.sin(progress * Math.PI) * 0.035;
      root.quaternion.copy(animation.toQuaternion);
    }

    if (progress >= 1) {
      root.position.copy(animation.toPosition);
      root.quaternion.copy(animation.toQuaternion);
      animation.kind = 'idle';
      gl.domElement.dataset.diceAnimation = 'idle';
    }
  });

  return (
    <group ref={rootRef}>
      <primitive
        object={object}
        position={[-dimensions.center.x, -dimensions.center.y, -dimensions.center.z]}
        dispose={null}
      />
    </group>
  );
}

function WormholeBoardScene(props: DiceWormholeBoard3DProps) {
  const blocked = useMemo(
    () => new Set(props.run.challenge.blockedCells.map(positionKey)),
    [props.run.challenge.blockedCells],
  );

  return (
    <group name="dice-wormhole-blender-world">
      <group position={[BOARD_CENTER, 0, BOARD_CENTER]}>
        <MazeCartoonAsset
          assetId={WORMHOLE_ASSETS.boardBase}
          variant="wormhole-board-base"
          noOutline
        />
      </group>

      {Array.from({ length: BOARD_SIZE * BOARD_SIZE }, (_, index) => {
        const row = Math.floor(index / BOARD_SIZE);
        const col = index % BOARD_SIZE;
        const key = `${row},${col}`;
        return (
          <group key={key} position={[col * SPACING, -TILE_TOP, row * SPACING]}>
            <MazeCartoonAsset
              assetId={(row + col) % 2 === 0 ? 'tileCream' : 'tileSage'}
              variant={`wormhole-tile-${(row + col) % 2}`}
              noOutline
            />
          </group>
        );
      })}

      <group
        position={[
          props.run.challenge.startPosition.col * SPACING,
          TILE_TOP,
          props.run.challenge.startPosition.row * SPACING,
        ]}
      >
        <MazeCartoonAsset assetId="markerStart" variant="wormhole-entry" />
      </group>

      <ExitPad
        position={props.run.challenge.endPosition}
        targetTop={props.run.challenge.targetTop}
        reducedMotion={props.reducedMotion}
      />

      {Array.from(blocked, (key) => {
        const [row, col] = key.split(',').map(Number);
        return <DimensionRock key={key} position={{ row, col }} />;
      })}

      <WormholeDie {...props} />
    </group>
  );
}

export default function DiceWormholeBoard3D(props: DiceWormholeBoard3DProps) {
  useEffect(() => {
    preloadMazeCartoonAssets('wormhole');
  }, []);

  return (
    <div
      className="dice-wormhole-world relative my-auto aspect-square min-h-0 w-full max-w-[min(100%,18rem)] overflow-hidden rounded-xl border-2 border-violet-900/45 shadow-lg"
      data-testid="dice-wormhole-board-3d"
      data-maze-render-style="inked-toy"
      data-maze-asset-version={MAZE_CARTOON_ASSET_VERSION}
      data-dice-orientation={props.run.orientation}
      data-dice-roll-direction={props.rollDirection || (props.actionChanged ? 'bump' : 'idle')}
    >
      <Canvas
        orthographic
        shadows
        dpr={[1, 1.5]}
        camera={{
          position: [BOARD_CENTER, CAMERA_DISTANCE, BOARD_CENTER + CAMERA_DISTANCE],
          zoom: 52,
          near: 0.1,
          far: 60,
        }}
        gl={{ antialias: true, alpha: true, powerPreference: 'high-performance' }}
        onCreated={({ gl }) => {
          gl.outputColorSpace = THREE.SRGBColorSpace;
          gl.toneMapping = THREE.ACESFilmicToneMapping;
          gl.toneMappingExposure = 1;
          gl.shadowMap.type = THREE.PCFShadowMap;
        }}
      >
        <color attach="background" args={['#dcd3eb']} />
        <ResponsiveWormholeQuality />
        <ResponsiveWormholeCamera />
        <MazeToonRenderController />

        <ambientLight intensity={0.48} color="#fff1db" />
        <directionalLight
          position={[BOARD_CENTER + 5, 9, BOARD_CENTER - 4]}
          color="#ffd49b"
          intensity={1.5}
          castShadow
          shadow-mapSize-width={768}
          shadow-mapSize-height={768}
          shadow-camera-left={-5}
          shadow-camera-right={5}
          shadow-camera-top={5}
          shadow-camera-bottom={-5}
          shadow-bias={-0.00025}
          shadow-radius={3}
        />
        <directionalLight
          position={[BOARD_CENTER - 4, 4, BOARD_CENTER + 5]}
          color="#8eb7d5"
          intensity={0.3}
        />
        <hemisphereLight args={['#eee5ff', '#4d5368', 0.28]} />

        <Suspense fallback={<MazeCartoonAssetLoadingState />}>
          <MazeCartoonAssetProvider assetSet="wormhole">
            <WormholeBoardScene {...props} />
          </MazeCartoonAssetProvider>
        </Suspense>
      </Canvas>
    </div>
  );
}
