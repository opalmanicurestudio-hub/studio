'use client';
// A CLIENT'S REWARDS LEDGER on their profile (design canvas "Loyalty engine", board 4). Every line ties to the sale,
// refund or person that made it; a sale can only earn once; past sales keep the rules version they earned under.
// Managers can add or take off points, with a reason.
import * as React from 'react';
import { payPost } from '@/components/pay/pay-client';

const MUTED = 'hsl(var(--muted-foreground))', LINE = 'hsl(var(--border))', SOFT = 'hsl(var(--secondary))', GREEN = '#1f7a4d', RED = '#b42318';
const day = (iso: string) => new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: new Date(iso).getFullYear() !== new Date().getFullYear() ? 'numeric' : undefined });

export function ClientRewards({ tenantId, clientId, manager }: { tenantId: string; clientId: string; manager: boolean }) {
  const [d, setD] = React.useState<any>(null); const [adj, setAdj] = React.useState<{ points: string; note: string } | null>(null); const [msg, setMsg] = React.useState('');
  const load = React.useCallback(() => payPost('/api/loyalty', { tenantId, action: 'client', clientId }).then((r) => setD(r?.ok ? r : { off: true })), [tenantId, clientId]);
  React.useEffect(() => { void load(); }, [load]);
  if (!d) return <p className="text-[14px]" style={{ color: MUTED }}>Loading rewards…</p>;
  if (d.off || (!d.on && !(d.ledger || []).length)) return null;
  const unit = d.unit || 'points'; const L: any[] = d.ledger || [];
  const earned = L.filter((e) => e.type === 'earn' || (e.type === 'adjust' && e.points > 0)).reduce((t, e) => t + e.points, 0); const used = L.filter((e) => e.type === 'redeem');
  const save = async () => { if (!adj) return; setMsg(''); const r = await payPost('/api/loyalty', { tenantId, action: 'adjust', clientId, points: Number(adj.points), note: adj.note }); if (r.ok) { setAdj(null); void load(); } else setMsg(r.error || 'That didn’t save.'); };
  let run = d.balance; const rows = L.map((e) => { const r = { ...e, after: run }; run -= Number(e.points) || 0; return r; });
  return (
    <section className="space-y-3 rounded-[22px] border bg-card p-5" style={{ borderColor: LINE }}>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div><p className="text-[13px]" style={{ color: MUTED }}>Rewards</p><p className="text-[28px] font-light tracking-[-0.02em]">{d.balance} {unit}</p></div>
        {manager && !adj && <button type="button" onClick={() => setAdj({ points: '', note: '' })} className="h-10 rounded-full border px-4 text-[13.5px] font-semibold" style={{ borderColor: LINE }}>Adjust (with a reason)</button>}
      </div>
      {adj && <div className="flex flex-wrap items-center gap-2 rounded-[14px] p-3" style={{ background: SOFT }}>
        <input type="number" value={adj.points} onChange={(e) => setAdj({ ...adj, points: e.target.value })} placeholder="+100 or −50" aria-label="Points to add or take off" className="h-10 w-28 rounded-[10px] border bg-background px-3 text-[14px]" style={{ borderColor: LINE }} />
        <input value={adj.note} onChange={(e) => setAdj({ ...adj, note: e.target.value })} placeholder="Why" aria-label="Why" className="h-10 min-w-0 flex-1 rounded-[10px] border bg-background px-3 text-[14px]" style={{ borderColor: LINE }} />
        <button type="button" onClick={save} className="h-10 rounded-full px-4 text-[13.5px] font-semibold text-background" style={{ background: 'hsl(var(--foreground))' }}>Save</button>
        <button type="button" onClick={() => setAdj(null)} className="h-10 px-2 text-[13.5px]" style={{ color: MUTED }}>Cancel</button>
        {msg && <p className="w-full text-[13px] font-semibold" style={{ color: RED }}>{msg}</p>}</div>}
      {rows.length ? <div className="overflow-x-auto rounded-[16px] border" style={{ borderColor: LINE }}>
        <table className="w-full min-w-[560px] text-[14px]"><thead><tr className="text-left text-[12.5px]" style={{ background: SOFT, color: MUTED }}><th className="px-3 py-2 font-medium">Date</th><th className="px-3 py-2 font-medium">What happened</th><th className="px-3 py-2 font-medium">Linked to</th><th className="px-3 py-2 text-right font-medium">{unit === 'punches' ? 'Punches' : 'Points'}</th><th className="px-3 py-2 text-right font-medium">Balance</th></tr></thead>
          <tbody>{rows.map((e) => <tr key={e.id} style={{ borderTop: `1px solid ${LINE}` }}><td className="px-3 py-2.5">{day(e.at)}</td><td className="px-3 py-2.5">{e.why || e.type}</td><td className="px-3 py-2.5" style={{ color: MUTED }}>{e.saleId ? `Sale ${String(e.saleId).slice(-6)}${e.version ? ` · rules v${e.version}` : ''}` : e.type === 'adjust' ? 'Manual' : e.type === 'expire' ? 'Expiry' : ''}</td>
            <td className="px-3 py-2.5 text-right font-semibold" style={{ color: e.points > 0 ? GREEN : e.type === 'reverse' ? RED : undefined }}>{e.points > 0 ? `+${e.points}` : `−${Math.abs(e.points)}`}</td><td className="px-3 py-2.5 text-right">{e.after}</td></tr>)}</tbody></table></div>
        : <p className="text-[14px]" style={{ color: MUTED }}>Nothing yet. Points appear after their next paid visit.</p>}
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-[16px] p-3.5" style={{ background: SOFT }}><p className="text-[13px]" style={{ color: MUTED }}>Earned, all time</p><p className="text-[20px] font-semibold">{earned}</p></div>
        <div className="rounded-[16px] p-3.5" style={{ background: SOFT }}><p className="text-[13px]" style={{ color: MUTED }}>Used</p><p className="text-[20px] font-semibold">{used.reduce((t, e) => t - e.points, 0)} · {used.length} reward{used.length === 1 ? '' : 's'}</p></div>
        <div className="rounded-[16px] p-3.5" style={{ background: SOFT }}><p className="text-[13px]" style={{ color: MUTED }}>{d.expiresAt ? 'Expire if no visit by' : 'Expiry'}</p><p className="text-[20px] font-semibold">{d.expiresAt ? day(d.expiresAt) : 'Never'}</p></div>
      </div>
    </section>);
}
