#!/usr/bin/env node

'use strict';

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const VENDOR_ROOT = path.join(ROOT, 'functions', 'vendor', 'maze-engine');
const VENDOR_SOURCE_ROOT = path.join(VENDOR_ROOT, 'src');
const CHECK_ONLY = process.argv.includes('--check');

const SOURCE_FILES = [
  {
    source: 'src/types/game.ts',
    target: 'types/game.ts',
  },
  {
    source: 'src/lib/diceWormhole.ts',
    target: 'lib/diceWormhole.ts',
    replacements: {
      "from '@/types/game'": "from '../types/game'",
    },
  },
  {
    source: 'src/lib/gameUtils.ts',
    target: 'lib/gameUtils.ts',
    replacements: {
      "from '@/types/game'": "from '../types/game'",
      "from '@/lib/diceWormhole'": "from './diceWormhole'",
    },
  },
  {
    source: 'src/lib/mazeSkills.ts',
    target: 'lib/mazeSkills.ts',
  },
  {
    source: 'src/lib/gameRules.ts',
    target: 'lib/gameRules.ts',
    replacements: {
      "from '@/types/game'": "from '../types/game'",
      "from '@/lib/gameUtils'": "from './gameUtils'",
      "from '@/lib/mazeSkills'": "from './mazeSkills'",
    },
  },
  {
    source: 'src/lib/gameTurn.ts',
    target: 'lib/gameTurn.ts',
    replacements: {
      "from '@/types/game'": "from '../types/game'",
      "from '@/lib/gameUtils'": "from './gameUtils'",
      "from '@/lib/diceWormhole'": "from './diceWormhole'",
    },
  },
];

const STATIC_FILES = {
  'src/index.ts': [
    "export * as GameTypes from './types/game';",
    "export * as DiceWormhole from './lib/diceWormhole';",
    "export * as GameUtils from './lib/gameUtils';",
    "export * as MazeSkills from './lib/mazeSkills';",
    "export * as GameRules from './lib/gameRules';",
    "export * as GameTurn from './lib/gameTurn';",
    '',
  ].join('\n'),
  'package.json': `${JSON.stringify({
    name: '@daemok/maze-engine-v4',
    version: '4.0.0',
    private: true,
    main: 'dist/index.js',
    types: 'dist/index.d.ts',
  }, null, 2)}\n`,
  'tsconfig.json': `${JSON.stringify({
    compilerOptions: {
      module: 'commonjs',
      target: 'es2022',
      lib: ['es2022'],
      rootDir: 'src',
      outDir: 'dist',
      declaration: true,
      sourceMap: true,
      strict: true,
      esModuleInterop: true,
      forceConsistentCasingInFileNames: true,
      noImplicitReturns: true,
      noUnusedLocals: true,
      skipLibCheck: true,
    },
    include: ['src'],
  }, null, 2)}\n`,
};

function generatedSource(entry) {
  let source = fs.readFileSync(path.join(ROOT, entry.source), 'utf8');
  for (const [from, to] of Object.entries(entry.replacements || {})) {
    if (!source.includes(from)) {
      throw new Error(`${entry.source}: missing expected import ${from}`);
    }
    source = source.split(from).join(to);
  }
  return [
    '// GENERATED FILE. Edit the canonical source under src/ and regenerate.',
    `// Source: ${entry.source}`,
    '',
    source,
  ].join('\n');
}

const expectedFiles = new Map(
  SOURCE_FILES.map((entry) => [path.join('src', entry.target), generatedSource(entry)])
);
for (const [relativePath, content] of Object.entries(STATIC_FILES)) {
  expectedFiles.set(relativePath, content);
}

function relativeFiles(directory, prefix = '') {
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const relativePath = path.join(prefix, entry.name);
    if (entry.isDirectory()) return relativeFiles(path.join(directory, entry.name), relativePath);
    return [relativePath];
  });
}

function checkGeneratedFiles() {
  const issues = [];
  for (const [relativePath, expected] of expectedFiles) {
    const target = path.join(VENDOR_ROOT, relativePath);
    if (!fs.existsSync(target)) {
      issues.push(`missing:${relativePath}`);
      continue;
    }
    if (fs.readFileSync(target, 'utf8') !== expected) issues.push(`drift:${relativePath}`);
  }
  const expectedSourceFiles = new Set(
    [...expectedFiles.keys()].filter((file) => file.startsWith(`src${path.sep}`))
  );
  for (const relativePath of relativeFiles(VENDOR_SOURCE_ROOT, 'src')) {
    if (!expectedSourceFiles.has(relativePath)) issues.push(`unexpected:${relativePath}`);
  }
  if (issues.length > 0) {
    throw new Error(`Maze engine vendor is not synchronized:\n${issues.join('\n')}`);
  }
}

if (CHECK_ONLY) {
  checkGeneratedFiles();
  console.log('MAZE ENGINE VENDOR: synchronized');
  process.exit(0);
}

fs.mkdirSync(VENDOR_SOURCE_ROOT, { recursive: true });
for (const [relativePath, content] of expectedFiles) {
  const target = path.join(VENDOR_ROOT, relativePath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content);
}
for (const relativePath of relativeFiles(VENDOR_SOURCE_ROOT, 'src')) {
  if (!expectedFiles.has(relativePath)) fs.rmSync(path.join(VENDOR_ROOT, relativePath));
}

checkGeneratedFiles();
console.log('MAZE ENGINE VENDOR: generated from canonical V4 sources');
