// src/lib/checkout-calc.ts — ONE CHECKOUT CALCULATION, used by the screen AND the server (pure).
// The screen shows these numbers; the server saves these numbers — so they can never disagree.
// Same rules as the POS has always used, with two corrections:
//   • fees are never taxed (unpaid fees, and the reschedule fee on the visit)
//   • only real products are taxed as products (memberships, packages, deposits and rentals aren't)
import { groupDiscountFor, groupDiscountAmount } from '@/lib/team-discount';
import { getServicePrice } from '@/lib/data';
import { posTaxAmount, posTaxLabel } from '@/lib/pos-tax';

const num = (v: any) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const round2 = (n: number) => Math.round(n * 100) / 100;

export interface CalcVisit { appointment: any; service: any; addOnServices: any[] }
export interface CalcItem { id: string; type: string; quantity: number; price: number; name?: string }
export interface CalcInput {
  tenant: any; visits: CalcVisit[]; staff: any[]; redeemedOffer: { type: string; id: string; itemId?: string } | null; waivedIds: string[];
  items: CalcItem[]; fees: { feeId: string; feeAmount: number }[]; discounts: any[]; client: any | null; memberships: any[];
  tip: number; storeCredit: number;
  staffDiscount?: { kind: 'pct' | 'amt'; value: number } | null;   // a staff discount — never a price change
  skipGroupDiscount?: boolean;   // "don't apply the team / family discount this time"
  momentReward?: { pct: number; label: string; key: string } | null;   // birthday / milestone treat (lib/moments)
}
export interface VisitCalc { appointmentId: string; mainStaffId: string; mainPrice: number; mainRedeemed: boolean; addOns: { addon: any; staffId: string; price: number; redeemed: boolean }[];
  rescheduleFee: number; timeOverage: number; materialOverage: number; additionalCharge: number; refreshments: { name: string; qty: number; price: number }[]; waived: boolean }

