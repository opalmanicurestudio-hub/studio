'use client';
// src/components/visit/MyTimes.tsx — "MY TIMES" in the staff portal: how long each service typically takes me, vs booked —
// shown once there are 5+ honest visits. Students see the team's typical time too: progress, not a ranking. Only the
// provider and the managers see these numbers; renters never see this card.
import * as React from 'react';
import { getAuth } from 'firebase/auth';
async function post(body: any) { const tk = await getAuth().currentUser?.getIdToken().catch(() => '') || '';
  return fetch('/api/visits', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(tk ? { Authorization: `Bearer ${tk}` } : {}) }, body: JSON.stringify(body) }).then((r) => r.json()).catch(() => ({ ok: false })); }

export function MyTimes({ tenantId, tone }: { tenantId: string; tone?: 'dark' }) {
  const [d, setD] = React.useState<any>(null); const dark = tone === 'dark';
  React.useEffect(() => { void post({ tenantId, action: 'my-times' }).then((r) => setD(r?.ok ? r : { rows: [] })); }, [tenantId]);
  if (!d || !d.rows?.length) return null;
  const muted = { color: dark ? 'rgba(255,255,255,.6)' : 'var(--muted, #78716c)' };
  return (
    <section className="space-y-2 rounded-3xl p-4" style={dark ? { background: 'rgba(255,255,255,.05)', border: '1px solid rgba(255,255,255,.1)' } : { background: 'var(--card, #fff)', border: '1px solid var(--line, #e7e2dc)' }} aria-label="My times">
      <p className="text-[15px] font-semibold">My times</p>
      {d.rows.slice(0, 8).map((r: any) => (
        <div key={r.service} className="text-[14px]">
          <p><b>{r.service}</b> · typically <b>{r.typical} min</b> <span style={muted}>(booked {r.booked} · usually {r.low}–{r.high})</span></p>
          <p style={muted}>On time {Math.round(r.onTime * 100)}% of {r.count} visits{r.trend !== null ? ` · ${r.trend < 0 ? `${Math.abs(r.trend)} min faster` : r.trend > 0 ? `${r.trend} min slower` : 'steady'} lately` : ''}{r.team !== null ? ` · team typically ${r.team} min${r.typical <= r.team ? ' — you’re there' : ` — ${r.typical - r.team} to go`}` : ''}</p>
        </div>))}
      <p className="text-[12px]" style={muted}>{d.isStudent ? 'Progress, not a ranking — the team figure is where licensed providers typically land.' : 'Only you and the managers see this.'}</p>
    </section>);
}
