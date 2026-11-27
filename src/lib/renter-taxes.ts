// src/lib/renter-taxes.ts — WHAT A RENTER SETS ASIDE FOR TAXES (pure; the renter portal's Money, Your business, Taxes to
// set aside; api/portal/renter-taxes). A renter is self-employed: no one withholds tax from what they earn, so they pay it
// themselves, four times a year (IRS Form 1040-ES). From what they earn through ClarityFlow (and what they add from
// outside it) less their write-offs (lib/renter-write-offs), month by month:
//   - Self-employment tax: 15.3% of 92.35% of the year's net (12.4% Social Security up to the wage base, 2.9% Medicare),
//     none when that's under $400.
//   - Federal income tax, from the year's brackets and standard deduction for how they file, after half the
//     self-employment tax and the 20% deduction for business income (section 199A, shrinking to nothing across the
//     phase-in range for a business with no employees), counted on top of any other income in the household they say (a
//     job, a partner's pay). The extra 0.9% Medicare past $200,000 isn't counted, nor wages from a job toward the Social
//     Security wage base.
//   - State income tax at a typical rate for their state (lib/state-tax-profiles).
// Each due date asks for the tax on what's been earned so far, annualized as Form 2210's Schedule AI does (the months to
// March, May, August and December, times 4, 2.4, 1.5 and 1), a quarter of the year's tax for each date passed, less
// what they've said they paid. That's all of it, to set aside by: the least that avoids a penalty is 90% (22.5%, 45%,
// 67.5%, 90%). Paying last year's total tax in four equal parts (110% when last year's income was over $150,000) also
// avoids one. An estimate to set money aside by, not a tax return: their accountant
// works out what they owe. The year's figures (TABLES) are updated each January with the payroll tables, by the
// "Payroll and tax tables yearly update" task; a year not in yet uses the latest and says so.

export type Filing = 'single' | 'joint' | 'head';
export const FILINGS: { id: Filing; label: string }[] = [{ id: 'single', label: 'Single' }, { id: 'joint', label: 'Married, filing together' }, { id: 'head', label: 'Head of household' }];

type Table = { wageBase: number; standard: Record<Filing, number>; brackets: Record<Filing, [number, number][]>;
  /** Where the 20% deduction for business income starts to shrink, and where it's gone, for a business with no employees
   *  (taxable income before the deduction). */
  qbi: Record<Filing, [number, number]> };
// (Dollars. Brackets: [taxable income up to, rate]. 2026: IRS Rev. Proc. 2025-32; Social Security wage base: SSA.)
const TABLES: Record<number, Table> = {
  2026: {
    wageBase: 184500,
    standard: { single: 16100, joint: 32200, head: 24150 },
    brackets: {
      single: [[12400, 0.10], [50400, 0.12], [105700, 0.22], [201775, 0.24], [256225, 0.32], [640600, 0.35], [Infinity, 0.37]],
      joint: [[24800, 0.10], [100800, 0.12], [211400, 0.22], [403550, 0.24], [512450, 0.32], [768700, 0.35], [Infinity, 0.37]],
      head: [[17700, 0.10], [67450, 0.12], [105700, 0.22], [201750, 0.24], [256200, 0.32], [640600, 0.35], [Infinity, 0.37]],
    },
    qbi: { single: [201750, 276750], joint: [403500, 553500], head: [201750, 276750] },
  },
};
export const TAX_TABLE_YEARS = Object.keys(TABLES).map(Number);
/** The year's figures, or the latest ones (stale) when the year's aren't in yet. */
export function tableFor(year: number): { t: Table; year: number; stale: boolean } {
  const ys = TAX_TABLE_YEARS.filter((y) => y <= year); const y = ys.length ? Math.max(...ys) : Math.min(...TAX_TABLE_YEARS);
  return { t: TABLES[y], year: y, stale: y !== year };
}

/** Self-employment tax on a year's net, in cents. */
export function seTaxOf(netCents: number, year: number): number {
  const base = Math.max(0, netCents) * 0.9235;
  if (base < 40000) return 0;
  const { t } = tableFor(year);
  return Math.round(Math.min(base, t.wageBase * 100) * 0.124 + base * 0.029);
}

function bracketTax(taxableCents: number, filing: Filing, year: number): number {
  const { t } = tableFor(year); let tax = 0, low = 0; const x = Math.max(0, taxableCents) / 100;
  for (const [up, rate] of t.brackets[filing]) { if (x <= low) break; tax += (Math.min(x, up) - low) * rate; low = up; }
  return Math.round(tax * 100);
}

