// src/lib/renter-refund.ts — MONEY BACK TO A RENTER'S CARD (server).
// What a renter paid by card from their account (rent paid online, autopay, an agreed charge taken from the card on
// file) can be refunded from their account, in part or in full, to the same card, on the Stripe account it was paid on.
//   - The refund is claimed on the payment's line in the books first (renterRefunds, under the screen's request), in
//     one step that counts what's already gone back and what's on its way, so pressing Refund twice, or two people at
//     once, never sends back more than was paid. It's then sent under one key for that request, so asking again after
//     Stripe didn't answer replays the same refund instead of sending a second one. A request asked again for a
//     different amount is refused, never sent as the old one.
//   - It's recorded once (recordRenterRefund), in one step: the refund line in the books (it comes off rent income), the
//     payment's refunded total, two lines on the renter's account (the refund itself and, when they don't owe it again,
//     the same amount taken off, so their balance doesn't move; when the business says they still owe it, the refund
//     line stays open as owed, like any agreed charge), a note in their portal, and the activity log. Whichever records
//     it first, the screen or Stripe's notice of the refund (lib/connect-webhook), the other finds it done.
//   - A claim nobody finished (the screen never heard back, and no notice came) is looked up at Stripe by the five-minute
//     check (lib/money-sweep): recorded if it went through, let go if Stripe never got it.
//   - A refund of one of these payments made in the Stripe Dashboard (outside the app) goes on the renter's account the
//     same way, as money back they don't owe again (its line in the books is lib/outside-refund's), and the owners are
//     told, so that if the renter does still owe it, it can be added as a charge.
//   - The renter is told once: in their portal, and by email or text (Messages: "Refund to card"), filed under them.
import { onAccount } from '@/lib/space-stripe';
import { stripeRefused } from '@/lib/stripe-said-no';

