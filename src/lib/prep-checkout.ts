// src/lib/prep-checkout.ts — BEFORE THE VISIT, ROUND 3: what was agreed, at checkout (client and server safe).
//   add-ons with a count — "Repair × 2" is charged twice (the booking keeps each id once in addOnIds; the count lives in
//             prepAddOns). The provider can lower the count at checkout when less was needed (checkoutState.prepUsed),
//             and the price drops on its own.
//   the "up to" price — a change the client agreed to (before the visit, or in person on the day) is a ceiling: the work
//             on the ticket (service, add-ons, extra time, extra product) can't go over it without the client agreeing
//             again in person (checkoutState.overAgreed). Less is fine.
//   the on-the-day fee — the business's own fee for a change found on the day (checkoutState.adjustments.dayChangeFee).

const num = (v: any) => (Number.isFinite(Number(v)) ? Number(v) : 0);

export interface PrepLine { id: string; qty: number; priceEach: number }

/** The add-ons agreed before the visit or on the day, each with its count. */
export function prepAddOnsOf(a: any): PrepLine[] {
  const raw = Array.isArray(a?.prepAddOns) ? a.prepAddOns : [];
  const out = new Map<string, PrepLine>();
  for (const x of raw) { const id = String(x?.id || ''); if (!id) continue; const qty = Math.max(0, Math.min(20, Math.round(num(x.qty) || 1))); const prev = out.get(id); out.set(id, { id, qty: (prev?.qty || 0) + qty, priceEach: num(x.priceEach) || prev?.priceEach || 0 }); }
  return [...out.values()];
}

/** How many of an agreed add-on are being charged — the agreed count, or fewer if the provider lowered it at checkout. */
export function usedQty(a: any, line: PrepLine): number {
  const u = a?.checkoutState?.prepUsed?.[line.id];
  return u === undefined || u === null ? line.qty : Math.max(0, Math.min(line.qty, Math.round(num(u))));
}

/** Every add-on id to charge, repeated by its count. Use this wherever a visit's add-ons are priced. */
export function addOnIdsOf(a: any): string[] {
  const ids: string[] = Array.isArray(a?.addOnIds) ? a.addOnIds.map(String) : [];
  const prep = prepAddOnsOf(a); if (!prep.length) return ids;
  const prepIds = new Set(prep.map((x) => x.id));
  const before: string[] = Array.isArray(a?.addOnIdsBeforePrep) ? a.addOnIdsBeforePrep.map(String) : [];
  const out: string[] = [];
  for (const id of ids) if (!prepIds.has(id)) out.push(id);                       // booked before (or added since), not part of the change
  for (const line of prep) {
    if (!ids.includes(line.id)) continue;                                         // taken off the booking since — nothing to charge
    if (before.includes(line.id)) out.push(line.id);                              // they'd booked one already; the change adds more
    for (let i = 0; i < usedQty(a, line); i++) out.push(line.id);
  }
  return out;
}

/** The agreed "up to" price, or null when there isn't one. */
export function ceilingOf(a: any): number | null {
  if (a?.priceIsCeiling !== true) return null; const p = Number(a?.price); return Number.isFinite(p) && p >= 0 ? p : null;
}

/** The work on the ticket for one visit (what the ceiling covers): service, add-ons, extra time, extra product. */
export function workOf(v: { mainPrice?: number; addOns?: Array<{ price?: number }>; timeOverage?: number; materialOverage?: number }): number {
  return Math.round((num(v.mainPrice) + (v.addOns || []).reduce((s, x) => s + num(x.price), 0) + num(v.timeOverage) + num(v.materialOverage)) * 100) / 100;
}

/** Over the agreed price, and nobody has recorded that the client agreed to more? */
export function overCeiling(a: any, work: number): { over: boolean; ceiling: number | null; by: number } {
  const c = ceilingOf(a); if (c === null) return { over: false, ceiling: null, by: 0 };
  const by = Math.round((work - c) * 100) / 100;
  return { over: by > 0.009 && !a?.checkoutState?.overAgreed, ceiling: c, by: Math.max(0, by) };
}

/** The on-the-day fee on this visit (dollars). */
export const dayFeeOf = (a: any) => num(a?.checkoutState?.adjustments?.dayChangeFee);
