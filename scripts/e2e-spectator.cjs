/**
 * 관전자 E2E 테스트 (게임 진행 중인 방에 제3자가 관전 입장)
 *
 * ⚠️ Firebase 로컬 에뮬레이터 전용입니다. (구글 로그인은 실서버에서 자동화 불가)
 *
 * 실행 방법:
 *   1. npx firebase-tools emulators:start --only auth,database --project daemok-155c1
 *   2. NEXT_PUBLIC_FIREBASE_EMULATOR=1 npm run build && npm run start
 *   3. EMULATOR=1 node scripts/e2e-spectator.cjs
 *
 * 검증 시나리오:
 *   A, B 로그인 -> 2인 방 생성/참가 -> 게임 시작 (게임 중 상태)
 *   C 로그인 -> 로비에서 '👁 관전하기' -> 관전 모드 진입 (플레이어 칩 2개)
 *   A가 이동 -> C의 관전 화면에 A의 이동 수 실시간 반영
 *   C가 칩 클릭으로 B 관전 전환 -> B 시점 표시
 *   A 완주 / B 포기 -> C에게 결과 카드 (관전자 문구, 재시작 버튼 없음)
 *   플레이어 재시작 -> C는 정원(2/2) 가득이라 관전 대기 유지
 *   C 나가기 -> 로비 복귀 (게임에 영향 없음 확인: A/B는 맵 제작 화면 유지)
 *   A(방장) 나가기 -> 방 삭제 -> B 리디렉션
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
const ROOM_NAME = `관전테스트-${STAMP % 1000000}`;
const ACCOUNTS = {
  a: { email: `daemok.spec.a.${STAMP}@example.com`, name: 'PlayA' },
  b: { email: `daemok.spec.b.${STAMP}@example.com`, name: 'PlayB' },
  c: { email: `daemok.spec.c.${STAMP}@example.com`, name: 'WatchC' },
};

function step(msg) { console.log('STEP:', msg); }
function ok(msg) { console.log('  OK:', msg); }

async function expectText(page, text, timeout = 20000) {
  await page.getByText(text, { exact: false }).first().waitFor({ state: 'visible', timeout });
  ok(`saw: ${JSON.stringify(text)}`);
}

async function signInWithFakeGoogle(page, acc) {
  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' });

  const [popup] = await Promise.all([
    page.waitForEvent('popup'),
    page.getByRole('button', { name: /Google 계정으로 시작하기/ }).click(),
  ]);

  await popup.waitForLoadState('domcontentloaded');
  const addBtn = popup.getByRole('button', { name: /add new account/i });
  await addBtn.waitFor({ timeout: 10000 });
  await addBtn.click();
  const emailInput = popup.locator('#email-input, input[type="email"]').first();
  await emailInput.waitFor({ timeout: 10000 });
  await emailInput.fill(acc.email);
  const nameInput = popup.locator('#display-name-input, input[placeholder*="isplay"], #displayName').first();
  if (await nameInput.count()) {
    await nameInput.fill(acc.name);
  }
  await popup.getByRole('button', { name: /sign in with google/i }).click();

  await expectText(page, '새 게임 방 만들기', 25000);
}

// 맵 제작 (2D 고정 보드): 시작(0,0), 도착(0,2), 벽 없음 (최단 2턴)
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
  const ctxC = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const pageA = await ctxA.newPage();
  const pageB = await ctxB.newPage();
  const pageC = await ctxC.newPage();
  for (const [tag, p] of [['A', pageA], ['B', pageB], ['C', pageC]]) {
    p.on('console', (m) => {
      if (m.type() === 'error' && /permission|denied/i.test(m.text())) {
        console.log(`[${tag} PERMISSION]`, m.text().slice(0, 250));
      }
    });
    p.on('pageerror', (e) => console.log(`[${tag} pageerror]`, String(e).slice(0, 300)));
  }
  pageB.on('dialog', (d) => d.accept()); // 포기/나가기 확인 자동 수락
  pageA.on('dialog', (d) => d.accept());

  try {
    step('1: A, B 로그인 -> 2인 방 생성/참가 -> 게임 시작');
    await signInWithFakeGoogle(pageA, ACCOUNTS.a);
    await signInWithFakeGoogle(pageB, ACCOUNTS.b);

    await pageA.getByRole('button', { name: '새 게임 방 만들기' }).click();
    await pageA.fill('#roomName', ROOM_NAME);
    await pageA.getByRole('button', { name: '방 만들기' }).click();
    await pageA.waitForURL(/\/rooms\/.+/, { timeout: 20000 });
    await setupMap(pageA);

    const cardB = pageB.locator('[data-room-card]', { hasText: ROOM_NAME }).first();
    await cardB.waitFor({ timeout: 20000 });
    await cardB.getByRole('button', { name: '참가하기' }).click();
    await pageB.waitForURL(/\/rooms\/.+/, { timeout: 20000 });
    await setupMap(pageB);

    await expectText(pageA, '모두 준비되었습니다');
    await pageA.getByRole('button', { name: '게임 시작' }).click();
    await expectText(pageA, '이동: 0');
    await expectText(pageB, '이동: 0');
    ok('게임 시작됨 (2인전 진행 중)');

    step('2: C 로그인 -> 로비에 게임중 방이 관전 가능으로 표시');
    await signInWithFakeGoogle(pageC, ACCOUNTS.c);
    const cardC = pageC.locator('[data-room-card]', { hasText: ROOM_NAME }).first();
    await cardC.waitFor({ timeout: 20000 });
    await cardC.getByText('게임중').waitFor({ timeout: 20000 });
    const watchBtn = cardC.getByRole('button', { name: '관전하기' });
    await watchBtn.waitFor({ timeout: 20000 });
    ok('게임중 배지 + 관전하기 버튼 표시');

    step('3: C 관전 입장 -> 관전 모드 HUD (플레이어 칩 2개)');
    await watchBtn.click();
    await pageC.waitForURL(/\/rooms\/.+/, { timeout: 20000 });
    await expectText(pageC, '관전 모드');
    await expectText(pageC, '관전 중');
    const chipA = pageC.getByRole('button', { name: new RegExp(ACCOUNTS.a.name.substring(0, 5)) }).first();
    const chipB = pageC.getByRole('button', { name: new RegExp(ACCOUNTS.b.name.substring(0, 5)) }).first();
    await chipA.waitFor({ timeout: 15000 });
    await chipB.waitFor({ timeout: 15000 });
    ok('플레이어 칩 2개 (PlayA/PlayB)');

    step('4: A가 1칸 이동 -> C 관전 화면에 이동 수 실시간 반영');
    await chipA.click();
    await expectText(pageC, `${ACCOUNTS.a.name.substring(0, 8)} 관전 중`);
    await pageA.keyboard.press('ArrowRight');
    await expectText(pageA, '이동: 1');
    await expectText(pageC, '이동: 1'); // 관전 배너의 실시간 카운터
    await pageC.screenshot({ path: path.join(OUT, 'spectator-watching.png') });
    ok('A의 이동이 관전자 화면에 동기화됨');

    step('5: C가 칩 클릭으로 B 관전 전환');
    await chipB.click();
    await expectText(pageC, `${ACCOUNTS.b.name.substring(0, 8)} 관전 중`);
    ok('관전 대상 전환 (B)');

    step('6: A 완주 + B 포기 -> C에게 제3자 결과 카드 (재시작 버튼 없음)');
    await pageA.keyboard.press('ArrowRight'); // 2턴 완주
    await expectText(pageA, '축하합니다');
    // B: 상대 완주 후 포기 가능
    await expectText(pageB, '포기하기');
    await pageB.getByRole('button', { name: '포기하기' }).click();
    await expectText(pageC, `${ACCOUNTS.a.name.substring(0, 8)} 승리!`);
    await expectText(pageC, '참가자가 재시작하면 다음 게임도 이어서 관전합니다');
    const restartCount = await pageC.getByRole('button', { name: '재시작' }).count();
    if (restartCount > 0) throw new Error('관전자에게 재시작 버튼이 노출됨');
    await pageC.screenshot({ path: path.join(OUT, 'spectator-result.png') });
    ok('관전자 결과 카드 (재시작 버튼 없음)');

    step('7: 플레이어 재시작 -> C는 정원 가득으로 관전 대기 유지');
    await pageA.getByRole('button', { name: '재시작' }).click();
    await expectText(pageA, '시작점을 선택하세요');
    await expectText(pageC, '관전 대기 중');
    await expectText(pageC, '정원이 가득 차 이번 게임도 관전합니다');
    ok('재시작 후 관전 대기 (승격 없음 - 정원 2/2)');

    step('8: 재시작된 게임도 이어서 관전');
    await setupMap(pageA);
    await setupMap(pageB);
    await expectText(pageA, '모두 준비되었습니다');
    await pageA.getByRole('button', { name: '게임 시작' }).click();
    await expectText(pageA, '이동: 0');
    await expectText(pageC, '관전 중');
    ok('두 번째 게임 자동 관전');

    step('9: C 나가기 -> 로비 복귀, 게임은 영향 없음');
    await pageC.getByRole('button', { name: '나가기' }).click();
    await pageC.waitForURL(/\/rooms$/, { timeout: 20000 });
    // A는 계속 플레이 가능해야 함
    await pageA.keyboard.press('ArrowRight');
    await expectText(pageA, '이동: 1');
    ok('관전자 퇴장이 게임에 영향 없음');

    step('10: A(방장) 나가기 -> 방 삭제 -> B 리디렉션');
    await pageA.getByRole('button', { name: '나가기' }).click();
    await pageA.waitForURL(/\/rooms$/, { timeout: 20000 });
    await pageB.waitForURL(/\/rooms$/, { timeout: 25000 });
    ok('방 삭제 및 리디렉션');

    console.log('ALL SPECTATOR STEPS PASSED');
    console.log('--- 에뮬레이터 모드: 데이터는 에뮬레이터 종료 시 소멸 ---');
    await browser.close();
  } catch (e) {
    console.error('FAILED:', e.message);
    try {
      await pageA.screenshot({ path: path.join(OUT, 'spec-fail-A.png') });
      await pageB.screenshot({ path: path.join(OUT, 'spec-fail-B.png') });
      await pageC.screenshot({ path: path.join(OUT, 'spec-fail-C.png') });
    } catch {}
    await browser.close();
    process.exit(1);
  }
})();
