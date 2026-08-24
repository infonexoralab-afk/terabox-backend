const tls = require('tls');

const socket = tls.connect({
  host: '86128b02ac7526b0a2c7841f2b4e8fe7.r2.cloudflarestorage.com',
  port: 443,
  servername: '86128b02ac7526b0a2c7841f2b4e8fe7.r2.cloudflarestorage.com',
  minVersion: 'TLSv1.2',
  maxVersion: 'TLSv1.3',
  rejectUnauthorized: true,
}, () => {
  console.log('✅ TLS Connected! Authorized:', socket.authorized);
  console.log('Cipher:', socket.getCipher());
  console.log('Protocol:', socket.getProtocol());
  socket.end();
});

socket.on('error', (err) => {
  console.error('❌ TLS Error:', err);
});
