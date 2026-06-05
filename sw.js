// Service worker – network first -strategia.
// Hae aina ensin verkosta (jotta sovellus ja vuoronumerotila pysyvät ajan tasalla),
// käytä välimuistia vain offline-tilanteessa varmuuskopiona.
const CACHE = 'vuoronumero-v2';
const ASSETS = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './i18n.js',
  './manifest.json',
  './icons/icon-192.svg',
  './icons/icon-512.svg',
  './icons/icon-maskable.svg',
  './icons/silmaasema-logo.svg'
];

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).catch(() => {}));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;            // älä välimuistita kirjoituksia
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // Supabase-kutsut suoraan verkosta

  event.respondWith(
    fetch(req)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
        return res;
      })
      .catch(() => caches.match(req).then((r) => r || caches.match('./index.html')))
  );
});
