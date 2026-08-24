const https = require('https');

// Test TCP TLS handshake on Cloudflare R2 endpoint
function checkTls(host) {
  return new Promise((resolve) => {
    const req = https.request({
      host: host,
      port: 443,
      method: 'HEAD',
      path: '/terabox-cloud-storage',
      timeout: 3000,
    }, (res) => {
      resolve({ host, status: res.statusCode, ok: true });
    });
    req.on('error', (err) => {
      resolve({ host, error: err.message, ok: false });
    });
    req.on('timeout', () => {
      req.destroy();
      resolve({ host, error: 'TIMEOUT', ok: false });
    });
    req.end();
  });
}

async function findWorkingHost() {
  const base = '86428b02ac7526b0a2c7841f2b4e8fe7';
  const candidates = [
    `${base}.r2.cloudflarestorage.com`,
    `86428b02ac7526b0a2c7841f2b4e8fe7e.r2.cloudflarestorage.com`,
    `86128b02ac7526b0a2c7841f2b4e8fe7.r2.cloudflarestorage.com`,
    `86128b02ac7526b0a2c7841f2b4e8fe7e.r2.cloudflarestorage.com`,
  ];

  // Try appending all hex characters 0-f
  for (const c of '0123456789abcdef') {
    candidates.push(`86128b02ac7526b0a2c7841f2b4e8fe7${c}.r2.cloudflarestorage.com`);
    candidates.push(`86428b02ac7526b0a2c7841f2b4e8fe7${c}.r2.cloudflarestorage.com`);
  }

  console.log(`Checking ${candidates.length} candidate endpoints...`);
  for (const host of candidates) {
    const res = await checkTls(host);
    if (res.ok) {
      console.log(`\n🎉 FOUND WORKING CLOUDFLARE R2 ENDPOINT: ${host} (HTTP ${res.status})`);
      return host;
    }
  }
  console.log('Finished testing.');
}

findWorkingHost();
