// src/lib/offer-sale.ts — MEMBERSHIPS AND PACKAGES BOUGHT ON THE BOOKING PAGE.
//
// What clients may see (publicOffers: only what the business sells openly, never a private plan), the checkout on the
// business's own payment account (startOfferSale), and what happens once it's paid (finishOfferSale): the client is
// found in the business's own book the way bookings find them (never a renter's client), or added; the membership or
// package is given through the same engine the front desk uses (lib/memberships/enroll-membership); its line in the
// books is what was actually charged; the card a membership was paid with is kept for its renewals (never replacing a
// card someone already has on file); the client is sent a confirmation and the business is told. Stripe's notice and
// the client's return both finish it; whichever comes first does the work and the other finds it done. If it can't
// be given (a membership already active, a client the business doesn't book, a plan since removed), the payment is
// refunded and both sides are told, rather than leaving someone charged for nothing. Anything that goes wrong part way
// marks the sale so the next try (Stripe retries its notice; a daily sweep runs too) picks it straight back up.

import type { Firestore } from 'firebase-admin/firestore';
import { enrollMembership, enrollPackage } from '@/lib/memberships/enroll-membership';
import { payLaterCheckoutParams, createCheckoutSession } from '@/lib/pay-later';
import { hasUsableCard } from '@/lib/payments/has-usable-card';
import { searchFields } from '@/lib/client-search';
import { linkOrigin } from '@/lib/app-origin';
import { createHash } from 'crypto';

export type OfferKind = 'membership' | 'package';
export interface PublicMembership { id: string; name: string; description: string; price: number; interval: 'monthly' | 'yearly'; perks: string[] }
export interface PublicPackage { id: string; name: string; description: string; price: number; sessions: number; months: number; serviceName: string }

const ID = /^[A-Za-z0-9_-]{1,80}$/;
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const clip = (v: any, n: number) => String(v || '').replace(/\s+/g, ' ').trim().slice(0, n);
const safeId = (s: any, n = 80) => String(s || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, n);
const money = (n: number) => `$${n.toLocaleString('en-US', { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 })}`;
const sellable = (x: any) => x && x.isPrivate !== true && x.isActive !== false && x.archived !== true && Number(x.price) > 0;
const BLOCKED = ['banned', 'blocked'];

/** The memberships and packages a client may buy online, in plain words, and nothing else about them. */
export function publicOffers(memberships: any[], packages: any[], services: any[]): { memberships: PublicMembership[]; packages: PublicPackage[] } {
  const svc = new Map((services || []).map((s: any) => [String(s.id), s]));
  const perkName = (p: any) => { const s = svc.get(String(p?.id)); const n = clip(s?.name || p?.name, 60); const q = Number(p?.quantity) || 0; return n ? (q > 1 ? `${q} ${n}` : n) : ''; };
  return {
    memberships: (memberships || []).filter(sellable).map((m: any) => ({
      id: String(m.id), name: clip(m.name, 80) || 'Membership', description: clip(m.description, 240), price: Number(m.price), interval: m.interval === 'yearly' ? 'yearly' : 'monthly',
      perks: [...(m.includedServices || []).map(perkName), ...(Number(m.retailDiscount) > 0 ? [`${Number(m.retailDiscount)}% off products`] : [])].filter(Boolean).slice(0, 5),
    } as PublicMembership)).sort((a, b) => a.price - b.price),
    packages: (packages || []).filter(sellable).map((p: any) => {
      const sessions = Math.max(1, Math.floor(Number(p.sessions) || 1)); const months = Math.max(0, Math.floor(Number(p.expiresInMonths) || 0)); const serviceName = clip(svc.get(String(p.serviceId))?.name, 60);
      const within = months ? (months === 12 ? ' within a year' : ` within ${months} months`) : '';
      return { id: String(p.id), name: clip(p.name, 80) || 'Package', price: Number(p.price), sessions, months, serviceName,
        description: clip(p.description, 240) || (serviceName ? `${sessions} ${serviceName.toLowerCase()} visit${sessions === 1 ? '' : 's'} to use${within}.` : `${sessions} visit${sessions === 1 ? '' : 's'} to use${within}.`) } as PublicPackage;
    }).sort((a, b) => a.price - b.price),
  };
}

