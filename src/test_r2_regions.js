const crypto = require('crypto');
const https = require('https');

const accountId = '86128b02ac7526b0a2c7841f2b4e8fe7';
const accessKey = '492e4a8dd5133f89c1ce199e8c29f6f9';
const secretKey = '80bdb65f91237cc67e68987bfbcc73d36410c991010504480e741a5d4ede2fb6';
const bucketName = 'terabox-cloud-storage';
const regions = ['auto', 'us-east-1', 'apac', 'weur', 'eeur', 'wnam', 'enam'];

function hmac(key, str, encoding) {
  return crypto.createHmac('sha256', key).update(str, 'utf8').digest(encoding);
}

function sha256(str) {
  return crypto.createHash('sha256').update(str, typeof str === 'string' ? 'utf8' : undefined).digest('hex');
}

function getSignatureKey(key, dateStamp, regionName, serviceName) {
  const kDate = hmac('AWS4' + key, dateStamp);
  const kRegion = hmac(kDate, regionName);
  const kService = hmac(kRegion, serviceName);
  const kSigning = hmac(kService, 'aws4_request');
  return kSigning;
}

async function testUploadWithRegion(reg) {
  return new Promise((resolve) => {
    const host = `${accountId}.r2.cloudflarestorage.com`;
    const path = `/${bucketName}/test_file_${reg}.txt`;
    const method = 'PUT';
    const body = Buffer.from(`Testing region ${reg} direct to Cloudflare R2!`);
    const payloadHash = sha256(body);

    const now = new Date();
    const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
    const dateStamp = amzDate.substring(0, 8);

    const canonicalUri = path;
    const canonicalQuery = '';
    const canonicalHeaders = `content-type:text/plain\nhost:${host}\nx-amz-content-sha256:${payloadHash}\nx-amz-date:${amzDate}\n`;
    const signedHeaders = 'content-type;host;x-amz-content-sha256;x-amz-date';

    const canonicalRequest = `${method}\n${canonicalUri}\n${canonicalQuery}\n${canonicalHeaders}\n${signedHeaders}\n${payloadHash}`;

    const algorithm = 'AWS4-HMAC-SHA256';
    const credentialScope = `${dateStamp}/${reg}/s3/aws4_request`;
    const stringToSign = `${algorithm}\n${amzDate}\n${credentialScope}\n${sha256(canonicalRequest)}`;

    const signingKey = getSignatureKey(secretKey, dateStamp, reg, 's3');
    const signature = hmac(signingKey, stringToSign, 'hex');

    const authHeader = `${algorithm} Credential=${accessKey}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

    const headers = {
      'Host': host,
      'Content-Type': 'text/plain',
      'Content-Length': body.length,
      'x-amz-content-sha256': payloadHash,
      'x-amz-date': amzDate,
      'Authorization': authHeader,
    };

    const req = https.request({
      hostname: host,
      port: 443,
      path: path,
      method: method,
      headers: headers,
      servername: 'r2.cloudflarestorage.com', // Fix TLS handshake on Windows!
      family: 4,
    }, (res) => {
      let resBody = '';
      res.on('data', (d) => resBody += d);
      res.on('end', () => {
        console.log(`[Region: ${reg}] Status: ${res.statusCode}`);
        if (res.statusCode === 200) {
          console.log(`🎉🎉🎉 SUCCESS WITH REGION [${reg}]! File uploaded to Cloudflare R2!`);
        } else {
          console.log(`Body:`, resBody.substring(0, 200));
        }
        resolve(res.statusCode);
      });
    });

    req.on('error', (err) => {
      console.log(`[Region: ${reg}] Error:`, err.message);
      resolve(500);
    });

    req.write(body);
    req.end();
  });
}

async function run() {
  for (const r of regions) {
    await testUploadWithRegion(r);
  }
}

run();
