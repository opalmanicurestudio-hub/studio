// src/lib/rentals-home.ts — THE RENTALS HOME, WORKED OUT IN ONE PLACE. What the owner sees first when they open
// Rentals (app/(app)/rentals, served by api/renters/home): how full the spaces are, what rent comes in, what's owed and
// held, one list of what needs them, leases ending soon, and today at the spaces.
//
// It also holds the two rules the Rentals pages share, so they can't disagree:
//   • spaceStates: a space is taken when a lease holds it (one being signed counts), open when nothing does, being
//     repaired when it's marked so, and left out when it's switched off. A guest checked in for the day doesn't make a
//     space taken: occupancy is about leases.
//   • leaseEnding: a running lease with an end date inside the window. It needs the owner when it doesn't renew on its
//     own (LEASE_NEEDS_YOU_DAYS); the Home lists every one ending in the next LEASE_ENDING_LIST_DAYS. One still running
//     after its end date needs them too (leasePastEnd).
// The lease statuses are the ones lib/booth-rental-service uses (OCCUPYING_LEASE_STATUSES, BILLABLE_LEASE_STATUSES);
// that file talks to the database from the browser, so they're repeated here and a check keeps them the same.
// Pure: no database, so the route and the checks run the same code.
import { invoiceOwedCents, renterOwedCents, buildRentRollSummary, isOpenLedgerCharge } from '@/lib/booth-rental-types';
import { depositPosition } from '@/lib/deposit-accounting';
import { credentialViews, isProblem, CREDENTIAL_LABEL } from '@/lib/compliance';
import { GRIEVANCE_CATEGORY_LABEL } from '@/lib/grievances';
import { ticketAcknowledged, isTicketOverdue, TICKET_PRIORITY_LABELS } from '@/lib/maintenance';

/** A lease that holds its space: running, away, or sent and waiting to be signed. */
export const OCCUPYING = ['active', 'on_leave', 'pending_signature'];
/** A lease that's running: billed, or on time away. */
export const RUNNING = ['active', 'on_leave'];
/** A lease that's billed now (time away pauses or reduces rent, so it isn't counted in the rent roll). */
export const BILLING = ['active'];
export const LEASE_NEEDS_YOU_DAYS = 60;
export const LEASE_ENDING_LIST_DAYS = 90;

const n = (v: any) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const day = (v: any) => String(v || '').slice(0, 10);
const isDay = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v);
export const dayDiff = (a: string, b: string): number => Math.round((Date.parse(`${day(a)}T12:00:00Z`) - Date.parse(`${day(b)}T12:00:00Z`)) / 86_400_000);
export const plusDays = (iso: string, d: number) => { const x = new Date(`${day(iso)}T12:00:00Z`); x.setUTCDate(x.getUTCDate() + d); return x.toISOString().slice(0, 10); };
/** 2026-12-31 → Dec 31 */
export const monthDay = (iso: string) => { const d = new Date(`${day(iso)}T12:00:00Z`); return isNaN(d.getTime()) ? String(iso || '') : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }); };
/** A moment (an ISO time) → its day in the business's time zone, Dec 31. */
export const momentDay = (iso: string, timeZone?: string | null) => { const d = new Date(String(iso || '')); if (isNaN(d.getTime())) return ''; try { return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: timeZone || 'UTC' }); } catch { return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }); } };
export const money = (cents: number) => `$${(Math.round(cents) / 100).toLocaleString('en-US', { minimumFractionDigits: cents % 100 === 0 ? 0 : 2, maximumFractionDigits: 2 })}`;
export const nameOf = (r: any) => `${r?.firstName || ''} ${r?.lastName || ''}`.trim() || String(r?.name || r?.renterName || 'Renter');
const plural = (k: number, one: string, many = `${one}s`) => `${k} ${k === 1 ? one : many}`;

/** Rent at its frequency → a month of it. */
export const PER_MONTH: Record<string, number> = { daily: 30, weekly: 52 / 12, biweekly: 26 / 12, monthly: 1 };
export const monthlyCents = (cents: number, freq: string) => Math.round(n(cents) * (PER_MONTH[String(freq || 'monthly')] ?? 1));

/** What an open space would bring in a month at its asking rent: a monthly price, else its long-term rent, else a day
 *  or hourly rate over a five-day week. */
