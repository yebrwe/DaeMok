import { Direction, GameMap, Obstacle, Position } from '@/types/game';

// 보드 크기 상수
export const BOARD_SIZE = 8;

// 위치가 보드 내에 있는지 확인
export function isPositionInBoard(position: Position): boolean {
  const { row, col } = position;
  return row >= 0 && row < BOARD_SIZE && col >= 0 && col < BOARD_SIZE;
}

// 두 위치가 동일한지 확인
export function isSamePosition(pos1: Position, pos2: Position): boolean {
  return pos1.row === pos2.row && pos1.col === pos2.col;
}

// 특정 방향으로 이동했을 때의 새 위치 계산
export function getNewPosition(position: Position, direction: Direction): Position {
  const { row, col } = position;
  
  switch (direction) {
    case 'up':
      return { row: row - 1, col };
    case 'down':
      return { row: row + 1, col };
    case 'left':
      return { row, col: col - 1 };
    case 'right':
      return { row, col: col + 1 };
    default:
      return position;
  }
}

// 장애물 검사: 현재 위치에서 특정 방향으로 이동할 수 있는지 확인
export function canMove(currentPosition: Position, direction: Direction, obstacles: Obstacle[]): boolean {
  // 이동할 위치가 보드 내에 있는지 확인
  const newPosition = getNewPosition(currentPosition, direction);
  if (!isPositionInBoard(newPosition)) {
    return false;
  }
  
  // 해당 방향에 장애물이 있는지 확인
  return !obstacles.some(obstacle => {
    const { position, direction: obstacleDirection } = obstacle;
    
    // 현재 위치에서 해당 방향으로 이동할 때 장애물 확인
    if (isSamePosition(position, currentPosition)) {
      return direction === obstacleDirection;
    }
    
    // 이동하려는 위치에서 역방향으로 장애물 확인
    if (isSamePosition(position, newPosition)) {
      return getOppositeDirection(direction) === obstacleDirection;
    }
    
    return false;
  });
}

// 방향의 반대 방향 반환
export function getOppositeDirection(direction: Direction): Direction {
  switch (direction) {
    case 'up': return 'down';
    case 'down': return 'up';
    case 'left': return 'right';
    case 'right': return 'left';
  }
}

// 최단 경로 탐색 (BFS 알고리즘 사용)
export function findShortestPath(
  start: Position,
  end: Position,
  obstacles: Obstacle[]
): Position[] | null {
  // 방문 여부를 저장하는 배열
  const visited: boolean[][] = Array(BOARD_SIZE)
    .fill(null)
    .map(() => Array(BOARD_SIZE).fill(false));
  
  // 각 위치까지의 경로를 저장
  const paths: Record<string, Position[]> = {};
  const key = (pos: Position) => `${pos.row},${pos.col}`;
  
  // 시작 위치 초기화
  const queue: Position[] = [start];
  visited[start.row][start.col] = true;
  paths[key(start)] = [start];
  
  // BFS 탐색
  while (queue.length > 0) {
    const current = queue.shift()!;
    
    // 목적지에 도달한 경우
    if (isSamePosition(current, end)) {
      return paths[key(current)];
    }
    
    // 상하좌우 방향 탐색
    const directions: Direction[] = ['up', 'down', 'left', 'right'];
    
    for (const direction of directions) {
      if (canMove(current, direction, obstacles)) {
        const next = getNewPosition(current, direction);
        
        if (!visited[next.row][next.col]) {
          visited[next.row][next.col] = true;
          queue.push(next);
          paths[key(next)] = [...paths[key(current)], next];
        }
      }
    }
  }
  
  // 경로를 찾지 못한 경우
  return null;
}

// 게임맵이 유효한지 확인 (시작점에서 끝점까지 경로가 존재하는지)
export function isValidMap(map: GameMap): boolean {
  return !!findShortestPath(
    map.startPosition,
    map.endPosition,
    map.obstacles
  );
} 