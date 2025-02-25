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

interface GameRoomProps {
  userId: string;
  roomId: string;
}

const GameRoom: React.FC<GameRoomProps> = ({ userId, roomId }) => {
  const { gameState, isLoading } = useGameState(roomId);
  const [isReady, setIsReady] = useState(false);
  const [myMap, setMyMap] = useState<GameMap | null>(null);
  const [opponentMap, setOpponentMap] = useState<GameMap | null>(null);
  
  // 컴포넌트 언마운트 시 방 나가기
  useEffect(() => {
    return () => {
      // 게임이 종료된 상태가 아닐 때만 방 나가기 실행
      // 게임 종료 시에는 endGame에서 이미 처리됨
      if (gameState && gameState.phase !== GamePhase.END) {
        console.log('컴포넌트 언마운트 - 방 나가기');
        leaveRoom(roomId, userId);
      } else {
        console.log('컴포넌트 언마운트 - 게임 종료 상태이므로 방 나가기 실행 안함');
      }
    };
  }, [roomId, userId, gameState]);
  
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
        {players && players.length > 0 ? players.map((player, index) => (
          <div
            key={`player-${player.id || index}`}
            className={`text-center p-3 rounded-lg ${
              player.id === userId ? 'bg-blue-100' : 'bg-gray-100'
            }`}
          >
            <div className="font-medium">
              {player.id === userId ? '나' : '상대방'}
            </div>
            <div className="text-sm">
              {player.isReady ? '준비 완료' : '준비 중...'}
            </div>
          </div>
        )) : <div>플레이어 정보 로딩 중...</div>}
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
            onClick={() => window.location.href = '/lobby'}
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