/** Federal income tax on the business's net, on top of the household's other income, in cents. */
export function incomeTaxOf(netCents: number, otherCents: number, filing: Filing, year: number): number {
  const { t } = tableFor(year); const std = t.standard[filing] * 100;
  const net = Math.max(0, netCents); const other = Math.max(0, otherCents);
  const adj = net - seTaxOf(net, year) / 2;
  const before = Math.max(0, other + adj - std);
  // (The 20% deduction for business income shrinks to nothing across the phase-in range for a business with no
  // employees, as a renter's is.)
  const [from, to] = t.qbi[filing].map((x) => x * 100);
  const keep = before <= from ? 1 : before >= to ? 0 : 1 - (before - from) / (to - from);
  const qbi = Math.max(0, Math.min(0.2 * adj * keep, 0.2 * before));
  const withBiz = bracketTax(before - qbi, filing, year);
  const without = bracketTax(Math.max(0, other - std), filing, year);
  return Math.max(0, withBiz - without);
}

/** A year's tax on a net, split: self-employment, federal income, state (`statePct`: percent). */
export function taxOn(netCents: number, o: { otherCents: number; filing: Filing; statePct: number; year: number }) {
  const net = Math.max(0, netCents);
  const se = seTaxOf(net, o.year); const federal = incomeTaxOf(net, o.otherCents, o.filing, o.year);
  const state = Math.round(Math.max(0, net - se / 2) * Math.max(0, o.statePct) / 100);
  return { se, federal, state, irs: se + federal, total: se + federal + state };
}

/** The day a payment's due: the 15th, or the next weekday (and the day after Emancipation Day or Martin Luther King Jr.
 *  Day when the 15th lands on a weekend before one). */