export function askingMonthlyCents(b: any): number {
  const opts: any[] = Array.isArray(b?.pricingOptions) ? b.pricingOptions : [];
  const opt = (f: string) => opts.find((o) => o?.frequency === f && n(o.amountCents) > 0);
  const mo = opt('monthly'); if (mo) return n(mo.amountCents);
  if (n(b?.baseRentCents) > 0 && b?.baseRentFrequency !== 'hourly') return monthlyCents(b.baseRentCents, b.baseRentFrequency || 'monthly');
  const wk = opt('weekly'); if (wk) return monthlyCents(wk.amountCents, 'weekly');
  const dy = opt('daily') || (n(b?.dayUseDailyCents) > 0 ? { amountCents: b.dayUseDailyCents } : null);
  if (dy) return Math.round(n(dy.amountCents) * 5 * 52 / 12);
  const hr = opt('hourly') || (n(b?.dayUseHourlyCents) > 0 ? { amountCents: b.dayUseHourlyCents } : null);
  return hr ? Math.round(n(hr.amountCents) * 8 * 5 * 52 / 12) : 0;
}

export type SpaceState = 'taken' | 'shared' | 'open' | 'repair' | 'off';
export const SPACE_STATE_LABEL: Record<SpaceState, string> = { taken: 'Leased', shared: 'Shared', open: 'Open', repair: 'Being repaired', off: 'Not rented' };

/** A lease that has its space on some days of the week only. */
export const isSharedLease = (l: any) => !!(l?.isShared || (Array.isArray(l?.scheduleDays) && l.scheduleDays.length > 0 && l.scheduleDays.length < 7));

/** One rule for every Rentals page: what state each space is in, and the lease that holds it. */
export function spaceStates(booths: any[], leases: any[]): Map<string, { state: SpaceState; lease: any | null; leases: any[] }> {
  const holding = new Map<string, any[]>();
  for (const l of leases || []) {
    if (!l?.boothId || !OCCUPYING.includes(String(l.status))) continue;
    holding.set(l.boothId, [...(holding.get(l.boothId) || []), l]);
  }
  const m = new Map<string, { state: SpaceState; lease: any | null; leases: any[] }>();
  for (const b of booths || []) {
    const ls = holding.get(b.id) || [];
    let state: SpaceState;
    if (b.status === 'inactive') state = 'off';
    else if (ls.length) state = ls.every(isSharedLease) ? 'shared' : 'taken';
    else if (b.status === 'maintenance') state = 'repair';
    else state = 'open';
    m.set(b.id, { state, lease: ls[0] || null, leases: ls });
  }
  return m;
}

/** How full the spaces are: counted spaces are every one not switched off. */
export function occupancy(booths: any[], leases: any[]) {
  const st = spaceStates(booths, leases);
  const counted = (booths || []).filter((b) => st.get(b.id)!.state !== 'off');
  const held = counted.filter((b) => ['taken', 'shared'].includes(st.get(b.id)!.state));
  const open = counted.filter((b) => st.get(b.id)!.state === 'open');
  const repair = counted.filter((b) => st.get(b.id)!.state === 'repair');
  return {
    total: counted.length, occupied: held.length, open: open.length, repair: repair.length,
    openDayUse: open.filter((b) => b.dayUseEnabled === true).length,
    pct: counted.length ? Math.round((held.length / counted.length) * 100) : 0,
    openMonthlyCents: open.reduce((s, b) => s + askingMonthlyCents(b), 0),
  };
}

/** A running lease still going after its end date (the nightly renewal didn't happen, or nobody ended it). */
export function leasePastEnd(l: any, todayIso: string): { endDate: string; days: number } | null {
  const end = day(l?.endDate);
  if (!isDay(end) || !RUNNING.includes(String(l?.status))) return null;
  const days = dayDiff(todayIso, end);
  return days > 0 ? { endDate: end, days } : null;
}

/** Who a new lease can be written for: anyone not holding a space now (at any location), prospects first, never an
 *  archived record. `leases` must be every lease, so someone holding a space elsewhere isn't offered. */
export function leaseableRenters(renters: any[], leases: any[]) {
  const holding = new Set((leases || []).filter((l) => OCCUPYING.includes(String(l.status))).map((l) => l.renterId));
  const order: Record<string, number> = { prospective: 0, active: 1, past: 2 };
  return (renters || []).filter((r) => !holding.has(r.id) && r.status !== 'archived')
    .sort((a, b) => (order[a.status] ?? 3) - (order[b.status] ?? 3) || nameOf(a).localeCompare(nameOf(b)))
    .map((r) => ({ id: r.id, name: nameOf(r), status: String(r.status || '') }));
}

