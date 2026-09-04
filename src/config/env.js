require('dotenv').config();

module.exports = {
  port: process.env.PORT || 4000,
  jwtSecret: process.env.JWT_SECRET || 'terabox_jwt_secret_key_2026',
  storageProvider: process.env.STORAGE_PROVIDER || 'r2',
  appUrl: process.env.APP_URL || 'https://teraboxbackend.vercel.app',
  r2: {
    accountId: process.env.R2_ACCOUNT_ID || '86428b02ac7526b0a2c784f2b4e8fe7e',
    accessKeyId: process.env.R2_ACCESS_KEY_ID || '492e4a8dd5133f89c1ce199e8c29f6f9',
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY || '80bdb65f91237cc67e68987bfbcc73d36410c991010504480e741a5d4ede2fb6',
    bucketName: process.env.R2_BUCKET_NAME || 'terabox-cloud-storage',
    publicDomain: process.env.R2_PUBLIC_DOMAIN || 'https://pub-d550feaadd484541bf0c3af429db5905.r2.dev',
  },
  webmaster: {
    ratePer100NewUsers: 1.30,
    ratePer1000VideoPlays: 4.00,
    vipCommissionRate: 0.50,
    minWithdrawalUsd: 10.0,
  },
};
