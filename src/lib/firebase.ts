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
  onIdTokenChanged,
  User,
  Auth,
  onAuthStateChanged,
  connectAuthEmulator
} from 'firebase/auth';
import { getAnalytics, isSupported } from 'firebase/analytics';
import { Room, GameState, GamePhase, SocketEvents, GameMap, UserProfile } from '@/types/game';

// Firebase 인스턴스를 저장할 변수들  
let app;
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
    const analytics = isSupported().then(yes => yes ? getAnalytics(app) : null);
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

// Firebase Analytics 초기화 (클라이언트 사이드에서만 실행)
const initAnalytics = async () => {
  if (typeof window !== 'undefined' && app) {
    try {
      const analyticsSupported = await isSupported();
      if (analyticsSupported) {
        getAnalytics(app);
        console.log('Firebase Analytics 초기화 성공');
      }
    } catch (error) {
      console.error('Firebase Analytics 초기화 실패:', error);
    }
  }
};

// Analytics 초기화 실행
initAnalytics();

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

// 현재 로그인된 사용자 정보 확인
export const getCurrentUser = () => {
  if (!auth) {
    console.error('Firebase Auth가 초기화되지 않았습니다.');
    return null;
  }
  return auth.currentUser;
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
    console.log('방 목록 데이터 수신:', snapshot.val());
    const data = snapshot.val();
    let roomsList: Room[] = [];
    
    if (data) {
      // 객체를 배열로 변환하고 id 속성이 없으면 키를 id로 추가
      roomsList = Object.entries(data).map(([key, room]) => {
        const typedRoom = room as Room;
        if (!typedRoom.id) {
          return { ...typedRoom, id: key };
        }
        return typedRoom;
      });
    }
    
    callback(roomsList);
  }, (error) => {
    console.error('방 목록 조회 오류:', error);
    callback([]);
  });
};

