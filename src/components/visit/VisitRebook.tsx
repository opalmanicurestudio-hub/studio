'use client';
// src/components/visit/VisitRebook.tsx — BOOK AGAIN on the client's visit link (and their aftercare page), after a
// finished visit. The same smart booking as the front-desk iPad: their return service, their provider, their usual time;
// the business's deposit choices; a standing appointment and pre-book reward if offered; the waitlist if nothing fits.
// It leads with the best time ("Thu, Dec 4 at 3:30 PM": Book it, or Other times). Every color is the page's mood, with
// plain fallbacks for pages outside the visit link.
import * as React from 'react';

async function call(body: any) {
  return fetch('/api/visit-rebook', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then((r) => r.json()).catch(() => ({ ok: false, error: 'No connection. Please try again.' }));
}
const dayIso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const C = { card: 'var(--card, #fff)', soft: 'var(--soft, #f3f3f5)', ink: 'var(--ink, #16171a)', muted: 'var(--muted, #6d7075)', line: 'var(--line, #ececee)', warn: 'var(--warn, #b45309)', accent: 'var(--accent, #16171a)' };
const cardStyle: React.CSSProperties = { background: C.card, color: C.ink, borderRadius: 22, boxShadow: `inset 0 0 0 1px ${C.line}` };
const solid: React.CSSProperties = { background: C.accent, color: '#fff' };
const soft: React.CSSProperties = { background: C.soft, color: C.ink };
const btn = 'inline-flex min-h-[50px] w-full items-center justify-center rounded-full px-5 text-[15.5px] font-semibold transition active:scale-[.98] disabled:opacity-40';
const Label = ({ children }: { children: React.ReactNode }) => <p className="px-1 pb-2 text-[13px] font-semibold" style={{ color: C.muted }}>{children}</p>;
const Muted = ({ children }: { children: React.ReactNode }) => <p className="text-[14px] leading-snug" style={{ color: C.muted }}>{children}</p>;

export function VisitRebook({ token, bookHref }: { token: string; bookHref?: string | null }) {
  const [rb, setRb] = React.useState<any>(null); const [err, setErr] = React.useState<string | null>(null); const [busy, setBusy] = React.useState(false); const [hidden, setHidden] = React.useState(false);
  const [dayDate, setDayDate] = React.useState<string | null>(null); const [dayTimes, setDayTimes] = React.useState<any[] | null>(null);
  const [picked, setPicked] = React.useState<any>(null); const [dep, setDep] = React.useState<string | null>(null); const [standing, setStanding] = React.useState(false);
  const [others, setOthers] = React.useState(false);
  React.useEffect(() => { call({ action: 'start', token }).then((r: any) => (r?.ok ? setRb(r.rebook) : setHidden(true))); }, [token]);
  if (hidden) return bookHref ? <a href={bookHref} className={btn} style={solid}>Book your next visit</a> : null;
  const more = bookHref ? <a href={bookHref} className="inline-flex min-h-11 w-full items-center justify-center text-[14px] font-semibold underline underline-offset-4" style={{ color: C.muted }}>See everything we offer</a> : null;
  const wrap = (label: string, body: React.ReactNode) => <section aria-label={label}><Label>{label}</Label><div className="space-y-3 p-5" style={cardStyle}>{body}</div></section>;
  if (!rb) return wrap('Book again', <Muted>Finding your best times…</Muted>);
  if (rb.stage === 'already') return wrap('Your next visit', <>
    <p className="text-[16px] font-semibold">{rb.serviceName ? `${rb.serviceName} · ` : ''}{rb.label}</p>
    {rb.checkInToken ? <a href={`/check-in/${rb.checkInToken}`} className={btn} style={soft}>See your booking</a> : null}</>);
  if (rb.stage === 'waitlisted') return wrap('Book again', <><p className="text-[16px] font-semibold">You’re on the waitlist</p><Muted>We’ll let you know as soon as a time opens up.</Muted></>);
  if (rb.stage === 'done' || rb.stage === 'pay') return wrap('Your next visit', <>
    <p className="text-[20px] leading-snug" style={{ fontWeight: 300 }}>See you <b style={{ fontWeight: 650 }}>{rb.label}</b>{rb.staffName ? ` with ${rb.staffName}` : ''}</p>
    <Muted>{rb.serviceName}{rb.depositNote ? ` · ${rb.depositNote}` : ''}</Muted>
    {(rb.standingBooked || []).length > 0 && <Muted>Also booked: {rb.standingBooked.join(' · ')}</Muted>}
    {rb.prebook > 0 && <p className="text-[14px] font-semibold">Your {rb.prebook}% booking-ahead reward is on that visit.</p>}
    {rb.stage === 'pay' && rb.payUrl && <a href={rb.payUrl} className={btn} style={solid}>Pay the deposit to confirm</a>}</>);

  // Choose a time.
  const deposit = Number(rb.depositCents) || 0; const money = (c: number) => `$${(c / 100).toFixed(2)}`;
  const days = Array.from({ length: 14 }, (_, i) => { const d = new Date(); d.setDate(d.getDate() + (rb.window?.min || 2) * 7 + i); return d; });
  const pickDay = async (d: Date) => { const iso = dayIso(d); setDayDate(iso); setDayTimes(null); const r: any = await call({ action: 'day', token, date: iso }); setDayTimes(r?.ok ? r.times || [] : []); };
  const depOpts = deposit > 0 ? [rb.choices?.cardHold && ['card_hold', `Use my ${rb.card}`, 'Taken before my visit'], rb.choices?.cardCharge && ['card_charge', `Charge my ${rb.card} now`, `${money(deposit)} today`], rb.choices?.payNow && ['pay_now', 'Pay the deposit now', 'Right after booking'], rb.choices?.later && ['later', 'Send me a link', 'Pay later, my time is held']].filter(Boolean) as string[][] : [];
  const book = async (slot: any): Promise<boolean> => {
    setBusy(true); setErr(null);
    const r: any = await call({ action: 'book', token, startIso: slot.startIso, staffId: slot.staffId, deposit: deposit > 0 ? dep : 'none', standing });
    setBusy(false);
    if (r?.ok) { setRb(r.rebook); if (r.rebook?.stage === 'pay' && r.rebook.payUrl) window.location.href = r.rebook.payUrl; return true; }
    setErr(r?.error || 'That didn’t work. Please try another time.'); return false;
  };
  // Nothing more to choose (no deposit, no standing appointment): the first tap books it.
  const oneTap = deposit === 0 && !rb.standing;
  const pick = (sl: any) => { setErr(null); setPicked(sl); setDep(null); };
  // The best time's own "Book it" says the time on it, so with nothing to choose it books in one tap. A time tapped
  // from a list is a choice first, confirmed with Book it.
  // If that time has just gone, the other times open so they can pick another.
  const choose = (sl: any) => { if (oneTap) { setErr(null); void book(sl).then((done) => { if (!done) setOthers(true); }); } else pick(sl); };
  const best = (rb.suggestions || [])[0];
  const about = <Muted>{rb.serviceName}{rb.staffName ? ` with ${rb.staffName}` : ''}{rb.why ? ` · ${rb.why}` : ''}</Muted>;
  const fine = <>{rb.prebookPct > 0 && <p className="text-[14px] font-semibold">Book now and save {rb.prebookPct}% on this visit.</p>}{rb.policy && <p className="text-[12.5px] leading-snug" style={{ color: C.muted }}>{rb.policy}</p>}</>;
  const errLine = err && <p role="alert" className="text-[14px] font-semibold" style={{ color: C.warn }}>{err}</p>;

  if (picked) return wrap('Book again', <>
    <div className="rounded-2xl p-4 text-center" style={soft}><p className="text-[17px] font-semibold">{picked.dayLabel} · {picked.label}</p>{picked.staffName ? <p className="text-[14px]">with {picked.staffName}</p> : null}</div>
    {rb.standing && <label className="flex min-h-11 items-center gap-3 text-[14.5px]"><input type="checkbox" checked={standing} onChange={(e) => setStanding(e.target.checked)} className="h-5 w-5" style={{ accentColor: C.accent }} />Make it every {rb.standing.every} weeks ({rb.standing.count} visits)</label>}
    {deposit > 0 && <><p className="text-[14.5px]">A {money(deposit)} deposit holds this time</p><div className="grid gap-2" role="radiogroup" aria-label="How to pay the deposit">{depOpts.map(([k, l, sub]) => <button key={k} type="button" role="radio" aria-checked={dep === k} onClick={() => setDep(k)} className="min-h-[52px] rounded-2xl px-4 py-3 text-left text-[14.5px] font-semibold" style={dep === k ? solid : soft}>{l}<span className="block text-[12.5px] font-normal opacity-80">{sub}</span></button>)}</div></>}
    {fine}
    <div className="grid grid-cols-2 gap-2"><button type="button" onClick={() => setPicked(null)} className={btn} style={soft}>Back</button><button type="button" disabled={busy || (deposit > 0 && !dep)} onClick={() => book(picked)} className={btn} style={solid}>{busy ? 'Booking…' : 'Book it'}</button></div>
    {errLine}{more}</>);

  if (best && !others) return wrap('Book again', <>
    <p className="text-[24px] leading-tight" style={{ fontWeight: 300 }}>{best.dayLabel} at <b style={{ fontWeight: 650 }}>{best.label}</b></p>
    {about}
    {oneTap && fine}
    <div className="grid grid-cols-2 gap-2 pt-1"><button type="button" disabled={busy} onClick={() => choose(best)} className={btn} style={solid}>{busy ? 'Booking…' : 'Book it'}</button>
      <button type="button" disabled={busy} onClick={() => setOthers(true)} className={btn} style={soft}>Other times</button></div>
    {errLine}{more}</>);

  return wrap('Book again', <>
    {about}
    {(rb.suggestions || []).length ? <div className="grid gap-2">{rb.suggestions.map((sl: any) => <button key={sl.startIso} type="button" disabled={busy} onClick={() => pick(sl)} className="flex min-h-[52px] items-center justify-between rounded-2xl px-4 py-3 text-left text-[15px] font-semibold disabled:opacity-50" style={soft}>
      <span>{sl.dayLabel}</span><span>{sl.label}{rb.others && sl.staffName ? ` · ${sl.staffName}` : ''}</span></button>)}</div>
      : <Muted>{rb.staffName ? `${rb.staffName} has nothing free` : 'Nothing is free'} in {rb.window?.min}–{rb.window?.max} weeks. Choose another day{rb.waitlist ? ', or join the waitlist' : ''}.</Muted>}
    <p className="pt-1 text-[13px] font-semibold" style={{ color: C.muted }}>Or choose a day</p>
    <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1">{days.map((d) => <button key={dayIso(d)} type="button" aria-pressed={dayDate === dayIso(d)} onClick={() => pickDay(d)} className="flex h-16 w-14 shrink-0 flex-col items-center justify-center rounded-2xl text-[15px] font-semibold" style={dayDate === dayIso(d) ? solid : soft}>
      <span className="text-[11.5px] font-normal">{d.toLocaleDateString('en-US', { weekday: 'short' })}</span>{d.getDate()}</button>)}</div>
    {dayDate && (dayTimes === null ? <Muted>Finding times…</Muted> : dayTimes.length ? <div className="grid grid-cols-3 gap-1.5">{dayTimes.map((sl: any) => <button key={sl.startIso} type="button" disabled={busy} onClick={() => pick(sl)} className="min-h-11 rounded-xl text-[14.5px] font-semibold disabled:opacity-50" style={soft}>{sl.label}</button>)}</div>
      : <Muted>Nothing free that day.</Muted>)}
    {rb.waitlist && <button type="button" disabled={busy} onClick={async () => { setBusy(true); const r: any = await call({ action: 'waitlist', token }); setBusy(false); if (r?.ok) setRb(r.rebook); else setErr(r?.error || 'Please try again.'); }} className="inline-flex min-h-11 items-center text-[14px] font-semibold underline underline-offset-4" style={{ color: C.muted }}>Join {rb.staffName ? `${rb.staffName}’s` : 'the'} waitlist</button>}
    {best && <button type="button" onClick={() => setOthers(false)} className="inline-flex min-h-11 items-center text-[14px] underline underline-offset-4" style={{ color: C.muted }}>Back to the best time</button>}
    {errLine}{more}</>);
}
