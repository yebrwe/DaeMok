/**
 * Firebase 에뮬레이터 기반 실시간 모험 전장 E2E.
 * 실행: NEXT_PUBLIC_FIREBASE_EMULATOR=1 빌드/서버 + auth,database emulator
 *       EMULATOR=1 node scripts/e2e-adventure.cjs
 */
'use strict';

const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const fs = require('node:fs');
const path = require('node:path');
const sharp = require('sharp');

if (process.env.EMULATOR !== '1') {
  console.error('이 테스트는 Firebase 에뮬레이터 전용입니다. EMULATOR=1을 설정하세요.');
  process.exit(1);
}

const BASE_URL = process.env.BASE_URL || 'http://127.0.0.1:3000';
const DATABASE_URL = process.env.FIREBASE_DATABASE_EMULATOR_URL || 'http://127.0.0.1:9000';
const DATABASE_NAMESPACE = process.env.FIREBASE_DATABASE_NAMESPACE || 'daemok-155c1-default-rtdb';
const OUT = path.join(__dirname, '..', 'e2e-artifacts');
const STAMP = Date.now();
const ACCOUNT = {
  email: `adventure-e2e-${STAMP}@example.com`,
  displayName: `Adventure E2E ${String(STAMP).slice(-5)}`,
};
const CHARACTER_NAME = `전장검증${String(STAMP).slice(-4)}`;
const RESET_CHARACTER_NAME = `재시작${String(STAMP).slice(-4)}`;
const SKILL_SHORTCUTS = ['Q', 'E', 'R', 'F', '1', '2'];
const ARENA_3D_SELECTOR = '[data-testid="hackslash-arena-3d"]';
const TOWN_SELECTOR = '[data-testid="adventure-town"]';
const TOWN_HUB_SELECTOR = '[data-testid="adventure-town-hub"]';
const RUN_ARTIFACTS = new Set();
fs.mkdirSync(OUT, { recursive: true });
for (const filename of fs.readdirSync(OUT)) {
  if (/^adventure-.+\.png$/.test(filename)) fs.rmSync(path.join(OUT, filename));
}

function ok(message) {
  console.log(`  OK: ${message}`);
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function saveScreenshot(page, filename) {
  const outputPath = path.join(OUT, filename);
  await page.screenshot({ path: outputPath, fullPage: true });
  RUN_ARTIFACTS.add(outputPath);
}

function removeRunArtifacts() {
  for (const outputPath of RUN_ARTIFACTS) fs.rmSync(outputPath, { force: true });
  RUN_ARTIFACTS.clear();
}

async function signInWithFakeGoogle(page) {
  await page.goto(`${BASE_URL}/login`, { waitUntil: 'domcontentloaded' });
  const button = page.getByRole('button', { name: /Google 계정으로 시작하기/i });
  const popupPromise = page.waitForEvent('popup');
  await button.click();
  const popup = await popupPromise;
  await popup.waitForLoadState('domcontentloaded');
  await popup.getByRole('button', { name: /add new account/i }).click();
  await popup.locator('#email-input').fill(ACCOUNT.email);
  await popup.locator('#display-name-input').fill(ACCOUNT.displayName);
  await popup.getByRole('button', { name: /sign in with google/i }).click();
  await page.getByRole('button', { name: '새 게임 방 만들기' }).waitFor({ timeout: 20_000 });
}

async function waitForSaved(page) {
  await page.waitForFunction(
    () => [...document.querySelectorAll('span')].some((element) => element.textContent?.trim() === '저장됨'),
    null,
    { timeout: 20_000 },
  );
}

async function readFirebaseSession(page) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const session = await page.evaluate(async () => {
      const fromValue = (value) => {
        if (!value || typeof value !== 'object') return null;
        const uid = value.uid;
        const token = value.stsTokenManager?.accessToken;
        return typeof uid === 'string' && typeof token === 'string' ? { uid, token } : null;
      };

      for (const key of Object.keys(localStorage)) {
        if (!key.startsWith('firebase:authUser:')) continue;
        try {
          const parsed = JSON.parse(localStorage.getItem(key) || 'null');
          const found = fromValue(parsed);
          if (found) return found;
        } catch {}
      }

      return new Promise((resolve) => {
        const request = indexedDB.open('firebaseLocalStorageDb');
        request.onerror = () => resolve(null);
        request.onsuccess = () => {
          const database = request.result;
          if (!database.objectStoreNames.contains('firebaseLocalStorage')) {
            database.close();
            resolve(null);
            return;
          }
          const transaction = database.transaction('firebaseLocalStorage', 'readonly');
          const getAll = transaction.objectStore('firebaseLocalStorage').getAll();
          getAll.onerror = () => {
            database.close();
            resolve(null);
          };
          getAll.onsuccess = () => {
            const found = getAll.result
              .map((entry) => fromValue(entry?.value ?? entry))
              .find(Boolean) ?? null;
            database.close();
            resolve(found);
          };
        };
      });
    });
    if (session) return session;
    await delay(100);
  }
  throw new Error('브라우저 Firebase 인증 토큰을 찾지 못했습니다.');
}

