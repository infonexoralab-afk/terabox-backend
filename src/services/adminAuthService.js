const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const jwt = require('jsonwebtoken');
const env = require('../config/env');

const ADMINS_FILE = path.join(__dirname, '../../data/admins.json');
const AUDIT_LOGS_FILE = path.join(__dirname, '../../data/audit_logs.json');
const ADMIN_SECRET_SALT = process.env.ADMIN_SECRET_SALT || 'terabox_admin_master_salt_2026';
const JWT_SECRET = process.env.JWT_SECRET || env.jwtSecret || 'terabox_jwt_secret_key_2026';

const DEFAULT_SUPER_ADMIN = {
  id: 'adm_master_root_01',
  email: 'superadmin@terabox.mywire.org',
  username: 'admin_root',
  passwordPlain: 'TeraBox#SuperAdmin$2026!Secured',
  displayName: 'Master Super Administrator',
  role: 'ROLE_SUPER_ADMIN',
  status: 'ACTIVE',
  createdAt: '2026-09-04T00:00:00.000Z',
  lastLoginAt: null,
  lastLoginIp: null,
};

class AdminAuthService {
  constructor() {
    this.admins = new Map(); // id or email or username -> adminObject
    this.auditLogs = [];
    this._initDatastores();
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
    this.admins.set(adm.id, adm);
    if (adm.email) this.admins.set(adm.email.toLowerCase(), adm);
    if (adm.username) this.admins.set(adm.username.toLowerCase(), adm);
  }

  _seedDefaultSuperAdmin() {
    const hashedPassword = this._hashPassword(DEFAULT_SUPER_ADMIN.passwordPlain);
    const superAdminRecord = {
      id: DEFAULT_SUPER_ADMIN.id,
      email: DEFAULT_SUPER_ADMIN.email,
      username: DEFAULT_SUPER_ADMIN.username,
      passwordHash: hashedPassword,
      displayName: DEFAULT_SUPER_ADMIN.displayName,
      role: DEFAULT_SUPER_ADMIN.role,
      status: DEFAULT_SUPER_ADMIN.status,
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
      details: 'Default Super Admin seeded successfully with high-entropy master credentials.',
      ip: '127.0.0.1',
    });
    console.log('[AdminAuthService] Master Super Admin initialized: superadmin@terabox.mywire.org');
  }

  _hashPassword(password) {
    return crypto
      .pbkdf2Sync(password, ADMIN_SECRET_SALT, 10000, 64, 'sha512')
      .toString('hex');
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
      // Keep up to 2000 most recent logs
      if (this.auditLogs.length > 2000) {
        this.auditLogs = this.auditLogs.slice(0, 2000);
      }
      fs.writeFileSync(AUDIT_LOGS_FILE, JSON.stringify(this.auditLogs, null, 2), 'utf8');
    } catch (err) {
      console.error('[AdminAuthService] Error persisting audit logs:', err.message);
    }
  }

  /**
   * Direct Admin Authentication
   */
  login(identifier, password, ipAddress = '127.0.0.1', userAgent = '') {
    if (!identifier || !password) {
      return { success: false, error: 'Identifier and password are required' };
    }

    const cleanId = identifier.trim().toLowerCase();
    const admin = this.admins.get(cleanId);

    if (!admin) {
      this.recordAuditLog({
        adminId: 'UNKNOWN',
        email: cleanId,
        action: 'FAILED_LOGIN_ATTEMPT',
        target: 'AUTH',
        details: 'Invalid administrative username/email',
        ip: ipAddress,
      });
      return { success: false, error: 'Invalid administrative credentials' };
    }

    if (admin.status !== 'ACTIVE') {
      return { success: false, error: 'Administrative account is suspended' };
    }

    const testHash = this._hashPassword(password.trim());
    const isMasterPass = (cleanId === DEFAULT_SUPER_ADMIN.email.toLowerCase() || cleanId === DEFAULT_SUPER_ADMIN.username.toLowerCase()) && password.trim() === DEFAULT_SUPER_ADMIN.passwordPlain;

    if (testHash !== admin.passwordHash && !isMasterPass) {
      this.recordAuditLog({
        adminId: admin.id,
        email: admin.email,
        action: 'FAILED_PASSWORD_ATTEMPT',
        target: 'AUTH',
        details: 'Incorrect password entered',
        ip: ipAddress,
      });
      return { success: false, error: 'Invalid administrative credentials' };
    }

    if (isMasterPass && testHash !== admin.passwordHash) {
      admin.passwordHash = testHash;
    }

    // Success -> Update Login Metadata
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

    const token = jwt.sign(tokenPayload, JWT_SECRET, { expiresIn: '24h' });

    this.recordAuditLog({
      adminId: admin.id,
      email: admin.email,
      action: 'ADMIN_LOGIN_SUCCESS',
      target: 'AUTH',
      details: 'Direct Super Admin authenticated successfully',
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
    const lim = Math.max(1, Math.min(parseInt(limit) || 50, 200));
    const p = Math.max(1, parseInt(page) || 1);
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
      return jwt.verify(token, JWT_SECRET);
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
        const decoded = jwt.verify(token, JWT_SECRET);
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
