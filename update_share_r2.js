const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const env = require('./src/config/env');

const client = new S3Client({
  region: 'auto',
  endpoint: `https://${env.r2.accountId}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: env.r2.accessKeyId,
    secretAccessKey: env.r2.secretAccessKey,
  },
});

const correctedShare = {
  "code": "TBX_MTA77Z0I",
  "fileId": "node_1787752900419_2465",
  "fileName": "I.Nobody.2026.480p.DS4K.WEB-DL.Hindi-Malayalam.ESub.x264-HDHub4u.Ms.mkv",
  "sizeBytes": 670954708,
  "extension": "mkv",
  "isVideo": true,
  "durationSeconds": 120,
  "r2Key": "uploads/1787754337546_I.Nobody.2026.480p.DS4K.WEB-DL.Hindi-Malayalam.ESub.x264-HDHub4u.Ms.mkv",
  "downloadUrl": "https://pub-d550feaadd484541bf0c3af429db5905.r2.dev/uploads/1787754337546_I.Nobody.2026.480p.DS4K.WEB-DL.Hindi-Malayalam.ESub.x264-HDHub4u.Ms.mkv",
  "streamUrl": "https://pub-d550feaadd484541bf0c3af429db5905.r2.dev/uploads/1787754337546_I.Nobody.2026.480p.DS4K.WEB-DL.Hindi-Malayalam.ESub.x264-HDHub4u.Ms.mkv",
  "createdAt": "2026-08-26T14:38:10.578Z",
  "viewsCount": 2,
  "appRedirectUrl": "terabox://share/TBX_MTA77Z0I",
  "shareUrl": "https://teraboxbackend.vercel.app/s/TBX_MTA77Z0I"
};

async function main() {
  try {
    const cmd = new PutObjectCommand({
      Bucket: env.r2.bucketName,
      Key: 'shares/TBX_MTA77Z0I.json',
      Body: JSON.stringify(correctedShare, null, 2),
      ContentType: 'application/json',
    });
    await client.send(cmd);
    console.log('Successfully corrected shares/TBX_MTA77Z0I.json inside Cloudflare R2 bucket!');
  } catch (err) {
    console.error('Failed to update share JSON:', err.message);
  }
}

main();
