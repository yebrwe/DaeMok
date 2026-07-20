'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import Image from 'next/image';
import { CollisionWall, GameMap, GamePhase, GameState, Room } from '@/types/game';
import GameSetup from './GameSetup';
import GamePlay from './GamePlay';
import LiveBoardGrid, { LiveBoardEntry } from './LiveBoardGrid';
import { useGameState } from '@/hooks/useFirebase';
import {
  placeObstacles,
  resetPlayerMap,
  startGame,
  joinRoom,
  leaveRoom,
  registerSpectator,
  tryRestoreAuth,
  updateRoomUserStatus,
  clearRoomPresence,
  ROOM_OWNER_DISCONNECT_GRACE_MS,
} from '@/lib/firebase';
import { cloneGameMap, getFirstTurnPlayerId, getNextTurnPlayerId, getTurnOrder } from '@/lib/gameUtils';
import {
  isValidMapForRuleSnapshot,
  isValidNewMapForRuleSnapshot,
} from '@/lib/gameRules';
import { isVisionObscuredForPlayer, settleCompletedGameState } from '@/lib/gameTurn';
import { settleMazeRankingParticipant, type MazeMatchResult } from '@/lib/mazeRankingFirebase';
import {
  applyOfflineTurnSkip,
  getOfflineTurnSkipCandidate,
} from '@/lib/offlineTurn';
import { shouldIncludeGamePlayerOnRestart } from '@/lib/roomLifecycle';
import { useRouter } from 'next/navigation';
import { getDatabase, ref, update, get, remove, onValue, serverTimestamp, runTransaction } from 'firebase/database';
import { getAuth } from 'firebase/auth';

// 컴포넌트 마운트 시 사용자 상태 확인
const useVerifyUser = (userId: string) => {
  const [verified, setVerified] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  useEffect(() => {
    const verifyUser = async () => {
      try {
        // 인증 상태 복원 시도
        const success = await tryRestoreAuth();
        
        if (!userId) {
          setError('유효하지 않은 사용자 ID');
          return;
        }
        
        // Firebase에서 직접 인증 상태 확인
        const auth = getAuth();
        if (!auth.currentUser) {
          console.error('Firebase 인증이 확인되지 않음');
          setError('인증 상태를 확인할 수 없습니다');
          return;
        }
        
        // userID가 현재 인증된 사용자와 일치하는지 확인
        if (auth.currentUser.uid !== userId) {
          console.error('사용자 ID 불일치:', userId, auth.currentUser.uid);
          setError('인증 정보가 일치하지 않습니다');
          return;
        }
        
        if (success) {
          console.log('사용자 상태 확인 성공:', userId);
          setVerified(true);
        } else {
          console.error('사용자 상태 확인 실패');
          setError('인증 상태를 확인할 수 없습니다');
        }
      } catch (err) {
        console.error('사용자 상태 확인 중 오류:', err);
        setError('인증 상태 확인 중 오류 발생');
      }
    };
    
    verifyUser();
  }, [userId]);
  
  return { verified, error };
};

// 플레이어 활성 상태 감지 훅 추가
const usePlayersActivity = (roomId: string) => {
  const [playersStatus, setPlayersStatus] = useState<{[key: string]: boolean}>({});
  
  useEffect(() => {
    if (!roomId) return;
    
    const connectionsRef = ref(getDatabase(), `rooms/${roomId}/connections`);
    const unsubscribe = onValue(connectionsRef, (snapshot) => {
      const players: {[key: string]: boolean} = {};

      snapshot.forEach((userConnections) => {
        if (userConnections.hasChildren()) players[userConnections.key || ''] = true;
      });

      setPlayersStatus(players);
    });
    
    return () => unsubscribe();
  }, [roomId]);
  
  return playersStatus;
};

interface GameRoomProps {
  userId: string;
  roomId: string;
}

const mapDraftStorageKey = (roomId: string, userId: string): string =>
  `daemok:maze-map-draft:v4:${roomId}:${userId}`;

