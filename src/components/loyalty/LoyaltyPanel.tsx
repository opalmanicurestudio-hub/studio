'use client';
// THE DESK'S VIEW OF A CLIENT'S REWARDS at checkout (design canvas "Loyalty engine", boards 2 and 6). Their points, what
// to say (a notable visit, an anniversary, a birthday), what they're saving for, a reward that's ready ("Use it today" /
// "Save it"), their tier's free upgrade, and a surprise when one is due. Everything chosen here comes off the bill as one
// loyalty discount; the server checks each part again and records it when the sale is paid (/api/checkout/complete).
import * as React from 'react';
import { payPost } from '@/components/pay/pay-client';
import { rewardCents, type Reward } from '@/lib/loyalty';

type Pick = { rewardId: string | null; cents: number; label: string; surpriseId?: string | null; perk?: boolean };
const dollars = (c: number) => `$${(c / 100).toFixed(c % 100 ? 2 : 0)}`;

export function LoyaltyPanel({ tenantId, clientId, clientName, reward, setReward, bill }: { tenantId: string; clientId: string; clientName?: string | null;
  reward: Pick | null; setReward: (r: Pick | null) => void;
  bill: { subtotal: number; discountBase: number; lines: { serviceId: string; cents: number }[] } }) {
  const [d, setD] = React.useState<any>(null); const [saved, setSaved] = React.useState(false); const [msg, setMsg] = React.useState('');
  const [rw, setRw] = React.useState<Reward | null>(null); const [sur, setSur] = React.useState<any>(null); const [perkOff, setPerkOff] = React.useState(false); const [skipSur, setSkipSur] = React.useState(false);
  React.useEffect(() => { setD(null); setSaved(false); setMsg(''); setRw(null); setSur(null); setPerkOff(false); setSkipSur(false); if (!clientId || clientId === 'walk-in') return; payPost('/api/loyalty', { tenantId, action: 'client', clientId }).then((r) => setD(r?.ok ? r : null)); }, [tenantId, clientId]);
  const discountable = Math.max(0, Math.round((bill.subtotal - bill.discountBase) * 100));
  const value = (r: { kind: string; cents?: number; serviceId?: string | null } | null) => (r ? rewardCents(r as Reward, { lines: bill.lines, discountableCents: discountable }) : 0);
  const x = d?.extras || null; const up = x?.tierPerks?.upgrade || null;
  const upLine = up ? bill.lines.find((l) => l.serviceId === up.toServiceId) : null; const perkC = up && upLine && !perkOff ? Math.min(upLine.cents, up.cents) : 0;
  const rwC = value(rw); const surC = value(sur);
  // Keep the bill in step with what's chosen here (one loyalty discount, each part checked again by the server).
  const key = `${rw?.id || ''}|${rwC}|${sur?.id || ''}|${surC}|${perkC}`;
  React.useEffect(() => {
    if (!d) return; const parts = [rw && rwC > 0 && `Reward: ${rw.name}`, sur && surC > 0 && `Surprise: ${sur.name}`, perkC > 0 && `${x?.tierPerks?.name || 'Tier'} upgrade`].filter(Boolean) as string[];
    const total = (rw ? rwC : 0) + (sur ? surC : 0) + perkC;
    setReward(total > 0 ? { rewardId: rw && rwC > 0 ? rw.id : null, cents: total, label: parts.join(' · '), surpriseId: sur && surC > 0 ? sur.id : null, perk: perkC > 0 } : null);
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  // The bill's breakdown can remove the whole loyalty discount: clear the choices with it.
  React.useEffect(() => { if (reward === null && (rw || sur)) { setRw(null); setSur(null); if (perkC) setPerkOff(true); } }, [reward]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!d?.on || d.optedOut) return null;
  const first = String(clientName || 'They').split(' ')[0]; const unit = d.unit || 'points';
  const box = { background: 'var(--soft)', borderRadius: 18, padding: 16 } as const;
  const dark = { background: 'var(--ink, #16171a)', color: 'var(--paper, #fff)' } as const; const light = { background: 'var(--card)', border: '1px solid var(--line)' } as const;
  if (!d.joined) return (<section style={box} className="space-y-2"><p className="text-[15px] font-semibold">Rewards</p><p className="text-[14px]">Ask {first} if they’d like to join. This visit will count.</p>
    <button type="button" onClick={async () => { const r = await payPost('/api/loyalty', { tenantId, action: 'join', clientId }); if (r.ok) { setD({ ...d, joined: true }); if (r.headStart) setMsg(`${first} starts with ${r.headStart} ${unit}.`); } }} className="h-11 rounded-full px-4 text-[14px] font-semibold" style={dark}>They said yes</button>{msg && <p className="text-[13px]" style={{ color: 'var(--ok)' }}>{msg}</p>}</section>);
  const usable: Reward[] = (d.ready || []).filter((r: Reward) => value(r) > 0);
  const pick = (r: Reward) => { if (value(r) <= 0) { setMsg(`${r.name} can’t be used on this bill.`); return; } setRw(r); setMsg(''); };
  const surprise = x?.surprise && !skipSur ? x.surprise : null;
  return (
    <section style={box} className="space-y-2.5">
      <div className="flex items-center justify-between gap-2"><p className="text-[15px] font-semibold">{rw ? `Using ${rw.name}` : usable.length && !saved ? `${first} has a reward ready` : 'Rewards'}</p>
        <span className="flex items-center gap-1.5">{d.tier && <span className="rounded-full px-2.5 py-1 text-[12px] font-bold" style={light}>{d.tier.name}</span>}<span className="rounded-full px-2.5 py-1 text-[12px] font-bold" style={{ background: 'color-mix(in srgb, var(--ok) 14%, transparent)', color: 'var(--ok)' }}>{d.balance} {unit}</span></span></div>
      {x?.cues?.length ? <div className="flex flex-wrap gap-1.5">{x.cues.map((c: string) => <span key={c} className="rounded-full px-2.5 py-1 text-[12.5px] font-semibold" style={light}>{c}</span>)}</div> : null}
      {(x?.boosts || []).length > 0 && <p className="text-[13px] font-semibold" style={{ color: 'var(--ok)' }}>Running today: {x.boosts.join(', ')}</p>}
      {x?.goal && x.goal.toGo > 0 && <p className="text-[13px]" style={{ color: 'var(--muted)' }}>{x.goal.chosen ? 'Saving for' : 'Next up'}: {x.goal.name}, {x.goal.toGo} {unit} to go.</p>}
      {up && upLine && <div className="flex items-center justify-between gap-2 text-[13.5px]"><span>{perkOff ? `${d.tier?.name || 'Tier'} perk: free upgrade to ${up.toName}` : `${d.tier?.name || 'Tier'} perk: ${up.toName} at the ${up.fromName} price (−${dollars(perkC)})`}</span>
        <button type="button" onClick={() => setPerkOff(!perkOff)} className="text-[13px] font-semibold underline">{perkOff ? 'Apply it' : 'Remove'}</button></div>}
      {rw ? <div className="flex items-center justify-between gap-2 text-[14px]"><span>−{dollars(rwC)} off this bill</span><button type="button" onClick={() => setRw(null)} className="text-[13px] font-semibold underline">Don’t use it</button></div>
        : usable.length && !saved ? <>
          <p className="text-[14px]">{usable[0].name} ({usable[0].points} {unit}). Mention it before {first} leaves.</p>
          <div className="flex gap-2"><button type="button" onClick={() => pick(usable[0])} className="h-11 flex-1 rounded-full text-[14px] font-semibold" style={dark}>Use it today</button>
            <button type="button" onClick={() => setSaved(true)} className="h-11 rounded-full px-4 text-[14px] font-semibold" style={light}>Save it</button></div>
          {usable.length > 1 && <div className="flex flex-wrap gap-1.5 text-[12.5px]">{usable.slice(1).map((r) => <button key={r.id} type="button" onClick={() => pick(r)} className="h-8 rounded-full px-3 font-semibold" style={light}>Or {r.name}</button>)}</div>}
          {d.oneRewardPerVisit && <p className="text-[12px]" style={{ color: 'var(--muted)' }}>One reward per visit.</p>}
        </> : <p className="text-[13.5px]" style={{ color: 'var(--muted)' }}>{d.next ? `${d.next.toGo} ${unit} to ${d.next.reward.name.charAt(0).toLowerCase()}${d.next.reward.name.slice(1)}.` : 'Earning on this visit.'}</p>}
      {sur ? <div className="flex items-center justify-between gap-2 rounded-[14px] p-3 text-[14px]" style={light}><span>Surprise: {sur.name} (−{dollars(surC)})</span><button type="button" onClick={() => setSur(null)} className="text-[13px] font-semibold underline">Remove</button></div>
        : surprise ? <div className="space-y-2 rounded-[14px] p-3" style={light}>
          <p className="text-[14px] font-semibold">A surprise for {first} today</p>
          <p className="text-[13px]" style={{ color: 'var(--muted)' }}>{surprise.why}: {surprise.name}. They don’t know about it. Tell them as you add it.</p>
          <div className="flex gap-2"><button type="button" onClick={() => { if (value(surprise) <= 0) { setMsg(`${surprise.name} can’t be used on this bill.`); return; } setSur(surprise); }} className="h-10 rounded-full px-4 text-[13.5px] font-semibold" style={dark}>Add it</button>
            <button type="button" onClick={() => setSkipSur(true)} className="h-10 rounded-full px-4 text-[13.5px] font-semibold" style={light}>Not today</button></div></div>
        : (x?.teamSurprises || []).length > 0 ? <details className="text-[13px]"><summary className="cursor-pointer font-semibold">Give a surprise ({x.surpriseBudgetLeft} left this month)</summary>
          <div className="mt-2 flex flex-wrap gap-1.5">{x.teamSurprises.map((s: any) => <button key={s.id} type="button" onClick={() => { if (value(s) <= 0) { setMsg(`${s.name} can’t be used on this bill.`); return; } setSur({ ...s, why: 'Chosen by the team' }); }} className="h-8 rounded-full px-3 font-semibold" style={light}>{s.name}</button>)}</div></details> : null}
      {msg && <p className="text-[13px] font-semibold" style={{ color: 'var(--bad, #b42318)' }}>{msg}</p>}
    </section>);
}
