'use client';
// src/app/floor/[tenantId]/page.tsx — THE FLOOR BOARD for an event night: what the seats have asked for (from their QR
// codes), food the kitchen has ready for the room, and every table at a glance (who's here, allergies, who looks after
// it). It runs on a tablet with nobody signed in: a manager sets it up once (the same set-up as the kitchen screen, so a
// tablet set up for either opens both), and from then on it reads and acts through api/floor and api/kitchen. A PIN only
// puts a name on what someone did, and lets them pick the tables they look after tonight. Anyone on the team can also
// open it on their own phone, signed in as themselves.
//   Needs someone: what the host flagged, then anyone who needs a hand getting about, then what's waited too long or is
//     at a table nobody looks after, then oldest; "On my way", then "Done".
//   Ready to run: the kitchen's ready plates for this event, with the seat and any allergy, big.
//   Tables: a map when the seating chart has one (a grid on a phone); tap a table for its seats and to mark arrivals.
//   A soft chime for each new request or plate (just your tables' when "My tables" is on), once the screen has been
//   tapped: browsers allow sound only after a tap. The screen is kept awake while it's open.

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import { useFirebase } from '@/firebase';
import { allergyFlags, type KitchenTicket } from '@/lib/kitchen';

const INK = '#16171a', MUTED = '#6d7075', LINE = '#ececee', SOFT = '#f5f5f7', GREEN = '#1f7a4d', AMBER = '#b45309';
const AMBER_TINT = '#fff7ed', GREEN_TINT = '#ecf6f0';
const POLL_MS = 4000;
const WAIT_MS = 8000;      // a call that takes longer than this is given up (venue wifi drops)
const HOLD_MS = 6000;      // what this tablet just did shows at once, while the server catches up

type Allergy = { label: string; severe: boolean };
type Req = { id: string; status: 'new' | 'acknowledged' | 'done'; type: string | null; label: string; note: string | null; tableId: string | null; table: string | null; seat: string | null;
  guest: string | null; allergies: Allergy[]; createdAt: string; acknowledgedAt: string | null; by: string | null; resolvedAt: string | null; resolvedBy: string | null;
  needsBackup: boolean; escalated: boolean; urgent: boolean };
type Table = { id: string; name: string; x: number | null; y: number | null; seats: { id: string; label: string }[]; staffIds: string[]; chartStaffIds: string[] };
type Guest = { id: string; name: string; tableId: string | null; table: string | null; seat: string | null; here: boolean; meal: string | null; allergies: Allergy[]; note: string | null };
type Ticket = KitchenTicket & { tableId: string | null };
type Board = { screen: string; business: { name: string }; staff: { id: string; name: string } | null; staffOk?: boolean; signedIn?: boolean;
  event: { id: string; title: string; date: string | null; time: string | null; running: boolean; message: { text: string; at: string } | null } | null;
  tables: Table[]; guests: Guest[]; requests: Req[]; ready: Ticket[]; team: { id: string; name: string }[]; mine: string[]; now: string };
type Staff = { id: string; name: string; pass: string };
type Mode = 'key' | 'me';

const keyName = (t: string) => `cf.kitchen.${t}`;   // the same set-up as the kitchen screen
const read = (k: string) => { try { return localStorage.getItem(k); } catch { return null; } };
const write = (k: string, v: string | null) => { try { if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch { /* private window */ } };
const sread = (k: string) => { try { return sessionStorage.getItem(k); } catch { return null; } };
const swrite = (k: string, v: string | null) => { try { if (v === null) sessionStorage.removeItem(k); else sessionStorage.setItem(k, v); } catch { /* private window */ } };
const mins = (iso: string | null, now: number) => { const t = Date.parse(String(iso || '')); return Number.isFinite(t) ? Math.max(0, Math.floor((now - t) / 60000)) : 0; };
const ago = (m: number) => (m < 1 ? 'Just now' : `${m} min`);
const first = (n: string | null | undefined) => String(n || '').trim().split(/\s+/)[0] || '';
const ring = 'outline-none focus-visible:ring-2 focus-visible:ring-[#16171a] focus-visible:ring-offset-2';
const btn = `min-h-[44px] rounded-xl px-4 text-[14.5px] font-semibold disabled:opacity-50 ${ring}`;

// ─── Sound ───────────────────────────────────────────────────────────────────────────────────────────────────────────
// One sound for the board. Browsers (an iPad most of all) start it only from a tap, so the first tap anywhere turns it on.
let audio: AudioContext | null = null;
async function wakeSound(): Promise<boolean> {
  try {
    const AC: any = (window as any).AudioContext || (window as any).webkitAudioContext; if (!AC) return false;
    if (!audio) audio = new AC();
    if (audio!.state !== 'running') await audio!.resume();
    return audio!.state === 'running';
  } catch { return false; }
}
function chime(onSound?: (ok: boolean) => void) {
  const ctx = audio; if (!ctx) return;
  if (ctx.state !== 'running') { ctx.resume().then(() => { onSound?.(ctx.state === 'running'); if (ctx.state === 'running') chime(); }, () => onSound?.(false)); return; }
  for (const [f, at] of [[880, 0], [660, 0.16]] as const) {
    const o = ctx.createOscillator(); const g = ctx.createGain(); o.connect(g); g.connect(ctx.destination);
    o.frequency.setValueAtTime(f, ctx.currentTime + at); g.gain.setValueAtTime(0.0001, ctx.currentTime + at);
    g.gain.linearRampToValueAtTime(0.25, ctx.currentTime + at + 0.01); g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + at + 0.35);
    o.start(ctx.currentTime + at); o.stop(ctx.currentTime + at + 0.4);
  }
}

