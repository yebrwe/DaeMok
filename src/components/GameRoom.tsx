'use client';

import React, { useState, useEffect } from 'react';
import { GameMap, GamePhase, Player } from '@/types/game';
import GameSetup from './GameSetup';
import GamePlay from './GamePlay';
import { useGameState } from '@/hooks/useFirebase';
import { 
  placeObstacles, 
  setPlayerReady, 
  endGame, 
  leaveRoom 
} from '@/lib/firebase';
import { useRouter } from 'next/navigation';

interface GameRoomProps {
  userId: string;
  roomId: string;
}

const GameRoom: React.FC<GameRoomProps> = ({ userId, roomId }) => {
  const { gameState, isLoading } = useGameState(roomId);
  const [isReady, setIsReady] = useState(false);
  const [myMap, setMyMap] = useState<GameMap | null>(null);
  const [opponentMap, setOpponentMap] = useState<GameMap | null>(null);
  const router = useRouter();
  
  // 컴포넌트 마운트 시 현재 방 정보 저장 (새로고침해도 그대로 유지)
  useEffect(() => {
    localStorage.setItem('currentRoom', roomId);
  }, [roomId]);
  
  // 게임 상태 변경 감지
  useEffect(() => {
    if (!gameState) return;
    
    // 상세 게임 상태 로깅
    console.log('게임 상태 변경 감지:', {
      phase: gameState.phase,
      playersCount: gameState.players ? Object.keys(gameState.players).length : 0,
      mapsCount: gameState.maps ? Object.keys(gameState.maps).length : 0,
      currentTurn: gameState.currentTurn,
      winner: gameState.winner,
      userId: userId
    });
    
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
    try {
      await endGame(roomId, userId);
    } catch (error) {
      console.error('게임 종료 오류:', error);
    }
  };
  
  // 방 나가기 핸들러 (명시적으로 로비로 돌아갈 때 호출)
  const handleLeaveRoom = async () => {
    try {
      await leaveRoom(roomId, userId);
      console.log('방 나가기 성공');
    } catch (error) {
      console.error('방 나가기 오류:', error);
    }
    localStorage.removeItem('currentRoom');
    router.push('/lobby');
  };
  
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
  
  // 플레이어 목록 계산
  const players = Object.values(gameState.players || {});
  
  // 승자 메시지
  const getWinnerMessage = () => {
    if (!gameState.winner) return null;
    
    const isWinner = gameState.winner === userId;
    return (
      <div className={`text-xl font-bold ${isWinner ? 'text-green-500' : 'text-red-500'}`}>
        {isWinner ? '축하합니다! 당신이 승리했습니다!' : '안타깝게도 상대방이 승리했습니다.'}
      </div>
    );
  };
  
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

        {/* 상대방 플레이어 정보 - 실제 유효한 상대가 있을 때만 표시 */}
        {gameState.players &&
         Object.values(gameState.players).some(p => p.id && p.id !== userId) && (
          <div className="text-center p-3 rounded-lg bg-gray-100">
            <div className="font-medium">상대방</div>
            <div className="text-sm">
              {
                Object.values(gameState.players).find(p => p.id && p.id !== userId)
                  ?.isReady
                  ? '준비 완료'
                  : '준비 중...'
              }
            </div>
          </div>
        )}
      </div>
      
      {/* 게임 종료 메시지 */}
      {gameState.phase === GamePhase.END && getWinnerMessage()}
      
      {/* 게임 컴포넌트 */}
      {gameState.phase === GamePhase.SETUP && !isReady ? (
        <div key="setup-container">
          <GameSetup key="setup" onMapComplete={handleMapComplete} />
        </div>
      ) : gameState.phase === GamePhase.SETUP && isReady ? (
        <div key="waiting-container" className="text-center p-8">
          <h2 className="text-xl font-bold mb-4">맵 제작 완료</h2>
          <p>상대방이 맵을 제작할 때까지 기다리고 있습니다...</p>
          <div className="w-12 h-12 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto mt-4"></div>
        </div>
      ) : gameState.phase === GamePhase.PLAY && opponentMap ? (
        <div key="gameplay-container">
          <GamePlay 
            key="gameplay" 
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
          <button
            className="px-6 py-3 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition mt-8"
            onClick={handleLeaveRoom}
          >
            로비로 돌아가기
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

export default GameRoom; 