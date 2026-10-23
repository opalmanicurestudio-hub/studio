// src/lib/address-flow.ts — GETTING THE ADDRESS RIGHT, AND CHANGING IT. The pure rules, shared by the checkout page, the
// customer's order page, the staff screens and the routes (the carrier check itself is lib/address-validation).
//
//   At checkout   the carrier's version is offered only when it differs in a way that matters (a different number,
//                 street, unit, city, state or ZIP). "Street" against "St", capitals and the ZIP+4 never ask anything.
//                 An address that looks like it needs an apartment number asks for one, once.
//   Changes       the customer's own change goes straight onto the order until the shop's point (the label by
//                 default, or packing, or never, or not online at all: they message the shop). After that, or on an order held for review, it becomes a request
//                 that staff approve in one tap. Once it has shipped, it's between the customer and the carrier: the
//                 order page points to the carrier's own options. (A carrier intercept can only be asked for by the
//                 shop, costs a fee and isn't guaranteed, so it isn't offered as a request.)

export type Address = { name?: string; line1?: string; line2?: string; city?: string; state?: string; postalCode?: string; country?: string };
export type ChangeUntil = 'label' | 'packing' | 'never' | 'off';
export type ChangeMode = 'direct' | 'request' | 'carrier' | 'none';

const STATES: Record<string, string> = {
  alabama: 'AL', alaska: 'AK', arizona: 'AZ', arkansas: 'AR', california: 'CA', colorado: 'CO', connecticut: 'CT', delaware: 'DE',
  'district of columbia': 'DC', florida: 'FL', georgia: 'GA', hawaii: 'HI', idaho: 'ID', illinois: 'IL', indiana: 'IN', iowa: 'IA',
  kansas: 'KS', kentucky: 'KY', louisiana: 'LA', maine: 'ME', maryland: 'MD', massachusetts: 'MA', michigan: 'MI', minnesota: 'MN',
  mississippi: 'MS', missouri: 'MO', montana: 'MT', nebraska: 'NE', nevada: 'NV', 'new hampshire': 'NH', 'new jersey': 'NJ',
  'new mexico': 'NM', 'new york': 'NY', 'north carolina': 'NC', 'north dakota': 'ND', ohio: 'OH', oklahoma: 'OK', oregon: 'OR',
  pennsylvania: 'PA', 'rhode island': 'RI', 'south carolina': 'SC', 'south dakota': 'SD', tennessee: 'TN', texas: 'TX', utah: 'UT',
  vermont: 'VT', virginia: 'VA', washington: 'WA', 'west virginia': 'WV', wisconsin: 'WI', wyoming: 'WY', 'puerto rico': 'PR', guam: 'GU',
  'virgin islands': 'VI', 'american samoa': 'AS', 'northern mariana islands': 'MP',
};

// Words carriers shorten. Both sides are shortened before comparing, so either spelling matches.
const SHORT: Record<string, string> = {
  street: 'st', avenue: 'ave', av: 'ave', road: 'rd', drive: 'dr', boulevard: 'blvd', lane: 'ln', court: 'ct', place: 'pl',
  terrace: 'ter', circle: 'cir', parkway: 'pkwy', highway: 'hwy', square: 'sq', trail: 'trl', crossing: 'xing', expressway: 'expy',
  freeway: 'fwy', heights: 'hts', point: 'pt', ridge: 'rdg', mountain: 'mtn', center: 'ctr', centre: 'ctr', creek: 'crk', loop: 'loop',
  north: 'n', south: 's', east: 'e', west: 'w', northeast: 'ne', northwest: 'nw', southeast: 'se', southwest: 'sw',
  apartment: '#', apt: '#', unit: '#', suite: '#', ste: '#', building: 'bldg', floor: 'fl', room: 'rm',
  saint: 'st', fort: 'ft', mount: 'mt',
};

