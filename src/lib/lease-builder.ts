// src/lib/lease-builder.ts — THE LEASE, WRITTEN FROM THE SETTINGS THE APP RUNS ON.
//
// A space lease is filled in, section by section, from what the business has set: rent and late fees, the deposit, the
// agreed charges, insurance, repairs, closures, time away, concerns, collections, what renters get, and the business's
// lease settings (tenant.leasePolicy: notice periods, legal basics and the rest). So what the lease says is what the app
// does. The lease wizard (components/renters/LeaseBuilder) shows each section as it's filled in; the text it makes is
// frozen on the lease and signed as it stands. Changing a setting later changes new leases; a signed lease keeps the
// words it was signed with.
//
// This is a starting point, not legal advice: the owner is asked to have an attorney in their state review it once, and
// can record that review (it's noted on each lease made from it), or use their own attorney's lease instead.
// Pure.
import { firstBill } from './rent-schedule';
import { OFFER_DEFS, type Offers } from './renter-offers';
import { perkWords, type PerkLike } from './lease-perks';

// ── The business's lease settings ────────────────────────────────────────────
export type EarlyEndFee = 'none' | 'one_period';
export type Holdover = 'same' | 'plus10';
export type LeasePolicy = {
  /** The business's legal name, as on its license or tax filing. */
  legalName: string;
  accessHours: string;
  noticeDays: number;
  earlyEndFee: EarlyEndFee;
  holdover: Holdover;
  rentChangeNoticeDays: number;
  declinedFeeCents: number;
  depositReturnDays: number;
  payByCard: boolean; payByAutopay: boolean; payOffline: boolean;
  insurance: { required: boolean; perClaimCents: number; perYearCents: number; additionalInsured: boolean; lapseNoticeDays: number };
  licenseRequired: boolean;
  changesNeedOk: boolean; damageByRenter: boolean; propertyClause: boolean;
  noPoach: boolean;
  /** Business days to answer a concern. */
  concernReplyDays: number;
  /** A rule break: days to fix it after written notice; the same one this many times in this many months, or a safety
   *  issue, can end the lease with this much notice. */
  fixItDays: number; repeatCount: number; repeatMonths: number; endForCauseDays: number;
  businessChangeNoticeDays: number;
  governingState: string; county: string; disputeTalkDays: number; mediation: boolean;
  /** Bumped on every save: each lease records the version it was written from. */
  version: number;
  attorneyReview: { at: string; by: string; note?: string } | null;
};

const int = (v: any, d: number, lo: number, hi: number) => { const n = Math.round(Number(v)); return Number.isFinite(n) && n >= lo && n <= hi ? n : d; };
const str = (v: any, max = 200) => String(v ?? '').trim().slice(0, max);
const bool = (v: any, d: boolean) => (v === true ? true : v === false ? false : d);

/** The business's lease settings, with sensible defaults for anything never set. Insurance and license follow the
 *  paperwork the business already asks renters for (bookingPageSettings.automationRules). */
export function resolveLeasePolicy(tenant: any): LeasePolicy {
  const p = tenant?.leasePolicy || {};
  const rules = tenant?.bookingPageSettings?.automationRules || {};
  const ins = p.insurance || {};
  const addr = tenant?.address || tenant?.businessAddress || {};
  return {
    legalName: str(p.legalName, 120) || str(tenant?.legalName, 120) || str(tenant?.businessName, 120) || str(tenant?.name, 120),
    accessHours: str(p.accessHours, 120),
    noticeDays: int(p.noticeDays, 30, 0, 365),
    earlyEndFee: p.earlyEndFee === 'one_period' ? 'one_period' : 'none',
    holdover: p.holdover === 'plus10' ? 'plus10' : 'same',
    rentChangeNoticeDays: int(p.rentChangeNoticeDays, 60, 0, 365),
    declinedFeeCents: int(p.declinedFeeCents, 0, 0, 100000),
    depositReturnDays: int(p.depositReturnDays, 14, 1, 90),
    payByCard: bool(p.payByCard, true), payByAutopay: bool(p.payByAutopay, true), payOffline: bool(p.payOffline, true),
    insurance: {
      required: bool(ins.required, rules.requireInsurance === true),
      perClaimCents: int(ins.perClaimCents, 100000000, 0, 10000000000),
      perYearCents: int(ins.perYearCents, 200000000, 0, 10000000000),
      additionalInsured: bool(ins.additionalInsured, true),
      lapseNoticeDays: int(ins.lapseNoticeDays, 7, 0, 90),
    },
    licenseRequired: bool(p.licenseRequired, rules.requireLicense === true),
    changesNeedOk: bool(p.changesNeedOk, true), damageByRenter: bool(p.damageByRenter, true), propertyClause: bool(p.propertyClause, true),
    noPoach: p.noPoach === true,
    concernReplyDays: int(p.concernReplyDays, 2, 1, 30),
    fixItDays: int(p.fixItDays, 7, 1, 60), repeatCount: int(p.repeatCount, 3, 2, 10), repeatMonths: int(p.repeatMonths, 6, 1, 24), endForCauseDays: int(p.endForCauseDays, 14, 0, 90),
    businessChangeNoticeDays: int(p.businessChangeNoticeDays, 60, 0, 365),
    governingState: str(p.governingState, 40) || str(addr.state, 40),
    county: str(p.county, 60),
    disputeTalkDays: int(p.disputeTalkDays, 14, 0, 90), mediation: bool(p.mediation, true),
    version: int(p.version, 1, 1, 100000),
    attorneyReview: p.attorneyReview && p.attorneyReview.at ? { at: str(p.attorneyReview.at, 40), by: str(p.attorneyReview.by, 120), note: str(p.attorneyReview.note, 300) } : null,
  };
}

