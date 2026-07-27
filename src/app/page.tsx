// src/app/page.tsx
//
// MARKETING LANDING PAGE for ClarityFlow.
//
// Three deliberate changes from the previous version, all of them conversion
// decisions rather than cosmetic ones:
//
//   1. It is a SERVER component. The old page was 'use client' purely for
//      framer-motion, which meant no `metadata` export (so no title, no
//      description, no link preview — the page was invisible to search and
//      looked broken when shared), the whole marketing bundle shipped to the
//      browser, and every headline was hidden behind `opacity: 0` until JS
//      ran. Entrance movement is now CSS, so text is painted immediately.
//
//   2. It says what the product DOES. "Yield Architecture", "Terminal Flow"
//      and "Investment Architecture" mean nothing to a salon owner searching
//      "booking software with booth rent". The words on the page are now the
//      words buyers use: booking, deposits, no-shows, reminders, booth rent,
//      payroll.
//
//   3. It only claims what is actually built. The old copy promised unlimited
//      SMS, multi-location, white-labeling and API access. See the note above
//      PLANS before editing that list.
//
// Theme tokens (foreground / muted-foreground / border) are used instead of
// hardcoded slate-900, which was invisible against a dark background.
//
// ── EDIT THESE FOUR LINES ──────────────────────────────────────────────────
//
// DEMO_BOOKING_URL — a real public booking page, e.g. '/book/your-tenant-id'.
//   Letting someone tap through a live booking flow before signing up is the
//   strongest asset this page has. Leave it '' and the button simply does not
//   render; nothing breaks.
// SUPPORT_EMAIL — shown in the footer. Left '' the link is omitted.
// BILLING_LIVE — false until subscription checkout actually exists. Signup
//   currently writes subscriptionStatus:'inactive' / subscriptionTier:'none',
//   so there is no way to charge anyone yet. While it is false the page says
//   early access and free, and the prices below are labeled "planned". Flip it
//   to true the day checkout works.
// PLANS — prices and inclusions. Every line in here is a feature that exists
//   in the codebase today. Adding an unbuilt one back is how a refund request
//   starts.
import type * as React from 'react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { cn } from '@/lib/utils';
import {
  ArrowRight, Calendar, CalendarCheck, CreditCard, MessageSquare, Home,
  Wallet, Users, Check, ChevronDown, ShieldCheck, Smartphone, Clock,
  ClipboardCheck, Store, Sparkles, Receipt, UserCheck, Wrench, LayoutGrid,
} from 'lucide-react';

// Button looks are written out here rather than pulled from the shared ui
// button module. This page is the first thing a stranger loads, and a named
// import that does not exist in that module is a build failure rather than a
// style bug, so the marketing page owns its three button styles outright.
const BTN =
  'inline-flex items-center justify-center whitespace-nowrap transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-offset-2';
const BTN_SOLID = 'bg-primary text-primary-foreground hover:bg-primary/90';
const BTN_OUTLINE = 'border-2 border-border bg-background text-foreground hover:bg-muted';

// ── The four editable values described at the top of this file ──────────────
const DEMO_BOOKING_URL = '';
const SUPPORT_EMAIL = '';
const BILLING_LIVE = false;

export const metadata: Metadata = {
  title: 'ClarityFlow — Salon booking, booth rent, and payroll in one place',
  description:
    'Online booking that never double-books, deposits that stop no-shows, automatic text reminders, booth-rent billing with card on file, and payroll that reconciles itself. Free while in early access.',
  openGraph: {
    title: 'ClarityFlow — Salon booking, booth rent, and payroll in one place',
    description:
      'Run the front desk and the back office from one app. Free while in early access.',
    type: 'website',
  },
};

// ─── Logo ─────────────────────────────────────────────────────────────────────
// Inlined rather than imported from AppSidebar. That module is 'use client' and
// pulls the whole app navigation in with it — a marketing page should not ship
// the dashboard's sidebar to a first-time visitor just to draw a 32px mark.
const Logo = ({ className }: { className?: string }) => (
  <svg width="32" height="32" viewBox="0 0 32 32" fill="none" aria-hidden="true"
    xmlns="http://www.w3.org/2000/svg" className={cn('text-primary', className)}>
    <path d="M16 3.5C9.09644 3.5 3.5 9.09644 3.5 16C3.5 22.9036 9.09644 28.5 16 28.5C22.9036 28.5 28.5 22.9036 28.5 16C28.5 9.09644 22.9036 3.5 16 3.5Z"
      stroke="currentColor" strokeWidth="3" />
    <path d="M16.0011 20.9C18.7067 20.9 20.9011 18.7056 20.9011 16C20.9011 13.2944 18.7067 11.1 16.0011 11.1"
      stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
  </svg>
);

