const { S3Client, ListObjectsV2Command, DeleteObjectsCommand } = require('@aws-sdk/client-s3');
const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');
const env = require('../src/config/env');

const s3 = new S3Client({
  region: 'auto',
  endpoint: `https://${env.r2.accountId}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: env.r2.accessKeyId,
    secretAccessKey: env.r2.secretAccessKey,
  },
  forcePathStyle: true,
});

async function purgeR2Bucket() {
  console.log('1. Purging all objects from Cloudflare R2 bucket: ' + env.r2.bucketName + '...');
  let continuationToken = null;
  let totalDeleted = 0;

  do {
    const listCmd = new ListObjectsV2Command({
      Bucket: env.r2.bucketName,
      ContinuationToken: continuationToken,
    });
    const listRes = await s3.send(listCmd);

    if (listRes.Contents && listRes.Contents.length > 0) {
      const deleteCmd = new DeleteObjectsCommand({
        Bucket: env.r2.bucketName,
        Delete: {
          Objects: listRes.Contents.map(c => ({ Key: c.Key })),
          Quiet: true,
        },
      });
      await s3.send(deleteCmd);
      totalDeleted += listRes.Contents.length;
      console.log(` - Deleted batch of ${listRes.Contents.length} objects from R2 (Total: ${totalDeleted})`);
    }

    continuationToken = listRes.NextContinuationToken;
  } while (continuationToken);

  console.log(`✅ Cloudflare R2 completely purged! Total objects deleted: ${totalDeleted}`);
}

function resetLocalFiles() {
  console.log('\n2. Resetting local database files in terabox_backend/data and temp_deploy/data...');
  const paths = [
    path.join(__dirname, '../data/users.json'),
    path.join(__dirname, '../data/shares.json'),
    path.join(__dirname, '../data/webmasters.json'),
    path.join(__dirname, '../../temp_deploy/data/users.json'),
    path.join(__dirname, '../../temp_deploy/data/shares.json'),
    path.join(__dirname, '../../temp_deploy/data/webmasters.json'),
  ];

  for (const p of paths) {
    const dir = path.dirname(p);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(p, '[]', 'utf8');
    console.log(` - Cleaned: ${p}`);
  }
  console.log('✅ Local and temp_deploy databases reset to [].');
}

function tryHttp(url, method = 'GET') {
  return new Promise((resolve) => {
    try {
      const u = new URL(url);
      const client = u.protocol === 'https:' ? https : http;
      const req = client.request(u, { method, timeout: 5000 }, (res) => {
        let data = '';
        res.on('data', c => data += c);
        res.on('end', () => resolve({ status: res.statusCode, data }));
      });
      req.on('error', (err) => resolve({ error: err.message }));
      req.on('timeout', () => { req.destroy(); resolve({ error: 'timeout' }); });
      req.end();
    } catch (e) {
      resolve({ error: e.message });
    }
  });
}

async function notifyRemoteVPS() {
  console.log('\n3. Checking Live VPS status...');
  const vps1 = await tryHttp('https://terabox.mywire.org/health', 'GET');
  console.log(' - terabox.mywire.org health check:', vps1);
  const vps2 = await tryHttp('http://139.99.76.21:4000/health', 'GET');
  console.log(' - 139.99.76.21:4000 health check:', vps2);
}

async function main() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('🧹 COMPLETE CLOUD & LOCAL STORAGE WIPE FOR FRESH REAL TESTING');
  console.log('═══════════════════════════════════════════════════════════════\n');

  await purgeR2Bucket();
  resetLocalFiles();
  await notifyRemoteVPS();

  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('🎉 ALL USER SIGNUP/LOGIN DATA, SHARES, AND CLOUD STORAGE WIPED!');
  console.log('═══════════════════════════════════════════════════════════════');
}

main().catch(console.error);
