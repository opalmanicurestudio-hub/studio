// src/lib/sales-tax-report.ts — THE SALES TAX REPORT, FOR FILING (pure). What a state's sales tax return asks for, for
// one period (lib/sales-tax-filing), from the books (design board "The sales tax report, for filing"):
//   all sales        — net sales (lib/books-summary: after returns and discounts; sales tax and tips are never sales)
//   sold tax free    — to resellers with a certificate (online wholesale orders)
//   through the apps — sold on a delivery app that collects the tax itself (many returns list these on their own)
//   not taxed        — the rest of what wasn't taxed: services where they aren't taxed, fees, anything rung in untaxed
//   taxable sales    — what the sales tax lines say they were worked out on (each keeps it, with its rate and where it
//                      was sold), less what refunds and voids gave back; a line from before they kept it is worked out
//                      from its tax and the rate it was charged at (its label says it), and a refund from what it gave
//                      back and the rate where it was sold
//   collected, given back on refunds and voids, and to pay — the same figures as the Profit and Loss
// Days are the business's own (its time zone), so an evening sale on the last day of a month is in that month. By
// location: each location's own rate, its taxable sales and its tax to pay (the online shop's own line). Gift cards
// sold aren't sales: they're taxed when they're used.
import { booksSummary, effectOf, lookupOf } from './books-summary';
import { posTaxOf } from './pos-tax';
import { dayKey, tenantTimeZone } from './tenant-time';
import type { TaxPeriod } from './sales-tax-filing';

const n = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const r2 = (v: number) => Math.round(v * 100) / 100;
export const ONLINE = 'online';

export type TaxPlace = { id: string; name: string; address: string | null; rate: string; taxable: number; tax: number };
export type TaxReport = {
  period: TaxPeriod; allSales: number; taxFree: number; viaApps: number; notTaxed: number; taxable: number;
  collected: number; givenBack: number; toPay: number; places: TaxPlace[];
  /** Some figures were worked out from a tax and its rate (lines from before each kept what it was on, and refunds). */
  estimated: boolean;
};

const pctText = (p: number) => `${Math.round(p * 1000) / 1000}%`;
const rateText = (r: { productsPct: number; servicesPct: number }) =>
  !r.servicesPct || r.servicesPct === r.productsPct ? pctText(r.productsPct) : `${pctText(r.productsPct)} on products, ${pctText(r.servicesPct)} on services`;

/** The business's own day for a line: a date with no time is that day; a moment is the day it was where the business is. */
export function lineDay(t: any, tz: string): string {
  const s = String(t?.date || '');
  if (!s.includes('T')) return s.slice(0, 10);
  const d = new Date(s); return Number.isNaN(d.getTime()) ? s.slice(0, 10) : dayKey(d, tz);
}

/** The report for a period from its lines (and a little either side), the business and its locations (several: each
 *  by name). */
