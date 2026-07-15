// Minimal XML property-list parser for Apple's GrandSlam / mobileme responses.
//
// The `plist` npm package parses via a DOM (DOMParser / @xmldom/xmldom), which
// does not work reliably under Hermes — GSA responses fail with "malformed
// document. First element should be <plist>". Building plists is fine (string
// generation), so we keep `plist.build` for requests and use this parser for
// responses. It covers the plist subset Apple uses: dict, array, string,
// integer, real, true, false, data, date. No DOM, no external deps.

import { Buffer } from 'buffer';

export type PlistValue =
  | string
  | number
  | boolean
  | Uint8Array
  | PlistValue[]
  | { [key: string]: PlistValue };

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

function decodeEntities(s: string): string {
  return s.replace(/&(#x?[0-9a-fA-F]+|\w+);/g, (_, e: string) => {
    if (e[0] === '#') {
      const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return String.fromCodePoint(code);
    }
    return ENTITIES[e] ?? `&${e};`;
  });
}

interface Tag {
  name: string;
  closing: boolean;
  selfClosing: boolean;
}

class Scanner {
  private pos = 0;
  constructor(private readonly xml: string) {}

  /** Next element tag, skipping declarations (<?...?>), doctypes/comments (<!...>) and text between tags. */
  nextTag(): Tag | null {
    while (this.pos < this.xml.length) {
      const lt = this.xml.indexOf('<', this.pos);
      if (lt < 0) {
        return null;
      }
      const gt = this.xml.indexOf('>', lt + 1);
      if (gt < 0) {
        return null;
      }
      const raw = this.xml.slice(lt + 1, gt);
      this.pos = gt + 1;
      if (raw[0] === '?' || raw[0] === '!') {
        continue; // <?xml?>, <!DOCTYPE>, <!-- -->
      }
      const closing = raw[0] === '/';
      const selfClosing = raw[raw.length - 1] === '/';
      const name = raw.replace(/^\//, '').replace(/\/$/, '').trim().split(/\s/)[0];
      return { name, closing, selfClosing };
    }
    return null;
  }

  /** Raw text from the current position up to the next '<'. */
  readText(): string {
    const lt = this.xml.indexOf('<', this.pos);
    const end = lt < 0 ? this.xml.length : lt;
    const text = this.xml.slice(this.pos, end);
    this.pos = end;
    return text;
  }
}

function parseValue(scanner: Scanner, openTag: Tag): PlistValue {
  switch (openTag.name) {
    case 'true':
      return true;
    case 'false':
      return false;
    case 'string': {
      if (openTag.selfClosing) return '';
      const t = decodeEntities(scanner.readText());
      scanner.nextTag(); // consume </string>
      return t;
    }
    case 'integer': {
      if (openTag.selfClosing) return 0;
      const t = scanner.readText().trim();
      scanner.nextTag();
      return parseInt(t, 10);
    }
    case 'real': {
      if (openTag.selfClosing) return 0;
      const t = scanner.readText().trim();
      scanner.nextTag();
      return parseFloat(t);
    }
    case 'date': {
      if (openTag.selfClosing) return '';
      const t = scanner.readText().trim();
      scanner.nextTag();
      return t;
    }
    case 'data': {
      if (openTag.selfClosing) return new Uint8Array(0);
      const t = scanner.readText().replace(/\s+/g, '');
      scanner.nextTag();
      return new Uint8Array(Buffer.from(t, 'base64'));
    }
    case 'array': {
      const arr: PlistValue[] = [];
      if (openTag.selfClosing) return arr;
      for (;;) {
        const tag = scanner.nextTag();
        if (!tag || (tag.closing && tag.name === 'array')) break;
        arr.push(parseValue(scanner, tag));
      }
      return arr;
    }
    case 'dict': {
      const obj: { [key: string]: PlistValue } = {};
      if (openTag.selfClosing) return obj;
      for (;;) {
        const keyTag = scanner.nextTag();
        if (!keyTag || (keyTag.closing && keyTag.name === 'dict')) break;
        if (keyTag.name !== 'key') continue;
        const key = keyTag.selfClosing ? '' : decodeEntities(scanner.readText());
        if (!keyTag.selfClosing) scanner.nextTag(); // consume </key>
        const valTag = scanner.nextTag();
        if (!valTag) break;
        obj[key] = parseValue(scanner, valTag);
      }
      return obj;
    }
    default:
      return '';
  }
}

/** Parse an XML plist string into a JS value. */
export function parsePlist(xml: string): PlistValue {
  const scanner = new Scanner(xml);
  let tag = scanner.nextTag();
  if (tag && tag.name === 'plist') {
    tag = scanner.nextTag(); // first value inside <plist>
  }
  if (!tag) {
    throw new Error('empty plist');
  }
  return parseValue(scanner, tag);
}
