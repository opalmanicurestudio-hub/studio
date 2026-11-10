// src/lib/renters-roster.ts — THE RENTERS LIST, BY STAGE. One row per renter for the Renters page
// (components/renters/RentersRoster): their space, their lease in a few words, what they owe, autopay, insurance,
// license and portal, each in amber when something needs doing, with where to go to fix it. The stages (current,
// new, signing, ending soon, time away, past, missing something) are filters with counts. The lease, papers and
// money rules are the shared ones (lib/rentals-home, lib/compliance, lib/booth-rental-types), so the Renters page
// says what the Rentals home says. Pure: no database.
import { OCCUPYING, RUNNING, leaseEnding, leasePastEnd, monthDay, money, nameOf, dayDiff } from '@/lib/rentals-home';
import { renterOwedCents, invoiceOwedCents, buildRentRollSummary } from '@/lib/booth-rental-types';
import { dayKey } from '@/lib/tenant-time';
import { credentialViews, type CredentialView } from '@/lib/compliance';
import { autopayReadiness } from '@/lib/rent-schedule';

const day = (v: any) => String(v || '').slice(0, 10);
const isDay = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v);
const monthYear = (iso: string) => { const d = new Date(`${day(iso)}T12:00:00Z`); return isNaN(d.getTime()) ? '' : d.toLocaleDateString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' }); };
const longDay = (iso: string) => { const d = new Date(`${day(iso)}T12:00:00Z`); return isNaN(d.getTime()) ? '' : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }); };

export type RosterStage = 'current' | 'new' | 'signing' | 'ending' | 'away' | 'past' | 'missing';
export const ROSTER_STAGES: { key: RosterStage; label: string }[] = [
  { key: 'current', label: 'Current' }, { key: 'new', label: 'New' }, { key: 'signing', label: 'Signing' }, { key: 'ending', label: 'Ending soon' },
  { key: 'away', label: 'Time away' }, { key: 'past', label: 'Past' }, { key: 'missing', label: 'Missing something' },
];

export interface RosterCell { text: string; warn?: boolean; href?: string }
export interface RosterRow {
  id: string; name: string; specialty: string; stages: RosterStage[]; missing: string[];
  space: string; lease: RosterCell; balance: RosterCell; autopay: RosterCell; insurance: RosterCell; license: RosterCell; portal: RosterCell;
  /** Most pressing first: what sorts the list. */
  attention: number;
}

function paper(v: CredentialView | undefined, today: string): RosterCell {
  if (!v) return { text: 'Not needed' };
  if (v.state === 'expired') return { text: 'Expired', warn: true };
  if (v.state === 'expiring') return { text: v.daysLeft === 0 ? 'Ends today' : `Ends in ${v.daysLeft} day${v.daysLeft === 1 ? '' : 's'}`, warn: true };
  if (v.state === 'missing') return v.required ? { text: 'Not on file', warn: true } : { text: 'Not needed' };
  return { text: v.expiry && isDay(day(v.expiry)) && day(v.expiry) > today ? `To ${monthYear(v.expiry)}` : 'On file' };
}

export interface RosterInput {
  todayIso: string; tenant: any; renters: any[]; leases: any[]; booths: any[]; invoices: any[]; ledger: any[];
  leaves?: any[]; businessAccount?: string | null;
  /** The business's time zone, for the day a moment (like their last portal visit) falls on. */
  timeZone?: string | null;
}

/** The business's day for a moment it stored (an ISO time), or '' when there isn't one. */
export function localDayOf(iso: any, timeZone?: string | null): string {
  const d = new Date(String(iso || '')); if (!iso || isNaN(d.getTime())) return '';
  try { return dayKey(d, timeZone); } catch { return String(iso).slice(0, 10); }
}

/** When they last used their portal, in a few words: one rule for the Renters list and the renter's own page. */
export function portalCell(r: any, today: string, holding: boolean, timeZone?: string | null): RosterCell {
  const seen = localDayOf(r?.portalLastSeenAt || (r?.portalInviteStatus === 'accepted' ? r?.portalFirstSeenAt : ''), timeZone);
  if (isDay(seen)) return { text: seen >= today ? 'Used today' : `Used ${monthDay(seen)}` };
  if (r?.portalInviteStatus === 'accepted') return { text: 'Used' };
  if (r?.portalInviteStatus === 'sent') return { text: 'Link sent, not opened', warn: holding };
  return { text: 'Never opened', warn: holding };
}

