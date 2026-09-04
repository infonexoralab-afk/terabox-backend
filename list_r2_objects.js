const { S3Client, ListObjectsV2Command } = require('@aws-sdk/client-s3');
const env = require('./src/config/env');

const client = new S3Client({
  region: 'auto',
  endpoint: `https://${env.r2.accountId}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: env.r2.accessKeyId,
    secretAccessKey: env.r2.secretAccessKey,
  },
});

async function main() {
  try {
    console.log('Listing files in bucket:', env.r2.bucketName);
    const command = new ListObjectsV2Command({
      Bucket: env.r2.bucketName,
    });
    const res = await client.send(command);
    if (res.Contents && res.Contents.length > 0) {
      res.Contents.forEach((obj) => {
        console.log(`- ${obj.Key} (Size: ${(obj.Size / 1024 / 1024).toFixed(2)} MB)`);
      });
    } else {
      console.log('No files found in the bucket.');
    }
  } catch (err) {
    console.error('Error listing objects:', err);
  }
}

main();
