'use client';
// src/components/money/HomeOfficeCalc.tsx — WORKING OUT A HOME OFFICE (lib/home-office), on the often-missed home office
// for the owner (Money, Write-offs) and for a renter (their portal's Write-offs). The office's size and the months it
// was used give the simple way as it's typed; the home's size and its costs for the year, folded under one button, give
// the regular way as an estimate beside it. Saved, it prints with the rest of the write-offs. Whether the space counts,
// and which way to use, is said to be the accountant's. Used in the renter portal too, so no bold weights.
import * as React from 'react';
import { COST_LABELS, MAX_SQFT, cleanHomeOffice, homeOfficeFigures, type HomeOffice } from '@/lib/home-office';

const INK = '#16171a', MUTED = '#6d7075', LINE = '#ececee', SOFT = '#f5f5f7', GREEN = '#1f7a4d', AMBER = '#b45309';
const RING = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#16171a] focus-visible:ring-offset-2';
const btn = `inline-flex min-h-[44px] items-center justify-center rounded-full px-4 text-[14px] font-semibold disabled:opacity-40 ${RING}`;
const field = `h-11 w-full rounded-xl border bg-[#fff] px-3 text-[15px] ${RING}`;
const link = `inline-flex min-h-[44px] items-center self-start text-[14px] font-semibold underline underline-offset-2 ${RING}`;
const usd = (c: number) => `$${(c / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const dollars = (c: number) => (c ? String(Math.round(c) / 100) : '');

export type HomeOfficeBody = { officeSqft: string; months: number; homeSqft: string; costs: Record<string, string> };

export function HomeOfficeCalc({ initial, busy, onSave, onCancel }: { initial?: HomeOffice | null; busy?: boolean; onSave: (body: HomeOfficeBody) => void; onCancel: () => void }) {
  const id = React.useId();
  const [office, setOffice] = React.useState(initial ? String(initial.officeSqft) : '');
  const [months, setMonths] = React.useState(initial?.months || 12);
  const [regular, setRegular] = React.useState(!!initial?.homeSqft);
  const [home, setHome] = React.useState(initial?.homeSqft ? String(initial.homeSqft) : '');
  const [costs, setCosts] = React.useState<Record<string, string>>(() => Object.fromEntries(COST_LABELS.map(([k]) => [k, dollars(initial?.costs?.[k] || 0)])));
  const officeRef = React.useRef<HTMLInputElement | null>(null);
  React.useEffect(() => { officeRef.current?.focus(); }, []);

  const body: HomeOfficeBody = { officeSqft: office, months, homeSqft: regular ? home : '', costs: regular ? costs : {} };
  const checked = cleanHomeOffice(body); const figs = checked.ok ? homeOfficeFigures(checked.h) : null;
  const typedOffice = office.trim() !== '';
  const over = checked.ok && checked.h.officeSqft > MAX_SQFT;

  return (
    <div className="flex flex-col gap-3 rounded-2xl p-3" style={{ background: SOFT, color: INK }}>
      <p className="text-[13px]" style={{ color: MUTED }}>It counts when the space is used regularly and only for the business, like a room where you do the books, plan and order. A guest room that’s also an office doesn’t. Your accountant confirms it.</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1"><span className="text-[13px] font-semibold" style={{ color: MUTED }}>The office’s size, in square feet</span>
          <input ref={officeRef} value={office} onChange={(e) => setOffice(e.target.value.replace(/[^\d,]/g, ''))} inputMode="numeric" maxLength={6} placeholder="120" aria-describedby={`${id}-size`} className={field} style={{ borderColor: LINE }} />
          <span id={`${id}-size`} className="text-[12px]" style={{ color: MUTED }}>Its length times its width: 10 by 12 feet is 120.</span></label>
        <label className="flex flex-col gap-1"><span className="text-[13px] font-semibold" style={{ color: MUTED }}>Months you used it</span>
          <select value={months} onChange={(e) => setMonths(Number(e.target.value))} aria-describedby={`${id}-months`} className={field} style={{ borderColor: LINE }}>
            {Array.from({ length: 12 }, (_, i) => 12 - i).map((m) => <option key={m} value={m}>{m === 12 ? 'All 12' : m}</option>)}
          </select>
          <span id={`${id}-months`} className="text-[12px]" style={{ color: MUTED }}>Count a month you used it 15 days or more.</span></label>
      </div>

      <div aria-live="polite" className="rounded-2xl bg-[#fff] px-4 py-3" style={{ border: `1px solid ${LINE}` }}>
        {figs ? <>
          <p className="text-[15px]"><span className="text-[20px] font-semibold tabular-nums" style={{ color: GREEN }}>{usd(figs.simpleCents)}</span> the simple way</p>
          <p className="text-[13px]" style={{ color: MUTED }}>$5 a square foot{over ? `, ${MAX_SQFT} square feet at most` : ''}{months < 12 ? `, for ${months} of 12 months` : ''}. It can’t be more than the business’s profit.</p>
          {figs.regularCents != null && <p className="mt-2 text-[15px]" style={{ borderTop: `1px solid ${LINE}`, paddingTop: 8 }}>About <span className="font-semibold tabular-nums">{usd(figs.regularCents)}</span> the regular way
            <span className="block text-[13px]" style={{ color: MUTED }}>{figs.sharePct}% of your home’s costs{months < 12 ? ` for ${months} months` : ''}. {figs.regularCents > figs.simpleCents ? 'More than the simple way: ask your accountant which to use. It takes more records.' : 'The simple way comes out ahead, with no records of the home’s costs to keep.'}</span></p>}
        </> : <p className="text-[14px]" style={{ color: typedOffice ? AMBER : MUTED }}>{typedOffice && !checked.ok ? checked.error : 'Put in the office’s size to see what it’s worth.'}</p>}
      </div>

      <button type="button" onClick={() => setRegular((r) => !r)} aria-expanded={regular} aria-controls={`${id}-regular`} className={link} style={{ color: INK }}>
        {regular ? 'Leave out the regular way' : 'Also work out the regular way'}</button>
      {regular && <div id={`${id}-regular`} className="grid gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1 sm:col-span-2"><span className="text-[13px] font-semibold" style={{ color: MUTED }}>The whole home’s size, in square feet</span>
          <input value={home} onChange={(e) => setHome(e.target.value.replace(/[^\d,]/g, ''))} inputMode="numeric" maxLength={7} placeholder="1,400" className={field} style={{ borderColor: LINE }} /></label>
        {COST_LABELS.map(([k, label]) => <label key={k} className="flex flex-col gap-1"><span className="text-[13px] font-semibold" style={{ color: MUTED }}>{label}, for the year</span>
          <input value={costs[k] || ''} onChange={(e) => setCosts((c) => ({ ...c, [k]: e.target.value.replace(/[^\d.,]/g, '') }))} inputMode="decimal" maxLength={12} placeholder="0" className={field} style={{ borderColor: LINE }} /></label>)}
        <p className="text-[12px] sm:col-span-2" style={{ color: MUTED }}>For a home you own, your accountant also counts part of its wear and tear, which isn’t in this estimate.</p>
      </div>}

      <div className="flex flex-wrap gap-2">
        <button type="button" disabled={busy || !checked.ok} onClick={() => onSave(body)} className={btn} style={{ background: INK, color: '#fff' }}>{busy ? 'Saving' : 'Save it'}</button>
        <button type="button" disabled={busy} onClick={onCancel} className={btn} style={{ background: '#fff', color: INK, border: `1px solid ${LINE}` }}>Cancel</button>
      </div>
    </div>
  );
}
