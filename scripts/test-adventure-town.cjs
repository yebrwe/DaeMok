'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');
const ts = require('typescript');

const ROOT = path.join(__dirname, '..');

Module._extensions['.ts'] = (loaded, filename) => {
  const source = fs.readFileSync(filename, 'utf8');
  const output = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true,
    },
    fileName: filename,
  }).outputText;
  loaded._compile(output, filename);
};

const adventure = require(path.join(ROOT, 'src/lib/adventure.ts'));
const town = require(path.join(ROOT, 'src/lib/adventureTown.ts'));

const NOW = 1_800_000_000_000;
const initial = adventure.createInitialState('vanguard', '마을 검증자', NOW);
const staleCombat = adventure.startEncounter(initial, { enemyId: 'field_slime' }, () => 0, NOW + 1).state;
let state = town.withAdventureTownState(staleCombat, undefined, NOW + 2);

assert.equal(state.combat, null, 'loading the real-time town state removes a legacy turn encounter');
assert.equal(state.town.location, 'town', 'new characters start in the town hub');
assert.equal(state.town.merchantStock.length, town.TOWN_MERCHANT_STOCK_SIZE, 'the town merchant has deterministic stock');
const staleTownCheckpoint = town.withAdventureTownState({
  ...state,
  arenaCheckpoint: { runId: 'stale-town-run', checkpoint: 1, wave: 1, totalWaves: 1, outcome: 'ongoing' },
}, state.town, NOW + 2);
assert.equal(staleTownCheckpoint.arenaCheckpoint, null, 'loading a town state cannot revive a wilderness checkpoint');
const lockedDestination = town.selectTownDestination(state, 'mistForest', NOW + 2);
assert.equal(lockedDestination.ok, false, 'the waypoint rejects a level-locked destination');
const unlockedDestination = town.selectTownDestination({ ...state, level: 99 }, 'mistForest', NOW + 2);
assert.equal(unlockedDestination.ok, true, 'the waypoint selects an unlocked field destination');
assert.equal(unlockedDestination.state.currentRegionId, 'mistForest');
assert.equal(unlockedDestination.state.town.lastFieldRegionId, 'mistForest');
const alignedDestination = town.withAdventureTownState(
  { ...state, level: 99, currentRegionId: 'sunnyField' },
  { ...state.town, lastFieldRegionId: 'mistForest' },
  NOW + 2,
);
assert.equal(alignedDestination.currentRegionId, 'mistForest', 'loading keeps the waypoint destination and active region aligned');
const rejectedLockedDestination = town.withAdventureTownState(
  { ...state, currentRegionId: 'sunnyField' },
  { ...state.town, townId: 'mistForest-town', lastFieldRegionId: 'mistForest' },
  NOW + 2,
);
assert.equal(rejectedLockedDestination.currentRegionId, 'sunnyField', 'loading cannot restore a level-locked waypoint');
assert.equal(rejectedLockedDestination.town.townId, 'sunnyField-town');

const departed = town.leaveTown(state, NOW + 3);
assert.equal(departed.ok, true, 'the gate enters the continuous wilderness');
assert.equal(departed.state.town.location, 'wilderness');
const duplicateDeparture = town.leaveTown(departed.state, NOW + 4);
assert.equal(duplicateDeparture.ok, false, 'the gate cannot start duplicate field sessions');

const returned = town.returnToTown(departed.state, NOW + 5);
assert.equal(returned.ok, true, 'the player can return from the field');
assert.equal(returned.state.town.location, 'town');
assert.equal(returned.state.arenaCheckpoint, null, 'returning to town closes the field checkpoint');
const lossesBeforeLateExit = returned.state.statistics.battlesLost;
const lateRunExit = town.resolveWildernessArenaDefeat(returned.state, {
  runId: 'late-run-exit',
  checkpoint: 1,
  wave: 1,
  totalWaves: 1,
  damageTaken: 10,
  damageDealt: 5,
}, NOW + 6);
assert.equal(lateRunExit.ok, false, 'a delayed arena cleanup cannot settle after returning to town');
assert.equal(lateRunExit.state.statistics.battlesLost, lossesBeforeLateExit, 'normal town return never counts as a defeat');
assert.equal(lateRunExit.state.arenaCheckpoint, null, 'a delayed arena cleanup cannot recreate the cleared checkpoint');
state = { ...returned.state, gold: 100_000 };

