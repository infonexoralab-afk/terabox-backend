const http = require('http');
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { WebSocketServer } = require('ws');
const env = require('./config/env');
const apiRoutes = require('./routes/api');
const adminRoutes = require('./routes/adminRoutes');
const adminAuthService = require('./services/adminAuthService');
const systemConfigStore = require('./services/systemConfigStore');
const shareService = require('./services/shareService');
const r2StorageService = require('./services/r2StorageService');
const webmasterService = require('./services/webmasterService');
const fraudDetectionService = require('./services/fraudDetectionService');
const referralService = require('./services/referralService');
const authService = require('./services/authService');
const notificationService = require('./services/notificationService');

const app = express();

// Ensure uploads folder exists (using /tmp on Vercel to bypass read-only filesystem limit)
const isVercel = process.env.VERCEL === '1';
const uploadsDir = isVercel ? '/tmp/uploads' : path.join(__dirname, '../uploads');
if (!fs.existsSync(uploadsDir)) {
  try { fs.mkdirSync(uploadsDir, { recursive: true }); } catch (_) {}
}

app.use(cors({ origin: '*' }));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Serve static uploads with full CORS and streaming headers
app.use('/uploads', express.static(uploadsDir, {
  setHeaders: (res) => {
    res.set('Access-Control-Allow-Origin', '*');
    res.set('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
    res.set('Access-Control-Allow-Headers', '*');
    res.set('Accept-Ranges', 'bytes');
  }
}));

// Health Check
app.get('/health', (req, res) => {
  res.json({
    status: 'online',
    service: 'AirBox Cloud & Cloudflare R2 Engine',
    version: '1.0.0',
    storage: 'Cloudflare R2 (1024 GB S3-Compatible)',
    timestamp: new Date().toISOString(),
  });
});

// 🌐 Public Share Link Web Preview (Video Teaser + File Download)
app.get('/s/:code', async (req, res) => {
  try {
    const share = await shareService.getShare(req.params.code);
    if (!share) {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      return res.status(404).send(`<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>Link Expired - AirBox</title><link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;600;800&display=swap" rel="stylesheet"><style>*{margin:0;padding:0;box-sizing:border-box;font-family:'Plus Jakarta Sans',sans-serif}body{background:#F8FAFC;display:flex;align-items:center;justify-content:center;min-height:100vh;padding:20px}.card{background:#FFF;border-radius:24px;padding:48px 32px;text-align:center;max-width:440px;width:100%;box-shadow:none;border:1px solid #E2E8F0}.icon{width:72px;height:72px;border-radius:20px;background:#FEF2F2;border:1px solid #FECACA;display:flex;align-items:center;justify-content:center;margin:0 auto 20px;font-size:32px}h2{font-size:22px;font-weight:800;color:#0F172A;margin-bottom:8px}p{font-size:14px;color:#64748B;line-height:1.6;margin-bottom:24px}a{display:inline-block;background:#0066FF;color:#FFF;padding:14px 32px;border-radius:16px;font-weight:700;font-size:14px;text-decoration:none;}</style></head><body><div class="card"><div class="icon">🔗</div><h2>Share Link Not Found</h2><p>This share link has expired or the server was restarted. Please ask the sender to generate a new share link from their AirBox app.</p><a href="/">Go to AirBox Home</a></div></body></html>`);
    }

    let refCode = (req.query.ref || share.referralCode || '').toString().trim().toUpperCase();

    // 1. Record 24-Hour Unique Click immediately on HTTP Page Load
    try {
      const rawIp = req.headers['cf-connecting-ip'] || req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket?.remoteAddress || '127.0.0.1';
      const clientIp = rawIp.replace(/^::ffff:/, '');
      const country = fraudDetectionService.detectCountry(req);
      const botCheck = fraudDetectionService.isDatacenterOrBot(req, clientIp);
      const clickDedup = fraudDetectionService.checkClickDeduplication({
        clientIp,
        shareCode: share.code,
        fingerprint: req.headers['user-agent'] || '',
        isRepeatSession: false,
      });

      // Comprehensive referral code resolution from share creator
      if (!refCode) {
        const creatorId = (share.creatorUserId || share.userId || '').toString().trim();
        const creatorEmail = (share.creatorEmail || share.email || '').toString().trim().toLowerCase();
        const creatorName = (share.creatorName || share.userName || '').toString().trim();

        // Check Webmaster profiles
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

        // Fallback: Check authService
        if (!refCode) {
          try {
            const u = authService.getUser(creatorId || creatorEmail || creatorName);
            if (u && u.webmasterReferralCode) {
              refCode = u.webmasterReferralCode.toString().trim().toUpperCase();
              share.referralCode = refCode;
            }
          } catch (_) {}
        }
      }

      // 2. Register IP Attribution for Webmaster Referrals (Enables instant CPA attribution on app install/signup)
      if (refCode && !botCheck.isBot) {
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

      const isWebmasterActive = systemConfigStore.get('webmaster_program_enabled', true);
      if (refCode && !botCheck.isBot && clickDedup.allowed && isWebmasterActive) {
        // Record verified human preview view
        shareService.recordShareView(share.code);
        // Record click in Referral Service
        referralService.recordLinkClick(refCode);

        const profile = webmasterService.getProfile(refCode);
        if (profile) {
          const todayStr = new Date().toISOString().substring(0, 10);
          profile.stats ??= [];
          let todayStat = profile.stats.find(s => s.date === todayStr);
          if (!todayStat) {
            todayStat = { date: todayStr, clicks: 0, videoPlays: 0, newUsers: 0, earningsUsd: 0.0, countryBreakdown: {} };
            profile.stats.push(todayStat);
          }
          todayStat.clicks = (todayStat.clicks || 0) + 1;
          todayStat.linkClicks = todayStat.clicks;
          todayStat.countryBreakdown ??= {};
          todayStat.countryBreakdown[country] = (todayStat.countryBreakdown[country] || 0) + 1;

          profile.sharedLinks ??= [];
          let link = profile.sharedLinks.find(l => l.shortCode === share.code || l.id === share.code);
          if (link) {
            link.clicks = (link.clicks || 0) + 1;
          } else {
            profile.sharedLinks.push({
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
            });
          }

          // Unify totalClicks with the true sum of link clicks
          const sumLinkClicks = profile.sharedLinks.reduce((acc, l) => acc + (l.clicks || 0), 0);
          profile.totalClicks = Math.max((profile.totalClicks || 0) + 1, sumLinkClicks);

          webmasterService._saveWebmastersToDisk();
        }
      }
    } catch (err) {
      console.warn('[Server] Note on HTTP page click tracking:', err.message);
    }

    const html = shareService.renderWebPreviewHtml(share, refCode);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.send(html);
  } catch (err) {
    console.error('[Server] Error rendering share preview:', err);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.status(500).send(`<!DOCTYPE html><html><body><h2>Error loading share preview</h2><p>${err.message}</p></body></html>`);
  }
});

// 🌐 Webmaster Partner Program Terms & Program Overview Web Page (In-App WebView & Public)
app.get(['/webmaster/partner-program', '/partner-program'], (req, res) => {
  const filePath = path.join(__dirname, '../public/webmaster-partner-program.html');
  if (fs.existsSync(filePath)) {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.sendFile(filePath);
  }
  res.redirect('/');
});

// 🚀 Webmaster Direct Invite & Google Play Store Redirect Landing Page
app.get('/join', (req, res) => {
  const refCode = (req.query.ref || req.query.referralCode || req.query.c || 'TBX_VIP').trim().toUpperCase();
  referralService.recordLinkClick(refCode);

  const playStoreUrl = `https://play.google.com/store/apps/details?id=com.airbox.cloud.storage&referrer=ref%3D${encodeURIComponent(refCode)}`;

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Join AirBox - Claim 1024 GB Free Cloud Storage</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;600;700;800&display=swap" rel="stylesheet">
  <style>
    * { margin:0; padding:0; box-sizing:border-box; font-family:'Plus Jakarta Sans',sans-serif; }
    body {
      background: radial-gradient(circle at 50% 0%, #1E3A8A 0%, #0F172A 100%);
      color: #FFF;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 24px;
    }
    .card {
      background: rgba(30, 41, 59, 0.85);
      backdrop-filter: blur(20px);
      border: 1px solid rgba(255, 255, 255, 0.12);
      border-radius: 28px;
      max-width: 460px;
      width: 100%;
      padding: 40px 28px;
      text-align: center;
      box-shadow: 0 25px 60px rgba(0, 0, 0, 0.4);
    }
    .badge {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      background: rgba(37, 99, 235, 0.2);
      border: 1px solid rgba(59, 130, 246, 0.4);
      color: #60A5FA;
      padding: 6px 16px;
      border-radius: 20px;
      font-size: 12px;
      font-weight: 700;
      letter-spacing: 0.5px;
      margin-bottom: 20px;
    }
    .logo-box {
      width: 80px;
      height: 80px;
      background: linear-gradient(135deg, #0066FF 0%, #00C6FF 100%);
      border-radius: 22px;
      display: flex;
      align-items: center;
      justify-content: center;
      margin: 0 auto 20px;
      box-shadow: 0 12px 28px rgba(0, 102, 255, 0.35);
      font-size: 38px;
    }
    h1 { font-size: 26px; font-weight: 800; line-height: 1.25; margin-bottom: 12px; }
    p { font-size: 15px; color: #94A3B8; line-height: 1.6; margin-bottom: 28px; }
    .features-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 12px;
      margin-bottom: 32px;
      text-align: left;
    }
    .feature-item {
      background: rgba(255, 255, 255, 0.04);
      border: 1px solid rgba(255, 255, 255, 0.06);
      border-radius: 16px;
      padding: 12px 14px;
    }
    .feature-item .title { font-size: 13px; font-weight: 700; color: #F1F5F9; }
    .feature-item .sub { font-size: 11px; color: #64748B; margin-top: 2px; }
    .btn-install {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 10px;
      background: #0066FF;
      color: #FFF;
      padding: 16px 28px;
      border-radius: 18px;
      font-size: 16px;
      font-weight: 700;
      text-decoration: none;
      box-shadow: 0 10px 25px rgba(0, 102, 255, 0.4);
      transition: transform 0.2s, background 0.2s;
    }
    .btn-install:hover {
      background: #0052CC;
      transform: translateY(-2px);
    }
    .footer-note {
      font-size: 11px;
      color: #64748B;
      margin-top: 18px;
    }
  </style>
</head>
<body>
  <div class="card">
    <div class="badge">🎁 INVITATION CODE: ${refCode}</div>
    <div class="logo-box">☁️</div>
    <h1>Claim Your Free<br>1024 GB Cloud Storage</h1>
    <p>Backup, stream, and share your videos & photos with military-grade encryption and ultra-fast playback speeds.</p>

    <div class="features-grid">
      <div class="feature-item">
        <div class="title">💾 1024 GB (1 TB)</div>
        <div class="sub">Free Lifetime Storage</div>
      </div>
      <div class="feature-item">
        <div class="title">🎬 4K / HD Player</div>
        <div class="sub">Stream with 0 Buffering</div>
      </div>
      <div class="feature-item">
        <div class="title">⚡ Fast Upload</div>
        <div class="sub">Multi-part Acceleration</div>
      </div>
      <div class="feature-item">
        <div class="title">🛡️ Cloud Backup</div>
        <div class="sub">End-to-End Encrypted</div>
      </div>
    </div>

    <a href="${playStoreUrl}" class="btn-install" id="installBtn">
      <span>Get on Google Play Store</span>
      <span>➔</span>
    </a>
    <div class="footer-note">Official Google Play Store Installation • No credit card required</div>
  </div>

  <script>
    // Auto-open Google Play Store on Android devices
    const userAgent = navigator.userAgent || navigator.vendor || window.opera;
    if (/android/i.test(userAgent)) {
      setTimeout(() => {
        window.location.href = "${playStoreUrl}";
      }, 1200);
    }
  </script>
</body>
</html>`);
});

// API Routes (Mounted under /api and direct route aliases for bulletproof Dio & web client compatibility)
app.use('/api/v1/admin', adminRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api', apiRoutes);
app.use('/', apiRoutes);

// Serve Admin Panel Static Files at /admin with strict no-cache headers for instant updates
const adminDir = path.join(__dirname, '../public/admin');
if (fs.existsSync(adminDir)) {
  app.use('/admin', express.static(adminDir, {
    setHeaders: (res, filePath) => {
      if (filePath.endsWith('.html') || filePath.endsWith('.js') || filePath.endsWith('.css')) {
        res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
        res.set('Pragma', 'no-cache');
        res.set('Expires', '0');
      }
    }
  }));
  app.get('/admin/*', (req, res) => {
    res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.sendFile(path.join(adminDir, 'index.html'));
  });
}

// Serve Dedicated Webmaster Web Portal at /webmaster with strict no-cache headers
const webmasterDir = path.join(__dirname, '../public/webmaster');
if (fs.existsSync(webmasterDir)) {
  app.use('/webmaster', express.static(webmasterDir, {
    setHeaders: (res, filePath) => {
      if (filePath.endsWith('.html') || filePath.endsWith('.js') || filePath.endsWith('.css')) {
        res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
        res.set('Pragma', 'no-cache');
        res.set('Expires', '0');
      }
    }
  }));
  app.get(['/webmaster', '/webmaster/*'], (req, res) => {
    res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.sendFile(path.join(webmasterDir, 'index.html'));
  });
}

// Serve Flutter Web App static files (production inside public/ folder or development path)
let webDir = path.join(__dirname, '../public');
if (!fs.existsSync(webDir)) {
  webDir = path.join(__dirname, '../../terabox_client/build/web');
}
if (fs.existsSync(webDir)) {
  // Clean Policy Page Route Aliases
  app.get(['/privacy', '/privacy-policy'], (req, res) => {
    res.sendFile(path.join(webDir, 'privacy.html'));
  });
  app.get(['/terms', '/terms-of-service'], (req, res) => {
    res.sendFile(path.join(webDir, 'terms.html'));
  });
  app.get(['/clipboard', '/clipboard-policy', '/clipboard-statement'], (req, res) => {
    res.sendFile(path.join(webDir, 'clipboard.html'));
  });
  app.get(['/dmca', '/dmca-notice', '/copyright'], (req, res) => {
    res.sendFile(path.join(webDir, 'dmca.html'));
  });

  app.use(express.static(webDir));
  // Support SPA routing fallback for index.html
  app.get('*', (req, res, next) => {
    // Only fallback if the request is not an /api route, /admin route, /s/:code route, /uploads, or /ws
    if (req.path.startsWith('/api') || req.path.startsWith('/admin') || req.path.startsWith('/s/') || req.path.startsWith('/uploads') || req.path.startsWith('/ws')) {
      return next();
    }
    res.sendFile(path.join(webDir, 'index.html'));
  });
}

if (process.env.VERCEL !== '1') {
  const server = http.createServer(app);

  // Initialize WebSocket Server for Real-Time Telemetry and Admin Sync
  const wss = new WebSocketServer({ noServer: true });

  const getSystemTelemetry = () => {
    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const usedMem = totalMem - freeMem;
    const cpus = os.cpus();
    let idle = 0;
    let total = 0;
    for (const cpu of cpus) {
      for (const type in cpu.times) {
        total += cpu.times[type];
      }
      idle += cpu.times.idle;
    }
    const cpuPercent = total > 0 ? ((total - idle) / total) * 100 : 0;
    return {
      timestamp: new Date().toISOString(),
      cpuPercent: Math.min(100, Math.max(0, cpuPercent)),
      memUsedMb: Math.round(usedMem / (1024 * 1024)),
      memTotalMb: Math.round(totalMem / (1024 * 1024)),
      memUsedPercent: (usedMem / totalMem) * 100,
      uptimeSeconds: os.uptime(),
      loadAvg: os.loadavg(),
    };
  };

  server.on('upgrade', (request, socket, head) => {
    try {
      const host = request.headers.host || `localhost:${env.port}`;
      const parsedUrl = new URL(request.url, `http://${host}`);
      const pathname = parsedUrl.pathname;
      if (
        pathname === '/ws/admin' ||
        pathname === '/ws/admin/telemetry' ||
        pathname === '/ws/notifications' ||
        pathname === '/ws/client' ||
        pathname === '/ws'
      ) {
        const token = parsedUrl.searchParams.get('token');
        const admin = token ? adminAuthService.verifyToken(token) : null;
        wss.handleUpgrade(request, socket, head, (ws) => {
          ws.admin = admin;
          ws.pathname = pathname;
          wss.emit('connection', ws, request);
        });
      } else {
        socket.destroy();
      }
    } catch (_) {
      socket.destroy();
    }
  });

  wss.on('connection', (ws) => {
    const isAdminSocket = ws.pathname === '/ws/admin' || ws.pathname === '/ws/admin/telemetry' || ws.admin;
    
    if (isAdminSocket) {
      // Send immediate initial telemetry snapshot for admin
      ws.send(JSON.stringify({ type: 'TELEMETRY_UPDATE', data: getSystemTelemetry() }));

      const telemetryInterval = setInterval(() => {
        if (ws.readyState === ws.OPEN) {
          ws.send(JSON.stringify({ type: 'TELEMETRY_UPDATE', data: getSystemTelemetry() }));
        }
      }, 3000);

      const onConfigChange = (changeEvent, newConfig) => {
        if (ws.readyState === ws.OPEN) {
          ws.send(JSON.stringify({ type: 'CONFIG_UPDATE', change: changeEvent, config: newConfig }));
        }
      };
      systemConfigStore.registerChangeListener(onConfigChange);

      ws.on('close', () => {
        clearInterval(telemetryInterval);
        systemConfigStore.unregisterChangeListener(onConfigChange);
      });

      ws.on('error', () => {
        clearInterval(telemetryInterval);
        systemConfigStore.unregisterChangeListener(onConfigChange);
      });
    } else {
      // Client Push Socket (Mobile / Web App)
      ws.send(JSON.stringify({
        type: 'CONNECTED',
        service: 'AirBox Real-Time Push Engine',
        timestamp: new Date().toISOString(),
      }));

      // Keepalive ping
      const pingInterval = setInterval(() => {
        if (ws.readyState === ws.OPEN) {
          try { ws.ping(); } catch (_) {}
        }
      }, 30000);

      ws.on('close', () => clearInterval(pingInterval));
      ws.on('error', () => clearInterval(pingInterval));
    }
  });

  const broadcastWsEvent = (eventData) => {
    const payload = JSON.stringify(eventData);
    for (const client of wss.clients) {
      if (client.readyState === 1) { // WebSocket.OPEN
        try { client.send(payload); } catch (_) {}
      }
    }
  };

  authService.on('USER_BANNED', (data) => {
    broadcastWsEvent({ type: 'USER_BANNED', data });
  });
  authService.on('USER_UNBANNED', (data) => {
    broadcastWsEvent({ type: 'USER_UNBANNED', data });
  });
  shareService.on('TAKEDOWN_EXECUTED', (data) => {
    broadcastWsEvent({ type: 'TAKEDOWN_EXECUTED', data });
  });
  notificationService.on('NOTIFICATION_BROADCAST', (data) => {
    broadcastWsEvent({ type: 'SYSTEM_NOTIFICATION_BROADCAST', data });
  });
  systemConfigStore.registerChangeListener((changeEvent) => {
    broadcastWsEvent({
      type: 'CONFIG_UPDATE',
      change: changeEvent,
      config: systemConfigStore.getPublicConfig(),
    });
  });

  server.listen(env.port, async () => {
    console.log(`[AirBox Server] Running on http://localhost:${env.port}`);
    console.log(`[AirBox Server] Admin Panel: http://localhost:${env.port}/admin`);
    console.log(`[AirBox Server] Storage Engine: Cloudflare R2 (${env.r2.bucketName})`);

    // Test R2 connection on startup
    const r2Check = await r2StorageService.testConnection();
    if (r2Check.success) {
      console.log(`[AirBox Server] ✅ Cloudflare R2 Connected Successfully!`);
    } else {
      console.log(`[AirBox Server] ⚠️ R2 Status: ${r2Check.error || 'Configured with public domain ' + env.r2.publicDomain}`);
    }
  });

  // Set generous timeouts for large file uploads (10 minutes)
  server.timeout = 600000; // 10 min total request timeout
  server.keepAliveTimeout = 120000; // 2 min keep-alive
  server.headersTimeout = 620000; // slightly more than server.timeout
}

module.exports = app;
