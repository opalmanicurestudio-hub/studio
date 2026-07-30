'use client';

/* ═══════════════════════════════════════════════════════════════════════════
 * THE LOBBY QUEUE DISPLAY
 * repo path: src/app/lobby/[tenantId]/page.tsx
 *
 * The wall screen in the waiting area. It answers the three questions every
 * waiting guest is actually asking — "am I still on the list", "how many
 * people are ahead of me", and "is it my turn yet" — without anyone having to
 * ask the front desk.
 *
 * WHY THIS SCREEN EARNS ITS KEEP RIGHT NOW
 * Walk-in guests currently get no notification when their chair is ready; SMS
 * is blocked behind A2P 10DLC approval. A guest whose row has been marked
 * notified or arrived gets their name shown here in green, large, at the top,
 * with "You're up". So until texting is live, this screen IS the call-forward.
 *
 * WHAT IT READS
 * Exactly one endpoint, GET /api/walkins?tenantId=…&view=board, which is
 * deliberately built to be safe on a public screen: first names only, and no
 * phone, no email, no note, and never internalNotes. Nothing on this page
 * touches Firestore, so no sign-in is needed and no security rule stands in
 * the way — an old iPad in the corner can just sit on this URL forever.
 *
 * PROVIDER PHOTOS
 * The board payload now carries providerAvatar on each queue and in-service
 * row, and avatarUrl on each floor row. These are STAFF headshots, which are
 * already public on the booking page — putting a face next to "Maya is ready
 * for you" is the difference between a name a guest has to decode and a person
 * they can spot across the room. GUESTS still get a first name only and never
 * a photo. If a staff member has no photo we draw their initial, never a
 * broken image icon.
 *
 * LIGHT AND DARK
 * Dark is still the default, because most of these screens run twelve hours a
 * day in a room with a window and dark is easier on the eye from across a
 * lobby. Light exists for the studios where the wall is white and the room is
 * bright, and it sticks: the choice is remembered on that device, so an iPad
 * left on this URL comes back the way it was left. You can also force it from
 * the URL — add ?theme=light or ?theme=dark — which is the reliable way to set
 * a screen you cannot easily reach to tap.
 *
 * DESIGN NOTES
 *  - Nothing counts down. A countdown that slips turns a patient guest into an
 *    angry one; every wait here is a soft, rounded "about 25 minutes".
 *  - A long line rotates in pages so that guest #14 still sees their own name.
 *  - Readable from a phone too, because Jessica will check it from behind the
 *    desk on hers.
 * ═══════════════════════════════════════════════════════════════════════════ */

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useParams } from 'next/navigation';
import { cn } from '@/lib/utils';
import {
  Users, Scissors, Star, Hourglass,
  Coffee, Wifi, AlertTriangle, CheckCircle2, BellRing, User,
  Moon, SunDim,
} from 'lucide-react';

/* ── shapes, matching the board payload exactly ─────────────────────────── */

type QueueRow = {
  position?: number;
  firstName?: string;
  serviceName?: string;
  providerFirstName?: string;
  providerAvatar?: string;
  requested?: boolean;
  notified?: boolean;
  waitedMin?: number;
  /* This guest's own wait. The board-level estWaitMin passes the whole queue as
   * "ahead of you", making it the wait for somebody who has not walked in yet —
   * wrong for every person actually standing in the room, and most wrong for
   * the one at the front of it. */
  estWaitMin?: number;
  /* A party arrives as one row carrying its size, rather than as four rows
   * eating four of the six slots the board pages through. */
  partySize?: number;
};

type ServiceRow = {
  firstName?: string;
  serviceName?: string;
  providerFirstName?: string;
  providerAvatar?: string;
  startedMinutesAgo?: number | null;
};

type FloorRow = {
  firstName?: string;
  avatarUrl?: string;
  accepting?: boolean;
  busy?: boolean;
};

type Board = {
  ok?: boolean;
  enabled?: boolean;
  studioName?: string;
  queueLength?: number;
  inServiceCount?: number;
  estWaitMin?: number;
  acceptingCount?: number;
  /* freeNowCount excludes anyone deactivated under EITHER spelling of the staff
   * flag, on a break, or mid-service. acceptingCount was none of those things —
   * it counted the whole roster — which is why "Free now" was the least true
   * claim on a screen the entire waiting room can read. */
  freeNowCount?: number;
  rosteredCount?: number;
  generatedAt?: string;
  queue?: QueueRow[];
  inService?: ServiceRow[];
  floor?: FloorRow[];
};

