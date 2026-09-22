const fs = require('fs');
const path = require('path');
const EventEmitter = require('events');
const env = require('../config/env');
const r2StorageService = require('./r2StorageService');

const isVercel = process.env.VERCEL === '1';
const dataDir = isVercel ? '/tmp/data' : path.join(__dirname, '../../data');
if (!fs.existsSync(dataDir)) {
  try { fs.mkdirSync(dataDir, { recursive: true }); } catch (_) {}
}
const sharesFilePath = path.join(dataDir, 'shares.json');

class ShareService extends EventEmitter {
  constructor() {
    super();
    this.shares = new Map();
    this._loadSharesFromDisk();
  }

  _loadSharesFromDisk() {
    try {
      if (fs.existsSync(sharesFilePath)) {
        const raw = fs.readFileSync(sharesFilePath, 'utf8');
        const list = JSON.parse(raw);
        if (Array.isArray(list)) {
          for (const item of list) {
            if (item && item.code) {
              this.shares.set(item.code, item);
            }
          }
          console.log(`[ShareService] Loaded ${this.shares.size} persistent shares from local disk.`);
        }
      }
    } catch (err) {
      console.warn(`[ShareService] Could not load shares from disk:`, err.message);
    }
  }

  _saveSharesToDisk() {
    try {
      const list = Array.from(this.shares.values());
      fs.writeFileSync(sharesFilePath, JSON.stringify(list, null, 2), 'utf8');
    } catch (err) {
      console.warn(`[ShareService] Could not save shares to disk:`, err.message);
    }
  }

  // Create Short Share Link
  async createShare(fileData, customCode = null, requestAppUrl = null) {
    const rawName = fileData.name || fileData.fileName || 'Shared_File';
    const currentUserId = fileData.userId || fileData.creatorUserId || '';

    // Check if an existing share already exists for this exact file by this user
    let existingShare = null;
    if (customCode && this.shares.has(customCode)) {
      existingShare = this.shares.get(customCode);
    } else if (fileData.id && currentUserId) {
      for (const s of this.shares.values()) {
        if (s.fileId === fileData.id && (s.userId === currentUserId || s.creatorUserId === currentUserId)) {
          existingShare = s;
          break;
        }
      }
    }

    if (existingShare) {
      if (fileData.referralCode) {
        existingShare.referralCode = fileData.referralCode;
        const baseAppUrl = requestAppUrl || env.appUrl;
        existingShare.shareUrl = `${baseAppUrl}/s/${existingShare.code}?ref=${fileData.referralCode}`;
      }
      this._saveSharesToDisk();
      return existingShare;
    }

    const code = customCode || Math.random().toString(36).substring(2, 8) + Math.random().toString(36).substring(2, 4);
    
    const isFolder = fileData.isFolder === true || (fileData.children && fileData.children.length > 0) || !rawName.includes('.') || fileData.extension === 'folder' || fileData.extension === 'directory';
    const ext = isFolder ? '' : (fileData.extension || (rawName.includes('.') ? rawName.split('.').pop() : 'dat')).toLowerCase();
    const isVideo = !isFolder && (fileData.isVideo ?? ['mp4', 'mkv', 'mov', 'avi', 'webm', 'flv', 'ts', 'm4v', '3gp', 'wmv', 'mpg', 'mpeg', 'vob'].includes(ext));
    
    let downloadUrl = (fileData.downloadUrl && fileData.downloadUrl.trim().length > 0) ? fileData.downloadUrl : (fileData.publicUrl || '');
    if (!downloadUrl && fileData.r2Key) {
      downloadUrl = `${env.r2.publicDomain}/${fileData.r2Key}`;
    }
    if (!downloadUrl || downloadUrl.trim().length === 0) {
      const safeName = rawName.replace(/[^a-zA-Z0-9._-]/g, '_');
      downloadUrl = `${env.r2.publicDomain}/uploads/${safeName}`;
    }
    const streamUrl = isVideo ? (fileData.streamUrl || downloadUrl) : null;

    const baseAppUrl = requestAppUrl || env.appUrl;

    const shareItem = {
      code,
      fileId: fileData.id || `node_${Date.now()}`,
      fileName: rawName,
      sizeBytes: Number(fileData.sizeBytes) || 0,
      extension: ext,
      isVideo: isVideo,
      isFolder: isFolder,
      itemCount: Number(fileData.itemCount) || (fileData.children ? fileData.children.length : 0),
      children: Array.isArray(fileData.children) ? fileData.children : [],
      durationSeconds: Number(fileData.durationSeconds) || 0,
      creatorName: fileData.creatorName || fileData.userName || fileData.email || 'AirBox User',
      r2Key: fileData.r2Key || '',
      downloadUrl: downloadUrl,
      streamUrl: streamUrl,
      createdAt: new Date().toISOString(),
      viewsCount: 0,
      appRedirectUrl: `terabox://share/${code}`,
      shareUrl: fileData.referralCode ? `${baseAppUrl}/s/${code}?ref=${fileData.referralCode}` : `${baseAppUrl}/s/${code}`,
      referralCode: fileData.referralCode || '',
      userId: fileData.userId || fileData.creatorUserId || '',
      creatorUserId: fileData.creatorUserId || fileData.userId || '',
    };

    this.shares.set(code, shareItem);
    this._saveSharesToDisk();

    // Upload to Cloudflare R2 for stateless persistence
    try {
      const r2Key = `shares/${code}.json`;
      console.log(`[ShareService] Saving share ${code} permanently to Cloudflare R2...`);
      await r2StorageService.uploadBuffer(
        r2Key,
        Buffer.from(JSON.stringify(shareItem, null, 2), 'utf8'),
        'application/json'
      );
      console.log(`[ShareService] ✅ Share ${code} saved permanently to R2.`);
    } catch (err) {
      console.error(`[ShareService] ⚠️ Failed to save share ${code} to R2:`, err.message);
    }

    return shareItem;
  }

  // Helper to extract clean alphanumeric shortCode from any raw string/URL
  normalizeCode(raw) {
    if (!raw) return '';
    let str = String(raw).trim();
    if (str.includes('/s/')) str = str.split('/s/')[1];
    if (str.includes('/share/')) str = str.split('/share/')[1];
    if (str.includes('?')) str = str.split('?')[0];
    if (str.includes('#')) str = str.split('#')[0];
    return str.trim();
  }

  // Get Share Details by Short Code / URL / fileId
  async getShare(rawCode) {
    if (!rawCode) return null;
    const cleanCode = this.normalizeCode(rawCode);
    
    // 1. Direct Map Key Lookup
    let share = this.shares.get(cleanCode) || this.shares.get(rawCode);
    
    // 2. Search In-Memory by Multi-Field (fileId, shortCode, id, targetNodeId)
    if (!share) {
      for (const s of this.shares.values()) {
        if (
          s.code === cleanCode ||
          s.code === rawCode ||
          s.shortCode === cleanCode ||
          s.fileId === cleanCode ||
          s.fileId === rawCode ||
          s.targetNodeId === cleanCode ||
          s.id === cleanCode
        ) {
          share = s;
          break;
        }
      }
    }

    // 3. Search Local Disk Persistence
    if (!share) {
      this._loadSharesFromDisk();
      share = this.shares.get(cleanCode) || this.shares.get(rawCode);
      if (!share) {
        for (const s of this.shares.values()) {
          if (
            s.code === cleanCode ||
            s.code === rawCode ||
            s.shortCode === cleanCode ||
            s.fileId === cleanCode ||
            s.fileId === rawCode ||
            s.targetNodeId === cleanCode ||
            s.id === cleanCode
          ) {
            share = s;
            break;
          }
        }
      }
    }
    
    // 4. Fetch from Cloudflare R2 Cloud
    if (!share && cleanCode) {
      try {
        console.log(`[ShareService] Share ${cleanCode} not in local cache. Fetching from Cloudflare R2...`);
        const r2Share = await r2StorageService.downloadJson(`shares/${cleanCode}.json`);
        if (r2Share) {
          console.log(`[ShareService] ✅ Successfully restored share ${cleanCode} from R2!`);
          share = r2Share;
          this.shares.set(cleanCode, share);
          this.shares.set(share.code || cleanCode, share);
          this._saveSharesToDisk();
        }
      } catch (err) {
        console.error(`[ShareService] Failed to fetch share ${cleanCode} from R2:`, err.message);
      }
    }

    if (!share) {
      return null;
    }

    return share;
  }

  // Record an actual verified human view on the public share preview landing page
  recordShareView(rawCode) {
    const cleanCode = (rawCode || '').trim();
    const share = this.shares.get(cleanCode);
    if (share && !share.isBanned) {
      share.viewsCount = (share.viewsCount || 0) + 1;
      this._saveSharesToDisk();
      return share.viewsCount;
    }
    return 0;
  }

