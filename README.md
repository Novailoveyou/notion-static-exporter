# notion-static-exporter

Scrape a **public** Notion site (`*.notion.site`) into a static mirror that looks
like the **live Notion UI** — not Notion’s admin “Export → HTML” look.

Compare:

- Live UI (target): https://almond-brownie-c82.notion.site/Elementary-3b515e0e4a098053bb74c985cebfd777
- Old export style (different UI): https://elementary.english.orlov.app/

This tool freezes the painted Notion SPA (HTML + CSS + fonts + images), strips
client JS that would blank the page offline, rewrites links, and writes files
you can host on GitHub Pages (installable PWA with offline cache).

No Notion API token. Exhaustive BFS: every same-site link on every page is
queued until the tree is done.

```bash
bunx notion-static-exporter sync \
  --url "https://almond-brownie-c82.notion.site/Elementary-3b515e0e4a098053bb74c985cebfd777" \
  --out ./_site
```

## Publishing

Publish this package to npm so Pages repos can call it from GitHub Actions:

```bash
# one-time: login to npm (browser or token)
npm login
# or: npm config set //registry.npmjs.org/:_authToken=npm_…

bun run build
bun run publish:prod   # → bun publish --access public
```

That publishes `notion-static-exporter` (version from `package.json`). After that,
anywhere can run:

```bash
npx notion-static-exporter sync --url "…" --out .
# or
bunx notion-static-exporter sync --url "…" --out .
```

Bump `version` in `package.json` before each publish if the previous version is
already on the registry.

## Usage

### Install / run locally

```bash
bunx notion-static-exporter sync --url "https://….notion.site/…" --out ./_site
bun add -g notion-static-exporter
notion-static-exporter sync --url "…" --out ./_site
```

Optional config `notion-static-exporter.config.json`:

```json
{
  "url": "https://almond-brownie-c82.notion.site/Elementary-3b515e0e4a098053bb74c985cebfd777",
  "out": "./_site",
  "keepCname": true,
  "maxPages": 0
}
```

```bash
bunx notion-static-exporter init-config
```

### Wire each GitHub Pages repo

Use the ready template: [`examples/sync-notion.yml`](examples/sync-notion.yml).

#### [elementary.english.orlov.app](https://github.com/Novailoveyou/elementary.english.orlov.app)

1. Add `.github/workflows/sync-notion.yml` (copy from the example).
2. Repo **Settings → Secrets and variables → Actions → Variables**:
   - `NOTION_URL` = `https://almond-brownie-c82.notion.site/Elementary-3b515e0e4a098053bb74c985cebfd777`
3. Ensure **GitHub Pages** serves from `main` (root or `/docs` — whatever you use now).
4. Keep existing `CNAME` — the workflow uses `--keep-cname`.
5. Remove / stop the old `publish.yml` (notion4ever + `NOTION_TOKEN`) so you don’t have two deployers fighting.

#### [english.orlov.app](https://github.com/Novailoveyou/english.orlov.app)

Same workflow file, different variable:

- `NOTION_URL` = `https://almond-brownie-c82.notion.site/Elena-Pilip-61ff5f4c44a34429944ea190ee690cc9`  
  (drop the `#…` hash for the crawl root)

No Notion API token needed — public `*.notion.site` only.

### What the Action does

On schedule (every 4h in the example) or **Actions → Sync Notion → Run workflow**:

1. Checkout the Pages repo
2. Install Chrome + Bun
3. Cache Chrome profile (Cloudflare cookies)
4. `bunx notion-static-exporter sync --url "$NOTION_URL" --out . --keep-cname …`
5. Commit & push if anything changed → Pages updates

The workflow also:

- Points Puppeteer at Chrome via `PUPPETEER_EXECUTABLE_PATH`
- Runs headless with container-safe flags (`--no-sandbox`, `--disable-dev-shm-usage`, …)
- Uses lower concurrency (`2`) to fit runner memory

Local override for a custom Chrome binary:

```bash
PUPPETEER_EXECUTABLE_PATH=/usr/bin/google-chrome \
  bunx notion-static-exporter sync --url "…" --out ./_site
```

