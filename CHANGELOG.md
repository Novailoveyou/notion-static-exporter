# Changelog

## 1.0.23

- Fix truncated lessons for good: Notion unmounts off-screen blocks after every
  scroll (media/link passes wiped an early restore). Accumulate block HTML into
  a page store while scrolling; restore only at freeze serialize time in the
  same evaluate that returns outerHTML; tall scrape viewport; fingerprint v3
  so old truncated cache hits invalidate

## 1.0.22

- Fix truncated lesson pages (e.g. content stops at Exercise 3): Notion’s new
  page virtualization unmounts off-screen blocks — scroll accumulates blocks and
  re-injects them before freeze; fingerprints always scroll so bad cache hits
  no longer stick

## 1.0.20

- Restore 1.0.18 service-worker caching (full throttled install precache) — shell-only
  install in 1.0.19 left pages missing CSS/assets after cache wipe
- Keep 429 overlay hide; drop per-page warm that competed with page loads

## 1.0.19

- Hide frozen Notion `app.notion.com (Error 429)` overlays that cover fine local images
- SW no longer precaches the whole site on install (shell only); warm only current-page assets

## 1.0.18

- Stop retry spam: no retry after success, ignore synthetic src-clear errors,
  drop stalled auto-retry, skip already-cached warm fetches
- Show **Обновить** on images/audio that still fail after retries
- Hide Notion’s “This image couldn't be loaded.” once the real image succeeds
- New deploys without incognito: bump SW cache to `nsp-static-v11`, network-first
  for HTML/runtime/sw/manifest, reload once when a new SW takes control

## 1.0.16

- Fix `ERR_INSUFFICIENT_RESOURCES` on GitHub Pages: throttle service-worker
  precache (concurrency 4), warm only the current page's assets instead of the
  full site list on every load
- Retry failed image/audio/video loads (queued, exponential backoff)
- Image skeleton placeholder while media is pending
- Native `loading="lazy"` on content images
- Strip analytics/ad beacons (gtag, doubleclick, Twitter ads, etc.)

## 1.0.12

- Never cache-hit or publish pages with empty image/audio shells; retry hydrate
  until media is complete
- Faster sync: skip redundant scrolls on lesson pages / cache hits; adaptive
  collection-view waits; lower example CI delay (`800ms`) and raise concurrency
- Peek Loading… fixes: fetch timeout, `cache: no-store`, history ignore counter
- Service worker: network-first for audio / Range requests
- Emoji spritesheet imgs → unicode spans; fix icon color CSS
- Mobile: zero stacked layout padding / safe-padding gutters

## 1.0.3

- Default page open mode is fullscreen; ⋮ menu can change default view
  (fullscreen / side / dialog) and toggle dark/light theme
- Zoom-in cursor on images; click lightbox image to enlarge / shrink
- Remove stacked Gallery tab selection overlay; pointer cursor on cards
- Wire ⋮ menu inside peek; preserve clickability
- Add `tools/sync-trigger.html` (not in dist) for browser workflow_dispatch

## 1.0.2

- Fix CI: when syncing with `--out .` (GitHub Actions), preserve `.git` / `.github`
  instead of renaming the checkout into `*.nsp-backup` (which broke Commit & push)

## 1.0.0

- Initial release: Puppeteer BFS scrape of public `notion.site` pages
- Freezes live Notion UI (not admin HTML-export styling)
- Cloudflare handling: wait for clearance, persistent Chrome profile, delays,
  retries, SPA clicks for subpages
- Downloads CSS/fonts/images; strips client JS for offline static hosting
- CLI: `sync`, `trigger`, `init-config`, `help`
- Sample GitHub Actions workflow (cron every 4h + workflow_dispatch)
