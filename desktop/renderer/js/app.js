/**
 * MoodLink Desktop App Controller
 * Handles UI interactions, Socket.IO connections, and IPC bridging
 */

// Initialize Socket.IO connection to local server
let socket = null;
let currentTab = 'dashboard';
let deviceConnected = false;
let systemRefreshInterval = null;

// Safe window controls bridge (WebView2 + Electron compatible)
window.moodlink = window.moodlink || {
  minimize: () => {
    if (window.chrome && window.chrome.webview) {
      window.chrome.webview.postMessage('minimize');
    }
  },
  maximize: () => {
    if (window.chrome && window.chrome.webview) {
      window.chrome.webview.postMessage('maximize');
    }
  },
  close: () => {
    if (window.chrome && window.chrome.webview) {
      window.chrome.webview.postMessage('close');
    }
  }
};

// Formatter utilities
function formatSize(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024, sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

function getServerUrl() {
  const port = window.location.port || '3847';
  const host = window.location.hostname || 'localhost';
  if (window.location.protocol.startsWith('http')) {
    return `${window.location.protocol}//${host}:${port}`;
  }
  return `http://localhost:${port}`;
}

function updateConnectionStatus(connected, deviceName = 'Phone') {
  const el = document.getElementById('connection-status');
  if (!el) return;
  const textEl = el.querySelector('.conn-text');
  if (connected) {
    el.classList.remove('disconnected');
    el.classList.add('connected');
    if (textEl) textEl.innerText = deviceName;
  } else {
    el.classList.remove('connected');
    el.classList.add('disconnected');
    if (textEl) textEl.innerText = 'No device';
  }
}

async function refreshPairingCode() {
  try {
    const serverUrl = getServerUrl();
    const res = await fetch(`${serverUrl}/api/qrcode`);
    if (!res.ok) return;
    const data = await res.json();
    
    const qrContainer = document.getElementById('qr-code');
    if (qrContainer && data.qr) {
      qrContainer.innerHTML = `<img src="${data.qr}" alt="Pairing QR Code" style="width: 100%; height: 100%; object-fit: contain; border-radius: 8px;" />`;
    }

    const codeContainer = document.getElementById('pairing-code');
    if (codeContainer && data.code) {
      codeContainer.innerHTML = data.code.split('').map(d => `<span class="code-digit">${d}</span>`).join('');
    }

    const ipSpan = document.getElementById('server-ip');
    if (ipSpan && data.ip) ipSpan.innerText = data.ip;

    const portSpan = document.getElementById('server-port');
    if (portSpan && data.port) portSpan.innerText = data.port;
  } catch (err) {
    console.warn('Failed to load pairing code:', err);
  }
}

// ─── Initialization ──────────────────────────────────────────────────
async function initApp() {
  try {
    const serverUrl = getServerUrl();
    
    // Connect to embedded secure server
    if (typeof io !== 'undefined') {
      socket = io(serverUrl, {
        reconnection: true,
        reconnectionAttempts: Infinity,
        reconnectionDelay: 1000
      });
      setupSocketEvents();
    } else {
      console.warn('Socket.io client not available yet');
    }
    
    // Initial fetch
    await refreshPairingCode();
    await checkDeviceStatus();
    
    // Periodic status poll to keep UI in sync
    setInterval(checkDeviceStatus, 3000);
    
    // Setup file drag & drop
    setupFileDropZone();
    
    // Setup app window controls
    setupWindowControls();

    // Setup PC Audio Player event listeners
    const pcAudio = document.getElementById('moodlink-pc-player');
    if (pcAudio) {
      pcAudio.ontimeupdate = () => {
        const cur = document.getElementById('music-current-time');
        const dur = document.getElementById('music-duration');
        const scrub = document.getElementById('music-scrubber');
        if (cur) cur.innerText = formatTime(pcAudio.currentTime);
        if (dur && pcAudio.duration) dur.innerText = formatTime(pcAudio.duration);
        if (scrub && pcAudio.duration) {
          scrub.value = (pcAudio.currentTime / pcAudio.duration) * 100;
        }
        if (socket) {
          socket.emit('music:progress', {
            currentTime: pcAudio.currentTime,
            duration: pcAudio.duration || 0,
            isPlaying: !pcAudio.paused
          });
        }
      };
      pcAudio.onended = () => {
        updatePlayIcon(false);
        if (socket) {
          socket.emit('music:progress', { currentTime: 0, duration: pcAudio.duration || 0, isPlaying: false });
        }
      };
      pcAudio.onplay = () => updatePlayIcon(true);
      pcAudio.onpause = () => updatePlayIcon(false);
    }
    
    showToast('MoodLink ready', 'success');
  } catch (err) {
    console.error('App init error:', err);
  }
}

// Check device status via REST API as fallback
async function checkDeviceStatus() {
  try {
    const serverUrl = getServerUrl();
    const res = await fetch(`${serverUrl}/api/status`);
    if (!res.ok) return;
    const data = await res.json();
    if (data.connected && data.device) {
      if (!deviceConnected) {
        deviceConnected = true;
        updateConnectionStatus(true, data.device.name || 'Phone');
        if (currentTab === 'pairing') switchTab('dashboard');
      }
    } else {
      if (deviceConnected) {
        deviceConnected = false;
        updateConnectionStatus(false);
      }
    }
  } catch (e) {
    // server temporarily unreachable
  }
}

// ─── Window Controls ─────────────────────────────────────────────────
function setupWindowControls() {
  // C# WebView2 handles max/min automatically via the injected script.
}

// ─── Navigation ──────────────────────────────────────────────────────
function switchTab(tabId) {
  // Update nav buttons
  document.querySelectorAll('.nav-item').forEach(btn => {
    if (btn.dataset.tab === tabId) btn.classList.add('active');
    else btn.classList.remove('active');
  });

  // Update panels
  document.querySelectorAll('.tab-panel').forEach(panel => {
    if (panel.id === `tab-${tabId}`) panel.classList.add('active');
    else panel.classList.remove('active');
  });
  
  currentTab = tabId;
  
  // Tab specific logic
  if (tabId === 'system') {
    refreshSystemInfo();
    refreshApps();
    if (!systemRefreshInterval) {
      systemRefreshInterval = setInterval(refreshSystemInfo, 3000);
    }
  } else {
    if (systemRefreshInterval) {
      clearInterval(systemRefreshInterval);
      systemRefreshInterval = null;
    }
  }
}

// ─── Socket Events ───────────────────────────────────────────────────
function setupSocketEvents() {
  socket.on('connect', () => {
    console.log('Connected to local server');
    socket.emit('device:query');
  });

  socket.on('device:connected', (data) => {
    deviceConnected = true;
    const devName = (data && data.device && data.device.name) ? data.device.name : 'Phone';
    updateConnectionStatus(true, devName);
    showToast(`${devName} connected`, 'success');
    addActivityLog(`Device connected: ${devName}`);
    
    // Switch to dashboard if on pairing screen
    if (currentTab === 'pairing') switchTab('dashboard');
  });

  socket.on('device:disconnected', (data) => {
    deviceConnected = false;
    updateConnectionStatus(false);
    const devName = (data && data.device && data.device.name) ? data.device.name : 'Device';
    showToast(`${devName} disconnected`, 'error');
    addActivityLog(`Device disconnected: ${devName}`);
  });

  // Clipboard sync
  socket.on('clipboard:received', (data) => {
    addClipboardHistory(data.content, data.from, 'received');
    if (data.type === 'text') {
      navigator.clipboard.writeText(data.content).catch(err => {
        console.error('Failed to write to clipboard:', err);
      });
    }
    showToast('Clipboard received and copied', 'success');
    addActivityLog('Received clipboard data');
  });

  // File transfer
  socket.on('file:received', (data) => {
    if (data.sender === 'desktop') return;
    addFileToList(data, 'received');
    showToast(`File received from phone: ${data.name}`, 'success');
    addActivityLog(`Received file: ${data.name}`);
  });

  // System volume
  socket.on('volume:changed', (data) => {
    const slider = document.getElementById('volume-slider');
    const valText = document.getElementById('volume-value');
    if (slider) slider.value = data.level;
    if (valText) valText.innerText = `${data.level}%`;
  });

  socket.on('volume:level', (data) => {
    const slider = document.getElementById('volume-slider');
    const valText = document.getElementById('volume-value');
    if (slider) slider.value = data.level;
    if (valText) valText.innerText = `${data.level}%`;
  });

  // System info
  socket.on('system:info:data', (data) => {
    updateSystemGauges(data);
  });

  // Apps list
  socket.on('apps:list:data', (apps) => {
    updateAppsList(apps);
  });
  
  socket.on('app:killed', (data) => {
    showToast(`App terminated`, 'success');
    setTimeout(refreshApps, 1000);
  });

  // System Command Confirmations
  socket.on('system:confirm', (data) => {
    showConfirmModal(
      `${data.action.charAt(0).toUpperCase() + data.action.slice(1)} PC`,
      `Are you sure you want to ${data.action} this computer?`,
      () => {
        socket.emit(`system:${data.action}:confirmed`);
        showToast(`Executing ${data.action}...`, 'warning');
      }
    );
  });

  // WebRTC Signals
  socket.on('webrtc:offer', async (data) => {
    initWebRTC(true);
    try {
      await peerConnection.setRemoteDescription(new RTCSessionDescription(data.offer));
      const answer = await peerConnection.createAnswer();
      await peerConnection.setLocalDescription(answer);
      socket.emit('webrtc:answer', { answer, to: data.from });
    } catch (e) {
      console.error('Error handling offer:', e);
    }
  });

  socket.on('webrtc:stream:stopped', () => {
    const remoteVideo = document.getElementById('remote-video');
    const overlay = document.getElementById('video-overlay');
    if (remoteVideo) {
      remoteVideo.srcObject = null;
    }
    if (overlay) {
      overlay.style.display = 'block';
    }
  });

  socket.on('webrtc:answer', async (data) => {
    if (peerConnection) {
      try {
        await peerConnection.setRemoteDescription(new RTCSessionDescription(data.answer));
      } catch (e) {
        console.error('Error handling answer:', e);
      }
    }
  });

  socket.on('webrtc:ice', async (data) => {
    if (peerConnection && data.candidate) {
      try {
        await peerConnection.addIceCandidate(new RTCIceCandidate(data.candidate));
      } catch (e) {
        console.error('Error adding ICE candidate', e);
      }
    }
  });

  // Phone to PC Music Player Sockets
  socket.on('music:loaded', (track) => {
    const card = document.getElementById('music-player-card');
    const title = document.getElementById('music-title');
    const artist = document.getElementById('music-artist');
    const pcAudio = document.getElementById('moodlink-pc-player');
    
    if (card) card.style.display = 'flex';
    if (title) title.innerText = track.title || track.filename;
    if (artist) artist.innerText = track.artist || 'Phone Music Stream';
    
    const serverUrl = getServerUrl();
    pcAudio.src = `${serverUrl}${track.url}`;
    pcAudio.play().then(() => {
      updatePlayIcon(true);
      showToast(`Now playing on PC speakers: ${track.title || track.filename}`, 'success');
    }).catch(e => console.warn('Autoplay error', e));
  });

  socket.on('music:control', (d) => {
    const pcAudio = document.getElementById('moodlink-pc-player');
    if (!pcAudio) return;
    if (d.action === 'play') {
      pcAudio.play().catch(()=>{});
      updatePlayIcon(true);
    } else if (d.action === 'pause') {
      pcAudio.pause();
      updatePlayIcon(false);
    } else if (d.action === 'seek') {
      if (pcAudio.duration) {
        pcAudio.currentTime = (d.value / 100) * pcAudio.duration;
      }
    } else if (d.action === 'volume') {
      pcAudio.volume = Math.max(0, Math.min(1, d.value / 100));
      const volSlider = document.getElementById('music-volume');
      if (volSlider) volSlider.value = d.value;
    }
  });

  // Bi-directional Alerts & Pings
  socket.on('pc:ping', () => {
    playPingChime();
    showToast('Phone Pinged PC!', 'success');
    addActivityLog('Phone pinged this PC');
  });

  // Phone Battery & Transport Status
  socket.on('phone:status:update', (data) => {
    const card = document.getElementById('phone-status-card');
    const name = document.getElementById('phone-status-name');
    const meta = document.getElementById('phone-status-meta');
    if (card) card.style.display = 'flex';
    if (name && data.name) name.innerText = data.name;
    if (meta) {
      const bat = data.battery != null ? `${data.battery}%` : 'N/A';
      const charge = data.charging ? ' (Charging)' : '';
      const mode = data.mode || 'WiFi';
      meta.innerText = `Battery: ${bat}${charge} • Mode: ${mode}`;
    }
  });

  socket.on('clipboard:image:received', (data) => {
    showToast(`Photo copied to Windows Clipboard: ${data.name || 'Image'}`, 'success');
    addActivityLog('Photo copied to Windows Clipboard');
  });

  socket.on('bluetooth:devices', (ports) => {
    const list = document.getElementById('bt-devices');
    if (!ports || ports.length === 0) {
      list.innerHTML = '<div class="activity-empty" style="text-align:center;">No paired Bluetooth COM ports found.<br/>Please pair your phone in Windows Bluetooth Settings first.</div>';
      return;
    }
    
    list.innerHTML = ports.map(port => `
      <div class="activity-item" style="cursor:pointer; padding: 12px; background: rgba(255,255,255,0.03); border: 1px solid var(--border); border-radius: 8px; margin-bottom: 8px;" onclick="connectBluetooth('${port}')">
        <div class="file-icon" style="color: var(--accent);"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6.5 6.5 17.5 17.5 12 23 12 1 17.5 6.5 6.5 17.5"/></svg></div>
        <div class="file-info">
          <div class="file-name" style="color: var(--text-primary); font-weight:700;">${port}</div>
          <div class="file-meta">Bluetooth SPP Device</div>
        </div>
        <button class="btn btn-primary btn-sm">Connect</button>
      </div>
    `).join('');
  });

  socket.on('intercom:toggle:request', () => {
    toggleIntercom();
  });

  socket.on('pc:audio:toggle:request', () => {
    togglePCAudioStream();
  });
}

function connectBluetooth(port) {
  const list = document.getElementById('bt-devices');
  list.innerHTML = `<div class="activity-empty"><div class="qr-loading">Connecting to ${port}...</div></div>`;
  socket.emit('bluetooth:connect', { port });
}

function scanBluetooth() {
  const list = document.getElementById('bt-devices');
  list.innerHTML = '<div class="activity-empty"><div class="qr-loading">Scanning paired devices...</div></div>';
  socket.emit('bluetooth:scan');
}

function playPingChime() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(880, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(1760, ctx.currentTime + 0.15);
    gain.gain.setValueAtTime(0.6, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.45);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.45);
  } catch(e) {}
}

