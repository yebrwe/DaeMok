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

const adventure = loadTypeScript('src/lib/adventure.ts');
const arena3d = loadTypeScript('src/components/adventure/HackSlashArena3D.types.ts');
const arenaLogic = loadTypeScript('src/components/adventure/HackSlashArena.logic.ts');

const distinctEnemyModels = {
  forest_wolf: 'wolf',
  forest_spider: 'spider',
  forest_treant: 'treant',
  ruins_gargoyle: 'gargoyle',
  crater_golem: 'golem',
};
for (const [enemyId, unitId] of Object.entries(distinctEnemyModels)) {
  assert.equal(arenaLogic.ARENA_UNIT_FOR_ENEMY[enemyId], unitId, `${enemyId} keeps its own 3D species`);
}
assert.equal(new Set(Object.values(distinctEnemyModels)).size, 5, 'the five named monster species never share a fallback model');
assert.equal(arenaLogic.ARENA_UNIT_FOR_ENEMY.forest_boss, 'treant', 'the forest boss preserves the treant silhouette');

assert.equal(arenaLogic.getMeleeWeaponReach(null), 92, 'unarmed vanguard uses the shortest melee reach');
assert.equal(
  arenaLogic.getMeleeWeaponReach('forest_vanguard_weapon:oak:steady:guarded:rare:standard'),
  128,
  'greatsword item keys resolve their exact melee reach',
);
const meleeTargets = [
  { id: 'front-near', x: 88, y: 4, hp: 100, deadAt: null },
  { id: 'front-far', x: 112, y: 0, hp: 100, deadAt: null },
  { id: 'side', x: 10, y: 60, hp: 100, deadAt: null },
  { id: 'behind', x: -28, y: 0, hp: 100, deadAt: null },
];
assert.equal(
  arenaLogic.selectForwardMeleeTarget(meleeTargets, { x: 0, y: 0 }, { x: 1, y: 0 }, 92, 25)?.id,
  'front-near',
  'melee basic attack selects exactly the nearest forward target',
);
assert.equal(
  arenaLogic.selectForwardMeleeTarget(meleeTargets.slice(2), { x: 0, y: 0 }, { x: 1, y: 0 }, 92, 25),
  null,
  'melee basic attack never spills into side or rear targets',
);

const pendingImpacts = [
  { id: 'resolved', executeAt: 999 },
  { id: 'impact-boundary', executeAt: 1_000 },
  { id: 'future-basic', executeAt: 1_001 },
  { id: 'future-echo', executeAt: 1_130 },
];
const interruptedImpacts = arenaLogic.cancelFuturePendingImpacts(pendingImpacts, 1_000);
assert.deepEqual(
  interruptedImpacts.retained.map((impact) => impact.id),
  ['resolved', 'impact-boundary'],
  'hit recovery preserves impacts that already reached their authoritative damage frame',
);
assert.equal(interruptedImpacts.canceledCount, 2, 'hit recovery cancels every future player impact, including delayed echoes');
assert.equal(pendingImpacts.length, 4, 'impact cancellation does not mutate the runtime list while it is inspected');
assert.equal(arenaLogic.isFuturePendingImpact(1_001, 1_000), true, 'enemy windup before impact is interruptible');
assert.equal(arenaLogic.isFuturePendingImpact(1_000, 1_000), false, 'an enemy strike on the impact boundary resolves once');
assert.equal(arenaLogic.isFuturePendingImpact(null, 1_000), false, 'an enemy without a pending strike is never interrupted');

const fastAttackClock = arena3d.resolveArena3DAnimationClock({
  unitId: 'vanguard',
  animation: 'attack',
  animationStartedAt: 1_000,
  now: 1_130,
  impactAt: 1_130,
  animationDurationMs: 410,
  animationRate: 2,
  attackSpeed: 2,
});
assert.equal(fastAttackClock.impactMs, 130, 'runtime impact timestamp is the exact visual strike frame');
assert.equal(fastAttackClock.durationMs, 410, 'pre-scaled runtime duration is not divided by attack speed twice');
assert.equal(fastAttackClock.phase, 'impact', 'animation enters impact on the damage-resolution frame');

const projectedMotion = arena3d.projectArenaMotion(
  { x: 120, y: 80, vx: 240, vy: -120, sampledAt: 1_000 },
  1_050,
);
assert.deepEqual(projectedMotion, { x: 132, y: 74 }, 'render motion fills the interval between simulation snapshots');
assert.deepEqual(
  arena3d.projectArenaMotion({ x: 10, y: 20, vx: 100, vy: 100, sampledAt: 1_000 }, 2_000),
  { x: 17.5, y: 27.5 },
  'stale movement prediction is capped to prevent drift after input or collision changes',
);

assert.equal(adventure.TOTAL_ITEM_VARIETIES, 66_240, 'each class has 66,240 collectible gear variants');
assert.equal(adventure.TOTAL_GLOBAL_ITEM_VARIETIES, 110_400, 'global gear catalog has 110,400 variants');
assert.ok(adventure.TOTAL_ITEM_VARIETIES >= 10_000, 'the per-class catalog exceeds the 10,000 item goal');
assert.deepEqual(adventure.ITEM_TIER_IDS, ['normal', 'magic', 'rare', 'set', 'unique'], 'ARPG item tiers remain stable');
assert.ok(adventure.RUNE_WORD_RECIPES.length >= 20, 'at least twenty ordered rune words are registered');
assert.equal(new Set(adventure.RUNE_WORD_RECIPES.map((recipe) => recipe.id)).size, adventure.RUNE_WORD_RECIPES.length, 'rune word ids are unique');
assert.equal(new Set(adventure.RUNE_WORD_RECIPES.map((recipe) => recipe.runes.join('>'))).size, adventure.RUNE_WORD_RECIPES.length, 'rune word orders are unique');
for (const recipe of adventure.RUNE_WORD_RECIPES) {
  assert.ok(recipe.runes.length >= 2 && recipe.runes.length <= adventure.MAX_ITEM_SOCKETS, `${recipe.id}: socket length is supported`);
  assert.ok(recipe.runes.every((runeId) => adventure.RUNE_IDS.includes(runeId)), `${recipe.id}: every rune exists`);
  assert.ok(recipe.effects.length > 0, `${recipe.id}: rune word has a real proc or skill effect`);
}

