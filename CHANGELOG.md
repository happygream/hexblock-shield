# Changelog

All notable changes to HexBlock Shield are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.3.1] — 2026-08-17

### Fixed
- **Rebuilt the filter lists from genuine upstream EasyList and EasyPrivacy.**
  The previous bundled lists contained whole-domain block rules for legitimate
  websites (e.g. major news sites and link shorteners) with no third-party
  restriction, which broke those sites entirely and could break unrelated sites
  that loaded resources from those domains. The lists are now generated from the
  real upstream sources: ad and tracker rules target specific ad paths and
  third-party ad domains, never whole first-party sites. `$third-party`
  restriction is preserved so an ad-domain rule only fires when the domain is
  loaded as a third party on another site.
- Rules are curated to a single ruleset of ~24,000 entries, safely under the
  Chromium 30,000 enabled-static-rule guarantee, so blocking works consistently
  across Chrome, Edge, and other Chromium browsers rather than silently failing
  when the limit is exceeded.

## [1.3.0] — 2026-08-13

### Fixed
- **Legitimate sites no longer blocked.** Every block rule in the EasyList,
  EasyPrivacy, and YouTube-ads rulesets included `main_frame` in its
  resource types, which caused the extension to block the entire page whenever
  a listed ad/tracker domain was visited directly as a first-party site.
  Reported examples included large news and shopping sites. `main_frame` and
  `sub_frame` are now stripped from all 3,149 block rules. Ad and tracker
  blocking is fully retained via sub-resource types; top-level pages and
  legitimate embeds (video embeds, comment widgets, payment iframes) are no
  longer affected. The allowlist is unchanged.
- **DOM-based XSS hardening in the YouTube watch banner.** The banner
  previously interpolated the `?v=` video ID from the page URL into `innerHTML`.
  The ID is now validated against YouTube's format and the banner is built with
  DOM APIs, so nothing from the URL is parsed as HTML. Added
  `rel="noopener noreferrer"` to the outbound link.
- `esc()` now also escapes quote characters, making it safe in attribute
  contexts as well as text contexts.

### Added
- **Update notice.** After the extension updates, the popup shows a one-time,
  dismissible banner describing what changed, with a "NEW" badge on the toolbar
  icon until the popup is opened.
- **Content Security Policy** for extension pages in the manifest.
- **`tools/convert-easylist.py`** — an EasyList → declarativeNetRequest
  converter that excludes `main_frame`/`sub_frame` from block rules by default
  and validates its output, preventing the 1.2.1 bug from recurring when lists
  are regenerated.

## [1.2.1] — 2026-07-09

### Added
- Initial public release.
- Network ad and tracker blocking via `declarativeNetRequest` (EasyList,
  EasyPrivacy).
- YouTube pre-roll and mid-roll ad skipping.
- SponsorBlock integration with privacy-preserving hash-prefix lookups.
- Twitch ad muting/hiding and M3U8 ad-segment stripping.
- Cosmetic filtering for ad placeholders and cookie banners.
- Optional HexBlock gateway integration for blocklist sync and event reporting.

[1.3.1]: https://github.com/happygream/hexblock-shield/releases/tag/v1.3.1
[1.3.0]: https://github.com/happygream/hexblock-shield/releases/tag/v1.3.0
[1.2.1]: https://github.com/happygream/hexblock-shield/releases/tag/v1.2.1
