'use client';
// src/components/staff-portal/SomethingHappened.tsx — "SOMETHING HAPPENED" on a visit in the staff app (lib/incidents):
// what happened, what to do right now, the provider's own words or a voice note (any language), "I need a few minutes"
// (the running-late alerts tell the next clients), and pulling the kit in use out of service. A manager is told at once.
import * as React from 'react';
import { payPost } from '@/components/pay/pay-client';
import { Voice, blobToDataUrl } from '@/components/making-it-right/VoiceNote';

const TYPES: { id: string; label: string; short: string; tone: string; steps: string[] }[] = [
  { id: 'injury', label: 'Injury', short: 'A cut, burn or wound', tone: '#b42318', steps: ['Stop the service.', 'Gloves on — clean gauze and gentle pressure.', 'Clean and cover it. Don’t carry on until it’s stopped.', 'If it won’t stop or looks deep, get a manager and call 911.'] },
  { id: 'reaction', label: 'Reaction', short: 'To a product', tone: '#b42318', steps: ['Stop and take the product off.', 'Rinse with cool water.', 'Ask about itching, swelling or breathing.', 'Trouble breathing or a swollen face or lips — call 911 now.'] },
  { id: 'unwell', label: 'Client unwell', short: 'Faint, dizzy, sick', tone: '#b42318', steps: ['Stop. Help them sit or lie down.', 'Offer water and fresh air.', 'Stay with them.', 'Chest pain, fainting or confusion — call 911 now.'] },
  { id: 'equipment', label: 'Equipment or product', short: 'Broke, faulty, wrong', tone: '#b54708', steps: ['Stop using it and set it aside.', 'Tell the client what happened.', 'Don’t use it again until a manager checks it.'] },
  { id: 'behaviour', label: 'Client behaviour', short: 'Rude, unsafe, inappropriate', tone: '#55585e', steps: ['You can stop the service.', 'Step away to somewhere you feel safe.', 'Get a manager or the desk.', 'If you feel unsafe, call 911.'] },
];

export function SomethingHappened({ apt, tenantId, onDone }: { apt: any; tenantId: string; onDone?: () => void }) {
  const [open, setOpen] = React.useState(false); const [type, setType] = React.useState(''); const [words, setWords] = React.useState(''); const [voice, setVoice] = React.useState<any>(null);
  const [mins, setMins] = React.useState(0); const [pull, setPull] = React.useState(true); const [stopped, setStopped] = React.useState(false); const [busy, setBusy] = React.useState(false); const [err, setErr] = React.useState(''); const [done, setDone] = React.useState<any>(null);
  const lang = typeof navigator !== 'undefined' ? (navigator.language || 'en') : 'en'; const T = TYPES.find((t) => t.id === type);
  const live = ['servicing', 'ready_for_checkout'].includes(String(apt.status));
  const send = async () => {
    setBusy(true); setErr(''); let v: any = null;
    if (voice) { const up = await payPost('/api/cases', { tenantId, action: 'upload', appointmentId: apt.id, dataUrl: await blobToDataUrl(voice.blob, voice.mime) }); if (up.ok) v = { url: up.url, transcript: voice.transcript, seconds: voice.seconds }; }
    const r = await payPost('/api/cases', { tenantId, action: 'incident', appointmentId: apt.id, type, words, voice: v, lang: lang.slice(0, 2), extraMinutes: mins, pullKit: pull, stopped });
    setBusy(false); if (r.ok) { setDone(r); onDone?.(); } else setErr(r.error || 'That didn’t send — tell a manager in person.');
  };
  if (done) return <div className="space-y-1 rounded-2xl bg-emerald-50 p-4 text-[14px] text-emerald-900"><p className="font-bold">A manager has been told{done.number ? ` — case ${done.number}` : ''}.</p>{done.kit && <p>{done.kit} is out of service until a manager checks it.</p>}{mins > 0 && <p>Your next clients will be told you’re running {mins} min behind.</p>}<p>You can add more in Me → Client cases.</p></div>;
  if (!open) return <button onClick={() => setOpen(true)} className="w-full h-12 rounded-2xl border-2 border-amber-200 bg-amber-50 text-[13px] font-bold text-amber-800 active:scale-[0.97]">Something happened</button>;
  return (
    <div className="space-y-3 rounded-2xl border-2 border-amber-200 bg-white p-4">
      {!T ? <>
        <p className="text-[15px] font-bold text-slate-900">What happened?</p>
        <div className="grid grid-cols-2 gap-2">{TYPES.map((t) => <button key={t.id} onClick={() => { setType(t.id); setPull(t.id === 'injury' || t.id === 'reaction'); }} className="rounded-2xl border border-slate-200 p-3 text-left active:scale-[0.97]"><span className="block text-[14px] font-bold" style={{ color: t.tone }}>{t.label}</span><span className="block text-[12px] text-slate-500">{t.short}</span></button>)}</div>
        <button onClick={() => setOpen(false)} className="h-10 w-full text-[13px] font-semibold text-slate-500">Cancel</button>
      </> : <>
        <div className="flex items-center justify-between"><p className="text-[15px] font-bold" style={{ color: T.tone }}>{T.label}</p><button onClick={() => setType('')} className="text-[12px] font-semibold text-slate-500 underline">Change</button></div>
        <ol className="space-y-1.5 rounded-xl p-3" style={{ background: '#fff7e6' }}>{T.steps.map((s, i) => <li key={i} className="flex gap-2 text-[13.5px] text-slate-800"><b>{i + 1}.</b>{s}</li>)}</ol>
        <textarea value={words} onChange={(e) => setWords(e.target.value)} rows={3} placeholder="What happened? Write it in your own words — any language." className="w-full rounded-xl border border-slate-200 p-3 text-[15px]" />
        <Voice lang={lang} onDone={setVoice} />
        {(live || type !== 'behaviour') && <div className="space-y-1.5"><p className="text-[12.5px] font-bold text-slate-500">I NEED A FEW MINUTES</p>
          <div className="flex flex-wrap gap-2">{[0, 10, 15, 30].map((m) => <button key={m} onClick={() => setMins(m)} className={`h-9 rounded-full px-3.5 text-[13px] font-semibold ${mins === m ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-700'}`}>{m ? `${m} min` : 'No'}</button>)}</div>
          {mins > 0 && <p className="text-[12px] text-slate-500">Your next clients and anyone sharing their booking are told you’re running behind.</p>}</div>}
        {type !== 'behaviour' && <label className="flex items-center gap-2 text-[13.5px] text-slate-700"><input type="checkbox" checked={pull} onChange={(e) => setPull(e.target.checked)} className="h-5 w-5" />Take the kit I was using out of service</label>}
        {type === 'behaviour' && <label className="flex items-center gap-2 text-[13.5px] text-slate-700"><input type="checkbox" checked={stopped} onChange={(e) => setStopped(e.target.checked)} className="h-5 w-5" />I stopped the service</label>}
        {err && <p className="text-[13px] font-semibold text-rose-700">{err}</p>}
        <div className="flex gap-2"><button onClick={send} disabled={busy || (!words.trim() && !voice)} className="h-12 flex-1 rounded-2xl text-[14px] font-bold text-white disabled:opacity-40" style={{ background: T.tone }}>{busy ? 'Sending…' : 'Tell a manager now'}</button>
          <button onClick={() => { setOpen(false); setType(''); }} className="h-12 rounded-2xl px-4 text-[14px] font-semibold text-slate-500">Cancel</button></div>
      </>}
    </div>);
}
