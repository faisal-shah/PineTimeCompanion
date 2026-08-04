import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deriveActivity } from './watchActivity';

test('the app\u2019s own op takes precedence over everything', () => {
  assert.equal(deriveActivity(true, true, 'READY'), 'busy');
  assert.equal(deriveActivity(true, false, null), 'busy');
});

test('a coordinator hold outranks the native connection state', () => {
  assert.equal(deriveActivity(false, true, 'READY'), 'held');
});

test('native connection state maps when the link is otherwise free', () => {
  assert.equal(deriveActivity(false, false, 'CONNECTING'), 'connecting');
  assert.equal(deriveActivity(false, false, 'BACKOFF'), 'reconnecting');
  assert.equal(deriveActivity(false, false, 'READY'), 'connected');
});

test('nothing running is idle (the coherent web/desktop resting state)', () => {
  assert.equal(deriveActivity(false, false, null), 'idle');
  assert.equal(deriveActivity(false, false, 'IDLE'), 'idle');
});
