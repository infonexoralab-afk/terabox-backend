const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../.env') });
const crypto = require('crypto');
const fs = require('fs');
const jwt = require('jsonwebtoken');
const env = require('../config/env');

const ADMINS_FILE = path.join(__dirname, '../../data/admins.json');
const AUDIT_LOGS_FILE = path.join(__dirname, '../../data/audit_logs.json');

class AdminAuthService {
  constructor() {
    this.admins = new Map(); // id or email or username -> adminObject
    this.auditLogs = [];
    this.loginAttempts = new Map(); // ip -> { failedCount, lockedUntil }
    this._initDatastores();
  }

  _cleanEnvStr(val, fallback = '') {
    if (!val) return fallback;
    return String(val).trim().replace(/^["']|["']$/g, '').trim();
  }

  get adminSecretSalt() {
    return this._cleanEnvStr(process.env.ADMIN_SECRET_SALT, 'airbox_admin_master_salt_2026_sec_entropy');
  }

  get jwtSecret() {
    return this._cleanEnvStr(process.env.JWT_SECRET || env.jwtSecret, 'airbox_enterprise_jwt_master_secret_key_2026');
  }

  get superAdminEmail() {
    return this._cleanEnvStr(process.env.ADMIN_SUPER_EMAIL, 'superadmin@airbox.one').toLowerCase();
  }

  get superAdminUsername() {
    return this._cleanEnvStr(process.env.ADMIN_SUPER_USERNAME, 'admin_root').toLowerCase();
  }

  get superAdminPassword() {
    return this._cleanEnvStr(process.env.ADMIN_SUPER_PASSWORD, '');
  }

  _initDatastores() {
    try {
      const dataDir = path.dirname(ADMINS_FILE);
      if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir, { recursive: true });
      }

      // Load or Seed Admins
      if (fs.existsSync(ADMINS_FILE)) {
        const raw = fs.readFileSync(ADMINS_FILE, 'utf8');
        const list = JSON.parse(raw || '[]');
        if (Array.isArray(list) && list.length > 0) {
          for (const adm of list) {
            this._indexAdmin(adm);
          }
        } else {
          this._seedDefaultSuperAdmin();
        }
      } else {
        this._seedDefaultSuperAdmin();
      }

      // Ensure Master Super Admin always exists and has verified hash
      this._ensureSuperAdminIntegrity();

      // Load Audit Logs
      if (fs.existsSync(AUDIT_LOGS_FILE)) {
        const rawLogs = fs.readFileSync(AUDIT_LOGS_FILE, 'utf8');
        this.auditLogs = JSON.parse(rawLogs || '[]');
      }
    } catch (err) {
      console.error('[AdminAuthService] Initialization error:', err.message);
    }
  }

  _indexAdmin(adm) {
    if (!adm) return;
    if (adm.id) this.admins.set(adm.id, adm);
    if (adm.email) this.admins.set(adm.email.toLowerCase(), adm);
    if (adm.username) this.admins.set(adm.username.toLowerCase(), adm);
  }

  _seedDefaultSuperAdmin() {
    const passwordToHash = this.superAdminPassword;
    if (!passwordToHash) {
      console.warn('[AdminAuthService] Warning: ADMIN_SUPER_PASSWORD not set in environment.');
      return;
    }
    const hashedPassword = this._hashPassword(passwordToHash);
    const superAdminRecord = {
      id: 'adm_master_root_01',
      email: this.superAdminEmail,
      username: this.superAdminUsername,
      passwordHash: hashedPassword,
      displayName: 'Master Super Administrator',
      role: 'ROLE_SUPER_ADMIN',
      status: 'ACTIVE',
      createdAt: new Date().toISOString(),
      lastLoginAt: null,
      lastLoginIp: null,
    };

    this._indexAdmin(superAdminRecord);
    this._persistAdmins();
    this.recordAuditLog({
      adminId: superAdminRecord.id,
      email: superAdminRecord.email,
      action: 'GENESIS_BOOTSTRAP',
      target: 'SYSTEM',
      details: 'Super Administrator initialized with high-entropy cryptographic credentials.',
      ip: '127.0.0.1',
    });
    console.log(`[AdminAuthService] Master Super Admin initialized: ${this.superAdminEmail}`);
  }

