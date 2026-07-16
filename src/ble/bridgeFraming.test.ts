import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BRIDGE_CHAR } from './transport';
import { BridgeFrame, FrameParser, encodeBridgeRequest } from './bridgeFraming';

function responses(frames: BridgeFrame[]) {
  return frames.filter((f): f is Extract<BridgeFrame, { kind: 'response' }> => f.kind === 'response');
}

test('encodeBridgeRequest lays out header and payload', () => {
  const data = new Uint8Array([0xaa, 0xbb, 0xcc]);
  const frame = encodeBridgeRequest(BRIDGE_CHAR.beaconKey, 0, data);
  assert.deepEqual([...frame], [BRIDGE_CHAR.beaconKey, 0, 3, 0, 0xaa, 0xbb, 0xcc]);
});

test('encodeBridgeRequest supports write-without-response (op 2)', () => {
  const frame = encodeBridgeRequest(BRIDGE_CHAR.dfuPacket, 2, new Uint8Array([1, 2]));
  assert.deepEqual([...frame], [BRIDGE_CHAR.dfuPacket, 2, 2, 0, 1, 2]);
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
  const r = responses(parser.feed(new Uint8Array([0, 2, 0, 0x11, 0x22])));
  assert.equal(r.length, 1);
  assert.equal(r[0].status, 0);
  assert.deepEqual([...r[0].payload], [0x11, 0x22]);
});

test('FrameParser reassembles a response split across chunks', () => {
  const parser = new FrameParser();
  assert.equal(parser.feed(new Uint8Array([0])).length, 0);
  assert.equal(parser.feed(new Uint8Array([3, 0, 0x01])).length, 0);
  const r = responses(parser.feed(new Uint8Array([0x02, 0x03])));
  assert.equal(r.length, 1);
  assert.deepEqual([...r[0].payload], [0x01, 0x02, 0x03]);
});

test('FrameParser splits merged responses in one chunk', () => {
  const parser = new FrameParser();
  const merged = new Uint8Array([0, 1, 0, 0xaa, 5, 0, 0, 0, 2, 0, 0xbb, 0xcc]);
  const r = responses(parser.feed(merged));
  assert.equal(r.length, 3);
  assert.deepEqual([...r[0].payload], [0xaa]);
  assert.equal(r[1].status, 5);
  assert.equal(r[1].payload.length, 0);
  assert.deepEqual([...r[2].payload], [0xbb, 0xcc]);
});

test('FrameParser decodes a notification frame (0xF0 marker)', () => {
  const parser = new FrameParser();
  // [0xF0, charId=10, lenLo=3, lenHi=0, payload...]
  const frames = parser.feed(new Uint8Array([0xf0, 10, 3, 0, 0x10, 0x01, 0x01]));
  assert.equal(frames.length, 1);
  assert.equal(frames[0].kind, 'notify');
  if (frames[0].kind === 'notify') {
    assert.equal(frames[0].charId, 10);
    assert.deepEqual([...frames[0].payload], [0x10, 0x01, 0x01]);
  }
});

test('FrameParser interleaves notification and response frames', () => {
  const parser = new FrameParser();
  // notify(char 10, [0xAA]) then response(status 0, [0xBB])
  const frames = parser.feed(new Uint8Array([0xf0, 10, 1, 0, 0xaa, 0, 1, 0, 0xbb]));
  assert.equal(frames.length, 2);
  assert.equal(frames[0].kind, 'notify');
  assert.equal(frames[1].kind, 'response');
  if (frames[1].kind === 'response') {
    assert.deepEqual([...frames[1].payload], [0xbb]);
  }
});

test('FrameParser reassembles a notification split across chunks', () => {
  const parser = new FrameParser();
  assert.equal(parser.feed(new Uint8Array([0xf0, 11])).length, 0);
  assert.equal(parser.feed(new Uint8Array([2, 0, 0x99])).length, 0);
  const frames = parser.feed(new Uint8Array([0x88]));
  assert.equal(frames.length, 1);
  assert.equal(frames[0].kind, 'notify');
  if (frames[0].kind === 'notify') {
    assert.deepEqual([...frames[0].payload], [0x99, 0x88]);
  }
});

test('FrameParser handles empty payload and reset', () => {
  const parser = new FrameParser();
  const r = responses(parser.feed(new Uint8Array([7, 0, 0])));
  assert.equal(r.length, 1);
  assert.equal(r[0].status, 7);
  parser.feed(new Uint8Array([0, 5])); // partial header left buffered
  parser.reset();
  const fresh = responses(parser.feed(new Uint8Array([1, 1, 0, 0x99])));
  assert.equal(fresh.length, 1);
  assert.equal(fresh[0].status, 1);
});
