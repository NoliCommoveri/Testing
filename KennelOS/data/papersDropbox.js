// papersDropbox.js — a SECOND, independent Dropbox client that reads the
// *Kennel Papers* app folder from inside KennelOS (the Documents viewer, see
// pages/documents.js + data/papersSnapshot.js).
//
// Why a separate client at all: KennelOS's own data/dropbox.js is App-folder
// scoped to /Apps/KennelOS/ (app key d4fna4tzs2qbcva) and physically cannot see
// the Kennel Papers folder. Kennel Papers is a different Dropbox app, App-folder
// scoped to /Apps/Kennel Papers/ (app key fvmtvesy1u1l0xf). To read its backups
// we authorize against THAT app key, with its own refresh token, stored under a
// separate settings namespace (kennelOS.papersDropbox) so the two connections
// never step on each other. Same no-SDK/no-CDN PKCE-over-fetch posture as the
// other two dropbox.js files in the codebase.
//
// Read-only in practice: we request only the files.content.read scope and only
// ever call list_folder + files/download. Nothing here writes to Dropbox.
//
// One-time developer step: the Documents page URL (this page's origin+pathname)
// must be registered as an OAuth Redirect URI on the KENNEL PAPERS Dropbox app
// (deployed + http://localhost:8000/pages/documents.html for dev). Dropbox
// requires an exact match at connect time.
const APP_KEY = 'fvmtvesy1u1l0xf'; // the Kennel Papers app key (public PKCE client id)

import {
  getPapersDropboxSettings, setPapersDropboxSettings, clearPapersDropboxSettings
} from './settings.js';

const AUTHORIZE_URL = 'https://www.dropbox.com/oauth2/authorize';
const TOKEN_URL = 'https://api.dropboxapi.com/oauth2/token';
const CONTENT_URL = 'https://content.dropboxapi.com/2/files';
const RPC_URL = 'https://api.dropboxapi.com/2/files';

// Base64url without padding — the PKCE alphabet.
function b64url(bytes) {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// The redirect URI is this page's own URL (no query/hash) — Documents rounds
// the OAuth trip back to itself. Must match a URI registered on the Kennel
// Papers Dropbox app.
function redirectUri() {
  return location.origin + location.pathname;
}

export function isConnected() {
  return Boolean(getPapersDropboxSettings().refreshToken);
}

// Kick off the PKCE authorization redirect. Stashes the verifier (localStorage,
// so it survives the round-trip through dropbox.com), then navigates away;
// completeAuth() finishes when Dropbox sends the browser back with ?code=.
export async function beginAuth() {
  const verifier = b64url(crypto.getRandomValues(new Uint8Array(48)));
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  setPapersDropboxSettings({ pkceVerifier: verifier });
  const params = new URLSearchParams({
    client_id: APP_KEY,
    response_type: 'code',
    code_challenge: b64url(new Uint8Array(digest)),
    code_challenge_method: 'S256',
    redirect_uri: redirectUri(),
    token_access_type: 'offline',
    scope: 'files.content.read' // read-only: the viewer never writes
  });
  location.assign(`${AUTHORIZE_URL}?${params}`);
}

// Call once on page load. If the URL carries Dropbox's ?code=, exchange it for
// tokens and return true (the page should re-render its connection status);
// otherwise do nothing. The code is scrubbed from the URL either way so a reload
// never replays a spent code.
export async function completeAuth() {
  const url = new URL(location.href);
  const code = url.searchParams.get('code');
  if (!code) return false;
  url.searchParams.delete('code');
  url.searchParams.delete('state');
  history.replaceState(null, '', url.toString());

  const s = getPapersDropboxSettings();
  if (!s.pkceVerifier) {
    throw new Error('Dropbox sent back an authorization code, but no connection attempt is in progress. Try Connect again.');
  }
  const tokens = await tokenRequest({
    code,
    grant_type: 'authorization_code',
    code_verifier: s.pkceVerifier,
    client_id: APP_KEY,
    redirect_uri: redirectUri()
  });
  setPapersDropboxSettings({
    refreshToken: tokens.refresh_token,
    accessToken: tokens.access_token,
    accessTokenExpiresAt: Date.now() + (tokens.expires_in - 60) * 1000,
    pkceVerifier: null
  });
  return true;
}

// Forget the tokens (does not touch the cached snapshot — the page clears that).
export function disconnect() {
  clearPapersDropboxSettings();
}

async function tokenRequest(fields) {
  let res;
  try {
    res = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(fields)
    });
  } catch {
    throw new Error('Could not reach Dropbox — check your internet connection.');
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const detail = body.error_description || body.error || `HTTP ${res.status}`;
    throw new Error(`Dropbox sign-in failed: ${detail}`);
  }
  return body;
}