async function databaseRequest(databasePath, token, method = 'GET', body) {
  const encodedPath = databasePath.split('/').filter(Boolean).map(encodeURIComponent).join('/');
  const endpoint = new URL(`/${encodedPath}.json`, DATABASE_URL);
  endpoint.searchParams.set('ns', DATABASE_NAMESPACE);
  endpoint.searchParams.set('auth', token);
  const response = await fetch(endpoint, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const responseText = await response.text();
  let payload = responseText;
  try {
    payload = responseText ? JSON.parse(responseText) : null;
  } catch {}
  if (!response.ok) {
    throw new Error(`Firebase ${method} ${databasePath || '/'} 실패 (${response.status}): ${JSON.stringify(payload)}`);
  }
  return payload;
}

async function seedSixSkillCharacter(session) {
  const statePath = `users/${session.uid}/adventure/v1`;
  const rankingPath = `adventureRankings/${session.uid}`;
  const [state, ranking] = await Promise.all([
    databaseRequest(statePath, session.token),
    databaseRequest(rankingPath, session.token),
  ]);
  assert.ok(state && ranking, '생성된 모험 상태와 랭킹이 Firebase에 있어야 합니다.');
  const now = Math.max(Date.now(), Number(state.updatedAt || 0) + 1);
  const skillRanks = Object.fromEntries(Array.from({ length: 6 }, (_, index) => [`skill${index + 1}`, 1]));
  const seededState = {
    ...state,
    level: 30,
    exp: 0,
    hp: 1_000,
    baseStats: { strength: 120, vitality: 80, defense: 80, agility: 40 },
    skillPoints: 0,
    skillRanks,
    skillLoadout: Array.from({ length: 6 }, (_, index) => `skill${index + 1}`),
    updatedAt: now,
    lastActiveAt: now,
  };
  const seededRanking = {
    ...ranking,
    level: seededState.level,
    masteryLevel: seededState.mastery.level,
    power: seededState.rankingPower,
    totalKills: seededState.statistics.totalKills,
    bossesKilled: seededState.statistics.bossesKilled,
    collectionCount: seededState.rankingCollectionCount,
    updatedAt: now,
  };
  await databaseRequest('', session.token, 'PATCH', {
    [`users/${session.uid}/adventure/v1`]: seededState,
    [`adventureRankings/${session.uid}`]: seededRanking,
  });
  return seededState;
}

async function clearLocalAdventureSave(page) {
  await page.evaluate(() => {
    for (const key of Object.keys(localStorage)) {
      if (key.startsWith('daemok-adventure-v1:')) localStorage.removeItem(key);
    }
  });
}

async function getHackSlashStage(page) {
  const explicit = page.locator('[data-testid="hackslash-stage"]');
  if (await explicit.count()) {
    await explicit.first().waitFor({ state: 'visible', timeout: 20_000 });
    return { stage: explicit.first(), selector: '[data-testid="hackslash-stage"]' };
  }
  const actual = page.locator('[data-testid="hackslash-arena"] [role="application"]');
  await actual.waitFor({ state: 'visible', timeout: 20_000 });
  return { stage: actual, selector: '[data-testid="hackslash-arena"] [role="application"]' };
}

async function waitForTownCharacter(page, characterName) {
  const hub = page.locator(TOWN_HUB_SELECTOR);
  await hub.waitFor({ state: 'visible', timeout: 20_000 });
  assert.ok((await hub.textContent())?.includes(characterName), `마을 허브에 캐릭터 이름 ${characterName}이 없습니다.`);
  return hub;
}

async function expectWaypointDialog(page, label) {
  await page.getByRole('button', { name: '성문', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: /경계의 문/ });
  await dialog.waitFor({ state: 'visible', timeout: 10_000 });
  const layout = await dialog.evaluate((element) => {
    const panel = element.querySelector('section');
    const panelRect = panel?.getBoundingClientRect();
    const buttons = [...element.querySelectorAll('button')].map((button) => {
      const rect = button.getBoundingClientRect();
      return {
        name: button.getAttribute('aria-label') || button.textContent?.trim() || '',
        width: rect.width,
        height: rect.height,
      };
    }).filter((button) => button.width > 0 && button.height > 0);
    return {
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
      panel: panelRect ? {
        left: panelRect.left,
        right: panelRect.right,
        top: panelRect.top,
        bottom: panelRect.bottom,
        clientWidth: panel?.clientWidth ?? 0,
        scrollWidth: panel?.scrollWidth ?? 0,
      } : null,
      smallButtons: buttons.filter((button) => button.width < 44 || button.height < 44),
    };
  });
  assert.ok(layout.panel, `${label}: 웨이포인트 패널이 없습니다.`);
  assert.ok(
    layout.panel.left >= -1
      && layout.panel.right <= layout.viewportWidth + 1
      && layout.panel.top >= -1
      && layout.panel.bottom <= layout.viewportHeight + 1,
    `${label}: 웨이포인트 패널이 화면 밖으로 잘렸습니다. ${JSON.stringify(layout)}`,
  );
  assert.ok(layout.panel.scrollWidth <= layout.panel.clientWidth + 1, `${label}: 웨이포인트 패널 가로 오버플로 ${JSON.stringify(layout)}`);
  assert.deepEqual(layout.smallButtons, [], `${label}: 44px 미만 웨이포인트 버튼 ${JSON.stringify(layout.smallButtons)}`);
  await dialog.getByRole('button', { name: '닫기' }).click();
  await dialog.waitFor({ state: 'hidden' });
}

async function expectTownViewport(page, label, width, height) {
  await page.setViewportSize({ width, height });
  assert.equal(await page.getByRole('navigation', { name: '모험 메뉴' }).count(), 0, `${label}: 사냥 화면에 대시보드 메뉴가 남아 있습니다.`);
  await page.getByRole('button', { name: '장비 열기' }).waitFor({ state: 'visible' });
  const town = page.locator(TOWN_SELECTOR);
  const hub = page.locator(TOWN_HUB_SELECTOR);
  await town.waitFor({ state: 'visible', timeout: 20_000 });
  await hub.waitFor({ state: 'visible', timeout: 20_000 });
  await hub.locator('canvas').waitFor({ state: 'visible', timeout: 20_000 });
  const layout = await town.evaluate((element) => {
    const townRect = element.getBoundingClientRect();
    const hubRect = element.querySelector('[data-testid="adventure-town-hub"]')?.getBoundingClientRect();
    const buttons = [...element.querySelectorAll('button')].map((button) => {
      const rect = button.getBoundingClientRect();
      return {
        name: button.getAttribute('aria-label') || button.textContent?.trim() || '',
        width: rect.width,
        height: rect.height,
        left: rect.left,
        right: rect.right,
      };
    }).filter((button) => button.width > 0 && button.height > 0);
    const labels = [...element.querySelectorAll('[class*="serviceLabel"], [class*="hint"]')]
      .map((label) => {
        const rect = label.getBoundingClientRect();
        return {
          text: label.textContent?.trim() || '',
          left: rect.left,
          right: rect.right,
          top: rect.top,
          bottom: rect.bottom,
          width: rect.width,
          height: rect.height,
        };
      })
      .filter((label) => label.width > 0 && label.height > 0);
    const overlappingLabels = [];
    for (let leftIndex = 0; leftIndex < labels.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < labels.length; rightIndex += 1) {
        const left = labels[leftIndex];
        const right = labels[rightIndex];
        const overlapWidth = Math.min(left.right, right.right) - Math.max(left.left, right.left);
        const overlapHeight = Math.min(left.bottom, right.bottom) - Math.max(left.top, right.top);
        if (overlapWidth > 1 && overlapHeight > 1) overlappingLabels.push([left.text, right.text]);
      }
    }
    return {
      documentClientWidth: document.documentElement.clientWidth,
      documentScrollWidth: document.documentElement.scrollWidth,
      townWidth: townRect.width,
      hubWidth: hubRect?.width ?? 0,
      smallButtons: buttons.filter((button) => button.width < 44 || button.height < 44),
      buttonsOutside: buttons.filter((button) => button.left < townRect.left - 1 || button.right > townRect.right + 1),
      overlappingLabels,
    };
  });
  assert.ok(layout.documentScrollWidth <= layout.documentClientWidth + 1, `${label}: 마을 문서 가로 오버플로 ${JSON.stringify(layout)}`);
  assert.ok(layout.townWidth > 0 && layout.hubWidth > 0, `${label}: 마을 3D 영역 크기 오류 ${JSON.stringify(layout)}`);
  assert.deepEqual(layout.smallButtons, [], `${label}: 44px 미만 마을 버튼 ${JSON.stringify(layout.smallButtons)}`);
  assert.deepEqual(layout.buttonsOutside, [], `${label}: 마을 밖으로 잘린 버튼 ${JSON.stringify(layout.buttonsOutside)}`);
  assert.deepEqual(layout.overlappingLabels, [], `${label}: 마을 서비스 라벨 겹침 ${JSON.stringify(layout.overlappingLabels)}`);
  const canvasFrame = await captureArenaCanvasFrame(page, TOWN_HUB_SELECTOR);
  assertCanvasNonBlank(canvasFrame, `${label} 마을`);
  await saveScreenshot(page, `adventure-town-${label}.png`);
  await expectWaypointDialog(page, label);
  ok(`${label} ${width}x${height}, nonblank 마을 3D, 라벨 겹침 없음, 44px 조작 버튼, 가로 오버플로 없음`);
}