  _ensureSuperAdminIntegrity() {
    let superAdmin = this.admins.get(this.superAdminEmail) || this.admins.get(this.superAdminUsername) || this.admins.get('adm_master_root_01');
    const passwordToHash = this.superAdminPassword;

    if (!superAdmin) {
      this._seedDefaultSuperAdmin();
    } else if (passwordToHash && superAdmin.passwordHash !== this._hashPassword(passwordToHash)) {
      superAdmin.passwordHash = this._hashPassword(passwordToHash);
      superAdmin.email = this.superAdminEmail;
      superAdmin.username = this.superAdminUsername;
      this._indexAdmin(superAdmin);
      this._persistAdmins();
    }
  }

  _hashPassword(password) {
    if (!password) return '';
    return crypto
      .pbkdf2Sync(password, this.adminSecretSalt, 25000, 64, 'sha512')
      .toString('hex');
  }

  /**
   * Constant-time timing-safe hash comparison
   */
  _timingSafeCompare(a, b) {
    if (typeof a !== 'string' || typeof b !== 'string') return false;
    const bufA = Buffer.from(a, 'utf8');
    const bufB = Buffer.from(b, 'utf8');
    if (bufA.length !== bufB.length) return false;
    return crypto.timingSafeEqual(bufA, bufB);
  }

  _persistAdmins() {
    try {
      const uniqueAdmins = Array.from(new Set(this.admins.values()));
      fs.writeFileSync(ADMINS_FILE, JSON.stringify(uniqueAdmins, null, 2), 'utf8');
    } catch (err) {
      console.error('[AdminAuthService] Error persisting admins:', err.message);
    }
  }

  _persistAuditLogs() {
    try {
      if (this.auditLogs.length > 2000) {
        this.auditLogs = this.auditLogs.slice(0, 2000);
      }
      fs.writeFileSync(AUDIT_LOGS_FILE, JSON.stringify(this.auditLogs, null, 2), 'utf8');
    } catch (err) {
      console.error('[AdminAuthService] Error persisting audit logs:', err.message);
    }
  }

