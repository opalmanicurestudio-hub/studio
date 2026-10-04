'use client';
// src/components/visit/StaffOverruns.tsx — "WHY DID IT RUN OVER?" for the provider, in their portal. Only shows when one of
// their visits today ran past the booked time (and grace) without a reason. One tap answers; nothing ever blocks them.
// The answer decides whether an overtime charge can even be suggested (only things the client asked for or caused), and
// keeps their typical times fair.
import * as React from 'react';
import { getAuth } from 'firebase/auth';
import { OVER_REASONS } from '@/lib/timing';

async function post(body: any) { const tk = await getAuth().currentUser?.getIdToken().catch(() => '') || '';
  return fetch('/api/visits', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(tk ? { Authorization: `Bearer ${tk}` } : {}) }, body: JSON.stringify(body) }).then((r) => r.json()).catch(() => ({ ok: false })); }

export function StaffOverruns({ tenantId, tone }: { tenantId: string; tone?: 'dark' }) {
  const dark = tone === 'dark';
  const [list, setList] = React.useState<any[]>([]); const [busy, setBusy] = React.useState<string | null>(null);
  const load = React.useCallback(async () => { const r = await post({ tenantId, action: 'my-overruns' }); if (r?.ok) setList(r.visits || []); }, [tenantId]);
  React.useEffect(() => { void load(); const t = setInterval(load, 5 * 60000); return () => clearInterval(t); }, [load]);
  if (!list.length) return null;
  return (
    <section className="space-y-3 rounded-3xl p-4" style={dark ? { background: 'rgba(255,255,255,.05)', border: '1px solid rgba(255,255,255,.1)' } : { background: 'var(--card, #fff)', border: '1px solid var(--line, #e7e2dc)' }} aria-label="Visits that ran over">
      <p className="text-[15px] font-semibold">{list.length === 1 ? 'A visit ran over — why?' : `${list.length} visits ran over — why?`}</p>
      {list.map((v) => (
        <div key={v.id} className="space-y-2">
          <p className="text-[14px]">{v.client} · {v.service} — took {v.actualMinutes} min (booked {v.bookedMinutes})</p>
          <div className="flex flex-wrap gap-2">{OVER_REASONS.map((r) => (
            <button key={r.code} type="button" disabled={busy === v.id} onClick={async () => { setBusy(v.id); await post({ tenantId, action: 'over-reason', appointmentId: v.id, code: r.code, via: 'staff portal' }); setBusy(null); setList((l) => l.filter((x) => x.id !== v.id)); }}
              className="h-10 rounded-full px-4 text-[13px] font-semibold disabled:opacity-40" style={dark ? { background: 'rgba(255,255,255,.1)' } : { background: 'var(--soft, #f3efe9)' }}>{r.label}</button>))}</div>
        </div>))}
      <p className="text-[12px]" style={{ color: dark ? 'rgba(255,255,255,.6)' : 'var(--muted, #78716c)' }}>Only you and the managers see this. “I ran behind” is never charged to the client.</p>
    </section>);
}
