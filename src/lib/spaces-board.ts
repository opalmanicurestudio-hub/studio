// src/lib/spaces-board.ts — THE SPACES LIST, WORKED OUT IN ONE PLACE. One row per space for the Spaces page's list
// (components/renters/SpacesBoard): its status in words, who has it, when the lease ends, its rent, what it has
// brought in this year and how much of the last twelve months it was in use, plus everything the detail panel shows.
// Taken, open, being repaired and switched off follow the one rule in lib/rentals-home (spaceStates), so this list and
// the Rentals home always agree. Pure: no database.
import { spaceStates, leaseEnding, leasePastEnd, plusDays, dayDiff, monthDay, money, nameOf, type SpaceState } from '@/lib/rentals-home';
import { invoiceOwedCents } from '@/lib/booth-rental-types';
import { depositPosition } from '@/lib/deposit-accounting';

const n = (v: any) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const day = (v: any) => String(v || '').slice(0, 10);
const isDay = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v);
const PER: Record<string, string> = { monthly: '/mo', weekly: '/wk', biweekly: ' every 2 wks', daily: '/day', hourly: '/hr' };
const rate = (cents: number, freq: string) => `${money(cents)}${PER[freq] ?? `/${freq}`}`;
const longDay = (iso: string) => { const d = new Date(`${day(iso)}T12:00:00Z`); return isNaN(d.getTime()) ? String(iso || '') : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }); };
const ordinal = (k: number) => { const s = ['th', 'st', 'nd', 'rd']; const v = k % 100; return `${k}${s[(v - 20) % 10] || s[v] || s[0]}`; };
const ENDED = ['ended', 'terminated'];
const USED = ['active', 'on_leave', 'ending_soon', 'ended', 'terminated'];

export type SpaceFilter = 'all' | 'leased' | 'open' | 'day' | 'repair';
export const SPACE_FILTERS: { key: SpaceFilter; label: string }[] = [
  { key: 'all', label: 'All' }, { key: 'leased', label: 'Leased' }, { key: 'open', label: 'Open' }, { key: 'day', label: 'Day and hourly' }, { key: 'repair', label: 'Repairs' },
];

export interface SpaceRow {
  id: string; name: string; state: SpaceState; filters: SpaceFilter[];
  status: string; warn: boolean;
  renter: string; renterIds: string[];
  leaseEnds: string | null; rent: string;
  thisYearCents: number; usedPct: number | null;
  detail: {
    about: string;
    lines: { label: string; value: string; warn?: boolean }[];
    /** pct is null for a month before the space was added (or before the twelve months began). */
    usedByMonth: { month: string; pct: number | null }[];
    leaseIds: string[]; pendingLeaseId: string | null; applicants: number; openRepairs: number;
  };
}

/** What a space asks when it's open, in its own terms: a monthly price, else its long-term rent, else a day or hour. */
export function askingLabel(b: any): string {
  const opts: any[] = Array.isArray(b?.pricingOptions) ? b.pricingOptions : [];
  const o = (f: string) => opts.find((x) => x?.frequency === f && n(x.amountCents) > 0);
  if (o('monthly')) return rate(o('monthly').amountCents, 'monthly');
  if (n(b?.baseRentCents) > 0) return rate(b.baseRentCents, b.baseRentFrequency || 'monthly');
  for (const f of ['weekly', 'daily', 'hourly']) if (o(f)) return rate(o(f).amountCents, f);
  if (n(b?.dayUseDailyCents) > 0) return rate(b.dayUseDailyCents, 'daily');
  if (n(b?.dayUseHourlyCents) > 0) return rate(b.dayUseHourlyCents, 'hourly');
  return 'No rent set';
}

/** The days a lease had its space, between two days (inclusive). A lease waiting to be signed hasn't had it yet. */
function leaseDays(l: any, from: string, to: string): string[] {
  if (!USED.includes(String(l?.status))) return [];
  const start = day(l.activatedOn || l.startDate); if (!isDay(start)) return [];
  const stop = ENDED.includes(String(l.status)) ? [day(l.lastChargeDate), day(l.endDate), day(l.updatedAt)].find(isDay) || start : to;
  const a = start > from ? start : from; const b = stop < to ? stop : to;
  const out: string[] = []; if (a > b) return out;
  for (let d = a, i = 0; d <= b && i < 400; d = plusDays(d, 1), i++) out.push(d);
  return out;
}

export interface SpacesBoardInput {
  todayIso: string; booths: any[]; leases: any[]; renters: any[]; invoices: any[]; ledger: any[];
  reservations?: any[]; applications?: any[]; documents?: any[]; tickets?: any[];
}

