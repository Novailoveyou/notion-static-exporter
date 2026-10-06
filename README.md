# notion-static-exporter

Scrapes a public Notion page into static files — no Notion API token.

Original: https://almond-brownie-c82.notion.site/Elementary-3b515e0e4a098053bb74c985cebfd777  
Clone: https://elementary.english.orlov.app/

## Usage

```bash
bun add -g notion-static-exporter
notion-static-exporter sync --url "…" --out ./_site
```

Or without a global install:

```bash
bunx notion-static-exporter sync --url "https://….notion.site/…" --out ./_site
```

### All sync flags

Values below are the defaults (omit a flag to use it):

```bash
notion-static-exporter sync \
  --url "https://….notion.site/…" \
  --out . \
  --max-pages 0 \
  --delay-ms 500 \
  --concurrency 12 \
  --retries 3 \
  --user-data-dir ~/.notion-static-exporter/chrome-profile
```

| Flag | Default | Purpose |
|------|---------|---------|
| `--url` | (required, or `NOTION_URL` / config) | Public `*.notion.site` root |
| `--out` | `.` | Output directory |
| `--keep-cname` | off | Keep existing `CNAME` in `--out` |
| `--max-pages` | `0` (unlimited) | Safety cap on pages |
| `--delay-ms` | `500` | Pause between navigations |
| `--concurrency` | `12` | Parallel browser tabs |
| `--retries` | `3` | Retries when Cloudflare blocks |
| `--user-data-dir` | `~/.notion-static-exporter/chrome-profile` | Chrome profile (CF cookies) |
| `--headed` | off | Show Chromium (helps hard challenges) |
| `--full` | off | Ignore fingerprints; re-scrape every page |

Env: `NOTION_URL`, `OUT_DIR`, `PUPPETEER_EXECUTABLE_PATH`.

Other commands: `restore`, `trigger`, `init-config`, `help`.

### Config file

Optional `notion-static-exporter.config.json` in the project root:

```bash
bunx notion-static-exporter init-config
```

```json
{
  "url": "https://almond-brownie-c82.notion.site/Elementary-3b515e0e4a098053bb74c985cebfd777",
  "out": "./_site",
  "keepCname": true,
  "maxPages": 0,
  "delayMs": 800,
  "concurrency": 12,
  "maxRetries": 3
}
```

CLI flags override config.

## GitHub Pages + Actions

Copy [`examples/sync-notion.yml`](examples/sync-notion.yml) to `.github/workflows/sync-notion.yml` in your Pages repo.

1. **Settings → Pages** — serve from `main` (root or `/docs`).
2. **Settings → Secrets and variables → Actions → Variables** — set `NOTION_URL` to your public Notion root.
3. Keep a `CNAME` in the repo if you use a custom domain (`--keep-cname` preserves it).
4. Disable any old Notion export workflow (e.g. notion4ever + `NOTION_TOKEN`) so only this sync deploys.

No Notion token — public `*.notion.site` only. The Action needs a normal `GITHUB_TOKEN` with `contents: write` (already declared in the example workflow) so it can commit & push the scraped site.

### What the Action does

On schedule (every 4h in the example) or **Actions → Sync Notion → Run workflow**:

1. Checkout the Pages repo  
2. Install Chrome + Bun  
3. Cache Chrome profile (Cloudflare cookies)  
4. `bunx notion-static-exporter sync --url "$NOTION_URL" --out . --keep-cname …`  
5. Commit & push if anything changed → Pages updates  

### Trigger sync from your machine

Needs a personal access token with **Actions: Read and write** (and repo access):

```bash
export GITHUB_TOKEN=ghp_…   # or GH_TOKEN
bunx notion-static-exporter trigger \
  --repo owner/pages-repo \
  --workflow sync-notion.yml \
  --ref main
```

Browser helper (local only, not in npm `dist`): [`tools/sync-trigger.html`](tools/sync-trigger.html).

## Cache / restore

Sync builds into staging, then swaps into `--out` and keeps one backup (`--out.nsp-backup`). Unchanged complete pages skip re-freeze. Use `--full` to force a complete re-scrape. On failure, live `--out` is left untouched.

```bash
bunx notion-static-exporter restore --out ./_site
```

## Cloudflare

Notion sits behind Cloudflare (“Just a moment…”). The crawler waits for clearance, reuses a persistent Chrome profile, delays between pages, and retries. It never saves a challenge interstitial as content.

If challenges stick in headless CI, warm the profile once locally:

```bash
bunx notion-static-exporter sync --url "…" --out ./_site --headed --max-pages 5
```

## How it works

1. Launch Chromium (Puppeteer)  
2. Open each public page and wait for the live Notion UI  
3. BFS every same-site link  
4. Download CSS / fonts / images into `assets/`  
5. Freeze the rendered DOM (strip Notion client JS)  
6. Rewrite links + write a PWA service worker  
7. Publish via staging → backup → swap  

## Publish this package (maintainers)

```bash
npm login
bun run build
bun run publish:prod
```

Bump `version` in `package.json` before each publish.

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
