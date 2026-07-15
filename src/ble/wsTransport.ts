// Web dev transport: InfiniSim's TCP GATT bridge reached through the
// ws-tcp proxy (scripts/ws-tcp-proxy.mjs), since browsers cannot open raw TCP.
// Same framing as TcpTransport (bridgeFraming.ts); only the pipe differs.

import { BridgeCharId, TransportError, WatchTransport } from './transport';
import { BridgeResponse, FrameParser, encodeBridgeRequest } from './bridgeFraming';

type Pending = { resolve: (r: BridgeResponse) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> };

const REQUEST_TIMEOUT_MS = 5000;
const CONNECT_TIMEOUT_MS = 5000;

export class WsTransport implements WatchTransport {
  private socket?: WebSocket;
  private parser = new FrameParser();
  private pending: Pending[] = [];

  async connect(deviceId: string): Promise<void> {
    const [host, portStr] = deviceId.split(':');
    const port = Number(portStr ?? 18633);
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        socket.close();
        reject(new TransportError(`timed out reaching ws-tcp proxy at ${host}:${port} — is "npm run sim:proxy" running?`));
      }, CONNECT_TIMEOUT_MS);
      const socket = new WebSocket(`ws://${host}:${port}`);
      socket.binaryType = 'arraybuffer';
      socket.onopen = () => {
        clearTimeout(timer);
        resolve();
      };
      socket.onerror = () => {
        clearTimeout(timer);
        this.failAll(new TransportError('proxy connection error'));
        reject(new TransportError(`cannot reach ws-tcp proxy at ${host}:${port} — is "npm run sim:proxy" running?`));
      };
      socket.onmessage = (event: MessageEvent) => {
        const chunk = new Uint8Array(event.data as ArrayBuffer);
        for (const response of this.parser.feed(chunk)) {
          const pending = this.pending.shift();
          if (pending) {
            clearTimeout(pending.timer);
            pending.resolve(response);
          }
        }
      };
      socket.onclose = () => this.failAll(new TransportError('proxy connection closed'));
      this.socket = socket;
    });
  }

  private failAll(error: Error) {
    for (const p of this.pending.splice(0)) {
      clearTimeout(p.timer);
      p.reject(error);
    }
  }

  private request(charId: BridgeCharId, op: 0 | 1, data: Uint8Array): Promise<BridgeResponse> {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      return Promise.reject(new TransportError('not connected'));
    }
    this.socket.send(encodeBridgeRequest(charId, op, data));
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
    return 512; // WebSocket has no MTU concern
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
    if (this.socket) {
      this.socket.onclose = null;
      this.socket.close();
      this.socket = undefined;
    }
    this.parser.reset();
    this.failAll(new TransportError('disconnected'));
  }
}
