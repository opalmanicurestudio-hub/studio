/* firebase-messaging-sw.js — v2. Shows every phone notification the app sends.
 *
 * Firebase Cloud Messaging delivers standard Web Push messages; this handles them directly, so no Firebase settings
 * are needed here (v1 needed config pasted in and never had it, so every push arrived and nothing was shown — and
 * iPhone cancels the registration of a site whose pushes never show anything).
 * Every push shows a notification — whether the app is open or closed. Tapping it opens the page it's about.
 */
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  let p = {};
  try { p = event.data ? event.data.json() : {}; } catch (e) { p = { notification: { body: event.data ? event.data.text() : '' } }; }
  // FCM wraps its fields a few different ways depending on the sender — accept them all.
  const n = p.notification || (p.data && p.data.notification) || {};
  const title = n.title || (p.data && p.data.title) || 'New notification';
  const body = n.body || (p.data && p.data.body) || '';
  const link = (p.fcmOptions && p.fcmOptions.link) || (p.webpush && p.webpush.fcmOptions && p.webpush.fcmOptions.link) || (p.data && p.data.link) || n.click_action || '/';
  event.waitUntil(self.registration.showNotification(title, {
    body,
    icon: n.icon || '/icon-192.png',
    badge: '/icon-192.png',
    tag: p.fcmMessageId || undefined,
    data: { link },
  }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const link = (event.notification && event.notification.data && event.notification.data.link) || '/';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((wins) => {
      for (const w of wins) { if ('focus' in w) { try { w.navigate(link); } catch (e) {} return w.focus(); } }
      return self.clients.openWindow(link);
    }),
  );
});