const n = (v: any) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const usd = (c: number) => `$${(Math.max(0, Math.round(c)) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const safe = (s: any) => String(s || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 120);
const clip = (v: any, max: number) => String(v ?? '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, max);

/** The payments a renter makes by card from their account, by what the payment says it's for. */
export const RENTER_PAYMENT_KINDS = ['rent_invoice', 'lease_autopay', 'renter_incidental'] as const;
/** A claim with no result after this long is looked up at Stripe (by the five-minute check, or the next refund asked). */
export const REFUND_CLAIM_MS = 15 * 60 * 1000;

export type RenterPaymentKind = 'online' | 'autopay' | 'agreed';
export interface RenterCardPayment {
  id: string; kind: RenterPaymentKind; label: string; date: string; cents: number;
  refundedCents: number; pendingCents: number; refundableCents: number;
  invoiceId: string | null; dueDate: string | null; card: { brand: string | null; last4: string | null } | null;
}

/** Which kind of renter card payment a line in the books is: rent paid online or by autopay (a bill of theirs), or an
 *  agreed charge taken from the card on file (lib/renter-incidentals names those renterinc_). Anything else (a cash
 *  payment, a day booking or its extras) isn't refunded here. */
export function renterPaymentKind(t: any, invoiceIds: Set<string>, id: string = String(t?.id || '')): RenterPaymentKind | null {
  if (!t || t.type !== 'income' || !t.stripePaymentIntentId || t.voided || t.voidedAt) return null;
  if (t.category === 'Renter Incidental') return id.startsWith('renterinc_') ? 'agreed' : null;
  if (t.source === 'booth_rent' && t.category === 'Booth Rent' && invoiceIds.has(String(t.sourceId || ''))) return /autopay/i.test(String(t.paymentMethod || '')) ? 'autopay' : 'online';
  return null;
}

/** A line in the books that's a renter's own card payment from their account, by its name and shape alone (for places
 *  that must send its refund here, so the renter's account and notice follow, e.g. lib/money-refund). */
export function isRenterAccountPayment(id: string, t: any): boolean {
  if (!t || t.type !== 'income' || !t.stripePaymentIntentId) return false;
  return String(id).startsWith('rentpay_') || (String(id).startsWith('renterinc_') && t.category === 'Renter Incidental')
    || (t.source === 'booth_rent' && t.category === 'Booth Rent' && /autopay/i.test(String(t.paymentMethod || '')));
}

/** The same, and also an online rent line written before lines were named rentpay_ (its sourceId is one of the bills). */
export async function isRenterAccountPaymentIn(db: any, tenantId: string, id: string, t: any): Promise<boolean> {
  if (isRenterAccountPayment(id, t)) return true;
  if (!t || t.type !== 'income' || !t.stripePaymentIntentId || t.source !== 'booth_rent' || t.category !== 'Booth Rent' || !t.sourceId) return false;
  return !!(await db.doc(`tenants/${tenantId}/rentInvoices/${safe(t.sourceId)}`).get()).exists;
}

/** What's on its way back from a payment now (claims with no result yet), other than one request. */
export function pendingRefundCents(t: any, except: string | null = null): number {
  return Object.entries(t?.renterRefunds || {}).filter(([k, c]: any) => k !== except && c?.state === 'refunding').reduce((s, [, c]: any) => s + n(c?.cents), 0);
}

/** What can still go back from a payment: what was paid, less what's gone back and what's on its way. Nothing, once
 *  it's been refunded as a sale (from Money, before renter refunds were here) or voided. */
export function refundableCents(t: any, except: string | null = null): number {
  if (t?.refundedAt || t?.voided || t?.voidedAt) return 0;
  return Math.max(0, Math.round(n(t?.amount) * 100) - n(t?.refundedCents) - pendingRefundCents(t, except));
}

/** The oldest claim still on its way, after a change to the claims (null when none): the five-minute check finds the
 *  payment by it. */
function openAt(claims: Record<string, any>): string | null {
  return Object.values(claims || {}).filter((c: any) => c?.state === 'refunding' && c?.at).map((c: any) => String(c.at)).sort()[0] || null;
}

const shortDay = (iso: string) => { const d = new Date(`${iso.slice(0, 10)}T12:00:00Z`); return isNaN(d.getTime()) ? iso : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }); };
const kindOf = (t: any): RenterPaymentKind => (t?.category === 'Renter Incidental' ? 'agreed' : /autopay/i.test(String(t?.paymentMethod || '')) ? 'autopay' : 'online');

/** What the payment was, in a few words, as the screen and the renter's account say it. */
export function paymentLabel(t: any, kind: RenterPaymentKind, dueDate: string | null): string {
  if (kind === 'agreed') return `Agreed charge: ${String(t.description || 'charge').split(' — ')[0]}`;
  return `${kind === 'autopay' ? 'Autopay' : 'Rent paid online'}${dueDate ? `, rent due ${shortDay(dueDate)}` : ''}`;
}
/** The same, as it reads inside a sentence ("refunded $60.00 to … for {this}"). */
export function paymentPhrase(t: any, kind: RenterPaymentKind, dueDate: string | null): string {
  if (kind === 'agreed') return `the agreed charge for ${String(t.description || 'a charge').split(' — ')[0]}`;
  return `your ${kind === 'autopay' ? 'autopay ' : ''}rent payment${dueDate ? ` for the bill due ${shortDay(dueDate)}` : ''}`;
}

const cardText = (card: { brand?: string | null; last4?: string | null } | null | undefined) => {
  const b = String(card?.brand || '').trim(); const l = String(card?.last4 || '').trim();
  return l ? `${b ? `${b.charAt(0).toUpperCase()}${b.slice(1)} ` : 'card '}ending ${l}` : 'the card it was paid with';
};

/** Whose payment a line is: its renter, or (older lines written before they carried one) the renter on its bill. */
function ownerOf(t: any, inv: any): string | null {
  return String(t?.renterId || (t?.category === 'Renter Incidental' ? t?.sourceId : inv?.renterId) || '') || null;
}

/** The card payments on a renter's account, newest first, with what can still go back from each. */
export async function renterCardPayments(db: any, tenantId: string, renterId: string): Promise<RenterCardPayment[]> {
  const T = `tenants/${tenantId}`;
  const [txSnap, invSnap] = await Promise.all([
    db.collection(`${T}/transactions`).where('renterId', '==', renterId).get(),
    db.collection(`${T}/rentInvoices`).where('renterId', '==', renterId).get(),
  ]);
  const invById = new Map<string, any>(invSnap.docs.map((d: any) => [String(d.id), d.data() || {}]));
  const ids = new Set<string>(invById.keys());
  // Lines written before they carried the renter: found by their bills.
  const docs = new Map<string, any>(txSnap.docs.map((d: any) => [String(d.id), d.data() || {}]));
  const billIds = [...ids];
  for (let i = 0; i < billIds.length; i += 30) for (const d of (await db.collection(`${T}/transactions`).where('sourceId', 'in', billIds.slice(i, i + 30)).get()).docs) if (!docs.has(String(d.id))) docs.set(String(d.id), d.data() || {});
  const out: RenterCardPayment[] = [];
  for (const [id, x] of docs) {
    const t: any = { id, ...x };
    const kind = renterPaymentKind(t, ids, id); if (!kind) continue;
    const inv = kind === 'agreed' ? null : invById.get(String(t.sourceId)) || null;
    if (ownerOf(t, inv) !== renterId) continue;
    const due = inv?.dueDate ? String(inv.dueDate).slice(0, 10) : null;
    const lastRefund: any = Object.values(t.renterRefunds || {}).find((c: any) => c?.card?.last4) || null;
    out.push({ id, kind, label: paymentLabel(t, kind, due), date: String(t.date || t.createdAt || '').slice(0, 10), cents: Math.round(n(t.amount) * 100),
      refundedCents: t.refundedAt && !t.refundedCents ? Math.round(n(t.amount) * 100) : n(t.refundedCents), pendingCents: pendingRefundCents(t), refundableCents: refundableCents(t),
      invoiceId: kind === 'agreed' ? null : String(t.sourceId || '') || null, dueDate: due, card: lastRefund?.card || null });
  }
  return out.sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id));
}

/** Where a payment was taken (the business's own Stripe account, or, for one from before that, the platform's), with its
 *  card and what Stripe says has gone back already. `unknown` when Stripe didn't answer. */
export async function locatePayment(stripe: any, tenant: any, t: any): Promise<{ ok: true; account: string | null; receivedCents: number; refundedCents: number; card: { brand: string | null; last4: string | null } | null } | { ok: false; missing?: boolean; unknown?: boolean }> {
  const pi = String(t?.stripePaymentIntentId || ''); if (!pi) return { ok: false, missing: true };
  // The account the line names, then the business's own, then (for a payment from before that) the platform's.
  const tries: (string | null)[] = [];
  for (const a of [t?.stripeConnectedAccountId, tenant?.stripeAccountId]) if (typeof a === 'string' && a && !tries.includes(a)) tries.push(a);
  tries.push(null);
  for (const account of tries) {
    try {
      const p: any = await stripe.paymentIntents.retrieve(pi, { expand: ['latest_charge'] }, onAccount({ stripeAccountId: account }));
      const ch: any = p?.latest_charge && typeof p.latest_charge === 'object' ? p.latest_charge : null;
      const card = ch?.payment_method_details?.card || null;
      return { ok: true, account, receivedCents: n(p?.amount_received ?? p?.amount), refundedCents: n(ch?.amount_refunded), card: card ? { brand: card.brand || null, last4: card.last4 || null } : null };
    } catch (e: any) {
      if (String(e?.code || e?.raw?.code || '') === 'resource_missing') continue;
      return { ok: false, unknown: true };
    }
  }
  return { ok: false, missing: true };
}

/** What recording a refund found: whether this call wrote it, whether it's on the renter's account (written now or
 *  before), and what the renter is told about it. */
export type RecordedRefund = { wrote: boolean; onAccount: boolean; renterId: string | null; stillOwed?: boolean; reason?: string; label?: string; phrase?: string; card?: any; cents?: number };

/** A refund that went back, recorded once: the refund line in the books (not for one made in the Stripe Dashboard, whose
 *  line lib/outside-refund writes), the payment's refunded total and its claim closed, the renter's account lines, their
 *  portal note and the activity log. Named after Stripe's refund, so recording it twice (the screen and Stripe's
 *  notice) writes it once. */
export async function recordRenterRefund(db: any, tenantId: string, x: {
  transactionId: string; requestId?: string | null; refundId: string; cents: number; card?: { brand: string | null; last4: string | null } | null;
  outside?: boolean; stillOwed?: boolean; reason?: string | null; by?: string | null; at?: string; today?: string;
}): Promise<RecordedRefund> {
  const T = `tenants/${tenantId}`; const at = x.at || new Date().toISOString(); const today = x.today || at.slice(0, 10);
  const cents = Math.max(0, Math.round(n(x.cents)));
  const rid = safe(x.refundId); if (!rid || !(cents > 0)) return { wrote: false, onAccount: false, renterId: null };
  const txRef = db.doc(`${T}/transactions/${safe(x.transactionId)}`);
  const lineRef = db.doc(`${T}/transactions/rentrefund_${rid}`);
  const rrfRef = db.doc(`${T}/rentLedger/rrf_${rid}`);
  const rrwRef = db.doc(`${T}/rentLedger/rrw_${rid}`);
  const alertRef = db.doc(`${T}/renterAlerts/refund_${rid}`);
  const auditRef = db.doc(`${T}/auditLogs/rentrefund_${rid}`);
  const reqKey = x.requestId ? safe(x.requestId) : '';
  return db.runTransaction(async (tx: any) => {
    const ts = await tx.get(txRef); const rrf = await tx.get(rrfRef);
    if (!ts.exists) return { wrote: false, onAccount: false, renterId: null } as RecordedRefund;
    const t: any = ts.data() || {};
    const claims: Record<string, any> = { ...(t.renterRefunds || {}) };
    const claim: any = reqKey ? claims[reqKey] || null : null;
    const kind = kindOf(t);
    const inv: any = kind !== 'agreed' && t.sourceId ? ((await tx.get(db.doc(`${T}/rentInvoices/${safe(t.sourceId)}`))).data() || null) : null;
    const renterId = ownerOf(t, inv);
    const due = inv?.dueDate ? String(inv.dueDate).slice(0, 10) : null;
    const label = paymentLabel(t, kind, due); const phrase = paymentPhrase(t, kind, due);
    const card = x.card || claim?.card || null;
    if (rrf.exists) {
      // Recorded already (by the screen or by Stripe's notice): the claim is closed if it's still open.
      const was: any = rrf.data() || {};
      if (claim && claim.state !== 'refunded') {
        claims[reqKey] = { ...claim, state: 'refunded', refundId: String(x.refundId), at: claim.at || at };
        tx.set(txRef, { renterRefunds: { [reqKey]: { state: 'refunded', refundId: String(x.refundId) } }, renterRefundOpenAt: openAt(claims) }, { merge: true });
      }
      return { wrote: false, onAccount: true, renterId, stillOwed: was.stillOwed === true, reason: String(was.note || ''), label, phrase, card: card || null, cents } as RecordedRefund;
    }
    const stillOwed = !x.outside && kind !== 'agreed' && (claim ? claim.stillOwed === true : x.stillOwed === true);
    const reason = clip(claim?.reason ?? x.reason ?? '', 300);
    const by = claim?.by ?? x.by ?? null;
    const leaseId = t.leaseId || inv?.leaseId || null;
    if (!x.outside) {
      tx.set(lineRef, {
        id: lineRef.id, tenantId, date: at, createdAt: at, type: 'reversal', context: 'Business', category: 'Refunds', taxBucket: 'refund',
        reversalOf: txRef.id, reversedType: 'income', rentRefundOf: txRef.id, renterId, leaseId,
        amount: cents / 100, amountCents: cents, taxRefunded: 0, paymentMethod: 'Card (Stripe refund)', hasReceipt: false, refundedToCard: true,
        description: `Refund to card — ${label}`, clientOrVendor: t.clientOrVendor || null, notes: reason || 'Refunded to the card',
        stripeRefundId: String(x.refundId), stripePaymentIntentId: t.stripePaymentIntentId || null, by,
      });
    }
    if (reqKey) claims[reqKey] = { ...(claim || {}), state: 'refunded', cents, refundId: String(x.refundId), at: claim?.at || at, ...(card ? { card } : {}) };
    tx.set(txRef, { refundedCents: n(t.refundedCents) + cents, lastRefundAt: at, renterRefundOpenAt: openAt(claims),
      ...(reqKey ? { renterRefunds: { [reqKey]: claims[reqKey] } } : {}) }, { merge: true });
    tx.set(rrfRef, {
      id: rrfRef.id, renterId, leaseId, type: 'card_refund', status: stillOwed ? 'pending' : 'refunded', amountCents: cents,
      description: `Refund to ${cardText(card)}: ${label}`, note: reason, dueDate: stillOwed ? today : null, paidAt: null,
      transactionId: txRef.id, invoiceId: kind === 'agreed' ? null : String(t.sourceId || '') || null, stripeRefundId: String(x.refundId),
      outsideApp: x.outside === true, stillOwed, createdBy: by || (x.outside ? 'Stripe Dashboard' : 'owner'), createdAt: at, updatedAt: at,
    });
    // Not owed again: the same amount comes off, so the refund doesn't leave them owing it. Both lines are 'refunded',
    // the status every balance and settling rule already leaves out; statements and the timeline show both, netting to
    // nothing.
    if (!stillOwed) tx.set(rrwRef, {
      id: rrwRef.id, renterId, leaseId, type: 'refund_waiver', status: 'refunded', amountCents: -cents,
      description: 'Refund: not owed again', note: reason, relatesTo: rrfRef.id, transactionId: txRef.id, createdBy: by || 'owner', createdAt: at, updatedAt: at,
    });
    if (renterId) tx.set(alertRef, { id: alertRef.id, renterId, kind: 'refund', tab: 'rent', tone: 'green', at,
      text: `${usd(cents)} was refunded to ${cardText(card)} (${label}).${reason ? ` ${reason.replace(/\.$/, '')}.` : ''}${stillOwed ? ` It's still owed, so it's on your account to pay.` : ''} Refunds usually show within 5 to 10 business days.` });
    tx.set(auditRef, { id: auditRef.id, at, action: 'rent.card_refund', targetType: 'renter', targetId: renterId,
      summary: `${x.outside ? 'Refund made in the Stripe Dashboard: ' : 'Refunded '}${usd(cents)} to ${cardText(card)} (${label})${stillOwed ? '; still owed' : ''}${reason && !x.outside ? `: ${reason}` : ''}`,
      amount: cents / 100, actor: x.outside ? { type: 'system', name: 'Stripe Dashboard' } : { type: 'user', name: by || 'Staff' } });
    return { wrote: true, onAccount: true, renterId, stillOwed, reason, label, phrase, card, cents } as RecordedRefund;
  });
}

/** Tell the renter about a refund to their card, once (each refund by its own name, shared with Stripe's notice of it). */
export async function sendRenterRefundNotice(db: any, tenantId: string, tenant: any, o: { key: string; renterId: string; cents: number; card?: any; phrase?: string; reason?: string | null; stillOwed?: boolean }): Promise<string | null> {
  if (!o.renterId || !(o.cents > 0) || !o.key) return null;
  const mark = db.doc(`tenants/${tenantId}/refundNotices/${safe(o.key)}`);
  const claimedAt = new Date().toISOString();
  const mine = await db.runTransaction(async (tx: any) => {
    const s = await tx.get(mark); const m: any = s.exists ? (s.data() || {}) : null;
    if (m && (m.sentAt || !m.claimedAt || Date.now() - Date.parse(String(m.claimedAt)) < 10 * 60e3)) return false;
    tx.set(mark, { key: o.key, kind: 'renter_refund', amountCents: o.cents, renterId: o.renterId, claimedAt }, { merge: true });
    return true;
  }).catch(() => false);
  if (!mine) return null;
  try {
    const { sendRenterMoneyNotice } = await import('@/lib/account-receipts');
    const { linkOrigin } = await import('@/lib/app-origin');
    const base = linkOrigin(tenant);
    const r = await sendRenterMoneyNotice(db, tenantId, tenant, { kind: 'renter_refund', renterId: o.renterId, tokens: {
      amount: usd(o.cents), card: cardText(o.card), what: o.phrase || 'a payment', reason: o.reason ? `Reason: ${String(o.reason).replace(/\.$/, '')}.` : '',
      details: o.stillOwed ? `This amount is still owed, so it's back on your account to pay.` : '', link: base ? `${base}/rent/${encodeURIComponent(tenantId)}?tab=rent` : '' } });
    if (r.sentTo || r.noContact) await mark.set({ sentAt: new Date().toISOString(), sentTo: r.sentTo || null }, { merge: true });
    else await mark.delete().catch(() => {});
    return r.sentTo;
  } catch (e) { await mark.delete().catch(() => {}); console.error('[renter-refund] notice', tenantId, o.renterId, e); return null; }
}