const uniqueEffects = Object.values(adventure.UNIQUE_ITEM_DEFINITIONS).flatMap((definition) => {
  assert.ok(definition.effects.length > 0, `${definition.id}: unique is not stat-only`);
  return definition.effects;
});
assert.deepEqual(
  [...new Set(uniqueEffects.map((effect) => effect.kind))].sort(),
  ['elemental', 'lowLife', 'onCast', 'onHit', 'onKill', 'projectile', 'skillModifier'].sort(),
  'unique effects cover every typed arena trigger/modifier family'
);

for (const tier of adventure.ITEM_TIER_IDS) {
  const generated = adventure.generateGear({
    classId: 'ranger',
    regionId: 'ancientRuins',
    level: 28,
    forcedTier: tier,
    now: 900,
    rng: () => 0,
  });
  assert.equal(generated.tier, tier, `${tier}: generated tier is persisted`);
  assert.equal(generated.itemLevel, 28, `${tier}: explicit item level is persisted`);
  assert.equal(generated.socketCount, adventure.deriveItemSocketCount(generated.itemKey, tier, adventure.getGearDisplay(generated).slot), `${tier}: socket count is deterministic`);
  if (tier === 'set') assert.ok(generated.setId, 'set drops receive a set identity');
  if (tier === 'unique') {
    assert.ok(generated.uniqueId, 'unique drops receive a unique identity');
    assert.ok(adventure.UNIQUE_ITEM_DEFINITIONS[generated.uniqueId].effects.length > 0, 'generated unique has a typed effect');
  }
}

const lowAffixes = adventure.getGearAffixPool('prefix', 1, 'weapon', 'rare');
const highAffixes = adventure.getGearAffixPool('prefix', 99, 'weapon', 'rare');
assert.ok(lowAffixes.length > 0 && highAffixes.length > lowAffixes.length, 'item level expands the weighted affix pool');
assert.ok(highAffixes.every((entry) => entry.weight > 0), 'every available affix has a positive drop weight');
assert.equal(adventure.getGearAffixPool('prefix', 99, 'weapon', 'normal').length, 0, 'normal bases reserve affix slots for rune crafting');
assert.ok(
  adventure.getItemTierDropWeights('dragonCrater', true).unique > adventure.getItemTierDropWeights('sunnyField').unique,
  'boss and region weighting improve unique odds'
);

for (const classId of adventure.CLASS_IDS) {
  const keys = new Set();
  for (const base of adventure.GEAR_BASE_FAMILIES) {
    if (base.requiredClassId && base.requiredClassId !== classId) continue;
    const regionIndex = adventure.REGION_IDS.indexOf(base.regionId);
    const materials = adventure.GEAR_MATERIALS.slice(0, Math.min(adventure.GEAR_MATERIALS.length, 3 + regionIndex * 2));
    for (const material of materials) {
      for (const prefix of adventure.GEAR_PREFIXES) {
        for (const suffix of adventure.GEAR_SUFFIXES) {
          for (const rarity of adventure.RARITY_IDS) {
            for (const quality of adventure.GEAR_QUALITY_IDS) {
              const key = adventure.createItemKey(base.id, material.id, prefix.id, suffix.id, rarity, quality);
              assert.equal(keys.has(key), false, `${classId}: duplicate item key ${key}`);
              keys.add(key);
              const display = adventure.getGearDisplayFromItemKey(key);
              assert.ok(display, `${classId}: catalog key can be resolved`);
              assert.equal(display.itemKey, key, `${classId}: resolved catalog key remains stable`);
              assert.ok(!display.requiredClassId || display.requiredClassId === classId, `${classId}: catalog respects class limits`);
            }
          }
        }
      }
    }
  }
  assert.equal(keys.size, adventure.TOTAL_ITEM_VARIETIES, `${classId}: full catalog is enumerable`);
}

const initialPower = new Map();
for (const classId of adventure.CLASS_IDS) {
  const classSkills = adventure.getClassSkills(classId);
  assert.equal(classSkills.length, 6, `${classId}: six skills are registered`);
  assert.deepEqual(classSkills.map((skill) => skill.id), adventure.SKILL_SLOTS, `${classId}: registry order follows skill slots`);
  assert.equal(new Set(classSkills.map((skill) => skill.id)).size, 6, `${classId}: skill ids are unique`);
  for (const skill of classSkills) {
    assert.ok(['melee', 'projectile', 'area', 'dash'].includes(skill.arena.kind), `${classId}/${skill.id}: arena kind is supported`);
    assert.ok(skill.arena.damageMultiplier > 0, `${classId}/${skill.id}: damage multiplier is positive`);
    assert.ok(skill.arena.range > 0, `${classId}/${skill.id}: range is positive`);
    assert.ok(skill.arena.effectKey, `${classId}/${skill.id}: effect key is registered`);
    assert.ok(skill.arena.animationKey, `${classId}/${skill.id}: animation key is registered`);
    if (skill.arena.kind === 'projectile') assert.ok(skill.arena.projectileKey, `${classId}/${skill.id}: projectile key is registered`);
  }
  const state = adventure.createInitialState(classId, `${classId}-tester`, 1_000);
  const stats = adventure.deriveStats(state);
  initialPower.set(classId, stats.power);
  assert.equal(state.level, 1);
  assert.equal(state.mastery.level, 1);
  assert.equal(state.skillRanks.skill1, 1);
  assert.equal(state.skillRanks.skill2, 0);
  assert.deepEqual(state.skillLoadout, ['skill1', null, null, null, null, null], `${classId}: the first learned skill starts on the hotbar`);
  assert.deepEqual(Object.keys(state.skillRanks), adventure.SKILL_SLOTS, `${classId}: all skill ranks are initialized`);
  for (const slot of adventure.SKILL_SLOTS.slice(1)) assert.equal(state.skillRanks[slot], 0, `${classId}/${slot}: starts unlearned`);
  assert.equal(state.discoveredItemKeys.length, 0);
}
assert.equal(new Set(initialPower.values()).size, 3, 'classes start with distinct combat power');

