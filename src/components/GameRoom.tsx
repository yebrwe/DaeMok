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
  
  // 플레이어 목록 계산 - null-safe 방식으로 항상 값을 가지도록 함
  const players = gameState ? Object.values(gameState.players || {}) : [];
  
  // 승자 메시지 함수를 useCallback으로 메모이제이션
  const getWinnerMessage = useCallback(() => {
    if (!gameState || !gameState.winner) return '';
    
    const isWinner = gameState.winner === userId;
    return isWinner ? '축하합니다! 당신이 승리했습니다!' : '안타깝게도 상대방이 승리했습니다.';
  }, [gameState?.winner, userId]);
  
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
  
  // 게임 재시작 처리
  const handleRestartGame = async () => {
    // 맵 생성 단계로 돌아가기
    setIsReady(false);
    setMyMap(null);
    setOpponentMap(null); // 상대방 맵도 초기화
    
    // Firebase에서 게임 상태 초기화
    const database = getDatabase();
    const gameStateRef = ref(database, `rooms/${roomId}/gameState`);
    
    try {
      // 현재 플레이어 상태 정보 저장 (위치 포함)
      const playersRef = ref(database, `rooms/${roomId}/gameState/players`);
      const playersSnapshot = await get(playersRef);
      const players = playersSnapshot.val() || {};
      
      // 기존 플레이어 위치 정보 보존
      const preservedPlayersData = {};
      Object.keys(players).forEach(playerId => {
        preservedPlayersData[playerId] = {
          ...players[playerId],
          isReady: false,
          // 위치 정보는 유지
          position: players[playerId].position,
          lastPosition: players[playerId].position,
          // 표시 이름도 유지
          displayName: players[playerId].displayName
        };
      });
      
      // 게임 상태 업데이트 (플레이어 정보 보존)
      await update(gameStateRef, {
        phase: GamePhase.SETUP,
        winner: null,
        maps: null, // null로 설정하여 완전히 초기화
        collisionWalls: null, // null로 설정하여 완전히 초기화
        currentTurn: null,
        players: preservedPlayersData  // 플레이어 상태 정보 유지
      });
      
      // 맵 데이터를 완전히 제거하기 위한 추가 조치
      const mapsRef = ref(database, `rooms/${roomId}/gameState/maps`);
      await remove(mapsRef);
      
      // 충돌 벽 데이터도 완전히 제거
      const wallsRef = ref(database, `rooms/${roomId}/gameState/collisionWalls`);
      await remove(wallsRef);
      
      setMessage('게임이 재시작됩니다. 맵을 생성해주세요.');
    } catch (error) {
      console.error('게임 재시작 중 오류:', error);
      setMessage('게임 재시작 중 오류가 발생했습니다.');
    }
  };
  
  // 방 나가기 핸들러 (명시적으로 로비로 돌아갈 때 호출)
  const handleLeaveRoom = async () => {
    if (!roomId || !userId) return;
    
    try {
      const database = getDatabase();
      const roomRef = ref(database, `rooms/${roomId}`);
      const roomSnapshot = await get(roomRef);
      const roomData = roomSnapshot.val();
      
      if (!roomData) {
        console.error('방 정보를 찾을 수 없습니다.');
        router.push('/rooms');
        return;
      }
      
      // 방장 확인 (createdBy 필드 확인)
      const isRoomOwner = roomData.createdBy === userId;
      
      // 먼저 사용자 상태 업데이트 (방을 떠났다고 표시)
      const userPath = `rooms/${roomId}/gameState/players/${userId}`;
      const userRef = ref(database, userPath);
      await update(userRef, { hasLeft: true });
      
      // 게임방에서 오프라인 상태로 설정 (새로운 함수 사용)
      await updateRoomUserStatus(roomId, userId, false);
      
      // 플레이어 목록에서 자신 제거
      const updatedPlayers = roomData.players.filter((id: string) => id !== userId);
      
      // 방장이 나가거나 남은 플레이어가 없는 경우 방 삭제, 아니면 플레이어 목록 업데이트
      let needsDelete = isRoomOwner || updatedPlayers.length === 0;
      
      // 먼저 리디렉션 실행 (타이밍 이슈 방지)
      router.push('/rooms');
      
      // 리디렉션 후 비동기적으로 방 처리
      setTimeout(async () => {
        try {
          if (needsDelete) {
            await remove(roomRef);
            console.log(isRoomOwner ? '방장이 나가서 방이 삭제되었습니다.' : '모든 플레이어가 나가서 방이 삭제되었습니다.');
          } else {
            // 남은 플레이어가 있으면 방 유지, 플레이어 목록만 업데이트
            await update(roomRef, { players: updatedPlayers });
            console.log('방에서 나갔습니다. 다른 플레이어가 남아있어 방은 유지됩니다.');
          }
        } catch (innerError) {
          console.error('방 처리 중 내부 오류:', innerError);
        }
      }, 500); // 리디렉션 후 약간의 지연을 두고 처리
      
    } catch (error) {
      console.error('방 나가기 중 오류:', error);
      setMessage('방을 나가는 데 문제가 발생했습니다.');
      // 오류가 발생해도 사용자를 방 목록으로 리디렉션
      router.push('/rooms');
    }
  };
  
  // 상대방 플레이어 표시 로직 수정
  const renderOpponentInfo = () => {
    if (!gameState || !gameState.players) {
      return <div>상대방을 기다리는 중...</div>;
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
          isOnline: playersStatus[id] === true
        };
      });
    
    if (players.length === 0) {
      return <div>상대방을 기다리는 중...</div>;
    }
    
    return (
      <>
        {players.map(player => (
          <div key={player.id} className="mb-4">
            <h3 className="text-lg font-medium">
              {player.displayName || '익명 상대방'}
              <span className={`ml-2 text-sm font-normal ${player.isOnline ? 'text-green-600' : 'text-red-600'}`}>
                {player.isOnline ? '(온라인)' : '(오프라인)'}
              </span>
            </h3>
            <p>
              상태: {player.isReady ? '준비 완료' : '준비 중'}
              {!player.isOnline && player.hasLeft && 
                <span className="ml-2 text-red-500">방을 나갔습니다</span>
              }
            </p>
          </div>
        ))}
      </>
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
            displayName: displayName // 여기도 표시 이름 추가
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
            <p className="mt-4">인증 상태 확인 중...</p>
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
            <h2 className="text-2xl font-bold mb-4">게임 로딩 중...</h2>
            <div className="w-12 h-12 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto"></div>
          </div>
        </div>
      );
    }
    
    // 메인 게임 컨텐츠
    return (
      <div className="container mx-auto p-4">
        <h1 className="text-2xl font-bold text-center mb-6">
          {gameState.phase === GamePhase.SETUP
            ? '맵 제작 단계'
            : gameState.phase === GamePhase.PLAY
              ? '게임 플레이 단계'
              : '게임 종료'}
        </h1>
        
        {/* 플레이어 정보 */}
        <div className="flex justify-around mb-6">
          {/* 내 플레이어 정보 */}
          {gameState.players && gameState.players[userId] && (
            <div className="text-center p-3 rounded-lg bg-blue-100">
              <div className="font-medium">나</div>
              <div className="text-sm">
                {gameState.players[userId].isReady ? '준비 완료' : '준비 중...'}
              </div>
            </div>
          )}

          {/* 상대방 플레이어 정보 - 렌더링 함수 사용 */}
          {renderOpponentInfo()}
        </div>
        
        {/* 게임 종료 메시지 */}
        {gameState.phase === GamePhase.END && (
          <div className="flex flex-col items-center w-full">
            <h2 className={`text-2xl font-bold mb-4 ${gameState.winner === userId ? 'text-green-500' : gameState.winner ? 'text-red-500' : ''}`}>
              {message}
            </h2>
            
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
            <div className="flex gap-4 mt-6">
              <button
                className="px-6 py-2 bg-blue-500 text-white rounded hover:bg-blue-600 transition-colors"
                onClick={handleRestartGame}
              >
                게임 재시작
              </button>
              
              <button
                className="px-6 py-2 bg-gray-500 text-white rounded hover:bg-gray-600 transition-colors"
                onClick={handleLeaveRoom}
              >
                방 나가기
              </button>
            </div>
          </div>
        )}
        
        {/* 게임 컴포넌트 */}
        {gameState.phase === GamePhase.SETUP && !isReady ? (
          <div key="setup-container">
            <GameSetup onMapComplete={handleMapComplete} />
            <div className="flex justify-center mt-4">
              <button
                className="px-6 py-2 bg-gray-500 text-white rounded hover:bg-gray-600 transition-colors"
                onClick={handleLeaveRoom}
              >
                방 나가기
              </button>
            </div>
          </div>
        ) : gameState.phase === GamePhase.SETUP && isReady ? (
          <div key="waiting-container" className="text-center p-8">
            <h2 className="text-xl font-bold mb-4">맵 제작 완료</h2>
            <p>상대방이 맵을 제작할 때까지 기다리고 있습니다...</p>
            <div className="w-12 h-12 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto mt-4"></div>
            <div className="flex justify-center mt-6">
              <button
                className="px-6 py-2 bg-gray-500 text-white rounded hover:bg-gray-600 transition-colors"
                onClick={handleLeaveRoom}
              >
                방 나가기
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
            <div className="flex justify-center mt-4">
              <button
                className={`px-6 py-2 ${gameState.phase === GamePhase.PLAY ? 'bg-gray-300 cursor-not-allowed' : 'bg-gray-500 hover:bg-gray-600'} text-white rounded transition-colors`}
                onClick={handleLeaveRoom}
                disabled={gameState.phase === GamePhase.PLAY}
                title={gameState.phase === GamePhase.PLAY ? "게임 진행 중에는 방을 나갈 수 없습니다" : "방 나가기"}
              >
                방 나가기
              </button>
            </div>
          </div>
        ) : gameState.phase === GamePhase.END ? (
          <div key="gameover-container" className="flex flex-col items-center">
            <button
              className="px-6 py-3 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition mt-8"
              onClick={handleLeaveRoom}
            >
              방 나가기
            </button>
          </div>
        ) : (
          <div key="loading-container" className="text-center p-8">
            <p>게임을 불러오는 중입니다...</p>
          </div>
        )}
      </div>
    );
  };
  
  // 컴포넌트의 실제 렌더링은 여기서 한 번만 이루어짐
  return renderContent();
};

export default GameRoom; 