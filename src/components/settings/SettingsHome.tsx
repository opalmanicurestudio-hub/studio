'use client';
// src/components/settings/SettingsHome.tsx
//
// SETTINGS HOME — organised by the questions owners actually ask, in plain
// words, with search across every setting and a "Finish setting up" list that
// shows only what's missing. Every link goes to the exact screen or tab where
// the setting lives (the tabbed Settings page keeps working at ?tab=…).

import { moduleEnabled, settingVisible } from '@/lib/modules';
import { SETTINGS_MAP } from '@/lib/settings-map';
import { kioskOptionsShown } from '@/lib/kiosk-options';
import { clientTimelineSettingsOf } from '@/lib/visit';
import { SettingsStyle } from '@/components/settings/settings-style';
import { Building2, CalendarDays, CreditCard, DoorOpen, SprayCan, Users, MessageSquare, Puzzle, Search, ChevronRight, Sparkles } from 'lucide-react';
import { attentionItems } from '@/lib/settings-map';
import { useFirebase } from '@/firebase';
import { doc, updateDoc } from 'firebase/firestore';
import React from 'react';
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { getAuth } from 'firebase/auth';
import { deviceId } from '@/lib/device';

type Item = { title: string; meaning: string; href: string; words?: string; module?: string };
const T = (tab: string) => `/settings?tab=${tab}`;

export const SETTINGS_INDEX: { question: string; icon: string; items: Item[] }[] = [
  // ONE entry per place — no two entries lead to the same screen. Eight groups, in the order owners think about
  // running the business. An entry with a `module` only shows when the business uses that tool.
  { question: 'Your business', icon: '', items: [
    { title: 'Your business details', meaning: 'Name, logo, phone, email and address clients see.', href: T('profile'), words: 'name logo phone email address brand identity' },
    { title: 'Opening hours', meaning: 'When the business is open.', href: T('hours'), words: 'hours open close holiday schedule' },
    { title: 'Locations', meaning: 'Your address and any other locations.', href: T('locations'), words: 'address location map clock in radius geofence time zone' },
    { title: 'Your plan & billing', meaning: 'Your ClarityFlow subscription, what’s included and how many locations you can have.', href: '/subscriptions', words: 'plan billing subscription invoice locations upgrade' },
    { title: 'How the app looks (Studio or Classic)', meaning: 'Warm and calm in your colour, or the classic look.', href: '/settings#app-look', words: 'look appearance theme studio classic colour color design app' },
  ] },
  { question: 'Booking', icon: '', items: [
    { title: 'Booking policies', meaning: 'Deposits, cancellations, no-shows, rescheduling, late arrivals, how far ahead clients can book — and exactly what clients are told.', href: '/settings/policies', words: 'policy policies cancel cancellation no-show noshow late grace reschedule deposit refund credit window notice fee faq terms members limit lead time advance release horizon hold' },
    { title: 'How bookings come in', meaning: 'Book instantly, ask for your approval, or take a deposit first — plus card on file, deposits at the desk, blocked time and who can accept.', href: '/settings/booking#rules', words: 'instant approve approval request deposit required card on file desk block time authority accept guardian rebook' },
    { title: 'Your booking page', meaning: 'Its design (Classic or Studio), the page builder, and a preview.', href: '/settings/booking#design', words: 'page design studio classic preview public website builder hero sections photos reviews theme layout' },
    { title: 'Services & prices', meaning: 'What clients can book, how long it takes and what it costs.', href: '/services', words: 'menu price duration add-ons' },
  ] },
  { question: 'Payments', icon: '', items: [
    { title: 'Payments & payouts', meaning: 'Connect Stripe so you can take cards, deposits and payouts to your bank.', href: T('payments'), words: 'stripe bank payout card connect sales tax tips pay later voids client screen checkout' },
    { title: 'Card reader', meaning: 'Take in-person card payments with a reader.', href: T('terminal'), words: 'terminal tap to pay reader pos' },
    { title: 'Money owed, credit & service recovery', meaning: 'Failed payments, store credit, and how far your team can go to make things right.', href: T('policies'), words: 'collections credit owed arrears recovery comp escalation refund apology goodwill store credit' },
  ] },
  { question: 'Front desk & visits', icon: '', items: [
    { title: 'Visit stages', meaning: 'The steps a visit goes through, their names, and what clients see on their visit link.', href: T('visits'), words: 'stages timeline arrived waiting in service client link' },
    { title: 'Check-in kiosk', meaning: 'The screen clients use to check themselves in.', href: T('kiosk'), words: 'kiosk check in station qr front door what brings you in pickup renter tour help options', module: 'kiosk' },
    { title: 'Guest comforts & Wi-Fi', meaning: 'Wi-Fi for guests, drinks and little extras.', href: T('experience'), words: 'wifi drinks refreshments hospitality concierge' },
    { title: 'Hosting & floor', meaning: 'How you host guests: tables, seating and the host screen.', href: '/settings/hosting', words: 'hosting host tables seating floor plan parties', module: 'hospitality' },
  ] },
  { question: 'Operations', icon: '', items: [
    { title: 'Cleaning protocols', meaning: 'Your cleaning procedures — they become each service’s turnover checklist and release a station from quarantine.', href: T('operations'), words: 'cleaning protocol sanitise disinfect turnover checklist quarantine hygiene' },
    { title: 'Stations & rooms', meaning: 'Rooms, chairs and equipment your services need.', href: '/resources', words: 'stations rooms equipment resources chairs' },
  ] },
  { question: 'Team', icon: '', items: [
    { title: 'Your team', meaning: 'People, roles, what they can do and their schedules.', href: '/staff', words: 'staff employees roles permissions availability' },
    { title: 'Time clock', meaning: 'How the team clocks in and out.', href: T('timeclock'), words: 'clock in out timesheet pin geofence overtime', module: 'team' },
  ] },
  { question: 'Messages & automations', icon: '', items: [
    { title: 'Everything that runs automatically', meaning: 'Every message and automatic action, whether it’s working, and switches.', href: '/settings/automations', words: 'automation health reminders working needs setup' },
    { title: 'Message wording & timing', meaning: 'Change what confirmations and reminders say, and when they go.', href: '/settings/messages', words: 'reminder confirmation text sms email template wording' },
    { title: 'Win back quiet clients', meaning: 'Gentle nudges to clients who are due or haven’t been in a while.', href: '/settings/messages', words: 'reconnect win back quiet lapsed nudge due missed renter campaigns texts', module: 'marketing' },
    { title: 'Message log', meaning: 'Every email and text that was sent, and whether it arrived.', href: '/message-log', words: 'sent delivered failed history' },
    { title: 'Voice assistant', meaning: 'The assistant that answers your phone: what it knows and how it speaks.', href: '/voice', words: 'voice phone calls assistant receptionist', module: 'voice' },
  ] },
  { question: 'Your tools', icon: '', items: [
    { title: 'Booth rentals', meaning: 'Booking rules for your booths and suites — booking window, notice, tours and deposits.', href: '/booths?settings=1', words: 'booth chair suite rent renter lease tour', module: 'booth_rental' },
    { title: 'Academy', meaning: 'Courses, students, admissions, funding and your school website.', href: '/academy', words: 'school courses students admissions website funding', module: 'academy' },
    { title: 'Shop', meaning: 'Your online shop’s returns, delivery and order rules.', href: '/retail-orders/policies', words: 'shop retail store returns shipping pickup orders policies', module: 'retail' },
  ] },
];

