// 게임 보드 및 게임 상태 관련 타입 정의

export type CellType = 'empty' | 'start' | 'end' | 'player';
export type Direction = 'up' | 'down' | 'left' | 'right';

// 사용자 프로필 타입
export interface UserProfile {
  uid: string;
  displayName: string | null;
  email?: string | null;
  photoURL: string | null;
  isOnline?: boolean;
  lastSeen?: any; // 서버 타임스탬프를 저장하기 위한 필드
}

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
  displayName?: string | null;
  hasLeft?: boolean;
  lastPosition?: Position;
  isOnline?: boolean;
  lastSeen?: any; // serverTimestamp 타입
}

// 게임 맵 타입
export interface GameMap {
  startPosition: Position;
  endPosition: Position;
  obstacles: Obstacle[];
}

// 충돌된 벽 타입
export interface CollisionWall {
  playerId: string;
  position: Position;
  direction: Direction;
  timestamp: number;
  mapOwnerId: string;  // 맵 소유자 ID - 어떤 플레이어의 맵인지 구분
}

// 게임 상태 타입
export interface GameState {
  phase: GamePhase;
  players: Record<string, Player>;
  maps?: Record<string, GameMap>;
  currentTurn?: string;
  winner?: string;
  collisionWalls?: CollisionWall[];  // 충돌 벽 정보를 저장할 배열 추가
}

// 게임 방 타입
export interface Room {
  id: string;
  name: string;
  players: string[];
  gameState: GameState | null;
  maxPlayers: number;
  createdAt?: number | null;
  createdBy?: string;
  status?: 'waiting' | 'playing' | 'ended';
  lastActivity?: number | null;
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