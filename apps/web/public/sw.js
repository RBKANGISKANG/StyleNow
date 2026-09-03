/* StyleNow service worker — offline shell.
 *
 * Strategy mirrors the mobile OFFLINE.md contract at web scale:
 *  - static assets (_next/static, icons): cache-first — they are content-hashed
 *  - navigations: network-first with cached fallback, so a cold start on the
 *    U-Bahn still renders the last-seen shell
 *  - Supabase and other cross-origin calls are never intercepted; booking
 *    creation must stay online-only (a slot held offline is a slot sold twice)
 */
const CACHE = 'stylenow-v1';

/* The cache must not grow forever: every deploy retires a set of content-
 * hashed chunks that would otherwise sit in storage for the life of the
 * origin. Trim oldest-first after each write — an evicted hashed asset is
 * simply re-fetched, so the cap costs nothing but a request. */
const MAX_ENTRIES = 80;

async function putTrimmed(request, response) {
  const c = await caches.open(CACHE);
  await c.put(request, response);
  const keys = await c.keys();
  if (keys.length > MAX_ENTRIES) {
    await Promise.all(keys.slice(0, keys.length - MAX_ENTRIES).map((k) => c.delete(k)));
  }
}

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(caches.open(CACHE));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))),
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin) return;

  const isStatic =
    url.pathname.includes('/_next/static/') ||
    url.pathname.includes('/icons/') ||
    url.pathname.endsWith('.png') ||
    url.pathname.endsWith('.webmanifest');

  if (isStatic) {
    event.respondWith(
      caches.match(event.request).then(
        (hit) =>
          hit ||
          fetch(event.request).then((res) => {
            const copy = res.clone();
            void putTrimmed(event.request, copy);
            return res;
          }),
      ),
    );
    return;
  }

  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request)
        .then((res) => {
          const copy = res.clone();
          void putTrimmed(event.request, copy);
          return res;
        })
        .catch(() => caches.match(event.request).then((hit) => hit || caches.match('./'))),
    );
  }
});