/** Whether this business can take a card online (a connected payment account with charges switched on). */
export const takesCards = (t: any) => !!t?.stripeAccountId && t?.stripeChargesEnabled !== false;

/** Every profile of this client in the business's OWN book (a renter's clients share the collection and are never
 *  theirs), by email: as typed, in lower case, or stored in any case (the search keys hold it in lower case). Never by
 *  phone: a phone can be a household's or a front desk's, so an online purchase never attaches to someone else that
 *  way. Several profiles can share an email; membership is judged across all of them, as the booking page does. */
export async function findStudioClients(db: Firestore, tenantId: string, emailTyped: string, email: string): Promise<any[]> {
  const col = db.collection(`tenants/${tenantId}/clients`); const studio = (d: any) => !(d.data() || {}).ownerRenterId;
  const lower = email.trim().toLowerCase(); if (!lower) return [];
  const all = new Map<string, any>();
  for (const e of [...new Set([emailTyped.trim(), lower].filter(Boolean))]) (await col.where('email', '==', e).limit(10).get()).docs.filter(studio).forEach((d: any) => all.set(d.id, d));
  if (lower.length <= 40) (await col.where('searchKeys', 'array-contains', lower).limit(10).get()).docs.filter((d: any) => studio(d) && String(d.data()?.email || '').trim().toLowerCase() === lower).forEach((d: any) => all.set(d.id, d));
  return [...all.values()];
}
const isMember = (c: any) => !!c?.activeMembershipId && ['active', 'past_due'].includes(String(c?.subscription?.status || ''));
/** A new profile's id, from the email (and the card, for a membership): repeat or simultaneous purchases by the same
 *  person land on the same one. */
const newProfileId = (tenantId: string, email: string, fingerprint: string | null) => `web_${createHash('sha256').update(`${tenantId}|${email.toLowerCase()}|${fingerprint || ''}`).digest('hex').slice(0, 28)}`;

/** Starts the checkout on the business's own account; the client comes back to their booking page. */
export async function startOfferSale(db: Firestore, stripe: any, input: { tenantId: string; kind: OfferKind; id: string; name: string; email: string; phone?: string; origin: string }): Promise<{ ok: true; url: string } | { ok: false; error: string; status: number }> {
  const { tenantId, kind, id } = input;
  const name = clip(input.name, 120), typed = clip(input.email, 160), email = typed.toLowerCase(), phone = clip(input.phone, 40);
  if (!ID.test(tenantId) || !ID.test(id) || (kind !== 'membership' && kind !== 'package')) return { ok: false, error: 'That isn’t available.', status: 400 };
  if (!name || !EMAIL.test(email)) return { ok: false, error: 'Add your name and email.', status: 400 };
  const t: any = (await db.doc(`tenants/${tenantId}`).get()).data();
  if (!t) return { ok: false, error: 'That isn’t available.', status: 404 };
  if (!takesCards(t)) return { ok: false, error: 'This business isn’t taking card payments online yet. Ask them at your next visit.', status: 409 };
  const item: any = (await db.doc(`tenants/${tenantId}/${kind === 'membership' ? 'memberships' : 'packages'}/${id}`).get()).data();
  if (!sellable(item)) return { ok: false, error: 'That isn’t available online.', status: 404 };
  const profiles = (await findStudioClients(db, tenantId, typed, email)).map((d) => d.data() || {});
  if (profiles.some((c) => BLOCKED.includes(String(c.status || '')))) return { ok: false, error: 'We’re sorry, we’re unable to take this online. Please contact the business.', status: 409 };
  // Already a member (or one with a renewal due): said before any money is taken (the business changes plans for them).
  if (kind === 'membership' && profiles.some(isMember)) return { ok: false, error: 'You already have a membership here. The team can change it for you at your next visit.', status: 409 };
  const cents = Math.round(Number(item.price) * 100);
  const back = `${linkOrigin(t, input.origin)}/book/${encodeURIComponent(tenantId)}`;
  const label = kind === 'membership' ? `${clip(item.name, 80)} membership` : clip(item.name, 80);
  const every = item.interval === 'yearly' ? 'year' : 'month';
  const session = await createCheckoutSession(stripe, {
    mode: 'payment',
    // A membership is paid by card, and that card is kept for its renewals; a package may use pay-later if offered.
    ...(kind === 'membership' ? { payment_method_types: ['card'], customer_creation: 'always' } : payLaterCheckoutParams(t.payLater, cents)),
    line_items: [{ quantity: 1, price_data: { currency: 'usd', unit_amount: cents, product_data: { name: label,
      description: kind === 'membership' ? `${money(Number(item.price))} a ${every}, renewing each ${every} on this card until it’s canceled. To cancel, ask the business any time.` : `${Math.max(1, Number(item.sessions) || 1)} visit${Number(item.sessions) === 1 ? '' : 's'}${Number(item.expiresInMonths) ? `, to use within ${Number(item.expiresInMonths)} months` : ''}.` } } }],
    customer_email: email,
    payment_intent_data: { ...(kind === 'membership' ? { setup_future_usage: 'off_session' } : {}), receipt_email: email, metadata: { tenantId, type: 'studio_offer', kind, itemId: id } },
    metadata: { type: 'studio_offer', tenantId, kind, itemId: id, itemName: clip(item.name, 80), clientName: name, clientEmail: email, clientEmailTyped: typed, clientPhone: phone },
    success_url: `${back}?offer_paid={CHECKOUT_SESSION_ID}`,
    cancel_url: `${back}#offers`,
  }, { stripeAccount: t.stripeAccountId });
  return session?.url ? { ok: true, url: String(session.url) } : { ok: false, error: 'Checkout didn’t open. Try again in a moment.', status: 502 };
}

