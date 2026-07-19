import { GamePhase, GameState } from '@/types/game';
import { getNextTurnPlayerId } from '@/lib/gameUtils';

export const OFFLINE_TURN_SKIP_GRACE_MS = 45_000;

export interface OfflineTurnSkipCandidate {
  playerId: string;
  eligibleAt: number;
  delayMs: number;
}

function serverTimestampValue(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export function getOfflineTurnSkipCandidate(
  state: GameState | null | undefined,
  observerId: string,
  now = Date.now()
): OfflineTurnSkipCandidate | null {
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

  const eligibleAt = lastSeen + OFFLINE_TURN_SKIP_GRACE_MS;
  return {
    playerId: state.currentTurn,
    eligibleAt,
    delayMs: Math.max(0, eligibleAt - now),
  };
}

// Firebase transaction callbacks call this again against the latest server state.
// A stale timer therefore cannot skip a player who has reconnected or already moved.
// Skipping never marks the runner as forfeited or finished: they resume from the same
// position as soon as they reconnect, and the match can end only after real finishes.
export function applyOfflineTurnSkip(
  state: GameState | null | undefined,
  expectedPlayerId: string,
  observerId: string,
  now = Date.now()
): GameState | null {
  const candidate = getOfflineTurnSkipCandidate(state, observerId, now);
  if (!state || !candidate || candidate.playerId !== expectedPlayerId || candidate.delayMs > 0) {
    return null;
  }

  const skippedPlayer = state.players[expectedPlayerId];
  const nextPlayerId = getNextTurnPlayerId(state.players, expectedPlayerId, state.turnOrder);
  if (!nextPlayerId || nextPlayerId === expectedPlayerId) return null;
  const skippedName = skippedPlayer.displayName || '플레이어';

  return {
    ...state,
    currentTurn: nextPlayerId,
    turnNumber: (state.turnNumber || 0) + 1,
    turnMessage: `${skippedName}의 연결을 기다리는 동안 턴을 넘겼습니다. ${state.players[nextPlayerId]?.displayName || '플레이어'}의 턴`,
    turnMessageTimestamp: now,
  };
}
