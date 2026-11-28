// src/lib/home-office.ts — WORKING OUT A HOME OFFICE (the often-missed write-off "A home office", for the owner on the
// Money page's Write-offs tab and for a renter in their portal; kept with their other answers, api/writeoffs and
// api/portal/renter-writeoffs). From the space used and the months it was used, the simple way (IRS Rev. Proc. 2013-13,
// Publication 587): $5 a square foot, up to 300 square feet, for the months used 15 days or more (300 square feet for
// a whole year is $1,500), never more than the business's profit and with nothing of the home's wear counted. With the
// home's size and its costs for the year, the regular way too, as an estimate: the office's share of the home times
// those costs. Which way to use, and whether the space qualifies, is the accountant's.
export const RATE_CENTS = 500;
export const MAX_SQFT = 300;

export type HomeOffice = {
  officeSqft: number; months: number; homeSqft: number | null;
  /** The home's costs for the year, in cents: rent or mortgage interest, real estate taxes, HOA or condo dues,
   *  utilities, insurance, repairs and upkeep. */
  costs: { housing: number; taxes: number; hoa: number; utilities: number; insurance: number; repairs: number };
  updatedAt?: string;
};
export const COST_LABELS: [keyof HomeOffice['costs'], string][] = [['housing', 'Rent or mortgage interest'], ['taxes', 'Real estate taxes'], ['hoa', 'HOA or condo dues'], ['utilities', 'Utilities'], ['insurance', 'Renter’s or homeowner’s insurance'], ['repairs', 'Repairs and upkeep for the whole home']];
const COST_KEYS = COST_LABELS.map(([k]) => k);

const whole = (v: unknown) => { const n = Number(String(v ?? '').replace(/[,\s]/g, '')); return Number.isFinite(n) ? Math.round(n) : NaN; };
const cents = (v: unknown) => { const s = String(v ?? '').replace(/[$,\s]/g, ''); if (!s) return 0; const n = Number(s); return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : NaN; };

/** What was typed, checked: the office's square feet (1 to 10,000), the months used (1 to 12), and optionally the home's
 *  square feet (at least the office's) and its yearly costs in dollars (each up to $1,000,000). */
export function cleanHomeOffice(b: any): { ok: true; h: HomeOffice } | { ok: false; error: string } {
  const officeSqft = whole(b?.officeSqft);
  if (!(officeSqft >= 1 && officeSqft <= 10_000)) return { ok: false, error: 'The office’s size in square feet, like 120.' };
  const months = whole(b?.months ?? 12);
  if (!(months >= 1 && months <= 12)) return { ok: false, error: 'How many months it was used, from 1 to 12.' };
  const rawHome = String(b?.homeSqft ?? '').trim(); const homeSqft = rawHome ? whole(rawHome) : null;
  if (homeSqft != null && !(homeSqft >= officeSqft && homeSqft <= 100_000)) return { ok: false, error: 'The whole home’s size, at least as big as the office.' };
  const c = b?.costs || {}; const costs = Object.fromEntries(COST_KEYS.map((k) => [k, cents(c[k])])) as HomeOffice['costs'];
  if (Object.values(costs).some((v) => !Number.isFinite(v) || v > 100_000_000)) return { ok: false, error: 'Each cost in dollars for the year, like 18000.' };
  return { ok: true, h: { officeSqft, months, homeSqft, costs } };
}

/** A kept one read back: the same checks, so anything odd in it is never printed or counted. */
export function homeOfficeOf(v: any): HomeOffice | null {
  if (!v || typeof v !== 'object') return null;
  const c = v.costs || {};
  const r = cleanHomeOffice({ officeSqft: v.officeSqft, months: v.months, homeSqft: v.homeSqft ?? '', costs: Object.fromEntries(COST_KEYS.map((k) => [k, (Number(c[k]) || 0) / 100])) });
  return r.ok ? { ...r.h, ...(typeof v.updatedAt === 'string' ? { updatedAt: v.updatedAt } : {}) } : null;
}

export type HomeOfficeFigures = {
  /** The simple way: $5 × the square feet counted (up to 300) × the months used ÷ 12. */
  simpleCents: number; sqftCounted: number;
  /** The regular way, an estimate, when the home's size and at least one cost are in: the office's share of the home
   *  (`sharePct`, to a tenth) times the costs, for the months used. Without the home's wear, which the accountant adds
   *  for a home that's owned. */
  regularCents: number | null; sharePct: number | null; costsCents: number;
};

export function homeOfficeFigures(h: HomeOffice): HomeOfficeFigures {
  const sqftCounted = Math.min(MAX_SQFT, h.officeSqft);
  const simpleCents = Math.round(RATE_CENTS * sqftCounted * h.months / 12);
  const costsCents = COST_KEYS.reduce((n, k) => n + (h.costs[k] || 0), 0);
  if (!h.homeSqft || costsCents <= 0) return { simpleCents, sqftCounted, regularCents: null, sharePct: null, costsCents };
  const share = Math.min(1, h.officeSqft / h.homeSqft);
  return { simpleCents, sqftCounted, regularCents: Math.round(costsCents * share * h.months / 12), sharePct: Math.round(share * 1000) / 10, costsCents };
}

const usd = (c: number) => `$${(c / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const sqft = (n: number) => `${n.toLocaleString('en-US')} square ${n === 1 ? 'foot' : 'feet'}`;
const monthsWords = (m: number) => (m === 12 ? 'the whole year' : `${m} month${m === 1 ? '' : 's'}`);

/** The printed rows (as label, amount, the line under it), for the write-offs an accountant gets. */
export function homeOfficeRows(h: HomeOffice): [string, string, string][] {
  const f = homeOfficeFigures(h);
  const rows: [string, string, string][] = [['Home office, the simple way', usd(f.simpleCents),
    `${sqft(h.officeSqft)}${h.officeSqft > MAX_SQFT ? `, ${MAX_SQFT} of them counted` : ''}, used ${monthsWords(h.months)}, at $5 a square foot. No more than the business’s profit; nothing for the home’s wear`]];
  if (f.regularCents != null) rows.push(['Home office, the regular way, an estimate', usd(f.regularCents),
    `${f.sharePct}% of a home of ${sqft(h.homeSqft!)}, times ${usd(f.costsCents)} of its costs for the year${h.months < 12 ? `, for ${h.months} of 12 months` : ''}. Before the home’s wear, for one that’s owned. Use one way or the other, not both`]);
  return rows;
}

/** The short version, under the home office on the Write-offs screens. */
export function homeOfficeLine(h: HomeOffice): string {
  const f = homeOfficeFigures(h);
  return `${usd(f.simpleCents)} the simple way${f.regularCents != null ? `, about ${usd(f.regularCents)} the regular way` : ''}. From ${sqft(h.officeSqft)}, used ${monthsWords(h.months)}.`;
}
