// src/lib/commission.ts — COMMISSION PER SERVICE, worked out the same way on every screen (payroll, Payday, reports,
// the staff profile, the staff portal, service costing).
//
// Which rate a service line earns, first match wins:
//   1. the rate stamped on the sale at checkout (`commissionPct`) — so changing a rate later never rewrites past pay;
//   2. this person's own rate for this service (`staff.serviceCommission[serviceId]`, e.g. Jo earns 50% on extensions);
//   3. the service's rate for everyone (`service.commissionRate`, e.g. 30% on waxing);
//   4. the person's usual rate (`staff.commissionRate`).
// A visit covered by a membership or package records $0 but carries `commissionBase` (the service's normal price), so
// the provider earns what a paying client's visit would have paid them.
// Sales recorded before services were stamped on them use 2–4 via the sale's serviceId when there is one, else 4.

const pct = (v: any): number | null => { if (v === '' || v === null || v === undefined) return null; const n = Number(v); return Number.isFinite(n) && n >= 0 && n <= 100 ? n : null; };

/** Does this pay structure earn commission on services? */
export const earnsCommission = (staff: any): boolean => ['commission', 'hourly_plus_commission'].includes(String(staff?.payStructure || ''));

/** The person's usual rate (with the screen's own fallback for records that never set one). */
export const usualRate = (staff: any, fallback = 40): number => pct(staff?.commissionRate) ?? fallback;

/** The override that applies to this person and service, if any (2 then 3 above) — null means "their usual rate". */
export function overrideRate(staff: any, service: any): number | null {
  const id = String(service?.id || '');
  return (id ? pct(staff?.serviceCommission?.[id]) : null) ?? pct(service?.commissionRate);
}

/** The rate this person earns on this service. */
export function rateFor(staff: any, service: any, fallback = 40): number {
  return overrideRate(staff, service) ?? usualRate(staff, fallback);
}

const isServiceIncome = (t: any) => (t?.type || 'income') === 'income' && t?.category === 'Service Revenue';
const amountOf = (t: any) => (typeof t?.amount === 'number' ? t.amount : (Number(t?.amountCents) || 0) / 100);

export type CommissionLine = { serviceId: string | null; name: string; revenue: number; rate: number; commission: number };

/**
 * Commission on a person's service sales. `txns` may include other people's and other categories — only this person's
 * service income counts. `services` is the service list (or a map by id). Returns the total and a per-service breakdown.
 */
export function serviceCommission(staff: any, txns: any[], services: any[] | Record<string, any>, fallback = 40): { total: number; revenue: number; lines: CommissionLine[] } {
  const byId: Record<string, any> = Array.isArray(services) ? Object.fromEntries(services.filter(Boolean).map((s: any) => [s.id, s])) : (services || {});
  const groups = new Map<string, CommissionLine>(); let total = 0, revenue = 0;
  for (const t of txns || []) {
    if (!isServiceIncome(t) || (staff?.id && t.staffId && t.staffId !== staff.id)) continue;
    const amt = amountOf(t); const svc = t.serviceId ? byId[t.serviceId] : null;
    const rate = pct(t.commissionPct) ?? rateFor(staff, svc || { id: t.serviceId }, fallback);
    const base = t.commissionBase != null && Number.isFinite(Number(t.commissionBase)) ? Number(t.commissionBase) : amt;   // covered visits: the normal price
    const c = (base * rate) / 100; total += c; revenue += amt;
    const key = `${t.serviceId || '-'}|${rate}`; const g = groups.get(key) || { serviceId: t.serviceId || null, name: svc?.name || (t.serviceId ? 'Service' : 'Services'), revenue: 0, rate, commission: 0 };
    g.revenue += amt; g.commission += c; groups.set(key, g);
  }
  const lines = [...groups.values()].map((g) => ({ ...g, revenue: Math.round(g.revenue * 100) / 100, commission: Math.round(g.commission * 100) / 100 })).sort((a, b) => b.commission - a.commission);
  return { total, revenue, lines };
}

/** What to stamp on a service sale at checkout: the service, the commission rate it earned, the provider's per service pay. */
export function saleStamp(staff: any, service: any, opts: { minutes?: number; coveredAt?: number | null } = {}): { serviceId?: string; commissionPct?: number; commissionBase?: number; providerPay?: number } {
  const out: { serviceId?: string; commissionPct?: number; commissionBase?: number; providerPay?: number } = {};
  if (service?.id) out.serviceId = String(service.id);
  // Every commission sale carries the rate it earned — a raise or a new rate later never re-prices sales already made.
  if (earnsCommission(staff)) out.commissionPct = overrideRate(staff, service) ?? usualRate(staff, 40);
  if (opts.coveredAt != null && Number(opts.coveredAt) > 0) out.commissionBase = Math.round(Number(opts.coveredAt) * 100) / 100;
  if (paidPerService(staff)) out.providerPay = payForService(staff, service, opts.minutes);
  return out;
}

