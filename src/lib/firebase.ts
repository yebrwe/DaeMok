'use client';

import { initializeApp } from 'firebase/app';
import { getDatabase, ref, onValue, set, push, update, remove, get, onDisconnect, serverTimestamp } from 'firebase/database';
import { 
  getAuth, 
  GoogleAuthProvider, 
  signInWithPopup, 
  signOut, 
  setPersistence, 
  browserLocalPersistence,
  onIdTokenChanged
} from 'firebase/auth';
import { getAnalytics, isSupported } from 'firebase/analytics';
import { Room, GameState, GamePhase, SocketEvents, GameMap } from '@/types/game';

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
    const roomsList: Room[] = data 
      ? Object.values(data as Record<string, Room>) 
      : [];
    callback(roomsList);
  }, (error) => {
    console.error('방 목록 조회 오류:', error);
    callback([]);
  });
};

// 방 생성
export const createRoom = async (name: string, creatorId: string, maxPlayers: number = 2): Promise<string | null> => {
  if (!database) {
    console.error('Firebase Database가 초기화되지 않았습니다.');
    return null;
  }
  
  console.log('방 생성 시도...', { name, creatorId, maxPlayers });
  
  try {
    // 기본 방 정보 생성
    const roomsRef = ref(database, 'rooms');
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
      turn: 0,
      currentPlayer: creatorId,
      players: {
        [creatorId]: {
          id: creatorId,
          position: { row: 0, col: 0 },
          isReady: false,
          isOnline: true,
          lastSeen: now
        }
      },
      map: null,
      obstacles: [],
      winner: null,
      startedAt: null,
      endedAt: null
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
    
    // 사용자-방 매핑 정보 저장
    await set(ref(database, `userRooms/${creatorId}/${roomId}`), {
      joinedAt: now,
      lastSeen: now,
      active: true
    });
    
    // 사용자 상태 업데이트
    await update(ref(database, `userStatus/${creatorId}`), {
      currentRoom: roomId,
      lastActivity: now
    });
    
    return roomId;
  } catch (error) {
    console.error('방 생성 중 오류:', error);
    return null;
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
    
    // 최대 인원 제한 체크
    if (roomData.players && roomData.players.length >= roomData.maxPlayers) {
      console.error('방 인원이 가득 참:', roomId);
      return false;
    }
    
    // 플레이어 목록에 사용자 추가
    const updatedPlayers = roomData.players ? [...roomData.players] : [];
    if (!updatedPlayers.includes(userId)) {
      updatedPlayers.push(userId);
      await update(roomRef, { players: updatedPlayers });
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
    
    // 사용자-방 매핑 정보 저장
    await update(ref(database, `userRooms/${userId}/${roomId}`), {
      joinedAt: serverTimestamp(),
      lastSeen: serverTimestamp(),
      active: true
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

// 플레이어 준비 상태 설정
export const setPlayerReady = async (roomId: string, userId: string, isReady: boolean): Promise<void> => {
  try {
    const playerRef = ref(database, `rooms/${roomId}/gameState/players/${userId}`);
    await update(playerRef, { isReady });
    
    // 모든 플레이어가 준비 상태이고 맵도 설정되었는지 확인
    const roomRef = ref(database, `rooms/${roomId}`);
    
    return new Promise<void>((resolve, reject) => {
      onValue(roomRef, async (snapshot) => {
        try {
          const room = snapshot.val() as Room;
          
          if (!room || !room.gameState) {
            console.error('방 정보가 없습니다!', { room });
            resolve();
            return;
          }
          
          console.log('플레이어 준비 상태 설정 후 게임 상태 확인:', {
            phase: room.gameState.phase,
            players: Object.keys(room.gameState.players || {}),
            playersReady: Object.values(room.gameState.players || {}).map(p => p.isReady),
            maps: Object.keys(room.gameState.maps || {})
          });
          
          // 게임 시작 조건 확인 - gameState.players 객체를 기준으로 검사
          const playerValues = Object.values(room.gameState.players || {});
          const allPlayersReady = playerValues.length > 0 && playerValues.every(p => p.isReady);
          const playerIds = Object.keys(room.gameState.players || {});
          const mapsKeys = Object.keys(room.gameState.maps || {});
          
          // players 배열이 비어 있더라도 gameState.players 객체로 플레이어 수 확인
          const allMapsReady = mapsKeys.length > 0 && mapsKeys.length === playerIds.length;
          const enoughPlayers = playerIds.length >= 2;
          
          console.log('준비 상태 설정 후 게임 시작 조건 확인:', {
            allPlayersReady,
            allMapsReady,
            enoughPlayers,
            playerValues,
            playerIds,
            mapsKeys,
            playersLength: playerIds.length
          });
          
          // 모든 게임 시작 조건이 충족되면 게임 시작
          if (allPlayersReady && allMapsReady && enoughPlayers) {
            console.log('setPlayerReady에서 모든 게임 시작 조건 충족! 게임을 시작합니다');
            const gameStateRef = ref(database, `rooms/${roomId}/gameState`);
            
            // 첫 번째 턴 설정 (랜덤) - players 배열 대신 gameState.players 객체 키를 사용
            const playerIds = Object.keys(room.gameState.players || {});
            if (playerIds.length === 0) {
              console.error('플레이어 목록이 비어있습니다!');
              resolve();
              return;
            }
            
            const randomIndex = Math.floor(Math.random() * playerIds.length);
            const currentTurn = playerIds[randomIndex];
            console.log('첫 턴 설정:', { randomIndex, currentTurn, playerIds });
            
            // 플레이어 시작 위치 설정
            const updatedPlayers = { ...room.gameState.players };
            
            for (const playerId of playerIds) {
              const opponentIds = playerIds.filter(id => id !== playerId);
              if (opponentIds.length > 0) {
                const opponentId = opponentIds[0]; // 첫 번째 상대만 사용
                if (room.gameState.maps?.[opponentId]) {
                  updatedPlayers[playerId].position = room.gameState.maps[opponentId].startPosition;
                  console.log(`플레이어 ${playerId}의 시작 위치 설정:`, updatedPlayers[playerId].position);
                } else {
                  console.error(`상대 ${opponentId}의 맵이 없습니다!`);
                }
              }
            }
            
            const updateData = {
              phase: GamePhase.PLAY,
              currentTurn,
              players: updatedPlayers
            };
            
            console.log('게임 상태 업데이트:', updateData);
            await update(gameStateRef, updateData);
            console.log('게임 상태 업데이트 완료! 게임 시작됨');
          } else {
            console.log('아직 게임 시작 조건이 충족되지 않았습니다. 대기 중...');
          }
          
          resolve();
        } catch (error) {
          console.error('준비 상태 설정 중 오류 발생:', error);
          reject(error);
        }
      }, { onlyOnce: true });
    });
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
    console.log('맵 설정 중...', { roomId, userId, map });
    const mapRef = ref(database, `rooms/${roomId}/gameState/maps/${userId}`);
    await set(mapRef, map);
    console.log('맵 설정 완료');
    
    // 맵 설정 후 자동으로 준비 상태로 설정
    const playerRef = ref(database, `rooms/${roomId}/gameState/players/${userId}`);
    await update(playerRef, { isReady: true });
    console.log('플레이어 준비 상태 업데이트 완료');
    
    // 다른 플레이어도 준비 상태인지 확인하고 게임 시작 조건 확인
    console.log('방 정보 조회 시작');
    const roomRef = ref(database, `rooms/${roomId}`);
    
    return new Promise<void>((resolve, reject) => {
      onValue(roomRef, async (snapshot) => {
        try {
          console.log('방 정보 수신 완료');
          const room = snapshot.val() as Room;
          
          if (!room || !room.gameState) {
            console.error('방 정보가 없습니다!', { room });
            resolve();
            return;
          }
          
          console.log('맵 설정 후 게임 상태 확인:', {
            phase: room.gameState.phase,
            players: Object.keys(room.gameState.players || {}),
            playersReady: Object.values(room.gameState.players || {}).map(p => p.isReady),
            maps: Object.keys(room.gameState.maps || {})
          });
          
          // 게임 시작 조건 확인 - gameState.players 객체를 기준으로 검사
          const playerValues = Object.values(room.gameState.players || {});
          const allPlayersReady = playerValues.length > 0 && playerValues.every(p => p.isReady);
          const playerIds = Object.keys(room.gameState.players || {});
          const mapsKeys = Object.keys(room.gameState.maps || {});
          
          // players 배열이 비어 있더라도 gameState.players 객체로 플레이어 수 확인
          const allMapsReady = mapsKeys.length > 0 && mapsKeys.length === playerIds.length;
          const enoughPlayers = playerIds.length >= 2;
          
          console.log('게임 시작 조건 상세 확인:', {
            allPlayersReady,
            allMapsReady,
            enoughPlayers,
            playerValues,
            playerIds,
            mapsKeys,
            playersLength: playerIds.length
          });
          
          // 모든 게임 시작 조건이 충족되면 게임 시작
          if (allPlayersReady && allMapsReady && enoughPlayers) {
            console.log('모든 게임 시작 조건 충족! 게임을 시작합니다');
            const gameStateRef = ref(database, `rooms/${roomId}/gameState`);
            
            // 첫 번째 턴 설정 (랜덤) - players 배열 대신 gameState.players 객체 키를 사용
            const playerIds = Object.keys(room.gameState.players || {});
            if (playerIds.length === 0) {
              console.error('플레이어 목록이 비어있습니다!');
              resolve();
              return;
            }
            
            const randomIndex = Math.floor(Math.random() * playerIds.length);
            const currentTurn = playerIds[randomIndex];
            console.log('첫 턴 설정:', { randomIndex, currentTurn, playerIds });
            
            // 플레이어 시작 위치 설정
            const updatedPlayers = { ...room.gameState.players };
            
            for (const playerId of playerIds) {
              const opponentIds = playerIds.filter(id => id !== playerId);
              if (opponentIds.length > 0) {
                const opponentId = opponentIds[0]; // 첫 번째 상대만 사용
                if (room.gameState.maps?.[opponentId]) {
                  updatedPlayers[playerId].position = room.gameState.maps[opponentId].startPosition;
                  console.log(`플레이어 ${playerId}의 시작 위치 설정:`, updatedPlayers[playerId].position);
                } else {
                  console.error(`상대 ${opponentId}의 맵이 없습니다!`);
                }
              }
            }
            
            const updateData = {
              phase: GamePhase.PLAY,
              currentTurn,
              players: updatedPlayers
            };
            
            console.log('게임 상태 업데이트:', updateData);
            await update(gameStateRef, updateData);
            console.log('게임 상태 업데이트 완료! 게임 시작됨');
          } else {
            console.log('아직 게임 시작 조건이 충족되지 않았습니다. 대기 중...');
          }
          
          resolve();
        } catch (error) {
          console.error('게임 시작 처리 중 오류 발생:', error);
          reject(error);
        }
      }, { onlyOnce: true });
    });
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
  if (!database) {
    console.error('Firebase Database가 초기화되지 않았습니다.');
    return false;
  }

  try {
    console.log('방 나가기 시도:', { roomId, userId });
    
    // 1. 모든 관련 경로에서 플레이어 데이터 삭제
    const roomRef = ref(database, `rooms/${roomId}`);
    const roomSnapshot = await get(roomRef);
    
    if (!roomSnapshot.exists()) {
      console.error('존재하지 않는 방입니다.');
      return false;
    }
    
    const room = roomSnapshot.val();
    
    // 플레이어 목록에서 제거
    if (room.players && room.players.includes(userId)) {
      const updatedPlayers = room.players.filter(id => id !== userId);
      await update(roomRef, { players: updatedPlayers });
    }
    
    // 2. 게임 상태에서 플레이어 정보 명시적으로 제거
    if (room.gameState && room.gameState.players && room.gameState.players[userId]) {
      // 플레이어 상태를 완전히 삭제하지 않고 오프라인 상태로 표시 (기록 유지 목적)
      await update(ref(database, `rooms/${roomId}/gameState/players/${userId}`), {
        isOnline: false,
        hasLeft: true, // 명시적으로 나간 상태 표시
        lastSeen: serverTimestamp()
      });
    }
    
    // 3. 방 참여 상태 명확히 제거
    await remove(ref(database, `rooms/${roomId}/joinedPlayers/${userId}`));
    
    // 4. 방 멤버 상태 업데이트
    await update(ref(database, `rooms/${roomId}/members/${userId}`), {
      online: false,
      hasLeft: true,
      leftAt: serverTimestamp()
    });
    
    // 5. 사용자-방 연결 정보 업데이트
    await update(ref(database, `userRooms/${userId}/${roomId}`), {
      active: false,
      leftAt: serverTimestamp()
    });
    
    // 6. 사용자 상태 업데이트
    await update(ref(database, `userStatus/${userId}`), {
      online: true, // 앱에서는 여전히 온라인이지만
      currentRoom: null, // 현재 방은 없음
      lastSeen: serverTimestamp()
    });
    
    // 7. 다른 플레이어들에게 나간 이벤트 알림 (선택 사항)
    await push(ref(database, `rooms/${roomId}/events`), {
      type: 'PLAYER_LEFT',
      userId: userId,
      displayName: auth.currentUser?.displayName || '익명 사용자',
      timestamp: serverTimestamp()
    });
    
    console.log('방 나가기 성공');
    return true;
  } catch (error) {
    console.error('방 나가기 오류:', error);
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
  if (!auth?.currentUser || !database) return null;
  
  try {
    const userId = auth.currentUser.uid;
    // 사용자가 속한 방 찾기
    const userRoomsRef = ref(database, `userRooms/${userId}`);
    const userRoomsSnapshot = await get(userRoomsRef);
    const userRooms = userRoomsSnapshot.val();
    
    if (!userRooms) return null;
    
    // 가장 최근에 활동한 방 찾기
    const roomEntries = Object.entries(userRooms);
    if (roomEntries.length === 0) return null;
    
    // 마지막 활동 시간 기준으로 정렬
    roomEntries.sort((a, b) => {
      const lastSeenA = a[1].lastSeen || 0;
      const lastSeenB = b[1].lastSeen || 0;
      return lastSeenB - lastSeenA;
    });
    
    // 가장 최근 방 ID
    const [mostRecentRoomId] = roomEntries[0];
    
    // 방 존재 확인
    const roomRef = ref(database, `rooms/${mostRecentRoomId}`);
    const roomSnapshot = await get(roomRef);
    
    if (!roomSnapshot.exists()) {
      console.log('방이 존재하지 않음');
      return null;
    }
    
    console.log('최근 활동 방 발견:', mostRecentRoomId);
    return mostRecentRoomId;

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