export type RenterRefundResult =
  | { ok: true; already?: boolean; recordPending?: boolean; refundedCents: number; refundId: string | null; stillOwed: boolean; card: any; sentTo: string | null }
  | { ok: false; status: number; error: string; retry?: boolean };

const NO_ANSWER = 'Stripe didn’t answer, so the refund may or may not have gone through. Press Refund again in a couple of minutes: it won’t refund twice.';

/** Claims on one payment nobody finished: Stripe is asked for a refund made under each. Found, it's recorded; not found,
 *  the claim is let go, so the money can be refunded again. Left as it is when Stripe doesn't answer. */
async function settleStaleClaims(db: any, stripe: any, tenantId: string, tenant: any, txRef: any, nowMs: number): Promise<{ recorded: number; released: number; waiting: number }> {
  const out = { recorded: 0, released: 0, waiting: 0 };
  const t: any = (await txRef.get()).data() || {};
  const stale = Object.entries(t.renterRefunds || {}).filter(([, c]: any) => c?.state === 'refunding' && nowMs - (Date.parse(String(c?.at || '')) || 0) >= REFUND_CLAIM_MS);
  if (!stale.length) {
    // Nothing left on its way: the mark the five-minute check finds it by goes.
    if (t.renterRefundOpenAt && !openAt(t.renterRefunds || {})) await txRef.set({ renterRefundOpenAt: null }, { merge: true }).catch(() => {});
    return out;
  }
  const where = await locatePayment(stripe, tenant, t); if (!where.ok) { out.waiting += stale.length; return out; }
  let list: any[] = [];
  try { const l: any = await stripe.refunds.list({ payment_intent: String(t.stripePaymentIntentId), limit: 100 }, onAccount({ stripeAccountId: where.account })); list = Array.isArray(l?.data) ? l.data : []; }
  catch { out.waiting += stale.length; return out; }
  for (const [k, c] of stale as [string, any][]) {
    const rf = list.find((r: any) => String(r?.metadata?.requestId || '') === k && String(r?.metadata?.transactionId || txRef.id) === txRef.id && !['failed', 'canceled'].includes(String(r?.status || '')));
    if (rf) {
      const rec = await recordRenterRefund(db, tenantId, { transactionId: txRef.id, requestId: k, refundId: String(rf.id), cents: n(rf.amount), card: c?.card || where.card });
      if (rec.renterId) await sendRenterRefundNotice(db, tenantId, tenant, { key: `refund_${rf.id}`, renterId: rec.renterId, cents: n(rf.amount), card: rec.card || where.card, phrase: rec.phrase, reason: rec.reason, stillOwed: rec.stillOwed });
      out.recorded++;
    } else {
      const let_go = await db.runTransaction(async (tx: any) => {
        const cur: any = (await tx.get(txRef)).data() || {};
        const cl: any = (cur.renterRefunds || {})[k];
        if (cl?.state !== 'refunding' || cl.at !== c.at) return false;
        const claims = { ...(cur.renterRefunds || {}), [k]: { ...cl, state: 'released' } };
        tx.set(txRef, { renterRefunds: { [k]: { state: 'released', releasedAt: new Date(nowMs).toISOString() } }, renterRefundOpenAt: openAt(claims) }, { merge: true });
        return true;
      });
      if (let_go) out.released++;
    }
  }
  return out;
}

