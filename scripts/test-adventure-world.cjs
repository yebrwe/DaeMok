'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');
const ts = require('typescript');

const ROOT = path.join(__dirname, '..');

function loadTypeScript(relativePath) {
  const filename = path.join(ROOT, relativePath);
  const source = fs.readFileSync(filename, 'utf8');
  const output = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true,
    },
    fileName: filename,
  }).outputText;
  const loaded = new Module(filename, module);
  loaded.filename = filename;
  loaded.paths = Module._nodeModulePaths(path.dirname(filename));
  loaded._compile(output, filename);
  return loaded.exports;
}

const adventureWorld = loadTypeScript('src/lib/adventureWorld.ts');
const seed = 'world-contract-test-2026';
const world = adventureWorld.createAdventureWorld(seed);
const sameWorld = adventureWorld.createAdventureWorld(seed);
const otherWorld = adventureWorld.createAdventureWorld('different-world-seed');

const adventureFieldBiomes = {
  sunnyField: 'greenmarch',
  mistForest: 'whisperwood',
  ancientRuins: 'stormhighlands',
  dragonCrater: 'emberwaste',
};
const fieldStarts = Object.entries(adventureFieldBiomes).map(([regionId, biomeId]) => {
  const position = adventureWorld.getAdventureRegionFrontierPosition(world, regionId);
  const coordinate = adventureWorld.worldToChunkCoordinate(world, position);
  const chunk = adventureWorld.getWorldChunkRenderData(world, coordinate);
  assert.equal(chunk.biomeId, biomeId, `${regionId} starts in its matching world biome`);
  assert.equal(chunk.zoneKind, 'wilderness', `${regionId} starts outside its town`);
  return position;
});
assert.equal(new Set(fieldStarts.map((position) => `${position.x}:${position.z}`)).size, 4, 'all four combat regions have distinct frontier starts');

assert.deepEqual(sameWorld, world, 'the same seed creates an identical world definition');
assert.notDeepEqual(otherWorld.regions, world.regions, 'another seed changes the generated layout');
assert.equal(world.bounds.maxX - world.bounds.minX, 6_144, 'the overworld spans thousands of world units');
assert.equal(world.bounds.maxZ - world.bounds.minZ, 6_144, 'the overworld is large in both axes');
assert.equal(world.gridWidth * world.gridHeight, 2_304, 'the overworld contains 2,304 streamable chunks');
assert.ok(world.regions.length >= 6, 'the world has at least six regions');
assert.equal(new Set(world.regions.map((region) => region.biomeId)).size, world.regions.length, 'regions use distinct biomes');
assert.equal(world.towns.length, world.regions.length, 'every region has a town');
assert.equal(world.dungeons.length, world.regions.length, 'every region has a dungeon');
assert.equal(world.waypoints.length, world.regions.length * 2, 'every region has town and wilderness waypoints');
assert.ok(world.dungeons.every((dungeon) => dungeon.floors.length >= 3), 'all dungeons have multiple floors');

const representedRegions = new Set();
for (let z = 0; z < world.gridHeight; z += 1) {
  for (let x = 0; x < world.gridWidth; x += 1) {
    representedRegions.add(adventureWorld.getRegionForChunk(world, { x, z }).id);
  }
}
assert.equal(representedRegions.size, world.regions.length, 'every region owns overworld chunks');

const visited = new Set([adventureWorld.getOverworldChunkId({ x: 0, z: 0 })]);
const queue = [{ x: 0, z: 0 }];
while (queue.length > 0) {
  const coordinate = queue.shift();
  const chunk = adventureWorld.getWorldChunkRenderData(world, coordinate);
  assert.ok(chunk, `chunk ${coordinate.x},${coordinate.z} can be generated`);
  for (const neighborId of chunk.neighborIds) {
    const neighbor = adventureWorld.parseOverworldChunkId(world, neighborId);
    assert.ok(neighbor, `${neighborId} is a valid neighbor`);
    if (!visited.has(neighborId)) {
      visited.add(neighborId);
      queue.push(neighbor);
    }
  }
}
assert.equal(visited.size, world.gridWidth * world.gridHeight, 'the entire overworld chunk graph is connected');

