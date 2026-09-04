const https = require('https');

const url = 'https://pub-d550feaadd484541bf0c3af429db5905.r2.dev/uploads/1787738275365_Screenshot_2025-07-08_114507.png';

console.log('Sending GET request to:', url);

https.get(url, (res) => {
  console.log('Status Code:', res.statusCode);
  console.log('Headers:', res.headers);
}).on('error', (err) => {
  console.error('Request failed:', err.message);
});
