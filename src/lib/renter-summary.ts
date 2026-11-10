// src/lib/renter-summary.ts — ONE RENTER, ON ONE PAGE. What the renter's own page (app/(app)/renters/[renterId],
// components/renters/RenterPage) shows at the top and on its Overview: who they are and where, the one thing that
// needs doing about them, six numbers (owes, next bill, lease, deposit, autopay, portal) and four cards (lease, money,
// insurance and paperwork, their business), each line in amber when something needs doing. The rules are the shared
// ones (lib/rentals-home, lib/renters-roster, lib/compliance, lib/rent-outlook, lib/deposit-accounting), so this page
// says what the Rentals home, Spaces and Renters lists say. Pure: no database.
import { OCCUPYING, RUNNING, leaseEnding, leasePastEnd, monthDay, money, nameOf } from '@/lib/rentals-home';
import { renterOwedCents, invoiceOwedCents, buildRentRollSummary } from '@/lib/booth-rental-types';
import { credentialViews, type CredentialView } from '@/lib/compliance';
import { depositPosition } from '@/lib/deposit-accounting';
import { rentOutlook } from '@/lib/rent-outlook';
import { autopayReadiness } from '@/lib/rent-schedule';
import { portalCell } from '@/lib/renters-roster';

const n = (v: any) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const day = (v: any) => String(v || '').slice(0, 10);
const isDay = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v);
const longDay = (iso: string) => { const d = new Date(`${day(iso)}T12:00:00Z`); return isNaN(d.getTime()) ? '' : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }); };
const monthYear = (iso: string) => { const d = new Date(`${day(iso)}T12:00:00Z`); return isNaN(d.getTime()) ? '' : d.toLocaleDateString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' }); };
const ordinal = (k: number) => { const s = ['th', 'st', 'nd', 'rd']; const v = k % 100; return `${k}${s[(v - 20) % 10] || s[v] || s[0]}`; };
const PER: Record<string, string> = { monthly: 'a month', weekly: 'a week', biweekly: 'every two weeks', daily: 'a day' };

export interface Line { label: string; value: string; warn?: boolean; ok?: boolean }
export interface Tile { label: string; value: string; warn?: boolean; ok?: boolean }

export interface RenterSummaryInput {
  todayIso: string; tenant: any; renter: any; leases: any[]; booths: any[]; invoices: any[]; ledger: any[];
  documents?: any[]; tickets?: any[]; grievances?: any[]; leaves?: any[];
  /** Their W-9: true on file, false not, undefined not known. */
  w9OnFile?: boolean;
  businessAccount?: string | null;
  /** Their provider record, when they take bookings through the business. */
  provider?: any;
  /** The business's time zone, for the day a moment falls on. */
  timeZone?: string | null;
}

function paperLine(v: CredentialView | undefined, label: string, holding: boolean, today: string): Line {
  if (!v) return { label, value: 'Not needed' };
  if (v.state === 'expired') return { label, value: `Expired ${monthDay(String(v.expiry))}`, warn: holding };
  if (v.state === 'expiring') return { label, value: v.daysLeft === 0 ? 'Ends today' : `Ends in ${v.daysLeft} day${v.daysLeft === 1 ? '' : 's'}`, warn: holding };
  if (v.state === 'missing') return v.required ? { label, value: 'Not on file', warn: holding } : { label, value: 'Not needed' };
  const until = v.expiry && day(v.expiry) > today ? `to ${monthYear(v.expiry)}` : 'on file';
  const said = v.kind === 'insurance' && v.carrier ? `${v.carrier}, ${until}` : until;
  return { label, value: said.charAt(0).toUpperCase() + said.slice(1), ok: true };
}

const lcFirst = (t: string) => t.charAt(0).toLowerCase() + t.slice(1);
const ENDED = ['ended', 'terminated'];

/** The lease a renter's page is about: one running, else one being signed, else their latest that ended (so a deposit
 *  still held after they leave can be settled). The page and its summary use this same choice. */
export function pickLease(leases: any[], renterId: string): any | null {
  const mine = (leases || []).filter((l) => l?.renterId === renterId);
  return mine.find((l) => RUNNING.includes(String(l.status))) || mine.find((l) => l.status === 'pending_signature')
    || mine.filter((l) => ENDED.includes(String(l.status))).sort((a, b) => String(b.endDate || b.lastChargeDate || b.updatedAt || '').localeCompare(String(a.endDate || a.lastChargeDate || a.updatedAt || '')))[0] || null;
}

/** Moved out: holding no space now, and either marked so or with a lease that actually ran (the Renters list's rule). */
export function hasMovedOut(r: any, leases: any[]): boolean {
  const mine = (leases || []).filter((l) => l?.renterId === r?.id);
  if (mine.some((l) => OCCUPYING.includes(String(l.status)))) return false;
  return r?.status === 'past' || mine.some((l) => l.status === 'terminated' || (l.status === 'ended' && !!(l.activatedOn || l.activatedAt || l.signedAt || l.signedDocumentUrl || l.stripeSubscriptionId)));
}

export function renterSummary(x: RenterSummaryInput) {
  const today = x.todayIso; const r = x.renter || {};
  const boothName = new Map((x.booths || []).map((b) => [b.id, String(b.name || 'Space')]));
  const mine = (x.leases || []).filter((l) => l.renterId === r.id);
  const holding = mine.filter((l) => OCCUPYING.includes(String(l.status)));
  const running = holding.filter((l) => RUNNING.includes(String(l.status)));
  const signing = holding.find((l) => l.status === 'pending_signature') || null;
  const lease = pickLease(mine, r.id);
  const movedOut = hasMovedOut(r, mine);
  const awayNow = (x.leaves || []).find((v) => v?.renterId === r.id && v.status === 'approved' && day(v.startDate) <= today && day(v.endDate) >= today)
    || (lease?.status === 'on_leave' ? { endDate: '' } : null);
  const space = holding.map((l) => boothName.get(l.boothId) || 'Space').join(', ');
  const invoices = (x.invoices || []).filter((i) => i?.renterId === r.id);
  const ledger = (x.ledger || []).filter((e) => e?.renterId === r.id);
  const owed = renterOwedCents(r.id, invoices, ledger);
  const late = invoices.filter((i) => i?.status === 'late' && invoiceOwedCents(i) > 0);
  // Late: a rent bill marked late, or a one-off charge past its due date and grace (the Rentals home's rule).
  const isLate = owed > 0 && buildRentRollSummary({ booths: [] as any, renters: [r] as any, leases: mine as any, ledger: ledger as any, todayIso: today, cycleStartIso: `${today.slice(0, 7)}-01`, invoices }).pastDueRenterIds.includes(r.id);
  // Ending: the lease shown first; with more than one, any of them (said with its space).
  const endingOf = (l: any) => { const e = leaseEnding(l, today); return e && !e.renews ? { ...e, space: boothName.get(l.boothId) || 'Space' } : null; };
  const ending = (lease && endingOf(lease)) || running.map(endingOf).find(Boolean) || null;
  const pastEnd = running.map((l) => { const p = leasePastEnd(l, today); return p ? { ...p, space: boothName.get(l.boothId) || 'Space' } : null; }).find(Boolean) || null;
  const many = running.length > 1;
  const outlook = lease && lease.status !== 'ended' && lease.status !== 'terminated' ? rentOutlook({ lease, renter: r, invoices, ledger, todayIso: today, businessAccount: x.businessAccount }) : null;
  // Deposits across every lease they've had: one still held after a lease ended is still theirs to settle.
  const deps = mine.map((l) => ({ l, p: depositPosition(l, ledger) }));
  const live = deps.find((d) => d.l.id === lease?.id && !ENDED.includes(String(d.l.status))) || null;
  const heldAll = deps.reduce((t, d) => t + d.p.heldCents, 0);
  const heldOnEnded = deps.filter((d) => ENDED.includes(String(d.l.status))).reduce((t, d) => t + d.p.heldCents, 0);
  const depositsByLease: Record<string, number> = Object.fromEntries(deps.map((d) => [d.l.id, d.p.heldCents]));
  const views = credentialViews(r, x.tenant, today);
  const ins = paperLine(views.find((v) => v.kind === 'insurance'), 'Insurance', holding.length > 0, today);
  const lic = paperLine(views.find((v) => v.kind === 'license'), 'License', holding.length > 0, today);
  const autopay = lease ? autopayReadiness(lease, r, x.businessAccount) : null;
  const pc = portalCell(r, today, holding.length > 0, x.timeZone);
  const portalText = pc.text; const portalWarn = !!pc.warn;
  const year = today.slice(0, 4);
  const billsPaidThisYear = invoices.filter((i) => day(i.dueDate).startsWith(year)).reduce((s, i) => s + (i.status === 'paid' ? n(i.amountCents) + n(i.lateFeeCents) : ['due', 'late'].includes(String(i.status)) ? Math.max(0, n(i.amountCents) + n(i.lateFeeCents) - invoiceOwedCents(i)) : 0), 0);

  const at = (sp: string) => (many ? ` (${sp})` : '');
  const leaseTile: Tile = !lease ? { label: 'Lease', value: 'None' }
    : signing && !running.length ? { label: 'Lease', value: 'Not signed yet', warn: true }
    : pastEnd ? { label: 'Lease', value: `Ended ${monthDay(pastEnd.endDate)}${at(pastEnd.space)}`, warn: true }
    : ending ? { label: 'Lease', value: `Ends ${monthDay(ending.endDate)}${at(ending.space)}`, warn: true }
    : ENDED.includes(String(lease.status)) ? { label: 'Lease', value: 'Ended' }
    : awayNow ? { label: 'Lease', value: awayNow.endDate ? `Time away to ${monthDay(awayNow.endDate)}` : 'On time away' }
    : { label: 'Lease', value: isDay(day(lease.endDate)) ? `To ${longDay(lease.endDate)}` : 'No end date' };
  // The deposit: what the current lease asks and has, else what's still held from one that ended (to settle).
  const lp = live?.p;
  const settledWord = (st: string) => (st === 'forfeited' ? 'Kept' : st === 'returned' ? 'Returned' : st === 'partly_returned' ? 'Partly returned' : '');
  // One still unpaid on any lease they hold now (not just the one shown).
  const unpaidLive = deps.find((d) => d.l.id !== live?.l.id && OCCUPYING.includes(String(d.l.status)) && d.l.status !== 'pending_signature' && d.p.agreedCents > 0 && d.p.collectedCents === 0);
  const depositTile: Tile = heldOnEnded > 0 && (!lp || lp.heldCents === 0) ? { label: 'Deposit', value: `${money(heldOnEnded)} to settle`, warn: true }
    : heldOnEnded > 0 ? { label: 'Deposit', value: `${money(heldAll)} held, ${money(heldOnEnded)} to settle`, warn: true }
    : unpaidLive && !(lp && lp.agreedCents > 0 && lp.collectedCents < lp.agreedCents) ? { label: 'Deposit', value: `${money(unpaidLive.p.agreedCents)} not paid (${boothName.get(unpaidLive.l.boothId) || 'Space'})`, warn: true }
    : lp && lp.agreedCents > 0 && lp.collectedCents === 0 ? { label: 'Deposit', value: `${money(lp.agreedCents)} not paid`, warn: !!lease && lease.status !== 'pending_signature' }
    : lp && lp.agreedCents > 0 && lp.collectedCents < lp.agreedCents && !settledWord(lp.status) ? { label: 'Deposit', value: `${money(lp.collectedCents)} of ${money(lp.agreedCents)} paid`, warn: true }
    : heldAll > 0 ? { label: 'Deposit', value: `${money(heldAll)} held`, ok: true }
    : lp && settledWord(lp.status) ? { label: 'Deposit', value: settledWord(lp.status) }
    : deps.some((d) => settledWord(d.p.status)) ? { label: 'Deposit', value: settledWord(deps.find((d) => settledWord(d.p.status))!.p.status) }
    : { label: 'Deposit', value: 'None' };
  const autopayTile: Tile = { label: 'Autopay', value: autopay === 'ready' ? 'On' : autopay === 'no_card' ? 'No card' : lease && !ENDED.includes(String(lease.status)) ? 'Off' : 'None', ok: autopay === 'ready', warn: autopay === 'no_card' && r.autopayEnabled === true };

  // The one thing that needs doing about them, most pressing first; anything else in amber comes after.
  let status: { text: string; warn: boolean } = { text: movedOut ? 'Moved out' : holding.length ? 'All in order' : 'No lease yet', warn: false };
  const oldest = late.map((i) => day(i.dueDate)).filter(isDay).sort()[0];
  if (isLate) status = { text: oldest ? `Rent late since ${monthDay(oldest)}` : 'A charge is late', warn: true };
  else if (signing && !running.length) status = { text: 'Hasn’t signed their lease yet', warn: true };
  else if (pastEnd) status = { text: `Lease ended ${monthDay(pastEnd.endDate)}${at(pastEnd.space)} and is still running`, warn: true };
  else if (ending) status = { text: `Lease ends ${monthDay(ending.endDate)}${at(ending.space)} and doesn’t renew`, warn: true };
  else if (ins.warn || lic.warn) { const t = [ins.warn ? `insurance ${lcFirst(ins.value)}` : '', lic.warn ? `license ${lcFirst(lic.value)}` : ''].filter(Boolean).join(', '); status = { text: t.charAt(0).toUpperCase() + t.slice(1), warn: true }; }
  else if (depositTile.warn) status = { text: `Deposit ${lcFirst(depositTile.value)}`, warn: true };
  else if (autopayTile.warn) status = { text: 'Autopay is on but has no card to charge', warn: true };
  else if (portalWarn) status = { text: 'Hasn’t opened their portal yet', warn: true };
  else if (!holding.length && !movedOut) status = { text: 'No lease yet', warn: true };

  const tiles: Tile[] = [
    { label: 'Owes', value: money(owed), warn: isLate },
    { label: 'Next bill', value: outlook?.nextDue ? `${money(outlook.nextAfterCreditsCents)} · ${monthDay(outlook.nextDue)}` : 'None' },
    leaseTile, depositTile, autopayTile,
    { label: 'Portal', value: portalText, warn: portalWarn },
  ];

  // The lease
  const leaseLines: Line[] = [];
  if (lease) {
    if (lease.status === 'pending_signature') {
      const doc = (x.documents || []).filter((d) => d?.kind === 'lease' && d?.leaseId === lease.id && d?.status === 'sent')[0];
      leaseLines.push({ label: 'Signed', value: doc ? `Sent ${monthDay(day(doc.sentAt))}, not signed yet` : 'Not sent yet', warn: true });
    } else if (lease.signedAt) leaseLines.push({ label: 'Signed', value: `${lease.signedByName ? `By ${lease.signedByName}, ` : ''}${longDay(lease.signedAt)}` });
    else if (lease.signedDocumentUrl) leaseLines.push({ label: 'Signed', value: 'On paper, copy on file' });
    if (lease.businessSignature?.name) leaseLines.push({ label: 'Your signature', value: `${lease.businessSignature.name}, ${longDay(lease.businessSignature.at)}` });
    leaseLines.push({ label: 'Made from', value: lease.leaseFrom === 'builder' ? `Your lease settings, version ${n(lease.leaseVersion) || 1}` : lease.leaseFrom === 'own' ? 'Your own lease' : 'Set up by hand' });
    const e = day(lease.endDate);
    leaseLines.push({ label: 'Term', value: `${isDay(day(lease.startDate)) ? longDay(lease.startDate) : 'Start not set'} to ${isDay(e) ? longDay(e) : 'no end date'}${isDay(e) ? (lease.autoRenew ? ', renews' : ', ends') : ''}`, warn: !!(ending || pastEnd) });
    const f = String(lease.frequency || 'monthly');
    const lf = lease.lateFeePolicy || {};
    const fee = lf.enabled ? `, ${lf.type === 'percent' ? `${n(lf.percent)}%` : money(n(lf.amountCents))} late fee after ${n(lf.graceDays)} day${n(lf.graceDays) === 1 ? '' : 's'}` : '';
    leaseLines.push({ label: 'Rent', value: `${money(n(lease.rentAmountCents))} ${f === 'monthly' && n(lease.dueDay) >= 1 ? `on the ${ordinal(n(lease.dueDay))}` : PER[f] || f}${fee}` });
    leaseLines.push({ label: 'Space', value: boothName.get(lease.boothId) || 'Space' });
    // Their other leases, each in a line.
    for (const o of holding.filter((l) => l.id !== lease.id)) {
      const oe = day(o.endDate);
      leaseLines.push({ label: 'Also rents', value: `${boothName.get(o.boothId) || 'Space'}${o.status === 'pending_signature' ? ', not signed yet' : isDay(oe) ? `, to ${longDay(oe)}${o.autoRenew ? ', renews' : ''}` : ''}`, warn: o.status === 'pending_signature' || !!endingOf(o) });
    }
  }

  // Money
  const moneyLines: Line[] = [
    { label: 'Balance', value: owed > 0 ? `${money(owed)}${isLate ? ', late' : ''}` : '$0', warn: isLate },
  ];
  if (outlook?.nextDue) moneyLines.push({ label: 'Next bill', value: `${money(outlook.nextAfterCreditsCents)} on ${monthDay(outlook.nextDue)}, ${outlook.autopayOn ? 'by autopay' : 'paid by them'}${outlook.creditCents > 0 ? `, after ${money(Math.min(outlook.creditCents, outlook.nextRentCents))} credit` : ''}` });
  if (depositTile.value !== 'None') moneyLines.push({ label: 'Deposit', value: depositTile.value, warn: depositTile.warn });
  moneyLines.push({ label: `Rent bills paid, ${year}`, value: money(billsPaidThisYear) });

  // Insurance and paperwork
  const w9: Line = x.w9OnFile === true ? { label: 'W-9', value: 'On file', ok: true } : x.w9OnFile === false ? { label: 'W-9', value: 'Not on file' } : { label: 'W-9', value: 'Not known' };
  const addr = String(r.noticeAddress || lease?.leaseTermsSnapshot?.noticeAddress || '').trim();
  const papers: Line[] = [ins, lic, w9, { label: 'Address for notices', value: addr || 'Not given', warn: !addr && holding.length > 0 }];

  // Their business
  const concerns = (x.grievances || []).filter((g) => g?.renterId === r.id && ['open', 'acknowledged'].includes(String(g.status))).length;
  const repairs = (x.tickets || []).filter((t) => (t?.reporter?.renterId === r.id || (lease && t?.boothId === lease.boothId)) && ['open', 'in_progress'].includes(String(t.status))).length;
  const away = (x.leaves || []).filter((v) => v?.renterId === r.id && (v.status === 'requested' || (v.status === 'approved' && day(v.endDate) >= today))).length;
  const items = [concerns ? `${concerns} concern${concerns === 1 ? '' : 's'}` : 'no concerns', repairs ? `${repairs} repair${repairs === 1 ? '' : 's'}` : 'no repairs', away ? 'time away' : 'no time away'];
  const business: Line[] = [
    { label: 'Bookings', value: r.bookingMode === 'own' ? 'Their own booking system' : x.provider ? (x.provider.active === false && x.provider.isActive !== false ? 'On your booking page, hours not set' : 'On your booking page') : 'Not set up', warn: r.bookingMode !== 'own' && !x.provider && running.length > 0 },
    { label: 'Portal', value: portalText, warn: portalWarn },
    { label: 'Open items', value: items.join(', ').replace(/^./, (c) => c.toUpperCase()), warn: concerns > 0 },
  ];

  // Working relationship: settings that make a renter look like staff, against what their lease says (they run their
  // own business, set their own prices and hours, keep their earnings; no commission, split or wage either way). Each
  // is a setting here to change, not a judgment: the business and its attorney decide.
  const relationship = workingRelationship(r, x.provider, lease);

  const initials = `${String(r.firstName || '').charAt(0)}${String(r.lastName || '').charAt(0)}`.toUpperCase() || '?';
  return {
    name: nameOf(r), initials, sub: [r.businessName || r.specialty, space].filter(Boolean).join(' · '), status,
    tiles, lease: leaseLines, money: moneyLines, papers, business, relationship, providerId: x.provider?.id || null,
    leaseId: lease?.id || null, holding: holding.length > 0, movedOut, owedCents: owed, late: isLate, depositHeldCents: heldAll, depositsByLease,
  };
}

const PAY_WORDS: Record<string, string> = { commission: 'a commission on their services', hourly: 'an hourly wage', salary: 'a salary', hourly_plus_commission: 'an hourly wage and commission', per_service: 'a set amount per service' };
const pos = (v: any) => Number(v) > 0;

/** Does their booking record actually pay them for their work? A record can carry a pay type with no rate (a team
 *  record saved with its defaults); commission on retail they sell isn't pay for their work, so it isn't counted. */
function paysThem(p: any): boolean {
  const k = String(p?.payStructure || 'none');
  if (k === 'commission') return pos(p.commissionRate);
  if (k === 'hourly') return pos(p.hourlyRate);
  if (k === 'salary') return pos(p.salaryAmount) || pos(p.salary) || pos(p.annualSalary) || pos(p.salaryWeekly);
  if (k === 'hourly_plus_commission') return pos(p.hourlyRate) || pos(p.commissionRate);
  if (k === 'per_service') return pos(p.serviceHourRate) || Object.values(p.servicePay || {}).some(pos);
  return false;
}

/** What could make a renter look like staff, as lines to check (amber); none when nothing does. */
export function workingRelationship(r: any, provider: any, lease: any): Line[] {
  const out: Line[] = [];
  if (provider && paysThem(provider)) out.push({ label: 'Pay', value: `Their booking record pays them ${PAY_WORDS[String(provider.payStructure)]}. A renter keeps what they earn and isn’t paid by you.`, warn: true });
  const model = String(provider?.employmentModel || '');
  if (provider && (model === 'employee' || model === 'commission')) out.push({ label: 'Team record', value: model === 'employee' ? 'Their booking record says they’re an employee.' : 'Their booking record says they work for commission.', warn: true });
  if (r?.linkedStaffId) out.push({ label: 'Also staff', value: 'They’re also on your team. That’s fine; keep the two apart: no pay from you for their renting work, and no rent for their staff work.' });
  if (lease && lease.leaseFrom !== 'builder' && !out.some((l) => l.warn)) out.push({ label: 'Lease', value: 'Made outside the lease builder. Check it says they run their own business.' });
  return out;
}
