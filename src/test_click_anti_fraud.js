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

async function testClickAntiFraud() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('🛡️ TESTING TERA BOX CLICK ANTI-FRAUD & RELOAD DEDUPLICATION');
  console.log('═══════════════════════════════════════════════════════════════\n');

  const shareCode = 'TBX_MTJHOZKM'; // Real share on VPS

  // Step 0: Get initial clicks count
  const profBefore = await get('/api/webmaster/profile?userId=acquireway@gmail.com');
  const initialClicks = (profBefore.data.profile.stats && profBefore.data.profile.stats[0]) ? profBefore.data.profile.stats[0].clicks : 0;
  console.log(`Initial Clicks Count: ${initialClicks}\n`);

  // Test 1: First-time Unique Visitor (New IP & New Fingerprint) -> MUST COUNT +1
  console.log('--- TEST 1: First-time Real Visitor (New IP: 103.45.12.1) ---');
  const res1 = await post(`/api/webmaster/session-nonce/${shareCode}`, {
    fingerprint: 'fp_user_alpha_103_45_12_1',
    isRepeatSession: false
  }, {
    'cf-ipcountry': 'IN',
    'x-forwarded-for': '103.45.12.1'
  });

  console.log('Response 1:', res1.data);
  if (res1.data.clickCounted === true) {
    console.log('✅ PASS: Real first-time visitor click counted successfully!\n');
  } else {
    console.log('❌ FAIL: First-time click was not counted!\n');
  }

  // Test 2: Immediate F5 / Reload from same IP within cooldown -> MUST BLOCK (0 clicks added)
  console.log('--- TEST 2: User presses F5 / Refresh (Same IP: 103.45.12.1) ---');
  const res2 = await post(`/api/webmaster/session-nonce/${shareCode}`, {
    fingerprint: 'fp_user_alpha_103_45_12_1',
    isRepeatSession: true
  }, {
    'cf-ipcountry': 'IN',
    'x-forwarded-for': '103.45.12.1'
  });

  console.log('Response 2:', res2.data);
  if (res2.data.clickCounted === false) {
    console.log(`✅ PASS: F5/Reload spam blocked! Reason: "${res2.data.dedupReason}"\n`);
  } else {
    console.log('❌ FAIL: Duplicate reload click was counted!\n');
  }

  // Test 3: Tab Reload without changing IP (F5 reload loop) -> MUST BLOCK (0 clicks added)
  console.log('--- TEST 3: User repeatedly hitting Enter / Reload in Chrome Address Bar ---');
  const res3 = await post(`/api/webmaster/session-nonce/${shareCode}`, {
    fingerprint: 'fp_user_alpha_103_45_12_1',
    isRepeatSession: false // even if sessionStorage was bypassed, IP cooldown catches it
  }, {
    'cf-ipcountry': 'IN',
    'x-forwarded-for': '103.45.12.1'
  });

  console.log('Response 3:', res3.data);
  if (res3.data.clickCounted === false) {
    console.log(`✅ PASS: IP Cooldown caught repeated address bar reload! Reason: "${res3.data.dedupReason}"\n`);
  } else {
    console.log('❌ FAIL: Cooldown failed to block reload!\n');
  }

  // Test 4: Headless Bot / Scraper Attack (Curl / Python Bot) -> MUST BLOCK
  console.log('--- TEST 4: Bot / Scraper Click Attempt (User-Agent: python-requests) ---');
  const res4 = await post(`/api/webmaster/session-nonce/${shareCode}`, {
    fingerprint: 'fp_bot',
    isRepeatSession: false
  }, {
    'user-agent': 'python-requests/2.28.1',
    'cf-ipcountry': 'US',
    'x-forwarded-for': '45.33.32.156'
  });

  console.log('Response 4:', res4.data);
  if (res4.data.clickCounted === false) {
    console.log('✅ PASS: Automated Bot User-Agent click blocked from statistics!\n');
  } else {
    console.log('❌ FAIL: Bot click was counted!\n');
  }

  // Test 5: Another Real User (Different IP & Different Device) -> MUST COUNT +1
  console.log('--- TEST 5: Another Genuine Unique Visitor (New IP: 182.70.15.88) ---');
  const res5 = await post(`/api/webmaster/session-nonce/${shareCode}`, {
    fingerprint: 'fp_user_beta_182_70_15_88',
    isRepeatSession: false
  }, {
    'cf-ipcountry': 'IN',
    'x-forwarded-for': '182.70.15.88'
  });

  console.log('Response 5:', res5.data);
  if (res5.data.clickCounted === true) {
    console.log('✅ PASS: Different unique user click successfully counted!\n');
  } else {
    console.log('❌ FAIL: Legitimate unique click was blocked!\n');
  }

  // Step Final: Verify exactly +2 clicks added across all 5 tests
  const profAfter = await get('/api/webmaster/profile?userId=acquireway@gmail.com');
  const finalClicks = profAfter.data.profile.stats[0].clicks;
  const clicksAdded = finalClicks - initialClicks;
  console.log(`Final Clicks Count: ${finalClicks} (Total Added: ${clicksAdded})`);

  if (clicksAdded === 2) {
    console.log('\n🎉 ALL 5 CLICK ANTI-FRAUD & DEDUPLICATION TESTS PASSED WITH 100% ACCURACY!');
  } else {
    console.log(`\n⚠️ Notice: Expected +2 clicks added, got +${clicksAdded}`);
  }
}

testClickAntiFraud().catch(console.error);
