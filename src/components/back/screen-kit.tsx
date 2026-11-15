'use client';
// src/components/back/screen-kit.tsx — WHAT THE DISH AND BARBACK SCREENS SHARE (design canvas "Dish and barback"; /dish,
// /barback, api/back). They run like the floor board: on a shared tablet with the key of a kitchen screen a manager set
// up (the same set-up: a tablet set up for one opens the others), where a PIN only puts a name on what's done; or on a
// team member's own phone, signed in as themselves. Here: the set-up page, the PIN pad, a sheet over the screen, a soft
// chime (browsers allow sound only after a tap), and the hook that reads the screen every few seconds and acts through
// api/back.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useFirebase } from '@/firebase';
import { useT } from '@/components/kitchen/ScreenLang';

export const INK = '#16171a', MUTED = '#6d7075', LINE = '#ececee', SOFT = '#f5f5f7', GREEN = '#1f7a4d', GREEN_TINT = '#ecf6f0', AMBER = '#b45309', AMBER_TINT = '#fff7ed', RED = '#b42318';
export const ring = 'outline-none focus-visible:ring-2 focus-visible:ring-[#16171a] focus-visible:ring-offset-2';
export const btn = `min-h-[44px] rounded-xl px-4 text-[14.5px] font-semibold disabled:opacity-50 ${ring}`;
export const big = `min-h-[56px] rounded-2xl px-4 text-[16.5px] font-semibold disabled:opacity-50 ${ring}`;
export const first = (n: string | null | undefined) => String(n || '').trim().split(/\s+/)[0] || '';
export const minsSince = (iso: string | null | undefined, now: number) => { const t = Date.parse(String(iso || '')); return Number.isFinite(t) ? Math.max(0, Math.floor((now - t) / 60000)) : 0; };
export const clockOf = (iso: string | null | undefined) => { const t = Date.parse(String(iso || '')); return Number.isFinite(t) ? new Date(t).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }).replace(' AM', ' am').replace(' PM', ' pm') : ''; };

const WAIT_MS = 8000;
const keyName = (t: string) => `cf.kitchen.${t}`;   // the same set-up as the kitchen screen and the floor board
const read = (k: string) => { try { return localStorage.getItem(k); } catch { return null; } };
const write = (k: string, v: string | null) => { try { if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch { /* private window */ } };
const sread = (k: string) => { try { return sessionStorage.getItem(k); } catch { return null; } };
const swrite = (k: string, v: string | null) => { try { if (v === null) sessionStorage.removeItem(k); else sessionStorage.setItem(k, v); } catch { /* private window */ } };

// ─── Sound ───
let audio: AudioContext | null = null;
export async function wakeSound(): Promise<boolean> {
  try {
    const AC: any = (window as any).AudioContext || (window as any).webkitAudioContext; if (!AC) return false;
    if (!audio) audio = new AC();
    if (audio!.state !== 'running') await audio!.resume();
    return audio!.state === 'running';
  } catch { return false; }
}
export function chime() {
  const ctx = audio; if (!ctx || ctx.state !== 'running') return;
  for (const [f, at] of [[740, 0], [990, 0.14]] as const) {
    const o = ctx.createOscillator(); const g = ctx.createGain(); o.connect(g); g.connect(ctx.destination);
    o.frequency.setValueAtTime(f, ctx.currentTime + at); g.gain.setValueAtTime(0.0001, ctx.currentTime + at);
    g.gain.linearRampToValueAtTime(0.25, ctx.currentTime + at + 0.01); g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + at + 0.35);
    o.start(ctx.currentTime + at); o.stop(ctx.currentTime + at + 0.4);
  }
}

