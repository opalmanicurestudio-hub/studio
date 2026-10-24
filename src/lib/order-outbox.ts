// src/lib/order-outbox.ts — THE MESSAGES AN ORDER STEP SENDS, QUEUED ON THE SERVER AND TRIED AGAIN UNTIL THEY GO (server).
// When a step happens that the customer is told about (ready for pickup, the curbside texts, an item missing, shipped
// with tracking typed in, a return settled, a report decided), the step queues its message here before it answers, and
// the server sends it straight after. A message that doesn't go (the text or email service is down, the request is
// cut off) is tried again on the five-minute job, a little later each time; one that still hasn't gone after its last
// try is written on the order's history for the team ("message_failed"), so nobody thinks the customer was told.
//
// One message per step: each is queued under a key made from the step (the order, the item, the moment), so a step
// that runs twice, or a retried request, queues it once. Each message's own route also sends at most once (it records
// that it went), and gives its claim back when the send failed, so a retry can send it; a message is sent by one
// server at a time (a short lease), so two tries never overlap.
//
// Messages are sent by the app's own routes (the words live there), asked by the server with its key. Nothing in a
// queued message is private beyond the order it's about: no names, contact details or sign-ins are stored.
import { buildEvent } from './retail-orders';
import { eventIdFor } from './order-events';

export type MessageKind = 'order_ready' | 'curbside_ready' | 'curbside_out' | 'order_short' | 'order_shipped' | 'return_outcome' | 'claim_decided' | 'order_collected';

/** Each kind: the route that sends it, what it's called on the team's timeline, and what it's sent with. */
const KINDS: Record<MessageKind, { path: string; what: string; body: (a: Args) => Record<string, string> }> = {
  order_ready: { path: '/api/retail/ready-notify', what: 'ready for pickup message', body: (a) => ({ orderId: a.orderId! }) },
  curbside_ready: { path: '/api/retail/curbside-notify', what: 'curbside ready text', body: (a) => ({ orderId: a.orderId!, moment: 'ready' }) },
  curbside_out: { path: '/api/retail/curbside-notify', what: 'text that someone is bringing it out', body: (a) => ({ orderId: a.orderId!, moment: 'out' }) },
  order_short: { path: '/api/retail/short-notify', what: 'missing item email', body: (a) => ({ orderId: a.orderId!, lineId: a.lineId! }) },
  order_shipped: { path: '/api/retail/shipped-notify', what: 'shipped email', body: (a) => ({ orderId: a.orderId! }) },
  return_outcome: { path: '/api/retail/return-notify', what: 'return settled email', body: (a) => ({ returnId: a.returnId! }) },
  claim_decided: { path: '/api/retail/claim-notify', what: 'email about their report', body: (a) => ({ claimId: a.claimId! }) },
  order_collected: { path: '/api/retail/collected-notify', what: 'note that someone else collected it', body: (a) => ({ orderId: a.orderId! }) },
};
type Args = { orderId?: string; lineId?: string; returnId?: string; claimId?: string; key?: string };

/** How long to wait after each failed try (the last try is the sixth): about four hours in all. */
export const RETRY_AFTER_MS = [60e3, 5 * 60e3, 15 * 60e3, 60 * 60e3, 3 * 60 * 60e3];
export const MAX_TRIES = RETRY_AFTER_MS.length + 1;
const LEASE_MS = 2 * 60e3;
/** A route that didn't answer in time may still be sending: the next try waits until it has surely finished. */
const AFTER_TIMEOUT_MS = 6 * 60e3;
const DONE_KEPT_DAYS = 30;

const safe = (v: any) => String(v ?? '').replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 80);
const okId = (v: any) => { const s = String(v ?? ''); return /^[A-Za-z0-9_-]{1,120}$/.test(s) ? s : ''; };
export const outboxRef = (db: any, id: string) => db.doc(`messageOutbox/${id}`);

/** The message's id: the same step queues the same message. */
export function messageId(tenantId: string, kind: MessageKind, a: Args): string {
  const subject = a.claimId ? `c${a.claimId}` : a.returnId ? `r${a.returnId}` : `o${a.orderId}`;
  return [safe(tenantId), kind, safe(subject), a.lineId ? safe(a.lineId) : '', a.key ? safe(a.key) : ''].filter(Boolean).join('.');
}

