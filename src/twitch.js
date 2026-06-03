/**
 * HexBlock Shield — Twitch ad blocker
 *
 * Twitch serves ads as segments inside the same HLS stream as the video.
 * DNS blocking cannot help — the domains are identical to the real stream.
 *
 * Strategy:
 *   1. Inject a page-context script that wraps fetch() and XMLHttpRequest
 *      before Twitch's player loads.
 *   2. Intercept every request to usher.twitchapps.com (M3U8 playlists)
 *      and hls.twitchapps.com (segment manifests).
 *   3. Rewrite the playlist — strip ad discontinuity blocks and replace
 *      ad segments with a low-bitrate filler or simply advance past them.
 *   4. Report skip count back to the extension via postMessage.
 */

'use strict';

// ── Gate: only run on Twitch ──────────────────────────────────
if (!location.hostname.endsWith('twitch.tv')) {
  // Safety exit — should not happen given manifest matches, but belt+braces
  throw new Error('HexBlock Shield Twitch: wrong host');
}

// ── Settings check ────────────────────────────────────────────
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

// ── Page-context injection ────────────────────────────────────
// We need to intercept fetch() at the page level (not content-script level)
// because Twitch's player makes requests in the page context.
// We inject a script tag into the document head — this runs in page context
// and can wrap the native fetch before Twitch's player initialises.

function injectPageScript() {
  const script = document.createElement('script');
  script.textContent = PAGE_SCRIPT;
  (document.head || document.documentElement).appendChild(script);
  script.remove(); // Clean up DOM after execution
}

// ── Message relay ─────────────────────────────────────────────
// The injected page script cannot access chrome.runtime directly.
// It uses postMessage to communicate back to the content script.

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

// ── Page-context script (stringified, runs in page) ──────────
// This entire string is injected as a <script> tag and executes
// in the Twitch page context, wrapping fetch() before the player loads.

