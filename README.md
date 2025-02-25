# 대목 (Path Finding Game)

'대목'은 전략적 사고와 경로 찾기를 즐길 수 있는 온라인 턴제 보드 게임입니다. 8x8 크기의 격자판에서 진행되며, 플레이어가 직접 시작점과 도착점을 설정하고 장애물을 배치하는 방식의 게임입니다. 먼저 도착점에 골인하는 플레이어가 승리합니다.

## 주요 기능

- **맵 제작 기능**: 시작점, 도착점 설정 및 장애물(노란선) 배치
- **게임 플레이**: 상하좌우 이동으로 장애물을 피해 목적지에 도달
- **온라인 멀티플레이어**: Firebase Realtime Database를 통한 실시간 대전 기능
- **연습 모드**: 혼자서 게임 연습

## 기술 스택

- **프론트엔드**: Next.js, React, TypeScript, TailwindCSS
- **백엔드**: Firebase (Realtime Database, Authentication)
- **개발 도구**: ESLint, TypeScript

## 설치 방법

```bash
# 프로젝트 클론
git clone https://github.com/yourusername/daemok.git
cd daemok

# 의존성 설치
npm install
```

## 실행 방법

### 개발 모드

```bash
npm run dev
```

### 빌드 및 실행 (프로덕션)

```bash
npm run build
npm run start
```

## Firebase 설정

이 프로젝트는 Firebase Realtime Database를 사용하여 실시간 멀티플레이어 기능을 구현합니다. Firebase 프로젝트를 생성하고 설정하려면:

1. [Firebase 콘솔](https://console.firebase.google.com/)에서 새 프로젝트 생성
2. Realtime Database 생성 (테스트 모드로 시작)
3. Authentication에서 '익명 로그인' 활성화
4. 프로젝트 설정에서 웹 앱 추가 및 Firebase 구성 가져오기
5. `src/lib/firebase.ts` 파일에 Firebase 구성 정보 업데이트

## 게임 플레이 방법

1. 홈페이지에서 '게임 로비 입장' 버튼 클릭
2. 로비에서 게임 방 생성 또는 참가
3. 맵 제작 단계: 시작점(녹색), 도착점(빨간색) 선택 및 장애물(노란선) 배치 (최대 15개)
4. 게임 플레이 단계: 상하좌우 방향키로 이동하며 목적지에 도달
5. 먼저 도착지에 도달한 플레이어가 승리

## 연습 모드

'연습 모드'에서는 혼자서 게임을 연습할 수 있습니다. 맵을 직접 만들고 플레이하여 감각을 익힐 수 있습니다.

## 프로젝트 구조

```
/daemok
  /src
    /app          # Next.js 페이지
    /components   # 리액트 컴포넌트
    /hooks        # 커스텀 React Hooks
    /lib          # 유틸리티 함수 및 Firebase 설정
    /types        # TypeScript 타입 정의
  /public         # 정적 파일
```

## 기여하기

이슈와 풀 리퀘스트는 언제나 환영합니다. 주요 변경 사항은 먼저 이슈를 통해 논의해주세요.

## 라이선스

MIT 라이선스를 따릅니다.
#   D a e M o k  
 