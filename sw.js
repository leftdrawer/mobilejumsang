/* 휴대점상 서비스 워커
   방식: 캐시에 있으면 그것부터 바로 내주고, 뒤에서 조용히 새것을 받아 캐시를 갈아 둔다.
        그래서 쓰는 사람은 아무것도 안 해도 다음에 열 때 새 판이 뜬다.
        뒤에서 받은 index.html 이 캐시본과 다르면(SHA-256) 열린 화면에 알려 바로 다시 열 수 있게 한다.
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

const hex = buf => crypto.subtle.digest('SHA-256', buf)
  .then(h => Array.from(new Uint8Array(h), b => b.toString(16).padStart(2, '0')).join(''));

// 새 판 알림. 다시 열린 화면(resultingClientId)이 아직 안 섰으면 잠깐씩 기다렸다가 보낸다
const tellNewVersion = id => {
  const send = n => self.clients.matchAll({type: 'window', includeUncontrolled: true}).then(cs => {
    if (id && n > 0 && !cs.some(c => c.id === id)) return new Promise(r => setTimeout(r, 500)).then(() => send(n - 1));
    cs.forEach(c => c.postMessage({type: 'hj-new-version'}));
  });
  return send(20);
};

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;
  if (url.pathname.endsWith('/sw.js')) return;      // 워커 자신은 늘 새로 받는다
  const isDoc = req.mode === 'navigate';
  const key = url.origin + url.pathname;             // 꼬리(?…)가 달라도 캐시 항목은 하나

  const work = caches.open(CACHE).then(cache =>
    cache.match(req, {ignoreSearch: true}).then(hit => {
      // 덮어쓰기 전에 캐시본의 해시를 떠 둔다 (처음 설치라 캐시가 비었으면 비교하지 않는다)
      const oldHash = (isDoc && hit) ? hit.clone().arrayBuffer().then(hex) : null;
      let saved = Promise.resolve();
      const fresh = fetch(new Request(req.url, {cache: 'no-cache'}))
        .then(res => {
          if (res && res.ok) {
            const toCache = res.clone();
            const changed = oldHash
              ? Promise.all([oldHash, res.clone().arrayBuffer().then(hex)]).then(([a, b]) => a !== b).catch(() => false)
              : Promise.resolve(false);
            saved = changed.then(ch => cache.put(key, toCache)
              .then(() => cache.keys(key, {ignoreSearch: true}))
              .then(ks => Promise.all(ks.filter(k => k.url !== key).map(k => cache.delete(k))))
              .then(() => { if (ch) return tellNewVersion(e.resultingClientId); }));
          }
          return res;
        })
        .catch(() => null);
      return {cache, hit, fresh: fresh.then(r => ({r, saved}))};
    })
  );

  e.respondWith(work.then(w => w.hit || w.fresh.then(f => f.r || w.cache.match('./index.html'))));
  e.waitUntil(work.then(w => w.fresh).then(f => f.saved).catch(() => {}));
});
