'use client';
// LOYALTY → HOW IT'S GOING (phase 5). What's measured (members, rewards used and what they cost, points still owed,
// tiers, and for each automatic message: who came back after it vs a comparable few who were left alone) kept apart from
// the association that's easy to misread ("members visit more" is not "loyalty made them visit more").
import * as React from 'react';
import { payPost } from '@/components/pay/pay-client';

const MUTED = 'hsl(var(--muted-foreground))', LINE = 'hsl(var(--border))', SOFT = 'hsl(var(--secondary))', GREEN = '#1f7a4d';
const money = (c: number) => `$${(c / 100).toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
const KIND: Record<string, string> = { rewardReady: 'A reward is ready', tierUp: 'New tier', unused: 'Points waiting', comeBack: 'Come back' };

export function LoyaltyDashboard({ tenantId, unit }: { tenantId: string; unit: string }) {
  const [d, setD] = React.useState<any>(null);
  React.useEffect(() => { payPost('/api/loyalty', { tenantId, action: 'dashboard' }).then((r) => setD(r?.ok ? r : null)); }, [tenantId]);
  if (!d) return null; const m = d.measured;
  const tile = (n: React.ReactNode, l: string) => <div className="rounded-[16px] p-3.5" style={{ background: SOFT }}><p className="text-[22px] font-light tracking-[-0.02em]">{n}</p><p className="text-[12.5px]" style={{ color: MUTED }}>{l}</p></div>;
  return (
    <section className="space-y-4 rounded-[22px] border bg-card p-5" style={{ borderColor: LINE }}>
      <div><p className="text-[18px] font-semibold">How it’s going</p><p className="text-[13.5px]" style={{ color: MUTED }}>Measured from your own records. The last box is an association, kept apart on purpose.</p></div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {tile(Number(m.members).toLocaleString('en-US'), 'members (earned in the last year)')}{tile(m.memberActive90, 'of them came in, last 90 days')}
        {tile(`${m.rewardsUsed90} · ${money(m.rewardCost90Cents)}`, 'rewards used and their cost, 90 days')}{tile(`${Number(m.owedPoints).toLocaleString('en-US')} · ${money(m.owedCents)}`, `${unit} still owed and roughly their cost`)}
      </div>
      {m.byReward?.length > 0 && <div><p className="mb-1.5 text-[13px]" style={{ color: MUTED }}>Which rewards get used (90 days)</p><div className="flex flex-wrap gap-2">{m.byReward.map((r: any) => <span key={r.name} className="rounded-full px-3 py-1.5 text-[13px]" style={{ background: SOFT }}>{r.name} · {r.used} · {money(r.costCents)}</span>)}</div></div>}
      {m.tiers?.length > 0 && <div><p className="mb-1.5 text-[13px]" style={{ color: MUTED }}>Tiers</p><div className="flex flex-wrap gap-2">{m.tiers.map((x: any) => <span key={x.name} className="rounded-full px-3 py-1.5 text-[13px]" style={{ background: SOFT }}>{x.name} · {x.members}</span>)}</div></div>}
      <div className="space-y-2"><p className="text-[13px]" style={{ color: MUTED }}>Automatic messages: came back within 30 days, sent vs left alone</p>
        <div className="overflow-x-auto rounded-[14px] border" style={{ borderColor: LINE }}><table className="w-full min-w-[480px] text-[13.5px]"><thead><tr style={{ background: SOFT, color: MUTED }} className="text-left"><th className="px-3 py-2 font-medium">Message</th><th className="px-3 py-2 font-medium">Sent</th><th className="px-3 py-2 font-medium">Left alone</th><th className="px-3 py-2 font-medium">What it changed</th></tr></thead>
          <tbody>{m.messages.map((x: any) => <tr key={x.kind} style={{ borderTop: `1px solid ${LINE}` }}><td className="px-3 py-2">{KIND[x.kind]}</td><td className="px-3 py-2">{x.sentBack}/{x.sent}</td><td className="px-3 py-2">{x.heldBack}/{x.held}</td>
            <td className="px-3 py-2" style={{ color: x.lift > 0 ? GREEN : undefined }}>{x.enough ? `${x.lift > 0 ? '+' : ''}${x.lift} points of return rate` : 'Not enough yet (20 in each group)'}</td></tr>)}</tbody></table></div></div>
      <div className="rounded-[14px] p-3.5 text-[13.5px]" style={{ background: SOFT }}><b>An association, not a cause:</b> members came in {d.association.memberVisits ?? '—'} times this year on average; everyone else, {d.association.otherVisits ?? '—'}. {d.association.note}</div>
    </section>);
}