/* ── timings ───────────────────────────────────────────────────────────────
 * 12s polling is often enough that the room believes it is live, and light
 * enough that a screen left on all day is a rounding error on the bill. */
/* 5s, not 12s. Until texting clears A2P 10DLC this screen IS the call-forward,
 * and a guest whose chair is ready was waiting up to twelve seconds to find out
 * on the only channel telling her. The rest of the board would be fine at 12s;
 * the one banner that matters would not. Still a rounding error on the bill. */
const POLL_MS = 5 * 1000;
const CLOCK_MS = 20 * 1000;
const ROTATE_MS = 9 * 1000;
const PAGE_SIZE = 6;
/* After this long with no successful poll we stop pretending the numbers are
 * current. A wall screen quietly showing a frozen queue is worse than one
 * admitting it lost the wifi. */
const STALE_MS = 70 * 1000;

/* ── theme ─────────────────────────────────────────────────────────────────
 * Every colour on this page comes out of this one object. That is on purpose:
 * a wall display where half the panels forgot to switch looks broken, and the
 * only way to be sure they all switch together is to give them one source.
 * Add a colour here, not inline.                                            */

type Theme = 'dark' | 'light';

type Tokens = {
  shell: string;
  panel: string;
  panelSoft: string;
  rowPanel: string;
  chipPanel: string;
  heading: string;
  strong: string;
  muted: string;
  faint: string;
  dot: string;
  dotOn: string;
  toggle: string;
  calledWrap: string;
  calledCard: string;
  calledLabel: string;
  calledLead: string;
  calledSub: string;
  emptyIcon: string;
  offIcon: string;
  avatarFallback: string;
  floorOff: string;
  floorBusy: string;
  floorFree: string;
  floorDotOff: string;
  floorDotBusy: string;
  floorDotFree: string;
  invite: string;
};

const THEMES: Record<Theme, Tokens> = {
  dark: {
    shell: 'bg-slate-950 text-white',
    panel: 'border-slate-800 bg-slate-900/60',
    panelSoft: 'border-slate-800 bg-gradient-to-br from-slate-900 to-slate-900/40',
    rowPanel: 'bg-slate-800/60 border-slate-700/60',
    chipPanel: 'bg-slate-900 border-slate-700',
    heading: 'text-slate-400',
    strong: 'text-white',
    muted: 'text-slate-400',
    faint: 'text-slate-500',
    dot: 'bg-slate-700',
    dotOn: 'bg-slate-300',
    toggle: 'border-slate-700 bg-slate-900/70 text-slate-300 hover:bg-slate-800',
    calledWrap: 'border-emerald-400/70 bg-emerald-500/10',
    calledCard: 'bg-emerald-500/15 border-emerald-400/40',
    calledLabel: 'text-emerald-300',
    calledLead: 'text-emerald-200',
    calledSub: 'text-emerald-300/70',
    emptyIcon: 'bg-slate-800',
    offIcon: 'bg-slate-800',
    avatarFallback: 'bg-slate-800 text-slate-300 border-slate-700',
    floorOff: 'border-slate-700 bg-slate-800/40 text-slate-500',
    floorBusy: 'border-amber-400/30 bg-amber-400/10 text-amber-200',
    floorFree: 'border-emerald-400/30 bg-emerald-400/10 text-emerald-200',
    floorDotOff: 'bg-slate-600',
    floorDotBusy: 'bg-amber-300',
    floorDotFree: 'bg-emerald-300',
    invite: 'text-white',
  },
  light: {
    // Not pure white. A wall-sized sheet of #fff at full brightness is
    // genuinely unpleasant to sit under for an hour, so the shell is a warm
    // off-white and the panels sit slightly brighter than it.
    shell: 'bg-slate-50 text-slate-900',
    panel: 'border-slate-200 bg-white',
    panelSoft: 'border-slate-200 bg-gradient-to-br from-white to-slate-50',
    rowPanel: 'bg-slate-50 border-slate-200',
    chipPanel: 'bg-white border-slate-200',
    heading: 'text-slate-500',
    strong: 'text-slate-900',
    muted: 'text-slate-500',
    faint: 'text-slate-400',
    dot: 'bg-slate-300',
    dotOn: 'bg-slate-700',
    toggle: 'border-slate-200 bg-white text-slate-500 hover:bg-slate-100',
    calledWrap: 'border-emerald-500 bg-emerald-50',
    calledCard: 'bg-white border-emerald-300',
    calledLabel: 'text-emerald-700',
    calledLead: 'text-emerald-700',
    calledSub: 'text-emerald-600',
    emptyIcon: 'bg-slate-100',
    offIcon: 'bg-slate-100',
    avatarFallback: 'bg-slate-100 text-slate-500 border-slate-200',
    floorOff: 'border-slate-200 bg-slate-100 text-slate-400',
    floorBusy: 'border-amber-300 bg-amber-50 text-amber-700',
    floorFree: 'border-emerald-300 bg-emerald-50 text-emerald-700',
    floorDotOff: 'bg-slate-400',
    floorDotBusy: 'bg-amber-500',
    floorDotFree: 'bg-emerald-500',
    invite: 'text-slate-900',
  },
};