const merchantItem = state.town.merchantStock[0];
const merchantPrice = town.getTownMerchantPrice(merchantItem);
const bought = town.buyTownMerchantItem(state, merchantItem.instanceId, NOW + 6);
assert.equal(bought.ok, true, 'merchant purchases enter the inventory');
assert.equal(bought.state.gold, state.gold - merchantPrice);
assert.ok(bought.state.inventory.some((item) => item.instanceId === merchantItem.instanceId));
assert.ok(!bought.state.town.merchantStock.some((item) => item.instanceId === merchantItem.instanceId));

const saleValue = adventure.getGearSellPrice(merchantItem);
const sold = town.sellItemToTownMerchant(bought.state, merchantItem.instanceId, NOW + 7);
assert.equal(sold.ok, true, 'inventory gear can be sold only through the town merchant flow');
assert.equal(sold.state.gold, bought.state.gold + saleValue);

let soldOutState = { ...state, gold: 1_000_000 };
for (const stockItem of [...soldOutState.town.merchantStock]) {
  const purchase = town.buyTownMerchantItem(soldOutState, stockItem.instanceId, NOW + 7);
  assert.equal(purchase.ok, true, 'every remaining merchant item can be purchased once');
  soldOutState = purchase.state;
}
assert.equal(soldOutState.town.merchantStock.length, 0);
assert.equal(soldOutState.town.merchantSoldOut, true, 'buying the last item persists the sold-out marker');
const firebaseSoldOut = JSON.parse(JSON.stringify(soldOutState));
delete firebaseSoldOut.town.merchantStock;
const restoredSoldOut = town.withAdventureTownState(
  adventure.sanitizeAdventureState(firebaseSoldOut, 'vanguard', NOW + 8),
  firebaseSoldOut.town,
  NOW + 8,
);
assert.equal(restoredSoldOut.town.merchantStock.length, 0, 'an RTDB round trip cannot regenerate sold-out stock early');
assert.equal(restoredSoldOut.town.merchantSoldOut, true);

const stashItem = adventure.generateGear({
  classId: 'vanguard',
  regionId: 'sunnyField',
  level: 5,
  now: NOW + 8,
  rng: () => 0.25,
});
state = { ...sold.state, inventory: [stashItem] };
const deposited = town.depositTownStash(state, stashItem.instanceId, NOW + 9);
assert.equal(deposited.ok, true, 'inventory gear can be deposited');
assert.equal(deposited.state.inventory.length, 0);
assert.equal(deposited.state.town.stash[0].instanceId, stashItem.instanceId);
const withdrawn = town.withdrawTownStash(deposited.state, stashItem.instanceId, NOW + 10);
assert.equal(withdrawn.ok, true, 'stored gear can be withdrawn');
assert.equal(withdrawn.state.town.stash.length, 0);
assert.equal(withdrawn.state.inventory[0].instanceId, stashItem.instanceId);

const maxHp = adventure.deriveStats(withdrawn.state).maxHp;
const emergencySource = { ...withdrawn.state, hp: 1 };
const emergency = town.healAtTown(emergencySource, NOW + 11);
assert.equal(emergency.ok, true, 'the healer provides emergency recovery below half life');
assert.equal(emergency.state.hp, Math.ceil(maxHp * 0.5));
assert.equal(emergency.state.gold, emergencySource.gold, 'emergency recovery is free');
const fullTreatmentSource = { ...withdrawn.state, hp: Math.ceil(maxHp * 0.75), gold: 100_000 };
const treatmentCost = adventure.getRestCost(fullTreatmentSource);
const fullTreatment = town.healAtTown(fullTreatmentSource, NOW + 12);
assert.equal(fullTreatment.ok, true, 'the healer can fully restore a wounded character');
assert.equal(fullTreatment.state.hp, maxHp);
assert.equal(fullTreatment.state.gold, fullTreatmentSource.gold - treatmentCost);

const serialized = JSON.parse(JSON.stringify({ ...fullTreatment.state, combat: staleCombat.combat }));
const restored = town.withAdventureTownState(
  adventure.sanitizeAdventureState(serialized, 'vanguard', NOW + 13),
  serialized.town,
  NOW + 13,
);
assert.equal(restored.combat, null, 'Firebase/local restoration cannot revive removed turn combat');
assert.equal(restored.town.location, 'town');
assert.equal(restored.inventory[0].instanceId, stashItem.instanceId, 'town inventory survives serialization');

console.log('ADVENTURE TOWN: migration, gate, merchant, healer, and stash flows passed');
