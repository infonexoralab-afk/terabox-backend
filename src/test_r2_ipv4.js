const dns = require('dns');
dns.setDefaultResultOrder('ipv4first');

const { S3Client, PutObjectCommand, ListObjectsV2Command } = require('@aws-sdk/client-s3');
const { NodeHttpHandler } = require('@smithy/node-http-handler');
const https = require('https');

const agent = new https.Agent({
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
  console.log('Testing Cloudflare R2 connection with IPv4 and path-style addressing...');
  try {
    const putRes = await client.send(new PutObjectCommand({
      Bucket: 'terabox-cloud-storage',
      Key: 'test_r2_live.txt',
      Body: 'Hello Cloudflare R2! Real upload verification.',
      ContentType: 'text/plain',
    }));
    console.log('🎉🎉 PutObject SUCCESS:', putRes);

    const listRes = await client.send(new ListObjectsV2Command({
      Bucket: 'terabox-cloud-storage',
    }));
    console.log('🎉 Bucket Objects:', listRes.Contents || []);
  } catch (err) {
    console.error('Test Result:', err.message);
  }
}

run();
