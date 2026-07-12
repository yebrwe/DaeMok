'use client';

import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { CollisionWall, Direction, GameMap, GamePhase, GameState, Obstacle, Position } from '@/types/game';
import GameBoard from './GameBoard';
import GameBoard3D, { BoardFx } from './three/GameBoard3D';
import LiveBoardGrid, { LiveBoardEntry } from './LiveBoardGrid';
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, ScanSearch } from 'lucide-react';
import { BOARD_SIZE, canMove, getNewPosition, isPositionInBoard, isSamePosition, findBlockingOneTimeWall, getMapItems } from '@/lib/gameUtils';
import {
  appendTurnPosition,
  findRadarWalls,
  isVisionObscuredForPlayer,
  mergeWallSegments,
  MoveTurnOutcome,
  normalizeConsumed,
  RadarTurnOutcome,
  resolveTurnAction,
} from '@/lib/gameTurn';
import { getDatabase, ref, update, runTransaction, serverTimestamp } from 'firebase/database';
import { getAuth } from 'firebase/auth';

interface GamePlayProps {
  map: GameMap;
  onGameComplete?: (moves: number) => void;
  userId: string;
  roomId: string;
  gameState?: GameState;
  myMap?: GameMap; // 내가 만든 맵 정보 (탐지기 보유량 확인용)
  gameEnded?: boolean; // 게임 종료 여부
  isPractice?: boolean; // 연습 모드 (Firebase 사용 안 함)
  myFinished?: boolean; // 내가 이미 완주함 -> 관전 모드
  myFinishMoves?: number | null; // 내 완주 턴 수
  opponentFinished?: boolean; // 누군가 먼저 완주함 -> 포기 가능
  opponentFinishMoves?: number | null; // 완주자 중 최소 턴 수 (이걸 이겨야 승리)
  onForfeit?: () => void; // 포기 처리
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
  gameState,
  myMap,
  gameEnded = false,
  isPractice: isPracticeProp = false,
  myFinished = false,
  myFinishMoves = null,
  opponentFinished = false,
  opponentFinishMoves = null,
  onForfeit,
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
  const [collisionWalls, setCollisionWalls] = useState<CollisionWall[]>([]);
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
  const [myItemsConsumed, setMyItemsConsumed] = useState<Record<number, boolean>>({}); // 내 맵의 자기용 아이템

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
  const currentTurnId = gameState?.currentTurn ?? null;
  const isMyTurn = isPractice || currentTurnId === userId;
  const currentTurnName = currentTurnId === userId
    ? playerName
    : gameState?.players?.[currentTurnId || '']?.displayName || '상대방';

  // 포기 가능: 상대가 먼저 골인했고 나는 아직 완주하지 못함
  const canForfeit = !isPractice && !iAmDone && opponentFinished && !gameEnded && !!onForfeit;
  const effectiveViewMode: ViewMode = viewMode;

  // 상위 방 구독에서 받은 위치, 턴 수, 이력을 따라가 다중 탭에서도 같은 상태를 유지한다.
  useEffect(() => {
    if (isPractice) return;
    const player = gameState?.players?.[userId];
    const position = player?.position;
    if (position) setPlayerPosition(position);
    if (typeof player?.moves === 'number') setMoveCount(player.moves);
    if (Array.isArray(player?.positionHistory) && player.positionHistory.length > 0) {
      positionHistoryRef.current = player.positionHistory;
    } else if (position) {
      positionHistoryRef.current = [position];
    }

    const ownerId = gameState?.assignments?.[userId];
    setItemsConsumed(normalizeConsumed(ownerId ? gameState?.itemState?.[ownerId]?.consumed : null));
    setMyItemsConsumed(normalizeConsumed(gameState?.itemState?.[userId]?.consumed));
  }, [gameState, userId, isPractice]);

  // 아이템 소모 처리 (내가 플레이하는 맵의 주인이 설치한 아이템, 인덱스별)
  const consumeOpponentItem = useCallback((index: number) => {
    setItemsConsumed((prev) => ({ ...prev, [index]: true }));
  }, []);

