// The app-level authority for one transient watch session.
//
// Every watch operation is a short connect -> do work -> disconnect cycle over
// the exclusive BLE link, and every such cycle must first release the native
// notification-forwarding link to the same watch and re-establish it after.
// Before this, that pause/resume was open-coded in the OTA path and simply
// missing from the ordinary sync ops. This coordinator is the single place that
// owns the whole envelope:
//
//   pause forwarding  ->  connect (bounded retry on transient failure)  ->
//   run the work  ->  disconnect  ->  resume forwarding (always, even if
//   connect never succeeded)
//
// It sits at the operation seam, above the WatchTransport interface: the
// transport stays a dumb GATT pipe with zero knowledge of forwarding, and the
// platform-native forwarder is injected as a small ForwardingGate rather than
// imported here. That keeps this module — and everything under the transport
// seam — free of native code and unit-testable under plain Node. The real gate
// is wired once at app start (src/notifications/forwardingGate.ts); tests inject
// their own or use the default no-op.

import type { WatchTransport } from './transport';
import { classifyBleError, TransportError } from './transportError';

/**
 * The seam to the native notification forwarder. `pause` must release the
 * forwarding link to a watch so a JS-driven op gets exclusive GATT access;
 * `resume` re-establishes it. On the simulator and web there is no forwarder,
 * so both are no-ops (the default gate).
 */
export interface ForwardingGate {
  pause(deviceId: string): Promise<void>;
  resume(deviceId: string): Promise<void>;
}

export const noopForwardingGate: ForwardingGate = {
  async pause() {},
  async resume() {},
};

/**
 * Bounded, small retry for *transient* connect failures only. Kept tiny on
 * purpose: a watch is either in range and listening or it is not, and a short
 * connect-work-disconnect op must not hang the UI behind a long retry loop.
 */
export interface RetryPolicy {
  /** Total connect attempts including the first. */
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
}

export const DEFAULT_RETRY_POLICY: RetryPolicy = { maxAttempts: 3, baseDelayMs: 200, maxDelayMs: 1000 };

/** Deterministic exponential backoff (no jitter) for retry index 0,1,2,... */
export function retryBackoffMs(retryIndex: number, policy: RetryPolicy = DEFAULT_RETRY_POLICY): number {
  const exp = policy.baseDelayMs * 2 ** retryIndex;
  return Math.min(exp, policy.maxDelayMs);
}

export type SleepFn = (ms: number) => Promise<void>;

const realSleep: SleepFn = (ms) => new Promise((r) => setTimeout(r, ms));

/** A watch currently held by one or more transient sessions. */
export interface ForwardingHold {
  deviceId: string;
  depth: number;
}

/**
 * Owns transient sessions and the forwarding pause/resume around them.
 *
 * Reference-counted per device at this JS seam so that overlapping ops on the
 * same watch pause the forwarder once (on 0 -> 1) and resume it once (on
 * 1 -> 0). The native ConnectionManager is independently reference-counted too;
 * this layer collapses the app's own overlaps and exposes ownership for the UI.
 */
export class ConnectionCoordinator {
  private held = new Map<string, number>();
  // The single native pause promise for the current batch on a device. Created
  // on the 0 -> 1 hold, awaited by every op in the batch, dropped on -> 0. Its
  // resolution is what proves the forwarder actually released the link.
  private pausePromises = new Map<string, Promise<void>>();
  // Per-device FIFO tail: the connect -> work -> disconnect critical section is
  // serialized so at most one transient transport session is connected to a
  // watch at a time. Different devices run concurrently.
  private tails = new Map<string, Promise<unknown>>();
  private listeners = new Set<(holds: ForwardingHold[]) => void>();

  constructor(
    private gate: ForwardingGate = noopForwardingGate,
    private policy: RetryPolicy = DEFAULT_RETRY_POLICY,
    private readonly sleep: SleepFn = realSleep,
  ) {}

  setGate(gate: ForwardingGate): void {
    this.gate = gate;
  }

  setPolicy(policy: RetryPolicy): void {
    this.policy = policy;
  }

  /** Snapshot of which watches are currently held, and how deep. */
  ownership(): ForwardingHold[] {
    return [...this.held.entries()].map(([deviceId, depth]) => ({ deviceId, depth }));
  }

  isHeld(deviceId: string): boolean {
    return (this.held.get(deviceId) ?? 0) > 0;
  }