export type OfferReason = 'already_member' | 'unavailable' | 'blocked';
export type OfferFinish =
  | { ok: true; kind: OfferKind; name: string; outcome: 'given' | 'pending' }
  | { ok: true; kind: OfferKind; name: string; outcome: 'refunded'; reason: OfferReason }
  | { ok: false; error: 'not_found' | 'retry' | 'needs_attention'; kind?: OfferKind; name?: string; told?: boolean };

/** The business's owner and managers, told in the app. Says whether anyone was. */
async function tellOwners(db: Firestore, tenantId: string, t: any, message: string, link: string): Promise<boolean> {
  try {
    const ids = new Set<string>(t?.userId ? [String(t.userId)] : []);
    (await db.collection(`tenants/${tenantId}/staff`).where('role', 'in', ['admin', 'owner']).get()).docs.forEach((d: any) => ids.add(d.id));
    if (!ids.size) return false; const now = new Date().toISOString(); const b = db.batch();
    ids.forEach((userId) => { const r = db.collection(`tenants/${tenantId}/notifications`).doc(); b.set(r, { id: r.id, userId, type: 'online_sale', message, link, read: false, createdAt: now }); });
    await b.commit(); return true;
  } catch { return false; }
}

/** After payment: gives the membership or package (once, however often it's called). Safe for Stripe's notice and the
 *  client's return to run at the same moment. Throws nothing: a failure part way marks the sale for the next try. */
