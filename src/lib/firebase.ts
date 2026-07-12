'use client';

import { initializeApp } from 'firebase/app';
import { getDatabase, ref, onValue, set, push, update, remove, get, onDisconnect, serverTimestamp, runTransaction, connectDatabaseEmulator } from 'firebase/database';
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signOut,
  setPersistence,
  browserLocalPersistence,
  connectAuthEmulator
} from 'firebase/auth';
import { getAnalytics, isSupported } from 'firebase/analytics';
import { Room, GameState, GamePhase, GameMap, UserProfile } from '@/types/game';
import { GAME_RULES_VERSION, getFirstTurnPlayerId, getTurnOrder } from '@/lib/gameUtils';
import {
  createCanonicalGameRuleSnapshot,
  isValidGameRuleSnapshot,
  isValidMapForRuleSnapshot,
} from '@/lib/gameRules';
import { createMazeSkillState } from '@/lib/mazeSkills';
import { shouldPreserveGamePlayerOnLeave } from '@/lib/roomLifecycle';

// Firebase 인스턴스를 저장할 변수들  
export let auth;
export let database;

// Firebase 설정
const firebaseConfig = {
  apiKey: "AIzaSyBxHJ14JjS3DOHHR9xwLGjIKdBJp8cD448",
  authDomain: "daemok-155c1.firebaseapp.com",
  databaseURL: "https://daemok-155c1-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "daemok-155c1",
  storageBucket: "daemok-155c1.firebasestorage.app",
  messagingSenderId: "991265301980",
  appId: "1:991265301980:web:13a56cb9609cdb92d5db19",
  measurementId: "G-3HXC4G5MTG"
};

// Firebase 초기화
export const firebaseInitPromise = (async () => {
  try {
    const app = initializeApp(firebaseConfig);
    void isSupported().then((supported) => supported ? getAnalytics(app) : null);
    auth = getAuth(app);
    
    // 브라우저 종료 후에도 인증 상태 유지 (로컬 스토리지 사용)
    setPersistence(auth, browserLocalPersistence)
      .then(() => {
        console.log('Firebase 인증 지속성 설정 완료: LOCAL');
      })
      .catch((error) => {
        console.error('인증 지속성 설정 오류:', error);
      });
    
    database = getDatabase(app);

    // 로컬 에뮬레이터 연결 (E2E 테스트용 - NEXT_PUBLIC_FIREBASE_EMULATOR=1 빌드에서만)
    if (process.env.NEXT_PUBLIC_FIREBASE_EMULATOR === '1' && typeof window !== 'undefined') {
      connectAuthEmulator(auth, 'http://localhost:9099', { disableWarnings: true });
      connectDatabaseEmulator(database, 'localhost', 9000);
      console.log('Firebase 에뮬레이터에 연결됨 (auth:9099, database:9000)');
    }

    console.log('Firebase 초기화 완료');
    return { app, auth, database };
  } catch (error) {
    console.error('Firebase 초기화 오류:', error);
    return null;
  }
})();

// 인증 객체 가져오기
export const getFirebaseAuth = () => {
  return auth;
};

// 구글 로그인 처리
export const signInWithGoogle = async () => {
  if (!auth) {
    console.error('Firebase Auth가 초기화되지 않았습니다.');
    return null;
  }

  try {
    const provider = new GoogleAuthProvider();
    // 로그인 시도를 매번 하도록 설정
    provider.setCustomParameters({
      prompt: 'select_account'
    });

    const userCredential = await signInWithPopup(auth, provider);
    const user = userCredential.user;
    
    console.log('구글 로그인 성공:', user.displayName);
    
    // 사용자 프로필 정보 반환
    return {
      uid: user.uid,
      displayName: user.displayName,
      email: user.email,
      photoURL: user.photoURL
    };
  } catch (error) {
    console.error('구글 로그인 실패:', error);
    return null;
  }
};

// 로그아웃 처리
export const signOutUser = async () => {
  if (!auth) {
    console.error('Firebase Auth가 초기화되지 않았습니다.');
    return false;
  }

  try {
    await signOut(auth);
    console.log('로그아웃 성공');
    return true;
  } catch (error) {
    console.error('로그아웃 실패:', error);
    return false;
  }
};

// 방 목록 조회
export const getRooms = (callback: (rooms: Room[]) => void) => {
  if (!database) {
    console.error('Firebase Database가 초기화되지 않았습니다.');
    callback([]);
    return () => {};
  }

  console.log('방 목록 조회 시도...');
  const roomsRef = ref(database, 'rooms');
  
  return onValue(roomsRef, (snapshot) => {
    const data = snapshot.val();
    let roomsList: Room[] = [];
    
    if (data) {
      // 객체를 배열로 변환하고 id 속성이 없으면 키를 id로 추가
      roomsList = Object.entries(data).map(([key, room]) => {
        const typedRoom = room as Room;
        const roomSummary = { ...typedRoom };
        roomSummary.players = Object.values(typedRoom.players || {})
          .filter((playerId): playerId is string => typeof playerId === 'string');
        delete roomSummary.maps;
        if (!typedRoom.id) {
          return { ...roomSummary, id: key };
        }
        return roomSummary as Room;
      });
    }
    
    console.log(`방 목록 ${roomsList.length}개 동기화`);
    callback(roomsList);
  }, (error) => {
    console.error('방 목록 조회 오류:', error);
    callback([]);
  });
};

