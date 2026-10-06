import {
  copyFileSync,
  existsSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import type { Page } from "puppeteer";
import {
  attachResponseCollector,
  collectDomAssetUrls,
  createAssetStore,
  downloadAssetUrls,
  ensureParentDir,
  findRemainingRemoteUrls,
  htmlHasEmptyMediaShells,
  injectBlockMedia,
  enrichBookmarkCovers,
  rewriteCssFiles,
  rewriteHtml,
  saveCollectedResponses,
  type AssetStore,
} from "./assets.ts";
import { launchBrowser, preparePage } from "./browser.ts";
import {
  createNavGate,
  isChallengePage,
  sleep,
  waitOutChallenge,
} from "./challenge.ts";
import {
  collectSameSiteLinks,
  createCrawl,
  enqueueIfNew,
  waitForNotionContent,
  type CrawlState,
} from "./crawl.ts";
import { injectRuntime, RUNTIME_JS } from "./runtime.ts";
import { writePwaAssets } from "./pwa.ts";
import {
  captureCollectionViews,
  expandAllToggles,
  freezeNotionPage,
  hydrateNotionMedia,
} from "./snapshot.ts";
import {
  fail,
  info,
  note,
  setPhase,
  setProgress,
  startSpinner,
  stopSpinner,
  success,
  updateSpinner,
  warn,
} from "./ui.ts";
import {
  extractPageId,
  normalizePageUrl,
  pageFileStem,
  pageKey,
} from "./urls.ts";
import {
  backupDir,
  emptyCache,
  ensureCachedPageInStaging,
  hydrateAssetStore,
  loadCache,
  pageFingerprint,
  prepareStaging,
  pruneOrphanHtml,
  publishStaging,
  restoreBackup,
  saveCache,
  snapshotAssets,
  stagingDir,
  type SyncCache,
} from "./cache.ts";

export type SyncOptions = {
  url: string;
  out: string;
  keepCname?: boolean;
  maxPages?: number;
  headless?: boolean;
  userDataDir?: string;
  delayMs?: number;
  maxRetries?: number;
  /** Parallel browser pages. Default 12 */
  concurrency?: number;
  /** Ignore fingerprints and re-scrape every page */
  full?: boolean;
};

export type SyncResult = {
  pages: number;
  skipped: number;
  assets: number;
  out: string;
  backup: string | null;
  /** Wall-clock sync duration in milliseconds */
  durationMs: number;
};

export { restoreBackup, backupDir, stagingDir };

/** True when HTML has 2+ view tabs but no usable offline view captures. */
function pageNeedsCollectionViewRecapture(htmlPath: string): boolean {
  try {
    if (!existsSync(htmlPath)) return true;
    const html = readFileSync(htmlPath, "utf8");
    const tabButtons = (html.match(/notion-collection-view-tab-button/g) || [])
      .length;
    if (tabButtons < 2) return false;
    const m = html.match(
      /id="nsp-collection-views"[^>]*>([\s\S]*?)<\/script>/i,
    );
    if (!m) return true;
    const data = JSON.parse(m[1] || "[]") as { tabs?: unknown[] }[];
    if (!Array.isArray(data) || data.length === 0) return true;
    return !data.some((v) => Array.isArray(v.tabs) && v.tabs.length >= 2);
  } catch {
    return true;
  }
}

export async function syncNotionSite(opts: SyncOptions): Promise<SyncResult> {
  const startedAt = Date.now();
  const root = normalizePageUrl(opts.url);
  if (!root) throw new Error(`Invalid Notion public URL: ${opts.url}`);

  const liveOut = opts.out;
  const full = opts.full === true;

  // Load cache from live site (or backup) before we touch staging
  const prevCache =
    loadCache(liveOut) ||
    loadCache(backupDir(liveOut)) ||
    emptyCache(root);

  startSpinner("Preparing staging…", "prepare");
  const { staging, copied } = prepareStaging(liveOut, opts.keepCname);
  stopSpinner();
  if (copied) {
    note(`Reusing previous assets → ${stagingDir(liveOut)}`);
  } else {
    note(`Fresh staging → ${stagingDir(liveOut)}`);
  }
  if (full) note("Full resync (--full): ignoring page fingerprints");

  const store = createAssetStore(staging);
  writeFileSync(join(store.dir, "nsp-runtime.js"), RUNTIME_JS, "utf8");
  const hydrated = hydrateAssetStore(store, prevCache);
  if (hydrated) note(`Asset cache: ${hydrated} file(s) mapped`);

  const cache: SyncCache = emptyCache(root);
  cache.assets = { ...prevCache.assets };

  const state = createCrawl(root);
  const pageUrlMap = new Map<string, string>();
  const maxPages = opts.maxPages && opts.maxPages > 0 ? opts.maxPages : Infinity;
  const delayMs = opts.delayMs ?? 500;
  const maxRetries = opts.maxRetries ?? 3;
  const concurrency = Math.max(1, opts.concurrency ?? 12);
  const retries = new Map<string, number>();
  const gateNav = createNavGate(delayMs);

  const prevKnown = Object.keys(prevCache.pages).length;
  setProgress({
    done: 0,
    queued: 1,
    active: 0,
    skipped: 0,
    known: Math.max(prevKnown, 1),
  });

  const bumpProgress = (active: number) => {
    const done = scrapedOk + skippedOk;
    setProgress({
      done,
      skipped: skippedOk,
      queued: remainingCount(state),
      active,
      known: Math.max(prevKnown, state.pages.size, done + remainingCount(state) + active),
    });
  };

  info(`Root ${root}`);
  info(`Out  ${liveOut}`);
  info(`Workers ${concurrency} · delay ${delayMs}ms`);

  const browser = await launchBrowser({
    headless: opts.headless,
    userDataDir: opts.userDataDir,
  });

  let scrapedOk = 0;
  let skippedOk = 0;
  let inFlight = 0;
  const mapLock = { queue: Promise.resolve() };
  const queueLock = { queue: Promise.resolve() };

  const withStoreLock = async <T>(fn: () => Promise<T>): Promise<T> => {
    const prev = mapLock.queue;
    let release!: () => void;
    mapLock.queue = new Promise<void>((r) => {
      release = r;
    });
    await prev;
    try {
      return await fn();
    } finally {
      release();
    }
  };

  const withQueueLock = async <T>(fn: () => Promise<T>): Promise<T> => {
    const prev = queueLock.queue;
    let release!: () => void;
    queueLock.queue = new Promise<void>((r) => {
      release = r;
    });
    await prev;
    try {
      return await fn();
    } finally {
      release();
    }
  };

  try {
    const rootPage = await preparePage(browser);
    inFlight = 1;
    bumpProgress(1);
    startSpinner(`Root · ${shortUrl(root)}`, "navigate");
    try {
      // Root: no delay — establish session ASAP
      const r = await scrapeOnePage({
        page: rootPage,
        url: root,
        isRoot: true,
        store,
        state,
        pageUrlMap,
        outRoot: staging,
        liveOut,
        withStoreLock,
        remaining: () => remainingCount(state),
        prevCache: full ? emptyCache(root) : prevCache,
        nextCache: cache,
        full,
        onProgress: () => bumpProgress(1),
      });
      state.visited.add(pageKey(root)!);
      if (r === "skipped") skippedOk += 1;
      else scrapedOk += 1;
      bumpProgress(0);
      updateSpinner(
        `${shortUrl(root)}${r === "skipped" ? " · cached" : " · done"}`,
        "idle",
      );
    } catch (e) {
      stopSpinner();
      throw e;
    } finally {
      inFlight = 0;
      await rootPage.close().catch(() => undefined);
    }

    const workers: Promise<void>[] = [];
    for (let w = 0; w < concurrency; w++) {
      workers.push(
        (async () => {
          const page = await preparePage(browser);
          for (;;) {
            const url = await withQueueLock(async () => {
              if (scrapedOk + skippedOk >= maxPages) return null;
              return takeNext(state);
            });
            if (!url) break;

            const key = pageKey(url);
            if (!key || state.visited.has(key)) continue;

            inFlight += 1;
            bumpProgress(inFlight);
            startSpinner(`${shortUrl(url)}`, "navigate");
            try {
              await gateNav();
              const r = await scrapeOnePage({
                page,
                url,
                isRoot: false,
                store,
                state,
                pageUrlMap,
                outRoot: staging,
                liveOut,
                withStoreLock,
                remaining: () => remainingCount(state),
                prevCache: full ? emptyCache(root) : prevCache,
                nextCache: cache,
                full,
                onProgress: () => bumpProgress(inFlight),
              });
              state.visited.add(key);
              if (r === "skipped") skippedOk += 1;
              else scrapedOk += 1;
              bumpProgress(inFlight - 1);
              updateSpinner(
                `${shortUrl(url)}${r === "skipped" ? " · cached" : " · done"}`,
                "idle",
              );
            } catch (e) {
              const attempt = (retries.get(key) ?? 0) + 1;
              retries.set(key, attempt);
              const msg = e instanceof Error ? e.message : String(e);
              if (attempt < maxRetries) {
                warn(`Retry ${attempt}/${maxRetries}: ${msg}`);
                state.pages.delete(key);
                enqueueIfNew(state, url, root);
                await sleep(1500 * attempt);
              } else {
                warn(`Giving up: ${url} (${msg})`);
                state.visited.add(key);
              }
            } finally {
              inFlight -= 1;
              bumpProgress(Math.max(0, inFlight));
              if (inFlight > 0) {
                updateSpinner(`workers · ${inFlight} active`, "idle");
              }
            }
          }
          await page.close().catch(() => undefined);
        })(),
      );
    }
    await Promise.all(workers);
    stopSpinner();

    const left = remainingCount(state);
    if (scrapedOk + skippedOk >= maxPages && left > 0) {
      note(`Stopped at --max-pages ${maxPages} (${left} still queued)`);
    } else {
      note(`Queue empty — discovered ${state.pages.size} page(s)`);
    }

    const keepFiles = new Set(pageUrlMap.values());
    const pruned = pruneOrphanHtml(staging, keepFiles);
    if (pruned) note(`Removed ${pruned} orphan page(s)`);

    startSpinner("Rewriting links & assets…", "rewrite");
    rewriteAllPages(staging, pageUrlMap, store, root);
    rewriteCssFiles(store, root);
    stopSpinner();

    startSpinner("Writing PWA assets…", "pwa");
    let siteName = "Notion Static";
    try {
      const indexHtml = readFileSync(join(staging, "index.html"), "utf8");
      const m = indexHtml.match(/<title[^>]*>([^<]+)<\/title>/i);
      if (m) {
        siteName =
          m[1]!.replace(/\s*\|\s*Notion$/i, "").trim() || siteName;
      }
    } catch {
      /* ignore */
    }
    const pwa = writePwaAssets(staging, { name: siteName });
    stopSpinner();
    note(`PWA ready · ${pwa.files} file(s) precached`);

    cache.assets = snapshotAssets(store);
    saveCache(staging, cache);

    startSpinner("Publishing (backup + swap)…", "publish");
    const { backup } = publishStaging(liveOut);
    stopSpinner();
    if (backup) {
      note(`Previous site backed up → ${backup}`);
      note(`Restore with: notion-static-exporter restore --out ${liveOut}`);
    }

    const durationMs = Date.now() - startedAt;
    success(
      `Scraped ${scrapedOk} · reused ${skippedOk} · ${store.map.size} asset(s) → ${liveOut}`,
    );
    info(`Finished in ${formatDuration(durationMs)}`);
    return {
      pages: scrapedOk + skippedOk,
      skipped: skippedOk,
      assets: store.map.size,
      out: liveOut,
      backup,
      durationMs,
    };
  } catch (e) {
    warn(`Sync failed — live site unchanged. Staging kept at ${stagingDir(liveOut)}`);
    throw e;
  } finally {
    stopSpinner();
    await browser.close();
  }
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)}s`;
  const m = Math.floor(s / 60);
  const rem = s - m * 60;
  return `${m}m ${rem.toFixed(0)}s`;
}

function remainingCount(state: CrawlState): number {
  let unvisited = 0;
  for (const [key] of state.pages) {
    if (!state.visited.has(key)) unvisited += 1;
  }
  return unvisited;
}

/** Brief settle after hydrateNotionMedia promotes lazy srcs into real requests. */
async function settleAfterMedia(page: Page): Promise<void> {
  try {
    await page.waitForNetworkIdle({ idleTime: 400, timeout: 5_000 });
  } catch {
    await new Promise((r) => setTimeout(r, 500));
  }
}

function takeNext(state: CrawlState): string | null {
  while (state.queue.length) {
    const url = state.queue.shift()!;
    const key = pageKey(url);
    if (!key || state.visited.has(key)) continue;
    return url;
  }
  return null;
}

function shortUrl(url: string): string {
  try {
    const u = new URL(url);
    return u.pathname.slice(0, 60);
  } catch {
    return url.slice(0, 60);
  }
}

function rememberPagePath(
  pageUrlMap: Map<string, string>,
  url: string,
  localPath: string,
): void {
  pageUrlMap.set(url, localPath);
  try {
    const u = new URL(url);
    pageUrlMap.set(`${u.origin}${u.pathname}`, localPath);
  } catch {
    /* ignore */
  }
}

type ScrapeOneArgs = {
  page: Page;
  url: string;
  isRoot: boolean;
  store: AssetStore;
  state: CrawlState;
  pageUrlMap: Map<string, string>;
  /** Staging output root */
  outRoot: string;
  /** Live site root (source for cache-hit HTML copies) */
  liveOut: string;
  withStoreLock: <T>(fn: () => Promise<T>) => Promise<T>;
  remaining: () => number;
  prevCache: SyncCache;
  nextCache: SyncCache;
  full: boolean;
  onProgress?: () => void;
};

async function scrapeOnePage(
  args: ScrapeOneArgs,
): Promise<"scraped" | "skipped"> {
  const {
    page,
    url,
    isRoot,
    store,
    state,
    pageUrlMap,
    outRoot,
    liveOut,
    withStoreLock,
    prevCache,
    nextCache,
    full,
    onProgress,
  } = args;

  const key = pageKey(url) || extractPageId(url) || url;
  const cached = prevCache.pages[key];
  const label = shortUrl(url);

  const collector = attachResponseCollector(page);

  setPhase("navigate", label);
  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 90_000 });
  } catch (e) {
    const ready = await page.evaluate(() => document.readyState).catch(() => "");
    if (ready !== "interactive" && ready !== "complete") {
      collector.detach();
      throw e;
    }
    warn(`Navigation slow; continuing`);
  }

  setPhase("challenge", label);
  const cleared = await waitOutChallenge(page, 90_000);
  if (!cleared || (await isChallengePage(page))) {
    collector.detach();
    throw new Error("Cloudflare challenge did not clear");
  }

  // Light wait first — enough to fingerprint / decide cache hit
  setPhase("content", label);
  await waitForNotionContent(page, { deep: false });
  if (await isChallengePage(page)) {
    collector.detach();
    throw new Error("Still on Cloudflare challenge");
  }

  const title = await page.title();
  if (/just a moment/i.test(title)) {
    collector.detach();
    throw new Error("Refusing to save Cloudflare interstitial");
  }

  setPhase("fingerprint", label);
  const fingerprint = full ? "" : await pageFingerprint(page);
  const pageId = extractPageId(url) ?? "unknown";
  const localPath = isRoot
    ? "index.html"
    : `${pageFileStem(title.replace(/\s*\|\s*Notion$/i, "").trim() || "page", pageId)}.html`;

  // Fast path: same fingerprint + previous HTML available + media complete
  if (
    !full &&
    cached &&
    cached.fingerprint &&
    fingerprint &&
    cached.fingerprint === fingerprint &&
    ensureCachedPageInStaging(liveOut, outRoot, cached.file)
  ) {
    const stagedHtml = join(outRoot, cached.file);
    let cachedHtml = "";
    try {
      cachedHtml = readFileSync(stagedHtml, "utf8");
    } catch {
      cachedHtml = "";
    }
    // Never reuse incomplete HTML — empty figures/audio are incorrect
    if (cachedHtml && htmlHasEmptyMediaShells(cachedHtml)) {
      note(`${label} · incomplete media in cache · re-scrape`);
    } else if (!pageNeedsCollectionViewRecapture(stagedHtml)) {
      // Fingerprint already scrolled collections; reuse cached links when set matches
      collector.detach();
      rememberPagePath(pageUrlMap, url, cached.file);
      setPhase("links", `${label} · cache hit`);
      const links = [...new Set(cached.links || [])];
      for (const link of links) {
        enqueueIfNew(state, link, url);
      }
      onProgress?.();
      nextCache.pages[key] = {
        url,
        file: cached.file,
        fingerprint,
        links,
      };
      return "skipped";
    } else {
      note(`${label} · re-capture views`);
    }
  }

  // Full settle only when we must re-scrape
  setPhase("content", `${label} · deep`);
  await waitForNotionContent(page, { deep: true });

  // Expand toggles (STUDENT A/B etc.) with real clicks so nested content loads
  setPhase("toggles", label);
  updateSpinner(label, "toggles");
  await expandAllToggles(page).catch(() => 0);

  setPhase("views", label);
  updateSpinner(label, "views");
  const collectionViews = await captureCollectionViews(page).catch((err) => {
    warn(`View capture failed · ${label}: ${err instanceof Error ? err.message : String(err)}`);
    return [] as Awaited<ReturnType<typeof captureCollectionViews>>;
  });
  if (collectionViews.length) {
    note(
      `${label} · ${collectionViews.reduce((n, v) => n + v.tabs.length, 0)} view snapshot(s)`,
    );
  }

  // Nested toggles can appear after the first pass / view switches
  setPhase("toggles", `${label} · nested`);
  await expandAllToggles(page).catch(() => 0);

  // Force-load lazy image/audio while the response collector is still attached.
  // Retry until live DOM has no empty shells (bounded).
  setPhase("assets", `${label} · media`);
  updateSpinner(label, "assets");
  let hydratedMedia: string[] = [];
  for (let mediaPass = 0; mediaPass < 3; mediaPass++) {
    const batch = await hydrateNotionMedia(page).catch(() => [] as string[]);
    hydratedMedia = [...new Set([...hydratedMedia, ...batch])];
    await settleAfterMedia(page);
    const domAssets = await collectDomAssetUrls(page);
    await withStoreLock(async () => {
      await saveCollectedResponses(store, collector.responses);
    });
    // Downloads can run without holding the store lock for the whole transfer
    await downloadAssetUrls(
      store,
      page,
      [...collector.urls, ...domAssets, ...hydratedMedia],
      6,
      (done, total) => {
        if (total > 0) note(`${label} · media ${done}/${total}`);
      },
    );
    const emptyLive = await page.evaluate(() => {
      let n = 0;
      for (const block of Array.from(
        document.querySelectorAll(".notion-image-block"),
      )) {
        const img = block.querySelector(
          "img[src]:not([src^='data:'])",
        ) as HTMLImageElement | null;
        if (!img) n += 1;
      }
      for (const block of Array.from(
        document.querySelectorAll(".notion-audio-block"),
      )) {
        const audio = block.querySelector(
          "audio[src]:not([src^='data:'])",
        ) as HTMLAudioElement | null;
        if (!audio) n += 1;
      }
      return n;
    });
    if (emptyLive === 0) break;
    note(`${label} · ${emptyLive} empty media shell(s) · retry hydrate`);
  }
  collector.detach();

  setPhase("links", label);
  const links = await collectSameSiteLinks(page, url);
  let added = 0;
  for (const link of links) {
    if (enqueueIfNew(state, link, url)) added += 1;
  }
  if (added) note(`+${added} link(s) · queue ${state.queue.length}`);
  onProgress?.();

  rememberPagePath(pageUrlMap, url, localPath);

  setPhase("freeze", label);
  updateSpinner(label, "freeze");
  let html = await freezeNotionPage(page);

  const leftovers = findRemainingRemoteUrls(html, url);
  for (const view of collectionViews) {
    for (const tab of view.tabs) {
      leftovers.push(...findRemainingRemoteUrls(tab.html, url));
    }
  }
  if (leftovers.length) {
    setPhase("assets", `${label} · leftovers`);
    await downloadAssetUrls(store, page, leftovers);
  }

  setPhase("write", label);
  updateSpinner(label, "write");
  const rewrittenViews = collectionViews.map((view) => ({
    ...view,
    tabs: view.tabs.map((tab) => ({
      ...tab,
      html: injectBlockMedia(
        rewriteHtml(tab.html, localPath, url, store, pageUrlMap),
        store,
        localPath,
      ),
    })),
  }));

  html = rewriteHtml(html, localPath, url, store, pageUrlMap);
  html = injectBlockMedia(html, store, localPath);
  html = await enrichBookmarkCovers(html, store, localPath);
  html = html.replace(/<base\b[^>]*>/gi, "");

  const runtimeSrc = "./assets/nsp-runtime.js";
  html = injectRuntime(html, rewrittenViews, runtimeSrc, url);
  html = rewriteHtml(html, localPath, url, store, pageUrlMap);
  html = injectBlockMedia(html, store, localPath);
  html = await enrichBookmarkCovers(html, store, localPath);

  // Completeness gate: never publish / fingerprint incomplete media
  if (htmlHasEmptyMediaShells(html)) {
    throw new Error(
      `Incomplete media after scrape (${label}) — empty image/audio shells remain`,
    );
  }

  const abs = join(outRoot, localPath);
  ensureParentDir(abs);
  writeFileSync(abs, html, "utf8");

  if (cached?.file && cached.file !== localPath) {
    const oldAbs = join(outRoot, cached.file);
    if (existsSync(oldAbs) && cached.file !== "index.html") {
      rmSync(oldAbs, { force: true });
    }
  }

  nextCache.pages[key] = {
    url,
    file: localPath,
    fingerprint: fingerprint || (await pageFingerprint(page).catch(() => "")),
    links,
  };

  return "scraped";
}

function rewriteAllPages(
  outRoot: string,
  pageUrlMap: Map<string, string>,
  store: AssetStore,
  rootUrl: string,
): void {
  const localToRemote = new Map<string, string>();
  for (const [remote, local] of pageUrlMap) {
    if (!localToRemote.has(local)) localToRemote.set(local, remote);
  }

  for (const [local, remote] of localToRemote) {
    const abs = join(outRoot, local);
    if (!existsSync(abs)) continue;
    let html = readFileSync(abs, "utf8");
    const base = remote || rootUrl;
    html = rewriteHtml(html, local, base, store, pageUrlMap);
    html = injectBlockMedia(html, store, local);
    html = html.replace(
      /(<script type="application\/json" id="nsp-collection-views">)([\s\S]*?)(<\/script>)/i,
      (_full, open: string, raw: string, close: string) => {
        try {
          const data = JSON.parse(raw) as {
            blockId: string;
            tabs: { label: string; html: string }[];
          }[];
          for (const view of data) {
            for (const tab of view.tabs) {
              tab.html = rewriteHtml(tab.html, local, base, store, pageUrlMap);
              tab.html = injectBlockMedia(tab.html, store, local);
            }
          }
          return (
            open + JSON.stringify(data).replace(/</g, "\\u003c") + close
          );
        } catch {
          return _full;
        }
      },
    );
    writeFileSync(abs, html, "utf8");
  }
}

export function preserveCname(outRoot: string, from?: string): void {
  const src = from ?? join(outRoot, "CNAME");
  if (!existsSync(src)) return;
  const dest = join(outRoot, "CNAME");
  if (src !== dest) copyFileSync(src, dest);
}

export function printSyncFailure(err: unknown): never {
  fail(err instanceof Error ? err.message : String(err));
  process.exit(1);
}
