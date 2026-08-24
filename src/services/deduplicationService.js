const fs = require('fs');
const crypto = require('crypto');

class DeduplicationService {
  constructor() {
    // In-memory catalog of unique storage blobs indexed by SHA-256
    this.blobCatalog = new Map();
  }

  // Calculate SHA-256
  calculateSha256(buffer) {
    return crypto.createHash('sha256').update(buffer).digest('hex');
  }

  // Calculate MD5
  calculateMd5(buffer) {
    return crypto.createHash('md5').update(buffer).digest('hex');
  }

  // Check if blob already exists globally
  findExistingBlob(contentSha256) {
    return this.blobCatalog.get(contentSha256) || null;
  }

  // Register or increment reference of a stored blob
  registerBlob({ contentSha256, sizeBytes, mimeType, storagePath, hlsUrl, thumbnailUrl }) {
    if (this.blobCatalog.has(contentSha256)) {
      const blob = this.blobCatalog.get(contentSha256);
      blob.referenceCount += 1;
      return blob;
    }

    const newBlob = {
      id: `blob_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`,
      contentSha256,
      sizeBytes,
      mimeType,
      storagePath,
      hlsUrl: hlsUrl || null,
      thumbnailUrl: thumbnailUrl || null,
      referenceCount: 1,
      createdAt: new Date().toISOString(),
    };

    this.blobCatalog.set(contentSha256, newBlob);
    return newBlob;
  }

  // Decrement reference
  releaseBlob(contentSha256) {
    if (this.blobCatalog.has(contentSha256)) {
      const blob = this.blobCatalog.get(contentSha256);
      blob.referenceCount -= 1;
      if (blob.referenceCount <= 0) {
        this.blobCatalog.delete(contentSha256);
        return { deleted: true, path: blob.storagePath };
      }
    }
    return { deleted: false };
  }
}

module.exports = new DeduplicationService();
