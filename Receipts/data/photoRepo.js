// photoRepo.js — stores captured images. An image is kept as a Blob in IndexedDB
// (compact, no base64 bloat) alongside a small thumbnail data-URL used for list
// rendering. The original Blob is served back as an object URL on demand (full
// view / re-download).
import { db } from './db.js';

const THUMB_MAX = 320; // px, longest edge

// Downscale an image File/Blob to a JPEG thumbnail data-URL via a canvas.
async function makeThumbnail(fileOrBlob) {
  const bitmap = await createImageBitmap(fileOrBlob);
  const scale = Math.min(1, THUMB_MAX / Math.max(bitmap.width, bitmap.height));
  const w = Math.round(bitmap.width * scale);
  const h = Math.round(bitmap.height * scale);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close?.();
  return canvas.toDataURL('image/jpeg', 0.7);
}

export const photoRepo = {
  // Store a captured image; returns the new photo id.
  async create(fileOrBlob) {
    const id = crypto.randomUUID();
    let thumbnail = '';
    try { thumbnail = await makeThumbnail(fileOrBlob); } catch { thumbnail = ''; }
    await db.photos.put({
      id,
      blob: fileOrBlob,
      mime: fileOrBlob.type || 'image/jpeg',
      thumbnail,
      created_at: new Date().toISOString()
    });
    return id;
  },

  async get(id) {
    if (!id) return null;
    return (await db.photos.get(id)) || null;
  },

  async getThumbnail(id) {
    const p = await photoRepo.get(id);
    return p?.thumbnail || '';
  },

  // A fresh object URL for the full image. Caller must revokeObjectURL when done.
  async getObjectUrl(id) {
    const p = await photoRepo.get(id);
    if (!p?.blob) return '';
    return URL.createObjectURL(p.blob);
  },

  async remove(id) {
    if (id) await db.photos.delete(id);
  },

  // Every photo row, for backup export. Includes the Blob — caller streams it
  // into the archive rather than holding many in memory at once where it can.
  async getAll() {
    return db.photos.toArray();
  },

  // Upsert a full row as-is (id, blob, mime, thumbnail, created_at) — used only
  // by backup restore, which is repopulating known-good records, not creating
  // new ones (so it skips the id/thumbnail generation in create()).
  async putRaw(record) {
    await db.photos.put(record);
  }
};
