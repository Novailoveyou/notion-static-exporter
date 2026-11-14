import type { Page } from "puppeteer";

/**
 * Notion (~Oct 2026+) virtualizes regular page blocks: off-screen nodes leave
 * the DOM. Scrolling then freezing (or restoring too early, then scrolling for
 * media/links) captures only the current viewport slice.
 *
 * We harvest top-level `.notion-page-content` children into
 * `window.__NSP_PAGE_BLOCKS__` while scrolling, and restore them only at freeze
 * serialize time — in the same evaluate that returns outerHTML — so React
 * cannot unmount them before capture.
 */

/**
 * Install harvest/restore helpers on the page and scroll-harvest once.
 * Safe to call multiple times — store accumulates across passes.
 */
export async function accumulateVirtualizedPageBlocks(
  page: Page,
): Promise<number> {
  return page.evaluate(async () => {
    const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));
    const w = window as Window & {
      __NSP_PAGE_BLOCKS__?: {
        order: number;
        items: Record<string, { html: string; order: number; score: number }>;
      };
      __nspHarvestPageBlocks?: () => number;
      __nspRestorePageBlocks?: () => number;
    };

    if (!w.__NSP_PAGE_BLOCKS__) {
      w.__NSP_PAGE_BLOCKS__ = { order: 0, items: {} };
    }
    const store = w.__NSP_PAGE_BLOCKS__;

    const pageContent = () =>
      document.querySelector(".notion-page-content") as HTMLElement | null;

    const scoreOf = (el: HTMLElement) => {
      const text = (el.innerText || "").replace(/\s+/g, " ").trim();
      const hasMedia = Boolean(
        el.querySelector(
          "img[src]:not([src^='data:']), audio[src], video[src], iframe[src]",
        ),
      );
      const nested = el.querySelectorAll("[data-block-id]").length;
      return (
        text.length + (hasMedia ? 500 : 0) + nested * 20 + el.outerHTML.length / 50
      );
    };

    const isKeepEmpty = (el: HTMLElement) =>
      /notion-(divider|spacer|toc|breadcrumb|equation|code|callout|quote|bookmark|file|embed|video|audio|image|pdf|transclusion|column_list|column|toggle|header|sub_header|sub_sub_header|text|bulleted_list|numbered_list|to_do|table|table_of_contents)-block/i.test(
        el.className || "",
      );

    w.__nspHarvestPageBlocks = () => {
      const root = pageContent();
      if (!root) return Object.keys(store.items).length;
      for (const el of Array.from(root.children) as HTMLElement[]) {
        const id = el.getAttribute("data-block-id") || "";
        if (!id) continue;
        const score = scoreOf(el);
        const text = (el.innerText || "").replace(/\s+/g, " ").trim();
        const hasMedia = Boolean(
          el.querySelector(
            "img[src]:not([src^='data:']), audio[src], video[src], iframe[src]",
          ),
        );
        // Skip hollow virtualization placeholders unless we already know the class
        if (
          score < 2 &&
          !text &&
          !hasMedia &&
          !el.querySelector("[data-block-id]") &&
          !isKeepEmpty(el)
        ) {
          continue;
        }
        const prev = store.items[id];
        if (!prev) {
          store.items[id] = {
            html: el.outerHTML,
            order: store.order++,
            score,
          };
        } else if (score > prev.score * 1.05 || el.outerHTML.length > prev.html.length * 1.1) {
          store.items[id] = {
            html: el.outerHTML,
            order: prev.order,
            score: Math.max(score, prev.score),
          };
        }
      }
      return Object.keys(store.items).length;
    };

    w.__nspRestorePageBlocks = () => {
      const root = pageContent();
      const entries = Object.values(store.items);
      if (!root || !entries.length) return 0;
      const sorted = entries.sort((a, b) => a.order - b.order);
      // replaceWith a fresh node so React's fiber still points at the detached
      // original and cannot unmount our re-injected blocks before serialize.
      const neu = root.cloneNode(false) as HTMLElement;
      for (const el of Array.from(root.children) as HTMLElement[]) {
        if (!el.getAttribute("data-block-id")) neu.appendChild(el.cloneNode(true));
      }
      const wrap = document.createElement("div");
      for (const item of sorted) {
        wrap.innerHTML = item.html;
        const node = wrap.firstElementChild;
        if (node) neu.appendChild(node);
      }
      root.replaceWith(neu);
      return sorted.length;
    };

    const harvest = () => w.__nspHarvestPageBlocks?.() ?? 0;
    harvest();

    for (const el of Array.from(
      document.querySelectorAll(".notion-scroller"),
    ) as HTMLElement[]) {
      const maxX = Math.max(0, el.scrollWidth - el.clientWidth);
      const maxY = Math.max(0, el.scrollHeight - el.clientHeight);
      const stepX = Math.max(140, Math.floor(el.clientWidth * 0.55) || 140);
      const stepY = Math.max(120, Math.floor(el.clientHeight * 0.45) || 120);
      if (maxX > 0) {
        for (let x = 0; x <= maxX + stepX; x += stepX) {
          el.scrollLeft = Math.min(x, maxX);
          harvest();
          await delay(55);
        }
      }
      if (maxY > 0) {
        for (let y = 0; y <= maxY + stepY; y += stepY) {
          el.scrollTop = Math.min(y, maxY);
          harvest();
          await delay(55);
        }
      }
      // Leave scroller at bottom briefly so late mounts settle, then harvest
      if (maxY > 0) {
        el.scrollTop = maxY;
        await delay(80);
        harvest();
      }
    }

    const height = () =>
      Math.max(
        document.body?.scrollHeight || 0,
        document.documentElement?.scrollHeight || 0,
        pageContent()?.scrollHeight || 0,
      );

    let stableRounds = 0;
    let prevCount = Object.keys(store.items).length;
    const step = Math.max(120, Math.floor(window.innerHeight * 0.4) || 120);
    for (let pass = 0; pass < 4; pass++) {
      let maxY = height();
      for (let y = 0; y <= maxY + step; y += step) {
        window.scrollTo(0, Math.min(y, height()));
        for (const el of Array.from(
          document.querySelectorAll(".notion-scroller"),
        ) as HTMLElement[]) {
          const sm = Math.max(0, el.scrollHeight - el.clientHeight);
          if (sm > 0) {
            const ratio = maxY > 0 ? Math.min(y, maxY) / maxY : 1;
            el.scrollTop = Math.floor(sm * ratio);
          }
        }
        harvest();
        await delay(75);
        maxY = Math.max(maxY, height());
      }
      window.scrollTo(0, height());
      for (const el of Array.from(
        document.querySelectorAll(".notion-scroller"),
      ) as HTMLElement[]) {
        el.scrollTop = Math.max(0, el.scrollHeight - el.clientHeight);
      }
      harvest();
      await delay(150);
      const count = Object.keys(store.items).length;
      if (count === prevCount) {
        stableRounds += 1;
        if (stableRounds >= 2) break;
      } else {
        stableRounds = 0;
        prevCount = count;
      }
    }

    // Do NOT scroll back to top here — that unmounts harvested blocks.
    // Freeze restores from the store; media hydrate harvests again while scrolling.
    harvest();
    return Object.keys(store.items).length;
  });
}

