// Bump CACHE_VERSION whenever any precached asset changes.
const CACHE_VERSION = "apnea-v1";

const VOICE_CLIPS = [
  "after_contraction",
  "breathe",
  "complete",
  "count_321",
  "count_54321",
  "hold",
  "hold_breath_in",
  "n10",
  "one_breath",
  "relax",
  "tap_contraction",
];

const PRECACHE_URLS = [
  "./",
  "index.html",
  "app.js",
  "style.css",
  "manifest.webmanifest",
  "icons/icon-192.png",
  "icons/icon-512.png",
  "icons/icon-maskable-512.png",
  "audio/sounds/rain.mp3",
  "audio/sounds/waves.mp3",
  "audio/sounds/forest.mp3",
  "audio/sounds/campfire.mp3",
  ...["male", "female"].flatMap((voice) =>
    VOICE_CLIPS.flatMap((clip) => [
      `audio/${voice}/${clip}.mp3`,
      `audio/${voice}/${clip}.opus`,
    ]),
  ),
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then((cache) =>
      // Use {cache: "reload"} so the install pulls fresh copies, not whatever the
      // browser HTTP cache happens to hold.
      Promise.all(
        PRECACHE_URLS.map((url) =>
          cache.add(new Request(url, { cache: "reload" })).catch(() => {}),
        ),
      ),
    ),
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((k) => k.startsWith("apnea-") && k !== CACHE_VERSION)
          .map((k) => caches.delete(k)),
      );
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // Network-first for navigations so the latest HTML is served when online,
  // with cached fallback when offline.
  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE_VERSION).then((c) => c.put(req, copy));
          return res;
        })
        .catch(() =>
          caches.match(req).then((c) => c || caches.match("index.html")),
        ),
    );
    return;
  }

  // Cache-first for everything else.
  event.respondWith(
    caches.match(req).then(
      (cached) =>
        cached ||
        fetch(req).then((res) => {
          if (!res || res.status !== 200 || res.type === "opaque") return res;
          const copy = res.clone();
          caches.open(CACHE_VERSION).then((c) => c.put(req, copy));
          return res;
        }),
    ),
  );
});
