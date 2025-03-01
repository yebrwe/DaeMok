'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { GameMap, GamePhase, Player } from '@/types/game';
import GameSetup from './GameSetup';
import GamePlay from './GamePlay';
import { useGameState } from '@/hooks/useFirebase';
import { 
  placeObstacles, 
  setPlayerReady, 
  endGame, 
  leaveRoom,
  tryRestoreAuth,
  updateRoomUserStatus,
  getRoomOnlineUsers
} from '@/lib/firebase';
import { useRouter } from 'next/navigation';
import { getDatabase, ref, update, get, remove, onValue, query, orderByChild, equalTo, serverTimestamp } from 'firebase/database';
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
  
  // 플레이어 목록 계산 - null-safe 방식으로 항상 값을 가지도록 함
  const players = gameState ? Object.values(gameState.players || {}) : [];
  
  // 승자 메시지 함수를 useCallback으로 메모이제이션
  const getWinnerMessage = useCallback(() => {
    if (!gameState || !gameState.winner) return '';
    
    const isWinner = gameState.winner === userId;
    return isWinner ? '승리했습니다!' : '패배했습니다.';
  }, [gameState?.winner, userId]);
  
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
    
    // 디버깅: ID 체크
    console.log('현재 사용자 ID 확인:', userId);
    if (!userId) {
      console.error('GameRoom: 유효하지 않은 사용자 ID');
    }
    
    // 상세 게임 상태 로깅
    console.log('게임 상태 변경 감지:', {
      phase: gameState.phase,
      playersCount: gameState.players ? Object.keys(gameState.players).length : 0,
      mapsCount: gameState.maps ? Object.keys(gameState.maps).length : 0,
      currentTurn: gameState.currentTurn,
      winner: gameState.winner,
      userId: userId
    });
    
    // 플레이어 ID 로깅 (디버깅용)
    if (gameState.players) {
      console.log('방 내 모든 플레이어 ID:', Object.keys(gameState.players));
    }
    
    // 플레이어 정보 로깅
    if (gameState.players) {
      console.log('플레이어 정보:', Object.values(gameState.players).map(p => ({
        id: p.id,
        isReady: p.isReady,
        position: p.position
      })));
    }
    
    // 플레이어 정보 업데이트
    if (gameState.players) {
      const me = gameState.players[userId];
      if (me) {
        setIsReady(me.isReady);
        console.log(`내 준비 상태: ${me.isReady}`);
      }
      
      // 새로고침 후에도 상대방 정보가 제대로 표시되도록 수정
      const playerIds = Object.keys(gameState.players);
      
      // 방에 다른 플레이어가 있는지 확인하고 표시
      if (playerIds.length > 1) {
        console.log('다른 플레이어가 방에 있습니다.');
      } else {
        console.log('현재 방에 혼자 있습니다.');
      }
    }
    
    // 게임 맵 업데이트
    if (gameState.maps) {
      console.log('게임 맵 정보:', Object.keys(gameState.maps));
      
      // 내 맵과 상대방 맵 구분
      const mapEntries = Object.entries(gameState.maps);
      for (const [playerId, map] of mapEntries) {
        if (playerId === userId) {
          setMyMap(map);
          console.log('내 맵 설정됨');
        } else {
          setOpponentMap(map);
          console.log('상대방 맵 설정됨');
        }
      }
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
    console.log('맵 설정 완료 처리 시작');
    try {
      if (!userId) {
        console.error('유효하지 않은 사용자 ID');
        setMessage('유효하지 않은 사용자 ID입니다. 다시 로그인해주세요.');
        return;
      }
      
      // 맵 저장
      console.log('맵 저장 시작');
      await placeObstacles(roomId, userId, map);
      console.log('맵 저장 및 준비 완료');
      
      // 준비 완료는 placeObstacles 내에서 자동으로 처리됨
      setIsReady(true);
    } catch (error) {
      console.error('맵 설정 오류:', error);
    }
  };
  
  // 게임 종료 처리
  const handleGameComplete = async (moves: number) => {
    console.log(`게임 완료! 총 ${moves}번 이동했습니다.`);
    
    // 게임 종료 상태로 변경하되, 화면은 유지
    if (gameState?.phase !== GamePhase.END) {
      // updateGamePhase 함수 정의
      const updateGamePhase = async (phase: GamePhase) => {
        const database = getDatabase();
        const gameStateRef = ref(database, `rooms/${roomId}/gameState`);
        await update(gameStateRef, { phase });
      };
      
      await updateGamePhase(GamePhase.END);
    }
    
    // Firebase에 승리자 정보 기록
    const database = getDatabase();
    const gameStateRef = ref(database, `rooms/${roomId}/gameState`);
    
    try {
      await update(gameStateRef, { 
        winner: userId,
        phase: GamePhase.END 
      });
      
      // 승리 메시지 표시
      setMessage(`축하합니다! ${moves}번 이동으로 게임을 완료했습니다. 다시 게임을 시작하려면 재시작 버튼을 클릭하세요.`);
    } catch (error) {
      console.error('게임 완료 처리 중 오류:', error);
      setMessage('게임 완료 처리 중 오류가 발생했습니다.');
    }
  };
  
  // 게임 재시작 함수 수정
  const handleRestartGame = async () => {
    if (!roomId || !gameState) return;
    
    try {
      const database = getDatabase();
      
      // 게임 상태 초기화
      const gameStateRef = ref(database, `rooms/${roomId}/gameState`);
      
      // 패배한 사람이 먼저 턴을 갖도록 설정
      let firstTurnPlayerId = userId;
      let turnMessage = '';
      
      if (gameState.winner === userId) {
        // 내가 이겼다면, 상대방이 먼저 시작
        const otherPlayers = Object.keys(gameState.players || {}).filter(id => id !== userId);
        if (otherPlayers.length > 0) {
          firstTurnPlayerId = otherPlayers[0];
          turnMessage = `${gameState.players[firstTurnPlayerId]?.displayName || '상대방'}이(가) 선턴을 가져갑니다.`;
          console.log('이전 게임 패배자(상대방)가 선턴을 가져갑니다:', firstTurnPlayerId);
        }
      } else if (gameState.winner && gameState.winner !== userId) {
        // 상대방이 이겼다면, 내가 먼저 시작
        turnMessage = `${gameState.players[userId]?.displayName || '당신'}이(가) 선턴을 가져갑니다.`;
        console.log('이전 게임 패배자(나)가 선턴을 가져갑니다:', userId);
        firstTurnPlayerId = userId;
      } else {
        // 승자가 없는 경우(첫 게임 등) 랜덤으로 선택
        const playerIds = Object.keys(gameState.players || {});
        const randomIndex = Math.floor(Math.random() * playerIds.length);
        firstTurnPlayerId = playerIds[randomIndex];
        turnMessage = `${gameState.players[firstTurnPlayerId]?.displayName || (firstTurnPlayerId === userId ? '당신' : '상대방')}이(가) 선턴을 가져갑니다.`;
        console.log('랜덤으로 선턴 결정:', firstTurnPlayerId);
      }
      
      // 선턴 메시지 설정 - 로컬 상태
      setRestartMessage(turnMessage);
      
      // 선턴 메시지를 Firebase에 저장하여 모든 플레이어가 볼 수 있게 함
      await update(gameStateRef, {
        phase: GamePhase.SETUP,
        winner: null,
        currentTurn: firstTurnPlayerId,
        maps: null,
        collisionWalls: null,
        turnMessage: turnMessage,  // 선턴 메시지 저장
        turnMessageTimestamp: serverTimestamp()  // 메시지 타임스탬프
      });
      
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
            isReady: false
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
      
      // 세션 스토리지에 방 나가기 표시 (재입장 방지용)
      sessionStorage.setItem(`left_room_${roomId}`, 'true');
      
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
      
      // 방 나가기 함수 호출 (비동기적으로 처리)
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
            
            // 3. 방에 있는 모든 플레이어 목록 가져오기
            const playersRef = ref(database, `rooms/${roomId}/players`);
            const playersSnapshot = await get(playersRef);
            const players = playersSnapshot.val() || [];
            
            // 4. 각 플레이어의 userRooms에서 해당 방 정보 제거
            for (const playerId of players) {
              if (playerId) {
                await remove(ref(database, `userRooms/${playerId}/${roomId}`));
                console.log(`플레이어 ${playerId}의 방 연결 정보 제거됨`);
                
                // 플레이어 상태 업데이트
                await update(ref(database, `userStatus/${playerId}`), {
                  currentRoom: null,
                  lastActivity: serverTimestamp()
                });
              }
            }
            
            // 5. 방 자체를 삭제
            await remove(roomRef);
            console.log('방이 삭제되었습니다:', roomId);
            
            // 6. 로컬 스토리지에 방 삭제 표시
            localStorage.setItem(`deleted_room_${roomId}`, 'true');
          } else {
            // 일반 참여자인 경우: 자신만 방에서 나가기
            const success = await leaveRoom(roomId, userId);
            
            if (success) {
              console.log('방 나가기 성공');
              
              // 사용자-방 연결 정보 완전히 제거 (재입장 방지)
              await remove(ref(database, `userRooms/${userId}/${roomId}`));
              await remove(ref(database, `rooms/${roomId}/joinedPlayers/${userId}`));
              await remove(ref(database, `rooms/${roomId}/members/${userId}`));
              
              // 사용자 상태 업데이트
              await update(ref(database, `userStatus/${userId}`), {
                currentRoom: null,
                lastActivity: serverTimestamp()
              });
              
              console.log('모든 방 연결 정보 완전히 제거됨');
              
              // 로컬 스토리지에도 방 나가기 표시 (영구적)
              localStorage.setItem(`left_room_${roomId}`, 'true');
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
          
          let initialPosition = { row: 0, col: 0 };
          
          // 이전 위치 정보가 있으면 사용, 아니면 초기 위치 사용
          if (playerSnapshot.exists()) {
            const playerData = playerSnapshot.val();
            // lastPosition이 있으면 사용, 아니면 현재 position 사용
            initialPosition = playerData.lastPosition || playerData.position || initialPosition;
            
            // 플레이어 정보 업데이트 (마지막 위치 보존)
            await update(ref(database, playerPath), {
              id: userId,
              position: initialPosition,
              lastPosition: initialPosition,  // 마지막 위치 정보 저장
              isReady: false,
              isOnline: true,
              displayName: displayName, // 구글 표시 이름 추가
              photoURL: photoURL, // 프로필 이미지 URL 추가
              lastSeen: serverTimestamp()
            });
          } else {
            // 새 플레이어 추가
            await update(ref(database, playerPath), {
              id: userId,
              position: initialPosition,
              lastPosition: initialPosition,  // 마지막 위치 정보도 저장
              isReady: false,
              isOnline: true,
              displayName: displayName, // 구글 표시 이름 추가
              photoURL: photoURL, // 프로필 이미지 URL 추가
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
        sessionStorage.setItem(`left_room_${roomId}`, 'true');
        // 로컬 스토리지에 방 삭제 표시
        localStorage.setItem(`deleted_room_${roomId}`, 'true');
        
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
        // 세션 스토리지에 방 나가기 표시
        sessionStorage.setItem(`left_room_${roomId}`, 'true');
        // 로컬 스토리지에 방 삭제 표시
        localStorage.setItem(`deleted_room_${roomId}`, 'true');
        
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
        {/* 방 제목과 게임 상태를 함께 표시 */}
        <div className="flex flex-col items-center mb-2">
          <h1 className="text-lg font-bold">
            {roomData?.name || '게임 방'}
          </h1>
          <div className="text-xs text-gray-600 mt-1">
            {gameState.phase === GamePhase.SETUP
              ? '맵 제작'
              : gameState.phase === GamePhase.PLAY
                ? '게임 진행'
                : '게임 종료'}
          </div>
        </div>
        
        {/* 플레이어 정보 - 더 컴팩트하게 */}
        <div className="flex justify-center gap-4 mb-2">
          {/* 내 플레이어 정보 */}
          {renderMyInfo()}

          {/* 상대방 플레이어 정보 - 렌더링 함수 사용 */}
          {renderOpponentInfo()}
        </div>
        
        {/* 게임 종료 메시지 */}
        {gameState.phase === GamePhase.END && (
          <div className="flex flex-col items-center w-full">
            <p className={`text-lg font-bold mb-2 ${gameState.winner === userId ? 'text-green-500' : 'text-red-500'}`}>
              {getWinnerMessage()}
            </p>
            
            {/* 게임 종료 후에도 게임 상태는 계속 표시 */}
            {myMap && opponentMap && (
              <GamePlay
                map={opponentMap}
                userId={userId}
                roomId={roomId}
                currentTurn={gameState?.currentTurn || null}
                myMap={myMap}
                gameEnded={true}
              />
            )}
            
            {/* 재시작 버튼 */}
            <div className="flex gap-3 mt-3">
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
        
        {/* 게임 진행 중 턴 표시 */}
        {gameState.phase === GamePhase.PLAY && (
          <div className="mb-2">
            {renderTurnIndicator()}
          </div>
        )}
        
        {/* 게임 설정 단계에서 선턴 메시지 표시 */}
        {gameState.phase === GamePhase.SETUP && restartMessage && (
          <div className="text-center mb-3">
            <p className="text-sm font-medium bg-blue-50 text-blue-700 py-1 px-3 rounded inline-block">
              {restartMessage}
            </p>
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
        ) : gameState.phase === GamePhase.PLAY && opponentMap ? (
          <div key="gameplay-container">
            <GamePlay 
              map={opponentMap} 
              onGameComplete={handleGameComplete} 
              userId={userId}
              roomId={roomId}
              currentTurn={gameState.currentTurn}
              myMap={myMap || undefined}
            />
          </div>
        ) : gameState.phase === GamePhase.END ? (
          <div key="gameover-container" className="flex flex-col items-center">
            {/* 중복된 나가기 버튼 제거 */}
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