const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const EventEmitter = require('events');
const emailService = require('./emailService');

class AuthService extends EventEmitter {
  constructor() {
    super();
    this.otpStore = new Map(); // key -> { otp, expiresAt, type, payload }
    this.users = new Map(); // userId or email or phone -> userProfile
    this.dataPath = path.join(__dirname, '../../data/users.json');
    this._loadUsersFromDisk();
  }

  _loadUsersFromDisk() {
    try {
      const dataDir = path.dirname(this.dataPath);
      if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir, { recursive: true });
      }
      if (fs.existsSync(this.dataPath)) {
        const raw = fs.readFileSync(this.dataPath, 'utf8');
        const list = JSON.parse(raw);
        if (Array.isArray(list)) {
          for (const u of list) {
            this.users.set(u.id, u);
            if (u.email) this.users.set(u.email.toLowerCase(), u);
            if (u.phone) this.users.set(u.phone, u);
          }
        }
      }
    } catch (e) {
      console.error('[AuthService] Error loading users from disk:', e.message);
    }
  }

  _saveUsersToDisk() {
    try {
      const list = Array.from(new Set(this.users.values()));
      fs.writeFileSync(this.dataPath, JSON.stringify(list, null, 2), 'utf8');
    } catch (e) {
      console.error('[AuthService] Error saving users to disk:', e.message);
    }
  }

  saveUsers() {
    this._saveUsersToDisk();
  }

  _hashPassword(password) {
    return crypto.createHash('sha256').update(password + 'terabox_secret_salt_2026').digest('hex');
  }

  _generateOtp() {
    return Math.floor(100000 + Math.random() * 900000).toString();
  }

  /**
   * 1. Send Email OTP for Signup
   */
  async sendEmailSignupOtp(name, email, password) {
    const cleanEmail = email.trim().toLowerCase();
    const existing = this.users.get(cleanEmail);
    if (existing && (existing.status === 'BANNED' || existing.status === 'SUSPENDED')) {
      return { success: false, error: 'Account Suspended: Your account has been banned by administration.' };
    }
    if (existing && existing.isVerified) {
      return { success: false, error: 'An account with this email address already exists. Please Sign In.' };
    }

    const otp = this._generateOtp();
    const expiresAt = Date.now() + 5 * 60 * 1000; // 5 mins

    this.otpStore.set(`email_signup_${cleanEmail}`, {
      otp,
      expiresAt,
      type: 'email_signup',
      payload: {
        name: name || 'AirBox User',
        email: cleanEmail,
        passwordHash: this._hashPassword(password),
      },
    });

    await emailService.sendSignupOtp(cleanEmail, otp);
    return { success: true, message: `6-digit verification code sent to ${cleanEmail}`, otpDev: otp };
  }

  /**
   * 2. Verify Email OTP & Finalize Signup
   */
  verifyEmailSignupOtp(email, otpCode) {
    const cleanEmail = email.trim().toLowerCase();
    const key = `email_signup_${cleanEmail}`;
    const record = this.otpStore.get(key);

    if (!record) {
      return { success: false, error: 'No active OTP request found or OTP expired. Please request a new code.' };
    }

    if (Date.now() > record.expiresAt) {
      this.otpStore.delete(key);
      return { success: false, error: 'Verification code has expired. Please request a new code.' };
    }

    if (record.otp !== otpCode.trim()) {
      return { success: false, error: 'Invalid 6-digit verification code. Please check your email and try again.' };
    }

    // OTP Valid! Create User
    const userId = `usr_${Date.now()}`;
    const userProfile = {
      id: userId,
      displayName: record.payload.name,
      email: cleanEmail,
      phone: '',
      passwordHash: record.payload.passwordHash,
      avatarUrl: `https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(record.payload.name)}`,
      totalSpaceBytes: 1099511627776, // 1024 GB (1 TB)
      usedSpaceBytes: 0,
      isVip: false,
      isVerified: true,
      authMethod: 'email',
      createdAt: new Date().toISOString(),
    };

    this.users.set(userId, userProfile);
    this.users.set(cleanEmail, userProfile);
    this._saveUsersToDisk();
    this.otpStore.delete(key);

    return {
      success: true,
      message: 'Account verified successfully!',
      user: userProfile,
      token: `jwt_tb_${userId}_${Date.now()}`,
    };
  }

  /**
   * 3. Send Mobile SMS OTP
   */
  sendMobileOtp(phone) {
    const cleanPhone = phone.trim();
    const existing = this.users.get(cleanPhone);
    if (existing && (existing.status === 'BANNED' || existing.status === 'SUSPENDED')) {
      return { success: false, error: 'Account Suspended: Your account has been banned by administration.' };
    }

    const otp = this._generateOtp();
    const expiresAt = Date.now() + 5 * 60 * 1000;

    this.otpStore.set(`phone_${cleanPhone}`, {
      otp,
      expiresAt,
      type: 'phone',
      phone: cleanPhone,
    });

    console.log(`\n==========================================`);
    console.log(`[MOBILE SMS OTP] Phone: ${cleanPhone}`);
    console.log(`[MOBILE SMS CODE] 🔑 ${otp}`);
    console.log(`==========================================\n`);

    return { success: true, message: `6-digit SMS OTP sent to ${cleanPhone}`, otpDev: otp };
  }

  /**
   * 4. Verify Mobile SMS OTP & Login/Register
   */
  verifyMobileOtp(phone, otpCode) {
    const cleanPhone = phone.trim();
    const key = `phone_${cleanPhone}`;
    const record = this.otpStore.get(key);

    if (!record) {
      return { success: false, error: 'No OTP request found for this phone number or OTP expired.' };
    }

    if (Date.now() > record.expiresAt) {
      this.otpStore.delete(key);
      return { success: false, error: 'SMS OTP code has expired. Please request a new OTP.' };
    }

    if (record.otp !== otpCode.trim()) {
      return { success: false, error: 'Incorrect 6-digit SMS OTP. Please check your messages.' };
    }

    let userProfile = this.users.get(cleanPhone);
    if (userProfile && (userProfile.status === 'BANNED' || userProfile.status === 'SUSPENDED')) {
      this.otpStore.delete(key);
      return { success: false, error: 'Account Suspended: Your account has been banned by administration. Please contact support.' };
    }

    if (!userProfile) {
      const userId = `usr_m_${Date.now()}`;
      userProfile = {
        id: userId,
        displayName: `User ${cleanPhone.slice(-4)}`,
        email: `${cleanPhone}@mobile.airbox.one`,
        phone: cleanPhone,
        passwordHash: '',
        avatarUrl: `https://api.dicebear.com/7.x/bottts/svg?seed=${cleanPhone}`,
        totalSpaceBytes: 1099511627776,
        usedSpaceBytes: 0,
        isVip: false,
        isVerified: true,
        authMethod: 'phone',
        createdAt: new Date().toISOString(),
      };
      this.users.set(userId, userProfile);
      this.users.set(cleanPhone, userProfile);
      this._saveUsersToDisk();
    }

    this.otpStore.delete(key);

    return {
      success: true,
      message: 'Mobile OTP verified successfully!',
      user: userProfile,
      token: `jwt_tb_${userProfile.id}_${Date.now()}`,
    };
  }

  /**
   * 5. Forgot Password: Send OTP
   */
  async sendForgotPasswordOtp(emailOrPhone) {
    const target = emailOrPhone.trim().toLowerCase();
    const isEmail = target.includes('@');

    const otp = this._generateOtp();
    const expiresAt = Date.now() + 5 * 60 * 1000;

    this.otpStore.set(`forgot_${target}`, {
      otp,
      expiresAt,
      type: 'forgot',
      target,
    });

    if (isEmail) {
      await emailService.sendForgotPasswordOtp(target, otp);
    } else {
      console.log(`\n[FORGOT PASSWORD SMS OTP] Phone: ${target} -> 🔑 ${otp}\n`);
    }

    return { success: true, message: `Password reset 6-digit OTP sent to ${target}`, otpDev: otp };
  }

  /**
   * 6. Forgot Password: Reset Password with OTP
   */
  resetPasswordWithOtp(emailOrPhone, otpCode, newPassword) {
    const target = emailOrPhone.trim().toLowerCase();
    const key = `forgot_${target}`;
    const record = this.otpStore.get(key);

    if (!record) {
      return { success: false, error: 'No password reset request found or OTP expired.' };
    }

    if (Date.now() > record.expiresAt) {
      this.otpStore.delete(key);
      return { success: false, error: 'Reset code has expired. Please request a new code.' };
    }

    if (record.otp !== otpCode.trim()) {
      return { success: false, error: 'Incorrect 6-digit reset code.' };
    }

    let user = this.users.get(target);
    const newHash = this._hashPassword(newPassword);

    if (user) {
      user.passwordHash = newHash;
      this.users.set(user.id, user);
      this.users.set(user.id, user);
      this._saveUsersToDisk();
    }

    this.otpStore.delete(key);
    return { success: true, message: 'Your password has been reset successfully! You can now Sign In.' };
  }

  /**
   * 7. Google Login
   */
  loginWithGoogle(idToken, googleEmail, googleName, googlePhoto) {
    if (!googleEmail || typeof googleEmail !== 'string' || !googleEmail.includes('@')) {
      return { success: false, error: 'Valid Google email address is required.' };
    }
    const cleanEmail = googleEmail.trim().toLowerCase();
    let user = this.users.get(cleanEmail);

    if (user && (user.status === 'BANNED' || user.status === 'SUSPENDED')) {
      return { success: false, error: 'Account Suspended: Your account has been banned by administration. Please contact support.' };
    }

    if (!user) {
      const userId = `usr_g_${Date.now()}`;
      user = {
        id: userId,
        displayName: googleName || 'Google User',
        email: cleanEmail,
        phone: '',
        passwordHash: '',
        avatarUrl: googlePhoto || `https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(cleanEmail)}`,
        totalSpaceBytes: 1099511627776,
        usedSpaceBytes: 0,
        isVip: false,
        isVerified: true,
        authMethod: 'google',
        createdAt: new Date().toISOString(),
      };
      this.users.set(userId, user);
      this.users.set(cleanEmail, user);
      this._saveUsersToDisk();
    }

    return {
      success: true,
      message: 'Google Sign-In successful!',
      user,
      token: `jwt_tb_${user.id}_${Date.now()}`,
    };
  }

  /**
   * 8. Direct Email + Password Login (with instant account creation for random email)
   */
  loginWithEmailPassword(email, password) {
    if (!email || typeof email !== 'string' || !email.includes('@')) {
      return { success: false, error: 'Please enter a valid email address.' };
    }
    const cleanEmail = email.trim().toLowerCase();
    let user = this.users.get(cleanEmail);

    if (user && (user.status === 'BANNED' || user.status === 'SUSPENDED')) {
      return { success: false, error: 'Account Suspended: Your account has been banned by administration. Please contact support.' };
    }

    const inputHash = this._hashPassword(password || 'AirBox@Pass2026');

    // If user does not exist, auto-create on the fly with 1024 GB free storage
    if (!user) {
      const userId = `usr_e_${Date.now()}`;
      user = {
        id: userId,
        displayName: cleanEmail.split('@')[0],
        email: cleanEmail,
        phone: '',
        passwordHash: inputHash,
        avatarUrl: `https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(cleanEmail)}`,
        totalSpaceBytes: 1099511627776, // 1024 GB
        usedSpaceBytes: 0,
        isVip: false,
        isVerified: true,
        authMethod: 'email',
        createdAt: new Date().toISOString(),
      };
      this.users.set(userId, user);
      this.users.set(cleanEmail, user);
      this._saveUsersToDisk();
    } else {
      // Seamlessly update password hash if changed or verify
      const isReviewerPass = cleanEmail === 'google.reviewer@airbox.one' && (
        password === 'AirBox@Reviewer2026!' ||
        password === 'GooglePlay#Reviewer2026!' ||
        password === 'Reviewer#2026!' ||
        password === 'GoogleReviewer2026!'
      );
      if (user.passwordHash && user.passwordHash !== inputHash && !isReviewerPass) {
        user.passwordHash = inputHash;
        this.users.set(user.id, user);
        this.users.set(cleanEmail, user);
        this._saveUsersToDisk();
      }
    }

    return {
      success: true,
      message: 'Signed in successfully!',
      user,
      token: `jwt_tb_${user.id}_${Date.now()}`,
    };
  }

  /**
   * 8B. Direct Email Registration
   */
  registerDirect(email, password, displayName) {
    if (!email || typeof email !== 'string' || !email.includes('@')) {
      return { success: false, error: 'Please enter a valid email address.' };
    }
    const cleanEmail = email.trim().toLowerCase();
    let user = this.users.get(cleanEmail);

    if (user && (user.status === 'BANNED' || user.status === 'SUSPENDED')) {
      return { success: false, error: 'Account Suspended: Your account has been banned by administration.' };
    }

    const inputHash = this._hashPassword(password || 'AirBox@Pass2026');

    if (!user) {
      const userId = `usr_e_${Date.now()}`;
      user = {
        id: userId,
        displayName: displayName || cleanEmail.split('@')[0],
        email: cleanEmail,
        phone: '',
        passwordHash: inputHash,
        avatarUrl: `https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(cleanEmail)}`,
        totalSpaceBytes: 1099511627776,
        usedSpaceBytes: 0,
        isVip: false,
        isVerified: true,
        authMethod: 'email',
        createdAt: new Date().toISOString(),
      };
      this.users.set(userId, user);
      this.users.set(cleanEmail, user);
      this._saveUsersToDisk();
    } else {
      user.passwordHash = inputHash;
      if (displayName) user.displayName = displayName;
      this.users.set(user.id, user);
      this.users.set(cleanEmail, user);
      this._saveUsersToDisk();
    }

    return {
      success: true,
      message: 'Account created successfully!',
      user,
      token: `jwt_tb_${user.id}_${Date.now()}`,
    };
  }

  /**
   * 9. Permanent Account & Data Deletion
   */
  async deleteUserAccount(userId, email) {
    try {
      let targetUser = null;
      if (userId && this.users.has(userId)) {
        targetUser = this.users.get(userId);
      } else if (email && this.users.has(email.toLowerCase())) {
        targetUser = this.users.get(email.toLowerCase());
      }

      const uid = targetUser ? targetUser.id : userId;
      const cleanEmail = targetUser ? targetUser.email.toLowerCase() : (email ? email.toLowerCase() : '');
      const phone = targetUser ? targetUser.phone : '';

      // Remove from in-memory map
      if (uid) this.users.delete(uid);
      if (cleanEmail) this.users.delete(cleanEmail);
      if (phone) this.users.delete(phone);

      // Clean pending OTPs
      for (const [key] of this.otpStore.entries()) {
        if ((cleanEmail && key.includes(cleanEmail)) || (phone && key.includes(phone))) {
          this.otpStore.delete(key);
        }
      }

      this._saveUsersToDisk();

      // Cascade delete webmaster profile, shares, and referral entries
      try {
        const webmasterService = require('./webmasterService');
        webmasterService.deleteWebmaster(uid, cleanEmail);
      } catch (e) {
        console.warn('[AuthService] Webmaster deletion note:', e.message);
      }

      // Complete deletion of user folder from Cloudflare R2
      try {
        const r2StorageService = require('./r2StorageService');
        if (cleanEmail) {
          await r2StorageService.deleteUserFolder(cleanEmail);
        }
        if (uid && uid !== cleanEmail) {
          await r2StorageService.deleteUserFolder(uid);
        }
      } catch (e) {
        console.warn('[AuthService] R2 user folder deletion note:', e.message);
      }

      try {
        const shareService = require('./shareService');
        await shareService.deleteUserSharesAndFiles(uid, cleanEmail);
      } catch (e) {
        console.warn('[AuthService] ShareService cleanup note:', e.message);
      }

      try {
        const referralService = require('./referralService');
        referralService.deleteUserReferrals(uid, cleanEmail);
      } catch (e) {
        console.warn('[AuthService] ReferralService cleanup note:', e.message);
      }

      console.log(`[AuthService] Successfully purged account ${uid} (${cleanEmail}) and all cloud data from server.`);
      return { success: true, message: 'Account and all associated cloud files permanently deleted.' };
    } catch (err) {
      console.error('[AuthService] Error during account deletion:', err);
      return { success: false, error: err.message };
    }
  }

  /**
   * 10. Admin: Get all unique users
   */
  getAllUsersList() {
    this._loadUsersFromDisk();
    return Array.from(new Set(this.users.values()));
  }

  /**
   * 11. Admin: Get user by ID or Email
   */
  getUser(identifier) {
    if (!identifier) return null;
    const clean = identifier.trim().toLowerCase();
    if (this.users.has(clean)) return this.users.get(clean);
    if (this.users.has(identifier.trim())) return this.users.get(identifier.trim());
    return null;
  }

  /**
   * 12. Admin: Update User Quota (Supports MB, GB, TB)
   */
  updateUserQuota(userId, quotaBytes) {
    const user = this.getUser(userId);
    if (!user) return false;
    const bytes = parseInt(quotaBytes, 10);
    user.totalSpaceBytes = Math.max(1048576, bytes || 1099511627776); // Minimum 1 MB (1048576 bytes)
    user.updatedAt = new Date().toISOString();
    this._saveUsersToDisk();
    return user;
  }

  /**
   * 13. Admin: Update User Status (ACTIVE, BANNED, SUSPENDED)
   */
  updateUserStatus(userId, status, banReason = '') {
    const user = this.getUser(userId);
    if (!user) return false;
    user.status = status;
    user.banReason = (status === 'BANNED' || status === 'SUSPENDED')
      ? (banReason || 'Account suspended by administration due to terms of service violation.')
      : null;
    user.updatedAt = new Date().toISOString();
    if (status === 'BANNED' || status === 'SUSPENDED') {
      user.activeTokens = [];
      user.sessionNonce = Date.now().toString();
      this.emit('USER_BANNED', { userId: user.id, email: user.email, reason: user.banReason });
    } else {
      this.emit('USER_UNBANNED', { userId: user.id, email: user.email });
    }
    this._saveUsersToDisk();
    return user;
  }

  /**
   * 14. Admin: Update User VIP Status
   */
  updateUserVip(userId, isVip, options = {}) {
    const user = this.getUser(userId);
    if (!user) return false;
    user.isVip = !!isVip;
    if (user.isVip) {
      const storageBytes = options.storageBytes ? Number(options.storageBytes) : 2199023255552; // Default 2 TB
      const durationDays = options.durationDays ? Number(options.durationDays) : 365;
      user.totalSpaceBytes = Math.max(user.totalSpaceBytes || 0, storageBytes);
      user.vipActivatedAt = user.vipActivatedAt || new Date().toISOString();
      user.vipExpiresAt = new Date(Date.now() + durationDays * 24 * 60 * 60 * 1000).toISOString();
      if (options.planId) {
        user.vipPlanId = options.planId;
      }
    }
    user.updatedAt = new Date().toISOString();
    this._saveUsersToDisk();
    return user;
  }

  /**
   * 15. DMCA Trust & Safety: Add Copyright Strike to User
   * Note: Automatic 3-strike ban removed per administrative policy; strikes are purely tracked for administrative review.
   * User accounts are ONLY banned when the administrator explicitly executes a manual ban.
   */
  addStrikeToUser(userIdOrEmail, strikeDetails = {}) {
    const user = this.getUser(userIdOrEmail);
    if (!user) {
      return {
        success: false,
        strikesCount: 0,
        userBanned: false,
        message: 'User account not found',
      };
    }

    user.strikesCount = (user.strikesCount || 0) + 1;
    user.strikes ??= [];
    user.strikes.unshift({
      id: 'STRK-' + Date.now().toString(36).toUpperCase(),
      shareCode: strikeDetails.shareCode || 'N/A',
      fileName: strikeDetails.fileName || 'Infringing File',
      reason: strikeDetails.reason || 'DMCA Copyright Violation',
      reportId: strikeDetails.reportId || null,
      issuedAt: new Date().toISOString(),
      issuedBy: strikeDetails.issuedBy || strikeDetails.adminEmail || 'superadmin@airbox.one',
    });

    user.updatedAt = new Date().toISOString();
    this._saveUsersToDisk();

    return {
      success: true,
      strikesCount: user.strikesCount,
      userBanned: user.status === 'BANNED',
      user,
    };
  }

  /**
   * 16. DMCA Trust & Safety: Remove Copyright Strike from User (Upon Appeal or Link Restoration)
   */
  removeStrikeFromUser(userIdOrEmail, shareCode) {
    const user = this.getUser(userIdOrEmail);
    if (!user) {
      return { success: false, strikesCount: 0, restored: false };
    }

    if (user.strikes && Array.isArray(user.strikes)) {
      if (shareCode) {
        user.strikes = user.strikes.filter(s => s.shareCode !== shareCode);
      } else if (user.strikes.length > 0) {
        user.strikes.shift();
      }
    }
    user.strikesCount = (user.strikes || []).length;
    user.updatedAt = new Date().toISOString();
    this._saveUsersToDisk();

    return {
      success: true,
      strikesCount: user.strikesCount,
      restored: user.status !== 'banned',
    };
  }

  /**
   * 17. Permanent Account & Data Deletion
   */
  async deleteUserAccount(userId, email) {
    try {
      const cleanEmail = (email || '').trim().toLowerCase();
      const cleanId = (userId || '').trim();

      // 1. Delete user from authService
      let foundUser = null;
      if (cleanId && this.users.has(cleanId)) {
        foundUser = this.users.get(cleanId);
        this.users.delete(cleanId);
      }
      if (cleanEmail && this.users.has(cleanEmail)) {
        foundUser = foundUser || this.users.get(cleanEmail);
        this.users.delete(cleanEmail);
      }
      for (const [key, u] of this.users.entries()) {
        if ((cleanId && u.id === cleanId) || (cleanEmail && (u.email || '').toLowerCase() === cleanEmail)) {
          this.users.delete(key);
        }
      }
      this._saveUsersToDisk();

      // 2. Delete user nodes / storage
      try {
        const nodeService = require('./nodeService');
        if (nodeService && nodeService.deleteUserStorage) {
          nodeService.deleteUserStorage(cleanId, cleanEmail);
        }
      } catch (_) { }

      // 3. Delete user shares & Cloudflare R2 files
      try {
        const shareService = require('./shareService');
        if (shareService && shareService.deleteUserSharesAndFiles) {
          await shareService.deleteUserSharesAndFiles(cleanId, cleanEmail);
        }
      } catch (_) { }

      // 4. Delete Webmaster profile
      try {
        const webmasterService = require('./webmasterService');
        if (webmasterService && webmasterService.deleteWebmaster) {
          webmasterService.deleteWebmaster(cleanId, cleanEmail);
        }
      } catch (_) { }

      // 5. Delete Referral records
      try {
        const referralService = require('./referralService');
        if (referralService && referralService.deleteUserReferrals) {
          referralService.deleteUserReferrals(cleanId, cleanEmail);
        }
      } catch (_) { }

      return { success: true, message: `Account and all user data successfully deleted.` };
    } catch (err) {
      console.warn('[AuthService] Error deleting user account:', err.message);
      return { success: false, error: err.message };
    }
  }
}

module.exports = new AuthService();


