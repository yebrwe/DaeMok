'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');
const ts = require('typescript');

const ROOT = path.join(__dirname, '..');

function loadTypeScript(relativePath) {
  const filename = path.join(ROOT, relativePath);
  const source = fs.readFileSync(filename, 'utf8');
  const output = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true,
    },
    fileName: filename,
  }).outputText;
  const loaded = new Module(filename, module);
  loaded.filename = filename;
  loaded.paths = Module._nodeModulePaths(path.dirname(filename));
  loaded._compile(output, filename);
  return loaded.exports;
}

const privacy = loadTypeScript('src/lib/legacyGamePrivacy.ts');

const fakeCollision = {
  playerId: 'runner-a',
  mapOwnerId: 'owner-b',
  position: { row: 2, col: 3 },
  direction: 'right',
  timestamp: 123,
  identifiedAsFake: true,
};
const otherCollision = {
  playerId: 'runner-b',
  mapOwnerId: 'owner-a',
  position: { row: 1, col: 1 },
  direction: 'down',
  timestamp: 124,
  identifiedAsFake: true,
};

const recordState = {
  phase: 'play',
  players: {},
  collisionWalls: { private: fakeCollision },
};
const sanitizedRecord = privacy.sanitizeLegacyGameStateForSharedWrite(recordState);
assert.notEqual(sanitizedRecord, recordState, 'shared-write sanitization clones the game state');
assert.equal(
  sanitizedRecord.collisionWalls.private.identifiedAsFake,
  undefined,
  'private insight marker is removed from record-form RTDB state'
);
assert.equal(
  recordState.collisionWalls.private.identifiedAsFake,
  true,
  'shared-write sanitization does not mutate the reducer result'
);

const sanitizedArray = privacy.sanitizeLegacyGameStateForSharedWrite({
  ...recordState,
  collisionWalls: [fakeCollision, otherCollision],
});
assert.deepEqual(
  sanitizedArray.collisionWalls.map((collision) => collision.identifiedAsFake),
  [undefined, undefined],
  'private markers are also removed from legacy array-form state'
);

const privateKey = privacy.legacyPrivateCollisionKey(fakeCollision);
const localProjection = privacy.projectLegacyCollisionsForLocalRunner(
  [fakeCollision, otherCollision],
  'runner-a',
  'owner-b',
  new Set([privateKey])
);
assert.equal(
  localProjection[0].identifiedAsFake,
  true,
  'the colliding runner rebuilds their own private insight marker locally'
);
assert.equal(
  localProjection[1].identifiedAsFake,
  undefined,
  'an old marker belonging to another runner is stripped from the local projection'
);

const opponentProjection = privacy.projectLegacyCollisionsForLocalRunner(
  [fakeCollision],
  'runner-b',
  'owner-a',
  new Set([privateKey])
);
assert.equal(
  opponentProjection[0].identifiedAsFake,
  undefined,
  'another viewer cannot reconstruct the insight marker from shared collision data'
);

assert.equal(
  privacy.projectLegacyIllusionStatusForControlledRunner,
  undefined,
  'legacy clients expose no helper that can project illusion progress or its anchor'
);
assert.equal(
  privacy.sanitizeLegacyHiddenIllusionMessage(
    '환영벽을 통과했습니다. 다음 3번의 행동 동안 벽이 환영처럼 열립니다.'
  ),
  '플레이어가 한 칸 이동했습니다.',
  'a stale legacy activation message is rendered as an ordinary move'
);
assert.equal(
  privacy.sanitizeLegacyHiddenIllusionMessage('달리기자가 환영 속에서 한 칸 이동했습니다.'),
  '달리기자가 한 칸 이동했습니다.',
  'a stale legacy progress message preserves only the ordinary runner move'
);
assert.equal(
  privacy.sanitizeLegacyHiddenIllusionMessage(
    '달리기자의 환영이 깨져 처음 관통한 원래 막힌 벽 직전으로 돌아갔습니다.'
  ),
  '달리기자의 환영이 깨져 처음 관통한 원래 막힌 벽 직전으로 돌아갔습니다.',
  'the visible wake-up return message is preserved'
);

const gamePlaySource = fs.readFileSync(path.join(ROOT, 'src/components/GamePlay.tsx'), 'utf8');
assert.match(
  gamePlaySource,
  /sanitizeHiddenIllusionResolutionForPresentation\(resolved,\s*userId\)/u,
  'legacy multiplayer sanitizes activation and progress before writing or rendering the turn'
);

const practiceSource = fs.readFileSync(path.join(ROOT, 'src/components/PracticeBattle.tsx'), 'utf8');
assert.match(
  practiceSource,
  /sanitizeHiddenIllusionResolutionForPresentation\(resolved,\s*runnerId\)/u,
  'practice and map tests sanitize hidden illusion feedback before rendering it'
);
for (const source of [gamePlaySource, practiceSource]) {
  assert.doesNotMatch(
    source,
    /projectLegacyIllusionStatusForControlledRunner|illusionActionsRemaining|illusionReturnFixed/u,
    'legacy play surfaces never derive illusion progress or return-anchor status'
  );
}

const gameRoomSource = fs.readFileSync(path.join(ROOT, 'src/components/GameRoom.tsx'), 'utf8');
const spectatorStageSource = gameRoomSource.slice(
  gameRoomSource.indexOf('const renderSpectatorStage = () =>'),
  gameRoomSource.indexOf('\n  // 방 나가기 처리', gameRoomSource.indexOf('const renderSpectatorStage = () =>'))
);
assert.doesNotMatch(
  spectatorStageSource,
  /illusionActionsRemaining|illusionReturnFixed/u,
  'legacy spectator boards never receive private illusion progress or return-anchor status'
);

const liveBoardSource = fs.readFileSync(path.join(ROOT, 'src/components/LiveBoardGrid.tsx'), 'utf8');
assert.doesNotMatch(
  liveBoardSource,
  /illusionActionsRemaining|illusionReturnFixed|data-illusion-actions|data-illusion-return-fixed|data-status-badge="illusion"|환영 상태:/u,
  'live-board status, diagnostics, and aria text never reveal the hidden illusion state'
);

console.log('LEGACY GAME PRIVACY: PASS');
