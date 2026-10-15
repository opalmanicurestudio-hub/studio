'use client';
// src/app/w/[tenantId]/page.tsx — JOIN THE WAITLIST (design canvas Op10). The service, who with (or anyone good), the
// days and times they could come, how much notice they need, until when — and whether the business's voice assistant
// may call about it. Linked from the booking page when nothing fits; ?service=&provider= prefill. /api/waitlist.
import * as React from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import { VisitShell, VisitCard, VisitButton, VisitMuted, VisitLabel, VisitChoice, brandOf } from '@/components/booking/VisitShell';

const DAYS = [['1', 'Mon'], ['2', 'Tue'], ['3', 'Wed'], ['4', 'Thu'], ['5', 'Fri'], ['6', 'Sat'], ['0', 'Sun']];
const PARTS: [string, string][] = [['morning', 'Morning'], ['afternoon', 'Afternoon'], ['evening', 'Evening']];
const input = 'h-12 w-full rounded-2xl border bg-white px-4 text-[15px]';

export default function JoinWaitlist() {
  const { tenantId } = useParams() as { tenantId: string }; const q = useSearchParams();
  const [info, setInfo] = React.useState<any>(null); const [done, setDone] = React.useState(false); const [err, setErr] = React.useState(''); const [busy, setBusy] = React.useState(false);
  const [f, setF] = React.useState<any>({ serviceId: q.get('service') || '', staffId: q.get('provider') || 'any', name: q.get('name') || '', phone: q.get('phone') || '', email: '', notice: 3, until: '', callOk: false, autoBook: false, party: 1 });
  const [win, setWin] = React.useState<Record<string, string[]>>({});
  React.useEffect(() => { fetch('/api/waitlist', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tenantId, action: 'info' }) }).then((r) => r.json()).then(setInfo).catch(() => setInfo({ ok: false })); }, [tenantId]);
  const brand = brandOf(info?.tenant, tenantId);
  const toggle = (d: string, p: string) => setWin((w) => { const cur = new Set(w[d] || []); if (cur.has(p)) cur.delete(p); else cur.add(p); const n = { ...w, [d]: [...cur] }; if (!n[d].length) delete n[d]; return n; });
  const join = async () => { setBusy(true); setErr('');
    const r = await fetch('/api/waitlist', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tenantId, action: 'join', source: 'waitlist_page', name: f.name, phone: f.phone, email: f.email, serviceId: f.serviceId || null, staffId: f.staffId, windows: win, noticeHours: f.notice, until: f.until || null, callOk: f.callOk, autoBook: f.party > 1 ? false : f.autoBook, party: f.party }) }).then((x) => x.json()).catch(() => ({ ok: false, error: 'We could not connect. Please check your connection and try again.' }));
    setBusy(false); if (r.ok) setDone(true); else setErr(r.error || 'Something went wrong. Please try again.'); };
  if (!info) return <VisitShell brand={brand} title="Waitlist"><VisitMuted>Loading…</VisitMuted></VisitShell>;
  if (done) return <VisitShell brand={brand} title={<>You are on our <b>waitlist</b></>} subtitle="We will text you as soon as a suitable time becomes available.">
    <VisitCard><p className="text-[15px] leading-relaxed">When a time that matches your preferences becomes available, we will text you a link. Simply confirm using the link and it will be booked for you.</p><VisitMuted>If the time does not suit you, choose “Not this time” and you will keep your place.</VisitMuted></VisitCard>
    {brand.bookHref && <VisitButton href={brand.bookHref} quiet>See open times</VisitButton>}</VisitShell>;
  const svc = (info.services || []).find((s: any) => s.id === f.serviceId);
  return (
    <VisitShell brand={brand} title={<>No suitable time? <b>We will find you one</b></>} subtitle="Let us know when you are available, and we will text you when a time opens.">
      <VisitCard>
        <VisitLabel>What for</VisitLabel>
        <select value={f.serviceId} onChange={(e) => setF({ ...f, serviceId: e.target.value })} aria-label="Service" className={input} style={{ borderColor: '#e7e2dc' }}><option value="">Choose a service</option>{(info.services || []).map((s: any) => <option key={s.id} value={s.id}>{s.name}{s.minutes ? ` · ${s.minutes} min` : ''}{s.price ? ` · $${s.price}` : ''}</option>)}</select>
        {(info.providers || []).length > 1 && <><VisitLabel>With</VisitLabel>
          <div className="flex flex-wrap gap-2">{[{ id: 'any', name: 'Any provider' }, ...info.providers].map((p: any) => <button key={p.id} type="button" onClick={() => setF({ ...f, staffId: p.id })} className="h-11 rounded-full px-4 text-[14px]" style={f.staffId === p.id ? { background: 'var(--accent)', color: '#fff', fontWeight: 600 } : { background: '#fff', border: '1px solid #e7e2dc' }}>{p.name}</button>)}</div></>}
        <VisitLabel>How many of you?</VisitLabel>
        <VisitChoice value={f.party} onChange={(v) => setF({ ...f, party: v })} options={[[1, 'Just me'], [2, '2'], [3, '3'], [4, '4'], [5, '5'], [6, '6']]} cols={3} />
        {f.party > 1 && <VisitMuted>When {f.party} times open together, they are offered to your party first. You confirm for everyone with one link.</VisitMuted>}
      </VisitCard>
      <VisitCard>
        <VisitLabel>When are you available?</VisitLabel><VisitMuted>Select every time that suits you, or leave it empty for any time.</VisitMuted>
        <div className="grid grid-cols-[44px_repeat(3,1fr)] gap-1.5 text-[12px]" style={{ color: 'var(--muted)' }}><span />{PARTS.map(([, l]) => <span key={l} className="text-center">{l}</span>)}
          {DAYS.map(([d, l]) => <React.Fragment key={d}><span className="self-center text-[13px]">{l}</span>{PARTS.map(([p, pl]) => { const on = (win[d] || []).includes(p);
            return <button key={p} type="button" aria-pressed={on} aria-label={`${l} ${pl}`} onClick={() => toggle(d, p)} className="h-9 rounded-xl" style={{ background: on ? 'var(--accent)' : '#f1eee9' }} />; })}</React.Fragment>)}</div>
        <VisitLabel>How much notice do you need?</VisitLabel>
        <VisitChoice value={f.notice} onChange={(v) => setF({ ...f, notice: v })} options={[[1, '1 hour'], [3, '3 hours'], [24, 'A day']]} cols={3} />
        <label className="flex items-center justify-between gap-3 text-[15px]"><span>Keep looking until</span><input type="date" value={f.until} min={new Date().toISOString().slice(0, 10)} onChange={(e) => setF({ ...f, until: e.target.value })} className="h-11 rounded-2xl border bg-white px-3 text-[15px]" style={{ borderColor: '#e7e2dc' }} aria-label="Until" /></label>
        {!f.until && <VisitMuted>If you leave this empty, we will look for 30 days.</VisitMuted>}
        {f.party === 1 && <label className="flex items-start gap-3 text-[15px] leading-snug"><input type="checkbox" checked={f.autoBook} onChange={(e) => setF({ ...f, autoBook: e.target.checked })} className="mt-1 h-4 w-4" aria-label="Book it for me automatically" /><span><b className="font-semibold">Book it for me automatically.</b> When a suitable time becomes available, we will book it for you right away. <span style={{ color: 'var(--muted)' }}>We will text you the details, along with a deposit link if one is required. You can cancel using the link in that text.</span></span></label>}
      </VisitCard>
      <VisitCard>
        <VisitLabel>How can we reach you?</VisitLabel>
        <input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Your name" aria-label="Name" className={input} style={{ borderColor: '#e7e2dc' }} autoComplete="name" />
        <input value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} placeholder="Mobile number" aria-label="Mobile number" inputMode="tel" className={input} style={{ borderColor: '#e7e2dc' }} autoComplete="tel" />
        <input value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} placeholder="Email (optional)" aria-label="Email" inputMode="email" className={input} style={{ borderColor: '#e7e2dc' }} autoComplete="email" />
        <label className="flex items-start gap-3 text-[14px] leading-snug"><input type="checkbox" checked={f.callOk} onChange={(e) => setF({ ...f, callOk: e.target.checked })} className="mt-1 h-4 w-4" /><span>Our voice assistant may also call me about an opening <span style={{ color: 'var(--muted)' }}>(an automated call, optional)</span></span></label>
      </VisitCard>
      {err && <p className="px-1 text-[14px] font-semibold" style={{ color: '#b42318' }}>{err}</p>}
      <VisitButton onClick={join} disabled={busy || !f.name.trim() || !f.phone.trim() || !f.serviceId}>{busy ? 'Adding you to the waitlist…' : `Join the waitlist${svc ? ` for ${svc.name}` : ''}`}</VisitButton>
      <VisitMuted>We will only text you about openings. Reply STOP at any time to opt out.</VisitMuted>
    </VisitShell>);
}
