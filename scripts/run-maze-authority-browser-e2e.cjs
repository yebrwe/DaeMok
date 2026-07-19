#!/usr/bin/env node

'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const NEXT_PORT = Number(process.env.MAZE_AUTHORITY_BROWSER_NEXT_PORT || 3215);
const BASE_URL = `http://127.0.0.1:${NEXT_PORT}`;
const AUTH_PORT = Number(process.env.MAZE_AUTHORITY_BROWSER_AUTH_PORT || 9799);
const DATABASE_PORT = Number(process.env.MAZE_AUTHORITY_BROWSER_DATABASE_PORT || 9700);
const FUNCTIONS_PORT = Number(process.env.MAZE_AUTHORITY_BROWSER_FUNCTIONS_PORT || 5701);
const BROWSER_TEST_SCRIPT = 'scripts/e2e-maze-authority-browser.cjs';
const TEMP_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'daemok-maze-authority-browser-'));
const NEXT_SOURCE_DIRECTORIES = ['public', 'src'];
const NEXT_ROOT_FILES = [
  'next-env.d.ts',
  'next.config.ts',
  'package-lock.json',
  'package.json',
  'postcss.config.mjs',
  'tailwind.config.ts',
  'tsconfig.json',
];

function localPort(value, label) {
  assert.ok(Number.isSafeInteger(value) && value >= 1 && value <= 65_535, `${label} port is invalid`);
  return value;
}

function linkWorkspace() {
  for (const directory of NEXT_SOURCE_DIRECTORIES) {
    const source = path.join(ROOT, directory);
    if (fs.existsSync(source)) {
      fs.cpSync(source, path.join(TEMP_ROOT, directory), { recursive: true });
    }
  }
  for (const filename of NEXT_ROOT_FILES) {
    const source = path.join(ROOT, filename);
    if (fs.existsSync(source)) fs.copyFileSync(source, path.join(TEMP_ROOT, filename));
  }
  fs.symlinkSync(path.join(ROOT, 'node_modules'), path.join(TEMP_ROOT, 'node_modules'), 'junction');
}

function killProcessTree(child) {
  if (!child || child.exitCode !== null || !child.pid) return;
  try {
    process.kill(-child.pid, 'SIGTERM');
  } catch {
    try { child.kill('SIGTERM'); } catch {}
  }
}

async function waitForHttp(url, child, timeoutMs = 90_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Next exited early with code ${child.exitCode}`);
    try {
      const response = await fetch(url, { redirect: 'manual' });
      if (response.status >= 200 && response.status < 500) return;
      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Next did not become ready at ${url}: ${String(lastError)}`);
}

function runBrowserTest(env) {
  return new Promise((resolve, reject) => {
    const testPath = path.resolve(ROOT, BROWSER_TEST_SCRIPT);
    assert.equal(
      path.dirname(testPath),
      path.join(ROOT, 'scripts'),
      'Maze Authority browser test script must stay inside scripts/.',
    );
    const child = spawn(process.execPath, [testPath], {
      cwd: ROOT,
      env,
      stdio: 'inherit',
    });
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`Maze Authority browser E2E exited with ${signal || code}`));
    });
  });
}

(async () => {
  localPort(NEXT_PORT, 'Next');
  localPort(AUTH_PORT, 'Auth emulator');
  localPort(DATABASE_PORT, 'Database emulator');
  localPort(FUNCTIONS_PORT, 'Functions emulator');
  assert.ok(process.env.FIREBASE_DATABASE_EMULATOR_HOST, 'Run this harness inside firebase emulators:exec.');
  linkWorkspace();

  const env = {
    ...process.env,
    BASE_URL,
    NEXT_DIST_DIR: `.next-maze-authority-browser-${process.pid}`,
    EMULATOR: '1',
    FIREBASE_AUTH_EMULATOR_URL: `http://127.0.0.1:${AUTH_PORT}`,
    FIREBASE_DATABASE_EMULATOR_URL: `http://127.0.0.1:${DATABASE_PORT}`,
    FIREBASE_FUNCTIONS_EMULATOR_URL: `http://127.0.0.1:${FUNCTIONS_PORT}`,
    NEXT_PUBLIC_FIREBASE_EMULATOR: '1',
    NEXT_PUBLIC_FIREBASE_AUTH_EMULATOR_PORT: String(AUTH_PORT),
    NEXT_PUBLIC_FIREBASE_DATABASE_EMULATOR_PORT: String(DATABASE_PORT),
    NEXT_PUBLIC_FIREBASE_FUNCTIONS_EMULATOR_PORT: String(FUNCTIONS_PORT),
    NEXT_TELEMETRY_DISABLED: '1',
  };
  const next = spawn(
    path.join(ROOT, 'node_modules/.bin/next'),
    ['dev', '--hostname', '127.0.0.1', '--port', String(NEXT_PORT)],
    {
      cwd: TEMP_ROOT,
      env,
      detached: true,
      stdio: 'inherit',
    },
  );

  try {
    await waitForHttp(`${BASE_URL}/login`, next);
    await runBrowserTest(env);
  } finally {
    killProcessTree(next);
    await new Promise((resolve) => setTimeout(resolve, 500));
    fs.rmSync(TEMP_ROOT, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
