// Triggering Render Blueprint Auto-Deploy Sync
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const env = require('./config/env');
const apiRoutes = require('./routes/api');
const shareService = require('./services/shareService');
const r2StorageService = require('./services/r2StorageService');

const app = express();

// Ensure uploads folder exists
const uploadsDir = path.join(__dirname, '../uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
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
    service: 'TeraBox Cloud & Cloudflare R2 Engine',
    version: '1.0.0',
    storage: 'Cloudflare R2 (1024 GB S3-Compatible)',
    timestamp: new Date().toISOString(),
  });
});

// 🌐 Public Share Link Web Preview (Video Teaser + File Download)
app.get('/s/:code', async (req, res) => {
  const share = await shareService.getShare(req.params.code);
  if (!share) {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.status(404).send(`<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>Link Expired - TeraBox</title><link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;600;800&display=swap" rel="stylesheet"><style>*{margin:0;padding:0;box-sizing:border-box;font-family:'Plus Jakarta Sans',sans-serif}body{background:#F8FAFC;display:flex;align-items:center;justify-content:center;min-height:100vh;padding:20px}.card{background:#FFF;border-radius:24px;padding:48px 32px;text-align:center;max-width:440px;width:100%;box-shadow:0 10px 40px rgba(0,0,0,0.06);border:1px solid #E2E8F0}.icon{width:72px;height:72px;border-radius:20px;background:#FEF2F2;border:1px solid #FECACA;display:flex;align-items:center;justify-content:center;margin:0 auto 20px;font-size:32px}h2{font-size:22px;font-weight:800;color:#0F172A;margin-bottom:8px}p{font-size:14px;color:#64748B;line-height:1.6;margin-bottom:24px}a{display:inline-block;background:#0066FF;color:#FFF;padding:14px 32px;border-radius:16px;font-weight:700;font-size:14px;text-decoration:none;box-shadow:0 6px 18px rgba(0,102,255,0.25)}</style></head><body><div class="card"><div class="icon">🔗</div><h2>Share Link Not Found</h2><p>This share link has expired or the server was restarted. Please ask the sender to generate a new share link from their TeraBox app.</p><a href="/">Go to TeraBox Home</a></div></body></html>`);
    return;
  }
  const html = shareService.renderWebPreviewHtml(share);
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(html);
});

// API Routes
app.use('/api', apiRoutes);

const server = app.listen(env.port, async () => {
  console.log(`[TeraBox Server] Running on http://localhost:${env.port}`);
  console.log(`[TeraBox Server] Storage Engine: Cloudflare R2 (${env.r2.bucketName})`);
  
  // Test R2 connection on startup
  const r2Check = await r2StorageService.testConnection();
  if (r2Check.success) {
    console.log(`[TeraBox Server] ✅ Cloudflare R2 Connected Successfully!`);
  } else {
    console.log(`[TeraBox Server] ⚠️ R2 Status: ${r2Check.error || 'Configured with public domain ' + env.r2.publicDomain}`);
  }
});

// Set generous timeouts for large file uploads (10 minutes)
server.timeout = 600000; // 10 min total request timeout
server.keepAliveTimeout = 120000; // 2 min keep-alive
server.headersTimeout = 620000; // slightly more than server.timeout
