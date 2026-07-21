'use client';

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  type ReactNode,
} from 'react';
import { useThree } from '@react-three/fiber';
import { useGLTF } from '@react-three/drei';
import * as THREE from 'three';

export const MAZE_CARTOON_ASSET_VERSION = 'blender-cartoon-v1';

export const MAZE_CARTOON_ASSET_PATHS = Object.freeze({
  rabbitPawn: '/assets/maze/v1/rabbit-pawn.glb',
  tileCream: '/assets/maze/v1/tile-cream.glb',
  tileSage: '/assets/maze/v1/tile-sage.glb',
  boardBase: '/assets/maze/v1/board-base.glb',
  markerStart: '/assets/maze/v1/marker-start.glb',
  markerGoal: '/assets/maze/v1/marker-goal.glb',
  wallNormal: '/assets/maze/v1/wall-normal.glb',
  wallSteel: '/assets/maze/v1/wall-steel.glb',
  wallFire: '/assets/maze/v1/wall-fire.glb',
  wallPoison: '/assets/maze/v1/wall-poison.glb',
  wallIce: '/assets/maze/v1/wall-ice.glb',
  wallWind: '/assets/maze/v1/wall-wind.glb',
  wallPhase: '/assets/maze/v1/wall-phase.glb',
  wallThorn: '/assets/maze/v1/wall-thorn.glb',
  wallCrystal: '/assets/maze/v1/wall-crystal.glb',
  wallCollapse: '/assets/maze/v1/wall-collapse.glb',
  wallMirror: '/assets/maze/v1/wall-mirror.glb',
  goalFlag: '/assets/maze/v1/goal-flag.glb',
  goalLock: '/assets/maze/v1/goal-lock.glb',
  itemMine: '/assets/maze/v1/item-mine.glb',
  itemMineUsed: '/assets/maze/v1/item-mine-used.glb',
  itemSmoke: '/assets/maze/v1/item-smoke.glb',
  itemSmokeUsed: '/assets/maze/v1/item-smoke-used.glb',
  wormholePortal: '/assets/maze/v1/wormhole-portal.glb',
  legacySealDie: '/assets/maze/v1/legacy-seal-die.glb',
  wormholeBoardBase: '/assets/maze/v1/wormhole-board-base.glb',
  wormholeDie: '/assets/maze/v1/wormhole-die.glb',
  wormholeRock: '/assets/maze/v1/wormhole-rock.glb',
  wormholeTargetPad: '/assets/maze/v1/wormhole-target-pad.glb',
});

export type MazeCartoonAssetId = keyof typeof MAZE_CARTOON_ASSET_PATHS;
export type MazeCartoonAssetProfile = 'actor' | 'environment';
export type MazeCartoonAssetSet = 'main' | 'wormhole';

const ASSET_IDS = Object.keys(MAZE_CARTOON_ASSET_PATHS) as MazeCartoonAssetId[];
export const MAZE_CARTOON_ASSET_CATALOG_COUNT = ASSET_IDS.length;
export const MAZE_CARTOON_MAIN_ASSET_IDS = Object.freeze([
  'rabbitPawn',
  'tileCream',
  'tileSage',
  'boardBase',
  'markerStart',
  'markerGoal',
  'wallNormal',
  'wallSteel',
  'wallFire',
  'wallPoison',
  'wallIce',
  'wallWind',
  'wallPhase',
  'wallThorn',
  'wallCrystal',
  'wallCollapse',
  'wallMirror',
  'goalFlag',
  'goalLock',
  'itemMine',
  'itemMineUsed',
  'itemSmoke',
  'itemSmokeUsed',
  'wormholePortal',
  'legacySealDie',
] as const satisfies readonly MazeCartoonAssetId[]);
export const MAZE_CARTOON_WORMHOLE_ASSET_IDS = Object.freeze([
  'tileCream',
  'tileSage',
  'markerStart',
  'wormholeBoardBase',
  'wormholeDie',
  'wormholeRock',
  'wormholeTargetPad',
] as const satisfies readonly MazeCartoonAssetId[]);

const ASSET_IDS_BY_SET: Readonly<Record<MazeCartoonAssetSet, readonly MazeCartoonAssetId[]>> =
  Object.freeze({
    main: MAZE_CARTOON_MAIN_ASSET_IDS,
    wormhole: MAZE_CARTOON_WORMHOLE_ASSET_IDS,
  });
const ASSET_URLS_BY_SET: Readonly<Record<MazeCartoonAssetSet, string[]>> =
  Object.freeze({
    main: MAZE_CARTOON_MAIN_ASSET_IDS.map((id) => MAZE_CARTOON_ASSET_PATHS[id]),
    wormhole: MAZE_CARTOON_WORMHOLE_ASSET_IDS.map((id) => MAZE_CARTOON_ASSET_PATHS[id]),
  });