function formatTime(secs) {
  if (isNaN(secs)) return '0:00';
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60);
  return `${m}:${s < 10 ? '0' : ''}${s}`;
}

function toggleMusicPlayback() {
  const pcAudio = document.getElementById('moodlink-pc-player');
  if (!pcAudio) return;
  if (pcAudio.paused) {
    pcAudio.play().catch(()=>{});
    updatePlayIcon(true);
    socket.emit('music:control', { action: 'play' });
  } else {
    pcAudio.pause();
    updatePlayIcon(false);
    socket.emit('music:control', { action: 'pause' });
  }
}

function updatePlayIcon(isPlaying) {
  const icon = document.getElementById('music-play-icon');
  const eq = document.getElementById('music-eq');
  if (isPlaying) {
    if (icon) icon.innerHTML = '<rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/>';
    if (eq) eq.classList.remove('eq-paused');
  } else {
    if (icon) icon.innerHTML = '<polygon points="5 3 19 12 5 21 5 3"/>';
    if (eq) eq.classList.add('eq-paused');
  }
}

function seekMusic(percent) {
  const pcAudio = document.getElementById('moodlink-pc-player');
  if (pcAudio && pcAudio.duration) {
    pcAudio.currentTime = (percent / 100) * pcAudio.duration;
    socket.emit('music:control', { action: 'seek', value: percent });
  }
}

