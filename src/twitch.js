/**
 * HexBlock Shield — Twitch ad blocker
 *
 * Injects twitch-inject.js into the page context via a <script src> tag
 * to intercept fetch() and XHR before Twitch's player loads.
 * Using src= avoids CSP inline script violations.
 */

'use strict';

if (!location.hostname.endsWith('twitch.tv')) {
  throw new Error('HexBlock Shield Twitch: wrong host');
}

async function getSettings() {
  return new Promise(resolve => {
    chrome.runtime.sendMessage({ type: 'GET_SETTINGS' }, result => {
      resolve(result || {});
    });
  });
}

async function init() {
  const settings = await getSettings();
  if (!settings.enabled || !settings.twitchAdBlock) return;

  injectPageScript();
  listenForMessages();
}

function injectPageScript() {
  const script = document.createElement('script');
  script.src = chrome.runtime.getURL('src/twitch-inject.js');
  script.onload = () => script.remove();
  (document.head || document.documentElement).appendChild(script);
}

function listenForMessages() {
  window.addEventListener('message', e => {
    if (e.source !== window) return;
    if (!e.data || e.data.__hbs !== 'twitch') return;

    if (e.data.type === 'AD_SEGMENTS_STRIPPED') {
      chrome.runtime.sendMessage({
        type:    'TWITCH_AD_STRIPPED',
        count:   e.data.count,
        seconds: e.data.seconds,
      });
    }
  });
}

init().catch(console.error);
