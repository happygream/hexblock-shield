/**
 * HexBlock Shield — background service worker
 *
 * Responsibilities:
 * - Maintain block counters per tab
 * - Sync filter lists from the HexBlock gateway when configured
 * - Handle messages from popup and content scripts
 * - Listen for declarativeNetRequest rule match events
 */

import { getSettings, setSettings, getStats, incrementBlocked } from './storage.js';

// ── Other blocker detection ───────────────────────────────────
// If uBlock Origin or similar is active, disable our EasyList/EasyPrivacy
// rules to avoid conflicts. User's existing blocker handles it better.

async function checkForOtherBlockers() {
  try {
    const extensions = await chrome.management?.getAll();
    if (!extensions) return;
    const OTHER_BLOCKERS = [
      'uBlock Origin', 'uBlock', 'Adblock Plus', 'AdBlock',
      'Ghostery', 'Privacy Badger', 'Brave Shields',
    ];
    const hasOtherBlocker = extensions.some(ext =>
      ext.enabled && OTHER_BLOCKERS.some(name =>
        ext.name.toLowerCase().includes(name.toLowerCase())
      )
    );
    if (hasOtherBlocker) {
      console.log('HexBlock Shield: other ad blocker detected — disabling duplicate rules');
      await chrome.declarativeNetRequest.updateEnabledRulesets({
        disableRulesetIds: ['filters'],
        enableRulesetIds:  [],
      }).catch(() => {});
    }
  } catch(_) {}
}

// ── Startup ───────────────────────────────────────────────────

chrome.runtime.onInstalled.addListener(async (details) => {
  if (details.reason === 'install') {
    await setSettings({
      enabled:           true,
      adBlocking:        true,
      trackerBlocking:   true,
      malwareBlocking:   true,
      cosmeticFiltering: true,
      youtubeAdBlock:    true,
      sponsorBlock:      true,
      sbSponsors:        true,
      sbIntros:          true,
      sbOutros:          true,
      sbSelfPromo:       true,
      sbSubscriptions:   false,
      sbFiller:          false,
      twitchAdBlock:     true,
      gatewayUrl:        '',
      gatewaySync:       false,
      gatewayReport:     false,
      sbApiEndpoint:     'https://sponsor.ajay.app',
    });
  }

  // On update, record the new version and a short "what's new" note so the
  // popup can surface a one-time, dismissible banner to the user.
  if (details.reason === 'update') {
    const version = chrome.runtime.getManifest().version;
    if (version !== details.previousVersion) {
      await chrome.storage.local.set({
        hb_update_notice: {
          version,
          previousVersion: details.previousVersion || null,
          note: 'Fixed sites being blocked by mistake — full pages and embeds (videos, comments, payment frames) now load correctly while ads stay blocked.',
          ts: Date.now(),
          seen: false,
        },
      });
      // Badge cue so the user notices there's something new in the popup.
      try {
        await chrome.action.setBadgeText({ text: 'NEW' });
        await chrome.action.setBadgeBackgroundColor({ color: '#00d4aa' });
      } catch (_) {}
    }
  }
  checkForOtherBlockers();
});

chrome.runtime.onStartup.addListener(checkForOtherBlockers);

// ── Block event counting ──────────────────────────────────────
// Note: onRuleMatchedDebug requires declarativeNetRequestFeedback permission
// which is not available in production store builds. We count blocks via
// content script messages instead.

// ── Message handling ──────────────────────────────────────────

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  switch (msg.type) {
    case 'GET_STATS':
      getStats(msg.tabId).then(sendResponse);
      return true;

    case 'GET_SETTINGS':
      getSettings().then(sendResponse);
      return true;

    case 'SET_SETTINGS':
      setSettings(msg.settings).then(() => {
        applySettings(msg.settings);
        sendResponse({ ok: true });
      });
      return true;

    case 'BLOCK_EVENT':
      incrementBlocked(sender.tab?.id).then(() => sendResponse({ ok: true }));
      return true;

    case 'SEGMENT_SKIPPED':
      handleSegmentSkipped(sender.tab?.id, msg.segment);
      sendResponse({ ok: true });
      break;

    case 'TWITCH_AD_STRIPPED':
      handleTwitchAdStripped(sender.tab?.id, msg.count, msg.seconds);
      sendResponse({ ok: true });
      break;

    case 'SYNC_GATEWAY':
      syncFromGateway().then(sendResponse);
      return true;

    case 'GET_PAUSED_SITES':
      chrome.storage.sync.get('hb_paused_sites').then(res => {
        sendResponse({ sites: res['hb_paused_sites'] || [] });
      });
      return true;

    case 'GET_UPDATE_NOTICE':
      chrome.storage.local.get('hb_update_notice').then(res => {
        const notice = res['hb_update_notice'];
        sendResponse({ notice: (notice && !notice.seen) ? notice : null });
      });
      return true;

    case 'DISMISS_UPDATE_NOTICE':
      chrome.storage.local.get('hb_update_notice').then(async (res) => {
        const notice = res['hb_update_notice'];
        if (notice) {
          notice.seen = true;
          await chrome.storage.local.set({ hb_update_notice: notice });
        }
        try { await chrome.action.setBadgeText({ text: '' }); } catch (_) {}
        sendResponse({ ok: true });
      });
      return true;
  }
});

