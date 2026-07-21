import assert from 'node:assert/strict';
import { chooseWallPointerTarget } from '../src/lib/wallPointer.ts';

const target = (row, col, direction) => ({ position: { row, col }, direction });
const candidates = [
  {
    target: target(2, 2, 'right'),
    rect: { left: 104, right: 112, top: 60, bottom: 100 },
  },
  {
    target: target(2, 3, 'down'),
    rect: { left: 112, right: 152, top: 100, bottom: 108 },
  },
  {
    target: target(3, 2, 'right'),
    rect: { left: 104, right: 112, top: 108, bottom: 148 },
  },
  {
    target: target(2, 2, 'down'),
    rect: { left: 64, right: 104, top: 100, bottom: 108 },
  },
];

assert.deepEqual(chooseWallPointerTarget(candidates, 108, 101), target(2, 2, 'right'));
assert.deepEqual(chooseWallPointerTarget(candidates, 111, 104), target(2, 3, 'down'));
assert.deepEqual(chooseWallPointerTarget(candidates, 108, 107), target(3, 2, 'right'));
assert.deepEqual(chooseWallPointerTarget(candidates, 105, 104), target(2, 2, 'down'));

assert.deepEqual(
  chooseWallPointerTarget(candidates, 108, 104),
  target(2, 2, 'right'),
  'the exact center deterministically chooses the upward ray'
);
assert.deepEqual(
  chooseWallPointerTarget(candidates, 110, 102, target(2, 3, 'down')),
  target(2, 3, 'down'),
  'an already highlighted ray wins an exact diagonal tie'
);
assert.equal(
  chooseWallPointerTarget(candidates, 200, 200),
  null,
  'points outside the wall slop remain non-targets'
);

console.log('wall pointer four-way routing tests passed');