/** Live-DOM restore (for debugging / mid-scrape). Prefer freeze-time restore. */
export async function restoreVirtualizedPageBlocks(page: Page): Promise<number> {
  return page.evaluate(() => {
    const w = window as Window & { __nspRestorePageBlocks?: () => number };
    if (typeof w.__nspRestorePageBlocks === "function") {
      return w.__nspRestorePageBlocks();
    }
    return 0;
  });
}

/** How many top-level blocks are currently stored (0 if helper not installed). */
export async function storedPageBlockCount(page: Page): Promise<number> {
  return page.evaluate(() => {
    const w = window as Window & {
      __NSP_PAGE_BLOCKS__?: { items: Record<string, unknown> };
    };
    return w.__NSP_PAGE_BLOCKS__ ? Object.keys(w.__NSP_PAGE_BLOCKS__.items).length : 0;
  });
}

/** Expand viewport so more virtualized blocks stay mounted during media hydrate. */
export async function expandScrapeViewport(page: Page): Promise<void> {
  const current = page.viewport();
  await page.setViewport({
    width: current?.width || 1440,
    height: Math.max(current?.height || 900, 14_000),
    deviceScaleFactor: current?.deviceScaleFactor || 1,
  });
}

export async function restoreDefaultViewport(page: Page): Promise<void> {
  const current = page.viewport();
  await page.setViewport({
    width: current?.width || 1440,
    height: 900,
    deviceScaleFactor: current?.deviceScaleFactor || 1,
  });
}
