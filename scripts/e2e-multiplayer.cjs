/**
 * 멀티플레이 E2E 테스트 (턴 수 승리 조건 + 관전 + 포기 + 무승부)
 *
 * 권장: Firebase 로컬 에뮬레이터로 실행 (프로덕션 DB를 전혀 건드리지 않음)
 *   1. npm i -D playwright                          (이미 있으면 생략)
 *   2. npx firebase-tools emulators:start --only auth,database --project demo-daemok
 *   3. NEXT_PUBLIC_FIREBASE_EMULATOR=1 npm run build && npm run start
 *   4. EMULATOR=1 node scripts/e2e-multiplayer.cjs
 *
 * EMULATOR=1 없이 실행하면 실제 Firebase(daemok-155c1)에 테스트 계정 2개와
 * 방 1개를 만들고, 종료 시 자동으로 모두 삭제합니다.
 *
 * 검증 시나리오:
 *   [1게임] 회원가입 x2 -> 방 생성/참가 -> 맵 제작 x2 -> 자동 시작(방장 선턴)
 *     -> 턴 교대 -> A 선완주(2턴, 관전 전환) -> B 혼자 연속 턴 -> B 승리 불가 상태
 *     -> B 포기 -> A 승리 / B 패배
 *   [2게임] 재시작(패배자 B 선턴) -> B 선완주(2턴) -> A도 2턴 완주 -> 무승부
 *   마지막: 방장 나가기 -> 방 삭제 -> 상대 자동 리디렉션
 */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const IS_EMULATOR = process.env.EMULATOR === '1';
const OUT = path.join(__dirname, '..', 'e2e-artifacts');
fs.mkdirSync(OUT, { recursive: true });

const BASE = process.env.BASE_URL || 'http://localhost:3000';
const API_KEY = 'AIzaSyBxHJ14JjS3DOHHR9xwLGjIKdBJp8cD448';
const DB = 'https://daemok-155c1-default-rtdb.asia-southeast1.firebasedatabase.app';

const STAMP = Date.now();
const ROOM_NAME = `e2e테스트-${STAMP % 1000000}`;
const ACCOUNTS = {
  a: { email: `daemok.e2e.a.${STAMP}@example.com`, password: 'test1234!', name: 'TestA' },
  b: { email: `daemok.e2e.b.${STAMP}@example.com`, password: 'test1234!', name: 'TestB' },
};

function step(msg) { console.log('STEP:', msg); }
function ok(msg) { console.log('  OK:', msg); }

async function expectText(page, text, timeout = 20000) {
  await page.getByText(text, { exact: false }).first().waitFor({ state: 'visible', timeout });
  ok(`saw: ${JSON.stringify(text)}`);
}

async function signUp(page, acc) {
  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: '계정이 없으신가요? 회원가입' }).click();
  await page.fill('#displayName', acc.name);
  await page.fill('#email', acc.email);
  await page.fill('#password', acc.password);
  await page.getByRole('button', { name: '가입하기' }).click();
  await expectText(page, '게임 대기실', 25000);
}

// 2D 기본 보드에서 맵 제작: 시작(0,0), 도착(0,2), 벽 없음 (최단 2턴)
async function setupMap(page) {
  await expectText(page, '시작점을 선택하세요');
  const items = page.locator('div.grid').first().locator(':scope > *');
  await items.nth(0).click();
  await expectText(page, '도착점을 선택하세요');
  await items.nth(4).click();
  await expectText(page, '벽(장애물)을 배치하세요');
  await page.getByRole('button', { name: '완료' }).click();
}

// ===== 테스트 데이터 정리 (실서버 실행 시에만) =====
async function restSignIn(email, password) {
  const res = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${API_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, returnSecureToken: true }),
    }
  );
  if (!res.ok) throw new Error(`signIn ${email}: ${res.status}`);
  return res.json();
}

