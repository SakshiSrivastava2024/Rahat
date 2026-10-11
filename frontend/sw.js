const C = "rahat-v1";
const SHELL = [
  "./",
  "./index.html",
  "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.css",
  "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.js",
];

self.addEventListener("install", (e) =>
  e.waitUntil(
    caches.open(C).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())
  )
);

self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

// Network first for the app files, cache as fallback. API calls are never cached.
self.addEventListener("fetch", (e) => {
  const u = new URL(e.request.url);
  if (e.request.method !== "GET" || u.port === "3000" || u.pathname.startsWith("/requests")) return;
  e.respondWith(
    fetch(e.request)
      .then((r) => {
        const copy = r.clone();
        caches.open(C).then((c) => c.put(e.request, copy));
        return r;
      })
      .catch(() => caches.match(e.request))
  );
});