const THEME_KEY = 'clarityflow.lobbyTheme';

/* ── helpers ───────────────────────────────────────────────────────────── */

// Never a countdown. Rounded to the nearest five so nobody stands there
// watching a number tick, and floored to a friendly phrase under five.
const softWait = (mins: any): string => {
  const n = Number(mins);
  if (!Number.isFinite(n) || n <= 0) return 'No wait';
  if (n < 5) return 'A few minutes';
  return `About ${Math.round(n / 5) * 5} minutes`;
};

const waitedLabel = (mins: any): string => {
  const n = Number(mins);
  if (!Number.isFinite(n) || n <= 0) return 'just joined';
  if (n < 5) return 'just joined';
  return `waiting ${Math.round(n / 5) * 5} min`;
};

const clockLabel = (d: Date): string => {
  try {
    return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  } catch {
    return '';
  }
};

const initialOf = (name: any): string => {
  const s = String(name || '').trim();
  return s ? s.charAt(0).toUpperCase() : '?';
};

// A position is only ever a counting number. A row that somehow arrives with 0
// or a negative would otherwise print "-4" on the wall in 24pt type.
const positionLabel = (position: any, firstName: any): string => {
  const n = Number(position);
  if (Number.isFinite(n) && n > 0) return String(Math.round(n));
  return initialOf(firstName);
};

