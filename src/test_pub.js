const https = require('https');

async function testFetch() {
  const pubUrl = 'https://pub-d550feaadd484541bf0c3af429db5905.r2.dev';
  https.get(pubUrl, (res) => {
    console.log('Public R2 Dev URL status code:', res.statusCode);
  }).on('error', (e) => {
    console.log('Public R2 error:', e.message);
  });
}

testFetch();