// ── One lease ────────────────────────────────────────────────────────────────
export type Frequency = 'daily' | 'weekly' | 'biweekly' | 'monthly';
export type LeaseDraft = {
  renterName: string; renterBusinessName: string; renterNoticeAddress: string;
  spaceName: string; spaceAddress: string; isShared: boolean;
  /** Days of the week (0 Sunday) and times, for a shared space; empty days: the whole week. */
  slot: { days: number[]; startTime?: string; endTime?: string } | null;
  accessHours: string;
  amenities: string[];
  keyType: 'own_code' | 'own_key' | 'shared_code' | 'none';
  startDate: string; endDate: string | null; autoRenew: boolean;
  noticeDays: number; earlyEndFee: EarlyEndFee; holdover: Holdover;
  rentCents: number; frequency: Frequency; dueDay: number; prorateFirst: boolean; rentChangeNoticeDays: number;
  graceDays: number;
  lateFee: { type: 'flat' | 'percent'; amountCents?: number; percent?: number; maxFeeCents?: number | null } | null;
  declinedFeeCents: number;
  payByCard: boolean; payByAutopay: boolean; payOffline: boolean;
  depositCents: number; depositRefundable: boolean; depositReturnDays: number; depositAsLastMonth: boolean;
  agreedCharges: { label: string; capCents: number }[];
  sellProducts: boolean; noPoach: boolean;
  insurance: LeasePolicy['insurance'];
  licenseRequired: boolean;
  /** The house rules attached (their title and version), or none. */
  houseRules: string | null;
  changesNeedOk: boolean; damageByRenter: boolean; propertyClause: boolean;
  /** Signed in the renter's portal (electronically), or on paper. */
  signedOnPaper?: boolean;
  /** Perks the lease gives, each a credit on the rent account when it's due (lib/lease-perks). */
  perks?: PerkLike[];
};

/** The rest of what a lease is written from: the business, and the policies the app runs on. */
export type LeaseContext = {
  businessName: string;
  policy: LeasePolicy;
  repairs: { priority: string; label: string; respondHours: number; fixHours: number }[];
  leave: { offered: string[]; reducedPercent: number; maxWeeks: number; noticeDays: number };
  collections: { dunningDays: number[]; autoBarAfterDaysLate: number | null };
  offers: Offers | null;
};

export type LeaseSection = { n: number; key: string; title: string; text: string; short?: string };
export type BuiltLease = { title: string; heading: string; keyTerms: { label: string; text: string }[]; sections: LeaseSection[]; attachments: string[]; text: string };

