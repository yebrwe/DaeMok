'use client';

import React, { useState, useRef, useCallback, useMemo } from 'react';
import Image from 'next/image';
import { CellType, CollisionWall, Direction, GamePhase, ItemType, MapItem, Obstacle, Position, SpecialWallType, WallItemType } from '@/types/game';
import { BOARD_SIZE, ITEM_LABELS, isSamePosition, isSameWallSegment, isWallItemType } from '@/lib/gameUtils';
import { findNearestWallPointerTarget } from '@/lib/wallPointer';

const ITEM_WALL_STYLES: Record<SpecialWallType, string> = {
  steelWall: 'bg-zinc-600 ring-zinc-100',
  fireWall: 'bg-orange-600 ring-yellow-200',
  poisonWall: 'bg-lime-600 ring-lime-100',
  iceWall: 'bg-sky-400 ring-white',
  windWall: 'bg-blue-600 ring-cyan-100',
  collapseWall: 'bg-stone-500 ring-stone-200',
  phaseWall: 'bg-violet-700 ring-fuchsia-200',
  mirrorWall: 'bg-slate-100 ring-cyan-500',
  thornWall: 'bg-rose-700 ring-rose-100',
  crystalWall: 'bg-fuchsia-700 ring-pink-100',
};

const NORMAL_WALL_STYLE = 'bg-[#6b1111] ring-2 ring-[#fecaca] shadow-sm shadow-red-950/70';
const PASSABLE_FLOOR_STYLES = ['bg-[#fffaf0]', 'bg-[#eff7df]'] as const;
const BOARD_FLOOR_STYLE = 'bg-[#c7d7b3]';

function NormalWallVisual({
  orientation,
  preview = false,
  collision = false,
}: {
  orientation: 'horizontal' | 'vertical';
  preview?: boolean;
  collision?: boolean;
}) {
  const dimensions = orientation === 'horizontal' ? 'h-1/2 w-3/4' : 'h-3/4 w-1/2';
  const appearance = collision
    ? 'wall-collision-impact bg-red-500 ring-2 ring-red-100'
    : NORMAL_WALL_STYLE;

  return <div className={`${dimensions} rounded-sm ${appearance} ${preview ? 'opacity-60' : ''}`} />;
}

const WALL_EFFECT_GLYPHS: Record<SpecialWallType, string> = {
  steelWall: '•••',
  fireWall: '▲▲▲',
  poisonWall: '●●●',
  iceWall: '◆◆◆',
  windWall: '»»»',
  collapseWall: '▼▼▼',
  phaseWall: '∿∿∿',
  mirrorWall: '◇◇◇',
  thornWall: '▲▲▲',
  crystalWall: '✦✦✦',
};

interface WallTarget {
  position: Position;
  direction: Direction;
}

