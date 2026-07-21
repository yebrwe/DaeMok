#!/usr/bin/env node

'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const { chromium } = require('playwright');

if (process.env.EMULATOR !== '1') {
  console.error('This E2E may only run against Firebase emulators. Set EMULATOR=1.');
  process.exit(1);
}

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'e2e-artifacts');
const BASE_URL = process.env.BASE_URL || 'http://127.0.0.1:3215';
const EXPECTED_MAZE_TOON_VERSION = 'inked-toy-v3';
const EXPECTED_MAZE_ASSET_VERSION = 'blender-cartoon-v1';
const EXPECTED_MAZE_ASSET_CATALOG_COUNT = 29;
const EXPECTED_MAIN_ASSET_COUNT = 25;
const STAMP = Date.now();
const ROOM_NAME = `권위완주-${String(STAMP).slice(-6)}`;
const ACCOUNTS = {
  a: { email: `maze-authority-a-${STAMP}@example.com`, name: '토끼A' },
  b: { email: `maze-authority-b-${STAMP}@example.com`, name: '토끼B' },
  c: { email: `maze-authority-c-${STAMP}@example.com`, name: '관전자C' },
};
const functionsRequire = createRequire(path.join(ROOT, 'functions/package.json'));
const { deleteApp, initializeApp } = functionsRequire('firebase-admin/app');
const { getDatabase } = functionsRequire('firebase-admin/database');

fs.mkdirSync(OUT, { recursive: true });

function step(message) {
  console.log(`STEP: ${message}`);
}

async function signInWithFakeGoogle(page, account) {
  await page.goto(`${BASE_URL}/login`, { waitUntil: 'domcontentloaded' });
  const popupPromise = page.waitForEvent('popup');
  await page.getByRole('button', { name: /Google 계정으로 시작하기/i }).click();
  const popup = await popupPromise;
  await popup.waitForLoadState('domcontentloaded');
  await popup.getByRole('button', { name: /add new account/i }).click();
  await popup.locator('#email-input').fill(account.email);
  await popup.locator('#display-name-input').fill(account.name);
  await popup.getByRole('button', { name: /sign in with google/i }).click();
  await page.getByRole('button', { name: '새 게임 방 만들기' }).waitFor({ timeout: 25_000 });
}

async function selectEndpoints(page) {
  await page.getByText('시작점을 선택하세요', { exact: false }).first()
    .waitFor({ state: 'visible', timeout: 20_000 });
  await page.locator('[data-cell="0,0"]').click();
  await page.getByText('도착점을 선택하세요', { exact: false }).first()
    .waitFor({ state: 'visible', timeout: 10_000 });
  await page.locator('[data-cell="0,2"]').click();
  await page.getByText('벽(장애물)을 배치하세요', { exact: false }).first()
    .waitFor({ state: 'visible', timeout: 10_000 });
  assert.equal(
    await page.getByRole('button', { name: /붕괴벽|거울벽|탐지기/ }).count(),
    0,
    'retired walls and radar must not appear in the new-map palette',
  );
  assert.equal(
    await page.getByRole('tab', { name: '스킬' }).count(),
    0,
    'skills must not appear in the new-map editor',
  );
}

async function submitSimpleMap(page) {
  await selectEndpoints(page);
  const complete = page.getByRole('button', { name: '완료', exact: true });
  await page.waitForFunction(() => {
    const candidate = Array.from(document.querySelectorAll('button'))
      .find((entry) => entry.textContent?.trim() === '완료');
    return candidate instanceof HTMLButtonElement && !candidate.disabled;
  }, undefined, { timeout: 10_000 });
  await complete.click();
  await page.getByText('내 미로 준비 완료!', { exact: false }).first()
    .waitFor({ state: 'visible', timeout: 20_000 });
}

async function submitFakeWallMap(page) {
  await selectEndpoints(page);
  await page.getByRole('button', { name: /가짜벽/ }).first().click();
  await page.getByRole('button', { name: '1행 1열 right 벽' }).click();
  await page.getByRole('button', { name: '완료', exact: true }).click();
  await page.getByText('내 미로 준비 완료!', { exact: false }).first()
    .waitFor({ state: 'visible', timeout: 20_000 });
}

