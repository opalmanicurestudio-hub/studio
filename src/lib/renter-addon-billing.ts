// src/lib/renter-addon-billing.ts — CHARGING A RENTER'S ADD-ONS, A MONTH AT A TIME (server).
//
// An add-on (lib/renter-offers) is charged to the renter's saved card on the business's own account: the first month
// the moment they add it (api/portal/renter, addon-add), then a month on each time, on the day they added it (the
// last day of a shorter month), by the daily run (api/cron/autopay-leases). Each month is one charge, made the way an
// incidental is (lib/renter-incidentals): claimed under a key named after the add-on and the day its month starts,
// charged under that key, recorded once (an income line 'Renter Add-on', its Stripe fee, the renter's receipt and a
// note in their portal), and settled by the five-minute check if Stripe's answer is lost.
//
// After a charge the add-on is paid through the end of that month and its next charge moves on a month. A card that's
// declined, or no card the business can charge, pauses it: nothing is charged, it stops working when the month
// already paid for runs out, and the renter (and the business) are told; adding it again starts it, with a charge
// then. The first month declined means it isn't added at all. Only an add-on that's running, for a tool that's still
// an add-on, held by a renter with a lease now, is ever charged; one whose tool isn't an add-on any more is stopped.
import Stripe from 'stripe';
import { logAuditAdmin } from '@/lib/audit';
import { onAccount, renterBusinessCard, spacePayAccount } from '@/lib/space-stripe';
import { stripeRefused } from '@/lib/stripe-said-no';
import { todayIn, tenantTimeZone, addDays } from '@/lib/tenant-time';
import { incidentalAttemptPath, incidentalOpened, recordRenterIncidental, releaseRenterIncidental, tellRenterCharged } from '@/lib/renter-incidentals';
import { resolveOffers, offerDef, money, OFFER_KEYS, type OfferKey } from '@/lib/renter-offers';

export const ADDON_CATEGORY = 'Renter Add-on';
const LIVE_LEASE = ['active', 'on_leave', 'pending_signature'];
const stripeFor = () => new Stripe(process.env.STRIPE_SECRET_KEY || '', { apiVersion: '2024-06-20' as any }) as any;
const pad = (n: number) => String(n).padStart(2, '0');

/** A month on from a day, on the given day of the month (the last day of a shorter month). */
export function monthOn(from: string, day: number): string {
  const [y, m] = from.split('-').map(Number);
  const ny = m === 12 ? y + 1 : y; const nm = m === 12 ? 1 : m + 1;
  const last = new Date(Date.UTC(ny, nm, 0)).getUTCDate();
  return `${ny}-${pad(nm)}-${pad(Math.min(Math.max(1, day || 1), last))}`;
}
export const addOnAttemptKey = (key: OfferKey, start: string) => `addon_${key}_${start}`;
export const shortDay = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
/** What a month's charge is for, in the renter's words: "Swap days add-on, Nov 9 to Dec 9". */
export const addOnWords = (title: string, start: string, end: string) => `${title} add-on, ${shortDay(start)} to ${shortDay(end)}`;
const cardOf = (r: any) => (r?.cardLast4 ? `${r.cardBrand ? `${String(r.cardBrand).charAt(0).toUpperCase()}${String(r.cardBrand).slice(1)} ` : 'card '}ending ${r.cardLast4}` : 'your saved card');
const nameOf = (r: any) => `${r?.firstName || ''} ${r?.lastName || ''}`.trim() || String(r?.name || '') || 'Renter';

/** What a month's attempt carries about its add-on, so whichever step finishes it (the charge, or the five-minute
 *  check) moves the add-on on, or pauses it. */
export type AddOnMonth = { key: OfferKey; start: string; end: string; next: string; first?: boolean;
  /** A long-overdue month started today instead: its day of the month from now on. */
  billDay?: number };

/** Paid for this month: it works through the end of it, and (still running, still due then) its next charge is a month
 *  on. Safe to run twice. */
export async function addOnPaid(db: any, tenantId: string, renterId: string, m: AddOnMonth): Promise<void> {
  const ref = db.doc(`tenants/${tenantId}/renters/${renterId}`);
  await db.runTransaction(async (tx: any) => {
    const r: any = (await tx.get(ref)).data() || {};
    const a: any = r.addOns?.[m.key];
    if (!a) return;
    const patch: Record<string, any> = {};
    if (!(typeof a.paidThrough === 'string' && a.paidThrough >= m.end)) patch.paidThrough = m.end;
    if (a.status === 'active' && a.nextBillOn === m.next) { patch.nextBillOn = m.end; if (m.billDay) patch.billDay = m.billDay; }
    if (Object.keys(patch).length) tx.set(ref, { addOns: { [m.key]: patch } }, { merge: true });
  });
}

