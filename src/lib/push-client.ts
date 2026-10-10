'use client';
// src/lib/push-client.ts — TURN ON NOTIFICATIONS FOR THIS PHONE, from a button.
// iPhone only lets a page ask for permission at the exact moment of a tap, so `enablePush` asks FIRST (before any
// waiting), then gets this phone's address from Firebase and saves it through the server (/api/push/register).
import { getApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';

export type PushState = 'on' | 'off' | 'blocked' | 'unsupported' | 'needs_home_screen';

const isIOS = () => typeof navigator !== 'undefined' && /iPad|iPhone|iPod/.test(navigator.userAgent);
const standalone = () => typeof window !== 'undefined' && (window.matchMedia?.('(display-mode: standalone)').matches || (navigator as any).standalone === true);

export function pushState(): PushState {
  if (typeof window === 'undefined') return 'unsupported';
  if (!('Notification' in window) || !('serviceWorker' in navigator)) return isIOS() && !standalone() ? 'needs_home_screen' : 'unsupported';
  if (Notification.permission === 'denied') return 'blocked';
  if (Notification.permission === 'granted' && localStorage.getItem('cf_push_registered') === '1') return 'on';
  return 'off';
}

/** Call DIRECTLY from a button's onClick. Returns the new state and, on failure, a plain reason. */
export async function enablePush(tenantId: string): Promise<{ state: PushState; error?: string }> {
  if (typeof window === 'undefined' || !('Notification' in window)) return { state: pushState() };
  const permission = Notification.permission === 'granted' ? 'granted' : await Notification.requestPermission();   // first, while it's still the tap
  if (permission === 'denied') return { state: 'blocked' };
  if (permission !== 'granted') return { state: 'off' };
  try {
    const vapidKey = process.env.NEXT_PUBLIC_FIREBASE_VAPID_KEY;
    if (!vapidKey) return { state: 'off', error: 'Notifications aren’t set up for this app yet (missing web push key).' };
    const { getMessaging, getToken, isSupported } = await import('firebase/messaging');
    if (!(await isSupported().catch(() => false))) return { state: 'unsupported' };
    const swReg = await navigator.serviceWorker.register('/firebase-messaging-sw.js');
    const token = await getToken(getMessaging(getApp()), { vapidKey, serviceWorkerRegistration: swReg });
    if (!token) return { state: 'off', error: 'This phone didn’t give us an address to send to — try again.' };
    const idToken = await getAuth().currentUser?.getIdToken();
    const r = await fetch('/api/push/register', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}) }, body: JSON.stringify({ tenantId, token }) }).then((x) => x.json()).catch(() => ({ ok: false, error: 'No connection.' }));
    if (!r.ok) return { state: 'off', error: r.error || 'That didn’t save — try again.' };
    try { localStorage.setItem('cf_push_registered', '1'); localStorage.setItem('cf_push_token', token); } catch { /* fine */ }
    return { state: 'on' };
  } catch (e: any) { return { state: 'off', error: String(e?.message || 'That didn’t work — try again.').slice(0, 160) }; }
}

/** "Send me a test" — returns what happened, in plain words. */
export async function sendTestPush(tenantId: string): Promise<{ ok: boolean; text: string }> {
  try {
    const idToken = await getAuth().currentUser?.getIdToken();
    const r = await fetch('/api/push/test', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}) }, body: JSON.stringify({ tenantId }) }).then((x) => x.json());
    if (r.ok) return { ok: true, text: `Sent (${String(r.result).replace(/^sent to /, '')}) — your phone should buzz now.` };
    return { ok: false, text: r.error || r.result || 'That didn’t send.' };
  } catch { return { ok: false, text: 'No connection — try again.' }; }
}

/** On sign-out (call BEFORE signing out): stop this phone getting the person's notifications. Quiet on failure. */
export async function releasePush(tenantId: string): Promise<void> {
  try {
    const token = localStorage.getItem('cf_push_token'); if (!token) return;
    const idToken = await getAuth().currentUser?.getIdToken(); if (!idToken) return;
    await fetch('/api/push/register', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` }, body: JSON.stringify({ tenantId, token, remove: true }) }).catch(() => null);
    localStorage.removeItem('cf_push_registered'); localStorage.removeItem('cf_push_token');
  } catch { /* fine */ }
}
