#!/usr/bin/env node

'use strict';

const path = require('node:path');
const { spawn } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const FIREBASE_CONFIG = 'firebase.maze-authority-browser-test.json';

function runFirebase() {
  return new Promise((resolve, reject) => {
    const executable = process.platform === 'win32' ? 'npx.cmd' : 'npx';
    const child = spawn(executable, [
      'firebase-tools',
      'emulators:exec',
      '--config', FIREBASE_CONFIG,
      '--only', 'auth,database,functions',
      '--project', 'daemok-155c1',
      'node scripts/run-maze-authority-browser-e2e.cjs',
    ], {
      cwd: ROOT,
      env: {
        ...process.env,
        npm_config_cache: process.env.npm_config_cache || '/tmp/daemok-npm-cache',
      },
      stdio: 'inherit',
    });
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`Firebase Maze Authority browser harness exited with ${signal || code}`));
    });
  });
}

runFirebase().catch((error) => {
  console.error(error);
  process.exit(1);
});