/** The five-minute check (lib/money-sweep): every renter card payment with a refund claim nobody finished. */
export async function settleStuckRenterRefunds(db: any, tenantId: string, tenant: any, o: { stripe?: any; now?: number } = {}): Promise<{ checked: number; recorded: number; released: number; waiting: number }> {
  const out = { checked: 0, recorded: 0, released: 0, waiting: 0 };
  const now = o.now ?? Date.now();
  const snap = await db.collection(`tenants/${tenantId}/transactions`).where('renterRefundOpenAt', '<=', new Date(now - REFUND_CLAIM_MS).toISOString()).limit(50).get().catch(() => ({ docs: [] as any[] }));
  if (!snap.docs.length) return out;
  let stripe = o.stripe;
  if (!stripe) { const S = (await import('stripe')).default; stripe = new S(process.env.STRIPE_SECRET_KEY || '', { apiVersion: '2024-06-20' as any }); }
  for (const d of snap.docs) {
    out.checked++;
    try { const r = await settleStaleClaims(db, stripe, tenantId, tenant, d.ref, now); out.recorded += r.recorded; out.released += r.released; out.waiting += r.waiting; }
    catch (e: any) { out.waiting++; console.error('[renter-refund] settle', tenantId, d.id, String(e?.message || e).slice(0, 160)); }
  }
  return out;
}

