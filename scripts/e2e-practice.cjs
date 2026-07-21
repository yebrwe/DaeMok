/**
 * 로컬 AI 연습 대전 E2E.
 * 실행: npm run dev 후 node scripts/e2e-practice.cjs
 */
const { chromium } = require('playwright');
const { PNG } = require('playwright-core/lib/utilsBundle');
const fs = require('fs');
const path = require('path');

const BASE_URL = process.env.BASE_URL || 'http://127.0.0.1:3000';
const OUT = path.join(__dirname, '..', 'e2e-artifacts');
const EXPECTED_MAZE_TOON_VERSION = 'inked-toy-v3';
const EXPECTED_MAZE_ASSET_VERSION = 'blender-cartoon-v1';
const EXPECTED_MAZE_ASSET_CATALOG_COUNT = 29;
const EXPECTED_MAIN_ASSET_COUNT = 25;
const EXPECTED_WORMHOLE_ASSET_COUNT = 7;
fs.mkdirSync(OUT, { recursive: true });

function ok(message) {
  console.log(`  OK: ${message}`);
}

const FULL_BUDGET_WALLS = [
  [0, 1, 'right'], [0, 2, 'down'], [0, 3, 'down'], [0, 4, 'down'],
  [1, 1, 'right'], [2, 1, 'right'], [3, 1, 'right'], [4, 1, 'right'],
  [2, 2, 'down'], [2, 3, 'down'], [2, 4, 'down'], [1, 5, 'down'],
  [1, 4, 'down'], [1, 3, 'down'], [3, 0, 'down'], [4, 1, 'down'],
  [3, 0, 'right'], [3, 2, 'right'], [3, 3, 'right'], [3, 4, 'right'],
  [4, 2, 'right'], [4, 3, 'right'],
];

async function addFullBudgetWalls(page) {
  for (const [row, col, direction] of FULL_BUDGET_WALLS) {
    await page.getByRole('button', {
      name: `${row + 1}행 ${col + 1}열 ${direction} 벽`,
      exact: true,
    }).click();
  }
  const budget = page.locator('[data-testid=setup-budget]');
  if ((await budget.getAttribute('data-budget-complete')) !== 'true') {
    throw new Error(`연습 맵 전체 예산 배치 실패: ${await budget.innerText()}`);
  }
  if (!(await page.getByRole('button', { name: '완료', exact: true }).isEnabled())) {
    throw new Error('24/24 유효 맵인데 완료 버튼이 활성화되지 않음');
  }
}

async function expectCrossDpad(page, testId, boardSelector) {
  const result = await page.evaluate(({ testId: id, boardSelector: selector }) => {
    const pad = document.querySelector(`[data-testid="${id}"]`);
    const targetBoard = document.querySelector(selector);
    const boards = [...document.querySelectorAll('[data-player-board]')];
    const dock = document.querySelector('[data-testid="practice-mobile-direction-dock"]');
    if (!pad || !targetBoard || boards.length === 0 || !dock) return { missing: true };
    const padRect = pad.getBoundingClientRect();
    const boardRects = boards.map((board) => board.getBoundingClientRect());
    const dockRect = dock.getBoundingClientRect();
    const buttons = Object.fromEntries(
      [...pad.querySelectorAll('button')].map((button) => [
        button.getAttribute('aria-label'),
        button.getBoundingClientRect().toJSON(),
      ])
    );
    return {
      missing: false,
      insideDock:
        padRect.left >= dockRect.left - 1 && padRect.right <= dockRect.right + 1 &&
        padRect.top >= dockRect.top - 1 && padRect.bottom <= dockRect.bottom + 1,
      belowBoards: boardRects.every((boardRect) => padRect.top >= boardRect.bottom - 1),
      overlapsBoard: boardRects.some((boardRect) =>
        Math.min(padRect.right, boardRect.right) - Math.max(padRect.left, boardRect.left) > 1 &&
        Math.min(padRect.bottom, boardRect.bottom) - Math.max(padRect.top, boardRect.top) > 1
      ),
      boardCount: boardRects.length,
      buttons,
    };
  }, { testId, boardSelector });
  if (result.missing || !result.insideDock || !result.belowBoards || result.overlapsBoard) {
    throw new Error(`십자 방향키가 전체 보드 아래 전용 영역에 있지 않음: ${JSON.stringify(result)}`);
  }
  const up = result.buttons['위로 이동'];
  const down = result.buttons['아래로 이동'];
  const left = result.buttons['왼쪽으로 이동'];
  const right = result.buttons['오른쪽으로 이동'];
  const all = [up, down, left, right];
  if (
    all.some((button) => !button || button.width < 44 || button.height < 44) ||
    !(up.y < left.y && up.y < right.y && down.y > left.y && down.y > right.y && left.x < right.x)
  ) {
    throw new Error(`십자 방향키 배열/터치 크기 오류: ${JSON.stringify(result.buttons)}`);
  }
  ok(`${testId} 전체 ${result.boardCount}보드 비겹침 · 십자 배열 · 44px 터치 영역`);
}

