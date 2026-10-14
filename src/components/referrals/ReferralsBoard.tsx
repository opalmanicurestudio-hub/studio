'use client';
// src/components/referrals/ReferralsBoard.tsx — REFERRALS for the business (design canvas RF14 + RF15). The period's
// story first: from a shared link opened to credit given, what it brought in for what it cost, month by month, and what
// referred clients are worth. Then an inbox — what needs a person, who's waiting for a first visit, credit given,
// everyone — beside the champions and quick actions. Settings and the welcome page live on their own page
// (/referrals/settings). Paid money only. /api/referrals (lib/referrals-server).
import * as React from 'react';
import Link from 'next/link';
import { motion, useReducedMotion, animate } from 'framer-motion';
import { payPost } from '@/components/pay/pay-client';
import { CircleBoard } from '@/components/referrals/CircleBoard';
import { CampaignsBoard } from '@/components/referrals/CampaignsBoard';

const INK = 'hsl(var(--foreground))', MUTED = 'hsl(var(--muted-foreground))', LINE = 'hsl(var(--border))', SOFT = 'hsl(var(--secondary))', GREEN = '#1f7a4d', MINT = '#7fd1a5', AMBER = '#b45309', RED = '#b42318';
const ease = [0.22, 1, 0.36, 1] as const;
const money = (c: number) => { const d = (Number(c) || 0) / 100; return `$${d % 1 ? d.toFixed(2) : d.toLocaleString('en-US')}`; };
const day = (iso?: string | null) => (iso ? new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '');
const monthName = (m: string, len: 'short' | 'long' = 'short') => new Date(`${m}-15T12:00:00Z`).toLocaleDateString('en-US', { month: len, timeZone: 'UTC' });
const pct = (a: number, b: number) => (b > 0 ? `${Math.round((a / b) * 100)}%` : '—');
const HOLD: Record<string, string> = { same_card: 'Same saved card as the person who referred. Could be one household.', cap: 'Monthly limit reached. It’s given next month on its own.' };
const VIA: Record<string, string> = { link: 'their link', gift: 'a gift', named: 'named at booking', brought: 'booked together' };
const STATUS: Record<string, [string, string]> = { booked: ['Waiting', MUTED], held: ['Needs you', AMBER], unmatched: ['Needs you', AMBER], rewarded: ['Credit given', GREEN], declined: ['No reward', MUTED], lapsed: ['Didn’t visit', MUTED] };
const PERIODS: { id: string; label: string }[] = [{ id: 'month', label: 'This month' }, { id: '3m', label: '3 months' }, { id: 'year', label: 'This year' }];

function Count({ to, fmt = (n: number) => String(n), still }: { to: number; fmt?: (n: number) => string; still: boolean }) {
  const [v, setV] = React.useState(still ? to : 0);
  React.useEffect(() => { if (still) { setV(to); return; } const c = animate(0, to, { duration: 0.8, ease, onUpdate: (x) => setV(Math.round(x)) }); return () => c.stop(); }, [to, still]);
  return <>{fmt(v)}</>;
}
const Face = ({ name, size = 34 }: { name: string; size?: number }) => <span className="flex shrink-0 items-center justify-center rounded-full font-semibold" style={{ width: size, height: size, background: SOFT, fontSize: size * 0.38 }} aria-hidden="true">{String(name || '?')[0]}</span>;

