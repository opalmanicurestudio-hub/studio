'use client';
// src/app/w/[tenantId]/[token]/page.tsx — THE LINK IN A WAITLIST TEXT (design canvas Op11, WF5). What's on offer, and one
// tap to take it: booked there and then (or their own visit moved up). "Not this one" keeps their place. The page
// keeps itself up to date, so nobody taps on a time that's already gone. If someone else got there first, it's never a
// dead end: other real times that fit them, one tap to book; "back me up" if this one falls through; and the next one
// that fits is theirs alone. Never names another client. /api/waitlist/offer.
import * as React from 'react';
import { useParams } from 'next/navigation';
import { VisitShell, VisitCard, VisitButton, VisitMuted, brandOf } from '@/components/booking/VisitShell';

const mid = (w: string) => String(w || '').replace(/^Today/, 'today');   // "today at 6" mid-sentence
const minsLeft = (iso?: string | null) => (iso ? Math.max(0, Math.round((Date.parse(iso) - Date.now()) / 60000)) : null);

export default function WaitlistOffer() {
  const { tenantId, token } = useParams() as { tenantId: string; token: string };
  const [v, setV] = React.useState<any>(null); const [busy, setBusy] = React.useState(''); const [res, setRes] = React.useState<any>(null);
  const [alts, setAlts] = React.useState<any>(null); const [alt, setAlt] = React.useState<any>(null); const [backedUp, setBackedUp] = React.useState(false); const [err, setErr] = React.useState('');
  const post = (action: string, extra: any = {}) => fetch('/api/waitlist/offer', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tenantId, token, action, ...extra }) }).then((r) => r.json()).catch(() => ({ ok: false, error: 'We could not connect. Please check your connection and try again.' }));
  React.useEffect(() => { post('view').then(setV); }, [tenantId, token]); // eslint-disable-line react-hooks/exhaustive-deps
  const missed = (res && !res.ok && res.taken) || v?.state === 'taken' || v?.state === 'held_for_other';
  // Live: while it's still on offer, check every 15 seconds — if it goes, they see it before they tap.
  React.useEffect(() => { if (!v?.ok || v.state !== 'open' || res) return; const i = setInterval(() => { post('view').then((n) => { if (n?.ok) setV(n); }); }, 15000); return () => clearInterval(i); }, [v?.ok, v?.state, res]); // eslint-disable-line react-hooks/exhaustive-deps
  React.useEffect(() => { if (missed && !alts) post('alternatives').then((r) => setAlts(r.ok ? r : { times: [] })); }, [missed]); // eslint-disable-line react-hooks/exhaustive-deps
  const brand = brandOf(v?.business ? { name: v.business } : null, tenantId);
  if (!v) return <VisitShell brand={brand} title="One moment…" />;
  if (!v.ok) return <VisitShell brand={brand} title="This link has expired"><VisitCard><VisitMuted>{v.error}</VisitMuted></VisitCard>{brand.bookHref && <VisitButton href={brand.bookHref} quiet>See open times</VisitButton>}</VisitShell>;

  if (v.party) return <PartyOffer v={v} post={post} brand={brand} />;
  const payLine = (payBy?: string | null) => { const m = minsLeft(payBy); return m === null ? null : <VisitMuted>Please pay the deposit within {m} minute{m === 1 ? '' : 's'} to keep this time. After that, it will be offered to the next person on the waitlist.</VisitMuted>; };
  // Booked another time that fit
  if (alt?.ok) return <VisitShell brand={brand} title={<>Your appointment is <b>booked</b></>} subtitle={`${alt.when} with ${alt.staffName}`}>
    <VisitCard tone="ok"><p className="text-[18px] font-semibold">{alts?.service || v.service}</p><VisitMuted>{alt.sooner ? 'Your appointment has been moved to this earlier time. Everything else stays the same.' : 'You will receive a text to confirm your appointment.'}</VisitMuted>{alt.payUrl && payLine(alt.payBy)}</VisitCard>
    {alt.payUrl && <VisitButton href={alt.payUrl}>Pay the deposit to confirm</VisitButton>}</VisitShell>;
  // It's theirs
  if (res?.ok || v.state === 'yours') { const payUrl = res?.payUrl || v.payUrl; const payBy = res?.payBy || v.payBy;
    return <VisitShell brand={brand} title={<>Your appointment is <b>booked</b></>} subtitle={`${v.when} with ${v.staffName}`}>
      <VisitCard tone="ok"><p className="text-[18px] font-semibold">{v.service}</p><VisitMuted>{res?.sooner || v.sooner ? 'Your appointment has been moved to this earlier time. Everything else stays the same.' : 'You will receive a text to confirm your appointment.'}</VisitMuted>{payUrl && payLine(payBy)}</VisitCard>
      {payUrl && <VisitButton href={payUrl}>Pay the deposit to confirm</VisitButton>}</VisitShell>; }
  // Someone else got there first — never a dead end
  if (missed) { const held = v.state === 'held_for_other' && !(res && res.taken); const times = alts?.times || [];
    const canBackup = !held && !v.sooner && (v.canBackup || (res?.taken && v.state !== 'gone')) && !v.backup && !backedUp;
    return (
      <VisitShell brand={brand} title={held ? 'This time is currently held for someone else' : <>This time has <b>just been booked</b></>} subtitle={v.sooner ? 'We’re sorry. Your current appointment will stay exactly as it is.' : `We’re sorry, ${mid(v.when)} was booked a moment ago.`}>
        {!alts && <VisitCard><VisitMuted>Finding other times that suit you…</VisitMuted></VisitCard>}
        {alts && times.length > 0 && <VisitCard>
          <p className="text-[16px] font-semibold">{v.sooner ? 'Other earlier times' : 'These times also suit you'}</p>
          <VisitMuted>{v.sooner ? 'With the same provider. Choose one and your appointment will be moved.' : 'Open times that match your preferences. Choose one and it will be booked for you.'}</VisitMuted>
          <div className="mt-1 flex flex-col gap-2">{times.map((x: any) => <button key={x.startIso + x.staffId} type="button" disabled={!!busy} onClick={async () => { setBusy(x.startIso); setErr(''); const r = await post('book_alt', { startIso: x.startIso, staffId: x.staffId }); setBusy('');
            if (r.ok) setAlt(r); else { setErr(r.error || 'We’re sorry, that time has just been booked. Please choose another time.'); post('alternatives').then((n) => n.ok && setAlts(n)); } }}
            className="flex min-h-[56px] items-center justify-between gap-3 rounded-2xl border bg-white px-4 py-2 text-left disabled:opacity-50" style={{ borderColor: '#e7e2dc' }}>
            <span><span className="block text-[15.5px] font-semibold">{x.when}</span><span className="block text-[13px]" style={{ color: 'var(--muted)' }}>with {x.staffName}</span></span>
            <span className="text-[14px] font-semibold" style={{ color: 'var(--accent)' }}>{busy === x.startIso ? 'Booking…' : v.sooner ? 'Move me' : 'Book'}</span></button>)}</div>
          {err && <p className="text-[14px] font-semibold" style={{ color: '#b42318' }}>{err}</p>}
        </VisitCard>}
        {alts && !times.length && <VisitCard><VisitMuted>No other times match your preferences right now. We will keep looking for you.</VisitMuted></VisitCard>}
        {canBackup && <VisitCard>
          <p className="text-[16px] font-semibold">Would you like to be the backup for this time?</p>
          <VisitMuted>If {mid(v.when)} becomes available again, it will be offered to you first.</VisitMuted>
          <VisitButton quiet onClick={async () => { setBusy('backup'); const r = await post('backup'); setBusy(''); if (r.ok) setBackedUp(true); else setErr(r.error); }} disabled={!!busy}>{busy === 'backup' ? 'One moment…' : 'Yes, add me as the backup'}</VisitButton></VisitCard>}
        {(backedUp || v.backup) && <VisitCard tone="ok"><p className="text-[15px] font-semibold">You are the backup for {mid(v.when)}</p><VisitMuted>If it becomes available again, we will text you and it will be offered to you first.</VisitMuted></VisitCard>}
        {!v.sooner && !held && <VisitMuted>The next time that suits you will also be offered to you alone, before anyone else.</VisitMuted>}
        {held && <VisitMuted>You are still on our waitlist, and we will text you when the next suitable time becomes available.</VisitMuted>}
      </VisitShell>); }
  if (v.state === 'gone') return <VisitShell brand={brand} title="This time has passed"><VisitCard><VisitMuted>You are still on our waitlist for the next suitable time.</VisitMuted></VisitCard></VisitShell>;
  if (v.state === 'passed' || res?.passed) return <VisitShell brand={brand} title="Thank you for letting us know" subtitle="You will keep your place on our waitlist."><VisitCard><VisitMuted>We will text you about the next time that suits you.</VisitMuted></VisitCard></VisitShell>;
  const left = v.mode === 'one' ? minsLeft(v.holdUntil) : null;
  return (
    <VisitShell brand={brand} title={v.sooner ? <>An <b>earlier</b> time is available</> : <>This time is <b>still available</b></>} subtitle={left !== null ? `Reserved for you for ${left} more minute${left === 1 ? '' : 's'}.` : 'It will go to the first person to confirm.'}>
      <VisitCard>
        <p className="text-[22px] font-semibold leading-tight">{v.when}</p>
        <VisitMuted>{v.service} with {v.staffName} · {v.minutes} min{v.price ? ` · ${v.price}` : ''}</VisitMuted>
        {v.sooner && <VisitMuted>Your appointment will move to this time. If you would prefer not to move, your current appointment will stay exactly as it is.</VisitMuted>}
      </VisitCard>
      {res && !res.ok && <p className="px-1 text-[14px] font-semibold" style={{ color: '#b42318' }}>{res.error}</p>}
      <VisitButton onClick={async () => { setBusy('take'); const r = await post('take'); setBusy(''); setRes(r); if (!r.ok && r.taken) post('view').then((n) => n?.ok && setV(n)); }} disabled={!!busy}>{busy === 'take' ? 'Booking…' : v.sooner ? 'Move my appointment to this time' : 'Book this time'}</VisitButton>
      <VisitButton quiet onClick={async () => { setBusy('pass'); const r = await post('pass'); setBusy(''); setRes(r.ok ? { passed: true } : r); }} disabled={!!busy}>Not this time, keep my place</VisitButton>
    </VisitShell>);
}