/** Refund part or all of one card payment on a renter's account back to the card. */
export async function refundRenterPayment(db: any, stripe: any, tenantId: string, tenant: any, o: {
  renterId: string; transactionId: string; amountCents: number; reason?: string | null; stillOwed?: boolean; requestId: string; by?: string | null; today?: string; nowMs?: number;
}): Promise<RenterRefundResult> {
  const T = `tenants/${tenantId}`; const nowMs = o.nowMs ?? Date.now(); const at = new Date(nowMs).toISOString();
  const req = safe(o.requestId).slice(0, 80); const txId = safe(o.transactionId);
  const cents = Math.round(n(o.amountCents));
  if (req.length < 8) return { ok: false, status: 400, error: 'Refresh the page and try again.' };
  if (!txId) return { ok: false, status: 400, error: 'Which payment?' };
  if (!(cents > 0)) return { ok: false, status: 400, error: 'Enter an amount to refund.' };
  const txRef = db.doc(`${T}/transactions/${txId}`);
  await settleStaleClaims(db, stripe, tenantId, tenant, txRef, nowMs).catch(() => null);

  // The claim, in one step: what's gone back and what's on its way are counted, so it can never go past what was paid.
  const claim: any = await db.runTransaction(async (tx: any) => {
    const ts = await tx.get(txRef); if (!ts.exists) return { missing: true };
    const t: any = ts.data() || {};
    const isAgreed = t.category === 'Renter Incidental';
    const inv: any = !isAgreed && t.sourceId ? ((await tx.get(db.doc(`${T}/rentInvoices/${safe(t.sourceId)}`))).data() || null) : null;
    if (ownerOf(t, inv) !== o.renterId) return { missing: true };
    const kind = renterPaymentKind(t, new Set(inv && String(inv.renterId || '') === o.renterId ? [String(t.sourceId)] : []), txId);
    if (!kind) return { notCard: true };
    const claims: Record<string, any> = { ...(t.renterRefunds || {}) };
    const mine: any = claims[req] || null;
    if (mine?.state === 'refunded') return { already: true, cents: n(mine.cents), refundId: mine.refundId || null, stillOwed: mine.stillOwed === true, card: mine.card || null };
    // The same request is the same refund: asked again for a different amount, it's refused, never sent as the old one.
    if (mine && n(mine.cents) !== cents) return { changed: n(mine.cents) };
    if (mine?.state === 'refunding') return { t, again: true, cents: n(mine.cents), stillOwed: mine.stillOwed === true, reason: String(mine.reason || '') };
    const left = refundableCents(t, req);
    if (cents > left) return { tooMuch: left, refundedAt: !!t.refundedAt };
    const c = { state: 'refunding', cents, stillOwed: kind !== 'agreed' && o.stillOwed === true, reason: clip(o.reason, 300), by: o.by || null, at };
    claims[req] = c;
    tx.set(txRef, { renterRefunds: { [req]: c }, renterRefundOpenAt: openAt(claims) }, { merge: true });
    return { t, cents, stillOwed: c.stillOwed, reason: c.reason };
  });
  if (claim.missing) return { ok: false, status: 404, error: 'That payment wasn’t found on this renter’s account.' };
  if (claim.notCard) return { ok: false, status: 400, error: 'Only rent paid by card (online or autopay) and agreed charges taken from the card on file can be refunded here.' };
  if (claim.already) return { ok: true, already: true, refundedCents: claim.cents, refundId: claim.refundId, stillOwed: claim.stillOwed, card: claim.card, sentTo: null };
  if (claim.changed !== undefined) return { ok: false, status: 409, error: `This refund was already started for ${usd(claim.changed)}. Close it and start again to refund a different amount.` };
  if (claim.tooMuch !== undefined) return { ok: false, status: 409, error: claim.refundedAt ? 'This payment was already refunded from Money.' : claim.tooMuch > 0 ? `Only ${usd(claim.tooMuch)} of this payment can still be refunded.` : 'This payment has already been refunded in full.' };

  const release = () => db.runTransaction(async (tx: any) => {
    const cur: any = (await tx.get(txRef)).data() || {};
    const cl: any = (cur.renterRefunds || {})[req];
    if (cl?.state !== 'refunding') return;
    const claims = { ...(cur.renterRefunds || {}), [req]: { ...cl, state: 'released' } };
    tx.set(txRef, { renterRefunds: { [req]: { state: 'released', releasedAt: new Date().toISOString() } }, renterRefundOpenAt: openAt(claims) }, { merge: true });
  }).catch(() => {});

  const where = await locatePayment(stripe, tenant, claim.t);
  if (!where.ok) {
    if (where.unknown) {
      // Nothing was asked of Stripe yet on a new claim, so it goes; a claim asked again may already have been sent.
      if (!claim.again) { await release(); return { ok: false, status: 502, error: 'Stripe didn’t answer, so nothing was refunded. Try again in a moment.' }; }
      return { ok: false, status: 502, error: NO_ANSWER, retry: true };
    }
    await release();
    return { ok: false, status: 409, error: 'This payment wasn’t found in your Stripe account, so it can’t be refunded from here.' };
  }
  // Stripe's own count too: a refund made in the Stripe Dashboard that isn't on the books yet still counts.
  if (!claim.again && claim.cents > Math.max(0, where.receivedCents - where.refundedCents)) {
    await release();
    const can = Math.max(0, where.receivedCents - where.refundedCents);
    return { ok: false, status: 409, error: can > 0 ? `Stripe shows only ${usd(can)} of this payment can still be refunded (some was refunded in Stripe).` : 'Stripe shows this payment was already refunded in full.' };
  }
  let rf: any;
  try {
    rf = await stripe.refunds.create({ payment_intent: String(claim.t.stripePaymentIntentId), amount: claim.cents, reason: 'requested_by_customer',
      metadata: { tenantId, renterId: o.renterId, kind: 'renter_refund', origin: 'app', transactionId: txId, requestId: req } },
    onAccount({ stripeAccountId: where.account }, { idempotencyKey: `renter-refund-${txId}-${req}` }));
  } catch (e: any) {
    if (stripeRefused(e)) { await release(); return { ok: false, status: 400, error: `Stripe didn’t refund it: ${String(e?.raw?.message || e?.message || 'the refund was refused').slice(0, 200)}` }; }
    return { ok: false, status: 502, error: NO_ANSWER, retry: true };
  }
  if (['failed', 'canceled'].includes(String(rf?.status || ''))) { await release(); return { ok: false, status: 400, error: 'Stripe couldn’t send this refund to the card. Nothing was refunded.' }; }
  // The money has gone back. If the record can't be written now, Stripe's notice of the refund (or the five-minute
  // check) writes it, and the screen is told it went back.
  let rec: RecordedRefund | null = null;
  try { rec = await recordRenterRefund(db, tenantId, { transactionId: txId, requestId: req, refundId: String(rf.id), cents: claim.cents, card: where.card, at, today: o.today }); }
  catch (e) { console.error('[renter-refund] record', tenantId, txId, e); }
  if (!rec) return { ok: true, recordPending: true, refundedCents: claim.cents, refundId: String(rf.id), stillOwed: claim.stillOwed, card: where.card, sentTo: null };
  const sentTo = rec.renterId ? await sendRenterRefundNotice(db, tenantId, tenant, { key: `refund_${rf.id}`, renterId: rec.renterId, cents: claim.cents, card: rec.card || where.card, phrase: rec.phrase, reason: rec.reason ?? claim.reason, stillOwed: rec.stillOwed ?? claim.stillOwed }) : null;
  return { ok: true, refundedCents: claim.cents, refundId: String(rf.id), stillOwed: rec.stillOwed ?? claim.stillOwed, card: where.card, sentTo };
}

