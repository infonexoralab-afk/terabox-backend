const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const env = require('../config/env');
const r2StorageService = require('../services/r2StorageService');
const { CreateMultipartUploadCommand, UploadPartCommand, CompleteMultipartUploadCommand, AbortMultipartUploadCommand, ListPartsCommand } = require('@aws-sdk/client-s3');
const shareService = require('../services/shareService');
const deduplicationService = require('../services/deduplicationService');
const webmasterService = require('../services/webmasterService');
const authService = require('../services/authService');
const fraudDetectionService = require('../services/fraudDetectionService');
const referralService = require('../services/referralService');
const systemConfigStore = require('../services/systemConfigStore');
const notificationService = require('../services/notificationService');
const nodeService = require('../services/nodeService');
const jwt = require('jsonwebtoken');

const VIDEO_EXTENSIONS = ['mp4', 'mkv', 'avi', 'mov', 'webm', 'flv', 'ts', 'm4v', '3gp', 'wmv', 'mpg', 'mpeg', 'vob'];

function isVideoFile(fileOrShare) {
  if (!fileOrShare) return false;
  if (fileOrShare.isVideo === true) return true;
  if (fileOrShare.durationSeconds && fileOrShare.durationSeconds > 0) return true;
  if (fileOrShare.streamUrl && fileOrShare.streamUrl.length > 5) return true;
  const name = (fileOrShare.fileName || fileOrShare.name || '').toLowerCase();
  const ext = (fileOrShare.extension || (name.includes('.') ? name.split('.').pop() : '')).toLowerCase().replace('.', '');
  return VIDEO_EXTENSIONS.includes(ext);
}

const isVercel = process.env.VERCEL === '1';
const uploadsDir = isVercel ? '/tmp/uploads' : path.join(__dirname, '../../uploads');
const chunksDir = isVercel ? '/tmp/uploads/chunks' : path.join(__dirname, '../../uploads/chunks');

try {
  if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
  }
  if (!fs.existsSync(chunksDir)) {
    fs.mkdirSync(chunksDir, { recursive: true });
  }
} catch (err) {
  console.warn('[API Routes] Could not create uploads or chunks directories:', err.message);
}

// Disk Storage for real file preservation
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, uploadsDir);
  },
  filename: function (req, file, cb) {
    const safeName = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
    cb(null, `${Date.now()}_${safeName}`);
  }
});

const upload = multer({ storage: storage, limits: { fileSize: 1024 * 1024 * 1024 } }); // 1 GB
const uploadMemory = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });

// 0. Maintenance Mode Middleware
router.use((req, res, next) => {
  if (
    req.path === '/config' ||
    req.path === '/config/public' ||
    req.path === '/notifications' ||
    req.path === '/webmaster/status' ||
    req.path === '/webmaster/program-status' ||
    req.path === '/health' ||
    req.path.startsWith('/report') ||
    req.path.startsWith('/auth/') ||
    req.path.startsWith('/v1/admin') ||
    req.path.startsWith('/admin')
  ) {
    return next();
  }

  const isMaintenance = systemConfigStore.get('maintenance_mode_enabled', false);
  if (isMaintenance) {
    return res.status(503).json({
      success: false,
      isMaintenance: true,
      title: systemConfigStore.get('maintenance_title', 'Scheduled System Upgrade'),
      message: systemConfigStore.get(
        'maintenance_message',
        'We are upgrading our infrastructure. Services will be back online shortly.'
      ),
    });
  }
  next();
});

// Global Active Ban / Suspension Interceptor
router.use((req, res, next) => {
  // Allow public status and unban checks to pass
  if (
    req.path === '/user/status' ||
    req.path.startsWith('/media/check/') ||
    req.path.startsWith('/auth/') ||
    req.path.startsWith('/v1/admin') ||
    req.path.startsWith('/admin')
  ) {
    return next();
  }

  const userIdentifier =
    req.headers['x-user-id'] ||
    req.headers['x-user-email'] ||
    req.query.userId ||
    req.query.email ||
    req.body?.userId ||
    req.body?.email ||
    req.body?.userEmail;

  if (userIdentifier) {
    const user = authService.getUser(userIdentifier.toString().trim());
    if (user && (user.status === 'BANNED' || user.status === 'SUSPENDED')) {
      return res.status(403).json({
        success: false,
        isBanned: true,
        status: user.status,
        error: `Account Suspended: Your account has been suspended by administration. ${user.banReason || ''}`,
        banReason: user.banReason || 'Account suspended by administration due to terms of service violation.',
      });
    }
  }
  next();
});

// Dedicated User Ban / Account Status Check
router.get('/user/status', (req, res) => {
  const userIdentifier =
    req.query.userId ||
    req.query.email ||
    req.headers['x-user-id'] ||
    req.headers['x-user-email'];

  if (!userIdentifier) {
    return res.json({
      success: true,
      isBanned: false,
      status: 'ACTIVE',
      banReason: null,
    });
  }

  const user = authService.getUser(userIdentifier.toString().trim());
  if (!user) {
    return res.json({
      success: true,
      isBanned: false,
      status: 'ACTIVE',
      banReason: null,
    });
  }

  const isBanned = user.status === 'BANNED' || user.status === 'SUSPENDED';
  res.json({
    success: true,
    isBanned: isBanned,
    status: user.status || 'ACTIVE',
    banReason: isBanned ? (user.banReason || 'Account suspended by administration due to terms of service violation.') : null,
    strikesCount: user.strikesCount || (user.strikes ? user.strikes.length : 0),
  });
});