// ─── A sheet over the screen ───
// Focus goes in once when it opens, stays inside while it's open, and goes back to what opened it.
export function Sheet({ label, onClose, wide, children }: { label: string; onClose: () => void; wide?: boolean; children: React.ReactNode }) {
  const box = useRef<HTMLDivElement | null>(null);
  const close = useRef(onClose); close.current = onClose;
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    box.current?.querySelector<HTMLElement>('input, textarea, button')?.focus();
    const was = document.body.style.overflow; document.body.style.overflow = 'hidden';
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { close.current(); return; }
      if (e.key !== 'Tab' || !box.current) return;
      const all = Array.from(box.current.querySelectorAll<HTMLElement>('button:not([disabled]), input, textarea, a[href]'));
      if (!all.length) return;
      const at = all.indexOf(document.activeElement as HTMLElement);
      if (at < 0) { e.preventDefault(); (e.shiftKey ? all[all.length - 1] : all[0]).focus(); return; }
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
export function CloseX({ onClose }: { onClose: () => void }) {
  const say = useT();
  return <button type="button" onClick={onClose} aria-label={say('Close')} className={`h-11 w-11 shrink-0 rounded-full border text-[20px] ${ring}`} style={{ borderColor: LINE }}>×</button>;
}
export function SheetHead({ title, line, onClose }: { title: string; line?: string; onClose: () => void }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div><h2 className="text-[20px] font-semibold">{title}</h2>{line && <p className="text-[14px] mt-1" style={{ color: MUTED }}>{line}</p>}</div>
      <CloseX onClose={onClose} />
    </div>
  );
}

// ─── Setting the tablet up ───
export function Setup({ tenantId, title, line, place, stopped, onPaired, onMe }: { tenantId: string; title: string; line: string; place: string; stopped: string; onPaired: (key: string) => void; onMe: () => void }) {
  const { user, isUserLoading } = useFirebase() as any;
  const [name, setName] = useState(place); const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  const pair = async () => {
    setBusy(true); setErr('');
    try {
      const r = await fetch('/api/kitchen', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'pair', tenantId, name, kind: 'kitchen' }) });
      const d = await r.json().catch(() => ({}));
      if (d.ok && d.key) onPaired(String(d.key)); else setErr(d.error || 'That didn’t go through. Try again.');
    } catch { setErr('No connection. Try again.'); }
    setBusy(false);
  };
  const next = typeof window !== 'undefined' ? `${window.location.pathname}${window.location.search}` : '/';
  return (
    <main className="min-h-dvh flex items-center justify-center p-4" style={{ background: SOFT, color: INK }}>
      <div className="w-full max-w-md rounded-3xl bg-[#fff] p-6 space-y-4 border" style={{ borderColor: LINE }}>
        <div>
          <h1 className="text-[24px] font-semibold tracking-tight">{title}</h1>
          <p className="text-[15px] mt-1.5 leading-relaxed" style={{ color: MUTED }}>{line}</p>
        </div>
        {stopped && <p className="rounded-2xl px-4 py-3 text-[14px]" style={{ background: AMBER_TINT, color: AMBER }}>{stopped}</p>}
        {isUserLoading ? <div className="h-7 w-7 rounded-full border-[3px] animate-spin mx-auto" style={{ borderColor: LINE, borderTopColor: INK }} role="status" aria-label="Loading" />
          : user ? (
            <div className="space-y-3">
              <label className="block"><span className="text-[14px] font-medium">Name this tablet</span>
                <input value={name} onChange={(e) => setName(e.target.value.slice(0, 40))} className="mt-1.5 w-full min-h-[44px] rounded-xl border px-3 text-[16px] outline-none focus:border-[#16171a]" style={{ borderColor: LINE }} /></label>
              {err && <p role="alert" className="text-[14px]" style={{ color: AMBER }}>{err}</p>}
              <button type="button" onClick={pair} disabled={busy} className={`${btn} w-full`} style={{ background: INK, color: '#fff' }}>{busy ? 'Setting up…' : 'Set up this tablet for the team'}</button>
              <p className="text-[13px]" style={{ color: MUTED }}>Signed in as {user.email || 'you'}. Only an owner or manager can set up a shared tablet. A tablet already set up for the kitchen screen opens this too.</p>
              <div className="border-t pt-3" style={{ borderColor: LINE }}>
                <button type="button" onClick={onMe} className={`${btn} w-full`} style={{ background: '#fff', color: INK, border: `1px solid ${LINE}` }}>Just use it as me, on this device</button>
              </div>
            </div>
          ) : <a href={`/login?next=${encodeURIComponent(next)}`} className={`${btn} w-full inline-flex items-center justify-center`} style={{ background: INK, color: '#fff' }}>Sign in</a>}
      </div>
    </main>
  );
}