export function salesTaxReport(txns: any[], tenant: any, locations: { id: string; name: string; address?: string | null }[], period: TaxPeriod, opts: { lookup?: any[] } = {}): TaxReport {
  const tz = tenantTimeZone(tenant);
  const inPeriod = (txns || []).filter((t) => { const d = lineDay(t, tz); return d >= period.start && d <= period.end; });
  const s = booksSummary(inPeriod, { lookup: opts.lookup, businessOnly: true });
  const byId = lookupOf(opts.lookup, inPeriod);
  const several = locations.length > 1;
  const placeOf = (t: any): string => {
    if (!t) return '';
    if (String(t?.taxLocationId || '') === ONLINE || t?.retailOrderId || t?.taxMode) return ONLINE;
    const at = String(t?.taxLocationId || t?.locationId || '');
    return several && locations.some((l) => l.id === at) ? at : '';
  };
  // The rate a line was charged at: kept on it, else in a tax line's label ("Sales tax (7% ...)"; never another line's,
  // which may say "20% off"), else what's set there now.
  const isTaxLine = (t: any) => String(t?.category || '').toLowerCase() === 'tax collected' || /^sales tax \(/i.test(String(t?.description || ''));
  const rateOf = (t: any, place: string): { pct: number; kept: boolean } => {
    if (t?.taxRates && Number.isFinite(Number(t.taxRates.productsPct)) && Number(t.taxRates.productsPct) > 0) return { pct: n(t.taxRates.productsPct), kept: true };
    const m = isTaxLine(t) ? /(\d+(?:\.\d+)?)\s*%/.exec(String(t?.description || '')) : null;
    if (m && Number(m[1]) > 0 && Number(m[1]) <= 25) return { pct: Number(m[1]), kept: false };
    return { pct: posTaxOf(tenant, place && place !== ONLINE ? place : null).productsPct, kept: false };
  };
  type Acc = { taxable: number; tax: number; rates: Set<string>; stripe: boolean };
  const acc = new Map<string, Acc>(); const accOf = (id: string) => { let a = acc.get(id); if (!a) acc.set(id, (a = { taxable: 0, tax: 0, rates: new Set<string>(), stripe: false })); return a; };
  let estimated = false; let viaApps = 0;
  for (const t of inPeriod) {
    if (String(t?.context || '').toLowerCase() === 'personal') continue;
    const e = effectOf(t, byId);
    // (Sold on a delivery app that collected the tax itself.)
    if (e.side === 'sales' && t?.appKey && !(n(t?.appTaxCents) > 0)) viaApps += e.amount;
    if (e.side === 'tax' && e.amount > 0) {
      const id = placeOf(t); const a = accOf(id);
      a.tax += e.amount;
      const stripe = /^stripe/.test(String(t?.taxMode || ''));
      if (stripe) a.stripe = true;
      const kept = t?.taxRates && Number.isFinite(Number(t.taxRates.productsPct)) ? { productsPct: n(t.taxRates.productsPct), servicesPct: n(t.taxRates.servicesPct) } : null;
      if (kept && !stripe) a.rates.add(rateText(kept));
      if (n(t?.taxedAmount) > 0) a.taxable += n(t.taxedAmount);
      else { const r = rateOf(t, id); if (r.pct > 0) { a.taxable += e.amount / (r.pct / 100); estimated = true; } }
      continue;
    }
    // Tax given back: a void of a tax line (what it was on, in proportion), or a refund's tax (from the rate where it
    // was sold). Each comes off the place it was sold.
    const back = e.side === 'tax' && e.amount < 0 ? -e.amount : e.side === 'returns' ? e.tax : 0;
    if (!back) continue;
    const orig = byId.get(String(t?.reversalOf || t?.voidOf || '')) || null;
    // (Where it was sold: the line it undoes first, then the line itself.)
    const id = (orig ? placeOf(orig) : '') || placeOf(t); const a = accOf(id);
    a.tax -= back;
    if (e.side === 'tax' && orig && n(orig.taxedAmount) > 0 && n(orig.amount) > 0) a.taxable -= n(orig.taxedAmount) * (back / n(orig.amount));
    else { const r = rateOf(e.side === 'tax' && orig ? orig : t, id); if (r.pct > 0) { a.taxable -= back / (r.pct / 100); if (!r.kept) estimated = true; } }
  }
  const nameOf = (id: string) => {
    if (id === ONLINE) return { name: 'Online shop', address: 'Orders from your shop online, shipped or picked up' };
    if (!id && several) return { name: String(tenant?.name || tenant?.businessName || 'Your business'), address: 'Sales with no location on them' };
    const l = locations.find((x) => x.id === id) || (locations.length === 1 ? locations[0] : null);
    return { name: l?.name || String(tenant?.name || tenant?.businessName || 'Your business'), address: l?.address || null };
  };
  const rateLabel = (id: string, a: Acc) => {
    if (a.stripe) return 'Varies';
    if (a.rates.size) return [...a.rates].join(', then ');
    const cur = posTaxOf(tenant, id && id !== ONLINE ? id : null);
    return cur.unset ? 'Not set' : rateText(cur);
  };
  // Each location (with several), sales with no location, and the online shop; every location the business has, so a
  // location that took none says so.
  const ids = [...(several ? locations.map((l) => l.id) : ['']), ...(several && acc.has('') ? [''] : []), ...(acc.has(ONLINE) ? [ONLINE] : [])];
  const places: TaxPlace[] = [...new Set(ids)].map((id) => {
    const a = acc.get(id) || { taxable: 0, tax: 0, rates: new Set<string>(), stripe: false };
    return { id: id || 'business', ...nameOf(id), rate: rateLabel(id, a), taxable: r2(Math.max(0, a.taxable)), tax: r2(a.tax) };
  });
  const taxable = r2(places.reduce((x, p) => x + p.taxable, 0));
  const allSales = r2(s.netSales);
  const taxFree = r2(Math.max(0, s.taxFreeSales));
  const apps = r2(Math.max(0, viaApps));
  return {
    period, allSales, taxFree, viaApps: apps, notTaxed: r2(Math.max(0, allSales - taxFree - apps - taxable)), taxable,
    collected: s.taxCollected, givenBack: s.taxRefunded, toPay: s.taxOwed, places, estimated,
  };
}
