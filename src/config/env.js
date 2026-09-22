require('dotenv').config();

module.exports = {
  port: parseInt(process.env.PORT, 10) || 4000,
  jwtSecret: process.env.JWT_SECRET || 'airbox_enterprise_jwt_master_secret_key_2026',
  storageProvider: process.env.STORAGE_PROVIDER || 'r2',
  appUrl: process.env.APP_URL || 'https://airbox.one',
  r2: {
    accountId: process.env.R2_ACCOUNT_ID || '',
    accessKeyId: process.env.R2_ACCESS_KEY_ID || '',
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY || '',
    bucketName: process.env.R2_BUCKET_NAME || 'terabox-cloud-storage',
    publicDomain: process.env.R2_PUBLIC_DOMAIN || 'https://pub-d550feaadd484541bf0c3af429db5905.r2.dev',
  },
  webmaster: {
    ratePerNewUserUsd: 0.05,
    ratePer100NewUsers: 5.00,
    ratePer1000VideoPlays: 4.00,
    vipCommissionRate: 0.50,
    minWithdrawalUsd: 10.0,
  },
};