/** This month's charge didn't go through (declined, no card, or never reached Stripe): the add-on is paused (the first
 *  month: not added), so nothing more is tried, and the renter and the business are told. False when it had already
 *  moved on (stopped, or charged another way). */
export async function addOnFailed(db: any, tenantId: string, tenant: any, renterId: string, m: AddOnMonth, why: 'declined' | 'no_card' | 'not_through', detail?: string,
  o: { seen?: boolean } = {}): Promise<boolean> {
  const ref = db.doc(`tenants/${tenantId}/renters/${renterId}`);
  const at = new Date().toISOString();
  const r: any = await db.runTransaction(async (tx: any) => {
    const cur: any = (await tx.get(ref)).data() || {};
    const a: any = cur.addOns?.[m.key];
    if (!a || a.status !== 'active' || a.nextBillOn !== m.next) return null;
    tx.set(ref, { addOns: { [m.key]: m.first
      ? { status: 'stopped', stoppedAt: at, stoppedWhy: why, nextBillOn: null }
      : { status: 'paused', pausedAt: at, pausedWhy: why, nextBillOn: null } } }, { merge: true });
    return cur;
  }).catch(() => null);
  if (!r) return false;
  // The first month, declined while they were adding it: they're told on screen, and nobody else needs to be.
  if (m.first && o.seen) return true;
  const title = offerDef(m.key).renterTitle(String(tenant?.name || 'the business'));
  const price = money(Math.round(Number(r.addOns?.[m.key]?.priceCents) || 0));
  const cause = why === 'declined' ? `your ${cardOf(r)} was declined` : why === 'no_card' ? 'there’s no card saved here to charge' : 'the charge didn’t go through';
  const paid = r.addOns?.[m.key]?.paidThrough;
  const until = !m.first && typeof paid === 'string' && paid > todayIn(tenantTimeZone(tenant)) ? ` You can use it until ${shortDay(paid)}.` : '';
  const text = m.first
    ? `${title} wasn’t added: ${cause}, so nothing was charged. You can add it again under Space, What comes with your space.`
    : `${title} is paused: ${cause}, so this month’s ${price} wasn’t charged.${until} To keep using it, save a card under Money, then add it again under Space, What comes with your space.`;
  try {
    const { alertRenter, renterPortalUrl } = await import('@/lib/renter-comms');
    await alertRenter(db, tenantId, renterId, 'space_tools', text, 'studio', 'amber');
    const email = String(r.email || '').trim();
    if (email.includes('@')) {
      const { sendNotification } = await import('@/lib/notify');
      const { brandedEmailHtml } = await import('@/lib/email-template');
      const portal = await renterPortalUrl(db, tenantId);
      await sendNotification(db, { tenantId, channel: 'email', to: email, kind: 'renter_addon_paused', recipientType: 'renter', recipientId: renterId,
        subject: m.first ? `${title} wasn’t added` : `${title} is paused`, text,
        html: brandedEmailHtml({ studioName: String(tenant?.name || ''), title: m.first ? `${title} wasn’t added` : `${title} is paused`, bodyLines: [text], cta: portal ? { label: 'Open my portal', url: `${portal}?view=tools` } : null }) } as any);
    }
  } catch { /* the add-on is paused either way; the business's note below still goes */ }
  try {
    const nRef = db.collection(`tenants/${tenantId}/notifications`).doc();
    await nRef.set({ id: nRef.id, userId: null, read: false, createdAt: at, type: 'renter_addon', link: '/rent#what-renters-get',
      message: `${nameOf(r)}’s ${title} add-on ${m.first ? 'wasn’t added' : 'is paused'}: ${why === 'declined' ? 'their card was declined' : why === 'no_card' ? 'they have no card saved here' : 'the charge didn’t go through'}. Nothing was charged${detail ? ` (${String(detail).slice(0, 120)})` : ''}. They were told how to ${m.first ? 'add it again' : 'start it again'}.` });
  } catch { /* told the renter at least */ }
  return true;
}

export type ChargeResult = { result: 'charged' | 'already' | 'declined' | 'no_card' | 'lost' | 'busy' | 'skipped'; error?: string; cents?: number; card?: string };

