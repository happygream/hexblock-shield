/**
 * HexBlock Shield — popup.js
 * Wires the popup UI to storage and the background service worker.
 */

'use strict';

let settings    = {};
let logFilter   = 'all';
let currentTab  = null;

// ── Boot ─────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', async () => {
  currentTab = await getCurrentTab();
  settings   = await msg({ type: 'GET_SETTINGS' });

  setUrlBar(currentTab?.url || '');
  applySettings();
  loadStats();
  loadLog();
  bindTabs();
  bindToggles();
  bindSettings();
  bindMaster();
  bindLogFilters();
  bindPauseSite();
  bindSkipCut();
  startPoll();
});

// ── Tab info ─────────────────────────────────────────────────

async function getCurrentTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab || null;
}

function setUrlBar(url) {
  const el  = document.getElementById('url-text');
  const dot = document.getElementById('url-dot');
  if (!url) return;
  try {
    const u    = new URL(url);
    el.textContent = u.hostname + (u.pathname !== '/' ? u.pathname.slice(0, 30) : '');
    const isYT = u.hostname.includes('youtube.com');
    dot.classList.toggle('yt', isYT);
  } catch (_) {
    el.textContent = url.slice(0, 40);
  }
}

// ── Apply settings to UI ──────────────────────────────────────

function applySettings() {
  const on = settings.enabled !== false;

  // Header dot and master toggle
  document.getElementById('hdr-dot').classList.toggle('off', !on);
  document.getElementById('master').classList.toggle('off', !on);
  document.getElementById('master-tog').classList.toggle('off', !on);
  document.getElementById('master-label').textContent = on ? 'Protection enabled' : 'Protection disabled';
  document.getElementById('master-sub').textContent   = on ? 'All shields active' : 'Shields off — traffic unfiltered';

  // Feature toggles
  const keys = [
    'adBlocking', 'trackerBlocking', 'malwareBlocking',
    'cosmeticFiltering', 'youtubeAdBlock', 'sponsorBlock',
    'sbSponsors', 'sbIntros', 'sbOutros', 'sbSelfPromo', 'sbSubscriptions', 'sbFiller',
    'twitchAdBlock',
    'gatewaySync', 'gatewayReport', 'annoyances',
  ];
  for (const key of keys) {
    const btns = document.querySelectorAll(`[data-key="${key}"]`);
    btns.forEach(btn => {
      const val = settings[key] !== false;
      btn.classList.toggle('on', val);
      const feat = btn.closest('.feat');
      if (feat) feat.classList.toggle('on', val);
    });
  }

  // Inputs
  const gwUrl = document.getElementById('gw-url');
  const sbApi = document.getElementById('sb-api');
  if (gwUrl && settings.gatewayUrl) gwUrl.value = settings.gatewayUrl;
  if (sbApi && settings.sbApiEndpoint) sbApi.value = settings.sbApiEndpoint;
}

// ── Stats ─────────────────────────────────────────────────────

async function loadStats() {
  const s = await msg({ type: 'GET_STATS', tabId: currentTab?.id });
  if (!s) return;
  setText('s-blocked', s.blocked || 0);
  setText('s-skipped', s.segmentsSkipped || 0);
  const mins = Math.round((s.secondsSaved || 0) / 60);
  setText('s-saved', mins + 'm');
  setText('fc-ads', s.blocked || 0);
  document.getElementById('fc-ads').classList.toggle('lit', (s.blocked || 0) > 0);
  // YouTube panel
  setText('yt-segs', s.segmentsSkipped || 0);
  setText('yt-time', mins + 'm');

  // Twitch panel
  setText('tw-strips', s.twitchAdsStripped || 0);
  const twSecs = s.twitchSecondsSaved || 0;
  setText('tw-saved', twSecs >= 60 ? Math.round(twSecs / 60) + 'm' : twSecs + 's');
}

function startPoll() {
  setInterval(loadStats, 3000);
}

// ── Log ───────────────────────────────────────────────────────

async function loadLog() {
  const entries = await getLogEntries(currentTab?.id);
  renderLog(entries);
}

function getLogEntries(tabId) {
  return new Promise(resolve => {
    chrome.storage.session.get(`log_${tabId}`, result => {
      resolve(result[`log_${tabId}`] || []);
    });
  });
}

function renderLog(entries) {
  const f    = logFilter;
  const rows = f === 'all' ? entries : entries.filter(e => e.type === f);
  const wrap = document.getElementById('log-wrap');
  wrap.innerHTML = rows.map(e => `
    <div class="lrow">
      <div class="ldot ${e.type === 'blocked' ? 'b' : e.type === 'skipped' ? 's' : 'a'}"></div>
      <div class="ltag ${e.type === 'blocked' ? 'b' : e.type === 'skipped' ? 's' : 'a'}">${e.type}</div>
      <div class="ldom">${esc(e.domain || e.resource || '—')}</div>
      <div class="ltime">${timeAgo(e.ts)}</div>
    </div>`).join('') || `<div style="padding:20px;text-align:center;font-family:var(--mono);font-size:9px;color:var(--muted);">No entries for this filter</div>`;
  setText('log-count', rows.length + ' entries');
}

