'use client';
// src/components/money/BonusDialog.tsx — PAY A BONUS (Money › Payday › Your team › Pay a bonus; design board "Pay a
// bonus"). Anything paid between paydays: a holiday bonus, a last paycheck, pay that was missed. Taxed at the bonus
// rates the IRS and the state set (lib/withholding supplementalFederal, lib/state-payroll supplementalStateTax), or like
// a paycheck of its own, with what the person takes home worked out as it's typed. Recorded on the server
// (api/payroll/record, lib/payday-record), which works the taxes out again the same way, so the two always agree. It
// counts in the person's year from then on: the Social Security limit, their W-2, and the IRS payment it's due with.
// Only when payroll is run in ClarityFlow (a payroll company pays its own bonuses).
import * as React from 'react';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { paydayTaxes, ytdFrom, teamOnLastPayday, dueDates, afterQuarter } from '@/lib/payroll-taxes';
import { stateSpec, supplementalRate } from '@/lib/state-payroll';
import { staleWords, tablesInfo, type TaxForms, type PayMethod, type Withholding } from '@/lib/withholding';

const INK = '#16171a', MUTED = '#6d7075', LINE = '#ececee', SOFT = '#f5f5f7', AMBER = '#b45309', AMBER_TINT = '#fff7ed';
const RING = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#16171a] focus-visible:ring-offset-2';
const btn = `inline-flex min-h-[44px] items-center justify-center rounded-full px-4 text-[14px] font-semibold disabled:opacity-50 ${RING}`;
const solid = { background: INK, color: '#fff' }; const plain = { background: '#fff', color: INK, border: `1px solid ${LINE}` };
const field = `h-11 w-full rounded-xl bg-[#fff] px-3 text-[15px] ${RING}`;
const fieldStyle = { border: `1px solid ${LINE}`, color: INK };
const usd = (n: number) => `$${Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const DAY = 86400000;
const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T12:00:00Z`) + n * DAY).toISOString().slice(0, 10);
const longDay = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
const METHODS: { v: PayMethod; label: string }[] = [{ v: 'transfer', label: 'Bank transfer' }, { v: 'check', label: 'Check' }, { v: 'cash', label: 'Cash' }];
const key6 = () => Math.random().toString(36).slice(2, 10).padEnd(6, '0');

export type BonusPerson = { id: string; name: string; contractor: boolean; forms: TaxForms | null; left?: boolean };
export type BonusBody = { periodKey: string; offCycle: { date: string; supplemental: boolean };
  people: { staffId: string; name: string; amount: number; cash: 0; contractor: boolean; method: PayMethod; checkNo?: string }[];
  /** Taxed with another year's tables, and ticked that they'll be checked with the accountant (lib/payday-record). */
  staleOk?: boolean };

const Line = ({ label, sub, value, total }: { label: string; sub?: string; value: string; total?: boolean }) => (
  <div className="flex min-h-[44px] items-center justify-between gap-3 py-2" style={{ borderTop: `1px solid ${total ? INK : LINE}`, fontWeight: total ? 600 : undefined }}>
    <span className="min-w-0"><span className="block text-[15px]">{label}</span>{sub && <span className="block text-[13px] font-normal" style={{ color: MUTED }}>{sub}</span>}</span>
    <span className="shrink-0 text-[15px] tabular-nums">{value}</span>
  </div>
);

