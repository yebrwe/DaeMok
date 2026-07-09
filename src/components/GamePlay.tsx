'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { CollisionWall, Direction, GameMap, GamePhase, Position } from '@/types/game';
import GameBoard from './GameBoard';
import GameBoard3D from './three/GameBoard3D';
import { BOARD_SIZE, canMove, getNewPosition, isPositionInBoard, isSamePosition } from '@/lib/gameUtils';
import { getDatabase, ref, update, get, onValue, push } from 'firebase/database';
import { getAuth } from 'firebase/auth';

interface GamePlayProps {
  map: GameMap;
  onGameComplete?: (moves: number) => void;
  userId: string;
  roomId: string;
  currentTurn: string | null;
  myMap?: GameMap; // 내가 만든 맵 정보 (미니맵 표시용)
  gameEnded?: boolean; // 게임 종료 여부
  isPractice?: boolean; // 연습 모드 (Firebase 사용 안 함)
  myFinished?: boolean; // 내가 이미 완주함 -> 관전 모드
  myFinishMoves?: number | null; // 내 완주 턴 수
  opponentFinished?: boolean; // 상대가 이미 완주함 -> 포기 가능
  opponentFinishMoves?: number | null; // 상대 완주 턴 수 (이걸 이겨야 승리)
  onForfeit?: () => void; // 포기 처리
}