// 방 생성에 디바운싱 추가
let roomCreationInProgress = false;

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
    const existingRooms = existingRoomsSnapshot.val() || {};
    
    // 이름으로 중복 검사
    const roomExists = Object.values(existingRooms).some(
      (room: any) => room.name === name && room.createdBy === creatorId
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

    // 초기 게임 상태 설정
    const initialGameState = {
      phase: 'setup', // setup, play, end
      currentTurn: creatorId, // 첫 게임 선턴은 방장
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
      gameState: initialGameState,
      status: 'waiting', // waiting, playing, ended
      lastActivity: now
    };
    
    // 방 생성
    await set(newRoomRef, roomData);
    console.log('방 생성 성공:', roomId);
    
    // 방 생성자를 방 참여자로 추가
    await set(ref(database, `rooms/${roomId}/joinedPlayers/${creatorId}`), {
      joined: true,
      joinedAt: now,
      isCreator: true
    });
    
    // 사용자 상태 업데이트 - 현재 방 정보만 저장
    await update(ref(database, `userStatus/${creatorId}`), {
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

// 방 참가
export const joinRoom = async (roomId: string, userId: string): Promise<boolean> => {
  if (!database || !auth.currentUser) return false;
  
  // 인증 상태 확인
  if (auth.currentUser.uid !== userId) {
    console.error('인증된 사용자 ID와 참여 시도 ID 불일치');
    return false;
  }

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

    // 이미 참여 중인 사용자는 인원 제한과 무관하게 재입장 허용
    const currentPlayers: string[] = roomData.players ? [...roomData.players] : [];
    const alreadyJoined = currentPlayers.includes(userId);

    // 최대 인원 제한 체크 (신규 입장자만)
    if (!alreadyJoined && currentPlayers.length >= roomData.maxPlayers) {
      console.error('방 인원이 가득 참:', roomId);
      return false;
    }

    // 플레이어 목록에 사용자 추가
    if (!alreadyJoined) {
      currentPlayers.push(userId);
      await update(roomRef, { players: currentPlayers });
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
    }
    
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
    
    return true;
  } catch (error) {
    console.error('방 참여 중 오류:', error);
    return false;
  }
};

// 방 상태 조회
export const getGameState = (roomId: string, callback: (gameState: GameState) => void) => {
  if (!database) {
    console.error('Firebase Database가 초기화되지 않았습니다.');
    return () => {};
  }

  const gameStateRef = ref(database, `rooms/${roomId}/gameState`);
  
  return onValue(gameStateRef, (snapshot) => {
    const gameState = snapshot.val() as GameState;
    callback(gameState);
  });
};

// 게임 시작 시도 - 트랜잭션으로 안전하게 SETUP -> PLAY 전환
// 두 클라이언트가 동시에 호출해도 한 번만 시작되며, 서로의 데이터를 덮어쓰지 않음
export const tryStartGame = async (roomId: string): Promise<boolean> => {
  if (!database) {
    console.error('Firebase Database가 초기화되지 않았습니다.');
    return false;
  }

  const gameStateRef = ref(database, `rooms/${roomId}/gameState`);

  try {
    const result = await runTransaction(gameStateRef, (state: any) => {
      // 로컬 캐시가 비어 있으면 그대로 반환 -> 서버 데이터로 재시도됨
      if (!state) return state;

      // 이미 시작되었거나 종료된 게임이면 중단
      if (state.phase !== GamePhase.SETUP) return;

      const players = state.players || {};
      const maps = state.maps || {};
      const playerIds = Object.keys(players);

      const enoughPlayers = playerIds.length >= 2;
      const allReady = playerIds.every((id) => players[id]?.isReady);
      const allMapsReady = playerIds.every((id) => maps[id]);

      // 시작 조건 미충족 -> 중단 (다른 클라이언트가 나중에 다시 시도)
      if (!enoughPlayers || !allReady || !allMapsReady) return;

      // 각 플레이어는 상대방이 만든 맵의 시작 위치에서 출발
      for (const playerId of playerIds) {
        const opponentId = playerIds.find((id) => id !== playerId);
        if (opponentId && maps[opponentId]?.startPosition) {
          players[playerId].position = maps[opponentId].startPosition;
        }
      }

      return {
        ...state,
        phase: GamePhase.PLAY,
        currentTurn: state.currentTurn || playerIds[0],
        players,
      };
    }, { applyLocally: false });

    if (result.committed) {
      console.log('게임 시작됨:', roomId);
    }
    return result.committed;
  } catch (error) {
    console.error('게임 시작 트랜잭션 오류:', error);
    return false;
  }
};

// 플레이어 준비 상태 설정
export const setPlayerReady = async (roomId: string, userId: string, isReady: boolean): Promise<void> => {
  try {
    const playerRef = ref(database, `rooms/${roomId}/gameState/players/${userId}`);
    await update(playerRef, { isReady });

    // 모든 플레이어가 준비되면 게임 시작
    if (isReady) {
      await tryStartGame(roomId);
    }
  } catch (error) {
    console.error('플레이어 준비 상태 설정 중 오류 발생:', error);
    throw error;
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

  try {
    console.log('맵 설정 중...', { roomId, userId });
    const mapRef = ref(database, `rooms/${roomId}/gameState/maps/${userId}`);
    await set(mapRef, map);

    // 맵 설정 후 자동으로 준비 상태로 설정
    const playerRef = ref(database, `rooms/${roomId}/gameState/players/${userId}`);
    await update(playerRef, { isReady: true });

    // 모든 플레이어가 준비되면 게임 시작 (트랜잭션이라 중복 호출돼도 안전)
    await tryStartGame(roomId);
  } catch (error) {
    console.error('맵 설정 중 오류 발생:', error);
    throw error;
  }
};

// 게임 종료
export const endGame = async (roomId: string, userId: string): Promise<void> => {
  if (!database) {
    console.error('Firebase Database가 초기화되지 않았습니다.');
    return;
  }

  const gameStateRef = ref(database, `rooms/${roomId}/gameState`);
  await update(gameStateRef, {
    phase: GamePhase.END,
    winner: userId
  });
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
    
    // 방에서 플레이어 제거
    const roomData = roomSnapshot.val();
    const players = roomData.players || [];
    const updatedPlayers = players.filter((id: string) => id !== userId);
    
    // 플레이어 목록 업데이트
    await update(roomRef, { players: updatedPlayers });
    
    // 방 참여 정보 제거
    await remove(ref(database, `rooms/${roomId}/joinedPlayers/${userId}`));
    
    // 게임 상태에서 플레이어 제거
    await remove(ref(database, `rooms/${roomId}/gameState/players/${userId}`));
    
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

// 현재 접속 상태 관리 함수
export const updateUserPresence = async (userId: string) => {
  if (!userId) return;
  
  const database = getDatabase();
  
  // 사용자 온라인 상태 참조
  const userStatusRef = ref(database, `status/${userId}`);
  
  // 연결 상태 참조
  const connectedRef = ref(database, '.info/connected');
  
  onValue(connectedRef, async (snapshot) => {
    // 연결되어 있지 않으면 종료
    if (snapshot.val() === false) {
      return;
    }
    
    // 연결이 끊어질 때 실행할 작업 등록
    onDisconnect(userStatusRef).remove();
    
    // 현재 상태를 온라인으로 설정
    await set(userStatusRef, {
      online: true,
      lastSeen: serverTimestamp()
    });
    
    // 사용자가 접속한 방 확인
    const userRoomsRef = ref(database, `userRooms/${userId}`);
    const userRoomsSnapshot = await get(userRoomsRef);
    const userRooms = userRoomsSnapshot.val();
    
    // 사용자가 속한 방들에 대해 온라인 상태 표시
    if (userRooms) {
      Object.keys(userRooms).forEach(async (roomId) => {
        const roomMemberRef = ref(database, `rooms/${roomId}/members/${userId}`);
        
        // 방에서 연결 끊어질 때 상태 변경
        onDisconnect(roomMemberRef).update({
          online: false,
          lastSeen: serverTimestamp()
        });
        
        // 현재 상태 업데이트
        await update(roomMemberRef, {
          online: true,
          lastSeen: serverTimestamp()
        });
      });
    }
  });
};

// 방 청소 함수 - 주기적으로 실행하여 빈 방 삭제
export const cleanUpEmptyRooms = async () => {
  const database = getDatabase();
  const roomsRef = ref(database, 'rooms');
  
  const roomsSnapshot = await get(roomsRef);
  const rooms = roomsSnapshot.val();
  
  if (!rooms) return;
  
  Object.entries(rooms).forEach(async ([roomId, roomData]: [string, any]) => {
    // 플레이어가 없는 방 삭제
    if (!roomData.players || roomData.players.length === 0) {
      await remove(ref(database, `rooms/${roomId}`));
      console.log(`빈 방 삭제: ${roomId}`);
    }
  });
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
    const mapsRef = ref(database, `rooms/${roomId}/gameState/maps`);
    const mapsSnapshot = await get(mapsRef);
    const maps = mapsSnapshot.val();
    
    if (maps && maps.null) {
      console.log('맵 데이터에서 null 키 제거');
      await remove(ref(database, `rooms/${roomId}/gameState/maps/null`));
    }
    
    // 플레이어 데이터에서 null 키 제거
    const playersRef = ref(database, `rooms/${roomId}/gameState/players`);
    const playersSnapshot = await get(playersRef);
    const players = playersSnapshot.val();
    
    if (players && players.null) {
      console.log('플레이어 데이터에서 null 키 제거');
      await remove(ref(database, `rooms/${roomId}/gameState/players/null`));
    }
    
    // 플레이어 목록에서 null 값 제거
    const roomRef = ref(database, `rooms/${roomId}`);
    const roomSnapshot = await get(roomRef);
    const room = roomSnapshot.val();
    
    if (room && room.players) {
      const cleanedPlayers = room.players.filter(id => id !== null && id !== 'null');
      if (cleanedPlayers.length !== room.players.length) {
        console.log('플레이어 목록에서 null 값 제거');
        await update(roomRef, { players: cleanedPlayers });
      }
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
    
    // 2. 플레이어 목록에 사용자가 포함되어 있는지 확인
    const playerExists = roomData.players && roomData.players.includes(userId);
    
    // 3. 게임 상태에 사용자 정보가 있는지 확인
    const playerStateExists = roomData.gameState?.players && roomData.gameState.players[userId];
    
    if (playerExists || playerStateExists) {
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
    
    // 플레이어 목록에 사용자가 없으면 추가
    if (!roomData.players || !roomData.players.includes(userId)) {
      console.log('방 참여자 목록에 추가:', userId);
      const updatedPlayers = roomData.players ? [...roomData.players, userId] : [userId];
      await update(roomRef, { players: updatedPlayers });
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

// 로비 온라인 사용자 상태 관리 (게임방과 별개)
export const updateUserOnlineStatus = async (userId: string) => {
  try {
    if (!userId) {
      console.error('유효하지 않은 사용자 ID로 온라인 상태 업데이트 시도');
      return false;
    }

    const auth = getAuth();
    const db = getDatabase();
    // 로비 온라인 상태를 위한 별도 경로 사용
    const userStatusRef = ref(db, `lobbyOnline/${userId}`);

    // 사용자 정보 (이메일 제외)
    const userData = {
      uid: userId,
      displayName: auth.currentUser?.displayName || '익명 사용자',
      photoURL: auth.currentUser?.photoURL || null,
      lastSeen: serverTimestamp(),
      isOnline: true
    };

    // 먼저 현재 연결 상태 확인
    const connectedRef = ref(db, '.info/connected');
    
    return new Promise((resolve) => {
      let unsubscribeFunc: (() => void) | null = null;
      
      unsubscribeFunc = onValue(connectedRef, async (snapshot) => {
        // 첫 번째 이벤트 후 리스너 제거 (한 번만 실행)
        if (unsubscribeFunc) {
          unsubscribeFunc();
        }
        
        if (snapshot.val() === false) {
          console.log('Firebase에 연결되지 않음, 로비 온라인 상태 업데이트 지연');
          resolve(false);
          return;
        }
        
        console.log(`사용자 ${userId}의 로비 온라인 상태 업데이트 시작`);
        
        try {
          // 현재 상태를 온라인으로 업데이트
          await set(userStatusRef, userData);
          
          // 연결 해제 시 실행될 작업 등록
          onDisconnect(userStatusRef).update({
            isOnline: false,
            lastSeen: serverTimestamp()
          });
          
          console.log(`사용자 ${userId}의 로비 온라인 상태 업데이트 완료, onDisconnect 핸들러 등록됨`);
          resolve(true);
        } catch (error) {
          console.error('로비 온라인 상태 업데이트 중 오류:', error);
          resolve(false);
        }
      });
    });
  } catch (error) {
    console.error('로비 온라인 상태 업데이트 오류:', error);
    return false;
  }
};

// 로비 온라인 사용자 목록 가져오기 (게임방과 별개)
export const getOnlineUsers = (callback: (users: UserProfile[]) => void) => {
  const db = getDatabase();
  // 로비 전용 온라인 상태 경로 사용
  const onlineUsersRef = ref(db, 'lobbyOnline');
  
  console.log('로비 온라인 사용자 목록 구독 시작');
  
  return onValue(onlineUsersRef, (snapshot) => {
    const users: UserProfile[] = [];
    
    if (snapshot.exists()) {
      console.log('로비 온라인 데이터 스냅샷:', snapshot.val());
      
      snapshot.forEach((childSnapshot) => {
        const userData = childSnapshot.val();
        console.log(`로비 사용자 데이터 확인: ${childSnapshot.key}`, userData);
        
        // null 체크와 isOnline 필드 확인
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
    
    console.log(`로비 온라인 사용자 ${users.length}명 발견:`, users.map(u => u.displayName));
    callback(users);
  });
};

// 게임방 내 사용자 온라인 상태 업데이트 (로비와 별개)
export const updateRoomUserStatus = async (roomId: string, userId: string, isOnline: boolean = true) => {
  if (!roomId || !userId) return false;
  
  try {
    const db = getDatabase();
    const auth = getAuth();
    
    const userStatusRef = ref(db, `rooms/${roomId}/playerStatus/${userId}`);
    
    const userData = {
      uid: userId,
      displayName: auth.currentUser?.displayName || '익명 사용자',
      photoURL: auth.currentUser?.photoURL || null,
      lastSeen: serverTimestamp(),
      isOnline: isOnline
    };
    
    // 방 내 사용자 상태 업데이트
    await update(userStatusRef, userData);
    
    // 게임 상태의 플레이어 정보도 업데이트
    if (isOnline) {
      const playerRef = ref(db, `rooms/${roomId}/gameState/players/${userId}`);
      await update(playerRef, { 
        isOnline: true,
        lastSeen: serverTimestamp()
      });
      
      // 방 참여 시 연결 종료 처리 설정
      const connectedRef = ref(db, '.info/connected');
      onValue(connectedRef, (snapshot) => {
        if (snapshot.val() === true) {
          onDisconnect(userStatusRef).update({
            isOnline: false,
            lastSeen: serverTimestamp()
          });
          
          onDisconnect(playerRef).update({
            isOnline: false,
            lastSeen: serverTimestamp()
          });
        }
      }, { onlyOnce: true });
    }
    
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
