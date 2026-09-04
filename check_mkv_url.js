const https = require('https');

const url = 'https://pub-d550feaadd484541bf0c3af429db5905.r2.dev/uploads/1787754337546_I.Nobody.2026.480p.DS4K.WEB-DL.Hindi-Malayalam.ESub.x264-HDHub4u.Ms.mkv';

console.log('Sending GET request to:', url);

https.get(url, (res) => {
  console.log('Status Code:', res.statusCode);
  console.log('Headers:', res.headers);
  // abort reading stream to avoid full file download
  res.destroy();
}).on('error', (err) => {
  console.error('Request failed:', err.message);
});
