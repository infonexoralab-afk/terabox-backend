const tls = require('tls');

async function testSni(servername) {
  return new Promise((resolve) => {
    const socket = tls.connect({
      host: '86128b02ac7526b0a2c7841f2b4e8fe7.r2.cloudflarestorage.com',
      port: 443,
      servername: servername,
    }, () => {
      console.log(`✅ Success for SNI [${servername}]:`, socket.getProtocol());
      socket.end();
      resolve(true);
    });

    socket.on('error', (err) => {
      console.log(`❌ Failed for SNI [${servername}]:`, err.message);
      resolve(false);
    });
  });
}

async function run() {
  await testSni('86128b02ac7526b0a2c7841f2b4e8fe7.r2.cloudflarestorage.com');
  await testSni('r2.cloudflarestorage.com');
  await testSni('terabox-cloud-storage.86128b02ac7526b0a2c7841f2b4e8fe7.r2.cloudflarestorage.com');
  await testSni('cloudflarestorage.com');
}

run();