function setMusicPlayerVolume(val) {
  const pcAudio = document.getElementById('moodlink-pc-player');
  if (pcAudio) {
    pcAudio.volume = val / 100;
    socket.emit('music:control', { action: 'volume', value: parseInt(val) });
  }
}

// ─── Clipboard ───────────────────────────────────────────────────────
function sendClipboard() {
  if (!deviceConnected) return showToast('No device connected', 'error');
  
  const text = document.getElementById('clip-text').value;
  if (!text.trim()) return;
  
  socket.emit('clipboard:send', { content: text, type: 'text' });
  addClipboardHistory(text, 'Desktop PC', 'sent');
  document.getElementById('clip-text').value = '';
  showToast('Clipboard sent to phone', 'success');
  addActivityLog('Sent clipboard text');
}

function addClipboardHistory(content, source, direction) {
  const list = document.getElementById('clip-history');
  
  // Remove empty state
  const empty = list.querySelector('.activity-empty');
  if (empty) empty.remove();
  
  const div = document.createElement('div');
  div.className = 'clip-item';
  
  const preview = content.length > 60 ? content.substring(0, 60) + '...' : content;
  const icon = direction === 'sent' ? '↗️' : '↙️';
  
  div.innerHTML = `
    <div>${icon} <strong>${preview}</strong></div>
    <div class="clip-from">${direction === 'sent' ? 'Sent to' : 'Received from'} ${source} • Just now</div>
  `;
  
  div.onclick = () => {
    navigator.clipboard.writeText(content);
    showToast('Copied to clipboard', 'success');
  };
  
  list.insertBefore(div, list.firstChild);
}

