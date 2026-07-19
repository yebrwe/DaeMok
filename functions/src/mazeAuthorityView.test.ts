import assert from 'node:assert/strict';
import test from 'node:test';
import {
  GamePhase,
  type GameMap,
  type MazeSkillId,
  type Position,
} from '../vendor/maze-engine/dist/types/game';
import {
  MazeAuthorityDomainError,
  reduceMazeAuthorityCommand,
  type MazeAuthorityState,
} from './mazeAuthorityDomain';
import {
  MAZE_AUTHORITY_VIEW_VERSION,
  projectMazeAuthorityMemberView,
  projectMazeAuthorityPublicView,
} from './mazeAuthorityView';

const OWNER = 'owner-view-0001';
const GUEST = 'guest-view-0001';
const OUTSIDER = 'outsider-view-0001';
const ROOM_ID = 'room-view-0001';

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function mapWithDetails(
  startPosition: Position,
  endPosition: Position,
  skillLoadout: MazeSkillId,
  obstaclePosition: Position,
  itemPosition: Position,
): GameMap {
  return {
    rulesVersion: 3,
    startPosition,
    endPosition,
    obstacles: [{ position: obstaclePosition, direction: 'right' }],
    items: [{ type: 'mine', position: itemPosition }],
    skillLoadout,
  };
}

function createRoom(): MazeAuthorityState {
  return reduceMazeAuthorityCommand(null, OWNER, {
    type: 'createRoom',
    commandId: 'view-create-0001',
    roomId: ROOM_ID,
    expectedGeneration: 0,
    expectedRevision: 0,
    name: 'Projection Room',
    maxPlayers: 2,
  }, 1_000).state;
}

function applyCommand(
  state: MazeAuthorityState,
  actorId: string,
  command: Record<string, unknown>,
  now: number,
): MazeAuthorityState {
  return reduceMazeAuthorityCommand(state, actorId, {
    ...command,
    roomId: ROOM_ID,
    expectedGeneration: state.meta.generation,
    expectedRevision: state.meta.revision,
  }, now).state;
}

function readyRoom(ownerMap: GameMap, guestMap: GameMap): MazeAuthorityState {
  let state = createRoom();
  state = applyCommand(state, GUEST, {
    type: 'joinRoom',
    commandId: 'view-join-00001',
  }, 1_100);
  state = applyCommand(state, OWNER, {
    type: 'submitMap',
    commandId: 'view-owner-map-01',
    map: ownerMap,
  }, 1_200);
  return applyCommand(state, GUEST, {
    type: 'submitMap',
    commandId: 'view-guest-map-01',
    map: guestMap,
  }, 1_300);
}

function startMatch(state: MazeAuthorityState): MazeAuthorityState {
  return applyCommand(state, OWNER, {
    type: 'startMatch',
    commandId: 'view-start-0001',
  }, 1_400);
}

function applyMove(
  state: MazeAuthorityState,
  actorId: string,
  direction: 'up' | 'down' | 'left' | 'right',
  commandId: string,
  now: number,
): MazeAuthorityState {
  return applyCommand(state, actorId, {
    type: 'turn',
    commandId,
    action: { type: 'move', direction },
  }, now);
}

function objectKeysDeep(value: unknown, keys = new Set<string>()): Set<string> {
  if (Array.isArray(value)) {
    for (const entry of value) objectKeysDeep(entry, keys);
    return keys;
  }
  if (value === null || typeof value !== 'object') return keys;
  for (const [key, entry] of Object.entries(value)) {
    keys.add(key);
    objectKeysDeep(entry, keys);
  }
  return keys;
}

function assertNoPrivateAuthorityFields(view: unknown): void {
  const keys = objectKeysDeep(view);
  for (const forbidden of [
    'receipts',
    'byId',
    'payloadHash',
    'commandType',
    'lastSeen',
    'lastPosition',
    'positionHistory',
    'joinedAt',
    'email',
    'serverOnlyTurnSeed',
    'authoritySecret',
    'privateItemToken',
  ]) {
    assert.equal(keys.has(forbidden), false, `projection leaked forbidden key ${forbidden}`);
  }
}

function taintNestedPrivateFields(state: MazeAuthorityState): MazeAuthorityState {
  const tainted = cloneJson(state);
  const gameStateRecord = tainted.gameState as unknown as Record<string, unknown>;
  gameStateRecord.serverOnlyTurnSeed = 'SERVER-TURN-SEED-MARKER';
  const ownerPlayer = tainted.gameState.players[OWNER] as unknown as Record<string, unknown>;
  ownerPlayer.email = 'private@example.invalid';
  const ownerMap = tainted.gameState.maps?.[OWNER] as unknown as Record<string, unknown>;
  ownerMap.authoritySecret = 'OWNER-MAP-SECRET-MARKER';
  const firstItem = tainted.gameState.maps?.[OWNER]?.items?.[0] as unknown as Record<string, unknown>;
  if (firstItem) firstItem.authoritySecret = 'OWNER-ITEM-SECRET-MARKER';
  const ownerItemState = tainted.gameState.itemState?.[OWNER] as unknown as Record<string, unknown>;
  if (ownerItemState) ownerItemState.privateItemToken = 'PRIVATE-ITEM-TOKEN-MARKER';
  return tainted;
}

