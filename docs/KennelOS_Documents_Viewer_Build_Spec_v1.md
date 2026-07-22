# KennelOS Documents Viewer — Build Spec v1

A read-only **Documents** view inside KennelOS that connects to the *Kennel Papers*
Dropbox app folder, pulls the newest Kennel Papers backup, and shows each dog's document
files (pedigrees, health tests, registrations, contracts) — viewable and downloadable —
without leaving KennelOS. ("Option A" from the integration discussion.)

Status: **built** as of this spec. See the module map below for the files.

---

## 1. Goal & scope

**In scope:** list Kennel Papers documents grouped by dog, filter by type/dog/text, view a
PDF inline, download a PDF, and jump from a KennelOS dog page straight to that dog's papers.

**Out of scope (by design):** no editing, uploading, adding, or deleting documents from
KennelOS — that stays in Kennel Papers. **No document store is added to KennelOS's
database.** This is a viewer, not a second copy of the vault.

## 2. How this honors the "KennelOS stores no documents" rule

KennelOS deliberately keeps no attachments table (End-State guide §15). This feature keeps
that intact:

- **No new Dexie table, entity, repo, or FK.** `data/db.js` and
  `data/referenceRegistry.js` are untouched. Nothing to migrate, nothing to reset.
- Document **bytes never enter IndexedDB.** The whole Kennel Papers backup `.zip` is
  downloaded and unzipped **into memory** on Refresh; viewing/downloading a PDF slices the
  already-in-memory bytes into a `Blob` → `URL.createObjectURL`, revoked when the viewer
  closes. Nothing is persisted.
- The only thing persisted is a small **text-only metadata cache** (§6) — dogs/documents
  rows minus any file bytes or thumbnails — so the grouped list still renders instantly and
  offline. It is a disposable cache, clearly not the source of truth. Kennel Papers remains
  the sole owner of documents.

Because both apps key dogs by the **same `id`**, every Kennel Papers `document.dog_id` maps
directly onto a KennelOS `Dog.id` — no fuzzy matching.

## 3. Data flow

```
Kennel Papers app ──(auto-push on add)──► /Apps/Kennel Papers/kennel-papers-backup-<stamp>.zip
                                                    │
KennelOS "Documents" page ──(2nd Dropbox login, read-only)──┘
   1. list_folder  → newest kennel-papers-backup-*.zip (by server_modified)
   2. files/download → the whole zip as a Blob
   3. readZip → dogs.json + documents.json + files.json (+ files/<id>.pdf bytes, in memory)
   4. join document.dog_id → KennelOS Dog.id, render grouped by dog
   5. open a doc → slice files/<id>.pdf from the in-memory parts → objectURL → <embed>
```

The full zip (all PDFs) is downloaded on Refresh — the same "pull everything" posture as
Kennel Papers' own restore. Viewing a document therefore needs no extra network call; it is
an in-memory slice.

## 4. The second Dropbox connection

KennelOS's existing Dropbox connection (`data/dropbox.js`, app key `d4fna4tzs2qbcva`) is
**App-folder scoped to `/Apps/KennelOS/`** and physically cannot read the Kennel Papers
folder. So Documents uses its **own** connection with the **Kennel Papers app key**
(`fvmtvesy1u1l0xf`, scoped to `/Apps/Kennel Papers/`).

- **`data/papersDropbox.js`** is a second, independent PKCE client with its own settings
  namespace (`kennelOS.papersDropbox`), so it never collides with KennelOS's own sync
  tokens.
- **Read-only in practice:** it requests only the `files.content.read` scope at authorize
  time and only ever calls `list_folder` + `files/download`.
