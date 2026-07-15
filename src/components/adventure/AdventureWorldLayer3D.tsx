'use client';

import type {} from '@react-three/fiber';
import { memo, useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import {
  worldToArenaCoordinates,
  type WorldArenaProjection,
  type WorldBiomeId,
  type WorldChunkRenderData,
  type WorldObstacleRenderData,
  type WorldPointOfInterest,
  type WorldPosition,
  type WorldPropRenderData,
  type WorldRoadRenderData,
  type WorldVector3,
} from '@/lib/adventureWorld';
import {
  ARENA_WORLD_SCALE,
  arenaWorldToScene,
} from './HackSlashArena3D.types';

export interface AdventureWorldLayer3DProps {
  chunks: readonly WorldChunkRenderData[];
  projection: WorldArenaProjection;
}

interface BiomePalette {
  road: string;
  trunk: string;
  foliage: string;
  rock: string;
  structure: string;
  accent: string;
}

type InstanceKind = 'trunk' | 'canopy' | 'rock' | 'structure' | 'crystal' | 'flora' | 'debris';

interface SceneScale {
  x: number;
  y: number;
  z: number;
}

interface InstanceRecord {
  position: [number, number, number];
  rotation: [number, number, number];
  scale: [number, number, number];
  color: string;
}

type InstanceBatches = Record<InstanceKind, InstanceRecord[]>;

const MAX_OBSTACLES_PER_CHUNK = 18;
const MAX_DECORATIVE_PROPS_PER_CHUNK = 10;
const MAX_RENDERED_CHUNKS = 49;

const BIOME_PALETTES: Readonly<Record<WorldBiomeId, BiomePalette>> = {
  greenmarch: {
    road: '#4c3c2e', trunk: '#32271f', foliage: '#35432f', rock: '#5b5b55',
    structure: '#585147', accent: '#b69b55',
  },
  whisperwood: {
    road: '#3d352e', trunk: '#25231f', foliage: '#293d32', rock: '#505951',
    structure: '#494a43', accent: '#779b82',
  },
  sunscorch: {
    road: '#6a5438', trunk: '#4e3b2d', foliage: '#515936', rock: '#776a50',
    structure: '#705c47', accent: '#c29a4f',
  },
  drownedfen: {
    road: '#403c32', trunk: '#2a2b25', foliage: '#33483b', rock: '#505b53',
    structure: '#444841', accent: '#749173',
  },
  frostfang: {
    road: '#747873', trunk: '#3d3d39', foliage: '#4d625d', rock: '#747f82',
    structure: '#646d70', accent: '#93c7c6',
  },
  stormhighlands: {
    road: '#4e4d47', trunk: '#37332f', foliage: '#424c3e', rock: '#5a5e59',
    structure: '#515552', accent: '#819da3',
  },
  emberwaste: {
    road: '#382e2d', trunk: '#211f1d', foliage: '#3c322e', rock: '#443c3c',
    structure: '#393638', accent: '#b95f3d',
  },
  crystalcoast: {
    road: '#4f625d', trunk: '#3c3933', foliage: '#406158', rock: '#586e70',
    structure: '#526363', accent: '#5db3ad',
  },
};

const POI_COLORS: Readonly<Record<WorldPointOfInterest['kind'], string>> = {
  townCenter: '#d0b968',
  waypoint: '#55c7bd',
  dungeonEntrance: '#b27661',
  floorEntrance: '#73a6ba',
  floorExit: '#d19e58',
  bossGate: '#b9574d',
};

function sceneScale(projection: WorldArenaProjection): SceneScale {
  const x = projection.arenaWidth / projection.visibleWorldWidth / ARENA_WORLD_SCALE;
  const z = projection.arenaHeight / projection.visibleWorldHeight / ARENA_WORLD_SCALE;
  return { x, y: Math.min(x, z), z };
}

function worldPointToScene(
  position: WorldPosition | WorldVector3,
  projection: WorldArenaProjection,
): [number, number, number] {
  const arena = worldToArenaCoordinates(position, projection);
  const [x, , z] = arenaWorldToScene(arena.x, arena.y);
  const scale = sceneScale(projection);
  return [x, 'y' in position ? position.y * scale.y : 0, z];
}

function hashUnit(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) / 0xffffffff;
}

function fogColor(color: THREE.Color, fogState: WorldChunkRenderData['fogState']): THREE.Color {
  if (fogState === 'hidden') return new THREE.Color('#080b0a');
  if (fogState === 'discovered') return color.clone().multiplyScalar(0.38);
  return color;
}

