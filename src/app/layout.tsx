import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { AuthErrorBoundary } from '@/components/AuthErrorBoundary';

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "대목 - 길찾기 대전",
  description: "상대가 숨겨둔 벽을 피해 먼저 도착점에 골인하는 온라인 턴제 보드게임",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased text-slate-100 min-h-screen`}
      >
        <AuthErrorBoundary>
          {children}
        </AuthErrorBoundary>
      </body>
    </html>
  );
}