  // 탐지기 사용 - 내 주변 한 칸(대각선 포함, 3x3)의 벽을 탐지
  // 일반 벽 + 아직 부서지지 않은 1회성 벽(일반 벽으로 위장되어 표시)을 찾아냄. 지뢰/웜홀은 탐지 불가.
  // 탐지기를 여러 개 확보했으면 그 수만큼 사용 가능
  const handleUseRadar = useCallback(async () => {
    if (nextRadarIndex < 0 || isFinished) return;
    const usedIndex = nextRadarIndex;
    if (isPractice) {
      const found = findRadarWalls(playerPosition, map, itemsConsumed);
      setRevealedWalls((prev) => mergeWallSegments(prev, found));
      setItemsConsumed((prev) => ({ ...prev, [usedIndex]: true }));
      const nextCount = moveCount + 1;
      setMoveCount(nextCount);
      positionHistoryRef.current = appendTurnPosition(positionHistoryRef.current, playerPosition, playerPosition);
      setMessage(`주변을 탐지했습니다. 벽 ${found.length}개 발견, 1턴 사용`);
      fireFx({ type: 'radar', at: playerPosition });
      return;
    }

    if (!isMyTurn) {
      setMessage(`${currentTurnName}의 턴입니다.`);
      return;
    }
    if (movePendingRef.current) return;

    movePendingRef.current = true;
    let outcome: RadarTurnOutcome | null = null;

    try {
      const database = getDatabase();
      const gameStateRef = ref(database, `rooms/${roomId}/gameState`);
      const result = await runTransaction(gameStateRef, (state: GameState | null) => {
        const resolved = resolveTurnAction(state, userId, { type: 'radar', itemIndex: usedIndex });
        if (!resolved || resolved.outcome.type !== 'radar') return;
        outcome = resolved.outcome;
        return resolved.state;
      }, { applyLocally: false });

      if (!result.committed || !outcome) {
        setMessage('이미 턴이 넘어갔거나 탐지기를 사용할 수 없습니다.');
        return;
      }

      const committed = outcome as RadarTurnOutcome;
      setRevealedWalls((prev) => mergeWallSegments(prev, committed.found));
      setMyItemsConsumed((prev) => ({ ...prev, [usedIndex]: true }));
      setMoveCount(committed.moves);
      setMessage(`탐지기로 벽 ${committed.found.length}개를 찾았습니다. 1턴을 사용했습니다.`);
      fireFx({ type: 'radar', at: committed.position });
      update(ref(database, `rooms/${roomId}`), { lastActivity: serverTimestamp() }).catch(() => {});
    } catch (error) {
      console.error('탐지기 턴 처리 오류:', error);
      setMessage('탐지기 사용을 처리하지 못했습니다.');
    } finally {
      movePendingRef.current = false;
    }
  }, [nextRadarIndex, isFinished, isPractice, playerPosition, map, itemsConsumed, moveCount, isMyTurn, currentTurnName, roomId, userId, fireFx]);

  // 사용자 프로필은 이미 구독 중인 방 상태와 인증 세션에서 가져온다.
  useEffect(() => {
    if (isPractice) return;
    const authUser = getAuth().currentUser;
    const player = gameState?.players?.[userId];
    setPlayerPhotoURL(player?.photoURL || authUser?.photoURL || null);
    setPlayerName(player?.displayName || authUser?.displayName || '나');
  }, [gameState?.players, userId, isPractice]);

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

