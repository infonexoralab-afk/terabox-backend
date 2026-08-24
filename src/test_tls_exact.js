const tls = require('tls');

const candidate = '86428b02ac7526b0a2c7841f2b4e8fe7e';
const host = `${candidate}.r2.cloudflarestorage.com`;

console.log(`Connecting TLS to ${host}...`);
const socket = tls.connect({
  host: '172.64.190.1',
  port: 443,
  servername: host,
}, () => {
  console.log(`🎉🎉 TLS CONNECTED! Account ID [${candidate}] is VALID! Cipher:`, socket.getCipher().name);
  socket.end();
});

socket.on('error', (err) => {
  console.log(`❌ TLS Failed:`, err.message);
});
