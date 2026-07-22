#!/usr/bin/env node

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const projectRoot = path.resolve(__dirname, '..');
const assetDir = path.join(projectRoot, 'public', 'assets', 'maze', 'v1');
const manifestPath = path.join(assetDir, 'manifest.json');

const expectedAssets = new Map([
  ['rabbit-pawn', 'rabbit-pawn.glb'],
  ['tile-cream', 'tile-cream.glb'],
  ['tile-sage', 'tile-sage.glb'],
  ['board-base', 'board-base.glb'],
  ['marker-start', 'marker-start.glb'],
  ['marker-goal', 'marker-goal.glb'],
  ['wall-normal', 'wall-normal.glb'],
  ['wall-steel', 'wall-steel.glb'],
  ['wall-fire', 'wall-fire.glb'],
  ['wall-poison', 'wall-poison.glb'],
  ['wall-ice', 'wall-ice.glb'],
  ['wall-wind', 'wall-wind.glb'],
  ['wall-phase', 'wall-phase.glb'],
  ['wall-thorn', 'wall-thorn.glb'],
  ['wall-crystal', 'wall-crystal.glb'],
  ['wall-fog', 'wall-fog.glb'],
  ['wall-illusion', 'wall-illusion.glb'],
  ['wormhole-die', 'wormhole-die.glb'],
  ['wormhole-board-base', 'wormhole-board-base.glb'],
  ['wormhole-rock', 'wormhole-rock.glb'],
  ['wormhole-target-pad', 'wormhole-target-pad.glb'],
  ['wormhole-portal', 'wormhole-portal.glb'],
  ['item-mine', 'item-mine.glb'],
  ['item-mine-used', 'item-mine-used.glb'],
  ['item-smoke', 'item-smoke.glb'],
  ['item-smoke-used', 'item-smoke-used.glb'],
  ['goal-flag', 'goal-flag.glb'],
  ['goal-lock', 'goal-lock.glb'],
  ['wall-collapse', 'wall-collapse.glb'],
  ['wall-mirror', 'wall-mirror.glb'],
  ['legacy-seal-die', 'legacy-seal-die.glb'],
]);

const extensionAssets = new Set([
  'wormhole-die',
  'wormhole-board-base',
  'wormhole-rock',
  'wormhole-target-pad',
  'wormhole-portal',
  'item-mine',
  'item-mine-used',
  'item-smoke',
  'item-smoke-used',
  'goal-flag',
  'goal-lock',
  'wall-collapse',
  'wall-mirror',
  'legacy-seal-die',
]);

function readGlb(filePath) {
  const payload = fs.readFileSync(filePath);
  assert.ok(payload.length >= 20, `${path.basename(filePath)} is too short to be a GLB`);
  assert.equal(payload.readUInt32LE(0), 0x46546c67, `${path.basename(filePath)} has invalid glTF magic`);
  assert.equal(payload.readUInt32LE(4), 2, `${path.basename(filePath)} must use glTF 2.0`);
  assert.equal(payload.readUInt32LE(8), payload.length, `${path.basename(filePath)} length header is stale`);

  let offset = 12;
  let json = null;
  let binaryChunks = 0;
  while (offset < payload.length) {
    assert.ok(offset + 8 <= payload.length, `${path.basename(filePath)} has a truncated chunk header`);
    const chunkLength = payload.readUInt32LE(offset);
    const chunkType = payload.readUInt32LE(offset + 4);
    const chunkStart = offset + 8;
    const chunkEnd = chunkStart + chunkLength;
    assert.ok(chunkEnd <= payload.length, `${path.basename(filePath)} has a truncated chunk`);
    if (chunkType === 0x4e4f534a) {
      assert.equal(json, null, `${path.basename(filePath)} has multiple JSON chunks`);
      json = JSON.parse(payload.subarray(chunkStart, chunkEnd).toString('utf8').trimEnd());
    } else if (chunkType === 0x004e4942) {
      binaryChunks += 1;
    }
    offset = chunkEnd;
  }
  assert.ok(json, `${path.basename(filePath)} is missing its JSON chunk`);
  assert.equal(binaryChunks, 1, `${path.basename(filePath)} must contain one embedded BIN chunk`);
  return { payload, gltf: json };
}

const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
assert.equal(manifest.version, 1);
assert.equal(manifest.generatorRevision, 2);
assert.equal(manifest.coordinateSystem, 'glTF Y-up; +Z forward; ground anchor at Y=0');
assert.equal(manifest.unitScale, 1);
assert.equal(manifest.tileSize, 1);
assert.equal(manifest.wallLength, 1.084);
assert.equal(manifest.wallHeight, 0.5);
assert.equal(manifest.wallDepth, 0.16);
assert.equal(manifest.dieSide, 0.612);
assert.equal(manifest.dieCenterY, 0.306);
assert.deepEqual(manifest.dieBaseFaces, {
  '+Y': 1,
  '-Y': 6,
  '-Z': 2,
  '+Z': 5,
  '+X': 3,
  '-X': 4,
});
assert.deepEqual(manifest.wormholeBoard, {
  size: 4,
  gridSpan: 4.42,
  origin: 'grid center',
  tileAssetRootY: -0.08,
  playableTopY: 0.08,
});

assert.deepEqual(
  new Set(Object.keys(manifest.assets)),
  new Set(expectedAssets.keys()),
  'Blender maze asset catalog drifted',
);

