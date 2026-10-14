'use client';
// /circle/[tenantId] — THE CIRCLE'S PUBLIC PAGE (design canvas RF17). Dark, quiet and premium, in the app's font: the
// business's photo, the program's name (the business names it; "Circle" by default), the season and places left, real
// members who chose to be shown, what each tier gets (their cards), real totals once they're worth showing, and a short
// request to join. Every number is real; nothing is invented. /api/referrals/public (circle, circle_join).
import * as React from 'react';
import { useParams } from 'next/navigation';
import { motion, useReducedMotion } from 'framer-motion';
import { MetalCard } from '@/components/referrals/MetalCard';

const INK = '#16171a', MINT = '#7fd1a5';
const FONT = '"Plus Jakarta Sans", system-ui, sans-serif';
const ease = [0.22, 1, 0.36, 1] as const;
const money = (c: number) => { const d = (Number(c) || 0) / 100; return `$${d % 1 ? d.toFixed(2) : d.toLocaleString('en-US')}`; };
const call = (body: any) => fetch('/api/referrals/public', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then((r) => r.json()).catch(() => ({ ok: false, error: 'That didn’t work. Please try again.' }));
const dark = { background: 'radial-gradient(90% 50% at 80% 0%, rgba(127,209,165,.12), transparent 60%), linear-gradient(180deg,#1b1d21,#0d0e10)', color: '#fff', fontFamily: FONT } as React.CSSProperties;
const Chip = ({ children }: { children: React.ReactNode }) => <span className="rounded-full border px-3 py-1 text-[12px] font-semibold" style={{ borderColor: 'rgba(255,255,255,.28)' }}>{children}</span>;

export default function CirclePage() {
  const p = useParams() as any; const tenantId = String(p?.tenantId || ''); const still = !!useReducedMotion();
  const [d, setD] = React.useState<any>(null); const [f, setF] = React.useState({ name: '', phone: '', handle: '', why: '' });
  const [busy, setBusy] = React.useState(false); const [sent, setSent] = React.useState<string | null>(null); const [err, setErr] = React.useState('');
  React.useEffect(() => { void call({ action: 'circle', tenantId }).then(setD); }, [tenantId]);
  if (!d) return <main className="flex min-h-screen items-center justify-center" style={dark}><p className="opacity-60">One moment…</p></main>;
  if (!d.ok) return <main className="flex min-h-screen items-center justify-center p-6 text-center" style={dark}><div><p className="text-[28px] font-light">Not open right now</p><p className="mt-2 opacity-60">{d.error}</p></div></main>;
  const join = async () => { setBusy(true); setErr(''); const r = await call({ action: 'circle_join', tenantId, ...f }); setBusy(false);
    if (r?.ok) setSent(r.already ? 'You’ve already asked. We’ll be in touch.' : d.full ? 'You’re on the list. You’ll be the first we invite next season.' : 'Thank you. We’ll be in touch soon.'); else setErr(r?.error || 'That didn’t send. Please try again.'); };
  const rise = (i = 0) => (still ? {} : { initial: { opacity: 0, y: 16 }, whileInView: { opacity: 1, y: 0 }, viewport: { once: true }, transition: { duration: 0.5, ease, delay: i * 0.08 } });
  const field = 'h-12 w-full rounded-[14px] border bg-transparent px-4 text-[15px] outline-none placeholder:text-white/40 focus:border-white';
  return (
    <main className="min-h-screen" style={dark}>
      <section className="relative flex min-h-[92vh] flex-col justify-end overflow-hidden md:min-h-[86vh]">
        {d.photo && <motion.div aria-hidden="true" className="absolute inset-0" style={{ backgroundImage: `url(${d.photo})`, backgroundSize: 'cover', backgroundPosition: 'center' }} initial={still ? false : { scale: 1.08 }} animate={{ scale: 1 }} transition={{ duration: 8, ease: 'easeOut' }} />}
        <div aria-hidden="true" className="absolute inset-0" style={{ background: 'linear-gradient(180deg, rgba(13,14,16,.25) 0%, rgba(13,14,16,.6) 45%, #0d0e10 92%)' }} />
        <p className="absolute inset-x-0 top-10 text-center text-[12px] uppercase tracking-[0.32em]">{d.logo ? <img src={d.logo} alt={d.business} className="mx-auto h-9 w-auto" /> : d.business}</p>
        <div className="relative mx-auto w-full max-w-[640px] space-y-5 px-6 pb-12">
          <motion.div className="flex flex-wrap gap-2" {...rise(0)}>{d.season && <Chip>{d.season} season</Chip>}<Chip>By invitation</Chip>{d.boost && <Chip>{d.boost.name}</Chip>}</motion.div>
          <motion.h1 className="text-[46px] font-light leading-[1] tracking-[-0.035em] md:text-[64px]" {...rise(1)}>The {d.name}</motion.h1>
          <motion.p className="max-w-[520px] text-[15px] leading-[1.6] opacity-75" {...rise(2)}>Our favorite people, sharing the place they love. Real perks, your own card, and a first look at everything new.</motion.p>
          {(d.faces?.length > 0 || d.count != null || d.placesLeft != null) && <motion.div className="flex items-center gap-3" {...rise(3)}>
            {d.faces?.length > 0 && <div className="flex">{d.faces.slice(0, 5).map((x: any, i: number) => <span key={i} className="-ml-2 flex h-9 w-9 items-center justify-center overflow-hidden rounded-full border-2 text-[13px] font-light first:ml-0" style={{ borderColor: '#0d0e10', background: ['#3a3d44', '#55585e', '#1d3a2c', '#2b2e34', '#4a4e57'][i % 5], boxShadow: '0 0 0 1px rgba(255,255,255,.2)' }}>{x.photo ? <img src={x.photo} alt="" className="h-full w-full object-cover" /> : x.name[0]}</span>)}</div>}
            <p className="text-[13px] opacity-85">{d.count != null && <b>{d.count} member{d.count === 1 ? '' : 's'}</b>}{d.count != null && d.placesLeft != null && ' · '}{d.placesLeft != null && (d.full ? 'This season is full' : `${d.placesLeft} place${d.placesLeft === 1 ? '' : 's'} left this season`)}</p></motion.div>}
          <motion.a href="#join" className="flex h-[52px] items-center justify-center rounded-full bg-white text-[15px] font-bold md:w-[320px]" style={{ color: INK }} {...rise(4)}>{d.full ? 'Join the waitlist' : 'Ask to join'}</motion.a>
        </div>
      </section>

      <section className="mx-auto max-w-[980px] space-y-6 px-6 py-14">
        <p className="text-[11px] uppercase tracking-[0.2em] opacity-60">What members get</p>
        <div className="grid gap-6 md:grid-cols-3">{d.tiers.map((t: any, i: number) => <motion.div key={t.id} className="space-y-4" {...rise(i)}>
          <MetalCard look={t.id} program={d.name} tier={t.name} name="You" sub={`${t.friends} friends`} />
          <div><p className="text-[16px] font-semibold">{t.name} · {t.friends} friends</p>
            <ul className="mt-2 space-y-2">{[`${money(t.rewardCents)} for every friend, ${money(t.friendCents)} off for them`, ...t.perks.filter((x: string) => !/credit for every friend/i.test(x))].map((x: string) => <li key={x} className="flex gap-2.5 text-[13.5px] opacity-85"><span style={{ color: MINT }} aria-hidden="true">✦</span>{x}</li>)}</ul></div>
        </motion.div>)}</div>
        <p className="text-[13px] opacity-55">A friend counts once they’ve had a paid first visit. Tiers are based on the last 12 months.</p>
        {d.totals && <motion.div className="flex flex-wrap items-end justify-between gap-6 border-t pt-8" style={{ borderColor: 'rgba(255,255,255,.1)' }} {...rise()}>
          <div><p className="text-[40px] font-light leading-none" style={{ color: MINT }}>{money(d.totals.creditCents)}</p><p className="mt-1 text-[13px] opacity-65">in credit members earned this year</p></div>
          <div className="md:text-right"><p className="text-[40px] font-light leading-none">{d.totals.friends}</p><p className="mt-1 text-[13px] opacity-65">friends they brought</p></div></motion.div>}
      </section>

      <section id="join" className="mx-auto max-w-[560px] scroll-mt-10 space-y-4 px-6 pb-24">
        <p className="text-[11px] uppercase tracking-[0.2em] opacity-60">{d.full ? 'Join the waitlist' : 'Ask to join'}</p>
        <h2 className="text-[30px] font-light leading-tight tracking-[-0.02em]">Tell us a little about you</h2>
        {sent ? <div className="rounded-[18px] border p-5 text-[15px]" style={{ borderColor: 'rgba(127,209,165,.4)', background: 'rgba(127,209,165,.08)' }}>{sent}</div> : <>
          <label className="block space-y-1.5"><span className="text-[12px] opacity-60">Your name</span><input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} autoComplete="name" className={field} style={{ borderColor: 'rgba(255,255,255,.2)' }} /></label>
          <label className="block space-y-1.5"><span className="text-[12px] opacity-60">Mobile</span><input value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} inputMode="tel" autoComplete="tel" className={field} style={{ borderColor: 'rgba(255,255,255,.2)' }} /></label>
          <label className="block space-y-1.5"><span className="text-[12px] opacity-60">Instagram or TikTok (optional)</span><input value={f.handle} onChange={(e) => setF({ ...f, handle: e.target.value })} placeholder="@yourname" className={field} style={{ borderColor: 'rgba(255,255,255,.2)' }} /></label>
          <label className="block space-y-1.5"><span className="text-[12px] opacity-60">Why {d.business}? (optional)</span><textarea value={f.why} onChange={(e) => setF({ ...f, why: e.target.value })} rows={3} maxLength={600} className={`${field} h-auto py-3`} style={{ borderColor: 'rgba(255,255,255,.2)' }} /></label>
          <p className="text-[12.5px] leading-[1.5] opacity-55">Already a client? We’ll find you by your number.{d.full ? ' This season is full, so you’ll be first on the list for the next one.' : ''}</p>
          {err && <p className="text-[13.5px] font-semibold" style={{ color: '#f2a7a0' }}>{err}</p>}
          <button type="button" onClick={join} disabled={busy} className="h-[52px] w-full rounded-full bg-white text-[15px] font-bold disabled:opacity-60" style={{ color: INK }}>{busy ? 'Sending…' : 'Send my request'}</button>
        </>}
      </section>
    </main>);
}
