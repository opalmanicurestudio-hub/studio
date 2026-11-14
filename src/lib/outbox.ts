'use client';
// src/lib/outbox.ts — TAPS KEPT THROUGH A WI-FI DROP (design canvas "When the Wi-Fi drops").
// A floor screen's tap that can't reach the server (no connection, or no answer in time) is kept on this device, in
// order, and sent by itself when the connection's back; the screen carries on as if it went. Only what's safe to send
// late is kept: firing a course, the kitchen's Start, Ready and Allergy noted, clearing a table (adding to a tab and to
// the wait list is kept by the database on the device itself). Changing allergies, comps, voids, payments and seating
// need the connection, and say so.
//   send(url, body, { label, auth, keep, tenantId, maxAgeMs?, hold?, afterWrites? }) → the server's answer, or
//          { ok: true, kept: true } when it was kept. A tap made while others for the same address are still waiting is
//          kept behind them, so taps arrive in the order they were made. `maxAgeMs`: older than this it's no longer
//          right to send (a course fired 20 minutes late, say), so it's listed as not sent instead. `hold`: fields kept
//          only for this browser session, never in lasting storage (a cook's pass on the kitchen screen). `afterWrites`:
//          sent only once this device's saves straight to the database have reached the server (firing a course after
//          adding its items). `stamp`: a field set to when it was tapped, on a kept tap only (the server can then tell a
//          late arrival from a fresh one).
//   flush() → sends what's waiting, oldest first; stops at the first one that still can't get through. One tab at a
//          time (a lock), and a tap kept by one person is only sent signed in as them.
//   landed(save, ms, { label, tenantId }) → a save straight to the database, waited for a few seconds at most (the
//          database keeps it); turned down later, it's listed with what didn't go through.
//   useOutbox(tenantId) → whether the connection is down (and since when), how many taps wait, the ones the server
//          turned down when they arrived (the course was already fired, say), and how many just went.
// Kept in this browser's storage, so a reload (even with no connection) doesn't lose them. Nothing here is read by the
// server or anyone else; a tap older than its limit (2 hours unless the screen says less) is not sent.
import * as React from 'react';
import { getAuth } from 'firebase/auth';
import { getApps } from 'firebase/app';
import { getFirestore, waitForPendingWrites } from 'firebase/firestore';

export type Kept = { id: string; url: string; body: any; label: string; auth: 'user' | 'none'; who: string | null; at: string; tries: number; tenantId: string; afterWrites: boolean; maxAgeMs?: number; held?: string[] };
export type Missed = { id: string; label: string; error: string; at: string; tenantId: string };
export type Sent = { status: number; d: any; kept: boolean };

const KEPT = 'cf.outbox.v1', MISSED = 'cf.outbox.missed.v1', HELD = 'cf.outbox.held.';
export const KEEP_FOR_MS = 2 * 3600000;
const WAIT_MS = 10000;

const read = <T,>(k: string): T[] => { try { const v = JSON.parse(localStorage.getItem(k) || '[]'); return Array.isArray(v) ? v : []; } catch { return []; } };
const write = (k: string, v: any[]) => { try { if (v.length) localStorage.setItem(k, JSON.stringify(v)); else localStorage.removeItem(k); } catch { /* storage full or blocked */ } };
export const keptNow = (): Kept[] => read<Kept>(KEPT);
export const missedNow = (): Missed[] => read<Missed>(MISSED);

// THE CONNECTION, as the floor screens have found it: down when a tap or a refresh couldn't reach the server (or the
// device says it's offline), up again at the next answer.
let downSince: number | null = null; let sentLately = 0; let sentAt = 0;
const subs = new Set<() => void>();
const emit = () => { for (const f of Array.from(subs)) { try { f(); } catch { /* */ } } };
export function noteNetwork(ok: boolean) {
  if (ok) { if (downSince !== null) { downSince = null; emit(); void flush(); } }
  else if (downSince === null) { downSince = Date.now(); sentLately = 0; emit(); }
}
export const connectionDown = () => downSince !== null || (typeof navigator !== 'undefined' && navigator.onLine === false);

