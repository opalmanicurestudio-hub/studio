// src/app/page.tsx
//
// MARKETING LANDING PAGE for ClarityFlow — animated, with four interactive demos.
//
// ── HOW THE ANIMATION WORKS, AND WHY IT IS BUILT THIS WAY ───────────────────
//
// The version of this page that existed before was 'use client' so it could use
// framer-motion. That cost three real things: no `metadata` export (no page
// title, no search description, no link preview when shared), a large JS bundle
// before anything drew, and every headline sitting at opacity:0 until that JS
// arrived. On salon wifi that is a blank white screen.
//
// This page is a SERVER component and still moves. Two mechanisms:
//
//   1. Scroll entrance — plain CSS plus the ~20 lines of JavaScript inlined at
//      the top of the body. Any element marked `data-rise` fades and lifts as it
//      enters the viewport. Crucially the hidden state is applied ONLY when that
//      script has run and added `.cf-js` to <html>. So if JavaScript never
//      arrives, or is blocked, or errors, every word on this page is still
//      visible. Motion is a reward here, not a gate. That distinction is the
//      whole reason the old page felt broken and this one does not.
//
//   2. The interactive demos — real client components, imported from
//      src/components/marketing/MarketingClient.tsx. A server component may
//      import and render client components; only the reverse is a problem. They
//      total a small fraction of framer-motion's weight and each one renders
//      complete, readable content before anyone touches it.
//
// Anyone who has asked their device to reduce motion gets a page that does not
// move — the prefers-reduced-motion block at the end of CSS turns all of it off.
//
// ── WHAT THIS PAGE MAY AND MAY NOT CLAIM ───────────────────────────────────
//
// Every feature named below exists in the codebase today. Two temptations to
// resist, because both are visible in the app's navigation but not built:
//
//   · There is NO kitchen/bar display system. AppSidebar has a '/kds' link with
//     a ChefHat icon and there is no page behind it. The lounge section here
//     describes ordering, routing and settlement — all real — and never implies
//     a prep queue or a bar screen.
//   · The concierge kiosk's own card form is not wired to Stripe. "Charge to my
//     station" against a card already on file IS real and runs a genuine
//     off-session charge. Do not turn that into "guests can pay by card here".
//
// ── EDIT THESE THREE LINES ─────────────────────────────────────────────────
//
// DEMO_BOOKING_URL — a real public booking page, e.g. '/book/your-tenant-id'.
//   Letting a stranger tap through a live booking flow is the single strongest
//   asset this page could have. Left '' the button simply does not render.
// SUPPORT_EMAIL — shown in the footer. Left '' the link is omitted.
// BILLING_LIVE — false until subscription checkout actually exists. Signup
//   currently writes subscriptionStatus:'inactive' / subscriptionTier:'none',
//   so there is no way to charge anyone yet. While false, the page says early
//   access and free, and prices are labelled "planned". Flip it the day
//   checkout works, not before.
import type * as React from 'react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { cn } from '@/lib/utils';
import {
  ArrowRight, Calendar, CalendarCheck, CreditCard, MessageSquare, Home,
  Wallet, Users, Check, ChevronDown, ShieldCheck, Smartphone, Clock,
  ClipboardCheck, Store, Receipt, UserCheck, Wrench, LayoutGrid, Coffee,
  Bell, PenLine,
} from 'lucide-react';
import {
  StudioTypeSwitch, AvailabilityDemo, LeakCalculator, ProductTour,
  LoungeWalkthrough,
} from '@/components/marketing/MarketingClient';

// Button looks are written out here rather than pulled from the shared ui button
// module. This page is the first thing a stranger loads, and a named import that
// does not exist there is a failed build rather than a style bug.
const BTN =
  'inline-flex items-center justify-center whitespace-nowrap transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-offset-2';
const BTN_SOLID = 'bg-primary text-primary-foreground hover:bg-primary/90';
const BTN_OUTLINE = 'border-2 border-border bg-background text-foreground hover:bg-muted';

const DEMO_BOOKING_URL = '';
const SUPPORT_EMAIL = '';
const BILLING_LIVE = false;