// ─── Content ──────────────────────────────────────────────────────────────────

const REPLACES = [
  'Your booking app',
  'The booth-rent spreadsheet',
  'A separate card reader',
  'Reminder texts you send by hand',
  'Paper consent forms',
  'The payroll math on a legal pad',
];

const PILLARS = [
  {
    icon: CalendarCheck,
    title: 'Booking that cannot double-book',
    body:
      'One scheduling engine decides what is open — and the same engine approves the booking. It knows working hours, the published shift roster, approved days off, cleanup padding, and how many stations you actually have. If a time shows on your booking page, it is a time you can honor.',
  },
  {
    icon: CreditCard,
    title: 'Deposits, so no-shows cost them and not you',
    body:
      'Take a deposit at booking, per service, with the card held securely by Stripe. Set your own cancellation window. When someone does not show, the fee is already authorized instead of being a conversation you have to have.',
  },
  {
    icon: MessageSquare,
    title: 'Reminders that go out on their own',
    body:
      'Confirmations and reminders by text and email, sent automatically, with a record of every message. Text consent is captured in writing at booking with the exact wording stored — the part carriers ask about and most tools skip.',
  },
  {
    icon: Home,
    title: 'Booth rent, actually handled',
    body:
      'Renters, signed agreements, card on file, rent charged on schedule, plus short-term chair stays, tours and walkthroughs. Not a workaround on top of employee scheduling — a real second business model, built in.',
  },
  {
    icon: Wallet,
    title: 'One place the money lives',
    body:
      'Checkout with tips and retail, your bank feed, recurring bills, outstanding balances, and reports that tie back to the day they came from. When you ask what you made this month, one number answers.',
  },
  {
    icon: Users,
    title: 'Team, timeclock, and payroll',
    body:
      'Clock in and out, commission or rent-based pay, fair turn rotation so walk-ins spread evenly instead of always landing on whoever is listed first, and a payroll draft ready to hand to Gusto.',
  },
];

const ALSO_INCLUDED = [
  { icon: Smartphone,     label: 'Self check-in kiosk' },
  { icon: Clock,          label: 'Walk-in queue' },
  { icon: ClipboardCheck, label: 'Consent forms with e-signature' },
  { icon: Users,          label: 'Group and party booking' },
  { icon: UserCheck,      label: 'Client history and notes' },
  { icon: LayoutGrid,     label: 'Floor and station map' },
  { icon: Wrench,         label: 'Equipment and maintenance log' },
  { icon: Store,          label: 'Editable public booking page' },
  { icon: Receipt,        label: 'Booth-renter portal' },
  { icon: Calendar,       label: 'Staff portal and schedules' },
];

const STEPS = [
  {
    n: '1',
    title: 'Add your services and your people',
    body: 'Prices, how long each service takes, cleanup time between guests, who does what, and when they work.',
  },
  {
    n: '2',
    title: 'Share your booking link',
    body: 'Put it in your bio and your texts. Guests book, pay their deposit, and sign their forms without calling you.',
  },
  {
    n: '3',
    title: 'Work the day, not the admin',
    body: 'Reminders send themselves, check-in runs itself, rent charges on schedule, and the numbers are already added up.',
  },
];

// Prices and inclusions. Only features that exist in the app today.
const PLANS = [
  {
    name: 'Solo',
    price: '29',
    tagline: 'One chair, everything on it.',
    highlight: false,
    features: [
      'Public booking page with deposits',
      'Text and email reminders',
      'Client history and notes',
      'Checkout, tips and retail',
      'Consent forms with e-signature',
      'Self check-in',
    ],
  },
  {
    name: 'Studio',
    price: '79',
    tagline: 'A team, on one schedule.',
    highlight: true,
    features: [
      'Everything in Solo',
      'Unlimited staff accounts',
      'Fair turn rotation for walk-ins',
      'Timeclock and staff portal',
      'Payroll draft and Gusto export',
      'Bank feed, bills and reporting',
    ],
  },
  {
    name: 'Studio + Booths',
    price: '149',
    tagline: 'You rent chairs as well as fill them.',
    highlight: false,
    features: [
      'Everything in Studio',
      'Booth renters and agreements',
      'Card on file, rent on schedule',
      'Short-term stays and tours',
      'Renter portal',
      'Equipment and maintenance log',
    ],
  },
];

