// src/lib/rent-outlook.ts — WHAT A RENTER SEES ABOUT WHAT'S NEXT: owed now, credit waiting, and the next rent after
// credits. Same rules as the nightly rent job (a credit's remaining = amount − applied; credits come off the next
// invoice when it's made, not what's already owed), so the portal never promises a figure the bill won't match.
import { nextChargeDate } from '@/lib/rent-schedule';

export const CREDIT_LABELS: Record<string, string> = { prepaid_credit: 'Paid ahead', desk_offset: 'Front-desk collections', leave_credit: 'Leave credit', sublet_credit: 'Sublet credit', rent_abatement: 'Rent reduction' };

export function rentOutlook(x: { lease: any; renter: any; invoices: any[]; ledger: any[]; todayIso: string }) {
  const credits = (x.ledger || []).filter((c) => CREDIT_LABELS[String(c.type || '')])
    .map((c) => ({ label: CREDIT_LABELS[String(c.type)], cents: Math.abs(Number(c.amountCents) || 0) - (Number(c.appliedCents) || 0) })).filter((c) => c.cents > 0);
  const creditCents = credits.reduce((n, c) => n + c.cents, 0);
  const owedNowCents = (x.invoices || []).filter((i) => ['due', 'late'].includes(String(i.status))).reduce((n, i) => n + Math.max(0, (Number(i.amountCents) || 0) + (Number(i.lateFeeCents) || 0) - (Number(i.paidCents) || 0)), 0);
  const active = !!x.lease && !['ended', 'terminated', 'cancelled'].includes(String(x.lease.status || ''));
  const tomorrow = new Date(Date.parse(`${x.todayIso}T12:00:00Z`) + 86400000).toISOString().slice(0, 10);
  const due = active ? nextChargeDate(x.lease, tomorrow) : null;
  const already = due ? (x.invoices || []).find((i) => String(i.dueDate || '').slice(0, 10) === due) : null;   // already billed → it's in "owed now"
  const nextRentCents = due && !already ? Math.max(0, Number(x.lease.rentAmountCents) || 0) : 0;
  const covered = Math.min(creditCents, nextRentCents);
  const r = x.renter || {};
  const autopayOn = r.autopayEnabled === true && !!(r.stripeCustomerId && (r.stripePaymentMethodId || r.defaultPaymentMethodId));
  return { owedNowCents, credits, creditCents, nextDue: due && !already ? due : null, nextRentCents, nextAfterCreditsCents: nextRentCents - covered, creditLeftAfterCents: creditCents - covered, autopayOn };
}
