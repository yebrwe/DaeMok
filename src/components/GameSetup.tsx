'use client';

import React, { useState, useEffect } from 'react';
import { Direction, GameMap, GamePhase, ItemType, MapItem, Obstacle, Position } from '@/types/game';
import GameBoard from './GameBoard';
import GameBoard3D from './three/GameBoard3D';
import {
  isValidMap,
  BOARD_SIZE,
  MAX_OBSTACLES,
  ITEM_COSTS,
  ITEM_LABELS,
  isSameWallSegment,
  isSamePosition,
} from '@/lib/gameUtils';

interface GameSetupProps {
  onMapComplete: (map: GameMap) => void;
}

type PlaceMode = 'wall' | ItemType;

const GameSetup: React.FC<GameSetupProps> = ({ onMapComplete }) => {
  const [startPosition, setStartPosition] = useState<Position | undefined>();
  const [endPosition, setEndPosition] = useState<Position | undefined>();
  const [obstacles, setObstacles] = useState<Obstacle[]>([]);
  const [setupPhase, setSetupPhase] = useState<'start' | 'end' | 'obstacles'>('start');
  const [isMapValid, setIsMapValid] = useState<boolean>(false);
  // 맵 제작은 정밀한 배치가 필요하므로 2D가 기본, 3D는 미리보기용
  const [view3D, setView3D] = useState<boolean>(false);
  // 아이템 배치 (게임당 1개, 벽 예산 소모)
  const [placeMode, setPlaceMode] = useState<PlaceMode>('wall');
  const [item, setItem] = useState<MapItem | null>(null);
  const [wormholeEntrance, setWormholeEntrance] = useState<Position | null>(null);

  const itemCost = item ? ITEM_COSTS[item.type] : placeMode !== 'wall' ? ITEM_COSTS[placeMode] : 0;
  
  // 고유한 벽의 수 계산 함수
  const countUniqueObstacles = (obstacleList: Obstacle[]): number => {
    // 이미 계산된 벽을 추적하기 위한 집합 - 각 벽은 한 번만 카운트됩니다
    const countedWalls = new Set<string>();
    
    // 각 장애물에 대해 처리
    obstacleList.forEach(obstacle => {
      const { position, direction } = obstacle;
      
      // 인접 셀과 방향 계산 - 두 셀이 공유하는 벽을 찾기 위함
      let adjacentPosition: Position | null = null;
      let oppositeDirection: Direction | null = null;
      
      switch (direction) {
        case 'up':
          if (position.row > 0) {
            adjacentPosition = { row: position.row - 1, col: position.col };
            oppositeDirection = 'down';
          }
          break;
        case 'down':
          if (position.row < BOARD_SIZE - 1) {
            adjacentPosition = { row: position.row + 1, col: position.col };
            oppositeDirection = 'up';
          }
          break;
        case 'left':
          if (position.col > 0) {
            adjacentPosition = { row: position.row, col: position.col - 1 };
            oppositeDirection = 'right';
          }
          break;
        case 'right':
          if (position.col < BOARD_SIZE - 1) {
            adjacentPosition = { row: position.row, col: position.col + 1 };
            oppositeDirection = 'left';
          }
          break;
      }
      
      // 벽의 고유 식별자 생성 (작은 좌표가 먼저 오도록 정렬)
      // 이렇게 하면 같은 벽이라도 어느 셀에서 보는지에 따라 다른 ID가 생성되는 것을 방지합니다
      let wallId: string;
      if (adjacentPosition && oppositeDirection) {
        // 두 셀의 위치를 비교하여 항상 같은 순서로 ID를 생성
        // 예: (2,3)의 'right'와 (2,4)의 'left'는 같은 벽이므로 같은 ID를 가져야 함
        if (
          position.row < adjacentPosition.row || 
          (position.row === adjacentPosition.row && position.col < adjacentPosition.col)
        ) {
          wallId = `${position.row},${position.col}:${direction}`;
        } else {
          wallId = `${adjacentPosition.row},${adjacentPosition.col}:${oppositeDirection}`;
        }
      } else {
        // 외곽 벽의 경우 (인접 셀이 없음)
        wallId = `${position.row},${position.col}:${direction}`;
      }
      
      // 이 벽을 집합에 추가 - 중복된 벽은 한 번만 카운트됨
      countedWalls.add(wallId);
    });
    
    // 고유한 벽의 수 반환
    return countedWalls.size;
  };
  
  // 인접 셀과 방향 계산 유틸리티 함수
  const getAdjacentCellInfo = (position: Position, direction: Direction): { 
    adjacentPosition: Position | null, 
    oppositeDirection: Direction | null 
  } => {
    let adjacentPosition: Position | null = null;
    let oppositeDirection: Direction | null = null;
    
    switch (direction) {
      case 'up':
        if (position.row > 0) {
          adjacentPosition = { row: position.row - 1, col: position.col };
          oppositeDirection = 'down';
        }
        break;
      case 'down':
        if (position.row < BOARD_SIZE - 1) {
          adjacentPosition = { row: position.row + 1, col: position.col };
          oppositeDirection = 'up';
        }
        break;
      case 'left':
        if (position.col > 0) {
          adjacentPosition = { row: position.row, col: position.col - 1 };
          oppositeDirection = 'right';
        }
        break;
      case 'right':
        if (position.col < BOARD_SIZE - 1) {
          adjacentPosition = { row: position.row, col: position.col + 1 };
          oppositeDirection = 'left';
        }
        break;
    }
    
    return { adjacentPosition, oppositeDirection };
  };
  
  // 셀에 아이템을 놓을 수 있는지 (시작/도착점 제외)
  const canPlaceItemOnCell = (position: Position): boolean => {
    if (startPosition && isSamePosition(position, startPosition)) return false;
    if (endPosition && isSamePosition(position, endPosition)) return false;
    return true;
  };

  // 셀 클릭 핸들러
  const handleCellClick = (position: Position) => {
    if (setupPhase === 'start') {
      setStartPosition(position);
      setSetupPhase('end');
    } else if (setupPhase === 'end') {
      // 시작점과 같은 위치에 도착점을 설정하지 못하도록 함
      if (startPosition && startPosition.row === position.row && startPosition.col === position.col) {
        return;
      }
      setEndPosition(position);
      setSetupPhase('obstacles');
    } else if (setupPhase === 'obstacles') {
      // 아이템 배치 모드에서의 셀 클릭
      if (item) return;

      if (placeMode === 'mine') {
        if (!canPlaceItemOnCell(position)) return;
        setItem({ type: 'mine', position });
        setPlaceMode('wall');
      } else if (placeMode === 'wormhole') {
        if (!canPlaceItemOnCell(position)) return;

        if (!wormholeEntrance) {
          // 첫 클릭: 입구 지정
          setWormholeEntrance(position);
        } else {
          // 두 번째 클릭: 출구 지정 (입구와 달라야 함)
          if (isSamePosition(position, wormholeEntrance)) return;
          setItem({ type: 'wormhole', entrance: wormholeEntrance, exit: position });
          setWormholeEntrance(null);
          setPlaceMode('wall');
        }
      }
    }
  };
  
  // 방향 클릭 핸들러 (장애물 배치)
  const handleDirectionClick = (position: Position, direction: Direction) => {
    if (setupPhase !== 'obstacles') {
      return;
    }

    // 1회성 벽 배치 모드
    if (placeMode === 'oneTimeWall') {
      if (item) return;
      // 일반 벽과 겹치면 배치 불가
      const overlapsWall = obstacles.some((o) =>
        isSameWallSegment(position, direction, o.position, o.direction)
      );
      if (overlapsWall) return;

      setItem({ type: 'oneTimeWall', wallPosition: position, wallDirection: direction });
      setPlaceMode('wall');
      return;
    }

    // 일반 벽이 1회성 벽 아이템과 겹치면 배치 불가
    if (
      item?.type === 'oneTimeWall' &&
      item.wallPosition &&
      item.wallDirection &&
      isSameWallSegment(position, direction, item.wallPosition, item.wallDirection)
    ) {
      return;
    }

    // 이미 존재하는 장애물인지 확인
    const obstacleExists = obstacles.some(
      (o) => o.position.row === position.row && 
             o.position.col === position.col && 
             o.direction === direction
    );
    
    // 인접 셀과 방향 계산
    const { adjacentPosition, oppositeDirection } = getAdjacentCellInfo(position, direction);
    
    if (obstacleExists) {
      // 이미 존재하는 장애물이면 제거
      let updatedObstacles = [...obstacles];
      
      // 현재 장애물 제거
      updatedObstacles = updatedObstacles.filter(
        (o) => !(o.position.row === position.row && 
                o.position.col === position.col && 
                o.direction === direction)
      );
      
      // 인접 셀의 공유 벽에 있는 장애물도 제거
      if (adjacentPosition && oppositeDirection) {
        updatedObstacles = updatedObstacles.filter(
          (o) => !(o.position.row === adjacentPosition.row && 
                  o.position.col === adjacentPosition.col && 
                  o.direction === oppositeDirection)
        );
      }
      
      setObstacles(updatedObstacles);
    } else {
      // 새 장애물 배열 생성
      let newObstacles = [...obstacles];
      
      // 인접 셀의 공유 벽에 이미 장애물이 있는지 확인
      const adjacentObstacleExists = adjacentPosition && oppositeDirection && 
        obstacles.some(
          (o) => o.position.row === adjacentPosition.row && 
                o.position.col === adjacentPosition.col && 
                o.direction === oppositeDirection
        );
      
      if (adjacentObstacleExists) {
        // 인접 셀의 공유 벽에 이미 장애물이 있으면 아무것도 하지 않음
        return;
      }
      
      // 새 장애물 객체
      const newObstacle: Obstacle = {
        position,
        direction,
      };
      
      // 인접 셀의 공유 벽 객체
      const adjacentObstacle = adjacentPosition && oppositeDirection ? {
        position: adjacentPosition,
        direction: oppositeDirection,
      } : null;
      
      // 일시적으로 장애물 추가해보기
      const tempObstacles = [...newObstacles, newObstacle];
      if (adjacentObstacle) {
        tempObstacles.push(adjacentObstacle);
      }
      
      // 고유한 벽의 수 계산 (배치된 아이템 비용 포함)
      const placedItemCost = item ? ITEM_COSTS[item.type] : 0;
      const uniqueObstacleCount = countUniqueObstacles(tempObstacles);

      // 벽 예산 확인 (아이템 비용 포함 최대 개수를 초과하지 않는지)
      if (uniqueObstacleCount + placedItemCost <= MAX_OBSTACLES) {
        setObstacles(tempObstacles);
      } else {
        alert(`벽 예산(${MAX_OBSTACLES}개)을 초과했습니다. 아이템 비용 ${placedItemCost}개가 포함되어 있습니다.`);
      }
    }
  };

  // 아이템 선택/제거
  const handleSelectItemMode = (type: ItemType) => {
    if (item) return;
    const wallCount = countUniqueObstacles(obstacles);
    if (wallCount + ITEM_COSTS[type] > MAX_OBSTACLES) {
      alert(`벽 예산이 부족합니다. ${ITEM_LABELS[type]}은(는) 벽 ${ITEM_COSTS[type]}개를 소모합니다.`);
      return;
    }
    setWormholeEntrance(null);

    // 탐지기는 배치가 필요 없는 자기용 아이템 - 선택 즉시 확보
    if (type === 'radar') {
      setItem({ type: 'radar' });
      setPlaceMode('wall');
      return;
    }

    setPlaceMode((prev) => (prev === type ? 'wall' : type));
  };

  const handleRemoveItem = () => {
    setItem(null);
    setWormholeEntrance(null);
    setPlaceMode('wall');
  };
  
  // 맵 완성 및 제출
  const handleSubmit = () => {
    if (!startPosition || !endPosition) {
      alert('시작점과 도착점을 모두 설정해야 합니다.');
      return;
    }
    
    const map: GameMap = {
      startPosition,
      endPosition,
      obstacles,
      item: item ?? null,
    };

    // 맵 유효성 검사 (1회성 벽은 부술 수 있으므로 경로 판정에서 제외)
    if (!isValidMap(map)) {
      alert('유효하지 않은 맵입니다. 시작점에서 도착점까지 도달할 수 있는 경로가 있어야 합니다.');
      return;
    }

    onMapComplete(map);
  };

  // 맵 유효성 검사
  useEffect(() => {
    if (startPosition && endPosition) {
      const map: GameMap = {
        startPosition,
        endPosition,
        obstacles,
      };

      setIsMapValid(isValidMap(map));
    }
  }, [startPosition, endPosition, obstacles]);

  // 사용한 벽 예산 (아이템 비용 포함)
  const usedBudget = countUniqueObstacles(obstacles) + (item ? ITEM_COSTS[item.type] : 0);
  const remainingObstacles = MAX_OBSTACLES - usedBudget;
  
  const steps: Array<{ key: 'start' | 'end' | 'obstacles'; label: string }> = [
    { key: 'start', label: '시작점' },
    { key: 'end', label: '도착점' },
    { key: 'obstacles', label: '벽 배치' },
  ];
  const currentStepIndex = steps.findIndex((s) => s.key === setupPhase);

  return (
    <div className="flex flex-col items-center w-full max-w-2xl mx-auto">
      {/* 맵 제작 단계 스테퍼 */}
      <div className="w-full game-panel !rounded-xl px-3 py-2 mb-2">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5">
            {steps.map((s, i) => (
              <div key={s.key} className="flex items-center gap-1.5">
                <div
                  className={`flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold border ${
                    i === currentStepIndex
                      ? 'bg-amber-400/15 text-amber-300 border-amber-400/50'
                      : i < currentStepIndex
                        ? 'bg-green-400/10 text-green-300 border-green-400/40'
                        : 'bg-slate-800/60 text-slate-500 border-slate-600/40'
                  }`}
                >
                  <span>{i < currentStepIndex ? '✓' : i + 1}</span>
                  <span>{s.label}</span>
                </div>
                {i < steps.length - 1 && <span className="text-slate-600 text-[10px]">›</span>}
              </div>
            ))}
          </div>
          <div className="flex items-center gap-2">
            {setupPhase === 'obstacles' && (
              <span className={`text-xs font-bold ${remainingObstacles <= 5 ? 'text-red-400' : 'text-amber-300'}`}>
                🧱 {usedBudget}/{MAX_OBSTACLES}
                {item && <span className="text-purple-300 ml-1">(아이템 -{ITEM_COSTS[item.type]})</span>}
              </span>
            )}
            <button
              className="btn-sub text-xs px-2 py-1 !rounded-lg"
              onClick={() => setView3D((prev) => !prev)}
            >
              {view3D ? '2D 보기' : '3D 보기'}
            </button>
          </div>
        </div>
        <div className="text-xs font-medium text-slate-300 mt-1.5">
          {setupPhase === 'start' && '시작점을 선택하세요 - 상대방은 여기서 출발합니다'}
          {setupPhase === 'end' && '도착점을 선택하세요 - 상대방이 도달해야 하는 곳입니다'}
          {setupPhase === 'obstacles' && '벽(장애물)을 배치하세요 - 상대방에게는 보이지 않습니다'}
        </div>
      </div>

      {setupPhase === 'obstacles' && (
        <div className="w-full mb-2 px-3 py-1.5 rounded-xl bg-blue-500/10 border border-blue-400/30 text-[11px] text-blue-200 flex justify-between items-center">
          <span>칸 사이 선을 클릭해 벽을 놓거나 제거합니다. 시작→도착 경로는 반드시 남겨야 합니다.</span>
          <span className="font-bold text-blue-300 shrink-0 ml-2">{remainingObstacles}개 남음</span>
        </div>
      )}

      {/* 아이템 팔레트 - 게임당 1개, 벽 예산 소모 */}
      {setupPhase === 'obstacles' && (
        <div className="w-full mb-2 game-panel !rounded-xl px-3 py-2">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <span className="text-[11px] font-bold text-purple-300">🎁 아이템 (게임당 1개)</span>
            <div className="flex gap-1.5 flex-wrap">
              {(['oneTimeWall', 'mine', 'wormhole', 'radar'] as ItemType[]).map((type) => (
                <button
                  key={type}
                  className={`px-2 py-1 rounded-lg text-[11px] font-bold border transition-colors ${
                    item?.type === type
                      ? 'bg-purple-400/20 text-purple-200 border-purple-400/60'
                      : placeMode === type
                        ? 'bg-amber-400 text-slate-900 border-amber-400'
                        : 'bg-slate-800/80 text-slate-300 border-slate-600/60 hover:border-purple-400/50'
                  } disabled:opacity-40 disabled:pointer-events-none`}
                  onClick={() => handleSelectItemMode(type)}
                  disabled={!!item}
                >
                  {type === 'oneTimeWall' ? '🧱' : type === 'mine' ? '💣' : type === 'wormhole' ? '🌀' : '🔍'} {ITEM_LABELS[type]} -{ITEM_COSTS[type]}
                </button>
              ))}
              {item && (
                <button
                  className="px-2 py-1 rounded-lg text-[11px] font-bold bg-red-500/10 text-red-300 border border-red-400/50 hover:bg-red-500/20 transition-colors"
                  onClick={handleRemoveItem}
                >
                  ✕ 아이템 제거
                </button>
              )}
            </div>
          </div>
          {placeMode !== 'wall' && !item && (
            <p className="text-[11px] text-amber-300 mt-1.5">
              {placeMode === 'oneTimeWall' && '칸 사이 선을 클릭해 1회성 벽을 배치하세요. 한 번 부딪히면 부서집니다.'}
              {placeMode === 'mine' && '칸을 클릭해 지뢰를 배치하세요. 밟으면 2턴 전 위치로 되돌아갑니다.'}
              {placeMode === 'wormhole' &&
                (wormholeEntrance
                  ? '🌀 출구가 될 칸을 클릭하세요. (입구를 밟으면 이곳으로 이동)'
                  : '🌀 입구가 될 칸을 클릭하세요.')}
            </p>
          )}
          {item && (
            <p className="text-[11px] text-purple-200 mt-1.5">
              {item.type === 'oneTimeWall' && '🧱 1회성 벽 배치됨 - 상대가 부딪히면 턴을 소모시키고 부서집니다.'}
              {item.type === 'mine' && '💣 지뢰 배치됨 - 상대가 밟으면 2턴 전 위치로 되돌아갑니다.'}
              {item.type === 'wormhole' && '🌀 웜홀 배치됨 - 입구를 밟으면 출구로 순간이동합니다. (1회성)'}
              {item.type === 'radar' && '🔍 탐지기 확보됨 - 게임 중 1회, 내 주변 한 칸(대각선 포함)의 벽을 탐지합니다.'}
            </p>
          )}
        </div>
      )}
      
      <div className="flex justify-center w-full">
        {view3D ? (
          <GameBoard3D
            gamePhase={GamePhase.SETUP}
            startPosition={startPosition}
            endPosition={endPosition}
            obstacles={obstacles}
            item={item}
            onCellClick={
              setupPhase !== 'obstacles' || placeMode === 'mine' || placeMode === 'wormhole'
                ? handleCellClick
                : undefined
            }
            onDirectionClick={setupPhase === 'obstacles' ? handleDirectionClick : undefined}
            selectionMode={setupPhase === 'start' ? 'start' : setupPhase === 'end' ? 'end' : 'none'}
          />
        ) : (
          <GameBoard
            gamePhase={GamePhase.SETUP}
            startPosition={startPosition}
            endPosition={endPosition}
            obstacles={obstacles}
            item={item}
            pendingCell={wormholeEntrance}
            onCellClick={handleCellClick}
            onDirectionClick={handleDirectionClick}
            selectionMode={setupPhase === 'start' ? 'start' : setupPhase === 'end' ? 'end' : 'none'}
          />
        )}
      </div>
      
      <div className="mt-3 flex gap-2 w-full justify-center">
        {setupPhase === 'start' && (
          <button
            className="btn-game px-6 py-2 text-sm"
            onClick={() => {
              if (startPosition) {
                setSetupPhase('end');
              }
            }}
            disabled={!startPosition}
          >
            다음
          </button>
        )}

        {setupPhase === 'end' && (
          <div className="flex gap-2">
            <button
              className="btn-sub px-4 py-2 text-sm"
              onClick={() => setSetupPhase('start')}
            >
              이전
            </button>
            <button
              className="btn-game px-6 py-2 text-sm"
              onClick={() => {
                if (endPosition) {
                  setSetupPhase('obstacles');
                }
              }}
              disabled={!endPosition}
            >
              다음
            </button>
          </div>
        )}

        {setupPhase === 'obstacles' && (
          <div className="flex gap-2">
            <button
              className="btn-sub px-4 py-2 text-sm"
              onClick={() => setSetupPhase('end')}
            >
              이전
            </button>
            <button
              className="btn-game px-8 py-2 text-sm"
              onClick={handleSubmit}
              disabled={!isMapValid}
            >
              완료
            </button>
          </div>
        )}
      </div>

      {setupPhase === 'obstacles' && !isMapValid && obstacles.length > 0 && (
        <p className="text-red-400 text-xs mt-2 px-3 py-1 rounded-full bg-red-500/10 border border-red-500/40">
          현재 맵 구성으로는 시작점에서 도착점까지 도달할 수 없습니다.
        </p>
      )}
    </div>
  );
};

export default GameSetup; 