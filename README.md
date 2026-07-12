# 대목

대목은 실시간 길찾기 대전과 영구 성장형 브라우저 RPG를 함께 제공하는 Next.js 게임입니다.

## 게임 모드

### 길찾기 대전

- 플레이어가 직접 시작점, 도착점, 최대 24벽 예산의 숨겨진 벽과 맵 아이템을 배치합니다.
- 2~4명이 입장 순서대로 한 행동씩 교대하며, 이동·벽 충돌·탐지기 사용은 각각 1턴을 소비합니다.
- 참가자별 보드를 최대 4개까지 같은 화면에 표시하고 가장 적은 턴으로 완주한 사람이 승리합니다.
- 혼자서도 1~3명의 AI와 같은 턴 규칙으로 플레이하는 연습 대전을 제공합니다.
- Firebase Realtime Database 트랜잭션으로 위치, 아이템, 완주와 다음 턴을 원자적으로 동기화합니다.
- 방 밖에서도 유지되는 미로 베타 랭킹은 1000 RP에서 시작해 승리 `+20`, 패배 `-12`, 무승부 `0`을 적용합니다.

특수벽은 강철·화염·독·빙결·바람·붕괴·위상·거울·가시·수정의 10종입니다. 각 벽은 영구 차단, 추가 턴, 첫 통과 후 소멸하는 밀치기, 실제 경로와 아직 믿고 있는 가짜벽 경로가 모두 안전할 때만 닫히는 붕괴 등 서로 다른 규칙을 가지며 종류별 최대 1개만 배치할 수 있습니다. 가짜벽을 포함한 비밀 아이템은 맵 제작자 화면에서는 구분되고 상대 화면에는 발동 전까지 노출되지 않습니다.

최종 벽 비용은 가짜벽 7, 웜홀 7, 거울벽 5, 탐지기 4이며 나머지 함정·특수벽은 1입니다. 모든 아이템은 종류별 1개로 제한되고, 바람벽과 거울벽은 첫 발동 후 소멸합니다. 웜홀 출구는 열린 방향 2개와 도착점까지의 독립 경로가 필요합니다.

플레이어는 정찰 파동, 돌파, 닻, 질주의 4개 스킬 중 하나를 장착하고 경기당 한 번 사용합니다. 방 규칙은 V3 스냅샷으로 벽 예산, 아이템 비용·한도와 스킬 목록을 고정하며 공식 UI는 이 스냅샷과 일치하는 맵만 준비·시작합니다.

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

- `rooms/{roomId}/gameState`: 길찾기 대전 런타임 상태
- `rooms/{roomId}/maps/{uid}`: 준비 완료 뒤 동결되는 V3 원본 맵
- `mazeRankings/{uid}`: 경기별 마커와 추가 전용 정산 이력을 포함한 미로 베타 랭킹
- `users/{uid}/adventure/v1`: 비공개 모험 캐릭터 원본
- `adventureRankings/{uid}`: 공개 랭킹 요약
- `adventurePresence/{uid}`: 모험 모드 실시간 접속 상태

`database.rules.json`은 V3 규칙 스냅샷, 준비 완료 맵 동결, 교대 턴 쓰기, 합법적인 완주·승자·무승부 전이, 45초 오프라인 턴 회수, 미로 랭킹의 결과 일치와 재정산 방지, 모험 상태와 랭킹의 교차 일치, 타 사용자의 비공개 모험 캐릭터 읽기를 검증합니다. 미로 랭킹은 현재 클라이언트 정산을 사용하는 베타 기능입니다. 완전한 치팅 방지와 DB 수준의 비밀 맵이 필요한 경쟁 시즌은 매 행동 계산과 원본 맵 읽기를 Cloud Functions 또는 신뢰할 수 있는 서버 API로 이전해야 합니다.

## 검증

```bash
npx tsc --noEmit
npm run test:game-rules
npm run test:offline-turn
npm run test:database-rules
npm run build
```

고정 시드 검증은 `npm run sim:wall-budget`, `npm run sim:consumables`, `npm run sim:special-walls`, `npm run sim:wall-combos`로 재현할 수 있습니다. 20·22·24·26벽 비교에서는 24벽이 턴 밀도와 증가 둔화 사이의 기준으로 선택됐고, 거울벽 비용은 무작위 배치뿐 아니라 제작자 최적 배치 상한도 함께 평가합니다. 멀티플레이·연습·관전자·방장 이탈 에뮬레이터 검증 스크립트는 `scripts/e2e-*.cjs`에 있습니다.
