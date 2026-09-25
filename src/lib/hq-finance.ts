// src/lib/hq-finance.ts
//
// CLARITYFLOW'S OWN MONEY — what the company earns, what it costs, and what
// is left after tax, pay and growth.
//
// Income and Stripe costs are READ FROM STRIPE (the source of truth):
//   • application fees — the processing fee ClarityFlow's Stripe pricing
//     scheme collects on every payment, attributed to the business (or
//     renter) it came from
//   • the platform balance — everything Stripe charged ClarityFlow
//     (processing on businesses' payments, Connect account/payout fees,
//     disputes, instant-payout costs)
// Stored per month in platformFinance/{YYYY-MM}. Running costs you enter
// (payroll, your pay, software, marketing…) live in platformExpenses.
// Settings (tax rate, pay goals, cash) in platformSettings/finance.

import Stripe from 'stripe';
import { getAdminDb } from '@/lib/firebase-admin';

const stripe = () => new Stripe(process.env.STRIPE_SECRET_KEY || '', { apiVersion: '2025-04-30.basil' as any });
export const monthKey = (d: Date) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;

export interface FinanceSettings {
  taxRatePct: number;           // set aside for income tax on profit
  ownerPayMonthly: number;      // what you want to pay yourself
  cashOnHand: number;           // for runway
  reinvestPct: number;          // of after-tax profit kept for growth
  profitGoalMonthly: number;    // after-tax profit you want to keep each month, on top of everyone's pay
  arpa: number;                 // expected monthly subscription per business (until billing is live)
}
export const DEFAULT_SETTINGS: FinanceSettings = { taxRatePct: 30, ownerPayMonthly: 6000, cashOnHand: 0, reinvestPct: 20, profitGoalMonthly: 2000, arpa: 199 };

/** Who owns each connected Stripe account — businesses and renters. */
async function accountOwners(db: any): Promise<Record<string, { tenantId: string; tenantName: string; renterId?: string; renterName?: string }>> {
  const out: Record<string, any> = {};
  const tenants = await db.collection('tenants').select('name', 'stripeAccountId').limit(500).get();
  for (const t of tenants.docs) {
    const v = t.data() as any;
    if (v.stripeAccountId) out[v.stripeAccountId] = { tenantId: t.id, tenantName: v.name || t.id };
    try {
      const rs = await db.collection(`tenants/${t.id}/renters`).select('stripeAccountId', 'name', 'displayName').limit(300).get();
      for (const r of rs.docs) { const rv = r.data() as any; if (rv.stripeAccountId) out[rv.stripeAccountId] = { tenantId: t.id, tenantName: v.name || t.id, renterId: r.id, renterName: rv.displayName || rv.name || 'Renter' }; }
    } catch { /* no renters */ }
  }
  return out;
}

/** Pull one month of real money movement from Stripe and store it. */
export async function syncStripeMonth(month: string) {
  const db = getAdminDb();
  const s = stripe();
  const [y, m] = month.split('-').map(Number);
  const gte = Math.floor(Date.UTC(y, m - 1, 1) / 1000), lt = Math.floor(Date.UTC(y, m, 1) / 1000);
  const owners = await accountOwners(db);

  // Platform fees collected (the processing fee ClarityFlow keeps).
  let feesCents = 0, feesRefundedCents = 0, feeCount = 0;
  const byTenant: Record<string, { name: string; feesCents: number; refundedCents: number; count: number; renters: Record<string, { name: string; feesCents: number }> }> = {};
  for await (const fee of s.applicationFees.list({ created: { gte, lt }, limit: 100 })) {
    feeCount++; feesCents += fee.amount; feesRefundedCents += fee.amount_refunded || 0;
    const acct = typeof fee.account === 'string' ? fee.account : fee.account?.id || '';
    const o = owners[acct] || { tenantId: `unknown:${acct}`, tenantName: `Unlinked account ${acct.slice(-6)}` };
    const row = byTenant[o.tenantId] = byTenant[o.tenantId] || { name: o.tenantName, feesCents: 0, refundedCents: 0, count: 0, renters: {} };
    row.feesCents += fee.amount; row.refundedCents += fee.amount_refunded || 0; row.count++;
    if (o.renterId) { const r = row.renters[o.renterId] = row.renters[o.renterId] || { name: o.renterName || 'Renter', feesCents: 0 }; r.feesCents += fee.amount; }
  }

  // Everything that moved through ClarityFlow's own Stripe balance.
  const byType: Record<string, { count: number; amountCents: number; feeCents: number }> = {};
  let stripeCostsCents = 0;
  for await (const tx of s.balanceTransactions.list({ created: { gte, lt }, limit: 100 })) {
    const t = byType[tx.type] = byType[tx.type] || { count: 0, amountCents: 0, feeCents: 0 };
    t.count++; t.amountCents += tx.amount; t.feeCents += tx.fee;
    stripeCostsCents += tx.fee;                                           // fees on anything
    if (tx.type === 'stripe_fee' || tx.type === 'tax_fee') stripeCostsCents += Math.abs(tx.amount);   // Connect, Radar, etc. billed as charges
  }
  const doc = { month, syncedAt: new Date().toISOString(), feesCents, feesRefundedCents, feeCount, netFeesCents: feesCents - feesRefundedCents, stripeCostsCents, byType, byTenant };
  await db.doc(`platformFinance/${month}`).set(doc);
  return doc;
}

/** The profit ladder: income → gross profit → operating profit → your pay → tax → growth.
 *  Your pay is treated as a salary (a business expense), as in an S-corp.
 *  How owner pay is taxed depends on how ClarityFlow is set up — confirm
 *  the tax rate and this treatment with your accountant. */
export function profitLadder(input: { revenue: number; costToServe: number; opex: number; settings: FinanceSettings }) {
  const { revenue, costToServe, opex, settings } = input;
  const gross = revenue - costToServe;
  const operating = gross - opex;                                   // opex includes staff; owner pay listed separately below
  const beforeTax = operating - settings.ownerPayMonthly;
  const tax = Math.max(0, beforeTax) * (settings.taxRatePct / 100);
  const afterTax = beforeTax - tax;
  const reinvest = Math.max(0, afterTax) * (settings.reinvestPct / 100);
  return { revenue, costToServe, gross, grossMarginPct: revenue > 0 ? (gross / revenue) * 100 : null, opex, operating, ownerPay: settings.ownerPayMonthly, beforeTax, tax, afterTax, reinvest, keep: afterTax - reinvest };
}

/** How many businesses are needed to reach each goal, at a given revenue and cost per business. */
export function planner(input: { arpa: number; costPerBusiness: number; opex: number; settings: FinanceSettings }) {
  const contribution = input.arpa - input.costPerBusiness;          // what each business adds after its own costs
  const need = (monthlyNeed: number) => (contribution > 0 ? Math.ceil(monthlyNeed / contribution) : null);
  const t = input.settings.taxRatePct / 100;
  return {
    contribution, contributionPct: input.arpa > 0 ? (contribution / input.arpa) * 100 : null,
    breakEven: need(input.opex),
    payYou: need(input.opex + input.settings.ownerPayMonthly),
    // Everyone paid, tax covered, AND the profit goal kept: the pre-tax
    // profit P must satisfy P × (1 − tax) = profitGoal, so P = goal / (1 − tax).
    payYouAfterTaxAndGrow: need(input.opex + input.settings.ownerPayMonthly + input.settings.profitGoalMonthly / Math.max(0.01, 1 - t)),
  };
}
