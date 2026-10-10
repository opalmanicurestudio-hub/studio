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
//
// What the rate is paid ON (the "base"), all stamped on the sale at checkout:
//   • the price charged — or, when the business pays commission on what the client actually paid, the price after
//     discounts (`commissionBase`); a membership / package visit counts at the normal price (`commissionBase`);
//   • less a product charge (`productCharge`) when the business takes one before commission ($5 a service, or 10%);
//   • a shared service (`splitWith: { staffId, pct }`) gives the assistant `pct` of the base and the provider the rest.
// A refund that takes commission back carries `payReversal` on the refund line (lib/commission → payReversals).
// Sales tiers (`staff.commissionTiers`, e.g. 45% once the period's services pass $3,000) add the difference on the part
// above each level — see tierBonus.

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

/** The share of a sale's credit that belongs to this person (a shared service splits it; everyone else gets it all). */
export function splitShare(t: any, staffId?: string): number {
  const p = Number(t?.splitWith?.pct); if (!t?.splitWith?.staffId || !(p > 0 && p < 100)) return 1;
  return t.splitWith.staffId === staffId ? p / 100 : 1 - p / 100;
}

/** What to take back from someone's pay for refunds in a period (refund lines carry `payReversals: [{ staffId, amount }]`). */
export function payReversals(staff: any, txns: any[]): { total: number; count: number } {
  let total = 0, count = 0;
  for (const t of txns || []) {
    const list = [...(Array.isArray(t?.payReversals) ? t.payReversals : []), ...(t?.payReversal ? [t.payReversal] : [])];
    for (const r of list) { if (r?.staffId !== staff?.id) continue; const v = Number(r.amount) || 0; if (v > 0) { total += v; count++; } }
  }
  return { total: Math.round(total * 100) / 100, count };
}

/**
 * Sales tiers: `staff.commissionTiers = [{ over: 3000, rate: 45 }, …]` — once a period's commission base (at their usual
 * rate) passes `over`, the part above earns `rate` instead. Returns the extra on top of the usual commission.
 */
export function tierBonus(staff: any, txns: any[], services: any[] | Record<string, any>, fallback = 40): number {
  const tiers = (Array.isArray(staff?.commissionTiers) ? staff.commissionTiers : []).map((x: any) => ({ over: Number(x?.over) || 0, rate: pct(x?.rate) })).filter((x: any) => x.over > 0 && x.rate !== null).sort((a: any, b: any) => a.over - b.over);
  if (!tiers.length || !earnsCommission(staff)) return 0;
  const usual = usualRate(staff, fallback); const byId: Record<string, any> = Array.isArray(services) ? Object.fromEntries(services.filter(Boolean).map((s: any) => [s.id, s])) : (services || {});
  let base = 0;   // only sales earned at the usual rate count (a special rate for a service stays as it is)
  for (const t of txns || []) {
    if (!isServiceIncome(t) || t.staffId !== staff.id) continue;
    const r = pct(t.commissionPct) ?? rateFor(staff, byId[t.serviceId] || { id: t.serviceId }, fallback); if (r !== usual) continue;
    base += Math.max(0, (t.commissionBase != null ? Number(t.commissionBase) : amountOf(t)) - (Number(t.productCharge) || 0)) * splitShare(t, staff.id);
  }
  let extra = 0;
  tiers.forEach((tier: any, i: number) => { const top = i + 1 < tiers.length ? tiers[i + 1].over : Infinity; const inBand = Math.max(0, Math.min(base, top) - tier.over); extra += inBand * ((tier.rate as number) - usual) / 100; });
  return Math.round(Math.max(0, extra) * 100) / 100;
}

export const isServiceIncome = (t: any) => (t?.type || 'income') === 'income' && t?.category === 'Service Revenue';
const amountOf = (t: any) => (typeof t?.amount === 'number' ? t.amount : (Number(t?.amountCents) || 0) / 100);

export type CommissionLine = { serviceId: string | null; name: string; revenue: number; rate: number; commission: number; count?: number; base?: number; covered?: number };

/**
 * Commission on a person's service sales. `txns` may include other people's and other categories — only this person's
 * service income counts. `services` is the service list (or a map by id). Returns the total and a per-service breakdown.
 */