const sampleCoordinate = { x: 20, z: 20 };
const sample = adventureWorld.getWorldChunkRenderData(world, sampleCoordinate);
const sampleAgain = adventureWorld.getWorldChunkRenderData(world, sampleCoordinate);
assert.deepEqual(sampleAgain, sample, 'seeded chunk contents are deterministic');
assert.equal(sample.dimension, 'overworld');
assert.ok(sample.obstacles.length >= 10, 'wilderness chunks contain collision obstacles');
assert.ok(sample.props.length > sample.obstacles.length, 'chunks include collision and decorative props');
assert.ok(sample.spawnNodes.some((node) => node.kind === 'monsterPack'), 'wilderness contains monster spawn nodes');
assert.equal(sample.walkability.blocked.length, 256, 'chunks expose a 16x16 pathfinding grid');
assert.ok(sample.walkability.blocked.some((value) => value === 1), 'collision obstacles mark navigation cells blocked');
assert.equal(sample.roads.length, 2, 'each chunk has matching cardinal traversal corridors');

const east = adventureWorld.getWorldChunkRenderData(world, { x: sampleCoordinate.x + 1, z: sampleCoordinate.z });
const terrainStride = sample.terrain.resolution + 1;
for (let row = 0; row < terrainStride; row += 1) {
  assert.equal(
    sample.terrain.heightSamples[row * terrainStride + sample.terrain.resolution],
    east.terrain.heightSamples[row * terrainStride],
    `terrain height is continuous at east edge row ${row}`,
  );
}

const centerRowA = 7;
const centerRowB = 8;
for (const row of [centerRowA, centerRowB]) {
  assert.equal(sample.walkability.blocked[row * 16 + 15], 0, 'the east chunk portal is walkable');
  assert.equal(east.walkability.blocked[row * 16], 0, 'the matching west chunk portal is walkable');
}
const crossChunkPath = adventureWorld.findPathAcrossChunks(
  [sample, east],
  sample.center,
  east.center,
  { allowDiagonal: false },
);
assert.ok(crossChunkPath.length > 2, 'pathfinding crosses chunk boundaries through aligned portals');

const startingTown = world.towns.find((town) => town.id === world.startingTownId);
const townChunk = adventureWorld.getWorldChunkRenderData(world, startingTown.chunk);
assert.equal(townChunk.zoneKind, 'town', 'town chunks are explicitly classified');
assert.ok(townChunk.pointsOfInterest.some((poi) => poi.kind === 'townCenter'), 'town center POI is rendered');
assert.ok(townChunk.pointsOfInterest.some((poi) => poi.kind === 'waypoint'), 'town waypoint POI is rendered');
assert.ok(townChunk.spawnNodes.some((node) => node.kind === 'npc'), 'towns contain NPC spawn nodes');

const entranceDungeon = world.dungeons[0];
const entranceChunk = adventureWorld.getWorldChunkRenderData(world, entranceDungeon.entranceChunk);
assert.equal(entranceChunk.zoneKind, 'dungeonEntrance', 'overworld dungeon entrances are classified');
assert.ok(entranceChunk.pointsOfInterest.some((poi) => poi.kind === 'dungeonEntrance'));

const firstStream = adventureWorld.streamWorldChunksAroundPlayer(world, world.startingPosition, {
  radius: 2,
  revealRadius: 1,
});
assert.equal(firstStream.chunks.length, 25, 'mobile default vicinity streams only a 5x5 active area');
assert.equal(firstStream.load.length, 25, 'initial stream loads all active chunks');
assert.equal(firstStream.newlyDiscoveredChunkIds.length, 9, 'fog reveals a 3x3 vicinity');
assert.equal(firstStream.chunks.filter((chunk) => chunk.fogState === 'visible').length, 9);
assert.equal(firstStream.chunks.filter((chunk) => chunk.fogState === 'hidden').length, 16);

