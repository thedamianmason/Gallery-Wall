// Service worker for the DisplayingArt PWA.
// Strategy: network-first for the same-origin app shell (so updates land
// immediately when online), falling back to cache when offline. API/token
// requests and cross-origin requests (DeviantArt images, the proxy) are never
// cached — they always go straight to the network.

const CACHE = "displayart-v4";
const SHELL = [
  "./",
  "./index.html",
  "./style.css",
  "./config.js",
  "./auth.js",
  "./api.js",
  "./qrcode.js",
  "./app.js",
  "./callback.html",
  "./manifest.webmanifest",
  "./icon.svg",
  "./icon-192.png",
  "./icon-512.png",
  "./icon-192-maskable.png",
  "./icon-512-maskable.png",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  const url = new URL(req.url);

  // Only manage same-origin GETs for the app shell. Let the token exchange, the
  // API proxy, and any cross-origin request go straight to the network.
  if (req.method !== "GET" || url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/") || url.pathname === "/token") return;

  e.respondWith(
    fetch(req)
      .then((res) => {
        if (res && res.ok && res.type === "basic") {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
        }
        return res;
      })
      .catch(() => caches.match(req).then((cached) => cached || caches.match("./index.html")))
  );
});
