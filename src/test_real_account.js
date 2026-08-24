const { S3Client, PutObjectCommand, ListObjectsV2Command } = require('@aws-sdk/client-s3');
const { NodeHttpHandler } = require('@smithy/node-http-handler');
const https = require('https');

const agent = new https.Agent({
  family: 4,
  keepAlive: true,
});

const client = new S3Client({
  region: 'auto',
  endpoint: 'https://86428b02ac7526b0a2c784f2b4e8fe7e.r2.cloudflarestorage.com',
  credentials: {
    accessKeyId: '492e4a8dd5133f89c1ce199e8c29f6f9',
    secretAccessKey: '80bdb65f91237cc67e68987bfbcc73d36410c991010504480e741a5d4ede2fb6',
  },
  forcePathStyle: true,
  requestHandler: new NodeHttpHandler({
    httpsAgent: agent,
  }),
});

async function test() {
  console.log('Testing with real Cloudflare R2 Account ID: 86428b02ac7526b0a2c784f2b4e8fe7e (family: 4)...');
  try {
    const listRes = await client.send(new ListObjectsV2Command({
      Bucket: 'terabox-cloud-storage',
      MaxKeys: 10,
    }));
    console.log('🎉🎉🎉 SUCCESS! Connected to Cloudflare R2 Bucket!');
    console.log('Bucket Contents:', listRes.Contents || []);

    const putRes = await client.send(new PutObjectCommand({
      Bucket: 'terabox-cloud-storage',
      Key: 'terabox_verified_test.txt',
      Body: 'Hello Cloudflare R2! Upload from TeraBox cloud storage verified.',
      ContentType: 'text/plain',
    }));
    console.log('🎉🎉🎉 PUT OBJECT SUCCESS! File is now physically inside Cloudflare R2 bucket!', putRes);
  } catch (err) {
    console.error('❌ Error:', err.message);
  }
}

test();
