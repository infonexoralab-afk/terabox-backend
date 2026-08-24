const dns = require('dns');

const hostnames = [
  '86428b02ac7526b0a2c7841f2b4e8fe7.r2.cloudflarestorage.com',
  '86428b02ac7526b0a2c7841f2b4e8fe7e.r2.cloudflarestorage.com',
  '86128b02ac7526b0a2c7841f2b4e8fe7.r2.cloudflarestorage.com',
];

hostnames.forEach(h => {
  dns.lookup(h, (err, address, family) => {
    if (err) {
      console.log(`❌ DNS Failed for [${h}]:`, err.code);
    } else {
      console.log(`✅ DNS Success for [${h}]:`, address);
    }
  });
});
