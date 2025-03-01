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
  
  // 온라인 사용자 목록 가져오기
  useEffect(() => {
    const auth = getAuth();
    console.log('LobbyChat - 로비 온라인 상태 업데이트 시작:', currentUserId);
    
    // 컴포넌트 마운트 시 현재 사용자의 로비 온라인 상태 등록
    updateUserOnlineStatus(currentUserId)
      .then((success) => {
        console.log('로비 온라인 상태 업데이트 결과:', success ? '성공' : '실패');
        
        // 페이지를 떠날 때 명시적으로 오프라인으로 표시
        window.addEventListener('beforeunload', () => {
          console.log('페이지 언로드: 로비에서 사용자를 오프라인으로 표시');
          const db = getDatabase();
          const userStatusRef = ref(db, `lobbyOnline/${currentUserId}`);
          update(userStatusRef, { isOnline: false, lastSeen: serverTimestamp() });
        });
      });
    
    // 로비 온라인 사용자 목록 구독
    const unsubscribe = getOnlineUsers((users) => {
      console.log("로비 온라인 사용자 목록 업데이트:", users.map(u => u.displayName));
      setOnlineUsers(users);
    });
    
    return () => {
      console.log('LobbyChat 언마운트 - 리스너 정리');
      unsubscribe();
      
      // 컴포넌트 언마운트 시 명시적으로 로비에서 오프라인 상태로 설정
      const db = getDatabase();
      const userStatusRef = ref(db, `lobbyOnline/${currentUserId}`);
      update(userStatusRef, { isOnline: false, lastSeen: serverTimestamp() });
    };
  }, [currentUserId]);
  
  // 메시지 전송
  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!newMessage.trim()) {
      return;
    }
    
    try {
      const database = getDatabase();
      const chatRef = ref(database, 'lobbyChat');
      const auth = getAuth();
      
      await push(chatRef, {
        userId: currentUserId,
        userName: auth.currentUser?.displayName || '익명 사용자',
        photoURL: auth.currentUser?.photoURL || null,
        text: newMessage.trim(),
        timestamp: Date.now()
      });
      
      setNewMessage('');
    } catch (error) {
      console.error('메시지 전송 오류:', error);
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
          <div className="h-[100px] md:h-[170px] overflow-y-auto border border-gray-200 rounded-lg p-2 bg-gray-50">
            {messages.length === 0 ? (
              <p className="text-gray-500 text-center text-sm">아직 채팅 메시지가 없습니다.</p>
            ) : (
              messages.map((message) => (
                <div 
                  key={message.id} 
                  className={`mb-1 ${message.userId === currentUserId ? 'text-right' : ''}`}
                >
                  <div 
                    className={`inline-block p-1 rounded-lg max-w-[90%] text-xs ${
                      message.userId === currentUserId 
                        ? 'bg-blue-100 text-blue-800' 
                        : 'bg-gray-200 text-gray-800'
                    }`}
                  >
                    {message.userId !== currentUserId && (
                      <div className="flex items-center text-xs mb-0.5">
                        {message.photoURL ? (
                          <img 
                            src={message.photoURL} 
                            alt={message.userName} 
                            className="w-3 h-3 rounded-full mr-1"
                          />
                        ) : (
                          <div className="w-3 h-3 bg-gray-400 rounded-full mr-1 flex items-center justify-center text-xs text-white">
                            {message.userName[0]}
                          </div>
                        )}
                        <span className="font-medium text-xs truncate max-w-[80px]">{message.userName}</span>
                      </div>
                    )}
                    <p className="text-xs break-words">{message.text}</p>
                    <span className="text-[8px] text-gray-500">{formatTimestamp(message.timestamp)}</span>
                  </div>
                </div>
              ))
            )}
            <div ref={messagesEndRef} />
          </div>
          
          <form onSubmit={handleSendMessage} className="mt-1 flex">
            <input
              type="text"
              value={newMessage}
              onChange={(e) => setNewMessage(e.target.value)}
              placeholder="메시지 입력..."
              className="flex-1 px-2 py-1 text-xs border border-gray-300 rounded-l-md focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
            <button
              type="submit"
              disabled={!newMessage.trim()}
              className={`px-2 py-1 rounded-r-md text-xs ${
                !newMessage.trim() ? 'bg-gray-300 cursor-not-allowed' : 'bg-blue-500 hover:bg-blue-600'
              } text-white transition`}
            >
              전송
            </button>
          </form>
        </>
      );
    } else {
      return (
        <div className="h-[100px] md:h-[170px] overflow-y-auto border border-gray-200 rounded-lg p-2 bg-gray-50">
          {onlineUsers.length === 0 ? (
            <div className="text-center py-2">
              <p className="text-gray-500 text-xs">접속 중인 유저가 없습니다.</p>
              <p className="text-gray-400 text-[10px] mt-1">잠시만 기다려주세요...</p>
            </div>
          ) : (
            <ul className="divide-y divide-gray-100">
              {onlineUsers.map((user) => (
                <li key={user.uid} className="py-1 flex items-center">
                  {user.photoURL ? (
                    <img 
                      src={user.photoURL} 
                      alt={user.displayName || '유저'} 
                      className="w-5 h-5 rounded-full mr-1"
                    />
                  ) : (
                    <div className="w-5 h-5 bg-gray-200 rounded-full mr-1 flex items-center justify-center text-xs">
                      {user.displayName?.[0] || '?'}
                    </div>
                  )}
                  <div className="overflow-hidden">
                    <p className="font-medium text-xs truncate">
                      {user.displayName} 
                      {user.uid === currentUserId && <span className="text-[10px] text-blue-500 ml-1">(나)</span>}
                    </p>
                  </div>
                  <span className="ml-auto w-1.5 h-1.5 bg-green-500 rounded-full"></span>
                </li>
              ))}
            </ul>
          )}
        </div>
      );
    }
  };
  
  return (
    <div className="bg-white shadow-md rounded-lg p-2">
      <div className="flex justify-between items-center">
        <h2 className="text-sm font-semibold">대기실</h2>
        <div className="text-[10px] text-gray-500">
          접속자 {onlineUsers.length}명
        </div>
      </div>
      
      {/* 탭 선택 UI */}
      <div className="flex border-b mt-1">
        <button
          className={`py-1 px-2 focus:outline-none text-xs ${
            activeTab === 'chat' ? 'border-b-2 border-blue-500 font-medium' : 'text-gray-500'
          }`}
          onClick={() => setActiveTab('chat')}
        >
          채팅
        </button>
        <button
          className={`py-1 px-2 focus:outline-none text-xs ${
            activeTab === 'users' ? 'border-b-2 border-blue-500 font-medium' : 'text-gray-500'
          }`}
          onClick={() => setActiveTab('users')}
        >
          접속자 목록
        </button>
      </div>
      
      {renderTabContent()}
    </div>
  );
};

export default LobbyChat;