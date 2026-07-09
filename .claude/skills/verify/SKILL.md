---
name: verify
description: DaeMok(대목) 앱을 빌드/구동하고 연습 모드 게임 플로우를 헤드리스 브라우저로 검증하는 레시피
---

# DaeMok 검증 레시피

## 빌드 & 실행

```bash
npm run build          # TS 타입검사 포함 (ignoreBuildErrors 꺼져 있음)
npm run start          # 프로덕션 서버, http://localhost:3000
# 또는 npm run dev (turbopack)
```

## 검증 표면

- `/practice` — 로그인 불필요. GameSetup(3D/2D 보드, 시작/도착/벽 배치) + GamePlay(이동, 벽 충돌, 골인) 전체 루프를 Firebase 쓰기 없이 구동 가능 (연습 모드는 isPractice로 Firebase 차단됨).
- `/rooms`, `/rooms/[id]` — Firebase 이메일/비밀번호 인증 필요. **멀티플레이 검증은 로컬 에뮬레이터로** (프로덕션 DB 안 건드림):
  1. Java 21+ 필요 (없으면 Adoptium JRE 21 tarball을 받아 PATH에 추가 — sudo 불필요)
  2. `npx firebase-tools emulators:start --only auth,database --project demo-daemok` (firebase.json/database.rules.json 리포에 있음)
  3. `NEXT_PUBLIC_FIREBASE_EMULATOR=1 npm run build && npm run start` (빌드타임 env로 에뮬레이터 연결이 인라인됨 — 배포 전 반드시 env 없이 재빌드)
  4. `EMULATOR=1 CHROME_PATH=/usr/bin/google-chrome node scripts/e2e-multiplayer.cjs` — 2계정 대전→관전→포기→재시작(패자 선턴)→무승부→방 삭제까지 검증. EMULATOR=1 없이 돌리면 프로덕션에 쓰고 자동 정리하므로 사용자 승인 필요.

## 헤드리스 브라우저 구동 (WSL2)

- Playwright는 npx 캐시에 있음: `NODE_PATH=~/.npm/_npx/<hash>/node_modules node script.cjs`
- 브라우저: `executablePath: '/usr/bin/google-chrome'`, args `['--no-sandbox', '--enable-unsafe-swiftshader', '--use-angle=swiftshader']` — WebGL(three.js) 렌더링/레이캐스트 정상 동작.
- 한글 폰트가 없어 스크린샷에 □로 표시되나 DOM 텍스트 어서션은 정상.

## 알아둘 것

- 3D 캔버스 클릭은 타일 사이 홈에 떨어지면 빗나감 → 후보 좌표 여러 개를 순차 클릭하며 기대 텍스트를 확인하는 재시도 루프 사용.
- 2D 보드는 DOM이라 정밀 클릭 가능: `div.grid`의 자식 인덱스 = (2*row)*11 + 2*col (셀), 벽은 홀수 인덱스. 결정적 시나리오는 2D로 배치하고 3D로 플레이 검증하는 하이브리드가 안정적.
- 결정적 시나리오 예: 시작(0,0), 도착(0,2), 벽 (0,1)-(0,2) → →(1턴), →(벽 충돌, 2턴), ↓→↑(5턴 골인). 보드 밖 이동은 턴 미소모.
