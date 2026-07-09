'use client';

import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { CollisionWall, Direction, GameMap, GamePhase, Obstacle, Position } from '@/types/game';
import GameBoard from './GameBoard';
import GameBoard3D, { BoardFx } from './three/GameBoard3D';
import { BOARD_SIZE, canMove, getNewPosition, getOppositeDirection, isPositionInBoard, isSamePosition, findBlockingOneTimeWall, getMapItems, isSameWallSegment } from '@/lib/gameUtils';
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
  opponentFinished?: boolean; // 누군가 먼저 완주함 -> 포기 가능
  opponentFinishMoves?: number | null; // 완주자 중 최소 턴 수 (이걸 이겨야 승리)
  onForfeit?: () => void; // 포기 처리
  mapOwnerId?: string | null; // 내가 달리는 맵의 주인 (순환 릴레이 배정)
  myMapRunnerId?: string | null; // 내 맵을 달리는 사람 (미니맵 표시 대상)
  othersInfo?: Array<{
    id: string;
    name: string;
    photoURL: string | null;
    finished: boolean;
    finishMoves: number | null;
    forfeited: boolean;
    moves?: number | null; // 현재까지 소모한 턴 (실시간 순위용)
  }>; // 나를 제외한 참가자들 (HUD 표시)
}

