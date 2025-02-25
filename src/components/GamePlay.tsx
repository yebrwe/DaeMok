'use client';

import React, { useState, useEffect } from 'react';
import { Direction, GameMap, GamePhase, Position } from '@/types/game';
import GameBoard from './GameBoard';
import { canMove, getNewPosition, isSamePosition } from '@/lib/gameUtils';
import { getDatabase, ref, update, get, onValue } from 'firebase/database';

interface GamePlayProps {
  map: GameMap;
  onGameComplete?: (moves: number) => void;
  userId: string;
  roomId: string;
  currentTurn: string | null;
  myMap?: GameMap; // 내가 만든 맵 정보 추가
}

const GamePlay: React.FC<GamePlayProps> = ({ 
  map, 
  onGameComplete, 
  userId, 
  roomId, 
  currentTurn,
  myMap // 내가 만든 맵 정보
}) => {
  const { startPosition, endPosition, obstacles } = map;
  
  const [playerPosition, setPlayerPosition] = useState<Position>(startPosition);
  const [moveCount, setMoveCount] = useState<number>(0);
  const [gameOver, setGameOver] = useState<boolean>(false);
  const [lastMoveValid, setLastMoveValid] = useState<boolean | null>(null);
  const [message, setMessage] = useState<string>('게임을 시작합니다.');
  const [opponentPosition, setOpponentPosition] = useState<Position | null>(null);
  const [opponentId, setOpponentId] = useState<string | null>(null);
  
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
    
    const canPlayerMove = canMove(playerPosition, direction, obstacles);
    const newPosition = getNewPosition(playerPosition, direction);
    
    setLastMoveValid(canPlayerMove);
    
    if (canPlayerMove) {
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
  }, [gameOver, playerPosition, obstacles, isMyTurn]);
  
  // 게임 재시작 함수
  const handleRestartGame = async () => {
    // 플레이어 위치를 시작 위치로 초기화
    setPlayerPosition(startPosition);
    setMoveCount(0);
    setGameOver(false);
    setLastMoveValid(null);
    setMessage('게임을 다시 시작합니다.');
    
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
  
  return (
    <div className="flex flex-col items-center gap-4 w-full max-w-2xl mx-auto">
      <h2 className="text-2xl font-bold text-center my-4">
        {gameOver ? '게임 종료' : '게임 플레이'}
      </h2>
      
      <div className="text-xl font-bold mb-2 text-center">
        {isMyTurn 
          ? '현재 당신의 턴입니다!'
          : '상대방의 턴입니다. 기다려주세요...'}
      </div>
      
      <div className="flex justify-between w-full px-4 mb-4">
        <div className="text-sm font-medium">
          이동 횟수: {moveCount}
        </div>
        <div 
          className={`text-sm font-medium ${
            lastMoveValid === false 
              ? 'text-red-500' 
              : lastMoveValid === true 
                ? 'text-green-500' 
                : ''
          }`}
        >
          {message}
        </div>
      </div>
      
      {/* 메인 게임 영역과 미니맵을 포함하는 컨테이너 */}
      <div className="flex flex-col md:flex-row w-full gap-4 items-start">
        {/* 메인 게임보드 - 상대방 맵에서 내가 플레이 */}
        <div className="flex-1">
          <h3 className="text-lg font-medium mb-2 text-center">내 게임</h3>
          <GameBoard
            gamePhase={GamePhase.PLAY}
            startPosition={startPosition}
            endPosition={endPosition}
            playerPosition={playerPosition}
            obstacles={[]} // 게임 플레이 중에는 장애물이 보이지 않음
            readOnly={true}
          />
        </div>
        
        {/* 미니맵 - 내가 만든 맵에서 상대방 플레이 */}
        {myMap && opponentPosition && (
          <div className="w-full md:w-64">
            <h3 className="text-lg font-medium mb-2 text-center">상대방 현황</h3>
            <div className="bg-gray-100 p-2 rounded shadow-sm">
              <GameBoard
                gamePhase={GamePhase.PLAY}
                startPosition={myMap.startPosition}
                endPosition={myMap.endPosition}
                playerPosition={opponentPosition}
                obstacles={myMap.obstacles} // 내가 만든 맵의 장애물 표시
                readOnly={true}
                isMinimapMode={true} // 미니맵 모드 전달
              />
            </div>
          </div>
        )}
      </div>
      
      <div className="mt-6 grid grid-cols-3 gap-2 w-36">
        <div className="col-span-1"></div>
        <button
          className={`${isMyTurn ? 'bg-blue-500' : 'bg-gray-400'} text-white p-2 rounded hover:${isMyTurn ? 'bg-blue-600' : 'bg-gray-400'} focus:outline-none`}
          onClick={() => handleMove('up')}
          disabled={gameOver || !isMyTurn}
        >
          ↑
        </button>
        <div className="col-span-1"></div>
        
        <button
          className={`${isMyTurn ? 'bg-blue-500' : 'bg-gray-400'} text-white p-2 rounded hover:${isMyTurn ? 'bg-blue-600' : 'bg-gray-400'} focus:outline-none`}
          onClick={() => handleMove('left')}
          disabled={gameOver || !isMyTurn}
        >
          ←
        </button>
        <button
          className={`${isMyTurn ? 'bg-blue-500' : 'bg-gray-400'} text-white p-2 rounded hover:${isMyTurn ? 'bg-blue-600' : 'bg-gray-400'} focus:outline-none`}
          onClick={() => handleMove('down')}
          disabled={gameOver || !isMyTurn}
        >
          ↓
        </button>
        <button
          className={`${isMyTurn ? 'bg-blue-500' : 'bg-gray-400'} text-white p-2 rounded hover:${isMyTurn ? 'bg-blue-600' : 'bg-gray-400'} focus:outline-none`}
          onClick={() => handleMove('right')}
          disabled={gameOver || !isMyTurn}
        >
          →
        </button>
      </div>
      
      {gameOver && (
        <div className="mt-4 flex gap-2">
          <button
            className="px-4 py-2 bg-green-500 text-white rounded hover:bg-green-600 transition"
            onClick={handleRestartGame}
          >
            현재 맵에서 다시 시작
          </button>
          <button
            className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600 transition"
            onClick={() => window.location.reload()}
          >
            새 맵 만들기
          </button>
        </div>
      )}
    </div>
  );
};

export default GamePlay; 