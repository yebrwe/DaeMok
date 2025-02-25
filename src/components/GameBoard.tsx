'use client';

import React, { useState } from 'react';
import { CellType, Direction, GameMap, GamePhase, Obstacle, Position } from '@/types/game';
import { BOARD_SIZE, canMove, isSamePosition } from '@/lib/gameUtils';

interface GameBoardProps {
  gamePhase: GamePhase;
  startPosition?: Position;
  endPosition?: Position;
  playerPosition?: Position;
  obstacles: Obstacle[];
  onCellClick?: (position: Position) => void;
  onDirectionClick?: (position: Position, direction: Direction) => void;
  readOnly?: boolean;
  isMinimapMode?: boolean;
}

const GameBoard: React.FC<GameBoardProps> = ({
  gamePhase,
  startPosition,
  endPosition,
  playerPosition,
  obstacles,
  onCellClick,
  onDirectionClick,
  readOnly = false,
  isMinimapMode = false,
}) => {
  const [hoveredCell, setHoveredCell] = useState<Position | null>(null);
  const [hoveredDirection, setHoveredDirection] = useState<Direction | null>(null);
  
  // 셀 타입 결정 함수
  const getCellType = (position: Position): CellType => {
    if (startPosition && isSamePosition(position, startPosition)) {
      return 'start';
    }
    if (endPosition && isSamePosition(position, endPosition)) {
      return 'end';
    }
    if (playerPosition && isSamePosition(position, playerPosition)) {
      return 'player';
    }
    return 'empty';
  };
  
  // 특정 방향에 장애물이 있는지 확인
  const hasObstacle = (position: Position, direction: Direction): boolean => {
    return obstacles.some(
      (obstacle) =>
        isSamePosition(obstacle.position, position) && obstacle.direction === direction
    );
  };

  // 미니맵용 간단한 장애물 렌더링
  const renderMinimapObstacles = (position: Position) => {
    return (
      <>
        {hasObstacle(position, 'up') && 
          <div className="absolute w-full h-1 bg-yellow-500 top-0 left-0"></div>}
        {hasObstacle(position, 'down') && 
          <div className="absolute w-full h-1 bg-yellow-500 bottom-0 left-0"></div>}
        {hasObstacle(position, 'left') && 
          <div className="absolute w-1 h-full bg-yellow-500 top-0 left-0"></div>}
        {hasObstacle(position, 'right') && 
          <div className="absolute w-1 h-full bg-yellow-500 top-0 right-0"></div>}
      </>
    );
  };

  // 방향 버튼 렌더링 함수
  const renderDirectionButton = (position: Position, direction: Direction) => {
    const isBlocked = hasObstacle(position, direction);
    const isHovered = 
      hoveredCell && 
      isSamePosition(hoveredCell, position) && 
      hoveredDirection === direction;
    
    // 선 스타일 계산 - 격자 셀의 벽과 정확히 일치하도록 조정
    // 클릭 영역은 넓히고 감지 범위 확장을 위해 패딩 추가
    const lineClasses = `
      absolute cursor-pointer
      ${direction === 'up' ? 'w-full h-2 -top-1 left-0 hover:h-3' : ''}
      ${direction === 'down' ? 'w-full h-2 -bottom-1 left-0 hover:h-3' : ''}
      ${direction === 'left' ? 'h-full w-2 top-0 -left-1 hover:w-3' : ''}
      ${direction === 'right' ? 'h-full w-2 top-0 -right-1 hover:w-3' : ''}
      ${isBlocked 
        ? 'bg-yellow-500 z-10' 
        : isHovered 
          ? 'bg-yellow-300 z-10 shadow-md' 
          : 'bg-transparent hover:bg-yellow-200'
      }
      ${gamePhase === GamePhase.SETUP && !readOnly ? 'cursor-pointer' : ''}
      transition-all duration-150 ease-in-out
    `;
    
    return (
      <button
        className={lineClasses}
        onClick={(e) => {
          e.stopPropagation();
          if (gamePhase === GamePhase.SETUP && !readOnly && onDirectionClick) {
            onDirectionClick(position, direction);
          }
        }}
        onMouseEnter={() => {
          if (gamePhase === GamePhase.SETUP && !readOnly) {
            setHoveredDirection(direction);
          }
        }}
        onMouseLeave={() => {
          setHoveredDirection(null);
        }}
        // 모바일 터치 이벤트 추가
        onTouchStart={(e) => {
          e.stopPropagation();
          if (gamePhase === GamePhase.SETUP && !readOnly) {
            setHoveredDirection(direction);
          }
        }}
        onTouchEnd={(e) => {
          e.stopPropagation();
          if (gamePhase === GamePhase.SETUP && !readOnly && onDirectionClick) {
            onDirectionClick(position, direction);
            setHoveredDirection(null);
          }
        }}
        disabled={readOnly || gamePhase !== GamePhase.SETUP}
      />
    );
  };

  // 셀 렌더링 함수
  const renderCell = (position: Position) => {
    const cellType = getCellType(position);
    const isHovered = hoveredCell && isSamePosition(hoveredCell, position);
    
    const cellClasses = `
      relative ${isMinimapMode ? 'w-6 h-6' : 'w-12 h-12'} border border-gray-300
      ${cellType === 'empty' && isHovered && gamePhase === GamePhase.SETUP ? 'bg-gray-200' : ''}
      ${cellType === 'empty' && !isHovered ? 'bg-white' : ''}
      ${cellType === 'player' ? 'bg-blue-500' : ''}
      ${!readOnly && (gamePhase === GamePhase.SETUP || gamePhase === GamePhase.PLAY) ? 'cursor-pointer' : ''}
    `;

    return (
      <div
        key={`${position.row}-${position.col}`}
        className={cellClasses}
        onClick={() => {
          if (!readOnly && onCellClick) {
            onCellClick(position);
          }
        }}
        onMouseEnter={() => !isMinimapMode && setHoveredCell(position)}
        onMouseLeave={() => !isMinimapMode && setHoveredCell(null)}
      >
        {/* 시작점 마커 */}
        {cellType === 'start' && (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className={`${isMinimapMode ? 'w-3 h-3' : 'w-6 h-6'} rounded-full bg-green-500 flex items-center justify-center`}>
              {!isMinimapMode && <span className="text-white font-bold text-xs">S</span>}
            </div>
          </div>
        )}
        
        {/* 도착점 마커 */}
        {cellType === 'end' && (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className={`${isMinimapMode ? 'w-3 h-3' : 'w-6 h-6'} rounded-full bg-red-500 flex items-center justify-center`}>
              {!isMinimapMode && <span className="text-white font-bold text-xs">E</span>}
            </div>
          </div>
        )}
        
        {/* 방향 버튼 - 미니맵에서는 간단하게 표시 */}
        {isMinimapMode ? 
          // 미니맵 모드에서는 단순한 장애물 벽만 표시
          renderMinimapObstacles(position) :
          // 일반 모드에서는 기존 방식으로 표시
          <>
            {renderDirectionButton(position, 'up')}
            {renderDirectionButton(position, 'down')}
            {renderDirectionButton(position, 'left')}
            {renderDirectionButton(position, 'right')}
          </>
        }
      </div>
    );
  };

  // 보드 렌더링
  return (
    <div className="flex flex-col items-center">
      <div 
        className={`grid grid-cols-8 gap-0 border border-gray-400 bg-gray-100 ${isMinimapMode ? 'p-1' : 'p-2'} rounded-md shadow-md`}
        style={{ gridTemplateColumns: `repeat(${BOARD_SIZE}, 1fr)` }}
      >
        {Array.from({ length: BOARD_SIZE }).map((_, row) =>
          Array.from({ length: BOARD_SIZE }).map((_, col) => {
            const position = { row, col };
            return renderCell(position);
          })
        )}
      </div>
    </div>
  );
};

export default GameBoard; 