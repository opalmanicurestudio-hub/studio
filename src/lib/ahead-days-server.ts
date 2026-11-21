// src/lib/ahead-days-server.ts — ORDERS FOR ANOTHER DAY (server; lib/ahead-days has the rules; design board "Orders for
// another day"). Placed and paid in lib/counter-ahead; here:
// - On its day: a couple of hours before its time it goes to the kitchen screen (lib/counter-server sendOrder), waiting
//   under Later until it's time to start; a delivery joins the drivers' list. Something that can't be made then (sold out,
//   a count too low) keeps it here, the managers are told once, and it's tried again every few minutes until it goes
//   (the payments cron, every five minutes), or the counter taps Send it now or cancels it. Each waiting order carries
//   `later.due` (when it goes) until it's sent or closed, so the sweep reads the ones due, soonest first, however many
//   are booked further ahead.
// - Canceled (the guest on their page until the notice runs out, a manager at the counter until it goes to the kitchen):
//   every line back to the card in one step (lib/food-delivery-settle-server giveBack, each line once), the order closed
//   and its pickup code freed. Canceled by the business, the guest gets a text.
// - Coming up, on the counter: the orders waiting for their day, soonest first.
// - The guest's number is cleared the morning after its day (`later.wipeAfter`).
import { sendOrder } from '@/lib/counter-server';
import { isLater, releaseAt, startsAt, dayWords } from '@/lib/ahead-days';
import { backLines, addressLine } from '@/lib/food-delivery';
import { tenantTimeZone, todayIn } from '@/lib/tenant-time';
import { tonight } from '@/lib/night-close-server';

const ID = /^[A-Za-z0-9_-]{1,160}$/;
type Fail = { ok: false; error: string; status: number };
const fail = (error: string, status: number): Fail => ({ ok: false, error, status });
const num = (v: any) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const money = (c: number) => `$${(c / 100).toFixed(2)}`;
/** A cancel being carried out holds the order this long (a second tap is told to wait). */
const BUSY_MS = 2 * 60000;

const clockIn = (iso: string, tz: string) => { try { return new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: tz }); } catch { return ''; } };

async function forget(tenantId: string) {
  comingCache.delete(tenantId);
  try { (await import('@/lib/counter-ahead')).aheadChanged(tenantId); } catch { /* read again soon anyway */ }
  try { (await import('@/lib/food-delivery-server')).forgetDeliveries(tenantId); } catch { /* read again soon anyway */ }
}

/** One order for another day to the kitchen now (its time to start kept: under Later until then). Not made (something
 *  sold out, a count too low): why is kept for the counter, the managers are told once, and it's tried again. */
