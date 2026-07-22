#!/usr/bin/env node

'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');
const ts = require('typescript');

const ROOT = path.join(__dirname, '..');
const AUTH_URL = process.env.FIREBASE_AUTH_EMULATOR_URL || 'http://127.0.0.1:9099';
const DATABASE_URL = process.env.FIREBASE_DATABASE_EMULATOR_URL || 'http://127.0.0.1:9000';
const NAMESPACE = process.env.FIREBASE_DATABASE_NAMESPACE || 'daemok-155c1-default-rtdb';
const API_KEY = 'AIzaSyBxHJ14JjS3DOHHR9xwLGjIKdBJp8cD448';

function loadTypeScript(relativePath, aliases = {}) {
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
  loaded.require = (request) => aliases[request] || require(request);
  loaded._compile(output, filename);
  return loaded.exports;
}

const types = loadTypeScript('src/types/game.ts');
const mazeSkills = loadTypeScript('src/lib/mazeSkills.ts');
const diceWormhole = loadTypeScript('src/lib/diceWormhole.ts', { '@/types/game': types });
const utils = loadTypeScript('src/lib/gameUtils.ts', {
  '@/types/game': types,
  '@/lib/diceWormhole': diceWormhole,
});
const gameRules = loadTypeScript('src/lib/gameRules.ts', {
  '@/types/game': types,
  '@/lib/gameUtils': utils,
  '@/lib/mazeSkills': mazeSkills,
});

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

async function signUp(label) {
  const endpoint = new URL('/identitytoolkit.googleapis.com/v1/accounts:signUp', AUTH_URL);
  endpoint.searchParams.set('key', API_KEY);
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      email: `${label}-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`,
      password: 'daemok-rules-test-password',
      returnSecureToken: true,
    }),
  });
  const payload = await response.json();
  assert.equal(response.ok, true, `auth signup failed: ${JSON.stringify(payload)}`);
  return { uid: payload.localId, token: payload.idToken };
}

