import type { Page } from "puppeteer";
import { waitForLiveNotionUi } from "./snapshot.ts";
import { normalizePageUrl, pageKey } from "./urls.ts";
import { accumulateVirtualizedPageBlocks } from "./virtualization.ts";

export type CrawlState = {
  queue: string[];
  visited: Set<string>;
  /** pageKey → absolute page URL used for crawl */
  pages: Map<string, string>;
};

export function createCrawl(rootUrl: string): CrawlState {
  const normalized = normalizePageUrl(rootUrl);
  if (!normalized) {
    throw new Error(`Not a valid Notion public page URL: ${rootUrl}`);
  }
  const key = pageKey(normalized);
  if (!key) throw new Error(`Could not extract page id from: ${rootUrl}`);

  return {
    queue: [normalized],
    visited: new Set(),
    pages: new Map([[key, normalized]]),
  };
}

export function enqueueIfNew(
  state: CrawlState,
  rawUrl: string,
  baseUrl: string,
): boolean {
  const normalized = normalizePageUrl(rawUrl, baseUrl);
  if (!normalized) return false;
  const key = pageKey(normalized);
  if (!key) return false;
  if (state.visited.has(key) || state.pages.has(key)) return false;
  state.pages.set(key, normalized);
  state.queue.push(normalized);
  return true;
}

/**
 * Scroll window + Notion scrollers so virtualized content mounts.
 *
 * Since ~Oct 2026 Notion virtualizes page blocks (not just gallery cards):
 * off-screen blocks leave the DOM. We only *accumulate* block HTML here —
 * restore happens at freeze serialize time (see virtualization.ts), because
 * media/link passes scroll again and React would unmount an early restore.
 */
export async function revealLazyContent(page: Page): Promise<void> {
  await accumulateVirtualizedPageBlocks(page);
}

/**
 * Collect every same-site Notion page link from the rendered DOM.
 * Scrolls collection scrollers while harvesting — virtualized gallery cards
 * only exist in the DOM while visible.
 */
export async function collectSameSiteLinks(
  page: Page,
  currentUrl: string,
): Promise<string[]> {
  const origin = new URL(currentUrl).origin;
  const hrefs = await page.evaluate(async (siteOrigin) => {
    const out = new Set<string>();
    const pageIdInPath = /(?:-|\/)([0-9a-f]{32})(?:\?|#|$)/i;
    const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));
    const harvestBlocks = () => {
      const w = window as Window & { __nspHarvestPageBlocks?: () => number };
      w.__nspHarvestPageBlocks?.();
    };

    const add = (href: string | null | undefined) => {
      if (!href) return;
      const trimmed = href.trim();
      if (
        !trimmed ||
        trimmed === "#" ||
        trimmed.startsWith("javascript:") ||
        trimmed.startsWith("mailto:") ||
        trimmed.startsWith("tel:") ||
        trimmed.startsWith("data:")
      ) {
        return;
      }
      try {
        const u = new URL(trimmed, siteOrigin);
        if (u.origin !== siteOrigin) return;
        if (
          /\.(png|jpe?g|gif|webp|svg|css|js|woff2?|mp3|mp4|pdf|json)(\?|$)/i.test(
            u.pathname,
          )
        ) {
          return;
        }
        if (
          pageIdInPath.test(u.pathname) ||
          u.pathname === "/" ||
          u.pathname.length > 1
        ) {
          out.add(`${u.origin}${u.pathname}`);
        }
      } catch {
        /* ignore */
      }
    };

    /** Collection cards sometimes use href="#" — recover from data-block-id. */
    const addBlockId = (raw: string | null | undefined) => {
      if (!raw) return;
      const hex = raw.replace(/-/g, "").toLowerCase();
      if (!/^[0-9a-f]{32}$/.test(hex)) return;
      out.add(`${siteOrigin}/${hex}`);
    };

    const harvest = () => {
      for (const a of Array.from(document.querySelectorAll("a[href]"))) {
        add(a.getAttribute("href"));
      }

      for (const el of Array.from(
        document.querySelectorAll(
          "[data-href], [role='link'], .notion-link-token",
        ),
      )) {
        add(el.getAttribute("data-href") || el.getAttribute("href"));
      }

      for (const el of Array.from(
        document.querySelectorAll(
          ".notion-collection-item a[href], .notion-page-block a[href], .notion-table-view a[href], .notion-list-view a[href], .notion-gallery-view a[href], .notion-board-view a[href]",
        ),
      )) {
        add(el.getAttribute("href"));
      }

      for (const el of Array.from(
        document.querySelectorAll(
          ".notion-collection-item[data-block-id], .notion-gallery-view .notion-page-block[data-block-id], .notion-list-view .notion-page-block[data-block-id], .notion-board-view .notion-page-block[data-block-id], .notion-table-view-row[data-block-id], .notion-collection-item .notion-page-block[data-block-id]",
        ),
      )) {
        addBlockId(el.getAttribute("data-block-id"));
        const a = el.querySelector("a[href]");
        if (a) add(a.getAttribute("href"));
      }
    };

    harvest();
    harvestBlocks();

    for (const scroller of Array.from(
      document.querySelectorAll(".notion-scroller"),
    ) as HTMLElement[]) {
      const maxX = Math.max(0, scroller.scrollWidth - scroller.clientWidth);
      const maxY = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
      const stepX = Math.max(140, Math.floor(scroller.clientWidth * 0.7) || 140);
      const stepY = Math.max(140, Math.floor(scroller.clientHeight * 0.7) || 140);
      if (maxX > 0) {
        for (let x = 0; x <= maxX + stepX; x += stepX) {
          scroller.scrollLeft = Math.min(x, maxX);
          await delay(35);
          harvest();
          harvestBlocks();
        }
        scroller.scrollLeft = 0;
      }
      if (maxY > 0) {
        for (let y = 0; y <= maxY + stepY; y += stepY) {
          scroller.scrollTop = Math.min(y, maxY);
          await delay(35);
          harvest();
          harvestBlocks();
        }
        scroller.scrollTop = maxY;
      }
      harvest();
      harvestBlocks();
    }

    const height = () =>
      Math.max(
        document.body?.scrollHeight || 0,
        document.documentElement?.scrollHeight || 0,
      );
    let prev = 0;
    for (let i = 0; i < 20; i++) {
      const h = height();
      if (h <= prev) break;
      prev = h;
      window.scrollTo(0, h);
      await delay(50);
      harvest();
      harvestBlocks();
    }
    harvest();
    harvestBlocks();

    return [...out];
  }, origin);

  const normalized: string[] = [];
  for (const href of hrefs) {
    const n = normalizePageUrl(href, currentUrl);
    if (n) normalized.push(n);
  }
  return [...new Set(normalized)];
}

