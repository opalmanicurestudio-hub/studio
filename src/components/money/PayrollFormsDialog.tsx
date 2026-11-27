'use client';
// src/components/money/PayrollFormsDialog.tsx — THE QUARTER'S PAYROLL FORMS, LINE BY LINE (Money › Payday › Payroll
// taxes › See the numbers; design board "Payroll run in ClarityFlow", Form 941). Form 941 from the paydays paid in the
// quarter, and for North Carolina, NC-5 and the NCUI 101 wage report (lib/payroll-owed). To copy onto the forms, print,
// or download for an accountant. The business's EIN, and each person's Social Security number, go on the forms
// themselves: ClarityFlow never keeps them.
import * as React from 'react';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { form941, formNC5, formNCUI101, type FormLine } from '@/lib/payroll-owed';
import { afterQuarter } from '@/lib/payroll-taxes';
import { csvName, downloadCsv } from '@/lib/csv';
import { esc, printPage } from '@/lib/print-style';
import { ChevronLeft, ChevronRight } from 'lucide-react';

const INK = '#16171a', MUTED = '#6d7075', LINE = '#ececee', SOFT = '#f5f5f7';
const RING = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#16171a] focus-visible:ring-offset-2';
const btn = `inline-flex min-h-[44px] items-center justify-center rounded-full px-4 text-[14px] font-semibold disabled:opacity-50 ${RING}`;
const solid = { background: INK, color: '#fff' }; const plain = { background: '#fff', color: INK, border: `1px solid ${LINE}` };
const QW = ['January to March', 'April to June', 'July to September', 'October to December'];
const usd = (n: number) => `${n < 0 ? '−' : ''}$${Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

type Which = '941' | 'nc5' | 'ncui';

export function PayrollFormsDialog(p: { open: boolean; onOpenChange: (o: boolean) => void; runs: any[]; tenant: any; nc: boolean; today: string; businessName?: string }) {
  // (Opens on the quarter to file: in a quarter's first month, the one just over.)
  const startQ = () => { const m = Number(p.today.slice(5, 7)); const y = Number(p.today.slice(0, 4)); const q = Math.floor((m - 1) / 3) + 1;
    return (m - 1) % 3 === 0 ? (q === 1 ? { year: y - 1, q: 4 } : { year: y, q: q - 1 }) : { year: y, q }; };
  const [at, setAt] = React.useState(startQ); const [which, setWhich] = React.useState<Which>('941');
  React.useEffect(() => { if (p.open) { setAt(startQ()); setWhich('941'); } }, [p.open]); // eslint-disable-line react-hooks/exhaustive-deps
  const step = (n: number) => setAt((x) => { const k = x.year * 4 + (x.q - 1) + n; return { year: Math.floor(k / 4), q: (k % 4) + 1 }; });
  // (Paydays are read from January of last year: no further back than that.)
  const first = at.year * 4 + at.q - 1 <= (Number(p.today.slice(0, 4)) - 1) * 4;
  const f941 = React.useMemo(() => form941(p.runs, p.tenant, at.year, at.q), [p.runs, p.tenant, at]);
  const nc5 = React.useMemo(() => (p.nc ? formNC5(p.runs, p.tenant, at.year, at.q) : null), [p.runs, p.tenant, at, p.nc]);
  const ui = React.useMemo(() => (p.nc ? formNCUI101(p.runs, p.tenant, at.year, at.q) : null), [p.runs, p.tenant, at, p.nc]);
  const qEnd = new Date(Date.UTC(at.year, at.q * 3, 0, 12)).toISOString().slice(0, 10); const over = p.today > qEnd;
  const due = new Date(`${afterQuarter(qEnd)}T12:00:00Z`).toLocaleDateString('en-US', { month: 'long', day: 'numeric', timeZone: 'UTC' });
  const span = `${QW[at.q - 1]} ${at.year}`;
  const title = which === '941' ? 'Form 941' : which === 'nc5' ? 'NC-5' : 'NCUI 101';
  const lines: FormLine[] = which === '941' ? f941.lines : which === 'nc5' ? (nc5?.lines || []) : [];
  const amt = (l: FormLine) => (l.count ? String(l.amount) : usd(l.amount));

  const rows = (): (string | number)[][] => which === 'ncui' && ui
    ? [['Person', 'Wages this quarter', 'Over the yearly limit', 'Wages unemployment is on'], ...ui.people.map((x) => [x.name, x.gross, x.excess, x.taxable]), ['In all', ui.totals.gross, ui.totals.excess, ui.totals.taxable], ['Contributions due', '', '', ui.due]]
    : [['Line', 'What it is', 'Amount'], ...lines.map((l) => [l.line, l.detail ? `${l.label} (${l.detail})` : l.label, l.amount])];
  const download = () => downloadCsv(csvName(String(p.businessName || ''), title.toLowerCase().replace(/\s+/g, '-'), span), [[`${title}, ${span}`], ...rows()] as any);
  const print = () => {
    const w = window.open('', '_blank'); if (!w) return;
    const r = rows(); const body = `<table><thead><tr>${r[0].map((c, i) => `<th${i ? ' class="r"' : ''}>${esc(c)}</th>`).join('')}</tr></thead><tbody>${r.slice(1).map((row) => `<tr>${row.map((c, i) => `<td${i ? ' class="r"' : ''}>${esc(typeof c === 'number' && (which === 'ncui' || i === row.length - 1) ? (which === '941' && row[0] === '1' ? c : usd(c)) : c)}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
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
            <DialogDescription className="mt-1 text-[14px]" style={{ color: MUTED }}>{f941.paydays ? `From ${f941.paydays} payday${f941.paydays === 1 ? '' : 's'} recorded. ` : 'No paydays recorded in these months. '}{over ? `Due ${due}.` : 'So far: the quarter isn’t over yet.'}</DialogDescription>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <button type="button" onClick={() => step(-1)} disabled={first} aria-label="The quarter before" className={`flex h-11 w-11 items-center justify-center rounded-full disabled:opacity-40 ${RING}`} style={plain}><ChevronLeft className="h-5 w-5" /></button>
              <button type="button" onClick={() => step(1)} aria-label="The quarter after" className={`flex h-11 w-11 items-center justify-center rounded-full ${RING}`} style={plain}><ChevronRight className="h-5 w-5" /></button>
              <span className="flex flex-wrap gap-2" role="group" aria-label="Which form">
                {(['941', ...(p.nc ? ['nc5', 'ncui'] : [])] as Which[]).map((k) => (
                  <button key={k} type="button" aria-pressed={which === k} onClick={() => setWhich(k)} className={btn} style={which === k ? solid : plain}>{k === '941' ? 'Form 941' : k === 'nc5' ? 'NC-5' : 'NCUI 101'}</button>))}
              </span>
            </div>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-4 sm:px-6">
            <section className="rounded-3xl bg-[#fff] px-5 py-2" style={{ border: `1px solid ${LINE}` }}>
              {which !== 'ncui' && lines.map((l) => (
                <div key={l.line} className="grid grid-cols-[64px_1fr_auto] items-baseline gap-3 py-2.5 text-[15px]" style={{ borderTop: l.line === lines[0].line ? undefined : `1px solid ${['10', 'Quarter'].includes(l.line) ? INK : LINE}`, fontWeight: ['10', 'Quarter'].includes(l.line) ? 600 : undefined }}>
                  <span style={{ color: MUTED }}>{l.line}</span>
                  <span className="min-w-0"><span className="block">{l.label}</span>{l.detail && <span className="block text-[13px]" style={{ color: MUTED }}>{l.detail}</span>}</span>
                  <span className="tabular-nums">{amt(l)}</span>
                </div>))}
              {which === 'ncui' && ui && <>
                {!ui.people.length && <p className="py-3 text-[14px]" style={{ color: MUTED }}>Nobody was paid in these months.</p>}
                {ui.people.map((x, i) => (
                  <div key={x.name + i} className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 py-2.5 text-[15px]" style={{ borderTop: i ? `1px solid ${LINE}` : undefined }}>
                    <span>{x.name}</span>
                    <span className="text-right"><span className="block tabular-nums">{usd(x.gross)} in wages</span><span className="block text-[13px]" style={{ color: MUTED }}>{x.excess > 0 ? `${usd(x.excess)} over the yearly limit, ${usd(x.taxable)} taxed` : `all ${usd(x.taxable)} taxed`}</span></span>
                  </div>))}
                <div className="flex items-baseline justify-between gap-3 py-2.5 text-[15px] font-semibold" style={{ borderTop: `1px solid ${INK}` }}><span>Wages unemployment is on</span><span className="tabular-nums">{usd(ui.totals.taxable)}</span></div>
                <div className="flex items-baseline justify-between gap-3 py-2.5 text-[15px]" style={{ borderTop: `1px solid ${LINE}` }}><span>Contributions due</span><span className="tabular-nums">{usd(ui.due)}</span></div>
              </>}
            </section>
            <p className="mt-3 text-[13px]" style={{ color: MUTED }}>Copy these onto the form, or download them for your accountant. Your EIN and account number{which === 'ncui' ? ', and each person’s Social Security number,' : ''} go on the form itself: ClarityFlow never keeps them.</p>
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
