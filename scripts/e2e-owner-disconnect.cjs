/*
 * Owner-disconnect emulator E2E.
 *
 * Run:
 *   1. npx firebase-tools emulators:start --only auth,database --project daemok-155c1
 *   2. NEXT_PUBLIC_FIREBASE_EMULATOR=1 npm run dev
 *   3. EMULATOR=1 node scripts/e2e-owner-disconnect.cjs
 *
 * Optional overrides:
 *   BASE_URL=http://localhost:3000 \
 *   FIREBASE_AUTH_EMULATOR_URL=http://127.0.0.1:9099 \
 *   FIREBASE_DATABASE_EMULATOR_URL=http://127.0.0.1:9000 \
 *   FIREBASE_DATABASE_NAMESPACE=daemok-155c1-default-rtdb \
 *   EMULATOR=1 node scripts/e2e-owner-disconnect.cjs
 */

const { chromium } = require('playwright');

if (process.env.EMULATOR !== '1') {
  console.error('This script only runs against the Firebase emulators. Set EMULATOR=1.');
  process.exit(1);
}

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';
const AUTH_EMULATOR_URL =
  process.env.FIREBASE_AUTH_EMULATOR_URL || 'http://127.0.0.1:9099';
const DATABASE_EMULATOR_URL =
  process.env.FIREBASE_DATABASE_EMULATOR_URL || 'http://127.0.0.1:9000';
const DATABASE_NAMESPACE =
  process.env.FIREBASE_DATABASE_NAMESPACE || 'daemok-155c1-default-rtdb';
const FIREBASE_API_KEY =
  process.env.NEXT_PUBLIC_FIREBASE_API_KEY || 'AIzaSyBxHJ14JjS3DOHHR9xwLGjIKdBJp8cD448';
const DEFAULT_TIMEOUT = 20_000;
const STAMP = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const ROOM_SUFFIX = STAMP.slice(-10);

const accounts = {
  host: {
    email: `disconnect-host-${STAMP}@example.com`,
    displayName: `Disconnect Host ${STAMP.slice(-4)}`,
  },
  guest: {
    email: `disconnect-guest-${STAMP}@example.com`,
    displayName: `Disconnect Guest ${STAMP.slice(-4)}`,
  },
};

const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

function step(message) {
  console.log(`\n[STEP] ${message}`);
}

function pass(message) {
  console.log(`[PASS] ${message}`);
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

async function poll(label, predicate, options = {}) {
  const timeout = options.timeout || DEFAULT_TIMEOUT;
  const interval = options.interval || 200;
  const deadline = Date.now() + timeout;
  let lastError;

  while (Date.now() < deadline) {
    try {
      const result = await predicate();
      if (result) return result;
    } catch (error) {
      lastError = error;
    }
    await sleep(interval);
  }

  const detail = lastError ? ` Last error: ${errorMessage(lastError)}` : '';
  throw new Error(`Timed out waiting for ${label}.${detail}`);
}

async function requestJson(url, options = {}) {
  const response = await fetch(url, options);
  const text = await response.text();
  let payload = null;

  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = text;
    }
  }

  if (!response.ok) {
    throw new Error(
      `${options.method || 'GET'} ${url} failed (${response.status}): ${JSON.stringify(payload)}`,
    );
  }

  return payload;
}

async function createMonitorToken() {
  const endpoint = new URL(
    '/identitytoolkit.googleapis.com/v1/accounts:signUp',
    AUTH_EMULATOR_URL,
  );
  endpoint.searchParams.set('key', FIREBASE_API_KEY);

  const result = await requestJson(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      email: `disconnect-monitor-${STAMP}@example.com`,
      password: `monitor-${STAMP}-password`,
      returnSecureToken: true,
    }),
  });

  if (!result || typeof result.idToken !== 'string') {
    throw new Error(`Auth emulator signUp did not return an idToken: ${JSON.stringify(result)}`);
  }

  return result.idToken;
}

