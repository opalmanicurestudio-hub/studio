'use client';
// Advanced limits on one gift card (lib/gift-limits): which services and providers it pays for, where it can be used,
// a minimum bill and whether it combines with other discounts. Shown only when the business turned the option on.
import * as React from 'react';
import { CHANNEL_LABEL, cleanLimits, limitsText, type GiftChannel, type GiftLimits } from '@/lib/gift-limits';

const MUTED = 'hsl(var(--muted-foreground))', LINE = 'hsl(var(--border))', SOFT = 'hsl(var(--secondary))', INK = 'hsl(var(--foreground))', BG = 'hsl(var(--background))';
const chip = (on: boolean) => (on ? { background: INK, color: BG } : { background: SOFT, color: INK });

export function GiftLimitsEditor({ limits, services, staff, busy, onSave }: { limits: GiftLimits | null; services: any[]; staff: any[]; busy?: boolean; onSave: (l: GiftLimits | null) => void }) {
  const [edit, setEdit] = React.useState(false);
  const [l, setL] = React.useState<GiftLimits>(limits || {});
  React.useEffect(() => { setL(limits || {}); }, [limits]);
  const svc = (services || []).filter((s: any) => s && !s.archived && s.isActive !== false && s.type !== 'addon').slice(0, 80);
  const people = (staff || []).filter((p: any) => p && p.isActive !== false && !p.isRenter).slice(0, 40);
  const names = { services: Object.fromEntries(svc.map((s: any) => [s.id, s.name])), staff: Object.fromEntries(people.map((p: any) => [p.id, p.name])) };
  const toggle = (k: 'serviceIds' | 'staffIds' | 'channels', id: string) => setL((x: any) => { const cur: string[] = x[k] || []; const next = cur.includes(id) ? cur.filter((y) => y !== id) : [...cur, id]; return { ...x, [k]: next.length ? next : undefined }; });
  const lines = limitsText(cleanLimits(limits), names);
  if (!edit) return (
    <div className="rounded-2xl p-4" style={{ border: `1px solid ${LINE}` }}>
      <div className="flex items-center justify-between gap-2"><p className="text-[14px] font-semibold">Limits</p>
        <button type="button" onClick={() => setEdit(true)} className="h-9 rounded-full px-3.5 text-[13px] font-semibold" style={{ background: SOFT }}>{lines.length ? 'Change' : 'Add limits'}</button></div>
      {lines.length ? <ul className="mt-2 space-y-1 text-[13.5px]">{lines.map((t) => <li key={t}>{t}</li>)}</ul> : <p className="mt-1 text-[13px]" style={{ color: MUTED }}>None. It works for anything your rules allow.</p>}
    </div>);
  return (
    <div className="space-y-3 rounded-2xl p-4" style={{ border: `1px solid ${LINE}` }}>
      <p className="text-[14px] font-semibold">Limits on this card</p>
      <div><p className="mb-1.5 text-[12.5px] font-semibold" style={{ color: MUTED }}>Only for these services (none chosen = any)</p>
        <div className="flex max-h-40 flex-wrap gap-1.5 overflow-y-auto">{svc.map((s: any) => <button key={s.id} type="button" aria-pressed={!!l.serviceIds?.includes(s.id)} onClick={() => toggle('serviceIds', s.id)} className="h-8 rounded-full px-3 text-[12.5px] font-semibold" style={chip(!!l.serviceIds?.includes(s.id))}>{s.name}</button>)}</div></div>
      <div><p className="mb-1.5 text-[12.5px] font-semibold" style={{ color: MUTED }}>Only with these providers (none chosen = anyone)</p>
        <div className="flex flex-wrap gap-1.5">{people.map((p: any) => <button key={p.id} type="button" aria-pressed={!!l.staffIds?.includes(p.id)} onClick={() => toggle('staffIds', p.id)} className="h-8 rounded-full px-3 text-[12.5px] font-semibold" style={chip(!!l.staffIds?.includes(p.id))}>{p.name}</button>)}</div></div>
      <div><p className="mb-1.5 text-[12.5px] font-semibold" style={{ color: MUTED }}>Where it can be used (none chosen = everywhere)</p>
        <div className="flex flex-wrap gap-1.5">{(Object.keys(CHANNEL_LABEL) as GiftChannel[]).map((c) => <button key={c} type="button" aria-pressed={!!l.channels?.includes(c)} onClick={() => toggle('channels', c)} className="h-8 rounded-full px-3 text-[12.5px] font-semibold" style={chip(!!l.channels?.includes(c))}>{CHANNEL_LABEL[c]}</button>)}</div></div>
      <label className="flex items-center justify-between gap-3 text-[13.5px]"><span>Smallest bill it can be used on</span>
        <span className="flex items-center gap-1">$<input type="number" min={0} step={1} inputMode="decimal" value={l.minSpendCents ? l.minSpendCents / 100 : ''} placeholder="0" onChange={(e) => setL((x) => ({ ...x, minSpendCents: Math.round(Number(e.target.value) * 100) || undefined }))} className="h-9 w-24 rounded-xl border bg-background px-2 text-right" style={{ borderColor: LINE }} aria-label="Smallest bill in dollars" /></span></label>
      <label className="flex items-center gap-2 text-[13.5px]"><input type="checkbox" checked={!!l.notWithDiscounts} onChange={(e) => setL((x) => ({ ...x, notWithDiscounts: e.target.checked || undefined }))} /> Not with other discounts or offers</label>
      <div className="flex flex-wrap gap-2">
        <button type="button" disabled={busy} onClick={() => { onSave(cleanLimits(l)); setEdit(false); }} className="h-10 rounded-full px-4 text-[13.5px] font-semibold disabled:opacity-50" style={{ background: INK, color: BG }}>Save limits</button>
        {limits && <button type="button" disabled={busy} onClick={() => { onSave(null); setEdit(false); }} className="h-10 rounded-full px-4 text-[13.5px] font-semibold" style={{ background: SOFT }}>Remove all limits</button>}
        <button type="button" onClick={() => { setL(limits || {}); setEdit(false); }} className="h-10 rounded-full px-4 text-[13.5px] font-semibold" style={{ color: MUTED }}>Cancel</button>
      </div>
    </div>);
}