export const metadata: Metadata = {
  title: 'ClarityFlow — The salon system for chairs you rent and chairs you fill',
  description:
    'One calendar for employees on commission and booth renters paying you. Booking that cannot double-book, deposits that stop no-shows, automatic reminders, rent charged on schedule, a guest lounge menu, and payroll that reconciles itself. Free while in early access.',
  openGraph: {
    title: 'ClarityFlow — The salon system for chairs you rent and chairs you fill',
    description:
      'Commission staff and booth renters on one calendar, with one set of books. Free while in early access.',
    type: 'website',
  },
};

// ─── Motion ───────────────────────────────────────────────────────────────────
// Kept as a string and injected once. It lives here rather than in globals.css
// deliberately: this is the only page that uses it, and adding it to the global
// stylesheet means editing a file every other page depends on.
const MOTION_CSS = `
/* Entrance state is armed ONLY when the inline script below has run. No JS,
   no .cf-js class, nothing hidden. This is the safety property that matters. */
.cf-js [data-rise]{opacity:0;transform:translateY(22px)}
.cf-js [data-rise][data-shown="true"]{
  opacity:1;transform:none;
  transition:opacity .75s cubic-bezier(.22,1,.36,1),transform .75s cubic-bezier(.22,1,.36,1);
}
@keyframes cf-fade-in{from{opacity:0}to{opacity:1}}
.cf-fade{animation:cf-fade-in .34s ease both}
@keyframes cf-step-in{from{opacity:0;transform:translateX(-10px)}to{opacity:1;transform:none}}
.cf-step{animation:cf-step-in .42s cubic-bezier(.22,1,.36,1) both}
@keyframes cf-float{0%,100%{transform:translateY(0)}50%{transform:translateY(-9px)}}
.cf-float{animation:cf-float 7s ease-in-out infinite}
@keyframes cf-pulse{0%,100%{opacity:.45}50%{opacity:1}}
.cf-pulse{animation:cf-pulse 2.4s ease-in-out infinite}
/* No parallax and no scroll-jacking anywhere on this page. Both are the fastest
   way to make a phone visitor close the tab. */
@media (prefers-reduced-motion:reduce){
  .cf-js [data-rise],.cf-js [data-rise][data-shown="true"]{
    opacity:1!important;transform:none!important;transition:none!important;
  }
  .cf-fade,.cf-step,.cf-float,.cf-pulse{animation:none!important}
  *,*::before,*::after{transition-duration:.001ms!important}
}
`;

const RISE_JS = `(function(){var d=document,h=d.documentElement;h.classList.add('cf-js');
function go(){var els=d.querySelectorAll('[data-rise]');
if(!('IntersectionObserver' in window)){h.classList.remove('cf-js');return}
var io=new IntersectionObserver(function(es){es.forEach(function(e){
if(e.isIntersecting){e.target.setAttribute('data-shown','true');io.unobserve(e.target)}})},
{rootMargin:'0px 0px -6% 0px',threshold:.06});
for(var i=0;i<els.length;i++){io.observe(els[i])}
/* If nothing has revealed after four seconds something is wrong. Unarm the
   whole mechanism rather than leave a visitor looking at a blank page. */
setTimeout(function(){if(!d.querySelector('[data-rise][data-shown="true"]')){h.classList.remove('cf-js')}},4000)}
if(d.readyState!=='loading'){go()}else{d.addEventListener('DOMContentLoaded',go)}})();`;

// ─── Logo ─────────────────────────────────────────────────────────────────────
// Inlined rather than imported from AppSidebar. That module is 'use client' and
// drags the whole dashboard navigation with it — a marketing page should not ship
// the app sidebar to a first-time visitor just to draw a 32px mark.
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

