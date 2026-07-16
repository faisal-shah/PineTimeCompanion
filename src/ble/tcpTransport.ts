// Dev transport: InfiniSim's TCP GATT bridge (sim/gatt_bridge.h framing).
// From the Android emulator the host machine is 10.0.2.2. Uses
// react-native-tcp-socket, which mirrors node's net API closely enough.

import TcpSocket from 'react-native-tcp-socket';
import { Buffer } from 'buffer';
import { BridgeCharId, TransportError, WatchTransport } from './transport';
import { BridgeResponse, FrameParser, encodeBridgeRequest } from './bridgeFraming';

type Pending = { resolve: (r: BridgeResponse) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> };
type Subscriber = (data: Uint8Array) => void;

const REQUEST_TIMEOUT_MS = 5000;
const CONNECT_TIMEOUT_MS = 5000;

export class TcpTransport implements WatchTransport {
  private socket?: ReturnType<typeof TcpSocket.createConnection>;
  private parser = new FrameParser();
  private pending: Pending[] = [];
  private subscribers = new Map<number, Set<Subscriber>>();

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
        this.onFrames(chunk);
      });
      socket.on('close', () => this.failAll(new TransportError('bridge connection closed')));
      this.socket = socket;
    });
  }

  private onFrames(chunk: Uint8Array) {
    for (const frame of this.parser.feed(chunk)) {
      if (frame.kind === 'notify') {
        this.subscribers.get(frame.charId)?.forEach((cb) => cb(frame.payload));
        continue;
      }
      const pending = this.pending.shift();
      if (pending) {
        clearTimeout(pending.timer);
        pending.resolve(frame);
      }
    }
  }

  private failAll(error: Error) {
    for (const p of this.pending.splice(0)) {
      clearTimeout(p.timer);
      p.reject(error);
    }
  }

  private request(charId: BridgeCharId, op: 0 | 1, data: Uint8Array): Promise<BridgeResponse> {
    if (!this.socket) {
      return Promise.reject(new TransportError('not connected'));
    }
    this.socket.write(Buffer.from(encodeBridgeRequest(charId, op, data)) as unknown as Uint8Array & string);
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

  async writeWithoutResponse(charId: BridgeCharId, data: Uint8Array): Promise<void> {
    if (!this.socket) {
      throw new TransportError('not connected');
    }
    // op 2 = write-no-response: the bridge processes but sends no reply frame.
    this.socket.write(Buffer.from(encodeBridgeRequest(charId, 2, data)) as unknown as Uint8Array & string);
  }

  async read(charId: BridgeCharId): Promise<Uint8Array> {
    const { status, payload } = await this.request(charId, 1, new Uint8Array(0));
    if (status !== 0) {
      throw new TransportError(`read of char ${charId} rejected (status ${status})`);
    }
    return payload;
  }

  async subscribe(charId: BridgeCharId, cb: Subscriber): Promise<() => void> {
    // The sim bridge auto-pushes notification frames for every firmware notify,
    // so subscribing is purely local routing — no CCCD write on the wire.
    let set = this.subscribers.get(charId);
    if (!set) {
      set = new Set();
      this.subscribers.set(charId, set);
    }
    set.add(cb);
    return () => set!.delete(cb);
  }

  async disconnect(): Promise<void> {
    this.socket?.destroy();
    this.socket = undefined;
    this.parser.reset();
    this.subscribers.clear();
    this.failAll(new TransportError('disconnected'));
  }
}