const movedPosition = { x: world.startingPosition.x + world.chunkSize, z: world.startingPosition.z };
const secondStream = adventureWorld.streamWorldChunksAroundPlayer(world, movedPosition, {
  radius: 2,
  revealRadius: 1,
  previouslyActiveChunkIds: firstStream.activeChunkIds,
  discoveredChunkIds: firstStream.newlyDiscoveredChunkIds,
});
assert.equal(secondStream.load.length, 5, 'moving one chunk loads one new column');
assert.equal(secondStream.retain.length, 20, 'moving one chunk retains overlapping active chunks');
assert.equal(secondStream.unload.length, 5, 'moving one chunk unloads the far column');

const runtime = adventureWorld.createAdventureWorldRuntime(world, { maxCachedChunks: 12 });
const runtimeStream = runtime.streamOverworld(world.startingPosition, { radius: 2 });
assert.equal(runtimeStream.chunks.length, 25);
assert.ok(runtime.cacheSize <= 12, 'runtime LRU enforces a mobile-friendly chunk cache limit');
assert.deepEqual(
  runtime.getOverworldChunk(sampleCoordinate),
  sample,
  'runtime chunks use the same renderer contract as direct generation',
);

for (const dungeon of world.dungeons) {
  const finalFloor = dungeon.floors[dungeon.floors.length - 1];
  assert.ok(finalFloor.bossChunk, `${dungeon.id} final floor defines a boss room`);
  const floorChunks = adventureWorld.getDungeonFloorRenderData(world, dungeon.id, finalFloor.floor);
  assert.equal(floorChunks.length, finalFloor.gridWidth * finalFloor.gridHeight, 'all dungeon floor chunks render');
  const bossRooms = floorChunks.filter((chunk) => chunk.zoneKind === 'dungeonBoss');
  assert.equal(bossRooms.length, 1, 'the final floor has exactly one boss room');
  assert.ok(bossRooms[0].spawnNodes.some((node) => node.kind === 'boss'), 'boss room exposes a boss spawn node');
  assert.ok(bossRooms[0].pointsOfInterest.some((poi) => poi.kind === 'bossGate'), 'boss room exposes its gate POI');
}

const firstDungeon = world.dungeons[0];
const firstFloor = firstDungeon.floors[0];
const dungeonEntryPosition = (() => {
  const entryChunkData = adventureWorld.getDungeonChunkRenderData(world, firstDungeon.id, 1, firstFloor.entryChunk);
  return entryChunkData.center;
})();
const dungeonStream = adventureWorld.streamDungeonChunksAroundPlayer(
  world,
  firstDungeon.id,
  1,
  dungeonEntryPosition,
  { radius: 2 },
);
assert.ok(dungeonStream.chunks.length <= 25 && dungeonStream.chunks.length >= 9, 'dungeon floors use bounded chunk streaming');
assert.ok(dungeonStream.chunks.every((chunk) => chunk.dimension === 'dungeon'));

const projection = adventureWorld.createWorldArenaProjection(world.startingPosition);
const projected = adventureWorld.worldToArenaCoordinates(movedPosition, projection);
const roundTrip = adventureWorld.arenaToWorldCoordinates(projected, projection);
assert.ok(Math.abs(roundTrip.x - movedPosition.x) < 1e-9, 'world-to-arena x mapping is reversible');
assert.ok(Math.abs(roundTrip.z - movedPosition.z) < 1e-9, 'world-to-arena z mapping is reversible');

const legacySave = { name: 'legacy-hero', classId: 'ranger', createdAt: 1_234, level: 17 };
const migrated = adventureWorld.sanitizeAdventureWorldProgress(legacySave);
const migratedAgain = adventureWorld.sanitizeAdventureWorldProgress(legacySave);
assert.deepEqual(migratedAgain, migrated, 'legacy saves receive a stable deterministic world migration');
assert.ok(migrated.worldSeed.startsWith('adventure-'));
assert.ok(migrated.discoveredChunkIds.length >= 1, 'legacy saves start with a discovered chunk');
assert.deepEqual(migrated.unlockedWaypointIds, [adventureWorld.createAdventureWorld(migrated.worldSeed).startingWaypointId]);