// ─── File Transfer ───────────────────────────────────────────────────
function setupFileDropZone() {
  const dropZone = document.getElementById('drop-zone');
  const fileInput = document.getElementById('file-input');
  if (!dropZone || !fileInput) return;

  dropZone.addEventListener('click', () => fileInput.click());
  
  dropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropZone.classList.add('drag-over');
  });

  ['dragleave', 'dragend'].forEach(type => {
    dropZone.addEventListener(type, () => dropZone.classList.remove('drag-over'));
  });

  dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropZone.classList.remove('drag-over');
    if (e.dataTransfer.files.length) uploadFiles(e.dataTransfer.files);
  });

  fileInput.addEventListener('change', (e) => {
    if (e.target.files.length) uploadFiles(e.target.files);
  });
}

async function uploadFiles(files) {
  if (!deviceConnected) {
    showToast('Connect a device first to send files', 'error');
    return;
  }

  for (const file of files) {
    try {
      showToast(`Uploading ${file.name}...`, 'warning');
      const formData = new FormData();
      formData.append('file', file);
      
      const port = window.location.port || '3847';
      const res = await fetch(`http://localhost:${port}/api/upload`, {
        method: 'POST',
        headers: { 'x-sender': 'desktop' },
        body: formData
      });
      
      if (!res.ok) throw new Error('Upload failed');
      const data = await res.json();
      
      addFileToList(data, 'sent');
      showToast(`${file.name} sent to phone successfully`, 'success');
      addActivityLog(`Sent file to phone: ${file.name}`);
      
    } catch (err) {
      console.error(err);
      showToast(`Failed to send ${file.name}`, 'error');
    }
  }
}

