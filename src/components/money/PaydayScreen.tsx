'use client';
// src/components/money/PaydayScreen.tsx — PAYDAY, READ LIKE A STATEMENT (the Money page's Payday tab; design board "A.
// Payday, read like a statement"). What came in this pay period, what goes out on payday (the team's pay and the bills
// due), what's left, and the split to set aside from it. Every figure is worked out by the Payday tab (money/page.tsx:
// lib/pay-period for the pay, the business's own state for the taxes) and handed in; this screen lays it out and hands
// the taps back. When payroll is run in ClarityFlow (design board "Payroll run in ClarityFlow", A), each person shows
// what they take home after taxes, the taxes under it and how they're paid, and the taxes to keep for later have
// their own card, with when each is due (lib/withholding, lib/payroll-taxes).
import * as React from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

const INK = '#16171a', MUTED = '#6d7075', LINE = '#ececee', SOFT = '#f5f5f7', GREEN = '#1f7a4d', GREEN_TINT = '#eaf6ef', AMBER = '#b45309', AMBER_TINT = '#fff7ed';
const RING = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#16171a] focus-visible:ring-offset-2';
const btn = `inline-flex min-h-[44px] items-center justify-center rounded-full px-4 text-[14px] font-semibold disabled:opacity-50 ${RING}`;
const solid = { background: INK, color: '#fff' }; const plain = { background: '#fff', color: INK, border: `1px solid ${LINE}` };
const card = 'rounded-3xl bg-[#fff] px-5 pb-3 pt-4';
const field = `h-11 rounded-xl bg-[#fff] px-3 text-[14px] ${RING}`;
export const usd = (n: number) => `$${Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
/** Whole dollars without the cents ("$480"), anything else with them ("$212.50"). */
const short = (n: number) => (Math.round(n * 100) % 100 === 0 ? `$${Math.round(Math.abs(n)).toLocaleString('en-US')}` : usd(n));
const ymd = (x: Date) => `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;

export type PayPerson = {
  id: string; name: string; avatarUrl?: string;
  /** What's paid on payday (what they earned and any approved correction, less cash tips they already took home). */
  amount: number; tips?: number; cashTips?: number; hours?: number; commissionPay?: number; bonus?: number;
  overtimeHours?: number; doubleOvertimeHours?: number; missingClockOuts?: number; unapprovedSessions?: number; noHours?: boolean; payStructure?: string;
  contractor?: boolean; adjustments?: number; tipsInHand?: number;
};
export type PayBill = { id: string; name: string; amount: number; due: Date; personal?: boolean };
export type PayMethod = 'transfer' | 'check' | 'cash';
/** One employee's taxes this payday (lib/withholding), as the screen shows them. */
export type PersonTax = {
  gross: number; takeHome: number; employeeTotal: number; federal: number; fica: number; state: number;
  other: { name: string; amount: number }[]; pretax: number; short: number;
  stateHow: 'none' | 'built_in' | 'percent' | 'missing'; noW4: boolean; noStateForm: boolean; exempt: boolean;
};
/** Payroll run in ClarityFlow: each employee's taxes and take-home, and what the payday owes, to whom and when. */
export type SelfRun = {
  people: Record<string, PersonTax>;
  takeHome: number; employeeTaxes: number; employerTaxes: number; pretax: number;
  owed: { key: string; name: string; sub: string; amount: number }[]; owedTotal: number;
  /** "North Carolina"; the state's own form ("NC-4") when it's built in. */
  stateName: string; stateForm?: string | null;
  methods: Record<string, { method: PayMethod; checkNo: string }>;
  onMethod: (id: string, method: PayMethod, checkNo: string) => void;
  /** Open someone's tax forms (managers): left out for someone who can't change them. */
  onForms?: (id: string) => void;
  /** Settings > Payroll. */
  payrollHref: string;
  /** The tax tables are older than the payday's year. */
  stale?: boolean;
};
const METHODS: { v: PayMethod; label: string }[] = [{ v: 'transfer', label: 'Bank transfer' }, { v: 'check', label: 'Check' }, { v: 'cash', label: 'Cash' }];
/** One part of the split: taxes, the owner's own pay, profit, and what stays to run the business. */
export type SetAsidePart = { key: 'tax' | 'owner' | 'profit' | 'opex'; pct: number; amount: number };
const PART_NAMES: Record<SetAsidePart['key'], string> = { tax: 'Taxes', owner: 'Your pay', profit: 'Profit', opex: 'Running the business' };
const PART_ORDER: SetAsidePart['key'][] = ['tax', 'owner', 'profit', 'opex'];

/** "November 16 to 29", "November 23 to December 6", with the year when it isn't this one. */
export function spanWords(from: Date, to: Date, now = new Date()): string {
  const M = (d: Date) => d.toLocaleDateString('en-US', { month: 'long' });
  const yr = to.getFullYear() !== now.getFullYear() ? `, ${to.getFullYear()}` : '';
  if (from.getFullYear() !== to.getFullYear()) return `${M(from)} ${from.getDate()}, ${from.getFullYear()} to ${M(to)} ${to.getDate()}, ${to.getFullYear()}`;
  if (from.getMonth() !== to.getMonth()) return `${M(from)} ${from.getDate()} to ${M(to)} ${to.getDate()}${yr}`;
  return from.getDate() === to.getDate() ? `${M(from)} ${from.getDate()}${yr}` : `${M(from)} ${from.getDate()} to ${to.getDate()}${yr}`;
}

