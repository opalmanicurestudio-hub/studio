'use client';
// src/app/how/[tenantId]/[appointmentId]/page.tsx — "HOW WAS YOUR VISIT?" (lib/visit-feedback, /api/feedback). One private
// page per visit: loved it (→ leave a review), it was okay, or something wasn't right — what, in their own words or a
// voice note, photos, what would help — and from then on, where it is, the team's replies, and "Did we make it right?".
import * as React from 'react';
import { useParams, useSearchParams } from 'next/navigation';

type Info = any;
const MUTED = '#6d7075', LINE = '#ececee', SOFT = '#f5f5f6', RED = '#b42318', GREEN = '#1f6b3a';

async function shrink(file: File): Promise<string> {
  const img = await new Promise<HTMLImageElement>((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = URL.createObjectURL(file); });
  const max = 1400; const k = Math.min(1, max / Math.max(img.width, img.height)); const c = document.createElement('canvas');
  c.width = Math.round(img.width * k); c.height = Math.round(img.height * k); c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', 0.82);
}
const blobToDataUrl = (b: Blob, mime: string) => new Promise<string>((res) => { const r = new FileReader(); r.onload = () => res(`data:${mime};base64,${String(r.result).split(',')[1]}`); r.readAsDataURL(b); });

function Voice({ onDone, lang }: { onDone: (v: { blob: Blob; mime: string; seconds: number; transcript: string } | null) => void; lang: string }) {
  const [state, setState] = React.useState<'idle' | 'rec' | 'done'>('idle'); const [secs, setSecs] = React.useState(0); const [url, setUrl] = React.useState(''); const [heard, setHeard] = React.useState('');
  const rec = React.useRef<any>(null); const sr = React.useRef<any>(null); const timer = React.useRef<any>(null); const text = React.useRef('');
  const supported = typeof window !== 'undefined' && typeof (window as any).MediaRecorder !== 'undefined' && !!navigator.mediaDevices?.getUserMedia;
  if (!supported) return null;
  const stop = () => { try { rec.current?.stop(); } catch { /* already stopped */ } try { sr.current?.stop(); } catch { /* fine */ } clearInterval(timer.current); };
  const start = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mime = ['audio/webm', 'audio/mp4', 'audio/ogg'].find((m) => (window as any).MediaRecorder.isTypeSupported?.(m)) || 'audio/webm';
      const r = new (window as any).MediaRecorder(stream, { mimeType: mime }); const chunks: Blob[] = []; const t0 = Date.now();
      r.ondataavailable = (e: any) => e.data.size && chunks.push(e.data);
      r.onstop = () => { stream.getTracks().forEach((x) => x.stop()); const blob = new Blob(chunks, { type: mime }); setUrl(URL.createObjectURL(blob)); setState('done'); onDone({ blob, mime, seconds: Math.round((Date.now() - t0) / 1000), transcript: text.current.trim() }); };
      rec.current = r; r.start(); setState('rec'); setSecs(0); text.current = ''; setHeard('');
      timer.current = setInterval(() => setSecs((s) => { if (s + 1 >= 90) stop(); return s + 1; }), 1000);
      const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
      if (SR) { const s = new SR(); s.lang = lang; s.continuous = true; s.interimResults = false; s.onresult = (e: any) => { for (let i = e.resultIndex; i < e.results.length; i++) if (e.results[i].isFinal) text.current += ` ${e.results[i][0].transcript}`; setHeard(text.current.trim()); }; try { s.start(); sr.current = s; } catch { /* no live words — the recording still goes */ } }
    } catch { alert('We couldn’t use your microphone. You can type instead.'); }
  };
  return (
    <div className="space-y-2">
      {state === 'idle' && <button type="button" onClick={start} className="flex h-12 w-full items-center justify-center gap-2 rounded-2xl border text-[15px] font-semibold" style={{ borderColor: LINE }}><span className="inline-block h-3 w-3 rounded-full" style={{ background: RED }} />Or record a voice note</button>}
      {state === 'rec' && <button type="button" onClick={stop} className="flex h-12 w-full items-center justify-center gap-2 rounded-2xl text-[15px] font-semibold text-white" style={{ background: RED }}><span className="inline-block h-3 w-3 animate-pulse rounded-sm bg-white" />Recording {Math.floor(secs / 60)}:{String(secs % 60).padStart(2, '0')} — tap to stop</button>}
      {state === 'done' && <div className="space-y-2 rounded-2xl p-3" style={{ background: SOFT }}><audio controls src={url} className="w-full" />{heard && <p className="text-[13.5px]" style={{ color: MUTED }}>“{heard}”</p>}<button type="button" className="text-[14px] underline" onClick={() => { setState('idle'); setUrl(''); onDone(null); }}>Record again</button></div>}
      <p className="text-[12.5px]" style={{ color: MUTED }}>Any language is fine — we’ll translate it for the team.</p>
    </div>);
}


