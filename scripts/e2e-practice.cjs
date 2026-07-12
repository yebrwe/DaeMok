/**
 * 로컬 AI 연습 대전 E2E.
 * 실행: npm run dev 후 node scripts/e2e-practice.cjs
 */
/* eslint-disable @typescript-eslint/no-require-imports */
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

async function expectBoardCount(page, expected) {
  const boards = page.locator('[data-player-board]');
  await boards.nth(expected - 1).waitFor({ timeout: 15000 });
  const count = await boards.count();
  if (count !== expected) throw new Error(`보드 수 불일치: expected=${expected}, actual=${count}`);
  ok(`보드 ${expected}개`);
}

async function waitForHumanTurn(page) {
  await page.waitForFunction(
    () => document.querySelector('[data-current-turn=true]')?.getAttribute('data-player-board') === 'practice-user',
    null,
    { timeout: 15000 }
  );
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
      buttons: [...document.querySelectorAll('[data-testid=practice-controls] button')].map((button) => {
        const rect = button.getBoundingClientRect();
        return { width: rect.width, height: rect.height };
      }),
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
    for (const itemType of ['oneTimeWall', 'mine', 'smoke']) {
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
    await expectResponsiveBounds(page, 'iphone-15', 393, 852);
    const viewport = await page.locator('meta[name=viewport]').getAttribute('content');
    if (!viewport?.includes('viewport-fit=cover')) throw new Error(`viewport-fit 누락: ${viewport}`);
    ok('iPhone 안전영역 viewport-fit');

    console.log('STEP 5: 경기 완료와 순위 정산');
    const humanRoute = [
      'ArrowDown', 'ArrowDown', 'ArrowDown', 'ArrowDown', 'ArrowDown', 'ArrowDown', 'ArrowDown',
      'ArrowRight', 'ArrowRight', 'ArrowRight', 'ArrowRight', 'ArrowRight', 'ArrowRight',
    ];
    for (const [index, key] of humanRoute.entries()) {
      await waitForHumanTurn(page);
      if (index === 6) {
        const obscuredBoard = page.locator(
          '[data-player-board="practice-user"][data-vision-effect="smoke"][data-vision-obscured="true"]'
        );
        await obscuredBoard.waitFor({ timeout: 5000 });
        const overlay = obscuredBoard.locator('[data-testid=board-obscure-overlay]');
        await overlay.waitFor();
        const overlayText = await overlay.innerText();
        if (!overlayText.includes('연막으로 시야 차단') || !overlayText.includes('이번 행동 후 해제')) {
          throw new Error(`연막 안내 문구 오류: ${overlayText}`);
        }
        if (await page.getByRole('button', { name: '아래로 이동' }).isDisabled()) {
          throw new Error('연막 상태에서 방향 조작이 비활성화됨');
        }
        const [boardBox, overlayBox] = await Promise.all([obscuredBoard.boundingBox(), overlay.boundingBox()]);
        if (
          !boardBox ||
          !overlayBox ||
          overlayBox.x < boardBox.x ||
          overlayBox.y < boardBox.y + 20 ||
          overlayBox.x + overlayBox.width > boardBox.x + boardBox.width ||
          overlayBox.y + overlayBox.height > boardBox.y + boardBox.height
        ) {
          throw new Error(`연막 오버레이 범위 오류: board=${JSON.stringify(boardBox)}, overlay=${JSON.stringify(overlayBox)}`);
        }
        await page.screenshot({ path: path.join(OUT, 'practice-smoke-iphone-15.png') });
        ok('연막 발동 후 다음 사람 차례만 시야 차단');
      }
      const beforeMoves = await boardMoves(page, 'practice-user');
      await page.keyboard.press(key);
      try {
        await page.waitForFunction(
          (moves) => {
            const text = document.querySelector('[data-player-board="practice-user"]')?.textContent || '';
            const currentMoves = Number(text.match(/턴:\s*(\d+)/)?.[1] || -1);
            return currentMoves > moves || !!document.querySelector('[data-testid=practice-result]');
          },
          beforeMoves,
          { timeout: 5000 }
        );
      } catch (error) {
        const position = await page.locator('[data-player-board="practice-user"]').getAttribute('data-player-position');
        throw new Error(`사람 경로 ${index + 1}/${humanRoute.length} ${key} 처리 실패 (position=${position}, moves=${beforeMoves}): ${error.message}`);
      }
      if (index === 6 && await page.locator('[data-vision-obscured="true"]').count() > 0) {
        throw new Error('유효 행동 후 연막 시야 차단이 해제되지 않음');
      }
    }
    await page.locator('[data-testid=practice-result]').waitFor({ timeout: 45000 });
    const resultText = await page.locator('[data-testid=practice-result]').innerText();
    if (!resultText.includes('위') || !resultText.includes('턴') || !resultText.includes('재대결')) {
      throw new Error(`결과 정산 UI 오류: ${resultText}`);
    }
    ok('전원 완주 후 순위 결과');

    console.log('STEP 6: AI 수와 직접 만든 맵');
    await page.getByRole('button', { name: 'AI 설정' }).last().click();
    await page.getByRole('radio', { name: 'AI 1명' }).click();
    await page.getByRole('button', { name: '빠른 대전' }).click();
    await expectBoardCount(page, 2);
    const twoBoardBoxes = await page.locator('[data-player-board]').evaluateAll((nodes) => nodes.map((node) => node.getBoundingClientRect().top));
    if (!(twoBoardBoxes[1] > twoBoardBoxes[0])) throw new Error(`모바일 2인 세로 배치 실패: ${twoBoardBoxes}`);

    await page.getByRole('button', { name: 'AI 설정' }).click();
    await page.getByRole('radio', { name: 'AI 2명' }).click();
    await page.getByRole('button', { name: '맵 만들기' }).click();
    await page.locator('[data-cell="0,0"]').click();
    await page.locator('[data-cell="0,2"]').click();
    await page.getByRole('button', { name: /연막 함정/ }).click();
    await page.locator('[data-cell="0,1"]').click();
    const setupText = await page.locator('body').innerText();
    if (!setupText.includes('연막 함정 배치됨')) throw new Error('연막 함정 제작 상태가 표시되지 않음');
    await page.getByRole('button', { name: '완료' }).click();
    await expectBoardCount(page, 3);
    ok('직접 만든 맵 + AI 2명');

    if (errors.length > 0) throw new Error(`브라우저 오류: ${errors.join(' | ')}`);
    console.log('PASS: AI 연습 대전 E2E');
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
