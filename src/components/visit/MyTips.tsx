'use client';
// src/components/visit/MyTips.tsx — "MY TIPS" in the staff portal when tips are shared: each approved period — what they
// took, what came in or went out, and their share. Transparent, so there's nothing to argue about.
import * as React from 'react';
import { getAuth } from 'firebase/auth';
const money = (c: number) => `$${(Math.abs(c) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
export function MyTips({ tenantId, tone }: { tenantId: string; tone?: 'dark' }) {
  const [d, setD] = React.useState<any>(null); const dark = tone === 'dark';
  React.useEffect(() => { (async () => { const tk = await getAuth().currentUser?.getIdToken().catch(() => '') || ''; const r = await fetch('/api/tips/share', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(tk ? { Authorization: `Bearer ${tk}` } : {}) }, body: JSON.stringify({ tenantId, action: 'mine' }) }).then((x) => x.json()).catch(() => null); setD(r?.ok ? r : null); })(); }, [tenantId]);
  if (!d || d.mode === 'direct' || !d.rows?.length) return null;
  const muted = { color: dark ? 'rgba(255,255,255,.6)' : 'var(--muted, #78716c)' };
  return (
    <section className="space-y-2 rounded-3xl p-4" style={dark ? { background: 'rgba(255,255,255,.05)', border: '1px solid rgba(255,255,255,.1)' } : { background: 'var(--card, #fff)', border: '1px solid var(--line, #e7e2dc)' }} aria-label="My tips">
      <p className="text-[15px] font-semibold">My tips — {d.mode === 'pool' ? 'shared by the team' : 'with tip-outs'}</p>
      {d.rows.slice(0, 6).map((r: any) => (
        <p key={r.start} className="text-[14px]"><b>{money(r.shareCents)}</b> <span style={muted}>· {String(r.start).slice(0, 10)}{String(r.end).slice(0, 10) !== String(r.start).slice(0, 10) ? ` to ${String(r.end).slice(0, 10)}` : ''}{r.hours ? ` · ${r.hours} h` : ''} · took {money(r.earnedCents)}{r.inCents ? `, +${money(r.inCents)} shared in` : ''}{r.outCents ? `, −${money(r.outCents)} shared out` : ''}{d.mode === 'pool' ? ` · pot ${money(r.potCents)} across ${r.people}` : ''}</span></p>))}
      <p className="text-[12px]" style={muted}>Approved by a manager each period; paid with your pay.</p>
    </section>);
}
