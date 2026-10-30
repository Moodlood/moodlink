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

const clipboardDir = path.join(uploadsDir, 'clipboard');
if (!fs.existsSync(clipboardDir)) fs.mkdirSync(clipboardDir, { recursive: true });

const tokensFile = path.join(os.homedir(), '.moodlink_tokens.json');
let pairedTokens = new Set();
try {
  if (fs.existsSync(tokensFile)) {
    const raw = fs.readFileSync(tokensFile, 'utf8');
    pairedTokens = new Set(JSON.parse(raw));
  }
} catch (e) {
  pairedTokens = new Set();
}

function saveToken(token) {
  if (!token) return;
  pairedTokens.add(token);
  try {
    fs.writeFileSync(tokensFile, JSON.stringify([...pairedTokens]));
  } catch (e) {}
}

function getLocalIP() {
  const ifaces = os.networkInterfaces();
  for (const n of Object.keys(ifaces)) {
    for (const i of ifaces[n]) {
      if (i.family === 'IPv4' && !i.internal) { return i.address; }
    }
  }
  return '127.0.0.1';
}

let udpServer = null;
let udpBeaconInterval = null;

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

  app.get('/api/status', (req, res) => {
    const devices = Array.from(connectedDevices.values());
    res.json({
      connected: devices.length > 0,
      devices: devices,
      device: devices[0] || null,
      totalDevices: devices.length,
      pairingCode: pairingCode
    });
  });

  app.get('/api/pairing', (req, res) => {
    const code = pairingCode || generatePairingCode();
    res.json({ code, devices: connectedDevices.size });
  });

  const musicDir = path.join(uploadsDir, 'music');
  if (!fs.existsSync(musicDir)) fs.mkdirSync(musicDir, { recursive: true });

  const musicStorage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, musicDir),
    filename: (req, file, cb) => cb(null, `${Date.now()}-${file.originalname.replace(/[^a-zA-Z0-9.-]/g, '_')}`)
  });
  const musicUpload = multer({ storage: musicStorage, limits: { fileSize: 150 * 1024 * 1024 } });

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
      // Black & Yellow brand theme
      const qr = await QRCode.toDataURL(qrData, { width: 256, color: { dark: '#facc15', light: '#000000' } });
      res.json({ qr, code, ip, port });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // Music Casting & HTTP Range Streaming (Phone -> PC Speakers)
  app.post('/api/audio/cast', musicUpload.single('audio'), (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'No audio file received' });
    const title = req.body.title || req.file.originalname;
    const artist = req.body.artist || 'Phone Music';
    const musicInfo = {
      id: uuidv4(),
      title,
      artist,
      filename: req.file.filename,
      url: `/api/audio/stream/${req.file.filename}`,
      size: req.file.size,
      timestamp: Date.now()
    };
    io.emit('music:loaded', musicInfo);
    res.json(musicInfo);
  });

  app.get('/api/audio/stream/:filename', (req, res) => {
    const filePath = path.join(musicDir, req.params.filename);
    if (!fs.existsSync(filePath)) return res.status(404).send('Audio not found');
    const stat = fs.statSync(filePath);
    const fileSize = stat.size;
    const range = req.headers.range;

    const ext = path.extname(filePath).toLowerCase();
    const mimeTypes = {
      '.mp3': 'audio/mpeg',
      '.m4a': 'audio/mp4',
      '.wav': 'audio/wav',
      '.flac': 'audio/flac',
      '.aac': 'audio/aac',
      '.ogg': 'audio/ogg'
    };
    const contentType = mimeTypes[ext] || 'audio/mpeg';

    if (range) {
      const parts = range.replace(/bytes=/, "").split("-");
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
      const chunksize = (end - start) + 1;
      const file = fs.createReadStream(filePath, { start, end });
      const head = {
        'Content-Range': `bytes ${start}-${end}/${fileSize}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': chunksize,
        'Content-Type': contentType,
      };
      res.writeHead(206, head);
      file.pipe(res);
    } else {
      const head = {
        'Content-Length': fileSize,
        'Content-Type': contentType,
        'Accept-Ranges': 'bytes'
      };
      res.writeHead(200, head);
      fs.createReadStream(filePath).pipe(res);
    }
  });

  // Direct Phone Photo to Windows Clipboard
  app.post('/api/clipboard/image', upload.single('image'), (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'No image' });
    const { exec } = require('child_process');
    const p = req.file.path.replace(/\\/g, '\\\\');
    exec(`powershell -STA -Command "Add-Type -AssemblyName System.Windows.Forms,System.Drawing; $img = [System.Drawing.Image]::FromFile('${p}'); [System.Windows.Forms.Clipboard]::SetImage($img);"`, (err) => {
      if (err) return res.status(500).json({ error: err.message });
      io.emit('clipboard:image:received', { url: `/api/download/${req.file.filename}`, name: req.file.originalname });
      res.json({ ok: true, name: req.file.originalname });
    });
  });

  app.get('/api/clipboard/download/:filename', (req, res) => {
    const fp = path.join(clipboardDir, req.params.filename);
    fs.existsSync(fp) ? res.download(fp) : res.status(404).json({ error: 'Not found' });
  });

  app.post('/api/upload', upload.single('file'), (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'No file' });
    const sender = req.headers['x-sender'] || 'unknown';
    const info = {
      id: uuidv4(),
      name: req.file.originalname,
      path: req.file.path,
      size: req.file.size,
      savedAs: req.file.filename,
      sender: sender,
      url: `/api/download/${req.file.filename}`,
      timestamp: Date.now()
    };
    io.emit('file:available', info);
    io.emit('file:received', info);
    res.json(info);
  });

  app.post('/api/open-folder', (req, res) => {
    try {
      const { exec } = require('child_process');
      exec(`explorer.exe "${uploadsDir}"`);
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
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

  return new Promise((resolve, reject) => {
    httpServer.on('error', (err) => {
      console.error('[MoodLink] HTTP Server error:', err.message);
      if (err.code === 'EADDRINUSE') {
        console.warn(`[MoodLink] Port ${port} is in use, attempting to bind on port ${port + 1}...`);
        try {
          httpServer.listen(port + 1, '0.0.0.0');
        } catch (e) {
          reject(e);
        }
      } else {
        reject(err);
      }
    });

    httpServer.listen(port, '0.0.0.0', () => {
      const activePort = httpServer.address().port;
      generatePairingCode();
      console.log(`[MoodLink] Server on port ${activePort}`);

      // Start UDP Discovery Beacon on port 3848
      try {
        const dgram = require('dgram');
        udpServer = dgram.createSocket({ type: 'udp4', reuseAddr: true });
        udpServer.on('error', (err) => {
          console.warn('[MoodLink UDP] Beacon warning:', err.message);
        });
        udpServer.on('message', (msg, rinfo) => {
          const str = msg.toString().trim();
          if (str === 'MOODLINK_DISCOVER') {
            const reply = JSON.stringify({
              app: 'moodlink',
              name: os.hostname(),
              ip: getLocalIP(),
              port: port,
              version: '1.0.0'
            });
            udpServer.send(reply, rinfo.port, rinfo.address, () => {});
          }
        });
        udpServer.bind(3848, () => {
          try {
            udpServer.setBroadcast(true);
            udpBeaconInterval = setInterval(() => {
              try {
                const beacon = JSON.stringify({
                  app: 'moodlink',
                  name: os.hostname(),
                  ip: getLocalIP(),
                  port: port,
                  timestamp: Date.now()
                });
                udpServer.send(beacon, 3848, '255.255.255.255', () => {});
              } catch(e) {}
            }, 3500);
          } catch(e) {}
        });
      } catch(e) {
        console.warn('[MoodLink UDP] Bind error:', e);
      }

      resolve(httpServer);
    });
  });
}

function setupSocketEvents(io) {
  // Relay background screenshot & app foreground events
  serverEvents.on('pc:screenshot:captured', (filename) => {
    io.emit('clipboard:pc:screenshot', {
      name: filename,
      url: `/api/clipboard/download/${filename}`,
      timestamp: Date.now()
    });
  });

  serverEvents.on('app:foreground:changed', (appName) => {
    io.emit('system:foreground:changed', { app: appName });
  });

  io.on('connection', (socket) => {
    console.log(`[MoodLink] Device connecting: ${socket.id}`);
    
    // Sync existing connection state to newly connected client (like the UI wrapper)
    if (connectedDevices.size > 0) {
      const existingDev = Array.from(connectedDevices.values())[0];
      socket.emit('device:connected', { device: existingDev, totalDevices: connectedDevices.size });
    }

    let previousPairingCode = null;

    // Allow querying currently connected devices
    socket.on('device:query', () => {
      if (connectedDevices.size > 0) {
        const existingDev = Array.from(connectedDevices.values())[0];
        socket.emit('device:connected', { device: existingDev, totalDevices: connectedDevices.size });
      } else {
        socket.emit('device:disconnected', { totalDevices: 0 });
      }
    });

    socket.on('pair:request', (data) => {
      if (data.code === pairingCode || (previousPairingCode && data.code === previousPairingCode)) {
        const dev = { id: socket.id, name: data.deviceName || 'Phone', type: data.deviceType || 'phone', connectedAt: Date.now(), transport: 'wifi' };
        connectedDevices.set(socket.id, dev);
        previousPairingCode = data.code;
        const authToken = uuidv4();
        saveToken(authToken);
        socket.emit('pair:success', { device: dev, authToken });
        io.emit('device:connected', { device: dev, totalDevices: connectedDevices.size });
        serverEvents.emit('device:connected', dev);
        generatePairingCode();
      } else {
        socket.emit('pair:failed', { error: 'Invalid code' });
      }
    });

    // Zero-touch persistent token pairing
    socket.on('pair:token', (data) => {
      if (data && data.token && pairedTokens.has(data.token)) {
        const dev = { id: socket.id, name: data.deviceName || 'Phone', type: data.deviceType || 'phone', connectedAt: Date.now(), transport: 'wifi' };
        connectedDevices.set(socket.id, dev);
        socket.emit('pair:success', { device: dev, authToken: data.token });
        io.emit('device:connected', { device: dev, totalDevices: connectedDevices.size });
        serverEvents.emit('device:connected', dev);
      } else {
        socket.emit('pair:failed', { error: 'Invalid or expired session token' });
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
            
            // Find active default render device
            const devDefault = parsed.find(i => i.Type === 'Device' && i.Direction === 'Render' && (i.Default === 'Render' || i.Default === 'Capture/Render'));
            const activeDevName = devDefault ? (devDefault['Device Name'] || devDefault.Name) : '';

            const cleanMap = new Map();
            for (const item of parsed) {
              if (item.Type !== 'Application' || item.Direction !== 'Render') continue;

              const devName = item['Device Name'] || '';
              // If default device identified, ignore sessions on disconnected/other devices
              if (activeDevName && devName && !devName.includes(activeDevName) && !activeDevName.includes(devName)) {
                continue;
              }

              const procPath = item['Process Path'] || '';
              let displayName = item.Name || '';

              if (procPath) {
                const exe = path.basename(procPath).toLowerCase().replace('.exe', '');
                const friendly = {
                  'chrome': 'Google Chrome',
                  'spotify': 'Spotify',
                  'code': 'VS Code',
                  'msedge': 'Microsoft Edge',
                  'firefox': 'Firefox',
                  'vlc': 'VLC Media Player',
                  'mpv': 'MPV Player',
                  'discord': 'Discord',
                  'shellexperiencehost': 'Windows Shell',
                  'explorer': 'File Explorer',
                  'obs64': 'OBS Studio',
                  'steam': 'Steam'
                };
                displayName = friendly[exe] || (exe.charAt(0).toUpperCase() + exe.slice(1));
              } else if (displayName.includes('Windows') || displayName.includes('System Sounds')) {
                displayName = 'System Sounds';
              }

              // Deduplicate so we never display multiple duplicate rows for the same app
              if (!cleanMap.has(displayName)) {
                cleanMap.set(displayName, {
                  id: item['Command-Line Friendly ID'] || item['Item ID'] || item.Name,
                  name: displayName,
                  volume: Math.round(parseFloat(item['Volume Percent'] || 0)),
                  muted: item.Muted === 'Yes'
                });
              }
            }

            socket.emit('audio:mixer:data', [...cleanMap.values()]);
          } catch(e) { console.error('Mixer parse error', e); }
        }
      });
    });

    socket.on('audio:mixer:set', (d) => {
      if (d && typeof d.volume === 'number') {
        const { exec } = require('child_process');
        const os = require('os');
        const tempExe = path.join(os.tmpdir(), 'SoundVolumeView.exe');
        
        try {
          if (!fs.existsSync(tempExe)) {
            fs.copyFileSync(path.join(__dirname, 'SoundVolumeView.exe'), tempExe);
          }
        } catch(e) { console.error('Failed to copy SVV', e); }

        const target = (d.id || d.name || '').replace(/"/g, '');
        if (target) {
          exec(`"${tempExe}" /SetVolume "${target}" ${d.volume}`);
        }
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

    // Apps & Macros
    socket.on('apps:list', async () => { try { socket.emit('apps:list:data', await systemControl.getRunningApps()); } catch(e){} });
    socket.on('app:launch', async (d) => { try { await systemControl.launchApp(d.app || d.path); } catch(e){} });
    socket.on('app:kill', async (d) => { try { await systemControl.killApp(d.pid); } catch(e){} });
    socket.on('macro:exec', (d) => { if (d && (d.combo || d.keys)) systemControl.keyCombo(d.combo || d.keys).catch(()=>{}); });

    // Bi-directional Music Streaming
    socket.on('music:control', (d) => {
      io.emit('music:control', d);
    });
    socket.on('music:progress', (d) => {
      socket.broadcast.emit('music:progress', d);
    });

    // Bi-directional Alerts & Status
    socket.on('pc:ping', () => {
      io.emit('pc:ping');
    });
    socket.on('phone:status', (d) => {
      io.emit('phone:status:update', d);
    });

    // Clipboard
    socket.on('clipboard:send', (d) => {
      socket.broadcast.emit('clipboard:received', { content: d.content, type: d.type || 'text', from: connectedDevices.get(socket.id)?.name || 'Unknown', timestamp: Date.now() });
    });

    // WebRTC signaling & Audio loopback
    socket.on('webrtc:offer', (d) => socket.broadcast.emit('webrtc:offer', { ...d, from: socket.id }));
    socket.on('webrtc:answer', (d) => io.to(d.to).emit('webrtc:answer', { ...d, from: socket.id }));
    socket.on('webrtc:ice', (d) => { d.to ? io.to(d.to).emit('webrtc:ice', { ...d, from: socket.id }) : socket.broadcast.emit('webrtc:ice', { ...d, from: socket.id }); });
    socket.on('pc:audio:toggle', () => io.emit('pc:audio:toggle:request'));
    socket.on('pc:audio:streaming:status', (d) => socket.broadcast.emit('pc:audio:streaming:status', d));

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
      if (dev) { 
        connectedDevices.delete(socket.id); 
        io.emit('device:disconnected', { device: dev, totalDevices: connectedDevices.size });
        serverEvents.emit('device:disconnected', dev);
      }
    });
  });
}

function stopServer() {
  if (udpBeaconInterval) clearInterval(udpBeaconInterval);
  if (udpServer) { try { udpServer.close(); } catch(e) {} }
  if (io) io.close();
  if (httpServer) httpServer.close();
}
function getIO() { return io; }
function getConnectedDevices() { return connectedDevices; }

module.exports = { startServer, stopServer, getIO, getConnectedDevices, serverEvents, systemControl };