// Only ever render an http(s) image. A staff record edited by hand could hold
// a data: or javascript: value, and this page is public and unauthenticated —
// it is not the place to trust a string we did not write.
const safePhoto = (url: any): string => {
  const s = String(url || '').trim();
  if (!s) return '';
  if (!/^https?:\/\//i.test(s)) return '';
  return s.length > 500 ? '' : s;
};

const chunk = <T,>(list: T[], size: number): T[][] => {
  if (!list.length) return [[]];
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
};

/* ══════════════════════════════════════════════════════════════════════════ */

export default function LobbyBoardPage() {
  const params = useParams();
  const tenantId = String((params as any)?.tenantId || '');

  const [board, setBoard] = useState<Board | null>(null);
  const [loading, setLoading] = useState(true);
  const [fatal, setFatal] = useState('');
  const [lastOkAt, setLastOkAt] = useState<number>(0);
  const [now, setNow] = useState<Date | null>(null);
  const [pageIdx, setPageIdx] = useState(0);
  const mounted = useRef(true);

  // Dark on the first paint, always. Reading the saved choice during render
  // would make the server-rendered HTML disagree with the browser and React
  // would throw a hydration error onto a screen hanging on a wall.
  const [theme, setTheme] = useState<Theme>('dark');
  const t = THEMES[theme];

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  // The saved / forced theme, applied after mount. ?theme= wins over the saved
  // value and is written back, so pointing an unreachable screen at
  // /lobby/xxx?theme=light sets it once and for good.
  useEffect(() => {
    try {
      const forced = new URLSearchParams(window.location.search).get('theme');
      if (forced === 'light' || forced === 'dark') {
        setTheme(forced);
        window.localStorage.setItem(THEME_KEY, forced);
        return;
      }
      const saved = window.localStorage.getItem(THEME_KEY);
      if (saved === 'light' || saved === 'dark') setTheme(saved);
    } catch {
      // Private browsing, or storage disabled on a locked-down iPad. Dark is a
      // perfectly good answer; never let this take the board down.
    }
  }, []);

  const toggleTheme = useCallback(() => {
    setTheme(prev => {
      const next: Theme = prev === 'dark' ? 'light' : 'dark';
      try { window.localStorage.setItem(THEME_KEY, next); } catch { /* ignore */ }
      return next;
    });
  }, []);

  /* ── the single fetch ──────────────────────────────────────────────────── */
  const load = useCallback(async () => {
    if (!tenantId) return;
    try {
      const res = await fetch(
        `/api/walkins?tenantId=${encodeURIComponent(tenantId)}&view=board`,
        { cache: 'no-store' },
      );
      const d = await res.json().catch(() => null);
      if (!mounted.current) return;
      if (!d || d.ok !== true) {
        // A 404 studio is the one error worth stating outright; everything else
        // is treated as a blip and the last good numbers stay on screen.
        if (res.status === 404) setFatal('This studio could not be found.');
        setLoading(false);
        return;
      }
      setFatal('');
      setBoard(d as Board);
      setLastOkAt(Date.now());
      setLoading(false);
    } catch {
      if (mounted.current) setLoading(false);
    }
  }, [tenantId]);

  useEffect(() => {
    void load();
    const id = setInterval(() => { void load(); }, POLL_MS);
    return () => clearInterval(id);
  }, [load]);

  // The clock is set on the client only, so the server and the browser never
  // disagree about the time on first paint.
  useEffect(() => {
    setNow(new Date());
    const id = setInterval(() => setNow(new Date()), CLOCK_MS);
    return () => clearInterval(id);
  }, []);

  const queue: QueueRow[] = Array.isArray(board?.queue) ? board!.queue! : [];
  const inService: ServiceRow[] = Array.isArray(board?.inService) ? board!.inService! : [];
  const floor: FloorRow[] = Array.isArray(board?.floor) ? board!.floor! : [];

  // Anyone who has been called forward jumps out of the list and onto the top
  // of the screen. This is the closest thing to a text message she has today.
  const called = useMemo(() => queue.filter(q => q.notified === true), [queue]);
  const waiting = useMemo(() => queue.filter(q => q.notified !== true), [queue]);

  const pages = useMemo(() => chunk(waiting, PAGE_SIZE), [waiting]);

  // Rotate a long line so the person at #14 eventually sees themselves. One
  // page means no rotation at all — a flicker on a two-name list looks broken.
  useEffect(() => {
    if (pages.length <= 1) { setPageIdx(0); return; }
    const id = setInterval(() => setPageIdx(i => (i + 1) % pages.length), ROTATE_MS);
    return () => clearInterval(id);
  }, [pages.length]);

  useEffect(() => {
    if (pageIdx >= pages.length) setPageIdx(0);
  }, [pageIdx, pages.length]);

  const shown = pages[Math.min(pageIdx, pages.length - 1)] || [];
  const stale = lastOkAt > 0 && Date.now() - lastOkAt > STALE_MS;
  const studioName = String(board?.studioName || '').trim();

  /* ── the states before there is a board to draw ───────────────────────── */

  if (fatal) {
    return (
      <Shell t={t}>
        <div className="flex-1 flex flex-col items-center justify-center text-center px-6 gap-4">
          <AlertTriangle className="w-10 h-10 text-amber-400" />
          <p className="text-xl sm:text-2xl font-semibold">{fatal}</p>
          <p className={cn('text-sm', t.muted)}>Check the link on this screen.</p>
        </div>
      </Shell>
    );
  }

  if (loading && !board) {
    return (
      <Shell t={t}>
        <div className="flex-1 flex flex-col items-center justify-center gap-4">
          <Hourglass className={cn('w-9 h-9 animate-pulse', t.faint)} />
          <p className={cn('text-sm tracking-wide uppercase', t.muted)}>Loading the line</p>
        </div>
      </Shell>
    );
  }

  if (board && board.enabled !== true) {
    return (
      <Shell t={t}>
        <Header
          t={t}
          studioName={studioName}
          now={now}
          stale={stale}
          subtitle="Walk-ins are closed right now"
          theme={theme}
          onToggleTheme={toggleTheme}
        />
        <div className="flex-1 flex flex-col items-center justify-center text-center px-6 gap-5">
          <div className={cn('w-20 h-20 rounded-3xl flex items-center justify-center', t.offIcon)}>
            <Coffee className={cn('w-9 h-9', t.muted)} />
          </div>
          <p className="text-2xl sm:text-4xl font-semibold">We are by appointment today</p>
          <p className={cn('text-base sm:text-lg max-w-md', t.muted)}>
            Come see us at the front desk and we will find you a time.
          </p>
        </div>
      </Shell>
    );
  }

  /* ── the board ─────────────────────────────────────────────────────────── */

  return (
    <Shell t={t}>
      <Header
        t={t}
        studioName={studioName}
        now={now}
        stale={stale}
        subtitle={
          queue.length === 0
            ? 'No wait — walk right in'
            : `${queue.length} ${queue.length === 1 ? 'guest' : 'guests'} in line`
        }
        theme={theme}
        onToggleTheme={toggleTheme}
      />

      {/* ── CALLED FORWARD ── the loudest thing on the screen, deliberately ── */}
      {called.length > 0 && (
        <div className="px-4 sm:px-6 pt-4">
          <div className={cn('rounded-3xl border-2 p-4 sm:p-6', t.calledWrap)}>
            <p className={cn('flex items-center gap-2 text-[11px] sm:text-xs font-semibold uppercase tracking-[0.22em]', t.calledLabel)}>
              <BellRing className="w-4 h-4" /> Ready for you now
            </p>
            <div className="mt-3 flex flex-wrap gap-3">
              {called.slice(0, 4).map((q, i) => (
                <div
                  key={`called-${i}`}
                  className={cn('flex-1 min-w-[13rem] rounded-2xl border px-4 py-4', t.calledCard)}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    {/* The provider's face, big, next to the guest's name. This
                        is the single most useful place on the board for a photo:
                        the guest is standing up and looking for a person. */}
                    <Avatar
                      t={t}
                      url={q.providerAvatar}
                      name={q.providerFirstName}
                      className="w-12 h-12 sm:w-16 sm:h-16 shrink-0"
                    />
                    <p className={cn('min-w-0 text-3xl sm:text-5xl font-bold leading-tight break-words', t.strong)}>
                      {q.firstName || 'Guest'}
                    </p>
                  </div>
                  <p className={cn('mt-2 text-sm sm:text-lg', t.calledLead)}>
                    {q.providerFirstName
                      ? `${q.providerFirstName} is ready for you`
                      : 'Your provider is ready for you'}
                  </p>
                  {q.serviceName ? (
                    <p className={cn('mt-0.5 text-xs sm:text-sm', t.calledSub)}>{q.serviceName}</p>
                  ) : null}
                </div>
              ))}
            </div>
            <p className={cn('mt-3 text-xs sm:text-sm', t.calledLead)}>
              Please come to the front — we have your chair.
            </p>
          </div>
        </div>
      )}

      {/* ── THE THREE NUMBERS ─────────────────────────────────────────────── */}
      <div className="px-4 sm:px-6 pt-4 grid grid-cols-2 gap-3">
        <Stat
          t={t}
          label="In line"
          value={String(queue.length)}
          note={queue.length === 1 ? 'guest' : 'guests'}
          icon={<Users className="w-4 h-4" />}
        />
        <Stat
          t={t}
          label="Now serving"
          value={String(Number(board?.inServiceCount) || 0)}
          note={Number(board?.inServiceCount) === 1 ? 'guest' : 'guests'}
          icon={<Scissors className="w-4 h-4" />}
        />
      </div>

      <div className="flex-1 px-4 sm:px-6 py-4 grid gap-4 lg:grid-cols-[1.35fr_1fr] items-start">

        {/* ── UP NEXT ───────────────────────────────────────────────────────
            min-w-0 on a grid child is not optional: a grid track defaults to
            min-width:auto, so without it one long service name makes the whole
            board scroll sideways on a phone. */}
        <section className={cn('min-w-0 rounded-3xl border p-4 sm:p-5', t.panel)}>
          <div className="flex items-center justify-between gap-3">
            <h2 className={cn('flex items-center gap-2 text-[11px] sm:text-xs font-semibold uppercase tracking-[0.22em]', t.heading)}>
              <Hourglass className="w-4 h-4" /> Up next
            </h2>
            {pages.length > 1 && (
              <div className="flex items-center gap-1.5" aria-hidden="true">
                {pages.map((_, i) => (
                  <span
                    key={`dot-${i}`}
                    className={cn(
                      'w-1.5 h-1.5 rounded-full transition-colors',
                      i === pageIdx ? t.dotOn : t.dot,
                    )}
                  />
                ))}
              </div>
            )}
          </div>

          {waiting.length === 0 ? (
            <div className="py-10 sm:py-14 text-center">
              <div className={cn('w-16 h-16 mx-auto rounded-3xl flex items-center justify-center', t.emptyIcon)}>
                <CheckCircle2 className="w-8 h-8 text-emerald-500" />
              </div>
              <p className="mt-4 text-2xl sm:text-3xl font-semibold">Nobody is waiting</p>
              <p className={cn('mt-1 text-sm sm:text-base', t.muted)}>
                Walk right in — we can take you now.
              </p>
            </div>
          ) : (
            <ul className="mt-3 space-y-2.5">
              {shown.map((q, i) => (
                <li
                  key={`q-${q.position ?? i}-${i}`}
                  className={cn('flex items-center gap-3 sm:gap-4 min-w-0 rounded-2xl border px-3 sm:px-4 py-3', t.rowPanel)}
                >
                  <div className={cn('w-11 h-11 sm:w-14 sm:h-14 shrink-0 rounded-2xl border flex items-center justify-center', t.chipPanel)}>
                    <span className={cn('text-lg sm:text-2xl font-bold', t.strong)}>
                      {positionLabel(q.position, q.firstName)}
                    </span>
                  </div>
                  {/* min-w-0 all the way down, and the truncate on a SPAN rather
                      than on the flex row — a flex container cannot truncate
                      itself, which is how a long name pushed the whole board
                      sideways on a phone. */}
                  <div className="min-w-0 flex-1">
                    <p className={cn('flex items-center gap-2 min-w-0 text-xl sm:text-3xl font-semibold', t.strong)}>
                      <span className="truncate min-w-0">
                        {q.firstName || 'Guest'}
                        {Number(q.partySize) > 1 ? ` +${Number(q.partySize) - 1}` : ''}
                      </span>
                      {q.requested === true && (
                        <Star className="w-4 h-4 sm:w-5 sm:h-5 shrink-0 text-amber-400" />
                      )}
                    </p>
                    <p className={cn('mt-0.5 flex items-center gap-1.5 min-w-0 text-xs sm:text-base', t.muted)}>
                      {/* Small here on purpose. On a queue row the guest's own
                          name is the thing they are scanning for; the provider
                          photo is a hint, not the headline. */}
                      {q.providerFirstName ? (
                        <Avatar
                          t={t}
                          url={q.providerAvatar}
                          name={q.providerFirstName}
                          className="w-5 h-5 sm:w-6 sm:h-6 shrink-0 text-[10px] sm:text-xs"
                        />
                      ) : null}
                      <span className="truncate min-w-0">
                        {[q.serviceName, q.providerFirstName ? `with ${q.providerFirstName}` : '']
                          .filter(Boolean)
                          .join(' · ')}
                      </span>
                    </p>
                  </div>
                  {/* The narrowest phone gives this up rather than squeeze the
                      name, which is the thing the guest is looking for. */}
                  <p className={cn('hidden sm:block shrink-0 text-sm sm:text-base text-right whitespace-nowrap', t.faint)}>
                    {q.estWaitMin === undefined || q.estWaitMin === null
                      ? waitedLabel(q.waitedMin)
                      : softWait(q.estWaitMin)}
                  </p>
                </li>
              ))}
            </ul>
          )}

          {waiting.length > PAGE_SIZE && (
            <p className={cn('mt-3 text-center text-[11px] sm:text-xs', t.faint)}>
              Showing {shown.length} of {waiting.length} — the list rotates
            </p>
          )}
        </section>

        {/* ── RIGHT COLUMN: who is in the chair, and who is on the floor ──── */}
        <div className="min-w-0 space-y-4">

          <section className={cn('min-w-0 rounded-3xl border p-4 sm:p-5', t.panel)}>
            <h2 className={cn('flex items-center gap-2 text-[11px] sm:text-xs font-semibold uppercase tracking-[0.22em]', t.heading)}>
              <Scissors className="w-4 h-4" /> In the chair
            </h2>
            {inService.length === 0 ? (
              <p className={cn('mt-3 text-sm', t.faint)}>Nobody in service right now.</p>
            ) : (
              <ul className="mt-3 space-y-2.5">
                {inService.slice(0, 8).map((s, i) => (
                  <li key={`s-${i}`} className="flex items-center gap-2.5 min-w-0">
                    <Avatar
                      t={t}
                      url={s.providerAvatar}
                      name={s.providerFirstName}
                      className="w-7 h-7 sm:w-9 sm:h-9 shrink-0 text-xs sm:text-sm"
                    />
                    <span className={cn('min-w-0 flex-1 text-base sm:text-xl font-medium truncate', t.strong)}>
                      {s.firstName || 'Guest'}
                    </span>
                    <span className={cn('shrink-0 text-xs sm:text-sm truncate', t.muted)}>
                      {s.providerFirstName
                        ? `with ${s.providerFirstName}${s.startedMinutesAgo != null ? ` · ${s.startedMinutesAgo}m` : ''}`
                        : s.serviceName || ''}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className={cn('min-w-0 rounded-3xl border p-4 sm:p-5', t.panel)}>
            <h2 className={cn('flex items-center gap-2 text-[11px] sm:text-xs font-semibold uppercase tracking-[0.22em]', t.heading)}>
              <User className="w-4 h-4" /> On the floor today
            </h2>
            {floor.length === 0 ? (
              <p className={cn('mt-3 text-sm', t.faint)}>The team list is not up yet.</p>
            ) : (
              <div className="mt-3 flex flex-wrap gap-2">
                {floor.map((f, i) => (
                  <span
                    key={`f-${i}`}
                    className={cn(
                      'inline-flex items-center gap-1.5 rounded-full pl-1 pr-3 py-1 text-xs sm:text-sm border',
                      f.accepting === false
                        ? t.floorOff
                        : f.busy
                          ? t.floorBusy
                          : t.floorFree,
                    )}
                  >
                    {/* The chip carries the face and the status dot both. The dot
                        is what a guest reads at a glance; the face is what makes
                        the team feel present in the room rather than a list. */}
                    <Avatar
                      t={t}
                      url={f.avatarUrl}
                      name={f.firstName}
                      className="w-6 h-6 sm:w-7 sm:h-7 shrink-0 text-[10px] sm:text-xs"
                    />
                    <span
                      className={cn(
                        'w-1.5 h-1.5 rounded-full shrink-0',
                        f.accepting === false
                          ? t.floorDotOff
                          : f.busy
                            ? t.floorDotBusy
                            : t.floorDotFree,
                      )}
                    />
                    {f.firstName || 'Team'}
                    <span className="text-[10px] sm:text-xs opacity-70">
                      {f.accepting === false ? 'booked only' : f.busy ? 'busy' : 'free'}
                    </span>
                  </span>
                ))}
              </div>
            )}
          </section>

          {/* The wait as an invitation rather than dead time. */}
          <section className={cn('min-w-0 rounded-3xl border p-4 sm:p-5', t.panelSoft)}>
            <p className={cn('flex items-center gap-2 text-[11px] sm:text-xs font-semibold uppercase tracking-[0.22em]', t.heading)}>
              <Coffee className="w-4 h-4" /> While you wait
            </p>
            <p className={cn('mt-2 text-base sm:text-xl font-medium leading-snug', t.invite)}>
              Scan the code on your ticket for a drink, and to follow your visit.
            </p>
            <p className={cn('mt-1 text-xs sm:text-sm', t.muted)}>
              Ask us about anything you would like added on today.
            </p>
          </section>
        </div>
      </div>

      {/* ── FOOTER ────────────────────────────────────────────────────────── */}
      <div className="px-4 sm:px-6 pb-4">
        <div className={cn('flex items-center justify-between gap-3 text-[11px] sm:text-xs', t.faint)}>
          <span>{studioName ? `${studioName} · walk-in queue` : 'Walk-in queue'}</span>
          <span className="flex items-center gap-1.5">
            {stale ? (
              <>
                <Wifi className="w-3.5 h-3.5 text-amber-500" />
                <span className="text-amber-500">Reconnecting</span>
              </>
            ) : (
              <>
                <Wifi className="w-3.5 h-3.5 text-emerald-500" />
                <span>Live</span>
              </>
            )}
          </span>
        </div>
      </div>
    </Shell>
  );
}

/* ── chrome ────────────────────────────────────────────────────────────── */

function Shell({ t, children }: { t: Tokens; children: React.ReactNode }) {
  return (
    <div className={cn('min-h-dvh flex flex-col antialiased transition-colors duration-300', t.shell)}>
      {children}
    </div>
  );
}

/**
 * A staff headshot, or their initial. Never a broken image.
 *
 * There is no next/image here on purpose: this page is public, avatar URLs
 * point at Firebase Storage, and next/image would need every one of those
 * hostnames whitelisted in next.config before it would render at all. A plain
 * img with a failure fallback is the version that cannot break a wall display.
 */
function Avatar({
  t,
  url,
  name,
  className,
}: {
  t: Tokens;
  url?: string;
  name?: string;
  className?: string;
}) {
  const src = safePhoto(url);
  const [broken, setBroken] = useState(false);

  // A guest whose provider changes mid-shift gets a new src; clear the old
  // failure or the new photo never gets a chance to load.
  useEffect(() => { setBroken(false); }, [src]);

  const showPhoto = Boolean(src) && !broken;

  return (
    <span
      className={cn(
        'inline-flex items-center justify-center overflow-hidden rounded-full border font-semibold',
        t.avatarFallback,
        className,
      )}
      aria-hidden="true"
    >
      {showPhoto ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src}
          alt=""
          className="w-full h-full object-cover"
          loading="lazy"
          onError={() => setBroken(true)}
        />
      ) : (
        // The letter is a bare text child on purpose. An extra wrapper <span>
        // here is invisible but not harmless: it makes every avatar look like
        // a page-indicator dot to anything counting spans inside an
        // aria-hidden box, which is exactly how the rotation dots are drawn.
        initialOf(name)
      )}
    </span>
  );
}

function Header({
  t,
  studioName,
  subtitle,
  now,
  stale,
  theme,
  onToggleTheme,
}: {
  t: Tokens;
  studioName: string;
  subtitle: string;
  now: Date | null;
  stale: boolean;
  theme: Theme;
  onToggleTheme: () => void;
}) {
  return (
    <header className="px-4 sm:px-6 pt-5 pb-1">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          {studioName ? (
            <p className={cn('text-[10px] sm:text-xs uppercase tracking-[0.3em] truncate', t.faint)}>
              {studioName}
            </p>
          ) : null}
          <h1 className="mt-1 text-2xl sm:text-4xl lg:text-5xl font-bold leading-tight">
            {subtitle}
          </h1>
        </div>
        <div className="shrink-0 flex items-start gap-2 sm:gap-3">
          <div className="text-right">
            <p className="text-xl sm:text-3xl font-semibold tabular-nums">
              {now ? clockLabel(now) : ''}
            </p>
            {stale ? (
              <p className="text-[10px] sm:text-xs text-amber-500 mt-0.5">not live</p>
            ) : null}
          </div>
          {/* Deliberately small and quiet. This is a guest-facing screen; the
              toggle is for whoever sets the room up in the morning, and 44px is
              the smallest a finger can be trusted to hit on a wall tablet. */}
          <button
            type="button"
            onClick={onToggleTheme}
            aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
            title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
            className={cn(
              'w-11 h-11 min-w-[44px] min-h-[44px] rounded-2xl border flex items-center justify-center transition-colors',
              t.toggle,
            )}
          >
            {theme === 'dark'
              ? <SunDim className="w-5 h-5" />
              : <Moon className="w-5 h-5" />}
          </button>
        </div>
      </div>
    </header>
  );
}

function Stat({
  t,
  label,
  value,
  note,
  icon,
  small,
}: {
  t: Tokens;
  label: string;
  value: string;
  note?: string;
  icon: React.ReactNode;
  small?: boolean;
}) {
  return (
    <div className={cn('rounded-2xl border px-3 py-3 sm:px-4 sm:py-4 min-w-0', t.panel)}>
      <p className={cn('flex items-center gap-1.5 text-[9px] sm:text-[11px] font-semibold uppercase tracking-[0.18em]', t.faint)}>
        <span>{icon}</span>
        <span className="truncate">{label}</span>
      </p>
      <p
        className={cn(
          'mt-1 font-bold leading-tight break-words',
          t.strong,
          small ? 'text-base sm:text-2xl' : 'text-2xl sm:text-4xl',
        )}
      >
        {value}
      </p>
      {note ? <p className={cn('text-[10px] sm:text-xs mt-0.5', t.faint)}>{note}</p> : null}
    </div>
  );
}
