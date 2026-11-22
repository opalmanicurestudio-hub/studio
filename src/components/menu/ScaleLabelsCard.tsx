'use client';
// src/components/menu/ScaleLabelsCard.tsx — SCALE LABELS, ON THE MENU PAGE'S SETTINGS (lib/scale-label; api/menu
// 'laneSettings' scaleLabels; design board "Scale labels"). How the business's scale prints the stickers it puts on bags
// weighed ahead: what the sticker holds (the weight, or the price), how many digits its barcode has, and the unit the
// scale weighs in. Each item's own number on the scale is set on the item (Sold by weight). Nothing here changes a price.
import { useState } from 'react';
import { WEIGHT_UNITS, type WeightUnit } from '@/lib/menu-weight';
import { scaleWords, type ScaleHolds, type ScaleSet } from '@/lib/scale-label';

const INK = '#16171a', MUTED = '#6d7075', LINE = '#ececee', GREEN = '#1f7a4d', AMBER = '#b45309';
const RING = 'outline-none focus-visible:ring-2 focus-visible:ring-[#16171a] focus-visible:ring-offset-2';
const btn = `min-h-[44px] rounded-xl px-4 text-[14.5px] font-semibold disabled:opacity-50 ${RING}`;
const HOLDS: { id: ScaleHolds; label: string; hint: string }[] = [
  { id: 'weight', label: 'The weight', hint: 'Priced from your menu, so a changed price is always today’s.' },
  { id: 'price4', label: 'The price, up to $99.99', hint: 'Most US scales: a check digit, then four for the price.' },
  { id: 'price5', label: 'The price, up to $999.99', hint: 'Five digits for the price.' },
];

export function ScaleLabelsCard({ start, call }: { start: ScaleSet; call: (body: any) => Promise<any> }) {
  const [open, setOpen] = useState(false); const [set, setSet] = useState<ScaleSet>(start);
  const [busy, setBusy] = useState<string | null>(null); const [msg, setMsg] = useState<{ text: string; tone: 'good' | 'warn' } | null>(null);
  const save = async (k: string, patch: Partial<ScaleSet>) => {
    setBusy(k); setMsg(null);
    const d = await call({ action: 'laneSettings', scaleLabels: patch }).catch(() => ({ ok: false, error: 'No connection. Try again.' })); setBusy(null);
    if (d.ok && d.lane?.scaleLabels) { setSet(d.lane.scaleLabels); setMsg({ text: d.lane.scaleLabels.on ? 'Saved. Scan a sticker at the counter to try it.' : 'Scale labels are off.', tone: 'good' }); }
    else setMsg({ text: d.error || 'That didn’t save. Try again.', tone: 'warn' });
  };
  const seg = (on: boolean) => ({ background: on ? INK : '#fff', color: on ? '#fff' : INK, border: `1px solid ${on ? INK : LINE}` });
  return (
    <section aria-labelledby="scale-title" className="rounded-3xl border bg-[#fff]" style={{ borderColor: LINE }}>
      <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} className={`flex min-h-[56px] w-full items-center justify-between gap-3 rounded-3xl px-5 text-left ${RING}`}>
        <span><span id="scale-title" className="block text-[16px] font-semibold">Scale labels</span><span className="block text-[13.5px]" style={{ color: MUTED }}>{scaleWords(set)}</span></span>
        <span className="text-[14px] font-semibold" style={{ color: MUTED }}>{open ? 'Close' : 'Change'}</span>
      </button>
      {open && <div className="space-y-5 border-t px-5 pb-5 pt-4" style={{ borderColor: LINE }}>
        <p className="text-[14px]" style={{ color: MUTED }}>For bags weighed ahead with your scale’s sticker on: scan the sticker at the counter or the window, and it’s on the order at the weight or price printed. Give each item its number on the scale under Sold by weight. Barcodes already on items still scan as they do now.</p>
        <div className="flex flex-wrap gap-2">
          <button type="button" aria-pressed={set.on} disabled={!!busy} onClick={() => void save('on', { on: !set.on })} className={btn} style={set.on ? { border: `1px solid ${LINE}`, color: INK } : { background: INK, color: '#fff' }}>{busy === 'on' ? 'Saving…' : set.on ? 'Turn them off' : 'Turn them on'}</button>
        </div>
        <div role="radiogroup" aria-labelledby="scale-holds" className="space-y-2">
          <p id="scale-holds" className="text-[13px] font-semibold" style={{ color: MUTED }}>The sticker holds</p>
          <div className="grid gap-2 sm:grid-cols-3">{HOLDS.map((h) => <button key={h.id} type="button" role="radio" aria-checked={set.holds === h.id} disabled={!!busy} onClick={() => set.holds !== h.id && void save('holds', { holds: h.id })} className={`${btn} text-[14px]`} style={seg(set.holds === h.id)}>{h.label}</button>)}</div>
          <p className="text-[13px]" style={{ color: MUTED }}>{HOLDS.find((h) => h.id === set.holds)?.hint} Your scale’s manual says which it prints. Once it’s on, scan one sticker and check the counter says what’s printed on it.</p>
        </div>
        <div role="radiogroup" aria-labelledby="scale-digits" className="space-y-2">
          <p id="scale-digits" className="text-[13px] font-semibold" style={{ color: MUTED }}>Its barcode</p>
          <div className="grid grid-cols-2 gap-2">{([12, 13] as const).map((n) => <button key={n} type="button" role="radio" aria-checked={set.digits === n} disabled={!!busy} onClick={() => set.digits !== n && void save('digits', { digits: n })} className={btn} style={seg(set.digits === n)}>{n === 12 ? '12 digits (UPC)' : '13 digits (EAN)'}</button>)}</div>
        </div>
        {set.holds === 'weight' && <div role="radiogroup" aria-labelledby="scale-unit" className="space-y-2">
          <p id="scale-unit" className="text-[13px] font-semibold" style={{ color: MUTED }}>The scale weighs in</p>
          <div className="grid grid-cols-4 gap-2">{WEIGHT_UNITS.map((u: WeightUnit) => <button key={u} type="button" role="radio" aria-checked={set.unit === u} disabled={!!busy} onClick={() => set.unit !== u && void save('unit', { unit: u })} className={btn} style={seg(set.unit === u)}>{u}</button>)}</div>
          <p className="text-[13px]" style={{ color: MUTED }}>Read as {set.unit === 'g' ? 'whole grams' : set.unit === 'kg' ? 'thousandths of a kilogram (grams)' : `hundredths of ${set.unit === 'lb' ? 'a pound' : 'an ounce'}`}, then worked out in each item’s own unit.</p>
        </div>}
        {msg && <p role={msg.tone === 'warn' ? 'alert' : 'status'} className="text-[14px]" style={{ color: msg.tone === 'warn' ? AMBER : GREEN }}>{msg.text}</p>}
      </div>}
    </section>
  );
}
