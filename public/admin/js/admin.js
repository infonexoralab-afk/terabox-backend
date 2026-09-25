// AirBox Enterprise Control Tower - Administrative Client Engine
// Complete Full-Stack Vanilla Architecture (Zero External Frameworks)

const AdminApp = {
  state: {
    token: localStorage.getItem('tb_admin_token') || null,
    admin: null,
    activeTab: 'overview',
    stats: null,
    telemetry: null,
    config: null,
    ws: null,
    users: [],
    webmasters: [],
    referrals: [],
    withdrawals: [],
    snapshots: [],
  },

  init() {
    this.bindEvents();
    if (this.state.token) {
      this.verifyAuth();
    } else {
      this.showLogin();
    }
  },

  bindEvents() {
    // Login Form Submit
    const loginForm = document.getElementById('login-form');
    if (loginForm) {
      loginForm.addEventListener('submit', (e) => {
        e.preventDefault();
        this.handleLogin();
      });
    }

    // Nav Item Clicks
    document.querySelectorAll('.nav-item').forEach(item => {
      item.addEventListener('click', (e) => {
        e.preventDefault();
        const tab = item.getAttribute('data-tab');
        if (tab) {
          this.switchTab(tab);
          this.toggleMobileSidebar(false);
        }
      });
    });

    // Logout Click
    const btnLogout = document.getElementById('btn-logout');
    if (btnLogout) {
      btnLogout.addEventListener('click', () => this.handleLogout());
    }

    // Refresh telemetry every 10s fallback if WS is not active
    setInterval(() => {
      if (this.state.token && this.state.activeTab === 'overview') {
        this.loadDashboardStats();
      }
    }, 10000);
  },

  // -------------------------------------------------------------
  // MODERN FLOATING TOAST NOTIFICATION ENGINE
  // -------------------------------------------------------------
  showToast(message, type = 'success', duration = 3500) {
    let container = document.getElementById('admin-toast-container');
    if (!container) {
      container = document.createElement('div');
      container.id = 'admin-toast-container';
      container.className = 'admin-toast-container';
      document.body.appendChild(container);
    }

    const toast = document.createElement('div');
    toast.className = `admin-toast-item toast-${type}`;

    let iconSvg = '';
    if (type === 'success') {
      iconSvg = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#10B981" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>';
    } else if (type === 'error') {
      iconSvg = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#EF4444" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>';
    } else if (type === 'warning') {
      iconSvg = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#F59E0B" stroke-width="2.5"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>';
    } else {
      iconSvg = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#3B82F6" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>';
    }

    toast.innerHTML = `
      <span style="display:flex; align-items:center;">${iconSvg}</span>
      <span style="flex:1;">${this.escapeHtml(message)}</span>
    `;

    toast.addEventListener('click', () => {
      toast.classList.add('toast-hide');
      setTimeout(() => toast.remove(), 250);
    });

    container.appendChild(toast);

    setTimeout(() => {
      if (toast.parentElement) {
        toast.classList.add('toast-hide');
        setTimeout(() => toast.remove(), 250);
      }
    }, duration);
  },

  // -------------------------------------------------------------
  // API CLIENT HELPER
  // -------------------------------------------------------------
  async api(endpoint, options = {}) {
    const headers = {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    };

    if (this.state.token && endpoint !== '/auth/login') {
      headers['Authorization'] = `Bearer ${this.state.token}`;
      headers['x-admin-token'] = this.state.token;
    }

    try {
      const res = await fetch(`/api/v1/admin${endpoint}`, {
        ...options,
        headers,
      });

      if (res.status === 401) {
        if (endpoint !== '/auth/login') {
          console.warn('[AdminApp] 401 on endpoint:', endpoint);
          if (endpoint === '/auth/me') {
            this.handleLogout();
          }
          throw new Error('Administrative session expired. Please sign in.');
        } else {
          const errData = await res.json().catch(() => ({}));
          throw new Error(errData.error || 'Invalid administrative credentials');
        }
      }

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || `Server error (${res.status})`);
      }

      const data = await res.json();
      return data;
    } catch (err) {
      console.error(`API Error [${endpoint}]:`, err);
      throw err;
    }
  },

  // -------------------------------------------------------------
  // AUTHENTICATION
  // -------------------------------------------------------------
  async handleLogin() {
    const idInput = document.getElementById('login-identifier');
    const pwdInput = document.getElementById('login-password');
    const btnSubmit = document.getElementById('btn-login-submit');
    const errEl = document.getElementById('login-error');

    if (!idInput || !pwdInput) return;

    const identifier = idInput.value.trim();
    const password = pwdInput.value;

    if (!identifier || !password) {
      if (errEl) {
        errEl.textContent = 'Please enter both identifier and password.';
        errEl.style.display = 'block';
      }
      return;
    }

    btnSubmit.disabled = true;
    btnSubmit.textContent = 'Authenticating...';
    if (errEl) errEl.style.display = 'none';

    try {
      const data = await this.api('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ identifier, password }),
      });

      if (data && data.success && data.token) {
        this.state.token = data.token;
        this.state.admin = data.admin || { email: identifier, displayName: 'Master Super Administrator' };
        localStorage.setItem('tb_admin_token', data.token);

        // Instantly hide login card & show Control Tower workspace
        this.hideLogin();
        this.startSession();
        this.showToast('Welcome back, ' + (this.state.admin.displayName || 'Super Admin'));
      } else {
        throw new Error(data?.error || 'Authentication failed. Invalid administrative credentials.');
      }
    } catch (err) {
      console.error('[AdminApp] Login failed:', err);
      if (errEl) {
        errEl.textContent = err.message || 'Invalid administrative credentials. Please check password.';
        errEl.style.display = 'block';
      }
    } finally {
      btnSubmit.disabled = false;
      btnSubmit.textContent = 'Sign In to Control Tower';
    }
  },

  async verifyAuth() {
    try {
      const data = await this.api('/auth/me');
      if (data && data.success) {
        this.state.admin = data.admin;
        this.hideLogin();
        this.startSession();
      } else {
        this.handleLogout();
      }
    } catch (_) {
      this.handleLogout();
    }
  },

  handleLogout() {
    this.state.token = null;
    this.state.admin = null;
    localStorage.removeItem('tb_admin_token');
    if (this.state.ws) {
      try { this.state.ws.close(); } catch (_) { }
      this.state.ws = null;
    }
    this.showLogin();
  },

  showLogin() {
    const overlay = document.getElementById('auth-overlay');
    const container = document.getElementById('app-container');
    if (overlay) overlay.style.display = 'flex';
    if (container) container.style.display = 'none';
  },

  hideLogin() {
    const overlay = document.getElementById('auth-overlay');
    const container = document.getElementById('app-container');
    if (overlay) overlay.style.display = 'none';
    if (container) container.style.display = 'flex';
  },

  startSession() {
    this.updateAdminHeader();
    try { this.initWebSocket(); } catch (_) { }
    this.switchTab(this.state.activeTab || 'overview');
  },

  updateAdminHeader() {
    if (this.state.admin) {
      const nameEl = document.getElementById('current-admin-name');
      const emailEl = document.getElementById('current-admin-email');
      if (nameEl) nameEl.textContent = this.state.admin.displayName || this.state.admin.username || 'Super Admin';
      if (emailEl) emailEl.textContent = this.state.admin.email || 'superadmin@airbox.one';
    }
  },

  // -------------------------------------------------------------
  // REAL-TIME WEBSOCKET TELEMETRY
  // -------------------------------------------------------------
  initWebSocket() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws/admin?token=${this.state.token}`;

    try {
      this.state.ws = new WebSocket(wsUrl);

      this.state.ws.onopen = () => {
        console.log('[Control Tower WS] Connected to telemetry stream');
        const pill = document.getElementById('ws-status-pill');
        if (pill) {
          pill.className = 'status-indicator';
          pill.innerHTML = '<span class="status-dot"></span> Live Stream Active';
        }
      };

      this.state.ws.onmessage = (event) => {
        try {
          const payload = JSON.parse(event.data);
          this.handleWebSocketMessage(payload);
        } catch (_) { }
      };

      this.state.ws.onclose = () => {
        const pill = document.getElementById('ws-status-pill');
        if (pill) {
          pill.className = 'status-indicator badge-warning';
          pill.innerHTML = '<span class="status-dot" style="background:#F59E0B"></span> Reconnecting...';
        }
        setTimeout(() => {
          if (this.state.token) this.initWebSocket();
        }, 5000);
      };
    } catch (err) {
      console.warn('[Control Tower WS] Error initializing:', err);
    }
  },

  handleWebSocketMessage(payload) {
    if (payload.type === 'TELEMETRY_UPDATE' && payload.data) {
      this.renderLiveTelemetry(payload.data);
    }
  },

  renderLiveTelemetry(telemetry) {
    // Update CPU widget
    const cpuVal = document.getElementById('live-cpu-val');
    const cpuFill = document.getElementById('live-cpu-fill');
    if (cpuVal && telemetry.cpuPercent !== undefined) {
      cpuVal.textContent = `${telemetry.cpuPercent.toFixed(1)}%`;
      if (cpuFill) cpuFill.style.width = `${Math.min(100, telemetry.cpuPercent)}%`;
    }

    // Update RAM widget
    const memVal = document.getElementById('live-ram-val');
    const memFill = document.getElementById('live-ram-fill');
    if (memVal && telemetry.memUsedPercent !== undefined) {
      memVal.textContent = `${telemetry.memUsedPercent.toFixed(1)}% (${telemetry.memUsedMb} MB / ${telemetry.memTotalMb} MB)`;
      if (memFill) memFill.style.width = `${Math.min(100, telemetry.memUsedPercent)}%`;
    }

    // Update Uptime
    const upVal = document.getElementById('live-uptime-val');
    if (upVal && telemetry.uptimeSeconds) {
      const hours = Math.floor(telemetry.uptimeSeconds / 3600);
      const mins = Math.floor((telemetry.uptimeSeconds % 3600) / 60);
      upVal.textContent = `${hours}h ${mins}m`;
    }

    // Update Node Badge
    const nodeBadge = document.getElementById('vps-node-badge');
    if (nodeBadge) {
      const host = window.location.hostname || 'airbox.one';
      nodeBadge.textContent = `VPS Node 213.136.67.9 (${host})`;
    }
  },

  // -------------------------------------------------------------
  // TAB NAVIGATION & ROUTING
  // -------------------------------------------------------------
  toggleMobileSidebar(open) {
    const sidebar = document.querySelector('.sidebar');
    const backdrop = document.getElementById('sidebar-backdrop');
    if (!sidebar) return;

    if (open === undefined) {
      sidebar.classList.toggle('open');
    } else if (open) {
      sidebar.classList.add('open');
    } else {
      sidebar.classList.remove('open');
    }

    if (backdrop) {
      if (sidebar.classList.contains('open')) {
        backdrop.classList.add('active');
      } else {
        backdrop.classList.remove('active');
      }
    }
  },

  switchTab(tabName) {
    this.state.activeTab = tabName;

    // Update Sidebar Navigation UI
    document.querySelectorAll('.nav-item').forEach(item => {
      if (item.getAttribute('data-tab') === tabName) {
        item.classList.add('active');
      } else {
        item.classList.remove('active');
      }
    });

    // Hide all tab viewports
    document.querySelectorAll('.tab-view').forEach(view => {
      view.style.display = 'none';
    });

    // Show target view
    const target = document.getElementById(`tab-${tabName}`);
    if (target) {
      target.style.display = 'block';
    }

    // Load data for specific tab
    switch (tabName) {
      case 'overview':
        this.loadDashboardStats();
        break;
      case 'users':
        this.loadUsers();
        break;
      case 'webmasters':
        this.loadWebmasters();
        break;
      case 'storage':
        this.loadStorage();
        break;
      case 'financials':
        this.loadFinancials();
        break;
      case 'vps':
        this.loadVpsTelemetry();
        break;
      case 'config':
        this.loadConfig();
        break;
      case 'audit':
        this.loadAuditLogs();
        break;
    }
  },

  // -------------------------------------------------------------
  // TAB 1: OVERVIEW DASHBOARD
  // -------------------------------------------------------------
  async loadDashboardStats() {
    try {
      const data = await this.api('/dashboard/stats');
      if (data.success && data.stats) {
        this.state.stats = data.stats;
        this.renderOverviewMetrics(data.stats);
      }
    } catch (err) {
      console.warn('Dashboard stats error:', err);
    }
  },

  renderOverviewMetrics(s) {
    document.getElementById('metric-total-users').textContent = (s.totalUsers || 0).toLocaleString();
    document.getElementById('metric-active-users').textContent = `${s.activeUsers || 0} Active Accounts`;

    const storageGbFormatted = (s.totalStorageGb !== undefined && s.totalStorageGb !== null)
      ? Number(s.totalStorageGb).toFixed(2)
      : '0.00';
    document.getElementById('metric-storage-gb').textContent = `${storageGbFormatted} GB`;
    const storageSubtext = document.getElementById('metric-storage-subtext');
    if (storageSubtext) {
      if (s.r2ObjectsCount) {
        storageSubtext.textContent = `Cloudflare R2 (${s.r2ObjectsCount} Objects, Zero Egress)`;
      } else {
        storageSubtext.textContent = 'Cloudflare R2 Bucket (Zero Egress)';
      }
    }
    document.getElementById('metric-webmaster-earnings').textContent = `$${(s.totalWebmasterEarningsUsd || 0).toFixed(2)}`;
    document.getElementById('metric-pending-payouts').textContent = `$${(s.pendingWithdrawalUsd || 0).toFixed(2)}`;
    document.getElementById('metric-total-withdrawn').textContent = `Total Paid: $${(s.totalWithdrawnUsd || 0).toFixed(2)}`;

    // Program status pill
    const progStatusEl = document.getElementById('overview-webmaster-status');
    if (progStatusEl) {
      if (s.webmasterProgramEnabled) {
        progStatusEl.className = 'badge badge-success';
        progStatusEl.textContent = 'Active ($4.00 CPM)';
      } else {
        progStatusEl.className = 'badge badge-danger';
        progStatusEl.textContent = 'Disabled (Coming Soon)';
      }
    }
  },

  // -------------------------------------------------------------
  // -------------------------------------------------------------
  // TAB 2: USERS, CALCULATIONS & DEEP INTELLIGENCE
  // -------------------------------------------------------------
  async loadUsers(search = '') {
    const tbody = document.getElementById('users-table-body');
    if (tbody) tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:24px;">Loading user accounts & live calculations...</td></tr>';

    try {
      const q = search ? `?search=${encodeURIComponent(search)}` : '';
      const data = await this.api(`/users${q}`);
      this.state.users = data.users || [];
      this.renderUsersTable(this.state.users);
    } catch (err) {
      if (tbody) tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;color:var(--status-danger);">Failed to load users: ${err.message}</td></tr>`;
    }
  },

  renderUsersTable(users) {
    const tbody = document.getElementById('users-table-body');
    if (!tbody) return;

    if (users.length === 0) {
      tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:24px;">No user accounts found.</td></tr>';
      return;
    }

    tbody.innerHTML = users.map(u => {
      const formatBytesHuman = (bytes) => {
        if (!bytes || bytes <= 0) return '0 MB';
        if (bytes >= (1024 ** 4)) return (bytes / (1024 ** 4)).toFixed(1) + ' TB';
        if (bytes >= (1024 ** 3)) {
          const gb = bytes / (1024 ** 3);
          return (gb % 1 === 0 ? gb.toFixed(0) : gb.toFixed(1)) + ' GB';
        }
        return (bytes / (1024 ** 2)).toFixed(0) + ' MB';
      };

      const quotaBytes = u.totalSpaceBytes || 1099511627776;
      const usedBytes = u.usedSpaceBytes || 0;
      const quotaStr = formatBytesHuman(quotaBytes);
      const usedStr = formatBytesHuman(usedBytes);
      const percentUsed = Math.min(100, Math.round((usedBytes / quotaBytes) * 1000) / 10);

      const isBanned = u.status === 'BANNED' || u.status === 'SUSPENDED';
      const identifier = u.email || u.phone || u.displayName || u.id;
      const grossEarnings = (u.totalEarningsUsd || 0.0).toFixed(2);
      const walletBal = (u.walletBalanceUsd || 0.0).toFixed(2);
      const refsCount = u.referralsCount || 0;
      const qualifiedRefs = u.qualifiedReferralsCount || 0;

      return `
        <tr>
          <td>
            <div style="display: flex; align-items: center; gap: 6px; flex-wrap: wrap;">
              <span class="mono-text" style="font-weight: 700; color: var(--text-primary); font-size: 12px;">${this.escapeHtml(u.id || 'N/A')}</span>
              ${u.isVip ? '<span class="badge badge-warning" style="font-size: 10px; padding: 1px 6px;">VIP</span>' : ''}
              ${u.isEnrolledWebmaster ? `<span class="badge badge-info" style="font-size: 10px; padding: 1px 6px;">${this.escapeHtml(u.referralCode || 'CREATOR')}</span>` : ''}
            </div>
            <div style="margin-top: 4px;">
              <span class="badge ${isBanned ? 'badge-danger' : 'badge-success'}" style="font-size: 10.5px;">${u.status || 'ACTIVE'}</span>
            </div>
          </td>

          <td>
            <div style="display: flex; align-items: center; gap: 8px;">
              <div style="width: 32px; height: 32px; border-radius: 50%; background: var(--primary-light); color: var(--primary); display: flex; align-items: center; justify-content: center; font-weight: 800; font-size: 13px; flex-shrink: 0;">
                ${this.escapeHtml((u.displayName || u.email || 'U').charAt(0).toUpperCase())}
              </div>
              <div>
                <strong style="color: var(--text-primary); font-size: 13px;">${this.escapeHtml(u.displayName || 'AirBox User')}</strong><br/>
                <span style="color: var(--text-muted); font-size: 11.5px;">${this.escapeHtml(u.email || u.phone || 'No Email')}</span>
              </div>
            </div>
          </td>

          <td>
            <strong style="color: #059669; font-size: 13.5px; font-family: var(--font-mono);">$${grossEarnings}</strong>
            <div style="font-size: 11px; color: var(--text-muted); margin-top: 2px;">
              Avail: <span class="mono-text" style="color: #2563EB;">$${walletBal}</span>
            </div>
          </td>

          <td>
            <div style="display: flex; align-items: center; gap: 4px;">
              <strong style="color: #7C3AED; font-size: 13px; font-family: var(--font-mono);">${refsCount}</strong>
              <span style="font-size: 11px; color: var(--text-muted);">Users</span>
            </div>
            <div style="font-size: 10.5px; color: #059669; font-weight: 600; margin-top: 2px;">
              ${qualifiedRefs} Qualified
            </div>
          </td>

          <td>
            <div style="font-size: 12px; font-weight: 600; color: var(--text-primary);">
              <span class="mono-text">${usedStr}</span> <span style="color: var(--text-muted); font-weight: 400;">/ ${quotaStr}</span>
            </div>
            <div class="progress-track" style="height: 4px; max-width: 140px; margin-top: 4px;">
              <div class="progress-fill" style="width: ${percentUsed}%; background: ${percentUsed > 90 ? '#DC2626' : (percentUsed > 70 ? '#F59E0B' : '#0066FF')};"></div>
            </div>
            <div style="font-size: 10.5px; color: var(--text-muted); margin-top: 2px;">
              ${percentUsed}% utilized &bull; ${u.sharesCount || 0} shares
            </div>
          </td>

          <td>
            <span class="mono-text" style="font-size: 11.5px; color: var(--text-secondary);">
              ${u.createdAt ? new Date(u.createdAt).toLocaleDateString() : 'N/A'}
            </span>
          </td>

          <td style="text-align: right;">
            <div style="display: inline-flex; align-items: center; gap: 4px; flex-wrap: nowrap;">
              <button class="btn-sm btn-primary" onclick="AdminApp.openUserIntelligenceModal('${u.id}')" title="Deep User Intelligence & Calculations" style="display: inline-flex; align-items: center; gap: 4px; padding: 4px 8px; font-size: 11.5px; font-weight: 700;">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
                Inspect
              </button>
              <button class="btn-sm btn-secondary" onclick="AdminApp.openQuotaModal('${u.id}', ${quotaBytes})" title="Set Storage Quota" style="padding: 4px 7px; font-size: 11.5px;">
                Quota
              </button>
              <button class="btn-sm ${isBanned ? 'btn-secondary' : 'btn-danger'}" onclick="AdminApp.toggleUserStatus('${u.id}', '${isBanned ? 'ACTIVE' : 'BANNED'}')" style="padding: 4px 7px; font-size: 11.5px;">
                ${isBanned ? 'Unban' : 'Ban'}
              </button>
              <button class="btn-sm btn-danger" onclick="AdminApp.deleteUserAccount('${u.id}', '${identifier}')" title="Permanent Delete" style="padding: 4px 6px; font-size: 11.5px;">
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
              </button>
            </div>
          </td>
        </tr>
      `;
    }).join('');
  },

  // -------------------------------------------------------------
  // DEEP USER INTELLIGENCE & CALCULATION MODAL CONTROLLER
  // -------------------------------------------------------------
  async openUserIntelligenceModal(userId) {
    const modal = document.getElementById('user-intelligence-modal');
    if (!modal) return;

    modal.style.display = 'flex';
    this.state.currentModalUserId = userId;

    // Reset fields to loading state
    document.getElementById('uim-name').textContent = 'Loading User Profile...';
    document.getElementById('uim-email').textContent = 'Fetching deep calculations & telemetry...';
    document.getElementById('uim-phone').textContent = '-';
    document.getElementById('uim-id').textContent = userId;
    document.getElementById('uim-joined-date').textContent = '-';
    document.getElementById('uim-kpi-gross-earnings').textContent = '...';
    document.getElementById('uim-kpi-wallet-balance').textContent = '...';
    document.getElementById('uim-kpi-referrals-count').textContent = '...';
    document.getElementById('uim-kpi-storage-used').textContent = '...';

    try {
      const data = await this.api(`/users/${encodeURIComponent(userId)}/details`);
      if (!data || !data.success) throw new Error((data && data.error) || 'Failed to fetch user intelligence');

      this.state.currentModalUser = data;
      this.populateUserIntelligenceModal(data);
    } catch (err) {
      console.error('[AdminApp] User details error:', err);
      this.showToast(`Could not load user profile: ${err.message}`, 'error');
      document.getElementById('uim-name').textContent = 'Notice: Profile Load Delayed';
      document.getElementById('uim-email').innerHTML = `<span style="color:#EF4444; font-weight:600;">${this.escapeHtml(err.message)}</span> &bull; <button class="btn-sm btn-primary" onclick="AdminApp.openUserIntelligenceModal('${userId}')" style="padding:2px 8px; font-size:11px; margin-left:6px;">Retry Loading</button>`;
    }
  },

  populateUserIntelligenceModal(d) {
    const u = d.user || {};
    const f = d.financials || {};
    const r = d.referralNetwork || {};
    const s = d.storage || {};

    const formatBytesHuman = (bytes) => {
      if (!bytes || bytes <= 0) return '0 MB';
      if (bytes >= (1024 ** 4)) return (bytes / (1024 ** 4)).toFixed(1) + ' TB';
      if (bytes >= (1024 ** 3)) {
        const gb = bytes / (1024 ** 3);
        return (gb % 1 === 0 ? gb.toFixed(0) : gb.toFixed(1)) + ' GB';
      }
      return (bytes / (1024 ** 2)).toFixed(0) + ' MB';
    };

    // 1. Header Profile Info
    const avatarEl = document.getElementById('uim-avatar');
    if (avatarEl) {
      avatarEl.textContent = (u.displayName || u.email || 'U').charAt(0).toUpperCase();
    }

    document.getElementById('uim-name').textContent = u.displayName || 'AirBox User';
    document.getElementById('uim-email').textContent = u.email || 'No Email';
    document.getElementById('uim-phone').textContent = u.phone || 'N/A';
    document.getElementById('uim-id').textContent = u.id || 'N/A';
    document.getElementById('uim-joined-date').textContent = u.createdAt ? new Date(u.createdAt).toLocaleString() : 'N/A';

    // Status Badge
    const statusBadge = document.getElementById('uim-status-badge');
    const isBanned = u.status === 'BANNED' || u.status === 'SUSPENDED';
    if (statusBadge) {
      statusBadge.className = `badge ${isBanned ? 'badge-danger' : 'badge-success'}`;
      statusBadge.textContent = u.status || 'ACTIVE';
    }

    // VIP Badge
    const vipBadge = document.getElementById('uim-vip-badge');
    if (vipBadge) {
      vipBadge.style.display = u.isVip ? 'inline-block' : 'none';
    }

    // Creator Badge
    const creatorBadge = document.getElementById('uim-creator-badge');
    if (creatorBadge) {
      if (r.isEnrolled && r.referralCode) {
        creatorBadge.style.display = 'inline-block';
        creatorBadge.textContent = `CREATOR: ${r.referralCode}`;
      } else {
        creatorBadge.style.display = 'none';
      }
    }

    // 2. 4 Calculation KPI Cards
    // KPI 1: Gross Earnings
    document.getElementById('uim-kpi-gross-earnings').textContent = `$${(f.grossEarningsUsd || 0).toFixed(2)}`;
    document.getElementById('uim-kpi-earnings-breakdown').innerHTML = `Plays: <strong style="color:var(--text-primary);">$${(f.videoPlayEarningsUsd || 0).toFixed(2)}</strong> &bull; Referral CPA: <strong style="color:var(--text-primary);">$${(f.referralEarningsUsd || 0).toFixed(2)}</strong>`;

    // KPI 2: Wallet & Payouts
    document.getElementById('uim-kpi-wallet-balance').textContent = `$${(f.walletBalanceUsd || 0).toFixed(2)}`;
    document.getElementById('uim-kpi-payouts-subtext').innerHTML = `Withdrawn: <strong style="color:var(--text-primary);">$${(f.totalWithdrawnUsd || 0).toFixed(2)}</strong> &bull; Pending: <strong style="color:#D97706;">$${(f.pendingWithdrawalsUsd || 0).toFixed(2)}</strong>`;

    // KPI 3: Referral Network
    const refStats = r.stats || {};
    document.getElementById('uim-kpi-referrals-count').textContent = `${refStats.total || 0} Users`;
    const parentRef = r.referredBy;
    if (parentRef) {
      document.getElementById('uim-kpi-referrer-subtext').innerHTML = `Referred by: <strong style="color:var(--primary);">${this.escapeHtml(parentRef.referralCode)}</strong> (${this.escapeHtml(parentRef.webmasterName || parentRef.webmasterEmail || 'Creator')})`;
    } else {
      document.getElementById('uim-kpi-referrer-subtext').textContent = 'Referred by: Direct Organic Registration';
    }

    // KPI 4: Cloud Storage
    const usedHuman = formatBytesHuman(s.usedSpaceBytes || 0);
    const totalHuman = formatBytesHuman(s.totalSpaceBytes || 1099511627776);
    document.getElementById('uim-kpi-storage-used').textContent = `${usedHuman} / ${totalHuman}`;
    const storageBar = document.getElementById('uim-kpi-storage-bar');
    if (storageBar) {
      const p = s.storagePercent || 0;
      storageBar.style.width = `${p}%`;
      storageBar.style.background = p > 90 ? '#DC2626' : (p > 70 ? '#F59E0B' : '#06B6D4');
    }
    document.getElementById('uim-kpi-shares-count').textContent = `${s.totalSharesCount || 0} Active Public Share Links`;

    // Tab count badges
    document.getElementById('uim-tab-ref-badge').textContent = refStats.total || 0;
    document.getElementById('uim-tab-shares-badge').textContent = s.totalSharesCount || 0;

    // 3. Tab 1: Financial Ledger & Earnings
    document.getElementById('uim-active-plan').textContent = f.currentPlan === 'videoPlays' ? `Video Plays ($${(f.effectiveCpmRateUsd || 4.0).toFixed(2)} CPM)` : (f.currentPlan || 'Video Plays');
    document.getElementById('uim-effective-cpm').textContent = `$${(f.effectiveCpmRateUsd || 4.0).toFixed(2)} / 1k views`;
    document.getElementById('uim-cpa-bounty').textContent = `$${(f.cpaRewardUsd || (this.state.config && this.state.config.cpa_reward_per_install_usd) || 0.05).toFixed(2)} / Install`;
    document.getElementById('uim-withdrawable-bal').textContent = `$${(f.walletBalanceUsd || 0).toFixed(2)} USD`;

    const earnTbody = document.getElementById('uim-earnings-tbody');
    const earningRecords = f.earningRecords || [];
    if (earnTbody) {
      if (earningRecords.length === 0) {
        earnTbody.innerHTML = '<tr><td colspan="5" style="text-align:center;padding:18px;color:var(--text-muted);">No earnings ledger records found for this account.</td></tr>';
      } else {
        earnTbody.innerHTML = earningRecords.map(e => `
          <tr>
            <td><span class="mono-text" style="font-size:11.5px;">${e.recordedAt ? new Date(e.recordedAt).toLocaleString() : 'N/A'}</span></td>
            <td><span class="badge badge-info" style="font-size:10px;">${this.escapeHtml((e.type || 'EARNING').toUpperCase())}</span></td>
            <td><strong style="color:var(--text-primary); font-size:12px;">${this.escapeHtml(e.description || 'Credit')}</strong></td>
            <td><strong style="color:#059669; font-family:var(--font-mono); font-size:12.5px;">+$${(Number(e.amountUsd) || 0).toFixed(2)}</strong></td>
            <td><span class="mono-text" style="font-size:11px; color:var(--text-muted);">${this.escapeHtml(e.country || 'GLOBAL')}</span></td>
          </tr>
        `).join('');
      }
    }

    const withTbody = document.getElementById('uim-withdrawals-tbody');
    const withdrawals = f.withdrawals || [];
    if (withTbody) {
      if (withdrawals.length === 0) {
        withTbody.innerHTML = '<tr><td colspan="5" style="text-align:center;padding:18px;color:var(--text-muted);">No withdrawal requests recorded.</td></tr>';
      } else {
        withTbody.innerHTML = withdrawals.map(w => {
          let statusBadgeClass = 'badge-warning';
          if (w.status === 'completed' || w.status === 'approved') statusBadgeClass = 'badge-success';
          if (w.status === 'rejected' || w.status === 'cancelled') statusBadgeClass = 'badge-danger';
          return `
            <tr>
              <td><span class="mono-text" style="font-size:11.5px;">${w.requestedAt ? new Date(w.requestedAt).toLocaleString() : 'N/A'}</span></td>
              <td><strong style="color:var(--text-primary); font-family:var(--font-mono); font-size:13px;">$${(Number(w.amountUsd) || 0).toFixed(2)}</strong></td>
              <td><span class="badge badge-secondary" style="font-size:10.5px;">${this.escapeHtml(w.method || 'USDT')}</span></td>
              <td><span class="mono-text" style="font-size:11px;">${this.escapeHtml(w.destination || w.account || 'N/A')}</span></td>
              <td><span class="badge ${statusBadgeClass}" style="font-size:10px;">${(w.status || 'PENDING').toUpperCase()}</span></td>
            </tr>
          `;
        }).join('');
      }
    }

    // 4. Tab 2: Referral Network Tree
    const parentBox = document.getElementById('uim-parent-attribution-box');
    const parentInfo = document.getElementById('uim-parent-info');
    const parentBadgeCont = document.getElementById('uim-parent-badge-container');

    if (parentRef) {
      parentInfo.innerHTML = `Referred by: <strong style="color:var(--primary); font-family:var(--font-mono);">${this.escapeHtml(parentRef.referralCode)}</strong> &bull; ${this.escapeHtml(parentRef.webmasterName)} (<span class="mono-text">${this.escapeHtml(parentRef.webmasterEmail || 'No Email')}</span>)<br/><span style="font-size:11px; color:var(--text-muted);">Attributed on: ${new Date(parentRef.joinedAt).toLocaleString()} &bull; Reward: $${(parentRef.rewardUsd || 0.05).toFixed(2)}</span>`;
      parentBadgeCont.innerHTML = `<span class="badge badge-success">QUALIFIED REFERRAL</span>`;
    } else {
      parentInfo.textContent = 'Organic Direct Signup (No referral link used during account creation)';
      parentBadgeCont.innerHTML = `<span class="badge badge-info">DIRECT ORGANIC</span>`;
    }

    document.getElementById('uim-referred-summary-pill').textContent = `${refStats.qualified || 0} Qualified / ${refStats.total || 0} Total`;

    const refUsersTbody = document.getElementById('uim-referred-users-tbody');
    const refUsersList = r.referredUsers || [];
    if (refUsersTbody) {
      if (refUsersList.length === 0) {
        refUsersTbody.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:24px;color:var(--text-muted);">No users have joined using this creator referral link yet.</td></tr>';
      } else {
        refUsersTbody.innerHTML = refUsersList.map(ru => {
          let statusChip = '<span class="badge badge-success">QUALIFIED</span>';
          if (ru.status === 'PENDING') statusChip = '<span class="badge badge-warning">PENDING</span>';
          if (ru.status === 'REJECTED') statusChip = `<span class="badge badge-danger" title="${this.escapeHtml(ru.rejectionReason || 'Rejected')}">REJECTED</span>`;

          return `
            <tr>
              <td>
                <strong style="color:var(--text-primary); font-size:12.5px;">${this.escapeHtml(ru.referredUserName || 'AirBox User')}</strong><br/>
                <span style="color:var(--text-muted); font-size:11px;">${this.escapeHtml(ru.referredUserEmail || ru.referredUserId)}</span>
              </td>
              <td>
                <span class="mono-text" style="font-size:11.5px;">${ru.createdAt ? new Date(ru.createdAt).toLocaleDateString() : 'N/A'}</span>
              </td>
              <td>
                <span class="badge badge-info" style="font-size:10px;">${this.escapeHtml(ru.milestone || 'USER_REGISTRATION')}</span>
              </td>
              <td>
                <strong style="color:#059669; font-family:var(--font-mono); font-size:12.5px;">+$${(ru.rewardAmountUsd || 0.05).toFixed(2)}</strong>
              </td>
              <td>
                ${statusChip}
              </td>
              <td>
                <span class="mono-text" style="font-size:11px; color:var(--text-muted);">${this.escapeHtml(ru.clientIp || '127.0.0.1')}</span>
              </td>
            </tr>
          `;
        }).join('');
      }
    }

    // 5. Tab 3: Shared Content & Links
    const sharesTbody = document.getElementById('uim-shares-tbody');
    const sharesList = s.sharedLinks || [];
    if (sharesTbody) {
      if (sharesList.length === 0) {
        sharesTbody.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:24px;color:var(--text-muted);">No public shared links generated by this user.</td></tr>';
      } else {
        sharesTbody.innerHTML = sharesList.map(sh => `
          <tr>
            <td>
              <strong class="mono-text" style="color:var(--primary); font-size:12px;">${this.escapeHtml(sh.code)}</strong>
            </td>
            <td>
              <div style="font-weight:600; color:var(--text-primary); font-size:12.5px; max-width:240px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;" title="${this.escapeHtml(sh.fileName)}">
                ${this.escapeHtml(sh.fileName)}
              </div>
            </td>
            <td>
              <span class="mono-text" style="font-size:11.5px;">${formatBytesHuman(sh.sizeBytes)}</span>
            </td>
            <td>
              <span class="badge badge-info" style="font-family:var(--font-mono); font-size:11px;">${(sh.viewsCount || 0).toLocaleString()} views</span>
            </td>
            <td>
              <span class="mono-text" style="font-size:11.5px; color:var(--text-muted);">${sh.createdAt ? new Date(sh.createdAt).toLocaleDateString() : 'N/A'}</span>
            </td>
            <td>
              <a href="${encodeURI(sh.shareUrl || `https://airbox.one/s/${sh.code}`)}" target="_blank" class="btn-sm btn-secondary" style="text-decoration:none; font-size:11px; display:inline-flex; align-items:center; gap:3px;">
                Open Link
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
              </a>
            </td>
          </tr>
        `).join('');
      }
    }

    // 6. Tab 4: Form Controls Pre-fill
    const currentQuotaBytes = s.totalSpaceBytes || 1099511627776;
    let qVal = 1024;
    let qUnit = 'GB';
    if (currentQuotaBytes < (1024 ** 3)) {
      qUnit = 'MB';
      qVal = Math.round(currentQuotaBytes / (1024 ** 2));
    } else if (currentQuotaBytes >= (1024 ** 4)) {
      qUnit = 'TB';
      qVal = (currentQuotaBytes / (1024 ** 4)).toFixed(1).replace(/\.0$/, '');
    } else {
      qUnit = 'GB';
      qVal = Math.round(currentQuotaBytes / (1024 ** 3));
    }

    const quotaValInput = document.getElementById('uim-ctrl-quota-val');
    const quotaUnitSelect = document.getElementById('uim-ctrl-quota-unit');
    if (quotaValInput) quotaValInput.value = qVal;
    if (quotaUnitSelect) quotaUnitSelect.value = qUnit;

    const vipToggle = document.getElementById('uim-ctrl-vip-toggle');
    if (vipToggle) vipToggle.value = u.isVip ? 'true' : 'false';

    const statusSelect = document.getElementById('uim-ctrl-status-select');
    if (statusSelect) statusSelect.value = u.status || 'ACTIVE';

    const banReasonInput = document.getElementById('uim-ctrl-ban-reason');
    if (banReasonInput) banReasonInput.value = u.banReason || '';
  },

  switchUserModalTab(subtabName) {
    document.querySelectorAll('.user-subtab-btn').forEach(btn => {
      if (btn.getAttribute('data-subtab') === subtabName) {
        btn.classList.add('active');
      } else {
        btn.classList.remove('active');
      }
    });

    document.querySelectorAll('.user-subtab-content').forEach(content => {
      content.style.display = 'none';
      content.classList.remove('active');
    });

    const target = document.getElementById(`uim-tab-content-${subtabName}`);
    if (target) {
      target.style.display = 'block';
      target.classList.add('active');
    }
  },

  setUserModalQuotaPreset(val, unit) {
    const quotaValInput = document.getElementById('uim-ctrl-quota-val');
    const quotaUnitSelect = document.getElementById('uim-ctrl-quota-unit');
    if (quotaValInput) quotaValInput.value = val;
    if (quotaUnitSelect) quotaUnitSelect.value = unit;
  },

  async submitUserModalQuota() {
    const userId = this.state.currentModalUserId;
    if (!userId) return;

    const val = parseFloat(document.getElementById('uim-ctrl-quota-val').value);
    const unit = document.getElementById('uim-ctrl-quota-unit').value;
    if (!val || val <= 0) return this.showToast(`Please enter a valid positive storage quota in ${unit}`, 'warning');

    let bytes = 0;
    if (unit === 'MB') bytes = Math.round(val * 1024 * 1024);
    else if (unit === 'TB') bytes = Math.round(val * 1024 * 1024 * 1024 * 1024);
    else bytes = Math.round(val * 1024 * 1024 * 1024);

    try {
      await this.api(`/users/${encodeURIComponent(userId)}/quota`, {
        method: 'PUT',
        body: JSON.stringify({ quotaBytes: bytes, quotaValue: val, unit }),
      });
      this.showToast(`Storage quota updated to ${val} ${unit}`, 'success');
      this.refreshCurrentUserModal();
      this.loadUsers();
    } catch (err) {
      this.showToast(`Error updating quota: ${err.message}`, 'error');
    }
  },

  async submitUserModalVip() {
    const userId = this.state.currentModalUserId;
    if (!userId) return;

    const isVip = document.getElementById('uim-ctrl-vip-toggle').value === 'true';
    const storageGb = parseFloat(document.getElementById('uim-ctrl-vip-storage').value) || 2048;

    try {
      await this.api(`/users/${encodeURIComponent(userId)}/vip`, {
        method: 'PUT',
        body: JSON.stringify({ isVip, storageGb, durationDays: 365 }),
      });
      this.showToast(isVip ? `Granted VIP status (${storageGb} GB allocation)` : 'Revoked VIP status', 'success');
      this.refreshCurrentUserModal();
      this.loadUsers();
    } catch (err) {
      this.showToast(`Error updating VIP status: ${err.message}`, 'error');
    }
  },

  async submitUserModalStatus() {
    const userId = this.state.currentModalUserId;
    if (!userId) return;

    const status = document.getElementById('uim-ctrl-status-select').value;
    const reason = document.getElementById('uim-ctrl-ban-reason').value.trim();

    if ((status === 'BANNED' || status === 'SUSPENDED') && !confirm(`Confirm changing user status to ${status}?`)) {
      return;
    }

    try {
      await this.api(`/users/${encodeURIComponent(userId)}/status`, {
        method: 'PUT',
        body: JSON.stringify({ status, reason }),
      });
      this.showToast(`Account status updated to ${status}`, 'success');
      this.refreshCurrentUserModal();
      this.loadUsers();
    } catch (err) {
      this.showToast(`Error updating status: ${err.message}`, 'error');
    }
  },

  async terminateUserSessionsFromModal() {
    const userId = this.state.currentModalUserId;
    if (!userId) return;

    if (!confirm('Terminate all active login sessions on all mobile and web client devices for this user?')) return;

    try {
      await this.api(`/users/${encodeURIComponent(userId)}/terminate-sessions`, {
        method: 'POST',
      });
      this.showToast('All active user sessions invalidated.', 'success');
    } catch (err) {
      this.showToast(`Error invalidating sessions: ${err.message}`, 'error');
    }
  },

  async hardDeleteUserFromModal() {
    const userId = this.state.currentModalUserId;
    if (!userId) return;

    const u = this.state.currentModalUser?.user;
    const identifier = u?.email || u?.displayName || userId;

    if (!confirm(`⚠️ DANGER: PERMANENT HARD PURGE\n\nPermanently delete user "${identifier}" and ALL associated Cloudflare R2 cloud files, folders, shares, and webmaster ledger records?\n\nThis action is irreversible and compliant with Google Play Data Deletion requirements.`)) {
      return;
    }

    try {
      await this.api(`/users/${encodeURIComponent(userId)}`, {
        method: 'DELETE',
      });
      this.closeUserIntelligenceModal();
      this.loadUsers();
      this.showToast(`User "${identifier}" permanently purged.`, 'success');
    } catch (err) {
      this.showToast(`Error deleting user: ${err.message}`, 'error');
    }
  },

  refreshCurrentUserModal() {
    if (this.state.currentModalUserId) {
      this.openUserIntelligenceModal(this.state.currentModalUserId);
    }
  },

  closeUserIntelligenceModal() {
    const modal = document.getElementById('user-intelligence-modal');
    if (modal) modal.style.display = 'none';
    this.state.currentModalUserId = null;
    this.state.currentModalUser = null;
  },

  openQuotaModal(userId, currentBytes) {
    const modal = document.getElementById('quota-modal');
    document.getElementById('quota-user-id').value = userId;

    const bytes = currentBytes || 1099511627776;
    let val = 1024;
    let unit = 'GB';

    if (bytes < (1024 ** 3)) {
      unit = 'MB';
      val = Math.round(bytes / (1024 ** 2));
    } else if (bytes >= (1024 ** 4)) {
      unit = 'TB';
      val = (bytes / (1024 ** 4)).toFixed(1).replace(/\.0$/, '');
    } else {
      unit = 'GB';
      val = Math.round(bytes / (1024 ** 3));
    }

    document.getElementById('quota-value-input').value = val;
    document.getElementById('quota-unit-select').value = unit;
    this.updateQuotaPreview();
    modal.style.display = 'flex';
  },

  setQuotaPreset(value, unit) {
    document.getElementById('quota-value-input').value = value;
    document.getElementById('quota-unit-select').value = unit;
    this.updateQuotaPreview();
  },

  updateQuotaPreview() {
    const val = parseFloat(document.getElementById('quota-value-input').value) || 0;
    const unit = document.getElementById('quota-unit-select').value;
    const preview = document.getElementById('quota-preview-text');
    if (!preview) return;

    let bytes = 0;
    if (unit === 'MB') bytes = Math.round(val * 1024 * 1024);
    else if (unit === 'TB') bytes = Math.round(val * 1024 * 1024 * 1024 * 1024);
    else bytes = Math.round(val * 1024 * 1024 * 1024);

    preview.textContent = `Equivalent: ${bytes.toLocaleString()} bytes (${val} ${unit})`;
  },

  closeQuotaModal() {
    document.getElementById('quota-modal').style.display = 'none';
  },

  async submitQuotaUpdate() {
    const userId = document.getElementById('quota-user-id').value;
    const val = parseFloat(document.getElementById('quota-value-input').value);
    const unit = document.getElementById('quota-unit-select').value;

    if (!val || val <= 0) return alert(`Please enter a valid positive storage amount in ${unit}`);

    let bytes = 0;
    if (unit === 'MB') {
      bytes = Math.round(val * 1024 * 1024);
    } else if (unit === 'TB') {
      bytes = Math.round(val * 1024 * 1024 * 1024 * 1024);
    } else {
      bytes = Math.round(val * 1024 * 1024 * 1024);
    }

    try {
      await this.api(`/users/${userId}/quota`, {
        method: 'PUT',
        body: JSON.stringify({ quotaBytes: bytes, quotaValue: val, unit: unit }),
      });
      this.closeQuotaModal();
      this.loadUsers();
      this.showToast(`Updated storage quota to ${val} ${unit}`);
    } catch (err) {
      alert(`Error updating quota: ${err.message}`);
    }
  },

  async toggleUserStatus(userId, newStatus) {
    if (!confirm(`Are you sure you want to set this user status to ${newStatus}?`)) return;
    try {
      await this.api(`/users/${userId}/status`, {
        method: 'PUT',
        body: JSON.stringify({ status: newStatus }),
      });
      this.loadUsers();
      this.showToast(`User status set to ${newStatus}`);
    } catch (err) {
      alert(`Error: ${err.message}`);
    }
  },

  async deleteUserAccount(userId, identifier) {
    if (!confirm(`Are you sure you want to PERMANENTLY delete user "${identifier}"?\n\nThis will permanently delete all cloud storage files, shares, and webmaster profile. This action CANNOT be undone.`)) {
      return;
    }
    try {
      await this.api(`/users/${userId}`, {
        method: 'DELETE',
      });
      this.loadUsers();
      this.showToast(`User "${identifier}" permanently deleted`);
    } catch (err) {
      alert(`Error deleting user: ${err.message}`);
    }
  },

  // -------------------------------------------------------------
  // TAB 3: WEBMASTER CENTER & UNIFIED GLOBAL CPM
  // -------------------------------------------------------------
  async loadWebmasters() {
    try {
      const data = await this.api('/webmasters');
      const cfg = await this.api('/config');
      this.state.webmasters = data.webmasters || [];
      this.renderWebmastersView(this.state.webmasters, cfg.config);
    } catch (err) {
      console.warn('Webmasters error:', err);
    }
  },

  renderWebmastersView(webmasters, config) {
    // Set Killswitch Toggle state
    const toggle = document.getElementById('webmaster-master-toggle');
    const toggleLabel = document.getElementById('webmaster-toggle-label');
    if (toggle) {
      toggle.checked = !!config.webmaster_program_enabled;
      if (toggleLabel) {
        toggleLabel.textContent = config.webmaster_program_enabled ? 'PROGRAM ACTIVE (Normal Creator Dashboard)' : 'PROGRAM DISABLED (Coming Soon Lock Active For All)';
      }
    }

    // Set CPM Rate Input
    const cpmInput = document.getElementById('global-cpm-input');
    if (cpmInput) cpmInput.value = (config.global_cpm_rate_usd || 4.0).toFixed(2);

    // Set CPA Referral Reward Input
    const cpaInput = document.getElementById('cpa-reward-input');
    if (cpaInput) cpaInput.value = (config.cpa_reward_per_install_usd || 0.05).toFixed(2);

    // Set Minimum Withdrawal Input
    const minWdInput = document.getElementById('webmaster-min-withdrawal-input');
    if (minWdInput) minWdInput.value = (config.min_withdrawal_usd !== undefined ? config.min_withdrawal_usd : 1.0).toFixed(2);

    // Render Webmaster List
    const tbody = document.getElementById('webmasters-table-body');
    if (!tbody) return;

    if (webmasters.length === 0) {
      tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:24px;">No enrolled webmasters found.</td></tr>';
      return;
    }

    tbody.innerHTML = webmasters.map(w => {
      let totalClicks = 0;
      let totalPlays = 0;
      (w.stats || []).forEach(s => {
        totalClicks += (s.clicks || 0);
        totalPlays += (s.videoPlays || 0);
      });

      return `
        <tr>
          <td><strong class="mono-text" style="color:#60A5FA;">${w.referralCode || 'N/A'}</strong></td>
          <td>${w.email || w.userId || 'Creator'}</td>
          <td><strong class="mono-text">$${(w.walletBalanceUsd || 0).toFixed(4)}</strong></td>
          <td><span class="mono-text">${totalPlays}</span></td>
          <td><span class="mono-text">${totalClicks}</span></td>
          <td><span class="badge badge-success">ACTIVE</span></td>
        </tr>
      `;
    }).join('');
  },

  async toggleWebmasterProgram(checkbox) {
    const isEnabled = checkbox.checked;
    const toggleLabel = document.getElementById('webmaster-toggle-label');
    if (toggleLabel) {
      toggleLabel.textContent = isEnabled ? 'PROGRAM ACTIVE (Normal Creator Dashboard)' : 'PROGRAM DISABLED (Coming Soon Lock Active For All)';
    }

    try {
      await this.api('/webmasters/status', {
        method: 'PUT',
        body: JSON.stringify({ enabled: isEnabled }),
      });
      this.showToast(`Webmaster Program is now ${isEnabled ? 'ACTIVE' : 'DISABLED (Coming Soon modal active for all users)'}`);
    } catch (err) {
      checkbox.checked = !isEnabled;
      alert(`Failed to update program state: ${err.message}`);
    }
  },

  async updateGlobalCpm() {
    const input = document.getElementById('global-cpm-input');
    const rate = parseFloat(input.value);
    if (isNaN(rate) || rate < 0) return alert('Please enter a valid CPM rate number');

    try {
      await this.api('/webmasters/global-cpm', {
        method: 'PUT',
        body: JSON.stringify({ cpmRateUsd: rate }),
      });
      this.showToast(`Updated global CPM rate to $${rate.toFixed(2)} / 1,000 views`);
    } catch (err) {
      alert(`Error updating CPM: ${err.message}`);
    }
  },

  async updateCpaReward() {
    const input = document.getElementById('cpa-reward-input');
    const rate = parseFloat(input.value);
    if (isNaN(rate) || rate < 0) return alert('Please enter a valid referral reward number');

    try {
      await this.api('/webmasters/cpa-reward', {
        method: 'PUT',
        body: JSON.stringify({ cpaRewardUsd: rate }),
      });
      this.showToast(`Updated referral program reward to $${rate.toFixed(2)} / active user`);
    } catch (err) {
      alert(`Error updating referral reward: ${err.message}`);
    }
  },

  async updateMinWithdrawal() {
    const input = document.getElementById('webmaster-min-withdrawal-input');
    const rate = parseFloat(input ? input.value : '1.0');
    if (isNaN(rate) || rate < 0) return alert('Please enter a valid minimum withdrawal number');

    try {
      await this.api('/webmasters/min-withdrawal', {
        method: 'PUT',
        body: JSON.stringify({ minWithdrawalUsd: rate }),
      });
      const configMinWd = document.getElementById('config-min-withdrawal');
      if (configMinWd) configMinWd.value = rate.toFixed(2);
      this.showToast(`Updated minimum withdrawal payout limit to $${rate.toFixed(2)} USD`);
    } catch (err) {
      alert(`Error updating minimum withdrawal: ${err.message}`);
    }
  },

  // -------------------------------------------------------------
  // TAB 4: STORAGE & DMCA COMPLIANCE & STRIKES
  // -------------------------------------------------------------
  async loadStorage(force = false) {
    try {
      const q = force ? '?refresh=true' : '';
      const [storageData, reportsData, strikesData] = await Promise.all([
        this.api(`/storage/objects${q}`).catch(() => ({ bucket: 'terabox-cloud-storage', telemetry: {}, totalShares: 0 })),
        this.api('/safety/reports').catch(() => ({ reports: [] })),
        this.api('/safety/strikes').catch(() => ({ totalBannedShares: 0, totalStrikedUsers: 0, bannedShares: [], strikedUsers: [] })),
      ]);

      this.renderStorageView(storageData, reportsData.reports || [], strikesData);
    } catch (err) {
      console.warn('Storage load error:', err);
    }
  },

  async syncR2Storage() {
    this.showToast('Synchronizing R2 cloud storage telemetry and user quotas...', 'info');
    try {
      const res = await this.api('/storage/sync-r2', { method: 'POST' });
      if (res && res.success) {
        this.showToast(`✅ R2 Synced: ${res.totalStorageGb} GB across ${res.totalObjects} objects (${res.updatedUsersCount} users aligned)`, 'success');
        await this.loadStorage(true);
        await this.loadDashboardStats();
        if (this.state.activeTab === 'users') {
          await this.loadUsers();
        }
      } else {
        throw new Error(res?.error || 'Failed to sync R2 storage');
      }
    } catch (err) {
      this.showToast(`Sync error: ${err.message}`, 'error');
    }
  },

  renderStorageView(data, reports, strikesData = {}) {
    this._allReports = reports || [];
    this._currentReports = reports || [];
    this._strikesData = strikesData || {};
    this._dmcaFilter = this._dmcaFilter || 'ALL';
    this._dmcaSearchQuery = this._dmcaSearchQuery || '';

    // 1. Update Telemetry Metric Cards
    const totalGb = (data.telemetry?.totalGb !== undefined && data.telemetry?.totalGb !== null)
      ? Number(data.telemetry.totalGb).toFixed(2)
      : (data.telemetry?.totalBytes ? (data.telemetry.totalBytes / (1024 ** 3)).toFixed(2) : '0.00');
    const totalObjects = data.telemetry?.totalObjects || 0;
    const userFolderCount = data.telemetry?.userFolderCount || 0;
    const bucketName = data.bucket || 'terabox-cloud-storage';
    const cdnDomain = data.publicDomain || 'https://pub-d550feaadd484541bf0c3af429db5905.r2.dev';
    const totalShares = data.totalShares || 0;
    const totalStrikes = strikesData.totalStrikedUsers || 0;
    const totalBanned = strikesData.totalBannedShares || 0;

    const gbEl = document.getElementById('storage-total-gb');
    if (gbEl) gbEl.textContent = `${totalGb} GB`;

    const bucketEl = document.getElementById('storage-bucket-name');
    if (bucketEl) bucketEl.textContent = bucketName;

    const cdnEl = document.getElementById('storage-cdn-domain');
    if (cdnEl) cdnEl.textContent = cdnDomain.replace(/^https?:\/\//, '');

    const sharesEl = document.getElementById('storage-total-shares');
    if (sharesEl) sharesEl.textContent = `${totalShares} Active`;

    const objEl = document.getElementById('storage-total-objects');
    if (objEl) objEl.textContent = `${totalObjects} files (${userFolderCount} user folders)`;

    const strikesEl = document.getElementById('storage-total-strikes');
    if (strikesEl) strikesEl.textContent = `${totalStrikes} Accounts / ${totalBanned} Strikes`;

    const bannedEl = document.getElementById('storage-total-banned');
    if (bannedEl) bannedEl.textContent = totalBanned;

    const rptBadge = document.getElementById('reports-count-badge');
    if (rptBadge) rptBadge.textContent = `${reports.length} Reports`;

    const banBadge = document.getElementById('banned-count-badge');
    if (banBadge) banBadge.textContent = `${totalBanned} Banned Videos`;

    // 2. Render DMCA Reports Table with live filter & search
    this.renderDmcaReportsTable();

    // 3. Render Active Strikes & Banned Videos Table
    const strikesTbody = document.getElementById('strikes-table-body');
    if (strikesTbody) {
      const bannedShares = strikesData.bannedShares || [];
      if (bannedShares.length === 0) {
        strikesTbody.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:32px;color:var(--text-secondary);"><div style="font-weight:600;font-size:14px;">No Banned Content</div><div style="font-size:12px;color:var(--text-muted);margin-top:4px;">No videos or creator shares are currently suspended.</div></td></tr>';
      } else {
        strikesTbody.innerHTML = bannedShares.map(s => {
          const directUrl = s.streamUrl || s.downloadUrl || '';
          const previewBtn = directUrl ? `
            <button class="btn-sm btn-secondary" onclick="AdminApp.previewVideo('${encodeURIComponent(directUrl)}', '${encodeURIComponent(s.fileName || 'Banned Video')}', '${s.shareCode}', '${encodeURIComponent(s.creatorUserId || s.userId || 'Creator')}', ${s.sizeBytes || 0})" style="font-size:11px; padding:3px 8px; border-radius:4px;">Preview</button>
          ` : '';

          return `
            <tr>
              <td><strong class="mono-text" style="color:var(--primary); font-size:12.5px;">${s.shareCode}</strong></td>
              <td>
                <div style="font-weight:600; max-width:200px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${this.escapeHtml(s.fileName || 'Video')}</div>
                <div style="font-size:11px; color:var(--text-secondary); margin-top:2px;">${this.formatBytes(s.sizeBytes || 0)}</div>
              </td>
              <td><span style="font-size:12px; font-weight:600;">${this.escapeHtml(s.creatorUserId || s.userId || 'Unknown')}</span></td>
              <td>
                <span class="badge badge-danger" style="font-size:10.5px;">${this.escapeHtml(s.banReason || 'DMCA Copyright Violation')}</span>
              </td>
              <td><span class="badge badge-danger">LINK BANNED</span></td>
              <td>
                <div style="display:flex; gap:6px; align-items:center;">
                  ${previewBtn}
                  <button class="btn-sm btn-secondary" onclick="AdminApp.unbanShare('${s.shareCode}', '${s.creatorUserId || s.userId}')" style="white-space:nowrap;">
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"></path><polyline points="21 3 21 8 16 8"></polyline><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"></path><polyline points="8 16 3 16 3 21"></polyline></svg>
                    Unban & Clear Strike
                  </button>
                </div>
              </td>
            </tr>
          `;
        }).join('');
      }
    }
  },

  // -------------------------------------------------------------
  // DMCA SEARCH & FILTER CONTROLLER
  // -------------------------------------------------------------
  setDmcaFilter(filterStatus) {
    this._dmcaFilter = filterStatus || 'ALL';

    // Update active tab styles
    ['ALL', 'PENDING_REVIEW', 'TAKEDOWN_EXECUTED', 'DISMISSED'].forEach(f => {
      const btn = document.getElementById(`filter-dmca-${f === 'ALL' ? 'all' : f === 'PENDING_REVIEW' ? 'pending' : f === 'TAKEDOWN_EXECUTED' ? 'takedown' : 'dismissed'}`);
      if (btn) {
        if (f === this._dmcaFilter) {
          btn.classList.add('active');
          btn.style.background = '#FFFFFF';
          btn.style.color = 'var(--text-primary)';
          btn.style.boxShadow = '0 1px 3px rgba(0,0,0,0.08)';
        } else {
          btn.classList.remove('active');
          btn.style.background = 'transparent';
          btn.style.color = 'var(--text-secondary)';
          btn.style.boxShadow = 'none';
        }
      }
    });

    this.renderDmcaReportsTable();
  },

  filterDmcaReports() {
    const input = document.getElementById('dmca-search-input');
    const clearBtn = document.getElementById('dmca-search-clear');
    const val = (input ? input.value : '').trim();
    this._dmcaSearchQuery = val.toLowerCase();

    if (clearBtn) {
      clearBtn.style.display = val.length > 0 ? 'inline-block' : 'none';
    }

    this.renderDmcaReportsTable();
  },

  clearDmcaSearch() {
    const input = document.getElementById('dmca-search-input');
    const clearBtn = document.getElementById('dmca-search-clear');
    if (input) input.value = '';
    if (clearBtn) clearBtn.style.display = 'none';
    this._dmcaSearchQuery = '';
    this.renderDmcaReportsTable();
  },

  copyToClipboard(text, label = 'Content') {
    if (!text) return;
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(() => {
        this.showToast(`Copied ${label}: ${text}`);
      }).catch(() => {
        prompt(`Copy ${label}:`, text);
      });
    } else {
      prompt(`Copy ${label}:`, text);
    }
  },

  renderDmcaReportsTable() {
    const reports = this._allReports || [];
    const filter = this._dmcaFilter || 'ALL';
    const query = (this._dmcaSearchQuery || '').toLowerCase();

    // Calculate count totals for filter pills
    const countAll = reports.length;
    const countPending = reports.filter(r => r.status === 'PENDING_REVIEW' || !r.status).length;
    const countTakedown = reports.filter(r => r.status === 'TAKEDOWN_EXECUTED').length;
    const countDismissed = reports.filter(r => r.status === 'DISMISSED').length;

    const elCountAll = document.getElementById('count-dmca-all');
    if (elCountAll) elCountAll.textContent = countAll;
    const elCountPending = document.getElementById('count-dmca-pending');
    if (elCountPending) elCountPending.textContent = countPending;
    const elCountTakedown = document.getElementById('count-dmca-takedown');
    if (elCountTakedown) elCountTakedown.textContent = countTakedown;
    const elCountDismissed = document.getElementById('count-dmca-dismissed');
    if (elCountDismissed) elCountDismissed.textContent = countDismissed;

    // Filter by Tab and Search Query
    let filtered = reports.filter(r => {
      // Tab filter
      if (filter === 'PENDING_REVIEW' && r.status !== 'PENDING_REVIEW' && r.status) return false;
      if (filter === 'TAKEDOWN_EXECUTED' && r.status !== 'TAKEDOWN_EXECUTED') return false;
      if (filter === 'DISMISSED' && r.status !== 'DISMISSED') return false;

      // Search query filter
      if (query) {
        const str = `${r.id || ''} ${r.reportId || ''} ${r.shareCode || ''} ${r.fileName || ''} ${r.creatorEmail || ''} ${r.creatorUserId || ''} ${r.creatorName || ''} ${r.legalName || ''} ${r.organization || ''} ${r.workTitle || ''} ${r.email || ''}`.toLowerCase();
        if (!str.includes(query)) return false;
      }

      return true;
    });

    const repTbody = document.getElementById('dmca-table-body');
    if (!repTbody) return;

    if (filtered.length === 0) {
      repTbody.innerHTML = `
        <tr>
          <td colspan="7" style="text-align:center;padding:36px;color:var(--text-secondary);">
            <div style="font-weight:700;font-size:14px;color:var(--text-primary);">No complaints match this filter</div>
            <div style="font-size:12px;color:var(--text-muted);margin-top:4px;">Try searching a different ticket ID, share code, or creator name.</div>
          </td>
        </tr>
      `;
      return;
    }

    repTbody.innerHTML = filtered.map(r => {
      const reportId = r.id || r.reportId || 'N/A';
      const dateStr = r.submittedAt ? new Date(r.submittedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) + ' ' + new Date(r.submittedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'Recent';
      const fileName = r.fileName || 'Reported Video / File';
      const sizeFormatted = this.formatBytes(r.fileSize || 0);
      const previewUrl = r.previewUrl || '';
      const cleanCode = r.shareCode || 'N/A';

      // Determine file extension tag
      const rawExt = (fileName.includes('.') ? fileName.split('.').pop() : (r.isVideo ? 'MP4' : 'FILE')).toUpperCase().substring(0, 4);

      // Creator strike status badge
      let strikeBadge = '<span class="badge badge-info" style="font-size:10px; padding:2px 6px;">0 Strikes</span>';
      if (r.creatorStrikes === 1) strikeBadge = '<span class="badge badge-warning" style="font-size:10px; padding:2px 6px;">1 Strike</span>';
      if (r.creatorStrikes === 2) strikeBadge = '<span class="badge badge-warning" style="font-size:10px; padding:2px 6px; background:#FEF3C7; color:#B45309; border-color:#FDE68A;">2 Strikes</span>';
      if (r.creatorStrikes >= 3) strikeBadge = `<span class="badge badge-danger" style="font-size:10px; padding:2px 6px;">${r.creatorStrikes} Strikes (Banned)</span>`;

      // Report status badge
      let statusBadge = '<span class="badge badge-warning" style="display:inline-flex; align-items:center; gap:4px;"><span style="width:6px;height:6px;border-radius:50%;background:#D97706;"></span>PENDING REVIEW</span>';
      if (r.status === 'TAKEDOWN_EXECUTED') statusBadge = '<span class="badge badge-danger" style="display:inline-flex; align-items:center; gap:4px;"><span style="width:6px;height:6px;border-radius:50%;background:#DC2626;"></span>TAKEDOWN DONE</span>';
      if (r.status === 'DISMISSED') statusBadge = '<span class="badge badge-info" style="display:inline-flex; align-items:center; gap:4px;"><span style="width:6px;height:6px;border-radius:50%;background:#64748B;"></span>DISMISSED</span>';

      // Preview button
      const previewBtn = previewUrl ? `
        <button class="btn-sm btn-secondary" onclick="AdminApp.previewVideo('${encodeURIComponent(previewUrl)}', '${encodeURIComponent(fileName)}', '${cleanCode}', '${encodeURIComponent(r.creatorEmail || 'Creator')}', ${r.fileSize || 0}, '${reportId}')" style="margin-top: 4px; display: inline-flex; align-items: center; gap: 4px; font-size: 10.5px; padding: 2px 7px; border-radius: 4px;">
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polygon points="5 3 19 12 5 21 5 3"/></svg> Preview Video
        </button>
      ` : '';

      const viewClaimBtn = `
        <button class="btn-sm btn-secondary" onclick="AdminApp.viewLegalClaim('${reportId}')" style="margin-top: 4px; display: inline-flex; align-items: center; gap: 3px; font-size: 10.5px; padding: 3px 6px; border-radius: 4px; color: var(--primary); font-weight: 700;">
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
          Dossier
        </button>
      `;

      // Complainant clean format (NO &bull; entity bug)
      const claimantName = r.legalName || r.reporterName || 'Rights Claimant';
      const claimantOrg = r.organization ? ` • ${r.organization}` : '';
      const creatorInitial = (r.creatorName ? r.creatorName.charAt(0) : (r.creatorEmail ? r.creatorEmail.charAt(0) : 'U')).toUpperCase();

      return `
        <tr>
          <td>
            <div style="display:flex; align-items:center; gap:4px;">
              <span class="mono-text" style="font-weight:800; color:var(--primary); font-size:11px; background:var(--primary-light); padding:2px 5px; border-radius:4px; max-width:110px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;" title="${reportId}">${reportId}</span>
              <button onclick="AdminApp.copyToClipboard('${reportId}', 'Ticket ID')" title="Copy Ticket ID" style="background:none; border:none; cursor:pointer; padding:1px; color:var(--text-muted); display:inline-flex; align-items:center;">
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
              </button>
            </div>
            <div style="font-size:10.5px; color:var(--text-muted); margin-top:3px; display:flex; align-items:center; gap:3px;">
              ${dateStr}
            </div>
            ${viewClaimBtn}
          </td>
          <td>
            <div style="display:flex; align-items:center; gap:5px;">
              <span style="font-size:9px; font-weight:800; background:#EFF6FF; color:#1D4ED8; border:1px solid #DBEAFE; padding:1px 3px; border-radius:3px;">${rawExt}</span>
              <div style="font-weight:700; color:var(--text-primary); font-size:12px; max-width:150px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;" title="${this.escapeHtml(fileName)}">
                ${this.escapeHtml(fileName)}
              </div>
            </div>
            <div style="font-size:10.5px; color:var(--text-secondary); margin-top:2px; display:flex; align-items:center; gap:3px;">
              Code: <strong class="mono-text" style="color:var(--primary); font-size:10.5px;">${cleanCode}</strong>
              <button onclick="AdminApp.copyToClipboard('${cleanCode}', 'Share Code')" title="Copy Code" style="background:none; border:none; cursor:pointer; padding:1px; color:var(--text-muted); display:inline-flex;">
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
              </button>
              <span style="color:var(--border-subtle);">|</span>
              <span>${sizeFormatted}</span>
            </div>
            ${previewBtn}
          </td>
          <td>
            <span class="badge badge-danger" style="font-size:9.5px; margin-bottom:2px; display:inline-block; max-width:160px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${this.escapeHtml(r.reason || 'Copyright Infringement')}</span>
            ${r.workTitle ? `<div style="font-size:11px; font-weight:700; color:var(--text-primary); margin-top:2px; max-width:150px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;" title="${this.escapeHtml(r.workTitle)}">Work: ${this.escapeHtml(r.workTitle)}</div>` : ''}
            ${r.ownershipProofUrl ? `
              <div style="font-size:10.5px; margin-top:2px;">
                <a href="${encodeURI(r.ownershipProofUrl)}" target="_blank" style="color:var(--primary); font-weight:600; text-decoration:underline; display:inline-flex; align-items:center; gap:3px;">
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg> Verified Proof
                </a>
              </div>
            ` : (r.proofDetails ? `<div style="font-size:10px; color:var(--text-muted); margin-top:2px; max-width:140px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;" title="${this.escapeHtml(r.proofDetails)}">${this.escapeHtml(r.proofDetails)}</div>` : '')}
          </td>
          <td>
            <div style="display:flex; align-items:flex-start; gap:6px;">
              <div style="width:26px; height:26px; border-radius:50%; background:#EFF6FF; color:#0066FF; font-weight:800; font-size:11px; display:flex; align-items:center; justify-content:center; flex-shrink:0;">
                ${creatorInitial}
              </div>
              <div>
                <div style="font-weight:700; font-size:11.5px; color:var(--text-primary); line-height:1.2; max-width:120px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">
                  ${this.escapeHtml(r.creatorName || (r.creatorEmail ? r.creatorEmail.split('@')[0] : 'Uploader'))}
                </div>
                <div style="font-size:10.5px; color:var(--text-secondary); margin-top:1px; display:flex; align-items:center; gap:2px;">
                  <span style="max-width:110px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;" title="${this.escapeHtml(r.creatorEmail || '')}">${this.escapeHtml(r.creatorEmail || 'Anonymous')}</span>
                  ${r.creatorEmail && r.creatorEmail !== 'Unknown Creator' ? `
                    <button onclick="AdminApp.copyToClipboard('${r.creatorEmail}', 'Email')" title="Copy Email" style="background:none; border:none; cursor:pointer; padding:1px; color:var(--text-muted); display:inline-flex;">
                      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
                    </button>
                  ` : ''}
                </div>
                <div style="margin-top:3px; display:flex; align-items:center; gap:5px;">
                  ${strikeBadge}
                  <button onclick="AdminApp.viewCreatorProfile('${encodeURIComponent(r.creatorUserId || r.creatorEmail || '')}')" style="background:none; border:none; color:var(--primary); font-size:10px; font-weight:700; cursor:pointer; padding:0; text-decoration:underline;">
                    Audit
                  </button>
                </div>
              </div>
            </div>
          </td>
          <td>
            <div style="font-size:11.5px; font-weight:700; color:var(--text-primary); line-height:1.3; max-width:140px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;" title="${this.escapeHtml(claimantName)}${this.escapeHtml(claimantOrg)}">
              ${this.escapeHtml(claimantName)}${this.escapeHtml(claimantOrg)}
            </div>
            <div style="font-size:10.5px; color:var(--text-muted); margin-top:1px; display:flex; align-items:center; gap:2px;">
              <span style="max-width:120px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;" title="${this.escapeHtml(r.email || r.reporterEmail || 'N/A')}">${this.escapeHtml(r.email || r.reporterEmail || 'N/A')}</span>
              ${r.email ? `
                <button onclick="AdminApp.copyToClipboard('${r.email}', 'Complainant Email')" title="Copy Email" style="background:none; border:none; cursor:pointer; padding:1px; color:var(--text-muted); display:inline-flex;">
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
                </button>
              ` : ''}
            </div>
            ${r.phone ? `<div style="font-size:10px; color:var(--text-muted); margin-top:1px;">${this.escapeHtml(r.phone)}</div>` : ''}
          </td>
          <td>${statusBadge}</td>
          <td style="text-align: right;">
            ${r.status === 'PENDING_REVIEW' || !r.status ? `
              <div style="display:inline-flex; gap:4px; flex-direction:column; width:100%; max-width:115px;">
                <button class="btn-sm btn-danger" onclick="AdminApp.executeTakedown('${reportId}', '${cleanCode}')" style="width:100%; justify-content:center; white-space:nowrap; display:inline-flex; align-items:center; gap:4px; font-weight:700; font-size:11px; padding:4px 6px;">
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                  Takedown
                </button>
                <button class="btn-sm btn-secondary" onclick="AdminApp.dismissReport('${reportId}')" style="width:100%; justify-content:center; white-space:nowrap; display:inline-flex; align-items:center; gap:4px; font-size:10.5px; padding:3px 6px;">
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"></polyline></svg>
                  Dismiss
                </button>
              </div>
            ` : r.status === 'TAKEDOWN_EXECUTED' ? `
              <button class="btn-sm btn-secondary" onclick="AdminApp.unbanShare('${cleanCode}', '${r.creatorEmail}')" style="white-space:nowrap; display:inline-flex; align-items:center; gap:4px; font-weight:700; font-size:11px; padding:4px 8px; border-radius:6px;">
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"></path><polyline points="21 3 21 8 16 8"></polyline><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"></path><polyline points="8 16 3 16 3 21"></polyline></svg>
                Restore Link
              </button>
            ` : '<span style="font-size:11px; color:var(--text-muted); font-weight:600;">Resolved</span>'}
          </td>
        </tr>
      `;
    }).join('');
  },

  // -------------------------------------------------------------
  // CREATOR INTELLIGENCE MODAL CONTROLLER
  // -------------------------------------------------------------
  async viewCreatorProfile(encodedId) {
    const rawId = decodeURIComponent(encodedId || '').trim();
    if (!rawId || rawId === 'Anonymous' || rawId === 'Anonymous / Guest' || rawId === 'Unknown Creator') {
      return alert('No verified uploader account registered for this item.');
    }

    try {
      const data = await this.api(`/safety/uploader/${encodeURIComponent(rawId)}`);
      if (!data || !data.success) throw new Error(data?.error || 'Failed to fetch creator profile');

      const user = data.user || {};
      const shares = data.shares || [];
      const strikes = user.strikes || [];

      const modal = document.getElementById('creator-history-modal');
      const avatarEl = document.getElementById('creator-modal-avatar');
      const nameEl = document.getElementById('creator-modal-name');
      const emailEl = document.getElementById('creator-modal-email');
      const idEl = document.getElementById('creator-modal-id');
      const statusMetricEl = document.getElementById('creator-metric-status');
      const strikesMetricEl = document.getElementById('creator-metric-strikes');
      const sharesMetricEl = document.getElementById('creator-metric-shares');
      const reportsMetricEl = document.getElementById('creator-metric-reports');
      const strikesListEl = document.getElementById('creator-strikes-list');
      const sharesTbody = document.getElementById('creator-shares-tbody');
      const banBtn = document.getElementById('creator-btn-ban');

      this._activeCreatorUser = user;

      const initial = (user.displayName ? user.displayName.charAt(0) : (user.email ? user.email.charAt(0) : 'U')).toUpperCase();
      if (avatarEl) avatarEl.textContent = initial;
      if (nameEl) nameEl.textContent = user.displayName || user.name || 'AirBox Creator';
      if (emailEl) emailEl.textContent = user.email || 'No email on file';
      if (idEl) idEl.textContent = user.id || rawId;

      const isBanned = user.status === 'BANNED' || user.status === 'SUSPENDED';
      if (statusMetricEl) {
        statusMetricEl.innerHTML = isBanned
          ? '<span class="badge badge-danger">ACCOUNT BANNED</span>'
          : '<span class="badge badge-success">ACTIVE USER</span>';
      }

      if (strikesMetricEl) strikesMetricEl.textContent = `${user.strikesCount || strikes.length || 0} Strikes`;
      if (sharesMetricEl) sharesMetricEl.textContent = `${data.sharesCount || shares.length || 0} Uploads (${data.bannedSharesCount || 0} Banned)`;
      if (reportsMetricEl) reportsMetricEl.textContent = `${data.reportsCount || 0} Notices`;

      // Render Strikes List
      if (strikesListEl) {
        if (strikes.length === 0) {
          strikesListEl.innerHTML = '<div style="color:var(--text-muted); text-align:center; padding:12px;">No copyright strikes issued to this creator.</div>';
        } else {
          strikesListEl.innerHTML = strikes.map((s, idx) => `
            <div style="background:#FFFFFF; border:1px solid var(--border-subtle); padding:8px 12px; border-radius:6px; margin-bottom:6px; display:flex; justify-content:space-between; align-items:center;">
              <div>
                <div style="font-weight:700; color:var(--status-danger); font-size:12px;">Strike #${strikes.length - idx}: ${this.escapeHtml(s.reason || 'DMCA Copyright Violation')}</div>
                <div style="font-size:11px; color:var(--text-secondary); margin-top:2px;">
                  File: <strong>${this.escapeHtml(s.fileName || 'Infringing Content')}</strong> • Code: <span class="mono-text">${s.shareCode || 'N/A'}</span>
                </div>
              </div>
              <div style="font-size:11px; color:var(--text-muted); text-align:right;">
                ${s.issuedAt ? new Date(s.issuedAt).toLocaleDateString() : 'Active'}
              </div>
            </div>
          `).join('');
        }
      }

      // Render Shares Table
      if (sharesTbody) {
        if (shares.length === 0) {
          sharesTbody.innerHTML = '<tr><td colspan="5" style="text-align:center;padding:16px;color:var(--text-muted);">No shared links found for this creator.</td></tr>';
        } else {
          sharesTbody.innerHTML = shares.map(s => {
            const isShareBanned = s.isBanned === true;
            return `
              <tr>
                <td><strong class="mono-text" style="color:var(--primary); font-size:11.5px;">${s.code || s.shortCode || 'N/A'}</strong></td>
                <td><div style="font-weight:600; font-size:12px; max-width:200px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${this.escapeHtml(s.fileName || s.name || 'File')}</div></td>
                <td style="font-size:11px;">${this.formatBytes(s.sizeBytes || 0)}</td>
                <td>
                  ${isShareBanned
                ? '<span class="badge badge-danger" style="font-size:9.5px;">BANNED</span>'
                : '<span class="badge badge-success" style="font-size:9.5px;">ACTIVE</span>'}
                </td>
                <td>
                  ${isShareBanned ? `
                    <button class="btn-sm btn-secondary" onclick="AdminApp.unbanShare('${s.code}', '${user.email}')" style="font-size:10.5px; padding:2px 6px;">Restore</button>
                  ` : `
                    <button class="btn-sm btn-danger" onclick="AdminApp.executeTakedown(null, '${s.code}')" style="font-size:10.5px; padding:2px 6px;">Takedown</button>
                  `}
                </td>
              </tr>
            `;
          }).join('');
        }
      }

      if (banBtn) {
        banBtn.textContent = isBanned ? 'Unban Account' : 'Ban Account';
        banBtn.className = isBanned ? 'btn btn-secondary' : 'btn btn-danger';
      }

      if (modal) modal.style.display = 'flex';
    } catch (err) {
      alert(`Error loading creator intelligence: ${err.message}`);
    }
  },

  closeCreatorModal() {
    const modal = document.getElementById('creator-history-modal');
    if (modal) modal.style.display = 'none';
    this._activeCreatorUser = null;
  },

  async toggleBanFromCreatorModal() {
    if (!this._activeCreatorUser) return;
    const user = this._activeCreatorUser;
    const isBanned = user.status === 'BANNED' || user.status === 'SUSPENDED';
    const nextStatus = isBanned ? 'ACTIVE' : 'BANNED';

    if (!confirm(`Are you sure you want to ${isBanned ? 'UNBAN' : 'BAN'} creator account "${user.email || user.id}"?`)) {
      return;
    }

    try {
      await this.api(`/users/${user.id}/status`, {
        method: 'PUT',
        body: JSON.stringify({ status: nextStatus, banReason: isBanned ? null : 'Administrative DMCA Trust & Safety Enforcement' }),
      });
      this.showToast(`Creator account is now ${nextStatus}`);
      this.closeCreatorModal();
      this.loadStorage();
    } catch (err) {
      alert(`Failed to update user status: ${err.message}`);
    }
  },

  // Video Preview Modal Controller
  previewVideo(encodedUrl, encodedTitle, shareCode, encodedCreator, sizeBytes, reportId) {
    const url = decodeURIComponent(encodedUrl || '');
    const title = decodeURIComponent(encodedTitle || 'Review Video');
    const creator = decodeURIComponent(encodedCreator || 'Anonymous');

    const modal = document.getElementById('video-preview-modal');
    const video = document.getElementById('preview-video-element');
    const titleEl = document.getElementById('preview-modal-title');
    const codeEl = document.getElementById('preview-meta-sharecode');
    const creatorEl = document.getElementById('preview-meta-creator');
    const sizeEl = document.getElementById('preview-meta-size');
    const linkEl = document.getElementById('preview-meta-link');
    const takedownBtn = document.getElementById('preview-btn-takedown');

    if (titleEl) titleEl.textContent = title;
    if (codeEl) codeEl.textContent = shareCode || '-';
    if (creatorEl) creatorEl.textContent = creator;
    if (sizeEl) sizeEl.textContent = this.formatBytes(sizeBytes || 0);
    if (linkEl) {
      linkEl.href = url;
      linkEl.textContent = url;
    }

    if (takedownBtn) {
      takedownBtn.onclick = () => {
        this.closeVideoPreview();
        this.executeTakedown(reportId, shareCode);
      };
    }

    if (video) {
      video.src = url;
      video.play().catch(() => { });
    }

    if (modal) modal.style.display = 'flex';
  },

  closeVideoPreview() {
    const modal = document.getElementById('video-preview-modal');
    const video = document.getElementById('preview-video-element');
    if (video) {
      video.pause();
      video.src = '';
    }
    if (modal) modal.style.display = 'none';
  },

  // Legal Claim Dossier Modal Controller
  viewLegalClaim(reportId) {
    const reports = this._currentReports || [];
    const report = reports.find(r => (r.id === reportId || r.reportId === reportId));
    if (!report) {
      return alert(`Legal notice with Ticket ID "${reportId}" not found in current session.`);
    }

    this._activeDossierReport = report;

    const modal = document.getElementById('legal-claim-dossier-modal');
    const ticketIdEl = document.getElementById('dossier-ticket-id');
    const filenameEl = document.getElementById('dossier-filename');
    const sharecodeEl = document.getElementById('dossier-sharecode');
    const creatorEl = document.getElementById('dossier-creator');
    const claimantNameEl = document.getElementById('dossier-claimant-name');
    const orgEl = document.getElementById('dossier-org');
    const relationshipEl = document.getElementById('dossier-relationship');
    const emailEl = document.getElementById('dossier-email');
    const phoneEl = document.getElementById('dossier-phone');
    const countryEl = document.getElementById('dossier-country');
    const addressEl = document.getElementById('dossier-address');
    const workTitleEl = document.getElementById('dossier-work-title');
    const proofContainer = document.getElementById('dossier-proof-container');
    const signatureEl = document.getElementById('dossier-signature');
    const clientIpEl = document.getElementById('dossier-client-ip');
    const dateEl = document.getElementById('dossier-date');
    const previewBtnContainer = document.getElementById('dossier-preview-btn-container');

    if (ticketIdEl) ticketIdEl.textContent = report.id || report.reportId || 'DMCA-NOTICE';
    if (filenameEl) filenameEl.textContent = report.fileName || 'Reported Content';
    if (sharecodeEl) sharecodeEl.textContent = report.shareCode || 'N/A';
    if (creatorEl) creatorEl.textContent = `${report.creatorName || 'Creator'} (${report.creatorEmail || report.creatorUserId || 'Anonymous'})`;

    if (claimantNameEl) claimantNameEl.textContent = report.legalName || report.reporterName || 'Complainant';
    if (orgEl) orgEl.textContent = report.organization || 'Independent Creator';
    if (relationshipEl) relationshipEl.textContent = report.relationship || 'Copyright Owner';
    if (emailEl) emailEl.textContent = report.email || report.reporterEmail || 'N/A';
    if (phoneEl) phoneEl.textContent = report.phone || 'N/A';
    if (countryEl) countryEl.textContent = report.country || report.jurisdiction || 'India';
    if (addressEl) addressEl.textContent = report.address || 'Full physical address recorded in statutory filing.';

    const workCategory = report.workCategory ? ` (${report.workCategory})` : '';
    if (workTitleEl) workTitleEl.textContent = `${report.workTitle || report.reason || 'Copyrighted Media'}${workCategory}`;

    if (proofContainer) {
      const proof = report.ownershipProofUrl || report.proofDetails || '';
      if (proof.startsWith('http://') || proof.startsWith('https://')) {
        proofContainer.innerHTML = `<a href="${encodeURI(proof)}" target="_blank" style="color:var(--primary); font-weight:700; text-decoration:underline; word-break:break-all; display:inline-flex; align-items:center; gap:4px;"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg> ${this.escapeHtml(proof)}</a>`;
      } else {
        proofContainer.innerHTML = `<span style="font-weight:600; color:var(--text-primary);">${this.escapeHtml(proof || 'Official Copyright Office Declaration on file.')}</span>`;
      }
    }

    if (signatureEl) signatureEl.textContent = report.electronicSignature || report.legalName || report.reporterName || 'Digitally Signed';
    if (clientIpEl) clientIpEl.textContent = report.clientIp || '127.0.0.1';
    if (dateEl) dateEl.textContent = report.submittedAt ? new Date(report.submittedAt).toLocaleString() : 'Recent';

    if (previewBtnContainer) {
      if (report.previewUrl) {
        previewBtnContainer.innerHTML = `
          <button class="btn-sm btn-secondary" onclick="AdminApp.previewVideo('${encodeURIComponent(report.previewUrl)}', '${encodeURIComponent(report.fileName || 'Video')}', '${report.shareCode}', '${encodeURIComponent(report.creatorEmail || 'Creator')}', ${report.fileSize || 0}, '${report.id}')" style="display:inline-flex; align-items:center; gap:4px; font-size:11.5px; padding:4px 10px; border-radius:6px;">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polygon points="5 3 19 12 5 21 5 3"/></svg> Preview Video
          </button>
        `;
      } else {
        previewBtnContainer.innerHTML = '';
      }
    }

    const takedownBtn = document.getElementById('dossier-btn-takedown');
    const dismissBtn = document.getElementById('dossier-btn-dismiss');

    if (report.status === 'TAKEDOWN_EXECUTED') {
      if (takedownBtn) takedownBtn.style.display = 'none';
      if (dismissBtn) dismissBtn.style.display = 'none';
    } else {
      if (takedownBtn) takedownBtn.style.display = 'inline-block';
      if (dismissBtn) dismissBtn.style.display = 'inline-block';
    }

    if (modal) modal.style.display = 'flex';
  },

  closeLegalClaimModal() {
    const modal = document.getElementById('legal-claim-dossier-modal');
    if (modal) modal.style.display = 'none';
    this._activeDossierReport = null;
  },

  async executeTakedownFromDossier() {
    if (!this._activeDossierReport) return;
    const report = this._activeDossierReport;
    const reportId = report.id || report.reportId;
    const shareCode = report.shareCode;

    this.closeLegalClaimModal();
    await this.executeTakedown(reportId, shareCode);
  },

  async dismissReportFromDossier() {
    if (!this._activeDossierReport) return;
    const report = this._activeDossierReport;
    const reportId = report.id || report.reportId;

    const reason = prompt('Enter justification for dismissing this copyright notice (e.g., "Insufficient ownership proof", "Fair use / non-infringing"):', 'Reviewed and determined non-infringing');
    if (reason === null) return;

    this.closeLegalClaimModal();
    await this.dismissReport(reportId, reason);
  },

  executeTakedownFromPreview() {
    const codeEl = document.getElementById('preview-meta-sharecode');
    const code = codeEl ? codeEl.textContent : '';
    if (code && code !== '-') {
      this.closeVideoPreview();
      this.executeTakedown(null, code);
    }
  },

  // Manual DMCA Takedown Modal Controller
  openManualTakedownModal(prefillCode = '') {
    const modal = document.getElementById('manual-takedown-modal');
    const input = document.getElementById('manual-takedown-code');
    if (input) input.value = prefillCode;
    if (modal) modal.style.display = 'flex';
  },

  closeManualTakedownModal() {
    const modal = document.getElementById('manual-takedown-modal');
    if (modal) modal.style.display = 'none';
  },

  async submitManualTakedown() {
    const codeInput = document.getElementById('manual-takedown-code');
    const reasonInput = document.getElementById('manual-takedown-reason');
    let code = (codeInput ? codeInput.value : '').trim();
    const reason = reasonInput ? reasonInput.value : 'DMCA Copyright Infringement';

    if (!code) return alert('Please enter a valid Share Code or link URL');
    if (code.includes('/s/')) {
      code = code.split('/s/').pop().split('?')[0].split('/')[0].trim();
    }

    try {
      const res = await this.api('/safety/takedown', {
        method: 'POST',
        body: JSON.stringify({ shareCode: code, reason }),
      });
      this.closeManualTakedownModal();
      this.loadStorage();
      this.showToast(res.message || `1-Click Takedown executed for ${code}`);
    } catch (err) {
      alert(`Takedown failed: ${err.message}`);
    }
  },

  // Clear / Purge All DMCA Reports
  async clearAllDmcaReports() {
    if (!confirm('Are you sure you want to permanently DELETE ALL DMCA copyright & abuse reports?\n\nThis will purge all report tickets from the database. This action cannot be undone.')) {
      return;
    }

    try {
      const res = await this.api('/safety/reports/all', {
        method: 'DELETE',
      });
      this.showToast(res.message || 'All DMCA reports have been permanently deleted.');
      this.loadStorage();
    } catch (err) {
      alert(`Failed to delete reports: ${err.message}`);
    }
  },

  // Delete Individual DMCA Report
  async deleteDmcaReport(reportId) {
    if (!confirm(`Permanently delete DMCA report ticket "${reportId}"?`)) {
      return;
    }

    try {
      const res = await this.api(`/safety/reports/${encodeURIComponent(reportId)}`, {
        method: 'DELETE',
      });
      this.showToast(res.message || 'Report deleted.');
      this.loadStorage();
    } catch (err) {
      alert(`Failed to delete report: ${err.message}`);
    }
  },

  // 1-Click Takedown Action
  async executeTakedown(reportId, shareCode) {
    if (!confirm(`Execute 1-Click DMCA Takedown on share "${shareCode || reportId}"?\n\nThis will immediately disable public video streaming and record a copyright strike on the uploader's account for administrative review.`)) {
      return;
    }

    try {
      const res = await this.api('/safety/takedown', {
        method: 'POST',
        body: JSON.stringify({
          reportId: reportId || null,
          shareCode: shareCode || null,
          reason: 'DMCA Copyright / UGC Policy Infringement',
        }),
      });
      this.loadStorage();
      this.showToast(res.message || '1-Click Takedown executed successfully.');
    } catch (err) {
      alert(`Error executing takedown: ${err.message}`);
    }
  },

  // Dismiss Report Action
  async dismissReport(reportId) {
    const reason = prompt('Reason for dismissing this complaint (e.g. Non-infringing, Original creator, Fair use):', 'Content reviewed and verified non-infringing');
    if (!reason) return;

    try {
      await this.api('/safety/dismiss-report', {
        method: 'POST',
        body: JSON.stringify({ reportId, reason }),
      });
      this.loadStorage();
      this.showToast('Complaint dismissed successfully.');
    } catch (err) {
      alert(`Error dismissing report: ${err.message}`);
    }
  },

  // Restore Link & Remove Strike Action
  async unbanShare(shareCode, userEmail) {
    if (!confirm(`Restore video link "${shareCode}" and remove the strike penalty from the creator account?`)) {
      return;
    }

    try {
      const res = await this.api('/safety/unban-share', {
        method: 'POST',
        body: JSON.stringify({ shareCode, userEmail, restoreStrike: true }),
      });
      this.loadStorage();
      this.showToast(res.message || 'Video link restored and strike penalty removed.');
    } catch (err) {
      alert(`Error restoring link: ${err.message}`);
    }
  },

  async scrubOrphans() {
    if (!confirm('Run orphan chunk scrubber on Cloudflare R2 bucket?\n\nThis validates and cleans dangling upload references.')) return;
    try {
      const data = await this.api('/storage/scrub-orphans', { method: 'POST' });
      this.showToast(data.message || 'Scrubber finished');
    } catch (err) {
      alert(`Scrubber error: ${err.message}`);
    }
  },

  executeKillswitch(shareCode) {
    this.openManualTakedownModal(shareCode || '');
  },

  // Utility helpers
  formatBytes(bytes) {
    if (!bytes || bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  },

  escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  },

  // -------------------------------------------------------------
  // TAB 6: FINANCIALS & PAYOUTS
  // -------------------------------------------------------------
  async loadFinancials() {
    try {
      const data = await this.api('/withdrawals');
      this.renderWithdrawalsTable(data.withdrawals || []);
    } catch (err) {
      console.warn('Financials error:', err);
    }
  },

  renderWithdrawalsTable(withdrawals) {
    const tbody = document.getElementById('withdrawals-table-body');
    if (!tbody) return;

    if (withdrawals.length === 0) {
      tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:24px;">No withdrawal requests found.</td></tr>';
      return;
    }

    tbody.innerHTML = withdrawals.map(w => {
      let badgeClass = 'badge-warning';
      if (w.status === 'approved' || w.status === 'completed' || w.status === 'paid' || w.status === 'settled') badgeClass = 'badge-success';
      if (w.status === 'rejected') badgeClass = 'badge-danger';

      return `
        <tr>
          <td><span class="mono-text">${w.id || 'N/A'}</span></td>
          <td><strong class="mono-text" style="color:#60A5FA;">${w.referralCode || 'N/A'}</strong></td>
          <td><strong class="mono-text">$${(w.amountUsd || 0).toFixed(2)}</strong></td>
          <td><span class="badge badge-info">${w.method || 'USDT'}</span></td>
          <td><span class="mono-text" style="font-size:11px;">${w.accountInfo || 'N/A'}</span></td>
          <td><span class="badge ${badgeClass}">${(w.status || 'pending').toUpperCase()}</span></td>
          <td>
            ${w.status === 'pending' ? `
              <button class="btn-sm btn-secondary" onclick="AdminApp.approvePayout('${w.id}')">Approve</button>
              <button class="btn-sm btn-danger" onclick="AdminApp.rejectPayout('${w.id}')">Reject</button>
            ` : '<span style="color:var(--text-muted);font-size:12px;">Processed</span>'}
          </td>
        </tr>
      `;
    }).join('');
  },

  async approvePayout(id) {
    if (!confirm('Approve this withdrawal payout?')) return;
    try {
      await this.api(`/withdrawals/${id}/approve`, { method: 'POST' });
      this.loadFinancials();
      this.showToast('Payout approved successfully');
    } catch (err) {
      alert(`Error approving payout: ${err.message}`);
    }
  },

  async rejectPayout(id) {
    const reason = prompt('Enter rejection reason (Amount will be refunded to wallet):', 'Account details invalid');
    if (!reason) return;

    try {
      await this.api(`/withdrawals/${id}/reject`, {
        method: 'POST',
        body: JSON.stringify({ reason }),
      });
      this.loadFinancials();
      this.showToast('Payout rejected and refunded');
    } catch (err) {
      alert(`Error rejecting payout: ${err.message}`);
    }
  },

  // -------------------------------------------------------------
  // TAB 7: VPS TELEMETRY & PM2
  // -------------------------------------------------------------
  async loadVpsTelemetry() {
    try {
      const data = await this.api('/system/telemetry');
      const snaps = await this.api('/system/snapshots');
      if (data.success) this.renderVpsView(data.telemetry, snaps.snapshots || []);
    } catch (err) {
      console.warn('VPS telemetry error:', err);
    }
  },

  renderVpsView(tel, snapshots) {
    document.getElementById('vps-node-ver').textContent = tel.nodeVersion || 'v20.x';
    document.getElementById('vps-platform').textContent = `${tel.platform} (${tel.arch})`;
    document.getElementById('vps-cpu-cores').textContent = `${tel.cpuCores} Cores`;
    document.getElementById('vps-mem-stat').textContent = `${tel.memUsedMb} MB / ${tel.memTotalMb} MB (${tel.memPercent}%)`;

    // Snapshots table
    const snapTbody = document.getElementById('snapshots-table-body');
    if (snapTbody) {
      if (snapshots.length === 0) {
        snapTbody.innerHTML = '<tr><td colspan="4" style="text-align:center;padding:20px;">No snapshots created yet.</td></tr>';
      } else {
        snapTbody.innerHTML = snapshots.map(s => `
          <tr>
            <td><span class="mono-text">${s.filename}</span></td>
            <td>${s.sizeFormatted}</td>
            <td>${new Date(s.createdAt).toLocaleString()}</td>
            <td>
              <button class="btn-sm btn-danger" onclick="AdminApp.restoreSnapshot('${s.filename}')">Restore</button>
            </td>
          </tr>
        `).join('');
      }
    }
  },

  async pm2Action(action) {
    if (!confirm(`Dispatch PM2 ${action} signal to backend processes?`)) return;
    try {
      const data = await this.api('/system/pm2/action', {
        method: 'POST',
        body: JSON.stringify({ action }),
      });
      this.showToast(data.message || 'Signal sent');
    } catch (err) {
      alert(`PM2 error: ${err.message}`);
    }
  },

  async createSnapshot() {
    try {
      const data = await this.api('/system/snapshots/create', { method: 'POST' });
      this.showToast(data.message || 'Snapshot created');
      this.loadVpsTelemetry();
    } catch (err) {
      alert(`Snapshot error: ${err.message}`);
    }
  },

  async restoreSnapshot(filename) {
    if (!confirm(`WARNING: Restore database state to "${filename}"? Current unbacked changes will be overwritten!`)) return;
    try {
      const data = await this.api('/system/snapshots/restore', {
        method: 'POST',
        body: JSON.stringify({ snapshotName: filename }),
      });
      this.showToast(data.message || 'Database restored');
      this.loadVpsTelemetry();
    } catch (err) {
      alert(`Restore error: ${err.message}`);
    }
  },

  // -------------------------------------------------------------
  // TAB 8: REMOTE CONFIG & APP STATE
  // -------------------------------------------------------------
  async loadConfig() {
    try {
      const data = await this.api('/config');
      this.state.config = data.config;
      this.renderConfigForm(data.config);
      this.loadBroadcastHistory();
    } catch (err) {
      console.warn('Config load error:', err);
    }
  },

  renderConfigForm(cfg) {
    if (!cfg) return;
    const maintToggle = document.getElementById('config-maintenance-toggle');
    if (maintToggle) maintToggle.checked = !!cfg.maintenance_mode_enabled;

    const minVer = document.getElementById('config-min-version');
    if (minVer) minVer.value = cfg.force_update_min_version || '1.0.0';

    const latestVer = document.getElementById('config-latest-version');
    if (latestVer) latestVer.value = cfg.force_update_latest_version || '1.2.0';

    const minWd = document.getElementById('config-min-withdrawal');
    if (minWd) minWd.value = cfg.min_withdrawal_usd !== undefined ? cfg.min_withdrawal_usd : 10.0;

    // VIP Membership & Upgrade System bindings
    const vipToggle = document.getElementById('config-vip-enabled-toggle');
    if (vipToggle) {
      vipToggle.checked = cfg.vip_upgrade_enabled !== false;
      this.onVipToggleChange();
    }

    const vipMaintTitle = document.getElementById('config-vip-maint-title');
    if (vipMaintTitle) vipMaintTitle.value = cfg.vip_maintenance_title || 'VIP Membership Under Maintenance';

    const vipMaintMsg = document.getElementById('config-vip-maint-message');
    if (vipMaintMsg) vipMaintMsg.value = cfg.vip_maintenance_message || 'VIP membership upgrades and subscription services are temporarily undergoing scheduled maintenance. Please check back shortly.';

    // Email / Password Authentication & Manual Signup bindings
    const emailAuthToggle = document.getElementById('config-email-auth-toggle');
    if (emailAuthToggle) {
      emailAuthToggle.checked = cfg.email_auth_enabled !== false;
      this.onEmailAuthToggleChange();
    }

    // Google Mobile Ads (AdMob) Monetization Engine bindings
    const adsToggle = document.getElementById('config-ads-enabled-toggle');
    if (adsToggle) {
      adsToggle.checked = cfg.ads_enabled !== false;
      this.onAdsToggleChange();
    }

    const prerollToggle = document.getElementById('config-preroll-ads-toggle');
    if (prerollToggle) {
      prerollToggle.checked = cfg.shared_video_preroll_ad_enabled !== false;
    }

    const admobAppId = document.getElementById('config-admob-app-id');
    if (admobAppId) admobAppId.value = cfg.admob_app_id || 'ca-app-pub-4299851171687727~9894513295';

    const rewardedUnit = document.getElementById('config-admob-rewarded-unit');
    if (rewardedUnit) rewardedUnit.value = cfg.admob_rewarded_ad_unit_id || 'ca-app-pub-4299851171687727/2661136517';

    const interstitialUnit = document.getElementById('config-admob-interstitial-unit');
    if (interstitialUnit) interstitialUnit.value = cfg.admob_interstitial_ad_unit_id || 'ca-app-pub-4299851171687727/5365164781';

    const bannerUnit = document.getElementById('config-admob-banner-unit');
    if (bannerUnit) bannerUnit.value = cfg.admob_banner_ad_unit_id || 'ca-app-pub-4299851171687727/5151568484';

    const appOpenUnit = document.getElementById('config-admob-app-open-unit');
    if (appOpenUnit) appOpenUnit.value = cfg.admob_app_open_ad_unit_id || 'ca-app-pub-4299851171687727/7675544061';

    const offlineCount = document.getElementById('config-offline-ad-count');
    if (offlineCount) offlineCount.value = cfg.offline_download_ad_count !== undefined ? cfg.offline_download_ad_count : 2;

    const uploadCount = document.getElementById('config-upload-ad-count');
    if (uploadCount) uploadCount.value = cfg.upload_ad_count !== undefined ? cfg.upload_ad_count : 2;

    const streamCount = document.getElementById('config-stream-ad-count');
    if (streamCount) streamCount.value = cfg.video_stream_ad_count !== undefined ? cfg.video_stream_ad_count : 1;

    const cloudSaveCount = document.getElementById('config-cloud-save-ad-count');
    if (cloudSaveCount) cloudSaveCount.value = cfg.cloud_save_ad_count !== undefined ? cfg.cloud_save_ad_count : 1;

    const turboTransferCount = document.getElementById('config-turbo-transfer-ad-count');
    if (turboTransferCount) turboTransferCount.value = cfg.turbo_transfer_ad_count !== undefined ? cfg.turbo_transfer_ad_count : 1;

    const cooldown = document.getElementById('config-interstitial-cooldown');
    if (cooldown) cooldown.value = cfg.interstitial_capping_seconds !== undefined ? cfg.interstitial_capping_seconds : 180;

    const appOpenCooldown = document.getElementById('config-app-open-cooldown');
    if (appOpenCooldown) appOpenCooldown.value = cfg.app_open_cooldown_seconds !== undefined ? cfg.app_open_cooldown_seconds : 14400;
  },

  onVipToggleChange() {
    const vipToggle = document.getElementById('config-vip-enabled-toggle');
    const badge = document.getElementById('config-vip-status-badge');
    if (!vipToggle || !badge) return;

    if (vipToggle.checked) {
      badge.textContent = 'VIP UPGRADES ACTIVE';
      badge.style.background = '#ECFDF5';
      badge.style.color = '#065F46';
    } else {
      badge.textContent = 'UNDER MAINTENANCE';
      badge.style.background = '#FEF3C7';
      badge.style.color = '#92400E';
    }
  },

  onEmailAuthToggleChange() {
    const toggle = document.getElementById('config-email-auth-toggle');
    const badge = document.getElementById('config-email-auth-status-badge');
    if (!toggle || !badge) return;

    if (toggle.checked) {
      badge.textContent = 'EMAIL LOGIN ACTIVE';
      badge.style.background = '#ECFDF5';
      badge.style.color = '#065F46';
    } else {
      badge.textContent = 'HIDDEN (GOOGLE ONLY)';
      badge.style.background = '#F1F5F9';
      badge.style.color = '#475569';
    }
  },

  onAdsToggleChange() {
    const adsToggle = document.getElementById('config-ads-enabled-toggle');
    const badge = document.getElementById('config-ads-status-badge');
    if (!adsToggle || !badge) return;

    if (adsToggle.checked) {
      badge.textContent = 'ADS ACTIVE';
      badge.style.background = '#ECFDF5';
      badge.style.color = '#065F46';
    } else {
      badge.textContent = 'GLOBAL ADS OFF';
      badge.style.background = '#FEE2E2';
      badge.style.color = '#991B1B';
    }
  },

  async saveRemoteConfig() {
    const maintToggle = document.getElementById('config-maintenance-toggle');
    const minVerInput = document.getElementById('config-min-version');
    const latestVerInput = document.getElementById('config-latest-version');
    const minWdInput = document.getElementById('config-min-withdrawal');

    const vipToggle = document.getElementById('config-vip-enabled-toggle');
    const vipMaintTitle = document.getElementById('config-vip-maint-title');
    const vipMaintMsg = document.getElementById('config-vip-maint-message');

    const emailAuthToggle = document.getElementById('config-email-auth-toggle');

    const adsToggle = document.getElementById('config-ads-enabled-toggle');
    const prerollToggle = document.getElementById('config-preroll-ads-toggle');
    const admobAppId = document.getElementById('config-admob-app-id');
    const rewardedUnit = document.getElementById('config-admob-rewarded-unit');
    const interstitialUnit = document.getElementById('config-admob-interstitial-unit');
    const bannerUnit = document.getElementById('config-admob-banner-unit');
    const appOpenUnit = document.getElementById('config-admob-app-open-unit');
    const offlineCount = document.getElementById('config-offline-ad-count');
    const uploadCount = document.getElementById('config-upload-ad-count');
    const streamCount = document.getElementById('config-stream-ad-count');
    const cloudSaveCount = document.getElementById('config-cloud-save-ad-count');
    const turboTransferCount = document.getElementById('config-turbo-transfer-ad-count');
    const cooldown = document.getElementById('config-interstitial-cooldown');
    const appOpenCooldown = document.getElementById('config-app-open-cooldown');

    const rawMinWd = minWdInput ? parseFloat(minWdInput.value) : 1.0;
    const updates = {
      maintenance_mode_enabled: maintToggle ? maintToggle.checked : false,
      force_update_min_version: minVerInput ? minVerInput.value.trim() : '1.0.0',
      force_update_latest_version: latestVerInput ? latestVerInput.value.trim() : '1.2.0',
      min_withdrawal_usd: !isNaN(rawMinWd) && rawMinWd >= 0 ? rawMinWd : 1.0,
      // VIP Membership Updates
      vip_upgrade_enabled: vipToggle ? vipToggle.checked : true,
      vip_maintenance_title: vipMaintTitle ? vipMaintTitle.value.trim() : 'VIP Membership Under Maintenance',
      vip_maintenance_message: vipMaintMsg ? vipMaintMsg.value.trim() : 'VIP membership upgrades and subscription services are temporarily undergoing scheduled maintenance. Please check back shortly.',
      // Email / Password Authentication Updates
      email_auth_enabled: emailAuthToggle ? emailAuthToggle.checked : true,
      // Ad Monetization Updates
      ads_enabled: adsToggle ? adsToggle.checked : true,
      shared_video_preroll_ad_enabled: prerollToggle ? prerollToggle.checked : true,
      admob_app_id: admobAppId ? admobAppId.value.trim() : 'ca-app-pub-4299851171687727~9894513295',
      admob_rewarded_ad_unit_id: rewardedUnit ? rewardedUnit.value.trim() : 'ca-app-pub-4299851171687727/2661136517',
      admob_interstitial_ad_unit_id: interstitialUnit ? interstitialUnit.value.trim() : 'ca-app-pub-4299851171687727/5365164781',
      admob_banner_ad_unit_id: bannerUnit ? bannerUnit.value.trim() : 'ca-app-pub-4299851171687727/5151568484',
      admob_app_open_ad_unit_id: appOpenUnit ? appOpenUnit.value.trim() : 'ca-app-pub-4299851171687727/7675544061',
      offline_download_ad_count: offlineCount ? parseInt(offlineCount.value, 10) ?? 2 : 2,
      upload_ad_count: uploadCount ? parseInt(uploadCount.value, 10) ?? 2 : 2,
      video_stream_ad_count: streamCount ? parseInt(streamCount.value, 10) ?? 1 : 1,
      cloud_save_ad_count: cloudSaveCount ? parseInt(cloudSaveCount.value, 10) ?? 1 : 1,
      turbo_transfer_ad_count: turboTransferCount ? parseInt(turboTransferCount.value, 10) ?? 1 : 1,
      interstitial_capping_seconds: cooldown ? parseInt(cooldown.value, 10) || 180 : 180,
      app_open_cooldown_seconds: appOpenCooldown ? parseInt(appOpenCooldown.value, 10) || 14400 : 14400,
    };

    try {
      const res = await this.api('/config', {
        method: 'PUT',
        body: JSON.stringify(updates),
      });
      if (res && res.config) {
        this.state.config = res.config;
        this.renderConfigForm(res.config);
        const tab3MinWd = document.getElementById('webmaster-min-withdrawal-input');
        if (tab3MinWd && res.config.min_withdrawal_usd !== undefined) {
          tab3MinWd.value = parseFloat(res.config.min_withdrawal_usd).toFixed(2);
        }
      }
      this.showToast('Remote & Ad configuration updated and broadcasted to clients in real-time');
    } catch (err) {
      alert(`Error saving configuration: ${err.message}`);
    }
  },

  // -------------------------------------------------------------
  // PUSH NOTIFICATION DISPATCHER & PREVIEW ENGINE
  // -------------------------------------------------------------

  handlePushInputUpdate() {
    const titleInput = document.getElementById('push-title');
    const bodyInput = document.getElementById('push-body');
    const targetInput = document.getElementById('push-target');
    const categoryInput = document.getElementById('push-category');

    const title = titleInput ? titleInput.value : '';
    const body = bodyInput ? bodyInput.value : '';
    const target = targetInput ? targetInput.value : 'ALL_USERS';
    const category = categoryInput ? categoryInput.value : 'ANNOUNCEMENT';

    // Update character counters
    const titleCountEl = document.getElementById('push-title-count');
    const bodyCountEl = document.getElementById('push-body-count');
    if (titleCountEl) titleCountEl.textContent = `${title.length} / 80`;
    if (bodyCountEl) bodyCountEl.textContent = `${body.length} / 300`;

    // Update Live Mobile Push Bubble Preview
    const previewTitleEl = document.getElementById('preview-bubble-title');
    const previewBodyEl = document.getElementById('preview-bubble-body');
    const previewCategoryEl = document.getElementById('preview-bubble-category');
    const previewTargetPill = document.getElementById('preview-target-pill');

    if (previewTitleEl) {
      previewTitleEl.textContent = title.trim() || 'Free 1024 GB Storage Upgrades Live!';
    }
    if (previewBodyEl) {
      previewBodyEl.textContent = body.trim() || 'Log in now to claim your high-speed cloud storage quota upgrade.';
    }
    if (previewCategoryEl) {
      previewCategoryEl.textContent = category;
    }
    if (previewTargetPill) {
      previewTargetPill.textContent = target === 'WEBMASTERS_ONLY' ? 'Target: Webmasters' : 'Target: All Users';
    }
  },

  applyNotificationTemplate(templateKey) {
    const templates = {
      STORAGE_UPGRADE: {
        title: 'Free 1024 GB High-Speed Storage Boost!',
        body: 'Your AirBox account has been upgraded. Enjoy ultra-fast unlimited cloud backup & streaming.',
        category: 'PROMOTION',
        target: 'ALL_USERS',
        actionUrl: '/storage',
      },
      CPM_BONUS: {
        title: 'Special Weekend Webmaster Bonus: $4.00 CPM!',
        body: 'Earn maximum cash on every video view. Instant automated PayPal & UPI payouts available now.',
        category: 'EARNINGS',
        target: 'WEBMASTERS_ONLY',
        actionUrl: '/webmaster',
      },
      MAINTENANCE: {
        title: 'Scheduled System Performance Optimization',
        body: 'AirBox global servers will undergo scheduled enhancement for faster streaming speeds tonight.',
        category: 'ALERT',
        target: 'ALL_USERS',
        actionUrl: '',
      },
      SECURITY_UPDATE: {
        title: 'New AirBox App Security Update Available',
        body: 'Please update your mobile app to version 1.2.0 for enhanced security and faster multi-threaded downloads.',
        category: 'ANNOUNCEMENT',
        target: 'ALL_USERS',
        actionUrl: 'https://airbox.one',
      },
    };

    const t = templates[templateKey];
    if (!t) return;

    const titleInput = document.getElementById('push-title');
    const bodyInput = document.getElementById('push-body');
    const targetInput = document.getElementById('push-target');
    const categoryInput = document.getElementById('push-category');
    const actionInput = document.getElementById('push-action-url');

    if (titleInput) titleInput.value = t.title;
    if (bodyInput) bodyInput.value = t.body;
    if (targetInput) targetInput.value = t.target;
    if (categoryInput) categoryInput.value = t.category;
    if (actionInput) actionInput.value = t.actionUrl;

    this.handlePushInputUpdate();
  },

  clearPushForm() {
    const titleInput = document.getElementById('push-title');
    const bodyInput = document.getElementById('push-body');
    const targetInput = document.getElementById('push-target');
    const categoryInput = document.getElementById('push-category');
    const actionInput = document.getElementById('push-action-url');

    if (titleInput) titleInput.value = '';
    if (bodyInput) bodyInput.value = '';
    if (targetInput) targetInput.value = 'ALL_USERS';
    if (categoryInput) categoryInput.value = 'ANNOUNCEMENT';
    if (actionInput) actionInput.value = '';

    this.handlePushInputUpdate();
  },

  async sendBroadcastPush() {
    const titleInput = document.getElementById('push-title');
    const bodyInput = document.getElementById('push-body');
    const targetInput = document.getElementById('push-target');
    const categoryInput = document.getElementById('push-category');
    const actionInput = document.getElementById('push-action-url');
    const btn = document.getElementById('btn-broadcast-push');

    const title = titleInput ? titleInput.value.trim() : '';
    const body = bodyInput ? bodyInput.value.trim() : '';
    const target = targetInput ? targetInput.value : 'ALL_USERS';
    const category = categoryInput ? categoryInput.value : 'ANNOUNCEMENT';
    const actionUrl = actionInput ? actionInput.value.trim() : '';

    if (!title) {
      alert('Please enter a notification title.');
      if (titleInput) titleInput.focus();
      return;
    }
    if (!body) {
      alert('Please enter a notification message body.');
      if (bodyInput) bodyInput.focus();
      return;
    }

    if (btn) {
      btn.disabled = true;
      btn.innerHTML = '<span class="status-dot" style="background:#FFFFFF;"></span> Broadcasting...';
    }

    try {
      const res = await this.api('/notifications/broadcast', {
        method: 'POST',
        body: JSON.stringify({ title, body, target, category, actionUrl, priority: 'HIGH' }),
      });

      this.showToast(res.message || `Broadcast successfully dispatched to ${target === 'WEBMASTERS_ONLY' ? 'Webmasters' : 'All Users'}`);
      this.clearPushForm();
      this.loadBroadcastHistory();
    } catch (err) {
      alert(`Broadcast dispatch failed: ${err.message}`);
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="22" y1="2" x2="11" y2="13"></line><polygon points="22 2 15 22 11 13 2 9 22 2"></polygon></svg> Broadcast Notification';
      }
    }
  },

  async loadBroadcastHistory() {
    const tbody = document.getElementById('broadcast-history-table-body');
    const totalBadge = document.getElementById('broadcast-total-badge');
    const reachBadge = document.getElementById('broadcast-reach-badge');
    if (!tbody) return;

    try {
      const data = await this.api('/notifications/broadcast?limit=50');
      const history = data.history || [];
      const stats = data.stats || {};

      if (totalBadge) totalBadge.textContent = `${stats.totalBroadcasts || history.length} Sent`;
      if (reachBadge) reachBadge.textContent = `${stats.totalDelivered || history.length} Delivered`;

      if (history.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:24px;color:var(--text-muted);">No push notifications broadcasted yet.</td></tr>';
        return;
      }

      this._currentBroadcastHistory = history;

      tbody.innerHTML = history.map(item => {
        const timeStr = item.createdAt ? new Date(item.createdAt).toLocaleString() : 'Just now';

        const targetBadge = item.target === 'WEBMASTERS_ONLY'
          ? '<span class="badge" style="background:#EEF2FF; color:#4F46E5; border:1px solid #C7D2FE; font-size:10px;">Webmasters Only</span>'
          : '<span class="badge" style="background:#EFF6FF; color:#1D4ED8; border:1px solid #BFDBFE; font-size:10px;">All Registered Users</span>';

        let catBadgeColor = 'background:#F1F5F9; color:#475569;';
        if (item.category === 'PROMOTION') catBadgeColor = 'background:#ECFDF5; color:#047857; border:1px solid #A7F3D0;';
        if (item.category === 'EARNINGS') catBadgeColor = 'background:#FFFBEB; color:#B45309; border:1px solid #FDE68A;';
        if (item.category === 'ALERT') catBadgeColor = 'background:#FEF2F2; color:#B91C1C; border:1px solid #FECACA;';
        const catBadge = `<span class="badge" style="${catBadgeColor} font-size:10px; margin-bottom:4px; display:inline-block;">${item.category || 'ANNOUNCEMENT'}</span>`;

        return `
          <tr>
            <td>
              <div class="mono-text" style="font-size:11.5px; font-weight:600; color:var(--text-primary);">${timeStr}</div>
              <div style="font-size:10.5px; color:var(--text-muted); margin-top:2px;">By: ${this.escapeHtml(item.senderAdmin || 'Admin')}</div>
            </td>
            <td>
              <div>${catBadge}</div>
              <div>${targetBadge}</div>
            </td>
            <td>
              <strong style="color:var(--text-primary); font-size:12.5px; display:block; line-height:1.3;">${this.escapeHtml(item.title)}</strong>
              ${item.actionUrl ? `<a href="${encodeURI(item.actionUrl)}" target="_blank" style="font-size:10.5px; color:var(--primary); text-decoration:underline; display:inline-flex; align-items:center; gap:2px; margin-top:3px;">Action: ${this.escapeHtml(item.actionUrl)}</a>` : ''}
            </td>
            <td>
              <div style="font-size:12px; color:var(--text-secondary); max-width:280px; line-height:1.35; display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden;" title="${this.escapeHtml(item.body)}">
                ${this.escapeHtml(item.body)}
              </div>
            </td>
            <td>
              <span class="badge badge-info" style="font-size:11px; font-family:var(--font-mono);">${item.deliveredCount || 1} devices</span>
            </td>
            <td>
              <span class="badge badge-success" style="font-size:10px;">DISPATCHED</span>
            </td>
            <td style="text-align: right;">
              <div style="display:inline-flex; gap:4px;">
                <button class="btn-sm btn-secondary" onclick="AdminApp.resendBroadcast('${item.id}')" title="Re-use / Resend" style="padding:3px 7px; font-size:10.5px; display:inline-flex; align-items:center; gap:3px;">
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="23 4 23 10 17 10"></polyline><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"></path></svg>
                  Resend
                </button>
                <button class="btn-sm btn-danger" onclick="AdminApp.deleteBroadcastNotification('${item.id}')" title="Delete" style="padding:3px 6px; font-size:10.5px;">
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
                </button>
              </div>
            </td>
          </tr>
        `;
      }).join('');
    } catch (err) {
      console.warn('Broadcast history error:', err);
    }
  },

  resendBroadcast(id) {
    const list = this._currentBroadcastHistory || [];
    const item = list.find(n => n.id === id);
    if (!item) return;

    const titleInput = document.getElementById('push-title');
    const bodyInput = document.getElementById('push-body');
    const targetInput = document.getElementById('push-target');
    const categoryInput = document.getElementById('push-category');
    const actionInput = document.getElementById('push-action-url');

    if (titleInput) titleInput.value = item.title || '';
    if (bodyInput) bodyInput.value = item.body || '';
    if (targetInput) targetInput.value = item.target || 'ALL_USERS';
    if (categoryInput) categoryInput.value = item.category || 'ANNOUNCEMENT';
    if (actionInput) actionInput.value = item.actionUrl || '';

    this.handlePushInputUpdate();
    if (titleInput) {
      titleInput.scrollIntoView({ behavior: 'smooth', block: 'center' });
      titleInput.focus();
    }
    this.showToast('Notification details loaded into dispatch form.');
  },

  async deleteBroadcastNotification(id) {
    if (!confirm('Delete this broadcast notification from history?')) return;

    try {
      const res = await this.api(`/notifications/broadcast/${encodeURIComponent(id)}`, {
        method: 'DELETE',
      });
      this.showToast(res.message || 'Notification deleted from history.');
      this.loadBroadcastHistory();
    } catch (err) {
      alert(`Delete error: ${err.message}`);
    }
  },

  async clearAllBroadcastHistory() {
    if (!confirm('Permanently clear ALL broadcast notification history? This action cannot be undone.')) return;

    try {
      const res = await this.api('/notifications/broadcast/all', {
        method: 'DELETE',
      });
      this.showToast(res.message || 'All broadcast history cleared.');
      this.loadBroadcastHistory();
    } catch (err) {
      alert(`Clear error: ${err.message}`);
    }
  },

  escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  },

  // -------------------------------------------------------------
  // TAB 9: AUDIT LOGS
  // -------------------------------------------------------------
  async loadAuditLogs() {
    try {
      const data = await this.api('/audit-logs?limit=100');
      const tbody = document.getElementById('audit-table-body');
      if (!tbody) return;

      if (!data.logs || data.logs.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;padding:24px;">No audit records found.</td></tr>';
        return;
      }

      tbody.innerHTML = data.logs.map(l => `
        <tr>
          <td><span class="mono-text" style="font-size:11px;">${new Date(l.timestamp).toLocaleString()}</span></td>
          <td><strong class="mono-text" style="color:#60A5FA;">${l.action}</strong></td>
          <td><span class="mono-text">${l.target || 'GLOBAL'}</span></td>
          <td>${l.details || ''}</td>
          <td><span class="mono-text" style="color:var(--text-muted);font-size:11px;">${l.ip || '127.0.0.1'}</span></td>
        </tr>
      `).join('');
    } catch (err) {
      console.warn('Audit logs error:', err);
    }
  },

  // -------------------------------------------------------------
  // TOAST NOTIFICATIONS
  // -------------------------------------------------------------
  showToast(message) {
    let toast = document.getElementById('admin-toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'admin-toast';
      toast.style.cssText = 'position:fixed;bottom:24px;right:24px;background:#2563EB;color:#FFF;padding:12px 20px;border-radius:10px;font-size:13.5px;font-weight:700;box-shadow:0 10px 30px rgba(0,0,0,0.5);z-index:99999;transition:all 0.3s ease;display:none;';
      document.body.appendChild(toast);
    }
    toast.textContent = message;
    toast.style.display = 'block';
    toast.style.opacity = '1';
    setTimeout(() => {
      toast.style.opacity = '0';
      setTimeout(() => { toast.style.display = 'none'; }, 300);
    }, 3500);
  }
};

document.addEventListener('DOMContentLoaded', () => {
  AdminApp.init();
});
