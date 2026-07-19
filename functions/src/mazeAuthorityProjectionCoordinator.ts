import { isDeepStrictEqual } from 'node:util';
import { HttpsError } from 'firebase-functions/v2/https';
import {
  mazeAuthorityStatePath,
  type MazeAuthorityCallableRequest,
} from './mazeAuthorityAdapter';
import {
  MazeAuthorityDomainError,
  parseMazeAuthorityState,
  type MazeAuthorityState,
} from './mazeAuthorityDomain';
import {
  finalizeMazeAuthorityViewProjection,
  isValidMazeAuthorityViewUid,
  syncMazeAuthorityViewProjection,
  type MazeAuthorityProjectionDependencies,
  type MazeAuthorityProjectionResponse,
} from './mazeAuthorityProjection';

export const MAZE_AUTHORITY_PROJECTION_MAX_CONVERGENCE_ATTEMPTS = 4;

export interface MazeAuthoritySourceSnapshot {
  val(): unknown;
}

export interface MazeAuthoritySourceReference {
  get(): Promise<MazeAuthoritySourceSnapshot>;
}

export interface MazeAuthorityProjectionCoordinatorDependencies
  extends MazeAuthorityProjectionDependencies {
  getAuthorityReference(path: string): MazeAuthoritySourceReference;
}

export interface MazeAuthorityProjectionCoordinatorResponse
  extends MazeAuthorityProjectionResponse {
  convergenceAttempts: number;
}

