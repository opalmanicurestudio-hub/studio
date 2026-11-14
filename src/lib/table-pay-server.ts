// src/lib/table-pay-server.ts — PAY AT THE TABLE, on the server (the guest's page through api/table-pay, the server's
// tablet through api/tab, and closing the table through api/checkout/complete 'table_close').
// - The table's check is a started ticket like any sale the desk begins (pendingCheckouts, lib/reader-sale): the sale as
//   the desk would ring it up (lib/table-bill), kept up to date while the tab changes. Each guest's payment is one share
//   of a split on it, so everything the desk already does for a split bill holds: a card share is checked with the card
//   company before it counts, one that lands after the check is closed is kept apart for a manager (never lost or
//   counted twice), Needs attention shows a check paid and not recorded, and closing records one sale and one receipt.
// - The guest's link is the check's own (a long random key on the visit): it opens this one check and nothing else,
//   and only while it's open.
// - A guest picking seats or items holds them while they pay (20 minutes at most), so two people can't pay for the same
//   thing. The amount is always worked out here; the card company's own form takes the card.
// - Paid in full: the table shows as paid on the host stand and the server's phone says to close it.
import crypto from 'crypto';
import { accountOf, liveShares, readerStripe } from '@/lib/reader-sale';
import { recordCardShare } from '@/lib/screen-pay';
import { deskPrice, listingsOf, saleName } from '@/lib/variants';
import { billFrom, payState, shareFor, tablePayOf, tabSig, tipFor, type Bill, type Choice, type Claim, type PayState } from '@/lib/table-bill';
import { isDepositCredit, spendable } from '@/lib/credit-pools';
import { tableLabel } from '@/lib/table-service';

const ID = /^[A-Za-z0-9_-]{1,160}$/;
export const PAY_TOKEN = /^[A-Za-z0-9_-]{20,40}$/;
const HOLD_MIN = 20;
/** However long a guest keeps their page open, a hold runs out this long after they picked. */
const HOLD_MAX_MIN = 60;
/** Payments being made on one check at once, at most (a link passed around can't hold the whole check). */
const MAX_PAYING = 8;
const r2 = (n: number) => Math.round(n * 100) / 100;
const num = (v: unknown) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const nowIso = () => new Date().toISOString();
export class PayStop extends Error { constructor(public msg: string, public status = 409, public code?: string) { super(msg); } }
/** The house's own client for walk-in tables: a sale is always recorded against a client, and a walk-in table has none. */
export const HOUSE_CLIENT = 'table_guests';

// The menu, read at most every half minute a business (each guest's page asks).
const MENU_MS = 30000;
const menus = new Map<string, { at: number; items: Map<string, any>; listings: Map<string, any>; services: Map<string, any>; withServices: boolean }>();
export const forgetMenu = (T: string) => { menus.delete(T); };
async function menuOf(db: any, T: string, needServices: boolean) {
  const hit = menus.get(T);
  if (hit && Date.now() - hit.at < MENU_MS && (!needServices || hit.withServices)) return hit;
  const inv = (await db.collection(`${T}/inventory`).get()).docs.map((d: any) => ({ id: d.id, ...(d.data() || {}) }));
  const services = needServices ? new Map<string, any>((await db.collection(`${T}/services`).get()).docs.map((d: any) => [d.id, { id: d.id, ...(d.data() || {}) }])) : new Map<string, any>();
  const v = { at: Date.now(), items: new Map<string, any>(inv.map((x: any) => [String(x.id), x])), listings: listingsOf(inv), services, withServices: needServices };
  if (menus.size > 500) menus.clear();
  menus.set(T, v); return v;
}

const deposits = new Map<string, { at: number; v: boolean }>();
/** A deposit that would come off this check at the desk (the visit's own, or one of the client's from a booking that
 *  isn't still to come, as api/checkout/complete picks it). Guests aren't asked to pay what a deposit already covers:
 *  a check with one is taken by the server. Errs toward yes. */
