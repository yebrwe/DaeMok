'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { CollisionWall, Direction, GameMap, GamePhase, Position } from '@/types/game';
import GameBoard from './GameBoard';
import GameBoard3D from './three/GameBoard3D';
import { BOARD_SIZE, canMove, getNewPosition, getOppositeDirection, isPositionInBoard, isSamePosition } from '@/lib/gameUtils';
import { getDatabase, ref, update, get, onValue, push, serverTimestamp } from 'firebase/database';
import { getAuth } from 'firebase/auth';

interface GamePlayProps {
  map: GameMap;
  onGameComplete?: (moves: number) => void;
  userId: string;
  roomId: string;
  myMap?: GameMap; // 내가 만든 맵 정보 (미니맵 표시용)
  gameEnded?: boolean; // 게임 종료 여부
  isPractice?: boolean; // 연습 모드 (Firebase 사용 안 함)
  myFinished?: boolean; // 내가 이미 완주함 -> 관전 모드
  myFinishMoves?: number | null; // 내 완주 턴 수
  opponentFinished?: boolean; // 상대가 이미 완주함 -> 포기 가능
  opponentFinishMoves?: number | null; // 상대 완주 턴 수 (이걸 이겨야 승리)
  onForfeit?: () => void; // 포기 처리
}

// 1인칭 회전 매핑 (좌회전/우회전)
const ROTATE_LEFT: Record<Direction, Direction> = { up: 'left', left: 'down', down: 'right', right: 'up' };
const ROTATE_RIGHT: Record<Direction, Direction> = { up: 'right', right: 'down', down: 'left', left: 'up' };

type ViewMode = 'first' | 'third' | '2d';

