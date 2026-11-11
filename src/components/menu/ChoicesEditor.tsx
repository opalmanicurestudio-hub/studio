'use client';
// src/components/menu/ChoicesEditor.tsx — THE BUSINESS SETS AN ITEM'S CHOICES: groups like Size, Milk or Extras, each
// "pick one" or "pick any", and options with what they add to (or take off) the price. A few common groups start
// filled in. What's saved is cleaned on the server (lib/menu-choices), so nothing here can put a price on the menu that
// the server wouldn't charge.
import { useId } from 'react';
import type { ChoiceGroup } from '@/lib/menu-choices';

const INK = '#16171a', MUTED = '#6d7075', LINE = '#ececee', SOFT = '#f5f5f7';
const RING = 'outline-none focus-visible:ring-2 focus-visible:ring-[#16171a] focus-visible:ring-offset-2';
const input = 'min-h-[44px] rounded-xl border bg-[#fff] px-3 text-[15.5px] outline-none focus:border-[#16171a]';
let n = 0;
const nid = () => `n${Date.now().toString(36)}${(n++).toString(36)}`;

export type EditGroup = Omit<ChoiceGroup, 'options'> & { options: { id: string; name: string; price: number | string; soldOut: boolean }[] };

const STARTERS: { label: string; make: () => EditGroup }[] = [
  { label: 'Size', make: () => ({ id: nid(), name: 'Size', pick: 'one', required: true, max: 1, options: [{ id: nid(), name: 'Small', price: 0, soldOut: false }, { id: nid(), name: 'Large', price: 0.5, soldOut: false }] }) },
  { label: 'Milk', make: () => ({ id: nid(), name: 'Milk', pick: 'one', required: true, max: 1, options: [{ id: nid(), name: 'Whole', price: 0, soldOut: false }, { id: nid(), name: 'Oat', price: 0.75, soldOut: false }] }) },
  { label: 'Extras', make: () => ({ id: nid(), name: 'Extras', pick: 'any', required: false, max: 4, options: [{ id: nid(), name: 'Extra shot', price: 1, soldOut: false }] }) },
  { label: 'Leave out', make: () => ({ id: nid(), name: 'Leave out', pick: 'any', required: false, max: 4, options: [{ id: nid(), name: 'No onions', price: 0, soldOut: false }] }) },
];

