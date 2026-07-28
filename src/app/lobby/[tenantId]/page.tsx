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
 * DESIGN NOTES
 *  - Dark, because it runs for twelve hours in a room with a window.
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
  Users, Clock, Scissors, Star, Sparkles, Hourglass,
  Coffee, Wifi, AlertTriangle, CheckCircle2, BellRing, User,
} from 'lucide-react';

/* ── shapes, matching the board payload exactly ─────────────────────────── */

type QueueRow = {
  position?: number;
  firstName?: string;
  serviceName?: string;
  providerFirstName?: string;
  requested?: boolean;
  notified?: boolean;
  waitedMin?: number;
};

type ServiceRow = {
  firstName?: string;
  serviceName?: string;
  providerFirstName?: string;
};

type FloorRow = {
  firstName?: string;
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
  generatedAt?: string;
  queue?: QueueRow[];
  inService?: ServiceRow[];
  floor?: FloorRow[];
};

/* ── timings ───────────────────────────────────────────────────────────────
 * 12s polling is often enough that the room believes it is live, and light
 * enough that a screen left on all day is a rounding error on the bill. */
const POLL_MS = 12 * 1000;
const CLOCK_MS = 20 * 1000;
const ROTATE_MS = 9 * 1000;
const PAGE_SIZE = 6;
/* After this long with no successful poll we stop pretending the numbers are
 * current. A wall screen quietly showing a frozen queue is worse than one
 * admitting it lost the wifi. */