/** Charge one add-on's month that's due (today or before), once. `first` is the month charged as they add it. */
export async function chargeAddOn(db: any, tenantId: string, tenant: any, renterId: string, key: OfferKey, o: { stripe?: any; first?: boolean } = {}): Promise<ChargeResult> {
  const renterRef = db.doc(`tenants/${tenantId}/renters/${renterId}`);
  const today = todayIn(tenantTimeZone(tenant));
  const offers = resolveOffers(tenant); const acct = spacePayAccount(tenant);
  const nowIso = new Date().toISOString();
  const c: any = await db.runTransaction(async (tx: any) => {
    const r: any = (await tx.get(renterRef)).data() || {};
    const a: any = r.addOns?.[key];
    if (!a || a.status !== 'active' || offers.modes[key] !== 'addon' || typeof a.nextBillOn !== 'string' || a.nextBillOn > today) return { skip: true };
    const day = Number(a.billDay) || Number(String(a.nextBillOn).slice(8));
    // The month it's due for, charged already (only moving it on didn't get saved): it's moved on now, never charged again.
    const dueKey = addOnAttemptKey(key, a.nextBillOn);
    const duePrev: any = (await tx.get(db.doc(incidentalAttemptPath(tenantId, renterId, dueKey)))).data() || null;
    if (duePrev?.status === 'charged') { const dm = duePrev.addon?.start === a.nextBillOn ? duePrev.addon : { key, start: a.nextBillOn, end: monthOn(a.nextBillOn, day), next: a.nextBillOn };
      return { already: true, m: { ...dm, next: a.nextBillOn }, aKey: dueKey, cents: Number(duePrev.amountCents) || 0 }; }
    // A month long overdue (the daily run didn't get to it) isn't charged for the time already gone: it starts today, and
    // from then on falls on today's day of the month.
    const overdue = a.nextBillOn < addDays(today, -27);
    const start = overdue ? today : a.nextBillOn;
    const end = monthOn(start, overdue ? Number(today.slice(8)) : day);
    // The reset is saved with the claim, so every later look (and the guard above) reads the month as starting today.
    const m: AddOnMonth = { key, start, end, next: start, ...(o.first ? { first: true } : {}), ...(overdue ? { billDay: Number(today.slice(8)) } : {}) };
    const aKey = addOnAttemptKey(key, start);
    const aRef = db.doc(incidentalAttemptPath(tenantId, renterId, aKey));
    const prev: any = start === a.nextBillOn ? duePrev : (await tx.get(aRef)).data() || null;
    if (prev?.status === 'charged') return { already: true, m, aKey, cents: Number(prev.amountCents) || 0 };
    // Its answer was lost: the five-minute check settles it (lib/renter-incidentals), never a second charge.
    if (prev?.status === 'charging') return { busy: true };
    const card = r.cardOnFile ? renterBusinessCard(r, acct) : null;
    if (!card) return { noCard: true, m: { ...m, next: a.nextBillOn } };   // nothing saved yet: it's paused as it stands
    const cents = Math.round(Number(a.priceCents) || 0);
    if (cents < 50) return { skip: true };
    const description = addOnWords(offerDef(key).renterTitle(String(tenant?.name || 'the business')), start, end);
    const tries = (Number(prev?.tries) || 0) + 1;
    const opened = incidentalOpened(r, aKey, nowIso);
    if (opened || overdue) tx.set(renterRef, { ...(opened || {}), ...(overdue ? { addOns: { [key]: { nextBillOn: start, billDay: Number(today.slice(8)) } } } : {}) }, { merge: true });
    tx.set(aRef, { id: aRef.id, status: 'charging', claimAt: nowIso, amountCents: cents, description, category: 'Add-on', ledgerCategory: ADDON_CATEGORY,
      pm: card.pm, customer: card.customer, account: card.account, by: 'Add-on', addon: m, tries, error: null }, { merge: true });
    return { m, aKey, cents, description, card, tries, renterName: nameOf(r), cardWords: cardOf(r) };
  });
  if (c.skip) return { result: 'skipped' };
  if (c.busy) return { result: 'busy' };
  if (c.already) { await addOnPaid(db, tenantId, renterId, c.m).catch(() => {}); return { result: 'already', cents: c.cents }; }
  if (c.noCard) { await addOnFailed(db, tenantId, tenant, renterId, c.m, 'no_card', undefined, { seen: !!o.first }); return { result: 'no_card', error: 'There’s no card saved here to charge.' }; }

  const stripe = o.stripe || stripeFor();
  let intent: any;
  try {
    intent = await stripe.paymentIntents.create({
      amount: c.cents, currency: 'usd', customer: c.card.customer, payment_method: c.card.pm, off_session: true, confirm: true,
      expand: ['latest_charge.balance_transaction'],
      description: `${c.description} — ${c.renterName}`,
      metadata: { tenantId, renterId, kind: 'renter_incidental', category: ADDON_CATEGORY, attempt: c.aKey, addon: key },
    }, onAccount({ stripeAccountId: c.card.account }, { idempotencyKey: `renter-addon-${renterId}-${c.aKey}-${c.tries}-${c.card.pm}` }));
  } catch (err: any) {
    const msg = String(err?.raw?.message || err?.message || 'The card was declined.');
    if (stripeRefused(err)) {
      await releaseRenterIncidental(db, tenantId, renterId, c.aKey, msg);
      await addOnFailed(db, tenantId, tenant, renterId, c.m, 'declined', msg, { seen: !!o.first });
      return { result: 'declined', error: msg };
    }
    // No answer: left claimed for the five-minute check, which finds out at Stripe and finishes it either way.
    return { result: 'lost' };
  }
  const wrote = await recordRenterIncidental(db, tenantId, renterId, c.aKey, intent, c.cents, c.description, c.renterName, { stripe, account: c.card.account, category: ADDON_CATEGORY });
  await addOnPaid(db, tenantId, renterId, c.m).catch(() => {});
  if (wrote) {
    await logAuditAdmin(db, tenantId, { action: 'renters.addon_charged', targetType: 'renter', targetId: renterId,
      summary: `Add-on charged to card on file: ${c.renterName} — ${c.description} (${money(c.cents)})`, amount: c.cents / 100,
      actor: { type: 'system', name: o.first ? 'Renter portal' : 'Monthly add-ons' } } as any).catch(() => {});
  }
  await tellRenterCharged(db, tenantId, tenant, renterId, c.aKey).catch(() => null);
  return { result: wrote ? 'charged' : 'already', cents: c.cents, card: c.cardWords };
}