// In-page quick links. Same list in the header on desktop and the footer
// everywhere, so a visitor who scrolls past something can get back to it.
// Two labels per entry on purpose: the header strip only has about 690px of
// room between the logo and the buttons, and the long labels wrapped onto two
// lines inside a 64px-tall sticky bar. `short` goes in the header, `label` in
// the footer where there is a whole column to spend.
const NAV = [
  { href: '#scheduler', short: 'Scheduler', label: 'The scheduler' },
  { href: '#lounge',    short: 'Lounge',    label: 'Guest lounge' },
  { href: '#worth',     short: 'Savings',   label: 'What it saves' },
  { href: '#tour',      short: 'Screens',   label: 'The screens' },
  { href: '#pricing',   short: 'Pricing',   label: 'Pricing' },
  { href: '#faq',       short: 'Questions', label: 'Questions' },
];

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
      'One engine decides what is open, and the same engine approves the booking. It knows studio hours, the published roster, approved time off, each person\'s own week, cleanup padding, how many stations you have, and which equipment is down. If a time shows on your page, it is a time you can honor.',
  },
  {
    icon: CreditCard,
    title: 'Deposits, so a no-show costs them and not you',
    body:
      'Take a deposit at booking, per service, with the card held by Stripe. Set your own cancellation window. When someone does not show, the fee is already authorized instead of being a conversation you have to have.',
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
      'Renters, signed agreements, card on file, rent charged on schedule, late rent surfacing on its own, plus short-term chair stays, tours and walkthroughs. Not a workaround layered on employee scheduling — a second business model, built in.',
  },
  {
    icon: Coffee,
    title: 'A lounge that runs like a hotel',
    body:
      'A branded tablet in your waiting area, or your guest\'s own phone during her appointment. She orders from a menu priced out of your inventory; it routes with her seat, her station and a description so anyone can find her; and it settles as a comp, on the renter\'s card, or on her own.',
  },
  {
    icon: Wallet,
    title: 'One place the money lives',
    body:
      'Checkout with tips and retail, your bank feed, recurring bills, outstanding balances, commission and rent side by side, and reports that tie back to the day they came from. When you ask what you made this month, one number answers.',
  },
];

const ALSO_INCLUDED = [
  { icon: Smartphone,     label: 'Self check-in by link' },
  { icon: Clock,          label: 'Walk-in kiosk' },
  { icon: ClipboardCheck, label: 'Consent forms with e-signature' },
  { icon: Users,          label: 'Group and party booking' },
  { icon: UserCheck,      label: 'Client history and photos' },
  { icon: LayoutGrid,     label: 'Floor and station map' },
  { icon: Bell,           label: 'Live floor request board' },
  { icon: Wrench,         label: 'Equipment and maintenance log' },
  { icon: Store,          label: 'Editable public booking page' },
  { icon: Receipt,        label: 'Booth-renter portal' },
  { icon: Calendar,       label: 'Staff portal and timeclock' },
  { icon: PenLine,        label: 'Signed rental agreements' },
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
    body: 'Put it in your bio and your texts. Guests book, pay a deposit and sign their forms without calling you.',
  },
  {
    n: '3',
    title: 'Work the day, not the admin',
    body: 'Reminders send themselves, check-in runs itself, rent charges on schedule, and the numbers are already added up.',
  },
];

// Prices and inclusions. Every line is a feature that exists today. Adding an
// unbuilt one back is how a refund request starts.
const PLANS = [
  {
    name: 'Solo',
    price: '39',
    tagline: 'One chair, everything on it.',
    highlight: false,
    features: [
      'Public booking page with deposits',
      'Text and email reminders',
      'Client history and photos',
      'Checkout, tips and retail',
      'Consent forms with e-signature',
      'Self check-in by link',
    ],
  },
  {
    name: 'Studio',
    price: '149',
    tagline: 'A team, on one schedule.',
    highlight: false,
    features: [
      'Everything in Solo',
      'Up to 6 staff, then $19 each',
      'Roster, time off, timeclock',
      'Fair turn rotation for walk-ins',
      'Payroll draft and Gusto export',
      'Bank feed, bills and reporting',
    ],
  },
  {
    name: 'Studio + Booths',
    price: '279',
    tagline: 'You rent chairs as well as fill them.',
    highlight: true,
    features: [
      'Everything in Studio',
      'Booth renters and signed agreements',
      'Card on file, rent on schedule',
      'Short-term stays and studio tours',
      'Renter portal and maintenance log',
      'Guest lounge menu and settlement',
    ],
  },
];