/** Stripe's notice of a refund on a renter's card payment (lib/connect-webhook, charge.refunded). The app's own refund is
 *  recorded if the screen never heard back; one made in the Stripe Dashboard goes on the renter's account; either way the
 *  renter is told once. Returns who it was for and whether it's on their account, so the owners' note about a Dashboard
 *  refund can say so, and its line in the books can name them. Throws when it can't be written, so Stripe sends the
 *  notice again (everything here is safe to receive twice). */
export async function noticeRenterRefund(db: any, tenantId: string, tenant: any, charge: any, rf: any, meta: any, o: { piId?: string | null; outside: boolean }): Promise<{ renterId: string | null; name: string | null; recorded: boolean; onAccount: boolean; transactionId: string | null } | null> {
  const T = `tenants/${tenantId}`;
  if (!rf?.id || ['failed', 'canceled'].includes(String(rf.status || ''))) return null;
  const cents = Math.round(n(rf.amount)); if (!(cents > 0)) return null;
  const card = charge?.payment_method_details?.card ? { brand: charge.payment_method_details.card.brand || null, last4: charge.payment_method_details.card.last4 || null } : null;
  const md = rf.metadata || {};
  const pi = o.piId || (typeof charge?.payment_intent === 'string' ? charge.payment_intent : charge?.payment_intent?.id) || null;
  let today: string | undefined;
  try { const { todayIn, tenantTimeZone } = await import('@/lib/tenant-time'); today = todayIn(tenantTimeZone(tenant)); } catch { today = undefined; }
  // The payment's line in the books: named on the app's refund, or found by its card payment.
  let txId: string | null = md.kind === 'renter_refund' && md.transactionId ? safe(md.transactionId) : null;
  if (!txId && pi) {
    const s = await db.collection(`${T}/transactions`).where('stripePaymentIntentId', '==', String(pi)).limit(10).get();
    for (const x of s.docs) if (await isRenterAccountPaymentIn(db, tenantId, String(x.id), x.data() || {})) { txId = String(x.id); break; }
  }
  const t: any = txId ? ((await db.doc(`${T}/transactions/${txId}`).get()).data() || null) : null;
  // Money a bill didn't need, sent back when it was paid, has no line in the books of its own: the bill says whose it is.
  const invId = safe((t && t.category !== 'Renter Incidental' ? t.sourceId : '') || md.invoiceId || meta?.invoiceId || '');
  const inv: any = invId ? ((await db.doc(`${T}/rentInvoices/${invId}`).get()).data() || null) : null;
  const renterId = String((t ? ownerOf(t, inv) : null) || md.renterId || meta?.renterId || inv?.renterId || '') || null;
  if (!renterId) return null;
  let rec: RecordedRefund = { wrote: false, onAccount: false, renterId };
  if (txId && t) {
    if (md.kind === 'renter_refund') rec = await recordRenterRefund(db, tenantId, { transactionId: txId, requestId: md.requestId || null, refundId: String(rf.id), cents, card, today });
    else if (o.outside) rec = await recordRenterRefund(db, tenantId, { transactionId: txId, refundId: String(rf.id), cents, card, outside: true, reason: 'Refunded in the Stripe Dashboard', today });
  }
  const r: any = (await db.doc(`${T}/renters/${renterId}`).get()).data() || {};
  const name = `${r.firstName || ''} ${r.lastName || ''}`.trim() || null;
  // Money the bill didn't need, sent back by the app when it was paid (lib/rent-online-pay): said plainly.
  const autoWhy = md.kind === 'rent_refund' ? (md.why === 'paid_twice' ? 'This bill was already paid, so the second payment went back.' : md.why === 'not_open' ? 'This bill wasn’t open any more, so the payment went back.' : md.why === 'overpaid' ? 'You paid more than the bill needed, so the extra went back.' : '') : '';
  const due = inv?.dueDate ? String(inv.dueDate).slice(0, 10) : null;
  const phrase = rec.phrase || (t ? paymentPhrase(t, kindOf(t), due) : `your rent payment${due ? ` for the bill due ${shortDay(due)}` : ''}`);
  await sendRenterRefundNotice(db, tenantId, tenant, { key: `refund_${rf.id}`, renterId, cents, card, phrase, reason: rec.reason || autoWhy, stillOwed: rec.stillOwed === true });
  return { renterId, name, recorded: rec.wrote, onAccount: rec.onAccount, transactionId: txId };
}