  const handleOnlineMove = useCallback(async (direction: Direction) => {
    if (isFinished || movePendingRef.current) return;
    if (!isMyTurn) {
      setMessage(`${currentTurnName}의 턴입니다. 차례를 기다려주세요.`);
      return;
    }
    if (!isPositionInBoard(getNewPosition(playerPosition, direction))) {
      setLastMoveValid(null);
      setMessage('보드 밖으로는 이동할 수 없습니다.');
      return;
    }

    movePendingRef.current = true;
    let outcome: MoveTurnOutcome | null = null;

    try {
      const database = getDatabase();
      const gameStateRef = ref(database, `rooms/${roomId}/gameState`);
      const result = await runTransaction(gameStateRef, (state: GameState | null) => {
        const resolved = resolveTurnAction(state, userId, { type: 'move', direction });
        if (!resolved || resolved.outcome.type !== 'move') return;
        outcome = resolved.outcome;
        return resolved.state;
      }, { applyLocally: false });

      if (!result.committed || !outcome) {
        setMessage('이미 턴이 넘어갔거나 실행할 수 없는 이동입니다.');
        return;
      }

      const committed = outcome as MoveTurnOutcome;
      setMoveCount(committed.moves);
      setPlayerPosition(committed.position);
      setLastMoveValid(
        committed.effect === 'move' || committed.effect === 'smoke'
          ? true
          : committed.effect === 'wormhole'
            ? null
            : false
      );
      setMessage(committed.message);
      if (committed.consumedItemIndex !== null) {
        setItemsConsumed((prev) => ({ ...prev, [committed.consumedItemIndex!]: true }));
      }

      if (committed.effect === 'bump') {
        setMoveVia(null);
        fireFx({ type: 'bump', at: committed.origin, dir: direction });
      } else if (committed.effect === 'mine') {
        setMoveVia([committed.attempted, committed.origin]);
        fireFx({ type: 'mine', at: committed.itemPosition, delay: 0.35 });
      } else if (committed.effect === 'wormhole') {
        setMoveVia([committed.attempted]);
        fireFx({ type: 'wormhole', at: committed.itemPosition, to: committed.wormholeExit, delay: 0.35 });
      } else {
        setMoveVia(null);
      }

      update(ref(database, `rooms/${roomId}`), { lastActivity: serverTimestamp() }).catch(() => {});
      if (committed.reachedGoal) {
        setGameOver(true);
        setMessage(`${committed.moves}턴 만에 도착지에 도달했습니다.`);
        fireFx({ type: 'goal', at: committed.position });
        onGameComplete?.(committed.moves);
      }
    } catch (error) {
      console.error('온라인 턴 처리 오류:', error);
      setMessage('턴을 처리하지 못했습니다. 다시 시도해주세요.');
    } finally {
      movePendingRef.current = false;
    }
  }, [isFinished, isMyTurn, currentTurnName, playerPosition, roomId, userId, onGameComplete, fireFx]);

  // 연습 모드는 즉시 로컬 처리하고, 온라인 게임은 서버 트랜잭션으로 한 행동씩 교대한다.
  const handleMove = useCallback(
    async (direction: Direction) => {
      if (isFinished) return;
      if (movePendingRef.current) return;

      if (!isPractice) {
        await handleOnlineMove(direction);
        return;
      }

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
          mapOwnerId: 'practice',
        };
        setCollisionWalls((prev) => [...prev, disguisedCollision]);
        positionHistoryRef.current = appendTurnPosition(positionHistoryRef.current, playerPosition, playerPosition);
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
            mapOwnerId: 'practice',
          };
          setCollisionWalls((prev) => [...prev, newCollisionWall]);
          positionHistoryRef.current = appendTurnPosition(positionHistoryRef.current, playerPosition, playerPosition);
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
      userId,
      onGameComplete,
      items,
      itemsConsumed,
      consumeOpponentItem,
      fireFx,
      handleOnlineMove,
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

  useEffect(() => {
    if (!isPractice) {
      setRevealedWalls(gameState?.revealedWallsByPlayer?.[userId] || []);
    }
  }, [gameState?.revealedWallsByPlayer, isPractice, userId]);

  useEffect(() => {
    if (!isPractice && gameState?.turnMessage) {
      setMessage(gameState.turnMessage);
      setLastMoveValid(null);
    }
  }, [gameState?.turnMessage, gameState?.turnMessageTimestamp, isPractice]);

