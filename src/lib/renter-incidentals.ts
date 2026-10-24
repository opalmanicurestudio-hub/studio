// src/lib/renter-incidentals.ts — AN INCIDENTAL CHARGED TO A LEASE RENTER'S SAVED CARD, RECORDED ONCE (server).
// The team charges an incidental (within the studio's capped policy) to a lease renter's card on file through
// api/booths/setup-card (PUT), on the platform's own Stripe account. Each attempt is claimed first
// (tenants/{t}/renters/{renter}/charges/inc_{key}: 'charging', with the amount, card and wording it's for), charged
// under one key named after the renter, the attempt and the card, and recorded here, once: the income line and its
// Stripe fee are named after the renter and the attempt, and written with the renter's incidentals log in the same step
// that marks the attempt 'charged'. Stripe saying no closes the attempt ('failed') and nothing is recorded.
//
// The renter's own record says which of their attempts are open: incidentalOpen holds each one's key and when it was
// claimed, and incidentalOpenAt the oldest of those. Both are written in the step that claims an attempt and in the
// step that closes it, so the five-minute check can find open attempts without looking through every renter.
//
// When Stripe's answer is lost, the screen says to try again in a couple of minutes, which sends the same charge under
// the same key. If nobody does, the attempt would stay open, with the money maybe taken and never recorded.
// settleLostRenterIncidentals, run by the five-minute check, settles every attempt left open more than 15 minutes. It
// takes the attempt over in one step (two runs at once settle it once), asks Stripe for the payment made for it (each
// one names the renter and the attempt, and is for the attempt's amount), and then:
//   - it went through: recorded as the charge itself records it, and the team is told, so it isn't collected twice;
//   - Stripe said no, or the charge never reached Stripe: closed as a decline is, nothing recorded, and the team is told
//     nothing was charged (the renter owes nothing for it);
//   - still going through: left for the next run.
// A payment still waiting for someone to approve it is canceled at Stripe first, so it can't go through later. Asked
// again after it's recorded, the screen is told it's done, and the renter is never charged twice. Attempts claimed
// before renters carried the mark are found once, a few renters a run, and given it.
import Stripe from 'stripe';
import { FieldValue } from 'firebase-admin/firestore';
import { logAuditAdmin } from '@/lib/audit';

type Note = { id: string; message: string; link: string };
type Result = 'recorded' | 'released' | 'waiting';

const OPEN_AFTER_MS = 15 * 60000;   // an attempt still open this long has lost its answer
const TAKEN_MS = 5 * 60000;         // one run's hold on an attempt it's settling
const DAY_S = 86400;
const MARK_PAGE = 25;               // renters looked through per run for attempts made before the mark
const safeKey = (v: any) => String(v || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 120);
const iso = (n: number) => new Date(n).toISOString();
const ms = (v: any) => Date.parse(String(v || '')) || 0;
const money = (c: number) => `$${(c / 100).toFixed(2)}`;
const stripeFor = () => new Stripe(process.env.STRIPE_SECRET_KEY || '', { apiVersion: '2024-06-20' as any }) as any;
const claimTime = (a: any) => ms(a?.claimAt);
const noteDoc = (id: string, n: Note) => ({ id, type: 'booth_reservation', read: false, createdAt: new Date().toISOString(), link: n.link, message: n.message });

export const incidentalAttemptPath = (tenantId: string, renterId: string, key: string) => `tenants/${tenantId}/renters/${renterId}/charges/inc_${key}`;

// ── The renter's open attempts ───────────────────────────────────────────────
const oldest = (open: Record<string, any>) => Object.values(open).map(String).sort()[0] || null;

/** What to write on the renter when an attempt is claimed: it joins their open attempts. Null when it's already there. */
export function incidentalOpened(renter: any, key: string, at: string): Record<string, any> | null {
  const open: Record<string, any> = { ...(renter?.incidentalOpen || {}) };
  if (open[key]) return null;
  open[key] = at;
  return { incidentalOpen: { [key]: at }, incidentalOpenAt: oldest(open) };
}

