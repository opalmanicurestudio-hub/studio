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

// ── Giving (the school's own Stripe account) ─────────────────────────────
export function GiveForm({ tenantId, funds, nonprofit }: { tenantId: string; funds: string[]; nonprofit: boolean }) {
  const PRESETS = [2500, 5000, 10000, 25000];
  const [amt, setAmt] = useState(5000); const [other, setOther] = useState(''); const [fund, setFund] = useState(funds[0] || '');
  const [f, setF] = useState({ name: '', email: '', anonymous: false, business: false, businessName: '', showName: false, message: '' }); const [hp, setHp] = useState('');
  const [busy, setBusy] = useState(false); const [err, setErr] = useState(''); const started = useRef(Date.now());
  const cents = other ? Math.round((Number(other.replace(/[^0-9.]/g, '')) || 0) * 100) : amt;
  const go = async () => { setBusy(true); setErr(''); const r = await post({ action: 'donate', tenantId, amountCents: cents, fund, ...f, website: hp, elapsedMs: Date.now() - started.current }); if (r.ok && r.url) window.location.href = r.url; else { setBusy(false); setErr(r.error || 'Couldn’t start the payment.'); } };
  return (
    <div className="sch-card space-y-3 p-5 sm:p-6">
      <Honeypot v={hp} set={setHp} />
      <fieldset><legend className="mb-1.5 text-sm font-semibold">Amount</legend>
        <div className="grid grid-cols-4 gap-2">{PRESETS.map((c) => <button key={c} type="button" aria-pressed={!other && amt === c} onClick={() => { setAmt(c); setOther(''); }} className={`h-12 rounded-xl border text-[15px] ${!other && amt === c ? 'border-transparent text-white' : 'border-stone-200 bg-white'}`} style={!other && amt === c ? { background: 'var(--accent)' } : undefined}>${c / 100}</button>)}</div>
        <input className={`${field} mt-2`} inputMode="decimal" value={other} onChange={(e) => setOther(e.target.value)} placeholder="Other amount ($)" aria-label="Other amount" /></fieldset>
      {funds.length > 1 && <label className="block text-sm font-semibold">Where it goes<select className={`${field} mt-1`} value={fund} onChange={(e) => setFund(e.target.value)}>{funds.map((x) => <option key={x} value={x}>{x}</option>)}</select></label>}
      <input className={field} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Your name" autoComplete="name" aria-label="Your name" />
      <input className={field} value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} type="email" placeholder="Email (for your receipt)" autoComplete="email" aria-label="Email" />
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.business} onChange={(e) => setF({ ...f, business: e.target.checked })} /> This gift is from a business</label>
      {f.business && <input className={field} value={f.businessName} onChange={(e) => setF({ ...f, businessName: e.target.value })} placeholder="Business name" aria-label="Business name" />}
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.anonymous} onChange={(e) => setF({ ...f, anonymous: e.target.checked, showName: e.target.checked ? false : f.showName })} /> Keep my gift anonymous</label>
      {!f.anonymous && <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.showName} onChange={(e) => setF({ ...f, showName: e.target.checked })} /> Thank {f.business ? 'our business' : 'me'} by name on the website</label>}
      <textarea value={f.message} onChange={(e) => setF({ ...f, message: e.target.value })} rows={2} placeholder="A note for the students (optional)" className="w-full rounded-2xl border border-stone-200 bg-white p-4 text-[15px]" aria-label="A note" />
      {err && <p className="text-sm text-red-700" role="alert">{err}</p>}
      <button type="button" disabled={busy || cents < 500 || !f.name || !f.email.includes('@')} onClick={go} className="h-12 w-full rounded-full text-[15px] font-medium text-white disabled:opacity-50" style={{ background: 'var(--accent)' }}>{busy ? 'Opening secure payment…' : `Give $${(cents / 100).toLocaleString('en-US', { maximumFractionDigits: 2 })}`}</button>
      <p className="text-[12px] text-stone-500">Secure payment by Stripe. {nonprofit ? 'You’ll get an emailed receipt for your records.' : 'You’ll get an emailed receipt. Gifts to this school are not tax-deductible.'}</p>
    </div>
  );
}
export function GiftThanks({ tenantId, sessionId }: { tenantId: string; sessionId: string }) {
  const [r, setR] = useState<any>(null);
  useEffect(() => { let alive = true; (async () => { for (let i = 0; i < 8 && alive; i++) { const x = await post({ action: 'donate-confirm', tenantId, sessionId }); if (x.ok || !x.pending) { if (alive) setR(x); return; } await new Promise((res) => setTimeout(res, 1500)); } if (alive) setR({ ok: false, pending: true }); })(); return () => { alive = false; }; }, [tenantId, sessionId]);
  if (!r) return <div className="sch-card p-6 text-center" role="status">Confirming your gift…</div>;
  if (!r.ok) return <div className="sch-card p-6 text-center" role="status">{r.pending ? 'Your payment is still processing — your receipt will arrive by email shortly.' : 'We couldn’t confirm that payment. If you were charged, your receipt will still arrive by email.'}</div>;
  return (
    <div className="space-y-3">
      <div className="sch-card sch-rise space-y-2 p-6 text-center" role="status"><p className="text-4xl">💜</p><p className="text-2xl font-semibold">Thank you!</p><p className="text-stone-700">Your gift of ${(r.amountCents / 100).toLocaleString('en-US', { maximumFractionDigits: 2 })} to {r.fund} was received.</p><p className="text-sm text-stone-600">Receipt {r.receiptNo}{r.emailed ? ' — your thank-you letter and receipt are in your email.' : '.'}</p></div>
      {r.logoOffer && <SponsorLogo tenantId={tenantId} sessionId={sessionId} />}
    </div>
  );
}

