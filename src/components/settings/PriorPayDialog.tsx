'use client';
// src/components/settings/PriorPayDialog.tsx — PAY FROM BEFORE CLARITYFLOW, THE FORM (Settings › Payroll; design board
// "Pay from before ClarityFlow"; PriorPayRow opens it). For a business that ran payroll another way earlier this year: each person's pay and what was
// withheld through the last payday elsewhere, and of it, what was since that quarter began, copied from the old
// payroll's year-to-date report or each person's last pay stub. Saved by the server (api/payroll/prior,
// lib/payroll-prior), so Social Security stops at its limit, unemployment at its wage limits, that quarter's forms have
// the whole quarter, and the year-end forms the whole year. Never added to what's owed.
import * as React from 'react';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { quarterStartOf, priorQuarterPart, type PriorPay, type PriorAmounts } from '@/lib/payroll-prior';
import { stateSpec } from '@/lib/state-payroll';
import { tablesFor } from '@/lib/withholding';

const INK = '#16171a', MUTED = '#6d7075', LINE = '#ececee', SOFT = '#f5f5f7', AMBER = '#b45309';
const RING = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#16171a] focus-visible:ring-offset-2';
const btn = `inline-flex min-h-[44px] items-center justify-center rounded-full px-4 text-[14px] font-semibold disabled:opacity-50 ${RING}`;
const solid = { background: INK, color: '#fff' }; const plain = { background: '#fff', color: INK, border: `1px solid ${LINE}` };
const fieldStyle = { border: `1px solid ${LINE}`, color: INK };
const shortDay = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString('en-US', { month: 'long', day: 'numeric', timeZone: 'UTC' });
type Draft = Record<string, { y: Record<keyof PriorAmounts, string>; q: Record<keyof PriorAmounts, string> }>;
// (Federal wages only when retirement or health came out before taxes: left empty, the same as wages and tips.)
const COLS: (keyof PriorAmounts)[] = ['wages', 'tips', 'fedWages', 'federal', 'ss', 'medicare', 'state'];
const blank = () => Object.fromEntries(COLS.map((k) => [k, ''])) as Record<keyof PriorAmounts, string>;
const num = (v: string) => Math.round((Number(v) || 0) * 100) / 100;
const str = (n: any) => { const v = Number(n); return v > 0 ? (Number.isInteger(v) ? String(v) : v.toFixed(2)) : ''; };

export type PriorPerson = { id: string; name: string; left?: boolean };

