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
    const board = document.querySelector(selector);
    if (!pad || !board) return { missing: true };
    const padRect = pad.getBoundingClientRect();
    const boardRect = board.getBoundingClientRect();
    const buttons = Object.fromEntries(
      [...pad.querySelectorAll('button')].map((button) => [
        button.getAttribute('aria-label'),
        button.getBoundingClientRect().toJSON(),
      ])
    );
    return {
      missing: false,
      inside:
        padRect.left >= boardRect.left - 1 && padRect.right <= boardRect.right + 1 &&
        padRect.top >= boardRect.top - 1 && padRect.bottom <= boardRect.bottom + 1,
      buttons,
    };
  }, { testId, boardSelector });
  if (result.missing || !result.inside) throw new Error(`십자 방향키가 내 보드 밖에 있음: ${JSON.stringify(result)}`);
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
  ok(`${testId} 십자 배열과 44px 터치 영역`);
}

async function expectLocatorCanvasNonBlank(page, locator, label) {
  await locator.waitFor({ timeout: 15000 });
  await page.waitForTimeout(700);
  const image = PNG.sync.read(await locator.screenshot());
  let min = 255;
  let max = 0;
  for (let offset = 0; offset < image.data.length; offset += 4) {
    const lightness = Math.round((image.data[offset] + image.data[offset + 1] + image.data[offset + 2]) / 3);
    min = Math.min(min, lightness);
    max = Math.max(max, lightness);
  }
  if (max - min < 15) throw new Error(`${label} 캔버스가 비어 있음: range=${max - min}`);
  ok(`${label} 캔버스 nonblank`);
}