/** …and when it closes: it leaves them, and the mark comes off once none are left. Null when it wasn't there. */
function incidentalClosed(renter: any, key: string): Record<string, any> | null {
  const open: Record<string, any> = { ...(renter?.incidentalOpen || {}) };
  if (!(key in open)) return null;
  delete open[key];
  return Object.keys(open).length
    ? { incidentalOpen: { [key]: FieldValue.delete() }, incidentalOpenAt: oldest(open) }
    : { incidentalOpen: FieldValue.delete(), incidentalOpenAt: FieldValue.delete() };
}

/** Stripe's fee and the charge's id: from the payment as it came back, else asked for. Fail-open: no fee line. */
async function feeOf(stripe: any, intent: any): Promise<{ feeCents: number; chargeId: string | null }> {
  const lc: any = intent?.latest_charge;
  let feeCents = Number(lc?.balance_transaction?.fee) || 0;
  let chargeId: string | null = typeof lc === 'string' ? lc : (lc?.id || null);
  if (!feeCents && intent?.id && (stripe || process.env.STRIPE_SECRET_KEY)) {
    try {
      const pi: any = await (stripe || stripeFor()).paymentIntents.retrieve(intent.id, { expand: ['latest_charge.balance_transaction'] });
      const c: any = pi?.latest_charge;
      feeCents = Number(c?.balance_transaction?.fee) || 0;
      chargeId = chargeId || c?.id || null;
    } catch { /* no fee line */ }
  }
  return { feeCents, chargeId };
}

/** The incidental charged: the income line, its Stripe fee, the renter's incidentals log and the attempt marked
 *  'charged' (and no longer open), once. False when it was recorded already. `extra` is written on the attempt with it,
 *  and `note` (named after what it's about) beside it. */
export async function recordRenterIncidental(db: any, tenantId: string, renterId: string, key: string, intent: any, cents: number, description: string, renterName: string,
  o: { stripe?: any; at?: string; extra?: Record<string, any>; note?: Note } = {}): Promise<boolean> {
  const renterRef = db.doc(`tenants/${tenantId}/renters/${renterId}`);
  const attemptRef = db.doc(incidentalAttemptPath(tenantId, renterId, key));
  const { feeCents, chargeId } = await feeOf(o.stripe, intent);
  const txnRef = db.doc(`tenants/${tenantId}/transactions/renterinc_${safeKey(renterId)}_${key}`);
  const feeRef = db.doc(`tenants/${tenantId}/transactions/renterincfee_${safeKey(renterId)}_${key}`);
  const noteRef = o.note ? db.doc(`tenants/${tenantId}/notifications/${o.note.id}`) : null;
  const at = o.at || new Date().toISOString();
  return db.runTransaction(async (tx: any) => {
    const a: any = (await tx.get(attemptRef)).data() || {};
    const r: any = (await tx.get(renterRef)).data() || {};
    if (a.status === 'charged') return false;
    tx.set(txnRef, {
      id: txnRef.id, type: 'income', context: 'Business', taxBucket: 'revenue', source: 'booth_rent',
      amount: cents / 100, category: 'Renter Incidental',
      description: `${description} — ${renterName} (card on file)`,
      clientOrVendor: renterName, date: at, paymentMethod: 'Card on file (Stripe)',
      hasReceipt: false, stripePaymentIntentId: intent.id, stripeChargeId: chargeId, renterId, sourceId: renterId, tenantId, createdAt: at,
    });
    // Paired Processing Fees expense for the incidental charge.
    if (feeCents > 0) tx.set(feeRef, {
      id: feeRef.id, type: 'expense', context: 'Business', taxBucket: 'operating_cost',
      amount: feeCents / 100, category: 'Processing Fees',
      description: `Stripe fee — incidental charge (${renterName})`,
      clientOrVendor: 'Stripe', date: at, paymentMethod: 'Deducted from payout',
      hasReceipt: false, stripePaymentIntentId: intent.id, stripeChargeId: chargeId,
      renterId, relatedTxnId: txnRef.id, tenantId, createdAt: at,
    });
    // The renter's incidentals log, for their history.
    tx.set(renterRef, { incidentals: FieldValue.arrayUnion({ amountCents: cents, description, at, paymentIntentId: intent.id }), incidentalsTotalCents: FieldValue.increment(cents),
      ...(incidentalClosed(r, key) || {}) }, { merge: true });
    tx.set(attemptRef, { status: 'charged', chargedAt: at, paymentIntentId: intent.id, claimAt: null, ...(o.extra || {}) }, { merge: true });
    if (noteRef && o.note) tx.set(noteRef, noteDoc(noteRef.id, o.note));
    return true;
  });
}

