const fs = require('fs');
const path = require('path');
const env = require('../config/env');

const isVercel = process.env.VERCEL === '1';
const dataDir = isVercel ? '/tmp/data' : path.join(__dirname, '../../data');
if (!fs.existsSync(dataDir)) {
  try { fs.mkdirSync(dataDir, { recursive: true }); } catch (_) {}
}
const webmastersFilePath = path.join(dataDir, 'webmasters.json');

class WebmasterService {
  constructor() {
    this.profiles = new Map();
    this.ipViewHistory = new Map(); // IP:NodeId -> timestamp (for 24h deduplication)
    this.withdrawals = [];

    this._loadWebmastersFromDisk();
  }

  _loadWebmastersFromDisk() {
    try {
      if (fs.existsSync(webmastersFilePath)) {
        const raw = fs.readFileSync(webmastersFilePath, 'utf8');
        const list = JSON.parse(raw);
        if (Array.isArray(list)) {
          for (const item of list) {
            if (item && item.referralCode) {
              this.profiles.set(item.referralCode, item);
              if (item.withdrawals) {
                this.withdrawals.push(...item.withdrawals);
              }
            }
          }
          // Remove duplicates from withdrawals list
          const seen = new Set();
          this.withdrawals = this.withdrawals.filter(w => {
            const duplicate = seen.has(w.id);
            seen.add(w.id);
            return !duplicate;
          });
          console.log(`[WebmasterService] Loaded ${this.profiles.size} persistent profiles from disk.`);
        }
      }
    } catch (err) {
      console.warn(`[WebmasterService] Could not load webmasters from disk:`, err.message);
    }
  }

  _saveWebmastersToDisk() {
    try {
      const list = Array.from(this.profiles.values());
      fs.writeFileSync(webmastersFilePath, JSON.stringify(list, null, 2), 'utf8');
    } catch (err) {
      console.warn(`[WebmasterService] Could not save webmasters to disk:`, err.message);
    }
  }

  getProfile(identifier) {
    if (!identifier) return null;
    const clean = identifier.toString().trim();
    if (this.profiles.has(clean)) {
      return this.profiles.get(clean);
    }
    // Search by email, userId, or referralCode
    for (const p of this.profiles.values()) {
      if (p.referralCode === clean || p.userId === clean || (p.email && p.email.toLowerCase() === clean.toLowerCase())) {
        return p;
      }
    }
    // Try reloading from disk if not yet in memory
    this._loadWebmastersFromDisk();
    if (this.profiles.has(clean)) {
      return this.profiles.get(clean);
    }
    for (const p of this.profiles.values()) {
      if (p.referralCode === clean || p.userId === clean || (p.email && p.email.toLowerCase() === clean.toLowerCase())) {
        return p;
      }
    }
    return null;
  }

  // Record a Video View with Anti-Fraud 24hr IP deduplication
  recordVideoView(referralCode, nodeId, clientIp) {
    const profile = this.profiles.get(referralCode);
    if (!profile) return { counted: false, reason: 'Invalid referral code' };

    const ipKey = `${clientIp}:${nodeId}`;
    const lastSeen = this.ipViewHistory.get(ipKey);
    const now = Date.now();

    // 24-hour deduplication window (86400000 ms)
    if (lastSeen && now - lastSeen < 86400000) {
      return { counted: false, reason: 'Duplicate view within 24h' };
    }

    this.ipViewHistory.set(ipKey, now);

    // Calculate revenue if on Video Plays plan
    if (profile.currentPlan === 'videoPlays') {
      const earnPerView = env.webmaster.ratePer1000VideoPlays / 1000;
      profile.walletBalanceUsd += earnPerView;
    }

    this._saveWebmastersToDisk();
    return { counted: true, balance: profile.walletBalanceUsd };
  }

  // Record a New User Registration
  recordNewUser(referralCode) {
    const profile = this.profiles.get(referralCode);
    if (!profile) return;

    if (profile.currentPlan === 'newUsers') {
      const earnPerUser = env.webmaster.ratePer100NewUsers / 100;
      profile.walletBalanceUsd += earnPerUser;
    }

    this._saveWebmastersToDisk();
  }

  // Switch Plan
  switchPlan(referralCode, newPlan) {
    const profile = this.profiles.get(referralCode);
    if (profile) {
      profile.currentPlan = newPlan;
      this._saveWebmastersToDisk();
      return true;
    }
    return false;
  }

  // Submit Payout Request
  submitWithdrawal(referralCode, { amountUsd, method, accountInfo }) {
    const profile = this.profiles.get(referralCode);
    if (!profile) throw new Error('Profile not found');
    if (amountUsd < env.webmaster.minWithdrawalUsd) {
      throw new Error(`Minimum payout is $${env.webmaster.minWithdrawalUsd}`);
    }
    if (amountUsd > profile.walletBalanceUsd) {
      throw new Error('Insufficient wallet balance');
    }

    profile.walletBalanceUsd -= amountUsd;
    profile.totalWithdrawnUsd += amountUsd;

    const record = {
      id: `wd_${Date.now()}`,
      referralCode,
      amountUsd,
      method,
      accountInfo,
      status: 'pending',
      requestedAt: new Date().toISOString(),
    };

    this.withdrawals.unshift(record);
    profile.withdrawals ??= [];
    profile.withdrawals.unshift(record);

    this._saveWebmastersToDisk();
    return record;
  }

  // Telegram Bot Webhook Auto-Poster Handler
  handleTelegramBotWebhook({ telegramUserId, mediaUrl, caption, referralCode }) {
    const code = referralCode || 'TBX9942';
    const shortCode = `tg${Math.random().toString(36).substring(2, 7)}`;
    const monetizedUrl = `https://terabox.cloud/s/${shortCode}?ref=${code}`;

    return {
      success: true,
      monetizedUrl,
      caption: `${caption || 'Shared Video'}\n\n📥 Fast Download / Stream:\n${monetizedUrl}`,
    };
  }

  // Delete Webmaster profile and withdrawals upon account erasure
  deleteWebmaster(userId, email, referralCode) {
    try {
      const cleanEmail = (email || '').trim().toLowerCase();
      for (const [code, p] of this.profiles.entries()) {
        if ((userId && p.userId === userId) ||
            (cleanEmail && (p.email || '').toLowerCase() === cleanEmail) ||
            (referralCode && p.referralCode === referralCode)) {
          this.profiles.delete(code);
        }
      }
      this.withdrawals = this.withdrawals.filter(w => {
        if (userId && w.userId === userId) return false;
        if (cleanEmail && (w.email || '').toLowerCase() === cleanEmail) return false;
        return true;
      });
      this._saveWebmastersToDisk();
      return true;
    } catch (err) {
      console.warn('[WebmasterService] Error deleting webmaster:', err.message);
      return false;
    }
  }
}

module.exports = new WebmasterService();
