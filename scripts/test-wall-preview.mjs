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
};

const fire = findSafeWallActionPreviewPlan('fireWall', baseContext);
assert.ok(fire?.wall && fire.segment, 'a fire preview gets an empty in-board wall segment');
assert.notDeepEqual(fire.from, position(0, 0));
assert.notDeepEqual(fire.to, position(5, 5));

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

const wormhole = findSafeWallActionPreviewPlan('wormhole', baseContext);
assert.equal(wormhole?.kind, 'wormhole');
assert.notDeepEqual(wormhole?.from, wormhole?.to);
assert.ok(
  !baseContext.reservedPositions.some((reserved) =>
    (reserved.row === wormhole?.from.row && reserved.col === wormhole?.from.col) ||
    (reserved.row === wormhole?.to.row && reserved.col === wormhole?.to.col)
  ),
  'wormhole preview cells stay clear of map markers'
);

console.log('wall action preview planning tests passed');
