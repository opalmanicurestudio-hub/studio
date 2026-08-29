/*
 * ClarityFlow service worker — deliberately minimal.
 *
 * Its ONE job is installability: Chrome requires a fetch handler before it
 * offers "Add to Home Screen". It does NOT cache application data, and that
 * is a decision, not an omission: this is a live multi-user SaaS where a
 * cached response is a wrong answer waiting to be believed — a planner from
 * yesterday, a chair shown free that was sold an hour ago. The network is
 * the truth; offline, the app says so instead of guessing.
 *
 * Only the app's own static icons are cached, because they never lie.
 * Lives alongside firebase-messaging-sw.js, which keeps push duty.
 */
const STATIC = 'cf-static-v1';
const ICONS = ['/icon-192.png', '/icon-512.png', '/apple-touch-icon.png', '/manifest.json'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(STATIC).then((c) => c.addAll(ICONS)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== STATIC).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (ICONS.includes(url.pathname)) {
    e.respondWith(caches.match(e.request).then((hit) => hit || fetch(e.request)));
  }
  // Everything else passes straight to the network — no interception, no staleness.
});
