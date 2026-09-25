'use client';
// src/components/marketing/DemoApp.tsx
//
// THE LIVE DEMO (/demo) — try ClarityFlow without signing up.
//
// A working copy of the owner's view with a sample business in the visitor's
// niche (salon · spa · fitness · shop). It runs entirely in the browser:
// nothing is saved, no accounts, no emails, no payments. Reload = fresh day.
//
// A four-step loop guides the first visit, so the demo tells the story on
// its own:  1 book as a client → 2 accept it → 3 check them out → 4 bring
// them back. Every screen still works freely outside the loop.

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { NICHES, NICHE_ORDER, type NicheKey } from './niches';
import { DEMO, type DemoAppt } from './demo-data';

type Tab = 'today' | 'requests' | 'book' | 'checkout' | 'campaigns' | 'people';
const money = (n: number) => `$${n.toFixed(2).replace(/\.00$/, '')}`;
const first = (name: string) => (name.split('·').pop() || name).trim().split(/\s+/)[0];

const STATUS: Record<string, [string, string]> = {
  requested: ['awaiting you', 'bg-amber-100 text-amber-800'],
  confirmed: ['confirmed', 'bg-stone-100 text-stone-700'],
  arrived: ['arrived', 'bg-emerald-100 text-emerald-800'],
  in_service: ['in service', 'bg-sky-100 text-sky-800'],
  ready: ['ready to pay', 'bg-violet-100 text-violet-800'],
  paid: ['paid ✓', 'bg-emerald-600 text-white'],
};

export function DemoApp({ initialNiche }: { initialNiche: NicheKey }) {
  const [niche, setNiche] = useState<NicheKey>(initialNiche);
  return <DemoBusiness key={niche} niche={niche} onNiche={setNiche} />;
}

