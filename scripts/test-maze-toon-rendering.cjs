#!/usr/bin/env node

'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');
const ts = require('typescript');
const THREE = require('three');

const ROOT = path.resolve(__dirname, '..');

function loadTypeScript(relativePath, aliases = {}) {
  const filename = path.join(ROOT, relativePath);
  const source = fs.readFileSync(filename, 'utf8');
  const result = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
    fileName: filename,
    reportDiagnostics: true,
  });
  const diagnostics = result.diagnostics || [];
  if (diagnostics.length > 0) {
    throw new Error(ts.formatDiagnosticsWithColorAndContext(diagnostics, {
      getCanonicalFileName: (fileName) => fileName,
      getCurrentDirectory: () => ROOT,
      getNewLine: () => '\n',
    }));
  }

  const loaded = new Module(filename, module);
  loaded.filename = filename;
  loaded.paths = Module._nodeModulePaths(path.dirname(filename));
  loaded.require = (request) => Object.prototype.hasOwnProperty.call(aliases, request)
    ? aliases[request]
    : require(request);
  loaded._compile(result.outputText, filename);
  return loaded.exports;
}

function createShader() {
  return {
    vertexShader: 'void main() {}',
    fragmentShader: [
      'void main() {',
      '  vec3 outgoingLight = vec3(1.0);',
      '  vec4 diffuseColor = vec4(1.0);',
      '  vec3 normal = vec3(0.0, 1.0, 0.0);',
      '  vec3 vViewPosition = vec3(0.0, 0.0, 1.0);',
      '  #include <opaque_fragment>',
      '}',
    ].join('\n'),
    uniforms: {},
  };
}

function countOccurrences(source, token) {
  return source.split(token).length - 1;
}

function srgbChannel(value) {
  const channel = value / 255;
  return channel <= 0.04045
    ? channel / 12.92
    : ((channel + 0.055) / 1.055) ** 2.4;
}

function relativeLuminance(hex) {
  const channels = hex.slice(1).match(/.{2}/g).map((value) => Number.parseInt(value, 16));
  return 0.2126 * srgbChannel(channels[0]) +
    0.7152 * srgbChannel(channels[1]) +
    0.0722 * srgbChannel(channels[2]);
}

