// src/lib/address-cost.ts — WHAT A NEW ADDRESS DOES TO THE SHIPPING COST, AND WHO PAYS THE DIFFERENCE (server).
// When a customer changes the address on their order before the shop's cutoff, the parcel is priced again for the
// same service to the old address and to the new one (the order's own weight, the shop's markup), so the difference
// is what the move itself costs, not what was paid at checkout (free shipping and flat rates included). The shop
// decides who pays it (Orders → Policies → Addresses):
//   shop         the shop covers it (the default, as before)
//   customer     the customer pays the difference before the change goes through
//   shop_up_to   the shop covers it up to a limit, the customer pays the rest
// What the moves have cost is kept on each order (addressCost), measured from the price to the ORIGINAL address: a
// second move counts what both moves add (the shop's limit covers the order once, not once per move), a move back
// counts nothing, and the policy screen's running total adds up each order's current share. A cheaper address changes
// nothing: what was paid at checkout stays as it was. Flat-rate shipping doesn't depend on the address. A customer
// share too small to pay by card is covered by the shop.
import crypto from 'crypto';
import { addressKey, type Address } from '@/lib/address-flow';
import { groundFilter, itemGroundOnly } from '@/lib/ground-only';

export type CostPayer = 'shop' | 'customer' | 'shop_up_to';
/** The smallest card payment Stripe takes. A customer share below it is covered by the shop. */
export const MIN_CARD_CENTS = 50;
export type AddressCost = { ok: true; diffCents: number; fromCents: number; toCents: number; service: string; carrier: string; flat?: boolean } | { ok: false; reason: string };

export function costPolicy(rs: any): { payer: CostPayer; limitCents: number } {
  const p = (rs && rs.policies) || {};
  const payer: CostPayer = p.addressCostPayer === 'customer' || p.addressCostPayer === 'shop_up_to' ? p.addressCostPayer : 'shop';
  const raw = p.addressCostLimitCents === undefined || p.addressCostLimitCents === null ? 200 : Number(p.addressCostLimitCents);
  const limitCents = Math.max(0, Math.min(5000, Math.round(Number.isFinite(raw) ? raw : 200)));
  return { payer, limitCents };
}

/** Who pays a difference, by the shop's policy. Nothing when the new address costs the same or less. */
export function splitCost(diffCents: number, pol: { payer: CostPayer; limitCents: number }): { shopCents: number; customerCents: number } {
  const d = Math.max(0, Math.round(Number(diffCents) || 0));
  if (!d) return { shopCents: 0, customerCents: 0 };
  if (pol.payer === 'shop') return { shopCents: d, customerCents: 0 };
  if (pol.payer === 'customer') return { shopCents: 0, customerCents: d };
  const shop = Math.min(d, Math.max(0, pol.limitCents));
  return { shopCents: shop, customerCents: d - shop };
}

export type CostState = { origCents: number; toCents: number; extraCents: number; customerCents: number; shopCents: number; service: string; carrier: string; moves: number; at: string };
/** What the order's moves cost after this one, and what the customer owes now. Measured from the price to the
 *  original address (kept from the first move), so moving twice counts both, moving back counts nothing, and the
 *  shop's limit applies to the order as a whole. What the customer already paid counts toward their share; nothing is
 *  refunded for moving somewhere cheaper. A share too small to pay by card is the shop's. */
export function costAfterMove(prior: any, f: { fromCents: number; toCents: number; service: string; carrier: string }, pol: { payer: CostPayer; limitCents: number }, at = new Date().toISOString()): { owedCents: number; state: CostState } {
  const orig = prior && Number.isFinite(Number(prior.origCents)) ? Math.round(Number(prior.origCents)) : Math.round(Number(f.fromCents) || 0);
  const paid = prior ? Math.max(0, Math.round(Number(prior.customerCents) || 0)) : 0;
  const extra = Math.max(0, Math.round(Number(f.toCents) || 0) - orig);
  const share = pol.payer === 'shop' ? 0 : pol.payer === 'customer' ? extra : Math.max(0, extra - Math.max(0, pol.limitCents));
  let owed = Math.max(0, share - paid);
  if (owed > 0 && owed < MIN_CARD_CENTS) owed = 0;
  const customerCents = paid + owed;
  return { owedCents: owed, state: { origCents: orig, toCents: Math.round(Number(f.toCents) || 0), extraCents: extra, customerCents, shopCents: Math.max(0, extra - customerCents), service: String(f.service || ''), carrier: String(f.carrier || ''), moves: (Number(prior?.moves) || 0) + 1, at } };
}