const FAQS = [
  {
    q: 'What does it cost right now?',
    a: 'Nothing. ClarityFlow is in early access, there is no checkout wired up, and no card is asked for at signup. The prices above are what is planned. If that changes you will hear it before it affects you, not after.',
  },
  {
    q: 'Do I need to buy any equipment?',
    a: 'No. It runs in a browser on the phone, tablet or computer you already have. The lounge kiosk is a tablet you probably own. Card payments run through Stripe, so taking cards in person means connecting an account rather than buying a terminal from us.',
  },
  {
    q: 'Do my clients have to download anything?',
    a: 'No. They open your booking link, pick a time and book. Deposits, consent forms and reminders all happen in that same flow, and returning guests are recognized by their email or mobile number.',
  },
  {
    q: 'Will it stop double-bookings if I also take appointments by phone?',
    a: 'Yes. Appointments added at the front desk and appointments made online go through the same availability rules, so one closes the time on the other. The front desk can override for someone standing in front of you; the public page cannot.',
  },
  {
    q: 'Can it really handle renters and employees at the same time?',
    a: 'That is the reason it exists. Renters have their own agreements, card on file and portal, and rent is charged on its own schedule, while employees are on commission or hourly with a timeclock — all on one calendar, with reporting that keeps the two apart. Most salon software makes you pick one and fake the other.',
  },
  {
    q: 'What is the lounge menu, exactly?',
    a: 'A guest orders a drink or an amenity — from a branded tablet in your waiting area, or from her own phone through her check-in link. Items and prices come from the inventory you already keep. The order carries her seat, her station and a short description so whoever is free can find her, and it settles as a comp out of an allowance you set, on a renter\'s card on file, or on the guest\'s own station.',
  },
  {
    q: 'Do I have to move everything over at once?',
    a: 'No, and it usually goes better if you do not. Most studios start with the booking page and reminders, because that is where the lost money is, then bring over rent, payroll and reporting once the front of the house is steady.',
  },
];

// ─── Small pieces ─────────────────────────────────────────────────────────────

const Eyebrow = ({ children }: { children: React.ReactNode }) => (
  <span className="inline-flex items-center rounded-full border border-primary/20 bg-primary/5 px-3 py-1 text-[11px] font-black uppercase tracking-[0.2em] text-primary">
    {children}
  </span>
);