/** The daily run for one business: every add-on month that's due is charged; one whose tool isn't an add-on any more,
 *  or whose renter has no lease now, is stopped instead. */
export async function billRenterAddOns(db: any, tenantId: string, tenant: any, o: { stripe?: any } = {}): Promise<{ charged: number; declined: number; stopped: number; waiting: number }> {
  const out = { charged: 0, declined: 0, stopped: 0, waiting: 0 };
  const today = todayIn(tenantTimeZone(tenant));
  const offers = resolveOffers(tenant);
  const renters = (await db.collection(`tenants/${tenantId}/renters`).get()).docs
    .filter((d: any) => OFFER_KEYS.some((k) => { const a = (d.data() as any)?.addOns?.[k]; return a?.status === 'active' && typeof a.nextBillOn === 'string' && a.nextBillOn <= today; }));
  if (!renters.length) return out;
  // The business can't take cards right now: nothing is charged or paused (it isn't the renters' doing), and the business
  // is told once a day while it lasts.
  if (!spacePayAccount(tenant)) {
    out.waiting = renters.length;
    const nRef = db.doc(`tenants/${tenantId}/notifications/addon_nopay_${today}`);
    if (!(await nRef.get()).exists) await nRef.set({ id: nRef.id, userId: null, read: false, createdAt: new Date().toISOString(), type: 'renter_addon', link: '/rent#what-renters-get',
      message: `Renters’ add-ons are due, but card payments aren’t on for your business right now, so they weren’t charged. Turn card payments back on and they’re charged on the next daily run.` }).catch(() => {});
    return out;
  }
  const leased = new Set<string>((await db.collection(`tenants/${tenantId}/leases`).get()).docs.map((d: any) => d.data() as any)
    .filter((l: any) => l.renterId && LIVE_LEASE.includes(String(l.status))).map((l: any) => String(l.renterId)));
  for (const d of renters) {
    const r: any = d.data() || {};
    for (const k of OFFER_KEYS) {
      const a = r.addOns?.[k];
      if (!(a?.status === 'active' && typeof a.nextBillOn === 'string' && a.nextBillOn <= today)) continue;
      const end = offers.modes[k] !== 'addon' ? (offers.modes[k] === 'off' ? 'off' : 'included') : !leased.has(d.id) ? 'lease_ended' : null;
      if (end) { await d.ref.set({ addOns: { [k]: { status: 'stopped', stoppedAt: new Date().toISOString(), stoppedWhy: end, nextBillOn: null } } }, { merge: true }).catch(() => {}); out.stopped++; continue; }
      try {
        const res = await chargeAddOn(db, tenantId, tenant, d.id, k, o);
        if (res.result === 'charged') out.charged++; else if (res.result === 'declined' || res.result === 'no_card') out.declined++; else if (res.result === 'lost' || res.result === 'busy') out.waiting++;
      } catch (e: any) { out.waiting++; console.error('[renter-addon-billing]', tenantId, d.id, k, String(e?.message || e).slice(0, 160)); }
    }
  }
  return out;
}
