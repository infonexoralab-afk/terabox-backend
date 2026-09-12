const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const env = require('../config/env');
const webmasterService = require('./webmasterService');

const REFERRALS_FILE = path.join(__dirname, '../../data/referrals.json');
const DEVICE_REGISTRY_FILE = path.join(__dirname, '../../data/device_registry.json');
const WEBMASTER_DEVICES_FILE = path.join(__dirname, '../../data/webmaster_devices.json');
const SECRET_SALT = process.env.REFERRAL_SECRET_SALT || 'terabox_referral_integrity_salt_2026';

const QUALIFY_MILESTONES = {
  STORAGE_UPLOAD_2MB: 'STORAGE_UPLOAD_2MB',
  VIDEO_STREAM_60S: 'VIDEO_STREAM_60S',
  RETENTION_DAY2: 'RETENTION_DAY2',
};

const REFERRAL_STATUS = {
  PENDING: 'PENDING',
  QUALIFIED: 'QUALIFIED',
  REJECTED: 'REJECTED',
  EXPIRED: 'EXPIRED',
};

class ReferralService {
  constructor() {
    this.referrals = new Map(); // referralId -> referralObject
    this.deviceRegistry = new Set(); // Set of hashed deviceKeys that completed a referral
    this.webmasterDevices = new Map(); // webmasterUserId / email -> Set of hashed deviceKeys
    this.pendingAttributions = new Map(); // installToken -> attribution info
    this.referralClickStats = new Map(); // refCode -> count
    this._loadFromDisk();

    // Auto-expire referrals older than 72 hours & clean pending attributions older than 1 hour
    const timer = setInterval(() => {
      this._cleanupExpiredReferrals();
      this._cleanupStaleAttributions();
    }, 15 * 60 * 1000);
    if (timer.unref) timer.unref();
  }

  _loadFromDisk() {
    try {
      const dataDir = path.dirname(REFERRALS_FILE);
      if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir, { recursive: true });
      }

      if (fs.existsSync(REFERRALS_FILE)) {
        const raw = fs.readFileSync(REFERRALS_FILE, 'utf8');
        const list = JSON.parse(raw || '[]');
        for (const item of list) {
          this.referrals.set(item.id, item);
        }
      }

      if (fs.existsSync(DEVICE_REGISTRY_FILE)) {
        const rawDev = fs.readFileSync(DEVICE_REGISTRY_FILE, 'utf8');
        const devList = JSON.parse(rawDev || '[]');
        this.deviceRegistry = new Set(devList);
      }