async function openUploadsFolder() {
  try {
    const port = window.location.port || '3847';
    await fetch(`http://localhost:${port}/api/open-folder`, { method: 'POST' });
  } catch (err) {
    showToast('Failed to open uploads folder', 'error');
  }
}

function addFileToList(fileInfo, direction) {
  const list = document.getElementById('file-list');
  
  const empty = list.querySelector('.activity-empty');
  if (empty) empty.remove();
  
  const div = document.createElement('div');
  div.className = 'file-item';
  
  const ext = fileInfo.name.substring(fileInfo.name.lastIndexOf('.')).toLowerCase();
  const icons = {
    '.pdf': '📄', '.doc': '📝', '.jpg': '🖼️', '.png': '🖼️', 
    '.mp4': '🎬', '.mp3': '🎵', '.zip': '📦'
  };
  const icon = icons[ext] || '📁';
  const size = formatSize(fileInfo.size);
  const port = window.location.port || '3847';
  
  div.innerHTML = `
    <div class="file-icon">${icon}</div>
    <div class="file-info">
      <div class="file-name">${fileInfo.name}</div>
      <div class="file-meta">${size} • ${direction === 'sent' ? 'Sent to Phone' : 'Received from Phone'}</div>
    </div>
    <div class="file-actions" style="display: flex; gap: 6px;">
      ${direction === 'received' ? 
        `<button class="btn btn-sm btn-secondary" onclick="openUploadsFolder()" title="Open Folder">Open</button>
         <button class="btn btn-sm btn-secondary" onclick="window.open('http://localhost:${port}/api/download/${fileInfo.savedAs}', '_blank')">Save</button>` : 
        `<span class="file-meta" style="color: var(--success); font-weight: 600;">✓ Sent</span>`
      }
    </div>
  `;
  
  list.insertBefore(div, list.firstChild);
}

// ─── System Control ──────────────────────────────────────────────────
function refreshSystemInfo() {
  socket.emit('system:info');
  socket.emit('volume:get');
}

function refreshApps() {
  socket.emit('apps:list');
  const list = document.getElementById('apps-list');
  list.innerHTML = '<div class="activity-empty"><p>Loading apps...</p></div>';
}

function updateSystemGauges(info) {
  if (info.error) return;

  // CPU
  const cpuPercent = info.cpu.usage || 0;
  document.getElementById('cpu-fill').style.setProperty('--percent', cpuPercent);
  document.getElementById('cpu-value').innerText = `${cpuPercent}%`;

  // Memory
  const memPercent = info.memory.percent || 0;
  document.getElementById('mem-fill').style.setProperty('--percent', memPercent);
  document.getElementById('mem-value').innerText = `${memPercent}%`;

  // Battery
  const batFill = document.getElementById('bat-fill');
  const batValue = document.getElementById('bat-value');
  
  if (info.battery.hasBattery) {
    const batPercent = info.battery.percent || 0;
    batFill.style.setProperty('--percent', batPercent);
    batValue.innerText = `${batPercent}%`;
    
    batFill.classList.remove('gauge-fill-green');
    if (batPercent < 20) batFill.style.stroke = 'var(--error)';
    else if (batPercent < 50) batFill.style.stroke = 'var(--warning)';
    else batFill.classList.add('gauge-fill-green');
  } else {
    batFill.style.setProperty('--percent', 100);
    batValue.innerText = 'AC';
  }
}