export interface MazeAuthoritySyncResponse {
  ok: true;
  roomId: string;
  generation: number;
  revision: number;
  convergenceAttempts: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isAbortedHttpsError(error: unknown): error is HttpsError {
  try {
    return error instanceof HttpsError && error.code === 'aborted';
  } catch {
    return false;
  }
}

function compareSourceVersion(left: MazeAuthorityState, right: MazeAuthorityState): -1 | 0 | 1 {
  if (left.meta.generation !== right.meta.generation) {
    return left.meta.generation < right.meta.generation ? -1 : 1;
  }
  if (left.meta.revision === right.meta.revision) return 0;
  return left.meta.revision < right.meta.revision ? -1 : 1;
}

async function readValidatedSource(
  roomId: string,
  dependencies: MazeAuthorityProjectionCoordinatorDependencies,
): Promise<MazeAuthorityState> {
  let read: MazeAuthoritySourceReference['get'] | null = null;
  try {
    const reference = dependencies.getAuthorityReference(mazeAuthorityStatePath(roomId));
    if (typeof reference?.get === 'function') read = reference.get.bind(reference);
  } catch {
    throw new HttpsError('unavailable', 'The Maze Authority source could not be read.');
  }
  if (!read) throw new HttpsError('internal', 'The Maze Authority projection service is misconfigured.');

  let rawState: unknown;
  try {
    const snapshot = await read();
    if (!snapshot || typeof snapshot.val !== 'function') {
      throw new HttpsError('data-loss', 'The Maze Authority source returned an invalid snapshot.');
    }
    rawState = snapshot.val();
  } catch (error) {
    if (error instanceof HttpsError) throw error;
    throw new HttpsError('unavailable', 'The Maze Authority source could not be read.');
  }
  if (rawState == null) throw new HttpsError('not-found', 'The Maze Authority room does not exist.');

  try {
    const state = parseMazeAuthorityState(rawState);
    if (state.meta.roomId !== roomId) {
      throw new HttpsError('data-loss', 'The Maze Authority source belongs to another room.');
    }
    return state;
  } catch (error) {
    if (error instanceof HttpsError) throw error;
    if (error instanceof MazeAuthorityDomainError) {
      throw new HttpsError('data-loss', 'The Maze Authority source failed validation.', {
        reason: error.reason,
      });
    }
    throw new HttpsError('data-loss', 'The Maze Authority source failed validation.');
  }
}

export async function syncCurrentMazeAuthorityViewProjection(
  roomId: string,
  dependencies: MazeAuthorityProjectionCoordinatorDependencies,
): Promise<MazeAuthorityProjectionCoordinatorResponse> {
  let source = await readValidatedSource(roomId, dependencies);

  for (
    let attempt = 1;
    attempt <= MAZE_AUTHORITY_PROJECTION_MAX_CONVERGENCE_ATTEMPTS;
    attempt += 1
  ) {
    let projection: MazeAuthorityProjectionResponse | null = null;
    let abortedProjection: HttpsError | null = null;
    try {
      projection = await syncMazeAuthorityViewProjection(source, dependencies);
    } catch (error) {
      if (!isAbortedHttpsError(error)) throw error;
      abortedProjection = error;
    }

    const latestBeforeFinalization = await readValidatedSource(roomId, dependencies);
    const versionOrder = compareSourceVersion(latestBeforeFinalization, source);
    if (versionOrder < 0) {
      throw new HttpsError('data-loss', 'The Maze Authority source version regressed.');
    }
    if (versionOrder === 0 && !isDeepStrictEqual(latestBeforeFinalization, source)) {
      throw new HttpsError(
        'data-loss',
        'The Maze Authority source changed without advancing its revision.',
      );
    }
    if (versionOrder === 0) {
      if (abortedProjection) throw abortedProjection;
      const expectedWrites = source.lobby.status === 'closed'
        ? 0
        : Object.keys(source.lobby.members).length + 1;
      if (!projection
        || projection.roomId !== source.meta.roomId
        || projection.generation !== source.meta.generation
        || projection.revision !== source.meta.revision
        || projection.writes.length !== expectedWrites) {
        throw new HttpsError('data-loss', 'The Maze Authority projection is inconsistent.');
      }

      let abortedFinalization: HttpsError | null = null;
      try {
        const finalization = await finalizeMazeAuthorityViewProjection(source, dependencies);
        if (finalization.roomId !== source.meta.roomId
          || finalization.generation !== source.meta.generation
          || finalization.revision !== source.meta.revision
          || finalization.closed !== (source.lobby.status === 'closed')) {
          throw new HttpsError('data-loss', 'The Maze Authority cleanup is inconsistent.');
        }
      } catch (error) {
        if (!isAbortedHttpsError(error)) throw error;
        abortedFinalization = error;
      }

      const latestAfterFinalization = await readValidatedSource(roomId, dependencies);
      const finalVersionOrder = compareSourceVersion(latestAfterFinalization, source);
      if (finalVersionOrder < 0) {
        throw new HttpsError('data-loss', 'The Maze Authority source version regressed.');
      }
      if (finalVersionOrder === 0 && !isDeepStrictEqual(latestAfterFinalization, source)) {
        throw new HttpsError(
          'data-loss',
          'The Maze Authority source changed without advancing its revision.',
        );
      }
      if (finalVersionOrder === 0) {
        if (abortedFinalization) throw abortedFinalization;
        return { ...projection, convergenceAttempts: attempt };
      }
      if (attempt === MAZE_AUTHORITY_PROJECTION_MAX_CONVERGENCE_ATTEMPTS) {
        throw new HttpsError('aborted', 'The Maze Authority projection did not converge.');
      }
      source = latestAfterFinalization;
      continue;
    }

    if (attempt === MAZE_AUTHORITY_PROJECTION_MAX_CONVERGENCE_ATTEMPTS) {
      throw new HttpsError('aborted', 'The Maze Authority projection did not converge.');
    }
    source = latestBeforeFinalization;
  }

  throw new HttpsError('aborted', 'The Maze Authority projection did not converge.');
}

export async function runMazeAuthorityCommandWithProjection<T>(input: {
  roomId: string;
  runCommand(): Promise<T>;
}, dependencies: MazeAuthorityProjectionCoordinatorDependencies): Promise<T> {
  const response = await input.runCommand();
  await syncCurrentMazeAuthorityViewProjection(input.roomId, dependencies);
  return response;
}

function parseSyncRoomId(value: unknown): string {
  if (!isRecord(value)
    || Reflect.ownKeys(value).length !== 1
    || typeof value.roomId !== 'string') {
    throw new HttpsError('invalid-argument', 'The Maze Authority sync request is malformed.');
  }
  try {
    mazeAuthorityStatePath(value.roomId);
  } catch {
    throw new HttpsError('invalid-argument', 'The Maze Authority room id is malformed.');
  }
  return value.roomId;
}

export function createMazeAuthoritySyncCallableHandler(
  dependencies: MazeAuthorityProjectionCoordinatorDependencies,
): (request: MazeAuthorityCallableRequest) => Promise<MazeAuthoritySyncResponse> {
  return async (request) => {
    if (!isValidMazeAuthorityViewUid(request.auth?.uid)) {
      throw new HttpsError('unauthenticated', 'Authentication is required.');
    }
    const roomId = parseSyncRoomId(request.data);
    const projection = await syncCurrentMazeAuthorityViewProjection(roomId, dependencies);
    return {
      ok: true,
      roomId: projection.roomId,
      generation: projection.generation,
      revision: projection.revision,
      convergenceAttempts: projection.convergenceAttempts,
    };
  };
}
