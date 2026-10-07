// src/lib/visit-cost.ts — WHAT A VISIT ACTUALLY COST (O9), from what really happened rather than the plan:
//   time     — the minutes it actually took (start → finished), not the booked length;
//   labour   — commission on what was charged, or hourly pay for the provider's hands-on minutes (processing time the
//              provider wasn't needed for isn't charged to this visit — they were free to earn elsewhere);
//   overhead — the business's hourly running cost (TMHR) for as long as the station was tied up (set-up + visit + turnover);
//   products — the amounts actually recorded as used (falling back to the formula, then the service's standard amounts);
//   linens & kits — a per-use handling cost the business sets (laundering one linen, cleaning one kit).
// Every expense lands in exactly one of those buckets, so nothing is counted twice. Pure functions — the report and the
// visit screen both use them.
import { deriveTimings, phasesFromService } from '@/lib/blueprint';
import { linensForVisit } from '@/lib/linens';
import { kitsNeeded } from '@/lib/kits';

export interface VisitCost { revenue: number; labor: number; overhead: number; materials: number; handling: number; total: number; profit: number; marginPct: number | null;
  bookedMin: number; actualMin: number; timed: boolean; materialsBasis: 'actual' | 'formula' | 'standard' | 'none'; maxDiscountPct: number }
const n = (v: any) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const ms = (v: any): number => { if (!v) return 0; if (typeof v === 'string') return Date.parse(v) || 0; if (v?.seconds) return v.seconds * 1000; if (v?.toDate) return v.toDate().getTime(); if (v instanceof Date) return v.getTime(); return Number(v) || 0; };
const r2 = (x: number) => Math.round(x * 100) / 100;
/** Cost of one unit of how the product is counted (one use, one ml, one piece). */
export function unitCost(item: any): number { let c = n(item?.costPerUnit); if (item?.costingMethod === 'size' && n(item.size) > 0) c /= n(item.size); else if (item?.costingMethod === 'uses' && n(item.estimatedUses) > 0) c /= n(item.estimatedUses); return c; }
/** When hands-on work ended: the "ready to pay" moment if recorded, else the recorded end. (Paying later doesn't lengthen it.) */
export function workEndedMs(visit: any): number { const tl = Array.isArray(visit?.timeline) ? visit.timeline : [];
  for (const e of tl) if (e?.kind === 'stage' && e.stage === 'ready_to_pay' && ms(e.at)) return ms(e.at);
  return ms(visit?.readyForCheckoutAt) || ms(visit?.actualEndTime) || ms(visit?.completedAt) || 0; }

