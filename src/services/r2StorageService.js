const { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand, DeleteObjectsCommand, ListObjectsV2Command, CreateMultipartUploadCommand, UploadPartCommand, CompleteMultipartUploadCommand, AbortMultipartUploadCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const { NodeHttpHandler } = require('@smithy/node-http-handler');
const https = require('https');
const fs = require('fs');
const env = require('../config/env');

class R2StorageService {
  constructor() {
    this.bucketName = env.r2.bucketName;
    this.publicDomain = env.r2.publicDomain;

    const isVercel = process.env.VERCEL === '1';
    const clientConfig = {
      region: 'auto',
      endpoint: `https://${env.r2.accountId}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: env.r2.accessKeyId,
        secretAccessKey: env.r2.secretAccessKey,
      },
      forcePathStyle: true,
    };

    if (!isVercel) {
      const httpsAgent = new https.Agent({
        family: 4, // Strict IPv4 for rock-solid stability on Windows
        keepAlive: true,
      });
      clientConfig.requestHandler = new NodeHttpHandler({
        httpsAgent,
        connectionTimeout: 30000,
        socketTimeout: 300000, // 5 min socket timeout for large uploads
      });
    }

    this.client = new S3Client(clientConfig);
  }

  // Upload Buffer directly to R2 (for small files < 50MB)
  async uploadBuffer(key, buffer, contentType = 'application/octet-stream') {
    const command = new PutObjectCommand({
      Bucket: this.bucketName,
      Key: key,
      Body: buffer,
      ContentType: contentType,
    });

    const result = await this.client.send(command);
    return {
      key,
      publicUrl: this.getPublicUrl(key),
      bucket: this.bucketName,
      result,
    };
  }

  // Download file content as a parsed JSON object directly from R2
  async downloadJson(key) {
    try {
      const command = new GetObjectCommand({
        Bucket: this.bucketName,
        Key: key,
      });
      const response = await this.client.send(command);
      const str = await response.Body.transformToString();
      return JSON.parse(str);
    } catch (err) {
      if (err.name === 'NoSuchKey' || err.code === 'NoSuchKey') {
        return null;
      }
      throw err;
    }
  }

  // Upload JSON metadata helper
  async uploadJson(key, data) {
    const buffer = Buffer.from(JSON.stringify(data));
    return await this.uploadBuffer(key, buffer, 'application/json');
  }

  // S3 Multipart Upload — streams file from disk to R2 in 10MB parts
  // NEVER loads entire file into memory. Safe for files up to 5TB.
  async uploadFileStreaming(key, filePath, contentType = 'application/octet-stream') {
    const PART_SIZE = 10 * 1024 * 1024; // 10 MB per part
    const fileSize = fs.statSync(filePath).size;
    const totalParts = Math.ceil(fileSize / PART_SIZE);

    console.log(`[R2 Multipart] Starting streaming upload: ${key} (${(fileSize / 1024 / 1024).toFixed(1)} MB, ${totalParts} parts)`);

    // Step 1: Create Multipart Upload
    const createCmd = new CreateMultipartUploadCommand({
      Bucket: this.bucketName,
      Key: key,
      ContentType: contentType,
    });
    const createRes = await this.client.send(createCmd);
    const uploadId = createRes.UploadId;

    const uploadedParts = [];

    try {
      // Step 2: Upload each part by reading only 10MB at a time from disk
      for (let partNum = 1; partNum <= totalParts; partNum++) {
        const startByte = (partNum - 1) * PART_SIZE;
        const endByte = Math.min(startByte + PART_SIZE, fileSize);
        const partLength = endByte - startByte;

        // Read ONLY this part from disk (10MB max in RAM at any time)
        const partBuffer = Buffer.alloc(partLength);
        const fd = fs.openSync(filePath, 'r');
        fs.readSync(fd, partBuffer, 0, partLength, startByte);
        fs.closeSync(fd);

        const uploadPartCmd = new UploadPartCommand({
          Bucket: this.bucketName,
          Key: key,
          UploadId: uploadId,
          PartNumber: partNum,
          Body: partBuffer,
        });

        const partRes = await this.client.send(uploadPartCmd);
        uploadedParts.push({
          PartNumber: partNum,
          ETag: partRes.ETag,
        });

        console.log(`[R2 Multipart] Part ${partNum}/${totalParts} uploaded (${(partLength / 1024 / 1024).toFixed(1)} MB)`);
      }

      // Step 3: Complete Multipart Upload
      const completeCmd = new CompleteMultipartUploadCommand({
        Bucket: this.bucketName,
        Key: key,
        UploadId: uploadId,
        MultipartUpload: {
          Parts: uploadedParts,
        },
      });

      await this.client.send(completeCmd);
      console.log(`[R2 Multipart] ✅ Upload complete: ${key} (${(fileSize / 1024 / 1024).toFixed(1)} MB)`);

      return {
        key,
        publicUrl: this.getPublicUrl(key),
        bucket: this.bucketName,
        sizeBytes: fileSize,
      };
    } catch (err) {
      // Abort multipart upload on ANY failure to prevent orphaned parts
      console.error(`[R2 Multipart] ❌ Upload failed, aborting: ${err.message}`);
      try {
        const abortCmd = new AbortMultipartUploadCommand({
          Bucket: this.bucketName,
          Key: key,
          UploadId: uploadId,
        });
        await this.client.send(abortCmd);
        console.log(`[R2 Multipart] Aborted multipart upload: ${uploadId}`);
      } catch (abortErr) {
        console.error(`[R2 Multipart] Failed to abort: ${abortErr.message}`);
      }
      throw err;
    }
  }

  // Smart upload: uses PutObject for small files, Multipart for large files
  async uploadFile(key, filePath, contentType = 'application/octet-stream') {
    const fileSize = fs.statSync(filePath).size;
    const MULTIPART_THRESHOLD = 50 * 1024 * 1024; // 50 MB

    if (fileSize <= MULTIPART_THRESHOLD) {
      // Small file: simple PutObject (fast, single request)
      console.log(`[R2 Upload] Small file (${(fileSize / 1024 / 1024).toFixed(1)} MB), using PutObject`);
      const buffer = fs.readFileSync(filePath);
      return await this.uploadBuffer(key, buffer, contentType);
    } else {
      // Large file: S3 Multipart Upload (streaming, low memory)
      console.log(`[R2 Upload] Large file (${(fileSize / 1024 / 1024).toFixed(1)} MB), using Multipart Upload`);
      return await this.uploadFileStreaming(key, filePath, contentType);
    }
  }

  // Generate Pre-signed Direct Upload URL
  async getPresignedUploadUrl(key, contentType = 'application/octet-stream', expiresIn = 3600) {
    const command = new PutObjectCommand({
      Bucket: this.bucketName,
      Key: key,
      ContentType: contentType,
    });

    const uploadUrl = await getSignedUrl(this.client, command, { expiresIn });
    return {
      key,
      uploadUrl,
      publicUrl: this.getPublicUrl(key),
      expiresIn,
    };
  }

  // Generate Pre-signed Download URL
  async getPresignedDownloadUrl(key, expiresIn = 3600) {
    const command = new GetObjectCommand({
      Bucket: this.bucketName,
      Key: key,
    });

    return await getSignedUrl(this.client, command, { expiresIn });
  }

  // Get Direct Public CDN URL
  getPublicUrl(key) {
    if (this.publicDomain) {
      const base = this.publicDomain.replace(/\/$/, '');
      return `${base}/${key}`;
    }
    return `https://${this.bucketName}.${env.r2.accountId}.r2.cloudflarestorage.com/${key}`;
  }

  // Sanitize user email or identifier to create clean folder structure in Cloudflare R2
  sanitizeUserFolder(userIdentifier) {
    if (!userIdentifier || typeof userIdentifier !== 'string') return 'public_uploads';
    const clean = userIdentifier.trim().toLowerCase();
    if (clean.length === 0) return 'public_uploads';
    // Clean alphanumeric characters (e.g. daksh@gmail.com -> daksh_gmail.com)
    return clean.replace(/[^a-z0-9._-]/g, '_');
  }

  // Generate structured User-Wise R2 Key: users/{user_email}/{timestamp}_{safeFileName}
  generateUserR2Key(userIdentifier, fileName) {
    const userFolder = this.sanitizeUserFolder(userIdentifier);
    const safeName = (fileName || 'file.dat').replace(/[^a-zA-Z0-9._-]/g, '_');
    return `users/${userFolder}/${Date.now()}_${safeName}`;
  }

  // Delete Object from R2
  async deleteObject(key) {
    const command = new DeleteObjectCommand({
      Bucket: this.bucketName,
      Key: key,
    });
    return await this.client.send(command);
  }

  // Delete all files and complete folder for a user from Cloudflare R2
  async deleteUserFolder(userIdentifier) {
    if (!userIdentifier) return { success: false, deletedCount: 0 };
    const folderName = this.sanitizeUserFolder(userIdentifier);
    const prefix = `users/${folderName}/`;
    let deletedCount = 0;
    let continuationToken = undefined;

    console.log(`[R2] Starting full purge of user folder: ${prefix}`);

    try {
      do {
        const listCmd = new ListObjectsV2Command({
          Bucket: this.bucketName,
          Prefix: prefix,
          MaxKeys: 1000,
          ContinuationToken: continuationToken,
        });
        const listRes = await this.client.send(listCmd);
        const objects = listRes.Contents || [];

        if (objects.length > 0) {
          const deleteCmd = new DeleteObjectsCommand({
            Bucket: this.bucketName,
            Delete: {
              Objects: objects.map(o => ({ Key: o.Key })),
              Quiet: true,
            },
          });
          await this.client.send(deleteCmd);
          deletedCount += objects.length;
          console.log(`[R2] Deleted batch of ${objects.length} objects from ${prefix}`);
        }

        continuationToken = listRes.IsTruncated ? listRes.NextContinuationToken : undefined;
      } while (continuationToken);

      console.log(`[R2] Successfully purged user folder ${prefix}. Total objects deleted: ${deletedCount}`);
      return { success: true, folder: prefix, deletedCount };
    } catch (err) {
      console.error(`[R2] Error deleting user folder ${prefix}:`, err.message);
      return { success: false, folder: prefix, error: err.message, deletedCount };
    }
  }

  // Get storage telemetry and user folder metrics from R2
  async getStorageTelemetry() {
    try {
      const command = new ListObjectsV2Command({
        Bucket: this.bucketName,
        MaxKeys: 1000,
      });
      const res = await this.client.send(command);
      const objects = res.Contents || [];
      
      const userFoldersSet = new Set();
      let totalBytes = 0;

      objects.forEach(obj => {
        totalBytes += (obj.Size || 0);
        if (obj.Key && obj.Key.startsWith('users/')) {
          const parts = obj.Key.split('/');
          if (parts.length >= 2) {
            userFoldersSet.add(parts[1]);
          }
        }
      });

      return {
        success: true,
        bucketName: this.bucketName,
        publicDomain: this.publicDomain,
        totalObjects: objects.length,
        totalStorageBytes: totalBytes,
        totalStorageGb: Math.round((totalBytes / (1024 * 1024 * 1024)) * 100) / 100,
        userFoldersCount: userFoldersSet.size,
        userFolders: Array.from(userFoldersSet),
      };
    } catch (err) {
      return {
        success: false,
        bucketName: this.bucketName,
        publicDomain: this.publicDomain,
        totalObjects: 0,
        totalStorageBytes: 0,
        totalStorageGb: 0,
        userFoldersCount: 0,
        userFolders: [],
        error: err.message,
      };
    }
  }

  // Verify R2 connection
  async testConnection() {
    try {
      const command = new ListObjectsV2Command({
        Bucket: this.bucketName,
        MaxKeys: 5,
      });
      const res = await this.client.send(command);
      return { success: true, message: `Connected to R2 bucket [${this.bucketName}] successfully!`, filesCount: res.KeyCount || 0 };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }
}

module.exports = new R2StorageService();
