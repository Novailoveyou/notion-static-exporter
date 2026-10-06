#!/usr/bin/env node
import { resolve } from "node:path";
import { flagValue, hasFlag, positional, suggestCommand } from "./args.ts";
import { exampleConfigJson, loadConfig } from "./config.ts";
import { loadDotEnv } from "./env.ts";
import { triggerWorkflow } from "./github.ts";
import { syncNotionSite, restoreBackup, formatDuration } from "./scrape.ts";
import {
  blank,
  fail,
  header,
  info,
  kv,
  note,
  success,
  warn,
} from "./ui.ts";

const ROOT = process.cwd();
const COMMANDS = ["sync", "restore", "trigger", "help", "init-config"] as const;

function printHelp(): void {
  header("help");
  console.log(`
Scrape a public Notion site into static files for GitHub Pages.

Usage:
  bunx notion-static-exporter sync [options]
  bunx notion-static-exporter restore --out ./_site
  bunx notion-static-exporter trigger [options]
  bunx notion-static-exporter help

Commands:
  sync          Crawl public notion.site URL (default) and write static HTML
  restore       Restore the previous site from the single backup
  trigger       Dispatch a GitHub Actions workflow on a consumer repo
  init-config   Write notion-static-exporter.config.json example
  help          Show this help

Sync options:
  --url <url>         Public Notion URL (or NOTION_URL / config)
  --out <dir>         Output directory (default: .)
  --keep-cname        Preserve existing CNAME in --out
  --max-pages <n>     Safety cap (0 = unlimited, default)
  --delay-ms <n>      Pause between pages (default 500)
  --concurrency <n>   Parallel browser tabs (default 12)
  --retries <n>       Retries per page on CF block (default 3)
  --user-data-dir <p> Chrome profile dir (keeps cf_clearance cookies)
  --headed            Show Chromium (helps pass hard Cloudflare challenges)
  --full              Ignore cache fingerprints; re-freeze every page

Resync:
  Sync always builds into a staging folder, then swaps into --out and keeps
  one backup (--out.nsp-backup). Unchanged pages (content fingerprint match)
  skip freeze/asset download. Use --full to force a complete re-scrape.
  On failure the live --out is left untouched.

Restore options:
  --out <dir>         Site directory to restore from <dir>.nsp-backup

Cloudflare:
  Notion sits behind Cloudflare ("Just a moment..."). The crawler waits for
  clearance, reuses a persistent Chrome profile, delays between pages, and
  retries. If challenges persist, run once with --headed to establish cookies.

Trigger options:
  --repo <owner/name> Target GitHub repo
  --workflow <file>   Workflow file name (default: sync-notion.yml)
  --ref <branch>      Branch ref (default: main)

Env:
  NOTION_URL          Default sync URL
  OUT_DIR             Default output directory
  GITHUB_TOKEN        Token for trigger (or GH_TOKEN)

Config file (optional): notion-static-exporter.config.json
`);
}