export async function releaseOne(db: any, tenantId: string, tenant: any, orderId: string, who: { id: string | null; name: string } = { id: null, name: 'Ordered ahead' }, nowMs = Date.now()): Promise<{ ok: true; already?: boolean; number: string } | Fail> {
  if (!ID.test(orderId)) return fail('Which order?', 400);
  const ref = db.doc(`tenants/${tenantId}/counterOrders/${orderId}`);
  const o: any = (await ref.get()).data();
  if (!o || o.channel !== 'ahead' || !isLater(o)) return fail('That order isn’t here.', 404);
  const number = String(o.number || '');
  if (o.status === 'sent' || o.status === 'done') return { ok: true, already: true, number };
  if (o.status !== 'scheduled') return fail('That order was closed.', 409);
  if (!o.paidAt) return fail('That order isn’t paid.', 409);
  if (o.ahead.later?.cancel) return fail('That order is being canceled.', 409);
  const at = Date.parse(String(o.ahead.at || '')); if (!Number.isFinite(at)) return fail('That order has no time.', 409);
  const start = startsAt(at, Array.isArray(o.lines) ? o.lines : []); const nowIso = new Date(nowMs).toISOString();
  const sent: any = await sendOrder(db, tenantId, tenant, orderId, who, { due: new Date(at).toISOString(), holdUntil: start > nowMs ? new Date(start).toISOString() : null });
  if (sent.ok) {
    // (Sent, or closed in the meantime: read again, so a cancel that won is never taken for sent.)
    const cur: any = (await ref.get()).data() || {};
    if (cur.status !== 'sent' && cur.status !== 'done') return fail('That order was closed.', 409);
    await ref.set({ ahead: { later: { sentAt: nowIso, sentBy: who.name, release: null, due: null } } }, { merge: true });
    await forget(tenantId);
    return { ok: true, number };
  }
  const why = String(sent.error || 'It couldn’t go to the kitchen.').slice(0, 200);
  const was = o.ahead.later?.release || {};
  // (Tried again in five minutes: to the back of the sweep's list meanwhile, so one that keeps failing never holds up the rest.)
  await ref.set({ ahead: { later: { release: { failedAt: was.failedAt || nowIso, lastAt: nowIso, why, toldAt: was.toldAt || null }, due: new Date(nowMs + 5 * 60000).toISOString() } } }, { merge: true });
  if (!was.toldAt) {
    const { tellManagers } = await import('@/lib/tell-managers');
    const n = await tellManagers(db, tenantId, tenant, { type: 'ahead_later_failed', link: '/counter', priority: 'high',
      message: `Order ${number} for ${dayWords(String(o.ahead.forDay))} at ${clockIn(o.ahead.at, tenantTimeZone(tenant))} couldn’t go to the kitchen: ${why} Fix that, and it goes by itself in a few minutes, or tap Send it now under Coming up on the counter. You can cancel it there too.` });
    if (n > 0) await ref.set({ ahead: { later: { release: { toldAt: nowIso } } } }, { merge: true });
  }
  await forget(tenantId);
  return fail(why, sent.status === 409 || sent.status === 400 ? 409 : sent.status || 500);
}

/** The payments cron, every few minutes: each order for another day whose time has come goes to the kitchen (the ones
 *  due, soonest first); the guest's number is cleared the morning after its day. */
export async function releaseDue(db: any, tenantId: string, tenant: any, nowMs = Date.now()): Promise<{ sent: number; failed: number; wiped: number }> {
  const out = { sent: 0, failed: 0, wiped: 0 }; const T = `tenants/${tenantId}`; const nowIso = new Date(nowMs).toISOString();
  const snap = await db.collection(`${T}/counterOrders`).where('ahead.later.due', '<=', nowIso).orderBy('ahead.later.due').limit(60).get().catch(() => ({ docs: [] as any[] }));
  for (const d of snap.docs) {
    const o: any = d.data() || {};
    // (Not waiting any more, sent or closed some other way: off the list.)
    if (o.status !== 'scheduled' && o.status !== 'building') { await d.ref.set({ ahead: { later: { due: null } } }, { merge: true }).catch(() => null); continue; }
    // (A cancel under way, or not paid yet: looked at again in a quarter hour.)
    if (o.status !== 'scheduled' || !o.paidAt || o.channel !== 'ahead' || !isLater(o) || o.ahead?.later?.cancel) { await d.ref.set({ ahead: { later: { due: new Date(nowMs + 15 * 60000).toISOString() } } }, { merge: true }).catch(() => null); continue; }
    const r = await releaseOne(db, tenantId, tenant, d.id, undefined, nowMs).catch(() => null);
    if (r?.ok) out.sent++; else out.failed++;
  }
  const held = await db.collection(`${T}/counterOrders`).where('ahead.later.wipeAfter', '<=', nowIso).orderBy('ahead.later.wipeAfter').limit(60).get().catch(() => ({ docs: [] as any[] }));
  for (const d of held.docs) {
    const o: any = d.data() || {};
    // (Still waiting for the kitchen, past its day: kept, so the business can reach them.)
    if (o.status === 'scheduled' || o.status === 'building') { await d.ref.set({ ahead: { later: { wipeAfter: new Date(nowMs + 6 * 3600000).toISOString() } } }, { merge: true }).catch(() => null); continue; }
    await d.ref.set({ ahead: { later: { phone: null, wipeAfter: null } } }, { merge: true }).catch(() => null); out.wiped++;
  }
  return out;
}