async function databaseRequest(databasePath, token, method, body) {
  const encoded = databasePath.split('/').filter(Boolean).map(encodeURIComponent).join('/');
  const endpoint = new URL(`/${encoded}.json`, DATABASE_URL);
  endpoint.searchParams.set('ns', NAMESPACE);
  if (token) endpoint.searchParams.set('auth', token);
  const response = await fetch(endpoint, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let payload = text;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {}
  return { ok: response.ok, status: response.status, payload };
}

async function databaseAdminRequest(databasePath, method, body) {
  const encoded = databasePath.split('/').filter(Boolean).map(encodeURIComponent).join('/');
  const endpoint = new URL(`/${encoded}.json`, DATABASE_URL);
  endpoint.searchParams.set('ns', NAMESPACE);
  const response = await fetch(endpoint, {
    method,
    headers: {
      authorization: 'Bearer owner',
      'content-type': 'application/json',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let payload = text;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {}
  return { ok: response.ok, status: response.status, payload };
}

function createRoomPayload(ownerId, snapshot) {
  return {
    createdBy: ownerId,
    lastActivity: Date.now(),
    maxPlayers: 4,
    players: [ownerId],
    rulesVersion: 4,
    ruleSnapshot: snapshot,
    gameState: {
      rulesVersion: 4,
      matchNumber: 0,
      phase: 'setup',
      currentTurn: ownerId,
      turnOrder: [ownerId],
      players: {
        [ownerId]: {
          id: ownerId,
          position: { row: 0, col: 0 },
          isReady: false,
          isOnline: true,
          lastSeen: Date.now(),
        },
      },
    },
  };
}

function validMap(skillLoadout = 'scoutPulse') {
  return {
    rulesVersion: 4,
    skillLoadout,
    runnerGear: 'none',
    startPosition: { row: 0, col: 0 },
    endPosition: { row: 5, col: 5 },
    obstacles: [],
    items: [],
  };
}

function validWormholeChallenge() {
  return clone(diceWormhole.DICE_WORMHOLE_FALLBACK_CHALLENGE);
}

function validWormholeItem() {
  return {
    type: 'wormhole',
    entrance: { row: 2, col: 0 },
    exit: { row: 4, col: 1 },
    challenge: validWormholeChallenge(),
  };
}

function validWormholeRun(mapOwnerId, enteredAtTurn = 1) {
  const challenge = validWormholeChallenge();
  return {
    mapOwnerId,
    itemIndex: 0,
    position: { ...challenge.startPosition },
    challenge,
    enteredAtTurn,
    orientation: challenge.initialOrientation,
    actionsTaken: 0,
  };
}

function validFireVisionEffect(sourcePlayerId, appliedAtTurn = 1) {
  return {
    type: 'fire',
    sourcePlayerId,
    appliedAtTurn,
    expiresAtTargetMove: 2,
  };
}

function validPoisonEffect(sourcePlayerId, appliedAtTurn = 1) {
  return {
    sourcePlayerId,
    appliedAtTurn,
    expiresAtTargetMove: 2,
    seed: 1_234_567,
  };
}

function validIllusionEffect(sourcePlayerId, appliedAtTurn = 1, actionsRemaining = 3) {
  return {
    sourcePlayerId,
    appliedAtTurn,
    actionsRemaining,
  };
}

async function expectAllowed(label, promise) {
  const result = await promise;
  assert.equal(result.ok, true, `${label} should be allowed (${result.status}): ${JSON.stringify(result.payload)}`);
}

async function expectDenied(label, promise) {
  const result = await promise;
  assert.equal(result.ok, false, `${label} should be denied`);
  assert.ok(result.status === 401 || result.status === 403, `${label} unexpected status ${result.status}`);
}

async function seedAdminFixture(databasePath, method, body) {
  const result = await databaseAdminRequest(databasePath, method, body);
  assert.equal(
    result.ok,
    true,
    `admin fixture setup failed at ${databasePath} (${result.status}): ${JSON.stringify(result.payload)}`
  );
}

async function main() {
  const rulesDocument = JSON.parse(fs.readFileSync(path.join(ROOT, 'database.rules.json'), 'utf8'));
  const mazeAuthorityRules = rulesDocument.rules.mazeAuthority;
  const mazeViewRules = rulesDocument.rules.mazeViews;
  const mazeViewManifestRules = rulesDocument.rules.mazeViewManifests;
  const mazeAuthorityRankingRules = rulesDocument.rules.mazeAuthorityRankings;
  const mazePresenceRules = rulesDocument.rules.mazePresence;
  const userProfileRules = rulesDocument.rules.users.$uid;
  for (const retiredRoot of [
    'adventureAuthority',
    'adventureViews',
    'adventureRankings',
    'adventureAuthorityRankings',
    'adventurePresence',
  ]) {
    assert.equal(retiredRoot in rulesDocument.rules, false, `${retiredRoot} rules remain retired`);
  }
  assert.equal('adventure' in userProfileRules, false);
  assert.equal('adventureGeneration' in userProfileRules, false);
  assert.equal(userProfileRules.$other['.read'], false);
  assert.equal(userProfileRules.$other['.validate'], false);
  assert.equal(mazeAuthorityRules['.read'], false);
  assert.equal(mazeAuthorityRules['.write'], false);
  assert.equal(mazeViewRules['.read'], false);
  assert.equal(mazeViewRules['.write'], false);
  assert.equal(mazeViewRules.v1.publicRooms['.read'], 'auth != null');
  assert.equal(mazeViewRules.v1.publicRooms['.write'], false);
  assert.equal(
    mazeViewRules.v1.memberRooms.$uid['.read'],
    'auth != null && auth.uid === $uid'
  );
  assert.equal(mazeViewRules.v1.memberRooms.$uid['.write'], false);
  assert.equal(mazeViewManifestRules['.read'], false);
  assert.equal(mazeViewManifestRules['.write'], false);
  assert.equal(mazeAuthorityRankingRules['.read'], false);
  assert.equal(mazeAuthorityRankingRules['.write'], false);
  assert.equal(mazeAuthorityRankingRules.v1['.read'], 'auth != null');
  assert.equal(mazeAuthorityRankingRules.v1['.write'], false);
  assert.equal(mazeAuthorityRankingRules.v1['.indexOn'][0], 'rating');
  assert.equal(mazePresenceRules['.read'], false);
  assert.equal(mazePresenceRules['.write'], false);
  assert.equal(
    mazePresenceRules.v1.rooms.$roomId.$uid['.read'],
    'auth != null && auth.uid === $uid'
  );
  assert.equal(mazePresenceRules.v1.leases['.read'], false);
  assert.equal(mazePresenceRules.v1.leases['.write'], false);
  assert.equal(mazePresenceRules.v1.status.$roomId['.read'], 'auth != null');
  assert.equal(mazePresenceRules.v1.status.$roomId['.write'], false);
  assert.match(userProfileRules.displayName['.validate'], /length <= 50/);
  assert.match(userProfileRules.photoURL['.validate'], /length <= 2048/);
  assert.match(
    userProfileRules.photoURL['.validate'],
    /https:\/\/lh3\.googleusercontent\.com/
  );
  const expectedWallCosts = {
    oneTimeWall: 1,
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
  for (const [wallType, expectedCost] of Object.entries(expectedWallCosts)) {
    assert.match(
      rulesDocument.rules.rooms.$roomId.ruleSnapshot.itemCosts[wallType]['.validate'],
      new RegExp(`newData\\.val\\(\\) === ${expectedCost}`, 'u'),
      `database rules pin ${wallType} to cost ${expectedCost}`
    );
  }
  assert.match(
    rulesDocument.rules.rooms.$roomId.ruleSnapshot.itemLimits.fogWall['.validate'],
    /newData\.val\(\) === 1/,
    'database rules limit fog wall to one'
  );
  assert.match(
    rulesDocument.rules.rooms.$roomId.ruleSnapshot.itemLimits.illusionWall['.validate'],
    /newData\.val\(\) === 1/,
    'database rules limit illusion wall to one'
  );
  assert.match(
    rulesDocument.rules.rooms.$roomId.ruleSnapshot.wallBudget['.validate'],
    /newData\.val\(\) === 25/,
    'database rules pin the no-gear wall budget to 25'
  );
  assert.match(
    rulesDocument.rules.rooms.$roomId.ruleSnapshot.runnerGearWallBudget['.validate'],
    /newData\.val\(\) === 15/,
    'database rules pin equipped runners to the base wall budget 15'
  );
  const mapRules = rulesDocument.rules.rooms.$roomId.maps.$ownerId;
  assert.match(mapRules['.validate'], /runnerGear/);
  assert.match(mapRules['.validate'], /wormholeEscapeKit/);
  assert.match(mapRules['.validate'], /insight/);
  for (const retiredItemType of [
    'radar',
    'mine',
    'smoke',
    'steelWall',
    'collapseWall',
    'phaseWall',
    'mirrorWall',
    'crystalWall',
  ]) {
    assert.match(
      mapRules.item.type['.validate'],
      new RegExp(`newData\\.val\\(\\) !== '${retiredItemType}'`, 'u'),
      `legacy single-item writes reject ${retiredItemType}`
    );
    assert.match(
      mapRules.items.$itemIndex.type['.validate'],
      new RegExp(`newData\\.val\\(\\) !== '${retiredItemType}'`, 'u'),
      `item-list writes reject ${retiredItemType}`
    );
  }

  const [owner, outsider, drawTarget] = await Promise.all([
    signUp('rules-owner'),
    signUp('rules-outsider'),
    signUp('rules-draw-target'),
  ]);
  await expectAllowed(
    'owner can persist bounded profile leaves used by ranking projection',
    databaseRequest(`users/${owner.uid}`, owner.token, 'PATCH', {
      displayName: 'Rules Ranger',
      photoURL: 'https://lh3.googleusercontent.com/rules-ranger.png',
    })
  );
  await expectDenied(
    'profile display name over 50 characters is rejected',
    databaseRequest(`users/${owner.uid}/displayName`, owner.token, 'PUT', 'x'.repeat(51))
  );
  await expectDenied(
    'profile image outside the configured Google image host is rejected',
    databaseRequest(
      `users/${owner.uid}/photoURL`,
      owner.token,
      'PUT',
      'https://example.com/forged.png'
    )
  );
  const canonical = gameRules.createCanonicalGameRuleSnapshot();
  for (const [wallType, expectedCost] of Object.entries(expectedWallCosts)) {
    assert.equal(
      canonical.itemCosts[wallType],
      expectedCost,
      `canonical ${wallType} cost is ${expectedCost}`
    );
  }
  assert.equal(canonical.itemLimits.fogWall, 1, 'canonical fog wall limit is one');
  assert.equal(canonical.itemLimits.illusionWall, 1, 'canonical illusion wall limit is one');
  assert.equal(
    diceWormhole.isValidDiceWormholeChallenge(validWormholeChallenge()),
    true,
    'database fixture uses a solvable V2 dice challenge'
  );
  assert.deepEqual(
    Object.keys(validFireVisionEffect(owner.uid)).sort(),
    ['appliedAtTurn', 'expiresAtTargetMove', 'sourcePlayerId', 'type'],
    'new fire state persists only the common vision-effect fields'
  );
  const roomId = `rules-${Date.now()}`;

  await expectAllowed(
    'canonical room creation',
    databaseRequest(`rooms/${roomId}`, owner.token, 'PUT', createRoomPayload(owner.uid, canonical))
  );
  await expectAllowed(
    'canonical owner map and readiness update',
    databaseRequest(`rooms/${roomId}`, owner.token, 'PATCH', {
      [`maps/${owner.uid}`]: validMap(),
      [`gameState/players/${owner.uid}/isReady`]: true,
    })
  );

  const missingSkill = validMap();
  delete missingSkill.skillLoadout;
  await expectDenied(
    'map without skill loadout',
    databaseRequest(`rooms/${roomId}/maps/${owner.uid}`, owner.token, 'PUT', missingSkill)
  );
  const missingRunnerGear = validMap();
  delete missingRunnerGear.runnerGear;
  await expectDenied(
    'new map must make the runner gear choice explicit',
    databaseRequest(`rooms/${roomId}/maps/${owner.uid}`, owner.token, 'PUT', missingRunnerGear)
  );
  await expectDenied(
    'unknown runner gear is rejected',
    databaseRequest(`rooms/${roomId}/maps/${owner.uid}`, owner.token, 'PUT', {
      ...validMap(),
      runnerGear: 'forgedGear',
    })
  );
  for (const retiredSkillLoadout of ['breach', 'anchor', 'dash']) {
    await expectDenied(
      `new map with retired ${retiredSkillLoadout} loadout`,
      databaseRequest(
        `rooms/${roomId}/maps/${owner.uid}`,
        owner.token,
        'PUT',
        validMap(retiredSkillLoadout)
      )
    );
  }
  await expectDenied(
    'non-member map injection',
    databaseRequest(`rooms/${roomId}/maps/${outsider.uid}`, outsider.token, 'PUT', validMap())
  );
  await expectAllowed(
    'owner may reset own setup map and readiness',
    databaseRequest(`rooms/${roomId}`, owner.token, 'PATCH', {
      [`maps/${owner.uid}`]: null,
      [`gameState/players/${owner.uid}/isReady`]: false,
    })
  );
  const mapWithWormholeChallenge = {
    ...validMap(),
    items: [validWormholeItem()],
  };
  await expectAllowed(
    'new wormhole map includes a bounded V2 dice challenge',
    databaseRequest(
      `rooms/${roomId}/maps/${owner.uid}`,
      owner.token,
      'PUT',
      mapWithWormholeChallenge
    )
  );
  const missingWormholeChallenge = clone(mapWithWormholeChallenge);
  delete missingWormholeChallenge.items[0].challenge;
  await expectDenied(
    'new wormhole item cannot omit its configured challenge',
    databaseRequest(
      `rooms/${roomId}/maps/${owner.uid}`,
      owner.token,
      'PUT',
      missingWormholeChallenge
    )
  );
  const retiredWormholeChallenge = clone(mapWithWormholeChallenge);
  retiredWormholeChallenge.items[0].challenge = {
    version: 1,
    startPosition: { row: 0, col: 0 },
    endPosition: { row: 2, col: 2 },
    seals: [
      { row: 0, col: 5 },
      { row: 5, col: 5 },
      { row: 5, col: 0 },
    ],
    obstacles: [
      { position: { row: 0, col: 1 }, direction: 'down' },
      { position: { row: 0, col: 2 }, direction: 'down' },
      { position: { row: 1, col: 3 }, direction: 'right' },
      { position: { row: 2, col: 3 }, direction: 'right' },
    ],
  };
  await expectDenied(
    'new setup rejects the retired hand-authored V1 wormhole challenge',
    databaseRequest(
      `rooms/${roomId}/maps/${owner.uid}`,
      owner.token,
      'PUT',
      retiredWormholeChallenge
    )
  );
  const extraWormholeChallengeField = clone(mapWithWormholeChallenge);
  extraWormholeChallengeField.items[0].challenge.forged = true;
  await expectDenied(
    'wormhole challenge rejects unknown top-level fields',
    databaseRequest(
      `rooms/${roomId}/maps/${owner.uid}`,
      owner.token,
      'PUT',
      extraWormholeChallengeField
    )
  );
  const missingBlockedCells = clone(mapWithWormholeChallenge);
  missingBlockedCells.items[0].challenge.blockedCells = [];
  await expectDenied(
    'V2 wormhole challenge requires at least one blocked cell',
    databaseRequest(
      `rooms/${roomId}/maps/${owner.uid}`,
      owner.token,
      'PUT',
      missingBlockedCells
    )
  );
  const sparseBlockedCells = clone(mapWithWormholeChallenge);
  const [firstBlockedCell, secondBlockedCell] = sparseBlockedCells.items[0].challenge.blockedCells;
  sparseBlockedCells.items[0].challenge.blockedCells = {
    0: firstBlockedCell,
    2: secondBlockedCell,
  };
  await expectDenied(
    'V2 wormhole challenge rejects a sparse blocked-cell ledger',
    databaseRequest(
      `rooms/${roomId}/maps/${owner.uid}`,
      owner.token,
      'PUT',
      sparseBlockedCells
    )
  );
  const tooManyBlockedCells = clone(mapWithWormholeChallenge);
  tooManyBlockedCells.items[0].challenge.blockedCells = [
    { row: 0, col: 1 },
    { row: 1, col: 0 },
    { row: 2, col: 3 },
    { row: 3, col: 2 },
  ];
  await expectDenied(
    'V2 wormhole challenge rejects more than three blocked cells',
    databaseRequest(
      `rooms/${roomId}/maps/${owner.uid}`,
      owner.token,
      'PUT',
      tooManyBlockedCells
    )
  );
  const duplicateBlockedCells = clone(mapWithWormholeChallenge);
  duplicateBlockedCells.items[0].challenge.blockedCells[1] = {
    ...duplicateBlockedCells.items[0].challenge.blockedCells[0],
  };
  await expectDenied(
    'V2 wormhole challenge rejects duplicate blocked cells',
    databaseRequest(
      `rooms/${roomId}/maps/${owner.uid}`,
      owner.token,
      'PUT',
      duplicateBlockedCells
    )
  );
  const blockedStart = clone(mapWithWormholeChallenge);
  blockedStart.items[0].challenge.blockedCells[0] = {
    ...blockedStart.items[0].challenge.startPosition,
  };
  await expectDenied(
    'V2 wormhole challenge cannot block its start cell',
    databaseRequest(
      `rooms/${roomId}/maps/${owner.uid}`,
      owner.token,
      'PUT',
      blockedStart
    )
  );
  const invalidDiceOrientation = clone(mapWithWormholeChallenge);
  invalidDiceOrientation.items[0].challenge.initialOrientation = 24;
  await expectDenied(
    'V2 wormhole challenge rejects an out-of-contract dice orientation',
    databaseRequest(
      `rooms/${roomId}/maps/${owner.uid}`,
      owner.token,
      'PUT',
      invalidDiceOrientation
    )
  );
  const invalidDiceTarget = clone(mapWithWormholeChallenge);
  invalidDiceTarget.items[0].challenge.targetTop = 7;
  await expectDenied(
    'V2 wormhole challenge rejects an impossible target face',
    databaseRequest(
      `rooms/${roomId}/maps/${owner.uid}`,
      owner.token,
      'PUT',
      invalidDiceTarget
    )
  );
  await expectAllowed(
    'new fog and illusion walls remain available in setup maps',
    databaseRequest(`rooms/${roomId}/maps/${owner.uid}`, owner.token, 'PUT', {
      ...validMap(),
      items: [{
        type: 'fogWall',
        wallPosition: { row: 2, col: 2 },
        wallDirection: 'right',
      }, {
        type: 'illusionWall',
        wallPosition: { row: 3, col: 3 },
        wallDirection: 'right',
      }],
    })
  );
  for (const retiredTrap of ['mine', 'smoke']) {
    await expectDenied(
      `retired ${retiredTrap} cannot be submitted in an item list`,
      databaseRequest(`rooms/${roomId}/maps/${owner.uid}`, owner.token, 'PUT', {
        ...validMap(),
        items: [{ type: retiredTrap, position: { row: 2, col: 2 } }],
      })
    );
    await expectDenied(
      `retired ${retiredTrap} cannot be submitted through the legacy single-item shape`,
      databaseRequest(`rooms/${roomId}/maps/${owner.uid}`, owner.token, 'PUT', {
        ...validMap(),
        items: undefined,
        item: { type: retiredTrap, position: { row: 2, col: 2 } },
      })
    );
  }
  for (const retiredWall of [
    'steelWall',
    'collapseWall',
    'phaseWall',
    'mirrorWall',
    'crystalWall',
  ]) {
    await expectDenied(
      `retired ${retiredWall} cannot be submitted to a legacy setup room`,
      databaseRequest(`rooms/${roomId}/maps/${owner.uid}`, owner.token, 'PUT', {
        ...validMap(),
        items: [{
          type: retiredWall,
          wallPosition: { row: 2, col: 2 },
          wallDirection: 'right',
        }],
      })
    );
  }
  await expectDenied(
    'retired radar cannot be submitted in an item list',
    databaseRequest(`rooms/${roomId}/maps/${owner.uid}`, owner.token, 'PUT', {
      ...validMap(),
      items: [{ type: 'radar' }],
    })
  );
  await expectDenied(
    'retired radar cannot be submitted through the legacy single-item shape',
    databaseRequest(`rooms/${roomId}/maps/${owner.uid}`, owner.token, 'PUT', {
      ...validMap(),
      items: undefined,
      item: { type: 'radar' },
    })
  );

  const legacyReadRoomId = `legacy-read-${Date.now()}`;
  const legacyReadRoom = createRoomPayload(owner.uid, canonical);
  legacyReadRoom.maps = {
    [owner.uid]: {
      ...validMap('anchor'),
      items: [
        { type: 'radar' },
        { type: 'mine', position: { row: 2, col: 2 } },
        { type: 'smoke', position: { row: 3, col: 3 } },
      ],
    },
  };
  await seedAdminFixture(`rooms/${legacyReadRoomId}`, 'PUT', legacyReadRoom);
  const legacyMapRead = await databaseRequest(
    `rooms/${legacyReadRoomId}/maps/${owner.uid}`,
    owner.token,
    'GET'
  );
  assert.equal(legacyMapRead.ok, true, 'existing legacy maps remain readable');
  assert.equal(legacyMapRead.payload.skillLoadout, 'anchor');
  assert.equal(legacyMapRead.payload.items[0].type, 'radar');
  assert.equal(legacyMapRead.payload.items[1].type, 'mine');
  assert.equal(legacyMapRead.payload.items[2].type, 'smoke');
  await expectAllowed(
    'owner may atomically save setup map again',
    databaseRequest(`rooms/${roomId}`, owner.token, 'PATCH', {
      [`maps/${owner.uid}`]: validMap(),
      [`gameState/players/${owner.uid}/isReady`]: true,
    })
  );
  await expectDenied(
    'room snapshot mutation',
    databaseRequest(
      `rooms/${roomId}/ruleSnapshot/itemCosts/mine`,
      owner.token,
      'PUT',
      9
    )
  );
  await expectDenied(
    'room rules version mutation',
    databaseRequest(`rooms/${roomId}/rulesVersion`, owner.token, 'PUT', 5)
  );
  await expectDenied(
    'match number cannot skip a room-local sequence',
    databaseRequest(`rooms/${roomId}/gameState/matchNumber`, owner.token, 'PUT', 2)
  );

  await expectAllowed(
    'second player atomically claims a setup roster slot',
    databaseRequest(`rooms/${roomId}/players/1`, outsider.token, 'PUT', outsider.uid)
  );
  await expectDenied(
    'the same participant cannot occupy multiple roster slots',
    databaseRequest(`rooms/${roomId}/players/2`, outsider.token, 'PUT', outsider.uid)
  );
  await expectAllowed(
    'second player joins setup after claiming a slot',
    databaseRequest(`rooms/${roomId}/gameState/players/${outsider.uid}`, outsider.token, 'PUT', {
      id: outsider.uid,
      position: { row: 0, col: 0 },
      isReady: false,
    })
  );
  await expectDenied(
    'authenticated outsiders cannot replace the secured room roster',
    databaseRequest(`rooms/${roomId}/players`, outsider.token, 'PUT', [outsider.uid])
  );
  await expectAllowed(
    'second player map and readiness update',
    databaseRequest(`rooms/${roomId}`, outsider.token, 'PATCH', {
      [`maps/${outsider.uid}`]: validMap(),
      [`gameState/players/${outsider.uid}/isReady`]: true,
    })
  );
  // Human map building commonly takes longer than the one-minute timestamp
  // freshness window. Starting a match preserves presence timestamps; it must
  // not be rejected merely because an unchanged value has aged in setup.
  const staleSetupLastSeen = Date.now() - 120_000;
  assert.ok(staleSetupLastSeen < Date.now() - 60_000);
  await seedAdminFixture(
    `rooms/${roomId}/gameState/players/${owner.uid}/lastSeen`,
    'PUT',
    staleSetupLastSeen
  );
  await seedAdminFixture(
    `rooms/${roomId}/gameState/players/${outsider.uid}/lastSeen`,
    'PUT',
    staleSetupLastSeen
  );
  const setupRead = await databaseRequest(`rooms/${roomId}/gameState`, owner.token, 'GET');
  assert.equal(setupRead.ok, true, 'setup state should be readable');
  assert.equal(setupRead.payload.maps, undefined, 'persistent game state must not contain maps');
  assert.equal(setupRead.payload.players[owner.uid].lastSeen, staleSetupLastSeen);
  assert.equal(setupRead.payload.players[outsider.uid].lastSeen, staleSetupLastSeen);
  const mapBeforePlay = await databaseRequest(`rooms/${roomId}/maps/${owner.uid}`, owner.token, 'GET');
  assert.equal(mapBeforePlay.ok, true, 'setup map should be readable');
  await expectDenied(
    'ready owner cannot rewrite a frozen setup map',
    databaseRequest(`rooms/${roomId}/maps/${owner.uid}`, owner.token, 'PUT', validMap())
  );
  const playState = {
    ...setupRead.payload,
    matchNumber: 1,
    phase: 'play',
    turnNumber: 1,
    currentTurn: owner.uid,
    turnOrder: [owner.uid, outsider.uid],
    assignments: {
      [owner.uid]: outsider.uid,
      [outsider.uid]: owner.uid,
    },
    itemState: {
      // A setup -> play transition may still carry a legacy skill envelope.
      // One player intentionally has no item-state entry so current matches
      // also prove that retired skill initialization is no longer required.
      [outsider.uid]: {
        mazeSkill: {
          version: 1,
          loadout: ['scoutPulse'],
          consumed: {},
        },
      },
    },
    players: {
      ...setupRead.payload.players,
      [owner.uid]: {
        ...setupRead.payload.players[owner.uid],
        isReady: true,
        isOnline: true,
        finished: false,
        forfeited: false,
        moves: 0,
        position: { row: 5, col: 4 },
      },
      [outsider.uid]: {
        ...setupRead.payload.players[outsider.uid],
        isReady: true,
        isOnline: true,
        finished: false,
        forfeited: false,
        moves: 0,
      },
    },
  };
  await expectAllowed(
    'owner starts canonical play state while preserving stale presence timestamps',
    databaseRequest(`rooms/${roomId}/gameState`, owner.token, 'PUT', playState)
  );
  await expectDenied(
    'participants still cannot backdate a changed presence timestamp',
    databaseRequest(
      `rooms/${roomId}/gameState/players/${outsider.uid}/lastSeen`,
      outsider.token,
      'PUT',
      staleSetupLastSeen - 1_000
    )
  );
  await expectDenied(
    'current player cannot mutate opponent state',
    databaseRequest(`rooms/${roomId}/gameState/players/${outsider.uid}/moves`, owner.token, 'PUT', 999)
  );
  await expectDenied(
    'current player cannot delete opponent',
    databaseRequest(`rooms/${roomId}/gameState/players/${outsider.uid}`, owner.token, 'DELETE')
  );
  await expectDenied(
    'current player cannot replace a live map',
    databaseRequest(`rooms/${roomId}/maps/${owner.uid}`, owner.token, 'PUT', validMap())
  );
  await expectDenied(
    'current player cannot delete a live map',
    databaseRequest(`rooms/${roomId}/maps/${owner.uid}`, owner.token, 'DELETE')
  );
  await expectDenied(
    'current player cannot inject a live map item',
    databaseRequest(`rooms/${roomId}/maps/${owner.uid}/items`, owner.token, 'PUT', [{ type: 'radar' }])
  );
  await expectDenied(
    'current player cannot inject maps into live game state',
    databaseRequest(`rooms/${roomId}/gameState/maps/${owner.uid}`, owner.token, 'PUT', validMap())
  );
  await expectDenied(
    'current player cannot rewrite assignments',
    databaseRequest(`rooms/${roomId}/gameState/assignments/${owner.uid}`, owner.token, 'PUT', owner.uid)
  );
  await expectDenied(
    'current player cannot rewrite turn order',
    databaseRequest(`rooms/${roomId}/gameState/turnOrder`, owner.token, 'PUT', [outsider.uid, owner.uid])
  );
  await expectDenied(
    'current player cannot increment moves outside an atomic turn',
    databaseRequest(`rooms/${roomId}/gameState/players/${owner.uid}/moves`, owner.token, 'PUT', 1)
  );

  const liveRead = await databaseRequest(`rooms/${roomId}/gameState`, owner.token, 'GET');
  assert.equal(liveRead.ok, true, 'live state should be readable');
  assert.equal(
    liveRead.payload.itemState?.[owner.uid],
    undefined,
    'play state may omit an unused per-player item-state entry'
  );
  assert.deepEqual(
    liveRead.payload.itemState[outsider.uid].mazeSkill.loadout,
    ['scoutPulse'],
    'setup to play may retain a legacy skill envelope for read compatibility'
  );

  await seedAdminFixture(`rooms/${roomId}/gameState`, 'PATCH', {
    wormholeRunsByPlayer: {
      [outsider.uid]: validWormholeRun(owner.uid),
    },
    visionEffectsByPlayer: {
      [outsider.uid]: {
        type: 'smoke',
        sourcePlayerId: owner.uid,
        appliedAtTurn: 1,
        expiresAtTargetMove: 2,
      },
    },
    poisonEffectsByPlayer: {
      [outsider.uid]: validPoisonEffect(owner.uid),
    },
    illusionEffectsByPlayer: {
      [outsider.uid]: validIllusionEffect(owner.uid),
    },
  });
  await expectDenied(
    'unauthenticated callers cannot read live wormhole run state',
    databaseRequest(`rooms/${roomId}/gameState/wormholeRunsByPlayer`, null, 'GET')
  );
  await expectDenied(
    'authenticated non-members cannot write live wormhole run state',
    databaseRequest(
      `rooms/${roomId}/gameState/wormholeRunsByPlayer/${owner.uid}`,
      drawTarget.token,
      'PUT',
      validWormholeRun(outsider.uid)
    )
  );

  const privateStateRead = await databaseRequest(`rooms/${roomId}/gameState`, owner.token, 'GET');
  assert.equal(privateStateRead.ok, true, 'seeded live private state should be readable');
  await expectDenied(
    'current player cannot create a wormhole run outside the atomic turn reducer',
    databaseRequest(
      `rooms/${roomId}/gameState/wormholeRunsByPlayer/${owner.uid}`,
      owner.token,
      'PUT',
      validWormholeRun(outsider.uid)
    )
  );

  const forgedForeignRun = clone(privateStateRead.payload);
  forgedForeignRun.players[owner.uid].moves = 1;
  forgedForeignRun.currentTurn = outsider.uid;
  forgedForeignRun.turnNumber = 2;
  delete forgedForeignRun.wormholeRunsByPlayer[outsider.uid];
  await expectDenied(
    'current player cannot delete another player wormhole run in an otherwise atomic turn',
    databaseRequest(`rooms/${roomId}/gameState`, owner.token, 'PUT', forgedForeignRun)
  );

  const invalidRunShape = clone(privateStateRead.payload);
  invalidRunShape.players[owner.uid].moves = 1;
  invalidRunShape.currentTurn = outsider.uid;
  invalidRunShape.turnNumber = 2;
  invalidRunShape.wormholeRunsByPlayer[owner.uid] = validWormholeRun(outsider.uid);
  invalidRunShape.wormholeRunsByPlayer[owner.uid].orientation = 24;
  await expectDenied(
    'atomic turn rejects a V2 run with an invalid dice orientation',
    databaseRequest(`rooms/${roomId}/gameState`, owner.token, 'PUT', invalidRunShape)
  );

  const missingRunActions = clone(privateStateRead.payload);
  missingRunActions.players[owner.uid].moves = 1;
  missingRunActions.currentTurn = outsider.uid;
  missingRunActions.turnNumber = 2;
  missingRunActions.wormholeRunsByPlayer[owner.uid] = validWormholeRun(outsider.uid);
  delete missingRunActions.wormholeRunsByPlayer[owner.uid].actionsTaken;
  await expectDenied(
    'atomic turn rejects a V2 run without its action counter',
    databaseRequest(`rooms/${roomId}/gameState`, owner.token, 'PUT', missingRunActions)
  );

  const forgedLegacyLedger = clone(privateStateRead.payload);
  forgedLegacyLedger.players[owner.uid].moves = 1;
  forgedLegacyLedger.currentTurn = outsider.uid;
  forgedLegacyLedger.turnNumber = 2;
  forgedLegacyLedger.wormholeRunsByPlayer[owner.uid] = validWormholeRun(outsider.uid);
  forgedLegacyLedger.wormholeRunsByPlayer[owner.uid].activatedSeals = { 0: true };
  await expectDenied(
    'atomic turn rejects V1 seal state smuggled into a V2 run',
    databaseRequest(`rooms/${roomId}/gameState`, owner.token, 'PUT', forgedLegacyLedger)
  );

  const excessiveRunActions = clone(privateStateRead.payload);
  excessiveRunActions.players[owner.uid].moves = 1;
  excessiveRunActions.currentTurn = outsider.uid;
  excessiveRunActions.turnNumber = 2;
  excessiveRunActions.wormholeRunsByPlayer[owner.uid] = validWormholeRun(outsider.uid);
  excessiveRunActions.wormholeRunsByPlayer[owner.uid].actionsTaken = 2;
  await expectDenied(
    'atomic turn rejects a V2 action counter ahead of the player move ledger',
    databaseRequest(`rooms/${roomId}/gameState`, owner.token, 'PUT', excessiveRunActions)
  );

  const invalidFireVisionShape = clone(privateStateRead.payload);
  invalidFireVisionShape.players[owner.uid].moves = 1;
  invalidFireVisionShape.currentTurn = outsider.uid;
  invalidFireVisionShape.turnNumber = 2;
  invalidFireVisionShape.visionEffectsByPlayer[owner.uid] = validFireVisionEffect(outsider.uid);
  invalidFireVisionShape.visionEffectsByPlayer[owner.uid].phantomWalls = Array.from(
    { length: 7 },
    () => ({ position: { row: 1, col: 1 }, direction: 'right' })
  );
  await expectDenied(
    'fire vision effect rejects more than six phantom walls',
    databaseRequest(`rooms/${roomId}/gameState`, owner.token, 'PUT', invalidFireVisionShape)
  );

  const invalidPoisonShape = clone(privateStateRead.payload);
  invalidPoisonShape.players[owner.uid].moves = 1;
  invalidPoisonShape.currentTurn = outsider.uid;
  invalidPoisonShape.turnNumber = 2;
  invalidPoisonShape.poisonEffectsByPlayer[owner.uid] = validPoisonEffect(outsider.uid);
  invalidPoisonShape.poisonEffectsByPlayer[owner.uid].seed = 0x1_0000_0000;
  await expectDenied(
    'poison effect requires a bounded unsigned 32-bit seed',
    databaseRequest(`rooms/${roomId}/gameState`, owner.token, 'PUT', invalidPoisonShape)
  );

  const forgedForeignIllusion = clone(privateStateRead.payload);
  forgedForeignIllusion.players[owner.uid].moves = 1;
  forgedForeignIllusion.currentTurn = outsider.uid;
  forgedForeignIllusion.turnNumber = 2;
  delete forgedForeignIllusion.illusionEffectsByPlayer[outsider.uid];
  await expectDenied(
    'current player cannot remove another runner illusion state',
    databaseRequest(`rooms/${roomId}/gameState`, owner.token, 'PUT', forgedForeignIllusion)
  );

  for (const [label, malformedEffect] of [
    ['zero actions', validIllusionEffect(outsider.uid, 1, 0)],
    ['too many actions', validIllusionEffect(outsider.uid, 1, 4)],
    ['wrong map owner', validIllusionEffect(owner.uid, 1, 3)],
    ['future application turn', validIllusionEffect(outsider.uid, 99, 3)],
    ['out-of-board anchor', {
      ...validIllusionEffect(outsider.uid, 1, 2),
      firstWallOrigin: { row: 6, col: 0 },
    }],
    ['unknown private field', {
      ...validIllusionEffect(outsider.uid, 1, 2),
      privateSeed: 123,
    }],
  ]) {
    const malformedIllusion = clone(privateStateRead.payload);
    malformedIllusion.players[owner.uid].moves = 1;
    malformedIllusion.currentTurn = outsider.uid;
    malformedIllusion.turnNumber = 2;
    malformedIllusion.illusionEffectsByPlayer[owner.uid] = malformedEffect;
    await expectDenied(
      `illusion effect rejects ${label}`,
      databaseRequest(`rooms/${roomId}/gameState`, owner.token, 'PUT', malformedIllusion)
    );
  }

  const ownPrivateStateTurn = clone(privateStateRead.payload);
  ownPrivateStateTurn.players[owner.uid].moves = 1;
  ownPrivateStateTurn.currentTurn = outsider.uid;
  ownPrivateStateTurn.turnNumber = 2;
  ownPrivateStateTurn.wormholeRunsByPlayer[owner.uid] = validWormholeRun(outsider.uid);
  ownPrivateStateTurn.visionEffectsByPlayer[owner.uid] = validFireVisionEffect(outsider.uid);
  ownPrivateStateTurn.poisonEffectsByPlayer[owner.uid] = validPoisonEffect(outsider.uid);
  ownPrivateStateTurn.illusionEffectsByPlayer[owner.uid] = validIllusionEffect(outsider.uid);
  await expectAllowed(
    'current player atomically creates only their own wormhole and status effects',
    databaseRequest(`rooms/${roomId}/gameState`, owner.token, 'PUT', ownPrivateStateTurn)
  );

  const afterOwnPrivateTurn = await databaseRequest(`rooms/${roomId}/gameState`, outsider.token, 'GET');
  assert.equal(afterOwnPrivateTurn.ok, true, 'private-state turn should persist');
  assert.equal(
    afterOwnPrivateTurn.payload.wormholeRunsByPlayer[owner.uid].challenge.version,
    2,
    'the validated private run persists the V2 challenge discriminator'
  );
  assert.equal(
    afterOwnPrivateTurn.payload.wormholeRunsByPlayer[owner.uid].actionsTaken,
    0,
    'the validated private run persists its internal action counter'
  );
  assert.equal(
    afterOwnPrivateTurn.payload.visionEffectsByPlayer[owner.uid].phantomWalls,
    undefined,
    'new fire state does not persist the retired phantom-wall payload'
  );
  assert.deepEqual(
    afterOwnPrivateTurn.payload.illusionEffectsByPlayer[owner.uid],
    validIllusionEffect(outsider.uid),
    'the affected runner owns the persisted illusion progress'
  );

  const skippedIllusionCountdown = clone(afterOwnPrivateTurn.payload);
  skippedIllusionCountdown.players[outsider.uid].moves = 1;
  skippedIllusionCountdown.currentTurn = owner.uid;
  skippedIllusionCountdown.turnNumber = 3;
  await expectDenied(
    'an active runner cannot keep three illusion actions across a committed turn',
    databaseRequest(`rooms/${roomId}/gameState`, outsider.token, 'PUT', skippedIllusionCountdown)
  );

  const arbitraryFirstAnchor = clone(afterOwnPrivateTurn.payload);
  arbitraryFirstAnchor.players[outsider.uid].moves = 1;
  arbitraryFirstAnchor.currentTurn = owner.uid;
  arbitraryFirstAnchor.turnNumber = 3;
  arbitraryFirstAnchor.illusionEffectsByPlayer[outsider.uid] = {
    ...arbitraryFirstAnchor.illusionEffectsByPlayer[outsider.uid],
    actionsRemaining: 2,
    firstWallOrigin: { row: 5, col: 5 },
  };
  await expectDenied(
    'the first illusion wall anchor must equal the committed action origin',
    databaseRequest(`rooms/${roomId}/gameState`, outsider.token, 'PUT', arbitraryFirstAnchor)
  );

  const anchorOutsideTurn = clone(afterOwnPrivateTurn.payload);
  anchorOutsideTurn.illusionEffectsByPlayer[outsider.uid] = {
    ...anchorOutsideTurn.illusionEffectsByPlayer[outsider.uid],
    actionsRemaining: 2,
    firstWallOrigin: { ...anchorOutsideTurn.players[outsider.uid].position },
  };
  await expectDenied(
    'a runner cannot add an illusion wall anchor outside an atomic turn',
    databaseRequest(`rooms/${roomId}/gameState`, outsider.token, 'PUT', anchorOutsideTurn)
  );

  const forgedOtherIllusionProgress = clone(afterOwnPrivateTurn.payload);
  forgedOtherIllusionProgress.players[outsider.uid].moves = 1;
  forgedOtherIllusionProgress.currentTurn = owner.uid;
  forgedOtherIllusionProgress.turnNumber = 3;
  forgedOtherIllusionProgress.illusionEffectsByPlayer[outsider.uid].actionsRemaining = 2;
  forgedOtherIllusionProgress.illusionEffectsByPlayer[owner.uid].actionsRemaining = 2;
  await expectDenied(
    'a valid own countdown cannot hide another runner illusion ledger change',
    databaseRequest(`rooms/${roomId}/gameState`, outsider.token, 'PUT', forgedOtherIllusionProgress)
  );

  const forgedOwnerRunExpiry = clone(afterOwnPrivateTurn.payload);
  forgedOwnerRunExpiry.players[outsider.uid].moves = 1;
  forgedOwnerRunExpiry.currentTurn = owner.uid;
  forgedOwnerRunExpiry.turnNumber = 3;
  delete forgedOwnerRunExpiry.wormholeRunsByPlayer[owner.uid];
  await expectDenied(
    'next player cannot expire the previous player wormhole run',
    databaseRequest(`rooms/${roomId}/gameState`, outsider.token, 'PUT', forgedOwnerRunExpiry)
  );
  const forgedOwnerVisionExpiry = clone(afterOwnPrivateTurn.payload);
  forgedOwnerVisionExpiry.players[outsider.uid].moves = 1;
  forgedOwnerVisionExpiry.currentTurn = owner.uid;
  forgedOwnerVisionExpiry.turnNumber = 3;
  delete forgedOwnerVisionExpiry.visionEffectsByPlayer[owner.uid];
  await expectDenied(
    'next player cannot expire the previous player vision effect',
    databaseRequest(`rooms/${roomId}/gameState`, outsider.token, 'PUT', forgedOwnerVisionExpiry)
  );
  const forgedOwnerPoisonExpiry = clone(afterOwnPrivateTurn.payload);
  forgedOwnerPoisonExpiry.players[outsider.uid].moves = 1;
  forgedOwnerPoisonExpiry.currentTurn = owner.uid;
  forgedOwnerPoisonExpiry.turnNumber = 3;
  delete forgedOwnerPoisonExpiry.poisonEffectsByPlayer[owner.uid];
  await expectDenied(
    'next player cannot expire the previous player poison effect',
    databaseRequest(`rooms/${roomId}/gameState`, outsider.token, 'PUT', forgedOwnerPoisonExpiry)
  );
  const forgedOwnerIllusionExpiry = clone(afterOwnPrivateTurn.payload);
  forgedOwnerIllusionExpiry.players[outsider.uid].moves = 1;
  forgedOwnerIllusionExpiry.currentTurn = owner.uid;
  forgedOwnerIllusionExpiry.turnNumber = 3;
  delete forgedOwnerIllusionExpiry.illusionEffectsByPlayer[owner.uid];
  await expectDenied(
    'next player cannot expire the previous player illusion effect',
    databaseRequest(`rooms/${roomId}/gameState`, outsider.token, 'PUT', forgedOwnerIllusionExpiry)
  );

  const ownPrivateStateExpiry = clone(afterOwnPrivateTurn.payload);
  ownPrivateStateExpiry.players[outsider.uid].moves = 1;
  ownPrivateStateExpiry.currentTurn = owner.uid;
  ownPrivateStateExpiry.turnNumber = 3;
  ownPrivateStateExpiry.wormholeRunsByPlayer[outsider.uid].position = { row: 0, col: 1 };
  ownPrivateStateExpiry.wormholeRunsByPlayer[outsider.uid].orientation =
    diceWormhole.rollDiceOrientation(
      ownPrivateStateExpiry.wormholeRunsByPlayer[outsider.uid].orientation,
      'right'
    );
  ownPrivateStateExpiry.wormholeRunsByPlayer[outsider.uid].actionsTaken = 1;
  ownPrivateStateExpiry.visionEffectsByPlayer[outsider.uid] = validFireVisionEffect(owner.uid, 2);
  ownPrivateStateExpiry.poisonEffectsByPlayer[outsider.uid].expiresAtTargetMove = 3;
  ownPrivateStateExpiry.poisonEffectsByPlayer[outsider.uid].seed += 1;
  ownPrivateStateExpiry.illusionEffectsByPlayer[outsider.uid] = {
    ...ownPrivateStateExpiry.illusionEffectsByPlayer[outsider.uid],
    actionsRemaining: 2,
    firstWallOrigin: { row: 0, col: 0 },
  };
  await expectAllowed(
    'current player atomically updates only their own private run and effects',
    databaseRequest(`rooms/${roomId}/gameState`, outsider.token, 'PUT', ownPrivateStateExpiry)
  );
  const afterOwnPrivateUpdate = await databaseRequest(`rooms/${roomId}/gameState`, owner.token, 'GET');
  assert.equal(afterOwnPrivateUpdate.ok, true, 'private-state update should persist');

  const prematureOwnIllusionRemoval = clone(afterOwnPrivateUpdate.payload);
  prematureOwnIllusionRemoval.players[owner.uid].moves = 2;
  prematureOwnIllusionRemoval.currentTurn = outsider.uid;
  prematureOwnIllusionRemoval.turnNumber = 4;
  delete prematureOwnIllusionRemoval.illusionEffectsByPlayer[owner.uid];
  await expectDenied(
    'a runner cannot delete an illusion effect before its countdown expires',
    databaseRequest(`rooms/${roomId}/gameState`, owner.token, 'PUT', prematureOwnIllusionRemoval)
  );

  const ownPrivateStateRemoval = clone(afterOwnPrivateUpdate.payload);
  ownPrivateStateRemoval.players[owner.uid].moves = 2;
  ownPrivateStateRemoval.currentTurn = outsider.uid;
  ownPrivateStateRemoval.turnNumber = 4;
  delete ownPrivateStateRemoval.wormholeRunsByPlayer[owner.uid];
  delete ownPrivateStateRemoval.visionEffectsByPlayer[owner.uid];
  delete ownPrivateStateRemoval.poisonEffectsByPlayer[owner.uid];
  ownPrivateStateRemoval.illusionEffectsByPlayer[owner.uid] = {
    ...ownPrivateStateRemoval.illusionEffectsByPlayer[owner.uid],
    actionsRemaining: 2,
  };
  await expectAllowed(
    'current player expires timed state while decrementing their active illusion exactly once',
    databaseRequest(`rooms/${roomId}/gameState`, owner.token, 'PUT', ownPrivateStateRemoval)
  );

  const afterOwnPrivateRemoval = await databaseRequest(`rooms/${roomId}/gameState`, outsider.token, 'GET');
  assert.equal(afterOwnPrivateRemoval.ok, true, 'private-state removal turn should persist');

  const resetIllusionCountdown = clone(afterOwnPrivateRemoval.payload);
  resetIllusionCountdown.players[outsider.uid].moves = 2;
  resetIllusionCountdown.currentTurn = owner.uid;
  resetIllusionCountdown.turnNumber = 5;
  resetIllusionCountdown.illusionEffectsByPlayer[outsider.uid] = {
    ...resetIllusionCountdown.illusionEffectsByPlayer[outsider.uid],
    actionsRemaining: 3,
  };
  await expectDenied(
    'a runner cannot reset an active illusion countdown back to three',
    databaseRequest(`rooms/${roomId}/gameState`, outsider.token, 'PUT', resetIllusionCountdown)
  );

  const rewrittenFirstAnchor = clone(afterOwnPrivateRemoval.payload);
  rewrittenFirstAnchor.players[outsider.uid].moves = 2;
  rewrittenFirstAnchor.currentTurn = owner.uid;
  rewrittenFirstAnchor.turnNumber = 5;
  rewrittenFirstAnchor.illusionEffectsByPlayer[outsider.uid] = {
    ...rewrittenFirstAnchor.illusionEffectsByPlayer[outsider.uid],
    actionsRemaining: 1,
    firstWallOrigin: { row: 0, col: 1 },
  };
  await expectDenied(
    'the first illusion wall anchor cannot be rewritten on a later turn',
    databaseRequest(`rooms/${roomId}/gameState`, outsider.token, 'PUT', rewrittenFirstAnchor)
  );

  const ownIllusionCountdown = clone(afterOwnPrivateRemoval.payload);
  ownIllusionCountdown.players[outsider.uid].moves = 2;
  ownIllusionCountdown.currentTurn = owner.uid;
  ownIllusionCountdown.turnNumber = 5;
  ownIllusionCountdown.illusionEffectsByPlayer[outsider.uid] = {
    ...ownIllusionCountdown.illusionEffectsByPlayer[outsider.uid],
    actionsRemaining: 1,
  };
  await expectAllowed(
    'a committed own action decrements the illusion countdown and preserves its first anchor',
    databaseRequest(`rooms/${roomId}/gameState`, outsider.token, 'PUT', ownIllusionCountdown)
  );

  const afterOutsiderCountdown = await databaseRequest(`rooms/${roomId}/gameState`, owner.token, 'GET');
  assert.equal(afterOutsiderCountdown.ok, true, 'first anchored countdown should persist');
  const ownerIllusionCountdown = clone(afterOutsiderCountdown.payload);
  ownerIllusionCountdown.players[owner.uid].moves = 3;
  ownerIllusionCountdown.currentTurn = outsider.uid;
  ownerIllusionCountdown.turnNumber = 6;
  ownerIllusionCountdown.illusionEffectsByPlayer[owner.uid] = {
    ...ownerIllusionCountdown.illusionEffectsByPlayer[owner.uid],
    actionsRemaining: 1,
  };
  await expectAllowed(
    'the other runner can independently reach the last illusion action',
    databaseRequest(`rooms/${roomId}/gameState`, owner.token, 'PUT', ownerIllusionCountdown)
  );

  const beforeOutsiderExpiry = await databaseRequest(`rooms/${roomId}/gameState`, outsider.token, 'GET');
  assert.equal(beforeOutsiderExpiry.ok, true, 'last-action illusion state should persist');
  const outsiderIllusionExpiry = clone(beforeOutsiderExpiry.payload);
  outsiderIllusionExpiry.players[outsider.uid].moves = 3;
  outsiderIllusionExpiry.currentTurn = owner.uid;
  outsiderIllusionExpiry.turnNumber = 7;
  delete outsiderIllusionExpiry.illusionEffectsByPlayer[outsider.uid];
  await expectAllowed(
    'the runner can delete their illusion ledger on the exact expiry turn',
    databaseRequest(`rooms/${roomId}/gameState`, outsider.token, 'PUT', outsiderIllusionExpiry)
  );

  const beforeFinalIllusionExpiry = await databaseRequest(`rooms/${roomId}/gameState`, owner.token, 'GET');
  assert.equal(beforeFinalIllusionExpiry.ok, true, 'single remaining illusion ledger should persist');
  const finalIllusionExpiry = clone(beforeFinalIllusionExpiry.payload);
  finalIllusionExpiry.players[owner.uid].moves = 4;
  finalIllusionExpiry.currentTurn = outsider.uid;
  finalIllusionExpiry.turnNumber = 8;
  delete finalIllusionExpiry.illusionEffectsByPlayer;
  await expectAllowed(
    'the final runner can delete the whole illusion ledger on the exact expiry turn',
    databaseRequest(`rooms/${roomId}/gameState`, owner.token, 'PUT', finalIllusionExpiry)
  );

  await seedAdminFixture(`rooms/${roomId}/gameState`, 'PUT', liveRead.payload);

  const retiredSkillCreation = clone(liveRead.payload);
  retiredSkillCreation.itemState ||= {};
  retiredSkillCreation.itemState[owner.uid] = {
    mazeSkill: {
      version: 1,
      loadout: ['scoutPulse'],
      consumed: { scoutPulse: true },
    },
  };
  await expectDenied(
    'current player cannot create retired skill state during play',
    databaseRequest(`rooms/${roomId}/gameState`, owner.token, 'PUT', retiredSkillCreation)
  );

  const retiredSkillMutation = clone(liveRead.payload);
  retiredSkillMutation.itemState[outsider.uid].mazeSkill.consumed = { scoutPulse: true };
  await expectDenied(
    'current player cannot mutate retained legacy skill state during play',
    databaseRequest(`rooms/${roomId}/gameState`, owner.token, 'PUT', retiredSkillMutation)
  );

  const retiredSkillLoadoutMutation = clone(liveRead.payload);
  retiredSkillLoadoutMutation.itemState[outsider.uid].mazeSkill.loadout = ['anchor'];
  await expectDenied(
    'current player cannot change a retained legacy skill loadout during play',
    databaseRequest(`rooms/${roomId}/gameState`, owner.token, 'PUT', retiredSkillLoadoutMutation)
  );

  const retiredRadarTurn = clone(liveRead.payload);
  retiredRadarTurn.itemState[owner.uid] = { consumed: { 0: true } };
  retiredRadarTurn.players[owner.uid].moves = 1;
  retiredRadarTurn.currentTurn = outsider.uid;
  retiredRadarTurn.turnNumber = 2;
  retiredRadarTurn.revealedWallsByPlayer = {
    [owner.uid]: [{ position: { row: 5, col: 4 }, direction: 'right' }],
  };
  await expectDenied(
    'current player cannot consume an own-map detector through an old bundle',
    databaseRequest(`rooms/${roomId}/gameState`, owner.token, 'PUT', retiredRadarTurn)
  );

  const validItemState = clone(liveRead.payload);
  validItemState.itemState[outsider.uid].consumed = { 0: true };
  await expectAllowed(
    'current player may consume a trap or special wall on the assigned opponent map',
    databaseRequest(`rooms/${roomId}/gameState`, owner.token, 'PUT', validItemState)
  );
  const itemRead = await databaseRequest(`rooms/${roomId}/gameState`, owner.token, 'GET');
  assert.equal(itemRead.ok, true, 'item state should be readable');
  const validTurnState = clone(itemRead.payload);
  validTurnState.players[owner.uid].moves = 1;
  validTurnState.currentTurn = outsider.uid;
  validTurnState.turnNumber = 2;
  await expectAllowed(
    'current player may commit own move and next turn',
    databaseRequest(`rooms/${roomId}/gameState`, owner.token, 'PUT', validTurnState)
  );
  const postTurnRead = await databaseRequest(`rooms/${roomId}/gameState`, outsider.token, 'GET');
  assert.equal(postTurnRead.ok, true, 'advanced live state should be readable');
  const retiredSkillCleanup = clone(postTurnRead.payload);
  delete retiredSkillCleanup.itemState[outsider.uid].mazeSkill;
  await expectAllowed(
    'current player may remove a retained retired-skill envelope',
    databaseRequest(`rooms/${roomId}/gameState`, outsider.token, 'PUT', retiredSkillCleanup)
  );
  const persistentMapRead = await databaseRequest(`rooms/${roomId}/maps/${owner.uid}`, owner.token, 'GET');
  assert.deepEqual(persistentMapRead.payload, mapBeforePlay.payload, 'valid live turns must leave sibling maps unchanged');

  await expectAllowed(
    'current player may publish a temporary disconnect',
    databaseRequest(`rooms/${roomId}/gameState/players/${outsider.uid}`, outsider.token, 'PATCH', {
      isOnline: false,
      lastSeen: Date.now(),
    })
  );
  const temporaryOfflineRead = await databaseRequest(`rooms/${roomId}/gameState`, owner.token, 'GET');
  const prematureForfeit = clone(temporaryOfflineRead.payload);
  prematureForfeit.players[outsider.uid].forfeited = true;
  prematureForfeit.currentTurn = owner.uid;
  await expectDenied(
    'connected participant cannot forfeit a temporary disconnect',
    databaseRequest(`rooms/${roomId}/gameState`, owner.token, 'PUT', prematureForfeit)
  );

  await expectAllowed(
    'offline current player may publish an expired server timestamp',
    databaseRequest(`rooms/${roomId}/gameState/players/${outsider.uid}/lastSeen`, outsider.token, 'PUT', Date.now() - 46_000)
  );
  const expiredOfflineRead = await databaseRequest(`rooms/${roomId}/gameState`, owner.token, 'GET');
  const recoveredOfflineTurn = clone(expiredOfflineRead.payload);
  recoveredOfflineTurn.currentTurn = owner.uid;
  recoveredOfflineTurn.turnNumber += 1;
  recoveredOfflineTurn.turnMessage = 'offline turn skipped without surrender';
  recoveredOfflineTurn.turnMessageTimestamp = Date.now();
  await expectAllowed(
    'connected participant atomically skips an expired offline turn without surrender',
    databaseRequest(`rooms/${roomId}/gameState`, owner.token, 'PUT', recoveredOfflineTurn)
  );
  const recoveredOfflineRead = await databaseRequest(`rooms/${roomId}/gameState`, owner.token, 'GET');
  assert.equal(recoveredOfflineRead.payload.players[outsider.uid].forfeited, false);
  assert.equal(recoveredOfflineRead.payload.currentTurn, owner.uid);
  assert.equal(recoveredOfflineRead.payload.turnNumber, 3);

  await expectDenied(
    'a current player cannot voluntarily surrender',
    databaseRequest(
      `rooms/${roomId}/gameState/players/${owner.uid}/forfeited`,
      owner.token,
      'PUT',
      true
    )
  );

  // Historical rooms may already contain a forfeited runner. Keep the rest of
  // this legacy END/ranking compatibility fixture without allowing any client
  // to create a new surrender after the rule change.
  await seedAdminFixture(
    `rooms/${roomId}/gameState/players/${outsider.uid}/forfeited`,
    'PUT',
    true
  );
  const historicalForfeitRead = await databaseRequest(`rooms/${roomId}/gameState`, owner.token, 'GET');

  const forgedEndState = clone(historicalForfeitRead.payload);
  forgedEndState.phase = 'end';
  forgedEndState.currentTurn = null;
  forgedEndState.winner = owner.uid;
  forgedEndState.draw = null;
  forgedEndState.turnNumber = 4;
  forgedEndState.players[owner.uid].finished = true;
  forgedEndState.players[owner.uid].finishMoves = 2;
  forgedEndState.players[owner.uid].moves = 2;
  await expectDenied(
    'current player cannot forge completion away from the assigned goal',
    databaseRequest(`rooms/${roomId}/gameState`, owner.token, 'PUT', forgedEndState)
  );

  const rankedEndState = clone(forgedEndState);
  rankedEndState.players[owner.uid].position = { row: 5, col: 5 };
  const forgedWinnerState = clone(rankedEndState);
  forgedWinnerState.winner = outsider.uid;
  await expectDenied(
    'terminal winner must be a non-forfeited minimum-move finisher',
    databaseRequest(`rooms/${roomId}/gameState`, owner.token, 'PUT', forgedWinnerState)
  );
  const forgedDrawState = clone(rankedEndState);
  forgedDrawState.winner = null;
  forgedDrawState.draw = true;
  await expectDenied(
    'a unique finisher cannot forge a draw',
    databaseRequest(`rooms/${roomId}/gameState`, owner.token, 'PUT', forgedDrawState)
  );
  await expectAllowed(
    'owner atomically finishes ranked match',
    databaseRequest(`rooms/${roomId}/gameState`, owner.token, 'PUT', rankedEndState)
  );

  await expectDenied(
    'host cannot delete an unsettled END room',
    databaseRequest(`rooms/${roomId}`, owner.token, 'DELETE')
  );
  await expectDenied(
    'host cannot restart an unsettled END room',
    databaseRequest(`rooms/${roomId}/gameState/phase`, owner.token, 'PUT', 'setup')
  );

  const ownerRanking = {
    uid: owner.uid,
    displayName: 'Owner',
    wins: 1,
    losses: 0,
    draws: 0,
    played: 1,
    rating: 1020,
    bestMoves: 2,
    lastRoomId: roomId,
    lastMatchNumber: 1,
    updatedAt: Date.now(),
    settlementCount: 1,
    settledMatches: { [`${roomId}:1`]: true },
    settlementTrail: `|${roomId}:1|`,
  };
  await expectAllowed(
    'winner creates one idempotent persistent maze ranking entry',
    databaseRequest(`mazeRankings/${owner.uid}`, owner.token, 'PUT', ownerRanking)
  );
  await expectDenied(
    'same room match cannot be settled twice',
    databaseRequest(`mazeRankings/${owner.uid}`, owner.token, 'PUT', {
      ...ownerRanking,
      wins: 2,
      played: 2,
      rating: 1040,
      settlementCount: 2,
      updatedAt: Date.now(),
    })
  );
  await expectDenied(
    'single-winner match cannot be claimed as a draw',
    databaseRequest(`mazeRankings/${outsider.uid}`, outsider.token, 'PUT', {
      uid: outsider.uid,
      displayName: 'Outsider',
      wins: 0,
      losses: 0,
      draws: 1,
      played: 1,
      rating: 1000,
      bestMoves: 0,
      lastRoomId: roomId,
      lastMatchNumber: 1,
      updatedAt: Date.now(),
      settlementCount: 1,
      settledMatches: { [`${roomId}:1`]: true },
      settlementTrail: `|${roomId}:1|`,
    })
  );
  const outsiderRanking = {
    uid: outsider.uid,
    displayName: 'Outsider',
    wins: 0,
    losses: 1,
    draws: 0,
    played: 1,
    rating: 988,
    bestMoves: 0,
    lastRoomId: roomId,
    lastMatchNumber: 1,
    updatedAt: Date.now(),
    settlementCount: 1,
    settledMatches: { [`${roomId}:1`]: true },
    settlementTrail: `|${roomId}:1|`,
  };
  await expectAllowed(
    'another participant may settle the exact loser ranking',
    databaseRequest(`mazeRankings/${outsider.uid}`, owner.token, 'PUT', outsiderRanking)
  );
  await expectDenied(
    'another user cannot rewrite a ranking entry',
    databaseRequest(`mazeRankings/${owner.uid}`, outsider.token, 'PUT', ownerRanking)
  );
  await expectDenied(
    'ranking entries cannot be deleted to reset rating or settlement markers',
    databaseRequest(`mazeRankings/${owner.uid}`, owner.token, 'DELETE')
  );
  await expectDenied(
    'ranking cannot claim an unrecorded room match number',
    databaseRequest(`mazeRankings/${owner.uid}`, owner.token, 'PUT', {
      ...ownerRanking,
      wins: 2,
      played: 2,
      rating: 1040,
      lastMatchNumber: 2,
      settlementCount: 2,
      updatedAt: Date.now(),
      settledMatches: {
        ...ownerRanking.settledMatches,
        [`${roomId}:2`]: true,
      },
      settlementTrail: `${ownerRanking.settlementTrail}${roomId}:2|`,
    })
  );

  const alternateRoomId = `alternate-${Date.now()}`;
  await expectAllowed(
    'alternate match room creation',
    databaseRequest(`rooms/${alternateRoomId}`, owner.token, 'PUT', createRoomPayload(owner.uid, canonical))
  );
  await expectAllowed(
    'alternate match map setup',
    databaseRequest(`rooms/${alternateRoomId}`, owner.token, 'PATCH', {
      [`maps/${owner.uid}`]: validMap(),
      [`gameState/players/${owner.uid}/isReady`]: true,
    })
  );
  const alternateSetup = await databaseRequest(`rooms/${alternateRoomId}/gameState`, owner.token, 'GET');
  const alternatePlay = {
    ...alternateSetup.payload,
    matchNumber: 1,
    phase: 'play',
    turnNumber: 1,
    currentTurn: owner.uid,
    turnOrder: [owner.uid],
    assignments: { [owner.uid]: owner.uid },
    itemState: { [owner.uid]: { type: 'radar' } },
    players: {
      [owner.uid]: {
        ...alternateSetup.payload.players[owner.uid],
        position: { row: 5, col: 4 },
        isReady: true,
        finished: false,
        forfeited: false,
        moves: 0,
      },
    },
  };
  await expectAllowed(
    'alternate match starts',
    databaseRequest(`rooms/${alternateRoomId}/gameState`, owner.token, 'PUT', alternatePlay)
  );
  const alternateEnd = clone(alternatePlay);
  alternateEnd.phase = 'end';
  alternateEnd.currentTurn = null;
  alternateEnd.turnNumber = 2;
  alternateEnd.winner = owner.uid;
  alternateEnd.players[owner.uid].position = { row: 5, col: 5 };
  alternateEnd.players[owner.uid].finished = true;
  alternateEnd.players[owner.uid].finishMoves = 1;
  alternateEnd.players[owner.uid].moves = 1;
  await expectAllowed(
    'alternate match finishes legally',
    databaseRequest(`rooms/${alternateRoomId}/gameState`, owner.token, 'PUT', alternateEnd)
  );
  const alternateRanking = {
    ...ownerRanking,
    wins: 2,
    played: 2,
    rating: 1040,
    bestMoves: 1,
    lastRoomId: alternateRoomId,
    settlementCount: 2,
    updatedAt: Date.now(),
    settledMatches: {
      ...ownerRanking.settledMatches,
      [`${alternateRoomId}:1`]: true,
    },
    settlementTrail: `${ownerRanking.settlementTrail}${alternateRoomId}:1|`,
  };
  await expectDenied(
    'alternate settlement cannot drop an old marker to enable replay',
    databaseRequest(`mazeRankings/${owner.uid}`, owner.token, 'PUT', {
      ...alternateRanking,
      settledMatches: { [`${alternateRoomId}:1`]: true },
    })
  );
  await expectAllowed(
    'alternate settlement appends its immutable replay trail',
    databaseRequest(`mazeRankings/${owner.uid}`, owner.token, 'PUT', alternateRanking)
  );

  const drawRoomId = `draw-${Date.now()}`;
  await expectAllowed(
    'draw settlement room creation',
    databaseRequest(`rooms/${drawRoomId}`, owner.token, 'PUT', createRoomPayload(owner.uid, canonical))
  );
  await expectAllowed(
    'owner marks per-connection presence ready',
    databaseRequest(`rooms/${drawRoomId}/ownerPresenceReady`, owner.token, 'PUT', true)
  );
  await expectAllowed(
    'owner registers the active room connection',
    databaseRequest(`rooms/${drawRoomId}/connections/${owner.uid}/0`, owner.token, 'PUT', {
      connectedAt: Date.now(),
      lastSeen: Date.now(),
      session: 'rules-owner-primary',
    })
  );
  await expectDenied(
    'non-member cannot create a room connection',
    databaseRequest(`rooms/${drawRoomId}/connections/${outsider.uid}/0`, outsider.token, 'PUT', {
      connectedAt: Date.now(),
      lastSeen: Date.now(),
      session: 'rules-outsider',
    })
  );
  await expectDenied(
    'room connection slots are capped at eight per user',
    databaseRequest(`rooms/${drawRoomId}/connections/${owner.uid}/8`, owner.token, 'PUT', {
      connectedAt: Date.now(),
      lastSeen: Date.now(),
      session: 'rules-owner-overflow',
    })
  );
  await expectAllowed(
    'draw target claims a setup roster slot',
    databaseRequest(`rooms/${drawRoomId}/players/1`, drawTarget.token, 'PUT', drawTarget.uid)
  );
  await expectAllowed(
    'draw target joins setup after claiming a slot',
    databaseRequest(`rooms/${drawRoomId}/gameState/players/${drawTarget.uid}`, drawTarget.token, 'PUT', {
      id: drawTarget.uid,
      position: { row: 0, col: 0 },
      isReady: true,
    })
  );
  const drawSetup = await databaseRequest(`rooms/${drawRoomId}/gameState`, owner.token, 'GET');
  const drawPlay = {
    ...drawSetup.payload,
    matchNumber: 1,
    phase: 'play',
    turnNumber: 1,
    currentTurn: owner.uid,
    turnOrder: [owner.uid, drawTarget.uid],
    assignments: { [owner.uid]: drawTarget.uid, [drawTarget.uid]: owner.uid },
    itemState: { [owner.uid]: { type: 'radar' }, [drawTarget.uid]: { type: 'radar' } },
    players: {
      [owner.uid]: {
        ...drawSetup.payload.players[owner.uid],
        isReady: true,
        finished: false,
        forfeited: false,
        moves: 0,
      },
      [drawTarget.uid]: {
        ...drawSetup.payload.players[drawTarget.uid],
        finished: false,
        forfeited: false,
        moves: 0,
      },
    },
  };
  await expectAllowed(
    'draw settlement match starts',
    databaseRequest(`rooms/${drawRoomId}/gameState`, owner.token, 'PUT', drawPlay)
  );
  const drawEnd = clone(drawPlay);
  drawEnd.phase = 'end';
  drawEnd.currentTurn = null;
  drawEnd.draw = true;
  drawEnd.players[owner.uid].forfeited = true;
  drawEnd.players[drawTarget.uid].forfeited = true;
  await expectDenied(
    'players cannot manufacture an all-surrender draw',
    databaseRequest(`rooms/${drawRoomId}/gameState`, owner.token, 'PUT', drawEnd)
  );
  await seedAdminFixture(
    `rooms/${drawRoomId}/gameState`,
    'PUT',
    drawEnd
  );
  await expectAllowed(
    'participant may settle another participant in a global draw',
    databaseRequest(`mazeRankings/${drawTarget.uid}`, owner.token, 'PUT', {
      uid: drawTarget.uid,
      displayName: 'Draw Target',
      wins: 0,
      losses: 0,
      draws: 1,
      played: 1,
      rating: 1000,
      bestMoves: 0,
      lastRoomId: drawRoomId,
      lastMatchNumber: 1,
      updatedAt: Date.now(),
      settlementCount: 1,
      settledMatches: { [`${drawRoomId}:1`]: true },
      settlementTrail: `|${drawRoomId}:1|`,
    })
  );
  await expectAllowed(
    'owner global disconnect state is recorded independently from the room',
    databaseRequest(`userStatus/${owner.uid}/online`, owner.token, 'PUT', false)
  );
  await expectAllowed(
    'owner room connection is removed on disconnect',
    databaseRequest(`rooms/${drawRoomId}/connections/${owner.uid}/0`, owner.token, 'DELETE')
  );
  await expectAllowed(
    'owner disconnect records a server-authorized cleanup lease',
    databaseRequest(`rooms/${drawRoomId}/ownerDisconnectedAt`, owner.token, 'PUT', Date.now())
  );
  await expectDenied(
    'participant cannot clean up an offline-owner room during reconnect grace',
    databaseRequest(`rooms/${drawRoomId}`, drawTarget.token, 'DELETE')
  );
  await new Promise((resolve) => setTimeout(resolve, 2_600));
  await expectDenied(
    'offline-owner END room remains until every ranking is settled',
    databaseRequest(`rooms/${drawRoomId}`, drawTarget.token, 'DELETE')
  );
  await expectAllowed(
    'participant settles the offline owner before cleanup',
    databaseRequest(`mazeRankings/${owner.uid}`, drawTarget.token, 'PUT', {
      ...alternateRanking,
      draws: 1,
      played: 3,
      lastRoomId: drawRoomId,
      lastMatchNumber: 1,
      updatedAt: Date.now(),
      settlementCount: 3,
      settledMatches: {
        ...alternateRanking.settledMatches,
        [`${drawRoomId}:1`]: true,
      },
      settlementTrail: `${alternateRanking.settlementTrail}${drawRoomId}:1|`,
    })
  );
  await expectAllowed(
    'owner reconnect is visible independently from the ended room',
    databaseRequest(`userStatus/${owner.uid}/online`, owner.token, 'PUT', true)
  );
  await expectAllowed(
    'owner reconnect registers a new active tab connection',
    databaseRequest(`rooms/${drawRoomId}/connections/${owner.uid}/1`, owner.token, 'PUT', {
      connectedAt: Date.now(),
      lastSeen: Date.now(),
      session: 'rules-owner-secondary',
    })
  );
  await expectAllowed(
    'owner reconnect clears the disconnect cleanup lease',
    databaseRequest(`rooms/${drawRoomId}/ownerDisconnectedAt`, owner.token, 'DELETE')
  );
  await expectDenied(
    'participant cannot remove a settled END room while its owner is online',
    databaseRequest(`rooms/${drawRoomId}`, drawTarget.token, 'DELETE')
  );
  await expectAllowed(
    'owner disconnect is visible independently from the ended room',
    databaseRequest(`userStatus/${owner.uid}/online`, owner.token, 'PUT', false)
  );
  await expectAllowed(
    'last owner tab connection disappears',
    databaseRequest(`rooms/${drawRoomId}/connections/${owner.uid}/1`, owner.token, 'DELETE')
  );
  await expectAllowed(
    'last owner tab disconnect renews the cleanup lease',
    databaseRequest(`rooms/${drawRoomId}/ownerDisconnectedAt`, owner.token, 'PUT', Date.now())
  );
  await new Promise((resolve) => setTimeout(resolve, 2_600));
  await expectAllowed(
    'participant cleans up the fully settled END room after owner disconnect',
    databaseRequest(`rooms/${drawRoomId}`, drawTarget.token, 'DELETE')
  );

  const endedRestartState = await databaseRequest(`rooms/${roomId}/gameState`, owner.token, 'GET');
  const resetRestartState = {
    ...endedRestartState.payload,
    phase: 'setup',
    winner: null,
    draw: null,
    currentTurn: owner.uid,
    turnOrder: [owner.uid],
    players: {
      [owner.uid]: {
        ...endedRestartState.payload.players[owner.uid],
        isReady: false,
        finished: false,
        forfeited: false,
        hasLeft: false,
        moves: 0,
      },
    },
  };
  await expectAllowed(
    'owner may restart only after every ranking marker is settled',
    databaseRequest(`rooms/${roomId}`, owner.token, 'PATCH', {
      maps: null,
      'players/0': owner.uid,
      'players/1': null,
      gameState: resetRestartState,
      status: 'waiting',
    })
  );
  const clearedMaps = await databaseRequest(`rooms/${roomId}/maps`, owner.token, 'GET');
  assert.equal(clearedMaps.payload, null, 'restart must clear sibling maps');
  const restartedState = await databaseRequest(`rooms/${roomId}/gameState`, owner.token, 'GET');
  assert.equal(restartedState.payload.phase, 'setup', 'restart must return to setup atomically');

  const capacityRoomId = `capacity-${Date.now()}`;
  const capacityRoom = createRoomPayload(owner.uid, canonical);
  capacityRoom.maxPlayers = 2;
  await expectAllowed(
    'two-player capacity room creation',
    databaseRequest(`rooms/${capacityRoomId}`, owner.token, 'PUT', capacityRoom)
  );
  await expectAllowed(
    'second player claims the final configured room slot',
    databaseRequest(`rooms/${capacityRoomId}/players/1`, outsider.token, 'PUT', outsider.uid)
  );
  await expectAllowed(
    'second player fills the configured room capacity',
    databaseRequest(`rooms/${capacityRoomId}/gameState/players/${outsider.uid}`, outsider.token, 'PUT', {
      id: outsider.uid,
      position: { row: 0, col: 0 },
      isReady: false,
    })
  );
  await expectDenied(
    'a concurrent third player cannot exceed the configured room capacity',
    databaseRequest(`rooms/${capacityRoomId}/players/2`, drawTarget.token, 'PUT', drawTarget.uid)
  );

  const tampered = clone(canonical);
  tampered.itemCosts.poisonWall = 2;
  await expectDenied(
    'room snapshot cannot restore the previous poison-wall cost',
    databaseRequest(
      `rooms/tampered-${Date.now()}`,
      owner.token,
      'PUT',
      createRoomPayload(owner.uid, tampered)
    )
  );
  const missingSnapshotRoom = createRoomPayload(owner.uid, canonical);
  delete missingSnapshotRoom.ruleSnapshot;
  await expectDenied(
    'missing room snapshot',
    databaseRequest(
      `rooms/missing-${Date.now()}`,
      owner.token,
      'PUT',
      missingSnapshotRoom
    )
  );

  const retiredProfilePath = `users/${owner.uid}/adventure/v1`;
  await expectDenied(
    'retired game profile state cannot be created',
    databaseRequest(retiredProfilePath, owner.token, 'PUT', { retired: false })
  );
  await seedAdminFixture(retiredProfilePath, 'PUT', { retired: true });
  await expectDenied(
    'retired game profile state is no longer readable',
    databaseRequest(retiredProfilePath, owner.token, 'GET')
  );
  await expectAllowed(
    'account owner can delete stale retired profile state',
    databaseRequest(retiredProfilePath, owner.token, 'DELETE')
  );
  await expectAllowed(
    'account owner can read an allowed profile leaf',
    databaseRequest(`users/${owner.uid}/displayName`, owner.token, 'GET')
  );
  await expectDenied(
    'bulk profile reads stay closed after private game state retirement',
    databaseRequest(`users/${owner.uid}`, owner.token, 'GET')
  );
  await expectDenied(
    'unknown profile state cannot replace the retired game branch',
    databaseRequest(`users/${owner.uid}/campaign`, owner.token, 'PUT', { level: 1 })
  );

  for (const retiredRoot of [
    'adventureAuthority',
    'adventureViews',
    'adventureRankings',
    'adventureAuthorityRankings',
    'adventurePresence',
  ]) {
    const retiredPath = `${retiredRoot}/${owner.uid}`;
    await seedAdminFixture(retiredPath, 'PUT', { retired: true });
    await expectDenied(
      `${retiredRoot} data is no longer readable`,
      databaseRequest(retiredPath, owner.token, 'GET')
    );
    await expectDenied(
      `${retiredRoot} data is no longer writable`,
      databaseRequest(retiredPath, owner.token, 'PUT', { retired: false })
    );
    await seedAdminFixture(retiredPath, 'DELETE');
  }

  console.log('DATABASE RULES: maze turns, rankings, authority views, and retired-path denial passed');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