/** What a person's pay is made of, in words: "52 hours, $480 in commission, $212 in tips". */
export function payWords(p: PayPerson): string {
  const parts: string[] = [];
  if (p.payStructure === 'salary') parts.push('Salary');
  const h = Math.round((Number(p.hours) || 0) * 100) / 100;
  const ot = Math.round(((Number(p.overtimeHours) || 0) + (Number(p.doubleOvertimeHours) || 0)) * 100) / 100;
  if (h > 0) parts.push(`${h} hour${h === 1 ? '' : 's'}${ot > 0 ? ` (${ot} overtime)` : ''}`);
  const c = Number(p.commissionPay) || 0; if (c > 0) parts.push(`${short(c)} ${p.payStructure === 'per_service' ? 'for services' : 'in commission'}`);
  const adj = Number(p.adjustments) || 0; const b = (Number(p.bonus) || 0) - adj; if (b > 0.004) parts.push(`${short(b)} extra for overtime or minimum wage`);
  const t = Number(p.tips) || 0; if (t > 0) parts.push(`${short(t)} in tips`);
  if (adj) parts.push(`${short(adj)} ${adj < 0 ? 'taken off' : 'added'} by an approved correction`);
  const inHand = Number(p.tipsInHand) || 0; if (inHand > 0) parts.push(`${short(inHand)} in cash tips already taken home`);
  return parts.join(', ') || 'Pay set for the period';
}

/** "Rent", "Rent and Phone", "3 bills" (a bill's own name can have a comma in it). */
const namesOf = (names: string[]) => names.length <= 2 ? names.join(' and ') : `${names.length} bills`;
/** "Kim", "Kim and Rae", "Kim, Rae and 2 more". */
const peopleOf = (names: string[]) => names.length <= 2 ? names.join(' and ') : `${names.slice(0, 2).join(', ')} and ${names.length - 2} more`;

const Row = ({ label, sub, value, tone }: { label: React.ReactNode; sub?: React.ReactNode; value: React.ReactNode; tone?: 'total' | 'good' | 'short' }) => (
  <div className="flex min-h-[44px] items-center justify-between gap-3 py-2" style={{ borderTop: `1px solid ${tone ? INK : LINE}`, fontWeight: tone ? 600 : undefined }}>
    <span className="min-w-0"><span className="block">{label}</span>{sub && <span className="block text-[13px] font-normal" style={{ color: tone === 'short' ? AMBER : MUTED }}>{sub}</span>}</span>
    <span className="shrink-0 tabular-nums" style={{ color: tone === 'good' ? GREEN : tone === 'short' ? AMBER : INK }}>{value}</span>
  </div>
);
const Note = ({ children, warn }: { children: React.ReactNode; warn?: boolean }) => (
  <p className="mt-2 rounded-2xl px-4 py-3 text-[14px]" style={warn ? { background: AMBER_TINT, color: AMBER } : { background: SOFT, color: MUTED }}>{children}</p>
);

/** Under a person: the taxes taken out, what's missing from their forms, and anything that couldn't be taken. */
function TaxLines({ t, self, id }: { t: PersonTax; self: SelfRun; id: string }) {
  const parts = [`federal ${usd(t.federal)}`, `Social Security and Medicare ${usd(t.fica)}`];
  if (t.stateHow !== 'none' && t.stateHow !== 'missing') parts.push(`${self.stateName || 'state'} ${usd(t.state)}`);
  for (const o of t.other) parts.push(`${o.name} ${usd(o.amount)}`);
  const form = self.stateForm || 'state form';
  const missing = t.noW4 && t.noStateForm ? { text: `No W-4 or ${form} on file. Taxed as single until they’re added, as the IRS and ${self.stateName} require.`, add: 'Add them' }
    : t.noW4 ? { text: 'No W-4 on file. Taxed as single until one is added, as the IRS requires.', add: 'Add W-4' }
    : t.noStateForm ? { text: `No ${form} on file. ${self.stateName} tax is as single with no allowances until one is added.`, add: `Add ${form}` } : null;
  return (<>
    <span className="block text-[13px]" style={{ color: MUTED }}>Withheld {usd(t.employeeTotal)}: {parts.join(', ')}{t.exempt ? '. Exempt from federal income tax on their W-4' : ''}</span>
    {t.pretax > 0 && <span className="block text-[13px]" style={{ color: MUTED }}>{usd(t.pretax)} taken out before taxes for retirement and health</span>}
    {t.stateHow === 'missing' && <a href={self.payrollHref} className={`-my-1 flex min-h-[44px] items-center text-[13px] font-semibold underline underline-offset-2 ${RING}`} style={{ color: AMBER }}>{self.stateName || 'State'} income tax isn’t set up yet, so none is taken out. Set it up</a>}
    {missing && <span className="block text-[13px] font-semibold" style={{ color: AMBER }}>{missing.text}{!self.onForms ? ' A manager can add it.' : ''}</span>}
    {missing && self.onForms && <button type="button" onClick={() => self.onForms!(id)} className={`-my-1 block min-h-[44px] text-left text-[13px] font-semibold underline underline-offset-2 ${RING}`} style={{ color: INK }}>{missing.add}</button>}
    {t.short > 0 && <span className="block text-[13px] font-semibold" style={{ color: AMBER }}>The paycheck is too small for all the taxes: {usd(t.short)} can’t be withheld. Ask your accountant how to collect it.</span>}
  </>);
}
/** How a person is paid this payday, and the check number for a check. */
function PaidBy({ id, name, self }: { id: string; name: string; self: SelfRun }) {
  const m = self.methods[id] || { method: 'transfer' as PayMethod, checkNo: '' };
  return (
    <span className="mt-1 flex flex-wrap items-center gap-2">
      <label className="inline-flex flex-wrap items-center gap-x-2 gap-y-1 text-[14px]" style={{ color: MUTED }}><span className="whitespace-nowrap">Paid by</span>
        <select value={m.method} onChange={(e) => self.onMethod(id, e.target.value as PayMethod, m.checkNo)} aria-label={`How ${name} is paid`} className={field} style={{ border: `1px solid ${LINE}`, color: INK }}>
          {METHODS.map((x) => <option key={x.v} value={x.v}>{x.label}</option>)}
        </select></label>
      {m.method === 'check' && <label className="inline-flex flex-wrap items-center gap-x-2 gap-y-1 text-[14px]" style={{ color: MUTED }}><span className="whitespace-nowrap">Check number</span>
        <input value={m.checkNo} onChange={(e) => self.onMethod(id, 'check', e.target.value.replace(/[^0-9A-Za-z-]/g, '').slice(0, 12))} inputMode="numeric" className={`${field} w-[96px]`} style={{ border: `1px solid ${LINE}`, color: INK }} /></label>}
    </span>
  );
}

