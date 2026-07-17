import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FsClient, FsError } from './fsClient';
import { BRIDGE_CHAR, WatchTransport } from './transport';

// In-memory emulation of InfiniTime's FSService: it parses each command written
// to the transfer char and notifies a response with the real struct layout, so
// this exercises the client's byte packing/parsing, not just its control flow.
class MockFsWatch implements WatchTransport {
  readonly files = new Map<string, Uint8Array>();
  readonly dirs = new Set<string>();
  private notify?: (n: Uint8Array) => void;
  freespace = 1_000_000;

  async connect(): Promise<void> {}
  async requestMtu(): Promise<number> {
    return 512;
  }
  async read(): Promise<Uint8Array> {
    return new Uint8Array();
  }
  async disconnect(): Promise<void> {}
  async writeWithoutResponse(): Promise<void> {}

  async subscribe(charId: number, cb: (data: Uint8Array) => void): Promise<() => void> {
    assert.equal(charId, BRIDGE_CHAR.fsTransfer);
    this.notify = cb;
    return () => (this.notify = undefined);
  }

  private send(bytes: number[] | Uint8Array): void {
    const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    setTimeout(() => this.notify?.(arr), 0);
  }

  private str(buf: Uint8Array, off: number, len: number): string {
    return new TextDecoder().decode(buf.subarray(off, off + len));
  }

  async write(charId: number, data: Uint8Array): Promise<void> {
    assert.equal(charId, BRIDGE_CHAR.fsTransfer);
    const dv = new DataView(data.buffer, data.byteOffset);
    switch (data[0]) {
      case 0x40: {
        // MKDIR
        const plen = dv.getUint16(2, true);
        const path = this.str(data, 16, plen);
        const exists = this.dirs.has(path);
        this.dirs.add(path);
        const resp = new Uint8Array(16);
        resp[0] = 0x41;
        new DataView(resp.buffer).setInt8(1, exists ? -17 : 0x01);
        this.send(resp);
        break;
      }
      case 0x20: {
        // WRITE header
        const plen = dv.getUint16(2, true);
        const total = dv.getUint32(16, true);
        this.curPath = this.str(data, 20, plen);
        this.curBuf = new Uint8Array(total);
        this.sendWritePacing(0x01, 0);
        break;
      }
      case 0x22: {
        // WRITE_DATA
        const offset = dv.getUint32(4, true);
        const size = dv.getUint32(8, true);
        this.curBuf!.set(data.subarray(12, 12 + size), offset);
        if (offset + size >= this.curBuf!.length) this.files.set(this.curPath!, this.curBuf!);
        this.sendWritePacing(0x01, offset);
        break;
      }
      case 0x30: {
        // DELETE
        const plen = dv.getUint16(2, true);
        this.files.delete(this.str(data, 4, plen));
        this.send([0x31, 0x01]);
        break;
      }
      case 0x50: {
        // LISTDIR of a fixed set of children under the requested path.
        const plen = dv.getUint16(2, true);
        const dir = this.str(data, 4, plen);
        const kids = [...this.files.keys()]
          .filter((p) => p.startsWith(dir === '/' ? '/' : `${dir}/`))
          .map((p) => p.slice(dir === '/' ? 1 : dir.length + 1))
          .filter((p) => !p.includes('/'));
        const names = ['.', '..', ...kids];
        names.forEach((name, i) => this.send(this.listEntry(name, i, names.length, this.files.get(`${dir}/${name}`))));
        this.send(this.listEntry('', names.length, names.length, undefined)); // terminator
        break;
      }
      default:
        throw new Error(`unexpected FS command 0x${data[0].toString(16)}`);
    }
  }

  private curPath?: string;
  private curBuf?: Uint8Array;

  private sendWritePacing(status: number, offset: number): void {
    const resp = new Uint8Array(20);
    const dv = new DataView(resp.buffer);
    resp[0] = 0x21;
    dv.setInt8(1, status);
    dv.setUint32(4, offset, true);
    dv.setUint32(16, this.freespace, true);
    this.send(resp);
  }

  private listEntry(name: string, entry: number, total: number, file?: Uint8Array): Uint8Array {
    const nameBytes = new TextEncoder().encode(name);
    const resp = new Uint8Array(28 + nameBytes.length);
    const dv = new DataView(resp.buffer);
    resp[0] = 0x51;
    dv.setInt8(1, 0x01);
    dv.setUint16(2, nameBytes.length, true);
    dv.setUint32(4, entry, true);
    dv.setUint32(8, total, true);
    dv.setUint32(12, file ? 0 : 1, true); // no file -> treat as directory
    dv.setUint32(24, file?.length ?? 0, true);
    resp.set(nameBytes, 28);
    return resp;
  }
}

test('writeFile chunks a file larger than one packet and lands the exact bytes', async () => {
  const watch = new MockFsWatch();
  const fs = new FsClient(watch);
  await fs.begin();
  const data = new Uint8Array(600); // > 235, so 3 chunks
  for (let i = 0; i < data.length; i++) data[i] = (i * 7) & 0xff;
  const progress: number[] = [];
  await fs.writeFile('/fonts/big.bin', data, (sent) => progress.push(sent));
  fs.end();

  assert.deepEqual([...watch.files.get('/fonts/big.bin')!], [...data]);
  assert.deepEqual(progress, [235, 470, 600]); // lockstep chunk boundaries
});

test('makeDir tolerates an already-existing directory', async () => {
  const watch = new MockFsWatch();
  const fs = new FsClient(watch);
  await fs.begin();
  await fs.makeDir('/fonts'); // status 0x01
  await fs.makeDir('/fonts'); // status -17 EXIST, must not throw
  fs.end();
  assert.ok(watch.dirs.has('/fonts'));
});

test('listDir returns real entries and drops . / ..', async () => {
  const watch = new MockFsWatch();
  watch.files.set('/fonts/a.bin', new Uint8Array([1, 2, 3]));
  watch.files.set('/fonts/b.bin', new Uint8Array([4]));
  const fs = new FsClient(watch);
  await fs.begin();
  const entries = await fs.listDir('/fonts');
  fs.end();
  assert.deepEqual(
    entries.map((e) => [e.path, e.size]).sort(),
    [
      ['a.bin', 3],
      ['b.bin', 1],
    ],
  );
});

test('writeFile throws FsError if the watch reports a full disk mid-transfer', async () => {
  const watch = new MockFsWatch();
  watch.freespace = 0; // disk full
  const fs = new FsClient(watch);
  await fs.begin();
  await assert.rejects(fs.writeFile('/fonts/big.bin', new Uint8Array(600)), FsError);
  fs.end();
});