async function depositWaiting(db: any, T: string, visitId: string, clientId: string, client: any): Promise<boolean> {
  const usable = (d: any) => { const c = { id: d.id, ...(d.data() || {}) }; return isDepositCredit(c) && spendable(c) ? c : null; };
  const own = await db.collection(`${T}/depositCredits`).where('sourceAppointmentId', '==', visitId).limit(5).get();
  if (own.docs.some((d: any) => usable(d))) return true;
  if (!clientId || clientId === HOUSE_CLIENT) return false;
  let cs = await db.collection(`${T}/depositCredits`).where('status', '==', 'available').where('clientId', '==', clientId).limit(20).get();
  if (cs.empty && client?.email) cs = await db.collection(`${T}/depositCredits`).where('status', '==', 'available').where('clientEmail', '==', String(client.email).toLowerCase().trim()).limit(20).get();
  for (const c of cs.docs.map(usable).filter(Boolean).slice(0, 10) as any[]) {
    const a: any = (await db.doc(`${T}/appointments/${String(c.sourceAppointmentId)}`).get()).data();
    const upcoming = a && !['cancelled', 'canceled', 'completed', 'no_show', 'noshow', 'rescheduled'].includes(String(a.status || '')) && (Date.parse(String(a.startTime || '')) || 0) > Date.now();
    if (!upcoming) return true;
  }
  return false;
}

export type TableCheck = { visitId: string; visit: any; table: string; bill: Bill; pendingId: string | null; ticket: any | null; claims: Claim[]; st: PayState; clientId: string; deposit: boolean };

/** The visit's check as it stands: the bill (worked out now), its ticket, and who has paid or is paying for what. */
export async function checkOf(db: any, T: string, tenant: any, visitId: string, v?: any): Promise<TableCheck> {
  if (!ID.test(visitId)) throw new PayStop('Which table?', 400);
  const visit: any = v || (await db.doc(`${T}/appointments/${visitId}`).get()).data();
  if (!visit) throw new PayStop('That check isn’t here any more.', 404);
  const tab: any[] = Array.isArray(visit.tab) ? visit.tab : [];
  const menu = await menuOf(db, T, tab.some((l) => l?.itemType === 'service'));
  const clientId = String(visit.clientId || '');
  const client: any = clientId && ID.test(clientId) ? (await db.doc(`${T}/clients/${clientId}`).get()).data() || null : null;
  const mId = client?.activeMembershipId || client?.subscription?.membershipId;
  const memberships = mId && ID.test(String(mId)) ? [(await db.doc(`${T}/memberships/${mId}`).get()).data()].filter(Boolean).map((m: any) => ({ id: mId, ...m })) : [];
  const bill = billFrom(visitId, visit, {
    item: (id) => menu.items.get(id) || menu.services.get(id) || null,
    price: (x) => deskPrice(x, menu.listings), name: (x) => saleName(x, menu.listings),
  }, { tenant, client: client ? { id: clientId, ...client } : null, memberships });
  const pendingId = visit.payTicketId && ID.test(String(visit.payTicketId)) ? String(visit.payTicketId) : null;
  const ticket: any = pendingId ? (await db.doc(`${T}/pendingCheckouts/${pendingId}`).get()).data() || null : null;
  const claims = claimsOf(ticket);
  const st = payState(claims, Date.now());
  // (Only matters until someone has paid; asked at most once a minute a table.)
  const dk = `${T}|${visitId}|${clientId}`; const dHit = deposits.get(dk);
  const deposit = visit.status === 'completed' || st.paid > 0 ? false
    : dHit && Date.now() - dHit.at < 60000 ? dHit.v
    : await depositWaiting(db, T, visitId, clientId, client).then((v) => { if (deposits.size > 2000) deposits.clear(); deposits.set(dk, { at: Date.now(), v }); return v; }).catch(() => true);
  return { visitId, visit, table: tableLabel(visit.tableName) || 'Your table', bill, pendingId: ticket ? pendingId : null, ticket, claims, st, clientId: clientId || HOUSE_CLIENT, deposit };
}

