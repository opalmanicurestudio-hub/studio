'use client';
// src/components/money/YearEndDialog.tsx — THE YEAR'S PAYROLL FORMS, BOX BY BOX (Money › Payday › Payroll taxes ›
// Year-end forms; design board "Year end", A, and "A W-2, box by box"). Each employee's W-2, the W-3, Form 940, the
// state's year-end reconciliation and each contractor's 1099-NEC, from the year's paydays (lib/payroll-yearend). To
// copy onto the forms, print (a W-2's copies B, C and 2 on plain paper), or download for an accountant. Social Security
// numbers, the EIN and tax ID numbers go on the forms themselves: ClarityFlow never keeps them.
import * as React from 'react';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { w2sFor, w3For, form940, stateAnnual, form1099s, yearEndDue, necThreshold, TIPS_OT_FROM, type W2, type FormLine } from '@/lib/payroll-yearend';
import { TTOC, NOT_LISTED, ttocTitle, usualTtoc, cleanTtoc } from '@/lib/tipped-occupations';
import { nicheOf } from '@/lib/niche';
import { priorOf } from '@/lib/payroll-prior';
import { owedItems } from '@/lib/payroll-owed';
import { payDateOf } from '@/lib/payroll-taxes';
import { stateSpec } from '@/lib/state-payroll';
import { csvName, downloadCsv } from '@/lib/csv';
import { esc, printPage } from '@/lib/print-style';

