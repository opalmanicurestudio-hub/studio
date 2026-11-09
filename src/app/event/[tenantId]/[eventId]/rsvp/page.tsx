'use client';
// src/app/event/[tenantId]/[eventId]/rsvp/page.tsx — THE MEAL ORDER PAGE: a guest chooses their meal (one dish per
// course), says what the kitchen should avoid, and gives their table. It lands on their entry in the event's guest list
// (the manifest, kitchen tickets and seating chart read it), or adds them. Saved through /api/public/event; a seat's QR
// code from the manifest opens it with the table and seat filled in.
import * as React from 'react';
import { Suspense } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import { BusinessHead, Button, CARD, INK, INPUT, LABEL, LINE, MUTED, Note, PinForm, AMBER, Shell, askEvent, savePin, savedPin, whenLabel } from '@/components/events/guest-shell';
import { SEVERITY_LABEL, seatFromCode } from '@/lib/event-guest-link';

type Step = 'you' | 'meal' | 'avoid' | 'done';
const pill = (on: boolean): React.CSSProperties => on ? { background: INK, color: '#fff', borderColor: INK } : { background: '#fff', borderColor: LINE };

function MealOrder() {
  const { tenantId, eventId } = useParams() as { tenantId: string; eventId: string }; const q = useSearchParams(); const qTable = q.get('table') || '', qSeat = q.get('seat') || '';
  const [d, setD] = React.useState<any>(null); const [err, setErr] = React.useState('');
  const [pin, setPin] = React.useState(''); const [pinBusy, setPinBusy] = React.useState(false);
  const [step, setStep] = React.useState<Step>('you');
  const [name, setName] = React.useState(''); const [email, setEmail] = React.useState(''); const [phone, setPhone] = React.useState('');
  const [table, setTable] = React.useState(''); const [seat, setSeat] = React.useState('');
  const [picks, setPicks] = React.useState<Record<number, string>>({});
  const [avoid, setAvoid] = React.useState<string[]>([]); const [avoidNote, setAvoidNote] = React.useState(''); const [note, setNote] = React.useState(''); const [confirm, setConfirm] = React.useState(false);
  const [trap, setTrap] = React.useState(''); const [busy, setBusy] = React.useState(false); const [msg, setMsg] = React.useState('');
  const codeUsed = React.useRef(false); const [seatTaken, setSeatTaken] = React.useState(false);

  // A PIN kept from earlier in this visit that no longer opens it (the host changed it) is forgotten quietly.
  const load = React.useCallback(async (p: string, kept = false) => {
    const r = await askEvent({ action: 'load', tenantId, eventId, pin: p || undefined });
    if (!r.ok) { setErr(r.error || 'We couldn’t load this event.'); return; }
    if (!r.needsPin && p) savePin(tenantId, eventId, p);
    if (r.needsPin && kept) { savePin(tenantId, eventId, ''); r.pinError = null; }
    // A seat's printed code fills in the table and seat once (never over what the guest has picked since).
    if (!r.needsPin && !codeUsed.current) { codeUsed.current = true; const m = r.order?.tables?.length ? seatFromCode(r.order.tables, qTable, qSeat) : { table: qTable, seat: qSeat }; setTable(m.table); setSeat(m.seat); }
    setPin(r.needsPin ? '' : p); setD(r);
  }, [tenantId, eventId, qTable, qSeat]);
  React.useEffect(() => { const k = savedPin(tenantId, eventId); load(k, !!k); }, [load, tenantId, eventId]);
  React.useEffect(() => { window.scrollTo?.(0, 0); }, [step]);

  if (err) return <Shell><Note>{err}</Note></Shell>;
  if (!d) return <Shell><p className="text-[15px]" style={{ color: MUTED }}>Loading…</p></Shell>;
  const color = d.business?.color; const e = d.event;
  const head = <><BusinessHead business={d.business} />
    <div><h1 className="text-[28px] font-semibold leading-tight tracking-[-0.03em]">{e.title}</h1>
      {whenLabel(e) && <p className="mt-1 text-[15.5px]" style={{ color: MUTED }}>{whenLabel(e)}</p>}</div></>;
  if (d.closed) return <Shell>{head}<Note>{d.message}</Note></Shell>;
  if (d.needsPin) return <Shell>{head}<PinForm color={color} error={d.pinError} busy={pinBusy} onSubmit={async (p) => { setPinBusy(true); await load(p); setPinBusy(false); }} /></Shell>;
  if (d.order?.block) return <Shell>{head}<Note>{d.order.block}</Note></Shell>;

  const courses: any[] = d.order?.courses || []; const tables: { name: string; seats: string[] }[] = d.order?.tables || [];
  const chosenTable = tables.find((t) => t.name === table);
  const deadline = e.orderingDeadline ? new Date(e.orderingDeadline) : null;
  const err2 = msg ? <p className="text-[14px] font-medium" style={{ color: AMBER }} role="alert">{msg}</p> : null;
  const back = (to: Step) => <button type="button" onClick={() => { setMsg(''); setStep(to); }} className="h-11 self-start text-[15px] underline underline-offset-2">Back</button>;

  if (step === 'done') return <Shell>{head}
    <div className="space-y-2 p-5" style={CARD}>
      <p className="text-[20px] font-semibold">Thank you, {name.split(' ')[0]}</p>
      <p className="text-[15.5px] leading-relaxed">Your order is in for {e.title}.{avoid.length || avoidNote ? ' The kitchen will see what you need to avoid.' : ''}</p>
      {courses.length > 0 && <div className="space-y-1 pt-2">{courses.map((c) => <div key={c.number} className="flex justify-between gap-4 text-[15px]"><span style={{ color: MUTED }}>{courses.length > 1 ? c.name : 'Meal'}</span><span className="text-right font-medium">{c.items.find((i: any) => i.id === picks[c.number])?.name}</span></div>)}</div>}
      {seatTaken && <p className="pt-2 text-[14.5px]">Someone already has seat {seat} at {table}, so your host will seat you at that table.</p>}
      <p className="pt-2 text-[14px]" style={{ color: MUTED }}>To change anything, let your host know.</p>
    </div></Shell>;

  if (step === 'you') {
    const next = () => {
      if (!name.trim()) { setMsg('Add your name.'); return; }
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim())) { setMsg(email.trim() ? 'Check your email address.' : 'Add your email.'); return; }
      setMsg(''); setStep(courses.length ? 'meal' : 'avoid');
    };
    return <Shell>{head}
      {deadline && !isNaN(deadline.getTime()) && <p className="text-[14.5px]" style={{ color: MUTED }}>Orders close {deadline.toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}.</p>}
      <form className="space-y-4 p-5" style={CARD} onSubmit={(x) => { x.preventDefault(); next(); }}>
        <p className="text-[18px] font-semibold">About you</p>
        <label className={LABEL}>Name<input value={name} onChange={(x) => setName(x.target.value)} autoComplete="name" className={INPUT} style={{ borderColor: LINE }} /></label>
        <label className={LABEL}>Email<input type="email" value={email} onChange={(x) => setEmail(x.target.value)} autoComplete="email" inputMode="email" aria-describedby="email-hint" className={INPUT} style={{ borderColor: LINE }} />
          <span id="email-hint" className="mt-1 block text-[13px] font-normal" style={{ color: MUTED }}>If you reserved a place, use the same email.</span></label>
        <label className={LABEL}>Phone <span style={{ color: MUTED }}>(optional)</span><input type="tel" value={phone} onChange={(x) => setPhone(x.target.value)} autoComplete="tel" className={INPUT} style={{ borderColor: LINE }} /></label>
        {tables.length > 0 ? <>
          <div><p className={LABEL}>Your table <span style={{ color: MUTED }}>(if you know it)</span></p>
            <div className="mt-1.5 grid grid-cols-3 gap-2">{tables.map((t) => <button key={t.name} type="button" aria-pressed={table === t.name} onClick={() => { setTable(table === t.name ? '' : t.name); setSeat(''); }}
              className="h-11 truncate rounded-2xl border px-2 text-[14.5px]" style={pill(table === t.name)}>{t.name}</button>)}</div></div>
          {chosenTable && chosenTable.seats.length > 0 && <div><p className={LABEL}>Seat <span style={{ color: MUTED }}>(optional)</span></p>
            <div className="mt-1.5 flex flex-wrap gap-2">{chosenTable.seats.map((s) => <button key={s} type="button" aria-pressed={seat === s} onClick={() => setSeat(seat === s ? '' : s)}
              className="h-11 min-w-11 rounded-full border px-3.5 text-[14.5px]" style={pill(seat === s)}>{s}</button>)}</div></div>}
        </> : <div className="grid grid-cols-2 gap-3">
          <label className={LABEL}>Table <span style={{ color: MUTED }}>(optional)</span><input value={table} onChange={(x) => setTable(x.target.value)} className={INPUT} style={{ borderColor: LINE }} /></label>
          <label className={LABEL}>Seat <span style={{ color: MUTED }}>(optional)</span><input value={seat} onChange={(x) => setSeat(x.target.value)} className={INPUT} style={{ borderColor: LINE }} /></label>
        </div>}
        {err2}
        <Button type="submit" color={color}>Continue</Button>
      </form></Shell>;
  }

  if (step === 'meal') {
    const next = () => { const missing = courses.find((c) => !picks[c.number]); if (missing) { setMsg(courses.length === 1 ? 'Choose your meal.' : `Choose your ${missing.name.toLowerCase()}.`); return; } setMsg(''); setStep('avoid'); };
    return <Shell>{head}{back('you')}
      {e.menuNote && <Note>{e.menuNote}</Note>}
      {courses.map((c) => <fieldset key={c.number} className="space-y-2">
        <legend className="mb-2 text-[18px] font-semibold">{courses.length > 1 ? c.name : 'Your meal'}</legend>
        {c.items.map((i: any) => { const on = picks[c.number] === i.id; return <label key={i.id} className="flex cursor-pointer items-start gap-3 p-4" style={on ? { background: '#fff', border: `1px solid ${INK}`, borderRadius: 20 } : CARD}>
          {i.imageUrl && <img src={i.imageUrl} alt="" className="h-16 w-16 shrink-0 rounded-xl object-cover" />}
          <span className="flex-1"><span className="block text-[16px] font-medium">{i.name}</span>
            {i.description && <span className="mt-0.5 block text-[14px] leading-snug" style={{ color: MUTED }}>{i.description}</span>}
            {(i.vegan || i.glutenFree) && <span className="mt-1 block text-[13px]" style={{ color: MUTED }}>{[i.vegan && 'Vegan', i.glutenFree && 'Gluten-free'].filter(Boolean).join(' · ')}</span>}</span>
          <input type="radio" name={`course-${c.number}`} checked={on} onChange={() => setPicks((p) => ({ ...p, [c.number]: i.id }))} className="mt-1 h-5 w-5 shrink-0" style={{ accentColor: INK }} />
        </label>; })}
      </fieldset>)}
      {err2}
      <Button color={color} onClick={next}>Continue</Button></Shell>;
  }

  const anyAvoid = avoid.length > 0 || !!avoidNote.trim();
  const send = async () => {
    if (anyAvoid && !confirm) { setMsg('Please confirm your allergy details are right.'); return; }
    setBusy(true); setMsg('');
    const r = await askEvent({ action: 'order', tenantId, eventId, pin: pin || undefined, name, email, phone, table, seat, picks, allergies: avoid, allergyNote: avoidNote, note, confirm: anyAvoid ? confirm : undefined, ev_ref: trap });
    setBusy(false);
    if (r.needsPin) { await load(''); return; }
    if (r.needEmail) { setStep('you'); setMsg(r.error); return; }
    if (!r.ok) { setMsg(r.error || 'That didn’t go through.'); return; }
    setSeatTaken(!!r.seatTaken); setStep('done');
  };
  const groups = ['critical', 'intolerance', 'preference'];
  return <Shell>{head}{back(courses.length ? 'meal' : 'you')}
    <div className="space-y-4 p-5" style={CARD}>
      <div><p className="text-[18px] font-semibold">Anything the kitchen should know?</p><p className="mt-1 text-[14.5px]" style={{ color: MUTED }}>Tap any that apply. Skip this if none do.</p></div>
      {groups.map((g) => <div key={g}><p className={LABEL}>{SEVERITY_LABEL[g]}</p>
        <div className="mt-1.5 flex flex-wrap gap-2">{(d.allergies || []).filter((a: any) => a.severity === g).map((a: any) => { const on = avoid.includes(a.id); return <button key={a.id} type="button" aria-pressed={on}
          onClick={() => setAvoid((p) => on ? p.filter((x) => x !== a.id) : [...p, a.id])} className="h-11 rounded-full border px-4 text-[14.5px]" style={pill(on)}>{a.label}</button>; })}</div></div>)}
      <label className={LABEL}>Anything else about allergies <span style={{ color: MUTED }}>(optional)</span>
        <textarea value={avoidNote} onChange={(x) => setAvoidNote(x.target.value)} rows={2} className="mt-1.5 w-full rounded-2xl border bg-white px-3.5 py-3 text-[16px] outline-none focus:border-[#16171a]" style={{ borderColor: LINE }} /></label>
      <label className={LABEL}>A note for your host <span style={{ color: MUTED }}>(optional)</span>
        <textarea value={note} onChange={(x) => setNote(x.target.value)} rows={2} className="mt-1.5 w-full rounded-2xl border bg-white px-3.5 py-3 text-[16px] outline-none focus:border-[#16171a]" style={{ borderColor: LINE }} /></label>
      {anyAvoid && <label className="flex min-h-11 cursor-pointer items-start gap-3">
        <input type="checkbox" checked={confirm} onChange={(x) => setConfirm(x.target.checked)} className="mt-0.5 h-5 w-5 shrink-0" style={{ accentColor: INK }} />
        <span className="text-[14.5px] leading-snug">These details are right, and the business’s team and kitchen may see them to keep me safe.</span></label>}
    </div>
    <input value={trap} onChange={(x) => setTrap(x.target.value)} tabIndex={-1} autoComplete="off" aria-hidden="true" className="absolute -left-[9999px] h-px w-px opacity-0" name="ev_ref" />
    {err2}
    <Button color={color} disabled={busy} onClick={send}>{busy ? 'Sending…' : 'Send my order'}</Button>
  </Shell>;
}

export default function MealOrderPage() {
  return <Suspense fallback={<Shell><p className="text-[15px]" style={{ color: MUTED }}>Loading…</p></Shell>}><MealOrder /></Suspense>;
}
