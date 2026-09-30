'use client';
// src/components/visit/VisitRebook.tsx — "BOOK YOUR NEXT VISIT" on the client's visit link, after a finished visit.
// The same smart booking as the front-desk iPad: their return service, their provider, their usual time; the business's
// deposit choices; a standing appointment and pre-book reward if offered; the waitlist if nothing fits.
import * as React from 'react';

async function call(body: any) {
  return fetch('/api/visit-rebook', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then((r) => r.json()).catch(() => ({ ok: false, error: 'No connection — try again.' }));
}
const dayIso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export function VisitRebook({ token, bookHref }: { token: string; bookHref?: string | null }) {
  const [rb, setRb] = React.useState<any>(null); const [err, setErr] = React.useState<string | null>(null); const [busy, setBusy] = React.useState(false); const [hidden, setHidden] = React.useState(false);
  const [dayDate, setDayDate] = React.useState<string | null>(null); const [dayTimes, setDayTimes] = React.useState<any[] | null>(null);
  const [picked, setPicked] = React.useState<any>(null); const [dep, setDep] = React.useState<string | null>(null); const [standing, setStanding] = React.useState(false);
  React.useEffect(() => { call({ action: 'start', token }).then((r: any) => (r?.ok ? setRb(r.rebook) : setHidden(true))); }, [token]);
  if (hidden) return bookHref ? <a href={bookHref} className="block w-full rounded-full py-3.5 text-center text-[15px] font-semibold" style={{ background: 'var(--accent)', color: '#fff' }}>Book your next visit</a> : null;
  const card = 'space-y-3 rounded-3xl p-5'; const cardStyle = { background: '#fff', border: '1px solid #ebe5de' } as React.CSSProperties;
  const btn = 'w-full rounded-full py-3.5 text-[15px] font-semibold disabled:opacity-40'; const solid = { background: 'var(--accent)', color: '#fff' } as React.CSSProperties; const soft = { background: '#f1ece6' } as React.CSSProperties;
  const more = bookHref ? <a href={bookHref} className="block text-center text-[14px] font-semibold underline underline-offset-4" style={{ color: '#6b645c' }}>See everything we offer</a> : null;
  if (!rb) return <div className={card} style={cardStyle}><p className="text-[15px]" style={{ color: '#6b645c' }}>Finding your best times…</p></div>;
  if (rb.stage === 'already') return <div className={card} style={cardStyle}><p className="text-[15px] font-semibold">Your next visit</p><p className="text-[15px]">{rb.serviceName ? `${rb.serviceName} · ` : ''}{rb.label}</p>
    {rb.checkInToken ? <a href={`/check-in/${rb.checkInToken}`} className="text-[14px] font-semibold underline underline-offset-4">See your booking</a> : null}</div>;
  if (rb.stage === 'waitlisted') return <div className={card} style={cardStyle}><p className="text-[15px] font-semibold">You’re on the waitlist</p><p className="text-[14px]" style={{ color: '#6b645c' }}>We’ll let you know as soon as a time opens up.</p></div>;
  if (rb.stage === 'done' || rb.stage === 'pay') return <div className={card} style={cardStyle}>
    <p className="text-[17px] font-semibold">See you {rb.label}{rb.staffName ? ` with ${rb.staffName}` : ''} ✨</p><p className="text-[14px]" style={{ color: '#6b645c' }}>{rb.serviceName}{rb.depositNote ? ` · ${rb.depositNote}` : ''}</p>
    {(rb.standingBooked || []).length > 0 && <p className="text-[14px]" style={{ color: '#6b645c' }}>Also booked: {rb.standingBooked.join(' · ')}</p>}
    {rb.prebook > 0 && <p className="text-[14px] font-semibold">Your {rb.prebook}% booking-ahead reward is on that visit.</p>}
    {rb.stage === 'pay' && rb.payUrl && <a href={rb.payUrl} className={`${btn} block text-center`} style={solid}>Pay the deposit to confirm</a>}</div>;
  // choose a time
  const deposit = Number(rb.depositCents) || 0; const money = (c: number) => `$${(c / 100).toFixed(2)}`;
  const days = Array.from({ length: 14 }, (_, i) => { const d = new Date(); d.setDate(d.getDate() + (rb.window?.min || 2) * 7 + i); return d; });
  const pickDay = async (d: Date) => { const iso = dayIso(d); setDayDate(iso); setDayTimes(null); const r: any = await call({ action: 'day', token, date: iso }); setDayTimes(r?.ok ? r.times || [] : []); };
  const depOpts = deposit > 0 ? [rb.choices?.cardHold && ['card_hold', `Use my ${rb.card}`, 'Taken before my visit'], rb.choices?.cardCharge && ['card_charge', `Charge my ${rb.card} now`, `${money(deposit)} today`], rb.choices?.payNow && ['pay_now', 'Pay the deposit now', 'Right after booking'], rb.choices?.later && ['later', 'Send me a link', 'Pay later — my time is held']].filter(Boolean) as string[][] : [];
  const book = async () => { setBusy(true); setErr(null); const r: any = await call({ action: 'book', token, startIso: picked.startIso, staffId: picked.staffId, deposit: deposit > 0 ? dep : 'none', standing });
    setBusy(false); if (r?.ok) { setRb(r.rebook); if (r.rebook?.stage === 'pay' && r.rebook.payUrl) window.location.href = r.rebook.payUrl; } else setErr(r?.error || 'That didn’t work — try another time.'); };
  return <div className={card} style={cardStyle}>
    <div><p className="text-[17px] font-semibold">Book your next visit</p><p className="text-[14px]" style={{ color: '#6b645c' }}>{rb.serviceName}{rb.staffName ? ` with ${rb.staffName}` : ''} · {rb.why}</p></div>
    {!picked && <>
      {(rb.suggestions || []).length ? <div className="grid gap-2">{rb.suggestions.map((sl: any) => <button key={sl.startIso} type="button" onClick={() => { setPicked(sl); setDep(null); }} className="flex items-center justify-between rounded-2xl px-4 py-3 text-left text-[15px] font-semibold" style={soft}>
        <span>{sl.dayLabel}</span><span>{sl.label}{rb.others && sl.staffName ? ` · ${sl.staffName}` : ''}</span></button>)}</div>
        : <p className="text-[14px]" style={{ color: '#6b645c' }}>{rb.staffName ? `${rb.staffName} has nothing free` : 'Nothing is free'} in {rb.window?.min}–{rb.window?.max} weeks — choose another day{rb.waitlist ? ', or join the waitlist' : ''}.</p>}
      <p className="text-[13px] font-semibold" style={{ color: '#6b645c' }}>Or choose a day</p>
      <div className="flex gap-1.5 overflow-x-auto pb-1">{days.map((d) => <button key={dayIso(d)} type="button" onClick={() => pickDay(d)} className="flex h-16 w-14 shrink-0 flex-col items-center justify-center rounded-2xl text-[15px] font-semibold" style={dayDate === dayIso(d) ? solid : soft}>
        <span className="text-[11px] font-normal">{d.toLocaleDateString('en-US', { weekday: 'short' })}</span>{d.getDate()}</button>)}</div>
      {dayDate && (dayTimes === null ? <p className="text-[14px]" style={{ color: '#6b645c' }}>Finding times…</p> : dayTimes.length ? <div className="grid grid-cols-3 gap-1.5">{dayTimes.map((sl: any) => <button key={sl.startIso} type="button" onClick={() => { setPicked(sl); setDep(null); }} className="rounded-xl py-2.5 text-[14px] font-semibold" style={soft}>{sl.label}</button>)}</div>
        : <p className="text-[14px]" style={{ color: '#6b645c' }}>Nothing free that day.</p>)}
      {rb.waitlist && <button type="button" disabled={busy} onClick={async () => { setBusy(true); const r: any = await call({ action: 'waitlist', token }); setBusy(false); if (r?.ok) setRb(r.rebook); else setErr(r?.error || 'Try again.'); }} className="text-[14px] font-semibold underline underline-offset-4" style={{ color: '#6b645c' }}>Join {rb.staffName ? `${rb.staffName}’s` : 'the'} waitlist</button>}
    </>}
    {picked && <>
      <div className="rounded-2xl p-4 text-center" style={soft}><p className="text-[17px] font-semibold">{picked.dayLabel} · {picked.label}</p>{picked.staffName ? <p className="text-[14px]">with {picked.staffName}</p> : null}</div>
      {rb.prebookPct > 0 && <p className="text-[14px] font-semibold">Book now and save {rb.prebookPct}% on this visit ✨</p>}
      {rb.standing && <label className="flex items-center gap-2 text-[14px]"><input type="checkbox" checked={standing} onChange={(e) => setStanding(e.target.checked)} className="h-5 w-5" />Make it every {rb.standing.every} weeks ({rb.standing.count} visits)</label>}
      {deposit > 0 && <><p className="text-[14px]">A {money(deposit)} deposit holds this time</p><div className="grid gap-1.5">{depOpts.map(([k, l, sub]) => <button key={k} type="button" onClick={() => setDep(k)} className="rounded-2xl px-4 py-3 text-left text-[14px] font-semibold" style={dep === k ? solid : soft}>{l}<span className="block text-[12px] font-normal opacity-80">{sub}</span></button>)}</div></>}
      {rb.policy && <p className="text-[12px]" style={{ color: '#6b645c' }}>{rb.policy}</p>}
      <div className="grid grid-cols-2 gap-2"><button type="button" onClick={() => setPicked(null)} className={btn} style={soft}>Back</button><button type="button" disabled={busy || (deposit > 0 && !dep)} onClick={book} className={btn} style={solid}>{busy ? 'Booking…' : 'Book it'}</button></div>
    </>}
    {err && <p role="alert" className="text-[14px] font-semibold" style={{ color: '#a15c07' }}>{err}</p>}
    {more}
  </div>;
}
