'use client';
// src/app/event/[tenantId]/[eventId]/place/page.tsx — A GUEST'S OWN PLACE AT AN EVENT, from the private link in their
// confirmation email (?p=…&k=…) or their waitlist email (?w=…&k=…). Read and changed through /api/public/event
// (lib/event-places): how many places they have, cancel one or all of them, give a place to a friend, or, on the
// waitlist, where they are in line and leaving it. A waitlist link whose place came through opens the place itself.
//   It's their PASS too (design board "The event pass", A; lib/event-pass), for free places and paid tickets alike: the
//   entry code for the door (a QR the team scans, or its 4 digits), who's in their party with each one's seat, meal and
//   allergies (a meal link to send each guest who hasn't chosen), and how to get there. On the day the code comes first;
//   once they're checked in, it says they're in. On the night: where the evening is (now, and what's next), their
//   party's courses from the kitchen (being made, on its way, served), and asking for water or someone to help, which
//   goes to the team on the event's manifest; it keeps itself up to date while it's open.
import * as React from 'react';
import { useParams } from 'next/navigation';
import QRCode from 'qrcode';
import { AMBER, BusinessHead, Button, CARD, GREEN, INK, INPUT, LABEL, LINE, MUTED, Note, RED, SOFT, Shell, askEvent, calendarHref, dayLabel, timeLabel, whenLabel } from '@/components/events/guest-shell';

type Mode = 'view' | 'give' | 'cancel';
type PassPlace = { id: string; first: string; you: boolean; seat: string | null; table: string | null; seatNo: string | null; meal: string | null; allergies: string[]; severe: boolean; checkedIn: boolean };
const GREEN_TINT = '#ecf6f0';
/** What a pass can ask for on the night (lib/event-pass EVENT_ASKS). */
const ASK_BUTTONS: { what: 'water' | 'help'; label: string }[] = [{ what: 'water', label: 'Water, please' }, { what: 'help', label: 'Someone to help' }];
type NightCourse = { n: number; name: string; state: 'later' | 'making' | 'on_way' | 'served'; at: string | null; dishes: string[] };
const COURSE_WORDS: Record<NightCourse['state'], string> = { later: 'Later', making: 'Being made', on_way: 'On its way', served: 'Served' };
/** Tonight on the pass: where the evening is, their courses, and asking for something. */
function Tonight({ night, seated, asking, said, onAsk }: { night: any; seated: boolean; asking: string; said: string; onAsk: (what: 'water' | 'help') => void }) {
  const courses: NightCourse[] = Array.isArray(night?.courses) ? night.courses : [];
  const asks: { id: string; said: string; open: boolean }[] = Array.isArray(night?.asks) ? night.asks : [];
  const dot = (s: NightCourse['state']) => (s === 'served' ? { background: GREEN } : s === 'later' ? { background: LINE } : s === 'on_way' ? { background: INK } : { background: '#fff', boxShadow: `inset 0 0 0 2px ${INK}` });
  return (
    <>
      <section aria-labelledby="night-now" className="space-y-1 p-5" style={CARD}>
        {night?.now && <p className="text-[13.5px]" style={{ color: MUTED }}>Now</p>}
        <h2 id="night-now" className="text-[21px] font-semibold leading-tight">{night?.now || 'The evening is about to start'}</h2>
        {night?.next && <p className="text-[15px]" style={{ color: MUTED }}>{`Next: ${night.next.what}, about ${night.next.at}`}</p>}
      </section>
      {courses.length > 0 && <section aria-labelledby="night-courses" className="space-y-3 p-5" style={CARD}>
        <h2 id="night-courses" className="text-[18px] font-semibold">{seated ? 'Your table’s courses' : 'Your courses'}</h2>
        <ol className="space-y-3">{courses.map((c) => (
          <li key={c.n} className="flex items-start gap-3">
            <span aria-hidden className="mt-[7px] h-2.5 w-2.5 shrink-0 rounded-full" style={dot(c.state)} />
            <div className="min-w-0 flex-1">
              <p className="text-[15.5px]"><span className={c.state === 'making' || c.state === 'on_way' ? 'font-semibold' : 'font-medium'}>{c.name}</span><span style={{ color: c.state === 'served' ? GREEN : MUTED }}>{`, ${c.state === 'later' && c.at ? `about ${c.at}` : COURSE_WORDS[c.state].toLowerCase()}`}</span></p>
              {c.dishes.length > 0 && <p className="text-[14px]" style={{ color: MUTED }}>{c.dishes.join(', ')}</p>}
            </div>
          </li>))}</ol>
      </section>}
      <section aria-labelledby="night-ask" className="space-y-3 p-5" style={CARD}>
        <h2 id="night-ask" className="text-[18px] font-semibold">Need something?</h2>
        <div className="grid grid-cols-2 gap-2">{ASK_BUTTONS.map((x) => (
          <button key={x.what} type="button" disabled={!!asking} onClick={() => onAsk(x.what)} className="min-h-[48px] rounded-2xl border bg-white px-3 text-[15px] font-semibold outline-none focus-visible:ring-2 focus-visible:ring-[#16171a] focus-visible:ring-offset-2 disabled:opacity-60" style={{ borderColor: LINE }}>{asking === x.what ? 'Asking…' : x.label}</button>))}</div>
        <div role="status" className="space-y-1">{said && <p className="text-[14.5px] font-medium" style={{ color: GREEN }}>{said}</p>}
          {asks.filter((a) => a.said !== said).slice(0, 2).map((a) => <p key={a.id} className="text-[14px]" style={{ color: a.open ? MUTED : GREEN }}>{a.said}</p>)}</div>
        <p className="text-[13.5px]" style={{ color: MUTED }}>{seated ? 'Goes to the team, with your table.' : 'Goes to the team, with your name.'}</p>
      </section>
    </>);
}
const andList = (xs: string[]) => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);
/** "In 3 days", "Tomorrow", "Tonight", "You’re in": where the evening is for them. */
// (The days come from the server, counted in the business's own calendar.)
function stagePill(stage: string, days: number | null): { text: string; tone: 'green' | 'ink' } | null {
  if (stage === 'in') return { text: 'You’re in', tone: 'green' };
  if (stage === 'today') return { text: 'Today', tone: 'ink' };
  if (stage !== 'before' || days === null) return null;
  return days === 1 ? { text: 'Tomorrow', tone: 'green' } : days > 1 && days < 60 ? { text: `In ${days} days`, tone: 'green' } : null;
}

