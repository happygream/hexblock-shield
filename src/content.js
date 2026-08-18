/**
 * HexBlock Shield — general content script
 *
 * Runs on all pages at document_end.
 * Handles cosmetic filtering — hiding ad placeholders and injected
 * banners that survive network-level blocking.
 */

'use strict';

// CSS selectors for common ad placeholder and banner elements
// that remain in the DOM after the network request is blocked
const COSMETIC_SELECTORS = [
  // Generic ad containers — specific to avoid false positives
  '[id^="google_ads_iframe"]',
  '[id^="div-gpt-ad"]',
  '[class="adsbygoogle"]',
  'ins.adsbygoogle',
  // Cookie consent banners
  '#cookie-banner',
  '#gdpr-banner',
  '.cookie-notice',
  '.consent-banner',
  '[id="cookie-consent"]',
  '[id="cookieConsent"]',
  // Newsletter popups
  '.newsletter-popup',
  '[class="signup-modal"]',
];

async function getSettings() {
  return new Promise(resolve => {
    chrome.runtime.sendMessage({ type: 'GET_SETTINGS' }, result => {
      resolve(result || {});
    });
  });
}

async function run() {
  const settings = await getSettings();
  if (!settings.enabled || !settings.cosmeticFiltering) return;

  // Skip on HexBlock watch page and YouTube nocookie embed
  const hn = location.hostname;
  if (hn === 'hexblock.co.uk' || hn.includes('youtube-nocookie')) return;

  // Initial pass
  hideElements();

  // Watch for dynamically injected elements
  const observer = new MutationObserver(hideElements);
  observer.observe(document.body, { childList: true, subtree: true });
}

function hideElements() {
  for (const selector of COSMETIC_SELECTORS) {
    try {
      document.querySelectorAll(selector).forEach(el => {
        if (el.style.display !== 'none') {
          el.style.setProperty('display', 'none', 'important');
        }
      });
    } catch (_) {
      // Invalid selector in some browser versions — skip it
    }
  }
}

run().catch(() => {});

// ── Twitch ad overlay removal ─────────────────────────────────
async function runTwitchAdRemover() {
  if (!location.hostname.endsWith('twitch.tv')) return;

  const s = await getSettings();
  if (!s?.enabled || !s?.twitchAdBlock) return;

  const AD_SELECTORS = [
    // Ad banner overlay
    '[data-a-target="ad-banner"]',
    '[data-test-selector="ad-banner-default-wrapper"]',
    '.video-ads.tw-absolute',
    '.tw-absolute.video-ads',
    // Subscribe to remove ads prompt
    '[data-test-selector="subscribe-button--ad"]',
    // Ad countdown
    '.ad-countdown',
    '[data-test-selector="paid-pinned-chat-message-wrapper"]',
  ];

  function removeAdElements() {
    AD_SELECTORS.forEach(sel => {
      document.querySelectorAll(sel).forEach(el => {
        el.style.setProperty('display', 'none', 'important');
      });
    });

    // If ad is playing, mute video and try to skip
    const video = document.querySelector('video');
    const adOverlay = document.querySelector('[data-a-target="ad-overlay"]') ||
                      document.querySelector('.ad-interruption');
    if (adOverlay && video) {
      video.muted = true;
      // Try to jump to end of ad
      if (video.duration && isFinite(video.duration)) {
        video.currentTime = video.duration - 0.1;
      }
    }
  }

  // Run immediately and watch for changes
  removeAdElements();
  const observer = new MutationObserver(removeAdElements);
  observer.observe(document.body, { childList: true, subtree: true });
}

