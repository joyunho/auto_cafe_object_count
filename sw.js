// 오프라인용 서비스 워커: 앱 셸은 캐시 우선, 그 외는 네트워크 우선
const VERSION = 'v0.1.0';
const CACHE = `cafe-inventory-${VERSION}`;
const SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './src/styles.css',
  './src/app.js',
  './src/store.js',
  './src/data/items.js',
  './src/logic/order.js',
  './src/logic/stats.js',
  './src/logic/match.js',
  './src/ai/extract.js',
  './src/ui/html.js',
  './src/ui/count.js',
  './src/ui/order.js',
  './src/ui/history.js',
  './src/ui/items.js',
  './src/ui/settings.js',
  './src/ui/photo.js',
  './icons/icon.svg',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((c) => c.addAll(SHELL))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  // 외부(API, CDN)는 캐시하지 않는다
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    caches.match(req).then((cached) => {
      const network = fetch(req)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy));
          }
          return res;
        })
        .catch(() => cached);
      // 앱 셸은 캐시 우선(빠른 시작), 백그라운드에서 갱신
      return cached || network;
    }),
  );
});
