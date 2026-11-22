'use client';
// src/components/menu/CounterMoneyCard.tsx — TIPS AND DISCOUNTS, ON THE MENU PAGE'S SETTINGS (lib/counter-money; api/menu
// 'laneSettings'; design board "Money at the counter"). Tips: off until turned on, the three percents guests pick from,
// and the counter only or the drive-thru too. Discounts: the business's own list (a name, a percent or an amount off),
// which anyone at the counter can use; any other amount takes a manager at the counter.
import { useState } from 'react';
import { DISCOUNTS_MAX, discountWords, type Discount, type TipSettings } from '@/lib/counter-money';

const INK = '#16171a', MUTED = '#6d7075', LINE = '#ececee', AMBER = '#b45309';
const RING = 'outline-none focus-visible:ring-2 focus-visible:ring-[#16171a] focus-visible:ring-offset-2';
const btn = `min-h-[44px] rounded-xl px-4 text-[14.5px] font-semibold disabled:opacity-50 ${RING}`;
const field = `min-h-[44px] rounded-xl px-3 text-[15px] ${RING}`;
export type MoneySettings = { tips: TipSettings; discounts: Discount[] };
type Row = { id: string; label: string; kind: 'pct' | 'off'; value: string };
const rowOf = (d: Discount): Row => ({ id: d.id, label: d.label, kind: d.kind, value: d.kind === 'pct' ? String(d.value) : (d.value / 100).toFixed(2) });

