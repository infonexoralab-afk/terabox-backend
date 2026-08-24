const crypto = require('crypto');
const https = require('https');

const accountId = '86128b02ac7526b0a2c7841f2b4e8fe7';
const accessKey = '492e4a8dd5133f89c1ce199e8c29f6f9';
const secretKey = '80bdb65f91237cc67e68987bfbcc73d36410c991010504480e741a5d4ede2fb6';
const bucketName = 'terabox-cloud-storage';
const region = 'auto';

// AWS Signature V4 calculation
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

async function uploadToR2(fileName, content, mimeType = 'text/plain') {
  return new Promise((resolve, reject) => {
    const host = `${accountId}.r2.cloudflarestorage.com`;
    const path = `/${bucketName}/${encodeURIComponent(fileName)}`;
    const method = 'PUT';
    const body = Buffer.from(content);
    const payloadHash = sha256(body);

    const now = new Date();
    const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
    const dateStamp = amzDate.substring(0, 8);

    const canonicalUri = path;
    const canonicalQuery = '';
    const canonicalHeaders = `content-type:${mimeType}\nhost:${host}\nx-amz-content-sha256:${payloadHash}\nx-amz-date:${amzDate}\n`;
    const signedHeaders = 'content-type;host;x-amz-content-sha256;x-amz-date';

    const canonicalRequest = `${method}\n${canonicalUri}\n${canonicalQuery}\n${canonicalHeaders}\n${signedHeaders}\n${payloadHash}`;

    const algorithm = 'AWS4-HMAC-SHA256';
    const credentialScope = `${dateStamp}/${region}/s3/aws4_request`;
    const stringToSign = `${algorithm}\n${amzDate}\n${credentialScope}\n${sha256(canonicalRequest)}`;

    const signingKey = getSignatureKey(secretKey, dateStamp, region, 's3');
    const signature = hmac(signingKey, stringToSign, 'hex');

    const authHeader = `${algorithm} Credential=${accessKey}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

    const headers = {
      'Host': host,
      'Content-Type': mimeType,
      'Content-Length': body.length,
      'x-amz-content-sha256': payloadHash,
      'x-amz-date': amzDate,
      'Authorization': authHeader,
    };

    console.log('Sending direct AWS Signature V4 request to Cloudflare R2...');
    console.log('URL:', `https://${host}${path}`);
    console.log('Headers:', headers);

    const req = https.request({
      hostname: host,
      port: 443,
      path: path,
      method: method,
      headers: headers,
      family: 4,
    }, (res) => {
      let resBody = '';
      res.on('data', (d) => resBody += d);
      res.on('end', () => {
        console.log(`\nResponse Status: ${res.statusCode} ${res.statusMessage}`);
        console.log('Response Headers:', res.headers);
        console.log('Response Body:', resBody);
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve({ status: res.statusCode, body: resBody });
        } else {
          reject(new Error(`HTTP ${res.statusCode}: ${resBody}`));
        }
      });
    });

    req.on('error', (err) => {
      console.error('Request Error:', err);
      reject(err);
    });

    req.write(body);
    req.end();
  });
}

uploadToR2('test_terabox_direct.txt', 'This is a test file uploaded directly from TeraBox client to Cloudflare R2!')
  .then(() => console.log('🎉 DIRECT UPLOAD TO CLOUDFLARE R2 SUCCEEDED!'))
  .catch((err) => console.log('❌ Direct Upload Failed:', err.message));
