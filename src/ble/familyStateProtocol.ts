import { GATT_CHARACTERISTICS, RECORDS } from './generated/companionProtocol';
import { u32leAt } from './listProtocol';
import { BRIDGE_CHAR, TransportError, WatchTransport } from './transport';

const contract = RECORDS.family_state;

export const FAMILY_STATE_STATUS_CHAR_UUID = GATT_CHARACTERISTICS.familyStateStatus.characteristic;
export const FAMILY_STATE_PROTOCOL_VERSION = contract.protocol_version;
export const FAMILY_STATE_SNAPSHOT_SCHEMA_VERSION = contract.snapshot_schema_version;
export const FAMILY_STATE_STATUS_SIZE = contract.status_size;

export type FamilyStateStorageState = keyof typeof contract.states;
export type FamilyStateOperation = keyof typeof contract.operations;
export type FamilyStateError = keyof typeof contract.errors;

const stateByCode = Object.fromEntries(Object.entries(contract.states).map(([name, code]) => [code, name])) as Record<number, FamilyStateStorageState>;
const operationByCode = Object.fromEntries(Object.entries(contract.operations).map(([name, code]) => [code, name])) as Record<number, FamilyStateOperation>;
const errorByCode = Object.fromEntries(Object.entries(contract.errors).map(([name, code]) => [code, name])) as Record<number, FamilyStateError>;

export interface FamilyStateStatus {
  state: FamilyStateStorageState;
  operation: FamilyStateOperation;
  error: FamilyStateError;
  storageWarning: boolean;
  token: number;
  activeGeneration: number;
  retryCount: number;
}

export class FamilyStateCommitError extends TransportError {
  constructor(
    message: string,
    readonly status: FamilyStateStatus,
  ) {
    super(message);
  }
}

export function decodeFamilyStateStatus(payload: Uint8Array): FamilyStateStatus {
  if (payload.length !== FAMILY_STATE_STATUS_SIZE) {
    throw new Error(`family-state status must be ${FAMILY_STATE_STATUS_SIZE} bytes, got ${payload.length}`);
  }
  if (payload[0] !== FAMILY_STATE_PROTOCOL_VERSION) {
    throw new Error(`unsupported family-state protocol ${payload[0]}`);
  }
  if (payload[1] !== FAMILY_STATE_SNAPSHOT_SCHEMA_VERSION) {
    throw new Error(`unsupported family-state snapshot schema ${payload[1]}`);
  }
  if (payload[15] !== 0) {
    throw new Error('family-state reserved byte is nonzero');
  }

  const state = stateByCode[payload[2]];
  const operation = operationByCode[payload[3]];
  const error = errorByCode[payload[4]];
  if (!state || !operation || !error) {
    throw new Error('family-state status contains an unknown enum value');
  }
  if ((payload[5] & ~contract.flags.storage_warning) !== 0) {
    throw new Error('family-state status contains unknown flags');
  }

  return {
    state,
    operation,
    error,
    storageWarning: (payload[5] & contract.flags.storage_warning) !== 0,
    token: u32leAt(payload, 6),
    activeGeneration: u32leAt(payload, 10),
    retryCount: payload[14],
  };
}

export async function waitForFamilyStateCommit(
  transport: WatchTransport,
  operation: FamilyStateOperation,
  token: number,
  options: { attempts?: number; delayMs?: number } = {},
): Promise<FamilyStateStatus> {
  const attempts = options.attempts ?? 40;
  const delayMs = options.delayMs ?? 125;
  let last: FamilyStateStatus | undefined;

  for (let attempt = 0; attempt < attempts; attempt++) {
    if (attempt !== 0) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
    const status = decodeFamilyStateStatus(await transport.read(BRIDGE_CHAR.familyStateStatus));
    last = status;
    if (status.operation !== operation || status.token !== (token >>> 0)) {
      continue;
    }
    if (status.state === 'succeeded') {
      return status;
    }
    if (status.state === 'failed') {
      throw new FamilyStateCommitError(
        `watch could not persist ${operation}: ${status.error}`,
        status,
      );
    }
  }

  throw new FamilyStateCommitError(
    `watch did not finish persisting ${operation}`,
    last ?? {
      state: 'idle',
      operation: 'none',
      error: 'timeout',
      storageWarning: false,
      token: 0,
      activeGeneration: 0,
      retryCount: 0,
    },
  );
}