/** The ticket's claims, each marked paid when its payment is on the ticket (and not refunded). */
export function claimsOf(ticket: any): (Claim & { holds: number })[] {
  const raw: Record<string, any> = ticket?.tableClaims && typeof ticket.tableClaims === 'object' ? ticket.tableClaims : {};
  const live = liveShares(ticket);
  const paidPi = new Set(live.map((x: any) => String(x.stripePaymentIntentId || '')).filter(Boolean));
  const paidTender = new Set(live.map((x: any) => String(x.id || '')).filter(Boolean));
  return Object.values(raw).filter((c: any) => c && c.id).map((c: any) => ({
    id: String(c.id), way: c.way, lineIds: Array.isArray(c.lineIds) ? c.lineIds.map(String) : [], parts: num(c.parts), ways: num(c.ways), amount: num(c.amount), tip: num(c.tip),
    label: String(c.label || ''), piId: c.piId ? String(c.piId) : null, at: String(c.at || ''), until: c.until ? String(c.until) : null,
    paid: (!!c.piId && paidPi.has(String(c.piId))) || (!!c.tenderId && paidTender.has(String(c.tenderId))),
    stuck: !!c.stuck, holds: num(c.holds),
  }));
}

/** What the sale is recorded with: as the desk would send it for this table, paid as a split. */
export function payloadFor(tenantId: string, ck: TableCheck): any {
  return { tenantId, clientId: ck.clientId, appointmentIds: [ck.visitId], items: ck.bill.items, noScan: [], feeIds: [], discountCodes: [], redeemedOffer: null, waivedAppointmentIds: [], waivers: {},
    tipAllocations: {}, tip: 0, storeCredit: 0, creditAtPayment: true, giftCards: [], skipGroupDiscount: false, skipMomentReward: true, skipMemberDiscount: false, staffDiscount: null, heldStock: null,
    recovery: { amount: 0, reason: '', approvalToken: null }, payment: { method: 'split', amountTendered: 0, stripePaymentIntentId: null, cardSurcharge: 0, skipLedger: false }, tillId: null,
    deskId: 'table', expectedTotal: ck.bill.total, source: 'table' };
}

/** The house's client for a walk-in table's sale, made once. */
async function houseClient(db: any, T: string) {
  const ref = db.doc(`${T}/clients/${HOUSE_CLIENT}`);
  if ((await ref.get()).exists) return;
  // (Its status is the house's own, so it's never in the client list, a message list or a count of clients.)
  await ref.set({ id: HOUSE_CLIENT, name: 'Table guests', isHouse: true, status: 'house', source: 'tables', createdAt: nowIso(), marketingOptIn: false, emailOptIn: false, smsOptIn: false, tags: [] }, { merge: true });
}

/** The check's ticket, made once and kept up to date with the tab (never once it's closed). Returns its id. */
export async function ensureTicket(db: any, T: string, tenantId: string, ck: TableCheck): Promise<string> {
  if (ck.clientId === HOUSE_CLIENT) await houseClient(db, T);
  const vRef = db.doc(`${T}/appointments/${ck.visitId}`);
  const payload = payloadFor(tenantId, ck);
  const id: string = await db.runTransaction(async (tx: any) => {
    const v: any = (await tx.get(vRef)).data() || {};
    const cur = v.payTicketId && ID.test(String(v.payTicketId)) ? String(v.payTicketId) : null;
    const tRef = cur ? db.doc(`${T}/pendingCheckouts/${cur}`) : null;
    const t: any = tRef ? (await tx.get(tRef)).data() || null : null;
    if (v.status === 'completed') throw new PayStop('This check is closed.', 409, 'closed');
    const at = nowIso();
    if (t && !['completed', 'discarded', 'discarding'].includes(String(t.status || ''))) {
      if (Math.abs(num(t.expectedTotal) - ck.bill.total) > 0.001 || JSON.stringify(t.payload?.items || []) !== JSON.stringify(payload.items) || t.clientId !== ck.clientId)
        tx.set(tRef, { payload, expectedTotal: ck.bill.total, clientId: ck.clientId, updatedAt: at }, { merge: true });
      return cur as string;
    }
    if (t && t.status === 'completed') throw new PayStop('This check is closed.', 409, 'closed');
    const n = Math.max(0, Math.floor(num(v.payTicketN))) + 1;
    const newId = `table_${ck.visitId}_${n}`.slice(0, 150);
    tx.set(db.doc(`${T}/pendingCheckouts/${newId}`), { id: newId, status: 'prepared', payload, clientId: ck.clientId, clientName: ck.clientId === HOUSE_CLIENT ? 'Table guests' : (v.clientName || null), expectedTotal: ck.bill.total,
      preparedAt: at, updatedAt: at, preparedBy: 'Pay at the table', deskId: 'table', source: 'table', visitId: ck.visitId, tableName: ck.table, tableClaims: {} });
    tx.set(vRef, { payTicketId: newId, payTicketN: n }, { merge: true });
    return newId;
  });
  return id;
}

