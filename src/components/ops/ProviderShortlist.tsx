'use client';
// src/components/ops/ProviderShortlist.tsx — WHO COULD TAKE THIS CLIENT? (desk + Needs attention)
// The ranked shortlist from the server (eligible first, then fair turn — each with its reason). Renters, and
// employees when the business chose "ask first", are ASKED before the client sees anything; nobody who must be
// asked can be switched in directly.
import * as React from 'react';
import { getAuth } from 'firebase/auth';

async function post(body: any) {
  const tk = await getAuth().currentUser?.getIdToken().catch(() => '') || '';
  return fetch('/api/appointments/provider-offer', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(tk ? { Authorization: `Bearer ${tk}` } : {}) }, body: JSON.stringify(body) })
    .then((r) => r.json()).catch(() => ({ ok: false, error: 'We couldn’t reach the server.' }));
}

export function ProviderShortlist({ tenantId, appointmentId, startAt, clientFirst, tell = true, onDirectSwitch, onDone, limit = 4 }: {
  tenantId: string; appointmentId: string; startAt: string; clientFirst?: string; tell?: boolean;
  onDirectSwitch?: (s: { id: string; name: string }) => void; onDone?: (msg: string) => void; limit?: number;
}) {
  const [list, setList] = React.useState<any[] | null>(null); const [employees, setEmployees] = React.useState<'assign' | 'ask'>('assign');
  const [answerMin, setAnswerMin] = React.useState(10); const [busy, setBusy] = React.useState<string | null>(null); const [msg, setMsg] = React.useState<string | null>(null);
  React.useEffect(() => { let live = true; setList(null);
    post({ tenantId, appointmentId, action: 'suggest', startAt }).then((r: any) => { if (!live) return; setList(r?.ok ? r.suggestions || [] : []); if (r?.settings) { setEmployees(r.settings.employees); setAnswerMin(r.settings.answerMinutes); } });
    return () => { live = false; }; }, [tenantId, appointmentId, startAt]);
  if (list === null) return <p className="text-[13px] opacity-70">Finding who could take them…</p>;
  if (!list.length) return <p className="text-[13px] opacity-70">No one else is free for the whole visit then.</p>;
  const first = (n: string) => String(n || '').split(' ')[0];
  const offer = async (s: any) => {
    setBusy(s.staffId); setMsg(null);
    const r: any = await post({ tenantId, appointmentId, action: 'offer', toStaffId: s.staffId, startAt, tell });
    setBusy(null);
    const text = !r?.ok ? r?.error || 'That didn’t go through.'
      : r.asked ? `Asked ${first(s.name)} — they have ${answerMin} minutes to answer. ${clientFirst || 'The client'} isn’t told anything unless ${first(s.name)} accepts.`
      : `Offered ${first(s.name)} — ${clientFirst || 'the client'} can accept or decline on their link${r.told ? '' : ' (not messaged — tell them yourself)'}.`;
    setMsg(text); if (r?.ok) onDone?.(text);
  };
  return (
    <div className="space-y-1.5">
      {list.slice(0, limit).map((s: any) => {
        const ask = s.isRenter || employees === 'ask';
        return <div key={s.staffId} className="space-y-1 rounded-2xl border p-2.5">
          <p className="text-[13px]">{s.reason}</p>
          <div className="flex flex-wrap gap-1.5">
            <button type="button" disabled={!!busy} onClick={() => offer(s)} className="rounded-full bg-primary px-3 py-1.5 text-[13px] font-semibold text-primary-foreground disabled:opacity-50" style={{ background: 'var(--accent, hsl(var(--primary)))', color: 'var(--accent-ink, #fff)' }}>
              {busy === s.staffId ? 'Sending…' : ask ? `Ask ${first(s.name)}` : `Offer ${first(s.name)} to them`}</button>
            {!ask && onDirectSwitch && <button type="button" disabled={!!busy} onClick={() => onDirectSwitch({ id: s.staffId, name: s.name })} className="rounded-full border px-3 py-1.5 text-[13px]">They’ve agreed — switch to {first(s.name)}</button>}
          </div>
        </div>;
      })}
      {msg && <p className="text-[13px] font-semibold">{msg}</p>}
    </div>
  );
}

/** Keep asks moving: expire any whose answer time has passed (called while the desk is open). */
export async function tickProviderAsks(tenantId: string, appts: any[]) {
  const due = (appts || []).filter((a: any) => a?.providerOffer?.status === 'asking_provider' && Date.parse(a.providerOffer.answerBy || '') <= Date.now());
  for (const a of due.slice(0, 5)) await post({ tenantId, appointmentId: a.id, action: 'tick' });
}
