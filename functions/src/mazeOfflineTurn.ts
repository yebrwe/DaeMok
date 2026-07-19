import { createHash } from 'node:crypto';
import { HttpsError } from 'firebase-functions/v2/https';
import {
  isValidMazeAuthorityRoomId,
  serializeMazeAuthorityStateForRtdb,
  type MazeAuthorityTransactionReference,
  type MazeAuthorityTransactionResult,
} from './mazeAuthorityAdapter';
import {
  MazeAuthorityDomainError,
  parseMazeAuthorityState,
  reduceMazeAuthorityOfflineTurn,
  type MazeAuthorityOfflineTurnResult,
  type MazeAuthorityState,
} from './mazeAuthorityDomain';
import {
  MazePresenceTimeoutClaimError,
  claimMazePresenceTimeout,
  isValidMazePresenceUid,
  mazePresenceLeasePath,
  releaseMazePresenceTimeoutClaim,
  type MazePresenceTransactionReference,
} from './mazePresence';

export const MAZE_OFFLINE_TURN_CALLABLE = 'mazeV1ClaimOfflineTurn' as const;

export interface MazeOfflineTurnRequest {
  roomId: string;
  targetUid: string;
  generation: number;
  leaseEpoch: number;
  turnNumber: number;
}

export interface MazeOfflineTurnCallableRequest {
  auth?: { uid: string } | null;
  data: unknown;
}

export interface MazeOfflineTurnResponse {
  ok: true;
  replayed: boolean;
  claimId: string;
  result: MazeAuthorityOfflineTurnResult;
}

export interface MazeOfflineTurnAuthorityReference extends MazeAuthorityTransactionReference {
  get(): Promise<{ val(): unknown }>;
}

export interface MazeOfflineTurnDependencies {
  now(): number;
  getAuthorityReference(path: string): MazeOfflineTurnAuthorityReference;
  getLeaseReference(path: string): MazePresenceTransactionReference;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function safePositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 1;
}

export function parseMazeOfflineTurnRequest(value: unknown): MazeOfflineTurnRequest {
  if (!isRecord(value)
    || Reflect.ownKeys(value).length !== 5
    || !isValidMazeAuthorityRoomId(value.roomId)
    || !isValidMazePresenceUid(value.targetUid)
    || !safePositiveInteger(value.generation)
    || !safePositiveInteger(value.leaseEpoch)
    || !safePositiveInteger(value.turnNumber)) {
    throw new HttpsError('invalid-argument', 'The Maze offline-turn request is malformed.');
  }
  return {
    roomId: value.roomId,
    targetUid: value.targetUid,
    generation: value.generation,
    leaseEpoch: value.leaseEpoch,
    turnNumber: value.turnNumber,
  };
}

export function mazeOfflineTurnClaimId(input: MazeOfflineTurnRequest): string {
  const digest = createHash('sha256')
    .update(
      `maze-offline-turn:v1\0${input.roomId}\0${input.generation}\0${input.targetUid}\0${input.leaseEpoch}\0${input.turnNumber}`,
      'utf8',
    )
    .digest('hex');
  return `timeout_${digest.slice(0, 48)}`;
}

function authorityPath(roomId: string): string {
  return `mazeAuthority/v1/rooms/${roomId}`;
}

function offlineTurnReceipt(
  state: MazeAuthorityState,
  claimId: string,
  targetUid: string,
  generation: number,
  turnNumber: number,
): MazeAuthorityOfflineTurnResult | null {
  const receipt = state.receipts.byId[claimId];
  if (!receipt) return null;
  if (receipt.actorId !== targetUid
    || receipt.commandType !== 'skipOfflineTurn'
    || receipt.generation !== generation
    || receipt.result.type !== 'skipOfflineTurn'
    || receipt.result.skippedPlayerId !== targetUid
    || receipt.result.turnNumber !== turnNumber + 1) {
    throw new HttpsError('data-loss', 'The Maze offline-turn receipt is inconsistent.');
  }
  return receipt.result;
}

