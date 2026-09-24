const test = require('node:test');
const assert = require('node:assert');
const { expected, update } = require('./elo');

test('equal ratings give 50% expectation', () => {
  assert.strictEqual(expected(1200, 1200), 0.5);
});

test('winner gains what loser loses', () => {
  const [w, l] = update(1200, 1200);
  assert.strictEqual(w, 1216);
  assert.strictEqual(l, 1184);
});

test('upset moves ratings more than expected win', () => {
  const [upsetW] = update(1000, 1400);
  const [favW] = update(1400, 1000);
  assert.ok(upsetW - 1000 > favW - 1400);
});