function updateAppsList(apps) {
  const list = document.getElementById('apps-list');
  list.innerHTML = '';
  
  if (!apps || apps.length === 0) {
    list.innerHTML = '<div class="activity-empty"><p>No running applications found</p></div>';
    return;
  }
  
  // Filter and sort apps
  const visibleApps = apps.filter(a => a.title).sort((a, b) => a.title.localeCompare(b.title));
  
  visibleApps.forEach(app => {
    const div = document.createElement('div');
    div.className = 'app-item';
    div.innerHTML = `
      <div class="file-icon">💻</div>
      <div class="file-info">
        <div class="app-name">${app.name}</div>
        <div class="app-title">${app.title.length > 40 ? app.title.substring(0, 40) + '...' : app.title}</div>
      </div>
      <button class="app-kill-btn" onclick="killApp(${app.pid}, '${app.name}')">End Task</button>
    `;
    list.appendChild(div);
  });
}

function killApp(pid, name) {
  showConfirmModal('End Task', `Are you sure you want to force close ${name}? Unsaved data may be lost.`, () => {
    socket.emit('app:kill', { pid });
  });
}

function setVolume(level) {
  document.getElementById('volume-value').innerText = `${level}%`;
  socket.emit('volume:set', { level: parseInt(level) });
}

function toggleMute() {
  socket.emit('volume:mute');
}

function mediaControl(action) {
  socket.emit(`media:${action}`);
  showToast(`Media: ${action}`, 'success');
}

function systemCommand(action) {
  let text = '';
  if (action === 'lock') text = 'Lock the computer screen?';
  else if (action === 'sleep') text = 'Put the computer to sleep?';
  else if (action === 'restart') text = 'Restart the computer? All apps will close.';
  else if (action === 'shutdown') text = 'Shut down the computer? All apps will close.';
  
  showConfirmModal(`System ${action}`, text, () => {
    if (action === 'lock' || action === 'sleep') {
      socket.emit(`system:${action}`);
      showToast(`System ${action} initiated`, 'success');
    } else {
      socket.emit(`system:${action}:confirmed`);
      showToast(`System ${action} initiated`, 'warning');
    }
  });
}

function phoneCommand(action, message) {
  if (!deviceConnected) return showToast('No device connected', 'error');
  if (action === 'alert' && !message) {
    const msg = prompt('Enter message to show on phone screen:');
    if (!msg) return;
    message = msg;
  }
  socket.emit('phone:command', { action, message });
  showToast(`Command sent to phone: ${action}`, 'success');
}

// ─── Activity Log ────────────────────────────────────────────────────
function addActivityLog(message) {
  const list = document.getElementById('activity-log');
  
  const empty = list.querySelector('.activity-empty');
  if (empty) empty.remove();
  
  const div = document.createElement('div');
  div.className = 'activity-item';
  
  const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  
  div.innerHTML = `
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="pulse-icon"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
    <span>${message}</span>
    <span class="time">${time}</span>
  `;
  
  list.insertBefore(div, list.firstChild);
  
  // Keep only last 20
  if (list.children.length > 20) {
    list.removeChild(list.lastChild);
  }
}

// ─── Modals & Toasts ─────────────────────────────────────────────────
let confirmCallback = null;

function showConfirmModal(title, text, callback) {
  document.getElementById('confirm-title').innerText = title;
  document.getElementById('confirm-text').innerText = text;
  confirmCallback = callback;
  document.getElementById('confirm-modal').style.display = 'flex';
}

function closeModal() {
  document.getElementById('confirm-modal').style.display = 'none';
  confirmCallback = null;
}

function confirmAction() {
  if (confirmCallback) confirmCallback();
  closeModal();
}

function showToast(message, type = 'success') {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  
  const icon = type === 'success' 
    ? '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--success)" stroke-width="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>'
    : '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--error)" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>';
  
  toast.innerHTML = `${icon} <span>${message}</span>`;
  container.appendChild(toast);
  
  setTimeout(() => toast.remove(), 3500);
}

// ─── WebRTC Implementation ─────────────────────────────────────────────
let peerConnection = null;
let localStream = null;
let isScreenMirroring = false;
let isWebcamMirroring = false;
let isIntercomActive = false;

const rtcConfig = {
  iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
};

