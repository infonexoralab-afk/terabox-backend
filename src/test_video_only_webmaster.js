const http = require('http');

const API_HOST = '127.0.0.1';
const API_PORT = 4000;

function post(path, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const jsonStr = JSON.stringify(body || {});
    const req = http.request({
      hostname: API_HOST,
      port: API_PORT,
      path,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(jsonStr),
        ...headers
      },
      timeout: 10000,
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(data) });
        } catch (_) {
          resolve({ status: res.statusCode, data });
        }
      });
    });
    req.on('error', reject);
    req.write(jsonStr);
    req.end();
  });
}

function get(path, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: API_HOST,
      port: API_PORT,
      path,
      method: 'GET',
      headers: { ...headers },
      timeout: 10000,
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(data) });
        } catch (_) {
          resolve({ status: res.statusCode, data });
        }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

async function runTests() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('🎬 TESTING VIDEO-ONLY WEBMASTER PROGRAM RESTRICTIONS');
  console.log('═══════════════════════════════════════════════════════════════\n');

  const testUserId = 'test_user_vid_only_' + Date.now();

  // 1. Enroll User in Webmaster
  console.log('--- Step 1: Enroll in Webmaster ---');
  const enrollRes = await post('/api/webmaster/enroll', { userId: testUserId, plan: 'videoPlays' });
  const refCode = enrollRes.data.profile ? enrollRes.data.profile.referralCode : enrollRes.data.referralCode;
  console.log(`Enrolled successfully with Referral Code: ${refCode}`);

  // 2. Upload/Share a PDF document (Non-video)
  console.log('\n--- Step 2: Share Non-Video File (Document.pdf) ---');
  const pdfShareRes = await post('/api/share/create', {
    code: 'PDF_' + Date.now().toString(36),
    id: 'node_pdf_' + Date.now(),
    name: 'Important_Report.pdf',
    extension: 'pdf',
    isVideo: false,
    sizeBytes: 204800,
    userId: testUserId,
    creatorUserId: testUserId,
    referralCode: refCode,
  });
  console.log('PDF Share created:', pdfShareRes.data.share.code);

  // 3. Upload/Share a ZIP archive (Non-video)
  console.log('\n--- Step 3: Share Non-Video File (Project.zip) ---');
  const zipShareRes = await post('/api/share/create', {
    code: 'ZIP_' + Date.now().toString(36),
    id: 'node_zip_' + Date.now(),
    name: 'SourceCode.zip',
    extension: 'zip',
    isVideo: false,
    sizeBytes: 5242880,
    userId: testUserId,
    creatorUserId: testUserId,
    referralCode: refCode,
  });
  console.log('ZIP Share created:', zipShareRes.data.share.code);

  // 4. Upload/Share an MP4 Video
  console.log('\n--- Step 4: Share Video File (Avengers_Trailer.mp4) ---');
  const mp4ShareRes = await post('/api/share/create', {
    code: 'VID_' + Date.now().toString(36),
    id: 'node_mp4_' + Date.now(),
    name: 'Avengers_Trailer.mp4',
    extension: 'mp4',
    isVideo: true,
    durationSeconds: 180,
    sizeBytes: 25000000,
    userId: testUserId,
    creatorUserId: testUserId,
    referralCode: refCode,
  });
  console.log('MP4 Video Share created:', mp4ShareRes.data.share.code);

  // 5. Fetch Webmaster Profile & Verify Links List
  console.log('\n--- Step 5: Verify Webmaster Profile Shared Links ---');
  const profRes = await get(`/api/webmaster/profile?userId=${testUserId}`);
  const profile = profRes.data.profile || profRes.data;
  const links = profile.sharedLinks || [];
  console.log(`Total Webmaster links found: ${links.length}`);
  console.log('Links in Webmaster Dashboard:', links.map(l => ({ code: l.shortCode, file: l.fileName })));

  if (links.length === 1 && links[0].shortCode === mp4ShareRes.data.share.code) {
    console.log('✅ PASS: Exactly 1 link present (Only the .mp4 video was added; .pdf & .zip were completely excluded!)');
  } else {
    console.error('❌ FAIL: Expected only 1 video link, but found:', links);
    process.exit(1);
  }

  // 6. Attempt Watch-time verification on PDF -> Expect 400 Bad Request
  console.log('\n--- Step 6: Verify Watch-Time Check Rejects Non-Video Files ---');
  const watchPdfRes = await post('/api/webmaster/verify-watch', {
    code: pdfShareRes.data.share.code,
    watchSeconds: 60,
    videoDuration: 120,
    nonce: 'dummy_nonce',
    clientToken: 'dummy_token',
    fingerprint: 'fp_test',
  });
  console.log('Watch verification response on PDF:', watchPdfRes.status, watchPdfRes.data);

  if (watchPdfRes.status === 400 && watchPdfRes.data.error.includes('Only video files')) {
    console.log('✅ PASS: Server properly rejected watch verification on non-video file!');
  } else {
    console.error('❌ FAIL: Server did not reject watch verification on non-video file!');
    process.exit(1);
  }

  console.log('\n🎉 ALL VIDEO-ONLY WEBMASTER RESTRICTION TESTS PASSED WITH 100% ACCURACY!');
}

runTests().catch(console.error);
