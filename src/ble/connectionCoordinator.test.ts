import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ConnectionCoordinator,
  DEFAULT_RETRY_POLICY,
  retryBackoffMs,
  noopForwardingGate,
  type ForwardingGate,
} from './connectionCoordinator';
import { TransportError, type WatchTransport } from './transport';

// A transport that only records the connect/disconnect lifecycle the
// coordinator drives, and lets a test script the connect outcomes.
class ScriptedTransport implements WatchTransport {
  connectCalls = 0;
  disconnectCalls = 0;
  constructor(
    private readonly log: string[],
    private readonly connectOutcomes: Array<'ok' | Error> = ['ok'],
  ) {}

  async connect(): Promise<void> {
    const outcome = this.connectOutcomes[Math.min(this.connectCalls, this.connectOutcomes.length - 1)];
    this.connectCalls++;
    this.log.push('connect');
    if (outcome !== 'ok') {
      throw outcome;
    }
  }
  async disconnect(): Promise<void> {
    this.disconnectCalls++;
    this.log.push('disconnect');
  }
  async requestMtu(mtu: number): Promise<number> {
    return mtu;
  }
  async write(): Promise<void> {}
  async writeWithoutResponse(): Promise<void> {}
  async read(): Promise<Uint8Array> {
    return new Uint8Array();
  }
  async subscribe(): Promise<() => void> {
    return () => undefined;
  }
}

// A labelled transport so a test can tell two overlapping sessions apart in the
// shared log (connect:1 vs connect:2).
function labelledTransport(log: string[], label: string): WatchTransport {
  return {
    async connect() {
      log.push(`connect:${label}`);
    },
    async disconnect() {
      log.push(`disconnect:${label}`);
    },
    async requestMtu(mtu: number) {
      return mtu;
    },
    async write() {},
    async writeWithoutResponse() {},
    async read() {
      return new Uint8Array();
    },
    async subscribe() {
      return () => undefined;
    },
  };
}

function recordingGate(log: string[]): ForwardingGate {
  return {
    async pause(id) {
      log.push(`pause:${id}`);
    },
    async resume(id) {
      log.push(`resume:${id}`);
    },
  };
}

// No real timers in the retry path — collect the delays instead.
function fakeSleep(delays: number[]) {
  return async (ms: number) => {
    delays.push(ms);
  };
}

const tick = () => new Promise((r) => setTimeout(r, 10));

test('pauses forwarding before the connect, resumes after disconnect', async () => {
  const log: string[] = [];
  const t = new ScriptedTransport(log);
  const c = new ConnectionCoordinator(recordingGate(log));
  await c.run(t, 'AA:BB', async () => {
    log.push('work');
  });
  assert.deepEqual(log, ['pause:AA:BB', 'connect', 'work', 'disconnect', 'resume:AA:BB']);
});

test('cleans up and resumes forwarding when the connect never succeeds', async () => {
  const log: string[] = [];
  // A non-retryable error so it fails on the first attempt.
  const authErr = new TransportError('needs pairing', { attErrorCode: 0x05 });
  const t = new ScriptedTransport(log, [authErr]);
  const c = new ConnectionCoordinator(recordingGate(log));
  await assert.rejects(c.run(t, 'dev', async () => assert.fail('body must not run')));
  // A best-effort disconnect scrubs any half-open link even on a terminal
  // failure, before forwarding resumes.
  assert.deepEqual(log, ['pause:dev', 'connect', 'disconnect', 'resume:dev']);
  assert.equal(t.disconnectCalls, 1, 'the failed connect is cleaned up');
});

test('a terminal connect failure cleans up without masking the original error', async () => {
  // The disconnect during cleanup itself throws; the connect error must survive.
  const connectErr = new TransportError('needs pairing', { attErrorCode: 0x05 });
  let disconnectCalls = 0;
  const t: WatchTransport = {
    async connect() {
      throw connectErr;
    },
    async disconnect() {
      disconnectCalls++;
      throw new Error('disconnect also failed');
    },
    async requestMtu(mtu: number) {
      return mtu;
    },
    async write() {},
    async writeWithoutResponse() {},
    async read() {
      return new Uint8Array();
    },
    async subscribe() {
      return () => undefined;
    },
  };
  const c = new ConnectionCoordinator();
  await assert.rejects(
    c.connectWithRetry(t, 'dev'),
    (e) => e === connectErr, // the *connect* error, not the disconnect one
  );
  assert.equal(disconnectCalls, 1, 'cleanup ran once on the terminal failure');
});