const FAQS = [
  {
    q: 'What does it cost right now?',
    a: 'Nothing. ClarityFlow is in early access, there is no checkout wired up yet, and no card is asked for at signup. The prices above are what is planned. If that changes you will hear it from us before it affects you, not after.',
  },
  {
    q: 'Do I need to buy any equipment?',
    a: 'No. It runs in a browser on the phone, tablet or computer you already have. Card payments run through Stripe, so if you want to take cards in person you connect an account rather than buying a terminal from us.',
  },
  {
    q: 'Do my clients have to download anything or make an account?',
    a: 'No. They open your booking link, pick a time, and book. Deposits, consent forms and reminders all happen in that same flow. Returning guests are recognized by their email or mobile number.',
  },
  {
    q: 'Will it stop double-bookings if I also take appointments by phone?',
    a: 'Yes. The appointments you add at the front desk and the ones guests make online go through the same availability rules, so one closes the time on the other. The front desk can override for someone standing in front of you; the public page cannot.',
  },
  {
    q: 'Can it handle booth renters and employees at the same time?',
    a: 'That is the reason it exists. Renters have their own agreements, card on file and portal, and their rent is charged on its own schedule, while employees are on commission or hourly with a timeclock. Most salon software makes you pick one and fake the other.',
  },
  {
    q: 'Do I have to move everything over at once?',
    a: 'No, and it usually goes better if you do not. Most studios start with the booking page and reminders, because that is where the lost money is, then bring over rent, payroll and reporting once the front of the house is steady.',
  },
];

// ─── Small pieces ─────────────────────────────────────────────────────────────

const Eyebrow = ({ children }: { children: React.ReactNode }) => (
  <span className="inline-flex items-center rounded-full border border-primary/20 bg-primary/5 px-3 py-1 text-[10px] font-black uppercase tracking-[0.2em] text-primary">
    {children}
  </span>
);

const SectionHead = ({ eyebrow, title, sub }: { eyebrow: string; title: string; sub?: string }) => (
  <div className="mx-auto mb-10 max-w-2xl space-y-4 text-center sm:mb-14">
    <Eyebrow>{eyebrow}</Eyebrow>
    <h2 className="text-balance text-3xl font-black uppercase leading-[1.05] tracking-tight text-foreground sm:text-4xl lg:text-5xl">
      {title}
    </h2>
    {sub && <p className="text-pretty text-base leading-relaxed text-muted-foreground sm:text-lg">{sub}</p>}
  </div>
);

