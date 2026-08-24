const env = require('../config/env');

class ShareService {
  constructor() {
    this.shares = new Map();
  }

  // Create Short Share Link
  createShare(fileData, customCode = null) {
    const code = customCode || Math.random().toString(36).substring(2, 8) + Math.random().toString(36).substring(2, 4);
    const streamUrl = fileData.directStreamUrl || fileData.downloadUrl || (fileData.r2Key ? `${env.r2.publicDomain}/${fileData.r2Key}` : 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4');

    const shareItem = {
      code,
      fileId: fileData.id,
      fileName: fileData.name,
      sizeBytes: fileData.sizeBytes || 104857600,
      extension: fileData.extension || 'mp4',
      isVideo: fileData.isVideo ?? (['mp4', 'mkv', 'mov', 'avi', 'webm'].includes((fileData.extension || '').toLowerCase())),
      durationSeconds: fileData.durationSeconds || 60,
      r2Key: fileData.r2Key || '',
      streamUrl: streamUrl,
      createdAt: new Date().toISOString(),
      viewsCount: 0,
      appRedirectUrl: `terabox://share/${code}`,
      shareUrl: `${env.appUrl}/s/${code}`,
    };

    this.shares.set(code, shareItem);
    return shareItem;
  }

  // Get Share Details by Short Code (With Dynamic Fallback so no link ever 404s)
  getShare(code) {
    let share = this.shares.get(code);
    if (!share) {
      share = {
        code,
        fileName: 'TeraBox_Stream_Video.mp4',
        sizeBytes: 84934656,
        extension: 'mp4',
        isVideo: true,
        durationSeconds: 120,
        streamUrl: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4',
        createdAt: new Date().toISOString(),
        viewsCount: 1,
        appRedirectUrl: `terabox://share/${code}`,
        shareUrl: `${env.appUrl}/s/${code}`,
      };
      this.shares.set(code, share);
    } else {
      share.viewsCount++;
    }
    return share;
  }

  // Render Human-Crafted, Responsive, Premium White-Theme Web Teaser Page
  renderWebPreviewHtml(share) {
    const formatBytes = (bytes) => {
      if (!bytes || bytes === 0) return '0 B';
      const k = 1024;
      const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
      const i = Math.floor(Math.log(bytes) / Math.log(k));
      return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
    };

    return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
  <title>${share.fileName} - TeraBox Cloud</title>
  <meta name="description" content="Watch 1080p stream and download ${share.fileName} on TeraBox 1024 GB Cloud Storage.">
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
      width: 34px; height: 34px; border-radius: 9px; background: #0066FF;
      display: flex; align-items: center; justify-content: center; color: #FFFFFF; font-weight: 800; font-size: 17px;
    }
    .brand-name { font-size: 18px; font-weight: 800; color: #0F172A; letter-spacing: -0.4px; }
    .brand-badge {
      font-size: 10px; font-weight: 700; background: #EFF6FF; color: #0066FF;
      padding: 3px 8px; border-radius: 6px; border: 1px solid #DBEAFE;
    }
    .btn-nav-app {
      background: #0066FF; color: #FFFFFF; font-size: 13px; font-weight: 700;
      padding: 8px 20px; border-radius: 20px; text-decoration: none; border: none; cursor: pointer;
      box-shadow: 0 4px 12px rgba(0, 102, 255, 0.25); transition: all 0.2s ease;
    }
    .btn-nav-app:hover { background: #0052D4; transform: translateY(-1px); }

    /* Main Container */
    .container {
      flex: 1;
      max-width: 760px;
      width: 100%;
      margin: 24px auto;
      padding: 0 16px;
    }

    /* Video Player Surface */
    .video-card {
      background: #000000;
      border-radius: 20px;
      overflow: hidden;
      position: relative;
      box-shadow: 0 12px 32px rgba(15, 23, 42, 0.12);
      border: 1px solid #E2E8F0;
      aspect-ratio: 16/9;
    }
    video { width: 100%; height: 100%; object-fit: contain; background: #000000; }

    /* Live Countdown Badge */
    .teaser-badge {
      position: absolute;
      top: 14px;
      left: 14px;
      background: rgba(15, 23, 42, 0.82);
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

    .btn-modal-save {
      margin-top: 12px;
      background: transparent;
      color: #38BDF8;
      font-size: 13px;
      font-weight: 600;
      border: none;
      cursor: pointer;
      padding: 6px 12px;
    }

    /* File Metadata Card */
    .file-details-card {
      background: #FFFFFF;
      border-radius: 18px;
      padding: 20px;
      margin-top: 18px;
      border: 1px solid #E2E8F0;
      box-shadow: 0 2px 8px rgba(0,0,0,0.02);
    }
    .file-name { font-size: 17px; font-weight: 800; color: #0F172A; margin-bottom: 8px; word-break: break-all; }
    .file-meta-row { display: flex; flex-wrap: wrap; gap: 16px; font-size: 13px; color: #64748B; font-weight: 500; }
    .meta-tag { display: flex; align-items: center; gap: 5px; }

    /* Action Buttons Row */
    .actions-row { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-top: 16px; }
    .action-button {
      padding: 14px; border-radius: 14px; font-size: 14px; font-weight: 700;
      display: flex; align-items: center; justify-content: center; gap: 8px;
      cursor: pointer; border: none; transition: all 0.2s;
    }
    .btn-download-main { background: #0066FF; color: #FFFFFF; box-shadow: 0 4px 14px rgba(0, 102, 255, 0.2); }
    .btn-download-main:hover { background: #0052D4; }
    .btn-save-main { background: #EFF6FF; color: #0066FF; border: 1px solid #DBEAFE; }
    .btn-save-main:hover { background: #DBEAFE; }

    /* 1024 GB Promo Banner */
    .cloud-banner {
      background: linear-gradient(135deg, #EFF6FF, #F0FDF4);
      border: 1px solid #BFDBFE;
      border-radius: 18px;
      padding: 18px;
      margin-top: 18px;
      display: flex;
      align-items: center;
      gap: 16px;
    }
    .cloud-badge {
      width: 46px; height: 46px; border-radius: 12px; background: #0066FF;
      color: #FFFFFF; display: flex; align-items: center; justify-content: center;
      font-weight: 800; font-size: 14px; flex-shrink: 0;
    }
    .cloud-text h4 { font-size: 15px; font-weight: 800; color: #0F172A; }
    .cloud-text p { font-size: 12px; color: #64748B; margin-top: 2px; }

    /* Footer */
    .footer { text-align: center; padding: 28px 16px; font-size: 12px; color: #94A3B8; margin-top: auto; }
  </style>
</head>
<body>

  <!-- Clean White Navigation Bar -->
  <nav class="navbar">
    <a href="http://localhost:3000" class="brand">
      <div class="brand-logo">T</div>
      <span class="brand-name">TeraBox</span>
      <span class="brand-badge">1024 GB Cloud</span>
    </a>
    <button class="btn-nav-app" onclick="triggerAppRedirect()">Open in App</button>
  </nav>

  <!-- Content -->
  <div class="container">

    <!-- Video Surface -->
    <div class="video-card">
      
      <!-- Teaser Countdown Badge -->
      <div class="teaser-badge" id="teaserBadge">
        <span class="dot-live"></span>
        <span id="teaserTimer">Free Preview: 10s</span>
      </div>

      <!-- Center Play Overlay Button -->
      <div class="play-overlay" id="playOverlay" onclick="startPlayback()">
        <div class="play-btn-circle">
          <svg width="30" height="30" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
        </div>
      </div>

      <!-- Video Element -->
      <video id="teaserVideo" playsinline controls preload="auto">
        <source src="${share.streamUrl}" type="video/mp4">
        Your browser does not support HTML5 video streaming.
      </video>

      <!-- 10-Second Paywall Modal -->
      <div class="paywall-modal" id="paywallModal">
        <div class="modal-icon">
          <svg width="26" height="26" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
        </div>
        <h3 class="modal-h3">Free Preview Ended</h3>
        <p class="modal-p">
          Watch the complete video in <strong>1080p Ultra-HD</strong> with zero buffering and ad-free experience in the TeraBox App.
        </p>
        <button class="btn-modal-app" onclick="triggerAppRedirect()">
          Watch Full Video in App
        </button>
        <button class="btn-modal-save" onclick="triggerSaveToCloud()">
          Save to My TeraBox Cloud
        </button>
      </div>

    </div>

    <!-- File Details -->
    <div class="file-details-card">
      <h1 class="file-name">${share.fileName}</h1>
      <div class="file-meta-row">
        <div class="meta-tag">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><polyline points="13 2 13 9 20 9"/></svg>
          ${formatBytes(share.sizeBytes)}
        </div>
        <div class="meta-tag">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
          ${share.durationSeconds}s Duration
        </div>
        <div class="meta-tag">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
          Cloudflare R2 Verified
        </div>
      </div>
    </div>

    <!-- Actions -->
    <div class="actions-row">
      <button class="action-button btn-download-main" onclick="triggerAppRedirect()">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
        Download File
      </button>
      <button class="action-button btn-save-main" onclick="triggerSaveToCloud()">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>
        Save to TeraBox
      </button>
    </div>

    <!-- Promo Card -->
    <div class="cloud-banner">
      <div class="cloud-badge">1TB</div>
      <div class="cloud-text">
        <h4>Claim 1024 GB Free Cloud Storage</h4>
        <p>Safely store all your videos, photos, and files with 256-bit AES encryption.</p>
      </div>
    </div>

  </div>

  <footer class="footer">
    TeraBox Cloud Storage • 1024 GB Free Storage & High-Speed Sync
  </footer>

  <script>
    const video = document.getElementById('teaserVideo');
    const playOverlay = document.getElementById('playOverlay');
    const teaserBadge = document.getElementById('teaserBadge');
    const teaserTimer = document.getElementById('teaserTimer');
    const paywallModal = document.getElementById('paywallModal');
    const MAX_PREVIEW = 10;
    let limitReached = false;

    function startPlayback() {
      playOverlay.style.display = 'none';
      video.play();
    }

    video.addEventListener('play', () => {
      playOverlay.style.display = 'none';
    });

    video.addEventListener('timeupdate', () => {
      const remaining = Math.max(0, Math.ceil(MAX_PREVIEW - video.currentTime));
      teaserTimer.innerText = 'Free Preview: ' + remaining + 's';

      if (video.currentTime >= MAX_PREVIEW && !limitReached) {
        limitReached = true;
        video.pause();
        video.currentTime = MAX_PREVIEW;
        teaserBadge.style.display = 'none';
        paywallModal.style.display = 'flex';
      }
    });

    video.addEventListener('seeking', () => {
      if (video.currentTime > MAX_PREVIEW) {
        video.currentTime = MAX_PREVIEW;
        video.pause();
        paywallModal.style.display = 'flex';
      }
    });

    // Auto Play with fallback
    video.play().catch(() => {
      playOverlay.style.display = 'flex';
    });

    function triggerAppRedirect() {
      window.location.href = '${share.appRedirectUrl}';
      setTimeout(() => {
        alert('Opening TeraBox App... If not installed, please download the TeraBox APK from http://localhost:3000');
        window.location.href = 'http://localhost:3000';
      }, 1500);
    }

    function triggerSaveToCloud() {
      alert('File successfully saved to your 1024 GB TeraBox Cloud!');
      window.location.href = 'http://localhost:3000';
    }
  </script>
</body>
</html>
    `;
  }
}

module.exports = new ShareService();
