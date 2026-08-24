const { S3Client, PutObjectCommand, ListObjectsV2Command } = require('@aws-sdk/client-s3');
const { NodeHttpHandler } = require('@smithy/node-http-handler');
const https = require('https');

const agent = new https.Agent({
  servername: 'r2.cloudflarestorage.com',
  keepAlive: true,
});

const candidates = [
  '86428b02ac7526b0a2c7841f2b4e8fe7e',
  '86428b02ac7526b0a2c7841f2b4e8fe7',
  '86128b02ac7526b0a2c7841f2b4e8fe7',
];

async function run() {
  for (const acc of candidates) {
    console.log(`\nTesting with Account ID: [${acc}]`);
    const client = new S3Client({
      region: 'auto',
      endpoint: `https://${acc}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: '492e4a8dd5133f89c1ce199e8c29f6f9',
        secretAccessKey: '80bdb65f91237cc67e68987bfbcc73d36410c991010504480e741a5d4ede2fb6',
      },
      requestHandler: new NodeHttpHandler({
        httpsAgent: agent,
      }),
    });

    try {
      const putRes = await client.send(new PutObjectCommand({
        Bucket: 'terabox-cloud-storage',
        Key: 'verified_r2_upload.txt',
        Body: 'Real Cloudflare R2 Upload Successful!',
        ContentType: 'text/plain',
      }));
      console.log(`🎉🎉🎉 SUCCESS WITH ACCOUNT ID [${acc}]!`, putRes);
      return acc;
    } catch (e) {
      console.log(`❌ Failed for [${acc}]:`, e.message);
    }
  }
}

run();
