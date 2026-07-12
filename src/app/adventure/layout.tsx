import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: '대목 모험가 길드',
  description: '자동 사냥, 직업 성장, 장비 도감과 실시간 랭킹을 갖춘 온라인 브라우저 RPG',
};

export default function AdventureLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return children;
}
