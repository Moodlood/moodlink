const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs');
const QRCode = require('qrcode');
const SystemControl = require('./system-control');
const FileManager = require('./file-manager');

const EventEmitter = require('events');
class ServerEvents extends EventEmitter {}
const serverEvents = new ServerEvents();

let io = null;
let httpServer = null;
let connectedDevices = new Map();
let pairingCode = null;
const systemControl = new SystemControl();
const fileManager = new FileManager();

const os = require('os');
const uploadsDir = path.join(os.homedir(), 'Downloads', 'MoodLinkUploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadsDir),
  filename: (req, file, cb) => cb(null, `${Date.now()}-${uuidv4().slice(0, 8)}${path.extname(file.originalname)}`)
});
const upload = multer({ storage, limits: { fileSize: 500 * 1024 * 1024 } });

function generatePairingCode() {
  pairingCode = Math.floor(100000 + Math.random() * 900000).toString();
  return pairingCode;
}


async function startServer(port) {
  const app = express();
  
  httpServer = http.createServer(app);
  
  io = new Server(httpServer, {
    cors: { origin: '*', methods: ['GET', 'POST'] },
    maxHttpBufferSize: 50 * 1024 * 1024
  });

  app.use(express.json());
  app.use(express.static(path.join(__dirname, '..', 'renderer')));

  // Enable CORS for all routes (important for Electron renderer loading via file://)
  app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
    if (req.method === 'OPTIONS') {
      return res.sendStatus(200);
    }
    next();
  });

  // REST endpoints
  app.get('/health', (req, res) => res.json({ status: 'ok', name: 'MoodLink', version: '1.0.0' }));

  app.get('/api/pairing', (req, res) => {
    const code = pairingCode || generatePairingCode();
    res.json({ code, devices: connectedDevices.size });
  });

  app.get('/api/qrcode', async (req, res) => {
    try {
      const os = require('os');
      const ifaces = os.networkInterfaces();
      let ip = '127.0.0.1';
      for (const n of Object.keys(ifaces)) {
        for (const i of ifaces[n]) {
          if (i.family === 'IPv4' && !i.internal) { ip = i.address; break; }
        }
      }
      const code = pairingCode || generatePairingCode();
      const qrData = JSON.stringify({ ip, port, code, app: 'moodlink', secure: false });
      const qr = await QRCode.toDataURL(qrData, { width: 256, color: { dark: '#6366f1', light: '#0a0a0f' } });
      res.json({ qr, code, ip, port });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  app.post('/api/upload', upload.single('file'), (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'No file' });
    const info = { id: uuidv4(), name: req.file.originalname, path: req.file.path, size: req.file.size, savedAs: req.file.filename, timestamp: Date.now() };
    io.emit('file:received', info);
    res.json(info);
  });

  app.get('/api/download/:filename', (req, res) => {
    const fp = path.join(uploadsDir, req.params.filename);
    fs.existsSync(fp) ? res.download(fp) : res.status(404).json({ error: 'Not found' });
  });

  app.get('/api/files', (req, res) => {
    try { res.json(fileManager.listDirectory(req.query.path || uploadsDir)); }
    catch (err) { res.status(500).json({ error: err.message }); }
  });

  app.get('/api/system', async (req, res) => {
    try { res.json(await systemControl.getSystemInfo()); }
    catch (err) { res.status(500).json({ error: err.message }); }
  });

  // Socket.IO event handling
  setupSocketEvents(io);

  return new Promise((resolve) => {
    httpServer.listen(port, '0.0.0.0', () => {
      generatePairingCode();
      console.log(`[MoodLink] Server on port ${port}`);
      resolve(httpServer);
    });
  });
}