const GamePlay: React.FC<GamePlayProps> = ({
  map,
  onGameComplete,
  userId,
  roomId,
  currentTurn,
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
  const [view3D, setView3D] = useState<boolean>(true);

  // 이동 처리 중 중복 입력 방지 (연타로 한 턴에 두 번 움직이는 버그 방지)
  const movePendingRef = useRef<boolean>(false);

  const isMyTurn = isPractice || currentTurn === userId;
  const iAmDone = gameOver || myFinished; // 내가 골인했음 (게임은 계속될 수 있음)
  const isFinished = iAmDone || gameEnded;
  // 관전 모드: 나는 골인했지만 상대가 아직 완주 중 -> 내 맵에서 상대의 진행을 지켜봄
  const spectating = !isPractice && iAmDone && !gameEnded && !!myMap && !!opponentPosition;
  // 포기 가능: 상대가 먼저 골인했고 나는 아직 완주하지 못함
  const canForfeit = !isPractice && !iAmDone && opponentFinished && !gameEnded && !!onForfeit;

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

  // 턴 변경 함수
  const changeTurn = useCallback(async () => {
    if (isPractice) return;
    // 상대가 이미 골인한 경우 턴을 넘기지 않고 나 혼자 계속 진행
    if (opponentFinished) return;

    try {
      const database = getDatabase();

      // 이미 알고 있는 상대방 ID 사용, 없으면 조회
      let targetId = opponentId;
      if (!targetId) {
        const playersSnapshot = await get(ref(database, `rooms/${roomId}/gameState/players`));
        const players = playersSnapshot.val() || {};
        targetId = Object.keys(players).find((id) => id !== userId) || null;
      }

      if (!targetId) {
        console.error('상대방 플레이어를 찾을 수 없습니다.');
        return;
      }

      await update(ref(database, `rooms/${roomId}/gameState`), { currentTurn: targetId });
    } catch (error) {
      console.error('턴 변경 중 오류 발생:', error);
    }
  }, [isPractice, opponentFinished, opponentId, roomId, userId]);

  // 플레이어 이동 처리 함수
  const handleMove = useCallback(
    async (direction: Direction) => {
      if (isFinished) return;
      if (!isMyTurn) {
        setMessage('지금은 당신의 턴이 아닙니다.');
        return;
      }
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
            const database = getDatabase();
            await update(
              ref(database, `rooms/${roomId}/gameState/players/${userId}/position`),
              newPosition
            );
          }

          if (reachedGoal) {
            setGameOver(true);
            setMessage(`축하합니다! ${newCount}턴 만에 도착지에 도달했습니다.`);
            onGameComplete?.(newCount);
          } else if (!isPractice) {
            await changeTurn();
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
            await push(
              ref(database, `rooms/${roomId}/gameState/collisionWalls`),
              newCollisionWall
            );
            await changeTurn();
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
      isMyTurn,
      playerPosition,
      obstacles,
      moveCount,
      endPosition,
      isPractice,
      roomId,
      userId,
      opponentId,
      onGameComplete,
      changeTurn,
    ]
  );

  // 키보드 이벤트 처리 - ref로 항상 최신 handleMove를 사용 (stale closure 방지)
  const handleMoveRef = useRef(handleMove);
  handleMoveRef.current = handleMove;

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
        handleMoveRef.current(direction);
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
      {/* 상단 정보 영역 */}
      <div className="w-full flex justify-center items-center mb-2 px-2 gap-4">
        {/* 내 정보 */}
        <div className="flex items-center gap-1">
          {playerPhotoURL ? (
            <img
              src={playerPhotoURL}
              alt="Player"
              className="w-5 h-5 rounded-full object-cover border border-blue-500"
            />
          ) : (
            <div className="w-5 h-5 rounded-full bg-blue-500 flex items-center justify-center">
              <span className="text-white text-[8px]">P</span>
            </div>
          )}
          <span className="text-xs">{playerName.substring(0, 6)}</span>
        </div>

        <div className="text-xs">이동: {moveCount}</div>

        <div className="text-xs text-center">
          {gameEnded ? (
            <span className="text-green-600">종료</span>
          ) : iAmDone ? (
            <span className="text-purple-600 font-bold">관전 중</span>
          ) : isMyTurn ? (
            <span className="text-blue-600 font-bold">내 턴</span>
          ) : (
            <span className="text-gray-600">대기</span>
          )}
        </div>

        {/* 상대방 정보 */}
        {opponentId && (
          <div className="flex items-center gap-1">
            {opponentPhotoURL ? (
              <img
                src={opponentPhotoURL}
                alt="Opponent"
                className="w-5 h-5 rounded-full object-cover border border-red-500"
              />
            ) : (
              <div className="w-5 h-5 rounded-full bg-red-500 flex items-center justify-center">
                <span className="text-white text-[8px]">O</span>
              </div>
            )}
            <span className="text-xs">{opponentName.substring(0, 6)}</span>
          </div>
        )}

        {/* 3D/2D 보기 전환 */}
        <button
          className="text-xs px-2 py-0.5 rounded border border-gray-300 bg-white hover:bg-gray-100 transition-colors"
          onClick={() => setView3D((prev) => !prev)}
        >
          {view3D ? '2D 보기' : '3D 보기'}
        </button>
      </div>

      {/* 메시지 표시 영역 */}
      {message && (
        <div
          className={`text-xs mb-2 ${
            lastMoveValid === false
              ? 'text-red-500 font-bold'
              : lastMoveValid === true
                ? 'text-green-500'
                : 'text-gray-600'
          }`}
        >
          {message}
        </div>
      )}

      {/* 관전 모드 안내 - 턴 수가 적은 쪽이 이기므로 아직 승부가 확정되지 않음 */}
      {spectating && (
        <div className="text-xs mb-2 px-3 py-1.5 rounded bg-purple-50 text-purple-700 font-medium">
          🏁 {myFinishMoves ?? moveCount}턴으로 완주했습니다! 상대방이 더 적은 턴으로 완주하면
          패배, 같은 턴이면 무승부입니다. (관전 중)
        </div>
      )}

      {/* 상대가 먼저 완주 -> 기록 도전 또는 포기 선택 */}
      {canForfeit && (
        <div className="text-xs mb-2 px-3 py-1.5 rounded bg-orange-50 text-orange-700 font-medium flex items-center gap-2">
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
            className="px-2 py-0.5 bg-red-500 text-white rounded hover:bg-red-600 transition-colors shrink-0"
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
            <div className="flex-1 w-full overflow-hidden flex justify-center">
              {view3D ? (
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
            </div>
          );
        })()}

        {/* 미니맵 - 내가 만든 맵에서 상대방 플레이 (연습/관전 중에는 표시 안 함) */}
        {!isPractice && !spectating && myMap && opponentPosition && (
          <div className="w-full md:w-64 flex justify-center">
            <div className="bg-gray-100 p-2 rounded shadow-sm">
              <div className="text-[10px] text-gray-500 text-center mb-1">내 맵 (상대방 진행 상황)</div>
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

      {/* 방향 컨트롤 버튼 (게임 종료 시 숨김) */}
      {!isFinished && (
        <div className="flex justify-center gap-2 mt-3">
          <div className="grid grid-cols-3 gap-1">
            <div className="col-start-2">
              <button
                className="w-10 h-10 bg-blue-500 text-white rounded-full flex items-center justify-center hover:bg-blue-600 disabled:bg-gray-300"
                onClick={() => handleMove('up')}
                disabled={!isMyTurn}
              >
                ↑
              </button>
            </div>
            <div className="col-start-1 row-start-2">
              <button
                className="w-10 h-10 bg-blue-500 text-white rounded-full flex items-center justify-center hover:bg-blue-600 disabled:bg-gray-300"
                onClick={() => handleMove('left')}
                disabled={!isMyTurn}
              >
                ←
              </button>
            </div>
            <div className="col-start-2 row-start-2">
              <button
                className="w-10 h-10 bg-gray-200 text-gray-700 rounded-full flex items-center justify-center"
                disabled
              >
                •
              </button>
            </div>
            <div className="col-start-3 row-start-2">
              <button
                className="w-10 h-10 bg-blue-500 text-white rounded-full flex items-center justify-center hover:bg-blue-600 disabled:bg-gray-300"
                onClick={() => handleMove('right')}
                disabled={!isMyTurn}
              >
                →
              </button>
            </div>
            <div className="col-start-2 row-start-3">
              <button
                className="w-10 h-10 bg-blue-500 text-white rounded-full flex items-center justify-center hover:bg-blue-600 disabled:bg-gray-300"
                onClick={() => handleMove('down')}
                disabled={!isMyTurn}
              >
                ↓
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default GamePlay;