export function dueDay(y: number, m: number): string {
  const d = new Date(Date.UTC(y, m - 1, 15));
  const holiday = (x: Date) => {
    const mm = x.getUTCMonth() + 1, dd = x.getUTCDate(), wd = x.getUTCDay();
    if (mm === 1 && wd === 1 && dd >= 15 && dd <= 21) return true;   // Martin Luther King Jr. Day, the third Monday in January
    if (mm === 4 && (dd === 16 && wd >= 1 && wd <= 5 || dd === 17 && wd === 1 || dd === 15 && wd === 5)) return true;   // Emancipation Day (DC), or the Friday or Monday it's kept
    return false;
  };
  while (d.getUTCDay() === 0 || d.getUTCDay() === 6 || holiday(d)) d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/** The year's four payments: the months each covers, when it's due, how much to annualize by, and the year's share due. */
export function quartersOf(year: number) {
  return [
    { q: 1, through: `${year}-03-31`, months: 3, factor: 4, share: 0.25, due: dueDay(year, 4) },
    { q: 2, through: `${year}-05-31`, months: 5, factor: 2.4, share: 0.5, due: dueDay(year, 6) },
    { q: 3, through: `${year}-08-31`, months: 8, factor: 1.5, share: 0.75, due: dueDay(year, 9) },
    { q: 4, through: `${year}-12-31`, months: 12, factor: 1, share: 1, due: dueDay(year + 1, 1) },
  ];
}

/** The year a renter is paying toward on a day: last year's until its last payment (January 15) has passed. */
export function planYearOf(today: string): number {
  const y = Number(today.slice(0, 4));
  return today <= dueDay(y, 1) ? y - 1 : y;
}

export type Payment = { id: string; date: string; cents: number; to: 'irs' | 'state' };
export type PlanIn = {
  year: number; today: string;
  /** Business money in, by month ('2026-03' → cents): earned through ClarityFlow and tips the front desk collected. */
  earnedByMonth: Record<string, number>;
  /** Write-offs by month (rent, miles, costs that count). */
  writeOffsByMonth: Record<string, number>;
  /** Business income outside ClarityFlow so far this year (cash, payment apps, tips paid to them): counted in the
   *  period it's said in. */
  outsideCents: number;
  /** The household's other income for the year (a job, a partner's pay), so the business is taxed on top of it. */
  otherCents: number; filing: Filing; statePct: number;
  lastYearTaxCents: number | null;
  /** Last year's income was over $150,000: the safe amount is 110% of last year's tax. */
  lastYearHigh?: boolean;
  payments: Payment[];
};

/** The year's plan: so far, the year at this pace, and each payment. */
export function taxPlan(p: PlanIn) {
  const qs = quartersOf(p.year);
  const monthsTo = (through: string) => Object.keys({ ...p.earnedByMonth, ...p.writeOffsByMonth }).filter((m) => m.slice(0, 4) === String(p.year) && `${m}-01` <= through);
  const netThrough = (through: string) => {
    const ms = monthsTo(through);
    const inn = ms.reduce((a, m) => a + (p.earnedByMonth[m] || 0), 0); const off = ms.reduce((a, m) => a + (p.writeOffsByMonth[m] || 0), 0);
    return { inn, off };
  };
  // (Money from outside ClarityFlow counts in the period it's said in: this one.)
  const nowQ = qs.find((q) => p.today <= q.through) || qs[3];
  const opts = { otherCents: p.otherCents, filing: p.filing, statePct: p.statePct, year: p.year };
  const so = netThrough(p.today.slice(0, 4) === String(p.year) ? p.today : `${p.year}-12-31`);
  const soNet = so.inn + p.outsideCents - so.off;
  const monthsSoFar = p.today.slice(0, 4) === String(p.year) ? Math.max(1, Number(p.today.slice(5, 7))) : 12;
  const pace = taxOn(Math.round((soNet * 12) / monthsSoFar), opts);
  const paidTo = (to: 'irs' | 'state', by: string) => p.payments.filter((x) => x.to === to && x.date <= by).reduce((a, x) => a + x.cents, 0);
  const safe = p.lastYearTaxCents != null && p.lastYearTaxCents >= 0 ? Math.round((p.lastYearTaxCents * (p.lastYearHigh ? 1.1 : 1)) / 4) : null;
  const quarters = qs.map((q) => {
    const n = netThrough(q.through); const net = n.inn - n.off + (q.q >= nowQ.q ? p.outsideCents : 0);
    const annual = taxOn(Math.round(Math.max(0, net) * q.factor), opts);
    const dueIrs = Math.round(annual.irs * q.share), dueState = Math.round(annual.state * q.share);
    const irsPaid = paidTo('irs', q.due), statePaid = paidTo('state', q.due);
    const when = p.today > q.due ? 'past' : q.q === nowQ.q || (p.today > q.through && p.today <= q.due) ? 'now' : 'later';
    return { ...q, netCents: net, irsCents: Math.max(0, dueIrs - irsPaid), stateCents: Math.max(0, dueState - statePaid), irsDueSoFar: dueIrs, stateDueSoFar: dueState, irsPaid, statePaid,
      safeCents: safe != null ? Math.max(0, safe * q.q - irsPaid) : null, when: when as 'past' | 'now' | 'later' };
  });
  const next = quarters.find((q) => q.when !== 'past') || null;
  return {
    year: p.year, table: tableFor(p.year),
    soFar: { inCents: so.inn + p.outsideCents, writeOffsCents: so.off, netCents: soNet },
    pace: { netCents: Math.round((soNet * 12) / monthsSoFar), ...pace, perDollar: soNet > 0 ? pace.total / Math.max(1, Math.round((soNet * 12) / monthsSoFar)) : 0 },
    quarters, next,
    paid: { irs: paidTo('irs', '9999-12-31'), state: paidTo('state', '9999-12-31') },
  };
}

/** Settings and a payment as sent from the portal. */
export function cleanTaxSettings(b: any): { ok: true; s: any } | { ok: false; error: string } {
  const s: any = {};
  if (b.filing !== undefined) { if (!FILINGS.some((f) => f.id === b.filing)) return { ok: false, error: 'Pick how you file.' }; s.filing = b.filing; }
  if (b.state !== undefined) { const st = String(b.state || '').toUpperCase(); if (!/^[A-Z]{2}$/.test(st)) return { ok: false, error: 'Pick your state.' }; s.state = st; }
  const money = (v: any) => { const c = Math.round(Number(String(v ?? '').replace(/[$,\s]/g, '')) * 100); return Number.isFinite(c) && c >= 0 && c <= 1_000_000_000 ? c : null; };
  // (Sent in dollars, kept in cents.)
  if (b.lastYearHigh !== undefined) s.lastYearHigh = b.lastYearHigh === true;
  for (const [k, to] of [['other', 'otherCents'], ['outside', 'outsideCents'], ['lastYearTax', 'lastYearTaxCents']] as const) {
    if (b[k] === undefined) continue;
    if (b[k] === null || b[k] === '') { s[to] = to === 'lastYearTaxCents' ? null : 0; continue; }
    const c = money(b[k]); if (c == null) return { ok: false, error: 'An amount, like 1,200.' }; s[to] = c;
  }
  return { ok: true, s };
}
export function cleanTaxPayment(b: any, today: string): { ok: true; p: Omit<Payment, 'id'> } | { ok: false; error: string } {
  const date = String(b?.date || ''); const y = Number(today.slice(0, 4));
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date > today || Number(date.slice(0, 4)) < y - 1) return { ok: false, error: 'The day you paid, this year or last.' };
  const cents = Math.round(Number(String(b?.amount ?? '').replace(/[$,\s]/g, '')) * 100);
  if (!(cents > 0) || cents > 100_000_000) return { ok: false, error: 'An amount, like 850.' };
  if (b?.to !== 'irs' && b?.to !== 'state') return { ok: false, error: 'Say who you paid.' };
  return { ok: true, p: { date, cents, to: b.to } };
}