/** The check's own link key, made once. */
export async function payTokenOf(db: any, T: string, visitId: string): Promise<string> {
  const vRef = db.doc(`${T}/appointments/${visitId}`);
  return db.runTransaction(async (tx: any) => {
    const v: any = (await tx.get(vRef)).data();
    if (!v) throw new PayStop('That table wasn’t found.', 404);
    if (v.payToken && PAY_TOKEN.test(String(v.payToken))) return String(v.payToken);
    const t = crypto.randomBytes(16).toString('base64url');
    tx.set(vRef, { payToken: t }, { merge: true });
    return t;
  });
}
/** The visit a guest's link is for. */
export async function visitByToken(db: any, T: string, token: string): Promise<{ id: string; v: any } | null> {
  if (!PAY_TOKEN.test(token)) return null;
  const s = await db.collection(`${T}/appointments`).where('payToken', '==', token).limit(1).get();
  if (s.empty) return null;
  return { id: s.docs[0].id, v: s.docs[0].data() || {} };
}

/** Whether the check can be paid now, and why not. */
export function payableWhy(tenant: any, ck: TableCheck): string | null {
  if (!tablePayOf(tenant).on) return 'Paying at the table isn’t on here. Your server can take it.';
  if (ck.visit.status === 'completed') return 'This check is closed. Thank you!';
  if (ck.bill.unfired.length) return 'Part of your order hasn’t gone to the kitchen yet. Ask your server.';
  if (ck.bill.missing.length) return 'Something on your check needs your server. Ask them to take it.';
  if (!(ck.bill.total > 0)) return 'There’s nothing to pay yet.';
  if (ck.deposit && !(ck.st.paid > 0)) return 'There’s a deposit on this check. Your server takes it off and takes the rest.';
  return null;
}

/** Fully paid: the visit says so (the host stand shows the table paid, the server's phone says to close it), for the
 *  tab as it was then: anything rung in or taken off since, and it isn't paid in full any more (lib/floor-server). */
async function notePaid(db: any, T: string, ck: TableCheck, ticket: any, total = num(ticket?.expectedTotal)) {
  const claims = claimsOf(ticket); const st = payState(claims, Date.now());
  const paid = r2(liveShares(ticket).reduce((s: number, x: any) => s + num(x.amount), 0));
  const full = paid + 0.009 >= total && total > 0;
  const sig = tabSig(ck.visit?.tab);
  const next = { payPaidAt: full ? (ck.visit.payPaidAt && ck.visit.payPaidTab === sig ? ck.visit.payPaidAt : nowIso()) : null, payPaidTab: full ? sig : null, payPaidSoFar: paid };
  // (Written only when it changes: the server's tablet asks every few seconds.)
  if ((ck.visit.payPaidAt || null) !== next.payPaidAt || (ck.visit.payPaidTab || null) !== next.payPaidTab || num(ck.visit.payPaidSoFar) !== paid || ck.visit.payPaidSoFar === undefined)
    await db.doc(`${T}/appointments/${ck.visitId}`).set(next, { merge: true });
  return { full, paid, st };
}

/** A guest starts paying: their share held for them, and the card company's form made for exactly it. `replace`: a
 *  share they started before (changed their mind): let go first. */
