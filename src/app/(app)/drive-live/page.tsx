'use client';
// src/app/(app)/drive-live/page.tsx — DRIVE-THRU LIVE (design board "Drive-thru live", layout A: the lane, from above;
// api/drive-live; lib/drive-live). For a manager's phone, a screen in the back, or the owner at home: every car in the
// lane, where it is, sliding along as the team taps it on and as sensors see it, with how long it's been waiting against
// the drive-thru target. A car near its target turns amber, one over it solid amber, so it stands out at once; tap one to
// see where its time went and what the kitchen is still making. Curbside, orders placed ahead and the counter's line sit
// underneath. Read every few seconds while it's on screen; nothing here moves a car.
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useTenant } from '@/context/TenantContext';
import { clock, laneShape, lengthFor, liveTotals, placeLane, secondsSince, stuckWords, timesOf, toneOf, TONE_WORDS, type LiveCar, type LiveNow, type Tone } from '@/lib/drive-live';
import { formatTime } from '@/lib/tenant-time';

const INK = '#16171a', MUTED = '#6d7075', LINE = '#ececee', SOFT = '#f5f5f7', DEEP_GREEN = '#1f7a4d', DEEP_AMBER = '#b45309', AMBER = 'var(--warn-ink)', GREEN = 'var(--ok-ink)';
const RING = 'outline-none focus-visible:ring-2 focus-visible:ring-[#16171a] focus-visible:ring-offset-2';
const POLL_MS = 3000;
/** A car's chip, and the room around the lane. */
const CHIP = { w: 66, h: 44 };
const hereAsked = () => { try { const v = localStorage.getItem('selectedLocationId'); return v ? { locationId: v } : {}; } catch { return {}; } };

const toneStyle = (t: Tone): React.CSSProperties => t === 'over' ? { background: DEEP_AMBER, color: '#fff', border: `2px solid ${DEEP_AMBER}` }
  : t === 'near' ? { background: '#fff', color: AMBER, border: `2px solid ${AMBER}` } : { background: DEEP_GREEN, color: '#fff', border: `2px solid ${DEEP_GREEN}` };
const STAGE_WORDS: Record<LiveCar['stage'], string> = { speaker: 'ordering', pay: 'on the way to pay', pickup: 'at the pickup window', forward: 'parked' };