let runeState = adventure.createInitialState('vanguard', '룬 검증자', 1_050);
const socketBase = adventure.generateGear({
  classId: 'vanguard', regionId: 'sunnyField', level: 30, slot: 'weapon', forcedTier: 'normal', now: 1_051, rng: () => 0,
});
assert.equal(socketBase.socketCount, 3, 'the deterministic test base accepts a three-rune word');
const blackSun = adventure.RUNE_WORD_BY_ID.blackSun;
runeState = {
  ...runeState,
  inventory: [socketBase],
  runeInventory: { ...runeState.runeInventory, void: 1, ember: 1, dusk: 1 },
};
for (let index = 0; index < blackSun.runes.length; index += 1) {
  const runeId = blackSun.runes[index];
  const result = adventure.insertRuneIntoItem(runeState, socketBase.instanceId, runeId, 1_052 + index);
  assert.equal(result.ok, true, `${blackSun.id}: rune ${index + 1} inserts in order`);
  runeState = result.state;
  assert.deepEqual(runeState.inventory[0].socketedRunes, blackSun.runes.slice(0, index + 1), `${blackSun.id}: insertion order is serialized`);
}
assert.equal(adventure.resolveRuneWord(runeState.inventory[0]).id, blackSun.id, 'exact rune order activates the recipe');
assert.equal(adventure.resolveRuneWord({ ...runeState.inventory[0], socketedRunes: ['ember', 'void', 'dusk'] }), null, 'the same runes in a wrong order do not activate');
const runeEquipped = adventure.equipItem(runeState, socketBase.instanceId, 1_060);
assert.equal(runeEquipped.ok, true, 'socketed base can be equipped');
runeState = runeEquipped.state;
const runeModifiers = adventure.resolveAdventureCombatModifiers(runeState);
assert.ok(runeModifiers.activeRuneWords.includes('blackSun'), 'combat resolver exposes the active rune word');
assert.ok(runeModifiers.damageMultiplier > 1, 'rune word passive changes arena damage');
assert.ok(runeModifiers.effects.some((entry) => entry.sourceId === 'blackSun' && entry.effect.kind === 'onKill'), 'rune word proc is consumable by the arena');

const uniqueArmor = {
  ...adventure.generateGear({
    classId: 'vanguard', regionId: 'dragonCrater', level: 40, slot: 'armor', forcedTier: 'unique', now: 1_061, rng: () => 0.4,
  }),
  uniqueId: 'bloodforgedAegis',
};
const uniqueState = { ...runeState, equipment: { ...runeState.equipment, armor: uniqueArmor } };
const healthyUniqueModifiers = adventure.resolveAdventureCombatModifiers(uniqueState, { hpRatio: 1 });
const lowLifeUniqueModifiers = adventure.resolveAdventureCombatModifiers(uniqueState, { hpRatio: 0.2 });
assert.ok(healthyUniqueModifiers.effects.some((entry) => entry.effect.kind === 'lowLife' && !entry.active), 'low-life unique is dormant while healthy');
assert.ok(lowLifeUniqueModifiers.effects.some((entry) => entry.effect.kind === 'lowLife' && entry.active), 'low-life unique activates below its threshold');
assert.ok(lowLifeUniqueModifiers.damageTakenMultiplier < healthyUniqueModifiers.damageTakenMultiplier, 'active unique changes arena damage intake');

const setItems = Object.fromEntries(['weapon', 'armor', 'accessory'].map((slot, index) => {
  const item = adventure.generateGear({
    classId: 'vanguard', regionId: 'ancientRuins', level: 30, slot, forcedTier: 'set', now: 1_070 + index, rng: () => 0.5,
  });
  return [slot, { ...item, setId: 'ashenPilgrim' }];
}));
const setModifiers = adventure.resolveAdventureCombatModifiers({ ...runeState, equipment: setItems }, { hpRatio: 1 });
assert.deepEqual(setModifiers.activeSetBonuses, [
  { setId: 'ashenPilgrim', pieces: 2 },
  { setId: 'ashenPilgrim', pieces: 3 },
], 'two- and three-piece set bonuses stack deterministically');

const serializedRuneState = JSON.parse(JSON.stringify(runeState));
const restoredRuneState = adventure.sanitizeAdventureState(serializedRuneState, 'vanguard', 2_000);
assert.deepEqual(restoredRuneState.equipment.weapon.socketedRunes, blackSun.runes, 'ordered sockets survive JSON/Firebase serialization');
assert.equal(adventure.resolveRuneWord(restoredRuneState.equipment.weapon).id, blackSun.id, 'rune word is recomputed after sanitization');

const lockedSkillState = adventure.createInitialState('vanguard', '스킬 해금 검증자', 1_100);
const lockedSkillUpgrade = adventure.upgradeSkill({ ...lockedSkillState, skillPoints: 1 }, 'skill3', 1_101);
assert.equal(lockedSkillUpgrade.ok, false, 'a new skill cannot be learned before its unlock level');
const skillUpgradeSource = { ...lockedSkillState, level: 30, skillPoints: 2 };
const learnedSkill = adventure.upgradeSkill(skillUpgradeSource, 'skill3', 1_102);
assert.equal(learnedSkill.ok, true, 'an unlocked registry skill can be learned');
assert.equal(learnedSkill.state.skillRanks.skill3, 1, 'the learned rank is persisted in its stable slot');
assert.deepEqual(learnedSkill.state.skillLoadout, ['skill1', 'skill3', null, null, null, null], 'a newly learned skill fills the next hotbar slot');

