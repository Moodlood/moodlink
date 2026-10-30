import io from 'socket.io-client';
import { RTCPeerConnection, RTCIceCandidate, RTCSessionDescription, mediaDevices } from 'react-native-webrtc';
import * as Clipboard from 'expo-clipboard';
import notifee, { AndroidImportance } from '@notifee/react-native';
import RNBluetoothClassic from 'react-native-bluetooth-classic';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import * as FileSystem from 'expo-file-system';

const PAIRED_SERVER_PATH = `${FileSystem.documentDirectory}moodlink_paired_server.json`;

notifee.registerForegroundService((notification) => {
  return new Promise(() => {
    // Keep alive Promise. It never resolves until we stop the service.
  });
});

class ConnectionService {
  constructor() {
    this.socket = null;
    this.isConnected = false;
    this.serverUrl = null;
    this.deviceInfo = { name: 'Android Phone', type: 'phone' };
    this.listeners = new Map();
    this.authToken = null;
    
    // Transport
    this.transportMode = 'WIFI';
    this.btDevice = null;
    
    // WebRTC
    this.peerConnection = null;
    this.dataChannel = null;
    this.localStream = null;
    this.remoteStream = null;
    this.rtcConfig = {
      iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
    };
  }

  // Connect via WiFi/IP (Supports token-based zero-touch pairing)
  connectWiFi(ip, port, code = null, token = null) {
    return new Promise((resolve, reject) => {
      if (this.socket) {
        this.socket.disconnect();
        this.socket = null;
      }

      this.serverUrl = `http://${ip}:${port}`;
      this.socket = io(this.serverUrl, {
        transports: ['websocket'],
        forceNew: true,
        reconnection: true,
        reconnectionAttempts: 15,
        reconnectionDelay: 1000,
        reconnectionDelayMax: 5000,
        timeout: 10000
      });

      const effectiveToken = token || this.authToken;

      this.socket.on('connect', () => {
        if (effectiveToken) {
          this.send('pair:token', {
            token: effectiveToken,
            deviceName: this.deviceInfo.name,
            deviceType: this.deviceInfo.type
          });
        } else {
          this.send('pair:request', {
            code,
            deviceName: this.deviceInfo.name,
            deviceType: this.deviceInfo.type
          });
        }
      });

      this.socket.io.on('reconnect', () => {
        if (effectiveToken) {
          this.send('pair:token', {
            token: effectiveToken,
            deviceName: this.deviceInfo.name,
            deviceType: this.deviceInfo.type
          });
        } else {
          this.send('pair:request', {
            code,
            deviceName: this.deviceInfo.name,
            deviceType: this.deviceInfo.type
          });
        }
      });

      this.socket.on('pair:success', async (data) => {
        this.isConnected = true;
        if (data.authToken) this.authToken = data.authToken;
        this.emit('connectionChanged', true);
        await this.savePairedServer(ip, port, code, data.device?.name || 'PC', data.authToken || effectiveToken);
        await this.startForegroundService();
        await activateKeepAwakeAsync();
        resolve(data);
      });

      this.socket.on('pair:failed', (data) => {
        this.disconnect();
        reject(new Error(data.error || 'Pairing failed'));
      });

      this.socket.on('webrtc:offer', async (data) => {
        await this.initWebRTC(true);
        try {
          await this.peerConnection.setRemoteDescription(new RTCSessionDescription(data.offer));
          const answer = await this.peerConnection.createAnswer();
          await this.peerConnection.setLocalDescription(answer);
          this.send('webrtc:answer', { answer, to: data.from });
        } catch (e) { console.warn('Error handling webrtc:offer', e); }
      });

      this.socket.on('webrtc:stream:stopped', () => {
        if (this.remoteStream) {
          this.remoteStream.getTracks().forEach(t => {
            try { t.stop(); } catch (e) {}
          });
          this.remoteStream = null;
        }
        this.emit('webrtc:stream', null);
      });

      this.socket.on('webrtc:answer', async (data) => {
        if (this.peerConnection) {
          try {
            await this.peerConnection.setRemoteDescription(new RTCSessionDescription(data.answer));
          } catch (e) { console.warn(e); }
        }
      });

      this.socket.on('webrtc:ice', async (data) => {
        if (this.peerConnection && data.candidate) {
          try {
            await this.peerConnection.addIceCandidate(new RTCIceCandidate(data.candidate));
          } catch (e) { console.warn(e); }
        }
      });

      this.socket.on('clipboard:received', async (data) => {
        if (data.contentType === 'text' && data.content) {
          try {
            await Clipboard.setStringAsync(data.content);
          } catch(e) { console.warn('Failed to copy', e); }
        }
      });

      this.socket.on('phone:command', (data) => {
        if (data.action === 'alarm') {
          import('react-native').then(({ Vibration }) => Vibration.vibrate([1000, 1000, 1000], true));
        } else if (data.action === 'stop_alarm') {
          import('react-native').then(({ Vibration }) => Vibration.cancel());
        } else if (data.action === 'vibrate') {
          import('react-native').then(({ Vibration }) => Vibration.vibrate(400));
        } else if (data.action === 'alert') {
          import('react-native').then(({ Alert, Vibration }) => {
            Vibration.vibrate([200, 200, 200]);
            Alert.alert('Message from PC', data.message || 'Ping from your desktop computer!');
          });
        }
      });

      this.socket.onAny((event, ...args) => {
        if (!['pair:success', 'pair:failed', 'webrtc:offer', 'webrtc:answer', 'webrtc:ice', 'clipboard:received', 'phone:command'].includes(event)) {
          this.emit(event, ...args);
        }
      });

      this.socket.on('disconnect', () => {
        this.isConnected = false;
        this.emit('connectionChanged', false);
      });

      this.socket.on('connect_error', (err) => {
        reject(err);
      });

    });
  }