async function enterBattlefieldFromTown(page) {
  await page.locator(TOWN_HUB_SELECTOR).waitFor({ state: 'visible', timeout: 20_000 });
  await page.getByRole('button', { name: '성문', exact: true }).click();
  const waypoint = page.getByRole('dialog', { name: /경계의 문/ });
  await waypoint.waitFor({ state: 'visible', timeout: 10_000 });
  await waypoint.getByRole('button', { name: /성문 밖으로/ }).click();
  await page.locator(TOWN_SELECTOR).waitFor({ state: 'hidden', timeout: 20_000 });
  return getHackSlashStage(page);
}

async function pageHasNoHorizontalOverflow(page, label) {
  const layout = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  assert.ok(layout.scrollWidth <= layout.clientWidth + 1, `${label}: 문서 가로 오버플로 ${JSON.stringify(layout)}`);
}

async function validateLoadedAssets(page) {
  const assets = await page.evaluate(async () => {
    const urls = new Set();
    for (const image of document.images) {
      const source = image.currentSrc || image.src;
      if (source) urls.add(source);
    }
    for (const element of document.querySelectorAll('*')) {
      const background = getComputedStyle(element).backgroundImage;
      for (const match of background.matchAll(/url\(["']?(.+?)["']?\)/g)) {
        if (match[1]) urls.add(new URL(match[1], location.href).href);
      }
    }
    return Promise.all([...urls].map((url) => new Promise((resolve) => {
      const image = new Image();
      const timer = setTimeout(() => resolve({ url, width: 0, height: 0, timeout: true }), 5_000);
      image.onload = () => {
        clearTimeout(timer);
        resolve({ url, width: image.naturalWidth, height: image.naturalHeight, timeout: false });
      };
      image.onerror = () => {
        clearTimeout(timer);
        resolve({ url, width: 0, height: 0, timeout: false });
      };
      image.src = url;
    })));
  });
  const broken = assets.filter((asset) => asset.width <= 0 || asset.height <= 0 || asset.timeout);
  assert.deepEqual(broken, [], `로드된 이미지/CSS 에셋의 natural 크기 오류: ${JSON.stringify(broken)}`);
  return assets.length;
}

async function captureArenaCanvasFrame(page, sceneSelector = ARENA_3D_SELECTOR) {
  const scene = page.locator(sceneSelector).first();
  await scene.waitFor({ state: 'visible', timeout: 20_000 });
  const canvas = scene.locator('canvas').first();
  await canvas.waitFor({ state: 'visible', timeout: 20_000 });
  await canvas.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  // A composited screenshot works with preserveDrawingBuffer disabled. Keeping
  // that WebGL flag on solely for readPixels causes a material frame-rate cost,
  // especially on mobile GPUs.
  const png = await canvas.screenshot({ type: 'png' });
  const { data: raw, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width, height, channels } = info;
  if (width <= 0 || height <= 0) throw new Error(`3D 전장 Canvas 크기 오류: ${width}x${height}`);

  const sampleColumns = 64;
  const sampleRows = 40;
  const pixels = [];
  const quantizedColors = new Set();
  let nonBlack = 0;
  let opaque = 0;
  let luminanceSum = 0;
  let luminanceSquareSum = 0;

  for (let row = 0; row < sampleRows; row += 1) {
    const y = Math.min(height - 1, Math.floor(((row + 0.5) / sampleRows) * height));
    for (let column = 0; column < sampleColumns; column += 1) {
      const x = Math.min(width - 1, Math.floor(((column + 0.5) / sampleColumns) * width));
      const offset = (y * width + x) * channels;
      const red = raw[offset];
      const green = raw[offset + 1];
      const blue = raw[offset + 2];
      const alpha = raw[offset + 3];
      const luminance = red * 0.2126 + green * 0.7152 + blue * 0.0722;
      pixels.push((red << 16) | (green << 8) | blue);
      quantizedColors.add(((red >> 3) << 10) | ((green >> 3) << 5) | (blue >> 3));
      if (luminance > 3) nonBlack += 1;
      if (alpha > 240) opaque += 1;
      luminanceSum += luminance;
      luminanceSquareSum += luminance * luminance;
    }
  }

  const sampleCount = pixels.length;
  const luminanceMean = luminanceSum / sampleCount;
  return {
    width,
    height,
    sampleColumns,
    sampleRows,
    pixels,
    uniqueColorCount: quantizedColors.size,
    nonBlackRatio: nonBlack / sampleCount,
    opaqueRatio: opaque / sampleCount,
    luminanceVariance: Math.max(0, luminanceSquareSum / sampleCount - luminanceMean ** 2),
  };
}

function assertCanvasNonBlank(frame, label) {
  const summary = {
    width: frame.width,
    height: frame.height,
    uniqueColorCount: frame.uniqueColorCount,
    nonBlackRatio: frame.nonBlackRatio,
    opaqueRatio: frame.opaqueRatio,
    luminanceVariance: frame.luminanceVariance,
  };
  assert.ok(frame.width > 0 && frame.height > 0, `${label}: 3D Canvas 크기 오류 ${frame.width}x${frame.height}`);
  assert.ok(frame.opaqueRatio > 0.95, `${label}: 3D Canvas 불투명 픽셀 부족 ${JSON.stringify(summary)}`);
  assert.ok(frame.nonBlackRatio > 0.08, `${label}: 3D Canvas가 검은 화면입니다. ${JSON.stringify(summary)}`);
  assert.ok(frame.uniqueColorCount >= 12, `${label}: 3D Canvas 색상 다양성이 부족합니다. ${JSON.stringify(summary)}`);
  assert.ok(frame.luminanceVariance >= 8, `${label}: 3D Canvas 명암 분산이 부족합니다. ${JSON.stringify(summary)}`);
}

function compareCanvasFrames(before, after) {
  assert.equal(after.sampleColumns, before.sampleColumns, 'Canvas 가로 샘플 수가 달라졌습니다.');
  assert.equal(after.sampleRows, before.sampleRows, 'Canvas 세로 샘플 수가 달라졌습니다.');
  assert.equal(after.pixels.length, before.pixels.length, 'Canvas 픽셀 샘플 수가 달라졌습니다.');
  let changed = 0;
  let channelDelta = 0;
  for (let index = 0; index < before.pixels.length; index += 1) {
    const left = before.pixels[index];
    const right = after.pixels[index];
    const delta = Math.abs(((left >> 16) & 255) - ((right >> 16) & 255))
      + Math.abs(((left >> 8) & 255) - ((right >> 8) & 255))
      + Math.abs((left & 255) - (right & 255));
    channelDelta += delta;
    if (delta >= 18) changed += 1;
  }
  return {
    changedPixelRatio: changed / before.pixels.length,
    meanChannelDelta: channelDelta / (before.pixels.length * 3),
  };
}

async function expectHackSlashViewport(page, label, width, height) {
  await page.setViewportSize({ width, height });
  await page.waitForTimeout(180);
  assert.equal(await page.getByRole('navigation', { name: '모험 메뉴' }).count(), 0, `${label}: 전장에 대시보드 메뉴가 남아 있습니다.`);
  await page.getByRole('button', { name: '장비 열기' }).waitFor({ state: 'visible' });
  const { stage } = await getHackSlashStage(page);
  const layout = await stage.evaluate((element) => {
    const stageRect = element.getBoundingClientRect();
    const buttons = [...element.querySelectorAll('button')].map((button) => {
      const rect = button.getBoundingClientRect();
      return {
        name: button.getAttribute('aria-label') || button.textContent?.trim() || '',
        width: rect.width,
        height: rect.height,
        left: rect.left,
        right: rect.right,
        top: rect.top,
        bottom: rect.bottom,
      };
    }).filter((button) => button.width > 0 && button.height > 0);
    return {
      documentClientWidth: document.documentElement.clientWidth,
      documentScrollWidth: document.documentElement.scrollWidth,
      stageClientWidth: element.clientWidth,
      stageScrollWidth: element.scrollWidth,
      stageClientHeight: element.clientHeight,
      stageScrollHeight: element.scrollHeight,
      stageRect: { left: stageRect.left, right: stageRect.right, top: stageRect.top, bottom: stageRect.bottom },
      smallButtons: buttons.filter((button) => button.width < 44 || button.height < 44),
      buttonsOutside: buttons.filter((button) => (
        button.left < stageRect.left - 1
        || button.right > stageRect.right + 1
        || button.top < stageRect.top - 1
        || button.bottom > stageRect.bottom + 1
      )),
    };
  });
  assert.ok(layout.documentScrollWidth <= layout.documentClientWidth + 1, `${label}: 문서 가로 오버플로 ${JSON.stringify(layout)}`);
  assert.ok(layout.stageScrollWidth <= layout.stageClientWidth + 1, `${label}: 전장 가로 오버플로 ${JSON.stringify(layout)}`);
  assert.ok(layout.stageScrollHeight <= layout.stageClientHeight + 1, `${label}: 전장 세로 오버플로 ${JSON.stringify(layout)}`);
  assert.deepEqual(layout.smallButtons, [], `${label}: 44px 미만 전장 버튼 ${JSON.stringify(layout.smallButtons)}`);
  assert.deepEqual(layout.buttonsOutside, [], `${label}: 전장 밖으로 잘린 버튼 ${JSON.stringify(layout.buttonsOutside)}`);
  const assetCount = await validateLoadedAssets(page);
  const canvasFrame = await captureArenaCanvasFrame(page);
  assertCanvasNonBlank(canvasFrame, label);
  await saveScreenshot(page, `adventure-hackslash-${label}.png`);
  ok(`${label} ${width}x${height}, 3D Canvas ${canvasFrame.width}x${canvasFrame.height}, 44px 조작 버튼, 오버플로 없음, ${assetCount}개 외부 에셋`);
}

async function holdMovement(page, keys, label) {
  const before = await captureArenaCanvasFrame(page);
  for (const key of keys) await page.keyboard.down(key);
  try {
    await delay(460);
    const after = await captureArenaCanvasFrame(page);
    const difference = compareCanvasFrames(before, after);
    assert.ok(
      difference.changedPixelRatio >= 0.025 || difference.meanChannelDelta >= 1.5,
      `${label}: 이동 입력 뒤 3D 화면 변화가 부족합니다. ${JSON.stringify(difference)}`,
    );
    return difference;
  } finally {
    for (const key of [...keys].reverse()) await page.keyboard.up(key);
  }
}

async function verifyMovementAndAnimation(page, stage) {
  await stage.evaluate((element) => element.focus());
  const initial = await captureArenaCanvasFrame(page);
  assertCanvasNonBlank(initial, '3D 전장 초기 프레임');
  await delay(320);
  const idle = compareCanvasFrames(initial, await captureArenaCanvasFrame(page));
  assert.ok(
    idle.changedPixelRatio >= 0.002 || idle.meanChannelDelta >= 0.2,
    `3D idle 애니메이션 화면 변화가 부족합니다. ${JSON.stringify(idle)}`,
  );

  const movements = [];
  movements.push(await holdMovement(page, ['w'], 'W 북쪽 이동'));
  movements.push(await holdMovement(page, ['s'], 'S 남쪽 이동'));
  movements.push(await holdMovement(page, ['a'], 'A 서쪽 이동'));
  movements.push(await holdMovement(page, ['d'], 'D 동쪽 이동'));
  movements.push(await holdMovement(page, ['w', 'd'], 'W+D 북동 이동'));
  movements.push(await holdMovement(page, ['s', 'a'], 'S+A 남서 이동'));
  movements.push(await holdMovement(page, ['w', 'a'], 'W+A 북서 이동'));
  movements.push(await holdMovement(page, ['s', 'd'], 'S+D 남동 이동'));
  await saveScreenshot(page, 'adventure-3d-movement.png');
  const minimumChange = Math.min(...movements.map((movement) => movement.changedPixelRatio));
  ok(`3D Canvas nonblank, idle 애니메이션, WASD 4방향/대각선 이동 픽셀 변화(최소 ${(minimumChange * 100).toFixed(1)}%)`);
}

async function ensureArenaAlive(page) {
  const retry = page.getByRole('button', { name: /야영지에서 회복|다시 일어서기/ });
  if (await retry.isVisible().catch(() => false)) {
    await retry.click();
    await page.locator('[data-testid="arena-player"]').waitFor({ state: 'visible' });
  }
}

async function readEnemyCombatState(stage) {
  return stage.evaluate((element) => {
    const enemies = [...element.querySelectorAll('[data-testid="arena-enemy"]')].map((enemy) => ({
      id: enemy.getAttribute('data-enemy-id'),
      hp: Number(enemy.getAttribute('data-hp')),
      maxHp: Number(enemy.getAttribute('data-max-hp')),
    }));
    const healthRatios = [...element.querySelectorAll('[class*="enemyHealthFill"]')]
      .map((health) => Number.parseFloat(health.style.width || '0'))
      .filter(Number.isFinite);
    return {
      enemies,
      listedEnemyCount: enemies.length,
      healthBarCount: healthRatios.length,
      totalHealthPercent: healthRatios.reduce((total, value) => total + value, 0),
    };
  });
}

function enemyTookDamageOrDied(before, after) {
  const afterById = new Map(after.enemies.map((enemy) => [enemy.id, enemy]));
  const persistentEnemyChanged = before.enemies.some((enemy) => {
    const current = afterById.get(enemy.id);
    return !current || current.hp < enemy.hp;
  });
  return persistentEnemyChanged
    || after.listedEnemyCount < before.listedEnemyCount
    || after.healthBarCount < before.healthBarCount
    || after.totalHealthPercent < before.totalHealthPercent - 0.25;
}

async function waitForEnemyTarget(page, stage, timeoutMs = 8_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await ensureArenaAlive(page);
    const state = await readEnemyCombatState(stage);
    if (state.listedEnemyCount > 0 && state.healthBarCount > 0) return state;
    await delay(80);
  }
  throw new Error('3D 전장에서 공격할 적과 체력 바가 제한 시간 안에 나타나지 않았습니다.');
}

async function observeActionOutcome(page, stage, beforeFrame, beforeCombat, label, timeoutMs = 4_500) {
  const deadline = Date.now() + timeoutMs;
  let bestDifference = { changedPixelRatio: 0, meanChannelDelta: 0 };
  let combatAfter = beforeCombat;
  let combatChanged = false;
  while (Date.now() < deadline) {
    const frame = await captureArenaCanvasFrame(page);
    assertCanvasNonBlank(frame, `${label} 직후`);
    const difference = compareCanvasFrames(beforeFrame, frame);
    if (
      difference.changedPixelRatio > bestDifference.changedPixelRatio
      || difference.meanChannelDelta > bestDifference.meanChannelDelta
    ) {
      bestDifference = {
        changedPixelRatio: Math.max(bestDifference.changedPixelRatio, difference.changedPixelRatio),
        meanChannelDelta: Math.max(bestDifference.meanChannelDelta, difference.meanChannelDelta),
      };
    }
    combatAfter = await readEnemyCombatState(stage);
    combatChanged = enemyTookDamageOrDied(beforeCombat, combatAfter);
    const visualChanged = bestDifference.changedPixelRatio >= 0.006 || bestDifference.meanChannelDelta >= 0.45;
    if (visualChanged && combatChanged) break;
    await delay(55);
  }

  assert.ok(
    bestDifference.changedPixelRatio >= 0.006 || bestDifference.meanChannelDelta >= 0.45,
    `${label}: 실행 직후 3D Canvas 픽셀 변화가 부족합니다. ${JSON.stringify(bestDifference)}`,
  );
  assert.ok(
    combatChanged,
    `${label}: 적 HP 감소 또는 적 수 감소가 관찰되지 않았습니다. before=${JSON.stringify(beforeCombat)} after=${JSON.stringify(combatAfter)}`,
  );
  return { difference: bestDifference, combatAfter };
}

async function waitForActionReady(button, label, timeoutMs = 12_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await button.isVisible().catch(() => false) && await button.isEnabled().catch(() => false)) return;
    await delay(80);
  }
  throw new Error(`${label}: 재시도 전에 스킬이 다시 활성화되지 않았습니다.`);
}

