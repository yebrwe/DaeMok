'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { GameMap, GamePhase } from '@/types/game';
import GameSetup from './GameSetup';
import GamePlay from './GamePlay';
import { useGameState } from '@/hooks/useFirebase';
import {
  placeObstacles,
  startGame,
  leaveRoom,
  tryRestoreAuth,
  updateRoomUserStatus,
  getRoomOnlineUsers,
  clearRoomPresence
} from '@/lib/firebase';
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
    
    // 방 참여자 실시간 상태 감지 - 새로운 함수 사용
    const unsubscribe = getRoomOnlineUsers(roomId, (users) => {
      const players: {[key: string]: boolean} = {};
      
      users.forEach(user => {
        players[user.uid] = true;
      });
      
      setPlayersStatus(players);
      console.log('게임방 온라인 플레이어 상태 업데이트:', players);
    });
    
    return () => unsubscribe();
  }, [roomId]);
  
  return playersStatus;
};

interface GameRoomProps {
  userId: string;
  roomId: string;
}

const GameRoom: React.FC<GameRoomProps> = ({ userId, roomId }) => {
  // 사용자 상태 확인
  const { verified, error: verifyError } = useVerifyUser(userId);
  const { gameState, isLoading } = useGameState(roomId);
  const [isReady, setIsReady] = useState(false);
  const [myMap, setMyMap] = useState<GameMap | null>(null);
  const [opponentMap, setOpponentMap] = useState<GameMap | null>(null);
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string>('');
  const playersStatus = usePlayersActivity(roomId);
  const [roomData, setRoomData] = useState<any>(null);
  const [roomStats, setRoomStats] = useState<{
    [userId: string]: {
      wins: number;
      losses: number;
      draws?: number;
      displayName?: string;
    }
  }>({});
  
  // 방 정보 가져오기
  useEffect(() => {
    if (!roomId) return;
    
    const fetchRoomData = async () => {
      try {
        const database = getDatabase();
        const roomRef = ref(database, `rooms/${roomId}`);
        const snapshot = await get(roomRef);
        
        if (snapshot.exists()) {
          setRoomData(snapshot.val());
        }
      } catch (error) {
        console.error('방 정보 가져오기 오류:', error);
      }
    };
    
    fetchRoomData();
  }, [roomId]);
  
  // 전적 정보 가져오기
  useEffect(() => {
    if (!roomId) return;
    
    const database = getDatabase();
    const statsRef = ref(database, `rooms/${roomId}/stats`);
    
    const unsubscribe = onValue(statsRef, (snapshot) => {
      if (snapshot.exists()) {
        setRoomStats(snapshot.val());
      } else {
        // 전적 정보가 없으면 초기화
        setRoomStats({});
      }
    });
    
    return () => unsubscribe();
  }, [roomId]);
  
  // 플레이어 목록 계산 - null-safe 방식으로 항상 값을 가지도록 함
  const players = gameState ? Object.values(gameState.players || {}) : [];
  
  // 승자 메시지 함수를 useCallback으로 메모이제이션 (다인전 인식)
  const getWinnerMessage = useCallback(() => {
    if (!gameState) return '';

    const players = gameState.players || {};
    const me = players[userId];

    // 최소 턴 동률 -> 공동 우승(무승부). 동률에 못 낀 사람은 패배
    if (gameState.draw) {
      const finishers = Object.values(players).filter((p) => p.finished && !p.forfeited);
      if (finishers.length === 0) return '무승부입니다! (전원 포기)';
      const minMoves = Math.min(...finishers.map((p) => p.finishMoves ?? Number.MAX_SAFE_INTEGER));
      const iAmTied = !!me?.finished && !me?.forfeited && me?.finishMoves === minMoves;
      if (iAmTied) return `무승부입니다! (공동 우승 · ${minMoves}턴)`;
      return me?.forfeited ? '포기하여 패배했습니다.' : '패배했습니다.';
    }

    if (!gameState.winner) return '';

    const isWinner = gameState.winner === userId;

    if (isWinner) {
      const someoneForfeited = Object.entries(players).some(
        ([id, p]) => id !== userId && p.forfeited
      );
      return someoneForfeited ? '승리했습니다! (상대 포기)' : '승리했습니다! (최소 턴 완주)';
    }

    return me?.forfeited ? '포기하여 패배했습니다.' : '패배했습니다.';
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
      setMyMap(gameState.maps[userId] ?? null);

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
    }
  }, [gameState, userId]);
  
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
    } catch (error) {
      console.error('맵 설정 중 오류 발생:', error);
      setMessage('맵 설정 중 오류가 발생했습니다.');
    }
  };
  
  // 정산: 전원이 완주 또는 포기했으면 "완주자 중 최소 턴"이 우승 (동률 -> 공동 우승 = 무승부)
  // 트랜잭션 내부에서 호출되므로 순수 함수로 유지
  const settleResult = (players: Record<string, any>): { winner: string | null; draw: boolean | null } | null => {
    const ids = Object.keys(players);
    const allDone = ids.every((id) => players[id]?.finished || players[id]?.forfeited);
    if (!allDone) return null;

    const finishers: Array<[string, number]> = ids
      .filter((id) => players[id]?.finished && !players[id]?.forfeited)
      .map((id) => [
        id,
        typeof players[id]?.finishMoves === 'number' ? players[id].finishMoves : Number.MAX_SAFE_INTEGER,
      ]);

    if (finishers.length === 0) return { winner: null, draw: true }; // 전원 포기

    const minMoves = Math.min(...finishers.map(([, count]) => count));
    const best = finishers.filter(([, count]) => count === minMoves).map(([id]) => id);
    return best.length === 1 ? { winner: best[0], draw: null } : { winner: null, draw: true };
  };

  // 완주 처리 - 자유 이동이라 여러 명이 거의 동시에 완주할 수 있으므로 트랜잭션으로 원자 처리
  const handleGameComplete = async (moves: number) => {
    console.log(`완주! 총 ${moves}턴 소모.`);

    const database = getDatabase();
    const gameStateRef = ref(database, `rooms/${roomId}/gameState`);

    try {
      const result = await runTransaction(gameStateRef, (state: any) => {
        if (!state) return state;
        if (state.phase !== GamePhase.PLAY) return; // 이미 종료됨 - 중단

        const players = state.players || {};
        players[userId] = {
          ...players[userId],
          finished: true,
          finishMoves: moves,
        };
        state.players = players;

        const settled = settleResult(players);
        if (settled) {
          state.phase = GamePhase.END;
          state.winner = settled.winner;
          state.draw = settled.draw;
        }

        return state;
      }, { applyLocally: false });

      // 게임을 END로 전환시킨 클라이언트만 전적 기록 (정확히 한 번)
      const committedState = result.committed ? result.snapshot.val() : null;
      if (committedState?.phase === GamePhase.END) {
        await updateGameStats(committedState);
      }
    } catch (error) {
      console.error('완주 처리 중 오류:', error);
      setMessage('완주 처리 중 오류가 발생했습니다.');
    }
  };

  // 포기 처리 - 다인전에서는 즉시 종료가 아니라 "탈락"이며, 전원이 끝나야 정산된다
  const handleForfeit = async () => {
    const database = getDatabase();
    const gameStateRef = ref(database, `rooms/${roomId}/gameState`);

    try {
      const result = await runTransaction(gameStateRef, (state: any) => {
        if (!state) return state;
        if (state.phase !== GamePhase.PLAY) return; // 이미 종료됨

        const players = state.players || {};
        players[userId] = {
          ...players[userId],
          forfeited: true,
        };
        state.players = players;

        const settled = settleResult(players);
        if (settled) {
          state.phase = GamePhase.END;
          state.winner = settled.winner;
          state.draw = settled.draw;
        }

        return state;
      }, { applyLocally: false });

      const committedState = result.committed ? result.snapshot.val() : null;
      if (committedState?.phase === GamePhase.END) {
        await updateGameStats(committedState);
      }
      console.log('포기 처리 완료');
    } catch (error) {
      console.error('포기 처리 중 오류:', error);
      setMessage('포기 처리 중 오류가 발생했습니다.');
    }
  };

  // 전적 업데이트 (정산된 최종 상태 기준)
  // 승자 1명: 승자 wins+, 나머지 losses+ / 공동 우승: 동률자 draws+, 나머지 losses+
  const updateGameStats = async (finalState: any) => {
    if (!roomId || !finalState?.players) return;

    const database = getDatabase();
    const statsRef = ref(database, `rooms/${roomId}/stats`);

    try {
      const players = finalState.players as Record<string, any>;
      const statsSnapshot = await get(statsRef);
      const currentStats = statsSnapshot.exists() ? statsSnapshot.val() : {};
      const updatedStats: any = { ...currentStats };

      // 공동 우승자 집합 계산 (draw인 경우)
      let tiedWinners = new Set<string>();
      if (finalState.draw) {
        const finishers = Object.entries(players).filter(
          ([, p]: [string, any]) => p.finished && !p.forfeited
        );
        if (finishers.length > 0) {
          const minMoves = Math.min(
            ...finishers.map(([, p]: [string, any]) =>
              typeof p.finishMoves === 'number' ? p.finishMoves : Number.MAX_SAFE_INTEGER
            )
          );
          finishers.forEach(([id, p]: [string, any]) => {
            if (p.finishMoves === minMoves) tiedWinners.add(id);
          });
        } else {
          // 전원 포기 - 모두 무승부 처리
          tiedWinners = new Set(Object.keys(players));
        }
      }

      Object.keys(players).forEach((playerId) => {
        const player = players[playerId];

        if (!updatedStats[playerId]) {
          updatedStats[playerId] = {
            wins: 0,
            losses: 0,
            draws: 0,
            displayName: player.displayName || '알 수 없음'
          };
        }

        if (finalState.draw) {
          if (tiedWinners.has(playerId)) {
            updatedStats[playerId].draws = (updatedStats[playerId].draws || 0) + 1;
          } else {
            updatedStats[playerId].losses = (updatedStats[playerId].losses || 0) + 1;
          }
        } else if (playerId === finalState.winner) {
          updatedStats[playerId].wins = (updatedStats[playerId].wins || 0) + 1;
        } else {
          updatedStats[playerId].losses = (updatedStats[playerId].losses || 0) + 1;
        }

        updatedStats[playerId].displayName = player.displayName || updatedStats[playerId].displayName;
      });

      await update(statsRef, updatedStats);
      console.log('전적 업데이트 완료:', updatedStats);
    } catch (error) {
      console.error('전적 업데이트 중 오류:', error);
    }
  };
  
  // 게임 재시작 함수 수정
  const handleRestartGame = async () => {
    if (!roomId || !gameState) return;
    
    try {
      console.log('게임 재시작 시작, 현재 상태:', {
        winner: gameState.winner,
        players: Object.keys(gameState.players || {})
      });
      
      const database = getDatabase();
      
      // 게임 상태 확인
      const gameStateRef = ref(database, `rooms/${roomId}/gameState`);
      const gameStateSnapshot = await get(gameStateRef);
      const currentGameState = gameStateSnapshot.exists() ? gameStateSnapshot.val() : null;
      
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
      
      // 재시작 정보 기록 (자유 이동 모드 - 선턴 개념 없음, 관련 레거시 필드는 null로 정리)
      const restartData = {
        phase: GamePhase.SETUP,
        winner: null,
        draw: null,
        currentTurn: null,
        maps: null,
        assignments: null,
        collisionWalls: null,
        itemState: null,
        turnMessage: null,
        turnMessageTimestamp: null,
        restartedBy: userId,
        restartedAt: serverTimestamp()
      };

      // Firebase에 업데이트
      await update(gameStateRef, restartData);
      
      // 맵 데이터를 완전히 제거하기 위한 추가 조치
      const mapsRef = ref(database, `rooms/${roomId}/gameState/maps`);
      await remove(mapsRef);
      
      // 충돌 벽 데이터도 완전히 제거
      const wallsRef = ref(database, `rooms/${roomId}/gameState/collisionWalls`);
      await remove(wallsRef);
      
      // 플레이어 상태 초기화
      const playersRef = ref(database, `rooms/${roomId}/gameState/players`);
      const playersSnapshot = await get(playersRef);
      const players = playersSnapshot.val();
      
      if (players) {
        const updatedPlayers: Record<string, any> = {};

        Object.keys(players).forEach(playerId => {
          updatedPlayers[playerId] = {
            ...players[playerId],
            isReady: false,
            finished: null,   // 완주/포기 상태 초기화 (null이면 RTDB에서 키 제거)
            finishMoves: null,
            forfeited: null
          };
        });

        await update(playersRef, updatedPlayers);
      }
      
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
  
  // 항상 사용 가능한 나가기 - 게임 진행 중이면 기권(탈락) 확인 후 처리
  const handleLeaveWithConfirm = async () => {
    if (gameState?.phase === GamePhase.PLAY) {
      const me = gameState.players?.[userId];

      if (
        !window.confirm(
          me?.finished
            ? '관전을 종료하고 방을 나가시겠습니까?'
            : '게임이 진행 중입니다. 지금 나가면 기권(탈락) 처리됩니다. 나가시겠습니까?'
        )
      ) {
        return;
      }

      // 아직 완주하지 못한 상태로 나가면 기권 처리 (남은 사람들은 계속 진행, 전원 종료 시 정산)
      if (!me?.finished && !me?.forfeited) {
        await handleForfeit();
      }
    }

    await handleLeaveRoom();
  };

  // 방 나가기 핸들러 (명시적으로 로비로 돌아갈 때 호출)
  // 잔여물 방지를 위해 모든 정리를 리디렉션 "전에" 완료한다
  const handleLeaveRoom = async () => {
    try {
      console.log('방 나가기 시도:', roomId);
      setError(null);

      // 세션 복원 건너뛰기 플래그 설정
      sessionStorage.setItem('skip_room_restore', 'true');

      const database = getDatabase();
      const roomRef = ref(database, `rooms/${roomId}`);

      // 서버에 등록된 onDisconnect 작업 취소 (삭제된 방 경로에 잔여물이 재생성되는 것 방지)
      await clearRoomPresence(roomId, userId);

      const roomSnapshot = await get(roomRef);

      if (!roomSnapshot.exists()) {
        router.push('/rooms');
        return;
      }

      const roomData = roomSnapshot.val();
      const isRoomOwner = roomData.createdBy === userId;

      if (isRoomOwner) {
        // 방장: 다른 플레이어가 남아 있어도 방을 즉시 삭제
        // 삭제 중 상태를 먼저 브로드캐스트해 다른 클라이언트의 리디렉션을 유도
        console.log('방장이 나가서 방을 삭제합니다:', roomId);
        try {
          await update(roomRef, {
            status: 'deleting',
            deletedBy: userId,
            deletedAt: serverTimestamp()
          });
        } catch (e) {
          console.error('삭제 상태 브로드캐스트 실패:', e);
        }

        await remove(roomRef);
        console.log('방이 삭제되었습니다:', roomId);
      } else {
        // 일반 참여자: 자신의 흔적만 제거
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
    if (roomId && userId && !gameState) {
      const initRoom = async () => {
        try {
          const database = getDatabase();
          const roomRef = ref(database, `rooms/${roomId}`);
          const snapshot = await get(roomRef);
          
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
          
          // 플레이어 목록에 사용자가 없으면 추가
          if (!roomData.players || !roomData.players.includes(userId)) {
            console.log('방 참여자 목록에 추가:', userId);
            const updatedPlayers = roomData.players ? [...roomData.players, userId] : [userId];
            await update(roomRef, { players: updatedPlayers });
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
          console.error('방 초기화 중 오류:', error);
          setError('방 정보를 불러오는 데 문제가 발생했습니다.');
        }
      };
      
      initRoom();
    }
  }, [roomId, userId, gameState, router]);
  
  // 방 삭제 감지를 위한 useEffect 수정
  useEffect(() => {
    if (!roomId || !router) return;
    
    let isRedirecting = false;
    
    const database = getDatabase();
    const roomRef = ref(database, `rooms/${roomId}`);
    
    // 방 삭제 감지 리스너
    const unsubscribe = onValue(roomRef, (snapshot) => {
      // 이미 리디렉션 중이면 추가 처리 방지
      if (isRedirecting) return;
      
      if (!snapshot.exists()) {
        console.log('방이 삭제되었습니다. 로비로 이동합니다.');
        // 세션 스토리지에 방 나가기 표시
        // sessionStorage.setItem(`left_room_${roomId}`, 'true'); <- 이 줄 제거
        // 로컬 스토리지에 방 삭제 표시
        // localStorage.setItem(`deleted_room_${roomId}`, 'true'); <- 이 줄 제거
        
        // 리디렉션 상태 설정
        isRedirecting = true;
        
        // 로비로 리디렉션
        router.push('/rooms');
      }
    });
    
    return () => unsubscribe();
  }, [roomId, router]);
  
  // 방 상태 변경 감지 useEffect 수정
  useEffect(() => {
    if (!roomId || !router) return;
    
    let isRedirecting = false;
    
    const database = getDatabase();
    const roomStatusRef = ref(database, `rooms/${roomId}/status`);
    
    const unsubscribe = onValue(roomStatusRef, (snapshot) => {
      // 이미 리디렉션 중이면 추가 처리 방지
      if (isRedirecting) return;
      
      if (snapshot.exists() && snapshot.val() === 'deleting') {
        console.log('방이 삭제 중입니다. 로비로 이동합니다.');
        // 세션 스토리지에 방 나가기 표시를 제거 - 아예 기록하지 않음
        // sessionStorage.setItem(`left_room_${roomId}`, 'true'); <- 이 줄 제거
        // 로컬 스토리지에 방 삭제 표시를 제거 - 이 줄 제거
        // localStorage.setItem(`deleted_room_${roomId}`, 'true'); <- 이 줄 제거
        
        // 리디렉션 상태 설정
        isRedirecting = true;
        
        // 로비로 리디렉션
        router.push('/rooms');
      }
    });
    
    return () => unsubscribe();
  }, [roomId, router]);
  
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
  
  // 방 헤더 - 방 이름 / 단계 / 전적 / 플레이어 정보
  const renderGameHeader = () => {
    if (!gameState || !gameState.players) return null;

    const me = gameState.players[userId];
    const opponent = Object.values(gameState.players).find(p => p.id !== userId);
    const stats = roomStats[userId];

    return (
      <div className="w-full max-w-2xl mx-auto game-panel !rounded-xl px-3 py-2 mb-2">
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

          {/* 전적 + 나가기 (어느 단계에서든 나갈 수 있음) */}
          <div className="flex items-center gap-2 shrink-0">
            <div className="text-[11px] text-slate-400">
              <span className="text-green-400 font-bold">{stats?.wins ?? 0}</span>승{' '}
              <span className="text-red-400 font-bold">{stats?.losses ?? 0}</span>패
              {(stats?.draws || 0) > 0 && (
                <>
                  {' '}<span className="text-slate-300 font-bold">{stats?.draws}</span>무
                </>
              )}
            </div>
            <button
              className="btn-sub px-2.5 py-1 text-[11px] !rounded-lg"
              onClick={handleLeaveWithConfirm}
              title="방 나가기 (게임 중이면 기권 패배)"
            >
              🚪 나가기
            </button>
          </div>
        </div>

        {/* 플레이어 정보 행 */}
        <div className="flex justify-between items-center mt-1.5 text-xs">
          {/* 내 정보 */}
          <div className="flex items-center gap-1.5">
            {me?.photoURL ? (
              <img src={me.photoURL} alt="내 프로필" className="w-5 h-5 rounded-full ring-1 ring-blue-400" />
            ) : (
              <div className="w-5 h-5 rounded-full bg-blue-500 ring-1 ring-blue-400 flex items-center justify-center">
                <span className="text-white text-[7px] font-bold">나</span>
              </div>
            )}
            <span className="text-blue-300 font-medium">{me?.displayName?.substring(0, 6) || '나'}</span>
            {me?.isReady && <span className="text-green-400">✓</span>}
          </div>

          {/* 진행 상태 표시 (자유 이동 - 각자 자기 속도로 완주) */}
          {gameState.phase === GamePhase.PLAY && (
            me?.finished ? (
              <div className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-purple-400/15 text-purple-300 border border-purple-400/40">관전 중</div>
            ) : (
              <div className="badge-turn !text-[10px]">진행 중</div>
            )
          )}

          {/* 상대방 정보 (다인전: 최대 3명 압축 표시) */}
          {(() => {
            const opponents = Object.entries(gameState.players || {}).filter(([id]) => id !== userId);
            if (opponents.length === 0) {
              return <div className="text-slate-500 text-[11px] animate-pulse">상대방 대기 중...</div>;
            }
            return (
              <div className="flex items-center gap-2">
                {opponents.slice(0, 3).map(([oid, o]) => (
                  <div key={oid} className="flex items-center gap-1" title={o.displayName || '상대'}>
                    <span className={playersStatus[oid] ? 'text-green-400 text-[9px]' : 'text-slate-600 text-[9px]'}>
                      {playersStatus[oid] ? '●' : '○'}
                    </span>
                    {o.isReady && <span className="text-green-400 text-[10px]">✓</span>}
                    <span className="text-red-300 font-medium text-[11px]">{o.displayName?.substring(0, 5) || '상대'}</span>
                    {o.photoURL ? (
                      <img src={o.photoURL} alt="상대" className="w-5 h-5 rounded-full ring-1 ring-red-400" />
                    ) : (
                      <div className="w-5 h-5 rounded-full bg-red-500 ring-1 ring-red-400" />
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
          {gameState.phase === GamePhase.SETUP && !isReady ? (
            <GameSetup key="setup" onMapComplete={handleMapComplete} />
          ) : gameState.phase === GamePhase.SETUP && isReady ? (
            <div key="waiting" className="absolute inset-0 bg-gradient-to-b from-slate-800 via-slate-900 to-slate-950 flex items-center justify-center">
              <div className="game-panel px-8 py-6 text-center min-w-[300px]">
                <p className="text-sm font-bold text-slate-200 mb-3">
                  참가자 ({Object.keys(gameState.players || {}).length}/{roomData?.maxPlayers ?? 2})
                </p>
                <div className="flex flex-col gap-1.5 mb-4">
                  {Object.entries(gameState.players || {}).map(([pid, p]) => (
                    <div key={pid} className="flex items-center justify-between gap-3 px-3 py-1.5 rounded-lg bg-slate-800/60 border border-slate-700/50">
                      <div className="flex items-center gap-2">
                        {p.photoURL ? (
                          <img src={p.photoURL} alt="" className="w-5 h-5 rounded-full" />
                        ) : (
                          <div className={`w-5 h-5 rounded-full ${pid === userId ? 'bg-blue-500' : 'bg-red-500'}`} />
                        )}
                        <span className="text-xs text-slate-200">
                          {p.displayName?.substring(0, 8) || '플레이어'}
                          {pid === roomData?.createdBy && <span className="text-amber-400 ml-1">👑</span>}
                          {pid === userId && <span className="text-blue-300 ml-1">(나)</span>}
                        </span>
                      </div>
                      {p.isReady ? (
                        <span className="text-[10px] font-bold text-green-400">✓ 준비 완료</span>
                      ) : (
                        <span className="text-[10px] text-slate-500">맵 제작 중...</span>
                      )}
                    </div>
                  ))}
                </div>

                {(() => {
                  const playerEntries = Object.entries(gameState.players || {});
                  const mapsReady = gameState.maps || {};
                  const allReady =
                    playerEntries.length >= 2 &&
                    playerEntries.every(([pid, p]) => p.isReady && mapsReady[pid]);
                  const isOwner = roomData?.createdBy === userId;

                  if (isOwner) {
                    return (
                      <>
                        <button
                          className="btn-game px-10 py-2.5 text-sm w-full"
                          onClick={async () => {
                            const ok = await startGame(roomId);
                            if (!ok) setMessage('아직 시작할 수 없습니다. 모든 참가자가 준비되어야 합니다.');
                          }}
                          disabled={!allReady}
                        >
                          🚀 게임 시작
                        </button>
                        <p className="text-[10px] text-slate-500 mt-2">
                          {allReady
                            ? '모두 준비되었습니다! 시작 버튼을 누르세요.'
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
              myMap={myMap || undefined}
              gameEnded={gameState.phase === GamePhase.END}
              myFinished={!!gameState.players?.[userId]?.finished}
              myFinishMoves={gameState.players?.[userId]?.finishMoves ?? null}
              opponentFinished={Object.entries(gameState.players || {}).some(
                ([id, p]) => id !== userId && p.finished && !p.forfeited
              )}
              opponentFinishMoves={(() => {
                const counts = Object.entries(gameState.players || {})
                  .filter(([id, p]) => id !== userId && p.finished && !p.forfeited)
                  .map(([, p]) => p.finishMoves)
                  .filter((n): n is number => typeof n === 'number');
                return counts.length > 0 ? Math.min(...counts) : null;
              })()}
              onForfeit={handleForfeit}
              mapOwnerId={gameState.assignments?.[userId] ?? null}
              myMapRunnerId={
                Object.entries(gameState.assignments ?? {}).find(
                  ([, ownerId]) => ownerId === userId
                )?.[0] ?? null
              }
              othersInfo={Object.entries(gameState.players || {})
                .filter(([id]) => id !== userId)
                .map(([id, p]) => ({
                  id,
                  name: p.displayName || '플레이어',
                  photoURL: p.photoURL || null,
                  finished: !!p.finished && !p.forfeited,
                  finishMoves: p.finishMoves ?? null,
                  forfeited: !!p.forfeited,
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

        {/* 게임 종료 결과 모달 (보드는 뒤에서 계속 공개 상태로 표시됨) */}
        {gameState.phase === GamePhase.END && (
          <div className="absolute inset-0 z-40 flex items-center justify-center pointer-events-none">
            <div className={`pointer-events-auto game-panel !rounded-2xl px-10 py-5 text-center shadow-2xl ${
              gameState.draw
                ? '!border-slate-500/60'
                : gameState.winner === userId
                  ? '!border-green-400/60 shadow-green-500/20'
                  : '!border-red-400/60 shadow-red-500/20'
            }`}>
              <p className="text-[10px] tracking-[0.3em] text-slate-500 font-bold mb-1">GAME RESULT</p>
              <p className={`text-2xl font-black ${
                gameState.draw
                  ? 'text-slate-300'
                  : gameState.winner === userId
                    ? 'text-green-400'
                    : 'text-red-400'
              }`}>
                {gameState.draw ? '🤝' : gameState.winner === userId ? '🏆' : '💀'} {getWinnerMessage()}
              </p>
              <p className="text-[11px] text-slate-500 mt-1">보드에서 상대의 벽과 아이템을 확인해보세요</p>

              <div className="flex gap-2 mt-4 justify-center">
                <button className="btn-game px-8 py-2 text-sm" onClick={handleRestartGame}>
                  재시작
                </button>
                <button className="btn-sub px-5 py-2 text-sm" onClick={handleLeaveWithConfirm}>
                  나가기
                </button>
              </div>
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
