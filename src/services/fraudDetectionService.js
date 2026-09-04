const crypto = require('crypto');

// Secret salt for HMAC session nonce signing
const NONCE_SECRET = process.env.FRAUD_NONCE_SECRET || 'terabox_anti_fraud_secret_salt_2026';

// Global Flat CPM Rate Matrix ($4.00 CPM -> $0.0040 per verified view)
const GLOBAL_CPM_RATE = {
  cpmRateUsd: 4.00,
  ratePerViewUsd: 0.0040,
  name: 'Flat Global Rate ($4.00 / 1,000 Views)',
};

const COUNTRY_CPM_TIERS = {
  TIER_GLOBAL: {
    cpmRateUsd: 4.00,
    ratePerViewUsd: 0.0040,
    name: 'All Countries ($4.00 CPM)',
  },
  DEFAULT: {
    cpmRateUsd: 4.00,
    ratePerViewUsd: 0.0040,
    name: 'Flat Global Rate ($4.00 CPM)',
  },
  BLOCKED: {
    cpmRateUsd: 0.00,
    ratePerViewUsd: 0.0000,
    name: 'Invalid / Datacenter / Bot',
  }
};

// Known Datacenter / Cloud Provider ASNs and Subnets (Common Bot Farms)
const DATACENTER_KEYWORDS = [
  'amazon', 'aws', 'digitalocean', 'hetzner', 'linode', 'ovh', 'google cloud',
  'microsoft', 'azure', 'vultr', 'm247', 'choopa', 'leaseweb', 'alibaba',
  'oracle', 'fly.io', 'render', 'railway', 'contabo'
];

class FraudDetectionService {
  constructor() {
    this.activeNonces = new Map(); // nonce -> { code, clientIp, expiresAt, createdAt }
    this.deviceHistory = new Map(); // fingerprint -> [ { ip, timestamp } ] (for VPN ring detection)
    this.ipViewHistory = new Map(); // `ip:fileId` -> timestamp (24-hour IP deduplication)
    this.fingerprintViewHistory = new Map(); // `fingerprint:fileId` -> timestamp (24-hour Device deduplication)

    // Cleanup expired nonces every 15 minutes
    setInterval(() => this._cleanupExpiredNonces(), 15 * 60 * 1000);
  }

  /**
   * 1. Detect Country from HTTP Request (Cloudflare Edge -> Forwarded Headers -> Fallback)
   */
  detectCountry(req) {
    // Cloudflare Edge Header (100% accurate, set by Cloudflare edge server)
    const cfCountry = req.headers['cf-ipcountry'];
    if (cfCountry && cfCountry.length === 2 && cfCountry !== 'XX' && cfCountry !== 'T1') {
      return cfCountry.toUpperCase();
    }

    // Standard GeoIP / Proxy Headers
    const xCountry = req.headers['x-country-code'] || req.headers['x-geo-country'];
    if (xCountry && xCountry.length === 2) {
      return xCountry.toUpperCase();
    }

    // Fallback: Default to India or Global
    return 'IN';
  }

  /**
   * 2. Detect Datacenter / Cloud Proxy / Headless Bots
   */
  isDatacenterOrBot(req, clientIp) {
    const userAgent = (req.headers['user-agent'] || '').toLowerCase();

    // Block obvious scraper / automation tools
    const botUserAgents = [
      'curl', 'python-requests', 'scrapy', 'node-fetch', 'axios', 'aiohttp',
      'puppeteer', 'selenium', 'playwright', 'headlesschrome', 'phantomjs', 'wget'
    ];
    if (botUserAgents.some(bot => userAgent.includes(bot))) {
      return { isBot: true, reason: 'Automated Bot User-Agent detected' };
    }

    // Check ISP / Organization header if forwarded by reverse proxy
    const org = (req.headers['x-client-org'] || req.headers['x-client-isp'] || '').toLowerCase();
    if (DATACENTER_KEYWORDS.some(kw => org.includes(kw))) {
      return { isBot: true, reason: 'Datacenter / Cloud Hosting IP detected' };
    }

    return { isBot: false };
  }