export type PaydayScreenProps = {
  /** The period's first and last day (the business's own pay periods, Settings > Time clock), and its payday. */
  from: Date; to: Date; payday: Date | null; cadenceWords: string; settingsHref: string;
  onEarlier: () => void; onLater: () => void;
  /** Pick dates: a one-off set of dates instead of a pay period. */
  custom: boolean; onPickDates: (on: boolean) => void;
  onFirstDay: (v: string) => void; onLastDay: (v: string) => void;
  /** Sales and other money in, less what was spent, for these dates. */
  cameIn: number;
  team: PayPerson[]; teamTotal: number; employerTaxes: number;
  /** Cash tips the team took home the same day: part of what they earned, out of the till already, never paid again. */
  cashTipsOut?: number;
  /** Why payday can't be recorded or sent from here right now (a part of the pay that couldn't be read). */
  blocked?: string | null;
  bills: PayBill[];
  tax: {
    hasState: boolean; stateName: string; employerPct: number; regionLabel: string; note?: string; stale?: string;
    state: string | null; states: { code: string; label: string }[]; onState: (code: string) => void; canPickState: boolean;
    country: string; countries: { code: string; name: string; enabled: boolean }[]; onCountry: (code: string) => void;
  };
  gusto: { connected: boolean; companyName?: string };
  /** Who runs payroll (Settings > Payroll), and, when it's ClarityFlow, everyone's taxes. */
  runBy?: 'clarityflow' | 'gusto' | 'company';
  selfRun?: SelfRun | null;
  /** Nobody has said who works out the payroll taxes yet (and Gusto isn't connected): asked once, here. `onPick` is
   *  left out for someone who can't change it (only the owner can). */
  askRunBy?: { onPick?: (v: 'clarityflow' | 'gusto' | 'company') => void } | null;
  onConnectGusto: () => void; onSendToGusto: () => void; sendingToGusto: boolean;
  /** Employees with pay who aren't matched to anyone in Gusto yet (payroll waits for them), the matching card itself, and
   *  the pay period as a spreadsheet for another payroll company. */
  gustoUnmatched?: string[]; gustoSlot?: React.ReactNode; onExport?: () => void;
  autoDraft: boolean; onAutoDraft: (on: boolean) => void;
  draft: { from: Date; to: Date; people: number; gross: number; taxes: number } | null; onOpenDraft: () => void;
  setAside: number; onSetAside: (n: number) => void; parts: SetAsidePart[];
  onRecord: () => void; recording: boolean;
  /** When payday for these dates went into the books (it's recorded once), and the dates it was for when they're not
   *  quite these (a payday that overlaps them). */
  recordedOn: Date | null; recordedSpan?: string | null;
  statementFor: string | null; onStatement: (id: string | null) => void; statement: (p: PayPerson) => React.ReactNode;
  /** All bills (the Bills tab); left out for someone who only runs payroll. */
  onSeeBills?: () => void;
  now?: Date;
};

