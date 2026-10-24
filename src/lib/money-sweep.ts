// src/lib/money-sweep.ts — EVERY PAYMENT ENDS RECORDED OR REFUNDED (server; run by the five-minute check,
// api/cron/retail-payments). Each way money moves claims what it's for before it asks Stripe, under one key; when the
// answer is lost and nobody asks again, the claim would sit there with the money unrecorded. Here each kind is looked
// up at Stripe, by the key or mark it went under: a payment or refund that went through is recorded, once; one Stripe
// never got lets its claim go, so it can be asked again. Nothing here charges a card. A refund already asked for is
// finished as asked (the same key, never a second), except undoing a booking, which is left to the desk.
// Each part runs on its own, side by side, so one that fails or is slow doesn't hold up the rest; two runs at once
// settle each payment once.
import { settleLostCardCharges } from '@/lib/lost-charges';
import { settleStuckFeeClaims, settleStuckPaidTwice } from '@/lib/fee-pay';
import { settleStuckDepositRefunds } from '@/lib/deposit-refund';
import { settleStuckUndos } from '@/lib/undo-booking';
import { settleLostBoothMoney } from '@/lib/booth-money';
import { settleStuckRentRefunds } from '@/lib/rent-online-pay';
import { settleStuckSaleRefunds } from '@/lib/money-refund';
import { settleCancellingGroups } from '@/lib/gift-groups';
import { settleStuckBulkRefunds } from '@/lib/gift-bulk';
import { settleLostKioskCharges } from '@/lib/kiosk-charges';
import { settleLostRenterIncidentals } from '@/lib/renter-incidentals';
import { settleLostStationBookings } from '@/lib/station-booking';

export type SweepCounts = { checked: number; recorded: number; released: number; waiting: number };
type Part = (db: any, tenantId: string, tenant: any, o: { stripe?: any; now?: number }) => Promise<Partial<SweepCounts> & Record<string, any>>;

const PARTS: [string, Part][] = [
  ['cardCharges', settleLostCardCharges as Part],      // a card charged at the desk or by a booking step (api/stripe/charge-card)
  ['feeClaims', settleStuckFeeClaims as Part],          // fees charged to the card on file, or a whole balance (lib/fee-pay)
  ['feesPaidTwice', settleStuckPaidTwice as Part],      // …and money for fees already paid, on its way back (lib/fee-pay)
  ['depositRefunds', settleStuckDepositRefunds as Part], // a deposit refunded on its own (lib/deposit-refund)
  ['undos', settleStuckUndos as Part],                  // a booking undone at the desk, with its deposit (lib/undo-booking)
  ['saleRefunds', settleStuckSaleRefunds as Part],      // a sale refunded to the card from Money or a case (lib/money-refund)
  ['boothMoney', settleLostBoothMoney as Part],         // a booth's overage, extras and refunds (lib/booth-money)
  ['kioskCharges', settleLostKioskCharges as Part],     // a concierge order charged to a saved card (lib/kiosk-charges)
  ['renterIncidentals', settleLostRenterIncidentals as Part], // an incidental charged to a renter's card (lib/renter-incidentals)
  ['stationBookings', settleLostStationBookings as Part], // a station booked and charged in one step (lib/station-booking)
  ['rentRefunds', settleStuckRentRefunds as Part],      // rent paid online that wasn't owed, on its way back (lib/rent-online-pay)
  ['groupGifts', settleCancellingGroups as Part],       // a cancelled group gift's shares, on their way back (lib/gift-groups)
  ['bulkGiftRefunds', settleStuckBulkRefunds as Part],  // a company's second payment for gift cards, on its way back (lib/gift-bulk)
];

/** One business: every kind, each on its own and side by side (so one slow part doesn't hold up the rest). Counts by
 *  kind, and what failed (to look at in the logs). */
export async function sweepMoneyOnTheWay(db: any, tenantId: string, tenant: any, o: { stripe?: any; now?: number } = {}) {
  const totals: SweepCounts = { checked: 0, recorded: 0, released: 0, waiting: 0 };
  const byKind: Record<string, SweepCounts> = {}; const failed: string[] = [];
  const results = await Promise.allSettled(PARTS.map(([, part]) => part(db, tenantId, tenant, o)));
  results.forEach((res, i) => {
    const name = PARTS[i][0];
    if (res.status === 'rejected') { failed.push(name); console.error('[money-sweep]', tenantId, name, String((res.reason as any)?.message || res.reason).slice(0, 160)); return; }
    const r: any = res.value || {};
    const c: SweepCounts = { checked: Number(r.checked) || 0, recorded: Number(r.recorded) || 0, released: Number(r.released) || 0, waiting: Number(r.waiting) || 0 };
    byKind[name] = c;
    for (const k of Object.keys(totals) as (keyof SweepCounts)[]) totals[k] += c[k];
  });
  return { ...totals, byKind, failed };
}
