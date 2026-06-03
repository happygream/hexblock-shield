/**
 * HexBlock Shield — YouTube content script
 *
 * Runs at document_start on all YouTube pages.
 *
 * Responsibilities:
 * - Skip pre-roll and mid-roll ads as quickly as possible
 * - Collapse ad UI elements
 * - Fetch SponsorBlock segments for the current video
 * - Monitor video playback and skip flagged segments
 */

'use strict';

const SB_API = 'https://sponsor.ajay.app';

// Segment categories we can skip, mapped to the settings key
const SEGMENT_CATEGORIES = {
  sponsor:            'sbSponsors',
  intro:              'sbIntros',
  outro:              'sbOutros',
  selfpromo:          'sbSelfPromo',
  interaction:        'sbSubscriptions',
  filler:             'sbFiller',
};

let settings        = {};
let sbSegments      = [];
let currentVideoId  = null;
let video           = null;
let pollInterval    = null;

// ── Boot ─────────────────────────────────────────────────────

async function init() {
  settings = await getSettings();
  if (!settings.enabled) return;
  observeNavigation();
  onPageLoad();
}

// ── Settings ─────────────────────────────────────────────────

async function getSettings() {
  return new Promise(resolve => {
    chrome.runtime.sendMessage({ type: 'GET_SETTINGS' }, resolve);
  });
}

// ── Navigation ───────────────────────────────────────────────

function observeNavigation() {
  let lastUrl = location.href;
  const checkUrl = () => {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      onPageLoad();
    }
  };
  window.addEventListener('yt-navigate-finish', checkUrl);
  window.addEventListener('popstate', checkUrl);
  setInterval(checkUrl, 1000);
}

function onPageLoad() {
  const videoId = getVideoId();
  if (!videoId || videoId === currentVideoId) return;
  currentVideoId = videoId;
  sbSegments     = [];
  clearInterval(pollInterval);

  waitForVideo().then(el => {
    video = el;
    if (settings.youtubeAdBlock) setupAdSkip();
    if (settings.sponsorBlock)   fetchSegments(videoId);
    pollInterval = setInterval(tick, 500);
  });
}

// ── Video detection ───────────────────────────────────────────

function getVideoId() {
  const params = new URLSearchParams(location.search);
  return params.get('v') || null;
}

async function waitForVideo(timeout = 10000) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const check = () => {
      const el = document.querySelector('video.html5-main-video');
      if (el) return resolve(el);
      if (Date.now() - start > timeout) return reject(new Error('timeout'));
      setTimeout(check, 200);
    };
    check();
  });
}

// ── Ad skipping ───────────────────────────────────────────────

function setupAdSkip() {
  skipAds();

  // Debounced observer — only watch the player container, not the whole page
  let debounceTimer = null;
  const debouncedSkip = () => {
    if (debounceTimer) return;
    debounceTimer = setTimeout(() => {
      debounceTimer = null;
      skipAds();
    }, 150);
  };

  const attachObserver = () => {
    const player = document.querySelector('#movie_player, #player, ytd-player');
    if (player) {
      const observer = new MutationObserver(debouncedSkip);
      observer.observe(player, {
        subtree: true,
        childList: true,
        attributes: true,
        attributeFilter: ['class'],
      });
    } else {
      setTimeout(attachObserver, 500);
    }
  };
  attachObserver();
}

function skipAds() {
  if (!settings.youtubeAdBlock) return;

  // Skip button — click as soon as it appears
  const skipBtn = document.querySelector(
    '.ytp-skip-ad-button, .ytp-ad-skip-button, [class*="skip-button"]'
  );
  if (skipBtn) {
    skipBtn.click();
    return;
  }

  // If an ad is playing and is skippable, jump to end to trigger skip
  const adShowing = document.querySelector('.ad-showing');
  if (adShowing && video) {
    const duration = video.duration;
    if (duration && isFinite(duration)) {
      video.currentTime = duration;
    }
    return;
  }

  // Collapse overlay ads and banner ads
  const overlays = document.querySelectorAll(
    '.ytp-ad-overlay-container, .ytp-ad-text-overlay, ' +
    '.ytd-banner-promo-renderer, #masthead-ad, ytd-ad-slot-renderer'
  );
  overlays.forEach(el => { el.style.display = 'none'; });
}

// ── SponsorBlock ──────────────────────────────────────────────

async function fetchSegments(videoId) {
  if (!settings.sponsorBlock) return;

  const categories = Object.keys(SEGMENT_CATEGORIES).filter(
    cat => settings[SEGMENT_CATEGORIES[cat]]
  );
  if (categories.length === 0) return;

  // SponsorBlock privacy: only a prefix of the SHA256 hash is sent,
  // not the full video ID
  const hashPrefix = await videoIdHashPrefix(videoId);
  const endpoint   = (settings.sbApiEndpoint || SB_API).replace(/\/$/, '');
  const url        = `${endpoint}/api/skipSegments/${hashPrefix}?categories=${JSON.stringify(categories)}`;

  try {
    const res  = await fetch(url);
    if (!res.ok) return;
    const data = await res.json();

    // Find the entry matching our exact video ID
    const entry = data.find(e => e.videoID === videoId);
    if (!entry) return;

    sbSegments = entry.segments.map(s => ({
      start:    s.segment[0],
      end:      s.segment[1],
      category: s.category,
      uuid:     s.UUID,
    }));
  } catch (_) {
    // Network error or API unavailable — fail silently
  }
}

async function videoIdHashPrefix(videoId) {
  const encoder = new TextEncoder();
  const data    = encoder.encode(videoId);
  const buffer  = await crypto.subtle.digest('SHA-256', data);
  const hex     = Array.from(new Uint8Array(buffer))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
  return hex.slice(0, 4); // Send only the first 4 hex chars
}

// ── Playback monitoring ───────────────────────────────────────

function tick() {
  if (!video || !settings.sponsorBlock || sbSegments.length === 0) return;

  const current = video.currentTime;
  for (const seg of sbSegments) {
    if (current >= seg.start && current < seg.end - 0.5) {
      video.currentTime = seg.end;
      chrome.runtime.sendMessage({
        type:    'SEGMENT_SKIPPED',
        segment: {
          videoId:  currentVideoId,
          category: seg.category,
          duration: seg.end - seg.start,
        },
      });
      break;
    }
  }
}

// ── Start ─────────────────────────────────────────────────────

init().catch(console.error);
