// src/lib/rent-payment-plan.ts — WHERE A RENT PAYMENT GOES. One rule for every place a payment is recorded: the Rent
// page, a renter's profile on Spaces, and the front desk. The money pays the renter's rent bills first, oldest first
// (part of a bill when it runs out), then whole one-off charges with what's left, oldest first, and anything over what
// they owe is kept as credit that comes off their next bill. The same money never pays two things.
// Pure: it decides, it never writes.
import { invoiceOwedCents, isOpenLedgerCharge, RENT_CREDIT_TYPES, isRentCredit } from '@/lib/booth-rental-types';

/** Ledger lines that are money held for the renter, drawn down against rent bills (appliedCents says how much is used).
 *  Defined with the ledger's types (lib/booth-rental-types), so what's owed there counts them too. */
export { RENT_CREDIT_TYPES };

export interface PlannedBill { id: string; takeCents: number; full: boolean; paidCentsBefore: number }
export interface PlannedCharge { id: string; cents: number; status: string }
export interface RentPaymentPlan {
  bills: PlannedBill[];
  charges: PlannedCharge[];
  /** Over what they owe: kept as paid-ahead credit. */
  creditCents: number;
  /** What they owed before this payment (bills and charges). */
  owedBeforeCents: number;
}

const n = (v: any) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const byDue = (a: any, b: any) => String(a.dueDate || a.createdAt || '').localeCompare(String(b.dueDate || b.createdAt || '')) || String(a.id || '').localeCompare(String(b.id || ''));

/** How long autopay's claim on a bill keeps everything else off it while it charges the card (as the portal's Pay now). */
export const AUTOPAY_CLAIM_MS = 10 * 60 * 1000;

/** Autopay may be taking this bill: it's charging the card right now (claimed in the last few minutes, no result yet), or
 *  the card company didn't answer, so it may have gone through. Nothing else pays it until that's settled: autopay's own
 *  result, or the business checking Stripe and marking it as not taken. A claim that never finished (the job stopped
 *  part way) stops counting after a few minutes, so the bill is never stuck. */
export function autopayBusy(inv: any, nowMs: number = Date.now()): boolean {
  if (!['due', 'late'].includes(String(inv?.status || ''))) return false;
  if (inv?.autopayUnconfirmed === true) return true;
  if (!inv?.autopayTriedAt || inv?.autopayDeclined || inv?.autopayIntentId) return false;
  const at = Date.parse(String(inv.autopayTriedAt));
  return Number.isFinite(at) && nowMs - at < AUTOPAY_CLAIM_MS;
}

/** A one-off charge a rent payment can pay. A deposit isn't rent: it's held, and recorded on its own. */
function rentCharge(e: any): boolean {
  return isOpenLedgerCharge(e) && !String(e?.type || '').startsWith('deposit_');
}

export function planRentPayment(amountCents: number, invoices: any[], ledger: any[], nowMs: number = Date.now()): RentPaymentPlan {
  const amount = Math.max(0, Math.round(n(amountCents)));
  const openBills = (invoices || []).filter((i) => !autopayBusy(i, nowMs)).map((i) => ({ i, owed: invoiceOwedCents(i) })).filter((x) => x.owed > 0).sort((a, b) => byDue(a.i, b.i));
  const openCharges = (ledger || []).filter(rentCharge).sort(byDue);
  const owedBeforeCents = openBills.reduce((s, x) => s + x.owed, 0) + openCharges.reduce((s, e) => s + n(e.amountCents), 0);

  let left = amount;
  const bills: PlannedBill[] = [];
  for (const { i, owed } of openBills) {
    if (left <= 0) break;
    const take = Math.min(left, owed);
    left -= take;
    bills.push({ id: String(i.id), takeCents: take, full: take >= owed, paidCentsBefore: n(i.paidCents) });
  }
  // One-off charges are paid whole, oldest first; the first one the money can't cover stops the run (no skipping ahead).
  const charges: PlannedCharge[] = [];
  for (const e of openCharges) {
    const c = n(e.amountCents);
    if (left < c) break;
    left -= c;
    charges.push({ id: String(e.id), cents: c, status: String(e.status || 'pending') });
  }
  return { bills, charges, creditCents: left, owedBeforeCents };
}