async function cleanup(roomId) {
  if (IS_EMULATOR) {
    console.log('--- 에뮬레이터 모드: 정리 생략 (에뮬레이터 종료 시 데이터 소멸) ---');
    return;
  }
  console.log('--- 테스트 데이터 정리 시작 ---');
  for (const key of ['a', 'b']) {
    const acc = ACCOUNTS[key];
    try {
      const { idToken, localId } = await restSignIn(acc.email, acc.password);

      if (key === 'a' && roomId) {
        const check = await fetch(`${DB}/rooms/${roomId}.json?shallow=true&auth=${idToken}`);
        if ((await check.text()) !== 'null') {
          console.log(`  방 ${roomId} 잔존 -> 삭제`);
          await fetch(`${DB}/rooms/${roomId}.json?auth=${idToken}`, { method: 'DELETE' });
        }
      }

      for (const p of [`userStatus/${localId}`, `lobbyOnline/${localId}`, `users/${localId}`, `userRooms/${localId}`, `status/${localId}`]) {
        const r = await fetch(`${DB}/${p}.json?auth=${idToken}`, { method: 'DELETE' });
        console.log(`  DELETE ${p} -> ${r.status}`);
      }

      const del = await fetch(
        `https://identitytoolkit.googleapis.com/v1/accounts:delete?key=${API_KEY}`,
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ idToken }) }
      );
      console.log(`  계정 삭제 ${acc.email} -> ${del.status}`);
    } catch (e) {
      console.error(`  정리 실패 (${acc.email}):`, e.message);
    }
  }
  console.log('--- 정리 완료 ---');
}

