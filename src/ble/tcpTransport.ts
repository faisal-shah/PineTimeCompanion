// Dev transport: InfiniSim's TCP GATT bridge (sim/gatt_bridge.h framing).
// From the Android emulator the host machine is 10.0.2.2. Uses
// react-native-tcp-socket, which mirrors node's net API closely enough.

import TcpSocket from 'react-native-tcp-socket';
import { Buffer } from 'buffer';
import { BridgeCharId, TransportError, WatchTransport } from './transport';

type Pending = { resolve: (r: { status: number; payload: Uint8Array }) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> };

const REQUEST_TIMEOUT_MS = 5000;
const CONNECT_TIMEOUT_MS = 5000;

export class TcpTransport implements WatchTransport {
  private socket?: ReturnType<typeof TcpSocket.createConnection>;
  private buffer = new Uint8Array(0);
  private pending: Pending[] = [];

  async connect(deviceId: string): Promise<void> {
    const [host, portStr] = deviceId.split(':');
    const port = Number(portStr ?? 18632);
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new TransportError(`timed out reaching sim bridge at ${host}:${port}`)), CONNECT_TIMEOUT_MS);
      const socket = TcpSocket.createConnection({ host, port }, () => {
        clearTimeout(timer);
        resolve();
      });
      socket.on('error', (e: Error) => {
        this.failAll(new TransportError(`bridge connection error: ${e.message}`, e));
        reject(new TransportError(`cannot reach sim bridge at ${host}:${port}`, e));
      });
      socket.on('data', (data: unknown) => {
        const chunk = typeof data === 'string' ? new TextEncoder().encode(data) : new Uint8Array(data as Uint8Array);
        const merged = new Uint8Array(this.buffer.length + chunk.length);
        merged.set(this.buffer);
        merged.set(chunk, this.buffer.length);
        this.buffer = merged;
        this.drain();
      });
      socket.on('close', () => this.failAll(new TransportError('bridge connection closed')));
      this.socket = socket;
    });
  }

  private drain() {
    while (this.pending.length > 0 && this.buffer.length >= 3) {
      const len = this.buffer[1] | (this.buffer[2] << 8);
      if (this.buffer.length < 3 + len) {
        return;
      }
      const status = this.buffer[0];
      const payload = this.buffer.slice(3, 3 + len);
      this.buffer = this.buffer.slice(3 + len);
      const pending = this.pending.shift()!;
      clearTimeout(pending.timer);
      pending.resolve({ status, payload });
    }
  }

  private failAll(error: Error) {
    for (const p of this.pending.splice(0)) {
      clearTimeout(p.timer);
      p.reject(error);
    }
  }

  private request(charId: BridgeCharId, op: 0 | 1, data: Uint8Array): Promise<{ status: number; payload: Uint8Array }> {
    if (!this.socket) {
      return Promise.reject(new TransportError('not connected'));
    }
    const frame = new Uint8Array(4 + data.length);
    frame[0] = charId;
    frame[1] = op;
    frame[2] = data.length & 0xff;
    frame[3] = data.length >> 8;
    frame.set(data, 4);
    this.socket.write(Buffer.from(frame) as unknown as Uint8Array & string);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const i = this.pending.findIndex((p) => p.timer === timer);
        if (i >= 0) {
          this.pending.splice(i, 1);
        }
        reject(new TransportError('bridge request timed out'));
      }, REQUEST_TIMEOUT_MS);
      this.pending.push({ resolve, reject, timer });
    });
  }

  async requestMtu(_mtu: number): Promise<number> {
    return 512; // TCP has no MTU concern
  }

  async write(charId: BridgeCharId, data: Uint8Array): Promise<void> {
    const { status } = await this.request(charId, 0, data);
    if (status !== 0) {
      throw new TransportError(`write to char ${charId} rejected (status ${status})`);
    }
  }

  async read(charId: BridgeCharId): Promise<Uint8Array> {
    const { status, payload } = await this.request(charId, 1, new Uint8Array(0));
    if (status !== 0) {
      throw new TransportError(`read of char ${charId} rejected (status ${status})`);
    }
    return payload;
  }

  async disconnect(): Promise<void> {
    this.socket?.destroy();
    this.socket = undefined;
    this.failAll(new TransportError('disconnected'));
  }
}
