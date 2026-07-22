// backup.js — full data-loss-protection export/import: every entry AND every
// photo's original bytes, bundled into one .zip you save off-device (cloud
// folder, another computer). Unlike the KennelOS CSV export (numbers only) or
// Photos → PDF (flattened, not re-importable), this round-trips exactly.
//
// Archive layout:
//   manifest.json   { app, version, created_at, entry_count, photo_count }
//   entries.json    every entries row, as stored (includes archived)
//   photos.json     photo metadata (id, mime, created_at, thumbnail) — the
//                   thumbnail rides along as its own data-URL string so a
//                   restore doesn't need to regenerate it via canvas
//   settings.json   the small localStorage prefs (kennel name, mileage rate,
//                   receipt-number counter, businesses/categories/vehicles/drivers)
//   photos/<id>.ext raw image bytes, one file per photo
//
// Restore is additive: entries and photos are upserted by id (never deletes
// anything not in the archive), so it's safe to restore onto a fresh device
// OR re-run onto an existing one without duplicating anything.
import { entryRepo } from './entryRepo.js';
import { photoRepo } from './photoRepo.js';
import { createZip, readZip } from './zip.js';
import {
  getKennelName, setKennelName, getMileageRate, setMileageRate,
  getBusinesses, addBusiness, getCustomCategories, addCustomCategory,
  getVehicles, addVehicle, getDrivers, addDriver,
  setLastBackupDate, getLastBackupDate
} from './settings.js';

const APP_TAG = 'receipts-backup';
const FORMAT_VERSION = 1;

const MIME_EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' };
function extFor(mime) { return MIME_EXT[mime] || 'bin'; }

function settingsSnapshot() {
  return {
    kennelName: getKennelName(),
    mileageRate: getMileageRate(),
    seq: Number(localStorage.getItem('receipts.seq') || '0'),
    businesses: getBusinesses(),
    customCategories: getCustomCategories(),
    vehicles: getVehicles(),
    drivers: getDrivers()
  };
}

// Builds the archive and returns { blob, entryCount, photoCount }. Does not
// trigger the download itself — see downloadBackup().
export async function buildBackup() {
  const entries = await entryRepo.getAll({ includeArchived: true });
  const photos = await photoRepo.getAll();
  const encoder = new TextEncoder();

  const manifest = {
    app: APP_TAG,
    version: FORMAT_VERSION,
    created_at: new Date().toISOString(),
    entry_count: entries.length,
    photo_count: photos.length
  };

  const photoMeta = [];
  const files = [
    { name: 'manifest.json', data: encoder.encode(JSON.stringify(manifest, null, 2)) },
    { name: 'entries.json', data: encoder.encode(JSON.stringify(entries, null, 2)) },
    { name: 'settings.json', data: encoder.encode(JSON.stringify(settingsSnapshot(), null, 2)) }
  ];

  for (const p of photos) {
    photoMeta.push({ id: p.id, mime: p.mime, created_at: p.created_at, thumbnail: p.thumbnail || '' });
    const bytes = new Uint8Array(await p.blob.arrayBuffer());
    files.push({ name: `photos/${p.id}.${extFor(p.mime)}`, data: bytes });
  }
  files.splice(3, 0, { name: 'photos.json', data: encoder.encode(JSON.stringify(photoMeta, null, 2)) });

  const blob = createZip(files);
  return { blob, entryCount: entries.length, photoCount: photos.length };
}

export function downloadBlob(filename, blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function stamp(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
}

// Builds, downloads, and records the backup timestamp. Returns the counts for
// a confirmation toast.
export async function downloadBackup() {
  const { blob, entryCount, photoCount } = await buildBackup();
  downloadBlob(`receipts-backup-${stamp()}.zip`, blob);
  setLastBackupDate();
  return { entryCount, photoCount };
}

// Parses a backup file without writing anything, so the caller can confirm
// with the user before committing. Throws with a user-legible message on any
// malformed / unrecognized file.
export async function inspectBackup(file) {
  const parts = await readZip(file);
  const byName = new Map(parts.map((p) => [p.name, p]));
  const manifestPart = byName.get('manifest.json');
  const entriesPart = byName.get('entries.json');
  if (!manifestPart || !entriesPart) throw new Error('That file isn’t a Receipts backup.');

  const decoder = new TextDecoder();
  let manifest;
  try { manifest = JSON.parse(decoder.decode(manifestPart.data)); } catch { throw new Error('That file isn’t a Receipts backup.'); }
  if (manifest.app !== APP_TAG) throw new Error('That file isn’t a Receipts backup.');

  const entries = JSON.parse(decoder.decode(entriesPart.data));
  const photoMetaPart = byName.get('photos.json');
  const photoMeta = photoMetaPart ? JSON.parse(decoder.decode(photoMetaPart.data)) : [];
  const settingsPart = byName.get('settings.json');
  const settings = settingsPart ? JSON.parse(decoder.decode(settingsPart.data)) : null;

  return { manifest, entries, photoMeta, settings, parts: byName };
}

// Writes an inspected backup into the DB (upsert by id) and merges settings
// lists. Returns counts actually written.
export async function restoreBackup({ entries, photoMeta, settings, parts }) {
  for (const row of entries) await entryRepo.putRaw(row);

  let photosWritten = 0;
  for (const meta of photoMeta) {
    const file = parts.get(`photos/${meta.id}.${extFor(meta.mime)}`);
    if (!file) continue;
    const blob = new Blob([file.data], { type: meta.mime || 'application/octet-stream' });
    await photoRepo.putRaw({ id: meta.id, blob, mime: meta.mime, thumbnail: meta.thumbnail || '', created_at: meta.created_at });
    photosWritten++;
  }

  if (settings) {
    if (settings.kennelName && !getKennelName()) setKennelName(settings.kennelName);
    if (settings.mileageRate) setMileageRate(settings.mileageRate);
    (settings.businesses || []).forEach(addBusiness);
    (settings.customCategories || []).forEach(addCustomCategory);
    (settings.vehicles || []).forEach(addVehicle);
    (settings.drivers || []).forEach(addDriver);
    const curSeq = Number(localStorage.getItem('receipts.seq') || '0');
    if (settings.seq > curSeq) localStorage.setItem('receipts.seq', String(settings.seq));
  }

  return { entryCount: entries.length, photoCount: photosWritten };
}

// "3 days ago" / "today" / "never" — for the label next to the backup button.
export function lastBackupLabel() {
  const iso = getLastBackupDate();
  if (!iso) return 'Never backed up';
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
  if (days <= 0) return 'Last backup: today';
  if (days === 1) return 'Last backup: yesterday';
  return `Last backup: ${days} days ago`;
}
