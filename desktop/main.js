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
function updateTrayMenu(connected = false, deviceName = null) {
  if (!tray) return;
  const statusLabel = connected
    ? `● Connected${deviceName ? ': ' + deviceName : ''}`
    : '● No device connected';

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
      label: statusLabel,
      enabled: false
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
  tray.setToolTip(`MoodLink — ${connected ? 'Connected' : 'Ready'}`);
}

function createTray() {
  const iconPath = path.join(__dirname, 'assets', 'icon.png');
  let trayIcon;
  try {
    trayIcon = nativeImage.createFromPath(iconPath).resize({ width: 16, height: 16 });
  } catch (err) {
    console.error('Failed to load tray icon image, using fallback:', err);
    trayIcon = nativeImage.createEmpty();
  }

  tray = new Tray(trayIcon);
  updateTrayMenu(false);

  tray.on('double-click', () => {
    if (mainWindow) {
      mainWindow.show();
      mainWindow.focus();
    }
  });
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

  // Update tray tooltip and context menu
  ipcMain.on('tray:updateStatus', (_, status, deviceName) => {
    const isConnected = (status === 'Connected' || status === 'connected');
    updateTrayMenu(isConnected, deviceName);
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

  serverEvents.on('device:connected', (dev) => {
    updateTrayMenu(true, dev?.name);
  });
  serverEvents.on('device:disconnected', () => {
    updateTrayMenu(false);
  });

  serverEvents.on('laser', (data) => {
    if (!laserWindow) return;
    if (data.visible) {
      if (!laserWindow.isVisible()) laserWindow.showInactive();
      const bounds = screen.getPrimaryDisplay().bounds;
      const x = data.rx != null ? Math.round(data.rx * bounds.width) : (data.x || 0);
      const y = data.ry != null ? Math.round(data.ry * bounds.height) : (data.y || 0);
      laserWindow.webContents.send('laser:move', { x, y, visible: true });
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
