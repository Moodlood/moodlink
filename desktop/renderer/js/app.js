/**
 * MoodLink Desktop App Controller
 * Handles UI interactions, Socket.IO connections, and IPC bridging
 */

// Initialize Socket.IO connection to local server
let socket = null;
let currentTab = 'dashboard';
let deviceConnected = false;
let systemRefreshInterval = null;

// Formatter utilities
function formatSize(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024, sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

// ─── Initialization ──────────────────────────────────────────────────
async function initApp() {
  try {
    const port = await window.moodlink.getPort();
    const ip = await window.moodlink.getIP();
    
    // Connect to embedded secure server
    socket = io(`http://localhost:${port}`);
    setupSocketEvents();
    
    // Initial fetch
    refreshPairingCode();
    
    // Setup file drag & drop
    setupFileDropZone();
    
    // Setup app window controls
    setupWindowControls();
    
    showToast('MoodLink started successfully', 'success');
  } catch (err) {
    showToast('Failed to start local server', 'error');
    console.error(err);
  }
}

// ─── Window Controls ─────────────────────────────────────────────────
function setupWindowControls() {
  // Can be used to sync UI state if window is maximized externally
  window.addEventListener('resize', async () => {
    const isMax = await window.moodlink.isMaximized();
    const maxBtn = document.getElementById('btn-maximize');
    if (isMax) {
      maxBtn.innerHTML = '<svg width="12" height="12" viewBox="0 0 12 12"><path d="M2.5 4.5v-2h2M9.5 4.5v-2h-2M2.5 7.5v2h2M9.5 7.5v2h-2" stroke="currentColor" stroke-width="1.5" fill="none"/></svg>';
    } else {
      maxBtn.innerHTML = '<svg width="12" height="12" viewBox="0 0 12 12"><rect x="1" y="1" width="10" height="10" stroke="currentColor" stroke-width="1.5" fill="none"/></svg>';
    }
  });
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
  });

  socket.on('device:connected', (data) => {
    deviceConnected = true;
    updateConnectionStatus(true, data.device.name);
    showToast(`${data.device.name} connected`, 'success');
    addActivityLog(`Device connected: ${data.device.name}`);
    window.moodlink.updateTrayStatus(`Connected to ${data.device.name}`);
    
    // Switch to dashboard if on pairing screen
    if (currentTab === 'pairing') switchTab('dashboard');
  });

  socket.on('device:disconnected', (data) => {
    deviceConnected = false;
    updateConnectionStatus(false);
    showToast(`${data.device.name} disconnected`, 'error');
    addActivityLog(`Device disconnected: ${data.device.name}`);
    window.moodlink.updateTrayStatus('Waiting for device');
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
    addFileToList(data, 'received');
    showToast(`File received: ${data.name}`, 'success');
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
    initWebRTC();
    try {
      await peerConnection.setRemoteDescription(new RTCSessionDescription(data.offer));
      const answer = await peerConnection.createAnswer();
      await peerConnection.setLocalDescription(answer);
      socket.emit('webrtc:answer', { answer, to: data.from });
    } catch (e) {
      console.error('Error handling offer:', e);
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

  socket.on('bluetooth:devices', (ports) => {
  const list = document.getElementById('bt-devices');
  if (!ports || ports.length === 0) {
    list.innerHTML = '<div class="activity-empty" style="text-align:center;">No paired Bluetooth COM ports found.<br/>Please pair your phone in Windows Bluetooth Settings first.</div>';
    return;
  }
  
  list.innerHTML = ports.map(port => `
    <div class="activity-item" style="cursor:pointer; padding: 12px; background: rgba(255,255,255,0.03); border-radius: 8px; margin-bottom: 8px;" onclick="connectBluetooth('${port}')">
      <div class="file-icon" style="color: var(--accent);"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6.5 6.5 17.5 17.5 12 23 12 1 17.5 6.5 6.5 17.5"/></svg></div>
      <div class="file-info">
        <div class="file-name">${port}</div>
        <div class="file-meta">Bluetooth SPP Device</div>
      </div>
      <div class="app-kill-btn">Connect</div>
    </div>
  `).join('');
});

function connectBluetooth(port) {
  const list = document.getElementById('bt-devices');
  list.innerHTML = `<div class="activity-empty"><div class="qr-loading">Connecting to ${port}...</div></div>`;
  socket.emit('bluetooth:connect', { port });
}

  socket.on('intercom:toggle:request', () => {
    toggleIntercom();
  });
}

// ─── UI Actions ──────────────────────────────────────────────────────
function updateConnectionStatus(isConnected, deviceName = '') {
  const statusEl = document.getElementById('connection-status');
  const textEl = statusEl.querySelector('.conn-text');
  
  if (isConnected) {
    statusEl.classList.remove('disconnected');
    statusEl.classList.add('connected');
    textEl.innerText = deviceName;
    
    // Update Hero Card
    document.getElementById('hero-title').innerText = 'Device Connected';
    document.getElementById('hero-subtitle').innerText = `You are linked with ${deviceName}`;
    const btn = document.getElementById('btn-start-pairing');
    if (btn) btn.style.display = 'none';
  } else {
    statusEl.classList.add('disconnected');
    statusEl.classList.remove('connected');
    textEl.innerText = 'No device';
    
    // Update Hero Card
    document.getElementById('hero-title').innerText = 'Connect Your Device';
    document.getElementById('hero-subtitle').innerText = 'Pair your Android phone to start controlling your PC remotely';
    const btn = document.getElementById('btn-start-pairing');
    if (btn) btn.style.display = 'inline-flex';
  }
}

// ─── Pairing ─────────────────────────────────────────────────────────
async function refreshPairingCode() {
  try {
    const port = await window.moodlink.getPort();
    const res = await fetch(`http://localhost:${port}/api/qrcode`);
    const data = await res.json();
    
    // Update QR Code
    const qrEl = document.getElementById('qr-code');
    qrEl.innerHTML = `<img src="${data.qr}" alt="Pairing QR Code">`;
    
    // Update Code Display
    const codeEl = document.getElementById('pairing-code');
    codeEl.innerHTML = '';
    for (let i = 0; i < data.code.length; i++) {
      const span = document.createElement('span');
      span.className = 'code-digit';
      span.innerText = data.code[i];
      codeEl.appendChild(span);
    }
    
    // Update IP/Port
    document.getElementById('server-ip').innerText = data.ip;
    document.getElementById('server-port').innerText = data.port;
    
  } catch (err) {
    console.error('Failed to fetch pairing code:', err);
  }
}

// Method Switching
document.querySelectorAll('.method-btn').forEach(btn => {
  btn.addEventListener('click', (e) => {
    document.querySelectorAll('.method-btn').forEach(b => b.classList.remove('active'));
    e.currentTarget.classList.add('active');
    
    const method = e.currentTarget.dataset.method;
    document.querySelectorAll('.pairing-method-content').forEach(c => c.style.display = 'none');
    document.getElementById(`pairing-${method}`).style.display = 'block';
  });
});

async function scanBluetooth() {
  const list = document.getElementById('bt-devices');
  list.innerHTML = '<div class="activity-empty"><div class="qr-loading">Scanning for devices...</div></div>';
  
  try {
    const device = await navigator.bluetooth.requestDevice({
      acceptAllDevices: true,
      optionalServices: ['battery_service'] // Generic fallback, modify when UUID is chosen
    });
    console.log('Bluetooth Device paired:', device.name);
    list.innerHTML = `<div class="activity-empty"><p>Successfully paired with ${device.name}!<br>Waiting for app connection...</p></div>`;
  } catch (error) {
    console.warn('Bluetooth pairing skipped/failed:', error);
    list.innerHTML = '<div class="activity-empty"><p>Bluetooth pairing cancelled or failed.<br>Make sure your phone is discoverable.</p></div>';
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
      
      const port = await window.moodlink.getPort();
      const res = await fetch(`http://localhost:${port}/api/upload`, {
        method: 'POST',
        body: formData
      });
      
      if (!res.ok) throw new Error('Upload failed');
      const data = await res.json();
      
      addFileToList(data, 'sent');
      showToast(`${file.name} sent successfully`, 'success');
      addActivityLog(`Sent file: ${file.name}`);
      
    } catch (err) {
      console.error(err);
      showToast(`Failed to send ${file.name}`, 'error');
    }
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
  
  div.innerHTML = `
    <div class="file-icon">${icon}</div>
    <div class="file-info">
      <div class="file-name">${fileInfo.name}</div>
      <div class="file-meta">${size} • ${direction === 'sent' ? 'Sent' : 'Received'}</div>
    </div>
    <div class="file-actions">
      ${direction === 'received' ? 
        `<button class="btn btn-sm btn-secondary" onclick="window.open('http://localhost:3847/api/download/${fileInfo.savedAs}', '_blank')">Save</button>` : 
        `<span class="file-meta">✓ Done</span>`
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

function phoneCommand(action) {
  if (!deviceConnected) return showToast('No device connected', 'error');
  socket.emit('phone:command', { action });
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
let isIntercomActive = false;

const rtcConfig = {
  iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
};

function initWebRTC() {
  if (peerConnection) return;
  
  peerConnection = new RTCPeerConnection(rtcConfig);
  
  peerConnection.onicecandidate = (event) => {
    if (event.candidate) {
      socket.emit('webrtc:ice', { candidate: event.candidate });
    }
  };
  
  peerConnection.ontrack = (event) => {
    const remoteVideo = document.getElementById('remote-video');
    const overlay = document.getElementById('video-overlay');
    
    if (remoteVideo && remoteVideo.srcObject !== event.streams[0]) {
      remoteVideo.srcObject = event.streams[0];
      if (overlay) overlay.style.display = 'none';
      showToast('Receiving stream from phone', 'success');
    }
  };
  
  if (localStream) {
    localStream.getTracks().forEach(track => {
      peerConnection.addTrack(track, localStream);
    });
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
    btn.innerHTML = '<span>Stream PC Screen to Phone</span>';
    btn.classList.remove('btn-danger');
    return;
  }
  
  try {
    localStream = await navigator.mediaDevices.getDisplayMedia({
      video: { cursor: "always" },
      audio: false
    });
    
    initWebRTC();
    
    const offer = await peerConnection.createOffer();
    await peerConnection.setLocalDescription(offer);
    socket.emit('webrtc:offer', { offer });
    
    isScreenMirroring = true;
    btn.innerHTML = '<span>Stop Screen Mirroring</span>';
    btn.classList.add('btn-danger');
    
    localStream.getVideoTracks()[0].onended = () => {
      toggleScreenMirror(); // Reset if user stops from browser UI
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
  
  if (isScreenMirroring) {
    if (localStream) {
      localStream.getTracks().forEach(t => t.stop());
      localStream = null;
    }
    if (peerConnection) {
      peerConnection.close();
      peerConnection = null;
    }
    isScreenMirroring = false;
    btn.innerHTML = '<span>Stream PC Webcam to Phone</span>';
    btn.classList.remove('btn-danger');
    return;
  }
  
  try {
    localStream = await navigator.mediaDevices.getUserMedia({
      video: true,
      audio: false
    });
    
    initWebRTC();
    const offer = await peerConnection.createOffer();
    await peerConnection.setLocalDescription(offer);
    socket.emit('webrtc:offer', { offer });
    
    isScreenMirroring = true;
    btn.innerHTML = '<span>Stop Webcam Mirroring</span>';
    btn.classList.add('btn-danger');
    
    localStream.getVideoTracks()[0].onended = () => { toggleWebcamMirror(); };
    
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
document.addEventListener('DOMContentLoaded', () => {
  // Navigation setup
  document.querySelectorAll('.nav-item').forEach(btn => {
    btn.addEventListener('click', (e) => switchTab(e.currentTarget.dataset.tab));
  });
  
  initApp();
});
