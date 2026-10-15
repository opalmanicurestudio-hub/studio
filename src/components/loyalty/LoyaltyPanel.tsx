'use client';
// THE DESK'S VIEW OF A CLIENT'S REWARDS at checkout (design canvas "Loyalty engine", board 2). Their points, a reward
// that's ready ("Use it today" / "Save it"), and what this visit will earn. The server checks the points again and
// takes them off when the sale is paid (/api/checkout/complete, lib/loyalty-server).
import * as React from 'react';
import { payPost } from '@/components/pay/pay-client';
import { rewardCents, type Reward } from '@/lib/loyalty';

export function LoyaltyPanel({ tenantId, clientId, clientName, reward, setReward, bill }: { tenantId: string; clientId: string; clientName?: string | null;
  reward: { rewardId: string; cents: number; label: string } | null; setReward: (r: { rewardId: string; cents: number; label: string } | null) => void;
  bill: { subtotal: number; discountBase: number; lines: { serviceId: string; cents: number }[] } }) {
  const [d, setD] = React.useState<any>(null); const [saved, setSaved] = React.useState(false); const [msg, setMsg] = React.useState('');
  React.useEffect(() => { setD(null); setSaved(false); setMsg(''); if (!clientId || clientId === 'walk-in') return; payPost('/api/loyalty', { tenantId, action: 'client', clientId }).then((r) => setD(r?.ok ? r : null)); }, [tenantId, clientId]);
  if (!d?.on || d.optedOut) return null;
  const first = String(clientName || 'They').split(' ')[0]; const unit = d.unit || 'points';
  if (!d.joined) return (<section style={{ background: 'var(--soft)', borderRadius: 18, padding: 16 }} className="space-y-2"><p className="text-[15px] font-semibold">Rewards</p><p className="text-[14px]">Ask {first} if they’d like to join. This visit will count.</p>
    <button type="button" onClick={async () => { const r = await payPost('/api/loyalty', { tenantId, action: 'join', clientId }); if (r.ok) setD({ ...d, joined: true }); }} className="h-11 rounded-full px-4 text-[14px] font-semibold" style={{ background: 'var(--accent, var(--ink))', color: 'var(--accent-ink, #fff)' }}>They said yes</button></section>);
  const value = (r: Reward) => rewardCents(r, { lines: bill.lines, discountableCents: Math.max(0, Math.round((bill.subtotal - bill.discountBase) * 100)) });
  const usable: Reward[] = (d.ready || []).filter((r: Reward) => value(r) > 0);
  const pick = (r: Reward) => { const c = value(r); if (c <= 0) { setMsg(`${r.name} can’t be used on this bill.`); return; } setReward({ rewardId: r.id, cents: c, label: `Reward: ${r.name}` }); setMsg(''); };
  const box = { background: 'var(--soft)', borderRadius: 18, padding: 16 } as const;
  return (
    <section style={box} className="space-y-2.5">
      <div className="flex items-center justify-between gap-2"><p className="text-[15px] font-semibold">{reward ? `Using ${reward.label.replace(/^Reward: /, '')}` : usable.length && !saved ? `${first} has a reward ready` : 'Rewards'}</p>
        <span className="flex items-center gap-1.5">{d.tier && <span className="rounded-full px-2.5 py-1 text-[12px] font-bold" style={{ background: 'var(--card)', border: '1px solid var(--line)' }}>{d.tier.name}</span>}<span className="rounded-full px-2.5 py-1 text-[12px] font-bold" style={{ background: 'color-mix(in srgb, var(--ok) 14%, transparent)', color: 'var(--ok)' }}>{d.balance} {unit}</span></span></div>
      {d.tier?.perks?.length ? <p className="text-[12.5px]" style={{ color: 'var(--muted)' }}>{d.tier.name}: {d.tier.perks.join(', ')}</p> : null}
      {reward ? <div className="flex items-center justify-between gap-2 text-[14px]"><span>−${(reward.cents / 100).toFixed(2)} off this bill</span><button type="button" onClick={() => setReward(null)} className="text-[13px] font-semibold underline">Don’t use it</button></div>
        : usable.length && !saved ? <>
          <p className="text-[14px]">{usable[0].name} ({usable[0].points} {unit}). Mention it before {first} leaves.</p>
          <div className="flex gap-2"><button type="button" onClick={() => pick(usable[0])} className="h-11 flex-1 rounded-full text-[14px] font-semibold" style={{ background: 'var(--accent, var(--ink))', color: 'var(--accent-ink, #fff)' }}>Use it today</button>
            <button type="button" onClick={() => setSaved(true)} className="h-11 rounded-full px-4 text-[14px] font-semibold" style={{ background: 'var(--card)', border: '1px solid var(--line)' }}>Save it</button></div>
          {usable.length > 1 && <div className="flex flex-wrap gap-1.5 text-[12.5px]">{usable.slice(1).map((r) => <button key={r.id} type="button" onClick={() => pick(r)} className="h-8 rounded-full px-3 font-semibold" style={{ background: 'var(--card)', border: '1px solid var(--line)' }}>Or {r.name}</button>)}</div>}
          {d.oneRewardPerVisit && <p className="text-[12px]" style={{ color: 'var(--muted)' }}>One reward per visit.</p>}
        </> : <p className="text-[13.5px]" style={{ color: 'var(--muted)' }}>{d.next ? `${d.next.toGo} ${unit} to ${d.next.reward.name.charAt(0).toLowerCase()}${d.next.reward.name.slice(1)}.` : 'Earning on this visit.'}</p>}
      {msg && <p className="text-[13px] font-semibold" style={{ color: 'var(--bad, #b42318)' }}>{msg}</p>}
    </section>);
}
