// src/lib/no-show-fee.ts — WHAT A NO-SHOW COSTS, by the business's choice (Settings → Booking policies → No-show):
// the full service price (with add-ons), a set amount, the business's real costs for that time ("Your costs": the
// house's hourly overhead for the minutes, the products the service uses, and the provider's pay with employer
// taxes), or nothing. One function for the desk's dialog and the provider's "Confirm no-show" button, so the two can
// never charge different amounts.
import { rateFor } from '@/lib/commission';

export type FeeService = { id: string; price?: number; duration?: number; products?: { id: string; quantityUsed?: number }[]; serviceTiers?: { tierId: string; price: number }[] };
export function costOf(services: FeeService[], o: { tenant: any; inventory?: any[]; staff?: any | null }): number {
  const tmhr = Number(o.tenant?.tmhr) || 50; const burden = Number(o.tenant?.employerTaxBurdenPct) || 10; const inv = o.inventory || []; const pro = o.staff || null;
  return services.reduce((sum, s) => {
    const minutes = Number(s.duration) || 60; const overhead = (minutes / 60) * tmhr;
    const materials = (s.products || []).reduce((acc, p) => { const it = inv.find((i: any) => i.id === p.id); if (!it) return acc;
      const cpu = it.costingMethod === 'size' && it.size ? (it.costPerUnit || 0) / it.size : it.costingMethod === 'uses' && it.estimatedUses ? (it.costPerUnit || 0) / it.estimatedUses : it.costPerUnit || 0;
      return acc + cpu * (p.quantityUsed || 1); }, 0);
    const price = Number(s.serviceTiers?.find((t) => t.tierId === pro?.pricingTierId)?.price ?? s.price) || 0;
    const labor = pro?.payStructure === 'hourly' && pro.hourlyRate ? (minutes / 60) * pro.hourlyRate : price * (rateFor(pro, s, 40) / 100);
    return sum + overhead + materials + labor * (1 + burden / 100);
  }, 0);
}
export function noShowFee(services: FeeService[], o: { tenant: any; inventory?: any[]; staff?: any | null }): number {
  const mode = String(o.tenant?.noShowFeeMode || 'full_service');
  if (mode === 'none') return 0;
  if (mode === 'flat') return Number(o.tenant?.flatNoShowFee) || 0;
  if (mode === 'matrix') return Math.round(costOf(services, o) * 100) / 100;
  return services.reduce((t, s) => t + (Number(s.price) || 0), 0);
}
