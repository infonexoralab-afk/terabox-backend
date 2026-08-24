const env = require('../config/env');

class WebmasterService {
  constructor() {
    this.profiles = new Map();
    this.ipViewHistory = new Map(); // IP:NodeId -> timestamp (for 24h deduplication)
    this.withdrawals = [];

    this._initSampleWebmaster();
  }

  _initSampleWebmaster() {
    this.profiles.set('TBX9942', {
      userId: 'usr_terabox_001',
      referralCode: 'TBX9942',
      currentPlan: 'videoPlays', // newUsers, videoPlays, vipReferral, paidContent
      walletBalanceUsd: 148.75,
      totalWithdrawnUsd: 420.00,
      stats: [
        { date: '2026-08-23', clicks: 4600, videoPlays: 9800, newUsers: 51, earningsUsd: 19.60 },
        { date: '2026-08-24', clicks: 5200, videoPlays: 11200, newUsers: 64, earningsUsd: 22.40 },
      ],
    });
  }

  getProfile(referralCode) {
    return this.profiles.get(referralCode) || null;
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
  }

  // Switch Plan
  switchPlan(referralCode, newPlan) {
    const profile = this.profiles.get(referralCode);
    if (profile) {
      profile.currentPlan = newPlan;
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
}

module.exports = new WebmasterService();
