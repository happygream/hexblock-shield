/**
 * HexBlock Shield — Twitch ad remover (page context)
 *
 * Pre-roll ad approach:
 * Twitch pre-roll ads are triggered by specific tokens in the stream URL
 * and by the usher.twitchapps.com playlist response.
 *
 * Strategy:
 * 1. Intercept the usher.twitchapps.com M3U8 request EARLY
 * 2. Add sig/token parameters that signal no-ad to the Twitch backend
 * 3. Strip ad segments from playlist response
 * 4. Block ad decision API calls
 * 5. Remove ad overlay UI via DOM observer
 */

(function() {
  'use strict';

  if (window.__hbsTwitchActive) return;
  window.__hbsTwitchActive = true;

  // ── Ad decision endpoints ────────────────────────────────────
  const AD_ENDPOINTS = [
    'ads.twitch.tv',
    'adengine.twitch.tv',
    'adforensics',
    '/v1/ad-decision',
    'imasdk.googleapis.com',
    'pagead2.googlesyndication.com',
    'pubads.g.doubleclick.net',
    'securepubads.g.doubleclick.net',
  ];

  // ── Usher/stream URLs that carry the playlist ────────────────
  const STREAM_HOSTS = [
    'usher.twitchapps.com',
    'hls.twitchapps.com',
  ];

  function isAdRequest(url) {
    return AD_ENDPOINTS.some(ep => url.includes(ep));
  }

  function isStreamRequest(url) {
    return STREAM_HOSTS.some(h => url.includes(h)) || url.includes('.m3u8');
  }

  // ── Rewrite stream URL to request ad-free variant ────────────
  // Twitch uses sig/token params — requesting with fast_bread=true
  // and certain sig params triggers the low-latency no-ad path
  function rewriteStreamUrl(url) {
    try {
      const u = new URL(url);
      // Request the low-latency ad-free stream variant
      u.searchParams.set('fast_bread', 'true');
      u.searchParams.set('platform', 'web');
      u.searchParams.delete('cdm');
      // Remove ad-related params
      u.searchParams.delete('ad_tag');
      u.searchParams.delete('ad_session_id');
      return u.toString();
    } catch(_) {
      return url;
    }
  }

  // ── M3U8 ad segment stripper ─────────────────────────────────
  function stripM3U8(text) {
    const lines = text.split('\n');
    const out = [];
    let inAd = false;
    let stripped = 0;
    let adSecs = 0;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();

      // Detect ad start markers
      if (
        line.includes('stitched-ad') ||
        line.includes('X-TV-TWITCH-AD') ||
        line.includes('EXT-X-AD') ||
        line.includes('ad-identifier') ||
        line.includes('X-RESTRICT') ||
        (line.startsWith('#EXT-X-DATERANGE') && line.includes('CLASS="twitch-stitched-ad"'))
      ) {
        inAd = true;
        stripped++;
        continue;
      }

      if (inAd) {
        // Detect return to content
        if (
          line.includes('X-TV-TWITCH-AD-RESTING') ||
          line.includes('X-UNRESTRICT') ||
          (line.startsWith('#EXT-X-DISCONTINUITY') && i > 3)
        ) {
          inAd = false;
          out.push('#EXT-X-DISCONTINUITY');
          continue;
        }
        if (line.startsWith('#EXTINF:')) {
          const d = parseFloat(line.replace('#EXTINF:', '').replace(',', ''));
          if (!isNaN(d)) adSecs += d;
        }
        continue;
      }

      out.push(lines[i]);
    }

    if (stripped > 0) {
      window.postMessage({
        __hbs: 'twitch', type: 'AD_SEGMENTS_STRIPPED',
        count: stripped, seconds: Math.round(adSecs),
      }, '*');
    }

    return out.join('\n');
  }

  // ── Fetch intercept ──────────────────────────────────────────
  const _fetch = window.fetch;
  window.fetch = async function(input, init) {
    let url = (typeof input === 'string' ? input : input?.url) || '';

    // Block ad decision requests — return empty 200
    if (isAdRequest(url)) {
      return new Response('', { status: 200 });
    }

    // Rewrite stream URL to request ad-free variant
    if (isStreamRequest(url) && url.includes('usher.twitchapps.com')) {
      url = rewriteStreamUrl(url);
      input = typeof input === 'string' ? url : new Request(url, input);
    }

    let response;
    try {
      response = await _fetch.call(this, input, init);
    } catch(e) {
      throw e;
    }

    // Strip ads from M3U8 playlist responses
    if (isStreamRequest(url)) {
      const ct = response.headers.get('content-type') || '';
      if (url.includes('.m3u8') || ct.includes('mpegurl') || ct.includes('x-mpegurl')) {
        try {
          const text = await response.text();
          const cleaned = stripM3U8(text);
          return new Response(cleaned, {
            status: response.status,
            statusText: response.statusText,
            headers: response.headers,
          });
        } catch(_) {
          return response;
        }
      }
    }

    return response;
  };

  // ── XHR intercept ────────────────────────────────────────────
  const _xhrOpen = XMLHttpRequest.prototype.open;
  const _xhrSend = XMLHttpRequest.prototype.send;

  XMLHttpRequest.prototype.open = function(method, url, ...rest) {
    this.__hbsUrl = url || '';
    this.__hbsBlock = isAdRequest(this.__hbsUrl);
    if (isStreamRequest(this.__hbsUrl) && this.__hbsUrl.includes('usher.twitchapps.com')) {
      url = rewriteStreamUrl(url);
      this.__hbsUrl = url;
    }
    return _xhrOpen.call(this, method, url, ...rest);
  };

  XMLHttpRequest.prototype.send = function(body) {
    if (this.__hbsBlock) {
      setTimeout(() => {
        try {
          Object.defineProperty(this, 'readyState', { get: () => 4, configurable: true });
          Object.defineProperty(this, 'status', { get: () => 200, configurable: true });
          Object.defineProperty(this, 'responseText', { get: () => '', configurable: true });
          this.onload?.();
          this.onreadystatechange?.();
        } catch(_) {}
      }, 1);
      return;
    }
    return _xhrSend.call(this, body);
  };

  // ── Ad overlay DOM removal ────────────────────────────────────
  const AD_SELECTORS = [
    '[data-a-target="ad-banner"]',
    '[data-test-selector="ad-banner-default-wrapper"]',
    '.video-ads',
    '.ad-banner',
    '[class*="video-ad"]',
    '[class*="VideoAdUpsell"]',
    '[data-test-selector="subscribe-button--ad"]',
    '.ad-countdown',
    '[class*="ad-countdown"]',
  ];

  function removeAdOverlays() {
    AD_SELECTORS.forEach(sel => {
      document.querySelectorAll(sel).forEach(el => {
        el.style.setProperty('display', 'none', 'important');
      });
    });

    // Mute + fast-forward if ad is detected playing
    const video = document.querySelector('video');
    const isAdPlaying = !!document.querySelector(
      '[data-a-target="ad-banner"], .video-ads .tw-absolute, [class*="VideoAdUpsell"]'
    );
    if (isAdPlaying && video) {
      video.muted = true;
      if (isFinite(video.duration) && video.duration > 0) {
        video.currentTime = video.duration - 0.1;
      }
    }
  }

  // Start DOM observer immediately
  function startObserver() {
    removeAdOverlays();
    const obs = new MutationObserver(removeAdOverlays);
    obs.observe(document.documentElement, { childList: true, subtree: true });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', startObserver);
  } else {
    startObserver();
  }

  // Also run on Twitch SPA navigation (pushState)
  const _pushState = history.pushState;
  history.pushState = function(...args) {
    _pushState.apply(this, args);
    setTimeout(removeAdOverlays, 500);
    setTimeout(removeAdOverlays, 1500); // second pass after player loads
  };

})();
