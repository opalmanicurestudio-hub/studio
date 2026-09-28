'use client';
// src/components/settings/SettingsHome.tsx
//
// SETTINGS HOME — organised by the questions owners actually ask, in plain
// words, with search across every setting and a "Finish setting up" list that
// shows only what's missing. Every link goes to the exact screen or tab where
// the setting lives (the tabbed Settings page keeps working at ?tab=…).

import { useFirebase } from '@/firebase';
import { doc, updateDoc } from 'firebase/firestore';
import React from 'react';
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { getAuth } from 'firebase/auth';
import { deviceId } from '@/lib/device';

type Item = { title: string; meaning: string; href: string; words?: string };
const T = (tab: string) => `/settings?tab=${tab}`;

export const SETTINGS_INDEX: { question: string; icon: string; items: Item[] }[] = [
  // ONE entry per place — no two entries lead to the same screen. Merged
  // entries keep every search word, so nothing got harder to find.
  { question: 'How clients book', icon: '', items: [
    { title: 'Booking policies', meaning: 'Deposits, cancellations, no-shows, rescheduling, late arrivals, how far ahead clients can book — and exactly what clients are told.', href: '/settings/policies', words: 'policy policies cancel cancellation no-show noshow late grace reschedule deposit refund credit window notice fee faq terms members limit lead time advance release horizon hold' },
    { title: 'How bookings come in', meaning: 'Book instantly, ask for your approval, or take a deposit first — plus card on file, deposits at the desk, blocked time and who can accept.', href: '/settings/booking#rules', words: 'instant approve approval request deposit required card on file desk block time authority accept guardian rebook' },
    { title: 'Your booking page', meaning: 'Its design (Classic or Studio), the page builder, and a preview.', href: '/settings/booking#design', words: 'page design studio classic preview public website builder hero sections photos reviews theme layout' },
    { title: 'Services & prices', meaning: 'What clients can book, how long it takes and what it costs.', href: '/services', words: 'menu price duration add-ons' },
  ] },
  { question: 'How you get paid', icon: '', items: [
    { title: 'Payments & payouts', meaning: 'Connect Stripe so you can take cards, deposits and payouts to your bank.', href: T('payments'), words: 'stripe bank payout card connect' },
    { title: 'Card reader', meaning: 'Take in-person card payments with a reader.', href: T('terminal'), words: 'terminal tap to pay reader pos' },
    { title: 'Money owed, credit & service recovery', meaning: 'Failed payments, store credit, and how far your team can go to make things right.', href: T('policies'), words: 'collections credit owed arrears recovery comp escalation refund apology goodwill store credit' },
  ] },
  { question: 'What messages go out', icon: '', items: [
    { title: 'Everything that runs automatically', meaning: 'Every message and automatic action, whether it’s working, and switches.', href: '/settings/automations', words: 'automation health reminders working needs setup' },
    { title: 'Message wording & timing', meaning: 'Change what confirmations and reminders say, and when they go.', href: '/settings/messages', words: 'reminder confirmation text sms email template wording' },
    { title: 'Win back quiet clients', meaning: 'Gentle nudges to clients who are due or haven’t been in a while.', href: T('policies'), words: 'reconnect win back quiet lapsed nudge due missed renter campaigns texts' },
    { title: 'Message log', meaning: 'Every email and text that was sent, and whether it arrived.', href: '/message-log', words: 'sent delivered failed history' },
  ] },
  { question: 'Your team & hours', icon: '', items: [
    { title: 'Your team', meaning: 'People, roles, what they can do and their schedules.', href: '/staff', words: 'staff employees roles permissions availability' },
    { title: 'Opening hours', meaning: 'When the business is open.', href: T('hours'), words: 'hours open close holiday schedule' },
    { title: 'Time clock', meaning: 'How the team clocks in and out.', href: T('timeclock'), words: 'clock in out timesheet pin geofence overtime' },
  ] },
  { question: 'Your space & rentals', icon: '', items: [
    { title: 'Locations', meaning: 'Your address and any other locations.', href: T('locations'), words: 'address location map' },
    { title: 'Booth rentals', meaning: 'Chairs and suites for rent, renters, leases and rent.', href: '/booths', words: 'booth chair suite rent renter lease tour' },
    { title: 'Check-in kiosk', meaning: 'The screen clients use to check themselves in.', href: T('kiosk'), words: 'kiosk check in station qr' },
    { title: 'Guest comforts & Wi-Fi', meaning: 'Wi-Fi for guests, drinks and little extras.', href: T('experience'), words: 'wifi drinks refreshments hospitality concierge' },
    { title: 'Floor map', meaning: 'A map of your space for the host screen.', href: '/settings/map', words: 'map floor tables stations' },
  ] },
  { question: 'Your school', icon: '', items: [
    { title: 'Academy', meaning: 'Courses, students, admissions, funding and your school website.', href: '/academy', words: 'school courses students admissions website funding' },
  ] },
  { question: 'How your business looks', icon: '', items: [
    { title: 'Your business details', meaning: 'Name, logo, phone, email and address clients see.', href: T('profile'), words: 'name logo phone email address brand identity' },
    { title: 'How the app looks (Studio or Classic)', meaning: 'Warm and calm in your colour, or the classic look.', href: '/settings', words: 'look appearance theme studio classic colour color design app' },
  ] },
];

