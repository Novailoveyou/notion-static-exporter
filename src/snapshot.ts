import type { Page } from "puppeteer";

export type CollectionViewCapture = {
  blockId: string;
  defaultLabel?: string;
  defaultIndex?: number;
  tabs: { label: string; html: string }[];
};

/**
 * Click each collection view tab and capture the rendered body HTML so we can
 * switch views offline without Notion's React runtime.
 */
export async function captureCollectionViews(
  page: Page,
): Promise<CollectionViewCapture[]> {
  type CapturePlan = {
    blockId: string;
    tabLabels: string[];
    defaultIndex: number;
    defaultLabel: string;
  };

  const plans = await page.evaluate((): CapturePlan[] => {
    const blocks = Array.from(
      document.querySelectorAll(
        ".notion-collection_view-block[data-block-id], .notion-collection_view_page-block[data-block-id]",
      ),
    ) as HTMLElement[];

    const byId = new Map<string, HTMLElement[]>();
    for (const block of blocks) {
      const blockId = block.getAttribute("data-block-id") || "";
      if (!blockId) continue;
      const list = byId.get(blockId) || [];
      list.push(block);
      byId.set(blockId, list);
    }

    const out: CapturePlan[] = [];
    for (const [blockId, instances] of byId) {
      let root: HTMLElement | null = null;
      for (const block of instances) {
        const candidate =
          (block.closest(
            ".notion-selectable.notion-collection_view-block, .notion-selectable.notion-collection_view_page-block",
          ) as HTMLElement) || block;
        if (candidate.querySelector('[role="tablist"]')) {
          root = candidate;
          break;
        }
      }
      if (!root) continue;
      const tablist = root.querySelector('[role="tablist"]');
      if (!tablist) continue;

      const rawTabs = Array.from(
        tablist.querySelectorAll(
          ".notion-collection-view-tab-button, [role='tab'], .notion-collection-view-tab",
        ),
      ) as HTMLElement[];
      const tabs: HTMLElement[] = [];
      for (const t of rawTabs) {
        if (t.classList.contains("notion-collection-view-tab-button")) {
          tabs.push(t);
        } else if (!t.closest(".notion-collection-view-tab-button")) {
          tabs.push(t);
        }
      }
      if (tabs.length < 1) continue;

      // Prefer Gallery, then Table — never leave Calendar as the default
      let defaultIndex = tabs.findIndex((t) =>
        /gallery/i.test(t.textContent || ""),
      );
      if (defaultIndex < 0) {
        defaultIndex = tabs.findIndex((t) =>
          /^table\b/i.test((t.textContent || "").replace(/\s+/g, " ").trim()),
        );
      }
      if (defaultIndex < 0) {
        defaultIndex = tabs.findIndex(
          (t) =>
            t.getAttribute("aria-selected") === "true" ||
            !!t.querySelector('[aria-selected="true"]'),
        );
      }
      if (defaultIndex < 0) defaultIndex = 0;

      const defaultLabel =
        (tabs[defaultIndex]?.textContent || "").replace(/\s+/g, " ").trim() ||
        "View";

      out.push({
        blockId,
        tabLabels: tabs.map(
          (t) =>
            (t.getAttribute("aria-label") || t.textContent || "View")
              .replace(/\s+/g, " ")
              .trim(),
        ),
        defaultIndex,
        defaultLabel,
      });
    }
    return out;
  });

  const out: CollectionViewCapture[] = [];

  for (const plan of plans) {
    // Single-tab collections have nothing to switch offline
    if (plan.tabLabels.length < 2) continue;

    const captured: { label: string; html: string }[] = [];

    const clickTab = async (index: number) => {
      await page.evaluate(
        (blockId, tabIndex) => {
          const roots = Array.from(
            document.querySelectorAll(`[data-block-id="${blockId}"]`),
          ) as HTMLElement[];
          const root =
            roots.find((r) => r.querySelector('[role="tablist"]')) || roots[0];
          const tablist = root?.querySelector('[role="tablist"]');
          if (!tablist) return;
          const buttons = Array.from(
            tablist.querySelectorAll(".notion-collection-view-tab-button"),
          ) as HTMLElement[];
          const tabs = buttons.length
            ? buttons
            : (Array.from(
                tablist.querySelectorAll('[role="tab"]'),
              ) as HTMLElement[]);
          const tab = tabs[tabIndex];
          if (!tab) return;
          try {
            tab.scrollIntoView({ block: "nearest", inline: "nearest" });
          } catch {
            /* ignore */
          }
          // Prefer the inner [role=tab] — outer button often opens a popup
          const target =
            (tab.querySelector('[role="tab"]') as HTMLElement) || tab;
          for (const type of [
            "pointerdown",
            "mousedown",
            "mouseup",
            "click",
          ] as const) {
            target.dispatchEvent(
              new MouseEvent(type, {
                bubbles: true,
                cancelable: true,
                view: window,
              }),
            );
          }
        },
        plan.blockId,
        index,
      );
    };

    for (let i = 0; i < plan.tabLabels.length; i++) {
      const label = plan.tabLabels[i] || "View";
      await clickTab(i);
      await page.keyboard.press("Escape").catch(() => {});

      const expectSel = /calendar/i.test(label)
        ? ".notion-calendar-view"
        : /table/i.test(label)
          ? ".notion-table-view, .notion-collection-table"
          : /board/i.test(label)
            ? ".notion-board-view"
            : /list/i.test(label)
              ? ".notion-list-view"
              : /gallery/i.test(label)
                ? ".notion-gallery-view"
                : null;

      const ceilingMs = /calendar|table|board|timeline/i.test(label)
        ? 2200
        : 1200;
      const started = Date.now();
      let ready = !expectSel;
      if (expectSel) {
        for (let attempt = 0; attempt < 6; attempt++) {
          ready = await page.evaluate(
            (blockId, sel) => {
              const body = (() => {
                const roots = Array.from(
                  document.querySelectorAll(`[data-block-id="${blockId}"]`),
                ) as HTMLElement[];
                const tabHost = roots.find((r) =>
                  r.querySelector('[role="tablist"]'),
                );
                const tablist = tabHost?.querySelector(
                  '[role="tablist"]',
                ) as HTMLElement | null;
                let el: HTMLElement | null = tablist;
                while (el) {
                  const b = el.querySelector(
                    ".notion-collection-view-body",
                  ) as HTMLElement | null;
                  if (b) return b;
                  el = el.parentElement;
                }
                for (const root of roots) {
                  const b = root.querySelector(
                    ".notion-collection-view-body",
                  ) as HTMLElement | null;
                  if (b) return b;
                }
                return document.querySelector(
                  ".notion-collection-view-body",
                ) as HTMLElement | null;
              })();
              return !!(body && body.querySelector(sel));
            },
            plan.blockId,
            expectSel,
          );
          if (ready) break;
          if (Date.now() - started > ceilingMs) break;
          await clickTab(i);
          await page.keyboard.press("Escape").catch(() => {});
          await new Promise((r) => setTimeout(r, 280));
        }
      } else {
        await new Promise((r) => setTimeout(r, 400));
      }

      const html = await page.evaluate((blockId) => {
        // On collection_view_page, the view body is often a sibling of the
        // tablist host (same page block id is NOT an ancestor of the body).
        // Walk up from the tablist until we find .notion-collection-view-body.
        const roots = Array.from(
          document.querySelectorAll(`[data-block-id="${blockId}"]`),
        ) as HTMLElement[];
        const tabHost = roots.find((r) => r.querySelector('[role="tablist"]'));
        const tablist = tabHost?.querySelector(
          '[role="tablist"]',
        ) as HTMLElement | null;

        let body: HTMLElement | null = null;
        let el: HTMLElement | null = tablist;
        while (el) {
          const candidate = el.querySelector(
            ".notion-collection-view-body",
          ) as HTMLElement | null;
          if (candidate) {
            body = candidate;
            break;
          }
          el = el.parentElement;
        }
        if (!body) {
          for (const root of roots) {
            const candidate = root.querySelector(
              ".notion-collection-view-body",
            ) as HTMLElement | null;
            if (candidate) {
              body = candidate;
              break;
            }
          }
        }
        if (!body) {
          body =
            (document.querySelector(
              ".notion-collection-view-body",
            ) as HTMLElement | null) ||
            (document.querySelector(
              ".notion-scroller.horizontal",
            ) as HTMLElement | null);
        }
        if (!body) {
          const view = document.querySelector(
            ".notion-calendar-view, .notion-table-view, .notion-gallery-view, .notion-board-view, .notion-list-view",
          );
          body = (view?.parentElement as HTMLElement | null) || null;
        }
        if (!body) return "";

        for (const img of Array.from(body.querySelectorAll("img"))) {
          const elImg = img as HTMLImageElement;
          const ds =
            elImg.getAttribute("data-src") ||
            elImg.getAttribute("data-lazy-src") ||
            elImg.getAttribute("data-original");
          const src = elImg.getAttribute("src") || "";
          if (
            ds &&
            (!src ||
              src.startsWith("data:image/svg") ||
              src.startsWith("data:image/gif"))
          ) {
            elImg.setAttribute("src", ds);
          }
          const cur = elImg.getAttribute("src");
          if (cur && !cur.startsWith("data:") && !cur.startsWith("blob:")) {
            try {
              elImg.setAttribute("src", new URL(cur, location.href).href);
            } catch {
              /* ignore */
            }
          }
        }
        return body.innerHTML;
      }, plan.blockId);

      if (html && html.length > 40) {
        captured.push({ label, html });
      }
    }

    await clickTab(plan.defaultIndex);
    await new Promise((r) => setTimeout(r, 600));

    if (captured.length) {
      out.push({
        blockId: plan.blockId,
        defaultLabel: plan.defaultLabel,
        defaultIndex: plan.defaultIndex,
        tabs: captured,
      });
    }
  }

  return out;
}