- The `?code=` redirect is handled **only** on the Documents page (`documents.js`'s boot),
  and KennelOS's `app.js` doesn't touch Dropbox at all, so there is no collision with the
  main app's own connect flow.

**One-time developer setup:** add the deployed `…/KennelOS/pages/documents.html` URL and
`http://localhost:8000/pages/documents.html` (dev) to the **Kennel Papers** Dropbox app's
OAuth 2 → Redirect URIs. Dropbox requires an exact match. No new app, no new key, no cost.

**UX note:** the user connects Dropbox a second time here (once for KennelOS sync, once to
read Kennel Papers). Unavoidable given app-folder isolation, short of re-architecting both
apps onto one shared Dropbox app.

## 5. Module map (new / changed files)

| File | Change | Purpose |
|---|---|---|
| `KennelOS/pages/documents.html` | new | Page shell — connect card, filters, list, viewer modal. |
| `KennelOS/pages/documents.js` | new | Controller: connect/refresh, grouped render, filters, view/download. |
| `KennelOS/data/papersDropbox.js` | new | 2nd PKCE Dropbox client (Kennel Papers key): `isConnected`, `beginAuth`, `completeAuth`, `disconnect`, `getAccessToken`, `listBackups`, `downloadZip`. |
| `KennelOS/data/papersSnapshot.js` | new | Pull newest zip → readZip → parse → view model; text-only metadata cache; in-memory PDF slice. |
| `KennelOS/data/zip.js` | new | `readZip`/`createZip`, copied verbatim from `KennelPapers/data/zip.js`. Only `readZip` used. |
| `KennelOS/data/settings.js` | changed | `papersDropbox` token getters + `papersSnapshot` cache getters + KEYS. |
| `KennelOS/nav.js` | changed | "Documents" added to the More menu. |
| `KennelOS/pages/dog.html` + `dog.js` | changed | Per-dog "📄 Documents" button → `documents.html?dog=<id>`. |
| `KennelOS/sw.js` | changed | 5 new files precached + `CACHE_NAME` bumped. |

## 6. Settings & caching (`data/settings.js`)

Two new namespaces, mirroring the existing Dropbox getters:

- `getPapersDropboxSettings` / `setPapersDropboxSettings` / `clearPapersDropboxSettings`
  under `kennelOS.papersDropbox` — `refreshToken`, `accessToken`, `accessTokenExpiresAt`,
  `pkceVerifier` (transient). **The Kennel Papers `settings.json` refresh token that rides
  inside the backup zip is never read or stored** — the viewer ignores that archive member.
- `getPapersSnapshotCache` / `setPapersSnapshotCache` / `clearPapersSnapshotCache` under
  `kennelOS.papersSnapshot` — `{ cachedAt, dogs, documents }` **text only** (file bytes and
  thumbnails stripped), so the list renders offline with per-type icons. Small enough for
  localStorage even with hundreds of documents.

Both keys ride `clearAllSettings()` (Reset App), like every other setting.

## 7. Page UI (`documents.html` + `documents.js`)

Standard KennelOS page (nav include, `../app.js` + `./documents.js`, `esc()` on every user
value, badge tone classes from `app.css`):

- **Connection card.** Not connected → explainer + "Connect Kennel Papers Dropbox". Connected
  → "Refresh", a "Documents as of <relative time>" label, and "Disconnect".
- **Filter row.** Type chips (All + Pedigree / Health test / Registration / Contract / Other),
  a dog `<select>`, and a text search (title / dog / notes / issuer).
- **List grouped by dog** (alphabetical by call name; newest-first within a dog). Each row:
  per-type icon, title, type badge, date, issuer. Archived docs and docs whose `dog_id`
  isn't a known KennelOS dog are hidden by default; a "Show unmatched" toggle reveals docs
  for not-yet-synced dogs under an "Unmatched" group.
- **Viewer modal.** Inline `<embed>` on an in-memory object URL + Download. No edit/delete.
- **`?dog=<id>` deep link** pre-filters to one dog — powers the dog-page button.

## 8. Offline behavior

Online-only, like the rest of Kennel Papers sync — but the grouped list renders offline from
the text metadata cache (per-type icons instead of thumbnails). Opening/downloading a file
needs the in-memory zip from a Refresh; offline, "View" explains it needs a reconnect +
Refresh. Snapshot freshness is bounded by the last Kennel Papers push (auto-pushes on add,
so usually seconds old) and shown in the "as of" label.

## 9. Service worker (`sw.js`)

The 5 new files are added to `PRECACHE_URLS` and `CACHE_NAME` is bumped. Dropbox calls are
cross-origin/non-GET and fall through the cache-first fetch handler untouched.

## 10. Edge cases

- **No backup pushed yet** → friendly "No Kennel Papers backups found in Dropbox yet."
- **Doc for an unsynced/local dog** → grouped under "Unmatched", never dropped silently.
- **Token expired** → silent refresh via the refresh token; on failure, prompt to reconnect.
- **Not-a-Kennel-Papers zip / corrupt** → legible error, nothing rendered.

## 11. Verification

`node --check` on every new/edited `.js`; serve locally; connect a test Kennel Papers Dropbox
with a couple of pushed docs; exercise list/filter/view/download and the `?dog=` deep link;
run the End-State precache sanity check.