async function expectLandscapeDpadRail(page) {
  const result = await page.evaluate(() => {
    const dock = document.querySelector('[data-testid="practice-mobile-direction-dock"]');
    const pad = document.querySelector('[data-testid="practice-mobile-direction-pad"]');
    const controls = document.querySelector('[data-testid="practice-controls"]');
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
      viewport: { width: innerWidth, height: innerHeight },
      dock: dockRect.toJSON(),
      pad: padRect.toJSON(),
      controls: controlsRect.toJSON(),
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
    throw new Error(`모바일 가로 방향패드 레일 배치 오류: ${JSON.stringify(result)}`);
  }
  ok('모바일 가로 화면은 보드 오른쪽 전용 십자패드 레일 사용');
}

async function waitForMapSetupHistoryState(page, expected) {
  await page.waitForFunction((state) => {
    const buttons = [...document.querySelectorAll('button')];
    const buttonByName = (name) => buttons.find((button) => button.textContent?.trim() === name);
    const undo = buttons.find((button) => button.getAttribute('aria-label') === '실행 취소');
    const redo = buttons.find((button) => button.getAttribute('aria-label') === '다시 실행');
    const next = buttonByName('다음');
    const previous = buttonByName('이전');
    const startCell = document.querySelector('[data-cell="0,0"]');
    const hasStartMarker = [...(startCell?.querySelectorAll('span') || [])]
      .some((marker) => marker.textContent?.trim() === 'S');
    const hasPrompt = [...document.querySelectorAll('div')]
      .some((element) => element.textContent?.trim() === state.prompt);

    return hasPrompt &&
      !!undo && undo.disabled === state.undoDisabled &&
      !!redo && redo.disabled === state.redoDisabled &&
      !!next && next.disabled === state.nextDisabled &&
      !!previous === state.previousVisible &&
      hasStartMarker === state.hasStartMarker;
  }, expected, { timeout: 5000 });
}

async function expectStartSelectionUndoRedo(page) {
  const undo = page.getByRole('button', { name: '실행 취소', exact: true });
  const redo = page.getByRole('button', { name: '다시 실행', exact: true });
  const initialState = {
    prompt: '시작점을 선택하세요 - 상대방은 여기서 출발합니다',
    undoDisabled: true,
    redoDisabled: true,
    nextDisabled: true,
    previousVisible: false,
    hasStartMarker: false,
  };
  const selectedState = {
    prompt: '도착점을 선택하세요 - 상대방이 도달해야 하는 곳입니다',
    undoDisabled: false,
    redoDisabled: true,
    nextDisabled: true,
    previousVisible: true,
    hasStartMarker: true,
  };
  const undoneState = {
    ...initialState,
    redoDisabled: false,
  };

  await page.mouse.move(0, 0);
  await waitForMapSetupHistoryState(page, initialState);
  await page.locator('[data-cell="0,0"]').click();
  await page.mouse.move(0, 0);
  await waitForMapSetupHistoryState(page, selectedState);

  await undo.click();
  await page.mouse.move(0, 0);
  await waitForMapSetupHistoryState(page, undoneState);

  await redo.click();
  await page.mouse.move(0, 0);
  await waitForMapSetupHistoryState(page, selectedState);
  ok('시작점 선택 → undo → redo 단계/버튼/마커 복구');
}

async function expectNearestWallPointerRouting(page) {
  const board = page.locator('[data-maze-board-grid]');
  if ((await board.getAttribute('data-wall-pointer-routing')) !== 'nearest') {
    throw new Error('설정 보드가 가장 가까운 벽선 클릭 판정을 사용하지 않음');
  }
  if ((await board.getAttribute('data-wall-corner-routing')) !== 'four-way') {
    throw new Error('설정 보드가 무사각 4방향 모서리 판정을 사용하지 않음');
  }

  const cell = await page.locator('[data-cell="2,2"]').boundingBox();
  if (!cell) throw new Error('벽 클릭 판정 기준 셀을 찾지 못함');

  const cases = [
    {
      label: '위쪽 벽 우선',
      point: { x: cell.x + cell.width - 8, y: cell.y + 2 },
      expected: '1,2:down',
      farther: '2,2:right',
    },
    {
      label: '오른쪽 벽 우선',
      point: { x: cell.x + cell.width - 2, y: cell.y + cell.height - 8 },
      expected: '2,2:right',
      farther: '2,2:down',
    },
  ];

  const usedBudget = async () => {
    const text = await page.locator('[data-testid=setup-budget]').innerText();
    const match = text.match(/(\d+)\/24/);
    if (!match) throw new Error(`벽 예산을 읽지 못함: ${text}`);
    return Number(match[1]);
  };

  for (const testCase of cases) {
    const before = await usedBudget();
    await page.mouse.click(testCase.point.x, testCase.point.y);
    await page.waitForFunction(
      (segment) => document.querySelector(`[data-wall-segment="${segment}"]`)
        ?.getAttribute('data-wall-occupied') === 'true',
      testCase.expected
    );

    const expected = page.locator(`[data-wall-segment="${testCase.expected}"]`);
    const farther = page.locator(`[data-wall-segment="${testCase.farther}"]`);
    if (
      (await expected.getAttribute('data-wall-occupied')) !== 'true' ||
      (await farther.getAttribute('data-wall-occupied')) !== 'false' ||
      await usedBudget() !== before + 1
    ) {
      throw new Error(`${testCase.label} 좌표가 더 먼 직교 벽에 잘못 배치됨`);
    }

    await page.getByRole('button', { name: '실행 취소', exact: true }).click();
    await page.waitForFunction(
      (segment) => document.querySelector(`[data-wall-segment="${segment}"]`)
        ?.getAttribute('data-wall-occupied') === 'false',
      testCase.expected
    );
    if (await usedBudget() !== before) {
      throw new Error(`${testCase.label} 회귀 검사 뒤 벽 예산이 복구되지 않음`);
    }
  }

  const intersection = await page.locator('[data-wall-intersection="5,5"]').boundingBox();
  if (!intersection) throw new Error('4방향 모서리 판정 기준 교차점을 찾지 못함');
  const center = {
    x: intersection.x + intersection.width / 2,
    y: intersection.y + intersection.height / 2,
  };
  const inset = Math.max(1, Math.min(2, intersection.width / 4));
  const cornerCases = [
    {
      label: '모서리 위 영역',
      point: { x: center.x, y: intersection.y + inset },
      expected: '2,2:right',
    },
    {
      label: '모서리 오른쪽 영역',
      point: { x: intersection.x + intersection.width - inset, y: center.y },
      expected: '2,3:down',
    },
    {
      label: '모서리 아래 영역',
      point: { x: center.x, y: intersection.y + intersection.height - inset },
      expected: '3,2:right',
    },
    {
      label: '모서리 왼쪽 영역',
      point: { x: intersection.x + inset, y: center.y },
      expected: '2,2:down',
    },
    {
      label: '모서리 정확한 중심',
      point: center,
      expected: '2,2:right',
    },
  ];

  for (const testCase of cornerCases) {
    await page.mouse.move(0, 0);
    const beforeBudget = await usedBudget();
    const beforeOccupied = await page.locator('[data-wall-segment][data-wall-occupied=true]').count();
    await page.mouse.move(testCase.point.x, testCase.point.y);
    await page.mouse.down();
    await page.locator(
      `[data-wall-segment="${testCase.expected}"][data-wall-pointer-target=true]`
    ).waitFor();
    if (await usedBudget() !== beforeBudget) {
      throw new Error(`${testCase.label} pointerdown만으로 벽 예산이 바뀜`);
    }
    await page.mouse.up();
    await page.waitForFunction(
      (segment) => document.querySelector(`[data-wall-segment="${segment}"]`)
        ?.getAttribute('data-wall-occupied') === 'true',
      testCase.expected
    );
    const afterOccupied = await page.locator('[data-wall-segment][data-wall-occupied=true]').count();
    if (await usedBudget() !== beforeBudget + 1 || afterOccupied !== beforeOccupied + 1) {
      throw new Error(`${testCase.label}에서 벽이 정확히 1회 설치되지 않음`);
    }
    await page.getByRole('button', { name: '실행 취소', exact: true }).click();
    await page.waitForFunction(
      (segment) => document.querySelector(`[data-wall-segment="${segment}"]`)
        ?.getAttribute('data-wall-occupied') === 'false',
      testCase.expected
    );
  }

  await page.mouse.move(0, 0);
  const lockedBeforeBudget = await usedBudget();
  const lockedTarget = cornerCases[0];
  const releasePoint = cornerCases[1].point;
  await page.mouse.move(lockedTarget.point.x, lockedTarget.point.y);
  await page.mouse.down();
  await page.locator('[data-wall-segment="2,2:right"][data-wall-pointer-target=true]').waitFor();
  await page.mouse.move(releasePoint.x, releasePoint.y);
  if (await page.locator('[data-wall-segment="2,2:right"][data-wall-pointer-target=true]').count() !== 1) {
    throw new Error('pointerdown 뒤 손가락 이동 중 대상 벽 고정이 풀림');
  }
  await page.mouse.up();
  await page.waitForFunction(
    () => document.querySelector('[data-wall-segment="2,2:right"]')
      ?.getAttribute('data-wall-occupied') === 'true'
  );
  if (
    await usedBudget() !== lockedBeforeBudget + 1 ||
    await page.locator('[data-wall-segment="2,3:down"]').getAttribute('data-wall-occupied') !== 'false'
  ) {
    throw new Error('pointerdown 대상 대신 pointerup 위치의 벽이 설치됨');
  }
  await page.getByRole('button', { name: '실행 취소', exact: true }).click();

  ok('모바일 겹침·모서리 4방향·정확한 중심도 pointerdown 대상에 정확히 1회 설치');
}

async function setupSparseMapTest(page) {
  await page.locator('[data-cell="0,0"]').click();
  await page.locator('[data-cell="0,2"]').click();
  await page.setViewportSize({ width: 360, height: 640 });
  await page.waitForTimeout(150);

  const completeButton = page.getByRole('button', { name: '완료', exact: true });
  if (!(await completeButton.isEnabled())) {
    throw new Error('내 맵 테스트에서 유효한 0/24 맵의 완료 버튼이 비활성화됨');
  }
  if (await page.locator('[data-testid=full-budget-required]').count() !== 0) {
    throw new Error('내 맵 테스트에 24/24 강제 안내가 노출됨');
  }

  for (const tab of ['함정', '특수벽']) {
    await page.getByRole('tab', { name: tab }).click();
    const compact = await page.locator('[data-testid=setup-palette-options]').evaluate((element) => ({
      scrollWidth: element.scrollWidth,
      clientWidth: element.clientWidth,
      buttonCount: element.querySelectorAll('button').length,
    }));
    if (compact.buttonCount === 0 || compact.scrollWidth > compact.clientWidth + 1) {
      throw new Error(`${tab} 선택기가 모바일 폭에서 다시 스크롤됨: ${JSON.stringify(compact)}`);
    }
  }

  await page.getByRole('button', { name: /화염벽/ }).click();
  await page.getByRole('button', { name: '1행 1열 right 벽', exact: true }).click();
  const budget = page.locator('[data-testid=setup-budget]');
  if (!(await budget.innerText()).includes('1/24')) {
    throw new Error(`부분 예산 맵이 1/24로 유지되지 않음: ${await budget.innerText()}`);
  }
  if ((await budget.getAttribute('data-budget-complete')) !== 'false') {
    throw new Error('부분 예산 맵이 전체 예산 완료로 잘못 표시됨');
  }
  if (!(await completeButton.isEnabled())) {
    throw new Error('내 맵 테스트에서 유효한 1/24 맵의 완료 버튼이 비활성화됨');
  }

  const scrollContract = await page.locator('[data-testid=setup-controls]').evaluate((controls) => ({
    controlsScrollHeight: controls.scrollHeight,
    controlsClientHeight: controls.clientHeight,
    pageScrollHeight: document.documentElement.scrollHeight,
    pageClientHeight: document.documentElement.clientHeight,
  }));
  if (
    scrollContract.controlsScrollHeight > scrollContract.controlsClientHeight + 1 ||
    scrollContract.pageScrollHeight > scrollContract.pageClientHeight + 1
  ) {
    throw new Error(`압축 팔레트가 세로 스크롤을 만듦: ${JSON.stringify(scrollContract)}`);
  }

  await completeButton.click();
  ok('1/24 부분 예산 맵 테스트 · 모바일 팔레트 무스크롤');
}

async function setupFullBudgetPracticeMap(page, { verifyPreview = false, verifyHistory = false } = {}) {
  if (verifyHistory) {
    await expectStartSelectionUndoRedo(page);
  } else {
    await page.locator('[data-cell="0,0"]').click();
  }
  await page.locator('[data-cell="0,2"]').click();
  await page.setViewportSize({ width: 360, height: 800 });
  await page.waitForTimeout(150);

  const completeButton = page.getByRole('button', { name: '완료', exact: true });
  if (await completeButton.isEnabled()) throw new Error('0/24 연습 맵에서 완료 버튼이 활성화됨');
  await page.locator('[data-testid=full-budget-required]').waitFor();
  if (verifyPreview) await expectNearestWallPointerRouting(page);

  if (await page.getByRole('tab', { name: '스킬' }).count() !== 0) {
    throw new Error('스킬 탭이 신규 맵 제작에 노출됨');
  }
  if (await page.getByRole('button', { name: /탐지기/ }).count() !== 0) {
    throw new Error('탐지기가 신규 맵 제작 팔레트에 노출됨');
  }
  await page.getByRole('button', { name: /연막 함정/ }).click();
  await page.locator('[data-cell="0,1"]').click();

  await page.getByRole('tab', { name: '특수벽' }).click();
  if (await page.getByRole('button', { name: /강철벽|붕괴벽|위상벽|거울벽|수정벽/ }).count() !== 0) {
    throw new Error('은퇴한 강철/붕괴/위상/거울/수정벽이 신규 맵 제작 팔레트에 노출됨');
  }
  const budgetBeforeGuide = await page.locator('[data-testid=setup-budget]').innerText();
  await page.getByRole('button', { name: /화염벽/ }).click();
  const wallGuideStatus = page.locator('[data-testid=wall-placement-guide][data-selected-wall=fireWall]');
  const fireGuide = page.locator('[data-maze-board-grid] [data-wall-guide=fireWall]');
  const fireActionPreview = page.locator('[data-testid=wall-action-preview][data-preview-wall=fireWall]');
  await wallGuideStatus.waitFor();
  await fireGuide.waitFor();
  await fireActionPreview.waitFor();
  if (verifyPreview) {
    if (await page.locator('[data-testid=wall-effect-preview]').count() !== 0) {
      throw new Error('보드를 가리는 기존 벽 미리보기 팝업이 남아 있음');
    }
    const guideContract = await fireGuide.evaluate((element) => {
      const board = element.closest('[data-maze-board-grid]');
      const slot = element.closest('[data-wall-segment]');
      const rect = element.getBoundingClientRect();
      const boardRect = board?.getBoundingClientRect();
      const effect = element.querySelector('[data-wall-effect="fireWall"]');
      return {
        inBoard: !!board,
        occupied: slot?.getAttribute('data-wall-occupied'),
        segment: slot?.getAttribute('data-wall-segment'),
        insideBoard: !!boardRect && rect.left >= boardRect.left && rect.top >= boardRect.top &&
          rect.right <= boardRect.right && rect.bottom <= boardRect.bottom,
        animation: effect ? getComputedStyle(effect).animationName : '',
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
      };
    });
    if (
      !guideContract.inBoard || !guideContract.insideBoard || guideContract.occupied !== 'false' ||
      !guideContract.segment || !guideContract.animation.includes('wall-guide-breathe') ||
      guideContract.scrollWidth !== guideContract.clientWidth
    ) {
      throw new Error(`Galaxy S21 인보드 벽 가이드 계약 오류: ${JSON.stringify(guideContract)}`);
    }
    if (await page.locator('[data-testid=setup-budget]').innerText() !== budgetBeforeGuide) {
      throw new Error('벽 가이드만 표시했는데 벽 예산이 변경됨');
    }
    const actionContract = await fireActionPreview.evaluate((element) => {
      const board = element.closest('[data-maze-board-grid]');
      const segment = element.getAttribute('data-preview-segment');
      const slot = segment
        ? board?.querySelector(`[data-wall-segment="${segment}"]`)
        : null;
      const originCell = element.closest('[data-cell]');
      const destination = element.getAttribute('data-preview-to');
      const destinationCell = destination
        ? board?.querySelector(`[data-cell="${destination}"]`)
        : null;
      const avatar = element.querySelector('[data-shadow-clone=origin]');
      const rect = element.getBoundingClientRect();
      const boardRect = board?.getBoundingClientRect();
      return {
        inBoard: !!board,
        insideBoard: !!boardRect && rect.left >= boardRect.left && rect.top >= boardRect.top &&
          rect.right <= boardRect.right && rect.bottom <= boardRect.bottom,
        safe: element.getAttribute('data-preview-safe'),
        interactive: element.getAttribute('data-preview-interactive'),
        pointerEvents: getComputedStyle(element).pointerEvents,
        ariaHidden: element.getAttribute('aria-hidden'),
        segment,
        guideSegment: board?.querySelector('[data-wall-guide=fireWall]')
          ?.closest('[data-wall-segment]')?.getAttribute('data-wall-segment'),
        occupied: slot?.getAttribute('data-wall-occupied'),
        origin: originCell?.getAttribute('data-cell'),
        destination: destinationCell?.getAttribute('data-cell'),
        originHasMarker: !!originCell?.querySelector('[data-map-item]') ||
          ['S', 'E'].includes(originCell?.textContent?.trim() || ''),
        destinationHasMarker: !!destinationCell?.querySelector('[data-map-item]') ||
          ['S', 'E'].includes(destinationCell?.textContent?.trim() || ''),
        animation: avatar ? getComputedStyle(avatar).animationName : '',
        ashWalls: element.querySelectorAll('[data-preview-ash-wall]').length,
        source: element.getAttribute('data-preview-source'),
        approachStep: element.querySelector('[data-preview-step=approach]')?.textContent?.trim(),
        triggerStep: board?.querySelector('[data-wall-guide=fireWall] [data-preview-step=trigger]')
          ?.textContent?.trim(),
        resultStep: element.querySelector('[data-preview-step=result]')?.textContent?.trim(),
        result: element.getAttribute('data-preview-result'),
        actionCost: element.getAttribute('data-preview-action-cost'),
        wallConsumed: element.getAttribute('data-preview-wall-consumed'),
      };
    });
    if (
      !actionContract.inBoard || !actionContract.insideBoard ||
      actionContract.safe !== 'true' || actionContract.interactive !== 'false' ||
      actionContract.pointerEvents !== 'none' || actionContract.ariaHidden !== 'true' ||
      !actionContract.segment || actionContract.segment !== actionContract.guideSegment ||
      actionContract.occupied !== 'false' || !actionContract.origin || !actionContract.destination ||
      actionContract.originHasMarker || actionContract.destinationHasMarker ||
      !actionContract.animation.includes('wall-shadow-fire-map') || actionContract.ashWalls !== 3 ||
      actionContract.source !== 'suggested' || !actionContract.approachStep?.includes('추천 · ①') ||
      actionContract.triggerStep !== '②' || !actionContract.resultStep?.startsWith('③') ||
      actionContract.result !== actionContract.origin || actionContract.actionCost !== '1' ||
      actionContract.wallConsumed !== 'true'
    ) {
      throw new Error(`화염벽 그림자 분신 계약 오류: ${JSON.stringify(actionContract)}`);
    }
    await page.waitForTimeout(250);
    if (await page.locator('[data-testid=setup-budget]').innerText() !== budgetBeforeGuide) {
      throw new Error('화염벽 그림자 분신 애니메이션이 벽 예산을 변경함');
    }

    await page.getByRole('button', { name: /독벽/ }).click();
    const poisonPreview = page.locator('[data-testid=wall-action-preview][data-preview-wall=poisonWall]');
    await poisonPreview.waitFor();
    const poisonContract = await poisonPreview.evaluate((element) => ({
      pointerEvents: getComputedStyle(element).pointerEvents,
      input: element.querySelector('[data-preview-input-direction]')?.getAttribute('data-preview-input-direction'),
      result: element.querySelector('[data-preview-result-direction]')?.getAttribute('data-preview-result-direction'),
      effect: element.querySelector('[data-preview-effect=random-four-way]')?.getAttribute('data-preview-effect'),
      destinationAnimation: element.closest('[data-maze-board-grid]')
        ?.querySelector('[data-wall-action-preview-companion=poisonWall] [data-shadow-clone=destination]')
        ? getComputedStyle(element.closest('[data-maze-board-grid]')
          .querySelector('[data-wall-action-preview-companion=poisonWall] [data-shadow-clone=destination]')).animationName
        : '',
    }));
    if (
      poisonContract.pointerEvents !== 'none' || !poisonContract.input || !poisonContract.result ||
      poisonContract.effect !== 'random-four-way' ||
      !poisonContract.destinationAnimation.includes('wall-shadow-poison-random')
    ) {
      throw new Error(`독벽 100% 방향 전환 분신 계약 오류: ${JSON.stringify(poisonContract)}`);
    }

    await page.getByRole('button', { name: /빙결벽/ }).click();
    const icePreview = page.locator('[data-testid=wall-action-preview][data-preview-wall=iceWall]');
    await icePreview.waitFor();
    const iceContract = await icePreview.evaluate((element) => ({
      from: element.getAttribute('data-preview-from'),
      result: element.getAttribute('data-preview-result'),
      blocked: element.getAttribute('data-preview-effect-blocked'),
      actionCost: element.getAttribute('data-preview-action-cost'),
      wallConsumed: element.getAttribute('data-preview-wall-consumed'),
      source: element.getAttribute('data-preview-source'),
      approach: element.querySelector('[data-preview-step=approach]')?.textContent?.trim(),
      trigger: element.closest('[data-maze-board-grid]')
        ?.querySelector('[data-wall-guide=iceWall] [data-preview-step=trigger]')?.textContent?.trim(),
      resultLabel: element.querySelector('[data-preview-step=result]')?.textContent?.trim(),
    }));
    if (
      !iceContract.from || iceContract.result !== iceContract.from || iceContract.blocked !== 'true' ||
      iceContract.actionCost !== '2' || iceContract.wallConsumed !== 'true' ||
      iceContract.source !== 'suggested' || !iceContract.approach?.includes('추천 · ①') ||
      iceContract.trigger !== '②' || !iceContract.resultLabel?.includes('행동 2회 소모')
    ) {
      throw new Error(`빙결벽 차단/추가행동 3단계 예시 오류: ${JSON.stringify(iceContract)}`);
    }

    await page.getByRole('button', { name: /가시벽/ }).click();
    const thornPreview = page.locator('[data-testid=wall-action-preview][data-preview-wall=thornWall]');
    await thornPreview.waitFor();
    const thornContract = await thornPreview.evaluate((element) => {
      const parse = (value) => value?.split(',').map(Number) || [];
      const from = parse(element.getAttribute('data-preview-from'));
      const to = parse(element.getAttribute('data-preview-to'));
      const result = parse(element.getAttribute('data-preview-result'));
      const input = to[0] < from[0] ? 'up' : to[0] > from[0] ? 'down' : to[1] < from[1] ? 'left' : 'right';
      const opposite = { up: 'down', down: 'up', left: 'right', right: 'left' }[input];
      const delta = opposite === 'up' ? [-1, 0]
        : opposite === 'down' ? [1, 0]
          : opposite === 'left' ? [0, -1] : [0, 1];
      const expectedResult = [from[0] + delta[0], from[1] + delta[1]];
      return {
        from,
        to,
        result,
        opposite,
        expectedResult,
        effectDirection: element.getAttribute('data-preview-effect-direction'),
        blocked: element.getAttribute('data-preview-effect-blocked'),
        actionCost: element.getAttribute('data-preview-action-cost'),
        wallConsumed: element.getAttribute('data-preview-wall-consumed'),
        resultLabel: element.closest('[data-maze-board-grid]')
          ?.querySelector('[data-wall-action-preview-companion=thornWall] [data-preview-step=result], [data-testid=wall-action-preview][data-preview-wall=thornWall] [data-preview-step=result]')
          ?.textContent?.trim(),
      };
    });
    const thornStayed = thornContract.blocked === 'true';
    if (
      thornContract.effectDirection !== thornContract.opposite ||
      thornContract.actionCost !== '1' || thornContract.wallConsumed !== 'true' ||
      (thornStayed
        ? thornContract.result.join(',') !== thornContract.from.join(',')
        : thornContract.result.join(',') !== thornContract.expectedResult.join(',')) ||
      !thornContract.resultLabel?.startsWith('③')
    ) {
      throw new Error(`가시벽 반대방향 튕김 3단계 예시 오류: ${JSON.stringify(thornContract)}`);
    }

    await page.getByRole('tab', { name: '함정' }).click();
    await page.getByRole('button', { name: /웜홀/ }).click();
    const wormholePreview = page.locator('[data-testid=wall-action-preview][data-preview-wall=wormhole]');
    await wormholePreview.waitFor();
    const wormholeContract = await wormholePreview.evaluate((element) => ({
      kind: element.getAttribute('data-preview-kind'),
      segment: element.getAttribute('data-preview-segment'),
      pointerEvents: getComputedStyle(element).pointerEvents,
      portal: element.querySelector('[data-preview-effect=dice-wormhole]')?.getAttribute('data-preview-effect'),
      dice: element.closest('[data-maze-board-grid]')
        ?.querySelector('[data-wall-action-preview-companion=wormhole] [data-preview-effect=dice-roll]')
        ?.getAttribute('data-preview-effect'),
      from: element.getAttribute('data-preview-from'),
      to: element.getAttribute('data-preview-to'),
    }));
    if (
      wormholeContract.kind !== 'wormhole' || wormholeContract.segment !== null ||
      wormholeContract.pointerEvents !== 'none' || wormholeContract.portal !== 'dice-wormhole' ||
      wormholeContract.dice !== 'dice-roll' || !wormholeContract.from || !wormholeContract.to ||
      wormholeContract.from === wormholeContract.to
    ) {
      throw new Error(`웜홀 주사위 그림자 분신 계약 오류: ${JSON.stringify(wormholeContract)}`);
    }
    if (await page.locator('[data-testid=setup-budget]').innerText() !== budgetBeforeGuide) {
      throw new Error('독벽/웜홀 그림자 분신만 확인했는데 벽 예산이 변경됨');
    }
    await page.getByRole('tab', { name: '특수벽' }).click();
    await page.getByRole('button', { name: /화염벽/ }).click();
    await fireActionPreview.waitFor();

    await page.screenshot({ path: path.join(OUT, 'practice-wall-guide-galaxy-s21.png') });
    ok('실제 보드 내 화염/독/웜홀 그림자 분신 · 안전한 빈 위치 · 예산 무변경');
  }
  await page.getByRole('button', { name: '1행 1열 right 벽', exact: true }).click();

  if (verifyPreview) {
    const installedFire = page.locator('[data-map-item=fireWall] [data-wall-effect=fireWall]');
    await installedFire.waitFor();
    const installedAnimation = await installedFire.evaluate((element) => getComputedStyle(element).animationName);
    if (!installedAnimation.includes('wall-fire-flicker')) {
      throw new Error(`설치된 화염벽 이펙트가 활성화되지 않음: ${installedAnimation}`);
    }
    const windButton = page.getByRole('button', { name: /바람벽/ }).first();
    await windButton.click();
    const windActionPreview = page.locator('[data-testid=wall-action-preview][data-preview-wall=windWall]');
    await windActionPreview.waitFor();
    const windPreviewContract = await windActionPreview.evaluate((element) => ({
      source: element.getAttribute('data-preview-source'),
      effectDirection: element.getAttribute('data-preview-effect-direction'),
      actionCost: element.getAttribute('data-preview-action-cost'),
      wallConsumed: element.getAttribute('data-preview-wall-consumed'),
      approachStep: element.querySelector('[data-preview-step=approach]')?.textContent?.trim(),
      resultStep: element.closest('[data-maze-board-grid]')
        ?.querySelector('[data-wall-action-preview-companion=windWall] [data-preview-step=result], [data-testid=wall-action-preview][data-preview-wall=windWall] [data-preview-step=result]')
        ?.textContent?.trim(),
    }));
    if (
      windPreviewContract.source !== 'suggested' || windPreviewContract.effectDirection !== 'right' ||
      windPreviewContract.actionCost !== '1' || windPreviewContract.wallConsumed !== 'true' ||
      !windPreviewContract.approachStep?.includes('추천 · ①') ||
      !windPreviewContract.resultStep?.startsWith('③')
    ) {
      throw new Error(`바람벽 3단계 그림자 예시 계약 오류: ${JSON.stringify(windPreviewContract)}`);
    }
    const windSuggestedSegment = await windActionPreview.getAttribute('data-preview-segment');
    if (!windSuggestedSegment) throw new Error('바람벽 추천 미리보기 벽선을 찾지 못함');
    const occupiedFireSlot = page.locator('[data-wall-segment="0,0:right"]');
    await occupiedFireSlot.focus();
    await occupiedFireSlot.locator('[data-wall-conflict=true]').waitFor();
    if (
      await occupiedFireSlot.getAttribute('aria-disabled') !== 'true' ||
      !(await occupiedFireSlot.getAttribute('aria-label'))?.includes('이미 점유됨')
    ) {
      throw new Error('키보드 포커스가 점유 벽 충돌을 설명하지 않음');
    }
    await page.keyboard.press('Enter');
    if (await occupiedFireSlot.locator('[data-map-item=windWall]').count() !== 0) {
      throw new Error('키보드 입력으로 기존 화염벽 위에 바람벽이 겹쳐짐');
    }
    const occupiedFireRect = await occupiedFireSlot.boundingBox();
    if (!occupiedFireRect) throw new Error('점유 화염벽 터치 좌표를 계산하지 못함');
    await occupiedFireSlot.dispatchEvent('pointerdown', {
      pointerType: 'touch',
      pointerId: 7,
      isPrimary: true,
      bubbles: true,
      clientX: occupiedFireRect.x + occupiedFireRect.width / 2,
      clientY: occupiedFireRect.y + occupiedFireRect.height / 2,
    });
    await occupiedFireSlot.locator('[data-wall-conflict=true]').waitFor();
    if (await occupiedFireSlot.getAttribute('aria-disabled') !== 'true') {
      throw new Error('터치한 점유 벽이 충돌 대상으로 안내되지 않음');
    }
    if (await occupiedFireSlot.locator('[data-wall-guide]').count() !== 0) {
      throw new Error('기존 화염벽 위에 바람벽 고스트가 겹쳐짐');
    }
    const windGuideSlot = page.locator(`[data-wall-segment="${windSuggestedSegment}"]`);
    const windGuideRect = await windGuideSlot.boundingBox();
    if (!windGuideRect) throw new Error('빈 바람벽 터치 좌표를 계산하지 못함');
    await windGuideSlot.dispatchEvent('pointerdown', {
      pointerType: 'touch',
      pointerId: 8,
      isPrimary: true,
      bubbles: true,
      clientX: windGuideRect.x + windGuideRect.width / 2,
      clientY: windGuideRect.y + windGuideRect.height / 2,
    });
    await windGuideSlot.locator('[data-wall-guide=windWall]').waitFor();
    await windGuideSlot.waitFor();
    if (await windGuideSlot.getAttribute('data-wall-occupied') !== 'false') {
      throw new Error('바람벽 자동 가이드가 점유된 벽을 선택함');
    }
    await page.waitForFunction(() =>
      document.querySelector('[data-testid=wall-action-preview][data-preview-wall=windWall]')
        ?.getAttribute('data-preview-source') === 'pointer'
    );
    const selectedWindSource = await windActionPreview.evaluate((element) => ({
      source: element.getAttribute('data-preview-source'),
      approach: element.querySelector('[data-preview-step=approach]')?.textContent?.trim(),
    }));
    if (
      selectedWindSource.source !== 'pointer' ||
      !selectedWindSource.approach?.includes('선택 · ①')
    ) {
      throw new Error(`바람벽 선택 위치 그림자 예시 오류: ${JSON.stringify(selectedWindSource)}`);
    }
    const windLayout = await page.evaluate(() => {
      const description = document.querySelector('[data-testid=active-palette-description]');
      const controls = document.querySelector('[aria-label="바람 방향"]');
      if (!description || !controls) return null;
      const descriptionRect = description.getBoundingClientRect();
      const controlsRect = controls.getBoundingClientRect();
      return {
        description: {
          left: descriptionRect.left,
          top: descriptionRect.top,
          right: descriptionRect.right,
          bottom: descriptionRect.bottom,
          clientWidth: description.clientWidth,
          scrollWidth: description.scrollWidth,
          clientHeight: description.clientHeight,
          scrollHeight: description.scrollHeight,
        },
        controls: {
          left: controlsRect.left,
          top: controlsRect.top,
          right: controlsRect.right,
          bottom: controlsRect.bottom,
        },
      };
    });
    if (
      !windLayout ||
      windLayout.description.left < 0 || windLayout.description.right > 360 ||
      windLayout.controls.left < 0 || windLayout.controls.right > 360 ||
      windLayout.description.scrollWidth > windLayout.description.clientWidth + 1 ||
      windLayout.description.scrollHeight > windLayout.description.clientHeight + 1 ||
      (
        Math.min(windLayout.description.right, windLayout.controls.right) -
          Math.max(windLayout.description.left, windLayout.controls.left) > 1 &&
        Math.min(windLayout.description.bottom, windLayout.controls.bottom) -
          Math.max(windLayout.description.top, windLayout.controls.top) > 1
      )
    ) {
      throw new Error(`Galaxy S21 바람벽 설명/방향 배치 오류: ${JSON.stringify(windLayout)}`);
    }
    const windTouchSizes = await page.locator('[aria-label="바람 방향"] button').evaluateAll((buttons) =>
      buttons.map((button) => {
        const rect = button.getBoundingClientRect();
        return { width: rect.width, height: rect.height };
      })
    );
    if (windTouchSizes.some((size) => size.width < 44 || size.height < 44)) {
      throw new Error(`바람 방향 터치 영역 오류: ${JSON.stringify(windTouchSizes)}`);
    }
    await page.getByRole('tab', { name: '함정' }).click();
    ok('Galaxy S21 바람벽 방향 버튼 · 기존 벽 중첩 방지 피드백');
  }

  await addFullBudgetWalls(page);
  const setupBounds = await page.evaluate(() => {
    const palette = document.querySelector('[role="tablist"]')?.closest('.game-panel');
    const board = document.querySelector('[data-cell]')?.closest('.grid');
    if (!palette || !board) return null;
    const paletteRect = palette.getBoundingClientRect();
    const boardRect = board.getBoundingClientRect();
    return {
      palette: { left: paletteRect.left, right: paletteRect.right, top: paletteRect.top, bottom: paletteRect.bottom },
      board: { left: boardRect.left, right: boardRect.right, top: boardRect.top, bottom: boardRect.bottom },
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    };
  });
  if (
    !setupBounds || setupBounds.scrollWidth !== setupBounds.clientWidth ||
    setupBounds.palette.left < 0 || setupBounds.palette.right > 360 || setupBounds.palette.bottom > 800 ||
    setupBounds.board.left < 0 || setupBounds.board.right > 360 || setupBounds.board.bottom > setupBounds.palette.top
  ) {
    throw new Error(`Galaxy S21 맵 제작 보드/팔레트 범위 오류: ${JSON.stringify(setupBounds)}`);
  }
  await page.screenshot({ path: path.join(OUT, 'practice-setup-galaxy-s21.png') });
  ok('Galaxy S21 맵 제작 보드/팔레트 비겹침');
  await completeButton.click();
}

async function expectBoardCount(page, expected) {
  const boards = page.locator('[data-player-board]');
  await boards.nth(expected - 1).waitFor({ timeout: 15000 });
  const count = await boards.count();
  if (count !== expected) throw new Error(`보드 수 불일치: expected=${expected}, actual=${count}`);
  const mountedCount = await page.locator('[data-mounted-board-count]').getAttribute('data-mounted-board-count');
  if (mountedCount !== String(expected)) {
    throw new Error(`마운트 보드 수 계약 불일치: expected=${expected}, actual=${mountedCount}`);
  }
  ok(`보드 ${expected}개 마운트`);
}

async function expectAllMobileBoards(page, expected, label) {
  await page.waitForFunction((count) => {
    if (!window.matchMedia('(max-width: 639px)').matches) return false;
    const grid = document.querySelector('[data-mounted-board-count]');
    const boards = [...document.querySelectorAll('[data-player-board]')];
    const canvases = [...document.querySelectorAll('[data-player-board] canvas')];
    const hasSize = (element) => {
      const rect = element.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0 && getComputedStyle(element).visibility !== 'hidden';
    };
    return grid?.getAttribute('data-mounted-board-count') === String(count) &&
      document.querySelectorAll('[data-testid="mobile-board-tabs"]').length === 0 &&
      boards.length === count &&
      canvases.length === count &&
      boards.every(hasSize) &&
      canvases.every(hasSize);
  }, expected, { timeout: 15000 });
  ok(`${label} 모바일 탭 없음 · 전체 3D 보드 ${expected}개 동시 표시`);
}

async function waitForHumanTurn(page) {
  try {
    await page.waitForFunction(
      () =>
        document.querySelector('[data-current-turn=true]')?.getAttribute('data-player-board') === 'practice-user' ||
        !!document.querySelector('[data-testid=practice-result]'),
      null,
      { timeout: 30000 }
    );
  } catch (error) {
    const state = await page.evaluate(() => ({
      current: document.querySelector('[data-current-turn=true]')?.getAttribute('data-player-board') || null,
      humanPosition: document.querySelector('[data-player-board="practice-user"]')?.getAttribute('data-player-position') || null,
      boards: [...document.querySelectorAll('[data-player-board]')].map((board) => ({
        id: board.getAttribute('data-player-board'),
        current: board.getAttribute('data-current-turn'),
        position: board.getAttribute('data-player-position'),
        text: board.textContent?.slice(0, 120),
      })),
      result: !!document.querySelector('[data-testid=practice-result]'),
    }));
    throw new Error(`사람 턴 대기 실패: ${JSON.stringify(state)} (${error.message})`);
  }
  return await page.locator('[data-testid=practice-result]').count() === 0;
}

async function boardMoves(page, id) {
  const text = await page.locator(`[data-player-board="${id}"]`).innerText();
  const match = text.match(/턴:\s*(\d+)/);
  if (!match) throw new Error(`${id} 보드의 개인 턴을 읽지 못함: ${text}`);
  return Number(match[1]);
}

async function expectMobileSwipeMove(page) {
  const board = page.locator('[data-player-board="practice-user"]');
  const position = (await board.getAttribute('data-player-position') || '0,0')
    .split(',')
    .map(Number);
  const [row, col] = position;
  const direction = col > 0 ? 'left' : row > 0 ? 'up' : 'right';
  const delta = {
    up: [0, -80],
    down: [0, 80],
    left: [-80, 0],
    right: [80, 0],
  }[direction];
  const bounds = await board.boundingBox();
  if (!bounds) throw new Error('모바일 스와이프 대상 보드 bounds를 읽지 못함');

  const before = await boardMoves(page, 'practice-user');
  const startX = bounds.x + bounds.width / 2;
  const startY = bounds.y + bounds.height * 0.45;
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX + delta[0], startY + delta[1], { steps: 3 });
  await page.mouse.up();
  await page.waitForFunction((expectedMoves) => {
    const text = document.querySelector('[data-player-board="practice-user"]')?.textContent || '';
    return new RegExp(`턴:\\s*${expectedMoves}(?:\\D|$)`).test(text);
  }, before + 1, { timeout: 10000 });
  await waitForHumanTurn(page);

  const after = await boardMoves(page, 'practice-user');
  if (after !== before + 1) {
    throw new Error(`모바일 스와이프가 정확히 한 턴을 소비하지 않음: before=${before}, after=${after}`);
  }
  ok(`모바일 보드 스와이프 ${direction} -> 한 턴 이동`);
}

