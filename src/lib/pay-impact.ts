// src/lib/pay-impact.ts — WHAT EACH PAY CHOICE LEAVES THE BUSINESS, per visit, so owners decide with the numbers in
// front of them: "a 60-minute massage is $120 — at 40% commission you pay $48 and keep $41; per service at $30 an hour
// you pay $30 and keep $61; a member's visit brings in $60, so 40% commission (paid on the normal $120) leaves you −$7".
//
// A visit's money: what it brings in − provider pay × (1 + employer taxes) − products − running costs for the time the
// station is busy (the business's cost per hour × set-up + service + turnover). Same parts as lib/visit-cost.
import { unitCost } from '@/lib/visit-cost';
import { rateFor, payForService } from '@/lib/commission';

export type VisitKind = { key: 'full' | 'member' | 'covered' | 'package'; label: string; brings: number; charged: number; covered: boolean; note?: string };
export type PayChoice = { key: string; label: string; staff: any; note?: string };
export type Outcome = { pay: number | null; payCost: number; materials: number; overhead: number; keep: number; marginPct: number | null };

const n = (v: any) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const r2 = (v: number) => Math.round(v * 100) / 100;

/** The ways a client can pay for this service: full price, member price, a membership visit, a package session. */
export function visitKinds(service: any, memberships: any[] = [], packages: any[] = []): VisitKind[] {
  const price = n(service?.price); const out: VisitKind[] = [{ key: 'full', label: 'Full price', brings: price, charged: price, covered: false }];
  const mp = n(service?.memberPrice); if (mp > 0 && mp < price) out.push({ key: 'member', label: 'Member price', brings: mp, charged: mp, covered: false });
  // A membership that includes this service: its price over all the visits it includes (if every visit is used — the lowest it can be).
  let worst: VisitKind | null = null;
  for (const m of memberships || []) {
    const perks: any[] = Array.isArray(m?.includedServices) ? m.includedServices : [];
    if (!perks.some((p) => p?.id === service?.id)) continue;
    const visits = perks.reduce((a, p) => a + Math.max(1, n(p?.quantity) || 1), 0); if (!visits || !(n(m.price) > 0)) continue;
    const per = n(m.price) / visits;   // the perks are per billing period
    if (!worst || per < worst.brings) worst = { key: 'covered', label: 'Membership visit', brings: r2(per), charged: 0, covered: true, note: `${m.name}: $${n(m.price).toFixed(0)} ${m.interval === 'yearly' ? 'a year' : 'a month'} for ${visits} visit${visits === 1 ? '' : 's'}` };
  }
  if (worst) out.push(worst);
  const pk = (packages || []).filter((p) => p?.serviceId === service?.id && n(p.sessions) > 0 && n(p.price) > 0).sort((a, b) => n(a.price) / n(a.sessions) - n(b.price) / n(b.sessions))[0];
  if (pk) out.push({ key: 'package', label: 'Package session', brings: r2(n(pk.price) / n(pk.sessions)), charged: 0, covered: true, note: `${pk.name}: $${n(pk.price).toFixed(0)} for ${n(pk.sessions)}` });
  return out;
}

/** What the provider is paid for one visit under a pay setup. null = not paid per visit (salary). */
export function payForVisit(staff: any, service: any, kind: VisitKind, minutes?: number): number | null {
  const ps = String(staff?.payStructure || ''); const m = n(minutes) || n(service?.duration) || 60;
  const commissionOn = kind.covered ? n(service?.price) : kind.charged;   // covered visits count at the normal price
  if (ps === 'commission') return r2(commissionOn * rateFor(staff, service, 40) / 100);
  if (ps === 'hourly_plus_commission') return r2((n(staff.hourlyRate) * m) / 60 / busyShare(staff) + commissionOn * rateFor(staff, service, 40) / 100);
  if (ps === 'per_service') return payForService(staff, service, m);
  if (ps === 'hourly') return r2((n(staff.hourlyRate) * m) / 60 / busyShare(staff));
  return null;
}
/** Hourly staff are paid between clients too: the share of their paid time spent with clients (default 70%). */
export const busyShare = (staff: any) => Math.min(1, Math.max(0.3, n(staff?.busyShare) || 0.7));

/** The money from one visit. */
export function visitOutcome(input: { service: any; staff: any; kind: VisitKind; inventory?: any[]; costPerHour?: number; taxPct?: number; minutes?: number }): Outcome {
  const { service, staff, kind } = input; const inv = input.inventory || [];
  const pay = payForVisit(staff, service, kind, input.minutes);
  const payCost = pay == null ? 0 : pay * (1 + Math.max(0, n(input.taxPct)) / 100);
  let materials = 0; for (const p of service?.products || []) { const it = inv.find((i: any) => i.id === p.id); if (it) materials += (n(p.quantityUsed) || 1) * unitCost(it); }
  const stationMin = (n(input.minutes) || n(service?.duration) || 60) + n(service?.padBefore) + n(service?.padAfter);
  const overhead = (stationMin / 60) * Math.max(0, n(input.costPerHour));
  const keep = kind.brings - payCost - materials - overhead;
  return { pay, payCost: r2(payCost), materials: r2(materials), overhead: r2(overhead), keep: r2(keep), marginPct: kind.brings > 0 ? Math.round((keep / kind.brings) * 1000) / 10 : null };
}

/**
 * The most this visit can pay the provider and still leave `targetPct` of what it brings in.
 * (brings − products − running costs − brings × target) ÷ (1 + employer taxes).
 */
export function maxPayFor(input: { service: any; kind: VisitKind; inventory?: any[]; costPerHour?: number; taxPct?: number; targetPct?: number; minutes?: number }): number {
  const o = visitOutcome({ ...input, staff: { payStructure: 'salary' } });
  const room = input.kind.brings - o.materials - o.overhead - (input.kind.brings * Math.max(0, n(input.targetPct))) / 100;
  return r2(Math.max(0, room / (1 + Math.max(0, n(input.taxPct)) / 100)));
}

/** The pay setups worth comparing for a business: what the team uses today, else common starting points. */
export function choicesFor(team: any[], service: any, a: { commissionPct?: number; perHour?: number; hourly?: number } = {}): PayChoice[] {
  const paid = (team || []).filter((s) => s && s.isRenter !== true);
  const most = (ps: string, f: (s: any) => number) => { const v = paid.filter((s) => s.payStructure === ps).map(f).filter((x) => x > 0); return v.length ? v.sort((x, y) => x - y)[Math.floor(v.length / 2)] : 0; };
  const pct = n(a.commissionPct) || most('commission', (s) => n(s.commissionRate)) || 40;
  const perHour = n(a.perHour) || most('per_service', (s) => n(s.serviceHourRate)) || 30;
  const hourly = n(a.hourly) || most('hourly', (s) => n(s.hourlyRate)) || 20;
  return [
    { key: 'commission', label: service?.commissionRate != null && service.commissionRate !== '' ? `Commission ${n(service.commissionRate)}% (this service)` : `Commission ${pct}%`, staff: { payStructure: 'commission', commissionRate: pct } },
    { key: 'per_service', label: service?.providerPay != null && service.providerPay !== '' ? `Per service $${n(service.providerPay)} (this service)` : `Per service $${perHour} an hour`, staff: { payStructure: 'per_service', serviceHourRate: perHour } },
    { key: 'hourly', label: `Hourly $${hourly}`, staff: { payStructure: 'hourly', hourlyRate: hourly }, note: 'Includes time between clients (busy 70% of the shift).' },
  ];
}
