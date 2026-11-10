// src/lib/rent-money.ts — RENT AND DEPOSITS, WORKED OUT IN ONE PLACE. What the Rent page (components/renters/RentMoney)
// shows at the top: owed now, collected this month (and how), what's due in the next week, deposits held; who owes
// what (each bill, the late fee, autopay), the deposits to settle or still to come in, what's coming up, what was paid,
// and former renters who still owe. The rules are the shared ones (lib/booth-rental-types, lib/deposit-accounting,
// lib/rentals-home), so the Rent page, the Rentals home and each renter's page say the same. Pure: no database.
import { invoiceOwedCents, renterOwedCents, buildRentRollSummary, isOpenLedgerCharge, getPastDueEntries, bizDayOf } from '@/lib/booth-rental-types';
import { depositPosition } from '@/lib/deposit-accounting';
import { OCCUPYING, RUNNING, leaseEnding, plusDays, dayDiff, monthDay, money, nameOf } from '@/lib/rentals-home';
import type { ScheduledCharge } from '@/lib/rent-schedule';

const n = (v: any) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const day = (v: any) => String(v || '').slice(0, 10);
const isDay = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v);
const plural = (k: number, one: string, many = `${one}s`) => `${k} ${k === 1 ? one : many}`;
const ENDED = ['ended', 'terminated', 'cancelled'];
const notDeposit = (e: any) => !String(e?.type || '').startsWith('deposit_');

export interface OwedBill { id: string; dueDate: string; text: string; leftCents: number; feeCents: number; late: boolean; autopayUnconfirmed: boolean; autopayTriedAt: string; inv: any }
export interface OwedRow { renterId: string; name: string; space: string; totalCents: number; late: boolean; daysLate: number; autopay: string; barred: boolean; bills: OwedBill[]; charges: { id: string; text: string; cents: number; entry: any }[] }
export interface DepositRow { renterId: string; leaseId: string; name: string; space: string; cents: number; kind: 'settle' | 'unpaid'; text: string }
export interface UpcomingRow { leaseId: string; renterId: string; name: string; space: string; date: string; cents: number; how: string; warn: boolean }
export interface PaidRow { id: string; renterId: string; name: string; date: string; cents: number; how: string; receiptId: string | null; refund?: boolean }

export interface RentMoneyInput {
  todayIso: string; renters: any[]; leases: any[]; booths: any[]; invoices: any[]; ledger: any[];
  schedule?: ScheduledCharge[];
  /** The business's time zone: a payment made at 9pm on the 31st is that month's, wherever the server is. */
  timeZone?: string | null;
}

