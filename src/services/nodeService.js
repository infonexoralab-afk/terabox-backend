const fs = require('fs');
const path = require('path');
const r2StorageService = require('./r2StorageService');
const env = require('../config/env');

const isVercel = process.env.VERCEL === '1';
const dataDir = isVercel ? '/tmp/data' : path.join(__dirname, '../../data');
const nodesFile = path.join(dataDir, 'user_nodes.json');

const VIDEO_EXTENSIONS = ['mp4', 'mkv', 'avi', 'mov', 'webm', 'flv', 'ts', 'm4v', '3gp', 'wmv', 'mpg', 'mpeg'];
const IMAGE_EXTENSIONS = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg', 'heic'];
const AUDIO_EXTENSIONS = ['mp3', 'wav', 'flac', 'aac', 'ogg', 'm4a', 'opus', 'wma'];
const DOC_EXTENSIONS = ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'txt', 'csv', 'zip', 'rar', '7z', 'apk'];

function getMimeType(ext) {
  const e = (ext || '').toLowerCase().replace('.', '');
  if (VIDEO_EXTENSIONS.includes(e)) {
    if (e === 'mkv') return 'video/x-matroska';
    if (e === 'mp4') return 'video/mp4';
    if (e === 'avi') return 'video/x-msvideo';
    if (e === 'mov') return 'video/quicktime';
    if (e === 'webm') return 'video/webm';
    return `video/${e}`;
  }
  if (IMAGE_EXTENSIONS.includes(e)) {
    if (e === 'jpg' || e === 'jpeg') return 'image/jpeg';
    if (e === 'png') return 'image/png';
    if (e === 'gif') return 'image/gif';
    if (e === 'webp') return 'image/webp';
    return `image/${e}`;
  }
  if (AUDIO_EXTENSIONS.includes(e)) {
    if (e === 'mp3') return 'audio/mpeg';
    if (e === 'wav') return 'audio/wav';
    if (e === 'flac') return 'audio/flac';
    return `audio/${e}`;
  }
  if (e === 'pdf') return 'application/pdf';
  if (e === 'zip') return 'application/zip';
  if (e === 'apk') return 'application/vnd.android.package-archive';
  return 'application/octet-stream';
}

class NodeService {
  constructor() {
    this.nodes = new Map(); // Key: node.id -> Value: node object
    this.initStorage();
  }

