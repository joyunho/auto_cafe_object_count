// 오프라인용 서비스 워커: 앱 셸은 캐시 우선, 백그라운드에서 갱신
// VERSION은 배포(.github/workflows/pages.yml)할 때 커밋 해시로 바뀐다 → 배포마다 새 워커가 설치된다.
const VERSION = 'dev';
const CACHE_PREFIX = 'cafe-inventory-';
const CACHE = `${CACHE_PREFIX}${VERSION}`;
// pdf.js 는 여기 없다: PDF 를 넣을 때만 CDN 에서 받는다 (평소에는 내려받지 않는다)
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
  './src/logic/forecast.js',
  './src/logic/pos.js',
  './src/logic/consumption.js',
  './src/logic/pos-model.js',
  './src/logic/pdf-text.js',
  './src/data/pos-map.js',
  './src/data/pos-estimates.js',
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
// 있으면 좋지만 없어도 앱이 도는 파일 (레시피 표는 배포 설정에 따라 없을 수 있다) — 실패해도 설치를 막지 않는다
const OPTIONAL = ['./src/data/recipes.js'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((c) => c.addAll(SHELL).then(() => Promise.all(OPTIONAL.map((u) => c.add(u).catch(() => {})))))
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