export async function startShare(db: any, T: string, tenant: any, tenantId: string, visitId: string, body: { choice: Choice; tip?: { pct?: number | null; amount?: number | null }; replace?: string | null },
  o: { stripe?: any } = {}): Promise<{ claimId: string; amount: number; tip: number; label: string; clientSecret: string; publishableKey: string; stripeAccount: string }> {
  const acct = accountOf(tenant); const stripe = o.stripe || readerStripe();
  if (!acct || !stripe || !process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY) throw new PayStop('Card payments aren’t set up here yet. Your server can take it.', 409);
  let ck = await checkOf(db, T, tenant, visitId);
  const why = payableWhy(tenant, ck); if (why) throw new PayStop(why);
  const pendingId = await ensureTicket(db, T, tenantId, ck);
  // Payments started and left (the page closed): called off, so their seats and items are free again.
  await letGoStale(db, T, tenant, pendingId, { stripe, also: body.replace || null });
  ck = await checkOf(db, T, tenant, visitId);
  const s = tablePayOf(tenant);
  const claimId = crypto.randomBytes(8).toString('hex');
  const tRef = db.doc(`${T}/pendingCheckouts/${pendingId}`);
  const made: any = await db.runTransaction(async (tx: any) => {
    const t: any = (await tx.get(tRef)).data();
    if (!t || ['completed', 'discarded', 'discarding'].includes(String(t.status || ''))) throw new PayStop('This check is closed.', 409, 'closed');
    const claims = claimsOf(t); const st = payState(claims, Date.now());
    if (claims.filter((c) => !c.paid && !c.stuck && c.until && Date.parse(c.until) > Date.now()).length >= MAX_PAYING) throw new PayStop('A lot of people are paying at once. Try again in a minute.', 429);
    const sh = shareFor(ck.bill, st, body.choice, s); if (!sh.ok) throw new PayStop(sh.error);
    // Never more than what's left on the ticket itself, whatever paid it (the server's cash too).
    const tendered = r2(liveShares(t).reduce((a: number, x: any) => a + num(x.amount), 0));
    if (Math.round((Math.max(tendered, st.paid) + st.claimed + sh.amount) * 100) > Math.round(num(t.expectedTotal) * 100) + 1) throw new PayStop('Part of this check was just paid. Look at it again.', 409, 'changed');
    const tip = tipFor(sh, body.tip || {}, s);
    if (Math.round((sh.amount + tip) * 100) < 50) throw new PayStop('That’s under $0.50, too little for a card. Your server can take it.');
    const way = body.choice.way === 'rest' ? 'rest' : body.choice.way;
    const c = { id: claimId, way, lineIds: sh.lineIds, parts: sh.parts, ways: sh.ways, amount: sh.amount, tip, label: sh.label, piId: null, at: nowIso(), until: new Date(Date.now() + HOLD_MIN * 60000).toISOString() };
    tx.set(tRef, { tableClaims: { [claimId]: c }, updatedAt: nowIso() }, { merge: true });
    return c;
  });
  let pi: any;
  try {
    pi = await stripe.paymentIntents.create({
      amount: Math.round((made.amount + made.tip) * 100), currency: 'usd',
      automatic_payment_methods: { enabled: true, allow_redirects: 'never' },
      description: `${ck.table} check, ${made.label}`.slice(0, 200),
      // Named for this check's ticket, as a share of its split (lib/reader-sale): it can only ever pay this check.
      metadata: { tenantId, source: 'table_phone', pendingCheckoutId: pendingId, split: '1', tipCents: String(Math.round(made.tip * 100)), shareLabel: made.label.slice(0, 120), visitId, claimId },
    }, { stripeAccount: acct, idempotencyKey: `table-${pendingId}-${claimId}` });
  } catch {
    await dropClaim(db, T, pendingId, claimId).catch(() => {});
    throw new PayStop('Paying by phone isn’t working right now. Your server can take it.', 503);
  }
  await db.runTransaction(async (tx: any) => {
    const t: any = (await tx.get(tRef)).data() || {};
    if (t.tableClaims?.[claimId]) tx.set(tRef, { tableClaims: { [claimId]: { piId: pi.id } } }, { merge: true });
  });
  return { claimId, amount: made.amount, tip: made.tip, label: made.label, clientSecret: pi.client_secret, publishableKey: String(process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY), stripeAccount: acct };
}

async function dropClaim(db: any, T: string, pendingId: string, claimId: string) {
  const tRef = db.doc(`${T}/pendingCheckouts/${pendingId}`);
  await db.runTransaction(async (tx: any) => {
    const t: any = (await tx.get(tRef)).data() || {};
    const all = { ...(t.tableClaims || {}) }; if (!all[claimId]) return;
    delete all[claimId];
    tx.update(tRef, { tableClaims: all });
  });
}

/** Payments started and not finished in time (or one the guest replaced): called off at the card company and let go.
 *  One that went through after all is put on the check instead. */
