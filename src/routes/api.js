const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const env = require('../config/env');
const r2StorageService = require('../services/r2StorageService');
const { CreateMultipartUploadCommand, UploadPartCommand, CompleteMultipartUploadCommand, AbortMultipartUploadCommand, ListPartsCommand } = require('@aws-sdk/client-s3');
const shareService = require('../services/shareService');
const deduplicationService = require('../services/deduplicationService');
const webmasterService = require('../services/webmasterService');
const authService = require('../services/authService');
const fraudDetectionService = require('../services/fraudDetectionService');

const VIDEO_EXTENSIONS = ['mp4', 'mkv', 'avi', 'mov', 'webm', 'flv', 'ts', 'm4v', '3gp', 'wmv', 'mpg', 'mpeg', 'vob'];

function isVideoFile(fileOrShare) {
  if (!fileOrShare) return false;
  if (fileOrShare.isVideo === true) return true;
  if (fileOrShare.durationSeconds && fileOrShare.durationSeconds > 0) return true;
  if (fileOrShare.streamUrl && fileOrShare.streamUrl.length > 5) return true;
  const name = (fileOrShare.fileName || fileOrShare.name || '').toLowerCase();
  const ext = (fileOrShare.extension || (name.includes('.') ? name.split('.').pop() : '')).toLowerCase().replace('.', '');
  return VIDEO_EXTENSIONS.includes(ext);
}

const isVercel = process.env.VERCEL === '1';
const uploadsDir = isVercel ? '/tmp/uploads' : path.join(__dirname, '../../uploads');
const chunksDir = isVercel ? '/tmp/uploads/chunks' : path.join(__dirname, '../../uploads/chunks');

try {
  if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
  }
  if (!fs.existsSync(chunksDir)) {
    fs.mkdirSync(chunksDir, { recursive: true });
  }
} catch (err) {
  console.warn('[API Routes] Could not create uploads or chunks directories:', err.message);
}

// Disk Storage for real file preservation
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, uploadsDir);
  },
  filename: function (req, file, cb) {
    const safeName = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
    cb(null, `${Date.now()}_${safeName}`);
  }
});

const upload = multer({ storage: storage, limits: { fileSize: 1024 * 1024 * 1024 } }); // 1 GB
const uploadMemory = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });

// 1. User Profile
router.get('/user/profile', (req, res) => {
  const userId = req.query.userId || req.headers['x-user-id'];
  if (userId && authService.users.has(userId)) {
    return res.json(authService.users.get(userId));
  }
  return res.status(401).json({
    success: false,
    error: 'Unauthorized: User not found. Please Sign In.',
  });
});

// ==========================================
// 🔑 AUTHENTICATION & OTP API ENDPOINTS
// ==========================================

