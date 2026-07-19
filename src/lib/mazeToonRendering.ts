import * as THREE from 'three';

export type MazeToonProfile = 'actor' | 'environment' | 'effect';

interface MazeToonProfileContract {
  shadeSteps: 3 | 4;
  darkestBand: number;
  brightestBand: number;
  quantizeStrength: number;
  rimStrength: number;
  rimPower: number;
  outlineStrength: number;
  outlineWidth: number;
  minimumRoughness: number;
  maximumMetalness: number;
}

/**
 * A small, maze-only rendering contract. It intentionally does not depend on
 * The profiles keep the rounded wooden-toy form while enforcing dark ink bands and
 * visible silhouettes. This prevents the maze from washing out under warm lighting.
 */
export const MAZE_TOON_RENDER_CONTRACT = Object.freeze({
  version: 'inked-toy-v2',
  profiles: Object.freeze({
    actor: Object.freeze({
      shadeSteps: 3,
      darkestBand: 0.48,
      brightestBand: 1.12,
      quantizeStrength: 0.88,
      rimStrength: 0.12,
      rimPower: 2.6,
      outlineStrength: 0.52,
      outlineWidth: 0.24,
      minimumRoughness: 0.68,
      maximumMetalness: 0.18,
    }),
    environment: Object.freeze({
      shadeSteps: 4,
      darkestBand: 0.46,
      brightestBand: 1.05,
      quantizeStrength: 0.86,
      rimStrength: 0.04,
      rimPower: 3.2,
      outlineStrength: 0.32,
      outlineWidth: 0.22,
      minimumRoughness: 0.76,
      maximumMetalness: 0.12,
    }),
    effect: Object.freeze({
      shadeSteps: 3,
      darkestBand: 0.58,
      brightestBand: 1.18,
      quantizeStrength: 0.78,
      rimStrength: 0.18,
      rimPower: 2.3,
      outlineStrength: 0.22,
      outlineWidth: 0.18,
      minimumRoughness: 0.54,
      maximumMetalness: 0.2,
    }),
  } satisfies Readonly<Record<MazeToonProfile, MazeToonProfileContract>>),
});

interface MazeToonMaterialState {
  profile: MazeToonProfile;
  previousOnBeforeCompile: THREE.Material['onBeforeCompile'];
  previousProgramCacheKey: THREE.Material['customProgramCacheKey'];
  toonOnBeforeCompile: THREE.Material['onBeforeCompile'];
  toonProgramCacheKey: THREE.Material['customProgramCacheKey'];
  originalRoughness: number;
  originalMetalness: number;
}

type ToonMaterial = THREE.MeshStandardMaterial | THREE.MeshPhysicalMaterial;

const GLOBAL_STATE_KEY = Symbol.for('daemok.mazeToonMaterialStates');
const globalRegistry = globalThis as typeof globalThis & { [key: symbol]: unknown };
const persistedStates = globalRegistry[GLOBAL_STATE_KEY];
const materialStates: WeakMap<ToonMaterial, MazeToonMaterialState> =
  persistedStates instanceof WeakMap ? persistedStates as WeakMap<ToonMaterial, MazeToonMaterialState> : new WeakMap();
globalRegistry[GLOBAL_STATE_KEY] = materialStates;

function shaderFloat(value: number) {
  return value.toFixed(4);
}

function profileForObject(object: THREE.Object3D): MazeToonProfile {
  let current: THREE.Object3D | null = object;
  while (current) {
    if (current.name.startsWith('maze-toon-actor')) return 'actor';
    if (current.name.startsWith('maze-toon-effect')) return 'effect';
    current = current.parent;
  }
  return 'environment';
}