  /**
   * Direct Admin Authentication with Rate Limiting and Timing-Safe Verification
   */
  login(identifier, password, ipAddress = '127.0.0.1', userAgent = '') {
    if (!identifier || !password) {
      return { success: false, error: 'Identifier and password are required' };
    }

    // 1. Brute-Force Rate Limiting Protection (5 failed attempts -> 15 min lock)
    const now = Date.now();
    const rateRecord = this.loginAttempts.get(ipAddress) || { failedCount: 0, lockedUntil: 0 };
    if (rateRecord.lockedUntil > now) {
      const remainingMin = Math.ceil((rateRecord.lockedUntil - now) / 60000);
      return {
        success: false,
        error: `Security Lockout: Too many failed login attempts. Please retry in ${remainingMin} minute(s).`,
      };
    }

    const cleanId = identifier.trim().toLowerCase();
    const admin = this.admins.get(cleanId);

    if (!admin) {
      rateRecord.failedCount += 1;
      if (rateRecord.failedCount >= 5) {
        rateRecord.lockedUntil = now + 15 * 60 * 1000; // 15 min lock
      }
      this.loginAttempts.set(ipAddress, rateRecord);

      this.recordAuditLog({
        adminId: 'UNKNOWN',
        email: cleanId,
        action: 'FAILED_LOGIN_ATTEMPT',
        target: 'AUTH',
        details: `Invalid administrative identifier. IP: ${ipAddress} (Failures: ${rateRecord.failedCount})`,
        ip: ipAddress,
      });
      return { success: false, error: 'Invalid administrative credentials' };
    }

    if (admin.status !== 'ACTIVE') {
      return { success: false, error: 'Administrative account is suspended' };
    }

    const testHash = this._hashPassword(password.trim());
    let isPasswordValid = this._timingSafeCompare(testHash, admin.passwordHash);

    // Fallback: Check direct super admin master password match if hash differed due to salt migration
    if (!isPasswordValid && this.superAdminPassword && (password.trim() === this.superAdminPassword) && (cleanId === this.superAdminEmail || cleanId === this.superAdminUsername || admin.role === 'ROLE_SUPER_ADMIN')) {
      isPasswordValid = true;
      admin.passwordHash = testHash;
      this._persistAdmins();
    }

    if (!isPasswordValid) {
      rateRecord.failedCount += 1;
      if (rateRecord.failedCount >= 5) {
        rateRecord.lockedUntil = now + 15 * 60 * 1000;
      }
      this.loginAttempts.set(ipAddress, rateRecord);

      this.recordAuditLog({
        adminId: admin.id,
        email: admin.email,
        action: 'FAILED_PASSWORD_ATTEMPT',
        target: 'AUTH',
        details: `Incorrect password entered. (Failures: ${rateRecord.failedCount})`,
        ip: ipAddress,
      });
      return { success: false, error: 'Invalid administrative credentials' };
    }

    // Success -> Clear Rate Limit Record
    this.loginAttempts.delete(ipAddress);

    // Update Login Metadata
    admin.lastLoginAt = new Date().toISOString();
    admin.lastLoginIp = ipAddress;
    this._persistAdmins();

    // Generate JWT (24-hour expiration)
    const tokenPayload = {
      adminId: admin.id,
      email: admin.email,
      username: admin.username,
      displayName: admin.displayName,
      role: admin.role,
      issuedAt: Date.now(),
    };

    const token = jwt.sign(tokenPayload, this.jwtSecret, { expiresIn: '24h' });

    this.recordAuditLog({
      adminId: admin.id,
      email: admin.email,
      action: 'ADMIN_LOGIN_SUCCESS',
      target: 'AUTH',
      details: 'Super Administrator authenticated successfully',
      ip: ipAddress,
    });

    return {
      success: true,
      token,
      admin: {
        id: admin.id,
        email: admin.email,
        username: admin.username,
        displayName: admin.displayName,
        role: admin.role,
        lastLoginAt: admin.lastLoginAt,
      },
    };
  }

  /**
   * Record Immutable Audit Log
   */
  recordAuditLog({ adminId = 'SYSTEM', email = 'system', action, target, details, ip = '127.0.0.1' }) {
    const logEntry = {
      id: `aud_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      timestamp: new Date().toISOString(),
      adminId,
      email,
      action,
      target,
      details,
      ip,
    };
    this.auditLogs.unshift(logEntry);
    this._persistAuditLogs();
    return logEntry;
  }

  getAuditLogs(limit = 100, page = 1) {
    const lim = Math.max(1, Math.min(parseInt(limit, 10) || 50, 200));
    const p = Math.max(1, parseInt(page, 10) || 1);
    const start = (p - 1) * lim;
    const paginated = this.auditLogs.slice(start, start + lim);

    return {
      total: this.auditLogs.length,
      page: p,
      limit: lim,
      logs: paginated,
    };
  }

  verifyToken(token) {
    if (!token) return null;
    try {
      return jwt.verify(token, this.jwtSecret);
    } catch (_) {
      return null;
    }
  }

  /**
   * Express Middleware to authenticate Admin requests
   */
  authMiddleware() {
    return (req, res, next) => {
      let token = null;

      const authHeader = req.headers['authorization'];
      if (authHeader && authHeader.startsWith('Bearer ')) {
        token = authHeader.substring(7).trim();
      } else if (req.headers['x-admin-token']) {
        token = req.headers['x-admin-token'];
      } else if (req.query && req.query.admin_token) {
        token = req.query.admin_token;
      } else if (req.cookies && req.cookies.admin_token) {
        token = req.cookies.admin_token;
      }

      if (!token) {
        return res.status(401).json({
          success: false,
          error: 'Unauthorized: Administrative access token required',
        });
      }

      try {
        const decoded = jwt.verify(token, this.jwtSecret);
        req.admin = decoded;
        next();
      } catch (err) {
        return res.status(401).json({
          success: false,
          error: 'Unauthorized: Expired or invalid administrative session token',
        });
      }
    };
  }
}

module.exports = new AdminAuthService();
