'use client';
// src/components/staff/TypicalTimes.tsx — a provider's TYPICAL TIMES on their details sheet (owners / managers), from the
// nightly numbers: per service, typical vs booked, the usual range, on-time rate, why visits ran over, and the trend.
// Students are shown against the team's typical time (progress). Renters never appear here.
import * as React from 'react';
import { getAuth } from 'firebase/auth';
export function TypicalTimes({ tenantId, staffId }: { tenantId: string; staffId: string }) {
  const [d, setD] = React.useState<any>(null);
  React.useEffect(() => { if (!tenantId || !staffId) return; let on = true;
    (async () => { const tk = await getAuth().currentUser?.getIdToken().catch(() => '') || '';
      const r = await fetch('/api/timing', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(tk ? { Authorization: `Bearer ${tk}` } : {}) }, body: JSON.stringify({ tenantId, action: 'staff', staffId }) }).then((x) => x.json()).catch(() => null);
      if (on) setD(r?.ok ? r : { rows: [] }); })(); return () => { on = false; }; }, [tenantId, staffId]);
  if (!d || d.renter) return null;
  return (
    <section className="space-y-2 rounded-3xl p-5" style={{ background: 'var(--card, #fff)', border: '1px solid var(--line, #e7e2dc)' }} aria-label="Typical times">
      <p className="text-[15px] font-semibold">Typical times</p>
      {!d.rows.length ? <p className="text-[14px]" style={{ color: 'var(--muted, #78716c)' }}>Not enough timed visits yet — numbers appear after 5 counted visits of a service.</p>
        : d.rows.slice(0, 10).map((r: any) => (
          <div key={r.label} className="text-[14px]">
            <p><b>{r.label}</b> · typically <b>{r.typical} min</b> <span style={{ color: 'var(--muted, #78716c)' }}>(booked {r.booked} · usually {r.low}–{r.high})</span></p>
            <p style={{ color: 'var(--muted, #78716c)' }}>On time {Math.round(r.onTime * 100)}% of {r.count}{r.clientCaused || r.ranBehind ? ` · ran over: ${r.clientCaused} client-caused, ${r.ranBehind} ran behind` : ''}{r.trend !== null ? ` · ${r.trend < 0 ? `${Math.abs(r.trend)} min faster` : r.trend > 0 ? `${r.trend} min slower` : 'steady'} lately` : ''}{r.team !== null && d.isStudent ? ` · team typically ${r.team}` : ''}</p>
          </div>))}
      <p className="text-[12px]" style={{ color: 'var(--muted, #78716c)' }}>For coaching and booking lengths — the provider sees the same numbers in their portal.</p>
    </section>);
}
