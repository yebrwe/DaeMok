'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  onDisconnect,
  onValue,
  ref,
  runTransaction,
  type DatabaseReference,
  type OnDisconnect,
  type Unsubscribe,
} from 'firebase/database';
import { firebaseInitPromise } from '@/lib/firebase';
import {
  MAZE_AUTHORITY_PRESENCE_SLOTS,
  MAZE_AUTHORITY_PUBLIC_VIEW_ROOT,
  MAZE_AUTHORITY_RANKING_VIEW_ROOT,
  buildMazeAuthorityPresenceHeartbeatTransactionValue,
  buildMazeAuthorityPresenceConnection,
  buildMazeAuthorityPresenceReleaseTransactionValue,
  canonicalizeMazeAuthorityMemberView,
  canonicalizeMazeAuthorityPublicView,
  createMazeAuthorityPresenceSessionId,
  decodeMazeAuthorityRankingSubscription,
  mazeAuthorityMemberViewPath,
  mazeAuthorityMemberRoomsPath,
  mazeAuthorityPresenceConnectionPath,
  mazeAuthorityPresenceRoomStatusPath,
  mazeAuthorityPublicViewPath,
  parseMazeAuthorityPresenceConnection,
  parseMazeAuthorityPresenceStatus,
  type MazeAuthorityMemberView,
  type MazeAuthorityPresenceSlot,
  type MazeAuthorityPresenceStatus,
  type MazeAuthorityPublicView,
  type MazeAuthorityRankingView,
} from '@/lib/mazeAuthorityClient';

const PRESENCE_HEARTBEAT_MS = 20_000;

export interface MazeAuthorityRoomsState {
  rooms: MazeAuthorityPublicView[];
  isLoading: boolean;
  error: string | null;
}

export function useMazeAuthorityRooms(): MazeAuthorityRoomsState {
  const [state, setState] = useState<MazeAuthorityRoomsState>({
    rooms: [],
    isLoading: true,
    error: null,
  });

  useEffect(() => {
    let active = true;
    let unsubscribe: Unsubscribe | null = null;
    void firebaseInitPromise.then((initialized) => {
      if (!active) return;
      if (!initialized?.database) {
        setState({ rooms: [], isLoading: false, error: '게임 서버를 초기화하지 못했습니다.' });
        return;
      }
      unsubscribe = onValue(ref(initialized.database, MAZE_AUTHORITY_PUBLIC_VIEW_ROOT), (snapshot) => {
        const rooms: MazeAuthorityPublicView[] = [];
        let invalid = false;
        snapshot.forEach((child) => {
          const view = canonicalizeMazeAuthorityPublicView(child.val());
          if (!view || view.roomId !== child.key) invalid = true;
          else rooms.push(view);
        });
        if (invalid) {
          setState({
            rooms: [],
            isLoading: false,
            error: '서버가 보낸 방 목록을 검증하지 못했습니다. 잠시 후 다시 시도해주세요.',
          });
          return;
        }
        rooms.sort((left, right) => right.sourceUpdatedAt - left.sourceUpdatedAt
          || left.roomId.localeCompare(right.roomId));
        setState({ rooms, isLoading: false, error: null });
      }, () => {
        setState({ rooms: [], isLoading: false, error: '게임 방 목록을 불러오지 못했습니다.' });
      });
    });
    return () => {
      active = false;
      unsubscribe?.();
    };
  }, []);
  return state;
}

export interface MazeAuthorityMemberRoomsState {
  rooms: MazeAuthorityMemberView[];
  isLoading: boolean;
  error: string | null;
}