// A mock of the actual product, not a stock photo of a salon. It costs nothing
// to load, cannot 404, and shows a visitor what they are signing up for.
const ProductMock = () => (
  <div className="rounded-3xl border bg-card p-4 shadow-xl sm:p-6">
    <div className="mb-4 flex items-center justify-between gap-3">
      <div className="min-w-0">
        <p className="text-[9px] font-black uppercase tracking-[0.25em] text-muted-foreground">Today</p>
        <p className="truncate text-lg font-black uppercase tracking-tight text-foreground">Tuesday schedule</p>
      </div>
      <span className="shrink-0 rounded-full bg-primary/10 px-3 py-1 text-[9px] font-black uppercase tracking-widest text-primary">
        6 booked
      </span>
    </div>
    <div className="space-y-2">
      {[
        { t: '9:00',  who: 'Dana R.',   svc: 'Gel manicure',    tag: 'Deposit paid', tone: 'ok' },
        { t: '10:30', who: 'Priya S.',  svc: 'Full set + art',   tag: 'Confirmed',    tone: 'ok' },
        { t: '12:00', who: '—',         svc: 'Cleanup + lunch',  tag: 'Blocked',      tone: 'off' },
        { t: '1:00',  who: 'Marcus T.', svc: 'Pedicure',         tag: 'Reminded',     tone: 'ok' },
        { t: '2:30',  who: 'Open',      svc: 'Any available',    tag: 'Bookable',     tone: 'open' },
      ].map(row => (
        <div key={row.t} className="flex items-center gap-3 rounded-2xl border bg-background/60 px-3 py-2.5">
          <span className="w-12 shrink-0 text-right text-[11px] font-black tabular-nums text-muted-foreground">{row.t}</span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs font-black uppercase tracking-tight text-foreground">{row.who}</p>
            <p className="truncate text-[11px] font-medium text-muted-foreground">{row.svc}</p>
          </div>
          <span className={cn(
            'shrink-0 rounded-full px-2 py-0.5 text-[8px] font-black uppercase tracking-widest',
            row.tone === 'ok'   && 'bg-green-500/10 text-green-600',
            row.tone === 'off'  && 'bg-muted text-muted-foreground',
            row.tone === 'open' && 'bg-primary/10 text-primary',
          )}>
            {row.tag}
          </span>
        </div>
      ))}
    </div>
    <div className="mt-4 flex flex-wrap items-center gap-2 border-t pt-4">
      <span className="rounded-full bg-muted px-3 py-1 text-[9px] font-black uppercase tracking-widest text-muted-foreground">Rent charged · 3 renters</span>
      <span className="rounded-full bg-muted px-3 py-1 text-[9px] font-black uppercase tracking-widest text-muted-foreground">Reminders sent · 6</span>
    </div>
  </div>
);

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function LandingPage() {
  const year = new Date().getFullYear();

  return (
    <div className="flex min-h-screen flex-col overflow-x-hidden bg-background selection:bg-primary/20">
      {/* Soft background wash. Fixed and non-interactive so it cannot eat taps. */}
      <div aria-hidden="true" className="pointer-events-none fixed inset-0 z-0 overflow-hidden">
        <div className="absolute -left-1/4 -top-1/4 h-[50%] w-[75%] rounded-full bg-primary/5 blur-[120px]" />
        <div className="absolute -bottom-1/4 -right-1/4 h-[50%] w-[75%] rounded-full bg-indigo-500/5 blur-[120px]" />
      </div>

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <header className="sticky top-0 z-50 w-full border-b bg-background/85 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-3 px-5 sm:h-20">
          <Link href="/" className="flex min-w-0 items-center gap-3 py-2">
            <Logo className="h-8 w-8 shrink-0" />
            <span className="truncate text-xl font-black uppercase tracking-tighter text-foreground">ClarityFlow</span>
          </Link>

          <nav className="hidden items-center gap-8 lg:flex">
            <a href="#what-it-does" className="py-2 text-[10px] font-black uppercase tracking-widest text-muted-foreground transition-colors hover:text-primary">What it does</a>
            <a href="#pricing" className="py-2 text-[10px] font-black uppercase tracking-widest text-muted-foreground transition-colors hover:text-primary">Pricing</a>
            <a href="#faq" className="py-2 text-[10px] font-black uppercase tracking-widest text-muted-foreground transition-colors hover:text-primary">Questions</a>
          </nav>

          <div className="flex shrink-0 items-center gap-2 sm:gap-4">
            <Link href="/login" className="hidden px-2 py-4 text-[10px] font-black uppercase tracking-widest text-muted-foreground transition-colors hover:text-primary sm:block">
              Sign in
            </Link>
            <Link href="/signup" className={cn(BTN, BTN_SOLID, 'h-11 rounded-xl px-5 text-[10px] font-black uppercase tracking-widest shadow-lg shadow-primary/20')}>
              Start free
            </Link>
          </div>
        </div>
      </header>

      <main className="relative z-10 flex-1">
        {/* ── Hero ───────────────────────────────────────────────────────────
            The h1 is the headline, not the wordmark. Search engines and screen
            readers both read the old page as being about the word
            "ClarityFlow" and nothing else. */}
        <section className="mx-auto max-w-6xl px-5 pb-16 pt-14 sm:pb-24 sm:pt-20 lg:pt-28">
          <div className="grid items-center gap-12 lg:grid-cols-[1.05fr_1fr] lg:gap-16">
            <div className="space-y-7 text-center lg:text-left">
              <Eyebrow>For salons, spas &amp; booth-rental studios</Eyebrow>

              <h1 className="text-balance text-4xl font-black uppercase leading-[0.95] tracking-tight text-foreground sm:text-5xl lg:text-[4.25rem] lg:leading-[0.9]">
                Booking, booth rent, and payroll.{' '}
                <span className="font-serif lowercase italic tracking-normal text-primary">one</span> app.
              </h1>

              <p className="text-pretty text-base leading-relaxed text-muted-foreground sm:text-lg lg:max-w-xl">
                ClarityFlow runs the front desk and the back office. Online booking that
                never double-books, deposits that make no-shows cost something, reminders
                that send themselves, and rent that charges on time — without a spreadsheet
                holding the whole thing together.
              </p>

              <div className="flex flex-col gap-3 sm:flex-row sm:justify-center lg:justify-start">
                <Link href="/signup" className={cn(BTN, BTN_SOLID, 'group h-14 rounded-2xl px-8 text-base font-black uppercase tracking-tight shadow-xl shadow-primary/25')}>
                  Start free
                  <ArrowRight className="ml-2 h-5 w-5 transition-transform group-hover:translate-x-1" />
                </Link>
                {DEMO_BOOKING_URL ? (
                  <Link href={DEMO_BOOKING_URL} className={cn(BTN, BTN_OUTLINE, 'h-14 rounded-2xl px-8 text-base font-black uppercase tracking-tight')}>
                    See a live booking page
                  </Link>
                ) : (
                  <Link href="/login" className={cn(BTN, BTN_OUTLINE, 'h-14 rounded-2xl px-8 text-base font-black uppercase tracking-tight')}>
                    Sign in
                  </Link>
                )}
              </div>

              <div className="flex flex-wrap items-center justify-center gap-x-5 gap-y-2 text-[10px] font-black uppercase tracking-widest text-muted-foreground lg:justify-start">
                <span className="inline-flex items-center gap-1.5"><Check className="h-3 w-3 text-primary" />No card required</span>
                <span className="inline-flex items-center gap-1.5"><Check className="h-3 w-3 text-primary" />Free in early access</span>
                <span className="inline-flex items-center gap-1.5"><Check className="h-3 w-3 text-primary" />Set up in an afternoon</span>
              </div>
            </div>

            <div className="relative">
              <div aria-hidden="true" className="absolute -inset-6 rounded-[3rem] bg-primary/5 blur-2xl" />
              <div className="relative">
                <ProductMock />
              </div>
            </div>
          </div>
        </section>

        {/* ── What it replaces ───────────────────────────────────────────────
            Buyers price software against the pile of things it removes, so the
            pile is worth naming out loud. */}
        <section className="border-y bg-card/40">
          <div className="mx-auto max-w-6xl px-5 py-12 sm:py-16">
            <p className="mb-6 text-center text-[10px] font-black uppercase tracking-[0.25em] text-muted-foreground">
              Replaces
            </p>
            <div className="flex flex-wrap justify-center gap-2.5">
              {REPLACES.map(item => (
                <span key={item} className="rounded-full border bg-background px-4 py-2 text-[11px] font-bold uppercase tracking-tight text-muted-foreground">
                  {item}
                </span>
              ))}
            </div>
          </div>
        </section>

        {/* ── What it does ──────────────────────────────────────────────────── */}
        <section id="what-it-does" className="mx-auto max-w-6xl scroll-mt-20 px-5 py-16 sm:py-24">
          <SectionHead
            eyebrow="What it does"
            title="Six things, done properly"
            sub="Not a list of modules. These are the six places a studio loses money or loses an evening, and what happens to each one."
          />
          <div className="grid gap-5 sm:grid-cols-2">
            {PILLARS.map(p => (
              <div key={p.title} className="group rounded-3xl border bg-card p-6 shadow-sm transition-shadow hover:shadow-lg sm:p-7">
                <div className="mb-4 inline-flex rounded-2xl bg-primary/10 p-3">
                  <p.icon className="h-5 w-5 text-primary" />
                </div>
                <h3 className="mb-2.5 text-balance text-lg font-black uppercase leading-tight tracking-tight text-foreground">
                  {p.title}
                </h3>
                <p className="text-pretty text-sm leading-relaxed text-muted-foreground">{p.body}</p>
              </div>
            ))}
          </div>

          <div className="mt-10 rounded-3xl border border-dashed bg-card/40 p-6 sm:p-8">
            <p className="mb-5 text-center text-[10px] font-black uppercase tracking-[0.25em] text-muted-foreground">
              Also included, no extra tier
            </p>
            <div className="grid gap-x-6 gap-y-3.5 sm:grid-cols-2 lg:grid-cols-3">
              {ALSO_INCLUDED.map(item => (
                <div key={item.label} className="flex items-center gap-3">
                  <item.icon className="h-4 w-4 shrink-0 text-primary" />
                  <span className="text-xs font-bold uppercase tracking-tight text-muted-foreground">{item.label}</span>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ── How it works ──────────────────────────────────────────────────
            "How long will this take me" is the objection that kills salon
            software deals. Three steps answers it before it is asked. */}
        <section className="border-y bg-card/40">
          <div className="mx-auto max-w-6xl px-5 py-16 sm:py-24">
            <SectionHead eyebrow="Getting started" title="Three steps, one afternoon" />
            <div className="grid gap-6 sm:grid-cols-3">
              {STEPS.map(s => (
                <div key={s.n} className="rounded-3xl border bg-background p-6 sm:p-7">
                  <span className="mb-4 inline-flex h-10 w-10 items-center justify-center rounded-2xl bg-primary text-base font-black text-primary-foreground">
                    {s.n}
                  </span>
                  <h3 className="mb-2 text-balance text-base font-black uppercase leading-tight tracking-tight text-foreground">{s.title}</h3>
                  <p className="text-pretty text-sm leading-relaxed text-muted-foreground">{s.body}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ── Pricing ───────────────────────────────────────────────────────── */}
        <section id="pricing" className="mx-auto max-w-6xl scroll-mt-20 px-5 py-16 sm:py-24">
          <SectionHead
            eyebrow={BILLING_LIVE ? 'Pricing' : 'Early access'}
            title={BILLING_LIVE ? 'Pick the shape of your studio' : 'Free while we are in early access'}
            sub={
              BILLING_LIVE
                ? 'One monthly price. No per-booking fee, no charge for adding your team.'
                : 'Every plan below is open and free right now, and signup does not ask for a card. These are the prices we plan to charge later, shown so nothing about them is a surprise.'
            }
          />

          {!BILLING_LIVE && (
            <div className="mx-auto mb-10 max-w-2xl rounded-2xl border-2 border-dashed border-primary/25 bg-primary/5 p-5 text-center">
              <p className="text-sm font-bold leading-relaxed text-foreground">
                Everything is unlocked during early access. You will be told well before
                any plan starts costing money, and you will never be charged without
                agreeing to it first.
              </p>
            </div>
          )}

          <div className="grid gap-6 lg:grid-cols-3">
            {PLANS.map(plan => (
              <div
                key={plan.name}
                className={cn(
                  'flex flex-col rounded-3xl border-2 bg-card p-6 sm:p-7',
                  plan.highlight ? 'border-primary shadow-xl shadow-primary/10' : 'border-border',
                )}
              >
                {/* In normal flow rather than absolutely positioned above the
                    card — the old badge sat at -top-4 and clipped on mobile. */}
                <div className="mb-4 flex min-h-[22px] items-center justify-between gap-2">
                  <span className="text-[10px] font-black uppercase tracking-[0.2em] text-muted-foreground">
                    {plan.name}
                  </span>
                  {plan.highlight && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-primary px-2.5 py-1 text-[8px] font-black uppercase tracking-widest text-primary-foreground">
                      <Sparkles className="h-2.5 w-2.5" />Most studios
                    </span>
                  )}
                </div>

                <p className="mb-5 text-pretty text-sm font-bold leading-snug text-foreground">{plan.tagline}</p>

                <div className="mb-1 flex items-baseline gap-2">
                  <span className="text-5xl font-black tabular-nums tracking-tighter text-foreground">${plan.price}</span>
                  <span className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">/ month</span>
                </div>
                <p className="mb-6 text-[10px] font-black uppercase tracking-widest text-primary">
                  {BILLING_LIVE ? 'Billed monthly · cancel anytime' : 'Planned · free right now'}
                </p>

                <ul className="mb-7 flex-1 space-y-3">
                  {plan.features.map(f => (
                    <li key={f} className="flex items-start gap-2.5">
                      <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
                      <span className="text-xs font-bold leading-snug text-muted-foreground">{f}</span>
                    </li>
                  ))}
                </ul>

                <Link
                  href="/signup"
                  className={cn(
                    BTN,
                    plan.highlight ? BTN_SOLID : BTN_OUTLINE,
                    'h-14 w-full rounded-2xl text-[11px] font-black uppercase tracking-widest',
                  )}
                >
                  {BILLING_LIVE ? `Choose ${plan.name}` : 'Start free'}
                </Link>
              </div>
            ))}
          </div>
        </section>

        {/* ── FAQ ───────────────────────────────────────────────────────────
            Native details/summary: keyboard accessible, works with JS off, and
            open sections are findable by the browser's own text search. */}
        <section id="faq" className="border-t bg-card/40">
          <div className="mx-auto max-w-3xl scroll-mt-20 px-5 py-16 sm:py-24">
            <SectionHead eyebrow="Questions" title="The ones people actually ask" />
            <div className="space-y-3">
              {FAQS.map(item => (
                <details key={item.q} className="group rounded-2xl border bg-background px-5 open:shadow-md">
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-4 py-5 text-left">
                    <span className="text-balance text-sm font-black uppercase leading-tight tracking-tight text-foreground">
                      {item.q}
                    </span>
                    <ChevronDown className="h-4 w-4 shrink-0 text-primary transition-transform group-open:rotate-180" />
                  </summary>
                  <p className="text-pretty pb-5 text-sm leading-relaxed text-muted-foreground">{item.a}</p>
                </details>
              ))}
            </div>
          </div>
        </section>

        {/* ── Closing CTA ───────────────────────────────────────────────────── */}
        <section className="mx-auto max-w-3xl px-5 py-20 text-center sm:py-28">
          <h2 className="text-balance text-3xl font-black uppercase leading-[1.05] tracking-tight text-foreground sm:text-5xl">
            Start with the booking page.{' '}
            <span className="font-serif lowercase italic tracking-normal text-primary">today.</span>
          </h2>
          <p className="mx-auto mt-6 max-w-xl text-pretty text-base leading-relaxed text-muted-foreground sm:text-lg">
            It takes an afternoon, it costs nothing, and it is the part that pays for
            itself first. The rest can wait until you want it.
          </p>
          <div className="mt-9">
            <Link href="/signup" className={cn(BTN, BTN_SOLID, 'group h-16 rounded-3xl px-10 text-lg font-black uppercase tracking-tight shadow-2xl shadow-primary/30')}>
              Start free
              <ArrowRight className="ml-3 h-6 w-6 transition-transform group-hover:translate-x-1.5" />
            </Link>
          </div>
          <p className="mt-5 text-[10px] font-black uppercase tracking-widest text-muted-foreground">
            No card · No contract · Cancel by closing the tab
          </p>
        </section>
      </main>

      {/* ── Footer ─────────────────────────────────────────────────────────
          These links used to be href="#". They now point at the real platform
          documents: /legal/terms is the subscription agreement for the software
          and /legal/privacy is the platform policy. /terms and /privacy are a
          different pair — those belong to an individual studio and its own
          clients, and must NOT be linked from here. */}
      <footer className="relative z-10 border-t bg-card">
        <div className="mx-auto max-w-6xl px-5 py-12 sm:py-14">
          <div className="flex flex-col gap-8 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-3">
              <Logo className="h-7 w-7 opacity-40" />
              <div>
                <p className="text-sm font-black uppercase tracking-tighter text-foreground">ClarityFlow</p>
                <p className="text-[9px] font-black uppercase tracking-[0.2em] text-muted-foreground">
                  &copy; {year} · Studio management
                </p>
              </div>
            </div>

            <nav className="flex flex-wrap items-center gap-x-7 gap-y-1">
              <Link href="/legal/terms" className="py-4 text-[10px] font-black uppercase tracking-widest text-muted-foreground transition-colors hover:text-primary">
                Terms
              </Link>
              <Link href="/legal/privacy" className="py-4 text-[10px] font-black uppercase tracking-widest text-muted-foreground transition-colors hover:text-primary">
                Privacy
              </Link>
              {SUPPORT_EMAIL && (
                <a href={`mailto:${SUPPORT_EMAIL}`} className="py-4 text-[10px] font-black uppercase tracking-widest text-muted-foreground transition-colors hover:text-primary">
                  Support
                </a>
              )}
              <Link href="/login" className="py-4 text-[10px] font-black uppercase tracking-widest text-primary">
                Sign in
              </Link>
            </nav>
          </div>

          <p className="mt-8 flex items-start gap-2 border-t pt-6 text-[10px] font-medium leading-relaxed text-muted-foreground">
            <ShieldCheck className="mt-px h-3.5 w-3.5 shrink-0 text-primary" />
            Card payments are processed by Stripe. ClarityFlow never stores full card
            numbers, and does not sell or share your data or your clients&apos; data for
            advertising.
          </p>
        </div>
      </footer>
    </div>
  );
}