const tlabel = (t: string) => { const [h, m] = t.split(':').map(Number); return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`; };
const dlabel = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });

function RedoPicker({ post, redo, accent, onDone }: { post: (b: any) => Promise<any>; redo: any; accent: string; onDone: () => void }) {
  const [others, setOthers] = React.useState(false); const [data, setData] = React.useState<any>(null); const [who, setWho] = React.useState(''); const [day, setDay] = React.useState(''); const [time, setTime] = React.useState('');
  const [none, setNone] = React.useState(false); const [note, setNote] = React.useState(''); const [busy, setBusy] = React.useState(false); const [err, setErr] = React.useState('');
  const [open, setOpen] = React.useState(redo.state !== 'booked');
  React.useEffect(() => { if (!open) return; setData(null); post({ action: 'redo_times', others }).then((d) => { setData(d); const p0 = d.providers?.find((p: any) => p.days.length); setWho(p0?.staffId || ''); setDay(p0?.days[0]?.date || ''); setTime(''); }); }, [others]);   // eslint-disable-line react-hooks/exhaustive-deps
  const P = data?.providers?.find((p: any) => p.staffId === who); const D = P?.days.find((d: any) => d.date === day);
  const book = async () => { setBusy(true); setErr(''); const r = await post({ action: 'book_redo', staffId: who, date: day, time }); setBusy(false); if (r.ok) onDone(); else setErr(r.error || 'That didn’t book — try another time.'); };
  const anyTimes = (data?.providers || []).some((p: any) => p.days.length);
  if (!open) return <button type="button" onClick={() => setOpen(true)} className="h-12 w-full rounded-2xl text-[15px] font-semibold" style={{ background: SOFT }}>Need a different time?</button>;
  return (
    <div className="space-y-4 rounded-[20px] border p-5" style={{ borderColor: LINE }}>
      <p className="text-[17px] font-bold">{redo.state === 'booked' ? 'Need a different time?' : others ? 'Times with someone else' : `Pick a time${redo.provider ? ` with ${redo.provider}` : ''}`}</p>
      {!data ? <p className="text-[14px]" style={{ color: MUTED }}>Finding open times…</p> : !anyTimes ? <p className="text-[15px]">{others ? 'No one else has an opening soon.' : `${redo.provider || 'They'} has no openings in the next couple of weeks.`}</p> : <>
        {(data.providers || []).filter((p: any) => p.days.length).length > 1 && <div className="flex flex-wrap gap-2">{data.providers.filter((p: any) => p.days.length).map((p: any) => <button key={p.staffId} type="button" onClick={() => { setWho(p.staffId); setDay(p.days[0].date); setTime(''); }} className="h-10 rounded-full px-4 text-[14px] font-semibold" style={who === p.staffId ? { background: '#16171a', color: '#fff' } : { background: SOFT }}>{p.name}</button>)}</div>}
        <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">{(P?.days || []).map((d: any) => <button key={d.date} type="button" onClick={() => { setDay(d.date); setTime(''); }} className="h-12 shrink-0 rounded-2xl px-3.5 text-[14px] font-semibold" style={day === d.date ? { background: accent, color: '#fff' } : { background: SOFT }}>{dlabel(d.date)}</button>)}</div>
        <div className="grid grid-cols-3 gap-2">{(D?.times || []).slice(0, 18).map((t: string) => <button key={t} type="button" onClick={() => setTime(t)} className="h-11 rounded-xl text-[14.5px] font-semibold" style={time === t ? { background: '#16171a', color: '#fff' } : { border: `1px solid ${LINE}` }}>{tlabel(t)}</button>)}</div>
        {time && <button type="button" disabled={busy} onClick={book} className="h-14 w-full rounded-2xl text-[16px] font-bold text-white" style={{ background: accent }}>{busy ? 'Booking…' : `Book ${dlabel(day)} at ${tlabel(time)}`}</button>}</>}
      {err && <p className="text-[14px] font-semibold" style={{ color: RED }}>{err}</p>}
      {data && <div className="space-y-2 border-t pt-3" style={{ borderColor: LINE }}>
        {!others && <button type="button" onClick={() => setOthers(true)} className="block text-[15px] font-semibold underline underline-offset-2">None of these work — see someone else</button>}
        {others && <button type="button" onClick={() => setOthers(false)} className="block text-[15px] font-semibold underline underline-offset-2">Back to {redo.provider || 'the original provider'}</button>}
        {!none ? <button type="button" onClick={() => setNone(true)} className="block text-[15px] underline underline-offset-2" style={{ color: MUTED }}>Still nothing? Tell us when suits you</button> : <div className="space-y-2">
          <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} placeholder="e.g. Weekday evenings after 5, or Saturday mornings" className="w-full rounded-2xl border p-3 text-[15px]" style={{ borderColor: LINE }} />
          <button type="button" disabled={busy || !note.trim()} onClick={async () => { setBusy(true); await post({ action: 'redo_none', note }); setBusy(false); onDone(); }} className="h-12 w-full rounded-2xl text-[15px] font-bold" style={{ background: SOFT }}>Send — we’ll find a time with you</button></div>}
      </div>}
    </div>);
}

export default function HowWasItPage() {
  const p = useParams<{ tenantId: string; appointmentId: string }>(); const sp = useSearchParams();
  const tenantId = String(p?.tenantId || ''); const id = String(p?.appointmentId || ''); const k = sp?.get('k') || ''; const t = sp?.get('t') || '';
  const via = sp?.get('from') === 'visit' ? 'link' : 'survey'; const start = sp?.get('start');
  const [info, setInfo] = React.useState<Info | null>(null); const [err, setErr] = React.useState('');
  const [step, setStep] = React.useState<'ask' | 'loved' | 'okay' | 'report' | 'sent'>(start === 'report' ? 'report' : 'ask');
  const [reason, setReason] = React.useState(''); const [words, setWords] = React.useState(''); const [wants, setWants] = React.useState('');
  const [photos, setPhotos] = React.useState<string[]>([]); const [voice, setVoice] = React.useState<any>(null); const [busy, setBusy] = React.useState(''); const [cb, setCb] = React.useState('');
  const lang = typeof navigator !== 'undefined' ? (navigator.language || 'en') : 'en';
  const load = React.useCallback(() => fetch(`/api/feedback?tenantId=${encodeURIComponent(tenantId)}&id=${encodeURIComponent(id)}&k=${encodeURIComponent(k)}&t=${encodeURIComponent(t)}`).then((r) => r.json()).then((d) => (d.ok ? setInfo(d) : setErr(d.error || 'This link isn’t valid any more.'))).catch(() => setErr('We couldn’t load this page — check your connection.')), [tenantId, id, k, t]);
  React.useEffect(() => { load(); }, [load]);
  const post = (body: any) => fetch('/api/feedback', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tenantId, id, k, t, ...body }) }).then((r) => r.json()).catch(() => ({ ok: false, error: 'No connection — try again.' }));
  const A = info?.brand?.accent || '#16171a';

  const shell = (children: React.ReactNode) => (
    <div className="min-h-dvh bg-white px-4 pb-16 pt-8" style={{ color: '#16171a', fontFamily: 'system-ui, -apple-system, Segoe UI, sans-serif' }}>
      <div className="mx-auto w-full max-w-md space-y-6">
        {info && <header className="flex items-center gap-3">
          {info.brand.logo ? <img src={info.brand.logo} alt="" className="h-11 w-11 rounded-2xl object-cover" /> : <span className="flex h-11 w-11 items-center justify-center rounded-2xl text-[15px] font-bold text-white" style={{ background: A }}>{String(info.brand.name).split(/\s+/).slice(0, 2).map((w: string) => w[0]).join('').toUpperCase()}</span>}
          <span><span className="block text-[16px] font-bold">{info.brand.name}</span><span className="block text-[13.5px]" style={{ color: MUTED }}>{info.visit.service}{info.visit.provider ? ` with ${info.visit.provider}` : ''} · {info.visit.day}</span></span></header>}
        {children}
      </div>
    </div>);
  if (err) return shell(<p className="pt-10 text-center text-[16px] font-semibold">{err}</p>);
  if (!info) return shell(<p className="pt-10 text-center text-[15px]" style={{ color: MUTED }}>Loading…</p>);

  // A case exists: where it is.
  if (info.case) { const c = info.case; const steps = ['We’ve got it', 'Making it right', 'Did it work?', 'All done']; const at = { heard: 0, fixing: 1, check: 2, closed: 3 }[c.stage as string] ?? 0;
    return shell(<>
      <section className="space-y-4 rounded-[28px] p-6 text-white" style={{ background: A }}>
        <p className="text-[13px] font-semibold opacity-80">Your report · {c.number}</p>
        <h1 className="text-[28px] font-bold leading-tight">{c.stage === 'closed' ? 'Thank you for telling us.' : c.stage === 'check' ? 'Did we make it right?' : c.stage === 'fixing' ? 'Here’s what we’re doing.' : `We’ve got it, ${info.visit.clientFirst || 'and we’re on it'}.`}</h1>
        <ol className="grid grid-cols-4 gap-1.5">{steps.map((s, i) => <li key={s} className="space-y-1.5"><div className="h-1.5 rounded-full" style={{ background: i <= at ? '#fff' : 'rgba(255,255,255,.3)' }} /><p className="text-[11.5px] font-semibold leading-tight" style={{ opacity: i <= at ? 1 : 0.6 }}>{s}</p></li>)}</ol>
      </section>
      {c.stage === 'heard' && <div className="rounded-[20px] p-5 text-[15.5px] leading-relaxed" style={{ background: SOFT }}>{c.safety ? 'A manager has your report now and will call you. If you need medical help, please see a doctor or call 911.' : `${c.owner ? `${c.owner} is looking after this` : 'Someone from our team will look at this'}${c.replyBy ? ` and will reply by ${c.replyBy}` : ''}. You’ll hear from us by text, and this page updates too.`}</div>}
      {c.fix && <div className="space-y-1 rounded-[20px] border p-5" style={{ borderColor: LINE }}><p className="text-[12px] font-bold tracking-wide" style={{ color: MUTED }}>WHAT WE’RE DOING</p><p className="text-[17px] font-semibold leading-snug">{c.fix}</p></div>}
      {c.redo && c.redo.canChange && c.stage !== 'closed' && <RedoPicker post={post} redo={c.redo} accent={A} onDone={load} />}
      {c.redo?.state === 'needs_time' && c.redo.note && <p className="text-[14px]" style={{ color: MUTED }}>You told us: “{c.redo.note}”. We’ll be in touch.</p>}
      {c.replies.length > 0 && <div className="space-y-2.5">{c.replies.map((m: any, i: number) => <div key={i} className="rounded-[20px] rounded-tl-md p-4" style={{ background: SOFT }}><p className="text-[13px] font-bold" style={{ color: MUTED }}>{m.by}</p><p className="text-[15.5px] leading-snug">{m.text}</p></div>)}</div>}
      {c.stage === 'check' && !c.confirmed && <div className="space-y-3">
        <textarea value={cb} onChange={(e) => setCb(e.target.value)} rows={2} placeholder="Anything to add? (optional)" className="w-full rounded-2xl border p-3.5 text-[15px]" style={{ borderColor: LINE }} />
        <button type="button" disabled={!!busy} onClick={async () => { setBusy('y'); await post({ action: 'confirm', good: true, words: cb }); setBusy(''); load(); }} className="h-14 w-full rounded-2xl text-[16px] font-bold text-white" style={{ background: GREEN }}>Yes, it’s all good now</button>
        <button type="button" disabled={!!busy} onClick={async () => { setBusy('n'); await post({ action: 'confirm', good: false, words: cb }); setBusy(''); load(); }} className="h-14 w-full rounded-2xl text-[16px] font-bold" style={{ background: SOFT }}>It’s still not right</button></div>}
      {c.stage === 'check' && c.confirmed && <p className="text-center text-[15px]" style={{ color: GREEN }}>Thank you — so glad it’s sorted.</p>}
      <p className="text-center text-[13px]" style={{ color: MUTED }}>Keep this link — it always shows where your report is.</p>
    </>); }

  if (step === 'loved') return shell(<section className="space-y-4 pt-4 text-center">
    <p className="text-[48px] leading-none" aria-hidden>♥</p><h1 className="text-[28px] font-bold">That’s lovely to hear.</h1>
    {info.reviewUrl ? <><p className="text-[16px]" style={{ color: MUTED }}>Would you share it? A quick review helps {info.visit.provider || 'us'} more than you’d think.</p><a href={info.reviewUrl} className="flex h-14 items-center justify-center rounded-2xl text-[16px] font-bold text-white" style={{ background: A }}>Leave a review</a></> : <p className="text-[16px]" style={{ color: MUTED }}>Thank you for coming in — see you next time.</p>}
  </section>);
  if (step === 'okay') return shell(<section className="space-y-4 pt-4 text-center">
    <h1 className="text-[28px] font-bold">Thanks for telling us.</h1><p className="text-[16px]" style={{ color: MUTED }}>Is there something we could have done better?</p>
    <button type="button" onClick={() => setStep('report')} className="h-14 w-full rounded-2xl text-[16px] font-bold" style={{ background: SOFT }}>Yes — tell the team</button>
    <button type="button" onClick={() => setStep('loved')} className="text-[15px] underline" style={{ color: MUTED }}>No, it was fine</button>
  </section>);
  if (step === 'sent') return shell(<p className="pt-10 text-center" style={{ color: MUTED }}>Sending…</p>);

  if (step === 'ask') return shell(<>
    <h1 className="text-[32px] font-bold leading-tight tracking-tight">How was your visit{info.visit.clientFirst ? `, ${info.visit.clientFirst}` : ''}?</h1>
    <div className="space-y-3">
      {[['loved', 'Loved it', '♥'], ['okay', 'It was okay', '~'], ['report', 'Something wasn’t right', '!']].map(([k2, l, ic]) => (
        <button key={k2} type="button" disabled={!!busy} onClick={async () => { if (k2 === 'report') { setStep('report'); return; } setBusy(k2); await post({ action: 'rate', rating: k2 }); setBusy(''); setStep(k2 as any); }}
          className="flex h-[72px] w-full items-center gap-4 rounded-[22px] border px-5 text-left text-[18px] font-bold transition-transform active:scale-[0.98]" style={{ borderColor: LINE }}>
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-[20px] text-white" style={{ background: k2 === 'report' ? RED : A, opacity: k2 === 'okay' ? 0.55 : 1 }}>{ic}</span>{l}</button>))}
    </div>
    <p className="text-[13.5px]" style={{ color: MUTED }}>Only {info.brand.name} sees your answer.</p>
  </>);

  // Report
  if (!info.open) return shell(<p className="pt-6 text-[16px]">This visit can’t take a report here any more. Please call or message {info.brand.name} — they’ll want to hear from you.</p>);
  const R = info.reasons.find((r: any) => r.id === reason); const P = info.policy;
  const addPhotos = async (files: FileList | null) => { if (!files) return; for (const f of Array.from(files).slice(0, 6 - photos.length)) { setBusy('photo'); try { const d = await post({ action: 'upload', dataUrl: await shrink(f) }); if (d.ok) setPhotos((x) => [...x, d.url]); else alert(d.error); } catch { alert('That photo didn’t work — try another.'); } } setBusy(''); };
  const send = async () => {
    setBusy('send'); let v: any = null;
    if (voice) { const up = await post({ action: 'upload', dataUrl: await blobToDataUrl(voice.blob, voice.mime) }); if (up.ok) v = { url: up.url, transcript: voice.transcript, seconds: voice.seconds }; }
    const d = await post({ action: 'report', via, reasonId: reason, words, wants, photos, voice: v, lang: lang.slice(0, 2) }); setBusy('');
    if (d.ok) { setStep('sent'); load(); } else alert(d.error || 'That didn’t send — try again.');
  };
  return shell(<>
    <h1 className="text-[28px] font-bold leading-tight tracking-tight">We’re sorry. Let’s make it right.</h1>
    <section className="space-y-3"><p className="text-[13px] font-bold tracking-wide" style={{ color: MUTED }}>WHAT WASN’T RIGHT?</p>
      <div className="flex flex-wrap gap-2">{info.reasons.map((r: any) => <button key={r.id} type="button" onClick={() => setReason(r.id)} className="min-h-11 rounded-full px-4 text-[15px] font-semibold" style={reason === r.id ? { background: '#16171a', color: '#fff' } : { background: SOFT }}>{r.label}</button>)}</div>
      {R?.safety && <p className="rounded-2xl p-4 text-[15px] font-semibold" style={{ background: '#fdecec', color: RED }}>If you need medical help, please see a doctor or call 911 now. A manager will call you as soon as you send this.</p>}
    </section>
    <section className="space-y-3"><p className="text-[13px] font-bold tracking-wide" style={{ color: MUTED }}>IN YOUR OWN WORDS</p>
      <textarea value={words} onChange={(e) => setWords(e.target.value)} rows={4} placeholder="What happened, and when did you notice it?" className="w-full rounded-2xl border p-3.5 text-[16px]" style={{ borderColor: LINE }} />
      <Voice lang={lang} onDone={setVoice} /></section>
    <section className="space-y-3"><p className="text-[13px] font-bold tracking-wide" style={{ color: MUTED }}>PHOTOS{P.photos ? '' : ' (OPTIONAL)'}</p>
      {P.photos && <p className="text-[14px]" style={{ color: MUTED }}>Clear photos in good light help us fix it faster.</p>}
      <div className="flex flex-wrap gap-2">{photos.map((u) => <img key={u} src={u} alt="Your photo" className="h-20 w-20 rounded-2xl object-cover" />)}
        {photos.length < 6 && <label className="flex h-20 w-20 cursor-pointer items-center justify-center rounded-2xl border-2 border-dashed text-[28px]" style={{ borderColor: LINE, color: MUTED }}>{busy === 'photo' ? '…' : '+'}<input type="file" accept="image/*" multiple className="hidden" onChange={(e) => addPhotos(e.target.files)} /></label>}</div></section>
    <section className="space-y-3"><p className="text-[13px] font-bold tracking-wide" style={{ color: MUTED }}>WHAT WOULD HELP MOST?</p>
      <div className="grid gap-2">{(info.wants || []).map((w: any) => [w.id, w.label]).map(([k2, l]: string[]) => <button key={k2} type="button" onClick={() => setWants(k2)} className="h-12 rounded-2xl text-left px-4 text-[15.5px] font-semibold" style={wants === k2 ? { background: '#16171a', color: '#fff' } : { background: SOFT }}>{l}</button>)}</div></section>
    <section className="space-y-1.5 rounded-[20px] border p-4 text-[14.5px] leading-relaxed" style={{ borderColor: LINE }}>
      <p className="font-bold">How this works</p>
      <p>{P.replyHours ? `We’ll reply within ${P.replyHours} hours.` : 'Someone from the team will be in touch.'}</p>
      {P.redo && (P.withinWindow ? <p>Fixes are free within {P.windowDays} days of your visit — you’re within that.</p> : <p>It’s been more than {P.windowDays} days, so a manager will look at this personally.</p>)}
      {P.refund && P.refundToCard && <p>Any refund goes back to the card you paid with.</p>}
    </section>
    <button type="button" disabled={!!busy || (!reason && !words.trim() && !voice)} onClick={send} className="h-14 w-full rounded-2xl text-[17px] font-bold text-white disabled:opacity-40" style={{ background: A }}>{busy === 'send' ? 'Sending…' : 'Send to the team'}</button>
  </>);
}