export function rentMoney(x: RentMoneyInput) {
  const today = x.todayIso; const monthStart = `${today.slice(0, 7)}-01`; const in7 = plusDays(today, 7);
  const onDay = (v: any) => bizDayOf(v, x.timeZone);
  const renters = x.renters || []; const leases = x.leases || []; const invoices = x.invoices || []; const ledger = x.ledger || [];
  const renterById = new Map(renters.map((r) => [r.id, r]));
  const boothName = new Map((x.booths || []).map((b) => [b.id, String(b.name || 'Space')]));
  const holdingByRenter = new Map<string, any[]>();
  for (const l of leases) if (OCCUPYING.includes(String(l.status))) holdingByRenter.set(l.renterId, [...(holdingByRenter.get(l.renterId) || []), l]);
  const spaceOf = (rid: string) => (holdingByRenter.get(rid) || []).map((l) => boothName.get(l.boothId) || 'Space').join(', ');
  const roll = buildRentRollSummary({ booths: (x.booths || []) as any, renters: renters as any, leases: leases as any, ledger: ledger as any, todayIso: today, cycleStartIso: monthStart, invoices, timeZone: x.timeZone });

  // ── Who owes what (people renting now; former renters are their own list) ──
  const leaseById = new Map(leases.map((l) => [l.id, l]));
  const pastDue = (e: any) => getPastDueEntries([e], n(leaseById.get(e.leaseId)?.lateFeePolicy?.graceDays), today).length > 0;
  const owingIds = new Set<string>([
    ...invoices.filter((i) => invoiceOwedCents(i) > 0).map((i) => String(i.renterId || '')),
    ...ledger.filter((e) => isOpenLedgerCharge(e) && notDeposit(e)).map((e) => String(e.renterId || '')),
  ].filter(Boolean));
  const current = (rid: string) => (holdingByRenter.get(rid) || []).length > 0;
  const owed: OwedRow[] = [];
  const former: OwedRow[] = [];
  for (const rid of owingIds) {
    const r = renterById.get(rid);
    const total = renterOwedCents(rid, invoices, ledger); if (total <= 0) continue;
    const bills: OwedBill[] = invoices.filter((i) => i.renterId === rid && invoiceOwedCents(i) > 0).sort((a, b) => String(a.dueDate).localeCompare(String(b.dueDate))).map((i) => {
      const fee = n(i.lateFeeCents); const paid = n(i.paidCents);
      return { id: i.id, dueDate: day(i.dueDate), feeCents: fee, late: i.status === 'late', inv: i, autopayUnconfirmed: i.autopayUnconfirmed === true, autopayTriedAt: onDay(i.autopayTriedAt), leftCents: invoiceOwedCents(i),
        text: `${monthDay(day(i.dueDate))} rent ${money(n(i.amountCents))}${fee ? ` + late fee ${money(fee)}` : ''}${paid ? `, ${money(paid)} paid` : ''}` };
    });
    const open = ledger.filter((e) => e.renterId === rid && isOpenLedgerCharge(e) && notDeposit(e));
    const charges = open.map((e) => ({ id: e.id, entry: e, text: `${String(e.description || 'Charge')}${isDay(day(e.dueDate)) ? `, due ${monthDay(day(e.dueDate))}` : ''}`, cents: n(e.amountCents) }));
    // Late by the shared rule (a bill the nightly marked late, or a charge past its due date and grace), a deposit aside.
    const lateSince = [...bills.filter((b) => b.late).map((b) => b.dueDate), ...open.filter(pastDue).map((e) => day(e.dueDate))].filter(isDay).sort()[0] || '';
    const late = bills.some((b) => b.late) || open.some(pastDue);
    const row: OwedRow = {
      renterId: rid, name: r ? nameOf(r) : String(bills[0]?.inv?.renterName || 'Renter'), space: spaceOf(rid) || String(bills[0]?.inv?.boothName || ''), totalCents: total, late,
      daysLate: late && lateSince ? Math.max(1, dayDiff(today, lateSince)) : 0,
      autopay: r?.autopayEnabled === true ? 'autopay on' : 'autopay off', barred: r?.doNotRent === true, bills, charges,
    };
    (current(rid) ? owed : former).push(row);
  }
  // Someone barred from booking who has since paid stays on the former list, so they can be let back in.
  for (const r of renters) {
    if (r?.doNotRent !== true || current(r.id) || former.some((f) => f.renterId === r.id) || owed.some((o) => o.renterId === r.id)) continue;
    former.push({ renterId: r.id, name: nameOf(r), space: '', totalCents: 0, late: false, daysLate: 0, autopay: 'autopay off', barred: true, bills: [], charges: [] });
  }
  const byPressing = (a: OwedRow, b: OwedRow) => Number(b.late) - Number(a.late) || b.daysLate - a.daysLate || b.totalCents - a.totalCents;
  owed.sort(byPressing); former.sort(byPressing);
  const paidUp = renters.filter((r) => current(r.id) && !owed.some((o) => o.renterId === r.id)).length;

  // ── Deposits ──
  const deposits: DepositRow[] = [];
  let heldCents = 0; let heldCount = 0;
  for (const l of leases) {
    const p = depositPosition(l, ledger);
    const r = renterById.get(l.renterId); const name = r ? nameOf(r) : 'Renter'; const space = boothName.get(l.boothId) || 'Space';
    if (p.heldCents > 0) { heldCents += p.heldCents; heldCount += 1; }
    const ended = ENDED.includes(String(l.status));
    const end = leaseEnding(l, today, 30);
    if (p.heldCents > 0 && (ended || (end && !end.renews))) {
      const by = ended ? '' : end ? `lease ends ${monthDay(end.endDate)}` : '';
      deposits.push({ renterId: l.renterId, leaseId: l.id, name, space, cents: p.heldCents, kind: 'settle', text: ended ? `${money(p.heldCents)} held · lease ended, to return or settle` : `${money(p.heldCents)} held · ${by}` });
    } else if (p.agreedCents > 0 && p.collectedCents < p.agreedCents && RUNNING.concat('pending_signature').includes(String(l.status)) && !['returned', 'partly_returned', 'forfeited'].includes(p.status)) {
      const left = p.agreedCents - p.collectedCents;
      deposits.push({ renterId: l.renterId, leaseId: l.id, name, space, cents: left, kind: 'unpaid', text: l.status === 'pending_signature' ? `${money(left)} due once they sign` : `${money(left)} not paid yet${p.collectedCents ? ` (${money(p.collectedCents)} of ${money(p.agreedCents)} in)` : ''}` });
    }
  }
  deposits.sort((a, b) => (a.kind === b.kind ? b.cents - a.cents : a.kind === 'settle' ? -1 : 1));
  const toSettle = deposits.filter((d) => d.kind === 'settle'); const unpaid = deposits.filter((d) => d.kind === 'unpaid');
  const restHeld = { count: Math.max(0, heldCount - toSettle.length), cents: Math.max(0, heldCents - toSettle.reduce((t, d) => t + d.cents, 0)) };

  // ── Coming up: rent due in the next seven days ──
  // From today: rent due today that hasn't been billed yet counts; once its bill exists it's under Owed (or paid).
  // A bill waived or written off still counts as that day's bill; only one voided by mistake doesn't.
  const billed = new Set([
    ...invoices.filter((i) => i?.status !== 'void' || ['waived', 'written_off'].includes(String(i?.voidReason || ''))).map((i) => `${i.leaseId}|${day(i.dueDate)}`),
    ...ledger.filter((e) => e?.type === 'rent_charge').map((e) => `${e.leaseId}|${day(e.dueDate)}`),
  ]);
  const upcoming: UpcomingRow[] = (x.schedule || []).filter((s) => s.date >= today && s.date <= in7 && !billed.has(`${s.leaseId}|${s.date}`)).map((s) => {
    const r = renterById.get(s.renterId);
    const how = s.readiness === 'ready' ? (s.lastAttempt && !s.lastAttempt.ok ? 'Autopay, last one declined' : 'Autopay ready') : s.readiness === 'no_card' ? 'Autopay on, no card' : s.readiness === 'manual' ? 'Paid by them' : 'No due day set';
    return { leaseId: s.leaseId, renterId: s.renterId, name: r ? nameOf(r) : 'Renter', space: boothName.get(s.boothId) || 'Space', date: s.date, cents: s.amountCents, how, warn: s.readiness === 'no_card' || s.readiness === 'no_schedule' || !!(s.lastAttempt && !s.lastAttempt.ok) };
  }).sort((a, b) => a.date.localeCompare(b.date));
  const dueSoonCents = upcoming.reduce((t, u) => t + u.cents, 0);
  const onAutopay = upcoming.filter((u) => u.how === 'Autopay ready').length;

  // ── Paid this month: payments by hand or at the desk, autopay, and online ──
  const paid: PaidRow[] = [];
  for (const e of ledger) {
    const at = onDay(e.paidAt);
    if (e.status !== 'paid' || !isDay(at) || at < monthStart) continue;
    const r = renterById.get(e.renterId);
    if (e.type === 'payment') {
      const said = String(e.description || '').replace(/^Payment\s*[—-]\s*/, '').trim();
      paid.push({ id: e.id, renterId: e.renterId, name: r ? nameOf(r) : 'Renter', date: at, cents: Math.abs(n(e.amountCents)), how: e.method === 'autopay' ? 'Autopay' : /desk/i.test(said) ? 'At the desk' : said ? `By hand, ${said.charAt(0).toLowerCase()}${said.slice(1)}` : 'By hand', receiptId: e.id });
    }
    else if (e.type === 'rent_charge' && /autopay/i.test(String(e.description || ''))) paid.push({ id: e.id, renterId: e.renterId, name: r ? nameOf(r) : 'Renter', date: at, cents: Math.abs(n(e.amountCents)), how: 'Autopay', receiptId: e.id });
  }
  for (const i of invoices) {
    const at = onDay(i.paidAt);
    if (i.status !== 'paid' || i.paidMethod !== 'Card (Stripe)' || !isDay(at) || at < monthStart) continue;
    const r = renterById.get(i.renterId);
    paid.push({ id: i.id, renterId: i.renterId, name: r ? nameOf(r) : String(i.renterName || 'Renter'), date: at, cents: n(i.paidAmountCents) || n(i.amountCents), how: 'Online', receiptId: null });
  }
  // Part of a bill paid online (the rest still open, or paid later): each part on its own line, on the day it came in.
  for (const i of invoices) {
    for (const [k, part] of Object.entries((i?.onlineParts || {}) as Record<string, any>)) {
      const at = onDay(part?.at);
      if (!isDay(at) || at < monthStart || n(part?.cents) <= 0) continue;
      const r = renterById.get(i.renterId);
      paid.push({ id: `${i.id}:${k}`, renterId: i.renterId, name: r ? nameOf(r) : String(i.renterName || 'Renter'), date: at, cents: n(part.cents), how: `Online, part of the ${monthDay(day(i.dueDate))} bill`, receiptId: null });
    }
  }
  // Money refunded to a renter's card this month comes off what was collected, so it's listed too.
  for (const e of ledger) {
    const at = onDay(e.createdAt);
    if (e?.type !== 'card_refund' || !isDay(at) || at < monthStart) continue;
    const r = renterById.get(e.renterId);
    paid.push({ id: e.id, renterId: e.renterId, name: r ? nameOf(r) : 'Renter', date: at, cents: -Math.abs(n(e.amountCents)), how: 'Refunded to their card', receiptId: null, refund: true });
  }
  paid.sort((a, b) => b.date.localeCompare(a.date));
  const byAutopay = paid.filter((p) => p.how === 'Autopay').length; const refunds = paid.filter((p) => p.refund).length; const byHand = paid.length - byAutopay - refunds;

  const monthName = new Date(`${today}T12:00:00Z`).toLocaleDateString('en-US', { month: 'long', timeZone: 'UTC' });
  // Owed now is everyone's, former renters too, by the same rule as the Rentals home; the line under it says who.
  const owedNow = [...owed, ...former].reduce((t, o) => t + o.totalCents, 0);
  const formerOwing = former.filter((f) => f.totalCents > 0).length;
  const lateRows = owed.filter((o) => o.late);
  const lateWords = (o: OwedRow) => (o.daysLate ? `${plural(o.daysLate, 'day')} late` : 'late');
  const kpis = [
    { key: 'owed', label: 'Owed now', value: money(owedNow), warn: lateRows.length > 0 || formerOwing > 0,
      sub: [owed.length ? `${plural(owed.length, 'renter')}${lateRows.length ? `, ${owed.length === 1 ? lateWords(lateRows[0]) : lateRows.length === 1 ? `1 is ${lateWords(lateRows[0])}` : `${lateRows.length} late`}` : ''}` : '',
        formerOwing ? `${owed.length ? 'plus ' : ''}${plural(formerOwing, 'former renter')}` : ''].filter(Boolean).join(', ') || 'Everyone is paid up' },
    { key: 'collected', label: `Collected in ${monthName}`, value: money(Math.max(0, roll.collectedThisCycleCents)), sub: paid.length ? [byAutopay ? `${byAutopay} by autopay` : '', byHand ? `${byHand} by hand or online` : '', refunds ? `less ${plural(refunds, 'refund')}` : ''].filter(Boolean).join(', ') : 'Nothing yet this month' },
    { key: 'soon', label: 'Due in the next 7 days', value: money(dueSoonCents), sub: upcoming.length ? `${plural(upcoming.length, 'bill')}${onAutopay ? `, ${onAutopay} on autopay` : ''}` : 'Nothing due this week' },
    { key: 'deposits', label: 'Deposits held', value: money(heldCents), warn: toSettle.length > 0, sub: [toSettle.length ? `${toSettle.length} to settle` : '', unpaid.length ? `${unpaid.length} not paid` : ''].filter(Boolean).join(', ') || (heldCount ? `across ${plural(heldCount, 'lease')}` : 'None held') },
  ];

  return { kpis, owed, former, paidUp, deposits: { toSettle, unpaid, restHeld }, upcoming, paid, monthName };
}
