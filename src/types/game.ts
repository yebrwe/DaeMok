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
  lastSeen?: unknown; // 서버 타임스탬프를 저장하기 위한 필드
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
  lastSeen?: unknown; // serverTimestamp 타입
  photoURL?: string | null; // 프로필 이미지 URL 추가
  finished?: boolean; // 도착점 골인 여부 (골인 후에는 관전)
  finishMoves?: number; // 완주에 소모한 턴 수 (승패 판정 기준)
  forfeited?: boolean; // 포기 여부
  moves?: number; // 현재까지 소모한 턴 수 (이동/충돌/액티브 아이템 포함)
  positionHistory?: Position[]; // 지뢰 효과 계산용 턴 종료 위치 기록
}

// 맵 아이템 타입 (벽 예산 안에서 여러 개 배치 가능)
export type SpecialWallType =
  | 'steelWall'
  | 'fireWall'
  | 'fogWall'
  | 'illusionWall'
  | 'poisonWall'
  | 'iceWall'
  | 'windWall'
  | 'collapseWall'
  | 'phaseWall'
  | 'mirrorWall'
  | 'thornWall'
  | 'crystalWall';

export type WallItemType = 'oneTimeWall' | SpecialWallType;

export type ItemType = WallItemType | 'mine' | 'wormhole' | 'radar' | 'smoke';

export type MazeSkillId = 'scoutPulse' | 'breach' | 'anchor' | 'dash';

// A player chooses exactly one persistent runner loadout for each submitted map.
// `none` is explicit on newly-authored maps; a missing value is read as `none`
// only for legacy compatibility.
export type RunnerGear = 'none' | 'wormholeEscapeKit' | 'insight';

export interface LegacyWormholeChallenge {
  version: 1;
  startPosition: Position;
  endPosition: Position;
  // 모든 봉인을 밟은 뒤에만 내부 출구가 열린다.
  seals: Position[];
  // 내부 맵은 재귀 아이템 없이 일반 벽만 가진다.
  obstacles: Obstacle[];
}

export type DiceFace = 1 | 2 | 3 | 4 | 5 | 6;

// 0~23은 src/lib/diceWormhole.ts의 고정 방향 표를 가리키는 wire 값이다.
export type DiceOrientationId = number;

export interface DiceWormholeChallenge {
  version: 2;
  boardSize: 4;
  startPosition: Position;
  endPosition: Position;
  // 주사위가 올라갈 수 없는, 항상 보이는 내부 칸이다.
  blockedCells: Position[];
  initialOrientation: DiceOrientationId;
  targetTop: DiceFace;
}

export type WormholeChallenge = LegacyWormholeChallenge | DiceWormholeChallenge;

export interface MazeSkillStateData {
  version: 1;
  loadout: MazeSkillId[];
  consumed: Partial<Record<MazeSkillId, boolean>>;
}

export interface MapItem {
  type: ItemType;
  // oneTimeWall: 일반 벽과 똑같이 한 번 막은 뒤, 다음 시도부터 통과되는 위장 벽 (벽 7개 소모)
  wallPosition?: Position;
  wallDirection?: Direction;
  // windWall: 충돌한 원래 칸에서 튕겨날 방향. 생략하면 입력 방향을 사용한다.
  effectDirection?: Direction;
  // mine: 밟으면 2턴 전 위치로 되돌아감 (벽 1개 소모)
  // smoke: 밟으면 다음 유효 행동까지 주행 보드 시야가 가려짐 (벽 1개 소모)
  position?: Position;
  // wormhole: 입구를 밟으면 자동 생성된 4×4 주사위 방으로 이동하고,
  // 목표 눈을 위로 맞춰 내부 출구에 도달해야 외부 exit로 복귀한다. (벽 7개 소모)
  entrance?: Position;
  exit?: Position;
  // v1과 challenge가 없는 값은 진행 중인 구형 웜홀의 읽기 호환용이다.
  challenge?: WormholeChallenge;
  // radar: 한 개당 1턴을 사용해 내 주변 3x3의 벽을 탐지 (벽 4개 소모)
}

// 게임 맵 타입
export interface GameMap {
  rulesVersion?: number;
  startPosition: Position;
  endPosition: Position;
  obstacles: Obstacle[];
  items?: MapItem[] | null; // 설치된 아이템들 (공용 벽 예산 + 종류별 최대 수량)
  item?: MapItem | null; // 레거시 단일 아이템 (구버전 맵 하위호환 - getMapItems로 읽을 것)
  skillLoadout?: MazeSkillId | null;
  runnerGear?: RunnerGear;
}

// 충돌된 벽 타입
export interface CollisionWall {
  playerId: string;
  position: Position;
  direction: Direction;
  timestamp: number;
  mapOwnerId: string;  // 맵 소유자 ID - 어떤 플레이어의 맵인지 구분
  // Only the colliding insight runner may receive this marker in a projected view.
  identifiedAsFake?: true;
}