async function expectResponsiveBounds(page, name, width, height) {
  await page.setViewportSize({ width, height });
  await page.waitForTimeout(150);
  const result = await page.evaluate(() => {
    const nodes = [
      ...document.querySelectorAll('[data-player-board]'),
      document.querySelector('[data-testid=practice-controls]'),
      document.querySelector('[data-testid=practice-mobile-direction-dock]'),
      document.querySelector('[data-testid=practice-mobile-direction-pad]'),
    ].filter(Boolean);
    return {
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
      invalid: nodes.map((node) => {
        const rect = node.getBoundingClientRect();
        return {
          id: node.getAttribute('data-player-board') || 'controls',
          left: rect.left,
          top: rect.top,
          right: rect.right,
          bottom: rect.bottom,
        };
      }).filter((rect) => rect.left < 0 || rect.top < 0 || rect.right > innerWidth || rect.bottom > innerHeight),
      buttons: [...document.querySelectorAll('[data-testid=practice-controls] button, [data-testid=practice-mobile-direction-pad] button')].map((button) => {
        const rect = button.getBoundingClientRect();
        return { width: rect.width, height: rect.height };
      }).filter((rect) => rect.width > 0 && rect.height > 0),
    };
  });
  if (result.scrollWidth !== result.clientWidth || result.invalid.length > 0) {
    throw new Error(`${name} 레이아웃 범위 오류: ${JSON.stringify(result)}`);
  }
  if (result.buttons.some((button) => button.width < 44 || button.height < 44)) {
    throw new Error(`${name} 터치 버튼이 44px보다 작음: ${JSON.stringify(result.buttons)}`);
  }
  await page.screenshot({ path: path.join(OUT, `practice-${name}.png`) });
  ok(`${name} ${width}x${height} 범위/터치 영역`);
}