export function useMazeAuthorityMemberRooms(uid: string): MazeAuthorityMemberRoomsState {
  const [state, setState] = useState<MazeAuthorityMemberRoomsState>({
    rooms: [],
    isLoading: !!uid,
    error: null,
  });
  const [resolvedUid, setResolvedUid] = useState('');

  useEffect(() => {
    if (!uid) {
      setResolvedUid('');
      setState({ rooms: [], isLoading: false, error: null });
      return;
    }
    setState({ rooms: [], isLoading: true, error: null });
    let active = true;
    let unsubscribe: Unsubscribe | null = null;
    void firebaseInitPromise.then((initialized) => {
      if (!active) return;
      if (!initialized?.database) {
        setResolvedUid(uid);
        setState({ rooms: [], isLoading: false, error: '내 게임 방을 초기화하지 못했습니다.' });
        return;
      }
      unsubscribe = onValue(
        ref(initialized.database, mazeAuthorityMemberRoomsPath(uid)),
        (snapshot) => {
          const rooms: MazeAuthorityMemberView[] = [];
          let invalid = false;
          snapshot.forEach((child) => {
            const roomId = child.key ?? '';
            const view = canonicalizeMazeAuthorityMemberView(child.val(), uid, roomId);
            if (!view) invalid = true;
            else rooms.push(view);
          });
          if (invalid) {
            setResolvedUid(uid);
            setState({
              rooms: [],
              isLoading: false,
              error: '내 게임 방 목록을 검증하지 못했습니다. 자동 복원을 중단했습니다.',
            });
            return;
          }
          rooms.sort((left, right) => right.sourceUpdatedAt - left.sourceUpdatedAt
            || left.roomId.localeCompare(right.roomId));
          setResolvedUid(uid);
          setState({ rooms, isLoading: false, error: null });
        },
        () => {
          setResolvedUid(uid);
          setState({ rooms: [], isLoading: false, error: '내 게임 방을 불러오지 못했습니다.' });
        },
      );
    }).catch(() => {
      if (active) {
        setResolvedUid(uid);
        setState({ rooms: [], isLoading: false, error: '내 게임 방을 초기화하지 못했습니다.' });
      }
    });
    return () => {
      active = false;
      unsubscribe?.();
    };
  }, [uid]);

  return {
    ...state,
    isLoading: !!uid && (state.isLoading || resolvedUid !== uid),
  };
}

export interface MazeAuthorityRoomState {
  publicView: MazeAuthorityPublicView | null;
  memberView: MazeAuthorityMemberView | null;
  isLoading: boolean;
  isMemberProjectionPending: boolean;
  error: string | null;
}

export function useMazeAuthorityRoom(roomId: string, uid: string): MazeAuthorityRoomState {
  const [publicView, setPublicView] = useState<MazeAuthorityPublicView | null>(null);
  const [memberCandidate, setMemberCandidate] = useState<MazeAuthorityMemberView | null>(null);
  const [publicLoaded, setPublicLoaded] = useState(false);
  const [memberLoaded, setMemberLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setPublicView(null);
    setMemberCandidate(null);
    setPublicLoaded(false);
    setMemberLoaded(false);
    setError(null);
    if (!roomId || !uid) return;
    let active = true;
    let unsubscribePublic: Unsubscribe | null = null;
    let unsubscribeMember: Unsubscribe | null = null;
    void firebaseInitPromise.then((initialized) => {
      if (!active) return;
      if (!initialized?.database) {
        setError('게임 서버를 초기화하지 못했습니다.');
        setPublicLoaded(true);
        setMemberLoaded(true);
        return;
      }
      unsubscribePublic = onValue(
        ref(initialized.database, mazeAuthorityPublicViewPath(roomId)),
        (snapshot) => {
          setPublicLoaded(true);
          if (!snapshot.exists()) {
            setPublicView(null);
            return;
          }
          const parsed = canonicalizeMazeAuthorityPublicView(snapshot.val());
          if (!parsed || parsed.roomId !== roomId) {
            setPublicView(null);
            setError('검증할 수 없는 게임 방 데이터입니다.');
            return;
          }
          setPublicView(parsed);
        },
        () => {
          setPublicLoaded(true);
          setError('게임 방을 불러오지 못했습니다.');
        },
      );
      unsubscribeMember = onValue(
        ref(initialized.database, mazeAuthorityMemberViewPath(uid, roomId)),
        (snapshot) => {
          setMemberLoaded(true);
          if (!snapshot.exists()) {
            setMemberCandidate(null);
            return;
          }
          const parsed = canonicalizeMazeAuthorityMemberView(snapshot.val(), uid);
          if (!parsed || parsed.roomId !== roomId) {
            setMemberCandidate(null);
            setError('검증할 수 없는 내 게임 데이터입니다.');
            return;
          }
          setMemberCandidate(parsed);
        },
        () => {
          setMemberLoaded(true);
          setError('내 게임 상태를 불러오지 못했습니다.');
        },
      );
    });
    return () => {
      active = false;
      unsubscribePublic?.();
      unsubscribeMember?.();
    };
  }, [roomId, uid]);

  const isCurrentMember = !!publicView?.lobby.members[uid];
  const memberView = publicView
    && memberCandidate
    && memberCandidate.generation === publicView.generation
    && memberCandidate.revision === publicView.revision
    ? memberCandidate
    : null;
  return {
    publicView,
    memberView,
    isLoading: !publicLoaded || !memberLoaded,
    isMemberProjectionPending: isCurrentMember && memberView === null,
    error,
  };
}

