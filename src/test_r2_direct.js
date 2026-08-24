const { S3Client, PutObjectCommand, ListObjectsV2Command } = require('@aws-sdk/client-s3');
const env = require('./config/env');

async function test() {
  console.log('Testing Cloudflare R2 connection...');
  console.log('Account ID:', env.r2.accountId);
  console.log('Bucket:', env.r2.bucketName);
  console.log('AccessKeyId:', env.r2.accessKeyId);

  const client = new S3Client({
    region: 'auto',
    endpoint: `https://${env.r2.accountId}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: env.r2.accessKeyId,
      secretAccessKey: env.r2.secretAccessKey,
    },
  });

  try {
    const putRes = await client.send(new PutObjectCommand({
      Bucket: env.r2.bucketName,
      Key: 'test-real-upload.txt',
      Body: 'Hello from TeraBox Cloudflare R2 real upload test!',
      ContentType: 'text/plain',
    }));
    console.log('✅ PutObject Success:', putRes);
  } catch (e) {
    console.error('❌ PutObject Error:', e);
  }
}

test();