// Who's signed in (known on the device even when the sign-in can't be refreshed with no connection), and their pass for
// the server when it can be had.
async function who(): Promise<{ uid: string | null; token: string }> {
  let u: any = null; try { u = getApps().length ? getAuth().currentUser : null; } catch { u = null; }
  let token = ''; try { token = u ? await u.getIdToken() : ''; } catch { token = ''; }
  return { uid: u?.uid || null, token };
}
const ss = { get: (k: string) => { try { return sessionStorage.getItem(k); } catch { return null; } }, set: (k: string, v: string) => { try { sessionStorage.setItem(k, v); } catch { /* */ } }, del: (k: string) => { try { sessionStorage.removeItem(k); } catch { /* */ } } };
/** A kept tap's body as it's sent: with the fields held for this session put back (gone once the session's over). */
function bodyOf(k: Kept): any {
  if (!k.held?.length) return k.body;
  let held: any = {}; try { held = JSON.parse(ss.get(HELD + k.id) || '{}') || {}; } catch { held = {}; }
  return { ...k.body, ...held };
}
async function attempt(url: string, body: any, token: string): Promise<{ status: number; d: any } | null> {
  const ac = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const t = setTimeout(() => ac?.abort(), WAIT_MS);
  try {
    const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body), ...(ac ? { signal: ac.signal } : {}) });
    const d = await r.json().catch(() => ({}));
    return { status: r.status, d };
  } catch { return null; } finally { clearTimeout(t); }
}
const newId = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

/** A tap for the server: sent now, or kept for later when it can't get through (only when `keep`). */
export async function send(url: string, body: any, o: { label: string; auth: 'user' | 'none'; keep: boolean; tenantId: string; afterWrites?: boolean; maxAgeMs?: number; hold?: string[]; stamp?: string }): Promise<Sent> {
  const me = o.auth === 'user' ? await who() : { uid: null, token: '' };
  const keepIt = () => {
    const id = newId(); const hold = (o.hold || []).filter((f) => body && f in body);
    const lasting = { ...body, ...(o.stamp ? { [o.stamp]: new Date().toISOString() } : {}) }; const held: any = {}; for (const f of hold) { held[f] = lasting[f]; delete lasting[f]; }
    if (hold.length) ss.set(HELD + id, JSON.stringify(held));
    const k: Kept = { id, url, body: lasting, label: String(o.label || 'A tap').slice(0, 120), auth: o.auth, who: me.uid, at: new Date().toISOString(), tries: 0, tenantId: o.tenantId, afterWrites: !!o.afterWrites,
      ...(o.maxAgeMs ? { maxAgeMs: o.maxAgeMs } : {}), ...(hold.length ? { held: hold } : {}) };
    write(KEPT, [...keptNow(), k].slice(-200)); emit();
    return { status: 0, d: { ok: true, kept: true }, kept: true };
  };
  // Others for the same place still waiting: this one goes behind them.
  if (o.keep && keptNow().some((k) => k.url === url && k.tenantId === o.tenantId)) { void flush(); return keepIt(); }
  if (o.keep && typeof navigator !== 'undefined' && navigator.onLine === false) { noteNetwork(false); return keepIt(); }
  // Its items still on their way to the server (added a moment ago with a weak connection): it waits behind them.
  if (o.afterWrites && !(await writesSynced(3000))) return o.keep ? keepIt() : { status: 0, d: { ok: false, offline: true, error: 'The items just added are still on their way. Try again in a moment.' }, kept: false };
  const r = await attempt(url, body, me.token);
  if (!r) { noteNetwork(false); return o.keep ? keepIt() : { status: 0, d: { ok: false, offline: true, error: 'No connection. That needs the connection: try again when it’s back.' }, kept: false }; }
  noteNetwork(true);
  return { status: r.status, d: r.d, kept: false };
}

let flushing: Promise<void> | null = null; let again = false;
/** What's waiting, sent oldest first; stops at the first one that still can't get through. Asked again while it runs
 *  (the connection came back mid-way, say): it runs once more straight after. */
export function flush(): Promise<void> {
  if (flushing) { again = true; return flushing; }
  const run = async () => {
    const locks: any = typeof navigator !== 'undefined' ? (navigator as any).locks : null;
    if (locks?.request) await locks.request('cf-outbox', { ifAvailable: true }, async (lock: any) => { if (lock) await drain(); });
    else await drain();
  };
  flushing = run().catch(() => undefined).finally(() => { flushing = null; if (again) { again = false; if (keptNow().length) void flush(); } });
  return flushing;
}
const addMissed = (m: { id: string; label: string; error: string; tenantId: string }) =>
  write(MISSED, [...missedNow(), { ...m, error: String(m.error || 'It didn’t go through.').slice(0, 160), at: new Date().toISOString() }].slice(-20));
