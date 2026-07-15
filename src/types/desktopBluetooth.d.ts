// Surface exposed by the Electron preload (desktop/preload.js) via
// contextBridge. Absent in plain browsers — always feature-detect.

interface DesktopBluetoothDevice {
  id: string;
  name: string;
}

interface DesktopPairingRequest {
  kind: 'confirm' | 'confirmPin' | 'providePin';
  pin: string | null;
  deviceId: string;
}

interface Window {
  desktopBluetooth?: {
    setAutoSelect(target: { id: string; name?: string }): void;
    onDevicesUpdated(cb: (devices: DesktopBluetoothDevice[]) => void): () => void;
    onChooserClosed(cb: () => void): () => void;
    selectDevice(deviceId: string): void;
    cancelSelect(): void;
    onPairingRequest(cb: (details: DesktopPairingRequest) => void): () => void;
    respondPairing(response: { confirmed: boolean; pin?: string }): void;
  };
}