/** The entry code: the QR the team scans (bigger on the day), its 4 digits, and the party's line. */
function EntryCode({ url, digits, big, lines }: { url: string | null; digits: string | null; big: boolean; lines: string[] }) {
  const [qr, setQr] = React.useState('');
  React.useEffect(() => { if (url) QRCode.toDataURL(url, { width: 480, margin: 1 }).then(setQr).catch(() => setQr('')); }, [url]);
  if (!url) return <div className="space-y-1 p-5" style={CARD}>{lines.map((l, i) => <p key={i} className={i ? 'text-[15px]' : 'text-[16px] font-semibold'} style={i ? { color: MUTED } : undefined}>{l}</p>)}<p className="text-[15px]">Give your name at the door.</p></div>;
  const img = qr ? <img src={qr} alt="Your entry code, scanned at the door" className={big ? 'mx-auto h-[232px] w-[232px] rounded-xl' : 'h-[144px] w-[144px] shrink-0 rounded-lg'} />
    : <span aria-hidden className={big ? 'mx-auto block h-[232px] w-[232px] rounded-xl' : 'block h-[144px] w-[144px] shrink-0 rounded-lg'} style={{ background: SOFT }} />;
  const code = digits ? <p className="text-[14px]" style={{ color: MUTED }}>If the camera can’t read it, the code is <b className="font-semibold tabular-nums tracking-[0.15em]" style={{ color: INK }}>{digits}</b>.</p> : null;
  if (big) return (
    <section aria-label="Your entry code" className="space-y-3 p-5 text-center" style={CARD}>
      {img}<p className="text-[18px] font-semibold">Show this at the door</p>
      {lines.map((l, i) => <p key={i} className="text-[15px]" style={{ color: MUTED }}>{l}</p>)}{code}
    </section>);
  return (
    <section aria-label="Your entry code" className="flex items-center gap-4 p-4" style={CARD}>
      {img}
      <div className="min-w-0 space-y-1">{lines.map((l, i) => <p key={i} className={i ? 'text-[14.5px]' : 'text-[16px] font-semibold'} style={i ? { color: MUTED } : undefined}>{l}</p>)}
        <p className="text-[13.5px] font-medium">Show this at the door</p>{code}</div>
    </section>);
}

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
  const [asking, setAsking] = React.useState(''); const [askSaid, setAskSaid] = React.useState('');

  React.useEffect(() => { const s = new URLSearchParams(window.location.search); setQ({ p: s.get('p') || '', w: s.get('w') || '', k: s.get('k') || '' }); }, []);

  const load = React.useCallback(async (x: { p: string; w: string; k: string }) => {
    const r = await askEvent(x.w ? { action: 'waitspot', tenantId, eventId, w: x.w, k: x.k } : { action: 'place', tenantId, eventId, p: x.p, k: x.k });
    // Off the waitlist and onto the guest list: their place's own page.
    if (r.ok && r.moved?.p) { const next = { p: r.moved.p, w: '', k: r.moved.k }; try { window.history.replaceState(null, '', `?p=${next.p}&k=${next.k}`); } catch { /* fine */ } setQ(next); return load(next); }
    setD(r);
  }, [tenantId, eventId]);
  React.useEffect(() => { if (q) void load(q); }, [q, load]);
  React.useEffect(() => { heading.current?.focus({ preventScroll: true }); }, [mode, done]);
  // On the night the pass keeps itself up to date: once a minute while it's in view (a failed read keeps what it has).
  const live = !!d?.night;
  React.useEffect(() => {
    if (!live || !q || q.w) return;
    const tick = async () => { if (document.visibilityState !== 'visible' || mode !== 'view') return; const r = await askEvent({ action: 'place', tenantId, eventId, p: q.p, k: q.k }); if (r.ok && r.party) setD(r); };
    const t = setInterval(tick, 60000); document.addEventListener('visibilitychange', tick);
    return () => { clearInterval(t); document.removeEventListener('visibilitychange', tick); };
  }, [live, q, mode, tenantId, eventId]);
  const ask = async (what: 'water' | 'help') => {
    if (!q) return; setAsking(what); setAskSaid('');
    const r = await askEvent({ action: 'ask', tenantId, eventId, p: q.p, k: q.k, what }); setAsking('');
    setAskSaid(r.ok ? String(r.said || '') : r.error || 'That didn’t go through. Try again.');
    if (r.ok) { const again = await askEvent({ action: 'place', tenantId, eventId, p: q.p, k: q.k }); if (again.ok && again.party) setD(again); }
  };

  if (!q || !d) return <Shell><p className="text-[15px]" style={{ color: MUTED }}>Loading…</p></Shell>;
  if (!d.ok && !d.event) return <Shell><Note tone="warn">{d.error || 'We couldn’t open this link.'}</Note></Shell>;
  // Their place came through, but its link can't be made here: their email has it.
  if (d.ok && 'moved' in d && !d.moved) return <Shell><Note tone="good">A place opened up and it’s yours. Your confirmation email has the link to it.</Note></Shell>;
  if (d.ok && !d.gone && !d.party && !d.waiting) return <Shell><Note tone="warn">We couldn’t open this link. Use the newest email we sent you.</Note></Shell>;

  const color = d.business?.color; const e = d.event;
  const head = <><BusinessHead business={d.business} />
    <div><p className="text-[14px] font-medium" style={{ color: MUTED }}>{d.waiting ? 'Your place on the waitlist' : d.party ? 'Your pass' : 'Your place'}</p>
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

  // ── On the guest list: their pass ──
  const party = d.party; const many = party.places > 1;
  const cal = calendarHref(e, d.business?.name || '');
  const mealLink = `/event/${encodeURIComponent(tenantId)}/${encodeURIComponent(eventId)}/rsvp`;
  const list: PassPlace[] = Array.isArray(party.list) ? party.list : [];
  const stage: string = d.stage || 'before'; const pill = stagePill(stage, typeof d.days === 'number' ? d.days : null);
  const notIn = list.filter((x) => !x.checkedIn);
  // (Each guest who hasn't chosen gets their own meal link, their seat filled in when they have one.)
  const mealFor = (x: PassPlace) => `${mealLink}${x.table && x.seatNo ? `?table=${encodeURIComponent(x.table)}&seat=${encodeURIComponent(x.seatNo)}` : ''}`;
  const send = async (x: PassPlace) => {
    const url = `${window.location.origin}${mealFor(x)}`; const text = `Choose your meal for ${e.title}`;
    // (Shared, or the share sheet closed: done. The phone can't share: the link is copied instead.)
    try { if (navigator.share) { await navigator.share({ title: text, text, url }); return; } } catch (err: any) { if (err?.name === 'AbortError') return; }
    try { await navigator.clipboard.writeText(url); setGood(`The link for ${x.first} is copied. Send it to them.`); } catch { setGood(''); setMsg('That link couldn’t be copied here. Open Choose your meal on their phone.'); }
  };
  const codeLines = [dayLabel(e.date) || e.title, [e.time ? timeLabel(e.time) : '', party.line || ''].filter(Boolean).join(', ')].filter(Boolean);

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
    {pill && <p className="w-max rounded-full px-3 py-1 text-[13.5px] font-semibold" style={pill.tone === 'green' ? { background: GREEN_TINT, color: GREEN } : { background: INK, color: '#fff' }}>{pill.text}</p>}
    <div role="status">{good && mode === 'view' && <Note tone="good">{good}</Note>}</div>
    {mode === 'view' && stage === 'in' && <div className="space-y-1 p-5" style={{ ...CARD, background: GREEN_TINT, borderColor: GREEN_TINT }}>
      {h2(`You’re in, ${party.firstName}`)}
      <p className="text-[15.5px]" style={{ color: INK }}>{notIn.length ? `${andList(notIn.map((x) => x.first))} ${notIn.length === 1 ? 'isn’t' : 'aren’t'} checked in yet: they can show this same code.` : many ? 'Your whole party is checked in. Enjoy the evening.' : 'Enjoy the evening.'}</p>
    </div>}
    {mode === 'view' && d.night && stage === 'in' && <Tonight night={d.night} seated={list.some((x) => !!x.table)} asking={asking} said={askSaid} onAsk={(w) => void ask(w)} />}
    {mode === 'view' && stage !== 'over' && stage !== 'cancelled' && (stage !== 'in' || notIn.length > 0) && <EntryCode url={d.door?.url || null} digits={d.door?.digits || null} big={stage === 'today'} lines={codeLines} />}
    {mode === 'view' && d.night && stage === 'today' && <Tonight night={d.night} seated={list.some((x) => !!x.table)} asking={asking} said={askSaid} onAsk={(w) => void ask(w)} />}
    {mode !== 'view' && <div className="space-y-2 p-5" style={CARD}><p className="text-[18px] font-semibold">You’re on the list</p><p className="text-[15.5px]">{party.line || `${party.places} ${many ? 'places' : 'place'}`} under {party.firstName}.</p></div>}
    {mode === 'view' && list.length > 0 && <section aria-labelledby="party-title" className="space-y-3 p-5" style={CARD}>
      {mode === 'view' && stage !== 'in' ? <h2 ref={heading} tabIndex={-1} id="party-title" className="text-[18px] font-semibold outline-none">{many ? 'Your party' : 'Your place'}</h2> : <h2 id="party-title" className="text-[18px] font-semibold">{many ? 'Your party' : 'Your place'}</h2>}
      <ul className="space-y-3">{list.map((x, i) => (
        <li key={x.id} className="flex items-start gap-3" style={i ? { borderTop: `1px solid ${LINE}`, paddingTop: 12 } : undefined}>
          <span aria-hidden className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[13px] font-semibold" style={{ background: SOFT }}>{x.first.slice(0, 1).toUpperCase()}</span>
          <div className="min-w-0 flex-1">
            <p className="text-[15.5px] font-medium">{x.you ? 'You' : x.first}{x.seat ? <span className="font-normal" style={{ color: MUTED }}>{`, ${x.seat}`}</span> : null}{x.checkedIn ? <span className="ml-2 text-[13px] font-semibold" style={{ color: GREEN }}>In</span> : null}</p>
            {x.meal ? <p className="text-[14px]" style={{ color: MUTED }}>{x.meal}</p> : d.mealOpen ? <p className="text-[14px] font-medium" style={{ color: AMBER }}>{x.you ? 'You haven’t chosen a meal yet' : 'Hasn’t chosen a meal yet'}</p> : null}
            {x.allergies.length > 0 && <p className="text-[14px] font-medium" style={{ color: AMBER }}>{x.allergies.join(', ')}{x.severe ? ', severe' : ''}. The kitchen has it.</p>}
            {d.mealOpen && !x.meal && !x.you && <button type="button" onClick={() => void send(x)} className="mt-2 min-h-[44px] rounded-full border bg-white px-4 text-[14px] font-semibold outline-none focus-visible:ring-2 focus-visible:ring-[#16171a] focus-visible:ring-offset-2" style={{ borderColor: LINE }}>{`Send ${x.first} their meal link`}</button>}
          </div>
        </li>))}</ul>
    </section>}
    {d.mealOpen && mode === 'view' && list.find((x) => x.you && !x.meal) && <a href={mealFor(list.find((x) => x.you)!)} className="flex h-[54px] w-full items-center justify-center rounded-full text-[16px] font-medium text-white" style={{ background: color }}>Choose your meal</a>}
    {mode === 'view' && e.venue && stage !== 'over' && stage !== 'in' && <section aria-labelledby="there-title" className="space-y-1.5 p-5" style={CARD}>
      <h2 id="there-title" className="text-[18px] font-semibold">Getting there</h2>
      <p className="text-[15px]" style={{ color: MUTED }}>{e.venue}</p>
      <a href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(e.venue)}`} target="_blank" rel="noreferrer" className="inline-flex min-h-[44px] items-center text-[15px] font-semibold underline underline-offset-4">Open in maps</a>
    </section>}

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
