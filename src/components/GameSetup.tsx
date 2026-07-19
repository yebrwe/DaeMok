'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Direction, GameMap, GamePhase, ItemType, MapItem, Obstacle, Position } from '@/types/game';
import {
  Aperture,
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Bomb,
  BrickWall,
  CloudFog,
  Flame,
  FlaskConical,
  Gem,
  LucideIcon,
  Shield,
  ShieldAlert,
  Snowflake,
  Redo2,
  Undo2,
  Waves,
  Wind,
  X,
} from 'lucide-react';
import GameBoard from './GameBoard';
import {
  isValidNewMap,
  BOARD_SIZE,
  DEFAULT_MAZE_SKILL,
  GAME_RULES_VERSION,
  MAX_OBSTACLES,
  ITEM_COSTS,
  ITEM_LIMITS,
  ITEM_LABELS,
  cloneMapItem,
  getWormholeExitSafetyError,
  isWallItemType,
  isSameWallSegment,
  isSamePosition,
} from '@/lib/gameUtils';

interface GameSetupProps {
  onMapComplete: (map: GameMap) => void;
  onDraftChange?: (map: GameMap) => void;
  initialMap?: GameMap | null;
  requireFullBudget?: boolean;
}

interface MapEditorSnapshot {
  startPosition?: Position;
  endPosition?: Position;
  obstacles: Obstacle[];
  items: MapItem[];
  setupPhase: 'start' | 'end' | 'obstacles';
}

const MAX_EDITOR_HISTORY = 100;

function clonePosition(position: Position | undefined): Position | undefined {
  return position ? { ...position } : undefined;
}

function cloneMapItems(items: readonly MapItem[]): MapItem[] {
  return items.map(cloneMapItem);
}

function cloneEditorSnapshot(snapshot: MapEditorSnapshot): MapEditorSnapshot {
  return {
    startPosition: clonePosition(snapshot.startPosition),
    endPosition: clonePosition(snapshot.endPosition),
    obstacles: snapshot.obstacles.map((obstacle) => ({
      position: { ...obstacle.position },
      direction: obstacle.direction,
    })),
    items: cloneMapItems(snapshot.items),
    setupPhase: snapshot.setupPhase,
  };
}

type PlaceableItemType = Exclude<ItemType, 'radar' | 'collapseWall' | 'mirrorWall'>;
type PlaceMode = 'wall' | PlaceableItemType;

const ITEM_ICONS: Record<PlaceableItemType, LucideIcon> = {
  oneTimeWall: BrickWall,
  mine: Bomb,
  wormhole: Aperture,
  smoke: CloudFog,
  steelWall: Shield,
  fireWall: Flame,
  poisonWall: FlaskConical,
  iceWall: Snowflake,
  windWall: Wind,
  phaseWall: Waves,
  thornWall: ShieldAlert,
  crystalWall: Gem,
};

const TRAP_ITEMS: PlaceableItemType[] = ['oneTimeWall', 'mine', 'wormhole', 'smoke'];
const SPECIAL_WALL_ITEMS: PlaceableItemType[] = [
  'steelWall',
  'fireWall',
  'poisonWall',
  'iceWall',
  'windWall',
  'phaseWall',
  'thornWall',
  'crystalWall',
];

const ITEM_DESCRIPTIONS: Record<PlaceableItemType, string> = {
  oneTimeWall: '처음 한 번만 막고 사라지는 위장벽',
  mine: '밟으면 실제 2턴 전 위치로 되돌림',
  wormhole: '안전한 출구로 한 번 순간이동',
  smoke: '상대의 다음 행동 동안 보드를 가림',
  steelWall: '어떤 벽 효과로도 통과할 수 없는 영구벽',
  fireWall: '처음 막고 사라지며 행동에 총 2턴 소모',
  poisonWall: '통과시킨 뒤 행동에 총 3턴 소모',
  iceWall: '통과 후 진행 방향으로 한 칸 더 미끄러짐',
  windWall: '첫 통과 후 가능하면 지정 방향으로 한 칸 밀고 소멸',
  phaseWall: '막힘과 통과 상태가 시도할 때마다 교대',
  thornWall: '처음 막고 실제 2턴 전 위치로 되돌림',
  crystalWall: '처음 막고 주변의 진짜 벽을 노출',
};