/**
 * Notion lazy-loads toggle children only after a real UI expand.
 * Synthetic evaluate-clicks often leave aria-expanded=false with empty bodies
 * (e.g. STUDENT A / STUDENT B). Use CDP clicks and wait for content.
 */
export async function expandAllToggles(page: Page): Promise<number> {
  let opened = 0;
  for (let pass = 0; pass < 10; pass++) {
    const before = await page.evaluate(
      () => document.querySelectorAll(".notion-toggle-block").length,
    );

    const closed = await page.$$(
      '.notion-toggle-block [role="button"][aria-expanded="false"]',
    );
    if (!closed.length) break;

    let passOpened = 0;
    for (const btn of closed) {
      try {
        await btn.evaluate((el) => {
          try {
            (el as HTMLElement).scrollIntoView({
              block: "center",
              inline: "nearest",
            });
          } catch {
            /* ignore */
          }
        });
        await btn.click({ delay: 15 });
        passOpened += 1;
        opened += 1;
        // Wait until this control reports open, or give up quickly
        await page
          .waitForFunction(
            (el) => el.getAttribute("aria-expanded") === "true",
            { timeout: 1200 },
            btn,
          )
          .catch(() => null);
        await new Promise((r) => setTimeout(r, 150));
      } catch {
        /* overlay / detached — continue */
      }
    }

    try {
      await page.waitForNetworkIdle({ idleTime: 250, timeout: 2_500 });
    } catch {
      await new Promise((r) => setTimeout(r, 200));
    }

    const after = await page.evaluate(
      () => document.querySelectorAll(".notion-toggle-block").length,
    );
    // No new nested toggles and nothing opened this pass → done
    if (passOpened === 0 && after <= before) break;
  }

  // Final settle so nested media requests can start
  try {
    await page.waitForNetworkIdle({ idleTime: 300, timeout: 3_000 });
  } catch {
    await new Promise((r) => setTimeout(r, 200));
  }
  return opened;
}

