const { S3Client, PutObjectCommand, ListObjectsV2Command } = require('@aws-sdk/client-s3');
const { NodeHttpHandler } = require('@smithy/node-http-handler');
const https = require('https');

const agent = new https.Agent({
  family: 4, // STRICT IPv4 ONLY!
  servername: 'r2.cloudflarestorage.com',
  keepAlive: true,
});

const client = new S3Client({
  region: 'auto',
  endpoint: 'https://86128b02ac7526b0a2c7841f2b4e8fe7.r2.cloudflarestorage.com',
  credentials: {
    accessKeyId: '492e4a8dd5133f89c1ce199e8c29f6f9',
    secretAccessKey: '80bdb65f91237cc67e68987bfbcc73d36410c991010504480e741a5d4ede2fb6',
  },
  forcePathStyle: true,
  requestHandler: new NodeHttpHandler({
    httpsAgent: agent,
  }),
});

async function run() {
  console.log('Testing S3Client with STRICT IPv4 (family: 4)...');
  try {
    const listRes = await client.send(new ListObjectsV2Command({
      Bucket: 'terabox-cloud-storage',
      MaxKeys: 1,
    }));
    console.log('🎉🎉🎉 Cloudflare R2 Connected via IPv4!', listRes);
  } catch (err) {
    console.error('Result:', err.message);
  }
}

run();
