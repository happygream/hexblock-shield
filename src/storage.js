/**
 * HexBlock Shield — storage helpers
 *
 * Settings are stored in chrome.storage.sync (synced across devices).
 * Per-tab stats are stored in chrome.storage.session (cleared on browser close).
 */

const SETTINGS_KEY = 'hb_settings';

export async function getSettings() {
  const result = await chrome.storage.sync.get(SETTINGS_KEY);
  return result[SETTINGS_KEY] || {};
}

export async function setSettings(updates) {
  const current = await getSettings();
  await chrome.storage.sync.set({ [SETTINGS_KEY]: { ...current, ...updates } });
}

export async function getStats(tabId) {
  if (!tabId) return defaultStats();
  const key    = `stats_${tabId}`;
  const result = await chrome.storage.session.get(key);
  return result[key] || defaultStats();
}

export async function incrementBlocked(tabId) {
  if (!tabId) return;
  const stats = await getStats(tabId);
  stats.blocked = (stats.blocked || 0) + 1;
  await chrome.storage.session.set({ [`stats_${tabId}`]: stats });
}

export async function getAllStats() {
  // Sum stats across all tabs for the popup global view
  const all    = await chrome.storage.session.get(null);
  const totals = defaultStats();
  for (const [key, val] of Object.entries(all)) {
    if (!key.startsWith('stats_')) continue;
    totals.blocked         += val.blocked         || 0;
    totals.segmentsSkipped += val.segmentsSkipped || 0;
    totals.secondsSaved    += val.secondsSaved    || 0;
  }
  return totals;
}

export async function getLogEntries(tabId, limit = 50) {
  const key    = `log_${tabId}`;
  const result = await chrome.storage.session.get(key);
  return (result[key] || []).slice(0, limit);
}

export async function addLogEntry(tabId, entry) {
  if (!tabId) return;
  const key     = `log_${tabId}`;
  const result  = await chrome.storage.session.get(key);
  const entries = result[key] || [];
  entries.unshift({ ...entry, ts: Date.now() });
  if (entries.length > 100) entries.length = 100;
  await chrome.storage.session.set({ [key]: entries });
}

export async function clearLog(tabId) {
  await chrome.storage.session.remove(`log_${tabId}`);
}

function defaultStats() {
  return { blocked: 0, segmentsSkipped: 0, secondsSaved: 0 };
}
