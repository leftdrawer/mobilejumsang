/* 휴대점상 서비스 워커
   방식: 캐시에 있으면 그것부터 바로 내주고, 뒤에서 조용히 새것을 받아 캐시를 갈아 둔다.
        그래서 쓰는 사람은 아무것도 안 해도 다음에 열 때 새 판이 뜬다.
        이 파일 안의 이름을 손으로 올릴 일도 없다. */
const CACHE = 'hyudae-jeomsang';
const FILES = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icon-180.png',
  './icon-192.png',
  './icon-512.png',
  './icon-maskable-512.png'
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE)
      .then(c => c.addAll(FILES.map(u => new Request(u, {cache: 'reload'}))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;
  if (url.pathname.endsWith('/sw.js')) return;      // 워커 자신은 늘 새로 받는다

  e.respondWith(
    caches.open(CACHE).then(cache =>
      cache.match(req, {ignoreSearch: true}).then(hit => {
        const fresh = fetch(new Request(req.url, {cache: 'no-cache'}))
          .then(res => { if (res && res.ok) cache.put(req, res.clone()); return res; })
          .catch(() => null);
        return hit || fresh.then(r => r || cache.match('./index.html'));
      })
    )
  );
});