async function expectBoardPosition(page, position) {
  await page.locator(
    `[data-player-board][data-my-player="true"][data-player-position="${position}"]`,
  ).waitFor({ state: 'visible', timeout: 20_000 });
}

async function expectMoveCount(page, count) {
  const board = page.locator('[data-player-board][data-my-player="true"]');
  await board.getByText(new RegExp(`(?:이동|턴):\\s*${count}(?:\\D|$)`)).first()
    .waitFor({ state: 'visible', timeout: 20_000 });
}

async function moveRight(page) {
  await page.bringToFront();
  const button = page.getByRole('button', { name: '이동 오른쪽', exact: true });
  await button.waitFor({ state: 'visible', timeout: 20_000 });
  await page.waitForFunction(() => {
    const candidate = Array.from(document.querySelectorAll('button'))
      .find((entry) => entry.getAttribute('aria-label') === '이동 오른쪽');
    return candidate instanceof HTMLButtonElement && !candidate.disabled;
  }, undefined, { timeout: 20_000 });
  const hitTarget = await button.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    const top = document.elementFromPoint(x, y);
    return {
      rect: { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom },
      insideViewport: x >= 0 && x <= window.innerWidth && y >= 0 && y <= window.innerHeight,
      receivesPointer: top === element || (top !== null && element.contains(top)),
      topTag: top?.tagName ?? null,
      topLabel: top?.getAttribute('aria-label') ?? null,
    };
  });
  assert.equal(
    hitTarget.insideViewport && hitTarget.receivesPointer,
    true,
    `right control is not pointer-accessible: ${JSON.stringify(hitTarget)}`,
  );
  await button.evaluate((element) => element.click());
}

async function expectBoardCount(page, count) {
  const boards = page.locator('[data-player-board]');
  try {
    await boards.nth(count - 1).waitFor({ state: 'visible', timeout: 30_000 });
  } catch (error) {
    const body = await page.locator('body').innerText().catch(() => '(body unavailable)');
    throw new Error(
      `board mount timed out: expected=${count}, actual=${await boards.count()}, ` +
      `url=${page.url()}, body=${body.slice(0, 1200)}`,
      { cause: error },
    );
  }
  assert.equal(await boards.count(), count);
}

