// documents.js — the Documents viewer controller (see documents.html). A
// read-only window onto the Kennel Papers document vault from inside KennelOS:
// connect to the Kennel Papers Dropbox (a second connection), pull the newest
// backup, and list each dog's documents grouped by dog. Viewing a document opens
// its PDF from the in-memory snapshot; nothing is written anywhere.
//
// Layering stays intact: dog identity comes from dogRepo (the KennelOS source of
// truth); all the Kennel Papers reading is behind data/papersSnapshot.js.
import { esc, fmtDate, param } from '../assets/ui.js';
import { dogRepo } from '../data/dogRepo.js';
import {
  isConnected, beginAuth, completeAuth, disconnect
} from '../data/papersDropbox.js';
import {
  pullSnapshot, getCachedSnapshot, hasFilesLoaded, openFileBlob, fileNameFor,
  DOC_TYPES, docTypeDescriptor
} from '../data/papersSnapshot.js';
import { clearPapersSnapshotCache } from '../data/settings.js';

// --- View state -------------------------------------------------------------
let snapshot = null;                 // { cachedAt, documents, papersDogs, fileMeta } or null
let dogsById = new Map();            // KennelOS dogs by id (source of truth for names)
const filters = { type: 'all', dog: param('dog') || '', text: '', unmatched: false };

const msg = document.getElementById('page-msg');
function flash(text, kind = 'ok') {
  msg.innerHTML = text
    ? `<div class="${kind === 'ok' ? 'inline-warn' : 'inline-error'}" style="${kind === 'ok' ? 'color:var(--accent-dark);background:var(--accent-soft);border-color:#bfe0cd;' : ''}">${esc(text)}</div>`
    : '';
  if (text) msg.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}
function show(id, visible) { document.getElementById(id).style.display = visible ? '' : 'none'; }

