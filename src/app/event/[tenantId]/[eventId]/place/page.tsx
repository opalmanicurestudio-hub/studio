'use client';
// src/app/event/[tenantId]/[eventId]/place/page.tsx — A GUEST'S OWN PLACE AT AN EVENT, from the private link in their
// confirmation email (?p=…&k=…) or their waitlist email (?w=…&k=…). Read and changed through /api/public/event
// (lib/event-places): how many places they have, cancel one or all of them, give a place to a friend, or, on the
// waitlist, where they are in line and leaving it. A waitlist link whose place came through opens the place itself.
import * as React from 'react';
import { useParams } from 'next/navigation';
import { AMBER, BusinessHead, Button, CARD, GREEN, INPUT, LABEL, LINE, MUTED, Note, RED, Shell, askEvent, calendarHref, whenLabel } from '@/components/events/guest-shell';

type Mode = 'view' | 'give' | 'cancel';

export default function EventPlacePage() {
  const { tenantId, eventId } = useParams() as { tenantId: string; eventId: string };
  const [q, setQ] = React.useState<{ p: string; w: string; k: string } | null>(null);
  const [d, setD] = React.useState<any>(null);
  const [mode, setMode] = React.useState<Mode>('view');
  const [busy, setBusy] = React.useState(false);
  const [msg, setMsg] = React.useState('');
  const [done, setDone] = React.useState<{ title: string; body: string } | null>(null);
  const [good, setGood] = React.useState('');
  const [name, setName] = React.useState(''); const [email, setEmail] = React.useState(''); const [phone, setPhone] = React.useState('');
  const heading = React.useRef<HTMLHeadingElement | null>(null);

  React.useEffect(() => { const s = new URLSearchParams(window.location.search); setQ({ p: s.get('p') || '', w: s.get('w') || '', k: s.get('k') || '' }); }, []);

  const load = React.useCallback(async (x: { p: string; w: string; k: string }) => {
    const r = await askEvent(x.w ? { action: 'waitspot', tenantId, eventId, w: x.w, k: x.k } : { action: 'place', tenantId, eventId, p: x.p, k: x.k });
    // Off the waitlist and onto the guest list: their place's own page.
    if (r.ok && r.moved?.p) { const next = { p: r.moved.p, w: '', k: r.moved.k }; try { window.history.replaceState(null, '', `?p=${next.p}&k=${next.k}`); } catch { /* fine */ } setQ(next); return load(next); }
    setD(r);
  }, [tenantId, eventId]);
  React.useEffect(() => { if (q) void load(q); }, [q, load]);
  React.useEffect(() => { heading.current?.focus({ preventScroll: true }); }, [mode, done]);

  if (!q || !d) return <Shell><p className="text-[15px]" style={{ color: MUTED }}>Loading…</p></Shell>;
  if (!d.ok && !d.event) return <Shell><Note tone="warn">{d.error || 'We couldn’t open this link.'}</Note></Shell>;
  // Their place came through, but its link can't be made here: their email has it.
  if (d.ok && 'moved' in d && !d.moved) return <Shell><Note tone="good">A place opened up and it’s yours. Your confirmation email has the link to it.</Note></Shell>;
  if (d.ok && !d.gone && !d.party && !d.waiting) return <Shell><Note tone="warn">We couldn’t open this link. Use the newest email we sent you.</Note></Shell>;

  const color = d.business?.color; const e = d.event;
  const head = <><BusinessHead business={d.business} />
    <div><p className="text-[14px] font-medium" style={{ color: MUTED }}>{d.waiting ? 'Your place on the waitlist' : 'Your place'}</p>
      <h1 className="mt-0.5 text-[28px] font-semibold leading-tight tracking-[-0.03em]">{e.title}</h1>
      {whenLabel(e) && <p className="mt-1.5 text-[16px]">{whenLabel(e)}</p>}
      {e.venue && <p className="text-[15px]" style={{ color: MUTED }}>{e.venue}</p>}</div></>;
  const h2 = (t: string) => <h2 ref={heading} tabIndex={-1} className="text-[20px] font-semibold outline-none">{t}</h2>;
  const ring = 'outline-none focus-visible:ring-2 focus-visible:ring-[#16171a] focus-visible:ring-offset-2';
  const quiet = (label: string, onClick: () => void) => <button type="button" onClick={onClick} className={`flex h-11 w-full items-center justify-center rounded-full text-[15px] underline underline-offset-2 ${ring}`}>{label}</button>;
  const alert = <div role="alert">{msg && <p className="text-[14px] font-medium" style={{ color: AMBER }}>{msg}</p>}</div>;

  if (done) return <Shell>{head}
    <div className="space-y-2 p-5" style={CARD}>{h2(done.title)}<p className="text-[15.5px] leading-relaxed">{done.body}</p></div>
  </Shell>;

  if (d.gone) return <Shell>{head}<Note>{q.w ? 'You’re no longer on the waitlist for this event.' : 'This place has been canceled or given to someone else.'} To come, reserve again from the event’s page.</Note>
    <a href={`/event/${encodeURIComponent(tenantId)}/${encodeURIComponent(eventId)}`} className="flex h-[54px] w-full items-center justify-center rounded-full border bg-white text-[16px] font-medium" style={{ borderColor: LINE }}>Go to the event’s page</a>
  </Shell>;

  // ── On the waitlist ──
  if (d.waiting) {
    const w = d.waiting;
    const leave = async () => {
      setBusy(true); setMsg('');
      const r = await askEvent({ action: 'leave', tenantId, eventId, w: q.w, k: q.k }); setBusy(false);
      if (!r.ok) { setMsg(r.error || 'That didn’t go through. Try again in a moment.'); return; }
      // Their place came through meanwhile: they're on the list, so they see their place (and can cancel it there).
      if (r.moved?.p) { const next = { p: r.moved.p, w: '', k: r.moved.k }; try { window.history.replaceState(null, '', `?p=${next.p}&k=${next.k}`); } catch { /* fine */ } setMode('view'); setQ(next); return; }
      if ('moved' in r) { setD(r); return; }
      setDone({ title: 'You’ve left the waitlist', body: 'Thanks for letting us know. If you change your mind, you can join again from the event’s page while it’s full.' });
    };
    return <Shell>{head}
      <div className="space-y-3 p-5" style={CARD}>
        {h2(`You’re number ${w.position} on the waitlist`)}
        <p className="text-[15.5px] leading-relaxed">{w.places > 1 ? `For ${w.places} places, under ${w.firstName}.` : `Under ${w.firstName}.`} If a place opens up, it’s yours straight away: we’ll put you on the guest list and email you. There’s nothing else to do.</p>
      </div>
      {d.block ? <Note>{d.block}</Note> : mode === 'cancel'
        ? <div className="space-y-3 p-5" style={CARD}>{h2('Leave the waitlist?')}<p className="text-[15px]" style={{ color: MUTED }}>You’ll lose your spot in line.</p>{alert}
            <button type="button" disabled={busy} onClick={leave} className={`h-[54px] w-full rounded-full text-[16px] font-medium text-white disabled:opacity-40 ${ring}`} style={{ background: RED }}>{busy ? 'Leaving…' : 'Leave the waitlist'}</button>
            {quiet('Keep my spot', () => { setMode('view'); setMsg(''); })}</div>
        : quiet('Leave the waitlist', () => setMode('cancel'))}
    </Shell>;
  }

  // ── On the guest list ──
  const party = d.party; const many = party.places > 1;
  const cal = calendarHref(e, d.business?.name || '');
  const mealLink = `/event/${encodeURIComponent(tenantId)}/${encodeURIComponent(eventId)}/rsvp`;

  const cancel = async (all: boolean) => {
    setBusy(true); setMsg('');
    const r = await askEvent({ action: 'cancel', tenantId, eventId, p: q.p, k: q.k, all }); setBusy(false);
    if (!r.ok) { setMsg(r.error || 'That didn’t go through. Try again in a moment.'); return; }
    if (r.remaining > 0) { setMode('view'); await load(q); setMsg(''); setGood(r.remaining === 1 ? 'One place canceled. You have 1 place left.' : `One place canceled. You have ${r.remaining} places left.`); return; }
    setDone({ title: r.cancelled > 1 ? 'Your places are canceled' : 'Your place is canceled', body: 'Thanks for letting us know. Your place is free for someone else now.' });
  };
  const give = async () => {
    setMsg('');
    if (!name.trim() || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim())) { setMsg('Add your friend’s name and email.'); return; }
    setBusy(true);
    const r = await askEvent({ action: 'give', tenantId, eventId, p: q.p, k: q.k, name, email, phone }); setBusy(false);
    if (!r.ok) { setMsg(r.error || 'That didn’t go through. Try again in a moment.'); return; }
    setName(''); setEmail(''); setPhone('');
    if (r.remaining > 0) { setMode('view'); await load(q); setMsg(''); setGood(`${r.friend || 'Your friend'} has one of your places now. We’ve emailed them their confirmation.`); return; }
    setDone({ title: `${r.friend || 'Your friend'} has your place`, body: 'We’ve emailed them their confirmation, with their own link to the place. This link no longer works for you.' });
  };

  return <Shell>{head}
    <div role="status">{good && mode === 'view' && <Note tone="good">{good}</Note>}</div>
    <div className="space-y-2 p-5" style={CARD}>
      {mode === 'view' && h2('You’re on the list')}
      {mode !== 'view' && <p className="text-[18px] font-semibold">You’re on the list</p>}
      <p className="text-[15.5px] leading-relaxed">{many ? `${party.places} places under ${party.firstName}. Your guests just give your name at the door.` : `Your place is saved, ${party.firstName}. Just give your name at the door.`}</p>
      <p className="flex items-center gap-2 text-[14px] font-medium" style={{ color: GREEN }}><span className="h-2 w-2 rounded-full" style={{ background: GREEN }} aria-hidden />Confirmed</p>
    </div>
    {d.mealOpen && mode === 'view' && <a href={mealLink} className="flex h-[54px] w-full items-center justify-center rounded-full text-[16px] font-medium text-white" style={{ background: color }}>Choose your meal</a>}

    {d.block ? <Note>{d.block}</Note> : mode === 'give' ? (
      <form className="space-y-4 p-5" style={CARD} onSubmit={(x) => { x.preventDefault(); void give(); }}>
        {h2(many ? 'Give a place to a friend' : 'Give your place to a friend')}
        <p className="text-[14.5px]" style={{ color: MUTED }}>{many ? 'One of your places becomes theirs. We’ll email them a confirmation with their own link.' : 'Your place becomes theirs, and we’ll email them a confirmation with their own link. You won’t be on the list anymore.'}</p>
        <label className={LABEL}>Their name<input value={name} onChange={(x) => setName(x.target.value)} autoComplete="off" className={INPUT} style={{ borderColor: LINE }} /></label>
        <label className={LABEL}>Their email<input type="email" value={email} onChange={(x) => setEmail(x.target.value)} autoComplete="off" inputMode="email" className={INPUT} style={{ borderColor: LINE }} /></label>
        <label className={LABEL}>Their phone <span style={{ color: MUTED }}>(optional)</span><input type="tel" value={phone} onChange={(x) => setPhone(x.target.value)} autoComplete="off" className={INPUT} style={{ borderColor: LINE }} /></label>
        {alert}
        <Button type="submit" color={color} disabled={busy}>{busy ? 'Sending…' : many ? 'Give them a place' : 'Give them my place'}</Button>
        {quiet('Never mind', () => { setMode('view'); setMsg(''); })}
      </form>
    ) : mode === 'cancel' ? (
      <div className="space-y-3 p-5" style={CARD}>
        {h2(many ? 'Cancel places' : 'Cancel your place?')}
        <p className="text-[14.5px]" style={{ color: MUTED }}>{many ? 'Cancel one place if one of your guests can’t come, or all of them if none of you can.' : 'Your place goes to the next person waiting, if there is one.'}</p>
        {alert}
        {many && <button type="button" disabled={busy} onClick={() => cancel(false)} className={`h-[54px] w-full rounded-full border bg-white text-[16px] font-medium disabled:opacity-40 ${ring}`} style={{ borderColor: LINE }}>{busy ? 'Canceling…' : 'Cancel one place'}</button>}
        <button type="button" disabled={busy} onClick={() => cancel(true)} className={`h-[54px] w-full rounded-full text-[16px] font-medium text-white disabled:opacity-40 ${ring}`} style={{ background: RED }}>{busy ? 'Canceling…' : many ? `Cancel all ${party.places} places` : 'Cancel my place'}</button>
        {quiet('Keep my place', () => { setMode('view'); setMsg(''); })}
      </div>
    ) : (
      <div className="space-y-1 p-2" style={CARD}>
        <p className="px-3 pb-1 pt-2 text-[14px] font-medium" style={{ color: MUTED }}>Plans changed?</p>
        <button type="button" onClick={() => { setMode('give'); setMsg(''); setGood(''); }} className={`flex min-h-[52px] w-full items-center justify-between rounded-2xl px-3 text-left text-[16px] font-medium hover:bg-[#f5f5f7] ${ring}`}>{many ? 'Give a place to a friend' : 'Give my place to a friend'}<span aria-hidden style={{ color: MUTED }}>›</span></button>
        <button type="button" onClick={() => { setMode('cancel'); setMsg(''); setGood(''); }} className={`flex min-h-[52px] w-full items-center justify-between rounded-2xl px-3 text-left text-[16px] font-medium hover:bg-[#f5f5f7] ${ring}`}>{many ? 'Cancel places' : 'Cancel my place'}<span aria-hidden style={{ color: MUTED }}>›</span></button>
      </div>
    )}
    {mode === 'view' && cal && <a href={cal} download="event.ics" className="flex h-11 items-center justify-center text-[15px] underline underline-offset-2">Add to calendar</a>}
  </Shell>;
}
