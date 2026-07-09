/**
 * 멀티플레이 E2E 테스트 (구글 로그인 + 턴 수 승리 + 관전 + 포기 + 무승부 + 보안 규칙)
 *
 * ⚠️ Firebase 로컬 에뮬레이터 전용입니다. (구글 로그인은 실서버에서 자동화 불가)
 *    에뮬레이터가 database.rules.json을 로드하므로 세분화된 보안 규칙 검증을 겸합니다.
 *
 * 실행 방법:
 *   1. npm i -D playwright                          (이미 있으면 생략)
 *   2. npx firebase-tools emulators:start --only auth,database --project daemok-155c1
 *      (Java 21+ 필요. ⚠️ 프로젝트 ID를 demo-* 로 띄우면 앱이 쓰는 네임스페이스에
 *       보안 규칙이 적용되지 않아 규칙 검증이 무의미해짐 - 반드시 daemok-155c1 사용)
 *   3. NEXT_PUBLIC_FIREBASE_EMULATOR=1 npm run build && npm run start
 *   4. EMULATOR=1 node scripts/e2e-multiplayer.cjs
 *
 * 검증 시나리오 (자유 이동 - 턴 대기 없음, 최종 턴 수 비교로 승부):
 *   구글 로그인(에뮬레이터 가짜 계정) x2 -> 방 생성/참가 -> 맵 제작 x2 -> 자동 시작
 *   [1게임] 1인칭 기본 확인 -> A 연속 이동 선완주(관전 전환) -> B 헛걸음 -> 승리 불가 안내
 *           -> B 포기 -> A 승리
 *   [2게임] 재시작 -> B 선완주 -> A 동턴 완주 -> 무승부
 *   마지막: 방장 나가기 -> 방 즉시 삭제 -> 상대 자동 리디렉션
 */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

if (process.env.EMULATOR !== '1') {
  console.error('이 테스트는 에뮬레이터 전용입니다. EMULATOR=1 로 실행하세요.');
  process.exit(1);
}

const OUT = path.join(__dirname, '..', 'e2e-artifacts');
fs.mkdirSync(OUT, { recursive: true });

const BASE = process.env.BASE_URL || 'http://localhost:3000';
const STAMP = Date.now();
const ROOM_NAME = `e2e테스트-${STAMP % 1000000}`;
const ACCOUNTS = {
  a: { email: `daemok.e2e.a.${STAMP}@example.com`, name: 'TestA' },
  b: { email: `daemok.e2e.b.${STAMP}@example.com`, name: 'TestB' },
};

function step(msg) { console.log('STEP:', msg); }
function ok(msg) { console.log('  OK:', msg); }

async function expectText(page, text, timeout = 20000) {
  await page.getByText(text, { exact: false }).first().waitFor({ state: 'visible', timeout });
  ok(`saw: ${JSON.stringify(text)}`);
}

