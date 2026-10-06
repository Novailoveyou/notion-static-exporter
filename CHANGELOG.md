# Changelog

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
