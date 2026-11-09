// src/lib/event-tickets.ts — TICKETS FOR A PAID EVENT, BOUGHT ON THE EVENT'S PAGE (server).
//
// The business sets a price per ticket on the event (ticketingConfig { type: 'paid', price }). A guest picks how many,
// gives their name and email, and pays on Stripe's checkout on the business's own account, so the money is paid out to
// the business like any other payment it takes.
//   - Places are held while the guest pays (an order, status 'pending', until its checkout closes), so an event with a
//     limit never sells more tickets than it has places, even when several people buy at once.
//   - Once paid (Stripe's notice, or the guest's return to the page, whichever comes first; safe to run twice), the
//     guests go on the event's guest list (the one the manifest reads), the sale goes in the books, the buyer gets a
//     confirmation and the owner is told. The processing fee is written by the payments notice (lib/connect-webhook).
//   - The business can refund an order (or every order, when it cancels the event): the money goes back to the card,
//     its guests come off the list, and the refund goes in the books. Nothing is ever charged automatically.
// A paused or locked business sells nothing (the route asks lib/tenant-open-server first).

import type { Firestore } from 'firebase-admin/firestore';
import { createCheckoutSession } from '@/lib/pay-later';
import { linkOrigin } from '@/lib/app-origin';
import { spacePayAccount } from '@/lib/space-stripe';
import { eventCapacity } from '@/lib/studio-page';
import { eventState } from '@/lib/event-guest-link';

export const MAX_TICKETS = 8;
const CHECKOUT_MS = 31 * 60000;               // Stripe keeps a checkout open at least 30 minutes
const HOLD_MS = CHECKOUT_MS + 2 * 60000;       // places stay held a little past it, so a payment never lands unheld
const ID = /^[A-Za-z0-9_-]{1,80}$/;
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const clip = (v: any, n: number) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
const money = (cents: number) => `$${(cents / 100).toFixed(2).replace(/\.00$/, '')}`;
const HICCUP = ['StripeConnectionError', 'StripeAPIError', 'StripeRateLimitError'];

/** An event's price per ticket in cents, or 0 when it's free (or by invitation). */
export function ticketCents(ev: any): number {
  if (ev?.ticketingConfig?.type === 'comp_only') return 0;
  const p = Number(ev?.ticketingConfig?.price);
  return p > 0 ? Math.round(p * 100) : 0;
}
export const isPaidEvent = (ev: any) => ticketCents(ev) > 0;

/** Places held by checkouts still open (the guests are paying now). */
export function heldPlaces(orders: any[], now = Date.now()): number {
  return (orders || []).filter((o) => o?.status === 'pending' && Date.parse(String(o.holdUntil || '')) > now).reduce((n, o) => n + (Number(o.qty) || 0), 0);
}

/** Places left for sale: the limit, less the guest list and the places held by open checkouts. null when there's no limit. */
export function placesLeft(ev: any, guestCount: number, orders: any[], now = Date.now()): number | null {
  const cap = eventCapacity(ev); return cap > 0 ? Math.max(0, cap - guestCount - heldPlaces(orders, now)) : null;
}

/** Why tickets can't be bought now, or null when they can. */
export function saleBlock(ev: any, tenant: any, today: string): string | null {
  const s = eventState(ev, today);
  if (s === 'cancelled') return 'This event has been canceled.';
  if (s === 'over') return 'This event has already happened.';
  if (!isPaidEvent(ev)) return 'Tickets for this event aren’t for sale here.';
  if (!spacePayAccount(tenant) || !process.env.STRIPE_SECRET_KEY) return 'Tickets aren’t on sale online yet. Please ask the business.';
  return null;
}

