const http = require('http');

http.get('http://localhost:4000/s/TBX_DEMO_01', (res) => {
  console.log('Status Code:', res.statusCode);
  console.log('Headers:', res.headers['content-type']);
  let data = '';
  res.on('data', (chunk) => data += chunk);
  res.on('end', () => {
    console.log('Received HTML Length:', data.length);
    console.log('Contains TeraBox Title:', data.includes('TeraBox Cloud Storage'));
  });
}).on('error', (err) => {
  console.error('Error testing preview:', err.message);
});