/** Nothing moved: the attempt is closed ('failed', and no longer open on the renter) and nothing is recorded. Only while
 *  it's still open (and, with `still`, still as the caller left it). False when it wasn't. */
export async function releaseRenterIncidental(db: any, tenantId: string, renterId: string, key: string, error: string,
  o: { at?: string; still?: (a: any) => boolean; extra?: Record<string, any>; note?: Note } = {}): Promise<boolean> {
  const renterRef = db.doc(`tenants/${tenantId}/renters/${renterId}`);
  const attemptRef = db.doc(incidentalAttemptPath(tenantId, renterId, key));
  const noteRef = o.note ? db.doc(`tenants/${tenantId}/notifications/${o.note.id}`) : null;
  const at = o.at || new Date().toISOString();
  return db.runTransaction(async (tx: any) => {
    const a: any = (await tx.get(attemptRef)).data() || null;
    const r: any = (await tx.get(renterRef)).data() || {};
    if (!a || a.status !== 'charging' || (o.still && !o.still(a))) return false;
    tx.set(attemptRef, { status: 'failed', claimAt: null, failedAt: at, error: String(error || '').slice(0, 200), ...(o.extra || {}) }, { merge: true });
    const closed = incidentalClosed(r, key);
    if (closed) tx.set(renterRef, closed, { merge: true });
    if (noteRef && o.note) tx.set(noteRef, noteDoc(noteRef.id, o.note));
    return true;
  });
}

// ── The five-minute check ────────────────────────────────────────────────────

/** Every payment on this customer since `since` (seconds), on the platform's account. Null when Stripe can't be asked
 *  right now (or there are too many to look through), so nothing is decided on half an answer. */
async function paymentsSince(stripe: any, customer: string, since: number): Promise<any[] | null> {
  const found: any[] = [];
  try {
    for (let page = 0, after = ''; page < 10; page++) {
      const l: any = await stripe.paymentIntents.list({ customer, created: { gte: since }, limit: 100, ...(after ? { starting_after: after } : {}) });
      const data: any[] = Array.isArray(l?.data) ? l.data : [];
      found.push(...data);
      if (!l?.has_more || !data.length) return found;
      after = String(data[data.length - 1]?.id || '');
    }
  } catch { /* asked again on the next run */ }
  return null;
}

/** What became of the payments made for an attempt: one that went through counts first, then one still going through,
 *  then one waiting for approval. Otherwise Stripe said no to each, or there were none. */
function outcomeOf(payments: any[]): { state: 'paid' | 'pending' | 'open' | 'declined' | 'none'; pi: any; open: any[] } {
  const st = (p: any) => String(p?.status || '');
  const paid = payments.find((p) => st(p) === 'succeeded');
  if (paid) return { state: 'paid', pi: paid, open: [] };
  if (payments.some((p) => st(p) === 'processing')) return { state: 'pending', pi: null, open: [] };
  const open = payments.filter((p) => ['requires_action', 'requires_confirmation', 'requires_capture'].includes(st(p)));
  if (open.length) return { state: 'open', pi: open[0], open };
  const no = payments.find((p) => ['requires_payment_method', 'canceled'].includes(st(p)));
  return { state: no ? 'declined' : 'none', pi: no || null, open: [] };
}

/** Payments still waiting for approval are canceled, so none can go through after the attempt is closed. False when one
 *  wasn't (it may have moved on): the next run looks again. */
async function cancelOpen(stripe: any, open: any[]): Promise<boolean> {
  try {
    for (const p of open) {
      const c: any = await stripe.paymentIntents.cancel(String(p.id), {}, { idempotencyKey: `cancel_${p.id}` });
      if (String(c?.status || '') !== 'canceled') return false;
    }
    return true;
  } catch { return false; }
}

