import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergeSamples, dateKey } from './stepsStore';

test('mergeSamples keeps the max steps per date and sorts ascending', () => {
  let h = mergeSamples([], '2026-07-15', 3000);
  h = mergeSamples(h, '2026-07-16', 5000);
  h = mergeSamples(h, '2026-07-15', 8000); // later read same day (running total climbed)
  assert.deepEqual(h, [
    { date: '2026-07-15', steps: 8000 },
    { date: '2026-07-16', steps: 5000 },
  ]);
});

test('mergeSamples never lowers a day (a smaller read is ignored)', () => {
  let h = mergeSamples([], '2026-07-16', 9000);
  h = mergeSamples(h, '2026-07-16', 200); // e.g. read right after midnight rollover elsewhere
  assert.equal(h[0].steps, 9000);
});

test('mergeSamples caps history length', () => {
  let h: ReturnType<typeof mergeSamples> = [];
  for (let i = 0; i < 80; i++) {
    const d = new Date(2026, 0, 1 + i);
    h = mergeSamples(h, dateKey(d), i * 100);
  }
  assert.equal(h.length, 60);
  // Oldest kept is day index 20 (80 - 60).
  assert.equal(h[0].steps, 20 * 100);
  assert.equal(h.at(-1)!.steps, 79 * 100);
});

test('dateKey formats a local YYYY-MM-DD', () => {
  assert.equal(dateKey(new Date(2026, 6, 5)), '2026-07-05');
});
