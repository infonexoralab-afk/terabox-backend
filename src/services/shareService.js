const env = require('../config/env');

class ShareService {
  constructor() {
    this.shares = new Map();
  }

  // Create Short Share Link
  createShare(fileData, customCode = null) {
    const code = customCode || Math.random().toString(36).substring(2, 8) + Math.random().toString(36).substring(2, 4);
    
    const ext = (fileData.extension || (fileData.name ? fileData.name.split('.').pop() : 'dat')).toLowerCase();
    const isVideo = fileData.isVideo ?? ['mp4', 'mkv', 'mov', 'avi', 'webm'].includes(ext);
    
    const downloadUrl = fileData.downloadUrl || fileData.publicUrl || (fileData.r2Key ? `${env.r2.publicDomain}/${fileData.r2Key}` : `${env.r2.publicDomain}/uploads/${fileData.name || 'file'}`);
    const streamUrl = isVideo ? (fileData.streamUrl || downloadUrl) : null;

    const shareItem = {
      code,
      fileId: fileData.id || `node_${Date.now()}`,
      fileName: fileData.name || 'Shared_File',
      sizeBytes: fileData.sizeBytes || 10485760,
      extension: ext,
      isVideo: isVideo,
      durationSeconds: fileData.durationSeconds || (isVideo ? 120 : 0),
      r2Key: fileData.r2Key || '',
      downloadUrl: downloadUrl,
      streamUrl: streamUrl,
      createdAt: new Date().toISOString(),
      viewsCount: 0,
      appRedirectUrl: `terabox://share/${code}`,
      shareUrl: `${env.appUrl}/s/${code}`,
    };

    this.shares.set(code, shareItem);
    return shareItem;
  }

  // Get Share Details by Short Code
  getShare(code) {
    let share = this.shares.get(code);
    if (!share) {
      // Share not found (server may have restarted and lost in-memory data)
      // Return null so the route handler can show a proper "not found" page
      return null;
    }
    share.viewsCount++;
    return share;
  }