/** Take an open attempt over in one step, so two runs of the check at once settle it once. */
async function takeOver(db: any, ref: any, isOpen: (a: any) => boolean, now: number): Promise<any | null> {
  return db.runTransaction(async (tx: any) => {
    const a: any = (await tx.get(ref)).data() || null;
    if (!a || !isOpen(a) || (a.settlingAt && now - ms(a.settlingAt) < TAKEN_MS)) return null;
    tx.set(ref, { settlingAt: iso(now) }, { merge: true });
    return a;
  }).catch(() => null);
}

/** A mark with nothing open behind it comes off: one attempt's (when it isn't open any more), or the whole mark (when
 *  no attempts are listed under it). */
async function dropMark(db: any, renterRef: any, key: string | null, attemptRef: any = null) {
  await db.runTransaction(async (tx: any) => {
    const a: any = attemptRef ? (await tx.get(attemptRef)).data() || null : null;
    const r: any = (await tx.get(renterRef)).data() || {};
    if (a?.status === 'charging') return;
    if (key) { const closed = incidentalClosed(r, key); if (closed) tx.set(renterRef, closed, { merge: true }); return; }
    if (!Object.keys(r.incidentalOpen || {}).length && r.incidentalOpenAt != null) tx.set(renterRef, { incidentalOpenAt: FieldValue.delete() }, { merge: true });
  });
}

/** Attempts claimed before renters carried the mark are given it, a few renters a run, once for each business. */
async function markOlderAttempts(db: any, tenantId: string, now: number) {
  const flagRef = db.doc(`tenants/${tenantId}/private/renterIncidentals`);
  const flag: any = (await flagRef.get()).data() || {};
  if (flag.markedAt) return;
  let q: any = db.collection(`tenants/${tenantId}/renters`).orderBy('__name__').limit(MARK_PAGE);
  if (flag.cursor) q = q.startAfter(String(flag.cursor));
  const page: any[] = (await q.get()).docs;
  for (const r of page) {
    const open: any[] = (await r.ref.collection('charges').where('status', '==', 'charging').get()).docs.filter((d: any) => String(d.id).startsWith('inc_'));
    for (const d of open) await db.runTransaction(async (tx: any) => {
      const a: any = (await tx.get(d.ref)).data() || null;
      const rd: any = (await tx.get(r.ref)).data() || {};
      const mark = a?.status === 'charging' ? incidentalOpened(rd, String(d.id).slice(4), String(a.claimAt || iso(now))) : null;
      if (mark) tx.set(r.ref, mark, { merge: true });
    });
  }
  await flagRef.set(page.length < MARK_PAGE ? { markedAt: iso(now), cursor: null } : { cursor: String(page[page.length - 1].id) }, { merge: true });
}

