'use client';

// src/components/marketing/MarketingClient.tsx
//
// The interactive parts of the marketing page — and ONLY the interactive parts.
//
// Why this file exists at all:
//   src/app/page.tsx has to stay a server component. The moment it becomes
//   'use client' it loses its `metadata` export, which means no page title, no
//   search description and no link preview when someone shares it. The old
//   landing page made exactly that trade and it cost far more than the animation
//   was worth.
//
//   So the page stays on the server, and the four things a visitor can actually
//   touch live here as client islands. A server component is allowed to import
//   and render client components; the reverse is what breaks.
//
// What is deliberately NOT here:
//   The scroll-entrance animation. That is done with CSS plus about fifteen
//   lines of plain JavaScript inlined in page.tsx, so it ships zero bytes of
//   React and cannot leave text stranded behind a failed hydration. Headings
//   fading in do not need a component.
//
// Everything below renders complete, readable content on first paint. Nothing
// is hidden waiting for a click. If the JavaScript for this file never arrives,
// a visitor still sees a filled-in scheduler, a priced plan and a populated
// table — they just cannot change them.
import * as React from 'react';
import { cn } from '@/lib/utils';
import {
  Check, X, ChevronRight, Coffee, MapPin, Shirt, CreditCard, Gift,
} from 'lucide-react';

// Shared button looks. Written out rather than imported from the shared ui
// button module for the same reason page.tsx does it: a named import that does
// not exist there is a failed Vercel build, not a styling bug.
const BTN =
  'inline-flex items-center justify-center whitespace-nowrap transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-offset-2';

// ─────────────────────────────────────────────────────────────────────────────
// 1. STUDIO TYPE SWITCH
//
// Qualifies the visitor in one tap and makes the rest of the page read as if it
// were written for them. Defaults to index 3 — the hybrid case — because that is
// the one no competitor can serve and therefore the one worth leading with.
// ─────────────────────────────────────────────────────────────────────────────

type Seg = {
  key: string;
  label: string;
  title: string;
  body: string;
  feats: string[];
  price: number;
};

const SEGS: Seg[] = [
  {
    key: 'solo',
    label: 'Just me,\none chair',
    title: 'Solo — one chair, everything on it',
    body:
      'You are the front desk, the tech and the bookkeeper. The win here is that booking, the deposit, the consent form and the reminder all happen without you touching your phone.',
    feats: [
      'Public booking page with deposits',
      'Text and email reminders, automatic',
      'Consent forms with e-signature',
      'Checkout with tips and retail',
      'Client history and photos',
    ],
    price: 39,
  },
  {
    key: 'team',
    label: 'A team on\ncommission',
    title: 'A team on commission — one schedule, no collisions',
    body:
      'Five people, one calendar, and a walk-in that has to land on whoever is actually free. Shifts, time off and turn rotation are the difference between a schedule and a guess.',
    feats: [
      'Everything in Solo',
      'Shift roster, time off, timeclock',
      'Fair turn rotation for walk-ins',
      'Commission pay and payroll drafts',
      'Staff portal and per-staff reporting',
    ],
    price: 149,
  },
  {
    key: 'booth',
    label: 'I rent\nchairs out',
    title: 'You rent chairs — that is a second business',
    body:
      'Rent has its own paperwork and a spreadsheet is not it. Signed agreements, card on file, rent charged on schedule, and a portal so renters stop texting you at 9pm.',
    feats: [
      'Renters, agreements and e-signature',
      'Card on file, rent charged on schedule',
      'Late-rent tracking, automatic',
      'Short-term chair stays and studio tours',
      'Renter portal and maintenance log',
    ],
    price: 279,
  },
  {
    key: 'both',
    label: 'Both —\nand it is messy',
    title: 'Both — and this is the one nobody else does',
    body:
      'Half your chairs are employees on commission, half are renters paying you. Every other platform makes you pick one and fake the other in a spreadsheet. Here they share one calendar and one set of books, and the money still adds up.',
    feats: [
      'Everything in Studio and Booths',
      'One calendar, two business models',
      'Commission and rent side by side',
      'Reporting that separates the two',
      'Convert a stylist either direction',
    ],
    price: 279,
  },
];

