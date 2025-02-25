'use client';

import { initializeApp } from 'firebase/app';
import { getDatabase, ref, onValue, set, push, update, remove } from 'firebase/database';
import { getAuth, signInAnonymously } from 'firebase/auth';
import { Room, GameState, GamePhase, SocketEvents, GameMap } from '@/types/game';

// Firebase 설정
// 실제 프로젝트에서는 환경 변수를 사용하세요
const firebaseConfig = {
  apiKey: "AIzaSyBxHJ14JjS3DOHHR9xwLGjIKdBJp8cD448",
  authDomain: "daemok-155c1.firebaseapp.com",
  databaseURL: "https://daemok-155c1-default-rtdb.asia-southeast1.firebasedatabase.app/",
  projectId: "daemok-155c1",
  storageBucket: "daemok-155c1.firebasestorage.app",
  messagingSenderId: "991265301980",
  appId: "1:991265301980:web:13a56cb9609cdb92d5db19",
  measurementId: "G-3HXC4G5MTG"
};

// Firebase 초기화
const app = initializeApp(firebaseConfig);
const database = getDatabase(app);
const auth = getAuth(app);

// 익명 로그인 처리
export const signInAnonymousUser = async () => {
  try {
    const userCredential = await signInAnonymously(auth);
    return userCredential.user.uid;
  } catch (error) {
    console.error('익명 로그인 실패:', error);
    return null;
  }
};

// 방 목록 조회
export const getRooms = (callback: (rooms: Room[]) => void) => {
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
  const gameStateRef = ref(database, `rooms/${roomId}/gameState`);
  await update(gameStateRef, {
    phase: GamePhase.END,
    winner: userId
  });
};

// 방 나가기
export const leaveRoom = async (roomId: string, userId: string): Promise<void> => {
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

// 사용자 ID 생성 (임시 방법)
export const generateUserId = (): string => {
  return `user_${Math.random().toString(36).substring(2, 9)}`;
}; 