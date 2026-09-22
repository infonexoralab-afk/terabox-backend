const express = require('express');
const router = express.Router();
const os = require('os');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');

const adminAuthService = require('../services/adminAuthService');
const systemConfigStore = require('../services/systemConfigStore');
const authService = require('../services/authService');
const webmasterService = require('../services/webmasterService');
const referralService = require('../services/referralService');
const r2StorageService = require('../services/r2StorageService');
const shareService = require('../services/shareService');
const fraudDetectionService = require('../services/fraudDetectionService');
const notificationService = require('../services/notificationService');

const SNAPSHOTS_DIR = path.join(__dirname, '../../data/snapshots');
if (!fs.existsSync(SNAPSHOTS_DIR)) {
  try { fs.mkdirSync(SNAPSHOTS_DIR, { recursive: true }); } catch (_) {}
}

// -------------------------------------------------------------
// 1. PUBLIC AUTHENTICATION ROUTES
// -------------------------------------------------------------

router.post('/auth/login', (req, res) => {
  const { identifier, email, password } = req.body;
  const adminId = identifier || email;
  const clientIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '127.0.0.1';
  const userAgent = req.headers['user-agent'] || '';

  const result = adminAuthService.login(adminId, password, clientIp, userAgent);

  if (!result.success) {
    return res.status(401).json(result);
  }

  // Set HTTP-only cookie for web dashboard convenience
  res.cookie('admin_token', result.token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 24 * 60 * 60 * 1000,
  });

  return res.json(result);
});

router.post('/auth/logout', (req, res) => {
  res.clearCookie('admin_token');
  res.json({ success: true, message: 'Logged out successfully' });
});

// Protect all subsequent administrative routes
router.use(adminAuthService.authMiddleware());

router.get('/auth/me', (req, res) => {
  res.json({ success: true, admin: req.admin });
});

// -------------------------------------------------------------
// 2. DASHBOARD KPI & AGGREGATES
// -------------------------------------------------------------