function toonFragmentBlock(profile: MazeToonProfileContract) {
  const bandDivisor = Math.max(1, profile.shadeSteps - 1);
  return `
float mazeToonLuma = max(dot(max(outgoingLight, vec3(0.0)), vec3(0.2126, 0.7152, 0.0722)), 0.0001);
float mazeToonBaseLuma = max(dot(max(diffuseColor.rgb, vec3(0.0)), vec3(0.2126, 0.7152, 0.0722)), 0.045);
float mazeToonLighting = max(mazeToonLuma / mazeToonBaseLuma, 0.0001);
float mazeToonSignal = clamp(mazeToonLighting / 1.35, 0.0, 0.9999);
float mazeToonBand = floor(mazeToonSignal * ${shaderFloat(profile.shadeSteps)}) / ${shaderFloat(bandDivisor)};
float mazeToonTarget = mix(${shaderFloat(profile.darkestBand)}, ${shaderFloat(profile.brightestBand)}, mazeToonBand);
float mazeToonScale = mix(1.0, mazeToonTarget / mazeToonLighting, ${shaderFloat(profile.quantizeStrength)});
outgoingLight *= mazeToonScale;
float mazeToonFacing = abs(dot(normalize(normal), normalize(vViewPosition)));
float mazeToonRim = pow(1.0 - clamp(mazeToonFacing, 0.0, 1.0), ${shaderFloat(profile.rimPower)});
outgoingLight += diffuseColor.rgb * mazeToonRim * ${shaderFloat(profile.rimStrength)};
float mazeToonOutline = 1.0 - smoothstep(0.035, ${shaderFloat(profile.outlineWidth)}, mazeToonFacing);
vec3 mazeToonInk = max(diffuseColor.rgb * 0.34, vec3(0.025));
outgoingLight = mix(outgoingLight, mazeToonInk, mazeToonOutline * ${shaderFloat(profile.outlineStrength)});
`;
}

function isToonMaterial(material: THREE.Material): material is ToonMaterial {
  return material instanceof THREE.MeshStandardMaterial;
}

function uninstallMaterial(material: ToonMaterial) {
  const state = materialStates.get(material);
  if (!state) return;
  if (material.onBeforeCompile === state.toonOnBeforeCompile) {
    material.onBeforeCompile = state.previousOnBeforeCompile;
  }
  if (material.customProgramCacheKey === state.toonProgramCacheKey) {
    material.customProgramCacheKey = state.previousProgramCacheKey;
  }
  material.roughness = state.originalRoughness;
  material.metalness = state.originalMetalness;
  material.needsUpdate = true;
  materialStates.delete(material);
}

function installMaterial(material: ToonMaterial, profileId: MazeToonProfile) {
  const current = materialStates.get(material);
  if (current?.profile === profileId
    && material.onBeforeCompile === current.toonOnBeforeCompile
    && material.customProgramCacheKey === current.toonProgramCacheKey) return;
  if (current) uninstallMaterial(material);

  const profile = MAZE_TOON_RENDER_CONTRACT.profiles[profileId];
  const previousOnBeforeCompile = material.onBeforeCompile;
  const previousProgramCacheKey = material.customProgramCacheKey;
  const toonOnBeforeCompile: THREE.Material['onBeforeCompile'] = function toonOnBeforeCompile(shader, renderer) {
    previousOnBeforeCompile.call(this, shader, renderer);
    if (!shader.fragmentShader.includes('float mazeToonLuma')) {
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <opaque_fragment>',
        `${toonFragmentBlock(profile)}\n#include <opaque_fragment>`,
      );
    }
  };
  const toonProgramCacheKey: THREE.Material['customProgramCacheKey'] = function toonProgramCacheKey() {
    return `${previousProgramCacheKey.call(this)}|${MAZE_TOON_RENDER_CONTRACT.version}|${profileId}`;
  };

  materialStates.set(material, {
    profile: profileId,
    previousOnBeforeCompile,
    previousProgramCacheKey,
    toonOnBeforeCompile,
    toonProgramCacheKey,
    originalRoughness: material.roughness,
    originalMetalness: material.metalness,
  });
  material.onBeforeCompile = toonOnBeforeCompile;
  material.customProgramCacheKey = toonProgramCacheKey;
  material.roughness = Math.max(material.roughness, profile.minimumRoughness);
  material.metalness = Math.min(material.metalness, profile.maximumMetalness);
  material.needsUpdate = true;
}

export interface MazeToonDiagnostics {
  materialCount: number;
  actorMaterialCount: number;
  environmentMaterialCount: number;
  effectMaterialCount: number;
}

export function applyMazeToonRendering(root: THREE.Object3D): MazeToonDiagnostics {
  const materials = new Map<ToonMaterial, MazeToonProfile>();
  root.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh || !mesh.material) return;
    const profile = profileForObject(object);
    const source = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const material of source) {
      if (isToonMaterial(material)) materials.set(material, profile);
    }
  });

  const diagnostics: MazeToonDiagnostics = {
    materialCount: materials.size,
    actorMaterialCount: 0,
    environmentMaterialCount: 0,
    effectMaterialCount: 0,
  };
  for (const [material, profile] of materials) {
    installMaterial(material, profile);
    diagnostics[`${profile}MaterialCount`] += 1;
  }
  return diagnostics;
}

export function uninstallMazeToonRendering(root: THREE.Object3D) {
  root.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh || !mesh.material) return;
    const source = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const material of source) {
      if (isToonMaterial(material)) uninstallMaterial(material);
    }
  });
}
