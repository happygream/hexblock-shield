/**
 * HexBlock Shield — Twitch content script
 * Runs at document_start to inject the page-context ad remover
 * as early as possible before Twitch's player initialises.
 */

'use strict';

if (!location.hostname.endsWith('twitch.tv')) {
  throw new Error('HexBlock Shield Twitch: wrong host');
}

// Inject immediately — don't wait for settings check
// The injected script checks settings itself via postMessage
function injectPageScript() {
  const script = document.createElement('script');
  script.src = chrome.runtime.getURL('src/twitch-inject.js');
  script.onload = () => script.remove();
  // Use documentElement — works before <head> exists at document_start
  (document.head || document.documentElement).appendChild(script);
}

injectPageScript();

// Settings-gated message relay
chrome.runtime.sendMessage({ type: 'GET_SETTINGS' }, settings => {
  if (!settings?.enabled || !settings?.twitchAdBlock) return;

  window.addEventListener('message', e => {
    if (e.source !== window || !e.data?.__hbs) return;
    if (e.data.type === 'AD_SEGMENTS_STRIPPED') {
      chrome.runtime.sendMessage({
        type:    'TWITCH_AD_STRIPPED',
        count:   e.data.count,
        seconds: e.data.seconds,
      });
    }
  });
});