// A valid short-lived access token, minting a fresh one from the refresh token
// when the cached one is missing/expired.
async function getAccessToken({ force = false } = {}) {
  const s = getPapersDropboxSettings();
  if (!s.refreshToken) {
    throw new Error('Not connected to the Kennel Papers Dropbox — use Connect first.');
  }
  if (!force && s.accessToken && s.accessTokenExpiresAt && Date.now() < s.accessTokenExpiresAt) {
    return s.accessToken;
  }
  const tokens = await tokenRequest({
    grant_type: 'refresh_token',
    refresh_token: s.refreshToken,
    client_id: APP_KEY
  });
  setPapersDropboxSettings({
    accessToken: tokens.access_token,
    accessTokenExpiresAt: Date.now() + (tokens.expires_in - 60) * 1000
  });
  return tokens.access_token;
}

// One call retried once with a forced token refresh on 401 (an access token can
// be revoked/expired ahead of its cached expiry). `kind` is 'rpc' (JSON body,
// api.dropboxapi.com) or 'content' (Dropbox-API-Arg header, content.dropboxapi.com).
async function call(kind, endpoint, { jsonBody, apiArg } = {}) {
  const base = kind === 'content' ? CONTENT_URL : RPC_URL;
  const attempt = async (force) => {
    const token = await getAccessToken({ force });
    const headers = { Authorization: `Bearer ${token}` };
    let body;
    if (kind === 'content') {
      // Fixed ASCII paths only, so plain JSON.stringify is header-safe here.
      headers['Dropbox-API-Arg'] = JSON.stringify(apiArg);
    } else {
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify(jsonBody);
    }
    try {
      return await fetch(`${base}/${endpoint}`, { method: 'POST', headers, ...(body != null ? { body } : {}) });
    } catch {
      throw new Error('Could not reach Dropbox — check your internet connection.');
    }
  };
  let res = await attempt(false);
  if (res.status === 401) res = await attempt(true);
  return res;
}

// Every backup file in the Kennel Papers app-folder root, newest first (by
// server_modified). Kennel Papers writes `/kennel-papers-backup-<stamp>.zip`.
export async function listBackups() {
  const res = await call('rpc', 'list_folder', { jsonBody: { path: '' } });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Could not list Kennel Papers backups: ${summarize(res, text)}`);
  }
  const data = await res.json();
  const entries = (data.entries || [])
    .filter((e) => e['.tag'] === 'file' && /\.zip$/i.test(e.name));
  entries.sort((a, b) => (a.server_modified < b.server_modified ? 1 : -1));
  return entries;
}

// Download a file (by its Dropbox path) as a Blob.
export async function downloadZip(path) {
  const res = await call('content', 'download', { apiArg: { path } });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Could not download the Kennel Papers backup: ${summarize(res, text)}`);
  }
  return res.blob();
}

function summarize(res, text) {
  try {
    const parsed = JSON.parse(text);
    if (parsed.error_summary) return parsed.error_summary;
  } catch { /* fall through to the raw status */ }
  return `HTTP ${res.status}`;
}
