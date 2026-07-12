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
 * 검증 시나리오 (엄격 교대 턴, 최종 개인 턴 수 비교로 승부):
 *   구글 로그인(에뮬레이터 가짜 계정) x2 -> 방 생성/참가 -> 맵 제작 x2 -> 자동 시작
 *   [1게임] 동시 보드 2개 확인 -> B의 대기 입력 무효 -> A/B 교대 -> A 선완주
 *           -> 완주자 턴 건너뜀 -> B 포기 -> A 승리
 *   [2게임] 재시작 -> A/B 교대 -> 양쪽 2턴 완주 -> 무승부
 *   [재시작 회귀] B가 진행 중 퇴장 -> A 완주 -> 재시작 시 hasLeft 유령 제외
 *   [3인전] 동시 보드 3개 확인 -> A/B/C 교대 -> A/B 완주자 건너뜀 -> C 포기
 *   마지막: 방장 나가기 -> 방 즉시 삭제 -> 상대 자동 리디렉션
 */
const { chromium } = require('playwright');
const { PNG } = require('playwright-core/lib/utilsBundle');
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
  c: { email: `daemok.e2e.c.${STAMP}@example.com`, name: 'TestC' },
  d: { email: `daemok.e2e.d.${STAMP}@example.com`, name: 'TestD' },
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

async function expectNonBlankCanvases(page, expected) {
  await page.waitForTimeout(500);
  const canvases = page.locator('[data-player-board] canvas');
  const stats = [];
  for (let canvasIndex = 0; canvasIndex < await canvases.count(); canvasIndex += 1) {
    const image = PNG.sync.read(await canvases.nth(canvasIndex).screenshot());
    const data = image.data;
    let opaque = 0;
    let min = 255;
    let max = 0;
    for (let index = 0; index < data.length; index += 4) {
      if (data[index + 3] > 0) opaque += 1;
      const lightness = Math.round((data[index] + data[index + 1] + data[index + 2]) / 3);
      min = Math.min(min, lightness);
      max = Math.max(max, lightness);
    }
    stats.push({ opaque, range: max - min });
  }
  if (stats.length !== expected || stats.some((stat) => stat.opaque < 100 || stat.range < 15)) {
    throw new Error(`3D 캔버스가 비었거나 프레임이 잘못됨: ${JSON.stringify(stats)}`);
  }
  ok(`nonblank 3D canvases: ${stats.length}`);
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

async function getMyBoardTurns(page) {
  const text = await page.locator('[data-player-board][data-my-player="true"]').innerText();
  const match = text.match(/(?:턴|이동):\s*(\d+)/);
  if (!match) throw new Error(`내 보드에서 턴 수를 찾지 못함: ${JSON.stringify(text)}`);
  return Number(match[1]);
}

async function expectWaitingInputIgnored(page, key, expectedTurns) {
  const moveButtons = page.getByRole('button', { name: /^(위|아래|왼쪽|오른쪽)으로 이동$/ });
  const buttonCount = await moveButtons.count();
  for (let index = 0; index < buttonCount; index += 1) {
    if (!(await moveButtons.nth(index).isDisabled())) {
      throw new Error('대기 중인데 방향 버튼이 활성화되어 있음');
    }
  }

  const before = await getMyBoardTurns(page);
  await page.keyboard.press(key);
  await page.waitForTimeout(500);
  const after = await getMyBoardTurns(page);
  if (before !== expectedTurns || after !== expectedTurns) {
    throw new Error(`대기 입력이 턴을 변경함: before=${before}, after=${after}, expected=${expectedTurns}`);
  }
  ok(`waiting input ignored (${key}, turns=${expectedTurns})`);
}

// 구글 로그인 - 에뮬레이터의 가짜 계정 팝업을 자동 조작
async function signInWithFakeGoogle(page, acc) {
  await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: /Google 계정으로 시작하기/ }).waitFor({ timeout: 15000 });

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

