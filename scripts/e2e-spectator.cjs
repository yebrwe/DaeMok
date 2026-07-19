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
 *   C 로그인 -> 로비에서 관전하기 -> 관전 모드 진입
 *   참가자/관전자 모두 동시 보드 2개, 레거시 미니맵 부재 확인
 *   B의 대기 입력 무효 -> A 이동 -> C의 관전 화면에 A의 턴 수 실시간 반영
 *   B 행동도 C의 두 번째 보드에 실시간 반영
 *   B 행동으로 A에게 턴 교대 -> A/B 모두 실제 완주 -> C에게 결과 카드
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

async function expectPlayerBoardCount(page, expected, timeout = 20000) {
  const boards = page.locator('[data-player-board]');
  await boards.nth(expected - 1).waitFor({ state: 'visible', timeout });
  await page.waitForTimeout(100);
  const count = await boards.count();
  if (count !== expected) {
    throw new Error(`플레이어 보드 수 불일치: expected=${expected}, actual=${count}`);
  }
  if (count > 4) throw new Error(`동시 보드가 최대 4개를 초과함: ${count}`);
  ok(`player boards: ${count}`);
}

async function expectNoLegacyMinimap(page) {
  const legacyLabels = await page.getByText(/내 맵 \(/).count();
  const legacyNodes = await page.locator('[data-player-minimap]').count();
  if (legacyLabels > 0 || legacyNodes > 0) {
    throw new Error(`레거시 미니맵이 남아 있음: labels=${legacyLabels}, nodes=${legacyNodes}`);
  }
  ok('legacy minimap absent');
}

async function expectMyBoardTurns(page, expected, timeout = 20000) {
  const myBoard = page.locator('[data-player-board][data-my-player="true"]');
  await myBoard.waitFor({ state: 'visible', timeout });
  await myBoard.getByText(new RegExp(`(?:턴|이동):\\s*${expected}(?:\\D|$)`)).first()
    .waitFor({ state: 'visible', timeout });
  await page.getByText(`턴: ${expected}`, { exact: true }).first()
    .waitFor({ state: 'visible', timeout });
  ok(`my turns: ${expected}`);
}

async function expectNamedBoardTurns(page, name, expected, timeout = 20000) {
  const board = page.getByRole('region', { name: `${name} 게임 보드`, exact: true });
  await board.waitFor({ state: 'visible', timeout });
  await board.getByText(new RegExp(`(?:턴|이동):\\s*${expected}(?:\\D|$)`)).first()
    .waitFor({ state: 'visible', timeout });
  ok(`${name} board turns: ${expected}`);
}

async function getMyBoardTurns(page) {
  const text = await page.locator('[data-player-board][data-my-player="true"]').innerText();
  const match = text.match(/(?:턴|이동):\s*(\d+)/);
  if (!match) throw new Error(`내 보드에서 턴 수를 찾지 못함: ${JSON.stringify(text)}`);
  return Number(match[1]);
}

async function expectWaitingInputIgnored(page, key, expectedTurns) {
  const before = await getMyBoardTurns(page);
  await page.keyboard.press(key);
  await page.waitForTimeout(500);
  const after = await getMyBoardTurns(page);
  if (before !== expectedTurns || after !== expectedTurns) {
    throw new Error(`대기 입력이 턴을 변경함: before=${before}, after=${after}, expected=${expectedTurns}`);
  }
  ok(`waiting input ignored (${key}, turns=${expectedTurns})`);
}

async function signInWithFakeGoogle(page, acc) {
  await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: /Google 계정으로 시작하기/ }).waitFor({ timeout: 15000 });

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
  pageB.on('dialog', (d) => d.accept()); // 종료 뒤 나가기 확인 자동 수락
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
    await expectMyBoardTurns(pageA, 0);
    await expectMyBoardTurns(pageB, 0);
    await expectPlayerBoardCount(pageA, 2);
    await expectPlayerBoardCount(pageB, 2);
    await expectNoLegacyMinimap(pageA);
    await expectNoLegacyMinimap(pageB);
    await expectText(pageA, '내 턴');
    await expectText(pageB, `${ACCOUNTS.a.name} 턴`);
    ok('게임 시작됨 (엄격 교대 2인전 + 동시 보드 2개)');

    step('2: C 로그인 -> 로비에 게임중 방이 관전 가능으로 표시');
    await signInWithFakeGoogle(pageC, ACCOUNTS.c);
    const cardC = pageC.locator('[data-room-card]', { hasText: ROOM_NAME }).first();
    await cardC.waitFor({ timeout: 20000 });
    await cardC.getByText('게임중').waitFor({ timeout: 20000 });
    const watchBtn = cardC.getByRole('button', { name: '관전하기' });
    await watchBtn.waitFor({ timeout: 20000 });
    ok('게임중 배지 + 관전하기 버튼 표시');

    step('3: C 관전 입장 -> 관전 HUD + 동시 보드 2개');
    await watchBtn.click();
    await pageC.waitForURL(/\/rooms\/.+/, { timeout: 20000 });
    await expectText(pageC, '관전 모드');
    await expectText(pageC, '관전 중');
    await expectPlayerBoardCount(pageC, 2);
    if (await pageC.locator('[data-map-owner-preview="true"]').count() !== 0) {
      throw new Error('관전자에게 맵 제작자 시점 권한이 노출됨');
    }
    await expectNoLegacyMinimap(pageC);
    await expectNamedBoardTurns(pageC, ACCOUNTS.a.name, 0);
    await expectNamedBoardTurns(pageC, ACCOUNTS.b.name, 0);
    ok('동시 보드 2개 (PlayA/PlayB)');

    step('4: B 대기 입력 무효 -> A 1칸 이동 -> C 보드에 턴 수 실시간 반영');
    await expectWaitingInputIgnored(pageB, 'ArrowRight', 0);
    await pageA.keyboard.press('ArrowRight');
    await expectMyBoardTurns(pageA, 1);
    await expectText(pageB, '내 턴');
    await expectNamedBoardTurns(pageC, ACCOUNTS.a.name, 1);
    await pageC.screenshot({ path: path.join(OUT, 'spectator-watching.png') });
    ok('A의 턴이 관전자 동시 보드에 동기화됨');

    step('5: B 행동도 C의 두 번째 보드에 반영되고 A에게 교대');
    await pageB.keyboard.press('ArrowDown');
    await expectMyBoardTurns(pageB, 1);
    await expectNamedBoardTurns(pageC, ACCOUNTS.b.name, 1);
    await expectText(pageA, '내 턴');
    ok('B 보드 동기화 및 B -> A 턴 교대');

    step('6: A 완주 후 B로 skip + B도 실제 완주 -> C에게 제3자 결과 카드');
    await pageA.keyboard.press('ArrowRight'); // 2턴 완주
    await expectText(pageA, '턴으로 완주했습니다');
    await expectText(pageB, '내 턴');
    if (await pageB.getByRole('button', { name: /포기|기권/ }).count() > 0) {
      throw new Error('진행 중인 플레이어에게 포기/기권 버튼이 노출됨');
    }
    const finishOnlyButton = pageB.getByRole('button', { name: '🏁 끝까지 진행' }).first();
    await finishOnlyButton.waitFor({ timeout: 10000 });
    if (!(await finishOnlyButton.isDisabled())) {
      throw new Error('진행 중 참가자 나가기가 차단되지 않음');
    }
    await pageB.keyboard.press('ArrowUp');
    await expectMyBoardTurns(pageB, 2);
    await pageB.keyboard.press('ArrowRight');
    await expectMyBoardTurns(pageB, 3);
    await pageB.keyboard.press('ArrowRight');
    await expectText(pageB, '턴으로 완주했습니다');
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
    await expectMyBoardTurns(pageA, 0);
    await expectPlayerBoardCount(pageC, 2);
    await expectNoLegacyMinimap(pageC);
    await expectText(pageC, '관전 중');
    ok('두 번째 게임 자동 관전');

    step('9: C 나가기 -> 로비 복귀, 게임은 영향 없음');
    await pageC.getByRole('button', { name: '나가기' }).click();
    await pageC.waitForURL(/\/rooms$/, { timeout: 20000 });
    // A는 계속 플레이 가능해야 함
    await pageA.keyboard.press('ArrowRight');
    await expectMyBoardTurns(pageA, 1);
    await expectText(pageB, '내 턴');
    ok('관전자 퇴장이 게임에 영향 없음');

    step('10: 두 번째 게임도 양쪽 완주 -> A(방장) 나가기 -> 방 삭제 -> B 리디렉션');
    await pageB.keyboard.press('ArrowRight');
    await expectMyBoardTurns(pageB, 1);
    await expectText(pageA, '내 턴');
    await pageA.keyboard.press('ArrowRight');
    await expectText(pageB, '내 턴');
    await pageB.keyboard.press('ArrowRight');
    await expectText(pageA, '무승부입니다');
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