// ── PER SERVICE PAY ─────────────────────────────────────────────────────────────────────────────────────────────────
// How most membership businesses pay (massage, waxing, med spa): a set amount for each service a provider performs,
// the same whether the client paid full price, used a membership, a package or a gift card. Which amount, first match:
//   1. the amount stamped on the sale at checkout (`providerPay`);
//   2. this person's own amount for this service (`staff.servicePay[serviceId]`);
//   3. the service's amount for everyone (`service.providerPay`);
//   4. the person's rate per service hour (`staff.serviceHourRate`) × the service's length.
export const paidPerService = (staff: any): boolean => String(staff?.payStructure || '') === 'per_service';
const money = (v: any): number | null => { if (v === '' || v === null || v === undefined) return null; const n = Number(v); return Number.isFinite(n) && n >= 0 && n <= 100000 ? n : null; };

/** The set amount that applies to this person and service (2 then 3 above), or null → paid by the hour of service. */
export function payOverride(staff: any, service: any): number | null {
  const id = String(service?.id || '');
  return (id ? money(staff?.servicePay?.[id]) : null) ?? money(service?.providerPay);
}

/** What this person earns for performing this service once. `minutes` = the length it was booked at (defaults to the service's). */
export function payForService(staff: any, service: any, minutes?: number): number {
  const o = payOverride(staff, service); if (o !== null) return Math.round(o * 100) / 100;
  const m = Number(minutes) > 0 ? Number(minutes) : Number(service?.duration) || 60;   // no length saved → 60, as everywhere else
  return Math.round(((money(staff?.serviceHourRate) || 0) * m / 60) * 100) / 100;
}

/** Per service pay over a person's sales (each service line counts, $0 covered visits included). */
export function perServicePay(staff: any, txns: any[], services: any[] | Record<string, any>): { total: number; count: number; lines: { serviceId: string | null; name: string; count: number; pay: number }[] } {
  const byId: Record<string, any> = Array.isArray(services) ? Object.fromEntries(services.filter(Boolean).map((s: any) => [s.id, s])) : (services || {});
  const groups = new Map<string, { serviceId: string | null; name: string; count: number; pay: number }>(); let total = 0, count = 0;
  for (const t of txns || []) {
    if (!isServiceIncome(t) || (staff?.id && t.staffId && t.staffId !== staff.id)) continue;
    const svc = t.serviceId ? byId[t.serviceId] : null;
    const pay = money(t.providerPay) ?? (svc ? payForService(staff, svc, Number(t.serviceMinutes) || undefined) : 0);
    total += pay; count++;
    const k = String(t.serviceId || '-'); const g = groups.get(k) || { serviceId: t.serviceId || null, name: svc?.name || 'Service', count: 0, pay: 0 };
    g.count++; g.pay += pay; groups.set(k, g);
  }
  return { total: Math.round(total * 100) / 100, count, lines: [...groups.values()].map((g) => ({ ...g, pay: Math.round(g.pay * 100) / 100 })).sort((a, b) => b.pay - a.pay) };
}

/** Earnings from services for any pay structure (commission part, per service part). Hours and salary are separate. */
export function serviceEarnings(staff: any, txns: any[], services: any[] | Record<string, any>, fallback = 40): number {
  if (paidPerService(staff)) return perServicePay(staff, txns, services).total;
  if (earnsCommission(staff)) return serviceCommission(staff, txns, services, fallback).total;
  return 0;
}

// ── EXTRAS (tenant.payExtras) ───────────────────────────────────────────────────────────────────────────────────────
//   membershipSale: { mode: 'flat' | 'pct', amount } — to whoever sold a membership or package (`soldBy` on the sale);
//   noShowPct: a share of no-show and late-cancellation fees COLLECTED, to the provider the visit was booked with
//   (people on commission, hourly + commission or per service). `apptStaff` maps appointmentId → that provider.
export function payExtras(staff: any, txns: any[], tenant: any, apptStaff: Record<string, string> = {}): { saleBonus: number; sales: number; noShow: number } {
  const x = tenant?.payExtras || {}; let saleBonus = 0, sales = 0, noShow = 0;
  const ms = x.membershipSale || {}; const amt = money(ms.amount) || 0;
  if (amt > 0 && staff?.id) for (const t of txns || []) {
    if ((t?.type || 'income') !== 'income' || !['Membership Sales', 'Package Sales'].includes(String(t.category)) || t.soldBy !== staff.id) continue;
    const v = amountOf(t); if (v <= 0) continue; sales++; saleBonus += ms.mode === 'pct' ? (v * Math.min(100, amt)) / 100 : amt;
  }
  const share = Math.min(100, money(x.noShowPct) || 0);
  if (share > 0 && staff?.id && (earnsCommission(staff) || paidPerService(staff))) for (const t of txns || []) {
    if ((t?.type || 'income') !== 'income' || !['No-Show Revenue', 'Cancellation Fee', 'Cancellation Fees'].includes(String(t.category))) continue;
    if (['balance_owed', 'pending', 'failed', 'refunded'].includes(String(t.status || ''))) continue;   // only fees actually collected
    const who = t.staffId || (t.appointmentId ? apptStaff[t.appointmentId] : ''); if (who !== staff.id) continue;
    noShow += (amountOf(t) * share) / 100;
  }
  return { saleBonus: Math.round(saleBonus * 100) / 100, sales, noShow: Math.round(noShow * 100) / 100 };
}
