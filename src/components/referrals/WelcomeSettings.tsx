'use client';
// src/components/referrals/WelcomeSettings.tsx — Referrals → Settings → WELCOME PAGE (design canvas RF12). Pick one of
// five layouts (or let the app choose from whether you have photos), who a friend sees first, which sections show and
// in what order (drag, or the arrows), and gentle motion — with a live preview built from a real recent client's link.
// Saved with the rest of the referral settings (ReferralsBoard → /api/referrals settings).
import * as React from 'react';
import { Reorder, useDragControls } from 'framer-motion';
import { payPost } from '@/components/pay/pay-client';

const INK = 'hsl(var(--foreground))', MUTED = 'hsl(var(--muted-foreground))', LINE = 'hsl(var(--border))', SOFT = 'hsl(var(--secondary))', GREEN = '#1f7a4d';
const ALL = ['favorite', 'provider', 'visit', 'photos', 'good', 'proof'];
const NAMES: Record<string, [string, string]> = {
  favorite: ['Their friend’s favorite, with open times', ''], provider: ['Who they’ll see', 'they can choose someone else'], visit: ['Their first visit, in steps', ''],
  photos: ['Photos', 'when you’ve added 2 or more'], good: ['Good to know', 'address · cancel policy'], proof: ['What clients say', 'only real numbers and reviews'],
};
const LAYOUTS: { id: string; name: string; sub: string }[] = [
  { id: 'invitation', name: 'Invitation', sub: 'Tap to open the gift' }, { id: 'editorial', name: 'Editorial', sub: 'Big photo, chapters' },
  { id: 'postcard', name: 'Postcard', sub: 'Fast, one screen' }, { id: 'stories', name: 'Stories', sub: 'One idea per screen' }, { id: 'simple', name: 'Simple', sub: 'Big type, no photos needed' },
];
const bar = (w: number, c: string, h = 6, mt = 0) => <div style={{ width: `${w}%`, height: h, borderRadius: 3, background: c, marginTop: mt }} />;
const DARK = 'linear-gradient(180deg,#b9bcc4,#26282d)';
function Thumb({ id }: { id: string }) {
  if (id === 'invitation') return <div className="absolute inset-0" style={{ background: DARK }}><div className="absolute inset-x-2.5 bottom-3">{bar(60, '#fff')}{bar(85, '#fff', 9, 6)}<div className="mt-2.5 h-3.5 rounded-full bg-card" /></div></div>;
  if (id === 'editorial') return <div className="absolute inset-0 bg-card"><div className="h-[52%]" style={{ background: 'linear-gradient(180deg,#b9bcc4,#55585e)' }} /><div className="p-2">{bar(40, LINE)}{bar(80, '#d4d5d9', 8, 6)}{bar(70, LINE, 6, 6)}</div></div>;
  if (id === 'postcard') return <div className="absolute inset-0" style={{ background: SOFT }}><div className="absolute inset-x-3 top-4 h-[66%] -rotate-2 overflow-hidden rounded-[10px] bg-card shadow"><div className="h-[42%]" style={{ background: '#c9cacf' }} /><div className="p-1.5">{bar(50, INK, 8)}</div></div></div>;
  if (id === 'stories') return <div className="absolute inset-0" style={{ background: DARK }}><div className="absolute inset-x-2 top-2 flex gap-[3px]">{[0, 1, 2, 3, 4].map((k) => <span key={k} className="h-[2px] flex-1" style={{ background: k < 2 ? '#fff' : 'rgba(255,255,255,.4)' }} />)}</div><div className="absolute inset-x-2.5 bottom-3.5">{bar(50, '#fff', 12)}</div></div>;
  return <div className="absolute inset-0 bg-card p-3">{[[55, 12], [75, 8], [50, 8], [65, 8]].map(([w, h], k) => <div key={k} className="py-1.5" style={{ borderBottom: `1px solid ${LINE}` }}>{bar(w, '#c9cacf', h)}</div>)}</div>;
}

