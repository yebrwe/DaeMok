import { getApps, initializeApp } from 'firebase-admin/app';
import { getDatabase } from 'firebase-admin/database';
import { logger } from 'firebase-functions';
import * as functions from 'firebase-functions/v1';
import {
  HttpsError,
  onCall,
  type CallableOptions,
  type CallableRequest,
} from 'firebase-functions/v2/https';
import {
  createMazeAuthorityCommandCallableHandler,
  isValidMazeAuthorityRoomId,
  type MazeAuthorityCallableRequest,
  type MazeAuthorityCommandResponse,
} from './mazeAuthorityAdapter';
import {
  createMazeAuthoritySyncCallableHandler,
  syncCurrentMazeAuthorityViewProjection,
  type MazeAuthorityProjectionCoordinatorDependencies,
} from './mazeAuthorityProjectionCoordinator';
import {
  syncCurrentMazeAuthorityRankingSettlement,
  type MazeAuthorityRankingDependencies,
} from './mazeAuthorityRanking';
import {
  isValidMazePresenceUid,
  retainMazePresenceRoomGeneration,
  syncMazePresenceLease,
  type MazePresenceDependencies,
} from './mazePresence';
import {
  createMazeOfflineTurnCallableHandler,
  type MazeOfflineTurnCallableRequest,
} from './mazeOfflineTurn';

if (getApps().length === 0) initializeApp();

const DATABASE_FUNCTION_REGION = process.env.FUNCTIONS_EMULATOR === 'true'
  ? 'us-central1'
  : 'asia-southeast1';
const MAZE_AUTHORITY_CALLABLE_OPTIONS: CallableOptions = {
  region: 'asia-southeast1',
  memory: '256MiB',
  timeoutSeconds: 30,
  maxInstances: 20,
  concurrency: 20,
  enforceAppCheck: process.env.FUNCTIONS_EMULATOR !== 'true',
  consumeAppCheckToken: false,
};

const mazeProjectionDependencies: MazeAuthorityProjectionCoordinatorDependencies = {
  getAuthorityReference: (path) => getDatabase().ref(path),
  getViewReference: (path) => getDatabase().ref(path),
};

const mazeRankingDependencies: MazeAuthorityRankingDependencies = {
  getAuthorityReference: (path) => getDatabase().ref(path),
  getProfileReference: (path) => getDatabase().ref(path),
  getRankingReference: (path) => getDatabase().ref(path),
  getRankingViewReference: (path) => getDatabase().ref(path),
};

const mazePresenceDependencies: MazePresenceDependencies = {
  getConnectionsReference: (path) => getDatabase().ref(path),
  getPublicRoomReference: (path) => getDatabase().ref(path),
  getLeaseReference: (path) => getDatabase().ref(path),
  getStatusReference: (path) => getDatabase().ref(path),
};

const mazeAuthorityCommandHandler = createMazeAuthorityCommandCallableHandler({
  now: () => Date.now(),
  getStateReference: (path) => getDatabase().ref(path),
  readActorProfile: async (uid) => {
    const snapshot = await getDatabase().ref(`users/${uid}`).get();
    const value = snapshot.val();
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return {};
    const profile = value as Record<string, unknown>;
    return {
      displayName: profile.displayName,
      photoURL: profile.photoURL,
    };
  },
});
const mazeAuthoritySyncHandler = createMazeAuthoritySyncCallableHandler(
  mazeProjectionDependencies,
);
const mazeOfflineTurnHandler = createMazeOfflineTurnCallableHandler({
  now: () => Date.now(),
  getAuthorityReference: (path) => getDatabase().ref(path),
  getLeaseReference: (path) => getDatabase().ref(path),
});

function mazeAdapterRequest(request: CallableRequest<unknown>): MazeAuthorityCallableRequest {
  return {
    auth: request.auth ? { uid: request.auth.uid } : null,
    data: request.data,
  };
}

function mazeOfflineAdapterRequest(
  request: CallableRequest<unknown>,
): MazeOfflineTurnCallableRequest {
  return {
    auth: request.auth ? { uid: request.auth.uid } : null,
    data: request.data,
  };
}

async function clearMazePresenceRoom(roomId: string): Promise<void> {
  if (!isValidMazeAuthorityRoomId(roomId)) {
    throw new HttpsError('internal', 'The Maze presence cleanup target is invalid.');
  }
  await Promise.all([
    getDatabase().ref(`mazePresence/v1/rooms/${roomId}`).remove(),
    getDatabase().ref(`mazePresence/v1/leases/${roomId}`).remove(),
    getDatabase().ref(`mazePresence/v1/status/${roomId}`).remove(),
  ]);
}

