'use client';

import { useEffect, useState } from 'react';
import { getDatabase, ref, onValue, update, get, onDisconnect, serverTimestamp, set } from 'firebase/database';
import {
  armOwnerRoomDisconnectCleanup,
  cleanupNullKeys,
  checkRoomMembership,
  rejoinRoom,
} from '../lib/firebase';
import { getAuth } from 'firebase/auth';

/**
 * 사용자의 방 참여 상태를 관리하는 커스텀 훅
 * - 방에 입장 시 참여자 정보 업데이트
 * - 브라우저 종료 또는 네트워크 연결 끊김 시 자동으로 오프라인 상태로 변경
 * - 새로고침 시 방 참여 상태 복원
 */
export function useRoomPresence(userId: string, roomId: string) {
  const [isConnected, setIsConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!userId || !roomId) {
      console.log('방 참여를 위한 유효한 사용자 ID 또는 방 ID가 없음');
      return;
    }

    const auth = getAuth();
    const database = getDatabase();
    
    // 인증 상태 직접 확인
    if (!auth.currentUser) {
      console.error('인증되지 않은 사용자로 방 참여 시도');
      setError('인증되지 않은 사용자입니다. 다시 로그인해주세요.');
      return;
    }
    
    // 사용자 ID 일치 여부 확인
    if (auth.currentUser.uid !== userId) {
      console.error('인증된 사용자 ID와 전달된 사용자 ID 불일치');
      setError('인증 정보가 일치하지 않습니다. 다시 로그인해주세요.');
      return;
    }
    
    // 이전에 명시적으로 나간 방인지 확인
    const hasLeftRoom = sessionStorage.getItem(`left_room_${roomId}`) === 'true';
    
    if (hasLeftRoom) {
      console.log('현재 세션에서 나간 방입니다. 로컬 데이터 초기화 후 재참여합니다.');
      // 세션 데이터 초기화
      sessionStorage.removeItem(`left_room_${roomId}`);
    }
    
    // Firebase에서 방 참여 상태 확인 및 복원
    const checkMembership = async () => {
      try {
        // 인증 확인
        if (!auth.currentUser) {
          console.error('인증되지 않은 사용자');
          setError('인증되지 않은 사용자입니다. 다시 로그인해주세요.');
          return;
        }
        
        // 토큰 갱신 시도
        try {
          await auth.currentUser.getIdToken(true);
          console.log('방 참여 전 토큰 갱신 성공');
        } catch (e) {
          console.error('방 참여 전 토큰 갱신 실패:', e);
          setError('인증 토큰을 갱신할 수 없습니다. 다시 로그인해주세요.');
          return;
        }
        
        // 방 참여 상태 확인
        const isMember = await checkRoomMembership(userId, roomId);
        
        if (isMember) {
          console.log('기존 방 참여 상태 확인됨, 재참여 처리');
          const success = await rejoinRoom(userId, roomId);
          if (success) {
            console.log('방 재참여 성공');
            setIsConnected(true);
          }
        }
      } catch (error) {
        console.error('방 참여 상태 확인 중 오류:', error);
      }
    };
    
    // 초기 실행
    checkMembership();
    
    // 연결 상태 관리
    const handlePresence = async () => {
      try {
        if (!userId) {
          console.error('유효하지 않은 사용자 ID로 방 참여 시도');
          setError('유효하지 않은 사용자 ID입니다. 다시 로그인해주세요.');
          return null;
        }

        console.log('방 참여 상태 설정 시작:', roomId);
        
        // 사용자 상태 노드
        const userStatusRef = ref(database, `userStatus/${userId}`);
        
        // 방 참여자 노드
        const roomMemberRef = ref(database, `rooms/${roomId}/members/${userId}`);

        // 게임방에서 표시하는 온라인 상태 노드
        const roomPlayerStatusRef = ref(database, `rooms/${roomId}/playerStatus/${userId}`);
        
        // 방 참여 상태 노드 - Firebase에서만 추적
        const roomJoinRef = ref(database, `rooms/${roomId}/joinedPlayers/${userId}`);
        
        // 연결 상태 확인
        const connectedRef = ref(database, '.info/connected');
        
        // 방 기본 정보 조회
        const roomRef = ref(database, `rooms/${roomId}`);
        const roomSnapshot = await get(roomRef);
        const roomData = roomSnapshot.val();
        
        if (!roomData) {
          console.error('방을 찾을 수 없습니다:', roomId);
          setError('방을 찾을 수 없습니다.');
          return null;
        }
        
        // 방 데이터 자동 정리 (null 키 제거)
        await cleanupNullKeys(roomId);
        
        // 복원된 사용자가 이미 방에 속해 있는지 확인
        const playerExists = roomData.players && roomData.players.includes(userId);
        const gamePlayerExists = !!roomData.gameState?.players?.[userId];
        const isSpectator = roomData.gameState?.phase !== 'setup' && !gamePlayerExists;
        let rejoined = false;
        
        if (!playerExists && !isSpectator) {
          console.log('방 참여자 목록에 추가:', userId);
          const updatedPlayers = roomData.players ? [...roomData.players, userId] : [userId];
          await update(roomRef, { players: updatedPlayers });
          rejoined = true;
        } else if (gamePlayerExists) {
          console.log('사용자가 이미 방에 속해 있음:', userId);
          // 존재하는 플레이어의 상태 업데이트
          if (roomData.gameState?.players && roomData.gameState.players[userId]) {
            await update(ref(database, `rooms/${roomId}/gameState/players/${userId}`), {
              id: userId,
              lastSeen: serverTimestamp()
            });
            rejoined = true;
          }
        }
        
        // Firebase에 방 참여 상태 기록
        if (rejoined) {
          await set(roomJoinRef, {
            joined: true,
            joinedAt: serverTimestamp(),
            displayName: auth.currentUser?.displayName || '익명 사용자',
            photoURL: auth.currentUser?.photoURL || null
          });
        }
        
        // 사용자와 방 연결 정보 업데이트
        await set(ref(database, `userRooms/${userId}/${roomId}`), {
          joinedAt: serverTimestamp()
        });
        
        // 연결 상태 감지
        return onValue(connectedRef, async (snapshot) => {
          const connected = snapshot.val();
          setIsConnected(!!connected);
          
          if (connected) {
            // 재연결 때 초기 스냅샷을 그대로 쓰면 삭제된 방이 다시 생길 수 있다.
            const currentRoomSnapshot = await get(roomRef);
            if (!currentRoomSnapshot.exists()) {
              await update(userStatusRef, {
                online: true,
                currentRoom: null,
                lastSeen: serverTimestamp()
              }).catch(() => {});
              setError('방을 찾을 수 없습니다.');
              return;
            }

            const currentRoomData = currentRoomSnapshot.val();
            const isRoomOwner = currentRoomData.createdBy === userId;
            const currentGamePlayerExists = !!currentRoomData.gameState?.players?.[userId];
            const currentIsSpectator = currentRoomData.gameState?.phase !== 'setup' && !currentGamePlayerExists;

            if (isRoomOwner) {
              const armed = await armOwnerRoomDisconnectCleanup(roomId, userId);
              if (!armed) {
                setError('방 연결 상태를 설정할 수 없습니다.');
                return;
              }
            } else {
              const disconnectOperations: Promise<void>[] = [
                onDisconnect(roomMemberRef).update({
                  online: false,
                  lastSeen: serverTimestamp()
                }),
                onDisconnect(roomPlayerStatusRef).update({
                  isOnline: false,
                  lastSeen: serverTimestamp()
                })
              ];

              if (!currentIsSpectator) {
                disconnectOperations.push(
                  onDisconnect(roomJoinRef).update({
                    joined: true,
                    offline: true,
                    lastSeen: serverTimestamp()
                  })
                );
              }

              if (currentGamePlayerExists) {
                disconnectOperations.push(
                  onDisconnect(ref(database, `rooms/${roomId}/gameState/players/${userId}`)).update({
                    isOnline: false,
                    lastSeen: serverTimestamp()
                  })
                );
              }

              await Promise.all(disconnectOperations);
            }

            await onDisconnect(userStatusRef).update({
              online: false,
              currentRoom: null,
              lastSeen: serverTimestamp()
            });
            
            // 현재 상태 업데이트
            await update(roomMemberRef, {
              online: true,
              displayName: auth.currentUser?.displayName || '익명 사용자',
              photoURL: auth.currentUser?.photoURL || null,
              lastSeen: serverTimestamp()
            });

            await update(roomPlayerStatusRef, {
              uid: userId,
              isOnline: true,
              displayName: auth.currentUser?.displayName || '익명 사용자',
              photoURL: auth.currentUser?.photoURL || null,
              lastSeen: serverTimestamp()
            });
            
            await update(userStatusRef, {
              online: true,
              currentRoom: roomId,
              lastSeen: serverTimestamp()
            });
            
            // 게임 상태의 플레이어 상태도 온라인으로 업데이트
            if (currentGamePlayerExists) {
              await update(ref(database, `rooms/${roomId}/gameState/players/${userId}`), {
                isOnline: true,
                lastSeen: serverTimestamp()
              });
            }
            
            console.log('방 참여 상태 설정 완료:', roomId);
          }
        });
      } catch (error) {
        console.error('방 참여 상태 설정 중 오류:', error);
        setError('방 참여 상태 설정 중 오류가 발생했습니다.');
        return null;
      }
    };
    
    // 연결 관리 시작
    const unsubscribePromise = handlePresence();
    
    // 컴포넌트 언마운트 시 구독 해제
    return () => {
      unsubscribePromise.then(unsubscribe => {
        if (unsubscribe) unsubscribe();
      });
    };
  }, [userId, roomId]);

  return { isConnected, error };
}