export function CounterMoneyCard({ start, call }: { start: MoneySettings; call: (body: any) => Promise<any> }) {
  const [open, setOpen] = useState(false);
  const [tips, setTips] = useState<TipSettings>(start.tips);
  const [pcts, setPcts] = useState<string[]>(start.tips.pcts.map(String));
  const [rows, setRows] = useState<Row[]>(start.discounts.map(rowOf));
  const [saved, setSaved] = useState<Discount[]>(start.discounts);
  const [busy, setBusy] = useState<string | null>(null); const [msg, setMsg] = useState<{ text: string; tone: 'good' | 'warn' } | null>(null);
  const seg = (on: boolean) => (on ? { background: INK, color: '#fff' } : { background: '#fff', color: INK, boxShadow: `inset 0 0 0 1px ${LINE}` });

  const saveTips = async (next: TipSettings) => {
    setBusy('tips'); setMsg(null);
    const d = await call({ action: 'laneSettings', tips: next });
    setBusy(null);
    if (d.ok && d.lane?.tips) { setTips(d.lane.tips); setPcts(d.lane.tips.pcts.map(String)); setMsg({ text: d.lane.tips.on ? `Tips are on: ${d.lane.tips.pcts.join('%, ')}%.` : 'Tips are off.', tone: 'good' }); }
    else setMsg({ text: d.error || 'That didn’t save.', tone: 'warn' });
  };
  const pctsOk = pcts.every((p) => /^\d{1,2}$/.test(p) && Number(p) >= 1 && Number(p) <= 50);
  const rowOk = (r: Row) => r.label.trim() && (r.kind === 'pct' ? /^\d{1,3}$/.test(r.value) && Number(r.value) >= 1 && Number(r.value) <= 100 : Number(r.value) >= 0.01 && Number(r.value) <= 500);
  const saveList = async () => {
    setBusy('discounts'); setMsg(null);
    const d = await call({ action: 'laneSettings', discounts: rows.map((r) => ({ id: r.id || undefined, label: r.label.trim(), kind: r.kind, value: r.kind === 'pct' ? Number(r.value) : Math.round(Number(r.value) * 100) })) });
    setBusy(null);
    if (d.ok && Array.isArray(d.lane?.discounts)) { setSaved(d.lane.discounts); setRows(d.lane.discounts.map(rowOf)); setMsg({ text: d.lane.discounts.length ? 'The discounts are saved.' : 'No discounts now.', tone: 'good' }); }
    else setMsg({ text: d.error || 'That didn’t save.', tone: 'warn' });
  };
  const change = (i: number, patch: Partial<Row>) => setRows((rs) => rs.map((r, k) => (k === i ? { ...r, ...patch } : r)));
  const summary = `${tips.on ? `Tips ${tips.pcts.join('%, ')}%${tips.where === 'both' ? ', counter and drive-thru' : ', at the counter'}` : 'No tips'}. ${saved.length ? `${saved.length} ${saved.length === 1 ? 'discount' : 'discounts'}` : 'No discounts yet'}.`;

  return (
    <section aria-labelledby="money-title" className="rounded-3xl border bg-[#fff]" style={{ borderColor: LINE }}>
      <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} className={`flex min-h-[56px] w-full items-center justify-between gap-3 rounded-3xl px-5 text-left ${RING}`}>
        <span><span id="money-title" className="block text-[16px] font-semibold">Tips and discounts</span><span className="block text-[13.5px]" style={{ color: MUTED }}>{summary}</span></span>
        <span className="text-[14px] font-semibold" style={{ color: MUTED }}>{open ? 'Close' : 'Change'}</span>
      </button>
      {open && <div className="space-y-5 border-t px-5 pb-5 pt-4" style={{ borderColor: LINE }}>
        <div role="group" aria-labelledby="tips-title" className="space-y-3">
          <span><span id="tips-title" className="block text-[15px] font-medium">Tips</span>
            <span className="block text-[13px]" style={{ color: MUTED }}>Guests pick a tip on the screen before paying, and the card is charged once with it. Handing over cash, they can keep the change as a tip. Tips go to whoever takes the payment, then your tip policy shares them.</span></span>
          <span className="flex flex-wrap gap-2">
            {([[true, 'Take tips'], [false, 'No tips']] as [boolean, string][]).map(([v, label]) => <button key={label} type="button" aria-pressed={tips.on === v} disabled={busy === 'tips'} onClick={() => { if (tips.on !== v) void saveTips({ ...tips, on: v }); }} className={btn} style={seg(tips.on === v)}>{label}</button>)}
          </span>
          {tips.on && <>
            <span className="flex flex-wrap gap-2" role="group" aria-label="Where">
              {([['counter', 'At the counter'], ['both', 'The counter and the drive-thru']] as ['counter' | 'both', string][]).map(([v, label]) => <button key={v} type="button" aria-pressed={tips.where === v} disabled={busy === 'tips'} onClick={() => { if (tips.where !== v) void saveTips({ ...tips, where: v }); }} className={btn} style={seg(tips.where === v)}>{label}</button>)}
            </span>
            <div className="flex flex-wrap items-end gap-2">
              {pcts.map((p, i) => <label key={i} className="block text-[13px] font-semibold" style={{ color: MUTED }}>{['First', 'Second', 'Third'][i]}
                <span className="mt-1 flex items-center gap-1"><input inputMode="numeric" value={p} onChange={(e) => setPcts((ps) => ps.map((x, k) => (k === i ? e.target.value.replace(/\D/g, '').slice(0, 2) : x)))} className={`${field} w-[72px]`} style={{ border: `1px solid ${LINE}`, color: INK }} /><span className="text-[15px]" style={{ color: INK }}>%</span></span></label>)}
              <button type="button" disabled={busy === 'tips' || !pctsOk || pcts.join() === tips.pcts.map(String).join()} onClick={() => void saveTips({ ...tips, pcts: pcts.map(Number) as [number, number, number] })} className={btn} style={{ background: INK, color: '#fff' }}>Save the percents</button>
            </div>
            {!pctsOk && <p className="text-[13px]" style={{ color: AMBER }}>Each from 1 to 50.</p>}
          </>}
        </div>
        <div role="group" aria-labelledby="discounts-title" className="space-y-3 border-t pt-4" style={{ borderColor: LINE }}>
          <span><span id="discounts-title" className="block text-[15px] font-medium">Discounts</span>
            <span className="block text-[13px]" style={{ color: MUTED }}>Anyone at the counter can use these on an order, one at a time, off before tax. Any other amount takes a manager there, with a reason, and it’s kept on record.</span></span>
          {rows.map((r, i) => <div key={i} className="flex flex-wrap items-end gap-2 rounded-2xl p-3" style={{ border: `1px solid ${LINE}` }}>
            <label className="block min-w-[160px] flex-1 text-[13px] font-semibold" style={{ color: MUTED }}>Name
              <input value={r.label} onChange={(e) => change(i, { label: e.target.value.slice(0, 32) })} placeholder="Student" className={`${field} mt-1 block w-full`} style={{ border: `1px solid ${LINE}`, color: INK }} /></label>
            <span className="flex gap-1" role="radiogroup" aria-label={`${r.label || 'This discount'}: percent or amount`}>
              {([['pct', '%'], ['off', '$ off']] as ['pct' | 'off', string][]).map(([k, label]) => <button key={k} type="button" role="radio" aria-checked={r.kind === k} onClick={() => change(i, { kind: k, value: '' })} className={btn} style={seg(r.kind === k)}>{label}</button>)}
            </span>
            <label className="block text-[13px] font-semibold" style={{ color: MUTED }}>{r.kind === 'pct' ? 'Percent' : 'Amount'}
              <input inputMode="decimal" value={r.value} onChange={(e) => change(i, { value: e.target.value.replace(r.kind === 'pct' ? /\D/g : /[^\d.]/g, '').slice(0, 6) })} placeholder={r.kind === 'pct' ? '10' : '1.00'} className={`${field} mt-1 block w-[96px]`} style={{ border: `1px solid ${LINE}`, color: INK }} /></label>
            <button type="button" onClick={() => setRows((rs) => rs.filter((_, k) => k !== i))} aria-label={`Remove ${r.label || 'this discount'}`} className={btn} style={{ color: MUTED }}>Remove</button>
          </div>)}
          <div className="flex flex-wrap gap-2">
            {rows.length < DISCOUNTS_MAX && <button type="button" onClick={() => setRows((rs) => [...rs, { id: '', label: '', kind: 'pct', value: '' }])} className={btn} style={seg(false)}>Add a discount</button>}
            <button type="button" disabled={busy === 'discounts' || !rows.every(rowOk)} onClick={() => void saveList()} className={btn} style={{ background: INK, color: '#fff' }}>Save the discounts</button>
          </div>
          {saved.length > 0 && <p className="text-[13px]" style={{ color: MUTED }}>Now: {saved.map((d) => `${d.label}, ${discountWords(d)}`).join('; ')}.</p>}
        </div>
        <p role="status" aria-live="polite" className={msg ? 'rounded-xl px-3 py-2 text-[13.5px]' : 'sr-only'} style={msg ? (msg.tone === 'good' ? { background: '#ecf6f0', color: '#1f7a4d' } : { background: '#fff7ed', color: AMBER }) : undefined}>{msg?.text || ''}</p>
      </div>}
    </section>
  );
}