/** Queues a step's message (once per step). Returns its id, or '' when it's missing what it needs. */
export async function queueMessage(db: any, tenantId: string, kind: MessageKind, a: Args, orderId?: string): Promise<string> {
  const k = KINDS[kind]; if (!k || !okId(tenantId)) return '';
  const body = k.body(a); if (Object.values(body).some((v) => !okId(v) && v !== 'ready' && v !== 'out')) return '';
  const id = messageId(tenantId, kind, a);
  const now = new Date().toISOString();
  try {
    await outboxRef(db, id).create({
      v: 1, tenantId, kind, orderId: okId(orderId || a.orderId) || null, body,
      status: 'queued', tries: 0, dueAt: now, createdAt: now, updatedAt: now, lastError: null,
    });
  } catch (e: any) {
    // Already queued for this step: the one already there is the message.
    if (!/already exists|ALREADY_EXISTS/i.test(String(e?.message || '')) && e?.code !== 6) throw e;
  }
  return id;
}

export type Delivery = 'sent' | 'skipped' | 'retry' | 'failed' | 'busy';

/** What a route's answer means for the message: gone (or nothing to send), try again later, or never going. */
export function readAnswer(status: number, body: any): { outcome: 'done' | 'retry' | 'failed'; sent: boolean; why: string } {
  const why = String(body?.why || body?.reason || body?.error || body?.message || '').slice(0, 200);
  if (status >= 200 && status < 300 && body?.retry !== true) return { outcome: 'done', sent: body?.sent === true, why };
  if (status === 408 || status === 429 || status >= 500 || body?.retry === true) return { outcome: 'retry', sent: false, why: why || `answered ${status}` };
  return { outcome: 'failed', sent: false, why: why || `answered ${status}` };
}

type SendOpts = { base: string; auth?: string; fetchImpl?: typeof fetch; now?: number };

/** Sends one queued message if it's due and nobody else is sending it, and records how it went. */
export async function deliverMessage(db: any, id: string, o: SendOpts): Promise<Delivery> {
  const ref = outboxRef(db, id);
  const now = o.now ?? Date.now();
  // The lease: this server sends it; another finding it leased leaves it. A server that stops mid-send leaves the lease
  // to run out, and the message is due again then.
  const m: any = await db.runTransaction(async (tx: any) => {
    const s = await tx.get(ref); if (!s.exists) return null;
    const d: any = s.data() || {};
    if (!d.dueAt || Date.parse(String(d.dueAt)) > now) return null;
    tx.update(ref, { status: 'sending', tries: (Number(d.tries) || 0) + 1, dueAt: new Date(now + LEASE_MS).toISOString(), updatedAt: new Date(now).toISOString() });
    return { ...d, tries: (Number(d.tries) || 0) + 1 };
  });
  if (!m) return 'busy';
  const k = KINDS[m.kind as MessageKind];
  const base = String(o.base || '').replace(/\/+$/, '');
  const secret = String(process.env.CRON_SECRET || '');
  let ans: ReturnType<typeof readAnswer>;
  if (!k || !base) ans = { outcome: k ? 'retry' : 'failed', sent: false, why: k ? 'no address to send from' : 'unknown message' };
  else {
    const ctl = new AbortController(); const timer = setTimeout(() => ctl.abort(), 25e3);
    try {
      const r = await (o.fetchImpl || fetch)(`${base}${k.path}`, {
        method: 'POST', signal: ctl.signal,
        headers: { 'Content-Type': 'application/json', ...(o.auth ? { Authorization: o.auth } : {}), ...(secret ? { 'x-cf-internal': secret, 'x-internal-key': secret } : {}) },
        body: JSON.stringify({ tenantId: m.tenantId, ...(m.body || {}) }),
      });
      const body = await r.json().catch(() => null);
      // An answer that isn't the route's own (a sign-in wall, an error page) isn't proof it went.
      ans = body && typeof body === 'object' ? readAnswer(r.status, body) : { outcome: r.status >= 400 && r.status < 500 && r.status !== 408 && r.status !== 429 ? 'failed' : 'retry', sent: false, why: `answered ${r.status} without the route’s answer` };
      // Without the server's key, a retry can't sign in as the person who did the step: try again only while it can.
      if (ans.outcome === 'failed' && r.status === 401 && secret) ans = { ...ans, outcome: 'retry' };
    } catch (e: any) {
      ans = { outcome: 'retry', sent: false, why: String(e?.name === 'AbortError' ? 'no answer in time' : e?.message || e).slice(0, 200), slow: e?.name === 'AbortError' } as any;
    } finally { clearTimeout(timer); }
  }
  const at = new Date().toISOString();
  const last = m.tries >= MAX_TRIES;
  if (ans.outcome === 'done') {
    await ref.update({ status: ans.sent ? 'sent' : 'skipped', dueAt: null, doneAt: at, updatedAt: at, lastError: ans.sent ? null : ans.why || null });
    return ans.sent ? 'sent' : 'skipped';
  }
  if (ans.outcome === 'retry' && !last) {
    const wait = Math.max(RETRY_AFTER_MS[m.tries - 1], (ans as any).slow ? AFTER_TIMEOUT_MS : 0);
    await ref.update({ status: 'retry', dueAt: new Date(Date.now() + wait).toISOString(), updatedAt: at, lastError: ans.why });
    return 'retry';
  }
  // Not going: the team sees it on the order, so they can tell the customer another way.
  await ref.update({ status: 'failed', dueAt: null, doneAt: at, updatedAt: at, lastError: ans.why });
  await noteFailed(db, { ...m, id }, ans.why).catch(() => {});
  return 'failed';
}