type ViewMode = 'third' | '2d';

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
  mapOwnerId = null,
  myMapRunnerId = null,
  othersInfo = [],
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
  const [runnerPosition, setRunnerPosition] = useState<Position | null>(null);
  const [collisionWalls, setCollisionWalls] = useState<CollisionWall[]>([]);
  const [opponentCollisionWalls, setOpponentCollisionWalls] = useState<CollisionWall[]>([]);
  const [playerPhotoURL, setPlayerPhotoURL] = useState<string | null>(null);
  const [playerName, setPlayerName] = useState<string>('나');
  // 시점: 3인칭(기본) / 2D
  const [viewMode, setViewMode] = useState<ViewMode>('third');
  // 액션 이펙트 (지뢰 폭발/웜홀/탐지 파동/충돌 스파크/골인 축포)
  const [fx, setFx] = useState<BoardFx | null>(null);
  // 말 이동 경유지: 지뢰 넉백은 [지뢰 칸, 직전 칸]을 거쳐 뒤로 폴짝폴짝, 웜홀은 입구를 거쳐 흡입
  const [moveVia, setMoveVia] = useState<Position[] | null>(null);
  const fxKeyRef = useRef(0);
  const fireFx = useCallback((partial: Omit<BoardFx, 'key'>) => {
    fxKeyRef.current += 1;
    setFx({ key: fxKeyRef.current, ...partial });
  }, []);

  // 이동 처리 중 중복 입력 방지 (연타로 한 턴에 두 번 움직이는 버그 방지)
  const movePendingRef = useRef<boolean>(false);

  // 아이템 상태 - 내가 플레이하는 맵(상대 설치)과 내가 만든 맵(내가 설치)의 아이템들
  const items = useMemo(() => getMapItems(map), [map]);
  const myItems = useMemo(() => getMapItems(myMap), [myMap]);
  const [itemsConsumed, setItemsConsumed] = useState<Record<number, boolean>>({}); // 내가 달리는 맵
  const [myItemsConsumed, setMyItemsConsumed] = useState<Record<number, boolean>>({}); // 내 맵 (미니맵)

  // 이동 경로 기록 (지뢰: 2턴 전 위치로 되돌리기용)
  const positionHistoryRef = useRef<Position[]>([startPosition]);

  // 탐지기(자기용 아이템): 내 셋업에서 확보한 개수만큼 사용 가능
  // 연습에서는 내가 만든 맵이 곧 내가 달리는 맵이므로 소모 상태를 하나로 공유
  const radarOwnItems = isPractice ? items : myItems;
  const radarOwnConsumed = isPractice ? itemsConsumed : myItemsConsumed;
  const nextRadarIndex = radarOwnItems.findIndex(
    (it, idx) => it.type === 'radar' && !radarOwnConsumed[idx]
  );
  // 탐지기로 밝혀낸 벽들 (일반 벽 + 위장된 1회성 벽)
  const [revealedWalls, setRevealedWalls] = useState<Obstacle[]>([]);

  const iAmDone = gameOver || myFinished; // 내가 골인했음 (게임은 계속될 수 있음)
  const isFinished = iAmDone || gameEnded;

  // 골인 세리머니를 잠시 보여준 뒤 관전으로 전환
  const [spectateReady, setSpectateReady] = useState(false);
  useEffect(() => {
    if (iAmDone && !gameEnded) {
      const timer = setTimeout(() => setSpectateReady(true), 1800);
      return () => clearTimeout(timer);
    }
    setSpectateReady(false);
  }, [iAmDone, gameEnded]);

  // 관전 모드: 나는 골인했지만 상대가 아직 완주 중 -> 내 맵에서 상대의 진행을 지켜봄
  const spectating = !isPractice && iAmDone && !gameEnded && spectateReady && !!myMap && !!runnerPosition;
  // 포기 가능: 상대가 먼저 골인했고 나는 아직 완주하지 못함
  const canForfeit = !isPractice && !iAmDone && opponentFinished && !gameEnded && !!onForfeit;
  const effectiveViewMode: ViewMode = viewMode;

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
          positionHistoryRef.current = [position];
        }
      })
      .catch((error) => {
        console.error('내 위치 복원 중 오류:', error);
      });

    return () => {
      cancelled = true;
    };
  }, [roomId, userId, isPractice]);

  // 내 맵을 달리는 사람의 위치 구독 (미니맵/관전용, 멀티플레이어 전용)
  useEffect(() => {
    if (isPractice || !myMapRunnerId) return;

    const database = getDatabase();
    const runnerPositionRef = ref(
      database,
      `rooms/${roomId}/gameState/players/${myMapRunnerId}/position`
    );
    const unsubscribe = onValue(runnerPositionRef, (snapshot) => {
      const position = snapshot.val();
      if (position) {
        setRunnerPosition(position);
      }
    });

    return () => unsubscribe();
  }, [roomId, myMapRunnerId, isPractice]);

  // 충돌 벽 정보 구독 (멀티플레이어 전용)
  useEffect(() => {
    if (isPractice) return;

    const database = getDatabase();
    const collisionWallsRef = ref(database, `rooms/${roomId}/gameState/collisionWalls`);

    const unsubscribe = onValue(collisionWallsRef, (snapshot) => {
      const walls = snapshot.val();
      if (walls) {
        const wallList = Object.values(walls) as CollisionWall[];

        // 내가 플레이하는 맵의 충돌 벽 (맵 주인 기준)
        setCollisionWalls(wallList.filter((wall) => wall.mapOwnerId === mapOwnerId));

        // 내 맵을 달리는 사람이 만든 충돌 벽 (미니맵용)
        setOpponentCollisionWalls(wallList.filter((wall) => wall.mapOwnerId === userId));
      } else {
        setCollisionWalls([]);
        setOpponentCollisionWalls([]);
      }
    });

    return () => unsubscribe();
  }, [roomId, mapOwnerId, userId, isPractice]);

  // 아이템 사용 상태 구독 (멀티플레이어 전용)
  useEffect(() => {
    if (isPractice) return;

    const database = getDatabase();
    const itemStateRef = ref(database, `rooms/${roomId}/gameState/itemState`);

    const unsubscribe = onValue(itemStateRef, (snapshot) => {
      const state = snapshot.val() || {};
      // consumed는 인덱스별 맵 { idx: true } (레거시 단일 boolean이면 0번으로 취급)
      const toMap = (v: any): Record<number, boolean> =>
        v && typeof v === 'object' ? v : v === true ? { 0: true } : {};
      // 내가 플레이하는 맵의 아이템은 맵 주인 키에 기록됨
      if (mapOwnerId) {
        setItemsConsumed(toMap(state[mapOwnerId]?.consumed));
      }
      setMyItemsConsumed(toMap(state[userId]?.consumed));
    });

    return () => unsubscribe();
  }, [roomId, mapOwnerId, userId, isPractice]);

  // 아이템 소모 처리 (내가 플레이하는 맵의 주인이 설치한 아이템, 인덱스별)
  const consumeOpponentItem = useCallback((index: number) => {
    setItemsConsumed((prev) => ({ ...prev, [index]: true }));
    if (!isPractice && mapOwnerId) {
      const database = getDatabase();
      update(ref(database, `rooms/${roomId}/gameState/itemState/${mapOwnerId}/consumed`), {
        [index]: true,
      }).catch((error) => console.error('아이템 상태 기록 오류:', error));
      update(ref(database, `rooms/${roomId}/gameState/itemState/${mapOwnerId}`), {
        consumedAt: serverTimestamp(),
      }).catch(() => {});
    }
  }, [isPractice, mapOwnerId, roomId]);

  // 탐지기 사용 - 내 주변 한 칸(대각선 포함, 3x3)의 벽을 탐지
  // 일반 벽 + 아직 부서지지 않은 1회성 벽(일반 벽으로 위장되어 표시)을 찾아냄. 지뢰/웜홀은 탐지 불가.
  // 탐지기를 여러 개 확보했으면 그 수만큼 사용 가능
  const handleUseRadar = useCallback(() => {
    if (nextRadarIndex < 0 || isFinished) return;

    const found: Obstacle[] = [];
    const seen = new Set<string>();
    const segmentDedupeKey = (p: Position, d: Direction): string => {
      if (d === 'down' || d === 'right') return `${p.row},${p.col},${d}`;
      const adjacent = getNewPosition(p, d);
      return `${adjacent.row},${adjacent.col},${getOppositeDirection(d)}`;
    };

    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        const cell = { row: playerPosition.row + dr, col: playerPosition.col + dc };
        if (!isPositionInBoard(cell)) continue;

        (['up', 'down', 'left', 'right'] as Direction[]).forEach((dir) => {
          const target = getNewPosition(cell, dir);
          if (!isPositionInBoard(target)) return;

          const hasWall =
            obstacles.some((o) => isSameWallSegment(cell, dir, o.position, o.direction)) ||
            findBlockingOneTimeWall(cell, dir, items, (i) => !!itemsConsumed[i]) >= 0;
          if (!hasWall) return;

          const key = segmentDedupeKey(cell, dir);
          if (seen.has(key)) return;
          seen.add(key);
          found.push({ position: cell, direction: dir });
        });
      }
    }

    setRevealedWalls((prev) => {
      // 이번 탐지 결과를 기존 결과에 누적 (탐지기 여러 개 사용 시)
      const merged = [...prev];
      found.forEach((w) => {
        if (!merged.some((m) => isSameWallSegment(m.position, m.direction, w.position, w.direction))) {
          merged.push(w);
        }
      });
      return merged;
    });
    const usedIndex = nextRadarIndex;
    if (isPractice) {
      setItemsConsumed((prev) => ({ ...prev, [usedIndex]: true }));
    } else {
      setMyItemsConsumed((prev) => ({ ...prev, [usedIndex]: true }));
      const database = getDatabase();
      update(ref(database, `rooms/${roomId}/gameState/itemState/${userId}/consumed`), {
        [usedIndex]: true,
      }).catch((error) => console.error('탐지기 사용 기록 오류:', error));
    }
    setMessage(`🔍 주변을 탐지했습니다! 벽 ${found.length}개 발견`);
    fireFx({ type: 'radar', at: playerPosition });
  }, [nextRadarIndex, isFinished, playerPosition, obstacles, items, itemsConsumed, isPractice, roomId, userId, fireFx]);

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
      } catch (error) {
        console.error('프로필 정보 가져오기 오류:', error);
      }
    };

    fetchProfiles();
  }, [userId, roomId, isPractice]);

  // 내 맵을 달리는 사람 정보 (미니맵/관전 표시용)
  const runnerInfo = othersInfo.find((o) => o.id === myMapRunnerId) ?? null;

  // 실시간 순위 (마리오카트식): 완주자는 확정 턴, 진행 중은 현재 턴 기준. 포기자는 제외
  // 턴 수가 적을수록 상위. 동률은 같은 순위
  const myRankMetric = myFinished ? (myFinishMoves ?? moveCount) : moveCount;
  const rankedOthers = othersInfo.filter((o) => !o.forfeited);
  const myRank =
    1 +
    rankedOthers.filter((o) => {
      const metric = o.finished ? (o.finishMoves ?? Number.MAX_SAFE_INTEGER) : (o.moves ?? 0);
      return metric < myRankMetric;
    }).length;
  const rankTotal = rankedOthers.length + 1;
  const showRank = !isPractice && !gameEnded && othersInfo.length > 0;

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

      // 1회성 벽 아이템: 일반 벽과 완전히 똑같이 한 번 막는다 (메시지/빨간 흔적 동일 - 위장 유지)
      // 조용히 소모되어, 같은 곳을 다시 시도하면 그때는 통과된다
      const blockingWallIdx = canMoveResult
        ? findBlockingOneTimeWall(playerPosition, direction, items, (i) => !!itemsConsumed[i])
        : -1;
      if (blockingWallIdx >= 0) {
        setLastMoveValid(false);
        setMoveCount(moveCount + 1);
        setMessage('이동할 수 없습니다. 벽에 부딪혔습니다!');
        fireFx({ type: 'bump', at: playerPosition, dir: direction });
        consumeOpponentItem(blockingWallIdx);

        const disguisedCollision: CollisionWall = {
          playerId: userId,
          position: playerPosition,
          direction,
          timestamp: Date.now(),
          mapOwnerId: isPractice ? 'practice' : mapOwnerId || '',
        };

        if (isPractice) {
          setCollisionWalls((prev) => [...prev, disguisedCollision]);
        } else {
          const database = getDatabase();
          push(ref(database, `rooms/${roomId}/gameState/collisionWalls`), disguisedCollision).catch(() => {});
          update(ref(database, `rooms/${roomId}/gameState/players/${userId}`), { moves: moveCount + 1 })
            .catch(() => {});
          update(ref(database, `rooms/${roomId}`), { lastActivity: serverTimestamp() }).catch(() => {});
        }
        return;
      }

      setLastMoveValid(canMoveResult);
      movePendingRef.current = true;

      try {
        const newCount = moveCount + 1;

        if (canMoveResult) {
          // 지뢰/웜홀 아이템 발동 확인
          let finalPosition = newPosition;
          let moveMessage = '이동했습니다.';
          let moveValidState: boolean | null = true;

          let viaPath: Position[] | null = null;

          const mineIdx = items.findIndex(
            (it, idx) =>
              it.type === 'mine' && !!it.position && !itemsConsumed[idx] && isSamePosition(newPosition, it.position)
          );
          const wormholeIdx = items.findIndex(
            (it, idx) =>
              it.type === 'wormhole' && !!it.entrance && !itemsConsumed[idx] && isSamePosition(newPosition, it.entrance)
          );

          if (mineIdx >= 0) {
            const mine = items[mineIdx];
            const history = positionHistoryRef.current;
            finalPosition = history.length >= 2 ? history[history.length - 2] : history[0] ?? startPosition;
            moveMessage = '💥 지뢰를 밟아 2턴 전 위치로 되돌아갔습니다!';
            moveValidState = false;
            // 지뢰 칸에 폴짝 올라선 순간 폭발 -> 왔던 길로 뒤로 폴짝 2번
            viaPath = [newPosition, playerPosition];
            fireFx({ type: 'mine', at: mine.position!, delay: 0.35 });
            consumeOpponentItem(mineIdx);
          } else if (wormholeIdx >= 0) {
            const wormhole = items[wormholeIdx];
            finalPosition = wormhole.exit ?? newPosition;
            moveMessage = '🌀 웜홀에 빨려들어가 다른 곳으로 이동했습니다!';
            moveValidState = null;
            // 입구까지 폴짝 이동한 뒤 스파게티화되어 빨려들어감
            viaPath = [wormhole.entrance!];
            fireFx({ type: 'wormhole', at: wormhole.entrance!, to: wormhole.exit, delay: 0.35 });
            consumeOpponentItem(wormholeIdx);
          }

          setLastMoveValid(moveValidState);
          setMoveVia(viaPath);
          setPlayerPosition(finalPosition);
          positionHistoryRef.current = [...positionHistoryRef.current, finalPosition];
          setMoveCount(newCount);
          setMessage(moveMessage);

          const reachedGoal = isSamePosition(finalPosition, endPosition);

          if (!isPractice) {
            // 쓰기는 순서가 보장되므로 기다리지 않는다
            // (기다리면 네트워크 지연 동안 다음 입력이 씹힘 - 자유 이동 모드의 입력 반응성)
            const database = getDatabase();
            update(ref(database, `rooms/${roomId}/gameState/players/${userId}`), {
              position: finalPosition,
              moves: newCount, // 관전자 표시용 턴 카운터
            }).catch((error) => console.error('위치 업데이트 오류:', error));
            // 방 활동 시각 갱신 (유령 방 자동 정리 대상에서 제외)
            update(ref(database, `rooms/${roomId}`), { lastActivity: serverTimestamp() }).catch(() => {});
          }

          if (reachedGoal) {
            setGameOver(true);
            setMessage(`축하합니다! ${newCount}턴 만에 도착지에 도달했습니다.`);
            fireFx({ type: 'goal', at: endPosition });
            onGameComplete?.(newCount);
          }
        } else {
          // 벽 충돌: 턴을 소모하고 충돌한 벽을 기록
          setMoveCount(newCount);
          setMessage('이동할 수 없습니다. 벽에 부딪혔습니다!');
          fireFx({ type: 'bump', at: playerPosition, dir: direction });

          const newCollisionWall: CollisionWall = {
            playerId: userId,
            position: playerPosition,
            direction,
            timestamp: Date.now(),
            mapOwnerId: isPractice ? 'practice' : mapOwnerId || '',
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
            update(ref(database, `rooms/${roomId}/gameState/players/${userId}`), { moves: newCount })
              .catch(() => {});
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
      startPosition,
      isPractice,
      roomId,
      userId,
      mapOwnerId,
      onGameComplete,
      items,
      itemsConsumed,
      consumeOpponentItem,
      fireFx,
    ]
  );

  // 키보드 이벤트 처리 - ref로 항상 최신 핸들러를 사용 (stale closure 방지)
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

  // 메인 보드 데이터 - 평소엔 내가 플레이하는 상대방 맵,
  // 관전 중에는 내가 만든 맵에서 상대방(빨간 말)의 진행 상황.
  // 어떤 상태에서든 보드 엘리먼트는 하나로 유지하고 props만 전환한다
  // (조건 분기로 엘리먼트가 바뀌면 WebGL 캔버스가 매번 파괴/재생성됨)
  const board =
    spectating && myMap && runnerPosition
      ? {
          startPosition: myMap.startPosition,
          endPosition: myMap.endPosition,
          playerPosition: runnerPosition,
          obstacles: myMap.obstacles,
          collisionWalls: opponentCollisionWalls,
          revealObstacles: true,
          pawnColor: '#ef4444',
          photoURL: runnerInfo?.photoURL || undefined,
          items: myItems,
          itemsConsumed: myItemsConsumed,
          fx: null as BoardFx | null,
          pawnVia: null as Position[] | null,
          celebrating: false,
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
          items,
          itemsConsumed,
          fx,
          pawnVia: moveVia,
          celebrating: iAmDone, // 골인 세리머니 (관전 전환 전 + 종료 후 결과 화면)
        };

  return (
    <div className="absolute inset-0 overflow-hidden">
      {/* 보드 스테이지 */}
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
          items={board.items}
          itemsConsumed={board.itemsConsumed}
          revealedWalls={spectating ? [] : revealedWalls}
          fx={board.fx}
          pawnVia={board.pawnVia}
          celebrating={board.celebrating}
          fullscreen
        />
      ) : (
        <div className="absolute inset-0 flex items-center justify-center overflow-auto py-24 bg-gradient-to-b from-slate-800 via-slate-900 to-slate-950">
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
            items={board.items}
            itemsConsumed={board.itemsConsumed}
            revealedWalls={spectating ? [] : revealedWalls}
          />
        </div>
      )}

      {/* 상단 HUD - 플레이어 대결 정보 */}
      <div className="absolute top-2 left-1/2 -translate-x-1/2 z-20 w-[96%] max-w-3xl">
        <div className="game-panel !rounded-xl px-3 py-2 flex justify-between items-center gap-2">
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

          {/* 상대방 정보 + 아이템/시점 */}
          <div className="flex items-center gap-2">
            {othersInfo.length > 0 ? (
              <div className="flex items-center gap-1">
                {othersInfo.slice(0, 3).map((o) => (
                  <div
                    key={o.id}
                    className={`flex items-center gap-1 px-1.5 py-1 rounded-lg ${
                      !o.finished && !o.forfeited && !gameEnded ? 'bg-red-500/15 ring-1 ring-red-400/50' : 'opacity-70'
                    }`}
                    title={`${o.name} - ${o.forfeited ? '포기' : o.finished ? `${o.finishMoves}턴 완주` : '진행 중'}`}
                  >
                    {o.photoURL ? (
                      <img src={o.photoURL} alt={o.name} className="w-6 h-6 rounded-full object-cover ring-2 ring-red-400" />
                    ) : (
                      <div className="w-6 h-6 rounded-full bg-red-500 ring-2 ring-red-400 flex items-center justify-center">
                        <span className="text-white text-[9px] font-bold">{o.name[0] || '적'}</span>
                      </div>
                    )}
                    <div className="leading-tight hidden sm:block">
                      <div className="text-[10px] font-bold text-red-300">{o.name.substring(0, 5)}</div>
                      <div className="text-[9px] text-slate-400">
                        {o.forfeited ? '포기' : o.finished ? `${o.finishMoves}턴 ✓` : '진행'}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              !isPractice && <span className="text-[10px] text-slate-500">상대 대기</span>
            )}

            {/* 탐지기 아이템 (확보 개수만큼 사용 가능) */}
            {nextRadarIndex >= 0 && !isFinished && (() => {
              const remaining = radarOwnItems.filter(
                (it, idx) => it.type === 'radar' && !radarOwnConsumed[idx]
              ).length;
              return (
                <button
                  className="btn-game px-2.5 py-1 text-[11px] !rounded-lg"
                  onClick={handleUseRadar}
                  title="내 주변 한 칸(대각선 포함)의 벽을 탐지합니다"
                >
                  🔍 탐지{remaining > 1 ? ` x${remaining}` : ''}
                </button>
              );
            })()}

            {/* 시점 전환 (관전/종료 시 1인칭 비활성) */}
            <div className="flex rounded-lg overflow-hidden border border-slate-600/70">
              {(['third', '2d'] as ViewMode[]).map((m) => (
                <button
                  key={m}
                  className={`px-2 py-1 text-[11px] font-bold transition-colors ${
                    effectiveViewMode === m
                      ? 'bg-amber-400 text-slate-900'
                      : 'bg-slate-800/80 text-slate-400 hover:text-white'
                  }`}
                  onClick={() => setViewMode(m)}
                >
                  {m === 'third' ? '3인칭' : '2D'}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* 메시지/배너 오버레이 */}
      <div className="absolute top-[74px] left-1/2 -translate-x-1/2 z-20 flex flex-col items-center gap-1.5 w-[96%] max-w-2xl pointer-events-none">
        {message && (
          <div
            className={`text-xs px-3 py-1 rounded-full border backdrop-blur-sm ${
              lastMoveValid === false
                ? 'bg-red-500/20 border-red-500/50 text-red-200 font-bold'
                : lastMoveValid === true
                  ? 'bg-green-500/20 border-green-500/50 text-green-200'
                  : 'bg-slate-800/80 border-slate-600/60 text-slate-200'
            }`}
          >
            {message}
          </div>
        )}

        {/* 관전 모드 안내 - 턴 수가 적은 쪽이 이기므로 아직 승부가 확정되지 않음 */}
        {spectating && (
          <div className="text-xs px-3 py-1.5 rounded-xl bg-purple-500/20 border border-purple-400/50 text-purple-100 font-medium backdrop-blur-sm">
            🏁 {myFinishMoves ?? moveCount}턴으로 완주했습니다! 상대방이 더 적은 턴으로 완주하면
            패배, 같은 턴이면 무승부입니다. (관전 중)
          </div>
        )}

        {/* 상대가 먼저 완주 -> 기록 도전 또는 포기 선택 */}
        {canForfeit && (
          <div className="text-xs px-3 py-1.5 rounded-xl bg-orange-500/20 border border-orange-400/50 text-orange-100 font-medium flex items-center gap-2 backdrop-blur-sm pointer-events-auto">
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
      </div>

      {/* 우측 상단 오버레이: 실시간 순위 + 미니맵 */}
      {(showRank || (!isPractice && !spectating && myMap && runnerPosition)) && (
      <div className="absolute top-[74px] right-2 z-20 flex flex-col items-end gap-1.5">
        {/* 실시간 순위 (마리오카트식) */}
        {showRank && (
          <div className={`game-panel !rounded-xl px-3 py-1.5 text-right ${
            myRank === 1 ? '!border-amber-400/60' : ''
          }`}>
            <div className="flex items-baseline justify-end gap-1 leading-none">
              <span className="text-[11px]">🏁</span>
              <span className={`text-2xl font-black ${
                myRank === 1 ? 'text-amber-300' : myRank === rankTotal ? 'text-red-300' : 'text-slate-200'
              }`}>
                {myRank}
              </span>
              <span className="text-[11px] font-bold text-slate-300">위</span>
              <span className="text-[10px] text-slate-500">/ {rankTotal}명</span>
            </div>
            <div className="text-[10px] text-slate-400 mt-0.5">
              {myFinished ? `${myFinishMoves ?? moveCount}턴 완주` : `이동 ${moveCount}턴`}
            </div>
          </div>
        )}

      {/* 미니맵 - 내가 만든 맵에서 상대방 플레이 (연습/관전 중에는 표시 안 함) */}
      {!isPractice && !spectating && myMap && runnerPosition && (
        <div>
          <div className="game-panel !rounded-xl p-2">
            <div className="text-[10px] text-slate-400 text-center mb-1 font-medium">
              내 맵 ({runnerInfo ? `${runnerInfo.name.substring(0, 5)} 진행` : '상대 진행'})
            </div>
            <GameBoard
              gamePhase={GamePhase.PLAY}
              startPosition={myMap.startPosition}
              endPosition={myMap.endPosition}
              playerPosition={runnerPosition}
              obstacles={myMap.obstacles}
              collisionWalls={opponentCollisionWalls}
              readOnly={true}
              isMinimapMode={true}
              playerPhotoURL={runnerInfo?.photoURL || undefined}
              items={myItems}
              itemsConsumed={myItemsConsumed}
            />
          </div>
        </div>
      )}
      </div>
      )}

      {/* 방향 패드 - 하단 중앙 오버레이 */}
      {!isFinished && (
        <div className="absolute bottom-8 left-1/2 -translate-x-1/2 z-20 flex flex-col items-center gap-1.5">
          <div className="grid grid-cols-3 gap-1">
            <div className="col-start-2">
              <button
                className="btn-dpad !w-12 !h-12 !bg-slate-900/70 backdrop-blur-sm"
                onClick={() => handleMove('up')}
                disabled={isFinished}
                title="위로 이동"
              >
                ↑
              </button>
            </div>
            <div className="col-start-1 row-start-2">
              <button
                className="btn-dpad !w-12 !h-12 !bg-slate-900/70 backdrop-blur-sm"
                onClick={() => handleMove('left')}
                disabled={isFinished}
                title="왼쪽으로 이동"
              >
                ←
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
                onClick={() => handleMove('right')}
                disabled={isFinished}
                title="오른쪽으로 이동"
              >
                →
              </button>
            </div>
            <div className="col-start-2 row-start-3">
              <button
                className="btn-dpad !w-12 !h-12 !bg-slate-900/70 backdrop-blur-sm"
                onClick={() => handleMove('down')}
                disabled={isFinished}
                title="아래로 이동"
              >
                ↓
              </button>
            </div>
          </div>
          <p className="text-[10px] text-slate-400/80 backdrop-blur-sm px-2 py-0.5 rounded-full bg-slate-900/40">
            ⌨️ 키보드 방향키로도 이동할 수 있습니다
          </p>
        </div>
      )}
    </div>
  );
};

export default GamePlay;