export type Canceled = { ok: true; already?: boolean; cents: number; number: string };
/** Cancel an order for another day and give every line back to the card. `who.guest`: from their page (only until the
 *  notice runs out); otherwise a manager at the counter (until it goes to the kitchen). A refund that didn't all go is
 *  finished by asking again, from where it stopped. */
export async function cancelLater(db: any, tenantId: string, tenant: any, orderId: string, who: { by: string; guest: boolean }, nowMs = Date.now()): Promise<Canceled | Fail> {
  if (!ID.test(orderId)) return fail('Which order?', 400);
  const ref = db.doc(`tenants/${tenantId}/counterOrders/${orderId}`);
  const nowIso = new Date(nowMs).toISOString(); const by = String(who.by || 'Someone').slice(0, 60);
  const claim: any = await db.runTransaction(async (tx: any) => {
    const o: any = (await tx.get(ref)).data();
    if (!o || o.channel !== 'ahead' || !isLater(o)) return fail('That order isn’t here.', 404);
    const L = o.ahead.later || {}; const number = String(o.number || '');
    // Asked again (an answer lost, a second tap): as it was.
    if (L.canceledAt) return { already: true, cents: Math.round(num(L.backCents)), number };
    if (!o.paidAt) return fail('That order isn’t paid.', 409);
    if (o.status !== 'scheduled') return fail(o.status === 'voided' ? 'That order was closed.' : 'It’s with the kitchen already, so it can’t be canceled here.', 409);
    const c = L.cancel || null;
    if (c?.at && nowMs - (Date.parse(String(c.at)) || 0) < BUSY_MS) return fail('That’s being done now. Give it a moment.', 409);
    // (The guest only until the notice runs out; a refund already started is finished either way.)
    if (who.guest && !c && !(nowMs < (Date.parse(String(L.cancelBy || '')) || 0))) return fail('The time to cancel for a refund has passed.', 409);
    tx.set(ref, { ahead: { later: { cancel: { at: nowIso, by, guest: who.guest, left: Array.isArray(c?.left) ? c.left : null } } } }, { merge: true });
    return { number, lines: Array.isArray(c?.left) && c.left.length ? c.left : backLines(orderId, 'refund', true), prior: Math.round(num(L.backCents)), o };
  });
  if (claim.ok === false) return claim;
  if (claim.already) return { ok: true, already: true, cents: claim.cents, number: claim.number };
  const o = claim.o; const tz = tenantTimeZone(tenant);
  const when = `${dayWords(String(o.ahead.forDay))} at ${clockIn(o.ahead.at, tz)}`;
  const { giveBack } = await import('@/lib/food-delivery-settle-server');
  const back = await giveBack(db, tenantId, tenant, claim.lines, by, `Canceled in time, order ${claim.number} for ${when}`);
  const cents = claim.prior + back.cents;
  if (back.left.length) {
    await ref.set({ ahead: { later: { cancel: { at: null, left: back.left, error: String(back.error || '').slice(0, 200) }, backCents: cents } } }, { merge: true });
    await forget(tenantId);
    return fail(`${back.cents ? `${money(back.cents)} went back, but not all of it. ` : ''}${back.error || 'The card refund didn’t go through.'} Try again.`, 502);
  }
  // Closed: off the kitchen's way for good, its pickup code free again, and the guest's number and the note for the
  // driver (a gate code) gone. Every line went back: the whole of what was paid.
  const all = Math.round(num(o.total) * 100);
  await ref.set({ status: 'voided', voidedAt: nowIso, voidReason: who.guest ? 'Canceled by the guest' : `Canceled by ${by}`, refundedAt: nowIso, refundedCents: all,
    ahead: { state: 'canceled', later: { cancel: null, canceledAt: nowIso, canceledBy: who.guest ? 'guest' : by, backCents: all, due: null, phone: null, wipeAfter: null }, ...(o.ahead.delivery ? { delivery: { note: null, phone: null } } : {}) },
    ...(o.readyText?.to ? { readyText: { to: null, pendingSince: null } } : {}) }, { merge: true });
  if (o.ahead.code && o.day) await db.doc(`tenants/${tenantId}/aheadCodes/${o.day}_${o.ahead.code}`).delete().catch(() => null);
  await forget(tenantId);
  // Canceled by the business: the guest hears (on their page they see it at once).
  const to = /^\d{10}$/.test(String(o.ahead.later?.phone || '')) ? String(o.ahead.later.phone) : /^\d{10}$/.test(String(o.ahead.delivery?.phone || '')) ? String(o.ahead.delivery.phone) : null;
  if (!who.guest && to) {
    const words = `Order ${claim.number} for ${when} was canceled. ${money(all)} is on its way back to your card. It can take a few days to show.`;
    try { const { sendTenantSms } = await import('@/lib/sms'); await sendTenantSms(db, tenantId, to, words, undefined, { kind: 'ahead_later_canceled', recipientType: 'other', skipMessageLog: true, forget: true, logBody: words } as any); } catch { /* their page says so */ }
  }
  return { ok: true, cents: all, number: claim.number };
}

