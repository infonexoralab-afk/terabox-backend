const fs = require('fs');
const path = require('path');
const adminAuthService = require('./adminAuthService');

const CONFIG_FILE = path.join(__dirname, '../../data/system_config.json');

const DEFAULT_SYSTEM_CONFIG = {
  // Webmaster Monetization & Master Killswitch
  webmaster_program_enabled: true,
  webmaster_disabled_title: 'Creator Program Upgrades in Progress',
  webmaster_disabled_subtitle: 'Coming Soon / Maintenance',
  webmaster_disabled_message:
    'The Webmaster Monetization Center is currently undergoing scheduled enhancements. New video sharing tools and creator bonuses will be available soon.',
  global_cpm_rate_usd: 4.0, // Flat $4.00 / 1,000 Views ($0.0040 / View)

  // CPA Referral Program
  cpa_reward_per_install_usd: 0.05, // $0.05 USD per verified install
  cpa_promotional_multiplier: 1.0,
  milestone_min_upload_mb: 2.0,
  milestone_min_stream_seconds: 60,

  // Storage & Quota Micro-Settings
  default_storage_quota_bytes: 1099511627776, // 1,024 GB (1 TB)
  max_single_upload_mb: 4096,

  // Financials & Withdrawals
  min_withdrawal_usd: 10.0,
  usdt_trc20_fee_usd: 1.0,
  usdt_bep20_fee_usd: 0.5,
  paypal_fee_percent: 2.5,
  upi_fee_inr: 0.0,

  // Remote Application State & Updates
  maintenance_mode_enabled: false,
  maintenance_title: 'Scheduled System Upgrade',
  maintenance_message:
    'We are upgrading our storage infrastructure. Services will be back online shortly.',
  force_update_min_version: '1.0.0',
  force_update_latest_version: '1.2.0',
  play_store_url: 'https://play.google.com/store/apps/details?id=com.airbox.cloud.storage',

  // Google Mobile Ads (AdMob) Monetization Engine & Remote Switches
  ads_enabled: true, // Master Switch: If false, disables all ads across entire app
  shared_video_preroll_ad_enabled: true, // Show Pre-Roll video ad before shared video streams
  admob_app_id: 'ca-app-pub-3940256099942544~3347511713', // AdMob App ID
  admob_banner_ad_unit_id: 'ca-app-pub-3940256099942544/6300978111',
  admob_interstitial_ad_unit_id: 'ca-app-pub-3940256099942544/1033173712',
  admob_rewarded_ad_unit_id: 'ca-app-pub-3940256099942544/5224354917',
  admob_app_open_ad_unit_id: 'ca-app-pub-3940256099942544/9257390301',
  offline_download_ad_count: 2, // Free users must watch N rewarded ads for offline download (0 = disabled)
  upload_ad_count: 2, // Free users must watch N rewarded ads before uploading files (0 = disabled)
  video_stream_ad_count: 1, // Free users must watch N rewarded ads before streaming cloud videos (0 = disabled)
  cloud_save_ad_count: 1, // Free users must watch N rewarded ads before saving shared links to cloud (0 = disabled)
  turbo_transfer_ad_count: 1, // Free users must watch N rewarded ads for turbo transfer speed boost (0 = disabled)
  interstitial_capping_seconds: 180, // Cooldown between interstitial ads (3 mins)
  app_open_cooldown_seconds: 14400, // Cooldown between app open ads (4 hours)

  // System Metadata
  updated_at: new Date().toISOString(),
  last_updated_by: 'adm_master_root_01',
};

class SystemConfigStore {
  constructor() {
    this.config = { ...DEFAULT_SYSTEM_CONFIG };
    this.listeners = new Set();
    this._loadConfigFromDisk();
  }

  _loadConfigFromDisk() {
    try {
      const dataDir = path.dirname(CONFIG_FILE);
      if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir, { recursive: true });
      }

