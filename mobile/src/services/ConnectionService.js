import io from 'socket.io-client';
import { RTCPeerConnection, RTCIceCandidate, RTCSessionDescription, mediaDevices } from 'react-native-webrtc';
import * as Clipboard from 'expo-clipboard';
import notifee, { AndroidImportance } from '@notifee/react-native';
import RNBluetoothClassic from 'react-native-bluetooth-classic';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';

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
    
    // Transport
    this.transportMode = 'WIFI';
    this.btDevice = null;
    
    // WebRTC
    this.peerConnection = null;
    this.localStream = null;
    this.remoteStream = null;
    this.rtcConfig = {
      iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
    };
  }

  // Connect via WiFi/IP
  connectWiFi(ip, port, code) {
    return new Promise((resolve, reject) => {
      if (this.socket) this.socket.disconnect();

      const url = `http://${ip}:${port}`;
      this.serverUrl = url;
      this.socket = io(url, {
        reconnection: true,
        reconnectionDelay: 1000,
        reconnectionDelayMax: 5000,
        reconnectionAttempts: 10
      });

      this.socket.on('connect', () => {
        // Request pairing
        this.socket.emit('pair:request', {
          code,
          deviceName: this.deviceInfo.name,
          deviceType: this.deviceInfo.type
        });
      });

      this.socket.on('pair:success', async (data) => {
        this.isConnected = true;
        this.emit('connectionChanged', true);
        await this.startForegroundService();
        await activateKeepAwakeAsync(); // Prevent Android Doze mode
        resolve(data);
      });

      this.socket.on('pair:failed', (data) => {
        this.disconnect();
        reject(new Error(data.error || 'Pairing failed'));
      });

      this.socket.on('disconnect', () => {
        this.isConnected = false;
        this.emit('connectionChanged', false);
      });

      this.socket.on('connect_error', (err) => {
        reject(err);
      });

      // WebRTC Signaling
      this.socket.on('webrtc:offer', async (data) => {
        await this.initWebRTC();
        try {
          await this.peerConnection.setRemoteDescription(new RTCSessionDescription(data.offer));
          const answer = await this.peerConnection.createAnswer();
          await this.peerConnection.setLocalDescription(answer);
          this.socket.emit('webrtc:answer', { answer, to: data.from });
        } catch (e) { console.warn(e); }
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

      // Clipboard Sync
      this.socket.on('clipboard:received', async (data) => {
        if (data.type === 'text' && data.content) {
          try {
            await Clipboard.setStringAsync(data.content);
          } catch(e) { console.warn('Failed to copy to clipboard', e); }
        }
      });

      // Phone Controls (Alarm)
      this.socket.on('phone:command', (data) => {
        if (data.action === 'alarm') {
          import('react-native').then(({ Vibration }) => Vibration.vibrate([1000, 1000, 1000], true));
        } else if (data.action === 'stop_alarm') {
          import('react-native').then(({ Vibration }) => Vibration.cancel());
        }
      });

      // Pass all other events to listeners
      this.socket.onAny((event, ...args) => {
        if (!event.startsWith('pair:') && event !== 'connect' && event !== 'disconnect' && !event.startsWith('webrtc:') && event !== 'clipboard:received') {
          this.emit(event, ...args);
        }
      });
    });
  }

  // WebRTC Implementation
  async initWebRTC() {
    if (this.peerConnection) return;
    
    this.peerConnection = new RTCPeerConnection(this.rtcConfig);
    
    this.peerConnection.onicecandidate = (event) => {
      if (event.candidate) {
        this.socket.emit('webrtc:ice', { candidate: event.candidate });
      }
    };
    
    this.peerConnection.ontrack = (event) => {
      if (event.streams && event.streams[0]) {
        this.remoteStream = event.streams[0];
        this.emit('webrtc:stream', event.streams[0]);
      }
    };
    
    if (this.localStream) {
      this.peerConnection.addStream(this.localStream);
    }
  }

  async toggleIntercom() {
    if (this.localStream) {
      this.localStream.getTracks().forEach(t => t.stop());
      this.localStream = null;
      if (this.peerConnection) {
        this.peerConnection.close();
        this.peerConnection = null;
      }
      this.emit('webrtc:localstream', null);
      return false;
    }

    try {
      this.localStream = await mediaDevices.getUserMedia({
        audio: true,
        video: false
      });
      
      await this.initWebRTC();
      const offer = await this.peerConnection.createOffer();
      await this.peerConnection.setLocalDescription(offer);
      this.socket.emit('webrtc:offer', { offer });
      
      this.emit('webrtc:localstream', this.localStream);
      return true;
    } catch (e) {
      console.warn('Failed to get user media', e);
      return false;
    }
  }

  async toggleCamera(facingMode = 'user') {
    if (this.localStream && this.localStream.getVideoTracks().length > 0) {
      this.localStream.getVideoTracks().forEach(t => t.stop());
      this.localStream = new MediaStream(this.localStream.getAudioTracks());
      if (this.localStream.getTracks().length === 0) {
        this.localStream = null;
        if (this.peerConnection) {
          this.peerConnection.close();
          this.peerConnection = null;
        }
      }
      this.emit('webrtc:localstream', this.localStream);
      return false;
    }

    try {
      const cameraStream = await mediaDevices.getUserMedia({
        audio: false,
        video: { facingMode }
      });
      
      if (!this.localStream) {
        this.localStream = cameraStream;
        await this.initWebRTC();
        const offer = await this.peerConnection.createOffer();
        await this.peerConnection.setLocalDescription(offer);
        this.socket.emit('webrtc:offer', { offer });
      } else {
        const videoTrack = cameraStream.getVideoTracks()[0];
        this.localStream.addTrack(videoTrack);
        if (this.peerConnection) {
          this.peerConnection.addStream(this.localStream);
          const offer = await this.peerConnection.createOffer();
          await this.peerConnection.setLocalDescription(offer);
          this.socket.emit('webrtc:offer', { offer });
        }
      }
      
      this.emit('webrtc:localstream', this.localStream);
      return true;
    } catch (e) {
      console.warn('Failed to get camera', e);
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

  // Disconnect
  disconnect() {
    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
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
    if (this.transportMode === 'WIFI' && this.socket && this.isConnected) {
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
