'use client';
// src/components/loyalty/LoyaltySetup.tsx — MARKETING → LOYALTY (design canvas "Loyalty engine", board 1). The program in
// one page: how clients earn, what counts, the rewards and what each costs, expiry, commission, who's in, and the terms
// in plain words as clients will read them. Saving a change to the rules makes a new version (lib/loyalty nextLoyalty).
import * as React from 'react';
import { payPost } from '@/components/pay/pay-client';
import { useInventory } from '@/context/InventoryContext';
import { EARN_LABEL, EXPIRY_CHOICES, termsOf, loyaltyOf, type EarnMode, type Reward } from '@/lib/loyalty';

const INK = 'hsl(var(--foreground))', MUTED = 'hsl(var(--muted-foreground))', LINE = 'hsl(var(--border))', SOFT = 'hsl(var(--secondary))', BG = 'hsl(var(--background))', GREEN = '#1f7a4d';
const money = (c: number) => `$${(c / 100).toLocaleString('en-US', { maximumFractionDigits: c % 100 ? 2 : 0, minimumFractionDigits: c % 100 ? 2 : 0 })}`;
const pill = (on: boolean) => (on ? { background: INK, color: BG } : { background: SOFT, color: INK });
const card = 'rounded-[22px] border bg-card p-5';
const input = 'h-11 w-full rounded-[12px] border bg-background px-3 text-[15px]';