function createTerrainGeometry(
  chunk: WorldChunkRenderData,
  projection: WorldArenaProjection,
): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  const resolution = Math.max(1, chunk.terrain.resolution);
  const columns = resolution + 1;
  const scale = sceneScale(projection);
  const width = (chunk.bounds.maxX - chunk.bounds.minX) * scale.x;
  const depth = (chunk.bounds.maxZ - chunk.bounds.minZ) * scale.z;
  const positions: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];
  const primary = new THREE.Color(chunk.terrain.primaryColor);
  const secondary = new THREE.Color(chunk.terrain.secondaryColor);
  const heightRange = Math.max(0.001, chunk.terrain.maxHeight - chunk.terrain.minHeight);

  for (let row = 0; row <= resolution; row += 1) {
    for (let column = 0; column <= resolution; column += 1) {
      const sampleIndex = row * columns + column;
      const height = chunk.terrain.heightSamples[sampleIndex] ?? 0;
      positions.push(
        -width / 2 + (column / resolution) * width,
        height * scale.y,
        -depth / 2 + (row / resolution) * depth,
      );
      const normalizedHeight = (height - chunk.terrain.minHeight) / heightRange;
      const variation = hashUnit(`${chunk.id}:${column}:${row}`) * 0.16;
      const vertexColor = primary.clone().lerp(secondary, Math.min(1, normalizedHeight * 0.48 + variation));
      const shaded = fogColor(vertexColor, chunk.fogState);
      colors.push(shaded.r, shaded.g, shaded.b);
    }
  }

  for (let row = 0; row < resolution; row += 1) {
    for (let column = 0; column < resolution; column += 1) {
      const topLeft = row * columns + column;
      const topRight = topLeft + 1;
      const bottomLeft = topLeft + columns;
      const bottomRight = bottomLeft + 1;
      indices.push(topLeft, bottomLeft, topRight, topRight, bottomLeft, bottomRight);
    }
  }

  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}

function sampleTerrainHeight(chunk: WorldChunkRenderData, position: WorldPosition): number {
  const resolution = Math.max(1, chunk.terrain.resolution);
  const columns = resolution + 1;
  const width = Math.max(0.001, chunk.bounds.maxX - chunk.bounds.minX);
  const depth = Math.max(0.001, chunk.bounds.maxZ - chunk.bounds.minZ);
  const sampleX = Math.max(0, Math.min(resolution, ((position.x - chunk.bounds.minX) / width) * resolution));
  const sampleZ = Math.max(0, Math.min(resolution, ((position.z - chunk.bounds.minZ) / depth) * resolution));
  const x0 = Math.floor(sampleX);
  const z0 = Math.floor(sampleZ);
  const x1 = Math.min(resolution, x0 + 1);
  const z1 = Math.min(resolution, z0 + 1);
  const tx = sampleX - x0;
  const tz = sampleZ - z0;
  const at = (x: number, z: number) => chunk.terrain.heightSamples[z * columns + x] ?? 0;
  const top = at(x0, z0) * (1 - tx) + at(x1, z0) * tx;
  const bottom = at(x0, z1) * (1 - tx) + at(x1, z1) * tx;
  return top * (1 - tz) + bottom * tz;
}

function createRoadGeometry(
  chunk: WorldChunkRenderData,
  road: WorldRoadRenderData,
  projection: WorldArenaProjection,
): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  if (road.points.length < 2) return geometry;
  const scale = sceneScale(projection);
  const halfWidth = road.width * (scale.x + scale.z) * 0.25;
  const samples: Array<[number, number, number]> = [];
  const stepsPerSegment = 8;

  for (let pointIndex = 0; pointIndex < road.points.length - 1; pointIndex += 1) {
    const start = road.points[pointIndex];
    const end = road.points[pointIndex + 1];
    for (let step = 0; step <= stepsPerSegment; step += 1) {
      if (pointIndex > 0 && step === 0) continue;
      const ratio = step / stepsPerSegment;
      const worldPosition = {
        x: start.x + (end.x - start.x) * ratio,
        z: start.z + (end.z - start.z) * ratio,
      };
      const height = sampleTerrainHeight(chunk, worldPosition) + 0.12;
      samples.push(worldPointToScene({ ...worldPosition, y: height }, projection));
    }
  }

  const positions: number[] = [];
  const indices: number[] = [];
  for (let index = 0; index < samples.length; index += 1) {
    const previous = samples[Math.max(0, index - 1)];
    const next = samples[Math.min(samples.length - 1, index + 1)];
    const dx = next[0] - previous[0];
    const dz = next[2] - previous[2];
    const length = Math.max(0.0001, Math.hypot(dx, dz));
    const sideX = (-dz / length) * halfWidth;
    const sideZ = (dx / length) * halfWidth;
    positions.push(samples[index][0] + sideX, samples[index][1], samples[index][2] + sideZ);
    positions.push(samples[index][0] - sideX, samples[index][1], samples[index][2] - sideZ);
    if (index < samples.length - 1) {
      const left = index * 2;
      indices.push(left, left + 2, left + 1, left + 1, left + 2, left + 3);
    }
  }
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}