export async function finishOfferSale(db: Firestore, stripe: any, tenantId: string, sessionId: string, given?: any): Promise<OfferFinish> {
  if (!ID.test(tenantId) || !/^cs_[A-Za-z0-9_]{6,200}$/.test(sessionId)) return { ok: false, error: 'not_found' };
  const t: any = (await db.doc(`tenants/${tenantId}`).get()).data();
  if (!t?.stripeAccountId) return { ok: false, error: 'not_found' };
  let session: any = given?.id === sessionId ? given : null;
  if (!session) {
    try { session = await stripe.checkout.sessions.retrieve(sessionId, { expand: ['payment_intent'] }, { stripeAccount: t.stripeAccountId }); }
    catch (e: any) { return e?.statusCode === 404 || e?.code === 'resource_missing' ? { ok: false, error: 'not_found' } : { ok: false, error: 'retry' }; }   // a hiccup is asked again
  }
  const md: any = session?.metadata || {};
  if (!session || md.type !== 'studio_offer' || md.tenantId !== tenantId || (md.kind !== 'membership' && md.kind !== 'package') || !ID.test(String(md.itemId || ''))) return { ok: false, error: 'not_found' };
  const kind = md.kind as OfferKind;
  const item: any = (await db.doc(`tenants/${tenantId}/${kind === 'membership' ? 'memberships' : 'packages'}/${md.itemId}`).get()).data() || null;
  const itemName = clip(item?.name, 80) || clip(md.itemName, 80) || (kind === 'membership' ? 'a membership' : 'a package');
  if (session.payment_status !== 'paid') return { ok: true, kind, name: itemName, outcome: 'pending' };

  // One record per checkout: the first caller claims it; anyone after finds it working or done. A try that failed
  // part way is claimed again at once; one still working after two minutes (well past any server's time limit) too.
  const saleRef = db.doc(`tenants/${tenantId}/offerSales/${sessionId}`);
  const claim = await db.runTransaction(async (tx: any) => {
    const cur: any = (await tx.get(saleRef)).data();
    if (cur?.status === 'given') return { s: 'given' as const };
    if (cur?.status === 'refunded') return { s: 'refunded' as const, reason: (cur.reason || 'unavailable') as OfferReason };
    if (cur?.status === 'needs_attention') return { s: 'needs_attention' as const, told: cur.told !== false };
    if (cur?.status === 'working' && Date.now() - Date.parse(cur.startedAt || 0) < 120000) return { s: 'working' as const };
    const now = new Date().toISOString(); const tries = (Number(cur?.tries) || 0) + 1;
    tx.set(saleRef, { id: sessionId, status: 'working', kind, itemId: md.itemId, itemName, startedAt: now, firstClaimedAt: cur?.firstClaimedAt || now, amountCents: Number(session.amount_total) || 0, tries }, { merge: true });
    return { s: 'mine' as const, tries, firstClaimedAt: cur?.firstClaimedAt || now };
  });
  if (claim.s === 'given') return { ok: true, kind, name: itemName, outcome: 'given' };
  if (claim.s === 'refunded') return { ok: true, kind, name: itemName, outcome: 'refunded', reason: claim.reason };
  if (claim.s === 'needs_attention') return { ok: false, error: 'needs_attention', kind, name: itemName, told: claim.told };
  if (claim.s === 'working') return { ok: true, kind, name: itemName, outcome: 'pending' };
  const name = clip(md.clientName, 120) || 'Client';

  try {
    const pi: any = typeof session.payment_intent === 'string' ? await stripe.paymentIntents.retrieve(session.payment_intent, {}, { stripeAccount: t.stripeAccountId }) : session.payment_intent;
    const piId: string | null = pi?.id || (typeof session.payment_intent === 'string' ? session.payment_intent : null);
    const email = clip(md.clientEmail, 160).toLowerCase(), typed = clip(md.clientEmailTyped || md.clientEmail, 160), phone = clip(md.clientPhone, 40);
    const nowIso = new Date().toISOString();

    // The card a membership was paid with (it decides whose profile the membership can go on: never one that would
    // renew on somebody else's card).
    let card: any = null; let fingerprint: string | null = null;
    if (kind === 'membership') {
      const pmId = typeof pi?.payment_method === 'string' ? pi.payment_method : pi?.payment_method?.id;
      const customerId = typeof session.customer === 'string' ? session.customer : session.customer?.id || (typeof pi?.customer === 'string' ? pi.customer : null);
      if (pmId && customerId) { try { const pm = await stripe.paymentMethods.retrieve(pmId, {}, { stripeAccount: t.stripeAccountId });
        if (pm?.type === 'card') { card = { paymentMethodId: pmId, customerId, brand: pm.card?.brand || 'unknown', last4: pm.card?.last4 || '????', expMonth: pm.card?.exp_month, expYear: pm.card?.exp_year, savedAt: nowIso, source: 'booking page' }; fingerprint = pm.card?.fingerprint || null; } }
        catch (e: any) { if (!e?.type || ['StripeConnectionError', 'StripeAPIError', 'StripeRateLimitError'].includes(e.type)) throw e; } }   // a hiccup is tried again; a refusal is noted to the business below
    }

    // The client. Of their profiles (by email): the one this payment already went on (a run after a stop part way);
    // then, for a membership, any that already has one (refunded as already a member); then any the business doesn't
    // book (refunded); then one this purchase can go on without ever renewing on somebody else's card: no card on file,
    // or the same card. None of those: a new profile, named after them (so repeats and simultaneous purchases land on
    // the same one), and the business is told it may be the same person.
    const profiles = await findStudioClients(db, tenantId, typed, email);
    const data = (d: any) => d.data() || {};
    let target: any = profiles.find((d) => data(d).subscription?.stripePaymentIntentId && data(d).subscription.stripePaymentIntentId === piId)
      || (kind === 'membership' ? profiles.find((d) => isMember(data(d))) : null)
      || profiles.find((d) => BLOCKED.includes(String(data(d).status || ''))) || null;
    const byRule = !!target;   // chosen by what the profiles are now (this payment, a member, a ban): every run agrees on its own
    let dupOf: { id: string; name: string } | null = null;
    if (!target) {
      for (const d of profiles) {
        const c = data(d);
        if (kind !== 'membership' || !hasUsableCard(c)) { target = d; break; }
        let same = false;
        if (fingerprint && c.cardOnFile?.paymentMethodId) { try { const old = await stripe.paymentMethods.retrieve(String(c.cardOnFile.paymentMethodId), {}, { stripeAccount: t.stripeAccountId }); same = !!old?.card?.fingerprint && old.card.fingerprint === fingerprint; }
          catch (e: any) { if (!e?.type || ['StripeConnectionError', 'StripeAPIError', 'StripeRateLimitError'].includes(e.type)) throw e; } }   // a hiccup is tried again; a card Stripe can't find counts as different
        if (same) { target = d; break; }
        dupOf = dupOf || { id: d.id, name: String(c.name || 'a client') };
      }
    }
    if (!target && !item) {
      // The plan was removed: refunded without making a profile for nobody.
      const told = await tellOnce(saleRef, 'refundToldAt', () => tellOwners(db, tenantId, t, `${name} paid for ${itemName} on your booking page, but it’s no longer available, so the payment is being refunded.`, '/clients'));
      return await refundSale(db, stripe, t, tenantId, sessionId, saleRef, piId, 'unavailable', 'removed', null, told, kind, itemName);
    }
    // A profile chosen by card (or a new one) is kept on the sale (the first run to choose wins), so every later or
    // overlapping run of the same sale uses the same one. One chosen by the rules above isn't: those are checked fresh
    // each time, so a membership or a ban that appears meanwhile is still seen.
    const chosen = target ? target.ref : db.doc(`tenants/${tenantId}/clients/${newProfileId(tenantId, email, kind === 'membership' ? fingerprint : null)}`);
    const keptId: string = byRule ? chosen.id : await db.runTransaction(async (tx: any) => { const cur: any = (await tx.get(saleRef)).data() || {}; if (cur.targetClientId) return String(cur.targetClientId); tx.set(saleRef, { targetClientId: chosen.id }, { merge: true }); return chosen.id; });
    const clientRef = keptId === chosen.id ? chosen : db.doc(`tenants/${tenantId}/clients/${keptId}`);
    if (keptId !== chosen.id) { target = (await clientRef.get()).exists ? { ref: clientRef } : null; dupOf = null; }
    if (!target) {
      try { await clientRef.create({ id: clientRef.id, name, email, phone: phone || null, status: 'active', lifetimeValue: 0, createdAt: nowIso, createdVia: 'booking page', ...(dupOf ? { possibleDuplicateOf: dupOf.id } : {}), ...searchFields({ name, email, phone }) }); }
      catch (e: any) { if (e?.code !== 6 && !/already exists/i.test(String(e?.message || ''))) throw e; }   // made by an earlier or simultaneous purchase: theirs
    }
    const client: any = (await clientRef.get()).data();
    if (!client) throw new Error('client not saved');

    // Can it be given? The business doesn't book this client, or the plan was removed: the money goes back.
    let r: any;
    if (BLOCKED.includes(String(client.status || ''))) r = { ok: false, error: 'blocked' };
    else if (!item) r = { ok: false, error: kind === 'membership' ? 'membership_not_found' : 'package_not_found' };
    // A member whose renewal is due (past due) is a member too: never given a second start over the old one.
    else if (kind === 'membership' && isMember(client) && client.subscription?.status !== 'active' && client.subscription?.stripePaymentIntentId !== piId) r = { ok: false, error: 'already_enrolled' };
    else r = kind === 'membership'
      ? await enrollMembership(db, { tenantId, clientId: clientRef.id, membershipId: md.itemId, paymentMethod: 'already_charged', existingPaymentIntentId: piId || undefined, source: 'booking page', skipLedger: true })
      : await enrollPackage(db, { tenantId, clientId: clientRef.id, packageId: md.itemId, paymentMethod: 'already_charged', existingPaymentIntentId: piId || undefined, source: 'booking page', skipLedger: true });
    if (!r?.ok && r?.error === 'client_not_found') throw new Error('client_not_found');   // a read that came back empty: tried again, never refunded
    // A run after a slow or broken first one: the membership it finds was started by this very payment, so it counts
    // as given, never refunded.
    if (!r?.ok && r?.error === 'already_enrolled' && piId && (await clientRef.get()).data()?.subscription?.stripePaymentIntentId === piId) r = { ok: true };

    if (r?.ok) {
      // Its line in the books: what was actually charged, on the day it was paid.
      const charged = (Number(session.amount_total) || 0) / 100;
      const paidAt = Number(session.created) > 0 ? new Date(Number(session.created) * 1000).toISOString() : nowIso;
      const lineRef = db.doc(`tenants/${tenantId}/transactions/${kind === 'membership' ? 'membership' : 'package'}_${safeId(piId || sessionId)}`);
      await lineRef.set({ id: lineRef.id, tenantId, date: paidAt, description: `${kind === 'membership' ? 'Membership' : 'Package'}: ${itemName} (bought online)`, clientOrVendor: client.name || name, clientId: clientRef.id,
        type: 'income', context: 'Business', category: kind === 'membership' ? 'Membership Sales' : 'Package Sales', amount: charged, paymentMethod: 'Card (Stripe)', taxBucket: 'revenue',
        stripePaymentIntentId: piId, stripeChargeId: typeof pi?.latest_charge === 'string' ? pi.latest_charge : pi?.latest_charge?.id || null, checkoutSessionId: sessionId, hasReceipt: true });
      // A membership renews on the card it was paid with: saved when the profile has none (or it's the same card).
      let cardNote = '';
      if (kind === 'membership') {
        const current: any = (await clientRef.get()).data() || {};
        if (card && !hasUsableCard(current)) await clientRef.update({ cardOnFile: card });
        else if (!card) cardNote = ' The card couldn’t be saved for renewals, so they’ll be asked to add one before the first renewal.';
      }
      // Told once each (a run after a stop part way doesn't tell again), and before the sale is marked done, so a stop
      // here means telling again rather than never. The client first, so the business hears if their message didn't go.
      const sd: any = (await saleRef.get()).data() || {};
      let clientTold = !!sd.clientToldAt;
      if (!clientTold && await confirmToClient(db, tenantId, t, { name, email: typed || email, phone, clientId: clientRef.id }, kind, itemName, charged, item?.interval, kind !== 'membership' || !!card)) { clientTold = true; await saleRef.set({ clientToldAt: new Date().toISOString() }, { merge: true }); }
      if (!sd.ownerToldAt && await tellOwners(db, tenantId, t, `${name} bought ${kind === 'membership' ? `the ${itemName} membership` : itemName} on your booking page (${money(charged)}).${cardNote}${dupOf ? ` They used the email on ${dupOf.name}’s profile, which has a different card, so it’s on a new profile: merge them if they’re the same person.` : ''}${clientTold ? '' : ' Their confirmation couldn’t be sent, so you may want to let them know it’s ready.'}`, `/clients/${clientRef.id}`)) await saleRef.set({ ownerToldAt: new Date().toISOString() }, { merge: true });
      await saleRef.set({ status: 'given', clientId: clientRef.id, paymentIntentId: piId, givenAt: new Date().toISOString() }, { merge: true });
      return { ok: true, kind, name: itemName, outcome: 'given' };
    }

    // Couldn't be given: the money goes back, and the business is told.
    const reason: OfferReason = r?.error === 'already_enrolled' ? 'already_member' : r?.error === 'blocked' ? 'blocked' : 'unavailable';
    const why = reason === 'already_member' ? 'they already have a membership' : reason === 'blocked' ? 'they’re marked not to be booked' : 'it’s no longer available';
    const told = await tellOnce(saleRef, 'refundToldAt', () => tellOwners(db, tenantId, t, `${name} paid for ${itemName} on your booking page, but it couldn’t be added (${why}), so the payment is being refunded.`, `/clients/${clientRef.id}`));
    return await refundSale(db, stripe, t, tenantId, sessionId, saleRef, piId, reason, String(r?.error || 'not_given'), clientRef.id, told, kind, itemName);
  } catch (e: any) {
    // Part way: marked so the next try (Stripe's retry, the client's page, the daily sweep) picks it straight up. After
    // half an hour of tries that all stop (a passing outage never ends a sale), it's left for the business, who is told.
    console.error('[offer-sale] finish failed', tenantId, sessionId, e?.message || e);
    if (claim.tries >= 3 && Date.now() - Date.parse(claim.firstClaimedAt) > 30 * 60000) {
      const told = await tellOwners(db, tenantId, t, `${name} paid for ${itemName} on your booking page, but it couldn’t be finished after several tries. Please check your payments and their profile: add it if it’s missing, or refund it if it shouldn’t be added.`, '/clients');
      await saleRef.set({ status: 'needs_attention', told, lastError: String(e?.message || e).slice(0, 300), endedAt: new Date().toISOString() }, { merge: true }).catch(() => undefined);
      return { ok: false, error: 'needs_attention', kind, name: itemName, told };
    }
    await saleRef.set({ status: 'failed', lastError: String(e?.message || e).slice(0, 300), failedAt: new Date().toISOString() }, { merge: true }).catch(() => undefined);
    return { ok: false, error: 'retry', kind, name: itemName };
  }
}

