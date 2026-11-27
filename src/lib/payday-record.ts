// src/lib/payday-record.ts — RECORDING PAYDAY IN THE BOOKS (Money › Payday › Record payday; api/payroll/record).
//   Once per pay period, whoever records it: a payday that overlaps dates already recorded is refused.
//   The team's pay stays private: the books (which the whole team can read) get one line for the employees' pay, one for
//   contractors and one for cash tips taken home, never a line per person. Who was paid what is kept in
//   tenants/{t}/payrollRuns/payday_{periodKey}, which the owner and anyone who runs payroll read (and each person's
//   own pay stub has their part).
//   Booked once: pay a payroll company already took from the bank for these dates (the bank feed booked it: lib/plaid-sync)
//   is the employees' pay, so it's claimed for this payday instead of booking the pay again. The other way round (payday
//   recorded first, the payroll company's withdrawals after) is lib/payroll-bank.
//   Payroll run in ClarityFlow (Settings > Payroll, lib/payroll-taxes): each employee's taxes are worked out again here,
//   from their tax forms and what they've been taxed on so far this year (never the screen's own figures), and kept
//   with the payday: what each person takes home, and what the payday owes the IRS and the state, and when. The books
//   get one more line, the employer's own payroll taxes; what's withheld is part of the team's pay already, so paying
//   the IRS later is a Payroll Tax Deposit, never a second expense.
import { datedFor } from './books-close';
import { periodOf, todayIn } from './pay-periods';
import { keepOf, type PayMethod, type TaxForms } from './withholding';
import { runByOf, paydayTaxes, ytdFrom, payDateFor, dueDates, yearRunsFrom, setupOf, stateFilingOf } from './payroll-taxes';

export type PaydayPerson = { staffId: string; name: string; amount: number; cash: number; contractor: boolean; method?: PayMethod; checkNo?: string; tips?: number };
export type PaydayInput = { periodKey: string; from: string; to: string; people: PaydayPerson[]; setAsides: { key: 'tax' | 'owner' | 'profit'; label: string; amount: number }[] };

