import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderTime } from './renderTime';

test('12-hour formatting handles the midnight and noon boundaries', () => {
  // The two cases a naive `hour % 12` gets wrong.
  assert.equal(renderTime(0, 0, false), '12:00 AM');
  assert.equal(renderTime(12, 0, false), '12:00 PM');

  assert.equal(renderTime(1, 5, false), '1:05 AM');
  assert.equal(renderTime(11, 59, false), '11:59 AM');
  assert.equal(renderTime(12, 1, false), '12:01 PM');
  assert.equal(renderTime(13, 5, false), '1:05 PM');
  assert.equal(renderTime(23, 59, false), '11:59 PM');
});

test('24-hour formatting zero-pads both fields', () => {
  assert.equal(renderTime(0, 0, true), '00:00');
  assert.equal(renderTime(9, 5, true), '09:05');
  assert.equal(renderTime(21, 5, true), '21:05');
  assert.equal(renderTime(23, 59, true), '23:59');
});