function Row({ k, on, toggle, move, first, last }: { k: string; on: boolean; toggle: () => void; move: (d: number) => void; first: boolean; last: boolean }) {
  const drag = useDragControls();
  return <Reorder.Item value={k} dragListener={false} dragControls={drag} className="flex items-center gap-2.5 bg-card py-2.5" style={{ borderBottom: `1px solid ${LINE}` }}>
    <button type="button" aria-label="Drag to reorder" onPointerDown={(e) => drag.start(e)} className="cursor-grab touch-none px-1 text-[15px]" style={{ color: MUTED }}>⋮⋮</button>
    <span className="min-w-0 flex-1"><span className="block text-[13.5px]" style={{ color: on ? INK : MUTED }}>{NAMES[k][0]}</span>{NAMES[k][1] && <span className="block text-[11.5px]" style={{ color: MUTED }}>{NAMES[k][1]}</span>}</span>
    <button type="button" aria-label="Move up" disabled={first} onClick={() => move(-1)} className="h-7 w-7 rounded-full text-[13px] disabled:opacity-30" style={{ background: SOFT }}>↑</button>
    <button type="button" aria-label="Move down" disabled={last} onClick={() => move(1)} className="h-7 w-7 rounded-full text-[13px] disabled:opacity-30" style={{ background: SOFT }}>↓</button>
    <button type="button" role="switch" aria-checked={on} aria-label={`Show ${NAMES[k][0]}`} onClick={toggle} className="relative h-6 w-10 shrink-0 rounded-full" style={{ background: on ? GREEN : '#d4d5d9' }}><span className="absolute top-[3px] h-[18px] w-[18px] rounded-full bg-card transition-all" style={{ left: on ? 19 : 3 }} /></button>
  </Reorder.Item>;
}