function assertMarkersAbsent(view: unknown, state: MazeAuthorityState): void {
  const serialized = JSON.stringify(view);
  for (const marker of [
    'SERVER-TURN-SEED-MARKER',
    'OWNER-MAP-SECRET-MARKER',
    'OWNER-ITEM-SECRET-MARKER',
    'PRIVATE-ITEM-TOKEN-MARKER',
    'private@example.invalid',
  ]) assert.equal(serialized.includes(marker), false, `projection leaked ${marker}`);

  for (const receipt of Object.values(state.receipts.byId)) {
    assert.equal(serialized.includes(receipt.payloadHash), false, 'projection leaked a receipt hash');
  }
}

const OWNER_DETAILED_MAP = mapWithDetails(
  { row: 0, col: 0 },
  { row: 0, col: 2 },
  'scoutPulse',
  { row: 3, col: 3 },
  { row: 4, col: 4 },
);
const GUEST_DETAILED_MAP = mapWithDetails(
  { row: 5, col: 5 },
  { row: 5, col: 3 },
  'dash',
  { row: 1, col: 1 },
  { row: 2, col: 2 },
);

test('setup public and member projections expose no receipts, foreign maps, or presence history', () => {
  const canonical = readyRoom(OWNER_DETAILED_MAP, GUEST_DETAILED_MAP);
  const state = taintNestedPrivateFields(canonical);
  const publicView = projectMazeAuthorityPublicView(state);
  const ownerView = projectMazeAuthorityMemberView(state, OWNER);

  assert.equal(publicView.viewVersion, MAZE_AUTHORITY_VIEW_VERSION);
  assert.equal(publicView.generation, state.meta.generation);
  assert.equal(publicView.revision, state.meta.revision);
  assert.deepEqual(publicView.gameState.maps, {});
  assert.deepEqual(Object.keys(ownerView.gameState.maps), [OWNER]);
  assert.deepEqual(ownerView.gameState.maps[OWNER], OWNER_DETAILED_MAP);
  assert.equal(ownerView.gameState.maps[GUEST], undefined);
  assert.equal('position' in publicView.gameState.players[OWNER], false);
  assert.equal('position' in ownerView.gameState.players[OWNER], false);
  assert.deepEqual(publicView.gameState.itemState, {});
  assert.deepEqual(ownerView.gameState.itemState, {});
  assertNoPrivateAuthorityFields(publicView);
  assertNoPrivateAuthorityFields(ownerView);
  assertMarkersAbsent(publicView, state);
  assertMarkersAbsent(ownerView, state);

  assert.throws(
    () => projectMazeAuthorityMemberView(state, OUTSIDER),
    (error: unknown) => error instanceof MazeAuthorityDomainError
      && error.code === 'permission-denied'
      && error.reason === 'not-a-member',
  );
});

test('play projection publishes boundary-only public boards and only the member own full map/state', () => {
  const canonical = startMatch(readyRoom(OWNER_DETAILED_MAP, GUEST_DETAILED_MAP));
  const state = taintNestedPrivateFields(canonical);
  const publicView = projectMazeAuthorityPublicView(state);
  const ownerView = projectMazeAuthorityMemberView(state, OWNER);

  assert.equal(publicView.gameState.phase, GamePhase.PLAY);
  assert.deepEqual(publicView.gameState.maps[OWNER], {
    startPosition: OWNER_DETAILED_MAP.startPosition,
    endPosition: OWNER_DETAILED_MAP.endPosition,
  });
  assert.deepEqual(publicView.gameState.maps[GUEST], {
    startPosition: GUEST_DETAILED_MAP.startPosition,
    endPosition: GUEST_DETAILED_MAP.endPosition,
  });
  assert.deepEqual(Object.keys(publicView.gameState.maps[OWNER]).sort(), [
    'endPosition',
    'startPosition',
  ]);
  assert.deepEqual(ownerView.gameState.maps[OWNER], OWNER_DETAILED_MAP);
  assert.deepEqual(ownerView.gameState.maps[GUEST], {
    startPosition: GUEST_DETAILED_MAP.startPosition,
    endPosition: GUEST_DETAILED_MAP.endPosition,
  });
  assert.deepEqual(publicView.gameState.itemState, {});
  assert.deepEqual(Object.keys(ownerView.gameState.itemState), [OWNER]);
  assert.equal(ownerView.gameState.itemState[GUEST], undefined);
  assert.deepEqual(publicView.gameState.revealedWallsByPlayer, {});
  assert.deepEqual(publicView.gameState.visionEffectsByPlayer, {});
  assert.deepEqual(ownerView.gameState.players[OWNER].position, GUEST_DETAILED_MAP.startPosition);
  assertNoPrivateAuthorityFields(publicView);
  assertNoPrivateAuthorityFields(ownerView);
  assertMarkersAbsent(publicView, state);
  assertMarkersAbsent(ownerView, state);
});