const TerrainChunk = memo(function TerrainChunk({
  chunk,
  projection,
}: {
  chunk: WorldChunkRenderData;
  projection: WorldArenaProjection;
}) {
  const geometry = useMemo(() => createTerrainGeometry(chunk, projection), [chunk, projection]);
  const center = worldPointToScene(chunk.center, projection);

  useEffect(() => () => geometry.dispose(), [geometry]);

  return (
    <mesh
      geometry={geometry}
      position={[center[0], 0, center[2]]}
      receiveShadow={chunk.fogState === 'visible'}
      frustumCulled
    >
      <meshStandardMaterial
        vertexColors
        roughness={chunk.dimension === 'dungeon' ? 0.92 : 1}
        metalness={chunk.biomeId === 'crystalcoast' ? 0.08 : 0.01}
      />
    </mesh>
  );
});

const RoadRibbon = memo(function RoadRibbon({
  chunk,
  road,
  projection,
}: {
  chunk: WorldChunkRenderData;
  road: WorldRoadRenderData;
  projection: WorldArenaProjection;
}) {
  const geometry = useMemo(() => createRoadGeometry(chunk, road, projection), [chunk, projection, road]);
  const palette = BIOME_PALETTES[chunk.biomeId];
  const discovered = chunk.fogState === 'discovered';

  useEffect(() => () => geometry.dispose(), [geometry]);

  return (
    <mesh geometry={geometry} receiveShadow frustumCulled renderOrder={1}>
      <meshStandardMaterial
        color={palette.road}
        roughness={0.96}
        transparent={discovered}
        opacity={discovered ? 0.28 : 0.78}
        depthWrite={!discovered}
        polygonOffset
        polygonOffsetFactor={-1}
      />
    </mesh>
  );
});

function emptyBatches(): InstanceBatches {
  return {
    trunk: [], canopy: [], rock: [], structure: [], crystal: [], flora: [], debris: [],
  };
}

function classifyAsset(assetKey: string): InstanceKind {
  const key = assetKey.toLowerCase();
  if (/(tree|oak|pine|cactus)/.test(key) && !/(log|stump|deadfall)/.test(key)) return 'trunk';
  if (/(crystal|ice-spire|obsidian|rune|torch|lava-vent)/.test(key)) return 'crystal';
  if (/(building|wall|column|monolith|standing-stone|sandstone)/.test(key)) return 'structure';
  if (/(reed|heather|bush|coral|grass|flora)/.test(key)) return 'flora';
  if (/(log|stump|deadfall|debris|bones|driftwood|rubble)/.test(key)) return 'debris';
  return 'rock';
}

function addTreeObstacle(
  batches: InstanceBatches,
  obstacle: WorldObstacleRenderData,
  projection: WorldArenaProjection,
  palette: BiomePalette,
) {
  const scale = sceneScale(projection);
  const base = worldPointToScene(obstacle.position, projection);
  const trunkHeight = obstacle.height * 0.48 * scale.y;
  const canopyHeight = obstacle.height * 0.62 * scale.y;
  const rotationY = hashUnit(obstacle.id) * Math.PI * 2;
  batches.trunk.push({
    position: [base[0], base[1] + trunkHeight / 2, base[2]],
    rotation: [0, rotationY, 0],
    scale: [Math.max(0.06, obstacle.radius * 0.24 * scale.x), trunkHeight, Math.max(0.06, obstacle.radius * 0.24 * scale.z)],
    color: palette.trunk,
  });
  batches.canopy.push({
    position: [base[0], base[1] + trunkHeight + canopyHeight * 0.36, base[2]],
    rotation: [0, rotationY, 0],
    scale: [obstacle.radius * 1.15 * scale.x, canopyHeight, obstacle.radius * 1.15 * scale.z],
    color: palette.foliage,
  });
}

