# 대목

대목은 실시간 길찾기 대전과 영구 성장형 브라우저 RPG를 함께 제공하는 Next.js 게임입니다.

## 게임 모드

### 길찾기 대전

- 플레이어가 직접 시작점, 도착점, 숨겨진 벽과 맵 아이템을 배치합니다.
- 2~4명이 입장 순서대로 한 행동씩 교대하며, 이동·벽 충돌·탐지기 사용은 각각 1턴을 소비합니다.
- 참가자별 보드를 최대 4개까지 같은 화면에 표시하고 가장 적은 턴으로 완주한 사람이 승리합니다.
- Firebase Realtime Database 트랜잭션으로 위치, 아이템, 완주와 다음 턴을 원자적으로 동기화합니다.

### 모험가 길드

- 3개 직업, 4개 지역, 일반 사냥과 반복 강화되는 지역 우두머리를 제공합니다.
- 자동 사냥과 최대 8시간 오프라인 보상으로 레벨과 직업 숙련도를 누적합니다.
- 능력치 배분, 직업 기술, 장비 장착/판매/+10 강화, 임무 보상을 지원합니다.
- 재질, 접두/접미 옵션, 등급과 품질 조합으로 직업별 66,240종 장비 도감을 구성합니다.
- Firebase에 캐릭터 전체 상태와 공개 랭킹 요약을 원자 저장하고 상위 100명을 실시간 표시합니다.

## 기술 스택

- Next.js 15, React 19, TypeScript
- Firebase Authentication, Realtime Database
- React Three Fiber / Three.js
- Tailwind CSS, CSS Modules, Lucide React
- Playwright

## 실행

```bash
npm install
npm run dev
```

기본 개발 주소는 `http://localhost:3000`입니다.

Firebase 에뮬레이터를 사용하려면 다음 두 프로세스를 실행합니다.

```bash
npx firebase-tools emulators:start --only auth,database --project daemok-155c1
NEXT_PUBLIC_FIREBASE_EMULATOR=1 npm run dev
```

## 주요 데이터 경로

- `rooms/{roomId}`: 길찾기 대전 방과 게임 상태
- `users/{uid}/adventure/v1`: 비공개 모험 캐릭터 원본
- `adventureRankings/{uid}`: 공개 랭킹 요약
- `adventurePresence/{uid}`: 모험 모드 실시간 접속 상태

`database.rules.json`은 교대 턴 쓰기 권한, 모험 상태와 랭킹의 교차 일치, 타 사용자의 비공개 캐릭터 읽기를 검증합니다. 현재 행동 계산은 클라이언트 트랜잭션에서 수행되므로 완전한 치팅 방지가 필요한 경쟁 시즌은 행동 계산과 RNG를 Cloud Functions 또는 신뢰할 수 있는 서버 API로 이전해야 합니다.

## 검증

```bash
npx tsc --noEmit
npm run build
```

멀티플레이 에뮬레이터 테스트는 `scripts/e2e-multiplayer.cjs`와 `scripts/e2e-spectator.cjs`에 있습니다.