/** The parcel the order makes: its items' weights plus packaging, the way checkout priced it. */
export async function orderParcel(db: any, tenantId: string, order: any): Promise<{ weightOz: number; groundOnly: boolean }> {
  let ounces = 0; let known = false; let groundOnly = false;
  for (const l of Array.isArray(order?.lines) ? order.lines.slice(0, 60) : []) {
    if (l?.digital === true) continue;
    const qty = Math.max(0, (Number(l?.qtyOrdered) || 0) - (Number(l?.qtyShorted) || 0));
    const id = String(l?.productId || '').replace(/^test-/, '');
    if (!qty || !id) continue;
    const d: any = (await db.doc(`tenants/${tenantId}/inventory/${id}`).get().catch(() => null))?.data?.() || null;
    if (!d) continue;
    if (itemGroundOnly(d)) groundOnly = true;
    const w = Number(d.weightOz) || 0;
    if (w > 0) { known = true; ounces += w * qty; }
  }
  return { weightOz: known ? Math.max(1, Math.ceil(ounces + 4)) : 16, groundOnly };
}

type Rate = { carrier: string; service: string; cents: number };

/** Live carrier rates for one parcel to one address (the shop's own Shippo account), cheapest first; null if none. */
export async function shippingRates(apiKey: string, from: any, to: Address, parcel: { weightOz: number; groundOnly: boolean }, fetchImpl: typeof fetch = fetch, timeoutMs = 6000): Promise<Rate[] | null> {
  // A slow carrier never holds up the customer's change for long: no answer in a few seconds counts as no rates.
  const ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = ctl ? setTimeout(() => ctl.abort(), timeoutMs) : null;
  try {
    const res = await fetchImpl('https://api.goshippo.com/shipments/', {
      ...(ctl ? { signal: ctl.signal } : {}),
      method: 'POST',
      headers: { Authorization: `ShippoToken ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        address_from: { name: from.name || 'Shop', street1: from.street1, city: from.city, state: from.state, zip: from.zip, country: 'US' },
        address_to: { name: String(to.name || 'Customer'), street1: String(to.line1 || ''), street2: String(to.line2 || ''), city: String(to.city || ''), state: String(to.state || ''), zip: String(to.postalCode || ''), country: 'US' },
        parcels: [{ length: '10', width: '8', height: '4', distance_unit: 'in', weight: String(parcel.weightOz), mass_unit: 'oz' }],
        async: false,
      }),
    } as any);
    const data: any = await (res as any).json().catch(() => ({}));
    if (!(res as any).ok) return null;
    const rates = groundFilter(Array.isArray(data.rates) ? data.rates : [], parcel.groundOnly)
      .map((r: any) => ({ carrier: String(r.provider || 'Carrier'), service: String(r.servicelevel?.name || r.servicelevel?.token || 'Shipping'), cents: Math.round(parseFloat(r.amount) * 100) }))
      .filter((r: Rate) => Number.isFinite(r.cents) && r.cents > 0)
      .sort((a: Rate, b: Rate) => a.cents - b.cents);
    return rates.length ? rates : null;
  } catch { return null; }
  finally { if (timer) clearTimeout(timer); }
}

const norm = (s: unknown) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
const pick = (rates: Rate[], carrier: string, service: string): Rate | null =>
  (carrier && service ? rates.find((r) => norm(r.carrier) === norm(carrier) && norm(r.service) === norm(service)) || null : null);

/** What moving this order to `to` does to its shipping cost. */
export async function addressCostFor(db: any, tenantId: string, tenant: any, order: any, to: Address, o: { apiKey?: string; fetchImpl?: typeof fetch; timeoutMs?: number } = {}): Promise<AddressCost> {
  const rs = tenant?.retailSettings || {};
  const from = rs.shipFrom || {};
  if (!order?.shippingAddress || addressKey(order.shippingAddress) === addressKey(to)) return { ok: true, diffCents: 0, fromCents: 0, toCents: 0, service: '', carrier: '' };
  let apiKey = o.apiKey;
  if (apiKey === undefined) { const { shippoKeyFor } = await import('@/lib/retail-secrets'); apiKey = await shippoKeyFor(db, tenantId, tenant); }
  // No carrier account (or no ship-from address): the shop charges a flat rate, which no address changes.
  if (!apiKey || !from.street1 || !from.city || !from.state || !from.zip) return { ok: true, diffCents: 0, fromCents: 0, toCents: 0, service: 'Standard shipping', carrier: 'Shop', flat: true };
  const parcel = await orderParcel(db, tenantId, order);
  const [before, after] = await Promise.all([shippingRates(apiKey, from, order.shippingAddress, parcel, o.fetchImpl, o.timeoutMs), shippingRates(apiKey, from, to, parcel, o.fetchImpl, o.timeoutMs)]);
  if (!before || !after) return { ok: false, reason: 'no_rates' };
  // The service they chose, at both addresses; if it isn't offered at one of them (or they had free or flat shipping),
  // the cheapest at each, which is what the shop would buy.
  const carrier = String(order.shippingCarrier || ''); const service = String(order.shippingService || '');
  let a = pick(before, carrier, service); let b = pick(after, carrier, service);
  if (!a || !b) { a = before[0]; b = after[0]; }
  const markup = Math.max(0, Number(rs.shippingMarkupPercent) || 0);
  const up = (c: number) => Math.round(c * (1 + markup / 100));
  return { ok: true, fromCents: up(a.cents), toCents: up(b.cents), diffCents: up(b.cents) - up(a.cents), service: b.service, carrier: b.carrier };
}

// ── The customer's payment for the difference: the amount they were shown, signed, so it can't be changed ──────────
// The price is for moving FROM the address the order had when it was priced, so it can't be paid after the address
// changed (staff moved it, or the customer already paid for it on another page): they're asked to look again.

const secret = () => String(process.env.RETAIL_QUOTE_SECRET || process.env.FIREBASE_ADMIN_PRIVATE_KEY || 'clarityflow-quote');
export type PayFacts = { cents: number; shopCents: number; diffCents: number; fromCents: number; toCents: number; origCents: number; paidBefore: number; service: string; carrier: string };
const factLine = (f: PayFacts) => [f.cents, f.shopCents, f.diffCents, f.fromCents, f.toCents, f.origCents, f.paidBefore].map((n) => Math.round(Number(n) || 0)).join('|') + `|${String(f.service || '')}|${String(f.carrier || '')}`;
export function signAddressPay(tenantId: string, orderId: string, from: Address | null | undefined, to: Address, f: PayFacts, exp: number): string {
  return crypto.createHmac('sha256', secret()).update(`addrpay|${tenantId}|${orderId}|${from ? addressKey(from) : ''}|${addressKey(to)}|${factLine(f)}|${exp}`).digest('base64url');
}
export function verifyAddressPay(tenantId: string, orderId: string, from: Address | null | undefined, to: Address, f: PayFacts, exp: number, sig: string): boolean {
  if (!sig || !Number.isFinite(exp) || Date.now() > exp) return false;
  const want = Buffer.from(signAddressPay(tenantId, orderId, from, to, f, exp)); const got = Buffer.from(String(sig));
  return want.length === got.length && crypto.timingSafeEqual(want, got);
}