/** After a business gift: add a logo for the sponsor wall (the school approves it first). */
function SponsorLogo({ tenantId, sessionId }: { tenantId: string; sessionId: string }) {
  const [logo, setLogo] = useState(''); const [url, setUrl] = useState(''); const [busy, setBusy] = useState(false); const [err, setErr] = useState(''); const [done, setDone] = useState(false);
  const pick = (f?: File | null) => { if (!f) return; setErr(''); const img = new Image(); img.onload = () => { const k = Math.min(1, 600 / Math.max(img.width, img.height)); const c = document.createElement('canvas'); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k); c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height); let out = c.toDataURL('image/png'); if (out.length > 380_000) out = c.toDataURL('image/jpeg', 0.85); if (out.length > 380_000) { setErr('That logo is too large — try a smaller file.'); return; } setLogo(out); }; img.onerror = () => setErr('That file isn’t an image we can read.'); img.src = URL.createObjectURL(f); };
  if (done) return <p className="sch-card p-5 text-center text-sm text-stone-700" role="status">✓ Thanks! Your logo will appear on our sponsor wall once our team has checked it.</p>;
  return (
    <div className="sch-card space-y-3 p-5">
      <div><p className="text-lg font-semibold">Add your logo to our sponsor wall</p><p className="text-sm text-stone-600">We’d love to thank your business publicly, with a link to your website.</p></div>
      <div className="flex items-center gap-3">
        <div className="flex h-20 w-32 shrink-0 items-center justify-center rounded-xl border border-dashed border-stone-300 bg-white">{logo ? <img src={logo} alt="Your logo" className="max-h-16 max-w-28 object-contain" /> : <span className="text-[12px] text-stone-400">Your logo</span>}</div>
        <label className="cursor-pointer rounded-full bg-white px-4 py-2.5 text-sm shadow-sm">{logo ? 'Change' : 'Upload logo'}<input type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={(e) => { pick(e.target.files?.[0]); e.target.value = ''; }} /></label>
      </div>
      <input className={field} value={url} onChange={(e) => setUrl(e.target.value)} placeholder="Your website (optional)" inputMode="url" aria-label="Your website" />
      {err && <p className="text-sm text-red-700" role="alert">{err}</p>}
      <button type="button" disabled={busy || !logo} onClick={async () => { setBusy(true); setErr(''); const r = await post({ action: 'sponsor-logo', tenantId, sessionId, logo, url }); setBusy(false); if (r.ok) setDone(true); else setErr(r.error || 'Couldn’t save.'); }} className="h-12 w-full rounded-full text-[15px] font-medium text-white disabled:opacity-50" style={{ background: 'var(--accent)' }}>{busy ? 'Saving…' : 'Send our logo'}</button>
    </div>
  );
}

// ── Scholarship application ──────────────────────────────────────────────
export function ScholarshipForm({ tenantId, scholarship, programs }: { tenantId: string; scholarship: string; programs: { id: string; name: string }[] }) {
  const [open, setOpen] = useState(false); const [f, setF] = useState({ name: '', email: '', phone: '', programId: '', why: '', need: '', goals: '' }); const [hp, setHp] = useState('');
  const [busy, setBusy] = useState(false); const [err, setErr] = useState(''); const [done, setDone] = useState(false); const started = useRef(Date.now());
  if (done) return <p className="rounded-2xl bg-emerald-50 p-4 text-sm text-emerald-900" role="status">✓ Application sent — we’ve emailed you a copy of what happens next.</p>;
  if (!open) return <button type="button" onClick={() => setOpen(true)} className="mt-1 rounded-full px-5 py-3 text-sm font-medium text-white" style={{ background: 'var(--accent)' }}>Apply for this scholarship</button>;
  return (
    <div className="space-y-2 pt-2">
      <Honeypot v={hp} set={setHp} />
      <input className={field} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Your name" autoComplete="name" aria-label="Your name" />
      <div className="grid gap-2 sm:grid-cols-2"><input className={field} value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} type="email" placeholder="Email" autoComplete="email" aria-label="Email" /><input className={field} value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} type="tel" placeholder="Phone (optional)" autoComplete="tel" aria-label="Phone" /></div>
      {programs.length > 1 && <select className={field} value={f.programId} onChange={(e) => setF({ ...f, programId: e.target.value })} aria-label="Program"><option value="">Which program?</option>{programs.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>}
      {([['why', 'Why are you applying?'], ['need', 'What would this scholarship make possible? (optional)'], ['goals', 'Your goals after graduating (optional)']] as const).map(([k, l]) => <textarea key={k} value={(f as any)[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} rows={3} placeholder={l} aria-label={l} className="w-full rounded-2xl border border-stone-200 bg-white p-4 text-[15px]" />)}
      {err && <p className="text-sm text-red-700" role="alert">{err}</p>}
      <button type="button" disabled={busy || !f.name || !f.email.includes('@') || f.why.trim().length < 30} onClick={async () => { setBusy(true); setErr(''); const r = await post({ action: 'scholarship-apply', tenantId, scholarship, ...f, website: hp, elapsedMs: Date.now() - started.current }); setBusy(false); if (r.ok) setDone(true); else setErr(r.error || 'Couldn’t send.'); }} className="h-12 w-full rounded-full text-[15px] font-medium text-white disabled:opacity-50" style={{ background: 'var(--accent)' }}>{busy ? 'Sending…' : 'Send application'}</button>
      <p className="text-[12px] text-stone-500">Applying doesn’t guarantee an award. Your answers are only seen by the school’s review team.</p>
    </div>
  );
}
