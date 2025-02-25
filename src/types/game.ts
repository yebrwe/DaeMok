// 게임 보드 및 게임 상태 관련 타입 정의

export type CellType = 'empty' | 'start' | 'end' | 'player';
export type Direction = 'up' | 'down' | 'left' | 'right';

// 셀 좌표 타입
export interface Position {
  row: number;
  col: number;
}

// 장애물(노란선) 타입
export interface Obstacle {
  position: Position;
  direction: Direction; // 장애물이 위치한 방향
}

// 게임 상태 타입
export enum GamePhase {
  SETUP = 'setup',   // 맵 제작 단계
  PLAY = 'play',     // 게임 플레이 단계
  END = 'end'        // 게임 종료
}

// 플레이어 타입
export interface Player {
  id: string;
  position: Position;
  isReady: boolean;
}

// 게임 맵 타입
export interface GameMap {
  startPosition: Position;
  endPosition: Position;
  obstacles: Obstacle[];
}

// 게임 상태 타입
export interface GameState {
  phase: GamePhase;
  players: Record<string, Player>;
  currentTurn: string | null;
  maps: Record<string, GameMap>;
  winner: string | null;
}

// 게임 방 타입
export interface Room {
  id: string;
  name: string;
  players: string[];
  gameState: GameState | null;
  maxPlayers: number;
}

// 실시간 이벤트 타입
export enum SocketEvents {
  JOIN_ROOM = 'join_room',
  LEAVE_ROOM = 'leave_room',
  CREATE_ROOM = 'create_room',
  PLAYER_READY = 'player_ready',
  GAME_START = 'game_start',
  PLACE_OBSTACLE = 'place_obstacle',
  MOVE_PLAYER = 'move_player',
  GAME_END = 'game_end',
  ROOM_UPDATED = 'room_updated',
  ERROR = 'error'
} 