// Structured transport-error metadata and a pure BLE error classifier.
//
// A watch operation fails in a handful of qualitatively different ways, and the
// caller has to react differently to each: a transient link drop is worth a
// retry, a wrong-format record is not, an authorization refusal means "turn the
// setting on", a Bluetooth-off means "turn the radio on". The raw ble-plx and
// Web Bluetooth errors carry that information in different shapes; this module
// folds them into one small enum plus the fields they came with, so higher
// layers (retry policy, and a later pairing/repair UI) can branch on `kind`
// instead of grepping error strings.
//
// The classifier is deliberately pure and platform-free: it never imports
// react-native-ble-plx or touches a DOM, it only duck-types the error objects
// those layers throw. That keeps it unit-testable under plain Node.

/**
 * What went wrong, at the granularity a caller can act on.
 *
 * - `transient`     — link drop, timeout, GATT busy/in-progress, adapter
 *                     resetting. The one retryable kind.
 * - `authentication`— the characteristic needs a bonded/encrypted link
 *                     (ATT insufficient authentication/encryption). Pairing,
 *                     not a retry, is the fix.
 * - `bluetoothOff`  — the phone's Bluetooth radio is off.
 * - `permission`    — the app lacks a BLE/scan permission, or the browser
 *                     blocked access (SecurityError).
 * - `cancelled`     — the user or the OS cancelled the operation.
 * - `notFound`      — the device is unknown / no longer advertising / the
 *                     browser chooser found nothing.
 * - `authorization` — ATT insufficient *authorization* (status 8): the peer
 *                     refused access to a characteristic. Non-retryable, and
 *                     the generic reading of status 8 outside a DFU/FS flow.
 * - `dfuDisabled`   — status 8 *interpreted in a DFU/FS context*: InfiniTime's
 *                     "Firmware & files" access is Disabled on the watch. Only
 *                     produced when classified with the `dfu` context.
 * - `unknown`       — anything unclassified. Never retried.
 */
export type TransportErrorKind =
  | 'transient'
  | 'authentication'
  | 'bluetoothOff'
  | 'permission'
  | 'cancelled'
  | 'notFound'
  | 'authorization'
  | 'dfuDisabled'
  | 'unknown';

/**
 * The operation context a classification happens in. Status 8 (insufficient
 * authorization) means "characteristic access refused" generically, but in a
 * DFU/FS flow it specifically means the watch's "Firmware & files" setting is
 * Disabled — so the DFU path classifies with `dfu` to get `dfuDisabled`, while
 * everything else gets the generic `authorization`.
 */
export type BleErrorContext = 'general' | 'dfu';

export interface TransportErrorMetadata {
  kind: TransportErrorKind;
  /** Only `transient` is retryable; the retry policy keys off this. */
  retryable: boolean;
  /** ble-plx BleErrorCode, preserved when the source error carried one. */
  bleErrorCode?: number;
  /** ble-plx ATT error code (0x05 auth, 0x08 authorization, ...). */
  attErrorCode?: number;
  /** ble-plx human reason string, when present. */
  reason?: string;
  /** Web Bluetooth DOMException name (e.g. "NotFoundError"). */
  domName?: string;
}

// ATT protocol error codes we care about (Bluetooth Core spec, Vol 3, Part F).
const ATT_INSUFFICIENT_AUTHENTICATION = 0x05;
const ATT_INSUFFICIENT_AUTHORIZATION = 0x08;
const ATT_INSUFFICIENT_ENCRYPTION_KEY_SIZE = 0x0c;
const ATT_INSUFFICIENT_ENCRYPTION = 0x0f;

// react-native-ble-plx BleErrorCode values (kept as literals so this file never
// imports ble-plx, which would pull native code into the pure/test build).
const BLE = {
  UnknownError: 0,
  OperationCancelled: 2,
  OperationTimedOut: 3,
  OperationStartFailed: 4,
  BluetoothUnsupported: 100,
  BluetoothUnauthorized: 101,
  BluetoothPoweredOff: 102,
  BluetoothInUnknownState: 103,
  BluetoothResetting: 104,
  DeviceConnectionFailed: 200,
  DeviceDisconnected: 201,
  DeviceAlreadyConnected: 203,
  DeviceNotFound: 204,
  DeviceNotConnected: 205,
  LocationServicesDisabled: 601,
} as const;