  /** Observe ownership changes (for a later forwarding-status UI). */
  subscribe(cb: (holds: ForwardingHold[]) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  private emit(): void {
    const snapshot = this.ownership();
    for (const cb of this.listeners) {
      cb(snapshot);
    }
  }

  /**
   * Add a hold on the device and return the batch's pause promise. The first
   * hold (0 -> 1) starts the single native pause; later holds in the same batch
   * reuse it, so the forwarder is not re-paused between already-queued ops. The
   * ref-count is bumped synchronously so an overlapping op that arrives while
   * the pause is in flight keeps the batch alive (no resume in between).
   */
  private acquireHold(deviceId: string): Promise<void> {
    const depth = (this.held.get(deviceId) ?? 0) + 1;
    this.held.set(deviceId, depth);
    this.emit();
    if (depth === 1) {
      // Wrap in a resolved-then so a gate that throws synchronously still yields
      // a rejected promise (uniform handling below).
      const pause = Promise.resolve().then(() => this.gate.pause(deviceId));
      this.pausePromises.set(deviceId, pause);
      return pause;
    }
    return this.pausePromises.get(deviceId) ?? Promise.resolve();
  }

  /**
   * Drop a hold. Resumes forwarding only on the final release (1 -> 0), unless
   * `skipResume` (used to roll back after a pause that never took effect). A
   * release with no matching hold is ignored, so it can neither underflow the
   * count nor spuriously resume/restart a connection. A resume failure is
   * logged, never thrown: the user's work is already done and ownership state
   * is already consistent by the time resume runs.
   */
  private async releaseHold(deviceId: string, skipResume = false): Promise<void> {
    const current = this.held.get(deviceId) ?? 0;
    if (current <= 0) {
      return;
    }
    const depth = current - 1;
    if (depth === 0) {
      this.held.delete(deviceId);
      this.pausePromises.delete(deviceId);
    } else {
      this.held.set(deviceId, depth);
    }
    this.emit();
    if (depth === 0 && !skipResume) {
      try {
        await this.gate.resume(deviceId);
      } catch (e) {
        console.warn('could not resume forwarding:', (e as Error)?.message ?? e);
      }
    }
  }

  /**
   * Serialize `task` behind any in-flight session for the same device (FIFO).
   * The tail swallows errors so one failed op does not wedge the queue, and is
   * cleaned up once it is the last one to settle.
   */
  private runExclusive<T>(deviceId: string, task: () => Promise<T>): Promise<T> {
    const prev = this.tails.get(deviceId) ?? Promise.resolve();
    const result = prev.then(task, task);
    const tail = result.then(
      () => undefined,
      () => undefined,
    );
    this.tails.set(deviceId, tail);
    void tail.then(() => {
      if (this.tails.get(deviceId) === tail) {
        this.tails.delete(deviceId);
      }
    });
    return result;
  }

  /** Connect, retrying only transient failures, up to the policy bound. */
  async connectWithRetry(transport: WatchTransport, deviceId: string): Promise<void> {
    for (let retry = 0; ; retry++) {
      try {
        await transport.connect(deviceId);
        return;
      } catch (e) {
        // A connect that failed partway (link up, service discovery failed, MTU,
        // etc.) can leave a half-open GATT link. Left alone it makes the next
        // attempt come back already-connected/busy, so tear it down best-effort
        // before we retry or give up. Never let this cleanup mask the original
        // failure — that error is what the caller must see.
        await transport.disconnect().catch(() => undefined);
        const attemptsUsed = retry + 1;
        const { retryable } = classifyBleError(e);
        if (!retryable || attemptsUsed >= this.policy.maxAttempts) {
          throw e;
        }
        await this.sleep(retryBackoffMs(retry, this.policy));
      }
    }
  }

  /**
   * Run `fn` inside one coordinated transient session:
   *
   *   1. take a hold and pause forwarding (once per batch) — the pause MUST
   *      succeed, or the op aborts before connecting and the hold is rolled
   *      back, because connecting with the forwarder still live would break the
   *      watch's exclusive ownership;
   *   2. wait its turn behind any other session on the same device (FIFO);
   *   3. connect (bounded transient retry), run the work, disconnect;
   *   4. resume forwarding on the last release, always, even if the connect
   *      never succeeded.
   */
  async run<T>(transport: WatchTransport, deviceId: string, fn: () => Promise<T>): Promise<T> {
    const pause = this.acquireHold(deviceId);
    try {
      await pause;
    } catch (e) {
      // Pause failed: exclusive ownership was never obtained. Roll the hold back
      // (nothing to resume — the pause never took) and abort before any connect.
      await this.releaseHold(deviceId, true);
      throw new TransportError(`could not pause forwarding for ${deviceId} before connecting`, e);
    }
    try {
      return await this.runExclusive(deviceId, async () => {
        await this.connectWithRetry(transport, deviceId);
        try {
          return await fn();
        } finally {
          await transport.disconnect().catch(() => undefined);
        }
      });
    } finally {
      await this.releaseHold(deviceId);
    }
  }
}

// The app-wide default the operation seam uses. Its gate starts as a no-op and
// is replaced at app start by the real native forwarder (Android) or left inert
// (web/sim). Tests exercise ConnectionCoordinator directly instead of touching
// this singleton.
const defaultCoordinator = new ConnectionCoordinator();

export function getCoordinator(): ConnectionCoordinator {
  return defaultCoordinator;
}

/** Wire the real forwarding gate (called once at app start). */
export function setForwardingGate(gate: ForwardingGate): void {
  defaultCoordinator.setGate(gate);
}

/** Snapshot of watches whose forwarding is held by a running op. */
export function forwardingOwnership(): ForwardingHold[] {
  return defaultCoordinator.ownership();
}

/** Observe forwarding-ownership changes on the app-wide coordinator. */
export function subscribeForwardingOwnership(cb: (holds: ForwardingHold[]) => void): () => void {
  return defaultCoordinator.subscribe(cb);
}
