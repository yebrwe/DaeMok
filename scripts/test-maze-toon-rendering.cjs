#!/usr/bin/env node

'use strict';

const assert = require('node:assert/strict');
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

  assert.match(source, /<Canvas\s+[\s\S]*?\borthographic\b/, 'GameBoard3D Canvas stays orthographic');
  assert.match(
    source,
    /camera\s+instanceof\s+THREE\.OrthographicCamera/,
    'fixed camera controller requires an OrthographicCamera'
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
    '3D setup renders oneTimeWall through the same opaque WallBox and wall color'
  );
  assert.match(
    disguisedWallReturn,
    /:\s*<WallBox\s+seg=\{seg\}\s+color=\{COLORS\.reveal\}\s+opacity=\{0\.75\}\s*\/>/,
    '3D reveal renders oneTimeWall through the same revealed-wall WallBox contract'
  );
  assert.doesNotMatch(
    disguisedWallReturn,
    /\bSpecialWallBox\b|meshStandardMaterial|boxGeometry/,
    '3D oneTimeWall cannot introduce a special material or geometry'
  );
  assert.match(
    source,
    /<WallBox\s+key=\{`ob-\$\{segmentKey\(seg\)\}`\}\s+seg=\{seg\}\s+color=\{COLORS\.wall\}\s*\/>/,
    'ordinary 3D walls use the same WallBox and opaque wall color contract'
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
  const liveBoardSource = fs.readFileSync(path.join(ROOT, 'src', 'components', 'LiveBoardGrid.tsx'), 'utf8');
  assert.match(liveBoardSource, /<GameBoard3D\b/, 'live, practice, and Authority boards converge on GameBoard3D');
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
