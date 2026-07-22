import assert from 'node:assert/strict';
import {
  createWallActionPreviewPlanAtTarget,
  findSafeWallActionPreviewPlan,
} from '../src/lib/wallPreview.ts';

const position = (row, col) => ({ row, col });
const baseContext = {
  boardSize: 6,
  obstacles: [],
  items: [],
  reservedPositions: [position(0, 0), position(5, 5)],
  goalPosition: position(5, 5),
};

const fire = findSafeWallActionPreviewPlan('fireWall', baseContext);
assert.ok(fire?.wall && fire.segment, 'a fire preview gets an empty in-board wall segment');
assert.notDeepEqual(fire.from, position(0, 0));
assert.notDeepEqual(fire.to, position(5, 5));
assert.deepEqual(fire.result, fire.from, 'fire blocks the triggering move');
assert.equal(fire.wallConsumed, true, 'fire is consumed on its first collision');

const occupiedTarget = { position: position(2, 2), direction: 'right' };
assert.equal(
  createWallActionPreviewPlanAtTarget('poisonWall', occupiedTarget, {
    ...baseContext,
    obstacles: [occupiedTarget],
  }),
  null,
  'an installed ordinary wall cannot host a preview'
);
assert.equal(
  createWallActionPreviewPlanAtTarget('poisonWall', occupiedTarget, {
    ...baseContext,
    items: [{
      type: 'fireWall',
      wallPosition: position(2, 2),
      wallDirection: 'right',
    }],
  }),
  null,
  'an installed special wall cannot host another preview'
);
assert.equal(
  createWallActionPreviewPlanAtTarget('poisonWall', occupiedTarget, {
    ...baseContext,
    reservedPositions: [position(2, 2)],
  }),
  null,
  'start/end/item cells cannot host the shadow clone'
);

const poison = createWallActionPreviewPlanAtTarget('poisonWall', occupiedTarget, baseContext);
assert.ok(poison?.resultDirection, 'poison preview exposes input and resolved directions');
assert.deepEqual(poison?.result, poison?.to, 'poison crosses the triggering wall');
assert.equal(poison?.wallConsumed, true, 'poison disappears after triggering');

for (const type of ['fogWall', 'illusionWall']) {
  const preview = createWallActionPreviewPlanAtTarget(type, occupiedTarget, baseContext);
  assert.deepEqual(preview?.result, preview?.to, `${type} crosses the triggering segment`);
  assert.equal(preview?.actionCost, 1, `${type} consumes one action`);
  assert.equal(preview?.wallConsumed, true, `${type} disappears after activation`);
}

const ice = createWallActionPreviewPlanAtTarget('iceWall', occupiedTarget, baseContext);
assert.deepEqual(ice?.result, ice?.from, 'ice blocks and leaves the pawn on its original cell');
assert.equal(ice?.actionCost, 2, 'one ice collision consumes two actions total');
assert.equal(ice?.wallConsumed, true, 'ice disappears after its first collision');

const windUp = createWallActionPreviewPlanAtTarget('windWall', occupiedTarget, {
  ...baseContext,
  previewEffectDirection: 'up',
});
assert.equal(windUp?.effectDirection, 'up');
assert.deepEqual(windUp?.result, position(1, 2), 'wind redirects from the original cell');
assert.equal(windUp?.effectBlocked, false);
assert.equal(windUp?.wallConsumed, true, 'wind disappears after redirecting');

const windThroughConsumedTrigger = createWallActionPreviewPlanAtTarget('windWall', occupiedTarget, {
  ...baseContext,
  previewEffectDirection: 'right',
});
assert.deepEqual(
  windThroughConsumedTrigger?.result,
  position(2, 3),
  'same-direction wind can cross the triggering segment after that wall disappears'
);

const windAgainstStaticWall = createWallActionPreviewPlanAtTarget('windWall', occupiedTarget, {
  ...baseContext,
  previewEffectDirection: 'up',
  obstacles: [{ position: position(2, 2), direction: 'up' }],
});
assert.deepEqual(windAgainstStaticWall?.result, position(2, 2));
assert.equal(windAgainstStaticWall?.effectBlocked, true, 'a static wall keeps redirected wind in place');

const windAgainstLiveWall = createWallActionPreviewPlanAtTarget('windWall', occupiedTarget, {
  ...baseContext,
  previewEffectDirection: 'up',
  items: [{
    type: 'steelWall',
    wallPosition: position(2, 2),
    wallDirection: 'up',
  }],
});
assert.deepEqual(windAgainstLiveWall?.result, position(2, 2));
assert.equal(windAgainstLiveWall?.effectBlocked, true, 'a live item wall blocks the forced step');

const windIntoGoal = createWallActionPreviewPlanAtTarget('windWall', occupiedTarget, {
  ...baseContext,
  previewEffectDirection: 'up',
  goalPosition: position(1, 2),
  reservedPositions: [],
});
assert.deepEqual(windIntoGoal?.result, position(2, 2));
assert.equal(windIntoGoal?.effectBlocked, true, 'a forced step never places the pawn directly on goal');

const boundaryWindTarget = { position: position(0, 2), direction: 'right' };
const boundaryWind = createWallActionPreviewPlanAtTarget('windWall', boundaryWindTarget, {
  ...baseContext,
  previewEffectDirection: 'up',
});
assert.deepEqual(boundaryWind?.result, position(0, 2));
assert.equal(boundaryWind?.effectBlocked, true, 'board bounds keep redirected wind in place');

const thorn = createWallActionPreviewPlanAtTarget('thornWall', occupiedTarget, baseContext);
assert.equal(thorn?.effectDirection, 'left', 'thorn rebounds opposite the triggering input');
assert.deepEqual(thorn?.result, position(2, 1));
assert.equal(thorn?.wallConsumed, true, 'thorn disappears after rebounding');

const blockedThorn = createWallActionPreviewPlanAtTarget('thornWall', occupiedTarget, {
  ...baseContext,
  obstacles: [{ position: position(2, 2), direction: 'left' }],
});
assert.deepEqual(blockedThorn?.result, position(2, 2));
assert.equal(blockedThorn?.effectBlocked, true, 'blocked thorn rebound stays on its original cell');

for (const [type, consumed] of [
  ['oneTimeWall', true],
  ['steelWall', false],
  ['phaseWall', false],
  ['crystalWall', true],
  ['mirrorWall', true],
]) {
  assert.equal(
    createWallActionPreviewPlanAtTarget(type, occupiedTarget, baseContext)?.wallConsumed,
    consumed,
    `${type} preview consumption metadata matches runtime`,
  );
}

const wormhole = findSafeWallActionPreviewPlan('wormhole', baseContext);
assert.equal(wormhole?.kind, 'wormhole');
assert.notDeepEqual(wormhole?.from, wormhole?.to);
assert.deepEqual(wormhole?.result, wormhole?.to);
assert.ok(
  !baseContext.reservedPositions.some((reserved) =>
    (reserved.row === wormhole?.from.row && reserved.col === wormhole?.from.col) ||
    (reserved.row === wormhole?.to.row && reserved.col === wormhole?.to.col)
  ),
  'wormhole preview cells stay clear of map markers'
);

console.log('wall action preview planning tests passed');