function assertTimeoutAuthorityPreconditions(
  state: MazeAuthorityState,
  claimantUid: string,
  request: MazeOfflineTurnRequest,
): void {
  if (state.meta.generation !== request.generation) {
    throw new HttpsError('failed-precondition', 'The Maze room generation has changed.', {
      reason: 'generation-mismatch',
    });
  }
  if (state.gameState.phase !== 'play') {
    throw new HttpsError('failed-precondition', 'The Maze match is not active.', {
      reason: 'not-playing',
    });
  }
  if (!Object.prototype.hasOwnProperty.call(state.lobby.members, claimantUid)) {
    throw new HttpsError('permission-denied', 'Only a current room member can claim an offline turn.', {
      reason: 'member-required',
    });
  }
  if (state.gameState.currentTurn !== request.targetUid) {
    throw new HttpsError('failed-precondition', 'The offline player no longer owns the turn.', {
      reason: 'turn-changed',
    });
  }
  if (state.gameState.turnNumber !== request.turnNumber) {
    throw new HttpsError('failed-precondition', 'The offline turn identity has changed.', {
      reason: 'turn-number-changed',
    });
  }
  const target = state.gameState.players[request.targetUid];
  if (!target || target.finished || target.forfeited || target.hasLeft) {
    throw new HttpsError('failed-precondition', 'The offline player is no longer active.', {
      reason: 'player-inactive',
    });
  }
}

function parseState(raw: unknown): MazeAuthorityState {
  try {
    return parseMazeAuthorityState(raw);
  } catch (error) {
    const details = error instanceof MazeAuthorityDomainError ? { reason: error.reason } : undefined;
    throw new HttpsError('data-loss', 'The Maze Authority source failed validation.', details);
  }
}

function mapClaimError(error: MazePresenceTimeoutClaimError): HttpsError {
  return new HttpsError(
    error.reason === 'claim-conflict' ? 'aborted' : 'failed-precondition',
    error.reason === 'target-online'
      ? 'The turn owner has reconnected.'
      : error.reason === 'grace-active'
        ? 'The offline turn grace period is still active.'
        : error.reason === 'lease-mismatch'
          ? 'The presence lease has changed.'
          : 'Another offline-turn claim is already running.',
    { reason: error.reason },
  );
}

async function readState(reference: MazeOfflineTurnAuthorityReference): Promise<MazeAuthorityState> {
  try {
    const snapshot = await reference.get();
    if (!snapshot || typeof snapshot.val !== 'function' || snapshot.val() == null) {
      throw new HttpsError('not-found', 'The Maze Authority room does not exist.');
    }
    return parseState(snapshot.val());
  } catch (error) {
    if (error instanceof HttpsError) throw error;
    throw new HttpsError('unavailable', 'The Maze Authority source could not be read.');
  }
}

