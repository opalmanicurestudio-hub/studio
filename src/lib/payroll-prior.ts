// src/lib/payroll-prior.ts — PAY FROM BEFORE CLARITYFLOW (Settings › Payroll › Pay from before ClarityFlow; design board
// "Pay from before ClarityFlow"). For a business that ran payroll another way earlier in the year: what each person was
// paid and had withheld through the last payday elsewhere, and of it, what was since that quarter began. Kept at
// tenants/{t}/payrollRuns/prior_{year} (kind 'prior'), written only by the server (api/payroll/prior).
//   - The year so far (lib/payroll-taxes ytdFrom): Social Security stops at its limit, unemployment and the state's
//     programs at their wage limits, the extra Medicare starts over $200,000.
//   - That quarter's forms (lib/payroll-owed): Form 941 has the whole quarter, with what the old payroll deposited
//     (as entered, else what it withheld and the employer's share); the state's return and wage report the same. Unless
//     the old payroll company files that quarter's returns itself: then they leave its part out.
//   - What's owed: the federal and state taxes the old payroll deposited stay paid. Its part of that quarter's state
//     unemployment, paid with the wage report, is added to that quarter's unless the old payroll paid it.
// The year-end forms (W-2s, W-3, Form 940) cover the whole year from it.

export type PriorAmounts = { wages: number; tips: number; federal: number; ss: number; medicare: number; state: number;
  /** Wages for federal income tax (W-2 box 1, Form 941 line 2), when retirement or health came out before taxes; else
   *  the same as wages and tips. */
  fedWages?: number };
export type PriorPerson = PriorAmounts & { staffId: string; name: string; q: PriorAmounts };
export type PriorPay = { kind: 'prior'; year: number; lastPayDate: string; people: PriorPerson[];
  /** Federal unemployment the old payroll paid for the year (Form 940). */
  futaPaid: number;
  /** The old payroll company files that quarter's returns itself (its part is left off them here). */
  oldFiles?: boolean;
  /** What the old payroll deposited for that quarter: the IRS (Form 941 line 13) and state withholding; null, what it
   *  withheld and the employer's share. */
  deposits?: { irs: number | null; state: number | null };
  /** The old payroll paid its part of that quarter's state unemployment. */
  suiPaid?: boolean };

export const PRIOR_FIELDS: (keyof PriorAmounts)[] = ['wages', 'tips', 'federal', 'ss', 'medicare', 'state'];
const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const ymd = (s: any) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || '')) && !Number.isNaN(Date.parse(`${s}T12:00:00Z`));
const money = (v: any) => { const n = Number(v ?? 0); return Number.isFinite(n) && n >= 0 && n <= 1e7 ? r2(n) : null; };
const qOf = (d: string) => Math.floor((Number(d.slice(5, 7)) - 1) / 3) + 1;

/** The year's pay from before ClarityFlow, if any. */
export const priorOf = (runs: any[], year: number): PriorPay | null =>
  (runs || []).find((r) => r?.kind === 'prior' && Number(r.year) === year && Array.isArray(r.people)) || null;
/** The quarter the last payday elsewhere was in: the one its "since the quarter started" part is for. */
export const priorQuarter = (p: PriorPay) => ({ year: Number(p.lastPayDate.slice(0, 4)), q: qOf(p.lastPayDate) });
/** "April 1": the day that quarter began. */
export const quarterStartOf = (d: string) => `${d.slice(0, 4)}-${String((qOf(d) - 1) * 3 + 1).padStart(2, '0')}-01`;

