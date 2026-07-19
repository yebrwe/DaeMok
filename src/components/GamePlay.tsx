'use client';

import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import Image from 'next/image';
import { CollisionWall, Direction, GameMap, GameState, MazeSkillId, Obstacle, Position } from '@/types/game';
import type { BoardFx } from './three/GameBoard3D';
import LiveBoardGrid, { LiveBoardEntry } from './LiveBoardGrid';
import MobileDirectionPad from './MobileDirectionPad';
import { useSwipeMove } from '@/hooks/useSwipeMove';
import { Anchor, ArrowDown, ArrowLeft, ArrowRight, ArrowUp, FastForward, Gamepad2, ScanSearch, ShieldAlert } from 'lucide-react';
import { getNewPosition, isPositionInBoard, isSamePosition, getMapItems } from '@/lib/gameUtils';
import {
  getPlayerMazeSkillState,
  isVisionObscuredForPlayer,
  mergeWallSegments,
  MoveTurnOutcome,
  normalizeConsumed,
  RadarTurnOutcome,
  resolveTurnAction,
  SkillTurnOutcome,
} from '@/lib/gameTurn';
import { MAZE_SKILL_DEFINITIONS } from '@/lib/mazeSkills';
import {
  createLocalBoardVisualRoute,
  deriveLiveBoardVisualTransition,
  getActiveLocalBoardVia,
  LocalBoardVisualRoute,
  LiveBoardVisualTransition,
} from '@/lib/liveBoardVisuals';
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
  myFinished?: boolean; // 내가 이미 완주함 -> 관전 모드
  myFinishMoves?: number | null; // 내 완주 턴 수
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

const SKILL_ICONS: Record<MazeSkillId, typeof ScanSearch> = {
  scoutPulse: ScanSearch,
  breach: ShieldAlert,
  anchor: Anchor,
  dash: FastForward,
};

function removeTransientMaps(state: GameState): GameState {
  const persistentState = { ...state };
  delete persistentState.maps;
  return persistentState;
}

