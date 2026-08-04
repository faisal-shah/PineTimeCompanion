import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseWatches } from './store';

// The watch list carries the schedule and task sync base. While a watch's
// firmware is being replaced that base is the only copy of its data, so the
// difference between "there are no watches" and "the store could not be read"
// decides whether an empty list gets written back over a real one.

test('an unusable or missing store reads as no watches', () => {
  assert.deepEqual(parseWatches(null), [], 'nothing stored yet');
  assert.deepEqual(parseWatches('not json'), [], 'unparseable');
  assert.deepEqual(parseWatches('{"not":"an array"}'), [], 'wrong top-level shape');
});

test('entries from an older shape are dropped, not migrated', () => {
  const good = { id: 'a', name: 'Watch', schedule: { items: [], version: 1 }, tasks: { items: [], version: 1 } };
  const stale = { id: 'b', name: 'Old' }; // no schedule/tasks lists
  const parsed = parseWatches(JSON.stringify([good, stale]));
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].id, 'a');
});

// loadWatches itself is not unit-tested: the guarantee there is the absence of
// a catch, so that a storage failure reaches the caller instead of arriving as
// an empty list. useAppBootstrap holds the other half -- it leaves `loaded`
// false on a rejection, and the save effect is gated on it.