  // Render Human-Crafted, Responsive, Exact AirBox Web Share Page
  renderWebPreviewHtml(share, explicitRefCode = '') {
    const activeRefCode = (explicitRefCode || share.referralCode || '').trim().toUpperCase();
    const formatBytes = (bytes) => {
      if (!bytes || bytes === 0) return '0 B';
      const k = 1024;
      const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
      const i = Math.floor(Math.log(bytes) / Math.log(k));
      return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + sizes[i];
    };

    const formatDuration = (seconds) => {
      const sec = Math.max(0, parseInt(seconds, 10) || 0);
      const h = Math.floor(sec / 3600);
      const m = Math.floor((sec % 3600) / 60);
      const s = sec % 60;
      const pad = (n) => n.toString().padStart(2, '0');
      return h > 0 ? `${pad(h)}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
    };

    const formatCreatorName = (name) => {
      if (!name || name === 'AirBox User' || name === 'AirBox Cloud User' || name === 'TeraBox User' || name === 'TeraBox Cloud User' || name === 'external') return 'AirBox User';
      const clean = String(name).trim();
      if (clean.includes('@')) {
        const [u, d] = clean.split('@');
        const masked = u.length > 2 ? u.slice(0, 2) + '***' + u.slice(-1) : u + '***';
        return `${masked}@${d}`;
      }
      if (clean.length > 3) {
        return clean.slice(0, 2) + '***' + clean.slice(-1);
      }
      return clean;
    };

    const rawName = share.fileName || 'Shared File';
    const isFolder = share.isFolder === true || (share.children && share.children.length > 0) || !rawName.includes('.') || share.extension === 'folder' || share.extension === 'directory';
    const ext = isFolder ? '' : (share.extension || (rawName.includes('.') ? rawName.split('.').pop() : 'dat')).toLowerCase();
    const isVideo = !isFolder && (share.isVideo === true || ['mp4', 'mkv', 'mov', 'avi', 'webm', 'flv', 'ts', 'm4v', '3gp', 'wmv', 'mpg', 'mpeg', 'vob'].includes(ext));
    const isImage = !isFolder && ['jpg', 'jpeg', 'png', 'webp', 'gif', 'svg', 'bmp', 'heic', 'ico', 'tiff'].includes(ext);
    const isApk = !isFolder && ['apk', 'xapk', 'apks', 'aab'].includes(ext);
    const isPdf = !isFolder && ext === 'pdf';
    const isAudio = !isFolder && ['mp3', 'wav', 'flac', 'm4a', 'aac', 'ogg', 'wma', 'opus', 'mid', 'midi'].includes(ext);
    const isArchive = !isFolder && ['zip', 'rar', '7z', 'tar', 'gz', 'iso', 'bz2', 'xz', 'tgz'].includes(ext);
    const isJsonOrCode = !isFolder && ['json', 'js', 'ts', 'jsx', 'tsx', 'html', 'htm', 'css', 'py', 'java', 'c', 'cpp', 'dart', 'xml', 'yaml', 'yml', 'sql', 'sh', 'php', 'env', 'log', 'md', 'txt', 'ini', 'conf'].includes(ext);

    const childCount = (share.children ? share.children.length : 0) || share.itemCount || 0;
    const displaySize = formatBytes(share.sizeBytes || 0);
    const displayDuration = share.durationSeconds && share.durationSeconds > 0 ? formatDuration(share.durationSeconds) : '';
    const creatorDisplay = formatCreatorName(share.creatorName);
    const directFileUrl = share.downloadUrl || share.streamUrl || (share.r2Key ? `${env.r2.publicDomain}/${share.r2Key}` : '');
    
    const d = new Date(share.uploadedAt || share.createdAt || Date.now());
    const uploadDate = `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`;
    if (share.isBanned) {
      return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Content Unavailable - DMCA Notice</title>
  <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@500;700;800&display=swap" rel="stylesheet">
  <style>
    * { margin:0; padding:0; box-sizing:border-box; font-family:'Plus Jakarta Sans',sans-serif; }
    body { background:#F8FAFC; min-height:100vh; display:flex; align-items:center; justify-content:center; padding:20px; }
    .card { background:#FFFFFF; border:1px solid #E2E8F0; border-radius:24px; padding:44px 32px; max-width:440px; width:100%; text-align:center; }
    .icon-badge { width:64px; height:64px; border-radius:18px; background:#FEF2F2; border:1px solid #FECACA; color:#DC2626; display:flex; align-items:center; justify-content:center; margin:0 auto 20px; }
    h1 { font-size:20px; font-weight:800; color:#0F172A; margin-bottom:10px; }
    p { font-size:13.5px; color:#64748B; line-height:1.6; margin-bottom:24px; }
    .notice-box { background:#F1F5F9; border-radius:12px; padding:12px 16px; font-size:12px; color:#475569; margin-bottom:24px; text-align:left; font-family:monospace; }
    .btn { display:inline-flex; align-items:center; justify-content:center; background:#0066FF; color:#FFF; padding:12px 28px; border-radius:12px; font-weight:700; font-size:13.5px; text-decoration:none; }
  </style>
</head>
<body>
  <div class="card">
    <div class="icon-badge">
      <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
    </div>
    <h1>Content Unavailable</h1>
    <p>This file or link is no longer accessible due to a copyright infringement notice or Trust & Safety policy violation.</p>
    <div class="notice-box">
      <div>Reference: ${share.code}</div>
      <div>Reason: ${share.banReason || 'DMCA Takedown Notice'}</div>
    </div>
    <a href="/" class="btn">Go to AirBox</a>
  </div>
</body>
</html>`;
    }

    return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover">
  <title>${rawName} - AirBox 1024 GB Free Cloud Storage</title>
  <meta name="title" content="${rawName} - AirBox 1024 GB Free Cloud Storage">
  <meta name="description" content="View, stream or download ${rawName} (${displaySize}) safely on AirBox. Claim 1024 GB permanent free cloud storage, fast photo backup and 4K media player.">
  <meta name="robots" content="index, follow">
  <link rel="icon" type="image/png" href="/app_logo.png">
  <link rel="apple-touch-icon" href="/app_logo.png">

  <!-- OpenGraph / Facebook / WhatsApp -->
  <meta property="og:type" content="${isVideo ? 'video.other' : 'website'}">
  <meta property="og:site_name" content="AirBox Cloud">
  <meta property="og:title" content="${rawName} (${displaySize}) - AirBox Cloud">
  <meta property="og:description" content="View, stream or download ${rawName} (${displaySize}) on AirBox. 1024 GB permanent free cloud storage.">
  <meta property="og:image" content="/assets/images/hero_img.png">

  <!-- Twitter Cards -->
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${rawName} (${displaySize}) - AirBox Cloud">
  <meta name="twitter:description" content="Stream or download ${rawName} with high-speed multi-part transfer on AirBox.">
  <meta name="twitter:image" content="/assets/images/hero_img.png">

  <!-- Schema.org Digital Document / Media Object JSON-LD -->
  <script type="application/ld+json">
  {
    "@context": "https://schema.org",
    "@type": "${isVideo ? 'VideoObject' : 'DigitalDocument'}",
    "name": "${rawName.replace(/"/g, '\\"')}",
    "description": "Shared file on AirBox Cloud Storage (${displaySize})",
    "encodingFormat": "${ext}",
    "contentSize": "${displaySize}",
    "provider": {
      "@type": "Organization",
      "name": "AirBox",
      "url": "https://airbox.one"
    }
  }
  </script>

  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800;900&display=swap" rel="stylesheet">
  <style>
    :root {
      --primary: #0066FF;
      --primary-hover: #0052CC;
      --primary-light: #EFF6FF;
      --bg-card: #FFFFFF;
      --text-main: #0F172A;
      --text-muted: #64748B;
      --border-color: #E2E8F0;
    }
    * { margin: 0; padding: 0; box-sizing: border-box; font-family: 'Plus Jakarta Sans', sans-serif; -webkit-tap-highlight-color: transparent; }
    html, body {
      min-height: 100%;
      min-height: 100dvh;
      background-color: #FFFFFF;
    }
    body {
      color: #0F172A;
      display: flex;
      flex-direction: column;
      justify-content: space-between;
      overflow-x: hidden;
      overflow-y: auto;
    }
    
    .navbar {
      background: #FFFFFF;
      border-bottom: 1px solid #F1F5F9;
      padding: 10px 16px;
      height: 56px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      flex-shrink: 0;
      z-index: 50;
      max-width: 480px;
      width: 100%;
      margin: 0 auto;
    }
    .brand {
      display: flex;
      align-items: center;
      gap: 10px;
      text-decoration: none;
    }
    .brand-logo-wrap {
      width: 36px;
      height: 36px;
      border-radius: 9px;
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
      background: transparent;
      overflow: hidden;
    }
    .brand-logo-img {
      width: 100%;
      height: 100%;
      object-fit: contain;
      display: block;
      border-radius: 9px;
    }
    .brand-text-container {
      display: flex;
      flex-direction: column;
      line-height: 1.2;
    }
    .brand-name {
      font-size: 15px;
      font-weight: 800;
      color: #0F172A;
      letter-spacing: -0.3px;
    }
    .brand-subtitle {
      font-size: 11px;
      font-weight: 500;
      color: #64748B;
    }
    .nav-right {
      display: flex;
      align-items: center;
      gap: 10px;
    }
    .btn-nav-app {
      background: #0066FF;
      color: #FFFFFF;
      font-size: 13px;
      font-weight: 700;
      padding: 8px 18px;
      border-radius: 9999px;
      border: none;
      cursor: pointer;
      box-shadow: none !important;
      transition: all 0.2s ease;
    }
    .btn-nav-app:active {
      transform: scale(0.96);
      background: #0052CC;
    }

    .main-stage {
      flex: 1;
      max-width: 480px;
      width: 100%;
      margin: 0 auto;
      padding: 14px 16px 12px 16px;
      display: flex;
      flex-direction: column;
      min-height: 0;
      justify-content: flex-start;
    }
    .uploader-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 8px;
    }
    .uploader-name {
      font-size: 14.5px;
      font-weight: 700;
      color: #0F172A;
    }
    .uploader-validity {
      font-size: 11.5px;
      color: #94A3B8;
      margin-top: 2px;
    }
    .btn-more-circle {
      width: 34px;
      height: 34px;
      border-radius: 50%;
      background: #FFFFFF;
      border: 1px solid #E2E8F0;
      color: #64748B;
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      box-shadow: none !important;
      transition: all 0.15s ease;
    }
    .btn-more-circle:active {
      background: #F1F5F9;
    }
    .file-headline-title {
      font-size: 16.5px;
      font-weight: 800;
      color: #0F172A;
      line-height: 1.35;
      word-break: break-word;
      overflow-wrap: break-word;
      display: -webkit-box;
      -webkit-line-clamp: 2;
      -webkit-box-orient: vertical;
      overflow: hidden;
      margin-bottom: 14px;
    }

    .dropdown-menu {
      position: absolute;
      top: 44px;
      right: 0;
      background: #FFFFFF;
      border: 1px solid #E2E8F0;
      border-radius: 14px;
      box-shadow: 0 10px 30px rgba(0,0,0,0.12);
      width: 230px;
      z-index: 60;
      display: none;
      overflow: hidden;
    }
    .dropdown-item {
      padding: 12px 16px;
      display: flex;
      align-items: center;
      gap: 12px;
      font-size: 13.5px;
      font-weight: 600;
      color: #1E293B;
      cursor: pointer;
      border-bottom: 1px solid #F8FAFC;
    }
    .dropdown-item:hover {
      background: #F8FAFC;
      color: #0066FF;
    }

    /* Video Player Preview Container */
    .media-player-container {
      background: radial-gradient(circle at 50% 35%, #2a201a 0%, #15100c 60%, #080605 100%);
      border-radius: 18px;
      overflow: hidden;
      position: relative;
      aspect-ratio: 16/9;
      max-height: clamp(170px, 32vh, 230px);
      cursor: pointer;
      display: flex;
      flex-direction: column;
      justify-content: center;
      align-items: center;
      width: 100%;
      flex-shrink: 0;
      box-shadow: none !important;
    }
    .center-view-in-app-btn {
      background: rgba(15, 23, 42, 0.88);
      border: 1px solid rgba(255, 255, 255, 0.15);
      color: #FFFFFF;
      padding: 7px 16px;
      border-radius: 9999px;
      display: inline-flex;
      align-items: center;
      gap: 8px;
      font-size: 13.5px;
      font-weight: 700;
      box-shadow: none !important;
    }
    .pill-free-tag {
      background: #0066FF;
      color: #FFFFFF;
      font-size: 11px;
      font-weight: 800;
      padding: 2px 8px;
      border-radius: 9999px;
    }
    .player-bottom-duration {
      position: absolute;
      bottom: 12px;
      left: 14px;
      color: rgba(255, 255, 255, 0.9);
      font-size: 12px;
      font-weight: 600;
      letter-spacing: 0.2px;
    }

    /* Image Preview Container */
    .image-preview-container {
      background: #0B0F19;
      border-radius: 18px;
      overflow: hidden;
      position: relative;
      aspect-ratio: 16/9;
      max-height: clamp(170px, 32vh, 230px);
      cursor: pointer;
      display: flex;
      justify-content: center;
      align-items: center;
      width: 100%;
      flex-shrink: 0;
      border: 1px solid #E2E8F0;
      box-shadow: none !important;
    }
    .image-preview-tag {
      width: 100%;
      height: 100%;
      object-fit: cover;
      filter: blur(20px);
      -webkit-filter: blur(20px);
      transform: scale(1.18);
      pointer-events: none;
    }
    
    /* Folder Card Container */
    .folder-card-container {
      background: #FFFFFF;
      border-radius: 18px;
      border: 1.5px solid #E2E8F0;
      padding: 16px;
      display: flex;
      flex-direction: column;
      width: 100%;
      box-shadow: none !important;
      cursor: pointer;
    }
    .folder-header-row {
      display: flex;
      align-items: center;
      gap: 12px;
      width: 100%;
    }
    .folder-children-list {
      display: flex;
      flex-direction: column;
      gap: 6px;
      width: 100%;
      max-height: 140px;
      overflow-y: auto;
      border-top: 1px solid #F1F5F9;
      padding-top: 10px;
      margin-top: 12px;
    }
    .folder-child-item {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 6px 10px;
      background: #F8FAFC;
      border-radius: 8px;
      font-size: 12px;
    }
    .folder-child-name {
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      max-width: 240px;
      color: #1E293B;
      font-weight: 600;
    }
    .folder-child-size {
      color: #94A3B8;
      font-size: 11px;
      font-weight: 600;
    }

    /* Clean, Professional Human-Designed File Card */
    .file-hero-card {
      background: #FFFFFF;
      border-radius: 20px;
      border: 1.5px solid #E2E8F0;
      padding: 38px 20px 34px;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      text-align: center;
      width: 100%;
      cursor: pointer;
      box-shadow: none !important;
      transition: background-color 0.15s ease;
    }
    .file-hero-card:active {
      background: #F8FAFC;
    }
    .file-hero-icon-container {
      margin-bottom: 16px;
    }
    .file-hero-icon-box {
      width: 72px;
      height: 72px;
      border-radius: 20px;
      display: flex;
      align-items: center;
      justify-content: center;
      box-shadow: none !important;
    }
    .file-hero-details {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 4px;
      width: 100%;
    }
    .file-hero-type {
      font-size: 13.5px;
      font-weight: 800;
      letter-spacing: 0.5px;
      text-transform: uppercase;
    }
    .file-hero-size {
      font-size: 13px;
      font-weight: 600;
      color: #64748B;
    }
    
    .bottom-bar-container {
      background: #FFFFFF;
      border-top: 1px solid #F1F5F9;
      padding: 10px 16px calc(12px + env(safe-area-inset-bottom, 0px));
      flex-shrink: 0;
      max-width: 480px;
      width: 100%;
      margin: 0 auto;
    }
    .promo-notice-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      font-size: 11.5px;
      color: #334155;
      font-weight: 600;
      margin-bottom: 10px;
      gap: 8px;
    }
    .promo-notice-left {
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .bottom-buttons-row {
      display: flex;
      gap: 10px;
      width: 100%;
    }
    .btn-bottom-dl {
      flex: 1;
      height: 48px;
      background: #EFF6FF;
      border: 1.5px solid #BFDBFE;
      border-radius: 14px;
      color: #0066FF;
      font-weight: 800;
      font-size: 14px;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
      cursor: pointer;
      box-shadow: none !important;
      transition: all 0.15s ease;
    }
    .btn-bottom-dl:active {
      transform: scale(0.97);
      background: #DBEAFE;
    }
    .btn-bottom-watch {
      flex: 1;
      height: 48px;
      background: #0066FF;
      border: none;
      border-radius: 14px;
      color: #FFFFFF;
      font-weight: 800;
      font-size: 14px;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
      cursor: pointer;
      box-shadow: none !important;
      transition: all 0.15s ease;
    }
    .btn-bottom-watch:active {
      transform: scale(0.97);
      background: #0052CC;
    }

    .report-modal-overlay, .policy-modal-overlay { position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(15, 23, 42, 0.65); backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px); display: none; align-items: flex-end; justify-content: center; z-index: 200; }
    .report-modal-card, .policy-modal-card { background: #FFFFFF; border-radius: 24px 24px 0 0; max-width: 500px; width: 100%; max-height: 90vh; max-height: 90dvh; display: flex; flex-direction: column; overflow: hidden; box-shadow: 0 -10px 40px rgba(0,0,0,0.2); animation: slideUp 0.25s cubic-bezier(0.16, 1, 0.3, 1); }
    @keyframes slideUp { from { transform: translateY(100%); } to { transform: translateY(0); } }
    
    .modal-top-header { padding: 14px 20px 10px 20px; flex-shrink: 0; border-bottom: 1px solid #F1F5F9; }
    .modal-drag-handle { width: 36px; height: 4px; background: #CBD5E1; border-radius: 9999px; margin: 0 auto 10px auto; }
    .modal-title-row { display: flex; justify-content: space-between; align-items: center; }
    .modal-main-title { font-size: 15.5px; font-weight: 800; color: #0F172A; letter-spacing: -0.2px; }
    .btn-modal-close { background: #F1F5F9; border: none; color: #64748B; cursor: pointer; width: 28px; height: 28px; border-radius: 50%; display: flex; align-items: center; justify-content: center; transition: all 0.15s ease; }
    .btn-modal-close:hover { background: #E2E8F0; color: #0F172A; }
    
    .modal-scrollable-body { padding: 16px 20px 24px 20px; overflow-y: auto; flex: 1; -webkit-overflow-scrolling: touch; }
    
    /* Responsive Form Elements */
    .form-section-header { display: flex; align-items: center; gap: 8px; margin: 18px 0 10px 0; }
    .form-section-header:first-of-type { margin-top: 4px; }
    .section-badge { width: 20px; height: 20px; border-radius: 6px; background: #EFF6FF; color: #0066FF; border: 1px solid #BFDBFE; font-size: 11px; font-weight: 800; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
    .section-title-text { font-size: 12px; font-weight: 800; color: #0F172A; text-transform: uppercase; letter-spacing: 0.4px; }
    
    .form-group { display: flex; flex-direction: column; gap: 4px; margin-bottom: 12px; width: 100%; box-sizing: border-box; }
    .form-label { font-size: 11.5px; font-weight: 700; color: #334155; line-height: 1.3; margin-bottom: 4px; display: block; }
    .form-input, .form-select, .form-textarea { width: 100%; height: 42px; border: 1.5px solid #E2E8F0; border-radius: 10px; padding: 0 13px; font-size: 13px; color: #0F172A; background: #F8FAFC; transition: all 0.15s ease; outline: none; box-sizing: border-box; }
    .form-textarea { height: 58px; padding: 9px 13px; resize: none; font-family: inherit; }
    .form-input:focus, .form-select:focus, .form-textarea:focus { border-color: #0066FF; background: #FFFFFF; box-shadow: 0 0 0 3px rgba(0, 102, 255, 0.12); }
    .form-input.is-invalid, .form-select.is-invalid, .form-textarea.is-invalid { border-color: #EF4444 !important; background: #FEF2F2 !important; box-shadow: 0 0 0 3px rgba(239, 68, 68, 0.12) !important; }
    .field-error-msg { font-size: 11px; font-weight: 600; color: #DC2626; margin-top: 3px; display: none; line-height: 1.3; }

    .form-row-2 { display: flex; gap: 10px; width: 100%; align-items: flex-start; }
    .form-row-2 > .form-group { flex: 1; min-width: 0; }
    @media (max-width: 540px) {
      .form-row-2 { flex-direction: column; gap: 0; }
    }

    /* Custom Styled Legal Declarations Checkboxes */
    .legal-checkbox-container { display: flex; flex-direction: column; gap: 10px; margin-bottom: 16px; }
    .legal-check-card { display: flex; align-items: flex-start; gap: 10px; padding: 11px 12px; background: #F8FAFC; border: 1.5px solid #E2E8F0; border-radius: 10px; cursor: pointer; transition: all 0.15s ease; text-align: left; box-sizing: border-box; }
    .legal-check-card:hover { border-color: #CBD5E1; background: #F1F5F9; }
    .legal-check-card.is-invalid { border-color: #EF4444 !important; background: #FEF2F2 !important; box-shadow: 0 0 0 3px rgba(239, 68, 68, 0.12) !important; }
    .legal-check-card input[type="checkbox"] { width: 18px; height: 18px; accent-color: #16A34A; margin-top: 2px; flex-shrink: 0; cursor: pointer; }
    .legal-check-card-content { display: flex; flex-direction: column; gap: 2px; }
    .legal-check-title { font-size: 11.5px; font-weight: 700; color: #0F172A; }
    .legal-check-desc { font-size: 11px; color: #475569; line-height: 1.4; }

    .btn-submit-report { width: 100%; height: 46px; background: #0066FF; color: #FFFFFF; font-weight: 700; font-size: 14px; border: none; border-radius: 12px; cursor: pointer; transition: all 0.15s ease; }
    .btn-submit-report:hover { background: #0052CC; }
    .btn-submit-report:disabled { background: #94A3B8; cursor: not-allowed; }
    
    /* Statutory Policy & Banner Styles */
    .statutory-banner {
      background: #F0F7FF;
      border: 1px solid #BFDBFE;
      border-radius: 12px;
      padding: 13px 15px;
      margin-bottom: 15px;
      font-size: 12px;
      color: #1E3A8A;
      line-height: 1.6;
      text-align: justify;
      text-justify: inter-word;
      word-break: normal;
      overflow-wrap: break-word;
      hyphens: auto;
    }
    .statutory-banner strong {
      font-weight: 800;
      color: #1E3A8A;
    }
    .policy-para {
      font-size: 12px;
      color: #334155;
      line-height: 1.6;
      margin-bottom: 8px;
      text-align: justify;
      text-justify: inter-word;
      word-break: normal;
      overflow-wrap: break-word;
      hyphens: auto;
    }
    .statutory-card {
      background: #F8FAFC;
      border: 1px solid #E2E8F0;
      border-radius: 12px;
      padding: 13px 15px;
      margin-bottom: 12px;
      font-size: 12px;
      line-height: 1.6;
      color: #1E293B;
      text-align: justify;
      text-justify: inter-word;
      word-break: normal;
      overflow-wrap: break-word;
      hyphens: auto;
    }
    .statutory-card-header {
      font-weight: 800;
      font-size: 13px;
      color: #0F172A;
      margin-bottom: 8px;
      border-bottom: 1px solid #E2E8F0;
      padding-bottom: 6px;
      text-align: left;
    }
    .statutory-card ul {
      margin-top: 6px;
      margin-bottom: 0;
      padding-left: 18px;
    }
    .statutory-card ul li {
      font-size: 11.5px;
      color: #334155;
      line-height: 1.55;
      margin-bottom: 4px;
      text-align: justify;
      text-justify: inter-word;
    }
    .grievance-contact-card {
      background: #EFF6FF;
      border: 1px solid #BFDBFE;
      border-radius: 12px;
      padding: 12px 14px;
      margin-bottom: 14px;
      font-size: 12px;
      color: #1E3A8A;
      line-height: 1.55;
      text-align: justify;
      text-justify: inter-word;
    }
    .grievance-contact-card-title {
      font-weight: 800;
      font-size: 12.5px;
      color: #1E3A8A;
      margin-bottom: 4px;
      text-align: left;
    }
    .grievance-email-link { color: #0066FF; font-weight: 700; text-decoration: none; }
    .grievance-email-link:hover { text-decoration: underline; }
    
    .modal-bottom-actions { padding: 12px 20px calc(14px + env(safe-area-inset-bottom, 0px)) 20px; border-top: 1px solid #F1F5F9; display: flex; flex-shrink: 0; background: #FFFFFF; }
    .btn-understood { width: 100%; height: 44px; background: #0066FF; color: #FFFFFF; border: none; border-radius: 12px; font-size: 13.5px; font-weight: 700; cursor: pointer; transition: all 0.15s ease; }
    .btn-understood:hover { background: #0052CC; }

    @media (max-width: 600px) {
      .report-modal-card, .policy-modal-card {
        border-radius: 20px 20px 0 0;
        max-height: 90vh;
      }
      .form-row-2 {
        grid-template-columns: 1fr;
        gap: 0;
      }
      .modal-scrollable-body {
        padding: 16px 16px 20px 16px;
      }
    }
  </style>
</head>
<body>

  <nav class="navbar">
    <div class="brand">
      <div class="brand-logo-wrap">
        <img src="/app_logo.png" onerror="this.onerror=null; this.src='/favicon.png';" alt="AirBox" class="brand-logo-img" />
      </div>
      <div class="brand-text-container">
        <span class="brand-name">AirBox</span>
        <span class="brand-subtitle">1024GB storage</span>
      </div>
    </div>
    <div class="nav-right">
      <button class="btn-nav-app" onclick="watchInApp()">Open App</button>
    </div>
  </nav>

  <div class="main-stage">
    <div class="uploader-row">
      <div>
        <div class="uploader-name">Sharing from ${creatorDisplay}</div>
        <div class="uploader-validity">${uploadDate} / Permanently Valid</div>
      </div>
      <div style="position: relative;">
        <button class="btn-more-circle" onclick="toggleDropdownMenu(event)" aria-label="More options">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/><circle cx="5" cy="12" r="2"/></svg>
        </button>
        <div class="dropdown-menu" id="dropdownMenu">
          <div class="dropdown-item" onclick="openReportModal()">Report / DMCA Takedown</div>
          <div class="dropdown-item" onclick="copyShareLink()">Copy Link</div>
          <div class="dropdown-item" onclick="openPolicyModal()">Copyright Policy</div>
        </div>
      </div>
    </div>

    <h1 class="file-headline-title" title="${rawName}">${rawName}</h1>

    ${isFolder ? `
      <div class="folder-card-container" onclick="watchInApp()">
        <div class="folder-header-row">
          <div class="file-hero-icon-box" style="width:52px; height:52px; background:#FFFBEB; border:1.5px solid #FDE68A; flex-shrink:0;">
            <svg viewBox="0 0 24 24" width="28" height="28" fill="#D97706"><path d="M20 6h-8l-2-2H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2zm0 12H4V8h16v10z"/></svg>
          </div>
          <div style="flex:1; text-align:left;">
            <div style="font-weight:800; font-size:15px; color:#0F172A;">Folder • ${childCount} Items</div>
            <div style="font-size:12px; color:#64748B; font-weight:600; margin-top:2px;">Total: ${displaySize}</div>
          </div>
          <span class="pill-free-tag">Cloud</span>
        </div>
        ${share.children && share.children.length > 0 ? `
          <div class="folder-children-list">
            ${share.children.slice(0, 15).map(c => `
              <div class="folder-child-item">
                <span class="folder-child-name">${c.name}</span>
                <span class="folder-child-size">${formatBytes(c.sizeBytes || 0)}</span>
              </div>
            `).join('')}
            ${share.children.length > 15 ? `<div style="text-align:center; font-size:11px; color:#64748B; padding-top:4px;">+ ${share.children.length - 15} more files</div>` : ''}
          </div>
        ` : ''}
      </div>
    ` : isVideo ? `
      <div class="media-player-container" onclick="watchInApp()">
        <div class="center-view-in-app-btn">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="#FFFFFF"><path d="M8 5v14l11-7z"/></svg>
          <span>Watch in App</span>
          <span class="pill-free-tag">Free</span>
        </div>
        <div class="player-bottom-duration">${displayDuration ? displayDuration + ' | ' : ''}${displaySize}</div>
      </div>
    ` : isImage ? `
      <div class="image-preview-container" onclick="watchInApp()">
        <img src="${directFileUrl}" alt="${rawName}" class="image-preview-tag" />
        <div class="center-view-in-app-btn" style="position:absolute; z-index:2;">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="#FFFFFF"><path d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zm0 12.5c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z"/></svg>
          <span>View in App</span>
          <span class="pill-free-tag">Free</span>
        </div>
        <div class="player-bottom-duration" style="z-index:2;">IMAGE | ${displaySize}</div>
      </div>
    ` : isJsonOrCode ? `
      <div class="file-hero-card" onclick="downloadFileDirectly()">
        <div class="file-hero-icon-container">
          <div class="file-hero-icon-box" style="background:#EFF6FF;">
            <svg viewBox="0 0 24 24" width="38" height="38" fill="none" stroke="#0066FF" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><line x1="10" y1="9" x2="8" y2="9"/></svg>
          </div>
        </div>
        <div class="file-hero-details">
          <div class="file-hero-type" style="color:#0066FF;">${ext ? ext.toUpperCase() : 'CODE'}</div>
          <div class="file-hero-size">${displaySize}</div>
        </div>
      </div>
    ` : isPdf ? `
      <div class="file-hero-card" onclick="downloadFileDirectly()">
        <div class="file-hero-icon-container">
          <div class="file-hero-icon-box" style="background:#FEF2F2;">
            <svg viewBox="0 0 24 24" width="38" height="38" fill="none" stroke="#DC2626" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>
          </div>
        </div>
        <div class="file-hero-details">
          <div class="file-hero-type" style="color:#DC2626;">PDF</div>
          <div class="file-hero-size">${displaySize}</div>
        </div>
      </div>
    ` : isAudio ? `
      <div class="file-hero-card" onclick="downloadFileDirectly()">
        <div class="file-hero-icon-container">
          <div class="file-hero-icon-box" style="background:#FDF2F8;">
            <svg viewBox="0 0 24 24" width="38" height="38" fill="none" stroke="#DB2777" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>
          </div>
        </div>
        <div class="file-hero-details">
          <div class="file-hero-type" style="color:#DB2777;">${ext ? ext.toUpperCase() : 'AUDIO'}</div>
          <div class="file-hero-size">${displaySize}</div>
        </div>
      </div>
    ` : isArchive ? `
      <div class="file-hero-card" onclick="downloadFileDirectly()">
        <div class="file-hero-icon-container">
          <div class="file-hero-icon-box" style="background:#FAF5FF;">
            <svg viewBox="0 0 24 24" width="38" height="38" fill="none" stroke="#9333EA" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M21 8v13H3V8"/><path d="M1 3h22v5H1z"/><path d="M10 12h4"/></svg>
          </div>
        </div>
        <div class="file-hero-details">
          <div class="file-hero-type" style="color:#9333EA;">${ext ? ext.toUpperCase() : 'ZIP'}</div>
          <div class="file-hero-size">${displaySize}</div>
        </div>
      </div>
    ` : isApk ? `
      <div class="file-hero-card" onclick="downloadFileDirectly()">
        <div class="file-hero-icon-container">
          <div class="file-hero-icon-box" style="background:#ECFDF5;">
            <svg viewBox="0 0 24 24" width="40" height="40" fill="none" stroke="#059669" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
              <line x1="7.5" y1="5.5" x2="5.5" y2="3" />
              <line x1="16.5" y1="5.5" x2="18.5" y2="3" />
              <path d="M5 12.5C5 8.91 7.91 6 11.5 6H12.5C16.09 6 19 8.91 19 12.5H5Z" />
              <circle cx="9" cy="9.5" r="0.75" fill="#059669" stroke="none" />
              <circle cx="15" cy="9.5" r="0.75" fill="#059669" stroke="none" />
              <path d="M5 14.5V17.5C5 19.43 6.57 21 8.5 21H15.5C17.43 21 19 19.43 19 17.5V14.5" />
              <path d="M2.5 12.5V16C2.5 16.83 3.17 17.5 4 17.5" />
              <path d="M21.5 12.5V16C21.5 16.83 20.83 17.5 20 17.5" />
            </svg>
          </div>
        </div>
        <div class="file-hero-details">
          <div class="file-hero-type" style="color:#059669;">APK</div>
          <div class="file-hero-size">${displaySize}</div>
        </div>
      </div>
    ` : `
      <div class="file-hero-card" onclick="downloadFileDirectly()">
        <div class="file-hero-icon-container">
          <div class="file-hero-icon-box" style="background:#F0F9FF;">
            <svg viewBox="0 0 24 24" width="38" height="38" fill="none" stroke="#0284C7" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><polyline points="13 2 13 9 20 9"/></svg>
          </div>
        </div>
        <div class="file-hero-details">
          <div class="file-hero-type" style="color:#0284C7;">${ext ? ext.toUpperCase() : 'FILE'}</div>
          <div class="file-hero-size">${displaySize}</div>
        </div>
      </div>
    `}
  </div>

  <div class="bottom-bar-container">
    <div class="promo-notice-row">
      <div class="promo-notice-left">
        <span>${isFolder ? 'Shared folders are accessible exclusively in AirBox App' : (isVideo || isImage) ? 'Media streams & downloads exclusively in AirBox App' : 'Download AirBox for permanent free 1024GB cloud storage'}</span>
      </div>
      <span style="color:#94A3B8; cursor:pointer;" onclick="this.parentElement.style.display='none'">✕</span>
    </div>
    <div class="bottom-buttons-row">
      ${isFolder ? `
        <button class="btn-bottom-dl" onclick="watchInApp()">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10"/></svg>
          <span>Save to My Cloud</span>
        </button>
        <button class="btn-bottom-watch" onclick="watchInApp()">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
          <span>Download Folder in App</span>
        </button>
      ` : (isVideo || isImage) ? `
        <button class="btn-bottom-dl" onclick="watchInApp()">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
          <span>Download in App</span>
        </button>
        <button class="btn-bottom-watch" onclick="watchInApp()">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
          <span>${isVideo ? 'Watch in App' : 'View in App'}</span>
        </button>
      ` : `
        <button class="btn-bottom-dl" onclick="downloadFileDirectly()">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
          <span>Download</span>
        </button>
        <button class="btn-bottom-watch" onclick="watchInApp()">
          <span>Open in App</span>
        </button>
      `}
    </div>
  </div>

  <!-- Statutory DMCA & Grievance Notice Modal -->
  <div class="report-modal-overlay" id="reportModalOverlay" onclick="closeReportModalOnOutside(event)">
    <div class="report-modal-card">
      <div class="modal-top-header">
        <div class="modal-drag-handle"></div>
        <div class="modal-title-row">
          <div class="modal-main-title">Notice of Copyright Infringement</div>
          <button class="btn-modal-close" onclick="closeReportModal()" aria-label="Close">
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
      </div>
      
      <div class="modal-scrollable-body" id="mainReportView">
        <div class="statutory-banner">
          <strong>Statutory Notice Requirement:</strong> Under Rule 75 of the Indian Copyright Rules, 2013 and Section 512(c) of the Digital Millennium Copyright Act (17 U.S.C. § 512), all submitted notices must provide verified claimant identity, legal authorization, and documentary proof of ownership. Submitting false or misleading claims creates direct civil and criminal liability.
        </div>

        <form id="dmcaNoticeForm" onsubmit="submitStatutoryWebNotice(event)" novalidate>
          <div class="form-section-header">
            <span class="section-badge">1</span>
            <span class="section-title-text">Claimant &amp; Rights Holder Identity</span>
          </div>
          
          <div class="form-group">
            <label class="form-label" for="web_legalName">Full Legal Name *</label>
            <input type="text" id="web_legalName" class="form-input" placeholder="Legal full name of copyright owner / claimant" oninput="clearFieldError('web_legalName')" />
            <div class="field-error-msg" id="err_web_legalName"></div>
          </div>

          <div class="form-row-2">
            <div class="form-group">
              <label class="form-label" for="web_org">Organization / Label (Optional)</label>
              <input type="text" id="web_org" class="form-input" placeholder="Studio, company or label name" oninput="clearFieldError('web_org')" />
              <div class="field-error-msg" id="err_web_org"></div>
            </div>
            <div class="form-group">
              <label class="form-label" for="web_relationship">Legal Capacity / Role *</label>
              <select id="web_relationship" class="form-select" onchange="clearFieldError('web_relationship')">
                <option value="Copyright Owner">Copyright Owner</option>
                <option value="Authorized Legal Counsel">Authorized Legal Counsel</option>
                <option value="Exclusive Licensee">Exclusive Licensee</option>
                <option value="Producer / Studio Representative">Producer / Studio Representative</option>
              </select>
              <div class="field-error-msg" id="err_web_relationship"></div>
            </div>
          </div>

          <div class="form-row-2">
            <div class="form-group">
              <label class="form-label" for="web_email">Official Email Address *</label>
              <input type="email" id="web_email" class="form-input" placeholder="claimant@officialdomain.com" oninput="clearFieldError('web_email')" />
              <div class="field-error-msg" id="err_web_email"></div>
            </div>
            <div class="form-group">
              <label class="form-label" for="web_phone">Contact Mobile (10 Digits) *</label>
              <input type="tel" id="web_phone" class="form-input" placeholder="10-digit mobile number" maxlength="10" inputmode="numeric" oninput="this.value=this.value.replace(/[^0-9]/g,'').slice(0,10); clearFieldError('web_phone');" />
              <div class="field-error-msg" id="err_web_phone"></div>
            </div>
          </div>

          <div class="form-group">
            <label class="form-label" for="web_address">Physical Postal Mailing Address *</label>
            <textarea id="web_address" class="form-textarea" placeholder="Complete physical postal mailing address" oninput="clearFieldError('web_address')"></textarea>
            <div class="field-error-msg" id="err_web_address"></div>
          </div>

          <div class="form-section-header">
            <span class="section-badge">2</span>
            <span class="section-title-text">Copyrighted Work &amp; Ownership Evidence</span>
          </div>
          
          <div class="form-group">
            <label class="form-label" for="web_workTitle">Title of Original Copyrighted Work *</label>
            <input type="text" id="web_workTitle" class="form-input" placeholder="Title of movie, video, music or artwork" oninput="clearFieldError('web_workTitle')" />
            <div class="field-error-msg" id="err_web_workTitle"></div>
          </div>

          <div class="form-group">
            <label class="form-label" for="web_proofUrl">Proof of Ownership URL or Reg Certificate Number *</label>
            <input type="text" id="web_proofUrl" class="form-input" placeholder="https://official-link.com or Copyright Reg No." oninput="clearFieldError('web_proofUrl')" />
            <div class="field-error-msg" id="err_web_proofUrl"></div>
          </div>

          <div class="form-section-header">
            <span class="section-badge">3</span>
            <span class="section-title-text">Statutory Sworn Declarations &amp; Signature</span>
          </div>

          <div class="legal-checkbox-container">
            <label class="legal-check-card" id="card_declGoodFaith">
              <input type="checkbox" id="web_declGoodFaith" onchange="clearCheckboxError('card_declGoodFaith')" />
              <div class="legal-check-card-content">
                <span class="legal-check-title">Good Faith Affirmation</span>
                <span class="legal-check-desc">I have a good faith belief that use of the material is not authorized by the copyright owner, its agent, or the law (Section 52 Indian Copyright Act &amp; 17 U.S.C. § 512).</span>
              </div>
            </label>

            <label class="legal-check-card" id="card_declPerjury">
              <input type="checkbox" id="web_declPerjury" onchange="clearCheckboxError('card_declPerjury')" />
              <div class="legal-check-card-content">
                <span class="legal-check-title">Statement Under Penalty of Perjury</span>
                <span class="legal-check-desc">I swear, under penalty of perjury and applicable laws of India (including Bharatiya Nyaya Sanhita / IPC), that the information is accurate and I am the owner or authorized agent.</span>
              </div>
            </label>

            <label class="legal-check-card" id="card_declLiability">
              <input type="checkbox" id="web_declLiability" onchange="clearCheckboxError('card_declLiability')" />
              <div class="legal-check-card-content">
                <span class="legal-check-title">Acknowledgement of Legal Liability</span>
                <span class="legal-check-desc">I acknowledge that submitting false, fraudulent, or bad-faith takedown notices creates civil liability for damages and criminal prosecution.</span>
              </div>
            </label>
            <div class="field-error-msg" id="err_web_declarations"></div>
          </div>

          <div class="form-group">
            <label class="form-label" for="web_signature">Electronic Signature (Type Full Legal Name) *</label>
            <input type="text" id="web_signature" class="form-input" style="font-weight:700;" placeholder="Type your full legal name as digital signature" oninput="clearFieldError('web_signature')" />
            <div class="field-error-msg" id="err_web_signature"></div>
          </div>

          <div id="web_reportError" style="display:none; color:#DC2626; font-size:12px; font-weight:700; margin-bottom:12px; background:#FEF2F2; border:1px solid #FECACA; padding:10px 14px; border-radius:10px; line-height:1.4;"></div>

          <button type="submit" class="btn-submit-report" id="btnSubmitWebDmca">Submit Legal Takedown Notice</button>
        </form>
      </div>

      <div class="modal-scrollable-body" id="reportSuccessBox" style="display:none; text-align:center; padding: 28px 20px;">
        <svg viewBox="0 0 24 24" width="52" height="52" fill="none" stroke="#16A34A" stroke-width="2" style="margin: 0 auto 14px auto;"><circle cx="12" cy="12" r="10"/><polyline points="8 12 11 15 16 9"/></svg>
        <h3 style="font-size:18px; font-weight:800; color:#0F172A; margin-bottom:8px;">Statutory Notice Registered</h3>
        <p style="font-size:13px; color:#475569; margin-bottom:16px; line-height:1.45;">Your complaint has been formally lodged under Rule 75 of Indian Copyright Rules 2013 and DMCA. The Grievance Redressal Desk has been notified.</p>
        <div style="background:#F8FAFC; border:1.5px solid #E2E8F0; border-radius:12px; padding:12px; margin-bottom:20px;">
          <div style="font-size:11px; color:#64748B; font-weight:800; letter-spacing:0.5px;">COMPLIANCE TRACKING TICKET ID</div>
          <div id="successTicketId" style="font-size:15px; font-weight:800; color:#0066FF; font-family:monospace; margin-top:4px;">DMCA-IN-2026-XXXX</div>
        </div>
        <button class="btn-submit-report" onclick="closeReportModal()">Done</button>
      </div>
    </div>
  </div>

  <!-- Statutory Copyright & Grievance Policy Modal -->
  <div class="policy-modal-overlay" id="policyModalOverlay" onclick="closePolicyModalOnOutside(event)">
    <div class="policy-modal-card">
      <div class="modal-top-header">
        <div class="modal-drag-handle"></div>
        <div class="modal-title-row">
          <div class="modal-main-title">Copyright &amp; Grievance Policy</div>
          <button class="btn-modal-close" onclick="closePolicyModal()" aria-label="Close">
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
      </div>

      <div class="modal-scrollable-body">
        <div class="statutory-banner">
          <strong>Statutory Policy:</strong> AirBox operates in full compliance with the Indian Copyright Act, 1957, Rule 3 of the Information Technology (Intermediary Guidelines) Rules, 2021, the Digital Millennium Copyright Act (17 U.S.C. § 512), and Google Play Developer Policies. AirBox functions strictly as a neutral cloud storage service and intermediary.
        </div>

        <div class="statutory-card">
          <div class="statutory-card-header">1. Neutral Intermediary &amp; Safe Harbor</div>
          <div class="policy-para" style="margin-bottom:0; text-align:justify;">
            AirBox is a cloud storage platform operating as a neutral intermediary under Section 79 of the Information Technology Act 2000. Users maintain complete ownership and responsibility for files stored within their personal cloud storage. AirBox strictly prohibits unauthorized sharing of protected copyrighted materials, movies, music, literature, and software.
          </div>
        </div>

        <div class="statutory-card">
          <div class="statutory-card-header">2. Notice &amp; Takedown Procedure</div>
          <div class="policy-para" style="margin-bottom:8px; text-align:justify;">
            Under Rule 75 of Indian Copyright Rules 2013 and DMCA guidelines, copyright holders or authorized legal representatives may submit takedown notices. To be processed, complaints must include:
          </div>
          <ul style="padding-left:18px; font-size:11.5px; color:#334155; line-height:1.6; text-align:justify;">
            <li>Full verified legal identity and official contact information of the copyright claimant.</li>
            <li>Clear identification and description of the original copyrighted work.</li>
            <li>Documentary evidence of ownership (Registration certificate, official publication URL, or registry record).</li>
            <li>Specific file link or share code of the allegedly infringing material on AirBox.</li>
            <li>A good faith sworn declaration and digital electronic signature.</li>
          </ul>
        </div>

        <div class="statutory-card">
          <div class="statutory-card-header">3. Content Moderation &amp; Enforcement</div>
          <div class="policy-para" style="margin-bottom:0; text-align:justify;">
            Upon receipt of a verified statutory complaint, AirBox acts expeditiously to disable access to or remove the identified infringing content. We maintain automated content fingerprinting and proactive review mechanisms to protect intellectual property rights across our services.
          </div>
        </div>

        <div class="grievance-contact-card">
          <div class="grievance-contact-card-title">Grievance &amp; Compliance Redressal</div>
          <div>Designated Grievance Officer under Rule 3(2) of Information Technology Rules 2021.</div>
          <div style="margin-top:6px;">
            <strong>Email:</strong> <a href="mailto:info.airboxcloud@gmail.com" class="grievance-email-link">info.airboxcloud@gmail.com</a><br/>
            <strong>Response SLA:</strong> 24 to 36 Hours for Takedown &amp; Grievance Redressal.
          </div>
        </div>
      </div>

      <div class="modal-bottom-actions">
        <button class="btn-understood" onclick="closePolicyModal()">I Understand</button>
      </div>
    </div>
  </div>

  <script>
    var shareCode = "${share.code}";
    var isMediaFile = ${Boolean(isVideo || isImage || isFolder)};
    var directDownloadUrl = "${directFileUrl}";
    var activeSessionNonce = null;
    var activeClientToken = null;
    var requiredWatchSecs = 30;
    var hasVerifiedView = false;
    var activePlayedSeconds = 0;
    var playInterval = null;

    // 1. Auto-record unique link click & initiate Proof-of-Watch session immediately on page load
    (function initSessionTracking() {
      try {
        var fp = 'web_' + (navigator.userAgent || '').replace(/[^a-zA-Z0-9]/g, '').substring(0, 30) + '_' + (window.screen ? window.screen.width + 'x' + window.screen.height : '800x600');
        fetch('/api/webmaster/session-nonce/' + encodeURIComponent(shareCode), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ fingerprint: fp })
        })
        .then(function(res) { return res.json(); })
        .then(function(data) {
          if (data && data.success) {
            activeSessionNonce = data.nonce;
            activeClientToken = data.clientToken;
            requiredWatchSecs = data.requiredWatchSeconds || 30;
          }
        })
        .catch(function(err) {
          console.warn('[Webmaster Tracking] Session init note:', err);
        });
      } catch (_) {}

      // Attach second-wise playback tracker to HTML5 video element on web preview
      var videoEl = document.querySelector('video');
      if (videoEl) {
        videoEl.addEventListener('play', function() {
          if (!playInterval) {
            playInterval = setInterval(function() {
              if (!videoEl.paused && !videoEl.ended) {
                activePlayedSeconds++;
                if (!hasVerifiedView && activePlayedSeconds >= (requiredWatchSecs || 30)) {
                  verifyAndRecordView(activePlayedSeconds);
                }
              }
            }, 1000);
          }
        });
        videoEl.addEventListener('pause', function() {
          if (playInterval) { clearInterval(playInterval); playInterval = null; }
        });
        videoEl.addEventListener('ended', function() {
          if (playInterval) { clearInterval(playInterval); playInterval = null; }
        });
      }
    })();

    // 2. Verified View Tracking (Credits videoPlays only when required watch-time is fully achieved)
    function verifyAndRecordView(playedSecs) {
      if (hasVerifiedView || !activeSessionNonce) return;
      var actualSecs = playedSecs || activePlayedSeconds;
      if (actualSecs < (requiredWatchSecs || 30)) return;
      hasVerifiedView = true;
      try {
        var fp = 'web_' + (navigator.userAgent || '').replace(/[^a-zA-Z0-9]/g, '').substring(0, 30) + '_' + (window.screen ? window.screen.width + 'x' + window.screen.height : '800x600');
        fetch('/api/webmaster/verify-watch', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            code: shareCode,
            nonce: activeSessionNonce,
            watchSeconds: actualSecs,
            videoDuration: ${share.durationSeconds || 120},
            clientToken: activeClientToken,
            fingerprint: fp
          })
        }).catch(function() {});
      } catch (_) {}
    }

    function watchInApp() {
      var isAndroid = /Android/i.test(navigator.userAgent);
      var isIOS = /iPhone|iPad|iPod/i.test(navigator.userAgent);
      var refParam = "${activeRefCode}";
      var playStoreUrl = refParam
        ? "https://play.google.com/store/apps/details?id=com.airbox.cloud.storage&referrer=" + encodeURIComponent("utm_source=airbox_referral&utm_content=" + refParam)
        : "https://play.google.com/store/apps/details?id=com.airbox.cloud.storage";
      var deepLinkPath = "share/" + shareCode + (refParam ? "?ref=" + encodeURIComponent(refParam) : "");
      var appIntentUrl = "intent://" + deepLinkPath + "#Intent;scheme=terabox;package=com.airbox.cloud.storage;S.browser_fallback_url=" + encodeURIComponent(playStoreUrl) + ";end;";
      var iosDeepLink = "terabox://" + deepLinkPath;

      if (isAndroid) {
        var start = Date.now();
        window.location.href = appIntentUrl;
        setTimeout(function() {
          if (Date.now() - start < 2000) {
            window.location.href = playStoreUrl;
          }
        }, 1500);
      } else if (isIOS) {
        window.location.href = iosDeepLink;
      } else {
        window.location.href = iosDeepLink;
      }
    }

    function downloadFileDirectly() {
      if (isMediaFile) {
        watchInApp();
        return;
      }
      if (directDownloadUrl && directDownloadUrl.length > 5) {
        window.location.href = directDownloadUrl;
      } else {
        watchInApp();
      }
    }

    function toggleDropdownMenu(event) {
      if (event) event.stopPropagation();
      var menu = document.getElementById('dropdownMenu');
      if (menu) menu.style.display = menu.style.display === 'block' ? 'none' : 'block';
    }

    document.addEventListener('click', function(e) {
      var menu = document.getElementById('dropdownMenu');
      if (menu && !menu.contains(e.target)) menu.style.display = 'none';
    });

    function copyShareLink() {
      var url = window.location.href;
      if (navigator.clipboard) {
        navigator.clipboard.writeText(url).then(function() {
          alert('Share link copied to clipboard!');
        });
      } else {
        alert('Share URL: ' + url);
      }
      var menu = document.getElementById('dropdownMenu');
      if (menu) menu.style.display = 'none';
    }

    function openReportModal() {
      var menu = document.getElementById('dropdownMenu');
      if (menu) menu.style.display = 'none';
      var modal = document.getElementById('reportModalOverlay');
      if (modal) {
        modal.style.display = 'flex';
        document.getElementById('mainReportView').style.display = 'block';
        document.getElementById('reportSuccessBox').style.display = 'none';
      }
    }

    function closeReportModal() {
      var modal = document.getElementById('reportModalOverlay');
      if (modal) modal.style.display = 'none';
    }

    function closeReportModalOnOutside(event) {
      if (event.target.id === 'reportModalOverlay') closeReportModal();
    }

    function openPolicyModal() {
      var menu = document.getElementById('dropdownMenu');
      if (menu) menu.style.display = 'none';
      closeReportModal();
      var modal = document.getElementById('policyModalOverlay');
      if (modal) modal.style.display = 'flex';
    }

    function closePolicyModal() {
      var modal = document.getElementById('policyModalOverlay');
      if (modal) modal.style.display = 'none';
    }

    function closePolicyModalOnOutside(event) {
      if (event.target.id === 'policyModalOverlay') closePolicyModal();
    }

    function clearFieldError(fieldId) {
      var el = document.getElementById(fieldId);
      if (el) el.classList.remove('is-invalid');
      var errEl = document.getElementById('err_' + fieldId);
      if (errEl) {
        errEl.innerText = '';
        errEl.style.display = 'none';
      }
      var topErr = document.getElementById('web_reportError');
      if (topErr) topErr.style.display = 'none';
    }

    function clearCheckboxError(cardId) {
      var card = document.getElementById(cardId);
      if (card) card.classList.remove('is-invalid');
      var errEl = document.getElementById('err_web_declarations');
      if (errEl) {
        errEl.innerText = '';
        errEl.style.display = 'none';
      }
      var topErr = document.getElementById('web_reportError');
      if (topErr) topErr.style.display = 'none';
    }

    function showFieldError(fieldId, message) {
      var el = document.getElementById(fieldId);
      if (el) el.classList.add('is-invalid');
      var errEl = document.getElementById('err_' + fieldId);
      if (errEl) {
        errEl.innerText = message;
        errEl.style.display = 'block';
      }
    }

    function submitStatutoryWebNotice(event) {
      if (event && event.preventDefault) event.preventDefault();
      var topErr = document.getElementById('web_reportError');
      topErr.style.display = 'none';
      topErr.innerText = '';

      // Reset all field error states
      var inputs = document.querySelectorAll('.form-input, .form-select, .form-textarea, .legal-check-card');
      for (var i = 0; i < inputs.length; i++) {
        inputs[i].classList.remove('is-invalid');
      }
      var errorMsgs = document.querySelectorAll('.field-error-msg');
      for (var j = 0; j < errorMsgs.length; j++) {
        errorMsgs[j].style.display = 'none';
        errorMsgs[j].innerText = '';
      }

      var legalNameEl = document.getElementById('web_legalName');
      var legalName = legalNameEl.value.trim();
      var org = document.getElementById('web_org').value.trim();
      var relationship = document.getElementById('web_relationship').value;
      var emailEl = document.getElementById('web_email');
      var email = emailEl.value.trim();
      var phoneEl = document.getElementById('web_phone');
      var phone = phoneEl.value.trim();
      var addressEl = document.getElementById('web_address');
      var address = addressEl.value.trim();
      var workTitleEl = document.getElementById('web_workTitle');
      var workTitle = workTitleEl.value.trim();
      var proofUrlEl = document.getElementById('web_proofUrl');
      var proofUrl = proofUrlEl.value.trim();
      var declGoodFaith = document.getElementById('web_declGoodFaith').checked;
      var declPerjury = document.getElementById('web_declPerjury').checked;
      var declLiability = document.getElementById('web_declLiability').checked;
      var signatureEl = document.getElementById('web_signature');
      var signature = signatureEl.value.trim();

      var firstInvalidEl = null;

      if (!legalName || legalName.length < 3) {
        showFieldError('web_legalName', 'Please enter full legal name of claimant (at least 3 characters).');
        if (!firstInvalidEl) firstInvalidEl = legalNameEl;
      }

      var emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!email || !emailPattern.test(email)) {
        showFieldError('web_email', 'Please enter a valid official email address (e.g. name@domain.com).');
        if (!firstInvalidEl) firstInvalidEl = emailEl;
      }

      var cleanPhone = phone.replace(/[^0-9]/g, '');
      if (cleanPhone.length !== 10) {
        showFieldError('web_phone', 'Please enter a valid 10-digit mobile number.');
        if (!firstInvalidEl) firstInvalidEl = phoneEl;
      }

      if (!address || address.length < 8) {
        showFieldError('web_address', 'Please enter complete physical postal mailing address (min 8 characters).');
        if (!firstInvalidEl) firstInvalidEl = addressEl;
      }

      if (!workTitle || workTitle.length < 2) {
        showFieldError('web_workTitle', 'Please enter the title of the original copyrighted work.');
        if (!firstInvalidEl) firstInvalidEl = workTitleEl;
      }

      if (!proofUrl || proofUrl.length < 4) {
        showFieldError('web_proofUrl', 'Proof of ownership (official URL or Copyright Reg No.) is required.');
        if (!firstInvalidEl) firstInvalidEl = proofUrlEl;
      }

      var declError = false;
      if (!declGoodFaith) {
        document.getElementById('card_declGoodFaith').classList.add('is-invalid');
        declError = true;
      }
      if (!declPerjury) {
        document.getElementById('card_declPerjury').classList.add('is-invalid');
        declError = true;
      }
      if (!declLiability) {
        document.getElementById('card_declLiability').classList.add('is-invalid');
        declError = true;
      }
      if (declError) {
        var declErrEl = document.getElementById('err_web_declarations');
        if (declErrEl) {
          declErrEl.innerText = 'You must affirm all 3 statutory declarations above.';
          declErrEl.style.display = 'block';
        }
        if (!firstInvalidEl) firstInvalidEl = document.getElementById('card_declGoodFaith');
      }

      if (!signature || signature.length < 3) {
        showFieldError('web_signature', 'Please type your full legal name as digital electronic signature.');
        if (!firstInvalidEl) firstInvalidEl = signatureEl;
      }

      if (firstInvalidEl) {
        topErr.innerText = 'Please correct the highlighted fields with required information.';
        topErr.style.display = 'block';
        firstInvalidEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
        if (firstInvalidEl.focus && typeof firstInvalidEl.focus === 'function') {
          firstInvalidEl.focus();
        }
        return false;
      }

      var btn = document.getElementById('btnSubmitWebDmca');
      btn.disabled = true;
      btn.innerText = 'Submitting Statutory Notice...';

      fetch('/api/report/takedown', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          shareCode: shareCode,
          reason: 'Copyright Infringement / DMCA',
          legalName: legalName,
          organization: org || 'Individual / Rights Holder',
          relationship: relationship,
          email: email,
          phone: cleanPhone,
          address: address,
          country: 'India',
          workTitle: workTitle,
          workCategory: 'Video / Media Content',
          ownershipProofUrl: proofUrl,
          declarationGoodFaith: declGoodFaith,
          declarationPerjury: declPerjury,
          declarationLegalLiability: declLiability,
          electronicSignature: signature
        })
      })
      .then(function(res) { return res.json(); })
      .then(function(data) {
        btn.disabled = false;
        btn.innerText = 'Submit Legal Takedown Notice';
        if (data && data.success) {
          document.getElementById('mainReportView').style.display = 'none';
          document.getElementById('successTicketId').innerText = data.reportId || data.ticketNumber || 'DMCA-IN-2026-SUBMITTED';
          document.getElementById('reportSuccessBox').style.display = 'block';
        } else {
          topErr.innerText = (data && data.error) ? data.error : 'Submission failed. Please check details.';
          topErr.style.display = 'block';
          topErr.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      })
      .catch(function(err) {
        btn.disabled = false;
        btn.innerText = 'Submit Legal Takedown Notice';
        topErr.innerText = 'Network error submitting legal notice. Please try again.';
        topErr.style.display = 'block';
        topErr.scrollIntoView({ behavior: 'smooth', block: 'center' });
      });
      return false;
    }
  </script>
</body>
</html>
    `;
  }

  // Purge user shares and storage objects permanently upon account deletion
  async deleteUserSharesAndFiles(userId, email) {
    try {
      const cleanEmail = (email || '').trim().toLowerCase();
      const codesToDelete = [];
      const r2KeysToDelete = [];

      for (const [code, share] of this.shares.entries()) {
        const shareUserId = share.userId || (share.fileData && share.fileData.userId);
        const shareEmail = (share.email || (share.fileData && share.fileData.email) || '').toLowerCase();

        if ((userId && shareUserId === userId) || (cleanEmail && shareEmail === cleanEmail)) {
          codesToDelete.push(code);
          if (share.r2Key) r2KeysToDelete.push(share.r2Key);
          if (share.fileData && share.fileData.r2Key) r2KeysToDelete.push(share.fileData.r2Key);
        }
      }

      for (const code of codesToDelete) {
        this.shares.delete(code);
      }
      this._saveSharesToDisk();

      for (const key of r2KeysToDelete) {
        try {
          await r2StorageService.deleteObject(key);
        } catch (_) {}
      }

      console.log(`[ShareService] Deleted ${codesToDelete.length} shares and ${r2KeysToDelete.length} objects for user ${userId || email}.`);
      return { success: true, deletedShares: codesToDelete.length, deletedObjects: r2KeysToDelete.length };
    } catch (err) {
      console.warn('[ShareService] Error deleting user shares:', err.message);
      return { success: false, error: err.message };
    }
  }
}

module.exports = new ShareService();
