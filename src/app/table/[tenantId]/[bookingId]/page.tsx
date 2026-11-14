'use client';
// src/app/table/[tenantId]/[bookingId]/page.tsx — A GUEST'S OWN BOOKING (design canvas TableBookSettings, the phone),
// from the link in their text or email: when, for how many, what they told us, how long the table is held, and the
// card holding it (and until when cancelling is free). They can add it to their calendar, tell us they're running late
// (the host stand sees it), or cancel. /api/table-book.
import * as React from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import { VisitShell, VisitCard, VisitButton, VisitMuted, VisitSaid, VisitCheck, brandFromLook, useLook } from '@/components/booking/VisitShell';

const money = (n: number) => `$${(Number(n) || 0).toFixed(Number.isInteger(Number(n)) ? 0 : 2)}`;

/** A calendar file for the booking, made here (two hours, the business's name). */
function icsFor(b: any, business: string): string {
  const t = (iso: string) => new Date(iso).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const start = b.arrivesAt; const end = new Date(Date.parse(b.arrivesAt) + 2 * 3600000).toISOString();
  const esc = (s: string) => s.replace(/[\\;,]/g, (m) => `\\${m}`).replace(/\n/g, '\\n');
  return ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Booking//EN', 'BEGIN:VEVENT', `UID:${b.day}-${b.time}-${b.size}@table`, `DTSTAMP:${t(new Date().toISOString())}`,
    `DTSTART:${t(start)}`, `DTEND:${t(end)}`, `SUMMARY:${esc(`Table for ${b.size} at ${business || 'dinner'}`)}`, 'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
}

export default function YourBooking() {
  const { tenantId, bookingId } = useParams() as { tenantId: string; bookingId: string };
  const k = useSearchParams()?.get('k') || '';
  const [v, setV] = React.useState<any>(null); const [busy, setBusy] = React.useState(''); const [err, setErr] = React.useState(''); const [said, setSaid] = React.useState('');
  const [ask, setAsk] = React.useState<'late' | 'cancel' | null>(null);
  const post = React.useCallback((action: string, extra: any = {}) => fetch('/api/table-book', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tenantId, id: bookingId, k, action, ...extra }) })
    .then((r) => r.json()).catch(() => ({ ok: false, error: 'No connection. Try again in a moment.' })), [tenantId, bookingId, k]);
  const load = React.useCallback(() => post('view').then(setV), [post]);
  React.useEffect(() => { void load(); }, [load]);

  const { look, ready } = useLook(tenantId, v?.look);
  const brand = brandFromLook(look, tenantId); if (!brand.studioName && v?.business) brand.studioName = v.business;
  if (!ready) return <div className="min-h-dvh" aria-busy="true" />;
  if (!v) return <VisitShell brand={brand} title="One moment…" />;
  if (!v.ok) return <VisitShell brand={brand} title="This link isn’t working"><VisitCard><VisitMuted>{v.error || 'Check the link in your text or email.'}</VisitMuted></VisitCard></VisitShell>;
  const b = v.booking;

  const act = async (action: 'late' | 'cancel', extra: any = {}) => {
    setBusy(action); setErr(''); setSaid('');
    const r = await post(action, extra); setBusy(''); setAsk(null);
    if (!r?.ok) { setErr(r?.error || 'That didn’t go through.'); return; }
    setSaid(action === 'late' ? `Thanks. We know you’re about ${r.lateBy} minutes late.` : 'Your booking is cancelled.');
    void load();
  };
  const calendar = () => {
    const url = URL.createObjectURL(new Blob([icsFor(b, v.business || '')], { type: 'text/calendar' }));
    const a = document.createElement('a'); a.href = url; a.download = 'booking.ics'; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 2000);
  };

  if (b.state === 'cancelled') return <VisitShell brand={brand} title="This booking is cancelled" subtitle={b.words}><VisitSaid text={said} ok /><VisitButton quiet href={`/table/${encodeURIComponent(tenantId)}`}>Book another time</VisitButton></VisitShell>;
  if (b.state === 'unfinished') return <VisitShell brand={brand} title="This booking wasn’t finished" subtitle={b.words}><VisitMuted>The card to hold the table wasn’t saved, so the table isn’t booked. Nothing was charged.</VisitMuted><VisitButton quiet href={`/table/${encodeURIComponent(tenantId)}`}>Book again</VisitButton></VisitShell>;
  if (b.state === 'here') return <VisitShell brand={brand} title="Enjoy your meal" subtitle={b.words}><div className="flex justify-center py-2"><VisitCheck /></div></VisitShell>;
  if (b.state === 'missed' || b.state === 'past') return <VisitShell brand={brand} title="This booking has passed" subtitle={b.words} />;

  return (
    <VisitShell brand={brand} title="You’re booked" subtitle={b.words}>
      {(b.asks.length > 0 || b.note) && <div className="flex flex-wrap gap-2">{b.asks.map((x: string) => <span key={x} className="v-chip">{x}</span>)}{b.note && <span className="v-chip">{b.note}</span>}</div>}
      <div className="v-note space-y-2">
        <p><b className="font-semibold">We hold the table {b.holdMin} minutes.</b>{b.lateBy ? ` We know you’re about ${b.lateBy} minutes late.` : ' Running late? You can tell us here.'}</p>
        {b.card && <p>{b.card.brand === 'card' ? 'Your card' : b.card.brand.charAt(0).toUpperCase() + b.card.brand.slice(1)} ending {b.card.last4} holds the table. {b.lateFee
          ? `It’s past the free time to cancel, so cancelling now may be charged ${money(b.fee)}.`
          : `Cancel by ${b.freeWords} and nothing is charged. After that, or if no one comes, it’s ${money(b.fee)}.`}</p>}
      </div>
      <VisitSaid text={err} /><VisitSaid text={said} ok />
      {ask === 'late' ? <VisitCard>
        <p className="pb-2 text-[15px] font-semibold">About how late?</p>
        <div className="grid grid-cols-4 gap-2">{[5, 10, 15, 20].map((m) => <button key={m} type="button" disabled={!!busy} onClick={() => act('late', { minutes: m })} className="v-pill whitespace-nowrap px-0">{m} min</button>)}</div>
        <div className="pt-2"><VisitButton quiet onClick={() => setAsk(null)}>Never mind</VisitButton></div>
      </VisitCard> : ask === 'cancel' ? <VisitCard>
        <p className="pb-1 text-[15px] font-semibold">Cancel this booking?</p>
        <VisitMuted>{b.card && b.lateFee ? `It’s past the free time, so the ${money(b.fee)} you agreed to may be charged.` : 'Nothing is charged.'}</VisitMuted>
        <div className="space-y-2 pt-3"><VisitButton danger disabled={!!busy} onClick={() => act('cancel')}>{busy === 'cancel' ? 'Cancelling…' : 'Yes, cancel it'}</VisitButton><VisitButton quiet onClick={() => setAsk(null)}>Keep my booking</VisitButton></div>
      </VisitCard> : <div className="space-y-2">
        <VisitButton quiet onClick={calendar}>Add to my calendar</VisitButton>
        <VisitButton quiet onClick={() => setAsk('late')}>We’re running late</VisitButton>
        <VisitButton danger onClick={() => setAsk('cancel')}>Cancel the booking</VisitButton>
      </div>}
      <VisitMuted>Need a different time or more seats? Cancel, then book again.</VisitMuted>
    </VisitShell>
  );
}