// 방 생성에 디바운싱 추가
let roomCreationInProgress = false;

const roomPresencePaths = (roomId: string, userId: string) => [
  `rooms/${roomId}/playerStatus/${userId}`,
  `rooms/${roomId}/members/${userId}`,
  `rooms/${roomId}/joinedPlayers/${userId}`,
  `rooms/${roomId}/gameState/players/${userId}`,
  `rooms/${roomId}/spectators/${userId}`,
];

// 방장 연결이 끊기면 Firebase 서버가 방 전체를 제거한다. 방 하위의
// onDisconnect 쓰기는 root 삭제 뒤 유령 방을 만들 수 있어 먼저 취소한다.
export const armOwnerRoomDisconnectCleanup = async (roomId: string, userId: string): Promise<boolean> => {
  if (!roomId || !userId) return false;

  try {
    const db = getDatabase();
    const roomRef = ref(db, `rooms/${roomId}`);
    const ownerSnapshot = await get(ref(db, `rooms/${roomId}/createdBy`));

    if (!ownerSnapshot.exists() || ownerSnapshot.val() !== userId) return false;

    await Promise.all(
      roomPresencePaths(roomId, userId).map((path) =>
        onDisconnect(ref(db, path)).cancel().catch(() => {})
      )
    );

    // remove 등록 승인을 기다린 뒤에만 온라인 상태를 기록해야 생성 직후 종료도 정리된다.
    await onDisconnect(roomRef).remove();
    await Promise.all([
      onDisconnect(ref(db, `userStatus/${userId}`)).update({
        online: false,
        currentRoom: null,
        lastSeen: serverTimestamp(),
        lastActivity: serverTimestamp(),
      }),
      onDisconnect(ref(db, `userRooms/${userId}/${roomId}`)).remove(),
    ]);

    return true;
  } catch (error) {
    console.error('방장 연결 종료 정리 등록 오류:', error);
    return false;
  }
};

export const createRoom = async (name: string, creatorId: string, maxPlayers: number = 2): Promise<string | null> => {
  if (!database) {
    console.error('Firebase Database가 초기화되지 않았습니다.');
    return null;
  }
  
  // 이미 방 생성 중이면 중복 생성 방지
  if (roomCreationInProgress) {
    console.log('이미 방 생성이 진행 중입니다.');
    return null;
  }
  
  console.log('방 생성 시도...', { name, creatorId, maxPlayers });
  
  try {
    roomCreationInProgress = true;
    
    // 이미 같은 이름의 방이 있는지 확인
    const roomsRef = ref(database, 'rooms');
    const existingRoomsSnapshot = await get(roomsRef);
    const existingRooms = (existingRoomsSnapshot.val() || {}) as Record<string, Partial<Room>>;
    
    // 이름으로 중복 검사
    const roomExists = Object.values(existingRooms).some(
      (room) => room.name === name && room.createdBy === creatorId
    );

    if (roomExists) {
      console.log('이미 같은 이름의 방이 존재합니다:', name);
      throw new Error('이미 같은 이름의 방이 존재합니다. 다른 이름을 사용해주세요.');
    }

    // 기본 방 정보 생성
    const newRoomRef = push(roomsRef);
    const roomId = newRoomRef.key;

    if (!roomId) {
      console.error('방 ID 생성 실패');
      return null;
    }

    // 방 생성 시간
    const now = serverTimestamp();

    const ruleSnapshot = createCanonicalGameRuleSnapshot();

    // 초기 게임 상태 설정
    const initialGameState = {
      rulesVersion: GAME_RULES_VERSION,
      matchNumber: 0,
      phase: 'setup', // setup, play, end
      currentTurn: creatorId, // 첫 게임 선턴은 방장
      turnOrder: [creatorId],
      players: {
        [creatorId]: {
          id: creatorId,
          position: { row: 0, col: 0 },
          isReady: false,
          isOnline: true,
          lastSeen: now
        }
      },
      winner: null
    };
    
    // 방 데이터 구조
    const roomData = {
      id: roomId,
      name: name,
      createdAt: now,
      createdBy: creatorId,
      players: [creatorId],
      maxPlayers: maxPlayers,
      rulesVersion: GAME_RULES_VERSION,
      ruleSnapshot,
      gameState: initialGameState,
      status: 'waiting', // waiting, playing, ended
      lastActivity: now
    };
    
    // 방 생성
    await set(newRoomRef, roomData);
    console.log('방 생성 성공:', roomId);

    // 다음 화면이 뜨기 전에 창이 닫혀도 방이 남지 않도록 즉시 등록한다.
    const disconnectCleanupArmed = await armOwnerRoomDisconnectCleanup(roomId, creatorId);
    if (!disconnectCleanupArmed) {
      await remove(newRoomRef).catch(() => {});
      throw new Error('방 연결 종료 처리를 등록하지 못했습니다. 다시 시도해주세요.');
    }
    
    // 방 생성자를 방 참여자로 추가
    await set(ref(database, `rooms/${roomId}/joinedPlayers/${creatorId}`), {
      joined: true,
      joinedAt: now,
      isCreator: true
    });
    
    // 사용자 상태 업데이트 - 현재 방 정보만 저장
    await update(ref(database, `userStatus/${creatorId}`), {
      online: true,
      currentRoom: roomId,
      lastActivity: now
    });
    
    return roomId;
  } catch (error) {
    console.error('방 생성 중 오류:', error);
    throw error;
  } finally {
    // 방 생성 작업 완료
    roomCreationInProgress = false;
  }
};

