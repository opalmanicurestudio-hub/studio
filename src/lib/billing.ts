// src/lib/billing.ts
//
// CHARGING BUSINESSES FOR CLARITYFLOW — Stripe Billing on ClarityFlow's OWN
// Stripe account (not the businesses' connected accounts).
//
//   ensurePrices()        creates every price in the list once (by lookup key)
//   businessSize()        team members (not archived) and renters on an
//                         active lease — what the subscription is sized by
//   checkoutFor()         Stripe Checkout for a new subscription
//   portalFor()           Stripe's billing portal (card, invoices, cancel)
//   syncSubscription()    after tools/size change: adds, removes and resizes
//                         items (Stripe prorates the difference)
//
// Settings live in platformSettings/billing:
//   enabled          false until you switch billing on in HQ → Finance
//   freeUntil        optional date — subscriptions start free until then
//   foundingPct      % off forever for founding members (0 = none)

import Stripe from 'stripe';
import { getAdminDb } from '@/lib/firebase-admin';
import { ALL_PRICES, quote, TEXTS, type QuoteLine } from '@/lib/billing-plans';
import { fromTenantModules, type ToolId } from '@/lib/module-catalog';

export const stripe = () => new Stripe(process.env.STRIPE_SECRET_KEY || '', { apiVersion: '2025-04-30.basil' as any });

export interface BillingSettings { enabled: boolean; freeUntil: string | null; foundingPct: number; foundingCouponId?: string | null; pricesReadyAt?: string | null }
export const DEFAULT_BILLING: BillingSettings = { enabled: false, freeUntil: null, foundingPct: 0, foundingCouponId: null, pricesReadyAt: null };

export async function billingSettings(): Promise<BillingSettings> {
  const d = ((await getAdminDb().doc('platformSettings/billing').get()).data() as any) || {};
  return { ...DEFAULT_BILLING, ...d };
}

/** Create any missing products/prices in Stripe (safe to run again). */
export async function ensurePrices() {
  const s = stripe();
  const existing = await s.prices.list({ lookup_keys: ALL_PRICES.map((p) => p.key), limit: 100 });
  const have = new Set(existing.data.map((p) => p.lookup_key));
  let created = 0;
  for (const p of ALL_PRICES) {
    if (have.has(p.key)) continue;
    const product = await s.products.create({ name: p.name, description: p.description, metadata: { clarityflow: p.key } });
    await s.prices.create({ product: product.id, unit_amount: Math.round(p.amount * 100), currency: 'usd', recurring: { interval: 'month' }, lookup_key: p.key, metadata: { clarityflow: p.key } });
    created++;
  }
  return { created, total: ALL_PRICES.length };
}

/** The founding-member coupon (created once, % off forever). */
export async function ensureFoundingCoupon(pct: number): Promise<string | null> {
  if (!pct) return null;
  const s = stripe();
  const id = `cf_founding_${pct}`;
  try { await s.coupons.retrieve(id); } catch { await s.coupons.create({ id, name: `Founding member — ${pct}% off`, percent_off: pct, duration: 'forever' }); }
  return id;
}

async function priceIds(keys: string[]): Promise<Record<string, string>> {
  const res = await stripe().prices.list({ lookup_keys: keys, limit: 100 });
  return Object.fromEntries(res.data.map((p) => [p.lookup_key as string, p.id]));
}

export async function businessSize(tenantId: string) {
  const db = getAdminDb();
  const [staffSnap, leases] = await Promise.all([
    db.collection(`tenants/${tenantId}/staff`).select('status').limit(500).get(),
    db.collection(`tenants/${tenantId}/leases`).where('status', '==', 'active').select('renterId').limit(1000).get(),
  ]);
  const staff = staffSnap.docs.filter((d: any) => !['archived', 'terminated', 'inactive'].includes(String((d.data() as any).status || ''))).length;
  const renters = new Set(leases.docs.map((d: any) => (d.data() as any).renterId).filter(Boolean)).size;
  return { staff: Math.max(1, staff), renters };
}

/** The quote for a business as it stands (or with a proposed set of tools). */
export async function quoteFor(tenantId: string, tools?: ToolId[]) {
  const t = ((await getAdminDb().doc(`tenants/${tenantId}`).get()).data() as any) || {};
  const size = await businessSize(tenantId);
  const use = tools || fromTenantModules(t.modules);
  return { ...quote({ tools: use, staff: size.staff, renters: size.renters, team: t.teamSize === 'team' }), size, tools: use };
}

async function ensureCustomer(tenantId: string, email?: string | null) {
  const db = getAdminDb();
  const ref = db.doc(`tenants/${tenantId}`);
  const t = ((await ref.get()).data() as any) || {};
  if (t.billing?.customerId) return t.billing.customerId as string;
  const c = await stripe().customers.create({ name: t.name || tenantId, email: email || undefined, metadata: { tenantId } });
  await ref.set({ billing: { ...(t.billing || {}), customerId: c.id } }, { merge: true });
  return c.id;
}