export function spacesBoard(x: SpacesBoardInput) {
  const today = x.todayIso; const year = today.slice(0, 4);
  const from = plusDays(today, -364);
  const states = spaceStates(x.booths || [], x.leases || []);
  const renterById = new Map((x.renters || []).map((r) => [r.id, r]));
  // Late rent belongs to the space its bill is for (the bill's space, or its lease's), not to everything its renter rents.
  const leaseBooth = new Map((x.leases || []).map((l) => [l.id, l.boothId]));
  const lateSpaces = new Set((x.invoices || []).filter((i) => i?.status === 'late' && invoiceOwedCents(i) > 0).map((i) => String(i.boothId || leaseBooth.get(i.leaseId) || '')));
  const goodRes = (r: any) => ['confirmed', 'checked_in', 'completed'].includes(String(r?.status));
  const sorted = [...(x.booths || [])].sort((a, b) => n(a.sortOrder) - n(b.sortOrder) || String(a.name || '').localeCompare(String(b.name || ''), undefined, { numeric: true }));

  const rows: SpaceRow[] = sorted.map((b) => {
    const st = states.get(b.id)!; const ls = st.leases;
    const pending = ls.find((l) => l.status === 'pending_signature') || null;
    const names = ls.map((l) => nameOf(renterById.get(l.renterId)));
    const apps = (x.applications || []).filter((a) => a?.boothId === b.id && ['new', 'in_review'].includes(String(a?.status || 'new')) && String(a?.kind || 'application') === 'application').length;
    const opts: any[] = Array.isArray(b.pricingOptions) ? b.pricingOptions : [];
    const hourlyOnly = !opts.some((o) => ['daily', 'weekly', 'monthly'].includes(o?.frequency) && n(o.amountCents) > 0) && (opts.some((o) => o?.frequency === 'hourly' && n(o.amountCents) > 0) || (n(b.dayUseHourlyCents) > 0 && !n(b.dayUseDailyCents)));
    const dayUse = st.state === 'open' && b.dayUseEnabled === true;
    const ending = ls.map((l) => leaseEnding(l, today)).find((e) => e && !e.renews) || null;
    const pastEnd = ls.map((l) => leasePastEnd(l, today)).find(Boolean) || null;
    const late = lateSpaces.has(b.id);

    let status: string; let warn = false;
    if (st.state === 'off') status = 'Not rented';
    else if (st.state === 'repair') { status = 'Repair'; warn = true; }
    else if (st.state === 'open') status = dayUse ? (hourlyOnly ? 'Hourly' : 'Day use') : 'Open';
    else if (pending && ls.length === 1) { status = 'Waiting to sign'; warn = true; }
    else if (late) { status = 'Rent late'; warn = true; }
    else if (pastEnd) { status = `Ended ${monthDay(pastEnd.endDate)}`; warn = true; }
    else if (ending) { status = ending.days === 0 ? 'Ends today' : `Ends ${monthDay(ending.endDate)}`; warn = true; }
    else status = st.state === 'shared' ? 'Shared' : 'Leased';

    const filters: SpaceFilter[] = ['all'];
    if (st.state === 'taken' || st.state === 'shared') filters.push('leased');
    if (st.state === 'open') filters.push(dayUse ? 'day' : 'open');
    if (st.state === 'repair') filters.push('repair');

    const endDays = ls.map((l) => day(l.endDate)).filter(isDay).sort();
    const sameFreq = ls.length > 0 && ls.every((l) => l.frequency === ls[0].frequency);
    const rent = ls.length ? (sameFreq ? rate(ls.reduce((s, l) => s + n(l.rentAmountCents), 0), ls[0].frequency || 'monthly') : ls.map((l) => rate(n(l.rentAmountCents), l.frequency || 'monthly')).join(', ')) : askingLabel(b);

    // This year: rent paid on this space's bills, and its day and hourly bookings so far.
    const billsIn = (x.invoices || []).filter((i) => i?.boothId === b.id && day(i.dueDate).startsWith(year))
      .reduce((s, i) => s + (i.status === 'paid' ? n(i.amountCents) + n(i.lateFeeCents) : ['due', 'late'].includes(String(i.status)) ? Math.max(0, n(i.amountCents) + n(i.lateFeeCents) - invoiceOwedCents(i)) : 0), 0);
    const guestsIn = (x.reservations || []).filter((r) => r?.boothId === b.id && goodRes(r) && day(r.startDate).startsWith(year) && day(r.startDate) <= today)
      .reduce((s, r) => s + Math.max(0, n(r.amountCents) - n(r.balanceDueCents)) + (r.overageStatus === 'charged' ? n(r.overageDueCents) : 0), 0);   // what's still owed on a booking isn't in yet

    // Used: of the days it could have been, in the last twelve months (or since it was added), how many a lease had it
    // or a guest booked it.
    const since = isDay(day(b.createdAt)) && day(b.createdAt) > from ? day(b.createdAt) : from;
    const used = new Set<string>();
    for (const l of (x.leases || []).filter((l) => l.boothId === b.id)) for (const d of leaseDays(l, since, today)) used.add(d);
    // A guest's stay counts every day it runs.
    for (const r of (x.reservations || []).filter((r) => r?.boothId === b.id && goodRes(r))) {
      const a = day(r.startDate); const z = isDay(day(r.endDate)) && day(r.endDate) >= a ? day(r.endDate) : a; if (!isDay(a)) continue;
      for (let d = a > since ? a : since, i = 0; d <= z && d <= today && i < 400; d = plusDays(d, 1), i++) used.add(d);
    }
    const span = dayDiff(today, since) + 1;
    const usedPct = span < 14 ? null : Math.round((used.size / span) * 100);
    const usedByMonth: { month: string; pct: number | null }[] = [];
    for (let k = 11; k >= 0; k--) {
      const d = new Date(`${today.slice(0, 7)}-01T12:00:00Z`); d.setUTCMonth(d.getUTCMonth() - k);
      const key = d.toISOString().slice(0, 7);
      const inMonth = [...used].filter((u) => u.startsWith(key)).length;
      const days = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
      // Only the days of the month the space was there for (and inside the twelve months) are counted.
      const first = `${key}-01` < since ? since : `${key}-01`;
      const last = key === today.slice(0, 7) ? today : `${key}-${String(days).padStart(2, '0')}`;
      const upto = first > last ? 0 : dayDiff(last, first) + 1;
      usedByMonth.push({ month: d.toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' }), pct: upto ? Math.min(100, Math.round((inMonth / upto) * 100)) : null });
    }

    // The detail panel.
    const lead = pending && ls.length === 1 ? pending : ls.find((l) => l.status !== 'pending_signature') || ls[0] || null;
    const lines: { label: string; value: string; warn?: boolean }[] = [];
    if (ls.length) {
      lines.push({ label: ls.length > 1 ? 'Renters' : 'Renter', value: names.join(', ') });
      if (lead) {
        const e = day(lead.endDate);
        lines.push({ label: 'Lease', value: `${isDay(day(lead.startDate)) ? longDay(lead.startDate) : 'Start not set'} to ${isDay(e) ? longDay(e) : 'no end date'}${isDay(e) ? (lead.autoRenew ? ', renews' : ', ends') : ''}` });
        const f = String(lead.frequency || 'monthly');
        lines.push({ label: 'Rent', value: f === 'monthly' && n(lead.dueDay) >= 1 ? `${money(n(lead.rentAmountCents))} on the ${ordinal(n(lead.dueDay))}` : rate(n(lead.rentAmountCents), f) });
        const dp = depositPosition(lead, x.ledger || []);
        if (dp.agreedCents > 0) lines.push({ label: 'Deposit', value: `${money(dp.agreedCents)}, ${dp.heldCents >= dp.agreedCents ? 'held' : dp.heldCents > 0 ? `${money(dp.heldCents)} held` : dp.collectedCents > 0 ? 'returned' : 'not paid yet'}`, warn: dp.collectedCents === 0 && lead.status !== 'pending_signature' });
        if (lead.status === 'pending_signature') {
          const doc = (x.documents || []).filter((d) => d?.kind === 'lease' && d?.leaseId === lead.id && d?.status === 'sent')[0];
          lines.push({ label: 'Signed', value: doc ? `Sent ${monthDay(day(doc.sentAt))}, not signed yet` : 'Not sent yet', warn: true });
        } else if (lead.signedAt) lines.push({ label: 'Signed', value: `${monthDay(day(lead.signedAt))}${lead.signedByName ? ` by ${lead.signedByName}` : ''}` });
      }
    } else if (st.state === 'open') {
      lines.push({ label: 'Asking', value: askingLabel(b) });
      if (apps) lines.push({ label: 'Applied', value: `${apps} ${apps === 1 ? 'person' : 'people'}` });
    }
    const openRepairs = (x.tickets || []).filter((t) => t?.boothId === b.id && (t.status === 'open' || t.status === 'in_progress')).length;
    lines.push({ label: 'Repairs', value: openRepairs ? `${openRepairs} open` : 'None open', warn: openRepairs > 0 });
    const kind = String(b.type || '').trim();
    const about = [kind ? kind.charAt(0).toUpperCase() + kind.slice(1) : '', Array.isArray(b.amenities) ? b.amenities.filter(Boolean).join(', ') : ''].filter(Boolean).join(' · ');

    return {
      id: b.id, name: String(b.name || 'Space'), state: st.state, filters, status, warn,
      renter: ls.length ? names.join(', ') : dayUse ? 'Guests' : apps ? `${apps} ${apps === 1 ? 'applicant' : 'applicants'}` : '',
      renterIds: ls.map((l) => String(l.renterId)), leaseEnds: endDays[0] || null, rent,
      thisYearCents: billsIn + guestsIn, usedPct,
      detail: { about, lines, usedByMonth, leaseIds: ls.map((l) => l.id), pendingLeaseId: pending?.id || null, applicants: apps, openRepairs },
    };
  });

  const chips = SPACE_FILTERS.map((f) => ({ ...f, count: rows.filter((r) => r.filters.includes(f.key)).length }));
  return { rows, chips };
}