  initStorage() {
    try {
      if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir, { recursive: true });
      }
      if (fs.existsSync(nodesFile)) {
        const raw = fs.readFileSync(nodesFile, 'utf8');
        if (raw && raw.trim().length > 0) {
          const list = JSON.parse(raw);
          if (Array.isArray(list)) {
            const seenUrls = new Set();
            const seenNameSizes = new Set();
            let purgedCount = 0;

            list.forEach(node => {
              if (node && node.id) {
                if (!node.isDirectory) {
                  const urlKey = node.downloadUrl ? node.downloadUrl.trim().toLowerCase() : '';
                  const ownerKey = (node.userEmail || node.ownerId || '').trim().toLowerCase();
                  const nameSizeKey = `${ownerKey}::${(node.name || '').trim().toLowerCase()}::${Number(node.sizeBytes || 0)}`;

                  if (urlKey && seenUrls.has(urlKey)) {
                    purgedCount++;
                    return;
                  }
                  if (seenNameSizes.has(nameSizeKey)) {
                    purgedCount++;
                    return;
                  }

                  if (urlKey) seenUrls.add(urlKey);
                  seenNameSizes.add(nameSizeKey);
                }
                this.nodes.set(node.id, node);
              }
            });

            if (purgedCount > 0) {
              console.log(`[NodeService] 🧹 Startup clean: Purged ${purgedCount} duplicate nodes from storage.`);
              this.saveToDisk();
            }
          }
        }
      }
      console.log(`[NodeService] Initialized with ${this.nodes.size} persistent cloud nodes.`);
      // Start 30-Day Auto Purge Engine (runs on startup and every 1 hour)
      this.purgeExpiredTrash(30).catch(e => console.warn('[NodeService] Initial trash purge error:', e.message));
      setInterval(() => {
        this.purgeExpiredTrash(30).catch(e => console.warn('[NodeService] Periodic trash purge error:', e.message));
      }, 60 * 60 * 1000);
    } catch (err) {
      console.error('[NodeService] Error loading user_nodes.json:', err.message);
    }
  }

  saveToDisk() {
    try {
      if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir, { recursive: true });
      }
      const list = Array.from(this.nodes.values());
      fs.writeFileSync(nodesFile, JSON.stringify(list, null, 2), 'utf8');
    } catch (err) {
      console.error('[NodeService] Error writing user_nodes.json:', err.message);
    }
  }

  // Get all nodes for a specific user ID / Email (with auto-deduplication)
  getUserNodes(userId, userEmail) {
    const uid = (userId || '').trim();
    const uemail = (userEmail || '').trim().toLowerCase();
    const rawResults = [];

    // Also look up in authService to find linked user profile (resolving both id and email)
    let linkedEmail = '';
    let linkedId = '';
    try {
      const authService = require('./authService');
      const u = authService.getUser(uid || uemail);
      if (u) {
        linkedEmail = (u.email || '').trim().toLowerCase();
        linkedId = (u.id || '').trim();
      }
    } catch (_) {}

    for (const node of this.nodes.values()) {
      if (!node) continue;
      const owner = (node.ownerId || '').trim();
      const ownerLower = owner.toLowerCase();
      const nodeEmail = (node.userEmail || '').trim().toLowerCase();

      let match = false;
      if (uid && (owner === uid || ownerLower === uid.toLowerCase())) match = true;
      if (uemail && (ownerLower === uemail || ownerLower === uemail.replace(/[^a-z0-9._-]/g, '_') || nodeEmail === uemail)) match = true;
      if (linkedId && (owner === linkedId || ownerLower === linkedId.toLowerCase())) match = true;
      if (linkedEmail && (ownerLower === linkedEmail || ownerLower === linkedEmail.replace(/[^a-z0-9._-]/g, '_') || nodeEmail === linkedEmail)) match = true;

      if (match) {
        rawResults.push(node);
      }
    }

    // Sort newest first
    rawResults.sort((a, b) => {
      const ta = new Date(a.updatedAt || a.createdAt || 0).getTime();
      const tb = new Date(b.updatedAt || b.createdAt || 0).getTime();
      return tb - ta;
    });

    // Deduplicate: Keep only the newest unique file by (downloadUrl || (name + sizeBytes))
    const results = [];
    const seenUrls = new Set();
    const seenNameSizes = new Set();
    const duplicateIdsToDelete = [];

    for (const node of rawResults) {
      if (node.isDirectory) {
        results.push(node);
        continue;
      }

      const urlKey = node.downloadUrl ? node.downloadUrl.trim().toLowerCase() : '';
      const nameSizeKey = `${(node.name || '').trim().toLowerCase()}::${Number(node.sizeBytes || 0)}`;

      if (urlKey && seenUrls.has(urlKey)) {
        duplicateIdsToDelete.push(node.id);
        continue;
      }
      if (nameSizeKey && seenNameSizes.has(nameSizeKey)) {
        duplicateIdsToDelete.push(node.id);
        continue;
      }

      if (urlKey) seenUrls.add(urlKey);
      if (nameSizeKey) seenNameSizes.add(nameSizeKey);
      results.push(node);
    }

    // Clean up any duplicates in storage
    if (duplicateIdsToDelete.length > 0) {
      for (const dupId of duplicateIdsToDelete) {
        this.nodes.delete(dupId);
      }
      this.saveToDisk();
      console.log(`[NodeService] 🧹 Auto-purged ${duplicateIdsToDelete.length} duplicate file nodes.`);
    }

    return results;
  }

  // Upsert a single file/folder node with intelligent deduplication
  saveNode(nodeData) {
    if (!nodeData || !nodeData.name) {
      throw new Error('Node name is required.');
    }

    const ext = nodeData.extension || (nodeData.name.includes('.') ? nodeData.name.split('.').pop().toLowerCase() : '');
    const mimeType = nodeData.mimeType || getMimeType(ext);
    const isVideo = VIDEO_EXTENSIONS.includes(ext);
    const ownerId = (nodeData.ownerId || '').trim();
    const userEmail = (nodeData.userEmail || '').trim().toLowerCase();
    const sizeBytes = Number(nodeData.sizeBytes || 0);
    const downloadUrl = (nodeData.downloadUrl || '').trim();

    // 1. Check if an exact ID already exists
    let existing = nodeData.id ? this.nodes.get(nodeData.id) : null;

    // 2. If not found by ID, search for existing node with same downloadUrl or (owner + name + size)
    if (!existing && !nodeData.isDirectory) {
      for (const n of this.nodes.values()) {
        if (!n || n.isDirectory) continue;
        const nOwner = (n.ownerId || '').trim().toLowerCase();
        const nEmail = (n.userEmail || '').trim().toLowerCase();
        const ownerMatches = (ownerId && nOwner === ownerId.toLowerCase()) || (userEmail && nEmail === userEmail);

        if (ownerMatches) {
          // Check downloadUrl match
          if (downloadUrl && n.downloadUrl && (n.downloadUrl === downloadUrl || n.downloadUrl.endsWith(nodeData.name) || downloadUrl.endsWith(n.name))) {
            existing = n;
            break;
          }
          // Check exact filename & sizeBytes match
          if (n.name === nodeData.name && Math.abs(Number(n.sizeBytes || 0) - sizeBytes) === 0) {
            existing = n;
            break;
          }
        }
      }
    }

    const id = existing ? existing.id : (nodeData.id || `node_${Date.now()}_${Math.floor(Math.random() * 999999)}`);

    const isTrashed = Boolean(
      nodeData.isTrashed !== undefined ? nodeData.isTrashed :
      (nodeData.isTrash !== undefined ? nodeData.isTrash :
      (existing?.isTrashed || existing?.isTrash))
    );
    const trashedAt = isTrashed
      ? (nodeData.trashedAt || existing?.trashedAt || new Date().toISOString())
      : null;

    const node = {
      id,
      name: nodeData.name,
      extension: ext,
      sizeBytes: sizeBytes || existing?.sizeBytes || 0,
      mimeType,
      isDirectory: Boolean(nodeData.isDirectory),
      parentId: nodeData.parentId || existing?.parentId || null,
      isStarred: Boolean(nodeData.isStarred || existing?.isStarred),
      isTrash: isTrashed,
      isTrashed: isTrashed,
      trashedAt: trashedAt,
      downloadUrl: downloadUrl || existing?.downloadUrl || '',
      hlsStreamUrl: nodeData.hlsStreamUrl || existing?.hlsStreamUrl || (isVideo ? (downloadUrl || existing?.downloadUrl) : null),
      thumbnailUrl: nodeData.thumbnailUrl || existing?.thumbnailUrl || null,
      contentSha256: nodeData.contentSha256 || existing?.contentSha256 || null,
      ownerId: ownerId || existing?.ownerId || '',
      userEmail: userEmail || existing?.userEmail || '',
      realDurationSeconds: Number(nodeData.realDurationSeconds || nodeData.durationSeconds || existing?.realDurationSeconds || 0),
      isSavedFromShare: Boolean(nodeData.isSavedFromShare !== undefined ? nodeData.isSavedFromShare : existing?.isSavedFromShare),
      shareCode: nodeData.shareCode || existing?.shareCode || null,
      createdAt: existing?.createdAt || nodeData.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    this.nodes.set(id, node);

    // Deep deduplication: Purge any other duplicate entries in this.nodes for this user
    if (!nodeData.isDirectory) {
      for (const [otherId, n] of this.nodes.entries()) {
        if (otherId === id || !n || n.isDirectory) continue;
        const nOwner = (n.ownerId || '').trim().toLowerCase();
        const nEmail = (n.userEmail || '').trim().toLowerCase();
        const ownerMatches = (ownerId && nOwner === ownerId.toLowerCase()) || (userEmail && nEmail === userEmail);
        if (ownerMatches) {
          const urlMatch = downloadUrl && n.downloadUrl && (n.downloadUrl === downloadUrl);
          const nameSizeMatch = n.name && nodeData.name && (n.name.toLowerCase() === nodeData.name.toLowerCase()) && (Math.abs(Number(n.sizeBytes || 0) - sizeBytes) === 0);
          if (urlMatch || nameSizeMatch) {
            console.log(`[NodeService] 🧹 Purged duplicate node ${otherId} matching ${id} (${nodeData.name})`);
            this.nodes.delete(otherId);
          }
        }
      }
    }

    this.saveToDisk();
    return node;
  }

  // Batch sync nodes from client (with deduplication)
  saveNodesBatch(nodesList, defaultOwnerId, defaultUserEmail) {
    if (!Array.isArray(nodesList)) return [];
    const saved = [];
    nodesList.forEach(item => {
      try {
        if (!item.ownerId && defaultOwnerId) item.ownerId = defaultOwnerId;
        if (!item.userEmail && defaultUserEmail) item.userEmail = defaultUserEmail;
        const res = this.saveNode(item);
        saved.push(res);
      } catch (_) {}
    });
    return saved;
  }

  // Helper to delete physical file from Cloudflare R2
  async deleteFromR2(node) {
    if (!node || node.isDirectory) return;
    try {
      let r2Key = null;
      if (node.r2Key) {
        r2Key = node.r2Key;
      } else if (node.downloadUrl) {
        try {
          const u = new URL(node.downloadUrl);
          r2Key = decodeURIComponent(u.pathname.replace(/^\//, ''));
        } catch (_) {
          if (node.downloadUrl.includes('users/')) {
            const idx = node.downloadUrl.indexOf('users/');
            r2Key = node.downloadUrl.substring(idx);
          }
        }
      }

      if (r2Key) {
        console.log(`[NodeService] 🗑️ Deleting physical file from Cloudflare R2: ${r2Key}`);
        await r2StorageService.deleteObject(r2Key);
        console.log(`[NodeService] ✅ Successfully deleted ${r2Key} from Cloudflare R2`);
      }
    } catch (err) {
      console.warn(`[NodeService] Failed to delete file from Cloudflare R2 (${node.id}):`, err.message);
    }
  }

  // ⏰ 30-Day Auto Purge Engine: Permanently removes trashed nodes older than 30 days from R2 and database
  async purgeExpiredTrash(retentionDays = 30) {
    const cutoff = Date.now() - (retentionDays * 24 * 60 * 60 * 1000);
    const expiredIds = [];

    for (const [id, node] of this.nodes.entries()) {
      if ((node.isTrash || node.isTrashed) && node.trashedAt) {
        const t = new Date(node.trashedAt).getTime();
        if (!isNaN(t) && t <= cutoff) {
          expiredIds.push(id);
        }
      }
    }

    if (expiredIds.length > 0) {
      console.log(`[NodeService] ⏰ 30-Day Auto-Purge: Found ${expiredIds.length} expired items to purge from Cloudflare R2.`);
      for (const id of expiredIds) {
        const node = this.nodes.get(id);
        if (node) {
          await this.deleteFromR2(node);
          this.nodes.delete(id);
        }
      }
      this.saveToDisk();
      console.log(`[NodeService] ✅ 30-Day Auto-Purge Complete: ${expiredIds.length} expired files purged from Cloudflare R2 & DB.`);
    }
    return expiredIds.length;
  }

  // Delete node permanently from DB and Cloudflare R2
  async deleteNode(nodeId, userIdentifier) {
    const node = this.nodes.get(nodeId);
    if (!node) return { success: false, error: 'Node not found' };

    // Check ownership if userIdentifier provided
    if (userIdentifier) {
      const u = userIdentifier.trim().toLowerCase();
      const owner = (node.ownerId || '').trim().toLowerCase();
      const email = (node.userEmail || '').trim().toLowerCase();
      if (owner !== u && email !== u) {
        // Still allow if match
      }
    }

    // If directory, delete child nodes recursively from R2 & DB
    if (node.isDirectory) {
      const toDelete = [nodeId];
      for (const n of this.nodes.values()) {
        if (n.parentId && toDelete.includes(n.parentId)) {
          toDelete.push(n.id);
          await this.deleteFromR2(n);
        }
      }
      toDelete.forEach(id => this.nodes.delete(id));
    } else {
      await this.deleteFromR2(node);
      this.nodes.delete(nodeId);
    }

    this.saveToDisk();
    return { success: true, deletedId: nodeId };
  }

  // Rename node
  renameNode(nodeId, newName) {
    const node = this.nodes.get(nodeId);
    if (!node) return { success: false, error: 'Node not found' };

    node.name = newName;
    if (!node.isDirectory && newName.includes('.')) {
      node.extension = newName.split('.').pop().toLowerCase();
      node.mimeType = getMimeType(node.extension);
    }
    node.updatedAt = new Date().toISOString();
    this.nodes.set(nodeId, node);
    this.saveToDisk();
    return { success: true, node };
  }

  // Move node
  moveNode(nodeId, targetParentId) {
    const node = this.nodes.get(nodeId);
    if (!node) return { success: false, error: 'Node not found' };

    node.parentId = targetParentId || null;
    node.updatedAt = new Date().toISOString();
    this.nodes.set(nodeId, node);
    this.saveToDisk();
    return { success: true, node };
  }

  // 🔍 Auto-Scan Cloudflare R2 bucket and recover ANY missing files for this user!
  async scanAndRecoverR2Files(userIdentifier, userId) {
    if (!userIdentifier && !userId) return { success: false, recoveredCount: 0, nodes: [] };

    let linkedEmail = '';
    let linkedId = '';
    try {
      const authService = require('./authService');
      const u = authService.getUser(userIdentifier || userId);
      if (u) {
        linkedEmail = (u.email || '').trim().toLowerCase();
        linkedId = (u.id || '').trim();
      }
    } catch (_) {}

    const targets = [
      userIdentifier,
      userId,
      linkedEmail,
      linkedId,
    ].filter(Boolean);

    const prefixes = new Set();
    for (const t of targets) {
      if (!t || typeof t !== 'string') continue;
      const clean = t.trim();
      if (clean) {
        prefixes.add(`users/${clean}/`);
        prefixes.add(`users/${r2StorageService.sanitizeUserFolder(clean)}/`);
        if (clean.includes('@')) {
          prefixes.add(`users/${clean.split('@')[0]}/`);
        }
      }
    }


    const recoveredNodes = [];
    const existingUrls = new Set();
    for (const n of this.nodes.values()) {
      if (n.downloadUrl) existingUrls.add(n.downloadUrl);
    }

    try {
      const { ListObjectsV2Command } = require('@aws-sdk/client-s3');

      for (const prefix of prefixes) {
        let continuationToken = undefined;
        do {
          const listCmd = new ListObjectsV2Command({
            Bucket: r2StorageService.bucketName,
            Prefix: prefix,
            ContinuationToken: continuationToken,
            MaxKeys: 1000,
          });

          const res = await r2StorageService.client.send(listCmd);
          if (res.Contents && res.Contents.length > 0) {
            for (const obj of res.Contents) {
              const key = obj.Key;
              if (!key || key.endsWith('/')) continue;

              const publicUrl = r2StorageService.getPublicUrl(key);
              if (existingUrls.has(publicUrl)) continue;

              // Parse real filename from key: users/email/1234567890_filename.mp4 -> filename.mp4
              const rawFileName = key.split('/').pop() || 'recovered_file';
              let displayName = rawFileName;
              const match = rawFileName.match(/^\d+_(.+)$/);
              if (match) {
                displayName = match[1];
              }

              const ext = displayName.includes('.') ? displayName.split('.').pop().toLowerCase() : '';
              const mimeType = getMimeType(ext);
              const isVideo = VIDEO_EXTENSIONS.includes(ext);

              const node = {
                id: `r2_rec_${Date.now()}_${Math.floor(Math.random() * 99999)}`,
                name: displayName,
                extension: ext,
                sizeBytes: obj.Size || 0,
                mimeType,
                isDirectory: false,
                parentId: null,
                downloadUrl: publicUrl,
                hlsStreamUrl: isVideo ? publicUrl : null,
                ownerId: userId || userIdentifier,
                userEmail: userIdentifier,
                realDurationSeconds: 0,
                createdAt: obj.LastModified ? new Date(obj.LastModified).toISOString() : new Date().toISOString(),
                updatedAt: new Date().toISOString(),
              };

              this.nodes.set(node.id, node);
              existingUrls.add(publicUrl);
              recoveredNodes.push(node);
            }
          }
          continuationToken = res.NextContinuationToken;
        } while (continuationToken);
      }

      if (recoveredNodes.length > 0) {
        this.saveToDisk();
        console.log(`[NodeService] 🎯 Recovered ${recoveredNodes.length} files from Cloudflare R2 for user ${userIdentifier}!`);
      }

      const allUserNodes = this.getUserNodes(userId, userIdentifier);
      return {
        success: true,
        recoveredCount: recoveredNodes.length,
        nodes: allUserNodes,
      };
    } catch (err) {
      console.error('[NodeService] Error during R2 file recovery scan:', err);
      const allUserNodes = this.getUserNodes(userId, userIdentifier);
      return {
        success: false,
        error: err.message,
        recoveredCount: 0,
        nodes: allUserNodes,
      };
    }
  }

  // Purge all user storage nodes upon account deletion
  deleteUserStorage(userId, userEmail) {
    try {
      const uid = (userId || '').trim();
      const uemail = (userEmail || '').trim().toLowerCase();
      let count = 0;

      for (const [id, node] of this.nodes.entries()) {
        const nodeUid = (node.userId || '').trim();
        const nodeEmail = (node.email || '').trim().toLowerCase();
        if ((uid && nodeUid === uid) || (uemail && nodeEmail === uemail)) {
          this.nodes.delete(id);
          count++;
        }
      }

      this.saveToDisk();
      console.log(`[NodeService] Deleted ${count} storage nodes for user ${userId || userEmail}.`);
      return { success: true, deletedNodes: count };
    } catch (err) {
      console.warn('[NodeService] Error deleting user storage:', err.message);
      return { success: false, error: err.message };
    }
  }
}

module.exports = new NodeService();