export default function DriveLivePage() {
  const { selectedTenant } = useTenant() as any;
  const tenantId: string | null = selectedTenant?.id || null;
  const [live, setLive] = useState<LiveNow | null>(null);
  const [err, setErr] = useState('');
  const [skew, setSkew] = useState(0); const [lastOk, setLastOk] = useState(0);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [open, setOpen] = useState<string | null>(null);
  const closeSheet = useCallback(() => setOpen(null), []);

  const load = useCallback(async () => {
    if (!tenantId) return;
    try {
      const r = await fetch('/api/drive-live', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tenantId, action: 'now', ...hereAsked() }) });
      const d = await r.json().catch(() => ({ ok: false }));
      if (d.ok && d.live) { setLive(d.live); setErr(''); setLastOk(Date.now()); const s = Date.parse(d.live.now); if (Number.isFinite(s)) setSkew(s - Date.now()); }
      else setErr(d.error || 'The lane didn’t load. Trying again.');
    } catch { setErr('No connection. Trying again.'); }
  }, [tenantId]);
  useEffect(() => { void load(); }, [load]);
  // (Every few seconds while it's on screen; at once when it's back.)
  useEffect(() => {
    const t = setInterval(() => { if (document.visibilityState === 'visible') void load(); }, POLL_MS);
    const back = () => { if (document.visibilityState === 'visible') void load(); };
    document.addEventListener('visibilitychange', back);
    return () => { clearInterval(t); document.removeEventListener('visibilitychange', back); };
  }, [load]);
  // (The times count up every second, on the server's clock.)
  useEffect(() => { const t = setInterval(() => setNowMs(Date.now()), 1000); return () => clearInterval(t); }, []);
  const now = nowMs + skew;
  const totals = useMemo(() => (live ? liveTotals(live, now) : null), [live, now]);
  const stale = !!lastOk && nowMs - lastOk > 15000;
  const car = live && open ? live.cars.find((c) => c.id === open) || null : null;

  return (
    <div className="mx-auto w-full max-w-[1180px] space-y-5 px-4 pb-16 pt-6 sm:px-6" style={{ color: INK, fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif" }}>
      <div>
        <h1 className="text-[26px] font-semibold tracking-tight">Drive-thru live</h1>
        <p className="mt-1 max-w-[720px] text-[15px]" style={{ color: MUTED }}>
          Every car, where it is, as it moves. Times run from when a car pulled up{live ? `, against your ${clock(live.target)} target` : ''}{live?.location?.name ? `, at ${live.location.name}` : ''}.
        </p>
      </div>
      {err && !live && <p role="alert" className="text-[15px]" style={{ color: AMBER }}>{err}</p>}
      {!live && !err && <p className="text-[15px]" style={{ color: MUTED }}>Loading the lane…</p>}
      {live && totals && (
        <>
          <section aria-label="The lane now" className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Stat value={String(totals.inLane)} label={totals.inLane === 1 ? 'car in the lane' : 'cars in the lane'} />
            <Stat value={live.sensor ? String(totals.waiting) : 'No entry sensor'} label={live.sensor ? 'waiting to order' : 'to count cars before the speaker'} quiet={!live.sensor} />
            <Stat value={totals.longest ? clock(totals.longest.sec) : '0:00'} label="longest wait now" tone={totals.longest ? toneOf(totals.longest.sec, live.target) : 'ok'} />
            <Stat value={String(totals.over)} label={`over ${clock(live.target)}`} tone={totals.over ? 'over' : 'ok'} />
          </section>
          {(live.rush || stale || err) && (
            <p role="status" className="rounded-xl px-4 py-3 text-[14.5px] font-medium" style={{ background: 'var(--warn-soft)', color: AMBER }}>
              {stale || err ? `Not updating. Last seen ${clock((nowMs - lastOk) / 1000)} ago. Check the connection.` : 'A rush: the line is long. Orders are kept short at the speaker, and the kitchen sees them as they’re said.'}
            </p>
          )}
          <Lane live={live} now={now} open={open} onOpen={setOpen} />
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-[13px]" style={{ color: MUTED }} aria-label="What the colors mean">
            <Key tone="ok" label="On time" /><Key tone="near" label={`Near the target (from ${clock(live.target * 0.75)})`} /><Key tone="over" label={`Over ${clock(live.target)}`} />
            {live.sensor && <span className="inline-flex items-center gap-2"><span aria-hidden className="inline-block h-3 w-4 rounded bg-[#d6d7db] dark:bg-[#3a3b40]" />Counted at the entry, not ordering yet</span>}
          </div>
          <Side live={live} now={now} />
        </>
      )}
      {car && live && <CarSheet car={car} live={live} now={now} onClose={closeSheet} />}
    </div>
  );
}

function Stat({ value, label, tone, quiet }: { value: string; label: string; tone?: Tone; quiet?: boolean }) {
  const color = tone === 'over' ? AMBER : tone === 'near' ? AMBER : INK;
  return (
    <div className="rounded-2xl border px-4 py-3" style={{ background: '#fff', borderColor: LINE }}>
      <div className={`${quiet ? 'text-[15px]' : 'text-[22px]'} font-semibold tabular-nums`} style={{ color: quiet ? MUTED : color }}>{value}</div>
      <div className="text-[13px]" style={{ color: MUTED }}>{label}</div>
    </div>
  );
}

function Key({ tone, label }: { tone: Tone; label: string }) {
  return <span className="inline-flex items-center gap-2"><span aria-hidden className="inline-block h-3 w-4 rounded" style={toneStyle(tone)} />{label}</span>;
}

/** The lane drawn from above: across a wide screen (the entry on the left), down a phone's (the entry at the top). */
function Lane({ live, now, open, onOpen }: { live: LiveNow; now: number; open: string | null; onOpen: (id: string) => void }) {
  const box = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const el = box.current; if (!el) return;
    const fit = () => setWidth(el.clientWidth);
    fit(); const ro = new ResizeObserver(fit); ro.observe(el); return () => ro.disconnect();
  }, []);
  const wide = width >= 620;
  const two = live.lanes === 2;
  const slot = wide ? 78 : 56, laneWidth = wide ? 56 : two ? 72 : 84;
  // (A phone's lane starts a little lower, for the entry's name above it.)
  const pad = 18, start = wide ? 18 : 38, kitchenDepth = wide ? 74 : 96;
  // (Without a lane entry sensor, nobody is counted before the speaker.)
  const waiting = live.sensor ? live.waiting : { 1: 0, 2: 0 };
  const length = wide ? Math.max(560, width - pad * 2) : lengthFor(live.cars, { min: 520, slot, laneWidth, two, waiting, spots: live.spots });
  const shape = laneShape({ length, slot, laneWidth, two });
  const plan = placeLane(live.cars, shape, { two, waiting, spots: live.spots, squeeze: wide, perRow: wide ? 4 : 8, minGap: CHIP.w + 6 });
  // How far the drawing reaches either side of the lane: the kitchen on one side, the spots on the other.
  // (On a phone, the names beside the lane, a speaker's and how many are waiting, need room of their own.)
  const outer = (two ? shape.laneAcross[2] : 0) + laneWidth / 2; const named = wide ? 0 : 84;
  const minus = Math.min(-(laneWidth / 2 + 14 + kitchenDepth), -(outer + named));
  const plus = Math.max(outer + 40, outer + (two ? named : 0), ...plan.spots.map((s) => s.across + (wide ? CHIP.h : CHIP.w) / 2 + 4)) + (wide ? 18 : 4);
  const crossSize = plus - minus;
  // (along, across) → the screen: across a wide one (the entry on the left), down a phone's (the entry at the top).
  const cx = width / 2 - (plus + minus) / 2;
  const at = (along: number, across: number) => (wide ? { x: pad + along, y: pad + (across - minus) } : { x: cx + across, y: start + along });
  const W = wide ? length + pad * 2 : width, H = wide ? crossSize + pad * 2 : length + start + pad;
  const reduce = useReducedMotion();

  // Cars just arrived slide in from the entry; cars just gone drive off past the exit and fade.
  const entry = at(shape.at.entry, 0);
  const [settled, setSettled] = useState<Set<string>>(() => new Set(live.cars.map((c) => c.id)));
  const [gone, setGone] = useState<{ car: LiveCar; x: number; y: number }[]>([]);
  // (Where each car was drawn at the last read: one not here now is the same chip, driving off past the exit.)
  const last = useRef<Map<string, { car: LiveCar; x: number; y: number }>>(new Map());
  const timers = useRef<number[]>([]);
  useEffect(() => () => { timers.current.forEach((t) => window.clearTimeout(t)); }, []);
  const target = new Map<string, { x: number; y: number }>();
  for (const p of plan.cars) target.set(p.id, at(p.along, p.across));
  // (Gone from the lane: handed over, or left. One only counted past the end of a long line isn't gone.)
  const here = new Set(live.cars.map((c) => c.id));
  const leaving = reduce ? [] : Array.from(last.current.values()).filter((x) => !here.has(x.car.id));
  const driving = [...gone.filter((g) => !here.has(g.car.id) && !leaving.some((l) => l.car.id === g.car.id)), ...leaving];
  useEffect(() => {
    const fresh = live.cars.filter((c) => !settled.has(c.id)).map((c) => c.id);
    let raf = 0;
    if (fresh.length) raf = requestAnimationFrame(() => requestAnimationFrame(() => setSettled((s) => new Set([...Array.from(s), ...fresh]))));
    if (leaving.length) {
      const ids = new Set(leaving.map((l) => l.car.id));
      setGone((g) => [...g.filter((x) => !ids.has(x.car.id)), ...leaving]);
      timers.current.push(window.setTimeout(() => setGone((g) => g.filter((x) => !ids.has(x.car.id))), 1100));
    }
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live]);
  // (Kept after every drawing, so a car that leaves drives off from where it was last seen, at this size.)
  useEffect(() => { last.current = new Map(live.cars.filter((c) => target.has(c.id)).map((c) => [c.id, { car: c, ...target.get(c.id)! }])); });

  const band = (from: number, to: number, across: number) => {
    const a = at(from, across - laneWidth / 2), b = at(to, across + laneWidth / 2);
    return { left: Math.min(a.x, b.x), top: Math.min(a.y, b.y), width: Math.abs(b.x - a.x), height: Math.abs(b.y - a.y) };
  };
  const kitchenA = at(shape.at.pay - slot * 0.75, -(laneWidth / 2 + 14 + kitchenDepth)), kitchenB = at(Math.min(length, shape.at.pickup + slot * 0.7), -(laneWidth / 2 + 14));
  const label = (text: string, along: number, across: number, o: { strong?: boolean; anchor?: 'start' | 'center' | 'end' } = {}) => {
    const p = at(along, across);
    return <span key={`${text}${along}${across}`} className={`pointer-events-none absolute whitespace-nowrap text-[12.5px] ${o.strong ? 'font-semibold' : 'font-medium'}`}
      style={{ left: p.x, top: p.y, transform: o.anchor === 'start' ? 'translate(0, -50%)' : o.anchor === 'end' ? 'translate(-100%, -50%)' : 'translate(-50%, -50%)', color: o.strong ? INK : MUTED }}>{text}</span>;
  };
  const speakers: { lane: 1 | 2; across: number }[] = two ? [{ lane: 1, across: shape.laneAcross[1] - laneWidth / 2 - 12 }, { lane: 2, across: shape.laneAcross[2] + laneWidth / 2 + 12 }] : [{ lane: 1, across: -laneWidth / 2 - 12 }];
  const moreWaiting = (l: 1 | 2) => plan.moreWaiting[l];
  const firstWaiting = (l: 1 | 2) => plan.waiting.filter((w) => w.lane === l).sort((a, b) => b.along - a.along)[0] || null;
  const lastWaiting = (l: 1 | 2) => plan.waiting.filter((w) => w.lane === l).sort((a, b) => a.along - b.along)[0] || null;
  const move = reduce ? 'none' : 'transform 900ms cubic-bezier(.4,0,.2,1), opacity 600ms ease';

  return (
    <section aria-label="The lane, from above" className="rounded-3xl border p-0" style={{ background: '#fff', borderColor: LINE }}>
      <div ref={box} className="w-full overflow-x-auto">
        {width > 0 && (
          <div className="relative" style={{ width: W, height: H, minWidth: W }}>
            {two ? (<>
              <div aria-hidden className="absolute rounded-xl" style={{ ...band(0, (shape.at.merge || 0) + slot * 0.6, shape.laneAcross[1]), background: SOFT }} />
              <div aria-hidden className="absolute rounded-xl" style={{ ...band(0, (shape.at.merge || 0) + slot * 0.6, shape.laneAcross[2]), background: SOFT }} />
              <div aria-hidden className="absolute rounded-xl" style={{ ...band(shape.at.merge || 0, length, 0), background: SOFT }} />
            </>) : <div aria-hidden className="absolute rounded-xl" style={{ ...band(0, length, 0), background: SOFT }} />}
            <div aria-hidden className={`absolute flex justify-center rounded-2xl border ${wide ? 'items-start pt-3' : 'items-center'}`} style={{ left: Math.min(kitchenA.x, kitchenB.x), top: Math.min(kitchenA.y, kitchenB.y), width: Math.abs(kitchenB.x - kitchenA.x), height: Math.abs(kitchenB.y - kitchenA.y), background: '#fff', borderColor: LINE }}>
              <span className="text-[14px] font-semibold">Kitchen</span>
            </div>
            {(['pay', 'pickup'] as const).map((w) => { const p = at(shape.at[w], -laneWidth / 2 - 4); return (
              <div key={w} aria-hidden className="absolute rounded-full" style={{ left: p.x - (wide ? 24 : 3), top: p.y - (wide ? 3 : 24), width: wide ? 48 : 6, height: wide ? 6 : 48, background: INK }} />); })}
            {label('Pay', shape.at.pay, -laneWidth / 2 - (wide ? 24 : 40))}
            {label('Pickup', shape.at.pickup, -laneWidth / 2 - (wide ? 24 : 40))}
            {speakers.map((s) => { const p = at(shape.at.speaker, s.across); return (
              <span key={s.lane} aria-hidden className="absolute h-3 w-3 rounded-full" style={{ left: p.x - 6, top: p.y - 6, background: INK }} />); })}
            {speakers.map((s) => label(two ? `Speaker ${s.lane}` : 'Speaker', shape.at.speaker, wide ? s.across + (s.across < 0 ? -16 : 16) : s.across + (s.across < 0 ? -10 : 10), { anchor: wide ? 'center' : s.across < 0 ? 'end' : 'start' }))}
            {(() => { const a = at(shape.at.entry, -laneWidth / 2 - (two ? -shape.laneAcross[1] : 0)), b = at(shape.at.entry, (two ? shape.laneAcross[2] : 0) + laneWidth / 2); return live.sensor ? (
              <div aria-hidden className="absolute rounded-full" style={{ left: Math.min(a.x, b.x) - (wide ? 1.5 : 0), top: Math.min(a.y, b.y) - (wide ? 0 : 1.5), width: wide ? 3 : Math.abs(b.x - a.x), height: wide ? Math.abs(b.y - a.y) : 3, background: INK }} />) : null; })()}
            {wide ? label(live.sensor ? 'Entry sensor' : 'Entry', shape.at.entry, outer + 14, { anchor: 'start' }) : label(live.sensor ? 'Entry sensor' : 'Entry', -24, 0)}
            {label('Exit', length - (wide ? 18 : 14), 0)}
            {plan.spots.map((s) => { const p = at(s.along, s.across); const w = wide ? CHIP.w + 6 : CHIP.w + 6, h = CHIP.h + 6; return (
              <div key={s.n} aria-hidden className="absolute flex items-end justify-end rounded-xl border-2 border-dashed border-[#d0d1d5] p-1 text-[11px] dark:border-[#3a3b40]" style={{ left: p.x - w / 2, top: p.y - h / 2, width: w, height: h, color: MUTED }}>{s.carId ? '' : s.n}</div>); })}
            {plan.spots.length > 0 && label(plan.spots.length === 1 ? 'Spot' : 'Spots', Math.min(...plan.spots.map((s) => s.along)) - (wide ? CHIP.w * 0.9 : CHIP.h * 0.95), plan.spots[0].across)}
            {plan.waiting.map((w, i) => { const p = at(w.along, w.across); return (
              <div key={`w${w.lane}-${i}`} aria-hidden className="absolute rounded-xl bg-[#d6d7db] dark:bg-[#3a3b40]" style={{ left: 0, top: 0, width: CHIP.w, height: CHIP.h, transform: `translate(${p.x - CHIP.w / 2}px, ${p.y - CHIP.h / 2}px)`, transition: move }} />); })}
            {([1, 2] as const).filter((l) => l === 1 || two).map((l) => { const n = plan.waiting.filter((w) => w.lane === l).length + moreWaiting(l);
              const f = firstWaiting(l) || (n ? { along: shape.at.entry + slot * 1.1, across: two ? shape.laneAcross[l] : 0 } : null); if (!f || !n) return null;
              const side = two && l === 2 ? 1 : -1; const across = f.across + side * (laneWidth / 2 + (wide ? 14 : 8));
              return label(wide ? `${n} waiting to order` : `${n} waiting`, f.along - (wide ? slot * 0.3 : 0), across, { anchor: wide ? 'center' : side < 0 ? 'end' : 'start' }); })}
            {([1, 2] as const).map((l) => { const z = lastWaiting(l); if (!z || !moreWaiting(l)) return null; const p = at(z.along - slot * 0.75, z.across); return (
              <span key={`more${l}`} className="absolute rounded-full px-2 py-0.5 text-[12px] font-semibold" style={{ left: p.x, top: p.y, transform: 'translate(-50%, -50%)', background: '#fff', border: `1px solid ${LINE}` }}>+{moreWaiting(l)}</span>); })}
            {[...live.cars.map((c) => ({ c, off: null as { x: number; y: number } | null })), ...driving.map(({ car, x, y }) => ({ c: car, off: { x, y } }))]
              // (In one steady order, so a chip is never moved in the page as cars change places: it slides.)
              .sort((a, b) => a.c.id.localeCompare(b.c.id)).map(({ c, off }) => {
                const sec = secondsSince(c.since, now); const tone = toneOf(sec, live.target);
                if (off) { const p = wide ? { x: off.x + slot, y: off.y } : { x: off.x, y: off.y + slot }; return (
                  <button key={c.id} type="button" tabIndex={-1} aria-hidden disabled className="absolute flex flex-col items-center justify-center rounded-xl"
                    style={{ left: 0, top: 0, width: CHIP.w, height: CHIP.h, ...toneStyle(tone), opacity: 0, transform: `translate(${p.x - CHIP.w / 2}px, ${p.y - CHIP.h / 2}px)`, transition: reduce ? 'none' : 'transform 900ms cubic-bezier(.4,0,.2,1), opacity 900ms ease-in', zIndex: 1 }}>
                    <span className="text-[14px] font-semibold leading-none">{c.number}</span>
                    <span className="mt-1 text-[12.5px] font-medium leading-none tabular-nums">{clock(sec)}</span>
                  </button>); }
                const t = target.get(c.id); if (!t) return null;
                const p = settled.has(c.id) || reduce ? t : entry;
                return (
                  <button key={c.id} type="button" onClick={() => onOpen(c.id)} aria-haspopup="dialog"
                    aria-label={`${c.number}${c.name ? `, ${c.name}` : ''}, ${STAGE_WORDS[c.stage]}${c.spot ? ` in spot ${c.spot}` : ''}, ${clock(sec)}, ${TONE_WORDS[tone]}`}
                    className={`absolute flex flex-col items-center justify-center rounded-xl ${RING}`}
                    style={{ left: 0, top: 0, width: CHIP.w, height: CHIP.h, ...toneStyle(tone), transform: `translate(${p.x - CHIP.w / 2}px, ${p.y - CHIP.h / 2}px)`, opacity: settled.has(c.id) || reduce ? 1 : 0, transition: move,
                      boxShadow: open === c.id ? `0 0 0 3px #fff, 0 0 0 5px ${INK}` : undefined, zIndex: open === c.id ? 3 : 2 }}>
                    <span className="text-[14px] font-semibold leading-none">{c.number}</span>
                    <span className="mt-1 text-[12.5px] font-medium leading-none tabular-nums">{clock(sec)}</span>
                  </button>
                );
              })}
            {plan.moreCars.length > 0 && (() => { const p = at(shape.at.entry + slot * 0.2, two ? shape.laneAcross[1] : 0); return <span className="absolute z-[4] whitespace-nowrap rounded-full px-2.5 py-1 text-[12.5px] font-semibold" style={{ left: p.x, top: p.y, transform: 'translate(-50%, -50%)', background: '#fff', border: `1px solid ${LINE}` }}>+{plan.moreCars.length} more {plan.moreCars.length === 1 ? 'car' : 'cars'}</span>; })()}
            {plan.moreParked.length > 0 && (() => { const s = plan.spots[0]; const p = at(s.along - slot, s.across); return <span className="absolute rounded-full px-2 py-0.5 text-[12px] font-semibold" style={{ left: p.x, top: p.y, transform: 'translate(-50%, -50%)', background: '#fff', border: `1px solid ${LINE}` }}>+{plan.moreParked.length} parked</span>; })()}
            {!live.cars.length && !plan.waiting.length && label('No cars in the lane right now.', length / 2 - slot, 0, { strong: true })}
          </div>
        )}
      </div>
    </section>
  );
}

