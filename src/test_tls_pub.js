const tls = require('tls');

const socket = tls.connect({
  host: 'pub-d550feaadd484541bf0c3af429db5905.r2.dev',
  port: 443,
  servername: 'pub-d550feaadd484541bf0c3af429db5905.r2.dev',
}, () => {
  console.log('✅ TLS Connected to R2 Public Domain! Authorized:', socket.authorized);
  console.log('Cipher:', socket.getCipher());
  console.log('Protocol:', socket.getProtocol());
  socket.end();
});

socket.on('error', (err) => {
  console.error('❌ TLS Error:', err);
});