export interface MazeAuthorityRankingsState {
  entries: MazeAuthorityRankingView[];
  isLoading: boolean;
  error: string | null;
}

export function useMazeAuthorityRankings(): MazeAuthorityRankingsState {
  const [state, setState] = useState<MazeAuthorityRankingsState>({
    entries: [],
    isLoading: true,
    error: null,
  });
  useEffect(() => {
    let active = true;
    let unsubscribe: Unsubscribe | null = null;
    void firebaseInitPromise.then((initialized) => {
      if (!active) return;
      if (!initialized?.database) {
        setState({ entries: [], isLoading: false, error: '랭킹 서버를 초기화하지 못했습니다.' });
        return;
      }
      unsubscribe = onValue(ref(initialized.database, MAZE_AUTHORITY_RANKING_VIEW_ROOT), (snapshot) => {
        const decoded = decodeMazeAuthorityRankingSubscription(snapshot.exists(), snapshot.val());
        if (decoded.status === 'invalid') {
          setState({ entries: [], isLoading: false, error: '서버 랭킹을 검증하지 못했습니다.' });
          return;
        }
        setState({ entries: decoded.entries, isLoading: false, error: null });
      }, () => {
        setState({ entries: [], isLoading: false, error: '서버 랭킹을 불러오지 못했습니다.' });
      });
    });
    return () => {
      active = false;
      unsubscribe?.();
    };
  }, []);
  return state;
}

interface ClaimedPresenceSlot {
  slot: MazeAuthorityPresenceSlot;
  reference: DatabaseReference;
  disconnect: OnDisconnect;
  connectedAt: number;
}

export interface MazeAuthorityPresenceState {
  connected: boolean;
  ownSlot: MazeAuthorityPresenceSlot | null;
  statuses: Record<string, MazeAuthorityPresenceStatus>;
  serverTimeOffsetMs: number;
  error: string | null;
}

