'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { GameMap, GamePhase } from '@/types/game';
import GameSetup from './GameSetup';
import GamePlay from './GamePlay';
import { useGameState } from '@/hooks/useFirebase';
import {
  placeObstacles,
  leaveRoom,
  tryRestoreAuth,
  updateRoomUserStatus,
  getRoomOnlineUsers
} from '@/lib/firebase';
import { useRouter } from 'next/navigation';
import { getDatabase, ref, update, get, remove, onValue, serverTimestamp } from 'firebase/database';
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
  const [isRoomSetupComplete, setIsRoomSetupComplete] = useState(false);
  const [roomData, setRoomData] = useState<any>(null);
  const [restartMessage, setRestartMessage] = useState<string>('');
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
  
  // 승자 메시지 함수를 useCallback으로 메모이제이션
  const getWinnerMessage = useCallback(() => {
    if (!gameState) return '';

    const players = gameState.players || {};
    const myMoves = players[userId]?.finishMoves;

    // 같은 턴 수로 완주 -> 무승부
    if (gameState.draw) {
      return `무승부입니다! (둘 다 ${myMoves ?? '같은'}턴 소모)`;
    }

    if (!gameState.winner) return '';

    const isWinner = gameState.winner === userId;

    if (isWinner) {
      const opponentForfeited = Object.entries(players).some(
        ([id, p]) => id !== userId && p.forfeited
      );
      return opponentForfeited ? '승리했습니다! (상대방 포기)' : '승리했습니다! (더 적은 턴으로 완주)';
    }

    return players[userId]?.forfeited ? '포기하여 패배했습니다.' : '패배했습니다.';
  }, [gameState, userId]);
  
  // 현재 턴 표시 함수 추가
  const renderTurnIndicator = () => {
    if (!gameState || gameState.phase !== GamePhase.PLAY) return null;
    
    const isMyTurn = gameState.currentTurn === userId;
    
    return (
      <div className={`text-center py-1 px-2 rounded-md text-sm font-medium ${isMyTurn ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-600'}`}>
        {isMyTurn ? '내 턴입니다' : '상대방 턴입니다'}
      </div>
    );
  };
  
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

    // 게임 맵 동기화
    if (gameState.maps) {
      const mapEntries = Object.entries(gameState.maps);
      for (const [playerId, map] of mapEntries) {
        if (playerId === userId) {
          setMyMap(map);
        } else {
          setOpponentMap(map);
        }
      }
    } else if (gameState.phase === GamePhase.SETUP) {
      // 재시작 등으로 맵이 제거되면 로컬 상태도 초기화 (상대 클라이언트에서도 반영)
      setMyMap(null);
      setOpponentMap(null);
    }
  }, [gameState, userId]);
  
  // 선턴 메시지를 위한 별도의 useEffect 추가 (무한 루프 방지)
  useEffect(() => {
    if (!gameState) return;
    
    // 선턴 메시지 확인 및 설정 (별도의 useEffect로 분리)
    if (gameState.turnMessage && gameState.phase === GamePhase.SETUP) {
      // 이전 메시지와 다른 경우에만 업데이트
      if (restartMessage !== gameState.turnMessage) {
        console.log('선턴 메시지 설정:', gameState.turnMessage);
        setRestartMessage(gameState.turnMessage);
        
        // 5초 후 선턴 메시지 초기화
        const timer = setTimeout(() => {
          setRestartMessage('');
        }, 5000);
        
        return () => clearTimeout(timer);
      }
    }
  }, [gameState?.turnMessage, gameState?.phase, restartMessage]);
  
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
  
  // 골인 처리 - 승자는 게임이 끝날 때 "소모한 턴 수가 적은 쪽"으로 결정
  // 먼저 골인해도 상대가 더 적은 턴으로 완주하면 역전됨. 같은 턴 수면 무승부.
  const handleGameComplete = async (moves: number) => {
    console.log(`완주! 총 ${moves}턴 소모.`);

    const database = getDatabase();
    const gameStateRef = ref(database, `rooms/${roomId}/gameState`);

    try {
      // 최신 상태 기준으로 판단 (props의 gameState는 오래됐을 수 있음)
      const snapshot = await get(gameStateRef);
      if (!snapshot.exists()) return;
      const currentState = snapshot.val();

      const players = currentState.players || {};
      const playerIds = Object.keys(players);
      const others = playerIds.filter((id) => id !== userId);
      const unfinishedOthers = others.filter((id) => !players[id]?.finished);

      // 완주 기록 + 턴/종료 처리를 하나의 원자적 업데이트로
      const updates: Record<string, unknown> = {
        [`players/${userId}/finished`]: true,
        [`players/${userId}/finishMoves`]: moves,
      };

      if (unfinishedOthers.length > 0) {
        // 아직 완주하지 않은 상대가 있으면 게임 계속 -> 남은 플레이어가 연속으로 턴 진행
        updates.currentTurn = unfinishedOthers[0];
        await update(gameStateRef, updates);
        return;
      }

      // 마지막 완주자 -> 턴 수 비교로 승자 결정
      const finalMoves: Array<[string, number]> = playerIds.map((id) => [
        id,
        id === userId ? moves : players[id]?.finishMoves ?? Number.MAX_SAFE_INTEGER,
      ]);
      const minMoves = Math.min(...finalMoves.map(([, count]) => count));
      const bestPlayers = finalMoves.filter(([, count]) => count === minMoves).map(([id]) => id);

      updates.phase = GamePhase.END;
      if (bestPlayers.length === 1) {
        updates.winner = bestPlayers[0];
        updates.draw = null;
      } else {
        updates.winner = null;
        updates.draw = true;
      }

      await update(gameStateRef, updates);

      // 전적 기록 (무승부면 null)
      await updateGameStats(bestPlayers.length === 1 ? bestPlayers[0] : null);
    } catch (error) {
      console.error('완주 처리 중 오류:', error);
      setMessage('완주 처리 중 오류가 발생했습니다.');
    }
  };

  // 포기 처리 - 상대가 먼저 완주한 뒤 남은 플레이어가 포기하면 완주한 상대의 승리로 종료
  const handleForfeit = async () => {
    const database = getDatabase();
    const gameStateRef = ref(database, `rooms/${roomId}/gameState`);

    try {
      const snapshot = await get(gameStateRef);
      if (!snapshot.exists()) return;
      const players = snapshot.val().players || {};
      const finishedOpponent =
        Object.keys(players).find((id) => id !== userId && players[id]?.finished) || null;

      await update(gameStateRef, {
        phase: GamePhase.END,
        winner: finishedOpponent,
        [`players/${userId}/forfeited`]: true,
      });

      if (finishedOpponent) {
        await updateGameStats(finishedOpponent);
      }
      console.log('포기 처리 완료');
    } catch (error) {
      console.error('포기 처리 중 오류:', error);
      setMessage('포기 처리 중 오류가 발생했습니다.');
    }
  };
  
  // 전적 업데이트 함수 (winnerId가 null이면 무승부)
  const updateGameStats = async (winnerId: string | null) => {
    if (!roomId || !gameState || !gameState.players) return;

    const database = getDatabase();
    const statsRef = ref(database, `rooms/${roomId}/stats`);

    try {
      // 현재 전적 정보 가져오기
      const statsSnapshot = await get(statsRef);
      const currentStats = statsSnapshot.exists() ? statsSnapshot.val() : {};

      // 업데이트할 전적 정보 준비
      const updatedStats: any = { ...currentStats };

      // 모든 플레이어에 대해 전적 업데이트
      Object.keys(gameState.players).forEach(playerId => {
        const player = gameState.players[playerId];

        if (!updatedStats[playerId]) {
          updatedStats[playerId] = {
            wins: 0,
            losses: 0,
            draws: 0,
            displayName: player.displayName || '알 수 없음'
          };
        }

        // 승패/무승부 업데이트
        if (winnerId === null) {
          updatedStats[playerId].draws = (updatedStats[playerId].draws || 0) + 1;
        } else if (playerId === winnerId) {
          updatedStats[playerId].wins = (updatedStats[playerId].wins || 0) + 1;
        } else {
          updatedStats[playerId].losses = (updatedStats[playerId].losses || 0) + 1;
        }

        // 표시 이름 업데이트 (변경되었을 수 있음)
        updatedStats[playerId].displayName = player.displayName || updatedStats[playerId].displayName;
      });

      // Firebase에 업데이트된 전적 저장
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
      
      // ======= 선턴 결정 로직 개선 =======
      console.log('선턴 결정 시작, 게임 상태:', {
        phase: currentGameState?.phase,
        winner: currentGameState?.winner
      });
      
      let firstTurnPlayerId = '';
      let turnMessage = '';
      
      // 승자 정보가 있으면 패배자 선턴 규칙 적용
      if (currentGameState && currentGameState.winner) {
        const winner = currentGameState.winner;
        console.log('직전 게임 승자:', winner);
        
        // 승자가 아닌 플레이어들(패배자들) 찾기
        const players = Object.keys(currentGameState.players || {});
        const losers = players.filter(id => id !== winner);
        console.log('패배자 후보:', losers);
        
        if (losers.length > 0) {
          // 패배자를 선턴으로 설정
          firstTurnPlayerId = losers[0];
          
          // 패배자 이름 가져오기
          let loserName = '패배자';
          if (currentGameState.players[firstTurnPlayerId]) {
            loserName = currentGameState.players[firstTurnPlayerId].displayName || 
                        (firstTurnPlayerId === userId ? '당신' : '상대방');
          }
          
          turnMessage = `${loserName}님이 선턴을 가져갑니다. (패배자 선턴 규칙)`;
          console.log('패배자가 선턴을 가져갑니다:', loserName, firstTurnPlayerId);
        } else {
          // 패배자를 찾을 수 없는 경우 (드문 경우)
          console.warn('패배자를 찾을 수 없음, 현재 승자:', winner);
          
          // 승자가 아닌 다른 플레이어를 찾기 위한 추가 확인
          const otherPlayers = Object.keys(gameState.players || {}).filter(id => id !== winner);
          console.log('다른 플레이어 후보(현재 상태):', otherPlayers);
          
          if (otherPlayers.length > 0) {
            firstTurnPlayerId = otherPlayers[0];
            const otherName = gameState.players[firstTurnPlayerId]?.displayName || '상대방';
            turnMessage = `${otherName}님이 선턴을 가져갑니다.`;
          } else {
            // 승자 외에 다른 플레이어가 없으면 기본값 설정
            firstTurnPlayerId = userId !== winner ? userId : winner; // 가능하면 승자가 아닌 플레이어
            turnMessage = `${gameState.players[firstTurnPlayerId]?.displayName || '플레이어'}가 선턴을 가져갑니다.`;
          }
        }
      } else {
        // 승자가 없는 경우(첫 게임 등) 랜덤으로 선택
        const players = Object.keys(gameState.players || {});
        if (players.length === 0) {
          console.error('플레이어 정보를 찾을 수 없습니다.');
          setMessage('게임을 재시작할 수 없습니다. 방을 나갔다가 다시 입장해주세요.');
          return;
        }
        
        const randomIndex = Math.floor(Math.random() * players.length);
        firstTurnPlayerId = players[randomIndex];
        turnMessage = `${gameState.players[firstTurnPlayerId]?.displayName || '플레이어'}가 선턴을 가져갑니다. (랜덤 선택)`;
        console.log('랜덤으로 선턴 결정:', firstTurnPlayerId);
      }
      
      console.log('최종 선턴 결정 결과:', {
        firstTurnPlayerId,
        turnMessage,
        decidedBy: userId,
        isCurrentUser: firstTurnPlayerId === userId
      });
      
      // 선턴 메시지 설정 - 로컬 상태
      setRestartMessage(turnMessage);
      
      // 재시작 정보 기록 (누가 재시작 버튼을 눌렀는지)
      const restartData = {
        phase: GamePhase.SETUP,
        winner: null,
        draw: null,
        currentTurn: firstTurnPlayerId,
        maps: null,
        collisionWalls: null,
        turnMessage: turnMessage,
        turnMessageTimestamp: serverTimestamp(),
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
      
      // 메시지 설정 (선턴 정보 포함)
      setMessage(`게임 재시작 - ${turnMessage}`);
      
      // 5초 후 선턴 메시지 초기화 (로컬만)
      setTimeout(() => {
        setRestartMessage('');
      }, 5000);
      
      console.log('게임 재시작 완료');
      
    } catch (error) {
      console.error('게임 재시작 중 오류 발생:', error);
      setMessage('게임을 재시작하는 데 문제가 발생했습니다.');
    }
  };
  
  // 방 나가기 핸들러 (명시적으로 로비로 돌아갈 때 호출)
  const handleLeaveRoom = async () => {
    try {
      console.log('방 나가기 시도:', roomId);
      setError(null);
      
      // 세션 복원 건너뛰기 플래그 설정
      sessionStorage.setItem('skip_room_restore', 'true');
      
      // 방장 여부 확인
      const database = getDatabase();
      const roomRef = ref(database, `rooms/${roomId}`);
      const roomSnapshot = await get(roomRef);
      
      if (!roomSnapshot.exists()) {
        console.error('존재하지 않는 방입니다.');
        router.push('/rooms');
        return;
      }
      
      const roomData = roomSnapshot.val();
      const isRoomOwner = roomData.createdBy === userId;
      
      console.log('방장 여부 확인:', isRoomOwner ? '방장입니다' : '일반 참여자입니다');
      
      // 먼저 로비로 리디렉션
      router.push('/rooms');
      
      // 리디렉션 후 방 나가기 처리를 위한 지연 설정
      setTimeout(async () => {
        try {
          if (isRoomOwner) {
            // 방장인 경우: 방 삭제 및 모든 플레이어 퇴장 처리
            console.log('방장이 나가서 방을 삭제합니다:', roomId);
            
            // 1. 방 상태를 '삭제 중'으로 변경 (다른 플레이어들이 감지할 수 있도록)
            await update(roomRef, { 
              status: 'deleting',
              deletedBy: userId,
              deletedAt: serverTimestamp()
            });
            
            // 2. 잠시 대기하여 다른 플레이어들이 상태 변경을 감지할 시간을 줌
            await new Promise(resolve => setTimeout(resolve, 1000));

            // 3. 방 자체를 삭제
            // (다른 플레이어의 userStatus는 보안 규칙상 본인만 쓸 수 있으므로 건드리지 않음.
            //  각 클라이언트가 방 삭제를 감지해 스스로 정리함 - restoreRoomSession 참고)
            await remove(roomRef);
            console.log('방이 삭제되었습니다:', roomId);

            // 4. 내 상태 정리
            await update(ref(database, `userStatus/${userId}`), {
              currentRoom: null,
              lastActivity: serverTimestamp()
            });
          } else {
            // 일반 참여자인 경우: 자신만 방에서 나가기
            const success = await leaveRoom(roomId, userId);
            
            if (success) {
              console.log('방 나가기 성공');
              
              // 방 관련 정보 삭제 - 간소화됨
              await remove(ref(database, `rooms/${roomId}/joinedPlayers/${userId}`));
              await remove(ref(database, `rooms/${roomId}/members/${userId}`));
              
              // 사용자 상태 업데이트
              await update(ref(database, `userStatus/${userId}`), {
                currentRoom: null,
                lastActivity: serverTimestamp()
              });
              
              console.log('방 연결 정보 제거됨');
            } else {
              console.error('방 나가기 실패');
            }
          }
        } catch (error) {
          console.error('방 나가기 중 오류:', error);
        }
      }, 500);
    } catch (error) {
      console.error('방 나가기 중 오류:', error);
      setError('방 나가기 중 오류가 발생했습니다.');
    }
  };
  
  // 상대방 플레이어 표시 로직 수정
  const renderOpponentInfo = () => {
    if (!gameState || !gameState.players) {
      return <div className="text-center px-2 py-1 rounded-lg bg-gray-100 text-xs">대기</div>;
    }
    
    const players = Object.keys(gameState.players)
      .filter(id => id !== userId)
      .map(id => {
        // 플레이어 정보에 displayName과 hasLeft 속성이 없는 경우 기본값 설정
        const player = gameState.players[id];
        return {
          id,
          ...player,
          displayName: player.displayName || null,
          hasLeft: player.hasLeft || false,
          isOnline: playersStatus[id] === true,
          photoURL: player.photoURL || null
        };
      });
    
    if (players.length === 0) {
      return <div className="text-center px-2 py-1 rounded-lg bg-gray-100 text-xs">대기</div>;
    }
    
    return (
      <>
        {players.map(player => (
          <div key={player.id} className="text-center px-2 py-1 rounded-lg bg-gray-100">
            <div className="flex items-center justify-center gap-1 text-xs">
              {player.photoURL ? (
                <img 
                  src={player.photoURL} 
                  alt="상대방 프로필" 
                  className="w-5 h-5 rounded-full object-cover"
                />
              ) : (
                <div className="w-5 h-5 rounded-full bg-red-500 flex items-center justify-center">
                  <span className="text-white text-[8px]">상대</span>
                </div>
              )}
              <span>
                {player.displayName ? player.displayName.substring(0, 6) : '상대'} 
                {player.isReady ? ' ✓' : ''}
              </span>
              <span className={player.isOnline ? 'text-green-600' : 'text-red-600'}>
                {player.isOnline ? '●' : '○'}
              </span>
            </div>
          </div>
        ))}
      </>
    );
  };
  
  // 내 정보 표시 로직 추가
  const renderMyInfo = () => {
    if (!gameState || !gameState.players || !gameState.players[userId]) {
      return <div className="text-center px-2 py-1 rounded-lg bg-gray-100 text-xs">내 정보 로딩 중...</div>;
    }
    
    const me = gameState.players[userId];
    
    return (
      <div className="text-center px-2 py-1 rounded-lg bg-gray-100">
        <div className="flex items-center justify-center gap-1 text-xs">
          {me.photoURL ? (
            <img 
              src={me.photoURL} 
              alt="내 프로필" 
              className="w-5 h-5 rounded-full object-cover"
            />
          ) : (
            <div className="w-5 h-5 rounded-full bg-blue-500 flex items-center justify-center">
              <span className="text-white text-[8px]">나</span>
            </div>
          )}
          <span>
            {me.displayName ? me.displayName.substring(0, 6) : '나'} 
            {me.isReady ? ' ✓' : ''}
          </span>
        </div>
      </div>
    );
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
      // 컴포넌트 언마운트 시 필요한 정리 작업
      if (roomId && userId) {
        // 게임방에서 나갈 때 온라인 상태 오프라인으로 변경
        updateRoomUserStatus(roomId, userId, false)
          .then(() => console.log('게임방 나가기: 온라인 상태 오프라인으로 변경됨'));
      }
    };
  }, [roomId, userId]);
  
  // 전적 표시 함수
  const renderStats = () => {
    if (!roomStats || Object.keys(roomStats).length === 0) {
      return null;
    }
    
    return (
      <div className="w-full max-w-md mx-auto mb-3 bg-gray-50 rounded-md p-2">
        <h3 className="text-sm font-medium text-center mb-1">이 방에서의 전적</h3>
        <div className="text-xs">
          {roomStats[userId] ? (
            <span>
              전적: <span className="text-green-600">{roomStats[userId].wins}</span>승 
              <span className="mx-0.5">-</span> 
              <span className="text-red-600">{roomStats[userId].losses}</span>패
            </span>
          ) : (
            <span>전적: 0승 0패</span>
          )}
        </div>
      </div>
    );
  };
  
  // UI 개선 - 플레이어 정보 및 상태 통합 표시
  const renderGameHeader = () => {
    if (!gameState || !gameState.players) return null;
    
    const me = gameState.players[userId];
    const opponent = Object.values(gameState.players).find(p => p.id !== userId);
    
    return (
      <div className="w-full max-w-md mx-auto bg-gray-50 rounded-md p-2 mb-2">
        <div className="flex justify-between items-center">
          {/* 방 제목 및 상태 */}
          <div className="text-sm font-bold">
            {roomData?.name || '게임 방'}
            <span className="text-xs font-normal ml-2 text-gray-500">
              {gameState.phase === GamePhase.SETUP ? '맵 제작' : 
               gameState.phase === GamePhase.PLAY ? '게임 진행' : '게임 종료'}
            </span>
          </div>
          
          {/* 전적 정보 - 간결하게 표시 */}
          <div className="text-xs">
            {roomStats[userId] ? (
              <span>
                전적: <span className="text-green-600">{roomStats[userId].wins}</span>승
                <span className="mx-0.5">-</span>
                <span className="text-red-600">{roomStats[userId].losses}</span>패
                {(roomStats[userId].draws || 0) > 0 && (
                  <>
                    <span className="mx-0.5">-</span>
                    <span className="text-gray-600">{roomStats[userId].draws}</span>무
                  </>
                )}
              </span>
            ) : (
              <span>전적: 0승 0패</span>
            )}
          </div>
        </div>
        
        {/* 플레이어 정보 행 */}
        <div className="flex justify-between mt-1 text-xs">
          {/* 내 정보 */}
          <div className="flex items-center">
            {me?.photoURL ? (
              <img src={me.photoURL} alt="내 프로필" className="w-4 h-4 rounded-full mr-1" />
            ) : (
              <div className="w-4 h-4 rounded-full bg-blue-500 mr-1 flex items-center justify-center">
                <span className="text-white text-[6px]">나</span>
              </div>
            )}
            {me?.displayName?.substring(0, 6) || '나'} 
            {me?.isReady ? ' ✓' : ''}
          </div>
          
          {/* 턴 표시 */}
          {gameState.phase === GamePhase.PLAY && (
            me?.finished ? (
              <div className="px-1 rounded bg-purple-100 text-purple-700">관전 중</div>
            ) : (
              <div className={`px-1 rounded ${gameState.currentTurn === userId ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-600'}`}>
                {gameState.currentTurn === userId ? '내 턴' : '상대 턴'}
              </div>
            )
          )}
          
          {/* 상대방 정보 */}
          {opponent ? (
            <div className="flex items-center">
              {opponent?.photoURL ? (
                <img src={opponent.photoURL} alt="상대 프로필" className="w-4 h-4 rounded-full mr-1" />
              ) : (
                <div className="w-4 h-4 rounded-full bg-red-500 mr-1 flex items-center justify-center">
                  <span className="text-white text-[6px]">상대</span>
                </div>
              )}
              {opponent?.displayName?.substring(0, 6) || '상대'} 
              {opponent?.isReady ? ' ✓' : ''}
              <span className={playersStatus[opponent.id] ? 'text-green-600 ml-1' : 'text-red-600 ml-1'}>
                {playersStatus[opponent.id] ? '●' : '○'}
              </span>
            </div>
          ) : (
            <div className="text-gray-400">대기 중...</div>
          )}
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
          <div className="text-center p-8 bg-red-100 rounded-lg">
            <h2 className="text-2xl font-bold mb-4 text-red-700">인증 오류</h2>
            <p>{verifyError || '유효하지 않은 사용자 ID입니다. 다시 로그인해주세요.'}</p>
            <button 
              className="mt-4 px-6 py-2 bg-blue-500 text-white rounded hover:bg-blue-600 transition-colors"
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
            <h2 className="text-2xl font-bold mb-4">게임 로딩</h2>
            <div className="w-12 h-12 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto"></div>
          </div>
        </div>
      );
    }
    
    // 메인 게임 컨텐츠
    return (
      <div className="container mx-auto px-2 sm:px-4 py-2 sm:py-4">
        {/* 통합된 헤더 정보 표시 */}
        {renderGameHeader()}

        {/* 오류/안내 메시지 */}
        {message && gameState.phase !== GamePhase.END && (
          <div className="text-center mb-2">
            <p className="text-xs font-medium bg-amber-50 text-amber-700 py-1 px-2 rounded inline-block">
              {message}
            </p>
          </div>
        )}

        {/* 선턴 메시지 표시 */}
        {gameState.phase === GamePhase.SETUP && (
          <div className="text-center mb-2">
            {restartMessage && (
              <p className="text-xs font-medium bg-blue-50 text-blue-700 py-1 px-2 rounded inline-block">
                {restartMessage}
              </p>
            )}
            {gameState.currentTurn === userId && gameState.phase === GamePhase.SETUP && (
              <p className="text-xs font-medium bg-green-50 text-green-700 py-1 px-2 rounded inline-block mt-1">
                선턴입니다. 맵을 설정해주세요.
              </p>
            )}
          </div>
        )}
        
        {/* 게임 종료 메시지 */}
        {gameState.phase === GamePhase.END && (
          <div className="text-center mb-2">
            <p className={`text-sm font-bold ${
              gameState.draw
                ? 'text-gray-600'
                : gameState.winner === userId
                  ? 'text-green-500'
                  : 'text-red-500'
            }`}>
              {getWinnerMessage()}
            </p>

            {/* 재시작 버튼 (게임 보드는 아래에서 같은 인스턴스로 계속 표시됨) */}
            <div className="flex gap-3 mt-3 justify-center">
              <button
                className="px-3 py-1 text-xs bg-blue-500 text-white rounded hover:bg-blue-600 transition-colors"
                onClick={handleRestartGame}
              >
                재시작
              </button>
              
              <button
                className="px-3 py-1 text-xs bg-gray-500 text-white rounded hover:bg-gray-600 transition-colors"
                onClick={handleLeaveRoom}
              >
                나가기
              </button>
            </div>
          </div>
        )}
        
        {/* 게임 컴포넌트 */}
        {gameState.phase === GamePhase.SETUP && !isReady ? (
          <div key="setup-container">
            <GameSetup onMapComplete={handleMapComplete} />
            <div className="flex justify-center mt-2">
              <button
                className="px-3 py-1 text-xs bg-gray-500 text-white rounded hover:bg-gray-600 transition-colors"
                onClick={handleLeaveRoom}
              >
                나가기
              </button>
            </div>
          </div>
        ) : gameState.phase === GamePhase.SETUP && isReady ? (
          <div key="waiting-container" className="text-center p-3">
            <p className="text-sm mb-2">상대방 준비 대기</p>
            <div className="w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto"></div>
            <div className="flex justify-center mt-3">
              <button
                className="px-3 py-1 text-xs bg-gray-500 text-white rounded hover:bg-gray-600 transition-colors"
                onClick={handleLeaveRoom}
              >
                나가기
              </button>
            </div>
          </div>
        ) : (gameState.phase === GamePhase.PLAY || gameState.phase === GamePhase.END) && opponentMap ? (
          /* PLAY -> END 전환 시에도 같은 GamePlay 인스턴스를 유지해
             3D 캔버스가 파괴/재생성되지 않도록 한다 */
          <div key="gameplay-container">
            <GamePlay
              map={opponentMap}
              onGameComplete={handleGameComplete}
              userId={userId}
              roomId={roomId}
              currentTurn={gameState.currentTurn || null}
              myMap={myMap || undefined}
              gameEnded={gameState.phase === GamePhase.END}
              myFinished={!!gameState.players?.[userId]?.finished}
              myFinishMoves={gameState.players?.[userId]?.finishMoves ?? null}
              opponentFinished={Object.entries(gameState.players || {}).some(
                ([id, p]) => id !== userId && p.finished
              )}
              opponentFinishMoves={
                Object.entries(gameState.players || {}).find(
                  ([id, p]) => id !== userId && p.finished
                )?.[1]?.finishMoves ?? null
              }
              onForfeit={handleForfeit}
            />
          </div>
        ) : gameState.phase === GamePhase.END ? (
          <div key="gameover-container" className="flex flex-col items-center">
            {/* 맵 정보가 없는 상태로 종료된 경우 (보드 없이 결과만 표시) */}
          </div>
        ) : (
          <div key="loading-container" className="text-center p-3">
            <p className="text-sm">게임 로딩</p>
            <div className="w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto mt-2"></div>
          </div>
        )}
      </div>
    );
  };
  
  // 컴포넌트의 실제 렌더링은 여기서 한 번만 이루어짐
  return renderContent();
};

export default GameRoom; 