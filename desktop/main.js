// Electron main process for the PineTime Companion desktop shell.
//
// Serves the exported web bundle (desktop/dist, produced by `expo export
// --platform web`) over a custom app:// protocol — a standard+secure scheme
// gives the renderer a stable origin (localStorage persistence) and a secure
// context (Web Bluetooth requirement), and absolute /_expo asset paths resolve
// correctly, unlike file://. Dev mode: set ELECTRON_START_URL to the Metro dev
// server to get fast refresh.
//
// Bluetooth glue (the reason Electron is here at all):
// - 'select-bluetooth-device': Electron shows NO built-in chooser. The scan
//   keeps this event firing as devices appear; we either auto-answer it with a
//   device the renderer asked for (seamless reconnect) or stream the list to
//   the renderer's picker overlay over IPC.
// - setBluetoothPairingHandler (Windows/Linux): forwards the passkey prompt to
//   the renderer (the watch displays a 6-digit key). macOS pairing is handled
//   by the OS.

const { app, BrowserWindow, ipcMain, protocol, net, session } = require('electron');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const DIST = path.join(__dirname, 'dist');
const AUTO_SELECT_TIMEOUT_MS = 20000;

protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true } },
]);

// ---- Bluetooth chooser state ----
let autoSelect = null; // { id, name, armedAt } from the renderer, pre-requestDevice
let chooserCallback = null; // Electron's callback for the pending chooser
let mainWindow = null;

function resolveChooser(deviceId) {
  if (chooserCallback) {
    const cb = chooserCallback;
    chooserCallback = null;
    cb(deviceId);
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 480,
    height: 900,
    autoHideMenuBar: true,
    backgroundColor: '#101418',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  mainWindow.webContents.on('select-bluetooth-device', (event, deviceList, callback) => {
    event.preventDefault();
    chooserCallback = callback;

    if (autoSelect && Date.now() - autoSelect.armedAt < AUTO_SELECT_TIMEOUT_MS) {
      const match =
        deviceList.find((d) => d.deviceId === autoSelect.id) ||
        (autoSelect.name && deviceList.find((d) => d.deviceName === autoSelect.name));
      if (match) {
        autoSelect = null;
        resolveChooser(match.deviceId);
        mainWindow.webContents.send('bt:chooser-closed');
        return;
      }
      // Not seen yet — the event re-fires as the scan finds more devices.
    } else {
      autoSelect = null; // stale
    }
    mainWindow.webContents.send(
      'bt:devices-updated',
      deviceList.map((d) => ({ id: d.deviceId, name: d.deviceName })),
    );
  });

  if (process.env.ELECTRON_START_URL) {
    mainWindow.loadURL(process.env.ELECTRON_START_URL);
  } else {
    mainWindow.loadURL('app://bundle/index.html');
  }
}

app.whenReady().then(() => {
  // Map app://bundle/<path> onto desktop/dist with a traversal guard.
  protocol.handle('app', (request) => {
    const url = new URL(request.url);
    let rel = decodeURIComponent(url.pathname);
    if (rel === '/' || rel === '') rel = '/index.html';
    const file = path.normalize(path.join(DIST, rel));
    if (!file.startsWith(DIST)) {
      return new Response('forbidden', { status: 403 });
    }
    return net.fetch(pathToFileURL(file).toString()).catch(() => new Response('not found', { status: 404 }));
  });

  // Windows/Linux passkey pairing: hand the prompt to the renderer overlay.
  session.defaultSession.setBluetoothPairingHandler((details, callback) => {
    pairingCallback = callback;
    mainWindow?.webContents.send('bt:pairing-request', {
      kind: details.pairingKind, // 'confirm' | 'confirmPin' | 'providePin'
      pin: details.pin ?? null,
      deviceId: details.deviceId,
    });
  });

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

let pairingCallback = null;

// ---- IPC surface (mirrored in preload.js) ----
ipcMain.on('bt:set-auto-select', (_e, target) => {
  autoSelect = { ...target, armedAt: Date.now() };
});
ipcMain.on('bt:select', (_e, deviceId) => {
  autoSelect = null;
  resolveChooser(deviceId);
});
ipcMain.on('bt:cancel', () => {
  autoSelect = null;
  resolveChooser(''); // empty string = cancel, per Electron docs
});
ipcMain.on('bt:pairing-response', (_e, response) => {
  if (pairingCallback) {
    const cb = pairingCallback;
    pairingCallback = null;
    cb(response); // { confirmed: boolean, pin?: string }
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