export async function checkoutFor(opts: { tenantId: string; email?: string | null; origin: string; tools: ToolId[] }) {
  const settings = await billingSettings();
  const q = await quoteFor(opts.tenantId, opts.tools);
  const ids = await priceIds(q.lines.map((l) => l.key));
  const missing = q.lines.filter((l) => !ids[l.key]);
  if (missing.length) throw new Error('Prices aren’t set up in Stripe yet — HQ → Finance → Set up prices.');
  const customer = await ensureCustomer(opts.tenantId, opts.email);
  const t = ((await getAdminDb().doc(`tenants/${opts.tenantId}`).get()).data() as any) || {};
  const coupon = settings.foundingPct && t.foundingMember !== false ? await ensureFoundingCoupon(settings.foundingPct) : null;
  const freeUntil = settings.freeUntil ? Math.floor(new Date(settings.freeUntil).getTime() / 1000) : 0;
  const trialEnd = freeUntil > Math.floor(Date.now() / 1000) + 2 * 86400 ? freeUntil : undefined;   // Stripe needs 48h+
  const session = await stripe().checkout.sessions.create({
    mode: 'subscription', customer,
    line_items: q.lines.map((l: QuoteLine) => ({ price: ids[l.key], quantity: l.qty })),
    ...(coupon ? { discounts: [{ coupon }] } : { allow_promotion_codes: true }),
    subscription_data: { metadata: { tenantId: opts.tenantId }, ...(trialEnd ? { trial_end: trialEnd } : {}) },
    payment_method_collection: 'always',
    success_url: `${opts.origin}/subscriptions?billing=success`,
    cancel_url: `${opts.origin}/subscriptions?billing=cancelled`,
    metadata: { tenantId: opts.tenantId },
  });
  return session.url as string;
}

export async function portalFor(tenantId: string, origin: string) {
  const t = ((await getAdminDb().doc(`tenants/${tenantId}`).get()).data() as any) || {};
  if (!t.billing?.customerId) throw new Error('No billing account yet.');
  const s = await stripe().billingPortal.sessions.create({ customer: t.billing.customerId, return_url: `${origin}/subscriptions` });
  return s.url;
}

/** Texts a business sent in a period (segments where recorded, else 1 each). */
export async function textsUsed(tenantId: string, fromIso: string, toIso: string): Promise<number> {
  const snap = await getAdminDb().collection(`tenants/${tenantId}/messageLog`).where('sentAt', '>=', fromIso).where('sentAt', '<', toIso).select('channel', 'status', 'segments').limit(20000).get();
  return snap.docs.reduce((n: number, d: any) => { const v = d.data() as any; return v.channel === 'sms' && v.status === 'sent' ? n + (Number(v.segments) || 1) : n; }, 0);
}

export function monthRange(month: string) {
  const [y, m] = month.split('-').map(Number);
  return { from: new Date(Date.UTC(y, m - 1, 1)).toISOString(), to: new Date(Date.UTC(y, m, 1)).toISOString() };
}

/**
 * Bill texts over the allowance for a finished month — added to each paying
 * business's next invoice. Runs once per business per month (platformUsage);
 * nothing is charged during a free period.
 */
export async function billTextOverage(month: string) {
  const db = getAdminDb();
  const { from, to } = monthRange(month);
  const subs = await db.collection('tenants').where('billing.status', '==', 'active').select('billing', 'teamSize', 'name').limit(1000).get();
  const billed: any[] = [];
  for (const d of subs.docs) {
    const t = d.data() as any;
    const ref = db.doc(`platformUsage/${d.id}_${month}`);
    if ((await ref.get()).exists) continue;
    const used = await textsUsed(d.id, from, to);
    const size = await businessSize(d.id);
    const included = (t.teamSize === 'team' || size.staff > 1) ? TEXTS.teamIncluded : TEXTS.soloIncluded;
    const over = Math.max(0, used - included);
    let invoiceItem: string | null = null;
    if (over > 0 && t.billing?.customerId && t.billing?.subscriptionId) {
      const item = await stripe().invoiceItems.create({ customer: t.billing.customerId, subscription: t.billing.subscriptionId, currency: 'usd', amount: over * TEXTS.overageCents,
        description: `Texts over your ${included.toLocaleString()} included — ${month}: ${over.toLocaleString()} × ${TEXTS.overageCents}¢` });
      invoiceItem = item.id;
    }
    await ref.set({ tenantId: d.id, month, used, included, over, amountCents: over * TEXTS.overageCents, invoiceItem, at: new Date().toISOString() });
    if (over > 0) billed.push({ tenantId: d.id, name: t.name, over });
  }
  return billed;
}

/** Bring a live subscription in line with the business's tools and size. */
export async function syncSubscription(tenantId: string) {
  const t = ((await getAdminDb().doc(`tenants/${tenantId}`).get()).data() as any) || {};
  const subId = t.billing?.subscriptionId;
  if (!subId) return { changed: false, reason: 'no subscription' };
  const s = stripe();
  const sub = await s.subscriptions.retrieve(subId, { expand: ['items.data.price'] });
  if (['canceled', 'incomplete_expired'].includes(sub.status)) return { changed: false, reason: sub.status };
  const q = await quoteFor(tenantId);
  const ids = await priceIds(q.lines.map((l) => l.key));
  const want = new Map(q.lines.filter((l) => ids[l.key]).map((l) => [ids[l.key], l.qty]));
  const items: Stripe.SubscriptionUpdateParams.Item[] = [];
  const managed = (price: any) => String(price?.lookup_key || '').startsWith('cf_');
  for (const it of sub.items.data) {
    const pid = (it.price as any).id;
    if (!managed(it.price)) continue;                                    // leave anything added by hand
    if (!want.has(pid)) items.push({ id: it.id, deleted: true });
    else { if (it.quantity !== want.get(pid)) items.push({ id: it.id, quantity: want.get(pid) }); want.delete(pid); }
  }
  for (const [price, quantity] of want) items.push({ price, quantity });
  if (!items.length) return { changed: false, reason: 'already matches', total: q.total };
  await s.subscriptions.update(subId, { items, proration_behavior: 'create_prorations' });
  return { changed: true, total: q.total };
}