test('collision projection keeps a consumed fake wall disguised as a discovered normal wall', () => {
  const ownerMap: GameMap = {
    rulesVersion: 3,
    startPosition: { row: 0, col: 0 },
    endPosition: { row: 0, col: 2 },
    obstacles: [],
    items: [{
      type: 'oneTimeWall',
      wallPosition: { row: 0, col: 0 },
      wallDirection: 'right',
    }],
    skillLoadout: 'anchor',
  };
  const guestMap: GameMap = {
    rulesVersion: 3,
    startPosition: { row: 5, col: 5 },
    endPosition: { row: 4, col: 4 },
    obstacles: [{ position: { row: 5, col: 5 }, direction: 'left' }],
    items: [],
    skillLoadout: 'breach',
  };
  let state = startMatch(readyRoom(ownerMap, guestMap));
  state = applyMove(state, OWNER, 'left', 'view-static-wall-1', 1_500);
  state = applyMove(state, GUEST, 'right', 'view-dynamic-wall', 1_600);

  assert.equal(Object.keys(state.gameState.collisionWalls ?? {}).length, 2);
  const ownerConsumed = state.gameState.itemState?.[OWNER]?.consumed;
  assert.equal(
    ownerConsumed === true || (typeof ownerConsumed === 'object' && ownerConsumed[0] === true),
    true,
  );

  const publicView = projectMazeAuthorityPublicView(state);
  const ownerView = projectMazeAuthorityMemberView(state, OWNER);
  assert.equal(publicView.gameState.collisionWalls.length, 2);
  assert.deepEqual(publicView.gameState.collisionWalls, [{
    playerId: OWNER,
    position: { row: 5, col: 5 },
    direction: 'left',
    timestamp: 1_500,
    mapOwnerId: GUEST,
  }, {
    playerId: GUEST,
    position: { row: 0, col: 0 },
    direction: 'right',
    timestamp: 1_600,
    mapOwnerId: OWNER,
  }]);
  assert.deepEqual(ownerView.gameState.collisionWalls, publicView.gameState.collisionWalls);
  assert.deepEqual(publicView.gameState.itemState, {});
  assert.deepEqual(Object.keys(ownerView.gameState.itemState), [OWNER]);
});

test('end projection reveals every full map and final item state without reviving private history', () => {
  const ownerMap: GameMap = {
    rulesVersion: 3,
    startPosition: { row: 0, col: 0 },
    endPosition: { row: 0, col: 1 },
    obstacles: [{ position: { row: 4, col: 4 }, direction: 'right' }],
    items: [{ type: 'radar' }],
    skillLoadout: 'anchor',
  };
  const guestMap: GameMap = {
    rulesVersion: 3,
    startPosition: { row: 0, col: 0 },
    endPosition: { row: 0, col: 1 },
    obstacles: [{ position: { row: 3, col: 3 }, direction: 'right' }],
    items: [{ type: 'smoke', position: { row: 5, col: 5 } }],
    skillLoadout: 'dash',
  };
  let state = startMatch(readyRoom(ownerMap, guestMap));
  state = applyMove(state, OWNER, 'right', 'view-owner-finish', 1_500);
  state = applyMove(state, GUEST, 'right', 'view-guest-finish', 1_600);
  assert.equal(state.gameState.phase, GamePhase.END);

  const publicView = projectMazeAuthorityPublicView(state);
  const guestView = projectMazeAuthorityMemberView(state, GUEST);
  assert.deepEqual(publicView.gameState.maps, { [OWNER]: ownerMap, [GUEST]: guestMap });
  assert.deepEqual(guestView.gameState.maps, publicView.gameState.maps);
  assert.deepEqual(Object.keys(publicView.gameState.itemState), [OWNER, GUEST]);
  assert.deepEqual(guestView.gameState.itemState, publicView.gameState.itemState);
  assert.equal('position' in publicView.gameState.players[OWNER], true);
  assertNoPrivateAuthorityFields(publicView);
  assertNoPrivateAuthorityFields(guestView);
});