function contrastRatio(first, second) {
  const a = relativeLuminance(first);
  const b = relativeLuminance(second);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

const EXPECTED_BLENDER_ASSETS = Object.freeze({
  rabbitPawn: ['rabbit-pawn', 'rabbit-pawn.glb'],
  tileCream: ['tile-cream', 'tile-cream.glb'],
  tileSage: ['tile-sage', 'tile-sage.glb'],
  boardBase: ['board-base', 'board-base.glb'],
  markerStart: ['marker-start', 'marker-start.glb'],
  markerGoal: ['marker-goal', 'marker-goal.glb'],
  wallNormal: ['wall-normal', 'wall-normal.glb'],
  wallSteel: ['wall-steel', 'wall-steel.glb'],
  wallFire: ['wall-fire', 'wall-fire.glb'],
  wallPoison: ['wall-poison', 'wall-poison.glb'],
  wallIce: ['wall-ice', 'wall-ice.glb'],
  wallWind: ['wall-wind', 'wall-wind.glb'],
  wallPhase: ['wall-phase', 'wall-phase.glb'],
  wallThorn: ['wall-thorn', 'wall-thorn.glb'],
  wallCrystal: ['wall-crystal', 'wall-crystal.glb'],
  wallFog: ['wall-fog', 'wall-fog.glb'],
  wallIllusion: ['wall-illusion', 'wall-illusion.glb'],
  wallCollapse: ['wall-collapse', 'wall-collapse.glb'],
  wallMirror: ['wall-mirror', 'wall-mirror.glb'],
  goalFlag: ['goal-flag', 'goal-flag.glb'],
  goalLock: ['goal-lock', 'goal-lock.glb'],
  itemMine: ['item-mine', 'item-mine.glb'],
  itemMineUsed: ['item-mine-used', 'item-mine-used.glb'],
  itemSmoke: ['item-smoke', 'item-smoke.glb'],
  itemSmokeUsed: ['item-smoke-used', 'item-smoke-used.glb'],
  wormholePortal: ['wormhole-portal', 'wormhole-portal.glb'],
  legacySealDie: ['legacy-seal-die', 'legacy-seal-die.glb'],
  wormholeBoardBase: ['wormhole-board-base', 'wormhole-board-base.glb'],
  wormholeDie: ['wormhole-die', 'wormhole-die.glb'],
  wormholeRock: ['wormhole-rock', 'wormhole-rock.glb'],
  wormholeTargetPad: ['wormhole-target-pad', 'wormhole-target-pad.glb'],
});
const EXPECTED_MAIN_ASSET_IDS = Object.freeze([
  'rabbitPawn', 'tileCream', 'tileSage', 'boardBase', 'markerStart', 'markerGoal',
  'wallNormal', 'wallSteel', 'wallFire', 'wallPoison', 'wallIce', 'wallWind',
  'wallPhase', 'wallThorn', 'wallCrystal', 'wallFog', 'wallIllusion', 'wallCollapse', 'wallMirror',
  'goalFlag', 'goalLock', 'itemMine', 'itemMineUsed', 'itemSmoke', 'itemSmokeUsed',
  'wormholePortal', 'legacySealDie',
]);
const EXPECTED_WORMHOLE_ASSET_IDS = Object.freeze([
  'tileCream', 'tileSage', 'markerStart', 'wormholeBoardBase', 'wormholeDie',
  'wormholeRock', 'wormholeTargetPad',
]);

function parseGlb(filePath) {
  const payload = fs.readFileSync(filePath);
  assert.ok(payload.length >= 20, `${path.basename(filePath)} has a complete GLB header and JSON chunk`);
  assert.equal(payload.toString('ascii', 0, 4), 'glTF', `${path.basename(filePath)} uses the GLB magic`);
  assert.equal(payload.readUInt32LE(4), 2, `${path.basename(filePath)} uses glTF 2`);
  assert.equal(payload.readUInt32LE(8), payload.length, `${path.basename(filePath)} declares its exact byte length`);

  let json = null;
  let offset = 12;
  while (offset < payload.length) {
    assert.ok(offset + 8 <= payload.length, `${path.basename(filePath)} has a complete chunk header`);
    const chunkLength = payload.readUInt32LE(offset);
    const chunkType = payload.readUInt32LE(offset + 4);
    const chunkStart = offset + 8;
    const chunkEnd = chunkStart + chunkLength;
    assert.ok(chunkEnd <= payload.length, `${path.basename(filePath)} chunk stays within the file`);
    if (chunkType === 0x4e4f534a) {
      assert.equal(json, null, `${path.basename(filePath)} has exactly one JSON chunk`);
      const source = payload.toString('utf8', chunkStart, chunkEnd).replace(/[\u0000\u0020]+$/u, '');
      json = JSON.parse(source);
    }
    offset = chunkEnd;
  }

  assert.equal(offset, payload.length, `${path.basename(filePath)} chunks consume the full file`);
  assert.ok(json, `${path.basename(filePath)} contains a JSON chunk`);
  return { json, payload };
}

function parseStringObjectEntries(body) {
  return Object.fromEntries(
    Array.from(body.matchAll(/^\s*([A-Za-z][A-Za-z0-9]*):\s*['"]([^'"]+)['"],?\s*$/gm))
      .map((match) => [match[1], match[2]])
  );
}

function parseAssetSet(source, declarationName) {
  const match = source.match(new RegExp(
    `export\\s+const\\s+${declarationName}\\s*=\\s*Object\\.freeze\\(\\[([\\s\\S]*?)\\]\\s+as\\s+const\\s+satisfies`,
  ));
  assert.ok(match, `${declarationName} is an immutable typed asset subset`);
  return Array.from(match[1].matchAll(/['"]([A-Za-z][A-Za-z0-9]*)['"]/g), (entry) => entry[1]);
}

function testBlenderAssetContract(boardSource) {
  const assetSourcePath = path.join(ROOT, 'src', 'components', 'three', 'MazeCartoonAssets.tsx');
  const assetSource = fs.readFileSync(assetSourcePath, 'utf8');
  const catalogMatch = assetSource.match(
    /export\s+const\s+MAZE_CARTOON_ASSET_PATHS\s*=\s*Object\.freeze\(\{([\s\S]*?)\}\);/
  );
  assert.ok(catalogMatch, 'the Blender asset catalog is an immutable exported object');
  const actualPaths = parseStringObjectEntries(catalogMatch[1]);
  const expectedPaths = Object.fromEntries(
    Object.entries(EXPECTED_BLENDER_ASSETS)
      .map(([assetId, [, fileName]]) => [assetId, `/assets/maze/v1/${fileName}`])
  );
  assert.deepEqual(actualPaths, expectedPaths, 'the runtime catalog contains exactly the approved 31 Blender assets');
  assert.deepEqual(
    parseAssetSet(assetSource, 'MAZE_CARTOON_MAIN_ASSET_IDS'),
    EXPECTED_MAIN_ASSET_IDS,
    'main canvases load only their 27 required Blender assets',
  );
  assert.deepEqual(
    parseAssetSet(assetSource, 'MAZE_CARTOON_WORMHOLE_ASSET_IDS'),
    EXPECTED_WORMHOLE_ASSET_IDS,
    'V2 wormhole canvases load only their seven required Blender assets',
  );

  assert.match(
    assetSource,
    /MAZE_CARTOON_ASSET_VERSION\s*=\s*['"]blender-cartoon-v1['"]/,
    'the imported models expose a stable version contract'
  );
  assert.match(
    assetSource,
    /useGLTF\.preload\(ASSET_URLS_BY_SET\[assetSet\],\s*false,\s*true\)/,
    'subset preload disables the external Draco decoder while retaining bundled Meshopt support'
  );
  assert.match(
    assetSource,
    /const\s+loaded\s*=\s*useGLTF\(assetUrls,\s*false,\s*true\)/,
    'runtime subset loading uses the same decoder-independent contract'
  );
  assert.match(assetSource, /const\s+object\s*=\s*source\.clone\(true\)/, 'each model gets its own object hierarchy');
  assert.match(assetSource, /next\s*=\s*sourceMaterial\.clone\(\)/, 'Blender source materials are never mutated in place');
  assert.match(
    assetSource,
    /const\s+materialCache\s*=\s*useRef\(new\s+Map<string,\s*THREE\.Material>\(\)\)/,
    'materials are cached inside each Canvas provider'
  );
  assert.match(assetSource, /for\s*\(const\s+cached\s+of\s+canvasMaterialCache\.values\(\)\)\s+cached\.dispose\(\)/, 'Canvas-local material clones are disposed');
  assert.match(assetSource, /mesh\.raycast\s*=\s*\(\)\s*=>\s*\{\}/, 'decorative Blender meshes cannot steal gameplay pointer events');
  assert.match(assetSource, /return\s+<primitive\s+object=\{object\}\s+dispose=\{null\}\s*\/>/, 'React never disposes cached GLTF geometry per instance');
  assert.match(assetSource, /mazeAssetState\s*=\s*['"]ready['"]/, 'the Canvas advertises completed Blender asset loading');
  assert.match(assetSource, /mazeAssetCatalogCount\s*=\s*String\(MAZE_CARTOON_ASSET_CATALOG_COUNT\)/, 'each Canvas exposes the full 31-asset catalog count');
  assert.match(assetSource, /mazeAssetSet\s*=\s*assetSet/, 'each Canvas identifies its loaded asset subset');

  assert.match(boardSource, /preloadMazeCartoonAssets\(\)/, 'GameBoard3D primes the Blender catalog before rendering');
  assert.match(
    boardSource,
    /data-maze-asset-version=\{MAZE_CARTOON_ASSET_VERSION\}/,
    'the board wrapper exposes the Blender asset version'
  );
  assert.match(
    boardSource,
    /<Suspense\s+fallback=\{<MazeCartoonAssetLoadingState\s*\/>\}>\s*<MazeCartoonAssetProvider>[\s\S]*?<BoardContents\s+\{\.\.\.props\}\s+reducedMotion=\{reducedMotion\}\s*\/>[\s\S]*?<\/MazeCartoonAssetProvider>\s*<\/Suspense>/,
    'board content only mounts inside the Canvas-local asset provider after loading'
  );

  assert.match(boardSource, /const\s+tileAsset\s*=\s*checker\s*\?\s*['"]tileCream['"]\s*:\s*['"]tileSage['"]/, 'checkerboard cells select the two approved Blender tiles');
  assert.match(boardSource, /<MazeCartoonAsset\s+assetId=\{tileAsset\}[\s\S]*?noOutline\s*\/>/, 'tiles use their Blender models without per-cell outline draw calls');
  assert.match(boardSource, /<MazeCartoonAsset\s+assetId=["']boardBase["']\s+variant=["']board-base["']\s*\/>/, 'the board base uses the Blender model');
  assert.match(boardSource, /<MazeCartoonAsset\s+assetId=["']markerStart["']\s+variant=["']start["']\s*\/>/, 'the start marker uses the Blender model');
  assert.match(boardSource, /<MazeCartoonAsset[\s\S]*?assetId=["']markerGoal["'][\s\S]*?variant=\{locked\s*\?\s*['"]goal-locked['"]\s*:\s*['"]goal['"]\}/, 'the goal marker uses the Blender model and preserves its locked state');

  const ordinaryWallMatch = boardSource.match(
    /function\s+WallBox\s*\([^]*?\n\}\n\ninterface\s+SpecialWallStyle/
  );
  assert.ok(ordinaryWallMatch, 'the ordinary wall renderer remains isolated');
  const ordinaryWallBody = ordinaryWallMatch[0].split('{preview && (')[0];
  assert.match(ordinaryWallBody, /<MazeCartoonAsset\s+assetId=["']wallNormal["']/, 'every ordinary wall state uses wall-normal.glb');
  assert.doesNotMatch(
    ordinaryWallBody,
    /<boxGeometry\b|<meshStandardMaterial\b/,
    'the ordinary wall body is no longer reconstructed from procedural primitives (preview FX remain independent)'
  );

  const specialCatalogMatch = boardSource.match(
    /const\s+SPECIAL_WALL_ASSETS:[^=]+\s*=\s*\{([\s\S]*?)\};/
  );
  assert.ok(specialCatalogMatch, 'the Blender special-wall catalog exists');
  assert.deepEqual(parseStringObjectEntries(specialCatalogMatch[1]), {
    steelWall: 'wallSteel',
    fireWall: 'wallFire',
    poisonWall: 'wallPoison',
    iceWall: 'wallIce',
    windWall: 'wallWind',
    phaseWall: 'wallPhase',
    thornWall: 'wallThorn',
    crystalWall: 'wallCrystal',
    collapseWall: 'wallCollapse',
    mirrorWall: 'wallMirror',
    fogWall: 'wallFog',
    illusionWall: 'wallIllusion',
  }, 'all twelve special walls map one-to-one to their Blender models');
  assert.match(
    boardSource,
    /const\s+assetId\s*=\s*SPECIAL_WALL_ASSETS\[props\.type\];\s*if\s*\(assetId\)\s*return\s*<BlenderSpecialWallBox\s+\{\.\.\.props\}\s+assetId=\{assetId\}\s*\/>;\s*return\s*<LegacySpecialWallBox\s+\{\.\.\.props\}\s*\/>;/,
    'all current walls use Blender while malformed legacy data retains a safe fallback'
  );
  assert.match(
    boardSource,
    /useMazeCartoonAssetInstance\(assetId,\s*\{[\s\S]*?variant:\s*`\$\{type\}-\$\{stateName\}`,[\s\S]*?opacity,[\s\S]*?emissiveScale:/,
    'special-wall GLBs preserve consumed and phase-open visual states'
  );

  const goalFlagMatch = boardSource.match(/function\s+GoalFlag\s*\([^]*?(?=\n\nfunction\s+SealDie)/);
  assert.ok(goalFlagMatch, 'the goal renderer remains isolated');
  assert.match(goalFlagMatch[0], /assetId=["']goalFlag["']/, 'the complete goal flag uses its Blender model');
  assert.match(goalFlagMatch[0], /assetId=["']goalLock["']/, 'the locked goal uses its Blender lock model');
  assert.doesNotMatch(goalFlagMatch[0], /<(?:mesh|RoundedBox)\b/, 'the goal no longer rebuilds flag parts from primitives');

  const sealMatch = boardSource.match(/function\s+SealDie\s*\([^]*?(?=\n\nconst\s+FIRE_AURA_POINTS)/);
  assert.ok(sealMatch, 'the legacy seal renderer remains isolated');
  assert.match(sealMatch[0], /assetId=["']legacySealDie["']/, 'legacy seals use the complete Blender die marker');
  assert.match(sealMatch[0], /tintMaterialName=\{activated\s*\?\s*['"]mat_legacy_seal_die_accent['"]\s*:\s*undefined\}/, 'activated legacy seals retain their green state through the authored accent material');
  assert.doesNotMatch(sealMatch[0], /<(?:mesh|RoundedBox)\b/, 'legacy seals no longer rebuild a die or ring from primitives');

  const mineMatch = boardSource.match(/function\s+MineVisual\s*\([^]*?(?=\n\nfunction\s+SmokeVisual)/);
  assert.ok(mineMatch, 'the mine renderer remains isolated');
  assert.match(mineMatch[0], /consumed\s*\?\s*["']itemMineUsed["']\s*:\s*["']itemMine["']/, 'mine states select their dedicated Blender models');
  assert.doesNotMatch(mineMatch[0], /<(?:mesh|RoundedBox)\b/, 'mine bodies are no longer procedural primitives');

  const smokeMatch = boardSource.match(/function\s+SmokeVisual\s*\([^]*?(?=\n\nfunction\s+WormholeVisual)/);
  assert.ok(smokeMatch, 'the smoke renderer remains isolated');
  assert.match(smokeMatch[0], /consumed\s*\?\s*["']itemSmokeUsed["']\s*:\s*["']itemSmoke["']/, 'smoke states select their dedicated Blender models');
  assert.doesNotMatch(smokeMatch[0], /<(?:mesh|RoundedBox)\b/, 'smoke bodies are no longer procedural primitives');

  const wormholeMatch = boardSource.match(/function\s+WormholeVisual\s*\([^]*?(?=\n\n\/\/ ===== 보드 내용물 =====)/);
  assert.ok(wormholeMatch, 'the main-board wormhole renderer remains isolated');
  assert.equal(countOccurrences(wormholeMatch[0], 'assetId="wormholePortal"'), 2, 'entrance and exit both use the Blender portal');
  assert.match(wormholeMatch[0], /entranceRef\.current\.rotation\.y\s*\+=/, 'the entrance keeps its runtime spin');
  assert.match(wormholeMatch[0], /exitRef\.current\.rotation\.y\s*-=/, 'the exit keeps its counter-rotation');
  assert.doesNotMatch(wormholeMatch[0], /<(?:mesh|RoundedBox)\b/, 'portal bodies are no longer procedural primitives');

  const pawnMatch = boardSource.match(/function\s+Pawn\s*\([^]*?\n\}\n\n\/\/ ===== 액션 이펙트 =====/);
  assert.ok(pawnMatch, 'the animated Pawn wrapper remains isolated');
  assert.match(pawnMatch[0], /<MazeCartoonAsset\s+assetId=["']rabbitPawn["'][\s\S]*?profile=["']actor["']/, 'Pawn animation wraps the Blender rabbit model');
  assert.match(pawnMatch[0], /tintMaterialName=["']mat_rabbit_player_accent["']\s+tintColor=\{color\}/, 'only the rabbit player-accent material receives the player color');
  assert.doesNotMatch(pawnMatch[0], /<(?:mesh|RoundedBox)\b/, 'Pawn no longer rebuilds the rabbit body from procedural primitives');

  const assetDir = path.join(ROOT, 'public', 'assets', 'maze', 'v1');
  const manifest = JSON.parse(fs.readFileSync(path.join(assetDir, 'manifest.json'), 'utf8'));
  assert.equal(manifest.assets['wall-normal'].meshes, 1, 'revealed ordinary and fake walls share one plain red Blender block');
  assert.equal(manifest.version, 1, 'Blender asset manifest version stays stable');
  assert.equal(manifest.coordinateSystem, 'glTF Y-up; +Z forward; ground anchor at Y=0', 'runtime and Blender agree on axes');
  assert.equal(manifest.tileSize, 1, 'Blender tiles match TILE=1');
  assert.equal(manifest.wallLength, 1.084, 'Blender walls match TILE + GAP * 0.6');
  assert.equal(manifest.wallHeight, 0.5, 'Blender walls match WALL_HEIGHT');
  assert.equal(manifest.wallDepth, 0.16, 'Blender walls match WALL_THICKNESS');

  const expectedManifestNames = Object.values(EXPECTED_BLENDER_ASSETS).map(([name]) => name).sort();
  assert.deepEqual(Object.keys(manifest.assets).sort(), expectedManifestNames, 'manifest contains exactly the runtime asset catalog');
  let totalBytes = 0;
  for (const [assetId, [manifestName, fileName]] of Object.entries(EXPECTED_BLENDER_ASSETS)) {
    const entry = manifest.assets[manifestName];
    assert.ok(entry, `${assetId} has a manifest entry`);
    assert.equal(entry.file, fileName, `${assetId} manifest and runtime filename agree`);
    const { json, payload } = parseGlb(path.join(assetDir, fileName));
    totalBytes += payload.length;
    assert.equal(entry.bytes, payload.length, `${assetId} manifest byte count is current`);
    assert.equal(
      entry.sha256,
      crypto.createHash('sha256').update(payload).digest('hex'),
      `${assetId} manifest hash is current`
    );
    assert.equal(json.asset?.version, '2.0', `${assetId} embeds glTF 2.0 JSON`);
    assert.ok(json.nodes?.some((node) => node.name === entry.root), `${assetId} contains its declared root node`);
    assert.equal(json.images?.length ?? 0, 0, `${assetId} has no texture payload`);
    for (const buffer of json.buffers || []) {
      assert.ok(!buffer.uri, `${assetId} keeps binary data inside its GLB`);
    }
    assert.ok(
      !(json.extensionsRequired || []).includes('KHR_draco_mesh_compression'),
      `${assetId} does not require the external Draco decoder`
    );
    for (const mesh of json.meshes || []) {
      for (const primitive of mesh.primitives || []) {
        assert.ok(!primitive.extensions?.KHR_draco_mesh_compression, `${assetId} primitives are not Draco-compressed`);
      }
    }
  }
  assert.ok(totalBytes <= 1024 * 1024, 'the complete 31-model Blender maze catalog stays within the 1 MiB transfer budget');
}

function createMaterialFixture(MaterialType, label, roughness, metalness) {
  const material = new MaterialType({ color: 0xffffff, roughness, metalness });
  const originalOnBeforeCompile = function originalOnBeforeCompile(shader) {
    shader.fragmentShader = `// original-hook:${label}\n${shader.fragmentShader}`;
  };
  const originalProgramCacheKey = function originalProgramCacheKey() {
    return `original-program:${label}`;
  };
  material.onBeforeCompile = originalOnBeforeCompile;
  material.customProgramCacheKey = originalProgramCacheKey;
  return {
    material,
    originalOnBeforeCompile,
    originalProgramCacheKey,
    originalRoughness: roughness,
    originalMetalness: metalness,
  };
}

function addProfileMesh(root, name, material) {
  const profileRoot = new THREE.Group();
  profileRoot.name = name;
  const geometry = new THREE.BoxGeometry(1, 1, 1);
  const mesh = new THREE.Mesh(geometry, material);
  profileRoot.add(mesh);
  root.add(profileRoot);
  return { geometry, mesh, profileRoot };
}

function assertMaterialInstalled(fixture, profile, contract) {
  const { material, originalOnBeforeCompile, originalProgramCacheKey } = fixture;
  assert.notStrictEqual(material.onBeforeCompile, originalOnBeforeCompile, `${profile}: shader hook installed`);
  assert.notStrictEqual(material.customProgramCacheKey, originalProgramCacheKey, `${profile}: program key installed`);
  assert.equal(
    material.customProgramCacheKey(),
    `original-program:${profile}|${contract.version}|${profile}`,
    `${profile}: profile and contract version participate in the program cache key`
  );

  const shader = createShader();
  material.onBeforeCompile(shader, {});
  assert.match(shader.fragmentShader, new RegExp(`original-hook:${profile}`));
  assert.match(shader.fragmentShader, /float mazeToonLuma/);
  assert.match(shader.fragmentShader, /float mazeToonBand/);
  assert.match(shader.fragmentShader, /float mazeToonRim/);
  assert.match(shader.fragmentShader, /float mazeToonOutline/);
  assert.equal(countOccurrences(shader.fragmentShader, 'float mazeToonLuma'), 1);
  assert.equal(countOccurrences(shader.fragmentShader, '#include <opaque_fragment>'), 1);

  material.onBeforeCompile(shader, {});
  assert.equal(
    countOccurrences(shader.fragmentShader, 'float mazeToonLuma'),
    1,
    `${profile}: repeated shader compilation cannot inject a second toon block`
  );
}

function testMaterialLifecycle(toon) {
  const root = new THREE.Group();
  const actor = createMaterialFixture(THREE.MeshStandardMaterial, 'actor', 0.15, 0.9);
  const environment = createMaterialFixture(THREE.MeshPhysicalMaterial, 'environment', 0.2, 0.8);
  const effect = createMaterialFixture(THREE.MeshStandardMaterial, 'effect', 0.1, 0.95);
  const ignored = new THREE.MeshBasicMaterial({ color: 0xffffff });

  const meshes = [
    addProfileMesh(root, 'maze-toon-actor-player', actor.material),
    addProfileMesh(root, 'board-environment', environment.material),
    addProfileMesh(root, 'maze-toon-effect-radar', effect.material),
    addProfileMesh(root, 'ignored-basic-material', ignored),
  ];

  try {
    const diagnostics = toon.applyMazeToonRendering(root);
    assert.deepEqual(diagnostics, {
      materialCount: 3,
      actorMaterialCount: 1,
      environmentMaterialCount: 1,
      effectMaterialCount: 1,
      outlineMeshCount: 2,
    });

    assert.ok(actor.material instanceof THREE.MeshStandardMaterial);
    assert.ok(environment.material instanceof THREE.MeshPhysicalMaterial);
    assert.equal(actor.material.roughness, 0.68, 'actor roughness clamps upward');
    assert.equal(actor.material.metalness, 0.18, 'actor metalness clamps downward');
    assert.equal(environment.material.roughness, 0.76, 'physical environment roughness clamps upward');
    assert.equal(environment.material.metalness, 0.12, 'physical environment metalness clamps downward');
    assert.equal(effect.material.roughness, 0.54, 'effect roughness clamps upward');
    assert.equal(effect.material.metalness, 0.2, 'effect metalness clamps downward');

    assertMaterialInstalled(actor, 'actor', toon.MAZE_TOON_RENDER_CONTRACT);
    assertMaterialInstalled(environment, 'environment', toon.MAZE_TOON_RENDER_CONTRACT);
    assertMaterialInstalled(effect, 'effect', toon.MAZE_TOON_RENDER_CONTRACT);

    const installedState = [actor, environment, effect].map(({ material }) => ({
      onBeforeCompile: material.onBeforeCompile,
      customProgramCacheKey: material.customProgramCacheKey,
      programKey: material.customProgramCacheKey(),
      roughness: material.roughness,
      metalness: material.metalness,
      version: material.version,
    }));

    const reappliedDiagnostics = toon.applyMazeToonRendering(root);
    assert.deepEqual(reappliedDiagnostics, diagnostics, 'idempotent reapply keeps diagnostics stable');
    [actor, environment, effect].forEach(({ material }, index) => {
      const installed = installedState[index];
      assert.strictEqual(material.onBeforeCompile, installed.onBeforeCompile, 'reapply keeps shader hook identity');
      assert.strictEqual(
        material.customProgramCacheKey,
        installed.customProgramCacheKey,
        'reapply keeps program key hook identity'
      );
      assert.equal(material.customProgramCacheKey(), installed.programKey);
      assert.equal(material.roughness, installed.roughness);
      assert.equal(material.metalness, installed.metalness);
      assert.equal(material.version, installed.version, 'idempotent reapply does not trigger a material rebuild');
    });

    toon.uninstallMazeToonRendering(root);
    for (const fixture of [actor, environment, effect]) {
      assert.strictEqual(
        fixture.material.onBeforeCompile,
        fixture.originalOnBeforeCompile,
        'uninstall restores the original shader hook'
      );
      assert.strictEqual(
        fixture.material.customProgramCacheKey,
        fixture.originalProgramCacheKey,
        'uninstall restores the original program key hook'
      );
      assert.equal(fixture.material.customProgramCacheKey(), `original-program:${fixture === actor ? 'actor' : fixture === environment ? 'environment' : 'effect'}`);
      assert.equal(fixture.material.roughness, fixture.originalRoughness, 'uninstall restores roughness');
      assert.equal(fixture.material.metalness, fixture.originalMetalness, 'uninstall restores metalness');
    }

    const versionsAfterUninstall = [actor, environment, effect].map(({ material }) => material.version);
    toon.uninstallMazeToonRendering(root);
    [actor, environment, effect].forEach(({ material }, index) => {
      assert.equal(material.version, versionsAfterUninstall[index], 'repeated uninstall is idempotent');
    });
  } finally {
    toon.uninstallMazeToonRendering(root);
    meshes.forEach(({ geometry }) => geometry.dispose());
    actor.material.dispose();
    environment.material.dispose();
    effect.material.dispose();
    ignored.dispose();
  }
}

function testGameBoardSourceContract() {
  const sourcePath = path.join(ROOT, 'src', 'components', 'three', 'GameBoard3D.tsx');
  const source = fs.readFileSync(sourcePath, 'utf8');
  testBlenderAssetContract(source);

  assert.match(source, /<Canvas\s+[\s\S]*?\borthographic\b/, 'GameBoard3D Canvas stays orthographic');
  assert.match(
    source,
    /camera\s+instanceof\s+THREE\.OrthographicCamera/,
    'fixed camera controller requires an OrthographicCamera'
  );
  assert.match(
    source,
    /CAMERA_ELEVATION_WIDE_DEG\s*=\s*53/,
    'wide boards use the slightly lower 53-degree diorama view'
  );
  assert.match(
    source,
    /CAMERA_ELEVATION_PORTRAIT_DEG\s*=\s*60/,
    'portrait boards use the slightly lower 60-degree overview'
  );
  assert.match(
    source,
    /const\s+maximumDpr\s*=\s*compact\s*\?\s*1\.5\s*:\s*size\.width\s*<=\s*700\s*\?\s*1\.5\s*:\s*2/,
    'compact boards keep a sharpness-preserving DPR cap while full quality stays at 1.5 on mobile'
  );
  assert.match(
    source,
    /Math\.min\(deviceDpr\s*\|\|\s*1,\s*maximumDpr\)/,
    'runtime DPR is clamped through the declared quality cap'
  );
  assert.match(
    source,
    /gl\.outputColorSpace\s*=\s*THREE\.SRGBColorSpace/,
    'renderer output stays in sRGB color space'
  );
  assert.match(
    source,
    /gl\.toneMapping\s*=\s*THREE\.ACESFilmicToneMapping/,
    'renderer keeps ACES filmic tone mapping'
  );
  assert.match(
    source,
    /gl\.shadowMap\.type\s*=\s*THREE\.PCFShadowMap/,
    'renderer keeps PCF shadow filtering'
  );
  assert.doesNotMatch(source, /\bOrbitControls\b/, 'interactive OrbitControls must not return');
  assert.match(
    source,
    /data-testid=["']game-board-3d["']/,
    'the existing game-board-3d test id remains stable'
  );
  assert.match(
    source,
    /data-maze-render-style=["']inked-toy["']/,
    'the 3D board advertises the high-contrast inked-toy style'
  );

  const color = (name) => {
    const match = source.match(new RegExp(`${name}:\\s*['\"](#[0-9a-fA-F]{6})['\"]`));
    assert.ok(match, `${name}: palette color exists`);
    return match[1];
  };
  const tileA = color('tileA');
  const tileB = color('tileB');
  const wall = color('wall');
  const base = color('base');
  const baseSide = color('baseSide');
  assert.equal(wall.toLowerCase(), '#6b1111', 'ordinary wall keeps the requested dark-red color');
  assert.ok(relativeLuminance(tileA) >= 0.85, 'tile A remains a bright passable cream floor');
  assert.ok(relativeLuminance(tileB) >= 0.8, 'tile B remains a bright passable sage floor');
  assert.ok(relativeLuminance(base) >= 0.6, 'the exposed floor between tiles remains bright');
  assert.ok(contrastRatio(wall, tileA) >= 7, 'ordinary wall has at least 7:1 nominal contrast against tile A');
  assert.ok(contrastRatio(wall, tileB) >= 7, 'ordinary wall has at least 7:1 nominal contrast against tile B');
  assert.ok(contrastRatio(wall, base) >= 7, 'ordinary wall has at least 7:1 nominal contrast against exposed floor');
  assert.ok(contrastRatio(base, tileA) >= 1.4, 'the passable tile edge remains visible against the exposed floor');
  assert.ok(contrastRatio(baseSide, base) >= 3, 'the board edge remains distinct from the bright play surface');
  assert.match(source, /data-maze-floor-tone=["']cream-sage["']/, '3D board advertises its bright floor contrast contract');

  assert.doesNotMatch(source, /\bFakeWallBox\b/, '3D fake wall has no identity-specific mesh');
  assert.doesNotMatch(source, /\bfakeWall\s*:/, '3D palette has no fake-wall-only color');
  assert.doesNotMatch(
    source,
    /\bdistinguishOneTimeWalls\b/,
    '3D callers cannot opt into an identity-revealing fake-wall mode'
  );

  const disguisedOneTimeWallBranch = source.match(
    /if\s*\(item\.type\s*===\s*['"]oneTimeWall['"]\s*&&[\s\S]*?\)\s*\{([\s\S]*?)\n\s*\}\n\n\s*if\s*\(\s*isWallItemType/
  );
  assert.ok(
    disguisedOneTimeWallBranch,
    '3D oneTimeWall keeps one isolated rendering branch'
  );
  const disguisedWallReturn = disguisedOneTimeWallBranch[1];
  assert.match(
    disguisedWallReturn,
    /\?\s*<WallBox\s+seg=\{seg\}\s+color=\{COLORS\.wall\}\s*\/>/,
    '3D setup renders oneTimeWall through the same opaque Blender-backed WallBox'
  );
  assert.match(
    disguisedWallReturn,
    /:\s*<WallBox\s+seg=\{seg\}\s+color=\{COLORS\.wall\}\s*\/>/,
    '3D reveal renders oneTimeWall through the same opaque red Blender-backed WallBox contract'
  );
  assert.doesNotMatch(
    disguisedWallReturn,
    /\bSpecialWallBox\b|meshStandardMaterial|boxGeometry/,
    '3D oneTimeWall cannot introduce a special material or geometry'
  );
  assert.match(
    source,
    /<WallBox\s+key=\{`ob-\$\{segmentKey\(seg\)\}`\}\s+seg=\{seg\}\s+color=\{COLORS\.wall\}\s*\/>/,
    'ordinary 3D walls use the same Blender-backed WallBox contract'
  );
  assert.match(
    source,
    /<WallBox\s+key=\{`rev-\$\{segmentKey\(seg\)\}`\}\s+seg=\{seg\}\s+color=\{COLORS\.wall\}\s*\/>/,
    'revealed ordinary walls stay opaque red Blender blocks'
  );
  assert.doesNotMatch(
    source,
    /\bCOLORS\.reveal\b|key=\{`rev-[^`]+`\}[^>]*opacity=/,
    'revealed ordinary walls do not use a translucent identity treatment'
  );

  const board2DPath = path.join(ROOT, 'src', 'components', 'GameBoard.tsx');
  const board2DSource = fs.readFileSync(board2DPath, 'utf8');
  const normalWallStyle = board2DSource.match(
    /const\s+NORMAL_WALL_STYLE\s*=\s*['"]([^'"]+)['"]/
  );
  assert.ok(normalWallStyle, '2D normal-wall shared style exists');
  assert.match(normalWallStyle[1], /bg-\[#6b1111\]/, '2D normal wall uses the dark-red color');
  assert.ok(
    normalWallStyle[1].includes(wall),
    '2D and 3D ordinary wall contracts use the same dark-red color value'
  );
  assert.match(
    board2DSource,
    /const\s+PASSABLE_FLOOR_STYLES\s*=\s*\['bg-\[#fffaf0\]',\s*'bg-\[#eff7df\]'\]\s+as\s+const/,
    '2D passable cells use the same bright cream and sage colors as the 3D tiles'
  );
  assert.match(
    board2DSource,
    /const\s+BOARD_FLOOR_STYLE\s*=\s*['"]bg-\[#c7d7b3\]['"]/,
    '2D wall slots expose the same bright floor color as the 3D tile gaps'
  );
  assert.match(
    board2DSource,
    /data-maze-floor-tone=["']cream-sage["']/,
    '2D setup board advertises its bright floor contrast contract'
  );
  assert.match(
    board2DSource,
    /const\s+ITEM_WALL_STYLES:\s*Record<SpecialWallType,\s*string>/,
    '2D fake wall is excluded from special-wall color styles'
  );
  assert.doesNotMatch(
    board2DSource,
    /oneTimeWall\s*:\s*['"][^'"]*(?:bg-|ring-)/,
    '2D fake wall has no separate color or ring style'
  );
  assert.match(
    board2DSource,
    /if\s*\(type\s*===\s*['"]oneTimeWall['"]\)\s*\{\s*return\s*<NormalWallVisual\s+orientation=\{orientation\}\s+preview=\{preview\}\s*\/>;\s*\}/,
    '2D wall-item preview delegates oneTimeWall to NormalWallVisual'
  );
  const board2DOneTimeWallBranch = board2DSource.match(
    /if\s*\(item\.type\s*===\s*['"]oneTimeWall['"]\)\s*\{([\s\S]*?)\n\s*\}\n\n\s*const\s+active/
  );
  assert.ok(board2DOneTimeWallBranch, '2D installed oneTimeWall branch exists');
  assert.match(
    board2DOneTimeWallBranch[1],
    /<NormalWallVisual\s+orientation=\{orientation\}\s*\/>/,
    '2D installed oneTimeWall delegates to the ordinary wall component'
  );
  assert.doesNotMatch(
    board2DOneTimeWallBranch[1],
    /data-map-item|data-wall-effect|ITEM_WALL_STYLES|title=/,
    '2D oneTimeWall does not expose identity-specific markup or styling'
  );

  assert.match(source, /function\s+PawnFireAura\s*\(/, 'the pawn has a persistent fire aura');
  assert.match(source, /function\s+PawnPoisonAura\s*\(/, 'the pawn has a persistent poison aura');
  assert.match(
    source,
    /type:\s*['"]bump['"][^;]+['"]fire['"][^;]+['"]poison['"]|type:\s*['"]bump['"]\s*\|[^;]+['"]fire['"]\s*\|\s*['"]poison['"]/,
    'the board FX contract carries fire and poison impacts'
  );
  assert.match(
    source,
    /dedupeSegments\(\[\.\.\.\(revealedWalls\s*\|\|\s*\[\]\),\s*\.\.\.\(heatWalls\s*\|\|\s*\[\]\)\]\)/,
    'heat hallucinations merge into the same sensed-wall segment path'
  );
  assert.match(
    source,
    /sensedWallSegments[\s\S]*?<WallBox\s+key=\{`radar-[^`]+`\}\s+seg=\{seg\}\s+color=\{COLORS\.wall\}\s*\/>/,
    'real discoveries and heat hallucinations share the exact ordinary WallBox rendering'
  );

  const wormholeEditorSource = fs.readFileSync(
    path.join(ROOT, 'src', 'components', 'WormholeChallengeEditor.tsx'),
    'utf8'
  );
  assert.match(
    wormholeEditorSource,
    /const\s+PASSABLE_FLOOR_STYLES\s*=\s*\['bg-\[#fffaf0\]',\s*'bg-\[#eff7df\]'\]\s+as\s+const/,
    'inline wormhole editor uses the same passable-floor palette as setup'
  );
  assert.match(
    wormholeEditorSource,
    /const\s+BOARD_FLOOR_STYLE\s*=\s*['"]bg-\[#c7d7b3\]['"]/,
    'inline wormhole editor keeps empty wall slots visually separate from dark-red walls'
  );

  const sharedRendererConsumers = [
    ['GamePlay.tsx', /<LiveBoardGrid\b/],
    ['PracticeBattle.tsx', /<LiveBoardGrid\b/],
    ['AuthorityGameRoom.tsx', /<LiveBoardGrid\b/],
  ];
  for (const [fileName, rendererPattern] of sharedRendererConsumers) {
    const consumerSource = fs.readFileSync(path.join(ROOT, 'src', 'components', fileName), 'utf8');
    assert.match(consumerSource, rendererPattern, `${fileName} stays on the shared live-board renderer`);
  }
  const practiceBattleSource = fs.readFileSync(
    path.join(ROOT, 'src', 'components', 'PracticeBattle.tsx'),
    'utf8'
  );
  assert.match(
    practiceBattleSource,
    /type MapTestPerspective = 'creator' \| 'opponent'/,
    'solo map tests expose explicit creator and opponent viewpoints'
  );
  assert.match(
    practiceBattleSource,
    /data-testid="map-test-perspective-toggle"/,
    'the map-test viewpoint switch has a stable browser contract'
  );
  assert.match(
    practiceBattleSource,
    /aria-label=\{`\$\{label\} 시점`\}[\s\S]*?aria-pressed=\{selected\}/,
    'both map-test viewpoint buttons expose their accessible selected state'
  );
  assert.match(
    practiceBattleSource,
    /revealObstacles: showMapTestSecrets \|\| !!player\.finished,[\s\S]*?revealMapSecrets: showMapTestSecrets/,
    'opponent viewpoint hides undiscovered obstacles and map items without resetting the run'
  );
  assert.match(
    practiceBattleSource,
    /\(mode === 'race' \|\| simulateOpponentVision\)[\s\S]*?isVisionObscuredForPlayer/,
    'opponent viewpoint applies the same smoke-obscured vision rule as a real runner'
  );
  const liveBoardSource = fs.readFileSync(path.join(ROOT, 'src', 'components', 'LiveBoardGrid.tsx'), 'utf8');
  assert.match(liveBoardSource, /<GameBoard3D\b/, 'main and V1 wormhole boards stay on GameBoard3D');
  assert.match(liveBoardSource, /challenge\.version\s*===\s*2/, 'V2 wormhole rendering is explicitly version-narrowed');
  assert.match(liveBoardSource, /<DiceWormholeBoard\s+run=\{diceWormholeRun\}/, 'V2 runs use the public 4x4 dice board');
  assert.match(
    liveBoardSource,
    /challengeSeals=\{legacyWormholeRun\?\.challenge\.seals\}/,
    'V1 runs retain the existing seal renderer'
  );
  assert.doesNotMatch(liveBoardSource, /heatWalls=\{|data-heat-wall-count/, 'retired heat hallucination walls are not rendered');
  assert.doesNotMatch(liveBoardSource, /진짜\/환영벽|방향 혼선 25%/, 'retired fire and poison copy is removed');
  assert.match(liveBoardSource, /지도 소각 · 새 벽 기억도 다음 행동에 사라짐/, 'fire status explains burning wall memory');
  assert.match(liveBoardSource, /모든 입력 4방향 무작위/, 'poison status explains full four-way random input');

  const diceBoardSource = fs.readFileSync(path.join(ROOT, 'src', 'components', 'DiceWormholeBoard.tsx'), 'utf8');
  for (const contract of [
    'data-board-realm="wormhole"',
    'data-wormhole-version="2"',
    'data-dice-top',
    'data-dice-target',
    'data-dice-actions',
    'data-dice-hint',
  ]) {
    assert.ok(diceBoardSource.includes(contract), `dice board exposes ${contract}`);
  }
  assert.match(diceBoardSource, /getDiceOrientationFaces\(run\.orientation\)/, 'top/front/right faces derive from the persisted orientation');
  assert.doesNotMatch(diceBoardSource, /getDiceWormholeHintDirection|data-dice-hint-direction|힌트\s*[↑→↓←]/, 'the dice room never reveals a route hint');
  assert.match(diceBoardSource, /<DiceWormholeBoard3D\b/, 'the visible V2 wormhole world is rendered by R3F');
  assert.doesNotMatch(diceBoardSource, /className="dice-wormhole-grid/, 'the CSS grid is no longer the visible wormhole world');
  assert.match(diceBoardSource, /data-dice-accessibility-contract="true"/, 'the Canvas keeps a DOM diagnostic mirror');
  assert.match(diceBoardSource, /data-pip-active/, 'the semantic mirror exposes real pip layouts');
  assert.match(diceBoardSource, /data-dice-blocked/, 'all public blocked cells remain machine-readable');
  assert.match(diceBoardSource, /data-dice-face-count="6"/, 'the semantic die declares a closed six-face cube');
  for (const side of ['top', 'bottom', 'front', 'back', 'right', 'left']) {
    assert.match(
      diceBoardSource,
      new RegExp(`<DicePipFace\\s+face=\\{[^}]+\\}\\s+side="${side}"`),
      `the semantic die exposes its ${side} face`
    );
  }

  const diceWorldSource = fs.readFileSync(
    path.join(ROOT, 'src', 'components', 'three', 'DiceWormholeBoard3D.tsx'),
    'utf8'
  );
  for (const assetId of [
    'wormholeBoardBase',
    'wormholeDie',
    'wormholeRock',
    'wormholeTargetPad',
    'tileCream',
    'tileSage',
  ]) {
    assert.ok(diceWorldSource.includes(assetId), `the R3F dice room uses ${assetId}`);
  }
  assert.match(diceWorldSource, /<Canvas[\s\S]*?orthographic/, 'the dice room owns an orthographic R3F Canvas');
  assert.match(diceWorldSource, /preloadMazeCartoonAssets\(['"]wormhole['"]\)/, 'the dice room preloads only its Blender subset');
  assert.match(diceWorldSource, /<MazeCartoonAssetProvider\s+assetSet=["']wormhole["']>/, 'the dice room uses the shared wormhole asset provider');
  assert.match(diceWorldSource, /CAMERA_ELEVATION_DEG\s*=\s*59/, 'the dice room uses the lowered three-quarter camera');
  assert.match(diceWorldSource, /ROLL_DURATION\s*=\s*0\.62/, 'a successful move rolls for 0.62 seconds');
  assert.match(diceWorldSource, /BUMP_DURATION\s*=\s*0\.42/, 'a blocked move bumps for 0.42 seconds');
  assert.match(diceWorldSource, /makeBasis\([\s\S]*?worldNormalForFace\(orientation,\s*3\)[\s\S]*?worldNormalForFace\(orientation,\s*1\)[\s\S]*?worldNormalForFace\(orientation,\s*5\)/, 'all 24 persisted orientations become exact Blender quaternions');
  assert.match(diceWorldSource, /slerpQuaternions\(/, 'successful moves animate a real 90-degree quaternion roll');
  assert.match(diceWorldSource, /Math\.sin\(Math\.PI\s*\*\s*progress\)/, 'the rolling die clears the tile edge along an arc');
  assert.match(diceWorldSource, /reducedMotion\s*\?\s*'idle'/, 'reduced motion snaps die movement to its final pose');
  assert.match(diceWorldSource, /dataset\.diceAnimation/, 'the Canvas exposes its real animation state to browser diagnostics');
  assert.match(diceWorldSource, /dataset\.diceFaceCount\s*=\s*'6'/, 'the Blender die declares all six modeled faces');
  assert.match(
    diceWorldSource,
    /const\s+TARGET_PIP_POSITIONS[\s\S]*?1:\s*\[\[0,\s*0\]\][\s\S]*?6:\s*\[[\s\S]*?\]/,
    'the target floor owns deterministic pip layouts for faces one through six'
  );
  assert.match(
    diceWorldSource,
    /<TargetFacePips\s+face=\{targetTop\}\s*\/>/,
    'the exit pad renders the configured target face directly on the floor'
  );
  assert.match(
    diceWorldSource,
    /dataset\.targetFloorFace\s*=\s*String\(targetTop\)/,
    'the Canvas exposes the floor target face for visual browser verification'
  );
  assert.match(liveBoardSource, /WORMHOLE_ENTRY_TRANSITION_MS\s*=\s*920/, 'wormhole entry keeps the outer board visible for the suction animation');
  assert.match(liveBoardSource, /data-testid="wormhole-realm-transition"/, 'wormhole entry renders a visible realm-transition layer');
  assert.match(liveBoardSource, /data-realm-transition-elapsed-ms=\{entryTransitionElapsedMs/, 'the browser contract measures the completed suction interval');

  const gamePlaySource = fs.readFileSync(path.join(ROOT, 'src', 'components', 'GamePlay.tsx'), 'utf8');
  assert.match(
    gamePlaySource,
    /isDiceWormholeAction[\s\S]*?!isDiceWormholeAction\s*&&\s*!isPositionInBoard/,
    'V2 internal boundary bumps bypass the main-board preflight guard'
  );
}

function main() {
  const toon = loadTypeScript('src/lib/mazeToonRendering.ts', { three: THREE });
  assert.equal(toon.MAZE_TOON_RENDER_CONTRACT.version, 'inked-toy-v3');
  assert.ok(
    toon.MAZE_TOON_RENDER_CONTRACT.profiles.environment.darkestBand <= 0.5,
    'environment keeps a dark shadow band instead of a washed-out pastel minimum'
  );
  assert.ok(
    toon.MAZE_TOON_RENDER_CONTRACT.profiles.environment.quantizeStrength >= 0.8,
    'environment lighting uses strongly quantized cartoon bands'
  );
  assert.ok(
    toon.MAZE_TOON_RENDER_CONTRACT.profiles.environment.outlineStrength >= 0.28,
    'environment silhouettes retain visible ink outlines'
  );
  testMaterialLifecycle(toon);
  testGameBoardSourceContract();
  console.log('MAZE TOON RENDERING: material lifecycle and GameBoard3D renderer contracts passed');
}

main();