/** What Settings sends, checked. A string says what's wrong. `today`: the business's own day. */
export function cleanPrior(b: any, today: string): Omit<PriorPay, 'kind'> | string {
  const last = String(b?.lastPayDate || '');
  if (!ymd(last)) return 'Pick the last payday elsewhere.';
  if (last > today) return 'The last payday elsewhere can’t be after today.';
  const year = Number(last.slice(0, 4)); if (year < Number(today.slice(0, 4)) - 1) return 'Pay from before last year isn’t needed: its forms are filed.';
  const list = Array.isArray(b?.people) ? b.people : []; if (list.length > 300) return 'Too many people.';
  const people: PriorPerson[] = []; const seen = new Set<string>();
  for (const x of list) {
    const staffId = String(x?.staffId || ''); if (!staffId || staffId.length > 128 || staffId.includes('/') || seen.has(staffId)) return 'One person isn’t right.';
    const all: any = {}, q: any = {};
    for (const k of PRIOR_FIELDS) { const a = money(x?.[k]), c = money(x?.q?.[k]); if (a === null || c === null) return `${String(x?.name || 'One person')}’s amounts aren’t numbers.`; all[k] = a; q[k] = c; }
    const name = String(x?.name || 'Team member').replace(/\s+/g, ' ').trim().slice(0, 80) || 'Team member';
    // (Federal wages, only when they differ: never more than wages and tips.)
    for (const [o, src] of [[all, x], [q, x?.q]] as const) { const f = money(src?.fedWages); if (f === null) return `${name}’s federal wages aren’t a number.`;
      if (f > 0) { if (f > o.wages + 0.005) return `${name}’s federal wages are more than their wages and tips.`; if (Math.abs(f - o.wages) >= 0.005) o.fedWages = f; } }
    if (PRIOR_FIELDS.some((k) => q[k] > all[k] + 0.005)) return `${name}’s amounts since the quarter started are more than for the year.`;
    if (all.tips > all.wages + 0.005 || q.tips > q.wages + 0.005) return `${name}’s tips are more than their wages and tips.`;
    if (!PRIOR_FIELDS.some((k) => all[k] > 0)) continue;
    seen.add(staffId); people.push({ staffId, name, ...all, q });
  }
  const futaPaid = money(b?.futaPaid); if (futaPaid === null) return 'Federal unemployment paid isn’t a number.';
  // (Deposits as entered; left empty, worked out.)
  const dep = (v: any) => (v === null || v === undefined || v === '' ? null : money(v));
  const irs = dep(b?.deposits?.irs), st = dep(b?.deposits?.state);
  if ((b?.deposits?.irs ?? '') !== '' && irs === null || (b?.deposits?.state ?? '') !== '' && st === null) return 'What the old payroll deposited isn’t a number.';
  return { year, lastPayDate: last, people, futaPaid, oldFiles: b?.oldFiles === true, deposits: { irs, state: st }, suiPaid: b?.suiPaid === true };
}

/** The old payroll's part of that quarter, for its forms: wages each tax is on, and what was withheld and deposited.
 *  Social Security wages stop at the year's limit, from what was paid before the quarter began. */
export function priorQuarterPart(p: PriorPay | null, year: number, q: number, ssBase: number) {
  if (!p || p.oldFiles) return null; const at = priorQuarter(p); if (at.year !== year || at.q !== q) return null;
  const rows = p.people.map((x) => {
    const before = Math.max(0, r2(x.wages - x.q.wages));
    const ssWages = r2(Math.min(x.q.wages, Math.max(0, ssBase - before))); const ssTips = r2(Math.min(x.q.tips, ssWages));
    const addl = r2(Math.max(0, x.wages - 200000) - Math.max(0, before - 200000));
    return { staffId: x.staffId, name: x.name, before, wages: x.q.wages, fedWages: x.q.fedWages ?? x.q.wages, tips: x.q.tips, ssWages, ssTips, medWages: x.q.wages, addlWages: addl,
      federal: x.q.federal, ss: x.q.ss, medicare: x.q.medicare, state: x.q.state };
  }).filter((x) => x.wages > 0 || x.federal > 0 || x.state > 0);
  const sum = (f: (x: typeof rows[number]) => number) => r2(rows.reduce((n, x) => n + f(x), 0));
  // (Deposited: what was withheld, and the employer's own Social Security and Medicare on the same wages.)
  const employer = r2(sum((x) => x.ssWages) * 0.062 + sum((x) => x.medWages) * 0.0145);
  const worked = r2(sum((x) => x.federal + x.ss + x.medicare) + employer);
  return { rows, wages: sum((x) => x.wages), fedWages: sum((x) => x.fedWages), federal: sum((x) => x.federal), ssWages: sum((x) => x.ssWages), ssTips: sum((x) => x.ssTips), medWages: sum((x) => x.medWages),
    addlWages: sum((x) => x.addlWages), ss: sum((x) => x.ss), medicare: sum((x) => x.medicare), state: sum((x) => x.state), employer,
    /** Owed for the quarter on its part (Form 941), and deposited: as entered, else the same. */
    owed: worked, deposited: p.deposits?.irs != null ? p.deposits.irs : worked,
    stateDeposited: p.deposits?.state != null ? p.deposits.state : sum((x) => x.state) };
}