export async function letGoStale(db: any, T: string, tenant: any, pendingId: string, o: { stripe?: any; also?: string | null } = {}): Promise<{ unsettled: number }> {
  const t: any = (await db.doc(`${T}/pendingCheckouts/${pendingId}`).get()).data(); if (!t) return { unsettled: 0 };
  const now = Date.now(); const acct = accountOf(tenant); const stripe = o.stripe || readerStripe();
  let unsettled = 0;
  // One still going through, or one the card company couldn't be asked about: held two minutes more and asked again
  // then, so nobody pays for the same thing meanwhile (and no cash is taken for it). Still not sorted after ten minutes
  // or so (it went through and can't go on the check, or the card company can't be reached): left for a manager, and the
  // table carries on (the server's card names it, so nobody takes it again without asking).
  const holdOn = async (c: Claim & { holds: number }, inFlight = false) => {
    if (!inFlight && c.holds >= STUCK_AFTER) { await markStuck(db, T, pendingId, c.id).catch(() => {}); return; }
    unsettled++; await extendClaim(db, T, pendingId, c.id, 2).catch(() => {});
  };
  for (const c of claimsOf(t)) {
    if (c.paid || c.way === 'cash' || c.stuck) continue;
    const stale = !c.until || Date.parse(c.until) <= now || (o.also && c.id === o.also);
    if (!stale) continue;
    if (c.piId && acct && stripe) {
      let pi: any = null;
      try { pi = await stripe.paymentIntents.retrieve(c.piId, {}, { stripeAccount: acct }); } catch { await holdOn(c); continue; }
      if (pi?.status === 'succeeded') { const r = await settleShare(db, T, tenant, pendingId, c.piId, { stripe }).catch(() => null); if (!r?.paid && !r?.keptApart) await holdOn(c); continue; }
      if (pi?.status === 'processing') { await holdOn(c, true); continue; }
      if (pi?.status !== 'canceled') { try { await stripe.paymentIntents.cancel(c.piId, {}, { stripeAccount: acct }); } catch { await holdOn(c); continue; } }
    }
    await dropClaim(db, T, pendingId, c.id);
  }
  return { unsettled };
}

/** A claim held `min` minutes from now (never past HOLD_MAX_MIN from when it was made, unless it's being settled). */
async function extendClaim(db: any, T: string, pendingId: string, claimId: string, min: number, capped = false): Promise<boolean> {
  const tRef = db.doc(`${T}/pendingCheckouts/${pendingId}`);
  return db.runTransaction(async (tx: any) => {
    const t: any = (await tx.get(tRef)).data() || {};
    const c = t.tableClaims?.[claimId]; if (!c) return false;
    let until = Date.now() + min * 60000;
    if (capped) { const at = Date.parse(String(c.at || '')) || 0; until = Math.min(until, at + HOLD_MAX_MIN * 60000); if (until <= Date.now()) return false; }
    tx.set(tRef, { tableClaims: { [claimId]: { until: new Date(until).toISOString(), ...(capped ? {} : { holds: num(c.holds) + 1 }) } } }, { merge: true });
    return true;
  });
}

const STUCK_AFTER = 5;
async function markStuck(db: any, T: string, pendingId: string, claimId: string) {
  const tRef = db.doc(`${T}/pendingCheckouts/${pendingId}`);
  await db.runTransaction(async (tx: any) => {
    const t: any = (await tx.get(tRef)).data() || {};
    if (!t.tableClaims?.[claimId]) return;
    tx.set(tRef, { tableClaims: { [claimId]: { stuck: true, stuckAt: nowIso() } }, updatedAt: nowIso() }, { merge: true });
  });
}

/** The guest's page is still open on the card form: their hold kept (up to an hour from when they picked). False when
 *  it's run out (let go, or paid): they pick again. */
export async function keepShare(db: any, T: string, pendingId: string, claimId: string): Promise<boolean> {
  const t: any = (await db.doc(`${T}/pendingCheckouts/${pendingId}`).get()).data();
  const c = claimsOf(t).find((x) => x.id === claimId);
  if (!c || c.paid || c.stuck || !c.until || Date.parse(c.until) <= Date.now()) return false;
  return extendClaim(db, T, pendingId, claimId, HOLD_MIN, true);
}

/** A guest's card payment the card company says went through: on the check as one share (once, whichever hears first:
 *  their page, or the payment notice through lib/connect-webhook). */