// 관전자 등록 - 게임이 이미 시작된 방에 구경꾼으로 입장
// gameState.players에는 절대 쓰지 않아 정산/시작 로직에 영향을 주지 않는다
export const registerSpectator = async (roomId: string, userId: string): Promise<boolean> => {
  if (!database || !auth.currentUser) return false;

  try {
    const specRef = ref(database, `rooms/${roomId}/spectators/${userId}`);
    await update(specRef, {
      joined: true,
      joinedAt: serverTimestamp(),
      displayName: auth.currentUser.displayName || '익명 사용자',
      photoURL: auth.currentUser.photoURL || null,
    });

    // 브라우저 종료 시 관전자 흔적 자동 제거
    onDisconnect(specRef).remove().catch(() => {});

    await update(ref(database, `userStatus/${userId}`), {
      currentRoom: roomId,
      lastActivity: serverTimestamp(),
    });
    await update(ref(database, `rooms/${roomId}`), { lastActivity: serverTimestamp() }).catch(() => {});

    return true;
  } catch (error) {
    console.error('관전자 등록 오류:', error);
    return false;
  }
};

// 방 참가
export const joinRoom = async (roomId: string, userId: string): Promise<boolean> => {
  if (!database || !auth.currentUser) return false;
  
  // 인증 상태 확인
  if (auth.currentUser.uid !== userId) {
    console.error('인증된 사용자 ID와 참여 시도 ID 불일치');
    return false;
  }

  let claimedSlot: number | null = null;
  let playerCreated = false;

  try {
    console.log('방 참여 시도:', roomId);
    
    // 방 정보 확인
    const roomRef = ref(database, `rooms/${roomId}`);
    const snapshot = await get(roomRef);
    
    if (!snapshot.exists()) {
      console.error('방을 찾을 수 없음:', roomId);
      return false;
    }
    
    const roomData = snapshot.val();

    // 진행 중인 게임의 관전자는 gameState.players에 넣지 않는다.
    if (roomData.gameState?.phase !== GamePhase.SETUP && !roomData.gameState?.players?.[userId]) {
      return registerSpectator(roomId, userId);
    }

    // gameState.players가 정원과 참가 여부의 유일한 기준이다.
    const alreadyJoined = !!roomData.gameState?.players?.[userId];

    // 이미 게임이 시작된 방: 관전자로 입장 (게임 로직에는 일절 개입하지 않음)
    if (!alreadyJoined && roomData.gameState?.phase && roomData.gameState.phase !== 'setup') {
      console.log('게임 진행 중인 방 - 관전자로 입장:', roomId);
      await registerSpectator(roomId, userId);
      return true;
    }

    if (!alreadyJoined) {
      const maxPlayers = Math.min(4, Math.max(2, Number(roomData.maxPlayers) || 2));
      const slotsSnapshot = await get(ref(database, `rooms/${roomId}/players`));
      const slots = slotsSnapshot.val() || {};
      const existingSlot = Object.entries(slots).find(([, uid]) => uid === userId)?.[0];

      if (existingSlot == null) {
        for (let slot = 0; slot < maxPlayers; slot += 1) {
          if (slots[slot] != null) continue;
          const result = await runTransaction(
            ref(database, `rooms/${roomId}/players/${slot}`),
            (current: string | null) => current == null ? userId : undefined,
            { applyLocally: false }
          );
          if (result.committed && result.snapshot.val() === userId) {
            claimedSlot = slot;
            break;
          }
        }
        if (claimedSlot == null) {
          console.error('방 인원이 가득 참:', roomId);
          return false;
        }
      }
    }

    // 게임 상태에 플레이어 추가 (위치 정보 포함)
    const playerPath = `rooms/${roomId}/gameState/players/${userId}`;
    const playerRef = ref(database, playerPath);
    const playerSnapshot = await get(playerRef);
    
    if (!playerSnapshot.exists() || !playerSnapshot.val().position) {
      // 플레이어 초기 상태 설정
      await update(ref(database, playerPath), {
        id: userId,
        position: { row: 0, col: 0 },
        isReady: false,
        isOnline: true,
        lastSeen: serverTimestamp()
      });
      playerCreated = true;
    } else {
      await update(playerRef, {
        hasLeft: null,
        isOnline: true,
        lastSeen: serverTimestamp(),
      });
    }

    // 동시 입장 시에도 기존 순서를 덮어쓰지 않고 한 명씩 원자적으로 추가한다.
    await runTransaction(ref(database, `rooms/${roomId}/gameState/turnOrder`), (order: string[] | null) => {
      const currentOrder = Array.isArray(order) ? order.filter((id): id is string => typeof id === 'string') : [];
      return currentOrder.includes(userId) ? currentOrder : [...currentOrder, userId];
    }, { applyLocally: false });

    // 방 참여 상태 업데이트
    await update(ref(database, `rooms/${roomId}/joinedPlayers/${userId}`), {
      joined: true,
      joinedAt: serverTimestamp(),
      displayName: auth.currentUser.displayName || '익명 사용자',
      photoURL: auth.currentUser.photoURL || null
    });
    
    // 대신 현재 방 정보만 업데이트
    await update(ref(database, `userStatus/${userId}`), {
      currentRoom: roomId,
      lastActivity: serverTimestamp()
    });

    // 방 활동 시각 갱신 (유령 방 판정 방지)
    await update(roomRef, { lastActivity: serverTimestamp() });

    return true;
  } catch (error) {
    if (claimedSlot != null && !playerCreated) {
      await remove(ref(database, `rooms/${roomId}/players/${claimedSlot}`)).catch(() => {});
    }
    console.error('방 참여 중 오류:', error);
    return false;
  }
};