async function createCombatSpacing(page, stage, attempt) {
  const keys = attempt % 2 === 0 ? ['w', 'd'] : ['s', 'a'];
  await stage.evaluate((element) => element.focus());
  for (const key of keys) await page.keyboard.down(key);
  try {
    await delay(900);
  } finally {
    for (const key of [...keys].reverse()) await page.keyboard.up(key);
  }
  await delay(180);
  await ensureArenaAlive(page);
}

async function triggerSkillWithTargetRetry(page, stage, button, label) {
  let firstFailure = null;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    await ensureArenaAlive(page);
    if (attempt > 1) await createCombatSpacing(page, stage, attempt);
    await waitForActionReady(button, label);
    const beforeCombat = await waitForEnemyTarget(page, stage);
    const beforeFrame = await captureArenaCanvasFrame(page);
    await button.click();
    try {
      const outcome = await observeActionOutcome(page, stage, beforeFrame, beforeCombat, label);
      if (firstFailure) ok(`${label}: 이동 표적을 다시 조준해 ${attempt}회차에 피해 확인`);
      return outcome;
    } catch (error) {
      if (attempt === 3) throw error;
      firstFailure = error;
    }
  }
  throw firstFailure ?? new Error(`${label}: 스킬 검증에 실패했습니다.`);
}