export async function settleShare(db: any, T: string, tenant: any, pendingId: string, piId: string, o: { stripe?: any } = {}): Promise<{ paid: boolean; pending?: boolean; keptApart?: boolean; full?: boolean }> {
  const acct = accountOf(tenant); const stripe = o.stripe || readerStripe();
  if (!acct || !stripe) throw new PayStop('Card payments aren’t set up here.', 409);
  let pi: any;
  try { pi = await stripe.paymentIntents.retrieve(piId, {}, { stripeAccount: acct }); } catch { throw new PayStop('We couldn’t reach card payments just now. Try again in a moment.', 503); }
  const m: any = pi?.metadata || {};
  if (m.source !== 'table_phone' || String(m.pendingCheckoutId || '') !== pendingId || String(m.tenantId || '') !== T.split('/')[1]) throw new PayStop('That payment isn’t for this check.', 409);
  if (pi.status === 'processing') return { paid: false, pending: true };
  if (pi.status !== 'succeeded') return { paid: false };
  const cents = Math.round(num(pi.amount_received || pi.amount)); const tipCents = Math.max(0, Math.round(num(m.tipCents)));
  const r = await recordCardShare(db, T.split('/')[1], pendingId, pi, { amount: (cents - tipCents) / 100, tip: tipCents / 100, label: m.shareLabel || null, via: 'table_phone', by: 'Paid at the table' });
  if (r === 'kept_apart') return { paid: false, keptApart: true };
  if (r !== 'added' && r !== 'already') throw new PayStop('That payment couldn’t go on this check. Show this screen to your server.', 409);
  const t: any = (await db.doc(`${T}/pendingCheckouts/${pendingId}`).get()).data() || {};
  const visitId = String(t.visitId || m.visitId || '');
  let full = false;
  if (ID.test(visitId)) { const v: any = (await db.doc(`${T}/appointments/${visitId}`).get()).data() || {}; full = (await notePaid(db, T, { visitId, visit: v } as any, t)).full; }
  return { paid: true, full };
}

/** The server's view of the check: the link to show, what's paid, by whom and how, and what's left. */
export async function checkStatus(db: any, T: string, tenant: any, tenantId: string, visitId: string, origin: string) {
  const token = await payTokenOf(db, T, visitId);
  // A payment that went through while nobody was watching (the guest's page closed, the notice didn't come) goes on
  // the check now; one started and left is let go.
  { const v0: any = (await db.doc(`${T}/appointments/${visitId}`).get()).data();
    const pid = v0?.status !== 'completed' && v0?.payTicketId && ID.test(String(v0.payTicketId)) ? String(v0.payTicketId) : '';
    if (pid) await letGoStale(db, T, tenant, pid).catch(() => null); }
  const ck = await checkOf(db, T, tenant, visitId);
  const why = payableWhy(tenant, ck);
  // (The check's ticket is made when someone first pays, never just because the code was shown.)
  const ticket = ck.ticket;
  const shares = liveShares(ticket).map((x: any) => ({ label: String(x.label || x.payerName || 'A payment'), amount: num(x.amount), tip: num(x.tip), how: x.method === 'cash' ? 'cash' : x.via === 'table_phone' ? 'phone' : 'card', at: x.at || null }));
  const paid = r2(shares.reduce((s, x) => s + x.amount, 0));
  // What's left is worked out on the check as it stands now (the tab can change after someone pays).
  const total = ck.visit.status === 'completed' && ticket ? num(ticket.expectedTotal) : ck.bill.total;
  const claims = claimsOf(ticket); const st = payState(claims, Date.now());
  if (ticket && ck.visit.status !== 'completed') await notePaid(db, T, ck, ticket, total);
  return { url: `${origin.replace(/\/+$/, '')}/bill/${encodeURIComponent(tenantId)}/${token}`, why, closed: ck.visit.status === 'completed', total, paid, left: Math.max(0, r2(total - paid)), shares,
    paying: claims.filter((c) => !c.paid && !c.stuck && c.until && Date.parse(c.until) > Date.now()).map((c) => ({ label: c.label, amount: c.amount })),
    stuck: claims.filter((c) => c.stuck && !c.paid).map((c) => ({ label: c.label, amount: r2(c.amount + c.tip), piId: c.piId })),
    pendingId: ticket ? (ck.pendingId || ticket.id || null) : null, full: paid + 0.009 >= total && total > 0, st: { way: st.way } };
}

