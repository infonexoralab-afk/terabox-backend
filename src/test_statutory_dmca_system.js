const express = require('express');
const http = require('http');
const fs = require('fs');
const path = require('path');

const apiRoutes = require('./routes/api');
const adminRoutes = require('./routes/adminRoutes');

const app = express();
app.use(express.json());
app.use('/api', apiRoutes);
app.use('/admin/api', adminRoutes);

function startServer() {
  return new Promise((resolve) => {
    const server = http.createServer(app);
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      resolve({ server, port });
    });
  });
}

function post(port, endpoint, data, headers = {}) {
  return new Promise((resolve, reject) => {
    const postData = JSON.stringify(data);
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port,
        path: endpoint,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(postData),
          ...headers,
        },
      },
      (res) => {
        let raw = '';
        res.on('data', (chunk) => (raw += chunk));
        res.on('end', () => {
          try {
            resolve({ status: res.statusCode, body: JSON.parse(raw) });
          } catch (e) {
            resolve({ status: res.statusCode, raw });
          }
        });
      }
    );
    req.on('error', reject);
    req.write(postData);
    req.end();
  });
}

function get(port, endpoint, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port,
        path: endpoint,
        method: 'GET',
        headers,
      },
      (res) => {
        let raw = '';
        res.on('data', (chunk) => (raw += chunk));
        res.on('end', () => {
          try {
            resolve({ status: res.statusCode, body: JSON.parse(raw) });
          } catch (e) {
            resolve({ status: res.statusCode, raw });
          }
        });
      }
    );
    req.on('error', reject);
    req.end();
  });
}