function DemoBusiness({ niche, onNiche }: { niche: NicheKey; onNiche: (k: NicheKey) => void }) {
  const d = DEMO[niche];
  const [tab, setTab] = useState<Tab>('book');
  const [day, setDay] = useState<DemoAppt[]>(d.day);
  const [revenue, setRevenue] = useState(0);
  const [done, setDone] = useState({ booked: false, accepted: false, paid: false, sent: false });
  const [toast, setToast] = useState<string | null>(null);
  const say = (t: string) => { setToast(t); window.setTimeout(() => setToast((x) => (x === t ? null : x)), 3200); };

  const awaiting = day.filter((a) => a.status === 'requested');
  const loopDone = done.booked && done.accepted && done.paid && done.sent;
  const set = (id: string, status: DemoAppt['status']) => setDay((ds) => ds.map((a) => (a.id === id ? { ...a, status } : a)));

  const STEPS: [keyof typeof done, string, Tab][] = [
    ['booked', `Book as a ${d.clientWord}`, 'book'],
    ['accepted', 'Accept it as the owner', 'requests'],
    ['paid', 'Check them out', 'checkout'],
    ['sent', 'Bring them back', 'campaigns'],
  ];
  const nextStep = STEPS.find(([k]) => !done[k]);

  const tabs: [Tab, string, number?][] = [
    ['book', 'Booking page'], ['requests', 'Requests', awaiting.length], ['today', 'Today'],
    ['checkout', 'Checkout'], ['campaigns', 'Campaigns'], ['people', d.peopleTab],
  ];

  return (
    <div className="cf-page relative min-h-dvh bg-[#f7f5f2] text-stone-900">
      <style>{`html:has(.cf-page), html:has(.cf-page) body { overflow-x: clip; overflow-y: visible; }`}</style>
      <div aria-hidden className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="absolute -left-32 -top-32 h-[480px] w-[480px] rounded-full bg-gradient-to-br from-amber-200/50 via-rose-200/40 to-transparent blur-3xl" />
        <div className="absolute -right-40 top-1/3 h-[520px] w-[520px] rounded-full bg-gradient-to-bl from-violet-200/40 via-sky-200/30 to-transparent blur-3xl" />
      </div>

      {/* Demo notice */}
      <div className="relative z-30 flex items-center gap-3 bg-stone-900 px-4 py-2.5 text-white" style={{ paddingTop: 'calc(env(safe-area-inset-top, 0px) + 10px)' }}>
        <p className="min-w-0 flex-1 text-[12px]"><span className="font-semibold">Live demo</span> · a sample business. Nothing here is real or saved.</p>
        <Link href={`/request-access?type=${niche}`} className="shrink-0 rounded-full bg-white px-3 py-1.5 text-[11px] font-semibold text-stone-900">Request access</Link>
      </div>

      <div className="relative z-10 mx-auto max-w-3xl px-4 pb-28 pt-4">
        {/* Business + niche */}
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <Link href="/" className="text-[12px] text-stone-500">← ClarityFlow</Link>
            <h1 className="truncate text-2xl font-semibold tracking-tight">{d.biz}</h1>
          </div>
          <select value={niche} onChange={(e) => onNiche(e.target.value as NicheKey)} aria-label="Kind of business" className="glass h-10 rounded-full px-3 text-sm">
            {NICHE_ORDER.map((k) => <option key={k} value={k}>{NICHES[k].label}</option>)}
          </select>
        </div>

        {/* Today at a glance */}
        <div className="mt-4 grid grid-cols-3 gap-2">
          {[['Taken today', money(revenue)], ['Booked', String(day.filter((a) => a.status !== 'requested').length)], ['Awaiting you', String(awaiting.length)]].map(([l, v]) => (
            <div key={l} className="glass rounded-2xl p-3"><p className="text-[10px] uppercase tracking-widest text-stone-400">{l}</p><p className="mt-0.5 text-xl font-semibold tabular-nums">{v}</p></div>
          ))}
        </div>

        {/* The guided loop */}
        <div className="glass mt-3 rounded-3xl p-4">
          {loopDone ? (
            <div className="text-center">
              <p className="text-lg font-semibold">That’s a day at {d.biz}. ✨</p>
              <p className="mt-1 text-sm text-stone-600">Booked, accepted, paid and brought back — all in one place.</p>
              <Link href={`/request-access?type=${niche}`} className="mt-3 inline-block rounded-full bg-stone-900 px-5 py-2.5 text-sm font-medium text-white">Request access</Link>
            </div>
          ) : (
            <>
              <p className="text-[10px] uppercase tracking-widest text-stone-400">Try the loop</p>
              <div className="mt-2 grid grid-cols-2 gap-1.5 sm:grid-cols-4">
                {STEPS.map(([k, label, t], i) => (
                  <button key={k} type="button" onClick={() => setTab(t)}
                    className={`rounded-2xl px-3 py-2 text-left text-[12px] transition-colors ${done[k] ? 'bg-emerald-50 text-emerald-800' : nextStep?.[0] === k ? 'bg-stone-900 text-white' : 'bg-white/60 text-stone-500'}`}>
                    <span className="block text-[10px] opacity-70">{done[k] ? '✓ done' : `Step ${i + 1}`}</span>{label}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>

        {/* Tabs */}
        <nav className="-mx-4 mt-4 flex gap-1.5 overflow-x-auto px-4 pb-1" aria-label="Screens">
          {tabs.map(([k, l, badge]) => (
            <button key={k} type="button" onClick={() => setTab(k)} aria-pressed={tab === k}
              className={`relative h-10 shrink-0 rounded-full px-4 text-sm transition-colors ${tab === k ? 'bg-stone-900 text-white' : 'glass text-stone-600'}`}>
              {l}{badge ? <span className="ml-1.5 rounded-full bg-amber-400 px-1.5 text-[10px] font-bold text-stone-900">{badge}</span> : null}
            </button>
          ))}
        </nav>

        <div className="mt-4">
          {tab === 'book' && <BookingPage d={d} onBook={(a) => { setDay((ds) => [...ds, a]); setDone((x) => ({ ...x, booked: true })); say(`Booked! Now switch hats — accept it as the owner.`); setTab('requests'); }} />}
          {tab === 'requests' && <Requests list={awaiting} onAccept={(a) => { set(a.id, 'confirmed'); setDone((x) => ({ ...x, accepted: true })); say(`Accepted — ${first(a.client)} has been told they’re booked.`); }} onDecline={(a) => { setDay((ds) => ds.filter((x) => x.id !== a.id)); say(`Declined — ${first(a.client)} was invited to pick another time.`); }} />}
          {tab === 'today' && <Today list={day} onStep={(a, s) => { set(a.id, s); if (s === 'ready') { say(`${first(a.client)} is ready to pay.`); } }} onCheckout={() => setTab('checkout')} />}
          {tab === 'checkout' && <Checkout d={d} list={day.filter((a) => ['confirmed', 'arrived', 'in_service', 'ready'].includes(a.status))} onPaid={(a, total) => { set(a.id, 'paid'); setRevenue((r) => r + total); setDone((x) => ({ ...x, paid: true })); say(`Paid · ${money(total)} · receipt sent to ${first(a.client)}.`); }} />}
          {tab === 'campaigns' && <Campaigns d={d} onSent={() => { setDone((x) => ({ ...x, sent: true })); }} />}
          {tab === 'people' && <People d={d} />}
        </div>
      </div>

      {toast && (
        <div className="fixed inset-x-4 z-40 mx-auto max-w-md rounded-2xl bg-stone-900 px-4 py-3 text-sm text-white shadow-2xl" style={{ bottom: 'calc(env(safe-area-inset-bottom, 0px) + 20px)' }} role="status">{toast}</div>
      )}
    </div>
  );
}

// ── Booking page (as the client) ───────────────────────────────────────────
function BookingPage({ d, onBook }: { d: typeof DEMO.salon; onBook: (a: DemoAppt) => void }) {
  const [svc, setSvc] = useState(0);
  const [slot, setSlot] = useState<string | null>(null);
  const [name, setName] = useState('Alex Rivera');
  const s = d.services[svc];
  return (
    <div className="glass rounded-3xl p-5">
      <p className="text-[10px] uppercase tracking-widest text-stone-400">What your {d.clientWord}s see</p>
      <p className="mt-1 text-lg font-semibold">Book with {d.biz}</p>
      <div className="mt-3 space-y-1.5">
        {d.services.map((x, i) => (
          <button key={x.name} type="button" onClick={() => setSvc(i)} className={`flex w-full items-center justify-between rounded-2xl px-4 py-3 text-left text-sm ${i === svc ? 'bg-stone-900 text-white' : 'bg-white/70'}`}>
            <span>{x.name}{x.mins ? <span className="opacity-60"> · {x.mins} min</span> : null}</span><span>{money(x.price)}</span>
          </button>
        ))}
      </div>
      <p className="mt-4 text-sm font-medium text-stone-600">Open times today</p>
      <div className="mt-2 grid grid-cols-3 gap-1.5 sm:grid-cols-5">
        {d.slots.map((t) => <button key={t} type="button" onClick={() => setSlot(t)} className={`rounded-xl py-2.5 text-sm ${slot === t ? 'bg-stone-900 text-white' : 'bg-white/70'}`}>{t}</button>)}
      </div>
      <input value={name} onChange={(e) => setName(e.target.value)} aria-label="Your name" className="mt-4 h-11 w-full rounded-2xl border border-white/80 bg-white/70 px-4 text-sm" />
      <button type="button" disabled={!slot || !name.trim()} onClick={() => onBook({ id: `n${Date.now()}`, time: slot!, client: name.trim(), service: s.name, price: s.price, with: d.team[0], status: 'requested' })}
        className="mt-3 w-full rounded-2xl bg-stone-900 py-3.5 text-sm font-medium text-white disabled:opacity-40">{slot ? `Request ${slot} · ${money(s.price)}` : 'Pick a time'}</button>
      <p className="mt-2 text-center text-[11px] text-stone-500">Only truly free times show. Deposits are optional per service.</p>
    </div>
  );
}

// ── Requests (as the owner) ────────────────────────────────────────────────
function Requests({ list, onAccept, onDecline }: { list: DemoAppt[]; onAccept: (a: DemoAppt) => void; onDecline: (a: DemoAppt) => void }) {
  if (!list.length) return <Empty title="Nothing waiting on you" sub="New requests land here — and on the planner, and as a notification." />;
  // The one they just booked comes first — that's the next step of the loop.
  const ordered = [...list].sort((a, b) => Number(b.id.startsWith('n')) - Number(a.id.startsWith('n')));
  return (
    <div className="space-y-2">
      {ordered.map((a) => (
        <div key={a.id} className="glass rounded-3xl p-4 ring-2 ring-amber-200/70">
          <p className="text-[10px] uppercase tracking-widest text-amber-700">Waiting on your answer</p>
          <p className="mt-1 font-semibold">{a.client}</p>
          <p className="text-sm text-stone-600">{a.service} · {a.time} · with {a.with} · {money(a.price)}</p>
          <div className="mt-3 flex gap-2">
            <button type="button" onClick={() => onAccept(a)} className="flex-1 rounded-2xl bg-stone-900 py-3 text-sm font-medium text-white">Accept</button>
            <button type="button" onClick={() => onDecline(a)} className="rounded-2xl border border-stone-300 bg-white/60 px-5 py-3 text-sm">Decline</button>
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Today's schedule ───────────────────────────────────────────────────────
function Today({ list, onStep, onCheckout }: { list: DemoAppt[]; onStep: (a: DemoAppt, s: DemoAppt['status']) => void; onCheckout: () => void }) {
  const toMin = (t: string) => { const [h, m] = t.split(':').map(Number); return (h < 7 ? h + 12 : h) * 60 + m; };
  const sorted = [...list].sort((a, b) => toMin(a.time) - toMin(b.time));
  const next: Record<string, [DemoAppt['status'], string] | null> = { confirmed: ['arrived', 'Check in'], arrived: ['in_service', 'Start'], in_service: ['ready', 'Finish'], ready: null, requested: null, paid: null };
  return (
    <div className="space-y-2">
      {sorted.map((a) => { const [label, cls] = STATUS[a.status]; const n = next[a.status]; return (
        <div key={a.id} className="glass flex items-center gap-3 rounded-2xl p-3">
          <span className="w-12 shrink-0 font-mono text-sm text-stone-500">{a.time}</span>
          <span className="min-w-0 flex-1"><span className="block truncate text-sm font-semibold">{a.client}</span><span className="block truncate text-[12px] text-stone-500">{a.service} · {a.with}</span></span>
          <span className={`shrink-0 rounded-full px-2.5 py-1 text-[10px] font-semibold ${cls}`}>{label}</span>
          {n && <button type="button" onClick={() => onStep(a, n[0])} className="shrink-0 rounded-xl bg-stone-900 px-3 py-2 text-[12px] font-medium text-white">{n[1]}</button>}
          {a.status === 'ready' && <button type="button" onClick={onCheckout} className="shrink-0 rounded-xl bg-stone-900 px-3 py-2 text-[12px] font-medium text-white">Checkout</button>}
        </div>
      ); })}
    </div>
  );
}

// ── Checkout ───────────────────────────────────────────────────────────────
function Checkout({ d, list, onPaid }: { d: typeof DEMO.salon; list: DemoAppt[]; onPaid: (a: DemoAppt, total: number) => void }) {
  const [id, setId] = useState<string | null>(null);
  const [offer, setOffer] = useState(true);
  const [tipPct, setTipPct] = useState(18);
  const [receipt, setReceipt] = useState<{ name: string; total: number } | null>(null);
  const a = list.find((x) => x.id === id) || list.find((x) => x.status === 'ready') || list[0];
  const calc = useMemo(() => {
    if (!a) return null;
    const off = offer ? Math.round(a.price * d.offer.pct) / 100 : 0;
    const tip = Math.round((a.price - off) * tipPct) / 100;
    return { off, tip, total: Math.round((a.price - off + tip) * 100) / 100 };
  }, [a, offer, tipPct, d.offer.pct]);
  if (receipt) return (
    <div className="glass rounded-3xl p-6 text-center">
      <p className="text-4xl">✓</p><p className="mt-2 text-lg font-semibold">Paid · {money(receipt.total)}</p>
      <p className="text-sm text-stone-600">Receipt sent to {first(receipt.name)}. Your books updated as it happened.</p>
      <button type="button" onClick={() => setReceipt(null)} className="mt-4 rounded-full border border-stone-300 px-4 py-2 text-sm">Next checkout</button>
    </div>
  );
  if (!a || !calc) return <Empty title="Nobody to check out" sub="Accept a request or check someone in on Today first." />;
  return (
    <div className="glass rounded-3xl p-5">
      <select value={a.id} onChange={(e) => setId(e.target.value)} aria-label="Who's paying" className="h-11 w-full rounded-2xl border border-white/80 bg-white/70 px-3 text-sm">
        {list.map((x) => <option key={x.id} value={x.id}>{x.time} · {x.client} · {x.service}</option>)}
      </select>
      <div className="mt-4 space-y-2 text-sm">
        <div className="flex justify-between"><span>{a.service}</span><span>{money(a.price)}</span></div>
        <label className="flex cursor-pointer items-center justify-between text-emerald-700"><span><input type="checkbox" checked={offer} onChange={(e) => setOffer(e.target.checked)} className="mr-2" />🎁 Offer {d.offer.code} · {d.offer.pct}% off</span><span>{offer ? `−${money(calc.off)}` : '—'}</span></label>
        <div className="flex items-center justify-between"><span>{d.tipLabel} · {a.with}</span>
          <span className="flex gap-1">{[0, 15, 18, 20].map((p) => <button key={p} type="button" onClick={() => setTipPct(p)} className={`rounded-lg px-2 py-1 text-[12px] ${tipPct === p ? 'bg-stone-900 text-white' : 'bg-white/70'}`}>{p ? `${p}%` : 'None'}</button>)}</span></div>
        <div className="flex justify-between border-t border-stone-200 pt-2 text-base font-semibold"><span>Total</span><span>{money(calc.total)}</span></div>
      </div>
      <button type="button" onClick={() => { onPaid(a, calc.total); setReceipt({ name: a.client, total: calc.total }); setId(null); }} className="mt-4 w-full rounded-2xl bg-stone-900 py-3.5 text-sm font-medium text-white">Tap to pay {money(calc.total)}</button>
      <p className="mt-2 text-center text-[11px] text-stone-500">Offers booked through a campaign come off automatically.</p>
    </div>
  );
}

// ── Campaigns ──────────────────────────────────────────────────────────────
function Campaigns({ d, onSent }: { d: typeof DEMO.salon; onSent: () => void }) {
  const [sent, setSent] = useState(false);
  const booked = Math.round(d.winBack.count * 0.15);
  const avg = d.services.reduce((n, s) => n + s.price, 0) / d.services.length;
  return (
    <div className="glass rounded-3xl p-5">
      <p className="text-[10px] uppercase tracking-widest text-stone-400">Win back · text or email</p>
      <p className="mt-1 font-semibold">{d.winBack.audience}</p>
      <p className="text-sm text-stone-500">{d.winBack.count} {d.clientWord}s · only those who said yes to offers get texts</p>
      <div className="mt-3 max-w-[85%] rounded-2xl rounded-bl-sm bg-white/90 p-3 text-sm shadow-sm">{d.biz}: {d.winBack.message.replace('{first}', 'Alex')}</div>
      {!sent ? (
        <button type="button" onClick={() => { setSent(true); onSent(); }} className="mt-4 w-full rounded-2xl bg-stone-900 py-3.5 text-sm font-medium text-white">Send to {d.winBack.count}</button>
      ) : (
        <div className="mt-4 grid grid-cols-3 gap-2 text-center">
          {[[String(d.winBack.count), 'Reached'], [String(booked), 'Booked'], [money(Math.round(booked * avg)), 'Revenue']].map(([v, l], k) => (
            <div key={l} className="cf-pop rounded-2xl bg-white/70 p-3" style={{ animationDelay: `${k * 250}ms` }}><p className="text-xl font-semibold">{v}</p><p className="text-[10px] uppercase tracking-widest text-stone-500">{l}</p></div>
          ))}
          <p className="col-span-3 mt-1 text-[12px] text-stone-500">In the real app, bookings from a campaign are counted as they happen — with the revenue they bring.</p>
        </div>
      )}
      <style>{`.cf-pop{animation:cfpop .6s cubic-bezier(.22,1.2,.36,1) both}@keyframes cfpop{from{opacity:0;transform:translateY(10px) scale(.95)}to{opacity:1;transform:none}}`}</style>
    </div>
  );
}

// ── Renters / members / stock ──────────────────────────────────────────────
function People({ d }: { d: typeof DEMO.salon }) {
  const [rows, setRows] = useState(d.people);
  const collected = rows.filter((r) => r.status === 'ok').reduce((n, r) => n + r.amount, 0);
  return (
    <div className="space-y-2">
      {rows.map((r) => (
        <div key={r.id} className="glass flex items-center gap-3 rounded-2xl p-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white/80 text-[11px] font-semibold text-stone-600">{r.name.split(/\s+/).map((p) => p[0]).join('').slice(0, 2)}</span>
          <span className="min-w-0 flex-1"><span className="block text-sm font-semibold">{r.name}</span><span className="block text-[12px] text-stone-500">{r.detail}{r.amount ? ` · ${money(r.amount)}` : ''}</span></span>
          <span className={`shrink-0 rounded-full px-2.5 py-1 text-[10px] font-semibold ${r.status === 'ok' ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'}`}>{r.status === 'ok' ? `${r.okLabel} ✓` : r.dueLabel}</span>
          {r.status === 'due' && <button type="button" onClick={() => setRows((rs) => rs.map((x) => (x.id === r.id ? { ...x, status: 'ok' } : x)))} className="shrink-0 rounded-xl bg-stone-900 px-3 py-2 text-[12px] font-medium text-white">{r.action}</button>}
        </div>
      ))}
      {collected > 0 && <div className="glass flex justify-between rounded-2xl p-3 text-sm"><span className="text-stone-600">Collected this week</span><span className="font-semibold">{money(collected)}</span></div>}
    </div>
  );
}

const Empty = ({ title, sub }: { title: string; sub: string }) => (
  <div className="glass rounded-3xl p-8 text-center"><p className="font-semibold">{title}</p><p className="mt-1 text-sm text-stone-600">{sub}</p></div>
);
