'use client';
// PROGRAM BUILDER (phase 6): a few questions → a suggested program with what each reward costs. It only fills in the
// form below; nothing is saved until the owner reviews it and presses Save. The numbers start from the business's own
// average visit and how often regulars come (last 12 months).
import * as React from 'react';
import { payPost } from '@/components/pay/pay-client';
import { suggestProgram, type BuilderAnswers } from '@/lib/loyalty';

const MUTED = 'hsl(var(--muted-foreground))', LINE = 'hsl(var(--border))', SOFT = 'hsl(var(--secondary))', INK = 'hsl(var(--foreground))', BG = 'hsl(var(--background))';
const pill = (on: boolean) => (on ? { background: INK, color: BG } : { background: SOFT, color: INK });
const GOALS: [BuilderAnswers['encourage'][number], string][] = [['return', 'Coming back more often'], ['rebook', 'Booking the next visit before leaving'], ['retail', 'Buying products'], ['quiet', 'Filling quiet times']];

export function ProgramBuilder({ tenantId, services, onUse }: { tenantId: string; services: any[]; onUse: (settings: any) => void }) {
  const [open, setOpen] = React.useState(false); const [a, setA] = React.useState<BuilderAnswers>({ encourage: ['return', 'rebook'], givebackPct: 5, avgTicket: 60, visitsPerYear: 6, addOn: null, quietDay: 2 });
  const [known, setKnown] = React.useState<any>(null);
  React.useEffect(() => { if (!open || known) return; payPost('/api/loyalty', { tenantId, action: 'basics' }).then((r) => { if (r?.ok) { setKnown(r); setA((x) => ({ ...x, avgTicket: r.avgTicket || x.avgTicket, visitsPerYear: r.visitsPerYear || x.visitsPerYear })); } }); }, [open, known, tenantId]);
  const addOns = (services || []).filter((v: any) => v && v.isActive !== false && !v.archived && (v.type === 'addon' || Number(v.price) <= 25) && Number(v.price) > 0).slice(0, 30);
  const s = suggestProgram(a);
  if (!open) return <button type="button" onClick={() => setOpen(true)} className="h-11 rounded-full border px-5 text-[14px] font-semibold" style={{ borderColor: LINE }}>Suggest a program for me</button>;
  return (
    <section className="space-y-4 rounded-[22px] border bg-card p-5" style={{ borderColor: LINE }}>
      <div><p className="text-[18px] font-semibold">Build a program</p><p className="text-[13.5px]" style={{ color: MUTED }}>Answer a few questions and review the suggestion. It fills in the form below; nothing is saved until you press Save.</p></div>
      <div><p className="mb-1.5 text-[13px]" style={{ color: MUTED }}>What would you like to encourage?</p><div className="flex flex-wrap gap-1.5">{GOALS.map(([k, l]) => <button key={k} type="button" aria-pressed={a.encourage.includes(k)} onClick={() => setA({ ...a, encourage: a.encourage.includes(k) ? a.encourage.filter((x) => x !== k) : [...a.encourage, k] })} className="h-9 rounded-full px-3.5 text-[13px] font-semibold" style={pill(a.encourage.includes(k))}>{l}</button>)}</div></div>
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="space-y-1.5 text-[13px]" style={{ color: MUTED }}>How much to give back<select value={a.givebackPct} onChange={(e) => setA({ ...a, givebackPct: Number(e.target.value) })} className="h-11 w-full rounded-[12px] border bg-background px-3 text-[15px]" style={{ borderColor: LINE, color: INK }}>{[3, 5, 7, 10].map((p) => <option key={p} value={p}>About {p}% of what they spend</option>)}</select></label>
        <label className="space-y-1.5 text-[13px]" style={{ color: MUTED }}>Average visit{known?.avgTicket ? ' (from your records)' : ''}<input type="number" min={10} value={a.avgTicket} onChange={(e) => setA({ ...a, avgTicket: Number(e.target.value) })} className="h-11 w-full rounded-[12px] border bg-background px-3 text-[15px]" style={{ borderColor: LINE, color: INK }} /></label>
        <label className="space-y-1.5 text-[13px]" style={{ color: MUTED }}>Visits a year, regulars{known?.visitsPerYear ? ' (from your records)' : ''}<input type="number" min={1} step={0.5} value={a.visitsPerYear} onChange={(e) => setA({ ...a, visitsPerYear: Number(e.target.value) })} className="h-11 w-full rounded-[12px] border bg-background px-3 text-[15px]" style={{ borderColor: LINE, color: INK }} /></label>
      </div>
      {addOns.length > 0 && <label className="block space-y-1.5 text-[13px]" style={{ color: MUTED }}>A small free extra as a reward (optional)<select value={a.addOn?.id || ''} onChange={(e) => { const v = addOns.find((x: any) => x.id === e.target.value); setA({ ...a, addOn: v ? { id: v.id, name: String(v.name), price: Number(v.price) } : null }); }} className="h-11 w-full rounded-[12px] border bg-background px-3 text-[15px]" style={{ borderColor: LINE, color: INK }}><option value="">None</option>{addOns.map((v: any) => <option key={v.id} value={v.id}>{v.name} (${Number(v.price)})</option>)}</select></label>}
      <div className="space-y-1.5 rounded-[16px] p-4 text-[14px] leading-[1.55]" style={{ background: SOFT }}>{s.notes.map((n) => <p key={n}>{n}</p>)}</div>
      <div className="flex flex-wrap gap-2"><button type="button" onClick={() => { onUse(s.settings); setOpen(false); }} className="h-11 rounded-full px-5 text-[14px] font-semibold" style={{ background: INK, color: BG }}>Fill in the form with this</button><button type="button" onClick={() => setOpen(false)} className="h-11 px-3 text-[14px]" style={{ color: MUTED }}>Cancel</button></div>
    </section>);
}
