const { S3Client, GetObjectCommand } = require('@aws-sdk/client-s3');
const env = require('./src/config/env');

const client = new S3Client({
  region: 'auto',
  endpoint: `https://${env.r2.accountId}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: env.r2.accessKeyId,
    secretAccessKey: env.r2.secretAccessKey,
  },
});

async function readJson(key) {
  try {
    const cmd = new GetObjectCommand({
      Bucket: env.r2.bucketName,
      Key: key,
    });
    const res = await client.send(cmd);
    const body = await res.Body.transformToString();
    console.log(`=== ${key} ===`);
    console.log(body);
  } catch (err) {
    console.error(`Failed to read ${key}:`, err.message);
  }
}

async function main() {
  await readJson('shares/TBX_MT9X80TW.json');
  await readJson('shares/TBX_MTA0H1BU.json');
  await readJson('shares/TBX_MTA0MBLL.json');
  await readJson('shares/TBX_MTA0P7NI.json');
  await readJson('shares/TBX_MTA77Z0I.json');
}

main();
