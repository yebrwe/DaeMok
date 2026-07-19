export const MAZE_AUTHORITY_ROOM_PREFIX = 'mz1_' as const;

/**
 * Rollback controls only where a newly-created room is written. Existing
 * Authority room IDs always stay on Authority so they can finish safely.
 */
export function mazeAuthorityNewRoomsEnabled(
  configuredValue = process.env.NEXT_PUBLIC_MAZE_AUTHORITY_NEW_ROOMS,
): boolean {
  return configuredValue?.trim() !== '0';
}

export function isMazeAuthorityRoomId(roomId: unknown): roomId is string {
  return typeof roomId === 'string'
    && /^mz1_[a-f0-9]{32}$/u.test(roomId);
}