function relTime(iso) {
  if (!iso) return 'never';
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs} hr${hrs > 1 ? 's' : ''} ago`;
  const days = Math.floor(hrs / 24);
  return `${days} day${days > 1 ? 's' : ''} ago`;
}

const dogName = (d) => (d && (d.call_name || d.registered_name)) || '(unnamed dog)';

// --- Rendering --------------------------------------------------------------

function renderConnectionState() {
  const connected = isConnected();
  show('connect-card', !connected);
  show('status-card', connected);
  show('filter-card', connected);
  if (connected) {
    const stamp = snapshot ? snapshot.cachedAt : null;
    document.getElementById('snapshot-status').textContent = stamp
      ? `Documents as of ${relTime(stamp)}${hasFilesLoaded() ? '' : ' (list only — Refresh to open files)'}.`
      : 'Connected. Tap Refresh to pull your Kennel Papers documents.';
  }
}

function renderTypeChips() {
  const chips = [{ value: 'all', label: 'All' }, ...DOC_TYPES];
  document.getElementById('type-chips').innerHTML = chips.map((c) =>
    `<a class="seg-tab${filters.type === c.value ? ' active' : ''}" href="#" data-type="${esc(c.value)}">${esc(c.label)}</a>`
  ).join('');
}

function renderDogFilterOptions() {
  const sel = document.getElementById('dog-filter');
  const live = [...dogsById.values()]
    .filter((d) => !d.is_archived)
    .sort((a, b) => dogName(a).localeCompare(dogName(b), undefined, { sensitivity: 'base' }));
  sel.innerHTML = '<option value="">All dogs</option>'
    + live.map((d) => `<option value="${esc(d.id)}"${filters.dog === d.id ? ' selected' : ''}>${esc(dogName(d))}</option>`).join('');
}

function matchesText(doc, dogLabel, q) {
  if (!q) return true;
  const hay = [doc.title, dogLabel, doc.issuer_or_lab, doc.notes, doc.registry, doc.result]
    .filter(Boolean).join(' ').toLowerCase();
  return hay.includes(q);
}

// Group the (filtered) documents by dog, sorted like the Kennel Papers list:
// dogs alphabetical by name, newest-first within a dog.
function buildGroups() {
  const q = filters.text.trim().toLowerCase();
  const groups = new Map(); // dogId -> { dog, known, name, docs: [] }
  for (const doc of (snapshot?.documents || [])) {
    if (doc.is_archived) continue;
    if (filters.type !== 'all' && doc.doc_type !== filters.type) continue;
    if (filters.dog && doc.dog_id !== filters.dog) continue;

    const known = dogsById.get(doc.dog_id) || null;
    if (!known && !filters.unmatched) continue;
    const papersDog = !known ? (snapshot.papersDogs || []).find((d) => d.id === doc.dog_id) : null;
    const name = known ? dogName(known) : dogName(papersDog);
    if (!matchesText(doc, name, q)) continue;

    if (!groups.has(doc.dog_id)) groups.set(doc.dog_id, { dogId: doc.dog_id, known: !!known, name, docs: [] });
    groups.get(doc.dog_id).docs.push(doc);
  }
  const arr = [...groups.values()];
  for (const g of arr) {
    g.docs.sort((a, b) => String(b.doc_date || '').localeCompare(String(a.doc_date || '')));
  }
  // Matched dogs first (alphabetical), then unmatched (alphabetical).
  arr.sort((a, b) => (Number(b.known) - Number(a.known))
    || a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
  return arr;
}

function docRowHtml(doc) {
  const t = docTypeDescriptor(doc.doc_type);
  const meta = [fmtDate(doc.doc_date), doc.issuer_or_lab].filter(Boolean).join(' • ');
  const canOpen = !!doc.file_id;
  return `
    <div class="doc-row"${canOpen ? ` data-file="${esc(doc.file_id)}" data-title="${esc(doc.title || t.label)}" role="button" tabindex="0"` : ''}
         style="display:flex;align-items:center;gap:12px;padding:10px 2px;border-top:1px solid var(--border,#e2e6ec);${canOpen ? 'cursor:pointer;' : ''}">
      <span aria-hidden="true" style="font-size:22px;line-height:1;">${t.icon}</span>
      <div style="flex:1;min-width:0;">
        <strong>${esc(doc.title || t.label)}</strong>
        ${meta ? `<div class="muted" style="font-size:13px;">${esc(meta)}</div>` : ''}
      </div>
      <span class="badge ${esc(t.badge)}">${esc(t.label)}</span>
    </div>`;
}

function renderList() {
  const host = document.getElementById('list');
  if (!snapshot) {
    host.innerHTML = `<div class="card"><p class="faint" style="margin:0;">${isConnected()
      ? 'No documents loaded yet — tap Refresh.'
      : 'Connect to see your Kennel Papers documents.'}</p></div>`;
    return;
  }
  const groups = buildGroups();
  if (!groups.length) {
    host.innerHTML = `<div class="card"><p class="faint" style="margin:0;">No documents match these filters.</p></div>`;
    return;
  }
  host.innerHTML = groups.map((g) => `
    <div class="card" style="margin-top:14px;">
      <div class="row-between" style="align-items:baseline;">
        <h2 style="margin:0;font-size:17px;">${esc(g.name)}${g.known ? '' : ' <span class="faint" style="font-size:13px;">(not in KennelOS)</span>'}</h2>
        <span class="muted" style="font-size:13px;">${g.docs.length} document${g.docs.length > 1 ? 's' : ''}</span>
      </div>
      ${g.docs.map(docRowHtml).join('')}
    </div>`).join('');

  for (const row of host.querySelectorAll('.doc-row[data-file]')) {
    const open = () => openViewer(row.dataset.file, row.dataset.title);
    row.addEventListener('click', open);
    row.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } });
  }
}

// --- Viewer modal -----------------------------------------------------------

function openViewer(fileId, title) {
  let blob;
  try {
    blob = openFileBlob(fileId);
  } catch (e) {
    flash(e.message || String(e), 'err');
    return;
  }
  const url = URL.createObjectURL(blob);
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal" role="dialog" aria-modal="true" style="max-width:900px;width:96vw;">
      <div class="row-between" style="align-items:center;">
        <h2 style="margin:0;font-size:17px;">${esc(title || 'Document')}</h2>
        <div class="form-actions" style="margin:0;">
          <button class="btn" data-act="download">Download</button>
          <button class="btn" data-act="close">Close</button>
        </div>
      </div>
      <embed src="${url}" type="application/pdf" style="width:100%;height:70vh;margin-top:12px;border:1px solid var(--border,#e2e6ec);border-radius:6px;">
    </div>`;
  document.body.appendChild(overlay);

  const cleanup = () => { overlay.remove(); setTimeout(() => URL.revokeObjectURL(url), 500); };
  overlay.addEventListener('click', (e) => { if (e.target === overlay) cleanup(); });
  overlay.querySelector('[data-act="close"]').addEventListener('click', cleanup);
  overlay.querySelector('[data-act="download"]').addEventListener('click', () => {
    const a = document.createElement('a');
    a.href = url;
    a.download = fileNameFor(fileId, title);
    document.body.appendChild(a);
    a.click();
    a.remove();
  });
}

