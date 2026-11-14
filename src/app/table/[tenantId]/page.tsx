'use client';
// src/app/table/[tenantId]/page.tsx — A GUEST BOOKS A TABLE (design canvas BookTable, BookHold), in the business's look.
// How many, the day, a time that's open (full ones can't be picked), and anything we should know (a birthday, say).
// Then their name, mobile and email; for a big table, the card company's own form saves a card to hold it
// (nothing is charged today) once they agree to the fee for a late cancel or a no-show. Booked: their link to change or
// cancel comes by text and email. /api/table-book.
import * as React from 'react';
import { useParams } from 'next/navigation';
import { loadStripe } from '@stripe/stripe-js';
import { Elements, PaymentElement, useElements, useStripe } from '@stripe/react-stripe-js';
import { VisitShell, VisitCard, VisitButton, VisitMuted, VisitSaid, VisitCheck, VisitCheckRow, VisitInput, brandFromLook, useLook } from '@/components/booking/VisitShell';

type Info = { ok: boolean; on?: boolean; error?: string; look?: any; business?: string; days?: string[]; maxSize?: number; asks?: string[]; holdMin?: number;
  card?: { from: number; feePerGuest: number; cancelHours: number } | null; groups?: string };
type Slot = { time: string; ok: boolean };
type Made = { id: string; token: string; status: 'booked' | 'card'; words: string; fee?: number; freeUntil?: string; freeWords?: string; clientSecret?: string; publishableKey?: string; stripeAccount?: string };

const money = (n: number) => `$${(Number(n) || 0).toFixed(Number.isInteger(Number(n)) ? 0 : 2)}`;
const at12 = (hhmm: string) => { const [h, m] = hhmm.split(':').map(Number); return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')}`; };
const ampm = (hhmm: string) => (Number(hhmm.split(':')[0]) >= 12 ? 'pm' : 'am');
const dayParts = (d: string) => { const x = new Date(`${d}T12:00:00Z`); return { wd: x.toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' }), n: x.getUTCDate(), long: x.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' }) }; };
const hoursWords = (h: number) => (h % 24 === 0 && h >= 24 ? `${h / 24} day${h === 24 ? '' : 's'}` : `${h} hour${h === 1 ? '' : 's'}`);
const stripes = new Map<string, Promise<any>>();
const stripeFor = (pk: string, acct?: string) => { const k = `${pk}|${acct || ''}`; if (!stripes.has(k)) stripes.set(k, loadStripe(pk, { stripeAccount: acct })); return stripes.get(k)!; };

function CardForm({ made, post, onDone }: { made: Made; post: (a: string, x?: any) => Promise<any>; onDone: () => void }) {
  const stripe = useStripe(); const elements = useElements();
  const [busy, setBusy] = React.useState(false); const [err, setErr] = React.useState('');
  const save = async () => {
    if (!stripe || !elements) return; setBusy(true); setErr('');
    const res = await stripe.confirmSetup({ elements, redirect: 'if_required' });
    if (res.error) { setBusy(false); setErr(res.error.message || 'Your card wasn’t saved.'); return; }
    for (let i = 0; i < 6; i++) {
      const r = await post('card_done', { id: made.id, k: made.token });
      if (r?.ok) { onDone(); return; }
      if (!r?.pending) { setBusy(false); setErr(r?.error || 'Your booking couldn’t be finished. Try again.'); return; }
      await new Promise((x) => setTimeout(x, 1500));
    }
    setBusy(false); setErr('Your card is still being saved. Your booking comes by text or email as soon as it’s done.');
  };
  return (
    <div className="space-y-3">
      <PaymentElement options={{ layout: 'tabs' }} />
      <VisitSaid text={err} />
      <VisitButton disabled={busy || !stripe} onClick={save}>{busy ? 'Booking…' : 'Book the table'}</VisitButton>
    </div>
  );
}

