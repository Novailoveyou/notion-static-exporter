/**
 * Offline runtime injected into every scraped page.
 * Collection tabs/filter/search/sort, toggles, TOC, image lightbox, media layout.
 */
export const RUNTIME_JS = `(() => {
  const $ = (s, r=document) => r.querySelector(s);
  const $$ = (s, r=document) => Array.from(r.querySelectorAll(s));

  const CLOSE_SVG =
    '<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M3.22 3.22a.75.75 0 0 1 1.06 0L8 6.94l3.72-3.72a.75.75 0 1 1 1.06 1.06L9.06 8l3.72 3.72a.75.75 0 1 1-1.06 1.06L8 9.06l-3.72 3.72a.75.75 0 0 1-1.06-1.06L6.94 8 3.22 4.28a.75.75 0 0 1 0-1.06z"/></svg>';

  function syncViewport() {
    const root = document.documentElement;
    const body = document.body;
    if (!root || !body) return;
    try {
      root.style.setProperty("--full-viewport-height", "100dvh");
      for (const el of $$(".notion-frame, main.notion-frame, .notion-cursor-listener")) {
        if (!el || !el.style) continue;
        if (el.style.width && /px$/.test(el.style.width)) {
          el.style.width = "100%";
          el.style.maxWidth = "100%";
        }
      }
      body.style.width = "100%";
      body.style.maxWidth = "100%";
      normalizeFrozenWidths(document);
    } catch (_) {
      /* ignore — can race during fullscreen / lightbox */
    }
  }

  /** Scraped Notion freezes desktop widths (often 1440px) — clamp without touching gallery cards. */
  function normalizeFrozenWidths(scope) {
    const root = scope || document;
    for (const el of $$(".layout, .layout-wide, .layout-content, .notion-page-content, .notion-frame, main.notion-frame", root)) {
      if (!el || !el.style) continue;
      const w = el.style.width || "";
      const mw = el.style.maxWidth || "";
      if (/\\d{3,}px/.test(w)) {
        el.style.width = "100%";
        el.style.maxWidth = "100%";
      }
      if (/\\d{3,}px/.test(mw) || /1440px/.test(mw)) {
        el.style.maxWidth = "100%";
      }
    }
    for (const el of $$(".notion-image-block", root)) {
      if (!el.style) continue;
      const w = el.style.width || "";
      const mw = el.style.maxWidth || "";
      if (/1440px/.test(mw) || /1440px/.test(w)) {
        el.style.maxWidth = "100%";
      }
      if (/^\\d+(\\.\\d+)?px$/.test(w) && parseFloat(w) > 640) {
        el.style.width = "100%";
        el.style.maxWidth = "100%";
      }
    }
  }

  function hidePromos() {
    const re = /get notion free|log in|sign up|try notion|download app/i;
    for (const el of $$(".notion-topbar [role='button'], .notion-topbar a")) {
      const t = (el.textContent || "").replace(/\\s+/g, " ").trim();
      const a = el.getAttribute("aria-label") || "";
      if (re.test(t) || re.test(a)) {
        const wrap = el.closest(".xjp7ctv") || el;
        wrap.style.display = "none";
      }
    }
    for (const el of $$(".notion-topbar [role='button']")) {
      if (el.closest(".notion-collection_view-block, .notion-collection_view_page-block")) continue;
      const label = (el.getAttribute("aria-label") || "").toLowerCase();
      const svg = el.querySelector("svg.magnifyingGlass, svg.magnifyingGlassSmall");
      if (label === "search" || (svg && !label.includes("more"))) {
        const wrap = el.closest(".xjp7ctv") || el;
        wrap.style.display = "none";
      }
    }
    layoutTopbar();
  }

  /** Keep breadcrumbs left, ⋮ More actions pinned to the right. */
  function layoutTopbar() {
    for (const topbar of $$(".notion-topbar")) {
      const row =
        topbar.querySelector(":scope > div") || topbar;
      row.style.display = "flex";
      row.style.justifyContent = "space-between";
      row.style.alignItems = "center";
      row.style.width = "100%";
      row.style.maxWidth = "100%";
      row.style.boxSizing = "border-box";

      const more =
        topbar.querySelector("[aria-label='More actions']") ||
        topbar.querySelector("svg.ellipsis")?.closest("[role='button']");
      if (!more) continue;

      let right = topbar.querySelector("[data-nsp-topbar-right]");
      if (!right) {
        right = document.createElement("div");
        right.setAttribute("data-nsp-topbar-right", "1");
        Object.assign(right.style, {
          display: "flex",
          alignItems: "center",
          justifyContent: "flex-end",
          marginInlineStart: "auto",
          flexShrink: "0",
          gap: "2px",
        });
        row.appendChild(right);
      }
      const wrap = more.closest(".xjp7ctv") || more;
      if (wrap.parentElement !== right) right.appendChild(wrap);
      wrap.style.display = "";
      more.style.display = "";
    }
    // Remove any leftover install CTA
    for (const el of $$("[data-nsp-install]")) el.remove();
  }

  function menuItemStyle() {
    return {
      display: "block",
      width: "100%",
      textAlign: "left",
      padding: "8px 10px",
      borderRadius: "6px",
      border: "none",
      background: "transparent",
      color: "inherit",
      textDecoration: "none",
      fontWeight: "500",
      fontSize: "14px",
      fontFamily: "inherit",
      cursor: "pointer",
      boxSizing: "border-box",
    };
  }

  function hoverable(el) {
    el.onmouseenter = () => { el.style.background = "rgba(255,255,255,.08)"; };
    el.onmouseleave = () => { el.style.background = "transparent"; };
  }

  function currentTheme() {
    const saved = localStorage.getItem("nsp-theme");
    if (saved === "dark" || saved === "light") return saved;
    if (document.querySelector(".notion-light-theme") && !document.querySelector(".notion-dark-theme")) {
      return "light";
    }
    return "dark";
  }

  function applyTheme(theme) {
    const next = theme === "light" ? "light" : "dark";
    localStorage.setItem("nsp-theme", next);
    const dark = next === "dark";
    const swap = (el) => {
      if (!el || !el.classList) return;
      el.classList.toggle("notion-dark-theme", dark);
      el.classList.toggle("notion-light-theme", !dark);
    };
    swap(document.documentElement);
    for (const el of $$(
      ".notion-dark-theme, .notion-light-theme, .notion-app-inner, [data-nsp-peek-root]",
    )) {
      swap(el);
    }
    // Ensure primary hosts exist
    const app = document.getElementById("notion-app");
    if (app) {
      for (const child of Array.from(app.children)) swap(child);
    }
  }

  function peekModeLabel(mode) {
    if (mode === "side") return "Side panel";
    if (mode === "center") return "Dialog";
    return "Fullscreen";
  }

  function cyclePeekMode() {
    const order = ["full", "side", "center"];
    const i = Math.max(0, order.indexOf(peekMode));
    peekMode = order[(i + 1) % order.length];
    localStorage.setItem("nsp-peek-mode", peekMode);
    if (peekCurrentHref) openPeek(peekCurrentHref, peekMode);
    else if (peekRoot) peekRoot.setAttribute("data-mode", peekMode === "full" ? "full" : peekMode);
    return peekMode;
  }

  function wireOriginalMenu(scope) {
    const root = scope || document;
    const original =
      document.documentElement.getAttribute("data-nsp-original-url") || "";

    const btns = new Set();
    for (const el of $$(".notion-topbar [aria-label='More actions']", root)) {
      btns.add(el);
    }
    for (const svg of $$(".notion-topbar svg.ellipsis", root)) {
      const b = svg.closest("[role='button']");
      if (b) btns.add(b);
    }

    for (const btn of btns) {
      if (btn.dataset.nspWired) continue;
      btn.dataset.nspWired = "1";
      btn.style.pointerEvents = "auto";
      btn.style.cursor = "pointer";
      btn.style.zIndex = "20";

      let pop = null;
      const close = () => {
        if (pop) {
          pop.remove();
          pop = null;
        }
        btn.setAttribute("aria-expanded", "false");
      };

      const rebuild = () => {
        if (!pop) return;
        pop.innerHTML = "";

        if (original && !original.startsWith("./")) {
          const link = document.createElement("a");
          link.href = original;
          link.target = "_blank";
          link.rel = "noopener noreferrer";
          link.textContent = "Open original page";
          Object.assign(link.style, menuItemStyle());
          hoverable(link);
          const url = document.createElement("div");
          url.textContent = original;
          Object.assign(url.style, {
            padding: "0 10px 8px",
            opacity: "0.55",
            fontSize: "12px",
            wordBreak: "break-all",
            lineHeight: "1.35",
          });
          pop.appendChild(link);
          pop.appendChild(url);
        }

        const viewBtn = document.createElement("button");
        viewBtn.type = "button";
        viewBtn.textContent = "Default view: " + peekModeLabel(peekMode);
        Object.assign(viewBtn.style, menuItemStyle());
        hoverable(viewBtn);
        viewBtn.addEventListener("click", (ev) => {
          ev.preventDefault();
          ev.stopPropagation();
          cyclePeekMode();
          viewBtn.textContent = "Default view: " + peekModeLabel(peekMode);
        });
        pop.appendChild(viewBtn);

        const themeBtn = document.createElement("button");
        themeBtn.type = "button";
        const theme = currentTheme();
        themeBtn.textContent =
          theme === "dark" ? "Theme: Dark (switch to Light)" : "Theme: Light (switch to Dark)";
        Object.assign(themeBtn.style, menuItemStyle());
        hoverable(themeBtn);
        themeBtn.addEventListener("click", (ev) => {
          ev.preventDefault();
          ev.stopPropagation();
          const next = currentTheme() === "dark" ? "light" : "dark";
          applyTheme(next);
          themeBtn.textContent =
            next === "dark"
              ? "Theme: Dark (switch to Light)"
              : "Theme: Light (switch to Dark)";
        });
        pop.appendChild(themeBtn);
      };

      btn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (pop) {
          close();
          return;
        }
        pop = document.createElement("div");
        pop.setAttribute("data-nsp-menu", "1");
        Object.assign(pop.style, {
          position: "absolute",
          top: "100%",
          right: "0",
          marginTop: "6px",
          minWidth: "240px",
          maxWidth: "min(360px, 90vw)",
          padding: "8px",
          borderRadius: "10px",
          background: "var(--c-bacPri, #191919)",
          color: "var(--c-texPri, #fff)",
          boxShadow:
            "0 8px 28px rgba(0,0,0,.35), 0 0 0 1px rgba(255,255,255,.08)",
          zIndex: "10000",
          fontSize: "14px",
        });
        rebuild();
        const host = btn.closest(".xjp7ctv") || btn.parentElement || btn;
        if (getComputedStyle(host).position === "static") {
          host.style.position = "relative";
        }
        host.style.zIndex = "30";
        host.appendChild(pop);
        btn.setAttribute("aria-expanded", "true");
      });

      document.addEventListener("click", (e) => {
        if (!pop) return;
        if (pop.contains(e.target) || btn.contains(e.target)) return;
        close();
      });
    }
  }

  function filterItems(root, q) {
    const query = (q || "").trim().toLowerCase();
    for (const item of $$(
      ".notion-collection-item, .notion-gallery-view .notion-page-block, .notion-table-view-row, .notion-list-view .notion-page-block, .notion-board-view .notion-page-block, .notion-calendar-view .notion-page-block",
      root,
    )) {
      const text = (item.textContent || "").toLowerCase();
      item.style.display = !query || text.includes(query) ? "" : "none";
    }
  }

  function themeHost() {
    return (
      document.querySelector(".notion-dark-theme") ||
      document.querySelector(".notion-light-theme") ||
      document.querySelector(".notion-app-inner") ||
      document.body
    );
  }

  function closePanel(root) {
    for (const el of document.querySelectorAll(
      "[data-nsp-panel], [data-nsp-panel-backdrop]",
    )) {
      el.remove();
    }
    if (root) filterItems(root, "");
  }

  function openFilterPanel(root, anchor, placeholder) {
    closePanel(root);
    const mobile = window.matchMedia("(max-width: 640px)").matches;
    const host = themeHost();

    const backdrop = document.createElement("div");
    backdrop.setAttribute("data-nsp-panel-backdrop", "1");
    Object.assign(backdrop.style, {
      position: "fixed",
      inset: "0",
      zIndex: "40000",
      background: mobile ? "rgba(0,0,0,.45)" : "transparent",
    });
    backdrop.addEventListener("click", () => {
      closePanel(root);
      anchor.setAttribute("aria-expanded", "false");
    });

    const panel = document.createElement("div");
    panel.setAttribute("data-nsp-panel", "1");
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-label", placeholder || "Filter");

    const basePanel = {
      position: "fixed",
      zIndex: "40001",
      padding: mobile ? "16px 16px 20px" : "12px 12px 14px",
      borderRadius: mobile ? "16px 16px 12px 12px" : "10px",
      background: "var(--c-bacPri, #191919)",
      color: "var(--c-texPri, #fff)",
      boxShadow: "0 8px 28px rgba(0,0,0,.45), 0 0 0 1px rgba(255,255,255,.1)",
      boxSizing: "border-box",
    };

    if (mobile) {
      Object.assign(panel.style, basePanel, {
        left: "0",
        right: "0",
        bottom: "0",
        width: "100%",
        maxWidth: "100vw",
        paddingBottom: "max(20px, env(safe-area-inset-bottom))",
      });
    } else {
      const r = anchor.getBoundingClientRect();
      const width = 260;
      let left = Math.min(r.right - width, window.innerWidth - width - 12);
      left = Math.max(12, left);
      let top = r.bottom + 8;
      if (top + 140 > window.innerHeight) {
        top = Math.max(12, r.top - 140);
      }
      Object.assign(panel.style, basePanel, {
        top: \`\${top}px\`,
        left: \`\${left}px\`,
        width: \`\${width}px\`,
        minWidth: "220px",
        maxWidth: "min(360px, calc(100vw - 24px))",
      });
    }

    const head = document.createElement("div");
    Object.assign(head.style, {
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      marginBottom: "10px",
      gap: "8px",
    });
    const title = document.createElement("div");
    title.textContent = placeholder || "Filter";
    Object.assign(title.style, {
      fontSize: "13px",
      fontWeight: "600",
      opacity: "0.85",
    });
    const closeBtn = document.createElement("button");
    closeBtn.type = "button";
    closeBtn.setAttribute("aria-label", "Close");
    closeBtn.innerHTML = CLOSE_SVG;
    Object.assign(closeBtn.style, {
      appearance: "none",
      border: "none",
      background: "transparent",
      color: "inherit",
      cursor: "pointer",
      padding: "8px",
      borderRadius: "8px",
      display: "flex",
      opacity: "0.7",
      minWidth: "40px",
      minHeight: "40px",
      alignItems: "center",
      justifyContent: "center",
    });
    closeBtn.onmouseenter = () => {
      closeBtn.style.opacity = "1";
      closeBtn.style.background = "rgba(255,255,255,.08)";
    };
    closeBtn.onmouseleave = () => {
      closeBtn.style.opacity = "0.7";
      closeBtn.style.background = "transparent";
    };
    closeBtn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      closePanel(root);
      anchor.setAttribute("aria-expanded", "false");
    });
    head.appendChild(title);
    head.appendChild(closeBtn);

    const wrap = document.createElement("div");
    Object.assign(wrap.style, {
      position: "relative",
      display: "flex",
      alignItems: "center",
    });
    const input = document.createElement("input");
    input.type = "search";
    input.placeholder = placeholder || "Filter…";
    input.setAttribute("data-nsp-filter-input", "1");
    input.setAttribute("enterkeyhint", "search");
    Object.assign(input.style, {
      flex: "1",
      padding: mobile ? "14px 16px" : "8px 12px",
      borderRadius: "8px",
      border: "1px solid rgba(255,255,255,0.15)",
      background: "rgba(255,255,255,0.04)",
      color: "inherit",
      fontSize: mobile ? "16px" : "14px", // 16px avoids iOS zoom
      width: "100%",
      minWidth: "0",
      outline: "none",
      boxSizing: "border-box",
    });
    wrap.appendChild(input);
    panel.appendChild(head);
    panel.appendChild(wrap);

    host.appendChild(backdrop);
    host.appendChild(panel);
    anchor.setAttribute("aria-expanded", "true");

    // Keep desktop panel on-screen when keyboard/orientation changes
    const place = () => {
      if (mobile || !panel.isConnected) return;
      const r = anchor.getBoundingClientRect();
      const width = panel.offsetWidth || 260;
      let left = Math.min(r.right - width, window.innerWidth - width - 12);
      left = Math.max(12, left);
      let top = r.bottom + 8;
      if (top + panel.offsetHeight > window.innerHeight - 12) {
        top = Math.max(12, r.top - panel.offsetHeight - 8);
      }
      panel.style.top = \`\${top}px\`;
      panel.style.left = \`\${left}px\`;
    };
    window.addEventListener("resize", place, { passive: true });
    window.addEventListener("scroll", place, { passive: true, capture: true });

    const cleanup = () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
    const obs = new MutationObserver(() => {
      if (!panel.isConnected) {
        cleanup();
        obs.disconnect();
      }
    });
    obs.observe(document.documentElement, { childList: true, subtree: true });

    input.focus();
    input.addEventListener("input", () => filterItems(root, input.value));
    input.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        closePanel(root);
        anchor.setAttribute("aria-expanded", "false");
      }
    });
  }

  function openSearchInline(root, btn) {
    let wrap = root.querySelector("[data-nsp-search-wrap]");
    if (wrap) {
      const existing = wrap.querySelector("input");
      // Re-clicking Search while open: clear if filled, otherwise close
      if (existing && existing.value.trim()) {
        existing.value = "";
        filterItems(root, "");
        existing.focus();
        return;
      }
      wrap.remove();
      filterItems(root, "");
      btn.style.display = "";
      return;
    }
    btn.style.display = "none";
    wrap = document.createElement("div");
    wrap.setAttribute("data-nsp-search-wrap", "1");
    Object.assign(wrap.style, {
      display: "inline-flex",
      alignItems: "center",
      gap: "4px",
      marginLeft: "4px",
    });
    const input = document.createElement("input");
    input.type = "search";
    input.placeholder = "Search…";
    input.setAttribute("data-nsp-filter-input", "1");
    input.setAttribute("enterkeyhint", "search");
    Object.assign(input.style, {
      padding: "4px 8px",
      borderRadius: "6px",
      border: "1px solid rgba(255,255,255,0.15)",
      background: "transparent",
      color: "inherit",
      fontSize: "14px",
      minWidth: "140px",
      maxWidth: "min(220px, 50vw)",
      outline: "none",
    });
    const closeBtn = document.createElement("button");
    closeBtn.type = "button";
    closeBtn.setAttribute("aria-label", "Clear search");
    closeBtn.innerHTML = CLOSE_SVG;
    Object.assign(closeBtn.style, {
      appearance: "none",
      border: "none",
      background: "transparent",
      color: "inherit",
      cursor: "pointer",
      padding: "4px",
      borderRadius: "6px",
      display: "flex",
      opacity: "0.75",
      minWidth: "32px",
      minHeight: "32px",
      alignItems: "center",
      justifyContent: "center",
    });
    const close = () => {
      wrap.remove();
      filterItems(root, "");
      btn.style.display = "";
    };
    const clearOrClose = () => {
      // First click clears text; second click (when empty) closes search
      if (input.value.trim()) {
        input.value = "";
        filterItems(root, "");
        input.focus();
        closeBtn.setAttribute("aria-label", "Close search");
        return;
      }
      close();
    };
    closeBtn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      clearOrClose();
    });
    input.addEventListener("input", () => {
      filterItems(root, input.value);
      closeBtn.setAttribute(
        "aria-label",
        input.value.trim() ? "Clear search" : "Close search",
      );
    });
    input.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        clearOrClose();
      }
    });
    wrap.appendChild(input);
    wrap.appendChild(closeBtn);
    (btn.parentElement || root).appendChild(wrap);
    input.focus();
  }

  function wireCollectionSearch(root) {
    const btn = root.querySelector('[aria-label="Search"]');
    if (!btn || btn.dataset.nspWired) return;
    btn.dataset.nspWired = "1";
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      openSearchInline(root, btn);
    });
  }

  function wireCollectionFilter(root) {
    const btn =
      root.querySelector(".notion-collection-filter") ||
      root.querySelector('[aria-label="Filter"]');
    if (!btn || btn.dataset.nspWired) return;
    btn.dataset.nspWired = "1";
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (document.querySelector("[data-nsp-panel]")) {
        closePanel(root);
        btn.setAttribute("aria-expanded", "false");
        return;
      }
      openFilterPanel(root, btn, "Filter…");
    });
  }

  function wireCollectionSort(root) {
    const btn = root.querySelector(".notion-collection-sort, [aria-label='Sort']");
    if (!btn || btn.dataset.nspWired) return;
    btn.dataset.nspWired = "1";
    let asc = true;
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      const body = root.querySelector(".notion-collection-view-body") || root;
      const grid =
        body.querySelector(".notion-gallery-view > div > div[style*='grid']") ||
        body.querySelector(".notion-gallery-view div[style*='grid-template']") ||
        body.querySelector(".notion-table-view");
      const items = $$(".notion-collection-item, .notion-table-view-row", grid || body);
      if (!items.length) return;
      const parent = items[0].parentElement;
      if (!parent) return;
      const sorted = items.slice().sort((a, b) => {
        const ta = (a.textContent || "").trim().toLowerCase();
        const tb = (b.textContent || "").trim().toLowerCase();
        return asc ? ta.localeCompare(tb) : tb.localeCompare(ta);
      });
      asc = !asc;
      for (const it of sorted) parent.appendChild(it);
      btn.setAttribute("data-nsp-active", "1");
    });
  }

  function tabLabel(el) {
    return (el.textContent || "").replace(/\\s+/g, " ").trim();
  }

  function collectionTabs(root) {
    const tablist = root.querySelector('[role="tablist"]');
    const scope = tablist || root;
    const buttons = $$(".notion-collection-view-tab-button", scope);
    if (buttons.length) return buttons;
    const raw = $$('[role="tab"], .notion-collection-view-tab', scope);
    return raw.filter((t) => !t.closest(".notion-collection-view-tab-button"));
  }

  function styleTab(tab, selected) {
    // Mark selection only — do not paint a second background over Notion's own tab chrome
    const targets = [tab, ...$$('[role="tab"], .notion-collection-view-tab', tab)];
    for (const el of targets) {
      el.setAttribute("aria-selected", selected ? "true" : "false");
      if (selected) el.setAttribute("data-nsp-active", "1");
      else el.removeAttribute("data-nsp-active");
      // Clear leftovers from older runtime versions
      el.style.background = "";
    }
  }

  function findCapturedView(views, tab, index) {
    const label = tabLabel(tab).toLowerCase();
    const byLabel = views.tabs.find((t) => {
      const L = (t.label || "").toLowerCase();
      return L === label || label.includes(L) || L.includes(label);
    });
    return byLabel || views.tabs[index];
  }

  function defaultTabIndex(views, tabs) {
    // Prefer Gallery, then Table — never leave Calendar as the default
    let idx = tabs.findIndex((t) => /gallery/i.test(tabLabel(t)));
    if (idx < 0) idx = tabs.findIndex((t) => /^table\\b/i.test(tabLabel(t)));
    if (idx < 0 && views && views.defaultLabel) {
      const prefer = String(views.defaultLabel).toLowerCase();
      if (!/calendar/i.test(prefer)) {
        idx = tabs.findIndex((t) => tabLabel(t).toLowerCase() === prefer);
      }
    }
    if (idx < 0) {
      idx =
        views && typeof views.defaultIndex === "number" ? views.defaultIndex : 0;
    }
    return Math.max(0, Math.min(idx, Math.max(0, tabs.length - 1)));
  }

  function applyView(root, views, tabs, body, index) {
    const view = findCapturedView(views, tabs[index], index);
    if (!view) return;
    body.innerHTML = view.html;
    tabs.forEach((t, j) => styleTab(t, j === index));
    filterItems(root, "");
    enhanceMedia(body);
    wireToggles(body);
    wireCardActions(root);
  }

  function findCollectionBody(root) {
    let body =
      root.querySelector(".notion-collection-view-body") ||
      root.querySelector(".notion-scroller.notion-collection-view-body") ||
      root.querySelector(".notion-scroller.vertical.horizontal");
    if (body) return body;
    // collection_view_page: body is often a sibling of the tablist host
    const tablist = root.querySelector('[role="tablist"]');
    let el = tablist || root;
    while (el) {
      const b = el.querySelector && el.querySelector(".notion-collection-view-body");
      if (b) return b;
      el = el.parentElement;
    }
    return document.querySelector(".notion-collection-view-body");
  }

  function wireViewTabs(root, views) {
    const tabs = collectionTabs(root);
    const body = findCollectionBody(root);
    if (!tabs.length) return;

    // Always make tabs look/feel clickable (even before captures exist)
    for (const tab of tabs) {
      tab.style.cursor = "pointer";
      tab.style.pointerEvents = "auto";
      const inner = tab.querySelector('[role="tab"], .notion-collection-view-tab');
      if (inner) {
        inner.style.cursor = "pointer";
        inner.style.pointerEvents = "auto";
      }
    }

    if (!views || !views.tabs || !views.tabs.length || !body) return;

    const def = defaultTabIndex(views, tabs);
    // Apply default view on load
    applyView(root, views, tabs, body, def);

    tabs.forEach((tab, i) => {
      if (tab.dataset.nspWired) return;
      tab.dataset.nspWired = "1";
      tab.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (e.stopImmediatePropagation) e.stopImmediatePropagation();
        const selected = tab.getAttribute("aria-selected") === "true" ||
          tab.querySelector('[aria-selected="true"]');
        // Clicking an already-selected non-default tab returns to Gallery view
        if (selected && i !== def) {
          applyView(root, views, tabs, body, def);
          return;
        }
        applyView(root, views, tabs, body, i);
      }, true);
    });
  }

  function wireCollectionsIn(scope, captures) {
    const blocks = $$([
      ".notion-selectable.notion-collection_view-block[data-block-id]",
      ".notion-collection_view-block[data-block-id]",
      ".notion-selectable.notion-collection_view_page-block[data-block-id]",
      ".notion-collection_view_page-block[data-block-id]",
    ].join(", "), scope);

    const seen = new Set();
    for (const block of blocks) {
      const root =
        block.closest(".notion-selectable.notion-collection_view-block") ||
        block.closest(".notion-selectable.notion-collection_view_page-block") ||
        block;
      if (seen.has(root)) continue;
      seen.add(root);
      wireCollectionRoot(root, captures || []);
    }
  }

  function wireToggles(scope) {
    for (const block of $$(".notion-toggle-block", scope || document)) {
      if (block.dataset.nspToggleWired) continue;
      block.dataset.nspToggleWired = "1";
      const btn =
        block.querySelector(":scope [role='button']") ||
        block.querySelector(":scope > div > div[role='button']");
      const title = block.querySelector("[data-content-editable-leaf]");
      if (!btn && !title) continue;

      const contentNodes = () => {
        const marked = $$("[data-nsp-toggle-content]", block);
        if (marked.length) return marked;

        // Nested Notion body: .notion-selectable blocks that belong to THIS toggle
        const nested = $$(".notion-selectable", block).filter((el) => {
          if (el === block) return false;
          if (el.classList.contains("notion-toggle-block")) return false;
          return el.closest(".notion-toggle-block") === block;
        });
        if (nested.length) return nested;

        // Sibling of the title row (Script / STUDENT A layout)
        if (title) {
          let row = title.parentElement;
          while (row && row !== block) {
            const parent = row.parentElement;
            if (parent && parent.children.length >= 2) {
              const body = Array.from(parent.children).filter(
                (n) => n !== row && !n.contains(title) && !n.querySelector?.("[data-content-editable-leaf]"),
              );
              if (body.length) return body;
            }
            row = parent;
          }
        }

        const rows = Array.from(block.children);
        if (rows.length >= 2) return rows.slice(1);
        const inner = block.querySelector(":scope > div");
        if (inner) {
          const kids = Array.from(inner.children);
          if (kids.length >= 2) return kids.slice(1);
        }
        return [];
      };

      const setOpen = (open) => {
        block.setAttribute("data-nsp-open", open ? "1" : "0");
        if (btn) {
          btn.setAttribute("aria-expanded", open ? "true" : "false");
          btn.setAttribute("aria-label", open ? "Close" : "Open");
          const svg = btn.querySelector("svg");
          if (svg) {
            svg.style.transform = open ? "rotateZ(0deg)" : "rotateZ(-90deg)";
            svg.style.fill = "currentColor";
            svg.style.color = "currentColor";
          }
        }
        for (const n of contentNodes()) {
          if (btn && (n === btn || btn.contains(n))) continue;
          if (title && (n === title || title.contains(n))) continue;
          n.style.display = open ? "" : "none";
        }
      };

      // Always start collapsed offline (content stays in DOM for click-to-open)
      setOpen(false);

      const onToggle = (e) => {
        if (e.target.closest("a")) return;
        e.preventDefault();
        e.stopPropagation();
        setOpen(block.getAttribute("data-nsp-open") !== "1");
      };
      if (btn) {
        btn.style.cursor = "pointer";
        btn.addEventListener("click", onToggle);
      }
      if (title) {
        title.style.cursor = "pointer";
        title.addEventListener("click", onToggle);
      }
    }
  }

  function wireToc() {
    const toc = $(".notion-floating-table-of-contents");
    if (!toc || toc.dataset.nspWired) return;
    toc.dataset.nspWired = "1";

    const headings = $$(".notion-page-content h1, .notion-page-content h2, .notion-page-content h3, .notion-page-content .notion-sub_header-block, .notion-page-content .notion-header-block");
    const entries = [];
    for (const h of headings) {
      const text = (h.textContent || "").replace(/\\s+/g, " ").trim();
      if (!text || text.length > 80) continue;
      if (!h.id) h.id = "nsp-" + Math.random().toString(36).slice(2, 9);
      entries.push({ id: h.id, text, el: h });
    }
    if (!entries.length) return;

    // Build / enhance popover
    let pop = toc.querySelector("[data-nsp-toc-pop]");
    if (!pop) {
      pop = document.createElement("div");
      pop.setAttribute("data-nsp-toc-pop", "1");
      Object.assign(pop.style, {
        display: "none",
        position: "absolute",
        right: "28px",
        top: "0",
        minWidth: "180px",
        maxWidth: "240px",
        padding: "6px",
        borderRadius: "10px",
        background: "var(--c-bacPri, #191919)",
        color: "var(--c-texPri, #fff)",
        boxShadow: "0 8px 28px rgba(0,0,0,.35), 0 0 0 1px rgba(255,255,255,.1)",
        zIndex: "1000",
        fontSize: "13px",
        pointerEvents: "auto",
      });
      for (const entry of entries) {
        const a = document.createElement("a");
        a.href = "#" + entry.id;
        a.textContent = entry.text;
        Object.assign(a.style, {
          display: "block",
          padding: "6px 10px",
          borderRadius: "6px",
          color: "inherit",
          textDecoration: "none",
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
        });
        a.onmouseenter = () => { a.style.background = "rgba(255,255,255,.08)"; };
        a.onmouseleave = () => { a.style.background = "transparent"; };
        a.addEventListener("click", (ev) => {
          ev.preventDefault();
          entry.el.scrollIntoView({ behavior: "smooth", block: "start" });
          pop.style.display = "none";
        });
        pop.appendChild(a);
      }
      const host = toc.querySelector("[style*='position: absolute']") || toc;
      if (getComputedStyle(host).position === "static") host.style.position = "relative";
      host.appendChild(pop);
    }

    const show = () => { pop.style.display = "block"; };
    const hide = () => { pop.style.display = "none"; };
    toc.addEventListener("mouseenter", show);
    toc.addEventListener("mouseleave", hide);
    toc.style.pointerEvents = "auto";
    for (const bar of $$("div", toc)) {
      if (bar === pop || pop.contains(bar)) continue;
      bar.style.cursor = "pointer";
    }
  }

  function isZoomableImage(img) {
    if (!img || img.tagName !== "IMG") return false;
    if (img.closest(".notion-collection-item a, .notion-gallery-view .notion-collection-item")) {
      return false;
    }
    if (img.closest(".notion-bookmark-block")) return false;
    if (!img.closest(".notion-image-block, .notion-page-content, [data-nsp-peek-body], .nsp-peek-content")) {
      return false;
    }
    const src = img.currentSrc || img.getAttribute("src") || "";
    if (!src) return false;
    if (src.indexOf("data:image/gif") === 0 || src.indexOf("data:image/svg") === 0) return false;
    return true;
  }

  function markZoomable(img) {
    if (!isZoomableImage(img)) {
      img.removeAttribute("data-nsp-zoom");
      return;
    }
    img.setAttribute("data-nsp-zoom", "1");
    img.style.cursor = "zoom-in";
    img.style.pointerEvents = "auto";
    const block = img.closest(".notion-image-block") || img.parentElement;
    if (block) {
      block.style.pointerEvents = "auto";
      block.style.cursor = "zoom-in";
    }
    if (img.dataset.nspZoomWired === "1") return;
    img.dataset.nspZoomWired = "1";
    img.addEventListener("click", (e) => {
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      e.preventDefault();
      e.stopPropagation();
      openLightbox(img);
    });
  }

  function enhanceMedia(scope) {
    const root = scope || document;
    repairBlockMedia(root);
    for (const img of $$(
      [
        ".notion-image-block img",
        ".notion-page-content img",
        "[data-nsp-peek-body] img",
        ".nsp-peek-content img",
        "[role='figure'] img",
      ].join(", "),
      root,
    )) {
      // Promote lazy placeholders when a real URL is available
      const lazy =
        img.getAttribute("data-src") ||
        img.getAttribute("data-lazy-src") ||
        img.getAttribute("data-original");
      const src = img.getAttribute("src") || "";
      if (lazy && (/^data:image\\/(gif|svg)/i.test(src) || !src)) {
        img.setAttribute("src", lazy);
      }
      // Don't flatten gallery / cover images — they use fixed heights
      if (!img.closest(".notion-collection-item, .notion-gallery-view, .notion-bookmark-block")) {
        img.style.maxWidth = "100%";
        img.style.height = "auto";
        img.style.maxHeight = "none";
      }
      // Bookmark favicons must keep their ~21px size (CSS used to force 100%)
      if (img.closest(".notion-bookmark-block")) {
        const st = img.getAttribute("style") || "";
        if (/width:\s*2[0-9](\.\d+)?px/i.test(st) || /width:\s*1[6-9](\.\d+)?px/i.test(st)) {
          img.style.setProperty("width", "22px", "important");
          img.style.setProperty("height", "22px", "important");
          img.style.setProperty("max-width", "22px", "important");
          img.style.setProperty("max-height", "22px", "important");
        }
      }
      repairMediaSrc(img);
      markZoomable(img);
    }
    for (const audio of $$("audio", root)) {
      repairMediaSrc(audio);
      audio.controls = true;
      audio.preload = "metadata";
      audio.style.maxWidth = "100%";
      audio.style.width = "100%";
      audio.style.display = "block";
      // Notion often disables hit-testing on the wrapper
      const wrap = audio.closest(".notion-audio-block, [data-content-editable-void]");
      if (wrap) {
        wrap.style.pointerEvents = "auto";
      }
      audio.style.pointerEvents = "auto";
    }
    for (const block of $$(".notion-audio-block", root)) {
      block.style.pointerEvents = "auto";
      let audio = block.querySelector("audio");
      if (!audio) {
        // Custom Notion player without <audio> — synthesize from known src attrs
        const srcEl = block.querySelector("[src]");
        const src = srcEl && srcEl.getAttribute("src");
        if (src && !src.startsWith("data:")) {
          audio = document.createElement("audio");
          audio.src = src;
          audio.controls = true;
          audio.preload = "metadata";
          audio.style.width = "100%";
          audio.style.display = "block";
          block.appendChild(audio);
        }
      }
      if (!audio) {
        // Last resort: map by data-block-id → downloaded file.notion.so asset
        const local = localAssetForBlock(block.getAttribute("data-block-id"), "audio");
        if (local) {
          audio = document.createElement("audio");
          audio.src = local;
          audio.controls = true;
          audio.preload = "metadata";
          audio.style.width = "100%";
          audio.style.maxWidth = "100%";
          audio.style.display = "block";
          const figure = block.querySelector('[role="figure"]') || block;
          figure.appendChild(audio);
        }
      }
      if (audio) {
        repairMediaSrc(audio);
        audio.controls = true;
        audio.style.width = "100%";
        audio.style.maxWidth = "100%";
        audio.style.display = "block";
        audio.style.pointerEvents = "auto";
        try { audio.load(); } catch (_) {}
      }
    }
    for (const table of $$(".notion-table-view", root)) {
      const scroller = table.closest(".notion-scroller") || table.parentElement;
      if (scroller) {
        scroller.style.overflowX = "auto";
        scroller.style.maxWidth = "100%";
      }
      table.style.maxWidth = "none";
    }
  }

  let assetMap = null;
  let assetMapPromise = null;
  let blockAssetIndex = null;

  function loadAssetMap() {
    if (assetMapPromise) return assetMapPromise;
    assetMapPromise = (async () => {
      try {
        const res = await fetch("./.nsp-cache.json", { cache: "force-cache" });
        if (!res.ok) return;
        const data = await res.json();
        assetMap = data && data.assets ? data.assets : null;
        blockAssetIndex = null;
      } catch {
        assetMap = null;
        blockAssetIndex = null;
      }
    })();
    return assetMapPromise;
  }

  function normBlockId(raw) {
    if (!raw) return "";
    const hex = String(raw).replace(/-/g, "").toLowerCase();
    return /^[0-9a-f]{32}$/.test(hex) ? hex : "";
  }

  function ensureBlockAssetIndex() {
    if (blockAssetIndex && assetMap) return blockAssetIndex;
    blockAssetIndex = new Map();
    if (!assetMap) return blockAssetIndex;
    for (const [remote, rel] of Object.entries(assetMap)) {
      let blockId = "";
      let width = 0;
      try {
        const u = new URL(String(remote).replace(/&amp;/g, "&"));
        blockId = normBlockId(u.searchParams.get("id"));
        width = Number(u.searchParams.get("width") || 0) || 0;
      } catch {
        continue;
      }
      if (!blockId) continue;
      const local = "./" + String(rel).replace(/^\\.\\//, "");
      const entry = blockAssetIndex.get(blockId) || { imageWidth: 0 };
      const isAudio =
        /\\.(mp3|m4a|ogg|wav|aac)(\\?|$)/i.test(remote) ||
        /\\.(mp3|m4a|ogg|wav|aac)$/i.test(local);
      const isImage =
        /\\/image\\//i.test(remote) ||
        /\\.(png|jpe?g|webp|gif|svg)$/i.test(local);
      if (isAudio) entry.audio = local;
      if (isImage && (!entry.image || width >= entry.imageWidth)) {
        entry.image = local;
        entry.imageWidth = width;
      }
      blockAssetIndex.set(blockId, entry);
    }
    return blockAssetIndex;
  }

  function localAssetForBlock(blockId, kind) {
    const id = normBlockId(blockId);
    if (!id) return null;
    const idx = ensureBlockAssetIndex();
    const entry = idx.get(id);
    return entry && entry[kind] ? entry[kind] : null;
  }

  /** Fix gif placeholders / empty audio+image figures using ?id=<block> assets. */
  function repairBlockMedia(scope) {
    const root = scope || document;
    if (!assetMap) return;
    ensureBlockAssetIndex();

    for (const block of $$(".notion-image-block[data-block-id]", root)) {
      const local = localAssetForBlock(block.getAttribute("data-block-id"), "image");
      if (!local) continue;
      let img = block.querySelector("img");
      if (!img) {
        const figure =
          block.querySelector('[role="figure"]') ||
          block.querySelector("[data-content-editable-void]") ||
          block;
        img = document.createElement("img");
        img.alt = "";
        img.referrerPolicy = "same-origin";
        img.style.display = "block";
        img.style.width = "100%";
        img.style.maxWidth = "100%";
        img.style.height = "auto";
        figure.appendChild(img);
      }
      const src = img.getAttribute("src") || "";
      if (!src || /^data:image\\/(gif|svg)/i.test(src) || /^https?:/i.test(src)) {
        img.setAttribute("src", local);
        img.removeAttribute("srcset");
      }
    }

    for (const block of $$(".notion-audio-block[data-block-id]", root)) {
      if (block.querySelector("audio[src]")) continue;
      const local = localAssetForBlock(block.getAttribute("data-block-id"), "audio");
      if (!local) continue;
      const audio = document.createElement("audio");
      audio.controls = true;
      audio.preload = "metadata";
      audio.src = local;
      audio.style.width = "100%";
      audio.style.maxWidth = "100%";
      audio.style.display = "block";
      const figure = block.querySelector('[role="figure"]') || block;
      figure.appendChild(audio);
      block.style.pointerEvents = "auto";
    }
  }

  function localAssetFor(remote) {
    if (!assetMap || !remote) return null;
    if (assetMap[remote]) return "./" + assetMap[remote].replace(/^\\.\\//, "");
    try {
      const u = new URL(remote);
      const pathKey = u.origin + u.pathname;
      for (const [k, v] of Object.entries(assetMap)) {
        if (k.startsWith(pathKey) || pathKey.startsWith(k.split("?")[0])) {
          return "./" + String(v).replace(/^\\.\\//, "");
        }
      }
      const uuids = u.pathname.match(
        /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi,
      );
      if (uuids) {
        for (const id of uuids) {
          for (const [k, v] of Object.entries(assetMap)) {
            if (k.includes(id)) return "./" + String(v).replace(/^\\.\\//, "");
          }
        }
      }
      const file = decodeURIComponent(u.pathname.split("/").pop() || "");
      if (file) {
        for (const [k, v] of Object.entries(assetMap)) {
          if (k.includes(file)) return "./" + String(v).replace(/^\\.\\//, "");
        }
      }
    } catch {
      /* ignore */
    }
    return null;
  }

  /** If media still points at Notion CDN, remap to a local ./assets file when possible. */
  function repairMediaSrc(el) {
    const src = el.getAttribute("src") || "";
    if (!src || src.startsWith("./") || src.startsWith("assets/") || src.startsWith("data:")) {
      return;
    }
    if (!/^https?:/i.test(src)) return;
    const apply = (local) => {
      if (!local) return;
      el.setAttribute("src", local);
      if (el.tagName === "AUDIO" || el.tagName === "VIDEO") {
        try { el.load(); } catch (_) {}
      }
    };
    const local = localAssetFor(src);
    if (local) {
      apply(local);
      return;
    }
    // Async: map may still be loading
    loadAssetMap().then(() => {
      const again = localAssetFor(src);
      if (again && (el.getAttribute("src") === src || /^https?:/i.test(el.getAttribute("src") || ""))) {
        apply(again);
      }
    });
  }

  function collectLightboxImages(fromImg) {
    const scope =
      (fromImg.closest("[data-nsp-peek-body]") ||
        fromImg.closest(".nsp-peek-content") ||
        fromImg.closest(".notion-page-content") ||
        document);
    const list = $$(".notion-image-block img", scope).filter((img) =>
      isZoomableImage(img),
    );
    // Dedupe by src
    const seen = new Set();
    const out = [];
    for (const img of list) {
      const key = img.currentSrc || img.src;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(img);
    }
    if (isZoomableImage(fromImg) && !out.includes(fromImg)) {
      out.unshift(fromImg);
    }
    return out.length ? out : [fromImg];
  }

  function setPeekUnderLightbox(on) {
    for (const p of $$("[data-nsp-peek-root]")) {
      if (on) p.setAttribute("data-nsp-under-lightbox", "1");
      else p.removeAttribute("data-nsp-under-lightbox");
    }
  }

  function openLightbox(img) {
    // Only remove the overlay dialog — never [data-nsp-lightbox] on <html>
    // (wireLightbox used to set that flag on documentElement and wiped the page).
    const existing = document.querySelector("div[data-nsp-lightbox]");
    if (existing) {
      try { if (existing.hidePopover) existing.hidePopover(); } catch (_) {}
      existing.remove();
    }
    setPeekUnderLightbox(false);

    const src0 = (img && (img.currentSrc || img.getAttribute("src") || img.src)) || "";
    if (!src0 || src0.indexOf("data:image/gif") === 0 || src0.indexOf("data:image/svg") === 0) {
      return;
    }

    const gallery = collectLightboxImages(img);
    let index = gallery.indexOf(img);
    if (index < 0) index = 0;

    const overlay = document.createElement("div");
    overlay.setAttribute("data-nsp-lightbox", "1");
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");
    // popover=manual → top layer above peek (z-index alone loses to peek stacking)
    try { overlay.setAttribute("popover", "manual"); } catch (_) {}
    overlay.style.cssText =
      "position:fixed;top:0;left:0;right:0;bottom:0;z-index:2147483646;" +
      "width:100vw;height:100vh;margin:0;border:none;max-width:none;max-height:none;" +
      "background:#111;display:flex;flex-direction:column;align-items:center;" +
      "justify-content:center;padding:16px;box-sizing:border-box;cursor:zoom-out;color:#fff;";

    const toolbar = document.createElement("div");
    toolbar.style.cssText =
      "position:absolute;top:12px;left:12px;right:12px;display:flex;" +
      "align-items:center;justify-content:flex-end;gap:8px;z-index:2;cursor:default;";

    const counter = document.createElement("div");
    counter.style.cssText =
      "margin-right:auto;color:rgba(255,255,255,.75);font-size:13px;" +
      "font-family:ui-sans-serif,system-ui,sans-serif;";

    function mkBtn(label, html, onClick) {
      const b = document.createElement("button");
      b.type = "button";
      b.setAttribute("aria-label", label);
      b.title = label;
      b.innerHTML = html;
      b.style.cssText =
        "appearance:none;border:none;background:rgba(255,255,255,.14);color:#fff;" +
        "border-radius:8px;padding:8px 10px;cursor:pointer;display:inline-flex;" +
        "align-items:center;gap:6px;font-size:13px;" +
        "font-family:ui-sans-serif,system-ui,sans-serif;";
      b.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        onClick(e);
      });
      return b;
    }

    const EXPAND_SVG =
      '<svg width="16" height="16" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true"><path d="M4.5 3.375A1.125 1.125 0 0 0 3.375 4.5V8a.625.625 0 1 0 1.25 0V5.508l4.067 4.067a.625.625 0 0 0 .884-.884L5.508 4.625H8a.625.625 0 1 0 0-1.25zM15.5 16.625a1.125 1.125 0 0 0 1.125-1.125V12a.625.625 0 1 0-1.25 0v2.492l-4.067-4.067a.625.625 0 1 0-.884.884l4.067 4.066H12a.625.625 0 1 0 0 1.25z"/></svg>';
    const COMPRESS_SVG =
      '<svg width="16" height="16" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true"><path d="M8.125 3.375a.625.625 0 0 1 .625.625V8c0 .69-.56 1.25-1.25 1.25H3.999a.625.625 0 1 1 0-1.25h2.492L2.424 4.183a.625.625 0 1 1 .884-.884L7.375 7.242V5a.625.625 0 0 1 .75-.625zM11.875 16.625a.625.625 0 0 1-.625-.625V12c0-.69.56-1.25 1.25-1.25h3.501a.625.625 0 1 1 0 1.25h-2.492l4.067 4.067a.625.625 0 1 1-.884.884L12.625 12.758V15a.625.625 0 0 1-.75.625z"/></svg>';
    const EXT_SVG =
      '<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M6.75 2a.75.75 0 0 1 0 1.5H3.5v9h9V9.25a.75.75 0 0 1 1.5 0v4A.75.75 0 0 1 13.25 14h-10A.75.75 0 0 1 2.5 13.25v-10A.75.75 0 0 1 3.25 2zm3.72.22a.75.75 0 0 1 .78-.17l.08.04.08.05.06.06.04.05L14.53 5.4a.75.75 0 0 1-1.06 1.06L12.5 5.49V10a.75.75 0 0 1 .75-.75h.01z"/></svg>';

    const panel = document.createElement("div");
    panel.style.cssText =
      "position:relative;max-width:min(1200px,96vw);max-height:88vh;cursor:default;" +
      "display:flex;flex-direction:column;align-items:center;gap:12px;";

    const big = document.createElement("img");
    big.alt = (img && img.alt) || "";
    big.style.cssText =
      "display:block;max-width:96vw;max-height:78vh;width:auto;height:auto;" +
      "object-fit:contain;border-radius:6px;background:#1a1a1a;cursor:zoom-in;";
    let enlarged = false;
    big.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      enlarged = !enlarged;
      if (enlarged) {
        overlay.style.overflow = "auto";
        overlay.style.alignItems = "flex-start";
        overlay.style.justifyContent = "flex-start";
        panel.style.maxWidth = "none";
        panel.style.maxHeight = "none";
        big.style.maxWidth = "none";
        big.style.maxHeight = "none";
        big.style.width = "auto";
        big.style.height = "auto";
        big.style.cursor = "zoom-out";
      } else {
        overlay.style.overflow = "";
        overlay.style.alignItems = "center";
        overlay.style.justifyContent = "center";
        panel.style.maxWidth = "min(1200px,96vw)";
        panel.style.maxHeight = "88vh";
        big.style.maxWidth = "96vw";
        big.style.maxHeight = "78vh";
        big.style.cursor = "zoom-in";
      }
    });

    const nav = document.createElement("div");
    nav.style.cssText =
      "display:flex;gap:8px;align-items:center;justify-content:center;cursor:default;";

    const openFullLink = document.createElement("a");
    openFullLink.target = "_blank";
    openFullLink.rel = "noopener noreferrer";
    openFullLink.innerHTML = EXT_SVG + "<span>Open full size</span>";
    openFullLink.style.cssText =
      "color:#fff;font-size:13px;text-decoration:none;padding:8px 12px;" +
      "border-radius:8px;background:rgba(255,255,255,.14);display:inline-flex;" +
      "align-items:center;gap:6px;font-family:ui-sans-serif,system-ui,sans-serif;";
    openFullLink.addEventListener("click", (e) => e.stopPropagation());

    let fsBtn = null;

    function syncFsBtn() {
      if (!fsBtn) return;
      const on = !!document.fullscreenElement;
      fsBtn.innerHTML =
        (on ? COMPRESS_SVG : EXPAND_SVG) +
        "<span>" + (on ? "Exit fullscreen" : "Fullscreen") + "</span>";
      fsBtn.setAttribute("aria-label", on ? "Exit fullscreen" : "Fullscreen");
      fsBtn.title = on ? "Exit fullscreen" : "Fullscreen";
    }

    function show(i) {
      if (!gallery.length) {
        big.src = src0;
        openFullLink.href = src0;
        return;
      }
      index = ((i % gallery.length) + gallery.length) % gallery.length;
      const srcImg = gallery[index] || img;
      const src =
        (srcImg && (srcImg.currentSrc || srcImg.getAttribute("src") || srcImg.src)) ||
        src0;
      big.src = src;
      big.alt = (srcImg && srcImg.alt) || "";
      openFullLink.href = src;
      counter.textContent =
        gallery.length > 1 ? index + 1 + " / " + gallery.length : "";
      prevBtn.style.visibility = gallery.length > 1 ? "visible" : "hidden";
      nextBtn.style.visibility = gallery.length > 1 ? "visible" : "hidden";
    }

    const prevBtn = mkBtn("Previous", "‹", () => show(index - 1));
    const nextBtn = mkBtn("Next", "›", () => show(index + 1));
    prevBtn.style.fontSize = "22px";
    nextBtn.style.fontSize = "22px";
    prevBtn.style.padding = "4px 14px";
    nextBtn.style.padding = "4px 14px";

    fsBtn = mkBtn("Fullscreen", EXPAND_SVG + "<span>Fullscreen</span>", () => {
      const go = async () => {
        try {
          if (document.fullscreenElement) await document.exitFullscreen();
          else await overlay.requestFullscreen();
        } catch (_) {
          const on = overlay.getAttribute("data-nsp-fs") === "1";
          overlay.setAttribute("data-nsp-fs", on ? "0" : "1");
          big.style.maxHeight = on ? "78vh" : "92vh";
          syncFsBtn();
        }
      };
      go();
    });

    function close() {
      const done = async () => {
        try {
          if (document.fullscreenElement) await document.exitFullscreen();
        } catch (_) {}
        try { if (overlay.hidePopover) overlay.hidePopover(); } catch (_) {}
        setPeekUnderLightbox(false);
        overlay.remove();
        document.removeEventListener("keydown", onKey, true);
        document.removeEventListener("fullscreenchange", syncFsBtn);
      };
      done();
    }

    function onKey(e) {
      if (!overlay.isConnected) return;
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        close();
        return;
      }
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        show(index - 1);
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        show(index + 1);
      }
    }

    const closeBtn = mkBtn("Close", CLOSE_SVG, () => close());

    toolbar.appendChild(counter);
    toolbar.appendChild(fsBtn);
    toolbar.appendChild(openFullLink);
    toolbar.appendChild(closeBtn);
    nav.appendChild(prevBtn);
    nav.appendChild(nextBtn);
    panel.appendChild(big);
    panel.appendChild(nav);
    overlay.appendChild(toolbar);
    overlay.appendChild(panel);

    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) close();
    });
    panel.addEventListener("click", (e) => e.stopPropagation());
    document.addEventListener("keydown", onKey, true);
    document.addEventListener("fullscreenchange", syncFsBtn);

    const mount = document.body || document.getElementById("notion-app");
    if (!mount) return;
    setPeekUnderLightbox(true);
    mount.appendChild(overlay);
    try {
      if (overlay.showPopover) overlay.showPopover();
    } catch (_) {}
    show(index);
    syncFsBtn();
  }

  function padCollectionToolbars() {
    for (const row of $$(
      ".notion-collection_view-block [style*='justify-content: end'], .notion-collection_view_page-block [style*='justify-content: end']",
    )) {
      if (row.dataset.nspPad) continue;
      row.dataset.nspPad = "1";
      row.style.paddingInlineEnd = "12px";
      row.style.gap = "4px";
    }
  }

  function wireCollectionRoot(root, captures) {
    wireCollectionSearch(root);
    wireCollectionFilter(root);
    wireCollectionSort(root);
    const id = root.getAttribute("data-block-id") ||
      root.querySelector("[data-block-id]")?.getAttribute("data-block-id");
    let cap = (captures || []).find((c) => c.blockId === id);
    // Fallback: single capture on the page, or match by nested id
    if (!cap && captures && captures.length === 1) cap = captures[0];
    if (!cap && id && captures) {
      cap = captures.find((c) =>
        root.querySelector('[data-block-id="' + c.blockId + '"]'),
      );
    }
    wireViewTabs(root, cap);
  }

  function wireLightbox() {
    if (document.documentElement.dataset.nspLbWired) return;
    document.documentElement.dataset.nspLbWired = "1";
    document.addEventListener("click", (e) => {
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const t = e.target;
      if (!t || !t.closest) return;
      if (t.closest("div[data-nsp-lightbox]")) return;
      let img = t.closest("img[data-nsp-zoom], .notion-image-block img");
      if (!img) {
        const host = t.closest(".notion-image-block");
        if (host) img = host.querySelector("img");
      }
      if (!img || !isZoomableImage(img)) return;
      e.preventDefault();
      e.stopPropagation();
      if (e.stopImmediatePropagation) e.stopImmediatePropagation();
      openLightbox(img);
    }, true);
  }

  function injectStyles() {
    if (document.getElementById("nsp-runtime-css")) return;
    const style = document.createElement("style");
    style.id = "nsp-runtime-css";
    style.textContent = \`
      .notion-image-block, .notion-image-block > div { max-width: 100% !important; }
      .notion-image-block,
      .notion-image-block * {
        pointer-events: auto !important;
      }
      .notion-cursor-listener .notion-image-block,
      .notion-cursor-listener .notion-image-block *,
      .notion-image-block,
      .notion-image-block [role="figure"],
      .notion-image-block [data-content-editable-void],
      .notion-image-block img,
      .notion-page-content .notion-image-block img,
      [data-nsp-peek-body] .notion-image-block img,
      .nsp-peek-content .notion-image-block img,
      img[data-nsp-zoom="1"] {
        cursor: zoom-in !important;
      }
      .notion-image-block img,
      .notion-page-content .notion-image-block img,
      [data-nsp-peek-body] .notion-image-block img,
      .nsp-peek-content .notion-image-block img,
      img[data-nsp-zoom="1"] {
        max-width: 100% !important;
        pointer-events: auto !important;
      }
      .notion-image-block img,
      [data-nsp-peek-body] .notion-image-block img,
      .nsp-peek-content .notion-image-block img {
        width: 100% !important;
        height: auto !important;
        max-height: none !important;
        object-fit: contain !important;
      }
      /* Lesson-style figures: scraped overflow:hidden + fixed height crops images */
      .notion-image-block [style*="overflow: hidden"],
      .notion-image-block .notion-cursor-default[style*="overflow"],
      .notion-page-content .notion-image-block div[style*="overflow: hidden"] {
        overflow: visible !important;
        height: auto !important;
        max-height: none !important;
      }
      .notion-image-block [style*="height: 100%"] {
        height: auto !important;
      }
      [data-nsp-peek-body] .notion-page-content,
      .nsp-peek-content .notion-page-content,
      [data-nsp-peek-body] .notion-image-block [role="figure"],
      .nsp-peek-content .notion-image-block [role="figure"] {
        max-width: 100% !important;
        overflow-x: hidden;
      }
      .notion-collection-item img,
      .notion-gallery-view img {
        /* keep Notion cover sizing — don't force height:auto */
        max-width: 100%;
        cursor: pointer;
      }

      /* Emoji / page icons — color presentation; don't force text color */
      .notion-record-icon,
      .notion-record-icon span,
      .notion-record-icon [role="img"],
      .notion-emoji,
      [aria-label="Page icon"] {
        font-family: "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji",
          "Android Emoji", "Twemoji Mozilla" !important;
        font-variant-emoji: emoji !important;
        color: var(--c-regEmoCol, inherit) !important;
        -webkit-text-fill-color: unset !important;
        opacity: 1 !important;
        visibility: visible !important;
        line-height: 1 !important;
      }

      .notion-bookmark-block {
        cursor: pointer !important;
        max-width: 100% !important;
        width: 100% !important;
        align-self: stretch !important;
        overflow: hidden !important;
        box-sizing: border-box !important;
      }
      .notion-bookmark-block a {
        max-width: 100% !important;
        width: 100% !important;
        display: flex !important;
        flex-wrap: nowrap !important;
        align-items: stretch !important;
        overflow: hidden !important;
        box-sizing: border-box !important;
      }
      .notion-bookmark-block a > div {
        min-width: 0 !important;
        max-width: 100% !important;
        flex: 1 1 auto !important;
        box-sizing: border-box !important;
        overflow: hidden !important;
      }
      .notion-bookmark-block [style*="-webkit-line-clamp"],
      .notion-bookmark-block [style*="line-clamp"] {
        min-width: 0 !important;
        max-width: 100% !important;
        overflow: hidden !important;
        overflow-wrap: anywhere !important;
        word-break: break-word !important;
      }
      /* Cover images only — do NOT force favicons to 100% width */
      .notion-bookmark-block img[style*="width: 100%"],
      .notion-bookmark-block img[style*="height: 100%"] {
        max-width: 280px !important;
        max-height: 154px !important;
        width: 100% !important;
        height: 100% !important;
        object-fit: cover !important;
      }
      /* Favicon / small icon row (Notion uses ~21px) */
      .notion-bookmark-block img[style*="21.312px"],
      .notion-bookmark-block img[style*="width: 16px"],
      .notion-bookmark-block img[style*="width: 18px"],
      .notion-bookmark-block img[style*="width: 20px"],
      .notion-bookmark-block img[style*="width: 21px"],
      .notion-bookmark-block img[style*="width: 22px"],
      .notion-bookmark-block img[style*="width: 24px"] {
        width: 22px !important;
        height: 22px !important;
        max-width: 22px !important;
        max-height: 22px !important;
        flex-shrink: 0 !important;
        object-fit: cover !important;
      }
      .notion-audio-block, .notion-audio-block audio {
        max-width: 100% !important;
        width: 100% !important;
        pointer-events: auto !important;
        box-sizing: border-box !important;
      }
      .notion-audio-block {
        align-self: stretch !important;
        display: block !important;
      }
      .notion-audio-block audio {
        display: block !important;
        min-height: 40px;
        margin-top: 4px;
      }
      .notion-audio-block [role="figure"] {
        min-height: 40px;
        width: 100% !important;
        pointer-events: auto !important;
      }
      .notion-table-view, .notion-scroller.horizontal {
        overflow-x: auto !important;
        max-width: 100%;
      }
      /* Payment etc.: table wider than viewport — scroll, don't squeeze columns */
      .notion-collection_view-block .notion-scroller.horizontal,
      .notion-collection_view-block .notion-collection-view-body,
      .notion-collection_view_page-block .notion-scroller.horizontal {
        overflow-x: auto !important;
        max-width: 100% !important;
        width: 100% !important;
        -webkit-overflow-scrolling: touch;
      }
      .notion-table-view {
        width: max-content !important;
        min-width: 100% !important;
        max-width: none !important;
        background: var(--c-bacPri, inherit);
        min-height: 40vh;
      }
      .notion-collection-view-body,
      .notion-gallery-view,
      .notion-calendar-view {
        background: var(--c-bacPri, inherit);
        min-height: 40vh;
      }
      /* Selection is Notion's own tab chrome — don't stack a second overlay */
      .notion-collection-view-tab-button,
      .notion-collection-view-tab,
      [role="tab"].notion-collection-view-tab {
        cursor: pointer !important;
        pointer-events: auto !important;
      }
      .notion-collection-item,
      .notion-gallery-view .notion-page-block,
      .notion-collection-item a {
        cursor: pointer !important;
      }
      /* Notion print CSS often hides chrome — keep breadcrumbs visible */
      .notion-topbar {
        display: flex !important;
        visibility: visible !important;
        opacity: 1 !important;
        height: 44px !important;
        z-index: 10;
        position: relative;
      }
      .notion-topbar [aria-label="More actions"],
      .notion-topbar [data-nsp-topbar-right] {
        pointer-events: auto !important;
        cursor: pointer !important;
        z-index: 20;
      }
      header {
        display: block !important;
        visibility: visible !important;
        position: relative;
        z-index: 10;
      }
      [data-nsp-peek-body] .notion-topbar,
      [data-nsp-peek-body] header {
        position: sticky;
        top: 0;
        z-index: 5;
        background: var(--c-bacPri, #191919);
      }
      .notion-toggle-block [role="button"],
      .notion-toggle-block [data-content-editable-leaf],
      .notion-toggle-block { cursor: pointer; }
      .notion-dark-theme .notion-toggle-block [role="button"],
      .notion-dark-theme .notion-toggle-block [role="button"] svg {
        color: #fff !important;
        fill: #fff !important;
      }
      .notion-light-theme .notion-toggle-block [role="button"],
      .notion-light-theme .notion-toggle-block [role="button"] svg {
        color: #37352f !important;
        fill: #37352f !important;
      }
      .notion-toggle-block [data-nsp-toggle-content] {
        margin-top: 2px;
      }
      .notion-floating-table-of-contents { pointer-events: auto !important; }

      /* Column lists: never overflow the frame; stack when narrow / in peek */
      .notion-column_list-block {
        max-width: 100% !important;
        width: 100% !important;
        align-self: stretch !important;
        box-sizing: border-box !important;
      }
      .notion-column_list-block > div {
        flex-wrap: wrap !important;
        max-width: 100% !important;
        width: 100% !important;
        box-sizing: border-box !important;
      }
      .notion-column_list-block > div > div {
        max-width: 100% !important;
        box-sizing: border-box !important;
      }
      .notion-column_list-block > div > div[style*="opacity: 0"][style*="width: 46px"] {
        display: none !important;
        height: 0 !important;
        width: 0 !important;
        padding: 0 !important;
        margin: 0 !important;
        flex: 0 0 0 !important;
      }
      [data-nsp-peek-body] .notion-column_list-block > div,
      .nsp-peek-content .notion-column_list-block > div {
        flex-direction: column !important;
        align-items: stretch !important;
      }
      [data-nsp-peek-body] .notion-column_list-block > div > div,
      .nsp-peek-content .notion-column_list-block > div > div {
        width: 100% !important;
        max-width: 100% !important;
        flex: 1 1 auto !important;
      }

      /* Kill scraped desktop canvas width so mobile/peek use the viewport */
      .layout,
      .layout-wide,
      .layout-content,
      .notion-page-content {
        width: 100% !important;
        max-width: 100% !important;
        box-sizing: border-box !important;
      }
      /* Only clamp image blocks — NOT collection/table views (Payment tables) */
      .notion-image-block[style*="1440px"],
      .notion-page-content > .notion-image-block[style*="max-width: 1440px"],
      .notion-page-content .notion-image-block[style*="width: 1440px"] {
        max-width: 100% !important;
        width: 100% !important;
      }
      .notion-collection_view-block,
      .notion-collection_view_page-block {
        max-width: 100% !important;
      }

      /* Mobile: stack Notion column layouts + use more of the screen */
      @media (max-width: 900px) {
        :root, html {
          --safe-padding-left: 0px !important;
          --safe-padding-right: 0px !important;
        }
        .notion-column_list-block > div {
          flex-direction: column !important;
          align-items: stretch !important;
        }
        .notion-column_list-block > div > div {
          width: 100% !important;
          max-width: 100% !important;
          flex-grow: 1 !important;
          flex-shrink: 1 !important;
        }
        .layout, .layout-wide {
          padding-inline: max(0px, env(safe-area-inset-left, 0px))
            max(0px, env(safe-area-inset-right, 0px)) !important;
        }
        .layout-content {
          padding-inline: 0 !important;
        }
        .notion-page-content {
          padding-inline: 0 !important;
        }
        .notion-image-block {
          width: 100% !important;
          max-width: 100% !important;
          align-self: stretch !important;
        }
      }

      /* Side / center peek */
      [data-nsp-peek-root] {
        position: fixed;
        inset: 0;
        z-index: 30000;
        pointer-events: none;
        visibility: hidden;
      }
      [data-nsp-peek-root][data-nsp-under-lightbox] {
        z-index: 1 !important;
      }
      [data-nsp-lightbox] {
        z-index: 2147483646 !important;
      }
      [data-nsp-peek-root][data-open="1"] {
        visibility: visible;
        pointer-events: auto;
      }
      [data-nsp-peek-backdrop] {
        position: absolute;
        inset: 0;
        background: rgba(0,0,0,.45);
        pointer-events: none;
        opacity: 0;
        transition: opacity .18s ease;
      }
      [data-nsp-peek-root][data-open="1"] [data-nsp-peek-backdrop] {
        opacity: 1;
        pointer-events: auto;
      }
      [data-nsp-peek-panel] {
        position: absolute;
        top: 0;
        right: 0;
        height: 100%;
        width: min(640px, 100%);
        background: var(--c-bacPri, #191919);
        color: var(--c-texPri, #fff);
        box-shadow: -8px 0 32px rgba(0,0,0,.35);
        display: flex;
        flex-direction: column;
        pointer-events: none;
        transform: translateX(104%);
        transition: transform .2s ease, width .2s ease;
      }
      [data-nsp-peek-root][data-open="1"] [data-nsp-peek-panel] {
        transform: translateX(0);
        pointer-events: auto;
      }
      [data-nsp-peek-root][data-mode="center"] [data-nsp-peek-panel] {
        left: 50%;
        right: auto;
        top: 4vh;
        height: 92vh;
        width: min(820px, 94vw);
        transform: translate(-50%, 12px);
        opacity: 0;
        border-radius: 12px;
        box-shadow: 0 16px 48px rgba(0,0,0,.45);
      }
      [data-nsp-peek-root][data-open="1"][data-mode="center"] [data-nsp-peek-panel] {
        transform: translate(-50%, 0);
        opacity: 1;
      }
      [data-nsp-peek-root][data-mode="full"] [data-nsp-peek-backdrop] {
        opacity: 0 !important;
        pointer-events: none !important;
      }
      [data-nsp-peek-root][data-mode="full"] [data-nsp-peek-panel] {
        left: 0;
        right: 0;
        top: 0;
        width: 100%;
        height: 100%;
        max-width: none;
        border-radius: 0;
        box-shadow: none;
        transform: none;
        opacity: 1;
      }
      [data-nsp-peek-root][data-open="1"][data-mode="full"] [data-nsp-peek-panel] {
        transform: none;
        opacity: 1;
      }
      [data-nsp-peek-bar] {
        height: 44px;
        flex-shrink: 0;
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 0 10px 0 12px;
        border-bottom: 1px solid rgba(255,255,255,.08);
        opacity: 0;
        transition: opacity .15s ease;
      }
      [data-nsp-peek-panel]:hover [data-nsp-peek-bar],
      [data-nsp-peek-bar]:focus-within,
      [data-nsp-peek-root][data-peek-bar="1"] [data-nsp-peek-bar] {
        opacity: 1;
      }
      [data-nsp-peek-bar] button, [data-nsp-peek-bar] a {
        appearance: none;
        border: none;
        background: transparent;
        color: inherit;
        cursor: pointer;
        padding: 6px;
        border-radius: 6px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        text-decoration: none;
        opacity: .8;
      }
      [data-nsp-peek-bar] button:hover, [data-nsp-peek-bar] a:hover {
        background: rgba(255,255,255,.08);
        opacity: 1;
      }
      [data-nsp-peek-body] {
        flex: 1;
        overflow: auto;
        padding: 12px 8px 48px;
      }
      [data-nsp-peek-body] .layout,
      [data-nsp-peek-body] .layout-wide {
        padding-inline: max(0px, env(safe-area-inset-left, 0px))
          max(0px, env(safe-area-inset-right, 0px)) !important;
        max-width: 100% !important;
        width: 100% !important;
      }
      [data-nsp-peek-body] .layout-content,
      [data-nsp-peek-body] .notion-page-content {
        padding-inline: 0 !important;
        max-width: 100% !important;
        width: 100% !important;
      }
      [data-nsp-card-actions] {
        position: absolute;
        top: 8px;
        right: 8px;
        display: none;
        gap: 4px;
        z-index: 5;
        background: var(--c-whiButBac, #fff);
        color: var(--c-texSec, #333);
        border-radius: 6px;
        box-shadow: var(--c-shaOutMd, 0 2px 8px rgba(0,0,0,.2));
        padding: 2px;
      }
      .notion-collection-item { position: relative; }
      .notion-collection-item:hover [data-nsp-card-actions],
      .notion-collection-item:focus-within [data-nsp-card-actions] {
        display: flex;
      }
      [data-nsp-card-actions] button {
        appearance: none;
        border: none;
        background: transparent;
        cursor: pointer;
        padding: 4px 6px;
        border-radius: 4px;
        font-size: 12px;
        color: inherit;
      }
      [data-nsp-card-actions] button:hover { background: rgba(0,0,0,.06); }
      [data-nsp-topbar-right] {
        display: flex !important;
        align-items: center;
        margin-inline-start: auto !important;
        flex-shrink: 0;
      }
      [data-nsp-install] { display: none !important; }
    \`;
    document.head.appendChild(style);
  }

  /* ── PWA ───────────────────────────────────────────────── */
  function registerPwa() {
    if (!("serviceWorker" in navigator)) return;
    const swUrl = new URL("sw.js", location.href);
    // All pages live flat in the site root
    const rootSw = new URL("./sw.js", location.href.replace(/[^/]*$/, ""));
    navigator.serviceWorker.register(rootSw.href).catch(() => {
      navigator.serviceWorker.register(swUrl.href).catch(() => {});
    });

    // Ask SW to refresh precache list after load
    navigator.serviceWorker.ready.then(async (reg) => {
      try {
        const res = await fetch("./assets/nsp-precache.json", { cache: "no-cache" });
        const urls = await res.json();
        reg.active && reg.active.postMessage({ type: "NSP_CACHE_URLS", urls });
      } catch (_) {}
    });
  }

  /* ── Side peek ─────────────────────────────────────────── */
  let peekMode = localStorage.getItem("nsp-peek-mode") || "full";
  let peekRoot = null;
  let peekCurrentHref = "";
  let peekFull = false;
  let peekHistoryDepth = 0;
  let peekIgnorePops = 0;
  let peekRestoring = false;
  let peekLoadGen = 0;

  function ensurePeekRoot() {
    if (peekRoot && peekRoot.isConnected) return peekRoot;
    peekRoot = document.createElement("div");
    peekRoot.setAttribute("data-nsp-peek-root", "1");
    peekRoot.setAttribute("data-open", "0");
    peekRoot.setAttribute("data-mode", peekMode);
    // Inherit dark/light CSS variables from Notion theme host
    const theme =
      document.querySelector(".notion-dark-theme") ? "notion-dark-theme" :
      document.querySelector(".notion-light-theme") ? "notion-light-theme" : "";
    if (theme) peekRoot.classList.add(theme);
    peekRoot.innerHTML =
      '<div data-nsp-peek-backdrop></div>' +
      '<div data-nsp-peek-panel role="dialog" aria-modal="true">' +
      '  <div data-nsp-peek-bar>' +
      '    <div data-nsp-peek-left style="display:flex;gap:2px;align-items:center"></div>' +
      '    <div data-nsp-peek-right style="display:flex;gap:2px;align-items:center"></div>' +
      "  </div>" +
      '  <div data-nsp-peek-body></div>' +
      "</div>";
    themeHost().appendChild(peekRoot);
    peekRoot.querySelector("[data-nsp-peek-backdrop]").addEventListener("click", closePeek);
    return peekRoot;
  }

  function iconBtn(label, svg, onClick) {
    const b = document.createElement("button");
    b.type = "button";
    b.setAttribute("aria-label", label);
    b.title = label;
    b.innerHTML = svg;
    b.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      onClick();
    });
    return b;
  }

  const SVG = {
    close: CLOSE_SVG,
    expand: '<svg width="16" height="16" viewBox="0 0 20 20" fill="currentColor"><path d="M4.5 3.375A1.125 1.125 0 0 0 3.375 4.5V8a.625.625 0 1 0 1.25 0V5.508l4.067 4.067a.625.625 0 0 0 .884-.884L5.508 4.625H8a.625.625 0 1 0 0-1.25zM15.5 16.625a1.125 1.125 0 0 0 1.125-1.125V12a.625.625 0 1 0-1.25 0v2.492l-4.067-4.067a.625.625 0 1 0-.884.884l4.067 4.066H12a.625.625 0 1 0 0 1.25z"/></svg>',
    compress: '<svg width="16" height="16" viewBox="0 0 20 20" fill="currentColor"><path d="M8.125 3.375a.625.625 0 0 1 .625.625V8c0 .69-.56 1.25-1.25 1.25H3.999a.625.625 0 1 1 0-1.25h2.492L2.424 4.183a.625.625 0 1 1 .884-.884L7.375 7.242V5a.625.625 0 0 1 .75-.625zM11.875 16.625a.625.625 0 0 1-.625-.625V12c0-.69.56-1.25 1.25-1.25h3.501a.625.625 0 1 1 0 1.25h-2.492l4.067 4.067a.625.625 0 1 1-.884.884L12.625 12.758V15a.625.625 0 0 1-.75.625z"/></svg>',
    newtab: '<svg width="16" height="16" viewBox="0 0 20 20" fill="currentColor"><path d="M6.25 3.375A2.125 2.125 0 0 0 4.125 5.5v8.75c0 1.174.951 2.125 2.125 2.125h8.75a2.125 2.125 0 0 0 2.125-2.125v-3.125a.625.625 0 1 0-1.25 0V14.25a.875.875 0 0 1-.875.875H6.25a.875.875 0 0 1-.875-.875V5.5c0-.483.392-.875.875-.875h3.125a.625.625 0 1 0 0-1.25z"/><path d="M12.625 3.375a.625.625 0 0 0 0 1.25h2.117l-5.246 5.246a.625.625 0 1 0 .884.884l5.245-5.246v2.116a.625.625 0 1 0 1.25 0V4.5A1.125 1.125 0 0 0 15.75 3.375z"/></svg>',
    side: '<svg width="16" height="16" viewBox="0 0 20 20" fill="currentColor"><path d="M3.375 5.5c0-1.174.951-2.125 2.125-2.125h9c1.174 0 2.125.951 2.125 2.125v9c0 1.174-.951 2.125-2.125 2.125h-9A2.125 2.125 0 0 1 3.375 14.5zm10.875-.875h-2.5v10.75h2.5a.875.875 0 0 0 .875-.875v-9a.875.875 0 0 0-.875-.875z"/></svg>',
    center: '<svg width="16" height="16" viewBox="0 0 20 20" fill="currentColor"><path d="M4.5 3.375A2.125 2.125 0 0 0 2.375 5.5v9c0 1.174.951 2.125 2.125 2.125h11A2.125 2.125 0 0 0 17.625 14.5v-9A2.125 2.125 0 0 0 15.5 3.375zm0 1.25h11c.483 0 .875.392.875.875v9a.875.875 0 0 1-.875.875h-11a.875.875 0 0 1-.875-.875v-9c0-.483.392-.875.875-.875z"/></svg>',
  };

  function displayPeekMode() {
    return peekFull ? "full" : peekMode;
  }

  function clearPeekUi() {
    if (!peekRoot) return;
    peekRoot.setAttribute("data-open", "0");
    peekRoot.setAttribute("data-mode", peekMode);
    const body = peekRoot.querySelector("[data-nsp-peek-body]");
    if (body) body.innerHTML = "";
    peekCurrentHref = "";
    peekFull = false;
    document.body.style.overflow = "";
  }

  function pushPeekHistory(href, mode) {
    try {
      history.pushState({ nspPeek: true, href, mode }, "", href);
      peekHistoryDepth += 1;
      return true;
    } catch (_) {
      return false;
    }
  }

  function closePeek() {
    if (!peekRoot) return;
    const depth = peekHistoryDepth;
    peekHistoryDepth = 0;
    clearPeekUi();
    if (depth > 0) {
      peekIgnorePops = depth;
      try {
        history.go(-depth);
      } catch (_) {
        peekIgnorePops = 0;
      }
    }
  }

  function exitFullPeek() {
    if (!peekFull) return;
    if (peekHistoryDepth > 0) {
      // Pop the fullscreen entry; popstate restores side/center or closes
      history.back();
      return;
    }
    peekFull = false;
    if (peekMode === "full") closePeek();
    else if (peekCurrentHref) openPeek(peekCurrentHref, peekMode);
    else closePeek();
  }

  function enterFullPeek(href) {
    openPeek(href, "full");
  }

  async function openPeek(href, mode) {
    const requested = mode || peekMode || "full";
    const wasOpen = !!(peekRoot && peekRoot.getAttribute("data-open") === "1");
    const wasFull = peekFull;
    const prevHref = peekCurrentHref;

    // Resolve against the current URL BEFORE any history change
    let fetchUrl = href;
    try {
      fetchUrl = new URL(href, location.href).href;
    } catch (_) {}

    if (requested === "full") {
      peekFull = true;
    } else if (requested === "side" || requested === "center") {
      peekMode = requested;
      localStorage.setItem("nsp-peek-mode", peekMode);
      peekFull = false;
    }

    const shouldPush =
      !peekRestoring &&
      ((!wasOpen || prevHref !== href) ||
        (requested === "full" && wasOpen && !wasFull));

    const root = ensurePeekRoot();
    root.setAttribute("data-mode", displayPeekMode());
    peekCurrentHref = href;
    document.body.style.overflow = "hidden";

    const left = root.querySelector("[data-nsp-peek-left]");
    const right = root.querySelector("[data-nsp-peek-right]");
    const body = root.querySelector("[data-nsp-peek-body]");
    left.innerHTML = "";
    right.innerHTML = "";

    if (peekFull) {
      left.appendChild(iconBtn("Exit full page", SVG.compress, exitFullPeek));
    } else {
      left.appendChild(iconBtn("Open in full page", SVG.expand, () => {
        enterFullPeek(href);
      }));
    }
    left.appendChild(iconBtn("Open in new tab", SVG.newtab, () => {
      window.open(fetchUrl, "_blank", "noopener,noreferrer");
    }));
    if (!peekFull) {
      left.appendChild(iconBtn(
        peekMode === "side" ? "Center peek" : "Side peek",
        peekMode === "side" ? SVG.center : SVG.side,
        () => openPeek(href, peekMode === "side" ? "center" : "side"),
      ));
    }
    right.appendChild(iconBtn("Close", SVG.close, closePeek));

    const gen = ++peekLoadGen;
    body.innerHTML = '<div style="padding:24px;opacity:.6">Loading…</div>';
    root.setAttribute("data-open", "1");
    root.setAttribute("data-peek-bar", "1");
    setTimeout(() => {
      if (gen === peekLoadGen) root.setAttribute("data-peek-bar", "0");
    }, 1800);

    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 12_000);
      let res;
      try {
        res = await fetch(fetchUrl, {
          credentials: "same-origin",
          cache: "no-store",
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timer);
      }
      if (gen !== peekLoadGen) return;
      if (!res.ok) throw new Error("HTTP " + res.status);
      const html = await res.text();
      if (gen !== peekLoadGen) return;
      const doc = new DOMParser().parseFromString(html, "text/html");
      let captures = [];
      try {
        const raw = doc.getElementById("nsp-collection-views");
        if (raw) captures = JSON.parse(raw.textContent || "[]");
      } catch (_) {}

      const header =
        doc.querySelector("header") ||
        doc.querySelector(".notion-topbar")?.closest("header") ||
        doc.querySelector(".notion-topbar");
      const main =
        doc.querySelector("main#main") ||
        doc.querySelector(".notion-page-content") ||
        doc.body;

      if (gen !== peekLoadGen) return;
      body.innerHTML = "";
      const wrap = document.createElement("div");
      wrap.className = "nsp-peek-content";
      if (header) {
        wrap.appendChild(header.cloneNode(true));
      }
      if (main && main !== header) {
        const mWrap = document.createElement("div");
        mWrap.setAttribute("data-nsp-peek-main", "1");
        mWrap.innerHTML = main.innerHTML;
        wrap.appendChild(mWrap);
      } else if (!header && main) {
        wrap.innerHTML = main.innerHTML;
      }
      body.appendChild(wrap);
      normalizeFrozenWidths(body);
      // Push history only after content is ready (avoids stuck Loading + bad relative fetch)
      if (shouldPush) {
        pushPeekHistory(href, requested === "full" ? "full" : peekMode);
      }
      // Re-wire interactive bits inside peek
      wireToggles(body);
      enhanceMedia(body);
      loadAssetMap().then(() => {
        if (gen === peekLoadGen) enhanceMedia(body);
      });
      wireCardActions(body);
      wireCollectionsIn(body, captures);
      padCollectionToolbars();
      layoutTopbar();
      wireOriginalMenu(body);
      // Internal links inside peek open in peek (keep fullscreen if active)
      body.onclick = (e) => {
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
        const a = e.target.closest("a[href]");
        if (!a || a.closest("[data-nsp-card-actions]")) return;
        // Let collection view tabs handle their own clicks
        if (a.closest(".notion-collection-view-tab-button")) return;
        const h = a.getAttribute("href") || "";
        if (!isLocalHtmlHref(h)) return;
        e.preventDefault();
        e.stopPropagation();
        const next = h.split("#")[0];
        openPeek(next, peekFull ? "full" : peekMode);
      };
    } catch (err) {
      if (gen !== peekLoadGen) return;
      // Hard-navigate so users aren't stuck on Loading…
      try {
        location.href = href;
        return;
      } catch (_) {}
      body.innerHTML =
        '<div style="padding:24px">Could not load page. <a href="' +
        href +
        '">Open full page</a></div>';
    }
  }

  if (!window.__nspPeekPopstate) {
    window.__nspPeekPopstate = true;
    window.addEventListener("popstate", (ev) => {
      if (peekIgnorePops > 0) {
        peekIgnorePops -= 1;
        return;
      }
      const st = ev && ev.state;
      if (st && st.nspPeek && st.href) {
        peekHistoryDepth = Math.max(0, peekHistoryDepth - 1);
        peekRestoring = true;
        const mode = st.mode || (st.nspPeekFull ? "full" : peekMode);
        if (mode === "full") peekFull = true;
        else peekFull = false;
        Promise.resolve(openPeek(st.href, mode === "full" ? "full" : mode))
          .catch(() => {})
          .finally(() => {
            peekRestoring = false;
          });
        return;
      }
      // Left the peek stack — close UI only (URL already restored)
      peekHistoryDepth = 0;
      clearPeekUi();
    });
  }

  function isLocalHtmlHref(href) {
    if (!href || href.startsWith("#") || href.startsWith("mailto:")) return false;
    if (href.startsWith("http")) {
      try {
        const u = new URL(href);
        return u.origin === location.origin && /\\.html($|\\?)/.test(u.pathname);
      } catch {
        return false;
      }
    }
    return /\\.html($|\\?|#)/.test(href);
  }

  function wirePeekNavigation() {
    if (document.documentElement.dataset.nspPeekNav) return;
    document.documentElement.dataset.nspPeekNav = "1";
    document.addEventListener("click", (e) => {
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = e.target.closest("a[href]");
      if (!a) return;
      if (a.closest("[data-nsp-peek-bar], [data-nsp-menu], [data-nsp-card-actions]")) return;
      const href = a.getAttribute("href") || "";
      if (!isLocalHtmlHref(href)) return;
      // Open every internal page with the user's default view (fullscreen by default)
      e.preventDefault();
      e.stopPropagation();
      openPeek(href.split("#")[0] || href);
    }, true);
  }

  function wireCardActions(scope) {
    const root = scope || document;
    for (const item of $$(".notion-collection-item", root)) {
      if (item.dataset.nspCard) continue;
      item.dataset.nspCard = "1";
      const a = item.querySelector("a[href]");
      if (!a) continue;
      const href = a.getAttribute("href") || "";
      if (!isLocalHtmlHref(href)) continue;
      const actions = document.createElement("div");
      actions.setAttribute("data-nsp-card-actions", "1");
      const mk = (label, fn) => {
        const b = document.createElement("button");
        b.type = "button";
        b.textContent = label;
        b.addEventListener("click", (ev) => {
          ev.preventDefault();
          ev.stopPropagation();
          fn();
        });
        return b;
      };
      actions.appendChild(mk("Peek", () => openPeek(href.split("#")[0])));
      actions.appendChild(mk("New tab", () => window.open(href, "_blank", "noopener,noreferrer")));
      actions.appendChild(mk("Open", () => { location.href = href; }));
      const host = item.querySelector("[role='presentation']") || item;
      if (getComputedStyle(host).position === "static") host.style.position = "relative";
      host.appendChild(actions);
    }
  }

  function boot() {
    injectStyles();
    try {
      applyTheme(currentTheme());
    } catch (_) {}
    registerPwa();
    loadAssetMap();
    syncViewport();
    hidePromos();
    wireOriginalMenu();
    layoutTopbar();
    wireOriginalMenu();
    wireToggles(document);
    wireToc();
    wireLightbox();
    enhanceMedia(document);
    // Re-run media repair after cache map loads
    loadAssetMap().then(() => enhanceMedia(document));
    padCollectionToolbars();
    wirePeekNavigation();
    wireCardActions(document);
    window.addEventListener("resize", syncViewport);
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        if (document.querySelector("div[data-nsp-lightbox]")) return;
        closePeek();
      }
    });

    let captures = [];
    try {
      const raw = document.getElementById("nsp-collection-views");
      if (raw) captures = JSON.parse(raw.textContent || "[]");
    } catch (_) {}

    wireCollectionsIn(document, captures);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
`;