// 게임 시작 (방장 전용 버튼) - 트랜잭션으로 안전하게 SETUP -> PLAY 전환
// 순환 릴레이: 입장 순서에서 각자 "다음 사람"의 맵을 달린다 (2인이면 서로 교환과 동일)
export const startGame = async (roomId: string): Promise<boolean> => {
  if (!database) {
    console.error('Firebase Database가 초기화되지 않았습니다.');
    return false;
  }

  const gameStateRef = ref(database, `rooms/${roomId}/gameState`);

  try {
    const roomRulesSnapshot = await get(ref(database, `rooms/${roomId}`));
    const roomRules = roomRulesSnapshot.val() as Partial<Room> | null;
    if (
      !roomRules ||
      roomRules.rulesVersion !== GAME_RULES_VERSION ||
      !isValidGameRuleSnapshot(roomRules.ruleSnapshot)
    ) {
      return false;
    }
    const ruleSnapshot = roomRules.ruleSnapshot;
    const maps = roomRules.maps || {};
    const result = await runTransaction(gameStateRef, (state: GameState | null) => {
      // 로컬 캐시가 비어 있으면 그대로 반환 -> 서버 데이터로 재시도됨
      if (!state) return state;

      // 이미 시작되었거나 종료된 게임이면 중단
      if (state.phase !== GamePhase.SETUP) return;

      const players = state.players || {};
      const playerIds = getTurnOrder(players, state.turnOrder);

      const enoughPlayers = playerIds.length >= 2;
      const allReady = playerIds.every((id) => players[id]?.isReady);
      const allMapsReady = playerIds.every((id) => maps[id]);
      const allMapsValid = playerIds.every(
        (id) => maps[id] && isValidMapForRuleSnapshot(maps[id], ruleSnapshot)
      );

      // 시작 조건 미충족 -> 중단
      if (!enoughPlayers || !allReady || !allMapsReady || !allMapsValid) return;

      // 순환 릴레이 배정: sorted[i]는 sorted[(i+1)%N]의 맵을 달린다
      const assignments: Record<string, string> = {};
      playerIds.forEach((runnerId, i) => {
        const mapOwnerId = playerIds[(i + 1) % playerIds.length];
        assignments[runnerId] = mapOwnerId;
        if (maps[mapOwnerId]?.startPosition) {
          players[runnerId].position = maps[mapOwnerId].startPosition;
          players[runnerId].positionHistory = [maps[mapOwnerId].startPosition];
          players[runnerId].moves = 0;
          players[runnerId].finished = false;
          players[runnerId].forfeited = false;
        }
      });

      const turnOrder = getTurnOrder(players, playerIds);
      const preferredFirst = state.currentTurn && players[state.currentTurn] ? state.currentTurn : null;
      const currentTurn = preferredFirst || getFirstTurnPlayerId(players, turnOrder);
      const itemState = Object.fromEntries(playerIds.map((id) => [id, {
        consumed: {},
        mazeSkill: createMazeSkillState(maps[id].skillLoadout),
      }]));

      const persistentState = { ...state };
      delete persistentState.maps;
      return {
        ...persistentState,
        rulesVersion: ruleSnapshot.version,
        matchNumber: (state.matchNumber || 0) + 1,
        phase: GamePhase.PLAY,
        assignments,
        players,
        currentTurn,
        turnOrder,
        turnNumber: 1,
        itemState,
        collisionWalls: {},
        revealedWallsByPlayer: {},
        visionEffectsByPlayer: {},
        turnMessage: currentTurn ? `${players[currentTurn]?.displayName || '플레이어'}의 턴` : undefined,
        turnMessageTimestamp: Date.now(),
      };
    }, { applyLocally: false });

    if (result.committed) {
      console.log('게임 시작됨:', roomId);
      await update(ref(database, `rooms/${roomId}`), {
        status: 'playing',
        lastActivity: serverTimestamp(),
      }).catch(() => {});
    }
    return result.committed;
  } catch (error) {
    console.error('게임 시작 트랜잭션 오류:', error);
    return false;
  }
};

