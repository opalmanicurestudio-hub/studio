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
  skipMemberDiscount?: boolean;  // "don't apply their member discount this time"
  momentReward?: { pct: number; label: string; key: string } | null;   // birthday / milestone treat (lib/moments)
}
export interface VisitCalc { appointmentId: string; mainStaffId: string; mainPrice: number; mainRedeemed: boolean; mainList: number; addOns: { addon: any; staffId: string; price: number; redeemed: boolean; list: number }[];
  rescheduleFee: number; timeOverage: number; materialOverage: number; additionalCharge: number; refreshments: { name: string; qty: number; price: number }[]; waived: boolean;
  /** A renter's visit: THEIR sale — their price, no studio tax, no studio discounts (the desk only collects it). */
  renter: boolean; renterStaffId: string | null }

export function computeCheckout(i: CalcInput) {
  const staffById = (id: string) => (i.staff || []).find((s: any) => s.id === id);
  const visits: VisitCalc[] = [];
  let servicesSub = 0, taxableServices = 0, renterSub = 0;
  for (const v of i.visits) {
    const a = v.appointment || {}; const cs = a.checkoutState || {}; const overrides = cs.serviceStaffOverrides || {};
    const mainStaffId = overrides[v.service?.id] || a.staffId;
    const mainRedeemed = i.redeemedOffer?.itemId === v.service?.id;
    // A renter's visit is theirs: priced at THEIR price (the studio's service price can differ).
    const renterStaff = a.isRenterBooking === true ? staffById(a.renterProviderId || mainStaffId) : staffById(mainStaffId)?.isRenter === true ? staffById(mainStaffId) : null;
    const renter = !!renterStaff || a.isRenterBooking === true;
    // A member price, when the client has an active membership and the service has one (never for a renter's service).
    const isMember = !!(i.client?.activeMembershipId || i.client?.subscription?.membershipId);
    const listPrice = num(getServicePrice(v.service, staffById(mainStaffId)));
    const mainPrice = mainRedeemed ? 0 : renter && a.renterServicePrice != null ? num(a.renterServicePrice) : isMember && num(v.service?.memberPrice) > 0 ? Math.min(listPrice, num(v.service.memberPrice)) : listPrice;
    const addOns = (v.addOnServices || []).map((ad: any) => { const sid = overrides[ad.id] || a.staffId; const redeemed = i.redeemedOffer?.itemId === ad.id; const list = num(getServicePrice(ad, staffById(sid))); return { addon: ad, staffId: sid, redeemed, list, price: redeemed ? 0 : list }; });
    const waived = (i.waivedIds || []).includes(a.id);
    const adj = cs.adjustments;
    const rescheduleFee = !waived && adj ? num(adj.rescheduleFee) : 0, timeOverage = !waived && adj ? num(adj.timeOverage) : 0, materialOverage = !waived && adj ? num(adj.materialOverage) : 0;
    const additionalCharge = !waived && !adj ? num(cs.additionalCharge) : 0;
    const refreshments = (cs.refreshments || []).map((r: any) => ({ name: String(r.name || 'Refreshment'), qty: num(r.quantity || 1), price: num(r.price) }));
    const refreshSum = refreshments.reduce((s: number, r: any) => s + r.price * r.qty, 0);
    const addOnSum = addOns.reduce((s: number, x: any) => s + x.price, 0);
    servicesSub += mainPrice + addOnSum + rescheduleFee + timeOverage + materialOverage + additionalCharge + refreshSum;
    if (renter) renterSub += mainPrice + addOnSum;   // their sale: no studio tax, no studio discounts
    // Tax: a service (or add-on) marked "not taxed" stays out of the taxable total; extra time / product follow the main service.
    const taxedMain = renter || v.service?.taxExempt === true ? 0 : mainPrice;
    const taxedAddOns = renter ? 0 : addOns.reduce((s: number, x: any) => s + (x.addon?.taxExempt === true ? 0 : x.price), 0);
    taxableServices += taxedMain + taxedAddOns + (v.service?.taxExempt === true ? 0 : timeOverage + materialOverage) + additionalCharge + refreshSum;   // not the reschedule fee
    visits.push({ appointmentId: a.id, mainStaffId, mainPrice, mainRedeemed, mainList: listPrice, addOns, rescheduleFee, timeOverage, materialOverage, additionalCharge, refreshments, waived, renter, renterStaffId: renter ? (renterStaff?.id || a.renterProviderId || mainStaffId) : null });
  }
  const retailSub = (i.items || []).reduce((s, it) => s + num(it.price) * num(it.quantity), 0);
  const taxableProducts = (i.items || []).filter((it) => it.type === 'product').reduce((s, it) => s + num(it.price) * num(it.quantity), 0);
  taxableServices += (i.items || []).filter((it) => it.type === 'service').reduce((s, it) => s + num(it.price) * num(it.quantity), 0);
  const feeSub = (i.fees || []).reduce((s, f) => s + num(f.feeAmount), 0);
  const subtotal = round2(servicesSub + retailSub + feeSub);
  // Rent and tuition are account payments: no discount code, staff or member discount reduces them.
  const accountSub = (i.items || []).filter((it) => it.type === 'rent' || it.type === 'tuition').reduce((s, it) => s + num(it.price) * num(it.quantity), 0);
  const discountable = round2(Math.max(0, subtotal - accountSub - renterSub));   // studio discounts never cut a renter's price
  let codeDiscount = round2((i.discounts || []).reduce((s, d: any) => s + (d.type === 'percentage' ? discountable * (num(d.value) / 100) : Math.min(num(d.value), discountable)), 0));
  // Team / family & friends: services (not fees) and real products only; within the monthly cap; by default it
  // doesn't combine with codes — whichever is bigger applies.
  const group = i.skipGroupDiscount ? null : groupDiscountFor(i.tenant, i.client);
  const eligibleServices = visits.filter((v) => !v.renter).reduce((s, v) => s + v.mainPrice + v.addOns.reduce((a, x) => a + x.price, 0), 0) + (i.items || []).filter((it) => it.type === 'service').reduce((s, it) => s + num(it.price) * num(it.quantity), 0);
  let groupDiscount = groupDiscountAmount(group, { services: eligibleServices, products: taxableProducts });
  if (group && groupDiscount > 0 && codeDiscount > 0 && !group.stackWithCodes) { if (groupDiscount >= codeDiscount) codeDiscount = 0; else groupDiscount = 0; }
  const sd = i.staffDiscount; const staffDiscount = sd ? round2(Math.min(discountable, sd.kind === 'pct' ? discountable * (num(sd.value) / 100) : num(sd.value))) : 0;
  // A birthday / milestone treat (% off services) never combines — it applies only if it's bigger than the code + team discount.
  let momentDiscount = i.momentReward && i.momentReward.pct > 0 ? round2(eligibleServices * (i.momentReward.pct / 100)) : 0;
  if (momentDiscount > 0) { if (momentDiscount > codeDiscount + groupDiscount) { codeDiscount = 0; groupDiscount = 0; } else momentDiscount = 0; }
  const discount = round2(codeDiscount + staffDiscount + groupDiscount + momentDiscount);
  // A member's retail discount (their plan's %, on eligible items).
  let memberDiscount = 0;
  const c = i.client; const mId = c?.activeMembershipId || c?.subscription?.membershipId; let memberLabel: string | null = null;
  if (mId && !(c?.subscription?.status && c.subscription.status !== 'active')) {
    const m = (i.memberships || []).find((x: any) => x.id === mId);
    const pct = num(m?.retailDiscount); const eligible: string[] = m?.applicableProductIds || []; if (pct > 0) memberLabel = `${m?.name || 'Member'} discount (${pct}%)`;
    // A member's RETAIL discount: real products only (never deposits, rent, tuition, memberships or packages).
    if (pct > 0 && !i.skipMemberDiscount) memberDiscount = round2((i.items || []).reduce((s, it) => (it.type === 'product' && (eligible.length === 0 || eligible.includes(it.id)) ? s + num(it.price) * num(it.quantity) * (pct / 100) : s), 0));
  }
  const tax = posTaxAmount(i.tenant, { services: taxableServices, products: taxableProducts });
  const tip = round2(num(i.tip)); const storeCredit = round2(num(i.storeCredit));
  const total = round2(Math.max(0, subtotal + tax + tip - discount - memberDiscount - storeCredit));
  // The share of the discountable total taken off by discounts — commission "on what the client paid" uses it.
  const discountShare = discountable > 0 ? Math.min(1, discount / discountable) : 0;
  return { discountShare, memberLabel, visits, renterSub: round2(renterSub), servicesSub: round2(servicesSub), retailSub: round2(retailSub), feeSub: round2(feeSub), subtotal, discount, codeDiscount, staffDiscount, groupDiscount, momentDiscount, moment: momentDiscount > 0 && i.momentReward ? i.momentReward : null, group: group && groupDiscount > 0 ? { type: group.type, label: group.label, staffId: group.staffId } : null, memberDiscount, tax, taxLabel: posTaxLabel(i.tenant), tip, storeCredit, total };
}
