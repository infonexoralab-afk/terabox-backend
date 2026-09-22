const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
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
    this.ssoTokens = new Map(); // SSO launch tokens: token -> { userId, email, referralCode, expiresAt }

    this._loadWebmastersFromDisk();
  }

  _loadWebmastersFromDisk() {
    try {
      if (fs.existsSync(webmastersFilePath)) {
        const raw = fs.readFileSync(webmastersFilePath, 'utf8');
        const list = JSON.parse(raw);
        if (Array.isArray(list)) {
          this.withdrawals = [];
          for (const item of list) {
            if (item && item.referralCode) {
              this.profiles.set(item.referralCode, item);
              if (Array.isArray(item.withdrawals)) {
                this.withdrawals.push(...item.withdrawals);
              }
            }
          }
          // Remove duplicates from withdrawals list
          const seen = new Set();
          this.withdrawals = this.withdrawals.filter(w => {
            if (!w || !w.id) return false;
            const duplicate = seen.has(w.id);
            seen.add(w.id);
            return !duplicate;
          });
          console.log(`[WebmasterService] Loaded ${this.profiles.size} persistent profiles and ${this.withdrawals.length} withdrawals from disk.`);
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
    const cleanLower = clean.toLowerCase();
    // Search by email, userId, or referralCode
    for (const p of this.profiles.values()) {
      if (!p) continue;
      const pEmail = (p.email || '').toLowerCase();
      if (
        p.referralCode === clean ||
        p.userId === clean ||
        pEmail === cleanLower
      ) {
        return p;
      }
    }
    // Try reloading from disk if not yet in memory
    this._loadWebmastersFromDisk();
    if (this.profiles.has(clean)) {
      return this.profiles.get(clean);
    }
    for (const p of this.profiles.values()) {
      if (!p) continue;
      const pEmail = (p.email || '').toLowerCase();
      if (
        p.referralCode === clean ||
        p.userId === clean ||
        pEmail === cleanLower
      ) {
        return p;
      }
    }
    return null;
  }

  // Generate Cryptographic Time-Limited SSO Launch Token for Authorized App User
  createSsoLaunchToken(userId, email = '', refCode = '') {
    const cleanId = (userId || '').trim();
    const cleanEmail = (email || '').trim().toLowerCase();
    const cleanRef = (refCode || '').trim().toUpperCase();
    const secret = env.jwtSecret || 'terabox_sso_signature_secret_2026';

    // 1. Check if user is already enrolled
    let profile = cleanRef ? this.getProfile(cleanRef) : (this.getProfile(cleanId) || (cleanEmail ? this.getProfile(cleanEmail) : null));
    const isEnrolled = !!(profile && profile.referralCode);
    const referralCode = isEnrolled ? profile.referralCode : cleanRef;
    const expiresAt = Date.now() + (24 * 60 * 60 * 1000); // 24 hours validity
    const payload = Buffer.from(JSON.stringify({
      u: cleanId,
      e: cleanEmail,
      r: referralCode,
      enrolled: isEnrolled,
      exp: expiresAt,
      t: Date.now(),
      v: 2
    })).toString('base64url');

    const signature = crypto.createHmac('sha256', secret).update(payload).digest('base64url');
    const token = `sso_${payload}_${signature}`;

    // Also keep in memory cache for instant lookup
    this.ssoTokens.set(token, {
      userId: cleanId,
      email: cleanEmail,
      referralCode,
      isEnrolled,
      expiresAt,
    });

    return {
      success: true,
      token,
      userId: cleanId,
      email: cleanEmail,
      referralCode,
      isEnrolled,
      expiresAt,
    };
  }

  // Verify SSO Token from Web Portal with Constant-Time Cryptographic Verification
  verifySsoLaunchToken(token) {
    if (!token) return null;
    const cleanToken = token.toString().trim();
    const secret = env.jwtSecret || 'terabox_sso_signature_secret_2026';

    if (!cleanToken.startsWith('sso_')) return null;
    const parts = cleanToken.split('_');
    if (parts.length !== 3) {
      // Check in-memory token store if any
      const ssoData = this.ssoTokens.get(cleanToken);
      if (ssoData && ssoData.expiresAt >= Date.now()) {
        const profile = ssoData.referralCode ? this.getProfile(ssoData.referralCode) : (this.getProfile(ssoData.userId) || (ssoData.email ? this.getProfile(ssoData.email) : null));
        const isEnrolled = !!(profile && profile.referralCode);
        return { valid: true, profile: isEnrolled ? profile : null, isEnrolled, ssoData, userId: ssoData.userId, email: ssoData.email, referralCode: isEnrolled ? profile.referralCode : '' };
      }
      return null;
    }

    const payload = parts[1];
    const signature = parts[2];

    const expectedSig = crypto.createHmac('sha256', secret).update(payload).digest('base64url');
    const sigBuf = Buffer.from(signature);
    const expBuf = Buffer.from(expectedSig);
    if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
      return null; // Invalid signature / tampered payload
    }

    try {
      const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
      if (data.exp && data.exp < Date.now()) {
        return null; // Expired token
      }

      const cleanId = data.u || '';
      const cleanEmail = data.e || '';
      const cleanRef = data.r || '';

      let profile = cleanRef ? this.getProfile(cleanRef) : (this.getProfile(cleanId) || (cleanEmail ? this.getProfile(cleanEmail) : null));
      const isEnrolled = !!(profile && profile.referralCode);

      return {
        valid: true,
        userId: cleanId,
        email: cleanEmail,
        referralCode: isEnrolled ? profile.referralCode : cleanRef,
        isEnrolled,
        profile: isEnrolled ? profile : null,
        expiresAt: data.exp,
        ssoData: {
          userId: cleanId,
          email: cleanEmail,
          referralCode: isEnrolled ? profile.referralCode : cleanRef,
        }
      };
    } catch (_) {
      return null;
    }
  }

  // Programmatic Enrollment
  enroll(userId, email = '') {
    const cleanId = (userId || '').trim();
    const cleanEmail = (email || '').trim().toLowerCase();

    for (const p of this.profiles.values()) {
      if (p && (p.userId === cleanId || (cleanEmail && p.email && p.email.toLowerCase() === cleanEmail))) {
        return { success: true, profile: p, isNew: false };
      }
    }

    const referralCode = 'TBX' + Math.floor(1000 + Math.random() * 9000);
    const newProfile = {
      userId: cleanId,
      email: cleanEmail,
      referralCode,
      currentPlan: 'videoPlays',
      walletBalanceUsd: 0.0,
      totalWithdrawnUsd: 0.0,
      stats: [],
      referralProgram: {
        totalClicks: 0,
        totalInstalls: 0,
        pendingReferrals: 0,
        qualifiedReferrals: 0,
        rejectedReferrals: 0,
        totalEarnedUsd: 0.0,
      },
      joinedAt: new Date().toISOString(),
      sharedLinks: [],
      withdrawals: [],
      earningRecords: [],
    };

    this.profiles.set(referralCode, newProfile);
    this._saveWebmastersToDisk();
    return { success: true, profile: newProfile, isNew: true };
  }

  // Credit Referral Rewards with Audit Trail
  creditReferralEarnings(referralCode, amountUsd = 0.05, details = {}) {
    let isProgramEnabled = true;
    try {
      const systemConfigStore = require('./systemConfigStore');
      isProgramEnabled = systemConfigStore.get('webmaster_program_enabled', true);
    } catch (_) {}
    if (!isProgramEnabled) return false;

    const profile = this.getProfile(referralCode);
    if (!profile) return false;

    const amt = parseFloat(amountUsd) || 0.05;
    profile.walletBalanceUsd = Math.round(((profile.walletBalanceUsd || 0) + amt) * 10000) / 10000;
    profile.totalEarningsUsd = Math.round(((profile.totalEarningsUsd || (profile.walletBalanceUsd + (profile.totalWithdrawnUsd || 0))) + amt) * 10000) / 10000;

    profile.referralProgram ??= {
      totalClicks: 0,
      totalInstalls: 0,
      pendingReferrals: 0,
      qualifiedReferrals: 0,
      rejectedReferrals: 0,
      totalEarnedUsd: 0.0,
    };
    profile.referralProgram.qualifiedReferrals = (profile.referralProgram.qualifiedReferrals || 0) + 1;
    profile.referralProgram.totalEarnedUsd = Math.round(((profile.referralProgram.totalEarnedUsd || 0) + amt) * 10000) / 10000;

    profile.earningRecords ??= [];
    profile.earningRecords.unshift({
      id: `earn_ref_${Date.now()}`,
      type: 'newUsers',
      amountUsd: amt,
      description: `Verified New User Referral ($${amt.toFixed(2)} USD Reward)`,
      details,
      recordedAt: new Date().toISOString(),
    });

    this._saveWebmastersToDisk();
    return true;
  }

  // Record a Video View with Anti-Fraud 24hr IP deduplication
  recordVideoView(referralCode, nodeId, clientIp) {
    let isProgramEnabled = true;
    try {
      const systemConfigStore = require('./systemConfigStore');
      isProgramEnabled = systemConfigStore.get('webmaster_program_enabled', true);
    } catch (_) {}
    if (!isProgramEnabled) {
      return { counted: false, reason: 'Webmaster program is disabled' };
    }

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
    let isProgramEnabled = true;
    try {
      const systemConfigStore = require('./systemConfigStore');
      isProgramEnabled = systemConfigStore.get('webmaster_program_enabled', true);
    } catch (_) {}
    if (!isProgramEnabled) return;

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
    
    // Dynamic real-time minimum withdrawal check from Admin Config
    let minPayout = 10.0;
    try {
      const systemConfigStore = require('./systemConfigStore');
      minPayout = systemConfigStore.get('min_withdrawal_usd', 10.0);
    } catch (_) {
      minPayout = env.webmaster.minWithdrawalUsd || 10.0;
    }

    if (amountUsd < minPayout) {
      throw new Error(`Minimum payout is $${minPayout.toFixed(2)} USD`);
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

  // Update Withdrawal Status (Paid or Rejected) with profile & disk sync
  updateWithdrawalStatus(withdrawalId, newStatus, processedBy = 'Admin', { txnHash = null, rejectionReason = null } = {}) {
    this._loadWebmastersFromDisk(); // Ensure latest state is loaded from disk
    const cleanId = (withdrawalId || '').toString().trim();
    const normalize = (s) => (s || '').toString().trim().toLowerCase().replace(/^#/, '');
    const target = normalize(cleanId);

    // Normalize approved, settled, completed directly to 'paid'
    const finalStatus = (newStatus === 'approved' || newStatus === 'paid' || newStatus === 'completed' || newStatus === 'settled') ? 'paid' : newStatus;
    let updatedRecord = null;

    const matchesId = (recordId) => {
      if (!recordId) return false;
      const normRec = normalize(recordId);
      return normRec === target || normRec.includes(target) || target.includes(normRec);
    };

    // 1. Update in global this.withdrawals array
    for (const w of this.withdrawals) {
      if (w && matchesId(w.id)) {
        w.status = finalStatus;
        w.processedAt = new Date().toISOString();
        w.processedBy = processedBy;
        if (txnHash) w.transactionHash = txnHash;
        if (rejectionReason) w.rejectionReason = rejectionReason;
        updatedRecord = w;
      }
    }

    // 2. Update inside all profiles.withdrawals
    for (const profile of this.profiles.values()) {
      if (Array.isArray(profile.withdrawals)) {
        for (const profWd of profile.withdrawals) {
          if (profWd && matchesId(profWd.id)) {
            profWd.status = finalStatus;
            profWd.processedAt = new Date().toISOString();
            profWd.processedBy = processedBy;
            if (txnHash) profWd.transactionHash = txnHash;
            if (rejectionReason) profWd.rejectionReason = rejectionReason;
            updatedRecord = profWd;

            // If rejected, refund balance back to webmaster profile
            if (finalStatus === 'rejected') {
              const refundAmt = profWd.amountUsd || 0;
              profile.walletBalanceUsd = Math.round(((profile.walletBalanceUsd || 0) + refundAmt) * 10000) / 10000;
              profile.totalWithdrawnUsd = Math.max(0, Math.round(((profile.totalWithdrawnUsd || 0) - refundAmt) * 10000) / 10000);
            }
          }
        }
      }
    }

    // 3. Persist updated state to disk immediately
    this._saveWebmastersToDisk();
    return updatedRecord;
  }

  // Telegram Bot Webhook Auto-Poster Handler
  handleTelegramBotWebhook({ telegramUserId, mediaUrl, caption, referralCode }) {
    const code = referralCode || 'TBX9942';
    const shortCode = `tg${Math.random().toString(36).substring(2, 7)}`;
    const monetizedUrl = `https://airbox.one/s/${shortCode}?ref=${code}`;

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