const SHADOW_CASTING_ASSETS = new Set<MazeCartoonAssetId>([
  'rabbitPawn',
  'wallNormal',
  'wallSteel',
  'wallFire',
  'wallPoison',
  'wallIce',
  'wallWind',
  'wallPhase',
  'wallThorn',
  'wallCrystal',
  'wallCollapse',
  'wallMirror',
  'goalFlag',
  'goalLock',
  'itemMine',
  'itemSmoke',
  'wormholePortal',
  'legacySealDie',
  'wormholeDie',
  'wormholeRock',
  'wormholeTargetPad',
]);

interface MazeCartoonAppearance {
  profile: MazeCartoonAssetProfile;
  variant: string;
  opacity?: number;
  tintMaterialName?: string;
  tintColor?: string;
  emissiveScale?: number;
  noOutline?: boolean;
}

export interface MazeCartoonAssetInstance {
  object: THREE.Group;
  materials: THREE.MeshStandardMaterial[];
}

interface MazeCartoonAssetLibrary {
  instantiate: (
    assetId: MazeCartoonAssetId,
    appearance: MazeCartoonAppearance,
  ) => MazeCartoonAssetInstance;
}

const MazeCartoonAssetContext = createContext<MazeCartoonAssetLibrary | null>(null);

function isStandardMaterial(material: THREE.Material): material is THREE.MeshStandardMaterial {
  return material instanceof THREE.MeshStandardMaterial;
}

function materialCacheKey(
  assetId: MazeCartoonAssetId,
  source: THREE.Material,
  appearance: MazeCartoonAppearance,
) {
  return [
    assetId,
    source.uuid,
    appearance.profile,
    appearance.variant,
    appearance.opacity ?? 1,
    appearance.tintMaterialName ?? '-',
    appearance.tintColor ?? '-',
    appearance.emissiveScale ?? 1,
  ].join('|');
}

export function preloadMazeCartoonAssets(assetSet: MazeCartoonAssetSet = 'main') {
  // Blender exports are intentionally uncompressed. Disabling Draco avoids a
  // runtime dependency on Google's decoder CDN; Meshopt remains bundled.
  useGLTF.preload(ASSET_URLS_BY_SET[assetSet], false, true);
}

export function MazeCartoonAssetLoadingState() {
  const gl = useThree((state) => state.gl);
  useEffect(() => {
    gl.domElement.dataset.mazeAssetState = 'loading';
    return () => {
      if (gl.domElement.dataset.mazeAssetState === 'loading') {
        delete gl.domElement.dataset.mazeAssetState;
      }
    };
  }, [gl]);
  return null;
}

