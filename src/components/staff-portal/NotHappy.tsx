'use client';
// src/components/staff-portal/NotHappy.tsx — "THEY WEREN'T HAPPY" on a finished visit in the staff app: the provider
// picks what went wrong, writes what the client said and what they've already done, and a Making it right case opens
// (lib/cases, via 'staff'). The desk and managers are told; safety reasons go straight to a manager.
import * as React from 'react';
import { doc, getDoc } from 'firebase/firestore';
import { settingsOf } from '@/lib/making-it-right';
import { payPost } from '@/components/pay/pay-client';

export function NotHappy({ apt, tenantId, firestore }: { apt: any; tenantId: string; firestore: any }) {
  const [open, setOpen] = React.useState(false); const [S, setS] = React.useState<any>(null);
  const [reason, setReason] = React.useState(''); const [words, setWords] = React.useState(''); const [did, setDid] = React.useState('');
  const [busy, setBusy] = React.useState(false); const [err, setErr] = React.useState(''); const [sent, setSent] = React.useState<string>('');
  React.useEffect(() => { if (!open || S) return; getDoc(doc(firestore, `tenants/${tenantId}`)).then((d) => setS(settingsOf(d.data() || {}))).catch(() => setS(settingsOf({}))); }, [open, S, firestore, tenantId]);
  if (S && S.channels?.staff === false) return null;
  const safety = !!S?.reasons.find((r: any) => r.id === reason)?.safety;
  const go = async () => { setBusy(true); setErr(''); const r = await payPost('/api/cases', { tenantId, action: 'open', via: 'staff', appointmentId: apt.id, clientId: apt.clientId || '', clientName: apt.clientName || '', reasonId: reason, words, providerAction: did }); setBusy(false); if (r.ok) setSent(r.number); else setErr(r.error || 'That didn’t send — try again.'); };

  if (sent) return <div className="rounded-2xl bg-emerald-50 p-4 text-[14px] text-emerald-900"><b>Sent — case {sent}.</b> {safety ? 'A manager has been told now.' : 'The desk will take it from here and keep you posted.'}</div>;
  if (!open) return <button onClick={() => setOpen(true)} className="w-full h-12 rounded-2xl border-2 border-rose-200 bg-rose-50 text-[13px] font-bold text-rose-700 active:scale-[0.97]">They weren’t happy</button>;
  return (
    <div className="space-y-3 rounded-2xl border-2 border-rose-200 bg-white p-4">
      <p className="text-[15px] font-bold text-slate-900">What went wrong?</p>
      {!S ? <p className="text-[13px] text-slate-500">Loading…</p> : <div className="flex flex-wrap gap-2">{S.reasons.filter((r: any) => r.on !== false).map((r: any) => (
        <button key={r.id} onClick={() => setReason(r.id)} className={`min-h-10 rounded-full px-3.5 text-[13px] font-semibold ${reason === r.id ? (r.safety ? 'bg-rose-700 text-white' : 'bg-slate-900 text-white') : r.safety ? 'bg-rose-50 text-rose-700' : 'bg-slate-100 text-slate-800'}`}>{r.label}</button>))}</div>}
      {safety && <p className="rounded-xl bg-rose-50 p-3 text-[13px] font-semibold text-rose-800">Safety — a manager is told straight away. Look after the client first; you’ll be asked for a short statement.</p>}
      <textarea value={words} onChange={(e) => setWords(e.target.value)} rows={2} placeholder="What did they say?" className="w-full rounded-xl border border-slate-200 p-3 text-[15px]" />
      <div className="flex flex-wrap gap-2">{['I fixed it before they left', 'Nothing yet — please call them', 'They want to come back'].map((t) => (
        <button key={t} onClick={() => setDid(did === t ? '' : t)} className={`min-h-9 rounded-full px-3 text-[12.5px] font-semibold ${did === t ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-700'}`}>{t}</button>))}</div>
      {err && <p className="text-[13px] font-semibold text-rose-700">{err}</p>}
      <div className="flex gap-2"><button onClick={go} disabled={busy || (!reason && !words.trim())} className="h-12 flex-1 rounded-2xl bg-slate-900 text-[14px] font-bold text-white disabled:opacity-40">{busy ? 'Sending…' : 'Send to the desk'}</button>
        <button onClick={() => setOpen(false)} className="h-12 rounded-2xl px-4 text-[14px] font-semibold text-slate-500">Cancel</button></div>
    </div>);
}
