const { S3Client, PutObjectCommand, ListObjectsV2Command } = require('@aws-sdk/client-s3');
const { NodeHttpHandler } = require('@smithy/node-http-handler');
const https = require('https');

async function testR2Agent() {
  const accountId = '86128b02ac7526b0a2c7841f2b4e8fe7';
  console.log(`Connecting to: https://${accountId}.r2.cloudflarestorage.com`);

  const agent = new https.Agent({
    keepAlive: true,
    servername: `${accountId}.r2.cloudflarestorage.com`,
  });

  const client = new S3Client({
    region: 'auto',
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: '492e4a8dd5133f89c1ce199e8c29f6f9',
      secretAccessKey: '80bdb65f91237cc67e68987bfbcc73d36410c991010504480e741a5d4ede2fb6',
    },
    requestHandler: new NodeHttpHandler({
      httpsAgent: agent,
    }),
  });

  try {
    const res = await client.send(new PutObjectCommand({
      Bucket: 'terabox-cloud-storage',
      Key: 'test/hello.txt',
      Body: 'TeraBox Cloudflare R2 Online!',
      ContentType: 'text/plain',
    }));
    console.log('✅ PutObject SUCCESS:', res);

    const listRes = await client.send(new ListObjectsV2Command({
      Bucket: 'terabox-cloud-storage',
      MaxKeys: 5,
    }));
    console.log('✅ ListObjects SUCCESS:', listRes.Contents);
  } catch (err) {
    console.error('❌ Error with agent:', err);
  }
}

testR2Agent();