async function databaseGet(path, idToken) {
  const encodedPath = path
    .split('/')
    .filter(Boolean)
    .map((segment) => encodeURIComponent(segment))
    .join('/');
  const endpoint = new URL(`/${encodedPath}.json`, DATABASE_EMULATOR_URL);
  endpoint.searchParams.set('ns', DATABASE_NAMESPACE);
  endpoint.searchParams.set('auth', idToken);
  return requestJson(endpoint);
}

async function signInWithFakeGoogle(page, account, skipRoomRestore = false) {
  await page.goto(`${BASE_URL}/login`, { waitUntil: 'domcontentloaded' });
  if (skipRoomRestore) {
    await page.evaluate(() => sessionStorage.setItem('skip_room_restore', 'true'));
  }
  const googleButton = page.getByRole('button', { name: /Google 계정으로 시작하기/i });
  await googleButton.waitFor({ state: 'visible' });

  const popupPromise = page.waitForEvent('popup');
  await googleButton.click();
  const popup = await popupPromise;
  await popup.waitForLoadState('domcontentloaded');

  const addAccountButton = popup.getByRole('button', { name: /add new account/i });
  await addAccountButton.waitFor({ state: 'visible' });
  await addAccountButton.click();
  await popup.locator('#email-input').fill(account.email);
  await popup.locator('#display-name-input').fill(account.displayName);
  await popup.getByRole('button', { name: /sign in with google/i }).click();

  await page.getByRole('button', { name: '새 게임 방 만들기' }).waitFor({
    state: 'visible',
    timeout: DEFAULT_TIMEOUT,
  });
}

function currentPath(page) {
  return new URL(page.url()).pathname;
}

async function waitForLobby(page) {
  await page.waitForURL((url) => url.pathname === '/rooms', { timeout: DEFAULT_TIMEOUT });
  await page.getByRole('button', { name: '새 게임 방 만들기' }).waitFor({
    state: 'visible',
    timeout: DEFAULT_TIMEOUT,
  });
  await poll('the lobby room list to finish loading', async () => {
    const loading = page.getByText('방 목록을 불러오는 중...');
    return !(await loading.isVisible().catch(() => false));
  });
}

async function waitForRoomUrl(page, roomId) {
  await poll(`page URL /rooms/${roomId}`, () => currentPath(page) === `/rooms/${roomId}`);
}

async function waitForRoomCardAbsent(page, roomName) {
  await waitForLobby(page);
  await poll(`room card "${roomName}" to be absent`, async () => {
    return (await page.locator('[data-room-card]', { hasText: roomName }).count()) === 0;
  });
}

async function waitForRoomAbsent(roomId, monitorToken) {
  await poll(`rooms/${roomId} to be deleted`, async () => {
    return (await databaseGet(`rooms/${roomId}`, monitorToken)) === null;
  });
}

function playerIds(room) {
  return Object.keys(room.gameState?.players || {});
}

function connectionCount(room, uid) {
  return Object.values(room?.connections?.[uid] || {}).filter(Boolean).length;
}

async function createJoinedRoom(hostPage, guestPage, roomName, monitorToken) {
  await waitForLobby(hostPage);
  await waitForLobby(guestPage);

  await hostPage.getByRole('button', { name: '새 게임 방 만들기' }).click();
  await hostPage.locator('#roomName').fill(roomName);
  await hostPage.getByRole('button', { name: '방 만들기' }).click();
  await hostPage.waitForURL((url) => /^\/rooms\/[^/]+$/.test(url.pathname), {
    timeout: DEFAULT_TIMEOUT,
  });
  const roomId = currentPath(hostPage).split('/').filter(Boolean).at(-1);
  if (!roomId) throw new Error(`Could not read room id from ${hostPage.url()}`);

  await poll(`rooms/${roomId} to exist`, async () => {
    const room = await databaseGet(`rooms/${roomId}`, monitorToken);
    return room && room.createdBy ? room : false;
  });

  const card = guestPage.locator('[data-room-card]', { hasText: roomName });
  await card.waitFor({ state: 'visible', timeout: DEFAULT_TIMEOUT });
  await card.getByRole('button', { name: '참가하기' }).click();
  await waitForRoomUrl(guestPage, roomId);

  const joinedRoom = await poll(`both players to join rooms/${roomId}`, async () => {
    const room = await databaseGet(`rooms/${roomId}`, monitorToken);
    return room && playerIds(room).length === 2 ? room : false;
  });
  const hostUid = joinedRoom.createdBy;
  const guestUid = playerIds(joinedRoom).find((uid) => uid !== hostUid);
  if (!hostUid || !guestUid) {
    throw new Error(`Could not identify host and guest in room ${roomId}`);
  }

  await poll(`both players to become online in rooms/${roomId}`, async () => {
    const room = await databaseGet(`rooms/${roomId}`, monitorToken);
    return (
      room &&
      room.playerStatus?.[hostUid]?.isOnline === true &&
      room.playerStatus?.[guestUid]?.isOnline === true &&
      room
    );
  });

  // The online write happens after onDisconnect registration, but allow the
  // emulator WebSocket one extra tick before deliberately severing it.
  await sleep(250);
  return { roomId, hostUid, guestUid };
}

