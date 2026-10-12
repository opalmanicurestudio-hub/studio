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
  const post = (action: string, extra: any = {}) => fetch('/api/waitlist/offer', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tenantId, token, action, ...extra }) }).then((r) => r.json()).catch(() => ({ ok: false, error: 'No connection — try again.' }));
  React.useEffect(() => { post('view').then(setV); }, [tenantId, token]); // eslint-disable-line react-hooks/exhaustive-deps
  const missed = (res && !res.ok && res.taken) || v?.state === 'taken' || v?.state === 'held_for_other';
  // Live: while it's still on offer, check every 15 seconds — if it goes, they see it before they tap.
  React.useEffect(() => { if (!v?.ok || v.state !== 'open' || res) return; const i = setInterval(() => { post('view').then((n) => { if (n?.ok) setV(n); }); }, 15000); return () => clearInterval(i); }, [v?.ok, v?.state, res]); // eslint-disable-line react-hooks/exhaustive-deps
  React.useEffect(() => { if (missed && !alts) post('alternatives').then((r) => setAlts(r.ok ? r : { times: [] })); }, [missed]); // eslint-disable-line react-hooks/exhaustive-deps
  const brand = brandOf(v?.business ? { name: v.business } : null, tenantId);
  if (!v) return <VisitShell brand={brand} title="One moment…" />;
  if (!v.ok) return <VisitShell brand={brand} title="This link has expired"><VisitCard><VisitMuted>{v.error}</VisitMuted></VisitCard>{brand.bookHref && <VisitButton href={brand.bookHref} quiet>See open times</VisitButton>}</VisitShell>;

  const payLine = (payBy?: string | null) => { const m = minsLeft(payBy); return m === null ? null : <VisitMuted>Pay within {m} minute{m === 1 ? '' : 's'} to keep it — after that it goes to the next person.</VisitMuted>; };
  // Booked another time that fit
  if (alt?.ok) return <VisitShell brand={brand} title={<>You’re <b>booked</b></>} subtitle={`${alt.when} with ${alt.staffName}`}>
    <VisitCard tone="ok"><p className="text-[18px] font-semibold">{alts?.service || v.service}</p><VisitMuted>{alt.sooner ? 'Your visit has moved to this earlier time — everything else stays the same.' : 'You’ll get a text to confirm.'}</VisitMuted>{alt.payUrl && payLine(alt.payBy)}</VisitCard>
    {alt.payUrl && <VisitButton href={alt.payUrl}>Pay the deposit to confirm</VisitButton>}</VisitShell>;
  // It's theirs
  if (res?.ok || v.state === 'yours') { const payUrl = res?.payUrl || v.payUrl; const payBy = res?.payBy || v.payBy;
    return <VisitShell brand={brand} title={<>You’re <b>booked</b></>} subtitle={`${v.when} with ${v.staffName}`}>
      <VisitCard tone="ok"><p className="text-[18px] font-semibold">{v.service}</p><VisitMuted>{res?.sooner || v.sooner ? 'Your visit has moved to this earlier time — everything else stays the same.' : 'You’ll get a text to confirm.'}</VisitMuted>{payUrl && payLine(payBy)}</VisitCard>
      {payUrl && <VisitButton href={payUrl}>Pay the deposit to confirm</VisitButton>}</VisitShell>; }
  // Someone else got there first — never a dead end
  if (missed) { const held = v.state === 'held_for_other' && !(res && res.taken); const times = alts?.times || [];
    const canBackup = !held && !v.sooner && (v.canBackup || (res?.taken && v.state !== 'gone')) && !v.backup && !backedUp;
    return (
      <VisitShell brand={brand} title={held ? 'It’s with someone else right now' : <>That one <b>just went</b></>} subtitle={v.sooner ? 'Sorry! Your visit stays just as it is.' : `${v.when} was taken moments ago — sorry!`}>
        {!alts && <VisitCard><VisitMuted>Finding other times that fit you…</VisitMuted></VisitCard>}
        {alts && times.length > 0 && <VisitCard>
          <p className="text-[16px] font-semibold">{v.sooner ? 'Other earlier times' : 'These fit you too'}</p>
          <VisitMuted>{v.sooner ? 'With the same person — tap one and your visit moves.' : 'Real open times for what you told us — tap one and it’s booked.'}</VisitMuted>
          <div className="mt-1 flex flex-col gap-2">{times.map((x: any) => <button key={x.startIso + x.staffId} type="button" disabled={!!busy} onClick={async () => { setBusy(x.startIso); setErr(''); const r = await post('book_alt', { startIso: x.startIso, staffId: x.staffId }); setBusy('');
            if (r.ok) setAlt(r); else { setErr(r.error || 'That time just went — pick another.'); post('alternatives').then((n) => n.ok && setAlts(n)); } }}
            className="flex min-h-[56px] items-center justify-between gap-3 rounded-2xl border bg-white px-4 py-2 text-left disabled:opacity-50" style={{ borderColor: '#e7e2dc' }}>
            <span><span className="block text-[15.5px] font-semibold">{x.when}</span><span className="block text-[13px]" style={{ color: 'var(--muted)' }}>with {x.staffName}</span></span>
            <span className="text-[14px] font-semibold" style={{ color: 'var(--accent)' }}>{busy === x.startIso ? 'Booking…' : v.sooner ? 'Move me' : 'Book'}</span></button>)}</div>
          {err && <p className="text-[14px] font-semibold" style={{ color: '#b42318' }}>{err}</p>}
        </VisitCard>}
        {alts && !times.length && <VisitCard><VisitMuted>Nothing else fits what you told us right now — we’re still looking.</VisitMuted></VisitCard>}
        {canBackup && <VisitCard>
          <p className="text-[16px] font-semibold">Want it if it falls through?</p>
          <VisitMuted>If {mid(v.when)} opens up again, it comes to you first — no race.</VisitMuted>
          <VisitButton quiet onClick={async () => { setBusy('backup'); const r = await post('backup'); setBusy(''); if (r.ok) setBackedUp(true); else setErr(r.error); }} disabled={!!busy}>{busy === 'backup' ? 'One moment…' : 'Yes — back me up'}</VisitButton></VisitCard>}
        {(backedUp || v.backup) && <VisitCard tone="ok"><p className="text-[15px] font-semibold">You’re the backup for {mid(v.when)}</p><VisitMuted>If it opens up again, you’ll get a text and it’s yours first.</VisitMuted></VisitCard>}
        {!v.sooner && !held && <VisitMuted>And the next time that fits you is yours alone — you won’t have to race anyone for it.</VisitMuted>}
        {held && <VisitMuted>You’re still on the list — we’ll text you when the next one fits.</VisitMuted>}
      </VisitShell>); }
  if (v.state === 'gone') return <VisitShell brand={brand} title="This time has passed"><VisitCard><VisitMuted>You’re still on the list for the next one.</VisitMuted></VisitCard></VisitShell>;
  if (v.state === 'passed' || res?.passed) return <VisitShell brand={brand} title="No problem" subtitle="You keep your place on the list."><VisitCard><VisitMuted>We’ll text you about the next time that fits.</VisitMuted></VisitCard></VisitShell>;
  const left = v.mode === 'one' ? minsLeft(v.holdUntil) : null;
  return (
    <VisitShell brand={brand} title={v.sooner ? <>A <b>sooner</b> time opened</> : <>It’s <b>still open</b></>} subtitle={left !== null ? `Held just for you for ${left} more minute${left === 1 ? '' : 's'}.` : 'Whoever taps first gets it.'}>
      <VisitCard>
        <p className="text-[22px] font-semibold leading-tight">{v.when}</p>
        <VisitMuted>{v.service} with {v.staffName} · {v.minutes} min{v.price ? ` · ${v.price}` : ''}</VisitMuted>
        {v.sooner && <VisitMuted>Your visit moves to this time. If you’d rather not, your time stays just as it is.</VisitMuted>}
      </VisitCard>
      {res && !res.ok && <p className="px-1 text-[14px] font-semibold" style={{ color: '#b42318' }}>{res.error}</p>}
      <VisitButton onClick={async () => { setBusy('take'); const r = await post('take'); setBusy(''); setRes(r); if (!r.ok && r.taken) post('view').then((n) => n?.ok && setV(n)); }} disabled={!!busy}>{busy === 'take' ? 'Booking…' : v.sooner ? 'Move me to this time' : 'Take it'}</VisitButton>
      <VisitButton quiet onClick={async () => { setBusy('pass'); const r = await post('pass'); setBusy(''); setRes(r.ok ? { passed: true } : r); }} disabled={!!busy}>Not this one — keep my place</VisitButton>
    </VisitShell>);
}
