const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const env = require('../config/env');
const r2StorageService = require('../services/r2StorageService');
const shareService = require('../services/shareService');
const deduplicationService = require('../services/deduplicationService');

const uploadsDir = path.join(__dirname, '../../uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

const chunksDir = path.join(__dirname, '../../uploads/chunks');
if (!fs.existsSync(chunksDir)) {
  fs.mkdirSync(chunksDir, { recursive: true });
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

// 1. User Profile
router.get('/user/profile', (req, res) => {
  res.json({
    id: 'usr_terabox_001',
    email: 'user@terabox.cloud',
    displayName: 'TeraBox Cloud User',
    totalSpaceBytes: 1099511627776, // 1 TB
    usedSpaceBytes: 0,
    isVip: false,
    hasSafeBoxConfigured: true,
  });
});

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
    try { fs.unlinkSync(filePath); } catch (_) {}

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

// 4. Resumable Chunk Upload - Receives individual 4 MB slice
router.post('/upload/chunk', upload.single('chunk'), async (req, res) => {
  try {
    const { uploadId, chunkIndex, totalChunks, fileName } = req.body;
    if (!uploadId || chunkIndex === undefined) {
      return res.status(400).json({ error: 'uploadId and chunkIndex are required' });
    }

    const uploadChunkDir = path.join(chunksDir, uploadId);
    if (!fs.existsSync(uploadChunkDir)) {
      fs.mkdirSync(uploadChunkDir, { recursive: true });
    }

    if (req.file) {
      const targetChunkPath = path.join(uploadChunkDir, `part_${chunkIndex}`);
      if (fs.existsSync(targetChunkPath)) {
        try { fs.unlinkSync(targetChunkPath); } catch (_) {}
      }
      fs.renameSync(req.file.path, targetChunkPath);
    }

    console.log(`[Resumable Upload] Chunk ${chunkIndex}/${totalChunks} received for uploadId: ${uploadId}`);

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

// 5. Complete & Assemble Resumable Upload into Cloudflare R2
router.post('/upload/complete', async (req, res) => {
  try {
    const { uploadId, fileName, totalChunks, sizeBytes, mimeType } = req.body;
    if (!uploadId || !fileName || !totalChunks) {
      return res.status(400).json({ error: 'uploadId, fileName, and totalChunks are required' });
    }

    const uploadChunkDir = path.join(chunksDir, uploadId);
    if (!fs.existsSync(uploadChunkDir)) {
      return res.status(404).json({ error: 'Upload chunk directory not found' });
    }

    const safeName = fileName.replace(/[^a-zA-Z0-9._-]/g, '_');
    const diskFileName = `${Date.now()}_${safeName}`;
    const mergedFilePath = path.join(uploadsDir, diskFileName);

    // Phase 1: Assemble chunks using STREAMING (no readFileSync)
    console.log(`[Resumable Complete] Assembling ${totalChunks} chunks for: ${fileName}`);
    const writeStream = fs.createWriteStream(mergedFilePath);

    for (let i = 0; i < parseInt(totalChunks, 10); i++) {
      const chunkPath = path.join(uploadChunkDir, `part_${i}`);
      if (fs.existsSync(chunkPath)) {
        // Stream each chunk instead of readFileSync — prevents memory spikes
        await new Promise((resolve, reject) => {
          const readStream = fs.createReadStream(chunkPath);
          readStream.on('error', reject);
          readStream.on('end', () => {
            // Delete chunk immediately after streaming to free disk space
            try { fs.unlinkSync(chunkPath); } catch (_) {}
            resolve();
          });
          readStream.pipe(writeStream, { end: false });
        });
      } else {
        console.warn(`[Resumable Complete] Missing chunk ${i} for uploadId: ${uploadId}`);
      }
    }

    writeStream.end();
    await new Promise((resolve, reject) => {
      writeStream.on('finish', resolve);
      writeStream.on('error', reject);
    });

    // Cleanup chunk directory
    try { fs.rmdirSync(uploadChunkDir); } catch (_) {}

    const ext = fileName.split('.').pop().toLowerCase();
    const isVideo = (mimeType && mimeType.startsWith('video/')) || ['mp4', 'mkv', 'mov', 'webm', 'avi'].includes(ext);
    const r2Key = `uploads/${diskFileName}`;
    const publicR2Url = `${env.r2.publicDomain}/${r2Key}`;

    // Phase 2: Upload to R2 using smart method (Multipart for large files, PutObject for small)
    // This NEVER loads the entire file into memory — streams 10MB parts to R2
    const mergedSize = fs.statSync(mergedFilePath).size;
    console.log(`[Resumable Complete] Uploading ${fileName} (${(mergedSize / 1024 / 1024).toFixed(1)} MB) to Cloudflare R2...`);

    await r2StorageService.uploadFile(r2Key, mergedFilePath, mimeType || 'application/octet-stream');
    console.log(`[Resumable Complete] ✅ Successfully uploaded ${fileName} (${(mergedSize / 1024 / 1024).toFixed(1)} MB) to Cloudflare R2!`);

    // Cleanup: delete merged file from local disk to save space
    try { fs.unlinkSync(mergedFilePath); } catch (_) {}

    res.json({
      success: true,
      file: {
        id: `node_${Date.now()}`,
        name: fileName,
        sizeBytes: mergedSize,
        extension: ext,
        isVideo: isVideo,
        r2Key: r2Key,
        publicUrl: publicR2Url,
        streamUrl: isVideo ? publicR2Url : null,
        downloadUrl: publicR2Url,
        uploadedAt: new Date().toISOString(),
      }
    });
  } catch (err) {
    console.error('[Upload Complete Error]', err);
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
    try { fs.unlinkSync(localPath); } catch (_) {}

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
    // Handle proxy protocols on Render/Heroku
    const protocol = req.headers['x-forwarded-proto'] || req.protocol;
    const requestAppUrl = `${protocol}://${host}`;

    const customCode = fileData.code || fileData.shortCode;
    const share = await shareService.createShare(fileData, customCode, requestAppUrl);
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

module.exports = router;