  // WebRTC Implementation
  async initWebRTC(forceReset = false) {
    if (this.peerConnection && !forceReset) {
      if (this.peerConnection.connectionState === 'connected' || this.peerConnection.connectionState === 'connecting') {
        return;
      }
    }

    if (this.peerConnection) {
      try {
        this.peerConnection.close();
      } catch (e) {}
      this.peerConnection = null;
    }
    
    this.peerConnection = new RTCPeerConnection(this.rtcConfig);

    // Unordered, unbuffered high-frequency DataChannel for sub-10ms input
    try {
      this.dataChannel = this.peerConnection.createDataChannel('moodlink_fast_input', {
        ordered: false,
        maxRetransmits: 0
      });
      this.dataChannel.onopen = () => {
        this.emit('dataChannelState', true);
      };
      this.dataChannel.onclose = () => {
        this.emit('dataChannelState', false);
      };
    } catch (e) {
      console.warn('DataChannel warning:', e);
    }
    
    this.peerConnection.onicecandidate = (event) => {
      if (event.candidate) {
        this.send('webrtc:ice', { candidate: event.candidate });
      }
    };
    
    this.peerConnection.ontrack = (event) => {
      if (event.streams && event.streams[0]) {
        this.remoteStream = event.streams[0];
        this.emit('webrtc:stream', event.streams[0]);
      }
    };
    
    if (this.localStream) {
      this.localStream.getTracks().forEach(track => {
        try {
          this.peerConnection.addTrack(track, this.localStream);
        } catch (e) {
          console.warn('Error adding track to peerConnection:', e);
        }
      });
    }
  }

  // Sub-10ms unbuffered packet transmission
  sendFastInput(type, ...args) {
    if (this.dataChannel && this.dataChannel.readyState === 'open') {
      try {
        this.dataChannel.send(`${type}:${args.join(':')}`);
        return true;
      } catch (e) {}
    }
    // Reliable fallback to Socket.io or Bluetooth Classic
    if (type === 'm') {
      this.send('mouse:move', { dx: args[0], dy: args[1] });
    } else if (type === 'l') {
      this.send('laser:move', { rx: args[0], ry: args[1], visible: args[2] });
    } else if (type === 'ink') {
      this.send('laser:ink', { cmd: args[0], rx: args[1], ry: args[2], isNew: args[3], color: args[4] });
    }
    return false;
  }

