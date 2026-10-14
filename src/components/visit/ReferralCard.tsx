'use client';
// src/components/visit/ReferralCard.tsx — THE CLIENT'S WALLET, on their visit link (design canvas RF7, RF9). Everything they
// have with the business as a stack of cards in the app's look — referral credit (green: money they can use), gift
// cards, package visits, their membership — that fan out on open; tap one to see what's in it and when it ends. Below:
// friends they've sent, with progress (sent → booked → visited → yours) and a small moment when a reward lands, and
// Share / Gift a friend (sent from THEIR phone; the business never texts the friend). Credit is ready at checkout:
// the desk sees it lined up and applies it in one tap. Still for anyone with Reduce Motion on. /api/referrals/public.
import * as React from 'react';
import { motion, AnimatePresence, useReducedMotion, animate } from 'framer-motion';
import { VisitInput } from '@/components/booking/VisitShell';

const INK = '#16171a', MUTED = '#6d7075', LINE = '#ececee', SOFT = '#f3f3f5', GREEN = '#1f7a4d';
const ease = [0.22, 1, 0.36, 1] as const;
const call = (body: any) => fetch('/api/referrals/public', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then((r) => r.json()).catch(() => ({ ok: false, error: 'That didn’t work. Please try again.' }));
const money = (c: number) => { const d = (Number(c) || 0) / 100; return `$${d % 1 ? d.toFixed(2) : d}`; };
const day = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '');
const soon = (iso: string | null) => !!iso && Date.parse(iso) - Date.now() < 31 * 864e5;

type Card = { key: string; label: string; big: string; sub: string; bg: string; tag?: string; detail: { a: string; b: string; warn?: boolean }[] };

function Seen({ id, children }: { id: string; children: (fresh: boolean) => React.ReactNode }) {
  const [fresh, setFresh] = React.useState(false);
  React.useEffect(() => { try { const k = `cf-wallet-seen-${id}`; if (!localStorage.getItem(k)) { setFresh(true); localStorage.setItem(k, '1'); } } catch { /* fine */ } }, [id]);
  return <>{children(fresh)}</>;
}
function Count({ to, still }: { to: number; still: boolean }) {
  const [v, setV] = React.useState(still ? to : 0);
  React.useEffect(() => { if (still) { setV(to); return; } const c = animate(0, to, { duration: 0.7, ease, onUpdate: (x) => setV(Math.round(x)) }); return () => c.stop(); }, [to, still]);
  return <>{money(v)}</>;
}

