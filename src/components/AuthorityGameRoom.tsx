'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  LogOut,
  RotateCcw,
} from 'lucide-react';
import GameSetup from '@/components/GameSetup';
import LiveBoardGrid from '@/components/LiveBoardGrid';
import MazeShell from '@/components/maze/MazeShell';
import { useMazeAuthorityPresence, useMazeAuthorityRoom } from '@/hooks/useMazeAuthority';
import {
  buildMazeAuthorityCloseRoomCommand,
  buildMazeAuthorityLeaveRoomCommand,
  buildMazeAuthorityResetMapCommand,
  buildMazeAuthorityRestartMatchCommand,
  buildMazeAuthorityStartMatchCommand,
  buildMazeAuthoritySubmitMapCommand,
  buildMazeAuthorityTurnCommand,
  classifyMazeAuthorityRetry,
  invokeMazeAuthorityCommand,
  invokeMazeAuthorityOfflineTurn,
  getMazeAuthorityOfflineTurnGraceRemainingMs,
  mapMazeAuthorityClientError,
  type MazeAuthorityCommand,
  type MazeAuthorityMapView,
  type MazeAuthorityPublicView,
} from '@/lib/mazeAuthorityClient';
import {
  buildMazeAuthorityLiveBoards,
  isFullMazeAuthorityMap,
} from '@/lib/mazeAuthorityPresentation';
import type { Direction, GameMap } from '@/types/game';

interface AuthorityGameRoomProps {
  roomId: string;
  userId: string;
}

type OfflineTurnAttemptState = 'in-flight' | 'settled';

interface OfflineTurnNotice {
  identity: string;
  message: string;
  persistent?: true;
}

const OFFLINE_TURN_RETRY_DELAY_MS = 15_000;
const OFFLINE_TURN_MAX_ATTEMPTS = 3;
const OFFLINE_TURN_STALE_REASONS = new Set([
  'target-online',
  'turn-changed',
  'turn-number-changed',
  'generation-mismatch',
  'lease-mismatch',
  'player-inactive',
  'not-playing',
]);

const DIRECTIONS: Array<{
  direction: Direction;
  label: string;
  Icon: typeof ArrowUp;
}> = [
  { direction: 'up', label: '위', Icon: ArrowUp },
  { direction: 'left', label: '왼쪽', Icon: ArrowLeft },
  { direction: 'down', label: '아래', Icon: ArrowDown },
  { direction: 'right', label: '오른쪽', Icon: ArrowRight },
];

function fence(view: Pick<MazeAuthorityPublicView, 'roomId' | 'generation' | 'revision'>) {
  return {
    roomId: view.roomId,
    expectedGeneration: view.generation,
    expectedRevision: view.revision,
  };
}

function fullMap(value: MazeAuthorityMapView | undefined): GameMap | null {
  return value && isFullMazeAuthorityMap(value) ? value : null;
}

function resultLabel(input: {
  winner: string | null;
  draw: boolean | null;
  userId: string;
  isMember: boolean;
}): string {
  if (input.draw) return '사이좋게 무승부예요!';
  if (!input.winner) return '경기가 끝났어요.';
  if (!input.isMember) return '경기가 끝났어요!';
  return input.winner === input.userId ? '내 토끼가 가장 짧은 기록을 만들었어요!' : '다음 판에는 더 짧은 길로!';
}