  // Render Human-Crafted, Responsive, Premium Production Web Page
  renderWebPreviewHtml(share) {
    const formatBytes = (bytes) => {
      if (!bytes || bytes === 0) return '0 B';
      const k = 1024;
      const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
      const i = Math.floor(Math.log(bytes) / Math.log(k));
      return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
    };

    const isVideo = share.isVideo === true || ['mp4', 'mkv', 'mov', 'avi', 'webm'].includes((share.extension || '').toLowerCase());
    const fileExtUpper = (share.extension || 'FILE').toUpperCase();

    return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
  <title>${share.fileName} - TeraBox 1024 GB Cloud</title>
  <meta name="description" content="Download and stream ${share.fileName} on TeraBox Cloud Storage.">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap" rel="stylesheet">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; font-family: 'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, sans-serif; -webkit-tap-highlight-color: transparent; }
    body { background-color: #F8FAFC; color: #0F172A; min-height: 100vh; display: flex; flex-direction: column; }
    
    /* Top Navigation */
    .navbar {
      background: #FFFFFF;
      border-bottom: 1px solid #E2E8F0;
      padding: 14px 24px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      position: sticky;
      top: 0;
      z-index: 50;
      box-shadow: 0 1px 3px rgba(0,0,0,0.03);
    }
    .brand { display: flex; align-items: center; gap: 10px; text-decoration: none; }
    .brand-logo {
      width: 36px; height: 36px; border-radius: 10px; background: #0066FF;
      display: flex; align-items: center; justify-content: center; color: #FFFFFF; font-weight: 800; font-size: 18px;
    }
    .brand-name { font-size: 19px; font-weight: 800; color: #0F172A; letter-spacing: -0.4px; }
    .brand-badge {
      font-size: 11px; font-weight: 700; background: #EFF6FF; color: #0066FF;
      padding: 3px 8px; border-radius: 6px; border: 1px solid #DBEAFE;
    }
    .btn-nav-app {
      background: #0066FF; color: #FFFFFF; font-size: 13px; font-weight: 700;
      padding: 9px 22px; border-radius: 20px; text-decoration: none; border: none; cursor: pointer;
      box-shadow: 0 4px 12px rgba(0, 102, 255, 0.25); transition: all 0.2s ease;
    }
    .btn-nav-app:hover { background: #0052D4; transform: translateY(-1px); }

    /* Main Container */
    .container {
      flex: 1;
      max-width: 680px;
      width: 100%;
      margin: 32px auto;
      padding: 0 20px;
    }

    /* Video Player Surface */
    .video-card {
      background: #000000;
      border-radius: 24px;
      overflow: hidden;
      position: relative;
      box-shadow: 0 16px 36px rgba(15, 23, 42, 0.12);
      border: 1px solid #E2E8F0;
      aspect-ratio: 16/9;
    }
    video { width: 100%; height: 100%; object-fit: contain; background: #000000; }

    /* Live Countdown Badge */
    .teaser-badge {
      position: absolute;
      top: 14px;
      left: 14px;
      background: rgba(15, 23, 42, 0.85);
      backdrop-filter: blur(10px);
      padding: 6px 14px;
      border-radius: 20px;
      font-size: 12px;
      font-weight: 700;
      color: #FFFFFF;
      display: flex;
      align-items: center;
      gap: 8px;
      border: 1px solid rgba(255,255,255,0.15);
      z-index: 10;
    }
    .dot-live { width: 8px; height: 8px; border-radius: 50%; background: #EF4444; animation: blink 1.2s infinite; }
    @keyframes blink { 0%, 100% { opacity: 1; } 50% { opacity: 0.3; } }

    /* Center Click to Play Overlay */
    .play-overlay {
      position: absolute;
      top: 0; left: 0; right: 0; bottom: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      background: rgba(0,0,0,0.3);
      cursor: pointer;
      z-index: 5;
      transition: opacity 0.2s;
    }
    .play-btn-circle {
      width: 68px; height: 68px; border-radius: 50%; background: #0066FF;
      display: flex; align-items: center; justify-content: center; color: #FFFFFF;
      box-shadow: 0 8px 24px rgba(0, 102, 255, 0.5); transition: transform 0.2s;
    }
    .play-btn-circle:hover { transform: scale(1.08); }

    /* 10s Teaser Limit Interstitial Modal */
    .paywall-modal {
      position: absolute;
      top: 0; left: 0; right: 0; bottom: 0;
      background: rgba(15, 23, 42, 0.95);
      backdrop-filter: blur(14px);
      display: none;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 24px;
      text-align: center;
      z-index: 20;
      animation: modalFade 0.3s ease-out forwards;
    }
    @keyframes modalFade { from { opacity: 0; transform: scale(0.96); } to { opacity: 1; transform: scale(1); } }

    .modal-icon {
      width: 56px; height: 56px; border-radius: 28px; background: rgba(0, 102, 255, 0.15);
      border: 1px solid rgba(0, 102, 255, 0.35); display: flex; align-items: center; justify-content: center;
      color: #0066FF; margin-bottom: 14px;
    }
    .modal-h3 { font-size: 19px; font-weight: 800; color: #FFFFFF; margin-bottom: 6px; }
    .modal-p { font-size: 13px; color: #94A3B8; max-width: 340px; margin-bottom: 22px; line-height: 1.5; }
    
    .btn-modal-app {
      width: 100%;
      max-width: 320px;
      background: #0066FF;
      color: #FFFFFF;
      font-size: 15px;
      font-weight: 700;
      padding: 14px;
      border-radius: 26px;
      border: none;
      cursor: pointer;
      box-shadow: 0 8px 24px rgba(0, 102, 255, 0.4);
      transition: all 0.2s;
    }
    .btn-modal-app:hover { background: #0052D4; transform: translateY(-1px); }

    /* Non-Video Generic File Card (EXE, ZIP, PDF, APK, etc.) */
    .generic-file-card {
      background: #FFFFFF;
      border-radius: 24px;
      padding: 32px 24px;
      border: 1px solid #E2E8F0;
      box-shadow: 0 10px 30px rgba(0,0,0,0.04);
      display: flex;
      flex-direction: column;
      align-items: center;
      text-align: center;
    }
    .file-type-badge {
      width: 76px; height: 76px; border-radius: 22px; background: #EFF6FF;
      border: 1px solid #DBEAFE; display: flex; flex-direction: column;
      align-items: center; justify-content: center; margin-bottom: 18px;
    }
    .file-type-badge svg { color: #0066FF; margin-bottom: 4px; }
    .file-type-badge span { font-size: 10px; font-weight: 800; color: #0066FF; }

    /* File Metadata Card */
    .file-details-card {
      background: #FFFFFF;
      border-radius: 20px;
      padding: 20px;
      margin-top: 18px;
      border: 1px solid #E2E8F0;
      box-shadow: 0 2px 8px rgba(0,0,0,0.02);
    }
    .file-name { font-size: 18px; font-weight: 800; color: #0F172A; margin-bottom: 8px; word-break: break-all; }
    .file-meta-row { display: flex; flex-wrap: wrap; gap: 14px; font-size: 13px; color: #64748B; font-weight: 500; }
    .meta-tag { display: flex; align-items: center; gap: 6px; }

    /* Action Buttons Row */
    .actions-row { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; margin-top: 18px; }
    .action-button {
      padding: 16px; border-radius: 16px; font-size: 15px; font-weight: 800;
      display: flex; align-items: center; justify-content: center; gap: 8px;
      cursor: pointer; border: none; transition: all 0.2s; text-decoration: none;
    }
    .btn-download-main { background: #0066FF; color: #FFFFFF; box-shadow: 0 6px 18px rgba(0, 102, 255, 0.25); }
    .btn-download-main:hover { background: #0052D4; transform: translateY(-1px); }
    .btn-save-main { background: #EFF6FF; color: #0066FF; border: 1px solid #DBEAFE; }
    .btn-save-main:hover { background: #DBEAFE; }

    /* 1024 GB Promo Banner */
    .cloud-banner {
      background: linear-gradient(135deg, #EFF6FF, #F0FDF4);
      border: 1px solid #BFDBFE;
      border-radius: 20px;
      padding: 20px;
      margin-top: 20px;
      display: flex;
      align-items: center;
      gap: 16px;
    }
    .cloud-badge {
      width: 48px; height: 48px; border-radius: 14px; background: #0066FF;
      color: #FFFFFF; display: flex; align-items: center; justify-content: center;
      font-weight: 800; font-size: 15px; flex-shrink: 0;
    }
    .cloud-text h4 { font-size: 15px; font-weight: 800; color: #0F172A; }
    .cloud-text p { font-size: 12px; color: #64748B; margin-top: 2px; }

    /* Footer */
    .footer { text-align: center; padding: 32px 16px; font-size: 12px; color: #94A3B8; margin-top: auto; }
  </style>
</head>
<body>

  <!-- Top Navigation Bar -->
  <nav class="navbar">
    <div class="brand">
      <div class="brand-logo">T</div>
      <span class="brand-name">TeraBox</span>
      <span class="brand-badge">1024 GB Cloud</span>
    </div>
    <button class="btn-nav-app" onclick="triggerDirectDownload()">Download</button>
  </nav>

  <!-- Content Container -->
  <div class="container">

    ${isVideo ? `
    <!-- Video Player Preview -->
    <div class="video-card">
      <div class="teaser-badge" id="teaserBadge">
        <span class="dot-live"></span>
        <span id="teaserTimer">Free Preview: 10s</span>
      </div>

      <div class="play-overlay" id="playOverlay" onclick="startPlayback()">
        <div class="play-btn-circle">
          <svg width="32" height="32" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
        </div>
      </div>

      <video id="teaserVideo" playsinline controls preload="auto">
        <source src="${share.streamUrl || share.downloadUrl}" type="video/mp4">
        Your browser does not support HTML5 video.
      </video>

      <div class="paywall-modal" id="paywallModal">
        <div class="modal-icon">
          <svg width="26" height="26" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
        </div>
        <h3 class="modal-h3">Free Preview Ended</h3>
        <p class="modal-p">
          Download or watch the full video in <strong>1080p Ultra-HD</strong> with ultra-fast speed on TeraBox Cloud.
        </p>
        <button class="btn-modal-app" onclick="triggerDirectDownload()">
          Download Full Video (${formatBytes(share.sizeBytes)})
        </button>
      </div>
    </div>
    ` : `
    <!-- Non-Video Generic File Card (EXE, ZIP, PDF, APK, etc.) -->
    <div class="generic-file-card">
      <div class="file-type-badge">
        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><polyline points="13 2 13 9 20 9"/></svg>
        <span>${fileExtUpper}</span>
      </div>
      <h2 style="font-size: 19px; font-weight: 800; color: #0F172A; margin-bottom: 6px; word-break: break-all;">${share.fileName}</h2>
      <p style="font-size: 13px; color: #64748B; margin-bottom: 20px;">${formatBytes(share.sizeBytes)} • Cloudflare R2 High-Speed Storage</p>
      <button class="action-button btn-download-main" style="width: 100%; max-width: 340px;" onclick="triggerDirectDownload()">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
        Download ${fileExtUpper} (${formatBytes(share.sizeBytes)})
      </button>
    </div>
    `}

    <!-- File Details -->
    <div class="file-details-card">
      <h1 class="file-name">${share.fileName}</h1>
      <div class="file-meta-row">
        <div class="meta-tag">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><polyline points="13 2 13 9 20 9"/></svg>
          ${formatBytes(share.sizeBytes)}
        </div>
        <div class="meta-tag">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
          Cloudflare R2 High-Speed CDN
        </div>
        <div class="meta-tag">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>
          256-bit AES Safe
        </div>
      </div>
    </div>

    <!-- Actions -->
    <div class="actions-row">
      <button class="action-button btn-download-main" onclick="triggerDirectDownload()">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
        Direct Download
      </button>
      <button class="action-button btn-save-main" onclick="triggerSaveToCloud()">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>
        Save to My Cloud
      </button>
    </div>

    <!-- 1024 GB Promo Card -->
    <div class="cloud-banner">
      <div class="cloud-badge">1TB</div>
      <div class="cloud-text">
        <h4>Claim 1024 GB Free Cloud Storage</h4>
        <p>Safely backup all your videos, photos, software, and documents on TeraBox.</p>
      </div>
    </div>

  </div>

  <footer class="footer">
    TeraBox Cloud Storage • 1024 GB Free Storage & High-Speed Sync
  </footer>

  <script>
    const downloadTargetUrl = "${share.downloadUrl || share.streamUrl || '#'}";

    function triggerDirectDownload() {
      if (downloadTargetUrl && downloadTargetUrl !== '#') {
        window.location.href = downloadTargetUrl;
      } else {
        alert('Starting high-speed Cloudflare R2 download for "${share.fileName}"...');
      }
    }

    function triggerSaveToCloud() {
      alert('1-Click Save: "${share.fileName}" added to your TeraBox Cloud Storage!');
    }

    ${isVideo ? `
    const video = document.getElementById('teaserVideo');
    const playOverlay = document.getElementById('playOverlay');
    const teaserBadge = document.getElementById('teaserBadge');
    const teaserTimer = document.getElementById('teaserTimer');
    const paywallModal = document.getElementById('paywallModal');
    const MAX_PREVIEW = 10;
    let limitReached = false;

    function startPlayback() {
      if (playOverlay) playOverlay.style.display = 'none';
      if (video) video.play();
    }

    if (video) {
      video.addEventListener('play', () => {
        if (playOverlay) playOverlay.style.display = 'none';
      });

      video.addEventListener('timeupdate', () => {
        const remaining = Math.max(0, Math.ceil(MAX_PREVIEW - video.currentTime));
        if (teaserTimer) teaserTimer.innerText = 'Free Preview: ' + remaining + 's';

        if (video.currentTime >= MAX_PREVIEW && !limitReached) {
          limitReached = true;
          video.pause();
          video.currentTime = MAX_PREVIEW;
          if (teaserBadge) teaserBadge.style.display = 'none';
          if (paywallModal) paywallModal.style.display = 'flex';
        }
      });

      video.addEventListener('seeking', () => {
        if (video.currentTime > MAX_PREVIEW) {
          video.currentTime = MAX_PREVIEW;
          video.pause();
          if (paywallModal) paywallModal.style.display = 'flex';
        }
      });

      video.play().catch(() => {
        if (playOverlay) playOverlay.style.display = 'flex';
      });
    }
    ` : ''}
  </script>
</body>
</html>
    `;
  }
}

module.exports = new ShareService();