test('cleans up between retries so the next attempt is not left already-connected', async () => {
  const events: string[] = [];
  const delays: number[] = [];
  let attempt = 0;
  const t: WatchTransport = {
    async connect() {
      attempt++;
      events.push(`connect:${attempt}`);
      if (attempt < 3) {
        throw new TransportError('device disconnected'); // transient -> retried
      }
    },
    async disconnect() {
      events.push('disconnect');
    },
    async requestMtu(mtu: number) {
      return mtu;
    },
    async write() {},
    async writeWithoutResponse() {},
    async read() {
      return new Uint8Array();
    },
    async subscribe() {
      return () => undefined;
    },
  };
  const c = new ConnectionCoordinator(noopForwardingGate, DEFAULT_RETRY_POLICY, fakeSleep(delays));
  await c.connectWithRetry(t, 'dev');
  // Each failed attempt is disconnected before the next; the successful third
  // attempt is left connected (its cleanup belongs to run()'s finally).
  assert.deepEqual(events, ['connect:1', 'disconnect', 'connect:2', 'disconnect', 'connect:3']);
  assert.deepEqual(delays, [retryBackoffMs(0), retryBackoffMs(1)]);
});

test('every attempt of an exhausted transient retry is cleaned up', async () => {
  const events: string[] = [];
  const t: WatchTransport = {
    async connect() {
      events.push('connect');
      throw new TransportError('connection lost'); // always transient
    },
    async disconnect() {
      events.push('disconnect');
    },
    async requestMtu(mtu: number) {
      return mtu;
    },
    async write() {},
    async writeWithoutResponse() {},
    async read() {
      return new Uint8Array();
    },
    async subscribe() {
      return () => undefined;
    },
  };
  const c = new ConnectionCoordinator(noopForwardingGate, DEFAULT_RETRY_POLICY, async () => undefined);
  await assert.rejects(c.connectWithRetry(t, 'dev'), /connection lost/);
  // One disconnect per failed attempt, including the final one.
  const connects = events.filter((e) => e === 'connect').length;
  const disconnects = events.filter((e) => e === 'disconnect').length;
  assert.equal(connects, DEFAULT_RETRY_POLICY.maxAttempts);
  assert.equal(disconnects, DEFAULT_RETRY_POLICY.maxAttempts, 'cleanup on every attempt');
});

test('disconnects and resumes when the body throws', async () => {
  const log: string[] = [];
  const t = new ScriptedTransport(log);
  const c = new ConnectionCoordinator(recordingGate(log));
  await assert.rejects(
    c.run(t, 'dev', async () => {
      log.push('work');
      throw new Error('body blew up');
    }),
    /body blew up/,
  );
  assert.deepEqual(log, ['pause:dev', 'connect', 'work', 'disconnect', 'resume:dev']);
});

test('resumes even when disconnect itself fails, and keeps the body result', async () => {
  const log: string[] = [];
  const t = new ScriptedTransport(log);
  t.disconnect = async () => {
    log.push('disconnect');
    throw new Error('link already gone');
  };
  const c = new ConnectionCoordinator(recordingGate(log));
  const result = await c.run(t, 'dev', async () => {
    log.push('work');
    return 42;
  });
  assert.equal(result, 42, 'a failing disconnect must not mask the result');
  assert.deepEqual(log, ['pause:dev', 'connect', 'work', 'disconnect', 'resume:dev']);
});