const GamePlay: React.FC<GamePlayProps> = ({
  map,
  onGameComplete,
  userId,
  roomId,
  gameState,
  myMap,
  gameEnded = false,
  myFinished = false,
  myFinishMoves = null,
  othersInfo = [],
}) => {
  const startPosition = map?.startPosition ?? { row: 0, col: 0 };

  const [playerPosition, setPlayerPosition] = useState<Position>(startPosition);
  const [moveCount, setMoveCount] = useState<number>(0);
  const [gameOver, setGameOver] = useState<boolean>(false);
  const [lastMoveValid, setLastMoveValid] = useState<boolean | null>(null);
  const [message, setMessage] = useState<string>('');
  const [playerPhotoURL, setPlayerPhotoURL] = useState<string | null>(null);
  const [playerName, setPlayerName] = useState<string>('나');
  // 액션 이펙트 (지뢰 폭발/웜홀/탐지 파동/충돌 스파크/골인 축포)
  const [fx, setFx] = useState<BoardFx | null>(null);
  // 경유지는 목적지와 개인 턴 수가 일치하는 한 액션에서만 사용한다.
  const [localVisualRoute, setLocalVisualRoute] = useState<LocalBoardVisualRoute | null>(null);
  const [remoteVisuals, setRemoteVisuals] = useState<Record<string, LiveBoardVisualTransition>>({});
  const [armedSkill, setArmedSkill] = useState<'breach' | 'dash' | null>(null);
  const [skillNotice, setSkillNotice] = useState<string>('');
  // 모바일 하단 방향패드 표시 여부
  const [padVisible, setPadVisible] = useState(true);
  const boardStageRef = useRef<HTMLDivElement>(null);
  const queuedMoveRef = useRef<Direction | null>(null);
  const handleMoveRef = useRef<(direction: Direction) => void>(() => {});

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem('daemok:mobilePad');
      if (saved === '0') setPadVisible(false);
    } catch {
      /* localStorage 접근 불가 - 기본값 유지 */
    }
  }, []);

  const togglePad = useCallback(() => {
    setPadVisible((prev) => {
      const next = !prev;
      try {
        window.localStorage.setItem('daemok:mobilePad', next ? '1' : '0');
      } catch {
        /* 무시 */
      }
      return next;
    });
  }, []);
  const fxKeyRef = useRef(0);
  const previousVisualStateRef = useRef<GameState | null>(null);
  const remoteVisualSequenceRef = useRef(0);
  const fireFx = useCallback((partial: Omit<BoardFx, 'key'>) => {
    fxKeyRef.current += 1;
    setFx({ key: fxKeyRef.current, ...partial });
  }, []);

  // Firebase의 연속 스냅샷만 비교해 상대 행동을 복원한다. 별도 gameplay write는 만들지 않는다.
  useEffect(() => {
    const previous = previousVisualStateRef.current;
    previousVisualStateRef.current = gameState || null;
    if (!gameState) {
      remoteVisualSequenceRef.current = 0;
      setRemoteVisuals({});
      return;
    }
    if (!previous) return;

    const restarted =
      previous.matchNumber !== gameState.matchNumber ||
      (gameState.turnNumber || 0) < (previous.turnNumber || 0);
    if (restarted) {
      remoteVisualSequenceRef.current = 0;
      setRemoteVisuals({});
      return;
    }

    const turnDelta = (gameState.turnNumber || 0) - (previous.turnNumber || 0);
    if (turnDelta > 1) {
      // 백그라운드 복귀 등으로 여러 행동이 합쳐지면 연출을 추측하지 않는다.
      setRemoteVisuals({});
      return;
    }
    if (turnDelta !== 1) return;

    const runnerId = previous.currentTurn;
    if (!runnerId || runnerId === userId) return;
    const nextSequence = remoteVisualSequenceRef.current + 1;
    const transition = deriveLiveBoardVisualTransition(
      previous,
      gameState,
      runnerId,
      nextSequence
    );
    if (!transition) return;

    remoteVisualSequenceRef.current = nextSequence;
    setRemoteVisuals((current) => ({ ...current, [runnerId]: transition }));
  }, [gameState, userId]);

  // 이동 처리 중 중복 입력 방지 (연타로 한 턴에 두 번 움직이는 버그 방지)
  const movePendingRef = useRef<boolean>(false);
  const releaseActionLock = useCallback(() => {
    movePendingRef.current = false;
    const queuedDirection = queuedMoveRef.current;
    queuedMoveRef.current = null;
    if (queuedDirection) {
      window.setTimeout(() => handleMoveRef.current(queuedDirection), 0);
    }
  }, []);

  // 탐지기는 내가 만든 맵에 배치한 자기용 아이템 상태를 사용한다.
  const myItems = useMemo(() => getMapItems(myMap), [myMap]);
  const [myItemsConsumed, setMyItemsConsumed] = useState<Record<number, boolean>>({}); // 내 맵의 자기용 아이템

  // 탐지기(자기용 아이템): 내 셋업에서 확보한 개수만큼 사용 가능
  const nextRadarIndex = myItems.findIndex(
    (it, idx) => it.type === 'radar' && !myItemsConsumed[idx]
  );
  const mazeSkill = useMemo(
    () => getPlayerMazeSkillState(gameState, userId, myMap),
    [gameState, userId, myMap]
  );
  const equippedSkill = mazeSkill.loadout[0];
  const skillConsumed = !equippedSkill || !!mazeSkill.consumed[equippedSkill];
  const SkillIcon = equippedSkill ? SKILL_ICONS[equippedSkill] : ScanSearch;
  // 탐지기로 밝혀낸 벽들 (일반 벽 + 위장된 1회성 벽)
  const [revealedWalls, setRevealedWalls] = useState<Obstacle[]>([]);

  const iAmDone = gameOver || myFinished; // 내가 골인했음 (게임은 계속될 수 있음)
  const isFinished = iAmDone || gameEnded;
  const currentTurnId = gameState?.currentTurn ?? null;
  const immutableMaps = gameState?.maps;
  const isMyTurn = currentTurnId === userId;
  const currentTurnName = currentTurnId === userId
    ? playerName
    : gameState?.players?.[currentTurnId || '']?.displayName || '상대방';
  const moveVia = getActiveLocalBoardVia(localVisualRoute, playerPosition, moveCount);

  // 상위 방 구독의 위치와 턴 수를 따라가 다중 탭에서도 같은 상태를 유지한다.
  useEffect(() => {
    const player = gameState?.players?.[userId];
    const position = player?.position;
    if (position) setPlayerPosition(position);
    if (typeof player?.moves === 'number') setMoveCount(player.moves);

    setMyItemsConsumed(normalizeConsumed(gameState?.itemState?.[userId]?.consumed));
  }, [gameState, userId]);

  // 탐지기 사용 - 내 주변 한 칸(대각선 포함, 3x3)의 벽을 탐지
  // 일반 벽 + 아직 부서지지 않은 1회성 벽(일반 벽으로 위장되어 표시)을 찾아냄. 지뢰/웜홀은 탐지 불가.
  // 탐지기를 여러 개 확보했으면 그 수만큼 사용 가능
  const handleUseRadar = useCallback(async () => {
    if (nextRadarIndex < 0 || isFinished) return;
    const usedIndex = nextRadarIndex;
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
        if (!state || !immutableMaps) return;
        const resolved = resolveTurnAction(
          { ...state, maps: immutableMaps },
          userId,
          { type: 'radar', itemIndex: usedIndex }
        );
        if (!resolved || resolved.outcome.type !== 'radar') return;
        outcome = resolved.outcome;
        return removeTransientMaps(resolved.state);
      }, { applyLocally: false });

      if (!result.committed || !outcome) {
        setMessage('이미 턴이 넘어갔거나 탐지기를 사용할 수 없습니다.');
        return;
      }

      const committed = outcome as RadarTurnOutcome;
      setRevealedWalls((prev) => mergeWallSegments(prev, committed.found));
      setMyItemsConsumed((prev) => ({ ...prev, [usedIndex]: true }));
      setMoveCount(committed.moves);
      setLocalVisualRoute(null);
      setMessage(`탐지기로 벽 ${committed.found.length}개를 찾았습니다. 1턴을 사용했습니다.`);
      fireFx({ type: 'radar', at: committed.position });
      update(ref(database, `rooms/${roomId}`), { lastActivity: serverTimestamp() }).catch(() => {});
    } catch (error) {
      console.error('탐지기 턴 처리 오류:', error);
      setMessage('탐지기 사용을 처리하지 못했습니다.');
    } finally {
      releaseActionLock();
    }
  }, [nextRadarIndex, isFinished, isMyTurn, currentTurnName, roomId, userId, fireFx, immutableMaps, releaseActionLock]);

  // 사용자 프로필은 이미 구독 중인 방 상태와 인증 세션에서 가져온다.
  useEffect(() => {
    const authUser = getAuth().currentUser;
    const player = gameState?.players?.[userId];
    setPlayerPhotoURL(player?.photoURL || authUser?.photoURL || null);
    setPlayerName(player?.displayName || authUser?.displayName || '나');
  }, [gameState?.players, userId]);

  // 실시간 순위 (마리오카트식): 완주자는 확정 턴, 진행 중은 현재 턴 기준.
  // 과거 데이터의 미완주 기록은 호환용으로만 제외한다.
  // 턴 수가 적을수록 상위. 동률은 같은 순위
  const myRankMetric = myFinished ? (myFinishMoves ?? moveCount) : moveCount;
  const rankedOthers = othersInfo.filter((o) => !o.forfeited);
  const leadingFinishMoves = rankedOthers.reduce<number | null>((best, opponent) => {
    if (!opponent.finished || typeof opponent.finishMoves !== 'number') return best;
    return best === null ? opponent.finishMoves : Math.min(best, opponent.finishMoves);
  }, null);
  const myRank =
    1 +
    rankedOthers.filter((o) => {
      const metric = o.finished ? (o.finishMoves ?? Number.MAX_SAFE_INTEGER) : (o.moves ?? 0);
      return metric < myRankMetric;
    }).length;
  const rankTotal = rankedOthers.length + 1;
  const showRank = !gameEnded && othersInfo.length > 0;
  const mobileStatusText = skillNotice
    || message
    || (iAmDone && !gameEnded
      ? `${myFinishMoves ?? moveCount}턴 완주 · 관전 중`
      : !iAmDone && !gameEnded && leadingFinishMoves !== null
        ? `현재 최고 기록 ${leadingFinishMoves}턴`
        : '');

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
        if (!state || !immutableMaps) return;
        const resolved = resolveTurnAction(
          { ...state, maps: immutableMaps },
          userId,
          { type: 'move', direction }
        );
        if (!resolved || resolved.outcome.type !== 'move') return;
        outcome = resolved.outcome;
        return removeTransientMaps(resolved.state);
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

      if (committed.effect === 'bump') {
        setLocalVisualRoute(createLocalBoardVisualRoute(
          committed.wallEffect === 'thornWall' && !isSamePosition(committed.position, committed.origin)
            ? [committed.origin]
            : null,
          committed.position,
          committed.moves
        ));
        fireFx({ type: 'bump', at: committed.origin, dir: direction });
      } else if (committed.effect === 'mine') {
        setLocalVisualRoute(createLocalBoardVisualRoute(
          [committed.attempted, committed.origin],
          committed.position,
          committed.moves
        ));
        fireFx({ type: 'mine', at: committed.itemPosition, delay: 0.35 });
      } else if (committed.effect === 'wormhole') {
        setLocalVisualRoute(createLocalBoardVisualRoute(
          [committed.attempted],
          committed.position,
          committed.moves
        ));
        fireFx({ type: 'wormhole', at: committed.itemPosition, to: committed.wormholeExit, delay: 0.35 });
      } else if (
        (committed.wallEffect === 'iceWall' ||
          committed.wallEffect === 'windWall' ||
          committed.wallEffect === 'mirrorWall') &&
        !isSamePosition(committed.position, committed.attempted)
      ) {
        setLocalVisualRoute(createLocalBoardVisualRoute(
          [committed.attempted],
          committed.position,
          committed.moves
        ));
      } else {
        setLocalVisualRoute(null);
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
      releaseActionLock();
    }
  }, [isFinished, isMyTurn, currentTurnName, playerPosition, roomId, userId, onGameComplete, fireFx, immutableMaps, releaseActionLock]);

  const handleOnlineSkill = useCallback(async (
    skillId: Exclude<MazeSkillId, 'anchor'>,
    direction?: Direction
  ): Promise<boolean> => {
    if (isFinished || movePendingRef.current || !isMyTurn) return false;
    movePendingRef.current = true;
    let outcome: SkillTurnOutcome | null = null;

    try {
      const database = getDatabase();
      const gameStateRef = ref(database, `rooms/${roomId}/gameState`);
      const result = await runTransaction(gameStateRef, (state: GameState | null) => {
        if (!state || !immutableMaps) return;
        const resolved = resolveTurnAction(
          { ...state, maps: immutableMaps },
          userId,
          { type: 'skill', skillId, direction }
        );
        if (!resolved || resolved.outcome.type !== 'skill') return;
        outcome = resolved.outcome;
        return removeTransientMaps(resolved.state);
      }, { applyLocally: false });

      if (!result.committed || !outcome) return false;

      const committed = outcome as SkillTurnOutcome;
      setMoveCount(committed.moves);
      setPlayerPosition(committed.position);
      setLocalVisualRoute(createLocalBoardVisualRoute(
        committed.via,
        committed.position,
        committed.moves
      ));
      setLastMoveValid(
        committed.skillId === 'scoutPulse' || committed.landingEffect === 'wormhole'
          ? null
          : committed.landingEffect === 'mine'
            ? false
            : true
      );
      setMessage(committed.message);
      if (committed.found) {
        setRevealedWalls((previous) => mergeWallSegments(previous, committed.found || []));
      }
      if (committed.skillId === 'scoutPulse') {
        fireFx({ type: 'radar', at: committed.position });
      } else if (committed.landingEffect === 'mine') {
        fireFx({ type: 'mine', at: committed.itemPosition, delay: 0.35 });
      } else if (committed.landingEffect === 'wormhole') {
        fireFx({
          type: 'wormhole',
          at: committed.itemPosition,
          to: committed.wormholeExit,
          delay: 0.35,
        });
      }

      update(ref(database, `rooms/${roomId}`), { lastActivity: serverTimestamp() }).catch(() => {});
      if (committed.reachedGoal) {
        setGameOver(true);
        setMessage(`${committed.moves}턴 만에 도착지에 도달했습니다.`);
        fireFx({ type: 'goal', at: committed.position });
        onGameComplete?.(committed.moves);
      }
      return true;
    } catch (error) {
      console.error('온라인 스킬 처리 오류:', error);
      setMessage('스킬을 처리하지 못했습니다.');
      return false;
    } finally {
      releaseActionLock();
    }
  }, [fireFx, immutableMaps, isFinished, isMyTurn, onGameComplete, releaseActionLock, roomId, userId]);

  const handleMove = useCallback(
    async (direction: Direction) => {
      if (isFinished) return;
      if (movePendingRef.current) {
        queuedMoveRef.current = direction;
        return;
      }
      if (armedSkill) {
        const succeeded = await handleOnlineSkill(armedSkill, direction);
        setArmedSkill(null);
        setSkillNotice(succeeded ? '' : '그 방향으로는 스킬을 사용할 수 없습니다.');
        return;
      }
      setSkillNotice('');
      await handleOnlineMove(direction);
    },
    [
      armedSkill,
      handleOnlineMove,
      handleOnlineSkill,
      isFinished,
    ]
  );

  // 키보드 이벤트 처리 - ref로 항상 최신 핸들러를 사용 (stale closure 방지)
  // 보드 스테이지 스와이프로 이동 (내 턴 가드는 handleMove 내부에서 처리)
  useSwipeMove(boardStageRef, handleMove, { enabled: !isFinished });

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

  // 상위 방의 종료 상태를 로컬 HUD에도 반영한다.
  useEffect(() => {
    if (gameEnded) {
      setGameOver(true);
    }
  }, [gameEnded]);

  useEffect(() => {
    setRevealedWalls(gameState?.revealedWallsByPlayer?.[userId] || []);
  }, [gameState?.revealedWallsByPlayer, userId]);

  useEffect(() => {
    if (gameState?.turnMessage) {
      setMessage(gameState.turnMessage);
      setLastMoveValid(null);
    }
  }, [gameState?.turnMessage, gameState?.turnMessageTimestamp]);

  const liveBoards = useMemo<LiveBoardEntry[]>(() => {
    if (!gameState) return [];

    const players = gameState.players || {};
    const ordered = (gameState.turnOrder || Object.keys(players)).filter((id) => !!players[id]);
    const runnerIds = [userId, ...ordered.filter((id) => id !== userId)].slice(0, 4);
    const wallList = Object.values(gameState.collisionWalls || {}).filter(Boolean) as CollisionWall[];

    return runnerIds.flatMap((runnerId, index) => {
      const runner = players[runnerId];
      const ownerId = gameState.assignments?.[runnerId];
      const runnerMap = ownerId ? gameState.maps?.[ownerId] : null;
      if (!runner || !ownerId || !runnerMap) return [];
      const mapItemState = gameState.itemState?.[ownerId];

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
        itemsConsumed: normalizeConsumed(mapItemState?.consumed),
        itemActiveWalls: normalizeConsumed(mapItemState?.activeWalls),
        itemPhaseOpen: normalizeConsumed(mapItemState?.phaseOpen),
        revealedWalls: isMine
          ? revealedWalls
          : (gameState.revealedWallsByPlayer?.[runnerId] || []),
        fx: isMine ? fx : (remoteVisuals[runnerId]?.fx || null),
        via: isMine ? moveVia : (remoteVisuals[runnerId]?.via || null),
        visualAction: isMine ? undefined : remoteVisuals[runnerId]?.action,
        visualSequence: isMine ? undefined : remoteVisuals[runnerId]?.sequence,
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
  }, [gameState, userId, playerName, playerPosition, moveCount, revealedWalls, fx, moveVia, remoteVisuals, currentTurnId]);

  useEffect(() => {
    if (!isMyTurn) {
      setArmedSkill(null);
      setSkillNotice('');
    }
  }, [isMyTurn]);

  const handleSkillButton = useCallback(async () => {
    if (!equippedSkill || skillConsumed || isFinished || !isMyTurn) return;
    if (equippedSkill === 'anchor') {
      setSkillNotice('공간 닻은 첫 강제 이동에 자동 발동합니다.');
      return;
    }
    if (equippedSkill === 'scoutPulse') {
      const succeeded = await handleOnlineSkill('scoutPulse');
      setSkillNotice(succeeded ? '' : '현재 정찰 파동을 사용할 수 없습니다.');
      return;
    }
    setArmedSkill((current) => current === equippedSkill ? null : equippedSkill);
    setSkillNotice(armedSkill === equippedSkill ? '' : '이동 방향을 선택하세요.');
  }, [armedSkill, equippedSkill, handleOnlineSkill, isFinished, isMyTurn, skillConsumed]);

  const renderControls = () => {
    const sizeClass = '!h-11 !w-11 !rounded-lg';
    const disabled = isFinished || !isMyTurn;
    const moveButton = (direction: Direction, label: string, Icon: typeof ArrowUp) => (
      <button
        className={`btn-dpad ${sizeClass} !bg-slate-950/80 backdrop-blur-sm`}
        onClick={() => handleMove(direction)}
        disabled={disabled}
        title={label}
        aria-label={label}
      >
        <Icon size={17} aria-hidden="true" />
      </button>
    );

    return (
      <div
        className="absolute inset-x-0 bottom-0 z-30 flex h-[58px] items-center justify-center gap-1 border-t border-slate-800 bg-slate-950/95 px-2 backdrop-blur-sm"
        style={{ paddingBottom: 'env(safe-area-inset-bottom)', height: 'calc(58px + env(safe-area-inset-bottom))' }}
        data-testid="online-controls"
      >
        <div className="game-desktop-direction-buttons items-center gap-1">
          {moveButton('left', '왼쪽으로 이동', ArrowLeft)}
          {moveButton('up', '위로 이동', ArrowUp)}
          {moveButton('down', '아래로 이동', ArrowDown)}
          {moveButton('right', '오른쪽으로 이동', ArrowRight)}
        </div>
        <button
          className={`game-mobile-pad-toggle flex h-11 min-w-11 items-center justify-center rounded-lg border ${
            padVisible
              ? 'border-[#cfa87a] bg-[#f4c64f] text-[#3d352d]'
              : 'border-[#cfa87a] bg-[#fffef9] text-[#74685c]'
          }`}
          onClick={togglePad}
          title={padVisible ? '방향패드 숨기기 (스와이프로 이동)' : '방향패드 표시'}
          aria-label={padVisible ? '방향패드 숨기기' : '방향패드 표시'}
          aria-pressed={padVisible}
          data-testid="online-pad-toggle"
        >
          <Gamepad2 size={18} aria-hidden="true" />
        </button>
        <button
          className={`ml-1 flex h-11 min-w-11 items-center justify-center rounded-lg border ${
            armedSkill
              ? 'border-emerald-300 bg-emerald-400 text-slate-950'
              : equippedSkill === 'anchor' && !skillConsumed
                ? 'border-cyan-400 bg-cyan-500/20 text-cyan-100'
                : 'border-emerald-500/60 bg-slate-950/90 text-emerald-200'
          } disabled:opacity-35`}
          onClick={handleSkillButton}
          disabled={!equippedSkill || skillConsumed || isFinished || !isMyTurn}
          title={equippedSkill ? `${MAZE_SKILL_DEFINITIONS[equippedSkill].label}${equippedSkill === 'anchor' ? ' · 자동 발동' : ''}` : '스킬 없음'}
          aria-label={equippedSkill ? `${MAZE_SKILL_DEFINITIONS[equippedSkill].label}${equippedSkill === 'anchor' ? ' 자동 발동' : ' 사용'}` : '스킬 없음'}
          aria-pressed={!!armedSkill}
        >
          <SkillIcon size={18} aria-hidden="true" />
        </button>
      </div>
    );
  };

  return (
    <div className="absolute inset-0 overflow-hidden">
      {/* 보드 스테이지: 모바일 방향패드가 보드 아래에 놓일 공간을 예약한다. */}
      <div
        ref={boardStageRef}
        className={`game-online-board-stage absolute inset-0 px-2 ${
          isFinished
            ? 'game-online-board-stage-finished'
            : padVisible
              ? 'game-online-board-stage-pad'
              : 'game-online-board-stage-compact'
        }`}
        data-mobile-pad-visible={!isFinished && padVisible ? 'true' : 'false'}
        data-testid="online-board-stage"
      >
        <LiveBoardGrid
          boards={liveBoards}
          currentTurnId={currentTurnId}
          myPlayerId={userId}
          gameEnded={gameEnded}
          className="h-full w-full"
          emptyState={<span className="text-sm text-slate-400">보드 동기화 중</span>}
        />
      </div>

      {/* 모바일 방향패드 전용 영역: 보드와 하단 도구 사이에 배치한다. */}
      {!isFinished && padVisible && (
        <div
          className="game-mobile-direction-dock absolute inset-x-0 z-30 flex h-[148px] items-center justify-center border-t border-[#e5cfad] bg-[#fffaf0]/95"
          style={{ bottom: 'calc(58px + env(safe-area-inset-bottom))' }}
          data-testid="online-mobile-direction-dock"
        >
          <MobileDirectionPad
            disabled={!isMyTurn}
            active={isMyTurn}
            onMove={handleMove}
            testId="online-mobile-direction-pad"
          />
        </div>
      )}

      {!isFinished && renderControls()}

      {/* 360px에서도 상대 3명과 도구가 넘치지 않는 2행 HUD */}
      <div
        className="absolute left-1/2 top-1 z-20 w-[98%] max-w-3xl -translate-x-1/2"
        data-testid="online-hud"
      >
        <div className="game-panel grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-1 gap-y-1 !rounded-lg p-1.5">
          <div className={`flex min-w-0 items-center gap-1.5 rounded-md px-1.5 py-1 ${!isFinished ? 'bg-blue-500/15 ring-1 ring-blue-400/50' : ''}`}>
            {playerPhotoURL ? (
              <Image
                src={playerPhotoURL}
                alt="Player"
                width={28}
                height={28}
                className="h-7 w-7 shrink-0 rounded-full object-cover ring-2 ring-blue-400"
              />
            ) : (
              <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-blue-500 ring-2 ring-blue-400">
                <span className="text-white text-[10px] font-bold">나</span>
              </div>
            )}
            <div className="min-w-0 leading-tight">
              <div className="truncate text-xs font-bold text-blue-300">{playerName.substring(0, 8)}</div>
              <div className="text-[10px] text-slate-400">턴: {moveCount}</div>
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-1">
            {showRank && (
              <span
                className={`shrink-0 rounded-md border px-1.5 py-1 text-[10px] font-black leading-none ${
                  myRank === 1
                    ? 'border-amber-400/60 bg-amber-400/15 text-amber-200'
                    : 'border-slate-600/60 bg-slate-800/80 text-slate-200'
                }`}
                data-testid="online-rank"
                aria-label={`현재 순위 ${myRank}위, 총 ${rankTotal}명`}
              >
                {myRank}/{rankTotal}위
              </span>
            )}
            <div className="flex max-w-[92px] flex-col items-center gap-0.5">
              <span className="text-[9px] font-bold text-slate-500">TURN {gameState?.turnNumber || 1}</span>
              {gameEnded ? (
                <span className="rounded border border-green-400/40 bg-green-400/15 px-2 py-0.5 text-[10px] font-bold text-green-300">종료</span>
              ) : iAmDone ? (
                <span className="rounded border border-purple-400/40 bg-purple-400/15 px-2 py-0.5 text-[10px] font-bold text-purple-300">관전 중</span>
              ) : isMyTurn ? (
                <span className="badge-turn !px-2 !py-0.5 text-[10px]">내 턴</span>
              ) : (
                <span className="max-w-full truncate rounded border border-slate-500/60 bg-slate-700/80 px-2 py-0.5 text-[10px] font-bold text-slate-200">
                  {currentTurnName.substring(0, 7)} 턴
                </span>
              )}
            </div>
          </div>

          <div className="col-span-2 flex min-w-0 items-center gap-1">
            {othersInfo.length > 0 ? (
              <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto overscroll-x-contain">
                {othersInfo.slice(0, 3).map((o) => (
                  <div
                    key={o.id}
                    className={`flex shrink-0 items-center gap-1 rounded-md px-1.5 py-1 ${
                      currentTurnId === o.id && !gameEnded ? 'bg-amber-400/15 ring-1 ring-amber-300/70' : 'opacity-70'
                    }`}
                    title={`${o.name} - ${o.forfeited ? '이전 기록 미완주' : o.finished ? `${o.finishMoves}턴 완주` : '진행 중'}`}
                  >
                    {o.photoURL ? (
                      <Image src={o.photoURL} alt={o.name} width={24} height={24} className="w-6 h-6 rounded-full object-cover ring-2 ring-red-400" />
                    ) : (
                      <div className="w-6 h-6 rounded-full bg-red-500 ring-2 ring-red-400 flex items-center justify-center">
                        <span className="text-white text-[9px] font-bold">{o.name[0] || '적'}</span>
                      </div>
                    )}
                    <div className="hidden leading-tight min-[430px]:block">
                      <div className="text-[10px] font-bold text-red-300">{o.name.substring(0, 5)}</div>
                      <div className="text-[9px] text-slate-400">
                        {o.forfeited ? '이전 기록' : o.finished ? `${o.finishMoves}턴 ✓` : `${o.moves || 0}턴`}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <span className="min-w-0 flex-1 truncate text-[10px] text-slate-500">상대 대기</span>
            )}

            {nextRadarIndex >= 0 && !isFinished && (() => {
              const remaining = myItems.filter(
                (it, idx) => it.type === 'radar' && !myItemsConsumed[idx]
              ).length;
              return (
                <button
                  className="btn-game relative flex size-11 shrink-0 items-center justify-center !rounded-lg"
                  onClick={handleUseRadar}
                  disabled={!isMyTurn}
                  title="내 주변 한 칸(대각선 포함)의 벽을 탐지합니다"
                  aria-label={`탐지기 사용${remaining > 1 ? `, ${remaining}개 남음` : ''}`}
                >
                  <ScanSearch size={18} aria-hidden="true" />
                  {remaining > 1 && (
                    <span className="absolute right-0.5 top-0.5 text-[8px] font-black">{remaining}</span>
                  )}
                </button>
              );
            })()}
          </div>
        </div>
        {mobileStatusText && (
          <div className="game-mobile-status mt-1 h-4 min-w-0 items-center justify-center px-2">
            <span
              className="max-w-full truncate rounded border border-slate-600/60 bg-slate-950/90 px-2 text-[10px] font-bold leading-4 text-slate-100"
              data-testid="online-mobile-status"
              role="status"
              aria-live="polite"
              aria-atomic="true"
            >
              {mobileStatusText}
            </span>
          </div>
        )}
      </div>

      {/* 메시지/배너 오버레이 */}
      <div className="game-desktop-messages pointer-events-none absolute left-1/2 top-[114px] z-20 w-[96%] max-w-2xl -translate-x-1/2 flex-col items-center gap-1.5">
        {skillNotice && (
          <div className="rounded border border-emerald-400/50 bg-slate-950/90 px-3 py-1 text-xs font-bold text-emerald-200">
            {skillNotice}
          </div>
        )}
        {message && (
          <div
            className={`rounded-full border px-3 py-1 text-xs backdrop-blur-sm ${
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
        {iAmDone && !gameEnded && (
          <div className="text-xs px-3 py-1.5 rounded-xl bg-purple-500/20 border border-purple-400/50 text-purple-100 font-medium backdrop-blur-sm">
            🏁 {myFinishMoves ?? moveCount}턴으로 완주했습니다! 상대방이 더 적은 턴으로 완주하면
            패배, 같은 턴이면 무승부입니다. (관전 중)
          </div>
        )}

        {!iAmDone && !gameEnded && leadingFinishMoves !== null && (
          <div className="rounded-xl border border-[#cfa87a] bg-[#fff8de] px-3 py-1.5 text-xs font-bold text-[#5d5146] backdrop-blur-sm">
            🐇 현재 최고 기록은 {leadingFinishMoves}턴이에요. 기권 없이 끝까지 완주해 내 기록을 만들어보세요!
          </div>
        )}

      </div>
    </div>
  );
};

export default GamePlay;
