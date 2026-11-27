'use client';
// src/components/money/PayrollFormsDialog.tsx — THE QUARTER'S PAYROLL FORMS, LINE BY LINE (Money › Payday › Payroll
// taxes › See the numbers; design board "Payroll run in ClarityFlow", Form 941). Form 941 from the paydays paid in the
// quarter, the state's withholding return (North Carolina's NC-5, California's DE 9…) and its unemployment wage report
// (NCUI 101, DE 9C…), each state's by its own name (lib/payroll-owed, lib/state-payroll). To copy onto the forms, print,
// or download for an accountant. The business's EIN, and each person's Social Security number, go on the forms
// themselves: ClarityFlow never keeps them.
import * as React from 'react';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { form941, formStateWithholding, formStateWageReport, type FormLine } from '@/lib/payroll-owed';
import { stateSpec } from '@/lib/state-payroll';
import { afterQuarter } from '@/lib/payroll-taxes';
import { csvName, downloadCsv } from '@/lib/csv';
import { esc, printPage } from '@/lib/print-style';
import { ChevronLeft, ChevronRight } from 'lucide-react';

const INK = '#16171a', MUTED = '#6d7075', LINE = '#ececee', SOFT = '#f5f5f7';
const RING = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#16171a] focus-visible:ring-offset-2';
const btn = `inline-flex min-h-[44px] items-center justify-center rounded-full px-4 text-[14px] font-semibold disabled:opacity-50 ${RING}`;
const solid = { background: INK, color: '#fff' }; const plain = { background: '#fff', color: INK, border: `1px solid ${LINE}` };
const QW = ['January to March', 'April to June', 'July to September', 'October to December'];
const dayOf = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString('en-US', { month: 'long', day: 'numeric', timeZone: 'UTC' });
const usd = (n: number) => `${n < 0 ? '−' : ''}$${Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

type Which = '941' | 'st' | 'ui';

export function PayrollFormsDialog(p: { open: boolean; onOpenChange: (o: boolean) => void; runs: any[]; tenant: any; state: string | null; today: string; businessName?: string }) {
  const spec = stateSpec(p.state); const hasSt = !!spec && !spec.noTax && !!spec.filing; const hasUi = !!spec;
  // (One form for both in some states, New York's NYS-45 and Oregon's OQ: its two parts.)
  const same = !!spec?.filing && spec.filing.quarterly === spec.sui.report;
  const stName = same ? `${spec!.filing!.quarterly}, withholding` : spec?.filing?.quarterly || 'State withholding'; const uiName = same ? `${spec!.sui.report}, wages` : spec?.sui.report || 'Wage report';
  // (Opens on the quarter to file: in a quarter's first month, the one just over.)
  const startQ = () => { const m = Number(p.today.slice(5, 7)); const y = Number(p.today.slice(0, 4)); const q = Math.floor((m - 1) / 3) + 1;
    return (m - 1) % 3 === 0 ? (q === 1 ? { year: y - 1, q: 4 } : { year: y, q: q - 1 }) : { year: y, q }; };
  const [at, setAt] = React.useState(startQ); const [which, setWhich] = React.useState<Which>('941');
  React.useEffect(() => { if (p.open) { setAt(startQ()); setWhich('941'); } }, [p.open]); // eslint-disable-line react-hooks/exhaustive-deps
  const step = (n: number) => setAt((x) => { const k = x.year * 4 + (x.q - 1) + n; return { year: Math.floor(k / 4), q: (k % 4) + 1 }; });
  // (Paydays are read from January of last year: no further back than that.)
  const first = at.year * 4 + at.q - 1 <= (Number(p.today.slice(0, 4)) - 1) * 4;
  const f941 = React.useMemo(() => form941(p.runs, p.tenant, at.year, at.q), [p.runs, p.tenant, at]);
  const stForm = React.useMemo(() => (hasSt ? formStateWithholding(p.runs, p.tenant, at.year, at.q) : null), [p.runs, p.tenant, at, hasSt]);
  const ui = React.useMemo(() => (hasUi ? formStateWageReport(p.runs, p.tenant, at.year, at.q) : null), [p.runs, p.tenant, at, hasUi]);
  const qEnd = new Date(Date.UTC(at.year, at.q * 3, 0, 12)).toISOString().slice(0, 10); const over = p.today > qEnd;
  const due = new Date(`${afterQuarter(qEnd)}T12:00:00Z`).toLocaleDateString('en-US', { month: 'long', day: 'numeric', timeZone: 'UTC' });
  const span = `${QW[at.q - 1]} ${at.year}`;
  const title = which === '941' ? 'Form 941' : which === 'st' ? stName : uiName;
  const lines: FormLine[] = which === '941' ? f941.lines : which === 'st' ? (stForm?.lines || []) : [];
  const amt = (l: FormLine) => (l.count ? String(l.amount) : usd(l.amount));

  const rows = (): (string | number)[][] => which === 'ui' && ui
    ? [['Person', 'Wages this quarter', 'Over the yearly limit', 'Wages unemployment is on'], ...ui.people.map((x) => [x.name, x.gross, x.excess, x.taxable]), ['In all', ui.totals.gross, ui.totals.excess, ui.totals.taxable], ['Contributions due', '', '', ui.due]]
    : [['Line', 'What it is', 'Amount'], ...lines.map((l) => [l.line, l.detail ? `${l.label} (${l.detail})` : l.label, l.amount])];
  const download = () => downloadCsv(csvName(String(p.businessName || ''), title.toLowerCase().replace(/\s+/g, '-'), span), [[`${title}, ${span}`], ...rows()] as any);
  const print = () => {
    const w = window.open('', '_blank'); if (!w) return;
    const r = rows(); const body = `<table><thead><tr>${r[0].map((c, i) => `<th${i ? ' class="r"' : ''}>${esc(c)}</th>`).join('')}</tr></thead><tbody>${r.slice(1).map((row) => `<tr>${row.map((c, i) => `<td${i ? ' class="r"' : ''}>${esc(typeof c === 'number' && (which === 'ui' || i === row.length - 1) ? (which === '941' && row[0] === '1' ? c : usd(c)) : c)}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
    w.document.open(); w.document.write(printPage({ title: `${title}, ${span}`, heading: esc(title), subtitle: esc(span), shopName: p.businessName, body,
      footNote: 'Worked out from the paydays recorded in ClarityFlow. Your EIN, your account number and each person’s Social Security number go on the form itself.', autoPrint: true }));
    w.document.close(); w.focus();
  };

  return (
    <Dialog open={p.open} onOpenChange={p.onOpenChange}>
      <DialogContent className="max-h-[92dvh] overflow-hidden rounded-3xl border-0 bg-[#f5f5f7] p-0 sm:max-w-2xl">
        <div className="flex max-h-[92dvh] flex-col" style={{ color: INK }}>
          <div className="shrink-0 px-5 pb-3 pt-5 sm:px-6">
            <DialogTitle className="pr-8 text-[20px] font-semibold leading-tight" style={{ color: INK }}>Payroll forms, {span}</DialogTitle>
            <DialogDescription className="mt-1 text-[14px]" style={{ color: MUTED }}>{f941.paydays ? `From ${f941.paydays} payday${f941.paydays === 1 ? '' : 's'} recorded${f941.prior ? `, and your old payroll’s through ${dayOf(f941.prior.through)}` : ''}. ` : f941.prior ? `From your old payroll’s paydays through ${dayOf(f941.prior.through)}. ` : 'No paydays recorded in these months. '}{over ? `Due ${due}.` : 'So far: the quarter isn’t over yet.'}</DialogDescription>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <button type="button" onClick={() => step(-1)} disabled={first} aria-label="The quarter before" className={`flex h-11 w-11 items-center justify-center rounded-full disabled:opacity-40 ${RING}`} style={plain}><ChevronLeft className="h-5 w-5" /></button>
              <button type="button" onClick={() => step(1)} aria-label="The quarter after" className={`flex h-11 w-11 items-center justify-center rounded-full ${RING}`} style={plain}><ChevronRight className="h-5 w-5" /></button>
              <span className="flex flex-wrap gap-2" role="group" aria-label="Which form">
                {(['941', ...(hasSt ? ['st'] : []), ...(hasUi ? ['ui'] : [])] as Which[]).map((k) => (
                  <button key={k} type="button" aria-pressed={which === k} onClick={() => setWhich(k)} className={btn} style={which === k ? solid : plain}>{k === '941' ? 'Form 941' : k === 'st' ? stName : uiName}</button>))}
              </span>
            </div>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-4 sm:px-6">
            {f941.oldFiles && <p className="mb-3 rounded-2xl px-4 py-3 text-[14px]" style={{ background: '#fff7ed', color: '#b45309' }}>Your old payroll company files this quarter’s returns. Give it these numbers for the paydays recorded here, so it puts them on its returns, and don’t file a second set.</p>}
            <section className="rounded-3xl bg-[#fff] px-5 py-2" style={{ border: `1px solid ${LINE}` }}>
              {which !== 'ui' && lines.map((l) => (
                <div key={l.line} className={`grid ${which === 'st' ? 'grid-cols-[84px_1fr_auto]' : 'grid-cols-[64px_1fr_auto]'} items-baseline gap-3 py-2.5 text-[15px]`} style={{ borderTop: l.line === lines[0].line ? undefined : `1px solid ${['10', 'Quarter'].includes(l.line) ? INK : LINE}`, fontWeight: ['10', 'Quarter'].includes(l.line) ? 600 : undefined }}>
                  <span style={{ color: MUTED }}>{l.line}</span>
                  <span className="min-w-0"><span className="block">{l.label}</span>{l.detail && <span className="block text-[13px]" style={{ color: MUTED }}>{l.detail}</span>}</span>
                  <span className="tabular-nums">{amt(l)}</span>
                </div>))}
              {which === 'ui' && ui && <>
                {!ui.people.length && <p className="py-3 text-[14px]" style={{ color: MUTED }}>Nobody was paid in these months.</p>}
                {ui.people.map((x, i) => (
                  <div key={x.name + i} className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 py-2.5 text-[15px]" style={{ borderTop: i ? `1px solid ${LINE}` : undefined }}>
                    <span>{x.name}</span>
                    <span className="text-right"><span className="block tabular-nums">{usd(x.gross)} in wages</span><span className="block text-[13px]" style={{ color: MUTED }}>{x.excess > 0 ? `${usd(x.excess)} over the yearly limit, ${usd(x.taxable)} taxed` : `all ${usd(x.taxable)} taxed`}</span></span>
                  </div>))}
                <div className="flex items-baseline justify-between gap-3 py-2.5 text-[15px] font-semibold" style={{ borderTop: `1px solid ${INK}` }}><span>Wages unemployment is on</span><span className="tabular-nums">{usd(ui.totals.taxable)}</span></div>
                <div className="flex items-baseline justify-between gap-3 py-2.5 text-[15px]" style={{ borderTop: `1px solid ${LINE}` }}><span>Contributions due</span><span className="tabular-nums">{usd(ui.due)}</span></div>
                {ui.prior && ui.prior.due > 0 && <p className="pb-2.5 text-[13px]" style={{ color: MUTED }}>{usd(ui.prior.due)} of it is on your old payroll’s wages through {dayOf(ui.prior.through)}{ui.prior.paid ? ': it paid that already.' : ', and it’s in what you owe for the quarter.'}</p>}
              </>}
            </section>
            <p className="mt-3 text-[13px]" style={{ color: MUTED }}>Copy these onto the form, or download them for your accountant. Your EIN and account number{which === 'ui' ? ', and each person’s Social Security number,' : ''} go on the form itself: ClarityFlow never keeps them.</p>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2 px-5 py-4 sm:px-6" style={{ borderTop: `1px solid ${LINE}`, background: SOFT }}>
            <button type="button" onClick={print} className={btn} style={plain}>Print</button>
            <button type="button" onClick={download} className={btn} style={plain}>Download for your accountant</button>
            <button type="button" onClick={() => p.onOpenChange(false)} className={btn} style={solid}>Done</button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
