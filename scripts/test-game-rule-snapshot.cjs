#!/usr/bin/env node

'use strict';


const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');
const ts = require('typescript');

const ROOT = path.join(__dirname, '..');

function loadTypeScript(relativePath, aliases = {}) {
  const filename = path.join(ROOT, relativePath);
  const source = fs.readFileSync(filename, 'utf8');
  const result = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
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
  loaded.require = (request) => aliases[request] || require(request);
  loaded._compile(result.outputText, filename);
  return loaded.exports;
}

const types = loadTypeScript('src/types/game.ts');
const mazeSkills = loadTypeScript('src/lib/mazeSkills.ts');
const diceWormhole = loadTypeScript('src/lib/diceWormhole.ts', { '@/types/game': types });
const utils = loadTypeScript('src/lib/gameUtils.ts', {
  '@/types/game': types,
  '@/lib/diceWormhole': diceWormhole,
});
const rules = loadTypeScript('src/lib/gameRules.ts', {
  '@/types/game': types,
  '@/lib/gameUtils': utils,
  '@/lib/mazeSkills': mazeSkills,
});

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function pos(row, col) {
  return { row, col };
}

function baseMap(overrides = {}) {
  return {
    rulesVersion: 5,
    skillLoadout: 'scoutPulse',
    runnerGear: 'none',
    startPosition: pos(0, 0),
    endPosition: pos(0, 5),
    obstacles: [],
    items: [],
    ...overrides,
  };
}

function safeWallCandidates() {
  const result = [];
  for (let row = 0; row < 6; row += 1) {
    for (let col = 0; col < 6; col += 1) {
      if (row + 1 < 6) result.push({ position: pos(row, col), direction: 'down' });
      if (col + 1 < 6 && row !== 0) {
        result.push({ position: pos(row, col), direction: 'right' });
      }
    }
  }
  return result;
}

const EXPECTED_COSTS = {
  oneTimeWall: 7,
  mine: 1,
  wormhole: 7,
  radar: 4,
  smoke: 1,
  steelWall: 1,
  fireWall: 1,
  fogWall: 1,
  illusionWall: 2,
  poisonWall: 1,
  iceWall: 1,
  windWall: 1,
  collapseWall: 1,
  phaseWall: 1,
  mirrorWall: 1,
  thornWall: 1,
  crystalWall: 1,
};
const EXPECTED_SKILLS = ['scoutPulse', 'breach', 'anchor', 'dash'];
const TOP_LEVEL_KEYS = [
  'version',
  'wallBudget',
  'runnerGearWallBudget',
  'itemCosts',
  'itemLimits',
  'maxSkillLoadout',
  'skillIds',
];

const canonical = rules.createCanonicalGameRuleSnapshot();
assert.equal(canonical.version, 5, 'V5 snapshot');
assert.equal(canonical.wallBudget, 25, 'V5 no-gear wall budget');
assert.equal(canonical.runnerGearWallBudget, 15, 'V5 equipped runner-gear wall budget');
assert.deepEqual(canonical.itemCosts, EXPECTED_COSTS, 'all 17 V5 item costs');
assert.equal(Object.keys(canonical.itemCosts).length, 17, 'exactly 17 item costs');
assert.deepEqual(
  canonical.itemLimits,
  Object.fromEntries(Object.keys(EXPECTED_COSTS).map((itemType) => [itemType, 1])),
  'all item caps are one'
);
assert.equal(Object.keys(canonical.itemLimits).length, 17, 'exactly 17 item limits');
assert.equal(canonical.maxSkillLoadout, 1, 'one equipped skill');
assert.deepEqual(canonical.skillIds, EXPECTED_SKILLS, 'canonical skill order');
assert.equal(rules.isValidGameRuleSnapshot(canonical), true, 'canonical validates');
assert.equal(rules.validateGameRuleSnapshot(canonical).issues.length, 0, 'canonical has no issues');

const second = rules.createCanonicalGameRuleSnapshot();
assert.notStrictEqual(canonical, second, 'snapshot root is copied');
assert.notStrictEqual(canonical.itemCosts, second.itemCosts, 'costs are copied');
assert.notStrictEqual(canonical.itemLimits, second.itemLimits, 'limits are copied');
assert.notStrictEqual(canonical.skillIds, second.skillIds, 'skills are copied');
canonical.itemCosts.mine = 999;
canonical.itemLimits.radar = 99;
canonical.skillIds.reverse();
assert.equal(second.itemCosts.mine, 1, 'cost mutation does not leak');
assert.equal(second.itemLimits.radar, 1, 'limit mutation does not leak');
assert.deepEqual(second.skillIds, EXPECTED_SKILLS, 'array mutation does not leak');
assert.equal(utils.ITEM_COSTS.mine, 1, 'source constants are not mutated');
assert.equal(rules.isValidGameRuleSnapshot(canonical), false, 'mutated copy rejected');
assert.equal(rules.isValidGameRuleSnapshot(second), true, 'fresh copy remains valid');

