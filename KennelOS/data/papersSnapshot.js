// papersSnapshot.js — the read/map layer behind the Documents viewer
// (pages/documents.js). Pulls the newest Kennel Papers backup .zip from its
// Dropbox app folder (via data/papersDropbox.js), unzips it IN MEMORY (via
// data/zip.js), and hands the page plain metadata to render. Viewing a document
// slices its PDF bytes out of the same in-memory parts.
//
// Deliberately NO IndexedDB / no repo / no new table: KennelOS keeps no document
// store (End-State guide §15). The file bytes live only in the module-level
// `loadedParts` for the current session and are turned into throwaway object
// URLs on demand. The only thing persisted is a small TEXT-ONLY metadata cache
// (settings.js, localStorage) so the grouped list still renders offline with
// per-type icons — never any file bytes or thumbnails.
//
// The Kennel Papers backup layout we read (see KennelPapers/data/backup.js):
//   manifest.json   { app:'kennel-papers-backup', ... }   ← identity check
//   dogs.json       Kennel Papers dog rows (id == KennelOS Dog.id)
//   documents.json  document rows (dog_id, doc_type, title, doc_date, …, file_id)
//   files.json      file metadata (id, mime, filename, size, thumbnail, …)
//   files/<id>.pdf  the actual bytes (sliced on demand, never persisted)
//   settings.json   IGNORED — it carries the Kennel Papers Dropbox refresh token.
import { listBackups, downloadZip } from './papersDropbox.js';
import { readZip } from './zip.js';
import { getPapersSnapshotCache, setPapersSnapshotCache } from './settings.js';

const KP_BACKUP_TAG = 'kennel-papers-backup';

// Kennel Papers' five fixed document types (its vocab.js), mirrored here for
// labels / badge tones / list icons. KennelOS has no doc-type vocab of its own
// because it stores no documents — this is display-only for the viewer.
export const DOC_TYPES = [
  { value: 'pedigree',     label: 'Pedigree',     badge: 'badge-purple', icon: '📜' },
  { value: 'health_test',  label: 'Health test',  badge: 'badge-green',  icon: '🧬' },
  { value: 'registration', label: 'Registration', badge: 'badge-blue',   icon: '🏷️' },
  { value: 'contract',     label: 'Contract',     badge: 'badge-amber',  icon: '📝' },
  { value: 'other',        label: 'Other',        badge: 'badge-neutral', icon: '📄' }
];

export function docTypeDescriptor(value) {
  return DOC_TYPES.find((t) => t.value === value)
    || { value, label: value || 'Document', badge: 'badge-gray', icon: '📄' };
}

// In-memory zip parts for THIS session only (name → Uint8Array). Set by
// pullSnapshot(); consulted by openFileBlob(). Never persisted.
let loadedParts = null;
let loadedFileMeta = null;

const decoder = new TextDecoder();
function parseJsonPart(parts, name, { required = true } = {}) {
  const part = parts.get(name);
  if (!part) {
    if (required) throw new Error('That file isn’t a Kennel Papers backup.');
    return null;
  }
  try { return JSON.parse(decoder.decode(part.data)); }
  catch { throw new Error(`The ${name} inside the Kennel Papers backup is not valid JSON.`); }
}

// Download + unzip the newest backup, build the (text) view metadata, cache it,
// and keep the file bytes in memory for openFileBlob(). Returns the snapshot
// shape below, or null when no backup has ever been pushed.
export async function pullSnapshot() {
  const backups = await listBackups();
  if (!backups.length) return null;

  const blob = await downloadZip(backups[0].path_lower || backups[0].path_display);
  const entries = await readZip(blob);
  const parts = new Map(entries.map((e) => [e.name, e]));

  const manifest = parseJsonPart(parts, 'manifest.json');
  if (!manifest || manifest.app !== KP_BACKUP_TAG) {
    throw new Error('That file isn’t a Kennel Papers backup.');
  }
  const dogs = parseJsonPart(parts, 'dogs.json');
  const documents = parseJsonPart(parts, 'documents.json');
  const fileMeta = parseJsonPart(parts, 'files.json', { required: false }) || [];

  // Text-only metadata for the offline cache and the download-filename lookup —
  // strip thumbnails / anything byte-heavy.
  const leanDogs = (dogs || []).map((d) => ({
    id: d.id, call_name: d.call_name, registered_name: d.registered_name,
    source: d.source, is_archived: !!d.is_archived
  }));
  const leanFileMeta = (fileMeta || []).map((f) => ({
    id: f.id, filename: f.filename, mime: f.mime
  }));

  loadedParts = parts;
  loadedFileMeta = new Map(leanFileMeta.map((f) => [f.id, f]));

  const cachedAt = new Date().toISOString();
  const snapshot = { cachedAt, documents: documents || [], papersDogs: leanDogs, fileMeta: leanFileMeta };
  setPapersSnapshotCache(snapshot);
  return snapshot;
}

// The last cached snapshot (text metadata only) — lets the list render offline
// or instantly on open. File bytes are NOT part of it (see hasFilesLoaded()).
export function getCachedSnapshot() {
  return getPapersSnapshotCache();
}

// True when a pullSnapshot() this session left file bytes in memory, so a
// document can actually be opened. False after a cold load (cache only).
export function hasFilesLoaded() {
  return loadedParts != null;
}

// A throwaway Blob for one document's PDF, sliced from the in-memory zip. The
// caller owns the object URL it creates and must revoke it. Throws (rather than
// silently failing) when the files aren't loaded this session.
export function openFileBlob(fileId) {
  if (!loadedParts) {
    throw new Error('The document files aren’t loaded — tap Refresh to pull them from Dropbox first.');
  }
  const part = loadedParts.get(`files/${fileId}.pdf`);
  if (!part) throw new Error('That document’s file wasn’t in the latest Kennel Papers backup.');
  const mime = (loadedFileMeta && loadedFileMeta.get(fileId)?.mime) || 'application/pdf';
  return new Blob([part.data], { type: mime });
}

// A safe download filename for a document, preferring the stored filename.
export function fileNameFor(fileId, fallbackTitle) {
  const meta = loadedFileMeta && loadedFileMeta.get(fileId);
  if (meta && meta.filename) return meta.filename;
  const base = (fallbackTitle || 'document').replace(/[\\/:*?"<>|]+/g, '_').trim() || 'document';
  return base.toLowerCase().endsWith('.pdf') ? base : `${base}.pdf`;
}