// ─── Who's working ───
export function PinSheet({ onClose, onPin }: { onClose: () => void; onPin: (pin: string) => Promise<string | null> }) {
  const say = useT();
  const [pin, setPin] = useState(''); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const press = async (k: string) => {
    if (busy) return;
    if (k === 'del') { setPin((p) => p.slice(0, -1)); return; }
    const next = (pin + k).slice(0, 4); setPin(next); setErr('');
    if (next.length === 4) { setBusy(true); const e = await onPin(next); setBusy(false); if (e) { setErr(e); setPin(''); } }
  };
  return (
    <Sheet label={say('Who’s working?')} onClose={onClose}>
      <SheetHead title={say('Who’s working?')} line={say('Your PIN puts your name on what you do.')} onClose={onClose} />
      <div className="flex justify-center gap-3" role="img" aria-label={say('{n} of 4 digits entered', { n: pin.length })}>{[0, 1, 2, 3].map((i) => <span key={i} className="h-4 w-4 rounded-full" style={{ background: i < pin.length ? INK : LINE }} />)}</div>
      <p role="alert" className="min-h-5 text-center text-[14px] font-medium" style={{ color: AMBER }}>{err}</p>
      <div className="grid grid-cols-3 gap-2">{['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', 'del'].map((k, i) => k === '' ? <span key={i} /> : (
        <button key={i} type="button" onClick={() => press(k)} disabled={busy} aria-label={k === 'del' ? say('Delete') : k} className={`h-16 rounded-2xl text-[22px] font-semibold ${ring}`} style={{ background: SOFT }}>{k === 'del' ? '⌫' : k}</button>))}</div>
    </Sheet>
  );
}

// ─── Reading and acting ───
export type Staff = { id: string; name: string; pass: string };
type Mode = 'key' | 'me';
/** The screen's state and its calls to api/back: `view` is what it reads every `pollMs` ('dish' or 'barback'). New
 *  ids from `fresh(d)` (calls that just came in) chime once each, never the ones already up when it opened. */