const drop = (id: string, miss?: { error: string }) => {
  const all = keptNow(); const k = all.find((x) => x.id === id);
  write(KEPT, all.filter((x) => x.id !== id)); ss.del(HELD + id);
  if (k && miss) addMissed({ id: k.id, label: k.label, error: miss.error, tenantId: k.tenantId });
};
async function drain() {
  let me: { uid: string | null; token: string } | null = null;
  for (let guard = 0; guard < 200; guard++) {
    const all = keptNow(); if (!all.length) break;
    const now = Date.now();
    const old = all.find((k) => now - (Date.parse(k.at) || now) > Math.min(KEEP_FOR_MS, Number(k.maxAgeMs) || KEEP_FOR_MS));
    if (old) { drop(old.id, { error: 'Not sent: it was kept too long to still be right.' }); emit(); continue; }
    if (!me) me = await who();
    // Kept by someone else signed in on this device: it waits for them (never sent as somebody else).
    const k = all.find((x) => x.auth === 'none' || x.who === me!.uid); if (!k) break;
    // A course fired after items were added with no connection: the items reach the server first.
    if (k.afterWrites) { const synced = await writesSynced(); if (!synced) { noteNetwork(false); break; } }
    const r = await attempt(k.url, bodyOf(k), k.auth === 'user' ? me.token : '');
    if (!r) { noteNetwork(false); break; }
    noteNetwork(true);
    if (r.status >= 500) {
      const tries = k.tries + 1;
      if (tries >= 5) drop(k.id, { error: r.d?.error || 'The server couldn’t take it.' });
      else { write(KEPT, keptNow().map((x) => (x.id === k.id ? { ...x, tries } : x))); emit(); break; }
    } else if (r.d && r.d.ok === false) drop(k.id, { error: r.d.error || 'It didn’t go through.' });
    else { drop(k.id); sentLately += 1; sentAt = Date.now(); }
    emit();
  }
}
async function writesSynced(ms = 15000): Promise<boolean> {
  try {
    if (!getApps().length) return true;
    return await Promise.race([waitForPendingWrites(getFirestore()).then(() => true), new Promise<boolean>((res) => setTimeout(() => res(false), ms))]);
  } catch { return true; }
}

/** A save straight to the database (kept on the device by the database itself with no connection, and sent when it's
 *  back): waited for a few seconds at most, so a screen with no connection carries on instead of spinning. A save the
 *  database turns down at once still throws; one turned down later is listed with what didn't go through. */
export function landed<T>(p: Promise<T>, ms = 4000, o?: { label: string; tenantId: string }): Promise<T | undefined> {
  let late = false;
  p.catch((e: any) => { if (late && o) { addMissed({ id: newId(), label: o.label, error: `It didn’t save${e?.code === 'permission-denied' ? ': not allowed' : ''}.`, tenantId: o.tenantId }); emit(); } });
  return Promise.race([p, new Promise<undefined>((res) => setTimeout(() => { late = true; res(undefined); }, ms))]);
}

/** Turned down when they arrived, cleared once read. */
export function dismissMissed(tenantId: string) { write(MISSED, missedNow().filter((m) => m.tenantId !== tenantId)); emit(); }

// Sending by itself: when the device says it's back, when the screen is looked at again, and every 15 seconds while
// anything waits. Started once, by the first screen that uses it.
let driving = false;
/** Sending by itself on any page (the app's frame starts it when taps are waiting from before a reload). */
export const startOutbox = () => drive();
function drive() {
  if (driving || typeof window === 'undefined') return; driving = true;
  window.addEventListener('online', () => { void flush(); });
  window.addEventListener('offline', () => noteNetwork(false));
  window.addEventListener('storage', (e) => { if (e.key === KEPT || e.key === MISSED) emit(); });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && keptNow().length) void flush(); });
  setInterval(() => { if (keptNow().length) void flush(); }, 15000);
  if (keptNow().length) void flush();
}

export type OutboxState = { down: boolean; since: number | null; waiting: number; missed: Missed[]; sent: number };
export function outboxState(tenantId: string): OutboxState {
  const on = typeof navigator === 'undefined' || navigator.onLine !== false;
  return { down: downSince !== null || !on, since: downSince, waiting: keptNow().filter((k) => k.tenantId === tenantId).length,
    missed: missedNow().filter((m) => m.tenantId === tenantId), sent: Date.now() - sentAt < 8000 ? sentLately : 0 };
}
export function useOutbox(tenantId: string): OutboxState {
  const [, tick] = React.useReducer((x: number) => x + 1, 0);
  React.useEffect(() => { drive(); subs.add(tick); const i = setInterval(tick, 4000); return () => { subs.delete(tick); clearInterval(i); }; }, []);
  return outboxState(tenantId);
}