const STALE_MS = 70 * 1000;

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

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
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
  const freeCount = floor.filter(f => f.accepting !== false && f.busy !== true).length;

  /* ── the states before there is a board to draw ───────────────────────── */

  if (fatal) {
    return (
      <Shell>
        <div className="flex-1 flex flex-col items-center justify-center text-center px-6 gap-4">
          <AlertTriangle className="w-10 h-10 text-amber-400" />
          <p className="text-xl sm:text-2xl font-semibold">{fatal}</p>
          <p className="text-sm text-slate-400">Check the link on this screen.</p>
        </div>
      </Shell>
    );
  }

  if (loading && !board) {
    return (
      <Shell>
        <div className="flex-1 flex flex-col items-center justify-center gap-4">
          <Hourglass className="w-9 h-9 text-slate-500 animate-pulse" />
          <p className="text-slate-400 text-sm tracking-wide uppercase">Loading the line</p>
        </div>
      </Shell>
    );
  }

  if (board && board.enabled !== true) {
    return (
      <Shell>
        <Header
          studioName={studioName}
          now={now}
          stale={stale}
          subtitle="Walk-ins are closed right now"
        />
        <div className="flex-1 flex flex-col items-center justify-center text-center px-6 gap-5">
          <div className="w-20 h-20 rounded-3xl bg-slate-800 flex items-center justify-center">
            <Coffee className="w-9 h-9 text-slate-400" />
          </div>
          <p className="text-2xl sm:text-4xl font-semibold">We are by appointment today</p>
          <p className="text-slate-400 text-base sm:text-lg max-w-md">
            Come see us at the front desk and we will find you a time.
          </p>
        </div>
      </Shell>
    );
  }

  /* ── the board ─────────────────────────────────────────────────────────── */

  return (
    <Shell>
      <Header
        studioName={studioName}
        now={now}
        stale={stale}
        subtitle={
          queue.length === 0
            ? 'No wait — walk right in'
            : `${queue.length} ${queue.length === 1 ? 'guest' : 'guests'} in line`
        }
      />

      {/* ── CALLED FORWARD ── the loudest thing on the screen, deliberately ── */}
      {called.length > 0 && (
        <div className="px-4 sm:px-6 pt-4">
          <div className="rounded-3xl border-2 border-emerald-400/70 bg-emerald-500/10 p-4 sm:p-6">
            <p className="flex items-center gap-2 text-emerald-300 text-[11px] sm:text-xs font-semibold uppercase tracking-[0.22em]">
              <BellRing className="w-4 h-4" /> Ready for you now
            </p>
            <div className="mt-3 flex flex-wrap gap-3">
              {called.slice(0, 4).map((q, i) => (
                <div
                  key={`called-${i}`}
                  className="flex-1 min-w-[13rem] rounded-2xl bg-emerald-500/15 border border-emerald-400/40 px-4 py-4"
                >
                  <p className="text-3xl sm:text-5xl font-bold text-white leading-tight break-words">
                    {q.firstName || 'Guest'}
                  </p>
                  <p className="mt-1 text-emerald-200 text-sm sm:text-lg">
                    {q.providerFirstName
                      ? `${q.providerFirstName} is ready for you`
                      : 'Your provider is ready for you'}
                  </p>
                  {q.serviceName ? (
                    <p className="mt-0.5 text-emerald-300/70 text-xs sm:text-sm">{q.serviceName}</p>
                  ) : null}
                </div>
              ))}
            </div>
            <p className="mt-3 text-emerald-200/70 text-xs sm:text-sm">
              Please come to the front — we have your chair.
            </p>
          </div>
        </div>
      )}

      {/* ── THE THREE NUMBERS ─────────────────────────────────────────────── */}
      <div className="px-4 sm:px-6 pt-4 grid grid-cols-3 gap-3">
        <Stat
          label="In line"
          value={String(queue.length)}
          note={queue.length === 1 ? 'guest' : 'guests'}
          icon={<Users className="w-4 h-4" />}
        />
        <Stat
          label="Typical wait"
          value={softWait(board?.estWaitMin)}
          note={Number(board?.estWaitMin) > 0 ? 'roughly' : 'right now'}
          icon={<Clock className="w-4 h-4" />}
          small
        />
        <Stat
          label="Free now"
          value={String(freeCount)}
          note={freeCount === 1 ? 'provider' : 'providers'}
          icon={<Sparkles className="w-4 h-4" />}
        />
      </div>

      <div className="flex-1 px-4 sm:px-6 py-4 grid gap-4 lg:grid-cols-[1.35fr_1fr] items-start">

        {/* ── UP NEXT ───────────────────────────────────────────────────────
            min-w-0 on a grid child is not optional: a grid track defaults to
            min-width:auto, so without it one long service name makes the whole
            board scroll sideways on a phone. */}
        <section className="min-w-0 rounded-3xl border border-slate-800 bg-slate-900/60 p-4 sm:p-5">
          <div className="flex items-center justify-between gap-3">
            <h2 className="flex items-center gap-2 text-[11px] sm:text-xs font-semibold uppercase tracking-[0.22em] text-slate-400">
              <Hourglass className="w-4 h-4" /> Up next
            </h2>
            {pages.length > 1 && (
              <div className="flex items-center gap-1.5" aria-hidden="true">
                {pages.map((_, i) => (
                  <span
                    key={`dot-${i}`}
                    className={cn(
                      'w-1.5 h-1.5 rounded-full transition-colors',
                      i === pageIdx ? 'bg-slate-300' : 'bg-slate-700',
                    )}
                  />
                ))}
              </div>
            )}
          </div>

          {waiting.length === 0 ? (
            <div className="py-10 sm:py-14 text-center">
              <div className="w-16 h-16 mx-auto rounded-3xl bg-slate-800 flex items-center justify-center">
                <CheckCircle2 className="w-8 h-8 text-emerald-400" />
              </div>
              <p className="mt-4 text-2xl sm:text-3xl font-semibold">Nobody is waiting</p>
              <p className="mt-1 text-slate-400 text-sm sm:text-base">
                Walk right in — we can take you now.
              </p>
            </div>
          ) : (
            <ul className="mt-3 space-y-2.5">
              {shown.map((q, i) => (
                <li
                  key={`q-${q.position ?? i}-${i}`}
                  className="flex items-center gap-3 sm:gap-4 min-w-0 rounded-2xl bg-slate-800/60 border border-slate-700/60 px-3 sm:px-4 py-3"
                >
                  <div className="w-11 h-11 sm:w-14 sm:h-14 shrink-0 rounded-2xl bg-slate-900 border border-slate-700 flex items-center justify-center">
                    <span className="text-lg sm:text-2xl font-bold text-slate-200">
                      {positionLabel(q.position, q.firstName)}
                    </span>
                  </div>
                  {/* min-w-0 all the way down, and the truncate on a SPAN rather
                      than on the flex row — a flex container cannot truncate
                      itself, which is how a long name pushed the whole board
                      sideways on a phone. */}
                  <div className="min-w-0 flex-1">
                    <p className="flex items-center gap-2 min-w-0 text-xl sm:text-3xl font-semibold text-white">
                      <span className="truncate min-w-0">{q.firstName || 'Guest'}</span>
                      {q.requested === true && (
                        <Star className="w-4 h-4 sm:w-5 sm:h-5 shrink-0 text-amber-300" />
                      )}
                    </p>
                    <p className="mt-0.5 text-slate-400 text-xs sm:text-base truncate">
                      {[q.serviceName, q.providerFirstName ? `with ${q.providerFirstName}` : '']
                        .filter(Boolean)
                        .join(' · ')}
                    </p>
                  </div>
                  {/* The narrowest phone gives this up rather than squeeze the
                      name, which is the thing the guest is looking for. */}
                  <p className="hidden sm:block shrink-0 text-slate-500 text-sm text-right whitespace-nowrap">
                    {waitedLabel(q.waitedMin)}
                  </p>
                </li>
              ))}
            </ul>
          )}

          {waiting.length > PAGE_SIZE && (
            <p className="mt-3 text-center text-slate-500 text-[11px] sm:text-xs">
              Showing {shown.length} of {waiting.length} — the list rotates
            </p>
          )}
        </section>

        {/* ── RIGHT COLUMN: who is in the chair, and who is on the floor ──── */}
        <div className="min-w-0 space-y-4">

          <section className="min-w-0 rounded-3xl border border-slate-800 bg-slate-900/60 p-4 sm:p-5">
            <h2 className="flex items-center gap-2 text-[11px] sm:text-xs font-semibold uppercase tracking-[0.22em] text-slate-400">
              <Scissors className="w-4 h-4" /> In the chair
            </h2>
            {inService.length === 0 ? (
              <p className="mt-3 text-slate-500 text-sm">Nobody in service right now.</p>
            ) : (
              <ul className="mt-3 space-y-2">
                {inService.slice(0, 8).map((s, i) => (
                  <li key={`s-${i}`} className="flex items-baseline justify-between gap-3 min-w-0">
                    <span className="text-base sm:text-xl font-medium text-white truncate">
                      {s.firstName || 'Guest'}
                    </span>
                    <span className="shrink-0 text-slate-400 text-xs sm:text-sm truncate">
                      {s.providerFirstName ? `with ${s.providerFirstName}` : s.serviceName || ''}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="min-w-0 rounded-3xl border border-slate-800 bg-slate-900/60 p-4 sm:p-5">
            <h2 className="flex items-center gap-2 text-[11px] sm:text-xs font-semibold uppercase tracking-[0.22em] text-slate-400">
              <User className="w-4 h-4" /> On the floor today
            </h2>
            {floor.length === 0 ? (
              <p className="mt-3 text-slate-500 text-sm">The team list is not up yet.</p>
            ) : (
              <div className="mt-3 flex flex-wrap gap-2">
                {floor.map((f, i) => (
                  <span
                    key={`f-${i}`}
                    className={cn(
                      'inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs sm:text-sm border',
                      f.accepting === false
                        ? 'border-slate-700 bg-slate-800/40 text-slate-500'
                        : f.busy
                          ? 'border-amber-400/30 bg-amber-400/10 text-amber-200'
                          : 'border-emerald-400/30 bg-emerald-400/10 text-emerald-200',
                    )}
                  >
                    <span
                      className={cn(
                        'w-1.5 h-1.5 rounded-full',
                        f.accepting === false
                          ? 'bg-slate-600'
                          : f.busy
                            ? 'bg-amber-300'
                            : 'bg-emerald-300',
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
          <section className="min-w-0 rounded-3xl border border-slate-800 bg-gradient-to-br from-slate-900 to-slate-900/40 p-4 sm:p-5">
            <p className="flex items-center gap-2 text-[11px] sm:text-xs font-semibold uppercase tracking-[0.22em] text-slate-400">
              <Coffee className="w-4 h-4" /> While you wait
            </p>
            <p className="mt-2 text-base sm:text-xl font-medium text-white leading-snug">
              Scan the code on your ticket for a drink, and to follow your visit.
            </p>
            <p className="mt-1 text-slate-400 text-xs sm:text-sm">
              Ask us about anything you would like added on today.
            </p>
          </section>
        </div>
      </div>

      {/* ── FOOTER ────────────────────────────────────────────────────────── */}
      <div className="px-4 sm:px-6 pb-4">
        <div className="flex items-center justify-between gap-3 text-[11px] sm:text-xs text-slate-500">
          <span>{studioName ? `${studioName} · walk-in queue` : 'Walk-in queue'}</span>
          <span className="flex items-center gap-1.5">
            {stale ? (
              <>
                <Wifi className="w-3.5 h-3.5 text-amber-400" />
                <span className="text-amber-400">Reconnecting</span>
              </>
            ) : (
              <>
                <Wifi className="w-3.5 h-3.5 text-emerald-400" />
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

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-dvh bg-slate-950 text-white flex flex-col antialiased">
      {children}
    </div>
  );
}

function Header({
  studioName,
  subtitle,
  now,
  stale,
}: {
  studioName: string;
  subtitle: string;
  now: Date | null;
  stale: boolean;
}) {
  return (
    <header className="px-4 sm:px-6 pt-5 pb-1">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          {studioName ? (
            <p className="text-[10px] sm:text-xs uppercase tracking-[0.3em] text-slate-500 truncate">
              {studioName}
            </p>
          ) : null}
          <h1 className="mt-1 text-2xl sm:text-4xl lg:text-5xl font-bold leading-tight">
            {subtitle}
          </h1>
        </div>
        <div className="shrink-0 text-right">
          <p className="text-xl sm:text-3xl font-semibold tabular-nums">
            {now ? clockLabel(now) : ''}
          </p>
          {stale ? (
            <p className="text-[10px] sm:text-xs text-amber-400 mt-0.5">not live</p>
          ) : null}
        </div>
      </div>
    </header>
  );
}

function Stat({
  label,
  value,
  note,
  icon,
  small,
}: {
  label: string;
  value: string;
  note?: string;
  icon: React.ReactNode;
  small?: boolean;
}) {
  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-900/60 px-3 py-3 sm:px-4 sm:py-4 min-w-0">
      <p className="flex items-center gap-1.5 text-[9px] sm:text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
        <span className="text-slate-500">{icon}</span>
        <span className="truncate">{label}</span>
      </p>
      <p
        className={cn(
          'mt-1 font-bold text-white leading-tight break-words',
          small ? 'text-base sm:text-2xl' : 'text-2xl sm:text-4xl',
        )}
      >
        {value}
      </p>
      {note ? <p className="text-[10px] sm:text-xs text-slate-500 mt-0.5">{note}</p> : null}
    </div>
  );
}