async function verifyCombatControlsAndVisuals(page, stage) {
  const skillButtons = stage.locator('button[aria-keyshortcuts]:not([aria-keyshortcuts="Space"])');
  await page.waitForFunction(() => (
    document.querySelectorAll('[data-testid="hackslash-arena"] button[aria-keyshortcuts]:not([aria-keyshortcuts="Space"])').length === 6
  ), null, { timeout: 10_000 });
  assert.equal(await skillButtons.count(), 6, '해금된 스킬 버튼이 6개여야 합니다.');
  const shortcuts = await skillButtons.evaluateAll((buttons) => buttons.map((button) => button.getAttribute('aria-keyshortcuts')));
  assert.deepEqual(shortcuts, SKILL_SHORTCUTS, '6개 스킬 단축키 순서가 달라졌습니다.');
  const labels = await skillButtons.evaluateAll((buttons) => buttons.map((button) => button.getAttribute('aria-label')));
  assert.ok(labels.every(Boolean) && new Set(labels).size === 6, `스킬 이름이 비었거나 중복되었습니다: ${JSON.stringify(labels)}`);

  const attack = stage.getByRole('button', { name: '기본 공격' });
  const attackBeforeCombat = await waitForEnemyTarget(page, stage);
  const attackBeforeFrame = await captureArenaCanvasFrame(page);
  await attack.click();
  const attackOutcome = await observeActionOutcome(page, stage, attackBeforeFrame, attackBeforeCombat, '기본 공격');

  const actionDifferences = [attackOutcome.difference];
  for (let index = 0; index < 6; index += 1) {
    const button = skillButtons.nth(index);
    await button.waitFor({ state: 'visible' });
    const outcome = await triggerSkillWithTargetRetry(page, stage, button, labels[index]);
    actionDifferences.push(outcome.difference);
  }
  await saveScreenshot(page, 'adventure-3d-combat.png');
  const minimumChange = Math.min(...actionDifferences.map((difference) => difference.changedPixelRatio));
  ok(`기본 공격과 6스킬(${labels.join(', ')})의 3D 픽셀 변화(최소 ${(minimumChange * 100).toFixed(1)}%) 및 적 HP/수 감소`);
}

