const fs = require('fs');
const path = require('path');
const https = require('https');
const crypto = require('crypto');
const EventEmitter = require('events');

const isVercel = process.env.VERCEL === '1';
const dataDir = isVercel ? '/tmp/data' : path.join(__dirname, '../../data');
const NOTIFICATIONS_FILE = path.join(dataDir, 'notifications.json');
const FCM_TOKENS_FILE = path.join(dataDir, 'fcm_tokens.json');

function base64UrlEncode(str) {
  return Buffer.from(str)
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

class NotificationService extends EventEmitter {
  constructor() {
    super();
    this.notifications = [];
    this.fcmTokens = new Map(); // token -> { platform, email, userId, updatedAt }
    this._serviceAccount = null;
    this._cachedAccessToken = null;
    this._tokenExpiry = 0;
    this._loadFromDisk();
    this._initServiceAccount();
  }

  _initServiceAccount() {
    try {
      const saPath = process.env.GOOGLE_APPLICATION_CREDENTIALS || 
                     process.env.FIREBASE_SERVICE_ACCOUNT_PATH ||
                     path.join(dataDir, 'firebase_service_account.json');
      if (fs.existsSync(saPath)) {
        const raw = fs.readFileSync(saPath, 'utf8');
        this._serviceAccount = JSON.parse(raw);
        console.log('[NotificationService] Loaded Firebase Service Account for FCM push dispatch.');
      } else if (process.env.FIREBASE_SERVICE_ACCOUNT) {
        this._serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
        console.log('[NotificationService] Loaded Firebase Service Account from env.');
      }
    } catch (e) {
      console.warn('[NotificationService] Note: Firebase Service Account init note:', e.message);
    }
  }

  async _getGoogleAccessToken() {
    if (!this._serviceAccount || !this._serviceAccount.private_key || !this._serviceAccount.client_email) {
      return null;
    }
    const now = Math.floor(Date.now() / 1000);
    if (this._cachedAccessToken && this._tokenExpiry > now + 60) {
      return this._cachedAccessToken;
    }

    try {
      const header = { alg: 'RS256', typ: 'JWT' };
      const claim = {
        iss: this._serviceAccount.client_email,
        scope: 'https://www.googleapis.com/auth/firebase.messaging',
        aud: 'https://oauth2.googleapis.com/token',
        exp: now + 3600,
        iat: now,
      };

      const encodedHeader = base64UrlEncode(JSON.stringify(header));
      const encodedClaim = base64UrlEncode(JSON.stringify(claim));
      const signInput = `${encodedHeader}.${encodedClaim}`;

      const sign = crypto.createSign('RSA-SHA256');
      sign.update(signInput);
      const signature = sign.sign(this._serviceAccount.private_key, 'base64')
        .replace(/=/g, '')
        .replace(/\+/g, '-')
        .replace(/\//g, '_');

      const jwt = `${signInput}.${signature}`;

      const postData = `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${jwt}`;
      const tokenRes = await new Promise((resolve, reject) => {
        const req = https.request({
          hostname: 'oauth2.googleapis.com',
          path: '/token',
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'Content-Length': Buffer.byteLength(postData),
          }
        }, res => {
          let body = '';
          res.on('data', chunk => body += chunk);
          res.on('end', () => {
            try {
              resolve(JSON.parse(body));
            } catch (e) {
              reject(e);
            }
          });
        });
        req.on('error', reject);
        req.write(postData);
        req.end();
      });

      if (tokenRes && tokenRes.access_token) {
        this._cachedAccessToken = tokenRes.access_token;
        this._tokenExpiry = now + (tokenRes.expires_in || 3600);
        return this._cachedAccessToken;
      }
    } catch (e) {
      console.error('[NotificationService] Error getting Google Access Token:', e.message);
    }
    return null;
  }

  _loadFromDisk() {
    try {
      if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir, { recursive: true });
      }

      if (fs.existsSync(NOTIFICATIONS_FILE)) {
        const raw = fs.readFileSync(NOTIFICATIONS_FILE, 'utf8');
        const parsed = JSON.parse(raw || '[]');
        this.notifications = Array.isArray(parsed) ? parsed : [];
      } else {
        this.notifications = [];
        this._persistToDisk();
      }

      if (fs.existsSync(FCM_TOKENS_FILE)) {
        const rawTokens = fs.readFileSync(FCM_TOKENS_FILE, 'utf8');
        const parsedTokens = JSON.parse(rawTokens || '{}');
        this.fcmTokens = new Map(Object.entries(parsedTokens));
      }
    } catch (err) {
      console.error('[NotificationService] Error loading notifications from disk:', err.message);
      this.notifications = [];
    }
  }

  _persistToDisk() {
    try {
      if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir, { recursive: true });
      }
      const tempPath = NOTIFICATIONS_FILE + '.tmp';
      fs.writeFileSync(tempPath, JSON.stringify(this.notifications, null, 2), 'utf8');
      fs.renameSync(tempPath, NOTIFICATIONS_FILE);

      const tokensObj = Object.fromEntries(this.fcmTokens);
      const tempTokensPath = FCM_TOKENS_FILE + '.tmp';
      fs.writeFileSync(tempTokensPath, JSON.stringify(tokensObj, null, 2), 'utf8');
      fs.renameSync(tempTokensPath, FCM_TOKENS_FILE);
    } catch (err) {
      console.error('[NotificationService] Error persisting notifications to disk:', err.message);
    }
  }

  /**
   * Register or update a device FCM push token
   */
  registerPushToken({ token, platform = 'android', email = '', userId = '' }) {
    if (!token || typeof token !== 'string') return false;
    const cleanToken = token.trim();
    if (cleanToken.length < 10) return false;

    this.fcmTokens.set(cleanToken, {
      token: cleanToken,
      platform: platform || 'android',
      email: (email || '').trim().toLowerCase(),
      userId: (userId || '').trim(),
      updatedAt: new Date().toISOString(),
    });

    this._persistToDisk();
    console.log(`[NotificationService] Registered FCM device token for ${platform} (${this.fcmTokens.size} total devices).`);
    return true;
  }

  /**
   * Save and dispatch a new broadcast notification from Admin Panel
   */
  saveBroadcastNotification({
    title,
    body,
    target = 'ALL_USERS',
    category = 'ANNOUNCEMENT',
    actionUrl = '',
    priority = 'HIGH',
    deliveredCount = 0,
    senderAdmin = 'adm_master_root_01',
  }) {
    const newNotification = {
      id: 'ntf_' + Date.now().toString(36) + '_' + Math.random().toString(36).substr(2, 6),
      title: (title || '').trim(),
      body: (body || '').trim(),
      target: target === 'WEBMASTERS_ONLY' ? 'WEBMASTERS_ONLY' : 'ALL_USERS',
      category: (category || 'ANNOUNCEMENT').toUpperCase(),
      actionUrl: (actionUrl || '').trim(),
      priority: priority || 'HIGH',
      senderAdmin,
      createdAt: new Date().toISOString(),
      status: 'DISPATCHED',
      deliveredCount: deliveredCount > 0 ? deliveredCount : Math.max(1, this.fcmTokens.size),
    };

    this.notifications.unshift(newNotification);
    if (this.notifications.length > 500) {
      this.notifications = this.notifications.slice(0, 500);
    }

    this._persistToDisk();

    // 1. Emit event for real-time WebSocket broadcast to all open app/web clients
    this.emit('NOTIFICATION_BROADCAST', newNotification);

    // 2. Trigger FCM push for background/closed devices
    this._dispatchFcmPush(newNotification);

    return newNotification;
  }

  /**
   * Dispatch push notifications to registered FCM tokens
   */
  async _dispatchFcmPush(notification) {
    if (this.fcmTokens.size === 0) return;

    const projectId = this._serviceAccount?.project_id || 'cloud-c454a';
    const accessToken = await this._getGoogleAccessToken();

    console.log(`[NotificationService] Dispatching push notice "${notification.title}" to ${this.fcmTokens.size} registered devices.`);

    if (!accessToken) {
      console.log(`[NotificationService] Service Account credentials not provided yet. Fast WebSocket delivery and sync endpoints are handling notifications.`);
      return;
    }

    const tokens = Array.from(this.fcmTokens.keys());
    const staleTokens = [];

    for (const token of tokens) {
      try {
        const payload = JSON.stringify({
          message: {
            token: token,
            notification: {
              title: notification.title,
              body: notification.body,
            },
            data: {
              id: String(notification.id || ''),
              title: String(notification.title || ''),
              body: String(notification.body || ''),
              category: String(notification.category || 'ANNOUNCEMENT'),
              actionUrl: String(notification.actionUrl || ''),
              click_action: 'FLUTTER_NOTIFICATION_CLICK',
            },
            android: {
              priority: 'high',
              notification: {
                channel_id: 'terabox_broadcasts_v1',
                sound: 'default',
                default_sound: true,
                default_vibrate_timings: true,
                notification_priority: 'PRIORITY_MAX',
                visibility: 'PUBLIC',
              },
            },
          },
        });

        const req = https.request({
          hostname: 'fcm.googleapis.com',
          path: `/v1/projects/${projectId}/messages:send`,
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${accessToken}`,
            'Content-Length': Buffer.byteLength(payload),
          }
        }, res => {
          let resBody = '';
          res.on('data', c => resBody += c);
          res.on('end', () => {
            if (res.statusCode === 404 || (resBody.includes('UNREGISTERED') || resBody.includes('NOT_FOUND'))) {
              staleTokens.push(token);
            }
          });
        });

        req.on('error', (err) => {
          console.error(`[NotificationService] FCM send error for device: ${err.message}`);
        });

        req.write(payload);
        req.end();
      } catch (e) {
        console.error(`[NotificationService] Error sending to token: ${e.message}`);
      }
    }

    if (staleTokens.length > 0) {
      for (const st of staleTokens) {
        this.fcmTokens.delete(st);
      }
      this._persistToDisk();
    }
  }

  /**
   * Get list of recent broadcasts with metadata for Admin view
   */
  getBroadcastHistory(limit = 50) {
    this._loadFromDisk();
    return this.notifications.slice(0, Math.min(limit, 100));
  }

  /**
   * Get overall broadcast statistics
   */
  getStats() {
    this._loadFromDisk();
    const total = this.notifications.length;
    let totalDelivered = 0;
    this.notifications.forEach(n => {
      totalDelivered += (n.deliveredCount || 1);
    });
    return {
      totalBroadcasts: total,
      totalDelivered,
      registeredDevices: this.fcmTokens.size,
      fcmConfigured: !!(this._serviceAccount && this._serviceAccount.private_key),
      fcmProjectId: this._serviceAccount?.project_id || null,
      lastDispatchedAt: this.notifications[0]?.createdAt || null,
    };
  }

  /**
   * Delete a single notification from history
   */
  deleteBroadcast(id) {
    this._loadFromDisk();
    const initialLen = this.notifications.length;
    this.notifications = this.notifications.filter(n => n.id !== id);
    if (this.notifications.length !== initialLen) {
      this._persistToDisk();
      return true;
    }
    return false;
  }

  /**
   * Clear all notification history
   */
  clearAllBroadcasts() {
    this.notifications = [];
    this._persistToDisk();
    return true;
  }

  /**
   * Get public notifications targeted for clients
   */
  getClientNotifications(limit = 20, isWebmaster = false) {
    this._loadFromDisk();
    return this.notifications
      .filter((n) => n.target === 'ALL_USERS' || (isWebmaster && n.target === 'WEBMASTERS_ONLY'))
      .slice(0, Math.min(limit, 50));
  }
}

module.exports = new NotificationService();