const GameRoom: React.FC<GameRoomProps> = ({ userId, roomId }) => {
  // 사용자 상태 확인
  const { verified, error: verifyError } = useVerifyUser(userId);
  const { gameState, isLoading } = useGameState(roomId);
  const [isReady, setIsReady] = useState(false);
  const [myMap, setMyMap] = useState<GameMap | null>(null);
  const [mapDraft, setMapDraft] = useState<GameMap | null>(null);
  const [setupSession, setSetupSession] = useState(0);
  const [opponentMap, setOpponentMap] = useState<GameMap | null>(null);
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string>('');
  const playersStatus = usePlayersActivity(roomId);
  const [roomData, setRoomData] = useState<Room | null>(null);
  const [ownerOnline, setOwnerOnline] = useState<boolean | null>(null);
  const promotingRef = useRef(false);
  const roomRedirectingRef = useRef(false);
  const handledRestartTokenRef = useRef<string | null>(null);

  const rememberMapDraft = useCallback((map: GameMap) => {
    const draft = cloneGameMap(map);
    setMapDraft(draft);
    try {
      window.localStorage.setItem(mapDraftStorageKey(roomId, userId), JSON.stringify(draft));
    } catch (storageError) {
      console.warn('맵 임시 저장을 사용할 수 없습니다.', storageError);
    }
  }, [roomId, userId]);

  useEffect(() => {
    if (!roomData?.ruleSnapshot) return;
    try {
      const saved = window.localStorage.getItem(mapDraftStorageKey(roomId, userId));
      if (!saved) return;
      const parsed = JSON.parse(saved) as unknown;
      if (isValidMapForRuleSnapshot(parsed as GameMap, roomData.ruleSnapshot)) {
        setMapDraft(cloneGameMap(parsed as GameMap));
      } else {
        window.localStorage.removeItem(mapDraftStorageKey(roomId, userId));
      }
    } catch (storageError) {
      console.warn('저장된 맵 임시본을 복원하지 못했습니다.', storageError);
    }
  }, [roomData?.ruleSnapshot, roomId, userId]);

  // 관전자 여부: 게임 상태에 플레이어로 등록되어 있지 않으면 관전자
  const amPlayer = !!gameState?.players?.[userId];
  const isSpectator = !!gameState && !amPlayer;

  const redirectFromClosedRoom = useCallback(() => {
    if (roomRedirectingRef.current) return;
    roomRedirectingRef.current = true;
    sessionStorage.setItem('skip_room_restore', 'true');

    const database = getDatabase();
    void Promise.allSettled([
      clearRoomPresence(roomId, userId),
      update(ref(database, `userStatus/${userId}`), {
        currentRoom: null,
        lastActivity: serverTimestamp()
      }),
      remove(ref(database, `userRooms/${userId}/${roomId}`))
    ]).finally(() => {
      router.replace('/rooms');
    });
  }, [roomId, router, userId]);
  
  // 방 정보 가져오기
  useEffect(() => {
    if (!roomId) return;

    const roomRef = ref(getDatabase(), `rooms/${roomId}`);
    return onValue(roomRef, (snapshot) => {
      setRoomData(snapshot.exists() ? snapshot.val() : null);
    }, (error) => {
      if (!roomRedirectingRef.current) {
        console.error('방 정보 가져오기 오류:', error);
      }
    });
  }, [roomId]);

  // 탭별 연결을 집계해 같은 방장 계정의 모든 탭이 끊긴 경우만 오프라인으로 본다.
  useEffect(() => {
    const ownerId = roomData?.createdBy;
    if (!ownerId) {
      setOwnerOnline(null);
      return;
    }

    const ownerOnlineRef = ref(getDatabase(), `rooms/${roomId}/connections/${ownerId}`);
    return onValue(
      ownerOnlineRef,
      (snapshot) => setOwnerOnline(snapshot.hasChildren()),
      (error) => {
        console.error('방장 접속 상태 구독 오류:', error);
        setOwnerOnline(null);
      }
    );
  }, [roomData?.createdBy, roomId]);

  // 공유 isOnline 값은 탭별 connection 집계에서만 갱신한다. 다른 참가자의
  // 마지막 탭이 사라진 경우에도 남아 있는 클라이언트가 턴 상태를 정리한다.
  useEffect(() => {
    if (!gameState?.players?.[userId]) return;

    const database = getDatabase();
    const timers = new Map<string, ReturnType<typeof setTimeout>>();
    const connectionsRef = ref(database, `rooms/${roomId}/connections`);
    const unsubscribe = onValue(connectionsRef, (snapshot) => {
      Object.entries(gameState.players || {}).forEach(([playerId, player]) => {
        const online = snapshot.child(playerId).hasChildren();
        const pending = timers.get(playerId);
        if (online) {
          if (pending) clearTimeout(pending);
          timers.delete(playerId);
          if (playerId === userId && player.isOnline !== true) {
            void update(ref(database, `rooms/${roomId}/gameState/players/${playerId}`), {
              isOnline: true,
              lastSeen: serverTimestamp(),
            }).catch(() => {});
          }
          return;
        }

        if (player.isOnline === false || pending) return;
        timers.set(playerId, setTimeout(() => {
          timers.delete(playerId);
          void get(ref(database, `rooms/${roomId}/connections/${playerId}`)).then((latest) => {
            if (latest.hasChildren()) return;
            return update(ref(database, `rooms/${roomId}/gameState/players/${playerId}`), {
              isOnline: false,
              lastSeen: serverTimestamp(),
            });
          }).catch(() => {});
        }, 1_200));
      });
    });

    return () => {
      unsubscribe();
      timers.forEach((timer) => clearTimeout(timer));
    };
  }, [gameState?.players, roomId, userId]);
  
  // 승자 메시지 함수를 useCallback으로 메모이제이션 (다인전 인식)
  const getWinnerMessage = useCallback(() => {
    if (!gameState) return '';

    const players = gameState.players || {};
    const me = players[userId];

    // 관전자: 제3자 시점 결과
    if (!me) {
      if (gameState.draw) {
        const finishers = Object.values(players).filter((p) => p.finished && !p.forfeited);
        if (finishers.length === 0) return '무승부입니다! (완주 기록 없음)';
        const minMoves = Math.min(...finishers.map((p) => p.finishMoves ?? Number.MAX_SAFE_INTEGER));
        const names = finishers
          .filter((p) => p.finishMoves === minMoves)
          .map((p) => p.displayName?.substring(0, 6) || '플레이어')
          .join(', ');
        return `무승부! (${names} 공동 우승 · ${minMoves}턴)`;
      }
      if (!gameState.winner) return '';
      const w = players[gameState.winner];
      return `${w?.displayName?.substring(0, 8) || '플레이어'} 승리! (${w?.finishMoves ?? '?'}턴)`;
    }

    // 최소 턴 동률은 경기 전체 무승부로 정산한다.
    if (gameState.draw) {
      const finishers = Object.values(players).filter((p) => p.finished && !p.forfeited);
      if (finishers.length === 0) return '무승부입니다! (완주 기록 없음)';
      const minMoves = Math.min(...finishers.map((p) => p.finishMoves ?? Number.MAX_SAFE_INTEGER));
      const names = finishers
        .filter((player) => player.finishMoves === minMoves)
        .map((player) => player.displayName?.substring(0, 6) || '플레이어')
        .join(', ');
      return `무승부입니다! (${names} 최소 ${minMoves}턴)`;
    }

    if (!gameState.winner) return '';

    const isWinner = gameState.winner === userId;

    if (isWinner) {
      const hasHistoricalIncompleteRecord = Object.entries(players).some(
        ([id, p]) => id !== userId && p.forfeited
      );
      return hasHistoricalIncompleteRecord
        ? '승리했습니다! (이전 경기 기록)'
        : '승리했습니다! (최소 턴 완주)';
    }

    return me?.forfeited ? '이전 경기 미완주로 패배했습니다.' : '패배했습니다.';
  }, [gameState, userId]);
  
  // 게임 상태 변경 감지
  useEffect(() => {
    if (!gameState) return;

    // 플레이어 준비 상태 동기화
    if (gameState.players) {
      const me = gameState.players[userId];
      if (me) {
        setIsReady(me.isReady);
      }
    }

    // 게임 맵 동기화 - 내가 달리는 맵은 순환 배정(assignments)이 정한 주인의 맵
    if (gameState.maps) {
      const currentOwnMap = gameState.maps[userId] ?? null;
      setMyMap(currentOwnMap);
      if (
        currentOwnMap &&
        isValidMapForRuleSnapshot(currentOwnMap, roomData?.ruleSnapshot)
      ) {
        rememberMapDraft(currentOwnMap);
      }

      const assignedOwner = gameState.assignments?.[userId];
      if (assignedOwner && gameState.maps[assignedOwner]) {
        setOpponentMap(gameState.maps[assignedOwner]);
      } else if (!gameState.assignments) {
        // 아직 시작 전 (배정 없음)
        setOpponentMap(null);
      }
    } else if (gameState.phase === GamePhase.SETUP) {
      // 재시작 등으로 맵이 제거되면 로컬 상태도 초기화 (상대 클라이언트에서도 반영)
      setMyMap(null);
      setOpponentMap(null);
      const restartedAt = (gameState as GameState & { restartedAt?: unknown }).restartedAt;
      const restartToken = restartedAt == null ? null : String(restartedAt);
      if (restartToken && handledRestartTokenRef.current !== restartToken) {
        handledRestartTokenRef.current = restartToken;
        setMapDraft(null);
        setSetupSession((current) => current + 1);
        try {
          window.localStorage.removeItem(mapDraftStorageKey(roomId, userId));
        } catch {
          /* localStorage 접근 불가 - 메모리 초안은 이미 초기화됨 */
        }
      }
    }
  }, [gameState, rememberMapDraft, roomData?.ruleSnapshot, roomId, userId]);

  // 배포 전 생성된 방처럼 턴 필드가 없거나 탈락자를 가리키는 상태를 한 번 복구한다.
  useEffect(() => {
    if (!gameState || gameState.phase !== GamePhase.PLAY) return;
    const current = gameState.currentTurn ? gameState.players?.[gameState.currentTurn] : null;
    if (current && !current.finished && !current.forfeited && !current.hasLeft) return;

    const database = getDatabase();
    runTransaction(ref(database, `rooms/${roomId}/gameState`), (state: GameState | null) => {
      if (!state || state.phase !== GamePhase.PLAY) return;
      const settled = settleCompletedGameState(state);
      if (settled.phase === GamePhase.END) return settled;
      const activeCurrent = state.currentTurn ? state.players?.[state.currentTurn] : null;
      if (activeCurrent && !activeCurrent.finished && !activeCurrent.forfeited && !activeCurrent.hasLeft) return;

      const turnOrder = getTurnOrder(state.players || {}, state.turnOrder);
      const next = getFirstTurnPlayerId(state.players || {}, turnOrder);
      if (!next) return;
      state.turnOrder = turnOrder;
      state.currentTurn = next;
      state.turnNumber = state.turnNumber || 1;
      state.turnMessage = `${state.players[next]?.displayName || '플레이어'}의 턴`;
      state.turnMessageTimestamp = Date.now();
      return state;
    }, { applyLocally: false }).catch((error) => console.error('턴 상태 복구 오류:', error));
  }, [gameState, roomId]);
  
  // 맵 설정 완료 처리
  const handleMapComplete = async (map: GameMap) => {
    try {
      if (!userId) {
        console.error('유효하지 않은 사용자 ID');
        setMessage('유효하지 않은 사용자 ID입니다. 다시 로그인해주세요.');
        return;
      }

      // 맵 저장 (내부에서 준비 상태 설정 + 게임 시작 조건 확인까지 처리)
      await placeObstacles(roomId, userId, map);

      setIsReady(true);
      setMyMap(map);
      rememberMapDraft(map);
    } catch (error) {
      console.error('맵 설정 중 오류 발생:', error);
      setMessage('맵 설정 중 오류가 발생했습니다.');
    }
  };

  const handleEditMap = async () => {
    try {
      if (myMap) rememberMapDraft(myMap);
      await resetPlayerMap(roomId, userId);
      setIsReady(false);
      setMyMap(null);
      setMessage(myMap ? '이전 맵을 불러와 편집할 수 있습니다.' : '맵 제작으로 돌아왔습니다.');
    } catch (error) {
      console.error('맵 재편집 전환 오류:', error);
      setMessage(error instanceof Error ? error.message : '맵을 다시 편집하지 못했습니다.');
    }
  };
  
  // 완주 처리 - 마지막 이동 트랜잭션에서 기록된 완주 상태를 정산한다.
  const handleGameComplete = async (moves: number) => {
    console.log(`완주! 총 ${moves}턴 소모.`);

    const database = getDatabase();
    const gameStateRef = ref(database, `rooms/${roomId}/gameState`);

    try {
      const result = await runTransaction(gameStateRef, (state: GameState | null) => {
        if (!state) return state;
        if (state.phase !== GamePhase.PLAY) return; // 이미 종료됨 - 중단

        const players = state.players || {};
        const alreadyFinished = !!players[userId]?.finished;
        if (!alreadyFinished) {
          players[userId] = {
            ...players[userId],
            finished: true,
            finishMoves: moves,
          };
        }
        state.players = players;

        if (state.currentTurn === userId) {
          state.currentTurn = getNextTurnPlayerId(players, userId, state.turnOrder);
        }

        const settled = settleCompletedGameState(state);
        if (settled.phase === GamePhase.END) {
          return settled;
        }
        if (alreadyFinished) {
          // 이동 트랜잭션이 이미 완주를 기록했으며 아직 정산 시점이 아니므로 추가 PUT을 만들지 않는다.
          return;
        }

        return state;
      }, { applyLocally: false });

      // 마지막 이동이 이미 END를 원자 커밋했어도 transaction snapshot에는 최종 상태가 들어온다.
      const finalState = result.snapshot.val() as GameState | null;
      if (finalState?.phase === GamePhase.END) {
        await settleFinalGame(finalState);
      }
    } catch (error) {
      console.error('완주 처리 중 오류:', error);
      setMessage('완주 처리 중 오류가 발생했습니다.');
    }
  };

  // END 상태를 여러 클라이언트가 동시에 관측해도 matchNumber별 마커와
  const updateMazeRanking = useCallback(async (finalState: GameState) => {
    const authUser = getAuth().currentUser;
    const matchNumber = finalState.matchNumber;
    if (
      !authUser ||
      authUser.uid !== userId ||
      finalState.phase !== GamePhase.END ||
      !finalState.players?.[userId] ||
      !Number.isSafeInteger(matchNumber) ||
      Number(matchNumber) <= 0
    ) {
      return false;
    }

    const participantIds = (finalState.turnOrder?.length
      ? finalState.turnOrder
      : Object.keys(finalState.players)
    ).filter((id, index, ids) => !!finalState.players[id] && ids.indexOf(id) === index);
    try {
      const settlements = await Promise.all(participantIds.map((participantId) => {
        const participant = finalState.players[participantId];
        let result: MazeMatchResult = 'loss';
        if (finalState.draw) {
          result = 'draw';
        } else if (finalState.winner === participantId) {
          result = 'win';
        }

        return settleMazeRankingParticipant({
          uid: participantId,
          displayName: participant.displayName || null,
          photoURL: participant.photoURL || null,
        }, {
          roomId,
          matchNumber: Number(matchNumber),
          result,
          moves: participant.finished && !participant.forfeited ? participant.finishMoves : null,
        });
      }));
      settlements.forEach((settlement) => {
        if (settlement.applied) console.log('미로 랭킹 정산 완료:', settlement.key);
      });
      return settlements.length === participantIds.length && settlements.every(
        (settlement) => settlement.applied || !!settlement.entry
      );
    } catch (error) {
      console.error('미로 랭킹 업데이트 중 오류:', error);
      return false;
    }
  }, [roomId, userId]);

  const settleFinalGame = useCallback(async (finalState: GameState) => {
    return updateMazeRanking(finalState);
  }, [updateMazeRanking]);

  // 마지막 이동 직후 탭이 닫혀 완료 콜백이 실행되지 않아도, 남은 참가자의
  // END 구독이 같은 멱등 정산을 재시도한다.
  useEffect(() => {
    if (gameState?.phase !== GamePhase.END || !gameState.players?.[userId]) return;
    void settleFinalGame(gameState);
  }, [gameState, settleFinalGame, userId]);

  // 방장의 모든 탭 연결이 사라지면 남은 참가자가 방을 정리한다.
  // END 상태는 멱등 랭킹 정산을 먼저 마친 뒤 같은 삭제 규칙을 사용한다.
  useEffect(() => {
    const ownerId = roomData?.createdBy;
    if (
      !ownerId
      || !gameState
      || ownerOnline !== false
      || roomData?.ownerPresenceReady !== true
    ) return;

    let active = true;

    const cleanupOfflineOwnerRoom = async () => {
      try {
        await new Promise((resolve) => setTimeout(resolve, ROOM_OWNER_DISCONNECT_GRACE_MS));
        if (!active) return;
        if (
          gameState.phase === GamePhase.END
          && gameState.players?.[userId]
          && !(await settleFinalGame(gameState))
        ) return;

        const roomRef = ref(getDatabase(), `rooms/${roomId}`);
        const [snapshot, ownerConnectionsSnapshot] = await Promise.all([
          get(roomRef),
          get(ref(getDatabase(), `rooms/${roomId}/connections/${ownerId}`)),
        ]);
        if (!active || !snapshot.exists() || ownerConnectionsSnapshot.hasChildren()) return;

        const latestRoom = snapshot.val() as Room;
        if (
          latestRoom.createdBy !== ownerId
          || latestRoom.ownerPresenceReady !== true
          || typeof latestRoom.ownerDisconnectedAt !== 'number'
          || Date.now() - latestRoom.ownerDisconnectedAt < ROOM_OWNER_DISCONNECT_GRACE_MS
        ) return;

        await remove(roomRef);
        console.log('모든 연결이 종료된 방장의 방을 정리했습니다:', roomId);
      } catch (error) {
        // 여러 참가자가 동시에 정리하면 먼저 성공한 삭제 이후 요청은 무시해도 된다.
        if (active) console.error('오프라인 방장 종료 방 정리 오류:', error);
      }
    };

    void cleanupOfflineOwnerRoom();
    return () => {
      active = false;
    };
  }, [gameState, ownerOnline, roomData?.createdBy, roomData?.ownerPresenceReady, roomId, settleFinalGame, userId]);

  // 현재 턴 참가자의 연결이 오래 끊겼을 때만 남은 온라인 참가자가 턴을 넘긴다.
  // 참가자는 탈락하지 않으며 재접속하면 같은 위치에서 계속 진행한다.
  // 여러 클라이언트가 동시에 시도해도 currentTurn을 재검증하는 단일 transaction만 커밋된다.
  useEffect(() => {
    const candidate = getOfflineTurnSkipCandidate(gameState, userId);
    if (!candidate) return;

    let active = true;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;

    const recoverOfflineTurn = async () => {
      if (!active) return;

      try {
        await runTransaction(
          ref(getDatabase(), `rooms/${roomId}/gameState`),
          (state: GameState | null) => {
            const skipped = applyOfflineTurnSkip(
              state,
              candidate.playerId,
              userId,
              Date.now()
            );
            return skipped || undefined;
          },
          { applyLocally: false }
        );
      } catch (error) {
        // 클라이언트 시계가 서버보다 빠르면 규칙의 45초 검증이 먼저 거절할 수 있다.
        // 동일한 최신 상태를 다시 검증하며 짧게 재시도한다.
        console.error('오프라인 턴 회수 오류:', error);
        if (active) retryTimer = setTimeout(recoverOfflineTurn, 5_000);
      }
    };

    const initialTimer = setTimeout(recoverOfflineTurn, candidate.delayMs + 250);
    return () => {
      active = false;
      clearTimeout(initialTimer);
      if (retryTimer) clearTimeout(retryTimer);
    };
  }, [gameState, roomId, userId]);
  
  // 게임 재시작 함수 수정
  const handleRestartGame = async () => {
    if (!roomId || !gameState) return;
    if (roomData?.createdBy !== userId) {
      setMessage('방장이 재시작할 때까지 기다려주세요.');
      return;
    }
    
    try {
      console.log('게임 재시작 시작, 현재 상태:', {
        winner: gameState.winner,
        players: Object.keys(gameState.players || {})
      });
      
      const database = getDatabase();
      const roomRef = ref(database, `rooms/${roomId}`);
      const freshRoomSnapshot = await get(roomRef);
      if (!freshRoomSnapshot.exists()) {
        setMessage('방이 이미 종료되었습니다.');
        return;
      }

      const freshRoom = freshRoomSnapshot.val() as Room;
      if (freshRoom.createdBy !== userId) {
        setMessage('방장만 게임을 재시작할 수 있습니다.');
        return;
      }
      const currentGameState = freshRoom.gameState;
      
      // 이미 재시작 중인지 확인
      if (currentGameState && currentGameState.phase === GamePhase.SETUP) {
        console.log('이미 게임이 재시작되었습니다.');
        setMessage('이미 게임이 재시작되었습니다. 맵을 설정해주세요.');
        
        // 내 상태 초기화 (이미 재시작된 경우에도)
        setIsReady(false);
        setMyMap(null);
        setOpponentMap(null);
        return;
      }

      if (!currentGameState || currentGameState.phase !== GamePhase.END) {
        setMessage('게임 종료 후에만 재시작할 수 있습니다.');
        return;
      }

      if (!(await settleFinalGame(currentGameState))) {
        setMessage('참가자 랭킹 정산을 완료한 뒤 다시 시도해주세요.');
        return;
      }
      
      const allPlayers = currentGameState.players || {};
      const currentPlayers = Object.fromEntries(
        Object.keys(allPlayers)
          .filter((id) => shouldIncludeGamePlayerOnRestart(allPlayers[id]))
          .map((id) => [id, allPlayers[id]])
      );
      const turnOrder = getTurnOrder(currentPlayers, currentGameState.turnOrder);
      const preferredStarter = freshRoom.createdBy && currentPlayers[freshRoom.createdBy]
        ? freshRoom.createdBy
        : getFirstTurnPlayerId(currentPlayers, turnOrder);

      const resetPlayers = Object.fromEntries(turnOrder.map((playerId) => {
        const resetPlayer = {
          ...currentPlayers[playerId],
          isReady: false,
          finished: false,
          forfeited: false,
          hasLeft: false,
          moves: 0,
        };
        delete resetPlayer.finishMoves;
        delete resetPlayer.positionHistory;
        delete resetPlayer.lastPosition;
        return [playerId, resetPlayer];
      }));

      // 맵 제거와 상태 전환을 같은 원자 업데이트에 넣어 중간 SETUP 상태가
      // 이전 경기 맵이나 퇴장자를 다시 구독하지 않도록 한다.
      const restartState: GameState & { restartedBy?: string; restartedAt?: unknown } = {
        ...currentGameState,
        phase: GamePhase.SETUP,
        players: resetPlayers,
        currentTurn: preferredStarter,
        turnOrder,
        restartedBy: userId,
        restartedAt: serverTimestamp()
      };
      delete restartState.maps;
      delete restartState.winner;
      delete restartState.draw;
      delete restartState.turnNumber;
      delete restartState.assignments;
      delete restartState.collisionWalls;
      delete restartState.itemState;
      delete restartState.revealedWallsByPlayer;
      delete restartState.visionEffectsByPlayer;
      delete restartState.poisonEffectsByPlayer;
      delete restartState.wormholeRunsByPlayer;
      delete restartState.turnMessage;
      delete restartState.turnMessageTimestamp;

      const rosterSlotCount = Math.min(4, Math.max(2, freshRoom.maxPlayers || 2));
      const rosterUpdates = Object.fromEntries(
        Array.from({ length: rosterSlotCount }, (_, slot) => [`players/${slot}`, turnOrder[slot] || null])
      );
      await update(roomRef, {
        maps: null,
        ...rosterUpdates,
        gameState: restartState,
        status: 'waiting',
        lastActivity: serverTimestamp(),
      });
      
      // 내 상태 초기화
      setIsReady(false);
      setMyMap(null);
      setOpponentMap(null);

      console.log('게임 재시작 완료');
      
    } catch (error) {
      console.error('게임 재시작 중 오류 발생:', error);
      setMessage('게임을 재시작하는 데 문제가 발생했습니다.');
    }
  };
  
  // 진행 중인 참가자는 기권하거나 경기 기록에서 빠질 수 없다.
  const handleLeaveWithConfirm = async () => {
    // 관전자는 게임에 영향이 없으므로 확인 없이 바로 나감
    if (isSpectator) {
      await handleLeaveRoom();
      return;
    }

    if (gameState?.phase === GamePhase.PLAY) {
      setMessage('게임이 끝날 때까지 기권 없이 진행합니다. 연결을 닫아도 기록은 유지됩니다.');
      return;
    }

    await handleLeaveRoom();
  };

  // 방 나가기 핸들러 (명시적으로 로비로 돌아갈 때 호출)
  // 잔여물 방지를 위해 모든 정리를 리디렉션 "전에" 완료한다
  const handleLeaveRoom = async () => {
    try {
      console.log('방 나가기 시도:', roomId);
      setError(null);
      roomRedirectingRef.current = true;

      // 세션 복원 건너뛰기 플래그 설정
      sessionStorage.setItem('skip_room_restore', 'true');

      const database = getDatabase();
      const roomRef = ref(database, `rooms/${roomId}`);

      // END 구독에서 시작한 비동기 정산보다 퇴장 정리가 먼저 실행되지 않게 한다.
      // matchNumber 마커가 있어 중복 호출도 한 번만 반영된다.
      if (gameState?.phase === GamePhase.END && gameState.players?.[userId]) {
        await settleFinalGame(gameState);
      }

      const roomSnapshot = await get(roomRef);

      if (!roomSnapshot.exists()) {
        router.push('/rooms');
        return;
      }

      const roomData = roomSnapshot.val();
      const isRoomOwner = roomData.createdBy === userId;

      if (isRoomOwner) {
        // 방장: 다른 플레이어가 남아 있어도 방을 즉시 삭제
        // 마지막 연결을 지우기 전에 삭제 상태를 알린다. 그렇지 않으면 참가자의
        // 오프라인 방장 정리와 이 삭제가 동시에 실행될 수 있다.
        console.log('방장이 나가서 방을 삭제합니다:', roomId);
        await update(roomRef, {
          status: 'deleting',
          deletedBy: userId,
          deletedAt: serverTimestamp()
        });
        await clearRoomPresence(roomId, userId);

        await remove(roomRef);
        console.log('방이 삭제되었습니다:', roomId);
      } else {
        // 일반 참여자: 자신의 흔적만 제거
        await clearRoomPresence(roomId, userId);
        const success = await leaveRoom(roomId, userId);
        if (success) {
          await remove(ref(database, `rooms/${roomId}/members/${userId}`)).catch(() => {});
          await remove(ref(database, `rooms/${roomId}/playerStatus/${userId}`)).catch(() => {});
          console.log('방 연결 정보 제거됨');
        }
      }

      // 내 상태 정리
      await update(ref(database, `userStatus/${userId}`), {
        currentRoom: null,
        lastActivity: serverTimestamp()
      });

      router.push('/rooms');
    } catch (error) {
      console.error('방 나가기 중 오류:', error);
      setError('방 나가기 중 오류가 발생했습니다.');
      router.push('/rooms');
    }
  };
  
  // 게임 종료 상태 감지를 위한 useEffect 추가
  useEffect(() => {
    // gameState가 null이어도 무시하고 훅은 항상 실행
    if (gameState && gameState.phase === GamePhase.END) {
      setMessage(getWinnerMessage());
    }
  }, [gameState, getWinnerMessage]);
  
  // 방 초기화를 위한 useEffect
  useEffect(() => {
    // 방에 처음 입장했을 때 실행
    if (roomId && userId && !gameState && !roomRedirectingRef.current) {
      const initRoom = async () => {
        try {
          const database = getDatabase();
          const roomRef = ref(database, `rooms/${roomId}`);
          const snapshot = await get(roomRef);
          
          if (roomRedirectingRef.current) return;

          if (!snapshot.exists()) {
            console.error('방을 찾을 수 없음:', roomId);
            router.push('/rooms');
            return;
          }
          
          const roomData = snapshot.val();
          
          // 현재 인증된 사용자 정보 가져오기
          const auth = getAuth();
          const currentUser = auth.currentUser;
          const displayName = currentUser?.displayName || currentUser?.email?.split('@')[0] || '익명 사용자';
          const photoURL = currentUser?.photoURL || null;
          
          // 게임 상태에 플레이어가 없으면 초기 위치 설정
          const playerPath = `rooms/${roomId}/gameState/players/${userId}`;
          const playerRef = ref(database, playerPath);
          const playerSnapshot = await get(playerRef);

          // 이미 게임이 시작된 방에 새로 들어온 사람은 관전자 - 플레이어/참가자 노드를
          // 만들면 정산·시작 로직이 깨지므로 관전자 노드만 등록하고 종료
          const phase = roomData.gameState?.phase;
          if (phase && phase !== 'setup' && !playerSnapshot.exists()) {
            console.log('게임 진행 중 - 관전자로 입장:', roomId);
            await registerSpectator(roomId, userId);
            await updateRoomUserStatus(roomId, userId, true);
            return;
          }

          if (playerSnapshot.exists()) {
            // 기존 플레이어: 진행 중인 게임 정보(position, isReady)는 건드리지 않고
            // 프로필/접속 정보만 갱신 (새로고침 시 위치가 초기화되는 버그 방지)
            await update(ref(database, playerPath), {
              id: userId,
              isOnline: true,
              displayName: displayName,
              photoURL: photoURL,
              lastSeen: serverTimestamp()
            });
          } else {
            // 새 플레이어 추가
            await update(ref(database, playerPath), {
              id: userId,
              position: { row: 0, col: 0 },
              isReady: false,
              isOnline: true,
              displayName: displayName,
              photoURL: photoURL,
              lastSeen: serverTimestamp()
            });
          }
          
          // 참여 상태 업데이트
          await update(ref(database, `rooms/${roomId}/joinedPlayers/${userId}`), {
            joined: true,
            joinedAt: serverTimestamp(),
            displayName: displayName, // 여기도 표시 이름 추가
            photoURL: photoURL // 프로필 이미지 URL 추가
          });
          
          // 게임방 온라인 상태 업데이트 (새로운 함수 사용)
          await updateRoomUserStatus(roomId, userId, true);
        } catch (error) {
          if (roomRedirectingRef.current) return;
          console.error('방 초기화 중 오류:', error);
          setError('방 정보를 불러오는 데 문제가 발생했습니다.');
        }
      };
      
      initRoom();
    }
  }, [roomId, userId, gameState, router]);
  
  // 게임이 SETUP으로 돌아오면(재시작 등) 관전자를 빈자리에 플레이어로 승격
  useEffect(() => {
    if (!gameState || !roomData) return;
    if (gameState.phase !== GamePhase.SETUP) return;
    if (gameState.players?.[userId]) return; // 이미 플레이어
    if (promotingRef.current) return;

    const playerCount = Object.keys(gameState.players || {}).length;
    const maxPlayers = roomData.maxPlayers ?? 2;
    if (playerCount >= maxPlayers) return; // 정원 가득 - 계속 관전 대기

    promotingRef.current = true;
    (async () => {
      try {
        const ok = await joinRoom(roomId, userId);
        if (ok) {
          const database = getDatabase();
          await remove(ref(database, `rooms/${roomId}/spectators/${userId}`)).catch(() => {});
          setMessage('빈자리가 생겨 게임에 참가했습니다! 맵을 만들어주세요.');
        }
      } catch (e) {
        console.error('관전자 승격 오류:', e);
      } finally {
        promotingRef.current = false;
      }
    })();
  }, [gameState, roomData, roomId, userId]);

  // 방 삭제 감지를 위한 useEffect 수정
  useEffect(() => {
    if (!roomId || !router) return;

    const database = getDatabase();
    const roomRef = ref(database, `rooms/${roomId}`);
    
    // 방 삭제 감지 리스너
    const unsubscribe = onValue(roomRef, (snapshot) => {
      if (!snapshot.exists()) {
        console.log('방이 삭제되었습니다. 로비로 이동합니다.');
        redirectFromClosedRoom();
      }
    });
    
    return () => unsubscribe();
  }, [redirectFromClosedRoom, roomId, router]);
  
  // 방 상태 변경 감지 useEffect 수정
  useEffect(() => {
    if (!roomId || !router) return;

    const database = getDatabase();
    const roomStatusRef = ref(database, `rooms/${roomId}/status`);
    
    const unsubscribe = onValue(roomStatusRef, (snapshot) => {
      if (snapshot.exists() && snapshot.val() === 'deleting') {
        console.log('방이 삭제 중입니다. 로비로 이동합니다.');
        redirectFromClosedRoom();
      }
    });
    
    return () => unsubscribe();
  }, [redirectFromClosedRoom, roomId, router]);
  
  // 모든 조건부 렌더링 이전에 모든 useEffect 선언이 완료되어야 함
  useEffect(() => {
    // 이 Hook은 항상 존재하여 Hook 순서 일관성을 보장
    return () => {
      // 컴포넌트 언마운트 시 정리: onDisconnect 취소 + (방이 살아있으면) 오프라인 표시
      // 삭제된 방 경로에 잔여 데이터가 재생성되는 것을 방지한다
      if (roomId && userId) {
        clearRoomPresence(roomId, userId)
          .then(() => console.log('게임방 접속 상태 정리 완료'));
      }
    };
  }, [roomId, userId]);
  
  // 방 헤더 - 방 이름 / 단계 / 플레이어 정보
  const renderGameHeader = () => {
    if (!gameState) return null;

    const me = gameState.players?.[userId];
    return (
      <div
        className="room-game-header mx-auto mb-2 w-full max-w-2xl game-panel !rounded-xl px-3 py-2"
        data-game-phase={gameState.phase}
        data-testid="room-game-header"
      >
        <div className="flex justify-between items-center gap-2">
          {/* 방 제목 및 단계 */}
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-amber-400">🏁</span>
            <span className="text-sm font-bold truncate">{roomData?.name || '게임 방'}</span>
            <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border shrink-0 ${
              gameState.phase === GamePhase.SETUP
                ? 'bg-blue-400/10 text-blue-300 border-blue-400/40'
                : gameState.phase === GamePhase.PLAY
                  ? 'bg-amber-400/10 text-amber-300 border-amber-400/40'
                  : 'bg-green-400/10 text-green-300 border-green-400/40'
            }`}>
              {gameState.phase === GamePhase.SETUP ? '맵 제작' :
               gameState.phase === GamePhase.PLAY ? '게임 진행' : '게임 종료'}
            </span>
          </div>

          {/* 참가자는 진행 중 기권할 수 없고, 관전자만 자유롭게 나갈 수 있음 */}
          <div className="flex items-center gap-2 shrink-0">
            <button
              className="btn-sub min-h-11 px-3 py-1 text-[11px] !rounded-lg disabled:cursor-not-allowed disabled:opacity-50"
              onClick={handleLeaveWithConfirm}
              disabled={!isSpectator && gameState.phase === GamePhase.PLAY}
              title={!isSpectator && gameState.phase === GamePhase.PLAY
                ? '게임이 끝난 뒤 나갈 수 있습니다'
                : '방 나가기'}
            >
              {!isSpectator && gameState.phase === GamePhase.PLAY ? '🏁 끝까지 진행' : '🚪 나가기'}
            </button>
          </div>
        </div>

        {/* 플레이어 정보 행 */}
        <div
          className="room-player-strip mt-1.5 flex flex-wrap items-center justify-between gap-x-2 gap-y-1 text-xs max-[420px]:flex-nowrap"
          data-testid="room-player-strip"
        >
          {/* 내 정보 (관전자는 배지로 표시) */}
          {isSpectator ? (
            <div className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-purple-400/15 text-purple-300 border border-purple-400/40">
              👁 관전 모드
            </div>
          ) : (
          <div className="flex items-center gap-1.5">
            {me?.photoURL ? (
              <Image src={me.photoURL} alt="내 프로필" width={20} height={20} className="w-5 h-5 rounded-full ring-1 ring-blue-400" />
            ) : (
              <div className="w-5 h-5 rounded-full bg-blue-500 ring-1 ring-blue-400 flex items-center justify-center">
                <span className="text-white text-[7px] font-bold">나</span>
              </div>
            )}
            <span className="text-blue-300 font-medium">{me?.displayName?.substring(0, 6) || '나'}</span>
            {me?.isReady && <span className="text-green-400">✓</span>}
          </div>
          )}

          {/* 서버가 확정한 현재 턴 */}
          {!isSpectator && gameState.phase === GamePhase.PLAY && (
            me?.finished ? (
              <div className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-purple-400/15 text-purple-300 border border-purple-400/40">관전 중</div>
            ) : gameState.currentTurn === userId ? (
              <div className="badge-turn !text-[10px]">내 턴</div>
            ) : (
              <div className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-700 text-slate-200 border border-slate-500">
                {gameState.players?.[gameState.currentTurn || '']?.displayName?.substring(0, 6) || '상대'} 턴
              </div>
            )
          )}

          {/* 상대방 정보 (다인전: 최대 3명 압축 표시, 관전자는 전원 표시) */}
          {(() => {
            const opponents = Object.entries(gameState.players || {}).filter(([id]) => id !== userId);
            if (isSpectator) {
              return (
                <div className="ml-auto flex min-w-0 max-w-full flex-wrap items-center justify-end gap-x-2 gap-y-1 max-[420px]:flex-nowrap max-[420px]:gap-x-1">
                  {opponents.slice(0, 4).map(([oid, o]) => (
                    <div key={oid} className="flex items-center gap-1" title={o.displayName || '플레이어'}>
                      <span className={playersStatus[oid] ? 'text-green-400 text-[9px]' : 'text-slate-600 text-[9px]'}>
                        {playersStatus[oid] ? '●' : '○'}
                      </span>
                      <span className="text-slate-200 font-medium text-[11px]">{o.displayName?.substring(0, 5) || '플레이어'}</span>
                    </div>
                  ))}
                </div>
              );
            }
            if (opponents.length === 0) {
              return <div className="text-slate-500 text-[11px] animate-pulse">상대방 대기 중...</div>;
            }
            return (
              <div className="ml-auto flex min-w-0 max-w-full flex-wrap items-center justify-end gap-x-2 gap-y-1 max-[420px]:flex-nowrap max-[420px]:gap-x-1">
                {opponents.slice(0, 3).map(([oid, o]) => (
                  <div key={oid} className="flex items-center gap-1" title={o.displayName || '상대'}>
                    <span className={playersStatus[oid] ? 'text-green-400 text-[9px]' : 'text-slate-600 text-[9px]'}>
                      {playersStatus[oid] ? '●' : '○'}
                    </span>
                    {o.isReady && <span className="text-green-400 text-[10px] max-[420px]:hidden">✓</span>}
                    <span className="text-red-300 font-medium text-[11px]">{o.displayName?.substring(0, 5) || '상대'}</span>
                    {o.photoURL ? (
                      <Image src={o.photoURL} alt="상대" width={20} height={20} className="w-5 h-5 rounded-full ring-1 ring-red-400 max-[420px]:hidden" />
                    ) : (
                      <div className="w-5 h-5 rounded-full bg-red-500 ring-1 ring-red-400 max-[420px]:hidden" />
                    )}
                  </div>
                ))}
              </div>
            );
          })()}
        </div>
      </div>
    );
  };
  

  // 관전자도 한 화면에서 최대 4명의 보드를 동시에 본다.
  const renderSpectatorStage = () => {
    if (!gameState) return null;
    const playersMap = gameState.players || {};
    const ids = (gameState.turnOrder || Object.keys(playersMap)).filter((id) => !!playersMap[id]).slice(0, 4);

    // 재시작 등으로 SETUP이면 다음 게임 대기 (빈자리가 나면 자동 승격됨)
    if (gameState.phase === GamePhase.SETUP || ids.length === 0) {
      return (
        <div className="absolute inset-0 bg-gradient-to-b from-slate-800 via-slate-900 to-slate-950 flex items-center justify-center">
          <div className="game-panel px-8 py-6 text-center max-w-sm">
            <div className="text-3xl mb-2">👁</div>
            <p className="text-sm font-bold text-slate-200 mb-1">관전 대기 중</p>
            <p className="text-[11px] text-slate-400">
              참가자들이 다음 게임을 준비하고 있습니다.
              {ids.length >= (roomData?.maxPlayers ?? 2)
                ? ' 정원이 가득 차 이번 게임도 관전합니다.'
                : ' 빈자리가 있어 곧 자동으로 참가합니다.'}
            </p>
          </div>
        </div>
      );
    }

    const collisionList = Object.values(gameState.collisionWalls || {}).filter(Boolean) as CollisionWall[];
    const pawnColors = ['#3b82f6', '#ef4444', '#22c55e', '#eab308'];
    const boards: LiveBoardEntry[] = ids.flatMap((runnerId, index) => {
      const runner = playersMap[runnerId];
      const ownerId = gameState.assignments?.[runnerId];
      const runnerMap = ownerId ? gameState.maps?.[ownerId] : null;
      if (!runner || !ownerId || !runnerMap) return [];

      const consumedRaw = gameState.itemState?.[ownerId]?.consumed;
      const consumed = consumedRaw === true
        ? { 0: true }
        : consumedRaw && typeof consumedRaw === 'object'
          ? consumedRaw
          : {};

      return [{
        runnerId,
        runnerName: runner.displayName || `플레이어 ${index + 1}`,
        runnerPhotoURL: runner.photoURL || null,
        mapOwnerId: ownerId,
        mapOwnerName: playersMap[ownerId]?.displayName || null,
        map: runnerMap,
        position: runner.position || runnerMap.startPosition,
        moves: runner.moves || 0,
        finished: !!runner.finished,
        finishMoves: runner.finishMoves ?? null,
        forfeited: !!runner.forfeited,
        collisions: collisionList.filter(
          (wall) => wall.playerId === runnerId && wall.mapOwnerId === ownerId
        ),
        itemsConsumed: consumed,
        revealedWalls: gameState.revealedWallsByPlayer?.[runnerId] || [],
        celebrating: !!runner.finished && !runner.forfeited,
        revealObstacles: !!runner.finished,
        pawnColor: pawnColors[index],
        smokeAffected: isVisionObscuredForPlayer(gameState, runnerId),
        visionObscured: false,
        wormholeRun: gameState.wormholeRunsByPlayer?.[runnerId] || null,
      }];
    });

    return (
      <div className="absolute inset-0 overflow-hidden">
        <LiveBoardGrid
          boards={boards}
          currentTurnId={gameState.currentTurn}
          gameEnded={gameState.phase === GamePhase.END}
          className="absolute inset-0 px-2 pb-2 pt-12"
          emptyState={<span className="text-sm text-slate-400">보드 동기화 중</span>}
        />

        <div className="absolute inset-x-0 top-2 z-20 px-2">
          <div className="mx-auto flex max-w-2xl items-center justify-between gap-2">
            <div className="rounded bg-purple-500/20 px-2 py-1 text-[11px] font-bold text-purple-100 backdrop-blur-sm">
              관전 중 · TURN {gameState.turnNumber || 1}
            </div>
          </div>
        </div>
      </div>
    );
  };

  // 컴포넌트의 렌더링 내용을 결정하는 함수
  const renderContent = () => {
    // 인증 상태 확인이 완료될 때까지 로딩 표시
    if (!verified) {
      return (
        <div className="flex items-center justify-center h-screen">
          <div className="text-center">
            <div className="w-12 h-12 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto"></div>
            <p className="mt-4">인증 확인 중</p>
          </div>
        </div>
      );
    }
    
    // 사용자 ID가 유효한지 확인
    if (!userId || verifyError) {
      console.error('유효하지 않은 사용자 ID로 GameRoom 초기화 시도');
      return (
        <div className="flex items-center justify-center h-screen">
          <div className="text-center p-8 game-panel !border-red-500/40">
            <h2 className="text-2xl font-bold mb-4 text-red-400">인증 오류</h2>
            <p className="text-slate-300 text-sm">{verifyError || '유효하지 않은 사용자 ID입니다. 다시 로그인해주세요.'}</p>
            <button
              className="btn-game mt-5 px-6 py-2 text-sm"
              onClick={() => window.location.href = '/login'}
            >
              로그인 페이지로 이동
            </button>
          </div>
        </div>
      );
    }

    if (error) {
      return (
        <div className="flex items-center justify-center h-screen">
          <div className="text-center p-8 game-panel !border-red-500/40">
            <h2 className="text-xl font-bold mb-3 text-red-400">게임방 오류</h2>
            <p className="text-slate-300 text-sm">{error}</p>
            <button className="btn-game mt-5 px-6 py-2 text-sm" onClick={() => router.push('/rooms')}>
              로비로 이동
            </button>
          </div>
        </div>
      );
    }
    
    // 로딩 중 표시
    if (isLoading || !gameState) {
      return (
        <div className="flex items-center justify-center h-screen">
          <div className="text-center">
            <div className="w-12 h-12 border-4 border-amber-400 border-t-transparent rounded-full animate-spin mx-auto"></div>
            <h2 className="text-lg font-bold mt-4 text-slate-300">게임 로딩</h2>
          </div>
        </div>
      );
    }
    
    // 메인 게임 컨텐츠 - 풀스크린 3D 스테이지 + 오버레이 HUD
    return (
      <div className="fixed inset-0 overflow-hidden bg-slate-950">
        {/* 게임 스테이지 (헤더 아래 영역) */}
        <div className="absolute inset-x-0 bottom-0 top-[86px]">
          {isSpectator ? (
            renderSpectatorStage()
          ) : gameState.phase === GamePhase.SETUP && !isReady ? (
            <GameSetup
              key={`setup-${setupSession}`}
              onMapComplete={handleMapComplete}
              onDraftChange={rememberMapDraft}
              initialMap={mapDraft}
            />
          ) : gameState.phase === GamePhase.SETUP && isReady ? (
            <div key="waiting" className="absolute inset-0 bg-gradient-to-b from-slate-800 via-slate-900 to-slate-950 flex items-center justify-center">
              <div className="game-panel px-8 py-6 text-center min-w-[300px]">
                <p className="text-sm font-bold text-slate-200 mb-3">
                  참가자 ({Object.keys(gameState.players || {}).length}/{roomData?.maxPlayers ?? 2})
                </p>
                <div className="flex flex-col gap-1.5 mb-4">
                  {Object.entries(gameState.players || {}).map(([pid, p]) => {
                    const playerMap = gameState.maps?.[pid];
                    const needsMapUpdate = !!p.isReady && (
                      !playerMap || !isValidNewMapForRuleSnapshot(playerMap, roomData?.ruleSnapshot)
                    );
                    return (
                      <div key={pid} className="flex items-center justify-between gap-3 px-3 py-1.5 rounded-lg bg-slate-800/60 border border-slate-700/50">
                        <div className="flex items-center gap-2">
                          {p.photoURL ? (
                            <Image src={p.photoURL} alt="" width={20} height={20} className="w-5 h-5 rounded-full" />
                          ) : (
                            <div className={`w-5 h-5 rounded-full ${pid === userId ? 'bg-blue-500' : 'bg-red-500'}`} />
                          )}
                          <span className="text-xs text-slate-200">
                            {p.displayName?.substring(0, 8) || '플레이어'}
                            {pid === roomData?.createdBy && <span className="text-amber-400 ml-1">👑</span>}
                            {pid === userId && <span className="text-blue-300 ml-1">(나)</span>}
                          </span>
                        </div>
                        {needsMapUpdate ? (
                          <span className="text-[10px] font-bold text-amber-300">맵 갱신 필요</span>
                        ) : p.isReady ? (
                          <span className="text-[10px] font-bold text-green-400">✓ 준비 완료</span>
                        ) : (
                          <span className="text-[10px] text-slate-500">맵 제작 중...</span>
                        )}
                      </div>
                    );
                  })}
                </div>

                {(() => {
                  const playerEntries = Object.entries(gameState.players || {});
                  const mapsReady = gameState.maps || {};
                  const hasInvalidMaps = playerEntries.some(
                    ([pid, p]) =>
                      !!p.isReady &&
                      (!mapsReady[pid] || !isValidNewMapForRuleSnapshot(mapsReady[pid], roomData?.ruleSnapshot))
                  );
                  const allReady =
                    playerEntries.length >= 2 &&
                    playerEntries.every(
                      ([pid, p]) =>
                        !!p.isReady &&
                        !!mapsReady[pid] &&
                        isValidNewMapForRuleSnapshot(mapsReady[pid], roomData?.ruleSnapshot)
                    );
                  const isOwner = roomData?.createdBy === userId;

                  if (isOwner) {
                    return (
                      <>
                        <button
                          className="btn-game px-10 py-2.5 text-sm w-full"
                          onClick={async () => {
                            const ok = await startGame(roomId);
                            if (!ok) setMessage('방 상태가 변경되어 게임을 시작하지 못했습니다.');
                          }}
                          disabled={!allReady}
                        >
                          🚀 게임 시작
                        </button>
                        <p className="text-[10px] text-slate-500 mt-2">
                          {allReady
                            ? '모두 준비되었습니다! 시작 버튼을 누르세요.'
                            : hasInvalidMaps
                              ? '새 규칙에 맞지 않는 맵은 다시 제작해야 합니다.'
                            : '모든 참가자가 맵을 완성하면 시작할 수 있습니다.'}
                        </p>
                      </>
                    );
                  }
                  return (
                    <div>
                      <div className="w-6 h-6 border-2 border-amber-400 border-t-transparent rounded-full animate-spin mx-auto"></div>
                      <p className="text-[11px] text-slate-400 mt-2">방장이 시작하면 게임이 시작됩니다</p>
                    </div>
                  );
                })()}
                <button className="btn-sub mt-3 w-full px-5 py-2 text-xs" onClick={handleEditMap}>
                  맵 다시 만들기
                </button>
              </div>
            </div>
          ) : (gameState.phase === GamePhase.PLAY || gameState.phase === GamePhase.END) && opponentMap ? (
            /* PLAY -> END 전환 시에도 같은 GamePlay 인스턴스를 유지해
               3D 캔버스가 파괴/재생성되지 않도록 한다 */
            <GamePlay
              key="gameplay"
              map={opponentMap}
              onGameComplete={handleGameComplete}
              userId={userId}
              roomId={roomId}
              gameState={gameState}
              myMap={myMap || undefined}
              gameEnded={gameState.phase === GamePhase.END}
              myFinished={!!gameState.players?.[userId]?.finished}
              myFinishMoves={gameState.players?.[userId]?.finishMoves ?? null}
              othersInfo={Object.entries(gameState.players || {})
                .filter(([id]) => id !== userId)
                .map(([id, p]) => ({
                  id,
                  name: p.displayName || '플레이어',
                  photoURL: p.photoURL || null,
                  finished: !!p.finished && !p.forfeited,
                  finishMoves: p.finishMoves ?? null,
                  forfeited: !!p.forfeited,
                  moves: typeof p.moves === 'number' ? p.moves : 0,
                }))}
            />
          ) : gameState.phase === GamePhase.END ? (
            <div key="gameover" className="absolute inset-0 bg-gradient-to-b from-slate-800 via-slate-900 to-slate-950" />
          ) : (
            <div key="loading" className="absolute inset-0 flex items-center justify-center">
              <div className="text-center">
                <div className="w-8 h-8 border-2 border-amber-400 border-t-transparent rounded-full animate-spin mx-auto"></div>
                <p className="text-sm mt-2 text-slate-400">게임 로딩</p>
              </div>
            </div>
          )}
        </div>

        {/* 상단 헤더 (방 정보/플레이어/전적/나가기) */}
        <div className="absolute top-0 inset-x-0 z-30 px-2 pt-2 flex justify-center pointer-events-none">
          <div className="pointer-events-auto w-full max-w-3xl">{renderGameHeader()}</div>
        </div>

        {/* 오류/안내 메시지 */}
        {message && gameState.phase !== GamePhase.END && (
          <div className="absolute bottom-40 left-1/2 -translate-x-1/2 z-30 pointer-events-none">
            <p className="text-xs font-medium bg-amber-500/20 border border-amber-400/50 text-amber-100 py-1 px-3 rounded-full backdrop-blur-sm">
              {message}
            </p>
          </div>
        )}

        {/* 게임 종료 결과 - 보드가 계속 보이도록 하단의 컴팩트 카드로 표시 */}
        {gameState.phase === GamePhase.END && (
          <div className="absolute inset-x-0 bottom-6 z-40 flex justify-center pointer-events-none px-3">
            <div className={`pointer-events-auto game-panel !rounded-2xl px-5 py-3 text-center shadow-2xl max-w-[94vw] ${
              gameState.draw
                ? '!border-slate-500/60'
                : !isSpectator && gameState.winner === userId
                  ? '!border-green-400/60 shadow-green-500/20'
                  : isSpectator
                    ? '!border-amber-400/50'
                    : '!border-red-400/60 shadow-red-500/20'
            }`}>
              <div className="flex items-center justify-center gap-3 flex-wrap">
                <p className={`text-base font-black ${
                  gameState.draw
                    ? 'text-slate-300'
                    : !isSpectator && gameState.winner === userId
                      ? 'text-green-400'
                      : isSpectator
                        ? 'text-amber-300'
                        : 'text-red-400'
                }`}>
                  {gameState.draw ? '🤝' : isSpectator ? '🏁' : gameState.winner === userId ? '🏆' : '💀'} {getWinnerMessage()}
                </p>
                {isSpectator ? (
                  <button className="btn-sub px-4 py-1.5 text-xs" onClick={handleLeaveWithConfirm}>
                    나가기
                  </button>
                ) : (
                  <div className="flex gap-1.5">
                    {roomData?.createdBy === userId ? (
                      <button className="btn-game px-5 py-1.5 text-xs" onClick={handleRestartGame}>
                        재시작
                      </button>
                    ) : (
                      <span className="px-3 py-1.5 text-xs text-slate-400">방장 재시작 대기</span>
                    )}
                    <button className="btn-sub px-4 py-1.5 text-xs" onClick={handleLeaveWithConfirm}>
                      나가기
                    </button>
                  </div>
                )}
              </div>
              <p className="text-[10px] text-slate-500 mt-1">
                {isSpectator
                  ? '참가자가 재시작하면 다음 게임도 이어서 관전합니다'
                  : '보드에서 상대의 벽과 아이템을 확인해보세요'}
              </p>
            </div>
          </div>
        )}
      </div>
    );
  };
  
  // 컴포넌트의 실제 렌더링은 여기서 한 번만 이루어짐
  return renderContent();
};

export default GameRoom;
