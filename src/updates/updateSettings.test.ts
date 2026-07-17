import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isValidRepo, DEFAULT_UPDATE_REPO } from './updateSettings';

test('isValidRepo accepts owner/repo slugs and rejects malformed ones', () => {
  assert.ok(isValidRepo('faisal-shah/InfiniTime'));
  assert.ok(isValidRepo(DEFAULT_UPDATE_REPO));
  assert.ok(isValidRepo('Org_1/my.repo-2'));

  assert.ok(!isValidRepo('InfiniTime')); // no slash
  assert.ok(!isValidRepo('a/b/c')); // too many segments
  assert.ok(!isValidRepo('has space/repo'));
  assert.ok(!isValidRepo('https://github.com/faisal-shah/InfiniTime'));
  assert.ok(!isValidRepo(''));
});
