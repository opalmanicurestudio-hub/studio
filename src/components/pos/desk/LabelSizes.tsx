'use client';
// src/components/pos/desk/LabelSizes.tsx — CHOOSE THE LABEL SIZE for each shape (stickers, tie-on tags, wrap bands):
// a preset that matches common label stock, or your own width × height in millimetres. Saved for the business, so every
// screen prints the same size. "Print a test" prints one sample to check against the real stock before printing a batch.
import * as React from 'react';
import { doc, updateDoc } from 'firebase/firestore';
import { useFirebase } from '@/firebase';
import { SIZE_PRESETS, SIZE_LIMITS, sizeOf, brandOf, printCodeLabels, type LabelFormat } from '@/lib/print-labels';

export function LabelSizes({ tenantId, tenant, format, manager }: { tenantId: string; tenant: any; format: LabelFormat; manager: boolean }) {
  const { firestore } = useFirebase(); const [open, setOpen] = React.useState(false);
  const cur = sizeOf(brandOf(tenant), format); const [w, setW] = React.useState(String(cur.w)); const [h, setH] = React.useState(String(cur.h)); const [msg, setMsg] = React.useState<string | null>(null);
  React.useEffect(() => { setW(String(cur.w)); setH(String(cur.h)); }, [format, cur.w, cur.h]);
  const lim = SIZE_LIMITS[format]; const preset = SIZE_PRESETS[format].find((p) => p.w === cur.w && p.h === cur.h);
  const save = async (nw: number, nh: number) => { if (!firestore || !tenantId) return; try { await updateDoc(doc(firestore, 'tenants', tenantId), { [`ops.labelSizes.${format}`]: { w: nw, h: nh } }); setMsg(`Saved: ${nw} × ${nh} mm`); } catch { setMsg('That didn’t save — try again.'); } };
  const test = async () => { const ok = await printCodeLabels([{ title: 'Sample label', sub: 'Size check', code: 'K7AB2', steps: ['Scan when you take it', 'Scan when it comes back'] }], 'Label size test', { ...brandOf(tenant), sizes: { ...(tenant?.ops?.labelSizes || {}), [format]: { w: Number(w) || cur.w, h: Number(h) || cur.h } } }, format); if (!ok) setMsg('Allow pop-ups to print.'); };
  return (
    <span className="inline-flex flex-col gap-1">
      <button type="button" onClick={() => setOpen((x) => !x)} aria-expanded={open} className="h-9 rounded-full border px-3 text-[13px]">Size · {cur.w}×{cur.h} mm</button>
      {open && (
        <span className="mt-1 flex w-[min(92vw,360px)] flex-col gap-2 rounded-2xl border bg-card p-3 text-[13px] shadow-lg">
          <select value={preset ? `${preset.w}x${preset.h}` : 'custom'} disabled={!manager} onChange={(e) => { const p = SIZE_PRESETS[format].find((x) => `${x.w}x${x.h}` === e.target.value); if (p) { setW(String(p.w)); setH(String(p.h)); void save(p.w, p.h); } }} aria-label="Label size" className="h-10 rounded-xl border bg-background px-2">
            {SIZE_PRESETS[format].map((p) => <option key={p.label} value={`${p.w}x${p.h}`}>{p.label}</option>)}<option value="custom">Your own size…</option>
          </select>
          <span className="flex flex-wrap items-end gap-2">
            <label className="flex flex-col">{format === 'band' ? 'Length (mm)' : format === 'hang' ? 'Open width (mm)' : 'Width (mm)'}<input type="number" min={lim.w[0]} max={lim.w[1]} value={w} disabled={!manager} onChange={(e) => setW(e.target.value)} className="h-10 w-24 rounded-xl border bg-background px-2" /></label>
            <label className="flex flex-col">{format === 'band' ? 'Depth (mm)' : 'Height (mm)'}<input type="number" min={lim.h[0]} max={lim.h[1]} value={h} disabled={!manager} onChange={(e) => setH(e.target.value)} className="h-10 w-24 rounded-xl border bg-background px-2" /></label>
            {manager && <button type="button" onClick={() => save(Math.min(lim.w[1], Math.max(lim.w[0], Math.round(Number(w)) || cur.w)), Math.min(lim.h[1], Math.max(lim.h[0], Math.round(Number(h)) || cur.h)))} className="h-10 rounded-xl bg-foreground px-3 font-semibold text-background">Save</button>}
          </span>
          <span className="text-[12px] text-muted-foreground">{format === 'band' ? `Bands longer than 190 mm print in landscape (up to ${lim.w[1]} mm). Under 160 mm long, the steps are left off; under 24 mm deep, just the codes.` : format === 'hang' ? 'The tag is printed open — front and back side by side — then folded in half.' : 'Small labels keep the square code and the letters; the barcode is left off under 28 mm high.'}{!manager && ' A manager sets the size.'}</span>
          <button type="button" onClick={test} className="h-10 rounded-xl border font-semibold">Print a test</button>
          {msg && <span role="status" className="text-[12px] font-semibold">{msg}</span>}
        </span>)}
    </span>);
}