  const liveBoards = useMemo<LiveBoardEntry[]>(() => {
    if (isPractice || !gameState) return [];

    const players = gameState.players || {};
    const ordered = (gameState.turnOrder || Object.keys(players)).filter((id) => !!players[id]);
    const runnerIds = [userId, ...ordered.filter((id) => id !== userId)].slice(0, 4);
    const wallList = Object.values(gameState.collisionWalls || {}).filter(Boolean) as CollisionWall[];

    return runnerIds.flatMap((runnerId, index) => {
      const runner = players[runnerId];
      const ownerId = gameState.assignments?.[runnerId];
      const runnerMap = ownerId ? gameState.maps?.[ownerId] : null;
      if (!runner || !ownerId || !runnerMap) return [];

      const isMine = runnerId === userId;
      return [{
        runnerId,
        runnerName: runner.displayName || (isMine ? playerName : `플레이어 ${index + 1}`),
        runnerPhotoURL: runner.photoURL || null,
        mapOwnerId: ownerId,
        mapOwnerName: players[ownerId]?.displayName || null,
        map: runnerMap,
        position: isMine ? playerPosition : (runner.position || runnerMap.startPosition),
        moves: isMine ? moveCount : (runner.moves || 0),
        finished: !!runner.finished,
        finishMoves: runner.finishMoves ?? null,
        forfeited: !!runner.forfeited,
        collisions: wallList.filter(
          (wall) => wall.playerId === runnerId && wall.mapOwnerId === ownerId
        ),
        itemsConsumed: normalizeConsumed(gameState.itemState?.[ownerId]?.consumed),
        revealedWalls: isMine
          ? revealedWalls
          : (gameState.revealedWallsByPlayer?.[runnerId] || []),
        fx: isMine ? fx : null,
        via: isMine ? moveVia : null,
        celebrating: !!runner.finished && !runner.forfeited,
        revealObstacles: !!runner.finished,
        pawnColor: isMine ? '#3b82f6' : '#ef4444',
        smokeAffected: isVisionObscuredForPlayer(gameState, runnerId),
        visionObscured:
          isMine &&
          currentTurnId === runnerId &&
          isVisionObscuredForPlayer(gameState, runnerId),
      }];
    });
  }, [isPractice, gameState, userId, playerName, playerPosition, moveCount, revealedWalls, fx, moveVia, currentTurnId]);

  const renderDirectionPad = (compact: boolean) => {
    const sizeClass = compact ? '!h-9 !w-9 sm:!h-10 sm:!w-10' : '!h-12 !w-12';
    const iconSize = compact ? 17 : 21;
    const disabled = isFinished || !isMyTurn;
    const moveButton = (direction: Direction, label: string, Icon: typeof ArrowUp) => (
      <button
        className={`btn-dpad ${sizeClass} !bg-slate-950/80 backdrop-blur-sm`}
        onClick={() => handleMove(direction)}
        disabled={disabled}
        title={label}
        aria-label={label}
      >
        <Icon size={iconSize} aria-hidden="true" />
      </button>
    );

    if (compact) {
      return (
        <div className="pointer-events-auto absolute bottom-2 left-1/2 flex -translate-x-1/2 gap-1">
          {moveButton('left', '왼쪽으로 이동', ArrowLeft)}
          {moveButton('up', '위로 이동', ArrowUp)}
          {moveButton('down', '아래로 이동', ArrowDown)}
          {moveButton('right', '오른쪽으로 이동', ArrowRight)}
        </div>
      );
    }

    return (
      <div className={`pointer-events-auto absolute left-1/2 -translate-x-1/2 ${compact ? 'bottom-2' : 'bottom-8'}`}>
        <div className="grid grid-cols-3 gap-1">
          <div className="col-start-2">{moveButton('up', '위로 이동', ArrowUp)}</div>
          <div className="col-start-1 row-start-2">{moveButton('left', '왼쪽으로 이동', ArrowLeft)}</div>
          <div className="col-start-2 row-start-2">
            <div className={`${sizeClass.replaceAll('!', '')} flex items-center justify-center rounded-lg border border-slate-700/60 bg-slate-950/70 backdrop-blur-sm`}>
              <div className={`h-2 w-2 rounded-full ${isMyTurn && !isFinished ? 'animate-pulse bg-amber-400' : 'bg-slate-600'}`} />
            </div>
          </div>
          <div className="col-start-3 row-start-2">{moveButton('right', '오른쪽으로 이동', ArrowRight)}</div>
          <div className="col-start-2 row-start-3">{moveButton('down', '아래로 이동', ArrowDown)}</div>
        </div>
      </div>
    );
  };

