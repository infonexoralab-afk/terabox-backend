const https = require('https');

async function testChunkUpload() {
  const uploadId = 'test_chunk_upl_' + Date.now();
  const chunk1 = Buffer.from('TeraBox Chunk Part 1: Hello World ');
  const chunk2 = Buffer.from('TeraBox Chunk Part 2: Testing Resumable Upload ');
  const chunk3 = Buffer.from('TeraBox Chunk Part 3: Final Part into Cloudflare R2!');

  const chunks = [chunk1, chunk2, chunk3];
  console.log('Testing Resumable Chunk Upload with 3 parts on Render...');

  for (let i = 0; i < chunks.length; i++) {
    const boundary = '----WebKitFormBoundary' + Math.random().toString(36).substring(2);
    let body = '';
    body += `--${boundary}\r\n`;
    body += `Content-Disposition: form-data; name="uploadId"\r\n\r\n${uploadId}\r\n`;
    body += `--${boundary}\r\n`;
    body += `Content-Disposition: form-data; name="fileName"\r\n\r\nResumableTestFile.txt\r\n`;
    body += `--${boundary}\r\n`;
    body += `Content-Disposition: form-data; name="chunkIndex"\r\n\r\n${i}\r\n`;
    body += `--${boundary}\r\n`;
    body += `Content-Disposition: form-data; name="totalChunks"\r\n\r\n3\r\n`;
    body += `--${boundary}\r\n`;
    body += `Content-Disposition: form-data; name="chunk"; filename="part_${i}"\r\n`;
    body += `Content-Type: application/octet-stream\r\n\r\n`;

    const headerBuffer = Buffer.from(body, 'utf-8');
    const footerBuffer = Buffer.from(`\r\n--${boundary}--\r\n`, 'utf-8');
    const payload = Buffer.concat([headerBuffer, chunks[i], footerBuffer]);

    const res = await new Promise(resolve => {
      const req = https.request({
        hostname: 'terabox-cloud-api.onrender.com',
        path: '/api/upload/chunk',
        method: 'POST',
        headers: {
          'Content-Type': 'multipart/form-data; boundary=' + boundary,
          'Content-Length': payload.length
        }
      }, r => {
        let d = '';
        r.on('data', c => d += c);
        r.on('end', () => resolve({ status: r.statusCode, data: d }));
      });
      req.write(payload);
      req.end();
    });

    console.log(`Uploaded Chunk ${i + 1}/3 -> HTTP ${res.status}: ${res.data}`);
  }

  // Now call /upload/complete
  const completePayload = JSON.stringify({
    uploadId: uploadId,
    fileName: 'ResumableTestFile.txt',
    totalChunks: 3,
    sizeBytes: chunk1.length + chunk2.length + chunk3.length,
    mimeType: 'text/plain'
  });

  const completeRes = await new Promise(resolve => {
    const req = https.request({
      hostname: 'terabox-cloud-api.onrender.com',
      path: '/api/upload/complete',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(completePayload)
      }
    }, r => {
      let d = '';
      r.on('data', c => d += c);
      r.on('end', () => resolve({ status: r.statusCode, data: d }));
    });
    req.write(completePayload);
    req.end();
  });

  console.log('\n=== COMPLETE UPLOAD RESULT ===');
  console.log('HTTP Status:', completeRes.status);
  console.log('Response:', completeRes.data);
}

testChunkUpload();
