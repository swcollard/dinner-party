// Caches only the static shell so the app opens offline. API, calendar and admin
// responses contain private data (addresses, allergies) and are never cached here.
const CACHE = "shell-v1";
const SHELL = ["/", "/style.css", "/app.js", "/manifest.webmanifest", "/icon.svg"];

self.addEventListener("install", (e) => e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL))));
self.addEventListener("activate", (e) =>
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))));

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin) return;
  if (/^\/(api|calendar|admin|healthz)\b/.test(url.pathname)) return; // network only
  e.respondWith(fetch(e.request).catch(() => caches.match(e.request).then((r) => r || caches.match("/"))));
});
