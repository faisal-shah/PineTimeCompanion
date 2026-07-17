// Adafruit BLE File Transfer client for InfiniTime's FSService (0xFEBB, transfer
// char adaf0200), over the WatchTransport seam. Every command is a write to the
// transfer char; the watch replies with a notification on the same char. It is
// strictly lockstep — one command outstanding at a time — so we subscribe once
// and match responses by command byte. Protocol: InfiniTime/doc/BLEFS.md.

import { BRIDGE_CHAR, WatchTransport } from './transport';
import { NotificationInbox } from './notificationInbox';

const FS_TIMEOUT_MS = 8000;
// Data bytes per WRITE_DATA packet. 12-byte header + 235 data stays within a
// modest negotiated MTU; larger risks truncation on real hardware.
const WRITE_CHUNK = 235;

// Command / response bytes.
const CMD_WRITE = 0x20;
const RSP_WRITE_PACING = 0x21;
const CMD_WRITE_DATA = 0x22;
const CMD_DELETE = 0x30;
const RSP_DELETE = 0x31;
const CMD_MKDIR = 0x40;
const RSP_MKDIR = 0x41;
const CMD_LISTDIR = 0x50;
const RSP_LISTDIR = 0x51;

const LFS_ERR_EXIST = -17; // mkdir on an existing directory; treated as success.

export class FsError extends Error {}

export interface DirEntry {
  path: string;
  isDirectory: boolean;
  size: number;
}

// signed 8-bit status byte from a response.
const status = (n: Uint8Array) => (n[1] << 24) >> 24;

export class FsClient {
  private inbox = new NotificationInbox(FS_TIMEOUT_MS);
  private unsubscribe?: () => void;
  private readonly enc = new TextEncoder();

  constructor(private readonly transport: WatchTransport) {}

  async begin(): Promise<void> {
    this.unsubscribe = await this.transport.subscribe(BRIDGE_CHAR.fsTransfer, (n) => this.inbox.push(n));
  }

  end(): void {
    this.unsubscribe?.();
    this.unsubscribe = undefined;
  }

  private send(bytes: Uint8Array): Promise<void> {
    return this.transport.write(BRIDGE_CHAR.fsTransfer, bytes);
  }

  private waitCmd(cmd: number, timeoutMs?: number): Promise<Uint8Array> {
    return this.inbox.wait((n) => n[0] === cmd, timeoutMs);
  }

  /** Create a directory. Succeeds if it already exists. */
  async makeDir(path: string): Promise<void> {
    const name = this.enc.encode(path);
    const buf = new Uint8Array(16 + name.length);
    const dv = new DataView(buf.buffer);
    dv.setUint8(0, CMD_MKDIR);
    dv.setUint16(2, name.length, true);
    // padding2 (u32 @4) and time (u64 @8) left zero.
    buf.set(name, 16);
    await this.send(buf);
    const resp = await this.waitCmd(RSP_MKDIR);
    const st = status(resp);
    if (st !== 0x01 && st !== LFS_ERR_EXIST) {
      throw new FsError(`mkdir ${path} failed (status ${st})`);
    }
  }

  /** Delete a file. Missing files are ignored (nothing to remove). */
  async deleteFile(path: string): Promise<void> {
    const name = this.enc.encode(path);
    const buf = new Uint8Array(4 + name.length);
    const dv = new DataView(buf.buffer);
    dv.setUint8(0, CMD_DELETE);
    dv.setUint16(2, name.length, true);
    buf.set(name, 4);
    await this.send(buf);
    await this.waitCmd(RSP_DELETE); // status is best-effort; a missing file is fine.
  }

  /**
   * Write a whole file, creating/overwriting it. Chunks the data in WRITE_CHUNK
   * blocks with a strict write -> notify -> write lockstep. The WRITE_DATA
   * response status is unreliable on success (the firmware leaves it
   * uninitialized), so completion is tracked client-side by offset and the
   * watch's reported free space guards against a full disk.
   */
  async writeFile(path: string, data: Uint8Array, onProgress?: (sent: number, total: number) => void): Promise<void> {
    const name = this.enc.encode(path);
    const header = new Uint8Array(20 + name.length);
    const hv = new DataView(header.buffer);
    hv.setUint8(0, CMD_WRITE);
    hv.setUint16(2, name.length, true);
    hv.setUint32(4, 0, true); // start offset
    // modTime (u64 @8) left zero.
    hv.setUint32(16, data.length, true); // total size
    header.set(name, 20);
    await this.send(header);
    const opened = await this.waitCmd(RSP_WRITE_PACING);
    if (status(opened) !== 0x01) {
      throw new FsError(`open-for-write ${path} failed (status ${status(opened)})`);
    }

    let offset = 0;
    while (offset < data.length) {
      const chunk = data.subarray(offset, Math.min(offset + WRITE_CHUNK, data.length));
      const pkt = new Uint8Array(12 + chunk.length);
      const pv = new DataView(pkt.buffer);
      pv.setUint8(0, CMD_WRITE_DATA);
      pv.setUint8(1, 0x01);
      pv.setUint32(4, offset, true);
      pv.setUint32(8, chunk.length, true);
      pkt.set(chunk, 12);
      await this.send(pkt);
      const resp = await this.waitCmd(RSP_WRITE_PACING);
      offset += chunk.length;
      const freespace = new DataView(resp.buffer, resp.byteOffset).getUint32(16, true);
      if (freespace === 0 && offset < data.length) {
        throw new FsError(`watch filesystem full while writing ${path} at ${offset}/${data.length}`);
      }
      onProgress?.(offset, data.length);
    }
  }

  /** List a directory. Returns entries (excluding the "." / ".." pseudo-entries). */
  async listDir(path: string): Promise<DirEntry[]> {
    const name = this.enc.encode(path);
    const buf = new Uint8Array(4 + name.length);
    const dv = new DataView(buf.buffer);
    dv.setUint8(0, CMD_LISTDIR);
    dv.setUint16(2, name.length, true);
    buf.set(name, 4);
    await this.send(buf);

    const entries: DirEntry[] = [];
    for (;;) {
      const resp = await this.waitCmd(RSP_LISTDIR);
      if (status(resp) < 0) {
        throw new FsError(`listdir ${path} failed (status ${status(resp)})`);
      }
      const rv = new DataView(resp.buffer, resp.byteOffset);
      const pathLen = rv.getUint16(2, true);
      const entry = rv.getUint32(4, true);
      const total = rv.getUint32(8, true);
      const flags = rv.getUint32(12, true);
      const size = rv.getUint32(24, true);
      if (pathLen === 0) break; // terminator (final entry has entry == total, empty path)
      const entryPath = new TextDecoder().decode(resp.subarray(28, 28 + pathLen));
      if (entryPath !== '.' && entryPath !== '..') {
        entries.push({ path: entryPath, isDirectory: (flags & 1) === 1, size });
      }
      if (entry >= total) break; // safety net if a firmware omits the empty terminator
    }
    return entries;
  }
}
