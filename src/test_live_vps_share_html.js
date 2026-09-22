const https = require('https');
const assert = require('assert');

console.log('Fetching live domain share page (https://airbox.one/s/TBX_MTN10I6D)...');

const req = https.get('https://airbox.one/s/TBX_MTN10I6D', { rejectUnauthorized: false }, (res) => {
  let data = '';
  res.on('data', (chunk) => data += chunk);
  res.on('end', () => {
    console.log('HTTP Status:', res.statusCode);
    
    // Verify Copyright Policy Modal
    assert(data.includes('id="policyModalOverlay"'), 'policyModalOverlay ID must be in live HTML');
    assert(data.includes('Copyright &amp; Grievance Policy') || data.includes('Copyright & Grievance Policy'), 'Policy title must be in live HTML');
    assert(data.includes('openPolicyModal()'), 'openPolicyModal must be in live HTML');
    assert(data.includes('closePolicyModal()'), 'closePolicyModal must be in live HTML');
    assert(data.includes('info.airboxcloud@gmail.com'), 'Grievance email must be in live HTML');

    // Verify DMCA Notice Form & Responsiveness
    assert(data.includes('id="reportModalOverlay"'), 'reportModalOverlay ID must be in live HTML');
    assert(data.includes('id="dmcaNoticeForm"'), 'dmcaNoticeForm ID must be in live HTML');
    assert(data.includes('id="web_legalName"'), 'web_legalName input must be in live HTML');
    assert(data.includes('id="web_relationship"'), 'web_relationship select must be in live HTML');
    assert(data.includes('id="web_email"'), 'web_email must be in live HTML');
    assert(data.includes('id="web_phone"'), 'web_phone must be in live HTML');
    assert(data.includes('id="web_workTitle"'), 'web_workTitle must be in live HTML');
    assert(data.includes('id="web_proofUrl"'), 'web_proofUrl must be in live HTML');
    assert(data.includes('form-row-2'), 'form-row-2 must be in live HTML');
    assert(data.includes('@media (max-width: 600px)'), 'Responsive media queries must be in live HTML');

    console.log('🌟 LIVE DOMAIN HTML MODALS & RESPONSIVE FORMS VERIFIED 100% SUCCEEDED!');
    process.exit(0);
  });
});

req.on('error', (err) => {
  console.error('Request error:', err.message);
  process.exit(1);
});
