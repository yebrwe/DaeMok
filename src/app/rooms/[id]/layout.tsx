'use client';

import React from 'react';

export default function RoomLayout({ children, params }: { children: React.ReactNode, params: { id: string } }) {
  // params를 언래핑하여 사용 (필요한 경우)
  const unwrappedParams = React.use(params);
  
  // 내용...
  return (
    <div>{children}</div>
  );
} 