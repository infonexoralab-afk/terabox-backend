const https = require('https');

const options = {
  hostname: '86128b02ac7526b0a2c7841f2b4e8fe7.r2.cloudflarestorage.com',
  port: 443,
  path: '/terabox-cloud-storage',
  method: 'GET',
  headers: {
    'Host': '86128b02ac7526b0a2c7841f2b4e8fe7.r2.cloudflarestorage.com',
  },
  servername: '86128b02ac7526b0a2c7841f2b4e8fe7.r2.cloudflarestorage.com',
};

const req = https.request(options, (res) => {
  console.log('Status Code:', res.statusCode);
  console.log('Headers:', res.headers);
  res.on('data', (d) => process.stdout.write(d));
});

req.on('error', (e) => {
  console.error('HTTPS Error:', e);
});

req.end();