const allSkillsLearned = {
  ...learnedSkill.state,
  level: 30,
  skillRanks: Object.fromEntries(adventure.SKILL_SLOTS.map((slot) => [slot, 1])),
  skillLoadout: ['skill1', 'skill2', 'skill3', null, null, null],
};
const swappedSkill = adventure.setSkillLoadoutSlot(allSkillsLearned, 0, 'skill3', 1_103);
assert.equal(swappedSkill.ok, true, 'an equipped skill can be moved to another hotbar slot');
assert.deepEqual(swappedSkill.state.skillLoadout, ['skill3', 'skill2', 'skill1', null, null, null], 'moving an equipped skill swaps both slots without duplicates');
const replacedSkill = adventure.setSkillLoadoutSlot(swappedSkill.state, 1, 'skill4', 1_104);
assert.equal(replacedSkill.ok, true, 'an inactive learned skill can replace a hotbar slot');
assert.deepEqual(replacedSkill.state.skillLoadout, ['skill3', 'skill4', 'skill1', null, null, null], 'slot replacement changes the persisted order');
const clearedSkill = adventure.setSkillLoadoutSlot(replacedSkill.state, 1, null, 1_105);
assert.equal(clearedSkill.ok, true, 'a non-final hotbar skill can be removed');
assert.deepEqual(clearedSkill.state.skillLoadout, ['skill3', null, 'skill1', null, null, null], 'removing a skill preserves the other hotbar positions');
assert.equal(adventure.setSkillLoadoutSlot({ ...clearedSkill.state, skillLoadout: ['skill1', null, null, null, null, null] }, 0, null, 1_106).ok, false, 'the final hotbar skill cannot be removed');
assert.equal(adventure.setSkillLoadoutSlot(lockedSkillState, 0, 'skill6', 1_107).ok, false, 'an unlearned skill cannot be equipped');

const legacySkillPayload = {
  ...lockedSkillState,
  level: 5,
  skillRanks: { skill1: 3, skill2: 2 },
};
delete legacySkillPayload.skillLoadout;
const legacySkillSave = adventure.sanitizeAdventureState(legacySkillPayload, 'vanguard', 1_108);
assert.equal(legacySkillSave.skillRanks.skill1, 3, 'v1 skill1 rank survives migration');
assert.equal(legacySkillSave.skillRanks.skill2, 2, 'v1 skill2 rank survives migration');
assert.deepEqual(legacySkillSave.skillLoadout, ['skill1', 'skill2', null, null, null, null], 'a Firebase save without a hotbar migrates learned unlocked skills in stable order');
for (const slot of adventure.SKILL_SLOTS.slice(2)) assert.equal(legacySkillSave.skillRanks[slot], 0, `legacy save defaults ${slot}`);

const sanitizedLoadout = adventure.sanitizeAdventureState({
  ...allSkillsLearned,
  skillLoadout: ['skill4', 'skill4', 'not-a-skill', 'skill2'],
}, 'vanguard', 1_109);
assert.deepEqual(sanitizedLoadout.skillLoadout, ['skill4', null, null, 'skill2', null, null], 'Firebase sanitization removes duplicate and unknown hotbar entries without shifting valid slots');

let skillCombatNow = 1_110;
for (const classId of adventure.CLASS_IDS) {
  const classSkillSource = adventure.createInitialState(classId, `${classId}-skill-tester`, skillCombatNow++);
  const unlockedSkills = {
    ...classSkillSource,
    level: 30,
    skillRanks: Object.fromEntries(adventure.SKILL_SLOTS.map((slot) => [slot, 1])),
  };
  unlockedSkills.hp = adventure.deriveStats(unlockedSkills).maxHp;
  for (const slot of adventure.SKILL_SLOTS.slice(2)) {
    const started = adventure.startEncounter(unlockedSkills, { enemyId: 'field_slime' }, () => 0.5, skillCombatNow++);
    assert.equal(started.ok, true, `${classId}/${slot}: turn encounter starts`);
    const durableTarget = {
      ...started.state,
      combat: {
        ...started.state.combat,
        enemy: { ...started.state.combat.enemy, hp: 100_000, maxHp: 100_000 },
      },
    };
    const turn = adventure.combatAction(durableTarget, slot, () => 0.5, skillCombatNow++);
    assert.equal(turn.ok, true, `${classId}/${slot}: turn combat resolves through registry metadata`);
    assert.equal(turn.outcome, 'ongoing');
    assert.equal(turn.state.combat.cooldowns[slot], adventure.CLASS_DEFINITIONS[classId].skills[slot].cooldown);
    assert.ok(turn.events.some((event) => event.includes(adventure.CLASS_DEFINITIONS[classId].skills[slot].name)), `${classId}/${slot}: emits its combat event`);
  }
}

let now = 10_000;
let state = adventure.createInitialState('ranger', '성장 검증자', now);
state = {
  ...state,
  gold: 100_000,
  baseStats: { strength: 45, vitality: 35, defense: 30, agility: 25 },
  hp: 500,
};
const deterministicRng = () => 0;

function winEncounter(enemyId) {
  now += 10;
  const maxHp = adventure.deriveStats(state).maxHp;
  state = { ...state, hp: maxHp };
  const started = adventure.startEncounter(state, { enemyId }, deterministicRng, now);
  assert.equal(started.ok, true, `${enemyId}: encounter starts`);
  state = started.state;
  let outcome = 'ongoing';
  for (let turn = 0; turn < 30 && outcome === 'ongoing'; turn += 1) {
    now += 10;
    const action = state.combat?.cooldowns.skill1 === 0 ? 'skill1' : 'attack';
    const result = adventure.combatAction(state, action, deterministicRng, now);
    assert.equal(result.ok, true, `${enemyId}: turn ${turn + 1} resolves`);
    state = result.state;
    outcome = result.outcome;
  }
  assert.equal(outcome, 'victory', `${enemyId}: encounter ends in victory`);
}

for (let kill = 0; kill < adventure.BOSS_KILLS_REQUIRED * 2; kill += 1) winEncounter('field_slime');
assert.equal(adventure.getBossProgress(state).available, true, 'regular kills unlock the regional boss');
assert.ok(state.level > 1, 'combat grants character levels');
assert.ok(state.inventory.length > 0, 'combat drops equipment');
assert.ok(state.discoveredItemKeys.length > 0, 'drops permanently populate the collection');
assert.ok(Object.values(state.runeInventory).some((count) => count > 0), 'combat populates the persisted rune inventory');

winEncounter('field_boss');
assert.equal(state.bossKills.sunnyField, 1, 'boss victory is persistent');
assert.equal(state.statistics.bossesKilled, 1, 'boss statistics are updated');
for (let kill = 0; kill < adventure.BOSS_KILLS_REQUIRED; kill += 1) winEncounter('field_slime');
assert.ok(state.mastery.level > 1, 'combat and boss rewards grant class mastery');

