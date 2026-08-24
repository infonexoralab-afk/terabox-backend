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
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

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

// 🌐 Public Share Link Web Preview (5-10 Second Video Teaser + App Interstitial)
app.get('/s/:code', (req, res) => {
  const share = shareService.getShare(req.params.code);
  const html = shareService.renderWebPreviewHtml(share);
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(html);
});

// API Routes
app.use('/api', apiRoutes);

app.listen(env.port, async () => {
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