export async function waitForNotionContent(
  page: Page,
  opts: { deep?: boolean; skipReveal?: boolean } = {},
): Promise<{ revealed: boolean }> {
  const deep = opts.deep !== false;
  await waitForLiveNotionUi(page);

  const hasCollections = await page.evaluate(() =>
    Boolean(
      document.querySelector(
        ".notion-collection_view-block, .notion-collection_view_page-block, .notion-gallery-view, .notion-table-view, .notion-list-view, .notion-board-view",
      ),
    ),
  );

  if (hasCollections) {
    // Collection galleries often hydrate after the page shell — wait briefly so
    // fingerprints / link discovery aren't computed against an empty view.
    await page
      .waitForFunction(
        () => {
          const hosts = document.querySelectorAll(
            ".notion-collection_view-block, .notion-collection_view_page-block, .notion-gallery-view, .notion-table-view, .notion-list-view, .notion-board-view",
          );
          if (!hosts.length) return true;
          return (
            document.querySelectorAll(
              ".notion-collection-item, .notion-gallery-view .notion-page-block, .notion-list-view .notion-page-block, .notion-board-view .notion-page-block, .notion-table-view-row",
            ).length > 0
          );
        },
        { timeout: 12_000 },
      )
      .catch(() => {
        /* page may have empty DBs — continue */
      });
  }

  if (!deep) {
    await settleNetwork(page, 280, 2_500);
    // Only scroll for fingerprint/link discovery when collections virtualize cards
    if (hasCollections) {
      await revealLazyContent(page);
      await settleNetwork(page, 200, 2_000);
      return { revealed: true };
    }
    return { revealed: false };
  }

  // Deep settle — always re-reveal. Notion page virtualization unmounts
  // off-screen blocks; skipping after a shallow scroll leaves truncated HTML.
  await settleNetwork(page, 280, 3_500);
  await revealLazyContent(page);
  await settleNetwork(page, 280, 3_500);
  return { revealed: true };
}

async function settleNetwork(
  page: Page,
  idleTime = 350,
  timeout = 6_000,
): Promise<void> {
  try {
    await page.waitForNetworkIdle({ idleTime, timeout });
  } catch {
    await new Promise((r) => setTimeout(r, Math.min(600, idleTime + 100)));
  }
}