const firstItem = state.inventory[0];
const equipped = adventure.equipItem(state, firstItem.instanceId, ++now);
assert.equal(equipped.ok, true, 'dropped equipment can be equipped');
state = equipped.state;
const equippedItem = state.equipment[firstItem ? adventure.getEquipmentDisplay(firstItem).slot : 'weapon'];
assert.ok(equippedItem, 'equipment occupies its slot');
const enhanced = adventure.enhanceGear(state, equippedItem.instanceId, ++now);
assert.equal(enhanced.ok, true, 'equipped gear can be enhanced');
state = enhanced.state;
assert.equal(state.equipment[adventure.getEquipmentDisplay(equippedItem).slot].enhance, 1, 'enhancement level persists');
assert.equal(state.statistics.enhancements, 1, 'enhancement statistics are updated');

const quest = adventure.claimQuest(state, 'first_hunt', ++now);
assert.equal(quest.ok, true, 'completed quest rewards can be claimed');
state = quest.state;
assert.ok(state.claimedQuestIds.includes('first_hunt'), 'claimed quest id persists');

const beforeOffline = state;
const offlineNow = now + 12 * 60 * 60 * 1000;
state = { ...state, lastActiveAt: now };
const offline = adventure.applyOfflineProgress(state, offlineNow);
assert.equal(offline.ok, true, 'offline progress resolves');
assert.equal(offline.offlineProgress.hours, adventure.MAX_OFFLINE_HOURS, 'offline rewards cap at eight hours');
assert.ok(offline.state.statistics.offlineKills > beforeOffline.statistics.offlineKills, 'offline hunting grants kills');
assert.ok(offline.state.gold > state.gold, 'offline hunting grants gold');

const sanitized = adventure.sanitizeAdventureState({
  ...offline.state,
  level: 999,
  gold: -50,
  hp: 999_999,
  currentRegionId: 'invalid-region',
  inventory: [{ definitionId: 'invalid-item' }],
}, 'vanguard', offlineNow + 1);
assert.equal(sanitized.level, adventure.MAX_LEVEL, 'invalid high level is clamped');
assert.equal(sanitized.gold, 0, 'negative gold is clamped');
assert.ok(sanitized.hp <= adventure.deriveStats(sanitized).maxHp, 'hp is clamped to derived max');
assert.ok(adventure.REGION_IDS.includes(sanitized.currentRegionId), 'invalid region is repaired');
assert.equal(sanitized.inventory.some((item) => item.definitionId === 'invalid-item'), false, 'invalid gear is rejected');

const legacyItem = { ...socketBase };
delete legacyItem.tier;
delete legacyItem.itemLevel;
delete legacyItem.socketCount;
delete legacyItem.socketedRunes;
delete legacyItem.setId;
delete legacyItem.uniqueId;
const legacyItemState = adventure.sanitizeAdventureState({
  ...adventure.createInitialState('vanguard', '구형 장비 검증자', offlineNow),
  inventory: [legacyItem],
  runeInventory: undefined,
}, 'vanguard', offlineNow + 1);
assert.equal(legacyItemState.inventory[0].tier, 'normal', 'legacy rarity migrates to the normal tier');
assert.equal(legacyItemState.inventory[0].itemLevel, legacyItem.level, 'legacy level migrates to item level');
assert.deepEqual(legacyItemState.inventory[0].socketedRunes, [], 'legacy equipment starts with empty sockets');
assert.ok(adventure.RUNE_IDS.every((runeId) => legacyItemState.runeInventory[runeId] === 0), 'legacy save receives a complete empty rune inventory');

const tamperedItemState = adventure.sanitizeAdventureState({
  ...adventure.createInitialState('vanguard', '오염 장비 검증자', offlineNow),
  inventory: [{
    ...socketBase,
    rarity: 'legendary',
    tier: 'normal',
    itemLevel: 999,
    socketCount: 99,
    socketedRunes: ['crown', 'invalid-rune', 'ember', 'tide', 'gale', 'stone'],
    uniqueId: 'nightpiercer',
  }],
  runeInventory: { crown: 50_000, ember: -4, unexpected: 100 },
}, 'vanguard', offlineNow + 1);
const repairedItem = tamperedItemState.inventory[0];
assert.equal(repairedItem.tier, 'unique', 'tier is derived from the compatible persisted rarity');
assert.equal(repairedItem.itemLevel, adventure.MAX_LEVEL, 'item level is clamped');
assert.equal(repairedItem.socketCount, adventure.deriveItemSocketCount(repairedItem.itemKey, repairedItem.tier, 'weapon'), 'fabricated socket capacity is discarded');
assert.ok(repairedItem.socketedRunes.length <= repairedItem.socketCount, 'socket payload is capped to the deterministic capacity');
assert.ok(repairedItem.socketedRunes.every((runeId) => adventure.RUNE_IDS.includes(runeId)), 'unknown socket runes are discarded');
assert.notEqual(repairedItem.uniqueId, 'nightpiercer', 'a unique identity for another class is repaired');
assert.equal(tamperedItemState.runeInventory.crown, adventure.MAX_RUNE_STACK, 'rune stacks are clamped');
assert.equal(tamperedItemState.runeInventory.ember, 0, 'negative rune stacks are repaired');
assert.equal(Object.hasOwn(tamperedItemState.runeInventory, 'unexpected'), false, 'unknown rune inventory keys are removed');

function createCombatTester(name, createdAt) {
  const initial = adventure.createInitialState('vanguard', name, createdAt);
  const boosted = {
    ...initial,
    baseStats: { ...initial.baseStats, strength: 500 },
  };
  return { ...boosted, hp: Math.min(70, adventure.deriveStats(boosted).maxHp) };
}

let expeditionNow = offlineNow + 1_000;
let expedition = createCombatTester('원정 검증자', expeditionNow);
const expeditionInitialHp = expedition.hp;
const expeditionStarted = adventure.startEncounter(
  expedition,
  { mode: 'expedition', enemyId: 'field_slime' },
  deterministicRng,
  ++expeditionNow,
);
assert.equal(expeditionStarted.ok, true, 'five-wave expedition starts');
assert.equal(expeditionStarted.state.combat.mode, 'expedition');
assert.equal(expeditionStarted.state.combat.wave, 1);
assert.equal(expeditionStarted.state.combat.totalWaves, adventure.EXPEDITION_WAVES);
expedition = {
  ...expeditionStarted.state,
  combat: {
    ...expeditionStarted.state.combat,
    cooldowns: { skill1: 4, skill2: 4 },
  },
};