test('serializes overlapping sessions: the second connects only after the first disconnects, with one pause/resume for the batch', async () => {
  const log: string[] = [];
  const c = new ConnectionCoordinator(recordingGate(log));

  let releaseOp1!: () => void;
  const op1Blocked = new Promise<void>((r) => (releaseOp1 = r));
  let op1Connected!: () => void;
  const op1IsConnected = new Promise<void>((r) => (op1Connected = r));

  const t1 = labelledTransport(log, '1');
  const t2 = labelledTransport(log, '2');

  const op1 = c.run(t1, 'dev', async () => {
    op1Connected();
    await op1Blocked; // hold the session open
  });

  await op1IsConnected;

  // Start op2 while op1 still holds the link. Its hold is taken synchronously.
  const op2 = c.run(t2, 'dev', async () => {
    log.push('op2-body');
  });

  await tick(); // let op2 reach the FIFO wait

  assert.equal(c.ownership()[0]?.depth, 2, 'op2 is queued behind op1 (ref-count 2)');
  assert.ok(log.includes('connect:1'), 'op1 has connected');
  assert.ok(!log.includes('connect:2'), 'op2 must NOT connect while op1 holds the link');
  assert.equal(log.filter((l) => l === 'pause:dev').length, 1, 'a single native pause for the batch');
  assert.equal(log.filter((l) => l === 'resume:dev').length, 0, 'no resume between queued ops');

  releaseOp1();
  await Promise.all([op1, op2]);

  const idxDisconnect1 = log.indexOf('disconnect:1');
  const idxConnect2 = log.indexOf('connect:2');
  assert.ok(idxDisconnect1 >= 0, 'op1 disconnected');
  assert.ok(idxConnect2 > idxDisconnect1, 'op2 connects strictly after op1 disconnects');
  assert.equal(log.filter((l) => l === 'pause:dev').length, 1, 'exactly one pause for the whole batch');
  assert.equal(log.filter((l) => l === 'resume:dev').length, 1, 'exactly one resume for the whole batch');
  assert.equal(c.isHeld('dev'), false);
});

test('different devices are not serialized against each other', async () => {
  const log: string[] = [];
  const c = new ConnectionCoordinator(recordingGate(log));
  let release!: () => void;
  const held = new Promise<void>((r) => (release = r));

  const a = c.run(labelledTransport(log, 'A'), 'devA', async () => {
    await held; // devA stays busy
  });
  const bConnected = c.run(labelledTransport(log, 'B'), 'devB', async () => {
    log.push('B-body');
  });
  // devB must complete without waiting for devA.
  await bConnected;
  assert.ok(log.includes('B-body'), 'devB ran while devA was still held');
  release();
  await a;
});

test('an extra resume cannot underflow the ref-count or restart forwarding', async () => {
  const log: string[] = [];
  const c = new ConnectionCoordinator(recordingGate(log));
  await c.run(new ScriptedTransport(log), 'dev', async () => {});
  assert.deepEqual(
    log.filter((l) => l.startsWith('pause') || l.startsWith('resume')),
    ['pause:dev', 'resume:dev'],
  );
  await c.run(new ScriptedTransport(log), 'dev', async () => {});
  assert.deepEqual(c.ownership(), []);
  assert.deepEqual(
    log.filter((l) => l.startsWith('pause') || l.startsWith('resume')),
    ['pause:dev', 'resume:dev', 'pause:dev', 'resume:dev'],
  );
});

test('a pause failure aborts before connect, rolls back the hold, and never resumes', async () => {
  const log: string[] = [];
  const gate: ForwardingGate = {
    async pause(id) {
      log.push(`pause:${id}`);
      throw new Error('forwarder wedged');
    },
    async resume(id) {
      log.push(`resume:${id}`);
    },
  };
  const c = new ConnectionCoordinator(gate);
  const t = new ScriptedTransport(log);
  await assert.rejects(
    c.run(t, 'dev', async () => assert.fail('body must not run')),
    /could not pause forwarding/,
  );
  assert.equal(t.connectCalls, 0, 'never connected with the forwarder still live');
  assert.deepEqual(c.ownership(), [], 'the hold was rolled back — no leak');
  assert.ok(!log.includes('resume:dev'), 'nothing to resume — the pause never took');
  assert.deepEqual(log, ['pause:dev']);
});

test('a pause failure fails every op in the batch and leaves ownership empty', async () => {
  const log: string[] = [];
  let pauseCalls = 0;
  const gate: ForwardingGate = {
    async pause(id) {
      pauseCalls++;
      log.push(`pause:${id}`);
      throw new Error('nope');
    },
    async resume(id) {
      log.push(`resume:${id}`);
    },
  };
  const c = new ConnectionCoordinator(gate);
  const t1 = new ScriptedTransport(log);
  const t2 = new ScriptedTransport(log);
  const op1 = c.run(t1, 'dev', async () => assert.fail('op1 body must not run'));
  const op2 = c.run(t2, 'dev', async () => assert.fail('op2 body must not run'));
  await Promise.allSettled([op1, op2]);
  await assert.rejects(op1);
  await assert.rejects(op2);
  assert.equal(t1.connectCalls, 0);
  assert.equal(t2.connectCalls, 0);
  assert.equal(pauseCalls, 1, 'a single native pause attempt for the batch');
  assert.deepEqual(c.ownership(), [], 'no leaked holds');
  assert.ok(!log.includes('resume:dev'));
});