  async toggleIntercom() {
    if (this.localStream && this.localStream.getAudioTracks().length > 0) {
      this.localStream.getAudioTracks().forEach(t => {
        try { t.stop(); } catch (e) {}
      });
      const videoTracks = this.localStream.getVideoTracks();
      if (videoTracks.length === 0) {
        this.localStream = null;
        if (this.peerConnection) {
          try { this.peerConnection.close(); } catch (e) {}
          this.peerConnection = null;
        }
      }
      this.emit('webrtc:localstream', this.localStream);
      this.send('webrtc:stream:stopped', { type: 'intercom' });
      return false;
    }

    try {
      const audioStream = await mediaDevices.getUserMedia({
        audio: true,
        video: false
      });
      
      this.localStream = audioStream;
      await this.initWebRTC(true);
      const offer = await this.peerConnection.createOffer();
      await this.peerConnection.setLocalDescription(offer);
      this.send('webrtc:offer', { offer });
      
      this.emit('webrtc:localstream', this.localStream);
      return true;
    } catch (e) {
      console.warn('Failed to get user media for intercom', e);
      return false;
    }
  }

  async toggleCamera(facingMode = 'environment') {
    if (this.localStream && this.localStream.getVideoTracks().length > 0) {
      this.localStream.getVideoTracks().forEach(t => {
        try { t.stop(); } catch (e) {}
      });

      const audioTracks = this.localStream.getAudioTracks();
      if (audioTracks.length === 0) {
        this.localStream = null;
        if (this.peerConnection) {
          try { this.peerConnection.close(); } catch (e) {}
          this.peerConnection = null;
        }
      }
      this.emit('webrtc:localstream', this.localStream);
      this.send('webrtc:stream:stopped', { type: 'camera' });
      return false;
    }

    try {
      const cameraStream = await mediaDevices.getUserMedia({
        audio: false,
        video: {
          facingMode: facingMode || 'environment',
          width: { ideal: 1280 },
          height: { ideal: 720 },
          frameRate: { max: 30 }
        }
      });
      
      this.localStream = cameraStream;
      await this.initWebRTC(true);
      const offer = await this.peerConnection.createOffer();
      await this.peerConnection.setLocalDescription(offer);
      this.send('webrtc:offer', { offer });
      
      this.emit('webrtc:localstream', this.localStream);
      return true;
    } catch (e) {
      console.warn('Failed to get camera stream', e);
      return false;
    }
  }

  async syncClipboardToPC() {
    try {
      const text = await Clipboard.getStringAsync();
      if (text) {
        this.send('clipboard:send', { content: text, type: 'text' });
        return true;
      }
    } catch(e) {
      console.warn('Failed to read clipboard', e);
    }
    return false;
  }

  // Foreground Service
  async startForegroundService() {
    try {
      const channelId = await notifee.createChannel({
        id: 'moodlink-service',
        name: 'MoodLink Background Service',
        importance: AndroidImportance.LOW,
      });

      await notifee.displayNotification({
        title: 'MoodLink is Connected',
        body: 'Keeping the connection alive in the background.',
        android: {
          channelId,
          asForegroundService: true,
          ongoing: true,
        },
      });
    } catch(e) {
      console.warn('Failed to start foreground service', e);
    }
  }

  async stopForegroundService() {
    try {
      await notifee.stopForegroundService();
    } catch(e) {
      console.warn('Failed to stop foreground service', e);
    }
  }

  // ─── Persistent Server & Auto-Reconnect ─────────────────────────
  async savePairedServer(ip, port, code, deviceName = 'PC', authToken = null) {
    try {
      if (authToken) this.authToken = authToken;
      await FileSystem.writeAsStringAsync(PAIRED_SERVER_PATH, JSON.stringify({
        ip,
        port,
        code,
        deviceName,
        authToken: authToken || this.authToken,
        timestamp: Date.now()
      }));
    } catch (e) {
      console.warn('Failed to save paired server:', e);
    }
  }

  async getSavedPairedServer() {
    try {
      const info = await FileSystem.getInfoAsync(PAIRED_SERVER_PATH);
      if (info.exists) {
        const content = await FileSystem.readAsStringAsync(PAIRED_SERVER_PATH);
        const parsed = JSON.parse(content);
        if (parsed.authToken) this.authToken = parsed.authToken;
        return parsed;
      }
    } catch (e) {
      console.warn('Failed to read saved server:', e);
    }
    return null;
  }

  async forgetPairedServer() {
    try {
      this.authToken = null;
      const info = await FileSystem.getInfoAsync(PAIRED_SERVER_PATH);
      if (info.exists) {
        await FileSystem.deleteAsync(PAIRED_SERVER_PATH);
      }
    } catch (e) {}
  }

