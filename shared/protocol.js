/**
 * MoodLink Shared Protocol
 * Defines all message types, packet structures, and constants
 * Used by both desktop and mobile apps
 */

// ─── Protocol Version ─────────────────────────────────────────────
const PROTOCOL_VERSION = '1.0.0';
const APP_NAME = 'MoodLink';
const DEFAULT_PORT = 3847;

// ─── Message Types ────────────────────────────────────────────────
const MSG = {
  // Pairing
  PAIR_REQUEST: 'pair:request',
  PAIR_SUCCESS: 'pair:success',
  PAIR_FAILED: 'pair:failed',

  // Device
  DEVICE_CONNECTED: 'device:connected',
  DEVICE_DISCONNECTED: 'device:disconnected',
  DEVICE_PING: 'device:ping',
  DEVICE_PONG: 'device:pong',

  // Mouse
  MOUSE_MOVE: 'mouse:move',
  MOUSE_CLICK: 'mouse:click',
  MOUSE_DBLCLICK: 'mouse:doubleclick',
  MOUSE_SCROLL: 'mouse:scroll',
  MOUSE_DRAG: 'mouse:drag',

  // Keyboard
  KEY_PRESS: 'key:press',
  KEY_TYPE: 'key:type',
  KEY_COMBO: 'key:combo',

  // Volume
  VOLUME_GET: 'volume:get',
  VOLUME_SET: 'volume:set',
  VOLUME_LEVEL: 'volume:level',
  VOLUME_CHANGED: 'volume:changed',
  VOLUME_MUTE: 'volume:mute',

  // Media
  MEDIA_PLAY: 'media:play',
  MEDIA_NEXT: 'media:next',
  MEDIA_PREV: 'media:prev',

  // System
  SYSTEM_LOCK: 'system:lock',
  SYSTEM_SLEEP: 'system:sleep',
  SYSTEM_SHUTDOWN: 'system:shutdown:confirmed',
  SYSTEM_RESTART: 'system:restart:confirmed',
  SYSTEM_INFO: 'system:info',
  SYSTEM_INFO_DATA: 'system:info:data',

  // Apps
  APPS_LIST: 'apps:list',
  APPS_LIST_DATA: 'apps:list:data',
  APP_LAUNCH: 'app:launch',
  APP_KILL: 'app:kill',

  // Clipboard
  CLIPBOARD_SEND: 'clipboard:send',
  CLIPBOARD_RECEIVED: 'clipboard:received',

  // Files
  FILE_RECEIVED: 'file:received',
  FILE_PROGRESS: 'file:progress',

  // WebRTC
  WEBRTC_OFFER: 'webrtc:offer',
  WEBRTC_ANSWER: 'webrtc:answer',
  WEBRTC_ICE: 'webrtc:ice',

  // Screenshot
  SCREENSHOT_REQUEST: 'screenshot:request',
  SCREENSHOT_DATA: 'screenshot:data',
};

// ─── Transport Types ──────────────────────────────────────────────
const TRANSPORT = {
  WIFI: 'wifi',
  BLUETOOTH: 'bluetooth',
  AUTO: 'auto',
};

// ─── Device Types ─────────────────────────────────────────────────
const DEVICE_TYPE = {
  PC: 'pc',
  PHONE: 'phone',
  TABLET: 'tablet',
};

// ─── Packet Builder ───────────────────────────────────────────────
function createPacket(type, data = {}, transport = TRANSPORT.WIFI) {
  return {
    type,
    data,
    transport,
    timestamp: Date.now(),
    version: PROTOCOL_VERSION,
  };
}

function parsePacket(raw) {
  try {
    const packet = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (!packet.type) throw new Error('Missing packet type');
    return packet;
  } catch (e) {
    return null;
  }
}

// ─── File Size Formatter ──────────────────────────────────────────
function formatSize(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

// ─── Time Ago Formatter ──────────────────────────────────────────
function timeAgo(timestamp) {
  const diff = Date.now() - timestamp;
  if (diff < 60000) return 'Just now';
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  return `${Math.floor(diff / 86400000)}d ago`;
}

// ─── Exports ──────────────────────────────────────────────────────
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { PROTOCOL_VERSION, APP_NAME, DEFAULT_PORT, MSG, TRANSPORT, DEVICE_TYPE, createPacket, parsePacket, formatSize, timeAgo };
}