export type ComingUpRow = { orderId: string; number: string; name: string | null; day: string; locationId: string | null; at: string; way: string; people: number | null; items: number; total: number;
  to: string | null; startsAt: string; releaseAt: string; phone: string | null; cancelBy: string | null; failed: string | null; stuck: string | null; today: boolean };
/** The counter's Coming up: orders for another day still waiting (paid, not yet sent to the kitchen), soonest first.
 *  Read at most every 20 seconds per business, however many counters poll. */
const comingCache = new Map<string, { at: number; rows: ComingUpRow[] }>();
export async function comingUp(db: any, tenantId: string, tenant: any, nowMs = Date.now()): Promise<ComingUpRow[]> {
  const c = comingCache.get(tenantId); if (c && nowMs - c.at < 20000) return c.rows;
  const today = todayIn(tenantTimeZone(tenant), new Date(nowMs));
  // (Soonest to go first, so the nearest are never left out by ones booked further ahead.)
  const snap = await db.collection(`tenants/${tenantId}/counterOrders`).where('ahead.later.due', '>', '').orderBy('ahead.later.due').limit(80).get();
  const rows: ComingUpRow[] = snap.docs.map((d: any) => ({ id: d.id, ...(d.data() || {}) }))
    .filter((o: any) => o.status === 'scheduled' && o.paidAt && o.channel === 'ahead' && isLater(o) && Number.isFinite(Date.parse(String(o.ahead.at || ''))))
    .map((o: any) => { const at = Date.parse(String(o.ahead.at)); const lines = Array.isArray(o.lines) ? o.lines : []; const L = o.ahead.later || {};
      return { orderId: o.id, number: String(o.number || ''), name: o.guestName || null, day: String(o.ahead.forDay), locationId: o.locationId ? String(o.locationId) : null, at: new Date(at).toISOString(), way: String(o.ahead.way || 'inside'),
        people: Number(L.people) || null, items: lines.reduce((n: number, l: any) => n + Math.max(1, Math.round(num(l.quantity) || 1)), 0), total: num(o.total),
        to: o.ahead.way === 'delivery' ? addressLine(o.ahead.delivery?.address) || null : null,
        startsAt: new Date(startsAt(at, lines)).toISOString(), releaseAt: new Date(Date.parse(String(L.releaseAt || '')) || releaseAt(at, lines)).toISOString(),
        phone: /^\d{10}$/.test(String(L.phone || '')) ? String(L.phone) : null, cancelBy: L.cancelBy || null,
        failed: L.release?.why ? String(L.release.why) : null, stuck: L.cancel && !L.cancel.at && Array.isArray(L.cancel.left) && L.cancel.left.length ? String(L.cancel.error || 'Not all of the refund went back.') : null,
        today: String(o.ahead.forDay) <= today }; })
    .sort((a: ComingUpRow, b: ComingUpRow) => a.at.localeCompare(b.at)).slice(0, 40);
  comingCache.set(tenantId, { at: nowMs, rows }); if (comingCache.size > 500) comingCache.delete(comingCache.keys().next().value as string);
  return rows;
}
