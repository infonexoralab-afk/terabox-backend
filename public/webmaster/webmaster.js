/**
 * ══════════════════════════════════════════════════════════════
 * TeraBox Webmaster Center - Complete Flutter Engine
 * Exact 1:1 Parity with Flutter Dart Screens • 0 Emojis • Pure Web
 * ══════════════════════════════════════════════════════════════
 */

(function () {
  'use strict';

  // ══════════════════════════════════════════════════════════
  // GLOBAL STATE
  // ══════════════════════════════════════════════════════════
  let currentProfile = null;
  let ssoToken = '';
  let queryUserId = '';
  let queryEmail = '';
  let queryRef = '';
  let isInApp = false;
  let activePeriod = '24h'; // '24h' or 'all'
  let navigationStack = ['screen-dashboard'];
  let pollTimer = null;
  let referralLedgerData = null;
  let activeRefFilter = 'all';

  // Screen 2: Shared Links State
  let selectedLinkFilter = 0; // 0: All, 1: Videos, 2: Files
  let selectedLinkSort = 0;   // 0: Newest, 1: Earnings, 2: Plays, 3: Clicks
  let sharedSearchQuery = '';

  // Screen 4: Withdrawal History State
  let activeWithdrawalStatusFilter = 'all'; // 'all', 'paid', 'pending', 'rejected'
  let activeWithdrawalMethodFilter = 'all'; // 'all', 'upi', 'usdt'

  // Screen 6: Reward Details State
  let rewardDateFilter = 'all'; // 'all', 'today', 'week', 'month'
  let rewardSourceFilter = 'all'; // 'all', 'video', 'user'

  // Real-time admin configured rates
  let adminConfig = {
    enabled: true,
    cpaRewardUsd: 0.05,
    cpmRateUsd: 4.00,
    minWithdrawalUsd: 1.00,
    title: 'Creator Program Upgrades in Progress',
    subtitle: 'Scheduled Maintenance',
    message: 'The Webmaster Monetization Center is currently undergoing scheduled platform upgrades.'
  };

  // Modal Step State
  let withdrawModalStep = 0; // 0: Method, 1: Amount/Account, 2: Review
  let selectedPayoutMethod = 'upi'; // 'upi' or 'USDT_BEP20'

  // ══════════════════════════════════════════════════════════
  // DOM REFERENCES
  // ══════════════════════════════════════════════════════════
  const loadingOverlay = document.getElementById('loadingOverlay');
  const maintenanceBanner = document.getElementById('maintenanceBanner');
  const toastContainer = document.getElementById('toastContainer');
  const drawerOverlay = document.getElementById('drawerOverlay');

  // Drawer Elements
  const btnOpenMenuDrawer = document.getElementById('btnOpenMenuDrawer');
  const btnCloseDrawer = document.getElementById('btnCloseDrawer');
  const drawerUserEmail = document.getElementById('drawerUserEmail');
  const drawerUserRef = document.getElementById('drawerUserRef');

  // Screen 1: Dashboard Elements
  const overviewBalanceDisplay = document.getElementById('overviewBalanceDisplay');
  const overviewTodayEarned = document.getElementById('overviewTodayEarned');
  const cpaRateText = document.getElementById('cpaRateText');
  const btnQuickCopyReferral = document.getElementById('btnQuickCopyReferral');
  const btnShareDashboardLink = document.getElementById('btnShareDashboardLink');
  const metricLinkClicks = document.getElementById('metricLinkClicks');
  const metricVideoPlays = document.getElementById('metricVideoPlays');
  const metricNewUsers = document.getElementById('metricNewUsers');
  const metricEstimatedIncome = document.getElementById('metricEstimatedIncome');
  const metricCpmPill = document.getElementById('metricCpmPill');
  const metricCpaPill = document.getElementById('metricCpaPill');
  const tfcCpaBadge = document.getElementById('tfcCpaBadge');
  const tfcLinksCountBadge = document.getElementById('tfcLinksCountBadge');

  // Screen 2: Shared Links Elements
  const linksTotalCountDisplay = document.getElementById('linksTotalCountDisplay');
  const linksTotalPlaysVal = document.getElementById('linksTotalPlaysVal');
  const linksTotalClicksVal = document.getElementById('linksTotalClicksVal');
  const linksTotalEarnedVal = document.getElementById('linksTotalEarnedVal');
  const sharedLinksSortSelect = document.getElementById('sharedLinksSortSelect');
  const sharedLinksListContainer = document.getElementById('sharedLinksListContainer');
  const btnRefreshLinks = document.getElementById('btnRefreshLinks');

  // Screen 3: Referral Program Elements
  const appbarRefRateText = document.getElementById('appbarRefRateText');
  const refHeroRate = document.getElementById('refHeroRate');
  const cardRefCodeBadge = document.getElementById('cardRefCodeBadge');
  const refTotalEarnedPod = document.getElementById('refTotalEarnedPod');
  const refMinPayoutPod = document.getElementById('refMinPayoutPod');
  const refCodePod = document.getElementById('refCodePod');
  const funnelTotalClicks = document.getElementById('funnelTotalClicks');
  const funnelTotalInstalls = document.getElementById('funnelTotalInstalls');
  const funnelPending = document.getElementById('funnelPending');
  const funnelQualified = document.getElementById('funnelQualified');
  const refInviteUrlInput = document.getElementById('refInviteUrlInput');
  const btnCopyInviteLink = document.getElementById('btnCopyInviteLink');
  const btnShareWhatsApp = document.getElementById('btnShareWhatsApp');
  const btnShareTelegram = document.getElementById('btnShareTelegram');
  const btnOpenReferralQr = document.getElementById('btnOpenReferralQr');
  const referralsActivityContainer = document.getElementById('referralsActivityContainer');
  const btnRefreshReferrals = document.getElementById('btnRefreshReferrals');

  // Screen 4: Withdrawal History Elements
  const vaultTotalPaidDisplay = document.getElementById('vaultTotalPaidDisplay');
  const vaultPaidOutVal = document.getElementById('vaultPaidOutVal');
  const vaultInReviewVal = document.getElementById('vaultInReviewVal');
  const vaultAvailableVal = document.getElementById('vaultAvailableVal');
  const countAllSettlements = document.getElementById('countAllSettlements');
  const countPaidSettlements = document.getElementById('countPaidSettlements');
  const countPendingSettlements = document.getElementById('countPendingSettlements');
  const countRejectedSettlements = document.getElementById('countRejectedSettlements');
  const whRecordsCountBadge = document.getElementById('whRecordsCountBadge');
  const withdrawalCardsList = document.getElementById('withdrawalCardsList');
  const btnRefreshWithdrawals = document.getElementById('btnRefreshWithdrawals');

  // Screen 5: Pay Rates Elements
  const payRatesCpmPod = document.getElementById('payRatesCpmPod');
  const payRatesCpaPod = document.getElementById('payRatesCpaPod');
  const payRatesMinPod = document.getElementById('payRatesMinPod');
  const tier3RateLabel = document.getElementById('tier3RateLabel');
  const payRateCpaBoldText = document.getElementById('payRateCpaBoldText');

  // Screen 6: Reward Details Elements
  const rewardSummaryTotalDisplay = document.getElementById('rewardSummaryTotalDisplay');
  const rewardPlaysPodVal = document.getElementById('rewardPlaysPodVal');
  const rewardUsersPodVal = document.getElementById('rewardUsersPodVal');
  const rewardAvailPodVal = document.getElementById('rewardAvailPodVal');
  const rewardRecordsList = document.getElementById('rewardRecordsList');

  // Withdrawal Modal Elements
  const withdrawModal = document.getElementById('withdrawModal');
  const btnOpenWithdrawalModal = document.getElementById('btnOpenWithdrawalModal');
  const btnCloseWithdrawModal = document.getElementById('btnCloseWithdrawModal');
  const modalStepTitle = document.getElementById('modalStepTitle');
  const modalStepIndicator = document.getElementById('modalStepIndicator');
  const dotStep0 = document.getElementById('dotStep0');
  const dotStep1 = document.getElementById('dotStep1');
  const dotStep2 = document.getElementById('dotStep2');
  const lineStep01 = document.getElementById('lineStep01');
  const lineStep12 = document.getElementById('lineStep12');
  const modalStep0View = document.getElementById('modalStep0View');
  const modalStep1View = document.getElementById('modalStep1View');
  const modalStep2View = document.getElementById('modalStep2View');
  const btnStep0Continue = document.getElementById('btnStep0Continue');
  const btnStep1Back = document.getElementById('btnStep1Back');
  const btnStep1Continue = document.getElementById('btnStep1Continue');
  const btnStep2Back = document.getElementById('btnStep2Back');
  const btnStep2Submit = document.getElementById('btnStep2Submit');
  const modalStep1AvailBalance = document.getElementById('modalStep1AvailBalance');
  const modalStep1MinLimitTag = document.getElementById('modalStep1MinLimitTag');
  const inputWithdrawUsdAmount = document.getElementById('inputWithdrawUsdAmount');
  const presetMinBtn = document.getElementById('presetMinBtn');
  const preset50Btn = document.getElementById('preset50Btn');
  const presetMaxBtn = document.getElementById('presetMaxBtn');
  const inrEstimateHint = document.getElementById('inrEstimateHint');
  const lblDestinationAccount = document.getElementById('lblDestinationAccount');
  const networkBadgeTag = document.getElementById('networkBadgeTag');
  const inputDestinationAccount = document.getElementById('inputDestinationAccount');
  const accountInputHint = document.getElementById('accountInputHint');
  const modalStep1ErrorBox = document.getElementById('modalStep1ErrorBox');
  const modalStep2ErrorBox = document.getElementById('modalStep2ErrorBox');
  const reviewGatewayName = document.getElementById('reviewGatewayName');
  const reviewAmountUsd = document.getElementById('reviewAmountUsd');
  const reviewAmountInr = document.getElementById('reviewAmountInr');
  const reviewAccountDestination = document.getElementById('reviewAccountDestination');

  // Receipt Modal Elements
  const receiptModal = document.getElementById('receiptModal');
  const btnCloseReceiptModal = document.getElementById('btnCloseReceiptModal');
  const receiptAmountDisplay = document.getElementById('receiptAmountDisplay');
  const receiptStatusPill = document.getElementById('receiptStatusPill');
  const receiptTxnId = document.getElementById('receiptTxnId');
  const receiptMethod = document.getElementById('receiptMethod');
  const receiptAccount = document.getElementById('receiptAccount');
  const receiptRequestedDate = document.getElementById('receiptRequestedDate');
  const receiptSettledDate = document.getElementById('receiptSettledDate');

  // QR Modal Elements
  const qrModal = document.getElementById('qrModal');
  const qrHeading = document.getElementById('qrHeading');
  const btnCloseQrModal = document.getElementById('btnCloseQrModal');
  const qrCanvasContainer = document.getElementById('qrCanvasContainer');
  const qrTextValue = document.getElementById('qrTextValue');
  const btnCopyQrUrl = document.getElementById('btnCopyQrUrl');

  // ══════════════════════════════════════════════════════════
  // HELPER FORMATTERS & UTILITIES
  // ══════════════════════════════════════════════════════════
  function formatUsd(val, showPlus = false) {
    const num = parseFloat(val) || 0.0;
    const sign = showPlus && num > 0 ? '+' : '';
    return `${sign}$${num.toFixed(4)}`;
  }

  function formatShortUsd(val) {
    const num = parseFloat(val) || 0.0;
    return `$${num.toFixed(2)}`;
  }

  function formatDate(dStr) {
    if (!dStr) return 'Recent';
    try {
      const d = new Date(dStr);
      return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    } catch (_) {
      return dStr;
    }
  }

  function formatDateTime(dStr) {
    if (!dStr) return 'Recent';
    try {
      const d = new Date(dStr);
      return `${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })} at ${d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}`;
    } catch (_) {
      return dStr;
    }
  }

  function formatRelativeDate(dStr) {
    if (!dStr) return '1d ago';
    try {
      const d = new Date(dStr);
      const now = new Date();
      const diffMs = now - d;
      const diffSec = Math.floor(diffMs / 1000);
      const diffMin = Math.floor(diffSec / 60);
      const diffHours = Math.floor(diffMin / 60);
      const diffDays = Math.floor(diffHours / 24);

      if (diffDays > 30) {
        return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
      }
      if (diffDays > 0) return `${diffDays}d ago`;
      if (diffHours > 0) return `${diffHours}h ago`;
      if (diffMin > 0) return `${diffMin}m ago`;
      return 'Just now';
    } catch (_) {
      return '1d ago';
    }
  }

  function extractSharedFileName(link) {
    if (!link) return 'Monetized Shared File';
    if (link.fileName && link.fileName.trim()) return link.fileName.trim();
    if (link.originalUrl && link.originalUrl.trim()) {
      const raw = link.originalUrl.split('?')[0].split('/').pop();
      if (raw && /^\d+_/.test(raw)) {
        return decodeURIComponent(raw.replace(/^\d+_/, ''));
      }
      if (raw) return decodeURIComponent(raw);
    }
    return 'Monetized Shared File';
  }

  function getSharedFileExtension(fileName) {
    if (!fileName) return 'FILE';
    const parts = fileName.split('.');
    if (parts.length > 1) {
      return parts.pop().toUpperCase();
    }
    return 'FILE';
  }

  function isSharedVideoFile(fileName, originalUrl = '') {
    const lowerName = (fileName || '').toLowerCase();
    const lowerUrl = (originalUrl || '').toLowerCase();
    return lowerName.endsWith('.mp4') ||
      lowerName.endsWith('.mkv') ||
      lowerName.endsWith('.mov') ||
      lowerName.endsWith('.avi') ||
      lowerName.endsWith('.webm') ||
      lowerUrl.includes('.mp4') ||
      lowerUrl.includes('.mkv');
  }

  function formatSharedCount(count) {
    const num = parseInt(count, 10) || 0;
    if (num >= 1000000) return `${(num / 1000000).toFixed(1)}M`;
    if (num >= 1000) return `${(num / 1000).toFixed(1)}K`;
    return num.toString();
  }

  function launchSocialShare(url, fileName, platform) {
    if (!url) {
      showToast('No link available to share');
      return;
    }

    const platformName = platform === 'whatsapp' ? 'WhatsApp' : (platform === 'telegram' ? 'Telegram' : 'External App');
    const shareText = fileName
      ? `Watch and download "${fileName}" on TeraBox:\n${url}`
      : `Join TeraBox and get 1024 GB free cloud storage + rewards:\n${url}`;

    // 1. Always copy link to clipboard immediately with feedback toast
    copyToClipboard(url, `Link copied! Opening ${platformName}...`);

    let targetUri = '';
    if (platform === 'whatsapp') {
      targetUri = `https://api.whatsapp.com/send?text=${encodeURIComponent(shareText)}`;
    } else if (platform === 'telegram') {
      targetUri = `https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent(shareText)}`;
    }

    if (targetUri) {
      // 2. Flutter WebView Bridge
      if (window.TeraBoxWebBridge && typeof window.TeraBoxWebBridge.postMessage === 'function') {
        try {
          window.TeraBoxWebBridge.postMessage('openExternal:' + targetUri);
          return;
        } catch (_) { }
      }

      // 3. Web Share API fallback (if supported and mobile user interaction)
      if (navigator.share && typeof navigator.share === 'function') {
        try {
          navigator.share({
            title: fileName || 'TeraBox Monetized Link',
            text: shareText,
            url: url
          }).then(() => {
            // Share dialog opened
          }).catch((err) => {
            if (err && err.name !== 'AbortError') {
              openSafeExternalUrl(targetUri);
            }
          });
          return;
        } catch (_) { }
      }

      // 4. Safe non-navigating external anchor trigger
      openSafeExternalUrl(targetUri);
    }
  }

  function openSafeExternalUrl(targetUri) {
    if (!targetUri) return;
    try {
      const a = document.createElement('a');
      a.href = targetUri;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      a.style.display = 'none';
      document.body.appendChild(a);
      a.click();
      setTimeout(() => {
        if (document.body.contains(a)) {
          document.body.removeChild(a);
        }
      }, 350);
    } catch (_) {
      try {
        window.open(targetUri, '_blank', 'noopener,noreferrer');
      } catch (_) { }
    }
  }

  function getScreenFromHash() {
    const hash = (window.location.hash || '').replace(/^#\/?/, '').split('?')[0].trim();
    if (!hash) return null;
    const screenMap = {
      'dashboard': 'screen-dashboard',
      'shared-links': 'screen-shared-links',
      'referral-program': 'screen-referral-program',
      'withdrawal-history': 'screen-withdrawal-history',
      'pay-rates': 'screen-pay-rates',
      'reward-details': 'screen-reward-details',
      'terms-conditions': 'screen-terms-conditions',
      'community-guidelines': 'screen-community-guidelines',
      'program-rules': 'screen-program-rules',
      'connect-account': 'screen-connect-account',
      'disabled-program': 'screen-disabled-program'
    };
    return screenMap[hash] || (document.getElementById('screen-' + hash) ? 'screen-' + hash : (document.getElementById(hash) ? hash : null));
  }

  function handleAppBack() {
    const activeScreen = document.querySelector('.app-screen.active');
    const activeId = activeScreen ? activeScreen.id : 'screen-dashboard';

    if ((activeId === 'screen-terms-conditions' || activeId === 'screen-community-guidelines' || activeId === 'screen-program-rules') && (!currentProfile || !currentProfile.referralCode)) {
      navigateToScreen('screen-connect-account', true);
      return;
    }

    if (activeId !== 'screen-dashboard' && activeId !== 'screen-connect-account' && activeId !== 'screen-disabled-program') {
      if (window.history.length > 1) {
        window.history.back();
      } else {
        navigateToScreen('screen-dashboard', true);
      }
    } else {
      handleAppClose();
    }
  }

  function handleAppClose() {
    if (window.TeraBoxWebBridge && typeof window.TeraBoxWebBridge.postMessage === 'function') {
      try {
        window.TeraBoxWebBridge.postMessage('close');
        return;
      } catch (_) { }
    }
    if (window.history.length > 1) {
      window.history.back();
    } else {
      window.close();
    }
  }

  function showToast(message) {
    if (!toastContainer) return;
    const toast = document.createElement('div');
    toast.className = 'toast-bubble';
    toast.innerHTML = `
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#86EFAC" stroke-width="2.5"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg>
      <span>${message}</span>
    `;
    toastContainer.appendChild(toast);

    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(10px) scale(0.95)';
      toast.style.transition = 'all 0.22s ease';
      setTimeout(() => toast.remove(), 250);
    }, 2200);
  }

  function copyToClipboard(text, successMsg = 'Copied to clipboard!') {
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(text).then(() => {
        showToast(successMsg);
      }).catch(() => fallbackCopy(text, successMsg));
    } else {
      fallbackCopy(text, successMsg);
    }
  }

  function fallbackCopy(text, successMsg) {
    const tempInput = document.createElement('input');
    tempInput.value = text;
    tempInput.style.position = 'fixed';
    tempInput.style.opacity = '0';
    document.body.appendChild(tempInput);
    tempInput.focus();
    tempInput.select();
    try {
      document.execCommand('copy');
      showToast(successMsg);
    } catch (_) {
      showToast('Could not copy text');
    }
    document.body.removeChild(tempInput);
  }

  // ══════════════════════════════════════════════════════════
  // SCREEN NAVIGATION & DRAWER
  // ══════════════════════════════════════════════════════════
  function navigateToScreen(targetScreenId, updateHistory = true) {
    if (!targetScreenId) return;

    // Security Gate: Direct web access without TeraBox mobile app session or valid token must show lockout
    if (!isInApp && !ssoToken && targetScreenId !== 'screen-disabled-program') {
      targetScreenId = 'screen-unauthorized-access';
    } else if (targetScreenId === 'screen-unauthorized-access') {
      // Allow through
    } else if ((!currentProfile || !currentProfile.referralCode) && targetScreenId !== 'screen-connect-account' && targetScreenId !== 'screen-disabled-program' && targetScreenId !== 'screen-terms-conditions' && targetScreenId !== 'screen-community-guidelines' && targetScreenId !== 'screen-program-rules') {
      targetScreenId = 'screen-connect-account';
    }

    // Hide all screens
    document.querySelectorAll('.app-screen').forEach(s => s.classList.remove('active'));

    // Show target screen
    const target = document.getElementById(targetScreenId);
    if (target) {
      target.classList.add('active');
      if (navigationStack[navigationStack.length - 1] !== targetScreenId) {
        navigationStack.push(targetScreenId);
      }
    }

    // Synchronize Drawer active state
    document.querySelectorAll('.drawer-tile').forEach(tile => {
      tile.classList.toggle('active', tile.getAttribute('data-navigate') === targetScreenId);
    });

    // Synchronize Bottom Navigation Bar active state and visibility
    const bottomNav = document.getElementById('bottomNavigationBar');
    if (bottomNav) {
      const hideBottomNavScreens = ['screen-unauthorized-access', 'screen-connect-account', 'screen-disabled-program'];
      if (hideBottomNavScreens.includes(targetScreenId) || !currentProfile || !currentProfile.referralCode) {
        bottomNav.style.display = 'none';
      } else {
        bottomNav.style.display = 'block';
      }

      const screenToNavMap = {
        'screen-dashboard': 'screen-dashboard',
        'screen-shared-links': 'screen-shared-links',
        'screen-create-link': 'screen-shared-links',
        'screen-referral-program': 'screen-referral-program',
        'screen-referral-details': 'screen-referral-program',
        'screen-withdrawal-history': 'screen-withdrawal-history',
        'screen-reward-details': 'screen-withdrawal-history',
        'screen-pay-rates': 'screen-pay-rates',
        'screen-terms-conditions': 'screen-pay-rates',
        'screen-community-guidelines': 'screen-pay-rates',
        'screen-program-rules': 'screen-pay-rates'
      };
      const activeNavId = screenToNavMap[targetScreenId] || targetScreenId;

      document.querySelectorAll('.bottom-nav-item').forEach(item => {
        const itemTarget = item.getAttribute('data-navigate');
        item.classList.toggle('active', itemTarget === activeNavId);
      });
    }

    // Save active screen in session storage
    try {
      sessionStorage.setItem('tb_wm_active_screen', targetScreenId);
    } catch (_) { }

    // Update URL hash & HTML5 history
    const hashSlug = targetScreenId.replace(/^screen-/, '');
    if (updateHistory) {
      try {
        if (window.location.hash !== '#' + hashSlug) {
          window.history.pushState({ screen: targetScreenId }, '', '#' + hashSlug);
        }
      } catch (_) {
        window.location.hash = hashSlug;
      }
    }

    closeDrawer();
    window.scrollTo({ top: 0, behavior: 'auto' });
  }

  function openDrawer() {
    if (drawerOverlay) {
      drawerOverlay.style.display = 'flex';
      requestAnimationFrame(() => {
        drawerOverlay.classList.add('active');
      });
    }
  }

  function closeDrawer() {
    if (drawerOverlay) {
      drawerOverlay.classList.remove('active');
      setTimeout(() => {
        if (!drawerOverlay.classList.contains('active')) {
          drawerOverlay.style.display = 'none';
        }
      }, 280);
    }
  }

  // ══════════════════════════════════════════════════════════
  // INITIALIZATION & URL PARSING
  // ══════════════════════════════════════════════════════════
  function parseUrlParameters() {
    const fullUrl = window.location.href;
    const urlObj = new URL(fullUrl);
    const params = urlObj.searchParams;

    if (params.get('inApp') === 'true' || fullUrl.toLowerCase().includes('inapp=true') || fullUrl.toLowerCase().includes('isapp=true') || fullUrl.toLowerCase().includes('appmode=true')) {
      isInApp = true;
    }

    ssoToken = params.get('token') || params.get('ssoToken') || params.get('sso') || '';
    queryUserId = params.get('userId') || params.get('id') || '';
    queryEmail = params.get('email') || '';
    queryRef = params.get('ref') || params.get('referralCode') || params.get('code') || '';

    // Check fragment/hash as fallback
    if (window.location.hash && window.location.hash.includes('?')) {
      const hashParams = new URLSearchParams(window.location.hash.split('?')[1]);
      if (!ssoToken) ssoToken = hashParams.get('token') || '';
      if (!queryUserId) queryUserId = hashParams.get('userId') || '';
      if (!queryEmail) queryEmail = hashParams.get('email') || '';
      if (!queryRef) queryRef = hashParams.get('ref') || '';
      if (hashParams.get('inApp') === 'true' || hashParams.get('isApp') === 'true') isInApp = true;
    }

    // Only restore session credentials if explicitly running in inApp mode or with valid SSO token
    if (isInApp || ssoToken) {
      if (!ssoToken) ssoToken = sessionStorage.getItem('tb_wm_token') || localStorage.getItem('tb_wm_token') || '';
      if (!queryUserId) queryUserId = sessionStorage.getItem('tb_wm_userId') || localStorage.getItem('tb_wm_userId') || '';
      if (!queryEmail) queryEmail = sessionStorage.getItem('tb_wm_email') || localStorage.getItem('tb_wm_email') || '';
      if (!queryRef) queryRef = sessionStorage.getItem('tb_wm_ref') || localStorage.getItem('tb_wm_ref') || '';

      if (ssoToken) { try { sessionStorage.setItem('tb_wm_token', ssoToken); localStorage.setItem('tb_wm_token', ssoToken); } catch (_) { } }
      if (queryUserId) { try { sessionStorage.setItem('tb_wm_userId', queryUserId); localStorage.setItem('tb_wm_userId', queryUserId); } catch (_) { } }
      if (queryEmail) { try { sessionStorage.setItem('tb_wm_email', queryEmail); localStorage.setItem('tb_wm_email', queryEmail); } catch (_) { } }
      if (queryRef) { try { sessionStorage.setItem('tb_wm_ref', queryRef); localStorage.setItem('tb_wm_ref', queryRef); } catch (_) { } }
      if (isInApp) { try { sessionStorage.setItem('tb_wm_inApp', 'true'); } catch (_) { } }
    } else {
      // Clear any stale local credentials on direct web visits to enforce App Authentication Required
      try {
        sessionStorage.removeItem('tb_wm_token');
        sessionStorage.removeItem('tb_wm_userId');
        sessionStorage.removeItem('tb_wm_email');
        sessionStorage.removeItem('tb_wm_ref');
        sessionStorage.removeItem('tb_wm_inApp');
        sessionStorage.removeItem('tb_wm_active_screen');
        localStorage.removeItem('tb_wm_token');
        localStorage.removeItem('tb_wm_userId');
        localStorage.removeItem('tb_wm_email');
        localStorage.removeItem('tb_wm_ref');
      } catch (_) { }
    }
  }

  // ══════════════════════════════════════════════════════════
  // API INTEGRATION & DATA SYNC
  // ══════════════════════════════════════════════════════════
  async function fetchProgramStatus() {
    try {
      let res = await fetch('/api/webmaster/status');
      if (!res.ok) {
        res = await fetch('/api/webmaster/program-status');
      }
      if (res.ok) {
        const data = await res.json();
        if (data && typeof data === 'object') {
          adminConfig = Object.assign(adminConfig, data);
          applyAdminConfigUI();
        }
      }
    } catch (e) {
      console.warn('[Webmaster] Error fetching program status:', e);
    }
  }

  function applyAdminConfigUI() {
    // 1. Maintenance Mode / Disabled Program Scaffold
    if (adminConfig.enabled === false) {
      navigateToScreen('screen-disabled-program');
      const t = document.getElementById('disabledScaffoldTitle');
      const s = document.getElementById('disabledScaffoldSubtitle');
      const m = document.getElementById('disabledScaffoldMessage');
      if (t) t.textContent = adminConfig.title || 'Creator Program Upgrades in Progress';
      if (s) s.textContent = adminConfig.subtitle || 'Scheduled Maintenance';
      if (m) m.textContent = adminConfig.message || 'The Webmaster Monetization Center is currently undergoing scheduled platform upgrades.';
      return;
    }

    // 2. Dynamic CPA / CPM Rates across all screens in real-time
    const cpaFormatted = formatShortUsd(adminConfig.cpaRewardUsd);
    if (cpaRateText) cpaRateText.textContent = `+${cpaFormatted}`;
    if (metricCpaPill) metricCpaPill.textContent = `${cpaFormatted} CPA`;
    if (tfcCpaBadge) tfcCpaBadge.textContent = `${cpaFormatted} / User`;
    if (appbarRefRateText) appbarRefRateText.textContent = cpaFormatted;
    if (refHeroRate) refHeroRate.textContent = cpaFormatted;
    if (payRatesCpaPod) payRatesCpaPod.textContent = cpaFormatted;
    if (payRateCpaBoldText) payRateCpaBoldText.textContent = `${cpaFormatted} USD`;

    const refRewardRatePod = document.getElementById('refRewardRatePod');
    if (refRewardRatePod) refRewardRatePod.textContent = cpaFormatted;

    const enrollCpaRate = document.getElementById('enrollCpaRate');
    if (enrollCpaRate) enrollCpaRate.textContent = cpaFormatted;
    const enrollCpaDescRate = document.getElementById('enrollCpaDescRate');
    if (enrollCpaDescRate) enrollCpaDescRate.textContent = cpaFormatted;

    const refStepRateBonus = document.getElementById('refStepRateBonus');
    if (refStepRateBonus) refStepRateBonus.textContent = cpaFormatted;

    const payRateStep3Bonus = document.getElementById('payRateStep3Bonus');
    if (payRateStep3Bonus) payRateStep3Bonus.textContent = cpaFormatted;

    const drawerCpaBadge = document.getElementById('drawerCpaBadge');
    if (drawerCpaBadge) drawerCpaBadge.textContent = `+${cpaFormatted}`;

    const rulesRateText = document.getElementById('rulesRateText');
    if (rulesRateText) rulesRateText.textContent = `${cpaFormatted} USD`;

    const rulesModalRewardRateTitle = document.getElementById('rulesModalRewardRateTitle');
    if (rulesModalRewardRateTitle) rulesModalRewardRateTitle.textContent = `Reward Rate: ${cpaFormatted} USD / Friend`;

    const rulesModalRewardRateDesc = document.getElementById('rulesModalRewardRateDesc');
    if (rulesModalRewardRateDesc) rulesModalRewardRateDesc.textContent = `You get ${cpaFormatted} every time a friend installs the app and performs an initial activity.`;

    const rncCpaText = document.getElementById('rncCpaText');
    if (rncCpaText) rncCpaText.textContent = cpaFormatted;

    // CPM Rates (Single Flat Global Rate worldwide)
    const cpmFormatted = formatShortUsd(adminConfig.cpmRateUsd);
    if (metricCpmPill) metricCpmPill.textContent = `${cpmFormatted} CPM`;
    if (payRatesCpmPod) payRatesCpmPod.textContent = cpmFormatted;
    const globalCpmRateText = document.getElementById('globalCpmRateText');
    if (globalCpmRateText) globalCpmRateText.textContent = cpmFormatted;

    const enrollCpmRate = document.getElementById('enrollCpmRate');
    if (enrollCpmRate) enrollCpmRate.textContent = cpmFormatted;
    const enrollCpmDescRate = document.getElementById('enrollCpmDescRate');
    if (enrollCpmDescRate) enrollCpmDescRate.textContent = cpmFormatted;

    const rncCpmText = document.getElementById('rncCpmText');
    if (rncCpmText) rncCpmText.textContent = cpmFormatted;

    // Minimum Withdrawal limits
    const minWithdrawalFormatted = formatShortUsd(adminConfig.minWithdrawalUsd);
    if (refMinPayoutPod) refMinPayoutPod.textContent = minWithdrawalFormatted;
    if (payRatesMinPod) payRatesMinPod.textContent = minWithdrawalFormatted;
    if (modalStep1MinLimitTag) modalStep1MinLimitTag.textContent = `Min: ${minWithdrawalFormatted}`;
    if (presetMinBtn) presetMinBtn.textContent = `Min ${Math.floor(adminConfig.minWithdrawalUsd || 1.0)}`;

    const enrollMinPayoutText = document.getElementById('enrollMinPayoutText');
    if (enrollMinPayoutText) enrollMinPayoutText.textContent = `${minWithdrawalFormatted} USD`;

    const enrollMinWithdrawalText = document.getElementById('enrollMinWithdrawalText');
    if (enrollMinWithdrawalText) enrollMinWithdrawalText.textContent = minWithdrawalFormatted;

    const termsMinUsd = document.getElementById('termsMinUsd');
    if (termsMinUsd) termsMinUsd.textContent = `${minWithdrawalFormatted} USD`;

    const payRatesMinPolicyText = document.getElementById('payRatesMinPolicyText');
    if (payRatesMinPolicyText) payRatesMinPolicyText.textContent = `${minWithdrawalFormatted} USD`;
  }

  async function fetchWebmasterProfile() {
    if (adminConfig.enabled === false) return;

    try {
      if (!ssoToken && !queryUserId && !queryEmail && !queryRef) {
        currentProfile = null;
        navigateToScreen('screen-unauthorized-access');
        if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
        return;
      }

      let endpoint = '/api/webmaster/profile?';
      const q = [];
      if (ssoToken) q.push(`token=${encodeURIComponent(ssoToken)}`);
      if (queryUserId) q.push(`userId=${encodeURIComponent(queryUserId)}`);
      if (queryEmail) q.push(`email=${encodeURIComponent(queryEmail)}`);
      if (queryRef) q.push(`referralCode=${encodeURIComponent(queryRef)}`);
      if (isInApp) q.push('inApp=true');

      endpoint += q.join('&');

      const headers = {};
      if (ssoToken) {
        headers['Authorization'] = `Bearer ${ssoToken}`;
        headers['X-App-Token'] = ssoToken;
      }
      if (queryUserId) headers['X-User-Id'] = queryUserId;
      if (queryEmail) headers['X-User-Email'] = queryEmail;

      const res = await fetch(endpoint, { headers });

      if (res.status === 401 || res.status === 403) {
        currentProfile = null;
        navigateToScreen('screen-unauthorized-access');
        if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
        return;
      }

      if (res.ok) {
        const data = await res.json();
        if (data && data.requiresAppAuth) {
          currentProfile = null;
          navigateToScreen('screen-unauthorized-access');
          return;
        }
        if (data && data.isEnrolled === false) {
          currentProfile = null;
          navigateToScreen('screen-connect-account');
        } else if (data && (data.profile || data.referralCode)) {
          currentProfile = data.profile || data;
          if (!currentProfile.referralCode) {
            currentProfile = null;
            navigateToScreen('screen-connect-account');
          } else {
            renderAllScreens();
            await fetchWebmasterReferralsData();
            // Restore active screen from hash or session storage on refresh
            const curScreen = document.querySelector('.app-screen.active');
            if (!curScreen || curScreen.id === 'screen-connect-account' || curScreen.id === 'screen-unauthorized-access') {
              let restoreScreen = getScreenFromHash() || sessionStorage.getItem('tb_wm_active_screen') || 'screen-dashboard';
              if (restoreScreen === 'screen-connect-account' || restoreScreen === 'screen-unauthorized-access') restoreScreen = 'screen-dashboard';
              navigateToScreen(restoreScreen, false);
            }
          }
        } else {
          currentProfile = null;
          navigateToScreen('screen-connect-account');
        }
      } else {
        currentProfile = null;
        navigateToScreen('screen-unauthorized-access');
      }
    } catch (err) {
      console.warn('[Webmaster] Error fetching profile:', err);
      currentProfile = null;
      navigateToScreen('screen-unauthorized-access');
    } finally {
      if (loadingOverlay) {
        loadingOverlay.style.opacity = '0';
        setTimeout(() => { loadingOverlay.style.display = 'none'; }, 200);
      }
      document.body.classList.remove('loading-state');
    }
  }

  async function fetchWebmasterReferralsData(showToastFeedback = false) {
    const ref = currentProfile ? currentProfile.referralCode : queryRef;
    const userId = currentProfile ? currentProfile.userId : queryUserId;
    const email = currentProfile ? currentProfile.email : queryEmail;
    const targetId = ref || userId || email;

    if (!targetId) return;

    try {
      const q = [];
      if (ssoToken) q.push(`token=${encodeURIComponent(ssoToken)}`);
      if (targetId) q.push(`refCode=${encodeURIComponent(targetId)}`);
      if (userId) q.push(`userId=${encodeURIComponent(userId)}`);
      if (email) q.push(`email=${encodeURIComponent(email)}`);

      const headers = {};
      if (ssoToken) {
        headers['Authorization'] = `Bearer ${ssoToken}`;
        headers['X-App-Token'] = ssoToken;
      }
      if (userId) headers['X-User-Id'] = userId;
      if (email) headers['X-User-Email'] = email;

      const res = await fetch(`/api/webmaster/referrals?${q.join('&')}`, { headers });
      if (res.status === 401 || res.status === 403) {
        return;
      }
      if (res.ok) {
        const data = await res.json();
        if (data && data.success) {
          referralLedgerData = data;

          // 1. Dynamic live rates
          const liveCpaRate = (adminConfig.cpaRewardUsd > 0) ? adminConfig.cpaRewardUsd : (data.ratePerUserUsd || 0.05);
          const cpaRateFormatted = `$${liveCpaRate.toFixed(2)}`;
          const minPayoutFormatted = `$${(adminConfig.minWithdrawalUsd || 1.0).toFixed(2)}`;

          if (appbarRefRateText) appbarRefRateText.textContent = cpaRateFormatted;
          if (refHeroRate) refHeroRate.textContent = cpaRateFormatted;
          const refRewardRatePod = document.getElementById('refRewardRatePod');
          if (refRewardRatePod) refRewardRatePod.textContent = cpaRateFormatted;
          const refStepRateBonus = document.getElementById('refStepRateBonus');
          if (refStepRateBonus) refStepRateBonus.textContent = cpaRateFormatted;
          const payRateStep3Bonus = document.getElementById('payRateStep3Bonus');
          if (payRateStep3Bonus) payRateStep3Bonus.textContent = cpaRateFormatted;
          const drawerCpaBadge = document.getElementById('drawerCpaBadge');
          if (drawerCpaBadge) drawerCpaBadge.textContent = `+${cpaRateFormatted}`;
          const rulesRateText = document.getElementById('rulesRateText');
          if (rulesRateText) rulesRateText.textContent = `${cpaRateFormatted} USD`;

          const rulesModalRewardRateTitle = document.getElementById('rulesModalRewardRateTitle');
          if (rulesModalRewardRateTitle) rulesModalRewardRateTitle.textContent = `Reward Rate: ${cpaRateFormatted} USD / Friend`;
          const rulesModalRewardRateDesc = document.getElementById('rulesModalRewardRateDesc');
          if (rulesModalRewardRateDesc) rulesModalRewardRateDesc.textContent = `You get ${cpaRateFormatted} every time a friend installs the app and performs an initial activity.`;

          // 2. Overview Card Details
          const refCode = data.referralCode || ref || 'TBX5367';
          if (cardRefCodeBadge) cardRefCodeBadge.textContent = `Code: ${refCode}`;
          const cardRefBadgeContainer2 = document.getElementById('cardRefBadgeContainer2');
          if (cardRefBadgeContainer2) {
            cardRefBadgeContainer2.onclick = () => copyToClipboard(refCode, 'Invite code copied!');
          }

          const summary = data.summary || {};
          const totalEarnedUsd = summary.totalEarningsUsd || 0.0;
          if (refTotalEarnedPod) refTotalEarnedPod.textContent = formatShortUsd(totalEarnedUsd);
          if (refMinPayoutPod) refMinPayoutPod.textContent = minPayoutFormatted;

          // 3. Funnel 4 Quad Metrics
          if (funnelTotalClicks) funnelTotalClicks.textContent = (summary.totalClicks || 0).toLocaleString();
          if (funnelTotalInstalls) funnelTotalInstalls.textContent = (summary.totalInstalls || 0).toLocaleString();
          if (funnelPending) funnelPending.textContent = (summary.pendingCount || 0).toLocaleString();
          if (funnelQualified) funnelQualified.textContent = (summary.qualifiedCount || 0).toLocaleString();

          // 4. Play Store Direct Invite Link
          const playInviteUrl = data.invitePlayUrl || `https://play.google.com/store/apps/details?id=com.teracloud.app.terabox_client&referrer=ref%3D${encodeURIComponent(refCode)}`;
          if (refInviteUrlInput) refInviteUrlInput.value = playInviteUrl;

          // 5. Filter tab counts
          const allList = data.referrals || [];
          const qualifiedCount = allList.filter(i => (i.status || '').toUpperCase() === 'QUALIFIED').length;
          const pendingCount = allList.filter(i => (i.status || '').toUpperCase() === 'PENDING').length;
          const rejectedCount = allList.filter(i => {
            const st = (i.status || '').toUpperCase();
            return st === 'REJECTED' || st === 'EXPIRED';
          }).length;

          const referralsTotalCountTag = document.getElementById('referralsTotalCountTag');
          if (referralsTotalCountTag) referralsTotalCountTag.textContent = `${allList.length} Total`;

          const refCountAll = document.getElementById('refCountAll');
          if (refCountAll) refCountAll.textContent = allList.length;
          const refCountQualified = document.getElementById('refCountQualified');
          if (refCountQualified) refCountQualified.textContent = qualifiedCount;
          const refCountPending = document.getElementById('refCountPending');
          if (refCountPending) refCountPending.textContent = pendingCount;
          const refCountRejected = document.getElementById('refCountRejected');
          if (refCountRejected) refCountRejected.textContent = rejectedCount;

          renderReferralsActivityList(activeRefFilter);

          if (showToastFeedback) {
            showToast('Referral ledger refreshed!');
          }
        }
      }
    } catch (err) {
      console.warn('[Webmaster] Error fetching referrals ledger:', err);
    }
  }

  async function handleJoinProgram() {
    const chk = document.getElementById('chkEnrollAgreed');
    if (chk && !chk.checked) {
      showToast('Please accept the Terms and Conditions to proceed.');
      return;
    }

    const btn = document.getElementById('btnHandleEnrollNow') || document.getElementById('btnJoinWebmasterProgram');
    if (btn) {
      btn.disabled = true;
      btn.innerHTML = '<span class="loader-ring" style="width:16px;height:16px;border-width:2px;display:inline-block;vertical-align:middle;margin:0 8px 0 0;"></span> Enrolling Now...';
    }

    try {
      const targetUser = queryUserId || queryEmail || 'creator_' + Math.floor(1000 + Math.random() * 9000);
      const res = await fetch('/api/webmaster/enroll', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${ssoToken}`,
          'X-App-Token': ssoToken
        },
        body: JSON.stringify({
          token: ssoToken,
          userId: targetUser,
          email: queryEmail || (targetUser.includes('@') ? targetUser : ''),
          plan: 'videoPlays'
        })
      });

      const data = await res.json();
      if (res.ok && data.success && data.profile) {
        currentProfile = data.profile;
        showToast('Successfully Enrolled in TeraBox Webmaster Program!');
        renderAllScreens();
        navigateToScreen('screen-dashboard');
      } else {
        showToast(data.error || 'Enrollment failed. Please try again.');
      }
    } catch (err) {
      showToast('Enrollment error. Please check network connection.');
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" style="margin-right: 8px;"><path d="M10 13a5 5 0 0 0 7.54-.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path></svg> <span>Enroll Now & Generate Referral Link</span>';
      }
    }
  }

  // ══════════════════════════════════════════════════════════
  // RENDER ALL SCREENS WITH FLUTTER FIDELITY
  // ══════════════════════════════════════════════════════════
  function renderAllScreens() {
    if (!currentProfile) return;

    const ref = currentProfile.referralCode || 'TBX5367';
    const email = currentProfile.email || queryEmail || 'Creator';
    const balance = currentProfile.walletBalanceUsd || 0.0;
    const todayEarn = currentProfile.todayEarnings || 0.0;
    const totalPaid = currentProfile.totalWithdrawnUsd || 0.0;
    const sharedLinks = currentProfile.sharedLinks || [];
    const withdrawals = currentProfile.withdrawals || [];
    const earningRecords = currentProfile.earningRecords || [];
    const referralProg = currentProfile.referralProgram || {};

    // 1. Drawer User Card
    if (drawerUserEmail) drawerUserEmail.textContent = email;
    if (drawerUserRef) drawerUserRef.textContent = `Ref: ${ref}`;

    // 2. Screen 1: Dashboard Overview
    if (overviewBalanceDisplay) overviewBalanceDisplay.textContent = formatUsd(balance);
    if (overviewTodayEarned) overviewTodayEarned.textContent = `Today: ${formatUsd(todayEarn, true)}`;
    if (tfcLinksCountBadge) tfcLinksCountBadge.textContent = `${sharedLinks.length} Links`;
    updateDashboardMetrics();
    // 3. Screen 2: Shared Links
    if (linksTotalCountDisplay) linksTotalCountDisplay.textContent = `${sharedLinks.length} Active Links`;
    let totalPlays = 0;
    let totalClicks = 0;
    let totalGrossEarned = 0.0;
    sharedLinks.forEach(l => {
      totalPlays += (l.videoPlays || 0);
      totalClicks += (l.clicks || 0);
      totalGrossEarned += (l.earningsUsd || 0);
    });
    if (linksTotalPlaysVal) linksTotalPlaysVal.textContent = totalPlays.toLocaleString();
    if (linksTotalClicksVal) linksTotalClicksVal.textContent = totalClicks.toLocaleString();
    if (linksTotalEarnedVal) linksTotalEarnedVal.textContent = formatShortUsd(totalGrossEarned);
    renderSharedLinksList();

    // 4. Screen 3: Referral Program (Exact Flutter Spec & Real-time Rates)
    const liveCpa = (adminConfig.cpaRewardUsd > 0) ? adminConfig.cpaRewardUsd : 0.05;
    const playInvite = `https://play.google.com/store/apps/details?id=com.teracloud.app.terabox_client&referrer=ref%3D${encodeURIComponent(ref)}`;
    if (cardRefCodeBadge) cardRefCodeBadge.textContent = `Code: ${ref}`;
    if (refCodePod) refCodePod.textContent = ref;
    const totalRefEarned = referralProg.totalEarnedUsd || 0.0;
    if (refTotalEarnedPod) refTotalEarnedPod.textContent = formatShortUsd(totalRefEarned);
    const refRewardRatePod = document.getElementById('refRewardRatePod');
    if (refRewardRatePod) refRewardRatePod.textContent = formatShortUsd(liveCpa);
    if (refMinPayoutPod) refMinPayoutPod.textContent = formatShortUsd(adminConfig.minWithdrawalUsd || 1.0);
    if (funnelTotalClicks) funnelTotalClicks.textContent = (referralProg.totalClicks || 0).toLocaleString();
    if (funnelTotalInstalls) funnelTotalInstalls.textContent = (referralProg.totalInstalls || 0).toLocaleString();
    if (funnelPending) funnelPending.textContent = (referralProg.pendingReferrals || 0).toLocaleString();
    if (funnelQualified) funnelQualified.textContent = (referralProg.qualifiedReferrals || 0).toLocaleString();
    if (refInviteUrlInput) refInviteUrlInput.value = playInvite;
    renderReferralsActivityList(activeRefFilter);

    // 5. Screen 4: Withdrawal History
    if (vaultTotalPaidDisplay) vaultTotalPaidDisplay.textContent = formatShortUsd(totalPaid);
    if (vaultPaidOutVal) vaultPaidOutVal.textContent = formatShortUsd(totalPaid);
    if (vaultAvailableVal) vaultAvailableVal.textContent = formatUsd(balance);

    let pendingSum = 0;
    let paidCount = 0;
    let pendingCount = 0;
    let rejectedCount = 0;

    withdrawals.forEach(w => {
      const st = (w.status || '').toLowerCase();
      if (st === 'paid' || st === 'approved' || st === 'success') {
        paidCount++;
      } else if (st === 'pending') {
        pendingCount++;
        pendingSum += (w.amountUsd || 0);
      } else if (st === 'rejected' || st === 'cancelled') {
        rejectedCount++;
      }
    });

    if (vaultInReviewVal) vaultInReviewVal.textContent = formatShortUsd(pendingSum);
    if (countAllSettlements) countAllSettlements.textContent = withdrawals.length;
    if (countPaidSettlements) countPaidSettlements.textContent = paidCount;
    if (countPendingSettlements) countPendingSettlements.textContent = pendingCount;
    if (countRejectedSettlements) countRejectedSettlements.textContent = rejectedCount;
    renderWithdrawalCardsList();

    // 6. Screen 6: Reward Details
    const totalEarningsAll = currentProfile.totalEarningsUsd || (balance + totalPaid);
    if (rewardSummaryTotalDisplay) rewardSummaryTotalDisplay.textContent = `${formatUsd(totalEarningsAll)} USD`;
    if (rewardAvailPodVal) rewardAvailPodVal.textContent = formatUsd(balance);
    renderRewardRecordsList();
  }

  function updateDashboardMetrics() {
    if (!currentProfile) return;

    let clicks = 0;
    let plays = 0;
    let newUsers = 0;
    let income = 0.0;

    const statsList = currentProfile.stats || [];
    const sharedLinks = currentProfile.sharedLinks || [];
    const sumLinkClicks = sharedLinks.reduce((acc, l) => acc + (l.clicks || 0), 0);
    const sumLinkPlays = sharedLinks.reduce((acc, l) => acc + (l.videoPlays || 0), 0);
    const sumLinkEarnings = sharedLinks.reduce((acc, l) => acc + (l.earningsUsd || 0), 0);

    if (activePeriod === '24h') {
      const todayStr = new Date().toISOString().substring(0, 10);
      const todayStat = statsList.find(s => s && s.date === todayStr);
      if (todayStat) {
        clicks = todayStat.clicks || todayStat.linkClicks || 0;
        plays = todayStat.videoPlays || 0;
        newUsers = todayStat.newUsers || 0;
        income = todayStat.earningsUsd || todayStat.estimatedIncomeUsd || 0.0;
      } else {
        clicks = 0;
        plays = 0;
        newUsers = 0;
        income = 0.0;
      }
    } else {
      // 'all' period: Exact aggregate matching Screen 2 and wallet
      clicks = Math.max(currentProfile.totalClicks || 0, sumLinkClicks);
      plays = Math.max(currentProfile.totalVideoPlays || 0, sumLinkPlays);
      newUsers = (currentProfile.referralProgram && currentProfile.referralProgram.qualifiedReferrals) || 0;
      income = currentProfile.walletBalanceUsd || sumLinkEarnings || 0.0;
    }

    if (metricLinkClicks) metricLinkClicks.textContent = clicks.toLocaleString();
    if (metricVideoPlays) metricVideoPlays.textContent = plays.toLocaleString();
    if (metricNewUsers) metricNewUsers.textContent = newUsers.toLocaleString();
    if (metricEstimatedIncome) metricEstimatedIncome.textContent = formatUsd(income);
  }

  // ══════════════════════════════════════════════════════════
  // SHARED LINKS RENDERING (Screen 2 - Full Flutter Parity)
  // ══════════════════════════════════════════════════════════
  function renderSharedLinksList() {
    if (!sharedLinksListContainer) return;

    const rawLinks = (currentProfile && currentProfile.sharedLinks) || [];
    const refCode = (currentProfile && currentProfile.referralCode) || queryRef || 'TBX5367';

    // 1. Deduplicate shared links matching Flutter logic
    const allDeduplicatedLinks = [];
    const seen = new Set();
    for (const l of rawLinks) {
      const fName = extractSharedFileName(l);
      const key = l.originalUrl ? l.originalUrl : (fName || l.id || l._id);
      const idKey = l.id || l._id;
      if (!seen.has(key) && (!idKey || !seen.has(idKey))) {
        seen.add(key);
        if (idKey) seen.add(idKey);
        allDeduplicatedLinks.push(l);
      }
    }

    // 2. Compute Aggregate Metrics
    let aggregateClicks = 0;
    let aggregatePlays = 0;
    let aggregateNewUsers = 0;
    let aggregateEarnings = 0.0;
    for (const l of allDeduplicatedLinks) {
      aggregateClicks += (l.clickCount || l.clicks || 0);
      aggregatePlays += (l.videoPlays || l.plays || 0);
      aggregateNewUsers += (l.newUsersFromLink || l.newUsers || 0);
      aggregateEarnings += (l.earningsFromLink || l.earningsUsd || 0.0);
    }

    // 3. Primary Default Direct Share Link for the creator
    const defaultShareUrl = allDeduplicatedLinks.length > 0
      ? (allDeduplicatedLinks[0].monetizedUrl || allDeduplicatedLinks[0].shareUrl || `https://terabox.mywire.org/share/${refCode}`)
      : `https://terabox.mywire.org/share/${refCode}`;

    // Update Executive Overview & Direct Link Cards
    const cardRefCodeText = document.getElementById('cardRefCodeText');
    if (cardRefCodeText) cardRefCodeText.textContent = `Code: ${refCode}`;
    if (linksTotalEarnedVal) linksTotalEarnedVal.textContent = formatShortUsd(aggregateEarnings);
    if (linksTotalCountDisplay) linksTotalCountDisplay.textContent = allDeduplicatedLinks.length.toString();
    if (linksTotalPlaysVal) linksTotalPlaysVal.textContent = formatSharedCount(aggregatePlays);

    const sharedClicksMetric = document.getElementById('sharedClicksMetric');
    const sharedPlaysMetric = document.getElementById('sharedPlaysMetric');
    const sharedUsersMetric = document.getElementById('sharedUsersMetric');
    const sharedEarningsMetric = document.getElementById('sharedEarningsMetric');
    if (sharedClicksMetric) sharedClicksMetric.textContent = formatSharedCount(aggregateClicks);
    if (sharedPlaysMetric) sharedPlaysMetric.textContent = formatSharedCount(aggregatePlays);
    if (sharedUsersMetric) sharedUsersMetric.textContent = aggregateNewUsers.toString();
    if (sharedEarningsMetric) sharedEarningsMetric.textContent = formatShortUsd(aggregateEarnings);

    const sharedDefaultUrlInput = document.getElementById('sharedDefaultUrlInput');
    if (sharedDefaultUrlInput) sharedDefaultUrlInput.value = defaultShareUrl;

    // Filter chip counts
    const videoCount = allDeduplicatedLinks.filter(l => isSharedVideoFile(extractSharedFileName(l), l.originalUrl)).length;
    const filesCount = allDeduplicatedLinks.length - videoCount;

    const activityTotalLinksBadge = document.getElementById('activityTotalLinksBadge');
    if (activityTotalLinksBadge) activityTotalLinksBadge.textContent = `${allDeduplicatedLinks.length} Total`;
    const filterAllCount = document.getElementById('filterAllCount');
    if (filterAllCount) filterAllCount.textContent = allDeduplicatedLinks.length.toString();
    const filterVideosCount = document.getElementById('filterVideosCount');
    if (filterVideosCount) filterVideosCount.textContent = videoCount.toString();
    const filterFilesCount = document.getElementById('filterFilesCount');
    if (filterFilesCount) filterFilesCount.textContent = filesCount.toString();

    // 4. Filter (Filter chips + Instant Search Query)
    let displayedLinks = allDeduplicatedLinks.filter(l => {
      const fName = extractSharedFileName(l);
      const isVid = isSharedVideoFile(fName, l.originalUrl);

      if (sharedSearchQuery) {
        const nameMatch = (fName || '').toLowerCase().includes(sharedSearchQuery);
        const urlMatch = (l.originalUrl || '').toLowerCase().includes(sharedSearchQuery) || (l.monetizedUrl || '').toLowerCase().includes(sharedSearchQuery) || (l.shareUrl || '').toLowerCase().includes(sharedSearchQuery);
        const idMatch = (l.id || l._id || '').toLowerCase().includes(sharedSearchQuery);
        if (!nameMatch && !urlMatch && !idMatch) return false;
      }

      if (selectedLinkFilter === 1 && !isVid) return false;
      if (selectedLinkFilter === 2 && isVid) return false;

      return true;
    });

    // 5. Sort
    if (selectedLinkSort === 0) {
      displayedLinks.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
    } else if (selectedLinkSort === 1) {
      displayedLinks.sort((a, b) => (b.earningsFromLink || b.earningsUsd || 0) - (a.earningsFromLink || a.earningsUsd || 0));
    } else if (selectedLinkSort === 2) {
      displayedLinks.sort((a, b) => (b.videoPlays || b.plays || 0) - (a.videoPlays || a.plays || 0));
    } else if (selectedLinkSort === 3) {
      displayedLinks.sort((a, b) => (b.clickCount || b.clicks || 0) - (a.clickCount || a.clicks || 0));
    }

    // 6. Render Cards (Exact 4-Row Flutter _buildReferralStyleLinkCard)
    if (displayedLinks.length === 0) {
      sharedLinksListContainer.innerHTML = `
        <div style="text-align: center; padding: 36px 16px; color: var(--text-muted);">
          <div style="width: 48px; height: 48px; border-radius: 50%; background: #F1F5F9; display: flex; align-items: center; justify-content: center; margin: 0 auto 10px;">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#94A3B8" stroke-width="2"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path></svg>
          </div>
          <div style="font-size: 13px; font-weight: 700; color: var(--text-dark); margin-bottom: 4px;">
            ${sharedSearchQuery ? 'No matching shared links found' : 'No Monetized Links Created Yet'}
          </div>
          <div style="font-size: 11px; color: var(--text-muted); max-width: 280px; margin: 0 auto; line-height: 1.4;">
            ${sharedSearchQuery ? 'Try searching for a different file name or URL.' : 'Share videos and files from your storage to generate monetized links!'}
          </div>
        </div>
      `;
      return;
    }

    sharedLinksListContainer.innerHTML = displayedLinks.map(l => {
      const fileName = extractSharedFileName(l);
      const isVideo = isSharedVideoFile(fileName, l.originalUrl);
      const ext = getSharedFileExtension(fileName);
      const dateLabel = formatRelativeDate(l.createdAt);
      const monetizedUrl = l.monetizedUrl || l.shareUrl || `https://terabox.mywire.org/s/${l.shortCode || refCode}`;
      const clicks = formatSharedCount(l.clickCount || l.clicks || 0);
      const plays = formatSharedCount(l.videoPlays || l.plays || 0);
      const users = (l.newUsersFromLink || l.newUsers || 0).toString();
      const earned = formatShortUsd(l.earningsFromLink || l.earningsUsd || 0.0);
      const escapedFileName = fileName.replace(/'/g, "\\'");
      const escapedUrl = monetizedUrl.replace(/'/g, "\\'");

      return `
        <div class="referral-style-link-card">
          <!-- Row 1: File Header + Ext + Monetized Badge -->
          <div class="rslc-header">
            <div class="rslc-icon-squircle ${isVideo ? 'video' : 'file'}">
              ${isVideo
          ? '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polygon points="6 4 20 12 6 20 6 4"></polygon></svg>'
          : '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line></svg>'
        }
            </div>
            <div class="rslc-name-col">
              <div class="rslc-title-row">
                <span class="rslc-file-name" title="${fileName}">${fileName}</span>
                <span class="rslc-ext-pill">${ext}</span>
              </div>
              <span class="rslc-date-text">${dateLabel}</span>
            </div>
            <div class="rslc-monetized-badge">
              <span class="rslc-dot-green"></span>
              <span class="rslc-monetized-text">Monetized</span>
            </div>
          </div>

          <!-- Row 2: Monetized URL Field + Copy Button -->
          <div class="rslc-url-row">
            <div class="rslc-url-left">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#0066FF" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0;">
                <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path>
                <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path>
              </svg>
              <span class="rslc-url-text">${monetizedUrl}</span>
            </div>
            <button class="rslc-copy-btn" onclick="window.webmasterFlutter.copyLink('${escapedUrl}', 'Monetized link copied!')">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
              </svg>
              <span>Copy</span>
            </button>
          </div>

          <!-- Row 3: 4 Metric Pods (Clicks, Plays, Users, Earned) -->
          <div class="rslc-metrics-quad">
            <div class="rslc-metric-pod">
              <span class="rslc-pod-lbl">CLICKS</span>
              <span class="rslc-pod-val clicks">${clicks}</span>
            </div>
            <div class="rslc-metric-pod">
              <span class="rslc-pod-lbl">PLAYS</span>
              <span class="rslc-pod-val plays">${plays}</span>
            </div>
            <div class="rslc-metric-pod">
              <span class="rslc-pod-lbl">USERS</span>
              <span class="rslc-pod-val users">${users}</span>
            </div>
            <div class="rslc-metric-pod">
              <span class="rslc-pod-lbl">EARNED</span>
              <span class="rslc-pod-val earned">${earned}</span>
            </div>
          </div>

          <!-- Row 4: Action Buttons (WhatsApp, Telegram, QR) -->
          <div class="rslc-actions-row">
            <button class="rslc-btn-social whatsapp" onclick="window.webmasterFlutter.shareSocial('${escapedUrl}', '${escapedFileName}', 'whatsapp')">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"></path>
              </svg>
              <span>WhatsApp</span>
            </button>
            <button class="rslc-btn-social telegram" onclick="window.webmasterFlutter.shareSocial('${escapedUrl}', '${escapedFileName}', 'telegram')">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                <line x1="22" y1="2" x2="11" y2="13"></line>
                <polygon points="22 2 15 22 11 13 2 9 22 2"></polygon>
              </svg>
              <span>Telegram</span>
            </button>
            <button class="rslc-btn-action qr" title="Scan QR Code" onclick="window.webmasterFlutter.showQrModal('${escapedUrl}', '${escapedFileName}')">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                <rect x="3" y="3" width="7" height="7" rx="1.5"></rect>
                <rect x="14" y="3" width="7" height="7" rx="1.5"></rect>
                <rect x="14" y="14" width="7" height="7" rx="1.5"></rect>
                <rect x="3" y="14" width="7" height="7" rx="1.5"></rect>
              </svg>
            </button>
          </div>
        </div>
      `;
    }).join('');
  }

  // ══════════════════════════════════════════════════════════
  // REFERRALS ACTIVITY (Screen 3 - Exact Flutter Ledger Parity)
  // ══════════════════════════════════════════════════════════
  function renderReferralsActivityList(statusFilter = 'all') {
    if (!referralsActivityContainer) return;
    activeRefFilter = statusFilter;

    const allList = (referralLedgerData && referralLedgerData.referrals) || [];
    const liveCpaRate = (adminConfig.cpaRewardUsd > 0) ? adminConfig.cpaRewardUsd : ((referralLedgerData && referralLedgerData.ratePerUserUsd) || 0.05);
    const refCode = (referralLedgerData && referralLedgerData.referralCode) || (currentProfile && currentProfile.referralCode) || 'TBX5367';
    const playUrl = (referralLedgerData && referralLedgerData.invitePlayUrl) || `https://play.google.com/store/apps/details?id=com.teracloud.app.terabox_client&referrer=ref%3D${encodeURIComponent(refCode)}`;

    const filtered = allList.filter(item => {
      const st = (item.status || '').toUpperCase();
      if (statusFilter === 'qualified') return st === 'QUALIFIED';
      if (statusFilter === 'pending') return st === 'PENDING';
      if (statusFilter === 'rejected') return st === 'REJECTED' || st === 'EXPIRED';
      return true;
    });

    if (filtered.length === 0) {
      referralsActivityContainer.innerHTML = `
        <div class="referral-empty-box">
          <div class="reb-icon-circle">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#0066FF" stroke-width="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><path d="M23 21v-2a4 4 0 0 0-3-3.87"></path><path d="M16 3.13a4 4 0 0 1 0 7.75"></path></svg>
          </div>
          <h4 class="reb-title">No Referrals Yet</h4>
          <p class="reb-desc">Share your invite link with friends to earn $${liveCpaRate.toFixed(2)} for each new install.</p>
          <button class="reb-copy-btn" onclick="window.webmasterFlutter.copyLink('${playUrl}')">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
            <span>Copy Invite Link</span>
          </button>
        </div>
      `;
      return;
    }

    referralsActivityContainer.innerHTML = filtered.map(item => {
      const userName = item.userName || 'New User';
      const initial = (userName.trim()[0] || 'U').toUpperCase();
      const maskedEmail = item.userEmailMasked || 'us***@user.com';
      const milestone = item.milestone || 'Awaiting first action';
      const dateStr = item.date ? formatDate(item.date) : 'Recently';
      const st = (item.status || '').toUpperCase();

      let statusBg = '#FFFBEB';
      let statusColor = '#B45309';
      let statusLabel = 'In Progress';
      let statusIconSvg = '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>';

      if (st === 'QUALIFIED') {
        statusBg = '#ECFDF5';
        statusColor = '#047857';
        const itemReward = (item.rewardUsd || item.rewardAmountUsd || liveCpaRate);
        statusLabel = `+$${Number(itemReward).toFixed(2)} Paid`;
        statusIconSvg = '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg>';
      } else if (st === 'REJECTED' || st === 'EXPIRED') {
        statusBg = '#FEF2F2';
        statusColor = '#B91C1C';
        statusLabel = 'Blocked';
        statusIconSvg = '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"></circle><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"></line></svg>';
      }

      return `
        <div class="referral-card-item">
          <div class="rci-avatar">${initial}</div>
          <div class="rci-info">
            <div class="rci-name-row">
              <span class="rci-name">${userName}</span>
              <span class="rci-date">${dateStr}</span>
            </div>
            <div class="rci-email">${maskedEmail}</div>
            <div class="rci-milestone">${milestone}</div>
          </div>
          <div class="rci-badge" style="background: ${statusBg}; color: ${statusColor};">
            ${statusIconSvg}
            <span>${statusLabel}</span>
          </div>
        </div>
      `;
    }).join('');
  }

  // ══════════════════════════════════════════════════════════
  // ══════════════════════════════════════════════════════════
  // WITHDRAWAL HISTORY RENDERING (Screen 4)
  // ══════════════════════════════════════════════════════════
  function renderWithdrawalCardsList() {
    if (!withdrawalCardsList) return;
    const withdrawals = (currentProfile && currentProfile.withdrawals) || [];

    let filtered = withdrawals.filter(w => {
      const st = (w.status || 'pending').toLowerCase();
      if (activeWithdrawalStatusFilter === 'paid' && !(st === 'paid' || st === 'approved' || st === 'success')) return false;
      if (activeWithdrawalStatusFilter === 'pending' && st !== 'pending') return false;
      if (activeWithdrawalStatusFilter === 'rejected' && !(st === 'rejected' || st === 'cancelled')) return false;

      const meth = (w.method || '').toLowerCase();
      if (activeWithdrawalMethodFilter === 'upi' && !meth.includes('upi')) return false;
      if (activeWithdrawalMethodFilter === 'usdt' && !(meth.includes('usdt') || meth.includes('crypto') || meth.includes('trc') || meth.includes('bep'))) return false;

      return true;
    });

    filtered.sort((a, b) => new Date(b.requestedAt || 0) - new Date(a.requestedAt || 0));

    const whRecordsCountBadge = document.getElementById('whRecordsCountBadge');
    if (whRecordsCountBadge) {
      whRecordsCountBadge.textContent = `${filtered.length} Record${filtered.length === 1 ? '' : 's'}`;
    }

    if (filtered.length === 0) {
      withdrawalCardsList.innerHTML = `
        <div class="wh-empty-card">
          <div class="wh-empty-icon">
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#0066FF" stroke-width="2">
              <rect x="2" y="5" width="20" height="14" rx="2"></rect>
              <line x1="2" y1="10" x2="22" y2="10"></line>
            </svg>
          </div>
          <h4 class="wh-empty-title">No Settlement Records Found</h4>
          <p class="wh-empty-sub">
            ${activeWithdrawalStatusFilter !== 'all' || activeWithdrawalMethodFilter !== 'all'
              ? 'No payouts match your selected filter criteria. Try selecting All Settlements.'
              : 'Payout requests will appear here with live settlement status, UTR numbers, and receipts.'}
          </p>
        </div>
      `;
      return;
    }

    withdrawalCardsList.innerHTML = filtered.map(w => {
      const meth = (w.method || '').toLowerCase();
      const isUpi = meth.includes('upi');
      const isUsdt = meth.includes('usdt') || meth.includes('crypto') || meth.includes('trc') || meth.includes('bep');

      let methodLabel = 'UPI Transfer';
      let iconClass = 'upi';
      let iconSvg = `
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M4 18L13.2 12L4 6V18Z" fill="#059669"/>
          <path d="M10.8 18L20 12L10.8 6V18Z" fill="#EA580C"/>
        </svg>
      `;

      if (isUsdt) {
        methodLabel = 'USDT (BEP-20)';
        iconClass = 'usdt';
        iconSvg = `
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <circle cx="12" cy="12" r="10" fill="#26A17B"/>
            <path d="M13.2 11.5c-.05 0-.33.02-1.2.02-.7 0-1.07-.02-1.2-.02-2.3-.1-4-.6-4-1.2 0-.6 1.7-1.1 4-1.2v1.1c.13.01.5.03 1.2.03.86 0 1.14-.02 1.2-.03v-1.1c2.3.1 4 .6 4 1.2 0 .6-1.7 1.1-4 1.2zm0-3.3V6.6h3.3V5H7.5v1.6h3.3v1.6c-2.9.14-5 1.02-5 2.1 0 1.08 2.1 1.96 5 2.1V17.5h2.4V12.4c2.9-.14 5-1.02 5-2.1 0-1.08-2.1-1.96-5-2.1z" fill="#FFFFFF"/>
          </svg>
        `;
      } else if (!isUpi) {
        methodLabel = w.method || 'Bank Transfer';
        iconClass = 'bank';
        iconSvg = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#0066FF" stroke-width="2"><rect x="3" y="4" width="18" height="16" rx="2"></rect><line x1="7" y1="10" x2="7" y2="16"></line><line x1="12" y1="10" x2="12" y2="16"></line><line x1="17" y1="10" x2="17" y2="16"></line></svg>`;
      }

      const shortId = w.id ? (w.id.length > 8 ? w.id.substring(w.id.length - 8) : w.id) : 'wd_xxxx';
      const amountUsd = w.amountUsd || 0;
      const amountStr = formatShortUsd(amountUsd);

      const st = (w.status || 'pending').toLowerCase();
      let statusClass = 'pending';
      let statusLabel = 'In Review';
      let timelineStatusText = 'Verification in progress';

      if (st === 'paid' || st === 'approved' || st === 'success') {
        statusClass = 'paid';
        statusLabel = 'Paid';
        timelineStatusText = w.processedAt ? `Settled on ${formatDate(w.processedAt)}` : 'Settled to Account';
      } else if (st === 'rejected' || st === 'cancelled') {
        statusClass = 'rejected';
        statusLabel = 'Rejected';
        timelineStatusText = 'Refunded to Wallet Balance';
      }

      const reqDate = formatDateTime(w.requestedAt);
      const txnRef = w.transactionHash || w.referenceId || w.utr || w.txnId || '';

      return `
        <div class="wh-record-card" onclick="window.webmasterFlutter.openReceiptModal('${w.id}')">
          <div class="wh-record-top">
            <div class="wh-method-icon ${iconClass}">
              ${iconSvg}
            </div>
            <div class="wh-record-details">
              <div class="wh-method-title-row">
                <span class="wh-method-name">${methodLabel}</span>
                <span class="wh-id-chip">#${shortId}</span>
              </div>
              <div class="wh-account-info" title="${escapeHtml(w.accountInfo || 'Account Details')}">
                ${escapeHtml(w.accountInfo || 'Account Details')}
              </div>
            </div>
            <div class="wh-record-amount-col">
              <div class="wh-amount-val">${amountStr}</div>
              <div class="wh-status-badge ${statusClass}">
                <span class="wh-status-badge-dot"></span>
                <span>${statusLabel}</span>
              </div>
            </div>
          </div>

          <div class="wh-record-timeline">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#64748B" stroke-width="2" style="flex-shrink:0;">
              <rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect>
              <line x1="16" y1="2" x2="16" y2="6"></line>
              <line x1="8" y1="2" x2="8" y2="6"></line>
              <line x1="3" y1="10" x2="21" y2="10"></line>
            </svg>
            <span class="wh-timeline-date">${reqDate}</span>
            <span class="wh-timeline-status ${statusClass}">${timelineStatusText}</span>
          </div>

          ${txnRef ? `
            <div class="wh-txn-copy-row" onclick="event.stopPropagation(); window.webmasterFlutter.copyTxnHash('${txnRef}')" title="Click to copy Transaction Ref">
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path></svg>
              <span class="wh-txn-hash">Ref: ${escapeHtml(txnRef)}</span>
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
            </div>
          ` : ''}
        </div>
      `;
    }).join('');
  }

  // ══════════════════════════════════════════════════════════
  // REWARD DETAILS RENDERING (Screen 6 - Full Flutter Parity)
  // ══════════════════════════════════════════════════════════
  function renderRewardRecordsList() {
    if (!currentProfile) return;

    const earningRecords = currentProfile.earningRecords || [];
    const balance = currentProfile.walletBalanceUsd || 0.0;
    const totalWithdrawn = currentProfile.totalWithdrawnUsd || 0.0;
    const allTimeTotal = currentProfile.totalEarningsUsd || (balance + totalWithdrawn);
    const now = new Date();

    // 1. Date filter logic (Exact Flutter logic)
    let records = earningRecords.slice();
    if (rewardDateFilter === 'today') {
      records = records.filter(r => {
        if (!r.date && !r.createdAt && !r.timestamp && !r.recordedAt) return false;
        const d = new Date(r.date || r.createdAt || r.timestamp || r.recordedAt);
        return d.getFullYear() === now.getFullYear() &&
          d.getMonth() === now.getMonth() &&
          d.getDate() === now.getDate();
      });
    } else if (rewardDateFilter === 'week') {
      const past7Days = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      records = records.filter(r => {
        if (!r.date && !r.createdAt && !r.timestamp && !r.recordedAt) return false;
        const d = new Date(r.date || r.createdAt || r.timestamp || r.recordedAt);
        return d >= past7Days;
      });
    } else if (rewardDateFilter === 'month') {
      const past30Days = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      records = records.filter(r => {
        if (!r.date && !r.createdAt && !r.timestamp && !r.recordedAt) return false;
        const d = new Date(r.date || r.createdAt || r.timestamp || r.recordedAt);
        return d >= past30Days;
      });
    }

    // 2. Source filter logic
    if (rewardSourceFilter === 'video') {
      records = records.filter(r => {
        const t = (r.type || '').toLowerCase();
        return t.includes('video') || t === 'videoplay';
      });
    } else if (rewardSourceFilter === 'user') {
      records = records.filter(r => {
        const t = (r.type || '').toLowerCase();
        return t.includes('user') || t.includes('referral') || t === 'newuser';
      });
    }

    // 3. Sort descending by timestamp
    records.sort((a, b) => {
      const dateA = new Date(a.date || a.createdAt || a.timestamp || a.recordedAt || 0);
      const dateB = new Date(b.date || b.createdAt || b.timestamp || b.recordedAt || 0);
      return dateB - dateA;
    });

    // 4. Calculate period earnings
    const filteredEarnings = records.reduce((sum, r) => sum + (parseFloat(r.amountUsd || r.amount) || 0), 0);
    const displayTotal = (rewardDateFilter === 'all' && rewardSourceFilter === 'all') ? allTimeTotal : filteredEarnings;

    // 5. Update Executive Summary Card
    const periodLabels = {
      'all': 'All Time',
      'today': 'Today',
      'week': 'Past 7 Days',
      'month': 'Past 30 Days'
    };
    const periodLabelText = periodLabels[rewardDateFilter] || 'All Time';

    const rewardPeriodHeaderLabel = document.getElementById('rewardPeriodHeaderLabel');
    if (rewardPeriodHeaderLabel) rewardPeriodHeaderLabel.textContent = periodLabelText;

    if (rewardSummaryTotalDisplay) {
      rewardSummaryTotalDisplay.textContent = formatUsd(displayTotal);
    }

    const rewardTodayPodVal = document.getElementById('rewardTodayPodVal');
    if (rewardTodayPodVal) rewardTodayPodVal.textContent = formatUsd(currentProfile.todayEarnings || 0);

    const rewardMonthPodVal = document.getElementById('rewardMonthPodVal');
    if (rewardMonthPodVal) rewardMonthPodVal.textContent = formatUsd(currentProfile.monthEarnings || currentProfile.thisMonthEarnings || 0);

    const rewardAllTimePodVal = document.getElementById('rewardAllTimePodVal');
    if (rewardAllTimePodVal) rewardAllTimePodVal.textContent = formatUsd(allTimeTotal);

    // 6. Section Header
    const rewardRecordsCountBadge = document.getElementById('rewardRecordsCountBadge');
    if (rewardRecordsCountBadge) rewardRecordsCountBadge.textContent = records.length.toString();

    const historyPeriodSub = document.getElementById('historyPeriodSub');
    if (historyPeriodSub) historyPeriodSub.textContent = periodLabelText;

    // 7. Render Records or Authentic Empty State
    if (!rewardRecordsList) return;
    rewardRecordsList.innerHTML = '';

    if (records.length === 0) {
      const emptyDiv = document.createElement('div');
      emptyDiv.className = 'rd-empty-card';
      emptyDiv.innerHTML = `
        <div class="rd-empty-icon">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line><polyline points="10 9 9 9 8 9"></polyline></svg>
        </div>
        <h4 class="rd-empty-title">No Earnings in this Period</h4>
        <p class="rd-empty-sub">Share videos and invite friends to start generating daily earnings in your ledger.</p>
      `;
      rewardRecordsList.appendChild(emptyDiv);
      return;
    }

    records.forEach(r => {
      const rawType = (r.type || '').toLowerCase();
      let typeCategory = 'bonus';
      let typeLabel = 'Bonus';
      let iconSvg = '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><polyline points="20 12 20 22 4 22 4 12"></polyline><rect x="2" y="7" width="20" height="5"></rect><line x1="12" y1="22" x2="12" y2="7"></line><path d="M12 7H7.5a2.5 2.5 0 0 1 0-5C11 2 12 7 12 7z"></path><path d="M12 7h4.5a2.5 2.5 0 0 0 0-5C13 2 12 7 12 7z"></path></svg>';

      if (rawType.includes('video') || rawType === 'videoplay') {
        typeCategory = 'video';
        typeLabel = 'Video Views';
        iconSvg = '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>';
      } else if (rawType.includes('user') || rawType.includes('referral') || rawType === 'newuser') {
        typeCategory = 'user';
        typeLabel = 'New Users';
        iconSvg = '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path><circle cx="8.5" cy="7" r="4"></circle><line x1="20" y1="8" x2="20" y2="14"></line><line x1="23" y1="11" x2="17" y2="11"></line></svg>';
      }

      const recDate = new Date(r.date || r.createdAt || r.timestamp || r.recordedAt || Date.now());
      const recDateStr = formatReadableRecordDate(recDate);
      const hours = String(recDate.getHours()).padStart(2, '0');
      const mins = String(recDate.getMinutes()).padStart(2, '0');
      const timeStr = `${hours}:${mins}`;

      const title = r.description || r.title || (typeCategory === 'video' ? 'Video Play Monetization' : (typeCategory === 'user' ? 'New User Referral' : 'Monetization Reward'));
      const amt = parseFloat(r.amountUsd || r.amount) || 0.0;

      const card = document.createElement('div');
      card.className = 'rd-record-card';
      card.innerHTML = `
        <div class="rd-record-icon ${typeCategory}">
          ${iconSvg}
        </div>
        <div class="rd-record-content">
          <div class="rd-record-title" title="${escapeHtml(title)}">${escapeHtml(title)}</div>
          <div class="rd-record-meta">
            <span class="rd-type-tag ${typeCategory}">${typeLabel}</span>
            <span class="rd-record-date">${recDateStr} at ${timeStr}</span>
          </div>
        </div>
        <div class="rd-record-amount">+${formatUsd(amt)}</div>
      `;
      rewardRecordsList.appendChild(card);
    });
  }

  function formatReadableRecordDate(d) {
    const now = new Date();
    if (d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate()) {
      return 'Today';
    }
    const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    if (d.getFullYear() === yesterday.getFullYear() && d.getMonth() === yesterday.getMonth() && d.getDate() === yesterday.getDate()) {
      return 'Yesterday';
    }
    return `${d.getDate()}/${d.getMonth() + 1}/${d.getFullYear()}`;
  }

  function escapeHtml(str) {
    if (!str) return '';
    return String(str).replace(/[&<>"']/g, m => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;'
    }[m]));
  }

  function isAnyModalOpen() {
    const w = document.getElementById('withdrawModal');
    const r = document.getElementById('receiptModal');
    const q = document.getElementById('qrModal');
    const ru = document.getElementById('rulesModal');
    return (w && (w.classList.contains('open') || w.style.display === 'flex')) ||
           (r && (r.classList.contains('open') || r.style.display === 'flex')) ||
           (q && (q.classList.contains('open') || q.style.display === 'flex')) ||
           (ru && (ru.classList.contains('open') || ru.style.display === 'flex'));
  }

  function openWithdrawalModal() {
    const modal = document.getElementById('withdrawModal') || withdrawModal;
    if (!modal) {
      console.warn('Withdrawal modal element not found in DOM');
      return;
    }
    setWithdrawModalStep(0);
    modal.style.display = 'flex';
    requestAnimationFrame(() => {
      modal.classList.add('open');
      modal.setAttribute('data-open', 'true');
    });
  }

  function closeWithdrawalModal() {
    const modal = document.getElementById('withdrawModal') || withdrawModal;
    if (!modal) return;
    modal.classList.remove('open');
    modal.removeAttribute('data-open');
    setTimeout(() => {
      if (!modal.classList.contains('open')) {
        modal.style.display = 'none';
      }
    }, 170);
  }

  function setWithdrawModalStep(step) {
    withdrawModalStep = step;

    // Reset error boxes
    const m1Err = document.getElementById('modalStep1ErrorBox') || modalStep1ErrorBox;
    const m2Err = document.getElementById('modalStep2ErrorBox') || modalStep2ErrorBox;
    if (m1Err) m1Err.style.display = 'none';
    if (m2Err) m2Err.style.display = 'none';

    // Update step dots and line states
    const d0 = document.getElementById('dotStep0') || dotStep0;
    const d1 = document.getElementById('dotStep1') || dotStep1;
    const d2 = document.getElementById('dotStep2') || dotStep2;
    const l01 = document.getElementById('lineStep01') || lineStep01;
    const l12 = document.getElementById('lineStep12') || lineStep12;

    if (d0) d0.classList.toggle('active', step >= 0);
    if (d1) d1.classList.toggle('active', step >= 1);
    if (d2) d2.classList.toggle('active', step >= 2);
    if (l01) l01.classList.toggle('active', step >= 1);
    if (l12) l12.classList.toggle('active', step >= 2);

    // Update views
    const s0View = document.getElementById('modalStep0View') || modalStep0View;
    const s1View = document.getElementById('modalStep1View') || modalStep1View;
    const s2View = document.getElementById('modalStep2View') || modalStep2View;

    if (s0View) s0View.classList.toggle('active', step === 0);
    if (s1View) s1View.classList.toggle('active', step === 1);
    if (s2View) s2View.classList.toggle('active', step === 2);

    const titleEl = document.getElementById('modalStepTitle') || modalStepTitle;
    const indEl = document.getElementById('modalStepIndicator') || modalStepIndicator;

    updateGatewayDynamicDetails();

    if (step === 0) {
      if (titleEl) titleEl.textContent = 'Select Gateway';
      if (indEl) indEl.textContent = 'Step 1 of 3';
    } else if (step === 1) {
      if (titleEl) titleEl.textContent = 'Payout Details';
      if (indEl) indEl.textContent = 'Step 2 of 3';

      const minVal = adminConfig.minWithdrawalUsd || 1.00;
      const minFormatted = `$${minVal.toFixed(2)}`;
      const avail = (currentProfile && currentProfile.walletBalanceUsd) || 0.0;
      const s1Avail = document.getElementById('modalStep1AvailBalance') || modalStep1AvailBalance;
      if (s1Avail) s1Avail.textContent = `Available: ${formatUsd(avail)}`;

      const m1MinTag = document.getElementById('modalStep1MinLimitTag') || modalStep1MinLimitTag;
      if (m1MinTag) m1MinTag.textContent = `Min ${minFormatted}`;

      const amtInp = document.getElementById('inputWithdrawUsdAmount') || inputWithdrawUsdAmount;
      if (amtInp) {
        amtInp.min = minVal.toFixed(2);
        if (!amtInp.value || parseFloat(amtInp.value) < minVal) {
          amtInp.value = minVal.toFixed(2);
        }
        updateInrEstimate();
      }

      // Configure Method-specific account input fields
      const isUpi = selectedPayoutMethod === 'upi';
      const lblDest = document.getElementById('lblDestinationAccount') || lblDestinationAccount;
      const netBadge = document.getElementById('networkBadgeTag') || networkBadgeTag;
      const destInp = document.getElementById('inputDestinationAccount') || inputDestinationAccount;
      const accHint = document.getElementById('accountInputHint') || accountInputHint;

      if (lblDest) lblDest.textContent = isUpi ? 'UPI ID (VPA)' : 'USDT Wallet Address (BEP-20)';
      if (netBadge) {
        netBadge.textContent = 'BSC BEP-20';
        netBadge.style.display = isUpi ? 'none' : 'inline-block';
      }
      if (destInp) {
        destInp.placeholder = isUpi ? 'e.g. yourname@okaxis or yourname@paytm' : 'e.g. 0x... (42-character BSC address)';
      }
      if (accHint) {
        accHint.textContent = isUpi
          ? 'Enter verified Google Pay, PhonePe, or Paytm UPI ID.'
          : 'Enter your Binance Smart Chain (BSC BEP-20) wallet address starting with 0x.';
      }
      validateAccountInput();
    } else if (step === 2) {
      if (titleEl) titleEl.textContent = 'Confirm Payout';
      if (indEl) indEl.textContent = 'Step 3 of 3';

      const amtInp = document.getElementById('inputWithdrawUsdAmount') || inputWithdrawUsdAmount;
      const destInp = document.getElementById('inputDestinationAccount') || inputDestinationAccount;
      const amt = parseFloat(amtInp ? amtInp.value : '1.0') || 1.0;
      const isUpi = selectedPayoutMethod === 'upi';

      const revGw = document.getElementById('reviewGatewayName') || reviewGatewayName;
      const revAmtUsd = document.getElementById('reviewAmountUsd') || reviewAmountUsd;
      const revAmtInr = document.getElementById('reviewAmountInr') || reviewAmountInr;
      const revAcc = document.getElementById('reviewAccountDestination') || reviewAccountDestination;

      if (revGw) revGw.textContent = isUpi ? 'UPI Transfer' : 'USDT Crypto (BEP-20)';
      if (revAmtUsd) revAmtUsd.textContent = `${formatShortUsd(amt)} USD`;
      if (revAmtInr) revAmtInr.textContent = `≈ ₹${(amt * 87.0).toFixed(2)} INR`;
      if (revAcc) revAcc.textContent = destInp ? destInp.value.trim() : '';
    }
  }

  function updateGatewayDynamicDetails() {
    const minVal = adminConfig.minWithdrawalUsd || 1.00;
    const minFormatted = `$${minVal.toFixed(2)}`;
    const upiFeeTag = document.getElementById('upiMethodFeeTag');
    if (upiFeeTag) upiFeeTag.textContent = `0% Platform Fee • Min ${minFormatted} USD`;
    const usdtFeeTag = document.getElementById('usdtMethodFeeTag');
    if (usdtFeeTag) usdtFeeTag.textContent = `0% Platform Fee • Min ${minFormatted} USD`;
    const modalStep1MinLimitTag = document.getElementById('modalStep1MinLimitTag');
    if (modalStep1MinLimitTag) modalStep1MinLimitTag.textContent = `Min ${minFormatted}`;
  }

  function updateInrEstimate() {
    const amtInp = document.getElementById('inputWithdrawUsdAmount') || inputWithdrawUsdAmount;
    const inrHint = document.getElementById('inrEstimateHint') || inrEstimateHint;
    const entered = parseFloat(amtInp ? amtInp.value : '0') || 0.0;
    const inr = entered * 87.0;
    if (inrHint) inrHint.textContent = `Estimated: ≈ ₹${inr.toFixed(2)} INR (1 USD ≈ ₹87.00)`;
  }

  function validateAccountInput() {
    if (!inputDestinationAccount) return false;
    const text = inputDestinationAccount.value.trim();
    const isUpi = selectedPayoutMethod === 'upi';

    let isValid = false;
    if (isUpi) {
      isValid = /^[a-zA-Z0-9.\-_]{2,256}@[a-zA-Z]{2,64}$/.test(text);
    } else {
      isValid = /^0x[a-fA-F0-9]{40}$/.test(text);
    }

    inputDestinationAccount.classList.remove('valid', 'invalid');
    if (text.length > 0) {
      inputDestinationAccount.classList.add(isValid ? 'valid' : 'invalid');
    }
    return isValid;
  }

  async function handleFinalWithdrawalSubmit() {
    const ref = currentProfile ? currentProfile.referralCode : queryRef;
    if (!ref) {
      showModal2Error('Webmaster profile required. Please refresh.');
      return;
    }

    const amount = parseFloat(inputWithdrawUsdAmount.value);
    const minPayout = adminConfig.minWithdrawalUsd || 1.0;
    const available = (currentProfile && currentProfile.walletBalanceUsd) || 0.0;

    if (isNaN(amount) || amount < minPayout) {
      showModal2Error(`Minimum withdrawal is ${formatShortUsd(minPayout)} USD.`);
      return;
    }

    if (amount > available) {
      showModal2Error(`Insufficient balance. Maximum available is ${formatUsd(available)}.`);
      return;
    }

    const account = inputDestinationAccount.value.trim();
    if (!account) {
      showModal2Error('Destination account details required.');
      return;
    }

    if (btnStep2Submit) {
      btnStep2Submit.disabled = true;
      btnStep2Submit.textContent = 'Submitting Payout...';
    }

    try {
      const res = await fetch('/api/webmaster/withdraw', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${ssoToken}`,
          'X-App-Token': ssoToken
        },
        body: JSON.stringify({
          token: ssoToken,
          referralCode: ref,
          amountUsd: amount,
          method: selectedPayoutMethod,
          accountInfo: account
        })
      });

      const data = await res.json();
      if (res.ok && data.success) {
        showToast('Payout request submitted successfully!');
        closeWithdrawalModal();
        await fetchWebmasterProfile(); // Live balance & ledger refresh
      } else {
        showModal2Error(data.error || 'Failed to submit withdrawal. Please check details.');
      }
    } catch (err) {
      showModal2Error('Network error. Please try again.');
    } finally {
      if (btnStep2Submit) {
        btnStep2Submit.disabled = false;
        btnStep2Submit.textContent = 'Confirm & Submit Payout';
      }
    }
  }

  function showModal1Error(msg) {
    if (modalStep1ErrorBox) {
      modalStep1ErrorBox.textContent = msg;
      modalStep1ErrorBox.style.display = 'block';
    }
  }

  function showModal2Error(msg) {
    if (modalStep2ErrorBox) {
      modalStep2ErrorBox.textContent = msg;
      modalStep2ErrorBox.style.display = 'block';
    }
  }

  // ══════════════════════════════════════════════════════════
  // RECEIPT & QR MODALS
  // ══════════════════════════════════════════════════════════
  function openReceiptModal(withdrawalId) {
    if (!receiptModal || !currentProfile) return;
    const list = currentProfile.withdrawals || [];
    const record = list.find(w => w.id === withdrawalId) || list[0];
    if (!record) return;

    if (receiptAmountDisplay) receiptAmountDisplay.textContent = `${formatShortUsd(record.amountUsd || 0)} USD`;
    const st = (record.status || 'pending').toLowerCase();
    const isPaid = st === 'paid' || st === 'approved' || st === 'success';
    const isRejected = st === 'rejected' || st === 'cancelled';

    const receiptStatusIcon = document.getElementById('receiptStatusIcon');
    if (receiptStatusIcon) {
      if (isPaid) {
        receiptStatusIcon.className = 'receipt-icon-circle paid';
        receiptStatusIcon.innerHTML = `
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#10B981" stroke-width="2.5">
            <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path>
            <polyline points="22 4 12 14.01 9 11.01"></polyline>
          </svg>
        `;
      } else if (isRejected) {
        receiptStatusIcon.className = 'receipt-icon-circle rejected';
        receiptStatusIcon.innerHTML = `
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#EF4444" stroke-width="2.5">
            <circle cx="12" cy="12" r="10"></circle>
            <line x1="15" y1="9" x2="9" y2="15"></line>
            <line x1="9" y1="9" x2="15" y2="15"></line>
          </svg>
        `;
      } else {
        receiptStatusIcon.className = 'receipt-icon-circle pending';
        receiptStatusIcon.innerHTML = `
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#F59E0B" stroke-width="2.5">
            <circle cx="12" cy="12" r="10"></circle>
            <polyline points="12 6 12 12 16 14"></polyline>
          </svg>
        `;
      }
    }

    if (receiptStatusPill) {
      receiptStatusPill.textContent = isPaid ? 'PAID' : (isRejected ? 'REJECTED' : 'IN REVIEW');
      receiptStatusPill.className = `receipt-status-pill ${isPaid ? 'paid' : (isRejected ? 'rejected' : 'pending')}`;
    }
    if (receiptTxnId) receiptTxnId.textContent = `#${record.id || 'wd_xxxx'}`;
    const meth = (record.method || '').toLowerCase();
    const isUpi = meth.includes('upi');
    const isUsdt = meth.includes('usdt') || meth.includes('crypto') || meth.includes('bep') || meth.includes('trc');
    if (receiptMethod) receiptMethod.textContent = isUpi ? 'UPI Transfer' : (isUsdt ? 'USDT Crypto (BEP-20)' : (record.method || 'Bank Transfer'));
    if (receiptAccount) receiptAccount.textContent = record.accountInfo || 'Account Details';
    if (receiptRequestedDate) receiptRequestedDate.textContent = formatDateTime(record.requestedAt);
    if (receiptSettledDate) receiptSettledDate.textContent = record.processedAt ? formatDateTime(record.processedAt) : (isRejected ? 'Rejected & Refunded to Wallet' : 'Pending Verification');

    receiptModal.style.display = 'flex';
    requestAnimationFrame(() => {
      receiptModal.classList.add('open');
      receiptModal.setAttribute('data-open', 'true');
    });
  }

  function openQrModal(url, title = 'Scan Link QR Code', refCode = '') {
    if (!qrModal) return;
    const qrHeading = document.getElementById('qrHeading');
    const qrSubHeading = document.getElementById('qrSubHeading');
    const qrModalRefCode = document.getElementById('qrModalRefCode');
    const qrCodePillContainer = document.getElementById('qrCodePillContainer');
    const btnCopyQrUrl = document.getElementById('btnCopyQrUrl');

    const isInvite = (title || '').toLowerCase().includes('invite') || (refCode && !(title || '').includes('.'));
    if (qrHeading) {
      qrHeading.textContent = isInvite ? 'Scan Invite QR Code' : 'Scan Link QR Code';
    }
    if (qrSubHeading) {
      if (isInvite) {
        qrSubHeading.textContent = 'Scan with camera to install TeraBox';
      } else {
        qrSubHeading.textContent = (title && title !== 'Scan Link QR Code') ? title : 'Scan to open or share directly';
      }
      qrSubHeading.title = qrSubHeading.textContent;
    }

    const codeToDisplay = refCode || (referralLedgerData && referralLedgerData.referralCode) || (currentProfile && currentProfile.referralCode) || 'TBX5367';
    if (qrModalRefCode) qrModalRefCode.textContent = codeToDisplay;
    if (qrCodePillContainer) {
      qrCodePillContainer.style.display = isInvite ? 'flex' : 'none';
    }

    if (btnCopyQrUrl) {
      const copyLabel = btnCopyQrUrl.querySelector('span');
      if (copyLabel) {
        copyLabel.textContent = isInvite ? 'Copy Invite Link' : 'Copy Monetized Link';
      }
    }

    if (qrTextValue) qrTextValue.value = url;

    if (qrCanvasContainer) {
      qrCanvasContainer.innerHTML = '';
      if (window.QRCode) {
        new window.QRCode(qrCanvasContainer, {
          text: url,
          width: 180,
          height: 180,
          colorDark: '#0F172A',
          colorLight: '#FFFFFF',
          correctLevel: window.QRCode.CorrectLevel.H,
        });
      } else {
        const qrImg = document.createElement('img');
        qrImg.src = `https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(url)}`;
        qrImg.alt = 'QR Code';
        qrImg.style.width = '180px';
        qrImg.style.height = '180px';
        qrImg.style.borderRadius = '8px';
        qrCanvasContainer.appendChild(qrImg);
      }
    }
    qrModal.style.display = 'flex';
    requestAnimationFrame(() => {
      qrModal.classList.add('open');
      qrModal.setAttribute('data-open', 'true');
    });
  }

  function closeQrModal() {
    const modal = document.getElementById('qrModal') || qrModal;
    if (!modal) return;
    modal.classList.remove('open');
    modal.removeAttribute('data-open');
    setTimeout(() => {
      if (!modal.classList.contains('open')) {
        modal.style.display = 'none';
      }
    }, 170);
  }

  function closeReceiptModal() {
    const modal = document.getElementById('receiptModal') || receiptModal;
    if (!modal) return;
    modal.classList.remove('open');
    modal.removeAttribute('data-open');
    setTimeout(() => {
      if (!modal.classList.contains('open')) {
        modal.style.display = 'none';
      }
    }, 170);
  }

  function closeRulesModal() {
    const modal = document.getElementById('rulesModal');
    if (!modal) return;
    modal.classList.remove('open');
    modal.removeAttribute('data-open');
    setTimeout(() => {
      if (!modal.classList.contains('open')) {
        modal.style.display = 'none';
      }
    }, 170);
  }

  // ══════════════════════════════════════════════════════════
  // EVENT LISTENERS & SETUP
  // ══════════════════════════════════════════════════════════
  function bindEventListeners() {
    // 0. Back & Close buttons
    document.querySelectorAll('.btn-app-back').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        handleAppBack();
      });
    });

    document.querySelectorAll('.btn-app-close').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        handleAppClose();
      });
    });

    // 0b. Hash & History routing
    window.addEventListener('popstate', (e) => {
      const target = (e.state && e.state.screen) || getScreenFromHash() || 'screen-dashboard';
      navigateToScreen(target, false);
    });

    window.addEventListener('hashchange', () => {
      const target = getScreenFromHash() || 'screen-dashboard';
      navigateToScreen(target, false);
    });

    // 1. Navigation clicks
    document.querySelectorAll('[data-navigate]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const targetScreen = btn.getAttribute('data-navigate');
        navigateToScreen(targetScreen);
      });
    });

    // 2. Drawer actions
    if (btnOpenMenuDrawer) btnOpenMenuDrawer.addEventListener('click', openDrawer);
    if (btnCloseDrawer) btnCloseDrawer.addEventListener('click', closeDrawer);
    if (drawerOverlay) {
      drawerOverlay.addEventListener('click', (e) => {
        if (e.target === drawerOverlay) closeDrawer();
      });
    }
    const btnDrawerLogout = document.getElementById('btnDrawerLogout');
    if (btnDrawerLogout) {
      btnDrawerLogout.addEventListener('click', () => {
        currentProfile = null;
        try {
          sessionStorage.clear();
          localStorage.removeItem('tb_wm_token');
          localStorage.removeItem('tb_wm_userId');
          localStorage.removeItem('tb_wm_email');
          localStorage.removeItem('tb_wm_ref');
        } catch (_) { }
        closeDrawer();
        navigateToScreen('screen-connect-account');
        showToast('Switched account session.');
      });
    }

    // 2b. Maintenance / Return home button
    const btnReturnHomeDisabled = document.getElementById('btnReturnHomeDisabled');
    if (btnReturnHomeDisabled) {
      btnReturnHomeDisabled.addEventListener('click', () => {
        handleAppClose();
      });
    }

    // 3. Time tabs (24 Hours vs All Time)
    document.querySelectorAll('.time-tab-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.time-tab-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        activePeriod = btn.getAttribute('data-period') || '24h';
        updateDashboardMetrics();
      });
    });

    // 4. Copy Referral Buttons
    if (btnShareDashboardLink) {
      btnShareDashboardLink.addEventListener('click', () => {
        const ref = currentProfile ? currentProfile.referralCode : 'TBX5367';
        copyToClipboard(`https://terabox.mywire.org/share/${ref}`, 'Referral share link copied!');
      });
    }

    if (btnQuickCopyReferral) {
      btnQuickCopyReferral.addEventListener('click', () => {
        const ref = (referralLedgerData && referralLedgerData.referralCode) || (currentProfile ? currentProfile.referralCode : 'TBX5367');
        const playUrl = (referralLedgerData && referralLedgerData.invitePlayUrl) || `https://play.google.com/store/apps/details?id=com.teracloud.app.terabox_client&referrer=ref%3D${encodeURIComponent(ref)}`;
        copyToClipboard(playUrl, 'Invite link copied!');
      });
    }

    if (btnCopyInviteLink) {
      btnCopyInviteLink.addEventListener('click', () => {
        const url = refInviteUrlInput ? refInviteUrlInput.value : '';
        copyToClipboard(url, 'Invite link copied!');
      });
    }

    // 5. Social Share Buttons (Direct Google Play Store Referrer URLs)
    if (btnShareWhatsApp) {
      btnShareWhatsApp.addEventListener('click', () => {
        const ref = (referralLedgerData && referralLedgerData.referralCode) || (currentProfile ? currentProfile.referralCode : 'TBX5367');
        const playUrl = (referralLedgerData && referralLedgerData.invitePlayUrl) || (refInviteUrlInput ? refInviteUrlInput.value : `https://play.google.com/store/apps/details?id=com.teracloud.app.terabox_client&referrer=ref%3D${ref}`);
        launchSocialShare(playUrl, '', 'whatsapp');
      });
    }

    if (btnShareTelegram) {
      btnShareTelegram.addEventListener('click', () => {
        const ref = (referralLedgerData && referralLedgerData.referralCode) || (currentProfile ? currentProfile.referralCode : 'TBX5367');
        const playUrl = (referralLedgerData && referralLedgerData.invitePlayUrl) || (refInviteUrlInput ? refInviteUrlInput.value : `https://play.google.com/store/apps/details?id=com.teracloud.app.terabox_client&referrer=ref%3D${ref}`);
        launchSocialShare(playUrl, '', 'telegram');
      });
    }

    if (btnOpenReferralQr) {
      btnOpenReferralQr.addEventListener('click', () => {
        const ref = (referralLedgerData && referralLedgerData.referralCode) || (currentProfile ? currentProfile.referralCode : 'TBX5367');
        const playUrl = (referralLedgerData && referralLedgerData.invitePlayUrl) || (refInviteUrlInput ? refInviteUrlInput.value : `https://play.google.com/store/apps/details?id=com.teracloud.app.terabox_client&referrer=ref%3D${encodeURIComponent(ref)}`);
        openQrModal(playUrl, 'Scan Invite QR Code', ref);
      });
    }

    if (btnRefreshReferrals) {
      btnRefreshReferrals.addEventListener('click', async () => {
        await fetchWebmasterReferralsData(true);
      });
    }

    // 5c. Referral Status Filter Chips
    document.querySelectorAll('[data-ref-status-filter]').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('[data-ref-status-filter]').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        const st = btn.getAttribute('data-ref-status-filter') || 'all';
        renderReferralsActivityList(st);
      });
    });

    // 5b. Security Lockout App Button
    const btnUnauthorizedOpenApp = document.getElementById('btnUnauthorizedOpenApp');
    if (btnUnauthorizedOpenApp) {
      btnUnauthorizedOpenApp.addEventListener('click', (e) => {
        e.preventDefault();
        handleAppClose();
      });
    }

    // 6. Shared Links Filter, Search & Direct Share
    const cardRefBadgeContainer = document.getElementById('cardRefBadgeContainer');
    if (cardRefBadgeContainer) {
      cardRefBadgeContainer.addEventListener('click', () => {
        const ref = (currentProfile && currentProfile.referralCode) || queryRef || 'TBX5367';
        copyToClipboard(ref, 'Webmaster code copied!');
      });
    }

    const btnToggleSharedSearch = document.getElementById('btnToggleSharedSearch');
    const sharedSearchContainer = document.getElementById('sharedSearchContainer');
    const sharedLinksSearchInput = document.getElementById('sharedLinksSearchInput');
    const btnClearSharedSearch = document.getElementById('btnClearSharedSearch');

    if (btnToggleSharedSearch && sharedSearchContainer) {
      btnToggleSharedSearch.addEventListener('click', () => {
        const isHidden = sharedSearchContainer.style.display === 'none';
        sharedSearchContainer.style.display = isHidden ? 'block' : 'none';
        btnToggleSharedSearch.classList.toggle('active', isHidden);
        if (isHidden && sharedLinksSearchInput) {
          sharedLinksSearchInput.focus();
        } else if (!isHidden && sharedLinksSearchInput) {
          sharedLinksSearchInput.value = '';
          sharedSearchQuery = '';
          if (btnClearSharedSearch) btnClearSharedSearch.style.display = 'none';
          renderSharedLinksList();
        }
      });
    }

    if (sharedLinksSearchInput) {
      sharedLinksSearchInput.addEventListener('input', (e) => {
        sharedSearchQuery = (e.target.value || '').trim().toLowerCase();
        if (btnClearSharedSearch) {
          btnClearSharedSearch.style.display = sharedSearchQuery.length > 0 ? 'inline-flex' : 'none';
        }
        renderSharedLinksList();
      });
    }

    if (btnClearSharedSearch && sharedLinksSearchInput) {
      btnClearSharedSearch.addEventListener('click', () => {
        sharedLinksSearchInput.value = '';
        sharedSearchQuery = '';
        btnClearSharedSearch.style.display = 'none';
        sharedLinksSearchInput.focus();
        renderSharedLinksList();
      });
    }

    document.querySelectorAll('[data-link-filter]').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('[data-link-filter]').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        selectedLinkFilter = parseInt(btn.getAttribute('data-link-filter') || '0', 10);
        renderSharedLinksList();
      });
    });

    if (sharedLinksSortSelect) {
      sharedLinksSortSelect.addEventListener('change', (e) => {
        selectedLinkSort = parseInt(e.target.value || '0', 10);
        renderSharedLinksList();
      });
    }

    if (btnRefreshLinks) {
      btnRefreshLinks.addEventListener('click', async () => {
        showToast('Refreshing links...');
        await fetchWebmasterProfile();
      });
    }

    // 7. Withdrawal History Status & Gateway Filters
    document.querySelectorAll('[data-status-filter]').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('[data-status-filter]').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        activeWithdrawalStatusFilter = btn.getAttribute('data-status-filter') || 'all';
        renderWithdrawalCardsList();
      });
    });

    document.querySelectorAll('[data-method-filter]').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('[data-method-filter]').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        activeWithdrawalMethodFilter = btn.getAttribute('data-method-filter') || 'all';
        renderWithdrawalCardsList();
      });
    });

    if (btnRefreshWithdrawals) {
      btnRefreshWithdrawals.addEventListener('click', async () => {
        showToast('Refreshing settlement ledger...');
        await fetchWebmasterProfile();
      });
    }

    // 7b. Reward Details Filter Tabs & Refresh
    document.querySelectorAll('[data-reward-period]').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('[data-reward-period]').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        rewardDateFilter = btn.getAttribute('data-reward-period') || 'all';
        renderRewardRecordsList();
      });
    });

    document.querySelectorAll('[data-source-filter]').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('[data-source-filter]').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        rewardSourceFilter = btn.getAttribute('data-source-filter') || 'all';
        renderRewardRecordsList();
      });
    });

    const btnRefreshRewards = document.getElementById('btnRefreshRewards');
    if (btnRefreshRewards) {
      btnRefreshRewards.addEventListener('click', async () => {
        showToast('Refreshing reward details...');
        await fetchWebmasterProfile();
      });
    }

    // 8. 3-Step Withdrawal Modal Logic
    const btnOpenWd = document.getElementById('btnOpenWithdrawalModal') || btnOpenWithdrawalModal;
    if (btnOpenWd) {
      btnOpenWd.addEventListener('click', (e) => {
        e.preventDefault();
        openWithdrawalModal();
      });
    }

    const whBtnNewWd = document.getElementById('whBtnNewWithdraw');
    if (whBtnNewWd) {
      whBtnNewWd.addEventListener('click', (e) => {
        e.preventDefault();
        openWithdrawalModal();
      });
    }

    const btnCloseWd = document.getElementById('btnCloseWithdrawModal') || btnCloseWithdrawModal;
    if (btnCloseWd) {
      btnCloseWd.addEventListener('click', (e) => {
        e.preventDefault();
        closeWithdrawalModal();
      });
    }

    const wModal = document.getElementById('withdrawModal') || withdrawModal;
    if (wModal) {
      wModal.addEventListener('click', (e) => {
        if (e.target === wModal) closeWithdrawalModal();
      });
    }

    // Step 0: Method Selection
    document.querySelectorAll('.modal-method-card').forEach(card => {
      card.addEventListener('click', () => {
        document.querySelectorAll('.modal-method-card').forEach(c => c.classList.remove('active'));
        card.classList.add('active');
        const radio = card.querySelector('input');
        if (radio) {
          radio.checked = true;
          selectedPayoutMethod = radio.value;
        }
      });
    });

    const s0Cont = document.getElementById('btnStep0Continue') || btnStep0Continue;
    if (s0Cont) {
      s0Cont.addEventListener('click', () => setWithdrawModalStep(1));
    }

    // Step 1: Amount & Account Details
    const s1Back = document.getElementById('btnStep1Back') || btnStep1Back;
    if (s1Back) {
      s1Back.addEventListener('click', () => setWithdrawModalStep(0));
    }

    const pMin = document.getElementById('presetMinBtn') || presetMinBtn;
    if (pMin) {
      pMin.addEventListener('click', () => {
        const amtInp = document.getElementById('inputWithdrawUsdAmount') || inputWithdrawUsdAmount;
        if (amtInp) {
          amtInp.value = (adminConfig.minWithdrawalUsd || 1.0).toFixed(2);
          updateInrEstimate();
        }
      });
    }

    const p50 = document.getElementById('preset50Btn') || preset50Btn;
    if (p50) {
      p50.addEventListener('click', () => {
        const avail = (currentProfile && currentProfile.walletBalanceUsd) || 0.0;
        const amtInp = document.getElementById('inputWithdrawUsdAmount') || inputWithdrawUsdAmount;
        if (amtInp) {
          amtInp.value = (avail / 2).toFixed(2);
          updateInrEstimate();
        }
      });
    }

    const pMax = document.getElementById('presetMaxBtn') || presetMaxBtn;
    if (pMax) {
      pMax.addEventListener('click', () => {
        const avail = (currentProfile && currentProfile.walletBalanceUsd) || 0.0;
        const amtInp = document.getElementById('inputWithdrawUsdAmount') || inputWithdrawUsdAmount;
        if (amtInp) {
          amtInp.value = avail.toFixed(4);
          updateInrEstimate();
        }
      });
    }

    const amtInp = document.getElementById('inputWithdrawUsdAmount') || inputWithdrawUsdAmount;
    if (amtInp) {
      amtInp.addEventListener('input', updateInrEstimate);
    }

    const btnPasteAccount = document.getElementById('btnPasteAccount');
    const destInp = document.getElementById('inputDestinationAccount') || inputDestinationAccount;
    if (btnPasteAccount && destInp) {
      btnPasteAccount.addEventListener('click', async () => {
        try {
          if (navigator.clipboard && navigator.clipboard.readText) {
            const text = await navigator.clipboard.readText();
            if (text) {
              destInp.value = text.trim();
              validateAccountInput();
              showToast('Pasted from clipboard!');
            }
          } else {
            showToast('Please paste manually.');
          }
        } catch (_) {
          showToast('Please paste manually.');
        }
      });
    }

    if (destInp) {
      destInp.addEventListener('input', validateAccountInput);
    }

    const s1Cont = document.getElementById('btnStep1Continue') || btnStep1Continue;
    if (s1Cont) {
      s1Cont.addEventListener('click', () => {
        const curAmtInp = document.getElementById('inputWithdrawUsdAmount') || inputWithdrawUsdAmount;
        const amt = parseFloat(curAmtInp ? curAmtInp.value : '0');
        const minPayout = adminConfig.minWithdrawalUsd || 1.0;
        const avail = (currentProfile && currentProfile.walletBalanceUsd) || 0.0;

        if (isNaN(amt) || amt < minPayout) {
          showModal1Error(`Minimum withdrawal amount is ${formatShortUsd(minPayout)} USD.`);
          return;
        }

        if (amt > avail) {
          showModal1Error(`Insufficient balance. Maximum available is ${formatUsd(avail)}.`);
          return;
        }

        const isValid = validateAccountInput();
        if (!isValid) {
          const isUpi = selectedPayoutMethod === 'upi';
          showModal1Error(isUpi ? 'Please enter a valid UPI ID (e.g. username@oksbi).' : 'Please enter a valid 42-char BSC BEP-20 address starting with 0x.');
          return;
        }

        setWithdrawModalStep(2);
      });
    }

    // Step 2: Review & Submission
    const s2Back = document.getElementById('btnStep2Back') || btnStep2Back;
    if (s2Back) {
      s2Back.addEventListener('click', () => setWithdrawModalStep(1));
    }

    const s2Sub = document.getElementById('btnStep2Submit') || btnStep2Submit;
    if (s2Sub) {
      s2Sub.addEventListener('click', handleFinalWithdrawalSubmit);
    }

    // 9. Receipt Modal
    const rModal = document.getElementById('receiptModal') || receiptModal;
    if (rModal) {
      rModal.addEventListener('click', (e) => {
        if (e.target === rModal) closeReceiptModal();
      });
    }

    const btnCloseReceipt = document.getElementById('btnCloseReceiptModal') || btnCloseReceiptModal;
    if (btnCloseReceipt) {
      btnCloseReceipt.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        closeReceiptModal();
      });
    }

    // 10. QR Modal
    const qModal = document.getElementById('qrModal') || qrModal;
    if (qModal) {
      qModal.addEventListener('click', (e) => {
        if (e.target === qModal) closeQrModal();
      });
    }

    const btnCloseQr = document.getElementById('btnCloseQrModal') || btnCloseQrModal;
    if (btnCloseQr) {
      btnCloseQr.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        closeQrModal();
      });
    }

    if (btnCopyQrUrl && qrTextValue) {
      btnCopyQrUrl.addEventListener('click', () => {
        copyToClipboard(qrTextValue.value, 'Link copied to clipboard!');
      });
    }

    // 10b. Rules & Guidelines Modal
    const rulesModal = document.getElementById('rulesModal');
    const btnOpenRulesModal = document.getElementById('btnOpenRulesModal');
    const btnCloseRulesModal = document.getElementById('btnCloseRulesModal');
    const btnCloseRulesBtn = document.getElementById('btnCloseRulesBtn');
    if (btnOpenRulesModal && rulesModal) {
      btnOpenRulesModal.addEventListener('click', () => {
        rulesModal.style.display = 'flex';
        requestAnimationFrame(() => {
          rulesModal.classList.add('open');
          rulesModal.setAttribute('data-open', 'true');
        });
      });
    }
    if (btnCloseRulesModal && rulesModal) {
      btnCloseRulesModal.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        closeRulesModal();
      });
    }
    if (btnCloseRulesBtn && rulesModal) {
      btnCloseRulesBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        closeRulesModal();
      });
    }
    if (rulesModal) {
      rulesModal.addEventListener('click', (e) => {
        if (e.target === rulesModal) closeRulesModal();
      });
    }

    // 11. Partner Program Enrollment Action Button
    const btnHandleEnrollNow = document.getElementById('btnHandleEnrollNow');
    if (btnHandleEnrollNow) {
      btnHandleEnrollNow.addEventListener('click', handleJoinProgram);
    }
    const btnJoinWebmasterProgram = document.getElementById('btnJoinWebmasterProgram');
    if (btnJoinWebmasterProgram) {
      btnJoinWebmasterProgram.addEventListener('click', handleJoinProgram);
    }
  }

  // ══════════════════════════════════════════════════════════
  // GLOBAL EXPORTS & BOOTSTRAP
  // ══════════════════════════════════════════════════════════
  window.webmasterFlutter = {
    navigateToScreen,
    copyLink: (url, msg) => copyToClipboard(url, msg || 'Link copied to clipboard!'),
    copyTxnHash: (hash) => copyToClipboard(hash, 'Transaction Reference copied!'),
    previewLink: (url) => openSafeExternalUrl(url),
    shareSocial: launchSocialShare,
    showQrModal: openQrModal,
    openQrModal,
    closeQrModal,
    openReceiptModal,
    closeReceiptModal,
    closeRulesModal,
    openWithdrawalModal,
    closeWithdrawalModal,
    setWithdrawModalStep,
    refreshData: fetchWebmasterProfile,
  };

  document.addEventListener('DOMContentLoaded', async () => {
    parseUrlParameters();
    bindEventListeners();

    // Strict Security Protocol: If not running inside the official TeraBox mobile app and no valid token, strictly lock out
    if (!isInApp && !ssoToken) {
      navigateToScreen('screen-unauthorized-access', false);
      if (loadingOverlay) {
        loadingOverlay.style.opacity = '0';
        setTimeout(() => { loadingOverlay.style.display = 'none'; }, 200);
      }
      document.body.classList.remove('loading-state');
      return;
    }

    await fetchProgramStatus();
    await fetchWebmasterProfile();

    // Periodic live sync (paused automatically when modal is open to ensure 100% lag-free UI)
    pollTimer = setInterval(async () => {
      if (isAnyModalOpen()) return;
      await fetchProgramStatus();
      if (currentProfile && currentProfile.referralCode) {
        await fetchWebmasterProfile();
        await fetchWebmasterReferralsData();
      }
    }, 20000);
  });

})();