  /**
   * 3. Model 1: Calculate Minimum Required Watch-Time Threshold (Seconds)
   * Intelligent Dynamic Scale:
   *  - 0-30s Clip/Reel: Min 5s or 50% of video
   *  - 31-60s Short Video: Min 15s or 35% of video
   *  - 1-5 mins Medium Video: Min 30 seconds
   *  - 5-20 mins Long Video: Min 60 seconds (1 minute)
   *  - 20 mins+ Movie / Show: Min 90 seconds (1.5 minutes)
   */
  calculateWatchThreshold(durationSeconds) {
    const dur = Math.max(0, parseInt(durationSeconds, 10) || 120);

    if (dur <= 30) {
      return Math.max(5, Math.ceil(dur * 0.5));
    } else if (dur <= 60) {
      return Math.max(15, Math.ceil(dur * 0.35));
    } else if (dur <= 300) {
      return 30;
    } else if (dur <= 1200) {
      return 60;
    } else {
      return 90;
    }
  }

  /**
   * 4. Generate Proof-of-Watch Session Nonce
   */
  generateSessionNonce(code, clientIp) {
    const randomBytes = crypto.randomBytes(16).toString('hex');
    const timestamp = Date.now();
    const rawData = `${code}:${clientIp}:${timestamp}:${randomBytes}`;
    const signature = crypto.createHmac('sha256', NONCE_SECRET).update(rawData).digest('hex').substring(0, 16);
    const nonce = `nw_${timestamp}_${signature}_${randomBytes.substring(0, 8)}`;

    const record = {
      nonce,
      code,
      clientIp,
      createdAt: timestamp,
      expiresAt: timestamp + 30 * 60 * 1000, // 30 minutes validity
      isUsed: false,
    };

    this.activeNonces.set(nonce, record);
    return record;
  }

  /**
   * 5. Verify Watch Token & Heartbeat Signature
   */
  verifyWatchToken({ nonce, code, watchSeconds, videoDuration, clientToken, fingerprint, clientIp }) {
    const session = this.activeNonces.get(nonce);
    if (!session) {
      return { valid: false, reason: 'Invalid or expired session nonce. Please reload the player.' };
    }

    if (session.code !== code) {
      return { valid: false, reason: 'Nonce does not match share code' };
    }

    if (session.isUsed) {
      return { valid: false, reason: 'Nonce has already been redeemed' };
    }

    if (Date.now() > session.expiresAt) {
      this.activeNonces.delete(nonce);
      return { valid: false, reason: 'Session expired. Please reload.' };
    }

    // Model 1: Validate Watch-Time Threshold (5s)
    const requiredThreshold = this.calculateWatchThreshold(videoDuration || 120);
    const actualWatch = parseFloat(watchSeconds) || 0;

    if (actualWatch < requiredThreshold) {
      return {
        valid: false,
        reason: `Insufficient watch-time. Watched: ${actualWatch.toFixed(1)}s, Required: ${requiredThreshold}s for monetization.`,
        requiredThreshold,
        actualWatch,
      };
    }

    // Validate Cryptographic Signatures
    const expectedSignature = crypto
      .createHmac('sha256', NONCE_SECRET)
      .update(`${nonce}:${code}:${Math.floor(actualWatch)}`)
      .digest('hex');

    const prevSecSig = crypto
      .createHmac('sha256', NONCE_SECRET)
      .update(`${nonce}:${code}:${Math.floor(actualWatch) - 1}`)
      .digest('hex');
    const nextSecSig = crypto
      .createHmac('sha256', NONCE_SECRET)
      .update(`${nonce}:${code}:${Math.floor(actualWatch) + 1}`)
      .digest('hex');

    const thresholdSig = crypto
      .createHmac('sha256', NONCE_SECRET)
      .update(`${nonce}:${code}:${Math.floor(requiredThreshold)}`)
      .digest('hex');

    const directHmacSig = crypto
      .createHmac('sha256', NONCE_SECRET)
      .update(`${nonce}:${code}`)
      .digest('hex');

    const directShaSig = crypto
      .createHash('sha256')
      .update(`${nonce}:${code}`)
      .digest('hex');

    const isMatch = (
      clientToken === expectedSignature ||
      clientToken === prevSecSig ||
      clientToken === nextSecSig ||
      clientToken === thresholdSig ||
      clientToken === directHmacSig ||
      clientToken === directShaSig
    );

    if (!isMatch) {
      return { valid: false, reason: 'Cryptographic heartbeat signature mismatch (Anti-Bot Rejection)' };
    }

    // Mark nonce as used
    session.isUsed = true;
    return { valid: true, requiredThreshold, actualWatch };
  }

