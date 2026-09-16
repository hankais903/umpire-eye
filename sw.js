/* 離線快取。
 *
 * 改過任何一支遊戲檔案之後，一定要把 VERSION 加一，
 * 否則裝過的人會一直拿到舊版：下面的資源是 cache-first，
 * 只有換了 VERSION 讓快取整個重建才會抓到新檔。
 */
const VERSION = 'v1';
const CACHE = 'umpire-eye-' + VERSION;

// 遊戲跑起來需要的全部東西。少一個 addAll 就會整批失敗、
// service worker 裝不起來——這是故意的，寧可大聲壞掉也不要半殘的離線包。
const SHELL = [
  './',
  'index.html',
  'manifest.webmanifest',
  'vendor/three.min.js',
  'vendor/OrbitControls.js',
  'vendor/GLTFLoader.js',
  'pitcher-model.js',
  'pitcher-side-model.js',
  'pitcher-sub-model.js',
  'batter-model.js',
  'catcher-model.js',
  'scene.js',
  'physics.js',
  'game.js',
  'tuner.js',
  'icons/apple-touch-icon.png',
  'icons/icon-192.png',
  'icons/icon-512.png',
];

const FONT_HOSTS = ['fonts.googleapis.com', 'fonts.gstatic.com'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((names) => Promise.all(names.filter((n) => n !== CACHE).map((n) => caches.delete(n))))
      .then(() => self.clients.claim())
  );
});

async function cacheFirst(req) {
  const hit = await caches.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  // 字型是跨網域的 opaque 回應，status 會是 0，但一樣存得起來也用得了
  if (res && (res.ok || res.type === 'opaque')) {
    const c = await caches.open(CACHE);
    c.put(req, res.clone());
  }
  return res;
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // 頁面本身走 network-first：這樣改版推上去之後，
  // 只要有網路，下一次打開就會看到新的，不用等 VERSION 換。
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put('./', copy));
          return res;
        })
        .catch(() => caches.match('./').then((hit) => hit || caches.match('index.html')))
    );
    return;
  }

  if (url.origin === self.location.origin || FONT_HOSTS.includes(url.hostname)) {
    e.respondWith(cacheFirst(req));
  }
});