const DAY = 86400000;
const ymd = (s: any) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''));
const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T12:00:00Z`) + n * DAY).toISOString().slice(0, 10);
const c = (n: number) => Math.round(n * 100);
const money = (n: any, lo: number, hi: number) => { const v = Number(n); return Number.isFinite(v) && v >= lo && v <= hi ? Math.round(v * 100) / 100 : null; };
const ASIDE: Record<string, string> = { tax: 'Taxes', owner: 'Your pay', profit: 'Profit' };

/** What the Payday screen sends, checked: the dates, each person's pay, the set-asides. A string says what's wrong. */
export function cleanPayday(b: any): PaydayInput | string {
  const from = String(b?.from || ''), to = String(b?.to || '');
  if (!ymd(from) || !ymd(to) || from > to) return 'Pick the pay period’s dates.';
  if ((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / DAY > 62) return 'A payday covers two months at most.';
  if (String(b?.periodKey || '') !== `${from}_${to}`) return 'The dates don’t match.';
  const list = Array.isArray(b?.people) ? b.people : []; if (list.length > 300) return 'Too many people for one payday.';
  const people: PaydayPerson[] = [];
  for (const p of list) {
    const staffId = String(p?.staffId || ''); const amount = money(p?.amount, -1e6, 1e6); const cash = money(p?.cash ?? 0, 0, 1e6);
    if (!staffId || staffId.length > 128 || staffId.includes('/') || amount === null || cash === null) return 'One person’s pay isn’t a number.';
    const method = ['transfer', 'check', 'cash'].includes(p?.method) ? p.method as PayMethod : undefined;
    const checkNo = method === 'check' ? String(p?.checkNo || '').replace(/[^0-9A-Za-z-]/g, '').slice(0, 12) : '';
    const tips = money(p?.tips ?? 0, 0, 1e6) ?? 0;
    people.push({ staffId, name: String(p?.name || 'Team member').replace(/\s+/g, ' ').trim().slice(0, 80) || 'Team member', amount, cash, contractor: p?.contractor === true,
      ...(method ? { method } : {}), ...(checkNo ? { checkNo } : {}), ...(tips ? { tips } : {}) });
  }
  const asides: PaydayInput['setAsides'] = [];
  for (const a of Array.isArray(b?.setAsides) ? b.setAsides.slice(0, 4) : []) {
    const key = String(a?.key || ''); const amount = money(a?.amount, 0, 1e7);
    if (!(key in ASIDE) || amount === null) return 'A set-aside isn’t right.';
    if (amount > 0) asides.push({ key: key as any, label: String(a?.label || '').replace(/[^\w ()&,.'-]/g, '').trim().slice(0, 40) || ASIDE[key], amount });
  }
  if (!people.some((p) => p.amount > 0 || p.cash > 0) && !asides.length) return 'There’s nothing to record.';
  return { periodKey: `${from}_${to}`, from, to, people, setAsides: asides };
}

/** The days a payroll company's withdrawal for these dates can fall on: from a few days before the period ends to its
 *  payday (the business's own pay periods), or a week after the last day for dates picked by hand. */
export function bankWindow(tenant: any, from: string, to: string): { first: string; last: string } {
  const p = periodOf(tenant, from); const own = p.from === from && p.to === to; const payday = own ? p.payday : addDays(to, 7);
  // (Never back into the period before's: its payday is its own, with weekly pay only days before this one ends.)
  const before = periodOf(tenant, addDays(from, -1)).payday; const first = addDays(to, -3);
  return { first: own && before >= first ? addDays(before, 1) : first, last: payday };
}
/** A payroll company's line the bank feed booked on its own (lib/plaid-sync), not yet part of any payday. */
export const bankPayrollLine = (t: any) => (t?.type || 'expense') === 'expense' && String(t?.paymentMethod || '') === 'Bank feed' && /^payroll( taxes)?$/i.test(String(t?.category || ''))
  && !t?.paydayPeriod && (t?.context || 'Business') === 'Business' && t?.voided !== true;

export type RecordResult = { ok: true; recordedAt: string; viaBankCents: number; lines: number; taxes?: { employee: number; employer: number; takeHome: number; owed: number } }
  | { ok: false; status: number; error: string; recorded?: { on: string; from: string; to: string } };

/** `forms`: each employee's tax forms (staffPay taxForms), read by the route; used when payroll is run in ClarityFlow. */
export async function recordPayday(db: any, tenantId: string, tenant: any, input: PaydayInput, actor: { id?: string; name?: string } = {}, nowIso = new Date().toISOString(),
  forms: Record<string, TaxForms | null | undefined> = {}): Promise<RecordResult> {
  const T = `tenants/${tenantId}`; const { from, to, periodKey } = input;
  const mark = { paydayPeriod: periodKey, paydayFrom: from, paydayTo: to };
  const dated = datedFor(tenant, nowIso);
  const win = bankWindow(tenant, from, to); const lastDay = win.last < nowIso.slice(0, 10) ? win.last : nowIso.slice(0, 10);
  const r2 = (n: number) => Math.round(n * 100) / 100;
  const employees = input.people.filter((p) => !p.contractor), contractors = input.people.filter((p) => p.contractor);
  const sum = (xs: PaydayPerson[], f: (p: PaydayPerson) => number) => r2(xs.reduce((n, p) => n + f(p), 0));
  // (Booked for each person: what they're paid on payday, and the cash tips they took home; never below nothing.)
  const paid = (p: PaydayPerson) => Math.max(0, p.amount), cash = (p: PaydayPerson) => r2(Math.min(p.cash, Math.max(0, p.amount + p.cash)));
  return db.runTransaction(async (tx: any) => {
    // Once per pay period: anything recorded for dates that overlap these is this payday already.
    const there = (await tx.get(db.collection(`${T}/transactions`).where('paydayTo', '>=', from).limit(200))).docs.map((d: any) => d.data() || {})
      .find((t: any) => String(t.paydayFrom || '') <= to);
    if (there) return { ok: false as const, status: 409, error: 'Payday for these dates is already in your books.', recorded: { on: String(there.date || nowIso), from: String(there.paydayFrom), to: String(there.paydayTo) } };
    // The payroll company's withdrawals the bank booked for these dates (sorted by the app or by hand): the employees'
    // pay, already in the books. (Read from the bank's own lines for those days, then the line each was booked as.)
    const booked = (await tx.get(db.collection(`${T}/bankTransactions`).where('date', '>=', win.first).limit(1000))).docs.map((d: any) => d.data() || {})
      .filter((b: any) => b.direction === 'out' && String(b.date || '') <= lastDay && ['auto_categorized', 'created'].includes(String(b.status)) && b.matchedTxnId)
      .map((b: any) => String(b.matchedTxnId)).slice(0, 100);
    const bank = (await Promise.all(booked.map((id: string) => tx.get(db.doc(`${T}/transactions/${id}`)))))
      .filter((d: any) => d.exists).map((d: any) => ({ ref: d.ref, id: d.id, ...(d.data() || {}) })).filter((t: any) => bankPayrollLine(t));
    const viaBankCents = bank.reduce((n: number, t: any) => n + c(Number(t.amount) || 0), 0);
    // Payroll run in ClarityFlow: each employee's taxes, from their forms and the paydays already recorded this year.
    const self = runByOf(tenant) === 'clarityflow' && employees.some((p) => p.amount + p.cash > 0);
    const payDate = payDateFor(tenant, from, to, todayIn(tenant, Date.parse(nowIso)));
    let tax: ReturnType<typeof paydayTaxes> | null = null;
    if (self) {
      const year = Number(payDate.slice(0, 4));
      const runs = (await tx.get(db.collection(`${T}/payrollRuns`).where('recordedAt', '>=', yearRunsFrom(year)).limit(500))).docs.map((d: any) => d.data() || {});
      tax = paydayTaxes({ tenant, payDate, forms, ytd: ytdFrom(runs, tenant, year, periodKey),
        people: employees.map((p) => ({ staffId: p.staffId, gross: r2(Math.max(0, p.amount + p.cash)), inHand: cash(p) })) });
    }
    const writes: { ref: any; data: any }[] = [];
    const line = (id: string, data: any) => writes.push({ ref: db.doc(`${T}/transactions/${id}`), data: { id, tenantId, ...dated, type: 'expense', context: 'Business', hasReceipt: false, createdAt: nowIso, ...mark, ...data } });
    const n = (k: number, one: string, many: string) => `${k} ${k === 1 ? one : many}`;
    // (What the bank has already counts toward the employees' pay; the rest is booked here, and a later withdrawal for it
    // is matched to it: lib/payroll-bank.)
    const employeePay = sum(employees, paid); const teamLeft = r2(employeePay - viaBankCents / 100);
    // (The employer's own payroll taxes; what the bank already has beyond the team's pay counts toward them.)
    const employerTaxes = tax ? tax.employerTotal : 0; const taxLeft = r2(employerTaxes - Math.max(0, viaBankCents / 100 - employeePay));
    if (teamLeft > 0) line(`payday_${periodKey}_team`, { description: `Payday: team pay, ${n(employees.filter((p) => paid(p) > 0).length, 'person', 'people')}${viaBankCents ? `, less $${(viaBankCents / 100).toFixed(2)} already in from the bank` : ''}`, clientOrVendor: 'Team pay', category: 'Payroll', taxBucket: 'payroll', amount: teamLeft, paymentMethod: 'Distribution' });
    const contractorPay = sum(contractors, (p) => paid(p) + cash(p));
    if (contractorPay > 0) line(`payday_${periodKey}_contractors`, { description: `Payday: ${n(contractors.length, 'contractor', 'contractors')}`, clientOrVendor: 'Contractors', category: 'Contract Labor', taxBucket: 'operating_cost', amount: contractorPay, paymentMethod: 'Distribution' });
    const cashTips = sum(employees, cash);
    if (cashTips > 0) line(`paydaycash_${periodKey}`, { description: 'Cash tips taken home', clientOrVendor: 'Team pay', category: 'Payroll', taxBucket: 'payroll', amount: cashTips, paymentMethod: 'Cash' });
    if (taxLeft > 0) line(`paydaytax_${periodKey}`, { description: `Payday: payroll taxes you pay as the employer, ${n(Object.keys(tax?.by || {}).length, 'person', 'people')}`, clientOrVendor: 'Payroll taxes', category: 'Payroll Taxes', taxBucket: 'payroll', amount: taxLeft, paymentMethod: 'Distribution' });
    for (const a of input.setAsides) line(`setaside_${periodKey}_${a.key}`, { description: `Set aside: ${a.label}`, clientOrVendor: 'Internal Distribution', category: 'Distribution', taxBucket: 'transfer', amount: a.amount, paymentMethod: 'Internal Transfer' });
    if (!writes.length && !bank.length) return { ok: false as const, status: 400, error: 'There’s nothing to record.' };
    // (Written only when none is there: a second tap, or two devices at once, can't book it twice.)
    const exist = await Promise.all(writes.map((w) => tx.get(w.ref)));
    if (exist.some((d: any) => d.exists)) return { ok: false as const, status: 409, error: 'Payday for these dates is already in your books.', recorded: { on: nowIso, from, to } };
    writes.forEach((w) => tx.set(w.ref, w.data));
    for (const b of bank) tx.set(b.ref, { ...mark, paydayClaimedAt: nowIso }, { merge: true });
    tx.set(db.doc(`${T}/payrollRuns/payday_${periodKey}`), {
      kind: 'payday', periodKey, from, to, recordedAt: nowIso, recordedBy: { id: actor.id || null, name: actor.name || null },
      payDate, runBy: runByOf(tenant),
      people: input.people.map((p) => { const w = tax?.by[p.staffId];
        return { staffId: p.staffId, name: p.name, paid: paid(p), cashTips: cash(p), contractor: p.contractor, ...(p.method ? { method: p.method } : {}), ...(p.checkNo ? { checkNo: p.checkNo } : {}),
          ...(p.tips ? { tips: p.tips } : {}), ...(w ? { taxes: keepOf(w), takeHome: w.takeHome } : {}) }; }),
      employeesTotal: employeePay, contractorsTotal: contractorPay, cashTipsTotal: cashTips, setAsides: input.setAsides,
      ...(bank.length ? { viaBank: bank.map((b: any) => b.id), viaBankCents } : {}),
      ...(tax ? { taxes: { employee: tax.employeeTotal, employer: tax.employerTotal, takeHome: tax.takeHome, pretax: tax.pretax, owed: tax.owed, due: dueDates(payDate, tenant),
        // (How they're to be paid, as the settings were then: lib/payroll-owed groups them by it.)
        schedule: { irs: setupOf(tenant).federalDeposits === 'semiweekly' ? 'semiweekly' : 'monthly', state: stateFilingOf(tenant) } } } : {}),
    });
    return { ok: true as const, recordedAt: nowIso, viaBankCents, lines: writes.length, ...(tax ? { taxes: { employee: tax.employeeTotal, employer: tax.employerTotal, takeHome: tax.takeHome, owed: tax.owed.total } } : {}) };
  });
}
