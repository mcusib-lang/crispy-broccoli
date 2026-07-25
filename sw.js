// AMRAP · Service Worker — app shell offline
const CACHE = 'amrap-v7';
// Archivos que SIEMPRE deben ir a la red primero (claves y capa de nube).
// Evita que una versión cacheada deje la sincronización "apagada".
const ALWAYS_FRESH = ['config.js', 'supabase-sync.js', 'social.js'];
const CORE = [
  './',
  './index.html',
  './hub.html',
  './onboarding.html',
  './biblioteca.html',
  './exercises-data.js',
  './support.js',
  './sesion.dc.html',
  './image-slot.js',
  './manifest.webmanifest',
  './icon-192.png',
  './icon-512.png',
  './icon-maskable-512.png',
  './apple-touch-icon.png'
];

// Instala: precachea el núcleo (tolerante a fallos individuales)
self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE).then((c) => Promise.allSettled(CORE.map((u) => c.add(u))))
      .then(() => self.skipWaiting())
  );
});

// Activa: limpia versiones viejas
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Fetch: red primero para navegación (HTML), cache primero para el resto.
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  const sameOrigin = url.origin === self.location.origin;

  // Claves y capa de nube: siempre red primero (con caché como respaldo offline).
  if (sameOrigin && ALWAYS_FRESH.some((f) => url.pathname.endsWith('/' + f) || url.pathname.endsWith(f))) {
    e.respondWith(
      fetch(req).then((res) => {
        if (res.ok) { const cp = res.clone(); caches.open(CACHE).then((c) => c.put(req, cp)); }
        return res;
      }).catch(() => caches.match(req))
    );
    return;
  }

  // Navegación / documentos: network-first con fallback a cache
  if (req.mode === 'navigate' || (req.destination === 'document')) {
    e.respondWith(
      fetch(req).then((res) => {
        if (sameOrigin) { const cp = res.clone(); caches.open(CACHE).then((c) => c.put(req, cp)); }
        return res;
      }).catch(() => caches.match(req).then((r) => r || caches.match('./index.html')))
    );
    return;
  }

  // Resto (JS, imágenes, fuentes): cache-first, y cachea lo nuevo
  e.respondWith(
    caches.match(req).then((cached) => cached || fetch(req).then((res) => {
      if (sameOrigin && res.ok) { const cp = res.clone(); caches.open(CACHE).then((c) => c.put(req, cp)); }
      return res;
    }).catch(() => cached))
  );
});
