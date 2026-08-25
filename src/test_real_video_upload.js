const fs = require('fs');
const path = require('path');
const http = require('http');

const API_PORT = 4000;
const API_HOST = 'localhost';
const VIDEO_PATH = "D:\\Downloads\\Hostel Daze.S04.1080p.WEB-DL.5.1.ESub.x264-HDHub4u.Tv\\Hostel Daze.S04E01.1080p.WEB-DL.5.1.ESub.x264-HDHub4u.Tv.mkv";

function sendChunk(uploadId, fileName, chunkIndex, totalChunks, chunkBuffer) {
  return new Promise((resolve, reject) => {
    const boundary = '----TeraBoxFormBoundary' + Math.random().toString(36).substring(2);
    
    // Build multipart header and footer
    let header = `--${boundary}\r\n`;
    header += `Content-Disposition: form-data; name="uploadId"\r\n\r\n${uploadId}\r\n`;
    header += `--${boundary}\r\n`;
    header += `Content-Disposition: form-data; name="fileName"\r\n\r\n${fileName}\r\n`;
    header += `--${boundary}\r\n`;
    header += `Content-Disposition: form-data; name="chunkIndex"\r\n\r\n${chunkIndex}\r\n`;
    header += `--${boundary}\r\n`;
    header += `Content-Disposition: form-data; name="totalChunks"\r\n\r\n${totalChunks}\r\n`;
    header += `--${boundary}\r\n`;
    header += `Content-Disposition: form-data; name="chunk"; filename="part_${chunkIndex}"\r\n`;
    header += `Content-Type: application/octet-stream\r\n\r\n`;

    const footer = `\r\n--${boundary}--\r\n`;

    const headerBuf = Buffer.from(header, 'utf8');
    const footerBuf = Buffer.from(footer, 'utf8');
    const fullLength = headerBuf.length + chunkBuffer.length + footerBuf.length;

    const req = http.request({
      hostname: API_HOST,
      port: API_PORT,
      path: '/api/upload/chunk',
      method: 'POST',
      headers: {
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
        'Content-Length': fullLength,
      },
      timeout: 120000,
    }, (res) => {
      let body = '';
      res.on('data', c => body += c);
      res.on('end', () => {
        try {
          resolve(JSON.parse(body));
        } catch (_) {
          resolve(body);
        }
      });
    });

    req.on('error', reject);
    req.write(headerBuf);
    req.write(chunkBuffer);
    req.write(footerBuf);
    req.end();
  });
}

function postJson(urlPath, data) {
  return new Promise((resolve, reject) => {
    const jsonStr = JSON.stringify(data);
    const req = http.request({
      hostname: API_HOST,
      port: API_PORT,
      path: urlPath,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(jsonStr),
      },
      timeout: 600000,
    }, (res) => {
      let body = '';
      res.on('data', c => body += c);
      res.on('end', () => {
        try {
          resolve(JSON.parse(body));
        } catch (_) {
          resolve(body);
        }
      });
    });

    req.on('error', reject);
    req.write(jsonStr);
    req.end();
  });
}

async function runRealUpload() {
  console.log('=== REAL 400MB VIDEO UPLOAD TEST TO CLOUDFLARE R2 ===\n');

  if (!fs.existsSync(VIDEO_PATH)) {
    console.error('File not found at:', VIDEO_PATH);
    return;
  }

  const stat = fs.statSync(VIDEO_PATH);
  const fileSize = stat.size;
  const fileName = path.basename(VIDEO_PATH);
  const chunkSize = 4 * 1024 * 1024; // 4 MB slices
  const totalChunks = Math.ceil(fileSize / chunkSize);
  const uploadId = `upl_${Date.now()}`;

  console.log(`Video File: ${fileName}`);
  console.log(`Size: ${(fileSize / 1024 / 1024).toFixed(2)} MB (${fileSize} bytes)`);
  console.log(`Total Chunks: ${totalChunks} slices (4MB each)`);
  console.log(`Upload ID: ${uploadId}\n`);

  console.log('Streaming chunks to backend...');
  const startTime = Date.now();

  const fd = fs.openSync(VIDEO_PATH, 'r');

  for (let i = 0; i < totalChunks; i++) {
    const startByte = i * chunkSize;
    const endByte = Math.min(startByte + chunkSize, fileSize);
    const partLen = endByte - startByte;

    const chunkBuf = Buffer.alloc(partLen);
    fs.readSync(fd, chunkBuf, 0, partLen, startByte);

    const res = await sendChunk(uploadId, fileName, i, totalChunks, chunkBuf);
    if (!res.success) {
      console.error(`\n❌ Chunk ${i} failed:`, res);
      fs.closeSync(fd);
      return;
    }

    const percent = (((i + 1) / totalChunks) * 100).toFixed(1);
    process.stdout.write(`  [${percent}%] Chunk ${i + 1}/${totalChunks} uploaded\r`);
  }

  fs.closeSync(fd);
  const uploadElapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\n\n✅ All ${totalChunks} chunks uploaded in ${uploadElapsed}s (${(fileSize / 1024 / 1024 / uploadElapsed).toFixed(2)} MB/s)\n`);

  console.log('Assembling and streaming to Cloudflare R2 via S3 Multipart Upload...');
  const completeStart = Date.now();

  const completeRes = await postJson('/api/upload/complete', {
    uploadId,
    fileName,
    totalChunks,
    sizeBytes: fileSize,
    mimeType: 'video/x-matroska',
  });

  const r2Elapsed = ((Date.now() - completeStart) / 1000).toFixed(1);
  console.log(`\nAssemble & R2 upload finished in ${r2Elapsed}s`);
  console.log('Complete Response:', JSON.stringify(completeRes, null, 2));

  if (!completeRes.success || !completeRes.file) {
    console.error('❌ Upload Complete failed!');
    return;
  }

  const downloadUrl = completeRes.file.downloadUrl;
  console.log(`\n======================================================`);
  console.log(`🎉 SUCCESS! 400MB VIDEO COMMITTED TO CLOUDFLARE R2!`);
  console.log(`Key: ${completeRes.file.r2Key}`);
  console.log(`R2 Live URL: ${downloadUrl}`);
  console.log(`======================================================\n`);

  // Create viral share link
  console.log('Creating viral share link...');
  const shareRes = await postJson('/api/share/create', {
    code: `HOSTEL_${Date.now().toString(36).toUpperCase()}`,
    name: fileName,
    sizeBytes: fileSize,
    extension: 'mkv',
    isVideo: true,
    downloadUrl: downloadUrl,
  });

  console.log('Share Link:', JSON.stringify(shareRes, null, 2));
}

runRealUpload().catch(console.error);
