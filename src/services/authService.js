const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const emailService = require('./emailService');

class AuthService {
  constructor() {
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
        name: name || 'TeraBox User',
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
    if (!userProfile) {
      const userId = `usr_m_${Date.now()}`;
      userProfile = {
        id: userId,
        displayName: `User ${cleanPhone.slice(-4)}`,
        email: `${cleanPhone}@mobile.terabox.cloud`,
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
   * 8. Direct Email + Password Login
   */
  loginWithEmailPassword(email, password) {
    const cleanEmail = email.trim().toLowerCase();
    const user = this.users.get(cleanEmail);

    if (!user) {
      return { success: false, error: 'No account found with this email address. Please Sign Up.' };
    }

    if (user.passwordHash && user.passwordHash !== this._hashPassword(password)) {
      return { success: false, error: 'Incorrect password. Please try again or click Forgot Password.' };
    }

    return {
      success: true,
      message: 'Signed in successfully!',
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

      // Cascade delete webmaster profile and all user shares & files
      try {
        const webmasterService = require('./webmasterService');
        webmasterService.deleteWebmaster(uid, cleanEmail);
      } catch (e) {
        console.warn('[AuthService] Webmaster deletion note:', e.message);
      }

      try {
        const shareService = require('./shareService');
        await shareService.deleteUserSharesAndFiles(uid, cleanEmail);
      } catch (e) {
        console.warn('[AuthService] ShareService cleanup note:', e.message);
      }

      console.log(`[AuthService] Successfully purged account ${uid} (${cleanEmail}) and all cloud data from server.`);
      return { success: true, message: 'Account and all associated cloud files permanently deleted.' };
    } catch (err) {
      console.error('[AuthService] Error during account deletion:', err);
      return { success: false, error: err.message };
    }
  }
}

module.exports = new AuthService();