  return (
    <div className="absolute inset-0 overflow-hidden">
      {/* 연습은 단일 보드, 온라인은 모든 주자의 맵을 최대 4개까지 동시에 표시한다. */}
      {!isPractice ? (
        <LiveBoardGrid
          boards={liveBoards}
          currentTurnId={currentTurnId}
          myPlayerId={userId}
          viewMode={effectiveViewMode}
          gameEnded={gameEnded}
          className="absolute inset-0 px-2 pb-2 pt-[72px]"
          emptyState={<span className="text-sm text-slate-400">보드 동기화 중</span>}
          renderOverlay={(board) => board.runnerId === userId && !isFinished ? renderDirectionPad(true) : null}
        />
      ) : effectiveViewMode !== '2d' ? (
        <GameBoard3D
          gamePhase={GamePhase.PLAY}
          startPosition={startPosition}
          endPosition={endPosition}
          playerPosition={playerPosition}
          obstacles={obstacles}
          collisionWalls={collisionWalls}
          readOnly={true}
          revealObstacles={isFinished}
          revealItems={isFinished}
          distinguishOneTimeWalls={isFinished}
          items={items}
          itemsConsumed={itemsConsumed}
          revealedWalls={revealedWalls}
          fx={fx}
          pawnVia={moveVia}
          celebrating={iAmDone}
          fullscreen
        />
      ) : (
        <div className="absolute inset-0 flex items-center justify-center overflow-auto py-24 bg-gradient-to-b from-slate-800 via-slate-900 to-slate-950">
          <GameBoard
            gamePhase={GamePhase.PLAY}
            startPosition={startPosition}
            endPosition={endPosition}
            playerPosition={playerPosition}
            obstacles={obstacles}
            collisionWalls={collisionWalls}
            readOnly={true}
            playerPhotoURL={playerPhotoURL || undefined}
            revealObstacles={isFinished}
            revealItems={isFinished}
            distinguishOneTimeWalls={isFinished}
            items={items}
            itemsConsumed={itemsConsumed}
            revealedWalls={revealedWalls}
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
              <div className="text-[10px] text-slate-400">턴: {moveCount}</div>
            </div>
          </div>

          {/* 중앙 상태 */}
          <div className="flex flex-col items-center gap-1">
            <span className="text-[10px] text-slate-500 font-bold">TURN {gameState?.turnNumber || 1}</span>
            {gameEnded ? (
              <span className="px-2.5 py-1 rounded-full text-xs font-bold bg-green-400/15 text-green-300 border border-green-400/40">종료</span>
            ) : iAmDone ? (
              <span className="px-2.5 py-1 rounded-full text-xs font-bold bg-purple-400/15 text-purple-300 border border-purple-400/40">관전 중</span>
            ) : isMyTurn ? (
              <span className="badge-turn">내 턴</span>
            ) : (
              <span className="px-2.5 py-1 rounded-full text-xs font-bold bg-slate-700/80 text-slate-200 border border-slate-500/60">
                {currentTurnName.substring(0, 7)} 턴
              </span>
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
                      currentTurnId === o.id && !gameEnded ? 'bg-amber-400/15 ring-1 ring-amber-300/70' : 'opacity-70'
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
                        {o.forfeited ? '포기' : o.finished ? `${o.finishMoves}턴 ✓` : `${o.moves || 0}턴`}
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
                  disabled={!isMyTurn}
                  title="내 주변 한 칸(대각선 포함)의 벽을 탐지합니다"
                >
                  <ScanSearch size={14} aria-hidden="true" />
                  탐지{remaining > 1 ? ` x${remaining}` : ''}
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
      <div className="absolute top-[110px] left-1/2 -translate-x-1/2 z-20 flex flex-col items-center gap-1.5 w-[96%] max-w-2xl pointer-events-none">
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
        {!isPractice && iAmDone && !gameEnded && (
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

      {/* 우측 상단 오버레이: 실시간 순위 */}
      {showRank && (
      <div className="absolute top-[110px] right-2 z-20">
        {(
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
              {myFinished ? `${myFinishMoves ?? moveCount}턴 완주` : `${moveCount}턴 사용`}
            </div>
          </div>
        )}
      </div>
      )}

      {isPractice && !isFinished && renderDirectionPad(false)}
    </div>
  );
};

export default GamePlay;
