import type {
  MazeAuthorityGameStateView,
  MazeAuthorityMapView,
  MazeAuthorityPlayerView,
} from '@/lib/mazeAuthorityClient';
import type { GameMap } from '@/types/game';
import type { LiveBoardEntry } from '@/components/LiveBoardGrid';

export function isFullMazeAuthorityMap(map: MazeAuthorityMapView): map is GameMap {
  return 'rulesVersion' in map
    && Array.isArray(map.obstacles)
    && ('items' in map || 'item' in map);
}

export function materializeMazeAuthorityBoard(map: MazeAuthorityMapView): GameMap {
  if (isFullMazeAuthorityMap(map)) return map;
  return {
    rulesVersion: 3,
    startPosition: { ...map.startPosition },
    endPosition: { ...map.endPosition },
    obstacles: [],
    items: [],
    skillLoadout: 'scoutPulse',
  };
}

function playerName(player: MazeAuthorityPlayerView | undefined): string {
  return player?.displayName?.trim() || '플레이어';
}

function consumedRecord(
  consumed: Record<number, boolean> | boolean | undefined,
): Record<number, boolean> | null {
  if (consumed == null || typeof consumed === 'boolean') return null;
  return consumed;
}

export function buildMazeAuthorityLiveBoards(input: {
  gameState: MazeAuthorityGameStateView;
  viewerUid: string | null;
}): LiveBoardEntry[] {
  const { gameState, viewerUid } = input;
  return gameState.turnOrder.flatMap((runnerId): LiveBoardEntry[] => {
    const runner = gameState.players[runnerId];
    const mapOwnerId = gameState.assignments[runnerId];
    const projectedMap = mapOwnerId ? gameState.maps[mapOwnerId] : null;
    if (!runner?.position || !mapOwnerId || !projectedMap) return [];
    const mapOwner = gameState.players[mapOwnerId];
    const itemState = gameState.itemState[mapOwnerId];
    return [{
      runnerId,
      runnerName: playerName(runner),
      runnerKind: 'human',
      runnerPhotoURL: runner.photoURL ?? null,
      mapOwnerId,
      mapOwnerName: playerName(mapOwner),
      map: materializeMazeAuthorityBoard(projectedMap),
      position: { ...runner.position },
      moves: runner.moves ?? 0,
      finished: runner.finished === true,
      finishMoves: runner.finishMoves ?? null,
      forfeited: runner.forfeited === true,
      collisions: gameState.collisionWalls,
      itemsConsumed: consumedRecord(itemState?.consumed),
      itemActiveWalls: itemState?.activeWalls ?? null,
      itemPhaseOpen: itemState?.phaseOpen ?? null,
      revealedWalls: gameState.revealedWallsByPlayer[runnerId] ?? [],
      revealObstacles: isFullMazeAuthorityMap(projectedMap) && viewerUid === mapOwnerId,
      revealMapSecrets: isFullMazeAuthorityMap(projectedMap) && viewerUid === mapOwnerId,
      smokeAffected: !!gameState.visionEffectsByPlayer[runnerId],
      visionObscured: !!gameState.visionEffectsByPlayer[runnerId],
      pawnColor: runnerId === viewerUid ? '#4e9ad8' : '#f08b78',
    }];
  });
}