// 구글 로그인 - 에뮬레이터의 가짜 계정 팝업을 자동 조작
async function signInWithFakeGoogle(page, acc) {
  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' });

  const [popup] = await Promise.all([
    page.waitForEvent('popup'),
    page.getByRole('button', { name: /Google 계정으로 시작하기/ }).click(),
  ]);

  try {
    await popup.waitForLoadState('domcontentloaded');

    // "Add new account" 버튼 (에뮬레이터 위젯)
    const addBtn = popup.getByRole('button', { name: /add new account/i });
    await addBtn.waitFor({ timeout: 10000 });
    await addBtn.click();

    // 이메일 / 표시 이름 입력
    const emailInput = popup.locator('#email-input, input[type="email"]').first();
    await emailInput.waitFor({ timeout: 10000 });
    await emailInput.fill(acc.email);

    const nameInput = popup.locator('#display-name-input, input[placeholder*="isplay"], #displayName').first();
    if (await nameInput.count()) {
      await nameInput.fill(acc.name);
    }

    // "Sign in with Google.com" 제출
    await popup.getByRole('button', { name: /sign in with google/i }).click();
  } catch (e) {
    // 실패 시 팝업 DOM을 덤프해 셀렉터 진단에 사용
    const html = await popup.content().catch(() => '(no content)');
    console.error('팝업 조작 실패. 팝업 HTML 앞부분:\n', html.slice(0, 3000));
    throw e;
  }

  await expectText(page, '새 게임 방 만들기', 25000);
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
  // 보안 규칙 위반(PERMISSION_DENIED)이 있으면 콘솔에 드러나도록 수집
  for (const [tag, p] of [['A', pageA], ['B', pageB]]) {
    p.on('console', (m) => {
      if (m.type() === 'error' && /permission|denied/i.test(m.text())) {
        console.log(`[${tag} PERMISSION]`, m.text().slice(0, 250));
      }
    });
    p.on('pageerror', (e) => console.log(`[${tag} pageerror]`, String(e).slice(0, 300)));
  }
  pageB.on('dialog', (d) => d.accept()); // 포기 확인 다이얼로그 자동 수락

  try {
    step('1: 구글 로그인 x2 (에뮬레이터 가짜 계정)');
    await signInWithFakeGoogle(pageA, ACCOUNTS.a);
    await signInWithFakeGoogle(pageB, ACCOUNTS.b);

    step('2: A가 방 생성');
    await pageA.getByRole('button', { name: '새 게임 방 만들기' }).click();
    await pageA.fill('#roomName', ROOM_NAME);
    await pageA.getByRole('button', { name: '방 만들기' }).click();
    await pageA.waitForURL(/\/rooms\/.+/, { timeout: 20000 });
    ok(`방 생성됨: ${pageA.url().split('/rooms/')[1]}`);

    step('3: A 맵 제작 완료 -> 상대 대기');
    await setupMap(pageA);
    await expectText(pageA, '상대방 준비 대기');

    step('4: B가 방 목록에서 참가');
    const card = pageB.locator('[data-room-card]', { hasText: ROOM_NAME }).first();
    await card.waitFor({ timeout: 20000 });
    await card.getByRole('button', { name: '참가하기' }).click();
    await pageB.waitForURL(/\/rooms\/.+/, { timeout: 20000 });

    step('5: B 맵 제작 완료 -> 게임 자동 시작 (보안 규칙 하 트랜잭션)');
    await setupMap(pageB);
    await expectText(pageA, '이동: 0');
    await expectText(pageB, '이동: 0');

    step('6: 1인칭이 기본 시점인지 확인 후 3인칭으로 전환');
    await pageA.getByRole('button', { name: '1인칭' }).waitFor({ timeout: 10000 });
    await pageA.getByRole('button', { name: '3인칭' }).click();
    await pageB.getByRole('button', { name: '3인칭' }).click();
    ok('양쪽 3인칭 전환');

    step('7: [1게임] 자유 이동 - A가 연속 2번 이동해 즉시 완주 (턴 대기 없음)');
    await pageA.keyboard.press('ArrowRight');
    await expectText(pageA, '이동: 1');
    await pageA.keyboard.press('ArrowRight');
    await expectText(pageA, '턴으로 완주했습니다');
    ok('A 연속 이동으로 2턴 완주 (자유 이동 확인)');

    step('8: A = 관전 모드(승부 미확정), B = 목표 턴 수 + 포기 버튼');
    await expectText(pageA, '관전 중');
    await pageA.waitForTimeout(1000);
    await pageA.screenshot({ path: `${OUT}/mp-01-A-spectate.png` });
    await expectText(pageB, '상대방이 2턴으로 완주했습니다');
    await expectText(pageB, '1턴 이내로 완주하면 승리합니다');
    await pageB.getByRole('button', { name: '포기하기' }).waitFor({ timeout: 15000 });
    await pageB.screenshot({ path: `${OUT}/mp-02-B-forfeit-option.png` });

    step('9: [probe] B 헛걸음 2번 -> 승리 불가 안내로 전환');
    await pageB.keyboard.press('ArrowDown');
    await expectText(pageB, '이동: 1');
    await pageB.keyboard.press('ArrowUp');
    await expectText(pageB, '이동: 2');
    await expectText(pageB, '승리할 수 없습니다');
    await pageA.waitForTimeout(800);
    await pageA.screenshot({ path: `${OUT}/mp-03-A-watching-B-move.png` });

    step('10: B 포기 -> A 승리 / B 패배');
    await pageB.getByRole('button', { name: '포기하기' }).click();
    await expectText(pageA, '승리했습니다! (상대방 포기)');
    await expectText(pageB, '포기하여 패배했습니다');
    await pageA.screenshot({ path: `${OUT}/mp-04-A-win.png` });
    await pageB.screenshot({ path: `${OUT}/mp-05-B-forfeit-lose.png` });

    step('11: 재시작 -> 양쪽 모두 맵 제작으로 복귀');
    await pageA.getByRole('button', { name: '재시작' }).click();
    await expectText(pageA, '시작점을 선택하세요');
    await expectText(pageB, '시작점을 선택하세요');

    step('12: [2게임] 맵 제작 x2 -> 시작 -> 3인칭 전환');
    await setupMap(pageA);
    await setupMap(pageB);
    await expectText(pageA, '이동: 0');
    await expectText(pageB, '이동: 0');
    await pageA.getByRole('button', { name: '3인칭' }).click();
    await pageB.getByRole('button', { name: '3인칭' }).click();

    step('13: B 2턴 선완주 -> A는 목표/무승부 안내');
    await pageB.keyboard.press('ArrowRight');
    await expectText(pageB, '이동: 1');
    await pageB.keyboard.press('ArrowRight');
    await expectText(pageB, '턴으로 완주했습니다');
    await expectText(pageA, '상대방이 2턴으로 완주했습니다');
    await expectText(pageA, '1턴 이내로 완주하면 승리합니다');
    await pageA.keyboard.press('ArrowRight');
    await expectText(pageA, '이동: 1');
    await expectText(pageA, '다음 이동에 바로 골인하면 무승부입니다');

    step('14: A도 2턴으로 완주 -> 무승부');
    await pageA.keyboard.press('ArrowRight');
    await expectText(pageA, '무승부입니다!');
    await expectText(pageB, '무승부입니다!');
    await pageA.screenshot({ path: `${OUT}/mp-07-draw.png` });

    step('15: A(방장) 나가기 -> 방 삭제(방장 권한) -> B 자동 리디렉션');
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
    console.log('--- 에뮬레이터 모드: 데이터는 에뮬레이터 종료 시 소멸 ---');
  }
})();
