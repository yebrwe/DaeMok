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
    /const\s+maximumDpr\s*=\s*compact\s*\?\s*1\.25\s*:\s*size\.width\s*<=\s*700\s*\?\s*1\.5\s*:\s*2/,
    'mobile full-quality DPR remains capped at 1.5'
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
  assert.ok(contrastRatio(wall, tileA) >= 7, 'ordinary wall has at least 7:1 nominal contrast against tile A');
  assert.ok(contrastRatio(wall, tileB) >= 7, 'ordinary wall has at least 7:1 nominal contrast against tile B');
  assert.ok(contrastRatio(base, tileA) >= 4.5, 'board grid/frame has at least 4.5:1 nominal contrast against tile A');

  const disguisedOneTimeWallBranch = source.match(
    /if\s*\(item\.type\s*===\s*['"]oneTimeWall['"]\s*&&[\s\S]*?if\s*\(setup\s*\|\|\s*distinguishOneTimeWalls\)[^\n]*\n\s*(return\s*<WallBox[^;]+;)/
  );
  assert.ok(
    disguisedOneTimeWallBranch,
    'oneTimeWall keeps an explicit opponent/disguised rendering branch'
  );
  const disguisedWallReturn = disguisedOneTimeWallBranch[1];
  assert.match(
    disguisedWallReturn,
    /return\s*<WallBox\s+seg=\{seg\}\s+color=\{COLORS\.wall\}\s*\/>;/,
    'an armed oneTimeWall is disguised as the ordinary opaque wall for opponents'
  );
  assert.doesNotMatch(
    disguisedWallReturn,
    /\bopacity\s*=|\btransparent\b/,
    'the opponent oneTimeWall must not receive transparent-material arguments'
  );
  assert.doesNotMatch(
    disguisedWallReturn,
    /\bFakeWallBox\b/,
    'the opponent oneTimeWall must not use the identity-revealing FakeWallBox'
  );
}

function main() {
  const toon = loadTypeScript('src/lib/mazeToonRendering.ts', { three: THREE });
  assert.equal(toon.MAZE_TOON_RENDER_CONTRACT.version, 'inked-toy-v2');
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