// --- Data + actions ---------------------------------------------------------

async function loadDogs() {
  const dogs = await dogRepo.getAll({ includeArchived: true });
  dogsById = new Map(dogs.map((d) => [d.id, d]));
}

async function refresh() {
  const btn = document.getElementById('btn-refresh');
  btn.disabled = true;
  const label = btn.textContent;
  btn.textContent = 'Refreshing…';
  flash('');
  try {
    const pulled = await pullSnapshot();
    if (!pulled) {
      flash('No Kennel Papers backups found in Dropbox yet — add a document in the Kennel Papers app first, which auto-backs-up.', 'err');
    } else {
      snapshot = pulled;
      flash(`Loaded ${pulled.documents.length} document${pulled.documents.length === 1 ? '' : 's'} from Kennel Papers.`);
    }
  } catch (e) {
    flash(e.message || String(e), 'err');
  } finally {
    btn.disabled = false;
    btn.textContent = label;
    renderConnectionState();
    renderList();
  }
}

function wireEvents() {
  document.getElementById('dbx-connect').addEventListener('click', async () => {
    try { await beginAuth(); } catch (e) { flash(e.message || String(e), 'err'); }
  });
  document.getElementById('btn-refresh').addEventListener('click', refresh);
  document.getElementById('btn-disconnect').addEventListener('click', () => {
    disconnect();
    clearPapersSnapshotCache();
    snapshot = null;
    flash('Disconnected from the Kennel Papers Dropbox.');
    renderConnectionState();
    renderList();
  });
  document.getElementById('type-chips').addEventListener('click', (e) => {
    const a = e.target.closest('[data-type]');
    if (!a) return;
    e.preventDefault();
    filters.type = a.dataset.type;
    renderTypeChips();
    renderList();
  });
  document.getElementById('dog-filter').addEventListener('change', (e) => {
    filters.dog = e.target.value;
    renderList();
  });
  document.getElementById('search').addEventListener('input', (e) => {
    filters.text = e.target.value;
    renderList();
  });
  document.getElementById('show-unmatched').addEventListener('change', (e) => {
    filters.unmatched = e.target.checked;
    renderList();
  });
}

// --- Boot -------------------------------------------------------------------

async function boot() {
  await loadDogs();
  renderDogFilterOptions();
  renderTypeChips();
  wireEvents();

  // Finish an in-progress connect (Dropbox redirected back with ?code=).
  let justConnected = false;
  try {
    justConnected = await completeAuth();
  } catch (e) {
    flash(e.message || String(e), 'err');
  }

  // Show the cached list immediately (offline-friendly); files need a Refresh.
  snapshot = getCachedSnapshot();
  renderConnectionState();
  renderList();

  if (justConnected) {
    flash('Dropbox connected. Pulling your documents…');
    await refresh();
  }
}

boot();