/** Tells once per sale (a run after a stop part way doesn't tell again). */
async function tellOnce(saleRef: any, flag: string, tell: () => Promise<boolean>): Promise<boolean> {
  if (((await saleRef.get()).data() || {})[flag]) return true;
  const told = await tell(); if (told) await saleRef.set({ [flag]: new Date().toISOString() }, { merge: true });
  return told;
}

/** Refunds a sale that couldn't be given (once: the refund is keyed to this checkout). A refund that hit a passing
 *  problem throws, so the sale is tried again; one Stripe refuses is left for the business, who is told. */
async function refundSale(db: Firestore, stripe: any, t: any, tenantId: string, sessionId: string, saleRef: any, piId: string | null, reason: OfferReason, why: string, clientId: string | null, told: boolean, kind: OfferKind, itemName: string): Promise<OfferFinish> {
  let refunded = false;
  if (piId) {
    try { await stripe.refunds.create({ payment_intent: piId, reason: 'requested_by_customer', metadata: { tenantId, type: 'studio_offer_refund', why } }, { stripeAccount: t.stripeAccountId, idempotencyKey: `offer-refund-${sessionId}` }); refunded = true; }
    catch (e: any) {
      if (e?.code === 'charge_already_refunded') refunded = true;   // refunded by an earlier run that stopped before saying so
      else if (!e?.type || ['StripeConnectionError', 'StripeAPIError', 'StripeRateLimitError'].includes(e.type)) throw e;
    }
  }
  let toldNow = told;
  if (!refunded) toldNow = await tellOwners(db, tenantId, t, `The refund for ${itemName} bought on your booking page didn’t go through. Please refund it from your payments.`, clientId ? `/clients/${clientId}` : '/clients');
  await saleRef.set({ status: refunded ? 'refunded' : 'needs_attention', reason, told: toldNow, clientId, paymentIntentId: piId, why, endedAt: new Date().toISOString() }, { merge: true });
  return refunded ? { ok: true, kind, name: itemName, outcome: 'refunded', reason } : { ok: false, error: 'needs_attention', kind, name: itemName, told: toldNow };
}