async function setupFullBudgetPracticeMap(page, { verifyPreview = false } = {}) {
  await page.locator('[data-cell="0,0"]').click();
  await page.locator('[data-cell="0,2"]').click();
  await page.setViewportSize({ width: 360, height: 800 });
  await page.waitForTimeout(150);

  const completeButton = page.getByRole('button', { name: '완료', exact: true });
  if (await completeButton.isEnabled()) throw new Error('0/24 연습 맵에서 완료 버튼이 활성화됨');
  await page.locator('[data-testid=full-budget-required]').waitFor();

  await page.getByRole('tab', { name: '스킬' }).click();
  await page.getByRole('button', { name: /질주/ }).first().click();
  await page.getByRole('tab', { name: '함정' }).click();
  await page.getByRole('button', { name: /연막 함정/ }).click();
  await page.locator('[data-cell="0,1"]').click();

  await page.getByRole('tab', { name: '특수벽' }).click();
  await page.getByRole('button', { name: /화염벽/ }).click();
  const firePreview = page.locator('[data-testid=wall-effect-preview]');
  await firePreview.waitFor();
  if (verifyPreview) {
    const firstFrame = await firePreview.getAttribute('data-preview-frame');
    await page.locator('[data-testid=wall-preview-2d]').waitFor();
    const preview3d = page.locator('[data-testid=wall-preview-3d] canvas');
    await expectLocatorCanvasNonBlank(page, preview3d, '특수벽 Three.js 미리보기');
    await page.waitForFunction(
      (frame) => document.querySelector('[data-testid=wall-effect-preview]')?.getAttribute('data-preview-frame') !== frame,
      firstFrame,
      { timeout: 3500 }
    );
    const previewBounds = await firePreview.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      const closeRect = element.querySelector('button')?.getBoundingClientRect();
      return {
        left: rect.left,
        top: rect.top,
        right: rect.right,
        bottom: rect.bottom,
        close: closeRect ? { width: closeRect.width, height: closeRect.height } : null,
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
      };
    });
    if (
      previewBounds.left < 0 || previewBounds.top < 0 || previewBounds.right > 360 ||
      previewBounds.bottom > 800 || previewBounds.scrollWidth !== previewBounds.clientWidth
      || !previewBounds.close || previewBounds.close.width < 44 || previewBounds.close.height < 44
    ) {
      throw new Error(`Galaxy S21 벽 미리보기 범위 오류: ${JSON.stringify(previewBounds)}`);
    }
    await page.screenshot({ path: path.join(OUT, 'practice-wall-preview-galaxy-s21.png') });
    ok('2D/Three.js 벽 효과 프레임 애니메이션');
  }
  await page.getByRole('button', { name: '벽 효과 미리보기 닫기' }).click();
  await page.getByRole('button', { name: '1행 1열 right 벽', exact: true }).click();

  if (verifyPreview) {
    const windButton = page.getByRole('button', { name: /바람벽/ }).first();
    await windButton.click();
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
      windLayout.description.bottom > windLayout.controls.top
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
    ok('Galaxy S21 바람벽 설명 전체 표시와 방향 버튼');
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
  ok(`보드 ${expected}개`);
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

async function expectResponsiveBounds(page, name, width, height) {
  await page.setViewportSize({ width, height });
  await page.waitForTimeout(150);
  const result = await page.evaluate(() => {
    const nodes = [
      ...document.querySelectorAll('[data-player-board]'),
      document.querySelector('[data-testid=practice-controls]'),
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

async function expect2DBoardsFitted(page, label, expected) {
  await page.waitForFunction(
    (count) => document.querySelectorAll('[data-testid="board-2d-viewport"]').length === count,
    expected
  );
  await page.waitForTimeout(150);
  const results = await page.locator('[data-player-board]').evaluateAll((boards) => boards.map((board) => {
    const viewport = board.querySelector('[data-testid="board-2d-viewport"]');
    const surface = board.querySelector('[data-testid="board-2d-surface"]');
    const grid = surface?.querySelector('.grid.border-4');
    if (!viewport || !surface || !grid) return { missing: true };
    const viewportRect = viewport.getBoundingClientRect();
    const gridRect = grid.getBoundingClientRect();
    return {
      missing: false,
      scale: Number(surface.getAttribute('data-board-scale')),
      inside:
        gridRect.left >= viewportRect.left - 1 &&
        gridRect.right <= viewportRect.right + 1 &&
        gridRect.top >= viewportRect.top - 1 &&
        gridRect.bottom <= viewportRect.bottom + 1,
      viewport: viewportRect.toJSON(),
      grid: gridRect.toJSON(),
    };
  }));
  if (
    results.length !== expected ||
    results.some((result) => result.missing || !result.inside || !(result.scale > 0 && result.scale <= 1))
  ) {
    throw new Error(`${label} 2D 보드 맞춤 오류: ${JSON.stringify(results)}`);
  }
  ok(`${label} 2D 보드 ${expected}개 상하좌우 전체 표시`);
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

(async () => {
  const browser = await chromium.launch({
    channel: process.env.CHROME_PATH ? undefined : 'chrome',
    executablePath: process.env.CHROME_PATH || undefined,
    headless: true,
    args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--use-angle=swiftshader'],
  });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
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
    const ownerPreview = page.locator('[data-player-board][data-map-owner-preview="true"]');
    if (await ownerPreview.count() !== 1) throw new Error('내가 만든 맵의 제작자 시점 보드가 하나가 아님');
    for (const itemType of ['oneTimeWall', 'mine', 'smoke', 'thornWall', 'crystalWall']) {
      if (await ownerPreview.locator(`[data-map-item="${itemType}"]`).count() === 0) {
        throw new Error(`제작자 시점에서 ${itemType} 아이템이 보이지 않음`);
      }
    }
    if (await ownerPreview.locator('[data-map-item="oneTimeWall"] .bg-cyan-400').count() < 3) {
      throw new Error('제작자 시점의 가짜벽이 청록색 분절 벽으로 구분되지 않음');
    }
    if (await page.locator('[data-player-board][data-my-player="true"] [data-map-item]').count() !== 0) {
      throw new Error('주자 시점에 상대 맵의 비밀 아이템 DOM이 노출됨');
    }
    ok('제작자 보드만 함정 공개 + 가짜벽 분절 표시');
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

    console.log('STEP 3: 3D 4보드 렌더링');
    await page.getByRole('button', { name: '3D 보드' }).click();
    await expectNonBlankCanvases(page, 4);
    await page.screenshot({ path: path.join(OUT, 'practice-owner-secrets-3d.png') });
    await page.getByRole('button', { name: '2D 보드' }).click();

    console.log('STEP 4: Galaxy S21 / iPhone 15');
    await expectResponsiveBounds(page, 'galaxy-s21', 360, 800);
    await expect2DBoardsFitted(page, 'Galaxy S21', 4);
    await expectCrossDpad(
      page,
      'practice-mobile-direction-pad',
      '[data-player-board="practice-user"]'
    );
    await expectResponsiveBounds(page, 'iphone-15', 393, 852);
    await expect2DBoardsFitted(page, 'iPhone 15', 4);
    const viewport = await page.locator('meta[name=viewport]').getAttribute('content');
    if (!viewport?.includes('viewport-fit=cover')) throw new Error(`viewport-fit 누락: ${viewport}`);
    ok('iPhone 안전영역 viewport-fit');

    console.log('STEP 5: 24/24 직접 만든 맵과 벽 효과 미리보기');
    await page.getByRole('button', { name: '연습 설정' }).click();
    await page.getByRole('radio', { name: 'AI 1명' }).click();
    await page.getByRole('button', { name: '빠른 대전' }).click();
    await expectBoardCount(page, 2);
    await page.setViewportSize({ width: 360, height: 640 });
    await expect2DBoardsFitted(page, '짧은 모바일 세로 화면', 2);
    await page.screenshot({ path: path.join(OUT, 'practice-2p-2d-short-portrait.png') });
    await page.setViewportSize({ width: 852, height: 393 });
    await expect2DBoardsFitted(page, '모바일 가로 화면', 2);
    await page.screenshot({ path: path.join(OUT, 'practice-2p-2d-landscape.png') });
    await page.setViewportSize({ width: 360, height: 800 });
    const twoBoardBoxes = await page.locator('[data-player-board]').evaluateAll((nodes) => nodes.map((node) => node.getBoundingClientRect().top));
    if (!(twoBoardBoxes[1] > twoBoardBoxes[0])) throw new Error(`모바일 2인 세로 배치 실패: ${twoBoardBoxes}`);

    await page.getByRole('button', { name: '연습 설정' }).click();
    await page.getByRole('radio', { name: 'AI 2명' }).click();
    await page.getByRole('button', { name: '맵 만들기' }).click();
    await setupFullBudgetPracticeMap(page, { verifyPreview: true });
    await expectBoardCount(page, 3);
    ok('24/24 직접 만든 맵 + AI 2명');

    console.log('STEP 6: 내 맵 단독 테스트와 연속 턴');
    await page.getByRole('button', { name: '연습 설정' }).click();
    await page.getByRole('button', { name: '내 맵 테스트' }).click();
    await setupFullBudgetPracticeMap(page);
    await expectBoardCount(page, 1);
    const match = page.locator('[data-testid=practice-match]');
    if (
      (await match.getAttribute('data-practice-mode')) !== 'mapTest' ||
      (await match.getAttribute('data-ai-count')) !== '0'
    ) {
      throw new Error('내 맵 테스트가 AI 없는 단독 모드로 시작되지 않음');
    }
    const ownBoard = page.locator('[data-player-board="practice-user"]');
    if (await ownBoard.locator('[data-map-item="fireWall"]').count() === 0) {
      throw new Error('내 맵 테스트 제작자 시점에서 특수벽이 보이지 않음');
    }
    await expectCrossDpad(page, 'practice-mobile-direction-pad', '[data-player-board="practice-user"]');
    const dpad = page.locator('[data-testid=practice-mobile-direction-pad]');
    await dpad.getByRole('button', { name: '오른쪽으로 이동' }).click();
    await page.waitForFunction(() => {
      const text = document.querySelector('[data-player-board="practice-user"]')?.textContent || '';
      return Number(text.match(/턴:\s*(\d+)/)?.[1] || 0) >= 2;
    });
    if ((await ownBoard.getAttribute('data-current-turn')) !== 'true') {
      throw new Error('내 맵 테스트에서 한 행동 뒤 턴이 AI로 넘어감');
    }
    await dpad.getByRole('button', { name: '오른쪽으로 이동' }).click();
    await page.waitForFunction(() => {
      const text = document.querySelector('[data-player-board="practice-user"]')?.textContent || '';
      return Number(text.match(/턴:\s*(\d+)/)?.[1] || 0) >= 3;
    });
    ok('내 맵을 제작자 시점으로 AI 대기 없이 연속 테스트');

    if (errors.length > 0) throw new Error(`브라우저 오류: ${errors.join(' | ')}`);
    console.log('PASS: AI 연습 대전 E2E');
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