function useReducedMotion(): boolean {
  const [r, setR] = useState(false);
  useEffect(() => {
    try { const m = window.matchMedia('(prefers-reduced-motion: reduce)'); setR(m.matches); const f = () => setR(m.matches); m.addEventListener('change', f); return () => m.removeEventListener('change', f); } catch { return undefined; }
  }, []);
  return r;
}

/** Underneath: curbside, orders placed ahead for the drive-thru, and the counter's line, when each is in use. */
function Side({ live, now }: { live: LiveNow; now: number }) {
  const { curbside, ahead, counter } = live.side;
  const cards: { title: string; main: string; sub: string; tone?: Tone }[] = [];
  if (curbside) {
    const sec = curbside.longestSince ? secondsSince(curbside.longestSince, now) : 0;
    cards.push({ title: 'Curbside', main: curbside.here ? `${curbside.here} outside` : 'Nobody outside', sub: [curbside.here ? `waiting longest ${clock(sec)}` : '', curbside.coming ? `${curbside.coming} on the way` : ''].filter(Boolean).join(', ') || 'Nobody on the way', tone: curbside.here ? toneOf(sec, 300) : undefined });
  }
  if (ahead) cards.push({ title: 'Ordered ahead, for the drive-thru', main: ahead.open ? `${ahead.open} to pick up` : 'None to pick up', sub: [ahead.here ? `${ahead.here} here now` : '', ahead.nextAt ? `next due ${formatTime(ahead.nextAt, live.timeZone)}` : ''].filter(Boolean).join(', ') || 'Paid and waiting for their car' });
  if (counter) { const sec = counter.longestSince ? secondsSince(counter.longestSince, now) : 0; cards.push({ title: 'Counter', main: `${counter.waiting} waiting`, sub: `longest ${clock(sec)}` }); }
  if (!cards.length) return null;
  return (
    <section aria-label="Also waiting" className="grid gap-2 sm:grid-cols-3">
      {cards.map((c) => (
        <div key={c.title} className="rounded-2xl border px-4 py-3" style={{ background: '#fff', borderColor: LINE }}>
          <div className="text-[13px] font-semibold" style={{ color: MUTED }}>{c.title}</div>
          <div className="mt-1 text-[17px] font-semibold" style={{ color: c.tone === 'over' || c.tone === 'near' ? AMBER : INK }}>{c.main}</div>
          <div className="text-[13.5px]" style={{ color: MUTED }}>{c.sub}</div>
        </div>
      ))}
    </section>
  );
}