// ─── A sheet over the board ──────────────────────────────────────────────────────────────────────────────────────────
// Focus goes in once when it opens (not on every refresh of the board), stays inside while it's open, and goes back to
// what opened it; the board behind doesn't scroll.
function Sheet({ label, onClose, wide, children }: { label: string; onClose: () => void; wide?: boolean; children: React.ReactNode }) {
  const box = useRef<HTMLDivElement | null>(null);
  const close = useRef(onClose); close.current = onClose;
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    box.current?.querySelector<HTMLElement>('button, input')?.focus();
    const was = document.body.style.overflow; document.body.style.overflow = 'hidden';
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { close.current(); return; }
      if (e.key !== 'Tab' || !box.current) return;
      const all = Array.from(box.current.querySelectorAll<HTMLElement>('button:not([disabled]), input, a[href]'));
      if (!all.length) return;
      const at = all.indexOf(document.activeElement as HTMLElement);
      if (at < 0) { e.preventDefault(); (e.shiftKey ? all[all.length - 1] : all[0]).focus(); return; }   // focus fell out (a button just turned off)
      if (e.shiftKey && at === 0) { e.preventDefault(); all[all.length - 1].focus(); }
      else if (!e.shiftKey && at === all.length - 1) { e.preventDefault(); all[0].focus(); }
    };
    document.addEventListener('keydown', key);
    return () => { document.removeEventListener('keydown', key); document.body.style.overflow = was; opener?.focus?.(); };
  }, []);
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center" style={{ background: 'rgba(22,23,26,0.45)' }} onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div ref={box} role="dialog" aria-modal="true" aria-label={label} tabIndex={-1} className={`outline-none w-full ${wide ? 'sm:max-w-lg' : 'sm:max-w-sm'} max-h-[88dvh] overflow-y-auto rounded-t-3xl sm:rounded-3xl bg-[#fff] p-6 space-y-4`}>
        {children}
      </div>
    </div>
  );
}
const CloseX = ({ onClose }: { onClose: () => void }) => (
  <button type="button" onClick={onClose} aria-label="Close" className={`h-11 w-11 shrink-0 rounded-full border text-[20px] ${ring}`} style={{ borderColor: LINE }}>×</button>
);

// ─── Setting the screen up ───────────────────────────────────────────────────────────────────────────────────────────
function Setup({ tenantId, stopped, onPaired, onMe }: { tenantId: string; stopped: string; onPaired: (key: string) => void; onMe: () => void }) {
  const { user, isUserLoading } = useFirebase() as any;
  const [name, setName] = useState('Floor'); const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  const pair = async () => {
    setBusy(true); setErr('');
    try {
      const r = await fetch('/api/kitchen', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'pair', tenantId, name, kind: 'floor' }) });
      const d = await r.json().catch(() => ({}));
      if (d.ok && d.key) onPaired(String(d.key)); else setErr(d.error || 'That didn’t go through. Try again.');
    } catch { setErr('No connection. Try again.'); }
    setBusy(false);
  };
  const next = typeof window !== 'undefined' ? `${window.location.pathname}${window.location.search}` : `/floor/${tenantId}`;
  return (
    <main className="min-h-dvh flex items-center justify-center p-4" style={{ background: SOFT, color: INK }}>
      <div className="w-full max-w-md rounded-3xl bg-[#fff] p-6 space-y-4 border" style={{ borderColor: LINE }}>
        <div>
          <h1 className="text-[24px] font-semibold tracking-tight">Set up the floor board</h1>
          <p className="text-[15px] mt-1.5 leading-relaxed" style={{ color: MUTED }}>A manager sets a shared tablet up once. After that it keeps working when they sign out: anyone on the floor can answer requests and run food, and a PIN only puts a name on what they did.</p>
        </div>
        {stopped && <p className="rounded-2xl px-4 py-3 text-[14px]" style={{ background: AMBER_TINT, color: AMBER }}>{stopped}</p>}
        {isUserLoading ? <div className="h-7 w-7 rounded-full border-[3px] animate-spin mx-auto" style={{ borderColor: LINE, borderTopColor: INK }} role="status" aria-label="Loading" />
          : user ? (
            <div className="space-y-3">
              <label className="block"><span className="text-[14px] font-medium">Name this tablet</span>
                <input value={name} onChange={(e) => setName(e.target.value.slice(0, 40))} className="mt-1.5 w-full min-h-[44px] rounded-xl border px-3 text-[16px] outline-none focus:border-[#16171a]" style={{ borderColor: LINE }} placeholder="Floor, Bar, Door" /></label>
              {err && <p role="alert" className="text-[14px]" style={{ color: AMBER }}>{err}</p>}
              <button type="button" onClick={pair} disabled={busy} className={`${btn} w-full`} style={{ background: INK, color: '#fff' }}>{busy ? 'Setting up…' : 'Set up this tablet for the team'}</button>
              <p className="text-[13px]" style={{ color: MUTED }}>Signed in as {user.email || 'you'}. Only an owner or manager can set up a shared tablet. Tablets already set up are listed on the kitchen screen’s set-up page, where a lost one can be stopped.</p>
              <div className="border-t pt-3" style={{ borderColor: LINE }}>
                <button type="button" onClick={onMe} className={`${btn} w-full`} style={{ background: '#fff', color: INK, border: `1px solid ${LINE}` }}>Just use it as me, on this device</button>
              </div>
            </div>
          ) : <a href={`/login?next=${encodeURIComponent(next)}`} className={`${btn} w-full inline-flex items-center justify-center`} style={{ background: INK, color: '#fff' }}>Sign in</a>}
      </div>
    </main>
  );
}

// ─── Who's working ───────────────────────────────────────────────────────────────────────────────────────────────────
function PinSheet({ onClose, onPin }: { onClose: () => void; onPin: (pin: string) => Promise<string | null> }) {
  const [pin, setPin] = useState(''); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const press = async (k: string) => {
    if (busy) return;
    if (k === 'del') { setPin((p) => p.slice(0, -1)); return; }
    const next = (pin + k).slice(0, 4); setPin(next); setErr('');
    if (next.length === 4) { setBusy(true); const e = await onPin(next); setBusy(false); if (e) { setErr(e); setPin(''); } }
  };
  return (
    <Sheet label="Who’s working?" onClose={onClose}>
      <div className="flex items-start justify-between gap-3">
        <div><h2 className="text-[20px] font-semibold">Who’s working?</h2><p className="text-[14px] mt-1" style={{ color: MUTED }}>Your PIN puts your name on what you do, and lets you pick your tables.</p></div>
        <CloseX onClose={onClose} />
      </div>
      <div className="flex justify-center gap-3" role="img" aria-label={`${pin.length} of 4 digits entered`}>{[0, 1, 2, 3].map((i) => <span key={i} className="h-4 w-4 rounded-full" style={{ background: i < pin.length ? INK : LINE }} />)}</div>
      <p role="alert" className="min-h-5 text-center text-[14px] font-medium" style={{ color: AMBER }}>{err}</p>
      <div className="grid grid-cols-3 gap-2">{['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', 'del'].map((k, i) => k === '' ? <span key={i} /> : (
        <button key={i} type="button" onClick={() => press(k)} disabled={busy} aria-label={k === 'del' ? 'Delete' : k} className={`h-16 rounded-2xl text-[22px] font-semibold ${ring}`} style={{ background: SOFT }}>{k === 'del' ? '⌫' : k}</button>))}</div>
    </Sheet>
  );
}