export function WelcomeSettings({ tenantId, s, setS }: { tenantId: string; s: any; setS: (fn: (x: any) => any) => void }) {
  const on: string[] = Array.isArray(s.sections) ? s.sections : ALL;
  const [order, setOrder] = React.useState<string[]>(() => [...on, ...ALL.filter((k) => !on.includes(k))]);
  const [sample, setSample] = React.useState<{ path?: string; name?: string; error?: string } | null>(null);
  const [view, setView] = React.useState<'phone' | 'computer'>('phone');
  React.useEffect(() => { void payPost('/api/referrals', { tenantId, action: 'sample' }).then((r) => setSample(r?.ok ? { path: r.path, name: r.name } : { error: r?.error || 'The preview isn’t available yet.' })); }, [tenantId]);
  const put = (next: string[], onSet = on) => { setOrder(next); setS((x: any) => ({ ...x, sections: next.filter((k) => onSet.includes(k)) })); };
  const toggle = (k: string) => { const set = on.includes(k) ? on.filter((x) => x !== k) : [...on, k]; put(order, set); };
  const move = (k: string, d: number) => { const i = order.indexOf(k); const j = i + d; if (j < 0 || j >= order.length) return; const n = [...order]; [n[i], n[j]] = [n[j], n[i]]; put(n); };
  const layout = s.layout || 'auto'; const resolved = layout === 'auto' ? ((s.photos || []).length ? 'invitation' : 'simple') : layout;
  const src = sample?.path ? `${sample.path}?layout=${resolved}&sections=${order.filter((k) => on.includes(k)).join(',')}&motion=${s.motion === false ? 0 : 1}` : '';
  const pill = (active: boolean) => ({ borderColor: active ? INK : LINE, background: active ? INK : '#fff', color: active ? '#fff' : INK });
  return <div className="grid gap-5 pt-3 lg:grid-cols-[1fr_300px]" style={{ borderTop: `1px solid ${LINE}` }}>
    <div className="min-w-0 space-y-4">
      <div><p className="text-[14px] font-semibold">Layout</p><p className="text-[12.5px]" style={{ color: MUTED }}>Every layout uses the same real details, with the gift already applied.</p></div>
      <div role="radiogroup" aria-label="Welcome page layout" className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 xl:grid-cols-5">
        {LAYOUTS.map((l) => { const act = layout === l.id; return <button key={l.id} type="button" role="radio" aria-checked={act} onClick={() => setS((x: any) => ({ ...x, layout: l.id }))} className="min-w-0 space-y-1.5 text-left">
          <span className="relative block h-32 overflow-hidden rounded-[14px]" style={{ border: act ? `2px solid ${INK}` : `1px solid ${LINE}` }}><Thumb id={l.id} /></span>
          <span className="block text-[13px]" style={{ fontWeight: act ? 700 : 600 }}>{l.name}{act ? ' ✓' : ''}</span><span className="block text-[11.5px] leading-tight" style={{ color: MUTED }}>{l.sub}</span></button>; })}
      </div>
      <button type="button" role="radio" aria-checked={layout === 'auto'} onClick={() => setS((x: any) => ({ ...x, layout: 'auto' }))} className="flex w-full items-start gap-2.5 rounded-[14px] border p-3 text-left" style={{ borderColor: layout === 'auto' ? INK : LINE, borderWidth: 1.5 }}>
        <span className="mt-0.5 h-4 w-4 shrink-0 rounded-full border-[1.5px]" style={{ borderColor: layout === 'auto' ? INK : LINE, background: layout === 'auto' ? INK : '#fff', boxShadow: layout === 'auto' ? 'inset 0 0 0 3px #fff' : undefined }} />
        <span><span className="block text-[14px] font-semibold">Choose for me</span><span className="block text-[12.5px]" style={{ color: MUTED }}>Invitation when you’ve added photos, Simple when you haven’t{layout === 'auto' ? ` · now showing ${resolved === 'invitation' ? 'Invitation' : 'Simple'}` : ''}</span></span></button>
      <div className="grid gap-5 md:grid-cols-[1fr_240px]">
        <div className="min-w-0"><p className="text-[14px] font-semibold">Sections</p><p className="text-[12.5px]" style={{ color: MUTED }}>Drag or use the arrows to change the order. A section with nothing real to show stays hidden.</p>
          <Reorder.Group axis="y" values={order} onReorder={(n) => put(n)} className="mt-1">
            {order.map((k, i) => <Row key={k} k={k} on={on.includes(k)} toggle={() => toggle(k)} move={(d) => move(k, d)} first={i === 0} last={i === order.length - 1} />)}</Reorder.Group></div>
        <div className="space-y-4">
          <div><p className="text-[14px] font-semibold">Who a friend sees first</p>
            <div className="mt-1.5 space-y-1.5">{[['theirs', 'Their friend’s provider', 'The person who looks after them'], ['first', 'Whoever is free first', 'The soonest open time']].map(([v, t, sub]) =>
              <button key={v} type="button" role="radio" aria-checked={(s.who || 'theirs') === v} onClick={() => setS((x: any) => ({ ...x, who: v }))} className="w-full rounded-[12px] border px-3 py-2 text-left" style={{ borderColor: (s.who || 'theirs') === v ? INK : LINE, borderWidth: 1.5 }}>
                <span className="block text-[13.5px] font-semibold">{t}</span><span className="block text-[11.5px]" style={{ color: MUTED }}>{sub}</span></button>)}</div>
            <p className="mt-1.5 text-[11.5px] leading-snug" style={{ color: MUTED }}>Either way, they can tap Change to pick anyone else who does that service.</p></div>
          <div className="flex items-center justify-between gap-3"><span className="text-[13.5px]">Gentle animation</span>
            <button type="button" role="switch" aria-checked={s.motion !== false} aria-label="Gentle animation" onClick={() => setS((x: any) => ({ ...x, motion: x.motion === false }))} className="relative h-6 w-10 shrink-0 rounded-full" style={{ background: s.motion !== false ? GREEN : '#d4d5d9' }}><span className="absolute top-[3px] h-[18px] w-[18px] rounded-full bg-card transition-all" style={{ left: s.motion !== false ? 19 : 3 }} /></button></div>
          <p className="text-[11.5px] leading-snug" style={{ color: MUTED }}>Always still for people who turn on Reduce Motion on their phone.</p>
        </div>
      </div>
    </div>
    <div className="space-y-2">
      <div className="flex items-center justify-between"><p className="text-[13px] font-semibold">Live preview</p>
        <div className="flex gap-1">{(['phone', 'computer'] as const).map((v) => <button key={v} type="button" onClick={() => setView(v)} className="rounded-full border px-2.5 py-1 text-[11.5px] font-semibold capitalize" style={pill(view === v)}>{v}</button>)}</div></div>
      {src ? <div className="overflow-hidden rounded-[26px] border" style={{ borderColor: LINE, height: 600, width: view === 'phone' ? 300 : '100%' }}>
        {view === 'phone' ? <iframe key={src} title="Welcome page preview" src={src} style={{ width: 375, height: 750, border: 0, transform: 'scale(.8)', transformOrigin: '0 0' }} />
          : <iframe key={src + 'c'} title="Welcome page preview on a computer" src={src} style={{ width: 1200, height: 2400, border: 0, transform: 'scale(.25)', transformOrigin: '0 0' }} />}</div>
        : <div className="flex h-[300px] items-center justify-center rounded-[26px] border p-6 text-center text-[12.5px]" style={{ borderColor: LINE, color: MUTED }}>{sample?.error || 'Loading the preview…'}</div>}
      {src && <p className="text-[11.5px]" style={{ color: MUTED }}>Shows {sample?.name}’s link, before you save · <a href={src} target="_blank" rel="noreferrer" className="underline underline-offset-2">Open full preview</a></p>}
    </div>
  </div>;
}