// What each setting is set to NOW, in plain words — the Quick settings sentences where they exist (same source, so
// the two can never disagree), and a few simple ones read straight from the business for the rest.
function summaryFor(item: Item, t: any): string | null {
  const exact = SETTINGS_MAP.find((e) => e.href === item.href);
  const base = item.href.includes('?settings=') ? SETTINGS_MAP.find((e) => e.href === item.href.split('?')[0]) : null;
  const m = item.title === 'Win back quiet clients' ? null : exact || base;
  if (m) { try { const out = m.summarise(t); if (out) return out; } catch { /* fall through */ } }
  switch (item.title) {
    case 'Your business details': return t?.phone && t?.address ? `${t?.name || 'Your business'} — phone and address are set.` : 'Add your phone and address so clients can reach you.';
    case 'Your plan & billing': return ['active', 'trialing'].includes(String(t?.subscriptionStatus)) ? 'Subscribed.' : 'Not subscribed yet — one location is included.';
    case 'Payments & payouts': return t?.stripeAccountId && t?.stripeChargesEnabled !== false ? 'Card payments are on, and payouts go to your bank.' : 'Not connected yet — clients can’t pay online.';
    case 'Check-in kiosk': { const n = kioskOptionsShown(t).length; return t?.kioskSettings?.enabled === false ? 'The kiosk is switched off.' : `Arriving guests choose from ${n} option${n === 1 ? '' : 's'}.`; }
    case 'Time clock': return t?.geoFenceEnabled ? 'Staff must be at a location to clock in.' : 'Staff can clock in from anywhere.';
    case 'Visit stages': return clientTimelineSettingsOf(t).on ? 'Clients can follow their visit on their link.' : 'Clients don’t see a visit timeline.';
    case 'How the app looks (Studio or Classic)': return t?.appAppearance === 'classic' ? 'The Classic look.' : 'The Studio look, in your colour.';
    default: return null;
  }
}
const GROUP_ICON: Record<string, any> = { 'Your business': Building2, Booking: CalendarDays, Payments: CreditCard, 'Front desk & visits': DoorOpen, Operations: SprayCan, Team: Users, 'Messages & automations': MessageSquare, 'Your tools': Puzzle };
const slug = (q: string) => 'g-' + q.toLowerCase().replace(/[^a-z]+/g, '-');