async function waitForKillPersistence(page, stage, session, killsBefore) {
  const statePath = `users/${session.uid}/adventure/v1`;
  const rankingPath = `adventureRankings/${session.uid}`;
  const attack = stage.getByRole('button', { name: '기본 공격' });
  const deadline = Date.now() + 25_000;
  while (Date.now() < deadline) {
    const state = await databaseRequest(statePath, session.token);
    if (state?.statistics?.totalKills > killsBefore) {
      const ranking = await databaseRequest(rankingPath, session.token);
      assert.equal(ranking.totalKills, state.statistics.totalKills, '처치 수가 랭킹과 저장 상태에서 일치해야 합니다.');
      assert.equal(ranking.level, state.level, '레벨이 랭킹과 저장 상태에서 일치해야 합니다.');
      return { state, ranking };
    }
    await ensureArenaAlive(page);
    if (await attack.isEnabled().catch(() => false)) await attack.click();
    await delay(650);
  }
  throw new Error('실시간 전장 처치가 Firebase 상태와 랭킹에 저장되지 않았습니다.');
}

(async () => {
  const browser = await chromium.launch({
    channel: process.env.CHROME_PATH ? undefined : 'chrome',
    executablePath: process.env.CHROME_PATH || undefined,
    headless: true,
    args: ['--no-sandbox'],
  });
  const context = await browser.newContext({ viewport: { width: 360, height: 800 } });
  const page = await context.newPage();
  const errors = [];
  const missingResponses = [];
  const observePage = (target) => {
    target.on('pageerror', (error) => errors.push(String(error)));
    target.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text());
    });
    target.on('response', (response) => {
      if (response.status() === 404) missingResponses.push(response.url());
    });
  };
  observePage(page);

  try {
    console.log('STEP 1: Firebase 로그인과 캐릭터 생성');
    await signInWithFakeGoogle(page);
    await page.goto(`${BASE_URL}/adventure`, { waitUntil: 'domcontentloaded' });
    await page.getByRole('heading', { name: '오래 키울 첫 캐릭터를 선택하세요' }).waitFor({ timeout: 20_000 });
    await pageHasNoHorizontalOverflow(page, '캐릭터 생성 Galaxy S21');
    await saveScreenshot(page, 'adventure-creation-galaxy-s21.png');
    await page.getByPlaceholder('이름을 입력하세요').fill(CHARACTER_NAME);
    await page.getByRole('button', { name: /바람사수/ }).click();
    await page.getByRole('button', { name: /모험 시작/ }).click();
    await waitForTownCharacter(page, CHARACTER_NAME);
    await waitForSaved(page);
    const session = await readFirebaseSession(page);
    await expectTownViewport(page, 'town-galaxy-s21', 360, 800);
    await expectTownViewport(page, 'town-iphone-15', 393, 852);
    ok('캐릭터 생성, Firebase 저장, 브라우저 인증 세션과 마을 시작 확인');

    console.log('STEP 2: 원격 복구와 레벨 30·6스킬 Firebase 시드');
    await page.getByRole('button', { name: '장비 열기' }).click();
    await page.getByRole('button', { name: '랭킹' }).click();
    await page.getByText(`${CHARACTER_NAME} (나)`, { exact: true }).waitFor({ timeout: 20_000 });
    await clearLocalAdventureSave(page);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await waitForTownCharacter(page, CHARACTER_NAME);
    const seededState = await seedSixSkillCharacter(session);
    await clearLocalAdventureSave(page);
    await page.reload({ waitUntil: 'domcontentloaded' });
    const stageInfo = await enterBattlefieldFromTown(page);
    let stage = stageInfo.stage;
    const stageSelector = stageInfo.selector;
    await page.locator('[data-testid="arena-player"]', { hasText: '레벨 30' }).waitFor({ timeout: 20_000 });
    await waitForSaved(page);
    ok(`로컬 저장 삭제 후 Firebase 복구 및 6스킬 전장 진입, 실제 stage selector: ${stageSelector}`);

    console.log('STEP 3: 3D Canvas nonblank와 WASD 8방향 화면 변화');
    const fieldStatus = stage.locator('[data-testid="field-status"]');
    await fieldStatus.waitFor({ state: 'visible' });
    const fieldStatusText = await fieldStatus.textContent();
    assert.ok(fieldStatusText?.includes('햇살 들판'), `연속 필드 HUD에 현재 지역이 없습니다: ${fieldStatusText}`);
    assert.doesNotMatch(fieldStatusText || '', /WAVE|웨이브|균열/i, '필드 HUD에 웨이브/균열 표현이 남아 있습니다.');
    await verifyMovementAndAnimation(page, stage);

    console.log('STEP 4: 기본 공격·6스킬 3D 화면/피해와 Firebase 처치/랭킹');
    await page.reload({ waitUntil: 'domcontentloaded' });
    stage = (await getHackSlashStage(page)).stage;
    await page.locator('[data-testid="arena-player"]', { hasText: '레벨 30' }).waitFor({ timeout: 20_000 });
    await verifyCombatControlsAndVisuals(page, stage);
    const persisted = await waitForKillPersistence(page, stage, session, seededState.statistics.totalKills);
    assert.ok(persisted.state.arenaCheckpoint, '실시간 처치 체크포인트가 저장되어야 합니다.');
    await page.getByRole('button', { name: '장비 열기' }).click();
    await page.getByRole('button', { name: '랭킹' }).click();
    await page.getByText(`${CHARACTER_NAME} (나)`, { exact: true }).waitFor({ timeout: 20_000 });
    ok(`Firebase 처치 ${persisted.state.statistics.totalKills}회와 공개 랭킹 정합성`);

    console.log('STEP 5: Galaxy S21 / iPhone 15 실시간 전장');
    await page.getByRole('button', { name: '사냥터' }).click();
    await expectHackSlashViewport(page, 'galaxy-s21', 360, 800);
    await expectHackSlashViewport(page, 'iphone-15', 393, 852);
    await page.getByRole('button', { name: /마을 귀환/ }).click();
    await page.locator(TOWN_HUB_SELECTOR).waitFor({ state: 'visible', timeout: 20_000 });
    await waitForSaved(page);
    ok('필드에서 마을로 귀환하고 Firebase 저장 완료');

    console.log('STEP 6: 두 탭 동시 초기화 뒤 현재 세대 저장');
    const secondPage = await context.newPage();
    observePage(secondPage);
    await secondPage.goto(`${BASE_URL}/adventure`, { waitUntil: 'domcontentloaded' });
    await waitForTownCharacter(secondPage, CHARACTER_NAME);
    const resetButtons = await Promise.all([
      page.getByRole('button', { name: '캐릭터 초기화' }).elementHandle(),
      secondPage.getByRole('button', { name: '캐릭터 초기화' }).elementHandle(),
    ]);
    assert.ok(resetButtons.every(Boolean), '두 탭의 캐릭터 초기화 버튼 핸들을 먼저 확보해야 합니다.');
    page.once('dialog', (dialog) => dialog.accept());
    secondPage.once('dialog', (dialog) => dialog.accept());
    await Promise.all(resetButtons.map((button) => button.evaluate((element) => element.click())));
    await Promise.all([
      page.getByRole('heading', { name: '오래 키울 첫 캐릭터를 선택하세요' }).waitFor({ timeout: 20_000 }),
      secondPage.getByRole('heading', { name: '오래 키울 첫 캐릭터를 선택하세요' }).waitFor({ timeout: 20_000 }),
    ]);
    const restartButton = page.getByRole('button', { name: /모험 시작/ });
    await restartButton.waitFor();
    await page.getByPlaceholder('이름을 입력하세요').fill(RESET_CHARACTER_NAME);
    await restartButton.click();
    await waitForTownCharacter(page, RESET_CHARACTER_NAME);
    await waitForSaved(page);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await waitForTownCharacter(page, RESET_CHARACTER_NAME);
    await secondPage.close();
    ok('두 탭 초기화 충돌 뒤 최신 세대 캐릭터 저장과 복구');

    console.log('STEP 7: Firebase 초기화와 재접속 삭제 유지');
    page.once('dialog', (dialog) => dialog.accept());
    await page.getByRole('button', { name: '캐릭터 초기화' }).click();
    await page.getByRole('heading', { name: '오래 키울 첫 캐릭터를 선택하세요' }).waitFor({ timeout: 20_000 });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.getByRole('heading', { name: '오래 키울 첫 캐릭터를 선택하세요' }).waitFor({ timeout: 20_000 });
    ok('초기화 뒤 Firebase/로컬 이전 캐릭터가 재생성되지 않음');

    assert.deepEqual([...new Set(missingResponses)], [], `404 응답: ${JSON.stringify([...new Set(missingResponses)])}`);
    assert.deepEqual(errors, [], `브라우저 오류: ${errors.join(' | ')}`);
    console.log('PASS: 실시간 3D HackSlash Canvas/8방향 이동/6스킬/Firebase/모바일 E2E');
  } catch (error) {
    console.error(`브라우저 오류 수집: ${errors.join(' | ') || '없음'}`);
    console.error(`404 응답 수집: ${[...new Set(missingResponses)].join(' | ') || '없음'}`);
    await page.screenshot({ path: path.join(OUT, 'adventure-failure.png'), fullPage: true }).catch(() => {});
    throw error;
  } finally {
    await browser.close();
  }
})().catch((error) => {
  removeRunArtifacts();
  console.error(error);
  process.exit(1);
});