const words = (v: unknown) => String(v ?? '').toLowerCase()
  .replace(/\bp\s*\.?\s*o\s*\.?\s*box\b|\bpost office box\b/g, ' pobox ')
  .replace(/#/g, ' # ').replace(/[.,'’]/g, ' ').replace(/[^a-z0-9#\s-]/g, ' ').split(/\s+/).filter(Boolean);
const shorten = (v: unknown) => words(v).map((w) => SHORT[w] ?? w).join(' ').replace(/# #/g, '#').replace(/#\s+/g, '#');
export const stateCode = (v: unknown) => { const s = String(v ?? '').trim(); return s.length === 2 ? s.toUpperCase() : STATES[s.toLowerCase()] || s.toUpperCase(); };
const zip5 = (v: unknown) => String(v ?? '').replace(/[^0-9]/g, '').slice(0, 5);

/** The street, unit and all, as one comparable string (a unit typed on either line matches). */
const streetKey = (a: Address) => shorten(`${a.line1 || ''} ${a.line2 || ''}`);

/** A key that's the same for two ways of writing the same address. */
export function addressKey(a: Address | null | undefined): string {
  if (!a) return '';
  return [streetKey(a), shorten(a.city), stateCode(a.state).toLowerCase(), zip5(a.postalCode)].join('|');
}

/** Same place? (Names aside: a different recipient at the same address is still the same address.) */
export const sameAddress = (a: Address | null | undefined, b: Address | null | undefined) => !!a && !!b && addressKey(a) === addressKey(b);

const UNIT_AT_END = /\s*(#|\bapt\b|\bapartment\b|\bunit\b|\bste\b|\bsuite\b|\bbldg\b|\bbuilding\b|\bfl\b|\bfloor\b|\brm\b|\broom\b|\blot\b|\bspc\b|\bspace\b)\.?\s*\S.*$/i;

/** The apartment or unit, wherever it was typed ("Apt 4B" on the second line, or "12 Oak St #4B" on the first). */
export function unitOf(a: Address): string {
  const l2 = String(a.line2 || '').trim(); if (l2) return l2;
  const m = String(a.line1 || '').match(UNIT_AT_END); return m ? m[0].trim() : '';
}

/** Which parts of the carrier's version differ in a way the customer would care about. Empty when only the spelling does. */
export function meaningfulChanges(typed: Address, carrier: Address): ('street' | 'city' | 'state' | 'postalCode')[] {
  const out: ('street' | 'city' | 'state' | 'postalCode')[] = [];
  if (carrier.line1 && streetKey(typed) !== streetKey(carrier)) out.push('street');
  if (carrier.city && shorten(typed.city) !== shorten(carrier.city)) out.push('city');
  if (carrier.state && stateCode(typed.state) !== stateCode(carrier.state)) out.push('state');
  if (carrier.postalCode && zip5(typed.postalCode) !== zip5(carrier.postalCode)) out.push('postalCode');
  return out;
}

/** Carriers answer in capitals; people read "12 Oak St Apt 4B". Numbers, units and short codes stay as they are. */
export function tidyCase(v: unknown): string {
  return String(v ?? '').trim().split(/\s+/).filter(Boolean).map((w) => {
    if (/\d/.test(w) || /^(N|S|E|W|NE|NW|SE|SW|PO|US|RR|HC|APO|FPO|DPO)$/i.test(w)) return w.toUpperCase();
    return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
  }).join(' ');
}

/** The carrier's answer as an address the customer can pick, keeping the name they typed, and the unit they typed when
 *  the carrier's answer left it off (offering to drop someone's apartment number would be a step backwards). */
export function carrierAddress(typed: Address, shippo: any): Address {
  const c: Address = {
    name: String(typed.name || '').trim(),
    line1: tidyCase(shippo?.street1), line2: tidyCase(shippo?.street2),
    city: tidyCase(shippo?.city), state: String(shippo?.state || typed.state || '').trim().toUpperCase(),
    postalCode: String(shippo?.zip || typed.postalCode || '').trim(), country: String(shippo?.country || typed.country || 'US').toUpperCase(),
  };
  const mine = unitOf(typed);
  if (mine && !unitOf(c)) c.line2 = mine;
  return c;
}

const UNIT_TYPED = /(^|\s)(#|apt|apartment|unit|ste|suite|bldg|building|fl|floor|rm|room|lot|spc|space|trlr|dept)\b|#/i;
const UNIT_WORDS = /secondary|apartment|\bapt\b|suite|\bunit\b|default match|more specific/i;

/** Should we ask for an apartment or unit number? Only when none was given, and the carrier hinted one is missing or
 *  couldn't confirm the address (a missing unit is the usual reason). Asked once; "There isn't one" is always fine. */
export function unitLooksMissing(typed: Address, verdict: string, messages: string[] = []): boolean {
  if (String(typed.line2 || '').trim() || UNIT_TYPED.test(String(typed.line1 || ''))) return false;
  if (/^\s*(p\s*o|post office)\s*box\b/i.test(String(typed.line1 || ''))) return false;
  if (messages.some((m) => UNIT_WORDS.test(String(m)))) return true;
  return verdict === 'unconfirmed';
}

export function oneLine(a: Address | null | undefined): string {
  if (!a) return '';
  return [a.line1, a.line2, a.city, [stateCode(a.state), a.postalCode].filter(Boolean).join(' ')].map((x) => String(x || '').trim()).filter(Boolean).join(', ');
}

export function addressLinesOf(a: Address | null | undefined): string[] {
  if (!a) return [];
  return [a.name, a.line1, a.line2, [a.city, [a.state, a.postalCode].filter(Boolean).join(' ')].filter(Boolean).join(', ')].map((x: any) => String(x || '').trim()).filter(Boolean);
}

/** A typed address, trimmed and capped, or null when it's missing something a label needs. */
export function cleanAddress(a: any): Address | null {
  const c: Address = {
    name: String(a?.name || '').trim().slice(0, 80), line1: String(a?.line1 || '').trim().slice(0, 120), line2: String(a?.line2 || '').trim().slice(0, 120),
    city: String(a?.city || '').trim().slice(0, 60), state: String(a?.state || '').trim().slice(0, 30), postalCode: String(a?.postalCode || '').trim().slice(0, 15), country: 'US',
  };
  return c.name && c.line1 && c.city && c.state && c.postalCode ? c : null;
}

// ── Changes ─────────────────────────────────────────────────────────────────────────────────────────────────────────

export function changePolicy(rs: any): { until: ChangeUntil; heldNeedsManager: boolean } {
  const p = (rs && rs.policies) || {};
  const until: ChangeUntil = ['packing', 'never', 'off'].includes(p.addressChangeUntil) ? p.addressChangeUntil : 'label';
  return { until, heldNeedsManager: p.addressHeldNeedsManager !== false };
}

export const hasLabel = (o: any) => !!(o?.labelUrl || o?.shippoTransactionId || o?.trackingNumber);
const PRE_SHIP = ['placed', 'paid', 'picking', 'packed'];

/**
 * What a customer's address change does right now:
 *   direct    it goes onto the order (checked with the carrier first)
 *   request   it goes to the shop to approve (after the shop's point, or on a held order)
 *   carrier   it has shipped: only the carrier's own options are left
 *   none      it can't be changed (not shipped by post, delivered, cancelled)
 * `why` is for staff and wording; a hold is never shown to the customer.
 */
export function changeMode(o: any, rs: any): { mode: ChangeMode; why: 'ok' | 'label' | 'packing' | 'never' | 'held' | 'shipped' | 'closed' | 'off' } {
  if (!o || o.method !== 'ship') return { mode: 'none', why: 'closed' };
  const stage = String(o.stage || '');
  if (stage === 'shipped' && !o.deliveredAt) return { mode: 'carrier', why: 'shipped' };
  if (!PRE_SHIP.includes(stage)) return { mode: 'none', why: 'closed' };
  const pol = changePolicy(rs);
  // The shop doesn't take address changes online: the customer messages them, and the team changes it.
  if (pol.until === 'off') return { mode: 'none', why: 'off' };
  if (o.holdForReview === true && pol.heldNeedsManager) return { mode: 'request', why: 'held' };
  if (pol.until === 'never') return { mode: 'request', why: 'never' };
  if (hasLabel(o)) return { mode: 'request', why: 'label' };
  if (pol.until === 'packing' && !['placed', 'paid'].includes(stage)) return { mode: 'request', why: 'packing' };
  return { mode: 'direct', why: 'ok' };
}

/** The customer's change waiting for staff (or being approved this moment), if any. */
export const openRequest = (o: any) => (o?.addressRequest && ['waiting', 'approving'].includes(String(o.addressRequest.status)) ? o.addressRequest : null);
/** Staff asked the customer to confirm, and they haven't answered. */
export const awaitingConfirm = (o: any) => o?.addressConfirm?.status === 'waiting';
