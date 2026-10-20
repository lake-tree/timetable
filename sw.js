/* ============================================================
   sw.js — Service Worker
   策略：网络优先（优先拿到最新内容并更新缓存），失败时回退缓存
   缓存范围：
     1) 应用壳（本站静态资源，安装时预缓存）
     2) 运行时按需缓存：CDN 脚本、图标、以及 Supabase REST 数据
        （因此离线时也能看到最近一次加载的课表/待办）
   注意：写操作（POST/RPC）不做缓存，必须联网执行
   ============================================================ */
const CACHE_NAME = 'timetable-v1';
const PRECACHE = [
  '/',
  '/index.html',
  '/styles.css',
  '/config.js',
  '/app.js',
  '/manifest.json',
  '/icon-192.png',
  '/icon-512.png',
  '/icon-180.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return; // 写操作（POST）直连网络

  event.respondWith(
    fetch(req)
      .then((res) => {
        // 成功响应则复制一份写入缓存（仅缓存 200，且 basic/cors 均可）
        if (res && res.status === 200 && (res.type === 'basic' || res.type === 'cors')) {
          const copy = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(req, copy));
        }
        return res;
      })
      .catch(() =>
        // 断网：回退到缓存（ignoreVary 避免 Vary 头导致缓存未命中）
        caches.match(req, { ignoreVary: true }).then((cached) => {
          if (cached) return cached;
          // 页面导航请求回退到缓存的应用壳
          if (req.mode === 'navigate') return caches.match('/index.html', { ignoreVary: true });
          return undefined;
        })
      )
  );
});
