'use client';

import { useState, useEffect } from 'react';
import { getDatabase, ref, onValue, serverTimestamp, update } from 'firebase/database';
import { getAuth } from 'firebase/auth';
import { UserProfile } from '@/types/game';

interface OnlineUsersProps {
  currentUserId: string;
}

const OnlineUsers: React.FC<OnlineUsersProps> = ({ currentUserId }) => {
  const [onlineUsers, setOnlineUsers] = useState<UserProfile[]>([]);
  const [isExpanded, setIsExpanded] = useState(true);

  useEffect(() => {
    const database = getDatabase();
    const auth = getAuth();
    
    // 현재 사용자의 온라인 상태 등록
    const updateUserOnlineStatus = async () => {
      const userStatusRef = ref(database, `online/${currentUserId}`);
      
      // 사용자 정보 준비
      const userData = {
        uid: currentUserId,
        displayName: auth.currentUser?.displayName || '익명 사용자',
        email: auth.currentUser?.email || null,
        photoURL: auth.currentUser?.photoURL || null,
        lastSeen: serverTimestamp(),
        isOnline: true
      };
      
      // 상태 업데이트
      await update(userStatusRef, userData);
      
      // 연결 종료 시 처리
      const connectedRef = ref(database, '.info/connected');
      onValue(connectedRef, (snap) => {
        if (snap.val() === true) {
          // 연결 종료 시 상태 업데이트
          const onDisconnectRef = ref(database, `online/${currentUserId}`);
          update(onDisconnectRef, {
            ...userData,
            isOnline: false,
            lastSeen: serverTimestamp()
          });
        }
      });
    };
    
    // 온라인 사용자 목록 가져오기
    const onlineUsersRef = ref(database, 'online');
    const unsubscribe = onValue(onlineUsersRef, (snapshot) => {
      const users: UserProfile[] = [];
      
      if (snapshot.exists()) {
        snapshot.forEach((childSnapshot) => {
          const userData = childSnapshot.val();
          if (userData.isOnline) {
            users.push({
              uid: userData.uid,
              displayName: userData.displayName || '익명 사용자',
              email: userData.email || null,
              photoURL: userData.photoURL || null
            });
          }
        });
      }
      
      setOnlineUsers(users);
    });
    
    // 현재 사용자 온라인 상태 등록
    updateUserOnlineStatus();
    
    return () => {
      unsubscribe();
    };
  }, [currentUserId]);

  return (
    <div className="bg-white shadow-md rounded-lg p-4 mb-4">
      <div 
        className="flex justify-between items-center cursor-pointer" 
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <h2 className="text-lg font-semibold">접속 중인 유저 ({onlineUsers.length})</h2>
        <span className="text-gray-500">
          {isExpanded ? '▼' : '▶'}
        </span>
      </div>
      
      {isExpanded && (
        <div className="mt-3">
          {onlineUsers.length === 0 ? (
            <p className="text-gray-500">접속 중인 유저가 없습니다.</p>
          ) : (
            <ul className="divide-y divide-gray-200">
              {onlineUsers.map((user) => (
                <li key={user.uid} className="py-2 flex items-center">
                  {user.photoURL ? (
                    <img 
                      src={user.photoURL} 
                      alt={user.displayName || '유저'} 
                      className="w-8 h-8 rounded-full mr-2 object-cover"
                    />
                  ) : (
                    <div className="w-8 h-8 bg-blue-500 rounded-full mr-2 flex items-center justify-center">
                      <span className="text-white font-medium">
                        {user.displayName ? user.displayName.charAt(0).toUpperCase() : '?'}
                      </span>
                    </div>
                  )}
                  <div>
                    <p className="font-medium">
                      {user.displayName} 
                      {user.uid === currentUserId && <span className="text-xs text-blue-500 ml-1">(나)</span>}
                    </p>
                    <p className="text-xs text-gray-500">{user.email}</p>
                  </div>
                  <span className="ml-auto w-2 h-2 bg-green-500 rounded-full"></span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
};

export default OnlineUsers; 