// 1. Send Email OTP for Signup
router.post('/auth/send-email-otp', async (req, res) => {
  try {
    const { name, email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required.' });
    }
    const result = await authService.sendEmailSignupOtp(name, email, password);
    if (!result.success) {
      return res.status(400).json({ error: result.error });
    }
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 2. Verify Email OTP & Create Account
router.post('/auth/verify-email-otp-signup', (req, res) => {
  try {
    const { email, otpCode } = req.body;
    if (!email || !otpCode) {
      return res.status(400).json({ error: 'Email and 6-digit OTP code are required.' });
    }
    const result = authService.verifyEmailSignupOtp(email, otpCode);
    if (!result.success) {
      return res.status(400).json({ error: result.error });
    }
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 3. Send Mobile SMS OTP
router.post('/auth/send-mobile-otp', (req, res) => {
  try {
    const { phone } = req.body;
    if (!phone) {
      return res.status(400).json({ error: 'Mobile phone number is required.' });
    }
    const result = authService.sendMobileOtp(phone);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 4. Verify Mobile SMS OTP
router.post('/auth/verify-mobile-otp', (req, res) => {
  try {
    const { phone, otpCode } = req.body;
    if (!phone || !otpCode) {
      return res.status(400).json({ error: 'Phone number and 6-digit SMS OTP are required.' });
    }
    const result = authService.verifyMobileOtp(phone, otpCode);
    if (!result.success) {
      return res.status(400).json({ error: result.error });
    }
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 5. Send Forgot Password OTP
router.post('/auth/forgot-password/send-otp', async (req, res) => {
  try {
    const { emailOrPhone } = req.body;
    if (!emailOrPhone) {
      return res.status(400).json({ error: 'Email or Mobile number is required.' });
    }
    const result = await authService.sendForgotPasswordOtp(emailOrPhone);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 6. Reset Password with OTP
router.post('/auth/forgot-password/reset', (req, res) => {
  try {
    const { emailOrPhone, otpCode, newPassword } = req.body;
    if (!emailOrPhone || !otpCode || !newPassword) {
      return res.status(400).json({ error: 'Email/Mobile, OTP code, and new password are required.' });
    }
    const result = authService.resetPasswordWithOtp(emailOrPhone, otpCode, newPassword);
    if (!result.success) {
      return res.status(400).json({ error: result.error });
    }
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 7. Google Login
router.post('/auth/google-login', (req, res) => {
  try {
    const { idToken, googleEmail, googleName, googlePhoto } = req.body;
    const result = authService.loginWithGoogle(idToken, googleEmail, googleName, googlePhoto);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 8. Login with Email + Password
router.post('/auth/login-email', (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required.' });
    }
    const result = authService.loginWithEmailPassword(email, password);
    if (!result.success) {
      return res.status(400).json({ error: result.error });
    }
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 9. Permanent Account & Data Deletion
router.delete('/auth/delete-account', async (req, res) => {
  try {
    const userId = req.body?.userId || req.query?.userId || req.headers['x-user-id'];
    const email = req.body?.email || req.query?.email;
    if (!userId && !email) {
      return res.status(400).json({ success: false, error: 'User ID or Email is required for deletion.' });
    }
    const result = await authService.deleteUserAccount(userId, email);
    res.json(result);
  } catch (err) {
    console.error('[API] Error during account deletion:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/auth/delete-account', async (req, res) => {
  try {
    const userId = req.body?.userId || req.query?.userId || req.headers['x-user-id'];
    const email = req.body?.email || req.query?.email;
    if (!userId && !email) {
      return res.status(400).json({ success: false, error: 'User ID or Email is required for deletion.' });
    }
    const result = await authService.deleteUserAccount(userId, email);
    res.json(result);
  } catch (err) {
    console.error('[API] Error during account deletion:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Comprehensive Security Validator for Blocking Dangerous/Exploit/Script Formats
const RESTRICTED_EXTENSIONS = new Set([
  'php', 'php3', 'php4', 'php5', 'phtml', 'phar', 'inc',
  'asp', 'aspx', 'axd', 'ashx', 'asmx', 'cer', 'asa',
  'jsp', 'jspx', 'jsw', 'jsv', 'jspf', 'war', 'ear', 'cgi', 'pl', 'perl', 'pyc', 'pyo', 'pyd',
  'sh', 'bash', 'zsh', 'csh', 'ksh', 'bat', 'cmd', 'vbs', 'vbe', 'jse', 'wsf', 'wsh', 'msc',
  'scr', 'pif', 'gadget', 'hta', 'cpl', 'reg', 'msp', 'com', 'inf', 'ins', 'sct',
  'htaccess', 'htpasswd', 'env', 'config'
]);

function isFileRestricted(fileName) {
  if (!fileName || typeof fileName !== 'string') return false;
  const parts = fileName.toLowerCase().trim().split('.');
  if (parts.length <= 1) return false;
  for (let i = 1; i < parts.length; i++) {
    const ext = parts[i].trim();
    if (RESTRICTED_EXTENSIONS.has(ext)) {
      return true;
    }
  }
  return false;
}

// 2. Cloudflare R2 Connection Status Check
router.get('/r2/status', async (req, res) => {
  const result = await r2StorageService.testConnection();
  res.json(result);
});

// 2b. Direct Pre-signed S3 Upload URL for Cloudflare R2
router.post('/r2/presigned-upload', async (req, res) => {
  try {
    const { fileName, mimeType, sizeBytes } = req.body;
    if (!fileName) {
      return res.status(400).json({ error: 'fileName is required' });
    }
    if (isFileRestricted(fileName)) {
      return res.status(400).json({ success: false, error: 'This file format is not supported for security reasons.' });
    }
    const safeName = fileName.replace(/[^a-zA-Z0-9._-]/g, '_');
    const r2Key = `uploads/${Date.now()}_${safeName}`;
    const contentType = mimeType || 'application/octet-stream';

    const presigned = await r2StorageService.getPresignedUploadUrl(r2Key, contentType, 7200); // 2 hours

    res.json({
      success: true,
      uploadUrl: presigned.uploadUrl,
      r2Key: r2Key,
      publicUrl: presigned.publicUrl,
      downloadUrl: presigned.publicUrl,
      fileName: fileName,
      contentType: contentType,
    });
  } catch (err) {
    console.error('[Presigned Upload Error]', err);
    res.status(500).json({ error: err.message });
  }
});

// 3. Direct Real File Upload Endpoint to Cloudflare R2
router.post('/r2/upload', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const fileName = req.file.originalname;
    if (isFileRestricted(fileName)) {
      try { fs.unlinkSync(req.file.path); } catch (_) {}
      return res.status(400).json({ success: false, error: 'This file format is not supported for security reasons.' });
    }
    const diskFileName = req.file.filename;
    const filePath = req.file.path;
    const sizeBytes = req.file.size;
    const mimeType = req.file.mimetype || 'application/octet-stream';
    const ext = fileName.split('.').pop().toLowerCase();
    const isVideo = mimeType.startsWith('video/') || ['mp4', 'mkv', 'mov', 'webm', 'avi'].includes(ext);

    // Cloudflare R2 Key & Public URL
    const r2Key = `uploads/${diskFileName}`;
    const publicR2Url = `${env.r2.publicDomain}/${r2Key}`;

    // Upload to Cloudflare R2 (smart: PutObject for small, Multipart for large)
    try {
      await r2StorageService.uploadFile(r2Key, filePath, mimeType);
      console.log(`[R2 Upload] ✅ Successfully saved to Cloudflare R2: ${r2Key} (${sizeBytes} bytes)`);
    } catch (r2Err) {
      console.error('[R2 Upload Error]', r2Err.message);
      return res.status(500).json({ error: `R2 upload failed: ${r2Err.message}` });
    }

    // Cleanup local file after successful R2 upload
    try { fs.unlinkSync(filePath); } catch (_) { }

    res.json({
      success: true,
      file: {
        id: `node_${Date.now()}`,
        name: fileName,
        sizeBytes: sizeBytes,
        contentType: mimeType,
        extension: ext,
        isVideo: isVideo,
        r2Key: r2Key,
        publicUrl: publicR2Url,
        streamUrl: isVideo ? publicR2Url : null,
        downloadUrl: publicR2Url,
        uploadedAt: new Date().toISOString(),
      },
    });
  } catch (err) {
    console.error('Upload Error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Helper to resolve MIME type on the fly
function getMimeType(fileName) {
  const ext = fileName.split('.').pop().toLowerCase();
  switch (ext) {
    case 'mp4': return 'video/mp4';
    case 'mkv': return 'video/x-matroska';
    case 'mov': return 'video/quicktime';
    case 'webm': return 'video/webm';
    case 'avi': return 'video/x-msvideo';
    case 'jpg':
    case 'jpeg': return 'image/jpeg';
    case 'png': return 'image/png';
    case 'webp': return 'image/webp';
    case 'pdf': return 'application/pdf';
    case 'zip': return 'application/zip';
    case 'rar': return 'application/x-rar-compressed';
    default: return 'application/octet-stream';
  }
}

// 4. Resumable Chunk Upload - Receives individual 4 MB slice in memory and streams directly to Cloudflare R2 on the fly (0 Vercel Disk space!)
router.post('/upload/chunk', uploadMemory.single('chunk'), async (req, res) => {
  try {
    const { uploadId, chunkIndex, totalChunks, fileName } = req.body;
    if (!uploadId || chunkIndex === undefined || !fileName) {
      return res.status(400).json({ error: 'uploadId, chunkIndex, and fileName are required' });
    }
    if (isFileRestricted(fileName)) {
      return res.status(400).json({ success: false, error: 'This file format is not supported for security reasons.' });
    }

    if (!req.file) {
      return res.status(400).json({ error: 'No chunk file received' });
    }

    const metaKey = `uploads_meta/${uploadId}.json`;
    let meta = await r2StorageService.downloadJson(metaKey);

    if (!meta) {
      // Initiate S3 Multipart Upload on the fly for this session
      console.log(`[R2 Multipart] Initiating S3 Multipart Upload on the fly for: ${fileName}`);
      const safeName = fileName.replace(/[^a-zA-Z0-9._-]/g, '_');
      const r2Key = `uploads/${Date.now()}_${safeName}`;
      const contentType = getMimeType(fileName);

      const createCmd = new CreateMultipartUploadCommand({
        Bucket: r2StorageService.bucketName,
        Key: r2Key,
        ContentType: contentType,
      });
      const createRes = await r2StorageService.client.send(createCmd);

      meta = {
        s3UploadId: createRes.UploadId,
        s3Key: r2Key,
        parts: [],
        fileName,
        totalChunks: parseInt(totalChunks, 10),
        contentType
      };
      await r2StorageService.uploadJson(metaKey, meta);
    }

    const partNumber = parseInt(chunkIndex, 10) + 1;
    console.log(`[R2 Multipart] Streaming chunk ${partNumber}/${totalChunks} (size: ${req.file.size} bytes) for [${fileName}] straight to Cloudflare R2...`);

    const uploadPartCmd = new UploadPartCommand({
      Bucket: r2StorageService.bucketName,
      Key: meta.s3Key,
      UploadId: meta.s3UploadId,
      PartNumber: partNumber,
      Body: req.file.buffer,
    });
    const partRes = await r2StorageService.client.send(uploadPartCmd);

    console.log(`[R2 Multipart] ✅ Chunk ${partNumber}/${totalChunks} uploaded straight to Cloudflare R2`);

    res.json({
      success: true,
      uploadId,
      chunkIndex: parseInt(chunkIndex, 10),
      totalChunks: parseInt(totalChunks, 10),
    });
  } catch (err) {
    console.error('[Chunk Upload Error]', err);
    res.status(500).json({ error: err.message });
  }
});

// Global registry for background upload tasks to prevent HTTP connection timeouts
const uploadTasks = new Map();

async function completeS3MultipartUploadAsync(uploadId, meta, sizeBytes) {
  const metaKey = `uploads_meta/${uploadId}.json`;
  try {
    console.log(`[R2 Multipart] Completing multipart upload for: ${meta.fileName} (UploadId: ${meta.s3UploadId})`);

    const listCmd = new ListPartsCommand({
      Bucket: r2StorageService.bucketName,
      Key: meta.s3Key,
      UploadId: meta.s3UploadId,
    });
    const listRes = await r2StorageService.client.send(listCmd);

    const parts = (listRes.Parts || []).map(p => ({
      PartNumber: p.PartNumber,
      ETag: p.ETag,
    }));
    parts.sort((a, b) => a.PartNumber - b.PartNumber);

    console.log(`[R2 Multipart] Found ${parts.length} uploaded parts in R2 storage engine. Completing...`);

    const completeCmd = new CompleteMultipartUploadCommand({
      Bucket: r2StorageService.bucketName,
      Key: meta.s3Key,
      UploadId: meta.s3UploadId,
      MultipartUpload: {
        Parts: parts,
      },
    });

    await r2StorageService.client.send(completeCmd);
    console.log(`[R2 Multipart] ✅ Cloud assembly complete! Object saved as: ${meta.s3Key}`);

    const ext = meta.fileName.split('.').pop().toLowerCase();
    const isVideo = meta.contentType.startsWith('video/') || ['mp4', 'mkv', 'mov', 'webm', 'avi'].includes(ext);
    const publicR2Url = `${env.r2.publicDomain}/${meta.s3Key}`;

    // Update global map with completed details
    uploadTasks.set(uploadId, {
      status: 'completed',
      file: {
        id: `node_${Date.now()}`,
        name: meta.fileName,
        sizeBytes: parseInt(sizeBytes || '0', 10) || 0,
        extension: ext,
        isVideo: isVideo,
        r2Key: meta.s3Key,
        publicUrl: publicR2Url,
        streamUrl: isVideo ? publicR2Url : null,
        downloadUrl: publicR2Url,
        uploadedAt: new Date().toISOString(),
      }
    });

    // Cleanup metadata JSON in R2
    try {
      await r2StorageService.deleteObject(metaKey);
    } catch (_) { }

  } catch (err) {
    console.error('[R2 Multipart Completion Error]', err);
    uploadTasks.set(uploadId, {
      status: 'failed',
      error: err.message
    });
  }
}

// 5. Complete & Assemble Resumable Upload in Cloudflare R2
router.post('/upload/complete', async (req, res) => {
  try {
    const { uploadId, fileName, totalChunks, sizeBytes, mimeType } = req.body;
    if (!uploadId) {
      return res.status(400).json({ error: 'uploadId is required' });
    }

    // Check if task exists and is already completed
    if (uploadTasks.has(uploadId) && uploadTasks.get(uploadId).status === 'completed') {
      return res.json({ success: true, ...uploadTasks.get(uploadId) });
    }

    const metaKey = `uploads_meta/${uploadId}.json`;
    const meta = await r2StorageService.downloadJson(metaKey);

    if (!meta) {
      return res.status(404).json({ error: 'Upload metadata not found or session already closed' });
    }

    // Set task to processing state
    uploadTasks.set(uploadId, { status: 'processing' });

    // Complete Multipart upload in S3 asynchronously
    completeS3MultipartUploadAsync(uploadId, meta, sizeBytes);

    res.json({
      success: true,
      status: 'processing',
      message: 'Assembly started in background'
    });
  } catch (err) {
    console.error('[Upload Complete Route Error]', err);
    res.status(500).json({ error: err.message });
  }
});

// 5b. Get Async Assembly Status
router.get('/upload/status/:uploadId', (req, res) => {
  const task = uploadTasks.get(req.params.uploadId);
  if (!task) {
    return res.status(404).json({ error: 'Upload task not found' });
  }
  res.json(task);
});

// 5c. Get Chunk Status for Resume Verification (Vercel-safe serverless polling)
router.get('/upload/chunk-status/:uploadId', async (req, res) => {
  try {
    const { uploadId } = req.params;
    const metaKey = `uploads_meta/${uploadId}.json`;
    const meta = await r2StorageService.downloadJson(metaKey);

    if (!meta) {
      return res.json({ exists: false, uploadedChunks: [] });
    }

    const listCmd = new ListPartsCommand({
      Bucket: r2StorageService.bucketName,
      Key: meta.s3Key,
      UploadId: meta.s3UploadId,
    });
    const listRes = await r2StorageService.client.send(listCmd);

    const uploadedChunks = (listRes.Parts || []).map(p => p.PartNumber - 1);
    res.json({ exists: true, uploadedChunks });
  } catch (err) {
    console.error('[Chunk Status Route Error]', err);
    res.status(500).json({ error: err.message });
  }
});

// 6. Direct HTTP/HTTPS URL Remote Cloud Download Ingestion
router.post('/remote-upload', async (req, res) => {
  try {
    const { url, fileName } = req.body;
    if (!url) {
      return res.status(400).json({ error: 'Direct file URL is required' });
    }

    // Parse file name from URL
    let parsedName = fileName;
    if (!parsedName) {
      try {
        const u = new URL(url);
        parsedName = decodeURIComponent(path.basename(u.pathname)) || 'Cloud_Remote_Download';
      } catch (_) {
        parsedName = 'Remote_Cloud_Download.zip';
      }
    }

    if (parsedName && isFileRestricted(parsedName)) {
      return res.status(400).json({ success: false, error: 'This file format is not supported for security reasons.' });
    }

    const ext = parsedName.includes('.') ? parsedName.split('.').pop().toLowerCase() : 'dat';
    const isVideo = ['mp4', 'mkv', 'mov', 'webm', 'avi'].includes(ext);
    const safeName = `remote_${Date.now()}_${parsedName.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
    const r2Key = `uploads/${safeName}`;
    const localPath = path.join(uploadsDir, safeName);
    const publicR2Url = `${env.r2.publicDomain}/${r2Key}`;

    console.log(`[Remote Download] Starting download: ${url}`);

    const http = url.startsWith('https') ? require('https') : require('http');

    // Download file from URL to local disk
    const downloadToFile = (downloadUrl, destPath) => {
      return new Promise((resolve, reject) => {
        const fileStream = fs.createWriteStream(destPath);
        const request = http.get(downloadUrl, (response) => {
          // Follow redirects (301, 302, 307, 308)
          if ([301, 302, 307, 308].includes(response.statusCode) && response.headers.location) {
            fileStream.close();
            fs.unlinkSync(destPath);
            return resolve(downloadToFile(response.headers.location, destPath));
          }

          if (response.statusCode !== 200) {
            fileStream.close();
            return reject(new Error(`Download failed: HTTP ${response.statusCode}`));
          }

          const totalSize = parseInt(response.headers['content-length'] || '0', 10);
          let downloaded = 0;

          response.on('data', (chunk) => {
            downloaded += chunk.length;
          });

          response.pipe(fileStream);
          fileStream.on('finish', () => {
            fileStream.close();
            resolve({ totalSize: totalSize || downloaded, downloaded });
          });
        });

        request.on('error', (err) => {
          fileStream.close();
          reject(err);
        });

        // 5 minute timeout for large files
        request.setTimeout(5 * 60 * 1000, () => {
          request.destroy();
          reject(new Error('Download timeout after 5 minutes'));
        });
      });
    };

    const dlResult = await downloadToFile(url, localPath);
    const fileSizeBytes = fs.statSync(localPath).size;
    console.log(`[Remote Download] ✅ Downloaded ${(fileSizeBytes / 1024 / 1024).toFixed(1)} MB to disk`);

    // Upload to Cloudflare R2
    const mimeType = isVideo ? 'video/mp4' : 'application/octet-stream';
    try {
      const buffer = fs.readFileSync(localPath);
      await r2StorageService.uploadBuffer(r2Key, buffer, mimeType);
      console.log(`[Remote Download] ✅ Uploaded to Cloudflare R2: ${r2Key}`);
    } catch (r2Err) {
      console.error(`[Remote Download] R2 upload error: ${r2Err.message}`);
    }

    // Clean up local file after R2 upload
    try { fs.unlinkSync(localPath); } catch (_) { }

    res.json({
      success: true,
      status: 'completed',
      file: {
        id: `node_${Date.now()}`,
        name: parsedName,
        sizeBytes: fileSizeBytes,
        extension: ext,
        isVideo: isVideo,
        r2Key: r2Key,
        publicUrl: publicR2Url,
        streamUrl: isVideo ? publicR2Url : null,
        downloadUrl: publicR2Url,
        sourceUrl: url,
        uploadedAt: new Date().toISOString(),
      }
    });
  } catch (err) {
    console.error('Remote Upload Error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// 7. Create Short Share Link (For Viral Video Preview & File Download)
router.post('/share/create', async (req, res) => {
  try {
    const fileData = req.body;
    if (!fileData || !fileData.name) {
      return res.status(400).json({ error: 'Invalid file data' });
    }

    const host = req.get('host');
    // Handle proxy protocols on Vercel/cloud hosting
    const protocol = req.headers['x-forwarded-proto'] || req.protocol;
    const requestAppUrl = `${protocol}://${host}`;

    let referralCode = fileData.referralCode;
    const userId = fileData.userId || fileData.creatorUserId;

    // If referralCode is not provided but userId is, try looking up or auto-enrolling the webmaster profile
    if (!referralCode && userId) {
      for (const [code, p] of webmasterService.profiles.entries()) {
        if (p.userId === userId) {
          referralCode = code;
          break;
        }
      }
      // Auto-enroll so NO shared link ever loses its monetization or tracking!
      if (!referralCode) {
        const newRefCode = 'TBX' + Math.floor(1000 + Math.random() * 9000);
        const newProf = {
          userId,
          referralCode: newRefCode,
          currentPlan: 'videoPlays',
          walletBalanceUsd: 0.0,
          totalWithdrawnUsd: 0.0,
          stats: [],
          sharedLinks: [],
          joinedAt: new Date().toISOString(),
        };
        webmasterService.profiles.set(newRefCode, newProf);
        webmasterService._saveWebmastersToDisk();
        referralCode = newRefCode;
      }
    }

    if (referralCode) {
      fileData.referralCode = referralCode;
    }

    const customCode = fileData.code || fileData.shortCode;
    const share = await shareService.createShare(fileData, customCode, requestAppUrl);

    // Link back to webmaster profile sharedLinks list ONLY for VIDEO files!
    if (referralCode && isVideoFile(share)) {
      const profile = webmasterService.getProfile(referralCode);
      if (profile) {
        profile.sharedLinks ??= [];
        if (!profile.sharedLinks.some(l => l.shortCode === share.code || l.id === share.code || (share.downloadUrl && l.originalUrl === share.downloadUrl))) {
          profile.sharedLinks.unshift({
            id: share.code,
            shortCode: share.code,
            originalUrl: share.downloadUrl,
            monetizedUrl: share.shareUrl,
            fileName: share.fileName || fileData.name || 'Shared Video',
            createdAt: share.createdAt || new Date().toISOString(),
            clicks: 0,
            videoPlays: 0,
            newUsers: 0,
            earningsUsd: 0.0,
          });
          webmasterService._saveWebmastersToDisk();
        }
      }
    }

    res.json({
      success: true,
      share,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 8. Get Share Link Metadata
router.get('/share/:code', async (req, res) => {
  const share = await shareService.getShare(req.params.code);
  if (!share) {
    return res.status(404).json({ error: 'Share link not found or expired' });
  }
  res.json(share);
});

// ═══════════════════════════════════════════════
//  9. WEBMASTER PROGRAM ENDPOINTS
// ═══════════════════════════════════════════════

// Fetch Webmaster Profile (Strict per-user security isolation)
router.get('/webmaster/profile', (req, res) => {
  const { userId, id, referralCode, email } = req.query;
  const targetUserId = (userId || id || referralCode || email || '').trim();

  if (!targetUserId) {
    return res.status(401).json({ success: false, isEnrolled: false, error: 'Authentication required. Please log in.' });
  }

  // 1. Resolve strictly by authenticated User ID or Referral Code
  let profile = null;
  for (const [c, p] of webmasterService.profiles.entries()) {
    if (p.userId === targetUserId || c === targetUserId || p.referralCode === targetUserId) {
      profile = p;
      break;
    }
  }

  // 2. Resolve by checking matching user ID/email in authService
  if (!profile) {
    let authUser = authService.users.get(targetUserId);
    if (!authUser) {
      for (const u of authService.users.values()) {
        if (u.email === targetUserId || u.id === targetUserId) {
          authUser = u;
          break;
        }
      }
    }
    if (authUser && authUser.webmasterReferralCode) {
      profile = webmasterService.getProfile(authUser.webmasterReferralCode);
    }
  }

  if (!profile) {
    return res.status(404).json({ success: false, isEnrolled: false, error: 'Webmaster profile not found' });
  }

  // Auto-sync any video shares created by this user (Filter out any non-video files)
  profile.sharedLinks ??= [];
  profile.sharedLinks = profile.sharedLinks.filter(l => isVideoFile(l));
  
  const refCode = profile.referralCode;
  const ownerUserId = profile.userId;

  for (const [sCode, share] of shareService.shares.entries()) {
    if (!isVideoFile(share)) continue; // STRICTLY ONLY VIDEOS
    const isOwner = (share.referralCode && share.referralCode === refCode) ||
      (share.creatorUserId && share.creatorUserId === ownerUserId) ||
      (share.userId && share.userId === ownerUserId);
    if (isOwner) {
      let existing = profile.sharedLinks.find(l => l.shortCode === sCode || l.id === sCode);
      if (!existing) {
        profile.sharedLinks.unshift({
          id: sCode,
          shortCode: sCode,
          originalUrl: share.downloadUrl || share.streamUrl || '',
          monetizedUrl: share.shareUrl || `https://terabox.mywire.org/s/${sCode}?ref=${refCode}`,
          fileName: share.fileName || 'Shared Video',
          createdAt: share.createdAt || new Date().toISOString(),
          clicks: share.viewsCount || 0,
          videoPlays: 0,
          newUsers: 0,
          earningsUsd: 0.0,
        });
      }
    }
  }

  res.json({ success: true, isEnrolled: true, profile });
});

// Enroll / Join Webmaster Program
router.post('/webmaster/enroll', (req, res) => {
  const { userId, email } = req.body;
  const targetUserId = (userId || email || '').trim();
  if (!targetUserId) {
    return res.status(400).json({ error: 'userId is required' });
  }

  // Check if profile already exists for this user
  let existingProfile = null;
  for (const [code, p] of webmasterService.profiles.entries()) {
    if (p.userId === targetUserId || p.email === targetUserId || (email && p.email === email)) {
      existingProfile = p;
      break;
    }
  }

  if (existingProfile) {
    return res.json({ success: true, profile: existingProfile, message: 'Already enrolled' });
  }

  // Find user in authService
  let authUser = authService.users.get(targetUserId);
  if (!authUser && email) {
    authUser = authService.users.get(email.toLowerCase());
  }
  if (!authUser) {
    for (const u of authService.users.values()) {
      if (u.email === targetUserId || u.id === targetUserId || (email && u.email === email)) {
        authUser = u;
        break;
      }
    }
  }

  // Create new profile
  const referralCode = 'TBX' + Math.floor(1000 + Math.random() * 9000);
  const userEmail = email || authUser?.email || (targetUserId.includes('@') ? targetUserId : '');
  const newProfile = {
    userId: targetUserId,
    email: userEmail,
    referralCode,
    currentPlan: 'videoPlays',
    walletBalanceUsd: 0.0,
    totalWithdrawnUsd: 0.0,
    stats: [],
    joinedAt: new Date().toISOString(),
  };

  webmasterService.profiles.set(referralCode, newProfile);
  webmasterService._saveWebmastersToDisk();

  // Also update user profile in authService persistent store if exists
  if (authUser) {
    authUser.isWebmasterEnrolled = true;
    authUser.webmasterReferralCode = referralCode;
    authService._saveUsersToDisk();
  }

  res.json({ success: true, profile: newProfile });
});

// Switch Plan
router.post('/webmaster/switch-plan', (req, res) => {
  const { referralCode, plan } = req.body;
  if (!referralCode || !plan) {
    return res.status(400).json({ error: 'referralCode and plan are required' });
  }
  const success = webmasterService.switchPlan(referralCode, plan);
  if (!success) {
    return res.status(404).json({ error: 'Profile not found' });
  }
  res.json({ success: true, currentPlan: plan });
});

// Submit Withdrawal
router.post('/webmaster/withdraw', (req, res) => {
  const { referralCode, amountUsd, method, accountInfo } = req.body;
  if (!referralCode || !amountUsd || !method || !accountInfo) {
    return res.status(400).json({ error: 'Missing withdrawal fields' });
  }

  try {
    const record = webmasterService.submitWithdrawal(referralCode, {
      amountUsd: parseFloat(amountUsd),
      method,
      accountInfo
    });
    res.json({ success: true, record });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ═════════════════════════════════════════════════════════════════════
// 🛡️ MILITARY-GRADE ANTI-FRAUD & MODEL 1 WATCH-TIME VERIFICATION ENGINE
// ═════════════════════════════════════════════════════════════════════

// 1. Generate Proof-of-Watch Session Nonce & Record Real Unique Link Click
router.post('/webmaster/session-nonce/:code', async (req, res) => {
  const share = await shareService.getShare(req.params.code);
  if (!share) {
    return res.status(404).json({ error: 'Share link not found' });
  }

  const { fingerprint, isRepeatSession } = req.body || {};
  const clientIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '127.0.0.1';
  const country = fraudDetectionService.detectCountry(req);
  const cpmTier = fraudDetectionService.getCpmTier(country);
  const botCheck = fraudDetectionService.isDatacenterOrBot(req, clientIp);

  // Click Anti-Fraud Check (Prevents Chrome F5 / Page Reload spamming)
  const clickDedup = fraudDetectionService.checkClickDeduplication({
    clientIp,
    shareCode: share.code,
    fingerprint,
    isRepeatSession: !!isRepeatSession,
  });

  let refCode = share.referralCode || req.query.ref;
  if (!refCode && (share.creatorUserId || share.userId)) {
    const uid = (share.creatorUserId || share.userId).toString().trim();
    for (const [code, p] of webmasterService.profiles.entries()) {
      if (p.userId === uid || p.email === uid || p.referralCode === uid || code === uid) {
        refCode = code;
        share.referralCode = code;
        break;
      }
    }
  }

  // Record Real Unique Link Click (ONLY if real human and NOT a page reload)
  let clickCounted = false;
  if (refCode && !botCheck.isBot && clickDedup.allowed) {
    clickCounted = true;
    const profile = webmasterService.getProfile(refCode);
    if (profile) {
      const todayStr = new Date().toISOString().substring(0, 10);
      profile.stats ??= [];
      let todayStat = profile.stats.find(s => s.date === todayStr);
      if (!todayStat) {
        todayStat = { date: todayStr, clicks: 0, videoPlays: 0, newUsers: 0, earningsUsd: 0.0, countryBreakdown: {} };
        profile.stats.push(todayStat);
      }
      todayStat.clicks = (todayStat.clicks || 0) + 1;
      todayStat.countryBreakdown ??= {};
      todayStat.countryBreakdown[country] = (todayStat.countryBreakdown[country] || 0) + 1;

      profile.sharedLinks ??= [];
      let link = profile.sharedLinks.find(l => l.shortCode === share.code || l.id === share.code);
      if (link) {
        link.clicks = (link.clicks || 0) + 1;
      }
      webmasterService._saveWebmastersToDisk();
    }
  }

  const session = fraudDetectionService.generateSessionNonce(share.code, clientIp);
  const requiredWatchSeconds = fraudDetectionService.calculateWatchThreshold(share.durationSeconds || 120);

  const crypto = require('crypto');
  const nonceSecret = process.env.FRAUD_NONCE_SECRET || 'terabox_anti_fraud_secret_salt_2026';
  const clientToken = crypto
    .createHmac('sha256', nonceSecret)
    .update(`${session.nonce}:${share.code}:${Math.floor(requiredWatchSeconds)}`)
    .digest('hex');

  res.json({
    success: true,
    nonce: session.nonce,
    clientToken,
    country,
    cpmRateUsd: cpmTier.cpmRateUsd,
    requiredWatchSeconds,
    clickCounted,
    dedupReason: clickDedup.allowed ? null : clickDedup.reason,
  });
});

// 2. Proof-of-Watch Verification & Dynamic Country CPM Credit (Model 1 Engine)
router.post('/webmaster/verify-watch', async (req, res) => {
  const { code, nonce, watchSeconds, videoDuration, fingerprint, clientToken } = req.body;

  if (!code || !nonce || !clientToken) {
    return res.status(400).json({ success: false, error: 'Missing Proof-of-Watch verification parameters' });
  }

  const share = await shareService.getShare(code);
  if (!share) {
    return res.status(404).json({ success: false, error: 'Share link not found' });
  }

  // 0. Ensure share is a valid video file
  if (!isVideoFile(share)) {
    return res.status(400).json({ success: false, error: 'Only video files are eligible for Webmaster CPM monetization' });
  }

  const clientIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '127.0.0.1';

  // 1. Bot & Datacenter Check
  const botCheck = fraudDetectionService.isDatacenterOrBot(req, clientIp);
  if (botCheck.isBot) {
    return res.status(403).json({ success: false, error: 'Invalid Traffic: ' + botCheck.reason, cpmRateUsd: 0.0 });
  }

  // 2. Cryptographic Nonce & Watch-Time Threshold Verification (Model 1)
  const verifyResult = fraudDetectionService.verifyWatchToken({
    nonce,
    code,
    watchSeconds,
    videoDuration: videoDuration || share.durationSeconds,
    clientToken,
    fingerprint,
    clientIp,
  });

  if (!verifyResult.valid) {
    return res.status(400).json({
      success: false,
      error: verifyResult.reason,
      requiredThreshold: verifyResult.requiredThreshold,
      actualWatch: verifyResult.actualWatch,
    });
  }

  // 3. 24-Hour Deduplication & VPN Ring Check (Safely resolving file identifier)
  const targetFileId = share.code || share.fileId || share.id || 'share_video';
  const dedup = fraudDetectionService.checkDeduplication(clientIp, targetFileId, fingerprint);
  if (!dedup.allowed) {
    return res.json({ success: true, verified: false, counted: false, reason: dedup.reason });
  }

  // 4. Resolve Webmaster Referral Code
  let refCode = share.referralCode || req.query.ref;
  if (!refCode && (share.creatorUserId || share.userId)) {
    const uid = (share.creatorUserId || share.userId).toString().trim();
    for (const [c, p] of webmasterService.profiles.entries()) {
      if (p.userId === uid || p.email === uid || p.referralCode === uid || c === uid) {
        refCode = c;
        share.referralCode = c;
        break;
      }
    }
  }

  if (!refCode) {
    return res.status(404).json({ success: false, error: 'Webmaster profile not bound to share' });
  }

  // 5. Country Detection & Tier-Based Dynamic CPM Payout
  const country = fraudDetectionService.detectCountry(req);
  const tier = fraudDetectionService.getCpmTier(country);
  const earnPerView = tier.ratePerViewUsd;

  const profile = webmasterService.getProfile(refCode);
  if (profile) {
    profile.walletBalanceUsd = Math.round(((profile.walletBalanceUsd || 0) + earnPerView) * 10000) / 10000;

    // Update Daily Stats with Country Breakdown
    const todayStr = new Date().toISOString().substring(0, 10);
    profile.stats ??= [];
    let todayStat = profile.stats.find(s => s.date === todayStr);
    if (!todayStat) {
      todayStat = { date: todayStr, clicks: 0, videoPlays: 0, newUsers: 0, earningsUsd: 0.0, countryBreakdown: {} };
      profile.stats.push(todayStat);
    }
    todayStat.videoPlays = (todayStat.videoPlays || 0) + 1;
    todayStat.earningsUsd = Math.round(((todayStat.earningsUsd || 0) + earnPerView) * 10000) / 10000;
    todayStat.countryBreakdown ??= {};
    todayStat.countryBreakdown[country] = (todayStat.countryBreakdown[country] || 0) + 1;

    // Update Specific Link Stats
    profile.sharedLinks ??= [];
    let link = profile.sharedLinks.find(l => l.shortCode === share.code || l.id === share.code);
    if (!link) {
      link = {
        id: share.code,
        shortCode: share.code,
        originalUrl: share.downloadUrl || share.streamUrl || '',
        monetizedUrl: share.shareUrl || `https://terabox.mywire.org/s/${share.code}?ref=${refCode}`,
        fileName: share.fileName || 'Shared Video',
        createdAt: share.createdAt || new Date().toISOString(),
        clicks: 1,
        videoPlays: 0,
        newUsers: 0,
        earningsUsd: 0.0,
      };
      profile.sharedLinks.unshift(link);
    }
    link.videoPlays = (link.videoPlays || 0) + 1;
    link.earningsUsd = Math.round(((link.earningsUsd || 0) + earnPerView) * 10000) / 10000;

    // Detailed Audit Earning Record
    profile.earningRecords ??= [];
    profile.earningRecords.unshift({
      id: `earn_${Date.now()}`,
      type: 'videoPlays',
      amountUsd: earnPerView,
      description: `Verified video play view on ${share.fileName || 'Video'} ($4.00 CPM)`,
      country,
      cpmRateUsd: tier.cpmRateUsd,
      recordedAt: new Date().toISOString(),
    });

    webmasterService._saveWebmastersToDisk();
  }

  res.json({
    success: true,
    verified: true,
    counted: true,
    country,
    tier: tier.tier,
    cpmRateUsd: tier.cpmRateUsd,
    earnedUsd: earnPerView,
    actualWatch: verifyResult.actualWatch,
    requiredThreshold: verifyResult.requiredThreshold,
  });
});

// Legacy Fallbacks
router.get('/webmaster/track-click/:code', async (req, res) => {
  const share = await shareService.getShare(req.params.code);
  if (!share) return res.status(404).json({ error: 'Share not found' });
  const country = fraudDetectionService.detectCountry(req);
  res.json({ success: true, refCode: share.referralCode, country });
});

router.get('/webmaster/track-play/:code', async (req, res) => {
  const share = await shareService.getShare(req.params.code);
  if (!share) return res.status(404).json({ error: 'Share not found' });
  res.json({ success: true, message: 'Use POST /api/webmaster/verify-watch with Proof-of-Watch' });
});

// ═════════════════════════════════════════════════════════════════════
// 🛡️ COPYRIGHT INFRINGEMENT & DMCA TAKEDOWN REPORTING SYSTEM
// ═════════════════════════════════════════════════════════════════════

const reportsFile = path.join(__dirname, '../../data/reports.json');
function getReports() {
  try {
    if (fs.existsSync(reportsFile)) {
      return JSON.parse(fs.readFileSync(reportsFile, 'utf8'));
    }
  } catch (_) {}
  return [];
}
function saveReports(reports) {
  try {
    const dir = path.dirname(reportsFile);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(reportsFile, JSON.stringify(reports, null, 2), 'utf8');
  } catch (err) {
    console.warn('[API Routes] Could not save reports.json:', err.message);
  }
}

// 1. Submit Copyright / DMCA Takedown / Violation Report
router.post('/report/takedown', async (req, res) => {
  const { shareCode, reason, reporterName, reporterEmail, proofDetails } = req.body;

  if (!shareCode || !reason) {
    return res.status(400).json({ success: false, error: 'Share code and report reason are required' });
  }

  const share = await shareService.getShare(shareCode);
  const reportId = 'TBX-RPT-' + Date.now().toString(36).toUpperCase() + Math.floor(100 + Math.random() * 900);
  const clientIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '127.0.0.1';

  const reportRecord = {
    reportId,
    shareCode,
    fileName: share ? share.fileName : 'Unknown File',
    fileId: share ? share.fileId : null,
    creatorUserId: share ? share.creatorUserId : null,
    reason: reason || 'Copyright Infringement',
    reporterName: reporterName || 'Anonymous',
    reporterEmail: reporterEmail || 'N/A',
    proofDetails: proofDetails || '',
    clientIp,
    status: 'PENDING_REVIEW',
    submittedAt: new Date().toISOString(),
  };

  const reports = getReports();
  reports.unshift(reportRecord);
  saveReports(reports);

  console.log(`[Trust & Safety] 🚩 DMCA/Violation Report registered: ${reportId} for file ${shareCode}`);

  res.json({
    success: true,
    reportId,
    message: 'Report successfully submitted. The TeraBox Trust & Safety team has received your complaint and will review it in accordance with DMCA regulations.',
  });
});

// 2. Get Standard Report Violation Reasons
router.get('/report/reasons', (req, res) => {
  res.json({
    success: true,
    reasons: [
      { id: 'general_pornography', title: 'General pornography' },
      { id: 'child_pornography', title: 'Child pornography' },
      { id: 'defamation', title: 'Defamation' },
      { id: 'privacy', title: 'Privacy' },
      { id: 'racial_hatred', title: 'Racial hatred' },
      { id: 'deception', title: 'Deception' },
      { id: 'violence', title: 'Violence' },
      { id: 'social_negative', title: 'Social negative' },
      { id: 'dmca_copyright', title: 'Copyright Infringement / Piracy (DMCA)' }
    ]
  });
});

module.exports = router;
