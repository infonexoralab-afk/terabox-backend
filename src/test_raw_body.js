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
  forcePathStyle: true,
  requestHandler: new NodeHttpHandler({
    httpsAgent: agent,
  }),
});

async function test() {
  try {
    const putRes = await client.send(new PutObjectCommand({
      Bucket: env.r2.bucketName,
      Key: 'test.txt',
      Body: 'test',
    }));
  } catch (err) {
    if (err.$response && err.$response.body) {
      console.log('Raw Response Status:', err.$response.statusCode);
      console.log('Raw Response Body:', err.$response.body.toString());
    } else {
      console.log('Error:', err);
    }
  }
}

test();