/** A running lease ending within `windowDays` (today counts), with whether it renews by itself. */
export function leaseEnding(l: any, todayIso: string, windowDays = LEASE_NEEDS_YOU_DAYS): { endDate: string; days: number; renews: boolean } | null {
  const end = day(l?.endDate);
  if (!isDay(end) || !RUNNING.includes(String(l?.status))) return null;
  const days = dayDiff(end, todayIso);
  if (days < 0 || days > windowDays) return null;
  return { endDate: end, days, renews: l?.autoRenew === true };
}

export type NeedKind = 'late' | 'signature' | 'papers' | 'ending' | 'concern' | 'repair' | 'message' | 'time_away' | 'application';
export interface NeedAction { label: string; href: string; primary?: boolean }
export interface NeedItem { id: string; kind: NeedKind; rank: number; title: string; detail: string; actions: NeedAction[] }

const renterHref = (id: string) => `/renters/${encodeURIComponent(id)}`;

export interface RentalsHomeInput {
  todayIso: string; nowIso: string; tenant: any;
  /** The business's time zone, for the day a moment falls on. */
  timeZone?: string | null;
  /** Every lease at every location, to know who already holds a space somewhere (defaults to `leases`). */
  allLeases?: any[];
  booths: any[]; leases: any[]; renters: any[]; invoices: any[]; ledger: any[];
  documents?: any[]; grievances?: any[]; threads?: any[]; tickets?: any[]; leaves?: any[]; applications?: any[];
  reservations?: any[]; interruptions?: any[];
}

