const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const r2StorageService = require('../services/r2StorageService');
const shareService = require('../services/shareService');
const deduplicationService = require('../services/deduplicationService');

const uploadsDir = path.join(__dirname, '../../uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
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

// 3. Direct Real File Upload Endpoint
router.post('/r2/upload', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const fileName = req.file.originalname;
    const diskFileName = req.file.filename;
    const filePath = req.file.path;
    const sizeBytes = req.file.size;
    const mimeType = req.file.mimetype;
    const isVideo = mimeType.startsWith('video/') || fileName.endsWith('.mp4') || fileName.endsWith('.mkv') || fileName.endsWith('.mov') || fileName.endsWith('.webm');

    // Local stream URL
    const localStreamUrl = `http://localhost:4000/uploads/${diskFileName}`;
    
    // Cloudflare R2 Key & Public URL
    const r2Key = `uploads/${diskFileName}`;
    let publicR2Url = `https://pub-d550feaadd484541bf0c3af429db5905.r2.dev/${r2Key}`;

    // Sync to Cloudflare R2 bucket asynchronously in the background
    setImmediate(async () => {
      try {
        const buffer = fs.readFileSync(filePath);
        await r2StorageService.uploadBuffer(r2Key, buffer, mimeType);
      } catch (_) {}
    });

    res.json({
      success: true,
      file: {
        id: `node_${Date.now()}`,
        name: fileName,
        sizeBytes: sizeBytes,
        contentType: mimeType,
        isVideo: isVideo,
        r2Key: r2Key,
        publicUrl: publicR2Url,
        streamUrl: localStreamUrl,
        downloadUrl: localStreamUrl,
        uploadedAt: new Date().toISOString(),
      },
    });
  } catch (err) {
    console.error('Upload Error:', err);
    res.status(500).json({ error: err.message });
  }
});

// 4. Create Short Share Link (For Viral Video Preview & File Download)
router.post('/share/create', (req, res) => {
  try {
    const fileData = req.body;
    if (!fileData || !fileData.name) {
      return res.status(400).json({ error: 'Invalid file data' });
    }

    const customCode = fileData.code || fileData.shortCode;
    const share = shareService.createShare(fileData, customCode);
    res.json({
      success: true,
      share,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 5. Get Share Link Metadata
router.get('/share/:code', (req, res) => {
  const share = shareService.getShare(req.params.code);
  if (!share) {
    return res.status(404).json({ error: 'Share link not found or expired' });
  }
  res.json(share);
});

module.exports = router;