async function clearOldMazePresenceGenerations(
  roomId: string,
  generation: number,
): Promise<void> {
  if (!isValidMazeAuthorityRoomId(roomId)
    || !Number.isSafeInteger(generation)
    || generation < 1) {
    throw new HttpsError('internal', 'The Maze presence generation cleanup is invalid.');
  }
  await Promise.all([
    getDatabase().ref(`mazePresence/v1/rooms/${roomId}`).transaction((current) => (
      retainMazePresenceRoomGeneration(current, generation, true)
    ), undefined, false),
    getDatabase().ref(`mazePresence/v1/leases/${roomId}`).transaction((current) => (
      retainMazePresenceRoomGeneration(current, generation, false)
    ), undefined, false),
    getDatabase().ref(`mazePresence/v1/status/${roomId}`).transaction((current) => (
      retainMazePresenceRoomGeneration(current, generation, false)
    ), undefined, false),
  ]);
}

async function runProjectedMazeAuthorityCommand(
  request: CallableRequest<unknown>,
): Promise<MazeAuthorityCommandResponse> {
  const rawCommand = request.data;
  if (rawCommand !== null
    && typeof rawCommand === 'object'
    && !Array.isArray(rawCommand)
    && ('type' in rawCommand)
    && ('roomId' in rawCommand)
    && (rawCommand.type === 'restartMatch' || rawCommand.type === 'closeRoom')
    && typeof rawCommand.roomId === 'string') {
    // END data is intentionally removed by restart/close. Settle every
    // participant from the protected terminal source before that CAS mutation.
    await syncCurrentMazeAuthorityRankingSettlement(
      rawCommand.roomId,
      Date.now(),
      mazeRankingDependencies,
    );
  }
  const response = await mazeAuthorityCommandHandler(mazeAdapterRequest(request));
  await syncCurrentMazeAuthorityRankingSettlement(
    response.result.roomId,
    Date.now(),
    mazeRankingDependencies,
  );
  if (response.result.type === 'restartMatch') {
    // Keep only already-reregistered rows from this generation. This remains
    // idempotent if a successful callable response is lost and retried.
    await clearOldMazePresenceGenerations(
      response.result.roomId,
      response.result.generation,
    );
  } else if (response.result.type === 'closeRoom') {
    await clearMazePresenceRoom(response.result.roomId);
  }
  await syncCurrentMazeAuthorityViewProjection(
    response.result.roomId,
    mazeProjectionDependencies,
  );
  if (response.result.type === 'leaveRoom' && request.auth?.uid) {
    // Projection now proves the actor is no longer a member, so the coordinator
    // removes their lease/status instead of publishing a stale offline row.
    await syncMazePresenceLease({
      roomId: response.result.roomId,
      uid: request.auth.uid,
      now: Date.now(),
    }, mazePresenceDependencies);
  }
  return response;
}

export const mazeV1Command = onCall(
  MAZE_AUTHORITY_CALLABLE_OPTIONS,
  runProjectedMazeAuthorityCommand,
);

export const mazeV1SyncRoom = onCall(
  MAZE_AUTHORITY_CALLABLE_OPTIONS,
  async (request) => {
    const response = await mazeAuthoritySyncHandler(mazeAdapterRequest(request));
    await syncCurrentMazeAuthorityRankingSettlement(
      response.roomId,
      Date.now(),
      mazeRankingDependencies,
    );
    return response;
  },
);

export const mazeV1ClaimOfflineTurn = onCall(
  MAZE_AUTHORITY_CALLABLE_OPTIONS,
  async (request) => {
    const response = await mazeOfflineTurnHandler(mazeOfflineAdapterRequest(request));
    await syncCurrentMazeAuthorityRankingSettlement(
      response.result.roomId,
      Date.now(),
      mazeRankingDependencies,
    );
    await syncCurrentMazeAuthorityViewProjection(
      response.result.roomId,
      mazeProjectionDependencies,
    );
    const data = request.data as { targetUid: string };
    await syncMazePresenceLease({
      roomId: response.result.roomId,
      uid: data.targetUid,
      now: Date.now(),
    }, mazePresenceDependencies);
    return response;
  },
);

export const syncMazeV1Presence = functions
  .region(DATABASE_FUNCTION_REGION)
  .runWith({
    failurePolicy: true,
    memory: '256MB',
    maxInstances: 20,
  })
  .database
  .instance('daemok-155c1-default-rtdb')
  .ref('/mazePresence/v1/rooms/{roomId}/{uid}/{connectionId}')
  .onWrite(async (_change, context) => {
    const { roomId, uid } = context.params;
    if (!isValidMazeAuthorityRoomId(roomId) || !isValidMazePresenceUid(uid)) {
      logger.warn('Ignored invalid Maze presence repair identity');
      return null;
    }
    await syncMazePresenceLease(
      { roomId, uid, now: Date.now() },
      mazePresenceDependencies,
    );
    return null;
  });
