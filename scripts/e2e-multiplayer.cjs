/**
 * 멀티플레이 E2E 테스트 (구글 로그인 + 턴 수 승리 + 관전 + 의무 완주 + 무승부 + 보안 규칙)
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
 *   [1게임] 동시 보드 2개 확인 -> B의 대기 입력 무효 -> 가짜벽 1회 차단/다음 시도 통과
 *           -> A/B 교대 -> A 선완주
 *           -> 완주자 턴 건너뜀 -> B도 실제 완주 -> 최소 턴 A 승리
 *   [2게임] 재시작 -> A/B 교대 -> 양쪽 2턴 완주 -> 무승부
 *   [재시작 회귀] 진행 중 나가기 차단 -> 양쪽 완주 -> 재시작 roster 유지
 *   [3인전] 동시 보드 3개 확인 -> A/B/C 전원 완주 -> 최소 턴 A 승리
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
const RUNNER_GEAR_WALL_BUDGET = Object.freeze({
  none: 25,
  wormholeEscapeKit: 15,
  insight: 15,
});

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

async function expectMobileAllBoardsContract(page, expectedBoards, label, timeout = 4000) {
  const matchesContract = (candidate) => !!candidate
    && candidate.mountedCount === String(expectedBoards)
    && candidate.mountedBoards === expectedBoards
    && candidate.tabLists === 0
    && candidate.myBoards === 1
    && candidate.rootInsideViewport
    && new Set(candidate.runnerIds).size === expectedBoards
    && candidate.boards.every(
      (board) => board.runnerId && board.inside && board.width >= 80 && board.height >= 60 && board.canvases === 1
    );
  const deadline = Date.now() + timeout;
  let state = null;
  do {
    state = await page.evaluate(() => {
      const element = document.querySelector('[data-mounted-board-count]');
      if (!element) return null;
      const rootRect = element.getBoundingClientRect();
      const mountedBoards = Array.from(element.querySelectorAll('[data-player-board]'));
      return {
        mountedCount: element.getAttribute('data-mounted-board-count'),
        mountedBoards: mountedBoards.length,
        tabLists: element.querySelectorAll('[data-testid="mobile-board-tabs"]').length,
        myBoards: mountedBoards.filter((board) => board.getAttribute('data-my-player') === 'true').length,
        runnerIds: mountedBoards.map((board) => board.getAttribute('data-player-board')),
        rootInsideViewport:
          rootRect.left >= -1
          && rootRect.right <= window.innerWidth + 1
          && rootRect.top >= -1
          && rootRect.bottom <= window.innerHeight + 1,
        boards: mountedBoards.map((board) => {
          const rect = board.getBoundingClientRect();
          return {
            runnerId: board.getAttribute('data-player-board'),
            width: rect.width,
            height: rect.height,
            inside:
              rect.left >= rootRect.left - 1
              && rect.right <= rootRect.right + 1
              && rect.top >= rootRect.top - 1
              && rect.bottom <= rootRect.bottom + 1,
            canvases: board.querySelectorAll('canvas').length,
          };
        }),
      };
    });
    if (matchesContract(state)) break;
    await page.waitForTimeout(100);
  } while (Date.now() < deadline);

  if (!state) {
    throw new Error(`${label}에서 동시 보드 루트를 찾지 못함`);
  }

  if (!matchesContract(state)) {
    throw new Error(`${label} 모바일 동시 보드 계약 오류: ${JSON.stringify(state)}`);
  }

  ok(`${label}: 상대 포함 모바일 보드 ${expectedBoards}개 동시 표시, 전환 탭 없음`);
}

async function expectOnlineLandscapeDpadRail(page) {
  const result = await page.evaluate(() => {
    const dock = document.querySelector('[data-testid="online-mobile-direction-dock"]');
    const pad = document.querySelector('[data-testid="online-mobile-direction-pad"]');
    const controls = document.querySelector('[data-testid="online-controls"]');
    const boards = [...document.querySelectorAll('[data-player-board]')];
    const desktopDirections = document.querySelector('.game-desktop-direction-buttons');
    if (!dock || !pad || !controls || boards.length === 0 || !desktopDirections) return { missing: true };

    const dockRect = dock.getBoundingClientRect();
    const padRect = pad.getBoundingClientRect();
    const controlsRect = controls.getBoundingClientRect();
    const boardRects = boards.map((board) => board.getBoundingClientRect());
    const intersects = (a, b) =>
      Math.min(a.right, b.right) - Math.max(a.left, b.left) > 1 &&
      Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 1;
    const buttons = [...pad.querySelectorAll('button')].map((button) => {
      const rect = button.getBoundingClientRect();
      return { width: rect.width, height: rect.height };
    });

    return {
      missing: false,
      dock: dockRect.toJSON(),
      pad: padRect.toJSON(),
      insideDock:
        padRect.left >= dockRect.left - 1 && padRect.right <= dockRect.right + 1 &&
        padRect.top >= dockRect.top - 1 && padRect.bottom <= dockRect.bottom + 1,
      dockRightOfBoards: boardRects.every((boardRect) => boardRect.right <= dockRect.left - 1),
      overlapsBoard: boardRects.some((boardRect) => intersects(boardRect, dockRect)),
      dockAboveControls: dockRect.bottom <= controlsRect.top + 1,
      desktopDirectionsVisible: desktopDirections.getBoundingClientRect().width > 0,
      buttons,
    };
  });

  if (
    result.missing || !result.insideDock || !result.dockRightOfBoards || result.overlapsBoard ||
    !result.dockAboveControls || result.desktopDirectionsVisible ||
    result.buttons.some((button) => button.width < 44 || button.height < 44)
  ) {
    throw new Error(`온라인 모바일 가로 방향패드 레일 배치 오류: ${JSON.stringify(result)}`);
  }
  ok('온라인 모바일 가로 화면은 상대 보드와 겹치지 않는 오른쪽 십자패드 레일 사용');
}

async function expectOpponentCompletion(page, opponentName, moves, timeout = 25000) {
  try {
    await page.waitForFunction(({ name, expectedMoves }) => {
      const opponentBoards = Array.from(document.querySelectorAll(
        '[data-player-board]:not([data-my-player="true"])'
      ));
      const boardSynced = opponentBoards.some((board) =>
        board.textContent?.includes(`${expectedMoves}턴 완주`)
      );
      const hudEntry = Array.from(document.querySelectorAll('[data-testid="online-hud"] [title]'))
        .find((entry) => entry.getAttribute('title') === `${name} - ${expectedMoves}턴 완주`);
      const leadingRecordSynced = document.body.textContent?.includes(`현재 최고 기록은 ${expectedMoves}턴`)
        || document.body.textContent?.includes(`현재 최고 기록 ${expectedMoves}턴`);
      return boardSynced && !!hudEntry && leadingRecordSynced;
    }, { name: opponentName, expectedMoves: moves }, { timeout });
  } catch (error) {
    const diagnostics = await page.evaluate(() => ({
      url: window.location.href,
      hudText: document.querySelector('[data-testid="online-hud"]')?.textContent || null,
      hudTitles: Array.from(document.querySelectorAll('[data-testid="online-hud"] [title]'))
        .map((entry) => entry.getAttribute('title')),
      boards: Array.from(document.querySelectorAll('[data-player-board]')).map((board) => ({
        runnerId: board.getAttribute('data-player-board'),
        mine: board.getAttribute('data-my-player'),
        position: board.getAttribute('data-player-position'),
        text: board.textContent,
      })),
      statusText: document.querySelector('[data-testid="online-mobile-status"]')?.textContent || null,
    }));
    throw new Error(
      `상대 ${opponentName}의 ${moves}턴 완주 상태 동기화 실패: ${JSON.stringify(diagnostics)}; cause=${error.message}`
    );
  }
  ok(`opponent completion synced: ${opponentName}, ${moves} turns`);
}

async function expectOnlineRankTotal(page, expectedPlayers, timeout = 20000) {
  const rank = page.getByTestId('online-rank');
  await rank.waitFor({ state: 'visible', timeout });
  const label = await rank.getAttribute('aria-label');
  const match = label?.match(/^현재 순위 (\d+)위, 총 (\d+)명$/);
  if (!match || Number(match[2]) !== expectedPlayers || Number(match[1]) < 1 || Number(match[1]) > expectedPlayers) {
    throw new Error(`온라인 순위 계약 오류: expectedPlayers=${expectedPlayers}, aria-label=${JSON.stringify(label)}`);
  }
  ok(`online rank visible: ${match[1]}/${match[2]}`);
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

async function expect3DOnlyGameplay(page, expectedCanvases, label) {
  await page.waitForFunction(
    (count) => document.querySelectorAll('[data-player-board] canvas').length === count,
    expectedCanvases
  );
  const state = {
    twoDimensionalToggle: await page.getByRole('button', { name: '2D 보드', exact: true }).count(),
    threeDimensionalToggle: await page.getByRole('button', { name: '3D 보드', exact: true }).count(),
    twoDimensionalBoards: await page.locator('[data-testid="board-2d-viewport"]').count(),
  };
  if (
    state.twoDimensionalToggle !== 0
    || state.threeDimensionalToggle !== 0
    || state.twoDimensionalBoards !== 0
  ) {
    throw new Error(`${label}에서 2D/3D 전환 UI 또는 2D 게임 보드가 노출됨: ${JSON.stringify(state)}`);
  }
  await expectNonBlankCanvases(page, expectedCanvases);
  ok(`${label}: 플레이 중 3D 전용 렌더링`);
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

async function readBoardVisualState(board) {
  return board.evaluate((element) => {
    const text = element.textContent || '';
    const movesMatch = text.match(/턴:\s*(\d+)/);
    const rawSequence = element.getAttribute('data-visual-sequence');
    return {
      sequence: rawSequence === null ? null : Number(rawSequence),
      action: element.getAttribute('data-visual-action'),
      fx: element.getAttribute('data-visual-fx'),
      position: element.getAttribute('data-player-position'),
      moves: movesMatch ? Number(movesMatch[1]) : null,
    };
  });
}

async function expectBoardVisualState(page, board, expected, label, timeout = 15000) {
  const deadline = Date.now() + timeout;
  let state = null;
  while (Date.now() < deadline) {
    state = await readBoardVisualState(board);
    if (
      state.sequence === expected.sequence
      && state.action === expected.action
      && state.fx === expected.fx
      && state.position === expected.position
      && state.moves === expected.moves
    ) {
      ok(`${label}: ${JSON.stringify(state)}`);
      return state;
    }
    await page.waitForTimeout(100);
  }
  throw new Error(`${label} 상대 보드 시각 상태 불일치: expected=${JSON.stringify(expected)}, actual=${JSON.stringify(state)}`);
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
async function selectRunnerGear(page, runnerGear) {
  const selector = page.getByTestId('runner-gear-selector');
  await selector.waitFor({ state: 'visible', timeout: 10000 });
  const option = selector.locator(`[data-runner-gear-option="${runnerGear}"]`);
  if (await option.count() !== 1) {
    throw new Error(`러너 장비 옵션을 찾지 못함: ${runnerGear}`);
  }
  await option.click();
  const checked = selector.locator('[role="radio"][aria-checked="true"]');
  if (await checked.count() !== 1 || await option.getAttribute('aria-checked') !== 'true') {
    throw new Error(`러너 장비 단일 선택 상태 불일치: ${runnerGear}`);
  }
}

async function setupMap(page, {
  fog = false,
  ownerSecrets = false,
  verifyWormholeSafety = false,
  runnerGear = 'none',
} = {}) {
  await expectText(page, '시작점을 선택하세요');
  const items = page.locator('div.grid').first().locator(':scope > *');
  await items.nth(0).click();
  await expectText(page, '도착점을 선택하세요');
  await page.locator(`[data-cell="0,${ownerSecrets ? 3 : 2}"]`).click();
  await expectText(page, '벽(장애물)을 배치하세요');
  await selectRunnerGear(page, runnerGear);
  if (verifyWormholeSafety) {
    const cornerWall = page.getByRole('button', { name: '6행 5열 right 벽' });
    const topWall = page.getByRole('button', { name: '5행 6열 down 벽' });
    const wormholeButton = page.getByRole('button', { name: /웜홀/ }).first();
    await cornerWall.click();
    await topWall.click();
    await wormholeButton.click();
    await page.locator('[data-cell="3,3"]').click();

    let safetyMessage = '';
    page.once('dialog', async (dialog) => {
      safetyMessage = dialog.message();
      await dialog.accept();
    });
    await page.locator('[data-cell="5,5"]').click();
    if (!safetyMessage.includes('인접 칸이 최소 1개')) {
      throw new Error(`웜홀 출구 안전 검증 메시지 불일치: ${JSON.stringify(safetyMessage)}`);
    }

    await wormholeButton.click(); // 배치 취소
    await topWall.click(); // 위쪽을 열어 출구에 인접한 이동 칸을 하나만 남김

    // 6열을 따라 올라가 1행에서만 도착점 쪽으로 빠져나오는 통로를 만든다.
    // 출구 바로 옆 칸 수가 아니라 출구→도착점 전체 경로를 검사해야 잡히는 사례다.
    const corridorWalls = [2, 3, 4, 5].map((row) =>
      page.getByRole('button', { name: `${row}행 5열 right 벽`, exact: true })
    );
    for (const wall of corridorWalls) await wall.click();

    await wormholeButton.click();
    await page.locator('[data-cell="3,3"]').click();
    const safeExit = page.locator('[data-cell="5,5"][data-valid-item-target="true"]');
    await safeExit.waitFor({ state: 'visible', timeout: 10000 });
    await safeExit.click();
    if (!(await wormholeButton.isDisabled())) {
      throw new Error('웜홀 1개 배치 후 종류별 최대 수량 제한이 적용되지 않음');
    }

    const routeGateWall = page.getByRole('button', { name: '1행 5열 right 벽', exact: true });
    const budgetBeforeBlockedWall = await page.locator('[data-testid="setup-budget"]').innerText();
    let routeSafetyMessage = '';
    page.once('dialog', async (dialog) => {
      routeSafetyMessage = dialog.message();
      await dialog.accept();
    });
    await routeGateWall.click();
    if (routeSafetyMessage !== '이 벽을 놓으면 웜홀 출구에서 도착점까지 갈 수 없습니다.') {
      throw new Error(`웜홀 출구→도착점 경로 검증 메시지 불일치: ${JSON.stringify(routeSafetyMessage)}`);
    }
    if (await page.locator('[data-testid="setup-budget"]').innerText() !== budgetBeforeBlockedWall) {
      throw new Error('웜홀 출구→도착점 경로를 끊는 일반벽이 예산에 반영됨');
    }

    // 출구에 남은 마지막 인접 통로도 일반벽으로는 막을 수 없다.
    const budgetBeforeLastExitWall = await page.locator('[data-testid="setup-budget"]').innerText();
    let lastExitSafetyMessage = '';
    page.once('dialog', async (dialog) => {
      lastExitSafetyMessage = dialog.message();
      await dialog.accept();
    });
    await topWall.click();
    if (lastExitSafetyMessage !== '이 벽을 놓으면 웜홀 출구에서 도착점까지 갈 수 없습니다.') {
      throw new Error(`웜홀 마지막 출구 일반벽 검증 메시지 불일치: ${JSON.stringify(lastExitSafetyMessage)}`);
    }
    if (await page.locator('[data-testid="setup-budget"]').innerText() !== budgetBeforeLastExitWall) {
      throw new Error('웜홀 마지막 출구를 막는 일반벽이 예산에 반영됨');
    }

    // 같은 마지막 출구 위치라도 소멸 특수벽은 영구 경로를 끊지 않으므로 허용한다.
    await page.getByRole('tab', { name: '특수벽' }).click();
    await page.getByRole('button', { name: /안개벽/ }).first().click();
    await topWall.click();
    const placedItems = await page.locator('[aria-label="배치된 아이템"]').innerText();
    if (!placedItems.includes('안개벽')) {
      throw new Error('웜홀 마지막 출구의 같은 위치에 소멸 특수벽을 배치할 수 없음');
    }
    ok('sealed exit rejected; full exit-to-goal route guarded; consumable special wall allowed');
  }
  if (ownerSecrets) {
    await page.getByRole('button', { name: /가짜벽/ }).first().click();
    await page.getByRole('button', { name: '1행 1열 right 벽' }).click();
    await page.getByRole('button', { name: /웜홀/ }).first().click();
    await page.locator('[data-cell="3,3"]').click();
    await page.locator('[data-cell="4,4"]').click();
  }
  if (fog) {
    await page.getByRole('tab', { name: '특수벽' }).click();
    await page.getByRole('button', { name: /안개벽/ }).first().click();
    await page.getByRole('button', { name: '1행 2열 right 벽' }).click();
    const placedItems = await page.locator('[aria-label="배치된 아이템"]').innerText();
    if (!placedItems.includes('안개벽')) throw new Error('안개벽 제작 상태가 표시되지 않음');
  }
  await page.getByRole('button', { name: '완료' }).click();
}

(async () => {
  let browser = null;
  let pageA = null;
  let pageB = null;
  try {
    browser = await chromium.launch({
      channel: process.env.CHROME_PATH ? undefined : 'chrome',
      executablePath: process.env.CHROME_PATH || undefined,
      headless: true,
      args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--use-angle=swiftshader'],
    });
    const ctxA = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const ctxB = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    pageA = await ctxA.newPage();
    pageB = await ctxB.newPage();
    // 보안 규칙 위반(PERMISSION_DENIED)이 있으면 콘솔에 드러나도록 수집
    for (const [tag, p] of [['A', pageA], ['B', pageB]]) {
      p.on('console', (m) => {
        if (m.type() === 'error') {
          console.log(`[${tag} console:error]`, m.text().slice(0, 500));
        }
      });
      p.on('pageerror', (e) => console.log(`[${tag} pageerror]`, String(e).slice(0, 300)));
    }
    pageB.on('dialog', (d) => d.accept()); // 종료 뒤 나가기 확인 다이얼로그 자동 수락

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
    const playerBRunnerGear = 'insight';
    await setupMap(pageB, { fog: true, ownerSecrets: true, runnerGear: playerBRunnerGear });
    await expectText(pageB, '방장이 시작하면 게임이 시작됩니다');
    await pageB.getByRole('button', { name: '맵 다시 만들기' }).click();
    await expectText(pageB, '벽(장애물)을 배치하세요');
    const reopenedBudget = pageB.locator('[data-testid="setup-budget"]');
    await reopenedBudget.waitFor({ state: 'visible', timeout: 10000 });
    const reopenedBudgetText = await reopenedBudget.innerText();
    const reopenedBudgetMatch = reopenedBudgetText.match(/(\d+)\s*\/\s*(\d+)/);
    const reopenedUsedBudget = Number(reopenedBudgetMatch?.[1]);
    const reopenedWallBudget = Number(reopenedBudgetMatch?.[2]);
    if (
      !(reopenedUsedBudget > 0)
      || reopenedWallBudget !== RUNNER_GEAR_WALL_BUDGET[playerBRunnerGear]
    ) {
      throw new Error(`재편집 화면에 저장한 맵 예산이 복원되지 않음: ${reopenedBudgetText}`);
    }
    const resubmitButton = pageB.getByRole('button', { name: '완료', exact: true });
    if (!(await resubmitButton.isEnabled())) {
      throw new Error(`복원한 유효 맵을 바로 재제출할 수 없음: ${reopenedBudgetText}`);
    }
    await resubmitButton.click();
    await expectText(pageB, '방장이 시작하면 게임이 시작됩니다');
    ok('non-owner map reopen restores the saved draft and resubmits it');
    await expectText(pageA, '모두 준비되었습니다');
    await pageA.getByRole('button', { name: '게임 시작' }).click();
    await expectMyBoardTurns(pageA, 0);
    await expectMyBoardTurns(pageB, 0);

    step('6: 3D 전용 + 동시 보드 2개 + 레거시 미니맵 부재');
    const fpCount = await pageA.getByRole('button', { name: '1인칭' }).count();
    if (fpCount > 0) throw new Error('1인칭 버튼이 아직 남아 있음');
    await expectPlayerBoardCount(pageA, 2);
    await expectPlayerBoardCount(pageB, 2);
    await expect3DOnlyGameplay(pageA, 2, '온라인 A 데스크톱 화면');
    await expect3DOnlyGameplay(pageB, 2, '온라인 B 데스크톱 화면');
    await expectNoLegacyMinimap(pageA);
    await expectNoLegacyMinimap(pageB);
    await expectOnlineRankTotal(pageA, 2);
    await expectText(pageA, '내 턴');
    await expectText(pageB, `${ACCOUNTS.a.name} 턴`);
    ok('3D 전용 동시 보드 + 턴 HUD 확인');

    step('6-1: 3D 제작자 시야 권한 + 모바일 상대 보드 동시 표시');
    await pageA.setViewportSize({ width: 360, height: 640 });
    await expectMobileAllBoardsContract(pageA, 2, '온라인 짧은 모바일 화면');
    await expect3DOnlyGameplay(pageA, 2, '온라인 짧은 모바일 화면');
    await pageA.screenshot({ path: `${OUT}/mp-2p-3d-short-portrait.png` });
    await pageA.setViewportSize({ width: 852, height: 393 });
    await expectPlayerBoardCount(pageA, 2);
    await expect3DOnlyGameplay(pageA, 2, '온라인 모바일 가로 화면');
    await expectOnlineLandscapeDpadRail(pageA);
    await pageA.screenshot({ path: `${OUT}/mp-2p-3d-landscape.png` });
    await pageA.setViewportSize({ width: 1280, height: 900 });
    await expectPlayerBoardCount(pageA, 2);
    await expect3DOnlyGameplay(pageA, 2, '온라인 데스크톱 복귀 화면');
    const runnerBoard = pageA.locator('[data-player-board][data-my-player="true"]');
    const ownerBoard = pageB.locator('[data-player-board][data-map-owner-preview="true"]');
    await ownerBoard.waitFor({ timeout: 10000 });
    const visibility = {
      owner: await ownerBoard.getAttribute('data-map-secrets-visible'),
      runner: await runnerBoard.getAttribute('data-map-secrets-visible'),
    };
    if (visibility.owner !== 'true' || visibility.runner !== 'false') {
      throw new Error(`온라인 3D 제작자/주자 비밀 시야 권한 오류: ${JSON.stringify(visibility)}`);
    }
    await pageA.screenshot({ path: `${OUT}/mp-runner-secrets-hidden-3d.png` });
    await pageB.screenshot({ path: `${OUT}/mp-owner-secrets-3d.png` });
    ok('온라인 3D 제작자만 함정 정체 공개, 주자에게는 맵 비밀 비공개');

    step('7: [1게임] 가짜벽 첫 충돌은 차단, 다음 시도는 관통 + A/B 엄격 교대');
    const initialOpponentVisual = await readBoardVisualState(ownerBoard);
    if (
      (initialOpponentVisual.sequence !== null
        && (!Number.isInteger(initialOpponentVisual.sequence) || initialOpponentVisual.sequence < 0))
      || initialOpponentVisual.action !== null
      || initialOpponentVisual.fx !== null
    ) {
      throw new Error(`온라인 상대 보드의 초기 액션 시퀀스가 유효하지 않음: ${JSON.stringify(initialOpponentVisual)}`);
    }
    const initialOpponentSequence = initialOpponentVisual.sequence ?? 0;
    await expectWaitingInputIgnored(pageB, 'ArrowRight', 0);
    await pageA.keyboard.press('ArrowRight');
    await expectMyBoardTurns(pageA, 1);
    await pageA.locator('[data-player-board][data-my-player="true"][data-player-position="0,0"]')
      .waitFor({ timeout: 10000 });
    if (await runnerBoard.getAttribute('data-player-position') !== '0,0') {
      throw new Error(`가짜벽 첫 충돌이 주자를 통과시킴: ${await runnerBoard.getAttribute('data-player-position')}`);
    }
    const bumpOpponentVisual = await expectBoardVisualState(pageB, ownerBoard, {
      sequence: initialOpponentSequence + 1,
      action: 'bump',
      fx: 'bump',
      position: '0,0',
      moves: 1,
    }, '상대 화면의 가짜벽 충돌 실시간 반영');
    await expectText(pageB, '내 턴');
    await expectWaitingInputIgnored(pageA, 'ArrowRight', 1);
    await pageB.keyboard.press('ArrowDown');
    await expectMyBoardTurns(pageB, 1);
    await pageB.waitForTimeout(700);
    await expectBoardVisualState(pageB, ownerBoard, {
      sequence: bumpOpponentVisual.sequence,
      action: 'bump',
      fx: 'bump',
      position: '0,0',
      moves: 1,
    }, '다른 플레이어 턴에서 이전 상대 효과 재생 방지');
    await expectText(pageA, '내 턴');
    await pageA.keyboard.press('ArrowRight');
    await expectMyBoardTurns(pageA, 2);
    await pageA.locator('[data-player-board][data-my-player="true"][data-player-position="0,1"]')
      .waitFor({ timeout: 10000 });
    await expectBoardVisualState(pageB, ownerBoard, {
      sequence: bumpOpponentVisual.sequence + 1,
      action: 'move',
      fx: null,
      position: '0,1',
      moves: 2,
    }, '상대 화면의 가짜벽 관통 이동 실시간 반영');
    ok('가짜벽 첫 충돌 뒤 동일 방향 두 번째 시도에서 관통');
    await expectText(pageB, '내 턴');
    await pageB.keyboard.press('ArrowUp');
    await expectMyBoardTurns(pageB, 2);
    await expectText(pageA, '내 턴');

    step('8: A 세 번째 행동에서 안개벽 관통 -> B 행동 뒤 A의 다음 행동 시야 차단');
    await pageA.keyboard.press('ArrowRight');
    await expectMyBoardTurns(pageA, 3);
    await pageA.locator('[data-player-board][data-my-player="true"][data-player-position="0,2"]')
      .waitFor({ timeout: 10000 });
    await expectText(pageB, '내 턴');
    await pageB.keyboard.press('ArrowDown');
    await expectMyBoardTurns(pageB, 3);
    await expectText(pageA, '내 턴');
    await pageA.locator('[data-my-player="true"][data-vision-effect="smoke"][data-vision-obscured="true"]')
      .waitFor({ timeout: 10000 });
    await pageA.locator('[data-testid=board-obscure-overlay]').waitFor({ timeout: 10000 });
    if (await pageA.getByRole('button', { name: '오른쪽으로 이동' }).first().isDisabled()) {
      throw new Error('온라인 안개 상태에서 대상의 방향 조작이 비활성화됨');
    }
    if (await pageB.locator('[data-vision-obscured="true"]').count() > 0) {
      throw new Error('안개벽을 설치한 상대 화면까지 완전히 가려짐');
    }
    if (await pageB.locator('[data-vision-effect="smoke"]').count() !== 1) {
      throw new Error('상대 화면에 안개 피격 상태가 표시되지 않음');
    }
    ok('Firebase 안개 상태 동기화 + 피격자 자신의 다음 차례만 시야 차단');

    step('9: A가 네 번째 행동으로 선완주 -> B로 턴 이동');
    await pageA.keyboard.press('ArrowRight');
    await expectText(pageA, '턴으로 완주했습니다');
    await expectMyBoardTurns(pageA, 4);
    if (await pageA.locator('[data-vision-obscured="true"]').count() > 0) {
      throw new Error('온라인 유효 행동 후 안개가 해제되지 않음');
    }
    await expectText(pageB, '내 턴');
    ok('A 4턴 완주 후 완주자를 건너뛰고 B 턴 유지');

    step('10: A = 관전 모드(승부 미확정), B = 기권 없이 목표까지 진행');
    await expectText(pageA, '관전 중');
    await expect3DOnlyGameplay(pageA, 2, '온라인 완주자 관전 화면');
    await pageA.waitForTimeout(1000);
    await pageA.screenshot({ path: `${OUT}/mp-01-A-spectate.png` });
    await expectOpponentCompletion(pageB, ACCOUNTS.a.name, 4);
    await expectOnlineRankTotal(pageB, 2);
    if (await pageB.getByRole('button', { name: /포기|기권/ }).count() > 0) {
      throw new Error('진행 중인 플레이어에게 포기/기권 버튼이 노출됨');
    }
    const finishOnlyButton = pageB.getByRole('button', { name: '🏁 끝까지 진행' }).first();
    await finishOnlyButton.waitFor({ timeout: 15000 });
    if (!(await finishOnlyButton.isDisabled())) {
      throw new Error('진행 중 나가기 차단 버튼이 활성화되어 있음');
    }
    await pageB.screenshot({ path: `${OUT}/mp-02-B-must-finish.png` });

    step('11: B 네 번째 이동 -> A 완주자를 건너뛰어 B가 계속 현재 턴');
    await pageB.keyboard.press('ArrowUp');
    await expectMyBoardTurns(pageB, 4);
    await expectText(pageB, '내 턴');
    await expectOpponentCompletion(pageB, ACCOUNTS.a.name, 4);
    if (!(await finishOnlyButton.isDisabled())) {
      throw new Error('상대 최고 기록을 넘긴 뒤에도 미완주자의 나가기가 차단되지 않음');
    }
    await pageA.waitForTimeout(800);
    await pageA.screenshot({ path: `${OUT}/mp-03-A-watching-B-move.png` });

    step('12: B가 남은 경로를 끝까지 완주 -> 4턴 A 승리 / 6턴 B 패배');
    await pageB.keyboard.press('ArrowRight');
    await expectMyBoardTurns(pageB, 5);
    await expectText(pageB, '내 턴');
    await pageB.keyboard.press('ArrowRight');
    await expectMyBoardTurns(pageB, 6);
    await expectText(pageA, '승리했습니다');
    await expectText(pageB, '패배했습니다');
    await pageA.screenshot({ path: `${OUT}/mp-04-A-win.png` });
    await pageB.screenshot({ path: `${OUT}/mp-05-B-finished-lose.png` });

    step('13: 재시작 -> 양쪽 모두 맵 제작으로 복귀');
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
    await expectOpponentCompletion(pageB, ACCOUNTS.a.name, 2);
    await pageB.keyboard.press('ArrowRight');
    await expectText(pageA, '무승부입니다!');
    await expectText(pageB, '무승부입니다!');
    await pageA.screenshot({ path: `${OUT}/mp-07-draw.png` });

    step('16: A(방장) 나가기 -> 방 삭제(방장 권한) -> B 자동 리디렉션');
    await pageA.getByRole('button', { name: '나가기' }).first().click();
    await pageA.waitForURL(/\/rooms$/, { timeout: 20000 });
    await pageB.waitForURL(/\/rooms$/, { timeout: 25000 });

    step('16-1: [재시작 회귀] 진행 중 퇴장 차단 + 실제 완주 뒤 다음 경기 roster 유지');
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

    const blockedLeave = pageB.getByRole('button', { name: '🏁 끝까지 진행' }).first();
    await blockedLeave.waitFor({ timeout: 10000 });
    if (!(await blockedLeave.isDisabled())) {
      throw new Error('PLAY 중 참가자 나가기가 차단되지 않음');
    }
    await pageA.keyboard.press('ArrowRight');
    await expectMyBoardTurns(pageA, 1);
    await expectText(pageB, '내 턴');
    await pageB.keyboard.press('ArrowRight');
    await expectMyBoardTurns(pageB, 1);
    await expectText(pageA, '내 턴');
    await pageA.keyboard.press('ArrowRight');
    await expectText(pageB, '내 턴');
    await pageB.keyboard.press('ArrowRight');
    await expectText(pageA, '무승부입니다');

    await pageA.getByRole('button', { name: '재시작' }).click();
    await expectText(pageA, '시작점을 선택하세요');
    await expectText(pageB, '시작점을 선택하세요');
    await setupMap(pageA);
    await expectText(pageA, '참가자 (2/2)');
    ok('PLAY leave blocked and completed-player roster preserved on restart');

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
    await expect3DOnlyGameplay(pageA, 3, '온라인 3인 데스크톱 화면');
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

    step('20: A 2턴 완주 -> B/C가 기권 없이 계속 교대');
    await pageA.keyboard.press('ArrowRight');
    await expectText(pageA, '턴으로 완주했습니다');
    await expectMyBoardTurns(pageA, 2);
    await expectText(pageB, '내 턴');
    await pageB.keyboard.press('ArrowUp');
    await expectMyBoardTurns(pageB, 2);
    await expectText(pageC, '내 턴');
    await expectOpponentCompletion(pageC, ACCOUNTS.a.name, 2);
    if (await pageC.getByRole('button', { name: /포기|기권/ }).count() > 0) {
      throw new Error('3인전 현재 주자에게 포기/기권 버튼이 노출됨');
    }
    await pageC.keyboard.press('ArrowUp');
    await expectMyBoardTurns(pageC, 2);
    await expectText(pageB, '내 턴');
    ok('A 완주자를 건너뛰고 B/C 미완주자 교대 유지');

    step('21: B/C도 각각 4턴 완주 -> 최소 2턴 A 승리');
    await pageB.keyboard.press('ArrowRight');
    await expectMyBoardTurns(pageB, 3);
    await expectText(pageC, '내 턴');
    await pageC.keyboard.press('ArrowRight');
    await expectMyBoardTurns(pageC, 3);
    await expectText(pageB, '내 턴');
    await pageB.keyboard.press('ArrowRight');
    await expectText(pageB, '턴으로 완주했습니다');
    await expectText(pageC, '내 턴');
    await pageC.keyboard.press('ArrowRight');
    await expectMyBoardTurns(pageC, 4);
    await expectText(pageA, '승리했습니다');
    await expectText(pageB, '패배했습니다');
    await expectText(pageC, '패배했습니다');
    await pageA.screenshot({ path: `${OUT}/mp-3p-result-A.png` });
    ok('3인 전원 완주 정산 정상 (완주자 skip + 최소 턴 우승)');

    step('22: A(방장) 나가기 -> 방 삭제 -> B, C 자동 리디렉션');
    await pageA.getByRole('button', { name: '나가기' }).first().click();
    await pageA.waitForURL(/\/rooms$/, { timeout: 20000 });
    await pageB.waitForURL(/\/rooms$/, { timeout: 25000 });
    await pageC.waitForURL(/\/rooms$/, { timeout: 25000 });
    const rankingPanel = pageA.locator('[data-testid="maze-ranking"]');
    await rankingPanel.waitFor({ state: 'visible', timeout: 20000 });
    await pageA.waitForFunction(() => (
      document.querySelector('[data-testid="maze-ranking"]')?.textContent?.includes('RP')
    ), null, { timeout: 20000 });
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
    await expect3DOnlyGameplay(pageA, 4, '온라인 4인 데스크톱 화면');
    await pageA.screenshot({ path: `${OUT}/mp-4p-desktop.png` });
    await pageA.setViewportSize({ width: 360, height: 800 });
    await expectMobileAllBoardsContract(pageA, 4, 'Galaxy S21 4인 화면');
    await expect3DOnlyGameplay(pageA, 4, 'Galaxy S21 4인 동시 화면');
    const mobileLayout = await pageA.evaluate(() => {
      const viewport = { width: window.innerWidth, height: window.innerHeight };
      const selectors = [
        '[data-testid="online-hud"]',
        '[data-testid="online-board-stage"]',
        '[data-testid="online-controls"]',
        '[data-testid="online-mobile-direction-dock"]',
        '[data-testid="online-mobile-direction-pad"]',
        '[data-testid="online-pad-toggle"]',
      ];
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
      const controlSizes = Array.from(document.querySelectorAll(
        '[data-testid="online-controls"] button, [data-testid="online-mobile-direction-pad"] button'
      )).map((button) => {
        const rect = button.getBoundingClientRect();
        return { width: rect.width, height: rect.height };
      }).filter((size) => size.width > 0 && size.height > 0);
      const pad = document.querySelector('[data-testid="online-mobile-direction-pad"]');
      const dock = document.querySelector('[data-testid="online-mobile-direction-dock"]');
      const stage = document.querySelector('[data-testid="online-board-stage"]');
      const boardSurface = document.querySelector('[data-mounted-board-count]');
      const boards = Array.from(document.querySelectorAll('[data-player-board]'));
      const boardRects = boards.map((board) => board.getBoundingClientRect());
      const dpad = pad && dock && stage && boardSurface && boardRects.length > 0 ? (() => {
        const padRect = pad.getBoundingClientRect();
        const dockRect = dock.getBoundingClientRect();
        const boardSurfaceRect = boardSurface.getBoundingClientRect();
        const buttons = Object.fromEntries(Array.from(pad.querySelectorAll('button')).map((button) => [
          button.getAttribute('aria-label'),
          button.getBoundingClientRect().toJSON(),
        ]));
        return {
          insideDock:
            padRect.left >= dockRect.left - 1 && padRect.right <= dockRect.right + 1 &&
            padRect.top >= dockRect.top - 1 && padRect.bottom <= dockRect.bottom + 1,
          dockBelowBoardStage: dockRect.top >= boardSurfaceRect.bottom - 1,
          belowAllBoards: boardRects.every((boardRect) => padRect.top >= boardRect.bottom - 1),
          overlapsAnyBoard: boardRects.some((boardRect) =>
            Math.min(padRect.right, boardRect.right) - Math.max(padRect.left, boardRect.left) > 1
            && Math.min(padRect.bottom, boardRect.bottom) - Math.max(padRect.top, boardRect.top) > 1
          ),
          buttons,
        };
      })() : null;
      const playerEntries = Array.from(document.querySelectorAll('[data-testid="room-player-strip"] [title]'))
        .map((entry) => {
          const rect = entry.getBoundingClientRect();
          return {
            title: entry.getAttribute('title'),
            inside: rect.width === 0 || (rect.left >= -1 && rect.right <= viewport.width + 1),
          };
        });
      const roomHeader = document.querySelector('[data-testid="room-game-header"]')?.getBoundingClientRect();
      const onlineHud = document.querySelector('[data-testid="online-hud"]')?.getBoundingClientRect();
      const headerHudSeparated = !!roomHeader && !!onlineHud && roomHeader.bottom <= onlineHud.top + 1;
      const rank = document.querySelector('[data-testid="online-rank"]')?.getBoundingClientRect();
      const mobileStatus = document.querySelector('[data-testid="online-mobile-status"]')?.getBoundingClientRect();
      const inside = (inner, outer) => !!inner && !!outer
        && inner.width > 0 && inner.height > 0
        && inner.left >= outer.left - 1 && inner.right <= outer.right + 1
        && inner.top >= outer.top - 1 && inner.bottom <= outer.bottom + 1;
      const boardBand = boardRects.length > 0 ? {
        count: boardRects.length,
        minimumWidth: Math.min(...boardRects.map((rect) => rect.width)),
        minimumHeight: Math.min(...boardRects.map((rect) => rect.height)),
        belowHud: !!onlineHud && boardRects.every((rect) => rect.top >= onlineHud.bottom - 1),
        aboveDock: !!dock && boardRects.every((rect) => rect.bottom <= dock.getBoundingClientRect().top + 1),
      } : null;
      const statusOverlapsBoard = !!mobileStatus && boardRects.some((boardRect) =>
        Math.min(mobileStatus.right, boardRect.right) - Math.max(mobileStatus.left, boardRect.left) > 1
        && Math.min(mobileStatus.bottom, boardRect.bottom) - Math.max(mobileStatus.top, boardRect.top) > 1
      );
      return {
        viewport,
        containers,
        controlSizes,
        dpad,
        playerEntries,
        headerHudSeparated,
        mobileTabs: document.querySelectorAll('[data-testid="mobile-board-tabs"]').length,
        boardBand,
        rank: { present: !!rank, insideHud: inside(rank, onlineHud) },
        mobileStatus: {
          present: !!mobileStatus,
          insideHud: !mobileStatus || inside(mobileStatus, onlineHud),
          overlapsBoard: statusOverlapsBoard,
        },
      };
    });
    if (mobileLayout.containers.some((entry) => entry.missing || !entry.inside)) {
      throw new Error(`Galaxy S21 HUD/controls overflow: ${JSON.stringify(mobileLayout.containers)}`);
    }
    if (mobileLayout.controlSizes.some((size) => size.width < 44 || size.height < 44)) {
      throw new Error(`Galaxy S21 control target below 44px: ${JSON.stringify(mobileLayout.controlSizes)}`);
    }
    if (mobileLayout.playerEntries.some((entry) => !entry.inside)) {
      throw new Error(`Galaxy S21 player strip overflow: ${JSON.stringify(mobileLayout.playerEntries)}`);
    }
    if (!mobileLayout.headerHudSeparated) {
      throw new Error('Galaxy S21 room header overlaps the online turn HUD');
    }
    if (
      mobileLayout.mobileTabs !== 0
      || mobileLayout.boardBand?.count !== 4
      || mobileLayout.boardBand.minimumWidth < 140
      || mobileLayout.boardBand.minimumHeight < 60
      || !mobileLayout.boardBand.belowHud
      || !mobileLayout.boardBand.aboveDock
    ) {
      throw new Error(`Galaxy S21 동시 보드 배치 오류: ${JSON.stringify({
        mobileTabs: mobileLayout.mobileTabs,
        boardBand: mobileLayout.boardBand,
      })}`);
    }
    if (!mobileLayout.rank.present || !mobileLayout.rank.insideHud) {
      throw new Error(`Galaxy S21 순위 표시가 HUD 안에 없음: ${JSON.stringify(mobileLayout.rank)}`);
    }
    if (!mobileLayout.mobileStatus.insideHud || mobileLayout.mobileStatus.overlapsBoard) {
      throw new Error(`Galaxy S21 상태 표시가 HUD/보드를 침범함: ${JSON.stringify(mobileLayout.mobileStatus)}`);
    }
    const dpadButtons = mobileLayout.dpad?.buttons || {};
    if (
      !mobileLayout.dpad?.insideDock ||
      !mobileLayout.dpad?.dockBelowBoardStage ||
      !mobileLayout.dpad?.belowAllBoards ||
      mobileLayout.dpad?.overlapsAnyBoard ||
      !(dpadButtons['위로 이동']?.y < dpadButtons['왼쪽으로 이동']?.y) ||
      !(dpadButtons['아래로 이동']?.y > dpadButtons['오른쪽으로 이동']?.y) ||
      !(dpadButtons['왼쪽으로 이동']?.x < dpadButtons['오른쪽으로 이동']?.x)
    ) {
      throw new Error(`Galaxy S21 below-board D-pad layout invalid: ${JSON.stringify(mobileLayout.dpad)}`);
    }
    await pageA.screenshot({ path: `${OUT}/mp-4p-galaxy-s21.png` });
    ok('4인 데스크톱 2x2 + Galaxy S21 4보드 동시 표시/순위/하단 방향패드 렌더링');

    await pageA.setViewportSize({ width: 852, height: 393 });
    await expectMobileAllBoardsContract(pageA, 4, '모바일 가로 4인 화면');
    await expect3DOnlyGameplay(pageA, 4, '모바일 가로 4인 동시 화면');
    await expectOnlineLandscapeDpadRail(pageA);
    await pageA.screenshot({ path: `${OUT}/mp-4p-landscape.png` });
    await pageA.setViewportSize({ width: 360, height: 800 });
    await expectMobileAllBoardsContract(pageA, 4, 'Galaxy S21 복귀 화면');
    ok('모바일 가로에서도 4개 3D 보드와 오른쪽 방향패드 동시 표시');

    step('23-1: 하단 방향패드 토글 (숨기면 스와이프 전용)');
    await pageA.getByTestId('online-pad-toggle').click();
    if (await pageA.getByTestId('online-mobile-direction-pad').count() !== 0) {
      throw new Error('패드 숨기기가 동작하지 않음');
    }
    await pageA.getByTestId('online-pad-toggle').click();
    await pageA.getByTestId('online-mobile-direction-pad').waitFor({ state: 'visible', timeout: 5000 });
    ok('패드 토글 (숨김/표시 + localStorage 유지)');

    step('23-2: 스와이프(밀기)로 이동 - 현재 턴인 플레이어 화면에서');
    const allPages = [pageA, pageB, pageC, pageD];
    let turnPage = null;
    for (const pg of allPages) {
      if (await pg.locator('[data-testid="online-hud"]').getByText('내 턴', { exact: true }).count()) {
        turnPage = pg;
        break;
      }
    }
    if (!turnPage) throw new Error('현재 턴인 플레이어 페이지를 찾지 못함');
    const beforeTurns = await getMyBoardTurns(turnPage);
    const ownBoardBox = await turnPage.locator('[data-player-board][data-my-player="true"]').boundingBox();
    if (!ownBoardBox) throw new Error('스와이프 대상 내 보드의 경계를 찾지 못함');
    const swipeStartX = ownBoardBox.x + ownBoardBox.width * 0.35;
    const swipeY = ownBoardBox.y + ownBoardBox.height * 0.5;
    let swiped = false;
    for (let attempt = 0; attempt < 3 && !swiped; attempt += 1) {
      await turnPage.mouse.move(swipeStartX, swipeY);
      await turnPage.mouse.down();
      await turnPage.mouse.move(swipeStartX + 90, swipeY, { steps: 2 });
      await turnPage.mouse.up();
      swiped = await turnPage
        .locator('[data-player-board][data-my-player="true"]')
        .getByText(new RegExp(`(?:턴|이동):\\s*${beforeTurns + 1}(?:\\D|$)`))
        .first()
        .waitFor({ state: 'visible', timeout: 6000 })
        .then(() => true)
        .catch(() => false);
    }
    if (!swiped) throw new Error('스와이프 이동이 3회 시도에도 반영되지 않음');
    await expectMyBoardTurns(turnPage, beforeTurns + 1);
    ok('스와이프 이동 동작 (보드 밀기 -> 1턴 소모)');

    step('24: 4인 모두 실제 완주한 뒤 방 삭제');
    await expectText(pageB, '내 턴');
    await pageB.keyboard.press('ArrowRight');
    await expectMyBoardTurns(pageB, 1);
    await pageC.keyboard.press('ArrowRight');
    await expectMyBoardTurns(pageC, 1);
    await pageD.keyboard.press('ArrowRight');
    await expectMyBoardTurns(pageD, 1);
    await pageA.keyboard.press('ArrowRight');
    await expectText(pageB, '내 턴');
    await pageB.keyboard.press('ArrowRight');
    await expectText(pageC, '내 턴');
    await pageC.keyboard.press('ArrowRight');
    await expectText(pageD, '내 턴');
    await pageD.keyboard.press('ArrowRight');
    await expectText(pageA, '무승부입니다');
    pageA.once('dialog', (dialog) => dialog.accept());
    await pageA.getByRole('button', { name: '나가기' }).first().click();
    await pageA.waitForURL(/\/rooms$/, { timeout: 20000 });

    console.log('ALL MP STEPS PASSED');
  } catch (e) {
    console.error('FAILED:', e.message);
    await pageA?.screenshot({ path: `${OUT}/mp-fail-A.png` }).catch(() => {});
    await pageB?.screenshot({ path: `${OUT}/mp-fail-B.png` }).catch(() => {});
    process.exitCode = 1;
  } finally {
    await browser?.close().catch(() => {});
    console.log('--- 에뮬레이터 모드: 데이터는 에뮬레이터 종료 시 소멸 ---');
  }
})();