  /**
   * 6. Check 24-Hour Deduplication & VPN Fraud Ring
   */
  checkDeduplication(clientIp, fileId, fingerprint) {
    const now = Date.now();
    const dayMs = 24 * 60 * 60 * 1000;

    // 1. IP Deduplication (24 hours per file/link)
    const ipKey = `${clientIp}:${fileId}`;
    const lastIpTime = this.ipViewHistory.get(ipKey);
    if (lastIpTime && (now - lastIpTime < dayMs)) {
      return { allowed: false, reason: 'Duplicate view from same IP within 24 hours' };
    }

    // 2. Device Fingerprint Deduplication (24 hours per file/link)
    if (fingerprint && fingerprint.length > 5) {
      const fpKey = `${fingerprint}:${fileId}`;
      const lastFpTime = this.fingerprintViewHistory.get(fpKey);
      if (lastFpTime && (now - lastFpTime < dayMs)) {
        return { allowed: false, reason: 'Duplicate view from same device within 24 hours' };
      }

      // Check VPN IP-Hopping Ring (1 device using > 15 distinct IPs in 2 hours)
      let fpRecords = this.deviceHistory.get(fingerprint) || [];
      fpRecords = fpRecords.filter(r => now - r.timestamp < 2 * 60 * 60 * 1000);
      const uniqueIps = new Set(fpRecords.map(r => r.ip));
      if (uniqueIps.size > 15) {
        return { allowed: false, reason: 'VPN IP-Hopping Fraud Ring detected on device' };
      }

      fpRecords.push({ ip: clientIp, timestamp: now });
      this.deviceHistory.set(fingerprint, fpRecords);
      this.fingerprintViewHistory.set(fpKey, now);
    }

    this.ipViewHistory.set(ipKey, now);
    return { allowed: true };
  }

  /**
   * 7. Get Global Flat CPM Payout Rate ($4.00 CPM for all countries)
   */
  getCpmTier(countryCode) {
    const cc = (countryCode || 'GLOBAL').toUpperCase();
    return {
      tier: 1,
      country: cc,
      cpmRateUsd: 4.00,
      ratePerViewUsd: 0.0040,
      name: 'Global Flat Rate ($4.00 CPM)',
    };
  }

  /**
   * 8. Click Anti-Fraud & Deduplication
   * Rule: Exactly 1 unique click per device / IP per link per 24 hours (1 day).
   * If the same user clicks a DIFFERENT link, that different link is counted immediately!
   */
  checkClickDeduplication({ clientIp, shareCode, fingerprint, isRepeatSession }) {
    const now = Date.now();
    const dayMs = 24 * 60 * 60 * 1000; // 24-hour window per link

    if (isRepeatSession) {
      return { allowed: false, reason: 'Tab reload / duplicate session within browser' };
    }

    // 1. IP-based Click Deduplication (Per Link)
    const ipKey = `click_ip:${clientIp}:${shareCode}`;
    const lastIpClick = this.ipViewHistory.get(ipKey);
    if (lastIpClick && (now - lastIpClick < dayMs)) {
      return { allowed: false, reason: 'Duplicate click from same IP on this link within 24 hours' };
    }

    // 2. Device Fingerprint Click Deduplication (Per Link)
    if (fingerprint && fingerprint.length > 5) {
      const fpKey = `click_fp:${fingerprint}:${shareCode}`;
      const lastFpClick = this.fingerprintViewHistory.get(fpKey);
      if (lastFpClick && (now - lastFpClick < dayMs)) {
        return { allowed: false, reason: 'Duplicate click from same device on this link within 24 hours' };
      }
      this.fingerprintViewHistory.set(fpKey, now);
    }

    this.ipViewHistory.set(ipKey, now);
    return { allowed: true };
  }

  _cleanupExpiredNonces() {
    const now = Date.now();
    for (const [nonce, session] of this.activeNonces.entries()) {
      if (now > session.expiresAt) {
        this.activeNonces.delete(nonce);
      }
    }
  }
}

module.exports = new FraudDetectionService();