export function ReferralCard({ token }: { token: string }) {
  const still = !!useReducedMotion();
  const [d, setD] = React.useState<any>(null); const [openCard, setOpenCard] = React.useState<string | null>(null);
  const [gift, setGift] = React.useState(false); const [first, setFirst] = React.useState(''); const [phone, setPhone] = React.useState('');
  const [msg, setMsg] = React.useState<{ ok: boolean; t: string } | null>(null); const [busy, setBusy] = React.useState(false);
  const load = React.useCallback(() => call({ action: 'mine', token }).then(setD), [token]);
  React.useEffect(() => { void load(); }, [load]);
  if (!d?.ok) return null;
  const w = d.wallet || {}; const lines: any[] = d.lines || [];
  const cards: Card[] = [
    ...(w.membership ? [{ key: 'm', label: 'MEMBERSHIP', big: w.membership.name, sub: w.membership.renews ? `renews ${day(w.membership.renews)}` : 'active', bg: 'linear-gradient(135deg,#5b6470,#2f353d)', detail: [{ a: 'Membership', b: w.membership.name }] }] : []),
    ...(w.packages || []).map((p: any, i: number) => ({ key: `p${i}`, label: 'PACKAGE', big: `${p.left} visit${p.left === 1 ? '' : 's'}`, sub: `left on ${p.name}`, bg: 'linear-gradient(135deg,#55585e,#26282d)', detail: [{ a: p.name, b: `${p.left} left` }] })),
    ...((w.gift || []).length ? [{ key: 'g', label: 'GIFT CARD', big: money(w.gift.reduce((n: number, g: any) => n + g.cents, 0)), sub: w.gift.length === 1 && w.gift[0].from ? `from ${w.gift[0].from}` : `${w.gift.length} gift card${w.gift.length === 1 ? '' : 's'}`, bg: 'linear-gradient(135deg,#3a3d44,#16171a)',
      detail: w.gift.map((g: any) => ({ a: g.from ? `From ${g.from}` : 'Gift card', b: `${money(g.cents)}${g.endsAt ? ` · ends ${day(g.endsAt)}` : ''}`, warn: soon(g.endsAt) })) }] : []),
    ...(d.creditCents > 0 ? [{ key: 'c', label: lines.some((l) => l.referral) ? 'REFERRAL CREDIT' : 'CREDIT', big: money(d.creditCents), sub: 'ready for your next visit', bg: 'linear-gradient(135deg,#2a8a5c,#145236)',
      tag: lines.find((l) => soon(l.endsAt)) ? `${money(lines.find((l) => soon(l.endsAt)).cents)} ends ${day(lines.find((l) => soon(l.endsAt)).endsAt).replace(/, \d{4}$/, '')}` : undefined,
      detail: lines.map((l) => ({ a: l.referral ? l.why : l.why, b: `${money(l.cents)}${l.endsAt ? ` · ends ${day(l.endsAt)}` : ''}`, warn: soon(l.endsAt) })) }] : []),
  ];
  if (!cards.length && !d.on) return null;
  const totalCents = (d.creditCents || 0) + (w.gift || []).reduce((n: number, g: any) => n + g.cents, 0);
  const visitsLeft = (w.packages || []).reduce((n: number, p: any) => n + p.left, 0);
  const sel = cards.find((c) => c.key === openCard) || null;
  const share = async () => { const text = `I love ${d.business} and thought you would too. Here is ${money(d.friendCents)} off your first visit:`;
    try { if ((navigator as any).share) { await (navigator as any).share({ title: d.business, text, url: d.link }); return; } } catch { return; }
    try { await navigator.clipboard.writeText(`${text} ${d.link}`); setMsg({ ok: true, t: 'Copied. Paste it in a message to your friend.' }); } catch { setMsg({ ok: false, t: d.link }); } };
  const sendGift = async () => { setBusy(true); setMsg(null); const r = await call({ action: 'gift', token, firstName: first, phone }); setBusy(false);
    if (!r?.ok) { setMsg({ ok: false, t: r?.error || 'That didn’t work.' }); return; }
    const ios = /iPad|iPhone|iPod/.test(navigator.userAgent); window.location.href = `sms:${r.to}${ios ? '&' : '?'}body=${encodeURIComponent(r.text)}`;
    setGift(false); setFirst(''); setPhone(''); setMsg({ ok: true, t: `Your message to ${first} is ready to send.` }); void load(); };
  const cardFace = (c: Card, big = false) => (
    <div className="relative h-full overflow-hidden rounded-[22px] p-[18px] text-white" style={{ background: c.bg, boxShadow: '0 18px 36px -20px rgba(22,23,26,.7)' }}>
      <span aria-hidden="true" className="absolute -right-10 -top-10 h-36 w-36 rounded-full" style={{ background: 'rgba(255,255,255,.10)' }} />
      <div className="flex justify-between text-[11px] tracking-[0.18em] opacity-90"><span>{c.label}</span><span>{String(d.business || '').toUpperCase().slice(0, 16)}</span></div>
      <p className={`${big ? 'mt-4 text-[44px]' : 'mt-3 text-[36px]'} font-light leading-none tracking-[-0.03em]`}>{c.key === 'c' && big ? <Count to={d.creditCents} still={still} /> : c.big}</p>
      <p className="mt-1 text-[12.5px] opacity-90">{c.sub}</p>
      {c.tag && <span className="absolute bottom-4 right-4 rounded-full px-2.5 py-1 text-[11px]" style={{ background: 'rgba(255,255,255,.22)' }}>{c.tag}</span>}
    </div>);
  const step = 46; const stackH = cards.length ? 190 + (cards.length - 1) * step : 0;
  return (
    <section className="space-y-4 rounded-3xl p-5" style={{ background: SOFT, color: INK, fontFamily: '"Plus Jakarta Sans", system-ui, sans-serif' }} aria-label="Your wallet">
      {cards.length > 0 && <>
        <div className="flex items-baseline justify-between"><p className="text-[26px] font-light tracking-[-0.02em]">Your wallet</p>
          <p className="text-[12.5px]" style={{ color: MUTED }}>{[totalCents ? money(totalCents) : '', visitsLeft ? `${visitsLeft} visit${visitsLeft === 1 ? '' : 's'}` : ''].filter(Boolean).join(' and ')}{totalCents || visitsLeft ? ' with us' : ''}</p></div>
        <AnimatePresence mode="wait">
          {!sel ? <motion.div key="stack" className="relative" style={{ height: stackH }} initial={false} exit={{ opacity: 0 }}>
            {cards.map((c, i) => <motion.button key={c.key} type="button" onClick={() => setOpenCard(c.key)} aria-label={`${c.label.toLowerCase()}: ${c.big} ${c.sub}. Show details`} className="absolute inset-x-0 block h-[190px] text-left"
              style={{ zIndex: i + 1 }} initial={still ? { top: i * step } : { top: (cards.length - 1) * step * 0.9 + i * 4 }} animate={{ top: i * step }} transition={{ duration: 0.45, ease, delay: still ? 0 : 0.1 + i * 0.05 }} layoutId={still ? undefined : `card-${c.key}`}>{cardFace(c)}</motion.button>)}
          </motion.div> : <motion.div key="open" initial={false} className="space-y-3">
            <motion.div layoutId={still ? undefined : `card-${sel.key}`} className="h-[200px]" transition={{ duration: 0.4, ease }}>{cardFace(sel, true)}</motion.div>
            <div className="space-y-2.5 rounded-[18px] bg-white p-4">{sel.detail.map((x, i) => <div key={i} className="flex justify-between gap-3 text-[14px]" style={{ color: x.warn ? '#b45309' : INK }}><span>{x.a}</span><span className="text-right">{x.b}</span></div>)}</div>
            {sel.key === 'c' && <p className="rounded-[18px] bg-white p-4 text-[13px] leading-[1.5]" style={{ color: MUTED }}>It’s used soonest-ending first. A month before referral credit ends, we’ll send you one gentle reminder.</p>}
            <button type="button" onClick={() => setOpenCard(null)} className="h-11 w-full rounded-full border bg-white text-[14px] font-semibold" style={{ borderColor: LINE }}>Back to my wallet</button>
          </motion.div>}
        </AnimatePresence>
        {(d.creditCents > 0 || (w.gift || []).length > 0) && <p className="text-center text-[12.5px]" style={{ color: MUTED }}>Comes off at checkout by itself. Nothing to ask for.</p>}
      </>}

      {d.on && <div className="space-y-3 rounded-[20px] bg-white p-4">
        <p className="text-[20px] font-light tracking-[-0.02em]">{(d.friends || []).length ? 'Friends you’ve sent' : 'Share with a friend'}</p>
        <p className="text-[13.5px] leading-[1.5]" style={{ color: MUTED }}>Give a friend {money(d.friendCents)} off their first visit. {d.unlock === 'paid' ? 'When they’ve been in' : 'When they book'}, you get {money(d.rewardCents)} toward your next one.</p>
        {(d.friends || []).map((f: any, i: number) => <Seen key={i} id={`${token}-${f.first}-${f.step}`}>{(fresh) => <div className="space-y-2">
          <div className="flex items-center gap-3"><span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-[17px] font-light text-white" style={{ background: f.step >= 4 ? GREEN : f.step >= 2 ? INK : '#9a9ca3' }} aria-hidden="true">{String(f.first)[0]}</span>
            <div className="min-w-0 flex-1"><div className="flex justify-between text-[14px]"><b>{f.first}</b><span className="text-[12.5px]" style={{ color: f.step >= 4 ? GREEN : MUTED }}>{f.line}</span></div>
              <div className="mt-1.5 flex gap-1" aria-label={`Step ${Math.max(0, f.step)} of 4`}>{[0, 1, 2, 3].map((k) => <span key={k} className="h-1 flex-1 overflow-hidden rounded-full" style={{ background: LINE }}>
                <motion.span className="block h-full" style={{ background: f.step >= 4 ? GREEN : INK }} initial={still ? false : { width: '0%' }} animate={{ width: k < f.step ? '100%' : '0%' }} transition={{ duration: 0.4, ease, delay: still ? 0 : 0.2 + k * 0.12 }} /></span>)}</div></div></div>
          {fresh && f.step >= 4 && <motion.div className="flex items-center gap-3 rounded-[16px] p-3" style={{ background: '#e8f3ec' }} initial={still ? false : { scale: 0.96, opacity: 0 }} animate={{ scale: [0.96, 1.02, 1], opacity: 1 }} transition={{ duration: 0.6, ease, delay: 0.7 }}>
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke={GREEN} strokeWidth="2.4" strokeLinecap="round" aria-hidden="true"><circle cx="12" cy="12" r="10" strokeOpacity=".25" /><motion.path d="M7 12.5l3.2 3.2L17 9" initial={still ? false : { pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 0.5, ease, delay: 0.9 }} /></svg>
            <span className="text-[14px]"><b>{f.first} came in!</b> {money(d.rewardCents)} just landed in your wallet.</span></motion.div>}
        </div>}</Seen>)}
        {d.link && <div className="grid grid-cols-2 gap-2"><button type="button" onClick={share} className="h-11 rounded-full text-[14px] font-semibold text-white" style={{ background: INK }}>Share my link</button>
          <button type="button" onClick={() => setGift(!gift)} className="h-11 rounded-full border text-[14px] font-semibold" style={{ borderColor: INK }}>Gift a friend</button></div>}
        <AnimatePresence>{gift && <motion.div className="space-y-2 overflow-hidden" initial={still ? false : { height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.3, ease }}>
          <VisitInput label="Their first name" value={first} onChange={setFirst} placeholder="Their first name" />
          <VisitInput label="Their mobile" value={phone} onChange={setPhone} placeholder="Their mobile" />
          <button type="button" onClick={sendGift} disabled={busy} className="h-11 w-full rounded-full text-[14px] font-semibold text-white disabled:opacity-60" style={{ background: INK }}>{busy ? 'One moment…' : 'Send from my phone'}</button>
          <p className="text-[12.5px]" style={{ color: MUTED }}>Opens your messages with a note from you. We never text your friend.</p></motion.div>}</AnimatePresence>
        {msg && <p className="text-[13.5px] font-semibold" style={{ color: msg.ok ? GREEN : '#b42318' }}>{msg.t}</p>}
        {d.link && <a href={d.link.replace(/\/ref\/([^/]+)\/.*/, '/ref/$1/terms')} className="block text-[12.5px] underline underline-offset-2" style={{ color: MUTED }}>Terms · credit lasts {d.months} months</a>}
      </div>}
    </section>);
}