for (const key of TOP_LEVEL_KEYS) {
  const missing = clone(second);
  delete missing[key];
  assert.equal(rules.isValidGameRuleSnapshot(missing), false, `missing ${key} rejected`);
}
const extraTopLevel = clone(second);
extraTopLevel.unexpected = true;
assert.equal(rules.isValidGameRuleSnapshot(extraTopLevel), false, 'extra top-level key rejected');
const hiddenExtraTopLevel = clone(second);
Object.defineProperty(hiddenExtraTopLevel, 'hidden', { value: true, enumerable: false });
assert.equal(rules.isValidGameRuleSnapshot(hiddenExtraTopLevel), false, 'hidden top-level key rejected');

for (const [field, expected] of [
  ['version', 4],
  ['wallBudget', 24],
  ['runnerGearWallBudget', 16],
  ['maxSkillLoadout', 2],
]) {
  const changed = clone(second);
  changed[field] = expected;
  assert.equal(rules.isValidGameRuleSnapshot(changed), false, `${field} mutation rejected`);
}

const staleFakeWallCost = clone(second);
staleFakeWallCost.itemCosts.oneTimeWall = 1;
assert.equal(
  rules.isValidGameRuleSnapshot(staleFakeWallCost),
  false,
  'V4 fake-wall cost is rejected by the V5 snapshot contract'
);

for (const recordName of ['itemCosts', 'itemLimits']) {
  const missing = clone(second);
  delete missing[recordName].mine;
  assert.equal(rules.isValidGameRuleSnapshot(missing), false, `${recordName} missing key rejected`);

  const extra = clone(second);
  extra[recordName].bonusItem = 1;
  assert.equal(rules.isValidGameRuleSnapshot(extra), false, `${recordName} extra key rejected`);

  const changed = clone(second);
  changed[recordName].mine += 1;
  assert.equal(rules.isValidGameRuleSnapshot(changed), false, `${recordName} value mutation rejected`);

  const wrongType = clone(second);
  wrongType[recordName].mine = '1';
  assert.equal(rules.isValidGameRuleSnapshot(wrongType), false, `${recordName} type mutation rejected`);
}

const reorderedSkills = clone(second);
[reorderedSkills.skillIds[0], reorderedSkills.skillIds[1]] = [
  reorderedSkills.skillIds[1],
  reorderedSkills.skillIds[0],
];
assert.equal(rules.isValidGameRuleSnapshot(reorderedSkills), false, 'skill order mutation rejected');

const duplicateSkills = clone(second);
duplicateSkills.skillIds[3] = duplicateSkills.skillIds[2];
assert.equal(rules.isValidGameRuleSnapshot(duplicateSkills), false, 'duplicate skill rejected');

const missingSkill = clone(second);
missingSkill.skillIds.pop();
assert.equal(rules.isValidGameRuleSnapshot(missingSkill), false, 'missing skill rejected');

const extraSkill = clone(second);
extraSkill.skillIds.push('teleport');
assert.equal(rules.isValidGameRuleSnapshot(extraSkill), false, 'extra skill rejected');

const sparseSkills = clone(second);
delete sparseSkills.skillIds[1];
assert.equal(rules.isValidGameRuleSnapshot(sparseSkills), false, 'sparse skill array rejected');

const decoratedSkills = clone(second);
decoratedSkills.skillIds.extra = 'value';
assert.equal(rules.isValidGameRuleSnapshot(decoratedSkills), false, 'decorated skill array rejected');
const sparseDecoratedSkills = clone(second);
delete sparseDecoratedSkills.skillIds[1];
sparseDecoratedSkills.skillIds.extra = 'replacement-key';
assert.equal(
  rules.isValidGameRuleSnapshot(sparseDecoratedSkills),
  false,
  'sparse array cannot hide behind an extra key'
);
const symbolDecoratedSkills = clone(second);
symbolDecoratedSkills.skillIds[Symbol('extra')] = true;
assert.equal(rules.isValidGameRuleSnapshot(symbolDecoratedSkills), false, 'symbol skill key rejected');

const nonPlainSnapshot = Object.create({ inherited: true });
Object.assign(nonPlainSnapshot, second);
assert.equal(rules.isValidGameRuleSnapshot(nonPlainSnapshot), false, 'non-plain snapshot rejected');