function addObstacleInstance(
  batches: InstanceBatches,
  obstacle: WorldObstacleRenderData,
  projection: WorldArenaProjection,
  palette: BiomePalette,
) {
  const kind = classifyAsset(obstacle.assetKey);
  if (kind === 'trunk') {
    addTreeObstacle(batches, obstacle, projection, palette);
    return;
  }
  const scale = sceneScale(projection);
  const base = worldPointToScene(obstacle.position, projection);
  const width = obstacle.shape === 'box' ? obstacle.halfExtents.x * 2 : obstacle.radius * 2;
  const depth = obstacle.shape === 'box' ? obstacle.halfExtents.z * 2 : obstacle.radius * 2;
  const rotationY = hashUnit(`${obstacle.id}:rotation`) * Math.PI * 2;
  const color = kind === 'structure'
    ? palette.structure
    : kind === 'crystal'
      ? palette.accent
      : kind === 'flora'
        ? palette.foliage
        : kind === 'debris'
          ? palette.trunk
          : palette.rock;
  const heightFactor = kind === 'rock' ? 0.56 : kind === 'debris' ? 0.28 : 1;
  const renderedHeight = Math.max(0.35, obstacle.height * heightFactor);
  batches[kind].push({
    position: [base[0], base[1] + renderedHeight * scale.y / 2, base[2]],
    rotation: kind === 'debris' ? [0, rotationY, 0.08] : [0, rotationY, 0],
    scale: [
      width * scale.x * (kind === 'debris' ? 1.2 : 1),
      renderedHeight * scale.y,
      depth * scale.z * (kind === 'debris' ? 0.45 : 1),
    ],
    color,
  });
}

function addDecorativeProp(
  batches: InstanceBatches,
  prop: WorldPropRenderData,
  projection: WorldArenaProjection,
  palette: BiomePalette,
) {
  const kind = classifyAsset(prop.assetKey);
  const scale = sceneScale(projection);
  const base = worldPointToScene(prop.position, projection);
  const width = (kind === 'flora' ? 1.1 : kind === 'debris' ? 2.2 : 1.35) * prop.scale.x;
  const height = (kind === 'crystal' ? 2.2 : kind === 'trunk' ? 3.2 : kind === 'flora' ? 1.4 : 1.05) * prop.scale.y;
  const depth = (kind === 'debris' ? 0.65 : 1.1) * prop.scale.z;
  const batchKind: InstanceKind = kind === 'trunk' ? 'flora' : kind;
  const color = batchKind === 'crystal'
    ? palette.accent
    : batchKind === 'flora'
      ? palette.foliage
      : batchKind === 'structure'
        ? palette.structure
        : batchKind === 'debris'
          ? palette.trunk
          : palette.rock;
  batches[batchKind].push({
    position: [base[0], base[1] + height * scale.y / 2, base[2]],
    rotation: [0, prop.rotationY, batchKind === 'debris' ? 0.12 : 0],
    scale: [width * scale.x, height * scale.y, depth * scale.z],
    color,
  });
}

function collectInstances(
  chunks: readonly WorldChunkRenderData[],
  projection: WorldArenaProjection,
): InstanceBatches {
  const batches = emptyBatches();
  for (const chunk of chunks) {
    if (chunk.fogState !== 'visible') continue;
    const palette = BIOME_PALETTES[chunk.biomeId];
    for (const obstacle of chunk.obstacles.slice(0, MAX_OBSTACLES_PER_CHUNK)) {
      addObstacleInstance(batches, obstacle, projection, palette);
    }
    const decorative = chunk.props.filter((prop) => prop.obstacleId === null).slice(0, MAX_DECORATIVE_PROPS_PER_CHUNK);
    for (const prop of decorative) addDecorativeProp(batches, prop, projection, palette);
  }
  return batches;
}

function selectChunksForRendering(
  chunks: readonly WorldChunkRenderData[],
  projection: WorldArenaProjection,
): readonly WorldChunkRenderData[] {
  if (chunks.length <= MAX_RENDERED_CHUNKS) return chunks;
  return [...chunks]
    .sort((left, right) => {
      const leftDistance = (left.center.x - projection.center.x) ** 2 + (left.center.z - projection.center.z) ** 2;
      const rightDistance = (right.center.x - projection.center.x) ** 2 + (right.center.z - projection.center.z) ** 2;
      return leftDistance - rightDistance || left.id.localeCompare(right.id);
    })
    .slice(0, MAX_RENDERED_CHUNKS);
}