export default function AuthorityGameRoom({ roomId, userId }: AuthorityGameRoomProps) {
  const router = useRouter();
  const {
    publicView,
    memberView,
    isLoading,
    isMemberProjectionPending,
    error: viewError,
  } = useMazeAuthorityRoom(roomId, userId);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [commandError, setCommandError] = useState<string | null>(null);
  const [offlineTurnNotice, setOfflineTurnNotice] = useState<OfflineTurnNotice | null>(null);
  const componentMounted = useRef(false);
  const offlineTurnAttempts = useRef(new Map<string, OfflineTurnAttemptState>());
  const activeView = memberView ?? publicView;
  const isMember = !!publicView?.lobby.members[userId];
  const presence = useMazeAuthorityPresence({
    roomId,
    uid: userId,
    generation: publicView?.generation ?? null,
    enabled: !!publicView,
  });

  useEffect(() => {
    componentMounted.current = true;
    return () => {
      componentMounted.current = false;
    };
  }, []);

  const boards = useMemo(() => activeView ? buildMazeAuthorityLiveBoards({
    gameState: activeView.gameState,
    viewerUid: memberView ? userId : null,
  }) : [], [activeView, memberView, userId]);

  const offlineTurnCandidate = useMemo(() => {
    const gameState = activeView?.gameState;
    const generation = publicView?.generation;
    const targetUid = gameState?.phase === 'play' ? gameState.currentTurn : null;
    const turnNumber = gameState?.turnNumber;
    if (!isMember
      || !presence.connected
      || !targetUid
      || targetUid === userId
      || !generation
      || !turnNumber) return null;
    const target = gameState.players[targetUid];
    const status = presence.statuses[targetUid];
    if (!target
      || target.finished
      || target.forfeited
      || target.hasLeft
      || !status
      || status.generation !== generation
      || status.online
      || status.offlineSince === undefined) return null;
    const activeRunnerIds = gameState.turnOrder.filter((uid) => {
      const player = gameState.players[uid];
      return !!player && !player.finished && !player.forfeited && !player.hasLeft;
    });
    return {
      identity: [roomId, generation, targetUid, status.epoch, turnNumber].join(':'),
      request: {
        roomId,
        targetUid,
        generation,
        leaseEpoch: status.epoch,
        turnNumber,
      },
      targetName: target.displayName?.trim() || '플레이어',
      offlineSince: status.offlineSince,
      serverTimeOffsetMs: presence.serverTimeOffsetMs,
      isFinalActiveRunner: activeRunnerIds.length <= 1,
    };
  }, [
    activeView,
    isMember,
    presence.connected,
    presence.serverTimeOffsetMs,
    presence.statuses,
    publicView?.generation,
    roomId,
    userId,
  ]);

  useEffect(() => {
    const candidate = offlineTurnCandidate;
    if (!candidate) return;
    if (candidate.isFinalActiveRunner) {
      offlineTurnAttempts.current.set(candidate.identity, 'settled');
      setOfflineTurnNotice({
        identity: candidate.identity,
        message: `${candidate.targetName}님이 마지막 미완주 플레이어예요. 턴을 넘기지 않고 재접속을 기다립니다.`,
      });
      return;
    }
    if (offlineTurnAttempts.current.has(candidate.identity)) return;

    let cancelled = false;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let graceTimer: ReturnType<typeof setInterval> | null = null;
    const run = async (attempt: number) => {
      if (cancelled) return;
      offlineTurnAttempts.current.set(candidate.identity, 'in-flight');
      setOfflineTurnNotice({
        identity: candidate.identity,
        message: `${candidate.targetName}님의 접속 상태를 서버에서 확인하는 중이에요.`,
      });
      try {
        const response = await invokeMazeAuthorityOfflineTurn(candidate.request);
        offlineTurnAttempts.current.set(candidate.identity, 'settled');
        if (componentMounted.current) {
          setOfflineTurnNotice({
            identity: candidate.identity,
            message: `${candidate.targetName}님의 플레이 상태는 그대로 두고 턴만 다음 플레이어에게 넘겼어요.`,
            persistent: true,
          });
          setMessage(response.replayed
            ? '이미 확인된 오프라인 턴을 안전하게 반영했어요.'
            : '오프라인 플레이어의 턴만 자동으로 넘겼어요.');
        }
      } catch (error) {
        const mapped = mapMazeAuthorityClientError(error);
        if (mapped.reason === 'no-other-active-runner') {
          offlineTurnAttempts.current.set(candidate.identity, 'settled');
          if (!cancelled) setOfflineTurnNotice({
            identity: candidate.identity,
            message: `${candidate.targetName}님이 마지막 미완주 플레이어예요. 턴을 넘기지 않고 재접속을 기다립니다.`,
          });
          return;
        }
        if (mapped.reason && OFFLINE_TURN_STALE_REASONS.has(mapped.reason)) {
          offlineTurnAttempts.current.set(candidate.identity, 'settled');
          return;
        }
        if ((mapped.code === 'unavailable' || mapped.reason === 'grace-active')
          && attempt < OFFLINE_TURN_MAX_ATTEMPTS) {
          if (!cancelled) setOfflineTurnNotice({
            identity: candidate.identity,
            message: '접속 상태 확인이 지연되어 잠시 후 다시 확인할게요.',
          });
          retryTimer = setTimeout(() => void run(attempt + 1), OFFLINE_TURN_RETRY_DELAY_MS);
          return;
        }
        offlineTurnAttempts.current.set(candidate.identity, 'settled');
        if (!cancelled && mapped.reason !== 'claim-conflict') {
          setCommandError(mapped.message);
        }
      }
    };

    setOfflineTurnNotice({
      identity: candidate.identity,
      message: `${candidate.targetName}님의 재접속을 45초 동안 기다리고 있어요.`,
    });
    const checkGrace = () => {
      const remaining = getMazeAuthorityOfflineTurnGraceRemainingMs({
        offlineSince: candidate.offlineSince,
        serverTimeOffsetMs: candidate.serverTimeOffsetMs,
      });
      if (remaining > 0 || cancelled) return;
      if (graceTimer) clearInterval(graceTimer);
      graceTimer = null;
      void run(1);
    };
    // Check against the absolute server-time boundary instead of trusting one
    // long browser timeout. Background-tab throttling may delay a tick, but it
    // can never make the callable run before the canonical 45-second grace.
    graceTimer = setInterval(checkGrace, 1_000);
    checkGrace();

    return () => {
      cancelled = true;
      if (retryTimer) clearTimeout(retryTimer);
      if (graceTimer) clearInterval(graceTimer);
    };
  }, [offlineTurnCandidate]);

  const visibleOfflineTurnNotice = offlineTurnCandidate
    && offlineTurnNotice?.identity === offlineTurnCandidate.identity
    ? offlineTurnNotice.message
    : offlineTurnNotice?.persistent && activeView?.gameState.phase === 'play'
      ? offlineTurnNotice.message
      : null;

  if (isLoading || (!publicView && !viewError)) {
    return (
      <MazeShell screen="room" phase="waiting">
        <div className="flex min-h-svh items-center justify-center p-6 text-center font-black text-[#3d352d]">
          놀이판을 맞추는 중...
        </div>
      </MazeShell>
    );
  }

  if (viewError || !publicView || !activeView) {
    return (
      <MazeShell screen="room" phase="waiting">
        <div className="flex min-h-svh flex-col items-center justify-center gap-4 p-6 text-center text-[#3d352d]">
          <p className="font-black" role="alert">{viewError || '종료되었거나 찾을 수 없는 방입니다.'}</p>
          <button type="button" className="btn-game px-5" onClick={() => router.replace('/rooms')}>
            방 목록으로
          </button>
        </div>
      </MazeShell>
    );
  }

  if (isMemberProjectionPending) {
    return (
      <MazeShell screen="room" phase="waiting">
        <div className="flex min-h-svh items-center justify-center p-6 text-center font-black text-[#3d352d]" role="status">
          내 비밀 맵을 안전하게 불러오는 중...
        </div>
      </MazeShell>
    );
  }

  const gameState = activeView.gameState;
  const me = gameState.players[userId];
  const ownMap = fullMap(gameState.maps[userId]);
  const isOwner = publicView.lobby.ownerId === userId && isMember;
  const phase = gameState.phase;
  const allReady = gameState.turnOrder.length >= 2
    && gameState.turnOrder.every((uid) => gameState.players[uid]?.isReady);
  const myTurn = phase === 'play' && gameState.currentTurn === userId;
  const canAct = isMember && myTurn && !me?.finished && !me?.forfeited && !me?.hasLeft;
  const runCommand = async (command: MazeAuthorityCommand) => {
    if (pending) return null;
    setPending(true);
    setCommandError(null);
    try {
      try {
        return await invokeMazeAuthorityCommand(command);
      } catch (error) {
        if (classifyMazeAuthorityRetry(error) === 'retry-same-command') {
          return await invokeMazeAuthorityCommand(command);
        }
        throw error;
      }
    } catch (error) {
      console.error('Maze Authority command failed:', error);
      setCommandError(classifyMazeAuthorityRetry(error) === 'refresh-view'
        ? '다른 플레이어의 동작을 반영했습니다. 화면이 갱신된 뒤 다시 눌러주세요.'
        : error instanceof Error ? error.message : '게임 명령을 처리하지 못했습니다.');
      return null;
    } finally {
      setPending(false);
    }
  };

  const submitMap = (map: GameMap) => {
    void runCommand(buildMazeAuthoritySubmitMapCommand({ ...fence(activeView), map }));
  };

  const sendDirection = async (direction: Direction) => {
    if (!canAct) return;
    const response = await runCommand(buildMazeAuthorityTurnCommand({
      ...fence(activeView),
      action: { type: 'move', direction },
    }));
    if (response?.result.type === 'turn') setMessage(response.result.outcome.message);
  };

  const leave = async () => {
    if (!isMember) {
      router.replace('/rooms');
      return;
    }
    if (phase === 'play') {
      setCommandError('경기 중에는 방을 나갈 수 없어요. 경기가 끝난 뒤 나가주세요.');
      return;
    }
    const response = await runCommand(buildMazeAuthorityLeaveRoomCommand(fence(activeView)));
    if (response) {
      sessionStorage.setItem('skip_room_restore', 'true');
      router.replace('/rooms');
    }
  };

  const onlineCount = Object.values(presence.statuses).filter((status) => status.online).length;
  const leaveDisabled = pending || (phase === 'play' && isMember);
  const shellPhase = phase === 'setup'
    ? (isMember ? 'setup' : 'spectate')
    : phase === 'end' ? 'end'
      : (isMember ? 'play' : 'spectate');

  return (
    <MazeShell screen="room" phase={shellPhase}>
      <div className="flex h-svh min-h-0 flex-col gap-2 p-2 text-[#3d352d] sm:gap-3 sm:p-3">
        <header className="game-panel flex min-h-14 shrink-0 items-center justify-between gap-2 !rounded-2xl px-3 py-2">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h1 className="truncate text-sm font-black sm:text-base">{publicView.lobby.name}</h1>
              <span className="rounded-full bg-[#e4f6ef] px-2 py-1 text-[11px] font-black text-[#315f54]">
                {isMember ? `${Object.keys(publicView.lobby.members).length}/${publicView.lobby.maxPlayers}명` : '관전'}
              </span>
            </div>
            <p className="mt-0.5 text-[11px] font-semibold text-[#74685c]" aria-live="polite">
              {phase === 'setup'
                ? '각자 비밀 미로를 만드는 중'
                : phase === 'end'
                  ? '경기 결과가 서버에 확정됐어요'
                  : `${gameState.players[gameState.currentTurn ?? '']?.displayName || '플레이어'}의 턴`}
              {onlineCount > 0 ? ` · 접속 ${onlineCount}명` : ''}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            <button
              type="button"
              className="btn-sub flex min-h-11 items-center gap-1 px-3 text-xs"
              onClick={() => void leave()}
              disabled={leaveDisabled}
              title={leaveDisabled && !pending ? '경기 중에는 나갈 수 없어요.' : undefined}
            >
              <LogOut size={16} aria-hidden="true" /> 나가기
            </button>
          </div>
        </header>

        {(viewError || commandError || presence.error) && (
          <div className="rounded-xl border-2 border-[#b94646] bg-[#fff1ec] px-3 py-2 text-xs font-bold text-[#8a2e2e]" role="alert">
            {commandError || presence.error || viewError}
          </div>
        )}
        {visibleOfflineTurnNotice && (
          <div className="rounded-xl border border-[#8db9aa] bg-[#edf9f4] px-3 py-2 text-xs font-bold text-[#315f54]" role="status" aria-live="polite">
            {visibleOfflineTurnNotice}
          </div>
        )}
        {message && (
          <div className="rounded-xl border border-[#cfa87a] bg-[#fff8de] px-3 py-2 text-xs font-bold" aria-live="polite">
            {message}
          </div>
        )}

        {phase === 'setup' ? (
          <main className="min-h-0 flex-1">
            {!isMember ? (
              <div className="game-panel flex min-h-[55vh] items-center justify-center !rounded-3xl p-6 text-center">
                <div>
                  <p className="text-4xl" aria-hidden="true">🧩</p>
                  <p className="mt-3 font-black">빈자리가 생기면 방 목록에서 참가할 수 있어요.</p>
                </div>
              </div>
            ) : me?.isReady && ownMap ? (
              <div className="game-panel flex min-h-[55vh] flex-col items-center justify-center gap-4 !rounded-3xl p-6 text-center">
                <span className="text-5xl" aria-hidden="true">🐰</span>
                <div>
                  <h2 className="text-xl font-black">내 미로 준비 완료!</h2>
                  <p className="mt-1 text-sm font-semibold text-[#74685c]">다른 플레이어의 미로가 완성되기를 기다려요.</p>
                </div>
                <div className="flex flex-wrap justify-center gap-2">
                  <button
                    type="button"
                    className="btn-sub flex min-h-11 items-center gap-2 px-4 text-sm"
                    disabled={pending}
                    onClick={() => void runCommand(buildMazeAuthorityResetMapCommand(fence(activeView)))}
                  >
                    <RotateCcw size={17} aria-hidden="true" /> 다시 만들기
                  </button>
                  {isOwner && (
                    <button
                      type="button"
                      className="btn-game min-h-11 px-5 text-sm"
                      disabled={pending || !allReady}
                      onClick={() => void runCommand(buildMazeAuthorityStartMatchCommand(fence(activeView)))}
                    >
                      {allReady ? '게임 시작!' : '모두의 준비를 기다리는 중'}
                    </button>
                  )}
                </div>
              </div>
            ) : (
              <GameSetup
                onMapComplete={submitMap}
                initialMap={ownMap}
              />
            )}
          </main>
        ) : (
          <>
            <main className="min-h-0 flex-1 overflow-hidden rounded-3xl border-2 border-[#cfa87a] bg-[#fffaf0] p-1.5 sm:p-2">
              <LiveBoardGrid
                boards={boards}
                currentTurnId={gameState.currentTurn}
                myPlayerId={isMember ? userId : null}
                gameEnded={phase === 'end'}
                emptyState={<p className="font-bold">보드를 준비하는 중...</p>}
              />
            </main>

            {phase === 'play' && isMember && (
              <section className="game-panel shrink-0 !rounded-2xl p-2" aria-label="턴 조작">
                <div className="flex flex-wrap items-center justify-center gap-2">
                  {DIRECTIONS.map(({ direction, label, Icon }) => (
                    <button
                      key={direction}
                      type="button"
                      className="btn-game flex min-h-11 min-w-11 items-center justify-center px-3"
                      disabled={!canAct || pending}
                      onClick={() => void sendDirection(direction)}
                      aria-label={`이동 ${label}`}
                    >
                      <Icon size={20} aria-hidden="true" />
                    </button>
                  ))}
                </div>
              </section>
            )}

            {phase === 'end' && (
              <section className="game-panel shrink-0 !rounded-3xl p-4 text-center" role="status" aria-live="polite">
                <h2 className="text-lg font-black">{resultLabel({
                  winner: gameState.winner,
                  draw: gameState.draw,
                  userId,
                  isMember,
                })}</h2>
                <p className="mt-1 text-xs font-semibold text-[#74685c]">결과와 RP를 서버에서 안전하게 확정했습니다.</p>
                <div className="mt-3 flex flex-wrap justify-center gap-2">
                  {isOwner && (
                    <button
                      type="button"
                      className="btn-game flex min-h-11 items-center gap-2 px-4 text-sm"
                      disabled={pending}
                      onClick={() => void runCommand(buildMazeAuthorityRestartMatchCommand(fence(activeView)))}
                    >
                      <RotateCcw size={17} aria-hidden="true" /> 다시 한 판
                    </button>
                  )}
                  {isOwner && (
                    <button
                      type="button"
                      className="btn-sub min-h-11 px-4 text-sm"
                      disabled={pending}
                      onClick={async () => {
                        const response = await runCommand(buildMazeAuthorityCloseRoomCommand(fence(activeView)));
                        if (response) router.replace('/rooms');
                      }}
                    >
                      방 닫기
                    </button>
                  )}
                </div>
              </section>
            )}
          </>
        )}
      </div>
    </MazeShell>
  );
}