// 맵 설정
export const placeObstacles = async (roomId: string, userId: string, map: GameMap): Promise<void> => {
  if (!roomId || !userId) {
    console.error('유효하지 않은 roomId 또는 userId:', { roomId, userId });
    throw new Error('유효하지 않은 방 ID 또는 사용자 ID입니다.');
  }

  if (!database) {
    console.error('Firebase Database가 초기화되지 않았습니다.');
    return;
  }

  const roomSnapshot = await get(ref(database, `rooms/${roomId}`));
  const room = roomSnapshot.val() as Partial<Room> | null;
  if (
    !room ||
    room.rulesVersion !== GAME_RULES_VERSION ||
    !isValidGameRuleSnapshot(room.ruleSnapshot) ||
    !isValidMapForRuleSnapshot(map, room.ruleSnapshot)
  ) {
    throw new Error('유효하지 않은 맵은 저장할 수 없습니다.');
  }

  try {
    console.log('맵 설정 중...', { roomId, userId });
    await update(ref(database, `rooms/${roomId}`), {
      [`maps/${userId}`]: map,
      [`gameState/players/${userId}/isReady`]: true,
    });

    // 방 활동 시각 갱신
    await touchRoomActivity(roomId);
  } catch (error) {
    console.error('맵 설정 중 오류 발생:', error);
    throw error;
  }
};

export const resetPlayerMap = async (roomId: string, userId: string): Promise<void> => {
  if (!database || !roomId || !userId) throw new Error('맵을 다시 편집할 수 없습니다.');

  const phaseSnapshot = await get(ref(database, `rooms/${roomId}/gameState/phase`));
  if (phaseSnapshot.val() !== GamePhase.SETUP) {
    throw new Error('맵 제작 단계에서만 다시 편집할 수 있습니다.');
  }

  await update(ref(database, `rooms/${roomId}`), {
    [`gameState/players/${userId}/isReady`]: false,
    [`maps/${userId}`]: null,
  });
  await touchRoomActivity(roomId);
};

// 방 나가기
export const leaveRoom = async (roomId: string, userId: string): Promise<boolean> => {
  if (!database) return false;
  
  try {
    console.log('방 나가기 시도:', roomId, userId);
    
    // 방 정보 확인
    const roomRef = ref(database, `rooms/${roomId}`);
    const roomSnapshot = await get(roomRef);
    
    if (!roomSnapshot.exists()) {
      console.error('방을 찾을 수 없음:', roomId);
      return false;
    }
    
    const roomData = roomSnapshot.val();

    // 방 참여 정보 제거
    await remove(ref(database, `rooms/${roomId}/joinedPlayers/${userId}`));
    
    const gamePlayer = roomData.gameState?.players?.[userId];
    if (roomData.gameState?.phase === GamePhase.SETUP) {
      await update(ref(database, `rooms/${roomId}/gameState/players/${userId}`), { isReady: false });
      await remove(ref(database, `rooms/${roomId}/maps/${userId}`));
      const playerSlots = roomData.players || {};
      const slot = Object.entries(playerSlots).find(([, uid]) => uid === userId)?.[0];
      if (slot != null) await remove(ref(database, `rooms/${roomId}/players/${slot}`));
    }
    if (gamePlayer) {
      const gamePlayerRef = ref(database, `rooms/${roomId}/gameState/players/${userId}`);
      if (roomData.gameState?.phase === GamePhase.PLAY) {
        // 진행 중에는 정산 기록을 보존하고 턴 순환에서만 제외한다.
        await update(gamePlayerRef, { hasLeft: true, isOnline: false });
      } else if (!shouldPreserveGamePlayerOnLeave(roomData.gameState?.phase)) {
        await remove(gamePlayerRef);
      }
      // END 참가자 기록은 멱등 전적 트랜잭션과 재시작 로스터가
      // 모두 확정될 때까지 보존한다. 재시작은 오프라인/퇴장자를 제외한다.
    }

    // 관전자 흔적 제거
    await remove(ref(database, `rooms/${roomId}/spectators/${userId}`)).catch(() => {});
    
    // 사용자 상태 업데이트 - 현재 방 정보 null로 설정
    await update(ref(database, `userStatus/${userId}`), {
      currentRoom: null,
      lastActivity: serverTimestamp()
    });
    
    console.log('방 나가기 성공:', roomId, userId);
    return true;
  } catch (error) {
    console.error('방 나가기 중 오류:', error);
    return false;
  }
};

