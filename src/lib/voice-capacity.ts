// src/lib/voice-capacity.ts — THE SHARED VOICE ACCOUNT'S CALLS AT ONCE (design canvas "Voice calls on HQ System").
// Every business's phone answering and drive-thru assistant run on one voice service account, which takes so many calls
// at once (20 to start). HQ → System shows how close it is: calls now against the limit (asked of the voice service
// itself, so it counts every call), how many are at drive-thrus now, and how many calls were turned away this week
// because the account was full (counted here whenever a call we start can't, platformHealth/voice_capacity).
import { getAdminDb } from '@/lib/firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';

const URL_CONCURRENCY = 'https://api.retellai.com/get-concurrency';
export const NEAR_SHARE = 0.8;
export type Concurrency = { now: number; limit: number; base: number; bought: number; burst: boolean; burstLimit: number };
export type VoiceLevel = 'ok' | 'near' | 'full';

const int = (v: unknown) => { const n = Math.floor(Number(v)); return Number.isFinite(n) && n >= 0 ? n : 0; };
/** The voice service's own answer, as numbers; null when it can't be read. */
export function readConcurrency(d: any): Concurrency | null {
  if (!d || typeof d !== 'object' || !Number.isFinite(Number(d.current_concurrency)) || !Number.isFinite(Number(d.concurrency_limit))) return null;
  return { now: int(d.current_concurrency), limit: int(d.concurrency_limit), base: int(d.base_concurrency), bought: int(d.purchased_concurrency),
    burst: d.concurrency_burst_enabled === true, burstLimit: int(d.concurrency_burst_limit) };
}
/** Near the limit from 80%; full at it. */
export const voiceLevel = (now: number, limit: number): VoiceLevel => (limit > 0 && now >= limit ? 'full' : limit > 0 && now >= Math.ceil(limit * NEAR_SHARE) ? 'near' : 'ok');

/** Calls now and the limit, from the voice service (never waits more than a few seconds); null when it isn't set up or
 *  doesn't answer. */
export async function concurrencyNow(fetchImpl: typeof fetch = fetch): Promise<Concurrency | null> {
  const key = process.env.RETELL_API_KEY; if (!key) return null;
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 4000);
  try {
    const r = await fetchImpl(URL_CONCURRENCY, { method: 'GET', headers: { Authorization: `Bearer ${key}` }, signal: ctl.signal });
    if (!r.ok) return null;
    return readConcurrency(await r.json().catch(() => null));
  } catch { return null; } finally { clearTimeout(t); }
}

/** Whether the voice service refused a call because the account is full (too many calls at once): its message says so,
 *  or a 429 with no message (a 429 that says something else is a limit on requests, not on calls). */
export const refusedAsFull = (status: number, message: unknown): boolean => /concurren/i.test(String(message || '')) || (status === 429 && !String(message || '').trim());

const dayOf = (ms: number) => new Date(ms).toISOString().slice(0, 10);
/** A call we tried to start was turned away because the account was full: counted by day, one add each (many at once in
 *  a rush never hold each other up; days older than two weeks are let go when HQ reads it). Never throws. */
export async function noteTurnedAway(kind: 'drive-thru' | 'phone', db: any = null, now = Date.now()): Promise<void> {
  try {
    const d = db || getAdminDb();
    await d.doc('platformHealth/voice_capacity').set({ byDay: { [dayOf(now)]: FieldValue.increment(1) }, lastAt: new Date(now).toISOString(), lastKind: kind }, { merge: true });
  } catch (e: any) { console.error('[voice-capacity] not counted', e?.message || e); }
}

/** What HQ shows: calls now against the limit, the drive-thru calls live now, and calls turned away in the last 7 days. */
export async function voiceCapacityView(db: any, o: { now?: number; fetchImpl?: typeof fetch } = {}) {
  const now = o.now ?? Date.now();
  const since = new Date(now - 30 * 60000).toISOString(); const week = dayOf(now - 6 * 86400000);
  // (The calls started in the last half hour, so one that never said it ended stops counting then; on the line while
  // the assistant or someone taking over is on it.)
  const [c, recent, health] = await Promise.all([
    concurrencyNow(o.fetchImpl),
    db.collection('driveThruCalls').where('startedAt', '>=', since).limit(1000).get().catch(() => null),
    db.doc('platformHealth/voice_capacity').get().catch(() => null),
  ]);
  const atDriveThrus = recent ? recent.docs.map((d: any) => d.data() || {}).filter((x: any) => x.status === 'live' || x.status === 'taking_over').length : null;
  const h: any = health?.data?.() || {};
  const turnedAway = Object.entries<any>(h.byDay || {}).filter(([k]) => k >= week).reduce((n, [, v]) => n + int(v), 0);
  // Days older than two weeks let go (best effort).
  const old = Object.keys(h.byDay || {}).filter((k) => k < dayOf(now - 14 * 86400000));
  if (old.length) await db.doc('platformHealth/voice_capacity').set({ byDay: Object.fromEntries(old.map((k) => [k, FieldValue.delete()])) }, { merge: true }).catch(() => undefined);
  return { setUp: !!process.env.RETELL_API_KEY, read: !!c, ...(c ? { now: c.now, limit: c.limit, base: c.base, bought: c.bought, burst: c.burst, burstLimit: c.burstLimit, level: voiceLevel(c.now, c.limit) } : {}),
    atDriveThrus, turnedAway, lastTurnedAway: h.lastAt || null, checkedAt: new Date(now).toISOString() };
}
