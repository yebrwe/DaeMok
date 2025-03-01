'use client';

import React, { useState, useEffect } from 'react';
import { CollisionWall, Direction, GameMap, GamePhase, Position } from '@/types/game';
import GameBoard from './GameBoard';
import { BOARD_SIZE, canMove, getNewPosition, isSamePosition } from '@/lib/gameUtils';
import { getDatabase, ref, update, get, onValue } from 'firebase/database';
import { getAuth } from 'firebase/auth';

interface GamePlayProps {
  map: GameMap;
  onGameComplete?: (moves: number) => void;
  userId: string;
  roomId: string;
  currentTurn: string | null;
  myMap?: GameMap; // 내가 만든 맵 정보 추가
  gameEnded?: boolean; // 게임 종료 여부
}

const GamePlay: React.FC<GamePlayProps> = ({ 
  map, 
  onGameComplete, 
  userId, 
  roomId, 
  currentTurn,
  myMap, // 내가 만든 맵 정보
  gameEnded = false
}) => {
  // 맵 데이터 안전하게 구조 분해
  const { 
    startPosition = { row: 0, col: 0 }, 
    endPosition = { row: 9, col: 9 }, 
    obstacles = [] // 기본값 빈 배열로 설정
  } = map || {};
  
  const [playerPosition, setPlayerPosition] = useState<Position>(startPosition);
  const [moveCount, setMoveCount] = useState<number>(0);
  const [gameOver, setGameOver] = useState<boolean>(false);
  const [lastMoveValid, setLastMoveValid] = useState<boolean | null>(null);
  const [message, setMessage] = useState<string>('게임을 시작합니다.');
  const [opponentPosition, setOpponentPosition] = useState<Position | null>(null);
  const [opponentId, setOpponentId] = useState<string | null>(null);
  const [collisionWalls, setCollisionWalls] = useState<CollisionWall[]>([]);
  const [opponentCollisionWalls, setOpponentCollisionWalls] = useState<CollisionWall[]>([]);
  const [playerPhotoURL, setPlayerPhotoURL] = useState<string | null>(null);
  const [opponentPhotoURL, setOpponentPhotoURL] = useState<string | null>(null);
  const [playerName, setPlayerName] = useState<string>('나');
  const [opponentName, setOpponentName] = useState<string>('상대방');
  
  const isMyTurn = currentTurn === userId;
  
  // 상대방 ID 및 위치 정보 구독
  useEffect(() => {
    const database = getDatabase();
    
    // 상대방 ID 찾기
    const fetchOpponent = async () => {
      try {
        const playersRef = ref(database, `rooms/${roomId}/gameState/players`);
        const playersSnapshot = await get(playersRef);
        const players = playersSnapshot.val() || {};
        
        // 나를 제외한 플레이어가 상대방
        const foundOpponentId = Object.keys(players).find(id => id !== userId);
        
        console.log('모든 플레이어 ID:', Object.keys(players));
        console.log('내 ID:', userId);
        console.log('찾은 상대방 ID:', foundOpponentId);
        
        if (foundOpponentId) {
          setOpponentId(foundOpponentId);
          console.log('상대방 ID 찾음:', foundOpponentId);
          
          // 상대방 위치 정보 구독
          const opponentPositionRef = ref(database, `rooms/${roomId}/gameState/players/${foundOpponentId}/position`);
          const unsubscribe = onValue(opponentPositionRef, (snapshot) => {
            const position = snapshot.val();
            if (position) {
              console.log('상대방 위치 업데이트:', position);
              setOpponentPosition(position);
            }
          });
          
          // cleanup 함수 반환
          return () => unsubscribe();
        } else {
          console.log('상대방을 찾을 수 없습니다.');
        }
      } catch (error) {
        console.error('상대방 정보 조회 중 오류:', error);
      }
    };
    
    // 함수 호출 및 unsubscribe 함수 저장
    const unsubscribePromise = fetchOpponent();
    
    // 컴포넌트 언마운트 시 구독 해제
    return () => {
      unsubscribePromise.then(unsubscribe => {
        if (unsubscribe) unsubscribe();
      });
    };
  }, [roomId, userId]);
  
  // 충돌 벽 정보 구독
  useEffect(() => {
    const database = getDatabase();
    const collisionWallsRef = ref(database, `rooms/${roomId}/gameState/collisionWalls`);
    
    const unsubscribe = onValue(collisionWallsRef, (snapshot) => {
      const walls = snapshot.val();
      if (walls) {
        // 내가 플레이하는 맵(상대방이 만든 맵)의 충돌 벽만 필터링
        const myWalls = Object.values(walls).filter(
          (wall: CollisionWall) => wall.mapOwnerId === opponentId
        ) as CollisionWall[];
        setCollisionWalls(myWalls);
        
        // 상대방이 플레이하는 맵(내가 만든 맵)의 충돌 벽만 필터링
        const opponentWalls = Object.values(walls).filter(
          (wall: CollisionWall) => wall.mapOwnerId === userId
        ) as CollisionWall[];
        setOpponentCollisionWalls(opponentWalls);
        
        console.log('충돌 벽 정보 업데이트:', walls);
      } else {
        setCollisionWalls([]);
        setOpponentCollisionWalls([]);
      }
    });
    
    return () => unsubscribe();
  }, [roomId, opponentId, userId]);
  
  // 사용자 프로필 이미지 가져오기
  useEffect(() => {
    const fetchUserProfiles = async () => {
      try {
        const database = getDatabase();
        const auth = getAuth();
        
        // 내 프로필 이미지 설정
        if (auth.currentUser?.photoURL) {
          setPlayerPhotoURL(auth.currentUser.photoURL);
        }
        
        // 상대방 ID가 있으면 상대방 프로필 이미지 가져오기
        if (opponentId) {
          // 게임방 내 플레이어 상태 정보에서 가져오기
          const playerStatusRef = ref(database, `rooms/${roomId}/playerStatus/${opponentId}`);
          const snapshot = await get(playerStatusRef);
          
          if (snapshot.exists()) {
            const userData = snapshot.val();
            if (userData.photoURL) {
              setOpponentPhotoURL(userData.photoURL);
            }
          } else {
            // 게임방 내 정보가 없으면 일반 사용자 정보에서 가져오기
            const userRef = ref(database, `lobbyOnline/${opponentId}`);
            const userSnapshot = await get(userRef);
            
            if (userSnapshot.exists()) {
              const userData = userSnapshot.val();
              if (userData.photoURL) {
                setOpponentPhotoURL(userData.photoURL);
              }
            }
          }
        }
      } catch (error) {
        console.error('프로필 이미지 가져오기 오류:', error);
      }
    };
    
    fetchUserProfiles();
  }, [userId, opponentId, roomId]);
  
  // 사용자 이름 가져오기
  useEffect(() => {
    const fetchUserNames = async () => {
      try {
        const database = getDatabase();
        const auth = getAuth();
        
        // 내 이름 설정
        const myPlayerRef = ref(database, `rooms/${roomId}/gameState/players/${userId}`);
        const mySnapshot = await get(myPlayerRef);
        
        if (mySnapshot.exists()) {
          const myData = mySnapshot.val();
          if (myData.displayName) {
            setPlayerName(myData.displayName);
          } else if (auth.currentUser?.displayName) {
            setPlayerName(auth.currentUser.displayName);
          }
        } else if (auth.currentUser?.displayName) {
          setPlayerName(auth.currentUser.displayName);
        }
        
        // 상대방 ID가 있으면 상대방 이름 가져오기
        if (opponentId) {
          // 게임방 내 플레이어 상태 정보에서 가져오기
          const opponentPlayerRef = ref(database, `rooms/${roomId}/gameState/players/${opponentId}`);
          const snapshot = await get(opponentPlayerRef);
          
          if (snapshot.exists()) {
            const userData = snapshot.val();
            if (userData.displayName) {
              setOpponentName(userData.displayName);
            }
          }
        }
      } catch (error) {
        console.error('사용자 이름 가져오기 오류:', error);
      }
    };
    
    fetchUserNames();
  }, [userId, opponentId, roomId]);
  
  // 턴 변경 함수
  const changeTurn = async () => {
    const database = getDatabase();
    const gameStateRef = ref(database, `rooms/${roomId}/gameState`);
    
    try {
      // 플레이어 목록에서 상대방 ID 찾기
      const playersRef = ref(database, `rooms/${roomId}/gameState/players`);
      const playersSnapshot = await get(playersRef);
      const players = playersSnapshot.val() || {};
      
      // 나를 제외한 플레이어가 상대방
      const opponentId = Object.keys(players).find(id => id !== userId);
      
      if (!opponentId) {
        console.error('상대방 플레이어를 찾을 수 없습니다.');
        return;
      }
      
      // 상대방 턴으로 설정
      await update(gameStateRef, { 
        currentTurn: opponentId
      });
      console.log('턴 변경 완료: 상대방 턴으로 변경됨', opponentId);
    } catch (error) {
      console.error('턴 변경 중 오류 발생:', error);
    }
  };
  
  // 플레이어 이동 처리 함수
  const handleMove = async (direction: Direction) => {
    if (gameOver) return;
    if (!isMyTurn) {
      setMessage('지금은 당신의 턴이 아닙니다.');
      return;
    }
    
    const newPosition = getNewPosition(playerPosition, direction);
    const canMoveResult = canMove(playerPosition, direction, obstacles);
    
    setLastMoveValid(canMoveResult);
    
    if (canMoveResult && 
        newPosition.row >= 0 && newPosition.row < BOARD_SIZE &&
        newPosition.col >= 0 && newPosition.col < BOARD_SIZE) {
      setPlayerPosition(newPosition);
      setMoveCount(moveCount + 1);
      setMessage('이동했습니다.');
      
      // 이동 후 Firebase 데이터베이스에 위치 업데이트
      const database = getDatabase();
      const playerPositionRef = ref(database, `rooms/${roomId}/gameState/players/${userId}/position`);
      try {
        await update(playerPositionRef, newPosition);
        console.log('플레이어 위치 업데이트 완료:', newPosition);
        
        // 목적지 도달 체크
        if (isSamePosition(newPosition, endPosition)) {
          setGameOver(true);
          setMessage(`축하합니다! ${moveCount + 1}턴 만에 도착지에 도달했습니다.`);
          
          if (onGameComplete) {
            onGameComplete(moveCount + 1);
          }
        } else {
          // 목적지에 도달하지 않았다면 턴 변경
          await changeTurn();
        }
      } catch (error) {
        console.error('위치 업데이트 중 오류 발생:', error);
      }
    } else {
      setMessage('이동할 수 없습니다. 장애물이 있습니다.');
      setMoveCount(moveCount + 1);
      
      // 이동할 수 없는 경우에도 턴을 소모
      try {
        await changeTurn();
        console.log('이동할 수 없어 턴만 소모됨');
      } catch (error) {
        console.error('턴 변경 중 오류 발생:', error);
      }
      
      // 이동 불가능할 경우 충돌 벽 정보를, 영구적으로 Firebase에 저장
      if (!canMoveResult) {
        const database = getDatabase();
        const collisionWallsRef = ref(database, `rooms/${roomId}/gameState/collisionWalls`);
        
        // 새 충돌 벽 데이터 생성
        const newCollisionWall: CollisionWall = {
          playerId: userId,
          position: playerPosition,
          direction: direction, // 정상 방향으로 저장
          timestamp: Date.now(),
          mapOwnerId: opponentId || '' // 내가 플레이하는 맵의 소유자(상대방)
        };
        
        // 기존 충돌 벽 목록 가져오기
        const wallsSnapshot = await get(collisionWallsRef);
        const existingWalls = wallsSnapshot.val() || [];
        
        // 새 충돌 벽 추가
        const updatedWalls = [...Object.values(existingWalls), newCollisionWall];
        
        // Firebase에 업데이트
        await update(ref(database, `rooms/${roomId}/gameState`), {
          collisionWalls: updatedWalls
        });
        
        console.log('충돌 벽 정보 저장됨:', newCollisionWall);
      }
    }
  };
  
  // 키보드 이벤트 처리
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (gameOver || !isMyTurn) return;
      
      switch (event.key) {
        case 'ArrowUp':
          handleMove('up');
          break;
        case 'ArrowDown':
          handleMove('down');
          break;
        case 'ArrowLeft':
          handleMove('left');
          break;
        case 'ArrowRight':
          handleMove('right');
          break;
      }
    };
    
    window.addEventListener('keydown', handleKeyDown);
    
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [gameOver, playerPosition, obstacles, isMyTurn, BOARD_SIZE]);
  
  // 게임 재시작 함수
  const handleRestartGame = async () => {
    // 플레이어 위치를 시작 위치로 초기화
    setPlayerPosition(startPosition);
    setMoveCount(0);
    setGameOver(false);
    setLastMoveValid(null);
    setMessage('게임 재시작');
    
    // 멀티플레이어 게임인 경우 Firebase 업데이트
    if (roomId && roomId !== 'practice-room') {
      const database = getDatabase();
      const playerPositionRef = ref(database, `rooms/${roomId}/gameState/players/${userId}/position`);
      try {
        // 위치 초기화
        await update(playerPositionRef, startPosition);
        console.log('플레이어 위치 초기화 완료:', startPosition);
        
        // 턴 초기화 (방의 방장 ID로 설정)
        const roomRef = ref(database, `rooms/${roomId}`);
        const roomSnapshot = await get(roomRef);
        const roomData = roomSnapshot.val();
        
        if (roomData && roomData.createdBy) {
          const gameStateRef = ref(database, `rooms/${roomId}/gameState`);
          await update(gameStateRef, { 
            currentTurn: roomData.createdBy 
          });
          console.log('턴 초기화 완료: 방장 턴으로 변경됨', roomData.createdBy);
        }
      } catch (error) {
        console.error('게임 재시작 중 오류 발생:', error);
      }
    }
  };
  
  // 게임 종료 상태 감지 및 처리
  useEffect(() => {
    if (gameEnded) {
      setGameOver(true);
      
      // 게임 종료 시 모든 벽 표시를 위해 충돌 벽 업데이트
      const allWalls: CollisionWall[] = [];
      
      // 모든 셀에 대해 장애물이 있는 방향을 충돌 벽으로 추가
      for (let row = 0; row < BOARD_SIZE; row++) {
        for (let col = 0; col < BOARD_SIZE; col++) {
          const position = { row, col };
          
          // 각 방향에 대해 장애물이 있는지 확인
          ['up', 'down', 'left', 'right'].forEach((dir) => {
            const direction = dir as Direction;
            const hasObstacleHere = obstacles.some(
              (o) => o.position.row === position.row && 
                    o.position.col === position.col && 
                    o.direction === direction
            );
            
            if (hasObstacleHere) {
              allWalls.push({
                playerId: userId || 'unknown',
                position,
                direction,
                timestamp: Date.now(),
                mapOwnerId: userId || 'unknown'
              });
            }
          });
        }
      }
      
      setCollisionWalls(allWalls);
    }
  }, [gameEnded, obstacles, BOARD_SIZE, userId]);
  
  return (
    <div className="flex flex-col items-center w-full max-w-2xl mx-auto">
      {/* 상단 정보 영역 - 플레이어 정보 추가 */}
      <div className="w-full flex justify-center items-center mb-2 px-2 gap-4">
        {/* 내 정보 */}
        <div className="flex items-center gap-1">
          {playerPhotoURL ? (
            <img 
              src={playerPhotoURL} 
              alt="Player" 
              className="w-5 h-5 rounded-full object-cover border border-blue-500"
            />
          ) : (
            <div className="w-5 h-5 rounded-full bg-blue-500 flex items-center justify-center">
              <span className="text-white text-[8px]">P</span>
            </div>
          )}
          <span className="text-xs">{playerName.substring(0, 6)}</span>
        </div>
        
        <div className="text-xs">이동: {moveCount}</div>
        
        <div className="text-xs text-center">
          {gameOver || gameEnded ? (
            <span className="text-green-600">종료</span>
          ) : (
            isMyTurn ? 
              <span className="text-blue-600">내 턴</span> : 
              <span className="text-gray-600">대기</span>
          )}
        </div>
        
        {/* 상대방 정보 */}
        {opponentId && (
          <div className="flex items-center gap-1">
            {opponentPhotoURL ? (
              <img 
                src={opponentPhotoURL} 
                alt="Opponent" 
                className="w-5 h-5 rounded-full object-cover border border-red-500"
              />
            ) : (
              <div className="w-5 h-5 rounded-full bg-red-500 flex items-center justify-center">
                <span className="text-white text-[8px]">O</span>
              </div>
            )}
            <span className="text-xs">{opponentName.substring(0, 6)}</span>
          </div>
        )}
      </div>
      
      {/* 메시지 표시 영역 */}
      {message && message !== '게임을 시작합니다.' && (
        <div 
          className={`text-xs mb-2 ${
            lastMoveValid === false 
              ? 'text-red-500' 
              : lastMoveValid === true 
                ? 'text-green-500' 
                : ''
          }`}
        >
          {message}
        </div>
      )}
      
      {/* 메인 게임 영역과 미니맵을 포함하는 컨테이너 */}
      <div className="flex flex-col md:flex-row w-full gap-2 items-center justify-center">
        {/* 메인 게임보드 - 상대방 맵에서 내가 플레이 */}
        <div className="flex-1 overflow-hidden flex justify-center">
          <div className="max-w-full overflow-auto">
            <GameBoard
              gamePhase={GamePhase.PLAY}
              startPosition={startPosition}
              endPosition={endPosition}
              playerPosition={playerPosition}
              obstacles={obstacles}
              collisionWalls={collisionWalls}
              readOnly={true}
              playerPhotoURL={playerPhotoURL || undefined}
            />
          </div>
        </div>
        
        {/* 미니맵 - 내가 만든 맵에서 상대방 플레이 */}
        {myMap && opponentPosition && (
          <div className="w-full md:w-64 flex justify-center">
            <div className="bg-gray-100 p-2 rounded shadow-sm">
              <GameBoard
                gamePhase={GamePhase.PLAY}
                startPosition={myMap.startPosition}
                endPosition={myMap.endPosition}
                playerPosition={opponentPosition}
                obstacles={myMap.obstacles}
                collisionWalls={opponentCollisionWalls}
                readOnly={true}
                isMinimapMode={true}
                playerPhotoURL={opponentPhotoURL || undefined}
              />
            </div>
          </div>
        )}
      </div>
      
      {/* 컨트롤 버튼 (게임 종료 시 숨김) */}
      {!gameOver && !gameEnded && (
        <div className="flex justify-center gap-2 mt-2">
          <div className="grid grid-cols-3 gap-1">
            <div className="col-start-2">
              <button
                className="w-10 h-10 bg-blue-500 text-white rounded-full flex items-center justify-center hover:bg-blue-600 disabled:bg-gray-300"
                onClick={() => handleMove('up')}
                disabled={!isMyTurn}
              >
                ↑
              </button>
            </div>
            <div className="col-start-1 row-start-2">
              <button
                className="w-10 h-10 bg-blue-500 text-white rounded-full flex items-center justify-center hover:bg-blue-600 disabled:bg-gray-300"
                onClick={() => handleMove('left')}
                disabled={!isMyTurn}
              >
                ←
              </button>
            </div>
            <div className="col-start-2 row-start-2">
              <button
                className="w-10 h-10 bg-gray-200 text-gray-700 rounded-full flex items-center justify-center"
                disabled
              >
                •
              </button>
            </div>
            <div className="col-start-3 row-start-2">
              <button
                className="w-10 h-10 bg-blue-500 text-white rounded-full flex items-center justify-center hover:bg-blue-600 disabled:bg-gray-300"
                onClick={() => handleMove('right')}
                disabled={!isMyTurn}
              >
                →
              </button>
            </div>
            <div className="col-start-2 row-start-3">
              <button
                className="w-10 h-10 bg-blue-500 text-white rounded-full flex items-center justify-center hover:bg-blue-600 disabled:bg-gray-300"
                onClick={() => handleMove('down')}
                disabled={!isMyTurn}
              >
                ↓
              </button>
            </div>
          </div>
        </div>
      )}
      
      {/* 게임 재시작 버튼 (게임 종료 시에만 표시) */}
      {gameOver && !gameEnded && (
        <div className="flex justify-center mt-2">
          <button
            className="px-3 py-1 text-xs bg-blue-500 text-white rounded hover:bg-blue-600 transition"
            onClick={handleRestartGame}
          >
            재시작
          </button>
        </div>
      )}
    </div>
  );
};

export default GamePlay; 