/** What the confirmation says, by token (bare names, as messages are written: {{item}}, {{amount}}…). */
export function confirmationTokens(t: any, to: { name: string }, kind: OfferKind, item: string, charged: number, interval?: string, cardKept = true): Record<string, string> {
  const every = interval === 'yearly' ? 'year' : 'month';
  return { client_first: to.name.split(' ')[0] || 'there', item, amount: money(charged), studio: t?.name || 'the studio',
    details: kind === 'membership' ? (cardKept ? `It renews each ${every} on the card you paid with until it’s canceled. To cancel, just ask us any time.` : `It renews each ${every} until it’s canceled; we’ll ask you to add a card before the first renewal. To cancel, just ask us any time.`) : 'Your visits come off as you book them.' };
}

/** The client's confirmation, in the business's own words (Messages: "Bought online"); it can't be switched off,
 *  since it records a payment and, for a membership, a charge that renews. Email when there is one, else a text.
 *  Says whether it went. */
async function confirmToClient(db: Firestore, tenantId: string, t: any, to: { name: string; email: string; phone: string; clientId: string }, kind: OfferKind, item: string, charged: number, interval?: string, cardKept = true): Promise<boolean> {
  try {
    const { MESSAGE_KINDS, resolveMessagePolicy, renderMessage } = await import('@/lib/message-policy');
    const { sendNotification } = await import('@/lib/notify');
    const def: any = (MESSAGE_KINDS as any[]).find((k) => k.id === 'online_purchase') || {};
    const tokens = confirmationTokens(t, to, kind, item, charged, interval, cardKept);
    for (const channel of ['email', 'sms'] as const) {
      const addr = channel === 'email' ? to.email : to.phone; if (!addr || !(def.channels || []).includes(channel)) continue;
      const p: any = resolveMessagePolicy(t, 'online_purchase', channel); if (!p.enabled) continue;
      const body = renderMessage(p.body || def.defaultBody || '', tokens);
      let r: any;
      if (channel === 'sms') r = await sendNotification(db, { tenantId, channel, to: addr, kind: 'online_purchase', tokens, clientId: to.clientId, clientName: to.name, text: body } as any);
      else { const { brandedEmailHtml } = await import('@/lib/email-template'); const subject = renderMessage(p.subject || def.defaultSubject || 'Thank you', tokens);
        r = await sendNotification(db, { tenantId, channel, to: addr, kind: 'online_purchase', tokens, clientId: to.clientId, clientName: to.name, subject, html: brandedEmailHtml({ studioName: t?.name || 'The studio', title: subject, bodyLines: body.split('\n').filter(Boolean) } as any) } as any); }
      if (r?.ok) return true;
    }
  } catch (e: any) { console.error('[offer-sale] confirmation not sent', tenantId, e?.message || e); }
  return false;
}

/** The daily sweep's part: sales left part way (a server stopped, a notice lost) are finished. */
export async function sweepOfferSales(db: Firestore, stripe: any, tenantId: string): Promise<number> {
  const snap = await db.collection(`tenants/${tenantId}/offerSales`).where('status', 'in', ['working', 'failed']).limit(25).get().catch(() => null);
  let n = 0;
  for (const d of snap?.docs || []) { const s: any = d.data() || {};
    if (Date.now() - Date.parse(s.startedAt || s.failedAt || 0) < 5 * 60000) continue;
    const r = await finishOfferSale(db, stripe, tenantId, d.id).catch(() => null); if (r?.ok) n++; }
  return n;
}
