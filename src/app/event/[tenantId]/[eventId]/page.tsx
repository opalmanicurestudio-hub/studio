'use client';
// src/app/event/[tenantId]/[eventId]/page.tsx — AN EVENT'S PAGE FOR GUESTS: what, when and where, and a place on the
// guest list (the one the business sees in the event's manifest). Read and saved through /api/public/event; a private
// event asks for its PIN first. When the event has a menu, guests go on to choose their meal.
import * as React from 'react';
import { useParams } from 'next/navigation';
import { BusinessHead, Button, CARD, INPUT, LABEL, LINE, MUTED, Note, PinForm, AMBER, Shell, askEvent, calendarHref, savePin, savedPin, whenLabel } from '@/components/events/guest-shell';

export default function EventGuestPage() {
  const { tenantId, eventId } = useParams() as { tenantId: string; eventId: string };
  const [d, setD] = React.useState<any>(null); const [err, setErr] = React.useState('');
  const [pin, setPin] = React.useState(''); const [pinBusy, setPinBusy] = React.useState(false);
  const [name, setName] = React.useState(''); const [email, setEmail] = React.useState(''); const [phone, setPhone] = React.useState(''); const [places, setPlaces] = React.useState(1);
  const [trap, setTrap] = React.useState(''); const [busy, setBusy] = React.useState(false); const [msg, setMsg] = React.useState(''); const [done, setDone] = React.useState<any>(null);

  // A PIN kept from earlier in this visit that no longer opens it (the host changed it) is forgotten quietly.
  const load = React.useCallback(async (p: string, kept = false) => {
    const r = await askEvent({ action: 'load', tenantId, eventId, pin: p || undefined });
    if (!r.ok) { setErr(r.error || 'We couldn’t load this event.'); return; }
    if (!r.needsPin && p) savePin(tenantId, eventId, p);
    if (r.needsPin && kept) { savePin(tenantId, eventId, ''); r.pinError = null; }
    setPin(r.needsPin ? '' : p); setD(r);
  }, [tenantId, eventId]);
  React.useEffect(() => { const k = savedPin(tenantId, eventId); load(k, !!k); }, [load, tenantId, eventId]);

  if (err) return <Shell><Note>{err}</Note></Shell>;
  if (!d) return <Shell><p className="text-[15px]" style={{ color: MUTED }}>Loading…</p></Shell>;
  const color = d.business?.color; const e = d.event;
  const head = <><BusinessHead business={d.business} />
    <div><h1 className="text-[30px] font-semibold leading-tight tracking-[-0.03em]">{e.title}</h1>
      {whenLabel(e) && <p className="mt-1.5 text-[16px]">{whenLabel(e)}</p>}
      {e.venue && <p className="text-[15px]" style={{ color: MUTED }}>{e.venue}</p>}</div></>;

  if (d.closed) return <Shell>{head}<Note>{d.message}</Note></Shell>;
  if (d.needsPin) return <Shell>{head}<PinForm color={color} error={d.pinError} busy={pinBusy} onSubmit={async (p) => { setPinBusy(true); await load(p); setPinBusy(false); }} /></Shell>;

  const orderOpen = !d.order?.block && (d.order?.courses?.length || 0) > 0;
  const mealLink = `/event/${encodeURIComponent(tenantId)}/${encodeURIComponent(eventId)}/rsvp`;
  const cal = calendarHref(e, d.business?.name || '');

  if (done) return <Shell>{head}
    <div className="space-y-2 p-5" style={CARD}>
      <p className="text-[20px] font-semibold">You’re on the list</p>
      <p className="text-[15.5px] leading-relaxed">{done.places > 1 ? `We’ve saved ${done.places} places under ${name}.` : `We’ve saved your place, ${name.split(' ')[0]}.`} The business will see you on their guest list.</p>
    </div>
    {orderOpen && <a href={mealLink} className="flex h-[54px] w-full items-center justify-center rounded-full text-[16px] font-medium text-white" style={{ background: color }}>Choose your meal</a>}
    {cal && <a href={cal} download="event.ics" className="flex h-11 items-center justify-center text-[15px] underline underline-offset-2">Add to calendar</a>}
  </Shell>;

  const left: number | null = d.reserve?.placesLeft ?? null;
  if (d.reserve?.block) return <Shell>{head}<Note>{d.reserve.block}</Note></Shell>;
  if (left === 0) return <Shell>{head}<Note tone="warn">This event is full.</Note></Shell>;
  const maxPlaces = Math.max(1, Math.min(4, left ?? 4));

  const submit = async () => {
    setMsg('');
    if (!name.trim() || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim())) { setMsg('Add your name and email.'); return; }
    setBusy(true);
    const r = await askEvent({ action: 'reserve', tenantId, eventId, pin: pin || undefined, name, email, phone, places, ev_ref: trap });
    setBusy(false);
    if (r.needsPin) { await load(''); return; }
    if (!r.ok) { setMsg(r.error || 'That didn’t go through.'); if (typeof r.left === 'number') load(pin); return; }
    setDone(r);
  };

  return <Shell>{head}
    {left !== null && <p className="text-[14.5px]" style={{ color: MUTED }}>{left === 1 ? '1 place left' : `${left} places left`}</p>}
    <form className="space-y-4 p-5" style={CARD} onSubmit={(ev) => { ev.preventDefault(); submit(); }}>
      <p className="text-[18px] font-semibold">Reserve your place</p>
      <label className={LABEL}>Name<input value={name} onChange={(x) => setName(x.target.value)} autoComplete="name" className={INPUT} style={{ borderColor: LINE }} /></label>
      <label className={LABEL}>Email<input type="email" value={email} onChange={(x) => setEmail(x.target.value)} autoComplete="email" inputMode="email" className={INPUT} style={{ borderColor: LINE }} /></label>
      <label className={LABEL}>Phone <span style={{ color: MUTED }}>(optional)</span><input type="tel" value={phone} onChange={(x) => setPhone(x.target.value)} autoComplete="tel" className={INPUT} style={{ borderColor: LINE }} /></label>
      {maxPlaces > 1 && <div><p className={LABEL}>How many places</p>
        <div className="mt-1.5 flex gap-2" role="radiogroup" aria-label="How many places">{Array.from({ length: maxPlaces }, (_, i) => i + 1).map((n) =>
          <button key={n} type="button" role="radio" aria-checked={places === n} onClick={() => setPlaces(n)} className="h-11 flex-1 rounded-full border text-[15px]"
            style={places === n ? { background: '#16171a', color: '#fff', borderColor: '#16171a' } : { background: '#fff', borderColor: LINE }}>{n}</button>)}</div></div>}
      <input value={trap} onChange={(x) => setTrap(x.target.value)} tabIndex={-1} autoComplete="off" aria-hidden="true" className="absolute -left-[9999px] h-px w-px opacity-0" name="ev_ref" />
      {msg && <p className="text-[14px] font-medium" style={{ color: AMBER }} role="alert">{msg}</p>}
      <Button type="submit" color={color} disabled={busy}>{busy ? 'Saving…' : places > 1 ? `Reserve ${places} places` : 'Reserve my place'}</Button>
    </form>
    {orderOpen && <p className="text-center text-[14px]" style={{ color: MUTED }}>Already on the guest list? <a href={mealLink} className="underline underline-offset-2" style={{ color: '#16171a' }}>Choose your meal</a></p>}
  </Shell>;
}