// 새로고침 시 방 세션 자동 복원
export const restoreRoomSession = async (): Promise<string | null> => {
  // 방 복원 건너뛰기 플래그 확인
  if (sessionStorage.getItem('skip_room_restore') === 'true') {
    console.log('방 복원 건너뛰기 플래그가 설정되어 있어 복원을 건너뜁니다');
    sessionStorage.removeItem('skip_room_restore');
    return null;
  }
  
  if (!auth?.currentUser || !database) return null;
  
  try {
    const userId = auth.currentUser.uid;
    
    // userRooms 대신 userStatus에서 현재 방 정보 확인
    const userStatusRef = ref(database, `userStatus/${userId}`);
    const userStatusSnapshot = await get(userStatusRef);
    
    if (!userStatusSnapshot.exists()) return null;
    
    const userStatus = userStatusSnapshot.val();
    const currentRoom = userStatus.currentRoom;
    
    if (!currentRoom) {
      console.log('현재 참여 중인 방이 없습니다');
      return null;
    }
    
    // 방 존재 확인
    const roomRef = ref(database, `rooms/${currentRoom}`);
    const roomSnapshot = await get(roomRef);
    
    if (!roomSnapshot.exists()) {
      console.log('방이 존재하지 않음');
      // 사용자 상태 업데이트
      await update(userStatusRef, { currentRoom: null });
      return null;
    }
    
    // 방 상태 확인 (삭제 중인 방은 복원하지 않음)
    const roomData = roomSnapshot.val();
    if (roomData.status === 'deleting') {
      console.log('방이 삭제 중입니다. 세션을 복원하지 않습니다.');
      return null;
    }
    
    console.log('현재 활동 방 발견:', currentRoom);
    return currentRoom;
  } catch (error) {
    console.error('방 세션 복원 중 오류:', error);
    return null;
  }
};

// null 키를 가진 데이터 정리
export const cleanupNullKeys = async (roomId: string) => {
  if (!database) return;
  
  try {
    console.log('방 데이터 정리 시작:', roomId);
    
    // 맵 데이터에서 null 키 제거
    const mapsRef = ref(database, `rooms/${roomId}/maps`);
    const mapsSnapshot = await get(mapsRef);
    const maps = mapsSnapshot.val();
    
    if (maps && maps.null) {
      console.log('맵 데이터에서 null 키 제거');
      await remove(ref(database, `rooms/${roomId}/maps/null`));
    }
    
    // 플레이어 데이터에서 null 키 제거
    const playersRef = ref(database, `rooms/${roomId}/gameState/players`);
    const playersSnapshot = await get(playersRef);
    const players = playersSnapshot.val();
    
    if (players && players.null) {
      console.log('플레이어 데이터에서 null 키 제거');
      await remove(ref(database, `rooms/${roomId}/gameState/players/null`));
    }
    
    console.log('방 데이터 정리 완료');
  } catch (error) {
    console.error('데이터 정리 중 오류:', error);
  }
};

/**
 * Firebase 인증 오류 해결 방법
 * 
 * 'auth/configuration-not-found' 오류가 발생하는 경우, 다음 사항을 확인하세요:
 * 
 * 1. Firebase 콘솔에서 Authentication 서비스가 활성화되어 있는지 확인하세요.
 *    - Firebase 콘솔 -> Authentication -> Sign-in method 탭으로 이동
 *    - '구글' 제공자가 활성화되어 있는지 확인
 * 
 * 2. 웹 도메인 설정 확인:
 *    - Firebase 콘솔 -> Authentication -> Settings -> Authorized domains에 
 *      로컬 개발용 URL(localhost) 또는 배포된 도메인이 추가되어 있는지 확인
 * 
 * 3. Firebase 프로젝트 설정이 올바른지 확인:
 *    - Firebase 콘솔 -> 프로젝트 설정 -> 일반 탭 -> SDK 설정 및 구성 섹션에서
 *      웹 앱 설정 정보가 위의 firebaseConfig 객체와 일치하는지 확인
 * 
 * 4. 구글 클라우드 콘솔 설정 확인:
 *    - Google Cloud Console -> API 및 서비스 -> OAuth 동의 화면이 올바르게 설정되어 있는지 확인
 *    - 승인된 도메인, 승인된 JavaScript 출처, 승인된 리디렉션 URI 등을 확인하세요.
 */

// 인증 상태 복원 시도 (토큰 만료 또는 오류 발생 시)
export const tryRestoreAuth = async (): Promise<boolean> => {
  if (!auth) return false;
  
  try {
    // 현재 사용자 확인
    const currentUser = auth.currentUser;
    
    if (currentUser) {
      // 현재 인증된 사용자가 있으면 토큰 갱신 시도
      try {
        await currentUser.getIdToken(true);
        console.log('토큰 리프레시 성공');
        
        // Firebase 데이터베이스에 사용자 상태 기록 (선택사항)
        if (database) {
          const userStatusRef = ref(database, `userStatus/${currentUser.uid}`);
          await update(userStatusRef, {
            lastTokenRefresh: serverTimestamp(),
            lastActive: serverTimestamp()
          });
        }
        
        return true;
      } catch (e) {
        console.error('토큰 리프레시 실패:', e);
        return false;
      }
    }
    
    return !!currentUser;
  } catch (error) {
    console.error('인증 복원 오류:', error);
    return false;
  }
};