function filterLog(f) {
  logFilter = f;
  loadLog();
}

function bindSkipCut() {
  if (!currentTab?.url) return;
  let videoId = null;
  try {
    const u = new URL(currentTab.url);
    if (u.hostname.includes('youtube.com')) {
      videoId = u.searchParams.get('v');
      // Also handle youtube.com/shorts/ID and youtube.com/live/ID
      if (!videoId) {
        const parts = u.pathname.split('/').filter(Boolean);
        if (parts[0] === 'shorts' || parts[0] === 'live') videoId = parts[1];
      }
    }
  } catch(_) {}

  if (!videoId) return;

  const wrap = document.getElementById('skipcut-wrap');
  const btn  = document.getElementById('skipcut-btn');
  if (wrap) wrap.style.display = 'block';
  if (btn) {
    btn.addEventListener('click', () => {
      chrome.tabs.create({ url: `https://hexblock.co.uk/watch?v=${videoId}` });
      window.close();
    });
  }
}

function bindMaster() {
  document.getElementById('master')?.addEventListener('click', toggleMaster);
}

async function bindPauseSite() {
  if (!currentTab?.url) return;
  let hostname;
  try { hostname = new URL(currentTab.url).hostname; } catch(_) { return; }

  // Load paused sites list
  const result = await chrome.storage.sync.get('hb_paused_sites');
  const paused = result['hb_paused_sites'] || [];
  const isPaused = paused.includes(hostname);

  const tog = document.getElementById('pause-tog');
  if (!tog) return;
  tog.classList.toggle('on', isPaused);

  tog.addEventListener('click', async (e) => {
    e.stopPropagation();
    const res = await chrome.storage.sync.get('hb_paused_sites');
    const sites = res['hb_paused_sites'] || [];
    const idx = sites.indexOf(hostname);
    if (idx === -1) {
      sites.push(hostname);
      tog.classList.add('on');
    } else {
      sites.splice(idx, 1);
      tog.classList.remove('on');
    }
    await chrome.storage.sync.set({ 'hb_paused_sites': sites });
  });
}

function bindLogFilters() {
  document.getElementById('lf-b-btn')?.addEventListener('click', () => filterLog('blocked'));
  document.getElementById('lf-s-btn')?.addEventListener('click', () => filterLog('skipped'));
  document.getElementById('lf-a-btn')?.addEventListener('click', () => filterLog('all'));
}

document.getElementById('clear-log')?.addEventListener('click', async () => {
  if (currentTab?.id) {
    await chrome.storage.session.remove(`log_${currentTab.id}`);
    loadLog();
  }
});

// ── Master toggle ─────────────────────────────────────────────

async function toggleMaster() {
  settings.enabled = !settings.enabled;
  await msg({ type: 'SET_SETTINGS', settings: { enabled: settings.enabled } });
  applySettings();
}

// ── Feature toggles ───────────────────────────────────────────

function bindToggles() {
  document.querySelectorAll('.mtog[data-key]').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const key  = btn.dataset.key;
      const next = !settings[key];
      settings[key] = next;
      await msg({ type: 'SET_SETTINGS', settings: { [key]: next } });
      applySettings();
    });
  });
}

// ── Tabs ──────────────────────────────────────────────────────

function bindTabs() {
  document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
      tab.classList.add('active');
      document.getElementById('panel-' + tab.dataset.tab)?.classList.add('active');
      if (tab.dataset.tab === 'log') loadLog();
    });
  });

  document.getElementById('ftr-settings')?.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(t =>
      t.classList.toggle('active', t.dataset.tab === 'settings')
    );
    document.querySelectorAll('.panel').forEach(p =>
      p.classList.toggle('active', p.id === 'panel-settings')
    );
  });
}

// ── Settings inputs ───────────────────────────────────────────

function bindSettings() {
  const gwUrl = document.getElementById('gw-url');
  const sbApi = document.getElementById('sb-api');

  gwUrl?.addEventListener('blur', async () => {
    settings.gatewayUrl = gwUrl.value.trim();
    await msg({ type: 'SET_SETTINGS', settings: { gatewayUrl: settings.gatewayUrl } });
  });

  sbApi?.addEventListener('blur', async () => {
    settings.sbApiEndpoint = sbApi.value.trim() || 'https://sponsor.ajay.app';
    await msg({ type: 'SET_SETTINGS', settings: { sbApiEndpoint: settings.sbApiEndpoint } });
  });
}

// ── Helpers ───────────────────────────────────────────────────

function msg(payload) {
  return new Promise(resolve => chrome.runtime.sendMessage(payload, resolve));
}

function setText(id, val) {
  const el = document.getElementById(id);
  if (el) el.textContent = val;
}

function esc(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function timeAgo(ts) {
  if (!ts) return '—';
  const s = Math.round((Date.now() - ts) / 1000);
  if (s < 5)   return 'now';
  if (s < 60)  return s + 's';
  if (s < 3600) return Math.round(s / 60) + 'm';
  return Math.round(s / 3600) + 'h';
}