async function expectGameplay3DOnly(page, label, expectedBoards) {
  await page.waitForFunction((count) => {
    const boards = document.querySelectorAll('[data-player-board]');
    const canvases = document.querySelectorAll('[data-player-board] canvas');
    return boards.length === count && canvases.length === count;
  }, expectedBoards, { timeout: 15000 });

  const contract = await page.evaluate(() => ({
    twoDToggles: document.querySelectorAll('button[aria-label="2D 보드"]').length,
    twoDViewports: document.querySelectorAll('[data-player-board] [data-testid="board-2d-viewport"]').length,
    canvases: document.querySelectorAll('[data-player-board] canvas').length,
  }));
  if (contract.twoDToggles !== 0 || contract.twoDViewports !== 0 || contract.canvases !== expectedBoards) {
    throw new Error(`${label} 3D 전용 플레이 계약 오류: ${JSON.stringify(contract)}`);
  }
  ok(`${label} 2D 전환 없음 · 3D 보드 ${expectedBoards}개`);
}

async function expectNonBlankCanvases(page, expected) {
  const canvases = page.locator('[data-player-board] canvas');
  await canvases.nth(expected - 1).waitFor({ timeout: 15000 });
  await page.waitForTimeout(800);
  const stats = [];
  for (let index = 0; index < await canvases.count(); index += 1) {
    const image = PNG.sync.read(await canvases.nth(index).screenshot());
    let min = 255;
    let max = 0;
    for (let offset = 0; offset < image.data.length; offset += 4) {
      const lightness = Math.round((image.data[offset] + image.data[offset + 1] + image.data[offset + 2]) / 3);
      min = Math.min(min, lightness);
      max = Math.max(max, lightness);
    }
    stats.push(max - min);
  }
  if (stats.length !== expected || stats.some((range) => range < 15)) {
    throw new Error(`3D 캔버스 렌더링 오류: ${JSON.stringify(stats)}`);
  }
  ok(`3D 캔버스 ${expected}개 nonblank`);
}