      if (fs.existsSync(CONFIG_FILE)) {
        const raw = fs.readFileSync(CONFIG_FILE, 'utf8');
        const parsed = JSON.parse(raw || '{}');
        // Clean legacy ad keys from parsed disk if present
        ['applovin_sdk_key', 'applovin_rewarded_ad_unit_id', 'applovin_interstitial_ad_unit_id', 'applovin_banner_ad_unit_id', 'applovin_native_ad_unit_id', 'applovin_app_open_ad_unit_id'].forEach(k => delete parsed[k]);

        this.config = { ...DEFAULT_SYSTEM_CONFIG, ...parsed };
      } else {
        this._persistToDisk();
      }
    } catch (err) {
      console.error('[SystemConfigStore] Error loading config from disk:', err.message);
      this.config = { ...DEFAULT_SYSTEM_CONFIG };
    }
  }

  _persistToDisk() {
    try {
      const tempPath = CONFIG_FILE + '.tmp';
      fs.writeFileSync(tempPath, JSON.stringify(this.config, null, 2), 'utf8');
      fs.renameSync(tempPath, CONFIG_FILE);
    } catch (err) {
      console.error('[SystemConfigStore] Error persisting config to disk:', err.message);
    }
  }

  get(key, defaultValue = null) {
    if (this.config.hasOwnProperty(key)) {
      return this.config[key];
    }
    return defaultValue;
  }

  getAll() {
    return { ...this.config };
  }

  getPublicConfig() {
    return {
      webmaster_program_enabled: this.config.webmaster_program_enabled,
      webmaster_disabled_title: this.config.webmaster_disabled_title,
      webmaster_disabled_subtitle: this.config.webmaster_disabled_subtitle,
      webmaster_disabled_message: this.config.webmaster_disabled_message,
      global_cpm_rate_usd: this.config.global_cpm_rate_usd,
      cpa_reward_per_install_usd: this.config.cpa_reward_per_install_usd,
      min_withdrawal_usd: this.config.min_withdrawal_usd,
      maintenance_mode_enabled: this.config.maintenance_mode_enabled,
      maintenance_title: this.config.maintenance_title,
      maintenance_message: this.config.maintenance_message,
      force_update_min_version: this.config.force_update_min_version,
      force_update_latest_version: this.config.force_update_latest_version,
      play_store_url: this.config.play_store_url,
      // Google Mobile Ads (AdMob) Public Config
      ads_enabled: this.config.ads_enabled !== false,
      shared_video_preroll_ad_enabled: this.config.shared_video_preroll_ad_enabled !== false,
      admob_app_id: this.config.admob_app_id || 'ca-app-pub-3940256099942544~3347511713',
      admob_banner_ad_unit_id: this.config.admob_banner_ad_unit_id || 'ca-app-pub-3940256099942544/6300978111',
      admob_interstitial_ad_unit_id: this.config.admob_interstitial_ad_unit_id || 'ca-app-pub-3940256099942544/1033173712',
      admob_rewarded_ad_unit_id: this.config.admob_rewarded_ad_unit_id || 'ca-app-pub-3940256099942544/5224354917',
      admob_app_open_ad_unit_id: this.config.admob_app_open_ad_unit_id || 'ca-app-pub-3940256099942544/9257390301',
      offline_download_ad_count: parseInt(this.config.offline_download_ad_count, 10) ?? 2,
      upload_ad_count: parseInt(this.config.upload_ad_count, 10) ?? 2,
      video_stream_ad_count: parseInt(this.config.video_stream_ad_count, 10) ?? 1,
      cloud_save_ad_count: parseInt(this.config.cloud_save_ad_count, 10) ?? 1,
      turbo_transfer_ad_count: parseInt(this.config.turbo_transfer_ad_count, 10) ?? 1,
      interstitial_capping_seconds: parseInt(this.config.interstitial_capping_seconds, 10) || 180,
      app_open_cooldown_seconds: parseInt(this.config.app_open_cooldown_seconds, 10) || 14400,
    };
  }

  /**
   * Update a single configuration parameter in real-time
   */
  update(key, value, adminId = 'adm_master_root_01', ip = '127.0.0.1') {
    const previous = this.config[key];
    this.config[key] = value;
    this.config.updated_at = new Date().toISOString();
    this.config.last_updated_by = adminId;

    this._persistToDisk();

    adminAuthService.recordAuditLog({
      adminId,
      action: 'CONFIG_MUTATION',
      target: `CONFIG:${key}`,
      details: `Updated ${key} from ${JSON.stringify(previous)} to ${JSON.stringify(value)}`,
      ip,
    });

    this._notifyListeners({ key, value, previous });
    return this.config;
  }

  /**
   * Update multiple configuration parameters in a batch
   */
  updateBatch(updates = {}, adminId = 'adm_master_root_01', ip = '127.0.0.1') {
    const changedKeys = [];

    for (const [key, rawValue] of Object.entries(updates)) {
      let value = rawValue;
      if (key === 'global_cpm_rate_usd' || key === 'cpa_reward_per_install_usd' || key === 'min_withdrawal_usd' || key === 'default_storage_quota_bytes') {
        const parsed = parseFloat(rawValue);
        if (!isNaN(parsed)) value = parsed;
      } else if (
        key === 'offline_download_ad_count' ||
        key === 'upload_ad_count' ||
        key === 'video_stream_ad_count' ||
        key === 'cloud_save_ad_count' ||
        key === 'turbo_transfer_ad_count' ||
        key === 'interstitial_capping_seconds' ||
        key === 'app_open_cooldown_seconds'
      ) {
        const parsed = parseInt(rawValue, 10);
        if (!isNaN(parsed)) value = parsed;
      } else if (
        key === 'webmaster_program_enabled' ||
        key === 'maintenance_mode_enabled' ||
        key === 'ads_enabled' ||
        key === 'shared_video_preroll_ad_enabled'
      ) {
        value = rawValue === true || rawValue === 'true' || rawValue === 1 || rawValue === '1';
      }
      if (this.config[key] !== value) {
        changedKeys.push({ key, old: this.config[key], new: value });
        this.config[key] = value;
      }
    }

    if (changedKeys.length > 0) {
      this.config.updated_at = new Date().toISOString();
      this.config.last_updated_by = adminId;
      this._persistToDisk();

      adminAuthService.recordAuditLog({
        adminId,
        action: 'BATCH_CONFIG_MUTATION',
        target: 'SYSTEM_CONFIG',
        details: `Batch mutated ${changedKeys.length} settings: ${changedKeys.map(c => c.key).join(', ')}`,
        ip,
      });

      this._notifyListeners({ batch: changedKeys });
    }

    return this.config;
  }

  registerChangeListener(listener) {
    if (typeof listener === 'function') {
      this.listeners.add(listener);
    }
  }

  unregisterChangeListener(listener) {
    if (typeof listener === 'function') {
      this.listeners.delete(listener);
    }
  }

  _notifyListeners(changeEvent) {
    for (const listener of this.listeners) {
      try {
        listener(changeEvent, this.config);
      } catch (err) {
        console.error('[SystemConfigStore] Error in change listener:', err.message);
      }
    }
  }
}

module.exports = new SystemConfigStore();
