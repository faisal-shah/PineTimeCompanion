import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BRIDGE_CHAR } from './transport';
import { FrameParser, encodeBridgeRequest } from './bridgeFraming';

test('encodeBridgeRequest lays out header and payload', () => {
  const data = new Uint8Array([0xaa, 0xbb, 0xcc]);
  const frame = encodeBridgeRequest(BRIDGE_CHAR.beaconKey, 0, data);
  assert.deepEqual([...frame], [BRIDGE_CHAR.beaconKey, 0, 3, 0, 0xaa, 0xbb, 0xcc]);
});

test('encodeBridgeRequest encodes 16-bit lengths little-endian', () => {
  const data = new Uint8Array(0x0142); // 322 bytes
  const frame = encodeBridgeRequest(BRIDGE_CHAR.scheduleSync, 1, data);
  assert.equal(frame[2], 0x42);
  assert.equal(frame[3], 0x01);
  assert.equal(frame.length, 4 + 0x0142);
});

test('FrameParser parses a whole response in one chunk', () => {
  const parser = new FrameParser();
  const responses = parser.feed(new Uint8Array([0, 2, 0, 0x11, 0x22]));
  assert.equal(responses.length, 1);
  assert.equal(responses[0].status, 0);
  assert.deepEqual([...responses[0].payload], [0x11, 0x22]);
});

test('FrameParser reassembles a response split across chunks', () => {
  const parser = new FrameParser();
  assert.equal(parser.feed(new Uint8Array([0])).length, 0);
  assert.equal(parser.feed(new Uint8Array([3, 0, 0x01])).length, 0);
  const responses = parser.feed(new Uint8Array([0x02, 0x03]));
  assert.equal(responses.length, 1);
  assert.deepEqual([...responses[0].payload], [0x01, 0x02, 0x03]);
});

test('FrameParser splits merged responses in one chunk', () => {
  const parser = new FrameParser();
  const merged = new Uint8Array([0, 1, 0, 0xaa, 5, 0, 0, 0, 2, 0, 0xbb, 0xcc]);
  const responses = parser.feed(merged);
  assert.equal(responses.length, 3);
  assert.deepEqual([...responses[0].payload], [0xaa]);
  assert.equal(responses[1].status, 5);
  assert.equal(responses[1].payload.length, 0);
  assert.deepEqual([...responses[2].payload], [0xbb, 0xcc]);
});

test('FrameParser handles empty payload and reset', () => {
  const parser = new FrameParser();
  const responses = parser.feed(new Uint8Array([7, 0, 0]));
  assert.equal(responses.length, 1);
  assert.equal(responses[0].status, 7);
  parser.feed(new Uint8Array([0, 5])); // partial header left buffered
  parser.reset();
  // After reset the partial bytes are gone; a fresh frame parses cleanly.
  const fresh = parser.feed(new Uint8Array([1, 1, 0, 0x99]));
  assert.equal(fresh.length, 1);
  assert.equal(fresh[0].status, 1);
});