function initWebRTC(forceReset = false) {
  if (peerConnection && !forceReset) {
    if (peerConnection.connectionState === 'connected' || peerConnection.connectionState === 'connecting') {
      return;
    }
  }
  
  if (peerConnection) {
    try {
      peerConnection.close();
    } catch(e) {}
    peerConnection = null;
  }
  
  peerConnection = new RTCPeerConnection(rtcConfig);
  
  peerConnection.onicecandidate = (event) => {
    if (event.candidate) {
      socket.emit('webrtc:ice', { candidate: event.candidate });
    }
  };
  
  peerConnection.ontrack = (event) => {
    const remoteVideo = document.getElementById('remote-video');
    const overlay = document.getElementById('video-overlay');
    
    if (remoteVideo && event.streams && event.streams[0]) {
      remoteVideo.srcObject = event.streams[0];
      remoteVideo.play().catch(e => console.warn('Video play error:', e));
      if (overlay) overlay.style.display = 'none';
      showToast('Receiving stream from phone', 'success');
    }
  };

  // High-frequency, sub-10ms unbuffered DataChannel for mouse and gyro
  peerConnection.ondatachannel = (event) => {
    const dc = event.channel;
    if (dc.label === 'moodlink_fast_input') {
      dc.onmessage = (msgEvt) => {
        handleFastInput(msgEvt.data);
      };
    }
  };
  
  if (localStream) {
    localStream.getTracks().forEach(track => {
      try {
        peerConnection.addTrack(track, localStream);
      } catch (e) {
        console.warn('Error adding track:', e);
      }
    });
  }
}

function handleFastInput(data) {
  if (typeof data !== 'string') return;
  const parts = data.split(':');
  const type = parts[0];
  if (type === 'm') {
    // Mouse delta: m:dx:dy
    const dx = parseInt(parts[1], 10) || 0;
    const dy = parseInt(parts[2], 10) || 0;
    socket.emit('mouse:move', { dx, dy });
  } else if (type === 'l') {
    // Laser coordinate: l:rx:ry:vis
    const rx = parseFloat(parts[1]) || 0;
    const ry = parseFloat(parts[2]) || 0;
    const visible = parts[3] !== '0';
    socket.emit('laser:move', { rx, ry, visible });
  } else if (type === 'ink') {
    // Ink annotation point: ink:cmd:rx:ry
    const cmd = parts[1];
    const rx = parseFloat(parts[2]) || 0;
    const ry = parseFloat(parts[3]) || 0;
    socket.emit('laser:ink', { cmd, rx, ry });
  }
}

let isPCAudioStreaming = false;
let pcAudioStream = null;

async function togglePCAudioStream() {
  if (!deviceConnected) return showToast('No device connected', 'error');
  const btn = document.getElementById('btn-pc-audio-stream');
  
  if (isPCAudioStreaming) {
    if (pcAudioStream) {
      pcAudioStream.getTracks().forEach(t => t.stop());
      pcAudioStream = null;
    }
    isPCAudioStreaming = false;
    socket.emit('webrtc:stream:stopped', { type: 'pc_audio' });
    socket.emit('pc:audio:streaming:status', { streaming: false });
    if (btn) {
      btn.innerHTML = '<span>Stream PC Audio to Phone (Headphones)</span>';
      btn.classList.remove('btn-active-green');
    }
    showToast('PC audio stream stopped', 'info');
    return;
  }

  try {
    pcAudioStream = await navigator.mediaDevices.getDisplayMedia({
      video: true,
      audio: true
    });
    
    const audioTrack = pcAudioStream.getAudioTracks()[0];
    if (!audioTrack) {
      pcAudioStream.getTracks().forEach(t => t.stop());
      return showToast('No system audio selected. Check "Share system audio" checkbox.', 'error');
    }

    // Stop and discard video track to only stream lightweight audio
    pcAudioStream.getVideoTracks().forEach(t => t.stop());

    initWebRTC(true);
    peerConnection.addTrack(audioTrack, pcAudioStream);

    const offer = await peerConnection.createOffer();
    await peerConnection.setLocalDescription(offer);
    socket.emit('webrtc:offer', { offer });

    isPCAudioStreaming = true;
    socket.emit('pc:audio:streaming:status', { streaming: true });
    if (btn) {
      btn.innerHTML = '<span>Stop PC Audio Stream</span>';
      btn.classList.add('btn-active-green');
    }
    showToast('Streaming PC Audio to Phone (Headphones Mode)', 'success');

    audioTrack.onended = () => {
      if (isPCAudioStreaming) togglePCAudioStream();
    };
  } catch (err) {
    console.error('Audio capture error:', err);
    showToast('Failed to capture PC audio', 'error');
  }
}

