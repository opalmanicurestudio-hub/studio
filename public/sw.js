/*
 * ClarityFlow service worker.
 *
 * Installability (Chrome needs a fetch handler before it offers "Add to Home
 * Screen"), and the floor screens opening through a Wi-Fi drop.
 *
 * It still never keeps the app's DATA: this is a live multi-user SaaS where a
 * cached answer is a wrong answer waiting to be believed — a table shown free
 * that was seated a minute ago. Nothing under /api is touched. What it keeps is
 * the app's own code and the empty page of a few floor screens (host stand,
 * My tables, Clear tables, the kitchen screen), and those only come from here
 * when the network can't be reached at all. The screens then show what they
 * last had, saying how old it is, and keep taps on the device until the
 * connection's back (lib/last-seen, lib/outbox).
 *
 *   /_next/static/…  the app's code: file names change with every release, so a
 *                    kept copy is always the right one. Kept on first use.
 *   floor pages      the network first, every time; the copy kept from the last
 *                    visit only when the network doesn't answer. A screen opened
 *                    inside the app asks for its page to be kept ('cf-keep').
 *   icons            as before.
 *
 * Lives alongside firebase-messaging-sw.js, which keeps push duty.
 */
const STATIC = 'cf-static-v1';
const CODE = 'cf-code-v1';
const PAGES = 'cf-pages-v1';
const ICONS = ['/icon-192.png', '/icon-512.png', '/apple-touch-icon.png', '/manifest.json'];
const FLOOR = [/^\/host$/, /^\/tables$/, /^\/clear$/, /^\/kds\/[A-Za-z0-9_-]{1,160}$/];
const isFloor = (path) => FLOOR.some((r) => r.test(path));
const WAIT_MS = 6000;

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(STATIC).then((c) => c.addAll(ICONS)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => ![STATIC, CODE, PAGES].includes(k)).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// The oldest code files go once there are too many (a long-lived tablet sees many releases).
async function trim(name, max) {
  const c = await caches.open(name); const keys = await c.keys();
  for (const k of keys.slice(0, Math.max(0, keys.length - max))) await c.delete(k);
}
const pageKey = (url) => new Request(new URL(url).origin + new URL(url).pathname);
// A page of ours as asked for: never one it was sent on to (a sign-in page, say), kept under the floor screen's name.
const isPage = (res) => !!res && res.ok && res.type === 'basic' && !res.redirected && /text\/html/.test(res.headers.get('content-type') || '');

async function keepPage(url) {
  try {
    const res = await fetch(new URL(url).pathname, { credentials: 'same-origin', cache: 'no-store' });
    if (isPage(res)) await (await caches.open(PAGES)).put(pageKey(url), res);
  } catch (_) { /* no connection: kept next time */ }
}

async function floorPage(req) {
  // One request: kept when it answers (even late), waited for when there's no copy to show instead.
  const net = fetch(req).then((res) => {
    if (isPage(res)) { const copy = res.clone(); caches.open(PAGES).then((c) => c.put(pageKey(req.url), copy)).catch(() => {}); }
    return res;
  });
  net.catch(() => {});
  try {
    return await Promise.race([net, new Promise((_, no) => setTimeout(() => no(new Error('slow')), WAIT_MS))]);
  } catch (err) {
    const hit = await caches.open(PAGES).then((c) => c.match(pageKey(req.url)));
    return hit || net;
  }
}

async function codeFile(req) {
  const c = await caches.open(CODE);
  const hit = await c.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res && res.ok && res.type === 'basic') { await c.put(req, res.clone()); trim(CODE, 600).catch(() => {}); }
  return res;
}

self.addEventListener('message', (e) => {
  const d = e.data || {};
  if (d.type === 'cf-keep' && typeof d.url === 'string') {
    try { const u = new URL(d.url, self.location.origin); if (u.origin === self.location.origin && isFloor(u.pathname)) e.waitUntil(keepPage(u.href)); } catch (_) { /* not a page of ours */ }
  }
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (ICONS.includes(url.pathname)) { e.respondWith(caches.match(req).then((hit) => hit || fetch(req))); return; }
  if (url.pathname.startsWith('/api/')) return;
  if (url.pathname.startsWith('/_next/static/')) { e.respondWith(codeFile(req)); return; }
  if (req.mode === 'navigate' && isFloor(url.pathname)) { e.respondWith(floorPage(req)); return; }
  // Everything else passes straight to the network — no interception, no staleness.
});