export function rentersRoster(x: RosterInput) {
  const today = x.todayIso;
  // Late: a rent bill marked late, or a one-off charge past its due date and grace (the Rentals home's rule).
  const lateIds = new Set(buildRentRollSummary({ booths: (x.booths || []) as any, renters: (x.renters || []) as any, leases: (x.leases || []) as any, ledger: (x.ledger || []) as any, todayIso: today, cycleStartIso: `${today.slice(0, 7)}-01`, invoices: x.invoices || [] }).pastDueRenterIds);
  const boothName = new Map((x.booths || []).map((b) => [b.id, String(b.name || 'Space')]));
  const rows: RosterRow[] = [];
  for (const r of x.renters || []) {
    if (r.status === 'archived') continue;
    const href = `/renters?renter=${encodeURIComponent(r.id)}`;
    const mine = (x.leases || []).filter((l) => l.renterId === r.id);
    const holding = mine.filter((l) => OCCUPYING.includes(String(l.status)));
    const running = holding.filter((l) => RUNNING.includes(String(l.status)));
    const signing = holding.find((l) => l.status === 'pending_signature') || null;
    const lease = running[0] || signing || null;
    const stages: RosterStage[] = [];
    const missing: string[] = [];

    const awayNow = (x.leaves || []).find((v) => v.renterId === r.id && v.status === 'approved' && day(v.startDate) <= today && day(v.endDate) >= today)
      || (running.some((l) => l.status === 'on_leave') ? { endDate: '' } : null);
    const ending = running.map((l) => leaseEnding(l, today)).find((e) => e && !e.renews) || null;
    const pastEnd = running.map((l) => leasePastEnd(l, today)).find(Boolean) || null;

    // Someone without a lease now is past if they've had one (or are marked so), and new if they never have.
    // Had one: a lease that actually ran (one taken back before it was signed doesn't count).
    const hadOne = mine.some((l) => l.status === 'terminated' || (l.status === 'ended' && !!(l.activatedOn || l.activatedAt || l.signedAt || l.signedDocumentUrl || l.stripeSubscriptionId)));
    const isPast = !holding.length && (r.status === 'past' || hadOne);
    if (running.length) stages.push('current');
    if (signing) stages.push('signing');
    if (!holding.length && !isPast) stages.push('new');
    if (isPast) stages.push('past');
    if (ending || pastEnd) stages.push('ending');
    if (awayNow) stages.push('away');

    // Lease
    let leaseCell: RosterCell;
    if (!holding.length) leaseCell = isPast ? { text: 'Moved out' } : { text: 'No lease yet', warn: true, href: `/booths?lease=${encodeURIComponent(r.id)}` };
    else if (signing && !running.length) leaseCell = { text: 'Not signed yet', warn: true, href };
    else if (pastEnd) leaseCell = { text: `Ended ${monthDay(pastEnd.endDate)}`, warn: true, href };
    else if (ending) leaseCell = { text: ending.days === 0 ? 'Ends today' : `Ends ${monthDay(ending.endDate)}`, warn: true, href };
    else if (awayNow) leaseCell = { text: awayNow.endDate ? `Time away to ${monthDay(awayNow.endDate)}` : 'On time away' };
    else { const e = day(lease?.endDate); leaseCell = { text: isDay(e) ? `To ${longDay(e)}` : 'No end date' }; }

    // Balance
    const owed = renterOwedCents(r.id, x.invoices || [], x.ledger || []);
    const lateBills = (x.invoices || []).filter((i) => i?.renterId === r.id && i?.status === 'late' && invoiceOwedCents(i) > 0);
    const isLate = owed > 0 && lateIds.has(r.id);
    const oldest = lateBills.map((i) => day(i.dueDate)).filter(isDay).sort()[0];
    const balance: RosterCell = owed <= 0 ? { text: '$0' } : isLate ? { text: `${money(owed)} late`, warn: true, href: `/rent?pay=${encodeURIComponent(r.id)}` } : { text: `${money(owed)} due` };

    // Autopay: only for someone a lease bills.
    let autopay: RosterCell = { text: 'None' };
    if (lease) {
      const a = autopayReadiness(lease, r, x.businessAccount);
      autopay = a === 'ready' ? { text: 'On' } : a === 'no_card' ? { text: 'No card', warn: r.autopayEnabled === true, href } : { text: 'Off' };
    }

    // Papers: asked of anyone with a lease running or being signed.
    const views = credentialViews(r, x.tenant, today);
    const ins = views.find((v) => v.kind === 'insurance'); const lic = views.find((v) => v.kind === 'license');
    const insurance = holding.length ? { ...paper(ins, today) } : { text: ins?.docUrl || ins?.expiry ? paper(ins, today).text : 'None' };
    const license = holding.length ? { ...paper(lic, today) } : { text: lic?.docUrl || lic?.expiry ? paper(lic, today).text : 'None' };
    if (holding.length) {
      if (insurance.warn) { insurance.href = href; missing.push(`insurance ${insurance.text.toLowerCase()}`); }
      if (license.warn) { license.href = href; missing.push(`license ${license.text.toLowerCase()}`); }
    } else { delete (insurance as any).warn; delete (license as any).warn; }

    // Portal
    const portal: RosterCell = portalCell(r, today, holding.length > 0, x.timeZone);
    if (portal.warn) portal.href = href;
    if (portal.warn) missing.push('portal not opened');
    if (holding.length && autopay.warn) missing.push('autopay has no card');
    if (missing.length) stages.push('missing');

    const space = holding.map((l) => boothName.get(l.boothId) || 'Space').join(', ');
    const attention = (balance.warn ? 0 : 10) + (leaseCell.warn ? 0 : 5) + (missing.length ? 0 : 3) + (oldest ? -Math.min(9, dayDiff(today, oldest)) / 10 : 0);
    rows.push({ id: r.id, name: nameOf(r), specialty: String(r.specialty || r.businessName || ''), stages, missing, space, lease: leaseCell, balance, autopay, insurance, license, portal, attention });
  }
  rows.sort((a, b) => a.attention - b.attention || a.name.localeCompare(b.name));
  const chips = ROSTER_STAGES.map((s) => ({ ...s, count: rows.filter((r) => r.stages.includes(s.key)).length }));
  return { rows, chips };
}
