// ─── src/lib/address-validation.ts ────────────────────────────────────────────
// Check the address BEFORE money moves, and record the policy the customer was
// shown while showing it.
//
// WHY BEFORE PAYMENT. A bad address is discovered three ways, in rising order
// of cost: at checkout, where the customer fixes it in ten seconds; at the
// label, where staff have to chase them; or at the carrier, where the parcel
// comes back and everyone has lost a week. Validating at checkout also matters
// for disputes — an address the customer typed, that a carrier confirmed as
// deliverable, and that the parcel was then delivered to, is a much harder
// thing to argue with than an address nobody ever checked.
//
// NEVER BLOCKS ON A DOUBT. Address validators are wrong about new builds, rural
// routes, apartment complexes and anything outside their reference data. A
// validator that refuses a real address costs a whole sale, which is far worse
// than a rare redelivery. So only an outright "this address does not exist"
// stops checkout; everything softer is recorded and waved through.
//
// TENANT-DRIVEN THROUGHOUT. No assumed policy wording, no assumed strictness,
// no assumed country. A shop that has configured nothing gets validation off
// and a neutral policy, and nothing here knows or cares what is being sold.

import { carrierAddress, meaningfulChanges, unitLooksMissing, type Address } from '@/lib/address-flow';

export type AddressVerdict = 'valid' | 'corrected' | 'unconfirmed' | 'undeliverable' | 'skipped';

export interface AddressCheck {
  verdict: AddressVerdict;
  /** The parts of the carrier's version that differ in a way that matters (lib/address-flow), or null. */
  suggestion: Record<string, string> | null;
  /** The carrier's whole version, ready to use, when it differs in a way that matters. */
  carrier?: Address | null;
  /** No apartment or unit was given and it looks like one is needed (lib/address-flow). */
  unitMissing?: boolean;
  /** Validator's own words, for the audit trail. */
  messages: string[];
  checkedAt: string;
  /** What the customer did with the check: took the carrier's version, kept theirs, or said there's no unit. */
  choice?: 'suggested' | 'typed';
  unitAnswer?: 'added' | 'none';
}

export interface AddressPolicy {
  enabled: boolean;
  /** Refuse checkout when the validator says the address does not exist. */
  blockUndeliverable: boolean;
}

export function addressPolicy(retailSettings: any): AddressPolicy {
  const rs = retailSettings || {};
  return {
    enabled: rs.addressValidationEnabled === true,
    // Even with validation on, blocking is a separate decision. Some shops
    // would rather take the order and sort it out by phone.
    blockUndeliverable: rs.blockUndeliverableAddresses === true,
  };
}

const skipped = (): AddressCheck => ({
  verdict: 'skipped', suggestion: null, messages: [], checkedAt: new Date().toISOString(),
});

/** Same shape the quote route already sends Shippo, kept in one place. */
function toShippo(address: any, country: string) {
  return {
    name: String(address?.name || 'Customer'),
    street1: String(address?.line1 || ''),
    street2: String(address?.line2 || ''),
    city: String(address?.city || ''),
    state: String(address?.state || ''),
    zip: String(address?.postalCode || ''),
    country,
    validate: true,
  };
}

/** Only surface a correction the customer would actually care about (lib/address-flow): "Street" against "St",
 *  capitals and a ZIP+4 the validator added are not worth interrupting anyone for. */
function diffOf(typed: any, carrier: Address): Record<string, string> | null {
  const changed = meaningfulChanges(typed || {}, carrier);
  if (!changed.length) return null;
  const out: Record<string, string> = {};
  for (const k of changed) {
    if (k === 'street') { out.line1 = String(carrier.line1 || ''); if (carrier.line2) out.line2 = String(carrier.line2); }
    else out[k] = String((carrier as any)[k] || '');
  }
  return out;
}

/**
 * Ask the carrier network whether this address exists.
 *
 * Never throws. A validator outage must not stop a shop taking orders, so any
 * failure returns 'skipped' and checkout carries on exactly as it does today.
 */