async function toggleScreenMirror() {
  if (!deviceConnected) return showToast('No device connected', 'error');
  
  const btn = document.getElementById('btn-start-mirror');
  
  if (isScreenMirroring) {
    // Stop sharing
    if (localStream) {
      localStream.getTracks().forEach(t => t.stop());
      localStream = null;
    }
    if (peerConnection) {
      peerConnection.close();
      peerConnection = null;
    }
    isScreenMirroring = false;
    socket.emit('webrtc:stream:stopped', { type: 'screen' });
    btn.innerHTML = '<span>Stream PC Screen to Phone</span>';
    btn.classList.remove('btn-danger');
    return;
  }
  
  try {
    localStream = await navigator.mediaDevices.getDisplayMedia({
      video: { cursor: "always" },
      audio: false
    });
    
    initWebRTC(true);
    
    const offer = await peerConnection.createOffer();
    await peerConnection.setLocalDescription(offer);
    socket.emit('webrtc:offer', { offer });
    
    isScreenMirroring = true;
    btn.innerHTML = '<span>Stop Screen Mirroring</span>';
    btn.classList.add('btn-danger');
    
    localStream.getVideoTracks()[0].onended = () => {
      if (isScreenMirroring) toggleScreenMirror();
    };
    
  } catch (err) {
    console.error('Error starting screen mirror:', err);
    showToast('Failed to capture screen', 'error');
  }
}

async function scanBluetooth() {
  const list = document.getElementById('bt-devices');
  list.innerHTML = '<div class="activity-empty"><div class="qr-loading">Scanning paired devices...</div></div>';
  socket.emit('bluetooth:scan');
}

async function toggleWebcamMirror() {
  if (!deviceConnected) return showToast('No device connected', 'error');
  const btn = document.getElementById('btn-start-webcam');
  
  if (isWebcamMirroring) {
    if (localStream) {
      localStream.getTracks().forEach(t => t.stop());
      localStream = null;
    }
    if (peerConnection) {
      peerConnection.close();
      peerConnection = null;
    }
    isWebcamMirroring = false;
    socket.emit('webrtc:stream:stopped', { type: 'webcam' });
    btn.innerHTML = '<span>Stream PC Webcam to Phone</span>';
    btn.classList.remove('btn-danger');
    return;
  }
  
  try {
    localStream = await navigator.mediaDevices.getUserMedia({
      video: true,
      audio: false
    });
    
    initWebRTC(true);
    const offer = await peerConnection.createOffer();
    await peerConnection.setLocalDescription(offer);
    socket.emit('webrtc:offer', { offer });
    
    isWebcamMirroring = true;
    btn.innerHTML = '<span>Stop Webcam Mirroring</span>';
    btn.classList.add('btn-danger');
    
    localStream.getVideoTracks()[0].onended = () => { 
      if (isWebcamMirroring) toggleWebcamMirror(); 
    };
    
  } catch (err) {
    console.error('Error starting webcam:', err);
    showToast('Failed to access webcam', 'error');
  }
}

async function toggleIntercom() {
  if (!deviceConnected) return showToast('No device connected', 'error');
  
  const btn = document.getElementById('btn-start-audio');
  
  if (isIntercomActive) {
    if (localStream) {
      localStream.getAudioTracks().forEach(t => t.stop());
    }
    isIntercomActive = false;
    btn.innerHTML = '<span>Enable Two-Way Audio</span>';
    btn.classList.remove('btn-danger');
    return;
  }
  
  try {
    const audioStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    
    if (!localStream) {
      localStream = audioStream;
      initWebRTC();
      const offer = await peerConnection.createOffer();
      await peerConnection.setLocalDescription(offer);
      socket.emit('webrtc:offer', { offer });
    } else {
      // Add audio track to existing stream
      const audioTrack = audioStream.getAudioTracks()[0];
      localStream.addTrack(audioTrack);
      if (peerConnection) {
        peerConnection.addTrack(audioTrack, localStream);
        // Renegotiate
        const offer = await peerConnection.createOffer();
        await peerConnection.setLocalDescription(offer);
        socket.emit('webrtc:offer', { offer });
      }
    }
    
    isIntercomActive = true;
    btn.innerHTML = '<span>Disable Two-Way Audio</span>';
    btn.classList.add('btn-danger');
    
  } catch (err) {
    console.error('Error starting microphone:', err);
    showToast('Failed to access microphone', 'error');
  }
}

// ─── Startup ─────────────────────────────────────────────────────────
function bootstrap() {
  // Navigation setup
  document.querySelectorAll('.nav-item').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const tab = e.currentTarget.dataset.tab;
      if (tab) switchTab(tab);
    });
  });
  
  initApp();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', bootstrap);
} else {
  bootstrap();
}