runTwitchAdRemover().catch(() => {});
async function injectWatchBanner() {
  // Only on YouTube watch pages
  if (!location.hostname.includes('youtube.com')) return;

  const videoId = new URLSearchParams(location.search).get('v');
  if (!videoId) return;

  // Don't inject twice
  if (document.getElementById('hb-watch-banner')) return;

  const s = await new Promise(resolve =>
    chrome.runtime.sendMessage({ type: 'GET_SETTINGS' }, resolve)
  );
  if (!s?.enabled) return;

  const banner = document.createElement('div');
  banner.id = 'hb-watch-banner';
  banner.style.cssText = `
    position: fixed; top: 0; left: 0; right: 0; z-index: 99999;
    background: #0c1018; border-bottom: 1px solid #1c2736;
    display: flex; align-items: center; justify-content: center; gap: 12px;
    padding: 9px 16px; font-family: 'JetBrains Mono', monospace; font-size: 12px;
    color: #b8ccd8; transform: translateY(-100%);
    transition: transform 0.3s ease; pointer-events: all;
  `;

  // Validate videoId against YouTube's known format before using it anywhere.
  // YouTube IDs are exactly 11 chars from [A-Za-z0-9_-]. Anything else is
  // discarded — this prevents any markup/attribute injection via the URL.
  if (!/^[A-Za-z0-9_-]{11}$/.test(videoId)) return;

  // Build with DOM APIs (no innerHTML) so nothing from the URL is parsed as HTML.
  const svgNS = 'http://www.w3.org/2000/svg';
  const logo = document.createElementNS(svgNS, 'svg');
  logo.setAttribute('width', '14'); logo.setAttribute('height', '14');
  logo.setAttribute('viewBox', '0 0 40 46'); logo.setAttribute('fill', 'none');
  logo.style.flexShrink = '0';
  const logoPath = document.createElementNS(svgNS, 'path');
  logoPath.setAttribute('d', 'M20 2L37 11.5V30.5L20 40L3 30.5V11.5L20 2Z');
  logoPath.setAttribute('stroke', '#00e5b8'); logoPath.setAttribute('stroke-width', '2.5');
  logoPath.setAttribute('fill', 'rgba(0,229,184,0.07)');
  logo.appendChild(logoPath);

  const lead = document.createElement('span');
  lead.style.color = '#3d5568';
  lead.textContent = 'Watch this video ad-free on';

  const brand = document.createElement('span');
  brand.style.cssText = 'color:#00e5b8;font-weight:600;';
  brand.textContent = 'HexBlock';

  const link = document.createElement('a');
  link.href = 'https://hexblock.co.uk/watch?v=' + encodeURIComponent(videoId);
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  link.textContent = 'Watch free';
  link.style.cssText = `
    display:inline-flex;align-items:center;gap:6px;
    background:#00e5b8;color:#050709;
    font-size:11px;font-weight:600;letter-spacing:0.08em;text-transform:uppercase;
    padding:6px 14px;text-decoration:none;
    clip-path:polygon(6px 0%,100% 0%,calc(100% - 6px) 100%,0% 100%);
    transition:background 0.1s;
  `;
  link.addEventListener('mouseover', () => { link.style.background = '#00c9a0'; });
  link.addEventListener('mouseout',  () => { link.style.background = '#00e5b8'; });

  const closeBtn = document.createElement('button');
  closeBtn.id = 'hb-banner-close';
  closeBtn.textContent = '\u00d7';
  closeBtn.style.cssText = `
    background:none;border:none;color:#3d5568;cursor:pointer;
    font-size:16px;padding:0 4px;line-height:1;margin-left:8px;
  `;

  banner.append(logo, lead, brand, link, closeBtn);
  // Animate in
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      banner.style.transform = 'translateY(0)';
    });
  });

  document.getElementById('hb-banner-close').addEventListener('click', () => {
    banner.style.transform = 'translateY(-100%)';
    setTimeout(() => banner.remove(), 350);
  });
}

// Wait for page to settle then inject
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => setTimeout(injectWatchBanner, 1500));
} else {
  setTimeout(injectWatchBanner, 1500);
}

// Also handle YouTube SPA navigation
let _lastYTUrl = location.href;
setInterval(() => {
  if (location.href !== _lastYTUrl) {
    _lastYTUrl = location.href;
    const existing = document.getElementById('hb-watch-banner');
    if (existing) existing.remove();
    setTimeout(injectWatchBanner, 1500);
  }
}, 1000);