async function expectMobileToonCanvases(page, label, expected) {
  await page.waitForFunction(({
    expectedVersion,
    expectedAssetVersion,
    expectedCatalogCount,
    expectedMainAssetCount,
    count,
  }) => {
    const canvases = [...document.querySelectorAll('[data-player-board] canvas')];
    if (canvases.length !== count) return false;
    return canvases.every((canvas) => {
      const dpr = Number(canvas.getAttribute('data-maze-render-dpr'));
      const materialCount = Number(canvas.getAttribute('data-maze-toon-materials'));
      return canvas.getAttribute('data-maze-toon-version') === expectedVersion &&
        canvas.getAttribute('data-maze-asset-state') === 'ready' &&
        canvas.getAttribute('data-maze-asset-version') === expectedAssetVersion &&
        Number(canvas.getAttribute('data-maze-asset-count')) === expectedMainAssetCount &&
        Number(canvas.getAttribute('data-maze-asset-catalog-count')) === expectedCatalogCount &&
        canvas.getAttribute('data-maze-asset-set') === 'main' &&
        canvas.getAttribute('data-maze-camera') === 'fixed-orthographic' &&
        canvas.getAttribute('data-maze-render-quality') === 'compact' &&
        Number.isFinite(materialCount) && materialCount > 0 &&
        Number.isFinite(dpr) && dpr >= 1 && dpr <= 1.5;
    });
  }, {
    expectedVersion: EXPECTED_MAZE_TOON_VERSION,
    expectedAssetVersion: EXPECTED_MAZE_ASSET_VERSION,
    expectedCatalogCount: EXPECTED_MAZE_ASSET_CATALOG_COUNT,
    expectedMainAssetCount: EXPECTED_MAIN_ASSET_COUNT,
    count: expected,
  }, { timeout: 15000 });

  const contracts = await page.locator('[data-player-board] canvas').evaluateAll((canvases) => canvases.map((canvas) => ({
    version: canvas.getAttribute('data-maze-toon-version'),
    dpr: Number(canvas.getAttribute('data-maze-render-dpr')),
    quality: canvas.getAttribute('data-maze-render-quality'),
    materials: Number(canvas.getAttribute('data-maze-toon-materials')),
    camera: canvas.getAttribute('data-maze-camera'),
    assetState: canvas.getAttribute('data-maze-asset-state'),
    assetVersion: canvas.getAttribute('data-maze-asset-version'),
    assetCount: Number(canvas.getAttribute('data-maze-asset-count')),
    assetCatalogCount: Number(canvas.getAttribute('data-maze-asset-catalog-count')),
    assetSet: canvas.getAttribute('data-maze-asset-set'),
  })));
  if (contracts.length !== expected || contracts.some((contract) =>
    contract.version !== EXPECTED_MAZE_TOON_VERSION ||
    contract.assetState !== 'ready' ||
    contract.assetVersion !== EXPECTED_MAZE_ASSET_VERSION ||
    contract.assetCount !== EXPECTED_MAIN_ASSET_COUNT ||
    contract.assetCatalogCount !== EXPECTED_MAZE_ASSET_CATALOG_COUNT ||
    contract.assetSet !== 'main' ||
    contract.quality !== 'compact' ||
    contract.camera !== 'fixed-orthographic' ||
    !(contract.materials > 0) ||
    contract.dpr > 1.5
  )) {
    throw new Error(`${label} 카툰 렌더 계약 오류: ${JSON.stringify(contracts)}`);
  }
  await expectNonBlankCanvases(page, expected);
  ok(`${label} toon=${EXPECTED_MAZE_TOON_VERSION}, ${expected}개 동시 렌더`);
}

