import { GamePhase, GameState } from '@/types/game';
import { getNextTurnPlayerId } from '@/lib/gameUtils';

export const OFFLINE_TURN_FORFEIT_GRACE_MS = 45_000;

export interface OfflineTurnForfeitCandidate {
  playerId: string;
  eligibleAt: number;
  delayMs: number;
}

function serverTimestampValue(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export function getOfflineTurnForfeitCandidate(
  state: GameState | null | undefined,
  observerId: string,
  now = Date.now()
): OfflineTurnForfeitCandidate | null {
  if (!state || state.phase !== GamePhase.PLAY || !state.currentTurn) return null;

  const observer = state.players?.[observerId];
  const current = state.players?.[state.currentTurn];
  const lastSeen = serverTimestampValue(current?.lastSeen);

  if (
    !observer ||
    observerId === state.currentTurn ||
    observer.isOnline !== true ||
    observer.hasLeft ||
    !current ||
    current.finished ||
    current.forfeited ||
    current.hasLeft ||
    current.isOnline !== false ||
    lastSeen === null
  ) {
    return null;
  }

  const eligibleAt = lastSeen + OFFLINE_TURN_FORFEIT_GRACE_MS;
  return {
    playerId: state.currentTurn,
    eligibleAt,
    delayMs: Math.max(0, eligibleAt - now),
  };
}

// Firebase transaction callbacks call this again against the latest server state.
// A stale timer therefore cannot forfeit a player who has reconnected or already moved.
export function applyOfflineTurnForfeit(
  state: GameState | null | undefined,
  expectedPlayerId: string,
  observerId: string,
  now = Date.now()
): GameState | null {
  const candidate = getOfflineTurnForfeitCandidate(state, observerId, now);
  if (!state || !candidate || candidate.playerId !== expectedPlayerId || candidate.delayMs > 0) {
    return null;
  }

  const forfeitedPlayer = state.players[expectedPlayerId];
  const players = {
    ...state.players,
    [expectedPlayerId]: {
      ...forfeitedPlayer,
      forfeited: true,
    },
  };
  const nextPlayerId = getNextTurnPlayerId(players, expectedPlayerId, state.turnOrder);
  const forfeitedName = forfeitedPlayer.displayName || '플레이어';

  return {
    ...state,
    players,
    currentTurn: nextPlayerId,
    turnMessage: nextPlayerId
      ? `${forfeitedName}의 연결이 45초간 끊겨 기권 처리됐습니다. ${players[nextPlayerId]?.displayName || '플레이어'}의 턴`
      : `${forfeitedName}의 연결이 45초간 끊겨 기권 처리됐습니다.`,
    turnMessageTimestamp: now,
  };
}
