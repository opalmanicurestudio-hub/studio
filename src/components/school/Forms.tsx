'use client';
// src/components/school/Forms.tsx — the school website's two forms.
//   TourPicker   day → open times (the business's one tour calendar) → book
//   InquiryForm  short; call / text / email; lands in Admissions or the inbox
import { useEffect, useMemo, useRef, useState } from 'react';

async function post(body: any) {
  const r = await fetch('/api/school', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return r.json().catch(() => ({ ok: false, error: 'No response — please try again.' }));
}
const field = 'h-12 w-full rounded-2xl border border-stone-200 bg-white px-4 text-[15px]';
const t12 = (hhmm: string) => { const [h, m] = hhmm.split(':').map(Number); return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`; };
const Honeypot = ({ v, set }: { v: string; set: (x: string) => void }) => <input tabIndex={-1} autoComplete="off" aria-hidden="true" value={v} onChange={(e) => set(e.target.value)} name="website" className="absolute -left-[9999px] h-0 w-0 opacity-0" />;

export function TourPicker({ tenantId, programs, programId }: { tenantId: string; programs: { id: string; name: string }[]; programId?: string }) {
  const days = useMemo(() => Array.from({ length: 21 }, (_, i) => { const d = new Date(); d.setDate(d.getDate() + i); return d; }), []);
  const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const [date, setDate] = useState(''); const [slots, setSlots] = useState<string[] | null>(null); const [off, setOff] = useState(false); const [auto, setAuto] = useState(true);
  const [time, setTime] = useState(''); const [f, setF] = useState({ name: '', email: '', phone: '', programId: programId || '', message: '' }); const [hp, setHp] = useState('');
  const [busy, setBusy] = useState(false); const [err, setErr] = useState(''); const [done, setDone] = useState<any>(null); const started = useRef(Date.now());
  const load = async (d: string) => { setDate(d); setTime(''); setSlots(null); setErr(''); const r = await post({ action: 'tour-slots', tenantId, date: d }); setSlots(r.ok ? r.slots : []); setOff(!!r.off); setAuto(r.autoConfirm !== false); };
  useEffect(() => { void load(iso(days[1])); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const book = async () => {
    setBusy(true); setErr('');
    const r = await post({ action: 'tour-book', tenantId, date, time, ...f, website: hp, elapsedMs: Date.now() - started.current, language: navigator.language?.slice(0, 2) });
    setBusy(false);
    if (r.ok) setDone(r); else { setErr(r.error || 'Couldn’t book that time.'); if (/taken/.test(r.error || '')) void load(date); }
  };
  if (done) return (
    <div className="sch-card sch-rise space-y-2 p-6 text-center" role="status">
      <p className="text-4xl">🎉</p><p className="text-2xl font-semibold">{done.status === 'confirmed' ? 'Your tour is booked' : 'Tour requested'}</p>
      <p className="text-stone-700">{done.when}</p>
      <p className="text-sm text-stone-600">{done.status === 'confirmed' ? (done.emailed ? 'We’ve emailed your confirmation, with a link to change or cancel.' : 'Save this time — we’ll see you then.') : 'We confirm each visit personally and will be in touch shortly.'}</p>
    </div>
  );
  if (off) return <div className="sch-card p-6"><p className="font-semibold">Tours are by arrangement right now</p><p className="text-stone-600">Send us a message below and we’ll find a time that works.</p></div>;
  return (
    <div className="sch-card space-y-4 p-5 sm:p-6">
      <div><p className="text-sm font-semibold">1. Choose a day</p>
        <div className="-mx-1 mt-2 flex gap-2 overflow-x-auto px-1 pb-1">{days.map((d) => { const v = iso(d); return <button key={v} type="button" onClick={() => load(v)} aria-pressed={date === v} className={`flex w-14 shrink-0 flex-col items-center rounded-2xl border py-2 text-[12px] ${date === v ? 'border-transparent text-white' : 'border-stone-200 bg-white'}`} style={date === v ? { background: 'var(--accent)' } : undefined}><span>{d.toLocaleDateString('en-US', { weekday: 'short' })}</span><span className="text-lg font-semibold">{d.getDate()}</span><span>{d.toLocaleDateString('en-US', { month: 'short' })}</span></button>; })}</div></div>
      <div><p className="text-sm font-semibold">2. Pick a time</p>
        {slots === null ? <p className="mt-2 text-sm text-stone-500">Finding open times…</p> : slots.length === 0 ? <p className="mt-2 text-sm text-stone-600">No tours that day — try another.</p> :
          <div className="mt-2 grid grid-cols-3 gap-2 sm:grid-cols-4">{slots.map((s) => <button key={s} type="button" onClick={() => setTime(s)} aria-pressed={time === s} className={`h-11 rounded-xl border text-sm ${time === s ? 'border-transparent text-white' : 'border-stone-200 bg-white'}`} style={time === s ? { background: 'var(--accent)' } : undefined}>{t12(s)}</button>)}</div>}</div>
      {time && <div className="sch-rise space-y-2"><p className="text-sm font-semibold">3. Your details</p>
        <Honeypot v={hp} set={setHp} />
        <input className={field} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Your name" autoComplete="name" aria-label="Your name" />
        <div className="grid gap-2 sm:grid-cols-2"><input className={field} value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} type="email" placeholder="Email" autoComplete="email" aria-label="Email" /><input className={field} value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} type="tel" placeholder="Phone" autoComplete="tel" aria-label="Phone" /></div>
        {programs.length > 1 && <select className={field} value={f.programId} onChange={(e) => setF({ ...f, programId: e.target.value })} aria-label="Program you’re interested in"><option value="">Which program interests you? (optional)</option>{programs.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>}
        {err && <p className="text-sm text-red-700" role="alert">{err}</p>}
        <button type="button" disabled={busy || !f.name || !(f.email.includes('@') || f.phone)} onClick={book} className="h-12 w-full rounded-full text-[15px] font-medium text-white disabled:opacity-50" style={{ background: 'var(--accent)' }}>{busy ? 'Booking…' : `${auto ? 'Book' : 'Request'} ${new Date(`${date}T12:00:00`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })} at ${t12(time)}`}</button>
        {!auto && <p className="text-[12px] text-stone-500">We confirm each visit personally.</p>}
      </div>}
    </div>
  );
}

const TOPICS: [string, string][] = [['admissions', 'Programs & admissions'], ['funding', 'Help finding funding'], ['scholarship', 'Scholarships'], ['donate', 'Giving to students'], ['sponsor', 'Business sponsorship'], ['general', 'Something else']];
export function InquiryForm({ tenantId, programs, topic, programId, respondHours, textOk }: { tenantId: string; programs: { id: string; name: string }[]; topic?: string; programId?: string; respondHours: number; textOk: boolean }) {
  const [f, setF] = useState({ topic: TOPICS.some(([k]) => k === topic) ? topic! : 'admissions', programId: programId || '', name: '', email: '', phone: '', contactBy: 'email', bestTime: '', message: '' });
  const [hp, setHp] = useState(''); const [busy, setBusy] = useState(false); const [err, setErr] = useState(''); const [done, setDone] = useState<any>(null); const started = useRef(Date.now());
  const send = async () => { setBusy(true); setErr(''); const r = await post({ action: 'inquiry', tenantId, ...f, website: hp, elapsedMs: Date.now() - started.current, language: navigator.language?.slice(0, 2) }); setBusy(false); if (r.ok) setDone(r); else setErr(r.error || 'Couldn’t send.'); };
  if (done) return <div className="sch-card sch-rise space-y-2 p-6 text-center" role="status"><p className="text-4xl">✉️</p><p className="text-2xl font-semibold">Thanks — we got it</p><p className="text-stone-700">We’ll {done.contactBy === 'email' ? 'email you' : done.contactBy === 'text' ? 'text you' : 'call you'} within {done.respondHours} hours.</p></div>;
  const needsPhone = f.contactBy !== 'email';
  return (
    <div className="sch-card space-y-3 p-5 sm:p-6">
      <Honeypot v={hp} set={setHp} />
      <select className={field} value={f.topic} onChange={(e) => setF({ ...f, topic: e.target.value })} aria-label="What’s it about?">{TOPICS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
      {['admissions', 'funding', 'scholarship'].includes(f.topic) && programs.length > 1 && <select className={field} value={f.programId} onChange={(e) => setF({ ...f, programId: e.target.value })} aria-label="Program"><option value="">Which program? (optional)</option>{programs.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>}
      <input className={field} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Your name" autoComplete="name" aria-label="Your name" />
      <fieldset><legend className="mb-1.5 text-sm font-semibold">Best way to reach you</legend>
        <div className="grid grid-cols-3 gap-2">{([['email', '✉️ Email'], ['call', '📞 Call'], ...(textOk ? [['text', '💬 Text']] : [])] as [string, string][]).map(([k, l]) => <button key={k} type="button" aria-pressed={f.contactBy === k} onClick={() => setF({ ...f, contactBy: k })} className={`h-11 rounded-xl border text-sm ${f.contactBy === k ? 'border-transparent text-white' : 'border-stone-200 bg-white'}`} style={f.contactBy === k ? { background: 'var(--accent)' } : undefined}>{l}</button>)}</div></fieldset>
      {needsPhone ? <input className={field} value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} type="tel" placeholder="Phone" autoComplete="tel" aria-label="Phone" /> : <input className={field} value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} type="email" placeholder="Email" autoComplete="email" aria-label="Email" />}
      {needsPhone && <input className={field} value={f.bestTime} onChange={(e) => setF({ ...f, bestTime: e.target.value })} placeholder="Best time (e.g. weekday evenings)" aria-label="Best time to reach you" />}
      <textarea value={f.message} onChange={(e) => setF({ ...f, message: e.target.value })} rows={3} placeholder="Your question (optional)" className="w-full rounded-2xl border border-stone-200 bg-white p-4 text-[15px]" aria-label="Your question" />
      {err && <p className="text-sm text-red-700" role="alert">{err}</p>}
      <button type="button" disabled={busy || !f.name || (needsPhone ? !f.phone : !f.email.includes('@'))} onClick={send} className="h-12 w-full rounded-full text-[15px] font-medium text-white disabled:opacity-50" style={{ background: 'var(--accent)' }}>{busy ? 'Sending…' : 'Send'}</button>
      <p className="text-[12px] text-stone-500">We reply within {respondHours} hours.</p>
    </div>
  );
}