// ─── Guests at a table (or nobody's table yet) ───────────────────────────────────────────────────────────────────────
function GuestSheet({ title, table, guests, mine, fixed, canPick, busy, onArrive, onMine, onClose }: { title: string; table: Table | null; guests: Guest[]; mine: boolean; fixed: boolean; canPick: boolean;
  busy: string | null; onArrive: (g: Guest) => void; onMine: () => void; onClose: () => void }) {
  // Each seat with the guest sitting there, then anyone else at the table (no seat, a seat not on the chart, or two on one seat).
  const shown = new Set<string>();
  const seats = (table?.seats || []).map((s) => { const g = guests.find((x) => x.seat === s.label && !shown.has(x.id)) || null; if (g) shown.add(g.id); return { key: s.id, seat: s.label, g }; });
  const rows = [...seats, ...guests.filter((g) => !shown.has(g.id)).map((g) => ({ key: g.id, seat: g.seat || '', g }))];
  return (
    <Sheet label={title} onClose={onClose} wide>
      <div className="flex items-start justify-between gap-3">
        <div><h2 className="text-[22px] font-semibold">{title}</h2><p className="text-[14px]" style={{ color: MUTED }}>{guests.filter((g) => g.here).length} of {guests.length} here</p></div>
        <CloseX onClose={onClose} />
      </div>
      {table && canPick && (fixed
        ? <p className="rounded-xl px-4 py-3 text-[14.5px] font-semibold" style={{ background: GREEN_TINT, color: GREEN }}>Yours on the seating chart</p>
        : <button type="button" onClick={onMine} aria-pressed={mine} className={`${btn} w-full`} style={mine ? { background: GREEN_TINT, color: GREEN, border: `1px solid ${GREEN}` } : { background: '#fff', color: INK, border: `1px solid ${LINE}` }}>{mine ? 'You look after this table' : 'I’ll look after this table'}</button>)}
      <ul>
        {rows.length === 0 && <li className="py-6 text-center text-[15px]" style={{ color: MUTED }}>Nobody is seated here yet.</li>}
        {rows.map(({ key, seat, g }, i) => {
          const severe = !!g?.allergies.some((a) => a.severe);
          return (
            <li key={key} className="flex items-start gap-3 py-3" style={{ borderTop: i ? `1px solid ${LINE}` : undefined }}>
              <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[13px] font-semibold" style={g?.allergies.length ? { background: '#fff', border: `2px solid ${AMBER}`, color: AMBER } : { background: SOFT }}>{seat || '–'}</span>
              <div className="min-w-0 flex-1">
                <p className="text-[16px] font-semibold">{g ? g.name : <span style={{ color: MUTED, fontWeight: 400 }}>Open seat</span>}</p>
                {g?.meal && <p className="text-[14px]" style={{ color: MUTED }}>{g.meal}</p>}
                {g && !table && g.table && <p className="text-[14px]" style={{ color: MUTED }}>Listed for {g.table}, not on the seating chart</p>}
                {g && g.allergies.length > 0 && <p className="mt-1 inline-block rounded-lg px-2 py-1 text-[13.5px] font-semibold" style={severe ? { background: AMBER, color: '#fff' } : { background: AMBER_TINT, color: AMBER }}>{severe ? 'Severe allergy' : 'Allergy'}: {g.allergies.map((a) => a.label).join(', ')}</p>}
                {g?.note && <p className="mt-1 text-[13.5px]" style={{ color: AMBER }}>{g.note}</p>}
              </div>
              {g && <button type="button" onClick={() => onArrive(g)} disabled={busy === g.id} aria-pressed={g.here} aria-label={g.here ? `${g.name} is here. Tap if they’re not.` : `Mark ${g.name} as arrived`} className={btn} style={g.here ? { background: GREEN_TINT, color: GREEN } : { background: '#fff', color: INK, border: `1px solid ${LINE}` }}>{g.here ? 'Here' : 'Arrived'}</button>}
            </li>);
        })}
      </ul>
    </Sheet>
  );
}

// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
export default function FloorBoard() {
  const { tenantId } = useParams() as { tenantId: string };
  const [mode, setMode] = useState<Mode | null>(null);
  const [key, setKey] = useState<string | null>(null);
  const [started, setStarted] = useState(false);
  const [data, setData] = useState<Board | null>(null);
  const [stopped, setStopped] = useState('');
  const [closed, setClosed] = useState('');
  const [lastOk, setLastOk] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const [staff, setStaffState] = useState<Staff | null>(null);
  const [pinOpen, setPinOpen] = useState(false);
  const [openTable, setOpenTable] = useState<string | null>(null);
  const [onlyMine, setOnlyMine] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState('');
  const [soundOk, setSoundOk] = useState(false);
  const [muted, setMuted] = useState(false);
  const [heard, setHeard] = useState('');
  const [held, setHeld] = useState<Record<string, { here: boolean; until: number }>>({});

  // What load() reads, kept current without making a new load() (and a new timer) on every change.
  const keyRef = useRef<string | null>(null); const modeRef = useRef<Mode | null>(null); const staffRef = useRef<Staff | null>(null);
  const onlyMineRef = useRef(false); const mutedRef = useRef(false);
  keyRef.current = key; modeRef.current = mode; staffRef.current = staff; onlyMineRef.current = onlyMine; mutedRef.current = muted;
  const seen = useRef<Set<string> | null>(null);
  const acted = useRef(0);      // bumped before and after every tap's call: a refresh that overlapped one is dropped
  const asked = useRef(0);      // each refresh's number: only the latest one started is shown
  const loading = useRef(false);
  const retried = useRef(false);
  const mineChain = useRef<Promise<unknown>>(Promise.resolve());

  useEffect(() => {
    const k = read(keyName(tenantId));
    if (k) { setKey(k); setMode('key'); } else if (sread(`cf.floor.me.${tenantId}`)) setMode('me');
    try { const s = JSON.parse(sread('cf.kitchen.staff') || 'null'); if (s?.name && s?.pass) setStaffState(s); } catch { /* */ }
    setMuted(read('cf.floor.sound') === 'off');
    setHeard(sread('cf.floor.heard') || '');
    setStarted(true);
    const unlock = () => { void wakeSound().then(setSoundOk); };
    for (const ev of ['click', 'touchend', 'keydown']) window.addEventListener(ev, unlock, { passive: true });
    // Keep the screen awake, and ask again whenever it comes back into view.
    let lock: any = null;
    const awake = async () => { try { if (document.visibilityState === 'visible' && (navigator as any).wakeLock) lock = await (navigator as any).wakeLock.request('screen'); } catch { /* not allowed here */ } };
    const back = () => { if (document.visibilityState === 'visible') { void awake(); if (audio && audio.state !== 'running') audio.resume().then(() => setSoundOk(audio?.state === 'running'), () => setSoundOk(false)); } };
    void awake(); document.addEventListener('visibilitychange', back);
    const i = setInterval(() => setNow(Date.now()), 5000);
    return () => { for (const ev of ['click', 'touchend', 'keydown']) window.removeEventListener(ev, unlock); document.removeEventListener('visibilitychange', back); clearInterval(i); try { lock?.release?.(); } catch { /* */ } };
  }, [tenantId]);

  const post = useCallback(async (url: string, body: any) => {
    const stop = new AbortController(); const t = setTimeout(() => stop.abort(), WAIT_MS);
    try {
      const withKey = modeRef.current === 'key' && keyRef.current ? { key: keyRef.current } : {};
      const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tenantId, ...withKey, ...body }), signal: stop.signal });
      return { status: r.status, d: await r.json().catch(() => ({})) as any };
    } catch { return { status: 0, d: {} as any }; } finally { clearTimeout(t); }
  }, [tenantId]);
  const pass = () => (modeRef.current === 'key' && staffRef.current ? { staffPass: staffRef.current.pass } : {});
  const setStaff = (s: Staff | null) => { staffRef.current = s; setStaffState(s); swrite('cf.kitchen.staff', s ? JSON.stringify(s) : null); };
  const forget = useCallback((why: string) => {
    if (modeRef.current === 'key') write(keyName(tenantId), null);
    swrite(`cf.floor.me.${tenantId}`, null);
    setKey(null); setMode(null); setData(null); seen.current = null; retried.current = false; setStopped(why);
  }, [tenantId]);

  // The timer's refresh waits for one still on its way; a refresh after a tap goes at once (the latest started wins).
  const load = useCallback(async (force?: boolean) => {
    if (!modeRef.current || (loading.current && force !== true)) return;
    loading.current = true;
    const mine = ++asked.current; const before = acted.current;
    const { status, d } = await post('/api/floor', { action: 'board', ...pass() });
    loading.current = false;
    if (status === 401) {
      // Signed in as yourself: one more try a moment later (a sign-in can take a second to come back) before asking again.
      if (modeRef.current === 'me' && !retried.current) { retried.current = true; setTimeout(() => void load(true), 1500); return; }
      forget(modeRef.current === 'me' ? 'Please sign in again.' : d.error || 'This tablet was stopped. A manager can set it up again.'); return;
    }
    retried.current = false;
    if (status === 403 && !d.closed) { forget(d.error || 'This is for the business’s own team.'); return; }
    if (d.closed) { setClosed(d.error); return; }
    if (!d.ok) return;
    if (asked.current !== mine || acted.current !== before) return;   // a newer refresh, or a tap, came along: that one shows
    if (d.staffOk === false) setStaff(null);
    setClosed(''); setLastOk(Date.now());
    // A chime for each new request or plate (never for what was already up when the screen opened): with "My tables" on,
    // only for your tables and tables nobody looks after.
    const B = d as Board; const mineSet = new Set(B.mine);
    const counts = (tableId: string | null) => !onlyMineRef.current || !tableId || mineSet.has(tableId) || !(B.tables.find((t) => t.id === tableId)?.staffIds.length);
    const fresh = [...B.requests.filter((r) => r.status === 'new').map((r) => ({ id: `r${r.id}`, tableId: r.tableId })), ...B.ready.map((t) => ({ id: `k${t.id}`, tableId: t.tableId }))]
      .filter((x) => !seen.current?.has(x.id));
    if (seen.current && !mutedRef.current && fresh.some((x) => counts(x.tableId))) chime(setSoundOk);
    seen.current = new Set([...Array.from(seen.current || []), ...fresh.map((x) => x.id)]);
    setData(B);
  }, [post, forget]);
  // Signed in as yourself, the first call waits until this device's sign-in is back (it isn't at the first moment of a
  // page load), so the server sees who you are.
  const { user, isUserLoading } = useFirebase() as any;
  const ready = mode === 'key' || (mode === 'me' && !isUserLoading);
  useEffect(() => { if (!mode || !ready) return; void load(true); const i = setInterval(() => void load(), POLL_MS); return () => clearInterval(i); }, [mode, key, ready, user, load]);

  const act = async <T,>(go: () => Promise<T>) => { acted.current++; try { return await go(); } finally { acted.current++; } };
  const step = async (r: Req, s: 'ack' | 'done' | 'backup' | 'unbackup') => {
    setBusy(`${r.id}${s}`); setNotice('');
    const { status, d } = await act(() => post('/api/floor', { action: 'request', id: r.id, step: s, ...pass() }));
    setBusy(null);
    if (!d.ok) setNotice(status === 0 ? 'No connection. Try again in a moment.' : d.error || 'That didn’t go through.');
    else if (d.already && s === 'ack') { const meName = modeRef.current === 'me' ? data?.staff?.name : staffRef.current?.name; setNotice(d.done ? 'That one’s already done.' : d.who && d.who === meName ? 'You’re on it.' : `${first(d.who) || 'Someone'} is already on the way.`); }
    void load(true);
  };
  const run = async (t: Ticket, s: 'carry' | 'drop' | 'deliver') => {
    setBusy(`${t.id}${s}`); setNotice('');
    const { status, d } = await act(() => post('/api/kitchen', { action: 'act', col: t.col, id: t.id, step: s, ...pass() }));
    setBusy(null);
    if (!d.ok) setNotice(status === 0 ? 'No connection. Try again in a moment.' : d.error || 'That didn’t go through.');
    else if (d.already && s === 'carry') setNotice(`Someone already has ${t.item} for ${first(t.name)}.`);
    void load(true);
  };
  const arrive = async (g: Guest) => {
    const here = !g.here; setBusy(g.id);
    setHeld((h) => ({ ...h, [g.id]: { here, until: Date.now() + HOLD_MS } }));
    const { status, d } = await act(() => post('/api/floor', { action: 'arrive', guestId: g.id, here, ...pass() }));
    setBusy(null);
    if (!d.ok) { setHeld((h) => { const n = { ...h }; delete n[g.id]; return n; }); setNotice(status === 0 ? 'No connection. Try again in a moment.' : d.error || 'That didn’t go through.'); }
    else setHeld((h) => ({ ...h, [g.id]: { here, until: Date.now() + HOLD_MS } }));
    void load(true);
  };
  // Picking tables, one change at a time (in the order tapped), shown at once and put back if it didn't save.
  const toggleMine = (tableId: string) => {
    if (!data?.event) return;
    const eventId = data.event.id; const was = data.mine;
    const next = was.includes(tableId) ? was.filter((x) => x !== tableId) : [...was, tableId];
    setData((cur) => (cur ? { ...cur, mine: next } : cur));
    mineChain.current = mineChain.current.then(async () => {
      const { d } = await act(() => post('/api/floor', { action: 'mytables', eventId, tableIds: next.filter((id) => !data.tables.find((t) => t.id === id)?.chartStaffIds.includes(staffRef.current?.id || data.staff?.id || '')), ...pass() }));
      if (!d.ok) { setData((cur) => (cur ? { ...cur, mine: was } : cur)); setNotice(d.error || 'That didn’t save. Try again.'); }
      void load(true);
    });
  };
  const signIn = async (pin: string): Promise<string | null> => {
    const { d } = await post('/api/kitchen', { action: 'pin', pin });
    if (!d.ok) return d.error || 'That PIN isn’t right.';
    setStaff({ id: d.staff.id, name: d.staff.name, pass: d.pass }); setPinOpen(false); acted.current++; void load(true); return null;
  };
  const toggleSound = () => { const m = !muted; setMuted(m); write('cf.floor.sound', m ? 'off' : null); if (!m) void wakeSound().then(setSoundOk); };

  // What's on the board, worked out.
  const view = useMemo(() => {
    if (!data) return null;
    const at = Date.now();
    const guests = data.guests.map((g) => (held[g.id] && held[g.id].until > at ? { ...g, here: held[g.id].here } : g));
    const tableOf = (r: { tableId: string | null }) => (r.tableId ? data.tables.find((t) => t.id === r.tableId) || null : null);
    const nameOf = (id: string) => data.team.find((s) => s.id === id)?.name || null;
    const mineIds = new Set(data.mine);
    const inMine = (r: { tableId: string | null }) => !r.tableId || mineIds.has(r.tableId) || !(tableOf(r)?.staffIds.length);
    const open = data.requests.filter((r) => r.status !== 'done').filter((r) => !onlyMine || inMine(r));
    const done = data.requests.filter((r) => r.status === 'done').sort((a, b) => String(b.resolvedAt).localeCompare(String(a.resolvedAt))).slice(0, 6);
    const ready = data.ready.filter((t) => !onlyMine || inMine(t));
    const guestsAt = (t: Table) => guests.filter((g) => g.tableId === t.id);
    const unseated = guests.filter((g) => !g.tableId);
    const here = guests.filter((g) => g.here).length;
    const severe = guests.filter((g) => g.allergies.some((a) => a.severe));
    return { tableOf, nameOf, open, done, ready, guests, guestsAt, unseated, here, mineIds, severe };
  }, [data, onlyMine, held, now]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!started) return <div className="min-h-dvh" style={{ background: SOFT }} />;
  if (!mode) return <Setup tenantId={tenantId} stopped={stopped}
    onPaired={(k) => { write(keyName(tenantId), k); setKey(k); setMode('key'); setStopped(''); seen.current = null; }}
    onMe={() => { swrite(`cf.floor.me.${tenantId}`, '1'); setStaff(null); setMode('me'); setStopped(''); seen.current = null; }} />;
  if (closed) return <main className="min-h-dvh flex items-center justify-center p-6" style={{ background: SOFT, color: INK }}><p className="max-w-md rounded-3xl border bg-[#fff] p-6 text-center text-[16px]" style={{ borderColor: LINE }}>{closed}</p></main>;
  if (!data || !view) return <main className="min-h-dvh flex items-center justify-center" style={{ background: SOFT }}><span className="h-8 w-8 rounded-full border-[3px] animate-spin" style={{ borderColor: LINE, borderTopColor: INK }} role="status" aria-label="Loading the floor board" /></main>;

  const offline = lastOk > 0 && now - lastOk > 15000;
  const ev = data.event; const total = view.guests.length;
  const me = mode === 'me' ? data.staff : staff;
  const said = ev?.message && heard !== (ev.message.at || ev.message.text) ? ev.message : null;
  const sheetTable = openTable && openTable !== '-' ? data.tables.find((t) => t.id === openTable) || null : null;
  const mapped = data.tables.length > 0 && data.tables.every((t) => t.x !== null && t.y !== null);

  const tableCard = (t: Table, style?: React.CSSProperties) => {
    const gs = view.guestsAt(t); const herePeople = gs.filter((g) => g.here).length; const asks = data.requests.filter((r) => r.status !== 'done' && r.tableId === t.id).length;
    const allergies = gs.filter((g) => g.allergies.length).length; const mine = view.mineIds.has(t.id);
    const owners = t.staffIds.map(view.nameOf).filter(Boolean) as string[];
    return (
      <button key={t.id} type="button" onClick={() => setOpenTable(t.id)} className={`flex flex-col justify-between gap-2 rounded-2xl p-3 text-left ${ring}`}
        style={{ ...style, border: asks ? `2px solid ${AMBER}` : `1px solid ${LINE}`, background: asks ? AMBER_TINT : '#fff', opacity: onlyMine && !mine ? 0.45 : 1 }}
        aria-label={`${t.name}: ${herePeople} of ${gs.length} here${asks ? `, ${asks} asking` : ''}${allergies ? `, ${allergies} with allergies` : ''}${mine ? ', yours' : ''}`}>
        <span className="flex items-baseline justify-between gap-2"><span className="truncate text-[15px] font-semibold" style={{ color: asks ? AMBER : INK }}>{t.name}</span>{mine && <span className="text-[12px] font-semibold" style={{ color: GREEN }}>Yours</span>}</span>
        <span className="flex flex-wrap gap-1.5" aria-hidden>{(gs.length ? gs : t.seats.map((s) => ({ id: s.id, here: false, allergies: [] as Allergy[] }))).slice(0, 12).map((g: any) => (
          <span key={g.id} className="h-3.5 w-3.5 rounded-full box-border" style={{ background: g.here ? INK : '#fff', border: g.here ? 'none' : '2px solid #9a9ca1', boxShadow: g.allergies?.length ? `0 0 0 2px #fff, 0 0 0 4px ${AMBER}` : undefined }} />))}</span>
        <span className="text-[13px]" style={{ color: asks ? AMBER : MUTED, fontWeight: asks ? 600 : 400 }}>{asks ? `${asks} asking, ${herePeople} of ${gs.length || t.seats.length} here` : `${herePeople} of ${gs.length || t.seats.length} here`}{owners.length && !asks ? `, ${first(owners[0])}` : ''}</span>
      </button>
    );
  };
  const notSeated = view.unseated.length > 0 && (
    <button type="button" onClick={() => setOpenTable('-')} className={`flex min-h-[44px] w-full items-center justify-between gap-3 rounded-2xl border border-dashed px-4 py-3 text-left ${ring}`} style={{ borderColor: '#c9cbcf', background: '#fff' }}>
      <span className="text-[15px] font-semibold">Not at a table</span>
      <span className="text-[14px]" style={{ color: MUTED }}>{view.unseated.filter((g) => g.here).length} of {view.unseated.length} here</span>
    </button>
  );

  return (
    <div className="min-h-dvh flex flex-col" style={{ background: SOFT, color: INK, fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif" }}>
      <header className="sticky top-0 z-30 flex flex-wrap items-center gap-x-6 gap-y-3 border-b bg-[#fff] px-4 py-3 sm:px-6" style={{ borderColor: LINE }}>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-[20px] font-semibold tracking-tight">{ev ? ev.title : 'Floor'}</h1>
          <p className="text-[13.5px]" style={{ color: MUTED }}>{ev ? `${ev.running ? 'Running now' : 'Today'}${ev.time ? `, from ${ev.time}` : ''}` : data.business.name}</p>
        </div>
        {ev && total > 0 && <div className="w-44 sm:w-48">
          <div className="flex justify-between text-[13.5px]"><span style={{ color: MUTED }}>Arrived</span><b className="font-semibold tabular-nums">{view.here} of {total}</b></div>
          <div className="mt-1.5 h-2 overflow-hidden rounded-full" style={{ background: LINE }}><div className="h-2" style={{ width: `${Math.round((view.here / total) * 100)}%`, background: GREEN }} /></div>
        </div>}
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={toggleSound} aria-pressed={!muted} className={btn} style={{ background: '#fff', border: `1px solid ${LINE}`, color: muted ? MUTED : INK, textDecoration: muted ? 'line-through' : undefined }}>Sound</button>
          {me && data.mine.length > 0 && <button type="button" onClick={() => setOnlyMine(!onlyMine)} aria-pressed={onlyMine} className={btn} style={onlyMine ? { background: INK, color: '#fff' } : { background: '#fff', border: `1px solid ${LINE}` }}>My tables</button>}
          {mode === 'me'
            ? <span className="inline-flex min-h-[44px] items-center rounded-xl px-4 text-[14.5px] font-semibold" style={{ background: GREEN_TINT, color: GREEN }}>{first(data.staff?.name) || 'You'}</span>
            : staff
              ? <button type="button" onClick={() => setStaff(null)} className={`${btn} inline-flex items-center gap-2`} style={{ background: GREEN_TINT, color: GREEN }} aria-label={`${staff.name} is working. Sign out.`}>{first(staff.name)}<span className="text-[13px] font-medium" style={{ color: '#3f6b55' }}>Sign out</span></button>
              : <button type="button" onClick={() => setPinOpen(true)} className={btn} style={{ background: INK, color: '#fff' }}>Who’s working?</button>}
        </div>
      </header>

      {(offline || notice || (!soundOk && !muted) || said || (ev && view.severe.length > 0)) && <div className="px-4 pt-3 sm:px-6 space-y-2">
        {offline && <p role="status" className="rounded-2xl px-4 py-2.5 text-[14px] font-medium" style={{ background: AMBER_TINT, color: AMBER }}>Can’t reach the internet. What’s here may be out of date.</p>}
        {said && <div className="flex items-center gap-3 rounded-2xl py-1.5 pl-4 pr-1.5" style={{ background: INK, color: '#fff' }}><p className="flex-1 text-[15px] font-medium">{said.text}</p><button type="button" onClick={() => { const k = said.at || said.text; setHeard(k); swrite('cf.floor.heard', k); }} className={`min-h-[44px] rounded-xl px-3 text-[14px] font-semibold ${ring}`} style={{ background: 'rgba(255,255,255,0.12)' }}>Got it</button></div>}
        {notice && <div role="alert" className="flex items-center gap-3 rounded-2xl py-1 pl-4 pr-1" style={{ background: AMBER_TINT, color: AMBER }}><p className="flex-1 text-[14px] font-medium">{notice}</p><button type="button" onClick={() => setNotice('')} aria-label="Dismiss" className={`h-11 w-11 shrink-0 rounded-xl text-[18px] ${ring}`}>×</button></div>}
        {ev && view.severe.length > 0 && <p className="rounded-2xl px-4 py-2.5 text-[14px]" style={{ background: '#fff', border: `1px solid ${AMBER}`, color: INK }}>
          <b className="font-semibold" style={{ color: AMBER }}>Severe allergies tonight: </b>
          {view.severe.map((g) => `${g.allergies.filter((a) => a.severe).map((a) => a.label).join(', ')}, ${first(g.name)}${g.table ? ` at ${g.table}${g.seat ? ` seat ${g.seat}` : ''}` : ''}`).join('. ')}.
        </p>}
        {!soundOk && !muted && <p className="rounded-2xl px-4 py-2.5 text-[14px]" style={{ background: '#fff', border: `1px solid ${LINE}`, color: MUTED }}>Tap anywhere to turn on the sound for new requests.</p>}
      </div>}

      <div className="flex-1 grid gap-5 p-4 sm:p-6 lg:grid-cols-[minmax(0,420px)_minmax(0,1fr)]">
        <div className="space-y-5 min-w-0">
          <section aria-labelledby="asks" className="space-y-3">
            <div className="flex items-center justify-between"><h2 id="asks" className="text-[17px] font-semibold">Needs someone</h2>
              <span className="min-w-[28px] rounded-full px-2 py-0.5 text-center text-[14px] font-semibold tabular-nums" style={view.open.length ? { background: AMBER, color: '#fff' } : { background: '#fff', color: MUTED, border: `1px solid ${LINE}` }}>{view.open.length}</span></div>
            {view.open.length === 0 && <p className="rounded-2xl border border-dashed bg-[#fff] px-4 py-6 text-center text-[15px]" style={{ borderColor: LINE, color: MUTED }}>All quiet. New requests from the seats show here.</p>}
            {view.open.map((r) => {
              const t = view.tableOf(r); const m = mins(r.createdAt, now); const late = r.urgent || r.escalated; const owners = (t?.staffIds || []).map(view.nameOf).filter(Boolean) as string[];
              const severe = r.allergies.some((a) => a.severe); const yours = !!me && !!t?.staffIds.includes(me.id);
              const whose = r.status === 'acknowledged' ? `${first(r.by) || 'Someone'} is on the way` : !t ? 'Anyone free can take this'
                : yours ? (owners.length > 1 ? `Your table, with ${owners.filter((o) => o !== view.nameOf(me!.id)).map(first).join(' and ')}` : 'Your table')
                : owners.length ? `${owners.map(first).join(' and ')}’s table` : 'Nobody looks after this table';
              return (
                <article key={r.id} className="space-y-2.5 rounded-2xl bg-[#fff] p-4" style={{ border: late && r.status === 'new' ? `2px solid ${AMBER}` : `1px solid ${LINE}` }}>
                  <div className="flex items-baseline justify-between gap-3">
                    <p className="text-[17px] font-semibold">{r.label}</p>
                    <span className="shrink-0 text-[14px] font-semibold tabular-nums" style={{ color: late && r.status === 'new' ? AMBER : MUTED }}>{r.escalated ? `Urgent, ${ago(m)}` : ago(m)}</span>
                  </div>
                  <p className="text-[15px]">{[t?.name || r.table, r.seat ? `seat ${r.seat}` : ''].filter(Boolean).join(', ') || 'No table given'}{r.guest ? `, ${first(r.guest)}` : ''}</p>
                  {r.note && <p className="text-[14.5px]" style={{ color: MUTED }}>“{r.note}”</p>}
                  {r.allergies.length > 0 && <p className="rounded-lg px-2.5 py-1.5 text-[13.5px] font-semibold" style={severe ? { background: AMBER, color: '#fff' } : { background: AMBER_TINT, color: AMBER }}>{severe ? 'Severe allergy' : 'Allergy'}: {r.allergies.map((a) => a.label).join(', ')}</p>}
                  <p className="text-[13.5px]" style={{ color: t && !owners.length && r.status === 'new' ? AMBER : MUTED }}>{whose}{r.needsBackup ? '. Needs backup' : ''}</p>
                  <div className="flex gap-2">
                    {r.status === 'new'
                      ? <button type="button" onClick={() => step(r, 'ack')} disabled={!!busy} className={`${btn} flex-1`} style={{ background: INK, color: '#fff' }}>On my way</button>
                      : <button type="button" onClick={() => step(r, 'done')} disabled={!!busy} className={`${btn} flex-1`} style={{ background: GREEN, color: '#fff' }}>Done</button>}
                    <button type="button" onClick={() => step(r, r.needsBackup ? 'unbackup' : 'backup')} disabled={!!busy} aria-pressed={r.needsBackup} className={btn} style={r.needsBackup ? { background: AMBER_TINT, color: AMBER, border: `1px solid ${AMBER}` } : { background: '#fff', border: `1px solid ${LINE}` }}>{r.needsBackup ? 'Backup asked' : 'Need backup'}</button>
                  </div>
                </article>);
            })}
          </section>

          {ev && <section aria-labelledby="run" className="space-y-3">
            <div className="flex items-center justify-between"><h2 id="run" className="text-[17px] font-semibold">Ready to run</h2>
              <span className="min-w-[28px] rounded-full px-2 py-0.5 text-center text-[14px] font-semibold tabular-nums" style={view.ready.length ? { background: GREEN, color: '#fff' } : { background: '#fff', color: MUTED, border: `1px solid ${LINE}` }}>{view.ready.length}</span></div>
            {view.ready.length === 0 && <p className="rounded-2xl border border-dashed bg-[#fff] px-4 py-6 text-center text-[15px]" style={{ borderColor: LINE, color: MUTED }}>Nothing waiting at the pass.</p>}
            {view.ready.map((t) => {
              const m = mins(t.readyAt || t.at, now); const flags = allergyFlags(t);
              return (
                <article key={t.id} className="space-y-2 rounded-2xl bg-[#fff] p-4" style={{ border: m < 1 ? `2px solid ${GREEN}` : `1px solid ${LINE}` }}>
                  <div className="flex items-baseline justify-between gap-3"><p className="text-[16px] font-semibold">{t.item}{t.quantity > 1 ? ` × ${t.quantity}` : ''}</p><span className="text-[13.5px] font-semibold tabular-nums" style={{ color: m < 1 ? GREEN : MUTED }}>{ago(m)}</span></div>
                  <p className="text-[15px]">{t.tableNumber ? [t.tableNumber, t.seatNumber ? `seat ${t.seatNumber}` : ''].filter(Boolean).join(', ') : t.station}{t.name ? `, ${first(t.name)}` : ''}</p>
                  {t.note && <p className="text-[14px]" style={{ color: MUTED }}>{t.note}</p>}
                  {flags.any && <p className="rounded-lg px-2.5 py-1.5 text-[13.5px] font-semibold" style={flags.severe ? { background: AMBER, color: '#fff' } : { background: AMBER_TINT, color: AMBER }}>{flags.severe ? 'Severe allergy' : 'Allergy'}: {flags.listed.map((a) => a.name).join(', ') || flags.mentions.join('. ')}</p>}
                  <div className="flex gap-2">
                    {t.carriedBy
                      ? <span className="flex flex-1 flex-wrap items-center justify-between gap-x-2 rounded-xl py-1 pl-3 pr-1 text-[14px] font-semibold" style={{ background: GREEN_TINT, color: GREEN }}>{first(t.carriedBy)} is taking it<button type="button" onClick={() => run(t, 'drop')} disabled={!!busy} className={`min-h-[44px] rounded-lg px-3 text-[13.5px] underline ${ring}`}>Let someone else</button></span>
                      : <button type="button" onClick={() => run(t, 'carry')} disabled={!!busy} className={`${btn} flex-1`} style={{ background: INK, color: '#fff' }}>I’ll take it</button>}
                    <button type="button" onClick={() => run(t, 'deliver')} disabled={!!busy} className={btn} style={{ background: '#fff', border: `1px solid ${LINE}` }}>Served</button>
                  </div>
                </article>);
            })}
          </section>}

          {view.done.length > 0 && <section aria-labelledby="done" className="space-y-2">
            <h2 id="done" className="text-[15px] font-semibold" style={{ color: MUTED }}>Done lately</h2>
            <ul className="space-y-1.5">{view.done.map((r) => (
              <li key={r.id} className="flex items-baseline justify-between gap-3 rounded-xl bg-[#fff] px-3 py-2 text-[14px]" style={{ border: `1px solid ${LINE}` }}>
                <span className="min-w-0 truncate">{r.label}, {view.tableOf(r)?.name || r.table || 'no table'}{r.seat ? ` seat ${r.seat}` : ''}</span>
                <span className="shrink-0" style={{ color: MUTED }}>{first(r.resolvedBy) || 'Done'}, {ago(mins(r.resolvedAt, now))} ago</span>
              </li>))}</ul>
          </section>}
        </div>

        <section aria-labelledby="tables" className="min-w-0 space-y-3 self-start rounded-3xl border bg-[#fff] p-4 sm:p-5 lg:sticky lg:top-[92px]" style={{ borderColor: LINE }}>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 id="tables" className="text-[17px] font-semibold">Tables</h2>
            {data.tables.length > 0 && ev && <div className="flex flex-wrap gap-4 text-[13px]" style={{ color: '#4b4e54' }} aria-hidden>
              <span className="flex items-center gap-1.5"><span className="h-3 w-3 rounded-full" style={{ background: INK }} />Here</span>
              <span className="flex items-center gap-1.5"><span className="h-3 w-3 rounded-full box-border" style={{ border: '2px solid #9a9ca1' }} />Not here yet</span>
              <span className="flex items-center gap-1.5"><span className="h-3 w-3 rounded-full" style={{ background: INK, boxShadow: `0 0 0 2px #fff, 0 0 0 4px ${AMBER}` }} />Allergy</span>
            </div>}
          </div>
          {!ev ? <p className="py-10 text-center text-[15px]" style={{ color: MUTED }}>No event today. When one starts, its tables show here.</p>
            : data.tables.length === 0 ? <><p className="py-8 text-center text-[15px]" style={{ color: MUTED }}>This event has no seating chart yet. Add tables from the event’s guest list.</p>{notSeated}</>
            : <>
              {mapped && <div className="relative hidden w-full overflow-hidden rounded-2xl sm:block" style={{ aspectRatio: '16 / 10', minHeight: 420, background: SOFT }}>
                {data.tables.map((t) => tableCard(t, { position: 'absolute', left: `${Math.min(78, Math.max(0, t.x || 0))}%`, top: `${Math.min(68, Math.max(0, t.y || 0))}%`, width: '21%' }))}
              </div>}
              <div className={`grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4 ${mapped ? 'sm:hidden' : ''}`}>{data.tables.map((t) => tableCard(t))}</div>
              {notSeated}
            </>}
          {ev && mode === 'key' && !staff && data.tables.length > 0 && <p className="text-[13.5px]" style={{ color: MUTED }}>Enter your PIN to pick the tables you look after tonight.</p>}
        </section>
      </div>

      {pinOpen && <PinSheet onClose={() => setPinOpen(false)} onPin={signIn} />}
      {openTable === '-' && <GuestSheet title="Not at a table" table={null} guests={view.unseated} mine={false} fixed={false} canPick={false} busy={busy}
        onArrive={arrive} onMine={() => {}} onClose={() => setOpenTable(null)} />}
      {sheetTable && <GuestSheet title={sheetTable.name} table={sheetTable} guests={view.guestsAt(sheetTable)} mine={view.mineIds.has(sheetTable.id)} fixed={!!me && sheetTable.chartStaffIds.includes(me.id)}
        canPick={!!me} busy={busy} onArrive={arrive} onMine={() => toggleMine(sheetTable.id)} onClose={() => setOpenTable(null)} />}
    </div>
  );
}