// Firebase를 사용하여 방 참여 상태 확인
export const checkRoomMembership = async (userId: string, roomId: string): Promise<boolean> => {
  if (!userId || !roomId || !database) return false;
  
  try {
    console.log('Firebase에서 방 참여 상태 확인:', roomId);
    
    // 1. 사용자가 방에 포함되어 있는지 확인
    const roomRef = ref(database, `rooms/${roomId}`);
    const roomSnapshot = await get(roomRef);
    
    if (!roomSnapshot.exists()) {
      console.log('방을 찾을 수 없음:', roomId);
      return false;
    }
    
    const roomData = roomSnapshot.val();
    
    // 게임 상태 또는 관전자 목록에 사용자 정보가 있는지 확인
    const playerStateExists = roomData.gameState?.players && roomData.gameState.players[userId];
    const spectatorExists = roomData.spectators && roomData.spectators[userId];
    
    if (playerStateExists || spectatorExists) {
      console.log('사용자가 방의 멤버임:', roomId);
      return true;
    }
    
    console.log('사용자가 방의 멤버가 아님:', roomId);
    return false;
  } catch (error) {
    console.error('방 참여 상태 확인 중 오류:', error);
    return false;
  }
};

// 방 재참여 처리 (세션이 끊어진 후 재연결)
export const rejoinRoom = async (userId: string, roomId: string): Promise<boolean> => {
  if (!userId || !roomId || !database || !auth.currentUser) return false;
  
  // 인증 상태 확인
  if (auth.currentUser.uid !== userId) {
    console.error('인증된 사용자 ID와 재참여 시도 ID 불일치');
    return false;
  }

  try {
    console.log('방 재참여 시도:', roomId);
    
    // 토큰 유효성 확인 (선택 사항)
    try {
      await auth.currentUser.getIdToken(true);
    } catch (e) {
      console.error('토큰 갱신 실패, 재참여 불가:', e);
      return false;
    }
    
    // 방 정보 확인
    const roomRef = ref(database, `rooms/${roomId}`);
    const snapshot = await get(roomRef);
    
    if (!snapshot.exists()) {
      console.error('방을 찾을 수 없음:', roomId);
      return false;
    }
    
    const roomData = snapshot.val();
    
    // 데이터베이스 상 방 상태 검증 (추가 검증)
    if (roomData.closed || roomData.deleted) {
      console.error('닫힌 방에 재참여 시도:', roomId);
      return false;
    }

    if (roomData.gameState?.phase !== GamePhase.SETUP && !roomData.gameState?.players?.[userId]) {
      return registerSpectator(roomId, userId);
    }

    if (roomData.gameState?.players?.[userId]) {
      await update(ref(database, `rooms/${roomId}/gameState/players/${userId}`), {
        hasLeft: null,
        isOnline: true,
        lastSeen: serverTimestamp(),
      });
    }
    
    // 방 참여 상태 업데이트
    await update(ref(database, `rooms/${roomId}/joinedPlayers/${userId}`), {
      joined: true,
      joinedAt: serverTimestamp(),
      displayName: auth.currentUser.displayName || '익명 사용자',
      photoURL: auth.currentUser.photoURL || null,
      tokenValid: true // 토큰 유효성 표시
    });
    
    // 사용자 현재 상태 업데이트
    await update(ref(database, `userStatus/${userId}`), {
      online: true,
      currentRoom: roomId,
      lastSeen: serverTimestamp()
    });
    
    return true;
  } catch (error) {
    console.error('방 재참여 중 오류:', error);
    return false;
  }
};

// 방 관련 onDisconnect 등록 취소 + 내 접속 상태 정리
// 방이 삭제된 뒤 서버측 onDisconnect나 언마운트 정리 코드가
// 삭제된 방 경로에 데이터를 다시 써서 유령 방이 생기는 것을 방지한다
export const clearRoomPresence = async (roomId: string, userId: string) => {
  if (!roomId || !userId) return;

  try {
    const db = getDatabase();
    // 서버에 등록된 onDisconnect 작업 취소
    await Promise.all(
      roomPresencePaths(roomId, userId).map((path) =>
        onDisconnect(ref(db, path)).cancel().catch(() => {})
      )
    );

    // 노드가 아직 존재하는 경우에만 오프라인 표시 (삭제된 방에 스텁 생성 금지)
    const psRef = ref(db, `rooms/${roomId}/playerStatus/${userId}`);
    const psSnap = await get(psRef);
    if (psSnap.exists()) {
      await update(psRef, { isOnline: false, lastSeen: serverTimestamp() });
    }

    const gpRef = ref(db, `rooms/${roomId}/gameState/players/${userId}`);
    const gpSnap = await get(gpRef);
    if (gpSnap.exists()) {
      await update(gpRef, { isOnline: false, lastSeen: serverTimestamp() });
    }
  } catch (error) {
    console.error('방 접속 상태 정리 오류:', error);
  }
};

// 방 활동 시각 갱신 (유령 방 판정 기준)
export const touchRoomActivity = async (roomId: string) => {
  if (!database || !roomId) return;
  try {
    await update(ref(database, `rooms/${roomId}`), { lastActivity: serverTimestamp() });
  } catch {
    // 방이 이미 삭제된 경우 등 - 무시
  }
};

// 유령/폐기된 방 정리 - 로비 진입 시마다 실행되는 자동 청소
// 1) 내가 만든 방 중 아무도 접속해 있지 않은 방 (방장 권한으로 삭제)
// 2) 누구의 방이든 2시간 이상 활동이 없고 아무도 없는 방 (보안 규칙이 허용)
const STALE_ROOM_MS = 2 * 60 * 60 * 1000; // 2시간