async function commitTimeoutSkip(input: {
  reference: MazeOfflineTurnAuthorityReference;
  request: MazeOfflineTurnRequest;
  claimantUid: string;
  claimId: string;
  now: number;
}): Promise<{ result: MazeAuthorityOfflineTurnResult; replayed: boolean }> {
  let transactionResult: MazeAuthorityTransactionResult;
  try {
    transactionResult = await input.reference.transaction((raw) => {
      // Force a server compare-and-swap retry when a cold RTDB client invokes
      // the transaction with an optimistic null before loading the room.
      if (raw == null) return null;
      const state = parseState(raw);
      const replay = offlineTurnReceipt(
        state,
        input.claimId,
        input.request.targetUid,
        input.request.generation,
        input.request.turnNumber,
      );
      if (replay) return undefined;
      assertTimeoutAuthorityPreconditions(state, input.claimantUid, input.request);
      const reduction = reduceMazeAuthorityOfflineTurn(
        state,
        input.request.targetUid,
        {
          type: 'skipOfflineTurn',
          commandId: input.claimId,
          roomId: input.request.roomId,
          expectedGeneration: state.meta.generation,
          expectedRevision: state.meta.revision,
          turnNumber: input.request.turnNumber,
          leaseEpoch: input.request.leaseEpoch,
        },
        input.now,
      );
      return serializeMazeAuthorityStateForRtdb(reduction.state);
    }, undefined, false);
  } catch (error) {
    if (error instanceof HttpsError) throw error;
    if (error instanceof MazeAuthorityDomainError) {
      throw new HttpsError(error.code, error.message, { reason: error.reason });
    }
    throw new HttpsError('unavailable', 'The Maze offline-turn transaction did not complete.');
  }
  if (!transactionResult?.snapshot || typeof transactionResult.snapshot.val !== 'function') {
    throw new HttpsError('data-loss', 'The Maze offline-turn transaction returned invalid data.');
  }
  const committed = parseState(transactionResult.snapshot.val());
  const result = offlineTurnReceipt(
    committed,
    input.claimId,
    input.request.targetUid,
    input.request.generation,
    input.request.turnNumber,
  );
  if (!result) throw new HttpsError('data-loss', 'The Maze offline-turn receipt was not committed.');
  return { result, replayed: !transactionResult.committed };
}

export function createMazeOfflineTurnCallableHandler(
  dependencies: MazeOfflineTurnDependencies,
): (request: MazeOfflineTurnCallableRequest) => Promise<MazeOfflineTurnResponse> {
  return async (callableRequest) => {
    const claimantUid = callableRequest.auth?.uid;
    if (!isValidMazePresenceUid(claimantUid)) {
      throw new HttpsError('unauthenticated', 'Authentication is required.');
    }
    const request = parseMazeOfflineTurnRequest(callableRequest.data);
    if (request.targetUid === claimantUid) {
      throw new HttpsError('invalid-argument', 'A player cannot claim their own offline turn.');
    }
    const now = dependencies.now();
    if (!Number.isSafeInteger(now) || now < 0) {
      throw new HttpsError('internal', 'The Maze offline-turn service is misconfigured.');
    }
    const claimId = mazeOfflineTurnClaimId(request);
    const authorityReference = dependencies.getAuthorityReference(authorityPath(request.roomId));
    const leaseReference = dependencies.getLeaseReference(
      mazePresenceLeasePath(request.roomId, request.targetUid),
    );

    const initial = await readState(authorityReference);
    const replay = offlineTurnReceipt(
      initial,
      claimId,
      request.targetUid,
      request.generation,
      request.turnNumber,
    );
    if (replay) {
      await releaseMazePresenceTimeoutClaim(leaseReference, {
        roomId: request.roomId,
        targetUid: request.targetUid,
        claimId,
      });
      return { ok: true, replayed: true, claimId, result: replay };
    }
    assertTimeoutAuthorityPreconditions(initial, claimantUid, request);

    try {
      await claimMazePresenceTimeout(leaseReference, {
        roomId: request.roomId,
        targetUid: request.targetUid,
        claimantUid,
        generation: request.generation,
        epoch: request.leaseEpoch,
        claimId,
        now,
      });
    } catch (error) {
      if (error instanceof MazePresenceTimeoutClaimError) throw mapClaimError(error);
      throw new HttpsError('unavailable', 'The Maze offline-turn lease could not be claimed.');
    }

    try {
      const committed = await commitTimeoutSkip({
        reference: authorityReference,
        request,
        claimantUid,
        claimId,
        now,
      });
      return { ok: true, replayed: committed.replayed, claimId, result: committed.result };
    } finally {
      await releaseMazePresenceTimeoutClaim(leaseReference, {
        roomId: request.roomId,
        targetUid: request.targetUid,
        claimId,
        claimedBy: claimantUid,
        epoch: request.leaseEpoch,
      });
    }
  };
}
