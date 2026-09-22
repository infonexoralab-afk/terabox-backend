const shareService = require('./services/shareService');
const assert = require('assert');

console.log('Testing shareService.renderWebPreviewHtml...');

const mockShare = {
  code: 'test_dmca_share_123',
  fileName: 'test_blockbuster_video.mp4',
  sizeBytes: 1024 * 1024 * 50,
  isVideo: true,
  extension: 'mp4',
  creatorName: 'ContentCreator@gmail.com',
  createdAt: new Date().toISOString()
};

const html = shareService.renderWebPreviewHtml(mockShare);

// Verify Copyright Policy Modal
assert(html.includes('id="policyModalOverlay"'), 'policyModalOverlay ID must be present');
assert(html.includes('Copyright &amp; Grievance Policy') || html.includes('Copyright & Grievance Policy'), 'Policy title must be present');
assert(html.includes('openPolicyModal()'), 'openPolicyModal function must be present');
assert(html.includes('closePolicyModal()'), 'closePolicyModal function must be present');
assert(html.includes('info.airboxcloud@gmail.com'), 'Grievance email must be present');

// Verify DMCA Notice Form & Responsiveness
assert(html.includes('id="reportModalOverlay"'), 'reportModalOverlay ID must be present');
assert(html.includes('id="dmcaNoticeForm"'), 'dmcaNoticeForm ID must be present');
assert(html.includes('id="web_legalName"'), 'web_legalName input must be present');
assert(html.includes('id="web_relationship"'), 'web_relationship dropdown must be present');
assert(html.includes('id="web_email"'), 'web_email input must be present');
assert(html.includes('id="web_phone"'), 'web_phone input must be present');
assert(html.includes('id="web_workTitle"'), 'web_workTitle input must be present');
assert(html.includes('id="web_proofUrl"'), 'web_proofUrl input must be present');
assert(html.includes('id="web_declGoodFaith"'), 'web_declGoodFaith must be present');
assert(html.includes('id="web_declPerjury"'), 'web_declPerjury must be present');
assert(html.includes('id="web_declLiability"'), 'web_declLiability must be present');
assert(html.includes('id="web_signature"'), 'web_signature must be present');
assert(html.includes('form-row-2'), 'form-row-2 class must be present');
assert(html.includes('@media (max-width: 600px)'), 'Responsive media query must be present');

console.log('✅ ALL HTML, POLICY MODAL, AND RESPONSIVE FORM ASSERTIONS PASSED PERFECTLY!');
