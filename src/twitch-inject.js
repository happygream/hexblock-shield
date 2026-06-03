/**
 * HexBlock Shield — Twitch ad remover (page context)
 *
 * Amazon IVS player approach:
 * 1. Block ad decision requests via fetch/XHR intercept
 * 2. Mute + skip video during ad playback
 * 3. Remove ad overlay UI elements
 */

(function() {
  'use strict';

  if (window.__hbsTwitchActive) return;
  window.__hbsTwitchActive = true;

  // ── Ad decision endpoints to block ──────────────────────────
  const AD_ENDPOINTS = [
    'amazon-ivs-wasmworker',
    'ad-decision',
    'adengine',
    'ads.twitch.tv',
    'spade.twitch.tv',
    'client-event-reporter',
    'twitchgaming.com/ads',
    '/v1/ad-decision',
    'pagead',
    'doubleclick',
    'adforensics',
  ];

  function isAdRequest(url) {
    return AD_ENDPOINTS.some(ep => url.includes(ep));
  }

  // ── M3U8 ad strip (legacy HLS path, still used for VODs) ────
  function stripM3U8Ads(text) {
    const lines = text.split('\n');
    const out = [];
    let inAd = false;
    let stripped = 0;
    let adSecs = 0;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();

      if (
        line.includes('stitched-ad') ||
        line.includes('X-TV-TWITCH-AD') ||
        line.includes('EXT-X-AD') ||
        line.includes('ad-identifier')
      ) {
        inAd = true; stripped++; continue;
      }

      if (inAd) {
        if (line.includes('X-TV-TWITCH-AD-RESTING') || 
            (line.startsWith('#EXT-X-DISCONTINUITY') && i > 2)) {
          inAd = false;
          out.push('#EXT-X-DISCONTINUITY');
          continue;
        }
        if (line.startsWith('#EXTINF:')) {
          const d = parseFloat(line.replace('#EXTINF:','').replace(',',''));
          if (!isNaN(d)) adSecs += d;
        }
        continue;
      }
      out.push(lines[i]);
    }

    if (stripped > 0) {
      window.postMessage({ __hbs: 'twitch', type: 'AD_SEGMENTS_STRIPPED', count: stripped, seconds: Math.round(adSecs) }, '*');
    }
    return out.join('\n');
  }

  // ── Fetch intercept ──────────────────────────────────────────
  const _fetch = window.fetch;
  window.fetch = async function(input, init) {
    const url = (typeof input === 'string' ? input : input?.url) || '';

    // Block ad decision requests
    if (isAdRequest(url)) {
      return new Response('', { status: 200, headers: { 'Content-Type': 'text/plain' } });
    }

    const response = await _fetch.apply(this, arguments);

    // Strip M3U8 ads (VODs / legacy streams)
    if (url.includes('.m3u8') || (response.headers.get('content-type') || '').includes('mpegurl')) {
      try {
        const text = await response.text();
        const cleaned = stripM3U8Ads(text);
        return new Response(cleaned, { status: response.status, statusText: response.statusText, headers: response.headers });
      } catch(_) { return response; }
    }

    return response;
  };

  // ── XHR intercept ────────────────────────────────────────────
  const _open = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function(method, url) {
    this.__hbsUrl = url;
    if (isAdRequest(url)) {
      this.__hbsBlock = true;
    }
    return _open.apply(this, arguments);
  };

  const _send = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.send = function() {
    if (this.__hbsBlock) {
      // Fake a successful empty response
      Object.defineProperty(this, 'status', { get: () => 200 });
      Object.defineProperty(this, 'responseText', { get: () => '' });
      Object.defineProperty(this, 'response', { get: () => '' });
      setTimeout(() => {
        Object.defineProperty(this, 'readyState', { get: () => 4 });
        this.onload && this.onload();
        this.onreadystatechange && this.onreadystatechange();
      }, 1);
      return;
    }
    return _send.apply(this, arguments);
  };

})();