async function expectRendered3DBoards(page, count, label) {
  const canvases = page.locator('[data-player-board] canvas');
  const mobile = (page.viewportSize()?.width ?? 1280) < 640;
  const minimumCanvasWidth = mobile ? 120 : 280;
  const minimumCanvasHeight = mobile ? 180 : 240;
  await canvases.nth(count - 1).waitFor({ state: 'visible', timeout: 20_000 });
  assert.equal(await canvases.count(), count, `${label}: 3D canvas count`);

  for (let index = 0; index < count; index += 1) {
    const canvas = canvases.nth(index);
    try {
      await page.waitForFunction(({
        canvasIndex,
        expectedVersion,
        expectedAssetVersion,
        expectedCatalogCount,
        expectedMainAssetCount,
      }) => {
        const candidate = document.querySelectorAll('[data-player-board] canvas')[canvasIndex];
        if (!(candidate instanceof HTMLCanvasElement)) return false;
        const rect = candidate.getBoundingClientRect();
        const mobile = window.innerWidth < 640;
        const materialCount = Number(candidate.dataset.mazeToonMaterials);
        const drawCalls = Number(candidate.dataset.mazeToonDrawCalls);
        return rect.width >= (mobile ? 120 : 280) && rect.height >= (mobile ? 180 : 240) &&
          candidate.width > 0 && candidate.height > 0 &&
          candidate.dataset.mazeCamera === 'fixed-orthographic' &&
          candidate.dataset.mazeToonVersion === expectedVersion &&
          candidate.dataset.mazeAssetState === 'ready' &&
          candidate.dataset.mazeAssetVersion === expectedAssetVersion &&
          Number(candidate.dataset.mazeAssetCount) === expectedMainAssetCount &&
          Number(candidate.dataset.mazeAssetCatalogCount) === expectedCatalogCount &&
          candidate.dataset.mazeAssetSet === 'main' &&
          Number.isFinite(materialCount) && materialCount > 0 &&
          Number.isFinite(drawCalls) && drawCalls > 0 && drawCalls <= 600;
      }, {
        canvasIndex: index,
        expectedVersion: EXPECTED_MAZE_TOON_VERSION,
        expectedAssetVersion: EXPECTED_MAZE_ASSET_VERSION,
        expectedCatalogCount: EXPECTED_MAZE_ASSET_CATALOG_COUNT,
        expectedMainAssetCount: EXPECTED_MAIN_ASSET_COUNT,
      }, { timeout: 30_000 });
    } catch (error) {
      const diagnostics = await canvases.evaluateAll((entries) => entries.map((entry) => {
        const rect = entry.getBoundingClientRect();
        return {
          cssWidth: rect.width,
          cssHeight: rect.height,
          pixelWidth: entry.width,
          pixelHeight: entry.height,
          camera: entry.dataset.mazeCamera,
          toonVersion: entry.dataset.mazeToonVersion,
          materials: entry.dataset.mazeToonMaterials,
          drawCalls: entry.dataset.mazeToonDrawCalls,
          assetState: entry.dataset.mazeAssetState,
          assetVersion: entry.dataset.mazeAssetVersion,
          assetCount: entry.dataset.mazeAssetCount,
          assetCatalogCount: entry.dataset.mazeAssetCatalogCount,
          assetSet: entry.dataset.mazeAssetSet,
        };
      }));
      throw new Error(`${label}: 3D canvas readiness timed out: ${JSON.stringify(diagnostics)}`, {
        cause: error,
      });
    }

    const bounds = await canvas.boundingBox();
    assert.ok(bounds, `${label} board ${index + 1}: canvas bounds`);
    assert.ok(
      bounds.width >= minimumCanvasWidth && bounds.height >= minimumCanvasHeight,
      `${label} board ${index + 1}: canvas must not collapse (${bounds.width}x${bounds.height})`,
    );

    // Locator screenshot captures the browser-composited WebGL frame. Canvas.toDataURL()
    // is unreliable because R3F does not enable preserveDrawingBuffer.
    const png = await canvas.screenshot({ animations: 'disabled' });
    const stats = await page.evaluate(async (base64) => {
      const image = new Image();
      image.src = `data:image/png;base64,${base64}`;
      await image.decode();
      const scratch = document.createElement('canvas');
      scratch.width = image.naturalWidth;
      scratch.height = image.naturalHeight;
      const context = scratch.getContext('2d', { willReadFrequently: true });
      if (!context) throw new Error('2D canvas context unavailable');
      context.drawImage(image, 0, 0);
      const pixels = context.getImageData(0, 0, scratch.width, scratch.height).data;
      const quantizedColors = new Set();
      let edgeCount = 0;
      let pairCount = 0;
      const offsetAt = (x, y) => (y * scratch.width + x) * 4;

      for (let y = 0; y < scratch.height; y += 2) {
        for (let x = 0; x < scratch.width; x += 2) {
          const offset = offsetAt(x, y);
          quantizedColors.add(
            ((pixels[offset] >> 4) << 8) |
            ((pixels[offset + 1] >> 4) << 4) |
            (pixels[offset + 2] >> 4),
          );
          for (const [nextX, nextY] of [[x + 2, y], [x, y + 2]]) {
            if (nextX >= scratch.width || nextY >= scratch.height) continue;
            const nextOffset = offsetAt(nextX, nextY);
            const delta = Math.max(
              Math.abs(pixels[offset] - pixels[nextOffset]),
              Math.abs(pixels[offset + 1] - pixels[nextOffset + 1]),
              Math.abs(pixels[offset + 2] - pixels[nextOffset + 2]),
            );
            if (delta >= 24) edgeCount += 1;
            pairCount += 1;
          }
        }
      }

      return {
        width: scratch.width,
        height: scratch.height,
        quantizedColors: quantizedColors.size,
        edgeRatio: edgeCount / Math.max(1, pairCount),
      };
    }, png.toString('base64'));

    assert.ok(
      stats.quantizedColors >= 32,
      `${label} board ${index + 1}: WebGL frame lacks color detail (${JSON.stringify(stats)})`,
    );
    assert.ok(
      stats.edgeRatio >= 0.015,
      `${label} board ${index + 1}: WebGL frame lacks maze edges (${JSON.stringify(stats)})`,
    );
    console.log(
      `  OK: ${label} board ${index + 1} canvas ${Math.round(bounds.width)}x${Math.round(bounds.height)}, ` +
      `colors=${stats.quantizedColors}, edge=${stats.edgeRatio.toFixed(4)}`,
    );
  }
}