/** The dark story card: the path from a link to credit, what it brought in, and month by month. */
function Story({ d, still }: { d: any; still: boolean }) {
  const f = d.funnel || { opened: 0, booked: 0, visited: 0, credited: 0 }; const tl = d.tiles || {};
  const steps = [{ k: 'Links opened', n: f.opened, c: 'rgba(255,255,255,.88)', sub: '' }, { k: 'Booked', n: f.booked, c: 'rgba(255,255,255,.5)', sub: f.opened && f.booked ? `${pct(f.booked, f.opened)} of opens` : f.booked ? 'from any route' : '' },
    { k: 'First visit', n: f.visited, c: 'rgba(255,255,255,.3)', sub: f.booked ? `${pct(f.visited, f.booked)} of bookings` : '' }, { k: 'Credit given', n: f.credited, c: MINT, sub: f.visited ? `${pct(f.credited, f.visited)} of visits` : '' }];
  const top = Math.max(1, ...steps.map((s) => s.n));
  const series: any[] = d.series || []; const peak = Math.max(1, ...series.map((x) => x.paidCents));
  const worthTop = Math.max(1, tl.referredWorthCents || 0, tl.othersWorthCents || 0);
  return <section className="relative overflow-hidden rounded-[26px] p-5 text-white md:p-7" style={{ background: 'linear-gradient(135deg,#2c2f35 0%,#16171a 60%)', boxShadow: '0 30px 60px -34px rgba(22,23,26,.75)' }} aria-label="How referrals turned into paid visits">
    <div aria-hidden="true" className="absolute -right-24 -top-24 h-72 w-72 rounded-full" style={{ background: 'radial-gradient(circle, rgba(127,209,165,.16), transparent 70%)' }} />
    <div className="relative grid gap-7 lg:grid-cols-[1.35fr_1fr]">
      <div className="min-w-0">
        <p className="text-[11px] tracking-[0.16em] opacity-70">FROM A SHARED LINK TO A PAID VISIT</p>
        <div className="mt-4 space-y-3">
          {steps.map((s, i) => <div key={s.k} className="grid grid-cols-[96px_1fr] items-center gap-3 md:grid-cols-[116px_1fr]">
            <div className="min-w-0"><p className="text-[12.5px] opacity-75">{s.k}</p>{s.sub && <p className="text-[11px] opacity-55">{s.sub}</p>}</div>
            <div className="relative h-11 overflow-hidden rounded-[12px]" style={{ background: 'rgba(255,255,255,.06)' }}>
              <motion.div className="absolute inset-y-0 left-0 rounded-[12px]" style={{ background: s.c }} initial={still ? false : { width: 0 }} animate={{ width: `${Math.max(s.n ? 3 : 0, (s.n / top) * 100)}%` }} transition={{ duration: 0.8, ease, delay: 0.1 + i * 0.12 }} />
              <p className="absolute inset-y-0 left-3 flex items-center text-[22px] font-light tracking-[-0.02em]" style={{ color: i === 0 && s.n / top > 0.25 ? INK : '#fff', mixBlendMode: 'normal' }}><Count to={s.n} still={still} /></p></div>
          </div>)}
        </div>
      </div>
      <div className="min-w-0 lg:border-l lg:pl-7" style={{ borderColor: 'rgba(255,255,255,.12)' }}>
        <p className="text-[11px] tracking-[0.16em] opacity-70">BROUGHT IN</p>
        <p className="mt-1 text-[46px] font-light leading-none tracking-[-0.03em] md:text-[54px]" style={{ color: MINT }}><Count to={tl.paidCents || 0} fmt={money} still={still} /></p>
        <p className="mt-2 text-[13.5px] opacity-80">{tl.rewardCents ? <>for {money(tl.rewardCents)} in credit · <b className="font-semibold text-white">{tl.returnX}× back</b></> : 'paid visits from referred friends'}</p>
        <div className="mt-5 space-y-2.5">
          <p className="text-[12px] opacity-70">What a client spends in a year</p>
          {[['Referred', tl.referredWorthCents || 0, MINT], ['Everyone else', tl.othersWorthCents || 0, 'rgba(255,255,255,.4)']].map(([k, v, c]: any, i) => <div key={k}>
            <div className="flex justify-between text-[12.5px]"><span className="opacity-85">{k}</span><span className="font-semibold">{v ? money(v) : '—'}</span></div>
            <div className="mt-1 h-2 rounded-full" style={{ background: 'rgba(255,255,255,.1)' }}><motion.div className="h-2 rounded-full" style={{ background: c }} initial={still ? false : { width: 0 }} animate={{ width: `${(v / worthTop) * 100}%` }} transition={{ duration: 0.8, ease, delay: 0.3 + i * 0.1 }} /></div></div>)}
        </div>
      </div>
    </div>
    {series.length > 1 && <div className="relative mt-7 border-t pt-5" style={{ borderColor: 'rgba(255,255,255,.12)' }}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3"><p className="text-[11px] tracking-[0.16em] opacity-70">MONTH BY MONTH</p><p className="text-[11.5px] opacity-60">paid visits · ✦ friends who booked</p></div>
      <div className="mt-3 flex h-[150px] items-stretch gap-2 md:gap-3" role="list">
        {series.map((x, i) => { const last = i === series.length - 1; return <div key={x.month} role="listitem" className="flex h-full min-w-0 flex-1 flex-col justify-end" aria-label={`${monthName(x.month, 'long')}: ${money(x.paidCents)}, ${x.friends} friends booked`} title={`${monthName(x.month, 'long')} · ${money(x.paidCents)} · ${x.friends} friend${x.friends === 1 ? '' : 's'}`}>
          <div className="flex min-h-0 flex-1 flex-col justify-end"><p className="mb-1 truncate text-center text-[10.5px] opacity-70">{x.paidCents ? money(x.paidCents) : ''}</p>
          <motion.div className="w-full rounded-t-[8px] rounded-b-[3px]" style={{ background: last ? MINT : 'rgba(255,255,255,.28)' }} initial={still ? false : { height: 0 }} animate={{ height: `${Math.max(3, (x.paidCents / peak) * 80)}%` }} transition={{ duration: 0.7, ease, delay: 0.2 + i * 0.05 }} /></div>
          <p className="mt-1.5 text-center text-[11px] opacity-70">{monthName(x.month)}<span className="block text-[10px] opacity-75">{x.friends ? `${x.friends} ✦` : ''}</span></p></div>; })}
      </div></div>}
  </section>;
}