export function LoyaltySetup({ tenantId }: { tenantId: string }) {
  const { services, inventory } = useInventory() as any;
  const [s, setS] = React.useState<any>(null); const [stats, setStats] = React.useState<any>(null); const [msg, setMsg] = React.useState<{ ok: boolean; t: string } | null>(null); const [busy, setBusy] = React.useState(false);
  React.useEffect(() => { payPost('/api/loyalty', { tenantId, action: 'settings' }).then((r) => r.ok && setS(r.settings)); payPost('/api/loyalty', { tenantId, action: 'stats' }).then((r) => r.ok && setStats(r)); }, [tenantId]);
  if (!s) return <p className="p-8 text-[14px]" style={{ color: MUTED }}>Loading…</p>;
  const set = (patch: any) => setS((x: any) => ({ ...x, ...patch }));
  const setEarn = (patch: any) => setS((x: any) => ({ ...x, earn: { ...x.earn, ...patch } }));
  const setReward = (i: number, patch: Partial<Reward>) => setS((x: any) => ({ ...x, rewards: x.rewards.map((r: Reward, k: number) => (k === i ? { ...r, ...patch } : r)) }));
  const unit = s.earn.mode === 'punch' ? 'punches' : 'points';
  const svcList = (services || []).filter((v: any) => v && v.isActive !== false && !v.archived).sort((a: any, b: any) => String(a.name).localeCompare(String(b.name)));
  const save = async () => { setBusy(true); setMsg(null); const r = await payPost('/api/loyalty', { tenantId, action: 'settings', save: s }); setBusy(false);
    if (r.ok) { setS(r.settings); setMsg({ ok: true, t: s.on ? `Saved. Rules version ${r.settings.version}.` : 'Saved. The program is off.' }); } else setMsg({ ok: false, t: r.error || 'That didn’t save.' }); };
  const terms = termsOf(loyaltyOf({ loyalty: s }));
  const leave = (k: 'serviceIds' | 'productIds', id: string) => setS((x: any) => { const cur: string[] = x.leaveOut?.[k] || []; return { ...x, leaveOut: { ...(x.leaveOut || {}), [k]: cur.includes(id) ? cur.filter((y) => y !== id) : [...cur, id] } }; });
  return (
    <div className="mx-auto max-w-6xl space-y-6 p-4 md:p-8" style={{ color: INK }}>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div><p className="text-[13px]" style={{ color: MUTED }}>Marketing</p><h1 className="text-[36px] font-light tracking-[-0.03em]">Loyalty</h1>
          <p className="max-w-xl text-[15px]" style={{ color: MUTED }}>Your own program, your own rules. Points are kept apart from gift card money, store credit and membership benefits.</p></div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[13px]" style={{ color: MUTED }}>Rules version {s.version}{s.updatedAt ? ` · changed ${new Date(s.updatedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}` : ''}</span>
          <button type="button" role="switch" aria-checked={s.on} onClick={() => set({ on: !s.on })} className="h-11 rounded-full px-5 text-[14px] font-semibold" style={pill(s.on)}>{s.on ? 'On' : 'Off'}</button>
          <button type="button" disabled={busy} onClick={save} className="h-11 rounded-full px-5 text-[14px] font-semibold disabled:opacity-50" style={{ background: INK, color: BG }}>{busy ? 'Saving…' : 'Save'}</button>
        </div>
      </div>
      {msg && <p className="text-[14px] font-semibold" style={{ color: msg.ok ? GREEN : '#b42318' }}>{msg.t}</p>}

      {stats && <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {[[String(stats.members), 'members with points'], [String(stats.owedPoints), `${unit} still owed`], [money(stats.owedCents || 0), 'what they’d cost if all used'], [`${stats.usedCount} · ${money(stats.usedCostCents || 0)}`, 'rewards used, 30 days']].map(([n, l]) => (
          <div key={l} className="rounded-[18px] border p-4" style={{ borderColor: LINE }}><p className="text-[26px] font-light tracking-[-0.02em]">{n}</p><p className="text-[13px]" style={{ color: MUTED }}>{l}</p></div>))}
      </div>}

      <div className="grid gap-5 md:grid-cols-2">
        <section className={`${card} space-y-4`} style={{ borderColor: LINE }}>
          <div><p className="text-[18px] font-semibold">How clients earn</p><p className="text-[13.5px]" style={{ color: MUTED }}>Earned once a visit or order is completed and paid. A refund takes the points back.</p></div>
          <div className="flex flex-wrap gap-2">{(Object.keys(EARN_LABEL) as EarnMode[]).map((m) => <button key={m} type="button" aria-pressed={s.earn.mode === m} onClick={() => setEarn({ mode: m })} className="h-10 rounded-full px-4 text-[13.5px] font-semibold" style={pill(s.earn.mode === m)}>{EARN_LABEL[m]}</button>)}</div>
          <div className="grid gap-3 sm:grid-cols-2">
            {s.earn.mode === 'per_dollar' && <label className="space-y-1.5 text-[13px]" style={{ color: MUTED }}>Points for each $1 spent<input type="number" min={0} max={20} step={0.5} value={s.earn.perDollar} onChange={(e) => setEarn({ perDollar: Number(e.target.value) })} className={input} style={{ borderColor: LINE, color: INK }} /></label>}
            {s.earn.mode === 'per_visit' && <label className="space-y-1.5 text-[13px]" style={{ color: MUTED }}>Points each visit<input type="number" min={0} max={1000} value={s.earn.perVisit} onChange={(e) => setEarn({ perVisit: Number(e.target.value) })} className={input} style={{ borderColor: LINE, color: INK }} /></label>}
            {s.earn.mode === 'punch' && <p className="text-[13px] sm:col-span-2" style={{ color: MUTED }}>Each visit is one punch. Set each reward below to how many punches it takes (10 for a free service, say).</p>}
            {s.earn.mode !== 'punch' && <label className="space-y-1.5 text-[13px]" style={{ color: MUTED }}>Bonus for booking the next visit before leaving<input type="number" min={0} max={500} value={s.earn.rebookBonus} onChange={(e) => setEarn({ rebookBonus: Number(e.target.value) })} className={input} style={{ borderColor: LINE, color: INK }} /></label>}
          </div>
          <div className="space-y-2"><p className="text-[13px]" style={{ color: MUTED }}>What counts</p>
            <div className="flex flex-wrap gap-1.5">
              {[['services', 'Services'], ['products', 'Shop products']].map(([k, l]) => <button key={k} type="button" aria-pressed={s.counts[k] !== false} onClick={() => set({ counts: { ...s.counts, [k]: s.counts[k] === false } })} className="h-9 rounded-full px-3.5 text-[13px] font-semibold" style={s.counts[k] !== false ? { background: '#e9f5ee', color: GREEN } : { background: SOFT, color: MUTED }}>{l}</button>)}
              <span className="inline-flex h-9 items-center rounded-full px-3.5 text-[13px] font-semibold" style={{ background: SOFT, color: MUTED }}>Tips and tax: never</span>
            </div>
            <div className="flex flex-wrap items-center gap-1.5 text-[13px]"><span style={{ color: MUTED }}>Gift card money earns</span>
              {[['spent', 'when it’s spent'], ['bought', 'when it’s bought']].map(([k, l]) => <button key={k} type="button" aria-pressed={s.counts.giftCards === k} onClick={() => set({ counts: { ...s.counts, giftCards: k } })} className="h-8 rounded-full px-3 text-[12.5px] font-semibold" style={pill(s.counts.giftCards === k)}>{l}</button>)}</div>
            <p className="text-[12.5px]" style={{ color: MUTED }}>Never both, so the same money never earns twice.</p>
          </div>
          <div className="space-y-2"><p className="text-[13px]" style={{ color: MUTED }}>Left out</p>
            <label className="flex items-center gap-2 text-[14px]"><input type="checkbox" checked={!!s.leaveOut?.memberVisits} onChange={(e) => set({ leaveOut: { ...(s.leaveOut || {}), memberVisits: e.target.checked } })} /> Visits covered by a membership</label>
            <details><summary className="cursor-pointer text-[13.5px] font-semibold">Services that don’t earn ({(s.leaveOut?.serviceIds || []).length})</summary>
              <div className="mt-2 flex max-h-40 flex-wrap gap-1.5 overflow-y-auto">{svcList.map((v: any) => <button key={v.id} type="button" aria-pressed={(s.leaveOut?.serviceIds || []).includes(v.id)} onClick={() => leave('serviceIds', v.id)} className="h-8 rounded-full px-3 text-[12.5px] font-semibold" style={pill((s.leaveOut?.serviceIds || []).includes(v.id))}>{v.name}</button>)}</div></details>
            <details><summary className="cursor-pointer text-[13.5px] font-semibold">Products that don’t earn ({(s.leaveOut?.productIds || []).length})</summary>
              <div className="mt-2 flex max-h-40 flex-wrap gap-1.5 overflow-y-auto">{(inventory || []).filter((p: any) => p?.type === 'retail').map((p: any) => <button key={p.id} type="button" aria-pressed={(s.leaveOut?.productIds || []).includes(p.id)} onClick={() => leave('productIds', p.id)} className="h-8 rounded-full px-3 text-[12.5px] font-semibold" style={pill((s.leaveOut?.productIds || []).includes(p.id))}>{p.name}</button>)}</div></details>
            <p className="text-[12.5px]" style={{ color: MUTED }}>Renters’ clients never earn studio points: their clients are theirs.</p>
          </div>
        </section>

        <section className={`${card} space-y-4`} style={{ borderColor: LINE }}>
          <div><p className="text-[18px] font-semibold">Rewards</p><p className="text-[13.5px]" style={{ color: MUTED }}>What {unit} turn into, and what each one costs you.</p></div>
          <div className="space-y-2">{(s.rewards || []).map((r: Reward, i: number) => (
            <div key={r.id} className="space-y-2 rounded-[16px] border p-3" style={{ borderColor: LINE }}>
              <div className="flex flex-wrap items-center gap-2">
                <input type="number" min={1} value={r.points} onChange={(e) => setReward(i, { points: Number(e.target.value) })} aria-label={`How many ${unit}`} className="h-10 w-20 rounded-[10px] border bg-background px-2 text-center text-[14px] font-semibold" style={{ borderColor: LINE }} />
                <input value={r.name} onChange={(e) => setReward(i, { name: e.target.value })} aria-label="Reward name" className="h-10 min-w-0 flex-1 rounded-[10px] border bg-background px-3 text-[14px]" style={{ borderColor: LINE }} />
                <button type="button" onClick={() => setReward(i, { on: !r.on })} className="h-10 rounded-full px-3 text-[12.5px] font-semibold" style={r.on ? { background: '#e9f5ee', color: GREEN } : { background: SOFT, color: MUTED }}>{r.on ? 'On' : 'Off'}</button>
                <button type="button" onClick={() => setS((x: any) => ({ ...x, rewards: x.rewards.filter((_: any, k: number) => k !== i) }))} className="h-10 rounded-full px-3 text-[12.5px]" style={{ color: MUTED }}>Remove</button>
              </div>
              <div className="flex flex-wrap items-center gap-2 text-[13px]">
                {[['amount_off', 'Money off'], ['free_service', 'A free service or add-on']].map(([k, l]) => <button key={k} type="button" onClick={() => setReward(i, { kind: k as any })} className="h-8 rounded-full px-3 text-[12.5px] font-semibold" style={pill(r.kind === k)}>{l}</button>)}
                {r.kind === 'amount_off' ? <label className="flex items-center gap-1">$<input type="number" min={1} value={(r.cents || 0) / 100} onChange={(e) => setReward(i, { cents: Math.round(Number(e.target.value) * 100), costCents: Math.round(Number(e.target.value) * 100) })} aria-label="Amount off" className="h-8 w-20 rounded-[8px] border bg-background px-2 text-[13px]" style={{ borderColor: LINE }} /> off</label>
                  : <><select value={r.serviceId || ''} onChange={(e) => setReward(i, { serviceId: e.target.value })} aria-label="Which service" className="h-8 rounded-[8px] border bg-background px-2 text-[13px]" style={{ borderColor: LINE }}><option value="">Choose…</option>{svcList.map((v: any) => <option key={v.id} value={v.id}>{v.name}</option>)}</select>
                    <label className="flex items-center gap-1" style={{ color: MUTED }}>costs you about $<input type="number" min={0} value={(r.costCents || 0) / 100} onChange={(e) => setReward(i, { costCents: Math.round(Number(e.target.value) * 100) })} aria-label="What it costs you" className="h-8 w-16 rounded-[8px] border bg-background px-2 text-[13px]" style={{ borderColor: LINE }} /></label></>}
              </div>
            </div>))}</div>
          <button type="button" onClick={() => setS((x: any) => ({ ...x, rewards: [...(x.rewards || []), { id: Math.random().toString(36).slice(2, 9), name: 'New reward', points: 500, kind: 'amount_off', cents: 1500, costCents: 1500, on: true }] }))} className="h-10 rounded-full border border-dashed px-4 text-[13.5px] font-semibold" style={{ borderColor: '#c9cace' }}>+ Add a reward</button>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="space-y-1.5 text-[13px]" style={{ color: MUTED }}>{unit === 'punches' ? 'Punches' : 'Points'} expire<select value={s.expiryMonths} onChange={(e) => set({ expiryMonths: Number(e.target.value) })} className={input} style={{ borderColor: LINE, color: INK }}>{EXPIRY_CHOICES.map((m) => <option key={m} value={m}>{m ? `After ${m} months with no visit` : 'Never'}</option>)}</select></label>
            <label className="space-y-1.5 text-[13px]" style={{ color: MUTED }}>Staff commission when a reward is used<select value={s.commission} onChange={(e) => set({ commission: e.target.value })} className={input} style={{ borderColor: LINE, color: INK }}><option value="full">Paid on the full price</option><option value="paid">Paid on what the client paid</option></select></label>
          </div>
          <label className="flex items-center gap-2 text-[14px]"><input type="checkbox" checked={s.oneRewardPerVisit !== false} onChange={(e) => set({ oneRewardPerVisit: e.target.checked })} /> One reward per visit</label>
        </section>
      </div>

      <section className={`${card} grid gap-5 md:grid-cols-3`} style={{ borderColor: LINE }}>
        <div><p className="text-[15px] font-semibold">In plain words, for clients</p><p className="mt-1.5 text-[14px] leading-[1.55]">{terms}</p></div>
        <div><p className="text-[15px] font-semibold">Where clients see it</p><p className="mt-1.5 text-[14px] leading-[1.55]" style={{ color: MUTED }}>At checkout (the desk sees their rewards), on their receipt, and on their client page.</p></div>
        <div><p className="text-[15px] font-semibold">Who’s in</p><div className="mt-1.5 space-y-1.5 text-[14px]">
          <label className="flex items-center gap-2"><input type="radio" name="join" checked={s.join !== 'opt_in'} onChange={() => set({ join: 'everyone' })} /> Everyone, from their next paid visit</label>
          <label className="flex items-center gap-2"><input type="radio" name="join" checked={s.join === 'opt_in'} onChange={() => set({ join: 'opt_in' })} /> Only clients who say yes at checkout</label></div></div>
      </section>
    </div>);
}
