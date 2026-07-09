'use client';

import React, { useState, useRef, useCallback } from 'react';
import { CellType, CollisionWall, Direction, GamePhase, MapItem, Obstacle, Position } from '@/types/game';
import { BOARD_SIZE, isSamePosition, isSameWallSegment } from '@/lib/gameUtils';

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
  playerPhotoURL?: string;
  revealObstacles?: boolean; // 게임 종료 후 벽 공개
  item?: MapItem | null; // 맵 아이템 (1회성 벽/지뢰/웜홀)
  itemConsumed?: boolean; // 아이템 사용됨 여부
  pendingCell?: Position | null; // 배치 중 임시 표시 (웜홀 입구)
  revealedWalls?: Obstacle[]; // 탐지기로 밝혀낸 벽들 (일반 벽처럼 노란색으로 표시)
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
  playerPhotoURL,
  revealObstacles = false,
  item = null,
  itemConsumed = false,
  pendingCell = null,
  revealedWalls = [],
}) => {
  // 탐지기로 밝혀진 벽인지 (1회성 벽도 일반 벽으로 위장되어 포함됨)
  const isRadarRevealed = (position: Position, direction: Direction): boolean =>
    revealedWalls.some((w) => isSameWallSegment(position, direction, w.position, w.direction));

  // 아이템 전체 공개 조건: 맵 제작 중 / 내 맵 미니맵 / 게임 종료 공개
  const showItemsFully = gamePhase === GamePhase.SETUP || isMinimapMode || revealObstacles;

  // 해당 벽 자리가 1회성 벽 아이템인지
  const isItemWall = (position: Position, direction: Direction): boolean =>
    !!item &&
    item.type === 'oneTimeWall' &&
    !!item.wallPosition &&
    !!item.wallDirection &&
    isSameWallSegment(position, direction, item.wallPosition, item.wallDirection);

  // 셀 위 아이템 마커 (지뢰/웜홀)
  const renderItemCellMarker = (position: Position) => {
    // 웜홀 입구 배치 중 임시 표시
    if (pendingCell && isSamePosition(position, pendingCell)) {
      return (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-10">
          <div className={`${isMinimapMode ? 'w-3 h-3' : 'w-6 h-6'} rounded-full border-2 border-purple-500 animate-pulse`} />
        </div>
      );
    }

    if (!item) return null;
    const visible = showItemsFully || itemConsumed;
    if (!visible) return null;

    if (item.type === 'mine' && item.position && isSamePosition(position, item.position)) {
      return (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-10">
          <span className={isMinimapMode ? 'text-[9px]' : 'text-lg'}>{itemConsumed ? '💥' : '💣'}</span>
        </div>
      );
    }

    if (item.type === 'wormhole') {
      const isEntrance = !!item.entrance && isSamePosition(position, item.entrance);
      const isExit = !!item.exit && isSamePosition(position, item.exit);
      if (isEntrance || isExit) {
        return (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-10">
            <div
              className={`${isMinimapMode ? 'w-3.5 h-3.5 text-[6px]' : 'w-6 h-6 text-[10px]'} rounded-full flex items-center justify-center font-bold ${
                isEntrance
                  ? 'bg-purple-600 text-white'
                  : 'bg-purple-100 text-purple-700 border-2 border-purple-500'
              } ${itemConsumed ? 'opacity-50' : ''}`}
            >
              {isEntrance ? '입' : '출'}
            </div>
          </div>
        );
      }
    }

    return null;
  };
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
    // obstacles이 undefined인 경우 방어 코드 추가
    if (!obstacles) return false;
    
    return obstacles.some(
      (o) => o.position.row === position.row && 
             o.position.col === position.col && 
             o.direction === direction
    );
  };

  // 특정 위치에 충돌 벽이 있는지 확인 (같은 벽을 인접 셀의 반대 방향으로 기록한 경우도 포함)
  const hasCollisionWall = (position: Position, direction: Direction): boolean => {
    // 위치와 방향이 정확히 일치하는 경우
    const directMatch = collisionWalls.some(
      wall => isSamePosition(wall.position, position) && wall.direction === direction
    );
    if (directMatch) return true;

    // 인접 셀에서 반대 방향으로 기록된 같은 벽 확인
    const adjacent: Position =
      direction === 'up' ? { row: position.row - 1, col: position.col } :
      direction === 'down' ? { row: position.row + 1, col: position.col } :
      direction === 'left' ? { row: position.row, col: position.col - 1 } :
      { row: position.row, col: position.col + 1 };

    if (adjacent.row < 0 || adjacent.row >= BOARD_SIZE || adjacent.col < 0 || adjacent.col >= BOARD_SIZE) {
      return false;
    }

    const opposite: Direction =
      direction === 'up' ? 'down' : direction === 'down' ? 'up' : direction === 'left' ? 'right' : 'left';

    return collisionWalls.some(
      wall => isSamePosition(wall.position, adjacent) && wall.direction === opposite
    );
  };

  // 미니맵용 간단한 벽 렌더링 - 상대가 부딪힌 벽은 빨간색 흔적으로 표시
  const renderMinimapObstacles = (position: Position) => {
    const edge = (direction: Direction, positionClass: string, sizeClass: string) => {
      const hit = hasCollisionWall(position, direction);
      const blocked = hasObstacle(position, direction);
      const itemWall = isItemWall(position, direction);
      if (!hit && !blocked && !itemWall) return null;
      const color = hit
        ? 'bg-red-500'
        : itemWall
          ? itemConsumed ? 'bg-slate-400' : 'bg-yellow-500'
          : 'bg-yellow-500';
      return (
        <div
          className={`absolute ${sizeClass} ${positionClass} ${color}`}
        ></div>
      );
    };

    return (
      <>
        {edge('up', 'top-0 left-0', 'w-full h-1')}
        {edge('down', 'bottom-0 left-0', 'w-full h-1')}
        {edge('left', 'top-0 left-0', 'w-1 h-full')}
        {edge('right', 'top-0 right-0', 'w-1 h-full')}
      </>
    );
  };

  // 셀 렌더링 함수
  const renderCell = (position: Position) => {
    const cellType = getCellType(position);
    const isPlayer = playerPosition && isSamePosition(position, playerPosition);
    const isHovered = hoveredCell && isSamePosition(hoveredCell, position);
    
    const cellClasses = `
      relative ${isMinimapMode ? 'w-6 h-6' : 'w-10 h-10 sm:w-12 sm:h-12 md:w-14 md:h-14'} 
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
            <div className={`${isMinimapMode ? 'w-3 h-3' : 'w-6 h-6'} rounded-full bg-blue-500 flex items-center justify-center z-20 overflow-hidden ${isMinimapMode ? 'border border-white' : 'border-2 border-white'}`}>
              {playerPhotoURL ? (
                <img 
                  src={playerPhotoURL} 
                  alt="Player" 
                  className="w-full h-full object-cover rounded-full"
                />
              ) : (
                <span className={`text-white font-bold ${isMinimapMode ? 'text-[6px]' : 'text-xs'}`}>P</span>
              )}
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
        
        {/* 아이템 마커 (지뢰/웜홀) */}
        {renderItemCellMarker(position)}

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
        {/* 게임 종료: 아직 충돌하지 않은 벽 공개 */}
        {gamePhase === GamePhase.PLAY && revealObstacles && isBlocked && !isCollision && (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="w-3/4 h-1/2 bg-amber-400" />
          </div>
        )}
        {/* 1회성 벽 아이템: 어디서든 일반 벽과 완전히 동일하게 위장 (제작 중엔 노란 벽, 공개 시엔 공개 벽) */}
        {isItemWall(position, direction) && showItemsFully && (
          gamePhase === GamePhase.SETUP || isMinimapMode ? (
            !itemConsumed ? (
              <div className="absolute inset-0 flex items-center justify-center">
                <div className="w-3/4 h-1/2 bg-yellow-500" />
              </div>
            ) : (
              <div className="absolute inset-0 flex items-center justify-center">
                <div className="w-3/4 h-1/2 bg-slate-400/70" />
              </div>
            )
          ) : !itemConsumed ? (
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="w-3/4 h-1/2 bg-amber-400" />
            </div>
          ) : null
        )}
        {/* 탐지기로 밝혀낸 벽 (1회성 벽도 일반 벽으로 위장) */}
        {gamePhase === GamePhase.PLAY && !revealObstacles && !isCollision &&
          isRadarRevealed(position, direction) && (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="w-3/4 h-1/2 bg-yellow-500" />
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
        {/* 게임 종료: 아직 충돌하지 않은 벽 공개 */}
        {gamePhase === GamePhase.PLAY && revealObstacles && isBlocked && !isCollision && (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="w-1/2 h-3/4 bg-amber-400" />
          </div>
        )}
        {/* 1회성 벽 아이템: 어디서든 일반 벽과 완전히 동일하게 위장 (제작 중엔 노란 벽, 공개 시엔 공개 벽) */}
        {isItemWall(position, direction) && showItemsFully && (
          gamePhase === GamePhase.SETUP || isMinimapMode ? (
            !itemConsumed ? (
              <div className="absolute inset-0 flex items-center justify-center">
                <div className="w-1/2 h-3/4 bg-yellow-500" />
              </div>
            ) : (
              <div className="absolute inset-0 flex items-center justify-center">
                <div className="w-1/2 h-3/4 bg-slate-400/70" />
              </div>
            )
          ) : !itemConsumed ? (
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="w-1/2 h-3/4 bg-amber-400" />
            </div>
          ) : null
        )}
        {/* 탐지기로 밝혀낸 벽 (1회성 벽도 일반 벽으로 위장) */}
        {gamePhase === GamePhase.PLAY && !revealObstacles && !isCollision &&
          isRadarRevealed(position, direction) && (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="w-1/2 h-3/4 bg-yellow-500" />
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
      className="flex flex-col items-center justify-center w-full max-w-full overflow-hidden"
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
          className="grid gap-0 border-2 border-slate-500 bg-slate-300 p-1 minimap-container rounded-md shadow-md touch-action-none mx-auto"
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
          className="grid gap-0 border-4 border-slate-600 bg-slate-300 p-1 sm:p-2 rounded-xl shadow-xl shadow-black/40 touch-action-none overflow-auto mx-auto"
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