const expeditionRanks = [];
const expeditionRewards = [];
for (let expectedWave = 1; expectedWave <= adventure.EXPEDITION_WAVES; expectedWave += 1) {
  assert.ok(expedition.combat, `wave ${expectedWave}: combat remains active`);
  assert.equal(expedition.combat.wave, expectedWave, `wave ${expectedWave}: index is persisted`);
  if (expectedWave === 4) assert.equal(expedition.combat.eliteKills, 1, 'defeated elite count carries into later waves');
  expeditionRanks.push(expedition.combat.enemy.rank);
  const result = adventure.combatAction(expedition, 'attack', deterministicRng, ++expeditionNow);
  assert.equal(result.ok, true, `wave ${expectedWave}: kill resolves`);
  assert.ok(result.reward, `wave ${expectedWave}: reward checkpoint is returned`);
  assert.equal(result.reward.wave, expectedWave, `wave ${expectedWave}: reward identifies its wave`);
  assert.equal(result.reward.totalWaves, adventure.EXPEDITION_WAVES);
  expeditionRewards.push(result.reward);
  expedition = result.state;

  if (expectedWave === 1) {
    assert.equal(expedition.hp, expeditionInitialHp, 'wave transition preserves current HP');
    assert.equal(expedition.combat.cooldowns.skill1, 3, 'wave transition carries reduced skill1 cooldown');
    assert.equal(expedition.combat.cooldowns.skill2, 3, 'wave transition carries reduced skill2 cooldown');
    for (const slot of adventure.SKILL_SLOTS.slice(2)) assert.equal(expedition.combat.cooldowns[slot], 0, `legacy cooldown state defaults ${slot}`);
  }
  if (expectedWave < adventure.EXPEDITION_WAVES) {
    assert.equal(result.outcome, 'ongoing', 'intermediate wave does not end the expedition');
    assert.equal(expedition.combat.wave, expectedWave + 1, 'the next enemy is installed atomically');
  } else {
    assert.equal(result.outcome, 'victory', 'the fifth wave completes the expedition');
    assert.equal(result.reward.expeditionComplete, true);
    assert.equal(expedition.combat, null);
  }

  if (expectedWave === 2) {
    const restored = adventure.sanitizeAdventureState(JSON.parse(JSON.stringify(expedition)), 'vanguard', expeditionNow + 1);
    assert.equal(restored.combat.mode, 'expedition', 'mid-expedition save restores its mode');
    assert.equal(restored.combat.wave, 3, 'mid-expedition save restores its current wave');
    assert.equal(restored.combat.enemy.rank, 'elite', 'the guaranteed third wave remains elite after reload');
    assert.deepEqual(restored.combat.enemy.affixes, ['berserker'], 'elite affixes survive serialization');
    assert.deepEqual(restored.combat.cooldowns, expedition.combat.cooldowns, 'mid-expedition save preserves cooldowns');
    assert.equal(restored.hp, expedition.hp, 'mid-expedition save preserves current HP');
    expedition = restored;
  }
}

assert.deepEqual(expeditionRanks, ['normal', 'normal', 'elite', 'normal', 'elite'], 'expedition has guaranteed elite waves 3 and 5');
assert.equal(expedition.statistics.battlesWon, 1, 'a completed five-wave expedition counts as one battle victory');
assert.equal(expedition.statistics.totalKills, 5, 'each expedition kill advances boss qualification once');
assert.equal(expedition.killCounts.field_slime, 5, 'five enemies create five regular kill records');
assert.equal(expedition.bossKills.sunnyField, 0, 'expedition elites never increment real boss kills');
assert.equal(expedition.statistics.bossesKilled, 0, 'expedition elites never increment boss statistics');
assert.ok(expeditionRewards[2].exp > expeditionRewards[1].exp, 'elite waves grant scaled experience');
assert.ok(['rare', 'epic', 'legendary'].includes(expeditionRewards[2].drop.rarity), 'elite drops are at least rare');

const legacyDuelSource = adventure.startEncounter(
  createCombatTester('구 저장 검증자', ++expeditionNow),
  { enemyId: 'field_slime' },
  deterministicRng,
  ++expeditionNow,
).state;
const legacyDuelRaw = JSON.parse(JSON.stringify(legacyDuelSource));
delete legacyDuelRaw.combat.mode;
delete legacyDuelRaw.combat.wave;
delete legacyDuelRaw.combat.totalWaves;
delete legacyDuelRaw.combat.eliteKills;
delete legacyDuelRaw.combat.enemy.rank;
delete legacyDuelRaw.combat.enemy.affixes;
const legacyDuel = adventure.sanitizeAdventureState(legacyDuelRaw, 'vanguard', ++expeditionNow);
assert.equal(legacyDuel.combat.mode, 'duel', 'legacy v1 combat defaults to duel');
assert.equal(legacyDuel.combat.wave, 1, 'legacy v1 combat defaults to one wave');
assert.equal(legacyDuel.combat.totalWaves, 1, 'legacy v1 combat remains a single encounter');
assert.equal(legacyDuel.combat.enemy.rank, 'normal', 'legacy regular enemies remain normal');
assert.deepEqual(legacyDuel.combat.enemy.affixes, [], 'legacy regular enemies have no elite affixes');

let bossTester = createCombatTester('보스 검증자', ++expeditionNow);
bossTester = {
  ...bossTester,
  killCounts: { ...bossTester.killCounts, field_slime: adventure.BOSS_KILLS_REQUIRED },
};
const bossExpedition = adventure.startEncounter(
  bossTester,
  { mode: 'expedition', enemyId: 'field_boss' },
  deterministicRng,
  ++expeditionNow,
);
assert.equal(bossExpedition.ok, false, 'a real regional boss cannot be converted into an expedition elite');
const bossStarted = adventure.startEncounter(
  bossTester,
  { enemyId: 'field_boss' },
  deterministicRng,
  ++expeditionNow,
);
assert.equal(bossStarted.state.combat.enemy.rank, 'boss', 'a real regional boss keeps boss rank');
const bossFinished = adventure.combatAction(bossStarted.state, 'attack', deterministicRng, ++expeditionNow);
assert.equal(bossFinished.outcome, 'victory');
assert.equal(bossFinished.reward.expeditionComplete, false, 'ordinary boss duels are not marked as expeditions');
assert.equal(bossFinished.state.bossKills.sunnyField, 1, 'real boss kill increments regional boss progress once');
assert.equal(bossFinished.state.statistics.bossesKilled, 1, 'real boss kill increments boss statistics once');

