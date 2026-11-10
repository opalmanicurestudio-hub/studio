// src/lib/stay-receipt.ts — THE LINES ON A DAY OR HOURLY STAY'S RECEIPT (api/booths/receipt). What was booked, in its
// own terms (hours and times, a slot, or days), at the price before any renter discount; the discount and any credit
// used, or the prepaid days it was paid with; and the extra time and other charges taken afterwards (on the saved card or
// in person). With a deposit, a note says what was paid when booking and whether the balance is paid; a stay that's over
// with its balance never recorded says so, rather than claiming it's owed or paid. A booking taken at the desk and not yet
// paid shows as such. The total is what has actually been paid. Pure.

export interface StayReceiptLine { description: string; amountCents: number }
/** paid: nothing left to pay. due: a balance is still to pay. unpaid: booked at the desk and not paid yet. unrecorded:
 *  the stay is over and what was left to pay was never recorded either way. */
export type StayPaidState = 'paid' | 'due' | 'unpaid' | 'unrecorded';
export interface StayReceipt { lines: StayReceiptLine[]; paidCents: number; stillDueCents: number; state: StayPaidState; depositOnly: boolean; method: string; periodLabel: string; bookedLabel: string; note: string }

const n = (v: any) => (Number.isFinite(Number(v)) ? Math.round(Number(v)) : 0);
const usd = (c: number) => `$${(c / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const hm = (t: any) => { const m = /^(\d{2}):(\d{2})/.exec(String(t || '')); if (!m) return String(t || ''); const h = Number(m[1]); return `${h % 12 || 12}${m[2] === '00' ? '' : `:${m[2]}`}${h < 12 ? 'am' : 'pm'}`; };
const longDay = (iso: any) => { const s = String(iso || '').slice(0, 10); const d = new Date(`${s}T12:00:00Z`); return /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(d.getTime()) ? d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }) : s; };

/** What was booked, in its own terms: "3 hours, 1pm to 4pm", "Morning slot, 9am to 12pm", "2 days". */
export function bookedLabel(r: any): string {
  if (r?.bookingType === 'hourly' && r?.startTime && r?.endTime) {
    const mins = (() => { const p = (t: string) => { const m = /^(\d{2}):(\d{2})/.exec(t); return m ? Number(m[1]) * 60 + Number(m[2]) : NaN; }; return p(String(r.endTime)) - p(String(r.startTime)); })();
    const window = `${hm(r.startTime)} to ${hm(r.endTime)}`;
    if (r.slotLabel) return `${r.slotLabel}, ${window}`;
    if (Number.isFinite(mins) && mins > 0) { const h = Number((mins / 60).toFixed(2)); return `${h} hour${h === 1 ? '' : 's'}, ${window}`; }
    return window;
  }
  const days = Math.max(1, n(r?.numDays) || 1);
  return `${days} day${days === 1 ? '' : 's'}`;
}

export function stayReceipt(r: any): StayReceipt {
  const space = String(r?.boothName || 'Space');
  const discount = Math.max(0, n(r?.renterDiscountCents));
  const credit = Math.max(0, n(r?.creditAppliedCents));
  // The price after any renter discount was kept as originalAmountCents; before it, add the discount back.
  const afterDiscount = n(r?.originalAmountCents) || n(r?.netDueCents) + credit || n(r?.amountCents);
  const listed = afterDiscount + discount;
  // A booking taken at the desk and not paid yet: nothing paid, the whole price still to pay.
  const unpaidDesk = r?.paymentStatus === 'unpaid';
  const pass = !!r?.paidWithPassId;
  const paidAtBooking = unpaidDesk || pass ? 0 : Math.max(0, n(r?.amountCents));
  const balance = Math.max(0, n(r?.balanceDueCents));
  const balancePaid = r?.balancePaid === true;
  const over = String(r?.status || '') === 'completed';
  const booked = bookedLabel(r);
  const lines: StayReceiptLine[] = [{ description: `${space}: ${booked}`, amountCents: listed }];
  if (discount > 0) lines.push({ description: 'Renter discount', amountCents: -discount });
  if (credit > 0) lines.push({ description: 'Credit used', amountCents: -credit });
  if (pass && afterDiscount > 0) {
    const days = Math.max(1, n(r?.passDaysUsed) || 1);
    lines.push({ description: `Paid with prepaid days (${days} day${days === 1 ? '' : 's'})`, amountCents: -afterDiscount });
  }
  let extras = 0;
  // Extra time taken on the saved card, or collected in person at the desk.
  const overCents = r?.overageStatus === 'charged' ? n(r?.overageChargedCents ?? r?.overageDueCents) : r?.overageStatus === 'collected' ? n(r?.overageDueCents) : 0;
  if (overCents > 0) {
    extras += overCents;
    lines.push({ description: `Extra time${r.overageMinutes ? `, ${n(r.overageMinutes)} minutes` : ''}`, amountCents: overCents });
  }
  for (const x of Array.isArray(r?.incidentals) ? r.incidentals : []) {
    const c = n(x?.amountCents); if (c <= 0) continue; extras += c;
    lines.push({ description: String(x?.description || 'Charge'), amountCents: c });
  }
  const paidCents = paidAtBooking + (balance > 0 && balancePaid ? balance : 0) + extras;
  const balanceOpen = balance > 0 && !balancePaid;
  // Paid at the till, the booking is marked paid (api/checkout/complete); a stay that's over without that is unrecorded.
  const stillDueCents = over ? 0 : unpaidDesk ? Math.max(0, n(r?.amountCents)) : balanceOpen ? balance : 0;
  const state: StayPaidState = over ? (unpaidDesk || balanceOpen ? 'unrecorded' : 'paid') : unpaidDesk ? 'unpaid' : stillDueCents > 0 ? 'due' : 'paid';
  const periodLabel = r?.startDate && r?.endDate && r.startDate !== r.endDate ? `${longDay(r.startDate)} to ${longDay(r.endDate)}` : longDay(r?.startDate);
  // With a deposit: what was paid when booking, and the balance, said in words under the lines (the lines are the price).
  const note = unpaidDesk
    ? (over ? 'Booked at the desk. Its payment isn’t recorded here.' : `Booked at the desk. The ${usd(stillDueCents)} isn’t paid yet.`)
    : balance > 0
      ? `${usd(paidAtBooking)} deposit paid when booking. ${balancePaid ? `The ${usd(balance)} balance is paid.` : over ? `The ${usd(balance)} balance was due in person and isn’t recorded here.` : `The ${usd(balance)} balance is still to pay.`}`
      : '';
  const method = pass ? 'Prepaid days' : r?.source === 'desk' || r?.paidVia === 'pos' ? 'Paid at the desk' : 'Card (Stripe)';
  // Over with its balance never recorded, but its deposit was paid: said as such.
  const depositOnly = state === 'unrecorded' && !unpaidDesk && balance > 0;
  return { lines, paidCents, stillDueCents, state, depositOnly, method, periodLabel, bookedLabel: booked, note };
}

