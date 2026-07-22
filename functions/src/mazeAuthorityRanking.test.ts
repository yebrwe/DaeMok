import assert from 'node:assert/strict';
import test from 'node:test';
import type { GameMap } from '../vendor/maze-engine/dist/types/game';
import {
  reduceMazeAuthorityCommand,
  type MazeAuthorityState,
} from './mazeAuthorityDomain';
import {
  MAZE_AUTHORITY_INITIAL_RATING,
  applyMazeAuthorityRankingSettlement,
  buildMazeAuthorityRankingSettlements,
  mazeAuthorityRankingSettlementKey,
  syncCurrentMazeAuthorityRankingSettlement,
  type MazeAuthorityRankingDependencies,
  type MazeAuthorityRankingTransactionReference,
} from './mazeAuthorityRanking';

const OWNER = 'ranking-owner-001';
const GUEST = 'ranking-guest-001';
const ROOM_ID = 'ranking-room-001';

function simpleMap(): GameMap {
  return {
    rulesVersion: 5,
    startPosition: { row: 0, col: 0 },
    endPosition: { row: 0, col: 1 },
    obstacles: [],
    items: [],
    skillLoadout: 'scoutPulse',
    runnerGear: 'none',
  };
}

function command(
  state: MazeAuthorityState | null,
  uid: string,
  input: Record<string, unknown>,
  now: number,
): MazeAuthorityState {
  return reduceMazeAuthorityCommand(state, uid, {
    ...input,
    roomId: ROOM_ID,
    expectedGeneration: state?.meta.generation ?? 0,
    expectedRevision: state?.meta.revision ?? 0,
  }, now).state;
}