async function poll(label, read, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  let lastValue;
  while (Date.now() < deadline) {
    lastValue = await read();
    if (lastValue) return lastValue;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`${label} timed out; last=${JSON.stringify(lastValue)}`);
}

(async () => {
  const browser = await chromium.launch({
    channel: process.env.CHROME_PATH ? undefined : 'chrome',
    executablePath: process.env.CHROME_PATH || undefined,
    headless: true,
    args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--use-angle=swiftshader'],
  });
  const contextA = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const contextB = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const contextC = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  let pageA = await contextA.newPage();
  let pageB = await contextB.newPage();
  const pageC = await contextC.newPage();
  const adminApp = initializeApp({
    projectId: 'daemok-155c1',
    databaseURL: 'http://127.0.0.1:9700/?ns=daemok-155c1-default-rtdb',
  }, `maze-authority-browser-${STAMP}`);
  const adminDatabase = getDatabase(adminApp);

  for (const [label, page] of [['A', pageA], ['B', pageB], ['C', pageC]]) {
    page.on('pageerror', (error) => console.error(`[${label} pageerror]`, error.message));
    page.on('console', (message) => {
      if (message.type() === 'error') console.error(`[${label} console]`, message.text());
    });
    page.on('response', async (response) => {
      if (response.status() < 400 || !/mazeV1/u.test(response.url())) return;
      console.error(
        `[${label} callable ${response.status()}]`,
        await response.text().catch(() => '(unreadable response)'),
      );
    });
  }

  try {
    step('sign in three isolated emulator users');
    await signInWithFakeGoogle(pageA, ACCOUNTS.a);
    await signInWithFakeGoogle(pageB, ACCOUNTS.b);

    step('create a reserved Authority room and submit a partial-budget map');
    await pageA.getByRole('button', { name: '새 게임 방 만들기' }).click();
    await pageA.fill('#roomName', ROOM_NAME);
    await pageA.getByRole('button', { name: '방 만들기' }).click();
    await pageA.waitForURL(/\/rooms\/mz1_[a-f0-9]{32}$/u, { timeout: 25_000 });
    const roomUrl = pageA.url();
    await submitSimpleMap(pageA);

    step('join as B, verify reset has no time limit, then submit a fake wall');
    const roomCardB = pageB.locator('[data-room-card]', { hasText: ROOM_NAME }).first();
    await roomCardB.waitFor({ state: 'visible', timeout: 20_000 });
    await roomCardB.getByRole('button', { name: '참가하기' }).click();
    await pageB.waitForURL(/\/rooms\/mz1_[a-f0-9]{32}$/u, { timeout: 25_000 });
    await submitFakeWallMap(pageB);
    await pageB.getByRole('button', { name: '다시 만들기' }).click();
    await submitFakeWallMap(pageB);

    step('start through the callable and prove voluntary leave/surrender are unavailable');
    const start = pageA.getByRole('button', { name: '게임 시작!', exact: true });
    await start.waitFor({ state: 'visible', timeout: 20_000 });
    await start.click();
    await expectBoardCount(pageA, 2);
    await expectBoardCount(pageB, 2);
    await expectRendered3DBoards(pageA, 2, 'mobile participant · all boards');
    await expectRendered3DBoards(pageB, 2, 'desktop participant');
    const leaveA = pageA.getByRole('button', { name: /나가기/ }).first();
    assert.equal(await leaveA.isDisabled(), true, 'PLAY leave must stay disabled');
    assert.equal(await pageA.getByRole('button', { name: /기권|포기/ }).count(), 0);
    assert.equal(await pageB.getByRole('button', { name: /기권|포기/ }).count(), 0);
    const canonical = (await adminDatabase.ref(`mazeAuthority/v1/rooms/${roomUrl.split('/').pop()}`).get()).val();
    const uidA = canonical.lobby.ownerId;
    const uidB = Object.keys(canonical.lobby.members).find((uid) => uid !== uidA);
    assert.ok(uidB, 'guest uid missing from canonical room');
    await poll('both participant presence rows to become online', async () => {
      const statuses = (await adminDatabase.ref(
        `mazePresence/v1/status/${canonical.meta.roomId}`,
      ).get()).val();
      return statuses?.[uidA]?.online === true && statuses?.[uidB]?.online === true
        ? statuses
        : null;
    });

    step('spectator receives only boundary maps while the cute 3D board renders');
    await signInWithFakeGoogle(pageC, ACCOUNTS.c);
    const roomCardC = pageC.locator('[data-room-card]', { hasText: ROOM_NAME }).first();
    await roomCardC.getByRole('button', { name: '관전하기' }).click();
    await pageC.waitForURL(/\/rooms\/mz1_[a-f0-9]{32}$/u, { timeout: 20_000 });
    await pageC.bringToFront();
    await expectBoardCount(pageC, 2);
    await expectRendered3DBoards(pageC, 2, 'desktop spectator');
    assert.equal(await pageC.locator('[data-map-item]').count(), 0, 'spectator DOM leaked a secret item');
    await pageA.screenshot({ path: path.join(OUT, 'maze-authority-cute-mobile.png'), fullPage: true });

    step('fake wall blocks once, then the offline B turn is skipped after exactly the grace window');
    await moveRight(pageA);
    await expectMoveCount(pageA, 1);
    await expectBoardPosition(pageA, '0,0');
    const afterFakeWall = await poll('fake-wall turn to rotate to B', async () => {
      const value = (await adminDatabase.ref(
        `mazeAuthority/v1/rooms/${canonical.meta.roomId}/gameState`,
      ).get()).val();
      return value?.currentTurn === uidB && value?.turnNumber === 2 ? value : null;
    });
    assert.equal(afterFakeWall.players[uidA].moves, 1);
    assert.deepEqual(afterFakeWall.players[uidA].position, { row: 0, col: 0 });
    assert.equal(afterFakeWall.players[uidA].finished, false);
    assert.equal(afterFakeWall.players[uidB].finished, false);
    const projectedAfterFakeWall = (await adminDatabase.ref(
      `mazeViews/v1/publicRooms/${canonical.meta.roomId}/gameState`,
    ).get()).val();
    const projectedCollisions = Array.isArray(projectedAfterFakeWall?.collisionWalls)
      ? projectedAfterFakeWall.collisionWalls.filter(Boolean)
      : Object.values(projectedAfterFakeWall?.collisionWalls || {});
    assert.equal(projectedCollisions.length, 1);
    assert.equal(typeof projectedCollisions[0].timestamp, 'number');
    assert.deepEqual(projectedCollisions[0], {
      playerId: uidA,
      position: { row: 0, col: 0 },
      direction: 'right',
      timestamp: projectedCollisions[0].timestamp,
      mapOwnerId: uidB,
    }, 'the consumed fake wall must remain an opaque ordinary collision in the public view');
    await pageB.close();
    await pageA.bringToFront();
    const offlineStatus = await poll('B presence to become stably offline', async () => {
      const [connections, status] = await Promise.all([
        adminDatabase.ref(`mazePresence/v1/rooms/${canonical.meta.roomId}/${uidB}`).get(),
        adminDatabase.ref(`mazePresence/v1/status/${canonical.meta.roomId}/${uidB}`).get(),
      ]);
      return connections.val() == null && status.val()?.online === false ? status.val() : null;
    });
    assert.equal(offlineStatus.online, false);
    try {
      await pageA.getByText('재접속을 45초 동안 기다리고 있어요', { exact: false }).first()
        .waitFor({ state: 'visible', timeout: 20_000 });
    } catch (error) {
      console.error('A BODY AFTER OFFLINE', await pageA.locator('body').innerText());
      await pageA.screenshot({
        path: path.join(OUT, 'maze-authority-offline-notice-failure.png'),
        fullPage: true,
      });
      throw error;
    }
    try {
      await pageA.getByText('플레이 상태는 그대로 두고 턴만', { exact: false }).first()
        .waitFor({ state: 'visible', timeout: 90_000 });
    } catch (error) {
      console.error('A BODY AFTER GRACE', await pageA.locator('body').innerText());
      throw error;
    }

    step('B reconnects before its next turn so no later turn is auto-skipped');
    pageB = await contextB.newPage();
    await pageB.goto(roomUrl, { waitUntil: 'domcontentloaded' });
    await pageB.bringToFront();
    await expectBoardCount(pageB, 2);
    await poll('B presence to recover before A hands over the turn', async () => {
      const status = await adminDatabase.ref(
        `mazePresence/v1/status/${canonical.meta.roomId}/${uidB}`,
      ).get();
      return status.val()?.online === true ? status.val() : null;
    });
    await moveRight(pageA);
    await expectMoveCount(pageA, 2);
    await expectBoardPosition(pageA, '0,1');

    step('the reconnected B resumes at the same position and both players must actually finish');
    await moveRight(pageB);
    await expectMoveCount(pageB, 1);
    await moveRight(pageA);
    await expectMoveCount(pageA, 3);
    await pageA.getByText('마지막 미완주 플레이어', { exact: false }).first()
      .waitFor({ state: 'visible', timeout: 5_000 }).catch(() => null);

    step('the final unfinished runner cannot be skipped into a synthetic result');
    await pageB.close();
    await pageA.bringToFront();
    await poll('final runner to remain canonical and stably offline', async () => {
      const [connections, status, gameState] = await Promise.all([
        adminDatabase.ref(`mazePresence/v1/rooms/${canonical.meta.roomId}/${uidB}`).get(),
        adminDatabase.ref(`mazePresence/v1/status/${canonical.meta.roomId}/${uidB}`).get(),
        adminDatabase.ref(`mazeAuthority/v1/rooms/${canonical.meta.roomId}/gameState`).get(),
      ]);
      const state = gameState.val();
      return connections.val() == null &&
        status.val()?.online === false &&
        state?.phase === 'play' &&
        state?.currentTurn === uidB &&
        state?.players?.[uidA]?.finished === true &&
        state?.players?.[uidB]?.finished === false
        ? { status: status.val(), state }
        : null;
    }, 30_000);
    await pageA.getByRole('status').filter({ hasText: '마지막 미완주 플레이어예요' }).first()
      .waitFor({ state: 'visible', timeout: 20_000 });
    assert.equal(await pageA.getByText('경기 결과가 서버에 확정됐어요', { exact: false }).count(), 0);
    pageB = await contextB.newPage();
    await pageB.goto(roomUrl, { waitUntil: 'domcontentloaded' });
    await pageB.bringToFront();
    await expectBoardCount(pageB, 2);
    await moveRight(pageB);
    await pageA.getByText('다음 판에는 더 짧은 길로!', { exact: false }).first()
      .waitFor({ state: 'visible', timeout: 20_000 });
    await pageB.getByText('내 토끼가 가장 짧은 기록을 만들었어요!', { exact: false }).first()
      .waitFor({ state: 'visible', timeout: 20_000 });
    await pageC.getByText('경기가 끝났어요!', { exact: false }).first()
      .waitFor({ state: 'visible', timeout: 20_000 });

    step('owner closes the terminal room');
    await pageA.getByRole('button', { name: '방 닫기' }).click();
    await pageA.waitForURL(/\/rooms$/u, { timeout: 20_000 });

    console.log('MAZE AUTHORITY BROWSER E2E: PASS');
  } finally {
    await browser.close();
    await deleteApp(adminApp);
  }
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