/**
 * Force Notion to mount lazy image/audio into the DOM, and extract source URLs
 * from React fiber props when the custom player stays empty.
 * Returns discovered remote media URLs (for download).
 *
 * Scrolls collection scrollers while harvesting — virtualized cards unmount
 * off-screen, and many lesson pages only load images after scroll-into-view.
 */
export async function hydrateNotionMedia(page: Page): Promise<string[]> {
  return page.evaluate(async () => {
    const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));
    const found = new Set<string>();

    const abs = (u: string | null | undefined) => {
      if (!u || u.startsWith("data:") || u.startsWith("blob:")) return null;
      try {
        return new URL(u, location.href).href;
      } catch {
        return null;
      }
    };

    const add = (u: string | null | undefined) => {
      const a = abs(u);
      if (a && /^https?:/i.test(a)) found.add(a);
    };

    const MEDIA_KEYS = [
      "src",
      "url",
      "source",
      "file",
      "signedUrl",
      "signed_url",
      "displaySource",
      "display_source",
      "originalSource",
      "original_source",
      "attachmentUrl",
      "attachment_url",
      "cachedUrl",
      "cached_url",
      "publicUrl",
      "public_url",
      "downloadUrl",
      "download_url",
      "page_cover",
      "page_icon",
      "icon",
      "cover",
      "photo",
      "image",
      "alias_pointer",
    ];

    const walkFiber = (node: unknown, depth = 0): void => {
      if (!node || depth > 14) return;
      const n = node as Record<string, unknown>;
      const props = (n.memoizedProps || n.pendingProps || {}) as Record<
        string,
        unknown
      >;
      for (const key of MEDIA_KEYS) {
        const v = props[key];
        if (typeof v === "string") add(v);
        if (v && typeof v === "object") {
          const o = v as Record<string, unknown>;
          if (typeof o.url === "string") add(o.url);
          if (typeof o.src === "string") add(o.src);
          if (typeof o.signedUrl === "string") add(o.signedUrl);
          if (typeof o.signed_url === "string") add(o.signed_url);
        }
      }
      // Notion file blocks often nest under props.blockValue.format
      const bv = props.blockValue as Record<string, unknown> | undefined;
      const format = (bv?.format || props.format) as
        | Record<string, unknown>
        | undefined;
      if (format) {
        for (const key of [
          "display_source",
          "source",
          "file_ids",
          "page_cover",
          "page_icon",
          "bookmark_cover",
          "bookmark_icon",
        ]) {
          const v = format[key];
          if (typeof v === "string") add(v);
        }
      }
      // Deep-scan string values that look like media URLs
      for (const v of Object.values(props)) {
        if (
          typeof v === "string" &&
          (/\/(image|file)\//i.test(v) ||
            /file\.notion\.so|notionusercontent|amazonaws\.com|secure\.notion-static/i.test(
              v,
            ) ||
            /\.(png|jpe?g|webp|gif|mp3|m4a|wav|ogg|pdf)(\?|$)/i.test(v))
        ) {
          add(v);
        }
      }
      walkFiber(n.child, depth + 1);
      walkFiber(n.sibling, depth + 1);
    };

    const fiberOf = (el: Element) => {
      const key = Object.keys(el).find(
        (k) =>
          k.startsWith("__reactFiber$") ||
          k.startsWith("__reactInternalInstance$"),
      );
      return key ? (el as unknown as Record<string, unknown>)[key] : null;
    };

    const harvestDomMedia = () => {
      for (const el of Array.from(
        document.querySelectorAll(
          "img[src], source[src], video[src], audio[src], img[data-src], img[data-lazy-src], img[data-original]",
        ),
      )) {
        add(el.getAttribute("src"));
        add(el.getAttribute("data-src"));
        add(el.getAttribute("data-lazy-src"));
        add(el.getAttribute("data-original"));
      }
      for (const el of Array.from(document.querySelectorAll("[srcset]"))) {
        for (const part of (el.getAttribute("srcset") || "").split(",")) {
          add(part.trim().split(/\s+/)[0]);
        }
      }
      for (const el of Array.from(
        document.querySelectorAll("[style*='url(']"),
      )) {
        const style = el.getAttribute("style") || "";
        for (const m of style.matchAll(/url\((['"]?)([^)'"]+)\1\)/g)) {
          add(m[2]);
        }
      }
    };

    // Toggles should already be expanded via expandAllToggles(); keep a light
    // in-page pass for any that CDP missed.
    for (const block of Array.from(
      document.querySelectorAll(".notion-toggle-block"),
    )) {
      const btn = block.querySelector(
        '[role="button"][aria-expanded="false"]',
      ) as HTMLElement | null;
      if (btn) btn.click();
    }
    await delay(400);

    const processedBlocks = new Set<string>();

    const processMediaBlocks = async (onlyNew = false) => {
      const mediaBlocks = Array.from(
        document.querySelectorAll(
          ".notion-image-block, .notion-audio-block, .notion-video-block, .notion-file-block, .notion-bookmark-block, .notion-callout-block",
        ),
      ) as HTMLElement[];

      for (const block of mediaBlocks) {
        const bid =
          block.getAttribute("data-block-id") ||
          `anon:${mediaBlocks.indexOf(block)}`;
        if (onlyNew && processedBlocks.has(bid)) continue;
        processedBlocks.add(bid);

        try {
          block.scrollIntoView({ block: "center", inline: "nearest" });
        } catch {
          /* ignore */
        }
        await delay(60);

        const isMounted = () =>
          Boolean(
            block.querySelector(
              "img[src]:not([src^='data:']), audio[src], video[src]",
            ),
          );

        // Click to force Notion player / image mount (never follow bookmark links)
        if (
          !block.classList.contains("notion-bookmark-block") &&
          !isMounted()
        ) {
          const hit =
            block.querySelector("[role='button']") ||
            block.querySelector("[role='figure']") ||
            block;
          try {
            (hit as HTMLElement).click();
          } catch {
            /* ignore */
          }
          // Wait for Notion to mount real media after scroll/click
          const deadline = Date.now() + 1800;
          while (Date.now() < deadline && !isMounted()) {
            await delay(120);
          }
        }

        walkFiber(fiberOf(block));

        // Bookmark covers often stay as 1×1 gif until a real URL is applied
        if (block.classList.contains("notion-bookmark-block")) {
          const coverFound = new Set<string>();
          const addCover = (u: string | null | undefined) => {
            const a = abs(u);
            if (a && /^https?:/i.test(a)) {
              coverFound.add(a);
              found.add(a);
            }
          };
          const coverKeys = [
            "bookmark_cover",
            "bookmarkCover",
            "cover",
            "coverUrl",
            "preview_image",
            "previewImage",
            "display_source",
            "source",
          ];
          const dig = (node: unknown, depth = 0): void => {
            if (!node || depth > 14) return;
            const n = node as Record<string, unknown>;
            const props = (n.memoizedProps || n.pendingProps || {}) as Record<
              string,
              unknown
            >;
            for (const key of coverKeys) {
              const v = props[key];
              if (typeof v === "string") addCover(v);
            }
            const bv = props.blockValue as Record<string, unknown> | undefined;
            const format = (bv?.format || props.format) as
              | Record<string, unknown>
              | undefined;
            if (format) {
              for (const key of coverKeys) {
                const v = format[key];
                if (typeof v === "string") addCover(v);
              }
            }
            dig(n.child, depth + 1);
            dig(n.sibling, depth + 1);
          };
          dig(fiberOf(block));

          const img = block.querySelector("img") as HTMLImageElement | null;
          if (img) {
            const src = img.getAttribute("src") || "";
            if (!src || /^data:image\/(gif|svg)/i.test(src)) {
              const covers = [...coverFound].filter(
                (u) =>
                  /\.(png|jpe?g|webp|gif)(\?|$)/i.test(u) ||
                  /\/image\//i.test(u) ||
                  /screens\.cdn\.|wordwall|unsplash|og-image|notionusercontent/i.test(
                    u,
                  ),
              );
              const pick = covers[0] || [...coverFound][0];
              if (pick) {
                img.setAttribute("src", pick);
                img.removeAttribute("srcset");
              }
            }
          }
        }

        for (const el of Array.from(
          block.querySelectorAll(
            "img[src], audio[src], source[src], video[src], a[href]",
          ),
        )) {
          add(el.getAttribute("src"));
          add(el.getAttribute("href"));
        }
      }
      return mediaBlocks;
    };

    let mediaBlocks = await processMediaBlocks(false);
    harvestDomMedia();

    // Scroll Notion scrollers so virtualized / below-fold media mounts
    for (const scroller of Array.from(
      document.querySelectorAll(".notion-scroller"),
    ) as HTMLElement[]) {
      const maxX = Math.max(0, scroller.scrollWidth - scroller.clientWidth);
      const maxY = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
      const stepX = Math.max(160, Math.floor(scroller.clientWidth * 0.7) || 160);
      const stepY = Math.max(160, Math.floor(scroller.clientHeight * 0.7) || 160);
      if (maxX > 0) {
        for (let x = 0; x <= maxX + stepX; x += stepX) {
          scroller.scrollLeft = Math.min(x, maxX);
          await delay(55);
          harvestDomMedia();
          mediaBlocks = await processMediaBlocks(true);
        }
        scroller.scrollLeft = 0;
      }
      if (maxY > 0) {
        for (let y = 0; y <= maxY + stepY; y += stepY) {
          scroller.scrollTop = Math.min(y, maxY);
          await delay(55);
          harvestDomMedia();
          mediaBlocks = await processMediaBlocks(true);
        }
        scroller.scrollTop = 0;
      }
    }

    const pageHeight = () =>
      Math.max(
        document.body?.scrollHeight || 0,
        document.documentElement?.scrollHeight || 0,
      );
    let prevH = 0;
    for (let i = 0; i < 24; i++) {
      const h = pageHeight();
      if (h <= prevH) break;
      prevH = h;
      window.scrollTo(0, h);
      await delay(70);
      harvestDomMedia();
      mediaBlocks = await processMediaBlocks(true);
    }
    window.scrollTo(0, 0);
    await delay(100);
    mediaBlocks = await processMediaBlocks(true);
    harvestDomMedia();

    // Performance resource entries catch lazy loads we missed in DOM attrs
    try {
      for (const e of performance.getEntriesByType("resource")) {
        const u = (e as PerformanceResourceTiming).name;
        if (
          /\/(image|file)\//i.test(u) ||
          /file\.notion\.so|notionusercontent|amazonaws\.com|secure\.notion-static/i.test(
            u,
          ) ||
          /\.(mp3|m4a|png|jpe?g|webp|gif|pdf)(\?|$)/i.test(u)
        ) {
          add(u);
        }
      }
    } catch {
      /* ignore */
    }

    // Inject <img>/<audio> into still-empty figures using discovered URLs keyed by block id
    const byBlock = new Map<string, string[]>();
    const normId = (raw: string) => raw.replace(/-/g, "").toLowerCase();
    for (const u of found) {
      try {
        const id = new URL(u).searchParams.get("id");
        if (!id) continue;
        const key = normId(id);
        const list = byBlock.get(key) || [];
        list.push(u);
        byBlock.set(key, list);
      } catch {
        /* ignore */
      }
    }

    const pickBest = (urls: string[], kind: "image" | "audio") => {
      const filtered = urls.filter((u) =>
        kind === "audio"
          ? /\.(mp3|m4a|ogg|wav)(\?|$)/i.test(u) || /file\.notion\.so/i.test(u)
          : /\/image\//i.test(u) ||
            /\.(png|jpe?g|webp|gif)(\?|$)/i.test(u) ||
            /notionusercontent|amazonaws\.com|secure\.notion-static/i.test(u),
      );
      if (!filtered.length) return null;
      // Prefer largest width=
      filtered.sort((a, b) => {
        const wa = Number(new URL(a).searchParams.get("width") || 0);
        const wb = Number(new URL(b).searchParams.get("width") || 0);
        return wb - wa;
      });
      return filtered[0]!;
    };

    for (const block of mediaBlocks) {
      const id = normId(block.getAttribute("data-block-id") || "");
      const urls = byBlock.get(id) || [];
      const figure =
        block.querySelector('[role="figure"]') ||
        block.querySelector("[data-content-editable-void]") ||
        block;

      if (block.classList.contains("notion-image-block")) {
        let img = block.querySelector("img") as HTMLImageElement | null;
        const best = pickBest(urls, "image");
        if (!img && best) {
          img = document.createElement("img");
          img.alt = "";
          img.referrerPolicy = "same-origin";
          img.style.display = "block";
          img.style.width = "100%";
          img.style.maxWidth = "100%";
          img.style.height = "auto";
          figure.appendChild(img);
        }
        if (img && best && (!img.src || img.src.startsWith("data:"))) {
          img.src = best;
        }
        if (img) add(img.src);
      }

      if (block.classList.contains("notion-audio-block")) {
        let audio = block.querySelector("audio") as HTMLAudioElement | null;
        const matched = urls.find(
          (u) =>
            /\.(mp3|m4a|ogg|wav)(\?|$)/i.test(u) || /file\.notion\.so/i.test(u),
        );
        const src = matched || pickBest(urls, "audio");
        if (!audio && src) {
          audio = document.createElement("audio");
          audio.controls = true;
          audio.preload = "metadata";
          audio.style.width = "100%";
          audio.style.display = "block";
          figure.appendChild(audio);
        }
        if (audio && src) {
          audio.src = src;
          add(src);
        }
      }
    }

    // Give browsers a moment to start fetching promoted lazy srcs
    await delay(500);
    harvestDomMedia();
    return [...found];
  });
}

/**
 * Prepare the painted Notion DOM for a static host:
 * keep header chrome, strip promo CTAs, fix fixed desktop widths,
 * leave scripts out (we inject our own offline runtime instead).
 */
export async function freezeNotionPage(page: Page): Promise<string> {
  await page.evaluate(async () => {
    const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

    // Best-effort expand for any toggles still closed (primary expand is CDP)
    for (const block of Array.from(
      document.querySelectorAll(".notion-toggle-block"),
    )) {
      const btn = block.querySelector(
        '[role="button"][aria-expanded="false"]',
      ) as HTMLElement | null;
      if (btn) btn.click();
    }
    await delay(400);

    // Convert Notion emoji spritesheet imgs → unicode spans (spritesheets aren't mirrored).
    // Alt is often "🟧 Page icon" — never put the "Page icon" label into visible text.
    const emojiGlyphFromAlt = (alt: string) => {
      let g = (alt || "").trim();
      g = g.replace(/\s*Page\s*icon\s*/gi, "").trim();
      return g;
    };
    for (const img of Array.from(
      document.querySelectorAll("img.notion-emoji"),
    ) as HTMLImageElement[]) {
      const rawAlt = (img.getAttribute("alt") || "").trim();
      const glyph = emojiGlyphFromAlt(rawAlt);
      if (!glyph) continue;
      const span = document.createElement("span");
      span.className = "notion-emoji";
      span.setAttribute("role", "img");
      span.setAttribute("aria-label", glyph);
      span.textContent = glyph;
      const st = img.getAttribute("style") || "";
      const w = img.style.width || "";
      const h = img.style.height || "";
      span.style.cssText =
        `display:inline-block;line-height:1;font-family:"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif;` +
        (w ? `width:${w};` : "") +
        (h ? `height:${h};font-size:${h};` : "") +
        (st.includes("vertical-align") ? "vertical-align:-0.1em;" : "");
      img.replaceWith(span);
    }
    // Strip "Page icon" from remaining icon img alts (broken-image fallback text)
    for (const img of Array.from(
      document.querySelectorAll('img[alt*="Page icon"], img[alt*="Page Icon"]'),
    ) as HTMLImageElement[]) {
      const cleaned = emojiGlyphFromAlt(img.getAttribute("alt") || "");
      img.setAttribute("alt", cleaned || "");
    }

    for (const img of Array.from(document.querySelectorAll("img"))) {
      const el = img as HTMLImageElement;
      const ds =
        el.getAttribute("data-src") ||
        el.getAttribute("data-lazy-src") ||
        el.getAttribute("data-original");
      if (
        ds &&
        (!el.getAttribute("src") || el.src.startsWith("data:image/svg") || el.src.startsWith("data:image/gif"))
      ) {
        el.setAttribute("src", ds);
      }
      const srcset = el.getAttribute("srcset");
      if (srcset) {
        const candidates = srcset
          .split(",")
          .map((p) => p.trim().split(/\s+/)[0]!);
        const last = candidates[candidates.length - 1];
        if (last) el.setAttribute("src", last);
      }
    }

    const absAttr = (el: Element, attr: string) => {
      const v = el.getAttribute(attr);
      if (!v || v.startsWith("data:") || v.startsWith("blob:") || v.startsWith("#"))
        return;
      try {
        el.setAttribute(attr, new URL(v, location.href).href);
      } catch {
        /* ignore */
      }
    };
    for (const el of Array.from(document.querySelectorAll("[href]")))
      absAttr(el, "href");
    for (const el of Array.from(document.querySelectorAll("[src]")))
      absAttr(el, "src");
    for (const el of Array.from(document.querySelectorAll("[poster]")))
      absAttr(el, "poster");
    for (const el of Array.from(document.querySelectorAll("audio, source, video"))) {
      absAttr(el, "src");
      const audio = el as HTMLAudioElement;
      if (el.tagName === "AUDIO") {
        audio.controls = true;
        audio.preload = "metadata";
      }
    }

    // Collapse toggles for default closed UI, but keep children in the DOM.
    // Mark content nodes so the offline runtime can show/hide reliably.
    for (const block of Array.from(
      document.querySelectorAll(".notion-toggle-block"),
    )) {
      const el = block as HTMLElement;
      el.setAttribute("data-nsp-open", "0");
      const btn = el.querySelector('[role="button"]') as HTMLElement | null;
      if (btn) {
        btn.setAttribute("aria-expanded", "false");
        btn.setAttribute("aria-label", "Open");
        const svg = btn.querySelector("svg") as SVGElement | null;
        if (svg) {
          svg.style.transform = "rotateZ(-90deg)";
          svg.style.fill = "currentColor";
        }
      }

      const contentNodes: HTMLElement[] = [];
      for (const child of Array.from(
        el.querySelectorAll(".notion-selectable"),
      ) as HTMLElement[]) {
        if (child === el) continue;
        if (child.classList.contains("notion-toggle-block")) continue;
        if (child.closest(".notion-toggle-block") !== el) continue;
        contentNodes.push(child);
      }
      if (!contentNodes.length) {
        const kids = Array.from(el.children) as HTMLElement[];
        if (kids.length >= 2) {
          for (let i = 1; i < kids.length; i++) contentNodes.push(kids[i]!);
        }
      }
      if (!contentNodes.length && el.children[0]) {
        const inner = Array.from(el.children[0]!.children) as HTMLElement[];
        for (let i = 1; i < inner.length; i++) contentNodes.push(inner[i]!);
      }

      for (const node of contentNodes) {
        node.setAttribute("data-nsp-toggle-content", "1");
        node.style.display = "none";
      }
    }

    // Inline accessible CSS (Notion look without remote dependency)
    const cssChunks: string[] = [];
    for (const sheet of Array.from(document.styleSheets)) {
      try {
        const rules = sheet.cssRules;
        if (!rules) continue;
        const parts: string[] = [];
        for (const rule of Array.from(rules)) parts.push(rule.cssText);
        if (parts.length) cssChunks.push(parts.join("\n"));
      } catch {
        /* cross-origin — keep <link> */
      }
    }
    if (cssChunks.length) {
      const style = document.createElement("style");
      style.setAttribute("data-notion-static-exporter", "inlined");
      // Drop print-only chrome-hiding rules Notion ships without a usable @media
      // wrapper after cssText serialization in some browsers.
      let css = cssChunks.join("\n\n");
      css = css.replace(
        /@media\s+print\s*\{[\s\S]*?\}\s*/gi,
        "/* print styles omitted */\n",
      );
      style.textContent = css;
      document.head.appendChild(style);
    }

    // Always keep the page topbar (breadcrumbs) visible offline
    const topbarFix = document.createElement("style");
    topbarFix.setAttribute("data-notion-static-exporter", "topbar");
    topbarFix.textContent = `
      .notion-topbar {
        display: flex !important;
        visibility: visible !important;
        opacity: 1 !important;
        height: 44px !important;
        pointer-events: auto !important;
      }
      header {
        display: block !important;
        visibility: visible !important;
      }
    `;
    document.head.appendChild(topbarFix);

    // Strip Notion client JS (would blank the page offline). We inject nsp-runtime.
    for (const el of Array.from(
      document.querySelectorAll(
        "script, link[rel='modulepreload'], link[rel='preload'][as='script']",
      ),
    )) {
      el.remove();
    }
    for (const el of Array.from(
      document.querySelectorAll(
        "link[rel='manifest'], meta[http-equiv='Content-Security-Policy']",
      ),
    )) {
      el.remove();
    }

    for (const sel of [
      ".notion-overlay-container",
      ".notion-help-button",
      "[data-testid='exit-presentation-mode-button']",
    ]) {
      for (const el of Array.from(document.querySelectorAll(sel))) el.remove();
    }

    for (const el of Array.from(document.querySelectorAll("[contenteditable]"))) {
      el.removeAttribute("contenteditable");
      (el as HTMLElement).style.caretColor = "transparent";
    }

    // Remove promo / auth CTAs in the topbar (keep the topbar shell + breadcrumbs + ⋮)
    const promoRe =
      /^(get notion free|log in|sign up|duplicate|try notion|download|share site to socials)$/i;
    for (const el of Array.from(
      document.querySelectorAll(".notion-topbar [role='button'], .notion-topbar a"),
    )) {
      const t = (el.textContent || "").replace(/\s+/g, " ").trim();
      const label = (el.getAttribute("aria-label") || "").trim();
      if (promoRe.test(t) || promoRe.test(label)) {
        const wrap = el.closest(".xjp7ctv") || el;
        (wrap as HTMLElement).remove();
      }
    }
    // Remove topbar Search only (not collection Search)
    for (const el of Array.from(
      document.querySelectorAll(".notion-topbar [role='button']"),
    )) {
      if (el.closest(".notion-collection_view-block")) continue;
      const label = (el.getAttribute("aria-label") || "").toLowerCase();
      const svg = el.querySelector(
        "svg.magnifyingGlass, svg.magnifyingGlassSmall",
      );
      if (label === "search" || (svg && !label.includes("more"))) {
        const wrap = el.closest(".xjp7ctv") || el;
        (wrap as HTMLElement).remove();
      }
    }
    // Explicit Get Notion free text nodes
    for (const el of Array.from(document.querySelectorAll(".notion-topbar *"))) {
      const t = (el.textContent || "").replace(/\s+/g, " ").trim();
      if (t === "Get Notion free" && el.children.length === 0) {
        const btn = el.closest("[role='button']") || el;
        btn.remove();
      }
    }

    // Unlock responsive layout: Notion freezes desktop widths at scrape time
    const htmlEl = document.documentElement;
    htmlEl.style.setProperty("--full-viewport-height", "100dvh");
    htmlEl.style.setProperty("--safe-padding-left", "0px");
    htmlEl.style.setProperty("--safe-padding-right", "0px");
    htmlEl.style.removeProperty("width");

    for (const el of Array.from(
      document.querySelectorAll(".notion-frame, .notion-cursor-listener, main"),
    )) {
      const h = el as HTMLElement;
      if (h.style.width && /px$/.test(h.style.width)) {
        h.style.width = "100%";
        h.style.maxWidth = "100%";
      }
      if (h.style.height && h.style.height.includes("100vh")) {
        h.style.height = "calc(-44px + 100dvh)";
      }
    }

    // Clamp large frozen side padding on page chrome (desktop scrape viewport)
    for (const el of Array.from(
      document.querySelectorAll(
        ".layout, .layout-wide, .layout-content, .notion-page-content",
      ),
    ) as HTMLElement[]) {
      const padL = parseFloat(el.style.paddingLeft || el.style.paddingInlineStart || "0");
      const padR = parseFloat(el.style.paddingRight || el.style.paddingInlineEnd || "0");
      if (padL > 24) {
        el.style.paddingLeft = "0px";
        el.style.paddingInlineStart = "0px";
      }
      if (padR > 24) {
        el.style.paddingRight = "0px";
        el.style.paddingInlineEnd = "0px";
      }
    }

    document.documentElement.style.overflow = "auto";
    document.body.style.overflow = "auto";
    document.body.style.height = "auto";
    document.body.style.width = "100%";
    document.body.style.maxWidth = "100%";

    await delay(50);
  });

  return page.content();
}

/** Wait until the live Notion UI shell + page content are painted. */
export async function waitForLiveNotionUi(page: Page): Promise<void> {
  await page
    .waitForFunction(
      () => {
        const app =
          document.querySelector(".notion-app-inner") ||
          document.querySelector("#notion-app") ||
          document.querySelector(".notion-frame");
        const content =
          document.querySelector(".notion-page-content") ||
          document.querySelector(".notion-collection-view-body") ||
          document.querySelector(".notion-page-block") ||
          document.querySelector("[data-block-id]");
        const text = (document.body?.innerText || "").trim();
        return Boolean(app && content) || text.length > 80;
      },
      { timeout: 90_000 },
    )
    .catch(() => {
      /* continue */
    });
}