(async () => {
  const browser = await chromium.launch({
    channel: process.env.CHROME_PATH ? undefined : 'chrome',
    executablePath: process.env.CHROME_PATH || undefined,
    headless: true,
    args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--use-angle=swiftshader'],
  });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    deviceScaleFactor: 2,
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(String(error)));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });

  try {
    console.log('STEP 1: AI 3명 빠른 대전');
    await page.goto(`${BASE_URL}/practice`, { waitUntil: 'domcontentloaded' });
    await page.getByRole('radio', { name: 'AI 3명' }).click();
    await page.getByRole('button', { name: '빠른 대전' }).click();
    await expectBoardCount(page, 4);
    const kinds = await page.locator('[data-player-board]').evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-player-kind')));
    if (kinds.join(',') !== 'human,ai,ai,ai') throw new Error(`사람/AI 보드 순서 오류: ${kinds}`);
    await expectGameplay3DOnly(page, 'AI 3명 빠른 대전', 4);
    await expectNonBlankCanvases(page, 4);
    const ownerPreview = page.locator('[data-player-board][data-map-owner-preview="true"]');
    if (await ownerPreview.count() !== 1) throw new Error('내가 만든 맵의 제작자 시점 보드가 하나가 아님');
    if (
      (await ownerPreview.getAttribute('data-map-secrets-visible')) !== 'true' ||
      (await ownerPreview.getAttribute('data-obstacles-revealed')) !== 'true'
    ) {
      throw new Error('제작자 시점에서 숨은 아이템/장애물 공개 권한이 적용되지 않음');
    }
    const runnerPreview = page.locator('[data-player-board][data-my-player="true"]');
    if (
      (await runnerPreview.getAttribute('data-map-secrets-visible')) !== 'false' ||
      (await runnerPreview.getAttribute('data-obstacles-revealed')) !== 'false'
    ) {
      throw new Error('주자 시점에 상대 맵의 숨은 정보 공개 권한이 노출됨');
    }
    ok('3D 제작자 보드만 숨은 아이템/장애물 공개');
    await waitForHumanTurn(page);
    ok('사람 선턴');

    console.log('STEP 2: 엄격 교대와 대기 입력 무효');
    await page.keyboard.press('ArrowRight');
    await page.waitForFunction(
      () => document.querySelector('[data-current-turn=true]')?.getAttribute('data-player-board') === 'practice-ai-1'
    );
    if (!(await page.getByRole('button', { name: '오른쪽으로 이동' }).isDisabled())) {
      throw new Error('AI 차례에 사람 이동 버튼이 활성화됨');
    }
    await page.keyboard.press('ArrowDown');
    await waitForHumanTurn(page);
    const movesAfterRound = await Promise.all([
      boardMoves(page, 'practice-user'),
      boardMoves(page, 'practice-ai-1'),
      boardMoves(page, 'practice-ai-2'),
      boardMoves(page, 'practice-ai-3'),
    ]);
    if (movesAfterRound.some((moves) => moves !== 1)) {
      throw new Error(`한 라운드 개인 턴 불일치: ${movesAfterRound}`);
    }
    ok('사람→AI1→AI2→AI3 각 1행동');

    console.log('STEP 3: 3D 전용 4보드 렌더링');
    await expectGameplay3DOnly(page, '턴 진행 후 4보드', 4);
    await expectNonBlankCanvases(page, 4);
    await page.screenshot({ path: path.join(OUT, 'practice-owner-secrets-3d.png') });

    console.log('STEP 4: 모바일 전체 보드 동시 표시 / 카툰 렌더링');
    await expectResponsiveBounds(page, 'galaxy-s21', 360, 800);
    await expectAllMobileBoards(page, 4, 'Galaxy S21');
    await expectGameplay3DOnly(page, 'Galaxy S21 전체 보드', 4);
    await expectMobileToonCanvases(page, 'Galaxy S21 전체 보드', 4);
    await expectCrossDpad(
      page,
      'practice-mobile-direction-pad',
      '[data-player-board="practice-user"]'
    );
    await expectMobileSwipeMove(page);
    await expectAllMobileBoards(page, 4, '스와이프 턴 처리 후 Galaxy S21');

    await expectResponsiveBounds(page, 'iphone-15', 393, 852);
    await expectAllMobileBoards(page, 4, 'iPhone 15');
    await expectGameplay3DOnly(page, 'iPhone 15 전체 보드', 4);
    await expectMobileToonCanvases(page, 'iPhone 15 전체 보드', 4);
    await expectCrossDpad(
      page,
      'practice-mobile-direction-pad',
      '[data-player-board="practice-user"]'
    );
    const viewport = await page.locator('meta[name=viewport]').getAttribute('content');
    if (!viewport?.includes('viewport-fit=cover')) throw new Error(`viewport-fit 누락: ${viewport}`);
    ok('iPhone 안전영역 viewport-fit');

    await page.setViewportSize({ width: 639, height: 800 });
    await expectAllMobileBoards(page, 4, '639px 경계');
    await expectGameplay3DOnly(page, '639px 전체 보드', 4);
    await expectMobileToonCanvases(page, '639px 전체 보드', 4);
    await expectCrossDpad(
      page,
      'practice-mobile-direction-pad',
      '[data-player-board="practice-user"]'
    );
    await page.setViewportSize({ width: 640, height: 800 });
    await expectBoardCount(page, 4);
    await expectGameplay3DOnly(page, '640px 모바일 화면', 4);
    await expectNonBlankCanvases(page, 4);
    if (await page.locator('[data-testid="mobile-board-tabs"]').count() !== 0) {
      throw new Error('640px 모바일 화면에서 레거시 보드 탭이 남아 있음');
    }
    await expectCrossDpad(
      page,
      'practice-mobile-direction-pad',
      '[data-player-board="practice-user"]'
    );
    ok('639px와 640px 모두 4보드 동시 표시와 모바일 십자패드 유지');

    console.log('STEP 5: 모바일 2·3인 전체 보드와 24/24 직접 만든 맵');
    await page.getByRole('button', { name: '연습 설정' }).click();
    await page.getByRole('radio', { name: 'AI 1명' }).click();
    await page.getByRole('button', { name: '빠른 대전' }).click();
    await expectBoardCount(page, 2);
    await expectGameplay3DOnly(page, '2인 빠른 대전', 2);
    await page.setViewportSize({ width: 360, height: 640 });
    await expectAllMobileBoards(page, 2, '짧은 모바일 세로 화면');
    await expectGameplay3DOnly(page, '짧은 모바일 세로 전체 보드', 2);
    await expectMobileToonCanvases(page, '짧은 모바일 세로 전체 보드', 2);
    await expectCrossDpad(
      page,
      'practice-mobile-direction-pad',
      '[data-player-board="practice-user"]'
    );
    await page.screenshot({ path: path.join(OUT, 'practice-2p-all-3d-short-portrait.png') });
    await page.setViewportSize({ width: 852, height: 393 });
    await expectBoardCount(page, 2);
    await expectGameplay3DOnly(page, '모바일 가로 화면', 2);
    await expectNonBlankCanvases(page, 2);
    await expectLandscapeDpadRail(page);
    await expectMobileSwipeMove(page);
    await page.screenshot({ path: path.join(OUT, 'practice-2p-3d-landscape.png') });
    await page.setViewportSize({ width: 360, height: 800 });
    await expectAllMobileBoards(page, 2, '2인 모바일 전체 보드');
    await expectGameplay3DOnly(page, '2인 모바일 전체 보드', 2);
    await expectMobileToonCanvases(page, '2인 모바일 전체 보드', 2);

    await page.getByRole('button', { name: '연습 설정' }).click();
    await page.getByRole('radio', { name: 'AI 2명' }).click();
    await page.getByRole('button', { name: '맵 만들기' }).click();
    await setupFullBudgetPracticeMap(page, { verifyPreview: true, verifyHistory: true });
    await expectAllMobileBoards(page, 3, '직접 만든 맵 3인 전체 보드');
    await expectGameplay3DOnly(page, '직접 만든 맵 3인 전체 보드', 3);
    await expectMobileToonCanvases(page, '직접 만든 맵 3인 전체 보드', 3);
    await expectCrossDpad(
      page,
      'practice-mobile-direction-pad',
      '[data-player-board="practice-user"]'
    );
    ok('24/24 직접 만든 맵 + AI 2명');

    console.log('STEP 6: 부분 예산 내 맵 단독 테스트와 연속 턴');
    await page.getByRole('button', { name: '연습 설정' }).click();
    await page.getByRole('button', { name: '내 맵 테스트' }).click();
    await setupSparseMapTest(page);
    await expectBoardCount(page, 1);
    await expectAllMobileBoards(page, 1, '내 맵 단독 테스트');
    await expectGameplay3DOnly(page, '내 맵 단독 테스트', 1);
    await expectMobileToonCanvases(page, '내 맵 단독 테스트', 1);
    const match = page.locator('[data-testid=practice-match]');
    if (
      (await match.getAttribute('data-practice-mode')) !== 'mapTest' ||
      (await match.getAttribute('data-ai-count')) !== '0'
    ) {
      throw new Error('내 맵 테스트가 AI 없는 단독 모드로 시작되지 않음');
    }
    const ownBoard = page.locator('[data-player-board="practice-user"]');
    if (
      (await ownBoard.getAttribute('data-map-secrets-visible')) !== 'true' ||
      (await ownBoard.getAttribute('data-obstacles-revealed')) !== 'true'
    ) {
      throw new Error('내 맵 테스트 제작자 시점에서 특수벽/장애물 공개 권한이 적용되지 않음');
    }
    const perspectiveToggle = page.getByTestId('map-test-perspective-toggle');
    await perspectiveToggle.getByRole('button', { name: '상대 시점' }).click();
    if (
      (await match.getAttribute('data-map-test-perspective')) !== 'opponent' ||
      (await ownBoard.getAttribute('data-map-secrets-visible')) !== 'false' ||
      (await ownBoard.getAttribute('data-obstacles-revealed')) !== 'false'
    ) {
      throw new Error('내 맵 테스트 상대 시점에서 숨은 특수벽/장애물이 가려지지 않음');
    }
    await perspectiveToggle.getByRole('button', { name: '제작자 시점' }).click();
    if (
      (await match.getAttribute('data-map-test-perspective')) !== 'creator' ||
      (await ownBoard.getAttribute('data-map-secrets-visible')) !== 'true' ||
      (await ownBoard.getAttribute('data-obstacles-revealed')) !== 'true'
    ) {
      throw new Error('내 맵 테스트 제작자 시점으로 다시 전환되지 않음');
    }
    await expectCrossDpad(page, 'practice-mobile-direction-pad', '[data-player-board="practice-user"]');
    const dpad = page.locator('[data-testid=practice-mobile-direction-pad]');
    await dpad.getByRole('button', { name: '오른쪽으로 이동' }).click();
    await page.waitForFunction(() => {
      const board = document.querySelector('[data-player-board="practice-user"]');
      const moves = Number((board?.textContent || '').match(/턴:\s*(\d+)/)?.[1] || 0);
      return moves === 1 && board?.getAttribute('data-fire-affected') === 'true';
    });
    if ((await ownBoard.getAttribute('data-current-turn')) !== 'true') {
      throw new Error('내 맵 테스트에서 한 행동 뒤 턴이 AI로 넘어감');
    }
    await dpad.getByRole('button', { name: '오른쪽으로 이동' }).click();
    await page.waitForFunction(() => {
      const text = document.querySelector('[data-player-board="practice-user"]')?.textContent || '';
      return Number(text.match(/턴:\s*(\d+)/)?.[1] || 0) === 2;
    });
    ok('화염벽 추가 턴 페널티 없이 1행동 처리 · 제작자 시점 연속 테스트');

    console.log('STEP 7: 웜홀 흡입 전환 · 목표칸 주사위 눈 · 6면 주사위 · 무힌트');
    await page.getByRole('button', { name: '현재 맵 수정' }).click();
    await page.locator('[data-testid=game-setup-layout]').waitFor();
    await page.getByRole('button', { name: '화염벽 제거' }).click();
    await page.getByRole('button', { name: '6행 5열 right 벽', exact: true }).click();
    await page.getByRole('tab', { name: '함정' }).click();
    await page.getByRole('button', { name: /웜홀 선택/ }).click();
    await page.locator('[data-cell="1,0"]').click();
    const oneOpenExit = page.locator('[data-cell="5,5"][data-valid-item-target="true"]');
    await oneOpenExit.waitFor();
    await oneOpenExit.click();
    await page.waitForFunction(() =>
      document.querySelector('[data-testid=setup-budget]')?.textContent?.includes('8/24')
    );
    await page.getByRole('button', { name: '완료', exact: true }).click();
    await page.locator('[data-testid=practice-match]').waitFor();

    await page.evaluate(() => {
      const down = [...document.querySelectorAll('button')].find(
        (button) => button.getAttribute('aria-label') === '아래로 이동'
      );
      down?.click();
    });
    const transition = page.locator('[data-testid=wormhole-realm-transition]');
    await transition.waitFor({ state: 'attached' });
    const realmStage = page.locator('[data-testid=live-board-realm-stage]');
    if (
      (await realmStage.getAttribute('data-displayed-realm')) !== 'main' ||
      (await realmStage.getAttribute('data-realm-transition')) !== 'entering' ||
      await realmStage.locator('canvas').count() !== 1 ||
      await realmStage.locator('[data-testid=dice-wormhole-board]').count() !== 0
    ) {
      throw new Error('웜홀 흡입 전에 외부 보드가 유지되지 않음');
    }
    const diceRoom = page.locator('[data-testid=dice-wormhole-board]');
    await diceRoom.waitFor();
    await diceRoom.locator('canvas[data-maze-asset-state=ready]').waitFor({ timeout: 30000 });
    await expectNonBlankCanvases(page, 1);
    const diceContract = await diceRoom.evaluate((room) => {
      const piece = room.querySelector('[data-dice-piece=true]');
      const faces = [...room.querySelectorAll('[data-dice-face]')];
      const canvas = room.querySelector('canvas');
      return {
        displayedRealm: room.closest('[data-testid=live-board-realm-stage]')
          ?.getAttribute('data-displayed-realm'),
        transitionElapsedMs: Number(room.closest('[data-testid=live-board-realm-stage]')
          ?.getAttribute('data-realm-transition-elapsed-ms')),
        faceCount: faces.length,
        sides: faces.map((face) => face.getAttribute('data-dice-face')).sort(),
        declaredFaceCount: piece?.querySelector('[data-dice-face-count]')
          ?.getAttribute('data-dice-face-count'),
        hint: room.getAttribute('data-dice-hint'),
        hintElementCount: room.querySelectorAll('[data-dice-hint-direction]').length,
        hintTextCount: [...room.querySelectorAll('span')]
          .filter((span) => span.textContent?.trim().startsWith('힌트')).length,
        canvasCount: room.querySelectorAll('canvas').length,
        assetState: canvas?.getAttribute('data-maze-asset-state'),
        assetVersion: canvas?.getAttribute('data-maze-asset-version'),
        assetCount: Number(canvas?.getAttribute('data-maze-asset-count')),
        assetCatalogCount: Number(canvas?.getAttribute('data-maze-asset-catalog-count')),
        assetSet: canvas?.getAttribute('data-maze-asset-set'),
        boardRealm: canvas?.getAttribute('data-board-realm'),
        camera: canvas?.getAttribute('data-maze-camera'),
        cameraElevation: canvas?.getAttribute('data-maze-camera-elevation'),
        toonVersion: canvas?.getAttribute('data-maze-toon-version'),
        toonMaterials: Number(canvas?.getAttribute('data-maze-toon-materials')),
        faceCount3d: canvas?.getAttribute('data-dice-face-count'),
        target: room.getAttribute('data-dice-target'),
        targetFloorFace: canvas?.getAttribute('data-target-floor-face'),
      };
    });
    if (
      diceContract.displayedRealm !== 'wormhole' ||
      diceContract.transitionElapsedMs < 850 ||
      diceContract.faceCount !== 6 ||
      diceContract.declaredFaceCount !== '6' ||
      diceContract.sides.join(',') !== 'back,bottom,front,left,right,top' ||
      diceContract.hint !== 'none' ||
      diceContract.hintElementCount !== 0 ||
      diceContract.hintTextCount !== 0 ||
      diceContract.canvasCount !== 1 ||
      diceContract.assetState !== 'ready' ||
      diceContract.assetVersion !== EXPECTED_MAZE_ASSET_VERSION ||
      diceContract.assetCount !== EXPECTED_WORMHOLE_ASSET_COUNT ||
      diceContract.assetCatalogCount !== EXPECTED_MAZE_ASSET_CATALOG_COUNT ||
      diceContract.assetSet !== 'wormhole' ||
      diceContract.boardRealm !== 'wormhole' ||
      diceContract.camera !== 'fixed-orthographic' ||
      diceContract.cameraElevation !== '59' ||
      diceContract.toonVersion !== EXPECTED_MAZE_TOON_VERSION ||
      !(diceContract.toonMaterials > 0) ||
      diceContract.faceCount3d !== '6' ||
      !diceContract.target ||
      diceContract.targetFloorFace !== diceContract.target
    ) {
      throw new Error(`웜홀 주사위/무힌트 계약 오류: ${JSON.stringify(diceContract)}`);
    }

    const requestedRoll = await page.evaluate(() => {
      const room = document.querySelector('[data-testid=dice-wormhole-board]');
      const piece = room?.querySelector('[data-dice-piece=true]');
      const cell = piece?.closest('[data-dice-cell]');
      if (!cell) return null;
      const [row, col] = cell.getAttribute('data-dice-cell').split(',').map(Number);
      const blocked = new Set(
        [...room.querySelectorAll('[data-dice-blocked=true]')]
          .map((node) => node.getAttribute('data-dice-cell'))
      );
      const candidates = [
        { direction: 'up', label: '위로 이동', row: row - 1, col },
        { direction: 'right', label: '오른쪽으로 이동', row, col: col + 1 },
        { direction: 'down', label: '아래로 이동', row: row + 1, col },
        { direction: 'left', label: '왼쪽으로 이동', row, col: col - 1 },
      ];
      const candidate = candidates.find((entry) =>
        entry.row >= 0 && entry.row < 4 && entry.col >= 0 && entry.col < 4 &&
        !blocked.has(`${entry.row},${entry.col}`)
      );
      const button = candidate
        ? [...document.querySelectorAll('button')].find(
            (node) => node.getAttribute('aria-label') === candidate.label
          )
        : null;
      button?.click();
      return candidate?.direction || null;
    });
    if (!requestedRoll) throw new Error('주사위 굴림용 이동 가능한 방향을 찾지 못함');
    await page.waitForFunction(() =>
      document.querySelector('[data-dice-piece=true]')?.getAttribute('data-roll-direction') !== 'idle'
    );
    await page.waitForFunction(() =>
      document.querySelector('[data-testid=dice-wormhole-board] canvas')
        ?.getAttribute('data-dice-animation') === 'roll'
    );
    const rollAnimation = await diceRoom.evaluate((room) => {
      const piece = room.querySelector('[data-dice-piece=true]');
      const canvas = room.querySelector('canvas');
      return {
        direction: piece?.getAttribute('data-roll-direction'),
        piece: piece ? getComputedStyle(piece).animationName : '',
        cube: piece ? getComputedStyle(piece.querySelector('.dice-wormhole-cube')).animationName : '',
        canvasAnimation: canvas?.getAttribute('data-dice-animation'),
        canvasDirection: canvas?.getAttribute('data-dice-roll-direction'),
      };
    });
    if (
      rollAnimation.direction !== requestedRoll ||
      !rollAnimation.piece.includes('dice-wormhole-step') ||
      !rollAnimation.cube.includes(`dice-wormhole-cube-roll-${requestedRoll}`) ||
      rollAnimation.canvasAnimation !== 'roll' ||
      rollAnimation.canvasDirection !== requestedRoll
    ) {
      throw new Error(`주사위 방향별 굴림 애니메이션 오류: ${JSON.stringify(rollAnimation)}`);
    }
    await page.waitForTimeout(700);
    await page.screenshot({ path: path.join(OUT, 'practice-dice-wormhole-six-face.png') });
    ok('외부 보드 흡입 후 내부 전환 · 목표칸 주사위 눈 · 닫힌 6면 굴림 · 힌트 없음');

    if (errors.length > 0) throw new Error(`브라우저 오류: ${errors.join(' | ')}`);
    console.log('PASS: AI 연습 대전 E2E');
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