export function rentalsHome(x: RentalsHomeInput) {
  const today = x.todayIso; const monthStart = `${today.slice(0, 7)}-01`;
  const booths = x.booths || []; const leases = x.leases || []; const renters = x.renters || [];
  const invoices = x.invoices || []; const ledger = x.ledger || [];
  const boothName = new Map(booths.map((b) => [b.id, String(b.name || 'Space')]));
  const renterById = new Map(renters.map((r) => [r.id, r]));
  const running = leases.filter((l) => RUNNING.includes(String(l.status)));
  const spaceOfRenter = (rid: string) => {
    const ls = leases.filter((l) => l.renterId === rid && OCCUPYING.includes(String(l.status)));
    return ls.map((l) => boothName.get(l.boothId) || 'Space').join(', ');
  };
  const withSpace = (s: string, rid: string) => { const sp = spaceOfRenter(rid); return sp ? `${s} · ${sp}` : s; };

  // ── The numbers ──
  const occ = occupancy(booths, leases);
  const billing = leases.filter((l) => BILLING.includes(String(l.status)));
  const onTimeAway = running.filter((l) => !BILLING.includes(String(l.status)));
  const rentRollCents = billing.reduce((s, l) => s + monthlyCents(l.rentAmountCents, l.frequency), 0);
  const roll = buildRentRollSummary({ booths: booths as any, renters: renters as any, leases: leases as any, ledger: ledger as any, todayIso: today, cycleStartIso: monthStart, invoices });
  // This month's rent: the bills that came due from the 1st to today, and how much of them is paid. Like with like:
  // a payment on last month's late bill shows as less owed, not as this month's rent.
  // A voided or waived bill isn't rent due.
  const monthBills = invoices.filter((i) => ['due', 'late', 'paid'].includes(String(i?.status)) && day(i?.dueDate) >= monthStart && day(i?.dueDate) <= today);
  const dueSoFarCents = monthBills.reduce((s, i) => s + n(i.amountCents) + n(i.lateFeeCents), 0);
  const paidSoFarCents = monthBills.reduce((s, i) => s + (i.status === 'paid' ? n(i.amountCents) + n(i.lateFeeCents) : Math.max(0, n(i.amountCents) + n(i.lateFeeCents) - invoiceOwedCents(i))), 0);
  // Owed: what's left on rent bills and one-off charges, by the same rule as each renter's own balance (a deposit isn't
  // rent: it's held on its own and shows under Deposits).
  const owedCents = invoices.reduce((s, i) => s + invoiceOwedCents(i), 0)
    + ledger.filter((e) => isOpenLedgerCharge(e) && !String(e?.type || '').startsWith('deposit_')).reduce((s, e) => s + n(e.amountCents), 0);
  const deposits = leases.map((l) => depositPosition(l, ledger)).filter((p) => p.heldCents > 0);
  const lateIds = roll.pastDueRenterIds.filter((id) => renterOwedCents(id, invoices, ledger) > 0);
  const monthName = new Date(`${today}T12:00:00Z`).toLocaleDateString('en-US', { month: 'long', timeZone: 'UTC' });
  const kpis = [
    { key: 'occupied', label: 'Occupied', value: `${occ.occupied} of ${occ.total}`,
      sub: occ.total ? `${occ.pct}% · ${occ.open} open${occ.openDayUse ? `, ${occ.openDayUse} taking day bookings` : ''}${occ.repair ? `, ${occ.repair} being repaired` : ''}` : 'No spaces yet' },
    { key: 'roll', label: 'Rent roll', value: money(rentRollCents), sub: billing.length ? `a month, from ${plural(billing.length, 'lease')}${onTimeAway.length ? `, not counting ${onTimeAway.length} on time away` : ''}` : onTimeAway.length ? `${plural(onTimeAway.length, 'lease')} on time away` : 'No leases running' },
    { key: 'collected', label: `${monthName} rent paid`, value: money(paidSoFarCents), sub: dueSoFarCents ? `of ${money(dueSoFarCents)} due so far` : 'Nothing due yet this month' },
    { key: 'owed', label: 'Owed', value: money(owedCents), warn: lateIds.length > 0, sub: lateIds.length ? `${plural(lateIds.length, 'renter')} late` : owedCents ? 'Nobody is late' : 'Everyone is paid up' },
    { key: 'deposits', label: 'Deposits held', value: money(deposits.reduce((s, p) => s + p.heldCents, 0)), sub: deposits.length ? `across ${plural(deposits.length, 'lease')}` : 'None held' },
    { key: 'open', label: 'Open spaces', value: money(occ.openMonthlyCents), sub: occ.open ? 'a month not coming in' : occ.total ? 'Every space is taken' : 'No spaces yet' },
  ];

  // ── Needs you ──
  const items: NeedItem[] = [];
  for (const rid of lateIds) {
    const r = renterById.get(rid); const owed = renterOwedCents(rid, invoices, ledger);
    const mine = invoices.filter((i) => i?.renterId === rid && i?.status === 'late' && invoiceOwedCents(i) > 0);
    const oldest = mine.map((i) => day(i.dueDate)).filter(isDay).sort()[0];
    const daysLate = oldest ? Math.max(1, dayDiff(today, oldest)) : 0;
    const fees = mine.some((i) => n(i.lateFeeCents) > 0);
    items.push({ id: `late-${rid}`, kind: 'late', rank: 10 - Math.min(9, daysLate) / 10,
      title: `${nameOf(r)} · rent ${daysLate ? `${plural(daysLate, 'day')} late` : 'late'}`,
      detail: withSpace(`${money(owed)} owed${fees ? ', including late fees' : ''}`, rid),
      actions: [{ label: 'Message', href: `${renterHref(rid)}?tab=messages` }, { label: 'Record payment', href: `/rent?pay=${encodeURIComponent(rid)}`, primary: true }] });
  }
  for (const l of leases.filter((l) => l.status === 'pending_signature')) {
    const r = renterById.get(l.renterId);
    const doc = (x.documents || []).filter((d) => d?.kind === 'lease' && d?.leaseId === l.id && d?.status === 'sent').sort((a, b) => String(b.sentAt || '').localeCompare(String(a.sentAt || '')))[0];
    const sent = day(doc?.sentAt);
    const waited = isDay(sent) ? dayDiff(today, sent) : null;
    items.push({ id: `sign-${l.id}`, kind: 'signature', rank: waited !== null && waited >= 3 ? 30 : 60,
      title: doc ? `${nameOf(r)} hasn’t signed their lease` : `${nameOf(r)}’s lease isn’t sent yet`,
      detail: `${doc ? (waited === 0 ? 'Sent today' : waited === 1 ? 'Sent yesterday' : isDay(sent) ? `Sent ${monthDay(sent)}` : 'Sent') : 'Waiting to be sent'} · ${boothName.get(l.boothId) || 'Space'}`,
      actions: [{ label: 'Open', href: renterHref(l.renterId) }] });
  }
  const leasedRenters = new Set(running.map((l) => l.renterId));
  for (const r of renters) {
    if (!leasedRenters.has(r.id)) continue;
    for (const v of credentialViews(r, x.tenant, today).filter(isProblem)) {
      const what = CREDENTIAL_LABEL[v.kind].toLowerCase();
      const state = v.state === 'expired' ? `${what} expired` : v.state === 'expiring' ? `${what} ${v.daysLeft === 0 ? 'expires today' : `expires in ${plural(n(v.daysLeft), 'day')}`}` : `${what} missing`;
      items.push({ id: `papers-${r.id}-${v.kind}`, kind: 'papers', rank: v.state === 'expired' ? 20 : v.state === 'missing' ? 40 : 50 + n(v.daysLeft) / 100,
        title: `${nameOf(r)} · ${state}`,
        detail: withSpace(v.state === 'missing' ? 'Your lease settings ask for it' : v.state === 'expired' ? `It ran out ${monthDay(String(v.expiry))}` : `On file until ${monthDay(String(v.expiry))}`, r.id),
        actions: [{ label: 'Open', href: renterHref(r.id) }] });
    }
  }
  for (const l of running) {
    const e = leaseEnding(l, today); if (!e || e.renews) continue;
    items.push({ id: `ending-${l.id}`, kind: 'ending', rank: 35 + e.days / 10,
      title: `${nameOf(renterById.get(l.renterId))} · lease ends ${monthDay(e.endDate)}`,
      detail: `Doesn’t renew on its own · ${e.days === 0 ? 'today' : `in ${plural(e.days, 'day')}`} · ${boothName.get(l.boothId) || 'Space'}`,
      actions: [{ label: 'Open', href: renterHref(l.renterId) }] });
  }
  for (const l of running) {
    const p = leasePastEnd(l, today); if (!p) continue;
    items.push({ id: `pastend-${l.id}`, kind: 'ending', rank: 12,
      title: `${nameOf(renterById.get(l.renterId))} · lease ended ${monthDay(p.endDate)}`,
      detail: `Still running · renew it or end it · ${boothName.get(l.boothId) || 'Space'}`,
      actions: [{ label: 'Open', href: renterHref(l.renterId) }] });
  }
  for (const g of (x.grievances || []).filter((g) => g?.status === 'open')) {
    const raised = day(g.filedAt); const ago = isDay(raised) ? dayDiff(today, raised) : null;
    items.push({ id: `concern-${g.id}`, kind: 'concern', rank: 15,
      title: `Concern ${g.ref || ''} · ${(GRIEVANCE_CATEGORY_LABEL as any)[g.category] || 'Other'}`.replace(/\s+·/, ' ·'),
      detail: `${g.renterName || nameOf(renterById.get(g.renterId))} · raised ${ago === null ? 'recently' : ago === 0 ? 'today' : ago === 1 ? 'yesterday' : `${ago} days ago`} · not answered yet`,
      actions: [{ label: 'Reply', href: '/renters?desk=concerns' }] });
  }
  for (const t of (x.threads || []).filter((t) => t?.unreadForOwner === true)) {
    // Only from someone still on the books, as the messages desk shows them.
    const rid = String(t.renterId || t.id || ''); const r = renterById.get(rid); if (!r) continue;
    items.push({ id: `message-${rid}`, kind: 'message', rank: 25, title: `${nameOf(r)} wrote to you`, detail: 'Not read yet',
      actions: [{ label: 'Reply', href: `${renterHref(rid)}?tab=messages` }] });
  }
  for (const t of (x.tickets || []).filter((t) => t?.status === 'open' || t?.status === 'in_progress')) {
    const answered = ticketAcknowledged(t); const late = isTicketOverdue(t, x.nowIso);
    if (answered && !late) continue;
    let when = '';
    if (!answered && t.respondBy) {
      const hrs = Math.round((Date.parse(t.respondBy) - Date.parse(x.nowIso)) / 3_600_000);
      when = hrs < 0 ? 'answer overdue' : hrs < 24 ? `answer due in ${plural(Math.max(1, hrs), 'hour')}` : `answer due ${momentDay(t.respondBy, x.timeZone)}`;
    } else if (!answered) when = late ? `not answered yet · fix was due ${momentDay(t.dueAt, x.timeZone)}` : 'not answered yet';
    else when = `fix was due ${momentDay(t.dueAt, x.timeZone)}`;
    items.push({ id: `repair-${t.id}`, kind: 'repair', rank: t.priority === 'urgent' ? 5 : t.priority === 'high' ? 18 : 45,
      title: `Repair · ${[t.boothName || (t.boothId ? boothName.get(t.boothId) : ''), t.title].filter(Boolean).join(' · ') || 'Untitled'}`,
      detail: `${(TICKET_PRIORITY_LABELS as any)[t.priority] || 'Normal'} · ${when}`,
      actions: [{ label: 'Open', href: '/maintenance' }] });
  }
  for (const l of x.leaves || []) {
    const r = renterById.get(l.renterId); const who = r ? nameOf(r) : String(l.renterName || 'A renter');
    if (l.status === 'requested') items.push({ id: `away-${l.id}`, kind: 'time_away', rank: 28, title: `${who} asked for time away`, detail: `${monthDay(l.startDate)} to ${monthDay(l.endDate)}`, actions: [{ label: 'Review', href: '/rent#time-away' }] });
    if (l.redeem?.status === 'requested') items.push({ id: `redeem-${l.id}`, kind: 'time_away', rank: 32, title: `${who} asked to use banked days`, detail: plural(n(l.redeem.days), 'day'), actions: [{ label: 'Review', href: '/rent#time-away' }] });
  }
  for (const a of (x.applications || []).filter((a) => String(a?.status || 'new') === 'new' && ['application', 'tour', 'question'].includes(String(a?.kind || 'application')))) {
    const kind = String(a.kind || 'application'); const who = String(a.name || 'Someone');
    const title = kind === 'tour' ? `${who} wants to see a space` : kind === 'question' ? `${who} asked about renting` : `${who} applied${a.boothName ? ` for ${a.boothName}` : ''}`;
    const tour = day(a.tourStartIso || a.tourDate);
    const detail = kind === 'tour' ? (isDay(tour) ? `Visit ${monthDay(tour)}` : 'Visit time to confirm') : isDay(day(a.createdAt)) ? `Came in ${monthDay(day(a.createdAt))}` : 'New';
    items.push({ id: `app-${a.id}`, kind: 'application', rank: 55, title, detail, actions: [{ label: 'Review', href: `/pipeline?lead=${encodeURIComponent(a.id)}` }] });
  }
  items.sort((a, b) => a.rank - b.rank || a.title.localeCompare(b.title));

  // ── Leases ending in the next 90 days ──
  const ending = running.map((l) => ({ l, e: leaseEnding(l, today, LEASE_ENDING_LIST_DAYS) })).filter((v) => v.e)
    .sort((a, b) => a.e!.endDate.localeCompare(b.e!.endDate))
    .map(({ l, e }) => ({ leaseId: l.id, renterId: l.renterId, renter: nameOf(renterById.get(l.renterId)), space: boothName.get(l.boothId) || 'Space', endDate: e!.endDate, renews: e!.renews }));

  // ── Today at the spaces ──
  // Guests here today: a booking that started today or earlier and hasn't ended yet (a stay can run several days).
  const guests = (x.reservations || []).filter((r) => day(r.startDate) <= today && day(r.endDate || r.startDate) >= today && ['confirmed', 'checked_in', 'completed'].includes(String(r.status)));
  const closures = (x.interruptions || []).filter((i) => i?.status === 'open' && day(i.startDate) <= today && (!i.endDate || day(i.endDate) >= today));
  const away = new Set((x.leaves || []).filter((l) => l.status === 'approved' && day(l.startDate) <= today && day(l.endDate) >= today).map((l) => l.renterId));
  const todayRows = [
    { label: 'Day and hourly guests', value: guests.length ? `${guests.length}${guests.some((g) => g.status === 'checked_in') ? `, ${guests.filter((g) => g.status === 'checked_in').length} checked in` : ''}` : 'None' },
    { label: 'Open repairs', value: String((x.tickets || []).filter((t) => t?.status === 'open' || t?.status === 'in_progress').length || 'None') },
    { label: 'Closures', value: closures.length ? closures.map((c) => String(c.title || 'Closed')).join(', ') : 'None' },
    { label: 'Renters on time away', value: String(away.size || 'None') },
  ];

  const leaseable = leaseableRenters(renters, x.allLeases || leases);

  return { kpis, needs: items, ending, today: todayRows, leaseable, counts: { spaces: occ.total, renters: renters.filter((r) => r.status !== 'archived').length } };
}