const SectionHead = ({ eyebrow, title, sub }: { eyebrow: string; title: string; sub?: string }) => (
  <div data-rise className="mx-auto mb-10 max-w-2xl space-y-4 text-center sm:mb-14">
    <Eyebrow>{eyebrow}</Eyebrow>
    <h2 className="text-balance text-3xl font-black uppercase leading-[1.05] tracking-tight text-foreground sm:text-4xl lg:text-5xl">
      {title}
    </h2>
    {sub && <p className="text-pretty text-base leading-relaxed text-muted-foreground sm:text-lg">{sub}</p>}
  </div>
);

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function LandingPage() {
  const year = new Date().getFullYear();

  return (
    <div className="flex min-h-screen flex-col overflow-x-hidden bg-background selection:bg-primary/20">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-xl focus:bg-foreground focus:px-4 focus:py-3 focus:text-sm focus:font-bold focus:text-background"
      >
        Skip to content
      </a>
      <style dangerouslySetInnerHTML={{ __html: MOTION_CSS }} />
      <script dangerouslySetInnerHTML={{ __html: RISE_JS }} />

      {/* Soft wash. Fixed, non-interactive, and clipped so it cannot cause a
          sideways scrollbar or eat a tap. */}
      <div aria-hidden="true" className="pointer-events-none fixed inset-0 z-0 overflow-hidden">
        <div className="cf-float absolute -left-1/4 -top-1/4 h-[50%] w-[75%] rounded-full bg-primary/5 blur-[120px]" />
        <div className="cf-float absolute -bottom-1/4 -right-1/4 h-[50%] w-[75%] rounded-full bg-indigo-500/5 blur-[120px]"
          style={{ animationDelay: '3.5s' }} />
      </div>

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <header className="sticky top-0 z-50 w-full border-b bg-background/85 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-3 px-5 sm:h-20">
          <Link href="/" className="flex min-w-0 items-center gap-3 py-3">
            <Logo className="h-8 w-8 shrink-0" />
            <span className="truncate text-xl font-black uppercase tracking-tighter text-foreground">ClarityFlow</span>
          </Link>

          <nav aria-label="Sections" className="hidden items-center gap-1 lg:flex">
            {NAV.map(n => (
              <a key={n.href} href={n.href}
                className="flex min-h-[40px] items-center whitespace-nowrap rounded-full px-3 text-[11px] font-black uppercase tracking-widest text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">
                {n.short}
              </a>
            ))}
          </nav>

          <div className="flex shrink-0 items-center gap-2">
            <Link href="/login"
              className="hidden px-3 py-4 text-[11px] font-black uppercase tracking-widest text-muted-foreground transition-colors hover:text-foreground sm:block">
              Log in
            </Link>
            <Link href="/signup" className={cn(BTN, BTN_SOLID, 'h-11 rounded-full px-4 text-[11px] font-black uppercase tracking-widest')}>
              Start free
            </Link>
          </div>
        </div>
      </header>

      <main id="main" className="relative z-10 flex-1">
        {/* ── Hero ─────────────────────────────────────────────────────────── */}
        <section className="mx-auto max-w-6xl px-5 pb-16 pt-12 sm:pb-24 sm:pt-20">
          <div className="grid items-start gap-10 lg:grid-cols-2 lg:gap-14">
            <div data-rise className="space-y-7">
              <Eyebrow>You outgrew your booking app</Eyebrow>

              <h1 className="text-balance text-4xl font-black uppercase leading-[0.95] tracking-tighter text-foreground sm:text-5xl lg:text-6xl">
                The system a studio runs on when{' '}
                <span className="text-primary">some chairs are rented</span> and some are not.
              </h1>

              <p className="text-pretty text-base leading-relaxed text-muted-foreground sm:text-lg">
                Commission staff and booth renters, on one calendar and one set of books. No spreadsheet
                doing the other half.
              </p>

              <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
                <Link href="/signup"
                  className={cn(BTN, BTN_SOLID, 'h-14 rounded-2xl px-7 text-[12px] font-black uppercase tracking-widest')}>
                  Start free
                  <ArrowRight className="ml-2 h-4 w-4" aria-hidden="true" />
                </Link>
                {DEMO_BOOKING_URL ? (
                  <Link href={DEMO_BOOKING_URL}
                    className={cn(BTN, BTN_OUTLINE, 'h-14 rounded-2xl px-7 text-[12px] font-black uppercase tracking-widest')}>
                    Book a fake appointment
                  </Link>
                ) : (
                  <a href="#scheduler"
                    className={cn(BTN, BTN_OUTLINE, 'h-14 rounded-2xl px-7 text-[12px] font-black uppercase tracking-widest')}>
                    See it work
                  </a>
                )}
              </div>

              <ul className="flex flex-wrap gap-x-5 gap-y-2">
                {['Free in early access', 'No card', 'Live in an afternoon'].map(t => (
                  <li key={t} className="flex items-center gap-1.5 text-[11px] font-black uppercase tracking-widest text-muted-foreground">
                    <Check className="h-3.5 w-3.5 text-primary" aria-hidden="true" />{t}
                  </li>
                ))}
              </ul>
            </div>

            {/* Qualifies the visitor in one tap. */}
            <div data-rise>
              <StudioTypeSwitch billingLive={BILLING_LIVE} />
            </div>
          </div>
        </section>

        {/* ── Replaces ─────────────────────────────────────────────────────── */}
        <section className="border-y bg-muted/30 py-12 sm:py-16">
          <div className="mx-auto max-w-6xl px-5">
            <p data-rise className="mb-6 text-center text-[11px] font-black uppercase tracking-[0.2em] text-muted-foreground">
              Replaces, on day one
            </p>
            <ul data-rise className="flex flex-wrap items-center justify-center gap-2.5">
              {REPLACES.map(r => (
                <li key={r}
                  className="rounded-full border bg-background px-4 py-2 text-[11px] font-black uppercase tracking-wider text-muted-foreground">
                  {r}
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* ── The scheduler demo. The best thirty seconds on the page. ──────── */}
        <section id="scheduler" className="scroll-mt-24 py-16 sm:py-24">
          <div className="mx-auto max-w-6xl px-5">
            <SectionHead
              eyebrow="Show and tell · not a screenshot"
              title="Tap a grey time. It tells you exactly why it is closed."
              sub="The real engine, running here. Most tools check two things before booking. This checks eight."
            />
            <div data-rise>
              <AvailabilityDemo />
            </div>
          </div>
        </section>

        {/* ── The lounge ───────────────────────────────────────────────────── */}
        <section id="lounge" className="scroll-mt-24 border-y bg-muted/30 py-16 sm:py-24">
          <div className="mx-auto max-w-6xl px-5">
            <SectionHead
              eyebrow="Guest experience"
              title="If you serve a coffee, that is a business too."
              sub="Drinks and extras usually run on goodwill and never reach the books. Here they are a menu, a delivery, a settled charge."
            />
            <div data-rise>
              <LoungeWalkthrough />
            </div>

            <p data-rise className="mx-auto mt-8 max-w-3xl text-center text-sm leading-relaxed text-muted-foreground">
              Every order lands on the guest and the renter's profile with how it settled — comped,
              charged, or paid by the client.
            </p>
          </div>
        </section>

        {/* ── Pillars ──────────────────────────────────────────────────────── */}
        <section className="py-16 sm:py-24">
          <div className="mx-auto max-w-6xl px-5">
            <SectionHead
              eyebrow="What it actually does"
              title="Six things, done properly"
              sub="The six places a growing studio loses money and hours."
            />
            <div className="grid gap-4 sm:grid-cols-2 lg:gap-6">
              {PILLARS.map(p => (
                <div key={p.title} data-rise
                  className="rounded-3xl border bg-card p-6 shadow-sm transition-shadow hover:shadow-lg">
                  <span className="mb-4 inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10">
                    <p.icon className="h-6 w-6 text-primary" aria-hidden="true" />
                  </span>
                  <h3 className="text-lg font-black uppercase leading-tight tracking-tight text-foreground">{p.title}</h3>
                  <p className="mt-2.5 text-sm leading-relaxed text-muted-foreground">{p.body}</p>
                </div>
              ))}
            </div>

            <div data-rise className="mt-8 rounded-3xl border bg-card p-6 sm:mt-10 sm:p-8">
              <p className="mb-5 text-[11px] font-black uppercase tracking-[0.2em] text-muted-foreground">
                And the rest of it
              </p>
              <ul className="grid gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
                {ALSO_INCLUDED.map(a => (
                  <li key={a.label} className="flex items-center gap-2.5">
                    <a.icon className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
                    <span className="text-xs font-bold uppercase tracking-wide text-foreground">{a.label}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </section>

        {/* ── The calculator ───────────────────────────────────────────────── */}
        <section id="worth" className="scroll-mt-24 border-y bg-muted/30 py-16 sm:py-24">
          <div className="mx-auto max-w-6xl px-5">
            <SectionHead
              eyebrow="What it is worth"
              title="The money is already leaving. Move the sliders."
              sub="Four leaks, priced with your own numbers."
            />
            <div data-rise>
              <LeakCalculator billingLive={BILLING_LIVE} />
            </div>
          </div>
        </section>

        {/* ── Tour ─────────────────────────────────────────────────────────── */}
        <section id="tour" className="scroll-mt-24 py-16 sm:py-24">
          <div className="mx-auto max-w-6xl px-5">
            <SectionHead
              eyebrow="The screens"
              title="Four you will live in"
              sub="Built from the real interface, so it stays honest."
            />
            <div data-rise>
              <ProductTour />
            </div>
          </div>
        </section>

        {/* ── Steps ────────────────────────────────────────────────────────── */}
        <section className="border-y bg-muted/30 py-16 sm:py-24">
          <div className="mx-auto max-w-6xl px-5">
            <SectionHead eyebrow="Getting started" title="Three steps, one afternoon" />
            <ol className="grid gap-4 sm:grid-cols-3 lg:gap-6">
              {STEPS.map(s => (
                <li key={s.n} data-rise className="rounded-3xl border bg-card p-6">
                  <span className="mb-4 inline-flex h-11 w-11 items-center justify-center rounded-2xl bg-primary text-lg font-black text-primary-foreground">
                    {s.n}
                  </span>
                  <h3 className="text-base font-black uppercase leading-tight tracking-tight text-foreground">{s.title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{s.body}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        {/* ── Pricing ──────────────────────────────────────────────────────── */}
        <section id="pricing" className="scroll-mt-24 py-16 sm:py-24">
          <div className="mx-auto max-w-6xl px-5">
            <SectionHead
              eyebrow={BILLING_LIVE ? 'Pricing' : 'Planned pricing'}
              title={BILLING_LIVE ? 'Pick the one that matches your chairs' : 'Free now. This is what it will cost.'}
              sub={
                BILLING_LIVE
                  ? 'One price per studio, not per stylist. Cancel whenever — your data exports on the way out.'
                  : 'There is no checkout wired up yet and no card is asked for at signup. These are the prices we intend to charge, published early so nobody is surprised.'
              }
            />

            <div className="grid gap-5 lg:grid-cols-3 lg:gap-6">
              {PLANS.map(plan => (
                <div key={plan.name} data-rise
                  className={cn(
                    'relative flex flex-col rounded-3xl border bg-card p-6 sm:p-7',
                    plan.highlight && 'border-primary shadow-2xl lg:-mt-3 lg:mb-3',
                  )}>
                  {plan.highlight && (
                    <span className="absolute -top-3 left-6 rounded-full bg-primary px-3 py-1 text-[9px] font-black uppercase tracking-widest text-primary-foreground">
                      Nobody else sells this
                    </span>
                  )}

                  <p className="text-[11px] font-black uppercase tracking-[0.2em] text-muted-foreground">{plan.name}</p>
                  <p className="mt-3 flex items-baseline gap-1.5">
                    <span className="text-5xl font-black tracking-tighter text-foreground">${plan.price}</span>
                    <span className="text-[11px] font-black uppercase tracking-widest text-muted-foreground">/ month</span>
                  </p>
                  <p className="mt-2 text-sm font-bold text-muted-foreground">{plan.tagline}</p>
                  {!BILLING_LIVE && (
                    <p className="cf-pulse mt-2 text-[11px] font-black uppercase tracking-widest text-primary">
                      Free during early access
                    </p>
                  )}

                  <ul className="mt-6 flex-1 space-y-2.5 border-t pt-6">
                    {plan.features.map(f => (
                      <li key={f} className="flex items-start gap-2.5">
                        <Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
                        <span className="text-xs font-bold leading-snug text-foreground">{f}</span>
                      </li>
                    ))}
                  </ul>

                  <Link href="/signup"
                    className={cn(
                      BTN,
                      plan.highlight ? BTN_SOLID : BTN_OUTLINE,
                      'mt-7 h-14 w-full rounded-2xl text-[11px] font-black uppercase tracking-widest',
                    )}>
                    {BILLING_LIVE ? `Start with ${plan.name}` : 'Start free'}
                  </Link>
                </div>
              ))}
            </div>

            <p data-rise className="mx-auto mt-8 max-w-2xl text-center text-xs leading-relaxed text-muted-foreground">
              One price per studio, not per stylist. Payments run through your own Stripe account at
              Stripe's rates — no markup.
            </p>
          </div>
        </section>

        {/* ── FAQ ──────────────────────────────────────────────────────────── */}
        <section id="faq" className="scroll-mt-24 border-t bg-muted/30 py-16 sm:py-24">
          <div className="mx-auto max-w-3xl px-5">
            <SectionHead eyebrow="Straight answers" title="Questions worth asking" />
            <div className="space-y-3">
              {/* Native details/summary: keyboard accessible, works without JS,
                  and findable by the browser's own in-page search. */}
              {FAQS.map(f => (
                <details key={f.q} data-rise className="group rounded-3xl border bg-card px-5 py-1 sm:px-6">
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-4 py-4 text-sm font-black uppercase leading-snug tracking-tight text-foreground marker:hidden">
                    {f.q}
                    <ChevronDown
                      className="h-5 w-5 shrink-0 text-muted-foreground transition-transform group-open:rotate-180"
                      aria-hidden="true"
                    />
                  </summary>
                  <p className="pb-5 text-sm leading-relaxed text-muted-foreground">{f.a}</p>
                </details>
              ))}
            </div>
          </div>
        </section>

        {/* ── Close ────────────────────────────────────────────────────────── */}
        <section className="py-20 sm:py-28">
          <div data-rise className="mx-auto max-w-2xl px-5 text-center">
            <h2 className="text-balance text-3xl font-black uppercase leading-[1.05] tracking-tight text-foreground sm:text-4xl lg:text-5xl">
              Start with the booking page. Today.
            </h2>
            <p className="mx-auto mt-5 max-w-xl text-pretty text-base leading-relaxed text-muted-foreground sm:text-lg">
              An afternoon to set up. Free in early access.
            </p>
            <div className="mt-8 flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
              <Link href="/signup"
                className={cn(BTN, BTN_SOLID, 'h-14 w-full rounded-2xl px-8 text-[12px] font-black uppercase tracking-widest sm:w-auto')}>
                Start free
                <ArrowRight className="ml-2 h-4 w-4" aria-hidden="true" />
              </Link>
              <Link href="/login"
                className={cn(BTN, BTN_OUTLINE, 'h-14 w-full rounded-2xl px-8 text-[12px] font-black uppercase tracking-widest sm:w-auto')}>
                Log in
              </Link>
            </div>
            <p className="mt-5 flex items-center justify-center gap-2 text-[11px] font-black uppercase tracking-widest text-muted-foreground">
              <ShieldCheck className="h-4 w-4 text-primary" aria-hidden="true" />
              No card · no contract · export your data whenever
            </p>
          </div>
        </section>
      </main>

      {/* ── Footer ───────────────────────────────────────────────────────────
          QUICK LINKS. Note carefully which legal pages go here:
            /legal/terms   and /legal/privacy   are ClarityFlow's OWN documents,
                                               governing you as the platform.
            /terms         and /privacy         are a DIFFERENT pair — the ones a
                                               studio publishes to ITS clients,
                                               required for A2P 10DLC text
                                               approval. They must NOT be linked
                                               from marketing; a stranger reading
                                               them will think they are ours. */}
      <footer className="relative z-10 border-t bg-background">
        <div className="mx-auto max-w-6xl px-5 py-12 sm:py-16">
          <div className="grid gap-10 sm:grid-cols-2 lg:grid-cols-4">
            <div className="lg:col-span-1">
              <Link href="/" className="flex items-center gap-3 py-2">
                <Logo className="h-7 w-7" />
                <span className="text-lg font-black uppercase tracking-tighter text-foreground">ClarityFlow</span>
              </Link>
              <p className="mt-3 max-w-xs text-xs leading-relaxed text-muted-foreground">
                Booking, booth rent, the guest lounge and payroll, in one place — built for studios where
                some chairs are rented and some are not.
              </p>
            </div>

            <div>
              <p className="mb-4 text-[11px] font-black uppercase tracking-[0.2em] text-muted-foreground">On this page</p>
              <ul className="space-y-1">
                {NAV.map(n => (
                  <li key={n.href}>
                    <a href={n.href}
                      className="flex min-h-[44px] items-center text-xs font-bold text-muted-foreground transition-colors hover:text-foreground">
                      {n.label}
                    </a>
                  </li>
                ))}
              </ul>
            </div>

            <div>
              <p className="mb-4 text-[11px] font-black uppercase tracking-[0.2em] text-muted-foreground">Your account</p>
              <ul className="space-y-1">
                <li>
                  <Link href="/signup" className="flex min-h-[44px] items-center text-xs font-bold text-muted-foreground transition-colors hover:text-foreground">
                    Create a studio
                  </Link>
                </li>
                <li>
                  <Link href="/login" className="flex min-h-[44px] items-center text-xs font-bold text-muted-foreground transition-colors hover:text-foreground">
                    Log in
                  </Link>
                </li>
                {DEMO_BOOKING_URL && (
                  <li>
                    <Link href={DEMO_BOOKING_URL} className="flex min-h-[44px] items-center text-xs font-bold text-muted-foreground transition-colors hover:text-foreground">
                      Try a live booking page
                    </Link>
                  </li>
                )}
                {SUPPORT_EMAIL && (
                  <li>
                    <a href={`mailto:${SUPPORT_EMAIL}`}
                      className="flex min-h-[44px] items-center text-xs font-bold text-muted-foreground transition-colors hover:text-foreground">
                      Email support
                    </a>
                  </li>
                )}
              </ul>
            </div>

            <div>
              <p className="mb-4 text-[11px] font-black uppercase tracking-[0.2em] text-muted-foreground">Legal</p>
              <ul className="space-y-1">
                <li>
                  <Link href="/legal/terms" className="flex min-h-[44px] items-center text-xs font-bold text-muted-foreground transition-colors hover:text-foreground">
                    Terms of service
                  </Link>
                </li>
                <li>
                  <Link href="/legal/privacy" className="flex min-h-[44px] items-center text-xs font-bold text-muted-foreground transition-colors hover:text-foreground">
                    Privacy policy
                  </Link>
                </li>
              </ul>
            </div>
          </div>

          <div className="mt-10 flex flex-col gap-3 border-t pt-6 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-[11px] font-black uppercase tracking-widest text-muted-foreground">
              © {year} ClarityFlow. All rights reserved.
            </p>
            <p className="text-[11px] font-black uppercase tracking-widest text-muted-foreground">
              Built for studios that rent chairs and fill them
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
}
