'use client';
// src/lib/last-seen.ts — WHAT A FLOOR SCREEN LAST HAD (design canvas "When the Wi-Fi drops"). A screen that opens, or
// reloads, with no connection shows what it last had on this device rather than nothing, and says how old it is
// (components/shared/ConnectionBar). Never used while the server answers: a fresh answer always replaces it.
// Kept in this browser's storage for 12 hours at most, written at most every 15 seconds a screen, and only for the
// person signed in (a shared tablet's next person never sees it): signing out clears theirs. A paired kitchen screen,
// signed in as nobody, keeps its own.
import { getAuth, onAuthStateChanged } from 'firebase/auth';
import { getApps } from 'firebase/app';

export const LAST_FOR_MS = 12 * 3600000;
const wrote = new Map<string, number>();
const whoNow = (): string => { try { return (getApps().length && getAuth().currentUser?.uid) || 'screen'; } catch { return 'screen'; } };
// A paired kitchen screen keeps its own, whoever happens to be signed in on its browser.
const full = (key: string, screen = false) => `cf.last.${screen ? 'screen' : whoNow()}.${key}`;

/** Everything kept for this person, gone (they signed out). */
export function forgetAllFor(uid: string) {
  try { const out: string[] = []; for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k && k.startsWith(`cf.last.${uid}.`)) out.push(k); } for (const k of out) localStorage.removeItem(k); } catch { /* */ }
}
let watching = false;
/** Signing out clears what was kept for that person (started by the app's frame when anything is kept). */
export const watchSignOut = () => watch();
function watch() {
  if (watching) return; watching = true;
  try { if (!getApps().length) return; let was: string | null = null;
    onAuthStateChanged(getAuth(), (u) => { if (!u && was) forgetAllFor(was); was = u?.uid || null; }); } catch { /* no sign-in here */ }
}

export function keepLast(key: string, data: any, o?: { screen?: boolean }) {
  watch();
  const now = Date.now(); const k = full(key, !!o?.screen); if (now - (wrote.get(k) || 0) < 15000) return;
  wrote.set(k, now);
  try { localStorage.setItem(k, JSON.stringify({ at: now, data })); } catch { /* storage full or blocked */ }
}
export function lastOf<T = any>(key: string, o?: { screen?: boolean }): { at: number; data: T } | null {
  watch();
  try {
    const v = JSON.parse(localStorage.getItem(full(key, !!o?.screen)) || 'null');
    if (!v || !Number.isFinite(v.at) || Date.now() - v.at > LAST_FOR_MS) return null;
    return { at: v.at, data: v.data as T };
  } catch { return null; }
}
export function forgetLast(key: string) { const k = full(key); wrote.delete(k); try { localStorage.removeItem(k); } catch { /* */ } }