const whenOf = (ev: any) => {
  const d = /^\d{4}-\d{2}-\d{2}$/.test(String(ev?.date || '')) ? new Date(`${ev.date}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC' }) : '';
  const t = /^\d{2}:\d{2}$/.test(String(ev?.time || '')) ? (() => { const h = Number(ev.time.slice(0, 2)), m = ev.time.slice(3); return `${h % 12 || 12}${m === '00' ? '' : `:${m}`}${h < 12 ? 'am' : 'pm'}`; })() : '';
  return [d, t].filter(Boolean).join(' at ');
};

export type StartResult = { ok: true; url: string; orderId: string } | { ok: false; error: string; status: number; left?: number };

/** Holds the places and opens a checkout on the business's account. */
export async function startTicketOrder(db: Firestore, stripe: any, input: { tenantId: string; eventId: string; name: any; email: any; phone?: any; qty: any; origin: string; today: string; visitor?: string }): Promise<StartResult> {
  const { tenantId, eventId } = input;
  if (!ID.test(tenantId) || !ID.test(eventId)) return { ok: false, error: 'This link isn’t complete.', status: 400 };
  const name = clip(input.name, 120), email = String(input.email ?? '').trim().toLowerCase().slice(0, 160), phone = clip(input.phone, 40);
  const qty = Math.max(1, Math.min(MAX_TICKETS, Math.floor(Number(input.qty) || 1)));
  if (!name || !EMAIL.test(email)) return { ok: false, error: 'Add your name and email.', status: 400 };
  const T = `tenants/${tenantId}`;
  const t: any = (await db.doc(T).get()).data();
  const evRef = db.doc(`${T}/studioEvents/${eventId}`);
  const ev0: any = (await evRef.get()).data();
  if (!t || !ev0) return { ok: false, error: 'We couldn’t find this event.', status: 404 };
  const block = saleBlock(ev0, t, input.today); if (block) return { ok: false, error: block, status: 409 };
  const account = spacePayAccount(t)!;
  const orders = db.collection(`${T}/eventTicketOrders`); const orderRef = orders.doc();

  const held = await db.runTransaction(async (tx: any) => {
    const ev: any = (await tx.get(evRef)).data();
    const b = ev ? saleBlock(ev, t, input.today) : 'We couldn’t find this event.'; if (b) return { ok: false as const, error: b };
    const guests = (await tx.get(db.collection(`${T}/eventGuests`).where('eventId', '==', eventId))).size;
    const open = (await tx.get(orders.where('eventId', '==', eventId))).docs.map((d: any) => d.data() || {});
    const left = placesLeft(ev, guests, open);
    if (left === 0) return { ok: false as const, error: 'This event is sold out.', left: 0 };
    // Three checkouts open at a time from any one connection (a group on one Wi-Fi can still buy together), so nobody can
    // hold an event's places by opening more.
    const mine = input.visitor ? open.filter((o: any) => o.visitor === input.visitor && o.status === 'pending' && !o.checkoutFailed && Date.parse(String(o.holdUntil || '')) > Date.now()).length : 0;
    if (mine >= 3) return { ok: false as const, error: 'You already have a checkout open for this event. Finish it there, or try again in half an hour.' };
    if (left !== null && qty > left) return { ok: false as const, error: `Only ${left} ${left === 1 ? 'ticket is' : 'tickets are'} left.`, left };
    const cents = ticketCents(ev); const now = new Date();
    tx.set(orderRef, { id: orderRef.id, tenantId, eventId, eventTitle: clip(ev.title || ev.name, 120) || 'the event', status: 'pending', qty, unitCents: cents, totalCents: cents * qty,
      name, email, phone: phone || null, account, createdAt: now.toISOString(), holdUntil: new Date(now.getTime() + HOLD_MS).toISOString(), ...(input.visitor ? { visitor: input.visitor } : {}) });
    // Touched so two checkouts opening at the same moment can't both take the last places.
    tx.set(evRef, { ticketsTouchedAt: now.toISOString() }, { merge: true });
    return { ok: true as const, cents, title: clip(ev.title || ev.name, 120) || 'Event', ev };
  });
  if (!held.ok) return { ok: false, error: held.error, status: 409, ...(typeof (held as any).left === 'number' ? { left: (held as any).left } : {}) };

  const base = `${linkOrigin(t, input.origin)}/event/${encodeURIComponent(tenantId)}/${encodeURIComponent(eventId)}`;
  const meta = { kind: 'event_ticket', tenantId, eventId, orderId: orderRef.id };
  const params = {
      mode: 'payment', payment_method_types: ['card'],
      line_items: [{ quantity: qty, price_data: { currency: 'usd', unit_amount: held.cents, product_data: { name: `Ticket: ${held.title}`, ...(whenOf(held.ev) ? { description: whenOf(held.ev) } : {}) } } }],
      customer_email: email,
      expires_at: Math.floor((Date.now() + CHECKOUT_MS) / 1000),
      payment_intent_data: { receipt_email: email, metadata: meta },
      metadata: meta,
      success_url: `${base}?paid={CHECKOUT_SESSION_ID}`,
      cancel_url: `${base}?left=${orderRef.id}`,
  };
  // Asked twice with the same key if the first answer is lost (Stripe gives back the same checkout, never a second).
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const session = await createCheckoutSession(stripe, params, { stripeAccount: account, idempotencyKey: `event-ticket-${orderRef.id}` });
      if (!session?.url) throw new Error('no checkout url');
      await orderRef.set({ sessionId: String(session.id) }, { merge: true });
      return { ok: true, url: String(session.url), orderId: orderRef.id };
    } catch (e: any) { console.error('[event-tickets] checkout not opened', tenantId, eventId, attempt, e?.message || e); }
  }
  // Not opened: the hold is left to run out by itself (in case Stripe made the checkout after all), and it doesn't count
  // against the guest's own open checkouts, so they can try again.
  await orderRef.set({ checkoutFailed: true, why: 'checkout_not_opened' }, { merge: true }).catch(() => undefined);
  return { ok: false, error: 'Checkout didn’t open. Please try again in a moment.', status: 502 };
}

/** The guest came back without paying: the checkout is closed (so it can't be paid later) and the places are freed.
 *  A checkout that was paid meanwhile is left alone. */
export async function releaseTicketOrder(db: Firestore, stripe: any, tenantId: string, orderId: string): Promise<boolean> {
  if (!ID.test(tenantId) || !ID.test(orderId)) return false;
  const ref = db.doc(`tenants/${tenantId}/eventTicketOrders/${orderId}`);
  const o: any = (await ref.get()).data();
  if (!o || o.status !== 'pending') return false;
  if (o.sessionId) {
    try { await stripe.checkout.sessions.expire(o.sessionId, {}, { stripeAccount: o.account }); }
    catch (e: any) {
      // Already closed: fine. Paid (complete): never released. A passing problem: left for the checkout to close itself.
      const s: any = await stripe.checkout.sessions.retrieve(o.sessionId, {}, { stripeAccount: o.account }).catch(() => null);
      if (!s || s.status !== 'expired') return false;
    }
  }
  return db.runTransaction(async (tx: any) => {
    const cur: any = (await tx.get(ref)).data(); if (cur?.status !== 'pending') return false;
    tx.set(ref, { status: 'expired', endedAt: new Date().toISOString(), why: 'left_checkout' }, { merge: true }); return true;
  });
}

/** Stripe closed an unpaid checkout: its places are freed (from the payments notice). */
export async function expireTicketOrder(db: Firestore, tenantId: string, orderId: string, sessionId: string): Promise<void> {
  if (!ID.test(tenantId) || !ID.test(orderId)) return;
  const ref = db.doc(`tenants/${tenantId}/eventTicketOrders/${orderId}`);
  await db.runTransaction(async (tx: any) => {
    const cur: any = (await tx.get(ref)).data(); if (cur?.status !== 'pending' || (cur.sessionId && cur.sessionId !== sessionId)) return;
    tx.set(ref, { status: 'expired', endedAt: new Date().toISOString(), why: 'checkout_closed' }, { merge: true });
  });
}

export type FinishResult = { ok: true; status: 'paid' | 'pending' | 'sold_out'; title: string; qty: number; name: string } | { ok: false; error: 'not_found' | 'retry' };

/** After payment: the guests go on the list, the sale goes in the books, and both sides are told (once, however often
 *  this runs). `given` is the checkout when the caller already has it (the payments notice). */
export async function finishTicketOrder(db: Firestore, stripe: any, tenantId: string, sessionId: string, given?: any): Promise<FinishResult> {
  if (!ID.test(tenantId) || !/^cs_[A-Za-z0-9_]{6,200}$/.test(sessionId)) return { ok: false, error: 'not_found' };
  const T = `tenants/${tenantId}`;
  const t: any = (await db.doc(T).get()).data(); if (!t) return { ok: false, error: 'not_found' };
  // The order this checkout belongs to: from the checkout's own details when we have them, else found by the checkout.
  let orderId = String(given?.id === sessionId ? given?.metadata?.orderId || '' : '');
  if (!orderId) { const q = await db.collection(`${T}/eventTicketOrders`).where('sessionId', '==', sessionId).limit(1).get(); orderId = q.empty ? '' : q.docs[0].id; }
  if (!ID.test(orderId)) return { ok: false, error: 'not_found' };
  const ref = db.doc(`${T}/eventTicketOrders/${orderId}`);
  const o: any = (await ref.get()).data();
  if (!o || o.tenantId !== tenantId || (o.sessionId && o.sessionId !== sessionId)) return { ok: false, error: 'not_found' };
  const out = (status: 'paid' | 'pending' | 'sold_out') => ({ ok: true as const, status, title: String(o.eventTitle || 'the event'), qty: Number(o.qty) || 1, name: String(o.name || '') });
  if (o.status === 'refunded' && o.why === 'sold_out') return out('sold_out');
  if (o.status === 'paid' || o.status === 'refunded') {
    // A confirmation that didn't go the first time is tried again (the return page, Stripe's notice, the daily sweep).
    if (o.status === 'paid' && !o.buyerToldAt) await tellBuyerOnce(db, tenantId, t, ref);
    return out('paid');
  }

  let session: any = given?.id === sessionId ? given : null;
  if (!session) {
    try { session = await stripe.checkout.sessions.retrieve(sessionId, {}, { stripeAccount: o.account }); }
    catch (e: any) { return e?.statusCode === 404 || e?.code === 'resource_missing' ? { ok: false, error: 'not_found' } : { ok: false, error: 'retry' }; }
  }
  const md: any = session?.metadata || {};
  if (md.kind !== 'event_ticket' || md.tenantId !== tenantId || md.orderId !== orderId) return { ok: false, error: 'not_found' };
  if (session.payment_status !== 'paid') return out('pending');

  const piId: string | null = typeof session.payment_intent === 'string' ? session.payment_intent : session.payment_intent?.id || null;
  const paidAt = Number(session.created) > 0 ? new Date(Number(session.created) * 1000).toISOString() : new Date().toISOString();
  const charged = Number(session.amount_total) || Number(o.totalCents) || 0;
  const evRef = db.doc(`${T}/studioEvents/${o.eventId}`);
  const qty = Math.max(1, Math.min(MAX_TICKETS, Number(o.qty) || 1));
  const guestRefs = Array.from({ length: qty }, (_, i) => db.doc(`${T}/eventGuests/ticket_${orderId}_${i + 1}`));
  const lineRef = db.doc(`${T}/transactions/ticket_${orderId}`);

  // One step: the guests (named after the order, so a second run finds them), the sale's line, and the order marked paid.
  const fresh = await db.runTransaction(async (tx: any) => {
    const cur: any = (await tx.get(ref)).data() || {};
    if (cur.status === 'paid' || cur.status === 'refunded') return false;
    if (cur.status === 'refunding') return 'sold_out' as const;
    const ev: any = (await tx.get(evRef)).data() || {};
    const have = await Promise.all(guestRefs.map((g) => tx.get(g)));
    const line = await tx.get(lineRef);
    // Paid after its places were let go (its checkout closed or the guest left it, so this shouldn't happen): it takes
    // them only if they're still free; otherwise the money goes back.
    if (cur.status !== 'pending') {
      const onList = (await tx.get(db.collection(`${T}/eventGuests`).where('eventId', '==', o.eventId))).size;
      const others = (await tx.get(db.collection(`${T}/eventTicketOrders`).where('eventId', '==', o.eventId))).docs.map((d: any) => d.data() || {}).filter((x: any) => x.id !== orderId);
      const left = placesLeft(ev, onList, others);
      if (left !== null && left < have.filter((h: any) => !h.exists).length) { tx.set(ref, { status: 'refunding', why: 'sold_out', paymentIntentId: piId, paidCents: charged }, { merge: true }); return 'sold_out' as const; }
    }
    const now = new Date().toISOString(); let added = 0;
    guestRefs.forEach((g, i) => {
      if (have[i].exists) return; added++;
      tx.set(g, { id: g.id, eventId: o.eventId, tenantId, name: i === 0 ? o.name : `${o.name} (guest ${i})`, email: i === 0 ? o.email : '', phone: i === 0 ? (o.phone || '') : '',
        tableId: null, tableNumber: null, seatNumber: null, notes: '', allergies: [], dietaryRestrictions: [], checkedIn: false,
        source: 'ticket', ticketOrderId: orderId, paidCents: Number(o.unitCents) || Math.round(charged / qty), submittedAt: now });
    });
    if (added) tx.set(evRef, { rsvpCount: (Number(ev.rsvpCount) || 0) + added, ticketsSold: (Number(ev.ticketsSold) || 0) + added }, { merge: true });
    if (!line.exists) tx.set(lineRef, { id: lineRef.id, tenantId, date: paidAt, description: `Tickets: ${o.eventTitle || 'event'} (${qty})`, clientOrVendor: o.name || 'Guest',
      type: 'income', context: 'Business', category: 'Event Tickets', amount: charged / 100, paymentMethod: 'Card (Stripe)', taxBucket: 'revenue',
      stripePaymentIntentId: piId, checkoutSessionId: sessionId, eventId: o.eventId, ticketOrderId: orderId, stripeConnectedAccountId: o.account || null, hasReceipt: true });
    tx.set(ref, { status: 'paid', paidAt, paymentIntentId: piId, paidCents: charged, guestIds: guestRefs.map((g) => g.id), transactionId: lineRef.id, holdUntil: null }, { merge: true });
    return true;
  });

  if (fresh === 'sold_out') return await refundSoldOut(db, stripe, tenantId, t, ref, o, piId, charged) ? out('sold_out') : { ok: false, error: 'retry' };
  if (fresh) {
    const after: any = (await ref.get()).data() || {};
    if (!after.buyerToldAt) await tellBuyerOnce(db, tenantId, t, ref);
    if (!after.ownerToldAt && await tellOwner(db, tenantId, t, `${o.name} bought ${qty === 1 ? 'a ticket' : `${qty} tickets`} for ${o.eventTitle || 'your event'} (${money(charged)}).`, `/events/${o.eventId}/manifest`)) await ref.set({ ownerToldAt: new Date().toISOString() }, { merge: true });
  }
  return out('paid');
}

/** Paid after the event sold out: refunded at once, and both sides told. A refund that hit a passing problem is asked
 *  again (Stripe's notice and the daily sweep); the same refund is never sent twice. */
async function refundSoldOut(db: Firestore, stripe: any, tenantId: string, t: any, ref: any, o: any, piId: string | null, charged: number): Promise<boolean> {
  if (!piId) return false;   // a paid checkout always has its payment: tried again until it does
  try { await stripe.refunds.create({ payment_intent: piId, reason: 'requested_by_customer', metadata: { origin: 'app', tenantId, kind: 'event_ticket_refund', orderId: o.id, why: 'sold_out' } }, { stripeAccount: o.account, idempotencyKey: `event-ticket-soldout-${o.id}` }); }
  catch (e: any) { if (e?.code !== 'charge_already_refunded') { console.error('[event-tickets] sold-out refund failed', tenantId, o.id, e?.message); return false; } }
  await ref.set({ status: 'refunded', why: 'sold_out', refundedAt: new Date().toISOString(), refundedCents: charged }, { merge: true });
  await tellOwner(db, tenantId, t, `${o.name} paid for ${o.eventTitle || 'your event'} after it sold out, so their ${money(charged)} was refunded.`, `/events/${o.eventId}/manifest`);
  try {
    const { sendNotification } = await import('@/lib/notify'); const { brandedEmailHtml } = await import('@/lib/email-template');
    const lines = [`Hi ${String(o.name || '').split(' ')[0] || 'there'},`, `${o.eventTitle || 'The event'} sold out while you were paying, so we couldn’t give you a ticket. Your ${money(charged)} is on its way back to your card. It can take a few days to show.`];
    await sendNotification(db, { tenantId, channel: 'email', to: o.email, kind: 'event_ticket', clientName: o.name, subject: `Your payment for ${o.eventTitle || 'the event'} was refunded`, text: lines.join('\n\n'),
      html: brandedEmailHtml({ studioName: String(t?.name || ''), title: 'Sorry, it sold out', bodyLines: lines } as any), recipientType: 'client' } as any);
  } catch { /* the refund itself is what matters */ }
  return true;
}

/** The buyer's confirmation, sent once even when the return page and Stripe's notice finish the order together (the
 *  first to claim it sends; a claim left by a run that stopped is taken over after two minutes). Gives up after 5 tries. */
async function tellBuyerOnce(db: Firestore, tenantId: string, t: any, ref: any): Promise<void> {
  const claimed = await db.runTransaction(async (tx: any) => {
    const cur: any = (await tx.get(ref)).data() || {};
    if (cur.buyerToldAt || (Number(cur.buyerTellTries) || 0) >= 5) return null;
    if (cur.buyerTellingAt && Date.now() - Date.parse(cur.buyerTellingAt) < 120000) return null;
    tx.set(ref, { buyerTellingAt: new Date().toISOString(), buyerTellTries: (Number(cur.buyerTellTries) || 0) + 1 }, { merge: true });
    return cur;
  }).catch(() => null);
  if (!claimed) return;
  const sent = await tellBuyer(db, tenantId, t, claimed, Number(claimed.paidCents) || Number(claimed.totalCents) || 0);
  await ref.set(sent ? { buyerToldAt: new Date().toISOString(), buyerTellingAt: null } : { buyerTellingAt: null }, { merge: true }).catch(() => undefined);
}

async function tellOwner(db: Firestore, tenantId: string, t: any, message: string, link: string): Promise<boolean> {
  try {
    const ids = new Set<string>(t?.userId ? [String(t.userId)] : []);
    (await db.collection(`tenants/${tenantId}/staff`).where('role', 'in', ['admin', 'owner']).get()).docs.forEach((d: any) => ids.add(d.id));
    if (!ids.size) return false; const now = new Date().toISOString(); const b = db.batch();
    ids.forEach((userId) => { const r = db.collection(`tenants/${tenantId}/notifications`).doc(); b.set(r, { id: r.id, userId, type: 'event_tickets', message, link, read: false, createdAt: now }); });
    await b.commit(); return true;
  } catch { return false; }
}

/** The buyer's confirmation: how many tickets, for what, when and where. A record of a payment, so it always goes. */
async function tellBuyer(db: Firestore, tenantId: string, t: any, o: any, charged: number): Promise<boolean> {
  try {
    const ev: any = (await db.doc(`tenants/${tenantId}/studioEvents/${o.eventId}`).get()).data() || {};
    const { sendNotification } = await import('@/lib/notify');
    const { brandedEmailHtml } = await import('@/lib/email-template');
    const qty = Number(o.qty) || 1; const title = String(o.eventTitle || 'the event');
    const lines = [`Hi ${String(o.name || '').split(' ')[0] || 'there'},`, `You have ${qty === 1 ? 'a ticket' : `${qty} tickets`} for ${title}. You paid ${money(charged)}.`,
      ...(whenOf(ev) ? [`When: ${whenOf(ev)}`] : []), ...(ev.venue ? [`Where: ${clip(ev.venue, 120)}`] : []),
      qty > 1 ? 'Your guests are on the list under your name, so just give your name at the door.' : 'Just give your name at the door.'];
    const subject = `Your ${qty === 1 ? 'ticket' : 'tickets'} for ${title}`;
    const r: any = await sendNotification(db, { tenantId, channel: 'email', to: o.email, kind: 'event_ticket', clientName: o.name, subject, text: lines.join('\n\n'),
      html: brandedEmailHtml({ studioName: String(t?.name || ''), title: subject, bodyLines: lines } as any), recipientType: 'client' } as any);
    return !!r?.ok;
  } catch (e: any) { console.error('[event-tickets] confirmation not sent', tenantId, e?.message || e); return false; }
}

export type RefundResult = { ok: true; refundedCents: number; already?: boolean } | { ok: false; error: string; status: number };

/** The business refunds an order: the money goes back to the card, its guests come off the list, and the refund goes in
 *  the books (once: keyed to the order). */
export async function refundTicketOrder(db: Firestore, stripe: any, tenantId: string, orderId: string, by: string | null): Promise<RefundResult> {
  if (!ID.test(tenantId) || !ID.test(orderId)) return { ok: false, error: 'That order wasn’t found.', status: 404 };
  const T = `tenants/${tenantId}`; const ref = db.doc(`${T}/eventTicketOrders/${orderId}`);
  const o: any = (await ref.get()).data();
  if (!o) return { ok: false, error: 'That order wasn’t found.', status: 404 };
  if (o.status === 'refunded') return { ok: true, refundedCents: Number(o.refundedCents) || 0, already: true };
  if (o.status !== 'paid' || !o.paymentIntentId) return { ok: false, error: 'Only a paid order can be refunded.', status: 409 };
  let refund: any; let outside = false;
  try {
    refund = await stripe.refunds.create({ payment_intent: o.paymentIntentId, reason: 'requested_by_customer', metadata: { origin: 'app', tenantId, kind: 'event_ticket_refund', orderId } },
      { stripeAccount: o.account, idempotencyKey: `event-ticket-refund-${orderId}` });
  } catch (e: any) {
    if (e?.code !== 'charge_already_refunded') { console.error('[event-tickets] refund failed', tenantId, orderId, e?.message); return { ok: false, error: HICCUP.includes(e?.type) ? 'Stripe didn’t answer. Please try again in a moment.' : `Stripe didn’t refund it: ${String(e?.message || 'refused')}`, status: 502 }; }
    // Refunded already in the Stripe Dashboard: that refund is in the books (lib/outside-refund), so no second line here.
    outside = true;
  }
  const cents = Number(refund?.amount) || Number(o.paidCents) || 0;
  await markRefunded(db, tenantId, o, { outside, cents, refundId: refund?.id || null, by });
  return { ok: true, refundedCents: cents };
}

/** A paid order refunded in full in the Stripe Dashboard (from the payments notice): its guests come off the list and it
 *  shows as refunded. The refund itself is in the books already (lib/outside-refund). */
export async function syncOutsideTicketRefund(db: Firestore, tenantId: string, orderId: string, cents: number): Promise<boolean> {
  if (!ID.test(tenantId) || !ID.test(orderId)) return false;
  const o: any = (await db.doc(`tenants/${tenantId}/eventTicketOrders/${orderId}`).get()).data();
  if (!o || o.status !== 'paid') return false;
  await markRefunded(db, tenantId, o, { outside: true, cents: cents || Number(o.paidCents) || 0, refundId: null, by: null });
  return true;
}

/** The order marked refunded, its guests off the list, and (unless the refund was made outside the app and so is in
 *  the books already) its refund line: in one step, once. */
async function markRefunded(db: Firestore, tenantId: string, o: any, x: { outside: boolean; cents: number; refundId: string | null; by: string | null }): Promise<void> {
  const T = `tenants/${tenantId}`; const orderId = String(o.id); const ref = db.doc(`${T}/eventTicketOrders/${orderId}`);
  const { outside, cents, by } = x; const refund = x.refundId ? { id: x.refundId } : null;
  const evRef = db.doc(`${T}/studioEvents/${o.eventId}`);
  const guestRefs = (Array.isArray(o.guestIds) ? o.guestIds : []).filter((x: any) => ID.test(String(x))).map((id: string) => db.doc(`${T}/eventGuests/${id}`));
  const lineRef = db.doc(`${T}/transactions/refund_ticket_${orderId}`);
  await db.runTransaction(async (tx: any) => {
    const cur: any = (await tx.get(ref)).data() || {};
    // Already marked refunded by the payments notice a moment before this refund from the app was recorded: the app's
    // refund still gets its line in the books (the notice wrote none for it).
    if (cur.status === 'refunded') {
      if (!outside && cur.refundedOutside && !cur.refundTransactionId) {
        const now = new Date().toISOString();
        tx.set(lineRef, { id: lineRef.id, tenantId, date: now, createdAt: now, description: `Refund: tickets for ${o.eventTitle || 'event'} (${o.qty})`, clientOrVendor: o.name || 'Guest',
          type: 'reversal', context: 'Business', category: 'Refunds', taxBucket: 'refund', amount: cents / 100, paymentMethod: 'Card (Stripe)', reversalOf: o.transactionId || null,
          stripeRefundId: refund?.id || null, refundedToCard: true, eventId: o.eventId, ticketOrderId: orderId, by: by || null, hasReceipt: false });
        tx.set(ref, { refundTransactionId: lineRef.id, refundedOutside: false, refundId: refund?.id || null, refundedBy: by || null }, { merge: true });
      }
      return;
    }
    const ev: any = (await tx.get(evRef)).data() || {};
    const have = await Promise.all(guestRefs.map((g: any) => tx.get(g)));
    const now = new Date().toISOString(); const gone = have.filter((h: any) => h.exists).length;
    guestRefs.forEach((g: any, i: number) => { if (have[i].exists) tx.delete(g); });
    if (gone) tx.set(evRef, { rsvpCount: Math.max(0, (Number(ev.rsvpCount) || 0) - gone), ticketsSold: Math.max(0, (Number(ev.ticketsSold) || 0) - gone) }, { merge: true });
    if (!outside) tx.set(lineRef, { id: lineRef.id, tenantId, date: now, createdAt: now, description: `Refund: tickets for ${o.eventTitle || 'event'} (${o.qty})`, clientOrVendor: o.name || 'Guest',
      type: 'reversal', context: 'Business', category: 'Refunds', taxBucket: 'refund', amount: cents / 100, paymentMethod: 'Card (Stripe)', reversalOf: o.transactionId || null,
      stripeRefundId: refund?.id || null, refundedToCard: true, eventId: o.eventId, ticketOrderId: orderId, by: by || null, hasReceipt: false });
    if (o.transactionId) tx.set(db.doc(`${T}/transactions/${o.transactionId}`), { refundedAt: now, ...(outside ? {} : { refundTransactionId: lineRef.id }) }, { merge: true });
    tx.set(ref, { status: 'refunded', refundedAt: now, refundedCents: cents, refundId: refund?.id || null, refundedBy: by || null, ...(outside ? { refundedOutside: true } : {}) }, { merge: true });
  });
}

/** The daily sweep's part: an order whose checkout has closed is finished if it was paid (a lost notice and a guest who
 *  never came back) or its places are freed if it wasn't. */
export async function sweepTicketOrders(db: Firestore, stripe: any, tenantId: string, now = Date.now()): Promise<{ finished: number; freed: number }> {
  const snap = await db.collection(`tenants/${tenantId}/eventTicketOrders`).where('status', '==', 'pending').limit(50).get().catch(() => null);
  let finished = 0, freed = 0;
  // Paid, but the confirmation didn't go (or a sold-out refund stopped part way): tried again.
  for (const st of ['paid', 'refunding']) {
    const more = await db.collection(`tenants/${tenantId}/eventTicketOrders`).where('status', '==', st).limit(50).get().catch(() => null);
    for (const d of more?.docs || []) { const o: any = d.data() || {};
      if ((st === 'paid' && o.buyerToldAt) || !o.sessionId || now - Date.parse(String(o.paidAt || o.createdAt || 0)) < 5 * 60000) continue;
      await finishTicketOrder(db, stripe, tenantId, String(o.sessionId)).catch(() => null); }
  }
  for (const d of snap?.docs || []) {
    const o: any = d.data() || {};
    if (Date.parse(String(o.holdUntil || '')) > now) continue;
    if (!o.sessionId) { await d.ref.set({ status: 'expired', endedAt: new Date(now).toISOString(), why: 'no_checkout' }, { merge: true }); freed++; continue; }
    const r = await finishTicketOrder(db, stripe, tenantId, String(o.sessionId)).catch(() => null);
    if (r?.ok && r.status === 'paid') { finished++; continue; }
    if (r?.ok && r.status === 'pending') { await expireTicketOrder(db, tenantId, d.id, String(o.sessionId)); freed++; }
  }
  return { finished, freed };
}
