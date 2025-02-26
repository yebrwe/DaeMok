'use client';

import React, { useState, useRef, useCallback } from 'react';
import { CellType, CollisionWall, Direction, GameMap, GamePhase, Obstacle, Position } from '@/types/game';
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
  selectionMode?: 'start' | 'end' | 'none';
  collisionWalls?: CollisionWall[];
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
  selectionMode = 'none',
  collisionWalls = [],
}) => {
  const [hoveredCell, setHoveredCell] = useState<Position | null>(null);
  const [hoveredWall, setHoveredWall] = useState<{position: Position, direction: Direction} | null>(null);
  
  // hover 타이머 참조 관리
  const hoverTimerRef = useRef<NodeJS.Timeout | null>(null);
  // 마우스 동작 중인지 추적하는 상태
  const isMouseDownRef = useRef<boolean>(false);
  
  // 디바운스된 호버 상태 설정 함수
  const setHoveredCellWithDebounce = useCallback((position: Position | null) => {
    // 기존 타이머가 있다면 취소
    if (hoverTimerRef.current) {
      clearTimeout(hoverTimerRef.current);
      hoverTimerRef.current = null;
    }
    
    if (position === null) {
      // 호버 상태 제거는 살짝 지연시켜 깜빡임 방지
      hoverTimerRef.current = setTimeout(() => {
        setHoveredCell(null);
      }, 100);
    } else {
      // 호버 상태 추가는 약간 지연시켜 적용 (깜빡임 방지)
      hoverTimerRef.current = setTimeout(() => {
        setHoveredCell(position);
      }, 50);
    }
  }, []);
  
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

  // 특정 위치에 충돌 벽이 있는지 확인하는 함수
  const hasCollisionWall = (position: Position, direction: Direction): boolean => {
    // 위치와 방향이 정확히 일치하는 경우
    const directMatch = collisionWalls.some(
      wall => isSamePosition(wall.position, position) && wall.direction === direction
    );
    
    // 위쪽 벽 검사 - 해당 셀의 위쪽 벽은 위쪽 셀의 아래쪽 벽과 동일
    if (direction === 'up' && !directMatch) {
      const upPosition = { row: position.row - 1, col: position.col };
      if (upPosition.row >= 0) {
        return collisionWalls.some(
          wall => isSamePosition(wall.position, upPosition) && wall.direction === 'down'
        );
      }
    }
    
    // 왼쪽 벽 검사 - 해당 셀의 왼쪽 벽은 왼쪽 셀의 오른쪽 벽과 동일
    if (direction === 'left' && !directMatch) {
      const leftPosition = { row: position.row, col: position.col - 1 };
      if (leftPosition.col >= 0) {
        return collisionWalls.some(
          wall => isSamePosition(wall.position, leftPosition) && wall.direction === 'right'
        );
      }
    }
    
    return directMatch;
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

  // 셀 렌더링 함수
  const renderCell = (position: Position) => {
    const cellType = getCellType(position);
    const isPlayer = playerPosition && isSamePosition(position, playerPosition);
    const isHovered = hoveredCell && isSamePosition(hoveredCell, position);
    
    const cellClasses = `
      relative ${isMinimapMode ? 'w-6 h-6' : 'w-14 h-14'} 
      ${cellType === 'empty' || cellType === 'player' ? 'bg-white' : ''}
      ${!readOnly && (gamePhase === GamePhase.SETUP || gamePhase === GamePhase.PLAY) ? 'cursor-pointer' : ''}
      touch-action-none transition-colors duration-300 ease-in-out
    `;

    return (
      <div
        key={`cell-${position.row}-${position.col}`}
        className={cellClasses}
        onClick={() => {
          if (!readOnly && onCellClick) {
            onCellClick(position);
          }
        }}
        onMouseDown={() => {
          isMouseDownRef.current = true;
        }}
        onMouseUp={() => {
          isMouseDownRef.current = false;
        }}
        onMouseEnter={() => {
          if (isMouseDownRef.current) return; // 마우스 드래그 중에는 이벤트 무시
          !isMinimapMode && setHoveredCellWithDebounce(position);
        }}
        onMouseLeave={() => {
          if (isMouseDownRef.current) return; // 마우스 드래그 중에는 이벤트 무시
          !isMinimapMode && setHoveredCellWithDebounce(null);
        }}
        onTouchStart={() => !isMinimapMode && setHoveredCellWithDebounce(position)}
        onTouchEnd={() => {
          if (!readOnly && !isMinimapMode && onCellClick) {
            onCellClick(position);
          }
        }}
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
        
        {/* 플레이어 오버레이 마커: 플레이어 위치가 해당 셀에 있을 경우 항상 표시 */}
        {isPlayer && (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className={`${isMinimapMode ? 'w-3 h-3' : 'w-6 h-6'} rounded-full bg-blue-500 flex items-center justify-center z-20`}>
              {!isMinimapMode && <span className="text-white font-bold text-xs">P</span>}
            </div>
          </div>
        )}
        
        {/* 호버 시 시작점/도착점 미리보기 */}
        {isHovered && cellType === 'empty' && !isMinimapMode && (
          <>
            {selectionMode === 'start' && (
              <div className="absolute inset-0 flex items-center justify-center">
                <div className="w-6 h-6 rounded-full bg-green-500 bg-opacity-60 flex items-center justify-center">
                  <span className="text-white font-bold text-xs">S</span>
                </div>
              </div>
            )}
            {selectionMode === 'end' && (
              <div className="absolute inset-0 flex items-center justify-center">
                <div className="w-6 h-6 rounded-full bg-red-500 bg-opacity-60 flex items-center justify-center">
                  <span className="text-white font-bold text-xs">E</span>
                </div>
              </div>
            )}
          </>
        )}
        
        {/* 미니맵 모드에서만 장애물 표시 (모바일용) */}
        {isMinimapMode && renderMinimapObstacles(position)}
      </div>
    );
  };
  
  // 벽 렌더링 함수 (가로 벽)
  const renderHorizontalWall = (row: number, col: number) => {
    const position = { row: Math.floor(row/2), col: Math.floor(col/2) };
    const direction: Direction = row % 2 === 0 ? 'up' : 'down';
    
    // 테두리를 벗어나는 경우 렌더링하지 않음
    if (
      (direction === 'up' && position.row === 0) || 
      (direction === 'down' && position.row === BOARD_SIZE - 1)
    ) {
      return null;
    }
    
    const isBlocked = hasObstacle(position, direction);
    const isHovered = hoveredWall && 
      isSamePosition(hoveredWall.position, position) && 
      hoveredWall.direction === direction;
    
    // 충돌 여부 확인 - 직접 두 방향 모두 확인
    let isCollision = false;
    
    // 직접 충돌 확인
    isCollision = collisionWalls.some(
      wall => isSamePosition(wall.position, position) && wall.direction === direction
    );
    
    // 위쪽 벽의 경우 아래쪽 셀에서의 충돌도 확인
    if (!isCollision && direction === 'up' && position.row > 0) {
      const belowPos = { row: position.row - 1, col: position.col };
      isCollision = collisionWalls.some(
        wall => isSamePosition(wall.position, belowPos) && wall.direction === 'down'
      );
    }
    
    // 아래쪽 벽의 경우 위쪽 셀에서의 충돌도 확인
    if (!isCollision && direction === 'down' && position.row < BOARD_SIZE - 1) {
      const abovePos = { row: position.row + 1, col: position.col };
      isCollision = collisionWalls.some(
        wall => isSamePosition(wall.position, abovePos) && wall.direction === 'up'
      );
    }
    
    const containerClasses = `w-full h-2 z-10 relative
      ${gamePhase === GamePhase.SETUP && !readOnly ? 'cursor-pointer' : ''}
      transition-all duration-150 ease-in-out bg-transparent hover:bg-yellow-200`;
    
    return (
      <div
        key={`h-wall-${row}-${col}`}
        className={containerClasses}
        onClick={(e) => {
          e.stopPropagation();
          if (gamePhase === GamePhase.SETUP && !readOnly && onDirectionClick) {
            onDirectionClick(position, direction);
          }
        }}
        onMouseEnter={(e) => {
          e.stopPropagation();
          if (!isMouseDownRef.current && gamePhase === GamePhase.SETUP && !readOnly) {
            setHoveredWall({ position, direction });
          }
        }}
        onMouseLeave={(e) => {
          e.stopPropagation();
          setHoveredWall(null);
        }}
      >
        {/* 설정 단계: 노란색으로 호버 효과 및 배치된 벽 표시 */}
        {gamePhase === GamePhase.SETUP && (
          <>
          {isHovered && !isBlocked && (
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="w-3/4 h-1/2 bg-yellow-300" />
            </div>
          )}
          {isBlocked && (
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="w-3/4 h-1/2 bg-yellow-500" />
            </div>
          )}
          </>
        )}
        {/* 플레이 단계: 충돌한 벽만 빨간색으로 표시 */}
        {gamePhase === GamePhase.PLAY && isCollision && (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="w-3/4 h-1/2 bg-red-500" />
          </div>
        )}
      </div>
    );
  };
  
  // 벽 렌더링 함수 (세로 벽)
  const renderVerticalWall = (row: number, col: number) => {
    const position = { row: Math.floor(row/2), col: Math.floor(col/2) };
    const direction: Direction = col % 2 === 0 ? 'left' : 'right';
    
    // 테두리를 벗어나는 경우 렌더링하지 않음
    if (
      (direction === 'left' && position.col === 0) || 
      (direction === 'right' && position.col === BOARD_SIZE - 1)
    ) {
      return null;
    }
    
    const isBlocked = hasObstacle(position, direction);
    const isHovered = hoveredWall && 
      isSamePosition(hoveredWall.position, position) && 
      hoveredWall.direction === direction;
    
    // 충돌 여부 확인 - 직접 두 방향 모두 확인
    let isCollision = false;
    
    // 직접 충돌 확인
    isCollision = collisionWalls.some(
      wall => isSamePosition(wall.position, position) && wall.direction === direction
    );
    
    // 왼쪽 벽의 경우 오른쪽 셀에서의 충돌도 확인
    if (!isCollision && direction === 'left' && position.col > 0) {
      const rightPos = { row: position.row, col: position.col - 1 };
      isCollision = collisionWalls.some(
        wall => isSamePosition(wall.position, rightPos) && wall.direction === 'right'
      );
    }
    
    // 오른쪽 벽의 경우 왼쪽 셀에서의 충돌도 확인
    if (!isCollision && direction === 'right' && position.col < BOARD_SIZE - 1) {
      const leftPos = { row: position.row, col: position.col + 1 };
      isCollision = collisionWalls.some(
        wall => isSamePosition(wall.position, leftPos) && wall.direction === 'left'
      );
    }
    
    const containerClasses = `h-full w-2 z-10 relative 
      ${gamePhase === GamePhase.SETUP && !readOnly ? 'cursor-pointer' : ''}
      transition-all duration-150 ease-in-out bg-transparent hover:bg-yellow-200`;
    
    return (
      <div
        key={`v-wall-${row}-${col}`}
        className={containerClasses}
        onClick={(e) => {
          e.stopPropagation();
          if (gamePhase === GamePhase.SETUP && !readOnly && onDirectionClick) {
            onDirectionClick(position, direction);
          }
        }}
        onMouseEnter={(e) => {
          e.stopPropagation();
          if (!isMouseDownRef.current && gamePhase === GamePhase.SETUP && !readOnly) {
            setHoveredWall({ position, direction });
          }
        }}
        onMouseLeave={(e) => {
          e.stopPropagation();
          setHoveredWall(null);
        }}
      >
        {/* 설정 단계: 노란색으로 호버 효과 및 배치된 벽 표시 */}
        {gamePhase === GamePhase.SETUP && (
          <>
          {isHovered && !isBlocked && (
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="w-1/2 h-3/4 bg-yellow-300" />
            </div>
          )}
          {isBlocked && (
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="w-1/2 h-3/4 bg-yellow-500" />
            </div>
          )}
          </>
        )}
        {/* 플레이 단계: 충돌한 벽만 빨간색으로 표시 */}
        {gamePhase === GamePhase.PLAY && isCollision && (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="w-1/2 h-3/4 bg-red-500" />
          </div>
        )}
      </div>
    );
  };

  // 교차점(코너) 렌더링
  const renderIntersection = (row: number, col: number) => {
    // 교차점의 좌표 계산
    return (
      <div 
        key={`intersection-${row}-${col}`} 
        className="w-2 h-2 bg-transparent" 
      />
    );
  };

  // 셀 및 교차점(코너)을 포함한 그리드 아이템 렌더링
  const renderGridItem = (row: number, col: number) => {
    // 짝수 행, 짝수 열: 일반 셀
    if (row % 2 === 0 && col % 2 === 0) {
      const position = { row: row/2, col: col/2 };
      return renderCell(position);
    }
    
    // 짝수 행, 홀수 열: 세로 벽
    if (row % 2 === 0 && col % 2 === 1) {
      return renderVerticalWall(row, col);
    }
    
    // 홀수 행, 짝수 열: 가로 벽
    if (row % 2 === 1 && col % 2 === 0) {
      return renderHorizontalWall(row, col);
    }
    
    // 홀수 행, 홀수 열: 교차점(코너)
    return renderIntersection(row, col);
  };

  // 보드 렌더링
  return (
    <div 
      className="flex flex-col items-center"
      onMouseLeave={() => {
        // 보드를 벗어날 때 모든 호버 상태 초기화
        setHoveredCell(null);
        setHoveredWall(null);
        isMouseDownRef.current = false;
      }}
    >
      {isMinimapMode ? (
        // 미니맵 모드일 때는 단순 8x8 그리드
        <div 
          className="grid gap-0 border border-gray-400 bg-gray-100 p-1 minimap-container rounded-md shadow-md touch-action-none"
          style={{ 
            gridTemplateColumns: `repeat(${BOARD_SIZE}, 1fr)`,
            gridTemplateRows: `repeat(${BOARD_SIZE}, 1fr)`
          }}
        >
          {Array.from({ length: BOARD_SIZE }).map((_, row) =>
            Array.from({ length: BOARD_SIZE }).map((_, col) => {
              const position = { row, col };
              return renderCell(position);
            })
          )}
        </div>
      ) : (
        // 일반 모드일 때는 셀+벽+교차점을 포함한 그리드
        <div 
          className="grid gap-0 border border-gray-400 bg-gray-100 p-2 rounded-md shadow-md touch-action-none"
          style={{ 
            gridTemplateColumns: `repeat(${BOARD_SIZE * 2 - 1}, auto)`,
            gridTemplateRows: `repeat(${BOARD_SIZE * 2 - 1}, auto)`
          }}
        >
          {Array.from({ length: BOARD_SIZE * 2 - 1 }).map((_, row) =>
            Array.from({ length: BOARD_SIZE * 2 - 1 }).map((_, col) => 
              renderGridItem(row, col)
            )
          )}
        </div>
      )}
    </div>
  );
};

export default GameBoard; 