'use client';
// src/components/modules/ToolPicker.tsx
//
// "UNLOCK WHAT YOUR BUSINESS NEEDS" — the à la carte picker, shared by the
// landing page, sign-up and Your ClarityFlow. Tap a tool to turn it on or off;
// the summary shows how many are on and roughly what they give back. Booking
// is always included. Each card can open to show what's inside and what most
// platforms don't do.

import { useState } from 'react';
import { TOOLS, RECOMMENDED, hoursFor, type ToolId } from '@/lib/module-catalog';

export function ToolPicker({ value, onChange, niche, nicheLabel, compact = false }: {
  value: ToolId[]; onChange: (v: ToolId[]) => void; niche?: string | null; nicheLabel?: string | null; compact?: boolean;
}) {
  const [open, setOpen] = useState<ToolId | null>(null);
  const toggle = (id: ToolId) => {
    if (id === 'booking') return;
    onChange(value.includes(id) ? value.filter((x) => x !== id) : [...value, id]);
  };
  const rec = niche ? RECOMMENDED[niche] || RECOMMENDED.other : null;
  const hours = hoursFor(value);

  return (
    <div>
      <div className="sticky top-2 z-20 mb-4 flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-white/80 bg-white/70 px-4 py-3 shadow-[0_10px_30px_-18px_rgba(28,25,23,0.45)] backdrop-blur-xl">
        <p className="text-sm"><span className="font-semibold">{value.length} tools on</span><span className="text-stone-500"> · gives back about <span className="font-semibold text-stone-900">{hours} hrs a week</span></span></p>
        {rec && <button type="button" onClick={() => onChange(Array.from(new Set(['booking', ...rec])) as ToolId[])} className="rounded-full bg-stone-900 px-3 py-1.5 text-[12px] font-medium text-white">Recommended{nicheLabel ? ` for a ${nicheLabel.toLowerCase()}` : ''}</button>}
      </div>
      <div className={`grid gap-2.5 ${compact ? 'sm:grid-cols-2' : 'sm:grid-cols-2 lg:grid-cols-3'}`}>
        {TOOLS.map((t) => {
          const on = value.includes(t.id);
          const always = t.id === 'booking';
          const isRec = rec?.includes(t.id);
          return (
            <div key={t.id} className={`rounded-3xl border p-4 transition-all duration-300 ${on ? 'border-stone-900/80 bg-white/85 shadow-[0_14px_34px_-20px_rgba(28,25,23,0.5)]' : 'border-white/70 bg-white/45'}`}>
              <div className="flex items-start gap-3">
                <span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl text-xl transition-transform ${on ? 'scale-105 bg-stone-900/5' : 'bg-white/70 grayscale-[40%]'}`} aria-hidden>{t.emoji}</span>
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-1.5 text-[15px] font-semibold text-stone-900">{t.name}{isRec && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-800">recommended</span>}</p>
                  <p className="mt-0.5 text-[13px] leading-snug text-stone-600">{t.line}</p>
                </div>
                <button type="button" role="switch" aria-checked={on} aria-label={`${t.name} ${on ? 'on' : 'off'}`} disabled={always} onClick={() => toggle(t.id)}
                  className={`relative mt-1 h-7 w-12 shrink-0 rounded-full transition-colors ${on ? 'bg-stone-900' : 'bg-stone-300'} ${always ? 'opacity-60' : ''}`}>
                  <span className={`absolute top-1 h-5 w-5 rounded-full bg-white shadow transition-all ${on ? 'left-6' : 'left-1'}`} />
                </button>
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-1.5 text-[11px]">
                <span className="rounded-full bg-emerald-50 px-2 py-0.5 font-medium text-emerald-800">⏱ {t.gives}</span>
                {t.profit && <span className="rounded-full bg-violet-50 px-2 py-0.5 font-medium text-violet-800">$ {t.profit}</span>}
                {always && <span className="rounded-full bg-stone-100 px-2 py-0.5 font-medium text-stone-600">always included</span>}
              </div>
              <button type="button" onClick={() => setOpen(open === t.id ? null : t.id)} className="mt-2 text-[12px] text-stone-500 underline-offset-2 hover:underline">{open === t.id ? 'Less' : 'What’s inside'}</button>
              {open === t.id && (
                <div className="mt-2 space-y-1.5">
                  <ul className="space-y-1">{t.includes.map((x) => <li key={x} className="flex gap-2 text-[13px] text-stone-700"><span className="text-emerald-600">✓</span>{x}</li>)}</ul>
                  <p className="text-[12px] text-stone-500"><span className="font-medium text-stone-700">Most platforms:</span> {t.others.replace(/^Most /, '').replace(/^./, (c) => c.toUpperCase())}</p>
                </div>
              )}
            </div>
          );
        })}
      </div>
      <p className="mt-3 text-center text-[11px] text-stone-500">Time estimates are typical for a small team — yours will vary. Change your tools any time.</p>
    </div>
  );
}