export const cleanupGhostRooms = async (userId: string): Promise<number> => {
  if (!database || !userId) return 0;

  try {
    const snapshot = await get(ref(database, 'rooms'));
    const rooms = (snapshot.val() || {}) as Record<string, {
      playerStatus?: Record<string, { isOnline?: boolean } | null>;
      createdBy?: string;
      lastActivity?: number;
    } | null>;
    let removed = 0;

    for (const [roomId, room] of Object.entries(rooms)) {
      if (!room) continue;

      // 누군가(나 포함, 다른 탭일 수도 있음) 온라인이면 유지
      const statuses = room.playerStatus || {};
      const anyoneOnline = Object.values(statuses).some((status) => status?.isOnline === true);
      if (anyoneOnline) continue;

      const isMine = room.createdBy === userId;
      const lastActivity = typeof room.lastActivity === 'number' ? room.lastActivity : 0;
      const isStale = Date.now() - lastActivity > STALE_ROOM_MS;

      // 내 방이면 즉시, 남의 방이면 오래된 경우에만 (규칙이 서버 시간으로 재검증)
      if (!isMine && !isStale) continue;

      try {
        await remove(ref(database, `rooms/${roomId}`));
        removed++;
      } catch {
        // 경계 시간 근처에서 규칙이 거부하거나 이미 삭제된 경우 - 무시하고 계속
      }
    }

    if (removed > 0) {
      console.log(`유령 방 ${removed}개 정리 완료`);
    }
    return removed;
  } catch (error) {
    console.error('유령 방 정리 오류:', error);
    return 0;
  }
};

// 게임방 내 사용자 온라인 상태 업데이트 (로비와 별개)
export const updateRoomUserStatus = async (roomId: string, userId: string, isOnline: boolean = true) => {
  if (!roomId || !userId) return false;

  try {
    const db = getDatabase();
    const auth = getAuth();

    // 방이 없으면 아무것도 쓰지 않음 (삭제된 방에 잔여 데이터 생성 방지)
    const roomOwnerSnapshot = await get(ref(db, `rooms/${roomId}/createdBy`));
    if (!roomOwnerSnapshot.exists()) return false;
    const isRoomOwner = roomOwnerSnapshot.val() === userId;

    const userStatusRef = ref(db, `rooms/${roomId}/playerStatus/${userId}`);
    
    const userData = {
      uid: userId,
      displayName: auth.currentUser?.displayName || '익명 사용자',
      photoURL: auth.currentUser?.photoURL || null,
      lastSeen: serverTimestamp(),
      isOnline: isOnline
    };
    
    // 게임 상태의 플레이어 정보도 업데이트
    // 주의: 존재할 때만 - update는 없는 경로를 생성하므로, 관전자가 호출하면
    // gameState.players에 유령 플레이어가 생겨 정산이 영원히 끝나지 않는다
    if (isOnline) {
      const playerRef = ref(db, `rooms/${roomId}/gameState/players/${userId}`);
      const playerSnap = await get(playerRef);
      const isPlayer = playerSnap.exists();

      // 온라인 표시보다 연결 종료 예약을 먼저 서버에 등록한다.
      if (isRoomOwner) {
        const armed = await armOwnerRoomDisconnectCleanup(roomId, userId);
        if (!armed) return false;
      } else {
        const disconnectOperations: Promise<void>[] = [
          onDisconnect(userStatusRef).update({
            isOnline: false,
            lastSeen: serverTimestamp()
          })
        ];

        if (isPlayer) {
          disconnectOperations.push(
            onDisconnect(playerRef).update({
              isOnline: false,
              lastSeen: serverTimestamp()
            })
          );
        }

        await Promise.all(disconnectOperations);
      }

      // 방이 예약 등록 도중 삭제됐으면 하위 경로를 다시 만들지 않는다.
      const currentOwnerSnapshot = await get(ref(db, `rooms/${roomId}/createdBy`));
      if (!currentOwnerSnapshot.exists()) return false;

      if (isPlayer) {
        await update(playerRef, {
          isOnline: true,
          lastSeen: serverTimestamp()
        });
      }
    }

    // 방 내 사용자 상태 업데이트
    await update(userStatusRef, userData);
    
    return true;
  } catch (error) {
    console.error('방 내 사용자 상태 업데이트 오류:', error);
    return false;
  }
};

// 게임방 내 온라인 사용자 목록 가져오기 (로비와 별개)
export const getRoomOnlineUsers = (roomId: string, callback: (users: UserProfile[]) => void) => {
  if (!roomId) {
    callback([]);
    return () => {};
  }
  
  const db = getDatabase();
  const roomUsersRef = ref(db, `rooms/${roomId}/playerStatus`);
  
  return onValue(roomUsersRef, (snapshot) => {
    const users: UserProfile[] = [];
    
    if (snapshot.exists()) {
      snapshot.forEach((childSnapshot) => {
        const userData = childSnapshot.val();
        if (userData && userData.isOnline === true) {
          users.push({
            uid: userData.uid,
            displayName: userData.displayName || '익명 사용자',
            photoURL: userData.photoURL || null,
            isOnline: true,
            lastSeen: userData.lastSeen
          });
        }
      });
    }
    
    callback(users);
  });
};