async function automationsNeedingYou(tenantId: string) {
  try {
    const u = getAuth().currentUser; const tk = u ? await u.getIdToken() : '';
    const r = await fetch('/api/automations', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tk}`, 'x-cf-device': deviceId() }, body: JSON.stringify({ tenantId }) });
    const d = await r.json(); return d?.ok ? (d.items || []).filter((a: any) => a.status === 'needs_setup' || a.status === 'failing').length : null;
  } catch { return null; }
}

export function SettingsHome({ tenant }: { tenant: any }) {
  const [q, setQ] = useState(''); const [autoCount, setAutoCount] = useState<number | null>(null);
  useEffect(() => { if (tenant?.id) void automationsNeedingYou(tenant.id).then(setAutoCount); }, [tenant?.id]);
  const todo = [
    !tenant?.logoUrl && { title: 'Add your logo', href: T('profile') },
    !(tenant?.phone && tenant?.address) && { title: 'Add your phone and address', href: T('profile') },
    !(tenant?.stripeAccountId && tenant?.stripeChargesEnabled !== false) && { title: 'Connect payments so clients can pay online', href: T('payments') },
    !tenant?.bookingPageSettings?.design && { title: 'Pick your booking page design (optional)', href: '/settings/booking' },
    autoCount ? { title: `${autoCount} automation${autoCount === 1 ? ' needs' : 's need'} you`, href: '/settings/automations' } : null,
  ].filter(Boolean) as { title: string; href: string }[];
  const results = useMemo(() => {
    const n = q.trim().toLowerCase(); if (n.length < 2) return [];
    const all = SETTINGS_INDEX.flatMap((g) => g.items.map((i) => ({ ...i, question: g.question })));
    return all.filter((i) => `${i.title} ${i.meaning} ${i.words || ''} ${i.question}`.toLowerCase().includes(n));
  }, [q]);

  return (
    <main className="mx-auto w-full max-w-4xl space-y-6 p-4 md:p-8">
      <div><h1 className="text-3xl font-light tracking-tight">Your <b className="font-semibold">settings</b></h1><p className="text-sm text-muted-foreground">Find anything by what you want to do — or search below.</p></div>
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search settings — e.g. deposit, reminder, logo, wifi" aria-label="Search settings" className="h-12 w-full rounded-2xl border-2 px-4 text-[15px]" />
      {q.trim().length >= 2 && (
        <section className="space-y-2" aria-label="Search results">
          {results.length === 0 ? <p className="text-sm text-muted-foreground">Nothing matches “{q}”. Try another word — like “payments” or “hours”.</p>
            : results.map((r) => <Link key={`${r.question}-${r.title}`} href={r.href} className="block rounded-2xl border-2 p-3 transition hover:bg-muted/40"><p className="font-bold">{r.title} <span className="text-[12px] font-normal text-muted-foreground">· {r.question}</span></p><p className="text-sm text-muted-foreground">{r.meaning}</p></Link>)}
        </section>
      )}
      {q.trim().length < 2 && <AppLook tenant={tenant} />}
      {q.trim().length < 2 && <>
        {todo.length > 0 ? (
          <section className="space-y-2 rounded-2xl border-2 border-amber-200 bg-amber-50/60 p-4" aria-label="Finish setting up">
            <p className="font-black">Finish setting up</p>
            {todo.map((t) => <Link key={t.title} href={t.href} className="flex items-center justify-between gap-3 rounded-xl bg-background px-3 py-2.5 text-sm font-bold transition hover:bg-muted/40"><span>○ {t.title}</span><span aria-hidden>→</span></Link>)}
          </section>
        ) : <p className="rounded-2xl border-2 border-emerald-200 bg-emerald-50/60 p-4 text-sm font-bold text-emerald-900">✓ You’re all set up.</p>}
        <div className="grid gap-3 sm:grid-cols-2">{SETTINGS_INDEX.map((g) => (
          <section key={g.question} className="space-y-1 rounded-2xl border-2 p-4" aria-label={g.question}>
            <p className="pb-1 text-[15px] font-black">{g.icon} {g.question}</p>
            {g.items.map((i) => <Link key={i.title} href={i.href} className="block rounded-xl px-2 py-1.5 transition hover:bg-muted/40"><span className="block text-sm font-bold">{i.title}</span><span className="block text-[12px] text-muted-foreground">{i.meaning}</span></Link>)}
          </section>
        ))}</div>
      </>}
    </main>
  );
}


/** How the whole app looks for this business: Studio (warm, calm — like the
 *  front desk and booking page) or Classic. Saved on the business; applied by
 *  <StudioTheme/> everywhere. */
function AppLook({ tenant }: { tenant: any }) {
  const { firestore } = useFirebase() as any;
  const [busy, setBusy] = React.useState(false);
  const cur = tenant?.appAppearance === 'classic' ? 'classic' : 'studio';
  const pick = async (v: 'studio' | 'classic') => {
    if (!firestore || !tenant?.id || v === cur) return; setBusy(true);
    try { await updateDoc(doc(firestore, 'tenants', tenant.id), { appAppearance: v }); } finally { setBusy(false); }
  };
  return (
    <section aria-label="How the app looks" className="flex flex-wrap items-center justify-between gap-3 rounded-3xl border bg-card p-4">
      <div><p className="font-semibold">How the app looks</p><p className="text-sm text-muted-foreground">Studio is warm and calm, in your colour — like your front desk and booking page.</p></div>
      <div className="flex gap-1 rounded-full bg-secondary p-1">{(['studio', 'classic'] as const).map((v) => (
        <button key={v} type="button" disabled={busy} onClick={() => pick(v)} aria-pressed={cur === v}
          className={`rounded-full px-4 py-1.5 text-sm transition ${cur === v ? 'bg-card font-semibold shadow-sm' : 'text-muted-foreground'}`}>{v === 'studio' ? 'Studio' : 'Classic'}</button>))}</div>
    </section>
  );
}