const DIRECTIONS: Array<{ direction: Direction; label: string; Icon: LucideIcon }> = [
  { direction: 'up', label: '위', Icon: ArrowUp },
  { direction: 'right', label: '오른쪽', Icon: ArrowRight },
  { direction: 'down', label: '아래', Icon: ArrowDown },
  { direction: 'left', label: '왼쪽', Icon: ArrowLeft },
];

const findWormholeSafetyError = (map: GameMap): string | null => {
  for (const item of map.items || []) {
    if (item.type !== 'wormhole' || !item.exit) continue;
    const error = getWormholeExitSafetyError(map, item.exit);
    if (error) return error;
  }
  return null;
};

const GameSetup: React.FC<GameSetupProps> = ({
  onMapComplete,
  onDraftChange,
  initialMap = null,
  requireFullBudget = false,
}) => {
  const [startPosition, setStartPosition] = useState<Position | undefined>(() =>
    initialMap?.startPosition ? { ...initialMap.startPosition } : undefined
  );
  const [endPosition, setEndPosition] = useState<Position | undefined>(() =>
    initialMap?.endPosition ? { ...initialMap.endPosition } : undefined
  );
  const [obstacles, setObstacles] = useState<Obstacle[]>(() =>
    (initialMap?.obstacles || []).map((entry) => ({
      position: { ...entry.position },
      direction: entry.direction,
    }))
  );
  const [setupPhase, setSetupPhase] = useState<'start' | 'end' | 'obstacles'>(
    initialMap ? 'obstacles' : 'start'
  );
  const [isMapValid, setIsMapValid] = useState<boolean>(false);
  // 아이템 배치 (공용 벽 예산과 종류별 최대 수량 적용)
  const [placeMode, setPlaceMode] = useState<PlaceMode>('wall');
  const [items, setItems] = useState<MapItem[]>(() =>
    (initialMap?.items || [])
      .filter((item) =>
        item.type !== 'collapseWall' && item.type !== 'mirrorWall' && item.type !== 'radar'
      )
      .map((item) => ({
      ...item,
      position: item.position ? { ...item.position } : undefined,
      wallPosition: item.wallPosition ? { ...item.wallPosition } : undefined,
      entrance: item.entrance ? { ...item.entrance } : undefined,
      exit: item.exit ? { ...item.exit } : undefined,
    }))
  );
  const [wormholeEntrance, setWormholeEntrance] = useState<Position | null>(null);
  const [paletteTab, setPaletteTab] = useState<'traps' | 'walls'>('traps');
  const [windDirection, setWindDirection] = useState<Direction>('right');
  const historyRef = useRef<{
    past: MapEditorSnapshot[];
    current: MapEditorSnapshot;
    future: MapEditorSnapshot[];
  }>({
    past: [],
    current: cloneEditorSnapshot({
      startPosition,
      endPosition,
      obstacles,
      items,
      setupPhase,
    }),
    future: [],
  });
  const restoringHistoryRef = useRef(false);
  const [, forceHistoryRender] = useState(0);

  useEffect(() => {
    const next = cloneEditorSnapshot({
      startPosition,
      endPosition,
      obstacles,
      items,
      setupPhase,
    });
    const history = historyRef.current;

    if (restoringHistoryRef.current) {
      restoringHistoryRef.current = false;
      history.current = next;
      return;
    }
    if (JSON.stringify(history.current) === JSON.stringify(next)) return;

    history.past = [...history.past, cloneEditorSnapshot(history.current)].slice(-MAX_EDITOR_HISTORY);
    history.current = next;
    history.future = [];
    forceHistoryRender((version) => version + 1);
  }, [endPosition, items, obstacles, setupPhase, startPosition]);

  const restoreEditorSnapshot = useCallback((snapshot: MapEditorSnapshot) => {
    restoringHistoryRef.current = true;
    setStartPosition(clonePosition(snapshot.startPosition));
    setEndPosition(clonePosition(snapshot.endPosition));
    setObstacles(snapshot.obstacles.map((obstacle) => ({
      position: { ...obstacle.position },
      direction: obstacle.direction,
    })));
    setItems(cloneMapItems(snapshot.items));
    setSetupPhase(snapshot.setupPhase);
    setPlaceMode('wall');
    setWormholeEntrance(null);
  }, []);

  const handleUndo = useCallback(() => {
    const history = historyRef.current;
    const previous = history.past.at(-1);
    if (!previous) return;
    history.past = history.past.slice(0, -1);
    history.future = [cloneEditorSnapshot(history.current), ...history.future].slice(0, MAX_EDITOR_HISTORY);
    history.current = cloneEditorSnapshot(previous);
    restoreEditorSnapshot(previous);
    forceHistoryRender((version) => version + 1);
  }, [restoreEditorSnapshot]);

  const handleRedo = useCallback(() => {
    const history = historyRef.current;
    const next = history.future[0];
    if (!next) return;
    history.future = history.future.slice(1);
    history.past = [...history.past, cloneEditorSnapshot(history.current)].slice(-MAX_EDITOR_HISTORY);
    history.current = cloneEditorSnapshot(next);
    restoreEditorSnapshot(next);
    forceHistoryRender((version) => version + 1);
  }, [restoreEditorSnapshot]);

  useEffect(() => {
    const handleHistoryShortcut = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== 'z') return;
      event.preventDefault();
      if (event.shiftKey) handleRedo();
      else handleUndo();
    };
    window.addEventListener('keydown', handleHistoryShortcut);
    return () => window.removeEventListener('keydown', handleHistoryShortcut);
  }, [handleRedo, handleUndo]);

  const itemsCost = items.reduce((sum, it) => sum + ITEM_COSTS[it.type], 0);

  // 아이템이 이미 점유한 칸 (지뢰 위치, 웜홀 입출구)
  const isCellOccupiedByItem = (position: Position): boolean =>
    items.some(
      (it) =>
        ((it.type === 'mine' || it.type === 'smoke') && it.position && isSamePosition(position, it.position)) ||
        (it.type === 'wormhole' &&
          ((it.entrance && isSamePosition(position, it.entrance)) ||
            (it.exit && isSamePosition(position, it.exit))))
    );

  // 예산 안에서 이 아이템을 추가할 수 있는지
  const canAffordItem = (type: ItemType): boolean =>
    countUniqueObstacles(obstacles) + itemsCost + ITEM_COSTS[type] <= MAX_OBSTACLES;

  const hasItemCapacity = (type: ItemType): boolean =>
    items.filter((item) => item.type === type).length < ITEM_LIMITS[type];

  const addItem = (newItem: MapItem) => {
    setItems((prev) => [...prev, newItem]);
  };

  const wallItemOverlaps = (position: Position, direction: Direction): boolean =>
    items.some(
      (item) =>
        isWallItemType(item.type) &&
        !!item.wallPosition &&
        !!item.wallDirection &&
        isSameWallSegment(position, direction, item.wallPosition, item.wallDirection)
    );
  
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

  const wormholeExitCandidates: Position[] = [];
  if (wormholeEntrance && startPosition && endPosition) {
    for (let row = 0; row < BOARD_SIZE; row += 1) {
      for (let col = 0; col < BOARD_SIZE; col += 1) {
        const position = { row, col };
        if (!canPlaceItemOnCell(position) || isCellOccupiedByItem(position)) continue;
        if (isSamePosition(position, wormholeEntrance)) continue;
        const wormhole: MapItem = { type: 'wormhole', entrance: wormholeEntrance, exit: position };
        const candidateMap: GameMap = {
          startPosition,
          endPosition,
          obstacles,
          items: [...items, wormhole],
        };
        if (!getWormholeExitSafetyError(candidateMap, position)) {
          wormholeExitCandidates.push(position);
        }
      }
    }
  }

  // 셀 클릭 핸들러
  const handleCellClick = (position: Position) => {
    if (setupPhase === 'start') {
      if (isCellOccupiedByItem(position)) return;
      if (endPosition && isSamePosition(position, endPosition)) return;
      setStartPosition(position);
      setSetupPhase('end');
    } else if (setupPhase === 'end') {
      // 시작점과 같은 위치에 도착점을 설정하지 못하도록 함
      if (startPosition && isSamePosition(position, startPosition)) return;
      if (isCellOccupiedByItem(position)) return;
      setEndPosition(position);
      setSetupPhase('obstacles');
    } else if (setupPhase === 'obstacles') {
      // 아이템 배치 모드에서의 셀 클릭
      if (placeMode === 'mine' || placeMode === 'smoke') {
        if (!canPlaceItemOnCell(position) || isCellOccupiedByItem(position)) return;
        if (!canAffordItem(placeMode)) return;
        addItem({ type: placeMode, position });
        setPlaceMode('wall');
      } else if (placeMode === 'wormhole') {
        if (!canPlaceItemOnCell(position) || isCellOccupiedByItem(position)) return;

        if (!wormholeEntrance) {
          // 첫 클릭: 입구 지정
          setWormholeEntrance(position);
        } else {
          // 두 번째 클릭: 출구 지정 (입구와 달라야 함)
          if (isSamePosition(position, wormholeEntrance)) return;
          if (!canAffordItem('wormhole')) return;
          if (!startPosition || !endPosition) return;

          const wormhole: MapItem = { type: 'wormhole', entrance: wormholeEntrance, exit: position };
          const candidateMap: GameMap = {
            startPosition,
            endPosition,
            obstacles,
            items: [...items, wormhole],
          };
          const safetyError = getWormholeExitSafetyError(candidateMap, position);
          if (safetyError) {
            alert(safetyError);
            return;
          }

          addItem(wormhole);
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

    // 셀 아이템 모드의 틈 클릭이 일반벽 배치로 이어지지 않게 막는다.
    if (placeMode !== 'wall' && !isWallItemType(placeMode)) {
      return;
    }

    // 가짜벽과 특수벽은 모두 칸 사이 선에 배치한다.
    if (placeMode !== 'wall' && isWallItemType(placeMode)) {
      const { adjacentPosition } = getAdjacentCellInfo(position, direction);
      if (!adjacentPosition) return;

      const overlapsWall =
        obstacles.some((o) => isSameWallSegment(position, direction, o.position, o.direction)) ||
        wallItemOverlaps(position, direction);
      if (overlapsWall) return;
      if (!canAffordItem(placeMode)) return;

      const item: MapItem = {
        type: placeMode,
        wallPosition: position,
        wallDirection: direction,
        ...(placeMode === 'windWall' ? { effectDirection: windDirection } : {}),
      };
      if (startPosition && endPosition) {
        const safetyError = findWormholeSafetyError({
          startPosition,
          endPosition,
          obstacles,
          items: [...items, item],
        });
        if (safetyError) {
          alert(safetyError);
          return;
        }
      }

      addItem(item);
      setPlaceMode('wall');
      return;
    }

    // 일반 벽도 모든 특수벽과 같은 선을 공유할 수 없다.
    if (wallItemOverlaps(position, direction)) {
      return;
    }

    // 이미 존재하는 장애물인지 확인
    const obstacleExists = obstacles.some((obstacle) =>
      isSameWallSegment(position, direction, obstacle.position, obstacle.direction)
    );
    
    // 인접 셀과 방향 계산
    const { adjacentPosition, oppositeDirection } = getAdjacentCellInfo(position, direction);
    
    if (obstacleExists) {
      // 어느 셀 방향으로 저장됐든 같은 물리 벽을 한 번에 제거한다.
      setObstacles((current) => current.filter((obstacle) =>
        !isSameWallSegment(position, direction, obstacle.position, obstacle.direction)
      ));
    } else {
      // 새 장애물 배열 생성
      const newObstacles = [...obstacles];
      
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
      
      // 고유한 벽의 수 계산 (배치된 아이템 총비용 포함)
      const uniqueObstacleCount = countUniqueObstacles(tempObstacles);

      // 벽 예산 확인 (아이템 비용 포함 최대 개수를 초과하지 않는지)
      if (uniqueObstacleCount + itemsCost <= MAX_OBSTACLES) {
        if (startPosition && endPosition) {
          const safetyError = findWormholeSafetyError({
            startPosition,
            endPosition,
            obstacles: tempObstacles,
            items,
          });
          if (safetyError) {
            alert(safetyError);
            return;
          }
        }
        setObstacles(tempObstacles);
      } else {
        alert(`벽 예산(${MAX_OBSTACLES}개)을 초과했습니다. 아이템 비용 ${itemsCost}개가 포함되어 있습니다.`);
      }
    }
  };

  // 아이템 선택/제거 (예산 안에서 무제한)
  const handleSelectItemMode = (type: PlaceableItemType) => {
    if (!hasItemCapacity(type)) {
      alert(`${ITEM_LABELS[type]}은(는) 한 맵에 최대 ${ITEM_LIMITS[type]}개까지 배치할 수 있습니다.`);
      return;
    }
    if (!canAffordItem(type)) {
      alert(`벽 예산이 부족합니다. ${ITEM_LABELS[type]}은(는) 벽 ${ITEM_COSTS[type]}개를 소모합니다.`);
      return;
    }
    setWormholeEntrance(null);

    setPlaceMode((prev) => (prev === type ? 'wall' : type));
  };

  const handleRemoveItem = (index: number) => {
    setItems((prev) => prev.filter((_, i) => i !== index));
  };

  const handlePaletteTabChange = (tab: 'traps' | 'walls') => {
    if (tab === paletteTab) return;
    setPaletteTab(tab);
    setPlaceMode('wall');
    setWormholeEntrance(null);
  };
  
  // 맵 완성 및 제출
  const handleSubmit = () => {
    if (!startPosition || !endPosition) {
      alert('시작점과 도착점을 모두 설정해야 합니다.');
      return;
    }
    
    const map: GameMap = {
      rulesVersion: GAME_RULES_VERSION,
      startPosition,
      endPosition,
      obstacles,
      items,
      // Authority V3 still requires the legacy field; official controls no longer expose skills.
      skillLoadout: DEFAULT_MAZE_SKILL,
    };

    if (requireFullBudget && usedBudget !== MAX_OBSTACLES) {
      alert(
        `연습 맵은 벽과 아이템 비용을 합쳐 ${MAX_OBSTACLES}/${MAX_OBSTACLES}를 모두 사용해야 합니다. ` +
        `현재 ${usedBudget}/${MAX_OBSTACLES}, ${MAX_OBSTACLES - usedBudget} 남음`
      );
      return;
    }

    const safetyError = findWormholeSafetyError(map);
    if (safetyError) {
      alert(safetyError);
      return;
    }

    // 맵 유효성 검사 (1회성 벽은 부술 수 있으므로 경로 판정에서 제외)
    if (!isValidNewMap(map)) {
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
        items,
        skillLoadout: DEFAULT_MAZE_SKILL,
      };

      setIsMapValid(isValidNewMap(map));

      if (isValidNewMap(map)) {
        onDraftChange?.({
          ...map,
          rulesVersion: GAME_RULES_VERSION,
          obstacles: map.obstacles.map((obstacle) => ({
            position: { ...obstacle.position },
            direction: obstacle.direction,
          })),
          items: cloneMapItems(map.items || []),
        });
      }
    }
  }, [startPosition, endPosition, obstacles, items, onDraftChange]);

  // 사용한 벽 예산 (아이템 총비용 포함)
  const usedBudget = countUniqueObstacles(obstacles) + itemsCost;
  const remainingObstacles = MAX_OBSTACLES - usedBudget;
  const canSubmit = isMapValid && (!requireFullBudget || usedBudget === MAX_OBSTACLES);
  const wormholeSafetyError = startPosition && endPosition
    ? findWormholeSafetyError({ startPosition, endPosition, obstacles, items })
    : null;
  
  const steps: Array<{ key: 'start' | 'end' | 'obstacles'; label: string }> = [
    { key: 'start', label: '시작점' },
    { key: 'end', label: '도착점' },
    { key: 'obstacles', label: '벽 배치' },
  ];
  const currentStepIndex = steps.findIndex((s) => s.key === setupPhase);
  const paletteItems = paletteTab === 'traps' ? TRAP_ITEMS : SPECIAL_WALL_ITEMS;
  const activeItem = placeMode === 'wall' ? null : placeMode;
  const ActiveItemIcon = activeItem ? ITEM_ICONS[activeItem] : BrickWall;
  const activeWallGuide = activeItem && isWallItemType(activeItem) ? activeItem : null;
  const canUndo = historyRef.current.past.length > 0;
  const canRedo = historyRef.current.future.length > 0;

  return (
    <div
      className="absolute inset-0 flex min-h-0 flex-col overflow-hidden bg-gradient-to-b from-slate-800 via-slate-900 to-slate-950"
      data-testid="game-setup-layout"
    >
      {/* 보드 스테이지 - 맵 제작은 정밀한 배치를 위해 2D 고정 */}
      <div className="relative order-2 min-h-0 flex-1" data-testid="setup-board-region">
        {activeWallGuide && (
          <div
            className="pointer-events-none absolute left-2 top-2 z-20 flex h-11 max-w-[calc(100%-7rem)] items-center gap-1.5 rounded-xl border border-cyan-300/70 bg-slate-950/90 px-2.5 text-cyan-50 shadow-lg shadow-black/40 backdrop-blur-sm"
            data-testid="wall-placement-guide"
            data-selected-wall={activeWallGuide}
            role="status"
            aria-live="polite"
          >
            <ActiveItemIcon className="shrink-0 text-cyan-300" size={16} aria-hidden="true" />
            <span className="min-w-0 truncate text-[10px] font-black">
              {ITEM_LABELS[activeWallGuide]} · 점선 예시를 따라 빈 벽선을 누르세요
            </span>
          </div>
        )}
        <div className="absolute right-3 top-2 z-20 flex gap-2" aria-label="맵 편집 기록">
          <button
            type="button"
            className="flex h-11 w-11 items-center justify-center rounded-xl border-2 border-slate-500 bg-slate-950 text-white shadow-[0_3px_0_rgb(15_23_42)] disabled:cursor-not-allowed disabled:opacity-35"
            onClick={handleUndo}
            disabled={!canUndo}
            aria-label="실행 취소"
            title="실행 취소 (Ctrl/⌘+Z)"
          >
            <Undo2 size={19} aria-hidden="true" />
          </button>
          <button
            type="button"
            className="flex h-11 w-11 items-center justify-center rounded-xl border-2 border-slate-500 bg-slate-950 text-white shadow-[0_3px_0_rgb(15_23_42)] disabled:cursor-not-allowed disabled:opacity-35"
            onClick={handleRedo}
            disabled={!canRedo}
            aria-label="다시 실행"
            title="다시 실행 (Ctrl/⌘+Shift+Z)"
          >
            <Redo2 size={19} aria-hidden="true" />
          </button>
        </div>

        <div className="absolute inset-0 overflow-auto px-2 pb-2 pt-14 sm:pt-2" data-testid="setup-board-scroll">
          <div className="flex min-h-full min-w-fit items-center justify-center">
            <GameBoard
              gamePhase={GamePhase.SETUP}
              startPosition={startPosition}
              endPosition={endPosition}
              obstacles={obstacles}
              items={items}
              pendingCell={wormholeEntrance}
              validTargetCells={wormholeExitCandidates}
              placeMode={placeMode}
              compact
              onCellClick={handleCellClick}
              onDirectionClick={handleDirectionClick}
              selectionMode={setupPhase === 'start' ? 'start' : setupPhase === 'end' ? 'end' : 'none'}
            />
          </div>
        </div>
      </div>

      {/* 상단 HUD: 맵 제작 단계 스테퍼 */}
      <div className="relative order-1 z-20 mx-auto w-[96%] max-w-3xl shrink-0 pt-2" data-testid="setup-stepper">
        <div className="game-panel !rounded-xl !border-[#8b684c] px-3 py-2">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div className="flex items-center gap-1.5">
              {steps.map((s, i) => (
                <div key={s.key} className="flex items-center gap-1.5">
                  <div
                    className={`flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold border ${
                      i === currentStepIndex
                        ? 'border-[#8a5a16] bg-[#f4c64f] text-[#3d352d]'
                        : i < currentStepIndex
                          ? 'border-[#42936f] bg-[#dff5e9] text-[#176044]'
                          : 'border-[#b7a28a] bg-[#ece5db] text-[#66594d]'
                    }`}
                  >
                    <span>{i < currentStepIndex ? '✓' : i + 1}</span>
                    <span>{s.label}</span>
                  </div>
                  {i < steps.length - 1 && <span className="text-[10px] text-[#7c6959]">›</span>}
                </div>
              ))}
            </div>
            <div className="flex items-center gap-2">
              {setupPhase === 'obstacles' && (
                <span
                  className={`inline-flex items-center gap-1 text-xs font-bold ${remainingObstacles === 0 ? 'text-emerald-700' : remainingObstacles <= 5 ? 'text-red-700' : 'text-amber-700'}`}
                  data-testid="setup-budget"
                  data-budget-complete={usedBudget === MAX_OBSTACLES ? 'true' : 'false'}
                >
                  <BrickWall size={14} aria-hidden="true" /> {usedBudget}/{MAX_OBSTACLES}
                  {items.length > 0 && <span className="ml-1 text-purple-700">(아이템 -{itemsCost})</span>}
                  {requireFullBudget && remainingObstacles > 0 && <span>· {remainingObstacles} 남음</span>}
                </span>
              )}
            </div>
          </div>
          <div className="mt-1.5 text-xs font-semibold text-[#55483d]">
            {setupPhase === 'start' && '시작점을 선택하세요 - 상대방은 여기서 출발합니다'}
            {setupPhase === 'end' && '도착점을 선택하세요 - 상대방이 도달해야 하는 곳입니다'}
            {setupPhase === 'obstacles' && '벽(장애물)을 배치하세요 - 상대방에게는 보이지 않습니다'}
          </div>
        </div>
      </div>

      {/* 하단 HUD: 아이템 팔레트 + 진행 버튼 */}
      <div
        className="relative order-3 z-20 mx-auto flex max-h-[46%] w-[96%] max-w-3xl shrink-0 flex-col items-center gap-2 overflow-y-auto overscroll-contain pt-2"
        data-testid="setup-controls"
        style={{ paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))' }}
      >
        {setupPhase === 'obstacles' && !isMapValid && (obstacles.length > 0 || items.length > 0) && (
          <p className="text-red-300 text-xs px-3 py-1 rounded-full bg-red-500/20 border border-red-500/50 backdrop-blur-sm">
            {wormholeSafetyError || '현재 맵 구성으로는 시작점에서 도착점까지 도달할 수 없습니다.'}
          </p>
        )}
        {setupPhase === 'obstacles' && requireFullBudget && isMapValid && remainingObstacles > 0 && (
          <p className="rounded-full border border-amber-400/50 bg-slate-950/90 px-3 py-1 text-xs font-bold text-amber-200" data-testid="full-budget-required">
            연습 맵은 {MAX_OBSTACLES}/{MAX_OBSTACLES}를 모두 사용해야 합니다 · {remainingObstacles} 남음
          </p>
        )}

        {/* 공용 벽 예산 안에서 함정과 특수벽을 고른다. */}
        {setupPhase === 'obstacles' && (
          <div className="game-panel w-full !rounded-lg !border-[#8b684c] px-2.5 py-2" data-testid="setup-palette">
            <div className="flex items-center justify-between gap-2">
              <div className="flex rounded-md border border-slate-600 bg-slate-900/70 p-0.5" role="tablist" aria-label="아이템 종류">
                <button
                  role="tab"
                  aria-selected={paletteTab === 'traps'}
                  className={`h-11 px-3 text-[11px] font-bold ${paletteTab === 'traps' ? 'rounded bg-slate-600 text-white' : 'text-slate-400'}`}
                  onClick={() => handlePaletteTabChange('traps')}
                >
                  함정
                </button>
                <button
                  role="tab"
                  aria-selected={paletteTab === 'walls'}
                  className={`h-11 px-3 text-[11px] font-bold ${paletteTab === 'walls' ? 'rounded bg-slate-600 text-white' : 'text-slate-400'}`}
                  onClick={() => handlePaletteTabChange('walls')}
                >
                  특수벽
                </button>
              </div>
              <span className="shrink-0 text-[10px] font-bold text-[#5d5146]">
                각 종류 1개
              </span>
            </div>

            <div className="mt-1.5 flex h-12 gap-1.5 overflow-x-auto overscroll-x-contain pb-1" role="tabpanel">
              {paletteItems.map((type) => {
                const Icon = ITEM_ICONS[type];
                const count = items.filter((item) => item.type === type).length;
                return (
                  <button
                    key={type}
                    className={`flex h-11 shrink-0 items-center gap-1 rounded-md border px-2 text-[11px] font-bold transition-colors ${
                      placeMode === type
                        ? 'border-amber-400 bg-amber-400 text-slate-950'
                        : 'border-slate-600 bg-slate-800 text-slate-200 hover:border-amber-400/60'
                    } disabled:pointer-events-none disabled:opacity-35`}
                    onClick={() => handleSelectItemMode(type)}
                    disabled={!canAffordItem(type) || !hasItemCapacity(type)}
                    title={`${ITEM_LABELS[type]}: ${ITEM_DESCRIPTIONS[type]}`}
                  >
                    <Icon size={14} aria-hidden="true" />
                    <span>{ITEM_LABELS[type]}</span>
                    <span className={placeMode === type ? 'text-slate-700' : 'text-amber-300'}>-{ITEM_COSTS[type]}</span>
                    {count > 0 && <span className="text-[9px]">{count}</span>}
                  </button>
                );
              })}
            </div>

            <div className="flex min-h-8 flex-col items-stretch gap-1.5 border-t border-[#b89a77] pt-1.5 sm:flex-row sm:items-center sm:justify-between sm:gap-2">
              <div id="active-palette-description" className="flex min-w-0 items-start gap-1.5 text-[10px] font-semibold text-[#3d352d] sm:items-center" data-testid="active-palette-description">
                <ActiveItemIcon className="shrink-0 text-amber-700" size={14} aria-hidden="true" />
                <span className="whitespace-normal break-words leading-[1.35]">
                  {activeItem ? `${ITEM_LABELS[activeItem]}: ${ITEM_DESCRIPTIONS[activeItem]}` : '일반벽 배치'}
                </span>
              </div>
              {placeMode === 'windWall' && (
                <div className="grid w-full shrink-0 grid-cols-4 rounded-md border border-slate-600 bg-slate-900 p-0.5 sm:flex sm:w-auto" role="group" aria-label="바람 방향">
                  {DIRECTIONS.map(({ direction, label, Icon }) => (
                    <button
                      key={direction}
                      className={`flex h-11 min-w-11 items-center justify-center rounded sm:w-11 ${windDirection === direction ? 'bg-cyan-500 text-slate-950' : 'text-slate-300'}`}
                      onClick={() => setWindDirection(direction)}
                      title={`바람 ${label}`}
                      aria-label={`바람 ${label}`}
                      aria-pressed={windDirection === direction}
                      aria-describedby="active-palette-description"
                    >
                      <Icon size={16} aria-hidden="true" />
                    </button>
                  ))}
                </div>
              )}
              {placeMode === 'wormhole' && wormholeEntrance && (
                <span className="shrink-0 text-[10px] font-bold text-emerald-300">
                  안전 출구 {wormholeExitCandidates.length}칸
                </span>
              )}
            </div>

            {items.length > 0 && (
              <div className="mt-1 flex h-12 gap-1 overflow-x-auto" aria-label="배치된 아이템">
                {items.map((item, index) => {
                  const Icon = ITEM_ICONS[item.type];
                  return (
                    <span
                      key={`${item.type}-${index}`}
                      className="inline-flex h-11 shrink-0 items-center gap-1 rounded border border-slate-600 bg-slate-800 pl-2 text-[10px] font-bold text-slate-200"
                    >
                      <Icon size={12} aria-hidden="true" />
                      {ITEM_LABELS[item.type]}
                      <button
                        className="flex size-11 items-center justify-center text-red-300 hover:text-red-200"
                        onClick={() => handleRemoveItem(index)}
                        title={`${ITEM_LABELS[item.type]} 제거`}
                        aria-label={`${ITEM_LABELS[item.type]} 제거`}
                      >
                        <X size={15} />
                      </button>
                    </span>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* 진행 버튼 */}
        <div className="flex gap-2 justify-center">
          {setupPhase === 'start' && (
            <button
              className="btn-game h-11 px-8 text-sm"
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
            <>
              <button className="btn-sub h-11 px-5 text-sm" onClick={() => setSetupPhase('start')}>
                이전
              </button>
              <button
                className="btn-game h-11 px-8 text-sm"
                onClick={() => {
                  if (endPosition) {
                    setSetupPhase('obstacles');
                  }
                }}
                disabled={!endPosition}
              >
                다음
              </button>
            </>
          )}

          {setupPhase === 'obstacles' && (
            <>
              <button className="btn-sub h-11 px-5 text-sm" onClick={() => setSetupPhase('end')}>
                이전
              </button>
              <button
                className="btn-game h-11 px-10 text-sm"
                onClick={handleSubmit}
                disabled={!canSubmit}
              >
                완료
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default GameSetup;
