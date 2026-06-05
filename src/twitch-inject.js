/**
 * HexBlock Shield — Twitch ad handler
 *
 * Honest status on Twitch pre-roll blocking (June 2026):
 * Twitch serves pre-roll ads via Amazon IVS at the server level before
 * issuing stream tokens. Client-side blocking is unreliable and breaks
 * frequently as Twitch updates their player.
 *
 * What this script does reliably:
 * 1. Mutes + hides the player during ad playback (ad plays silently invisible)
 * 2. Unmutes + restores the player when the stream starts
 * 3. Removes ad overlay UI elements
 * 4. Blocks ad tracking/analytics requests
 * 5. Strips ad segments from M3U8 playlists (VODs + some live streams)
 *
 * For complete pre-roll blocking a proxy is required.
 * TTV LOL PRO is the most reliable option: https://github.com/younesaassila/ttv-lol-pro
 */

(function() {
  'use strict';

  if (window.__hbsTwitchActive) return;
  window.__hbsTwitchActive = true;

  // ── Ad tracking endpoints to block ───────────────────────────
  const AD_TRACK_ENDPOINTS = [
    'ads.twitch.tv',
    'adengine.twitch.tv',
    'adforensics',
    'spade.twitch.tv',
    'imasdk.googleapis.com',
    'pagead2.googlesyndication.com',
    'pubads.g.doubleclick.net',
    'securepubads.g.doubleclick.net',
    'client-event-reporter.twitch.tv',
  ];

  function isAdTracker(url) {
    return AD_TRACK_ENDPOINTS.some(ep => url.includes(ep));
  }

  // ── Fetch intercept — block ad trackers ──────────────────────
  const _fetch = window.fetch;
  window.fetch = async function(input, init) {
    const url = (typeof input === 'string' ? input : input?.url) || '';
    if (isAdTracker(url)) {
      return new Response('', { status: 200 });
    }
    const response = await _fetch.apply(this, arguments);
    // Strip M3U8 ad segments (works for VODs + some live streams)
    if (url.includes('.m3u8') || (response.headers.get('content-type') || '').includes('mpegurl')) {
      try {
        const text    = await response.text();
        const cleaned = stripM3U8(text);
        if (cleaned !== text) {
          return new Response(cleaned, { status: response.status, statusText: response.statusText, headers: response.headers });
        }
      } catch(_) {}
    }
    return response;
  };

  // ── M3U8 ad segment stripper ─────────────────────────────────
  function stripM3U8(text) {
    const lines = text.split('\n');
    const out   = [];
    let inAd    = false;
    let count   = 0;
    let secs    = 0;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (line.includes('stitched-ad') || line.includes('X-TV-TWITCH-AD') ||
          line.includes('ad-identifier') || line.includes('EXT-X-AD') ||
          (line.startsWith('#EXT-X-DATERANGE') && line.includes('twitch-stitched-ad'))) {
        inAd = true; count++; continue;
      }
      if (inAd) {
        if (line.includes('X-TV-TWITCH-AD-RESTING') || line.includes('X-UNRESTRICT')) {
          inAd = false;
          out.push('#EXT-X-DISCONTINUITY');
          continue;
        }
        if (line.startsWith('#EXTINF:')) {
          const d = parseFloat(line.replace('#EXTINF:', '').replace(',', ''));
          if (!isNaN(d)) secs += d;
        }
        continue;
      }
      out.push(lines[i]);
    }

    if (count > 0) {
      window.postMessage({ __hbs: 'twitch', type: 'AD_SEGMENTS_STRIPPED', count, seconds: Math.round(secs) }, '*');
    }
    return out.join('\n');
  }

  // ── XHR intercept ────────────────────────────────────────────
  const _xhrOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function(method, url, ...rest) {
    this.__hbsUrl   = url || '';
    this.__hbsBlock = isAdTracker(this.__hbsUrl);
    return _xhrOpen.call(this, method, url, ...rest);
  };

  const _xhrSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.send = function(body) {
    if (this.__hbsBlock) {
      setTimeout(() => {
        try {
          Object.defineProperty(this, 'readyState', { get: () => 4, configurable: true });
          Object.defineProperty(this, 'status',    { get: () => 200, configurable: true });
          Object.defineProperty(this, 'responseText', { get: () => '', configurable: true });
          this.onload?.();
          this.onreadystatechange?.();
        } catch(_) {}
      }, 1);
      return;
    }
    return _xhrSend.call(this, body);
  };

  // ── Ad detection + mute/hide ──────────────────────────────────
  // Twitch sets specific class names and data attributes during ad playback.
  // We detect these and hide the video player + mute it completely.
  // The user sees a dark screen with a message instead of the ad.

  const AD_PLAYING_SELECTORS = [
    '[data-a-target="ad-banner"]',
    '[data-test-selector="ad-banner-default-wrapper"]',
    '.video-ads',
    '[class*="VideoAdUpsell"]',
    '.ad-countdown',
  ];

  let adOverlay   = null;
  let wasAdPlaying = false;

  function isAdCurrentlyPlaying() {
    return AD_PLAYING_SELECTORS.some(sel => document.querySelector(sel));
  }

  function createAdOverlay() {
    if (adOverlay) return;
    adOverlay = document.createElement('div');
    adOverlay.id = '__hbs-ad-overlay';
    adOverlay.style.cssText = `
      position:fixed;top:0;left:0;right:0;bottom:0;
      background:#080a10;z-index:9999;
      display:flex;flex-direction:column;align-items:center;justify-content:center;
      font-family:'JetBrains Mono','Courier New',monospace;
    `;
    adOverlay.innerHTML = `
      <div style="width:48px;height:56px;margin-bottom:20px;">
        <svg viewBox="0 0 40 46" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M20 2L37 11.5V30.5L20 40L3 30.5V11.5L20 2Z" stroke="#00e8c0" stroke-width="2" fill="rgba(0,232,192,.07)"/>
          <path d="M20 10L30 15.8V27.2L20 33L10 27.2V15.8L20 10Z" fill="rgba(0,232,192,.2)" stroke="#00e8c0" stroke-width="1"/>
        </svg>
      </div>
      <div style="color:#00e8c0;font-size:11px;letter-spacing:.2em;text-transform:uppercase;margin-bottom:8px;">Ad break</div>
      <div style="color:#3d5a72;font-size:10px;letter-spacing:.1em;">HexBlock Shield is hiding this ad</div>
    `;
    document.body.appendChild(adOverlay);
  }

  function removeAdOverlay() {
    if (adOverlay) {
      adOverlay.remove();
      adOverlay = null;
    }
  }

  function handleAdState() {
    const adPlaying = isAdCurrentlyPlaying();
    const video     = document.querySelector('video');

    if (adPlaying && !wasAdPlaying) {
      // Ad just started
      wasAdPlaying = true;
      if (video) { video.muted = true; video.style.opacity = '0'; }
      createAdOverlay();
      // Hide Twitch's own ad overlay elements
      AD_PLAYING_SELECTORS.forEach(sel => {
        document.querySelectorAll(sel).forEach(el => {
          el.style.setProperty('display', 'none', 'important');
        });
      });
    } else if (!adPlaying && wasAdPlaying) {
      // Ad just ended
      wasAdPlaying = false;
      if (video) { video.muted = false; video.style.opacity = '1'; }
      removeAdOverlay();
    }
  }

  // ── DOM observer ─────────────────────────────────────────────
  function startObserver() {
    handleAdState();
    const obs = new MutationObserver(handleAdState);
    obs.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'data-a-target'] });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', startObserver);
  } else {
    startObserver();
  }

  // ── SPA navigation ───────────────────────────────────────────
  const _push = history.pushState;
  history.pushState = function(...args) {
    _push.apply(this, args);
    setTimeout(handleAdState, 500);
    setTimeout(handleAdState, 2000);
  };

})();