async function settleOne(db: any, tenantId: string, renterId: string, renter: any, key: string, ref: any, a: any, stripe: any, now: number): Promise<Result> {
  const cents = Math.round(Number(a.amountCents) || 0);
  const customer = String(a.customer || renter.stripeCustomerId || '');
  if (!customer) return 'waiting';
  const list = await paymentsSince(stripe, customer, Math.floor(claimTime(a) / 1000) - DAY_S);
  if (!list) return 'waiting';
  const found = outcomeOf(list.filter((p: any) => p?.metadata?.kind === 'renter_incidental' && String(p?.metadata?.renterId || '') === renterId
    && String(p?.metadata?.attempt || '') === key && Math.round(Number(p?.amount) || 0) === cents));
  if (found.state === 'pending') return 'waiting';
  const renterName = `${renter.firstName || ''} ${renter.lastName || ''}`.trim() || 'Renter';
  const description = String(a.description || a.category || 'Incidental');
  const what = `The ${money(cents)} incidental charge to ${renterName}’s card on file (${description})`;
  const settled = { settlingAt: null, settledAt: iso(now), settledBy: 'check' };
  const noteId = `renterinc_${safeKey(renterId)}_${key}`;

  if (found.state === 'paid') {
    const at = Number(found.pi.created) > 0 ? iso(Number(found.pi.created) * 1000) : iso(now);
    const wrote = await recordRenterIncidental(db, tenantId, renterId, key, found.pi, cents, description, renterName, { stripe, at, extra: settled, note: {
      id: noteId, link: '/booths',
      message: `${what} went through, though the screen never heard back. It’s recorded in Money. If it was also collected another way, refund it from Money.`,
    } });
    if (wrote) {
      await logAuditAdmin(db, tenantId, {
        action: 'booth.renter_charged', targetType: 'renter', targetId: renterId,
        summary: `Incidental charged to card on file: ${renterName} — ${description} ($${(cents / 100).toFixed(2)}), recorded by the automatic check after Stripe’s answer was lost`,
        amount: cents / 100, actor: { type: 'system', name: 'Automatic check' },
      } as any).catch(() => {});
    } else await ref.set({ settlingAt: null }, { merge: true }).catch(() => {});
    return 'recorded';
  }

  // Nothing went through: closed, as a decline is. Only if nobody asked again meanwhile (then that request finishes it).
  if (found.state === 'open' && !(await cancelOpen(stripe, found.open))) return 'waiting';
  const reason = found.state === 'none' ? 'it never reached Stripe'
    : found.state === 'open' ? 'it needed approval that never came'
    : found.pi?.status === 'canceled' ? 'the payment was stopped before it went through' : 'the card was declined';
  const error = found.state === 'declined' && found.pi?.status !== 'canceled' ? String(found.pi?.last_payment_error?.message || 'The card was declined.') : `${reason[0].toUpperCase()}${reason.slice(1)}.`;
  const same = (x: any) => x.settlingAt === iso(now) && String(x.claimAt || '') === String(a.claimAt || '');
  const freed = await releaseRenterIncidental(db, tenantId, renterId, key, error, { at: iso(now), still: same, extra: settled, note: {
    id: noteId, link: '/booths',
    message: `${what} didn’t go through (${reason}), so nothing was charged. Collect it another way, or charge it again.`,
  } });
  return freed ? 'released' : 'waiting';
}

/** The five-minute check for lease renters' incidental charges (see the top of this file). */
export async function settleLostRenterIncidentals(db: any, tenantId: string, tenant: any, o: { stripe?: any; now?: number } = {}): Promise<{ checked: number; recorded: number; released: number; waiting: number }> {
  const out = { checked: 0, recorded: 0, released: 0, waiting: 0 };
  const now = o.now ?? Date.now();
  await markOlderAttempts(db, tenantId, now).catch((e: any) => console.error('[renter-incidentals] marking older attempts', tenantId, String(e?.message || e).slice(0, 160)));
  const lost = (a: any) => a?.status === 'charging' && now - claimTime(a) >= OPEN_AFTER_MS;
  const renters = (await db.collection(`tenants/${tenantId}/renters`).where('incidentalOpenAt', '<=', iso(now - OPEN_AFTER_MS)).limit(50).get()
    .catch(() => ({ docs: [] as any[] }))).docs;
  let stripe = o.stripe;
  for (const rd of renters) {
    const renter: any = rd.data() || {};
    const keys = Object.keys(renter.incidentalOpen || {});
    if (!keys.length) { await dropMark(db, rd.ref, null).catch(() => {}); continue; }
    for (const key of keys) {
      const aRef = db.doc(incidentalAttemptPath(tenantId, rd.id, key));
      const a0: any = (await aRef.get()).data() || null;
      if (a0?.status !== 'charging') { await dropMark(db, rd.ref, key, aRef).catch(() => {}); continue; }
      if (!lost(a0)) continue;
      const a = await takeOver(db, aRef, lost, now);
      if (!a) continue;
      out.checked++;
      let r: Result = 'waiting';
      try { stripe = stripe || stripeFor(); r = await settleOne(db, tenantId, String(rd.id), renter, key, aRef, a, stripe, now); }
      catch (e: any) { console.error('[renter-incidentals]', tenantId, rd.id, key, String(e?.message || e).slice(0, 160)); }
      if (r === 'waiting') await aRef.set({ settlingAt: null }, { merge: true }).catch(() => {});
      out[r]++;
    }
  }
  return out;
}
