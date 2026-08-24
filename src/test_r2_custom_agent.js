const { S3Client, PutObjectCommand, ListObjectsV2Command } = require('@aws-sdk/client-s3');
const { NodeHttpHandler } = require('@smithy/node-http-handler');
const https = require('https');
const env = require('./config/env');

const agent = new https.Agent({
  servername: 'r2.cloudflarestorage.com',
  keepAlive: true,
});

const client = new S3Client({
  region: 'auto',
  endpoint: `https://${env.r2.accountId}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: env.r2.accessKeyId,
    secretAccessKey: env.r2.secretAccessKey,
  },
  forcePathStyle: true, // Crucial for Cloudflare R2!
  requestHandler: new NodeHttpHandler({
    httpsAgent: agent,
  }),
});

async function test() {
  console.log('Testing S3Client with forcePathStyle: true to Cloudflare R2...');
  try {
    const putRes = await client.send(new PutObjectCommand({
      Bucket: env.r2.bucketName,
      Key: 'test_real_file.txt',
      Body: 'Hello Cloudflare R2! Real upload verified from TeraBox backend.',
      ContentType: 'text/plain',
    }));
    console.log('🎉 PutObject to Cloudflare R2 Success!', putRes);

    const listRes = await client.send(new ListObjectsV2Command({
      Bucket: env.r2.bucketName,
      MaxKeys: 10,
    }));
    console.log('🎉 ListObjectsV2 Bucket contents from Cloudflare R2:');
    console.log(listRes.Contents);
  } catch (err) {
    console.error('❌ Error:', err);
  }
}

test();