export function StudioTypeSwitch({ billingLive = false }: { billingLive?: boolean }) {
  const [i, setI] = React.useState(3);
  const s = SEGS[i];

  return (
    <div className="rounded-3xl border bg-card p-4 shadow-xl sm:p-6">
      <p className="mb-3 text-[9px] font-black uppercase tracking-[0.25em] text-muted-foreground">
        Which one are you?
      </p>

      <div role="group" aria-label="Studio type" className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {SEGS.map((seg, j) => (
          <button
            key={seg.key}
            type="button"
            aria-pressed={i === j}
            onClick={() => setI(j)}
            className={cn(
              'min-h-[52px] whitespace-pre-line rounded-2xl border-2 px-2 py-2 text-[10px] font-black uppercase leading-tight tracking-wider transition-colors',
              i === j
                ? 'border-primary bg-primary/10 text-primary'
                : 'border-border bg-background text-muted-foreground hover:border-primary/40 hover:text-foreground',
            )}
          >
            {seg.label}
          </button>
        ))}
      </div>

      {/* aria-live so a screen reader hears the panel change, and keyed so the
          fade replays on every switch rather than only the first one. */}
      <div key={s.key} aria-live="polite" className="cf-fade mt-5 border-t pt-5">
        <h3 className="text-base font-black uppercase tracking-tight text-foreground">{s.title}</h3>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{s.body}</p>

        <ul className="mt-4 space-y-2">
          {s.feats.map(f => (
            <li key={f} className="flex items-start gap-2.5">
              <Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
              <span className="text-xs font-bold leading-snug text-foreground">{f}</span>
            </li>
          ))}
        </ul>

        <p className="mt-5 flex flex-wrap items-baseline gap-x-2 gap-y-1 border-t pt-4">
          <span className="text-3xl font-black tracking-tighter text-foreground">${s.price}</span>
          <span className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">
            / month {billingLive ? '' : 'planned'}
          </span>
          {!billingLive && (
            <span className="text-[10px] font-black uppercase tracking-widest text-primary">
              · free right now
            </span>
          )}
        </p>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. THE AVAILABILITY DEMO
//
// The most valuable thirty seconds on the page. Every competitor can say "smart
// scheduling"; none of them can let you tap a closed time and read the reason.
//
// These are the eight real blocking sources the availability engine checks, in
// the order it checks them. failAt is the index of the first check that fails;
// -1 means all eight cleared and the slot is bookable.
// ─────────────────────────────────────────────────────────────────────────────

const CHECKS = [
  'Studio hours',
  'Published shift roster',
  'Approved time off',
  "The staff member's own week",
  'Existing appointments',
  'Cleanup padding',
  'Station capacity',
  'Equipment out of service',
];

type Slot = {
  t: string;
  failAt: number;
  pro: string;
  head: string;
  why: string;
};

const SLOTS: Slot[] = [
  { t: '9:00',  failAt: 4,  pro: 'Dana',   head: 'Dana is mid-service',        why: 'Dana is twenty minutes into a full set with art. The engine will not offer a time it would have to interrupt.' },
  { t: '9:30',  failAt: 5,  pro: 'Dana',   head: 'Cleanup is not done yet',    why: 'The previous guest ends at 9:25 and this service carries fifteen minutes of cleanup. 9:30 exists on the clock but not in the room.' },
  { t: '10:00', failAt: -1, pro: 'Dana',   head: 'Open — Dana',                why: 'All eight checks clear. Dana is rostered, on shift, free, the station is ready, and there is room before her next guest. A deposit is taken at this point and the slot closes to everyone else instantly.' },
  { t: '11:00', failAt: 3,  pro: 'Priya',  head: 'Priya does not work Tuesdays', why: 'Priya set her own week to Wednesday through Saturday. Studio hours say open; her availability says no, and hers wins.' },
  { t: '12:00', failAt: 2,  pro: 'Dana',   head: 'Approved day off',           why: 'Dana requested the afternoon three weeks ago and you approved it. Approved time off overrides the published roster.' },
  { t: '1:00',  failAt: 6,  pro: 'Any',    head: 'All three stations busy',    why: 'Two techs are free but every pedicure station is occupied. Most booking software counts people. This one also counts chairs.' },
  { t: '2:00',  failAt: 7,  pro: 'Marcus', head: 'Station 2 is out of service', why: 'The lamp at station 2 has an open maintenance ticket. It stops being bookable until the ticket closes — no sticky note required.' },
  { t: '3:00',  failAt: -1, pro: 'Marcus', head: 'Open — Marcus',              why: 'Marcus is rostered, free, and station 3 is clear. If a walk-in arrives instead, turn rotation decides who takes it so it does not always land on the same person.' },
  { t: '4:00',  failAt: 1,  pro: 'Dana',   head: 'Nobody is rostered',         why: 'The studio is open until six but the published roster has no one on the floor at four. An open door is not the same as an available appointment.' },
  { t: '4:30',  failAt: 0,  pro: 'Any',    head: 'Outside studio hours',       why: 'Tuesday closes at 4:30. The first and cheapest check, and the one a shared spreadsheet still manages to get wrong.' },
  { t: '5:00',  failAt: -1, pro: 'Dana',   head: 'Open — Dana',                why: 'Dana picked up the evening shift. Because it is a published shift rather than a note in a group chat, the booking page already knows about it.' },
  { t: '6:00',  failAt: 0,  pro: 'Any',    head: 'Outside studio hours',       why: 'Closed. Shown greyed rather than hidden, because a guest who can see the shape of your day stops asking you to squeeze them in.' },
];

export function AvailabilityDemo() {
  // Starts on the 10:00 open slot: a visitor who never taps anything still sees
  // eight cleared checks and a bookable verdict rather than an empty panel.
  const [sel, setSel] = React.useState(2);
  const [tapped, setTapped] = React.useState(false);
  const s = SLOTS[sel];
  const ok = s.failAt === -1;

  return (
    <div className="grid gap-4 lg:grid-cols-2 lg:gap-6">
      {/* ── the grid of times ─────────────────────────────────────────────── */}
      <div className="rounded-3xl border bg-card p-4 shadow-xl sm:p-5">
        <div className="mb-3 flex items-end justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[9px] font-black uppercase tracking-[0.25em] text-muted-foreground">
              Tuesday · 3 stations
            </p>
            <p className="truncate text-base font-black uppercase tracking-tight text-foreground">
              Gel manicure · 75 min
            </p>
          </div>
          <span className="shrink-0 rounded-full bg-muted px-2.5 py-1 text-[8px] font-black uppercase tracking-widest text-muted-foreground">
            Any pro
          </span>
        </div>

        <div role="group" aria-label="Available times" className="grid grid-cols-3 gap-2 sm:grid-cols-4">
          {SLOTS.map((slot, j) => {
            const open = slot.failAt === -1;
            return (
              <button
                key={slot.t}
                type="button"
                aria-pressed={sel === j}
                onClick={() => { setSel(j); setTapped(true); }}
                className={cn(
                  'min-h-[52px] rounded-2xl border-2 px-1 py-2 text-center transition-colors',
                  open
                    ? 'border-primary/40 bg-primary/5 text-primary hover:border-primary'
                    : 'border-border bg-muted/40 text-muted-foreground hover:border-muted-foreground/40',
                  sel === j && 'ring-2 ring-primary/40 ring-offset-2',
                )}
              >
                <span className="block text-xs font-black tabular-nums leading-none">{slot.t}</span>
                <span className="mt-1 block text-[7px] font-black uppercase tracking-widest">
                  {open ? 'Open' : 'Closed'}
                </span>
              </button>
            );
          })}
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 border-t pt-3">
          <span className="flex items-center gap-1.5 text-[9px] font-black uppercase tracking-widest text-primary">
            <span className="h-2.5 w-2.5 rounded-full border-2 border-primary" aria-hidden="true" /> Bookable
          </span>
          <span className="flex items-center gap-1.5 text-[9px] font-black uppercase tracking-widest text-muted-foreground">
            <span className="h-2.5 w-2.5 rounded-full border-2 border-border bg-muted" aria-hidden="true" /> Closed — tap to see why
          </span>
        </div>

        <p className="mt-3 text-[10px] font-black uppercase leading-relaxed tracking-widest text-primary">
          {tapped
            ? 'Keep tapping — each grey time fails a different check'
            : 'Tap any time, including the grey ones'}
        </p>
      </div>

      {/* ── the verdict ───────────────────────────────────────────────────── */}
      <div
        key={s.t}
        aria-live="polite"
        className="cf-fade rounded-3xl border bg-card p-4 shadow-xl sm:p-5"
      >
        <div className="flex flex-wrap items-center gap-2">
          <span className={cn(
            'rounded-full px-2.5 py-1 text-[8px] font-black uppercase tracking-widest',
            ok ? 'bg-green-500/10 text-green-600' : 'bg-muted text-muted-foreground',
          )}>
            {ok ? 'Bookable' : 'Not bookable'}
          </span>
          <span className="text-[9px] font-black uppercase tracking-widest text-muted-foreground">
            {s.t} · {s.pro}
          </span>
        </div>

        <h3 className="mt-3 text-lg font-black uppercase leading-tight tracking-tight text-foreground">
          {s.head}
        </h3>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{s.why}</p>

        <ol className="mt-4 space-y-1.5">
          {CHECKS.map((c, k) => {
            const failed = !ok && k === s.failAt;
            const skipped = !ok && k > s.failAt;
            return (
              <li
                key={c}
                // Staggered so you watch the checks run rather than see a finished
                // list. The delay is inline because it is per-index; Tailwind has
                // no utility for "the seventh one, 55ms later".
                className="cf-step flex items-center gap-2.5 rounded-xl border bg-background/60 px-3 py-2"
                style={{ animationDelay: `${k * 0.055}s` }}
              >
                <span className={cn(
                  'flex h-5 w-5 shrink-0 items-center justify-center rounded-full',
                  failed && 'bg-destructive/10 text-destructive',
                  skipped && 'bg-muted text-muted-foreground/50',
                  !failed && !skipped && 'bg-green-500/10 text-green-600',
                )}>
                  {failed
                    ? <X className="h-3 w-3" aria-hidden="true" />
                    : <Check className="h-3 w-3" aria-hidden="true" />}
                </span>
                <span className={cn(
                  'text-[11px] font-bold leading-snug',
                  failed && 'text-destructive',
                  skipped && 'text-muted-foreground/50',
                  !failed && !skipped && 'text-foreground',
                )}>
                  {c}
                </span>
                {failed && (
                  <span className="ml-auto shrink-0 text-[8px] font-black uppercase tracking-widest text-destructive">
                    Blocked here
                  </span>
                )}
              </li>
            );
          })}
        </ol>

        <p className="mt-4 border-t pt-3 text-[10px] font-medium leading-relaxed text-muted-foreground">
          {ok
            ? 'Eight checks, every time a guest loads your page — and the same eight run again when they submit, so two people tapping the same slot cannot both get it.'
            : 'Most booking tools check two of these: working hours and existing appointments. The other six are where double-bookings come from.'}
        </p>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. THE LEAK CALCULATOR
//
// Reframes price as a fraction of money already walking out rather than a new
// expense. The assumptions are stated on the page on purpose — a number a salon
// owner can argue with is more persuasive than one she cannot.
// ─────────────────────────────────────────────────────────────────────────────

const money = (n: number) => '$' + Math.round(n).toLocaleString('en-US');

function Slider({
  id, label, value, min, max, step, display, onChange,
}: {
  id: string;
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  display: string;
  onChange: (n: number) => void;
}) {
  return (
    <div className="mb-5">
      <label htmlFor={id} className="mb-1.5 flex items-baseline justify-between gap-3">
        <span className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">{label}</span>
        <span className="text-lg font-black tabular-nums tracking-tight text-primary">{display}</span>
      </label>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={e => onChange(Number(e.target.value))}
        // h-11 keeps the whole control a 44px tap target on a phone. The native
        // thumb is smaller than that but the hit area is what matters.
        className="h-11 w-full cursor-pointer"
        style={{ accentColor: 'hsl(var(--primary))' }}
      />
    </div>
  );
}

export function LeakCalculator({ billingLive = false }: { billingLive?: boolean }) {
  const [chairs, setChairs] = React.useState(6);
  const [rented, setRented] = React.useState(3);
  const [ticket, setTicket] = React.useState(85);
  const [rent, setRent] = React.useState(900);

  const rentedSafe = Math.min(rented, chairs);
  const working = Math.max(1, chairs - rentedSafe);

  // Deliberately conservative, and every assumption is printed under the panel.
  const noShow = working * 25 * ticket * 0.08;   // 25 appts/chair/mo, 8% no-show
  const lateRent = rentedSafe * rent * 0.06;     // 6% of rent lands late or never
  const gap = working * ticket * 2.2;            // ~2 unfilled chair-hours a week
  const admin = 4 * 4.33 * 45;                   // 4 owner-hours a week at $45
  const total = noShow + lateRent + gap + admin;

  const price = rentedSafe > 0 ? 279 : chairs > 1 ? 149 : 39;
  const ratio = Math.max(1, Math.round(total / price));

  const rows: [string, string][] = [
    ['No-shows with no deposit held', money(noShow)],
    ['Rent collected late, or not at all', money(lateRent)],
    ['Empty chair-hours nobody filled', money(gap)],
    ['Your hours on admin, at $45/hr', money(admin)],
  ];

  return (
    <div className="grid gap-4 lg:grid-cols-2 lg:gap-6">
      <div className="rounded-3xl border bg-card p-5 shadow-xl sm:p-6">
        <Slider id="cf-chairs" label="Chairs in your studio" value={chairs} min={1} max={16} step={1}
          display={String(chairs)} onChange={setChairs} />
        <Slider id="cf-rented" label="Of those, chairs you rent out" value={rentedSafe} min={0} max={chairs} step={1}
          display={String(rentedSafe)} onChange={setRented} />
        <Slider id="cf-ticket" label="Average ticket" value={ticket} min={25} max={300} step={5}
          display={money(ticket)} onChange={setTicket} />
        <Slider id="cf-rent" label="Monthly rent per chair" value={rent} min={200} max={2000} step={50}
          display={money(rent)} onChange={setRent} />
        <p className="border-t pt-3 text-[10px] font-medium leading-relaxed text-muted-foreground">
          Assumes an 8% no-show rate, 6% of rent landing late, two unfilled chair-hours a week, and four
          hours a week of owner admin — the middle of what studio owners report. Every number here is an
          estimate you can argue with; that is the point of the sliders.
        </p>
      </div>

      <div className="rounded-3xl border bg-foreground p-5 text-background shadow-xl sm:p-6">
        <p className="text-[9px] font-black uppercase tracking-[0.25em] opacity-60">
          Leaking out of the studio each month
        </p>
        <p aria-live="polite" className="mt-1 text-4xl font-black tracking-tighter tabular-nums sm:text-5xl">
          {money(total)}
        </p>
        <p className="mt-1 text-xs font-bold opacity-60">
          {chairs} {chairs === 1 ? 'chair' : 'chairs'}, {rentedSafe} rented out
        </p>

        <div className="mt-5 space-y-2 border-t border-background/15 pt-4">
          {rows.map(([k, v]) => (
            <div key={k} className="flex items-baseline justify-between gap-3">
              <span className="text-[11px] font-medium leading-snug opacity-70">{k}</span>
              <span className="shrink-0 text-sm font-black tabular-nums">{v}</span>
            </div>
          ))}
          <div className="flex items-baseline justify-between gap-3 border-t border-background/15 pt-3">
            <span className="text-[11px] font-black uppercase tracking-widest">ClarityFlow, this studio</span>
            <span className="shrink-0 text-sm font-black tabular-nums text-primary">
              {money(price)} / mo
            </span>
          </div>
        </div>

        <p className="mt-4 text-[11px] font-medium leading-relaxed opacity-70">
          That is {ratio}× the monthly price of the software meant to stop it
          {billingLive ? '.' : ' — and every plan is free while we are in early access.'}
        </p>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. PRODUCT TOUR
//
// Four screens with plausible numbers. Not screenshots: a screenshot goes stale
// the first time a button moves, and it cannot be read on a 390px phone.
// ─────────────────────────────────────────────────────────────────────────────

type Row = { a: string; b: string; c: string; tone: 'ok' | 'off' | 'p' | 'g' };
type Tab = { tab: string; h: string; p: string; rows: Row[] };

const TOUR: Tab[] = [
  {
    tab: 'Today',
    h: 'The day, at a glance',
    p: 'Who is in, what is next, what still needs a deposit, and which guests have already been reminded.',
    rows: [
      { a: '9:00 · Dana',    b: 'Gel manicure',      c: 'Deposit paid', tone: 'ok' },
      { a: '10:30 · Priya',  b: 'Full set + art',    c: 'Confirmed',    tone: 'ok' },
      { a: '12:00 · —',      b: 'Cleanup + lunch',   c: 'Blocked',      tone: 'off' },
      { a: '1:00 · Marcus',  b: 'Pedicure',          c: 'Reminded',     tone: 'ok' },
      { a: '2:30 · Open',    b: 'Any available',     c: 'Bookable',     tone: 'p' },
    ],
  },
  {
    tab: 'Booth rent',
    h: 'Rent that collects itself',
    p: 'Signed agreement, card on file, charged on its own schedule. Late rent surfaces on its own instead of when you remember to check.',
    rows: [
      { a: 'Station 1 · Renee',  b: 'Signed · card on file', c: 'Paid Jul 1',  tone: 'g' },
      { a: 'Station 2 · Tomás',  b: 'Signed · card on file', c: 'Paid Jul 1',  tone: 'g' },
      { a: 'Station 4 · Jaye',   b: 'Signed · card on file', c: '6 days late', tone: 'off' },
      { a: 'Chair 6 · day guest', b: 'Short stay · 2 days',  c: 'Prepaid',     tone: 'g' },
    ],
  },
  {
    tab: 'Payroll',
    h: 'Commission and rent, side by side',
    p: 'The timeclock, the commission split and the rent ledger produce one draft. Hand it to Gusto instead of rebuilding it on a legal pad.',
    rows: [
      { a: 'Dana',   b: '38.5 hrs · 45% comm', c: '$1,842', tone: 'g' },
      { a: 'Marcus', b: '31.0 hrs · 40% comm', c: '$1,190', tone: 'g' },
      { a: 'Renee',  b: 'Booth renter',        c: 'Rent in', tone: 'p' },
      { a: 'Draft',  b: 'Ready for Gusto',     c: '$3,032', tone: 'ok' },
    ],
  },
  {
    tab: 'Money',
    h: 'One number answers it',
    p: 'Checkout, retail, tips, the bank feed and recurring bills land in the same ledger, so "what did I make" has a single answer.',
    rows: [
      { a: 'Services',  b: '1,284 visits', c: '$96,300', tone: 'g' },
      { a: 'Retail',    b: '212 items',    c: '$7,410',  tone: 'g' },
      { a: 'Booth rent', b: '4 chairs',    c: '$3,550',  tone: 'g' },
      { a: 'Net',       b: 'After bills',  c: '$41,880', tone: 'p' },
    ],
  },
];

export function ProductTour() {
  const [i, setI] = React.useState(0);
  const t = TOUR[i];

  return (
    <div>
      {/* Wraps rather than scrolls. A hidden-scrollbar tab strip on a 390px
          phone leaves the last tab off-screen with nothing to say it is there. */}
      <div role="tablist" aria-label="Product screens" className="mb-4 flex flex-wrap gap-2">
        {TOUR.map((tab, j) => (
          <button
            key={tab.tab}
            type="button"
            role="tab"
            aria-selected={i === j}
            onClick={() => setI(j)}
            className={cn(
              BTN,
              'min-h-[44px] rounded-full border-2 px-4 text-[10px] font-black uppercase tracking-widest',
              i === j
                ? 'border-foreground bg-foreground text-background'
                : 'border-border bg-background text-muted-foreground hover:border-foreground/40 hover:text-foreground',
            )}
          >
            {tab.tab}
          </button>
        ))}
      </div>

      <div key={t.tab} className="cf-fade rounded-3xl border bg-card p-4 shadow-xl sm:p-6">
        <h3 className="text-base font-black uppercase tracking-tight text-foreground">{t.h}</h3>
        <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{t.p}</p>

        <div className="mt-4 space-y-2">
          {t.rows.map((r, k) => (
            <div
              key={r.a}
              className="cf-step flex items-center gap-3 rounded-2xl border bg-background/60 px-3 py-2.5"
              style={{ animationDelay: `${k * 0.06}s` }}
            >
              <div className="min-w-0 flex-1">
                <p className="truncate text-xs font-black uppercase tracking-tight text-foreground">{r.a}</p>
                <p className="truncate text-[11px] font-medium text-muted-foreground">{r.b}</p>
              </div>
              <span className={cn(
                'shrink-0 rounded-full px-2 py-0.5 text-[8px] font-black uppercase tracking-widest',
                r.tone === 'ok'  && 'bg-green-500/10 text-green-600',
                r.tone === 'g'   && 'bg-muted text-muted-foreground',
                r.tone === 'off' && 'bg-destructive/10 text-destructive',
                r.tone === 'p'   && 'bg-primary/10 text-primary',
              )}>
                {r.c}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 5. THE LOUNGE / CONCIERGE WALKTHROUGH
//
// Every claim in here maps to code that exists today:
//   · branded attract screen driven by tenant.kioskSettings (logo + colour)
//   · phone-number member lookup that unlocks members-only items
//   · a priced menu from the inventory collection, filtered to refreshments
//     with stock, honouring showInConcierge and isMembersOnly
//   · delivery routing by seat/table, station, visual description and notes
//   · in-appointment ordering from the guest's own phone via their check-in link,
//     with a per-session complimentary limit and guest self-recall
//   · "charge to my station" as a real off-session Stripe charge against the card
//     on file, with a per-order cap, decline handling, and the revenue and the
//     processing fee both booked automatically
//   · host-funded comp allowances and a per-renter who-pays setting
//
// What this section must never claim, because it is not built:
//   a kitchen/bar display, a prep pipeline (new → making → ready), paying by card
//   at the kiosk itself, a live remaining-perk counter, amenities appearing on the
//   appointment ticket, or automatic stock decrement. See the note in page.tsx.
// ─────────────────────────────────────────────────────────────────────────────

type Stage = {
  key: string;
  tab: string;
  h: string;
  p: string;
  screen: React.ReactNode;
};

const Chip = ({ children }: { children: React.ReactNode }) => (
  <span className="rounded-full bg-muted px-2.5 py-1 text-[9px] font-black uppercase tracking-widest text-muted-foreground">
    {children}
  </span>
);

const MenuRow = ({ name, note, price }: { name: string; note: string; price: string }) => (
  <div className="flex items-center gap-3 rounded-2xl border bg-background/60 px-3 py-2.5">
    <Coffee className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
    <div className="min-w-0 flex-1">
      <p className="truncate text-xs font-black uppercase tracking-tight text-foreground">{name}</p>
      <p className="truncate text-[11px] font-medium text-muted-foreground">{note}</p>
    </div>
    <span className="shrink-0 rounded-full bg-primary/10 px-2 py-0.5 text-[8px] font-black uppercase tracking-widest text-primary">
      {price}
    </span>
  </div>
);

const STAGES: Stage[] = [
  {
    key: 'recognise',
    tab: 'Recognise',
    h: 'She types her mobile number. You already know her.',
    p:
      'The lounge tablet wakes on your logo and your colour, not ours. A guest taps in her number, and if she is a member the menu changes — her included items stop showing a price and members-only items appear at all.',
    screen: (
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <Chip>Your logo</Chip><Chip>Your colour</Chip><Chip>No app to download</Chip>
        </div>
        <div className="rounded-2xl border bg-background/60 px-3 py-3">
          <p className="text-[9px] font-black uppercase tracking-[0.25em] text-muted-foreground">Recognised</p>
          <p className="mt-1 text-sm font-black uppercase tracking-tight text-foreground">Priya S. · Member</p>
          <p className="mt-0.5 text-[11px] font-medium text-muted-foreground">
            Membership includes her drink. Members-only items now visible.
          </p>
        </div>
      </div>
    ),
  },
  {
    key: 'order',
    tab: 'Order',
    h: 'A real menu, priced from your own inventory.',
    p:
      'Items come from the same inventory you already keep, grouped by your categories, with your photos. Something out of stock or hidden from the lounge simply does not appear. Nothing to maintain twice.',
    screen: (
      <div className="space-y-2">
        <MenuRow name="Oat flat white" note="Made at the bar · in her membership" price="Included" />
        <MenuRow name="Sparkling water" note="Comfort & environment" price="Comp" />
        <MenuRow name="Prosecco" note="Club exclusive · members only" price="$12.00" />
        <MenuRow name="Warm neck wrap" note="Comfort & environment" price="Comp" />
      </div>
    ),
  },
  {
    key: 'find',
    tab: 'Find her',
    h: 'Seat, station, and what she is wearing.',
    p:
      'The part every hospitality tool forgets: the order is useless if nobody can find the guest. It carries a table or seat number, the station she is sitting at, a short visual description and any notes, so whoever is free can just walk it over.',
    screen: (
      <div className="space-y-2">
        {[
          { icon: MapPin, k: 'Seat', v: 'Table 3 · Station 2' },
          { icon: Shirt,  k: 'Looks like', v: 'Green sweater, dark curls' },
          { icon: Gift,   k: 'Note', v: 'Allergic to hazelnut — no syrups' },
        ].map(row => (
          <div key={row.k} className="flex items-center gap-3 rounded-2xl border bg-background/60 px-3 py-2.5">
            <row.icon className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
            <span className="w-20 shrink-0 text-[9px] font-black uppercase tracking-widest text-muted-foreground">{row.k}</span>
            <span className="min-w-0 flex-1 truncate text-xs font-bold text-foreground">{row.v}</span>
          </div>
        ))}
      </div>
    ),
  },
  {
    key: 'pay',
    tab: 'Who pays',
    h: 'Four ways it settles, and none of them is a shoebox.',
    p:
      'A comp comes out of the allowance you set. A renter\'s guest can be charged to that renter\'s card. A day guest can opt to put it on her own station. Either way the revenue and the processing fee are both booked the moment it clears — and a declined card stops the order instead of quietly becoming a loss.',
    screen: (
      <div className="space-y-2">
        {[
          { k: 'Complimentary',      v: 'Within the host allowance you set',      tone: 'g' as const },
          { k: 'Charged to Station 4', v: "The renter's card on file",            tone: 'ok' as const },
          { k: 'Charge to my station', v: 'Day guest opted in at the kiosk',      tone: 'p' as const },
          { k: 'Declined',           v: 'Order stops. Nothing dispatched.',       tone: 'off' as const },
        ].map(row => (
          <div key={row.k} className="flex items-center gap-3 rounded-2xl border bg-background/60 px-3 py-2.5">
            <CreditCard className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs font-black uppercase tracking-tight text-foreground">{row.k}</p>
              <p className="truncate text-[11px] font-medium text-muted-foreground">{row.v}</p>
            </div>
            <span className={cn(
              'shrink-0 rounded-full px-2 py-0.5 text-[8px] font-black uppercase tracking-widest',
              row.tone === 'ok'  && 'bg-green-500/10 text-green-600',
              row.tone === 'g'   && 'bg-muted text-muted-foreground',
              row.tone === 'off' && 'bg-destructive/10 text-destructive',
              row.tone === 'p'   && 'bg-primary/10 text-primary',
            )}>
              {row.tone === 'off' ? 'Blocked' : 'Booked'}
            </span>
          </div>
        ))}
      </div>
    ),
  },
];

export function LoungeWalkthrough() {
  const [i, setI] = React.useState(0);
  const s = STAGES[i];

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:gap-6">
      <div>
        <div role="tablist" aria-label="Lounge steps" className="mb-4 flex flex-wrap gap-2">
          {STAGES.map((st, j) => (
            <button
              key={st.key}
              type="button"
              role="tab"
              aria-selected={i === j}
              onClick={() => setI(j)}
              className={cn(
                BTN,
                'min-h-[44px] rounded-full border-2 px-4 text-[10px] font-black uppercase tracking-widest',
                i === j
                  ? 'border-primary bg-primary/10 text-primary'
                  : 'border-border bg-background text-muted-foreground hover:border-primary/40 hover:text-foreground',
              )}
            >
              {j + 1}. {st.tab}
            </button>
          ))}
        </div>

        <div key={s.key} aria-live="polite" className="cf-fade">
          <h3 className="text-xl font-black uppercase leading-tight tracking-tight text-foreground sm:text-2xl">
            {s.h}
          </h3>
          <p className="mt-3 text-sm leading-relaxed text-muted-foreground sm:text-base">{s.p}</p>

          <button
            type="button"
            onClick={() => setI((i + 1) % STAGES.length)}
            className={cn(
              BTN,
              'mt-5 min-h-[48px] rounded-2xl border-2 border-border bg-background px-5 text-[10px] font-black uppercase tracking-widest text-foreground hover:bg-muted',
            )}
          >
            Next step
            <ChevronRight className="ml-1.5 h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      </div>

      {/* The tablet. aspect-free and height-capped so it never blows out a phone. */}
      <div key={s.key + '-screen'} className="cf-fade rounded-3xl border bg-card p-4 shadow-xl sm:p-5">
        <div className="mb-3 flex items-center justify-between gap-3 border-b pb-3">
          <div className="flex min-w-0 items-center gap-2">
            <span className="h-6 w-6 shrink-0 rounded-full border-[3px] border-primary" aria-hidden="true" />
            <span className="truncate text-xs font-black uppercase tracking-tight text-foreground">
              Lounge concierge
            </span>
          </div>
          <span className="shrink-0 rounded-full bg-primary/10 px-2.5 py-1 text-[8px] font-black uppercase tracking-widest text-primary">
            Step {i + 1} of {STAGES.length}
          </span>
        </div>
        {s.screen}
      </div>
    </div>
  );
}
