import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parsePlist } from './plistParse';
// Reference parser (plist's Node build) imported by path to dodge bare-specifier exports.
import * as plistRef from '../../../node_modules/plist/dist/index.js';

// Normalize Uint8Array/Buffer to hex so structural comparison ignores byte-array type.
function norm(v: any): any {
  if (v instanceof Uint8Array || Buffer.isBuffer(v)) return 'DATA:' + Buffer.from(v).toString('hex');
  if (Array.isArray(v)) return v.map(norm);
  if (v && typeof v === 'object') {
    const o: any = {};
    for (const k of Object.keys(v)) o[k] = norm(v[k]);
    return o;
  }
  return v;
}

test('parsePlist matches the reference plist parser on a nested document', () => {
  const doc = {
    Header: { Version: '1.0.1' },
    Response: {
      Status: { hsc: 200, ec: 0, em: '', rsh: false, ok: true },
      s: Buffer.from('00112233445566778899aabbccddeeff', 'hex'),
      i: 20208,
      sp: 's2k',
      list: ['a', 'b', 3, true],
      note: 'a & b < c > d "e" \'f\'',
    },
  };
  const xml = (plistRef as any).build(doc);
  assert.deepEqual(norm(parsePlist(xml)), norm((plistRef as any).parse(xml)));
});

test('parsePlist reads a real-shaped GSA Status response', () => {
  const xml =
    "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n" +
    "<!DOCTYPE plist PUBLIC \"-//Apple//DTD PLIST 1.0//EN\" \"http://www.apple.com/DTDs/PropertyList-1.0.dtd\">\n" +
    "<plist version=\"1.0\">\n<dict>\n  <key>Response</key>\n  <dict>\n" +
    "    <key>Status</key>\n    <dict>\n      <key>hsc</key><integer>200</integer>\n" +
    "      <key>ec</key><integer>0</integer>\n      <key>em</key><string></string>\n" +
    "      <key>au</key><string>secondaryAuth</string>\n    </dict>\n" +
    "    <key>spd</key><data>AQIDBA==</data>\n  </dict>\n</dict>\n</plist>";
  const parsed = parsePlist(xml) as any;
  assert.equal(parsed.Response.Status.hsc, 200);
  assert.equal(parsed.Response.Status.ec, 0);
  assert.equal(parsed.Response.Status.em, '');
  assert.equal(parsed.Response.Status.au, 'secondaryAuth');
  assert.deepEqual(Array.from(parsed.Response.spd as Uint8Array), [1, 2, 3, 4]);
});

test('parsePlist handles the idms.pet token path with dotted keys', () => {
  const xml =
    '<plist version="1.0"><dict><key>adsid</key><string>ABC</string>' +
    '<key>t</key><dict><key>com.apple.gs.idms.pet</key><dict>' +
    '<key>token</key><string>PET123</string><key>expiry</key><integer>300</integer>' +
    '</dict></dict></dict></plist>';
  const parsed = parsePlist(xml) as any;
  assert.equal(parsed.adsid, 'ABC');
  assert.equal(parsed.t['com.apple.gs.idms.pet'].token, 'PET123');
});
