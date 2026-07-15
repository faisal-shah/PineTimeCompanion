import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergeFixes } from './locationStore';
import { LocationFix } from '../findmy/decrypt';

const NOW = 1_700_000_000_000; // fixed "now" in ms
const fix = (timestamp: number, lat = 1, lon = 2): LocationFix => ({ timestamp, lat, lon, accuracy: 10, battery: 0 });

test('mergeFixes sorts ascending and dedupes identical fixes', () => {
  const now = NOW / 1000;
  const merged = mergeFixes([fix(now - 100)], [fix(now - 50), fix(now - 100), fix(now - 200)], NOW);
  assert.deepEqual(merged.map((f) => f.timestamp), [now - 200, now - 100, now - 50]);
});

test('mergeFixes keeps distinct coordinates at the same timestamp', () => {
  const now = NOW / 1000;
  const merged = mergeFixes([], [fix(now, 1, 2), fix(now, 3, 4)], NOW);
  assert.equal(merged.length, 2);
});

test('mergeFixes drops fixes older than 30 days', () => {
  const now = NOW / 1000;
  const old = now - 31 * 24 * 60 * 60;
  const merged = mergeFixes([fix(old)], [fix(now)], NOW);
  assert.deepEqual(merged.map((f) => f.timestamp), [now]);
});