export function MazeCartoonAssetProvider({
  children,
  assetSet = 'main',
}: {
  children: ReactNode;
  assetSet?: MazeCartoonAssetSet;
}) {
  const gl = useThree((state) => state.gl);
  const assetIds = ASSET_IDS_BY_SET[assetSet];
  const assetUrls = ASSET_URLS_BY_SET[assetSet];
  const loaded = useGLTF(assetUrls, false, true);
  const sources = useMemo(() => {
    const result = new Map<MazeCartoonAssetId, THREE.Group>();
    assetIds.forEach((assetId, index) => {
      const entry = loaded[index];
      if (!entry?.scene) throw new Error(`Missing Blender maze asset: ${assetId}`);
      result.set(assetId, entry.scene);
    });
    return result;
  }, [assetIds, loaded]);
  const materialCache = useRef(new Map<string, THREE.Material>());
  const lifecycleGeneration = useRef(0);

  const instantiate = useCallback((
    assetId: MazeCartoonAssetId,
    appearance: MazeCartoonAppearance,
  ): MazeCartoonAssetInstance => {
    const source = sources.get(assetId);
    if (!source) throw new Error(`Unknown Blender maze asset: ${assetId}`);

    const object = source.clone(true);
    object.name = `maze-asset-${assetId}`;
    object.userData.mazeAssetId = assetId;
    object.userData.mazeAssetVersion = MAZE_CARTOON_ASSET_VERSION;
    const instanceMaterials = new Set<THREE.MeshStandardMaterial>();

    object.traverse((candidate) => {
      const mesh = candidate as THREE.Mesh;
      if (!mesh.isMesh || !mesh.material) return;
      const sourceMaterials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      const nextMaterials = sourceMaterials.map((sourceMaterial) => {
        const key = materialCacheKey(assetId, sourceMaterial, appearance);
        let next = materialCache.current.get(key);
        if (!next) {
          next = sourceMaterial.clone();
          next.name = `${sourceMaterial.name}:${appearance.variant}:${appearance.profile}`;
          if (isStandardMaterial(next)) {
            if (
              appearance.tintMaterialName &&
              appearance.tintColor &&
              sourceMaterial.name === appearance.tintMaterialName
            ) {
              next.color.set(appearance.tintColor);
            }
            const opacity = Math.min(next.opacity, appearance.opacity ?? 1);
            next.opacity = opacity;
            next.transparent = next.transparent || opacity < 1;
            next.depthWrite = opacity >= 0.7;
            next.emissiveIntensity *= appearance.emissiveScale ?? 1;
            next.userData.mazeAssetBaseEmissiveIntensity = next.emissiveIntensity;
          }
          materialCache.current.set(key, next);
        }
        if (isStandardMaterial(next)) instanceMaterials.add(next);
        return next;
      });
      mesh.material = Array.isArray(mesh.material) ? nextMaterials : nextMaterials[0];
      // Tiles and the broad board base only receive shadows. Making all 72 tile
      // channels shadow casters doubles their draw cost on every live board.
      mesh.castShadow = SHADOW_CASTING_ASSETS.has(assetId) && (appearance.opacity ?? 1) >= 0.7;
      mesh.receiveShadow = true;
      mesh.raycast = () => {};
      mesh.userData.mazeAssetId = assetId;
      if (appearance.noOutline) mesh.userData.mazeToonNoOutline = true;
    });

    return { object, materials: Array.from(instanceMaterials) };
  }, [sources]);

  useEffect(() => {
    const generation = lifecycleGeneration.current + 1;
    lifecycleGeneration.current = generation;
    const canvasMaterialCache = materialCache.current;
    gl.domElement.dataset.mazeAssetState = 'ready';
    gl.domElement.dataset.mazeAssetVersion = MAZE_CARTOON_ASSET_VERSION;
    gl.domElement.dataset.mazeAssetCount = String(assetIds.length);
    gl.domElement.dataset.mazeAssetCatalogCount = String(MAZE_CARTOON_ASSET_CATALOG_COUNT);
    gl.domElement.dataset.mazeAssetSet = assetSet;
    return () => {
      delete gl.domElement.dataset.mazeAssetState;
      delete gl.domElement.dataset.mazeAssetVersion;
      delete gl.domElement.dataset.mazeAssetCount;
      delete gl.domElement.dataset.mazeAssetCatalogCount;
      delete gl.domElement.dataset.mazeAssetSet;
      // React Strict Mode immediately replays effects in development. Defer
      // disposal one microtask so that replay can cancel cleanup of materials
      // which are still mounted, while a real Canvas unmount still frees them.
      queueMicrotask(() => {
        if (lifecycleGeneration.current !== generation) return;
        for (const cached of canvasMaterialCache.values()) cached.dispose();
        canvasMaterialCache.clear();
      });
    };
  }, [assetIds.length, assetSet, gl]);

  const value = useMemo<MazeCartoonAssetLibrary>(() => ({ instantiate }), [instantiate]);
  return (
    <MazeCartoonAssetContext.Provider value={value}>
      {children}
    </MazeCartoonAssetContext.Provider>
  );
}

export function useMazeCartoonAssetInstance(
  assetId: MazeCartoonAssetId,
  appearance: MazeCartoonAppearance,
): MazeCartoonAssetInstance {
  const library = useContext(MazeCartoonAssetContext);
  if (!library) throw new Error('MazeCartoonAssetProvider is missing.');
  const {
    profile,
    variant,
    opacity,
    tintMaterialName,
    tintColor,
    emissiveScale,
    noOutline,
  } = appearance;
  return useMemo(() => library.instantiate(assetId, {
    profile,
    variant,
    opacity,
    tintMaterialName,
    tintColor,
    emissiveScale,
    noOutline,
  }), [
    assetId,
    emissiveScale,
    library,
    noOutline,
    opacity,
    profile,
    tintColor,
    tintMaterialName,
    variant,
  ]);
}

export function MazeCartoonAsset({
  assetId,
  profile = 'environment',
  variant = 'default',
  opacity = 1,
  tintMaterialName,
  tintColor,
  emissiveScale = 1,
  noOutline = false,
}: {
  assetId: MazeCartoonAssetId;
  profile?: MazeCartoonAssetProfile;
  variant?: string;
  opacity?: number;
  tintMaterialName?: string;
  tintColor?: string;
  emissiveScale?: number;
  noOutline?: boolean;
}) {
  const { object } = useMazeCartoonAssetInstance(assetId, {
    profile,
    variant,
    opacity,
    tintMaterialName,
    tintColor,
    emissiveScale,
    noOutline,
  });
  return <primitive object={object} dispose={null} />;
}