const INK = '#16171a', MUTED = '#6d7075', LINE = '#ececee', SOFT = '#f5f5f7';
const RING = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#16171a] focus-visible:ring-offset-2';
const btn = `inline-flex min-h-[44px] items-center justify-center rounded-full px-4 text-[14px] font-semibold disabled:opacity-50 ${RING}`;
const solid = { background: INK, color: '#fff' }; const plain = { background: '#fff', color: INK, border: `1px solid ${LINE}` };
const usd = (v: number) => `${v < 0 ? '−' : ''}$${Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const longDay = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString('en-US', { month: 'long', day: 'numeric', timeZone: 'UTC' });
const WRITE = 'Write it in';

export type YearEndTab = 'w2' | 'w3' | '940' | 'st' | 'nec';
/** One W-2 as rows: box, what it is, the amount or what to write in. */
export function w2Rows(w: W2, o: { businessName: string; first: string }): { box: string; label: string; detail?: string; value: string }[] {
  const rows: { box: string; label: string; detail?: string; value: string }[] = [
    { box: 'a', label: `${o.first}’s Social Security number`, value: WRITE },
    { box: 'b', label: 'Your EIN', value: WRITE },
    { box: 'c', label: 'You', value: `${o.businessName || 'Your business'}, and your address` },
    { box: 'e, f', label: `${o.first}’s name and address`, value: `${w.name}, and their address` },
    { box: '1', label: 'Wages, tips and other pay', detail: w.b12.some((x) => x.code === 'D') ? 'Less retirement taken out before taxes' : undefined, value: usd(w.b1) },
    { box: '2', label: 'Federal income tax withheld', value: usd(w.b2) },
    { box: '3', label: 'Social Security wages', detail: w.b7 > 0 ? 'Tips are in box 7, not here' : undefined, value: usd(w.b3) },
    { box: '4', label: 'Social Security withheld', value: usd(w.b4) },
    { box: '5', label: 'Medicare wages and tips', value: usd(w.b5) },
    { box: '6', label: 'Medicare withheld', value: usd(w.b6) },
    ...(w.b7 > 0 ? [{ box: '7', label: 'Social Security tips', value: usd(w.b7) }] : []),
    ...w.b12.map((x, i) => ({ box: `12${'abcd'[i] || ''}`, label: `Code ${x.code}`, detail: x.label, value: usd(x.amount) })),
    ...(w.b13 ? [{ box: '13', label: 'Retirement plan', value: 'Check it' }] : []),
    ...w.b14.map((x) => ({ box: '14', label: x.label, value: usd(x.amount) })),
    ...(w.b12.some((x) => x.code === 'TP') ? [{ box: '14b', label: 'Occupation the tips were received in', detail: w.b14b.length ? w.b14b.map(ttocTitle).join('; ') : undefined, value: w.b14b.join(', ') || 'Not picked yet' }] : []),
    ...(w.state ? [
      { box: '15', label: `State, and your ${w.state.name} withholding number`, value: `${w.state.code}, ${WRITE.toLowerCase()}` },
      { box: '16', label: `${w.state.name} wages`, value: usd(w.state.wages) },
      { box: '17', label: `${w.state.name} income tax`, value: usd(w.state.tax) }] : []),
    ...w.locals.flatMap((l) => [
      { box: '18', label: `${l.name} wages`, value: usd(l.wages) },
      { box: '19', label: `${l.name} tax`, value: usd(l.tax) },
      { box: '20', label: 'Locality name', value: l.name }]),
  ];
  return rows;
}

/** A W-2's copies B, C and 2, on plain paper, laid out the way the form is. */
export function w2Html(w: W2, year: number, businessName: string): string {
  const cell = (box: string, label: string, value: string, wide = false) => `<div class="w2c${wide ? ' w2w' : ''}"><span class="w2b">${esc(box)}</span> <span class="w2l">${esc(label)}</span><div class="w2v">${esc(value)}</div></div>`;
  // (Box 12 holds four codes. A fifth goes on a second W-2 that repeats boxes a to f, as the IRS asks.)
  const b12Of = (items: W2['b12']) => [0, 1, 2, 3].map((i) => { const x = items[i]; return cell(`12${'abcd'[i]}`, 'Code', x ? `${x.code}  ${usd(x.amount)}` : ''); }).join('');
  const b12 = b12Of(w.b12.slice(0, 4)); const more = w.b12.slice(4);
  const extra = (name: string, use: string) => `<div class="keep w2">
    <div class="w2h"><b>Form W-2 Wage and Tax Statement ${year}, second form: box 12 only</b><span>${esc(name)}: ${esc(use)}</span></div>
    <div class="w2g">
      ${cell('a', 'Employee’s Social Security number', '')}${cell('b', 'Employer identification number (EIN)', '')}${cell('c', 'Employer’s name, address and ZIP code', businessName || '')}
      ${cell('d', 'Control number', '')}${cell('e, f', 'Employee’s name, address and ZIP code', w.name)}<div class="w2c w2s">${b12Of(more)}</div>
    </div></div>`;
  const copy = (name: string, use: string, notice: string) => `<div class="keep w2">
    <div class="w2h"><b>Form W-2 Wage and Tax Statement ${year}</b><span>${esc(name)}: ${esc(use)}</span></div>
    <div class="w2h w2n"><span>Department of the Treasury, Internal Revenue Service. OMB No. 1545-0029</span><span>${esc(notice)}</span></div>
    <div class="w2g">
      ${cell('a', 'Employee’s Social Security number', '')}${cell('1', 'Wages, tips, other compensation', usd(w.b1))}${cell('2', 'Federal income tax withheld', usd(w.b2))}
      ${cell('b', 'Employer identification number (EIN)', '')}${cell('3', 'Social Security wages', usd(w.b3))}${cell('4', 'Social Security tax withheld', usd(w.b4))}
      ${cell('c', 'Employer’s name, address and ZIP code', businessName || '')}${cell('5', 'Medicare wages and tips', usd(w.b5))}${cell('6', 'Medicare tax withheld', usd(w.b6))}
      ${cell('d', 'Control number', '')}${cell('7', 'Social Security tips', w.b7 ? usd(w.b7) : '')}${cell('8', 'Allocated tips', '')}
      ${cell('e, f', 'Employee’s name, address and ZIP code', w.name)}${cell('10', 'Dependent care benefits', '')}${cell('11', 'Nonqualified plans', '')}
      ${cell('13', 'Retirement plan', w.b13 ? 'X' : '')}${year >= TIPS_OT_FROM ? cell('14a, 14b', 'Other; Treasury tipped occupation code(s)', [w.b14.map((x) => `${x.label} ${usd(x.amount)}`).join('; '), w.b14b.length ? `14b ${w.b14b.join(' ')}` : ''].filter(Boolean).join('; ')) : cell('14', 'Other', w.b14.map((x) => `${x.label} ${usd(x.amount)}`).join('; '))}<div class="w2c w2s">${b12}</div>
    </div>
    <div class="w2g w2st">
      ${cell('15', 'State, employer’s state ID number', w.state ? w.state.code : '')}${cell('16', 'State wages, tips, etc.', w.state ? usd(w.state.wages) : '')}${cell('17', 'State income tax', w.state ? usd(w.state.tax) : '')}
      ${cell('18', 'Local wages, tips, etc.', w.locals.map((l) => usd(l.wages)).join('; '))}${cell('19', 'Local income tax', w.locals.map((l) => usd(l.tax)).join('; '))}${cell('20', 'Locality name', w.locals.map((l) => l.name).join('; '))}
    </div></div>${more.length ? extra(name, use) : ''}`;
  const furnished = 'This information is being furnished to the Internal Revenue Service.';
  return `${copy('Copy B', 'to be filed with the employee’s federal tax return', furnished)}<hr class="cut">${copy('Copy C', 'for the employee’s records', `${furnished} If you are required to file a tax return, a negligence penalty or other sanction may be imposed on you if this income is taxable and you fail to report it.`)}<hr class="cut">${copy('Copy 2', 'to be filed with the employee’s state, city or local tax return', '')}
  <div class="keep w2t"><b>Notice to employee</b>
  <p>Do you have to file? Refer to the Form 1040 instructions to see if you must file a tax return. Even if you don’t, you may be able to file to get a refund of the federal income tax withheld in box 2, or the earned income credit.</p>
  <p>Earned income credit (EIC): you may be able to take it for ${year} if your income is under a certain amount. Any EIC more than your tax liability is refunded to you, but only if you file a return.</p>
  <p>Corrections: if your name, Social Security number or address is wrong, correct your copies and ask your employer to correct your record. If any amount is wrong, ask your employer for Form W-2c.</p>
  <p>Box 12 codes on this form: A, uncollected Social Security tax on tips; B, uncollected Medicare tax on tips (pay them with your return); D, elective deferrals to a 401(k) plan${year >= TIPS_OT_FROM ? '; TP, tips reported to your employer, cash and card, with box 14b the code for the occupation you received them in; TT, overtime pay above your regular rate that the law requires. Tips and overtime may qualify for a deduction on your return' : ''}. Box 13, retirement plan: you were in your employer’s plan this year.</p>
  <p>Keep Copy C for your records: you may need it to show your earnings to Social Security.</p></div>`;
}
export const W2_CSS = `.pp .w2 { border: 1px solid #16171a; padding: 8px; } .pp .w2h { display: flex; justify-content: space-between; gap: 8px; font-size: 11px; margin-bottom: 6px; }
.pp .w2g { display: grid; grid-template-columns: 1.4fr 1fr 1fr; border-top: 1px solid #16171a; border-left: 1px solid #16171a; }
.pp .w2st { grid-template-columns: repeat(6, 1fr); margin-top: 6px; }
.pp .w2c { border-right: 1px solid #16171a; border-bottom: 1px solid #16171a; padding: 3px 5px; min-height: 34px; font-size: 9px; }
.pp .w2s { display: grid; grid-template-columns: 1fr 1fr; padding: 0; } .pp .w2s .w2c { border-right: 0; } .pp .w2b { font-weight: 600; }
.pp .w2l { color: #6d7075; } .pp .w2v { font-size: 11.5px; font-variant-numeric: tabular-nums; margin-top: 2px; }
.pp .w2n { font-size: 9px; color: #6d7075; } .pp .w2t { margin-top: 14px; font-size: 9.5px; line-height: 1.5; } .pp .w2t p { margin: 4px 0 0; }`;

export function YearEndDialog(p: { open: boolean; onOpenChange: (o: boolean) => void; runs: any[]; tenant: any; year: number; today: string; businessName?: string;
  tab?: YearEndTab; person?: string | null;
  /** Shows each person their W-2 for the year in their own app (or takes it out); a string back is what went wrong. */
  onGiveW2s?: (year: number, given: boolean) => Promise<string | null>;
  /** Saves the occupation a person’s tips were received in, for box 14b (null: the business’s usual one), and whether
   *  some were for work not on the list (“000” as well). */
  onTtoc?: (staffId: string, code: string | null, notListed: boolean) => Promise<string | null>;
  /** Works out, from the time clock, the overtime the law requires for the year’s paydays recorded before it was kept:
   *  what went wrong, or how it went. */
  onOtBackfill?: (year: number) => Promise<{ error?: string; note?: string }> }) {
  const [year, setYear] = React.useState(p.year); const [tab, setTab] = React.useState<YearEndTab>(p.tab || 'w2'); const [who, setWho] = React.useState<string | null>(p.person || null);
  React.useEffect(() => { if (p.open) { setYear(p.year); setTab(p.tab || 'w2'); setWho(p.person || null); } }, [p.open]); // eslint-disable-line react-hooks/exhaustive-deps
  const spec = stateSpec(String(p.tenant?.taxState || p.tenant?.payRules?.state || '').toUpperCase());
  // (An occupation just picked shows at once, before the business's record comes back with it.)
  const [ttocNow, setTtocNow] = React.useState<Record<string, { code: string | null; notListed: boolean }>>({});
  const tenantNow = React.useMemo(() => { const ks = Object.keys(ttocNow); if (!ks.length) return p.tenant; const pt = p.tenant?.payrollTax || {};
    return { ...p.tenant, payrollTax: { ...pt, ttoc: { ...(pt.ttoc || {}), ...Object.fromEntries(ks.map((k) => [k, ttocNow[k].code])) }, ttoc000: { ...(pt.ttoc000 || {}), ...Object.fromEntries(ks.map((k) => [k, ttocNow[k].notListed])) } } }; }, [p.tenant, ttocNow]);
  const w2s = React.useMemo(() => w2sFor(p.runs, tenantNow, year), [p.runs, tenantNow, year]);
  const w3 = React.useMemo(() => w3For(w2s), [w2s]);
  const f940 = React.useMemo(() => form940(p.runs, p.tenant, year), [p.runs, p.tenant, year]);
  const st = React.useMemo(() => stateAnnual(p.runs, p.tenant, year, w2s), [p.runs, p.tenant, year, w2s]);
  const necs = React.useMemo(() => form1099s(p.runs, p.tenant, year), [p.runs, p.tenant, year]);
  const pr = priorOf(p.runs, year);
  const givenAt: string | null = p.tenant?.payrollTax?.w2Given?.[String(year)] || null; const [giving, setGiving] = React.useState(false); const [giveErr, setGiveErr] = React.useState<string | null>(null);
  const [ttocBusy, setTtocBusy] = React.useState(false); const [ttocErr, setTtocErr] = React.useState<string | null>(null);
  const pickTtoc = async (staffId: string, code: string | null, notListed: boolean) => { if (!p.onTtoc) return; setTtocBusy(true); setTtocErr(null); const e = await p.onTtoc(staffId, code, notListed).catch(() => 'Not saved. Try again.'); setTtocBusy(false); if (e) setTtocErr(e); else setTtocNow((m) => ({ ...m, [staffId]: { code, notListed } })); };
  const [otBusy, setOtBusy] = React.useState(false); const [otMsg, setOtMsg] = React.useState<{ error?: string; note?: string } | null>(null);
  const backfill = async () => { if (!p.onOtBackfill) return; setOtBusy(true); setOtMsg(null); const r = await p.onOtBackfill(year).catch(() => ({ error: 'That didn’t go through. Try again: what’s done is kept.' })); setOtBusy(false); setOtMsg(r); };
  const noCode = w2s.filter((w) => w.b12.some((x) => x.code === 'TP') && !w.b14b.length);
  const give = async (g: boolean) => { if (!p.onGiveW2s) return; setGiving(true); setGiveErr(null); const e = await p.onGiveW2s(year, g).catch(() => 'Not saved. Try again.'); setGiving(false); if (e) setGiveErr(e); };
  // (State unemployment for the year not paid by the time Form 940 is due cuts its credit: line 10.)
  const suiOpen = React.useMemo(() => owedItems(p.runs, p.tenant, p.today, spec?.name || 'State').filter((i) => i.agency === 'sui' && i.key.startsWith(`sui_${year}q`) && i.left >= 0.01), [p.runs, p.tenant, p.today, year, spec]);
  const paydays = new Set((p.runs || []).filter((r) => r?.kind === 'payday' && r.runBy === 'clarityflow' && payDateOf(r, p.tenant).slice(0, 4) === String(year)).map((r) => r.periodKey)).size;
  const due = yearEndDue(year); const over = p.today > `${year}-12-31`;
  const cur = w2s.find((w) => w.staffId === who) || w2s[0] || null; const first = (cur?.name || 'They').split(' ')[0];
  const tabs: { k: YearEndTab; label: string }[] = [{ k: 'w2', label: 'W-2s' }, { k: 'w3', label: 'W-3' }, { k: '940', label: 'Form 940' }, ...(st ? [{ k: 'st' as const, label: st.form }] : []), { k: 'nec', label: '1099-NEC' }];
  const minYear = Number(p.today.slice(0, 4)) - 1, maxYear = Number(p.today.slice(0, 4));
  const w3Lines: FormLine[] = [
    { line: 'c', label: 'W-2s sent', amount: w3.count, count: true },
    { line: '1', label: 'Wages, tips and other pay', amount: w3.b1 }, { line: '2', label: 'Federal income tax withheld', amount: w3.b2 },
    { line: '3', label: 'Social Security wages', amount: w3.b3 }, { line: '4', label: 'Social Security withheld', amount: w3.b4 },
    { line: '5', label: 'Medicare wages and tips', amount: w3.b5 }, { line: '6', label: 'Medicare withheld', amount: w3.b6 },
    ...(w3.b7 ? [{ line: '7', label: 'Social Security tips', amount: w3.b7 }] : []),
    ...(w3.b12a ? [{ line: '12a', label: 'Deferred compensation', detail: 'Retirement taken out before taxes', amount: w3.b12a }] : []),
    ...(w3.state ? [{ line: '16', label: `${spec?.name || 'State'} wages`, amount: w3.state.wages }, { line: '17', label: `${spec?.name || 'State'} income tax`, amount: w3.state.tax }] : []),
    ...(w3.local ? [{ line: '18', label: 'Local wages', amount: w3.local.wages }, { line: '19', label: 'Local income tax', amount: w3.local.tax }] : []),
  ];
  const lines: FormLine[] = tab === 'w3' ? w3Lines : tab === '940' ? f940.lines : tab === 'st' && st ? st.lines : [];
  const amt = (l: FormLine) => (l.count ? (l.line === '1a' ? String(l.detail || '') : String(l.amount)) : usd(l.amount));
  const title = tab === 'w2' ? 'W-2s' : tab === 'w3' ? 'W-3' : tab === '940' ? 'Form 940' : tab === 'st' ? st?.form || 'State' : '1099-NEC';

  const rowsCsv = (): (string | number)[][] => {
    const out: (string | number)[][] = [[`${p.businessName || ''} ${year} year-end payroll forms`.trim()], []];
    for (const w of w2s) { out.push([`W-2, ${w.name}`]); for (const r of w2Rows(w, { businessName: p.businessName || '', first: w.name.split(' ')[0] })) out.push([r.box, r.detail ? `${r.label} (${r.detail})` : r.label, r.value]); out.push([]); }
    const add = (name: string, ls: FormLine[]) => { out.push([name]); for (const l of ls) out.push([l.line, l.detail ? `${l.label} (${l.detail})` : l.label, l.count ? amt(l) : l.amount]); out.push([]); };
    add('W-3', w3Lines); add('Form 940', f940.lines); if (st) add(st.form, st.lines);
    out.push(['1099-NEC']); for (const x of necs) out.push([x.name, x.due ? 'Due' : `Under $${necThreshold(year).toLocaleString('en-US')}: none due`, x.amount]);
    return out;
  };
  const download = () => downloadCsv(csvName(String(p.businessName || ''), 'year-end-payroll', String(year)), rowsCsv() as any);
  const print = (list: W2[]) => {
    const w = window.open('', '_blank'); if (!w) return;
    const body = list.map((x, i) => `<div class="${i ? 'break' : ''}">${w2Html(x, year, p.businessName || '')}</div>`).join('');
    w.document.open(); w.document.write(printPage({ title: `W-2${list.length === 1 ? `, ${list[0].name}` : 's'}, ${year}`, heading: `W-2${list.length === 1 ? `, ${esc(list[0].name)}` : 's'}`, subtitle: String(year), shopName: p.businessName, body, css: W2_CSS,
      footNote: 'Copies B, C and 2 for the employee, on plain paper. Copy A goes to Social Security through Business Services Online. The Social Security number and EIN are written in by hand: ClarityFlow never keeps them. Prepared from the paydays recorded in ClarityFlow. Review before giving or filing.', autoPrint: true }));
    w.document.close(); w.focus();
  };
  const printForm = () => {
    const w = window.open('', '_blank'); if (!w) return;
    const body = tab === 'nec' ? `<table><thead><tr><th>Contractor</th><th class="r">Box 1, nonemployee compensation</th><th>1099-NEC</th></tr></thead><tbody>${necs.map((x) => `<tr><td>${esc(x.name)}</td><td class="r">${esc(usd(x.amount))}</td><td>${x.due ? 'Due' : 'None due'}</td></tr>`).join('')}</tbody></table>`
      : `<table><thead><tr><th>Line</th><th>What it is</th><th class="r">Amount</th></tr></thead><tbody>${lines.map((l) => `<tr><td>${esc(l.line)}</td><td>${esc(l.label)}${l.detail ? `<div class="muted">${esc(l.detail)}</div>` : ''}</td><td class="r">${esc(amt(l))}</td></tr>`).join('')}</tbody></table>`;
    w.document.open(); w.document.write(printPage({ title: `${title}, ${year}`, heading: esc(title), subtitle: String(year), shopName: p.businessName, body,
      footNote: 'Prepared from the paydays recorded in ClarityFlow. Review before filing. Your EIN, account numbers and tax ID numbers go on the form itself.', autoPrint: true }));
    w.document.close(); w.focus();
  };

  return (
    <Dialog open={p.open} onOpenChange={p.onOpenChange}>
      <DialogContent className="max-h-[92dvh] overflow-hidden rounded-3xl border-0 bg-[#f5f5f7] p-0 sm:max-w-2xl">
        <div className="flex max-h-[92dvh] flex-col" style={{ color: INK }}>
          <div className="shrink-0 px-5 pb-3 pt-5 sm:px-6">
            <DialogTitle className="pr-8 text-[20px] font-semibold leading-tight">{year} year-end forms</DialogTitle>
            <DialogDescription className="mt-1 text-[14px]" style={{ color: MUTED }}>
              {paydays ? `From ${paydays} payday${paydays === 1 ? '' : 's'} recorded${pr ? `, and your old payroll’s through ${longDay(pr.lastPayDate)}` : ''}. ` : pr ? `From your old payroll’s paydays through ${longDay(pr.lastPayDate)}. ` : 'No paydays recorded this year. '}
              {over ? `All due ${longDay(due)}${due !== `${year + 1}-01-31` ? ' (January 31 is a weekend)' : ''}.` : 'So far: the year isn’t over yet.'}
            </DialogDescription>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <button type="button" onClick={() => setYear((y) => y - 1)} disabled={year <= minYear} aria-label="The year before" className={`flex h-11 w-11 items-center justify-center rounded-full disabled:opacity-40 ${RING}`} style={plain}><ChevronLeft className="h-5 w-5" /></button>
              <button type="button" onClick={() => setYear((y) => y + 1)} disabled={year >= maxYear} aria-label="The year after" className={`flex h-11 w-11 items-center justify-center rounded-full disabled:opacity-40 ${RING}`} style={plain}><ChevronRight className="h-5 w-5" /></button>
              <span className="flex flex-wrap gap-2" role="group" aria-label="Which form">
                {tabs.map((t) => <button key={t.k} type="button" aria-pressed={tab === t.k} onClick={() => setTab(t.k)} className={btn} style={tab === t.k ? solid : plain}>{t.label}</button>)}
              </span>
            </div>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-4 sm:px-6">
            {tab === 'w2' && <>
              {w2s.length > 1 && <div className="mb-3 flex flex-wrap gap-2" role="group" aria-label="Whose W-2">
                {w2s.map((w) => <button key={w.staffId} type="button" aria-pressed={cur?.staffId === w.staffId} onClick={() => setWho(w.staffId)} className={btn} style={cur?.staffId === w.staffId ? solid : plain}>{w.name}</button>)}
              </div>}
              <section className="rounded-3xl bg-[#fff] px-5 py-2" style={{ border: `1px solid ${LINE}` }}>
                {!cur && <p className="py-3 text-[14px]" style={{ color: MUTED }}>Nobody was paid as an employee this year.</p>}
                {cur && w2Rows(cur, { businessName: p.businessName || '', first }).map((r, i) => (
                  <div key={`${r.box}-${i}`} className="grid grid-cols-[52px_1fr_auto] items-baseline gap-3 py-2.5 text-[15px]" style={{ borderTop: i ? `1px solid ${LINE}` : undefined }}>
                    <span style={{ color: MUTED }}>{r.box}</span>
                    <span className="min-w-0"><span className="block">{r.label}</span>{r.detail && <span className="block text-[13px]" style={{ color: MUTED }}>{r.detail}</span>}</span>
                    <span className="text-right tabular-nums" style={{ color: r.value.startsWith(WRITE) || r.value.endsWith(WRITE.toLowerCase()) ? MUTED : INK }}>{r.value}</span>
                  </div>))}
              </section>
              {cur && <p className="mt-3 text-[13px]" style={{ color: MUTED }}>Print copies B, C and 2 for {first} on plain paper. Copy A goes to Social Security: type it into Business Services Online, free, with the W-3. {first}’s Social Security number and your EIN go on the form itself: ClarityFlow never keeps them.{cur.prior ? ' It includes pay from before ClarityFlow: add its box 12 and 14 amounts from your old payroll’s report. If retirement came out before taxes there, put in its federal wages in Settings, Payroll, or box 1 is too high.' : ''}{cur.locals.some((l) => !l.withState) ? ' City taxes you added are in boxes 18 to 20.' : ''}</p>}
              {cur && cur.b12.some((x) => x.code === 'TP') && <div className="mt-3 flex flex-col gap-2 rounded-2xl bg-[#fff] px-4 py-3" style={{ border: `1px solid ${LINE}` }}>
                <label htmlFor="ye-ttoc" className="text-[14px] font-semibold">Box 14b: the occupation {first}’s tips were received in</label>
                <span className="text-[13px]" style={{ color: MUTED }}>The IRS’s list of tipped occupations. {usualTtoc(p.tenant) ? `${usualTtoc(p.tenant)}, ${ttocTitle(usualTtoc(p.tenant)!)}, is the usual one for your business.` : 'Pick the one that fits.'}</span>
                {p.onTtoc ? <select id="ye-ttoc" value={cur.b14b[0] || ''} disabled={ttocBusy} onChange={(e) => pickTtoc(cur.staffId, e.target.value || null, cur.b14b.includes(NOT_LISTED) && e.target.value !== NOT_LISTED)} className={`h-11 max-w-full rounded-xl bg-[#fff] px-3 text-[14px] ${RING}`} style={{ border: `1px solid ${LINE}` }}>
                  {!cur.b14b[0] && <option value="">Pick an occupation</option>}
                  {Array.from(new Set(TTOC.map((t) => t.group))).map((g) => <optgroup key={g} label={g}>{TTOC.filter((t) => t.group === g).map((t) => <option key={t.code} value={t.code}>{t.code}, {t.title}</option>)}</optgroup>)}
                  <option value={NOT_LISTED}>{NOT_LISTED}, not on the list</option>
                </select> : <span className="text-[14px]">{cur.b14b.join(', ') || 'Not picked yet'}</span>}
                {p.onTtoc && cur.b14b[0] && cur.b14b[0] !== NOT_LISTED && <label className="flex min-h-[44px] cursor-pointer items-center gap-3 text-[14px]">
                  <input type="checkbox" checked={cur.b14b.includes(NOT_LISTED)} disabled={ttocBusy} onChange={(e) => pickTtoc(cur.staffId, cleanTtoc(cur.b14b[0]), e.target.checked)} className="h-5 w-5 shrink-0 accent-[#16171a]" />
                  Some of {first}’s tips were for work not on the list (adds 000)</label>}
                {nicheOf(p.tenant) === 'medspa' && <span className="text-[13px]" style={{ color: MUTED }}>Tips on medical treatments aren’t for a listed occupation: tick the box above for those.</span>}
                <span className="text-[13px]" style={{ color: MUTED }}>Code TP is the tips recorded in ClarityFlow. Cash tips {first} reported to you some other way belong in it too: add them to the amount on the form.</span>
                {ttocErr && <span role="alert" className="text-[13px]" style={{ color: '#b45309' }}>{ttocErr}</span>}
              </div>}
              {cur && cur.otUnsure > 0 && <p className="mt-3 rounded-2xl px-4 py-3 text-[13px]" style={{ background: '#fff7ed', color: '#b45309' }}>{cur.otUnsure} of {first}’s paydays came out at different pay when worked out again from the time clock (a rate change or an edit since), so code TT has nothing from {cur.otUnsure === 1 ? 'it' : 'them'}. Check {first}’s overtime for {cur.otUnsure === 1 ? 'that payday' : 'those paydays'} with your accountant.</p>}
              {cur && cur.ttMaybeExempt > 0 && <p className="mt-3 rounded-2xl px-4 py-3 text-[13px]" style={{ background: '#fff7ed', color: '#b45309' }}>{usd(cur.ttMaybeExempt)} of code TT is overtime on commission pay in weeks {first} may be exempt from federal overtime (section 7(i): most of the pay commission, at over $10.88 an hour). If {first} is exempt, leave it off code TT: check with your accountant.</p>}
              {cur && w2s.some((w) => w.b12.length > 4) && cur.b12.length > 4 && <p className="mt-3 text-[13px]" style={{ color: MUTED }}>Box 12 has room for four codes, and {first} has {cur.b12.length}: the rest print on a second W-2, with boxes a to f again.</p>}
              {cur && cur.otNotKept > 0 && <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-[#fff] px-4 py-3 text-[13px]" style={{ border: `1px solid ${LINE}` }}>
                <span className="min-w-[220px] flex-1">{cur.otNotKept} of this year’s paydays {cur.otNotKept === 1 ? 'was' : 'were'} recorded before overtime was kept for code TT. Work it out again from the time clock, once, for everyone. It uses today’s pay rates: anyone whose pay comes out different from what was recorded is left for your accountant.{otMsg?.error ? <span role="alert" className="block font-semibold" style={{ color: '#b45309' }}>{otMsg.error}</span> : otMsg?.note ? <span role="status" className="block font-semibold">{otMsg.note}</span> : null}</span>
                {p.onOtBackfill && <button type="button" onClick={backfill} disabled={otBusy} className={`${btn} shrink-0`} style={plain}>{otBusy ? 'Working it out' : 'Work out overtime'}</button>}
              </div>}
              {cur && over && p.onGiveW2s && <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-[#fff] px-4 py-3" style={{ border: `1px solid ${LINE}` }}>
                <span className="min-w-0 flex-1 text-[14px]"><span className="block font-semibold">{givenAt ? 'In each person’s app' : 'Give them in each person’s app too'}</span>
                  <span className="block text-[13px]" style={{ color: MUTED }}>{givenAt ? `Since ${longDay(String(givenAt).slice(0, 10))}: each person sees and prints theirs on their Pay tab.` : 'Once you’ve checked them: each person sees and prints theirs on their Pay tab, as the W-2 to file with.'}</span>
                  {giveErr && <span role="alert" className="block text-[13px]" style={{ color: '#b45309' }}>{giveErr}</span>}</span>
                <button type="button" onClick={() => give(!givenAt)} disabled={giving} className={`${btn} shrink-0`} style={givenAt ? plain : solid}>{giving ? 'Saving' : givenAt ? 'Take them out' : 'Put them in the app'}</button>
              </div>}
            </>}
            {tab === 'nec' && <>
              <section className="rounded-3xl bg-[#fff] px-5 py-2" style={{ border: `1px solid ${LINE}` }}>
                {!necs.length && <p className="py-3 text-[14px]" style={{ color: MUTED }}>No contractors were paid through Payday this year.</p>}
                {necs.map((x, i) => (
                  <div key={x.staffId} className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 py-2.5 text-[15px]" style={{ borderTop: i ? `1px solid ${LINE}` : undefined }}>
                    <span><span className="block">{x.name}</span><span className="block text-[13px]" style={{ color: MUTED }}>{x.due ? `Box 1, nonemployee compensation. Due to them and the IRS ${longDay(due)}` : `Under $${necThreshold(year).toLocaleString('en-US')}: none due`}</span></span>
                    <span className="tabular-nums">{usd(x.amount)}</span>
                  </div>))}
              </section>
              <p className="mt-3 text-[13px]" style={{ color: MUTED }}>Paid through Payday. Their tax ID number and address, from their W-9, go on the form. File online with the IRS (IRIS, free) and give each their copy. Payments by card or a payment app are reported by that company instead (1099-K): leave them out.</p>
            </>}
            {tab === '940' && suiOpen.length > 0 && <p className="mb-3 rounded-2xl px-4 py-3 text-[14px]" style={{ background: '#fff7ed', color: '#b45309' }}>{spec?.name || 'State'} unemployment for {year} isn’t all marked paid yet. Paid after Form 940 is due, it cuts your credit (line 10): pay it first, or ask your accountant.</p>}
            {(tab === 'w3' || tab === '940' || tab === 'st') && <>
              <section className="rounded-3xl bg-[#fff] px-5 py-2" style={{ border: `1px solid ${LINE}` }}>
                {lines.map((l, i) => (
                  <div key={`${l.line}-${i}`} className="grid grid-cols-[64px_1fr_auto] items-baseline gap-3 py-2.5 text-[15px]" style={{ borderTop: i ? `1px solid ${['12', 'Withheld'].includes(l.line) ? INK : LINE}` : undefined, fontWeight: ['12', 'Withheld'].includes(l.line) ? 600 : undefined }}>
                    <span style={{ color: MUTED }}>{l.line}</span>
                    <span className="min-w-0"><span className="block">{l.label}</span>{l.detail && l.line !== '1a' && <span className="block text-[13px] font-normal" style={{ color: MUTED }}>{l.detail}</span>}</span>
                    <span className="tabular-nums">{amt(l)}</span>
                  </div>))}
              </section>
              <p className="mt-3 text-[13px]" style={{ color: MUTED }}>{tab === 'w3' ? 'Send it with the W-2s through Social Security’s Business Services Online, free. Kind of payer: 941. Kind of employer: none apply. Your EIN goes on it.'
                : tab === '940' ? `File it with the IRS by ${longDay(f940.due)}, or by February 10 if every federal unemployment payment was made on time. Your EIN goes on it.${f940.total > 500 ? ' Over $500 for the year: line 16 is what was owed each quarter.' : ' $500 or less for the year: line 16 isn’t needed.'}${pr ? ' If health coverage came out of your old payroll’s pay before taxes, add it to line 4.' : ''}`
                : `File it with ${spec?.filing?.agency || 'the state'} by ${st ? longDay(st.due) : ''}, with the W-2s where it asks for them. Your withholding account number goes on it.`}</p>
            </>}
            <p className="mt-3 text-[13px]" style={{ color: MUTED }}>Filled in from this year’s recorded paydays. Look them over, or have your accountant do it, before you hand them out and file.</p>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2 px-5 py-4 sm:px-6" style={{ borderTop: `1px solid ${LINE}`, background: SOFT }}>
            {tab === 'w2' && noCode.length > 0 && <span className="min-w-[200px] flex-1 text-[13px]" style={{ color: '#b45309' }}>Pick the occupation for box 14b first: {noCode.map((w) => w.name).join(', ')}.</span>}
            {tab === 'w2' && cur && <button type="button" onClick={() => print([cur])} className={btn} style={plain}>Print {first}’s W-2</button>}
            {tab === 'w2' && w2s.length > 1 && <button type="button" onClick={() => print(w2s)} className={btn} style={plain}>Print all {w2s.length}</button>}
            {tab !== 'w2' && <button type="button" onClick={printForm} className={btn} style={plain}>Print</button>}
            <button type="button" onClick={download} className={btn} style={plain}>Download all for your accountant</button>
            <button type="button" onClick={() => p.onOpenChange(false)} className={btn} style={solid}>Done</button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