export function useMazeAuthorityPresence(input: {
  roomId: string;
  uid: string;
  generation: number | null;
  enabled?: boolean;
}): MazeAuthorityPresenceState {
  const { roomId, uid, generation, enabled = true } = input;
  const [connected, setConnected] = useState(false);
  const [ownSlot, setOwnSlot] = useState<MazeAuthorityPresenceSlot | null>(null);
  const [statuses, setStatuses] = useState<Record<string, MazeAuthorityPresenceStatus>>({});
  const [serverTimeOffsetMs, setServerTimeOffsetMs] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setConnected(false);
    setOwnSlot(null);
    setStatuses({});
    setServerTimeOffsetMs(0);
    setError(null);
    if (!enabled || !roomId || !uid || !generation || typeof window === 'undefined') return;
    // One session belongs to one effect lifetime. React's development replay
    // can clean up an earlier effect after its replacement has started; a
    // shared session would let that stale cleanup delete the replacement slot.
    const session = createMazeAuthorityPresenceSessionId();
    let active = true;
    let firebaseConnected = false;
    let claimed: ClaimedPresenceSlot | null = null;
    let heartbeat: ReturnType<typeof setInterval> | null = null;
    let claimAttempt = 0;
    let claiming: Promise<void> | null = null;
    let claimQueued = false;
    let unsubscribeStatus: Unsubscribe | null = null;
    let unsubscribeServerTime: Unsubscribe | null = null;
    let unsubscribeConnection: Unsubscribe | null = null;

    const stopHeartbeat = () => {
      if (heartbeat) clearInterval(heartbeat);
      heartbeat = null;
    };

    const removeOwnSlot = async (slot: ClaimedPresenceSlot) => {
      await slot.disconnect.cancel().catch(() => undefined);
      await runTransaction(slot.reference, (current) => (
        buildMazeAuthorityPresenceReleaseTransactionValue(current, {
          uid,
          generation,
          session,
        })
      ), { applyLocally: false }).catch(() => undefined);
    };

    const release = async () => {
      claimAttempt += 1;
      stopHeartbeat();
      unsubscribeStatus?.();
      unsubscribeStatus = null;
      unsubscribeServerTime?.();
      unsubscribeServerTime = null;
      unsubscribeConnection?.();
      unsubscribeConnection = null;
      const slot = claimed;
      claimed = null;
      if (!slot) return;
      await removeOwnSlot(slot);
    };

    void firebaseInitPromise.then(async (initialized) => {
      if (!active) return;
      if (!initialized?.database) throw new Error('presence-init');
      const database = initialized.database;
      unsubscribeServerTime = onValue(ref(database, '.info/serverTimeOffset'), (snapshot) => {
        const offset = snapshot.val();
        setServerTimeOffsetMs(typeof offset === 'number' && Number.isFinite(offset) ? offset : 0);
      });
      unsubscribeStatus = onValue(
        ref(database, mazeAuthorityPresenceRoomStatusPath(roomId)),
        (snapshot) => {
          const next: Record<string, MazeAuthorityPresenceStatus> = {};
          let invalid = false;
          snapshot.forEach((child) => {
            const status = parseMazeAuthorityPresenceStatus(child.val(), {
              roomId,
              uid: child.key ?? undefined,
            });
            if (!status || status.generation !== generation) invalid = true;
            else next[status.uid] = status;
          });
          if (invalid) setError('접속 상태를 검증하지 못했습니다.');
          else setStatuses(next);
        },
        () => setError('접속 상태를 불러오지 못했습니다.'),
      );

      const reportClaimFailure = (cause: unknown) => {
        if (!active) return;
        console.error('Maze Authority presence claim error:', cause);
        setError(cause instanceof Error && cause.message === 'presence-slots-full'
          ? '이 계정으로 열린 게임 탭이 너무 많습니다.'
          : '게임 접속 상태를 재연결하지 못했습니다.');
      };

      const claimPresence = async () => {
        if (!active || !firebaseConnected) return;
        if (claiming) {
          claimQueued = true;
          return;
        }
        const attempt = ++claimAttempt;
        const task = (async () => {
          for (const slot of MAZE_AUTHORITY_PRESENCE_SLOTS) {
            if (!active || !firebaseConnected || attempt !== claimAttempt) return;
            const slotReference = ref(
              database,
              mazeAuthorityPresenceConnectionPath(roomId, uid, slot),
            );
            const connectedAt = Date.now();
            const entry = buildMazeAuthorityPresenceConnection({
              uid,
              generation,
              session,
              connectedAt,
              lastSeen: connectedAt,
            });
            const result = await runTransaction(slotReference, (current) => {
              if (current == null) return entry;
              const existing = parseMazeAuthorityPresenceConnection(current, {
                uid,
                generation,
                session,
              });
              return existing ? { ...existing, lastSeen: Date.now() } : undefined;
            }, { applyLocally: false });
            const committed = parseMazeAuthorityPresenceConnection(result.snapshot.val(), {
              uid,
              generation,
              session,
            });
            if (!result.committed || !committed) continue;

            const disconnect = onDisconnect(slotReference);
            const slotClaim: ClaimedPresenceSlot = {
              slot,
              reference: slotReference,
              disconnect,
              connectedAt: committed.connectedAt,
            };
            try {
              await disconnect.remove();
            } catch (cause) {
              await removeOwnSlot(slotClaim);
              throw cause;
            }
            if (!active || !firebaseConnected || attempt !== claimAttempt) {
              await removeOwnSlot(slotClaim);
              return;
            }

            claimed = slotClaim;
            setOwnSlot(slot);
            setConnected(true);
            setError(null);
            stopHeartbeat();
            let heartbeatInFlight = false;
            heartbeat = setInterval(() => {
              const currentClaim = claimed;
              if (!active
                || !firebaseConnected
                || currentClaim !== slotClaim
                || heartbeatInFlight) return;
              heartbeatInFlight = true;
              const heartbeatAt = Date.now();
              void runTransaction(currentClaim.reference, (current) => (
                buildMazeAuthorityPresenceHeartbeatTransactionValue(current, {
                  uid,
                  generation,
                  session,
                  connectedAt: currentClaim.connectedAt,
                  lastSeen: heartbeatAt,
                })
              ), { applyLocally: false }).then(async (heartbeatResult) => {
                if (!active || claimed !== currentClaim) return;
                const refreshed = parseMazeAuthorityPresenceConnection(
                  heartbeatResult.snapshot.val(),
                  { uid, generation, session },
                );
                if (heartbeatResult.committed && refreshed) {
                  setConnected(true);
                  return;
                }
                claimed = null;
                stopHeartbeat();
                setOwnSlot(null);
                setConnected(false);
                await currentClaim.disconnect.cancel().catch(() => undefined);
                if (active && firebaseConnected) void claimPresence();
              }).catch((cause: unknown) => {
                if (!active || claimed !== currentClaim) return;
                console.error('Maze Authority presence heartbeat failed:', cause);
                claimed = null;
                stopHeartbeat();
                setOwnSlot(null);
                setConnected(false);
                void currentClaim.disconnect.cancel().catch(() => undefined);
                setError('접속 신호를 갱신하지 못했습니다. 재연결을 시도합니다.');
                if (firebaseConnected) void claimPresence();
              }).finally(() => {
                heartbeatInFlight = false;
              });
            }, PRESENCE_HEARTBEAT_MS);
            return;
          }
          if (active && firebaseConnected && attempt === claimAttempt) {
            throw new Error('presence-slots-full');
          }
        })();
        claiming = task;
        try {
          await task;
        } catch (cause) {
          reportClaimFailure(cause);
        } finally {
          if (claiming === task) claiming = null;
          if (claimQueued) {
            claimQueued = false;
            if (active && firebaseConnected && !claimed) void claimPresence();
          }
        }
      };

      unsubscribeConnection = onValue(ref(database, '.info/connected'), (snapshot) => {
        firebaseConnected = snapshot.val() === true;
        if (!firebaseConnected) {
          claimAttempt += 1;
          claimed = null;
          stopHeartbeat();
          setOwnSlot(null);
          setConnected(false);
          return;
        }
        void claimPresence();
      }, () => {
        firebaseConnected = false;
        claimAttempt += 1;
        claimed = null;
        stopHeartbeat();
        setOwnSlot(null);
        setConnected(false);
        setError('게임 서버 연결 상태를 확인하지 못했습니다.');
      });
    }).catch((cause: unknown) => {
      if (!active) return;
      console.error('Maze Authority presence error:', cause);
      setError(cause instanceof Error && cause.message === 'presence-slots-full'
        ? '이 계정으로 열린 게임 탭이 너무 많습니다.'
        : '게임 접속 상태를 연결하지 못했습니다.');
    });

    return () => {
      active = false;
      void release();
    };
  }, [enabled, generation, roomId, uid]);

  return useMemo(() => ({
    connected,
    ownSlot,
    statuses,
    serverTimeOffsetMs,
    error,
  }), [connected, error, ownSlot, serverTimeOffsetMs, statuses]);
}
