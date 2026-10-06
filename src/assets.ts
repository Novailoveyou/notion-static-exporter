import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import type { HTTPResponse, Page } from "puppeteer";
import {
  extractPageId,
  extFromContentType,
  isNotionSiteHost,
  normalizeBlockId,
  sniffExt,
} from "./urls.ts";

export type AssetStore = {
  map: Map<string, string>;
  /** relative asset path → source URL(s) */
  reverse: Map<string, string>;
  dir: string;
  outRoot: string;
};

export function createAssetStore(outRoot: string): AssetStore {
  const dir = join(outRoot, "assets");
  mkdirSync(dir, { recursive: true });
  return { map: new Map(), reverse: new Map(), dir, outRoot };
}

function hashUrl(url: string): string {
  return createHash("sha1").update(url).digest("hex").slice(0, 16);
}

function toPosix(p: string): string {
  return p.split(sep).join("/");
}

export function normalizeAssetKey(url: string): string {
  try {
    const u = new URL(url);
    u.hash = "";
    return u.href;
  } catch {
    return url;
  }
}

/** Notion page URLs must never be saved as static assets. */
export function isNotionPageAssetUrl(url: string): boolean {
  try {
    const u = new URL(url.replace(/&amp;/g, "&"));
    if (!isNotionSiteHost(u.hostname)) return false;
    if (/\/image\//i.test(u.pathname)) return false;
    if (/\/(image|file|secure\.notion)/i.test(u.pathname)) return false;
    return Boolean(extractPageId(u.href));
  } catch {
    return false;
  }
}

function looksLikeHtml(body: Buffer, contentType: string | null): boolean {
  const ct = (contentType || "").toLowerCase();
  if (ct.includes("text/html") || ct.includes("application/xhtml")) return true;
  const head = body.subarray(0, 64).toString("utf8").trimStart().toLowerCase();
  return (
    head.startsWith("<!doctype html") ||
    head.startsWith("<html") ||
    head.startsWith("<head") ||
    head.includes("just a moment")
  );
}

export function saveAsset(
  store: AssetStore,
  url: string,
  body: Buffer,
  contentType: string | null,
): string | null {
  const key = normalizeAssetKey(url.replace(/&amp;/g, "&"));
  const existing = store.map.get(key);
  if (existing) return existing;

  if (isNotionPageAssetUrl(key)) return null;
  if (looksLikeHtml(body, contentType)) return null;
  if (body.length < 8) return null;

  const sniffed = sniffExt(body);
  const fromMeta = extFromContentType(contentType, url);
  // Prefer magic-byte sniff over path (Notion CDN paths often lie)
  const ext = sniffed || fromMeta || ".bin";
  if (ext === ".bin" && !contentType) return null;

  const name = `${hashUrl(key)}${ext}`;
  const abs = join(store.dir, name);
  writeFileSync(abs, body);
  const rel = toPosix(join("assets", name));
  store.map.set(key, rel);
  store.map.set(url, rel);
  store.reverse.set(rel, key);
  return rel;
}

/** Audio/PDF/video — never ship bytes through page.evaluate (CDP JSON hangs for minutes). */
function looksHeavyMediaUrl(url: string): boolean {
  return (
    /\.(mp3|m4a|wav|ogg|aac|flac|mp4|webm|mov|m4v|pdf)(\?|$)/i.test(url) ||
    /file\.notion\.so/i.test(url) ||
    /\/file\//i.test(url)
  );
}

async function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function downloadUrl(
  store: AssetStore,
  url: string,
  page: Page,
): Promise<string | null> {
  const clean = url.replace(/&amp;/g, "&");
  const key = normalizeAssetKey(clean);
  if (store.map.has(key)) return store.map.get(key)!;
  if (clean.startsWith("data:") || clean.startsWith("blob:")) return null;
  if (isNotionPageAssetUrl(clean)) return null;
  if (/\.js(\?|$)/i.test(clean) && !/\/image\//i.test(clean)) return null;

  // Prefer Node fetch for heavy media — in-page Array/base64 transfer can stall for 30–60+ min
  if (looksHeavyMediaUrl(clean)) {
    const fromNode = await fetchWithCookies(page, clean);
    if (fromNode) {
      const saved = saveAsset(store, clean, fromNode.body, fromNode.ct);
      if (saved) return saved;
    }
    // Last resort: in-page only if Notion blocks Node (small files / auth)
    const fromPage = await fetchInPage(page, clean, { maxBytes: 2_000_000 });
    if (fromPage) {
      const saved = saveAsset(store, clean, fromPage.body, fromPage.ct);
      if (saved) return saved;
    }
    return null;
  }

  const fromPage = await fetchInPage(page, clean);
  if (fromPage) {
    const saved = saveAsset(store, clean, fromPage.body, fromPage.ct);
    if (saved) return saved;
  }

  const fromNode = await fetchWithCookies(page, clean);
  if (fromNode) {
    return saveAsset(store, clean, fromNode.body, fromNode.ct);
  }
  return null;
}

async function fetchInPage(
  page: Page,
  url: string,
  opts?: { maxBytes?: number },
): Promise<{ body: Buffer; ct: string | null } | null> {
  const maxBytes = opts?.maxBytes ?? 4_000_000;
  try {
    const res = await withTimeout(
      page.evaluate(
        async (u, max) => {
          const ac = new AbortController();
          const kill = setTimeout(() => ac.abort(), 25_000);
          try {
            const r = await fetch(u, {
              credentials: "include",
              signal: ac.signal,
            });
            if (!r.ok) return null;
            const ct = r.headers.get("content-type");
            const len = Number(r.headers.get("content-length") || 0);
            if (len > max) return { tooLarge: true as const, ct, len };
            const buf = new Uint8Array(await r.arrayBuffer());
            if (buf.byteLength > max) {
              return { tooLarge: true as const, ct, len: buf.byteLength };
            }
            // base64 — far cheaper over CDP than Array.from(number[])
            let binary = "";
            const chunk = 0x8000;
            for (let i = 0; i < buf.length; i += chunk) {
              binary += String.fromCharCode(
                ...buf.subarray(i, Math.min(i + chunk, buf.length)),
              );
            }
            return { ct, b64: btoa(binary) };
          } finally {
            clearTimeout(kill);
          }
        },
        url,
        maxBytes,
      ),
      30_000,
    );
    if (!res || "tooLarge" in res) return null;
    if (!("b64" in res) || !res.b64) return null;
    return { body: Buffer.from(res.b64, "base64"), ct: res.ct };
  } catch {
    return null;
  }
}

async function fetchWithCookies(
  page: Page,
  url: string,
): Promise<{ body: Buffer; ct: string | null } | null> {
  try {
    const cookies = await page.cookies(url);
    const cookie = cookies.map((c) => `${c.name}=${c.value}`).join("; ");
    const referer = page.url();
    const ac = new AbortController();
    const kill = setTimeout(() => ac.abort(), 45_000);
    try {
      const res = await fetch(url, {
        headers: {
          Cookie: cookie,
          Referer: referer,
          "User-Agent":
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
          Accept:
            "audio/*,video/*,image/avif,image/webp,image/apng,image/*,application/pdf,*/*;q=0.8",
        },
        redirect: "follow",
        signal: ac.signal,
      });
      if (!res.ok) return null;
      const ct = res.headers.get("content-type");
      const body = Buffer.from(await res.arrayBuffer());
      return { body, ct };
    } finally {
      clearTimeout(kill);
    }
  } catch {
    return null;
  }
}

export function attachResponseCollector(page: Page): {
  urls: Set<string>;
  responses: Map<string, HTTPResponse>;
  detach: () => void;
} {
  const urls = new Set<string>();
  const responses = new Map<string, HTTPResponse>();
  const onResponse = (res: HTTPResponse) => {
    const type = res.request().resourceType();
    const url = res.url();
    if (!url.startsWith("http") || !res.ok()) return;
    if (isNotionPageAssetUrl(url)) return;

    const ct = (res.headers()["content-type"] ?? "").toLowerCase();
    if (ct.includes("text/html")) return;

    const looksMediaUrl =
      /\/(image|file)\//i.test(url) ||
      /file\.notion\.so/i.test(url) ||
      /\.(mp3|m4a|wav|ogg|aac|png|jpe?g|webp|gif|svg|pdf|woff2?|ttf|otf|css)(\?|$)/i.test(
        url,
      );
    const looksMediaCt =
      ct.includes("image/") ||
      ct.includes("audio/") ||
      ct.includes("video/") ||
      ct.includes("font/") ||
      ct.includes("css") ||
      ct.includes("octet-stream");

    const allowedType = [
      "stylesheet",
      "image",
      "font",
      "media",
      "other",
      "xhr",
      "fetch",
    ].includes(type);

    if (!allowedType && !looksMediaUrl && !looksMediaCt) return;
    if (
      (type === "xhr" || type === "fetch") &&
      !looksMediaUrl &&
      !looksMediaCt
    ) {
      return;
    }

    urls.add(url);
    responses.set(normalizeAssetKey(url), res);
  };
  page.on("response", onResponse);
  return {
    urls,
    responses,
    detach: () => page.off("response", onResponse),
  };
}

/** Persist bodies Chrome already fetched (best source for images/fonts). */
export async function saveCollectedResponses(
  store: AssetStore,
  responses: Map<string, HTTPResponse>,
): Promise<void> {
  for (const [key, res] of responses) {
    if (store.map.has(key)) continue;
    try {
      const body = await withTimeout(res.buffer(), 20_000);
      if (!body) continue;
      const ct = res.headers()["content-type"] ?? null;
      saveAsset(store, res.url(), body, ct);
    } catch {
      /* body discarded — downloadUrl will retry */
    }
  }
}

export async function downloadAssetUrls(
  store: AssetStore,
  page: Page,
  urls: Iterable<string>,
  concurrency = 6,
  onProgress?: (done: number, total: number) => void,
): Promise<void> {
  const pending: string[] = [];
  const seen = new Set<string>();
  for (const url of urls) {
    const clean = url.replace(/&amp;/g, "&");
    const key = normalizeAssetKey(clean);
    if (seen.has(key)) continue;
    seen.add(key);
    if (store.map.has(key)) continue;
    if (isNotionPageAssetUrl(clean)) continue;
    if (/\.js(\?|$)/i.test(clean) && !/\/image\//i.test(clean)) continue;
    pending.push(clean);
  }
  if (!pending.length) return;

  const limit = Math.max(1, concurrency);
  let i = 0;
  let done = 0;
  const total = pending.length;
  onProgress?.(0, total);
  const workers = Array.from({ length: Math.min(limit, pending.length) }, async () => {
    while (i < pending.length) {
      const idx = i++;
      const url = pending[idx]!;
      await downloadUrl(store, url, page);
      done += 1;
      if (done === total || done % 5 === 0) onProgress?.(done, total);
    }
  });
  await Promise.all(workers);
  onProgress?.(total, total);
}

export async function collectDomAssetUrls(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const out = new Set<string>();
    const add = (u: string | null | undefined) => {
      if (!u) return;
      try {
        const abs = new URL(u, location.href).href;
        if (abs.startsWith("http")) out.add(abs);
      } catch {
        /* ignore */
      }
    };

    for (const el of document.querySelectorAll(
      "img[src], img[data-src], img[data-lazy-src], img[data-original], source[src], video[src], audio[src], link[href], use[href]",
    )) {
      add(el.getAttribute("src"));
      add(el.getAttribute("data-src"));
      add(el.getAttribute("data-lazy-src"));
      add(el.getAttribute("data-original"));
      if (el.tagName === "LINK" || el.tagName === "USE" || el.hasAttribute("href")) {
        add(el.getAttribute("href"));
      }
    }
    // Notion audio sometimes stores URL on nested source only after expand
    for (const el of document.querySelectorAll(".notion-audio-block [src], audio source")) {
      add(el.getAttribute("src"));
    }
    for (const el of document.querySelectorAll("[srcset]")) {
      for (const part of (el.getAttribute("srcset") ?? "").split(",")) {
        add(part.trim().split(/\s+/)[0]);
      }
    }
    for (const el of document.querySelectorAll("[style*='url(']")) {
      const style = el.getAttribute("style") ?? "";
      for (const m of style.matchAll(/url\((['"]?)([^)'"]+)\1\)/g)) {
        add(m[2]);
      }
    }
    for (const sheet of Array.from(document.styleSheets)) {
      try {
        for (const rule of Array.from(sheet.cssRules || [])) {
          for (const m of rule.cssText.matchAll(/url\((['"]?)([^)'"]+)\1\)/g)) {
            add(m[2]);
          }
        }
      } catch {
        /* ignore */
      }
    }
    return [...out];
  });
}

function basename(p: string): string {
  return p.split("/").pop() || p;
}

export function rewriteHtml(
  html: string,
  pageLocalPath: string,
  pageUrl: string,
  store: AssetStore,
  pageUrlMap: Map<string, string>,
): string {
  const pageDir = dirname(pageLocalPath) === "." ? "" : dirname(pageLocalPath);

  const idToLocal = new Map<string, string>();
  for (const [remote, local] of pageUrlMap) {
    const id = extractPageId(remote);
    if (id && !idToLocal.has(id)) idToLocal.set(id, local);
  }

  const relTo = (targetFromRoot: string): string => {
    let rel = relative(pageDir, targetFromRoot);
    if (!rel) rel = basename(targetFromRoot);
    rel = toPosix(rel);
    if (!rel.startsWith(".") && !rel.startsWith("/")) rel = `./${rel}`;
    return rel;
  };

  const lookupAsset = (abs: string): string | null => {
    const clean = abs.replace(/&amp;/g, "&");
    for (const v of [clean, abs, normalizeAssetKey(clean)]) {
      const hit = store.map.get(v);
      if (hit) return hit;
    }
    try {
      const u = new URL(clean);
      // Match same pathname ignoring volatile query params where possible
      const pathKey = `${u.origin}${u.pathname}`;
      for (const [k, v] of store.map) {
        if (k.startsWith(pathKey) || pathKey.startsWith(k.split("?")[0]!)) return v;
      }
      // Notion image URLs often differ by width= — match on attachment key
      const attach = u.pathname.match(/\/image\/(attachment[^/]*)/i);
      if (attach) {
        const needle = attach[1]!;
        for (const [k, v] of store.map) {
          if (k.includes(needle)) return v;
        }
      }
      // file.notion.so / signed file URLs: match shared UUID folder or filename
      const uuids = u.pathname.match(
        /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi,
      );
      if (uuids) {
        for (const id of uuids) {
          for (const [k, v] of store.map) {
            if (k.includes(id)) return v;
          }
        }
      }
      const file = decodeURIComponent(u.pathname.split("/").pop() || "");
      if (file && /\.(mp3|m4a|wav|ogg|mp4|webm|png|jpe?g|webp|gif|svg|pdf)$/i.test(file)) {
        for (const [k, v] of store.map) {
          if (k.includes(file)) return v;
        }
      }
    } catch {
      /* ignore */
    }
    return null;
  };

  const pageLocalFor = (abs: string): string | null => {
    const id = extractPageId(abs);
    if (id && idToLocal.has(id)) return idToLocal.get(id)!;
    try {
      const u = new URL(abs);
      const clean = `${u.origin}${u.pathname.replace(/\/$/, "")}`;
      for (const [remote, local] of pageUrlMap) {
        if (remote === clean || remote === abs.split("?")[0]) return local;
      }
    } catch {
      /* ignore */
    }
    return null;
  };

  const isImagePath = (abs: string): boolean => {
    try {
      return /\/image\//i.test(new URL(abs).pathname);
    } catch {
      return /\/image\//i.test(abs);
    }
  };

  /** Fix previously-written ./assets/*.bin that were actually pages */
  const remapRelative = (val: string): string | null => {
    const cleaned = val.replace(/^\.\//, "");
    if (!cleaned.startsWith("assets/")) return null;
    const src = store.reverse.get(cleaned) || store.reverse.get(val);
    if (!src) return null;
    const pageLocal = pageLocalFor(src);
    if (pageLocal) return relTo(pageLocal);
    return null;
  };

  const rewriteAbs = (raw: string): string | null => {
    let abs: string;
    try {
      abs = new URL(raw.replace(/&amp;/g, "&"), pageUrl).href;
    } catch {
      return null;
    }

    // Images / files / audio → assets only (never page map)
    if (
      isImagePath(abs) ||
      /\/file\//i.test(abs) ||
      /file\.notion\.so/i.test(abs) ||
      /\.(mp3|m4a|wav|ogg|mp4|webm)(\?|$)/i.test(abs)
    ) {
      const asset = lookupAsset(abs);
      return asset ? relTo(asset) : abs; // keep absolute https if not downloaded
    }

    const pageId = extractPageId(abs);
    if (pageId || isNotionPageAssetUrl(abs)) {
      const pageLocal = pageLocalFor(abs);
      if (pageLocal) return relTo(pageLocal);
      // Keep absolute so rewriteAllPages can fix once pageUrlMap is complete.
      // Never collapse to "#".
      return abs;
    }

    const asset = lookupAsset(abs);
    return asset ? relTo(asset) : null;
  };

  // Protect original-url attribute from being rewritten to a local path
  const originalSlots: string[] = [];
  let out = html.replace(
    /(\sdata-nsp-original-url=")([^"]*)(")/gi,
    (_m, a: string, val: string, b: string) => {
      const i = originalSlots.length;
      originalSlots.push(val);
      return `${a}__NSP_ORIGINAL_${i}__${b}`;
    },
  );

  out = out.replace(
    /\b(href|src|poster)=["']([^"']+)["']/gi,
    (full, attr: string, val: string) => {
      if (val.startsWith("data:") || val.startsWith("mailto:")) return full;
      // Recover dead "#" later via data-block-id pass
      if (val === "#") return full;
      if (val.startsWith("#") && !val.includes("/")) return full; // #main etc.

      if (val.startsWith("./") || val.startsWith("../")) {
        const fixed = remapRelative(val);
        if (fixed) return `${attr}="${fixed}"`;
        return full;
      }
      const local = rewriteAbs(val);
      if (local) return `${attr}="${local}"`;
      return full;
    },
  );

  out = out.replace(/\bsrcset=["']([^"']+)["']/gi, (_full, val: string) => {
    const parts = val.split(",").map((part) => {
      const bits = part.trim().split(/\s+/);
      const u = bits[0]!;
      const rest = bits.slice(1).join(" ");
      if (u.startsWith("./") || u.startsWith("../")) {
        const fixed = remapRelative(u);
        if (fixed) return rest ? `${fixed} ${rest}` : fixed;
        return part.trim();
      }
      const local = rewriteAbs(u);
      if (local) return rest ? `${local} ${rest}` : local;
      return part.trim();
    });
    return `srcset="${parts.join(", ")}"`;
  });

  out = out.replace(/url\((['"]?)([^)'"]+)\1\)/gi, (full, quote: string, val: string) => {
    if (val.startsWith("data:") || val.startsWith("./") || val.startsWith("../")) {
      return full;
    }
    const local = rewriteAbs(val);
    return local ? `url(${quote}${local}${quote})` : full;
  });

  // Recover href="#" using nearest ancestor data-block-id (Notion page blocks)
  out = repairDeadPageLinks(out, pageUrlMap, pageLocalPath);

  // Restore protected original URLs
  out = out.replace(/__NSP_ORIGINAL_(\d+)__/g, (_m, i: string) => {
    return originalSlots[Number(i)] ?? "";
  });

  return out;
}

/** Fix <a href="#"> using the enclosing element's data-block-id when it matches a scraped page. */
export function repairDeadPageLinks(
  html: string,
  pageUrlMap: Map<string, string>,
  pageLocalPath: string,
): string {
  const pageDir = dirname(pageLocalPath) === "." ? "" : dirname(pageLocalPath);
  const idToLocal = new Map<string, string>();
  for (const [remote, local] of pageUrlMap) {
    const id = extractPageId(remote);
    if (id && !idToLocal.has(id)) idToLocal.set(id, local);
  }
  if (!idToLocal.size) return html;

  const relTo = (targetFromRoot: string): string => {
    let rel = relative(pageDir, targetFromRoot);
    if (!rel) rel = basename(targetFromRoot);
    rel = toPosix(rel);
    if (!rel.startsWith(".") && !rel.startsWith("/")) rel = `./${rel}`;
    return rel;
  };

  // Walk forward; remember last page-like data-block-id; rewrite href="#" under it.
  const chunks = html.split(/(?=<[^>]*\bdata-block-id=)/i);
  let activeHref: string | null = null;
  return chunks
    .map((chunk) => {
      const m = chunk.match(/\bdata-block-id=["']([^"']+)["']/i);
      if (m) {
        const id = normalizeBlockId(m[1]!);
        // Only switch when this block id maps to a scraped page (ignore columns etc.)
        if (id && idToLocal.has(id)) {
          activeHref = relTo(idToLocal.get(id)!);
        }
      }
      if (!activeHref) return chunk;
      return chunk.replace(
        /(<a\b[^>]*?\bhref=["'])#(["'])/gi,
        `$1${activeHref}$2`,
      );
    })
    .join("");
}

export function rewriteCssFiles(store: AssetStore, pageUrl: string): void {
  const done = new Set<string>();
  for (const [, rel] of store.map) {
    if (!rel.endsWith(".css") || done.has(rel)) continue;
    done.add(rel);
    const abs = join(store.outRoot, rel);
    let css = readFileSync(abs, "utf8");
    const pageDir = dirname(rel);
    css = css.replace(/url\((['"]?)([^)'"]+)\1\)/gi, (full, quote: string, val: string) => {
      if (val.startsWith("data:")) return full;
      try {
        const absUrl = new URL(val, pageUrl).href;
        const mapped = store.map.get(normalizeAssetKey(absUrl));
        if (!mapped) return full;
        let r = toPosix(relative(pageDir, mapped));
        if (!r.startsWith(".")) r = `./${r}`;
        return `url(${quote}${r}${quote})`;
      } catch {
        return full;
      }
    });
    writeFileSync(abs, css);
  }
}

export function findRemainingRemoteUrls(html: string, baseUrl?: string): string[] {
  const out = new Set<string>();
  const add = (raw: string) => {
    let u = raw.replace(/&amp;/g, "&");
    if (/w3\.org/i.test(u)) return;
    if (u.startsWith("/") && baseUrl) {
      try {
        u = new URL(u, baseUrl).href;
      } catch {
        return;
      }
    }
    if (!/^https?:\/\//i.test(u)) return;
    if (isNotionPageAssetUrl(u)) return;
    if (/\.js(\?|$)/i.test(u) && !/\/image\//i.test(u)) return;
    out.add(u);
  };

  for (const m of html.matchAll(/https?:\/\/[^"'\s)<]+/gi)) {
    add(m[0]!);
  }
  // Relative Notion image / page-asset paths inside collection snapshots
  for (const m of html.matchAll(
    /(?:src|href)=["'](\/image\/[^"']+)["']/gi,
  )) {
    add(m[1]!);
  }
  for (const m of html.matchAll(/url\((['"]?)(\/image\/[^)'"]+)\1\)/gi)) {
    add(m[2]!);
  }
  return [...out];
}

/**
 * Count image/audio blocks whose figures still lack a real media src.
 * Empty shells are never valid scrape output.
 */
export function countEmptyMediaShellsInHtml(html: string): number {
  let empty = 0;
  const re =
    /<div\b[^>]*data-block-id="([^"]+)"[^>]*notion-(audio|image)-block[^>]*>([\s\S]*?)(<\/div>\s*<\/div>\s*<\/div>)/gi;
  for (const m of html.matchAll(re)) {
    const kind = (m[2] || "").toLowerCase();
    const mid = (m[3] || "") + (m[4] || "");
    if (kind === "audio") {
      if (!/<audio\b[^>]*\bsrc=["'](?!data:)[^"'\s>]+/i.test(mid)) empty += 1;
    } else if (!/<img\b[^>]*\bsrc=["'](?!data:)[^"'\s>]+/i.test(mid)) {
      empty += 1;
    }
  }
  return empty;
}

export function htmlHasEmptyMediaShells(html: string): boolean {
  return countEmptyMediaShellsInHtml(html) > 0;
}

/** Map Notion block UUID (32-hex) → best local audio/image asset path. */
export function buildBlockAssetIndex(
  entries: Iterable<[string, string]>,
): Map<string, { audio?: string; image?: string; imageWidth: number }> {
  const index = new Map<
    string,
    { audio?: string; image?: string; imageWidth: number }
  >();
  for (const [remote, rel] of entries) {
    let blockId: string | null = null;
    let width = 0;
    try {
      const u = new URL(remote.replace(/&amp;/g, "&"));
      blockId = normalizeBlockId(u.searchParams.get("id"));
      width = Number(u.searchParams.get("width") || 0) || 0;
      // Some Notion CDN URLs put the block id only in the path fragment
      if (!blockId) {
        const pathId = u.pathname.match(
          /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i,
        );
        if (pathId && /\/(image|file)\//i.test(u.pathname)) {
          blockId = normalizeBlockId(pathId[0]);
        }
      }
    } catch {
      continue;
    }
    if (!blockId) continue;
    const entry = index.get(blockId) || { imageWidth: 0 };
    const isAudio =
      /\.(mp3|m4a|ogg|wav|aac)(\?|$)/i.test(remote) ||
      /\.(mp3|m4a|ogg|wav|aac)$/i.test(rel);
    const isImage =
      /\/image\//i.test(remote) ||
      /\.(png|jpe?g|webp|gif|svg)$/i.test(rel);
    if (isAudio) entry.audio = rel;
    if (isImage && (!entry.image || width >= entry.imageWidth)) {
      entry.image = rel;
      entry.imageWidth = width;
    }
    index.set(blockId, entry);
  }
  return index;
}

/**
 * Inject <audio>/<img> into empty Notion media shells and replace gif
 * placeholders using assets keyed by ?id=<blockId> in the CDN URL.
 */
export function injectBlockMedia(
  html: string,
  store: AssetStore,
  pageLocalPath: string,
): string {
  const index = buildBlockAssetIndex(store.map.entries());
  if (!index.size) return html;

  const pageDir = dirname(pageLocalPath) === "." ? "" : dirname(pageLocalPath);
  const relTo = (targetFromRoot: string): string => {
    let rel = relative(pageDir, targetFromRoot);
    if (!rel) rel = basename(targetFromRoot);
    rel = toPosix(rel);
    if (!rel.startsWith(".") && !rel.startsWith("/")) rel = `./${rel}`;
    return rel;
  };

  const fillFigureOrAppend = (
    mid: string,
    close: string,
    mediaHtml: string,
  ): string => {
    // Full empty figure inside mid: <div role="figure"…></div>
    if (
      /(<div\b[^>]*role="figure"[^>]*>)(\s*)(<\/div>)/i.test(mid)
    ) {
      return (
        mid.replace(
          /(<div\b[^>]*role="figure"[^>]*>)(\s*)(<\/div>)/i,
          `$1${mediaHtml}$3`,
        ) + close
      );
    }
    // Figure opener in mid; its </div> is the first of the trailing close group
    if (/<div\b[^>]*role="figure"[^>]*>/i.test(mid) && !/<img\b|<audio\b/i.test(mid)) {
      return (
        mid.replace(
          /(<div\b[^>]*role="figure"[^>]*>)/i,
          `$1${mediaHtml}`,
        ) + close
      );
    }
    return mid + mediaHtml + close;
  };

  // Audio / image: fill empty Notion figure shells from ?id=<blockId> assets
  html = html.replace(
    /(<div\b[^>]*data-block-id="([^"]+)"[^>]*notion-(audio|image)-block[^>]*>)([\s\S]*?)(<\/div>\s*<\/div>\s*<\/div>)/gi,
    (
      full,
      open: string,
      id: string,
      kind: string,
      mid: string,
      close: string,
    ) => {
      const entry = index.get(normalizeBlockId(id) || "");
      if (!entry) return full;
      const isAudio = kind.toLowerCase() === "audio";
      if (isAudio) {
        if (/<audio\b/i.test(mid + close) || !entry.audio) return full;
        const src = relTo(entry.audio);
        const player =
          `<audio controls preload="metadata" src="${src}" ` +
          `style="width:100%;max-width:100%;display:block"></audio>`;
        return open + fillFigureOrAppend(mid, close, player);
      }
      // image
      if (!entry.image) return full;
      const src = relTo(entry.image);
      if (/<img\b/i.test(mid)) {
        const replaced = mid.replace(
          /(<img\b[^>]*\bsrc=")data:image\/(?:gif|svg\+xml)[^"]*/gi,
          `$1${src}`,
        );
        return open + replaced + close;
      }
      const img =
        `<img alt="" src="${src}" referrerpolicy="same-origin" ` +
        `style="display:block;width:100%;max-width:100%;height:auto" />`;
      return open + fillFigureOrAppend(mid, close, img);
    },
  );

  return html;
}

const OG_IMAGE_CACHE = new Map<string, string | null>();

async function fetchOgImageUrl(pageUrl: string): Promise<string | null> {
  if (OG_IMAGE_CACHE.has(pageUrl)) return OG_IMAGE_CACHE.get(pageUrl)!;
  try {
    const res = await fetch(pageUrl, {
      headers: {
        "user-agent":
          "Mozilla/5.0 (compatible; notion-static-exporter/1.0; +https://github.com/Novailoveyou/notion-static-exporter)",
        accept: "text/html,application/xhtml+xml",
      },
      redirect: "follow",
    });
    if (!res.ok) {
      OG_IMAGE_CACHE.set(pageUrl, null);
      return null;
    }
    const html = await res.text();
    const m =
      html.match(
        /property=["']og:image["']\s+content=["']([^"']+)["']/i,
      ) ||
      html.match(
        /content=["']([^"']+)["']\s+property=["']og:image["']/i,
      ) ||
      html.match(
        /property=["']og:image:url["']\s+content=["']([^"']+)["']/i,
      );
    const raw = m?.[1] || null;
    let abs: string | null = null;
    if (raw) {
      try {
        abs = new URL(raw, pageUrl).href;
      } catch {
        abs = null;
      }
    }
    OG_IMAGE_CACHE.set(pageUrl, abs);
    return abs;
  } catch {
    OG_IMAGE_CACHE.set(pageUrl, null);
    return null;
  }
}

async function downloadPublicAsset(
  store: AssetStore,
  url: string,
): Promise<string | null> {
  const clean = url.replace(/&amp;/g, "&");
  const key = normalizeAssetKey(clean);
  if (store.map.has(key)) return store.map.get(key)!;
  try {
    const res = await fetch(clean, {
      headers: {
        "user-agent":
          "Mozilla/5.0 (compatible; notion-static-exporter/1.0)",
        accept: "image/*,*/*",
      },
      redirect: "follow",
    });
    if (!res.ok) return null;
    const ct = res.headers.get("content-type");
    const buf = Buffer.from(await res.arrayBuffer());
    return saveAsset(store, clean, buf, ct);
  } catch {
    return null;
  }
}

/**
 * Replace 1×1 gif placeholders in Notion bookmark cards with the target
 * page's og:image (downloaded locally). Generic — works for any future
 * bookmark links, not just Wordwall.
 */
export async function enrichBookmarkCovers(
  html: string,
  store: AssetStore,
  pageLocalPath: string,
): Promise<string> {
  if (!/notion-bookmark-block/i.test(html)) return html;
  if (!/data:image\/gif/i.test(html)) return html;

  const pageDir = dirname(pageLocalPath) === "." ? "" : dirname(pageLocalPath);
  const relTo = (targetFromRoot: string): string => {
    let rel = relative(pageDir, targetFromRoot);
    if (!rel) rel = basename(targetFromRoot);
    rel = toPosix(rel);
    if (!rel.startsWith(".") && !rel.startsWith("/")) rel = `./${rel}`;
    return rel;
  };

  const starts: number[] = [];
  const startRe = /<div\b[^>]*notion-bookmark-block[^>]*>/gi;
  let sm = startRe.exec(html);
  while (sm) {
    starts.push(sm.index);
    sm = startRe.exec(html);
  }
  if (!starts.length) return html;

  type Patch = { start: number; end: number; chunk: string };
  const patches: Patch[] = [];

  for (let i = 0; i < starts.length; i++) {
    const start = starts[i]!;
    const end = Math.min(
      starts[i + 1] ?? start + 10000,
      start + 10000,
    );
    const chunk = html.slice(start, end);
    if (!/src="data:image\/gif/i.test(chunk)) continue;

    const hrefs = [...chunk.matchAll(/\bhref="(https?:\/\/[^"]+)"/gi)].map(
      (x) => x[1]!,
    );
    const external = hrefs.find((h) => {
      try {
        const u = new URL(h);
        return !isNotionSiteHost(u.hostname);
      } catch {
        return false;
      }
    });
    if (!external) continue;

    const og = await fetchOgImageUrl(external);
    if (!og) continue;
    const saved = await downloadPublicAsset(store, og);
    if (!saved) continue;
    const local = relTo(saved);
    const next = chunk.replace(
      /(<img\b[^>]*\bsrc=")data:image\/gif[^"]*/gi,
      `$1${local}`,
    );
    if (next !== chunk) patches.push({ start, end, chunk: next });
  }

  if (!patches.length) return html;
  let out = html;
  for (let i = patches.length - 1; i >= 0; i--) {
    const p = patches[i]!;
    out = out.slice(0, p.start) + p.chunk + out.slice(p.end);
  }
  return out;
}

export function ensureParentDir(filePath: string): void {
  mkdirSync(dirname(filePath), { recursive: true });
}