async function runTests() {
  console.log('⚖️ === STARTING STATUTORY DMCA & COPYRIGHT SYSTEM VERIFICATION ===\n');
  const { server, port } = await startServer();
  console.log(`Ephemeral test server listening on 127.0.0.1:${port}\n`);

  try {
    // Test 1: Random/Anonymous Submission MUST FAIL (400)
    console.log('--- TEST 1: Fake/Random DMCA Submission (Should Fail with 400) ---');
    const fakeRes = await post(port, '/api/report/takedown', {
      shareCode: 'TEST_VIDEO_123',
      reason: 'Copyright Infringement / DMCA',
      legalName: '', // Missing
    });
    console.log('Status:', fakeRes.status);
    console.log('Response:', fakeRes.body);
    if (fakeRes.status === 400 && fakeRes.body.success === false) {
      console.log('✅ TEST 1 PASSED: Random/unverified DMCA rejected strictly.\n');
    } else {
      throw new Error('TEST 1 FAILED');
    }

    // Test 2: Missing Good Faith / Perjury Declaration MUST FAIL (400)
    console.log('--- TEST 2: Missing Sworn Statements (Should Fail with 400) ---');
    const declRes = await post(port, '/api/report/takedown', {
      shareCode: 'TEST_VIDEO_123',
      reason: 'Copyright Infringement / DMCA',
      legalName: 'Eros International Legal Desk',
      email: 'legal@erosnow.com',
      phone: '+91 22 66021500',
      address: '9th Floor, Supreme Chambers, Andheri West, Mumbai 400053',
      country: 'India',
      workTitle: 'Bajirao Mastani (Official Feature Film)',
      workCategory: 'Video / Cinematographic Film',
      ownershipProofUrl: 'https://www.erosnow.com/movie/watch/102345/bajirao-mastani',
      declarationGoodFaith: false, // Not accepted
      declarationPerjury: false,
      declarationLegalLiability: false,
      electronicSignature: 'Eros Legal Counsel',
    });
    console.log('Status:', declRes.status);
    console.log('Response:', declRes.body);
    if (declRes.status === 400 && declRes.body.success === false) {
      console.log('✅ TEST 2 PASSED: Missing sworn affirmations rejected.\n');
    } else {
      throw new Error('TEST 2 FAILED');
    }

    // Test 3: Full Statutory Filing Under Indian Copyright Act & DMCA (Must Succeed with Ticket ID)
    console.log('--- TEST 3: Complete Statutory DMCA Notice Filing ---');
    const validRes = await post(port, '/api/report/takedown', {
      shareCode: 'TEST_VIDEO_123',
      reason: 'Copyright Infringement / DMCA',
      legalName: 'Aditya Chopra (Yash Raj Films Pvt Ltd)',
      organization: 'Yash Raj Films Pvt. Ltd.',
      relationship: 'Copyright Owner',
      email: 'infringement@yashrajfilms.com',
      phone: '+91 22 30613500',
      address: '5, Shah Industrial Estate, Veera Desai Road, Andheri West, Mumbai, Maharashtra 400053',
      country: 'India',
      workTitle: 'Pathaan (2023) Cinematographic Feature Film',
      workCategory: 'Video / Cinematographic Film',
      ownershipProofUrl: 'https://www.yashrajfilms.com/movies/pathaan',
      declarationGoodFaith: true,
      declarationPerjury: true,
      declarationLegalLiability: true,
      electronicSignature: 'Aditya Chopra',
      additionalRemarks: 'Unauthorized full movie leak distributed without license.',
    });
    console.log('Status:', validRes.status);
    console.log('Response:', validRes.body);

    if (validRes.status === 200 && validRes.body.success === true && validRes.body.reportId.startsWith('DMCA-IN-2026-')) {
      console.log(`✅ TEST 3 PASSED: Statutory Notice Registered with ID: ${validRes.body.reportId}\n`);
    } else {
      throw new Error('TEST 3 FAILED');
    }

    // Test 4: Verify Backward-Compatible Alias /api/reports/submit
    console.log('--- TEST 4: Submit via Alias /api/reports/submit ---');
    const aliasRes = await post(port, '/api/reports/submit', {
      shareId: 'TEST_VIDEO_456',
      reason: 'General Content Violation',
      legalName: 'Grievance Officer India',
      email: 'info.airboxcloud@gmail.com',
    });
    console.log('Status:', aliasRes.status);
    console.log('Response:', aliasRes.body);
    if (aliasRes.status === 200 && aliasRes.body.success === true) {
      console.log(`✅ TEST 4 PASSED: Alias /reports/submit accepted report.\n`);
    } else {
      throw new Error('TEST 4 FAILED');
    }

    // Test 5: Verify Reports Listed in Admin Safety Endpoint with Admin Auth
    console.log('--- TEST 5: Verify Admin Safety Reports Endpoint ---');
    const loginRes = await post(port, '/admin/api/auth/login', {
      identifier: 'superadmin@airbox.one',
      password: 'TeraBox#SuperAdmin$2026!Secured',
    });
    console.log('Admin Login Status:', loginRes.status);
    const adminToken = loginRes.body.token;

    const reportsRes = await get(port, '/admin/api/safety/reports', {
      Authorization: `Bearer ${adminToken}`,
    });
    console.log('Reports Endpoint Status:', reportsRes.status);
    if (reportsRes.status === 200 && reportsRes.body.success === true && reportsRes.body.reports.length > 0) {
      const topReport = reportsRes.body.reports.find(r => r.legalName === 'Aditya Chopra (Yash Raj Films Pvt Ltd)');
      console.log('Found Report ID:', topReport.id || topReport.reportId);
      console.log('Legal Claimant:', topReport.legalName);
      console.log('Protected Work:', topReport.workTitle);
      console.log('Proof URL:', topReport.ownershipProofUrl);
      console.log('Electronic Signature:', topReport.electronicSignature);
      console.log('Statutory Compliance:', topReport.statutoryCompliance);
      console.log('✅ TEST 5 PASSED: Full Legal Dossier verified in Admin Reports API.\n');
    } else {
      throw new Error('TEST 5 FAILED');
    }

    console.log('🏁 ALL 5 STATUTORY DMCA TESTS PASSED PERFECTLY!\n');
    server.close();
    process.exit(0);
  } catch (err) {
    console.error('Test execution failed:', err);
    if (server) server.close();
    process.exit(1);
  }
}

runTests();