export function ChoicesEditor({ groups, onChange }: { groups: EditGroup[]; onChange: (g: EditGroup[]) => void }) {
  const uid = useId();
  const setG = (i: number, patch: Partial<EditGroup>) => onChange(groups.map((g, k) => (k === i ? { ...g, ...patch } : g)));
  const setO = (i: number, j: number, patch: any) => setG(i, { options: groups[i].options.map((o, k) => (k === j ? { ...o, ...patch } : o)) });
  const move = (i: number, d: -1 | 1) => { const k = i + d; if (k < 0 || k >= groups.length) return; const next = groups.slice(); [next[i], next[k]] = [next[k], next[i]]; onChange(next); };
  return (
    <div className="space-y-3" style={{ color: INK }}>
      {groups.length === 0 && <p className="rounded-2xl px-4 py-3 text-[14.5px]" style={{ background: SOFT, color: MUTED }}>No choices yet. Add sizes, milks, extras or things to leave out, each with its own price.</p>}
      {groups.map((g, i) => (
        <fieldset key={g.id} className="space-y-3 rounded-2xl border p-4" style={{ borderColor: LINE }}>
          <legend className="sr-only">{g.name || 'Choice'}</legend>
          <div className="flex flex-wrap items-end gap-2">
            <label className="min-w-[160px] flex-1"><span className="text-[13.5px] font-medium">Choice</span>
              <input value={g.name} onChange={(e) => setG(i, { name: e.target.value.slice(0, 40) })} placeholder="Size, Milk, Extras" className={`${input} mt-1 w-full`} style={{ borderColor: LINE }} /></label>
            <div role="radiogroup" aria-label={`How many of ${g.name || 'this choice'}`} className="flex rounded-xl border p-0.5" style={{ borderColor: LINE }}>
              {(['one', 'any'] as const).map((p) => (
                <button key={p} type="button" role="radio" aria-checked={g.pick === p} onClick={() => setG(i, { pick: p, required: p === 'one', max: p === 'one' ? 1 : Math.max(1, g.options.length) })}
                  className={`min-h-[44px] rounded-lg px-3 text-[14px] font-semibold ${RING}`} style={g.pick === p ? { background: INK, color: '#fff' } : { color: INK }}>{p === 'one' ? 'Pick one' : 'Pick any'}</button>
              ))}
            </div>
            <div className="flex gap-1">
              <button type="button" onClick={() => move(i, -1)} disabled={i === 0} aria-label={`Move ${g.name || 'choice'} up`} className={`h-11 w-11 rounded-xl border text-[16px] disabled:opacity-30 ${RING}`} style={{ borderColor: LINE }}>↑</button>
              <button type="button" onClick={() => move(i, 1)} disabled={i === groups.length - 1} aria-label={`Move ${g.name || 'choice'} down`} className={`h-11 w-11 rounded-xl border text-[16px] disabled:opacity-30 ${RING}`} style={{ borderColor: LINE }}>↓</button>
              <button type="button" onClick={() => onChange(groups.filter((_, k) => k !== i))} aria-label={`Remove ${g.name || 'choice'}`} className={`h-11 rounded-xl border px-3 text-[14px] font-medium ${RING}`} style={{ borderColor: LINE, color: '#b42318' }}>Remove</button>
            </div>
          </div>
          <label className="flex min-h-[44px] items-center gap-3 text-[14.5px]">
            {g.pick === 'one'
              ? <><input type="checkbox" checked={g.required} onChange={(e) => setG(i, { required: e.target.checked })} className="h-5 w-5 accent-[#16171a]" />They must pick one</>
              : <><span>Up to</span><input type="number" min={1} max={Math.max(1, g.options.length)} value={g.max} onChange={(e) => setG(i, { max: Math.max(1, Math.floor(Number(e.target.value) || 1)) })} className={`${input} w-20`} style={{ borderColor: LINE }} aria-label="Most they can pick" /><span style={{ color: MUTED }}>of these</span></>}
          </label>
          <ul className="space-y-2">
            {g.options.map((o, j) => (
              <li key={o.id} className="flex items-center gap-2">
                <input value={o.name} onChange={(e) => setO(i, j, { name: e.target.value.slice(0, 40) })} placeholder="Oat, Large, Extra shot" aria-label={`Option ${j + 1} of ${g.name || 'this choice'}`} className={`${input} min-w-0 flex-1`} style={{ borderColor: LINE }} />
                <span className="relative w-28 shrink-0">
                  <span aria-hidden className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[15px]" style={{ color: MUTED }}>$</span>
                  <input id={`${uid}-${g.id}-${o.id}`} inputMode="decimal" value={String(o.price)} onChange={(e) => setO(i, j, { price: e.target.value.replace(/[^0-9.\-]/g, '').slice(0, 8) })}
                    aria-label={`What ${o.name || 'this option'} adds to the price (a minus takes off)`} className={`${input} w-full pl-6`} style={{ borderColor: LINE }} />
                </span>
                <button type="button" onClick={() => setG(i, { options: g.options.filter((_, k) => k !== j) })} aria-label={`Remove ${o.name || 'this option'}`} className={`h-11 w-11 shrink-0 rounded-xl border text-[18px] ${RING}`} style={{ borderColor: LINE, color: MUTED }}>×</button>
              </li>
            ))}
          </ul>
          <p className="text-[13px]" style={{ color: MUTED }}>The price is what it adds. 0 costs nothing; a minus takes off (a small size).</p>
          <button type="button" onClick={() => setG(i, { options: [...g.options, { id: nid(), name: '', price: 0, soldOut: false }] })} className={`min-h-[44px] rounded-xl border px-4 text-[14.5px] font-semibold ${RING}`} style={{ borderColor: LINE }}>Add an option</button>
        </fieldset>
      ))}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[14px]" style={{ color: MUTED }}>Add a choice:</span>
        {STARTERS.map((s) => <button key={s.label} type="button" onClick={() => onChange([...groups, s.make()])} className={`min-h-[44px] rounded-xl border px-4 text-[14.5px] font-semibold ${RING}`} style={{ borderColor: LINE }}>{s.label}</button>)}
        <button type="button" onClick={() => onChange([...groups, { id: nid(), name: '', pick: 'one', required: true, max: 1, options: [{ id: nid(), name: '', price: 0, soldOut: false }] }])} className={`min-h-[44px] rounded-xl border px-4 text-[14.5px] font-semibold ${RING}`} style={{ borderColor: LINE }}>Something else</button>
      </div>
    </div>
  );
}
