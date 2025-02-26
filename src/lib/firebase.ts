'use client';

import { initializeApp } from 'firebase/app';
import { getDatabase, ref, onValue, set, push, update, remove } from 'firebase/database';
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut } from 'firebase/auth';
import { getAnalytics, isSupported } from 'firebase/analytics';
import { Room, GameState, GamePhase, SocketEvents, GameMap } from '@/types/game';

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
let app;
let auth;
let database;

// 클라이언트 사이드에서만 Firebase 초기화
if (typeof window !== 'undefined') {
  try {
    app = initializeApp(firebaseConfig);
    database = getDatabase(app);
    auth = getAuth(app);
    console.log('Firebase 초기화 성공');
  } catch (error) {
    console.error('Firebase 초기화 오류:', error);
  }
}

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
export const createRoom = async (name: string, userId: string): Promise<string> => {
  if (!database) {
    console.error('Firebase Database가 초기화되지 않았습니다.');
    throw new Error('데이터베이스 초기화 오류');
  }

  console.log('방 생성 시도...', { name, userId });
  const roomsRef = ref(database, 'rooms');
  const newRoomRef = push(roomsRef);
  const roomId = newRoomRef.key as string;
  
  const newRoom: Room = {
    id: roomId,
    name,
    players: [userId],
    gameState: {
      phase: GamePhase.SETUP,
      players: {
        [userId]: {
          id: userId,
          position: { row: 0, col: 0 },
          isReady: false,
        },
      },
      currentTurn: null,
      maps: {},
      winner: null,
    },
    maxPlayers: 2,
  };
  
  try {
    await set(newRoomRef, newRoom);
    console.log('방 생성 성공:', roomId);
    return roomId;
  } catch (error) {
    console.error('방 생성 오류:', error);
    throw error;
  }
};

// 방 참가
export const joinRoom = async (roomId: string, userId: string): Promise<boolean> => {
  if (!database) {
    console.error('Firebase Database가 초기화되지 않았습니다.');
    return false;
  }

  console.log('방 참가 시도...', { roomId, userId });
  const roomRef = ref(database, `rooms/${roomId}`);
  
  return new Promise((resolve) => {
    onValue(roomRef, async (snapshot) => {
      console.log('방 정보 수신:', snapshot.val());
      const room = snapshot.val() as Room;
      
      if (!room) {
        console.log('방을 찾을 수 없음');
        resolve(false);
        return;
      }
      
      if ((room.players?.length || 0) >= room.maxPlayers) {
        console.log('방이 가득 참');
        resolve(false);
        return;
      }
      
      // 이미 참가한 경우 (플레이어 리스트에 있는 경우)
      if (room.players?.includes(userId)) {
        console.log('이미 참가한 방, 플레이어 정보 유지');
        // 기존 플레이어 정보가 이미 있으면 그대로 유지
        resolve(true);
        return;
      }
      
      // 기존에 방에 있었던 플레이어인지 확인 (게임 상태에 플레이어 정보가 있는지)
      const existingPlayerInfo = room.gameState?.players?.[userId];
      
      // 새 플레이어 추가
      const updatedPlayers = [...(room.players || []), userId];
      const updatedGameState = {
        ...(room.gameState || {}),
        players: {
          ...(room.gameState?.players || {}),
          [userId]: existingPlayerInfo || { // 기존 정보가 있으면 재사용, 없으면 새로 생성
            id: userId,
            position: { row: 0, col: 0 },
            isReady: false,
          }
        }
      };
      
      try {
        await update(roomRef, {
          players: updatedPlayers,
          gameState: updatedGameState
        });
        console.log('방 참가 성공');
        resolve(true);
      } catch (error) {
        console.error('방 참가 오류:', error);
        resolve(false);
      }
    }, { onlyOnce: true });
  });
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
export const leaveRoom = async (roomId: string, userId: string): Promise<void> => {
  if (!database) {
    console.error('Firebase Database가 초기화되지 않았습니다.');
    return;
  }

  console.log('방 나가기 시도...', { roomId, userId });
  const roomRef = ref(database, `rooms/${roomId}`);
  
  return new Promise((resolve) => {
    onValue(roomRef, async (snapshot) => {
      console.log('방 정보 수신:', snapshot.val());
      const room = snapshot.val() as Room;
      
      if (!room) {
        console.log('방을 찾을 수 없음');
        resolve();
        return;
      }
      
      // 플레이어 제거 (players 배열에서만 제거하고 gameState.players에서는 유지)
      const updatedPlayers = room.players?.filter(id => id !== userId) || [];
      console.log('업데이트된 플레이어 목록:', updatedPlayers);
      
      // 게임 상태에서는 플레이어 정보를 유지하되 온라인 상태만 변경
      if (room.gameState && room.gameState.players && room.gameState.players[userId]) {
        // 플레이어 정보는 그대로 유지하고 players 배열에서만 제거
        try {
          await update(roomRef, {
            players: updatedPlayers
          });
          console.log('방 업데이트 성공 (플레이어 연결 상태만 변경)');
        } catch (error) {
          console.error('방 업데이트 오류:', error);
        }
      }
      
      resolve();
    }, { onlyOnce: true });
  });
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