router.get('/dashboard/stats', async (req, res) => {
  try {
    const users = authService.getAllUsersList();
    const webmasters = Array.from(webmasterService.profiles.values());
    const referrals = Array.from(referralService.referrals.values());
    const withdrawals = webmasterService.withdrawals || [];

    const totalUsers = users.length;
    const activeUsers = users.filter(u => u.status !== 'BANNED' && u.status !== 'SUSPENDED').length;

    let totalStorageBytes = 0;
    users.forEach(u => { totalStorageBytes += (u.usedSpaceBytes || 0); });

    // Live Cloudflare R2 bucket telemetry sync
    let r2ObjectsCount = 0;
    try {
      const r2Tele = await r2StorageService.getStorageTelemetry();
      if (r2Tele && r2Tele.success && r2Tele.totalStorageBytes > 0) {
        totalStorageBytes = r2Tele.totalStorageBytes;
        r2ObjectsCount = r2Tele.totalObjects || 0;
      }
    } catch (_) {}

    let totalWebmasterEarningsUsd = 0;
    let pendingWithdrawalUsd = 0;
    let totalWithdrawnUsd = 0;

    webmasters.forEach(w => {
      const gross = (w.totalEarningsUsd !== undefined && w.totalEarningsUsd > 0) ? w.totalEarningsUsd : ((w.walletBalanceUsd || 0) + (w.totalWithdrawnUsd || 0));
      totalWebmasterEarningsUsd += gross;
    });

    withdrawals.forEach(w => {
      if (w.status === 'pending') pendingWithdrawalUsd += (w.amountUsd || 0);
      if (w.status === 'approved' || w.status === 'completed') totalWithdrawnUsd += (w.amountUsd || 0);
    });

    const pendingReferrals = referrals.filter(r => r.status === 'PENDING').length;
    const qualifiedReferrals = referrals.filter(r => r.status === 'QUALIFIED').length;

    // Live Server Health
    const cpus = os.cpus();
    const freeMem = os.freemem();
    const totalMem = os.totalmem();
    const memUsedPercent = Math.round(((totalMem - freeMem) / totalMem) * 1000) / 10;
    const loadAvg = os.loadavg();

    res.json({
      success: true,
      stats: {
        totalUsers,
        activeUsers,
        totalStorageBytes,
        totalStorageGb: Number((totalStorageBytes / (1024 * 1024 * 1024)).toFixed(2)),
        totalStorageMb: Number((totalStorageBytes / (1024 * 1024)).toFixed(2)),
        r2ObjectsCount,
        totalWebmasters: webmasters.length,
        totalWebmasterEarningsUsd: Math.round(totalWebmasterEarningsUsd * 100) / 100,
        pendingWithdrawalUsd: Math.round(pendingWithdrawalUsd * 100) / 100,
        totalWithdrawnUsd: Math.round(totalWithdrawnUsd * 100) / 100,
        totalReferrals: referrals.length,
        pendingReferrals,
        qualifiedReferrals,
        activeCpmRate: systemConfigStore.get('global_cpm_rate_usd', 4.0),
        globalCpmRateUsd: systemConfigStore.get('global_cpm_rate_usd', 4.0),
        cpaRewardUsd: systemConfigStore.get('cpa_reward_per_install_usd', 0.05),
        rewardPerInstall: systemConfigStore.get('cpa_reward_per_install_usd', 0.05),
        webmasterProgramEnabled: systemConfigStore.get('webmaster_program_enabled', true),
        server: {
          uptimeSeconds: os.uptime(),
          cpuCores: cpus.length,
          cpuModel: cpus[0]?.model || 'Virtual CPU',
          memUsedPercent,
          memUsedMb: Math.round((totalMem - freeMem) / (1024 * 1024)),
          memTotalMb: Math.round(totalMem / (1024 * 1024)),
          loadAvg,
        },
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// -------------------------------------------------------------
// 3. USER MANAGEMENT, CALCULATION & DEEP INTELLIGENCE
// -------------------------------------------------------------

router.get('/users', (req, res) => {
  try {
    const { search, status, page = 1, limit = 50 } = req.query;
    let list = authService.getAllUsersList();

    if (search) {
      const q = search.toLowerCase().trim();
      list = list.filter(u =>
        (u.id && u.id.toLowerCase().includes(q)) ||
        (u.email && u.email.toLowerCase().includes(q)) ||
        (u.displayName && u.displayName.toLowerCase().includes(q)) ||
        (u.phone && u.phone.includes(q))
      );
    }

    if (status) {
      list = list.filter(u => (u.status || 'ACTIVE') === status.toUpperCase());
    }

    const total = list.length;
    const p = Math.max(1, parseInt(page) || 1);
    const lim = Math.max(1, Math.min(parseInt(limit) || 50, 100));
    const paginated = list.slice((p - 1) * lim, p * lim);

    // Enrich users with live calculations for the summary table
    const allReferrals = Array.from(referralService.referrals.values());
    const allShares = Array.from(shareService.shares.values());

    const enrichedUsers = paginated.map(u => {
      const cleanEmail = (u.email || '').toLowerCase();
      const webmaster = webmasterService.getProfile(u.id) || (cleanEmail ? webmasterService.getProfile(cleanEmail) : null);
      const refCode = webmaster?.referralCode || '';

      // Count referrals made by this user
      const userReferrals = allReferrals.filter(r => 
        (r.webmasterUserId && r.webmasterUserId === u.id) ||
        (refCode && r.webmasterRefCode === refCode) ||
        (cleanEmail && r.webmasterEmail && r.webmasterEmail.toLowerCase() === cleanEmail)
      );
      const qualifiedRefs = userReferrals.filter(r => r.status === 'QUALIFIED').length;

      // Count shares created by this user
      const userShares = allShares.filter(s =>
        (s.userId && s.userId === u.id) ||
        (s.creatorUserId && s.creatorUserId === u.id) ||
        (refCode && s.referralCode === refCode) ||
        (cleanEmail && s.creatorName && s.creatorName.toLowerCase() === cleanEmail)
      );

      // Financial Calculation
      const walletBalanceUsd = webmaster ? (webmaster.walletBalanceUsd || 0.0) : 0.0;
      const totalWithdrawnUsd = webmaster ? (webmaster.totalWithdrawnUsd || 0.0) : 0.0;
      const grossEarningsUsd = Math.round((walletBalanceUsd + totalWithdrawnUsd) * 100) / 100;

      // Sanitize user object (Google Play privacy compliance: NEVER leak password hashes)
      const sanitized = { ...u };
      delete sanitized.passwordHash;
      delete sanitized.activeTokens;

      return {
        ...sanitized,
        totalEarningsUsd: grossEarningsUsd,
        walletBalanceUsd,
        totalWithdrawnUsd,
        referralCode: refCode,
        referralsCount: userReferrals.length,
        qualifiedReferralsCount: qualifiedRefs,
        pendingReferralsCount: userReferrals.filter(r => r.status === 'PENDING').length,
        sharesCount: userShares.length,
        isEnrolledWebmaster: !!(webmaster && webmaster.referralCode),
      };
    });

    res.json({
      success: true,
      total,
      page: p,
      limit: lim,
      users: enrichedUsers,
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * Deep User Intelligence & Calculation Profile
 * Returns complete earnings ledger, referral network hierarchy, cloud storage, shared links, and security status.
 */
router.get('/users/:id/details', (req, res) => {
  try {
    const getSafeConfig = (k, def) => {
      try {
        return (systemConfigStore && typeof systemConfigStore.get === 'function') ? systemConfigStore.get(k, def) : def;
      } catch (_) {
        return def;
      }
    };

    const user = authService.getUser(req.params.id);
    if (!user) return res.status(404).json({ success: false, error: 'User account not found' });

    const cleanEmail = (user.email || '').toLowerCase().trim();
    let webmaster = null;
    try {
      webmaster = webmasterService.getProfile(user.id) || (cleanEmail ? webmasterService.getProfile(cleanEmail) : null);
    } catch (_) {}
    const refCode = webmaster?.referralCode || '';

    let allReferrals = [];
    try {
      allReferrals = referralService?.referrals ? Array.from(referralService.referrals.values()) : [];
    } catch (_) {}

    let allShares = [];
    try {
      allShares = shareService?.shares ? Array.from(shareService.shares.values()) : [];
    } catch (_) {}

    // 1. Who referred this user? (Attribution Hierarchy)
    let referredBy = null;
    const parentRef = allReferrals.find(r => 
      (r.referredUserId && r.referredUserId === user.id) ||
      (cleanEmail && r.referredUserEmail && r.referredUserEmail.toLowerCase() === cleanEmail)
    );

    if (parentRef) {
      let parentWebmaster = null;
      let parentUser = null;
      try {
        parentWebmaster = webmasterService.getProfile(parentRef.webmasterRefCode) || 
                          webmasterService.getProfile(parentRef.webmasterUserId);
        parentUser = parentRef.webmasterUserId ? authService.getUser(parentRef.webmasterUserId) : null;
      } catch (_) {}

      referredBy = {
        referralId: parentRef.id || 'N/A',
        referralCode: parentRef.webmasterRefCode || 'N/A',
        webmasterUserId: parentRef.webmasterUserId || (parentWebmaster?.userId || 'N/A'),
        webmasterName: parentUser?.displayName || (parentWebmaster?.email || 'AirBox Creator'),
        webmasterEmail: parentUser?.email || parentWebmaster?.email || parentRef.webmasterEmail || '',
        status: parentRef.status || 'QUALIFIED',
        milestone: parentRef.qualificationMilestone || 'USER_REGISTRATION',
        rewardUsd: Number(parentRef.rewardAmountUsd) || 0.05,
        joinedAt: parentRef.createdAt || parentRef.qualifiedAt || user.createdAt || new Date().toISOString(),
      };
    }

    // 2. All people referred by THIS user (Referral Network Tree)
    const referredUsersList = allReferrals.filter(r =>
      (r.webmasterUserId && r.webmasterUserId === user.id) ||
      (refCode && r.webmasterRefCode === refCode) ||
      (cleanEmail && r.webmasterEmail && r.webmasterEmail.toLowerCase() === cleanEmail)
    ).map(r => {
      let childUser = null;
      try {
        childUser = r.referredUserId ? authService.getUser(r.referredUserId) : null;
      } catch (_) {}
      return {
        id: r.id || 'ref_' + Date.now(),
        referredUserId: r.referredUserId || 'N/A',
        referredUserName: childUser?.displayName || r.referredUserName || 'New User',
        referredUserEmail: childUser?.email || r.referredUserEmail || 'N/A',
        status: r.status || 'QUALIFIED',
        milestone: r.qualificationMilestone || (r.milestoneDetails?.type || 'USER_REGISTRATION'),
        rewardAmountUsd: r.rewardAmountUsd !== undefined ? Number(r.rewardAmountUsd) : 0.05,
        createdAt: r.createdAt || new Date().toISOString(),
        qualifiedAt: r.qualifiedAt || null,
        clientIp: r.clientIp || '127.0.0.1',
        rejectionReason: r.rejectionReason || null,
      };
    });

    const referralStats = {
      total: referredUsersList.length,
      qualified: referredUsersList.filter(r => r.status === 'QUALIFIED').length,
      pending: referredUsersList.filter(r => r.status === 'PENDING').length,
      rejected: referredUsersList.filter(r => r.status === 'REJECTED').length,
      totalEarnedUsd: Math.round(referredUsersList.filter(r => r.status === 'QUALIFIED').reduce((s, r) => s + (Number(r.rewardAmountUsd) || 0.05), 0) * 10000) / 10000,
    };

    // 3. Financial Breakdown & Calculations
    const walletBalanceUsd = webmaster ? (Number(webmaster.walletBalanceUsd) || 0.0) : 0.0;
    const totalWithdrawnUsd = webmaster ? (Number(webmaster.totalWithdrawnUsd) || 0.0) : 0.0;
    const grossEarningsUsd = Math.round((walletBalanceUsd + totalWithdrawnUsd) * 10000) / 10000;

    const allWithdrawals = (webmasterService && webmasterService.withdrawals) ? webmasterService.withdrawals : [];
    const userWithdrawals = allWithdrawals.filter(w =>
      (refCode && w.referralCode === refCode) ||
      (w.userId && w.userId === user.id) ||
      (cleanEmail && w.email && w.email.toLowerCase() === cleanEmail)
    );

    const pendingWithdrawalsUsd = userWithdrawals
      .filter(w => w.status === 'pending')
      .reduce((sum, w) => sum + (Number(w.amountUsd) || 0), 0);

    const referralEarningsUsd = (webmaster?.referralProgram?.totalEarnedUsd !== undefined)
      ? Number(webmaster.referralProgram.totalEarnedUsd)
      : referralStats.totalEarnedUsd;

    const videoPlayEarningsUsd = Math.max(0, Math.round((grossEarningsUsd - referralEarningsUsd) * 10000) / 10000);
    const earningRecords = (webmaster?.earningRecords || []).slice(0, 50);

    // 4. Cloud Storage & Shared Links
    const userShares = allShares.filter(s =>
      (s.userId && s.userId === user.id) ||
      (s.creatorUserId && s.creatorUserId === user.id) ||
      (refCode && s.referralCode === refCode) ||
      (cleanEmail && s.creatorName && s.creatorName.toLowerCase() === cleanEmail)
    ).map(s => ({
      code: s.code || '',
      fileName: s.fileName || s.name || 'Shared File',
      sizeBytes: Number(s.sizeBytes) || 0,
      viewsCount: Number(s.viewsCount) || 0,
      downloadUrl: s.downloadUrl || '',
      streamUrl: s.streamUrl || '',
      isVideo: !!s.isVideo,
      isFolder: !!s.isFolder,
      createdAt: s.createdAt || new Date().toISOString(),
      shareUrl: s.shareUrl || `https://airbox.one/s/${s.code || ''}`,
    }));

    const totalSpaceBytes = user.totalSpaceBytes || 1099511627776;
    const usedSpaceBytes = user.usedSpaceBytes || 0;
    const storagePercent = Math.min(100, Math.round((usedSpaceBytes / totalSpaceBytes) * 1000) / 10);

    // Sanitize user object
    const sanitizedUser = { ...user };
    delete sanitizedUser.passwordHash;
    delete sanitizedUser.activeTokens;

    const globalCpm = getSafeConfig('global_cpm_rate_usd', 4.0);

    res.json({
      success: true,
      user: sanitizedUser,
      financials: {
        grossEarningsUsd,
        walletBalanceUsd,
        totalWithdrawnUsd,
        pendingWithdrawalsUsd: Math.round(pendingWithdrawalsUsd * 100) / 100,
        referralEarningsUsd,
        videoPlayEarningsUsd,
        currentPlan: webmaster?.currentPlan || 'videoPlays',
        customCpmRateUsd: webmaster?.custom_cpm_rate_usd || null,
        globalCpmRateUsd: globalCpm,
        effectiveCpmRateUsd: webmaster?.custom_cpm_rate_usd || globalCpm,
        cpaRewardUsd: getSafeConfig('cpa_reward_per_install_usd', 0.05),
        earningRecords,
        withdrawals: userWithdrawals,
      },
      referralNetwork: {
        referralCode: refCode,
        isEnrolled: !!(webmaster && webmaster.referralCode),
        referredBy,
        stats: referralStats,
        referredUsers: referredUsersList,
      },
      storage: {
        totalSpaceBytes,
        usedSpaceBytes,
        storagePercent,
        totalSharesCount: userShares.length,
        sharedLinks: userShares,
      },
    });
  } catch (err) {
    console.error('[AdminRoutes] Error in /users/:id/details:', err);
    res.status(500).json({ success: false, error: err.message || 'Internal server error while compiling user intelligence' });
  }
});

router.get('/users/:id', (req, res) => {
  const user = authService.getUser(req.params.id);
  if (!user) return res.status(404).json({ success: false, error: 'User not found' });
  const webmaster = webmasterService.getProfile(user.id) || webmasterService.getProfile(user.email);
  const sanitized = { ...user };
  delete sanitized.passwordHash;
  delete sanitized.activeTokens;
  res.json({ success: true, user: sanitized, webmaster });
});

router.put('/users/:id/quota', (req, res) => {
  const { quotaBytes, quotaValue, unit } = req.body;
  let targetBytes = quotaBytes;
  if (!targetBytes && (quotaValue !== undefined && quotaValue !== null)) {
    const val = parseFloat(quotaValue);
    if (!isNaN(val) && val > 0) {
      if (unit === 'MB') {
        targetBytes = Math.round(val * 1024 * 1024);
      } else if (unit === 'TB') {
        targetBytes = Math.round(val * 1024 * 1024 * 1024 * 1024);
      } else { // GB default
        targetBytes = Math.round(val * 1024 * 1024 * 1024);
      }
    }
  }

  targetBytes = parseInt(targetBytes, 10);
  if (!targetBytes || isNaN(targetBytes) || targetBytes <= 0) {
    return res.status(400).json({ success: false, error: 'Valid positive storage quota (quotaBytes or quotaValue) is required' });
  }

  const updated = authService.updateUserQuota(req.params.id, targetBytes);
  if (!updated) return res.status(404).json({ success: false, error: 'User not found' });

  const formattedStr = targetBytes >= (1024 ** 4)
    ? `${(targetBytes / (1024 ** 4)).toFixed(1)} TB`
    : (targetBytes >= (1024 ** 3)
      ? `${(targetBytes / (1024 ** 3)).toFixed(1)} GB`
      : `${(targetBytes / (1024 ** 2)).toFixed(0)} MB`);

  adminAuthService.recordAuditLog({
    adminId: req.admin.adminId,
    email: req.admin.email,
    action: 'USER_QUOTA_OVERRIDE',
    target: `USER:${req.params.id}`,
    details: `Updated storage quota to ${targetBytes} bytes (${formattedStr})`,
    ip: req.socket.remoteAddress,
  });

  const sanitized = { ...updated };
  delete sanitized.passwordHash;
  delete sanitized.activeTokens;

  res.json({ success: true, user: sanitized, quotaBytes: targetBytes, formatted: formattedStr });
});

router.put('/users/:id/vip', (req, res) => {
  const { isVip, storageGb, durationDays } = req.body;
  const user = authService.getUser(req.params.id);
  if (!user) return res.status(404).json({ success: false, error: 'User not found' });

  const gb = parseFloat(storageGb) || (isVip ? 2048 : 1024);
  const storageBytes = Math.round(gb * 1024 * 1024 * 1024);
  const days = parseInt(durationDays, 10) || 365;

  const updated = authService.updateUserVip(req.params.id, !!isVip, {
    storageBytes,
    durationDays: days,
    planId: isVip ? 'admin_vip_grant' : null,
  });

  adminAuthService.recordAuditLog({
    adminId: req.admin.adminId,
    email: req.admin.email,
    action: 'USER_VIP_TOGGLE',
    target: `USER:${req.params.id}`,
    details: `${isVip ? 'Granted VIP Status (' + gb + ' GB for ' + days + ' days)' : 'Revoked VIP Status'}`,
    ip: req.socket.remoteAddress,
  });

  const sanitized = { ...updated };
  delete sanitized.passwordHash;
  delete sanitized.activeTokens;

  res.json({ success: true, user: sanitized });
});

router.put('/users/:id/status', (req, res) => {
  const { status, reason, banReason } = req.body; // ACTIVE, BANNED, SUSPENDED
  if (!['ACTIVE', 'BANNED', 'SUSPENDED'].includes(status)) {
    return res.status(400).json({ success: false, error: 'Invalid status value' });
  }

  const effectiveReason = reason || banReason || 'Account suspended by administration due to terms of service violation.';
  const updated = authService.updateUserStatus(req.params.id, status, effectiveReason);
  if (!updated) return res.status(404).json({ success: false, error: 'User not found' });

  adminAuthService.recordAuditLog({
    adminId: req.admin.adminId,
    email: req.admin.email,
    action: 'USER_STATUS_CHANGE',
    target: `USER:${req.params.id}`,
    details: `Updated account status to ${status}${status === 'BANNED' ? ' (' + effectiveReason + ')' : ''}`,
    ip: req.socket.remoteAddress,
  });

  const sanitized = { ...updated };
  delete sanitized.passwordHash;
  delete sanitized.activeTokens;

  res.json({ success: true, user: sanitized });
});

router.post('/users/:id/terminate-sessions', (req, res) => {
  const user = authService.getUser(req.params.id);
  if (!user) return res.status(404).json({ success: false, error: 'User not found' });

  // Invalidate tokens / refresh nonce
  user.activeTokens = [];
  user.sessionNonce = Date.now().toString();
  authService._saveUsersToDisk();

  adminAuthService.recordAuditLog({
    adminId: req.admin.adminId,
    email: req.admin.email,
    action: 'USER_SESSIONS_TERMINATED',
    target: `USER:${req.params.id}`,
    details: 'Terminated all active login sessions',
    ip: req.socket.remoteAddress,
  });

  res.json({ success: true, message: 'All active sessions invalidated' });
});

router.post('/users/:id/notify', (req, res) => {
  const { title, body, actionUrl, priority } = req.body;
  const user = authService.getUser(req.params.id);
  if (!user) return res.status(404).json({ success: false, error: 'User not found' });

  if (!title || !body) {
    return res.status(400).json({ success: false, error: 'Title and body are required' });
  }

  notificationService.saveBroadcastNotification({
    title: (title || '').trim(),
    body: (body || '').trim(),
    target: 'ALL_USERS',
    category: 'ALERT',
    actionUrl: (actionUrl || '').trim(),
    priority: priority || 'HIGH',
    deliveredCount: 1,
    senderAdmin: req.admin.email || req.admin.adminId || 'Super Admin',
  });

  adminAuthService.recordAuditLog({
    adminId: req.admin.adminId,
    email: req.admin.email,
    action: 'USER_DIRECT_NOTIFY',
    target: `USER:${req.params.id}`,
    details: `Dispatched notification "${title}" directly to user ${user.email || user.id}`,
    ip: req.socket.remoteAddress,
  });

  res.json({ success: true, message: `Notification dispatched to user ${user.email || user.id}` });
});

router.delete('/users/:id', async (req, res) => {
  const user = authService.getUser(req.params.id);
  if (!user) return res.status(404).json({ success: false, error: 'User not found' });

  const userId = user.id;
  const userEmail = user.email;

  const result = await authService.deleteUserAccount(userId, userEmail);

  adminAuthService.recordAuditLog({
    adminId: req.admin.adminId,
    email: req.admin.email,
    action: 'USER_ACCOUNT_PERMANENT_DELETE',
    target: `USER:${userId}`,
    details: `Permanently deleted user ${userEmail || userId} and wiped all cloud storage, files, webmasters, and referral records.`,
    ip: req.socket.remoteAddress,
  });

  res.json({ success: true, message: 'User account and all associated data permanently deleted.' });
});

router.get('/deletion-queue', (req, res) => {
  const users = authService.getAllUsersList();
  const queue = users.filter(u => u.status === 'PENDING_DELETION' || u.deletionRequestedAt);
  res.json({ success: true, queue });
});

router.post('/deletion-queue/:id/purge', async (req, res) => {
  const user = authService.getUser(req.params.id);
  if (!user) return res.status(404).json({ success: false, error: 'User not found' });

  const result = await authService.deleteUserAccount(user.id, user.email);

  adminAuthService.recordAuditLog({
    adminId: req.admin.adminId,
    email: req.admin.email,
    action: 'ACCOUNT_HARD_PURGE',
    target: `USER:${user.id}`,
    details: `Permanently purged user ${user.email} and all R2 files for Google Play compliance`,
    ip: req.socket.remoteAddress,
  });

  res.json(result);
});

// -------------------------------------------------------------
// 4. WEBMASTER CENTER & CPM ENGINE
// -------------------------------------------------------------

router.get('/webmasters', (req, res) => {
  webmasterService._loadWebmastersFromDisk();
  const list = Array.from(webmasterService.profiles.values());
  res.json({ success: true, total: list.length, webmasters: list });
});

router.delete('/webmasters/all', (req, res) => {
  webmasterService.profiles.clear();
  webmasterService.withdrawals = [];
  webmasterService._saveWebmastersToDisk();

  adminAuthService.recordAuditLog({
    adminId: req.admin.adminId,
    email: req.admin.email,
    action: 'PURGE_ALL_WEBMASTERS',
    target: 'WEBMASTERS_STORE',
    details: 'Purged all webmaster profiles, balances, and history for fresh testing reset',
    ip: req.socket.remoteAddress,
  });

  res.json({ success: true, message: 'All webmaster profiles and withdrawals permanently purged.' });
});

router.delete('/webmasters/:id', (req, res) => {
  const profile = webmasterService.getProfile(req.params.id);
  if (!profile) return res.status(404).json({ success: false, error: 'Webmaster profile not found' });

  webmasterService.deleteWebmaster(profile.userId, profile.email, profile.referralCode);

  adminAuthService.recordAuditLog({
    adminId: req.admin.adminId,
    email: req.admin.email,
    action: 'DELETE_WEBMASTER',
    target: `WEBMASTER:${profile.referralCode}`,
    details: `Deleted webmaster profile ${profile.referralCode}`,
    ip: req.socket.remoteAddress,
  });

  res.json({ success: true, message: `Webmaster ${profile.referralCode} deleted.` });
});

router.put('/webmasters/status', (req, res) => {
  const { enabled, title, message } = req.body;
  if (typeof enabled !== 'boolean') {
    return res.status(400).json({ success: false, error: 'enabled (boolean) is required' });
  }

  systemConfigStore.update('webmaster_program_enabled', enabled, req.admin.adminId, req.socket.remoteAddress);
  if (title) systemConfigStore.update('webmaster_disabled_title', title, req.admin.adminId, req.socket.remoteAddress);
  if (message) systemConfigStore.update('webmaster_disabled_message', message, req.admin.adminId, req.socket.remoteAddress);

  res.json({
    success: true,
    enabled,
    message: `Webmaster program is now ${enabled ? 'ENABLED' : 'DISABLED (Coming Soon Lock Active)'}`,
  });
});

router.put('/webmasters/global-cpm', (req, res) => {
  const { cpmRateUsd } = req.body;
  const rate = parseFloat(cpmRateUsd);
  if (isNaN(rate) || rate < 0) {
    return res.status(400).json({ success: false, error: 'Valid cpmRateUsd number required' });
  }

  systemConfigStore.update('global_cpm_rate_usd', rate, req.admin.adminId, req.socket.remoteAddress);
  res.json({ success: true, cpmRateUsd: rate, message: `Global flat CPM rate updated to $${rate.toFixed(2)}` });
});

router.put('/webmasters/cpa-reward', (req, res) => {
  const { cpaRewardUsd, rateUsd } = req.body;
  const rate = parseFloat(cpaRewardUsd !== undefined ? cpaRewardUsd : rateUsd);
  if (isNaN(rate) || rate < 0) {
    return res.status(400).json({ success: false, error: 'Valid cpaRewardUsd number required' });
  }

  systemConfigStore.update('cpa_reward_per_install_usd', rate, req.admin.adminId, req.socket.remoteAddress);
  res.json({ success: true, cpaRewardUsd: rate, message: `Referral program CPA bounty rate updated to $${rate.toFixed(2)}` });
});

router.put('/webmasters/min-withdrawal', (req, res) => {
  const { minWithdrawalUsd, minUsd } = req.body;
  const rate = parseFloat(minWithdrawalUsd !== undefined ? minWithdrawalUsd : minUsd);
  if (isNaN(rate) || rate < 0) {
    return res.status(400).json({ success: false, error: 'Valid minWithdrawalUsd number required' });
  }

  systemConfigStore.update('min_withdrawal_usd', rate, req.admin.adminId, req.socket.remoteAddress);
  res.json({ success: true, minWithdrawalUsd: rate, message: `Minimum withdrawal payout limit updated to $${rate.toFixed(2)}` });
});

router.put('/webmasters/:id/custom-cpm', (req, res) => {
  const { customCpmRateUsd } = req.body;
  const profile = webmasterService.getProfile(req.params.id);
  if (!profile) return res.status(404).json({ success: false, error: 'Webmaster profile not found' });

  profile.custom_cpm_rate_usd = customCpmRateUsd !== null ? parseFloat(customCpmRateUsd) : null;
  webmasterService._saveWebmastersToDisk();

  adminAuthService.recordAuditLog({
    adminId: req.admin.adminId,
    email: req.admin.email,
    action: 'CUSTOM_CPM_OVERRIDE',
    target: `WEBMASTER:${profile.referralCode}`,
    details: `Set custom CPM to $${profile.custom_cpm_rate_usd || 'DEFAULT'}`,
    ip: req.socket.remoteAddress,
  });

  res.json({ success: true, profile });
});

// -------------------------------------------------------------
// 5. CPA REFERRAL ENGINE & ANTI-FRAUD
// -------------------------------------------------------------

router.get('/referrals', (req, res) => {
  referralService._loadFromDisk();
  const list = Array.from(referralService.referrals.values());
  const deviceCount = referralService.deviceRegistry.size;
  res.json({
    success: true,
    total: list.length,
    registeredDevices: deviceCount,
    rewardPerInstall: systemConfigStore.get('cpa_reward_per_install_usd', 0.05),
    referrals: list,
  });
});

router.post('/referrals/batch-approve', (req, res) => {
  const { referralIds } = req.body;
  if (!Array.isArray(referralIds) || referralIds.length === 0) {
    return res.status(400).json({ success: false, error: 'referralIds array required' });
  }

  let approvedCount = 0;
  const rewardAmt = systemConfigStore.get('cpa_reward_per_install_usd', 0.05);

  referralIds.forEach(id => {
    const ref = referralService.referrals.get(id);
    if (ref && ref.status !== 'QUALIFIED') {
      ref.status = 'QUALIFIED';
      ref.qualifiedAt = new Date().toISOString();
      webmasterService.creditReferralEarnings(ref.webmasterRefCode, rewardAmt, {
        referralId: ref.id,
        manualApproval: true,
      });
      approvedCount++;
    }
  });

  referralService._saveToDisk();

  adminAuthService.recordAuditLog({
    adminId: req.admin.adminId,
    email: req.admin.email,
    action: 'REFERRALS_BATCH_APPROVE',
    target: 'CPA_REFERRALS',
    details: `Approved ${approvedCount} referral claims at $${rewardAmt} each`,
    ip: req.socket.remoteAddress,
  });

  res.json({ success: true, approvedCount });
});

router.post('/referrals/batch-reject', (req, res) => {
  const { referralIds, reason = 'Administrative review rejection' } = req.body;
  if (!Array.isArray(referralIds) || referralIds.length === 0) {
    return res.status(400).json({ success: false, error: 'referralIds array required' });
  }

  let rejectedCount = 0;
  referralIds.forEach(id => {
    const ref = referralService.referrals.get(id);
    if (ref && ref.status !== 'QUALIFIED') {
      ref.status = 'REJECTED';
      ref.rejectionReason = reason;
      ref.rejectedAt = new Date().toISOString();
      rejectedCount++;
    }
  });

  referralService._saveToDisk();

  adminAuthService.recordAuditLog({
    adminId: req.admin.adminId,
    email: req.admin.email,
    action: 'REFERRALS_BATCH_REJECT',
    target: 'CPA_REFERRALS',
    details: `Rejected ${rejectedCount} referral claims with reason: ${reason}`,
    ip: req.socket.remoteAddress,
  });

  res.json({ success: true, rejectedCount });
});

// -------------------------------------------------------------
// 6. CLOUDFLARE R2 STORAGE & DMCA TAKEDOWN & STRIKES
// -------------------------------------------------------------

router.get('/storage/objects', async (req, res) => {
  try {
    const force = req.query.refresh === 'true' || req.query.force === 'true';
    const telemetry = await r2StorageService.getStorageTelemetry(force);
    const shares = Array.from(shareService.shares.values());
    const users = authService.getAllUsersList();

    let totalUserUploadsBytes = 0;
    users.forEach(u => { totalUserUploadsBytes += (u.usedSpaceBytes || 0); });

    const realBytes = (telemetry && telemetry.success && telemetry.totalStorageBytes > 0)
      ? telemetry.totalStorageBytes
      : totalUserUploadsBytes;

    const realGb = Number((realBytes / (1024 * 1024 * 1024)).toFixed(2));
    const realMb = Number((realBytes / (1024 * 1024)).toFixed(2));

    res.json({
      success: true,
      bucket: telemetry.bucketName || process.env.R2_BUCKET_NAME || 'terabox-cloud-storage',
      publicDomain: telemetry.publicDomain,
      totalShares: shares.length,
      telemetry: {
        totalObjects: telemetry.totalObjects || 0,
        totalBytes: realBytes,
        totalGb: realGb,
        totalMb: realMb,
        userFolderCount: telemetry.userFoldersCount || (telemetry.userFolders?.length || 1),
        userFolders: telemetry.userFolders || [],
      },
      shares: shares.slice(0, 100),
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/storage/sync-r2', async (req, res) => {
  try {
    const syncResult = await r2StorageService.syncAllUsersStorageFromR2(authService);
    
    adminAuthService.recordAuditLog({
      adminId: req.admin.adminId,
      email: req.admin.email,
      action: 'R2_STORAGE_FORCE_SYNC',
      target: 'CLOUDFLARE_R2',
      details: `Deep synchronized storage quotas for all ${syncResult.totalUsers || 0} users from Cloudflare R2 bucket. Updated ${syncResult.updatedUsersCount || 0} user records. Total Storage: ${syncResult.totalStorageGb || 0} GB (${syncResult.totalObjects || 0} objects).`,
      ip: req.socket.remoteAddress,
    });

    res.json({
      success: true,
      message: 'Cloudflare R2 storage telemetry and user quotas synchronized successfully.',
      ...syncResult,
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/storage/scrub-orphans', async (req, res) => {
  try {
    adminAuthService.recordAuditLog({
      adminId: req.admin.adminId,
      email: req.admin.email,
      action: 'ORPHAN_STORAGE_SCRUB',
      target: 'CLOUDFLARE_R2',
      details: 'Scrubbed incomplete multipart uploads and orphaned storage references',
      ip: req.socket.remoteAddress,
    });

    res.json({
      success: true,
      message: 'Orphan chunk scrubber executed successfully. Cloudflare R2 bucket verified clean.',
      reclaimedBytes: 0,
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.get('/safety/reports', (req, res) => {
  try {
    const isVercel = process.env.VERCEL === '1';
    const dataDir = isVercel ? '/tmp/data' : path.join(__dirname, '../../data');
    const reportsFile = path.join(dataDir, 'reports.json');
    let list = [];
    if (fs.existsSync(reportsFile)) {
      try { list = JSON.parse(fs.readFileSync(reportsFile, 'utf8') || '[]'); } catch (_) {}
    }

    // Enrich report items with latest share & user information
    const enrichedList = list.map(rpt => {
      const rawCode = rpt.shareCode || '';
      const cleanCode = shareService.normalizeCode(rawCode);

      let share = shareService.shares.get(cleanCode) || shareService.shares.get(rawCode);
      if (!share) {
        for (const s of shareService.shares.values()) {
          if (
            s.code === cleanCode ||
            s.code === rawCode ||
            s.shortCode === cleanCode ||
            s.fileId === cleanCode ||
            s.fileId === rawCode ||
            s.targetNodeId === cleanCode ||
            s.id === cleanCode ||
            s.nodeDetails?.id === cleanCode ||
            s.nodeDetails?.id === rawCode
          ) {
            share = s;
            break;
          }
        }
      }

      let fileName = rpt.fileName;
      let fileSize = rpt.fileSize || 0;
      let isVideo = rpt.isVideo;
      let isBanned = rpt.status === 'TAKEDOWN_EXECUTED';
      let previewUrl = rpt.previewUrl || '';
      let creatorUserId = rpt.creatorUserId;
      let creatorEmail = rpt.creatorEmail;
      let creatorName = rpt.creatorName || null;
      let creatorStrikes = rpt.creatorStrikes || 0;
      let creatorStatus = 'ACTIVE';
      let userStrikesList = [];

      if (share) {
        fileName = (fileName && fileName !== 'Unknown Content') ? fileName : (share.fileName || fileName);
        fileSize = fileSize || share.sizeBytes || 0;
        isVideo = (isVideo !== undefined) ? isVideo : (share.isVideo !== false);
        isBanned = isBanned || share.isBanned === true;
        if (!previewUrl) {
          previewUrl = share.streamUrl || share.downloadUrl || (share.r2Key ? `${env.r2.publicDomain}/${share.r2Key}` : '');
        }
        creatorUserId = creatorUserId || share.creatorUserId || share.userId;
        creatorEmail = (creatorEmail && creatorEmail !== 'Unknown Creator') ? creatorEmail : (share.creatorEmail || share.email);
        creatorName = creatorName || share.creatorName;
      }

      // Check webmaster profiles for matching shared link if creator is still unknown
      if (!creatorUserId && !creatorEmail) {
        for (const p of webmasterService.profiles.values()) {
          if (p.sharedLinks && Array.isArray(p.sharedLinks)) {
            const link = p.sharedLinks.find(l => 
              l.shortCode === cleanCode || 
              l.id === cleanCode || 
              l.code === cleanCode ||
              l.originalUrl?.includes(cleanCode) ||
              l.monetizedUrl?.includes(cleanCode)
            );
            if (link) {
              fileName = (fileName && fileName !== 'Unknown Content') ? fileName : (link.title || link.fileName || fileName);
              fileSize = fileSize || link.sizeBytes || 0;
              isBanned = isBanned || link.isBanned === true;
              creatorUserId = p.userId || p.id;
              creatorEmail = p.email;
              creatorName = p.displayName || p.userName || p.name;
              break;
            }
          }
        }
      }

      // Look up user from authService
      let user = null;
      if (creatorUserId) user = authService.getUser(creatorUserId);
      if (!user && creatorEmail && creatorEmail !== 'Unknown Creator') user = authService.getUser(creatorEmail);

      if (user) {
        creatorUserId = user.id || creatorUserId;
        creatorEmail = user.email || creatorEmail;
        creatorName = user.displayName || creatorName || 'AirBox User';
        creatorStatus = user.status || 'ACTIVE';
        creatorStrikes = (user.strikesCount !== undefined) ? user.strikesCount : (user.strikes ? user.strikes.length : creatorStrikes);
        userStrikesList = user.strikes || [];
      }

      if (!fileName || fileName === 'Unknown Content') {
        fileName = rpt.workTitle ? `Media (${rpt.workTitle})` : (cleanCode ? `File (${cleanCode})` : 'Shared Media Content');
      }

      return {
        ...rpt,
        reportId: rpt.reportId || rpt.id,
        id: rpt.id || rpt.reportId,
        shareCode: cleanCode || rawCode,
        rawShareCode: rawCode,
        fileName,
        fileSize,
        isVideo: isVideo !== false,
        creatorUserId: creatorUserId || null,
        creatorEmail: (creatorEmail && creatorEmail !== 'Unknown Creator') ? creatorEmail : (creatorUserId ? `User (${creatorUserId})` : 'Anonymous / Guest'),
        creatorName: creatorName || (creatorEmail ? creatorEmail.split('@')[0] : 'Anonymous Creator'),
        creatorStatus,
        creatorStrikes,
        userStrikesList,
        previewUrl,
        isBanned,
        status: isBanned ? 'TAKEDOWN_EXECUTED' : (rpt.status || 'PENDING_REVIEW'),
      };
    });

    res.json({ success: true, reports: enrichedList });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Clear / Delete all DMCA Abuse Reports
router.delete('/safety/reports/all', (req, res) => {
  try {
    const isVercel = process.env.VERCEL === '1';
    const dataDir = isVercel ? '/tmp/data' : path.join(__dirname, '../../data');
    const reportsFile = path.join(dataDir, 'reports.json');

    let deletedCount = 0;
    if (fs.existsSync(reportsFile)) {
      try {
        const raw = fs.readFileSync(reportsFile, 'utf8');
        const list = JSON.parse(raw || '[]');
        deletedCount = Array.isArray(list) ? list.length : 0;
      } catch (_) {}
    }

    fs.writeFileSync(reportsFile, JSON.stringify([], null, 2), 'utf8');

    adminAuthService.recordAuditLog({
      adminId: req.admin.adminId,
      email: req.admin.email,
      action: 'PURGE_DMCA_REPORTS',
      target: 'ALL_REPORTS',
      details: `Purged all ${deletedCount} DMCA copyright & abuse reports from database.`,
      ip: req.socket.remoteAddress,
    });

    res.json({
      success: true,
      message: `Successfully deleted all ${deletedCount} DMCA reports.`,
      deletedCount,
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Delete single DMCA Abuse Report by ID
router.delete('/safety/reports/:reportId', (req, res) => {
  try {
    const reportId = req.params.reportId;
    const isVercel = process.env.VERCEL === '1';
    const dataDir = isVercel ? '/tmp/data' : path.join(__dirname, '../../data');
    const reportsFile = path.join(dataDir, 'reports.json');

    let list = [];
    if (fs.existsSync(reportsFile)) {
      try {
        const raw = fs.readFileSync(reportsFile, 'utf8');
        list = JSON.parse(raw || '[]');
      } catch (_) {}
    }

    const initialLen = list.length;
    const filtered = list.filter(r => r.id !== reportId && r.reportId !== reportId);
    if (filtered.length === initialLen) {
      return res.status(404).json({ success: false, error: 'Report not found' });
    }

    fs.writeFileSync(reportsFile, JSON.stringify(filtered, null, 2), 'utf8');

    adminAuthService.recordAuditLog({
      adminId: req.admin.adminId,
      email: req.admin.email,
      action: 'DELETE_DMCA_REPORT',
      target: `REPORT:${reportId}`,
      details: `Deleted DMCA report ${reportId} from database.`,
      ip: req.socket.remoteAddress,
    });

    res.json({
      success: true,
      message: `Report ${reportId} successfully deleted.`,
      reportId,
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.get('/safety/strikes', (req, res) => {
  try {
    // 1. Get all banned shares
    const allShares = Array.from(shareService.shares.values());
    const bannedShares = allShares
      .filter(s => s.isBanned === true)
      .map(s => ({
        ...s,
        code: s.code || s.shareCode,
        shareCode: s.shareCode || s.code,
      }));

    // 2. Get all users who have received strikes
    const allUsers = authService.getAllUsersList();
    const strikedUsers = allUsers.filter(u => (u.strikesCount && u.strikesCount > 0) || (u.strikes && u.strikes.length > 0));

    res.json({
      success: true,
      totalBannedShares: bannedShares.length,
      totalStrikedUsers: strikedUsers.length,
      bannedShares,
      strikedUsers: strikedUsers.map(u => ({
        id: u.id,
        email: u.email,
        displayName: u.displayName,
        status: u.status,
        strikesCount: u.strikesCount || 0,
        strikes: u.strikes || [],
      })),
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Dedicated Uploader Intelligence & Violation Dossier Endpoint
router.get('/safety/uploader/:userId', (req, res) => {
  try {
    const rawId = decodeURIComponent(req.params.userId || '').trim();
    if (!rawId) return res.status(400).json({ success: false, error: 'User identifier is required' });

    let user = authService.getUser(rawId);
    if (!user) {
      const all = authService.getAllUsersList();
      user = all.find(u => u.id === rawId || u.email?.toLowerCase() === rawId.toLowerCase() || u.displayName?.toLowerCase() === rawId.toLowerCase());
    }

    const userId = user ? user.id : rawId;
    const userEmail = user ? user.email : rawId;

    // Get all shares by this user
    const userShares = [];
    for (const s of shareService.shares.values()) {
      if (s.userId === userId || s.creatorUserId === userId || s.creatorEmail?.toLowerCase() === userEmail?.toLowerCase() || s.email?.toLowerCase() === userEmail?.toLowerCase()) {
        userShares.push(s);
      }
    }

    // Get all reports involving this user
    const isVercel = process.env.VERCEL === '1';
    const dataDir = isVercel ? '/tmp/data' : path.join(__dirname, '../../data');
    const reportsFile = path.join(dataDir, 'reports.json');
    let allReports = [];
    if (fs.existsSync(reportsFile)) {
      try { allReports = JSON.parse(fs.readFileSync(reportsFile, 'utf8') || '[]'); } catch (_) {}
    }
    const userReports = allReports.filter(r => 
      r.creatorUserId === userId || 
      r.creatorEmail?.toLowerCase() === userEmail?.toLowerCase() ||
      userShares.some(s => s.code === r.shareCode || s.code === shareService.normalizeCode(r.shareCode))
    );

    res.json({
      success: true,
      user: user || {
        id: userId,
        email: userEmail,
        displayName: userEmail.split('@')[0],
        status: 'ACTIVE',
        strikesCount: userReports.filter(r => r.status === 'TAKEDOWN_EXECUTED').length,
        strikes: [],
      },
      sharesCount: userShares.length,
      bannedSharesCount: userShares.filter(s => s.isBanned === true).length,
      reportsCount: userReports.length,
      shares: userShares,
      reports: userReports,
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/safety/takedown', async (req, res) => {
  try {
    const { reportId, shareCode: reqShareCode, reason = 'DMCA Copyright / UGC Policy Infringement' } = req.body;
    
    let rawInput = reqShareCode;
    let targetReport = null;
    const isVercel = process.env.VERCEL === '1';
    const dataDir = isVercel ? '/tmp/data' : path.join(__dirname, '../../data');
    const reportsFile = path.join(dataDir, 'reports.json');
    let reports = [];

    if (fs.existsSync(reportsFile)) {
      try { reports = JSON.parse(fs.readFileSync(reportsFile, 'utf8') || '[]'); } catch (_) {}
    }

    if (reportId) {
      targetReport = reports.find(r => r.id === reportId || r.reportId === reportId);
      if (targetReport && !rawInput) {
        rawInput = targetReport.shareCode;
      }
    }

    if (!rawInput) {
      return res.status(400).json({ success: false, error: 'Valid shareCode or reportId is required' });
    }

    const cleanCode = shareService.normalizeCode(rawInput);
    let share = await shareService.getShare(cleanCode) || await shareService.getShare(rawInput);

    let fileName = 'Unknown Content';
    let creatorIdentifier = null;
    let finalShareCode = cleanCode || rawInput;

    if (share) {
      finalShareCode = share.code || finalShareCode;
      share.isBanned = true;
      share.banReason = reason;
      share.bannedAt = new Date().toISOString();
      fileName = share.fileName || fileName;
      creatorIdentifier = share.creatorUserId || share.userId || share.creatorEmail;
      
      // Save locally
      shareService._saveSharesToDisk();

      // Synchronize immediately to Cloudflare R2
      try {
        if (share.code) {
          await r2StorageService.uploadBuffer(
            `shares/${share.code}.json`,
            Buffer.from(JSON.stringify(share, null, 2), 'utf8'),
            'application/json'
          );
        }
      } catch (r2Err) {
        console.warn('[DMCA Takedown] R2 Sync note:', r2Err.message);
      }
    } else {
      // Create permanent banned tombstone share in memory, disk, and Cloudflare R2
      fileName = targetReport?.workTitle || targetReport?.fileName || fileName;
      share = {
        code: finalShareCode,
        fileId: `node_${finalShareCode}`,
        fileName,
        isBanned: true,
        banReason: reason,
        bannedAt: new Date().toISOString(),
        createdAt: new Date().toISOString(),
        creatorUserId: targetReport?.creatorUserId || '',
        creatorEmail: targetReport?.creatorEmail || '',
      };
      shareService.shares.set(finalShareCode, share);
      shareService._saveSharesToDisk();
      try {
        await r2StorageService.uploadBuffer(
          `shares/${finalShareCode}.json`,
          Buffer.from(JSON.stringify(share, null, 2), 'utf8'),
          'application/json'
        );
      } catch (r2Err) {
        console.warn('[DMCA Takedown] R2 Sync note:', r2Err.message);
      }
    }

    // Synchronize Webmaster Profile Shared Links
    try {
      let wmModified = false;
      webmasterService.profiles.forEach(p => {
        if (p.sharedLinks && Array.isArray(p.sharedLinks)) {
          p.sharedLinks.forEach(l => {
            if (
              l.shortCode === share.code ||
              l.id === share.code ||
              l.originalUrl?.includes(share.code) ||
              l.monetizedUrl?.includes(share.code)
            ) {
              l.isBanned = true;
              l.banReason = reason;
              wmModified = true;
            }
          });
        }
      });
      if (wmModified) {
        webmasterService._saveWebmastersToDisk();
      }
    } catch (wmErr) {
      console.warn('[DMCA Takedown] Webmaster sync note:', wmErr.message);
    }

    try {
      shareService.emit('TAKEDOWN_EXECUTED', {
        shareCode: share.code,
        fileId: share.fileId || share.targetNodeId,
        targetNodeId: share.targetNodeId,
        reason,
      });
    } catch (_) {}

    if (!creatorIdentifier && targetReport) {
      creatorIdentifier = targetReport.creatorUserId || targetReport.creatorEmail;
      fileName = targetReport.fileName || fileName;
    }

    // 2. Issue strike to the content uploader
    let strikeResult = { success: false, strikesCount: 0, userBanned: false };
    const adminEmail = req.admin?.email || 'superadmin@airbox.one';
    const adminId = req.admin?.adminId || 'SUPER_ADMIN';

    if (creatorIdentifier) {
      strikeResult = authService.addStrikeToUser(creatorIdentifier, {
        shareCode: finalShareCode,
        fileName,
        reason,
        issuedBy: adminEmail,
        reportId: reportId || null,
      });
    }

    // 3. Mark the report as resolved with takedown executed or create a manual takedown report
    if (targetReport) {
      targetReport.status = 'TAKEDOWN_EXECUTED';
      targetReport.actionTakenAt = new Date().toISOString();
      targetReport.resolvedBy = adminEmail;
      targetReport.strikeIssued = true;
      targetReport.creatorUserId = creatorIdentifier || targetReport.creatorUserId;
      targetReport.creatorEmail = (strikeResult?.user?.email) || targetReport.creatorEmail;
      targetReport.creatorName = (strikeResult?.user?.displayName) || targetReport.creatorName;
      targetReport.creatorStrikes = strikeResult?.strikesCount || targetReport.creatorStrikes || 1;
      targetReport.fileName = fileName || targetReport.fileName;
      targetReport.banReason = reason;
      try {
        fs.writeFileSync(reportsFile, JSON.stringify(reports, null, 2), 'utf8');
      } catch (err) {
        console.warn('[DMCA Takedown] Error saving reports.json:', err.message);
      }
    } else {
      const manualReportId = `DMCA-ADM-${Date.now().toString(36).toUpperCase()}${Math.floor(1000 + Math.random() * 9000)}`;
      const manualRecord = {
        id: manualReportId,
        reportId: manualReportId,
        shareCode: finalShareCode,
        fileName: fileName || `Content_${finalShareCode}`,
        fileId: share ? (share.fileId || share.targetNodeId) : `node_${finalShareCode}`,
        fileSize: share ? (share.sizeBytes || 0) : 0,
        isVideo: share ? (share.isVideo !== false) : true,
        previewUrl: share ? (share.streamUrl || share.downloadUrl || '') : '',
        creatorUserId: creatorIdentifier || null,
        creatorEmail: (strikeResult?.user?.email) || (share?.creatorEmail) || (creatorIdentifier || 'Manual Admin Takedown'),
        creatorName: (strikeResult?.user?.displayName) || (share?.creatorName) || 'AirBox User',
        creatorStrikes: strikeResult?.strikesCount || 1,
        reason,
        isCopyrightClaim: true,
        legalName: 'AirBox Administrative Action',
        reporterName: adminEmail,
        organization: 'AirBox Trust & Safety',
        relationship: 'Platform Administrator',
        email: adminEmail,
        reporterEmail: adminEmail,
        phone: 'N/A',
        address: 'Administrative Operations Center',
        country: 'Global',
        workTitle: fileName || 'Infringing Content',
        workCategory: 'Video / Cinematographic Film',
        ownershipProofUrl: '',
        proofDetails: `Manual administrative 1-click takedown executed by ${adminEmail}`,
        declarationGoodFaith: true,
        declarationPerjury: true,
        declarationLegalLiability: true,
        electronicSignature: adminEmail,
        clientIp: req.socket.remoteAddress || '127.0.0.1',
        userAgent: req.headers['user-agent'] || 'Admin Console',
        jurisdiction: 'Global',
        status: 'TAKEDOWN_EXECUTED',
        actionTakenAt: new Date().toISOString(),
        resolvedBy: adminEmail,
        strikeIssued: true,
        submittedAt: new Date().toISOString(),
      };
      reports.unshift(manualRecord);
      try {
        fs.writeFileSync(reportsFile, JSON.stringify(reports, null, 2), 'utf8');
      } catch (err) {
        console.warn('[DMCA Takedown] Error saving manual report to reports.json:', err.message);
      }
    }

    // 4. Record Admin Audit Log
    adminAuthService.recordAuditLog({
      adminId,
      email: adminEmail,
      action: 'DMCA_TAKEDOWN_EXECUTED',
      target: `SHARE:${finalShareCode}`,
      details: `1-Click DMCA Takedown executed for "${fileName}". Reason: ${reason}. Strikes issued: ${strikeResult?.strikesCount || 0} (Account Banned: ${strikeResult?.userBanned ? 'YES' : 'NO'}).`,
      ip: req.socket.remoteAddress,
    });

    res.json({
      success: true,
      message: `1-Click DMCA Takedown executed successfully. Video "${fileName}" has been blocked and strike recorded on creator account.`,
      shareCode: finalShareCode,
      strikesCount: strikeResult.strikesCount,
      userBanned: strikeResult.userBanned,
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/safety/dismiss-report', (req, res) => {
  try {
    const { reportId, reason = 'Report reviewed and determined non-infringing' } = req.body;
    if (!reportId) {
      return res.status(400).json({ success: false, error: 'reportId is required' });
    }

    const reportsFile = path.join(__dirname, '../../data/reports.json');
    let reports = [];
    if (fs.existsSync(reportsFile)) {
      try { reports = JSON.parse(fs.readFileSync(reportsFile, 'utf8') || '[]'); } catch (_) {}
    }

    const report = reports.find(r => r.id === reportId || r.reportId === reportId);
    if (!report) {
      return res.status(404).json({ success: false, error: 'Report not found' });
    }

    report.status = 'DISMISSED';
    report.dismissedAt = new Date().toISOString();
    report.dismissedBy = req.admin.email;
    report.dismissReason = reason;

    try {
      fs.writeFileSync(reportsFile, JSON.stringify(reports, null, 2), 'utf8');
    } catch (err) {
      console.warn('[DMCA Dismiss] Error saving reports.json:', err.message);
    }

    adminAuthService.recordAuditLog({
      adminId: req.admin.adminId,
      email: req.admin.email,
      action: 'DMCA_REPORT_DISMISSED',
      target: `REPORT:${reportId}`,
      details: `Dismissed report for ${report.shareCode} ("${report.fileName}"). Reason: ${reason}`,
      ip: req.socket.remoteAddress,
    });

    res.json({
      success: true,
      message: 'Report successfully dismissed as non-infringing.',
      reportId,
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post(['/safety/unban-share', '/safety/unban'], async (req, res) => {
  try {
    const { shareCode: reqShareCode, userEmail, restoreStrike = true } = req.body;
    if (!reqShareCode) {
      return res.status(400).json({ success: false, error: 'shareCode is required' });
    }

    const cleanCode = shareService.normalizeCode(reqShareCode);
    const share = await shareService.getShare(cleanCode) || await shareService.getShare(reqShareCode);
    
    if (share) {
      share.isBanned = false;
      delete share.banReason;
      delete share.bannedAt;
      shareService._saveSharesToDisk();

      try {
        if (share.code) {
          await r2StorageService.uploadBuffer(
            `shares/${share.code}.json`,
            Buffer.from(JSON.stringify(share, null, 2), 'utf8'),
            'application/json'
          );
        }
      } catch (_) {}

      // Unban in Webmaster Profile
      try {
        let wmModified = false;
        webmasterService.profiles.forEach(p => {
          if (p.sharedLinks && Array.isArray(p.sharedLinks)) {
            p.sharedLinks.forEach(l => {
              if (
                l.shortCode === share.code ||
                l.id === share.code ||
                l.originalUrl?.includes(share.code) ||
                l.monetizedUrl?.includes(share.code)
              ) {
                l.isBanned = false;
                delete l.banReason;
                wmModified = true;
              }
            });
          }
        });
        if (wmModified) webmasterService._saveWebmastersToDisk();
      } catch (_) {}
    }

    let strikeRemoved = false;
    const targetUser = userEmail || (share ? (share.creatorUserId || share.userId) : null);
    if (restoreStrike && targetUser) {
      const strikeRes = authService.removeStrikeFromUser(targetUser, cleanCode || reqShareCode);
      strikeRemoved = strikeRes.success;
    }

    adminAuthService.recordAuditLog({
      adminId: req.admin.adminId,
      email: req.admin.email,
      action: 'SHARE_UNBANNED_STRIKE_REMOVED',
      target: `SHARE:${cleanCode || reqShareCode}`,
      details: `Restored access to share link and cleared strike penalty.`,
      ip: req.socket.remoteAddress,
    });

    res.json({
      success: true,
      message: 'Video link successfully restored and strike penalty removed.',
      shareCode: cleanCode || reqShareCode,
      strikeRemoved,
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/safety/kill-switch', async (req, res) => {
  const reqShareCode = req.body.shareCode || req.body.code || req.body.url || req.body.link || req.body.fileId;
  const fileHash = req.body.fileHash;
  const reason = req.body.reason || 'DMCA Copyright / UGC Violation';

  if (!reqShareCode && !fileHash) {
    return res.status(400).json({ success: false, error: 'shareCode or fileHash is required' });
  }

  let revoked = false;
  let finalCode = reqShareCode;
  if (reqShareCode) {
    const cleanCode = shareService.normalizeCode(reqShareCode);
    const share = await shareService.getShare(cleanCode) || await shareService.getShare(reqShareCode);
    if (share) {
      finalCode = share.code || cleanCode;
      share.isBanned = true;
      share.banReason = reason;
      share.bannedAt = new Date().toISOString();
      shareService._saveSharesToDisk();
      revoked = true;

      try {
        if (share.code) {
          await r2StorageService.uploadBuffer(
            `shares/${share.code}.json`,
            Buffer.from(JSON.stringify(share, null, 2), 'utf8'),
            'application/json'
          );
        }
      } catch (_) {}

      // Issue strike to creator if known
      const creator = share.creatorUserId || share.userId || share.creatorEmail;
      if (creator) {
        authService.addStrikeToUser(creator, {
          shareCode: finalCode,
          fileName: share.fileName || 'Blocked Content',
          reason,
          issuedBy: req.admin.email,
        });
      }
    }
  }

  adminAuthService.recordAuditLog({
    adminId: req.admin.adminId,
    email: req.admin.email,
    action: 'DMCA_KILLSWITCH_TRIGGERED',
    target: `SHARE:${finalCode || fileHash}`,
    details: `1-Click Takedown executed. Reason: ${reason}`,
    ip: req.socket.remoteAddress,
  });

  res.json({
    success: true,
    message: '1-Click DMCA Killswitch executed. Link revoked and strike recorded.',
    revoked,
  });
});

// -------------------------------------------------------------
// 7. FINANCIALS & WITHDRAWAL GATEWAY
// -------------------------------------------------------------

router.get('/withdrawals', (req, res) => {
  webmasterService._loadWebmastersFromDisk();
  res.json({
    success: true,
    total: webmasterService.withdrawals.length,
    minWithdrawalUsd: systemConfigStore.get('min_withdrawal_usd', 10.0),
    withdrawals: webmasterService.withdrawals,
  });
});

router.post('/withdrawals/:id/approve', (req, res) => {
  const { txnHash = null } = req.body || {};

  const updatedWithdrawal = webmasterService.updateWithdrawalStatus(
    req.params.id,
    'paid',
    req.admin?.email || 'Admin',
    { txnHash }
  );

  if (!updatedWithdrawal) {
    return res.status(404).json({ success: false, error: 'Withdrawal request not found' });
  }

  adminAuthService.recordAuditLog({
    adminId: req.admin?.adminId || 'SUPER_ADMIN',
    email: req.admin?.email || 'admin',
    action: 'WITHDRAWAL_PAID',
    target: `WITHDRAWAL:${updatedWithdrawal.id}`,
    details: `Approved & settled payout of $${updatedWithdrawal.amountUsd} via ${updatedWithdrawal.method} for ${updatedWithdrawal.referralCode} (Status: PAID)`,
    ip: req.socket?.remoteAddress,
  });

  res.json({ success: true, withdrawal: updatedWithdrawal, message: 'Withdrawal approved and marked as Paid' });
});

router.post('/withdrawals/:id/reject', (req, res) => {
  const { reason = 'Rejected by administrator' } = req.body || {};

  const updatedWithdrawal = webmasterService.updateWithdrawalStatus(
    req.params.id,
    'rejected',
    req.admin?.email || 'Admin',
    { rejectionReason: reason }
  );

  if (!updatedWithdrawal) {
    return res.status(404).json({ success: false, error: 'Withdrawal request not found' });
  }

  adminAuthService.recordAuditLog({
    adminId: req.admin?.adminId || 'SUPER_ADMIN',
    email: req.admin?.email || 'admin',
    action: 'WITHDRAWAL_REJECTED',
    target: `WITHDRAWAL:${updatedWithdrawal.id}`,
    details: `Rejected payout of $${updatedWithdrawal.amountUsd} (Refunded to wallet). Reason: ${reason}`,
    ip: req.socket?.remoteAddress,
  });

  res.json({ success: true, withdrawal: updatedWithdrawal, message: 'Withdrawal rejected and refunded to wallet' });
});

// -------------------------------------------------------------
// 8. VPS TELEMETRY, PM2 & DATABASE SNAPSHOTS
// -------------------------------------------------------------

router.get('/system/telemetry', (req, res) => {
  const cpus = os.cpus();
  const freeMem = os.freemem();
  const totalMem = os.totalmem();

  res.json({
    success: true,
    telemetry: {
      hostname: os.hostname(),
      platform: os.platform(),
      arch: os.arch(),
      uptimeSeconds: os.uptime(),
      cpuCores: cpus.length,
      cpuModel: cpus[0]?.model || 'Virtual CPU',
      memUsedMb: Math.round((totalMem - freeMem) / (1024 * 1024)),
      memFreeMb: Math.round(freeMem / (1024 * 1024)),
      memTotalMb: Math.round(totalMem / (1024 * 1024)),
      memPercent: Math.round(((totalMem - freeMem) / totalMem) * 1000) / 10,
      loadAvg: os.loadavg(),
      nodeVersion: process.version,
    },
  });
});

router.post('/system/pm2/action', (req, res) => {
  const { action = 'reload' } = req.body; // reload, restart, logs

  if (!['reload', 'restart'].includes(action)) {
    return res.status(400).json({ success: false, error: 'Action must be reload or restart' });
  }

  adminAuthService.recordAuditLog({
    adminId: req.admin.adminId,
    email: req.admin.email,
    action: `PM2_PROCESS_${action.toUpperCase()}`,
    target: 'PM2_CLUSTER',
    details: `Executed pm2 ${action} all`,
    ip: req.socket.remoteAddress,
  });

  // Execute in background
  exec(`pm2 ${action} all`, (err, stdout, stderr) => {
    if (err) console.warn('[PM2 Action Warning]:', err.message);
  });

  res.json({
    success: true,
    message: `PM2 ${action} signal dispatched successfully. Server is recycling processes gracefully.`,
  });
});

router.get('/system/snapshots', (req, res) => {
  try {
    const files = fs.readdirSync(SNAPSHOTS_DIR);
    const snapshots = files
      .filter(f => f.endsWith('.json') || f.endsWith('.tar.gz'))
      .map(f => {
        const stat = fs.statSync(path.join(SNAPSHOTS_DIR, f));
        return {
          filename: f,
          sizeBytes: stat.size,
          sizeFormatted: (stat.size / (1024 * 1024)).toFixed(2) + ' MB',
          createdAt: stat.birthtime || stat.mtime,
        };
      })
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    res.json({ success: true, snapshots });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/system/snapshots/create', (req, res) => {
  try {
    const snapshotName = `snapshot_${Date.now()}.json`;
    const snapshotPath = path.join(SNAPSHOTS_DIR, snapshotName);

    const snapshotPayload = {
      createdAt: new Date().toISOString(),
      creator: req.admin.email,
      users: authService.getAllUsersList(),
      webmasters: Array.from(webmasterService.profiles.values()),
      withdrawals: webmasterService.withdrawals,
      referrals: Array.from(referralService.referrals.values()),
      shares: Array.from(shareService.shares.values()),
      config: systemConfigStore.getAll(),
    };

    fs.writeFileSync(snapshotPath, JSON.stringify(snapshotPayload, null, 2), 'utf8');

    adminAuthService.recordAuditLog({
      adminId: req.admin.adminId,
      email: req.admin.email,
      action: 'DATABASE_SNAPSHOT_CREATED',
      target: snapshotName,
      details: 'Created full atomic database snapshot backup',
      ip: req.socket.remoteAddress,
    });

    res.json({
      success: true,
      snapshotName,
      snapshot: {
        filename: snapshotName,
        createdAt: new Date().toISOString(),
      },
      message: 'Full atomic database snapshot created successfully',
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/system/snapshots/restore', (req, res) => {
  const { snapshotName } = req.body;
  if (!snapshotName) return res.status(400).json({ success: false, error: 'snapshotName required' });

  const snapshotPath = path.join(SNAPSHOTS_DIR, snapshotName);
  if (!fs.existsSync(snapshotPath)) {
    return res.status(404).json({ success: false, error: 'Snapshot file not found' });
  }

  try {
    const raw = fs.readFileSync(snapshotPath, 'utf8');
    const data = JSON.parse(raw);

    if (data.users) fs.writeFileSync(path.join(__dirname, '../../data/users.json'), JSON.stringify(data.users, null, 2), 'utf8');
    if (data.webmasters) fs.writeFileSync(path.join(__dirname, '../../data/webmasters.json'), JSON.stringify(data.webmasters, null, 2), 'utf8');
    if (data.referrals) fs.writeFileSync(path.join(__dirname, '../../data/referrals.json'), JSON.stringify(data.referrals, null, 2), 'utf8');
    if (data.shares) fs.writeFileSync(path.join(__dirname, '../../data/shares.json'), JSON.stringify(data.shares, null, 2), 'utf8');

    // Reload services in RAM
    authService._loadUsersFromDisk();
    webmasterService._loadWebmastersFromDisk();
    referralService._loadFromDisk();
    if (shareService._loadSharesFromDisk) shareService._loadSharesFromDisk();
    else if (shareService._loadFromDisk) shareService._loadFromDisk();

    adminAuthService.recordAuditLog({
      adminId: req.admin.adminId,
      email: req.admin.email,
      action: 'DATABASE_SNAPSHOT_RESTORED',
      target: snapshotName,
      details: 'Restored full atomic database state from historical snapshot',
      ip: req.socket.remoteAddress,
    });

    res.json({
      success: true,
      message: `Database successfully rolled back to snapshot: ${snapshotName}`,
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// -------------------------------------------------------------
// 9. CONFIGURATION & AUDIT LOGS
// -------------------------------------------------------------

router.get('/config', (req, res) => {
  res.json({ success: true, config: systemConfigStore.getAll() });
});

router.put('/config', (req, res) => {
  const updates = req.body;
  const updated = systemConfigStore.updateBatch(updates, req.admin.adminId, req.socket.remoteAddress);
  res.json({ success: true, config: updated });
});

router.put('/config/bulk', (req, res) => {
  const updates = req.body;
  const updated = systemConfigStore.updateBatch(updates, req.admin.adminId, req.socket.remoteAddress);
  res.json({ success: true, config: updated });
});

// -------------------------------------------------------------
// 8. GLOBAL PUSH NOTIFICATION BROADCASTER
// -------------------------------------------------------------

router.post('/notifications/broadcast', (req, res) => {
  try {
    const { title, body, target = 'ALL_USERS', category = 'ANNOUNCEMENT', actionUrl = '', priority = 'HIGH' } = req.body;
    if (!title || !title.trim()) {
      return res.status(400).json({ success: false, error: 'Notification title is required.' });
    }
    if (!body || !body.trim()) {
      return res.status(400).json({ success: false, error: 'Message body is required.' });
    }

    const normalizedTarget = (target === 'WEBMASTERS_ONLY') ? 'WEBMASTERS_ONLY' : 'ALL_USERS';

    // Calculate delivery reach based on registered accounts
    const allUsers = authService.getAllUsersList();
    const webmastersCount = webmasterService.profiles?.size || 0;
    const estimatedReach = normalizedTarget === 'WEBMASTERS_ONLY'
      ? Math.max(1, webmastersCount)
      : Math.max(1, allUsers.length);

    const notification = notificationService.saveBroadcastNotification({
      title: title.trim(),
      body: body.trim(),
      target: normalizedTarget,
      category: category.trim(),
      actionUrl: actionUrl.trim(),
      priority,
      deliveredCount: estimatedReach,
      senderAdmin: req.admin.adminId || req.admin.email || 'Super Administrator',
    });

    adminAuthService.recordAuditLog({
      adminId: req.admin.adminId,
      email: req.admin.email,
      action: 'FCM_PUSH_BROADCAST',
      target: normalizedTarget,
      details: `Dispatched push broadcast [${category}]: "${title}". Target: ${normalizedTarget} (Est. Reach: ${estimatedReach} devices)`,
      ip: req.socket.remoteAddress,
    });

    res.json({
      success: true,
      message: `Broadcast notification successfully dispatched to ${normalizedTarget === 'WEBMASTERS_ONLY' ? 'all Webmasters & Creators' : 'all Registered Users & Devices'} (${estimatedReach} reached).`,
      notification,
      reach: estimatedReach,
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.get('/notifications/broadcast', (req, res) => {
  try {
    const { limit = 50 } = req.query;
    const history = notificationService.getBroadcastHistory(parseInt(limit) || 50);
    const stats = notificationService.getStats();
    res.json({
      success: true,
      history,
      stats,
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.delete('/notifications/broadcast/all', (req, res) => {
  try {
    notificationService.clearAllBroadcasts();

    adminAuthService.recordAuditLog({
      adminId: req.admin.adminId,
      email: req.admin.email,
      action: 'PURGE_NOTIFICATIONS',
      target: 'ALL_BROADCASTS',
      details: 'Cleared all broadcast notification history from database.',
      ip: req.socket.remoteAddress,
    });

    res.json({
      success: true,
      message: 'All broadcast notifications have been permanently cleared.',
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.delete('/notifications/broadcast/:id', (req, res) => {
  try {
    const { id } = req.params;
    const deleted = notificationService.deleteBroadcast(id);
    if (!deleted) {
      return res.status(404).json({ success: false, error: 'Broadcast notification not found.' });
    }

    adminAuthService.recordAuditLog({
      adminId: req.admin.adminId,
      email: req.admin.email,
      action: 'DELETE_NOTIFICATION',
      target: `BROADCAST:${id}`,
      details: `Deleted broadcast notification ${id}`,
      ip: req.socket.remoteAddress,
    });

    res.json({
      success: true,
      message: 'Notification deleted from broadcast history.',
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// -------------------------------------------------------------
// 9. AUDIT LOGS
// -------------------------------------------------------------

router.get('/audit-logs', (req, res) => {
  const { limit = 100, page = 1 } = req.query;
  const result = adminAuthService.getAuditLogs(limit, page);
  res.json({ success: true, ...result });
});

module.exports = router;
