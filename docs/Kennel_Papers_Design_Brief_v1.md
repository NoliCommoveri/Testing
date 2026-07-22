# Kennel Papers — Design Brief v1

A light, local-first companion app that holds the **actual document files** for your
KennelOS dogs — pedigrees, health-testing results, registration certificates, and
contracts — as PDFs, filed under the dog they belong to.

Status: **design only.** Nothing is built yet. This brief is the agreed shape to build
against.

---

## 1. Why it's a separate app

KennelOS **deliberately stores no attachments** (End-State guide §15 — no `attachments`
table, no photos tab; the only image it keeps is a kennel logo). Files live in browser
IndexedDB, and megabytes of PDFs would bloat every KennelOS JSON backup and its offline
cache. So the actual files belong in a **standalone companion PWA**, exactly the way the
existing **Receipts** app keeps receipt photos out of KennelOS ("The photos stay here.
KennelOS stores no images by design").

Kennel Papers is therefore a third sibling next to `KennelOS/` and `Receipts/`, sharing
their philosophy: no backend, no build step, all data in the browser, works offline,
installable as a PWA.

- **Product name:** Kennel Papers
- **Folder / PWA scope:** `KennelPapers/` (no space, matching the sibling convention)

---

## 2. What it does

- **📄 Add a document** — from an **existing PDF** *or* from **one or more photos** (iPhone
  camera / library). Photos are converted to a PDF on capture (§6), so everything in the
  vault is a PDF.
- **File it under a dog + a type** — every document is attached to a real **dog record**
  (§4) and tagged with a type: `pedigree` · `health test` · `registration` · `contract` ·
  `other`, plus a few optional type-specific fields.
- **Browse by dog, then by type** — the list groups by dog; filters narrow by type, dog,
  or date. The core question it answers: *"show me everything I have on file for Willow."*
- **View / download** — open a document inline (browser-native PDF view) or download the
  original bytes.
- **📦 Dog document pack** — bundle every file for one dog into a single `.zip` to hand a
  buyer or vet ("here's the puppy's full health testing + pedigree").
- **☁ Backup + auto-push to Dropbox** — one `.zip` with every record **and every file's
  original bytes**, pushed to Dropbox automatically while the app is open, plus a manual
  "Back up now" (§7).
- **↩ One-shot restore** — rebuild an entire device from the newest Dropbox backup (§8).

### Lighter than Receipts

Receipts vendors ~7 MB of Tesseract OCR. Kennel Papers needs **none** — no OCR, no text
extraction. Its only vendored dependency is Dexie. PDF viewing is browser-native, and
photo→PDF is a ~100-line vanilla module (§6).

---

## 3. Relationship to KennelOS — aligned by `dog id`

Kennel Papers does **not** write anything back to KennelOS, and there is no import target
in KennelOS for documents (attachments are out by design). Alignment is one-directional
and keyed on identity:

- The join key is **KennelOS's `Dog.id`** (its client-side `crypto.randomUUID`). A Kennel
  Papers dog row's primary key **is** that same id, so the two apps refer to the exact
  same dog identity.
- The id-bearing source is the **KennelOS JSON backup**. `importExport.exportAll()` writes
  `collections.dogs` as full stored rows *including `id`*. (KennelOS's CSV path matches by
  natural key and never exposes the UUID, so the JSON backup — a file you already generate
  for KennelOS's own data protection — is the correct and only source of the real id.)

This is a deliberate step up from Receipts' loose name-matching: because there is no
export/reconcile path back to KennelOS, an exact id join is the only way to keep the two
sets of dogs from drifting.

---

## 4. Data model

Three tables (the dogs+documents split mirrors Receipts' entries+photos split).

```
dogs
  id                       = KennelOS Dog.id (the join key; PK)
  call_name, registered_name, sex, breed, status,
  registration_number, microchip_id, date_of_birth   (denormalized snapshot)
  source                   'kennelos' | 'local'
  synced_at                (ISO — when last pulled from a KennelOS backup)
  is_archived

documents
  id                       (own UUID)
  dog_id                   → dogs.id   (indexed FK; reverse = documentRepo.getByDog)
  doc_type                 'pedigree' | 'health_test' | 'registration' | 'contract' | 'other'
  title
  doc_date                 (YYYY-MM-DD — issue/test date)
  issuer_or_lab            (registry, vet, or lab)
  result                   (health-test result, optional)
  registry                 (pedigree/registration, optional)
  registration_number      (optional)
  tags[]                   (optional)
  notes
  file_id                  → files.id
  created_at, updated_at, is_archived

files
  id                       (own UUID)
  blob                     (the PDF bytes; mime application/pdf)
  mime
  filename
  size
  thumbnail                (data-URL; present for photo-sourced docs, blank for uploaded PDFs)
  created_at
```

Conventions inherited from KennelOS/Receipts: ids are client-side UUIDs; dates are
`YYYY-MM-DD` strings; `created_at`/`updated_at` are full ISO; soft delete via
`is_archived`; only indexed fields are listed in the Dexie schema string, everything else
still persists and rides the backup.

### Referential integrity (light)

- Archiving a dog hides it but keeps its documents.
- **Hard-deleting a dog is blocked while any document references it** (archive instead) —
  the same posture as KennelOS's reference guard, kept minimal for two tables.

---

## 5. Dog sync — "Import / Sync dogs from KennelOS"

Manual, on demand, and non-destructive. Mirrors KennelOS's own dry-run import discipline.

1. **Pick** your KennelOS backup `.json` → the app reads `collections.dogs`.
2. **Dry-run preview**, no writes yet:
   - *new* (id not in Kennel Papers),
   - *updated* (id present; snapshot fields changed),
   - *unchanged*,
   - *in Kennel Papers but not in this file* (a dog you archived/deleted in KennelOS) —
     shown so you can archive it here if you want, never auto-removed.
3. **Commit** → **upsert by id**. Never deletes a dog that has documents attached.

KennelOS stays the source of truth for dog identity; Kennel Papers holds a denormalized
snapshot plus the files.

**Edge case (flagged, not solved):** a **manual-add** dog (one not yet in KennelOS) gets a
local UUID and `source:'local'`. Because the join is by id, a later sync can't auto-merge
it — you'd paste its KennelOS id to link it. That is the inherent, acceptable cost of an
id-based join.

---

## 6. Photo → PDF (vanilla, no library)

A PDF can embed a JPEG directly via the **DCTDecode** filter, so no PDF library is needed.

1. **Snap / choose photo(s)** — camera or library.
2. Each image is drawn to a `<canvas>`, **downscaled** to ~2000px on the long edge and
   exported as JPEG (~0.8 quality). This also **normalizes iPhone HEIC → JPEG**, which is
   important: raw HEIC doesn't embed cleanly and isn't universally viewable, and the
   re-encode keeps file (and Dropbox backup) size reasonable.
3. A small `data/pdfBuild.js` (catalog / pages / page / image XObject / content stream)
   wraps the JPEG bytes into a **single-page PDF**.
4. **Multiple photos → one multi-page PDF**, one page per shot — so a multi-page health
   panel or a fold-out pedigree becomes a single document.

The result is stored exactly like an uploaded PDF, so viewing, the per-dog zip pack, and
the Dropbox backup treat every document identically. Photo-sourced docs get a real list
**thumbnail** for free (the Receipts trick); PDF-uploaded docs show a doc-type icon.

---

## 7. Backup + auto-push to Dropbox

### The backup file

One `.zip` (built with the zip helper copied from Receipts), containing:

```
manifest.json    { app, version, created_at, document_count, file_count, dog_count }
dogs.json        every dogs row
documents.json   every documents row
settings.json    small localStorage prefs (Dropbox link state, doc types, etc.)
files.json       file metadata (id, mime, filename, size, thumbnail)
files/<id>.pdf   the actual bytes, one per file
```

This is the **only real data-loss protection** — the whole value of the app is the files
themselves.

### Dropbox integration (chosen: works on iPhone)

- **PKCE OAuth** (no client secret — correct for a static app). You tap **Connect
  Dropbox** once; a refresh token (`token_access_type=offline`) is stored on-device so it
  reconnects silently thereafter.
- **App-folder scope** — Kennel Papers only ever sees its own `/Apps/Kennel Papers` folder
  and cannot touch the rest of your Dropbox. Backups appear there in the Dropbox iOS app.
- **REST via `fetch()`** — Dropbox's API sends CORS headers, so uploads go straight to
  `content.dropboxapi.com`. **No SDK, no CDN dependency** — the no-CDN architecture rule
  stays intact.
- **No fiscal cost** — free API, free app registration (one public client id), backups
  count against your existing free Dropbox quota.

### When it pushes

- **Automatically after you add a document**, and on a timer / on open — **while the app is
  foregrounded.** iOS Safari gives web apps no reliable background sync, so Kennel Papers
  **cannot** upload while closed. In normal use this means your files are safe seconds
  after you file them.
- A manual **Back up now** button.
- A visible **"Last backup: N ago"** indicator (like Receipts) so you're never guessing.

The **while-open** limitation is the one deliberate departure worth stating: true
background upload is only possible from a native app or from Option C (the OS Dropbox app
watching a synced folder), both of which we set aside. Offline operation is otherwise
fully preserved; only the Dropbox push needs the network, which is acceptable here.

---

## 8. Device-loss recovery — restore everything at once

On a new device: open Kennel Papers → **Connect Dropbox** → **Restore from Dropbox** →
it fetches the **newest** backup from `/Apps/Kennel Papers` and repopulates, in one
operation:

- every **document** record,
- every **file's original bytes** (the real pedigree/health PDFs and photo-converted PDFs),
- the **dog table** (so the KennelOS-id links survive), and
- **settings**.

Restore is **upsert-by-id and non-destructive** — safe on a fresh device and safe to
re-run without duplicating. A **Restore from file** fallback (pick any saved `.zip`)
covers the case where Dropbox isn't connected yet.

**The honest limit:** recovery is complete only up to your **last successful push**, which
— because iOS can't push in the background — is the last time the app was open. Auto-push
firing *on add* keeps that window down to seconds in normal use.

---

## 9. File layout (clone of Receipts, minus OCR, plus PDF build + dog sync)

```
KennelPapers/
  index.html          list + add/edit/view/settings modals
  app.js              controller (pages → repos, never db.* directly)
  sw.js               offline app-shell precache (cache-first; bump CACHE_NAME on change)
  manifest.json       PWA manifest ("Kennel Papers")
  data/
    db.js             Dexie schema — dogs + documents + files
    dogRepo.js        CRUD for dog rows
    dogImport.js      read KennelOS JSON backup → dry-run → non-destructive upsert (§5)
    documentRepo.js   CRUD for document rows (getByDog reverse query)
    fileRepo.js       blob storage (the archive) — analog of Receipts' photoRepo
    pdfBuild.js       image(s) → PDF (DCTDecode, vanilla) (§6)
    settings.js       localStorage prefs (Dropbox link state, doc types, last backup)
    dropbox.js        PKCE OAuth + fetch-based upload/list/download (§7)
    zip.js            backup + dog-pack zipping (copied from Receipts)
    backup.js         full .zip backup / restore (§7–8)
  assets/  app.css, ui.js, icons/
  vendor/  dexie.min.mjs
```

No OCR/Tesseract; no CDN deps; the only vendored library is Dexie.

---

## 10. Architecture posture

Inherited non-negotiables (from KennelOS/Receipts): multi-file static app, ES modules over
HTTP, pages → repos → Dexie (pages never touch `db.*` or `localStorage` directly), no
build step, works offline, escape every user value in hand-built HTML, and — the
most-forgotten step — **bump `CACHE_NAME` and update `PRECACHE_URLS` in `sw.js` whenever an
app file is added/renamed/removed/edited.**

The **one departure**, accepted explicitly: the Dropbox push needs the network at push
time. Everything else (capture, view, file, per-dog pack, local backup/restore) works fully
offline.

---

## 11. Deliberately NOT built (keeping it light)

- No OCR / text extraction / auto-fill.
- No PDF *merge* of already-PDF documents into one combined file (photos→one multi-page PDF
  is supported; merging existing PDFs would need a heavier lib). Can be added later.
- No PDF editing, e-signing, or annotation.
- No write-back into KennelOS.
- No true background upload (iOS limitation, §7).

---

## 12. Open items to confirm at build time

- **Installed-PWA OAuth redirect on iOS** is smoothest when the one-time Connect happens in
  a Safari tab; installed-to-home-screen redirect handling is fiddlier but doable, and the
  refresh token means it's rare.
- Exact **doc-type field sets** (which optional fields show per type) can be tuned once the
  forms exist.
- Whether the dog list picker should offer a quick **"＋ add local dog"** inline (as in
  Receipts' contact picker) or steer entirely through KennelOS sync.
```