export function BonusDialog(p: {
  open: boolean; onOpenChange: (o: boolean) => void;
  /** Everyone who can be paid: employees and contractors. */
  people: BonusPerson[];
  /** The business, and its paydays from January of last year (what each person has been paid so far). */
  tenant: any; runs: any[];
  /** The state payroll is taxed in ("NC"), and its name. */
  state: string | null; stateName: string; today: string;
  /** Records it; a string back is what went wrong. */
  onRecord: (body: BonusBody) => Promise<string | null>;
  /** Paid by check: once recorded, its check prints into the window opened on the tap (lib/payroll-checks). */
  onCheck?: (body: BonusBody, w: Withholding | null, win: Window | null) => Promise<void>;
}) {
  const [who, setWho] = React.useState(''); const [amount, setAmount] = React.useState(''); const [date, setDate] = React.useState(p.today);
  const [how, setHow] = React.useState<'bonus' | 'regular'>('bonus'); const [method, setMethod] = React.useState<PayMethod>('transfer'); const [checkNo, setCheckNo] = React.useState('');
  const [busy, setBusy] = React.useState(false); const [error, setError] = React.useState<string | null>(null);
  const [id6, setId6] = React.useState(key6); const [staleOk, setStaleOk] = React.useState(false);
  React.useEffect(() => { if (p.open) { setWho(''); setAmount(''); setDate(p.today); setHow('bonus'); setMethod('transfer'); setCheckNo(''); setError(null); setId6(key6()); setStaleOk(false); } }, [p.open]); // eslint-disable-line react-hooks/exhaustive-deps
  const person = p.people.find((x) => x.id === who) || null;
  const pick = (id: string) => { setWho(id); const f = p.people.find((x) => x.id === id)?.forms; setMethod((f?.payMethod as PayMethod) || 'transfer'); };
  const first = (person?.name || 'They').split(' ')[0];
  const amt = Math.round((Number(amount) || 0) * 100) / 100;
  const min = `${Number(p.today.slice(0, 4)) - 1}-01-01`, max = addDays(p.today, 31);
  const dateOk = /^\d{4}-\d{2}-\d{2}$/.test(date) && date >= min && date <= max;
  const periodKey = `bonus_${date}_${id6}`;
  const spec = stateSpec(p.state); const stTax = !!spec && !spec.noTax; const rate = supplementalRate(p.state);
  const stForm = spec?.form && !spec.form.federal ? spec.form.name : null;
  // (What it comes to, worked out as the server will: lib/payroll-taxes.)
  const ytd = React.useMemo(() => (person && !person.contractor && dateOk ? ytdFrom(p.runs, p.tenant, Number(date.slice(0, 4)), periodKey, date) : null), [person, date, dateOk, p.tenant, p.runs, periodKey]);
  const y = person && ytd ? ytd[person.id] || null : null;
  const calc = React.useMemo(() => {
    if (!person || person.contractor || !(amt > 0) || !dateOk || !ytd) return null;
    const year = Number(date.slice(0, 4));
    const w = paydayTaxes({ tenant: p.tenant, payDate: date, forms: { [person.id]: person.forms }, ytd,
      people: [{ staffId: person.id, gross: amt, inHand: 0 }], offCycle: true, supplemental: how === 'bonus', teamSize: teamOnLastPayday(p.runs, p.tenant, year, date) }).by[person.id] || null;
    return w ? { w, y } : null;
  }, [person, amt, date, dateOk, how, p.tenant, p.runs, ytd, y]);
  const w = calc?.w || null;
  // (The flat 22% once income tax has been withheld from their regular pay this year; until then, with their last
  // regular paycheck: lib/withholding.)
  const flat = !person || person.contractor || (Number(y?.fedWithheld) || 0) > 0; const withLast = !flat && !!y?.last;
  // (A day in a quarter whose returns were due already: a filed one would need correcting.)
  const qEnd = dateOk ? new Date(Date.UTC(Number(date.slice(0, 4)), Math.floor((Number(date.slice(5, 7)) - 1) / 3) * 3 + 3, 0, 12)).toISOString().slice(0, 10) : null;
  const pastDue = qEnd ? afterQuarter(qEnd) : null; const late = !!pastDue && pastDue < p.today;
  const due = dateOk ? dueDates(date, p.tenant) : null;
  const local = p.state === 'MD' ? ', with the county’s part' : p.state === 'IN' ? ', with the county’s part' : p.state === 'NY' && person?.forms?.state?.local ? ', with the city’s part' : '';
  const fedWords = flat ? 'Federal income tax at 22%' : `Federal income tax ${withLast ? 'on it and the last paycheck together' : 'as a paycheck of its own'} (none was withheld from ${first}’s pay this year yet)`;
  const bonusWords = `${fedWords}${stTax ? rate != null ? `, ${p.stateName} at ${rate}%${local}` : `, and ${p.stateName}’s on it and the last paycheck together` : ''}, the way the IRS${stTax ? ` and ${p.stateName}` : ''} say${stTax ? '' : 's'} bonuses are taxed`;
  const regularWords = `Worked out from ${person && !person.contractor ? `${first}’s` : 'their'} W-4${stTax && stForm ? ` and ${stForm}` : ''}, as if it were a payday of its own`;

  const lines: { label: string; sub?: string; value: number }[] = [];
  if (w) {
    const e = w.employee;
    lines.push({ label: 'Federal income tax', value: e.federal,
      sub: w.flags.includes('exempt') && e.federal === 0 ? 'Exempt on their W-4' : how !== 'bonus' ? `From ${first}’s W-4`
        : Math.abs(e.federal - Math.round(w.wages.federal * 22) / 100) < 0.01 ? `22% of ${usd(w.wages.federal)}`
        : !flat ? (withLast ? `On it and ${first}’s last paycheck together, less what that paycheck had taken` : 'As a paycheck of its own')
        : '22%, and 37% on bonuses over $1,000,000 this year' });
    lines.push({ label: 'Social Security', value: e.socialSecurity, sub: w.wages.socialSecurity >= w.gross - 0.005 ? '6.2%' : w.wages.socialSecurity > 0 ? `6.2% of ${usd(w.wages.socialSecurity)}, up to this year’s limit` : 'Past this year’s limit' });
    lines.push({ label: 'Medicare', value: Math.round((e.medicare + e.additionalMedicare) * 100) / 100, sub: e.additionalMedicare > 0 ? '1.45%, and 0.9% more on pay over $200,000 this year' : '1.45%' });
    if (w.stateHow === 'built_in' || w.stateHow === 'percent') lines.push({ label: `${p.stateName} income tax`, value: e.state,
      sub: how === 'bonus' && rate != null && w.stateHow === 'built_in' ? `${rate}%${local}` : how === 'bonus' && w.stateHow === 'built_in' && y?.last ? `On it and ${first}’s last paycheck together, less what that paycheck had taken` : stForm ? `From ${first}’s ${stForm}` : undefined });
    for (const o of e.other) lines.push({ label: o.name, value: o.amount });
  }
  const shortBy = w ? Math.round((w.short.federal + w.short.socialSecurity + w.short.medicare + w.short.state) * 100) / 100 : 0;
  const noSui = !!w && w.employer.sui === 0 && w.employer.futa === 0 && !w.flags.includes('sui_rate_missing');
  const missing = w ? (w.flags.includes('no_w4') && how === 'regular' ? `No W-4 on file for ${first}: taxed as single, as the IRS requires.` : w.flags.includes('no_state_form') && stForm ? `No ${stForm} on file for ${first}: ${p.stateName} tax is as single with no allowances.` : w.stateHow === 'missing' ? `${p.stateName} income tax isn’t set up yet, so none is taken out.` : null) : null;
  // (Tables for another year than the day it's paid: recorded once it's ticked that they'll be checked.)
  const stale = !!w && w.flags.includes('stale_tables'); const ti = dateOk ? tablesInfo(Number(date.slice(0, 4))) : null;
  const ready = !!person && amt > 0 && dateOk && (!stale || staleOk);

  const record = async () => {
    if (!person || !ready) return;
    // (Paid by check: the window for it opens on the tap, so it isn't blocked, and the check goes in it once recorded.)
    const win = method === 'check' && p.onCheck ? window.open('', '_blank') : null;
    if (win) { win.document.open(); win.document.write('<p style="font-family:sans-serif;padding:24px">Recording the pay…</p>'); win.document.close(); }
    setBusy(true); setError(null);
    const body: BonusBody = { periodKey, offCycle: { date, supplemental: how === 'bonus' },
      people: [{ staffId: person.id, name: person.name, amount: amt, cash: 0, contractor: person.contractor, method, ...(method === 'check' && checkNo ? { checkNo } : {}) }],
      ...(stale && staleOk ? { staleOk: true } : {}) };
    const r = await p.onRecord(body).catch(() => 'Not recorded. Try again.');
    if (r) { win?.close(); setBusy(false); setError(r); return; }
    if (method === 'check' && p.onCheck) await p.onCheck(body, w, win).catch(() => { win?.close(); });
    setBusy(false); p.onOpenChange(false);
  };

  return (
    <Dialog open={p.open} onOpenChange={(o) => { if (!busy) p.onOpenChange(o); }}>
      <DialogContent className="max-h-[92dvh] overflow-hidden rounded-3xl border-0 bg-[#f5f5f7] p-0 sm:max-w-3xl">
        <div className="flex max-h-[92dvh] flex-col" style={{ color: INK }}>
          <div className="px-5 pb-3 pt-5 sm:px-6">
            <DialogTitle className="pr-8 text-[20px] font-semibold leading-tight">Pay a bonus</DialogTitle>
            <DialogDescription className="mt-1 text-[14px]" style={{ color: MUTED }}>Or anything paid between paydays: a holiday bonus, a last paycheck, pay that was missed.</DialogDescription>
          </div>
          <div className="grid flex-1 items-start gap-4 overflow-y-auto px-5 pb-4 sm:px-6 md:grid-cols-2">
            <section aria-label="What’s paid" className="flex flex-col gap-3 rounded-3xl bg-[#fff] p-5" style={{ border: `1px solid ${LINE}` }}>
              <h3 className="text-[17px] font-semibold">What’s paid</h3>
              <label htmlFor="bonus-who" className="flex flex-col gap-1 text-[14px]" style={{ color: MUTED }}>To
                <select id="bonus-who" value={who} onChange={(e) => pick(e.target.value)} className={field} style={fieldStyle}>
                  <option value="" disabled>Pick someone</option>
                  {p.people.map((x) => <option key={x.id} value={x.id}>{x.name}{x.contractor ? ', contractor' : ''}{x.left ? ', no longer on the team' : ''}</option>)}
                </select></label>
              <div className="grid gap-3 sm:grid-cols-2">
                <label htmlFor="bonus-amt" className="flex flex-col gap-1 text-[14px]" style={{ color: MUTED }}>Amount
                  <span className="flex h-11 items-center rounded-xl bg-[#fff] px-3 focus-within:ring-2 focus-within:ring-[#16171a]" style={fieldStyle}><span aria-hidden style={{ color: MUTED }}>$</span>
                    <input id="bonus-amt" type="number" inputMode="decimal" min={0} step="0.01" placeholder="0.00" value={amount} onChange={(e) => setAmount(e.target.value)} className="h-full w-full min-w-0 bg-transparent pl-1 text-[15px] tabular-nums focus:outline-none" style={{ color: INK }} /></span></label>
                <label htmlFor="bonus-date" className="flex flex-col gap-1 text-[14px]" style={{ color: MUTED }}>Paid on
                  <input id="bonus-date" type="date" value={date} min={min} max={max} onChange={(e) => setDate(e.target.value)} className={field} style={fieldStyle} /></label>
              </div>
              {!dateOk && date && <p className="text-[13px]" style={{ color: AMBER }}>Pick a day from January of last year to a month from now.</p>}
              {late && <p className="rounded-2xl px-4 py-3 text-[14px]" style={{ background: AMBER_TINT, color: AMBER }}>That quarter’s returns were due {longDay(pastDue!)}. If they’re filed already, this changes them: your accountant files a correction (Form 941-X).</p>}
              {person && !person.contractor && <fieldset className="flex flex-col gap-2">
                <legend className="mb-1 text-[14px]" style={{ color: MUTED }}>How it’s taxed</legend>
                {([['bonus', 'As a bonus', bonusWords], ['regular', 'Like a regular paycheck', regularWords]] as const).map(([v, label, sub]) => (
                  <label key={v} className="flex min-h-[44px] cursor-pointer items-start gap-3 rounded-2xl bg-[#fff] px-4 py-3 focus-within:ring-2 focus-within:ring-[#16171a]" style={{ border: `1px solid ${how === v ? INK : LINE}` }}>
                    <input type="radio" name="bonus-how" value={v} checked={how === v} onChange={() => setHow(v)} className="mt-0.5 h-5 w-5 shrink-0 accent-[#16171a]" />
                    <span className="min-w-0"><span className="block text-[15px]">{label}</span><span className="block text-[13px]" style={{ color: MUTED }}>{sub}</span></span>
                  </label>))}
              </fieldset>}
              <div className="flex flex-col gap-1">
                <span id="bonus-by" className="text-[14px]" style={{ color: MUTED }}>Paid by</span>
                <div role="group" aria-labelledby="bonus-by" className="flex flex-wrap gap-2">
                  {METHODS.map((m) => <button key={m.v} type="button" aria-pressed={method === m.v} onClick={() => setMethod(m.v)} className={btn} style={method === m.v ? solid : plain}>{m.label}</button>)}
                </div>
              </div>
              {method === 'check' && <label htmlFor="bonus-check" className="flex max-w-[180px] flex-col gap-1 text-[14px]" style={{ color: MUTED }}>Check number
                <input id="bonus-check" value={checkNo} placeholder={p.onCheck ? 'The next one' : undefined} onChange={(e) => setCheckNo(e.target.value.replace(p.onCheck ? /\D/g : /[^0-9A-Za-z-]/g, '').slice(0, p.onCheck ? 10 : 12))} inputMode="numeric" className={field} style={fieldStyle} /></label>}
            </section>
            <section aria-label={person ? person.contractor ? `${first} is paid` : `${first} takes home` : 'What they take home'} aria-live="polite" className="flex flex-col rounded-3xl bg-[#fff] p-5" style={{ border: `1px solid ${LINE}` }}>
              <h3 className="text-[17px] font-semibold">{person ? person.contractor ? `${first} is paid` : `${first} takes home` : 'What they take home'}</h3>
              {!person || !(amt > 0) ? <p className="mt-1 text-[14px]" style={{ color: MUTED }}>Pick someone and put in the amount to see the taxes on it and what they take home.</p>
                : person.contractor ? <>
                  <Line label="Paid" value={usd(amt)} />
                  <p className="mt-1 text-[14px]" style={{ color: MUTED }}>Nothing is taken out: {first} is a contractor, so no employer taxes are owed either. It counts toward their 1099-NEC for the year.</p>
                </> : w ? <>
                  <div className="mt-1"><Line label={how === 'bonus' ? 'Bonus' : 'Pay'} value={usd(w.gross)} />
                    {lines.map((x) => <Line key={x.label} label={x.label} sub={x.sub} value={x.value > 0 ? `−${usd(x.value)}` : usd(0)} />)}
                    <Line label="Takes home" value={usd(w.takeHome)} total /></div>
                  {shortBy > 0 && <p className="mt-2 rounded-2xl px-4 py-3 text-[14px]" style={{ background: AMBER_TINT, color: AMBER }}>{usd(shortBy)} of the taxes can’t be withheld from it. Ask your accountant how to collect it.</p>}
                  {missing && <p className="mt-2 rounded-2xl px-4 py-3 text-[14px]" style={{ background: AMBER_TINT, color: AMBER }}>{missing}</p>}
                  <p className="mt-2 text-[14px]" style={{ color: MUTED }}>You also pay {usd(w.employerTotal)} as the employer{w.employer.sui > 0 || w.employer.futa > 0 ? ', for Social Security, Medicare and unemployment' : ', for Social Security and Medicare'}.{noSui ? ` No unemployment: ${first}’s pay is past this year’s limits for it.` : ''}</p>
                  <p className="mt-2 text-[14px]" style={{ color: MUTED }}>It counts in {first}’s year: their W-2, the Social Security limit{due?.irs ? `, and the IRS payment due ${longDay(due.irs).replace(/, \d{4}$/, '')}` : ''}.</p>
                  {stale && <div className="mt-2 rounded-2xl px-4 py-3 text-[14px]" style={{ background: AMBER_TINT, color: AMBER }}>
                    <p>{staleWords(Number(date.slice(0, 4)), 'This pay')} Until that year’s are added, the taxes on it may be off.</p>
                    <label className="mt-1 flex min-h-[44px] cursor-pointer items-center gap-3 font-semibold">
                      <input type="checkbox" checked={staleOk} onChange={(e) => setStaleOk(e.target.checked)} className="h-5 w-5 shrink-0 accent-[#b45309]" />
                      I’ll check these taxes with my accountant</label></div>}
                  <p className="mt-2 text-[13px]" style={{ color: MUTED }}>Estimates from the {ti && ti.federal === ti.state ? `${ti.federal} ` : ''}tax tables. You’re the employer, so you pay the taxes and file the forms: check with your accountant when you’re unsure.</p>
                </> : null}
            </section>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2 px-5 py-4 sm:px-6" style={{ borderTop: `1px solid ${LINE}`, background: SOFT }}>
            {error ? <span role="alert" className="min-w-[200px] flex-1 text-[13px]" style={{ color: AMBER }}>{error}</span>
              : <span className="min-w-[200px] flex-1 text-[13px]" style={{ color: MUTED }}>{person?.contractor ? `Adds it to your books as contract labor, on the day it’s paid.` : `Adds it to your books on the day it’s paid, and keeps the taxes for ${person ? `${first}’s` : 'their'} pay stub and what you owe.`}</span>}
            <span className="flex flex-wrap gap-2"><button type="button" onClick={() => p.onOpenChange(false)} disabled={busy} className={btn} style={plain}>Cancel</button>
            <button type="button" onClick={record} disabled={busy || !ready} className={btn} style={solid}>{busy ? 'Recording' : `${how === 'bonus' || person?.contractor ? 'Record the bonus' : 'Record the pay'}${method === 'check' && p.onCheck ? ' and print the check' : ''}`}</button></span>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
