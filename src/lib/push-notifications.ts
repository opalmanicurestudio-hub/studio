/**
 * push-notifications — v1
 *
 * Client-side half of real push. Registers THIS device for push and files
 * the token under the PIN-verified staff member's doc (fcmTokens array) —
 * NOT the shared Firebase login — so pushes reach the person, matching
 * the same identity model as everything else in messaging.
 *
 * Requires:
 *   - public/firebase-messaging-sw.js deployed (the service worker)
 *   - NEXT_PUBLIC_FIREBASE_VAPID_KEY set in Vercel (Firebase Console →
 *     Project Settings → Cloud Messaging → Web Push certificates →
 *     "Generate key pair", copy the key)
 *
 * HONEST PLATFORM LIMITS:
 *   - iPhone: web push only works if the portal has been added to the
 *     Home Screen (iOS 16.4+). In Safari-the-browser, this no-ops
 *     silently. Tell your techs: Share → Add to Home Screen, open it
 *     from there once, and pushes work from then on.
 *   - Everything here is fail-quiet by design: a denied permission or
 *     unsupported browser must never break PIN sign-in.
 */

import { getApp } from 'firebase/app';
import { getMessaging, getToken, isSupported } from 'firebase/messaging';
import { doc, setDoc, arrayUnion, type Firestore } from 'firebase/firestore';

export async function registerPushForStaff(
  firestore: Firestore,
  tenantId: string,
  staffId: string,
): Promise<boolean> {
  try {
    if (typeof window === 'undefined') return false;
    if (!(await isSupported().catch(() => false))) return false;
    if (!('Notification' in window)) return false;

    const permission = Notification.permission === 'granted'
      ? 'granted'
      : await Notification.requestPermission();
    if (permission !== 'granted') return false;

    const vapidKey = process.env.NEXT_PUBLIC_FIREBASE_VAPID_KEY;
    if (!vapidKey) {
      console.warn('[push] NEXT_PUBLIC_FIREBASE_VAPID_KEY not set — push disabled');
      return false;
    }

    const swReg = await navigator.serviceWorker.register('/firebase-messaging-sw.js');
    const messaging = getMessaging(getApp());
    const token = await getToken(messaging, { vapidKey, serviceWorkerRegistration: swReg });
    if (!token) return false;

    await setDoc(
      doc(firestore, `tenants/${tenantId}/staff`, staffId),
      { fcmTokens: arrayUnion(token) },
      { merge: true },
    );
    return true;
  } catch (e) {
    console.warn('[push] registration failed (non-fatal):', e);
    return false;
  }
}
