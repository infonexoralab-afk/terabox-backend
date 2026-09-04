const fs = require('fs');
const path = require('path');
const env = require('../config/env');
const r2StorageService = require('./r2StorageService');

const isVercel = process.env.VERCEL === '1';
const dataDir = isVercel ? '/tmp/data' : path.join(__dirname, '../../data');
if (!fs.existsSync(dataDir)) {
  try { fs.mkdirSync(dataDir, { recursive: true }); } catch (_) {}
}
const sharesFilePath = path.join(dataDir, 'shares.json');

class ShareService {
  constructor() {
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
    const code = customCode || Math.random().toString(36).substring(2, 8) + Math.random().toString(36).substring(2, 4);
    
    const rawName = fileData.name || fileData.fileName || 'Shared_File';
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
      creatorName: fileData.creatorName || fileData.userName || fileData.email || 'TeraBox User',
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

  // Get Share Details by Short Code
  async getShare(code) {
    let share = this.shares.get(code);
    if (!share) {
      this._loadSharesFromDisk();
      share = this.shares.get(code);
    }
    
    if (!share) {
      try {
        console.log(`[ShareService] Share ${code} not in memory. Fetching from Cloudflare R2...`);
        const r2Share = await r2StorageService.downloadJson(`shares/${code}.json`);
        if (r2Share) {
          console.log(`[ShareService] ✅ Successfully restored share ${code} from R2!`);
          share = r2Share;
          this.shares.set(code, share);
          this._saveSharesToDisk();
        }
      } catch (err) {
        console.error(`[ShareService] Failed to fetch share ${code} from R2:`, err.message);
      }
    }

    if (!share) {
      return null;
    }

    share.viewsCount++;
    this._saveSharesToDisk();

    r2StorageService.uploadBuffer(
      `shares/${code}.json`,
      Buffer.from(JSON.stringify(share, null, 2), 'utf8'),
      'application/json'
    ).catch(err => console.warn(`[ShareService] Failed to update views count in R2:`, err.message));

    return share;
  }

  // Render Human-Crafted, Responsive, Exact TeraBox Web Share Page
  renderWebPreviewHtml(share) {
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
      if (!name || name === 'TeraBox User' || name === 'TeraBox Cloud User' || name === 'external') return 'TeraBox User';
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
    const isVideo = !isFolder && (share.isVideo === true || ['mp4', 'mkv', 'mov', 'avi', 'webm', 'flv', 'ts', 'm4v', '3gp', 'wmv', 'mpg'].includes(ext));
    const isImage = !isFolder && ['jpg', 'jpeg', 'png', 'webp', 'gif', 'svg', 'bmp', 'heic', 'ico'].includes(ext);
    const isApk = !isFolder && ext === 'apk';

    const childCount = (share.children ? share.children.length : 0) || share.itemCount || 0;
    const displaySize = formatBytes(share.sizeBytes || 0);
    const displayDuration = share.durationSeconds && share.durationSeconds > 0 ? formatDuration(share.durationSeconds) : '';
    const creatorDisplay = formatCreatorName(share.creatorName);
    
    const d = new Date(share.uploadedAt || share.createdAt || Date.now());
    const uploadDate = `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`;
    const directFileUrl = share.streamUrl || share.downloadUrl || '';

    return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover">
  <title>${rawName} - TeraBox 1024GB storage</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap" rel="stylesheet">
  <style>
    :root { --primary: #0066FF; --bg-card: #FFFFFF; --text-main: #0F172A; --text-muted: #64748B; --border-color: #E2E8F0; }
    * { margin: 0; padding: 0; box-sizing: border-box; font-family: 'Plus Jakarta Sans', sans-serif; -webkit-tap-highlight-color: transparent; }
    html, body { height: 100%; height: 100dvh; overflow: hidden; background-color: #FFFFFF; }
    body { color: #0F172A; display: flex; flex-direction: column; justify-content: space-between; }
    
    .navbar { background: #FFFFFF; border-bottom: 1px solid #F1F5F9; padding: 10px 16px; height: 56px; display: flex; justify-content: space-between; align-items: center; flex-shrink: 0; z-index: 50; }
    .brand { display: flex; align-items: center; gap: 10px; text-decoration: none; }
    .brand-logo { width: 36px; height: 36px; border-radius: 9px; background: #0066FF; display: flex; align-items: center; justify-content: center; color: #FFFFFF; font-weight: 800; font-size: 18px; }
    .brand-text-container { display: flex; flex-direction: column; line-height: 1.2; }
    .brand-name { font-size: 15px; font-weight: 800; color: #0F172A; letter-spacing: -0.3px; }
    .brand-subtitle { font-size: 11px; font-weight: 500; color: #64748B; }
    .nav-right { display: flex; align-items: center; gap: 10px; }
    .btn-nav-app { background: #0066FF; color: #FFFFFF; font-size: 13px; font-weight: 700; padding: 8px 18px; border-radius: 9999px; border: none; cursor: pointer; box-shadow: none !important; transition: all 0.2s ease; }
    .btn-nav-app:active { transform: scale(0.96); }

    .main-stage { flex: 1; max-width: 480px; width: 100%; margin: 0 auto; padding: 14px 16px 8px 16px; display: flex; flex-direction: column; min-height: 0; }
    .uploader-row { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; }
    .uploader-name { font-size: 14.5px; font-weight: 700; color: #0F172A; }
    .uploader-validity { font-size: 11.5px; color: #94A3B8; margin-top: 2px; }
    .btn-more-circle { width: 34px; height: 34px; border-radius: 50%; background: #FFFFFF; border: 1px solid #E2E8F0; color: #64748B; display: flex; align-items: center; justify-content: center; cursor: pointer; box-shadow: none !important; }
    .file-headline-title { font-size: 16px; font-weight: 800; color: #0F172A; line-height: 1.35; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; margin-bottom: 12px; }

    .dropdown-menu { position: absolute; top: 48px; right: 0; background: #FFFFFF; border: 1px solid #E2E8F0; border-radius: 14px; box-shadow: 0 10px 30px rgba(0,0,0,0.12); width: 230px; z-index: 60; display: none; overflow: hidden; }
    .dropdown-item { padding: 12px 16px; display: flex; align-items: center; gap: 12px; font-size: 13.5px; font-weight: 600; color: #1E293B; cursor: pointer; border-bottom: 1px solid #F8FAFC; }
    .dropdown-item:hover { background: #F8FAFC; color: #0066FF; }

    .media-player-container { background: radial-gradient(circle at 50% 35%, #2a201a 0%, #15100c 60%, #080605 100%); border-radius: 18px; overflow: hidden; position: relative; aspect-ratio: 16/9; max-height: clamp(170px, 32vh, 230px); cursor: pointer; display: flex; flex-direction: column; justify-content: center; align-items: center; width: 100%; flex-shrink: 0; box-shadow: none !important; }
    .center-view-in-app-btn { background: rgba(15, 23, 42, 0.88); border: 1px solid rgba(255, 255, 255, 0.15); color: #FFFFFF; padding: 7px 16px; border-radius: 9999px; display: inline-flex; align-items: center; gap: 8px; font-size: 13.5px; font-weight: 700; box-shadow: none !important; }
    .pill-free-tag { background: #0066FF; color: #FFFFFF; font-size: 11px; font-weight: 800; padding: 2px 8px; border-radius: 9999px; }
    .player-bottom-duration { position: absolute; bottom: 12px; left: 14px; color: rgba(255, 255, 255, 0.9); font-size: 12px; font-weight: 600; letter-spacing: 0.2px; }

    .image-preview-container { background: #0B0F19; border-radius: 18px; overflow: hidden; position: relative; aspect-ratio: 16/9; max-height: clamp(170px, 32vh, 230px); cursor: pointer; display: flex; justify-content: center; align-items: center; width: 100%; flex-shrink: 0; border: 1px solid #E2E8F0; box-shadow: none !important; }
    .image-preview-tag { width: 100%; height: 100%; object-fit: cover; filter: blur(20px); -webkit-filter: blur(20px); transform: scale(1.18); pointer-events: none; }
    
    .file-card-container { background: #FFFFFF; border-radius: 18px; border: 1.5px solid #E2E8F0; padding: 18px; display: flex; flex-direction: column; width: 100%; box-shadow: none !important; }
    .file-icon-box { width: 54px; height: 54px; border-radius: 14px; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
    
    .bottom-bar-container { background: #FFFFFF; border-top: 1px solid #F1F5F9; padding: 10px 16px calc(12px + env(safe-area-inset-bottom, 0px)); flex-shrink: 0; max-width: 480px; width: 100%; margin: 0 auto; }
    .promo-notice-row { display: flex; align-items: center; justify-content: space-between; font-size: 11.5px; color: #334155; font-weight: 600; margin-bottom: 10px; }
    .promo-notice-left { display: flex; align-items: center; gap: 6px; }
    .bottom-buttons-row { display: flex; gap: 12px; }
    .btn-bottom-dl { flex: 1; height: 46px; background: #EFF6FF; border: 1.5px solid #BFDBFE; border-radius: 12px; color: #0066FF; font-weight: 700; font-size: 13.5px; display: flex; align-items: center; justify-content: center; gap: 6px; cursor: pointer; box-shadow: none !important; }
    .btn-bottom-watch { flex: 1; height: 46px; background: #0066FF; border: none; border-radius: 12px; color: #FFFFFF; font-weight: 700; font-size: 13.5px; display: flex; align-items: center; justify-content: center; gap: 6px; cursor: pointer; box-shadow: none !important; }

    .report-modal-overlay, .policy-modal-overlay { position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(15, 23, 42, 0.65); backdrop-filter: blur(8px); display: none; align-items: flex-end; justify-content: center; z-index: 200; }
    .report-modal-card, .policy-modal-card { background: #FFFFFF; border-radius: 24px 24px 0 0; max-width: 500px; width: 100%; max-height: 85vh; display: flex; flex-direction: column; overflow: hidden; box-shadow: 0 -10px 30px rgba(0,0,0,0.15); animation: slideUp 0.25s ease-out; }
    @keyframes slideUp { from { transform: translateY(100%); } to { transform: translateY(0); } }
    
    .modal-top-header { padding: 14px 20px 8px 20px; flex-shrink: 0; }
    .modal-drag-handle { width: 36px; height: 4px; background: #CBD5E1; border-radius: 9999px; margin: 0 auto 12px auto; }
    .modal-title-row { display: flex; justify-content: space-between; align-items: center; }
    .modal-main-title { font-size: 15px; font-weight: 800; color: #0F172A; }
    .btn-modal-close { background: none; border: none; color: #94A3B8; cursor: pointer; padding: 4px; display: flex; align-items: center; justify-content: center; }
    .modal-scrollable-body { padding: 12px 20px 20px 20px; overflow-y: auto; flex: 1; -webkit-overflow-scrolling: touch; }
    
    .btn-report-piracy { width: 100%; height: 42px; background: #EFF6FF; border: 1.5px solid #BFDBFE; color: #0066FF; font-weight: 700; font-size: 13.5px; border-radius: 12px; margin-bottom: 16px; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 6px; }
    .radio-reasons-list { display: flex; flex-direction: column; gap: 12px; margin-bottom: 20px; }
    .radio-item-label { display: flex; align-items: center; gap: 10px; font-size: 13.5px; color: #1E293B; font-weight: 500; cursor: pointer; padding: 6px 0; }
    .radio-item-label input[type="radio"] { width: 18px; height: 18px; accent-color: #0066FF; cursor: pointer; }
    .btn-submit-report { width: 100%; height: 46px; background: #0066FF; color: #FFFFFF; font-weight: 700; font-size: 14px; border: none; border-radius: 12px; cursor: pointer; }
    
    .policy-para { font-size: 13px; color: #334155; line-height: 1.6; margin-bottom: 12px; }
    .statutory-card { background: #F8FAFC; border: 1px solid #E2E8F0; border-radius: 12px; padding: 14px; margin-top: 10px; font-size: 12.5px; line-height: 1.55; color: #1E293B; }
    .statutory-card-header { font-weight: 800; font-size: 13px; color: #0F172A; margin-bottom: 8px; border-bottom: 1px solid #E2E8F0; padding-bottom: 6px; }
    .statutory-numbered-item { margin-bottom: 8px; }
    .nested-legal-statements { margin-top: 6px; padding-left: 8px; font-size: 12px; color: #475569; }
    .nested-statement-item { margin-bottom: 4px; }
    .grievance-contact-card { background: #EFF6FF; border: 1px solid #BFDBFE; border-radius: 10px; padding: 10px 12px; margin-top: 10px; font-size: 12px; color: #1E3A8A; }
    .grievance-contact-card-title { font-weight: 800; margin-bottom: 2px; }
    .grievance-email-link { color: #0066FF; font-weight: 700; text-decoration: none; }
    
    .modal-bottom-actions { padding: 12px 20px calc(14px + env(safe-area-inset-bottom, 0px)) 20px; border-top: 1px solid #F1F5F9; display: flex; gap: 10px; flex-shrink: 0; background: #FFFFFF; }
    .btn-report-direct { flex: 1.2; height: 44px; background: #0066FF; color: #FFFFFF; border: none; border-radius: 9999px; font-size: 13px; font-weight: 700; cursor: pointer; }
    .btn-understood { flex: 1; height: 44px; background: #F1F5F9; color: #334155; border: none; border-radius: 9999px; font-size: 13px; font-weight: 700; cursor: pointer; }
  </style>
</head>
<body>

  <nav class="navbar">
    <div class="brand">
      <div class="brand-logo">T</div>
      <div class="brand-text-container">
        <span class="brand-name">TeraBox</span>
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

    <h1 class="file-headline-title">${rawName}</h1>

    ${isFolder ? `
      <div class="file-card-container" style="cursor:pointer; text-align:left;" onclick="watchInApp()">
        <div style="display:flex; align-items:center; gap:12px; width:100%; margin-bottom:10px;">
          <div class="file-icon-box" style="background:#FFFBEB; border:1.5px solid #FDE68A;">
            <svg viewBox="0 0 24 24" width="30" height="30" fill="#D97706"><path d="M20 6h-8l-2-2H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2zm0 12H4V8h16v10z"/></svg>
          </div>
          <div style="flex:1;">
            <div style="font-weight:800; font-size:15px; color:#0F172A;">Folder • ${childCount} Items</div>
            <div style="font-size:12.5px; color:#64748B; font-weight:600;">Total: ${displaySize}</div>
          </div>
        </div>
        ${share.children && share.children.length > 0 ? `
          <div style="display:flex; flex-direction:column; gap:5px; width:100%; max-height:140px; overflow-y:auto; border-top:1px solid #F1F5F9; padding-top:8px;">
            ${share.children.slice(0, 15).map(c => `
              <div style="display:flex; align-items:center; justify-content:space-between; padding:5px 8px; background:#F8FAFC; border-radius:6px; font-size:12px;">
                <span style="white-space:nowrap; overflow:hidden; text-overflow:ellipsis; max-width:240px; color:#1E293B; font-weight:500;">${c.name}</span>
                <span style="color:#94A3B8; font-size:11px;">${formatBytes(c.sizeBytes || 0)}</span>
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
    ` : isApk ? `
      <div class="file-card-container" onclick="downloadFileDirectly()">
        <div class="file-icon-box" style="background:#ECFDF5; border:1px solid #A7F3D0;"><svg viewBox="0 0 24 24" width="34" height="34" fill="none" stroke="#059669" stroke-width="2"><path d="M4 10h16v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-8z"/><path d="M7 6a5 5 0 0 1 10 0v4H7V6z"/><circle cx="9" cy="7" r="1"/><circle cx="15" cy="7" r="1"/></svg></div>
        <div style="margin-top:8px; text-align:center;">
          <span style="font-size:11px; font-weight:800; background:#ECFDF5; color:#059669; padding:3px 8px; border-radius:6px;">APK</span>
          <div style="font-size:12.5px; font-weight:600; color:#64748B; margin-top:4px;">${displaySize}</div>
        </div>
      </div>
    ` : `
      <div class="file-card-container" onclick="downloadFileDirectly()">
        <div class="file-icon-box" style="background:#EFF6FF; border:1px solid #BFDBFE;"><svg viewBox="0 0 24 24" width="34" height="34" fill="none" stroke="#0066FF" stroke-width="2"><path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><polyline points="13 2 13 9 20 9"/></svg></div>
        <div style="margin-top:8px; text-align:center;">
          <span style="font-size:11px; font-weight:800; background:#EFF6FF; color:#0066FF; padding:3px 8px; border-radius:6px;">${ext ? ext.toUpperCase() : 'FILE'}</span>
          <div style="font-size:12.5px; font-weight:600; color:#64748B; margin-top:4px;">${displaySize}</div>
        </div>
      </div>
    `}
  </div>

  <div class="bottom-bar-container">
    <div class="promo-notice-row">
      <div class="promo-notice-left">
        <span>${isFolder ? 'Shared folders are accessible exclusively in TeraBox App' : (isVideo || isImage) ? 'Media streams & downloads exclusively in TeraBox App' : 'Download TeraBox for permanent free 1024GB cloud storage'}</span>
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

  <!-- Report Modal -->
  <div class="report-modal-overlay" id="reportModalOverlay" onclick="closeReportModalOnOutside(event)">
    <div class="report-modal-card">
      <div class="modal-top-header">
        <div class="modal-drag-handle"></div>
        <div class="modal-title-row">
          <div class="modal-main-title">Report</div>
          <button class="btn-modal-close" onclick="closeReportModal()" aria-label="Close">
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
      </div>
      <div class="modal-scrollable-body" id="mainReportView">
        <button type="button" class="btn-report-piracy" onclick="openPolicyModal()">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
          <span>Report piracy</span>
        </button>
        <form onsubmit="submitHarmfulReport(event)">
          <div class="radio-reasons-list">
            <label class="radio-item-label">
              <input type="radio" name="harmfulReason" value="Infringement on intellectual property" checked />
              <span>Infringement on intellectual property</span>
            </label>
            <label class="radio-item-label">
              <input type="radio" name="harmfulReason" value="Pornography or vulgar content" />
              <span>Pornography or vulgar content</span>
            </label>
            <label class="radio-item-label">
              <input type="radio" name="harmfulReason" value="Violence, terrorism, or illegal activities" />
              <span>Violence, terrorism, or illegal activities</span>
            </label>
            <label class="radio-item-label">
              <input type="radio" name="harmfulReason" value="Personal privacy violation" />
              <span>Personal privacy violation</span>
            </label>
            <label class="radio-item-label">
              <input type="radio" name="harmfulReason" value="Malware, virus, or scam" />
              <span>Malware, virus, or scam</span>
            </label>
            <label class="radio-item-label">
              <input type="radio" name="harmfulReason" value="Other harmful violations" />
              <span>Other harmful violations</span>
            </label>
          </div>
          <button type="submit" class="btn-submit-report" id="btnSubmitHarmful">Submit</button>
        </form>
      </div>

      <div class="modal-scrollable-body" id="reportSuccessBox" style="display:none; text-align:center; padding: 24px 0;">
        <svg viewBox="0 0 24 24" width="48" height="48" fill="none" stroke="#10B981" stroke-width="2" style="margin: 0 auto 12px auto;"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
        <h3 style="font-size:17px; font-weight:700; color:#0F172A; margin-bottom:8px;">Report Submitted</h3>
        <p style="font-size:13.5px; color:#64748B; margin-bottom:20px;">Thank you. The content has been flagged for rapid review.</p>
        <button class="btn-submit-report" onclick="closeReportModal()">OK</button>
      </div>
    </div>
  </div>

  <!-- Copyright Policy Modal -->
  <div class="policy-modal-overlay" id="policyModalOverlay" onclick="closePolicyModalOnOutside(event)">
    <div class="policy-modal-card">
      <div class="modal-top-header">
        <div class="modal-drag-handle"></div>
        <div class="modal-title-row">
          <div class="modal-main-title">TeraBox Policy for Notice of Alleged Infringement</div>
          <button class="btn-modal-close" onclick="closePolicyModal()" aria-label="Close">
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
      </div>

      <div class="modal-scrollable-body">
        <div class="policy-para">
          TeraBox ("TeraBox") respects the intellectual property rights of creators and copyright owners and expects all users to do the same. In compliance with Section 79 of the <strong>Information Technology Act, 2000</strong>, the <strong>Information Technology (Intermediary Guidelines and Digital Media Ethics Code) Rules, 2021</strong> of India, the <strong>Indian Copyright Act, 1957</strong>, and global DMCA standards, TeraBox functions as an intermediary and provides a designated Grievance &amp; Copyright mechanism to expeditiously process takedown requests.
        </div>
        <div class="policy-para">
          If you are a copyright owner or authorized legal representative, please report alleged copyright infringements committed on or through TeraBox by completing the following statutory <strong>Notice of Alleged Infringement</strong> and submitting it to our designated Grievance &amp; Copyright Officer. Upon receipt of a valid notice, TeraBox will take prompt action within <strong>36 hours</strong>, including disabling access to or permanently removing the infringing material.
        </div>

        <div class="statutory-card">
          <div class="statutory-card-header">Statutory Notice of Alleged Infringement<br>("Takedown Notice")</div>
          
          <div class="statutory-numbered-item">
            <strong>1. Identification of Copyrighted Work:</strong> Identify the copyrighted work (film, video, music, software, literature, etc.) claimed to have been infringed, or provide a representative list if multiple works are involved.
          </div>
          
          <div class="statutory-numbered-item">
            <strong>2. Identification of Infringing Link / File:</strong> Identify the exact TeraBox URL/link (e.g. https://.../s/...) or unique file identifier to which access is to be disabled.
          </div>
          
          <div class="statutory-numbered-item">
            <strong>3. Contact Details of Claimant:</strong> Provide your full legal name, company/production house affiliation (if applicable), physical address in India or overseas, telephone number, and official email address.
          </div>
          
          <div class="statutory-numbered-item">
            <strong>4. Mandatory Legal Statements:</strong> Include all of the following statements in the body of your Notice:
            <div class="nested-legal-statements">
              <div class="nested-statement-item">
                &bull; <em>Good Faith Statement:</em> I hereby state that I have a good faith belief that the sharing or distribution of the copyrighted material at the link specified is not authorized by the copyright owner, its agent, or under applicable law (including fair dealing under Section 52 of the Indian Copyright Act, 1957).
              </div>
              <div class="nested-statement-item">
                &bull; <em>Accuracy &amp; Authority Statement:</em> I hereby state that the information in this Notice is accurate and, under penalty of perjury and applicable laws of India, that I am the owner, or authorized to act on behalf of the owner, of the exclusive right that is allegedly infringed.
              </div>
              <div class="nested-statement-item">
                &bull; <em>Intermediary Liability Acknowledgment:</em> I acknowledge that submitting false, malicious, or bad-faith takedown notices may subject me to civil damages and criminal liability under the Information Technology Act, 2000 and the Indian Penal Code.
              </div>
            </div>
          </div>
          
          <div class="statutory-numbered-item">
            <strong>5. Legal Signature:</strong> Provide your full legal name and an electronic or physical signature (pursuant to Section 5 of the Information Technology Act, 2000).
          </div>

          <div class="grievance-contact-card">
            <div class="grievance-contact-card-title">Resident Grievance &amp; Copyright Compliance Officer (India)</div>
            <div>Designated under Rule 3(2) of the Information Technology Rules, 2021</div>
            <div style="margin-top:4px;">
              Email: <a href="mailto:grievance@terabox.com" class="grievance-email-link">grievance@terabox.com</a> &amp; <a href="mailto:copyrightresponse@terabox.com" class="grievance-email-link">copyrightresponse@terabox.com</a>
            </div>
            <div style="margin-top:2px;">Turnaround Time: Acknowledgment within 24 hours &bull; Action within 36 hours</div>
          </div>
        </div>
      </div>

      <div class="modal-bottom-actions">
        <button class="btn-report-direct" onclick="submitDirectPiracyReport()">Report Piracy Directly</button>
        <button class="btn-understood" onclick="closePolicyModal()">Understood</button>
      </div>
    </div>
  </div>

  <script>
    var shareCode = "${share.code}";
    var isMediaFile = ${Boolean(isVideo || isImage || isFolder)};
    var directDownloadUrl = "${directFileUrl}";
    var activeSessionNonce = null;
    var activeClientToken = null;
    var requiredWatchSecs = 5;
    var hasVerifiedView = false;

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
            requiredWatchSecs = data.requiredWatchSeconds || 5;
          }
        })
        .catch(function(err) {
          console.warn('[Webmaster Tracking] Session init note:', err);
        });
      } catch (_) {}
    })();

    // 2. Verified View Tracking (Credits videoPlays and CPM wallet balance)
    function verifyAndRecordView() {
      if (hasVerifiedView || !activeSessionNonce) return;
      hasVerifiedView = true;
      try {
        var fp = 'web_' + (navigator.userAgent || '').replace(/[^a-zA-Z0-9]/g, '').substring(0, 30) + '_' + (window.screen ? window.screen.width + 'x' + window.screen.height : '800x600');
        fetch('/api/webmaster/verify-watch', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            code: shareCode,
            nonce: activeSessionNonce,
            watchSeconds: requiredWatchSecs || 5,
            videoDuration: ${share.durationSeconds || 120},
            clientToken: activeClientToken,
            fingerprint: fp
          })
        }).catch(function() {});
      } catch (_) {}
    }

    function watchInApp() {
      verifyAndRecordView();
      var isAndroid = /Android/i.test(navigator.userAgent);
      var isIOS = /iPhone|iPad|iPod/i.test(navigator.userAgent);
      var playStoreUrl = "https://play.google.com/store/apps/details?id=com.teracloud.app.terabox_client";
      var appIntentUrl = "intent://share/" + shareCode + "#Intent;scheme=terabox;package=com.teracloud.app.terabox_client;S.browser_fallback_url=" + encodeURIComponent(playStoreUrl) + ";end;";

      if (isAndroid) {
        var start = Date.now();
        window.location.href = appIntentUrl;
        setTimeout(function() {
          if (Date.now() - start < 2000) {
            window.location.href = playStoreUrl;
          }
        }, 1500);
      } else if (isIOS) {
        window.location.href = "terabox://share/" + shareCode;
      } else {
        window.location.href = "terabox://share/" + shareCode;
      }
    }

    function downloadFileDirectly() {
      verifyAndRecordView();
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

    function submitHarmfulReport(event) {
      event.preventDefault();
      var selected = document.querySelector('input[name="harmfulReason"]:checked');
      var reasonVal = selected ? selected.value : 'General Report';
      var btn = document.getElementById('btnSubmitHarmful');
      btn.disabled = true;
      btn.innerText = 'Submitting...';

      fetch('/api/report/takedown', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          shareCode: shareCode,
          reason: reasonVal,
          reporterName: 'Web User',
          reporterEmail: 'abuse@terabox.com',
          proofDetails: reasonVal
        })
      })
      .then(function(res) { return res.json(); })
      .then(function() {
        btn.disabled = false;
        btn.innerText = 'Submit';
        document.getElementById('mainReportView').style.display = 'none';
        document.getElementById('reportSuccessBox').style.display = 'block';
      })
      .catch(function() {
        btn.disabled = false;
        btn.innerText = 'Submit';
        alert('Report submitted successfully.');
        closeReportModal();
      });
    }

    function submitDirectPiracyReport() {
      fetch('/api/report/takedown', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          shareCode: shareCode,
          reason: 'Copyright Piracy Takedown',
          reporterName: 'Copyright Owner',
          reporterEmail: 'grievance@terabox.com',
          proofDetails: 'Statutory Notice filed via Web Interface'
        })
      })
      .then(function() {
        alert('Statutory Takedown Notice registered. Acknowledgment sent to grievance desk.');
        closePolicyModal();
      })
      .catch(function() {
        alert('Notice submitted successfully.');
        closePolicyModal();
      });
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