// ── Words ────────────────────────────────────────────────────────────────────
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
export const longDate = (d: string | null | undefined) => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(d || '')); return m ? `${MONTHS[+m[2] - 1]} ${+m[3]}, ${m[1]}` : ''; };
export const shortDate = (d: string | null | undefined) => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(d || '')); return m ? `${MONTHS[+m[2] - 1].slice(0, 3)} ${+m[3]}, ${m[1]}` : ''; };
const monthDay = (d: string) => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(d); return m ? `${MONTHS[+m[2] - 1]} ${+m[3]}` : d; };
export const usd = (c: number) => `$${(Math.round(c) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const bigUsd = (c: number) => { const d = Math.round(c / 100); return d >= 1000000 && d % 1000000 === 0 ? `$${d / 1000000}M` : `$${d.toLocaleString('en-US')}`; };
const ordinal = (n: number) => { const s = ['th', 'st', 'nd', 'rd'], v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]); };
const DAY = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const list = (xs: string[], and = 'and') => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} ${and} ${xs[xs.length - 1]}`);
const listOr = (xs: string[]) => list(xs, 'or');
/** A thing as typed, inside a sentence: "Storage cabinet" reads "storage cabinet", "Wi-Fi" stays as it is. */
const inSentence = (x: string) => { const t = x.trim(); return /^[A-Z][a-z]/.test(t) && !/[A-Z]/.test(t.slice(1)) ? t.charAt(0).toLowerCase() + t.slice(1) : t; };
/** Dollars for big round amounts ("$1,000,000"), else with cents. */
const usdRound = (c: number) => (c % 100 === 0 && c >= 100000 ? `$${(c / 100).toLocaleString('en-US')}` : usd(c));
const days = (n: number) => `${n} day${n === 1 ? '' : 's'}`;
/** "30 days’ notice", "1 day’s notice". */
const daysOf = (n: number) => (n === 1 ? '1 day’s' : `${n} days’`);
const hoursWords = (h: number) => (h % 24 !== 0 || h < 24 ? `${h} hour${h === 1 ? '' : 's'}` : `${h / 24} day${h === 24 ? '' : 's'}`);
const STATES: Record<string, string> = { AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California', CO: 'Colorado', CT: 'Connecticut', DE: 'Delaware', DC: 'the District of Columbia', FL: 'Florida', GA: 'Georgia', HI: 'Hawaii', ID: 'Idaho', IL: 'Illinois', IN: 'Indiana', IA: 'Iowa', KS: 'Kansas', KY: 'Kentucky', LA: 'Louisiana', ME: 'Maine', MD: 'Maryland', MA: 'Massachusetts', MI: 'Michigan', MN: 'Minnesota', MS: 'Mississippi', MO: 'Missouri', MT: 'Montana', NE: 'Nebraska', NV: 'Nevada', NH: 'New Hampshire', NJ: 'New Jersey', NM: 'New Mexico', NY: 'New York', NC: 'North Carolina', ND: 'North Dakota', OH: 'Ohio', OK: 'Oklahoma', OR: 'Oregon', PA: 'Pennsylvania', RI: 'Rhode Island', SC: 'South Carolina', SD: 'South Dakota', TN: 'Tennessee', TX: 'Texas', UT: 'Utah', VT: 'Vermont', VA: 'Virginia', WA: 'Washington', WV: 'West Virginia', WI: 'Wisconsin', WY: 'Wyoming', PR: 'Puerto Rico' };
/** A state as it reads in the lease: "PA" reads "Pennsylvania". */
export const stateName = (s: string) => { const t = String(s || '').trim(); return STATES[t.toUpperCase()] || t; };
const period = (f: Frequency) => (f === 'monthly' ? 'month' : f === 'weekly' ? 'week' : f === 'biweekly' ? 'two weeks' : 'day');
const perPeriod = (f: Frequency) => (f === 'monthly' ? 'a month' : f === 'weekly' ? 'a week' : f === 'biweekly' ? 'every two weeks' : 'a day');
const twelveHour = (t?: string) => { const m = /^(\d{1,2}):(\d{2})/.exec(String(t || '')); if (!m) return ''; const h = +m[1]; return `${h % 12 || 12}:${m[2]} ${h < 12 ? 'AM' : 'PM'}`; };
const cap1 = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** The day before the same date n months on (the last day of a shorter month): a 12-month lease from Aug 31 ends Aug 30. */
export const leaseEndAfter = (iso: string, n: number) => {
  const [y, m, d] = iso.split('-').map(Number); if (!y || !m || !d) return iso;
  const last = new Date(Date.UTC(y, m - 1 + n + 1, 0)).getUTCDate();
  const t = new Date(Date.UTC(y, m - 1 + n, Math.min(d, last))); t.setUTCDate(t.getUTCDate() - 1); return t.toISOString().slice(0, 10);
};
/** Where an auto-renewing lease's next term ends (the nightly renewal and the owner's Renew button both use this).
 *  The next term starts the day after the current end, so a pause that moved the end date, or a signed renewal,
 *  carries forward.
 *  - A lease in whole months (termMonths, from the builder) runs that many months from there, ending the day before.
 *    A start on the 29th to 31st that a short month clamped comes back to its own day: a lease from Aug 31 in 6-month
 *    terms ends Feb 27, then Aug 30, then Feb 28.
 *  - Otherwise a length in days, kept as termDays on its first renewal so a renewal never doubles the next term:
 *    the days since the end before a signed renewal (signing also keeps it as termDays), or the first term. A lease
 *    the old automatic renewal renewed before termDays was kept had its term doubled on each renewal, so half its
 *    length since the start is used, at most a year. */
export function nextTermEnd(l: { startDate?: string | null; endDate?: string | null; termMonths?: number | null; termDays?: number | null; renewedAt?: string | null; previousEndDate?: string | null; renewalDocumentId?: string | null; endDateExtendedByLeaveDays?: number | null }): { end: string; termDays?: number } | null {
  const isDate = (x: string) => /^\d{4}-\d{2}-\d{2}$/.test(x);
  const end = String(l.endDate || '').slice(0, 10), start = String(l.startDate || '').slice(0, 10), prev = String(l.previousEndDate || '').slice(0, 10);
  if (!isDate(end)) return null;
  const ms = (x: string) => new Date(`${x}T00:00:00Z`).getTime();
  const iso = (t: number) => new Date(t).toISOString().slice(0, 10);
  const months = Number(l.termMonths) > 0 ? Math.round(Number(l.termMonths)) : 0;
  if (months) {
    const [ny, nm, nd] = iso(ms(end) + 86400000).split('-').map(Number);
    const lastOfNext = new Date(Date.UTC(ny, nm, 0)).getUTCDate();
    const anchor = isDate(start) ? Number(start.slice(8, 10)) : nd;
    const day = nd === lastOfNext && anchor > nd ? anchor : nd;
    const lastOfTarget = new Date(Date.UTC(ny, nm - 1 + months + 1, 0)).getUTCDate();
    return { end: iso(Date.UTC(ny, nm - 1 + months, Math.min(day, lastOfTarget)) - 86400000) };
  }
  const span = (a: string) => Math.round((ms(end) - ms(a)) / 86400000);
  let days = Number(l.termDays) > 0 ? Math.round(Number(l.termDays)) : 0;
  if (!days && isDate(prev) && prev < end) days = span(prev);
  // Only the old automatic renewal (it never kept a renewal document) doubled the term.
  // Days a pause added to the end aren't part of the term.
  if (!days && isDate(start)) days = l.renewedAt && !l.renewalDocumentId ? Math.min(365, Math.round(span(start) / 2)) : span(start) - Math.max(0, Math.round(Number(l.endDateExtendedByLeaveDays) || 0));
  days = Math.max(1, days || 30);
  return { end: iso(ms(end) + days * 86400000), termDays: days };
}
const minutesOf = (t?: string) => { const m = /^(\d{1,2}):(\d{2})/.exec(String(t || '')); return m ? +m[1] * 60 + +m[2] : null; };
/** Two shared slots clash on a day they share, unless their times on it don't overlap (a slot without times is the whole day). */
export const slotsClash = (a: { days: number[]; startTime?: string; endTime?: string }, b: any) => {
  if (!b || !Array.isArray(b.days) || !a.days.some((x) => b.days.includes(x))) return false;
  const as = minutesOf(a.startTime), ae = minutesOf(a.endTime), bs = minutesOf(b.startTime), be = minutesOf(b.endTime);
  if (as == null || ae == null || bs == null || be == null) return true;
  return as < be && bs < ae;
};

/** How the renter gets in, in the lease's words. */
const KEY_WORDS: Record<LeaseDraft['keyType'], string> = {
  own_code: 'their own door code, which they won’t share', own_key: 'their own key, which they won’t copy or lend',
  shared_code: 'the shared door code, which they won’t give to anyone else', none: '',
};

function lateLine(d: LeaseDraft): { text: string; short: string } {
  const f = d.lateFee;
  if (!f || ((f.type === 'flat' ? Number(f.amountCents) : Number(f.percent)) || 0) <= 0) return { text: 'No late fee is charged.', short: 'No late fee' };
  const amount = f.type === 'percent' ? `${Number(f.percent)}% of the amount due` : usd(Number(f.amountCents) || 0);
  const capTxt = f.type === 'percent' && f.maxFeeCents ? `, up to ${usd(f.maxFeeCents)}` : '';
  return { text: `a fee of ${amount}${capTxt} is added once to that bill`, short: `${amount} ${d.graceDays > 0 ? `after ${days(d.graceDays)}` : 'if not paid by the due date'}, once per bill` };
}

function slotWords(d: LeaseDraft): string {
  const s = d.slot;
  if (!s || !Array.isArray(s.days) || !s.days.length) return '';
  const names = s.days.slice().sort((a, b) => a - b).map((x) => DAY[x]);
  const t = s.startTime && s.endTime ? ` from ${twelveHour(s.startTime)} to ${twelveHour(s.endTime)}` : '';
  return `on ${list(names)}${t}`;
}

/** The lease, section by section, with its key terms at the top. */
export function buildLease(d: LeaseDraft, c: LeaseContext): BuiltLease {
  const P = c.policy;
  const biz = P.legalName || c.businessName || 'the Business';
  const renter = d.renterName.trim() || 'the Renter';
  const dba = d.renterBusinessName.trim();
  const sections: Omit<LeaseSection, 'n'>[] = [];
  const add = (key: string, title: string, text: string, short?: string) => sections.push({ key, title, text: text.replace(/\s+/g, ' ').trim(), ...(short ? { short } : {}) });

  // 1–5: who, where, how long, how it ends.
  add('parties', 'Parties', `This agreement is between ${biz} (the Business) and ${renter}${dba ? `, doing business as ${dba}` : ''} (the Renter).`);
  const comes = d.amenities.filter((x) => x && x.trim()).map(inSentence);
  const slot = slotWords(d);
  const access = d.accessHours.trim();
  add('space', 'The space',
    `The Renter rents ${d.spaceName || 'the space'}, a ${d.isShared ? 'shared' : 'private'} space${d.spaceAddress ? ` at ${d.spaceAddress}` : ''}${comes.length ? `, with ${list(comes)}` : ''}. `
    + (slot ? `The Renter may use it ${slot}${access ? `, within the access hours of ${access}` : ''}. ` : access ? `The Renter may use it ${access}. ` : '')
    + (KEY_WORDS[d.keyType] ? `The Renter gets in with ${KEY_WORDS[d.keyType]}.` : ''),
    `In short: ${d.spaceName || 'the space'}${slot ? `, ${slot}` : access ? `, ${access}` : ''}.`);
  const term = d.endDate
    ? `The lease runs from ${longDate(d.startDate)} to ${longDate(d.endDate)}. ${d.autoRenew ? `It renews for the same length unless either side gives written notice at least ${days(d.noticeDays)} before it ends.` : 'It ends on that date unless both sides agree in writing to renew it.'}`
    : `The lease starts on ${longDate(d.startDate)} and continues until either side ends it with at least ${daysOf(d.noticeDays)} written notice.`;
  add('term', 'Term and renewal', term, d.endDate ? `In short: until ${shortDate(d.endDate)}${d.autoRenew ? `, renewing unless someone gives ${daysOf(d.noticeDays)} notice` : ''}.` : `In short: ongoing, ${daysOf(d.noticeDays)} notice to end.`);
  add('early', 'Ending early', `Either side may end the lease${d.endDate ? ' early' : ''} with ${daysOf(d.noticeDays)} written notice. `
    + (d.earlyEndFee === 'one_period'
      ? `If the Renter leaves without giving that notice, they owe one ${period(d.frequency)}’s rent as an early-end fee.`
      : 'There is no fee for ending it with notice.'));
  // Only a lease that doesn't renew on its own can run past its end. The app doesn't bill those periods by itself, so
  // the lease says what the Business may charge, not what is billed.
  if (d.endDate && !d.autoRenew) add('holdover', 'Staying on', `If the Renter keeps using the space after the lease ends without a signed renewal, the Business may charge ${d.holdover === 'plus10' ? 'the rent plus 10%' : 'the same rent'} for each ${period(d.frequency)} or part of one they stay, until they leave or both sides sign a renewal.`);

  // 6–10: money.
  const fb = firstBill({ rentAmountCents: d.rentCents, frequency: d.frequency, dueDay: d.dueDay, firstChargeDate: d.startDate, startDate: d.startDate, prorateFirst: d.prorateFirst, autoRenew: true });
  const due = d.frequency === 'monthly' ? `due on the ${ordinal(d.dueDay)}` : `due every ${period(d.frequency)}`;
  // The first bill starts on the start date, or the day the renter signs if that's later (lib/rent-schedule billingStart),
  // so the lease states the rule and the figure for the start date as an example.
  const perks = (d.perks || []).filter((x) => x && x.type);
  const prorates = d.frequency === 'monthly' && d.prorateFirst && !!fb && fb.prorated && !!fb.nextDue;
  const first = prorates ? ` The first bill is charged by the day, from the start date (or the day the Renter signs, if that’s later) to the day before the next due date: starting on ${monthDay(fb!.due)}, that’s ${usd(fb!.cents)}.` : '';
  add('rent', 'Rent', `The Renter pays ${usd(d.rentCents)} ${perPeriod(d.frequency)}, ${due}.${first} `
    + (d.endDate ? `Rent can change only at renewal, with at least ${daysOf(d.rentChangeNoticeDays)} written notice.` : `Rent can change only with at least ${daysOf(d.rentChangeNoticeDays)} written notice.`)
    + (perks.length ? ` The lease also gives ${perks.length === 1 ? 'this perk' : 'these perks'}, each a credit to the Renter’s rent account that comes off their next bills: ${perks.map((x) => perkWords(x, d.frequency, usd)).join('; ')}.` : ''),
    `In short: ${usd(d.rentCents)} ${d.frequency === 'monthly' ? `on the ${ordinal(d.dueDay)}` : perPeriod(d.frequency)}${prorates ? `; the first part-month by the day (${usd(fb!.cents)} from ${monthDay(fb!.due)})` : ''}.`);
  const late = lateLine(d);
  const lateWhen = d.graceDays > 0 ? `Rent not paid within ${days(d.graceDays)} of the due date is late` : 'Rent not paid by the due date is late';
  add('late', 'Late payment', (late.text.startsWith('No late') ? `${lateWhen}. ${late.text}` : `${lateWhen}, and ${late.text}.`)
    + (d.declinedFeeCents > 0 ? ` If a card or bank payment is declined or returned, the Business may add a fee of ${usd(d.declinedFeeCents)}.` : ''));
  const ways: string[] = [];
  if (d.payByCard) ways.push('by card in the Renter’s portal');
  if (d.payByAutopay) ways.push('by autopay if the Renter turns it on');
  if (d.payOffline) ways.push('by cash, check or transfer recorded by the Business, which gives a receipt');
  add('pay', 'How rent is paid', `Rent is paid ${listOr(ways.length ? ways : ['as the Business and the Renter agree in writing'])}.${d.payByAutopay ? ' Autopay is the Renter’s choice and needs their separate written authorization, which they can withdraw in the portal at any time.' : ''}`);
  if (d.depositCents > 0) {
    add('deposit', 'Deposit', `The Renter pays a ${d.depositRefundable ? 'refundable' : 'non-refundable'} deposit of ${usd(d.depositCents)}. `
      + (d.depositRefundable
        ? `It may cover unpaid rent and charges, damage beyond normal wear, keys or codes not returned, and cleaning beyond normal. Within ${days(d.depositReturnDays)} after move-out, the Business returns it, less any deductions, with a written list of each deduction and the reason. `
        : 'It is not returned at the end of the lease. ')
      + (!d.depositRefundable ? '' : d.depositAsLastMonth ? 'It may be used as the last rent payment if both sides agree in writing.' : 'It is not used as the last rent payment unless both sides agree in writing.'),
      d.depositRefundable ? `In short: ${usd(d.depositCents)}, back within ${days(d.depositReturnDays)}, with a written list if anything is kept.` : undefined);
  } else add('deposit', 'Deposit', 'No deposit is held.');
  const charges = d.agreedCharges.filter((x) => x.label.trim());
  add('charges', 'Agreed charges', charges.length
    ? `Only these charges may be made to the Renter’s saved card, each no higher than its cap, and each with a written reason sent to the Renter: ${charges.map((x) => `${inSentence(x.label)} (up to ${usd(x.capCents)})`).join('; ')}.`
    : 'No charges may be made to the Renter’s saved card other than rent and anything the Renter adds themselves.');

  // 11–13: their own business.
  add('independent', 'An independent business', `The Renter runs their own independent business. They set their own prices, services and hours, keep their own clients and records, take their own payments, supply their own tools and products, use their own name and branding, and pay their own taxes. The Renter is not an employee, partner or agent of the Business. No commission, split or wage is paid either way, and the Business does not train, supervise or direct how the Renter’s services are done.${d.noPoach ? ' While this lease runs, and where the law allows it, the Renter will not hire away the Business’s team members.' : ''}`,
    'In short: it’s your business. The Business rents you the space, nothing more.');
  add('bookings', 'Bookings and payments', 'The Renter may list their services on the Business’s booking page or use their own system, and may change this at any time in their portal. Payments from the Renter’s clients belong to the Renter.');
  const toolBits: string[] = [];
  if (d.sellProducts) toolBits.push('The Renter may sell their own products in the space and in the Business’s online shop under their own name; the Renter’s share of what sells online is credited against their rent.');
  if (c.offers) {
    const t = (k: string) => { const def = OFFER_DEFS.find((x) => x.key === k)!; const s = def.renterTitle(c.businessName || 'the Business'); return s.startsWith(cap1(c.businessName || '')) && c.businessName ? s : s.charAt(0).toLowerCase() + s.slice(1); };
    const inc = OFFER_DEFS.filter((x) => c.offers!.modes[x.key] === 'included').map((x) => t(x.key));
    const add_ = OFFER_DEFS.filter((x) => c.offers!.modes[x.key] === 'addon').map((x) => `${t(x.key)} at ${usd(c.offers!.prices[x.key])} a month`);
    toolBits.push(`The Renter’s portal includes their calendar, online booking and client reminders${inc.length ? `, along with ${list(inc)}` : ''}.`);
    if (add_.length) toolBits.push(`The Renter may add ${list(add_)}. An add-on is the Renter’s choice, is charged to their saved card each month with a receipt, and can be stopped at any time.`);
    if (c.offers.modes.salonGiftCards !== 'off') toolBits.push('When the Renter accepts the Business’s gift cards, the Business credits the amount redeemed against the Renter’s rent.');
  }
  add('tools', 'Selling, gift cards and portal tools', toolBits.join(' ') || 'The Renter’s portal includes their calendar, online booking and client reminders.');

  // 14–18: protection.
  const ins = d.insurance;
  const mins = [ins.perClaimCents > 0 ? `${usdRound(ins.perClaimCents)} per claim` : '', ins.perYearCents > 0 ? `${usdRound(ins.perYearCents)} per year` : ''].filter(Boolean);
  add('insurance', 'Insurance', ins.required
    ? `Before the start date and for the whole lease, the Renter keeps professional and general liability insurance${mins.length ? ` of at least ${list(mins)}` : ''}${ins.additionalInsured ? ', naming the Business as additional insured,' : ''} and keeps a current copy in their portal. If coverage lapses, the Business may pause the Renter’s bookings ${days(ins.lapseNoticeDays)} after written notice, until a current copy is on file.`
    : 'The Renter is encouraged to carry professional and general liability insurance; it isn’t required by this lease.',
    ins.required ? 'In short: keep your insurance current and uploaded in your portal.' : undefined);
  add('licenses', 'Licenses', d.licenseRequired
    ? 'The Renter holds and keeps current every license their work requires, keeps a copy with its expiry date in their portal, and displays it where their licensing board requires.'
    : 'The Renter holds every license the law requires for their work.');
  add('care', 'Care of the space', `${d.houseRules ? `The Renter follows the attached house rules (${d.houseRules}) and keeps` : 'The Renter keeps'} the space clean and sanitary to the standards their work requires`
    + `${d.changesNeedOk ? ', makes no changes to the space without the Business’s written OK' : ''}${d.damageByRenter ? ', and pays the reasonable cost of repairing damage beyond normal wear' : ''}.`
    + `${d.propertyClause ? ' The Renter’s own things in the space are their responsibility, unless lost or damaged through the Business’s own carelessness.' : ''}`);
  add('responsibility', 'Responsibility', 'Each side is responsible for its own actions and those of its team and clients, and will cover the other for claims caused by its own actions.');
  add('clients', 'Client information', 'The Renter’s client list and records belong to the Renter. The Business will not market to the Renter’s clients or share their records, except as the law requires.');

  // 19–25: when things go wrong, from the policies the app runs on.
  const R = c.repairs;
  if (R.length) add('repairs', 'Repairs', `The Renter reports problems in their portal. The Business answers within ${list(R.map((x, i) => `${hoursWords(x.respondHours)} for ${x.label.toLowerCase()}${i === 0 ? ' problems' : ''}`))}, and aims to fix them within ${list(R.map((x) => hoursWords(x.fixHours)))}, in the same order.`);
  else add('repairs', 'Repairs', 'The Renter reports problems in their portal, and the Business answers and fixes them within a reasonable time.');
  add('closures', 'Closures', 'If the space can’t be used for a whole day for a reason outside the Renter’s control, such as flood, fire, loss of power or water, severe weather or an ordered closure, the Business credits one day’s rent for each lost day against the next bill. Days on approved time away don’t count. Neither side owes the other for lost income beyond this credit.',
    'In short: if the space has to close, you don’t pay for those days.');
  const L = c.leave;
  const opts: string[] = [];
  if (L.offered.includes('pause')) opts.push(`pause rent for up to ${L.maxWeeks} weeks (the end date moves out by the paused days)`);
  if (L.offered.includes('reduced')) opts.push(`pay ${L.reducedPercent}% of the rent to keep the space`);
  if (L.offered.includes('bank')) opts.push('keep paying and bank rental days to use on return');
  if (L.offered.includes('sublet')) opts.push('have the space rented by the day while away, with that income credited against their rent');
  add('away', 'Time away', opts.length
    ? `The Renter may ask, at least ${days(L.noticeDays)} ahead, to ${listOr(opts)}. Each request is decided in writing in the portal.`
    : 'Time away doesn’t change the rent unless both sides agree in writing.');
  add('concerns', 'Concerns', `Either side raises concerns in writing through the portal. The Business replies within ${P.concernReplyDays} business day${P.concernReplyDays === 1 ? '' : 's'}. Concerns about another renter, the Business’s team or safety are kept confidential.`);
  add('rulebreaks', 'Rule breaks', `If the Renter breaks this lease or the house rules, the Business sends written notice and the Renter has ${days(P.fixItDays)} to fix it. For a safety issue, or the same issue ${P.repeatCount} times in ${P.repeatMonths} months, the Business may end the lease with ${daysOf(P.endForCauseDays)} written notice.`);
  const col = c.collections;
  add('unpaid', 'Late or unpaid rent', `${col.dunningDays.length ? `Reminders are sent ${list(col.dunningDays.map(String))} ${col.dunningDays.length === 1 && col.dunningDays[0] === 1 ? 'day' : 'days'} after a bill is late. ` : 'A reminder is sent when a bill is late. '}`
    + `${col.autoBarAfterDaysLate ? `If rent is ${col.autoBarAfterDaysLate} days late, the Renter’s bookings pause until it is paid. ` : ''}`
    + `${d.depositCents > 0 && d.depositRefundable ? 'Anything unpaid at move-out is taken from the deposit first, and the rest is still owed.' : 'Anything unpaid at move-out is still owed.'}`);
  add('business_change', 'If the Business closes, moves or is sold', `The Business gives at least ${daysOf(P.businessChangeNoticeDays)} written notice${d.depositCents > 0 && d.depositRefundable ? ' and settles the deposit' : ''}. A new owner takes over this lease on the same terms.`);

  // 26–28: legal basics.
  const state = stateName(P.governingState);
  add('law', 'Law and disagreements', `${state ? `The law of ${state} applies. ` : ''}If a disagreement comes up, both sides first try to settle it by talking for ${days(P.disputeTalkDays)}${P.mediation ? ', then through mediation' : ''}, then in small claims court or the courts of ${P.county ? `${P.county}${/county$/i.test(P.county) ? '' : ' County'}` : 'the county where the space is'}.`);
  add('notices', 'Notices and signing electronically', `A message in the Renter’s portal or an email counts as written notice, sent to the email addresses on file${d.renterNoticeAddress ? `, or by mail to the Renter at ${d.renterNoticeAddress}` : ''}. The Renter agrees to sign and receive documents electronically, can get a paper copy at no cost, and can withdraw that agreement in writing.`);
  add('whole', 'The whole agreement', `This lease${d.houseRules ? ' and the attached house rules are' : ' is'} the whole agreement. It changes only in writing signed by both sides. If one part can’t be enforced, the rest still stands. The Renter may not transfer the lease or sublet the space without the Business’s written OK, except an approved sublet during time away.`);

  const numbered: LeaseSection[] = sections.map((s, i) => ({ n: i + 1, ...s }));
  const keyTerms = [
    { label: 'Space', text: `${d.spaceName || 'The space'}${slot ? `, ${slot}` : access ? `, ${access}` : ''}` },
    { label: 'Term', text: d.endDate ? `${shortDate(d.startDate)} to ${shortDate(d.endDate)}.${d.autoRenew ? ` Renews unless either side gives ${daysOf(d.noticeDays)} notice` : ''}` : `From ${shortDate(d.startDate)}, ongoing. ${daysOf(d.noticeDays)} notice to end` },
    { label: 'Rent', text: `${usd(d.rentCents)} ${d.frequency === 'monthly' ? `on the ${ordinal(d.dueDay)}` : perPeriod(d.frequency)}${prorates ? `. The first part-month by the day (${usd(fb!.cents)} from ${shortDate(fb!.due)})` : ''}` },
    { label: 'Late', text: late.short },
    { label: 'Deposit', text: d.depositCents > 0 ? `${usd(d.depositCents)}, ${d.depositRefundable ? `refundable, settled within ${days(d.depositReturnDays)} of move-out` : 'non-refundable'}` : 'None' },
    { label: 'Insurance', text: ins.required ? [ins.perClaimCents > 0 ? `${bigUsd(ins.perClaimCents)} per claim` : '', ins.perYearCents > 0 ? `${bigUsd(ins.perYearCents)} per year` : '', ins.additionalInsured ? 'the Business named' : ''].filter(Boolean).join(', ') || 'Required' : 'Not required' },
    ...(perks.length ? [{ label: 'Perks', text: perks.map((x) => perkWords(x, d.frequency, usd)).join('; ') }] : []),
    { label: 'Closures', text: 'A day’s rent back for each whole day the space can’t be used' },
    { label: d.endDate ? 'Ending early' : 'Ending', text: `${daysOf(d.noticeDays)} written notice, ${d.earlyEndFee === 'one_period' ? `one ${period(d.frequency)}’s rent without it` : 'no fee'}` },
  ];
  const attachments = d.houseRules ? [`House rules (${d.houseRules})`] : [];
  const heading = `${biz} and ${renter}${d.spaceName ? ` · ${d.spaceName}` : ''}`;
  const text = [
    'Space Lease', heading, '',
    'Key terms', ...keyTerms.map((k) => `${k.label}: ${k.text}.`.replace(/\.\.$/, '.')), '',
    ...numbered.flatMap((s) => [`${s.n}. ${s.title}`, s.text, '']),
    ...(attachments.length ? [`Attached: ${attachments.join('; ')}.`, ''] : []),
    ...(d.signedOnPaper
      ? ['Signed by the Renter: ______________________  Date: __________', '', 'For the Business: ______________________  Date: __________']
      : ['Signed by the Renter and for the Business, electronically, as recorded with this lease.']),
  ].join('\n');
  return { title: 'Space Lease', heading, keyTerms, sections: numbered, attachments, text };
}

/** What to sort out before sending, in plain words. */
export function leaseChecks(d: LeaseDraft, c: LeaseContext, o: { houseRulesAvailable: boolean }): { ok: boolean; text: string; fix?: 'address' | 'review' | 'rules' | 'amounts' | 'state' }[] {
  const amountsOk = d.rentCents > 0 && !!d.startDate && (!d.endDate || d.endDate > d.startDate) && (d.frequency !== 'monthly' || (d.dueDay >= 1 && d.dueDay <= 31));
  const out: { ok: boolean; text: string; fix?: 'address' | 'review' | 'rules' | 'amounts' | 'state' }[] = [
    { ok: amountsOk, text: amountsOk ? 'Every amount and date is filled in' : 'An amount or date is missing or doesn’t add up', ...(amountsOk ? {} : { fix: 'amounts' as const }) },
    { ok: !!d.renterNoticeAddress.trim(), text: d.renterNoticeAddress.trim() ? `${d.renterName || 'The renter'}’s address for notices is in` : `${d.renterName || 'The renter'}’s address for notices is missing`, ...(d.renterNoticeAddress.trim() ? {} : { fix: 'address' as const }) },
    { ok: !!c.policy.governingState, text: c.policy.governingState ? (/^the /.test(stateName(c.policy.governingState)) ? `The law of ${stateName(c.policy.governingState)} applies` : `${stateName(c.policy.governingState)} law applies`) : 'Which state’s law applies isn’t set', ...(c.policy.governingState ? {} : { fix: 'state' as const }) },
  ];
  if (o.houseRulesAvailable) out.push({ ok: !!d.houseRules, text: d.houseRules ? 'House rules attached' : 'House rules aren’t attached', ...(d.houseRules ? {} : { fix: 'rules' as const }) });
  out.push({ ok: !!c.policy.attorneyReview, text: c.policy.attorneyReview ? `Attorney review recorded ${shortDate(c.policy.attorneyReview.at)}` : 'No attorney review recorded for this template', ...(c.policy.attorneyReview ? {} : { fix: 'review' as const }) });
  return out;
}
