/* 離線快取。
 *
 * 改過任何一支遊戲檔案之後，要把 VERSION 加一，快取才會整批重建。
 * 忘了加也不會出現「新說明配舊遊戲」那種半新半舊的狀況——
 * 所有檔案（含網頁本身）都走同一套規則，要嘛全舊、要嘛全新。
 * 新版準備好的時候會通知頁面，頁面自己重新載入一次就換過去了。
 */
const VERSION = 'v6';
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
  // 不等舊版收工：新版裝好就直接上，配合頁面那邊的重新載入
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((names) => Promise.all(names.filter((n) => n !== CACHE).map((n) => caches.delete(n))))
      .then(() => self.clients.claim())
  );
});

async function cacheFirst(req, key) {
  const hit = await caches.match(key || req);
  if (hit) return hit;
  const res = await fetch(req);
  // 字型是跨網域的 opaque 回應，status 會是 0，但一樣存得起來也用得了
  if (res && (res.ok || res.type === 'opaque')) {
    const c = await caches.open(CACHE);
    c.put(key || req, res.clone());
  }
  return res;
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;

  // 網頁本身跟其他檔案走同一套規則，否則會出現新網頁配舊程式
  if (req.mode === 'navigate') {
    e.respondWith(cacheFirst(req, './'));
    return;
  }

  const url = new URL(req.url);
  if (url.origin === self.location.origin || FONT_HOSTS.includes(url.hostname)) {
    e.respondWith(cacheFirst(req));
  }
});