export function serviceCommission(staff: any, txns: any[], services: any[] | Record<string, any>, fallback = 40): { total: number; revenue: number; lines: CommissionLine[] } {
  const byId: Record<string, any> = Array.isArray(services) ? Object.fromEntries(services.filter(Boolean).map((s: any) => [s.id, s])) : (services || {});
  const groups = new Map<string, CommissionLine>(); let total = 0, revenue = 0;
  for (const t of txns || []) {
    if (!isServiceIncome(t)) continue;
    const assisting = !!(staff?.id && t.splitWith?.staffId === staff.id && t.staffId !== staff.id);
    if (staff?.id && t.staffId && t.staffId !== staff.id && !assisting) continue;
    const amt = amountOf(t); const svc = t.serviceId ? byId[t.serviceId] : null;
    // The assistant earns at their own rate for the service; the provider at the rate stamped on the sale.
    const rate = assisting ? rateFor(staff, svc || { id: t.serviceId }, fallback) : (pct(t.commissionPct) ?? rateFor(staff, svc || { id: t.serviceId }, fallback));
    const share = splitShare(t, staff?.id);
    const base = Math.max(0, (t.commissionBase != null && Number.isFinite(Number(t.commissionBase)) ? Number(t.commissionBase) : amt) - (Number(t.productCharge) || 0)) * share;
    const c = (base * rate) / 100; total += c; revenue += amt * share;
    const key = `${t.serviceId || '-'}|${rate}`; const g = groups.get(key) || { serviceId: t.serviceId || null, name: svc?.name || (t.serviceId ? 'Service' : 'Services'), revenue: 0, rate, commission: 0, count: 0, base: 0, covered: 0 };
    g.revenue += amt * share; g.commission += c; if (assisting) g.name = `${g.name.replace(/ \(assisting\)$/, '')} (assisting)`; g.count = (g.count || 0) + 1; g.base = (g.base || 0) + base; if (t.commissionBase != null && amt === 0) g.covered = (g.covered || 0) + 1; groups.set(key, g);
  }
  const lines = [...groups.values()].map((g) => ({ ...g, revenue: Math.round(g.revenue * 100) / 100, base: Math.round((g.base || 0) * 100) / 100, commission: Math.round(g.commission * 100) / 100 })).sort((a, b) => b.commission - a.commission);
  return { total, revenue, lines };
}

/** What to stamp on a service sale at checkout: the service, the commission rate it earned, the provider's per service pay. */
export function saleStamp(staff: any, service: any, opts: { minutes?: number; coveredAt?: number | null; price?: number; tenant?: any; discountShare?: number } = {}): { serviceId?: string; commissionPct?: number; commissionBase?: number; providerPay?: number; productCharge?: number } {
  const out: { serviceId?: string; commissionPct?: number; commissionBase?: number; providerPay?: number; productCharge?: number } = {};
  if (service?.id) out.serviceId = String(service.id);
  // Every commission sale carries the rate it earned — a raise or a new rate later never re-prices sales already made.
  if (earnsCommission(staff)) out.commissionPct = overrideRate(staff, service) ?? usualRate(staff, 40);
  if (opts.coveredAt != null && Number(opts.coveredAt) > 0) out.commissionBase = Math.round(Number(opts.coveredAt) * 100) / 100;
  else if (earnsCommission(staff) && opts.tenant?.payRules?.commissionOn === 'paid' && Number(opts.discountShare) > 0 && Number(opts.price) > 0)
    out.commissionBase = Math.round(Number(opts.price) * (1 - Math.min(1, Number(opts.discountShare))) * 100) / 100;   // commission on what the client actually paid
  if (earnsCommission(staff)) { const pc = productChargeFor(service, opts.tenant, opts.coveredAt != null && Number(opts.coveredAt) > 0 ? Number(opts.coveredAt) : Number(opts.price) || 0); if (pc > 0) out.productCharge = pc; }
  if (paidPerService(staff)) out.providerPay = payForService(staff, service, opts.minutes);
  return out;
}

/** The product charge taken before commission: the service's own amount, else the business's rule ($ each or % of the price). */
export function productChargeFor(service: any, tenant: any, price: number): number {
  const own = Number(service?.productCharge); if (service?.productCharge !== '' && service?.productCharge != null && Number.isFinite(own) && own >= 0) return Math.round(Math.min(own, price || own) * 100) / 100;
  const r = tenant?.payRules?.productCharge || {}; const v = Number(r.amount) || 0; if (!(v > 0)) return 0;
  const c = r.mode === 'pct' ? (price * Math.min(100, v)) / 100 : v; return Math.round(Math.min(c, Math.max(0, price)) * 100) / 100;
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

/**
 * When a service sale is refunded: what each person's pay gives back, in proportion to how much of it was refunded —
 * the provider's commission (or per service pay) and an assistant's share. Empty when the business lets them keep it.
 */
export function reversalsFor(sale: any, refunded: number, staffList: any[], services: any[]): { staffId: string; amount: number }[] {
  const amt = amountOf(sale); const frac = amt > 0 ? Math.min(1, Math.max(0, refunded / amt)) : 0; if (!(frac > 0)) return [];
  const out: { staffId: string; amount: number }[] = [];
  for (const id of [sale?.staffId, sale?.splitWith?.staffId].filter(Boolean)) {
    const m = (staffList || []).find((s: any) => s.id === id); if (!m) continue;
    const pay = earnsCommission(m) ? serviceCommission(m, [sale], services, 40).total : paidPerService(m) && id === sale.staffId ? perServicePay(m, [sale], services).total : 0;
    const v = Math.round(pay * frac * 100) / 100; if (v > 0) out.push({ staffId: id, amount: v });
  }
  return out;
}