// 아이템 사용(소모) 상태 - 맵 소유자 uid를 키로 기록
// consumed는 items 배열 인덱스별 사용 여부 (레거시: boolean 단일 값)
export interface ItemStateEntry {
  consumed?: Record<number, boolean> | boolean;
  // collapseWall의 영구 활성 상태와 phaseWall의 다음 통과 상태를 인덱스별로 저장한다.
  activeWalls?: Record<number, boolean>;
  phaseOpen?: Record<number, boolean>;
  // 향후 내구도/파괴 효과를 위한 하위호환 확장 지점. steelWall은 이 값을 무시한다.
  durability?: Record<number, number> | number;
  mazeSkill?: MazeSkillStateData;
  type?: ItemType;
  consumedAt?: unknown;
}

export interface SmokeVisionEffect {
  type: 'smoke';
  sourcePlayerId: string;
  appliedAtTurn: number;
  expiresAtTargetMove: number;
}

export interface FireVisionEffect {
  type: 'fire';
  sourcePlayerId: string;
  appliedAtTurn: number;
  expiresAtTargetMove: number;
  // V3 열기 환영 기록의 읽기 호환용이다. 신규 화염벽은 4행동 동안 발견 지도를 태운다.
  phantomWalls?: Obstacle[];
}

export type VisionEffect = SmokeVisionEffect | FireVisionEffect;

export interface PoisonEffect {
  sourcePlayerId: string;
  appliedAtTurn: number;
  expiresAtTargetMove: number;
  // 매 행동을 상·하·좌·우 중 하나로 100% 무작위 변환할 때 쓰는 고정 시드.
  seed: number;
}

export interface IllusionEffect {
  sourcePlayerId: string;
  appliedAtTurn: number;
  // The trigger action is excluded. Each subsequently committed own action,
  // including a wormhole action, consumes exactly one remaining action.
  actionsRemaining: number;
  // Fixed only once: the origin immediately before the first main-board wall
  // that was traversed while the illusion was active.
  firstWallOrigin?: Position;
}

interface WormholeRunStateBase {
  mapOwnerId: string;
  itemIndex: number;
  position: Position;
  enteredAtTurn: number;
}

export interface LegacyWormholeRunState extends WormholeRunStateBase {
  challenge: LegacyWormholeChallenge;
  activatedSeals?: Record<number, boolean>;
  discoveredWalls?: Obstacle[];
}

export interface DiceWormholeRunState extends WormholeRunStateBase {
  challenge: DiceWormholeChallenge;
  orientation: DiceOrientationId;
  // 웜홀 진입 행동은 제외하고 내부에서 실제로 소모한 행동 수다.
  actionsTaken: number;
}

export type WormholeRunState = LegacyWormholeRunState | DiceWormholeRunState;

export interface GameRuleSnapshot {
  version: number;
  wallBudget: number;
  runnerGearWallBudget: number;
  itemCosts: Record<ItemType, number>;
  itemLimits: Record<ItemType, number>;
  maxSkillLoadout: number;
  skillIds: MazeSkillId[];
}

// 게임 상태 타입
export interface GameState {
  rulesVersion?: number;
  // Room-local monotonic id used to make result/stat settlement idempotent.
  matchNumber?: number;
  phase: GamePhase;
  players: Record<string, Player>;
  maps?: Record<string, GameMap>;
  // 순환 릴레이 맵 배정: { 달리는 사람 uid: 그가 달리는 맵의 주인 uid }
  assignments?: Record<string, string>;
  currentTurn?: string | null;
  turnOrder?: string[];
  turnNumber?: number;
  winner?: string | null;
  draw?: boolean | null; // 최소 턴 동률 -> 무승부(공동 우승), RTDB null은 필드 제거
  collisionWalls?: Record<string, CollisionWall> | CollisionWall[];
  itemState?: Record<string, ItemStateEntry>;
  revealedWallsByPlayer?: Record<string, Obstacle[]>;
  visionEffectsByPlayer?: Record<string, VisionEffect> | null;
  poisonEffectsByPlayer?: Record<string, PoisonEffect> | null;
  illusionEffectsByPlayer?: Record<string, IllusionEffect> | null;
  // 외부 player.position은 입구에 고정하고 내부 좌표는 주자별 세션에 분리한다.
  wormholeRunsByPlayer?: Record<string, WormholeRunState>;
  turnMessage?: string;
  turnMessageTimestamp?: unknown;
}

// 게임 방 타입
export interface Room {
  id: string;
  name: string;
  // Firebase의 0~3번 보안 슬롯. 방 목록에서는 빈 슬롯을 제거한 요약으로 사용한다.
  players?: string[];
  gameState: GameState | null;
  // Online maps live beside gameState so turn transactions cannot rewrite them.
  maps?: Record<string, GameMap>;
  maxPlayers: number;
  rulesVersion?: number;
  ruleSnapshot?: GameRuleSnapshot;
  createdAt?: number | null;
  createdBy?: string;
  ownerPresenceReady?: boolean;
  ownerDisconnectedAt?: number;
  status?: 'waiting' | 'playing' | 'ended';
  lastActivity?: number | null;
}