// Dedicated Media / Video Copyright Ban Check
router.get('/media/check/:code', async (req, res) => {
  try {
    const rawCode = (req.params.code || '').trim();
    if (!rawCode) {
      return res.json({
        success: true,
        isMediaBanned: false,
        isBanned: false,
        hasStrike: false,
        isUserBanned: false,
        status: 'ACTIVE',
      });
    }

    let share = await shareService.getShare(rawCode);
    if (!share) {
      for (const s of shareService.shares.values()) {
        if (
          s.code === rawCode ||
          s.shortCode === rawCode ||
          s.id === rawCode ||
          s.fileId === rawCode ||
          s.targetNodeId === rawCode ||
          s.nodeDetails?.id === rawCode
        ) {
          share = s;
          break;
        }
      }
    }

    if (!share) {
      const cleanCode = shareService.normalizeCode(rawCode);
      const isVercel = process.env.VERCEL === '1';
      const dataDir = isVercel ? '/tmp/data' : path.join(__dirname, '../../data');
      const reportsFile = path.join(dataDir, 'reports.json');
      if (fs.existsSync(reportsFile)) {
        try {
          const reports = JSON.parse(fs.readFileSync(reportsFile, 'utf8') || '[]');
          const bannedReport = reports.find(r =>
            (r.status === 'TAKEDOWN_EXECUTED' || r.status === 'RESOLVED') &&
            (shareService.normalizeCode(r.shareCode) === cleanCode || r.shareCode === rawCode || r.id === rawCode || r.reportId === rawCode)
          );
          if (bannedReport) {
            return res.json({
              success: true,
              isMediaBanned: true,
              isBanned: true,
              hasStrike: true,
              isUserBanned: false,
              banReason: bannedReport.reason || 'DMCA Copyright Infringement Notice',
              status: 'DMCA_BANNED',
              mediaStatus: 'BANNED',
              shareCode: cleanCode || rawCode,
              fileName: bannedReport.fileName || bannedReport.workTitle || 'Takedown Content',
            });
          }
        } catch (_) { }
      }

      return res.json({
        success: true,
        isMediaBanned: false,
        isBanned: false,
        hasStrike: false,
        isUserBanned: false,
        status: 'NOT_FOUND',
      });
    }

    const isBanned = share.isBanned === true;
    res.json({
      success: true,
      isMediaBanned: isBanned,
      isBanned: isBanned,
      hasStrike: isBanned,
      isUserBanned: false,
      banReason: share.banReason || 'DMCA Copyright Infringement Notice',
      status: isBanned ? 'DMCA_BANNED' : 'ACTIVE',
      mediaStatus: isBanned ? 'BANNED' : 'ACTIVE',
      shareCode: share.code,
      fileName: share.fileName || share.name || 'Shared Content',
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 1. User Profile
router.get('/user/profile', (req, res) => {
  const userId = req.query.userId || req.query.email || req.headers['x-user-id'] || req.headers['x-user-email'];
  if (!userId) {
    return res.status(401).json({
      success: false,
      error: 'Unauthorized: User identifier required. Please Sign In.',
    });
  }
  const user = authService.getUser(userId);
  if (user) {
    if (user.status === 'BANNED' || user.status === 'SUSPENDED') {
      return res.status(403).json({
        success: false,
        isBanned: true,
        status: user.status,
        error: `Account Suspended: Your account has been suspended by administration. ${user.banReason || ''}`,
        banReason: user.banReason || 'Account suspended by administration due to terms of service violation.',
      });
    }
    return res.json(user);
  }
  return res.status(401).json({
    success: false,
    error: 'Unauthorized: User not found. Please Sign In.',
  });
});

// 1.1 Activate VIP Membership
router.post('/user/vip/activate', (req, res) => {
  const userId = req.body.userId || req.body.email || req.headers['x-user-id'] || req.headers['x-user-email'];
  if (!userId) {
    return res.status(400).json({
      success: false,
      error: 'User identifier required. Please sign in.',
    });
  }

  const storageBytes = req.body.storageBytes ? Number(req.body.storageBytes) : 2199023255552;
  const durationDays = req.body.durationDays ? Number(req.body.durationDays) : 365;
  const planId = req.body.planId || 'vip';

  const user = authService.updateUserVip(userId, true, { storageBytes, durationDays, planId });
  if (user) {
    return res.json({
      success: true,
      message: 'VIP membership activated successfully',
      user,
    });
  }

  return res.status(404).json({
    success: false,
    error: 'User account not found',
  });
});

// ==========================================
// 📁 USER CLOUD NODES & PERSISTENT FILE SYNC
// ==========================================

// 1. Get all nodes for the active user (with auto R2 recovery fallback)
router.get('/user/nodes', async (req, res) => {
  try {
    const userId = req.query.userId || req.headers['x-user-id'] || '';
    const userEmail = req.query.email || req.query.userEmail || req.headers['x-user-email'] || '';

    if (!userId && !userEmail) {
      return res.json({ success: true, nodes: [] });
    }

    let nodes = nodeService.getUserNodes(userId, userEmail);

    // If user has 0 nodes registered, automatically scan user's Cloudflare R2 bucket path to restore any uploaded files!
    if (nodes.length === 0 && (userEmail || userId)) {
      const scanTarget = userEmail || userId;
      const recovery = await nodeService.scanAndRecoverR2Files(scanTarget, userId);
      nodes = recovery.nodes || [];
    }

    // Update user's used storage bytes dynamically based on actual cloud nodes
    if (userId || userEmail) {
      const totalBytes = nodes.reduce((acc, n) => acc + (n.sizeBytes || 0), 0);
      const u = authService.getUser(userId || userEmail);
      if (u) {
        u.usedSpaceBytes = totalBytes;
        authService.saveUsers();
      }
    }

    res.json({
      success: true,
      count: nodes.length,
      nodes: nodes,
    });
  } catch (err) {
    console.error('[API /user/nodes Error]', err);
    res.status(500).json({ success: false, error: err.message, nodes: [] });
  }
});

// 2. Upsert / Save a node
router.post('/user/nodes/save', (req, res) => {
  try {
    const nodeData = req.body;
    if (!nodeData || !nodeData.name) {
      return res.status(400).json({ success: false, error: 'Node data with name is required.' });
    }

    const saved = nodeService.saveNode(nodeData);

    // Update user used storage
    if (saved.ownerId || saved.userEmail) {
      const allUserNodes = nodeService.getUserNodes(saved.ownerId, saved.userEmail);
      const totalBytes = allUserNodes.reduce((acc, n) => acc + (n.sizeBytes || 0), 0);
      const u = authService.getUser(saved.ownerId || saved.userEmail);
      if (u) {
        u.usedSpaceBytes = totalBytes;
        authService.saveUsers();
      }
    }

    res.json({ success: true, node: saved });
  } catch (err) {
    console.error('[API /user/nodes/save Error]', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// 3. Batch sync nodes from client
router.post('/user/nodes/sync', (req, res) => {
  try {
    const { nodes, userId, userEmail } = req.body;
    if (!Array.isArray(nodes)) {
      return res.status(400).json({ success: false, error: 'nodes must be an array.' });
    }

    const saved = nodeService.saveNodesBatch(nodes, userId, userEmail);

    if (userId || userEmail) {
      const allUserNodes = nodeService.getUserNodes(userId, userEmail);
      const totalBytes = allUserNodes.reduce((acc, n) => acc + (n.sizeBytes || 0), 0);
      const u = authService.getUser(userId || userEmail);
      if (u) {
        u.usedSpaceBytes = totalBytes;
        authService.saveUsers();
      }
    }

    res.json({ success: true, count: saved.length, nodes: saved });
  } catch (err) {
    console.error('[API /user/nodes/sync Error]', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// 4. Delete node permanently (removes from Cloudflare R2 and database)
router.delete('/user/nodes/:id', async (req, res) => {
  try {
    const nodeId = req.params.id;
    const userId = req.query.userId || req.headers['x-user-id'] || req.body.userId || '';
    const userEmail = req.query.userEmail || req.headers['x-user-email'] || req.body.userEmail || '';
    const result = await nodeService.deleteNode(nodeId, userId || userEmail);

    if (userId || userEmail) {
      const allUserNodes = nodeService.getUserNodes(userId, userEmail);
      const totalBytes = allUserNodes.filter(n => !n.isTrashed && !n.isTrash).reduce((acc, n) => acc + (n.sizeBytes || 0), 0);
      const u = authService.getUser(userId || userEmail);
      if (u) {
        u.usedSpaceBytes = totalBytes;
        authService.saveUsers();
      }
    }

    res.json(result);
  } catch (err) {
    console.error('[API /user/nodes/:id DELETE Error]', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// 4b. 30-Day Auto Purge Trigger
router.post('/user/trash/purge', async (req, res) => {
  try {
    const retentionDays = Number(req.body.retentionDays || 30);
    const count = await nodeService.purgeExpiredTrash(retentionDays);
    res.json({ success: true, message: `Purged ${count} expired items from Recycle Bin and Cloudflare R2`, purgedCount: count });
  } catch (err) {
    console.error('[API /user/trash/purge Error]', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// 5. Rename node
router.post('/user/nodes/rename', (req, res) => {
  try {
    const { id, newName } = req.body;
    if (!id || !newName) {
      return res.status(400).json({ success: false, error: 'id and newName are required.' });
    }
    const result = nodeService.renameNode(id, newName);
    res.json(result);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 6. Move node
router.post('/user/nodes/move', (req, res) => {
  try {
    const { id, targetParentId } = req.body;
    if (!id) {
      return res.status(400).json({ success: false, error: 'id is required.' });
    }
    const result = nodeService.moveNode(id, targetParentId);
    res.json(result);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 7. Explicit Scan & Recover R2 Files
router.post('/user/nodes/recover-r2', async (req, res) => {
  try {
    const userIdentifier = req.body?.userEmail || req.body?.email || req.body?.userId || req.headers['x-user-email'] || req.headers['x-user-id'];
    const userId = req.body?.userId || req.headers['x-user-id'];
    if (!userIdentifier) {
      return res.status(400).json({ success: false, error: 'User identifier is required for R2 recovery.' });
    }
    const result = await nodeService.scanAndRecoverR2Files(userIdentifier, userId);
    res.json(result);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ==========================================
// 🔑 AUTHENTICATION & OTP API ENDPOINTS
// ==========================================

// 1. Send Email OTP for Signup
router.post('/auth/send-email-otp', async (req, res) => {
  try {
    const { name, email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required.' });
    }
    const result = await authService.sendEmailSignupOtp(name, email, password);
    if (!result.success) {
      return res.status(400).json({ error: result.error });
    }
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 2. Verify Email OTP & Create Account
router.post('/auth/verify-email-otp-signup', (req, res) => {
  try {
    const { email, otpCode, deviceFingerprint, installToken, refCode } = req.body;
    if (!email || !otpCode) {
      return res.status(400).json({ error: 'Email and 6-digit OTP code are required.' });
    }
    const result = authService.verifyEmailSignupOtp(email, otpCode);
    if (!result.success) {
      return res.status(400).json({ error: result.error });
    }

    // Auto-attribute referral if referred via Google Play Referrer / Webmaster Link / IP Match
    if (result.user) {
      const rawIp = req.headers['cf-connecting-ip'] || req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket?.remoteAddress || '127.0.0.1';
      const clientIp = rawIp.replace(/^::ffff:/, '');
      referralService.onUserRegistered({
        userId: result.user.id,
        email: result.user.email,
        name: result.user.displayName,
        deviceFingerprint,
        installToken,
        explicitRefCode: refCode || req.query.ref,
        clientIp,
        rawIp,
      });
    }

    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 3. Send Mobile SMS OTP
router.post('/auth/send-mobile-otp', (req, res) => {
  try {
    const { phone } = req.body;
    if (!phone) {
      return res.status(400).json({ error: 'Mobile phone number is required.' });
    }
    const result = authService.sendMobileOtp(phone);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 4. Verify Mobile SMS OTP
router.post('/auth/verify-mobile-otp', (req, res) => {
  try {
    const { phone, otpCode, deviceFingerprint, installToken, refCode } = req.body;
    if (!phone || !otpCode) {
      return res.status(400).json({ error: 'Phone number and 6-digit SMS OTP are required.' });
    }
    const result = authService.verifyMobileOtp(phone, otpCode);
    if (!result.success) {
      return res.status(400).json({ error: result.error });
    }

    if (result.user) {
      const rawIp = req.headers['cf-connecting-ip'] || req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket?.remoteAddress || '127.0.0.1';
      const clientIp = rawIp.replace(/^::ffff:/, '');
      referralService.onUserRegistered({
        userId: result.user.id,
        email: result.user.email,
        name: result.user.displayName,
        deviceFingerprint,
        installToken,
        explicitRefCode: refCode || req.query.ref,
        clientIp,
        rawIp,
      });
    }

    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 5. Send Forgot Password OTP
router.post('/auth/forgot-password/send-otp', async (req, res) => {
  try {
    const { emailOrPhone } = req.body;
    if (!emailOrPhone) {
      return res.status(400).json({ error: 'Email or Mobile number is required.' });
    }
    const result = await authService.sendForgotPasswordOtp(emailOrPhone);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 6. Reset Password with OTP
router.post('/auth/forgot-password/reset', (req, res) => {
  try {
    const { emailOrPhone, otpCode, newPassword } = req.body;
    if (!emailOrPhone || !otpCode || !newPassword) {
      return res.status(400).json({ error: 'Email/Mobile, OTP code, and new password are required.' });
    }
    const result = authService.resetPasswordWithOtp(emailOrPhone, otpCode, newPassword);
    if (!result.success) {
      return res.status(400).json({ error: result.error });
    }
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 7. Google Login
router.post('/auth/google-login', (req, res) => {
  try {
    const { idToken, googleEmail, googleName, googlePhoto, email, displayName, photoUrl, deviceFingerprint, installToken, refCode } = req.body;
    const finalEmail = googleEmail || email;
    const finalName = googleName || displayName;
    const finalPhoto = googlePhoto || photoUrl;
    const isNew = !authService.users.has((finalEmail || '').trim().toLowerCase());
    const result = authService.loginWithGoogle(idToken, finalEmail, finalName, finalPhoto);

    if (result.success && isNew && result.user) {
      const clientIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '127.0.0.1';
      referralService.onUserRegistered({
        userId: result.user.id,
        email: result.user.email,
        name: result.user.displayName,
        deviceFingerprint,
        installToken,
        explicitRefCode: refCode,
        clientIp,
      });
    }

    if (result.success && result.user && deviceFingerprint) {
      const isWm = result.user.isWebmasterEnrolled || webmasterService.getProfile(result.user.id) || webmasterService.getProfile(result.user.email);
      if (isWm) {
        referralService.registerWebmasterDevice(result.user.id, deviceFingerprint);
        if (result.user.email) referralService.registerWebmasterDevice(result.user.email, deviceFingerprint);
      }
    }

    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 8. Login with Email + Password
router.post('/auth/login-email', (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required.' });
    }
    const result = authService.loginWithEmailPassword(email, password);
    if (!result.success) {
      return res.status(400).json({ error: result.error });
    }
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 9. Permanent Account & Data Deletion
router.delete('/auth/delete-account', async (req, res) => {
  try {
    const userId = req.body?.userId || req.query?.userId || req.headers['x-user-id'];
    const email = req.body?.email || req.query?.email;
    if (!userId && !email) {
      return res.status(400).json({ success: false, error: 'User ID or Email is required for deletion.' });
    }
    const result = await authService.deleteUserAccount(userId, email);
    res.json(result);
  } catch (err) {
    console.error('[API] Error during account deletion:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/auth/delete-account', async (req, res) => {
  try {
    const userId = req.body?.userId || req.query?.userId || req.headers['x-user-id'];
    const email = req.body?.email || req.query?.email;
    if (!userId && !email) {
      return res.status(400).json({ success: false, error: 'User ID or Email is required for deletion.' });
    }
    const result = await authService.deleteUserAccount(userId, email);
    res.json(result);
  } catch (err) {
    console.error('[API] Error during account deletion:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Comprehensive Security Validator for Blocking Dangerous/Exploit/Script Formats
const RESTRICTED_EXTENSIONS = new Set([
  'php', 'php3', 'php4', 'php5', 'phtml', 'phar', 'inc',
  'asp', 'aspx', 'axd', 'ashx', 'asmx', 'cer', 'asa',
  'jsp', 'jspx', 'jsw', 'jsv', 'jspf', 'war', 'ear', 'cgi', 'pl', 'perl', 'pyc', 'pyo', 'pyd',
  'sh', 'bash', 'zsh', 'csh', 'ksh', 'bat', 'cmd', 'vbs', 'vbe', 'jse', 'wsf', 'wsh', 'msc',
  'scr', 'pif', 'gadget', 'hta', 'cpl', 'reg', 'msp', 'com', 'inf', 'ins', 'sct',
  'htaccess', 'htpasswd', 'env', 'config'
]);

function isFileRestricted(fileName) {
  if (!fileName || typeof fileName !== 'string') return false;
  const parts = fileName.toLowerCase().trim().split('.');
  if (parts.length <= 1) return false;
  for (let i = 1; i < parts.length; i++) {
    const ext = parts[i].trim();
    if (RESTRICTED_EXTENSIONS.has(ext)) {
      return true;
    }
  }
  return false;
}

// 2. Cloudflare R2 Connection Status Check
router.get('/r2/status', async (req, res) => {
  const result = await r2StorageService.testConnection();
  res.json(result);
});

// Helper to resolve user folder name for Cloudflare R2
function resolveUserFolder(req) {
  let userIdentifier =
    req.headers['x-user-email'] ||
    req.body?.userEmail ||
    req.query?.userEmail ||
    req.headers['x-user-id'] ||
    req.body?.userId ||
    req.query?.userId ||
    req.body?.email ||
    req.query?.email ||
    req.user?.email ||
    req.user?.id;

  if (userIdentifier && userIdentifier.toString().trim().length > 0) {
    const raw = userIdentifier.toString().trim();
    // If it's already a valid email address
    if (raw.includes('@')) {
      return raw;
    }
    // Lookup by user ID / username / referral code in authService
    const u = authService.getUser(raw);
    if (u && u.email) return u.email;
    return raw;
  }
  return 'public_uploads';
}

function formatStorageBytes(bytes) {
  if (bytes >= (1024 ** 4)) return `${(bytes / (1024 ** 4)).toFixed(1)} TB`;
  if (bytes >= (1024 ** 3)) return `${(bytes / (1024 ** 3)).toFixed(1)} GB`;
  if (bytes >= (1024 ** 2)) return `${(bytes / (1024 ** 2)).toFixed(0)} MB`;
  return `${(bytes / 1024).toFixed(0)} KB`;
}

function checkUserStorageQuota(req, incomingBytes = 0) {
  const userIdentifier =
    req.headers['x-user-id'] ||
    req.headers['x-user-email'] ||
    req.body?.userId ||
    req.body?.userEmail ||
    req.query?.userId ||
    req.query?.userEmail ||
    req.user?.id ||
    req.user?.email;

  if (!userIdentifier) return { allowed: true };

  const raw = userIdentifier.toString().trim();
  const u = authService.getUser(raw);
  if (!u) return { allowed: true };

  const total = u.totalSpaceBytes || 1099511627776; // 1024 GB standard
  const used = u.usedSpaceBytes || 0;

  if (used + incomingBytes > total || used >= total) {
    const formattedUsed = formatStorageBytes(used);
    const formattedTotal = formatStorageBytes(total);
    return {
      allowed: false,
      error: 'STORAGE_LIMIT_EXCEEDED',
      message: `Cloud storage limit reached (${formattedUsed} / ${formattedTotal}). Please upgrade to AirBox VIP to unlock up to 5.0 TB additional storage.`,
      usedSpaceBytes: used,
      totalSpaceBytes: total,
    };
  }

  return { allowed: true, user: u };
}

// 2b. Direct Pre-signed S3 Upload URL for Cloudflare R2 (Organized per User Folder)
router.post('/r2/presigned-upload', async (req, res) => {
  try {
    const { fileName, mimeType, sizeBytes } = req.body;
    if (!fileName) {
      return res.status(400).json({ error: 'fileName is required' });
    }
    if (isFileRestricted(fileName)) {
      return res.status(400).json({ success: false, error: 'This file format is not supported for security reasons.' });
    }

    const quota = checkUserStorageQuota(req, parseInt(sizeBytes || '0', 10) || 0);
    if (!quota.allowed) {
      return res.status(403).json(quota);
    }

    const userFolder = resolveUserFolder(req);
    const r2Key = r2StorageService.generateUserR2Key(userFolder, fileName);
    const contentType = mimeType || 'application/octet-stream';

    const presigned = await r2StorageService.getPresignedUploadUrl(r2Key, contentType, 7200); // 2 hours

    res.json({
      success: true,
      uploadUrl: presigned.uploadUrl,
      r2Key: r2Key,
      publicUrl: presigned.publicUrl,
      downloadUrl: presigned.publicUrl,
      fileName: fileName,
      contentType: contentType,
      userFolder: userFolder,
    });
  } catch (err) {
    console.error('[Presigned Upload Error]', err);
    res.status(500).json({ error: err.message });
  }
});

// 3. Direct Real File Upload Endpoint to Cloudflare R2
router.post('/r2/upload', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const fileName = req.file.originalname;
    if (isFileRestricted(fileName)) {
      try { fs.unlinkSync(req.file.path); } catch (_) { }
      return res.status(400).json({ success: false, error: 'This file format is not supported for security reasons.' });
    }

    const quota = checkUserStorageQuota(req, req.file.size);
    if (!quota.allowed) {
      try { fs.unlinkSync(req.file.path); } catch (_) { }
      return res.status(403).json(quota);
    }

    const diskFileName = req.file.filename;
    const filePath = req.file.path;
    const sizeBytes = req.file.size;
    const mimeType = req.file.mimetype || 'application/octet-stream';
    const ext = fileName.split('.').pop().toLowerCase();
    const isVideo = mimeType.startsWith('video/') || ['mp4', 'mkv', 'mov', 'webm', 'avi'].includes(ext);

    // Cloudflare R2 Key & Public URL (Organized per User Folder)
    const userFolder = resolveUserFolder(req);
    const r2Key = r2StorageService.generateUserR2Key(userFolder, fileName);
    const publicR2Url = `${env.r2.publicDomain}/${r2Key}`;

    // Upload to Cloudflare R2 (smart: PutObject for small, Multipart for large)
    try {
      await r2StorageService.uploadFile(r2Key, filePath, mimeType);
      console.log(`[R2 Upload] ✅ Successfully saved to Cloudflare R2: ${r2Key} (${sizeBytes} bytes)`);
    } catch (r2Err) {
      console.error('[R2 Upload Error]', r2Err.message);
      return res.status(500).json({ error: `R2 upload failed: ${r2Err.message}` });
    }

    // Cleanup local file after successful R2 upload
    try { fs.unlinkSync(filePath); } catch (_) { }

    const clientNodeId = req.body?.nodeId || req.body?.id || req.headers['x-node-id'] || null;
    const userIdentifier = req.headers['x-user-id'] || req.headers['x-user-email'] || req.body?.userId || req.body?.userEmail || userFolder;
    const savedNode = nodeService.saveNode({
      id: clientNodeId,
      name: fileName,
      sizeBytes: sizeBytes,
      extension: ext,
      mimeType: mimeType,
      downloadUrl: publicR2Url,
      hlsStreamUrl: isVideo ? publicR2Url : null,
      ownerId: userIdentifier,
      userEmail: userFolder.includes('@') ? userFolder : '',
    });

    res.json({
      success: true,
      file: {
        id: savedNode.id,
        name: fileName,
        sizeBytes: sizeBytes,
        contentType: mimeType,
        extension: ext,
        isVideo: isVideo,
        r2Key: r2Key,
        publicUrl: publicR2Url,
        streamUrl: isVideo ? publicR2Url : null,
        downloadUrl: publicR2Url,
        uploadedAt: new Date().toISOString(),
      },
    });
  } catch (err) {
    console.error('Upload Error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Helper to resolve MIME type on the fly
function getMimeType(fileName) {
  const ext = fileName.split('.').pop().toLowerCase();
  switch (ext) {
    case 'mp4': return 'video/mp4';
    case 'mkv': return 'video/x-matroska';
    case 'mov': return 'video/quicktime';
    case 'webm': return 'video/webm';
    case 'avi': return 'video/x-msvideo';
    case 'jpg':
    case 'jpeg': return 'image/jpeg';
    case 'png': return 'image/png';
    case 'webp': return 'image/webp';
    case 'pdf': return 'application/pdf';
    case 'zip': return 'application/zip';
    case 'rar': return 'application/x-rar-compressed';
    default: return 'application/octet-stream';
  }
}

// 4. Resumable Chunk Upload - Receives individual 4 MB slice in memory and streams directly to Cloudflare R2 on the fly (0 Vercel Disk space!)
router.post('/upload/chunk', uploadMemory.single('chunk'), async (req, res) => {
  try {
    const { uploadId, chunkIndex, totalChunks, fileName } = req.body;
    if (!uploadId || chunkIndex === undefined || !fileName) {
      return res.status(400).json({ error: 'uploadId, chunkIndex, and fileName are required' });
    }
    if (isFileRestricted(fileName)) {
      return res.status(400).json({ success: false, error: 'This file format is not supported for security reasons.' });
    }

    if (parseInt(chunkIndex, 10) === 0) {
      const quota = checkUserStorageQuota(req, parseInt(req.body?.totalBytes || req.file?.size || '0', 10) || 0);
      if (!quota.allowed) {
        return res.status(403).json(quota);
      }
    }

    if (!req.file) {
      return res.status(400).json({ error: 'No chunk file received' });
    }

    const metaKey = `uploads_meta/${uploadId}.json`;
    let meta = await r2StorageService.downloadJson(metaKey);

    if (!meta) {
      // Initiate S3 Multipart Upload on the fly for this session (Organized per User Folder)
      console.log(`[R2 Multipart] Initiating S3 Multipart Upload on the fly for: ${fileName}`);
      const userFolder = resolveUserFolder(req);
      const r2Key = r2StorageService.generateUserR2Key(userFolder, fileName);
      const contentType = getMimeType(fileName);

      const createCmd = new CreateMultipartUploadCommand({
        Bucket: r2StorageService.bucketName,
        Key: r2Key,
        ContentType: contentType,
      });
      const createRes = await r2StorageService.client.send(createCmd);

      const rawUserEmail = req.headers['x-user-email'] || req.body?.userEmail || (userFolder.includes('@') ? userFolder : '');
      const rawUserId = req.headers['x-user-id'] || req.body?.userId || '';
      const clientNodeId = req.body?.nodeId || req.headers['x-node-id'] || null;

      meta = {
        s3UploadId: createRes.UploadId,
        s3Key: r2Key,
        parts: [],
        fileName,
        totalChunks: parseInt(totalChunks, 10),
        contentType,
        userFolder,
        userId: rawUserId,
        userEmail: rawUserEmail,
        nodeId: clientNodeId,
      };
      await r2StorageService.uploadJson(metaKey, meta);
    } else if (!meta.nodeId && (req.body?.nodeId || req.headers['x-node-id'])) {
      meta.nodeId = req.body?.nodeId || req.headers['x-node-id'];
      await r2StorageService.uploadJson(metaKey, meta);
    }

    const partNumber = parseInt(chunkIndex, 10) + 1;
    console.log(`[R2 Multipart] Streaming chunk ${partNumber}/${totalChunks} (size: ${req.file.size} bytes) for [${fileName}] straight to Cloudflare R2...`);

    const uploadPartCmd = new UploadPartCommand({
      Bucket: r2StorageService.bucketName,
      Key: meta.s3Key,
      UploadId: meta.s3UploadId,
      PartNumber: partNumber,
      Body: req.file.buffer,
    });
    const partRes = await r2StorageService.client.send(uploadPartCmd);

    console.log(`[R2 Multipart] ✅ Chunk ${partNumber}/${totalChunks} uploaded straight to Cloudflare R2`);

    res.json({
      success: true,
      uploadId,
      chunkIndex: parseInt(chunkIndex, 10),
      totalChunks: parseInt(totalChunks, 10),
    });
  } catch (err) {
    console.error('[Chunk Upload Error]', err);
    res.status(500).json({ error: err.message });
  }
});

// Global registry for background upload tasks to prevent HTTP connection timeouts
const uploadTasks = new Map();

async function completeS3MultipartUploadAsync(uploadId, meta, sizeBytes) {
  const metaKey = `uploads_meta/${uploadId}.json`;
  try {
    console.log(`[R2 Multipart] Completing multipart upload for: ${meta.fileName} (UploadId: ${meta.s3UploadId})`);

    const listCmd = new ListPartsCommand({
      Bucket: r2StorageService.bucketName,
      Key: meta.s3Key,
      UploadId: meta.s3UploadId,
    });
    const listRes = await r2StorageService.client.send(listCmd);

    const parts = (listRes.Parts || []).map(p => ({
      PartNumber: p.PartNumber,
      ETag: p.ETag,
    }));
    parts.sort((a, b) => a.PartNumber - b.PartNumber);

    console.log(`[R2 Multipart] Found ${parts.length} uploaded parts in R2 storage engine. Completing...`);

    const completeCmd = new CompleteMultipartUploadCommand({
      Bucket: r2StorageService.bucketName,
      Key: meta.s3Key,
      UploadId: meta.s3UploadId,
      MultipartUpload: {
        Parts: parts,
      },
    });

    await r2StorageService.client.send(completeCmd);
    console.log(`[R2 Multipart] ✅ Cloud assembly complete! Object saved as: ${meta.s3Key}`);

    const ext = meta.fileName.split('.').pop().toLowerCase();
    const isVideo = meta.contentType.startsWith('video/') || ['mp4', 'mkv', 'mov', 'webm', 'avi'].includes(ext);
    const publicR2Url = `${env.r2.publicDomain}/${meta.s3Key}`;
    const userFolder = meta.userFolder || 'public_uploads';
    const finalUserId = meta.userId || (userFolder.includes('@') ? '' : userFolder);
    const finalUserEmail = meta.userEmail || (userFolder.includes('@') ? userFolder : '');

    const clientNodeId = meta.nodeId || null;
    const savedNode = nodeService.saveNode({
      id: clientNodeId,
      name: meta.fileName,
      sizeBytes: parseInt(sizeBytes || '0', 10) || 0,
      extension: ext,
      mimeType: meta.contentType,
      downloadUrl: publicR2Url,
      hlsStreamUrl: isVideo ? publicR2Url : null,
      ownerId: finalUserId || finalUserEmail || userFolder,
      userEmail: finalUserEmail || (userFolder.includes('@') ? userFolder : ''),
    });

    // Update global map with completed details
    uploadTasks.set(uploadId, {
      status: 'completed',
      file: {
        id: savedNode.id,
        name: meta.fileName,
        sizeBytes: parseInt(sizeBytes || '0', 10) || 0,
        extension: ext,
        isVideo: isVideo,
        r2Key: meta.s3Key,
        publicUrl: publicR2Url,
        streamUrl: isVideo ? publicR2Url : null,
        downloadUrl: publicR2Url,
        uploadedAt: new Date().toISOString(),
      }
    });

    // Cleanup metadata JSON in R2
    try {
      await r2StorageService.deleteObject(metaKey);
    } catch (_) { }

  } catch (err) {
    console.error('[R2 Multipart Completion Error]', err);
    uploadTasks.set(uploadId, {
      status: 'failed',
      error: err.message
    });
  }
}

// 5. Complete & Assemble Resumable Upload in Cloudflare R2
router.post('/upload/complete', async (req, res) => {
  try {
    const { uploadId, fileName, totalChunks, sizeBytes, mimeType, nodeId } = req.body;
    if (!uploadId) {
      return res.status(400).json({ error: 'uploadId is required' });
    }

    // Check if task exists and is already completed
    if (uploadTasks.has(uploadId) && uploadTasks.get(uploadId).status === 'completed') {
      return res.json({ success: true, ...uploadTasks.get(uploadId) });
    }

    const metaKey = `uploads_meta/${uploadId}.json`;
    const meta = await r2StorageService.downloadJson(metaKey);

    if (!meta) {
      return res.status(404).json({ error: 'Upload metadata not found or session already closed' });
    }

    if (nodeId && !meta.nodeId) {
      meta.nodeId = nodeId;
    }

    // Set task to processing state
    uploadTasks.set(uploadId, { status: 'processing' });

    // Complete Multipart upload in S3 asynchronously
    completeS3MultipartUploadAsync(uploadId, meta, sizeBytes);

    res.json({
      success: true,
      status: 'processing',
      message: 'Assembly started in background'
    });
  } catch (err) {
    console.error('[Upload Complete Route Error]', err);
    res.status(500).json({ error: err.message });
  }
});

// 5b. Get Async Assembly Status
router.get('/upload/status/:uploadId', (req, res) => {
  const task = uploadTasks.get(req.params.uploadId);
  if (!task) {
    return res.status(404).json({ error: 'Upload task not found' });
  }
  res.json(task);
});

// 5c. Get Chunk Status for Resume Verification (Vercel-safe serverless polling)
router.get('/upload/chunk-status/:uploadId', async (req, res) => {
  try {
    const { uploadId } = req.params;
    const metaKey = `uploads_meta/${uploadId}.json`;
    const meta = await r2StorageService.downloadJson(metaKey);

    if (!meta) {
      return res.json({ exists: false, uploadedChunks: [] });
    }

    const listCmd = new ListPartsCommand({
      Bucket: r2StorageService.bucketName,
      Key: meta.s3Key,
      UploadId: meta.s3UploadId,
    });
    const listRes = await r2StorageService.client.send(listCmd);

    const uploadedChunks = (listRes.Parts || []).map(p => p.PartNumber - 1);
    res.json({ exists: true, uploadedChunks });
  } catch (err) {
    console.error('[Chunk Status Route Error]', err);
    res.status(500).json({ error: err.message });
  }
});

// 6. Direct HTTP/HTTPS URL Remote Cloud Download Ingestion
router.post('/remote-upload', async (req, res) => {
  try {
    const { url, fileName } = req.body;
    if (!url) {
      return res.status(400).json({ error: 'Direct file URL is required' });
    }

    // Parse file name from URL
    let parsedName = fileName;
    if (!parsedName) {
      try {
        const u = new URL(url);
        parsedName = decodeURIComponent(path.basename(u.pathname)) || 'Cloud_Remote_Download';
      } catch (_) {
        parsedName = 'Remote_Cloud_Download.zip';
      }
    }

    if (parsedName && isFileRestricted(parsedName)) {
      return res.status(400).json({ success: false, error: 'This file format is not supported for security reasons.' });
    }

    const quota = checkUserStorageQuota(req);
    if (!quota.allowed) {
      return res.status(403).json(quota);
    }

    const ext = parsedName.includes('.') ? parsedName.split('.').pop().toLowerCase() : 'dat';
    const isVideo = ['mp4', 'mkv', 'mov', 'webm', 'avi'].includes(ext);
    const safeName = `remote_${Date.now()}_${parsedName.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
    const r2Key = `uploads/${safeName}`;
    const localPath = path.join(uploadsDir, safeName);
    const publicR2Url = `${env.r2.publicDomain}/${r2Key}`;

    console.log(`[Remote Download] Starting download: ${url}`);

    const http = url.startsWith('https') ? require('https') : require('http');

    // Download file from URL to local disk
    const downloadToFile = (downloadUrl, destPath) => {
      return new Promise((resolve, reject) => {
        const fileStream = fs.createWriteStream(destPath);
        const request = http.get(downloadUrl, (response) => {
          // Follow redirects (301, 302, 307, 308)
          if ([301, 302, 307, 308].includes(response.statusCode) && response.headers.location) {
            fileStream.close();
            fs.unlinkSync(destPath);
            return resolve(downloadToFile(response.headers.location, destPath));
          }

          if (response.statusCode !== 200) {
            fileStream.close();
            return reject(new Error(`Download failed: HTTP ${response.statusCode}`));
          }

          const totalSize = parseInt(response.headers['content-length'] || '0', 10);
          let downloaded = 0;

          response.on('data', (chunk) => {
            downloaded += chunk.length;
          });

          response.pipe(fileStream);
          fileStream.on('finish', () => {
            fileStream.close();
            resolve({ totalSize: totalSize || downloaded, downloaded });
          });
        });

        request.on('error', (err) => {
          fileStream.close();
          reject(err);
        });

        // 5 minute timeout for large files
        request.setTimeout(5 * 60 * 1000, () => {
          request.destroy();
          reject(new Error('Download timeout after 5 minutes'));
        });
      });
    };

    const dlResult = await downloadToFile(url, localPath);
    const fileSizeBytes = fs.statSync(localPath).size;
    console.log(`[Remote Download] ✅ Downloaded ${(fileSizeBytes / 1024 / 1024).toFixed(1)} MB to disk`);

    // Upload to Cloudflare R2
    const mimeType = isVideo ? 'video/mp4' : 'application/octet-stream';
    try {
      const buffer = fs.readFileSync(localPath);
      await r2StorageService.uploadBuffer(r2Key, buffer, mimeType);
      console.log(`[Remote Download] ✅ Uploaded to Cloudflare R2: ${r2Key}`);
    } catch (r2Err) {
      console.error(`[Remote Download] R2 upload error: ${r2Err.message}`);
    }

    // Clean up local file after R2 upload
    try { fs.unlinkSync(localPath); } catch (_) { }

    res.json({
      success: true,
      status: 'completed',
      file: {
        id: `node_${Date.now()}`,
        name: parsedName,
        sizeBytes: fileSizeBytes,
        extension: ext,
        isVideo: isVideo,
        r2Key: r2Key,
        publicUrl: publicR2Url,
        streamUrl: isVideo ? publicR2Url : null,
        downloadUrl: publicR2Url,
        sourceUrl: url,
        uploadedAt: new Date().toISOString(),
      }
    });
  } catch (err) {
    console.error('Remote Upload Error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// 7. Create Short Share Link (For Viral Video Preview & File Download)
const handleShareCreate = async (req, res) => {
  try {
    const fileData = req.body;
    if (!fileData || (!fileData.name && !fileData.fileName)) {
      return res.status(400).json({ error: 'Invalid file data' });
    }
    fileData.name = fileData.name || fileData.fileName;

    const host = req.get('host');
    // Handle proxy protocols on Vercel/cloud hosting
    const protocol = req.headers['x-forwarded-proto'] || req.protocol;
    const requestAppUrl = `${protocol}://${host}`;

    let referralCode = fileData.referralCode;
    const userId = fileData.userId || fileData.creatorUserId || req.headers['x-user-id'] || '';
    const userEmail = (fileData.email || fileData.creatorEmail || req.headers['x-user-email'] || '').toString().trim().toLowerCase();

    // Look up or auto-enroll the webmaster profile
    let profile = null;
    if (referralCode) {
      profile = webmasterService.getProfile(referralCode);
    }
    if (!profile && (userId || userEmail)) {
      profile = webmasterService.getProfile(userId || userEmail);
    }

    if (profile && profile.referralCode) {
      referralCode = profile.referralCode;
    }

    if (referralCode) {
      fileData.referralCode = referralCode;
    }
    if (userId) {
      fileData.userId = userId;
      fileData.creatorUserId = userId;
    }

    const customCode = fileData.code || fileData.shortCode;
    const share = await shareService.createShare(fileData, customCode, requestAppUrl);

    // Link back to webmaster profile sharedLinks list ONLY for VIDEO files!
    if (isVideoFile(share)) {
      const targetProfile = profile || (referralCode ? webmasterService.getProfile(referralCode) : null);
      if (targetProfile) {
        targetProfile.sharedLinks ??= [];
        const rawFileName = share.fileName || fileData.name || 'Shared Video';
        const existingIdx = targetProfile.sharedLinks.findIndex(l =>
          l.shortCode === share.code ||
          l.id === share.code ||
          (share.downloadUrl && l.originalUrl === share.downloadUrl) ||
          (rawFileName && (l.fileName === rawFileName || l.originalUrl?.endsWith(rawFileName)))
        );

        const newEntry = {
          id: share.code,
          shortCode: share.code,
          originalUrl: share.downloadUrl || share.streamUrl || '',
          monetizedUrl: share.shareUrl || `https://airbox.one/s/${share.code}?ref=${targetProfile.referralCode}`,
          fileName: rawFileName,
          createdAt: share.createdAt || new Date().toISOString(),
          clicks: share.viewsCount || 0,
          videoPlays: 0,
          newUsers: 0,
          earningsUsd: 0.0,
        };

        if (existingIdx === -1) {
          targetProfile.sharedLinks.unshift(newEntry);
        } else {
          // Update in place preserving statistics
          targetProfile.sharedLinks[existingIdx] = {
            ...targetProfile.sharedLinks[existingIdx],
            id: share.code,
            shortCode: share.code,
            originalUrl: share.downloadUrl || targetProfile.sharedLinks[existingIdx].originalUrl,
            monetizedUrl: share.shareUrl || targetProfile.sharedLinks[existingIdx].monetizedUrl,
            fileName: rawFileName,
          };
        }
        webmasterService._saveWebmastersToDisk();
      }
    }

    res.json({
      success: true,
      share,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

router.post('/shares', handleShareCreate);
router.post('/share/create', handleShareCreate);

// 8. Get Share Link Metadata (with Webmaster Referral Code & IP Attribution)
router.get('/share/:code', async (req, res) => {
  try {
    const share = await shareService.getShare(req.params.code);
    if (!share) {
      return res.status(404).json({ error: 'Share link not found or expired' });
    }

    // Resolve creator's referral code if not already attached
    let refCode = (share.referralCode || req.query.ref || '').toString().trim().toUpperCase();
    if (!refCode) {
      const creatorId = (share.creatorUserId || share.userId || '').toString().trim();
      const creatorEmail = (share.creatorEmail || share.email || '').toString().trim().toLowerCase();
      const creatorName = (share.creatorName || share.userName || '').toString().trim();

      for (const [code, p] of webmasterService.profiles.entries()) {
        const pEmail = (p.email || '').toLowerCase();
        const pUserId = (p.userId || '').toString();
        if (
          (creatorId && (pUserId === creatorId || code === creatorId || p.referralCode === creatorId)) ||
          (creatorEmail && (pEmail === creatorEmail || code === creatorEmail)) ||
          (creatorName && (p.name === creatorName || pEmail === creatorName.toLowerCase()))
        ) {
          refCode = (p.referralCode || code).toString().trim().toUpperCase();
          share.referralCode = refCode;
          break;
        }
      }

      if (!refCode) {
        try {
          const u = authService.getUser(creatorId || creatorEmail || creatorName);
          if (u && u.webmasterReferralCode) {
            refCode = u.webmasterReferralCode.toString().trim().toUpperCase();
            share.referralCode = refCode;
          }
        } catch (_) { }
      }
    }

    // Register IP attribution for app client
    try {
      const rawIp = req.headers['cf-connecting-ip'] || req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket?.remoteAddress || '127.0.0.1';
      const clientIp = rawIp.replace(/^::ffff:/, '');
      if (refCode) {
        const attribution = {
          token: `ip_${clientIp}`,
          refCode: refCode,
          webmasterUserId: share.creatorUserId || share.userId || '',
          clientIp: clientIp,
          timestamp: Date.now(),
          isUsed: false,
        };
        referralService.pendingAttributions.set(`ip_${clientIp}`, attribution);
        referralService.pendingAttributions.set(`ip_${rawIp}`, attribution);
      }
    } catch (_) { }

    res.json({
      ...share,
      referralCode: refCode || share.referralCode || '',
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Public System Config Endpoint for Mobile Clients & Web
router.get('/config/public', (req, res) => {
  res.json({
    success: true,
    config: systemConfigStore.getPublicConfig(),
  });
});

router.get('/config', (req, res) => {
  res.json({
    success: true,
    config: systemConfigStore.getPublicConfig(),
  });
});

// Public Notifications Endpoint for Mobile Clients
router.get('/notifications', (req, res) => {
  const { limit = 20, isWebmaster = 'false' } = req.query;
  const notifications = notificationService.getClientNotifications(
    parseInt(limit) || 20,
    isWebmaster === 'true'
  );
  res.json({
    success: true,
    notifications,
  });
});

// Register FCM Device Push Token for Background & Closed App Delivery
router.post('/notifications/register-token', (req, res) => {
  const { token, platform, email, userId } = req.body;
  if (!token) {
    return res.status(400).json({ success: false, message: 'Token is required' });
  }
  const registered = notificationService.registerPushToken({ token, platform, email, userId });
  res.json({
    success: registered,
    message: registered ? 'Device push token registered successfully' : 'Failed to register token',
  });
});

// Webmaster Program Master Status for Mobile App and Web Portal
router.get(['/webmaster/status', '/webmaster/program-status'], (req, res) => {
  const cfg = systemConfigStore.getPublicConfig();
  res.json({
    success: true,
    enabled: !!cfg.webmaster_program_enabled,
    title: cfg.webmaster_disabled_title,
    subtitle: cfg.webmaster_disabled_subtitle,
    message: cfg.webmaster_disabled_message,
    cpmRateUsd: cfg.global_cpm_rate_usd,
    cpaRewardUsd: cfg.cpa_reward_per_install_usd,
    minWithdrawalUsd: cfg.min_withdrawal_usd,
  });
});

// ═══════════════════════════════════════════════
//  9. WEBMASTER PROGRAM ENDPOINTS
// ═══════════════════════════════════════════════

// Helper: Authenticate Webmaster Requests via Cryptographic HMAC SSO Token, JWT, or App Session User
function authenticateWebmasterRequest(req) {
  const authHeader = req.headers.authorization || '';
  const tokenHeader = req.headers['x-webmaster-token'] || req.headers['x-sso-token'] || req.headers['x-app-token'] || '';
  const queryToken = req.query.token || req.query.ssoToken || '';
  const bodyToken = (req.body && (req.body.token || req.body.ssoToken)) || '';

  const candidateToken = (tokenHeader || queryToken || bodyToken || (authHeader.startsWith('Bearer ') ? authHeader.substring(7) : authHeader)).toString().trim();

  // 1. Check SSO Cryptographic Token
  if (candidateToken && candidateToken.startsWith('sso_')) {
    const ssoVerify = webmasterService.verifySsoLaunchToken(candidateToken);
    if (ssoVerify && ssoVerify.valid) {
      return {
        authenticated: true,
        userId: (ssoVerify.ssoData && ssoVerify.ssoData.userId) || ssoVerify.userId || '',
        email: (ssoVerify.ssoData && ssoVerify.ssoData.email) || ssoVerify.email || '',
        referralCode: (ssoVerify.ssoData && ssoVerify.ssoData.referralCode) || ssoVerify.referralCode || '',
        profile: ssoVerify.profile,
        isEnrolled: ssoVerify.isEnrolled
      };
    }
  }

  // 2. Check App User query parameters / headers / body
  const rawUserId = (req.query.userId || req.query.id || req.body?.userId || req.body?.id || req.headers['x-user-id'] || '').toString().trim();
  const rawEmail = (req.query.email || req.body?.email || req.headers['x-user-email'] || '').toString().trim().toLowerCase();
  const rawRef = (req.query.referralCode || req.query.ref || req.query.code || req.body?.referralCode || req.body?.refCode || req.body?.ref || '').toString().trim().toUpperCase();

  if (rawRef || rawUserId || rawEmail) {
    const profile = webmasterService.getProfile(rawRef || rawUserId || rawEmail);
    const isEnrolled = !!(profile && profile.referralCode);
    return {
      authenticated: true,
      userId: (profile && profile.userId) || rawUserId,
      email: (profile && profile.email) || rawEmail,
      referralCode: (profile && profile.referralCode) || rawRef,
      profile: isEnrolled ? profile : null,
      isEnrolled
    };
  }

  // 3. Check standard JWT auth token
  if (candidateToken && !candidateToken.startsWith('sso_')) {
    try {
      const decoded = jwt.verify(candidateToken, env.jwtSecret || 'terabox_secret_salt_2026');
      if (decoded && (decoded.id || decoded.userId || decoded.email)) {
        const uId = decoded.id || decoded.userId || '';
        const uEmail = (decoded.email || '').toLowerCase();
        const profile = webmasterService.getProfile(uId || uEmail);
        const isEnrolled = !!(profile && profile.referralCode);
        return {
          authenticated: true,
          userId: uId,
          email: uEmail,
          referralCode: profile ? profile.referralCode : '',
          profile: isEnrolled ? profile : null,
          isEnrolled
        };
      }
    } catch (_) { }
  }

  return { authenticated: false, reason: 'Invalid, expired, or missing AirBox app security credentials.' };
}

// Generate Secure SSO Launch Token for Authorized App User
router.post('/webmaster/launch-token', (req, res) => {
  const { userId, id, email, refCode, referralCode } = req.body || {};
  const cleanId = (userId || id || '').trim();
  const cleanEmail = (email || '').trim().toLowerCase();
  const cleanRef = (referralCode || refCode || '').trim().toUpperCase();

  if (!cleanId && !cleanEmail && !cleanRef) {
    return res.status(400).json({ success: false, error: 'User identification required' });
  }

  const sso = webmasterService.createSsoLaunchToken(cleanId, cleanEmail, cleanRef);
  return res.json({
    success: true,
    token: sso.token,
    userId: sso.userId,
    email: sso.email,
    referralCode: sso.referralCode,
    expiresAt: sso.expiresAt,
  });
});

// Fetch Webmaster Profile (Strict per-user security isolation & live disk sync)
router.get('/webmaster/profile', (req, res) => {
  webmasterService._loadWebmastersFromDisk(); // Reload latest state from disk

  const auth = authenticateWebmasterRequest(req);
  if (!auth.authenticated) {
    return res.status(401).json({
      success: false,
      isEnrolled: false,
      error: 'Unauthorized: Webmaster portal requires a valid AirBox mobile app session token or user ID.',
      requiresAppAuth: true
    });
  }

  let profile = auth.profile || webmasterService.getProfile(auth.referralCode || auth.userId || auth.email);

  // If not enrolled yet, return isEnrolled: false (Strict: Do not auto-enroll)
  if (!profile || !profile.referralCode) {
    return res.json({
      success: true,
      isEnrolled: false,
      userId: auth.userId,
      email: auth.email,
      profile: null,
      message: 'User is not yet enrolled in Webmaster Partner Program',
    });
  }

  // Auto-sync any video shares created by this user (Strict deduplication by unique video file)
  profile.sharedLinks ??= [];
  const uniqueMap = new Map();
  for (const l of profile.sharedLinks) {
    if (!isVideoFile(l)) continue;
    const cleanName = l.fileName || (l.originalUrl ? l.originalUrl.split('?')[0].split('/').pop() : '');
    const cleanKey = l.originalUrl || cleanName || l.shortCode || l.id;
    if (!uniqueMap.has(cleanKey)) {
      uniqueMap.set(cleanKey, l);
    }
  }

  const refCodeClean = profile.referralCode;
  const ownerUserId = profile.userId;
  const ownerEmail = (profile.email || '').toLowerCase();

  for (const [sCode, share] of shareService.shares.entries()) {
    if (!isVideoFile(share)) continue; // STRICTLY ONLY VIDEOS
    const isOwner = (share.referralCode && share.referralCode === refCodeClean) ||
      (share.creatorUserId && (share.creatorUserId === ownerUserId || (ownerEmail && share.creatorEmail && share.creatorEmail.toLowerCase() === ownerEmail))) ||
      (share.userId && (share.userId === ownerUserId || (ownerEmail && share.userEmail && share.userEmail.toLowerCase() === ownerEmail)));
    if (isOwner) {
      const cleanName = share.fileName || (share.downloadUrl ? share.downloadUrl.split('?')[0].split('/').pop() : '');
      const cleanKey = share.downloadUrl || cleanName || sCode;
      if (uniqueMap.has(cleanKey)) {
        const existing = uniqueMap.get(cleanKey);
        if (!existing.shortCode) existing.shortCode = sCode;
        if (!existing.id) existing.id = sCode;
        existing.clicks = existing.clicks || share.viewsCount || 0;
      } else {
        uniqueMap.set(cleanKey, {
          id: sCode,
          shortCode: sCode,
          originalUrl: share.downloadUrl || share.streamUrl || '',
          monetizedUrl: share.shareUrl || `https://airbox.one/s/${sCode}?ref=${refCodeClean}`,
          fileName: share.fileName || 'Shared Video',
          createdAt: share.createdAt || new Date().toISOString(),
          clicks: share.viewsCount || 0,
          videoPlays: 0,
          newUsers: 0,
          earningsUsd: 0.0,
        });
      }
    }
  }

  profile.sharedLinks = Array.from(uniqueMap.values());

  // 1. Unify totalClicks with exact aggregate sum of shared link clicks
  const sumLinkClicks = profile.sharedLinks.reduce((acc, l) => acc + (l.clicks || 0), 0);
  profile.totalClicks = Math.max(profile.totalClicks || 0, sumLinkClicks);

  // 2. Unify today's stats clicks if exists
  if (Array.isArray(profile.stats) && profile.stats.length > 0) {
    const todayStr = new Date().toISOString().substring(0, 10);
    const todayStat = profile.stats.find(s => s && s.date === todayStr);
    if (todayStat) {
      todayStat.clicks = todayStat.clicks || todayStat.linkClicks || 0;
      todayStat.linkClicks = todayStat.clicks;
    }
  }

  // Ensure latest withdrawal statuses are completely synced from global ledger
  if (!Array.isArray(profile.withdrawals)) {
    profile.withdrawals = [];
  }
  if (Array.isArray(webmasterService.withdrawals)) {
    for (const gw of webmasterService.withdrawals) {
      if (!gw) continue;
      const gwRef = (gw.referralCode || '').toUpperCase();
      const profRef = (profile.referralCode || '').toUpperCase();
      if (gwRef && profRef && gwRef === profRef) {
        const existing = profile.withdrawals.find(w => w && (w.id === gw.id || (w.id && gw.id && w.id.toString().toLowerCase() === gw.id.toString().toLowerCase())));
        if (!existing) {
          profile.withdrawals.unshift(gw);
        }
      }
    }
    for (const w of profile.withdrawals) {
      if (!w) continue;
      const match = webmasterService.withdrawals.find(gw => gw && (gw.id === w.id || (gw.id && w.id && gw.id.toString().toLowerCase() === w.id.toString().toLowerCase())));
      if (match) {
        const rawStatus = (match.status || '').toLowerCase();
        if (rawStatus === 'paid' || rawStatus === 'approved' || rawStatus === 'settled' || rawStatus === 'completed') {
          w.status = 'paid';
        } else if (rawStatus === 'rejected' || rawStatus === 'declined' || rawStatus === 'cancelled') {
          w.status = 'rejected';
        } else {
          w.status = 'pending';
        }
        w.processedAt = match.processedAt || w.processedAt;
        w.processedBy = match.processedBy || w.processedBy;
        w.transactionHash = match.transactionHash || w.transactionHash;
        w.rejectionReason = match.rejectionReason || w.rejectionReason;
      }
    }
  }

  res.json({ success: true, isEnrolled: true, profile });
});

// Enroll / Join Webmaster Program
router.post('/webmaster/enroll', (req, res) => {
  if (!systemConfigStore.config.webmaster_program_enabled) {
    return res.status(403).json({
      success: false,
      isProgramDisabled: true,
      error: systemConfigStore.config.webmaster_disabled_title || 'Webmaster Program currently undergoing upgrades',
      message: systemConfigStore.config.webmaster_disabled_message,
    });
  }

  const auth = authenticateWebmasterRequest(req);
  if (!auth.authenticated) {
    return res.status(401).json({
      success: false,
      error: 'Unauthorized: Valid app security token required to enroll in Webmaster Program.',
      requiresAppAuth: true
    });
  }

  const targetUserId = auth.userId || auth.email;
  const userEmail = auth.email || (targetUserId.includes('@') ? targetUserId : '');
  const result = webmasterService.enroll(targetUserId, userEmail);

  // Also update user profile in authService persistent store if exists
  try {
    let authUser = authService.users.get(targetUserId);
    if (!authUser && userEmail) {
      authUser = authService.users.get(userEmail.toLowerCase());
    }
    if (!authUser) {
      for (const u of authService.users.values()) {
        if (u.email === targetUserId || u.id === targetUserId || (userEmail && u.email === userEmail)) {
          authUser = u;
          break;
        }
      }
    }
    if (authUser && result.profile) {
      authUser.isWebmasterEnrolled = true;
      authUser.webmasterReferralCode = result.profile.referralCode;
      authService._saveUsersToDisk();
    }
  } catch (_) { }

  const deviceFp = req.body?.deviceFingerprint || req.headers['x-device-fingerprint'];
  if (deviceFp) {
    referralService.registerWebmasterDevice(targetUserId, deviceFp);
    if (userEmail) referralService.registerWebmasterDevice(userEmail, deviceFp);
  }

  res.json({ success: true, profile: result.profile, isNew: result.isNew });
});

// Switch Plan
router.post('/webmaster/switch-plan', (req, res) => {
  const auth = authenticateWebmasterRequest(req);
  if (!auth.authenticated) {
    return res.status(401).json({
      success: false,
      error: 'Unauthorized: Valid app security token required.',
      requiresAppAuth: true
    });
  }

  const { plan } = req.body || {};
  const referralCode = auth.referralCode || (auth.profile && auth.profile.referralCode);
  if (!referralCode || !plan) {
    return res.status(400).json({ error: 'referralCode and plan are required' });
  }
  const success = webmasterService.switchPlan(referralCode, plan);
  if (!success) {
    return res.status(404).json({ error: 'Profile not found' });
  }
  res.json({ success: true, currentPlan: plan });
});

// Submit Withdrawal
router.post('/webmaster/withdraw', (req, res) => {
  if (!systemConfigStore.get('webmaster_program_enabled', true)) {
    return res.status(403).json({
      success: false,
      error: 'Webmaster payouts are temporarily paused during scheduled maintenance',
    });
  }

  const auth = authenticateWebmasterRequest(req);
  if (!auth.authenticated) {
    return res.status(401).json({
      success: false,
      error: 'Unauthorized: Valid app security token required for payout request.',
      requiresAppAuth: true
    });
  }

  const { amountUsd, method, accountInfo } = req.body || {};
  const referralCode = auth.referralCode || (auth.profile && auth.profile.referralCode);
  if (!referralCode || !amountUsd || !method || !accountInfo) {
    return res.status(400).json({ success: false, error: 'Missing withdrawal fields' });
  }

  const cleanAccount = (accountInfo || '').toString().trim();
  const rawMethod = (method || '').toString().toLowerCase();

  // Validate UPI Format
  if (rawMethod.includes('upi')) {
    const upiRegex = /^[a-zA-Z0-9.\-_]{2,256}@[a-zA-Z]{2,64}$/;
    if (!upiRegex.test(cleanAccount)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid UPI ID format. Please enter a valid UPI ID (e.g. username@oksbi or phone@paytm)',
      });
    }
  }

  // Validate USDT BEP-20 (Binance Smart Chain) Format
  if (rawMethod.includes('usdt') || rawMethod.includes('crypto')) {
    const bep20Regex = /^0x[a-fA-F0-9]{40}$/;
    if (!bep20Regex.test(cleanAccount)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid USDT BEP-20 address. Must be a valid 42-character Binance Smart Chain (BSC) address starting with 0x.',
      });
    }
  }

  const minUsd = systemConfigStore.get('min_withdrawal_usd', 1.0);
  const requested = parseFloat(amountUsd);
  if (isNaN(requested) || requested < minUsd) {
    return res.status(400).json({
      success: false,
      error: `Minimum withdrawal amount is $${minUsd.toFixed(2)} USD`,
    });
  }

  try {
    const record = webmasterService.submitWithdrawal(referralCode, {
      amountUsd: requested,
      method,
      accountInfo: cleanAccount,
    });
    res.json({ success: true, record });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// ═════════════════════════════════════════════════════════════════════
// 🛡️ MILITARY-GRADE ANTI-FRAUD & MODEL 1 WATCH-TIME VERIFICATION ENGINE
// ═════════════════════════════════════════════════════════════════════

// 1. Generate Proof-of-Watch Session Nonce & Record Real Unique Link Click
router.post('/webmaster/session-nonce/:code', async (req, res) => {
  if (!systemConfigStore.get('webmaster_program_enabled', true)) {
    return res.status(403).json({
      success: false,
      isProgramDisabled: true,
      error: systemConfigStore.get('webmaster_disabled_title', 'Creator Program Upgrades in Progress'),
      message: systemConfigStore.get(
        'webmaster_disabled_message',
        'The Webmaster Monetization Center is currently undergoing scheduled enhancements.'
      ),
    });
  }

  const share = await shareService.getShare(req.params.code);
  if (!share) {
    return res.status(404).json({ error: 'Share link not found' });
  }

  const { fingerprint, isRepeatSession } = req.body || {};
  const clientIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '127.0.0.1';
  const country = fraudDetectionService.detectCountry(req);
  const botCheck = fraudDetectionService.isDatacenterOrBot(req, clientIp);

  // Click Anti-Fraud Check (Prevents Chrome F5 / Page Reload spamming)
  const clickDedup = fraudDetectionService.checkClickDeduplication({
    clientIp,
    shareCode: share.code,
    fingerprint,
    isRepeatSession: !!isRepeatSession,
  });

  let refCode = share.referralCode || req.query.ref;
  if (!refCode && (share.creatorUserId || share.userId)) {
    const uid = (share.creatorUserId || share.userId).toString().trim();
    for (const [code, p] of webmasterService.profiles.entries()) {
      if (p.userId === uid || p.email === uid || p.referralCode === uid || code === uid) {
        refCode = code;
        share.referralCode = code;
        break;
      }
    }
  }

  let profile = null;
  if (refCode) {
    profile = webmasterService.getProfile(refCode);
  }

  const cpmTier = fraudDetectionService.getCpmTier(country);

  // Session nonce is for video playback proof-of-watch (clicks are recorded cleanly on /s/:code page load)
  const session = fraudDetectionService.generateSessionNonce(share.code, clientIp);
  const requiredWatchSeconds = fraudDetectionService.calculateWatchThreshold(share.durationSeconds || 120);

  const crypto = require('crypto');
  const nonceSecret = process.env.FRAUD_NONCE_SECRET || 'terabox_anti_fraud_secret_salt_2026';
  const clientToken = crypto
    .createHmac('sha256', nonceSecret)
    .update(`${session.nonce}:${share.code}:${Math.floor(requiredWatchSeconds)}`)
    .digest('hex');

  res.json({
    success: true,
    nonce: session.nonce,
    clientToken,
    country,
    cpmRateUsd: cpmTier.cpmRateUsd,
    requiredWatchSeconds,
    clickCounted: true,
    dedupReason: null,
  });
});

// 2. Proof-of-Watch Verification & Dynamic Country CPM Credit (Model 1 Engine)
router.post('/webmaster/verify-watch', async (req, res) => {
  if (!systemConfigStore.get('webmaster_program_enabled', true)) {
    return res.status(403).json({
      success: false,
      isProgramDisabled: true,
      error: 'Webmaster program is currently disabled for upgrades',
    });
  }

  const { code, nonce, watchSeconds, videoDuration, fingerprint, clientToken } = req.body;

  if (!code || !nonce || !clientToken) {
    return res.status(400).json({ success: false, error: 'Missing Proof-of-Watch verification parameters' });
  }

  const share = await shareService.getShare(code);
  if (!share) {
    return res.status(404).json({ success: false, error: 'Share link not found' });
  }

  // 0. Ensure share is a valid video file
  if (!isVideoFile(share)) {
    return res.status(400).json({ success: false, error: 'Only video files are eligible for Webmaster CPM monetization' });
  }

  const clientIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '127.0.0.1';

  // 1. Bot & Datacenter Check
  const botCheck = fraudDetectionService.isDatacenterOrBot(req, clientIp);
  if (botCheck.isBot) {
    return res.status(403).json({ success: false, error: 'Invalid Traffic: ' + botCheck.reason, cpmRateUsd: 0.0 });
  }

  // 2. Cryptographic Nonce & Watch-Time Threshold Verification (Model 1)
  const verifyResult = fraudDetectionService.verifyWatchToken({
    nonce,
    code,
    watchSeconds,
    videoDuration: videoDuration || share.durationSeconds,
    clientToken,
    fingerprint,
    clientIp,
  });

  if (!verifyResult.valid) {
    return res.status(400).json({
      success: false,
      error: verifyResult.reason,
      requiredThreshold: verifyResult.requiredThreshold,
      actualWatch: verifyResult.actualWatch,
    });
  }

  // 3. 24-Hour Deduplication & VPN Ring Check (Safely resolving file identifier)
  const targetFileId = share.code || share.fileId || share.id || 'share_video';
  const dedup = fraudDetectionService.checkDeduplication(clientIp, targetFileId, fingerprint);
  if (!dedup.allowed) {
    return res.json({ success: true, verified: false, counted: false, reason: dedup.reason });
  }

  // 4. Resolve Webmaster Referral Code
  let refCode = share.referralCode || req.query.ref;
  if (!refCode && (share.creatorUserId || share.userId)) {
    const uid = (share.creatorUserId || share.userId).toString().trim();
    for (const [c, p] of webmasterService.profiles.entries()) {
      if (p.userId === uid || p.email === uid || p.referralCode === uid || c === uid) {
        refCode = c;
        share.referralCode = c;
        break;
      }
    }
  }

  if (!refCode) {
    return res.status(404).json({ success: false, error: 'Webmaster profile not bound to share' });
  }

  const profile = webmasterService.getProfile(refCode);

  // 5. Country Detection & Dynamic CPM Payout
  const country = fraudDetectionService.detectCountry(req);
  const tier = fraudDetectionService.getCpmTier(country);
  const earnPerView = tier.ratePerViewUsd;

  if (profile) {
    profile.walletBalanceUsd = Math.round(((profile.walletBalanceUsd || 0) + earnPerView) * 10000) / 10000;

    // Update Daily Stats with Country Breakdown
    const todayStr = new Date().toISOString().substring(0, 10);
    profile.stats ??= [];
    let todayStat = profile.stats.find(s => s.date === todayStr);
    if (!todayStat) {
      todayStat = { date: todayStr, clicks: 0, videoPlays: 0, newUsers: 0, earningsUsd: 0.0, countryBreakdown: {} };
      profile.stats.push(todayStat);
    }
    todayStat.videoPlays = (todayStat.videoPlays || 0) + 1;
    todayStat.earningsUsd = Math.round(((todayStat.earningsUsd || 0) + earnPerView) * 10000) / 10000;
    todayStat.countryBreakdown ??= {};
    todayStat.countryBreakdown[country] = (todayStat.countryBreakdown[country] || 0) + 1;

    // Update Specific Link Stats
    profile.sharedLinks ??= [];
    let link = profile.sharedLinks.find(l => l.shortCode === share.code || l.id === share.code);
    if (!link) {
      link = {
        id: share.code,
        shortCode: share.code,
        originalUrl: share.downloadUrl || share.streamUrl || '',
        monetizedUrl: share.shareUrl || `https://airbox.one/s/${share.code}?ref=${refCode}`,
        fileName: share.fileName || 'Shared Video',
        createdAt: share.createdAt || new Date().toISOString(),
        clicks: 1,
        videoPlays: 0,
        newUsers: 0,
        earningsUsd: 0.0,
      };
      profile.sharedLinks.unshift(link);
    }
    link.videoPlays = (link.videoPlays || 0) + 1;
    link.earningsUsd = Math.round(((link.earningsUsd || 0) + earnPerView) * 10000) / 10000;

    // Detailed Audit Earning Record
    profile.earningRecords ??= [];
    profile.earningRecords.unshift({
      id: `earn_${Date.now()}`,
      type: 'videoPlays',
      amountUsd: earnPerView,
      description: `Verified video play view on ${share.fileName || 'Video'} ($${tier.cpmRateUsd.toFixed(2)} CPM)`,
      country,
      cpmRateUsd: tier.cpmRateUsd,
      recordedAt: new Date().toISOString(),
    });

    // 6. Referral Attribution Bridge: If the watcher is a new user without an existing referral, attribute them to this Webmaster!
    try {
      const watcherId = req.headers['x-user-id'] || req.body?.userId || '';
      const watcherEmail = req.headers['x-user-email'] || req.body?.userEmail || '';
      if (watcherId || watcherEmail) {
        const u = authService.getUser(watcherId || watcherEmail);
        if (u) {
          const uId = (u.id || '').trim();
          const uEmail = (u.email || '').trim().toLowerCase();
          const webmasterId = (profile.userId || '').trim();
          const webmasterEmail = (profile.email || '').trim().toLowerCase();

          const isSelf = uId === webmasterId || (uEmail && uEmail === webmasterEmail);
          if (!isSelf) {
            // Check if this user was already attributed as a referral
            let alreadyReferred = false;
            for (const r of referralService.referrals.values()) {
              if ((uId && r.referredUserId === uId) || (uEmail && r.referredUserEmail?.toLowerCase() === uEmail)) {
                alreadyReferred = true;
                break;
              }
            }

            if (!alreadyReferred) {
              console.log(`[Verify-Watch] 🎯 Auto-attributing referral for ${uEmail || uId} to Webmaster ${refCode}!`);
              referralService.onUserRegistered({
                userId: uId,
                email: uEmail,
                name: u.displayName || 'App User',
                deviceFingerprint: fingerprint || '',
                explicitRefCode: refCode,
                clientIp,
              });
            }
          }
        }
      }
    } catch (refErr) {
      console.warn('[Verify-Watch] Note on referral auto-attribution:', refErr.message);
    }

    webmasterService._saveWebmastersToDisk();
  }

  res.json({
    success: true,
    verified: true,
    counted: true,
    country,
    tier: tier.tier,
    cpmRateUsd: tier.cpmRateUsd,
    earnedUsd: earnPerView,
    actualWatch: verifyResult.actualWatch,
    requiredThreshold: verifyResult.requiredThreshold,
  });
});

// Legacy Fallbacks
router.get('/webmaster/track-click/:code', async (req, res) => {
  const share = await shareService.getShare(req.params.code);
  if (!share) return res.status(404).json({ error: 'Share not found' });
  const country = fraudDetectionService.detectCountry(req);
  res.json({ success: true, refCode: share.referralCode, country });
});

router.get('/webmaster/track-play/:code', async (req, res) => {
  const share = await shareService.getShare(req.params.code);
  if (!share) return res.status(404).json({ error: 'Share not found' });
  res.json({ success: true, message: 'Use POST /api/webmaster/verify-watch with Proof-of-Watch' });
});

// ═════════════════════════════════════════════════════════════════════
// 🛡️ COPYRIGHT INFRINGEMENT & DMCA TAKEDOWN REPORTING SYSTEM
// ═════════════════════════════════════════════════════════════════════

const reportsFile = path.join(__dirname, '../../data/reports.json');
function getReports() {
  try {
    if (fs.existsSync(reportsFile)) {
      return JSON.parse(fs.readFileSync(reportsFile, 'utf8'));
    }
  } catch (_) { }
  return [];
}
function saveReports(reports) {
  try {
    const dir = path.dirname(reportsFile);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(reportsFile, JSON.stringify(reports, null, 2), 'utf8');
  } catch (err) {
    console.warn('[API Routes] Could not save reports.json:', err.message);
  }
}

// 1. Submit Statutory Copyright / DMCA Takedown / Violation Notice
// Compliant with: Indian Copyright Act 1957 (Rule 75), IT Rules 2021, DMCA (17 U.S.C. § 512), Google Play IP Policy
async function handleStatutoryNoticeSubmission(req, res) {
  try {
    const {
      shareCode: rawShareCode,
      shareId,
      reason = 'Copyright Infringement / DMCA',
      // Complainant Details
      legalName: rawLegalName,
      reporterName: rawReporterName,
      organization = 'Individual Independent Creator',
      relationship = 'Copyright Owner',
      email: rawEmail,
      reporterEmail: rawReporterEmail,
      phone: rawPhone,
      address: rawAddress,
      country = 'India',
      // Copyrighted Work Details
      workTitle: rawWorkTitle,
      workCategory = 'Video / Cinematographic Film',
      workDescription = '',
      ownershipProofUrl: rawOwnershipProofUrl,
      proofDetails: rawProofDetails,
      // Statutory Declarations & Signature
      declarationGoodFaith,
      declarationPerjury,
      declarationLegalLiability,
      electronicSignature: rawSignature,
      additionalRemarks = '',
    } = req.body;

    const shareCode = (rawShareCode || shareId || '').trim();
    if (!shareCode) {
      return res.status(400).json({ success: false, error: 'Share link code or file identifier is required.' });
    }

    const legalName = (rawLegalName || rawReporterName || '').trim();
    const email = (rawEmail || rawReporterEmail || '').trim().toLowerCase();
    const phone = (rawPhone || '').trim();
    const address = (rawAddress || '').trim();
    const workTitle = (rawWorkTitle || '').trim();
    const ownershipProof = (rawOwnershipProofUrl || rawProofDetails || '').trim();
    const electronicSignature = (rawSignature || '').trim();

    const isCopyrightClaim =
      reason.toLowerCase().includes('copyright') ||
      reason.toLowerCase().includes('dmca') ||
      reason.toLowerCase().includes('piracy') ||
      Boolean(workTitle || rawOwnershipProofUrl);

    // Strict Statutory Validation for Copyright & DMCA Notices
    if (isCopyrightClaim) {
      if (!legalName || legalName.length < 3) {
        return res.status(400).json({
          success: false,
          error: 'Full legal name of the copyright owner or authorized representative is required.'
        });
      }

      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!email || !emailRegex.test(email)) {
        return res.status(400).json({
          success: false,
          error: 'A valid official contact email address is required for legal correspondence.'
        });
      }

      if (!phone || phone.length < 6) {
        return res.status(400).json({
          success: false,
          error: 'A direct contact telephone/mobile number is required under Indian Copyright Rule 75.'
        });
      }

      if (!address || address.length < 5) {
        return res.status(400).json({
          success: false,
          error: 'Complete physical mailing address is required to prevent fraudulent claims.'
        });
      }

      if (!workTitle || workTitle.length < 2) {
        return res.status(400).json({
          success: false,
          error: 'Title and clear identification of the original copyrighted work is required.'
        });
      }

      if (!ownershipProof || ownershipProof.length < 4) {
        return res.status(400).json({
          success: false,
          error: 'Proof of copyright ownership (official link, official channel URL, or Copyright Registration Number) is required.'
        });
      }

      if (declarationGoodFaith !== true && declarationGoodFaith !== 'true') {
        return res.status(400).json({
          success: false,
          error: 'You must affirm the Good Faith declaration under Indian Copyright Act & DMCA.'
        });
      }

      if (declarationPerjury !== true && declarationPerjury !== 'true') {
        return res.status(400).json({
          success: false,
          error: 'You must provide the sworn statement under penalty of perjury & Indian Penal Code / BNS.'
        });
      }

      if (!electronicSignature || electronicSignature.length < 3) {
        return res.status(400).json({
          success: false,
          error: 'A valid electronic signature (typed full legal name) is required to legally sign this notice.'
        });
      }
    } else {
      // General violation reports (CSAM, defamation, malware)
      if (!legalName || legalName.length < 2) {
        return res.status(400).json({ success: false, error: 'Complainant / Reporter name is required.' });
      }
      if (!email || !email.includes('@')) {
        return res.status(400).json({ success: false, error: 'A valid reporter email is required.' });
      }
    }

    const share = await shareService.getShare(shareCode);
    const clientIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '127.0.0.1';
    const userAgent = req.headers['user-agent'] || 'Unknown Client';

    // Generate unique statutory compliance ticket ID
    const ticketPrefix = isCopyrightClaim ? 'DMCA-IN-2026-' : 'TBX-RPT-';
    const reportId = `${ticketPrefix}${Date.now().toString(36).toUpperCase()}${Math.floor(1000 + Math.random() * 9000)}`;

    let creatorEmail = null;
    let creatorStrikes = 0;
    if (share && (share.creatorUserId || share.userId)) {
      const creator = authService.getUser(share.creatorUserId || share.userId);
      if (creator) {
        creatorEmail = creator.email;
        creatorStrikes = creator.strikesCount || 0;
      }
    }

    const directStreamUrl = share ? (share.streamUrl || share.downloadUrl || (share.r2Key ? `${env.r2.publicDomain}/${share.r2Key}` : '')) : '';

    const reportRecord = {
      id: reportId,
      reportId,
      shareCode,
      fileName: share ? share.fileName : 'Unknown Content',
      fileId: share ? (share.fileId || share.targetNodeId) : null,
      fileSize: share ? (share.sizeBytes || 0) : 0,
      isVideo: share ? (share.isVideo !== false) : false,
      previewUrl: directStreamUrl,
      creatorUserId: share ? (share.creatorUserId || share.userId) : null,
      creatorEmail: creatorEmail || (share ? (share.creatorName || share.userId) : 'Unknown Creator'),
      creatorStrikes,
      reason: reason || (isCopyrightClaim ? 'Copyright Infringement / DMCA' : 'Content Policy Violation'),

      // Full Legal Dossier
      isCopyrightClaim,
      legalName,
      reporterName: legalName,
      organization: organization || 'Individual / Rights Holder',
      relationship: relationship || 'Copyright Owner',
      email,
      reporterEmail: email,
      phone,
      address,
      country,

      // Copyrighted Work & Ownership Evidence
      workTitle: workTitle || (isCopyrightClaim ? 'Protected Work' : reason),
      workCategory,
      workDescription: workDescription || ownershipProof,
      ownershipProofUrl: ownershipProof,
      proofDetails: ownershipProof,
      additionalRemarks,

      // Statutory Sworn Affirmations
      declarationGoodFaith: Boolean(declarationGoodFaith),
      declarationPerjury: Boolean(declarationPerjury),
      declarationLegalLiability: Boolean(declarationLegalLiability),
      electronicSignature,

      // Audit Trail
      clientIp,
      userAgent,
      jurisdiction: country || 'India',
      statutoryCompliance: [
        'Indian Copyright Act 1957 (Section 52)',
        'Copyright Rules 2013 (Rule 75)',
        'IT Intermediary Guidelines Rules 2021 (Rule 3)',
        'DMCA 17 U.S.C. § 512(c)(3)',
        'Google Play Store Developer Policy'
      ],
      status: 'PENDING_REVIEW',
      submittedAt: new Date().toISOString(),
    };

    const reports = getReports();
    reports.unshift(reportRecord);
    saveReports(reports);

    console.log(`[Trust & Safety] ⚖️ Statutory Legal Notice Filed: ${reportId} for "${shareCode}" by ${legalName} (${organization})`);

    return res.json({
      success: true,
      reportId,
      ticketNumber: reportId,
      message: 'Statutory infringement notice submitted successfully. Your complaint has been formally registered with the AirBox Grievance Officer and Trust & Safety Legal Desk.',
      submittedAt: reportRecord.submittedAt,
    });
  } catch (err) {
    console.error('[API Routes] Error submitting statutory notice:', err);
    return res.status(500).json({ success: false, error: 'Internal server error processing legal notice.' });
  }
}

router.post('/report/takedown', handleStatutoryNoticeSubmission);
router.post('/reports/submit', handleStatutoryNoticeSubmission);

// 2. Get Standard Report Violation Reasons
router.get('/report/reasons', (req, res) => {
  res.json({
    success: true,
    reasons: [
      { id: 'general_pornography', title: 'General pornography' },
      { id: 'child_pornography', title: 'Child pornography' },
      { id: 'defamation', title: 'Defamation' },
      { id: 'privacy', title: 'Privacy' },
      { id: 'racial_hatred', title: 'Racial hatred' },
      { id: 'deception', title: 'Deception' },
      { id: 'violence', title: 'Violence' },
      { id: 'social_negative', title: 'Social negative' },
      { id: 'dmca_copyright', title: 'Copyright Infringement / Piracy (DMCA)' }
    ]
  });
});

// 3. Track Statutory Notice / Complaint Ticket Status
router.get(['/report/track/:ticketId', '/reports/track/:ticketId', '/report/status/:ticketId'], (req, res) => {
  const ticketId = (req.params.ticketId || '').trim();
  if (!ticketId) {
    return res.status(400).json({ success: false, error: 'Ticket identifier is required.' });
  }

  const reports = getReports();
  const report = reports.find(r => r.id === ticketId || r.reportId === ticketId || r.ticketNumber === ticketId);

  if (!report) {
    return res.status(404).json({
      success: false,
      error: 'Notice or complaint record not found for this ticket ID.',
      ticketId,
    });
  }

  const isResolved = report.status === 'TAKEDOWN_EXECUTED' || report.status === 'RESOLVED' || report.status === 'DISMISSED';

  res.json({
    success: true,
    ticketId: report.id || report.reportId,
    status: report.status || 'PENDING_REVIEW',
    workTitle: report.workTitle || report.reason || 'Protected Content',
    shareCode: report.shareCode,
    fileName: report.fileName || 'Shared Media',
    submittedAt: report.submittedAt,
    actionTakenAt: report.actionTakenAt || null,
    resolvedBy: report.resolvedBy ? 'AirBox Trust & Safety Legal Desk' : null,
    statutorySla: isResolved ? 'Fulfilled (Within Statutory 24-36h)' : 'Active (Under 24-36h Redressal Window)',
    resolutionSummary: report.status === 'TAKEDOWN_EXECUTED'
      ? 'The reported infringing content has been disabled across all CDN distribution channels, Cloudflare R2, and client apps. Strike recorded on creator profile.'
      : report.status === 'DISMISSED'
        ? 'This notice was reviewed by legal counsel and dismissed due to insufficient evidence or duplicate filing.'
        : 'Your notice has been formally docketed with the Grievance Officer and is pending expedited legal review.',
  });
});

// ═════════════════════════════════════════════════════════════════════
// 👥 WEBMASTER EXCLUSIVE REFERRAL & USER ACQUISITION PROGRAM ($0.05/USER)
// ═════════════════════════════════════════════════════════════════════

// 1. Track App Install (Google Play Install Referrer)
router.post('/webmaster/referral/track-install', (req, res) => {
  try {
    const { refCode, installToken, deviceFingerprint, referrerClickTimestamp, installBeginTimestamp } = req.body;
    const clientIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '127.0.0.1';

    const result = referralService.trackInstall({
      refCode,
      installToken,
      deviceFingerprint,
      referrerClickTimestamp,
      installBeginTimestamp,
      clientIp,
    });

    res.json(result);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 2. Check & Evaluate Qualification Milestone (e.g. File Upload >= 2MB, Video Watch >= 60s)
router.post('/webmaster/referral/check-qualification', async (req, res) => {
  try {
    const { userId, milestoneType, metadata } = req.body;
    if (!userId || !milestoneType) {
      return res.status(400).json({ success: false, error: 'userId and milestoneType are required' });
    }

    const result = await referralService.evaluateUserMilestone(userId, milestoneType, metadata || {});
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 3. Fetch Webmaster Referral Ledger & Conversion Analytics
router.get('/webmaster/referrals', (req, res) => {
  try {
    const auth = authenticateWebmasterRequest(req);
    if (!auth.authenticated) {
      return res.status(401).json({
        success: false,
        error: 'Unauthorized: Valid app security token required.',
        requiresAppAuth: true
      });
    }

    const targetId = auth.referralCode || auth.userId || auth.email;
    const ledger = referralService.getWebmasterReferralLedger(targetId);
    if (!ledger) {
      return res.status(404).json({ success: false, error: 'Webmaster profile not found' });
    }

    res.json({ success: true, ...ledger });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 4. Record Referral Link Click
router.get('/webmaster/referral/click/:refCode', (req, res) => {
  try {
    const { refCode } = req.params;
    referralService.recordLinkClick(refCode);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