async function main(): Promise<void> {
  loadDotEnv(ROOT);
  const argv = process.argv.slice(2);
  const config = loadConfig(ROOT);

  let cmd = positional(argv)[0];
  if (!cmd || cmd.startsWith("-")) {
    cmd = hasFlag(argv, "help") || hasFlag(argv, "h") ? "help" : "sync";
  }

  if (!COMMANDS.includes(cmd as (typeof COMMANDS)[number])) {
    const suggestion = suggestCommand(cmd, COMMANDS);
    fail(`Unknown command: ${cmd}`);
    if (suggestion) note(`Did you mean \`${suggestion}\`?`);
    printHelp();
    process.exit(1);
  }

  if (cmd === "help") {
    printHelp();
    return;
  }

  if (cmd === "init-config") {
    const { writeFileSync, existsSync } = await import("node:fs");
    const path = resolve(ROOT, "notion-static-exporter.config.json");
    if (existsSync(path) && !hasFlag(argv, "force")) {
      warn(`Already exists: ${path} (pass --force to overwrite)`);
      return;
    }
    writeFileSync(path, exampleConfigJson);
    success(`Wrote ${path}`);
    return;
  }

  if (cmd === "restore") {
    header("restore");
    const out = resolve(
      ROOT,
      flagValue(argv, "out") ||
        config.out ||
        process.env.OUT_DIR?.trim() ||
        ".",
    );
    kv("out", out);
    blank();
    if (restoreBackup(out)) {
      success(`Restored backup → ${out}`);
    } else {
      fail(`No backup found at ${out}.nsp-backup`);
      process.exit(1);
    }
    return;
  }

  if (cmd === "trigger") {
    header("trigger");
    const repo =
      flagValue(argv, "repo") ||
      config.repo ||
      process.env.GITHUB_REPO?.trim() ||
      "";
    const workflow =
      flagValue(argv, "workflow") ||
      config.workflow ||
      "sync-notion.yml";
    const ref = flagValue(argv, "ref") || config.ref || "main";

    if (!repo) {
      fail("Missing --repo owner/name");
      process.exit(1);
    }

    kv("repo", repo);
    kv("workflow", workflow);
    kv("ref", ref);
    blank();

    const result = await triggerWorkflow({ repo, workflow, ref });
    if (!result.ok) {
      fail(result.message);
      process.exit(1);
    }
    success(result.message);
    return;
  }

  // sync
  header("sync");
  const url =
    flagValue(argv, "url") ||
    config.url ||
    process.env.NOTION_URL?.trim() ||
    "";
  const out = resolve(
    ROOT,
    flagValue(argv, "out") ||
      config.out ||
      process.env.OUT_DIR?.trim() ||
      ".",
  );
  const keepCname =
    hasFlag(argv, "keep-cname") ||
    config.keepCname === true;
  const maxPagesRaw =
    flagValue(argv, "max-pages") ??
    (config.maxPages !== undefined ? String(config.maxPages) : "0");
  const maxPages = Number(maxPagesRaw) || 0;
  const headed = hasFlag(argv, "headed");
  const full = hasFlag(argv, "full");
  const delayMs = Number(
    flagValue(argv, "delay-ms") ??
      (config.delayMs !== undefined ? String(config.delayMs) : "500"),
  );
  const maxRetries = Number(
    flagValue(argv, "retries") ??
      (config.maxRetries !== undefined ? String(config.maxRetries) : "3"),
  );
  const concurrency = Number(
    flagValue(argv, "concurrency") ??
      (config.concurrency !== undefined ? String(config.concurrency) : "12"),
  );
  const userDataDir =
    flagValue(argv, "user-data-dir") ||
    config.userDataDir ||
    process.env.CHROME_USER_DATA_DIR?.trim() ||
    undefined;

  if (!url) {
    fail("Missing --url (or NOTION_URL / config.url)");
    note("Example: bunx notion-static-exporter sync --url https://….notion.site/…");
    process.exit(1);
  }

  kv("url", url);
  kv("out", out);
  kv("keepCname", String(keepCname));
  kv("maxPages", maxPages === 0 ? "unlimited" : String(maxPages));
  kv("delayMs", String(delayMs));
  kv("concurrency", String(concurrency));
  kv("retries", String(maxRetries));
  kv("headed", String(headed));
  kv("full", String(full));
  blank();

  const cmdStarted = Date.now();
  try {
    const result = await syncNotionSite({
      url,
      out,
      keepCname,
      maxPages,
      headless: !headed,
      delayMs,
      maxRetries,
      concurrency,
      userDataDir,
      full,
    });
    blank();
    success(
      `Done — ${result.pages} pages (${result.skipped} cached), ${result.assets} assets`,
    );
    info(`Output: ${result.out}`);
    if (result.backup) info(`Backup: ${result.backup}`);
    const { formatDuration } = await import("./scrape.ts");
    info(`Sync time: ${formatDuration(result.durationMs)}`);
    info(`Command time: ${formatDuration(Date.now() - cmdStarted)}`);
  } catch (e) {
    fail(e instanceof Error ? e.message : String(e));
    info(`Failed after ${formatDuration(Date.now() - cmdStarted)}`);
    process.exit(1);
  }
}

main().catch((e) => {
  fail(e instanceof Error ? e.message : String(e));
  process.exit(1);
});