export async function validateAddress(opts: {
  address: any;
  apiKey: string;
  country?: string;
  policy: AddressPolicy;
}): Promise<AddressCheck> {
  const { address, apiKey, policy } = opts;
  const country = String(opts.country || address?.country || 'US').toUpperCase();
  if (!policy.enabled || !apiKey) return skipped();
  if (!address?.line1 || !address?.city || !address?.postalCode) return skipped();

  try {
    const res = await fetch('https://api.goshippo.com/addresses/', {
      method: 'POST',
      headers: { Authorization: `ShippoToken ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(toShippo(address, country)),
    });
    if (!res.ok) return skipped();

    const data: any = await res.json();
    const vr = data?.validation_results || {};
    const messages: string[] = Array.isArray(vr.messages)
      ? vr.messages.map((m: any) => String(m?.text || m?.code || '')).filter(Boolean).slice(0, 5)
      : [];
    const checkedAt = new Date().toISOString();

    if (vr.is_valid === false) {
      return { verdict: 'undeliverable', suggestion: null, carrier: null, unitMissing: false, messages, checkedAt };
    }
    if (vr.is_valid !== true) {
      return { verdict: 'unconfirmed', suggestion: null, carrier: null, unitMissing: unitLooksMissing(address, 'unconfirmed', messages), messages, checkedAt };
    }

    const carrier = carrierAddress(address, data);
    const suggestion = diffOf(address, carrier);
    const verdict: AddressVerdict = suggestion ? 'corrected' : 'valid';
    return {
      verdict,
      suggestion,
      carrier: suggestion ? carrier : null,
      unitMissing: unitLooksMissing(address, verdict, messages),
      messages,
      checkedAt,
    };
  } catch {
    return skipped();
  }
}

/** Should this stop checkout? Only an outright non-existent address, and only
 *  when the shop has explicitly asked for that. */
export function shouldBlock(check: AddressCheck, policy: AddressPolicy): boolean {
  return policy.enabled && policy.blockUndeliverable && check.verdict === 'undeliverable';
}

/** Customer-facing wording. Names the problem and what to do, never scolds. */
export function addressMessage(check: AddressCheck): string {
  if (check.verdict !== 'undeliverable') return '';
  return check.messages.length > 0
    ? `We could not find that address with the carriers: ${check.messages[0]} Please check it and try again.`
    : 'We could not find that address with the carriers. Please check it and try again.';
}

/* ════════════════════════════════════════════════════════════════════════════
 * POLICY SNAPSHOT
 *
 * The dispute narrative asserts that the return and delivery policy is shown to
 * the customer at checkout. That claim has to be true, and provable, or it does
 * more harm than saying nothing. Snapshotting the exact text onto the order at
 * the moment of purchase means a policy edited a year later cannot retroactively
 * change what a past customer agreed to.
 * ════════════════════════════════════════════════════════════════════════════ */

export interface PolicySnapshot {
  text: string;
  shownAt: string;
}

/** The tenant's own words if they have written any; otherwise something true
 *  for any business selling any physical thing. */
export function checkoutPolicyText(retailSettings: any): string {
  const rs = retailSettings || {};
  const stated = String(rs.returnPolicyText || '').trim();
  if (stated) return stated;
  const days = Math.max(0, Math.floor(Number(rs.returnWindowDays) || 0));
  const report = Math.max(0, Math.floor(Number(rs.deliveryIssueWindowDays) || 0));
  const reportLine = `Please report any delivery problem${report ? ` within ${report} days of delivery` : ' as soon as you can'} so we can put it right.`;
  if (rs.returnsEnabled === false) return `All sales are final, but anything damaged, faulty or wrong is always put right. ${reportLine}`;
  const p = rs.policies || {};
  const m = p.restockingFees && typeof p.restockingFees === 'object' ? p.restockingFees : null;
  const pct = (k: string) => Math.min(50, Math.max(0, Math.floor(Number(m ? m[k] : p.restockingFeePct) || 0)));
  const fees = [['unopened', pct('as_new')], ['opened', pct('opened')], ['damaged', pct('damaged')]].filter(([, n]) => Number(n) > 0) as [string, number][];
  const feeLine = !fees.length ? '' : fees.length === 3 && fees.every(([, n]) => n === fees[0][1])
    ? ` A ${fees[0][1]}% restocking fee applies to change-of-mind refunds.`
    : ` Change-of-mind refunds carry a restocking fee: ${fees.map(([w, n]) => `${n}% for ${w} items`).join(', ')}.`;
  return `Returns accepted${days ? ` within ${days} days of delivery` : ''}.${feeLine} There is never a fee when an item arrives damaged, faulty or wrong. ${reportLine}`;
}

export function policySnapshot(retailSettings: any): PolicySnapshot {
  return { text: checkoutPolicyText(retailSettings), shownAt: new Date().toISOString() };
}

/** Stripe caps custom_text at 1200 characters and rejects the whole session if
 *  it is exceeded — trim rather than lose the sale. */
export function stripeCustomText(text: string): string {
  const t = String(text || '').trim();
  return t.length <= 1200 ? t : `${t.slice(0, 1197)}...`;
}
