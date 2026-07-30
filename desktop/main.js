const { app, BrowserWindow, Tray, Menu, ipcMain, nativeImage, screen, desktopCapturer, session } = require('electron');
const path = require('path');
const { startServer, stopServer, serverEvents } = require('./server/index');

let mainWindow = null;
let laserWindow = null;
let tray = null;
let serverInstance = null;
const isDev = process.argv.includes('--dev');
const SERVER_PORT = 3847;

// ─── Single Instance Lock ────────────────────────────────────────────
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  });
}

// ─── Create Main Window ──────────────────────────────────────────────
function createWindow() {
  const { width, height } = screen.getPrimaryDisplay().workAreaSize;

  mainWindow = new BrowserWindow({
    width: Math.min(1200, width),
    height: Math.min(800, height),
    minWidth: 900,
    minHeight: 600,
    frame: false,
    titleBarStyle: 'hidden',
    backgroundColor: '#0a0a0f',
    icon: path.join(__dirname, 'assets', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    },
    show: false
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    if (isDev) mainWindow.webContents.openDevTools();
  });

  // Minimize to tray instead of closing
  mainWindow.on('close', (e) => {
    if (!app.isQuitting) {
      e.preventDefault();
      mainWindow.hide();
    }
  });
}

// ─── Create Laser Pointer Window ──────────────────────────────────────
function createLaserWindow() {
  const { width, height } = screen.getPrimaryDisplay().bounds;
  laserWindow = new BrowserWindow({
    width, height,
    transparent: true,
    frame: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    hasShadow: false,
    focusable: false,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  });
  
  laserWindow.setIgnoreMouseEvents(true, { forward: true });
  laserWindow.loadFile(path.join(__dirname, 'laser.html'));
  laserWindow.hide();
}

// ─── System Tray ─────────────────────────────────────────────────────
function createTray() {
  // Create a simple 16x16 tray icon programmatically
  const iconSize = 16;
  const canvas = nativeImage.createEmpty();
  
  // Use a simple colored icon
  const trayIcon = nativeImage.createFromBuffer(
    createTrayIconBuffer(), { width: 16, height: 16 }
  );

  tray = new Tray(trayIcon);
  tray.setToolTip('MoodLink — Connected');

  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Open MoodLink',
      click: () => {
        if (mainWindow) {
          mainWindow.show();
          mainWindow.focus();
        }
      }
    },
    { type: 'separator' },
    {
      label: 'Connection Status',
      enabled: false,
      label: '● No device connected'
    },
    { type: 'separator' },
    {
      label: 'Quit MoodLink',
      click: () => {
        app.isQuitting = true;
        app.quit();
      }
    }
  ]);

  tray.setContextMenu(contextMenu);
  tray.on('double-click', () => {
    if (mainWindow) {
      mainWindow.show();
      mainWindow.focus();
    }
  });
}

// Create a simple tray icon buffer (16x16 RGBA)
function createTrayIconBuffer() {
  const size = 16;
  const buf = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const idx = (y * size + x) * 4;
      const cx = x - size / 2;
      const cy = y - size / 2;
      const dist = Math.sqrt(cx * cx + cy * cy);
      if (dist < size / 2 - 1) {
        buf[idx] = 99;      // R
        buf[idx + 1] = 102; // G
        buf[idx + 2] = 241; // B (indigo)
        buf[idx + 3] = 255; // A
      } else {
        buf[idx + 3] = 0;   // transparent
      }
    }
  }
  return buf;
}

// ─── IPC Handlers ────────────────────────────────────────────────────
function setupIPC() {
  // Window controls
  ipcMain.on('window:minimize', () => mainWindow?.minimize());
  ipcMain.on('window:maximize', () => {
    if (mainWindow?.isMaximized()) {
      mainWindow.unmaximize();
    } else {
      mainWindow?.maximize();
    }
  });
  ipcMain.on('window:close', () => mainWindow?.close());
  ipcMain.handle('window:isMaximized', () => mainWindow?.isMaximized());

  // Server info
  ipcMain.handle('server:getPort', () => SERVER_PORT);
  ipcMain.handle('server:getIP', () => {
    const os = require('os');
    const interfaces = os.networkInterfaces();
    for (const name of Object.keys(interfaces)) {
      for (const iface of interfaces[name]) {
        if (iface.family === 'IPv4' && !iface.internal) {
          return iface.address;
        }
      }
    }
    return '127.0.0.1';
  });

  // Screen capture sources for WebRTC
  ipcMain.handle('desktop:getSources', async () => {
    const sources = await desktopCapturer.getSources({
      types: ['screen', 'window'],
      thumbnailSize: { width: 320, height: 180 }
    });
    return sources.map(s => ({
      id: s.id,
      name: s.name,
      thumbnail: s.thumbnail.toDataURL()
    }));
  });

  // Update tray tooltip
  ipcMain.on('tray:updateStatus', (_, status) => {
    if (tray) tray.setToolTip(`MoodLink — ${status}`);
  });
}

// ─── App Lifecycle ───────────────────────────────────────────────────
app.whenReady().then(async () => {
  setupIPC();
  createWindow();
  createLaserWindow();
  createTray();

  // Start the embedded server
  serverInstance = await startServer(SERVER_PORT);
  console.log(`MoodLink server running on port ${SERVER_PORT}`);
  
  const { systemControl } = require('./server/index');
  const primaryDisplay = screen.getPrimaryDisplay().bounds;
  systemControl.setScreenResolution(primaryDisplay.width, primaryDisplay.height);

  serverEvents.on('laser', (data) => {
    if (!laserWindow) return;
    if (data.visible) {
      if (!laserWindow.isVisible()) laserWindow.showInactive();
      laserWindow.webContents.send('laser:move', data);
    } else {
      laserWindow.hide();
    }
  });

  // Allow Screen Capture and Media (Microphone)
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
    if (permission === 'display-capture' || permission === 'media') {
      callback(true);
    } else {
      callback(false);
    }
  });

  // Handle getDisplayMedia() without a picker UI (Multi-Monitor Support)
  session.defaultSession.setDisplayMediaRequestHandler((request, callback) => {
    desktopCapturer.getSources({ types: ['screen'] }).then((sources) => {
      if (sources && sources.length > 0) {
        const cursor = screen.getCursorScreenPoint();
        const activeDisplay = screen.getDisplayNearestPoint(cursor);
        // Find the source that matches the active display's ID, fallback to primary if not found
        const activeSource = sources.find(s => s.display_id === activeDisplay.id.toString()) || sources[0];
        callback({ video: activeSource, audio: 'loopback' });
      } else {
        callback({ video: null, audio: null });
      }
    }).catch((err) => {
      console.error('Error fetching sources for display media:', err);
      callback({ video: null, audio: null });
    });
  });

  // Handle native Web Bluetooth pairing requests securely without OS popups
  session.defaultSession.on('select-bluetooth-device', (event, deviceList, callback) => {
    event.preventDefault();
    const moodlinkDevice = deviceList.find(d => d.deviceName && d.deviceName.includes('MoodLink'));
    if (moodlinkDevice) {
      callback(moodlinkDevice.deviceId);
    } else if (deviceList.length > 0) {
      callback(deviceList[0].deviceId);
    }
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});



app.on('before-quit', () => {
  app.isQuitting = true;
  if (serverInstance) stopServer(serverInstance);
});

app.on('window-all-closed', () => {
  // Don't quit on macOS
  if (process.platform !== 'darwin') {
    // Keep running in tray on Windows
  }
});
