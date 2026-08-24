const env = require('./config/env');

async function testRestApi() {
  const token = env.r2.accessKeyId;
  const url = `https://api.cloudflare.com/client/v4/accounts/${env.r2.accountId}/r2/buckets/${env.r2.bucketName}/objects/test.txt`;
  try {
    const res = await fetch(url, {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'text/plain',
      },
      body: 'test',
    });
    console.log('Status:', res.status);
    console.log('Body:', await res.text());
  } catch (e) {
    console.error('Fetch Error:', e.cause || e);
  }
}

testRestApi();