export function PaydayScreen(p: PaydayScreenProps) {
  const now = p.now || new Date();
  const [datesOpen, setDatesOpen] = React.useState(false);
  const teamRef = React.useRef<HTMLElement>(null);
  const billsTotal = p.bills.reduce((n, b) => n + (Number(b.amount) || 0), 0);
  const payday = p.teamTotal + p.employerTaxes;
  const cashOut = Math.round((Number(p.cashTipsOut) || 0) * 100) / 100;
  const left = Math.round((p.cameIn - payday - cashOut - billsTotal) * 100) / 100;
  const custom = p.custom;
  const words = spanWords(p.from, p.to, now);
  const paydayWords = p.payday ? p.payday.toLocaleDateString('en-US', { month: 'long', day: 'numeric' }) : '';
  const employees = p.team.filter((o) => !o.contractor); const contractors = p.team.length - employees.length;
  const contractorPay = p.team.filter((o) => o.contractor).reduce((n, o) => n + (Number(o.amount) || 0), 0);
  const self = p.runBy === 'clarityflow' ? p.selfRun || null : null;
  const runBy = p.runBy || (p.gusto.connected ? 'gusto' : 'clarityflow');
  const later = self ? Math.round((self.employeeTaxes + self.employerTaxes) * 100) / 100 : 0;
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const parts = PART_ORDER.map((k) => p.parts.find((x) => x.key === k)).filter(Boolean) as SetAsidePart[];
  const toTeam = () => { teamRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }); teamRef.current?.focus({ preventScroll: true }); };

  const period = (
    <section aria-label="This pay period" className={card} style={{ border: `1px solid ${LINE}` }}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-[17px] font-semibold">This pay period</h3>
          <p className="text-[14px]" style={{ color: MUTED }}>{words}.{!custom && paydayWords ? ` Payday is ${paydayWords}. You pay ${p.cadenceWords}.` : ' Dates you picked.'}</p>
        </div>
        {!custom && <div className="flex shrink-0 gap-1">
          <button type="button" onClick={p.onEarlier} aria-label="The pay period before" className={`flex h-11 w-11 items-center justify-center rounded-full ${RING}`} style={plain}><ChevronLeft className="h-5 w-5" /></button>
          <button type="button" onClick={p.onLater} aria-label="The pay period after" className={`flex h-11 w-11 items-center justify-center rounded-full ${RING}`} style={plain}><ChevronRight className="h-5 w-5" /></button>
        </div>}
      </div>
      {(datesOpen || custom) && (
        <div className="mt-3 rounded-2xl p-3" style={{ background: SOFT }}>
          <p className="text-[14px]" style={{ color: MUTED }}>Your pay periods and payday come from <a href={p.settingsHref} className="underline underline-offset-2" style={{ color: INK }}>pay period settings</a>, so stubs, drafts and Payday all use the same dates.</p>
          <div className="mt-2 flex flex-wrap gap-2" role="group" aria-label="Which dates">
            <button type="button" onClick={() => p.onPickDates(false)} aria-pressed={!custom} className={`min-h-[44px] rounded-full px-4 text-[14px] ${RING}`} style={!custom ? { background: INK, color: '#fff', fontWeight: 600 } : plain}>A pay period</button>
            <button type="button" onClick={() => p.onPickDates(true)} aria-pressed={custom} className={`min-h-[44px] rounded-full px-4 text-[14px] ${RING}`} style={custom ? { background: INK, color: '#fff', fontWeight: 600 } : plain}>Pick dates, for a one-off</button>
          </div>
          {custom && <div className="mt-3 flex flex-wrap items-center gap-2">
            <label className="inline-flex items-center gap-2 text-[14px]" style={{ color: MUTED }}>First day
              <input type="date" value={ymd(p.from)} onChange={(e) => p.onFirstDay(e.target.value)} className={field} style={{ border: `1px solid ${LINE}`, color: INK }} /></label>
            <label className="inline-flex items-center gap-2 text-[14px]" style={{ color: MUTED }}>Last day
              <input type="date" value={ymd(p.to)} onChange={(e) => p.onLastDay(e.target.value)} className={field} style={{ border: `1px solid ${LINE}`, color: INK }} /></label>
          </div>}
        </div>
      )}
      <div className="mt-3">
        <Row label="Came in, after costs" sub="Sales, tips and other income, less refunds and costs. Sales tax and money held for others aren’t in it." value={`${p.cameIn < 0 ? '−' : ''}${usd(p.cameIn)}`} />
        <Row label="Your team’s pay" sub={!p.team.length ? 'Nobody has pay for these dates yet' : contractors ? `Hours, commission and tips. ${usd(contractorPay)} of it to ${contractors === 1 ? 'a contractor' : `${contractors} contractors`}` : 'Hours, commission and tips, from the time clock and checkouts'} value={p.teamTotal ? `−${usd(p.teamTotal)}` : usd(0)} />
        {cashOut > 0 && <Row label="Cash tips taken home" sub="Paid out of the till the same day, so they aren’t paid again on payday" value={`−${usd(cashOut)}`} />}
        {p.employerTaxes > 0 && <Row label="Payroll taxes you pay as the employer" sub={self ? 'Worked out from each person’s pay' : `An estimate, about ${p.tax.employerPct}% of pay${p.tax.hasState ? ` in ${p.tax.stateName}` : ''}`} value={`−${usd(p.employerTaxes)}`} />}
        <Row label="Bills due these dates" sub={p.bills.length ? namesOf(p.bills.map((b) => b.name)) : 'None left to pay'} value={billsTotal ? `−${usd(billsTotal)}` : usd(0)} />
        {left >= 0
          ? <Row label="Left after payday" value={usd(left)} tone="good" />
          : <Row label="Short after payday" sub="What came in these dates doesn’t cover payday and the bills." value={`−${usd(left)}`} tone="short" />}
      </div>
      <div className="mt-3 flex flex-wrap gap-2 pb-1">
        {p.team.length > 0 && <button type="button" onClick={toTeam} className={btn} style={solid}>Review and pay the team</button>}
        <button type="button" onClick={() => { if (custom) { p.onPickDates(false); setDatesOpen(false); } else setDatesOpen((o) => !o); }} aria-expanded={datesOpen || custom} className={btn} style={plain}>{custom ? 'Back to pay periods' : datesOpen ? 'Hide the dates' : 'Change the dates'}</button>
      </div>
    </section>
  );

  const team = (
    <section ref={teamRef} tabIndex={-1} id="payday-team" aria-label="Your team" className={`${card} scroll-mt-24 focus:outline-none`} style={{ border: `1px solid ${LINE}` }}>
      <h3 className="text-[17px] font-semibold">Your team</h3>
      <p className="text-[14px]" style={{ color: MUTED }}>{self ? `What each person earned, the taxes withheld, and what they take home. Worked out from their W-4${self.stateForm ? ` and ${self.stateForm}` : ''}.` : `What each person earned these dates.${runBy === 'gusto' && p.gusto.connected ? ` Gusto is connected, so payday goes through ${p.gusto.companyName || 'Gusto'}.` : ''}`}</p>
      {p.askRunBy && (
        <div className="mt-3 rounded-2xl p-4" style={{ background: SOFT }}>
          <p className="text-[15px] font-semibold">Who works out your team’s payroll taxes?</p>
          <p className="mt-1 text-[14px]" style={{ color: MUTED }}>ClarityFlow can work out each person’s taxes and take-home pay from their W-4, with pay stubs and what you owe and when, and you pay from your bank. Or Gusto, or another payroll company, works them out and files.</p>
          {p.askRunBy.onPick
            ? <div className="mt-3 flex flex-wrap gap-2">
                <button type="button" onClick={() => p.askRunBy!.onPick!('clarityflow')} className={btn} style={solid}>ClarityFlow</button>
                <button type="button" onClick={() => p.askRunBy!.onPick!('gusto')} className={btn} style={plain}>Gusto</button>
                <button type="button" onClick={() => p.askRunBy!.onPick!('company')} className={btn} style={plain}>Another payroll company</button>
              </div>
            : <p className="mt-2 text-[13px]" style={{ color: MUTED }}>The owner picks this in Settings, Payroll.</p>}
        </div>
      )}
      <div className="mt-2">
        {p.team.length === 0 && <p className="py-3 text-[14px]" style={{ color: MUTED, borderTop: `1px solid ${LINE}` }}>No pay for these dates yet. It shows here from the time clock and checkouts.</p>}
        {p.team.map((o) => {
          const open = p.statementFor === o.id;
          const miss = Number(o.missingClockOuts) || 0, waiting = Number(o.unapprovedSessions) || 0;
          const tx = self && !o.contractor ? self.people[o.id] || null : null;
          return (
            <div key={o.id} style={{ borderTop: `1px solid ${LINE}` }}>
              <div className="flex min-h-[56px] items-start gap-3 pt-3">
                {o.avatarUrl
                  ? <img src={o.avatarUrl} alt="" className="h-9 w-9 shrink-0 rounded-full object-cover" />
                  : <span aria-hidden className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full font-semibold" style={{ background: SOFT, color: MUTED }}>{(o.name || '?').charAt(0)}</span>}
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-1.5"><span>{o.name}</span>{o.contractor && <span className="rounded-full px-2 py-0.5 text-[12px] font-semibold" style={{ background: SOFT, color: MUTED }}>Contractor</span>}</span>
                  <span className="block text-[13px]" style={{ color: MUTED }}>{payWords(o)}</span>
                  {miss > 0 && <a href="/timesheets" className="block text-[13px] font-semibold underline underline-offset-2" style={{ color: AMBER }}>{miss} forgotten clock-out{miss === 1 ? '' : 's'}, not paid until fixed on Timesheets</a>}
                  {waiting > 0 && <a href="/timesheets" className="block text-[13px] font-semibold underline underline-offset-2" style={{ color: AMBER }}>{waiting} shift{waiting === 1 ? '' : 's'} waiting for approval, not paid yet</a>}
                  {o.noHours && !o.contractor && <span className="block text-[13px]" style={{ color: AMBER }}>No hours on the clock, so minimum wage and overtime can’t be checked</span>}
                  {tx && <span className="block text-[13px] sm:hidden" style={{ color: MUTED }}>Takes home {usd(tx.takeHome)} of {usd(tx.gross)} earned</span>}
                  {tx && <TaxLines t={tx} self={self!} id={o.id} />}
                  {self && o.contractor && <span className="block text-[13px]" style={{ color: MUTED }}>Nothing is taken out.</span>}
                  {self && (tx || o.contractor) && <PaidBy id={o.id} name={o.name} self={self} />}
                  <button type="button" onClick={() => p.onStatement(open ? null : o.id)} aria-expanded={open} className={`-my-1 min-h-[44px] text-left text-[13px] underline underline-offset-2 ${RING}`} style={{ color: INK }}>{open ? 'Hide how it’s worked out' : 'How it’s worked out'}</button>
                </span>
                {tx
                  ? <span className="shrink-0 self-start text-right"><span className="hidden text-[13px] sm:block" style={{ color: MUTED }}>Takes home</span><span className="block text-[17px] font-semibold tabular-nums">{usd(tx.takeHome)}</span><span className="hidden text-[13px] tabular-nums sm:block" style={{ color: MUTED }}>of {usd(tx.gross)} earned</span></span>
                  : <span className="shrink-0 self-start pt-0.5 font-semibold tabular-nums">{usd(o.amount)}</span>}
              </div>
              {open && <div className="pb-3">{p.statement(o)}</div>}
            </div>
          );
        })}
      </div>
      {p.team.length > 0 && !self && <>
        <Row label="Your team’s pay" value={usd(p.teamTotal)} />
        {p.employerTaxes > 0 && <Row label="Payroll taxes you pay as the employer" sub={p.tax.hasState ? `An estimate for ${p.tax.stateName}` : `An estimate until your ${p.tax.regionLabel.toLowerCase()} is picked`} value={usd(p.employerTaxes)} />}
        <Row label="Payday comes to" value={usd(payday)} tone="total" />
        {p.cameIn < payday && <Note warn>What came in these dates is {usd(payday - p.cameIn)} less than payday needs. Check the account has enough before you pay.</Note>}
      </>}
      {p.team.length > 0 && self && <>
        <Row label="Take-home for your team" value={usd(self.takeHome)} />
        {contractors > 0 && <Row label={contractors === 1 ? `${p.team.find((o) => o.contractor)?.name || 'A contractor'}, contractor` : `${contractors} contractors`} value={usd(contractorPay)} />}
        {self.pretax > 0 && <Row label="Taken out before taxes" sub="For retirement and health plans" value={usd(self.pretax)} />}
        <Row label="Withheld from their pay" sub={`For the IRS${self.employeeTaxes > 0 && self.stateName ? ` and ${self.stateName}` : ''}`} value={usd(self.employeeTaxes)} />
        <Row label="Taxes you pay as the employer" sub="Your share of Social Security and Medicare, and unemployment" value={usd(self.employerTaxes)} />
        <Row label="Payday comes to" value={usd(payday)} tone="total" />
        <p className="mt-1 text-[13px]" style={{ color: MUTED }}>{usd(self.takeHome + contractorPay)} goes to your team now{self.pretax > 0 ? `, and ${usd(self.pretax)} to their retirement and health plans` : ''}. The {usd(later)} in taxes stays in the account until each one is due.</p>
        {p.cameIn < payday && <Note warn>What came in these dates is {usd(payday - p.cameIn)} less than payday needs. Check the account has enough before you pay.</Note>}
      </>}
      {runBy === 'gusto' && <div className="mt-3 flex flex-wrap items-center gap-2">
        {p.gusto.connected
          ? <button type="button" onClick={p.onSendToGusto} disabled={!employees.length || p.sendingToGusto || !!p.blocked || !!p.gustoUnmatched?.length} className={btn} style={solid}>{p.sendingToGusto ? 'Sending to Gusto' : `Send payroll to Gusto${contractors ? `, ${employees.length} ${employees.length === 1 ? 'employee' : 'employees'}` : ''}`}</button>
          : <button type="button" onClick={p.onConnectGusto} className={btn} style={plain}>Connect Gusto</button>}
        <span className="text-[13px]" style={{ color: MUTED }}>{p.gusto.connected ? 'Gusto works out the exact taxes, sends the deposits and files.' : 'To pay your team and file payroll taxes from here. Until then, record payday in your books below.'}</span>
      </div>}
      {runBy === 'gusto' && p.gusto.connected && !!p.gustoUnmatched?.length && <Note warn>Match {peopleOf(p.gustoUnmatched)} to Gusto first, below, then send payroll.</Note>}
      {runBy !== 'clarityflow' && p.onExport && <div className="mt-2 flex flex-wrap items-center gap-2"><button type="button" onClick={p.onExport} disabled={!!p.blocked} className={btn} style={runBy === 'company' ? solid : plain}>Download for {runBy === 'company' ? 'your' : 'another'} payroll company</button>
        <span className="text-[13px]" style={{ color: MUTED }}>Hours and pay for these dates, as a spreadsheet for ADP, Paychex, QuickBooks Payroll or your bookkeeper.</span></div>}
      {runBy === 'clarityflow' && <p className="mt-3 text-[13px]" style={{ color: MUTED }}>Taxes worked out here, using the IRS’s{self?.stateForm ? ` and ${self.stateName}’s` : ''} tables. You send the pay and the taxes from your bank, and file the forms or hand them to your accountant. <a href={self?.payrollHref || '/settings?tab=payroll'} className="underline underline-offset-2" style={{ color: INK }}>Use Gusto or another payroll company instead</a></p>}
      {self?.stale && <Note warn>The tax tables are from an earlier year. Check each person’s taxes with your accountant until this year’s are in.</Note>}
      {contractors > 0 && <Note>Contractors aren’t on payroll: nothing is withheld for them, and no employer taxes are owed. Pay them directly, then record payday.{runBy !== 'clarityflow' ? ' If your payroll company pays them, book its withdrawal for them as Contract Labor.' : ''}</Note>}
      <div className="mt-3 flex min-h-[56px] items-center justify-between gap-3 py-2" style={{ borderTop: `1px solid ${LINE}` }}>
        <span className="min-w-0"><span className="block">A payroll draft each payday</span>
          <span className="block text-[13px]" style={{ color: MUTED }}>Put together when each pay period ends ({p.cadenceWords}), with a note to you. Nothing is paid until you approve it.</span></span>
        <button type="button" role="switch" aria-checked={p.autoDraft} aria-label="A payroll draft each payday" onClick={() => p.onAutoDraft(!p.autoDraft)} className={`flex h-11 w-14 shrink-0 items-center justify-center rounded-full ${RING}`}>
          <span className="relative block h-7 w-12 rounded-full transition-colors" style={{ background: p.autoDraft ? GREEN : '#d4d5d8' }}>
            <span className="absolute top-0.5 block h-6 w-6 rounded-full bg-[#fff] shadow transition-all" style={{ left: p.autoDraft ? 22 : 2 }} />
          </span>
        </button>
      </div>
    </section>
  );

  const aside = (
    <section aria-label="Set aside from what’s left" className={card} style={{ border: `1px solid ${LINE}` }}>
      <h3 className="text-[17px] font-semibold">Set aside from what’s left</h3>
      <p className="text-[14px]" style={{ color: MUTED }}>A split, so taxes and your own pay are there when you need them.</p>
      <div className="mt-3 flex flex-wrap items-end gap-2">
        <label className="min-w-[150px] flex-1 text-[14px]" style={{ color: MUTED }}>Amount to split
          <span className="mt-1 flex h-11 items-center rounded-xl bg-[#fff] px-3 focus-within:ring-2 focus-within:ring-[#16171a]" style={{ border: `1px solid ${LINE}`, color: INK }}>
            <span aria-hidden style={{ color: MUTED }}>$</span>
            <input type="number" inputMode="decimal" min={0} step="0.01" placeholder="0.00" value={p.setAside || ''} onChange={(e) => p.onSetAside(Math.max(0, parseFloat(e.target.value) || 0))}
              className="h-full w-full min-w-0 bg-transparent pl-1 text-[16px] tabular-nums focus:outline-none" />
          </span>
        </label>
        <button type="button" onClick={() => p.onSetAside(Math.max(0, left))} disabled={left <= 0} className={btn} style={plain}>Use what’s left{left > 0 ? `, ${usd(left)}` : ''}</button>
      </div>
      <div className="mt-3">
        {parts.map((x) => (
          <Row key={x.key} label={PART_NAMES[x.key]} value={usd(x.amount)}
            sub={x.key === 'tax' ? `${x.pct}%, ${p.tax.hasState ? `an estimate for ${p.tax.stateName}` : 'a federal estimate until your state is picked'}` : x.key === 'opex' ? `${x.pct}%, stays in the business account` : `${x.pct}%`} />
        ))}
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2" style={{ borderTop: `1px solid ${LINE}` }}>
        <label className="mt-3 inline-flex flex-wrap items-center gap-2 text-[14px]" style={{ color: MUTED }}>Taxes are estimated for
          <select value={p.tax.state ?? ''} onChange={(e) => e.target.value && p.tax.onState(e.target.value)} disabled={!p.tax.canPickState} className={`${field} max-w-[260px]`} style={{ border: `1px solid ${LINE}`, color: INK }}>
            <option value="" disabled>Pick your {p.tax.regionLabel.toLowerCase()}</option>
            {p.tax.states.map((s) => <option key={s.code} value={s.code}>{s.label}</option>)}
          </select></label>
        {p.tax.country !== 'US' && <label className="mt-3 inline-flex items-center gap-2 text-[14px]" style={{ color: MUTED }}>Country
          <select value={p.tax.country} onChange={(e) => p.tax.onCountry(e.target.value)} className={field} style={{ border: `1px solid ${LINE}`, color: INK }}>
            {p.tax.countries.map((c) => <option key={c.code} value={c.code} disabled={!c.enabled}>{c.name}{c.enabled ? '' : ', coming later'}</option>)}
          </select></label>}
      </div>
      {!p.tax.hasState && <Note warn>Pick your {p.tax.regionLabel.toLowerCase()} so the tax estimate and payroll taxes fit where you are. Until then, a federal-only estimate is used.</Note>}
      {p.tax.hasState && p.tax.note && <p className="mt-2 text-[13px]" style={{ color: MUTED }}>{p.tax.note}</p>}
      {p.tax.stale && <Note warn>{p.tax.stale}</Note>}
      <p className="mt-2 text-[13px]" style={{ color: MUTED }}>Estimates only. Your accountant can confirm the right amounts.</p>
      <div className="mt-3 pb-1" style={{ borderTop: `1px solid ${LINE}` }}>
        {p.recordedOn
          ? <p role="status" className="mt-3 rounded-2xl px-4 py-3 text-[14px] font-medium" style={{ background: GREEN_TINT, color: GREEN }}>{p.recordedSpan ? `Payday for ${p.recordedSpan} is in your books, recorded ${p.recordedOn.toLocaleDateString('en-US', { month: 'long', day: 'numeric' })}. These dates overlap it, so it can’t be recorded again.` : `Payday for these dates is in your books, recorded ${p.recordedOn.toLocaleDateString('en-US', { month: 'long', day: 'numeric' })}.`}</p>
          : <>
            {p.blocked && <Note warn>{p.blocked}</Note>}
            {runBy === 'company' && employees.length > 0 && <Note>Recording payday puts what you paid in your books. It doesn’t withhold or file anyone’s taxes: your payroll company does that.</Note>}
            {runBy === 'gusto' && !p.gusto.connected && employees.length > 0 && <Note>Recording payday puts what you paid in your books. It doesn’t withhold or file anyone’s taxes: for employees, Gusto does that once it’s connected.</Note>}
            <button type="button" onClick={p.onRecord} disabled={(p.setAside <= 0 && !p.team.length) || p.recording || !!p.blocked} className={`${btn} mt-3`} style={solid}>{p.recording ? 'Recording' : 'Record payday in your books'}</button>
            <p className="mt-2 text-[13px]" style={{ color: MUTED }}>
              {self && employees.length > 0 ? `Adds each person’s pay (${usd(p.teamTotal + cashOut)} in all${cashOut > 0 ? ', cash tips taken home included' : ''}) and ${usd(self.employerTaxes)} in payroll taxes you pay as the employer to your books, dated today, and keeps each person’s taxes for their pay stub.${p.setAside > 0 ? ' The set-asides too.' : ''} It’s recorded once for these dates.`
                : p.setAside > 0
                ? `Adds ${p.team.length ? `each person’s pay (${usd(p.teamTotal + cashOut)} in all${cashOut > 0 ? ', cash tips taken home included' : ''}) and ` : ''}these set-asides to your books, dated today. It’s recorded once for these dates.`
                : p.team.length ? `Adds each person’s pay (${usd(p.teamTotal + cashOut)} in all${cashOut > 0 ? ', cash tips taken home included' : ''}) to your books, dated today. Put in an amount to split to add the set-asides too.` : 'Put in an amount to split, and recording adds the set-asides to your books.'}
            </p>
          </>}
      </div>
    </section>
  );

  const keep = self && self.owed.length > 0 ? (
    <section aria-label="Payroll taxes to pay later" className={card} style={{ border: `1px solid ${LINE}` }}>
      <h3 className="text-[17px] font-semibold">Payroll taxes to pay later</h3>
      <p className="text-[14px]" style={{ color: MUTED }}>From this payday: what’s withheld from the team’s pay, and your share as the employer.</p>
      <div className="mt-2">
        {self.owed.map((x) => <Row key={x.key} label={x.name} sub={x.sub} value={usd(x.amount)} />)}
        <Row label="In all" value={usd(self.owedTotal)} tone="total" />
      </div>
      <p className="mt-2 pb-1 text-[13px]" style={{ color: MUTED }}>When you pay one, sort its bank line as Payroll Tax Deposit: it’s in your books from payday already, so it isn’t counted twice.</p>
    </section>
  ) : null;

  const bills = (
    <section aria-label="Bills due these dates" className={card} style={{ border: `1px solid ${LINE}` }}>
      <h3 className="text-[17px] font-semibold">Bills due these dates</h3>
      <div className="mt-2">
        {p.bills.length === 0 && <p className="py-3 text-[14px]" style={{ color: MUTED, borderTop: `1px solid ${LINE}` }}>No unpaid bills are due these dates.</p>}
        {p.bills.map((b) => {
          const late = b.due < today;
          const when = b.due.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
          return <Row key={b.id} label={b.name} value={usd(b.amount)} sub={<span style={{ color: late ? AMBER : MUTED }}>{late ? `Overdue since ${when}` : `Due ${when}`}{b.personal ? ', personal' : ''}</span>} />;
        })}
      </div>
      {p.onSeeBills && <div className="mt-2 pb-1"><button type="button" onClick={p.onSeeBills} className={btn} style={plain}>See all bills</button></div>}
    </section>
  );

  return (
    <div style={{ color: INK }}>
      <h2 className="text-[24px] font-semibold leading-tight">Payday</h2>
      <p className="mb-4 text-[14px]" style={{ color: MUTED }}>What came in this pay period, what goes out on payday, and what’s left to set aside.</p>
      {p.draft && (
        <section aria-label="A payroll draft is ready" className={`${card} mb-4 flex flex-wrap items-center justify-between gap-3 pb-4 md:flex-nowrap`} style={{ border: `1px solid ${LINE}` }}>
          <div className="min-w-0">
            <h3 className="text-[17px] font-semibold">A payroll draft is ready</h3>
            <p className="text-[14px]" style={{ color: MUTED }}>{spanWords(p.draft.from, p.draft.to, now)}: {p.draft.people} {p.draft.people === 1 ? 'person' : 'people'}, {usd(p.draft.gross)} in pay and about {usd(p.draft.taxes)} in payroll taxes. It’s worked out again from the time clock and checkouts when you open it.</p>
          </div>
          <button type="button" onClick={p.onOpenDraft} className={`${btn} shrink-0`} style={plain}>Open those dates</button>
        </section>
      )}
      <div className="grid items-start gap-4 lg:grid-cols-[1.1fr_1fr]">
        <div className="space-y-4">{period}{team}{p.gustoSlot}</div>
        <div className="space-y-4">{keep}{aside}{bills}</div>
      </div>
    </div>
  );
}
