'use client';
// src/components/staff-portal/ForgotClockOut.tsx — "YOU DIDN'T CLOCK OUT ON THURSDAY". Shows on the portal's Today for any
// shift in the last three weeks that never got a clock-out: when they clocked in, when the shift was due to end, and a
// quick pick for when they left. Sent to a manager (/api/timeclock/fix); waiting ones say so until they're decided.
import * as React from 'react';
import { collection, query, where } from 'firebase/firestore';
import { getAuth } from 'firebase/auth';
import { useCollection, useMemoFirebase } from '@/firebase';
import { sessionsFrom, clockPolicy } from '@/lib/timeclock';

const INK = '#16171a', MUTED = '#6d7075', LINE = '#ececee';
const hm = (t: number) => new Date(t).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
const day = (t: number) => new Date(t).toLocaleDateString([], { weekday: 'long' });
const toLocalInput = (t: number) => { const d = new Date(t); const p = (n: number) => String(n).padStart(2, '0'); return `${p(d.getHours())}:${p(d.getMinutes())}`; };

export function ForgotClockOut({ firestore, tenantId, staffId, tenant, shifts, accent = INK }: { firestore: any; tenantId: string; staffId: string; tenant: any; shifts: any[]; accent?: string }) {
  const punchesQ = useMemoFirebase(() => (!firestore || !tenantId || !staffId) ? null : query(collection(firestore, `tenants/${tenantId}/activityLogs`), where('staffId', '==', staffId)), [firestore, tenantId, staffId]);
  const fixesQ = useMemoFirebase(() => (!firestore || !tenantId || !staffId) ? null : query(collection(firestore, `tenants/${tenantId}/clockFixes`), where('staffId', '==', staffId)), [firestore, tenantId, staffId]);
  const { data: punches } = useCollection<any>(punchesQ); const { data: fixes } = useCollection<any>(fixesQ);
  const since = Date.now() - 21 * 86400000;
  const missing = React.useMemo(() => sessionsFrom((punches || []) as any, clockPolicy(tenant)).filter((s: any) => s.missingOut && s.inId && Date.parse(s.inAt) > since).sort((a: any, b: any) => Date.parse(b.inAt) - Date.parse(a.inAt)), [punches, tenant, since]);
  const fixOf = (id: string) => (fixes || []).find((f: any) => f.id === id);
  const open = missing.filter((s: any) => !fixOf(s.inId) || fixOf(s.inId).status === 'declined');
  const waiting = missing.filter((s: any) => fixOf(s.inId)?.status === 'pending');
  const s: any = open[0];
  const [pick, setPick] = React.useState<string>(''); const [other, setOther] = React.useState(''); const [note, setNote] = React.useState('');
  const [busy, setBusy] = React.useState(false); const [msg, setMsg] = React.useState(''); const [err, setErr] = React.useState('');
  React.useEffect(() => { setPick(''); setOther(''); setNote(''); setErr(''); setMsg(''); }, [s?.inId]);
  if (!s && !waiting.length) return null;

  const inMs = s ? Date.parse(s.inAt) : 0;
  const localDay = s ? new Date(inMs).toLocaleDateString('en-CA') : '';
  const shift = s ? (shifts || []).find((x: any) => x.staffId === staffId && x.date === localDay && x.status !== 'cancelled') : null;
  const at = (hhmm: string) => { const [h, m] = hhmm.split(':').map(Number); const d = new Date(inMs); d.setHours(h, m, 0, 0); let t = d.getTime(); if (t <= inMs) t += 86400000; return t; };
  const shiftEnd = shift?.endTime ? at(String(shift.endTime)) : null;
  const choices = shiftEnd ? [{ k: 'end', l: hm(shiftEnd), t: shiftEnd }, { k: 'end15', l: hm(shiftEnd + 15 * 60000), t: shiftEnd + 15 * 60000 }] : [];
  const chosenMs = pick === 'other' ? (other ? at(other) : NaN) : choices.find((c) => c.k === pick)?.t ?? NaN;
  const send = async () => {
    if (!Number.isFinite(chosenMs)) { setErr('Pick when you left.'); return; }
    setBusy(true); setErr('');
    try {
      const tk = await getAuth().currentUser?.getIdToken().catch(() => '');
      const r = await fetch('/api/timeclock/fix', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(tk ? { Authorization: `Bearer ${tk}` } : {}) }, body: JSON.stringify({ tenantId, action: 'submit', inId: s.inId, outAt: new Date(chosenMs).toISOString(), note }) }).then((x) => x.json()).catch(() => ({ ok: false, error: 'No connection — try again.' }));
      if (!r.ok) { setErr(r.error || 'That didn’t send.'); return; }
      setMsg(r.message || 'Sent to your manager.');
    } finally { setBusy(false); }
  };

  return (
    <div className="space-y-2">
      {s && (
        <section aria-label="Missing clock-out" className="space-y-3 rounded-[24px] border p-4" style={{ borderColor: '#f3dfb8', background: 'linear-gradient(180deg, #fdf6ea, #fff 60%)' }}>
          <div><p className="text-[18px] font-extrabold leading-tight">You didn’t clock out on {day(inMs)}</p>
            <p className="mt-1 text-[14px]" style={{ color: MUTED }}>Tell us when you left and your manager will check it. Until then those hours aren’t in your pay.</p></div>
          {fixOf(s.inId)?.status === 'declined' && <p className="text-[13px] font-medium" style={{ color: '#b42318' }}>Your last answer wasn’t approved{fixOf(s.inId)?.decisionNote ? `: “${fixOf(s.inId).decisionNote}”` : ''}. Try again or talk to your manager.</p>}
          <div className="divide-y rounded-[16px]" style={{ background: '#f6f6f7', borderColor: LINE }}>
            <div className="flex justify-between px-3.5 py-2.5 text-[14px]"><span style={{ color: MUTED }}>Clocked in</span><span className="font-bold">{hm(inMs)}</span></div>
            {shiftEnd && <div className="flex justify-between px-3.5 py-2.5 text-[14px]"><span style={{ color: MUTED }}>Shift was until</span><span className="font-bold">{hm(shiftEnd)}</span></div>}
          </div>
          {msg ? <p className="rounded-[14px] px-3.5 py-3 text-[14px] font-semibold" style={{ background: '#e6f2ec', color: '#1f6b3a' }}>{msg}</p> : (<>
            <p className="text-[15px] font-bold">When did you leave?</p>
            <div role="radiogroup" aria-label="When did you leave" className="grid grid-cols-3 gap-2">
              {choices.map((c) => <button key={c.k} type="button" role="radio" aria-checked={pick === c.k} onClick={() => setPick(c.k)} className="h-12 rounded-[14px] text-[15px] font-bold" style={pick === c.k ? { border: `2px solid ${accent}`, background: `${accent}14` } : { border: '1px solid #e6e6e8', background: '#fff' }}>{c.l}</button>)}
              <button type="button" role="radio" aria-checked={pick === 'other'} onClick={() => { setPick('other'); if (!other) setOther(toLocalInput(shiftEnd || inMs + 8 * 3600000)); }} className="h-12 rounded-[14px] text-[15px] font-semibold" style={pick === 'other' ? { border: `2px solid ${accent}`, background: `${accent}14` } : { border: '1px solid #e6e6e8', background: '#fff' }}>Other time</button>
            </div>
            {pick === 'other' && <input type="time" value={other} onChange={(e) => setOther(e.target.value)} aria-label="Time you left" className="h-12 w-full rounded-[14px] border px-3 text-[16px]" style={{ borderColor: '#e6e6e8' }} />}
            <input value={note} onChange={(e) => setNote(e.target.value)} aria-label="Anything your manager should know (optional)" placeholder="Anything your manager should know? (optional)" className="h-12 w-full rounded-[14px] border px-3 text-[15px]" style={{ borderColor: '#e6e6e8' }} />
            {err && <p role="alert" className="text-[13px] font-medium" style={{ color: '#b42318' }}>{err}</p>}
            <button type="button" disabled={busy} onClick={send} className="h-12 w-full rounded-[16px] text-[16px] font-bold text-white disabled:opacity-50" style={{ background: INK }}>Send to my manager</button>
          </>)}
          {open.length > 1 && <p className="text-[12px]" style={{ color: MUTED }}>{open.length - 1} more shift{open.length > 2 ? 's' : ''} without a clock-out after this one.</p>}
        </section>)}
      {waiting.map((w: any) => (
        <p key={w.inId} className="rounded-[16px] px-4 py-3 text-[14px]" style={{ background: '#f6f6f7' }}>Waiting for your manager: your clock-out on {day(Date.parse(w.inAt))} ({hm(Date.parse(fixOf(w.inId).outAt))}).</p>))}
    </div>);
}
