import { mkdirSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join, relative, sep } from "node:path";

const ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" role="img">
  <rect width="512" height="512" rx="96" fill="#191919"/>
  <rect x="96" y="112" width="320" height="48" rx="12" fill="#ffffff" opacity=".92"/>
  <rect x="96" y="196" width="240" height="36" rx="10" fill="#ffffff" opacity=".55"/>
  <rect x="96" y="260" width="280" height="36" rx="10" fill="#ffffff" opacity=".4"/>
  <rect x="96" y="324" width="200" height="36" rx="10" fill="#ffffff" opacity=".28"/>
</svg>
`;

function toPosix(p: string): string {
  return p.split(sep).join("/");
}

function walkFiles(dir: string, outRoot: string, acc: string[]): void {
  for (const name of readdirSync(dir)) {
    if (name === ".git" || name === ".github") continue;
    const abs = join(dir, name);
    const st = statSync(abs);
    if (st.isDirectory()) {
      walkFiles(abs, outRoot, acc);
      continue;
    }
    // Skip the SW registering itself in a circular way is fine; include all static assets
    let rel = toPosix(relative(outRoot, abs));
    if (!rel.startsWith(".")) rel = `./${rel}`;
    else if (!rel.startsWith("./")) rel = `./${rel}`;
    acc.push(rel);
  }
}

export function writePwaAssets(
  outRoot: string,
  opts?: { name?: string; description?: string },
): { files: number } {
  const name = opts?.name || "Notion Static";
  const description =
    opts?.description || "Offline Notion site mirror";

  mkdirSync(join(outRoot, "assets"), { recursive: true });
  writeFileSync(join(outRoot, "assets", "nsp-icon.svg"), ICON_SVG, "utf8");

  const files: string[] = [];
  walkFiles(outRoot, outRoot, files);
  // Ensure core PWA files are listed (may not exist yet during walk of sw)
  for (const f of [
    "./index.html",
    "./manifest.webmanifest",
    "./assets/nsp-runtime.js",
    "./assets/nsp-icon.svg",
    "./assets/nsp-precache.json",
  ]) {
    if (!files.includes(f)) files.push(f);
  }
  // Don't precache the service worker file itself via cache.add of sw.js from list
  // (browsers handle SW updates separately) — still fine to include.

  writeFileSync(
    join(outRoot, "assets", "nsp-precache.json"),
    JSON.stringify(files, null, 0),
    "utf8",
  );

  const manifest = {
    name,
    short_name: name.slice(0, 24),
    description,
    start_url: "./index.html",
    scope: "./",
    display: "standalone",
    background_color: "#191919",
    theme_color: "#191919",
    lang: "en",
    icons: [
      {
        src: "./assets/nsp-icon.svg",
        sizes: "any",
        type: "image/svg+xml",
        purpose: "any maskable",
      },
    ],
  };
  writeFileSync(
    join(outRoot, "manifest.webmanifest"),
    JSON.stringify(manifest, null, 2),
    "utf8",
  );

  writeFileSync(join(outRoot, "sw.js"), SERVICE_WORKER_JS, "utf8");

  return { files: files.length };
}

/** Service worker: precache on install, cache-first for same-origin, network fallback. */
const SERVICE_WORKER_JS = `/* nsp service worker */
const CACHE = "nsp-static-v9";

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    try {
      const res = await fetch("./assets/nsp-precache.json", { cache: "no-cache" });
      const list = await res.json();
      const cache = await caches.open(CACHE);
      await Promise.all(
        list.map(async (url) => {
          try {
            const r = await fetch(url, { cache: "reload" });
            if (r.ok) await cache.put(url, r);
          } catch (_) {}
        }),
      );
    } catch (_) {}
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  const isMedia =
    /\\.(mp3|m4a|ogg|wav|aac|mp4|webm|mov)(\\?|$)/i.test(url.pathname) ||
    (req.headers.get("accept") || "").includes("audio/");
  // Range requests must hit the network — serving a full cached body breaks audio
  if (isMedia || req.headers.has("range")) {
    event.respondWith(
      fetch(req)
        .then((fresh) => {
          if (fresh && fresh.ok && !req.headers.has("range")) {
            const copy = fresh.clone();
            caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
          }
          return fresh;
        })
        .catch(async () => {
          const cache = await caches.open(CACHE);
          const cached = await cache.match(req, { ignoreSearch: true });
          if (cached) return cached;
          throw new Error("offline media miss");
        }),
    );
    return;
  }

  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const cached = await cache.match(req, { ignoreSearch: true });
    if (cached) {
      // Revalidate in background
      event.waitUntil(
        fetch(req)
          .then((r) => {
            if (r && r.ok) return cache.put(req, r.clone());
          })
          .catch(() => {}),
      );
      return cached;
    }
    try {
      const fresh = await fetch(req);
      if (fresh && fresh.ok) {
        cache.put(req, fresh.clone()).catch(() => {});
      }
      return fresh;
    } catch (err) {
      // Offline fallback to index for navigations
      if (req.mode === "navigate") {
        const index = await cache.match("./index.html");
        if (index) return index;
      }
      throw err;
    }
  })());
});

self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "NSP_CACHE_URLS") {
    const urls = event.data.urls || [];
    event.waitUntil((async () => {
      const cache = await caches.open(CACHE);
      await Promise.all(
        urls.map(async (url) => {
          try {
            const r = await fetch(url, { cache: "reload" });
            if (r.ok) await cache.put(url, r);
          } catch (_) {}
        }),
      );
    })());
  }
});
`;