/** The order's history says the customer wasn't told (the team's eyes only). */
async function noteFailed(db: any, m: any, why: string): Promise<void> {
  let orderId = okId(m.orderId);
  if (!orderId && m.body?.returnId) orderId = okId((await db.doc(`tenants/${m.tenantId}/retailReturns/${m.body.returnId}`).get()).data()?.orderId);
  if (!orderId && m.body?.claimId) orderId = okId((await db.doc(`tenants/${m.tenantId}/retailClaims/${m.body.claimId}`).get()).data()?.orderId);
  if (!orderId) return;
  const what = KINDS[m.kind as MessageKind]?.what || 'message';
  // One note per message (the message's own id), so a second message that failed never replaces the first's note.
  const ev = { id: eventIdFor('message_failed', String(m.id || m.kind)), ...buildEvent('message_failed', 'system', 'Automatic', { what, tries: Number(m.tries) || 0, why: String(why || '').slice(0, 160) }) };
  await db.doc(`tenants/${m.tenantId}/retailOrders/${orderId}/events/${ev.id}`).set(JSON.parse(JSON.stringify(ev)));
}

/** Queues a step's message and sends it right away (best effort: a send that doesn't go is tried again later). */
export async function queueAndSend(db: any, tenantId: string, kind: MessageKind, a: Args, o: SendOpts & { orderId?: string }): Promise<Delivery | 'none'> {
  const id = await queueMessage(db, tenantId, kind, a, o.orderId);
  if (!id) return 'none';
  // No address to send from here: left queued for the five-minute job, without spending a try.
  if (!String(o.base || '').trim()) return 'retry';
  return deliverMessage(db, id, o).catch((e) => { console.warn('[order-outbox]', id, String(e?.message || e).slice(0, 160)); return 'retry' as const; });
}

/** The five-minute job: every message that's due, oldest first, within the time it has. */
export async function drainOutbox(db: any, base: string, o: { budgetMs?: number; fetchImpl?: typeof fetch } = {}): Promise<Record<Delivery, number>> {
  const out: Record<Delivery, number> = { sent: 0, skipped: 0, retry: 0, failed: 0, busy: 0 };
  const stop = Date.now() + (o.budgetMs ?? 25e3);
  const due = await db.collection('messageOutbox').where('dueAt', '<=', new Date().toISOString()).limit(60).get();
  const docs = [...due.docs].sort((a: any, b: any) => String(a.data()?.dueAt).localeCompare(String(b.data()?.dueAt)));
  for (const d of docs) {
    // No new send once its time is up (one already started can take up to 25 seconds more).
    if (Date.now() > stop) break;
    try { out[await deliverMessage(db, d.id, { base, fetchImpl: o.fetchImpl })]++; } catch (e: any) { out.retry++; console.warn('[order-outbox]', d.id, String(e?.message || e).slice(0, 160)); }
  }
  return out;
}

/** The nightly sweep: messages that went (or never will) are kept a month, then removed. */
export async function sweepOutbox(db: any, now = Date.now()): Promise<number> {
  const before = new Date(now - DONE_KEPT_DAYS * 864e5).toISOString();
  let n = 0;
  for (let round = 0; round < 10; round++) {
    const s = await db.collection('messageOutbox').where('doneAt', '<', before).limit(400).get();
    if (s.empty) break;
    const b = db.batch(); s.docs.forEach((d: any) => b.delete(d.ref)); await b.commit(); n += s.size;
    if (s.size < 400) break;
  }
  return n;
}
