import { test } from 'node:test';
import assert from 'node:assert/strict';
import { describeMissing } from './resourcesUpload';

// Reported from hardware: a resources upload stopped partway, the watch was left
// without /fonts/lv_font_dots_40.bin, and the Casio watch face rendered an empty
// box where the week and day go — while the app reported "Resources uploaded".
// Re-uploading fixed it. These pin the check that now refuses to call that a
// success.

const wanted = new Map([
  ['/fonts/7segments_40.bin', 760],
  ['/fonts/lv_font_dots_40.bin', 1840],
  ['/images/pine_small.bin', 2143],
]);

test('a complete upload reports no problem', () => {
  assert.equal(describeMissing(wanted, new Map(wanted)), null);
});

test('a file that never arrived is named', () => {
  const seen = new Map(wanted);
  seen.delete('/fonts/lv_font_dots_40.bin');
  const msg = describeMissing(wanted, seen);
  assert.match(msg ?? '', /missing 1 of 3/);
  assert.match(msg ?? '', /lv_font_dots_40\.bin \(missing\)/);
});

test('a truncated file is caught, not just an absent one', () => {
  // The failure mode that matters: the file exists, so a presence-only check
  // would pass, but it is short and the font will not load.
  const seen = new Map(wanted);
  seen.set('/fonts/lv_font_dots_40.bin', 512);
  const msg = describeMissing(wanted, seen);
  assert.match(msg ?? '', /lv_font_dots_40\.bin \(512 bytes, expected 1840\)/);
});

test('every bad file is listed, not just the first', () => {
  const seen = new Map([['/fonts/7segments_40.bin', 760]]);
  const msg = describeMissing(wanted, seen);
  assert.match(msg ?? '', /missing 2 of 3/);
  assert.match(msg ?? '', /lv_font_dots_40/);
  assert.match(msg ?? '', /pine_small/);
});

test('extra files on the watch are not treated as a failure', () => {
  const seen = new Map(wanted);
  seen.set('/fonts/left-over-from-an-older-build.bin', 99);
  assert.equal(describeMissing(wanted, seen), null);
});