async function automationsNeedingYou(tenantId: string) {
  try {
    const u = getAuth().currentUser; const tk = u ? await u.getIdToken() : '';
    const r = await fetch('/api/automations', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tk}`, 'x-cf-device': deviceId() }, body: JSON.stringify({ tenantId }) });
    const d = await r.json(); return d?.ok ? (d.items || []).filter((a: any) => a.status === 'needs_setup' || a.status === 'failing').length : null;
  } catch { return null; }
}

export function SettingsHome({ tenant }: { tenant: any }) {
  // Only what's part of this business's plan (a tool they don't have never shows — here, in search, or anywhere).
  const index = useMemo(() => SETTINGS_INDEX.map((g) => ({ ...g, items: g.items.filter((i) => settingVisible(tenant, i.href, i.module)) })).filter((g) => g.items.length), [tenant]);
  const [q, setQ] = useState(''); const [autoCount, setAutoCount] = useState<number | null>(null);
  useEffect(() => { if (tenant?.id) void automationsNeedingYou(tenant.id).then(setAutoCount); }, [tenant?.id]);
  const checks = 5 + attentionItems(tenant).length;   // the setup checks below (+ anything silently switched off)
  const todo = [
    !tenant?.logoUrl && { title: 'Add your logo', href: T('profile') },
    !(tenant?.phone && tenant?.address) && { title: 'Add your phone and address', href: T('profile') },
    !(tenant?.stripeAccountId && tenant?.stripeChargesEnabled !== false) && { title: 'Connect payments so clients can pay online', href: T('payments') },
    !tenant?.bookingPageSettings?.design && { title: 'Pick your booking page design (optional)', href: '/settings/booking' },
    autoCount ? { title: `${autoCount} automation${autoCount === 1 ? ' needs' : 's need'} you`, href: '/settings/automations' } : null,
    // Anything switched off in a way that silently disables something (the same checks Quick settings shows).
    ...attentionItems(tenant).map((a) => ({ title: a.warning || `${a.label} isn’t set up`, href: a.href })),   // (already limited to the plan)
  ].filter(Boolean) as { title: string; href: string }[];
  const results = useMemo(() => {
    const n = q.trim().toLowerCase(); if (n.length < 2) return [];
    const all = index.flatMap((g) => g.items.map((i) => ({ ...i, question: g.question })));
    return all.filter((i) => `${i.title} ${i.meaning} ${i.words || ''} ${i.question}`.toLowerCase().includes(n));
  }, [q, index]);

  return (
    <main className="cf-settings min-h-full">
      <SettingsStyle />
      <div className="mx-auto w-full max-w-5xl px-4 py-8 md:grid md:grid-cols-[224px_minmax(0,1fr)] md:gap-12 md:px-8 md:py-12">
        {/* The eight groups, always in reach on a computer */}
        <nav aria-label="Settings groups" className="hidden md:block">
          <ul className="sticky top-8 space-y-1">{index.map((g) => { const Icon = GROUP_ICON[g.question]; return (
            <li key={g.question}><a href={`#${slug(g.question)}`} className="flex items-center gap-2.5 whitespace-nowrap rounded-xl px-3 py-2 text-[14px] cf-muted transition-colors hover:bg-[var(--soft)] hover:text-[var(--ink)]">{Icon && <Icon className="h-4 w-4 shrink-0" aria-hidden />}<span className="truncate">{g.question}</span></a></li>); })}</ul>
        </nav>
        <div className="min-w-0 space-y-8">
          <header className="relative overflow-hidden rounded-[28px] px-6 pb-6 pt-7 md:px-9 md:pb-8 md:pt-9" style={{ background: 'hsl(var(--primary))', color: 'hsl(var(--primary-foreground))' }}>
            <div className="flex items-center gap-3">
              {tenant?.logoUrl ? <img src={tenant.logoUrl} alt="" className="h-9 w-9 rounded-full object-cover ring-2 ring-white/40" /> : null}
              <p className="text-[15px] font-medium opacity-90">{tenant?.name || 'Your business'}</p>
            </div>
            <h1 className="mt-5 text-[44px] md:text-[56px] font-light leading-none tracking-tight">Settings</h1>
            <p className="mt-3 max-w-[52ch] text-[15px] opacity-90">How your business runs, in plain words. Tap anything to change it.</p>
            <div className="mt-6">
              <div className="flex items-baseline justify-between text-[14px]"><span className="font-medium">{todo.length ? `${todo.length} thing${todo.length === 1 ? '' : 's'} left to set up` : 'Everything’s set up'}</span><span className="opacity-80">{Math.max(0, checks - todo.length)} of {checks}</span></div>
              <div className="mt-2 h-1.5 overflow-hidden rounded-full" style={{ background: 'color-mix(in srgb, currentColor 22%, transparent)' }} role="progressbar" aria-valuemin={0} aria-valuemax={checks} aria-valuenow={Math.max(0, checks - todo.length)} aria-label="Setup progress">
                <div className="h-full rounded-full" style={{ width: `${Math.round((Math.max(0, checks - todo.length) / Math.max(1, checks)) * 100)}%`, background: 'currentColor' }} />
              </div>
            </div>
          </header>
          <div className="space-y-3">
            <label className="flex h-14 items-center gap-3 rounded-full border px-5" style={{ background: 'var(--card)', borderColor: 'var(--line)' }}>
              <Search className="h-5 w-5 shrink-0 cf-muted" aria-hidden />
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search settings" aria-label="Search settings" className="h-full w-full bg-transparent text-[16px] outline-none placeholder:text-[var(--muted)]" />
            </label>
            {q.trim().length < 2 && <Link href="/settings/map" className="cf-sheet cf-accent-wash cf-row" style={{ borderRadius: 999 }}>
              <Sparkles className="h-5 w-5 shrink-0" style={{ color: 'var(--accent)' }} aria-hidden />
              <span className="min-w-0 flex-1"><span className="block text-[15px] font-medium">Quick settings</span><span className="block text-[13.5px] cf-muted">The switches you change most, on one page.</span></span>
              <ChevronRight className="h-4 w-4 shrink-0 cf-muted" aria-hidden />
            </Link>}
          </div>
          {q.trim().length >= 2 && (
            <section aria-label="Search results" className="space-y-3">
              {results.length === 0 ? <p className="text-[15px] cf-muted">Nothing matches “{q}”. Try another word, like “payments” or “hours”.</p>
                : <div className="cf-sheet">{results.map((r) => <Link key={`${r.question}-${r.title}`} href={r.href} className="cf-row"><span className="min-w-0 flex-1"><span className="block text-[15px] font-medium">{r.title}</span><span className="mt-0.5 block text-[13.5px] leading-snug cf-muted line-clamp-2">{summaryFor(r, tenant) || r.meaning}</span></span><ChevronRight className="h-4 w-4 shrink-0 cf-muted" aria-hidden /></Link>)}</div>}
            </section>
          )}
          {q.trim().length < 2 && <>
            {todo.length > 0 && (
              <section aria-label="Finish setting up" className="space-y-3">
                <h2 className="text-[17px] font-semibold">Finish setting up</h2>
                <div className="cf-sheet">{todo.map((t) => (
                  <Link key={t.title} href={t.href} className="cf-row"><span className="h-2 w-2 shrink-0 rounded-full" style={{ background: 'var(--accent)' }} aria-hidden /><span className="min-w-0 flex-1 text-[14.5px] leading-snug">{t.title}</span><ChevronRight className="h-4 w-4 shrink-0 cf-muted" aria-hidden /></Link>))}</div>
              </section>)}
            {index.map((g) => { const Icon = GROUP_ICON[g.question]; return (
              <section key={g.question} id={slug(g.question)} aria-label={g.question} className="scroll-mt-8 space-y-3">
                <h2 className="flex items-center gap-2.5 text-[17px] font-semibold">{Icon && <Icon className="h-[18px] w-[18px] cf-muted" aria-hidden />}{g.question}</h2>
                <div className="cf-sheet">{g.items.map((r) => <Link key={r.title} href={r.href} className="cf-row"><span className="min-w-0 flex-1"><span className="block text-[15px] font-medium">{r.title}</span><span className="mt-0.5 block text-[13.5px] leading-snug cf-muted line-clamp-2">{summaryFor(r, tenant) || r.meaning}</span></span><ChevronRight className="h-4 w-4 shrink-0 cf-muted" aria-hidden /></Link>)}</div>
              </section>); })}
            <AppLook tenant={tenant} />
          </>}
        </div>
      </div>
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
    <section id="app-look" aria-label="How the app looks" className="cf-sheet scroll-mt-8 flex flex-wrap items-center justify-between gap-3 p-5">
      <div><p className="font-semibold">How the app looks</p><p className="text-sm text-muted-foreground">Studio is warm and calm, in your colour — like your front desk and booking page.</p></div>
      <div className="flex gap-1 rounded-full bg-secondary p-1">{(['studio', 'classic'] as const).map((v) => (
        <button key={v} type="button" disabled={busy} onClick={() => pick(v)} aria-pressed={cur === v}
          className={`rounded-full px-4 py-1.5 text-sm transition ${cur === v ? 'bg-card font-semibold shadow-sm' : 'text-muted-foreground'}`}>{v === 'studio' ? 'Studio' : 'Classic'}</button>))}</div>
    </section>
  );
}
