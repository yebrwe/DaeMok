'use client';

import React, { useState, useRef, useCallback } from 'react';
import Image from 'next/image';
import { CellType, CollisionWall, Direction, GamePhase, ItemType, MapItem, Obstacle, Position, WallItemType } from '@/types/game';
import { BOARD_SIZE, ITEM_LABELS, isSamePosition, isSameWallSegment, isWallItemType } from '@/lib/gameUtils';

const ITEM_WALL_STYLES: Record<WallItemType, string> = {
  oneTimeWall: 'bg-cyan-400 ring-cyan-100',
  steelWall: 'bg-zinc-300 ring-zinc-50',
  fireWall: 'bg-red-500 ring-orange-200',
  poisonWall: 'bg-lime-500 ring-lime-100',
  iceWall: 'bg-cyan-200 ring-sky-50',
  windWall: 'bg-sky-500 ring-white',
  collapseWall: 'bg-stone-500 ring-stone-200',
  phaseWall: 'bg-violet-500 ring-fuchsia-200',
  mirrorWall: 'bg-slate-50 ring-cyan-200',
  thornWall: 'bg-rose-600 ring-rose-200',
  crystalWall: 'bg-fuchsia-500 ring-pink-100',
};

interface GameBoardProps {
  gamePhase: GamePhase;
  startPosition?: Position;
  endPosition?: Position;
  playerPosition?: Position;
  obstacles: Obstacle[];
  onCellClick?: (position: Position) => void;
  onDirectionClick?: (position: Position, direction: Direction) => void;
  readOnly?: boolean;
  selectionMode?: 'start' | 'end' | 'none';
  collisionWalls?: CollisionWall[];
  playerPhotoURL?: string;
  revealObstacles?: boolean; // 게임 종료 후 벽 공개
  revealItems?: boolean; // 맵 제작자 시점 또는 게임 종료 후 숨은 아이템 공개
  distinguishOneTimeWalls?: boolean; // 제작자 시점에서 가짜벽을 일반 벽과 구분
  items?: MapItem[] | null; // 맵 아이템들
  itemsConsumed?: Record<number, boolean> | null; // 인덱스별 사용 여부
  itemActiveWalls?: Record<number, boolean> | null; // 붕괴벽이 닫힌 상태
  itemPhaseOpen?: Record<number, boolean> | null; // 위상벽이 다음 시도에 열리는 상태
  pendingCell?: Position | null; // 배치 중 임시 표시 (웜홀 입구)
  validTargetCells?: Position[]; // 아이템 배치 시 안전하게 선택 가능한 셀
  revealedWalls?: Obstacle[]; // 탐지기로 밝혀낸 벽들 (일반 벽처럼 노란색으로 표시)
  placeMode?: 'wall' | ItemType;
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
  selectionMode = 'none',
  collisionWalls = [],
  playerPhotoURL,
  revealObstacles = false,
  revealItems = false,
  distinguishOneTimeWalls = false,
  items = null,
  itemsConsumed = null,
  itemActiveWalls = null,
  itemPhaseOpen = null,
  pendingCell = null,
  validTargetCells = [],
  revealedWalls = [],
  placeMode = 'wall',
}) => {
  // 탐지기로 밝혀진 벽인지 (1회성 벽도 일반 벽으로 위장되어 포함됨)
  const isRadarRevealed = (position: Position, direction: Direction): boolean =>
    revealedWalls.some((w) => isSameWallSegment(position, direction, w.position, w.direction));

  const showItemsFully = gamePhase === GamePhase.SETUP || revealItems;
  const showFakeWallIdentity = gamePhase === GamePhase.SETUP || distinguishOneTimeWalls;

  const itemList = items || [];

  // 해당 선을 점유한 벽형 아이템의 인덱스 (-1이면 없음)
  const findItemWallIndex = (position: Position, direction: Direction): number =>
    itemList.findIndex(
      (it) =>
        isWallItemType(it.type) &&
        !!it.wallPosition &&
        !!it.wallDirection &&
        isSameWallSegment(position, direction, it.wallPosition, it.wallDirection)
    );

  const renderItemWall = (
    position: Position,
    direction: Direction,
    orientation: 'horizontal' | 'vertical'
  ) => {
    const itemWallIndex = findItemWallIndex(position, direction);
    if (itemWallIndex < 0 || !showItemsFully) return null;

    const item = itemList[itemWallIndex];
    if (!isWallItemType(item.type)) return null;
    const consumed = !!itemsConsumed?.[itemWallIndex];
    const horizontal = orientation === 'horizontal';

    if (item.type === 'oneTimeWall' && !showFakeWallIdentity) {
      if (consumed) return null;
      return (
        <div
          data-map-item={item.type}
          data-wall-state="armed"
          className="absolute inset-0 flex items-center justify-center"
        >
          <div className={horizontal ? 'h-1/2 w-3/4 bg-amber-400' : 'h-3/4 w-1/2 bg-amber-400'} />
        </div>
      );
    }

    if (item.type === 'oneTimeWall') {
      return (
        <div
          data-map-item={item.type}
          data-wall-state={consumed ? 'consumed' : 'armed'}
          title={`${ITEM_LABELS[item.type]} · ${consumed ? '소모됨' : '미사용'}`}
          className={`absolute inset-0 flex items-center justify-center ${consumed ? 'opacity-35' : ''}`}
        >
          <div className={horizontal ? 'flex h-1/2 w-3/4 justify-between' : 'flex h-3/4 w-1/2 flex-col justify-between'}>
            {[0, 1, 2].map((segment) => (
              <span
                key={segment}
                className={`${horizontal ? 'h-full w-[28%]' : 'h-[28%] w-full'} ${ITEM_WALL_STYLES[item.type]} ring-1`}
              />
            ))}
          </div>
        </div>
      );
    }

    const active = !!itemActiveWalls?.[itemWallIndex];
    const phaseOpen = !!itemPhaseOpen?.[itemWallIndex];
    const dimensions = horizontal ? 'h-1/2 w-3/4' : 'h-3/4 w-1/2';
    let wallState = consumed ? 'consumed' : 'armed';
    let stateLabel = consumed ? '소모됨' : '활성';
    let wallClasses = `${dimensions} ${horizontal ? 'border-x-2' : 'border-y-2'} ${ITEM_WALL_STYLES[item.type]} border-slate-950/50 ring-1`;

    if (item.type === 'collapseWall' && !consumed) {
      wallState = active ? 'closed' : 'armed';
      stateLabel = active ? '폐쇄됨' : '대기 · 통과 후 폐쇄';
      wallClasses = active
        ? `${dimensions} border-2 border-stone-950 bg-stone-500 ring-2 ring-stone-200`
        : `${dimensions} border-2 border-dashed border-stone-200 bg-stone-500/30 ring-1 ring-stone-300`;
    } else if (item.type === 'phaseWall' && !consumed) {
      wallState = phaseOpen ? 'open' : 'closed';
      stateLabel = phaseOpen ? '열림 · 다음 시도 통과' : '닫힘 · 다음 시도 차단';
      wallClasses = phaseOpen
        ? `${dimensions} border-2 border-dashed border-violet-300 bg-violet-500/20 ring-1 ring-fuchsia-200/70`
        : `${dimensions} border-2 border-violet-200 bg-violet-500 ring-2 ring-fuchsia-200`;
    }

    return (
      <div
        data-map-item={item.type}
        data-wall-state={wallState}
        title={`${ITEM_LABELS[item.type]} · ${stateLabel}`}
        className={`absolute inset-0 flex items-center justify-center ${consumed ? 'opacity-35' : ''}`}
      >
        <div className={wallClasses} />
      </div>
    );
  };

  // 셀 위 아이템 마커 (지뢰/웜홀)
  const renderItemCellMarker = (position: Position) => {
    // 웜홀 입구 배치 중 임시 표시
    if (pendingCell && isSamePosition(position, pendingCell)) {
      return (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-10">
          <div className="w-6 h-6 rounded-full border-2 border-purple-500 animate-pulse" />
        </div>
      );
    }

    for (let idx = 0; idx < itemList.length; idx++) {
      const it = itemList[idx];
      const consumed = !!itemsConsumed?.[idx];
      const visible = showItemsFully;
      if (!visible) continue;

      if (it.type === 'mine' && it.position && isSamePosition(position, it.position)) {
        return (
          <div data-map-item="mine" className="absolute inset-0 flex items-center justify-center pointer-events-none z-10">
            <span className="text-lg">{consumed ? '💥' : '💣'}</span>
          </div>
        );
      }

      if (it.type === 'smoke' && it.position && isSamePosition(position, it.position)) {
        return (
          <div data-map-item="smoke" className="absolute inset-0 z-10 flex items-center justify-center pointer-events-none">
            <span className={`text-lg ${consumed ? 'opacity-60' : ''}`}>{consumed ? '💨' : '🌫️'}</span>
          </div>
        );
      }

      if (it.type === 'wormhole') {
        const isEntrance = !!it.entrance && isSamePosition(position, it.entrance);
        const isExit = !!it.exit && isSamePosition(position, it.exit);
        if (isEntrance || isExit) {
          return (
            <div data-map-item="wormhole" className="absolute inset-0 flex items-center justify-center pointer-events-none z-10">
              <div
                className={`w-6 h-6 text-[10px] rounded-full flex items-center justify-center font-bold ${
                  isEntrance
                    ? 'bg-purple-600 text-white'
                    : 'bg-purple-100 text-purple-700 border-2 border-purple-500'
                } ${consumed ? 'opacity-50' : ''}`}
              >
                {isEntrance ? '입' : '출'}
              </div>
            </div>
          );
        }
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
    if (!obstacles) return false;

    return obstacles.some((obstacle) =>
      isSameWallSegment(position, direction, obstacle.position, obstacle.direction)
    );
  };

  // 셀 렌더링 함수
  const renderCell = (position: Position) => {
    const cellType = getCellType(position);
    const isPlayer = playerPosition && isSamePosition(position, playerPosition);
    const isHovered = hoveredCell && isSamePosition(hoveredCell, position);
    const isValidTarget = validTargetCells.some((target) => isSamePosition(target, position));
    const isInteractive = !readOnly && !!onCellClick && (
      gamePhase === GamePhase.PLAY ||
      selectionMode !== 'none' ||
      placeMode === 'mine' ||
      placeMode === 'smoke' ||
      placeMode === 'wormhole'
    );
    
    const cellClasses = `
      relative w-10 h-10 sm:w-12 sm:h-12 md:w-14 md:h-14
      ${cellType === 'empty' || cellType === 'player' ? 'bg-white' : ''}
      ${isValidTarget ? 'ring-2 ring-inset ring-emerald-400 bg-emerald-50' : ''}
      ${isInteractive ? 'cell-hit-target cursor-pointer' : ''}
      touch-action-none transition-colors duration-300 ease-in-out
    `;

    return (
      <div
        key={`cell-${position.row}-${position.col}`}
        data-cell={`${position.row},${position.col}`}
        data-valid-item-target={isValidTarget ? 'true' : undefined}
        role={isInteractive ? 'button' : undefined}
        tabIndex={isInteractive ? 0 : undefined}
        aria-label={isInteractive ? `${position.row + 1}행 ${position.col + 1}열 선택` : undefined}
        className={cellClasses}
        onClick={() => {
          if (isInteractive && onCellClick) {
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
          setHoveredCellWithDebounce(position);
        }}
        onMouseLeave={() => {
          if (isMouseDownRef.current) return; // 마우스 드래그 중에는 이벤트 무시
          setHoveredCellWithDebounce(null);
        }}
        onKeyDown={(event) => {
          if (isInteractive && (event.key === 'Enter' || event.key === ' ')) {
            event.preventDefault();
            onCellClick(position);
          }
        }}
      >
        {/* 시작점 마커 */}
        {cellType === 'start' && (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="w-6 h-6 rounded-full bg-green-500 flex items-center justify-center">
              <span className="text-white font-bold text-xs">S</span>
            </div>
          </div>
        )}
        
        {/* 도착점 마커 */}
        {cellType === 'end' && (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="w-6 h-6 rounded-full bg-red-500 flex items-center justify-center">
              <span className="text-white font-bold text-xs">E</span>
            </div>
          </div>
        )}
        
        {/* 플레이어 오버레이 마커: 플레이어 위치가 해당 셀에 있을 경우 항상 표시 */}
        {isPlayer && (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="w-6 h-6 rounded-full bg-blue-500 flex items-center justify-center z-20 overflow-hidden border-2 border-white">
              {playerPhotoURL ? (
                <Image
                  src={playerPhotoURL}
                  alt="Player"
                  width={24}
                  height={24}
                  className="w-full h-full object-cover rounded-full"
                />
              ) : (
                <span className="text-white font-bold text-xs">P</span>
              )}
            </div>
          </div>
        )}
        
        {/* 호버 시 시작점/도착점 미리보기 */}
        {isHovered && cellType === 'empty' && (
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
    
    const isWallPlacementMode = placeMode === 'wall' || isWallItemType(placeMode);
    const isInteractive = gamePhase === GamePhase.SETUP && !readOnly && !!onDirectionClick &&
      selectionMode === 'none' && isWallPlacementMode;
    const yieldsToCellPlacement = gamePhase === GamePhase.SETUP && !readOnly &&
      (selectionMode !== 'none' || !isWallPlacementMode);
    const containerClasses = `w-full h-2 z-10 relative
      ${isInteractive ? 'cursor-pointer wall-hit-horizontal hover:bg-yellow-200' : ''}
      ${yieldsToCellPlacement ? 'pointer-events-none' : ''}
      transition-all duration-150 ease-in-out bg-transparent`;
    
    return (
      <div
        key={`h-wall-${row}-${col}`}
        className={containerClasses}
        role={isInteractive ? 'button' : undefined}
        tabIndex={isInteractive ? 0 : undefined}
        aria-label={isInteractive ? `${position.row + 1}행 ${position.col + 1}열 ${direction} 벽` : undefined}
        onClick={(e) => {
          e.stopPropagation();
          if (isInteractive && onDirectionClick) {
            onDirectionClick(position, direction);
          }
        }}
        onMouseEnter={(e) => {
          e.stopPropagation();
          if (!isMouseDownRef.current && isInteractive) {
            setHoveredWall({ position, direction });
          }
        }}
        onMouseLeave={(e) => {
          e.stopPropagation();
          setHoveredWall(null);
        }}
        onKeyDown={(event) => {
          if (isInteractive && (event.key === 'Enter' || event.key === ' ')) {
            event.preventDefault();
            onDirectionClick(position, direction);
          }
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
        {renderItemWall(position, direction, 'horizontal')}
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
    
    const isWallPlacementMode = placeMode === 'wall' || isWallItemType(placeMode);
    const isInteractive = gamePhase === GamePhase.SETUP && !readOnly && !!onDirectionClick &&
      selectionMode === 'none' && isWallPlacementMode;
    const yieldsToCellPlacement = gamePhase === GamePhase.SETUP && !readOnly &&
      (selectionMode !== 'none' || !isWallPlacementMode);
    const containerClasses = `h-full w-2 z-10 relative 
      ${isInteractive ? 'cursor-pointer wall-hit-vertical hover:bg-yellow-200' : ''}
      ${yieldsToCellPlacement ? 'pointer-events-none' : ''}
      transition-all duration-150 ease-in-out bg-transparent`;
    
    return (
      <div
        key={`v-wall-${row}-${col}`}
        className={containerClasses}
        role={isInteractive ? 'button' : undefined}
        tabIndex={isInteractive ? 0 : undefined}
        aria-label={isInteractive ? `${position.row + 1}행 ${position.col + 1}열 ${direction} 벽` : undefined}
        onClick={(e) => {
          e.stopPropagation();
          if (isInteractive && onDirectionClick) {
            onDirectionClick(position, direction);
          }
        }}
        onMouseEnter={(e) => {
          e.stopPropagation();
          if (!isMouseDownRef.current && isInteractive) {
            setHoveredWall({ position, direction });
          }
        }}
        onMouseLeave={(e) => {
          e.stopPropagation();
          setHoveredWall(null);
        }}
        onKeyDown={(event) => {
          if (isInteractive && (event.key === 'Enter' || event.key === ' ')) {
            event.preventDefault();
            onDirectionClick(position, direction);
          }
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
        {renderItemWall(position, direction, 'vertical')}
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
    </div>
  );
};

export default GameBoard;