export function actualVisitCost(input: { visit: any; service: any; addOns?: any[]; staffMember?: any; inventory?: any[]; usage?: any | null; tmhr?: number; opsCosts?: { linenEach?: number; kitEach?: number; minMarginPct?: number } }): VisitCost {
  const { visit, service } = input; const addOns = input.addOns || []; const inv = input.inventory || []; const tmhr = n(input.tmhr); const oc = input.opsCosts || {};
  const phases = Array.isArray(service?.blueprint?.phases) && service.blueprint.phases.length ? service.blueprint.phases : phasesFromService(service);
  const t = deriveTimings(phases);
  const bookedMin = n(t.duration) + addOns.reduce((a, s) => a + n(s?.duration), 0) + Math.max(0, n(visit?.clientExtraMinutes));
  const start = ms(visit?.actualStartTime), end = workEndedMs(visit); const raw = start && end > start ? (end - start) / 60000 : 0;
  const timed = raw >= 5 && raw <= 720; const actualMin = timed ? Math.round(raw) : bookedMin;
  const revenue = n(visit?.revenue ?? visit?.price ?? service?.price);
  // Labour
  const s = input.staffMember; let labor = 0;
  if (s?.payStructure === 'commission') labor = revenue * (n(s.commissionRate) || 40) / 100;
  else if (s?.payStructure === 'hourly' && n(s.hourlyRate) > 0) { const free = Math.min(n(t.providerFreeMinutes), actualMin); labor = ((actualMin - free + n(t.padBefore)) / 60) * n(s.hourlyRate); }
  // Overhead: the station is tied up for set-up + the visit + turnover.
  const overhead = ((actualMin + n(t.padBefore) + n(t.padAfter)) / 60) * tmhr;
  // Products
  let materials = 0; let materialsBasis: VisitCost['materialsBasis'] = 'none';
  const lines: any[] = Array.isArray(input.usage?.lines) ? input.usage.lines : [];
  if (lines.length) { materialsBasis = 'actual'; for (const l of lines) materials += n(l.actual ?? l.deducted ?? l.expected) * unitCost(inv.find((i: any) => i.id === l.productId)); }
  else if (visit?.checkoutState?.formula?.length) { materialsBasis = 'formula'; for (const f of visit.checkoutState.formula) materials += n(f.quantity) * n(f.costPerUnit); }
  else { for (const sv of [service, ...addOns]) for (const p of sv?.products || []) { const it = inv.find((i: any) => i.id === p.id); if (!it) continue; materials += (n(p.quantityUsed) || 1) * unitCost(it); materialsBasis = 'standard'; } }
  // Linens and kits: a handling cost per use.
  const linenN = linensForVisit(visit, [service, ...addOns].filter(Boolean)).reduce((a, x) => a + x.qty, 0);
  const kitN = [service, ...addOns].reduce((a, sv) => a + kitsNeeded(sv).reduce((b, k) => b + k.qty, 0), 0);
  const handling = linenN * Math.max(0, n(oc.linenEach)) + kitN * Math.max(0, n(oc.kitEach));
  const total = r2(labor + overhead + materials + handling); const profit = r2(revenue - total);
  // The biggest discount that still leaves the margin the business wants (commission shrinks with the price, so it's left out of the fixed part).
  const floor = Math.max(0, Math.min(0.9, n(oc.minMarginPct) / 100)); const commission = s?.payStructure === 'commission' ? (n(s.commissionRate) || 40) / 100 : 0;
  const fixed = total - (commission ? labor : 0); const keep = 1 - commission - floor;
  const lowest = keep > 0 ? fixed / keep : Infinity; const maxDiscountPct = revenue > 0 && lowest < revenue ? Math.floor(((revenue - lowest) / revenue) * 100) : 0;
  return { revenue: r2(revenue), labor: r2(labor), overhead: r2(overhead), materials: r2(materials), handling: r2(handling), total, profit, marginPct: revenue > 0 ? Math.round((profit / revenue) * 1000) / 10 : null,
    bookedMin: Math.round(bookedMin), actualMin, timed, materialsBasis, maxDiscountPct };
}
export interface ProfitRow { key: string; name: string; visits: number; revenue: number; cost: number; profit: number; marginPct: number | null; bookedMin: number; actualMin: number; timedVisits: number; overMin: number; maxDiscountPct: number }
/** Add visits up by service, provider or station. `overMin` = average minutes over the booked time (timed visits only). */
export function rollupProfit(rows: { key: string; name: string; cost: VisitCost }[]): ProfitRow[] {
  const m = new Map<string, any>();
  for (const r of rows) { const x = m.get(r.key) || { key: r.key, name: r.name, visits: 0, revenue: 0, cost: 0, profit: 0, bookedMin: 0, actualMin: 0, timedVisits: 0, over: 0, disc: [] as number[] };
    x.visits++; x.revenue += r.cost.revenue; x.cost += r.cost.total; x.profit += r.cost.profit; x.bookedMin += r.cost.bookedMin; x.actualMin += r.cost.actualMin; if (r.cost.timed) { x.timedVisits++; x.over += r.cost.actualMin - r.cost.bookedMin; } x.disc.push(r.cost.maxDiscountPct); m.set(r.key, x); }
  return [...m.values()].map((x) => ({ key: x.key, name: x.name, visits: x.visits, revenue: r2(x.revenue), cost: r2(x.cost), profit: r2(x.profit), marginPct: x.revenue > 0 ? Math.round((x.profit / x.revenue) * 1000) / 10 : null, bookedMin: x.bookedMin, actualMin: x.actualMin, timedVisits: x.timedVisits,
    overMin: x.timedVisits ? Math.round(x.over / x.timedVisits) : 0, maxDiscountPct: Math.min(...x.disc) })).sort((a, b) => a.profit - b.profit);
}
