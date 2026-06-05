# HexBlock Shield

<p align="center">
  <img src="banner.svg" alt="HexBlock Shield" width="900"/>
</p>

<p align="center">
  <a href="https://chromewebstore.google.com/detail/hexblock-shield/bmjflnnopehafhmelobgbjeobdhokifj"><img src="https://img.shields.io/badge/Chrome-Web%20Store-4285F4?style=flat-square&logo=googlechrome&logoColor=white" alt="Chrome Web Store"/></a>
  <a href="https://github.com/happygream/hexblock-shield/releases"><img src="https://img.shields.io/github/v/release/happygream/hexblock-shield?style=flat-square&color=00e8c0&label=version" alt="Version"/></a>
  <img src="https://img.shields.io/badge/manifest-v3-00e8c0?style=flat-square" alt="MV3"/>
  <img src="https://img.shields.io/badge/license-MIT-3d5a72?style=flat-square" alt="MIT"/>
</p>

<br/>

Browser extension for the [HexBlock](https://hexblock.co.uk) privacy gateway. Blocks ads and trackers at the network level, skips YouTube ads and sponsor segments, and strips Twitch stream ads from HLS playlists.

## Features

- **Ad blocking** — EasyList via declarativeNetRequest. Blocks ad requests before they load.
- **Tracker blocking** — EasyPrivacy. Blocks fingerprinting scripts and analytics.
- **YouTube** — Pre-roll and mid-roll ad skipping. SponsorBlock integration for sponsor segments, intros, outros, and self-promotion. Privacy-preserving — only a 4-character SHA-256 hash prefix of the video ID is sent to the API.
- **Twitch** — HLS M3U8 playlist ad segment stripping. Intercepts the stream playlist before the player loads it and removes ad discontinuity blocks. No proxying — everything runs locally in the browser.
- **Cosmetic filtering** — Hides ad placeholders and cookie banners that survive network-level blocking.
- **HexBlock gateway sync** — Optionally pull blocklists from your self-hosted HexBlock instance and report block events to the dashboard.

## Installation

| Browser | Store |
|---------|-------|
| Chrome | [Chrome Web Store](https://chromewebstore.google.com/detail/hexblock-shield/bmjflnnopehafhmelobgbjeobdhokifj) |
| Firefox | Firefox Add-ons — submission pending |
| Edge | Microsoft Edge Add-ons — submission pending |

### Manual install (developer mode)

1. Download the latest release zip from [Releases](https://github.com/happygream/hexblock-shield/releases)
2. Extract the zip
3. Go to `chrome://extensions` (Chrome) or `edge://extensions` (Edge)
4. Enable **Developer mode**
5. Click **Load unpacked** and select the extracted folder

For Firefox: go to `about:debugging#/runtime/this-firefox`, click **Load Temporary Add-on**, and select the `manifest.json` file.

## Project structure

```
hexblock-shield/
  manifest.json          Extension manifest (MV3)
  popup.html             Extension popup UI
  src/
    background.js        Service worker — settings, stats, gateway sync
    content.js           General cosmetic filtering on all pages
    youtube.js           YouTube ad skip and SponsorBlock
    twitch.js            Twitch HLS M3U8 ad segment stripper
    popup.js             Popup UI logic
    storage.js           Storage helpers
  lists/
    easylist.json        EasyList rules in declarativeNetRequest format
    easyprivacy.json     EasyPrivacy rules in declarativeNetRequest format
    youtube_ads.json     YouTube-specific ad request rules
  icons/
    icon16.png
    icon32.png
    icon48.png
    icon128.png
```

## How Twitch ad blocking works

Twitch embeds pre-roll ads at the server level via Amazon IVS before issuing stream tokens. **Complete pre-roll blocking requires a proxy** — no client-side extension can reliably stop them, and every approach that has worked has been patched by Twitch within weeks.

What HexBlock Shield does:

- **Hides and mutes the player during ad playback** — you see a dark HexBlock screen instead of the ad. The ad still loads in the background but is completely invisible and silent.
- **Blocks ad tracking and analytics requests** — spade.twitch.tv, adengine.twitch.tv, DoubleClick, IMA SDK.
- **Strips ad segments from M3U8 playlists** — works for VODs and some live streams where ads are embedded in the HLS playlist.

For complete pre-roll blocking, use [TTV LOL PRO](https://github.com/younesaassila/ttv-lol-pro) alongside HexBlock Shield. They do not conflict.

## HexBlock gateway

HexBlock Shield can optionally connect to a self-hosted [HexBlock](https://github.com/happygream/hexblock) instance to:

- Pull custom blocklists from your server
- Report block events to the HexBlock dashboard query log

Configure the gateway URL in the Settings tab of the extension popup.

## Permissions

| Permission | Why |
|------------|-----|
| `storage` | Save settings and per-tab stats |
| `declarativeNetRequest` | Block ad and tracker requests |
| `tabs` | Read current tab URL for the popup |
| `scripting` | Inject content scripts dynamically |
| `<all_urls>` | Apply cosmetic filtering on all pages |

## License

MIT — see [LICENSE](LICENSE)

## Related

- [HexBlock](https://github.com/happygream/hexblock) — self-hosted privacy gateway
- [hexblock.co.uk](https://hexblock.co.uk)
