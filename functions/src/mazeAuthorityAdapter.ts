import { HttpsError, type FunctionsErrorCode } from 'firebase-functions/v2/https';
import {
  MazeAuthorityDomainError,
  parseMazeAuthorityCommand,
  reduceMazeAuthorityCommand,
  type MazeAuthorityCommand,
  type MazeAuthorityCommandResult,
  type MazeAuthorityActorProfile,
  type MazeAuthorityState,
} from './mazeAuthorityDomain';

export const MAZE_AUTHORITY_V1_ROOT = 'mazeAuthority/v1/rooms';

const MAX_UID_LENGTH = 128;
const MAX_ROOM_ID_LENGTH = 64;
const INVALID_FIREBASE_KEY = /[.#$\[\]\/\u0000-\u001F\u007F-\u009F]/u;
const SAFE_ROOM_ID = /^[A-Za-z0-9_-]+$/u;

export interface MazeAuthorityTransactionSnapshot {
  val(): unknown;
}

export interface MazeAuthorityTransactionResult {
  committed: boolean;
  snapshot: MazeAuthorityTransactionSnapshot;
}

export interface MazeAuthorityTransactionReference {
  transaction(
    update: (current: unknown) => unknown,
    onComplete?: undefined,
    applyLocally?: boolean,
  ): Promise<MazeAuthorityTransactionResult>;
}

export interface MazeAuthorityCallableRequest {
  auth?: { uid: string } | null;
  data: unknown;
}

export interface MazeAuthorityCommandResponse {
  ok: true;
  replayed: boolean;
  result: MazeAuthorityCommandResult;
}

export interface MazeAuthorityCallableDependencies {
  now(): number;
  getStateReference(path: string): MazeAuthorityTransactionReference;
  readActorProfile?(uid: string): Promise<unknown>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function validUid(value: unknown): value is string {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= MAX_UID_LENGTH
    && value.trim() === value
    && !INVALID_FIREBASE_KEY.test(value);
}

function parseActorProfile(value: unknown): MazeAuthorityActorProfile {
  const displayName = isRecord(value) && typeof value.displayName === 'string'
    ? value.displayName.trim().slice(0, 50)
    : '';
  const photoURL = isRecord(value)
    && typeof value.photoURL === 'string'
    && value.photoURL.length <= 2_048
    && /^https:\/\/lh3\.googleusercontent\.com\//u.test(value.photoURL)
    ? value.photoURL
    : undefined;
  return {
    displayName: displayName || '플레이어',
    ...(photoURL ? { photoURL } : {}),
  };
}

export function isValidMazeAuthorityRoomId(value: unknown): value is string {
  return typeof value === 'string'
    && value.length >= 8
    && value.length <= MAX_ROOM_ID_LENGTH
    && value.trim() === value
    && SAFE_ROOM_ID.test(value)
    && !INVALID_FIREBASE_KEY.test(value);
}

export function mazeAuthorityStatePath(roomId: string): string {
  if (!isValidMazeAuthorityRoomId(roomId)) {
    throw new Error('Invalid Maze Authority room id');
  }
  return `${MAZE_AUTHORITY_V1_ROOT}/${roomId}`;
}

/**
 * Produces a detached, JSON-only transaction value. RTDB may elide empty and
 * null children; parseMazeAuthorityState rehydrates that canonical shape on
 * the next read.
 */
export function serializeMazeAuthorityStateForRtdb(state: MazeAuthorityState): MazeAuthorityState {
  return JSON.parse(JSON.stringify(state)) as MazeAuthorityState;
}

function transactionFailureStatus(error: unknown): FunctionsErrorCode {
  try {
    const code = isRecord(error) && typeof error.code === 'string'
      ? error.code.toLowerCase()
      : '';
    const message = error instanceof Error ? error.message.toLowerCase() : '';
    const signal = `${code} ${message}`.replace(/[_-]+/gu, ' ');
    return /max\s*retr(?:y|i)/u.test(signal)
      || signal.includes('aborted')
      ? 'aborted'
      : 'unavailable';
  } catch {
    return 'unavailable';
  }
}

function throwDomainError(error: MazeAuthorityDomainError): never {
  throw new HttpsError(error.code, error.message, { reason: error.reason });
}

function reduceOrThrowHttps(
  current: MazeAuthorityState | null | undefined,
  uid: string,
  command: MazeAuthorityCommand,
  now: number,
  actorProfile?: MazeAuthorityActorProfile,
) {
  try {
    return reduceMazeAuthorityCommand(current, uid, command, now, actorProfile);
  } catch (error) {
    if (error instanceof MazeAuthorityDomainError) throwDomainError(error);
    throw new HttpsError('internal', 'The Maze Authority reducer failed unexpectedly.');
  }
}

export async function runMazeAuthorityCommandInTransaction(input: {
  uid: string;
  command: MazeAuthorityCommand;
  now: number;
  reference: MazeAuthorityTransactionReference;
  actorProfile?: MazeAuthorityActorProfile;
}): Promise<MazeAuthorityCommandResponse> {
  if (!validUid(input.uid) || !Number.isSafeInteger(input.now) || input.now < 0) {
    throw new HttpsError('internal', 'The Maze Authority service is not configured correctly.');
  }

  let transactionResult: MazeAuthorityTransactionResult;
  try {
    transactionResult = await input.reference.transaction((rawState) => {
      // A cold RTDB client can optimistically invoke the callback with null
      // before loading an existing remote room. Returning null starts the CAS
      // and forces a retry with the server value; undefined would abort and
      // misreport a real room as missing.
      if (rawState == null && input.command.type !== 'createRoom') return null;
      try {
        const reduction = reduceMazeAuthorityCommand(
          rawState as MazeAuthorityState | null | undefined,
          input.uid,
          input.command,
          input.now,
          input.actorProfile,
        );
        if (reduction.replayed) return undefined;
        return serializeMazeAuthorityStateForRtdb(reduction.state);
      } catch (error) {
        if (error instanceof MazeAuthorityDomainError) return undefined;
        throw error;
      }
    }, undefined, false);
  } catch (error) {
    throw new HttpsError(
      transactionFailureStatus(error),
      'The Maze Authority transaction did not complete. Retry the command.',
    );
  }

  let rawCommittedState: unknown;
  try {
    if (!transactionResult
      || typeof transactionResult.committed !== 'boolean'
      || !transactionResult.snapshot
      || typeof transactionResult.snapshot.val !== 'function') {
      throw new Error('invalid transaction result');
    }
    rawCommittedState = transactionResult.snapshot.val();
  } catch {
    throw new HttpsError('data-loss', 'The Maze Authority transaction returned an invalid result.');
  }

  const resolved = reduceOrThrowHttps(
    rawCommittedState as MazeAuthorityState | null | undefined,
    input.uid,
    input.command,
    input.now,
    input.actorProfile,
  );
  if (!resolved.replayed) {
    throw new HttpsError(
      'data-loss',
      'The committed Maze Authority state does not contain the command receipt.',
    );
  }

  return {
    ok: true,
    replayed: !transactionResult.committed,
    result: resolved.result,
  };
}

export function createMazeAuthorityCommandCallableHandler(
  dependencies: MazeAuthorityCallableDependencies,
): (request: MazeAuthorityCallableRequest) => Promise<MazeAuthorityCommandResponse> {
  return async (request) => {
    const uid = request.auth?.uid;
    if (!validUid(uid)) throw new HttpsError('unauthenticated', 'Authentication is required.');
    let command: MazeAuthorityCommand;
    try {
      command = parseMazeAuthorityCommand(request.data);
    } catch (error) {
      if (error instanceof MazeAuthorityDomainError) throwDomainError(error);
      throw new HttpsError('invalid-argument', 'The Maze Authority command is malformed.');
    }

    let now: number;
    let reference: MazeAuthorityTransactionReference;
    try {
      now = dependencies.now();
      reference = dependencies.getStateReference(mazeAuthorityStatePath(command.roomId));
    } catch {
      throw new HttpsError('internal', 'The Maze Authority service is not configured correctly.');
    }

    let actorProfile: MazeAuthorityActorProfile | undefined;
    if (dependencies.readActorProfile
      && (command.type === 'createRoom' || command.type === 'joinRoom')) {
      try {
        actorProfile = parseActorProfile(await dependencies.readActorProfile(uid));
      } catch {
        throw new HttpsError('unavailable', 'The Maze Authority player profile could not be read.');
      }
    }

    return runMazeAuthorityCommandInTransaction({ uid, command, now, reference, actorProfile });
  };
}
