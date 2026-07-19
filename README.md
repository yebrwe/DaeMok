# 대목

대목은 실시간 길찾기 대전을 제공하는 Next.js 게임입니다.

## 게임 모드

### 길찾기 대전

- 플레이어가 직접 시작점, 도착점, 최대 24벽 예산의 숨겨진 벽과 맵 아이템을 배치합니다.
- 2~4명이 입장 순서대로 한 번씩 이동하며, 이동과 벽 충돌은 각각 1턴을 소비합니다.
- 참가자별 보드를 최대 4개까지 같은 화면에 표시하고 가장 적은 턴으로 완주한 사람이 승리합니다.
- 혼자서도 1~3명의 AI와 같은 턴 규칙으로 플레이하는 연습 대전을 제공합니다.
- Firebase Realtime Database 트랜잭션으로 위치, 아이템, 완주와 다음 턴을 원자적으로 동기화합니다.
- 방 밖에서도 유지되는 미로 베타 랭킹은 1000 RP에서 시작해 승리 `+20`, 패배 `-12`, 무승부 `0`을 적용합니다.

특수벽은 강철·화염·독·빙결·바람·위상·가시·수정의 8종입니다. 각 벽은 영구 차단, 추가 턴, 밀치기, 매 시도마다 막힘과 통과 교대 등 서로 다른 규칙을 가지며 종류별 최대 1개만 배치할 수 있습니다. 가짜벽을 포함한 비밀 아이템은 맵 제작자 화면에서는 구분되고 상대 화면에는 발동 전까지 노출되지 않습니다.

최종 벽 비용은 가짜벽과 웜홀이 각각 7이며 나머지 함정·특수벽은 1입니다. 모든 아이템은 종류별 1개로 제한되고, 바람벽은 첫 발동 후 소멸합니다. 웜홀 출구는 열린 방향 2개와 도착점까지의 독립 경로가 필요합니다. 탐지기와 플레이어 스킬은 신규 맵 제작·저장과 공식 턴 처리에서 제거되었습니다.

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
npx firebase-tools emulators:start --only auth,database,functions --project daemok-155c1
NEXT_PUBLIC_FIREBASE_EMULATOR=1 npm run dev
```

Firebase가 구성된 대목 신규 방은 `NEXT_PUBLIC_MAZE_AUTHORITY_NEW_ROOMS`를 설정하지 않아도 서버 권위 방을 기본 사용합니다. 기존 `rooms` 방은 진행 중 상태를 그대로 유지해 종료될 때까지 별도 레거시 경로에서 처리하며, `mz1_` 권위 방이 레거시 데이터로 폴백하지는 않습니다. 비상 롤백이나 레거시 방 단독 테스트에서만 명시적으로 `NEXT_PUBLIC_MAZE_AUTHORITY_NEW_ROOMS=0`을 사용합니다.

운영의 권위형 미로 callable은 Firebase App Check를 강제합니다. Firebase 웹 앱에 reCAPTCHA Enterprise 점수 기반 키를 등록한 뒤 `NEXT_PUBLIC_FIREBASE_APP_CHECK_SITE_KEY`를 빌드 환경에 설정합니다. 로컬 에뮬레이터에서는 App Check 검증을 생략합니다.

## 주요 데이터 경로

- `rooms/{roomId}/gameState`: 길찾기 대전 런타임 상태
- `rooms/{roomId}/maps/{uid}`: 준비 완료 뒤 동결되는 V3 원본 맵
- `mazeRankings/{uid}`: 경기별 마커와 추가 전용 정산 이력을 포함한 미로 베타 랭킹
- `mazeAuthority/v1/rooms/{roomId}`: Admin SDK만 접근하는 서버 권위형 미로 원본
- `mazeViews/v1/publicRooms/{roomId}`: 인증 사용자·관전자용 공개 투영
- `mazeViews/v1/memberRooms/{uid}/{roomId}`: 본인 비밀 맵을 포함한 참가자 전용 투영
- `mazePresence/v1/{rooms,leases,status}`: 경기 원본과 분리된 탭 연결·오프라인 턴 lease
- `mazeAuthorityRankings/v1/{uid}`: 서버가 정산하는 권위형 미로 랭킹

`database.rules.json`은 기존 V3 방의 규칙 스냅샷, 준비 완료 맵 동결, 교대 턴 쓰기와 합법적인 완주 전이를 검증합니다. 기존 방도 진행 중 자발 기권과 나가기를 거부하며, 45초 연결 유예가 지나면 플레이어 상태나 승패를 바꾸지 않고 현재 턴만 넘깁니다. 신규 권위형 미로의 원본·명령·랭킹 정산은 Functions가 소유하고, 규칙은 클라이언트의 원본 접근과 projection 쓰기를 차단합니다.

방 접속은 사용자당 최대 8개의 탭별 Firebase 연결 슬롯으로 집계합니다. 같은 계정의 탭이 하나라도 남아 있으면 온라인 상태를 유지합니다. 마지막 방장 연결이 끊기면 2.5초 재연결 유예 뒤 남은 참가자 또는 로비 구독자가 방을 삭제하고 참가자를 로비로 이동시킵니다.

## 검증

```bash
npx tsc --noEmit
npm run test:game-rules
npm run test:maze
npm run test:offline-turn
npm run test:database-rules
npm run test:e2e:practice
npm run test:e2e:multiplayer
npm run test:e2e:maze-authority
npm run test:e2e:owner-disconnect
npm run build
```

고정 시드 검증은 `npm run sim:wall-budget`, `npm run sim:consumables`, `npm run sim:special-walls`, `npm run sim:wall-combos`로 재현할 수 있습니다. 20·22·24·26벽 비교에서는 24벽이 턴 밀도와 증가 둔화 사이의 기준으로 선택됐고, 거울벽 비용은 무작위 배치뿐 아니라 제작자 최적 배치 상한도 함께 평가합니다. 멀티플레이·연습·관전자·방장 이탈 에뮬레이터 검증 스크립트는 `scripts/e2e-*.cjs`에 있습니다.
