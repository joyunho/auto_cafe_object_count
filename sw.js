// 오프라인용 서비스 워커: 앱 셸은 캐시 우선, 백그라운드에서 갱신
// VERSION은 배포(.github/workflows/pages.yml)할 때 커밋 해시로 바뀐다 → 배포마다 새 워커가 설치된다.
const VERSION = 'dev';
const CACHE_PREFIX = 'cafe-inventory-';
const CACHE = `${CACHE_PREFIX}${VERSION}`;
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
      // 이 앱의 옛 캐시만 지운다 (같은 origin의 다른 사이트 캐시는 건드리지 않음)
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith(CACHE_PREFIX) && k !== CACHE).map((k) => caches.delete(k))))
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