test('a resume failure is surfaced but does not mask completed work; ownership stays coherent', async () => {
  const log: string[] = [];
  const gate: ForwardingGate = {
    async pause(id) {
      log.push(`pause:${id}`);
    },
    async resume(id) {
      log.push(`resume:${id}`);
      throw new Error('resume boom');
    },
  };
  const c = new ConnectionCoordinator(gate);
  const result = await c.run(new ScriptedTransport(log), 'dev', async () => 7);
  assert.equal(result, 7, 'the user work result is preserved despite the resume failure');
  assert.deepEqual(c.ownership(), [], 'ownership is released even when resume throws');
  assert.ok(log.includes('resume:dev'), 'the resume was attempted');
});

test('retries a transient connect failure up to the policy bound, then succeeds', async () => {
  const log: string[] = [];
  const delays: number[] = [];
  const disconnected = new TransportError('device disconnected'); // -> transient
  const t = new ScriptedTransport(log, [disconnected, disconnected, 'ok']);
  const c = new ConnectionCoordinator(noopForwardingGate, DEFAULT_RETRY_POLICY, fakeSleep(delays));
  await c.run(t, 'dev', async () => {});
  assert.equal(t.connectCalls, 3, 'first try + two retries');
  assert.deepEqual(delays, [retryBackoffMs(0), retryBackoffMs(1)]);
});

test('gives up after maxAttempts transient failures', async () => {
  const delays: number[] = [];
  const disconnected = new TransportError('connection lost');
  const t = new ScriptedTransport([], [disconnected]);
  const c = new ConnectionCoordinator(noopForwardingGate, DEFAULT_RETRY_POLICY, fakeSleep(delays));
  await assert.rejects(c.run(t, 'dev', async () => assert.fail('body must not run')), /connection lost/);
  assert.equal(t.connectCalls, DEFAULT_RETRY_POLICY.maxAttempts);
  assert.equal(delays.length, DEFAULT_RETRY_POLICY.maxAttempts - 1, 'no sleep after the final failure');
});

test('does not retry an authentication failure', async () => {
  const delays: number[] = [];
  const authErr = new TransportError('pairing required', { attErrorCode: 0x05 });
  const t = new ScriptedTransport([], [authErr]);
  const c = new ConnectionCoordinator(noopForwardingGate, DEFAULT_RETRY_POLICY, fakeSleep(delays));
  await assert.rejects(c.run(t, 'dev', async () => assert.fail('body must not run')));
  assert.equal(t.connectCalls, 1, 'authentication errors are not retried');
  assert.deepEqual(delays, []);
});

test('does not retry an authorization (status 8) failure', async () => {
  const delays: number[] = [];
  const authzErr = new TransportError('write rejected (status 8)', { attErrorCode: 0x08 });
  const t = new ScriptedTransport([], [authzErr]);
  const c = new ConnectionCoordinator(noopForwardingGate, DEFAULT_RETRY_POLICY, fakeSleep(delays));
  await assert.rejects(c.run(t, 'dev', async () => assert.fail('body must not run')));
  assert.equal(t.connectCalls, 1, 'authorization errors are not retried');
  assert.deepEqual(delays, []);
});

test('backoff is small, exponential and capped', () => {
  assert.equal(retryBackoffMs(0), 200);
  assert.equal(retryBackoffMs(1), 400);
  assert.equal(retryBackoffMs(2), 800);
  assert.equal(retryBackoffMs(3), 1000, 'clamped at maxDelayMs');
  assert.equal(retryBackoffMs(10), 1000);
});

test('the default gate is a safe no-op (sim/web)', async () => {
  const log: string[] = [];
  const c = new ConnectionCoordinator(); // default noop gate
  await c.run(new ScriptedTransport(log), 'localhost:18633', async () => log.push('work'));
  assert.deepEqual(log, ['connect', 'work', 'disconnect']);
  assert.equal(noopForwardingGate.pause instanceof Function, true);
});

test('ownership subscribers see acquire and release transitions', async () => {
  const snapshots: number[] = [];
  const c = new ConnectionCoordinator();
  const unsub = c.subscribe((holds) => snapshots.push(holds.reduce((n, h) => n + h.depth, 0)));
  await c.run(new ScriptedTransport([]), 'dev', async () => {});
  unsub();
  assert.deepEqual(snapshots, [1, 0], 'one acquire (depth 1) then one release (depth 0)');
});