export function ReferralsBoard({ tenantId }: { tenantId: string }) {
  type V = 'referrals' | 'circle' | 'campaigns';
  const [view, setView] = React.useState<V>(() => { try { const h = typeof window !== 'undefined' ? window.location.hash : ''; return h === '#circle' ? 'circle' : h === '#campaigns' ? 'campaigns' : 'referrals'; } catch { return 'referrals'; } });
  const go = (v: V) => { setView(v); try { history.replaceState(null, '', v === 'referrals' ? ' ' : `#${v}`); } catch { /* fine */ } };
  return <div className="mx-auto mt-4 max-w-[1180px]" style={{ color: INK, fontFamily: '"Plus Jakarta Sans", system-ui, sans-serif' }}>
    <div className="flex gap-1 rounded-full p-1" style={{ background: SOFT, width: 'fit-content' }} role="tablist" aria-label="Referrals, the Circle, or campaigns">
      {(['referrals', 'circle', 'campaigns'] as const).map((v) => <button key={v} type="button" role="tab" aria-selected={view === v} onClick={() => go(v)} className="rounded-full px-4 py-1.5 text-[13px] font-semibold capitalize" style={view === v ? { background: 'hsl(var(--card))', boxShadow: '0 1px 2px rgba(0,0,0,.12)' } : { color: MUTED }}>{v}</button>)}</div>
    {view === 'circle' ? <div className="mt-4 pb-10"><CircleBoard tenantId={tenantId} /></div> : view === 'campaigns' ? <div className="mt-4 pb-10"><CampaignsBoard tenantId={tenantId} /></div> : <Overview tenantId={tenantId} />}
  </div>;
}

