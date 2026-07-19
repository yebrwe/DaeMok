import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { HttpsError } from 'firebase-functions/v2/https';
import * as deployed from './index';

const MAZE_AUTHORITY_EXPORT_NAMES = [
  'mazeV1Command',
  'mazeV1SyncRoom',
  'mazeV1ClaimOfflineTurn',
] as const;

interface CallableExport {
  __endpoint: {
    platform: string;
    region: string[];
    availableMemoryMb: number;
    timeoutSeconds: number;
    maxInstances: number;
    concurrency: number;
    secretEnvironmentVariables?: Array<{ key: string }>;
    callableTrigger: Record<string, unknown>;
  };
  run(request: unknown): Promise<unknown>;
}

interface DatabaseTriggerExport {
  __endpoint: {
    platform: string;
    region: string[];
    availableMemoryMb: number;
    maxInstances: number;
    secretEnvironmentVariables?: Array<{ key: string }>;
    eventTrigger: {
      eventType: string;
      eventFilters: { resource: string };
      retry: boolean;
    };
  };
}

function mazeCallable(name: (typeof MAZE_AUTHORITY_EXPORT_NAMES)[number]): CallableExport {
  return deployed[name] as unknown as CallableExport;
}

async function rejectsHttpsError(
  promise: Promise<unknown>,
  code: HttpsError['code'],
): Promise<void> {
  await assert.rejects(promise, (error: unknown) => {
    assert.ok(error instanceof HttpsError);
    assert.equal(error.code, code);
    return true;
  });
}

test('exports only Maze Authority endpoints', () => {
  assert.deepEqual(Object.keys(deployed).sort(), [
    'mazeV1ClaimOfflineTurn',
    'mazeV1Command',
    'mazeV1SyncRoom',
    'syncMazeV1Presence',
  ]);
});

test('exports Maze Authority callables and presence repair with the production contract', () => {
  for (const name of MAZE_AUTHORITY_EXPORT_NAMES) {
    const endpoint = mazeCallable(name).__endpoint;
    assert.equal(endpoint.platform, 'gcfv2', name);
    assert.deepEqual(endpoint.region, ['asia-southeast1'], name);
    assert.equal(endpoint.availableMemoryMb, 256, name);
    assert.equal(endpoint.timeoutSeconds, 30, name);
    assert.equal(endpoint.maxInstances, 20, name);
    assert.equal(endpoint.concurrency, 20, name);
    assert.equal(endpoint.secretEnvironmentVariables, undefined, name);
    assert.deepEqual(endpoint.callableTrigger, {}, name);
  }

  const presence = deployed.syncMazeV1Presence as unknown as DatabaseTriggerExport;
  assert.equal(presence.__endpoint.platform, 'gcfv1');
  assert.deepEqual(presence.__endpoint.region, ['asia-southeast1']);
  assert.equal(presence.__endpoint.availableMemoryMb, 256);
  assert.equal(presence.__endpoint.maxInstances, 20);
  assert.equal(presence.__endpoint.eventTrigger.retry, true);
  assert.equal(
    presence.__endpoint.eventTrigger.eventFilters.resource,
    'projects/_/instances/daemok-155c1-default-rtdb/refs/mazePresence/v1/rooms/{roomId}/{uid}/{connectionId}',
  );
});

test('Maze command, repair, and offline-skip exports converge ranking, views, and presence', () => {
  const source = readFileSync(join(__dirname, '..', 'src', 'index.ts'), 'utf8');
  assert.doesNotMatch(source, /adventure/i);
  const commandWrapper = source.slice(
    source.indexOf('async function runProjectedMazeAuthorityCommand'),
    source.indexOf('export const mazeV1Command'),
  );
  assert.match(commandWrapper, /await mazeAuthorityCommandHandler/);
  assert.match(commandWrapper, /await syncCurrentMazeAuthorityRankingSettlement/);
  assert.match(commandWrapper, /await syncCurrentMazeAuthorityViewProjection/);
  assert.match(
    commandWrapper,
    /response\.result\.type === 'restartMatch'[\s\S]*await clearOldMazePresenceGenerations[\s\S]*response\.result\.type === 'closeRoom'[\s\S]*await clearMazePresenceRoom[\s\S]*await syncCurrentMazeAuthorityViewProjection/,
  );
  assert.match(
    commandWrapper,
    /await syncCurrentMazeAuthorityViewProjection[\s\S]*response\.result\.type === 'leaveRoom'[\s\S]*await syncMazePresenceLease/,
  );

  const exports = source.slice(source.indexOf('export const mazeV1Command'));
  assert.match(exports, /export const mazeV1SyncRoom[\s\S]*syncCurrentMazeAuthorityRankingSettlement/);
  assert.match(exports, /export const mazeV1ClaimOfflineTurn[\s\S]*mazeOfflineTurnHandler/);
  assert.match(exports, /mazeV1ClaimOfflineTurn[\s\S]*syncCurrentMazeAuthorityViewProjection/);
  assert.match(exports, /mazeV1ClaimOfflineTurn[\s\S]*syncMazePresenceLease/);
});

test('Maze callable handlers reject missing authentication before database access', async () => {
  for (const name of MAZE_AUTHORITY_EXPORT_NAMES) {
    await rejectsHttpsError(
      mazeCallable(name).run({ data: {}, auth: null }),
      'unauthenticated',
    );
  }
});