const third = rules.createGameRuleSnapshot();
assert.equal(rules.areGameRuleSnapshotsEqual(second, third), true, 'canonical copies equal');
assert.equal(rules.gameRuleSnapshotsEqual(second, third), true, 'equality alias works');
assert.equal(rules.areGameRuleSnapshotsEqual(second, reorderedSkills), false, 'reordered unequal');
assert.equal(rules.areGameRuleSnapshotsEqual(reorderedSkills, clone(reorderedSkills)), false, 'two invalid copies are not equal');
assert.equal(rules.areGameRuleSnapshotsEqual(second, null), false, 'null unequal');

assert.equal(rules.isValidMapForRuleSnapshot(baseMap(), second), true, 'canonical map accepted');
for (const skillLoadout of EXPECTED_SKILLS) {
  assert.equal(
    rules.isValidMapForRuleSnapshot(baseMap({ skillLoadout }), second),
    true,
    `${skillLoadout} accepted`
  );
}
assert.equal(
  rules.isValidNewMapForRuleSnapshot(baseMap(), second),
  true,
  'new-map boundary accepts the inert V5 compatibility loadout'
);
for (const retiredSkillLoadout of ['breach', 'anchor', 'dash']) {
  assert.equal(
    rules.isValidNewMapForRuleSnapshot(baseMap({ skillLoadout: retiredSkillLoadout }), second),
    false,
    `new-map boundary rejects retired ${retiredSkillLoadout} loadout`
  );
}
const normalizedSkillMap = rules.normalizeNewMapForRuleSnapshot(
  baseMap({ skillLoadout: 'anchor' }),
  second
);
assert.ok(normalizedSkillMap, 'stale skill drafts normalize at the trusted client boundary');
assert.equal(normalizedSkillMap.skillLoadout, 'scoutPulse', 'normalized maps keep only V5 compatibility');
assert.equal(normalizedSkillMap.runnerGear, 'none', 'normalized maps preserve explicit no-gear');

const legacyRadarMap = baseMap({ items: [{ type: 'radar' }] });
assert.equal(
  rules.isValidMapForRuleSnapshot(legacyRadarMap, second),
  true,
  'legacy radar maps remain readable through the compatibility validator'
);
assert.equal(
  rules.isValidNewMapForRuleSnapshot(legacyRadarMap, second),
  false,
  'new-map boundary rejects radar'
);
assert.equal(
  rules.normalizeNewMapForRuleSnapshot(
    baseMap({ skillLoadout: 'anchor', items: [{ type: 'radar' }] }),
    second
  ),
  null,
  'normalization never silently drops a retired radar item'
);
for (const legacyCellItem of [
  { type: 'mine', position: pos(1, 1) },
  { type: 'smoke', position: pos(1, 1) },
]) {
  const legacyMap = baseMap({ items: [legacyCellItem] });
  assert.equal(
    rules.isValidMapForRuleSnapshot(legacyMap, second),
    true,
    `legacy ${legacyCellItem.type} map remains readable`
  );
  assert.equal(
    rules.isValidNewMapForRuleSnapshot(legacyMap, second),
    false,
    `new-map boundary rejects retired ${legacyCellItem.type}`
  );
}
assert.equal(
  rules.normalizeNewMapForRuleSnapshot(baseMap({ items: 'malformed' }), second),
  null,
  'normalization never launders an invalid item container into an empty list'
);

const diceWormholeMap = baseMap({
  items: [{
    type: 'wormhole',
    entrance: pos(1, 1),
    exit: pos(4, 4),
    challenge: clone(diceWormhole.DICE_WORMHOLE_FALLBACK_CHALLENGE),
  }],
});
assert.equal(
  rules.isValidMapForRuleSnapshot(diceWormholeMap, second),
  true,
  'V2 dice wormhole remains readable through the snapshot validator'
);
assert.equal(
  rules.isValidNewMapForRuleSnapshot(diceWormholeMap, second),
  true,
  'new-map boundary accepts the canonical V2 dice wormhole challenge'
);
const cutOffDiceWormholeMap = baseMap({
  obstacles: [
    { position: pos(4, 5), direction: 'down' },
    { position: pos(4, 4), direction: 'down' },
    { position: pos(5, 3), direction: 'right' },
  ],
  items: [{
    ...clone(diceWormholeMap.items[0]),
    exit: pos(5, 5),
  }],
});
assert.equal(
  rules.isValidMapForRuleSnapshot(cutOffDiceWormholeMap, second),
  true,
  'snapshot compatibility reads a legacy exit with one adjacent but isolated cell'
);
assert.equal(
  rules.isValidNewMapForRuleSnapshot(cutOffDiceWormholeMap, second),
  false,
  'trusted new-map validation rejects a wormhole exit with no static-wall route to the goal'
);
const malformedDiceWormholeMap = clone(diceWormholeMap);
malformedDiceWormholeMap.items[0].challenge.endPosition =
  clone(malformedDiceWormholeMap.items[0].challenge.startPosition);
