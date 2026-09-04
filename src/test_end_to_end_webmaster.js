const http = require('http');

const API_HOST = '127.0.0.1';
const API_PORT = 4000;

function request(method, path, body = null, headers = {}) {
  return new Promise((resolve, reject) => {
    const jsonStr = body ? JSON.stringify(body) : null;
    const req = http.request({
      hostname: API_HOST,
      port: API_PORT,
      path,
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(jsonStr ? { 'Content-Length': Buffer.byteLength(jsonStr) } : {}),
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
    if (jsonStr) req.write(jsonStr);
    req.end();
  });
}

async function testFullWebmasterLifecycle() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('🧪 TESTING FULL WEBMASTER TRACKING & CPM EARNINGS LIFECYCLE');
  console.log('═══════════════════════════════════════════════════════════════\n');

  const testUserId = `usr_test_creator_${Date.now()}`;
  
  // Step 1: User A Enrolls in Webmaster
  console.log('1️⃣ Enrolling User A into Webmaster Program...');
  const enrollRes = await request('POST', '/api/webmaster/enroll', { userId: testUserId });
  console.log('Enroll status:', enrollRes.status, 'RefCode:', enrollRes.data.profile?.referralCode);
  const refCode = enrollRes.data.profile.referralCode;

  // Step 2: User A Creates a Video Share Link
  console.log('\n2️⃣ User A uploads video & generates Share Link...');
  const shortCode = `TBX_${Date.now().toString(36).toUpperCase()}`;
  const shareRes = await request('POST', '/api/share/create', {
    code: shortCode,
    name: 'Sample_Action_Movie.mp4',
    sizeBytes: 1024 * 1024 * 50,
    extension: 'mp4',
    isVideo: true,
    durationSeconds: 120,
    creatorUserId: testUserId,
    userId: testUserId,
    referralCode: refCode,
    downloadUrl: 'https://pub-d550feaadd484541bf0c3af429db5905.r2.dev/uploads/test.mp4'
  });
  console.log('Share status:', shareRes.status, 'Share Code:', shortCode);

  // Step 3: User B clicks the link (Web Preview Landing)
  console.log('\n3️⃣ User B opens the link (triggers session-nonce & link click)...');
  const nonceRes = await request('POST', `/api/webmaster/session-nonce/${shortCode}`, {
    fingerprint: `fp_user_b_${Date.now()}`
  }, {
    'cf-ipcountry': 'US',
    'x-forwarded-for': '72.229.28.185' // Real US IP
  });
  console.log('Nonce Response:', nonceRes.data);
  const nonce = nonceRes.data.nonce;
  const clientToken = nonceRes.data.clientToken;
  const requiredWatch = nonceRes.data.requiredWatchSeconds;

  // Step 4: User B watches the video (verify-watch)
  console.log('\n4️⃣ User B watches video & completes required watch-time...');
  const watchRes = await request('POST', '/api/webmaster/verify-watch', {
    code: shortCode,
    nonce: nonce,
    watchSeconds: requiredWatch,
    videoDuration: 120,
    clientToken: clientToken,
    fingerprint: `fp_user_b_${Date.now()}`
  }, {
    'cf-ipcountry': 'US',
    'x-forwarded-for': '72.229.28.185'
  });
  console.log('Watch Verification Response:', watchRes.data);

  // Step 5: User A views their Webmaster Dashboard
  console.log('\n5️⃣ Fetching User A Webmaster Dashboard Profile...');
  const profRes = await request('GET', `/api/webmaster/profile?userId=${testUserId}`);
  console.log('Dashboard Data:');
  console.log('- Referral Code:', profRes.data.profile.referralCode);
  console.log('- Wallet Balance ($):', profRes.data.profile.walletBalanceUsd);
  console.log('- Today Stats:', profRes.data.profile.stats[0]);
  console.log('- Shared Video Links:', profRes.data.profile.sharedLinks);
  console.log('- Earning Records:', profRes.data.profile.earningRecords);

  if (
    profRes.data.profile.walletBalanceUsd > 0 &&
    profRes.data.profile.stats[0]?.clicks >= 1 &&
    profRes.data.profile.stats[0]?.videoPlays >= 1
  ) {
    console.log('\n🎉 SUCCESS: All Webmaster clicks, video plays, and CPM earnings are 100% working!');
  } else {
    console.error('\n❌ FAILURE: Some tracking metrics were not updated.');
  }
}

testFullWebmasterLifecycle().catch(console.error);
