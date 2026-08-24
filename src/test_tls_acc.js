const tls = require('tls');

const accountIds = [
  '86128b02ac7526b0a2c7841f2b4e8fe7',
  '86428b02ac7526b0a2c7841f2b4e8fe7',
];

accountIds.forEach(acc => {
  const host = `${acc}.r2.cloudflarestorage.com`;
  console.log(`Connecting TLS to ${host}...`);
  const socket = tls.connect({
    host: '172.64.190.1', // Cloudflare IPv4
    port: 443,
    servername: host,
  }, () => {
    console.log(`✅ TLS Connected to [${host}]! Cipher:`, socket.getCipher().name);
    socket.end();
  });

  socket.on('error', (err) => {
    console.log(`❌ TLS Failed for [${host}]:`, err.message);
  });
});