const initialProgress = adventureWorld.createInitialAdventureWorldProgress(seed);
assert.equal(initialProgress.discoveredChunkIds.length, 9, 'new saves reveal the starting 3x3 chunks');
assert.equal(initialProgress.activeDungeonFloor, 0);
const lockedTravel = adventureWorld.travelToWorldWaypoint(initialProgress, world.waypoints[1].id);
assert.deepEqual(lockedTravel, initialProgress, 'locked waypoints cannot be used for fast travel');
const unlockedProgress = adventureWorld.unlockWorldWaypoint(initialProgress, world.waypoints[1].id);
const traveled = adventureWorld.travelToWorldWaypoint(unlockedProgress, world.waypoints[1].id);
assert.ok(Math.hypot(
  traveled.worldPlayerPosition.x - world.waypoints[1].position.x,
  traveled.worldPlayerPosition.z - world.waypoints[1].position.z,
) < world.chunkSize, 'unlocked waypoints provide an overworld travel position');
const entered = adventureWorld.enterWorldDungeon(initialProgress, firstDungeon.id);
assert.equal(entered.activeDungeonId, firstDungeon.id);
assert.equal(entered.activeDungeonFloor, 1);
const changedFloor = adventureWorld.changeWorldDungeonFloor(entered, firstDungeon.floors.length);
assert.equal(changedFloor.activeDungeonFloor, firstDungeon.floors.length);
const leftDungeon = adventureWorld.leaveWorldDungeon(changedFloor);
assert.equal(leftDungeon.activeDungeonId, null);
assert.equal(leftDungeon.activeDungeonFloor, 0);
assert.deepEqual(leftDungeon.worldPlayerPosition, firstDungeon.entrancePosition);

const validDungeonChunkId = adventureWorld.getDungeonChunkId(
  firstDungeon.id,
  firstDungeon.floors.length,
  firstDungeon.floors[firstDungeon.floors.length - 1].bossChunk,
);
const repaired = adventureWorld.sanitizeAdventureWorldProgress({
  worldSeed: seed,
  worldPlayerPosition: { x: Number.POSITIVE_INFINITY, z: -999_999 },
  discoveredChunkIds: ['invalid', validDungeonChunkId, validDungeonChunkId],
  unlockedWaypointIds: ['invalid', world.waypoints[1].id, world.waypoints[1].id],
  activeDungeonId: firstDungeon.id,
  activeDungeonFloor: 99_999,
});
assert.equal(repaired.activeDungeonFloor, firstDungeon.floors.length, 'invalid dungeon floors clamp to the real floor count');
assert.ok(repaired.discoveredChunkIds.includes(validDungeonChunkId), 'valid dungeon discovery survives sanitization');
assert.equal(repaired.discoveredChunkIds.filter((id) => id === validDungeonChunkId).length, 1, 'discovery ids are deduplicated');
assert.ok(!repaired.discoveredChunkIds.includes('invalid'));
assert.ok(repaired.unlockedWaypointIds.includes(world.startingWaypointId), 'the starting waypoint cannot be lost');

const augmented = adventureWorld.withAdventureWorldProgress(legacySave, initialProgress);
assert.equal(augmented.level, legacySave.level, 'world migration preserves unrelated adventure save fields');
assert.equal(augmented.worldSeed, seed, 'world fields are attached directly to the existing save');
const discoveryUpdate = adventureWorld.updateWorldDiscovery(initialProgress, movedPosition, 1);
assert.ok(discoveryUpdate.progress.discoveredChunkIds.length > initialProgress.discoveredChunkIds.length, 'movement advances persistent fog discovery');

console.log('Adventure world tests passed.');