let arena = createCombatTester('아레나 검증자', ++expeditionNow);
const arenaHp = arena.hp;
const arenaRunId = 'arena-run-checkpoint-test';
const skippedArenaStart = adventure.resolveArenaKill(
  arena,
  'field_slime',
  { runId: 'arena-skipped-start', checkpoint: 1, wave: 3, totalWaves: 5 },
  deterministicRng,
  ++expeditionNow,
);
assert.equal(skippedArenaStart.ok, false, 'a tracked arena run must begin at wave one');
assert.equal(skippedArenaStart.state.statistics.totalKills, 0, 'an invalid arena start grants no reward');
const arenaRegular = adventure.resolveArenaKill(
  arena,
  'field_slime',
  { runId: arenaRunId, checkpoint: 1, damageTaken: 7, damageDealt: 99, remainingHp: arenaHp - 2, wave: 1, totalWaves: 5 },
  deterministicRng,
  ++expeditionNow,
);
assert.equal(arenaRegular.ok, true, 'arena kill checkpoint resolves without turn combat');
assert.equal(arenaRegular.outcome, 'ongoing', 'an intermediate arena checkpoint keeps the run active');
assert.equal(arenaRegular.state.hp, arenaHp - 2, 'arena checkpoint preserves life-on-hit and kill healing from local combat');
assert.equal(arenaRegular.state.statistics.damageTaken, 7, 'arena damage statistics are checkpointed once');
assert.equal(arenaRegular.state.statistics.damageDealt, 99, 'arena dealt damage is checkpointed once');
assert.equal(arenaRegular.state.statistics.totalKills, 1, 'arena kill statistics are checkpointed once');
assert.equal(arenaRegular.state.statistics.battlesWon, 0, 'an intermediate arena kill is not a completed battle');
assert.equal(arenaRegular.state.killCounts.field_slime, 1, 'arena kill advances regional boss qualification');
assert.equal(arenaRegular.reward.wave, 1);
assert.equal(arenaRegular.reward.expeditionComplete, false);
assert.deepEqual(arenaRegular.state.arenaCheckpoint, {
  runId: arenaRunId,
  checkpoint: 1,
  wave: 1,
  totalWaves: 5,
  outcome: 'ongoing',
}, 'arena run identity is persisted with its checkpoint');
arena = arenaRegular.state;

const skippedArenaCheckpoint = adventure.resolveArenaKill(
  arena,
  'field_slime',
  { runId: arenaRunId, checkpoint: 3, wave: 2, totalWaves: 5 },
  deterministicRng,
  ++expeditionNow,
);
assert.equal(skippedArenaCheckpoint.ok, false, 'local arena settlement cannot skip a same-run checkpoint');
assert.equal(skippedArenaCheckpoint.state.statistics.totalKills, 1, 'a skipped local checkpoint grants no reward');

const arenaSecond = adventure.resolveArenaKill(
  arena,
  'field_slime',
  { runId: arenaRunId, checkpoint: 2, wave: 2, totalWaves: 5 },
  deterministicRng,
  ++expeditionNow,
);
assert.equal(arenaSecond.ok, true, 'the next monotonic arena checkpoint resolves');
const replayedArenaSecond = adventure.resolveArenaKill(
  arenaSecond.state,
  'field_slime',
  { runId: arenaRunId, checkpoint: 2, wave: 2, totalWaves: 5 },
  deterministicRng,
  ++expeditionNow,
);
assert.equal(replayedArenaSecond.ok, false, 'a replayed arena checkpoint is rejected');
assert.equal(replayedArenaSecond.state.statistics.totalKills, 2, 'a replayed checkpoint cannot duplicate rewards or kills');

const arenaElite = adventure.resolveArenaKill(
  arenaSecond.state,
  'field_slime',
  { runId: arenaRunId, checkpoint: 3, elite: true, affixes: ['ironclad'], wave: 3, totalWaves: 5 },
  deterministicRng,
  ++expeditionNow,
);
assert.equal(arenaElite.ok, true, 'arena elite checkpoint uses the shared reward path');
assert.equal(arenaElite.reward.enemyRank, 'elite', 'arena elite checkpoints use elite rewards');
assert.ok(arenaElite.reward.exp > arenaRegular.reward.exp, 'arena elite reward receives the elite multiplier');
assert.equal(arenaElite.state.statistics.totalKills, 3, 'a third arena checkpoint adds exactly one kill');
assert.equal(arenaElite.state.statistics.bossesKilled, 0, 'arena elite cannot spoof a real boss kill');

const restoredArena = adventure.sanitizeAdventureState(
  JSON.parse(JSON.stringify(arenaElite.state)),
  'vanguard',
  ++expeditionNow,
);
assert.deepEqual(restoredArena.arenaCheckpoint, arenaElite.state.arenaCheckpoint, 'arena checkpoint survives v1 serialization');

const arenaFourth = adventure.resolveArenaKill(
  arenaElite.state,
  'field_slime',
  { runId: arenaRunId, checkpoint: 4, wave: 4, totalWaves: 5 },
  deterministicRng,
  ++expeditionNow,
);
const arenaFinalWave = adventure.resolveArenaKill(
  arenaFourth.state,
  'field_slime',
  { runId: arenaRunId, checkpoint: 5, wave: 5, totalWaves: 5 },
  deterministicRng,
  ++expeditionNow,
);
assert.equal(arenaFinalWave.outcome, 'ongoing', 'entering the final wave does not imply its final enemy is dead');
assert.equal(arenaFinalWave.state.statistics.battlesWon, 0, 'final-wave intermediate kills do not complete the battle');
const arenaFinal = adventure.resolveArenaKill(
  arenaFinalWave.state,
  'field_slime',
  { runId: arenaRunId, checkpoint: 6, wave: 5, totalWaves: 5, elite: true, expeditionComplete: true },
  deterministicRng,
  ++expeditionNow,
);
assert.equal(arenaFinal.ok, true, 'the final arena checkpoint resolves');
assert.equal(arenaFinal.outcome, 'victory', 'the final arena checkpoint completes the run');
assert.equal(arenaFinal.reward.enemyRank, 'elite', 'the fifth arena wave is a guaranteed elite');
assert.equal(arenaFinal.reward.expeditionComplete, true);
assert.equal(arenaFinal.state.statistics.battlesWon, 1, 'all arena kills count as one completed battle');
assert.equal(arenaFinal.state.statistics.totalKills, 6, 'six arena checkpoints grant exactly six kills');