/** One car: how long, against the target; where its time went; what the kitchen's still making. */
function CarSheet({ car, live, now, onClose }: { car: LiveCar; live: LiveNow; now: number; onClose: () => void }) {
  const close = useRef<HTMLButtonElement | null>(null);
  // (Focus on Close while it's open, kept there; back on the car's chip when it closes.)
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null; close.current?.focus();
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); else if (e.key === 'Tab') { e.preventDefault(); close.current?.focus(); } };
    window.addEventListener('keydown', k);
    return () => { window.removeEventListener('keydown', k); try { opener?.focus?.(); } catch { /* it may be gone */ } };
  }, [onClose]);
  const sec = secondsSince(car.since, now); const tone = toneOf(sec, live.target);
  const x = timesOf(car, now);
  const rows: [string, number | null][] = [['Ordering', x.ordering], ['On to the window', x.toWindow], [car.stage === 'forward' ? 'At the window, then parked' : 'At the window', x.atWindow]];
  const most = Math.max(1, ...rows.map((r) => r[1] || 0));
  const kitchen = car.kitchen === 'not sent' ? 'Not sent to the kitchen yet' : car.kitchen === 'ready' ? 'Ready' : car.waitingOn.length ? `Making ${car.waitingOn.join(', ')}` : 'Being made';
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center" role="presentation" onClick={onClose} style={{ background: 'rgba(22,23,26,0.32)' }}>
      <div role="dialog" aria-modal="true" aria-labelledby="car-title" onClick={(e) => e.stopPropagation()} className="w-full max-w-[460px] space-y-4 rounded-t-3xl p-5 sm:rounded-3xl" style={{ background: '#fff', color: INK }}>
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 id="car-title" className="text-[20px] font-semibold">{car.number}{car.name ? `, ${car.name}` : ''}</h2>
            <p className="text-[14px]" style={{ color: MUTED }}>{[car.looks, car.lane ? `Lane ${car.lane}` : '', car.ahead ? 'Ordered ahead' : '', car.inLine ? 'Taken in line' : '', car.stage === 'forward' && car.spot ? `Spot ${car.spot}` : STAGE_WORDS[car.stage]].filter(Boolean).join(', ')}</p>
          </div>
          <button ref={close} type="button" onClick={onClose} className={`min-h-[44px] rounded-xl px-4 text-[14.5px] font-semibold ${RING}`} style={{ background: SOFT }}>Close</button>
        </div>
        <div className="rounded-2xl px-4 py-3" style={tone === 'ok' ? { background: 'var(--ok-soft)', color: GREEN } : { background: 'var(--warn-soft)', color: AMBER }}>
          <div className="text-[24px] font-semibold tabular-nums">{clock(sec)}</div>
          <div className="text-[14px] font-medium">{tone === 'over' ? `${clock(sec - live.target)} over your ${clock(live.target)} target` : `${clock(live.target - sec)} left of your ${clock(live.target)} target`}</div>
          {tone !== 'ok' && <div className="mt-1 text-[14px]">{stuckWords(car, now)}.</div>}
        </div>
        <div className="space-y-2" aria-label="Where the time went">
          {rows.filter((r) => r[1] !== null).map(([name, s]) => (
            <div key={name} className="grid grid-cols-[150px_1fr_52px] items-center gap-3 text-[14px]">
              <span style={{ color: MUTED }}>{name}</span>
              <span aria-hidden className="h-2 rounded-full" style={{ background: SOFT }}><span className="block h-2 rounded-full" style={{ width: `${Math.max(4, ((s || 0) / most) * 100)}%`, background: INK }} /></span>
              <span className="text-right font-semibold tabular-nums">{clock(s || 0)}</span>
            </div>))}
        </div>
        <p className="text-[14.5px]"><span style={{ color: MUTED }}>Kitchen: </span><span className="font-semibold" style={{ color: car.kitchen === 'ready' ? GREEN : INK }}>{kitchen}</span></p>
      </div>
    </div>
  );
}
