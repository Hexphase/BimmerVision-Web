const test = require('node:test');
const assert = require('node:assert/strict');
const {findStopBar} = require('../stop-bar');

function road(isPaint) {
  const pixels = new Uint8ClampedArray(640 * 480 * 4);
  for (let y = 245; y < 480; y++) {
    for (let x = 0; x < 640; x++) {
      const i = (y * 640 + x) * 4;
      pixels.fill(isPaint(x, y) ? 210 : 70, i, i + 3);
    }
  }
  return pixels;
}

test('detects a transverse stripe at a slight angle through the current lane', () => {
  const ends = findStopBar(road((x, y) => Math.abs(y - 289 - .08 * (x - 320)) < 2));
  assert.ok(ends && ends[0][0] < 320 && ends[1][0] > 320);
  assert.ok(ends[1][1] > ends[0][1]);
});

test('withholds longitudinal markings and repeated transverse stripes', () => {
  assert.equal(findStopBar(road((x, y) => Math.abs(x - 320 - (y - 232)) < 3)), null);
  assert.equal(findStopBar(road((x, y) => Math.abs(y - 289) < 2 || Math.abs(y - 314) < 2)), null);
});

test('distant transverse features and dim bands in shadow do not become a stop bar', () => {
  assert.equal(findStopBar(road((x, y) => Math.abs(y - 258) < 2)), null);
  const shaded = road((x, y) => Math.abs(y - 290) < 2);
  for (let i = 0; i < shaded.length; i++) {
    if (shaded[i] === 210) shaded[i] = 142;
  }
  assert.equal(findStopBar(shaded), null);
});

test('a sunlit gap between dark shadows matches the surrounding road', () => {
  const gap = road((x, y) => Math.abs(y - 289) < 2 || Math.abs(y - 289) > 8);
  assert.equal(findStopBar(gap), null);
});
