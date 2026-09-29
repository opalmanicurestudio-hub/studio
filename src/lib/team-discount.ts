// src/lib/team-discount.ts — TEAM and FAMILY & FRIENDS discounts (pure; used by the screen AND the server).
// A client can be linked to the business as a TEAM MEMBER (their own visits) or as FAMILY & FRIENDS of a team member
// (client.discountGroup). The business sets a % off services and a % off products for each (Settings → Payments),
// an optional monthly cap per person, and whether it combines with discount codes (by default it doesn't — the
// client gets whichever is bigger). Never discounted: memberships, packages, deposits, rentals, fees, tips.
export type GroupType = 'team' | 'family';
export interface TeamDiscountSettings { team: { on: boolean; servicesPct: number; productsPct: number }; family: { on: boolean; servicesPct: number; productsPct: number; perStaffLimit: number }; monthlyCap: number; stackWithCodes: boolean }

const pct = (v: any, d: number) => { const n = Number(v); return Number.isFinite(n) ? Math.max(0, Math.min(100, n)) : d; };
export function teamDiscountSettingsOf(t: any): TeamDiscountSettings {
  const s = t?.teamDiscounts || {};
  return {
    team: { on: s.team?.on === true, servicesPct: pct(s.team?.servicesPct, 20), productsPct: pct(s.team?.productsPct, 20) },
    family: { on: s.family?.on === true, servicesPct: pct(s.family?.servicesPct, 10), productsPct: pct(s.family?.productsPct, 10), perStaffLimit: Math.max(0, Math.round(Number(s.family?.perStaffLimit) || 0)) },
    monthlyCap: Math.max(0, Number(s.monthlyCap) || 0), stackWithCodes: s.stackWithCodes === true,
  };
}
export const monthKey = (d = new Date()) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;

/** What this client gets, if anything: the programme, its %s, a label, and what's left of this month's cap. */
export function groupDiscountFor(t: any, client: any, now = new Date()) {
  const g = client?.discountGroup; if (!g || !['team', 'family'].includes(g.type)) return null;
  const s = teamDiscountSettingsOf(t); const p = g.type === 'team' ? s.team : s.family;
  if (!p.on || (!p.servicesPct && !p.productsPct)) return null;
  const used = client?.teamDiscountUsage?.month === monthKey(now) ? Number(client.teamDiscountUsage.amount) || 0 : 0;
  const remaining = s.monthlyCap > 0 ? Math.max(0, s.monthlyCap - used) : Infinity;
  const who = String(g.staffName || '').split(' ')[0];
  return { type: g.type as GroupType, servicesPct: p.servicesPct, productsPct: p.productsPct, remaining, stackWithCodes: s.stackWithCodes, staffId: g.staffId || null,
    label: g.type === 'team' ? 'Team discount' : `Family & friends${who ? ` (${who}’s)` : ''}` };
}

/** The amount, on the eligible parts of the ticket only, within this month's cap. */
export function groupDiscountAmount(g: ReturnType<typeof groupDiscountFor>, parts: { services: number; products: number }) {
  if (!g) return 0;
  const raw = Math.max(0, parts.services) * (g.servicesPct / 100) + Math.max(0, parts.products) * (g.productsPct / 100);
  return Math.round(Math.min(raw, g.remaining) * 100) / 100;
}
