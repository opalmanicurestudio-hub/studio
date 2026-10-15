'use client';
// Marketing → Loyalty: WHAT MAKES IT FEEL SPECIAL (design canvas "Loyalty engine", board 5). Surprises (never advertised,
// budgeted, cost tracked), keeping their rhythm, a head start for new members, point boosts for chosen dates, and
// referral points in the same balance. Edits the same settings object as the rest of the page (saved with Save).
import * as React from 'react';

const MUTED = 'hsl(var(--muted-foreground))', LINE = 'hsl(var(--border))', SOFT = 'hsl(var(--secondary))', INK = 'hsl(var(--foreground))', BG = 'hsl(var(--background))';
const rid = () => Math.random().toString(36).slice(2, 9);
const card = 'rounded-[22px] border bg-card p-5';
const box = 'h-9 rounded-[10px] border bg-background px-2 text-[13.5px]';
const WHEN: [string, string][] = [['anniversary', 'Their anniversary with us'], ['made_right', 'After we put something right'], ['team', 'The team picks who']];

export function LoyaltyExtras({ s, setS, unit, services, products }: { s: any; setS: (f: (x: any) => any) => void; unit: string; services: any[]; products: any[] }) {
  const set = (patch: any) => setS((x: any) => ({ ...x, ...patch }));
  const sur = s.surprises || { on: false, perMonth: 4, items: [] }; const rh = s.rhythm || { on: false, points: 25, graceDays: 4, defaultWeeks: 4 }; const boosts: any[] = s.boosts || [];
  const setItem = (i: number, patch: any) => set({ surprises: { ...sur, items: sur.items.map((y: any, k: number) => (k === i ? { ...y, ...patch } : y)) } });
  const setBoost = (i: number, patch: any) => set({ boosts: boosts.map((y: any, k: number) => (k === i ? { ...y, ...patch } : y)) });
  const today = new Date().toISOString().slice(0, 10);
  return (
    <div className="grid gap-5 md:grid-cols-2">
      <section className={`${card} space-y-3`} style={{ borderColor: LINE }}>
        <label className="flex items-center justify-between gap-3"><span><span className="block text-[18px] font-semibold">Surprises</span><span className="block text-[13.5px]" style={{ color: MUTED }}>Never advertised. The desk is told at checkout and the cost is tracked like any reward.</span></span>
          <input type="checkbox" checked={!!sur.on} onChange={(e) => set({ surprises: { ...sur, on: e.target.checked } })} aria-label="Surprises on" /></label>
        {sur.on && <>
          {sur.items.map((it: any, i: number) => (
            <div key={it.id || i} className="space-y-2 rounded-[16px] border p-3" style={{ borderColor: LINE }}>
              <div className="flex flex-wrap items-center gap-2">
                <select value={it.when} onChange={(e) => setItem(i, { when: e.target.value })} aria-label="When" className={box} style={{ borderColor: LINE }}>{WHEN.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
                <input value={it.name} onChange={(e) => setItem(i, { name: e.target.value })} aria-label="What they get" placeholder="Free paraffin add-on" className={`${box} min-w-0 flex-1`} style={{ borderColor: LINE }} />
                <button type="button" onClick={() => set({ surprises: { ...sur, items: sur.items.filter((_: any, k: number) => k !== i) } })} className="h-9 px-2 text-[12.5px]" style={{ color: MUTED }}>Remove</button>
              </div>
              <div className="flex flex-wrap items-center gap-2 text-[13px]">
                {[['amount_off', 'Money off'], ['free_service', 'A free service or add-on']].map(([k, l]) => <button key={k} type="button" onClick={() => setItem(i, { kind: k })} className="h-8 rounded-full px-3 text-[12.5px] font-semibold" style={it.kind === k ? { background: INK, color: BG } : { background: SOFT }}>{l}</button>)}
                {it.kind === 'amount_off' ? <label className="flex items-center gap-1">$<input type="number" min={1} value={(it.cents || 0) / 100} onChange={(e) => setItem(i, { cents: Math.round(Number(e.target.value) * 100), costCents: Math.round(Number(e.target.value) * 100) })} aria-label="Amount off" className="h-8 w-16 rounded-[8px] border bg-background px-2" style={{ borderColor: LINE }} /></label>
                  : <><select value={it.serviceId || ''} onChange={(e) => setItem(i, { serviceId: e.target.value })} aria-label="Which service" className="h-8 rounded-[8px] border bg-background px-2 text-[13px]" style={{ borderColor: LINE }}><option value="">Choose…</option>{services.map((v: any) => <option key={v.id} value={v.id}>{v.name}</option>)}</select>
                    <label className="flex items-center gap-1" style={{ color: MUTED }}>costs you about $<input type="number" min={0} value={(it.costCents || 0) / 100} onChange={(e) => setItem(i, { costCents: Math.round(Number(e.target.value) * 100) })} aria-label="What it costs you" className="h-8 w-16 rounded-[8px] border bg-background px-2" style={{ borderColor: LINE, color: INK }} /></label></>}
              </div>
            </div>))}
          <div className="flex flex-wrap items-center gap-3">
            <button type="button" onClick={() => set({ surprises: { ...sur, items: [...sur.items, { id: rid(), name: '', when: sur.items.some((x: any) => x.when === 'anniversary') ? 'team' : 'anniversary', kind: 'amount_off', cents: 1000, costCents: 1000, on: true }] } })} className="h-10 rounded-full border border-dashed px-4 text-[13px] font-semibold" style={{ borderColor: '#c9cace' }}>Add a surprise</button>
            <label className="flex items-center gap-1.5 text-[13px]" style={{ color: MUTED }}>At most<input type="number" min={0} max={100} value={sur.perMonth ?? 4} onChange={(e) => set({ surprises: { ...sur, perMonth: Number(e.target.value) } })} aria-label="Surprises a month" className="h-9 w-16 rounded-[10px] border bg-background px-2 text-[14px]" style={{ borderColor: LINE, color: INK }} />a month</label>
          </div></>}
      </section>

      <section className={`${card} space-y-4`} style={{ borderColor: LINE }}>
        <div className="space-y-2">
          <label className="flex items-center justify-between gap-3"><span><span className="block text-[18px] font-semibold">Keeping their rhythm</span><span className="block text-[13.5px]" style={{ color: MUTED }}>Bonus {unit} when they come back within their usual gap. Their gap comes from their own last visits.</span></span>
            <input type="checkbox" checked={!!rh.on} onChange={(e) => set({ rhythm: { ...rh, on: e.target.checked } })} aria-label="Rhythm bonus on" disabled={s.earn?.mode === 'punch'} /></label>
          {s.earn?.mode === 'punch' && <p className="text-[12.5px]" style={{ color: MUTED }}>Not for punch cards.</p>}
          {rh.on && <div className="flex flex-wrap items-center gap-2 text-[13.5px]">+<input type="number" min={1} value={rh.points} onChange={(e) => set({ rhythm: { ...rh, points: Number(e.target.value) } })} aria-label="Bonus" className="h-9 w-16 rounded-[10px] border bg-background px-2" style={{ borderColor: LINE }} />{unit}, with
            <input type="number" min={0} max={21} value={rh.graceDays} onChange={(e) => set({ rhythm: { ...rh, graceDays: Number(e.target.value) } })} aria-label="Days to spare" className="h-9 w-14 rounded-[10px] border bg-background px-2" style={{ borderColor: LINE }} />days to spare. New clients:
            <input type="number" min={1} max={26} value={rh.defaultWeeks} onChange={(e) => set({ rhythm: { ...rh, defaultWeeks: Number(e.target.value) } })} aria-label="Weeks for new clients" className="h-9 w-14 rounded-[10px] border bg-background px-2" style={{ borderColor: LINE }} />weeks.</div>}
        </div>
        <div className="space-y-1.5 pt-3" style={{ borderTop: `1px solid ${LINE}` }}><p className="text-[15px] font-semibold">A head start</p>
          <label className="flex flex-wrap items-center gap-2 text-[13.5px]">New members start with<input type="number" min={0} max={1000} value={s.headStart || 0} onChange={(e) => set({ headStart: Number(e.target.value) })} aria-label="Head start" className="h-9 w-20 rounded-[10px] border bg-background px-2" style={{ borderColor: LINE }} />{unit}.</label>
          {(s.headStart || 0) > 0 && (s.rewards || [])[0] && <p className="text-[12.5px]" style={{ color: MUTED }}>That’s {Math.round(((s.headStart || 0) / Math.max(1, Math.min(...(s.rewards || []).filter((r: any) => r.on !== false).map((r: any) => r.points)))) * 100)}% of the way to their first reward. People finish a card they’ve already started.</p>}</div>
        <div className="space-y-1.5 pt-3" style={{ borderTop: `1px solid ${LINE}` }}><p className="text-[15px] font-semibold">Bring a friend</p>
          <label className="flex flex-wrap items-center gap-2 text-[13.5px]">When a friend they referred comes in, give<input type="number" min={0} max={10000} value={s.referralPoints || 0} onChange={(e) => set({ referralPoints: Number(e.target.value) })} aria-label="Referral points" className="h-9 w-20 rounded-[10px] border bg-background px-2" style={{ borderColor: LINE }} />{unit}</label>
          <p className="text-[12.5px]" style={{ color: MUTED }}>{(s.referralPoints || 0) > 0 ? 'Referral rewards go into their rewards balance instead of store credit.' : 'At 0, referral rewards stay as store credit (Referrals).'}</p></div>
      </section>

      <section className={`${card} space-y-3 md:col-span-2`} style={{ borderColor: LINE }}>
        <div><p className="text-[18px] font-semibold">Point boosts</p><p className="text-[13.5px]" style={{ color: MUTED }}>Extra {unit} for chosen dates: double points on your own product line for a weekend, say. Shown on receipts, the rewards page and at checkout while it runs.</p></div>
        {boosts.map((b: any, i: number) => (
          <div key={b.id || i} className="space-y-2 rounded-[16px] border p-3" style={{ borderColor: LINE }}>
            <div className="flex flex-wrap items-center gap-2 text-[13.5px]">
              <input value={b.label} onChange={(e) => setBoost(i, { label: e.target.value })} placeholder="Double points: our products" aria-label="Name" className={`${box} min-w-[180px] flex-1`} style={{ borderColor: LINE }} />
              <select value={b.multiplier} onChange={(e) => setBoost(i, { multiplier: Number(e.target.value) })} aria-label="How much" className={box} style={{ borderColor: LINE }}>{[1.5, 2, 3].map((m) => <option key={m} value={m}>{m === 2 ? 'Double' : m === 3 ? 'Triple' : '1.5×'}</option>)}</select>
              <select value={b.scope} onChange={(e) => setBoost(i, { scope: e.target.value, ids: [] })} aria-label="On" className={box} style={{ borderColor: LINE }}><option value="products">Products</option><option value="services">Services</option><option value="all">Everything</option></select>
              <input type="date" value={b.from} min={today} onChange={(e) => setBoost(i, { from: e.target.value, to: b.to < e.target.value ? e.target.value : b.to })} aria-label="From" className={box} style={{ borderColor: LINE }} />
              <input type="date" value={b.to} min={b.from || today} onChange={(e) => setBoost(i, { to: e.target.value })} aria-label="To" className={box} style={{ borderColor: LINE }} />
              <button type="button" onClick={() => set({ boosts: boosts.filter((_: any, k: number) => k !== i) })} className="h-9 px-2 text-[12.5px]" style={{ color: MUTED }}>Remove</button>
            </div>
            {b.scope !== 'all' && <details><summary className="cursor-pointer text-[13px] font-semibold">Which {b.scope} ({(b.ids || []).length || 'all'})</summary>
              <div className="mt-2 flex max-h-36 flex-wrap gap-1.5 overflow-y-auto">{(b.scope === 'products' ? products : services).map((v: any) => { const on = (b.ids || []).includes(v.id);
                return <button key={v.id} type="button" aria-pressed={on} onClick={() => setBoost(i, { ids: on ? b.ids.filter((y: string) => y !== v.id) : [...(b.ids || []), v.id] })} className="h-8 rounded-full px-3 text-[12.5px] font-semibold" style={on ? { background: INK, color: BG } : { background: SOFT }}>{v.name}</button>; })}</div></details>}
          </div>))}
        <button type="button" onClick={() => set({ boosts: [...boosts, { id: rid(), label: 'Double points', multiplier: 2, scope: 'products', ids: [], from: today, to: today }] })} className="h-10 rounded-full border border-dashed px-4 text-[13px] font-semibold" style={{ borderColor: '#c9cace' }}>Add a boost</button>
        {s.earn?.mode === 'punch' && <p className="text-[12.5px]" style={{ color: MUTED }}>Boosts don’t apply to punch cards.</p>}
      </section>
    </div>);
}