const RETRYABLE_KINDS: ReadonlySet<TransportErrorKind> = new Set<TransportErrorKind>(['transient']);

export function isRetryableKind(kind: TransportErrorKind): boolean {
  return RETRYABLE_KINDS.has(kind);
}

function num(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}

function kindFromAtt(att: number, context: BleErrorContext): TransportErrorKind | undefined {
  if (att === ATT_INSUFFICIENT_AUTHORIZATION) {
    return context === 'dfu' ? 'dfuDisabled' : 'authorization';
  }
  if (
    att === ATT_INSUFFICIENT_AUTHENTICATION ||
    att === ATT_INSUFFICIENT_ENCRYPTION ||
    att === ATT_INSUFFICIENT_ENCRYPTION_KEY_SIZE
  ) {
    return 'authentication';
  }
  return undefined;
}

function kindFromBleCode(code: number): TransportErrorKind | undefined {
  switch (code) {
    case BLE.OperationCancelled:
      return 'cancelled';
    case BLE.OperationTimedOut:
    case BLE.OperationStartFailed:
    case BLE.BluetoothInUnknownState:
    case BLE.BluetoothResetting:
    case BLE.DeviceConnectionFailed:
    case BLE.DeviceDisconnected:
    case BLE.DeviceAlreadyConnected:
    case BLE.DeviceNotConnected:
      return 'transient';
    case BLE.BluetoothPoweredOff:
      return 'bluetoothOff';
    case BLE.BluetoothUnauthorized:
    case BLE.LocationServicesDisabled:
      return 'permission';
    case BLE.DeviceNotFound:
      return 'notFound';
    default:
      return undefined; // UnknownError / Unsupported / anything else -> heuristics
  }
}

function kindFromDomName(name: string): TransportErrorKind | undefined {
  switch (name) {
    case 'NotFoundError':
      return 'notFound';
    case 'SecurityError':
    case 'NotAllowedError':
      return 'permission';
    case 'AbortError':
      return 'cancelled';
    case 'NetworkError':
    case 'InvalidStateError':
      return 'transient';
    default:
      return undefined;
  }
}

function kindFromMessage(message: string, context: BleErrorContext): TransportErrorKind {
  const m = message.toLowerCase();
  // Authorization ("status 8" / "authoriz") before authentication: it is a
  // characteristic-access refusal, and in a DFU/FS context specifically means
  // the watch's "Firmware & files" access is Disabled.
  if (/\bstatus 8\b/.test(m) || /insufficient[_ ]author/.test(m) || /authoriz/.test(m)) {
    return context === 'dfu' ? 'dfuDisabled' : 'authorization';
  }
  if (/authenticat/.test(m) || /insufficient[_ ]encrypt/.test(m) || /\bpairing\b/.test(m) || /not bonded/.test(m)) {
    return 'authentication';
  }
  if (/powered[_ ]?off/.test(m) || /bluetooth (is )?(off|disabled)/.test(m) || /radio (is )?off/.test(m)) {
    return 'bluetoothOff';
  }
  if (/permission/.test(m) || /unauthorized/.test(m) || /not allowed/.test(m)) {
    return 'permission';
  }
  if (/cancel/.test(m)) {
    return 'cancelled';
  }
  if (/not found/.test(m) || /no device/.test(m) || /unknown device/.test(m)) {
    return 'notFound';
  }
  if (/busy/.test(m) || /in progress/.test(m) || /already (in|connected)/.test(m)) {
    return 'transient';
  }
  if (/disconnect/.test(m) || /time?d? ?out/.test(m) || /timeout/.test(m) || /connection (failed|error|closed|lost)/.test(m) || /\bgatt\b/.test(m) || /link loss/.test(m) || /reset/.test(m)) {
    return 'transient';
  }
  return 'unknown';
}

