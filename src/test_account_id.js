const { S3Client, ListObjectsV2Command, PutObjectCommand } = require('@aws-sdk/client-s3');
const env = require('./config/env');

const accountIds = [
  '86428b02ac7526b0a2c7841f2b4e8fe7',
  '86428b02ac7526b0a2c7841f2b4e8fe7e',
  '86128b02ac7526b0a2c7841f2b4e8fe7',
];

async function testAccounts() {
  for (const accId of accountIds) {
    console.log(`\nTesting Account ID: [${accId}]...`);
    const client = new S3Client({
      region: 'auto',
      endpoint: `https://${accId}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: '492e4a8dd5133f89c1ce199e8c29f6f9',
        secretAccessKey: '80bdb65f91237cc67e68987bfbcc73d36410c991010504480e741a5d4ede2fb6',
      },
    });

    try {
      const putRes = await client.send(new PutObjectCommand({
        Bucket: 'terabox-cloud-storage',
        Key: 'test-direct-real-file.txt',
        Body: 'Hello Cloudflare R2! Real upload from TeraBox backend.',
        ContentType: 'text/plain',
      }));
      console.log(`🎉 SUCCESS on Account ID [${accId}]!`, putRes);

      const listRes = await client.send(new ListObjectsV2Command({
        Bucket: 'terabox-cloud-storage',
      }));
      console.log(`🎉 Bucket contents for [${accId}]:`, listRes.Contents);
      return accId;
    } catch (e) {
      console.log(`❌ Failed for [${accId}]:`, e.message);
    }
  }
}

testAccounts();
