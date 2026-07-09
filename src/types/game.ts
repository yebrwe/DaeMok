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
  photoURL?: string | null; // 프로필 이미지 URL 추가
  finished?: boolean; // 도착점 골인 여부 (골인 후에는 관전)
  finishMoves?: number; // 완주에 소모한 턴 수 (승패 판정 기준)
  forfeited?: boolean; // 포기 여부
  moves?: number; // 현재까지 소모한 턴 수 (관전자 표시용, 이동/충돌 시 동기화)
}

// 맵 아이템 타입 (게임당 1개, 벽 예산 소모)
export type ItemType = 'oneTimeWall' | 'mine' | 'wormhole' | 'radar';

export interface MapItem {
  type: ItemType;
  // oneTimeWall: 일반 벽과 똑같이 한 번 막은 뒤, 다음 시도부터 통과되는 위장 벽 (벽 5개 소모)
  wallPosition?: Position;
  wallDirection?: Direction;
  // mine: 밟으면 2턴 전 위치로 되돌아감 (벽 3개 소모)
  position?: Position;
  // wormhole: 입구를 밟으면 출구로 순간이동, 1회성 (벽 5개 소모)
  entrance?: Position;
  exit?: Position;
  // radar: 배치 불필요 - 게임 중 1회 사용해 내 주변 3x3의 벽을 탐지 (벽 3개 소모)
}

// 게임 맵 타입
export interface GameMap {
  startPosition: Position;
  endPosition: Position;
  obstacles: Obstacle[];
  items?: MapItem[] | null; // 설치된 아이템들 (벽 예산 내 무제한)
  item?: MapItem | null; // 레거시 단일 아이템 (구버전 맵 하위호환 - getMapItems로 읽을 것)
}

// 충돌된 벽 타입
export interface CollisionWall {
  playerId: string;
  position: Position;
  direction: Direction;
  timestamp: number;
  mapOwnerId: string;  // 맵 소유자 ID - 어떤 플레이어의 맵인지 구분
}

// 아이템 사용(소모) 상태 - 맵 소유자 uid를 키로 기록
// consumed는 items 배열 인덱스별 사용 여부 (레거시: boolean 단일 값)
export interface ItemStateEntry {
  consumed?: Record<number, boolean> | boolean;
  type?: ItemType;
  consumedAt?: any;
}

// 게임 상태 타입
export interface GameState {
  phase: GamePhase;
  players: Record<string, Player>;
  maps?: Record<string, GameMap>;
  // 순환 릴레이 맵 배정: { 달리는 사람 uid: 그가 달리는 맵의 주인 uid }
  assignments?: Record<string, string>;
  currentTurn?: string | null;
  winner?: string | null;
  draw?: boolean; // 최소 턴 동률 -> 무승부(공동 우승)
  collisionWalls?: any[];
  itemState?: Record<string, ItemStateEntry>;
  turnMessage?: string;
  turnMessageTimestamp?: any;
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