/* firebase-messaging-sw.js — v1
 *
 * Service worker that receives pushes when the app tab is closed or in
 * the background. Must live in /public so it serves from the site root.
 *
 * ⚠️ FILL IN THE CONFIG: copy the SAME values your client app already
 * uses — they're the NEXT_PUBLIC_FIREBASE_* values in Vercel (or in
 * src/firebase/config). These are PUBLIC identifiers (they ship in every
 * page load already), so hardcoding them here is standard and safe.
 */

importScripts('https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey: 'PASTE_NEXT_PUBLIC_FIREBASE_API_KEY',
  authDomain: 'PASTE_NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN',
  projectId: 'PASTE_NEXT_PUBLIC_FIREBASE_PROJECT_ID',
  storageBucket: 'PASTE_NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET',
  messagingSenderId: 'PASTE_NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID',
  appId: 'PASTE_NEXT_PUBLIC_FIREBASE_APP_ID',
});

const messaging = firebase.messaging();

// Background messages: the payload's notification block renders
// automatically; this handler covers data-only messages and click-through.
messaging.onBackgroundMessage((payload) => {
  const title = payload?.notification?.title || 'ClarityFlow';
  const body = payload?.notification?.body || '';
  self.registration.showNotification(title, {
    body,
    icon: '/icon-192.png',
    data: { link: payload?.fcmOptions?.link || payload?.data?.link || '/' },
  });
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const link = event.notification?.data?.link || '/';
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((wins) => {
      for (const w of wins) {
        if ('focus' in w) { w.navigate(link); return w.focus(); }
      }
      return clients.openWindow(link);
    }),
  );
});