assert.equal(
  rules.isValidNewMapForRuleSnapshot(malformedDiceWormholeMap, second),
  false,
  'new-map boundary rejects malformed V2 dice wormhole geometry'
);
assert.equal(
  rules.isValidMapForRuleSnapshot(baseMap({ rulesVersion: undefined }), second),
  false,
  'missing map rulesVersion rejected'
);
assert.equal(
  rules.isValidMapForRuleSnapshot(baseMap({ rulesVersion: 4 }), second),
  false,
  'mismatched map rulesVersion rejected'
);
assert.equal(
  rules.isValidMapForRuleSnapshot(baseMap({ skillLoadout: undefined }), second),
  false,
  'missing skill loadout rejected'
);
assert.equal(
  rules.isValidMapForRuleSnapshot(baseMap({ skillLoadout: null }), second),
  false,
  'null skill loadout rejected'
);
assert.equal(
  rules.isValidMapForRuleSnapshot(baseMap({ skillLoadout: 'teleport' }), second),
  false,
  'unknown skill loadout rejected'
);
assert.equal(
  rules.isValidMapForRuleSnapshot(baseMap({ skillLoadout: ['dash'] }), second),
  false,
  'array skill loadout rejected'
);
const legacyMissingGearMap = baseMap({ runnerGear: undefined });
assert.equal(
  rules.isValidMapForRuleSnapshot(legacyMissingGearMap, second),
  true,
  'legacy map missing runner gear reads as none'
);
assert.equal(
  rules.isValidNewMapForRuleSnapshot(legacyMissingGearMap, second),
  false,
  'new-map boundary requires an explicit runner gear'
);
const normalizedLegacyGearMap = rules.normalizeNewMapForRuleSnapshot(
  legacyMissingGearMap,
  second
);
assert.ok(normalizedLegacyGearMap, 'legacy missing gear can be normalized at the trusted boundary');
assert.equal(normalizedLegacyGearMap.runnerGear, 'none', 'legacy missing gear normalizes to none');
for (const runnerGear of [null, 'teleport', ['insight']]) {
  assert.equal(
    rules.isValidMapForRuleSnapshot(baseMap({ runnerGear }), second),
    false,
    `invalid runner gear ${JSON.stringify(runnerGear)} rejected`
  );
}
assert.equal(
  rules.isValidMapForRuleSnapshot(baseMap({ startPosition: pos(-1, 0) }), second),
  false,
  'invalid geometry rejected'
);
assert.equal(
  rules.isValidMapForRuleSnapshot(baseMap(), reorderedSkills),
  false,
  'invalid snapshot rejected at map boundary'
);

const wallCandidates = safeWallCandidates();
assert.equal(wallCandidates.length >= 26, true);
assert.equal(
  rules.isValidMapForRuleSnapshot(baseMap({ obstacles: wallCandidates.slice(0, 25) }), second),
  true,
  '25-wall no-gear snapshot budget accepted'
);
assert.equal(
  rules.isValidMapForRuleSnapshot(baseMap({
    obstacles: wallCandidates.slice(0, 25),
    items: [{ type: 'mine', position: pos(1, 1) }],
  }), second),
  false,
  'no-gear item cost pushes map over the 25-wall budget'
);
for (const runnerGear of ['wormholeEscapeKit', 'insight']) {
  assert.equal(
    rules.isValidMapForRuleSnapshot(baseMap({
      runnerGear,
      obstacles: wallCandidates.slice(0, 15),
    }), second),
    true,
    `${runnerGear} accepts the 15-wall equipped budget`
  );
  assert.equal(
    rules.isValidMapForRuleSnapshot(baseMap({
      runnerGear,
      obstacles: wallCandidates.slice(0, 16),
    }), second),
    false,
    `${runnerGear} rejects a 16-wall map`
  );
}
assert.equal(
  utils.getMapRunnerGear({}),
  'none',
  'missing runner gear normalizes to none'
);
assert.equal(utils.getMapWallBudget('none'), 25, 'no gear grants the ten-wall bonus');
assert.equal(utils.getMapWallBudget('wormholeEscapeKit'), 15, 'escape kit uses base budget');
assert.equal(utils.getMapWallBudget({ runnerGear: 'insight' }), 15, 'map helper accepts a map shape');
assert.equal(
  utils.cloneGameMap(legacyMissingGearMap).runnerGear,
  'none',
  'map cloning materializes legacy missing gear'
);
assert.equal(
  rules.isValidMapForRuleSnapshot(baseMap({
    items: [
      { type: 'mine', position: pos(1, 1) },
      { type: 'mine', position: pos(1, 2) },
    ],
  }), second),
  false,
  'snapshot item cap enforced'
);

console.log('GAME RULE SNAPSHOT: all strict snapshot and map validation tests passed');