  async autoConnect() {
    if (this.isConnected) return true;
    const saved = await this.getSavedPairedServer();
    if (!saved || !saved.ip || !saved.port) return false;
    try {
      await this.connectWiFi(saved.ip, saved.port, saved.code, saved.authToken);
      return true;
    } catch (e) {
      console.log('Auto-connect failed:', e.message);
      return false;
    }
  }

  // ─── Bluetooth Classic Implementation ────────────────────────────
  async isBluetoothAvailable() {
    try {
      return await RNBluetoothClassic.isBluetoothAvailable();
    } catch (e) {
      return false;
    }
  }

  async isBluetoothEnabled() {
    try {
      return await RNBluetoothClassic.isBluetoothEnabled();
    } catch (e) {
      return false;
    }
  }

  async requestEnableBluetooth() {
    try {
      return await RNBluetoothClassic.requestBluetoothEnabled();
    } catch (e) {
      return false;
    }
  }

  async getBondedBluetoothDevices() {
    try {
      const devices = await RNBluetoothClassic.getBondedDevices();
      return devices || [];
    } catch (e) {
      console.warn('Failed to get bonded devices:', e);
      return [];
    }
  }

  async connectBluetooth(device) {
    try {
      this.disconnect();
      const address = typeof device === 'string' ? device : device.address;
      const connected = await RNBluetoothClassic.connectToDevice(address);
      if (connected) {
        this.btDevice = typeof device === 'object' ? device : { address, name: 'PC (Bluetooth)' };
        this.transportMode = 'BLUETOOTH';
        this.isConnected = true;

        this.btReadSubscription = RNBluetoothClassic.onDeviceRead(address, (event) => {
          this._handleBluetoothData(event.data);
        });

        this.btDisconnectSubscription = RNBluetoothClassic.onDeviceDisconnected(address, () => {
          this.disconnect();
        });

        await this.startForegroundService();
        await activateKeepAwakeAsync();
        this.emit('connectionChanged', true);
        return true;
      }
      return false;
    } catch (e) {
      console.error('Bluetooth connection failed:', e);
      throw e;
    }
  }

  _handleBluetoothData(text) {
    try {
      const lines = text.split('\n');
      for (const line of lines) {
        if (!line.trim()) continue;
        const parsed = JSON.parse(line.trim());
        if (parsed.event) {
          this.emit(parsed.event, parsed.payload);
        }
      }
    } catch (e) {}
  }

  // Disconnect
  disconnect() {
    if (this.localStream) {
      this.localStream.getTracks().forEach(t => {
        try { t.stop(); } catch (e) {}
      });
      this.localStream = null;
    }
    if (this.peerConnection) {
      try { this.peerConnection.close(); } catch (e) {}
      this.peerConnection = null;
    }
    this.remoteStream = null;

    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
    }

    if (this.btDevice) {
      try {
        RNBluetoothClassic.disconnectFromDevice(this.btDevice.address);
      } catch (e) {}
      this.btDevice = null;
    }
    if (this.btReadSubscription) {
      try { this.btReadSubscription.remove(); } catch (e) {}
      this.btReadSubscription = null;
    }
    if (this.btDisconnectSubscription) {
      try { this.btDisconnectSubscription.remove(); } catch (e) {}
      this.btDisconnectSubscription = null;
    }

    this.isConnected = false;
    this.stopForegroundService();
    deactivateKeepAwake();
    this.emit('connectionChanged', false);
  }

  setTransportMode(mode) {
    this.transportMode = mode;
  }

  // Send Event
  send(event, data = {}) {
    if (this.transportMode === 'WIFI' && this.socket && (this.isConnected || event === 'pair:request')) {
      this.socket.emit(event, data);
      return true;
    } else if (this.transportMode === 'BLUETOOTH' && this.btDevice) {
      const packet = JSON.stringify({ event, payload: data }) + '\n';
      RNBluetoothClassic.writeToDevice(this.btDevice.address, packet).catch(e => console.warn('BT write failed', e));
      return true;
    }
    return false;
  }

  // Event Emitter Implementation
  on(event, callback) {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    this.listeners.get(event).add(callback);
    return () => this.off(event, callback);
  }

  off(event, callback) {
    if (this.listeners.has(event)) {
      this.listeners.get(event).delete(callback);
    }
  }

  emit(event, ...args) {
    if (this.listeners.has(event)) {
      this.listeners.get(event).forEach(cb => cb(...args));
    }
  }
}

// Singleton instance
const connectionService = new ConnectionService();
export default connectionService;