function terminalRoom(): MazeAuthorityState {
  let state = command(null, OWNER, {
    type: 'createRoom',
    commandId: 'ranking-create-001',
    name: 'Ranking room',
    maxPlayers: 2,
  }, 1_000);
  state = command(state, GUEST, {
    type: 'joinRoom',
    commandId: 'ranking-join-0001',
  }, 1_100);
  state = command(state, OWNER, {
    type: 'submitMap',
    commandId: 'ranking-map-owner',
    map: simpleMap(),
  }, 1_200);
  state = command(state, GUEST, {
    type: 'submitMap',
    commandId: 'ranking-map-guest',
    map: simpleMap(),
  }, 1_300);
  state = command(state, OWNER, {
    type: 'startMatch',
    commandId: 'ranking-start-001',
  }, 1_400);
  state = command(state, OWNER, {
    type: 'turn',
    commandId: 'ranking-turn-owner',
    action: { type: 'move', direction: 'right' },
  }, 1_500);
  state = command(state, GUEST, {
    type: 'turn',
    commandId: 'ranking-turn-guest-down',
    action: { type: 'move', direction: 'down' },
  }, 1_600);
  state = command(state, GUEST, {
    type: 'turn',
    commandId: 'ranking-turn-guest-up',
    action: { type: 'move', direction: 'up' },
  }, 1_700);
  state = command(state, GUEST, {
    type: 'turn',
    commandId: 'ranking-turn-guest-finish',
    action: { type: 'move', direction: 'right' },
  }, 1_800);
  assert.equal(state.gameState.phase, 'end');
  return state;
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

class Store {
  readonly values = new Map<string, unknown>();

  read(path: string): unknown {
    return clone(this.values.get(path) ?? null);
  }

  seed(path: string, value: unknown): void {
    this.values.set(path, clone(value));
  }

  reference(path: string): MazeAuthorityRankingTransactionReference {
    return {
      get: async () => ({ val: () => this.read(path) }),
      transaction: async (update) => {
        const current = this.read(path);
        const candidate = update(current);
        const committed = candidate !== undefined;
        if (committed) this.values.set(path, clone(candidate));
        return {
          committed,
          snapshot: { val: () => this.read(path) },
        };
      },
    };
  }
}

function dependencies(store: Store): MazeAuthorityRankingDependencies {
  return {
    getAuthorityReference: (path) => store.reference(path),
    getProfileReference: (path) => store.reference(path),
    getRankingReference: (path) => store.reference(path),
    getRankingViewReference: (path) => store.reference(path),
  };
}

test('derives a bounded Authority settlement key and terminal result only from private END state', () => {
  const state = terminalRoom();
  const key = mazeAuthorityRankingSettlementKey(ROOM_ID, 1, 1);
  assert.match(key, /^a_[a-f0-9]{64}$/u);
  assert.equal(key, mazeAuthorityRankingSettlementKey(ROOM_ID, 1, 1));
  assert.notEqual(key, mazeAuthorityRankingSettlementKey(ROOM_ID, 2, 1));

  const settlements = buildMazeAuthorityRankingSettlements(state);
  assert.deepEqual(settlements, [
    {
      settlementKey: key,
      roomId: ROOM_ID,
      generation: 1,
      matchNumber: 1,
      uid: OWNER,
      result: 'win',
      finishMoves: 1,
    },
    {
      settlementKey: key,
      roomId: ROOM_ID,
      generation: 1,
      matchNumber: 1,
      uid: GUEST,
      result: 'loss',
      finishMoves: 3,
    },
  ]);
});

test('source settlement preserves legacy totals and applies each Authority match exactly once', () => {
  const settlement = buildMazeAuthorityRankingSettlements(terminalRoom())[0];
  const first = applyMazeAuthorityRankingSettlement(
    null,
    { displayName: '방장' },
    settlement,
    2_000,
  );
  assert.equal(first.applied, true);
  assert.equal(first.row.wins, 1);
  assert.equal(first.row.played, 1);
  assert.equal(first.row.rating, MAZE_AUTHORITY_INITIAL_RATING + 20);
  assert.equal(first.row.bestMoves, 1);
  assert.equal(first.row.settledMatches[settlement.settlementKey], true);

  const replay = applyMazeAuthorityRankingSettlement(
    first.row,
    { displayName: '바뀐 이름' },
    settlement,
    9_000,
  );
  assert.equal(replay.applied, false);
  assert.deepEqual(replay.row, first.row);
});

test('coordinator settles every participant and converges a server-written public mirror', async () => {
  const store = new Store();
  const state = terminalRoom();
  store.seed(`mazeAuthority/v1/rooms/${ROOM_ID}`, state);
  store.seed(`users/${OWNER}/displayName`, '토끼 방장');
  store.seed(`users/${GUEST}/displayName`, '고양이 손님');

  const first = await syncCurrentMazeAuthorityRankingSettlement(
    ROOM_ID,
    2_000,
    dependencies(store),
  );
  assert.equal(first.terminal, true);
  assert.equal(first.participants, 2);
  assert.equal(first.applied, 2);
  assert.equal((store.read(`mazeRankings/${OWNER}`) as Record<string, unknown>).rating, 1_020);
  assert.equal((store.read(`mazeRankings/${GUEST}`) as Record<string, unknown>).rating, 988);
  const ownerView = store.read(`mazeAuthorityRankings/v1/${OWNER}`) as Record<string, unknown>;
  assert.equal(ownerView.displayName, '토끼 방장');
  assert.equal(ownerView.source, 'mazeRankings-compat-v1');
  assert.equal(ownerView.mirrorVersion, 1);
  assert.equal(ownerView.sourceSettlementCount, 1);

  const replay = await syncCurrentMazeAuthorityRankingSettlement(
    ROOM_ID,
    9_000,
    dependencies(store),
  );
  assert.equal(replay.applied, 0);
  assert.equal((store.read(`mazeRankings/${OWNER}`) as Record<string, unknown>).played, 1);
  assert.equal((store.read(`mazeRankings/${GUEST}`) as Record<string, unknown>).played, 1);
});

test('non-terminal rooms never create ranking rows', async () => {
  const store = new Store();
  const state = command(null, OWNER, {
    type: 'createRoom',
    commandId: 'ranking-open-create',
    name: 'Open room',
    maxPlayers: 2,
  }, 1_000);
  store.seed(`mazeAuthority/v1/rooms/${ROOM_ID}`, state);
  const response = await syncCurrentMazeAuthorityRankingSettlement(
    ROOM_ID,
    2_000,
    dependencies(store),
  );
  assert.equal(response.terminal, false);
  assert.equal(response.participants, 0);
  assert.equal(store.read(`mazeRankings/${OWNER}`), null);
});
