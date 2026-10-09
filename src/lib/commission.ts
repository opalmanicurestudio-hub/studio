// src/lib/commission.ts — COMMISSION PER SERVICE, worked out the same way on every screen (payroll, Payday, reports,
// the staff profile, the staff portal, service costing).
//
// Which rate a service line earns, first match wins:
//   1. the rate stamped on the sale at checkout (`commissionPct`) — so changing a rate later never rewrites past pay;
//   2. this person's own rate for this service (`staff.serviceCommission[serviceId]`, e.g. Jo earns 50% on extensions);
//   3. the service's rate for everyone (`service.commissionRate`, e.g. 30% on waxing);
//   4. the person's usual rate (`staff.commissionRate`).
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
    const c = (amt * rate) / 100; total += c; revenue += amt;
    const key = `${t.serviceId || '-'}|${rate}`; const g = groups.get(key) || { serviceId: t.serviceId || null, name: svc?.name || (t.serviceId ? 'Service' : 'Services'), revenue: 0, rate, commission: 0 };
    g.revenue += amt; g.commission += c; groups.set(key, g);
  }
  const lines = [...groups.values()].map((g) => ({ ...g, revenue: Math.round(g.revenue * 100) / 100, commission: Math.round(g.commission * 100) / 100 })).sort((a, b) => b.commission - a.commission);
  return { total, revenue, lines };
}

/** What to stamp on a service sale at checkout: the service, and the rate when an override applies (else nothing — the usual rate). */
export function saleStamp(staff: any, service: any): { serviceId?: string; commissionPct?: number } {
  const out: { serviceId?: string; commissionPct?: number } = {};
  if (service?.id) out.serviceId = String(service.id);
  const o = earnsCommission(staff) ? overrideRate(staff, service) : null; if (o !== null) out.commissionPct = o;
  return out;
}
