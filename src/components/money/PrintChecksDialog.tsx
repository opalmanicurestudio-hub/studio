'use client';
// src/components/money/PrintChecksDialog.tsx — PRINT CHECKS (Money › Payday › Print checks; design board "Print
// checks"). The people paid by check this payday, each check numbered from the first number, on voucher check paper
// (lib/payroll-checks): the check on top or in the middle, a stub for the person and one for the business. A test page on
// plain paper and a nudge in sixteenths of an inch line it up with the paper; the nudge and the paper are kept for the
// business, and the check numbers are handed out by the server (api/payroll/forms), so none is used twice. Never prints an
// account number: the bank's numbers are already on the check paper.
import * as React from 'react';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { checksHtml, type CheckData, type CheckLayout, type Nudge } from '@/lib/payroll-checks';

const INK = '#16171a', MUTED = '#6d7075', LINE = '#ececee', SOFT = '#f5f5f7', GREEN = '#1f7a4d', GREEN_TINT = '#eaf6ef';
const RING = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#16171a] focus-visible:ring-offset-2';
const btn = `inline-flex min-h-[44px] items-center justify-center rounded-full px-4 text-[14px] font-semibold disabled:opacity-50 ${RING}`;
const solid = { background: INK, color: '#fff' }; const plain = { background: '#fff', color: INK, border: `1px solid ${LINE}` };
const usd = (v: number) => `$${Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const sixteenths = (n: number, pos: string, neg: string) => (n === 0 ? '' : `${Math.abs(n)}/16 inch ${n > 0 ? pos : neg}`);

export function PrintChecksDialog(p: {
  open: boolean; onOpenChange: (o: boolean) => void;
  /** "December 3 payday". */
  title: string;
  /** Each check, in order; `no` empty when it has no number yet. */
  checks: (CheckData & { id: string })[];
  business: { name: string; lines: string[] };
  layout: CheckLayout; nudge: Nudge; nextNo?: string;
  /** Keeps the paper and the nudge for the business. */
  onSettings: (s: { layout: CheckLayout; nudge: Nudge }) => void;
  /** The numbers for these checks, from the first one put in (else the next one kept): a string back is what went wrong. */
  onNumbers: (count: number, first: string) => Promise<string[] | string>;
}) {
  const [layout, setLayout] = React.useState<CheckLayout>(p.layout); const [nudge, setNudge] = React.useState<Nudge>(p.nudge);
  const firstSet = p.checks.find((c) => c.no)?.no || '';
  const [first, setFirst] = React.useState(firstSet); const [moved, setMoved] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false); const [error, setError] = React.useState<string | null>(null);
  React.useEffect(() => { if (p.open) { setLayout(p.layout); setNudge(p.nudge); setFirst(firstSet); setMoved(null); setError(null); } }, [p.open]); // eslint-disable-line react-hooks/exhaustive-deps
  const from = /^\d+$/.test(first) ? first : /^\d+$/.test(p.nextNo || '') ? p.nextNo! : '';
  const base = from ? Number(from) : null;
  const numbered = p.checks.map((c, i) => ({ ...c, no: base != null ? String(base + i) : '' }));
  const open = (html: string) => { const w = window.open('', '_blank'); if (!w) return; w.document.open(); w.document.write(html); w.document.close(); w.focus(); };
  // (The window opens on the tap, so it isn't blocked; the checks go in it once the server has numbered them.)
  const print = async () => {
    const w = window.open('', '_blank'); if (w) { w.document.open(); w.document.write('<p style="font-family:sans-serif;padding:24px">Numbering the checks…</p>'); w.document.close(); }
    setBusy(true); setError(null);
    const nums = await p.onNumbers(p.checks.length, /^\d+$/.test(first) ? first : '').catch(() => 'Not printed. Try again.');
    setBusy(false);
    if (typeof nums === 'string') { w?.close(); setError(nums); return; }
    const html = checksHtml({ business: p.business, checks: p.checks.map((c, i) => ({ ...c, no: nums[i] || '' })), layout, nudge });
    if (w) { w.document.open(); w.document.write(html); w.document.close(); w.focus(); } else open(html);
    setFirst(String(Number(nums[nums.length - 1]) + 1));
  };
  const move = (dx: number, dy: number, words: string) => { const n = { x: nudge.x + dx, y: nudge.y + dy }; setNudge(n); setMoved(`Moved 1/16 inch ${words}. Kept for every check you print from here.`); p.onSettings({ layout, nudge: n }); };
  const pick = (l: CheckLayout) => { setLayout(l); p.onSettings({ layout: l, nudge }); };
  const now = [sixteenths(nudge.y, 'down', 'up'), sixteenths(nudge.x, 'right', 'left')].filter(Boolean).join(', ');

  return (
    <Dialog open={p.open} onOpenChange={p.onOpenChange}>
      <DialogContent className="max-h-[92dvh] overflow-hidden rounded-3xl border-0 bg-[#f5f5f7] p-0 sm:max-w-3xl">
        <div className="flex max-h-[92dvh] flex-col" style={{ color: INK }}>
          <div className="px-5 pb-3 pt-5 sm:px-6">
            <DialogTitle className="pr-8 text-[20px] font-semibold leading-tight">Print checks</DialogTitle>
            <DialogDescription className="mt-1 text-[14px]" style={{ color: MUTED }}>{p.title}: the people paid by check.</DialogDescription>
          </div>
          <div className="grid flex-1 items-start gap-4 overflow-y-auto px-5 pb-4 sm:px-6 md:grid-cols-2">
            <section aria-label="Checks to print" className="flex flex-col gap-3 rounded-3xl bg-[#fff] p-5" style={{ border: `1px solid ${LINE}` }}>
              <h3 className="text-[17px] font-semibold">Checks to print</h3>
              <div>{numbered.map((c, i) => (
                <div key={c.id} className="flex min-h-[44px] items-center justify-between gap-3 py-2" style={{ borderTop: i ? `1px solid ${LINE}` : undefined }}>
                  <span className="min-w-0"><span className="block">{c.payee}</span><span className="block text-[13px]" style={{ color: MUTED }}>{c.no ? `Check ${c.no}, with their pay stub below it` : 'Numbered when printed, with their pay stub below it'}</span></span>
                  <span className="shrink-0 tabular-nums">{usd(c.amount)}</span>
                </div>))}</div>
              <label htmlFor="chk-first" className="flex max-w-[200px] flex-col gap-1 text-[14px]" style={{ color: MUTED }}>First check number
                <input id="chk-first" value={first} placeholder={p.nextNo || '1001'} onChange={(e) => setFirst(e.target.value.replace(/\D/g, '').slice(0, 10))} inputMode="numeric" className={`h-11 w-full rounded-xl bg-[#fff] px-3 text-[15px] tabular-nums ${RING}`} style={{ border: `1px solid ${LINE}`, color: INK }} /></label>
              <fieldset className="flex flex-col gap-2">
                <legend className="mb-1 text-[14px]" style={{ color: MUTED }}>Check paper</legend>
                {([['top', 'Check on top, two stubs below', 'Voucher checks, one per sheet: one stub for them, one for you'], ['middle', 'Check in the middle', 'A stub above and below']] as const).map(([v, label, sub]) => (
                  <label key={v} className="flex min-h-[44px] cursor-pointer items-start gap-3 rounded-2xl px-4 py-3 focus-within:ring-2 focus-within:ring-[#16171a]" style={{ border: `1px solid ${layout === v ? INK : LINE}` }}>
                    <input type="radio" name="chk-paper" checked={layout === v} onChange={() => pick(v)} className="mt-0.5 h-5 w-5 shrink-0 accent-[#16171a]" />
                    <span className="min-w-0"><span className="block text-[15px]">{label}</span><span className="block text-[13px]" style={{ color: MUTED }}>{sub}</span></span>
                  </label>))}
              </fieldset>
              <p className="text-[13px]" style={{ color: MUTED }}>Use check paper with your bank’s numbers already printed on it. ClarityFlow prints the payee, the amount, the date and the stubs, never your account number.</p>
            </section>
            <section aria-label="Line it up" className="flex flex-col gap-3 rounded-3xl bg-[#fff] p-5" style={{ border: `1px solid ${LINE}` }}>
              <h3 className="text-[17px] font-semibold">Line it up</h3>
              <p className="text-[14px]" style={{ color: MUTED }}>Print a test page on plain paper, hold it over a sheet of checks against a window, and nudge it until the boxes sit on the lines.</p>
              <button type="button" onClick={() => open(checksHtml({ business: p.business, checks: [], layout, nudge, test: true }))} className={`${btn} self-start`} style={plain}>Print a test page</button>
              <div className="grid grid-cols-2 gap-2" role="group" aria-label="Move what’s printed">
                <button type="button" onClick={() => move(0, -1, 'up')} className={btn} style={plain}>Up 1/16 inch</button>
                <button type="button" onClick={() => move(0, 1, 'down')} className={btn} style={plain}>Down 1/16 inch</button>
                <button type="button" onClick={() => move(-1, 0, 'left')} className={btn} style={plain}>Left 1/16 inch</button>
                <button type="button" onClick={() => move(1, 0, 'right')} className={btn} style={plain}>Right 1/16 inch</button>
              </div>
              <p role="status" className="text-[13px]" style={moved ? { color: GREEN, background: GREEN_TINT, borderRadius: 16, padding: '10px 14px' } : { color: MUTED }}>{moved || (now ? `Moved ${now} from where it starts.` : 'Where it starts: not moved.')}</p>
              {now && <button type="button" onClick={() => { const n = { x: 0, y: 0 }; setNudge(n); setMoved('Back where it starts. Kept for every check you print from here.'); p.onSettings({ layout, nudge: n }); }} className={`${btn} self-start`} style={plain}>Back where it starts</button>}
            </section>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2 px-5 py-4 sm:px-6" style={{ borderTop: `1px solid ${LINE}`, background: SOFT }}>
            {error && <span role="alert" className="min-w-[200px] flex-1 text-[13px]" style={{ color: '#b45309' }}>{error}</span>}
            <button type="button" onClick={() => p.onOpenChange(false)} disabled={busy} className={btn} style={plain}>Done</button>
            <button type="button" onClick={print} disabled={!numbered.length || busy} className={btn} style={solid}>{busy ? 'Numbering' : `Print ${numbered.length} check${numbered.length === 1 ? '' : 's'}`}</button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