/** The form itself, for Settings and the harness: everyone's amounts, the last payday elsewhere, and what was paid. */
export function PriorPayDialog(p: { open: boolean; onOpenChange: (o: boolean) => void; people: PriorPerson[]; saved: PriorPay | null; state: string | null; today: string;
  onSave: (body: any) => Promise<string | null>; onRemove?: () => Promise<string | null> }) {
  const spec = stateSpec(p.state); const stTax = !!spec && !spec.noTax;
  const [last, setLast] = React.useState(''); const [futa, setFuta] = React.useState(''); const [d, setD] = React.useState<Draft>({});
  const [busy, setBusy] = React.useState(false); const [error, setError] = React.useState<string | null>(null);
  const [oldFiles, setOldFiles] = React.useState(false); const [depIrs, setDepIrs] = React.useState(''); const [depSt, setDepSt] = React.useState(''); const [suiPaid, setSuiPaid] = React.useState(false);
  React.useEffect(() => {
    if (!p.open) return;
    setLast(p.saved?.lastPayDate || ''); setFuta(str(p.saved?.futaPaid)); setError(null);
    setOldFiles(!!p.saved?.oldFiles); setDepIrs(p.saved?.deposits?.irs != null ? String(p.saved.deposits.irs) : ''); setDepSt(p.saved?.deposits?.state != null ? String(p.saved.deposits.state) : ''); setSuiPaid(!!p.saved?.suiPaid);
    const by = new Map((p.saved?.people || []).map((x) => [x.staffId, x]));
    setD(Object.fromEntries(p.people.map((x) => { const s = by.get(x.id);
      return [x.id, { y: Object.fromEntries(COLS.map((k) => [k, str(s?.[k])])) as any, q: Object.fromEntries(COLS.map((k) => [k, str(s?.q?.[k])])) as any }]; })));
  }, [p.open]); // eslint-disable-line react-hooks/exhaustive-deps
  const set = (id: string, part: 'y' | 'q', k: keyof PriorAmounts, v: string) => setD((x) => ({ ...x, [id]: { ...(x[id] || { y: blank(), q: blank() }), [part]: { ...(x[id]?.[part] || blank()), [k]: v } } }));
  const fields = COLS.filter((k) => k !== 'state' || stTax);
  const LABEL: Record<keyof PriorAmounts, string> = { wages: 'Wages and tips', tips: 'Of it, tips', fedWages: 'Federal wages', federal: 'Federal', ss: 'Social Security', medicare: 'Medicare', state: stTax ? spec!.name : 'State' };
  const amounts = (r: Record<keyof PriorAmounts, string>) => { const o: any = Object.fromEntries(COLS.filter((k) => k !== 'fedWages').map((k) => [k, num(r[k])])); if (num(r.fedWages) > 0) o.fedWages = num(r.fedWages); return o as PriorAmounts; };
  const list = () => p.people.map((x) => { const r = d[x.id]; if (!r) return null; return { staffId: x.id, name: x.name, ...amounts(r.y), q: amounts(r.q) }; })
    .filter((x: any) => x && COLS.some((k) => num(String(x[k] ?? '')) > 0 || num(String(x.q[k] ?? '')) > 0)) as any[];
  // (What the old payroll would have deposited for its part of that quarter: what it withheld and the employer's share.)
  const worked = React.useMemo(() => (/^\d{4}-\d{2}-\d{2}$/.test(last) ? priorQuarterPart({ kind: 'prior', year: Number(last.slice(0, 4)), lastPayDate: last, people: list(), futaPaid: 0 } as PriorPay,
    Number(last.slice(0, 4)), Math.floor((Number(last.slice(5, 7)) - 1) / 3) + 1, tablesFor(Number(last.slice(0, 4))).t.ss.base) : null), [d, last]); // eslint-disable-line react-hooks/exhaustive-deps
  const qStart = /^\d{4}-\d{2}-\d{2}$/.test(last) ? quarterStartOf(last) : null;
  const stReturn = stTax && spec?.filing ? spec.filing.quarterly : null;
  const save = async () => {
    setBusy(true); setError(null);
    const r = await p.onSave({ lastPayDate: last, people: list(), futaPaid: num(futa), oldFiles, suiPaid: !oldFiles && suiPaid,
      deposits: { irs: oldFiles || depIrs === '' ? null : num(depIrs), state: oldFiles || depSt === '' ? null : num(depSt) } }).catch(() => 'Not saved. Try again.');
    setBusy(false); if (r) setError(r); else p.onOpenChange(false);
  };
  const remove = async () => { if (!p.onRemove) return; setBusy(true); setError(null); const r = await p.onRemove().catch(() => 'Not changed. Try again.'); setBusy(false); if (r) setError(r); else p.onOpenChange(false); };
  const input = (id: string, part: 'y' | 'q', k: keyof PriorAmounts, name: string) => (
    <label key={k} className="flex min-w-0 flex-col gap-1 text-[13px]" style={{ color: MUTED }}>{LABEL[k]}
      <span className="flex h-11 items-center rounded-xl bg-[#fff] px-2.5 focus-within:ring-2 focus-within:ring-[#16171a]" style={fieldStyle}><span aria-hidden style={{ color: MUTED }}>$</span>
        <input type="number" inputMode="decimal" min={0} step="0.01" placeholder={k === 'fedWages' ? 'Same' : '0.00'} value={d[id]?.[part]?.[k] || ''} onChange={(e) => set(id, part, k, e.target.value)}
          aria-label={`${name}, ${LABEL[k]}${['wages', 'tips', 'fedWages'].includes(k) ? '' : ' withheld'}, ${part === 'y' ? 'this year' : 'since the quarter started'}`}
          className="h-full w-full min-w-0 bg-transparent pl-1 text-[15px] tabular-nums focus:outline-none" style={{ color: INK }} /></span></label>
  );
  const active = p.people.filter((x) => !x.left), left = p.people.filter((x) => x.left);
  const person = (x: PriorPerson) => (
    <div key={x.id} className="py-4" style={{ borderTop: `1px solid ${LINE}` }}>
      <p className="text-[15px] font-semibold">{x.name}</p>
      <p className="mt-2 text-[13px] font-semibold" style={{ color: MUTED }}>Paid this year, and withheld from it, through the last payday elsewhere</p>
      <div className="mt-1 grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">{fields.map((k) => input(x.id, 'y', k, x.name))}</div>
      <p className="mt-3 text-[13px] font-semibold" style={{ color: MUTED }}>Of it, since {qStart ? shortDay(qStart) : 'the quarter started'}</p>
      <div className="mt-1 grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">{fields.map((k) => input(x.id, 'q', k, x.name))}</div>
    </div>
  );

  return (
    <Dialog open={p.open} onOpenChange={(o) => { if (!busy) p.onOpenChange(o); }}>
      <DialogContent className="max-h-[92dvh] overflow-hidden rounded-3xl border-0 bg-[#f5f5f7] p-0 sm:max-w-5xl">
        <div className="flex max-h-[92dvh] flex-col" style={{ color: INK }}>
          <div className="px-5 pb-3 pt-5 sm:px-6">
            <DialogTitle className="pr-8 text-[20px] font-semibold leading-tight">Pay from before ClarityFlow</DialogTitle>
            <DialogDescription className="mt-1 max-w-[70ch] text-[14px]" style={{ color: MUTED }}>Paid so far this year, through your last payday elsewhere. From your old payroll’s year-to-date report, or each person’s last pay stub. So Social Security stops at its limit, unemployment at its wage limits, and the W-2s and Form 940 cover the whole year.</DialogDescription>
          </div>
          <div className="flex-1 space-y-4 overflow-y-auto px-5 pb-4 sm:px-6">
            <section aria-label="Last payday elsewhere" className="flex flex-col gap-3 rounded-3xl bg-[#fff] p-5" style={{ border: `1px solid ${LINE}` }}>
              <label htmlFor="prior-last" className="flex max-w-[260px] flex-col gap-1 text-[14px]" style={{ color: MUTED }}>Last payday elsewhere
                <input id="prior-last" type="date" value={last} max={p.today} min={`${Number(p.today.slice(0, 4)) - 1}-01-01`} onChange={(e) => setLast(e.target.value)} className={`h-11 w-full rounded-xl bg-[#fff] px-3 text-[15px] ${RING}`} style={fieldStyle} /></label>
              <p className="text-[13px]" style={{ color: MUTED }}>The part since {qStart ? shortDay(qStart) : 'that quarter started'} goes on {qStart ? 'that' : 'the'} quarter’s Form 941{stReturn ? ` and ${stReturn}` : ''}, with what the old payroll deposited counted as paid. Amounts withheld are what came out of each person’s pay.</p>
            </section>
            <section aria-label="Each person" className="rounded-3xl bg-[#fff] px-5 pb-1 pt-4" style={{ border: `1px solid ${LINE}` }}>
              <h3 className="text-[17px] font-semibold">Each person</h3>
              <p className="text-[14px]" style={{ color: MUTED }}>Wages and tips as Medicare wages on the report. Federal wages only when retirement or health came out before taxes. Leave anyone it didn’t pay empty.</p>
              {!p.people.length && <p className="py-3 text-[14px]" style={{ color: MUTED }}>Nobody on the team yet. Add them in Team first.</p>}
              {active.map(person)}
              {left.length > 0 && <p className="pt-4 text-[14px] font-semibold" style={{ color: MUTED, borderTop: `1px solid ${LINE}` }}>No longer on the team</p>}
              {left.map(person)}
            </section>
            <section aria-label="That quarter’s returns" className="flex flex-col gap-3 rounded-3xl bg-[#fff] p-5" style={{ border: `1px solid ${LINE}` }}>
              <h3 className="text-[17px] font-semibold">That quarter’s returns</h3>
              <p className="-mt-2 text-[14px]" style={{ color: MUTED }}>Only one Form 941 is filed for a quarter. When you switch partway through one, the new payroll usually files it, with the old payroll’s part on it.</p>
              <fieldset className="flex flex-col gap-2">
                <legend className="sr-only">Who files that quarter’s returns</legend>
                {([[false, 'ClarityFlow’s forms have the whole quarter', `Your old payroll’s part goes on them${stReturn ? `, and on the ${stReturn}` : ''}, with what it deposited counted as paid.`],
                  [true, 'My old payroll company files them', 'Give it the numbers for the paydays recorded here, from Payday’s forms, so only one set is filed. Its part still counts toward each person’s limits and the year’s forms.']] as const).map(([v, label, sub]) => (
                  <label key={String(v)} className="flex min-h-[44px] cursor-pointer items-start gap-3 rounded-2xl px-4 py-3 focus-within:ring-2 focus-within:ring-[#16171a]" style={{ border: `1px solid ${oldFiles === v ? INK : LINE}` }}>
                    <input type="radio" name="prior-files" checked={oldFiles === v} onChange={() => setOldFiles(v)} className="mt-0.5 h-5 w-5 shrink-0 accent-[#16171a]" />
                    <span className="min-w-0"><span className="block text-[15px]">{label}</span><span className="block text-[13px]" style={{ color: MUTED }}>{sub}</span></span>
                  </label>))}
              </fieldset>
              {!oldFiles && <>
                <div className="grid gap-3 sm:grid-cols-2">
                  <label htmlFor="prior-dep-irs" className="flex flex-col gap-1 text-[14px]" style={{ color: MUTED }}>Deposited with the IRS for its part{qStart ? ` since ${shortDay(qStart)}` : ''}
                    <span className="flex h-11 items-center rounded-xl bg-[#fff] px-3 focus-within:ring-2 focus-within:ring-[#16171a]" style={fieldStyle}><span aria-hidden style={{ color: MUTED }}>$</span>
                      <input id="prior-dep-irs" type="number" inputMode="decimal" min={0} step="0.01" placeholder={worked ? worked.owed.toFixed(2) : '0.00'} value={depIrs} onChange={(e) => setDepIrs(e.target.value)} className="h-full w-full min-w-0 bg-transparent pl-1 text-[15px] tabular-nums focus:outline-none" style={{ color: INK }} /></span></label>
                  {stTax && <label htmlFor="prior-dep-st" className="flex flex-col gap-1 text-[14px]" style={{ color: MUTED }}>Paid to {spec!.name} for its part{qStart ? ` since ${shortDay(qStart)}` : ''}
                    <span className="flex h-11 items-center rounded-xl bg-[#fff] px-3 focus-within:ring-2 focus-within:ring-[#16171a]" style={fieldStyle}><span aria-hidden style={{ color: MUTED }}>$</span>
                      <input id="prior-dep-st" type="number" inputMode="decimal" min={0} step="0.01" placeholder={worked ? worked.state.toFixed(2) : '0.00'} value={depSt} onChange={(e) => setDepSt(e.target.value)} className="h-full w-full min-w-0 bg-transparent pl-1 text-[15px] tabular-nums focus:outline-none" style={{ color: INK }} /></span></label>}
                </div>
                <p className="text-[13px]" style={{ color: MUTED }}>From its tax payment report, or EFTPS. Left empty, what it withheld and your share of Social Security and Medicare, as if all of it was paid. A last month that wasn’t paid is still owed: put in what was.</p>
                <label className="flex min-h-[44px] items-start gap-3 text-[15px]">
                  <input type="checkbox" checked={suiPaid} onChange={(e) => setSuiPaid(e.target.checked)} className="mt-0.5 h-5 w-5 shrink-0 accent-[#16171a]" />
                  <span className="min-w-0"><span className="block">It paid its part of that quarter’s {spec ? spec.name : 'state'} unemployment</span><span className="block text-[13px]" style={{ color: MUTED }}>Usually not: unemployment is paid with the quarter’s wage report. Unless this is checked, it’s added to what you owe for the quarter.</span></span>
                </label>
              </>}
            </section>
            <section aria-label="Federal unemployment" className="flex flex-col gap-2 rounded-3xl bg-[#fff] p-5" style={{ border: `1px solid ${LINE}` }}>
              <label htmlFor="prior-futa" className="flex max-w-[260px] flex-col gap-1 text-[14px]" style={{ color: MUTED }}>Federal unemployment your old payroll paid this year
                <span className="flex h-11 items-center rounded-xl bg-[#fff] px-3 focus-within:ring-2 focus-within:ring-[#16171a]" style={fieldStyle}><span aria-hidden style={{ color: MUTED }}>$</span>
                  <input id="prior-futa" type="number" inputMode="decimal" min={0} step="0.01" placeholder="0.00" value={futa} onChange={(e) => setFuta(e.target.value)} className="h-full w-full min-w-0 bg-transparent pl-1 text-[15px] tabular-nums focus:outline-none" style={{ color: INK }} /></span></label>
              <p className="text-[13px]" style={{ color: MUTED }}>For Form 940 in January. It’s on the old payroll’s tax payment report. Leave it empty if it paid none.</p>
            </section>
            <p className="rounded-2xl bg-[#fff] px-4 py-3 text-[14px]" style={{ color: MUTED, border: `1px solid ${LINE}` }}>Taxes your old payroll already paid stay paid: only paydays recorded here are added to what you owe.</p>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2 px-5 py-4 sm:px-6" style={{ borderTop: `1px solid ${LINE}`, background: SOFT }}>
            {error && <span role="alert" className="min-w-[200px] flex-1 text-[13px]" style={{ color: AMBER }}>{error}</span>}
            {p.saved && p.onRemove && <button type="button" onClick={remove} disabled={busy} className={`${btn} ${error ? '' : 'mr-auto'}`} style={plain}>Take it out</button>}
            <span className="flex flex-wrap gap-2">
              <button type="button" onClick={() => p.onOpenChange(false)} disabled={busy} className={btn} style={plain}>Cancel</button>
              <button type="button" onClick={save} disabled={busy || !last} className={btn} style={solid}>{busy ? 'Saving' : 'Save'}</button>
            </span>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