let continuousFieldState = arenaFinal.state;
const continuousRunId = 'continuous-field-run';
for (let checkpoint = 1; checkpoint <= 3; checkpoint += 1) {
  const result = adventure.resolveArenaKill(
    continuousFieldState,
    'field_slime',
    { runId: continuousRunId, checkpoint, wave: 1, totalWaves: 1, continuous: true, expeditionComplete: false },
    deterministicRng,
    ++expeditionNow,
  );
  assert.equal(result.ok, true, `continuous field checkpoint ${checkpoint} resolves`);
  assert.equal(result.outcome, 'ongoing', 'continuous field kills do not trigger a wave completion');
  continuousFieldState = result.state;
}
assert.deepEqual(
  continuousFieldState.arenaCheckpoint,
  { runId: continuousRunId, checkpoint: 3, wave: 1, totalWaves: 1, outcome: 'ongoing' },
  'continuous field persistence keeps one long-running checkpoint stream',
);
assert.equal(
  continuousFieldState.statistics.battlesWon,
  arenaFinal.state.statistics.battlesWon,
  'continuous population replenishment never manufactures wave victories',
);
const switchedContinuousRun = adventure.resolveArenaKill(
  continuousFieldState,
  'field_slime',
  { runId: 'continuous-replay-run', checkpoint: 1, wave: 1, totalWaves: 1, continuous: true },
  deterministicRng,
  ++expeditionNow,
);
assert.equal(switchedContinuousRun.ok, false, 'an ongoing field checkpoint cannot switch run IDs to replay old rewards');
assert.equal(switchedContinuousRun.state.statistics.totalKills, continuousFieldState.statistics.totalKills);

const arenaBossLocked = adventure.resolveArenaKill(
  arenaFinal.state,
  'field_boss',
  0,
  deterministicRng,
  ++expeditionNow,
);
assert.equal(arenaBossLocked.ok, false, 'arena boss checkpoint obeys the existing boss gate');
const unlockedArenaBossState = {
  ...arenaFinal.state,
  killCounts: { ...arenaFinal.state.killCounts, field_slime: adventure.BOSS_KILLS_REQUIRED },
};
const arenaBoss = adventure.resolveArenaKill(
  unlockedArenaBossState,
  'field_boss',
  { runId: 'arena-boss-run', checkpoint: 1, wave: 1, totalWaves: 1 },
  deterministicRng,
  ++expeditionNow,
);
assert.equal(arenaBoss.ok, true, 'qualified arena boss kill resolves');
assert.equal(arenaBoss.reward.enemyRank, 'boss');
assert.equal(arenaBoss.state.bossKills.sunnyField, 1, 'arena real boss advances regional boss kills once');
assert.equal(arenaBoss.state.statistics.bossesKilled, 1, 'arena real boss advances boss statistics once');

const arenaDefeatSource = { ...arenaFinal.state, hp: Math.min(30, adventure.deriveStats(arenaFinal.state).maxHp) };
const arenaDefeatOptions = {
  runId: 'arena-defeat-run',
  checkpoint: 1,
  wave: 1,
  totalWaves: 5,
  damageTaken: 13,
  damageDealt: 21,
};
const arenaDefeat = adventure.resolveArenaDefeat(arenaDefeatSource, arenaDefeatOptions, ++expeditionNow);
assert.equal(arenaDefeat.ok, true, 'arena defeat checkpoint resolves without turn combat');
assert.equal(arenaDefeat.state.statistics.battlesLost, arenaDefeatSource.statistics.battlesLost + 1, 'arena defeat is counted once');
assert.equal(arenaDefeat.state.statistics.damageTaken, arenaDefeatSource.statistics.damageTaken + 13, 'arena defeat records local damage once');
assert.equal(arenaDefeat.state.statistics.damageDealt, arenaDefeatSource.statistics.damageDealt + 21, 'arena defeat records dealt damage once');
assert.equal(arenaDefeat.state.hp, Math.ceil(adventure.deriveStats(arenaDefeatSource).maxHp * 0.5), 'arena defeat uses the standard rescue recovery');
const arenaDefeatReplay = adventure.resolveArenaDefeat(arenaDefeat.state, arenaDefeatOptions, ++expeditionNow);
assert.equal(arenaDefeatReplay.ok, false, 'a replayed arena defeat cannot increment losses twice');
assert.equal(arenaDefeatReplay.state.statistics.battlesLost, arenaDefeat.state.statistics.battlesLost);

const lethalArenaSource = createCombatTester('치명타 검증자', ++expeditionNow);
const lethalArena = adventure.resolveArenaKill(
  lethalArenaSource,
  'field_slime',
  {
    runId: 'arena-lethal-run',
    checkpoint: 1,
    wave: 1,
    totalWaves: 5,
    damageTaken: lethalArenaSource.hp,
  },
  deterministicRng,
  ++expeditionNow,
);
assert.equal(lethalArena.outcome, 'defeat', 'lethal checkpoint damage resolves defeat instead of a one-HP victory');
assert.equal(lethalArena.reward, undefined, 'lethal checkpoint damage grants no kill reward');
assert.equal(lethalArena.state.statistics.totalKills, 0, 'lethal checkpoint damage grants no kill');
assert.equal(lethalArena.state.statistics.battlesLost, 1, 'lethal checkpoint damage records one defeat');

const arenaDuringDuel = adventure.resolveArenaKill(legacyDuel, 'field_slime', 0, deterministicRng, ++expeditionNow);
assert.equal(arenaDuringDuel.ok, false, 'arena checkpoint cannot overlap an active turn encounter');

console.log('ADVENTURE: 66k catalog, typed unique/set effects, 20 rune words, sockets, combat modifiers, growth, expedition, checkpoints, and sanitization passed');
