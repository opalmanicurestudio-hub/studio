// src/lib/stale-sweep.ts — NOTHING STAYS "OPEN" AFTER ITS TIME HAS PASSED. Run nightly (cron/nightly), per business.
//   • VISITS LEFT OPEN: a booking still booked / arrived / in service once its day is over (ready-to-pay: once the day
//     after is over) is closed as `expired` with `closedReason: 'left_open'` and what it was (`statusBefore`), so it
//     leaves every live list. Nothing is guessed: it lands in "Left open" for the owner to settle — they came and pay,
//     no-show, cancelled, or just clear it. No fees, no messages to the client.
//   • SHIFT REQUESTS for a day that's gone (time off, swaps, cover still waiting) → `expired`, with their day-off holds.
//   • ONLINE BOOKING REQUESTS still pending after their time, or two days old → `expired`.
//   • CALLS still open after 7 days → closed by the system (the call log keeps them).
//   • NOTIFICATIONS past their own expiry → resolved (their buttons stop showing).
// A business can switch the visit close-out off with tenant.autoCloseOut === false.
import { stageOf } from '@/lib/visit';
import { localDay } from '@/lib/timeclock';

const OPEN = ['booked', 'arrived', 'waiting', 'in_service', 'ready_to_pay'];
const DAY = 86400000;
const endMs = (a: any) => { const e = Date.parse(String(a?.endTime || '')); if (Number.isFinite(e)) return e; const s = Date.parse(String(a?.startTime || '')); return Number.isFinite(s) ? s + (Number(a?.duration) || 60) * 60000 : NaN; };

async function commitInChunks(db: any, writes: ((b: any) => void)[]) {
  for (let i = 0; i < writes.length; i += 400) { const b = db.batch(); writes.slice(i, i + 400).forEach((w) => w(b)); await b.commit(); }
}

/** Which open visits should be closed as left open, given today's local date in the business. Pure, for tests. */
export function leftOpen(apts: any[], today: string, timeZone: string): any[] {
  const yesterday = (() => { const [y, m, d] = today.split('-').map(Number); const t = new Date(Date.UTC(y, m - 1, d) - DAY); return t.toISOString().slice(0, 10); })();
  return apts.filter((a) => {
    if (a?.isTable) return false;
    const st = stageOf(a); if (!OPEN.includes(st)) return false;
    const e = endMs(a); if (!Number.isFinite(e)) return false;
    const day = localDay(e, timeZone);
    return st === 'ready_to_pay' ? day < yesterday : day < today;
  });
}

export async function sweepStale(db: any, tenantId: string, tenant: any, now = Date.now()) {
  const T = `tenants/${tenantId}`; const tz = tenant?.timezone || 'America/New_York'; const iso = new Date(now).toISOString();
  const today = localDay(now, tz); const out = { visits: 0, shiftRequests: 0, bookingRequests: 0, calls: 0, notifications: 0 };
  const writes: ((b: any) => void)[] = [];

  // 1) Visits left open — the last 180 days (one-field range on startTime; the rest is checked here).
  if (tenant?.autoCloseOut !== false) {
    const snap = await db.collection(`${T}/appointments`).where('startTime', '>=', new Date(now - 180 * DAY).toISOString()).where('startTime', '<', new Date(now).toISOString()).get();
    const docs = new Map<string, any>(snap.docs.map((d: any) => [d.id, d]));
    for (const a of leftOpen(snap.docs.map((d: any) => ({ id: d.id, ...(d.data() || {}) })), today, tz)) {
      const ref = docs.get(a.id).ref;
      writes.push((b) => b.set(ref, { status: 'expired', closedReason: 'left_open', statusBefore: a.status || 'confirmed', closedAt: iso, closedBy: 'system',
        timeline: [...(Array.isArray(a.timeline) ? a.timeline : []), { at: iso, kind: 'note', text: 'Closed overnight — this visit was never finished or checked out. Settle it under “Left open”.', by: 'System', via: 'close-out' }].slice(-60) }, { merge: true }));
      if (a.checkInToken) writes.push((b) => b.set(db.doc(`appointmentCheckIns/${a.checkInToken}`), { status: 'expired', tenantId }, { merge: true }));
      out.visits++;
    }
  }

  // 2) Shift requests whose day has gone.
  for (const st of ['pending', 'pending_swap_consent', 'swap_consent_given']) {
    const snap = await db.collection(`${T}/shiftRequests`).where('status', '==', st).get();
    for (const d of snap.docs) { const r: any = d.data() || {}; if (!r.date || String(r.date) >= today) continue;
      writes.push((b) => b.update(d.ref, { status: 'expired', resolvedAt: iso, managerNote: r.managerNote || 'The day passed before this was decided.' })); out.shiftRequests++; }
  }
  const blocks = await db.collection(`${T}/shiftDayOffBlocks`).where('status', '==', 'pending').get();
  for (const d of blocks.docs) { const r: any = d.data() || {}; if (r.date && String(r.date) < today) writes.push((b) => b.update(d.ref, { status: 'expired' })); }

  // 3) Online booking requests left pending.
  const brs = await db.collection(`${T}/bookingRequests`).where('status', '==', 'pending').get();
  for (const d of brs.docs) { const r: any = d.data() || {};
    const start = Date.parse(String(r.startTime || r.requestedStartTime || r.slotStart || '')); const made = Date.parse(String(r.createdAt || ''));
    if ((Number.isFinite(start) && start < now) || (Number.isFinite(made) && now - made > 2 * DAY)) { writes.push((b) => b.update(d.ref, { status: 'expired', expiredAt: iso })); out.bookingRequests++; } }

  // 4) Calls nobody closed.
  const calls = await db.collection(`${T}/calls`).where('status', '==', 'open').get();
  for (const d of calls.docs) { const c: any = d.data() || {}; const at = Date.parse(String(c.createdAt || c.at || ''));
    if (Number.isFinite(at) && now - at > 7 * DAY) { writes.push((b) => b.update(d.ref, { status: 'resolved', resolvedAt: iso, resolvedBy: 'System', resolution: 'Closed automatically after 7 days with no action' })); out.calls++; } }

  // 5) Notifications past their own expiry.
  const notes = await db.collection(`${T}/notifications`).where('expiresAt', '<', iso).limit(500).get();
  for (const d of notes.docs) { if ((d.data() as any)?.resolved === true) continue; writes.push((b) => b.update(d.ref, { resolved: true, resolvedAt: iso })); out.notifications++; }

  await commitInChunks(db, writes);
  return out;
}