export function useBackScreen<D>(tenantId: string, view: string, fresh: (d: D) => string[], pollMs = 10000) {
  const [mode, setMode] = useState<Mode | null>(null); const [key, setKey] = useState<string | null>(null);
  const [started, setStarted] = useState(false); const [data, setData] = useState<D | null>(null);
  const [stopped, setStopped] = useState(''); const [closed, setClosed] = useState('');
  const [staff, setStaffState] = useState<Staff | null>(null); const [lastOk, setLastOk] = useState(0);
  const [soundOk, setSoundOk] = useState(false); const [now, setNow] = useState(() => Date.now());
  const keyRef = useRef<string | null>(null); const modeRef = useRef<Mode | null>(null); const staffRef = useRef<Staff | null>(null);
  keyRef.current = key; modeRef.current = mode; staffRef.current = staff;
  const seen = useRef<Set<string> | null>(null); const acted = useRef(0); const asked = useRef(0); const loading = useRef(false); const retried = useRef(false);
  const freshRef = useRef(fresh); freshRef.current = fresh;

  useEffect(() => {
    const k = read(keyName(tenantId));
    if (k) { setKey(k); setMode('key'); } else if (sread(`cf.back.me.${tenantId}`)) setMode('me');
    try { const s = JSON.parse(sread('cf.kitchen.staff') || 'null'); if (s?.name && s?.pass) setStaffState(s); } catch { /* */ }
    setStarted(true);
    const unlock = () => { void wakeSound().then(setSoundOk); };
    for (const ev of ['click', 'touchend', 'keydown']) window.addEventListener(ev, unlock, { passive: true });
    let lock: any = null;
    const awake = async () => { try { if (document.visibilityState === 'visible' && (navigator as any).wakeLock) lock = await (navigator as any).wakeLock.request('screen'); } catch { /* not allowed here */ } };
    const back = () => { if (document.visibilityState === 'visible') void awake(); };
    void awake(); document.addEventListener('visibilitychange', back);
    const i = setInterval(() => setNow(Date.now()), 15000);
    return () => { for (const ev of ['click', 'touchend', 'keydown']) window.removeEventListener(ev, unlock); document.removeEventListener('visibilitychange', back); clearInterval(i); try { lock?.release?.(); } catch { /* */ } };
  }, [tenantId]);

  const post = useCallback(async (url: string, body: any) => {
    const stop = new AbortController(); const t = setTimeout(() => stop.abort(), WAIT_MS);
    try {
      const withKey = modeRef.current === 'key' && keyRef.current ? { key: keyRef.current } : {};
      const withPass = modeRef.current === 'key' && staffRef.current ? { staffPass: staffRef.current.pass } : {};
      const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tenantId, ...withKey, ...withPass, ...body }), signal: stop.signal });
      return { status: r.status, d: await r.json().catch(() => ({})) as any };
    } catch { return { status: 0, d: {} as any }; } finally { clearTimeout(t); }
  }, [tenantId]);
  const setStaff = (s: Staff | null) => { staffRef.current = s; setStaffState(s); swrite('cf.kitchen.staff', s ? JSON.stringify(s) : null); };
  const forget = useCallback((why: string) => {
    if (modeRef.current === 'key') write(keyName(tenantId), null);
    swrite(`cf.back.me.${tenantId}`, null);
    setKey(null); setMode(null); setData(null); seen.current = null; retried.current = false; setStopped(why);
  }, [tenantId]);

  const load = useCallback(async (force?: boolean) => {
    if (!modeRef.current || (loading.current && force !== true)) return;
    loading.current = true;
    const mine = ++asked.current; const before = acted.current;
    const { status, d } = await post('/api/back', { action: view });
    loading.current = false;
    if (status === 401) {
      if (modeRef.current === 'me' && !retried.current) { retried.current = true; setTimeout(() => void load(true), 1500); return; }
      forget(modeRef.current === 'me' ? 'Please sign in again.' : d.error || 'This tablet was stopped. A manager can set it up again.'); return;
    }
    retried.current = false;
    if (status === 403 && !d.closed) { forget(d.error || 'This is for the business’s own team.'); return; }
    if (d.closed) { setClosed(d.error); return; }
    if (!d.ok) return;
    if (asked.current !== mine || acted.current !== before) return;
    if (d.staffOk === false) setStaff(null);
    setClosed(''); setLastOk(Date.now());
    const ids = freshRef.current(d as D).filter((x) => !seen.current?.has(x));
    if (seen.current && ids.length) chime();
    seen.current = new Set([...Array.from(seen.current || []), ...ids]);
    setData(d as D);
  }, [post, forget, view]);
  const { user, isUserLoading } = useFirebase() as any;
  const ready = mode === 'key' || (mode === 'me' && !isUserLoading);
  useEffect(() => { if (!mode || !ready) return; void load(true); const i = setInterval(() => void load(), pollMs); return () => clearInterval(i); }, [mode, key, ready, user, load, pollMs]);

  /** One tap's call: a refresh that overlapped it is dropped, and the screen reads again straight after. */
  const act = useCallback(async (body: any) => { acted.current++; try { return await post('/api/back', body); } finally { acted.current++; void load(true); } }, [post, load]);
  const signIn = async (pin: string): Promise<string | null> => {
    const { d } = await post('/api/kitchen', { action: 'pin', pin });
    if (!d.ok) return d.error || 'That PIN isn’t right.';
    setStaff({ id: d.staff.id, name: d.staff.name, pass: d.pass }); acted.current++; void load(true); return null;
  };
  const paired = (k: string) => { write(keyName(tenantId), k); setKey(k); setMode('key'); setStopped(''); };
  const useMe = () => { swrite(`cf.back.me.${tenantId}`, '1'); setMode('me'); setStopped(''); };
  return { mode, started, data, stopped, closed, staff, setStaff, lastOk, soundOk, now, post, act, signIn, paired, useMe, load };
}
