/**
 * MoodLink Security Module
 * Session tokens, device trust management, and encryption helpers
 */
const crypto = require('crypto');

class Security {
  constructor() {
    this.trustedDevices = new Map();
    this.sessions = new Map();
    this.SECRET_KEY = crypto.randomBytes(32);
  }

  // Generate a session token for a paired device
  generateSessionToken(deviceId) {
    const token = crypto.randomBytes(48).toString('hex');
    this.sessions.set(token, {
      deviceId,
      createdAt: Date.now(),
      lastUsed: Date.now(),
    });
    return token;
  }

  // Validate a session token
  validateSession(token) {
    const session = this.sessions.get(token);
    if (!session) return false;
    // Expire after 24 hours
    if (Date.now() - session.createdAt > 86400000) {
      this.sessions.delete(token);
      return false;
    }
    session.lastUsed = Date.now();
    return true;
  }

  // Revoke session
  revokeSession(token) {
    this.sessions.delete(token);
  }

  // Trust a device
  trustDevice(deviceId, deviceInfo) {
    this.trustedDevices.set(deviceId, {
      ...deviceInfo,
      trustedAt: Date.now(),
      fingerprint: this._generateFingerprint(deviceInfo),
    });
  }

  // Check if device is trusted
  isDeviceTrusted(deviceId) {
    return this.trustedDevices.has(deviceId);
  }

  // Revoke device trust
  revokeDevice(deviceId) {
    this.trustedDevices.delete(deviceId);
    // Also revoke all sessions for this device
    for (const [token, session] of this.sessions) {
      if (session.deviceId === deviceId) this.sessions.delete(token);
    }
  }

  // Encrypt a message payload
  encrypt(data) {
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv('aes-256-gcm', this.SECRET_KEY, iv);
    let encrypted = cipher.update(JSON.stringify(data), 'utf8', 'hex');
    encrypted += cipher.final('hex');
    const tag = cipher.getAuthTag().toString('hex');
    return { encrypted, iv: iv.toString('hex'), tag };
  }

  // Decrypt a message payload
  decrypt(encryptedData) {
    try {
      const decipher = crypto.createDecipheriv(
        'aes-256-gcm', this.SECRET_KEY, Buffer.from(encryptedData.iv, 'hex')
      );
      decipher.setAuthTag(Buffer.from(encryptedData.tag, 'hex'));
      let decrypted = decipher.update(encryptedData.encrypted, 'hex', 'utf8');
      decrypted += decipher.final('utf8');
      return JSON.parse(decrypted);
    } catch (e) {
      return null;
    }
  }

  _generateFingerprint(info) {
    return crypto.createHash('sha256')
      .update(`${info.name}:${info.type}:${Date.now()}`)
      .digest('hex').slice(0, 16);
  }

  // Get list of trusted devices
  getTrustedDevices() {
    return Array.from(this.trustedDevices.entries()).map(([id, info]) => ({
      id, ...info
    }));
  }
}

module.exports = Security;
