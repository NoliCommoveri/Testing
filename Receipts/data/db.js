// db.js — the only Dexie schema definition for the Receipts app. Local-first,
// same posture as KennelOS: all data lives in the browser (IndexedDB), no
// backend, works offline.
//
// Two tables:
//  - `entries`: one row per captured cost (a receipt or a trip/mileage log). The
//    money data that will be exported to KennelOS's Expense ledger, plus a
//    pointer to its stored photo.
//  - `photos`: the actual image, kept as a Blob (efficient) with a small
//    downscaled thumbnail data-URL for fast list rendering. Photos live ONLY
//    here — KennelOS stores no images, so the picture is this app's job to keep.
//
// ids are client-side UUIDs (crypto.randomUUID), like KennelOS. Dates are
// YYYY-MM-DD strings; created_at/updated_at are full ISO.
import Dexie from '../vendor/dexie.min.mjs';

export const db = new Dexie('ReceiptsApp');

db.version(1).stores({
  // Indexed fields only; every other field still persists.
  entries: 'id, kind, entry_date, category, subject_type, exported_at, is_archived',
  photos: 'id, created_at'
});

export default db;