let totalBytes = 0;
for (const [assetId, fileName] of expectedAssets) {
  const entry = manifest.assets[assetId];
  assert.equal(entry.file, fileName, `${assetId} manifest filename drifted`);
  const { payload, gltf } = readGlb(path.join(assetDir, fileName));
  const sha256 = crypto.createHash('sha256').update(payload).digest('hex');

  assert.equal(payload.length, entry.bytes, `${assetId} manifest size is stale`);
  assert.equal(sha256, entry.sha256, `${assetId} manifest hash is stale`);
  assert.ok(payload.length <= 120_000, `${assetId} exceeds the per-asset transfer budget`);
  totalBytes += payload.length;

  assert.equal(gltf.asset?.version, '2.0', `${assetId} must be glTF 2.0`);
  assert.ok(gltf.nodes?.some((node) => node.name === entry.root), `${assetId} root node is missing`);
  assert.equal(gltf.meshes?.length, entry.meshes, `${assetId} mesh-channel count drifted`);
  assert.ok((gltf.meshes?.length ?? 0) <= 7, `${assetId} exceeds the draw-channel budget`);
  assert.equal(gltf.images, undefined, `${assetId} unexpectedly embeds image textures`);
  assert.equal(gltf.textures, undefined, `${assetId} unexpectedly embeds textures`);
  assert.equal(gltf.animations, undefined, `${assetId} must remain a rigless static model`);
  assert.equal(gltf.skins, undefined, `${assetId} must remain a rigless static model`);
  assert.equal(gltf.cameras, undefined, `${assetId} unexpectedly embeds a camera`);
  assert.equal(gltf.extensionsRequired, undefined, `${assetId} must not require runtime decoders`);
  assert.ok(
    !(gltf.extensionsUsed ?? []).includes('KHR_draco_mesh_compression'),
    `${assetId} must not depend on the external Draco decoder`,
  );
  assert.ok(
    (gltf.buffers ?? []).every((buffer) => buffer.uri === undefined),
    `${assetId} must keep geometry inside the GLB`,
  );

  if (extensionAssets.has(assetId)) {
    assert.deepEqual(
      new Set((gltf.materials ?? []).map((material) => material.name)),
      new Set(entry.materials),
      `${assetId} material names must match the runtime tint/emissive contract`,
    );
  }
}

assert.ok(totalBytes <= 800_000, `complete maze GLB pack exceeds 800 KB (${totalBytes} bytes)`);

const normalWallEntry = manifest.assets['wall-normal'];
assert.equal(normalWallEntry.meshes, 1, 'an ordinary revealed wall is one plain block channel');
assert.deepEqual(
  normalWallEntry.bounds_blender_xyz,
  [-0.542, -0.08, 0, 0.542, 0.08, 0.5],
  'the plain red wall must remain exactly 1.084 x 0.160 x 0.500',
);
const normalWall = readGlb(path.join(assetDir, 'wall-normal.glb')).gltf;
assert.deepEqual(
  (normalWall.materials ?? []).map((material) => material.name),
  ['mat_wall_normal_body'],
  'the plain red wall has no cap, seam, or subtype decoration',
);
const normalWallColor = normalWall.materials[0].pbrMetallicRoughness.baseColorFactor;
assert.ok(
  normalWallColor[0] > normalWallColor[1] * 3 && normalWallColor[0] > normalWallColor[2] * 3,
  'the ordinary wall material is unmistakably red',
);

const dieEntry = manifest.assets['wormhole-die'];
assert.deepEqual(
  dieEntry.bounds_blender_xyz,
  [-0.306, -0.306, 0, 0.306, 0.306, 0.612],
  'rolling die must stay 0.612 square and ground anchored',
);
assert.equal(dieEntry.meshes, 2, 'rolling die stays body + physical-pip channels');
const die = readGlb(path.join(assetDir, 'wormhole-die.glb')).gltf;
const dieRoot = die.nodes.find((node) => node.name === dieEntry.root);
assert.equal(dieRoot?.extras?.daemok_die_pip_count, 21, 'rolling die exposes all 21 physical pips');
assert.equal(
  dieRoot?.extras?.daemok_die_base_faces,
  '1:+Y,6:-Y,2:-Z,5:+Z,3:+X,4:-X',
  'rolling die neutral quaternion contract drifted',
);

assert.deepEqual(
  manifest.assets['wormhole-board-base'].bounds_blender_xyz,
  [-2.45, -2.45, -0.46, 2.45, 2.45, -0.08],
  'wormhole base must end below the 16 reused v1 tile assets',
);
assert.equal(manifest.assets['wormhole-board-base'].meshes, 2, 'wormhole base must not duplicate tile geometry');

for (const wallId of ['wall-collapse', 'wall-mirror']) {
  assert.deepEqual(
    manifest.assets[wallId].bounds_blender_xyz,
    [-0.542, -0.08, 0, 0.542, 0.08, 0.5],
    `${wallId} must remain exactly 1.084 x 0.160 x 0.500`,
  );
}

for (const contract of Object.values(manifest.materialContracts)) {
  for (const materialName of Object.values(contract)) {
    assert.ok(
      Object.values(manifest.assets).some((entry) => entry.materials?.includes(materialName)),
      `runtime material contract ${materialName} is missing from the GLB pack`,
    );
  }
}

const rabbit = readGlb(path.join(assetDir, 'rabbit-pawn.glb')).gltf;
const rabbitMaterials = new Set((rabbit.materials ?? []).map((material) => material.name));
assert.deepEqual(rabbitMaterials, new Set([
  'mat_rabbit_cape',
  'mat_rabbit_cream',
  'mat_rabbit_ear',
  'mat_rabbit_eye_white',
  'mat_rabbit_fur',
  'mat_rabbit_ink',
  'mat_rabbit_player_accent',
]), 'rabbit material/tint contract drifted');

console.log(`Maze cartoon assets OK: ${expectedAssets.size} GLBs, ${totalBytes} bytes`);
