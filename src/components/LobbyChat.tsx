'use client';

import { useState, useEffect, useRef } from 'react';
import { getDatabase, ref, onValue, push, serverTimestamp, update, get } from 'firebase/database';
import { getAuth } from 'firebase/auth';
import { UserProfile } from '@/types/game';
import { updateUserOnlineStatus, getOnlineUsers } from '@/lib/firebase';

interface ChatMessage {
  id: string;
  userId: string;
  userName: string;
  photoURL?: string | null;
  text: string;
  timestamp: number;
}

interface LobbyChatProps {
  currentUserId: string;
}

const LobbyChat: React.FC<LobbyChatProps> = ({ currentUserId }) => {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [newMessage, setNewMessage] = useState('');
  const [onlineUsers, setOnlineUsers] = useState<UserProfile[]>([]);
  const [activeTab, setActiveTab] = useState<'chat' | 'users'>('chat');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  
  // 새 메시지가 추가될 때마다 스크롤 아래로 이동
  useEffect(() => {
    if (messagesEndRef.current && activeTab === 'chat') {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, activeTab]);
  
  // 메시지 가져오기
  useEffect(() => {
    const database = getDatabase();
    const chatRef = ref(database, 'lobbyChat');
    
    const unsubscribe = onValue(chatRef, (snapshot) => {
      const newMessages: ChatMessage[] = [];
      
      if (snapshot.exists()) {
        snapshot.forEach((childSnapshot) => {
          const key = childSnapshot.key;
          const data = childSnapshot.val();
          
          newMessages.push({
            id: key as string,
            userId: data.userId,
            userName: data.userName,
            photoURL: data.photoURL,
            text: data.text,
            timestamp: data.timestamp
          });
        });
        
        // 타임스탬프 기준으로 정렬
        newMessages.sort((a, b) => a.timestamp - b.timestamp);
        
        // 최대 100개 메시지만 유지
        const limitedMessages = newMessages.slice(-100);
        setMessages(limitedMessages);
      }
    });
    
    return () => {
      unsubscribe();
    };
  }, []);
  
  // 온라인 상태 관리 로직 개선
  useEffect(() => {
    if (!currentUserId) return;
    
    console.log('로비 채팅 컴포넌트 마운트 - 온라인 상태 설정');
    
    // 사용자 온라인 상태 업데이트
    const updateOnlineStatus = async () => {
      try {
        await updateUserOnlineStatus(currentUserId);
        console.log('로비에서 사용자를 온라인으로 표시:', currentUserId);
      } catch (error) {
        console.error('온라인 상태 업데이트 오류:', error);
      }
    };

    // 초기 온라인 상태 설정
    updateOnlineStatus();

    // 페이지 언로드 시 오프라인으로 표시 (리스너는 한 번만 등록)
    const handleBeforeUnload = () => {
      const db = getDatabase();
      const userStatusRef = ref(db, `lobbyOnline/${currentUserId}`);
      // 동기적으로 업데이트 (beforeunload에서는 비동기 작업이 완료되지 않을 수 있음)
      update(userStatusRef, { isOnline: false, lastSeen: serverTimestamp() });
    };
    window.addEventListener('beforeunload', handleBeforeUnload);

    // 연결 상태 모니터링 - 재연결 시 온라인 상태 복구
    const database = getDatabase();
    const connectedRef = ref(database, '.info/connected');

    const connectedListener = onValue(connectedRef, (snap) => {
      if (snap.val()) {
        console.log('Firebase에 연결됨, 온라인 상태 업데이트');
        updateOnlineStatus();
      }
    });
    
    // 로비 온라인 사용자 목록 구독 - 에러 처리 추가
    let unsubscribeOnlineUsers = () => {};
    try {
      unsubscribeOnlineUsers = getOnlineUsers((users) => {
        console.log("로비 온라인 사용자 목록 업데이트:", users.length);
        setOnlineUsers(users);
      });
    } catch (error) {
      console.error('온라인 사용자 목록 구독 오류:', error);
    }
    
    return () => {
      console.log('LobbyChat 언마운트 - 리스너 정리');
      window.removeEventListener('beforeunload', handleBeforeUnload);
      connectedListener(); // 연결 상태 리스너 해제

      if (typeof unsubscribeOnlineUsers === 'function') {
        unsubscribeOnlineUsers(); // 온라인 사용자 목록 구독 해제
      }
      
      // 컴포넌트 언마운트 시 명시적으로 로비에서 오프라인 상태로 설정
      try {
        const db = getDatabase();
        const userStatusRef = ref(db, `lobbyOnline/${currentUserId}`);
        update(userStatusRef, { isOnline: false, lastSeen: serverTimestamp() });
        console.log('로비에서 사용자를 오프라인으로 표시 (언마운트):', currentUserId);
      } catch (error) {
        console.error('오프라인 상태 설정 오류:', error);
      }
    };
  }, [currentUserId]);
  
  // 메시지 전송
  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!newMessage.trim() || !currentUserId) {
      return;
    }
    
    try {
      const database = getDatabase();
      const chatRef = ref(database, 'lobbyChat');
      const auth = getAuth();
      
      if (!auth.currentUser) {
        console.error('사용자 인증 정보가 없습니다.');
        return;
      }
      
      // 메시지 데이터 준비
      const messageData = {
        userId: currentUserId,
        userName: auth.currentUser?.displayName || '익명 사용자',
        photoURL: auth.currentUser?.photoURL || null,
        text: newMessage.trim(),
        timestamp: Date.now()
      };
      
      // 메시지 전송
      await push(chatRef, messageData);
      console.log('메시지 전송 성공');
      
      // 입력 필드 초기화
      setNewMessage('');
    } catch (error) {
      console.error('메시지 전송 오류:', error);
      // 사용자에게 오류 알림을 표시할 수 있음
    }
  };
  
  // 타임스탬프를 읽기 쉬운 형식으로 변환
  const formatTimestamp = (timestamp: number) => {
    const date = new Date(timestamp);
    return `${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}`;
  };
  
  // 채팅/유저 탭 전환
  const renderTabContent = () => {
    if (activeTab === 'chat') {
      return (
        <>
          <div className="h-[280px] overflow-y-auto border border-slate-700/50 rounded-xl p-2 bg-slate-950/40">
            {messages.length === 0 ? (
              <p className="text-slate-500 text-center text-xs py-4">아직 채팅 메시지가 없습니다.</p>
            ) : (
              messages.map((message) => (
                <div
                  key={message.id}
                  className={`mb-1.5 ${message.userId === currentUserId ? 'text-right' : ''}`}
                >
                  <div
                    className={`inline-block px-2 py-1 rounded-xl max-w-[90%] text-xs border ${
                      message.userId === currentUserId
                        ? 'bg-amber-400/10 border-amber-400/30 text-amber-100'
                        : 'bg-slate-800/80 border-slate-700/50 text-slate-200'
                    }`}
                  >
                    {message.userId !== currentUserId && (
                      <div className="flex items-center text-xs mb-0.5">
                        {message.photoURL ? (
                          <img
                            src={message.photoURL}
                            alt={message.userName}
                            className="w-3.5 h-3.5 rounded-full mr-1"
                          />
                        ) : (
                          <div className="w-3.5 h-3.5 bg-slate-600 rounded-full mr-1 flex items-center justify-center text-[8px] text-white">
                            {message.userName[0]}
                          </div>
                        )}
                        <span className="font-bold text-[10px] text-slate-400 truncate max-w-[80px]">{message.userName}</span>
                      </div>
                    )}
                    <p className="text-xs break-words">{message.text}</p>
                    <span className="text-[8px] text-slate-500">{formatTimestamp(message.timestamp)}</span>
                  </div>
                </div>
              ))
            )}
            <div ref={messagesEndRef} />
          </div>

          <form onSubmit={handleSendMessage} className="mt-2 flex gap-1.5">
            <input
              type="text"
              value={newMessage}
              onChange={(e) => setNewMessage(e.target.value)}
              placeholder="메시지 입력..."
              className="flex-1 px-3 py-1.5 text-xs bg-slate-800/80 border border-slate-600/70 rounded-xl
                text-slate-100 placeholder:text-slate-500
                focus:outline-none focus:ring-2 focus:ring-amber-400/60 focus:border-transparent"
            />
            <button
              type="submit"
              disabled={!newMessage.trim()}
              className="btn-game px-3 py-1.5 text-xs shrink-0"
            >
              전송
            </button>
          </form>
        </>
      );
    } else {
      return (
        <div className="h-[320px] overflow-y-auto border border-slate-700/50 rounded-xl p-2 bg-slate-950/40">
          {onlineUsers.length === 0 ? (
            <div className="text-center py-4">
              <p className="text-slate-500 text-xs">접속 중인 유저가 없습니다.</p>
              <p className="text-slate-600 text-[10px] mt-1">잠시만 기다려주세요...</p>
            </div>
          ) : (
            <ul className="divide-y divide-slate-800">
              {onlineUsers.map((user) => (
                <li key={user.uid} className="py-1.5 flex items-center">
                  {user.photoURL ? (
                    <img
                      src={user.photoURL}
                      alt={user.displayName || '유저'}
                      className="w-6 h-6 rounded-full mr-2 ring-1 ring-slate-600"
                    />
                  ) : (
                    <div className="w-6 h-6 bg-slate-700 rounded-full mr-2 flex items-center justify-center text-[10px] text-slate-300">
                      {user.displayName?.[0] || '?'}
                    </div>
                  )}
                  <div className="overflow-hidden">
                    <p className="font-medium text-xs truncate text-slate-200">
                      {user.displayName}
                      {user.uid === currentUserId && <span className="text-[10px] text-amber-400 ml-1">(나)</span>}
                    </p>
                  </div>
                  <span className="ml-auto w-1.5 h-1.5 bg-green-400 rounded-full shadow shadow-green-400/50"></span>
                </li>
              ))}
            </ul>
          )}
        </div>
      );
    }
  };

  return (
    <div className="game-panel p-3 flex flex-col">
      <div className="flex justify-between items-center">
        <h2 className="text-sm font-bold text-slate-200 flex items-center gap-1.5">💬 대기실</h2>
        <div className="text-[10px] text-slate-500">
          접속자 <span className="text-green-400 font-bold">{onlineUsers.length}</span>명
        </div>
      </div>

      {/* 탭 선택 UI */}
      <div className="flex border-b border-slate-700/60 mt-2">
        <button
          className={`py-1.5 px-3 focus:outline-none text-xs transition-colors ${
            activeTab === 'chat'
              ? 'border-b-2 border-amber-400 font-bold text-amber-300'
              : 'text-slate-500 hover:text-slate-300'
          }`}
          onClick={() => setActiveTab('chat')}
        >
          채팅
        </button>
        <button
          className={`py-1.5 px-3 focus:outline-none text-xs transition-colors ${
            activeTab === 'users'
              ? 'border-b-2 border-amber-400 font-bold text-amber-300'
              : 'text-slate-500 hover:text-slate-300'
          }`}
          onClick={() => setActiveTab('users')}
        >
          접속자 목록
        </button>
      </div>

      <div className="flex-1 overflow-hidden pt-2">
        {renderTabContent()}
      </div>
    </div>
  );
};

export default LobbyChat;