/** The rest paid in cash at the table (the server took it): one cash share for what's left. */
export async function cashRest(db: any, T: string, tenant: any, tenantId: string, visitId: string, by: string, given?: number | null) {
  const ck = await checkOf(db, T, tenant, visitId);
  const why = payableWhy({ ...tenant, kitchenSettings: { ...(tenant?.kitchenSettings || {}), tablePay: { ...(tenant?.kitchenSettings?.tablePay || {}), on: true } } }, ck);
  if (why) throw new PayStop(why);
  const pendingId = await ensureTicket(db, T, tenantId, ck);
  // A phone payment started and left: called off first, so it can't also be paid after the cash. One that went through
  // goes on the check first; one still going through (or one that couldn't be checked) waits.
  const g = await letGoStale(db, T, tenant, pendingId);
  if (g.unsettled) throw new PayStop('A payment on someone’s phone is still going through. Try again in a minute.');
  const tenderId = crypto.randomBytes(6).toString('hex'); const claimId = crypto.randomBytes(8).toString('hex');
  const tRef = db.doc(`${T}/pendingCheckouts/${pendingId}`);
  // What's left, the cash and what it covers, in one step: nobody can start paying in between.
  const out = await db.runTransaction(async (tx: any) => {
    const t: any = (await tx.get(tRef)).data();
    if (!t || ['completed', 'discarded', 'discarding'].includes(String(t.status || ''))) throw new PayStop('This check is closed.', 409, 'closed');
    const st = payState(claimsOf(t), Date.now());
    if (st.claimed > 0) throw new PayStop('Someone at the table is paying on their phone right now. Wait a moment.');
    const tenders: any[] = Array.isArray(t.tenders) ? t.tenders : [];
    const tendered = r2(liveShares(t).reduce((a: number, x: any) => a + num(x.amount), 0));
    const left = r2(num(t.expectedTotal) - tendered);
    if (!(left > 0)) throw new PayStop('Nothing’s left to pay.');
    const cashGiven = given !== undefined && given !== null && Number.isFinite(Number(given)) ? Math.max(left, r2(Number(given))) : left;
    const label = tendered > 0 ? 'The rest' : 'The check'; const at = nowIso();
    const open = ck.bill.lines.filter((l) => !st.covered.has(l.lineId)).map((l) => l.lineId);
    const next = [...tenders, { id: tenderId, method: 'cash', amount: left, tip: 0, cashGiven, label, payerName: null, payerClientId: null, at, by }];
    const paidSoFar = r2(next.filter((x: any) => x && !x.refundedAt).reduce((a: number, x: any) => a + num(x.amount) + num(x.tip), 0));
    tx.set(tRef, { tenders: next, status: 'partial', paidSoFar, updatedAt: at,
      tableClaims: { [claimId]: { id: claimId, way: 'cash', lineIds: open, parts: 0, ways: 0, amount: left, tip: 0, label, tenderId, at, until: null } } }, { merge: true });
    return { left, cashGiven };
  });
  const t: any = (await tRef.get()).data() || {};
  await notePaid(db, T, ck, t);
  return { left: out.left, change: r2(out.cashGiven - out.left) };
}

/** Why a line on the tab can't be comped or voided now: it's been paid for at the table, or someone is paying for it.
 *  (Taking it off would leave the guests paid for more than the check comes to.) Null when it can. */
export async function payLockOf(db: any, T: string, visit: any, lineId: string): Promise<string | null> {
  const pid = visit?.payTicketId && ID.test(String(visit.payTicketId)) ? String(visit.payTicketId) : '';
  if (!pid) return null;
  const t: any = (await db.doc(`${T}/pendingCheckouts/${pid}`).get()).data();
  if (!t || ['completed', 'discarded'].includes(String(t.status || ''))) return null;
  const st = payState(claimsOf(t), Date.now());
  const mine = (id: string) => id === lineId || id.startsWith(`${lineId}.`);
  if ([...st.covered].some(mine)) return 'A guest paid for this on their phone, so it can’t come off the check now. A manager can refund it in Money once the check is closed.';
  if ([...st.busy].some(mine)) return 'A guest is paying for this on their phone right now. Try again in a minute.';
  if (st.way === 'even' && st.paid > 0) return 'Part of this check was paid evenly at the table, so nothing can come off it now. A manager can refund the difference in Money once it’s closed.';
  return null;
}