/** What a credit line still has to give. */
export function creditRemainingCents(line: any): number {
  if (!isRentCredit(line)) return 0;
  return Math.max(0, Math.abs(n(line.amountCents)) - n(line.appliedCents));
}

/** Plain words for a credit's source, as the bill and the renter's alert show it. */
export function creditLabel(type: string): string {
  return type === 'desk_offset' ? 'front-desk collections' : type === 'prepaid_credit' ? 'paid ahead' : type === 'gift_card_credit' ? 'gift cards'
    : type === 'retail_sale_credit' ? 'online shop sales' : type === 'rent_abatement' ? 'closure credit' : type === 'leave_credit' ? 'time-away credit'
    : type === 'sublet_credit' ? 'sublet income' : type === 'deposit_forfeit' ? 'security deposit' : String(type || 'credit').replace(/_/g, ' ');
}

/** Can credits safely go on this open bill now? Not while autopay may still be charging it, or has charged it without
 *  the rest of its record saving: that bill is settled by autopay's own result first. */
export function billTakesCredit(inv: any): boolean {
  if (!['due', 'late'].includes(String(inv?.status || ''))) return false;
  if (inv?.autopayIntentId || autopayBusy(inv)) return false;
  return invoiceOwedCents(inv) > 0;
}

/** Where a renter's account stands: what they owe (bills and one-off rent charges) less the credit waiting to come off,
 *  or the credit left over when it covers everything. The one figure a receipt states. */
export function accountPosition(invoices: any[], ledger: any[]): { owedCents: number; creditCents: number } {
  const owed = (invoices || []).reduce((s, i) => s + invoiceOwedCents(i), 0) + (ledger || []).filter(rentCharge).reduce((s, e) => s + n(e.amountCents), 0);
  const credit = (ledger || []).reduce((s, l) => s + creditRemainingCents(l), 0);
  return { owedCents: Math.max(0, owed - credit), creditCents: Math.max(0, credit - owed) };
}

export interface CreditUse { lineId: string; type: string; takeCents: number }
/** Credits (oldest first) against open bills (oldest first), then against whole one-off charges (oldest first, the same
 *  rule as a payment: the first the credit can't cover stops the run). */
export function planCredits(invoices: any[], ledger: any[]): { bills: { id: string; takeCents: number; full: boolean; paidCentsBefore: number; uses: CreditUse[] }[]; charges: { id: string; cents: number; uses: CreditUse[] }[] } {
  const credits = (ledger || []).map((l) => ({ l, left: creditRemainingCents(l) })).filter((x) => x.left > 0)
    .sort((a, b) => String(a.l.date || a.l.createdAt || '').localeCompare(String(b.l.date || b.l.createdAt || '')) || String(a.l.id || '').localeCompare(String(b.l.id || '')));
  const bills = (invoices || []).filter(billTakesCredit).sort(byDue);
  const out: { id: string; takeCents: number; full: boolean; paidCentsBefore: number; uses: CreditUse[] }[] = [];
  for (const inv of bills) {
    let owed = invoiceOwedCents(inv); const uses: CreditUse[] = []; let take = 0;
    for (const c of credits) {
      if (owed <= 0) break;
      if (c.left <= 0) continue;
      const t = Math.min(c.left, owed);
      c.left -= t; owed -= t; take += t;
      uses.push({ lineId: String(c.l.id), type: String(c.l.type), takeCents: t });
    }
    if (take > 0) out.push({ id: String(inv.id), takeCents: take, full: owed <= 0, paidCentsBefore: n(inv.paidCents), uses });
    if (!credits.some((c) => c.left > 0)) break;
  }
  const charges: { id: string; cents: number; uses: CreditUse[] }[] = [];
  for (const e of (ledger || []).filter(rentCharge).sort(byDue)) {
    const cost = n(e.amountCents);
    if (credits.reduce((s, c) => s + c.left, 0) < cost) break;
    let need = cost; const uses: CreditUse[] = [];
    for (const c of credits) {
      if (need <= 0) break;
      if (c.left <= 0) continue;
      const t = Math.min(c.left, need);
      c.left -= t; need -= t;
      uses.push({ lineId: String(c.l.id), type: String(c.l.type), takeCents: t });
    }
    charges.push({ id: String(e.id), cents: cost, uses });
  }
  return { bills: out, charges };
}
