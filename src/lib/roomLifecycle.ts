import { GamePhase, Player } from '@/types/game';

// PLAY/END records feed turn recovery and idempotent result settlement. Setup
// players have no match result to retain and can be removed immediately.
export function shouldPreserveGamePlayerOnLeave(phase: GamePhase | string | null | undefined): boolean {
  return phase === GamePhase.PLAY || phase === GamePhase.END;
}

export function shouldIncludeGamePlayerOnRestart(
  player: Pick<Player, 'hasLeft' | 'isOnline'> | null | undefined
): boolean {
  return !!player && player.hasLeft !== true && player.isOnline !== false;
}