/**
 * Classify any thrown value into structured transport-error metadata.
 *
 * Precedence: an already-classified {@link TransportError} wins (so wrapping
 * never re-guesses); then ATT code, then ble-plx BleErrorCode, then Web
 * Bluetooth DOMException name, then message heuristics. ble-plx / DOMException
 * fields are copied through even when the kind came from elsewhere, so a later
 * pairing/repair UI keeps the raw detail.
 *
 * `context` only changes how ATT status 8 (insufficient authorization) reads:
 * `general` -> `authorization`, `dfu` -> `dfuDisabled`. Everything else is
 * context-independent. An already-classified TransportError is re-specialized
 * under a non-general context using its preserved ATT code / message, so a DFU
 * caller can turn a generic `authorization` into `dfuDisabled`.
 */
export function classifyBleError(err: unknown, context: BleErrorContext = 'general'): TransportErrorMetadata {
  if (err instanceof TransportError) {
    const base = err.metadata;
    if (context !== 'general') {
      const attKind = base.attErrorCode !== undefined ? kindFromAtt(base.attErrorCode, context) : undefined;
      const msgKind = kindFromMessage(err.message, context);
      const specialized = attKind ?? (msgKind !== 'unknown' ? msgKind : undefined);
      if (specialized !== undefined && specialized !== base.kind) {
        return { ...base, kind: specialized, retryable: isRetryableKind(specialized) };
      }
    }
    return base;
  }

  const e = (err ?? {}) as Record<string, unknown>;
  const bleErrorCode = num(e.errorCode);
  const attErrorCode = num(e.attErrorCode);
  const reason = str(e.reason);
  const domName = str(e.name) && str(e.name) !== 'Error' ? str(e.name) : undefined;
  const message = str(e.message) ?? (typeof err === 'string' ? err : '');

  let kind: TransportErrorKind | undefined;
  if (attErrorCode !== undefined) {
    kind = kindFromAtt(attErrorCode, context);
  }
  if (kind === undefined && bleErrorCode !== undefined) {
    kind = kindFromBleCode(bleErrorCode);
  }
  if (kind === undefined && domName !== undefined) {
    kind = kindFromDomName(domName);
  }
  if (kind === undefined) {
    kind = kindFromMessage(message, context);
  }

  const metadata: TransportErrorMetadata = { kind, retryable: isRetryableKind(kind) };
  if (bleErrorCode !== undefined) metadata.bleErrorCode = bleErrorCode;
  if (attErrorCode !== undefined) metadata.attErrorCode = attErrorCode;
  if (reason !== undefined) metadata.reason = reason;
  // Only keep a DOMException-style name; never store the generic "Error".
  if (domName !== undefined && kindFromDomName(domName) !== undefined) metadata.domName = domName;
  return metadata;
}

/**
 * The error every transport throws. Carries structured {@link
 * TransportErrorMetadata}: when constructed from an underlying error (the
 * `cause`), it is classified automatically, so the whole stack gets `kind` /
 * `retryable` for free without each call site opting in.
 */
export class TransportError extends Error {
  readonly metadata: TransportErrorMetadata;

  constructor(message: string, readonly cause?: unknown, metadata?: Partial<TransportErrorMetadata>) {
    super(message);
    this.name = 'TransportError';
    // Classify from the cause when there is one, else from the message text
    // (many call sites throw a descriptive message with no underlying error).
    // A specific cause kind wins over the message; an explicit metadata.kind
    // wins over both. ble-plx / DOMException fields ride through from the cause.
    const fromCause = cause !== undefined ? classifyBleError(cause) : undefined;
    const fromMessage = classifyBleError(message);
    const causeKind = fromCause && fromCause.kind !== 'unknown' ? fromCause.kind : undefined;
    const kind = metadata?.kind ?? causeKind ?? fromMessage.kind;
    this.metadata = {
      ...(fromCause ?? {}),
      ...metadata,
      kind,
      retryable: metadata?.retryable ?? isRetryableKind(kind),
    };
  }

  get kind(): TransportErrorKind {
    return this.metadata.kind;
  }

  get retryable(): boolean {
    return this.metadata.retryable;
  }

  /** Build a TransportError from a raw thrown value, classifying it. */
  static from(err: unknown, message?: string): TransportError {
    if (err instanceof TransportError && message === undefined) {
      return err;
    }
    const text = message ?? (err instanceof Error ? err.message : String(err));
    return new TransportError(text, err);
  }
}