### Trigger from this machine

CLI:

```bash
export GITHUB_TOKEN=ghp_…   # actions:write
bunx notion-static-exporter trigger \
  --repo Novailoveyou/elementary.english.orlov.app \
  --workflow sync-notion.yml \
  --ref main
```

Browser (not shipped in the scraped site / npm `dist`): open
[`tools/sync-trigger.html`](tools/sync-trigger.html) locally. It stores the
token in `localStorage`, dispatches the workflow, then polls the Actions run
(progress bar + step status) with links to the job, Pages deploy, and site.
Needs **Actions: Read and write**; optional **Pages: Read** for deploy status.

### Order of operations

| Step | Where |
|------|--------|
| 1. `bun run publish:prod` | `notion-static-exporter` |
| 2. Add workflow + `NOTION_URL` | each Pages repo |
| 3. Disable old notion4ever `publish.yml` | each Pages repo |
| 4. Manual “Run workflow” once | verify scrape + commit |
| 5. Leave schedule on | ongoing sync |

## Commands

| Command | Purpose |
|--------|---------|
| `sync` | Crawl public URL → write static files (default) |
| `restore` | Restore `--out` from the previous `.nsp-backup` |
| `trigger` | `workflow_dispatch` on a consumer GitHub repo |
| `help` | Usage |

### Sync flags

- `--url` / `NOTION_URL` — public Notion root
- `--out` / `OUT_DIR` — output directory (default `.`)
- `--keep-cname` — keep existing `CNAME` across sync
- `--max-pages <n>` — safety cap (`0` = unlimited)
- `--delay-ms <n>` — pause between pages (default `1500`)
- `--concurrency <n>` — parallel browser tabs (default `12`)
- `--retries <n>` — retries when Cloudflare blocks (default `3`)
- `--user-data-dir <path>` — Chrome profile (keeps CF cookies)
- `--headed` — show Chromium (helps pass hard challenges)
- `--full` — ignore fingerprints; re-freeze every page

### Resync / cache

Sync builds into a staging folder, then swaps into `--out` and keeps **one**
backup (`--out.nsp-backup`). Unchanged pages (content fingerprint match) skip
freeze/asset download. Use `--full` to force a complete re-scrape. On failure
the live `--out` is left untouched.

```bash
bunx notion-static-exporter restore --out ./_site
```

## Cloudflare

Notion’s public sites sit behind Cloudflare (“Just a moment…”). The crawler:

1. Uses a **persistent Chrome profile** (`~/.notion-static-exporter/chrome-profile`) so `cf_clearance` cookies stick across runs
2. **Waits** for challenges to clear before saving a page
3. **Delays** between page loads (`--delay-ms`)
4. **Retries** blocked pages (`--retries`, default 3)
5. Never saves a challenge interstitial as content

If challenges still stick in headless CI, warm the profile once locally:

```bash
bunx notion-static-exporter sync --url "…" --out ./_site --headed --max-pages 5
```

Then re-run headless using the same `--user-data-dir` (or let Actions restore the cached profile).

## How it works

1. Launch Chromium (Puppeteer) — system Chrome, `PUPPETEER_EXECUTABLE_PATH`, or bundled
2. Open each public page and wait for the **live Notion UI** to paint
3. Collect **all** same-origin page links → BFS queue
4. Download CSS / fonts / images into `assets/`
5. **Freeze** the rendered DOM (inline accessible CSS, remove Notion client JS)
6. Rewrite links to local `.html` files + PWA service worker
7. Publish via staging → backup → swap

CLI shows an animated spinner, a progress bar (`done/known`, grows as the queue
discovers pages), and rotating status text for the current phase (navigate,
Cloudflare, views, assets, freeze, …). In GitHub Actions (no TTY) it prints
phase lines every few seconds instead.

## Library

```ts
import { syncNotionSite, triggerWorkflow } from "notion-static-exporter";

await syncNotionSite({
  url: "https://….notion.site/…",
  out: "./_site",
  keepCname: true,
});
```

## License

MIT
