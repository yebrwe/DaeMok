import type { CollisionWall, GameState } from '@/types/game';

function withoutPrivateMarker(collision: CollisionWall): CollisionWall {
  const sharedCollision = { ...collision };
  delete sharedCollision.identifiedAsFake;
  return sharedCollision;
}

export function stripLegacyPrivateCollisionMarkers(
  collisions: readonly CollisionWall[]
): CollisionWall[] {
  return collisions.map(withoutPrivateMarker);
}

/**
 * Legacy rooms write the turn reducer result directly to a member-readable RTDB
 * node. Insight knowledge must never cross that shared boundary.
 */
export function sanitizeLegacyGameStateForSharedWrite(state: GameState): GameState {
  const collisionWalls = state.collisionWalls;
  if (!collisionWalls) return { ...state };

  return {
    ...state,
    collisionWalls: Array.isArray(collisionWalls)
      ? stripLegacyPrivateCollisionMarkers(collisionWalls)
      : Object.fromEntries(
          Object.entries(collisionWalls).map(([key, collision]) => [
            key,
            withoutPrivateMarker(collision),
          ])
        ),
  };
}

export function legacyPrivateCollisionKey(
  collision: Pick<CollisionWall, 'mapOwnerId' | 'position' | 'direction'>
): string {
  return [
    collision.mapOwnerId,
    collision.position.row,
    collision.position.col,
    collision.direction,
  ].join(':');
}

/**
 * Rebuilds private insight markers only for the local runner. Any marker that
 * arrived through an old shared room snapshot is stripped first.
 */
export function projectLegacyCollisionsForLocalRunner(
  collisions: readonly CollisionWall[],
  runnerId: string,
  mapOwnerId: string,
  identifiedFakeWalls: ReadonlySet<string>
): CollisionWall[] {
  return collisions.map((collision) => {
    const sharedCollision = withoutPrivateMarker(collision);
    return collision.playerId === runnerId &&
      collision.mapOwnerId === mapOwnerId &&
      identifiedFakeWalls.has(legacyPrivateCollisionKey(collision))
      ? { ...sharedCollision, identifiedAsFake: true }
      : sharedCollision;
  });
}

/**
 * A stale legacy tab can still write the pre-sanitizer reducer message into the
 * shared room. Hide only activation/progress wording at the read boundary;
 * the real wake-up return message remains visible.
 */
export function sanitizeLegacyHiddenIllusionMessage(
  message: string
): string {
  if (!message.includes('환영벽을 통과했습니다')
    && !message.includes('환영 속에서 한 칸 이동했습니다')) return message;

  const poisonPrefix = message.match(/^(\uC911\uB3C5\uC73C\uB85C .*? \uBC29\uD5A5\uC73C\uB85C \uB4A4\uD2C0\uB838\uC2B5\uB2C8\uB2E4\. )/u)?.[1] || '';
  const detail = message.slice(poisonPrefix.length);
  const runnerName = detail.match(/^(.+?)\uAC00 \uD658\uC601 \uC18D\uC5D0\uC11C \uD55C \uCE78 \uC774\uB3D9\uD588\uC2B5\uB2C8\uB2E4\.$/u)?.[1]
    || '플레이어';
  return `${poisonPrefix}${runnerName}가 한 칸 이동했습니다.`;
}