      if (fs.existsSync(WEBMASTER_DEVICES_FILE)) {
        const rawWmDev = fs.readFileSync(WEBMASTER_DEVICES_FILE, 'utf8');
        const obj = JSON.parse(rawWmDev || '{}');
        for (const [wmId, keys] of Object.entries(obj)) {
          this.webmasterDevices.set(wmId, new Set(keys));
        }
      }
    } catch (err) {
      console.error('[ReferralService] Failed to load data from disk:', err.message);
    }
  }

  _saveToDisk() {
    try {
      const dataDir = path.dirname(REFERRALS_FILE);
      if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir, { recursive: true });
      }

      const list = Array.from(this.referrals.values());
      fs.writeFileSync(REFERRALS_FILE, JSON.stringify(list, null, 2), 'utf8');

      const devList = Array.from(this.deviceRegistry);
      fs.writeFileSync(DEVICE_REGISTRY_FILE, JSON.stringify(devList, null, 2), 'utf8');

      const wmDevObj = {};
      for (const [wmId, set] of this.webmasterDevices.entries()) {
        wmDevObj[wmId] = Array.from(set);
      }
      fs.writeFileSync(WEBMASTER_DEVICES_FILE, JSON.stringify(wmDevObj, null, 2), 'utf8');
    } catch (err) {
      console.error('[ReferralService] Failed to save data to disk:', err.message);
    }
  }

  /**
   * Generates a stable, privacy-preserving, salted hash of device identifiers
   */
  hashDeviceKey(rawDeviceFingerprint) {
    if (!rawDeviceFingerprint || typeof rawDeviceFingerprint !== 'string' || rawDeviceFingerprint.trim().length === 0) {
      return null;
    }
    return crypto
      .createHmac('sha256', SECRET_SALT)
      .update(rawDeviceFingerprint.trim())
      .digest('hex');
  }

  /**
   * Register a hardware device as belonging to a creator / webmaster
   */
  registerWebmasterDevice(webmasterIdentifier, deviceFingerprint) {
    if (!webmasterIdentifier || !deviceFingerprint) return;
    const deviceKey = this.hashDeviceKey(deviceFingerprint);
    if (!deviceKey) return;

    const idClean = webmasterIdentifier.trim();
    if (!this.webmasterDevices.has(idClean)) {
      this.webmasterDevices.set(idClean, new Set());
    }
    this.webmasterDevices.get(idClean).add(deviceKey);
    this._saveToDisk();
  }

  /**
   * Check if a device belongs to a specific webmaster
   */
  isWebmasterDevice(webmasterUserId, webmasterEmail, deviceKey) {
    if (!deviceKey) return false;
    if (webmasterUserId && this.webmasterDevices.get(webmasterUserId)?.has(deviceKey)) return true;
    if (webmasterEmail && this.webmasterDevices.get(webmasterEmail.toLowerCase())?.has(deviceKey)) return true;
    return false;
  }

  /**
   * 1. Record Web / Link Click on Webmaster Referral Link
   */
  recordLinkClick(refCode) {
    if (!refCode) return;
    const cleanRef = refCode.trim().toUpperCase();
    const count = (this.referralClickStats.get(cleanRef) || 0) + 1;
    this.referralClickStats.set(cleanRef, count);

    // Also update webmaster profile stats if available
    const profile = webmasterService.getProfile(cleanRef);
    if (profile) {
      profile.referralProgram ??= {
        totalClicks: 0,
        totalInstalls: 0,
        pendingReferrals: 0,
        qualifiedReferrals: 0,
        rejectedReferrals: 0,
        totalEarnedUsd: 0.0,
      };
      profile.referralProgram.totalClicks = (profile.referralProgram.totalClicks || 0) + 1;
      webmasterService._saveWebmastersToDisk();
    }
  }

  /**
   * 2. Track Install (Triggered on App Cold Launch by Google Play Install Referrer API)
   */
  trackInstall({ refCode, installToken, deviceFingerprint, referrerClickTimestamp, installBeginTimestamp, clientIp }) {
    if (!refCode) {
      return { success: false, reason: 'Missing referral code' };
    }

    const cleanRef = refCode.trim().toUpperCase();
    const profile = webmasterService.getProfile(cleanRef);
    if (!profile) {
      return { success: false, reason: 'Invalid or non-existent webmaster referral code' };
    }

    // Anti-Fraud Gate 1: Click-to-Install Delta Time (Defense against Click Injection)
    const clickTime = parseInt(referrerClickTimestamp, 10) || 0;
    const installTime = parseInt(installBeginTimestamp, 10) || 0;
    if (clickTime > 0 && installTime > 0) {
      const deltaSec = installTime - clickTime;
      if (deltaSec < 2) {
        return {
          success: false,
          isFraud: true,
          reason: 'Click Injection detected (Install began too rapidly after click)',
        };
      }
    }

    // Anti-Fraud Gate 2: Device Deduplication
    const deviceKey = this.hashDeviceKey(deviceFingerprint);
    if (deviceKey && this.deviceRegistry.has(deviceKey)) {
      return {
        success: false,
        isDuplicate: true,
        reason: 'Device has already been attributed to an install in the past',
      };
    }

    // Anti-Fraud Gate 3: Webmaster's own device install rejection
    if (deviceKey && this.isWebmasterDevice(profile.userId, profile.email, deviceKey)) {
      return {
        success: false,
        isSelfReferral: true,
        reason: 'Cannot track install on webmaster own device',
      };
    }

    // Cache attribution for subsequent user registration (single-use token with 1h TTL)
    const token = installToken || `itok_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    const attribution = {
      token,
      refCode: cleanRef,
      webmasterUserId: profile.userId,
      webmasterEmail: profile.email || '',
      deviceKey,
      timestamp: Date.now(),
      isUsed: false,
    };

    this.pendingAttributions.set(token, attribution);

    // Update Webmaster stats
    profile.referralProgram ??= {
      totalClicks: 0,
      totalInstalls: 0,
      pendingReferrals: 0,
      qualifiedReferrals: 0,
      rejectedReferrals: 0,
      totalEarnedUsd: 0.0,
    };
    profile.referralProgram.totalInstalls = (profile.referralProgram.totalInstalls || 0) + 1;
    webmasterService._saveWebmastersToDisk();

    return {
      success: true,
      refCode: cleanRef,
      installToken: token,
    };
  }

  /**
   * 3. Handle User Registration (Binds New Account to Webmaster & Creates Qualified Referral)
   */
  onUserRegistered({ userId, email, name, deviceFingerprint, installToken, clientIp, explicitRefCode }) {
    if (!userId) return null;

    const deviceKey = this.hashDeviceKey(deviceFingerprint);

    // Gate 1: Check hardware duplicate
    if (deviceKey && this.deviceRegistry.has(deviceKey)) {
      console.warn(`[ReferralService] ⚠️ Rejected registration for ${email || userId}: Duplicate hardware device.`);
      return { status: REFERRAL_STATUS.REJECTED, reason: 'Duplicate hardware device' };
    }

    // Gate 2: Check if this user was ALREADY referred before (A user can only be referred once)
    const cleanUserEmail = (email || '').trim().toLowerCase();
    for (const r of this.referrals.values()) {
      if (
        (userId && r.referredUserId === userId) ||
        (cleanUserEmail && r.referredUserEmail && r.referredUserEmail.toLowerCase() === cleanUserEmail)
      ) {
        console.warn(`[ReferralService] ⚠️ User ${cleanUserEmail || userId} has already claimed a referral.`);
        return { status: REFERRAL_STATUS.REJECTED, reason: 'User has already claimed a referral' };
      }
    }

    // Gate 3: Resolve attribution ONLY from valid installToken or explicitRefCode (NO unsafe IP fallback)
    let attribution = null;

    if (installToken && this.pendingAttributions.has(installToken)) {
      const candidate = this.pendingAttributions.get(installToken);
      // Check token freshness (1 hour TTL) and usage
      if (!candidate.isUsed && (Date.now() - candidate.timestamp < 60 * 60 * 1000)) {
        attribution = candidate;
      }
    } else if (explicitRefCode) {
      const cleanExplicit = explicitRefCode.trim().toUpperCase();
      const p = webmasterService.getProfile(cleanExplicit);
      if (p) {
        attribution = {
          token: `explicit_${Date.now()}`,
          refCode: p.referralCode,
          webmasterUserId: p.userId,
          webmasterEmail: p.email || '',
          deviceKey,
          timestamp: Date.now(),
        };
      }
    }

    if (!attribution) {
      // Organic registration without referral
      return null;
    }

    const refCode = attribution.refCode;
    const profile = webmasterService.getProfile(refCode);
    if (!profile) {
      return null;
    }

    // Gate 4: Self-Referral Prevention (By User ID, Email, or Webmaster Device)
    const wmUserId = profile.userId || attribution.webmasterUserId;
    const wmEmail = (profile.email || attribution.webmasterEmail || '').trim().toLowerCase();

    if (
      (wmUserId && wmUserId === userId) ||
      (cleanUserEmail && wmUserId && wmUserId.toLowerCase() === cleanUserEmail) ||
      (cleanUserEmail && wmEmail && wmEmail === cleanUserEmail)
    ) {
      console.warn(`[ReferralService] ⚠️ Blocked Self-Referral: User ${cleanUserEmail} matches Webmaster ${wmEmail || wmUserId}`);
      return { status: REFERRAL_STATUS.REJECTED, reason: 'Self-referral is prohibited' };
    }

    if (deviceKey && this.isWebmasterDevice(wmUserId, wmEmail, deviceKey)) {
      console.warn(`[ReferralService] ⚠️ Blocked Same-Device Referral: Device ${deviceKey.substring(0, 8)}... belongs to Webmaster ${wmEmail || wmUserId}`);
      return { status: REFERRAL_STATUS.REJECTED, reason: 'Same-device self-referral is prohibited' };
    }

    // Invalidate the attribution token IMMEDIATELY so it cannot be reused
    if (installToken && this.pendingAttributions.has(installToken)) {
      this.pendingAttributions.delete(installToken);
    }
    attribution.isUsed = true;

    // Register device in deviceRegistry
    if (deviceKey) {
      this.deviceRegistry.add(deviceKey);
    }

    const referralId = `ref_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    const rewardRate = this.getRewardRate();
    const nowIso = new Date().toISOString();

    const referralRecord = {
      id: referralId,
      webmasterRefCode: refCode,
      webmasterUserId: profile.userId,
      referredUserId: userId,
      referredUserEmail: email || '',
      referredUserName: name || 'New User',
      deviceKey: deviceKey || '',
      clientIp: (clientIp || '').replace(/^::ffff:/, '').trim(),
      status: REFERRAL_STATUS.QUALIFIED,
      qualificationMilestone: 'USER_REGISTRATION',
      milestoneDetails: { type: 'USER_REGISTRATION', completedAt: nowIso },
      rewardAmountUsd: rewardRate,
      rejectionReason: null,
      createdAt: nowIso,
      qualifiedAt: nowIso,
      expiresAt: new Date(Date.now() + 72 * 60 * 60 * 1000).toISOString(),
    };

    this.referrals.set(referralId, referralRecord);
    this._saveToDisk();

    // 🟢 DIRECTLY ADD REWARD TO AVAILABLE / WITHDRAWABLE WALLET BALANCE!
    profile.walletBalanceUsd = Math.round(((profile.walletBalanceUsd || 0) + rewardRate) * 10000) / 10000;
    profile.totalEarningsUsd = Math.round(((profile.totalEarningsUsd || (profile.walletBalanceUsd + (profile.totalWithdrawnUsd || 0))) + rewardRate) * 10000) / 10000;

    profile.referralProgram ??= {
      totalClicks: 0,
      totalInstalls: 0,
      pendingReferrals: 0,
      qualifiedReferrals: 0,
      rejectedReferrals: 0,
      totalEarnedUsd: 0.0,
    };
    profile.referralProgram.totalInstalls = Math.max((profile.referralProgram.totalInstalls || 0) + 1, (profile.referralProgram.qualifiedReferrals || 0) + 1);
    profile.referralProgram.qualifiedReferrals = (profile.referralProgram.qualifiedReferrals || 0) + 1;
    profile.referralProgram.totalEarnedUsd = Math.round(((profile.referralProgram.totalEarnedUsd || 0) + rewardRate) * 10000) / 10000;

    // Update Daily Stats
    const todayStr = nowIso.substring(0, 10);
    profile.stats ??= [];
    let todayStat = profile.stats.find(s => s.date === todayStr);
    if (!todayStat) {
      todayStat = { date: todayStr, clicks: 0, videoPlays: 0, newUsers: 0, earningsUsd: 0.0, countryBreakdown: {} };
      profile.stats.push(todayStat);
    }
    todayStat.newUsers = (todayStat.newUsers || 0) + 1;
    todayStat.earningsUsd = Math.round(((todayStat.earningsUsd || 0) + rewardRate) * 10000) / 10000;

    // Record Audit Entry for Reward Details
    profile.earningRecords ??= [];
    profile.earningRecords.unshift({
      id: `earn_ref_${Date.now()}`,
      type: 'newUsers',
      amountUsd: rewardRate,
      description: `Verified New User Referral: ${referralRecord.referredUserName || 'Active User'} ($${rewardRate.toFixed(2)} USD Reward)`,
      country: 'GLOBAL',
      recordedAt: nowIso,
    });

    webmasterService._saveWebmastersToDisk();

    console.log(`[ReferralService] ✅ Successfully attributed referral: ${email || userId} -> Webmaster ${refCode} ($${rewardRate})`);
    return referralRecord;
  }

  /**
   * 4. Evaluate Proof-of-Human Milestone Completion
   */
  async evaluateUserMilestone(userId, milestoneType, metadata = {}) {
    if (!userId) return { qualified: false, reason: 'Missing userId' };

    // Find active PENDING referral for this user
    let targetReferral = null;
    for (const ref of this.referrals.values()) {
      if (ref.referredUserId === userId && ref.status === REFERRAL_STATUS.PENDING) {
        targetReferral = ref;
        break;
      }
    }

    if (!targetReferral) {
      return { qualified: false, reason: 'No pending referral found for user' };
    }

    // Check expiry (72h window)
    if (new Date() > new Date(targetReferral.expiresAt)) {
      targetReferral.status = REFERRAL_STATUS.EXPIRED;
      targetReferral.rejectionReason = 'Milestone not completed within 72 hours';
      this._saveToDisk();
      return { qualified: false, reason: 'Referral window expired' };
    }

    let milestonePassed = false;
    let milestoneDetails = {};

    switch (milestoneType) {
      case QUALIFY_MILESTONES.STORAGE_UPLOAD_2MB: {
        const sizeBytes = parseInt(metadata.fileSize || metadata.sizeBytes, 10) || 0;
        if (sizeBytes >= 2 * 1024 * 1024) { // >= 2 MB
          milestonePassed = true;
          milestoneDetails = {
            type: QUALIFY_MILESTONES.STORAGE_UPLOAD_2MB,
            fileName: metadata.fileName || 'Uploaded File',
            fileSizeMb: (sizeBytes / (1024 * 1024)).toFixed(2),
            completedAt: new Date().toISOString(),
          };
        }
        break;
      }
      case QUALIFY_MILESTONES.VIDEO_STREAM_60S: {
        const watchSec = parseFloat(metadata.watchSeconds || metadata.actualWatch) || 0;
        if (watchSec >= 60) { // >= 60 seconds
          milestonePassed = true;
          milestoneDetails = {
            type: QUALIFY_MILESTONES.VIDEO_STREAM_60S,
            videoTitle: metadata.videoTitle || metadata.fileName || 'Shared Video',
            watchSeconds: watchSec,
            completedAt: new Date().toISOString(),
          };
        }
        break;
      }
      case QUALIFY_MILESTONES.RETENTION_DAY2: {
        const userCreated = new Date(targetReferral.createdAt).getTime();
        const now = Date.now();
        const hoursPassed = (now - userCreated) / (1000 * 60 * 60);
        if (hoursPassed >= 24 && hoursPassed <= 72) {
          milestonePassed = true;
          milestoneDetails = {
            type: QUALIFY_MILESTONES.RETENTION_DAY2,
            hoursPassed: hoursPassed.toFixed(1),
            completedAt: new Date().toISOString(),
          };
        }
        break;
      }
      default:
        break;
    }

    if (!milestonePassed) {
      return { qualified: false, reason: 'Milestone criteria not met yet' };
    }

    // 🟢 QUALIFY & CREDIT PAYOUT!
    targetReferral.status = REFERRAL_STATUS.QUALIFIED;
    targetReferral.qualificationMilestone = milestoneType;
    targetReferral.milestoneDetails = milestoneDetails;
    targetReferral.qualifiedAt = new Date().toISOString();
    this._saveToDisk();

    // Credit Webmaster Wallet with dynamic USD reward
    const rewardUsd = targetReferral.rewardAmountUsd || this.getRewardRate();
    const refCode = targetReferral.webmasterRefCode;
    const profile = webmasterService.getProfile(refCode);

    if (profile) {
      profile.walletBalanceUsd = Math.round(((profile.walletBalanceUsd || 0) + rewardUsd) * 10000) / 10000;

      profile.referralProgram ??= {
        totalClicks: 0,
        totalInstalls: 0,
        pendingReferrals: 0,
        qualifiedReferrals: 0,
        rejectedReferrals: 0,
        totalEarnedUsd: 0.0,
      };

      profile.referralProgram.pendingReferrals = Math.max(0, (profile.referralProgram.pendingReferrals || 0) - 1);
      profile.referralProgram.qualifiedReferrals = (profile.referralProgram.qualifiedReferrals || 0) + 1;
      profile.referralProgram.totalEarnedUsd = Math.round(((profile.referralProgram.totalEarnedUsd || 0) + rewardUsd) * 10000) / 10000;

      // Update Daily Stats
      const todayStr = new Date().toISOString().substring(0, 10);
      profile.stats ??= [];
      let todayStat = profile.stats.find(s => s.date === todayStr);
      if (!todayStat) {
        todayStat = { date: todayStr, clicks: 0, videoPlays: 0, newUsers: 0, earningsUsd: 0.0, countryBreakdown: {} };
        profile.stats.push(todayStat);
      }
      todayStat.newUsers = (todayStat.newUsers || 0) + 1;
      todayStat.earningsUsd = Math.round(((todayStat.earningsUsd || 0) + rewardUsd) * 10000) / 10000;

      // Record Audit Entry
      profile.earningRecords ??= [];
      profile.earningRecords.unshift({
        id: `earn_ref_${Date.now()}`,
        type: 'newUsers',
        amountUsd: rewardUsd,
        description: `Verified New User Referral: ${targetReferral.referredUserName || 'Active User'} ($${rewardUsd.toFixed(2)} Reward)`,
        country: 'GLOBAL',
        recordedAt: new Date().toISOString(),
      });

      webmasterService._saveWebmastersToDisk();
    }

    return {
      qualified: true,
      rewardUsd,
      webmasterRefCode: refCode,
      referralId: targetReferral.id,
      milestone: milestoneType,
    };
  }

  /**
   * 5. Get Webmaster Referral Ledger & Metrics
   */
  getWebmasterReferralLedger(identifier) {
    if (!identifier) return null;
    const cleanId = identifier.toString().trim();

    let profile = null;
    for (const [code, p] of webmasterService.profiles.entries()) {
      if (p.userId === cleanId || p.email === cleanId || p.referralCode === cleanId || code === cleanId) {
        profile = p;
        break;
      }
    }

    if (!profile) return null;

    const refCode = profile.referralCode;
    const userReferrals = [];
    let pendingCount = 0;
    let qualifiedCount = 0;
    let rejectedCount = 0;
    let totalEarned = 0;

    for (const ref of this.referrals.values()) {
      if (ref.webmasterRefCode === refCode || ref.webmasterUserId === profile.userId) {
        userReferrals.unshift({
          id: ref.id,
          userName: ref.referredUserName || 'User',
          userEmailMasked: this._maskEmail(ref.referredUserEmail),
          status: ref.status,
          rewardUsd: ref.status === REFERRAL_STATUS.QUALIFIED ? ref.rewardAmountUsd : 0.0,
          milestone: ref.qualificationMilestone || (ref.status === REFERRAL_STATUS.PENDING ? 'Awaiting 1st Upload / 60s Stream' : (ref.rejectionReason || 'Expired')),
          milestoneDetails: ref.milestoneDetails,
          date: ref.qualifiedAt || ref.createdAt,
          createdAt: ref.createdAt,
        });

        if (ref.status === REFERRAL_STATUS.PENDING) pendingCount++;
        else if (ref.status === REFERRAL_STATUS.QUALIFIED) {
          qualifiedCount++;
          totalEarned += (ref.rewardAmountUsd || 0.05);
        } else if (ref.status === REFERRAL_STATUS.REJECTED || ref.status === REFERRAL_STATUS.EXPIRED) {
          rejectedCount++;
        }
      }
    }

    const totalClicks = (profile.referralProgram && profile.referralProgram.totalClicks) || this.referralClickStats.get(refCode) || 0;
    const totalInstalls = (profile.referralProgram && profile.referralProgram.totalInstalls) || (pendingCount + qualifiedCount + rejectedCount);

    return {
      referralCode: refCode,
      invitePlayUrl: `https://play.google.com/store/apps/details?id=com.teracloud.app.terabox_client&referrer=ref%3D${refCode}`,
      inviteWebUrl: `https://terabox.mywire.org/join?ref=${refCode}`,
      ratePerUserUsd: this.getRewardRate(),
      summary: {
        totalClicks,
        totalInstalls,
        pendingCount,
        qualifiedCount,
        rejectedCount,
        totalEarningsUsd: Math.round(totalEarned * 10000) / 10000,
      },
      referrals: userReferrals,
    };
  }

  getRewardRate() {
    try {
      const systemConfigStore = require('./systemConfigStore');
      return systemConfigStore.get('cpa_reward_per_install_usd', 0.0500);
    } catch (_) {
      return env.webmaster?.ratePerNewUserUsd || 0.0500;
    }
  }

  _maskEmail(email) {
    if (!email || !email.includes('@')) return 'us***@user.com';
    const [name, domain] = email.split('@');
    if (name.length <= 2) return `${name}***@${domain}`;
    return `${name.substring(0, 2)}***@${domain}`;
  }

  deleteUserReferrals(userId, email) {
    let changed = false;
    for (const [id, ref] of this.referrals.entries()) {
      if (
        ref.webmasterUserId === userId ||
        ref.referredUserId === userId ||
        (email && (ref.webmasterUserId === email || ref.referredUserEmail === email))
      ) {
        this.referrals.delete(id);
        changed = true;
      }
    }
    if (changed) this._saveToDisk();
  }

  _cleanupStaleAttributions() {
    const oneHourAgo = Date.now() - 60 * 60 * 1000;
    for (const [token, item] of this.pendingAttributions.entries()) {
      if (item.timestamp < oneHourAgo || item.isUsed) {
        this.pendingAttributions.delete(token);
      }
    }
  }

  _cleanupExpiredReferrals() {
    const now = Date.now();
    let changed = false;
    for (const ref of this.referrals.values()) {
      if (ref.status === REFERRAL_STATUS.PENDING && new Date(ref.expiresAt).getTime() < now) {
        ref.status = REFERRAL_STATUS.EXPIRED;
        ref.rejectionReason = '72-hour qualification window expired';
        changed = true;
      }
    }
    if (changed) this._saveToDisk();
  }
}

module.exports = new ReferralService();