function Overview({ tenantId }: { tenantId: string }) {
  const still = !!useReducedMotion();
  const [period, setPeriod] = React.useState('month'); const [d, setD] = React.useState<any>(null); const [tab, setTab] = React.useState('needs');
  const [busy, setBusy] = React.useState(''); const [note, setNote] = React.useState<{ ok: boolean; t: string } | null>(null); const [phones, setPhones] = React.useState<Record<string, string>>({});
  const [sample, setSample] = React.useState<string | null>(null);
  const load = React.useCallback(() => payPost('/api/referrals', { tenantId, action: 'overview', period }).then(setD), [tenantId, period]);
  React.useEffect(() => { if (tenantId) void load(); }, [tenantId, load]);
  React.useEffect(() => { if (tenantId) void payPost('/api/referrals', { tenantId, action: 'sample' }).then((r) => setSample(r?.ok ? r.path : null)); }, [tenantId]);
  React.useEffect(() => { if (d?.ok && tab === 'needs' && !(d.review || []).length && (d.waiting || []).length) setTab('waiting'); }, [d]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!d) return <p className="mt-6" style={{ color: MUTED }}>Loading…</p>;
  if (!d.ok) return <p className="mt-6" style={{ color: RED }}>{d.error || 'Referrals couldn’t load.'}</p>;
  const on = !!d.settings?.on; const last = d.months?.[d.months.length - 1] || '';
  const title = period === 'month' ? `${monthName(last, 'long')} so far` : period === '3m' ? 'The last 3 months' : 'The last 12 months';
  const decide = async (id: string, decision: string, referrerId?: string) => { setBusy(id); setNote(null); const r = await payPost('/api/referrals', { tenantId, action: 'decide', id, decision, referrerPhone: phones[id] || '', ...(referrerId ? { referrerId } : {}) }); setBusy('');
    setNote(r?.ok ? { ok: true, t: decision === 'approve' ? 'Credit given.' : decision === 'confirm' ? (r.declined ? 'Matched, but it isn’t eligible.' : 'Matched. Their credit follows the friend’s first paid visit.') : 'Marked: no reward.' } : { ok: false, t: r?.error || 'That didn’t work.' }); void load(); };
  const giveNow = async (id: string) => { setBusy(id); setNote(null); const r = await payPost('/api/referrals', { tenantId, action: 'give_now', id }); setBusy(''); setNote(r?.ok ? { ok: true, t: 'Credit given.' } : { ok: false, t: r?.error || 'That didn’t work.' }); void load(); };
  const tabs = [{ id: 'needs', label: 'Needs you', n: (d.review || []).length }, { id: 'waiting', label: 'Waiting', n: (d.waiting || []).length }, { id: 'rewarded', label: 'Credit given', n: null }, { id: 'all', label: 'Everyone', n: null }];
  const btn = (dark: boolean) => `h-9 rounded-full px-4 text-[13px] font-semibold ${dark ? 'text-white' : 'border bg-card'}`;
  const champs: any[] = d.top || []; const champTop = Math.max(1, ...champs.map((p) => p.friends));
  const Empty = ({ t }: { t: string }) => <div className="flex items-center gap-3 rounded-[18px] border border-dashed p-6" style={{ borderColor: '#d8d9dc' }}><span className="flex h-9 w-9 items-center justify-center rounded-full" style={{ background: 'color-mix(in srgb, #1f7a4d 11%, transparent)', color: GREEN }} aria-hidden="true">✓</span><p className="text-[14px]" style={{ color: MUTED }}>{t}</p></div>;
  const Row = ({ r, right }: { r: any; right?: React.ReactNode }) => <div className="flex items-center gap-3 rounded-[16px] border bg-card p-3.5" style={{ borderColor: LINE }}><Face name={r.friend} />
    <div className="min-w-0 flex-1"><p className="truncate text-[14.5px] font-semibold">{r.friend}{r.referrer ? <span style={{ color: MUTED }}> ← {r.referrer}</span> : null}</p>
      <p className="truncate text-[12.5px]" style={{ color: MUTED }}>{r.status === 'rewarded' ? `${money(r.rewardCents)} credit given ${day(r.rewardedAt)}` : r.bookedAt ? `Booked ${day(r.bookedAt)}` : day(r.createdAt)}{r.via ? ` · by ${VIA[r.via] || r.via}` : ''}</p></div>{right}</div>;

  return (
    <div className="mt-4 space-y-5 pb-10">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div><p className="text-[12px] tracking-[0.1em]" style={{ color: MUTED }}>referrals</p><h1 className="text-[30px] font-light tracking-[-0.02em]">{title}</h1>
          <p className="text-[13.5px]" style={{ color: MUTED }}>How referrals are growing the business. Paid visits only.</p></div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex gap-1 rounded-full p-1" style={{ background: SOFT }} role="radiogroup" aria-label="Period">{PERIODS.map((p) => <button key={p.id} type="button" role="radio" aria-checked={period === p.id} onClick={() => setPeriod(p.id)} className="rounded-full px-3.5 py-1.5 text-[12.5px] font-semibold" style={period === p.id ? { background: 'hsl(var(--card))', boxShadow: '0 1px 2px rgba(0,0,0,.12)' } : { color: MUTED }}>{p.label}</button>)}</div>
          <Link href="/referrals/settings" className="inline-flex h-9 items-center rounded-full border bg-card px-4 text-[13px] font-semibold" style={{ borderColor: LINE }}>Settings</Link></div>
      </div>
      {!on && <div className="flex flex-wrap items-center justify-between gap-3 rounded-[18px] p-4" style={{ background: '#fdf1e3' }}><p className="text-[14px]"><b>Referrals are off.</b> Clients can’t share a link until you switch them on.</p>
        <Link href="/referrals/settings" className={btn(true)} style={{ background: INK, display: 'inline-flex', alignItems: 'center' }}>Set up referrals</Link></div>}
      {note && <p className="text-[13.5px] font-semibold" style={{ color: note.ok ? GREEN : RED }}>{note.t}</p>}
      <Story d={d} still={still} />

      <div className="grid items-start gap-5 lg:grid-cols-[1fr_340px]">
        <section className="min-w-0 space-y-3" aria-label="Referrals to look at">
          <div className="flex gap-1 overflow-x-auto rounded-full p-1" style={{ background: SOFT, width: 'fit-content', maxWidth: '100%' }} role="tablist">
            {tabs.map((t) => <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} onClick={() => setTab(t.id)} className="whitespace-nowrap rounded-full px-3.5 py-1.5 text-[13px] font-semibold" style={tab === t.id ? { background: 'hsl(var(--card))', boxShadow: '0 1px 2px rgba(0,0,0,.12)' } : { color: MUTED }}>
              {t.label}{t.n ? <span className="ml-1.5 rounded-full px-1.5 text-[11px]" style={{ background: t.id === 'needs' ? '#fdf1e3' : '#e5e6ea', color: t.id === 'needs' ? AMBER : INK }}>{t.n}</span> : null}</button>)}</div>
          {tab === 'needs' && ((d.review || []).length ? d.review.map((r: any) => { const ev = r.evidence; const hh = ev && (ev.sameAddress || ev.sameLastName);
            return <motion.div key={r.id} layout={!still} className="space-y-3 rounded-[18px] border bg-card p-4" style={{ borderColor: '#f3dfc4' }}>
              <div className="flex items-start gap-3"><Face name={r.friend} size={38} /><div className="min-w-0 flex-1"><p className="text-[15px] font-semibold">{r.status === 'unmatched' ? `${r.friend} said ${String(r.named || '').split(',')[0]} recommended them` : `${ev?.friendName || r.friend} ← ${r.referrer}`}</p>
                <p className="text-[13px]" style={{ color: AMBER }}>{r.status === 'unmatched' ? `It didn’t match one client${r.named ? ` (they gave a phone ending ${String(r.named).split('ending ')[1] || ''})` : ''}. Pick who it was, or ask at check-in: there’s a note on their visit.` : r.holdReason === 'same_card' ? `${r.friend}’s visit was paid with ${r.referrer}’s saved card.` : HOLD[r.holdReason] || 'Held for a look.'}</p></div></div>
              {ev && <div className="space-y-2 rounded-[14px] p-3" style={{ background: SOFT }}>
                <div className="flex flex-wrap gap-1.5">{[[ev.card, true], ['Same address', ev.sameAddress], ['Same last name', ev.sameLastName]].map(([t, on]: any) => <span key={t} className="rounded-full px-2.5 py-1 text-[12px] font-semibold" style={on ? { background: 'hsl(var(--card))', color: INK } : { background: 'transparent', color: MUTED, textDecoration: 'line-through' }}>{t}</span>)}</div>
                <p className="text-[12.5px] leading-snug" style={{ color: MUTED }}>{hh ? 'This looks like one household, like a parent paying for a teen or partners sharing a card. That’s usually a real new client.' : 'No shared address or last name. It could be someone paying for a friend, or one person booking twice under two names.'}</p></div>}
              {r.status === 'unmatched' ? <div className="space-y-2">
                  {(r.candidates || []).length > 0 && <div className="divide-y rounded-[14px] border" style={{ borderColor: LINE }}>{r.candidates.map((c: any) => <div key={c.id} className="flex items-center gap-3 px-3 py-2.5">
                    <div className="min-w-0 flex-1"><p className="truncate text-[14px] font-semibold">{c.name}{c.phoneMatch && <span className="ml-2 rounded-full px-2 py-0.5 text-[11px]" style={{ background: 'color-mix(in srgb, #1f7a4d 11%, transparent)', color: GREEN }}>number matches</span>}</p><p className="text-[12px]" style={{ color: MUTED }}>{c.last4 ? `phone ···${c.last4}` : 'no phone'}{c.lastVisit ? ` · last visit ${day(c.lastVisit)}` : ''}</p></div>
                    <button type="button" disabled={busy === r.id} onClick={() => decide(r.id, 'confirm', c.id)} className={btn(true)} style={{ background: INK }}>It was {String(c.name).split(' ')[0]}</button></div>)}</div>}
                  <div className="flex flex-wrap gap-2"><input value={phones[r.id] || ''} onChange={(e) => setPhones({ ...phones, [r.id]: e.target.value })} placeholder={(r.candidates || []).length ? 'Or their mobile' : 'Their mobile'} aria-label="Mobile of the person who referred" inputMode="tel" className="h-9 min-w-0 flex-1 rounded-full border px-3.5 text-[13px]" style={{ borderColor: LINE }} />
                    <button type="button" disabled={busy === r.id || !(phones[r.id] || '').trim()} onClick={() => decide(r.id, 'confirm')} className={btn(true)} style={{ background: INK }}>Match</button>
                    <button type="button" disabled={busy === r.id} onClick={() => decide(r.id, 'decline')} className={btn(false)} style={{ borderColor: LINE }}>Leave it</button></div></div>
                : r.holdReason !== 'cap' && <div className="flex flex-wrap gap-2"><button type="button" disabled={busy === r.id} onClick={() => decide(r.id, 'approve')} className={btn(true)} style={{ background: INK }}>{ev ? 'Different people: give credit' : 'Approve'}</button>
                  <button type="button" disabled={busy === r.id} onClick={() => decide(r.id, 'decline')} className={btn(false)} style={{ borderColor: LINE }}>{ev ? 'Same person: no reward' : 'No reward'}</button></div>}
            </motion.div>; }) : <Empty t="Nothing needs you. Matches and rewards are running on their own." />)}
          {tab === 'waiting' && ((d.waiting || []).length ? <><p className="text-[12.5px]" style={{ color: MUTED }}>{d.settings?.unlock === 'paid' ? 'Credit is given a day after the friend’s first paid visit. Once they’re checked out, you can give it now.' : 'Credit is given once they’ve booked.'}</p>
            {d.waiting.map((r: any) => <Row key={r.id} r={r} right={<button type="button" disabled={busy === r.id} onClick={() => giveNow(r.id)} className={btn(false)} style={{ borderColor: LINE }}>Give credit now</button>} />)}</> : <Empty t="No friends waiting for a first visit." />)}
          {tab === 'rewarded' && ((d.rewarded || []).length ? d.rewarded.map((r: any) => <Row key={r.id} r={r} right={<span className="rounded-full px-2.5 py-1 text-[12px] font-semibold" style={{ background: 'color-mix(in srgb, #1f7a4d 11%, transparent)', color: GREEN }}>{money(r.rewardCents)}</span>} />) : <Empty t="No credit given yet." />)}
          {tab === 'all' && ((d.everyone || []).length ? d.everyone.map((r: any) => { const [lab, c] = STATUS[r.status] || [r.status, MUTED]; return <Row key={r.id} r={r} right={<span className="text-[12px] font-semibold" style={{ color: c }}>{lab}</span>} />; }) : <Empty t="Nobody yet. Once clients share their link, friends show here." />)}
        </section>

        <aside className="space-y-4">
          <section className="rounded-[20px] border bg-card p-4" style={{ borderColor: LINE }} aria-label="Your champions">
            <div className="flex items-baseline justify-between"><p className="text-[16px] font-semibold">Your champions</p><p className="text-[12px]" style={{ color: MUTED }}>{PERIODS.find((p) => p.id === period)?.label.toLowerCase()}</p></div>
            {champs.length ? <ol className="mt-2 space-y-3">{champs.slice(0, 6).map((p, i) => <li key={p.clientId} className="space-y-1.5">
              <div className="flex items-center gap-2.5"><span className="w-4 text-[12px] font-bold" style={{ color: MUTED }}>{i + 1}</span><Face name={p.name} size={32} />
                <div className="min-w-0 flex-1"><p className="truncate text-[14px] font-semibold">{p.name}</p><p className="truncate text-[12px]" style={{ color: MUTED }}>{p.friends} friend{p.friends === 1 ? '' : 's'} · {p.visited} visited{p.opens ? ` · ${p.opens} opens` : ''}</p></div>
                {p.earnedCents > 0 && <span className="text-[12.5px] font-semibold" style={{ color: GREEN }}>{money(p.earnedCents)}</span>}</div>
              <div className="ml-[26px] h-1.5 rounded-full" style={{ background: SOFT }}><motion.div className="h-1.5 rounded-full" style={{ background: i === 0 ? GREEN : '#9a9ca3' }} initial={still ? false : { width: 0 }} animate={{ width: `${(p.friends / champTop) * 100}%` }} transition={{ duration: 0.7, ease, delay: 0.1 * i }} /></div></li>)}</ol>
              : <p className="mt-2 text-[13px]" style={{ color: MUTED }}>Nobody yet this {period === 'month' ? 'month' : 'period'}. The people who send friends show here so you can thank them.</p>}
          </section>
          <section className="rounded-[20px] border bg-card p-2" style={{ borderColor: LINE }} aria-label="Quick actions">
            <p className="px-2.5 pb-1 pt-2 text-[11px] tracking-[0.14em]" style={{ color: MUTED }}>QUICK ACTIONS</p>
            {[['Try it as a client', '/referrals/settings#try'], ['See your welcome page', sample], ['Welcome page and layout', '/referrals/settings#welcome'], ['Amounts and rules', '/referrals/settings#program']].filter(([, h]) => h).map(([t, h]) =>
              String(h).startsWith('/ref/') ? <a key={t} href={String(h)} target="_blank" rel="noreferrer" className="flex items-center justify-between rounded-[12px] px-2.5 py-2.5 text-[14px] hover:bg-secondary">{t}<span style={{ color: MUTED }}>↗</span></a>
                : <Link key={t} href={String(h)} className="flex items-center justify-between rounded-[12px] px-2.5 py-2.5 text-[14px] hover:bg-secondary">{t}<span style={{ color: MUTED }}>›</span></Link>)}
          </section>
        </aside>
      </div>
    </div>);
}
