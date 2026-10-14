'use client';
// /c/[tenantId]/[code] — A CREATOR'S PAGE, for their followers (design canvas RF18). Dark and premium in the app's font:
// their photo (or the business's), their name, handle and a line in their words (approved by the business), their code
// front and center with the real offer, their picks with real prices and the next open times, and looks done here.
// Every Icon gets one too. Booking carries their link, so it counts for them. On a computer: photo left, details right.
// /api/referrals/public (creator).
import * as React from 'react';
import { useParams } from 'next/navigation';
import { motion, useReducedMotion } from 'framer-motion';

const INK = '#16171a', MINT = '#7fd1a5';
const FONT = '"Plus Jakarta Sans", system-ui, sans-serif';
const ease = [0.22, 1, 0.36, 1] as const;
const money = (n: number | null | undefined) => (n == null ? '' : `$${Number.isInteger(n) ? n : Number(n).toFixed(2)}`);
const dark = { background: 'radial-gradient(90% 50% at 80% 0%, rgba(127,209,165,.12), transparent 60%), linear-gradient(180deg,#1b1d21,#0d0e10)', color: '#fff', fontFamily: FONT } as React.CSSProperties;

export default function CreatorPage() {
  const p = useParams() as any; const tenantId = String(p?.tenantId || ''); const code = String(p?.code || ''); const still = !!useReducedMotion();
  const [d, setD] = React.useState<any>(null); const [copied, setCopied] = React.useState(false);
  const [cp, setCp] = React.useState<string | null>(null);
  React.useEffect(() => { try { const v = new URLSearchParams(window.location.search).get('p') || ''; if (/^[a-z0-9]{2,40}\.[a-z0-9]{2,40}$/i.test(v)) { setCp(v); let seen = false; try { seen = sessionStorage.getItem(`piece-${v}`) === '1'; sessionStorage.setItem(`piece-${v}`, '1'); } catch { /* count it */ }
    if (!seen) void fetch('/api/referrals/public', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'piece_open', tenantId, code, p: v }) }).catch(() => {}); } } catch { /* fine */ } }, [tenantId, code]);
  React.useEffect(() => { fetch('/api/referrals/public', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'creator', tenantId, code }) }).then((r) => r.json()).then(setD).catch(() => setD({ ok: false, error: 'This page couldn’t load.' }));
  }, [tenantId, code]);
  React.useEffect(() => { if (d?.ok && d.slug) { let seen = false; try { seen = sessionStorage.getItem(`ref-open-${d.slug}`) === '1'; sessionStorage.setItem(`ref-open-${d.slug}`, '1'); } catch { /* count it */ }
    if (!seen) void fetch('/api/referrals/public', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'opened', tenantId, code: d.slug }) }).catch(() => {}); } }, [d?.ok, d?.slug, tenantId]);
  if (!d) return <main className="flex min-h-screen items-center justify-center" style={dark}><p className="opacity-60">One moment…</p></main>;
  if (!d.ok) return <main className="flex min-h-screen items-center justify-center p-6 text-center" style={dark}><div><p className="text-[28px] font-light">This page isn’t available</p><p className="mt-2 opacity-60">{d.error}</p>
    <a href={`/book/${encodeURIComponent(tenantId)}`} className="mt-6 inline-flex h-12 items-center rounded-full bg-white px-6 font-semibold" style={{ color: INK }}>See services</a></div></main>;
  const c = d.creator; const offer = Math.round((d.offerCents || 0) / 100);
  const cover = c.photo || d.photos?.[0] || c.looks?.[0] || null;
  const book = (serviceId?: string | null, staffId?: string | null) => `/book/${encodeURIComponent(tenantId)}?ref=${encodeURIComponent(d.slug)}${serviceId ? `&service=${encodeURIComponent(serviceId)}` : ''}${staffId ? `&staff=${encodeURIComponent(staffId)}` : ''}${cp ? `&cp=${encodeURIComponent(cp)}` : ''}&src=creator`;
  const top = c.picks?.[0] || d.favorite || null;
  const rise = (i = 0) => (still ? {} : { initial: { opacity: 0, y: 16 }, animate: { opacity: 1, y: 0 }, transition: { duration: 0.5, ease, delay: 0.1 + i * 0.08 } });
  const CodeBox = <div className="flex items-center justify-between gap-3 rounded-[18px] border border-dashed px-4 py-3" style={{ borderColor: 'rgba(255,255,255,.35)' }}>
    <button type="button" onClick={async () => { try { await navigator.clipboard.writeText(c.code); setCopied(true); setTimeout(() => setCopied(false), 1600); } catch { /* fine */ } }} className="text-left" aria-label={`Copy the code ${c.code}`}>
      <p className="text-[11px] uppercase tracking-[0.16em] opacity-60">{copied ? 'Copied' : 'Your code'}</p><p className="text-[26px] font-light tracking-[0.06em]">{c.code}</p></button>
    {offer > 0 && <div className="text-right"><p className="text-[26px] font-light" style={{ color: MINT }}>{money(offer)} off</p><p className="text-[11.5px] opacity-60">{d.days ? `first visit · ${d.days}` : 'your first visit · applied'}</p></div>}</div>;
  return (
    <main className="min-h-screen md:grid md:grid-cols-[1fr_minmax(440px,560px)]" style={dark}>
      <section className="relative min-h-[64vh] overflow-hidden md:sticky md:top-0 md:h-screen">
        {cover && <motion.div aria-hidden="true" className="absolute inset-0" style={{ backgroundImage: `url(${cover})`, backgroundSize: 'cover', backgroundPosition: 'center' }} initial={still ? false : { scale: 1.08 }} animate={{ scale: 1 }} transition={{ duration: 8, ease: 'easeOut' }} />}
        <div aria-hidden="true" className="absolute inset-0" style={{ background: 'linear-gradient(180deg, rgba(13,14,16,0) 35%, #0d0e10 100%)' }} />
        <div className="absolute inset-x-6 top-8 flex justify-between text-[11px] uppercase tracking-[0.28em]"><span>{d.business}</span><span className="opacity-75">{c.tier}</span></div>
        <motion.div className="absolute inset-x-6 bottom-6 flex items-center gap-3" {...rise(0)}>
          <span className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-full border-2 text-[24px] font-light" style={{ borderColor: '#0d0e10', background: '#1d3a2c', boxShadow: '0 0 0 1px rgba(255,255,255,.25)' }}>{c.photo ? <img src={c.photo} alt="" className="h-full w-full object-cover" /> : String(c.name)[0]}</span>
          <div className="min-w-0"><h1 className="truncate text-[30px] font-light tracking-[-0.02em]">{c.name}</h1><p className="text-[13px] opacity-75">{[c.handle, `${d.business} ${c.tier || ''}`.trim()].filter(Boolean).join(' · ')}</p></div></motion.div>
      </section>
      <section className="mx-auto w-full max-w-[560px] space-y-6 px-6 pb-16 pt-6 md:pt-14">
        {c.line && <motion.p className="text-[16px] leading-[1.55] opacity-90" {...rise(1)}>“{c.line}”</motion.p>}
        <motion.div {...rise(2)}>{CodeBox}</motion.div>
        <motion.a href={book(top?.id, d.provider?.id)} className="flex h-[52px] items-center justify-center rounded-full bg-white text-[15px] font-bold" style={{ color: INK }} {...rise(3)}>{top ? `Book ${String(c.name).split(' ')[0]}’s favorite` : `Book with ${money(offer)} off`}</motion.a>
        {(c.picks || []).length > 0 && <div className="space-y-1"><p className="text-[11px] uppercase tracking-[0.2em] opacity-60">{String(c.name).split(' ')[0]}’s picks</p>
          {c.picks.map((s: any, i: number) => <a key={s.id} href={book(s.id)} className="flex items-center justify-between gap-3 border-b py-3.5" style={{ borderColor: 'rgba(255,255,255,.1)' }}>
            <span><span className="block text-[17px] font-light">{s.name}</span><span className="block text-[12px] opacity-60">{[s.minutes ? `${s.minutes} min` : null, i === 0 ? 'their go-to' : null].filter(Boolean).join(' · ')}</span></span>
            <span className="shrink-0 text-[13.5px]">{s.price != null && offer > 0 ? <><s className="opacity-45">{money(s.price)}</s> <b>{money(Math.max(0, s.price - offer))}</b></> : money(s.price)}</span></a>)}</div>}
        {(d.times || []).length > 0 && <div className="space-y-2"><p className="text-[11px] uppercase tracking-[0.2em] opacity-60">Next open</p>
          <div className="flex flex-wrap gap-2">{d.times.map((t: any) => <a key={t.startIso} href={book(top?.id, t.staffId)} className="rounded-full border px-4 py-2 text-[13px] font-semibold" style={{ borderColor: 'rgba(255,255,255,.3)' }}>{String(t.dayLabel).split(',')[0]} {t.label}</a>)}
            <a href={book(top?.id)} className="rounded-full border px-4 py-2 text-[13px] font-semibold" style={{ borderColor: 'rgba(255,255,255,.3)' }}>More times</a></div></div>}
        {(c.looks || []).length > 0 && <div className="space-y-2"><p className="text-[11px] uppercase tracking-[0.2em] opacity-60">Looks done here</p>
          <div className="grid grid-cols-2 gap-2">{c.looks.map((u: string, i: number) => <div key={u} className="aspect-[4/5] rounded-[14px] bg-cover bg-center" style={{ backgroundImage: `url(${u})` }} role="img" aria-label={`Look ${i + 1}`} />)}</div></div>}
        <p className="text-center text-[12px] opacity-50">New clients · one welcome offer per person · <a className="underline" href={`/ref/${encodeURIComponent(tenantId)}/terms`}>terms</a> · {String(c.name).split(' ')[0]} gets credit when you book</p>
      </section>
    </main>);
}