export function injectRuntime(
  html: string,
  collectionViews: unknown[],
  runtimeSrc: string,
  originalUrl?: string,
): string {
  const json = JSON.stringify(collectionViews).replace(/</g, "\\u003c");
  const safeUrl = (originalUrl || "").replace(/"/g, "&quot;");
  let out = html;
  if (safeUrl) {
    if (/<html\b[^>]*>/i.test(out)) {
      out = out.replace(/<html\b([^>]*)>/i, (full, attrs: string) => {
        if (/data-nsp-original-url=/i.test(attrs)) return full;
        return `<html${attrs} data-nsp-original-url="${safeUrl}">`;
      });
    } else {
      out = `<html data-nsp-original-url="${safeUrl}">` + out;
    }
  }

  const headTags = `
<link rel="manifest" href="./manifest.webmanifest" />
<meta name="theme-color" content="#191919" />
<meta name="mobile-web-app-capable" content="yes" />
<meta name="apple-mobile-web-app-capable" content="yes" />
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
<link rel="apple-touch-icon" href="./assets/nsp-icon.svg" />
`;
  if (/<\/head>/i.test(out)) {
    out = out.replace(/<\/head>/i, `${headTags}</head>`);
  } else {
    out = headTags + out;
  }

  const payload = `
<script type="application/json" id="nsp-collection-views">${json}</script>
<script src="${runtimeSrc}" defer></script>
<style id="nsp-responsive">
  html, body { width: 100% !important; max-width: 100% !important; overflow-x: hidden; }
  .notion-frame, main.notion-frame, .notion-cursor-listener { width: 100% !important; max-width: 100% !important; }
  .notion-topbar [aria-label="Share site to socials"],
  .notion-topbar .duplicate { display: none !important; }
  .notion-image-block, .notion-image-block > div { max-width: 100% !important; }
  .notion-image-block img {
    max-width: 100% !important;
    width: 100% !important;
    height: auto !important;
    max-height: none !important;
    object-fit: contain !important;
    cursor: zoom-in !important;
    pointer-events: auto !important;
  }
  .notion-image-block [style*="overflow: hidden"] {
    overflow: visible !important;
    height: auto !important;
  }
  .notion-record-icon,
  .notion-record-icon span,
  .notion-record-icon [role="img"],
  .notion-emoji,
  [aria-label="Page icon"] {
    font-family: "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", "Android Emoji", "Twemoji Mozilla" !important;
    font-variant-emoji: emoji !important;
    color: var(--c-regEmoCol, inherit) !important;
    -webkit-text-fill-color: unset !important;
    opacity: 1 !important;
    visibility: visible !important;
  }
  .notion-bookmark-block {
    max-width: 100% !important;
    width: 100% !important;
    overflow: hidden !important;
  }
  .notion-bookmark-block a {
    max-width: 100% !important;
    width: 100% !important;
    overflow: hidden !important;
  }
  .notion-bookmark-block a > div,
  .notion-bookmark-block [style*="-webkit-line-clamp"] {
    min-width: 0 !important;
    max-width: 100% !important;
    overflow-wrap: anywhere !important;
    word-break: break-word !important;
  }
  .notion-image-block, .notion-image-block [role="figure"] {
    cursor: zoom-in !important;
    pointer-events: auto !important;
  }
  .notion-audio-block, .notion-audio-block audio { max-width: 100% !important; width: 100% !important; box-sizing: border-box; }
  .notion-bookmark-block img[style*="21.312px"],
  .notion-bookmark-block img[style*="width: 21px"],
  .notion-bookmark-block img[style*="width: 22px"] {
    width: 22px !important; height: 22px !important; max-width: 22px !important; max-height: 22px !important;
  }
  .notion-bookmark-block img[style*="width: 100%"],
  .notion-bookmark-block img[style*="height: 100%"] {
    max-width: 280px !important; max-height: 154px !important;
  }
  .notion-dark-theme .notion-toggle-block [role="button"],
  .notion-dark-theme .notion-toggle-block [role="button"] svg {
    color: #fff !important; fill: #fff !important;
  }
  .layout, .layout-wide, .layout-content, .notion-page-content, .notion-column_list-block {
    width: 100% !important; max-width: 100% !important; box-sizing: border-box !important;
  }
  .notion-column_list-block > div { flex-wrap: wrap !important; max-width: 100% !important; width: 100% !important; }
  .notion-column_list-block > div > div[style*="opacity: 0"][style*="width: 46px"] {
    display: none !important; width: 0 !important; height: 0 !important; padding: 0 !important; margin: 0 !important;
  }
  [data-nsp-peek-body] .notion-column_list-block > div,
  .nsp-peek-content .notion-column_list-block > div {
    flex-direction: column !important; align-items: stretch !important;
  }
  [data-nsp-peek-body] .notion-column_list-block > div > div,
  .nsp-peek-content .notion-column_list-block > div > div {
    width: 100% !important; max-width: 100% !important; flex: 1 1 auto !important;
  }
  .notion-table-view, .notion-scroller.horizontal {
    overflow-x: auto !important;
    max-width: 100%;
  }
  .notion-collection_view-block .notion-scroller.horizontal,
  .notion-collection_view-block .notion-collection-view-body,
  .notion-collection_view_page-block .notion-scroller.horizontal {
    overflow-x: auto !important;
    max-width: 100% !important;
    width: 100% !important;
    -webkit-overflow-scrolling: touch;
  }
  .notion-table-view {
    width: max-content !important;
    min-width: 100% !important;
    max-width: none !important;
  }
  .notion-collection_view-block,
  .notion-collection_view_page-block {
    max-width: 100% !important;
  }
  .notion-image-block[style*="1440px"] {
    max-width: 100% !important;
    width: 100% !important;
  }
  .notion-collection-view-body,
  .notion-gallery-view,
  .notion-calendar-view,
  .notion-table-view {
    background: var(--c-bacPri, inherit);
    min-height: 40vh;
  }
  .notion-collection-view-tab-button,
  .notion-collection-view-tab {
    cursor: pointer !important;
  }
  .notion-collection-item,
  .notion-collection-item a {
    cursor: pointer !important;
  }
  .notion-image-block,
  .notion-image-block img,
  img[data-nsp-zoom="1"] {
    cursor: zoom-in !important;
  }
  .notion-toggle-block [role="button"],
  .notion-toggle-block { cursor: pointer; }
  @media (max-width: 900px) {
    :root, html {
      --safe-padding-left: 0px !important;
      --safe-padding-right: 0px !important;
    }
    .notion-column_list-block > div {
      flex-direction: column !important;
      align-items: stretch !important;
    }
    .notion-column_list-block > div > div {
      width: 100% !important;
      max-width: 100% !important;
      flex-grow: 1 !important;
      flex-shrink: 1 !important;
    }
    .layout, .layout-wide {
      padding-inline: max(0px, env(safe-area-inset-left, 0px))
        max(0px, env(safe-area-inset-right, 0px)) !important;
    }
    .layout-content, .notion-page-content {
      padding-inline: 0 !important;
    }
    .notion-image-block {
      width: 100% !important;
      max-width: 100% !important;
    }
  }
</style>
  `;
  if (out.includes("</body>")) {
    return out.replace("</body>", `${payload}</body>`);
  }
  return out + payload;
}