function PartyOffer({ v, post, brand }: { v: any; post: (a: string, x?: any) => Promise<any>; brand: any }) {
  const [names, setNames] = React.useState<string[]>(Array.from({ length: Math.max(0, v.size - 1) }, () => ''));
  const [busy, setBusy] = React.useState(''); const [res, setRes] = React.useState<any>(null);
  const list = <div className="flex flex-col gap-1.5">{v.times.map((x: any, i: number) => <p key={i} className="text-[15px]"><b className="font-semibold">{x.when}</b> <span style={{ color: 'var(--muted)' }}>with {x.staffName}{i === 0 ? ' · you' : ''}</span></p>)}</div>;
  if (res?.ok || v.state === 'yours') { const payUrl = res?.payUrl || v.payUrl; const m = minsLeft(res?.payBy || v.payBy);
    return <VisitShell brand={brand} title={<>Your party is <b>booked</b></>} subtitle={`${v.size} people · ${v.service}`}>
      <VisitCard tone="ok">{list}<VisitMuted>Everyone is booked. You will receive a text to confirm.</VisitMuted>{payUrl && m !== null && <VisitMuted>Please pay the party’s deposit within {m} minute{m === 1 ? '' : 's'} to keep these times.</VisitMuted>}</VisitCard>
      {payUrl && <VisitButton href={payUrl}>Pay the party’s deposit</VisitButton>}</VisitShell>; }
  if (v.state === 'passed' || res?.passed) return <VisitShell brand={brand} title="Thank you for letting us know" subtitle="Your party keeps its place on our waitlist."><VisitCard><VisitMuted>We will text you when times open for all of you again.</VisitMuted></VisitCard></VisitShell>;
  if (v.state === 'gone') return <VisitShell brand={brand} title="The hold on these times has ended"><VisitCard><VisitMuted>Your party is still on our waitlist, and we will text you when times open for all of you again.</VisitMuted></VisitCard>{brand.bookHref && <VisitButton href={brand.bookHref} quiet>See open times</VisitButton>}</VisitShell>;
  const left = minsLeft(v.holdUntil);
  return (
    <VisitShell brand={brand} title={<>Times for <b>all {v.size} of you</b></>} subtitle={left !== null ? `Held for your party for ${left} more minute${left === 1 ? '' : 's'}.` : undefined}>
      <VisitCard><p className="text-[17px] font-semibold">{v.service} · {v.minutes} min{v.price ? ` · ${v.price} each` : ''}</p>{list}</VisitCard>
      <VisitCard><p className="text-[15px] font-semibold">Who is coming with you?</p><VisitMuted>Optional. Names help us greet everyone.</VisitMuted>
        {names.map((n, i) => <input key={i} value={n} onChange={(e) => setNames(names.map((x, j) => (j === i ? e.target.value : x)))} placeholder={`Guest ${i + 1}`} aria-label={`Guest ${i + 1} name`} className="h-12 w-full rounded-2xl border bg-white px-4 text-[16px]" style={{ borderColor: '#ececee' }} />)}
        <VisitMuted>If a deposit is needed, you pay it for the whole party when you confirm.</VisitMuted></VisitCard>
      {res && !res.ok && <p className="px-1 text-[14px] font-semibold" style={{ color: '#b42318' }}>{res.error}</p>}
      <VisitButton onClick={async () => { setBusy('take'); const r = await post('take', { guests: names }); setBusy(''); setRes(r); }} disabled={!!busy}>{busy === 'take' ? 'Booking everyone…' : `Book all ${v.size}`}</VisitButton>
      <VisitButton quiet onClick={async () => { setBusy('pass'); const r = await post('pass'); setBusy(''); setRes(r.ok ? { passed: true } : r); }} disabled={!!busy}>Not these times, keep our place</VisitButton>
    </VisitShell>);
}
