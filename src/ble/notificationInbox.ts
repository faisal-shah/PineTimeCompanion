import { TransportError } from './transport';

// A queue of characteristic notifications with predicate-based waiting. Used by
// the DFU control point and the BLE filesystem transfer char, which are both
// strict request/response: push every notification in, wait for the one that
// matches. A waiter that isn't satisfied within timeoutMs rejects with a
// TransportError so a stalled watch surfaces instead of hanging forever.
export class NotificationInbox {
  private queue: Uint8Array[] = [];
  private waiter?: { match: (n: Uint8Array) => boolean; resolve: (n: Uint8Array) => void };

  constructor(private readonly defaultTimeoutMs: number) {}

  push(n: Uint8Array): void {
    if (this.waiter && this.waiter.match(n)) {
      const w = this.waiter;
      this.waiter = undefined;
      w.resolve(n);
      return;
    }
    this.queue.push(n);
  }

  /**
   * Take an already-queued notification, or undefined if none matches. For
   * callers that must not block: the DFU transfer drains receipts this way so
   * it can keep streaming packets instead of stopping for each one.
   */
  tryTake(match: (n: Uint8Array) => boolean): Uint8Array | undefined {
    const idx = this.queue.findIndex(match);
    return idx >= 0 ? this.queue.splice(idx, 1)[0] : undefined;
  }

  wait(match: (n: Uint8Array) => boolean, timeoutMs = this.defaultTimeoutMs): Promise<Uint8Array> {
    const idx = this.queue.findIndex(match);
    if (idx >= 0) {
      return Promise.resolve(this.queue.splice(idx, 1)[0]);
    }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waiter = undefined;
        reject(new TransportError('timed out waiting for a notification'));
      }, timeoutMs);
      this.waiter = {
        match,
        resolve: (n) => {
          clearTimeout(timer);
          resolve(n);
        },
      };
    });
  }
}
