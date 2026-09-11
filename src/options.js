/**
 * HexBlock Shield — options page logic.
 * Reuses the same chrome.storage.sync settings layer as the popup.
 */

const SETTINGS_KEY = 'hb_settings';
const PAUSED_KEY   = 'hb_paused_sites';

async function getSettings() {
  const r = await chrome.storage.sync.get(SETTINGS_KEY);
  return r[SETTINGS_KEY] || {};
}
async function setSetting(key, value) {
  const cur = await getSettings();
  cur[key] = value;
  await chrome.storage.sync.set({ [SETTINGS_KEY]: cur });
  // let the service worker re-apply rules
  try { chrome.runtime.sendMessage({ type: 'SET_SETTINGS', settings: { [key]: value } }); } catch (_) {}
  flashSaved();
}

let savedTimer;
function flashSaved() {
  const s = document.getElementById('saved');
  if (!s) return;
  s.classList.add('show');
  clearTimeout(savedTimer);
  savedTimer = setTimeout(() => s.classList.remove('show'), 1400);
}

// ── Toggles ──────────────────────────────────────────────────
async function initToggles() {
  const settings = await getSettings();
  document.querySelectorAll('.tog[data-set]').forEach(tog => {
    const key = tog.dataset.set;
    tog.classList.toggle('off', !settings[key]);
    tog.addEventListener('click', async () => {
      const now = !tog.classList.contains('off');
      const next = !now;
      tog.classList.toggle('off', !next);
      await setSetting(key, next);
    });
  });
}

// ── Text fields (gateway url, sb endpoint) ───────────────────
async function initFields() {
  const settings = await getSettings();
  ['gatewayUrl', 'sbApiEndpoint'].forEach(key => {
    const el = document.getElementById(key);
    if (!el) return;
    if (settings[key]) el.value = settings[key];
    let t;
    el.addEventListener('input', () => {
      clearTimeout(t);
      t = setTimeout(() => setSetting(key, el.value.trim()), 500);
    });
  });
}

// ── Per-site allowlist ───────────────────────────────────────
async function getPaused() {
  const r = await chrome.storage.sync.get(PAUSED_KEY);
  return r[PAUSED_KEY] || [];
}
async function setPaused(list) {
  await chrome.storage.sync.set({ [PAUSED_KEY]: list });
  flashSaved();
}
function normHost(v) {
  v = (v || '').trim().toLowerCase();
  if (!v) return '';
  // strip scheme/path if a full URL was pasted
  try { if (v.includes('://')) v = new URL(v).hostname; } catch (_) {}
  v = v.replace(/^www\./, '').replace(/\/.*$/, '');
  return v;
}
async function renderAllowlist() {
  const list = await getPaused();
  const wrap = document.getElementById('al-list');
  if (!list.length) {
    wrap.innerHTML = '<div class="al-empty">No sites paused — Shield is active everywhere.</div>';
    return;
  }
  wrap.innerHTML = '';
  list.slice().sort().forEach(host => {
    const item = document.createElement('div');
    item.className = 'al-item';
    const h = document.createElement('span');
    h.className = 'al-host';
    h.textContent = host;
    const rm = document.createElement('button');
    rm.className = 'al-rm';
    rm.textContent = '\u00d7';
    rm.title = 'Remove';
    rm.addEventListener('click', async () => {
      const cur = await getPaused();
      await setPaused(cur.filter(x => x !== host));
      renderAllowlist();
    });
    item.append(h, rm);
    wrap.appendChild(item);
  });
}
function initAllowlist() {
  const input = document.getElementById('al-input');
  const add = document.getElementById('al-add-btn');
  const doAdd = async () => {
    const host = normHost(input.value);
    if (!host) return;
    const cur = await getPaused();
    if (!cur.includes(host)) { cur.push(host); await setPaused(cur); }
    input.value = '';
    renderAllowlist();
  };
  add.addEventListener('click', doAdd);
  input.addEventListener('keydown', e => { if (e.key === 'Enter') doAdd(); });
}

// ── Boot ─────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  const ver = document.getElementById('ver');
  if (ver) ver.textContent = 'v' + chrome.runtime.getManifest().version;
  await initToggles();
  await initFields();
  initAllowlist();
  await renderAllowlist();
});