async function assertRoomExists(roomId, hostUid, monitorToken) {
  const room = await databaseGet(`rooms/${roomId}`, monitorToken);
  if (!room || room.createdBy !== hostUid) {
    throw new Error(`Room ${roomId} disappeared or changed owner unexpectedly.`);
  }
  return room;
}

async function assertRoomAbsentNow(roomId, monitorToken) {
  const room = await databaseGet(`rooms/${roomId}`, monitorToken);
  if (room !== null) {
    throw new Error(`Room ${roomId} was recreated: ${JSON.stringify(room)}`);
  }
}

function watchForPermissionErrors(page, label, errors) {
  page.on('pageerror', (error) => {
    if (/permission|denied/i.test(error.message)) errors.push(`${label}: ${error.message}`);
  });
  page.on('console', (message) => {
    if (message.type() === 'error' && /permission|denied/i.test(message.text())) {
      errors.push(`${label}: ${message.text()}`);
    }
  });
}

async function main() {
  step('Create a monitor identity through the Auth emulator REST API');
  const monitorToken = await createMonitorToken();
  pass('Monitor idToken issued');

  const browser = await chromium.launch({
    channel: process.env.CHROME_PATH ? undefined : 'chrome',
    executablePath: process.env.CHROME_PATH || undefined,
    headless: true,
    args: ['--no-sandbox'],
  });
  const hostContext = await browser.newContext();
  const guestContext = await browser.newContext();
  let hostPage = await hostContext.newPage();
  const guestPage = await guestContext.newPage();
  let mirrorContext = null;
  let guestMirrorContext = null;
  let clonedOwnerPage = null;
  const permissionErrors = [];
  let hostContextClosed = false;
  let hostOffline = false;

  watchForPermissionErrors(hostPage, 'host', permissionErrors);
  watchForPermissionErrors(guestPage, 'guest', permissionErrors);
  hostPage.on('dialog', (dialog) => dialog.accept());
  guestPage.on('dialog', (dialog) => dialog.accept());

  try {
    step('Sign in two users with the Auth emulator Google fake-login popup');
    await Promise.all([
      signInWithFakeGoogle(hostPage, accounts.host),
      signInWithFakeGoogle(guestPage, accounts.guest),
    ]);
    pass('Both users signed in');

    const firstRoomName = `disconnect-${ROOM_SUFFIX}`;
    step('Create the first room and join it with the guest');
    const firstRoom = await createJoinedRoom(
      hostPage,
      guestPage,
      firstRoomName,
      monitorToken,
    );
    pass(`First room ready (${firstRoom.roomId})`);

    step('Take the non-owner context offline; the room must remain alive');
    await guestContext.setOffline(true);
    await poll('guest connections removed and game player marked offline', async () => {
      const room = await databaseGet(`rooms/${firstRoom.roomId}`, monitorToken);
      return (
        !room?.connections?.[firstRoom.guestUid]
        && room?.gameState?.players?.[firstRoom.guestUid]?.isOnline === false
        && room
      );
    });
    await assertRoomExists(firstRoom.roomId, firstRoom.hostUid, monitorToken);
    await waitForRoomUrl(hostPage, firstRoom.roomId);
    pass('Guest went offline without deleting or ejecting the host from the room');

    step('Bring the non-owner context online; it must return to the same room');
    await guestContext.setOffline(false);
    await waitForRoomUrl(guestPage, firstRoom.roomId);
    await poll('guest connection and game player recover after reconnect', async () => {
      const room = await databaseGet(`rooms/${firstRoom.roomId}`, monitorToken);
      return (
        connectionCount(room, firstRoom.guestUid) === 1
        && room?.gameState?.players?.[firstRoom.guestUid]?.isOnline === true
        && room
      );
    });
    await assertRoomExists(firstRoom.roomId, firstRoom.hostUid, monitorToken);
    pass('Guest presence recovered in the original room');

    step('Open the guest account in a second tab and disconnect only one tab');
    guestMirrorContext = await browser.newContext();
    const guestMirrorPage = await guestMirrorContext.newPage();
    watchForPermissionErrors(guestMirrorPage, 'guest-mirror', permissionErrors);
    guestMirrorPage.on('dialog', (dialog) => dialog.accept());
    await signInWithFakeGoogle(guestMirrorPage, accounts.guest, true);
    await guestMirrorPage.goto(`${BASE_URL}/rooms/${firstRoom.roomId}`, { waitUntil: 'domcontentloaded' });
    await waitForRoomUrl(guestMirrorPage, firstRoom.roomId);
    await poll('two active guest connections', async () => {
      const room = await databaseGet(`rooms/${firstRoom.roomId}`, monitorToken);
      return connectionCount(room, firstRoom.guestUid) === 2 && room;
    });

    await guestContext.setOffline(true);
    await poll('one guest connection remains online', async () => {
      const room = await databaseGet(`rooms/${firstRoom.roomId}`, monitorToken);
      return connectionCount(room, firstRoom.guestUid) === 1 && room;
    });
    await sleep(1_800);
    const guestTabRoom = await assertRoomExists(firstRoom.roomId, firstRoom.hostUid, monitorToken);
    if (guestTabRoom.gameState?.players?.[firstRoom.guestUid]?.isOnline !== true) {
      throw new Error('Closing one guest tab incorrectly marked the player offline.');
    }
    await guestContext.setOffline(false);
    await poll('both guest connections recover', async () => {
      const room = await databaseGet(`rooms/${firstRoom.roomId}`, monitorToken);
      return connectionCount(room, firstRoom.guestUid) === 2 && room;
    });
    await guestMirrorContext.close();
    guestMirrorContext = null;
    await poll('guest returns to one connection after mirror closes', async () => {
      const room = await databaseGet(`rooms/${firstRoom.roomId}`, monitorToken);
      return connectionCount(room, firstRoom.guestUid) === 1 && room;
    });
    pass('One disconnected guest tab did not trigger offline state or turn forfeiture');

    step('Open and close a same-context cloned owner tab');
    const clonedOwnerPromise = hostPage.waitForEvent('popup');
    await hostPage.evaluate((url) => window.open(url, '_blank'), `${BASE_URL}/rooms/${firstRoom.roomId}`);
    clonedOwnerPage = await clonedOwnerPromise;
    await waitForRoomUrl(clonedOwnerPage, firstRoom.roomId);
    await poll('cloned owner tab gets an independent connection', async () => {
      const room = await databaseGet(`rooms/${firstRoom.roomId}`, monitorToken);
      return connectionCount(room, firstRoom.hostUid) === 2 && room;
    });
    await clonedOwnerPage.close();
    clonedOwnerPage = null;
    await poll('closing the cloned tab keeps the primary owner connection', async () => {
      const room = await databaseGet(`rooms/${firstRoom.roomId}`, monitorToken);
      return connectionCount(room, firstRoom.hostUid) === 1 && room;
    });
    pass('A cloned tab did not share or delete the primary owner connection slot');

    step('Open the owner account in a second browser context');
    mirrorContext = await browser.newContext();
    const mirrorPage = await mirrorContext.newPage();
    watchForPermissionErrors(mirrorPage, 'host-mirror', permissionErrors);
    mirrorPage.on('dialog', (dialog) => dialog.accept());
    await signInWithFakeGoogle(mirrorPage, accounts.host, true);
    await mirrorPage.goto(`${BASE_URL}/rooms/${firstRoom.roomId}`, { waitUntil: 'domcontentloaded' });
    await waitForRoomUrl(mirrorPage, firstRoom.roomId);
    await poll('two active owner connections', async () => {
      const room = await databaseGet(`rooms/${firstRoom.roomId}`, monitorToken);
      return connectionCount(room, firstRoom.hostUid) >= 2 && room;
    });
    pass('Both owner tabs registered independent Firebase connections');

    step('Navigate one owner tab to the lobby without disconnecting the other');
    await hostPage.goto(`${BASE_URL}/rooms`, { waitUntil: 'domcontentloaded' });
    await waitForLobby(hostPage);
    await poll('one owner connection remains after SPA unmount cleanup', async () => {
      const room = await databaseGet(`rooms/${firstRoom.roomId}`, monitorToken);
      return connectionCount(room, firstRoom.hostUid) === 1 && room;
    });
    await assertRoomExists(firstRoom.roomId, firstRoom.hostUid, monitorToken);
    await hostPage.goto(`${BASE_URL}/rooms/${firstRoom.roomId}`, { waitUntil: 'domcontentloaded' });
    await waitForRoomUrl(hostPage, firstRoom.roomId);
    await poll('owner primary connection returns after SPA navigation', async () => {
      const room = await databaseGet(`rooms/${firstRoom.roomId}`, monitorToken);
      return connectionCount(room, firstRoom.hostUid) === 2 && room;
    });
    pass('SPA cleanup preserved the room while another owner tab stayed connected');

    step('Close one owner tab; the room must stay while the second tab is online');
    await hostPage.close();
    await poll('one owner connection remains', async () => {
      const room = await databaseGet(`rooms/${firstRoom.roomId}`, monitorToken);
      const count = connectionCount(room, firstRoom.hostUid);
      if (count !== 1) throw new Error(`owner connections=${count}, roomExists=${Boolean(room)}`);
      return room;
    });
    await assertRoomExists(firstRoom.roomId, firstRoom.hostUid, monitorToken);
    await waitForRoomUrl(guestPage, firstRoom.roomId);
    pass('Closing one of multiple owner connections did not delete the room');

    hostPage = await hostContext.newPage();
    watchForPermissionErrors(hostPage, 'host-reopened', permissionErrors);
    hostPage.on('dialog', (dialog) => dialog.accept());
    await hostPage.goto(`${BASE_URL}/rooms/${firstRoom.roomId}`, { waitUntil: 'domcontentloaded' });
    await waitForRoomUrl(hostPage, firstRoom.roomId);
    await poll('owner primary connection returns', async () => {
      const room = await databaseGet(`rooms/${firstRoom.roomId}`, monitorToken);
      return connectionCount(room, firstRoom.hostUid) >= 2 && room;
    });
    await mirrorContext.close();
    mirrorContext = null;
    await poll('only the primary owner connection remains', async () => {
      const room = await databaseGet(`rooms/${firstRoom.roomId}`, monitorToken);
      return connectionCount(room, firstRoom.hostUid) === 1 && room;
    });

    step('Take the last owner context offline; the room must be deleted and guest redirected');
    const guestLobbyAfterOwnerOffline = guestPage.waitForURL((url) => url.pathname === '/rooms', {
      timeout: DEFAULT_TIMEOUT,
    });
    const firstRoomDeletion = waitForRoomAbsent(firstRoom.roomId, monitorToken);
    hostOffline = true;
    await hostContext.setOffline(true);
    await Promise.all([guestLobbyAfterOwnerOffline, firstRoomDeletion]);
    await waitForRoomCardAbsent(guestPage, firstRoomName);
    pass('Owner disconnect deleted the room and redirected the guest');

    step('Reconnect the owner; it must go to the lobby without recreating the room');
    const hostLobbyAfterReconnect = hostPage.waitForURL((url) => url.pathname === '/rooms', {
      timeout: DEFAULT_TIMEOUT,
    });
    await hostContext.setOffline(false);
    hostOffline = false;
    await hostLobbyAfterReconnect;
    await Promise.all([
      waitForRoomCardAbsent(hostPage, firstRoomName),
      waitForRoomCardAbsent(guestPage, firstRoomName),
    ]);
    await sleep(2_000);
    await assertRoomAbsentNow(firstRoom.roomId, monitorToken);
    await Promise.all([
      waitForRoomCardAbsent(hostPage, firstRoomName),
      waitForRoomCardAbsent(guestPage, firstRoomName),
    ]);
    pass('The deleted room stayed absent from RTDB and both lobbies for 2 seconds');

    const soloRoomName = `solo-owner-${ROOM_SUFFIX}`;
    step('Create an owner-only room, then disconnect with only a lobby observer remaining');
    await hostPage.getByRole('button', { name: '새 게임 방 만들기' }).click();
    await hostPage.locator('#roomName').fill(soloRoomName);
    await hostPage.getByRole('button', { name: '방 만들기' }).click();
    await hostPage.waitForURL((url) => /^\/rooms\/[^/]+$/.test(url.pathname), {
      timeout: DEFAULT_TIMEOUT,
    });
    const soloRoomId = currentPath(hostPage).split('/').filter(Boolean).at(-1);
    if (!soloRoomId) throw new Error('Could not read the owner-only room id.');
    await poll('owner-only room connection to register', async () => {
      const room = await databaseGet(`rooms/${soloRoomId}`, monitorToken);
      return room?.connections?.[room.createdBy] && room;
    });
    hostOffline = true;
    await hostContext.setOffline(true);
    await waitForRoomAbsent(soloRoomId, monitorToken);
    await waitForRoomCardAbsent(guestPage, soloRoomName);
    await hostContext.setOffline(false);
    hostOffline = false;
    await waitForLobby(hostPage);
    pass('A lobby observer removed the disconnected owner-only room after the grace period');

    const freshRoomName = `close-owner-${ROOM_SUFFIX}`;
    step('Create a fresh room for the abrupt owner context.close scenario');
    const freshRoom = await createJoinedRoom(
      hostPage,
      guestPage,
      freshRoomName,
      monitorToken,
    );
    pass(`Fresh room ready (${freshRoom.roomId})`);

    step('Close the owner browser context; the guest must move and the room must be deleted');
    const guestLobbyAfterOwnerClose = guestPage.waitForURL((url) => url.pathname === '/rooms', {
      timeout: DEFAULT_TIMEOUT,
    });
    const freshRoomDeletion = waitForRoomAbsent(freshRoom.roomId, monitorToken);
    await hostContext.close();
    hostContextClosed = true;
    await Promise.all([guestLobbyAfterOwnerClose, freshRoomDeletion]);
    await waitForRoomCardAbsent(guestPage, freshRoomName);
    await sleep(2_000);
    await assertRoomAbsentNow(freshRoom.roomId, monitorToken);
    await waitForRoomCardAbsent(guestPage, freshRoomName);
    pass('Owner context.close deleted the fresh room and it stayed absent');

    if (permissionErrors.length > 0) {
      throw new Error(`Permission errors were reported:\n${permissionErrors.join('\n')}`);
    }

    console.log('\nAll owner-disconnect emulator E2E scenarios passed.');
  } finally {
    if (clonedOwnerPage) await clonedOwnerPage.close().catch(() => {});
    if (guestMirrorContext) await guestMirrorContext.close().catch(() => {});
    if (!hostContextClosed) {
      if (hostOffline) await hostContext.setOffline(false).catch(() => {});
      await hostContext.close().catch(() => {});
    }
    await guestContext.close().catch(() => {});
    if (mirrorContext) await mirrorContext.close().catch(() => {});
    await browser.close().catch(() => {});
  }
}

main().catch((error) => {
  console.error(`\nOwner-disconnect E2E failed: ${errorMessage(error)}`);
  process.exitCode = 1;
});