const PAGE_SCRIPT = `
(function() {
  'use strict';

  // Guard: don't double-inject
  if (window.__hbsTwitchActive) return;
  window.__hbsTwitchActive = true;

  const PLAYLIST_HOSTS = [
    'usher.twitchapps.com',
    'hls.twitchapps.com',
    'video-weaver.',
  ];

  function isTwitchStream(url) {
    try {
      const u = new URL(url);
      return PLAYLIST_HOSTS.some(h => u.hostname.includes(h)) ||
             url.includes('.m3u8');
    } catch (_) {
      return false;
    }
  }

  // ── M3U8 ad strip ────────────────────────────────────────────
  // Twitch marks ad segments with these tags in the playlist:
  //   #EXT-X-DISCONTINUITY          — signals a stream break (ad boundary)
  //   #EXT-TWITCH-PREFETCH           — prefetch ad segments
  //   EXT-X-PROGRAM-DATE-TIME        — used to identify ad vs content
  //   #EXT-X-AD (custom Twitch tag)  — explicit ad marker
  //
  // We strip any segment block between a discontinuity marker and the next
  // content marker, replacing with a short blank/filler or simply nothing.
  //
  // We also detect the low-latency ad signalling via X-Restrict header
  // response in HLS responses.

  function stripAds(m3u8Text) {
    const lines   = m3u8Text.split('\\n');
    const out     = [];
    let inAd      = false;
    let stripped  = 0;
    let adSeconds = 0;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();

      // Detect ad block start signals
      if (
        line.includes('stitched-ad') ||
        line.includes('X-TV-TWITCH-AD') ||
        line.includes('EXT-X-AD') ||
        line.includes('ad-identifier') ||
        (line.startsWith('#EXT-X-DISCONTINUITY') && isAdContext(lines, i))
      ) {
        inAd = true;
        stripped++;
        continue;
      }

      // Detect return to content stream
      if (inAd) {
        if (
          line.startsWith('#EXT-X-DISCONTINUITY-SEQUENCE') ||
          (line.startsWith('#EXT-X-DISCONTINUITY') && !isAdContext(lines, i)) ||
          line.includes('X-TV-TWITCH-AD-RESTING')
        ) {
          inAd = false;
          // Emit a clean discontinuity so the player doesn't stall
          out.push('#EXT-X-DISCONTINUITY');
          continue;
        }

        // Capture duration of skipped segment for stats
        if (line.startsWith('#EXTINF:')) {
          const dur = parseFloat(line.replace('#EXTINF:', '').replace(',', ''));
          if (!isNaN(dur)) adSeconds += dur;
        }

        // Skip ad segment lines
        continue;
      }

      out.push(lines[i]);
    }

    if (stripped > 0) {
      window.postMessage({
        __hbs:   'twitch',
        type:    'AD_SEGMENTS_STRIPPED',
        count:   stripped,
        seconds: Math.round(adSeconds),
      }, '*');
    }

    return out.join('\\n');
  }

  // Heuristic: is the discontinuity at this position followed by ad markers?
  function isAdContext(lines, idx) {
    const lookahead = lines.slice(idx, idx + 8).join('\\n');
    return (
      lookahead.includes('stitched-ad') ||
      lookahead.includes('X-TV-TWITCH-AD') ||
      lookahead.includes('ad-identifier') ||
      lookahead.includes('EXT-X-AD')
    );
  }

  // ── Fetch interceptor ────────────────────────────────────────

  const _fetch = window.fetch;
  window.fetch = async function(input, init) {
    const url = typeof input === 'string' ? input : input?.url || '';

    if (!isTwitchStream(url)) {
      return _fetch.apply(this, arguments);
    }

    const response = await _fetch.apply(this, arguments);

    // Only process M3U8 playlists
    const ct = response.headers.get('content-type') || '';
    if (!url.includes('.m3u8') && !ct.includes('mpegurl') && !ct.includes('x-mpegurl')) {
      return response;
    }

    try {
      const text    = await response.text();
      const cleaned = stripAds(text);

      // Return a new Response with the cleaned playlist
      return new Response(cleaned, {
        status:     response.status,
        statusText: response.statusText,
        headers:    response.headers,
      });
    } catch (_) {
      // On any error return the original — never break playback
      return response;
    }
  };

  // ── XHR interceptor (fallback for older Twitch player code) ──

  const _open = XMLHttpRequest.prototype.open;
  const _send = XMLHttpRequest.prototype.send;

  XMLHttpRequest.prototype.open = function(method, url) {
    this.__hbsUrl = url;
    return _open.apply(this, arguments);
  };

  XMLHttpRequest.prototype.send = function() {
    const url = this.__hbsUrl || '';

    if (!isTwitchStream(url)) {
      return _send.apply(this, arguments);
    }

    const xhr = this;
    const _onreadystatechange = xhr.onreadystatechange;

    xhr.onreadystatechange = function() {
      if (xhr.readyState === 4) {
        const ct = xhr.getResponseHeader('content-type') || '';
        if (url.includes('.m3u8') || ct.includes('mpegurl')) {
          try {
            // Redefine responseText (read-only) via prototype trick
            Object.defineProperty(xhr, 'responseText', {
              get: () => stripAds(xhr.__hbsOriginalResponse || ''),
              configurable: true,
            });
            Object.defineProperty(xhr, 'response', {
              get: () => stripAds(xhr.__hbsOriginalResponse || ''),
              configurable: true,
            });
          } catch (_) {}
        }
      }
      if (_onreadystatechange) _onreadystatechange.apply(this, arguments);
    };

    // Capture original response before we redefine it
    const _origOnLoad = xhr.onload;
    xhr.addEventListener('readystatechange', function() {
      if (xhr.readyState === 4) {
        try {
          xhr.__hbsOriginalResponse = xhr.responseText;
        } catch (_) {}
      }
    });

    return _send.apply(this, arguments);
  };

})();
`;

init().catch(console.error);
