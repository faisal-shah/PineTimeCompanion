// Session registry of granted Web Bluetooth devices, keyed by their opaque
// device.id (which is what we persist as watch.deviceId). requestDevice needs
// a user gesture and shows a chooser; holding the granted BluetoothDevice here
// lets same-session reconnects skip both. Cleared on page reload — in plain
// Chrome that costs one chooser click per session; in Electron the main
// process auto-answers the chooser, so reconnects stay seamless.

const devices = new Map<string, BluetoothDevice>();

export function registerDevice(device: BluetoothDevice): void {
  devices.set(device.id, device);
}

export function getRegisteredDevice(deviceId: string): BluetoothDevice | undefined {
  return devices.get(deviceId);
}
