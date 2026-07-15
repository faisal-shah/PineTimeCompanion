// Preload: the only bridge between the sandboxed renderer (the web app) and
// the Electron main process. Exposes exactly the Bluetooth-glue surface the
// app feature-detects as `window.desktopBluetooth` (absent in plain browsers,
// where Chrome's native chooser/pairing UX applies instead).

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('desktopBluetooth', {
  // Arm the main process to auto-answer the next device chooser (reconnect).
  setAutoSelect(target) {
    ipcRenderer.send('bt:set-auto-select', { id: target.id, name: target.name });
  },
  // Picker overlay wiring.
  onDevicesUpdated(cb) {
    const listener = (_e, devices) => cb(devices);
    ipcRenderer.on('bt:devices-updated', listener);
    return () => ipcRenderer.removeListener('bt:devices-updated', listener);
  },
  onChooserClosed(cb) {
    const listener = () => cb();
    ipcRenderer.on('bt:chooser-closed', listener);
    return () => ipcRenderer.removeListener('bt:chooser-closed', listener);
  },
  selectDevice(deviceId) {
    ipcRenderer.send('bt:select', deviceId);
  },
  cancelSelect() {
    ipcRenderer.send('bt:cancel');
  },
  // Passkey pairing prompt (Windows/Linux).
  onPairingRequest(cb) {
    const listener = (_e, details) => cb(details);
    ipcRenderer.on('bt:pairing-request', listener);
    return () => ipcRenderer.removeListener('bt:pairing-request', listener);
  },
  respondPairing(response) {
    ipcRenderer.send('bt:pairing-response', response);
  },
});