// ── Settings application ──────────────────────────────────────

async function applySettings(settings) {
  const updates = [];

  // ad and tracker blocking are now served by a single curated "filters"
  // ruleset. Keep it enabled if either protection is on.
  if ('adBlocking' in settings || 'trackerBlocking' in settings) {
    const cur = await getSettings();
    const adOn      = ('adBlocking'      in settings) ? settings.adBlocking      : cur.adBlocking;
    const trackerOn = ('trackerBlocking' in settings) ? settings.trackerBlocking : cur.trackerBlocking;
    updates.push({ rulesetId: 'filters', action: (adOn || trackerOn) ? 'enable' : 'disable' });
  }
  if ('youtubeAdBlock' in settings) {
    updates.push({ rulesetId: 'youtube_ads', action: settings.youtubeAdBlock ? 'enable' : 'disable' });
  }

  if (updates.length === 0) return;

  const enable  = updates.filter(u => u.action === 'enable').map(u => u.rulesetId);
  const disable = updates.filter(u => u.action === 'disable').map(u => u.rulesetId);

  try {
    await chrome.declarativeNetRequest.updateEnabledRulesets({
      enableRulesetIds:  enable,
      disableRulesetIds: disable,
    });
  } catch (err) {
    console.error('HexBlock Shield: failed to update rule sets', err);
  }
}

// ── Twitch ad strip tracking ──────────────────────────────────

async function handleTwitchAdStripped(tabId, count, seconds) {
  if (!tabId) return;
  const stats = await getStats(tabId);
  stats.twitchAdsStripped  = (stats.twitchAdsStripped  || 0) + count;
  stats.twitchSecondsSaved = (stats.twitchSecondsSaved || 0) + seconds;
  stats.segmentsSkipped    = (stats.segmentsSkipped    || 0) + count;
  stats.secondsSaved       = (stats.secondsSaved       || 0) + seconds;
  await chrome.storage.session.set({ [`stats_${tabId}`]: stats });
}

// ── Segment skip tracking ─────────────────────────────────────

async function handleSegmentSkipped(tabId, segment) {
  if (!tabId) return;
  const stats = await getStats(tabId);
  stats.segmentsSkipped = (stats.segmentsSkipped || 0) + 1;
  stats.secondsSaved    = (stats.secondsSaved    || 0) + (segment?.duration || 0);
  await chrome.storage.session.set({ [`stats_${tabId}`]: stats });
  reportToGateway(segment?.videoId, 'skipped', tabId);
}

// ── Gateway sync ──────────────────────────────────────────────

async function syncFromGateway() {
  const s = await getSettings();
  if (!s.gatewayUrl || !s.gatewaySync) return { ok: false, reason: 'not configured' };

  try {
    const url = s.gatewayUrl.replace(/\/$/, '') + '/api/v1/blocklists';
    const res = await fetch(url, { credentials: 'include' });
    if (!res.ok) return { ok: false, reason: `gateway returned ${res.status}` };
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: err.message };
  }
}

// ── Gateway reporting ─────────────────────────────────────────

async function reportToGateway(resource, action, tabId) {
  const s = await getSettings();
  if (!s.gatewayUrl || !s.gatewayReport) return;

  fetch(s.gatewayUrl.replace(/\/$/, '') + '/api/v1/events', {
    method:      'POST',
    credentials: 'include',
    headers:     { 'Content-Type': 'application/json' },
    body: JSON.stringify({ resource, action, tabId, ts: Date.now() }),
  }).catch(() => {});
}