(async () => {
  const browser = await chromium.launch({
    channel: process.env.CHROME_PATH ? undefined : 'chrome',
    executablePath: process.env.CHROME_PATH || undefined,
    headless: true,
    args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--use-angle=swiftshader'],
  });
  const ctxA = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const ctxB = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const pageA = await ctxA.newPage();
  const pageB = await ctxB.newPage();
  pageB.on('dialog', (d) => d.accept()); // 포기 확인 다이얼로그 자동 수락

  let roomId = null;

  try {
    step('1: 테스트 계정 2개 회원가입');
    await signUp(pageA, ACCOUNTS.a);
    await signUp(pageB, ACCOUNTS.b);

    step('2: A가 방 생성');
    await pageA.getByRole('button', { name: '새 게임 방 만들기' }).click();
    await pageA.fill('#roomName', ROOM_NAME);
    await pageA.getByRole('button', { name: '방 만들기' }).click();
    await pageA.waitForURL(/\/rooms\/.+/, { timeout: 20000 });
    roomId = pageA.url().split('/rooms/')[1];
    ok(`방 생성됨: ${roomId}`);

    step('3: A 맵 제작 완료 -> 상대 대기');
    await setupMap(pageA);
    await expectText(pageA, '상대방 준비 대기');

    step('4: B가 방 목록에서 참가');
    const card = pageB.locator('.border.rounded-lg', { hasText: ROOM_NAME }).first();
    await card.waitFor({ timeout: 20000 });
    await card.getByRole('button', { name: '참가하기' }).click();
    await pageB.waitForURL(/\/rooms\/.+/, { timeout: 20000 });

    step('5: B 맵 제작 완료 -> 게임 자동 시작');
    await setupMap(pageB);
    await expectText(pageA, '이동: 0');
    await expectText(pageB, '이동: 0');

    step('6: 선턴 = 방장(A) 확인');
    await expectText(pageA, '내 턴');

    step('7: [1게임] 턴 교대 (A -> B -> A 2턴 완주)');
    await pageA.keyboard.press('ArrowRight');
    await expectText(pageA, '이동: 1');
    await expectText(pageB, '내 턴');
    await pageB.keyboard.press('ArrowRight');
    await expectText(pageB, '이동: 1');
    await expectText(pageA, '내 턴');
    await pageA.keyboard.press('ArrowRight');
    await expectText(pageA, '턴으로 완주했습니다'); // 관전 배너: "🏁 2턴으로 완주했습니다!"

    step('8: A = 관전 모드(승부 미확정), B = 목표 턴 수 + 포기 버튼');
    await expectText(pageA, '관전 중');
    await pageA.waitForTimeout(1000);
    await pageA.screenshot({ path: `${OUT}/mp-01-A-spectate.png` });
    await expectText(pageB, '상대방이 2턴으로 완주했습니다');
    await expectText(pageB, '다음 이동에 바로 골인하면 무승부입니다'); // B는 1턴 사용 상태
    await pageB.getByRole('button', { name: '포기하기' }).waitFor({ timeout: 15000 });
    await pageB.screenshot({ path: `${OUT}/mp-02-B-forfeit-option.png` });

    step('9: [probe] B 혼자 연속 턴 + 승리 불가 상태 전환');
    await pageB.keyboard.press('ArrowDown'); // 일부러 우회 (2턴 사용 -> 최소 3턴 완주 = 승리 불가)
    await expectText(pageB, '이동: 2');
    await pageB.waitForTimeout(1500);
    await expectText(pageB, '내 턴'); // 턴이 넘어가지 않고 유지
    await expectText(pageB, '승리할 수 없습니다');
    await pageA.waitForTimeout(500);
    await pageA.screenshot({ path: `${OUT}/mp-03-A-watching-B-move.png` });

    step('10: B 포기 -> A 승리 / B 패배');
    await pageB.getByRole('button', { name: '포기하기' }).click();
    await expectText(pageA, '승리했습니다! (상대방 포기)');
    await expectText(pageB, '포기하여 패배했습니다');
    await pageA.screenshot({ path: `${OUT}/mp-04-A-win.png` });
    await pageB.screenshot({ path: `${OUT}/mp-05-B-forfeit-lose.png` });

    step('11: 재시작 -> 패배자(B) 선턴');
    await pageA.getByRole('button', { name: '재시작' }).click();
    await expectText(pageA, '시작점을 선택하세요');
    await expectText(pageB, '시작점을 선택하세요');
    await expectText(pageB, '선턴입니다. 맵을 설정해주세요.');
    await pageB.screenshot({ path: `${OUT}/mp-06-B-first-turn.png` });

    step('12: [2게임] 맵 제작 x2 -> 시작 (B 선턴)');
    await setupMap(pageA);
    await setupMap(pageB);
    await expectText(pageA, '이동: 0');
    await expectText(pageB, '이동: 0');
    await expectText(pageB, '내 턴');

    step('13: B 2턴 선완주 -> A는 무승부 도전 상태');
    await pageB.keyboard.press('ArrowRight');
    await expectText(pageB, '이동: 1');
    await expectText(pageA, '내 턴');
    await pageA.keyboard.press('ArrowRight');
    await expectText(pageA, '이동: 1');
    await expectText(pageB, '내 턴');
    await pageB.keyboard.press('ArrowRight');
    await expectText(pageB, '턴으로 완주했습니다'); // B 관전 전환
    await expectText(pageA, '상대방이 2턴으로 완주했습니다');
    await expectText(pageA, '다음 이동에 바로 골인하면 무승부입니다');

    step('14: A도 2턴으로 완주 -> 무승부');
    await pageA.keyboard.press('ArrowRight');
    await expectText(pageA, '무승부입니다!');
    await expectText(pageB, '무승부입니다!');
    await pageA.screenshot({ path: `${OUT}/mp-07-draw.png` });

    step('15: A(방장) 나가기 -> 방 삭제 -> B 자동 리디렉션');
    await pageA.getByRole('button', { name: '나가기' }).first().click();
    await pageA.waitForURL(/\/rooms$/, { timeout: 20000 });
    await pageB.waitForURL(/\/rooms$/, { timeout: 25000 });

    console.log('ALL MP STEPS PASSED');
  } catch (e) {
    console.error('FAILED:', e.message);
    await pageA.screenshot({ path: `${OUT}/mp-fail-A.png` }).catch(() => {});
    await pageB.screenshot({ path: `${OUT}/mp-fail-B.png` }).catch(() => {});
    process.exitCode = 1;
  } finally {
    await browser.close();
    await cleanup(roomId);
  }
})();