function ItemWallVisual({
  type,
  orientation,
  preview = false,
  consumed = false,
  active = false,
  phaseOpen = false,
}: {
  type: WallItemType;
  orientation: 'horizontal' | 'vertical';
  preview?: boolean;
  consumed?: boolean;
  active?: boolean;
  phaseOpen?: boolean;
}) {
  const horizontal = orientation === 'horizontal';
  const dimensions = preview
    ? horizontal ? 'h-full w-[88%]' : 'h-[88%] w-full'
    : horizontal ? 'h-3/4 w-[82%]' : 'h-[82%] w-3/4';

  if (type === 'oneTimeWall') {
    return <NormalWallVisual orientation={orientation} preview={preview} />;
  }

  const inactiveCollapse = type === 'collapseWall' && !active && !consumed;
  const openedPhase = type === 'phaseWall' && phaseOpen && !consumed;
  let visualClasses = `${dimensions} ${horizontal ? 'border-x-2' : 'border-y-2'} ${ITEM_WALL_STYLES[type]} border-slate-950/50 ring-1`;
  if (inactiveCollapse) {
    visualClasses = `${dimensions} border-2 border-dashed border-stone-200 bg-stone-500/30 ring-1 ring-stone-300`;
  } else if (openedPhase) {
    visualClasses = `${dimensions} border-2 border-dashed border-violet-300 bg-violet-500/20 ring-1 ring-fuchsia-200/70`;
  }

  return (
    <div
      className={`wall-effect-visual ${visualClasses} ${preview ? 'wall-effect-guide' : 'wall-effect-installed'} ${consumed ? 'opacity-35' : ''}`}
      data-wall-effect={type}
      data-wall-orientation={orientation}
    >
      <span className="wall-effect-glyph" aria-hidden="true">{WALL_EFFECT_GLYPHS[type]}</span>
    </div>
  );
}

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
  items?: MapItem[] | null; // 맵 아이템들
  itemsConsumed?: Record<number, boolean> | null; // 인덱스별 사용 여부
  itemActiveWalls?: Record<number, boolean> | null; // 붕괴벽이 닫힌 상태
  itemPhaseOpen?: Record<number, boolean> | null; // 위상벽이 다음 시도에 열리는 상태
  pendingCell?: Position | null; // 배치 중 임시 표시 (웜홀 입구)
  validTargetCells?: Position[]; // 아이템 배치 시 안전하게 선택 가능한 셀
  revealedWalls?: Obstacle[]; // 탐지기로 밝혀낸 벽들 (일반 벽처럼 노란색으로 표시)
  placeMode?: 'wall' | ItemType;
  compact?: boolean; // 좁은 편집 화면에서 보드 전체가 팔레트 위에 보이도록 최대 셀 크기 제한
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
  items = null,
  itemsConsumed = null,
  itemActiveWalls = null,
  itemPhaseOpen = null,
  pendingCell = null,
  validTargetCells = [],
  revealedWalls = [],
  placeMode = 'wall',
  compact = false,
}) => {
  // 탐지기로 밝혀진 벽인지 (1회성 벽도 일반 벽으로 위장되어 포함됨)
  const isRadarRevealed = (position: Position, direction: Direction): boolean =>
    revealedWalls.some((w) => isSameWallSegment(position, direction, w.position, w.direction));

  const showItemsFully = gamePhase === GamePhase.SETUP || revealItems;

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

    if (item.type === 'oneTimeWall') {
      // 가짜벽의 정보는 규칙에만 존재한다. 보드에서는 제작자/상대/종료
      // 시점을 막론하고 일반벽과 완전히 같은 시각 경로를 사용한다.
      // 소비 뒤에는 기존 collision 레이어가 일반벽과 같은 발견 흔적을 남긴다.
      if (consumed) return null;
      return (
        <div className="absolute inset-0 flex items-center justify-center">
          <NormalWallVisual orientation={orientation} />
        </div>
      );
    }

    const active = !!itemActiveWalls?.[itemWallIndex];
    const phaseOpen = !!itemPhaseOpen?.[itemWallIndex];
    let wallState = consumed ? 'consumed' : 'armed';
    let stateLabel = consumed ? '소모됨' : '활성';

    if (item.type === 'collapseWall' && !consumed) {
      wallState = active ? 'closed' : 'armed';
      stateLabel = active ? '폐쇄됨' : '대기 · 통과 후 폐쇄';
    } else if (item.type === 'phaseWall' && !consumed) {
      wallState = phaseOpen ? 'open' : 'closed';
      stateLabel = phaseOpen ? '열림 · 다음 시도 통과' : '닫힘 · 다음 시도 차단';
    }

    return (
      <div
        data-map-item={item.type}
        data-wall-state={wallState}
        title={`${ITEM_LABELS[item.type]} · ${stateLabel}`}
        className={`absolute inset-0 flex items-center justify-center ${consumed ? 'opacity-35' : ''}`}
      >
        <ItemWallVisual
          type={item.type}
          orientation={orientation}
          consumed={consumed}
          active={active}
          phaseOpen={phaseOpen}
        />
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
  const isWallPlacementMode = placeMode === 'wall' || isWallItemType(placeMode);
  const canRouteWallPointer = gamePhase === GamePhase.SETUP && !readOnly &&
    !!onDirectionClick && selectionMode === 'none' && isWallPlacementMode;

  const setHoveredWallTarget = useCallback((target: WallTarget | null) => {
    setHoveredWall((current) => {
      if (!current && !target) return current;
      if (
        current && target &&
        current.position.row === target.position.row &&
        current.position.col === target.position.col &&
        current.direction === target.direction
      ) {
        return current;
      }
      return target;
    });
  }, []);
  
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

  const isWallOccupied = (position: Position, direction: Direction): boolean =>
    hasObstacle(position, direction) || findItemWallIndex(position, direction) >= 0;

  const selectedWallType = placeMode !== 'wall' && isWallItemType(placeMode) ? placeMode : null;
  const suggestedGuideWall = useMemo<WallTarget | null>(() => {
    if (!selectedWallType) return null;

    const center = (BOARD_SIZE - 1) / 2;
    const reservedCells = [
      startPosition,
      endPosition,
      pendingCell,
      ...(items || []).flatMap((item) => [item.position, item.entrance, item.exit]),
    ].filter((position): position is Position => !!position);
    const candidates: Array<WallTarget & { distance: number; markerPenalty: number }> = [];
    for (let row = 0; row < BOARD_SIZE; row += 1) {
      for (let col = 0; col < BOARD_SIZE; col += 1) {
        if (col < BOARD_SIZE - 1) {
          const adjacent = { row, col: col + 1 };
          candidates.push({
            position: { row, col },
            direction: 'right',
            distance: Math.abs(row - center) + Math.abs(col + 0.5 - center),
            markerPenalty: reservedCells.some((cell) =>
              isSamePosition(cell, { row, col }) || isSamePosition(cell, adjacent)
            ) ? 10 : 0,
          });
        }
        if (row < BOARD_SIZE - 1) {
          const adjacent = { row: row + 1, col };
          candidates.push({
            position: { row, col },
            direction: 'down',
            distance: Math.abs(row + 0.5 - center) + Math.abs(col - center),
            markerPenalty: reservedCells.some((cell) =>
              isSamePosition(cell, { row, col }) || isSamePosition(cell, adjacent)
            ) ? 10 : 0,
          });
        }
      }
    }

    candidates.sort((left, right) =>
      left.markerPenalty - right.markerPenalty ||
      left.distance - right.distance ||
      left.position.row - right.position.row ||
      left.position.col - right.position.col ||
      left.direction.localeCompare(right.direction)
    );

    const available = candidates.find((candidate) => {
      const blockedByObstacle = (obstacles || []).some((obstacle) =>
        isSameWallSegment(
          candidate.position,
          candidate.direction,
          obstacle.position,
          obstacle.direction
        )
      );
      const blockedByItem = (items || []).some((item) =>
        isWallItemType(item.type) &&
        !!item.wallPosition &&
        !!item.wallDirection &&
        isSameWallSegment(
          candidate.position,
          candidate.direction,
          item.wallPosition,
          item.wallDirection
        )
      );
      return !blockedByObstacle && !blockedByItem;
    });

    return available
      ? { position: available.position, direction: available.direction }
      : null;
  }, [endPosition, items, obstacles, pendingCell, selectedWallType, startPosition]);

  const activeGuideWall = selectedWallType
    ? hoveredWall || suggestedGuideWall
    : null;

  const isGuideWall = (position: Position, direction: Direction): boolean =>
    !!activeGuideWall && isSameWallSegment(
      position,
      direction,
      activeGuideWall.position,
      activeGuideWall.direction
    );

  const renderWallPlacementFeedback = (
    position: Position,
    direction: Direction,
    orientation: 'horizontal' | 'vertical',
    occupied: boolean
  ) => {
    if (!selectedWallType || !isGuideWall(position, direction)) return null;

    if (occupied) {
      return (
        <div
          className="pointer-events-none absolute inset-0 z-30 flex items-center justify-center"
          data-wall-conflict="true"
          aria-hidden="true"
        >
          <span className="wall-guide-conflict flex size-4 items-center justify-center rounded-full border border-red-100 bg-red-600 text-[11px] font-black leading-none text-white shadow-lg shadow-red-950/70">×</span>
        </div>
      );
    }

    return (
      <div
        className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center"
        data-wall-guide={selectedWallType}
        data-guide-source={hoveredWall ? 'pointer' : 'suggested'}
        aria-hidden="true"
      >
        <ItemWallVisual type={selectedWallType} orientation={orientation} preview />
        <span
          className={`wall-guide-badge absolute rounded-full border border-cyan-100/80 bg-slate-950/90 px-1 py-px text-[7px] font-black leading-none text-cyan-100 shadow-sm ${
            orientation === 'horizontal'
              ? '-top-[9px] left-1/2 -translate-x-1/2'
              : '-right-[16px] top-1/2 -translate-y-1/2'
          }`}
        >
          예시
        </span>
      </div>
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
    
    const cellSizeClasses = compact
      ? 'h-10 w-10 sm:h-[41px] sm:w-[41px]'
      : 'w-10 h-10 sm:w-12 sm:h-12 md:w-14 md:h-14';
    const floorStyle = PASSABLE_FLOOR_STYLES[(position.row + position.col) % 2];
    const cellClasses = `
      relative ${cellSizeClasses}
      ${isValidTarget ? 'bg-emerald-50 ring-2 ring-inset ring-emerald-400' : floorStyle}
      shadow-[inset_0_0_0_1px_rgb(100_116_139/0.22)]
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
    const isOccupied = isWallOccupied(position, direction);
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
    
    const isInteractive = gamePhase === GamePhase.SETUP && !readOnly && !!onDirectionClick &&
      selectionMode === 'none' && isWallPlacementMode;
    const yieldsToCellPlacement = gamePhase === GamePhase.SETUP && !readOnly &&
      (selectionMode !== 'none' || !isWallPlacementMode);
    const hasPlacementConflict = !!selectedWallType && isGuideWall(position, direction) && isOccupied;
    const containerClasses = `w-full h-2 z-10 relative
      ${isInteractive ? 'cursor-pointer wall-hit-horizontal' : ''}
      ${isInteractive && placeMode === 'wall' ? 'hover:bg-red-100' : ''}
      ${hasPlacementConflict ? '!cursor-not-allowed bg-red-500/25' : ''}
      ${yieldsToCellPlacement ? 'pointer-events-none' : ''}
      transition-all duration-150 ease-in-out bg-transparent`;
    
    return (
      <div
        key={`h-wall-${row}-${col}`}
        className={containerClasses}
        data-wall-segment={`${position.row},${position.col}:${direction}`}
        data-wall-occupied={isOccupied ? 'true' : 'false'}
        role={isInteractive ? 'button' : undefined}
        tabIndex={isInteractive ? 0 : undefined}
        aria-label={isInteractive ? `${position.row + 1}행 ${position.col + 1}열 ${direction} 벽${hasPlacementConflict ? ' · 이미 점유됨' : ''}` : undefined}
        aria-disabled={hasPlacementConflict || undefined}
        onFocus={() => {
          if (isInteractive) setHoveredWall({ position, direction });
        }}
        onBlur={() => setHoveredWall(null)}
        onClick={(e) => {
          e.stopPropagation();
          if (isInteractive && onDirectionClick) {
            onDirectionClick(position, direction);
          }
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
          {isHovered && placeMode === 'wall' && !isOccupied && (
            <div className="absolute inset-0 flex items-center justify-center">
              <NormalWallVisual orientation="horizontal" preview />
            </div>
          )}
          {isBlocked && (
            <div className="absolute inset-0 flex items-center justify-center">
              <NormalWallVisual orientation="horizontal" />
            </div>
          )}
          </>
        )}
        {/* 플레이 단계: 충돌한 벽만 빨간색으로 표시 */}
        {gamePhase === GamePhase.PLAY && isCollision && (
          <div className="absolute inset-0 flex items-center justify-center">
            <NormalWallVisual orientation="horizontal" collision />
          </div>
        )}
        {/* 게임 종료: 아직 충돌하지 않은 벽 공개 */}
        {gamePhase === GamePhase.PLAY && revealObstacles && isBlocked && !isCollision && (
          <div className="absolute inset-0 flex items-center justify-center">
            <NormalWallVisual orientation="horizontal" />
          </div>
        )}
        {renderItemWall(position, direction, 'horizontal')}
        {gamePhase === GamePhase.SETUP &&
          renderWallPlacementFeedback(position, direction, 'horizontal', isOccupied)}
        {/* 탐지기로 밝혀낸 벽 (1회성 벽도 일반 벽으로 위장) */}
        {gamePhase === GamePhase.PLAY && !revealObstacles && !isCollision &&
          isRadarRevealed(position, direction) && (
          <div className="absolute inset-0 flex items-center justify-center">
            <NormalWallVisual orientation="horizontal" />
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
    const isOccupied = isWallOccupied(position, direction);
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
    
    const isInteractive = gamePhase === GamePhase.SETUP && !readOnly && !!onDirectionClick &&
      selectionMode === 'none' && isWallPlacementMode;
    const yieldsToCellPlacement = gamePhase === GamePhase.SETUP && !readOnly &&
      (selectionMode !== 'none' || !isWallPlacementMode);
    const hasPlacementConflict = !!selectedWallType && isGuideWall(position, direction) && isOccupied;
    const containerClasses = `h-full w-2 z-10 relative 
      ${isInteractive ? 'cursor-pointer wall-hit-vertical' : ''}
      ${isInteractive && placeMode === 'wall' ? 'hover:bg-red-100' : ''}
      ${hasPlacementConflict ? '!cursor-not-allowed bg-red-500/25' : ''}
      ${yieldsToCellPlacement ? 'pointer-events-none' : ''}
      transition-all duration-150 ease-in-out bg-transparent`;
    
    return (
      <div
        key={`v-wall-${row}-${col}`}
        className={containerClasses}
        data-wall-segment={`${position.row},${position.col}:${direction}`}
        data-wall-occupied={isOccupied ? 'true' : 'false'}
        role={isInteractive ? 'button' : undefined}
        tabIndex={isInteractive ? 0 : undefined}
        aria-label={isInteractive ? `${position.row + 1}행 ${position.col + 1}열 ${direction} 벽${hasPlacementConflict ? ' · 이미 점유됨' : ''}` : undefined}
        aria-disabled={hasPlacementConflict || undefined}
        onFocus={() => {
          if (isInteractive) setHoveredWall({ position, direction });
        }}
        onBlur={() => setHoveredWall(null)}
        onClick={(e) => {
          e.stopPropagation();
          if (isInteractive && onDirectionClick) {
            onDirectionClick(position, direction);
          }
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
          {isHovered && placeMode === 'wall' && !isOccupied && (
            <div className="absolute inset-0 flex items-center justify-center">
              <NormalWallVisual orientation="vertical" preview />
            </div>
          )}
          {isBlocked && (
            <div className="absolute inset-0 flex items-center justify-center">
              <NormalWallVisual orientation="vertical" />
            </div>
          )}
          </>
        )}
        {/* 플레이 단계: 충돌한 벽만 빨간색으로 표시 */}
        {gamePhase === GamePhase.PLAY && isCollision && (
          <div className="absolute inset-0 flex items-center justify-center">
            <NormalWallVisual orientation="vertical" collision />
          </div>
        )}
        {/* 게임 종료: 아직 충돌하지 않은 벽 공개 */}
        {gamePhase === GamePhase.PLAY && revealObstacles && isBlocked && !isCollision && (
          <div className="absolute inset-0 flex items-center justify-center">
            <NormalWallVisual orientation="vertical" />
          </div>
        )}
        {renderItemWall(position, direction, 'vertical')}
        {gamePhase === GamePhase.SETUP &&
          renderWallPlacementFeedback(position, direction, 'vertical', isOccupied)}
        {/* 탐지기로 밝혀낸 벽 (1회성 벽도 일반 벽으로 위장) */}
        {gamePhase === GamePhase.PLAY && !revealObstacles && !isCollision &&
          isRadarRevealed(position, direction) && (
          <div className="absolute inset-0 flex items-center justify-center">
            <NormalWallVisual orientation="vertical" />
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
        data-maze-board-grid
        data-maze-floor-tone="cream-sage"
        data-wall-pointer-routing="nearest"
        className={`mx-auto grid gap-0 overflow-auto rounded-xl border-4 border-slate-950 ${BOARD_FLOOR_STYLE} p-1 shadow-[0_5px_0_#0f172a,0_14px_28px_rgb(0_0_0/0.38)] touch-action-none ${compact ? '' : 'sm:p-2'}`}
        style={{
          gridTemplateColumns: `repeat(${BOARD_SIZE * 2 - 1}, auto)`,
          gridTemplateRows: `repeat(${BOARD_SIZE * 2 - 1}, auto)`
        }}
        onPointerMove={(event) => {
          if (!canRouteWallPointer || event.pointerType !== 'mouse' || isMouseDownRef.current) return;
          setHoveredWallTarget(findNearestWallPointerTarget(
            event.currentTarget,
            event.clientX,
            event.clientY,
            'data-wall-segment'
          ));
        }}
        onPointerDownCapture={(event) => {
          // tabIndex가 있는 벽/칸을 포인터로 누르면 브라우저가 포커스 대상을
          // 스크롤 컨테이너 안으로 끌어당겨 보드가 튀었다. 포인터 조작에서는
          // 포커스 기본 동작을 막는다 (키보드 탐색은 그대로 동작한다).
          const target = event.target as HTMLElement | null;
          if (target?.closest?.('[data-wall-segment], [data-cell]')) {
            event.preventDefault();
          }
          if (!canRouteWallPointer || event.pointerType === 'mouse') return;
          setHoveredWallTarget(findNearestWallPointerTarget(
            event.currentTarget,
            event.clientX,
            event.clientY,
            'data-wall-segment'
          ));
        }}
        onPointerLeave={() => {
          if (canRouteWallPointer) setHoveredWallTarget(null);
        }}
        onClickCapture={(event) => {
          // Keyboard and assistive-technology activation already identifies an exact
          // focused segment, so preserve the segment's own click/keydown behavior.
          if (!canRouteWallPointer || event.detail === 0) return;

          event.preventDefault();
          event.stopPropagation();
          const target = findNearestWallPointerTarget(
            event.currentTarget,
            event.clientX,
            event.clientY,
            'data-wall-segment'
          );
          if (!target) return;

          setHoveredWallTarget(target);
          onDirectionClick(target.position, target.direction);
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
