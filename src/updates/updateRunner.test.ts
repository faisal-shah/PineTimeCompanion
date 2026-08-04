import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { zipSync } from 'fflate';
import { readFirmwareRevision, runFirmwareUpdate, DfuDisabledError } from './updateRunner';
import { getCoordinator, noopForwardingGate, type ForwardingGate } from '../ble/connectionCoordinator';
import { BRIDGE_CHAR, TransportError, type WatchTransport } from '../ble/transport';

// OTA routes through the app-wide ConnectionCoordinator, so wire a recording
// gate onto it for these tests and put it back afterwards.
function installGate(log: string[]): ForwardingGate {
  const gate: ForwardingGate = {
    async pause(id) {
      log.push(`pause:${id}`);
    },
    async resume(id) {
      log.push(`resume:${id}`);
    },
  };
  getCoordinator().setGate(gate);
  return gate;
}

afterEach(() => getCoordinator().setGate(noopForwardingGate));

class OtaTransport implements WatchTransport {
  log: string[];
  constructor(log: string[], private readonly onFirstControlWrite?: () => never) {
    this.log = log;
  }
  async connect(): Promise<void> {
    this.log.push('connect');
  }
  async disconnect(): Promise<void> {
    this.log.push('disconnect');
  }
  async requestMtu(mtu: number): Promise<number> {
    return mtu;
  }
  async read(): Promise<Uint8Array> {
    return new TextEncoder().encode('1.16.0');
  }
  async write(char: number): Promise<void> {
    if (char === BRIDGE_CHAR.dfuControl && this.onFirstControlWrite) {
      this.onFirstControlWrite();
    }
  }
  async writeWithoutResponse(): Promise<void> {}
  async subscribe(): Promise<() => void> {
    return () => undefined;
  }
}

function buildArchive(): Uint8Array {
  const manifest = {
    manifest: {
      application: {
        bin_file: 'app.bin',
        dat_file: 'app.dat',
        init_packet_data: { firmware_crc16: 1 },
      },
    },
  };
  return zipSync({
    'manifest.json': new TextEncoder().encode(JSON.stringify(manifest)),
    'app.bin': new Uint8Array([1, 2, 3, 4]),
    'app.dat': new Uint8Array([0x52, 0x00, 0xff, 0xff]),
  });
}

test('readFirmwareRevision pauses forwarding, reads, disconnects, resumes', async () => {
  const log: string[] = [];
  installGate(log);
  const rev = await readFirmwareRevision(new OtaTransport(log), 'AA:BB');
  assert.equal(rev, '1.16.0');
  assert.deepEqual(log, ['pause:AA:BB', 'connect', 'disconnect', 'resume:AA:BB']);
});

test('runFirmwareUpdate maps an authorization (status 8) failure to DfuDisabledError and still resumes', async () => {
  const log: string[] = [];
  installGate(log);
  const t = new OtaTransport(log, () => {
    throw new TransportError('GATT write rejected (status 8)', { attErrorCode: 0x08 });
  });
  await assert.rejects(runFirmwareUpdate(t, 'AA:BB', buildArchive()), (e) => e instanceof DfuDisabledError);
  // Exactly one pause and one resume — no double pause/resume around OTA.
  assert.equal(log.filter((l) => l.startsWith('pause')).length, 1);
  assert.equal(log.filter((l) => l.startsWith('resume')).length, 1);
  assert.equal(log[log.length - 1], 'resume:AA:BB', 'forwarding is resumed in the finally');
  assert.ok(log.includes('disconnect'), 'the link is still disconnected on the failure path');
});
