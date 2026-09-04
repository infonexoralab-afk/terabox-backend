const fs = require('fs');
const path = require('path');
const r2StorageService = require('./services/r2StorageService');
const { ListObjectsV2Command, DeleteObjectsCommand } = require('@aws-sdk/client-s3');

async function cleanAllDataAndR2() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('🧹 COMPLETE CLEANUP: CLOUDFLARE R2 & ALL USER DATA RESET');
  console.log('═══════════════════════════════════════════════════════════════\n');

  // 1. Delete all objects from Cloudflare R2
  console.log('1. Cleaning Cloudflare R2 Storage Bucket...');
  try {
    let continuationToken = null;
    let totalDeleted = 0;

    do {
      const listCommand = new ListObjectsV2Command({
        Bucket: r2StorageService.bucketName,
        ContinuationToken: continuationToken,
      });

      const listRes = await r2StorageService.client.send(listCommand);
      const objects = listRes.Contents || [];

      if (objects.length > 0) {
        const deleteCommand = new DeleteObjectsCommand({
          Bucket: r2StorageService.bucketName,
          Delete: {
            Objects: objects.map(o => ({ Key: o.Key })),
            Quiet: true,
          },
        });

        await r2StorageService.client.send(deleteCommand);
        totalDeleted += objects.length;
        console.log(`   Deleted ${objects.length} objects from Cloudflare R2 (Total: ${totalDeleted})...`);
      }

      continuationToken = listRes.NextContinuationToken;
    } while (continuationToken);

    console.log(`✅ Cloudflare R2 Bucket is now 100% EMPTY! (${totalDeleted} objects deleted)\n`);
  } catch (err) {
    console.error('⚠️ Cloudflare R2 cleanup note:', err.message);
  }

  // 2. Reset Data JSON Files
  console.log('2. Resetting Database JSON Files...');
  const dataDir = path.join(__dirname, '../data');
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  fs.writeFileSync(path.join(dataDir, 'users.json'), '[]', 'utf8');
  console.log('   ✅ users.json reset to []');

  fs.writeFileSync(path.join(dataDir, 'webmasters.json'), '[]', 'utf8');
  console.log('   ✅ webmasters.json reset to []');

  fs.writeFileSync(path.join(dataDir, 'shares.json'), '[]', 'utf8');
  console.log('   ✅ shares.json reset to []');

  // 3. Clean temporary uploads directory
  console.log('\n3. Cleaning temporary upload directories...');
  const uploadsDir = path.join(__dirname, '../uploads');
  const chunksDir = path.join(__dirname, '../uploads/chunks');

  function cleanDir(dir) {
    if (fs.existsSync(dir)) {
      const files = fs.readdirSync(dir);
      for (const file of files) {
        const fullPath = path.join(dir, file);
        try {
          if (fs.statSync(fullPath).isDirectory()) {
            cleanDir(fullPath);
            fs.rmdirSync(fullPath);
          } else {
            fs.unlinkSync(fullPath);
          }
        } catch (_) {}
      }
    }
  }

  cleanDir(chunksDir);
  cleanDir(uploadsDir);
  console.log('   ✅ Temporary uploads and chunks cleaned!');

  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('🎉 ALL DATA AND CLOUDFLARE R2 BUCKET RESET TO FRESH STATE (0 USERS, 0 FILES)!');
  console.log('═══════════════════════════════════════════════════════════════');
}

cleanAllDataAndR2().catch(console.error);