export function computeCheckout(i: CalcInput) {
  const staffById = (id: string) => (i.staff || []).find((s: any) => s.id === id);
  const visits: VisitCalc[] = [];
  let servicesSub = 0, taxableServices = 0;
  for (const v of i.visits) {
    const a = v.appointment || {}; const cs = a.checkoutState || {}; const overrides = cs.serviceStaffOverrides || {};
    const mainStaffId = overrides[v.service?.id] || a.staffId;
    const mainRedeemed = i.redeemedOffer?.itemId === v.service?.id;
    const mainPrice = mainRedeemed ? 0 : num(getServicePrice(v.service, staffById(mainStaffId)));
    const addOns = (v.addOnServices || []).map((ad: any) => { const sid = overrides[ad.id] || a.staffId; const redeemed = i.redeemedOffer?.itemId === ad.id; return { addon: ad, staffId: sid, redeemed, price: redeemed ? 0 : num(getServicePrice(ad, staffById(sid))) }; });
    const waived = (i.waivedIds || []).includes(a.id);
    const adj = cs.adjustments;
    const rescheduleFee = !waived && adj ? num(adj.rescheduleFee) : 0, timeOverage = !waived && adj ? num(adj.timeOverage) : 0, materialOverage = !waived && adj ? num(adj.materialOverage) : 0;
    const additionalCharge = !waived && !adj ? num(cs.additionalCharge) : 0;
    const refreshments = (cs.refreshments || []).map((r: any) => ({ name: String(r.name || 'Refreshment'), qty: num(r.quantity || 1), price: num(r.price) }));
    const refreshSum = refreshments.reduce((s: number, r: any) => s + r.price * r.qty, 0);
    const addOnSum = addOns.reduce((s: number, x: any) => s + x.price, 0);
    servicesSub += mainPrice + addOnSum + rescheduleFee + timeOverage + materialOverage + additionalCharge + refreshSum;
    taxableServices += mainPrice + addOnSum + timeOverage + materialOverage + additionalCharge + refreshSum;   // not the reschedule fee
    visits.push({ appointmentId: a.id, mainStaffId, mainPrice, mainRedeemed, addOns, rescheduleFee, timeOverage, materialOverage, additionalCharge, refreshments, waived });
  }
  const retailSub = (i.items || []).reduce((s, it) => s + num(it.price) * num(it.quantity), 0);
  const taxableProducts = (i.items || []).filter((it) => it.type === 'product').reduce((s, it) => s + num(it.price) * num(it.quantity), 0);
  taxableServices += (i.items || []).filter((it) => it.type === 'service').reduce((s, it) => s + num(it.price) * num(it.quantity), 0);
  const feeSub = (i.fees || []).reduce((s, f) => s + num(f.feeAmount), 0);
  const subtotal = round2(servicesSub + retailSub + feeSub);
  let codeDiscount = round2((i.discounts || []).reduce((s, d: any) => s + (d.type === 'percentage' ? subtotal * (num(d.value) / 100) : num(d.value)), 0));
  // Team / family & friends: services (not fees) and real products only; within the monthly cap; by default it
  // doesn't combine with codes — whichever is bigger applies.
  const group = i.skipGroupDiscount ? null : groupDiscountFor(i.tenant, i.client);
  const eligibleServices = visits.reduce((s, v) => s + v.mainPrice + v.addOns.reduce((a, x) => a + x.price, 0), 0) + (i.items || []).filter((it) => it.type === 'service').reduce((s, it) => s + num(it.price) * num(it.quantity), 0);
  let groupDiscount = groupDiscountAmount(group, { services: eligibleServices, products: taxableProducts });
  if (group && groupDiscount > 0 && codeDiscount > 0 && !group.stackWithCodes) { if (groupDiscount >= codeDiscount) codeDiscount = 0; else groupDiscount = 0; }
  const sd = i.staffDiscount; const staffDiscount = sd ? round2(Math.min(subtotal, sd.kind === 'pct' ? subtotal * (num(sd.value) / 100) : num(sd.value))) : 0;
  // A birthday / milestone treat (% off services) never combines — it applies only if it's bigger than the code + team discount.
  let momentDiscount = i.momentReward && i.momentReward.pct > 0 ? round2(eligibleServices * (i.momentReward.pct / 100)) : 0;
  if (momentDiscount > 0) { if (momentDiscount > codeDiscount + groupDiscount) { codeDiscount = 0; groupDiscount = 0; } else momentDiscount = 0; }
  const discount = round2(codeDiscount + staffDiscount + groupDiscount + momentDiscount);
  // A member's retail discount (their plan's %, on eligible items).
  let memberDiscount = 0;
  const c = i.client; const mId = c?.activeMembershipId || c?.subscription?.membershipId;
  if (mId && !(c?.subscription?.status && c.subscription.status !== 'active')) {
    const m = (i.memberships || []).find((x: any) => x.id === mId);
    const pct = num(m?.retailDiscount); const eligible: string[] = m?.applicableProductIds || [];
    if (pct > 0) memberDiscount = round2((i.items || []).reduce((s, it) => (eligible.length === 0 || eligible.includes(it.id) ? s + num(it.price) * num(it.quantity) * (pct / 100) : s), 0));
  }
  const tax = posTaxAmount(i.tenant, { services: taxableServices, products: taxableProducts });
  const tip = round2(num(i.tip)); const storeCredit = round2(num(i.storeCredit));
  const total = round2(Math.max(0, subtotal + tax + tip - discount - memberDiscount - storeCredit));
  return { visits, servicesSub: round2(servicesSub), retailSub: round2(retailSub), feeSub: round2(feeSub), subtotal, discount, codeDiscount, staffDiscount, groupDiscount, momentDiscount, moment: momentDiscount > 0 && i.momentReward ? i.momentReward : null, group: group && groupDiscount > 0 ? { type: group.type, label: group.label, staffId: group.staffId } : null, memberDiscount, tax, taxLabel: posTaxLabel(i.tenant), tip, storeCredit, total };
}