function setupSocketEvents(io) {
  io.on('connection', (socket) => {
    console.log(`[MoodLink] Device connecting: ${socket.id}`);

    socket.on('pair:request', (data) => {
      if (data.code === pairingCode) {
        const dev = { id: socket.id, name: data.deviceName || 'Unknown', type: data.deviceType || 'phone', connectedAt: Date.now(), transport: 'wifi' };
        connectedDevices.set(socket.id, dev);
        socket.emit('pair:success', { device: dev });
        io.emit('device:connected', { device: dev, totalDevices: connectedDevices.size });
        generatePairingCode();
      } else {
        socket.emit('pair:failed', { error: 'Invalid code' });
      }
    });

    // Mouse
    socket.on('mouse:move', (d) => systemControl.moveMouse(d.dx, d.dy).catch(() => {}));
    socket.on('mouse:click', (d) => systemControl.click(d.button || 'left').catch(() => {}));
    socket.on('mouse:doubleclick', () => systemControl.doubleClick().catch(() => {}));
    socket.on('mouse:scroll', (d) => systemControl.scroll(d.dx || 0, d.dy || 0).catch(() => {}));

    // Keyboard
    socket.on('key:press', (d) => systemControl.keyPress(d.key, d.modifiers || []).catch(() => {}));
    socket.on('key:type', (d) => systemControl.typeText(d.text).catch(() => {}));
    socket.on('key:combo', (d) => systemControl.keyCombo(d.keys).catch(() => {}));

    // Volume
    socket.on('volume:get', async () => { try { socket.emit('volume:level', { level: await systemControl.getVolume() }); } catch(e){} });
    socket.on('volume:set', async (d) => { try { await systemControl.setVolume(d.level); io.emit('volume:changed', { level: d.level }); } catch(e){} });
    socket.on('volume:mute', () => systemControl.toggleMute().catch(() => {}));

    // Advanced Audio Mixer
    socket.on('audio:mixer:get', () => {
      const { exec } = require('child_process');
      const os = require('os');
      const tempExe = path.join(os.tmpdir(), 'SoundVolumeView.exe');
      const jsonPath = path.join(os.tmpdir(), 'volumes.json');
      
      try {
        if (!fs.existsSync(tempExe)) {
          fs.copyFileSync(path.join(__dirname, 'SoundVolumeView.exe'), tempExe);
        }
      } catch(e) { console.error('Failed to copy SVV', e); }

      exec(`"${tempExe}" /sjson "${jsonPath}"`, (err) => {
        if (!err && fs.existsSync(jsonPath)) {
          try {
            const raw = fs.readFileSync(jsonPath, 'utf16le');
            let parsed = [];
            try { parsed = JSON.parse(raw); } 
            catch (e) { parsed = JSON.parse(raw.replace(/^\uFEFF/, '')); }
            
            const apps = parsed
              .filter(item => item.Type === 'Application' && item.Direction === 'Render')
              .map(item => ({
                name: item.Name,
                volume: parseFloat(item['Volume Percent'] || 0),
                muted: item.Muted === 'Yes'
              }));
            socket.emit('audio:mixer:data', apps);
          } catch(e) { console.error('Mixer parse error', e); }
        }
      });
    });

    socket.on('audio:mixer:set', (d) => {
      if (typeof d.name === 'string' && typeof d.volume === 'number') {
        const { exec } = require('child_process');
        const os = require('os');
        const tempExe = path.join(os.tmpdir(), 'SoundVolumeView.exe');
        
        try {
          if (!fs.existsSync(tempExe)) {
            fs.copyFileSync(path.join(__dirname, 'SoundVolumeView.exe'), tempExe);
          }
        } catch(e) { console.error('Failed to copy SVV', e); }

        const safeName = d.name.replace(/"/g, '');
        exec(`"${tempExe}" /SetVolume "${safeName}" ${d.volume}`);
      }
    });

    // Media
    socket.on('media:play', () => systemControl.mediaPlay());
    socket.on('media:next', () => systemControl.mediaNext());
    socket.on('media:prev', () => systemControl.mediaPrev());

    // System commands
    socket.on('system:lock', () => systemControl.lock());
    socket.on('system:sleep', () => systemControl.sleep());
    socket.on('system:shutdown:confirmed', () => systemControl.shutdown());
    socket.on('system:restart:confirmed', () => systemControl.restart());

    // System info
    socket.on('system:info', async () => { try { socket.emit('system:info:data', await systemControl.getSystemInfo()); } catch(e){} });

    // Apps
    socket.on('apps:list', async () => { try { socket.emit('apps:list:data', await systemControl.getRunningApps()); } catch(e){} });
    socket.on('app:launch', async (d) => { try { await systemControl.launchApp(d.path); } catch(e){} });
    socket.on('app:kill', async (d) => { try { await systemControl.killApp(d.pid); } catch(e){} });

    // Clipboard
    socket.on('clipboard:send', (d) => {
      socket.broadcast.emit('clipboard:received', { content: d.content, type: d.type || 'text', from: connectedDevices.get(socket.id)?.name || 'Unknown', timestamp: Date.now() });
    });

    // WebRTC signaling
    socket.on('webrtc:offer', (d) => socket.broadcast.emit('webrtc:offer', { ...d, from: socket.id }));
    socket.on('webrtc:answer', (d) => io.to(d.to).emit('webrtc:answer', { ...d, from: socket.id }));
    socket.on('webrtc:ice', (d) => { d.to ? io.to(d.to).emit('webrtc:ice', { ...d, from: socket.id }) : socket.broadcast.emit('webrtc:ice', { ...d, from: socket.id }); });

    // Bluetooth
    socket.on('bluetooth:scan', async () => {
      try {
        const ports = await systemControl.getBluetoothComPorts();
        socket.emit('bluetooth:devices', ports);
      } catch (e) {}
    });

    socket.on('bluetooth:connect', (data) => {
      const port = data.port;
      const success = systemControl.connectBluetoothBridge(port, (text) => {
        // Data received from phone via bluetooth bridge.
        try {
          const parsed = JSON.parse(text);
          if (parsed.event === 'mouse:move') {
            systemControl.moveMouse(parsed.payload.dx, parsed.payload.dy).catch(()=>{});
          } else if (parsed.event === 'mouse:click') {
            systemControl.click(parsed.payload.button || 'left').catch(()=>{});
          }
        } catch(e) {}
      });
      if (success) {
        socket.emit('pair:success', { device: { id: socket.id, name: 'Phone (Bluetooth)', type: 'phone', transport: 'bluetooth' } });
      } else {
        socket.emit('pair:failed', { error: 'Failed to start bridge' });
      }
    });

    // Presentation Laser Pointer
    socket.on('laser:move', (d) => serverEvents.emit('laser', d));

    // Phone control
    socket.on('phone:command', (d) => socket.broadcast.emit('phone:command', d));

    // Disconnect
    socket.on('disconnect', () => {
      const dev = connectedDevices.get(socket.id);
      if (dev) { connectedDevices.delete(socket.id); io.emit('device:disconnected', { device: dev, totalDevices: connectedDevices.size }); }
    });
  });
}

function stopServer() { if (io) io.close(); if (httpServer) httpServer.close(); }
function getIO() { return io; }
function getConnectedDevices() { return connectedDevices; }

module.exports = { startServer, stopServer, getIO, getConnectedDevices, serverEvents, systemControl };
