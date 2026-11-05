/**
 * sw.js — Service Worker SiapTKA
 * ================================
 * Strategi:
 *  - App shell (HTML, JS, CSS, ikon) : cache-first, update background
 *  - Paket soal XML                 : network-first, fallback cache
 *  - API GAS                        : bypass (selalu network)
 *
 * Naikkan CACHE_VERSION setiap kali deploy perubahan besar
 * agar service worker lama dibuang dan aset baru diambil.
 */

const CACHE_VERSION = 'siaptka-v1';
const APP_SHELL = [
  './',
  './index.html',
  './landing.html',
  './guru.html',
  './murid.html',
  './api.js',
  './manifest.json',
  './icon.png',
  // Catatan: paket XML TIDAK di-precache di sini.
  // Diambil saat runtime (network-first) agar bisa update tanpa redeploy SW.
];

// ==========================================
// INSTALL — cache app shell
// ==========================================
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION)
      .then((cache) => cache.addAll(APP_SHELL).catch((err) => {
        // Jangan gagalkan install jika 1 file hilang (mis. icon belum ada)
        console.warn('[SW] Sebagian aset gagal di-precache:', err);
      }))
      .then(() => self.skipWaiting())
  );
});

// ==========================================
// ACTIVATE — hapus cache versi lama
// ==========================================
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

// ==========================================
// FETCH — routing
// ==========================================
self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // 1) Hanya tangani GET (POST/PUT ke GAS diteruskan langsung)
  if (req.method !== 'GET') return;

  // 2) BYPASS: semua request ke GAS (script.google.com / script.googleusercontent.com)
  if (url.hostname === 'script.google.com' ||
      url.hostname === 'script.googleusercontent.com') {
    return; // biarkan browser menangani langsung
  }

  // 3) BYPASS: Google Fonts (biar selalu fresh & tidak boros cache)
  if (url.hostname === 'fonts.googleapis.com' ||
      url.hostname === 'fonts.gstatic.com') {
    return;
  }

  // 4) Paket soal XML → network-first, fallback cache
  if (url.pathname.endsWith('.xml')) {
    event.respondWith(networkFirst(req));
    return;
  }

  // 5) Navigasi HTML & aset app shell → cache-first + revalidate
  if (req.mode === 'navigate' ||
      req.destination === 'document' ||
      /\.(?:html|js|css|png|svg|ico|json|webmanifest)$/i.test(url.pathname)) {
    event.respondWith(cacheFirstRevalidate(req));
    return;
  }

  // 6) Lainnya → biarkan browser
});

// ==========================================
// STRATEGI
// ==========================================

/**
 * Cache-first + revalidate background.
 * Cepat (dari cache), tapi tetap update ke versi terbaru saat online.
 */
async function cacheFirstRevalidate(request) {
  const cache = await caches.open(CACHE_VERSION);
  const cached = await cache.match(request);

  const fetchPromise = fetch(request)
    .then((response) => {
      // Simpan hanya response OK & same-origin atau CORS-friendly
      if (response && response.status === 200 && response.type !== 'opaque') {
        cache.put(request, response.clone());
      }
      return response;
    })
    .catch(() => null);

  if (cached) {
    // Sajikan cache segera, update di background
    fetchPromise; // jangan di-await
    return cached;
  }

  const fresh = await fetchPromise;
  if (fresh) return fresh;

  // Fallback terakhir: halaman offline sederhana
  return offlineFallback();
}

/**
 * Network-first, fallback ke cache.
 * Cocok untuk data yang bisa berubah (paket XML).
 */
async function networkFirst(request) {
  const cache = await caches.open(CACHE_VERSION);
  try {
    const response = await fetch(request);
    if (response && response.status === 200) {
      cache.put(request, response.clone());
    }
    return response;
  } catch (err) {
    const cached = await cache.match(request);
    if (cached) return cached;
    return new Response('Offline dan tidak ada cache untuk: ' + request.url, {
      status: 503,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' }
    });
  }
}

/**
 * Halaman fallback minimal jika offline dan tidak ada cache.
 */
function offlineFallback() {
  const html = `<!DOCTYPE html>
<html lang="id"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Offline — SiapTKA</title>
<style>
  body { font-family: system-ui, sans-serif; background: #f8fafc; color: #1f2937;
         display: grid; place-items: center; min-height: 100vh; margin: 0; padding: 20px; text-align: center; }
  .box { max-width: 360px; }
  .icon { font-size: 48px; margin-bottom: 12px; }
  h1 { font-size: 22px; margin-bottom: 8px; }
  p { color: #6b7280; font-size: 14px; margin-bottom: 20px; }
  button { padding: 10px 20px; background: #1e3a8a; color: white; border: none;
           border-radius: 8px; font-weight: 600; cursor: pointer; }
</style></head>
<body>
  <div class="box">
    <div class="icon">📡</div>
    <h1>Anda sedang offline</h1>
    <p>Halaman ini belum pernah dibuka sebelumnya. Silakan sambungkan internet lalu coba lagi.</p>
    <button onclick="location.reload()">Coba Lagi</button>
  </div>
</body></html>`;
  return new Response(html, {
    status: 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8' }
  });
}

// ==========================================
// MESSAGE — dukung update manual dari klien
// ==========================================
self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