const GamePlay: React.FC<GamePlayProps> = ({
  map,
  onGameComplete,
  userId,
  roomId,
  myMap,
  gameEnded = false,
  isPractice: isPracticeProp = false,
  myFinished = false,
  myFinishMoves = null,
  opponentFinished = false,
  opponentFinishMoves = null,
  onForfeit,
}) => {
  // 연습 모드에서는 Firebase에 어떤 데이터도 쓰지 않는다
  const isPractice = isPracticeProp || roomId === 'practice-room';

  // 맵 데이터 안전하게 구조 분해
  const {
    startPosition = { row: 0, col: 0 },
    endPosition = { row: BOARD_SIZE - 1, col: BOARD_SIZE - 1 },
    obstacles = [],
  } = map || {};

  const [playerPosition, setPlayerPosition] = useState<Position>(startPosition);
  const [moveCount, setMoveCount] = useState<number>(0);
  const [gameOver, setGameOver] = useState<boolean>(false);
  const [lastMoveValid, setLastMoveValid] = useState<boolean | null>(null);
  const [message, setMessage] = useState<string>('');
  const [opponentPosition, setOpponentPosition] = useState<Position | null>(null);
  const [opponentId, setOpponentId] = useState<string | null>(null);
  const [collisionWalls, setCollisionWalls] = useState<CollisionWall[]>([]);
  const [opponentCollisionWalls, setOpponentCollisionWalls] = useState<CollisionWall[]>([]);
  const [playerPhotoURL, setPlayerPhotoURL] = useState<string | null>(null);
  const [opponentPhotoURL, setOpponentPhotoURL] = useState<string | null>(null);
  const [playerName, setPlayerName] = useState<string>('나');
  const [opponentName, setOpponentName] = useState<string>('상대방');
  // 시점: 1인칭(미로 체험, 기본) / 3인칭(오버헤드) / 2D
  const [viewMode, setViewMode] = useState<ViewMode>('first');
  // 1인칭에서 바라보는 방향 - 시작 시 도착점 쪽을 향함
  const [facing, setFacing] = useState<Direction>(() => {
    const dr = endPosition.row - startPosition.row;
    const dc = endPosition.col - startPosition.col;
    return Math.abs(dc) >= Math.abs(dr) ? (dc >= 0 ? 'right' : 'left') : (dr >= 0 ? 'down' : 'up');
  });

  // 이동 처리 중 중복 입력 방지 (연타로 한 턴에 두 번 움직이는 버그 방지)
  const movePendingRef = useRef<boolean>(false);

  const iAmDone = gameOver || myFinished; // 내가 골인했음 (게임은 계속될 수 있음)
  const isFinished = iAmDone || gameEnded;
  // 관전 모드: 나는 골인했지만 상대가 아직 완주 중 -> 내 맵에서 상대의 진행을 지켜봄
  const spectating = !isPractice && iAmDone && !gameEnded && !!myMap && !!opponentPosition;
  // 포기 가능: 상대가 먼저 골인했고 나는 아직 완주하지 못함
  const canForfeit = !isPractice && !iAmDone && opponentFinished && !gameEnded && !!onForfeit;
  // 관전/종료 시에는 전체가 보이는 시점으로 강제 (1인칭 불가)
  const effectiveViewMode: ViewMode =
    (spectating || isFinished) && viewMode === 'first' ? 'third' : viewMode;

  // 새로고침 후에도 진행 중이던 위치 복원 (멀티플레이어 전용)
  useEffect(() => {
    if (isPractice) return;

    let cancelled = false;
    const database = getDatabase();
    const myPositionRef = ref(database, `rooms/${roomId}/gameState/players/${userId}/position`);

    get(myPositionRef)
      .then((snapshot) => {
        const position = snapshot.val();
        if (!cancelled && position && typeof position.row === 'number' && typeof position.col === 'number') {
          setPlayerPosition(position);
        }
      })
      .catch((error) => {
        console.error('내 위치 복원 중 오류:', error);
      });

    return () => {
      cancelled = true;
    };
  }, [roomId, userId, isPractice]);

  // 상대방 ID 및 위치 정보 구독 (멀티플레이어 전용)
  useEffect(() => {
    if (isPractice) return;

    const database = getDatabase();
    let positionUnsubscribe: (() => void) | null = null;
    let cancelled = false;

    const fetchOpponent = async () => {
      try {
        const playersRef = ref(database, `rooms/${roomId}/gameState/players`);
        const playersSnapshot = await get(playersRef);
        const players = playersSnapshot.val() || {};

        // 나를 제외한 플레이어가 상대방
        const foundOpponentId = Object.keys(players).find((id) => id !== userId);

        if (foundOpponentId && !cancelled) {
          setOpponentId(foundOpponentId);

          // 상대방 위치 정보 구독
          const opponentPositionRef = ref(
            database,
            `rooms/${roomId}/gameState/players/${foundOpponentId}/position`
          );
          positionUnsubscribe = onValue(opponentPositionRef, (snapshot) => {
            const position = snapshot.val();
            if (position) {
              setOpponentPosition(position);
            }
          });
        }
      } catch (error) {
        console.error('상대방 정보 조회 중 오류:', error);
      }
    };

    fetchOpponent();

    return () => {
      cancelled = true;
      if (positionUnsubscribe) positionUnsubscribe();
    };
  }, [roomId, userId, isPractice]);

  // 충돌 벽 정보 구독 (멀티플레이어 전용)
  useEffect(() => {
    if (isPractice) return;

    const database = getDatabase();
    const collisionWallsRef = ref(database, `rooms/${roomId}/gameState/collisionWalls`);

    const unsubscribe = onValue(collisionWallsRef, (snapshot) => {
      const walls = snapshot.val();
      if (walls) {
        const wallList = Object.values(walls) as CollisionWall[];

        // 내가 플레이하는 맵(상대방이 만든 맵)의 충돌 벽
        setCollisionWalls(wallList.filter((wall) => wall.mapOwnerId === opponentId));

        // 상대방이 플레이하는 맵(내가 만든 맵)의 충돌 벽
        setOpponentCollisionWalls(wallList.filter((wall) => wall.mapOwnerId === userId));
      } else {
        setCollisionWalls([]);
        setOpponentCollisionWalls([]);
      }
    });

    return () => unsubscribe();
  }, [roomId, opponentId, userId, isPractice]);

  // 사용자 프로필(이미지/이름) 가져오기 (멀티플레이어 전용)
  useEffect(() => {
    if (isPractice) return;

    const fetchProfiles = async () => {
      try {
        const database = getDatabase();
        const auth = getAuth();

        // 내 프로필
        if (auth.currentUser?.photoURL) {
          setPlayerPhotoURL(auth.currentUser.photoURL);
        }
        const myPlayerRef = ref(database, `rooms/${roomId}/gameState/players/${userId}`);
        const mySnapshot = await get(myPlayerRef);
        const myData = mySnapshot.exists() ? mySnapshot.val() : null;
        setPlayerName(myData?.displayName || auth.currentUser?.displayName || '나');

        // 상대방 프로필
        if (opponentId) {
          const opponentPlayerRef = ref(database, `rooms/${roomId}/gameState/players/${opponentId}`);
          const snapshot = await get(opponentPlayerRef);
          if (snapshot.exists()) {
            const userData = snapshot.val();
            if (userData.displayName) setOpponentName(userData.displayName);
            if (userData.photoURL) setOpponentPhotoURL(userData.photoURL);
          }
        }
      } catch (error) {
        console.error('프로필 정보 가져오기 오류:', error);
      }
    };

    fetchProfiles();
  }, [userId, opponentId, roomId, isPractice]);

  // 플레이어 이동 처리 함수 (자유 이동 - 턴 대기 없이 각자 진행, 최종 턴 수로 승부)
  const handleMove = useCallback(
    async (direction: Direction) => {
      if (isFinished) return;
      if (movePendingRef.current) return;

      const newPosition = getNewPosition(playerPosition, direction);

      // 보드 밖 이동: 눈에 보이는 정보이므로 턴을 소모하지 않음
      if (!isPositionInBoard(newPosition)) {
        setLastMoveValid(null);
        setMessage('보드 밖으로는 이동할 수 없습니다.');
        return;
      }

      const canMoveResult = canMove(playerPosition, direction, obstacles);
      setLastMoveValid(canMoveResult);
      movePendingRef.current = true;

      try {
        const newCount = moveCount + 1;

        if (canMoveResult) {
          setPlayerPosition(newPosition);
          setMoveCount(newCount);
          setMessage('이동했습니다.');

          const reachedGoal = isSamePosition(newPosition, endPosition);

          if (!isPractice) {
            // 쓰기는 순서가 보장되므로 기다리지 않는다
            // (기다리면 네트워크 지연 동안 다음 입력이 씹힘 - 자유 이동 모드의 입력 반응성)
            const database = getDatabase();
            update(
              ref(database, `rooms/${roomId}/gameState/players/${userId}/position`),
              newPosition
            ).catch((error) => console.error('위치 업데이트 오류:', error));
            // 방 활동 시각 갱신 (유령 방 자동 정리 대상에서 제외)
            update(ref(database, `rooms/${roomId}`), { lastActivity: serverTimestamp() }).catch(() => {});
          }

          if (reachedGoal) {
            setGameOver(true);
            setMessage(`축하합니다! ${newCount}턴 만에 도착지에 도달했습니다.`);
            onGameComplete?.(newCount);
          }
        } else {
          // 벽 충돌: 턴을 소모하고 충돌한 벽을 기록
          setMoveCount(newCount);
          setMessage('이동할 수 없습니다. 벽에 부딪혔습니다!');

          const newCollisionWall: CollisionWall = {
            playerId: userId,
            position: playerPosition,
            direction,
            timestamp: Date.now(),
            mapOwnerId: isPractice ? 'practice' : opponentId || '',
          };

          if (isPractice) {
            // 연습 모드: 로컬 상태에만 기록
            setCollisionWalls((prev) => [...prev, newCollisionWall]);
          } else {
            const database = getDatabase();
            // push로 추가하여 동시 기록 시 서로 덮어쓰지 않도록 함
            push(
              ref(database, `rooms/${roomId}/gameState/collisionWalls`),
              newCollisionWall
            ).catch((error) => console.error('충돌 벽 기록 오류:', error));
            update(ref(database, `rooms/${roomId}`), { lastActivity: serverTimestamp() }).catch(() => {});
          }
        }
      } catch (error) {
        console.error('이동 처리 중 오류 발생:', error);
      } finally {
        movePendingRef.current = false;
      }
    },
    [
      isFinished,
      playerPosition,
      obstacles,
      moveCount,
      endPosition,
      isPractice,
      roomId,
      userId,
      opponentId,
      onGameComplete,
    ]
  );

  // 입력 -> 이동/회전 변환
  // 1인칭: ↑ 전진 / ↓ 후진 / ←→ 회전(턴 소모 없음, 언제든 가능)
  // 3인칭/2D: 방향키 = 절대 방향 이동
  const handleControl = useCallback(
    (input: Direction) => {
      if (effectiveViewMode === 'first') {
        if (input === 'left') {
          setFacing((f) => ROTATE_LEFT[f]);
          return;
        }
        if (input === 'right') {
          setFacing((f) => ROTATE_RIGHT[f]);
          return;
        }
        if (input === 'up') {
          handleMove(facing);
          return;
        }
        handleMove(getOppositeDirection(facing)); // ↓ = 후진
        return;
      }
      handleMove(input);
    },
    [effectiveViewMode, facing, handleMove]
  );

  // 키보드 이벤트 처리 - ref로 항상 최신 핸들러를 사용 (stale closure 방지)
  const handleControlRef = useRef(handleControl);
  handleControlRef.current = handleControl;

  useEffect(() => {
    const keyToDirection: Record<string, Direction> = {
      ArrowUp: 'up',
      ArrowDown: 'down',
      ArrowLeft: 'left',
      ArrowRight: 'right',
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      const direction = keyToDirection[event.key];
      if (direction) {
        event.preventDefault();
        handleControlRef.current(direction);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, []);

  // 게임 종료 상태 반영 (벽 공개는 로컬에서 처리하므로 Firebase 기록 불필요)
  useEffect(() => {
    if (gameEnded) {
      setGameOver(true);
    }
  }, [gameEnded]);

  return (
    <div className="flex flex-col items-center w-full max-w-2xl mx-auto">
      {/* 상단 HUD - 플레이어 대결 정보 */}
      <div className="w-full game-panel !rounded-xl px-3 py-2 mb-2 flex justify-between items-center gap-2">
        {/* 내 정보 */}
        <div className={`flex items-center gap-2 px-2 py-1 rounded-lg ${!isFinished ? 'bg-blue-500/15 ring-1 ring-blue-400/50' : ''}`}>
          {playerPhotoURL ? (
            <img
              src={playerPhotoURL}
              alt="Player"
              className="w-7 h-7 rounded-full object-cover ring-2 ring-blue-400"
            />
          ) : (
            <div className="w-7 h-7 rounded-full bg-blue-500 ring-2 ring-blue-400 flex items-center justify-center">
              <span className="text-white text-[10px] font-bold">나</span>
            </div>
          )}
          <div className="leading-tight">
            <div className="text-xs font-bold text-blue-300">{playerName.substring(0, 6)}</div>
            <div className="text-[10px] text-slate-400">이동: {moveCount}</div>
          </div>
        </div>

        {/* 중앙 상태 */}
        <div className="flex flex-col items-center gap-1">
          <span className="text-[10px] text-slate-500 font-bold tracking-widest">VS</span>
          {gameEnded ? (
            <span className="px-2.5 py-1 rounded-full text-xs font-bold bg-green-400/15 text-green-300 border border-green-400/40">종료</span>
          ) : iAmDone ? (
            <span className="px-2.5 py-1 rounded-full text-xs font-bold bg-purple-400/15 text-purple-300 border border-purple-400/40">관전 중</span>
          ) : (
            <span className="badge-turn">진행 중</span>
          )}
        </div>

        {/* 상대방 정보 + 보기 전환 */}
        <div className="flex items-center gap-2">
          {opponentId ? (
            <div className={`flex items-center gap-2 px-2 py-1 rounded-lg ${!opponentFinished && !gameEnded ? 'bg-red-500/15 ring-1 ring-red-400/50' : ''}`}>
              <div className="leading-tight text-right">
                <div className="text-xs font-bold text-red-300">{opponentName.substring(0, 6)}</div>
                <div className="text-[10px] text-slate-400">상대</div>
              </div>
              {opponentPhotoURL ? (
                <img
                  src={opponentPhotoURL}
                  alt="Opponent"
                  className="w-7 h-7 rounded-full object-cover ring-2 ring-red-400"
                />
              ) : (
                <div className="w-7 h-7 rounded-full bg-red-500 ring-2 ring-red-400 flex items-center justify-center">
                  <span className="text-white text-[10px] font-bold">적</span>
                </div>
              )}
            </div>
          ) : (
            !isPractice && <span className="text-[10px] text-slate-500">상대 대기</span>
          )}
          {/* 시점 전환 (관전/종료 시 1인칭 비활성) */}
          <div className="flex rounded-lg overflow-hidden border border-slate-600/70">
            {((spectating || isFinished ? ['third', '2d'] : ['first', 'third', '2d']) as ViewMode[]).map((m) => (
              <button
                key={m}
                className={`px-2 py-1 text-[11px] font-bold transition-colors ${
                  effectiveViewMode === m
                    ? 'bg-amber-400 text-slate-900'
                    : 'bg-slate-800/80 text-slate-400 hover:text-white'
                }`}
                onClick={() => setViewMode(m)}
              >
                {m === 'first' ? '1인칭' : m === 'third' ? '3인칭' : '2D'}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* 메시지 표시 영역 */}
      {message && (
        <div
          className={`text-xs mb-2 px-3 py-1 rounded-full border ${
            lastMoveValid === false
              ? 'bg-red-500/10 border-red-500/40 text-red-300 font-bold'
              : lastMoveValid === true
                ? 'bg-green-500/10 border-green-500/40 text-green-300'
                : 'bg-slate-800/60 border-slate-600/50 text-slate-300'
          }`}
        >
          {message}
        </div>
      )}

      {/* 관전 모드 안내 - 턴 수가 적은 쪽이 이기므로 아직 승부가 확정되지 않음 */}
      {spectating && (
        <div className="text-xs mb-2 px-3 py-1.5 rounded-xl bg-purple-500/10 border border-purple-400/40 text-purple-200 font-medium">
          🏁 {myFinishMoves ?? moveCount}턴으로 완주했습니다! 상대방이 더 적은 턴으로 완주하면
          패배, 같은 턴이면 무승부입니다. (관전 중)
        </div>
      )}

      {/* 상대가 먼저 완주 -> 기록 도전 또는 포기 선택 */}
      {canForfeit && (
        <div className="text-xs mb-2 px-3 py-1.5 rounded-xl bg-orange-500/10 border border-orange-400/40 text-orange-200 font-medium flex items-center gap-2">
          <span>
            상대방이 {opponentFinishMoves ?? '?'}턴으로 완주했습니다.{' '}
            {opponentFinishMoves == null
              ? '더 적은 턴으로 완주하면 승리합니다!'
              : moveCount + 1 < opponentFinishMoves
                ? `${opponentFinishMoves - 1}턴 이내로 완주하면 승리합니다! (현재 ${moveCount}턴 사용)`
                : moveCount + 1 === opponentFinishMoves
                  ? '다음 이동에 바로 골인하면 무승부입니다.'
                  : '이미 상대보다 많은 턴을 사용해 승리할 수 없습니다. 완주하거나 포기하세요.'}
          </span>
          <button
            className="btn-danger text-xs px-2.5 py-1 shrink-0"
            onClick={() => {
              if (window.confirm('정말 포기하시겠습니까? 게임이 바로 종료됩니다.')) {
                onForfeit?.();
              }
            }}
          >
            포기하기
          </button>
        </div>
      )}

      {/* 메인 게임 영역과 미니맵 */}
      <div className="flex flex-col md:flex-row w-full gap-2 items-center md:items-start justify-center">
        {/* 메인 게임보드 - 평소엔 내가 플레이하는 상대방 맵,
            관전 중에는 내가 만든 맵에서 상대방(빨간 말)의 진행 상황.
            어떤 상태에서든 보드 엘리먼트는 하나로 유지하고 props만 전환한다
            (조건 분기로 엘리먼트가 바뀌면 WebGL 캔버스가 매번 파괴/재생성됨) */}
        {(() => {
          const board =
            spectating && myMap && opponentPosition
              ? {
                  startPosition: myMap.startPosition,
                  endPosition: myMap.endPosition,
                  playerPosition: opponentPosition,
                  obstacles: myMap.obstacles,
                  collisionWalls: opponentCollisionWalls,
                  revealObstacles: true,
                  pawnColor: '#ef4444',
                  photoURL: opponentPhotoURL || undefined,
                }
              : {
                  startPosition,
                  endPosition,
                  playerPosition,
                  obstacles,
                  collisionWalls,
                  revealObstacles: isFinished,
                  pawnColor: undefined,
                  photoURL: playerPhotoURL || undefined,
                };

          return (
            <div className="flex-1 w-full overflow-hidden flex justify-center relative">
              {effectiveViewMode !== '2d' ? (
                <GameBoard3D
                  gamePhase={GamePhase.PLAY}
                  startPosition={board.startPosition}
                  endPosition={board.endPosition}
                  playerPosition={board.playerPosition}
                  obstacles={board.obstacles}
                  collisionWalls={board.collisionWalls}
                  readOnly={true}
                  revealObstacles={board.revealObstacles}
                  pawnColor={board.pawnColor}
                  viewMode={spectating ? 'third' : effectiveViewMode === 'first' ? 'first' : 'third'}
                  facing={facing}
                />
              ) : (
                <div className="max-w-full overflow-auto">
                  <GameBoard
                    gamePhase={GamePhase.PLAY}
                    startPosition={board.startPosition}
                    endPosition={board.endPosition}
                    playerPosition={board.playerPosition}
                    obstacles={board.obstacles}
                    collisionWalls={board.collisionWalls}
                    readOnly={true}
                    playerPhotoURL={board.photoURL}
                    revealObstacles={board.revealObstacles}
                  />
                </div>
              )}

              {/* 방향 패드 - 보드 위 오버레이 (모바일에서 스크롤 없이 조작) */}
              {!isFinished && (
                <div className="absolute bottom-2 left-1/2 -translate-x-1/2 z-20 flex flex-col items-center">
                  <div className="grid grid-cols-3 gap-1">
                    <div className="col-start-2">
                      <button
                        className="btn-dpad !w-12 !h-12 !bg-slate-900/70 backdrop-blur-sm"
                        onClick={() => handleControl('up')}
                        disabled={isFinished}
                        title={effectiveViewMode === 'first' ? '전진' : '위로 이동'}
                      >
                        {effectiveViewMode === 'first' ? '▲' : '↑'}
                      </button>
                    </div>
                    <div className="col-start-1 row-start-2">
                      <button
                        className="btn-dpad !w-12 !h-12 !bg-slate-900/70 backdrop-blur-sm"
                        onClick={() => handleControl('left')}
                        disabled={effectiveViewMode === 'first' ? false : isFinished}
                        title={effectiveViewMode === 'first' ? '좌회전 (턴 소모 없음)' : '왼쪽으로 이동'}
                      >
                        {effectiveViewMode === 'first' ? '↺' : '←'}
                      </button>
                    </div>
                    <div className="col-start-2 row-start-2">
                      <div className="w-12 h-12 rounded-2xl bg-slate-900/50 border border-slate-700/40 backdrop-blur-sm flex items-center justify-center">
                        <div className={`w-2 h-2 rounded-full ${!isFinished ? 'bg-amber-400 animate-pulse' : 'bg-slate-600'}`} />
                      </div>
                    </div>
                    <div className="col-start-3 row-start-2">
                      <button
                        className="btn-dpad !w-12 !h-12 !bg-slate-900/70 backdrop-blur-sm"
                        onClick={() => handleControl('right')}
                        disabled={effectiveViewMode === 'first' ? false : isFinished}
                        title={effectiveViewMode === 'first' ? '우회전 (턴 소모 없음)' : '오른쪽으로 이동'}
                      >
                        {effectiveViewMode === 'first' ? '↻' : '→'}
                      </button>
                    </div>
                    <div className="col-start-2 row-start-3">
                      <button
                        className="btn-dpad !w-12 !h-12 !bg-slate-900/70 backdrop-blur-sm"
                        onClick={() => handleControl('down')}
                        disabled={isFinished}
                        title={effectiveViewMode === 'first' ? '후진' : '아래로 이동'}
                      >
                        {effectiveViewMode === 'first' ? '▼' : '↓'}
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          );
        })()}

        {/* 미니맵 - 내가 만든 맵에서 상대방 플레이 (연습/관전 중에는 표시 안 함) */}
        {!isPractice && !spectating && myMap && opponentPosition && (
          <div className="w-full md:w-64 flex justify-center">
            <div className="game-panel !rounded-xl p-2">
              <div className="text-[10px] text-slate-400 text-center mb-1 font-medium">내 맵 (상대방 진행 상황)</div>
              <GameBoard
                gamePhase={GamePhase.PLAY}
                startPosition={myMap.startPosition}
                endPosition={myMap.endPosition}
                playerPosition={opponentPosition}
                obstacles={myMap.obstacles}
                collisionWalls={opponentCollisionWalls}
                readOnly={true}
                isMinimapMode={true}
                playerPhotoURL={opponentPhotoURL || undefined}
              />
            </div>
          </div>
        )}
      </div>

      {/* 조작 안내 */}
      {!isFinished && (
        <p className="text-[10px] text-slate-500 mt-2">
          {effectiveViewMode === 'first'
            ? '⌨️ ↑ 전진 · ↓ 후진 · ←→ 회전(턴 소모 없음)'
            : '⌨️ 키보드 방향키로도 이동할 수 있습니다'}
        </p>
      )}
    </div>
  );
};

export default GamePlay;
