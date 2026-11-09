'use client';
// src/app/event/[tenantId]/[eventId]/page.tsx — AN EVENT'S PAGE FOR GUESTS: what, when and where, and a place on the
// guest list (the one the business sees in the event's manifest). Read and saved through /api/public/event; a private
// event asks for its PIN first. When the event has a menu, guests go on to choose their meal. A paid event sells tickets
// instead: the guest pays on the business's own checkout and comes back here (lib/event-tickets).
import * as React from 'react';
import { useParams } from 'next/navigation';
import { BusinessHead, Button, CARD, INPUT, LABEL, LINE, MUTED, Note, PinForm, AMBER, Shell, askEvent, calendarHref, savePin, savedPin, whenLabel } from '@/components/events/guest-shell';

export default function EventGuestPage() {
  const { tenantId, eventId } = useParams() as { tenantId: string; eventId: string };
  const [d, setD] = React.useState<any>(null); const [err, setErr] = React.useState('');
  const [pin, setPin] = React.useState(''); const [pinBusy, setPinBusy] = React.useState(false);
  const [name, setName] = React.useState(''); const [email, setEmail] = React.useState(''); const [phone, setPhone] = React.useState(''); const [places, setPlaces] = React.useState(1);
  const [trap, setTrap] = React.useState(''); const [busy, setBusy] = React.useState(false); const [msg, setMsg] = React.useState(''); const [done, setDone] = React.useState<any>(null);
  const [qty, setQty] = React.useState(1); const [paying, setPaying] = React.useState<'checking' | 'slow' | null>(null);

  // Back from the checkout: paid (confirmed here, waiting a little if the payment is still settling), or left without
  // paying (the places held for them go back on sale). The address is tidied so a refresh doesn't ask again.
  React.useEffect(() => {
    const q = new URLSearchParams(window.location.search); const session = q.get('paid'); const order = q.get('left');
    if (!session && !order) return;
    const tidy = () => { try { window.history.replaceState(null, '', window.location.pathname); } catch { /* fine */ } };
    if (order) { askEvent({ action: 'left', tenantId, eventId, order }).finally(tidy); return; }
    let stop = false; setPaying('checking');
    (async () => {
      for (let i = 0; i < 6 && !stop; i++) {
        const r = await askEvent({ action: 'paid', tenantId, eventId, session });
        if (r.ok && r.status === 'paid') { setDone({ tickets: r.qty, title: r.title, buyer: r.name }); setPaying(null); tidy(); return; }
        if (r.ok && r.status === 'sold_out') { setPaying(null); setMsg('This event sold out while you were paying, so your payment has been refunded. It can take a few days to show on your card.'); tidy(); return; }
        if (!r.ok && !r.retry) { setPaying(null); setMsg(r.error || 'We couldn’t find that payment.'); tidy(); return; }
        await new Promise((res) => setTimeout(res, 2000));
      }
      if (!stop) setPaying('slow');
    })();
    return () => { stop = true; };
  }, [tenantId, eventId]);

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

  if (paying) return <Shell>{head}<Note tone={paying === 'slow' ? 'warn' : 'plain'}>{paying === 'slow' ? 'Your payment is still being confirmed. We’ll email you as soon as it’s done, so it’s fine to close this page.' : 'Confirming your payment…'}</Note></Shell>;

  if (done?.tickets) return <Shell>{head}
    <div className="space-y-2 p-5" style={CARD}>
      <p className="text-[20px] font-semibold">You’re going</p>
      <p className="text-[15.5px] leading-relaxed">{done.tickets > 1 ? `You have ${done.tickets} tickets. Your guests are on the list under your name.` : 'You have a ticket.'} Your confirmation is on its way by email. Just give your name at the door.</p>
    </div>
    {orderOpen && <a href={mealLink} className="flex h-[54px] w-full items-center justify-center rounded-full text-[16px] font-medium text-white" style={{ background: color }}>Choose your meal</a>}
    {cal && <a href={cal} download="event.ics" className="flex h-11 items-center justify-center text-[15px] underline underline-offset-2">Add to calendar</a>}
  </Shell>;

  if (done) return <Shell>{head}
    <div className="space-y-2 p-5" style={CARD}>
      <p className="text-[20px] font-semibold">You’re on the list</p>
      <p className="text-[15.5px] leading-relaxed">{done.places > 1 ? `We’ve saved ${done.places} places under ${name}.` : `We’ve saved your place, ${name.split(' ')[0]}.`} The business will see you on their guest list.</p>
    </div>
    {orderOpen && <a href={mealLink} className="flex h-[54px] w-full items-center justify-center rounded-full text-[16px] font-medium text-white" style={{ background: color }}>Choose your meal</a>}
    {cal && <a href={cal} download="event.ics" className="flex h-11 items-center justify-center text-[15px] underline underline-offset-2">Add to calendar</a>}
  </Shell>;

  // A paid event: tickets, paid on the business's own checkout.
  if (d.tickets) {
    const tk = d.tickets; const tLeft: number | null = tk.left ?? null;
    if (tk.block) return <Shell>{head}{msg && <Note tone="warn">{msg}</Note>}<Note>{tk.block}</Note></Shell>;
    if (tLeft === 0) return <Shell>{head}{msg && <Note tone="warn">{msg}</Note>}<Note tone="warn">This event is sold out.</Note></Shell>;
    const maxQty = Math.max(1, Math.min(tk.max || 8, tLeft ?? (tk.max || 8)));
    const each = (tk.cents / 100).toFixed(2).replace(/\.00$/, ''); const total = ((tk.cents * qty) / 100).toFixed(2).replace(/\.00$/, '');
    const buy = async () => {
      setMsg('');
      if (!name.trim() || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim())) { setMsg('Add your name and email.'); return; }
      setBusy(true);
      const r = await askEvent({ action: 'buy', tenantId, eventId, pin: pin || undefined, name, email, phone, qty, ev_ref: trap });
      if (r.ok && r.url) { window.location.assign(r.url); return; }
      setBusy(false);
      if (r.needsPin) { await load(''); return; }
      setMsg(r.error || 'That didn’t go through.'); if (typeof r.left === 'number') { if (qty > r.left) setQty(Math.max(1, r.left)); load(pin); }
    };
    return <Shell>{head}
      <p className="text-[15px]">${each} a ticket{tLeft !== null ? <span style={{ color: MUTED }}> · {tLeft === 1 ? '1 left' : `${tLeft} left`}</span> : null}</p>
      <form className="space-y-4 p-5" style={CARD} onSubmit={(ev) => { ev.preventDefault(); buy(); }}>
        <p className="text-[18px] font-semibold">Get tickets</p>
        <div><p className={LABEL}>How many</p>
          <div className="mt-1.5 flex items-center gap-3">
            <button type="button" aria-label="One fewer" disabled={qty <= 1} onClick={() => setQty((x) => Math.max(1, x - 1))} className="h-11 w-11 rounded-full border bg-white text-[20px] disabled:opacity-40" style={{ borderColor: LINE }}>−</button>
            <span className="min-w-8 text-center text-[20px] font-semibold tabular-nums" aria-live="polite">{qty}</span>
            <button type="button" aria-label="One more" disabled={qty >= maxQty} onClick={() => setQty((x) => Math.min(maxQty, x + 1))} className="h-11 w-11 rounded-full border bg-white text-[20px] disabled:opacity-40" style={{ borderColor: LINE }}>+</button>
          </div></div>
        <label className={LABEL}>Name<input value={name} onChange={(x) => setName(x.target.value)} autoComplete="name" className={INPUT} style={{ borderColor: LINE }} /></label>
        <label className={LABEL}>Email<input type="email" value={email} onChange={(x) => setEmail(x.target.value)} autoComplete="email" inputMode="email" aria-describedby="tk-email" className={INPUT} style={{ borderColor: LINE }} />
          <span id="tk-email" className="mt-1 block text-[13px] font-normal" style={{ color: MUTED }}>Your tickets are sent here.</span></label>
        <label className={LABEL}>Phone <span style={{ color: MUTED }}>(optional)</span><input type="tel" value={phone} onChange={(x) => setPhone(x.target.value)} autoComplete="tel" className={INPUT} style={{ borderColor: LINE }} /></label>
        <input value={trap} onChange={(x) => setTrap(x.target.value)} tabIndex={-1} autoComplete="off" aria-hidden="true" className="absolute -left-[9999px] h-px w-px opacity-0" name="ev_ref" />
        {msg && <p className="text-[14px] font-medium" style={{ color: AMBER }} role="alert">{msg}</p>}
        <Button type="submit" color={color} disabled={busy}>{busy ? 'Opening checkout…' : `Continue to payment · $${total}`}</Button>
        <p className="text-center text-[13px]" style={{ color: MUTED }}>You’ll pay {d.business?.name || 'the business'} on a secure checkout. Your places are held while you pay.</p>
      </form>
      {orderOpen && <p className="text-center text-[14px]" style={{ color: MUTED }}>Already have a ticket? <a href={mealLink} className="underline underline-offset-2" style={{ color: '#16171a' }}>Choose your meal</a></p>}
    </Shell>;
  }

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
