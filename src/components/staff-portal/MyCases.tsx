'use client';
// src/components/staff-portal/MyCases.tsx — ME → CLIENT CASES in the staff app: complaints and incidents about this
// provider's visits — what the client said, what's being done, the cause once a manager marks it, and THEIR SIDE (written
// or a voice note, any language, translated for the team). Only cases marked "the work" count in their numbers.
import * as React from 'react';
import { collection, query, where } from 'firebase/firestore';
import { useCollection, useMemoFirebase } from '@/firebase';
import { payPost } from '@/components/pay/pay-client';
import { Voice, blobToDataUrl } from '@/components/making-it-right/VoiceNote';
import { CAUSES, providerCaseStats } from '@/lib/making-it-right';
import { RenterCaseRun, RenterMirSettings } from '@/components/staff-portal/RenterCaseRun';

const stageWord = (c: any) => c.locked ? 'Closed' : c.status === 'done' ? 'Fix done' : c.fix ? (c.fix.redoAppointmentId ? 'Redo booked' : 'Fix chosen') : c.ownerName ? `With ${String(c.ownerName).split(' ')[0]}` : 'New';

export function MyCases({ firestore, tenantId, staffId, accent, onBack, isRenter = false }: { firestore: any; tenantId: string; staffId: string; accent: string; onBack: () => void; isRenter?: boolean }) {
  const q = useMemoFirebase(() => (firestore && tenantId && staffId ? query(collection(firestore, `tenants/${tenantId}/cases`), where('visit.providerId', '==', staffId)) : null), [firestore, tenantId, staffId]);
  const { data: own, isLoading } = useCollection<any>(q);
  // Cases where they're doing the client's fix (handed over from someone else).
  const q2 = useMemoFirebase(() => (firestore && tenantId && staffId ? query(collection(firestore, `tenants/${tenantId}/cases`), where('involvedStaffIds', 'array-contains', staffId)) : null), [firestore, tenantId, staffId]);
  const { data: involved } = useCollection<any>(q2);
  const data = React.useMemo(() => { const m = new Map<string, any>(); for (const x of [...(own || []), ...(involved || [])]) m.set(x.id, x); return [...m.values()]; }, [own, involved]);
  const [pick, setPick] = React.useState(''); const [text, setText] = React.useState(''); const [voice, setVoice] = React.useState<any>(null); const [busy, setBusy] = React.useState(false); const [msg, setMsg] = React.useState(''); const [rules, setRules] = React.useState(false);
  const lang = typeof navigator !== 'undefined' ? (navigator.language || 'en') : 'en';
  const list = (data || []).slice().sort((a: any, b: any) => (b.sideWanted === staffId ? 1 : 0) - (a.sideWanted === staffId ? 1 : 0) || String(b.createdAt).localeCompare(String(a.createdAt)));
  const c = list.find((x: any) => x.id === pick); const stats = providerCaseStats(list, staffId);
  const mySides = (c?.statements || []).filter((s: any) => s.staffId === staffId);
  const send = async () => {
    setBusy(true); setMsg(''); let v: any = null;
    if (voice) { const up = await payPost('/api/cases', { tenantId, action: 'upload', appointmentId: c.visit?.appointmentId || c.id, dataUrl: await blobToDataUrl(voice.blob, voice.mime) }); if (up.ok) v = { url: up.url, transcript: voice.transcript, seconds: voice.seconds }; }
    const r = await payPost('/api/cases', { tenantId, id: c.id, action: 'statement', text, voice: v, lang: lang.slice(0, 2) }); setBusy(false);
    if (r.ok) { setText(''); setVoice(null); setMsg('Added — the manager can see it.'); } else setMsg(r.error || 'That didn’t send.');
  };
  if (rules) return <RenterMirSettings tenantId={tenantId} accent={accent} onBack={() => setRules(false)} />;
  const runs = (x: any) => !!x?.renterCase && x.renterStaffId === staffId;
  return (
    <div className="space-y-3 pt-1">
      <button onClick={() => (c ? setPick('') : onBack())} className="text-[14px] font-semibold text-slate-500">‹ {c ? 'All cases' : 'Me'}</button>
      {!c ? <>
        <div className="flex items-center justify-between gap-2"><h2 className="text-[22px] font-extrabold">Client cases</h2>{isRenter && <button onClick={() => setRules(true)} className="h-9 rounded-full border border-[#ececee] px-3 text-[13px] font-semibold">Your rules</button>}</div>
        <div className="grid grid-cols-3 gap-2">{[[stats.total, 'About your visits'], [stats.counted, 'The work itself'], [stats.incidents, 'Incidents']].map(([n, l]) => <div key={String(l)} className="rounded-[18px] border border-[#ececee] bg-white p-3"><p className="text-[22px] font-extrabold">{n}</p><p className="text-[12px] text-[#6d7075]">{l}</p></div>)}</div>
        {!isRenter && <p className="text-[12.5px] text-[#6d7075]">Only cases a manager marks as “the work itself” count in your numbers.</p>}
        {isLoading && <p className="text-[14px] text-[#6d7075]">Loading…</p>}
        {!isLoading && !list.length && <p className="rounded-[18px] bg-[#f5f5f6] p-4 text-[14px]">Nothing here — no complaints or incidents on your visits.</p>}
        {list.map((x: any) => <button key={x.id} onClick={() => { setPick(x.id); setMsg(''); }} className="block w-full rounded-[18px] border border-[#ececee] bg-white p-3.5 text-left">
          <div className="flex items-start justify-between gap-2"><p className="truncate text-[15px] font-bold">{x.clientName}</p>{runs(x) && !x.locked && !x.fix ? <span className="shrink-0 rounded-full px-2 py-0.5 text-[11px] font-bold text-white" style={{ background: accent }}>TO HANDLE</span> : x.visit?.providerId !== staffId ? <span className="shrink-0 rounded-full bg-sky-100 px-2 py-0.5 text-[11px] font-bold text-sky-800">FIX WITH YOU</span> : x.sideWanted === staffId ? <span className="shrink-0 rounded-full px-2 py-0.5 text-[11px] font-bold text-white" style={{ background: accent }}>YOUR SIDE?</span> : x.kind === 'incident' ? <span className="shrink-0 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-bold text-amber-800">INCIDENT</span> : null}</div>
          <p className="truncate text-[13.5px]">{x.reasonLabel}</p><p className="text-[12px] text-[#6d7075]">{stageWord(x)} · {x.visit?.serviceName || ''}</p></button>)}
      </> : <>
        <h2 className="text-[22px] font-extrabold">{c.clientName}</h2>
        <p className="text-[14px]">{c.reasonLabel} · <span className="text-[#6d7075]">{stageWord(c)}</span></p>
        {c.kind !== 'incident' && <div className="space-y-1.5 rounded-[18px] bg-[#f5f5f6] p-4"><p className="text-[12px] font-bold text-[#6d7075]">WHAT THEY SAID</p>
          {c.words && <p className="text-[15px]">“{c.words}”</p>}{c.wordsEn && <p className="text-[14px] text-[#6d7075]">In English: {c.wordsEn}</p>}
          {(c.photos || []).length > 0 && <div className="flex gap-2 overflow-x-auto">{c.photos.map((u: string) => <img key={u} src={u} alt="Client photo" className="h-20 w-20 rounded-xl object-cover" />)}</div>}
          {c.voice?.url && <audio controls src={c.voice.url} className="w-full" />}</div>}
        {runs(c) && <RenterCaseRun c={c} tenantId={tenantId} accent={accent} />}
        {c.visit?.providerId !== staffId && <div className="rounded-[18px] border border-sky-200 bg-sky-50 p-4 text-[14px] text-sky-950"><p className="font-bold">You’re doing this client’s fix.</p><p>Their first visit{c.visit?.serviceName ? ` (${c.visit.serviceName})` : ''} didn’t go right. Read what they said, and take extra care with how you welcome them — check in with them before you start.</p></div>}
        {c.fix && !runs(c) && <p className="text-[14px]"><b>What we’re doing:</b> {c.fix.redo?.plan ? c.fix.redo.plan.names.join(' → ') : c.fix.label}</p>}
        {c.cause && <p className="text-[14px]"><b>Cause:</b> {(CAUSES as any)[c.cause]?.label}{(CAUSES as any)[c.cause]?.counts ? '' : ' — doesn’t count in your numbers'}</p>}
        {mySides.map((s: any, i: number) => <div key={i} className="rounded-[18px] border border-[#ececee] p-3 text-[14px]"><p className="text-[12px] font-bold text-[#6d7075]">YOUR SIDE · {new Date(s.at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</p>{s.text && <p>{s.text}</p>}{s.voice?.url && <audio controls src={s.voice.url} className="mt-1 w-full" />}</div>)}
        {!c.locked && !runs(c) && <div className="space-y-2 rounded-[18px] border border-[#ececee] bg-white p-4">
          <p className="text-[15px] font-bold">{c.visit?.providerId !== staffId ? 'Add a note for the team' : mySides.length ? 'Add more' : 'Your side'}</p>
          <p className="text-[12.5px] text-[#6d7075]">What happened from where you were. Any language — it’s translated for the team. It’s signed with your name.</p>
          <textarea value={text} onChange={(e) => setText(e.target.value)} rows={3} className="w-full rounded-xl border border-slate-200 p-3 text-[15px]" />
          <Voice lang={lang} onDone={setVoice} />
          <button onClick={send} disabled={busy || (!text.trim() && !voice)} className="h-12 w-full rounded-2xl text-[14px] font-bold text-white disabled:opacity-40" style={{ background: accent }}>{busy ? 'Sending…' : 'Send'}</button>
          {msg && <p className="text-[13px] font-semibold">{msg}</p>}</div>}
      </>}
    </div>);
}
