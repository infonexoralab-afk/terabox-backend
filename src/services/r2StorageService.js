const { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand, ListObjectsV2Command } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const { NodeHttpHandler } = require('@smithy/node-http-handler');
const https = require('https');
const env = require('../config/env');

class R2StorageService {
  constructor() {
    this.bucketName = env.r2.bucketName;
    this.publicDomain = env.r2.publicDomain;

    const httpsAgent = new https.Agent({
      family: 4, // Strict IPv4 for rock-solid stability on Windows
      keepAlive: true,
    });

    this.client = new S3Client({
      region: 'auto',
      endpoint: `https://${env.r2.accountId}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: env.r2.accessKeyId,
        secretAccessKey: env.r2.secretAccessKey,
      },
      forcePathStyle: true,
      requestHandler: new NodeHttpHandler({
        httpsAgent,
      }),
    });
  }

  // Upload Buffer directly to R2
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

  // Delete Object from R2
  async deleteObject(key) {
    const command = new DeleteObjectCommand({
      Bucket: this.bucketName,
      Key: key,
    });
    return await this.client.send(command);
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
