import type {
  MazeAuthorityGameStateView,
  MazeAuthorityMapView,
  MazeAuthorityPlayerView,
  MazeAuthorityWormholeRunView,
} from '@/lib/mazeAuthorityClient';
import { MAZE_AUTHORITY_RULES_VERSION } from '@/lib/mazeAuthorityClient';
import { GamePhase, type GameMap, type WormholeRunState } from '@/types/game';
import type { LiveBoardEntry } from '@/components/LiveBoardGrid';

export function isFullMazeAuthorityMap(map: MazeAuthorityMapView): map is GameMap {
  return 'rulesVersion' in map
    && Array.isArray(map.obstacles)
    && ('items' in map || 'item' in map);
}

export function materializeMazeAuthorityBoard(map: MazeAuthorityMapView): GameMap {
  if (isFullMazeAuthorityMap(map)) return map;
  return {
    rulesVersion: MAZE_AUTHORITY_RULES_VERSION,
    startPosition: { ...map.startPosition },
    endPosition: { ...map.endPosition },
    obstacles: [],
    items: [],
    skillLoadout: 'scoutPulse',
    runnerGear: 'none',
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

function materializeAuthorityWormholeRun(
  run: MazeAuthorityWormholeRunView,
  revealObstacles: boolean,
): WormholeRunState {
  if ('orientation' in run) {
    return {
      mapOwnerId: run.mapOwnerId,
      itemIndex: run.itemIndex,
      position: { ...run.position },
      challenge: {
        version: 2,
        boardSize: 4,
        startPosition: { ...run.challenge.startPosition },
        endPosition: { ...run.challenge.endPosition },
        blockedCells: run.challenge.blockedCells.map((position) => ({ ...position })),
        initialOrientation: run.challenge.initialOrientation,
        targetTop: run.challenge.targetTop,
      },
      enteredAtTurn: run.enteredAtTurn,
      orientation: run.orientation,
      actionsTaken: run.actionsTaken,
    };
  }
  return {
    mapOwnerId: run.mapOwnerId,
    itemIndex: run.itemIndex,
    position: { ...run.position },
    challenge: {
      version: 1,
      startPosition: { ...run.challenge.startPosition },
      endPosition: { ...run.challenge.endPosition },
      seals: run.challenge.seals.map((seal) => ({ ...seal })),
      // Active Authority boards only learn walls through discoveredWalls.
      obstacles: revealObstacles
        ? (run.challenge.obstacles ?? []).map((wall) => ({
            position: { ...wall.position },
            direction: wall.direction,
          }))
        : [],
    },
    enteredAtTurn: run.enteredAtTurn,
    ...(run.activatedSeals
      ? { activatedSeals: { ...run.activatedSeals } }
      : {}),
    ...(run.discoveredWalls
      ? {
          discoveredWalls: run.discoveredWalls.map((wall) => ({
            position: { ...wall.position },
            direction: wall.direction,
          })),
        }
      : {}),
  };
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
    const privateVisionEffect = runnerId === viewerUid
      ? gameState.visionEffectsByPlayer[runnerId]
      : null;
    const privatePoisonEffect = runnerId === viewerUid
      ? gameState.poisonEffectsByPlayer[runnerId]
      : null;
    const wormholeRun = gameState.wormholeRunsByPlayer[runnerId];
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
      smokeAffected: privateVisionEffect?.type === 'smoke',
      visionObscured: privateVisionEffect?.type === 'smoke',
      fireAffected: privateVisionEffect?.type === 'fire',
      heatWalls: privateVisionEffect?.type === 'fire'
        ? (privateVisionEffect.phantomWalls ?? [])
        : [],
      poisonAffected: !!privatePoisonEffect,
      pawnColor: runnerId === viewerUid ? '#4e9ad8' : '#f08b78',
      wormholeRun: wormholeRun
        ? materializeAuthorityWormholeRun(
            wormholeRun,
            gameState.phase === GamePhase.END,
          )
        : null,
    }];
  });
}