function InstanceBatch({
  instances,
  kind,
  castShadow = false,
}: {
  instances: readonly InstanceRecord[];
  kind: InstanceKind;
  castShadow?: boolean;
}) {
  const meshRef = useRef<THREE.InstancedMesh | null>(null);

  useEffect(() => {
    const mesh = meshRef.current;
    if (!mesh) return;
    const dummy = new THREE.Object3D();
    const color = new THREE.Color();
    instances.forEach((instance, index) => {
      dummy.position.set(...instance.position);
      dummy.rotation.set(...instance.rotation);
      dummy.scale.set(...instance.scale);
      dummy.updateMatrix();
      mesh.setMatrixAt(index, dummy.matrix);
      mesh.setColorAt(index, color.set(instance.color));
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.computeBoundingSphere();
  }, [instances]);

  if (instances.length === 0) return null;

  return (
    <instancedMesh
      ref={meshRef}
      args={[undefined, undefined, instances.length]}
      castShadow={castShadow}
      receiveShadow
      frustumCulled
    >
      {kind === 'trunk' && <cylinderGeometry args={[1, 1.15, 1, 7]} />}
      {kind === 'canopy' && <coneGeometry args={[1, 1, 7]} />}
      {kind === 'rock' && <dodecahedronGeometry args={[0.5, 1]} />}
      {kind === 'structure' && <boxGeometry args={[1, 1, 1]} />}
      {kind === 'crystal' && <octahedronGeometry args={[0.5, 0]} />}
      {kind === 'flora' && <coneGeometry args={[0.5, 1, 6]} />}
      {kind === 'debris' && <dodecahedronGeometry args={[0.5, 0]} />}
      <meshStandardMaterial
        vertexColors
        roughness={kind === 'crystal' ? 0.3 : kind === 'structure' ? 0.88 : 0.95}
        metalness={kind === 'crystal' ? 0.18 : 0.01}
        emissive={kind === 'crystal' ? '#142523' : '#000000'}
        emissiveIntensity={kind === 'crystal' ? 0.32 : 0}
      />
    </instancedMesh>
  );
}

function PointOfInterestMarker({
  point,
  projection,
  discovered,
}: {
  point: WorldPointOfInterest;
  projection: WorldArenaProjection;
  discovered: boolean;
}) {
  const position = worldPointToScene(point.position, projection);
  const color = POI_COLORS[point.kind];
  const opacity = discovered ? 0.34 : 0.82;
  return (
    <group position={[position[0], position[1] + 0.08, position[2]]}>
      <mesh rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[0.28, 0.035, 6, 24]} />
        <meshBasicMaterial color={color} transparent opacity={opacity} depthWrite={false} />
      </mesh>
      <mesh position={[0, 0.24, 0]}>
        <cylinderGeometry args={[0.035, 0.07, 0.45, 6]} />
        <meshStandardMaterial
          color={color}
          emissive={color}
          emissiveIntensity={discovered ? 0.45 : 1.4}
          transparent={discovered}
          opacity={opacity}
        />
      </mesh>
    </group>
  );
}

function AdventureWorldLayer3D({
  chunks,
  projection,
}: AdventureWorldLayer3DProps) {
  const renderedChunks = useMemo(() => selectChunksForRendering(chunks, projection), [chunks, projection]);
  const batches = useMemo(() => collectInstances(renderedChunks, projection), [projection, renderedChunks]);

  return (
    <group name="adventure-world-layer">
      {renderedChunks.map((chunk) => (
        <TerrainChunk key={`terrain:${chunk.id}`} chunk={chunk} projection={projection} />
      ))}

      {renderedChunks.filter((chunk) => chunk.fogState !== 'hidden').flatMap((chunk) => (
        chunk.roads.map((road) => (
          <RoadRibbon key={road.id} chunk={chunk} road={road} projection={projection} />
        ))
      ))}

      <InstanceBatch instances={batches.trunk} kind="trunk" castShadow />
      <InstanceBatch instances={batches.canopy} kind="canopy" castShadow />
      <InstanceBatch instances={batches.rock} kind="rock" />
      <InstanceBatch instances={batches.structure} kind="structure" castShadow />
      <InstanceBatch instances={batches.crystal} kind="crystal" />
      <InstanceBatch instances={batches.flora} kind="flora" />
      <InstanceBatch instances={batches.debris} kind="debris" />

      {renderedChunks.filter((chunk) => chunk.fogState !== 'hidden').flatMap((chunk) => (
        chunk.pointsOfInterest.map((point) => (
          <PointOfInterestMarker
            key={point.id}
            point={point}
            projection={projection}
            discovered={chunk.fogState === 'discovered'}
          />
        ))
      ))}
    </group>
  );
}

export default memo(AdventureWorldLayer3D);