export default function BookATable() {
  const { tenantId } = useParams() as { tenantId: string };
  const [info, setInfo] = React.useState<Info | null>(null);
  const [size, setSize] = React.useState(2); const [day, setDay] = React.useState(''); const [time, setTime] = React.useState('');
  const [slots, setSlots] = React.useState<Slot[] | null>(null);
  const [asks, setAsks] = React.useState<string[]>([]); const [note, setNote] = React.useState('');
  const [step, setStep] = React.useState<'pick' | 'details' | 'card' | 'done'>('pick');
  const [name, setName] = React.useState(''); const [phone, setPhone] = React.useState(''); const [email, setEmail] = React.useState(''); const [agree, setAgree] = React.useState(false);
  const [busy, setBusy] = React.useState(false); const [err, setErr] = React.useState(''); const [made, setMade] = React.useState<Made | null>(null);
  const post = React.useCallback((action: string, extra: any = {}) => fetch('/api/table-book', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tenantId, action, ...extra }) })
    .then((r) => r.json()).catch(() => ({ ok: false, error: 'No connection. Try again in a moment.' })), [tenantId]);
  React.useEffect(() => { void post('info').then((r) => { setInfo(r); if (r?.days?.length) setDay(r.days[0]); }); }, [post]);
  React.useEffect(() => {
    if (!info?.on || !day) return; let live = true; setSlots(null);
    void post('slots', { day, size }).then((r) => { if (!live) return; const list: Slot[] = r?.ok ? r.slots || [] : []; setSlots(list); if (!list.some((x) => x.ok && x.time === time)) setTime(''); });
    return () => { live = false; };
  }, [info?.on, day, size]); // eslint-disable-line react-hooks/exhaustive-deps

  const { look, ready } = useLook(tenantId, info?.look);
  const brand = brandFromLook(look, tenantId); if (!brand.studioName && info?.business) brand.studioName = info.business;
  if (!ready) return <div className="min-h-dvh" aria-busy="true" />;
  if (!info) return <VisitShell brand={brand} title="One moment…" />;
  if (!info.ok) return <VisitShell brand={brand} title="This page isn’t working"><VisitCard><VisitMuted>{info.error || 'Try again later.'}</VisitMuted></VisitCard></VisitShell>;
  if (!info.on) return <VisitShell brand={brand} title="Book a table"><VisitCard><VisitMuted>Booking a table online isn’t open right now.</VisitMuted></VisitCard></VisitShell>;

  const max = info.maxSize || 8; const card = info.card || null;
  const needCard = !!card && size >= card.from; const fee = card ? Math.round(size * card.feePerGuest * 100) / 100 : 0;
  const when = day && time ? `${dayParts(day).long} at ${at12(time)} ${ampm(time)} for ${size}` : '';
  const toggle = (x: string) => setAsks((a) => (a.includes(x) ? a.filter((y) => y !== x) : [...a, x]));

  const book = async () => {
    setBusy(true); setErr('');
    const r = await post('book', { day, time, size, name, phone, email, asks, note, agree: needCard ? agree : undefined });
    setBusy(false);
    if (!r?.ok) { setErr(r?.error || 'That didn’t go through.'); if (r?.code === 'full' || r?.code === 'late') { setStep('pick'); void post('slots', { day, size }).then((x) => setSlots(x?.ok ? x.slots || [] : [])); setTime(''); } return; }
    setMade(r); setStep(r.status === 'card' ? 'card' : 'done');
  };

  if (step === 'done' && made) return (
    <VisitShell brand={brand} title="You’re booked" subtitle={made.words}>
      <div className="flex justify-center py-2"><VisitCheck /></div>
      <div className="v-note">We hold the table {info.holdMin ?? 15} minutes.{made.status === 'card' ? ' Your card holds it. Nothing is charged today.' : ''}</div>
      <VisitMuted>We sent this by {phone ? 'text' : 'email'}, with a link to change or cancel.</VisitMuted>
      <VisitButton quiet href={`/table/${encodeURIComponent(tenantId)}/${made.id}?k=${made.token}`}>See your booking</VisitButton>
    </VisitShell>
  );

  if (step === 'card' && made?.clientSecret) return (
    <VisitShell brand={brand} kicker={`${info.business || ''}, party of ${size}`} title="A card to hold the table" subtitle={made.words}>
      <div className="v-note"><b className="font-semibold">Nothing is charged today.</b> Cancel or change by {made.freeWords || 'the day before'} and it costs nothing. After that, or if no one comes, the charge is {money(card?.feePerGuest || 0)} a guest, {money(made.fee || fee)}.</div>
      <VisitCard>
        <Elements stripe={stripeFor(made.publishableKey || '', made.stripeAccount)} options={{ clientSecret: made.clientSecret, appearance: { theme: 'stripe' } }}>
          <CardForm made={made} post={post} onDone={() => setStep('done')} />
        </Elements>
      </VisitCard>
      <VisitMuted>We hold this table for you for 15 minutes while you put your card in.</VisitMuted>
    </VisitShell>
  );

  if (step === 'details') return (
    <VisitShell brand={brand} kicker="Book a table" title={`Party of ${size}`} subtitle={when}>
      <section className="space-y-2" aria-label="Your details">
        <p className="px-1 text-[15px] font-semibold">Your details</p>
        <VisitInput label="Your name" value={name} onChange={setName} placeholder="Your name" />
        <input aria-label="Mobile number" type="tel" inputMode="tel" autoComplete="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Mobile number" className="v-field h-12" />
        <input aria-label="Email" type="email" inputMode="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email" className="v-field h-12" />
        <p className="px-1 text-[13px]" style={{ color: 'var(--muted)' }}>We text and email you about this booking only.</p>
      </section>
      {needCard && <section className="space-y-2" aria-label="A card to hold the table">
        <p className="px-1 pt-1 text-[15px] font-semibold">A card to hold the table</p>
        <div className="v-note"><b className="font-semibold">Nothing is charged today.</b> Cancel or change up to {hoursWords(card!.cancelHours)} before and it costs nothing. After that, or if no one comes, the charge is {money(card!.feePerGuest)} a guest, {money(fee)}. You put your card in next.</div>
        <VisitCheckRow checked={agree} onChange={setAgree}>I agree to the {money(fee)} charge for a late cancel or a no-show</VisitCheckRow>
      </section>}
      <VisitSaid text={err} />
      <div className="space-y-2 pt-1">
        <VisitButton disabled={busy || !name.trim() || (!phone.trim() && !email.trim()) || (needCard && !agree)} onClick={book}>{busy ? 'One moment…' : needCard ? 'Next: your card' : 'Book the table'}</VisitButton>
        <VisitButton quiet onClick={() => { setStep('pick'); setErr(''); }}>Back</VisitButton>
      </div>
    </VisitShell>
  );

  return (
    <VisitShell brand={brand} title="Book a table">
      <section className="space-y-2" aria-label="How many">
        <p className="px-1 text-[15px] font-semibold">How many</p>
        <div role="radiogroup" aria-label="How many" className="flex flex-wrap gap-2">
          {Array.from({ length: Math.min(max, 12) }, (_, i) => i + 1).map((n) => <button key={n} type="button" role="radio" aria-checked={size === n} onClick={() => setSize(n)} className="v-pill w-11 px-0 tabular-nums">{n}</button>)}
        </div>
        {info.groups && <p className="px-1 text-[13px]" style={{ color: 'var(--muted)' }}>More than {max}? <a href={info.groups} className="font-semibold underline underline-offset-4" style={{ color: 'var(--ink)' }}>Send an event request</a></p>}
      </section>
      <section className="space-y-2" aria-label="Day">
        <p className="px-1 text-[15px] font-semibold">Day</p>
        <div role="radiogroup" aria-label="Day" className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1">
          {(info.days || []).map((d) => { const p = dayParts(d); return (
            <button key={d} type="button" role="radio" aria-checked={day === d} aria-label={p.long} onClick={() => setDay(d)} className="v-pill flex h-[66px] w-[62px] shrink-0 flex-col items-center justify-center gap-0.5 rounded-2xl px-0">
              <span className="text-[12px] opacity-80">{p.wd}</span><span className="text-[17px] font-semibold tabular-nums">{p.n}</span></button>); })}
        </div>
      </section>
      <section className="space-y-2" aria-label="Time">
        <p className="px-1 text-[15px] font-semibold">Time</p>
        {slots === null ? <VisitMuted>Looking at the times…</VisitMuted>
          : slots.length === 0 ? <VisitMuted>No times left that day. Try another day.</VisitMuted>
          : <div role="radiogroup" aria-label="Time" className="grid grid-cols-4 gap-2">
            {slots.map((x) => <button key={x.time} type="button" role="radio" aria-checked={time === x.time} aria-label={`${at12(x.time)} ${ampm(x.time)}${x.ok ? '' : ', full'}`} disabled={!x.ok} onClick={() => setTime(x.time)} className="v-pill rounded-2xl px-0 tabular-nums disabled:opacity-40">{at12(x.time)}</button>)}
          </div>}
        {slots && slots.length > 0 && slots.every((x) => !x.ok) && <VisitMuted>Every time that day is full for {size}. Try another day, or fewer guests.</VisitMuted>}
      </section>
      <section className="space-y-2" aria-label="Anything we should know">
        <p className="px-1 text-[15px] font-semibold">Anything we should know</p>
        <div className="flex flex-wrap gap-2">{(info.asks || []).map((x) => <button key={x} type="button" aria-pressed={asks.includes(x)} onClick={() => toggle(x)} className="v-pill">{x}</button>)}</div>
        <VisitInput label="Anything else" value={note} onChange={(v) => setNote(v.slice(0, 200))} placeholder="Anything else, like a dessert with a candle" />
      </section>
      <VisitSaid text={err} />
      <div className="space-y-2 pt-1">
        {when && <p className="px-1 text-center text-[13px]" style={{ color: 'var(--muted)' }}>{when}. We hold the table {info.holdMin ?? 15} minutes.</p>}
        <VisitButton disabled={!day || !time} onClick={() => { setErr(''); setStep('details'); }}>Continue</VisitButton>
      </div>
    </VisitShell>
  );
}