// 맵 제작 (2D 고정 보드): 시작(0,0), 도착(0,2), 벽 없음 (최단 2턴)
async function setupMap(page, { smoke = false, ownerSecrets = false, verifyWormholeSafety = false } = {}) {
  await expectText(page, '시작점을 선택하세요');
  const items = page.locator('div.grid').first().locator(':scope > *');
  await items.nth(0).click();
  await expectText(page, '도착점을 선택하세요');
  await items.nth(4).click();
  await expectText(page, '벽(장애물)을 배치하세요');
  if (verifyWormholeSafety) {
    const mineButton = page.getByRole('button', { name: /지뢰/ }).first();
    await mineButton.click();
    await page.locator('[data-cell="5,4"]').click();
    await page.getByRole('button', { name: '이전' }).click();
    await page.locator('[data-cell="5,4"]').click();
    if (!(await page.getByText('도착점을 선택하세요', { exact: false }).isVisible())) {
      throw new Error('셀형 아이템 위로 도착점을 옮길 수 있음');
    }
    await page.locator('[data-cell="0,2"]').click();

    const cornerWall = page.getByRole('button', { name: '6행 5열 right 벽' });
    const wormholeButton = page.getByRole('button', { name: /웜홀/ }).first();
    await cornerWall.click();
    await wormholeButton.click();
    await page.locator('[data-cell="3,3"]').click();

    let safetyMessage = '';
    page.once('dialog', async (dialog) => {
      safetyMessage = dialog.message();
      await dialog.accept();
    });
    await page.locator('[data-cell="5,5"]').click();
    if (!safetyMessage.includes('즉시 열린 방향이 최소 2개')) {
      throw new Error(`웜홀 출구 안전 검증 메시지 불일치: ${JSON.stringify(safetyMessage)}`);
    }

    await wormholeButton.click(); // 배치 취소
    await cornerWall.click();
    await wormholeButton.click();
    await page.locator('[data-cell="3,3"]').click();
    const safeExit = page.locator('[data-cell="5,5"][data-valid-item-target="true"]');
    await safeExit.waitFor({ state: 'visible', timeout: 10000 });
    await safeExit.click();
    if (!(await wormholeButton.isDisabled())) {
      throw new Error('웜홀 1개 배치 후 종류별 최대 수량 제한이 적용되지 않음');
    }
    ok('item/goal overlap rejected; unsafe wormhole exit rejected; safe exit highlighted; cap enforced');
  }
  if (ownerSecrets) {
    await page.getByRole('button', { name: '4행 1열 right 벽' }).click();
    await page.getByRole('button', { name: /가짜벽/ }).first().click();
    await page.getByRole('button', { name: '3행 1열 right 벽' }).click();
    await page.getByRole('button', { name: /지뢰/ }).first().click();
    await page.locator('[data-cell="2,2"]').click();
    await page.getByRole('button', { name: /웜홀/ }).first().click();
    await page.locator('[data-cell="3,3"]').click();
    await page.locator('[data-cell="4,4"]').click();
  }
  if (smoke) {
    await page.getByRole('button', { name: /연막 함정/ }).first().click();
    await page.locator('[data-cell="0,1"]').click();
    const placedItems = await page.locator('[aria-label="배치된 아이템"]').innerText();
    if (!placedItems.includes('연막 함정')) throw new Error('연막 함정 제작 상태가 표시되지 않음');
  }
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

    step('3: A 맵 제작 완료 -> 방장 대기 화면 (시작 버튼 비활성)');
    await setupMap(pageA, { verifyWormholeSafety: true });
    await expectText(pageA, '참가자 (1/2)');
    await pageA.getByRole('button', { name: '게임 시작' }).waitFor({ timeout: 15000 });

    step('4: B가 방 목록에서 참가');
    const card = pageB.locator('[data-room-card]', { hasText: ROOM_NAME }).first();
    await card.waitFor({ timeout: 20000 });
    await card.getByRole('button', { name: '참가하기' }).click();
    await pageB.waitForURL(/\/rooms\/.+/, { timeout: 20000 });

    step('5: B 맵 제작 완료 -> B는 방장 대기, A(방장)가 게임 시작');
    await setupMap(pageB, { smoke: true, ownerSecrets: true });
    await expectText(pageB, '방장이 시작하면 게임이 시작됩니다');
    await pageB.getByRole('button', { name: '맵 다시 만들기' }).click();
    await expectText(pageB, '시작점을 선택하세요');
    await setupMap(pageB, { smoke: true, ownerSecrets: true });
    await expectText(pageB, '방장이 시작하면 게임이 시작됩니다');
    ok('non-owner map reopen and rebuild works');
    await expectText(pageA, '모두 준비되었습니다');
    await pageA.getByRole('button', { name: '게임 시작' }).click();
    await expectMyBoardTurns(pageA, 0);
    await expectMyBoardTurns(pageB, 0);

    step('6: 3인칭 기본 + 동시 보드 2개 + 레거시 미니맵 부재');
    await pageA.getByRole('button', { name: '3D 보드' }).waitFor({ timeout: 10000 });
    const fpCount = await pageA.getByRole('button', { name: '1인칭' }).count();
    if (fpCount > 0) throw new Error('1인칭 버튼이 아직 남아 있음');
    await expectPlayerBoardCount(pageA, 2);
    await expectPlayerBoardCount(pageB, 2);
    await expectNoLegacyMinimap(pageA);
    await expectNoLegacyMinimap(pageB);
    await expectText(pageA, '/ 2명'); // 실시간 순위 카드 (마리오카트식)
    await expectText(pageA, '내 턴');
    await expectText(pageB, `${ACCOUNTS.a.name} 턴`);
    ok('3인칭 기본 + 동시 보드 + 턴 HUD 확인');

    step('6-1: 2D 제작자 시점만 숨은 아이템 공개 + 가짜벽 구분');
    await pageA.getByRole('button', { name: '2D 보드', exact: true }).click();
    await pageB.getByRole('button', { name: '2D 보드', exact: true }).click();
    const ownerBoard = pageB.locator('[data-player-board][data-map-owner-preview="true"]');
    await ownerBoard.waitFor({ timeout: 10000 });
    for (const itemType of ['oneTimeWall', 'mine', 'wormhole', 'smoke']) {
      if (await ownerBoard.locator(`[data-map-item="${itemType}"]`).count() === 0) {
        throw new Error(`온라인 제작자 시점에서 ${itemType}이 보이지 않음`);
      }
    }
    if (await ownerBoard.locator('[data-map-item="oneTimeWall"] .bg-cyan-400').count() < 3) {
      throw new Error('온라인 제작자 시점 가짜벽이 일반벽과 구분되지 않음');
    }
    if (await ownerBoard.locator('.bg-amber-400').count() === 0) {
      throw new Error('온라인 제작자 시점에서 일반벽이 보이지 않음');
    }
    if (await pageA.locator('[data-player-board][data-my-player="true"] [data-map-item]').count() !== 0) {
      throw new Error('온라인 주자 화면에 상대 비밀 아이템 DOM이 노출됨');
    }
    await pageA.screenshot({ path: `${OUT}/mp-runner-secrets-hidden-2d.png` });
    await pageB.screenshot({ path: `${OUT}/mp-owner-secrets-2d.png` });
    await pageA.getByRole('button', { name: '3D 보드', exact: true }).click();
    await pageB.getByRole('button', { name: '3D 보드', exact: true }).click();
    ok('온라인 제작자만 전체 함정 공개, 주자에게는 비공개');

    step('7: [1게임] B의 대기 입력 무효 -> A/B 한 행동씩 교대');
    await expectWaitingInputIgnored(pageB, 'ArrowRight', 0);
    await pageA.keyboard.press('ArrowRight');
    await expectMyBoardTurns(pageA, 1);
    await expectText(pageB, '내 턴');
    await expectWaitingInputIgnored(pageA, 'ArrowRight', 1);
    await pageB.keyboard.press('ArrowDown');
    await expectMyBoardTurns(pageB, 1);
    await expectText(pageA, '내 턴');
    await pageA.locator('[data-my-player="true"][data-vision-effect="smoke"][data-vision-obscured="true"]')
      .waitFor({ timeout: 10000 });
    await pageA.locator('[data-testid=board-obscure-overlay]').waitFor({ timeout: 10000 });
    if (await pageA.getByRole('button', { name: '오른쪽으로 이동' }).first().isDisabled()) {
      throw new Error('온라인 연막 상태에서 대상의 방향 조작이 비활성화됨');
    }
    if (await pageB.locator('[data-vision-obscured="true"]').count() > 0) {
      throw new Error('연막을 설치한 상대 화면까지 완전히 가려짐');
    }
    if (await pageB.locator('[data-vision-effect="smoke"]').count() !== 1) {
      throw new Error('상대 화면에 연막 피격 상태가 표시되지 않음');
    }
    ok('Firebase 연막 상태 동기화 + 피격자 자신의 다음 차례만 시야 차단');

    step('8: A가 두 번째 행동으로 선완주 -> B로 턴 이동');
    await pageA.keyboard.press('ArrowRight');
    await expectText(pageA, '턴으로 완주했습니다');
    await expectMyBoardTurns(pageA, 2);
    if (await pageA.locator('[data-vision-obscured="true"]').count() > 0) {
      throw new Error('온라인 유효 행동 후 연막이 해제되지 않음');
    }
    await expectText(pageB, '내 턴');
    ok('A 2턴 완주 후 완주자를 건너뛰고 B 턴 유지');

    step('9: A = 관전 모드(승부 미확정), B = 목표 턴 수 + 포기 버튼');
    await expectText(pageA, '관전 중');
    await pageA.waitForTimeout(1000);
    await pageA.screenshot({ path: `${OUT}/mp-01-A-spectate.png` });
    await expectText(pageB, '상대방이 2턴으로 완주했습니다');
    await expectText(pageB, '다음 이동에 바로 골인하면 무승부입니다');
    await pageB.getByRole('button', { name: '포기하기' }).waitFor({ timeout: 15000 });
    await pageB.screenshot({ path: `${OUT}/mp-02-B-forfeit-option.png` });

    step('10: B 두 번째 헛걸음 -> A 완주자를 건너뛰어 B가 계속 현재 턴');
    await pageB.keyboard.press('ArrowUp');
    await expectMyBoardTurns(pageB, 2);
    await expectText(pageB, '내 턴');
    await expectText(pageB, '승리할 수 없습니다');
    await pageA.waitForTimeout(800);
    await pageA.screenshot({ path: `${OUT}/mp-03-A-watching-B-move.png` });

    step('11: B 포기 -> A 승리 / B 패배');
    await pageB.getByRole('button', { name: '포기하기' }).click();
    await expectText(pageA, '승리했습니다! (상대 포기)');
    await expectText(pageB, '포기하여 패배했습니다');
    await pageA.screenshot({ path: `${OUT}/mp-04-A-win.png` });
    await pageB.screenshot({ path: `${OUT}/mp-05-B-forfeit-lose.png` });

    step('12: 재시작 -> 양쪽 모두 맵 제작으로 복귀');
    await pageA.getByRole('button', { name: '재시작' }).click();
    await expectText(pageA, '시작점을 선택하세요');
    await expectText(pageB, '시작점을 선택하세요');

    step('13: [2게임] 맵 제작 x2 -> 방장 시작');
    await setupMap(pageA);
    await setupMap(pageB);
    await expectText(pageA, '모두 준비되었습니다');
    await pageA.getByRole('button', { name: '게임 시작' }).click();
    await expectMyBoardTurns(pageA, 0);
    await expectMyBoardTurns(pageB, 0);
    await expectText(pageA, '내 턴');

    step('14: A/B가 오른쪽으로 한 칸씩 엄격 교대');
    await pageA.keyboard.press('ArrowRight');
    await expectMyBoardTurns(pageA, 1);
    await expectText(pageB, '내 턴');
    await pageB.keyboard.press('ArrowRight');
    await expectMyBoardTurns(pageB, 1);
    await expectText(pageA, '내 턴');

    step('15: A 선완주 후 B로 턴 skip -> B도 2턴 완주해 무승부');
    await pageA.keyboard.press('ArrowRight');
    await expectText(pageA, '턴으로 완주했습니다');
    await expectText(pageB, '내 턴');
    await expectText(pageB, '다음 이동에 바로 골인하면 무승부입니다');
    await pageB.keyboard.press('ArrowRight');
    await expectText(pageA, '무승부입니다!');
    await expectText(pageB, '무승부입니다!');
    await pageA.screenshot({ path: `${OUT}/mp-07-draw.png` });

    step('16: A(방장) 나가기 -> 방 삭제(방장 권한) -> B 자동 리디렉션');
    await pageA.getByRole('button', { name: '나가기' }).first().click();
    await pageA.waitForURL(/\/rooms$/, { timeout: 20000 });
    await pageB.waitForURL(/\/rooms$/, { timeout: 25000 });

    step('16-1: [재시작 회귀] 진행 중 퇴장한 B가 다음 경기 roster에 복원되지 않음');
    const restartRoomName = `${ROOM_NAME}-restart-roster`;
    await pageA.getByRole('button', { name: '새 게임 방 만들기' }).click();
    await pageA.fill('#roomName', restartRoomName);
    await pageA.getByRole('button', { name: '방 만들기' }).click();
    await pageA.waitForURL(/\/rooms\/.+/, { timeout: 20000 });

    const restartCard = pageB.locator('[data-room-card]', { hasText: restartRoomName }).first();
    await restartCard.waitFor({ timeout: 20000 });
    await restartCard.getByRole('button', { name: '참가하기' }).click();
    await pageB.waitForURL(/\/rooms\/.+/, { timeout: 20000 });
    await setupMap(pageA);
    await setupMap(pageB);
    await expectText(pageA, '모두 준비되었습니다');
    await pageA.getByRole('button', { name: '게임 시작' }).click();
    await expectText(pageA, '내 턴');

    await pageB.getByRole('button', { name: '나가기' }).first().click();
    await pageB.waitForURL(/\/rooms$/, { timeout: 20000 });
    await pageA.keyboard.press('ArrowRight');
    await expectMyBoardTurns(pageA, 1);
    await expectText(pageA, '내 턴');
    await pageA.keyboard.press('ArrowRight');
    await expectText(pageA, '승리했습니다');

    await pageA.getByRole('button', { name: '재시작' }).click();
    await expectText(pageA, '시작점을 선택하세요');
    await setupMap(pageA);
    await expectText(pageA, '참가자 (1/2)');
    ok('fresh room snapshot + !hasLeft roster excludes departed player on restart');

    await pageA.getByRole('button', { name: '나가기' }).first().click();
    await pageA.waitForURL(/\/rooms$/, { timeout: 20000 });

    // ============ 3인전 (순환 릴레이) ============
    step('17: [3인전] C 로그인 + A가 3인 방 생성');
    const ctxC = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const pageC = await ctxC.newPage();
    pageC.on('dialog', (d) => d.accept());
    pageC.on('console', (m) => {
      if (m.type() === 'error' && /permission|denied/i.test(m.text())) {
        console.log('[C PERMISSION]', m.text().slice(0, 250));
      }
    });
    await signInWithFakeGoogle(pageC, ACCOUNTS.c);

    await pageA.getByRole('button', { name: '새 게임 방 만들기' }).click();
    await pageA.fill('#roomName', `${ROOM_NAME}-3p`);
    await pageA.getByRole('button', { name: '3명', exact: true }).click();
    await pageA.getByRole('button', { name: '방 만들기' }).click();
    await pageA.waitForURL(/\/rooms\/.+/, { timeout: 20000 });
    ok('3인 방 생성');

    step('18: B, C 참가 + 전원 맵 제작 -> 방장 시작');
    for (const pg of [pageB, pageC]) {
      const card3 = pg.locator('[data-room-card]', { hasText: `${ROOM_NAME}-3p` }).first();
      await card3.waitFor({ timeout: 20000 });
      await card3.getByRole('button', { name: '참가하기' }).click();
      await pg.waitForURL(/\/rooms\/.+/, { timeout: 20000 });
    }
    await setupMap(pageA);
    await setupMap(pageB);
    await setupMap(pageC);
    await expectText(pageA, '참가자 (3/3)');
    await expectText(pageA, '모두 준비되었습니다');
    await pageA.getByRole('button', { name: '게임 시작' }).click();
    await expectMyBoardTurns(pageA, 0);
    await expectMyBoardTurns(pageB, 0);
    await expectMyBoardTurns(pageC, 0);
    await expectPlayerBoardCount(pageA, 3);
    await expectPlayerBoardCount(pageB, 3);
    await expectPlayerBoardCount(pageC, 3);
    for (const [label, participantPage] of [['A', pageA], ['B', pageB], ['C', pageC]]) {
      const ownerPreviewCount = await participantPage.locator('[data-map-owner-preview="true"]').count();
      if (ownerPreviewCount !== 1) {
        throw new Error(`3인전 ${label}의 제작자 시점 보드 수 오류: ${ownerPreviewCount}`);
      }
    }
    await expectNoLegacyMinimap(pageA);
    await expectNoLegacyMinimap(pageB);
    await expectNoLegacyMinimap(pageC);
    await expectText(pageA, '내 턴');
    ok('3인 게임 시작 (순환 릴레이 배정 + 동시 보드 3개)');

    step('19: A/B/C 1라운드 엄격 교대');
    await pageA.keyboard.press('ArrowRight');
    await expectMyBoardTurns(pageA, 1);
    await expectText(pageB, '내 턴');
    await pageB.keyboard.press('ArrowDown');
    await expectMyBoardTurns(pageB, 1);
    await expectText(pageC, '내 턴');
    await pageC.keyboard.press('ArrowDown');
    await expectMyBoardTurns(pageC, 1);
    await expectText(pageA, '내 턴');

    step('20: A 2턴 완주 -> B 행동 -> C 현재 턴 포기');
    await pageA.keyboard.press('ArrowRight');
    await expectText(pageA, '턴으로 완주했습니다');
    await expectMyBoardTurns(pageA, 2);
    await expectText(pageB, '내 턴');
    await pageB.keyboard.press('ArrowUp');
    await expectMyBoardTurns(pageB, 2);
    await expectText(pageC, '내 턴');
    await expectText(pageC, '상대방이 2턴으로 완주했습니다');
    await pageC.getByRole('button', { name: '포기하기' }).click();
    await expectText(pageB, '내 턴');
    await pageC.locator('[data-player-board][data-my-player="true"]')
      .getByText('포기', { exact: true }).waitFor({ state: 'visible', timeout: 20000 });
    ok('A 완주와 C 포기 상태를 모두 건너뛰어 B에게 턴 유지');

    step('21: B만 남아 연속 2행동 후 4턴 완주 -> 최소 턴 A 승리');
    await pageB.keyboard.press('ArrowRight');
    await expectMyBoardTurns(pageB, 3);
    await expectText(pageB, '내 턴');
    await pageB.keyboard.press('ArrowRight'); // 4턴 완주
    await expectText(pageB, '턴으로 완주했습니다');
    await expectText(pageA, '승리했습니다');
    await expectText(pageB, '패배했습니다');
    await expectText(pageC, '포기하여 패배했습니다');
    await pageA.screenshot({ path: `${OUT}/mp-3p-result-A.png` });
    ok('3인 정산 정상 (완주/포기 skip + 최소 턴 우승)');

    step('22: A(방장) 나가기 -> 방 삭제 -> B, C 자동 리디렉션');
    await pageA.getByRole('button', { name: '나가기' }).first().click();
    await pageA.waitForURL(/\/rooms$/, { timeout: 20000 });
    await pageB.waitForURL(/\/rooms$/, { timeout: 25000 });
    await pageC.waitForURL(/\/rooms$/, { timeout: 25000 });
    const rankingPanel = pageA.locator('[data-testid="maze-ranking"]');
    await rankingPanel.waitFor({ state: 'visible', timeout: 20000 });
    await rankingPanel.getByText('TestA', { exact: false }).first().waitFor({ state: 'visible', timeout: 20000 });
    const rankingText = await rankingPanel.innerText();
    if (!rankingText.includes('RP') || !/\d+승/.test(rankingText)) {
      throw new Error(`Firebase 미로 랭킹 정산/표시 누락: ${JSON.stringify(rankingText)}`);
    }
    ok('persistent Firebase maze ranking settled before owner room deletion');

    step('23: [4인 화면] D 로그인 + 4인 방 생성/참가');
    const ctxD = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const pageD = await ctxD.newPage();
    await signInWithFakeGoogle(pageD, ACCOUNTS.d);
    await pageA.getByRole('button', { name: '새 게임 방 만들기' }).click();
    await pageA.fill('#roomName', `${ROOM_NAME}-4p`);
    await pageA.getByRole('button', { name: '4명', exact: true }).click();
    await pageA.getByRole('button', { name: '방 만들기' }).click();
    await pageA.waitForURL(/\/rooms\/.+/, { timeout: 20000 });

    for (const pg of [pageB, pageC, pageD]) {
      const card4 = pg.locator('[data-room-card]', { hasText: `${ROOM_NAME}-4p` }).first();
      await card4.waitFor({ timeout: 20000 });
      await card4.getByRole('button', { name: '참가하기' }).click();
      await pg.waitForURL(/\/rooms\/.+/, { timeout: 20000 });
    }
    for (const pg of [pageA, pageB, pageC, pageD]) await setupMap(pg);
    await expectText(pageA, '참가자 (4/4)');
    await expectText(pageA, '모두 준비되었습니다');
    await pageA.getByRole('button', { name: '게임 시작' }).click();
    await expectMyBoardTurns(pageA, 0);
    await expectPlayerBoardCount(pageA, 4);
    if (await pageA.locator('[data-map-owner-preview="true"]').count() !== 1) {
      throw new Error('4인전 제작자 시점 보드가 정확히 하나가 아님');
    }
    await expectPlayerBoardCount(pageD, 4);
    const canvasCount = await pageA.locator('[data-player-board] canvas').count();
    if (canvasCount !== 4) throw new Error(`4인 3D 캔버스 수 불일치: ${canvasCount}`);
    await expectNonBlankCanvases(pageA, 4);
    await pageA.screenshot({ path: `${OUT}/mp-4p-desktop.png` });
    await pageA.setViewportSize({ width: 360, height: 800 });
    await expectPlayerBoardCount(pageA, 4);
    await expectNonBlankCanvases(pageA, 4);
    const mobileLayout = await pageA.evaluate(() => {
      const viewport = { width: window.innerWidth, height: window.innerHeight };
      const selectors = ['[data-testid="online-hud"]', '[data-testid="online-controls"]'];
      const containers = selectors.map((selector) => {
        const element = document.querySelector(selector);
        if (!element) return { selector, missing: true };
        const rect = element.getBoundingClientRect();
        return {
          selector,
          missing: false,
          inside: rect.left >= -1 && rect.right <= viewport.width + 1 && rect.top >= -1 && rect.bottom <= viewport.height + 1,
        };
      });
      const controlSizes = Array.from(document.querySelectorAll('[data-testid="online-controls"] button')).map((button) => {
        const rect = button.getBoundingClientRect();
        return { width: rect.width, height: rect.height };
      });
      return { viewport, containers, controlSizes };
    });
    if (mobileLayout.containers.some((entry) => entry.missing || !entry.inside)) {
      throw new Error(`Galaxy S21 HUD/controls overflow: ${JSON.stringify(mobileLayout.containers)}`);
    }
    if (mobileLayout.controlSizes.some((size) => size.width < 44 || size.height < 44)) {
      throw new Error(`Galaxy S21 control target below 44px: ${JSON.stringify(mobileLayout.controlSizes)}`);
    }
    await pageA.screenshot({ path: `${OUT}/mp-4p-galaxy-s21.png` });
    ok('4인 2x2 동시 보드 및 데스크톱/Galaxy S21 렌더링');

    step('24: 4인 방 삭제');
    pageA.once('dialog', (dialog) => dialog.accept());
    await pageA.getByRole('button', { name: '나가기' }).first().click();
    await pageA.waitForURL(/\/rooms$/, { timeout: 20000 });

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
