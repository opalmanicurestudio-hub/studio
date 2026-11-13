'use client';
// src/app/drive-thru/[tenantId]/page.tsx — THE DRIVE-THRU LANE (L21). One tablet (or two: the speaker and the window)
// runs the whole lane: a car arrives, its order is taken from the menu in a few taps (choices too), sent to the kitchen
// with a time it has to be ready by, paid at the window (card or cash, with the change worked out), and handed over, or
// parked in a numbered spot so the cars behind keep moving. Every car carries a clock against the lane's target (3:30
// unless the business sets its own), and the top of the screen says how the lane is doing today and where the time goes.
//   Set up once by a manager like the kitchen screen (api/kitchen 'pair', kind 'drive-thru'); from then on the tablet
//   carries its own key and everything goes through api/counter, which prices every line from the menu itself.
//   A PIN (checked by the server) only puts a name on what's done; the screen works without it.
//   With the voice assistant on (api/counter/voice), a car's order can be taken at the speaker by the assistant, and
//   it builds here as it's said: the lane can read along, listen in, take over on its own microphone, or tell the
//   assistant something (components/drive-thru/VoiceBar).

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import { getAuth, signOut } from 'firebase/auth';
import { useFirebase } from '@/firebase';
import { Car, CreditCard, Mic, Minus, Plus, Volume2, VolumeX } from 'lucide-react';
import { ChoicePicker } from '@/components/menu/ChoicePicker';
import { PinPad, type ScreenStaff } from '@/components/kitchen/PinPad';
import { ScreenSetup } from '@/components/drive-thru/ScreenSetup';
import { VoiceBar, useOnTheSpeakerHere, type CarVoice } from '@/components/drive-thru/VoiceBar';
import { defaultPicks, priceChoices, type Picks } from '@/lib/menu-choices';
import { readBack, timeLeft } from '@/lib/counter-orders';
import { outWords } from '@/lib/menu-stock';
import type { MenuItem } from '@/lib/menu-server';

const INK = '#16171a', MUTED = '#6d7075', LINE = '#ececee', SOFT = '#f5f5f7', GREEN = '#1f7a4d', AMBER = '#b45309', RED = '#b42318';
const AMBER_TINT = '#fff7ed', GREEN_TINT = '#ecf6f0';
const POLL_MS = 2000;
const RING = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#16171a] focus-visible:ring-offset-2';

type Stage = 'speaker' | 'pay' | 'pickup' | 'forward';
type Line = { lineId: string; itemId: string; name: string; quantity: number; unitPrice: number; choicesText: string | null };
type Order = { id: string; number: string; status: string; guestName?: string | null; lines: Line[]; subtotal: number; tax: number; taxLabel: string; total: number; paidAt: string | null; payMethod: string | null;
  sentAt: string | null; dueAt: string | null; kitchen: 'not sent' | 'making' | 'ready'; waitingOn: { name: string; quantity: number }[]; readyCount: number; ticketCount: number;
  // The card reader's payment for it (lib/counter-card), if one was started.
  card?: { state: string; failed: string | null; readerId: string | null; at: string | null } | null };
type Reader = { id: string; label: string; online: boolean; test: boolean };
// A card payment the reader is asking for, or taking right now.
const ON_READER = ['starting', 'on_reader', 'capturing'];
type CarRow = { id: string; number: string; stage: Stage; arrivedAt: string; stageAt: Record<string, string>; orderId: string | null; takenBy: string | null; spot: string | null; voice?: CarVoice };
type Split = { ordering: number | null; toWindow: number | null; atWindow: number | null };
type Stats = Split & { inLane: number; inLineNow?: number; average: number | null; target: number; underTarget: number; thisHour: number; servedToday: number; rushAt?: number; recent?: Split & { count: number } };
type Lane = { business: { name: string }; screen: string; cars: CarRow[]; orders: Record<string, Order>; stats: Stats; settings?: { spots: number }; menu: MenuItem[]; now: string };
// Where this screen is (set on the screen itself, kept on the device): it opens on whichever car is at that spot.
type Role = 'all' | 'speaker' | 'pay' | 'pickup' | 'runner';
const ROLES: [Role, string, string][] = [['all', 'Every car', 'Pick any car in the lane'], ['speaker', 'Taking orders', 'The newest car at the speaker'], ['pay', 'Pay window', 'The car at the pay window'], ['pickup', 'Pickup window', 'The car picking up'], ['runner', 'Runner', 'Only the cars parked in a spot']];
const ROLE_STAGE: Record<Exclude<Role, 'all'>, Stage> = { speaker: 'speaker', pay: 'pay', pickup: 'pickup', runner: 'forward' };
const SLOW_WORD: Record<keyof Split, string> = { ordering: 'ordering', toWindow: 'getting to the window', atWindow: 'at the window' };

const keyName = (t: string) => `cf.drivethru.${t}`;
const read = (k: string) => { try { return localStorage.getItem(k); } catch { return null; } };
const write = (k: string, v: string | null) => { try { if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch { /* private window */ } };
const rid = () => { try { return crypto.getRandomValues(new Uint32Array(3)).join('').slice(0, 24); } catch { return `${Date.now()}${Math.random().toString(36).slice(2, 10)}`; } };
const usd = (n: number) => `$${(Math.round(n * 100) / 100).toFixed(2)}`;
const mmss = (s: number) => { const a = Math.max(0, Math.round(s)); return `${Math.floor(a / 60)}:${String(a % 60).padStart(2, '0')}`; };
/** "Sales tax 8.25%": the business's own rate, short enough for a ticket. */
const taxWords = (label: string) => { const m = String(label || '').match(/\d+(?:\.\d+)?%/); return m ? `Sales tax ${m[0]}` : 'Sales tax'; };
const STAGE_WORD: Record<Stage, string> = { speaker: 'Ordering', pay: 'Paying', pickup: 'At the window', forward: 'Parked' };
const btn = `min-h-[44px] px-4 rounded-xl text-[15px] font-semibold disabled:opacity-50 transition-colors ${RING}`;
const quiet = { background: '#fff', border: `1px solid ${LINE}`, color: INK } as const;

/** A car's clock against the lane's target: calm, then amber in the last quarter, then solid amber once it's over. */
function clockLook(seconds: number, target: number) {
  if (seconds > target) return { background: AMBER, color: '#fff' };
  if (seconds > target * 0.75) return { background: AMBER_TINT, color: AMBER };
  return { background: SOFT, color: INK };
}

function chime(ctx: AudioContext, notes: number[]) {
  notes.forEach((freq, i) => {
    const o = ctx.createOscillator(); const g = ctx.createGain(); o.connect(g); g.connect(ctx.destination); o.type = 'sine';
    const at = ctx.currentTime + i * 0.14;
    o.frequency.setValueAtTime(freq, at); g.gain.setValueAtTime(0, at); g.gain.linearRampToValueAtTime(0.35, at + 0.01); g.gain.exponentialRampToValueAtTime(0.001, at + 0.35);
    o.start(at); o.stop(at + 0.4);
  });
}

function KitchenPill({ o }: { o: Order | undefined }) {
  if (!o || o.kitchen === 'not sent') return <span className="rounded-full px-2.5 py-1 text-[13px] font-medium" style={{ background: SOFT, color: MUTED }}>{o?.lines.length ? 'Not sent' : 'No items yet'}</span>;
  if (o.kitchen === 'ready') return <span className="rounded-full px-2.5 py-1 text-[13px] font-semibold" style={{ background: GREEN_TINT, color: GREEN }}>Ready</span>;
  return <span className="whitespace-nowrap rounded-full px-2.5 py-1 text-[13px] font-semibold" style={{ background: SOFT, color: INK }}>{o.ticketCount > 1 && o.readyCount > 0 ? `${o.readyCount} of ${o.ticketCount} ready` : 'Making'}</span>;
}

// ─── A car in the lane ───────────────────────────────────────────────────────────────────────────────────────────────
function CarCard({ c, o, now, target, selected, onAir, onPick }: { c: CarRow; o?: Order; now: number; target: number; selected: boolean; onAir: boolean; onPick: () => void }) {
  const s = (now - Date.parse(c.arrivedAt)) / 1000;
  const items = (o?.lines || []).reduce((n, l) => n + l.quantity, 0);
  return (
    <button type="button" onClick={onPick} aria-pressed={selected} aria-label={`Car ${c.number}${o?.guestName ? `, ${o.guestName}` : ''}, ${STAGE_WORD[c.stage]}${c.spot ? ` in spot ${c.spot}` : ''}, ${mmss(s)} in the lane`}
      className={`w-full rounded-2xl bg-[#fff] p-3.5 text-left transition-shadow ${RING}`}
      style={{ border: `${selected ? 2 : 1}px solid ${selected ? INK : s > target ? AMBER : LINE}`, boxShadow: selected ? '0 6px 18px rgba(22,23,26,0.10)' : 'none', padding: selected ? 13 : 14 }}>
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-baseline gap-2">
          <span className="text-[24px] font-semibold leading-none tracking-tight tabular-nums" style={{ color: INK }}>{c.number}</span>
          {o?.guestName && <span className="min-w-0 truncate text-[15px] font-semibold" style={{ color: INK }}>{o.guestName}</span>}
          <span className="truncate text-[14px] font-medium" style={{ color: onAir ? GREEN : MUTED }}>{STAGE_WORD[c.stage]}{c.spot ? ` ${c.spot}` : ''}{onAir ? ' · you’re on' : c.voice?.status === 'live' ? ' · assistant' : c.voice?.status === 'taken_over' ? ' · team' : ''}</span>
        </div>
        <span className="shrink-0 rounded-full px-2.5 py-1 text-[15px] font-semibold tabular-nums" style={clockLook(s, target)}>{mmss(s)}</span>
      </div>
      <div className="mt-2.5 flex items-center justify-between gap-2">
        <span className="text-[14px] tabular-nums" style={{ color: MUTED }}>{items ? `${items} ${items === 1 ? 'item' : 'items'} · ${usd(o?.total || 0)}` : 'Taking the order'}{o?.paidAt ? ' · paid' : ''}</span>
        <KitchenPill o={o} />
      </div>
    </button>
  );
}

// ─── The guest's first name, if they give one (optional): the board, the kitchen and the window call them by it ─────
function NameField({ value, onSave }: { value: string; onSave: (v: string) => Promise<boolean> }) {
  const [v, setV] = useState(value); const [editing, setEditing] = useState(false); const [pending, setPending] = useState<string | null>(null);
  // What was typed stays on screen until the lane shows it saved (or the save fails, and the old name comes back).
  useEffect(() => { if (pending !== null && value === pending) setPending(null); }, [value, pending]);
  useEffect(() => { if (!editing && pending === null) setV(value); }, [value, editing, pending]);
  const commit = () => {
    setEditing(false); const t = v.replace(/\s+/g, ' ').trim(); if (t === value) return;
    setPending(t);
    // Saved: the lane already shows the name as kept (tidied, if it needed it). Not saved: the old name comes back.
    void onSave(t).then((saved) => { setPending(null); if (!saved) setV(value); });
  };
  return (
    <label className="mx-4 mt-3 flex items-center gap-3 rounded-xl px-3 focus-within:ring-2 focus-within:ring-[#16171a]" style={{ background: SOFT }}>
      <span className="shrink-0 text-[14px] font-medium" style={{ color: MUTED }}>Name</span>
      <input value={v} maxLength={24} onChange={(e) => setV(e.target.value)} onFocus={() => setEditing(true)} onBlur={commit}
        onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') { setV(value); setEditing(false); } }}
        placeholder="First name, if they give one" autoComplete="off" autoCapitalize="words" enterKeyHint="done"
        className="min-h-[44px] min-w-0 flex-1 bg-transparent text-[16px] font-semibold outline-none focus-visible:outline-none focus-visible:shadow-none" style={{ color: INK, boxShadow: 'none', outline: 'none' }} />
    </label>
  );
}

// ─── Choosing an item's choices (a size, a milk, extras) ─────────────────────────────────────────────────────────────
function ChoiceSheet({ item, onAdd, onClose }: { item: MenuItem; onAdd: (picks: Picks, qty: number) => void; onClose: () => void }) {
  const [picks, setPicks] = useState<Picks>(() => defaultPicks(item)); const [qty, setQty] = useState(1);
  const box = useRef<HTMLDivElement>(null); const close = useRef(onClose); close.current = onClose;
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null; box.current?.querySelector<HTMLElement>('input:not([disabled]), button')?.focus();
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') close.current(); }; document.addEventListener('keydown', k);
    return () => { document.removeEventListener('keydown', k); opener?.focus?.(); };
  }, []);
  const priced = priceChoices(item, picks);
  const each = Math.max(0, item.price + (priced.ok ? priced.extra : 0));
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-4" style={{ background: 'rgba(22,23,26,0.45)' }} onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div ref={box} role="dialog" aria-modal="true" aria-labelledby="choice-title" className="flex max-h-[92dvh] w-full flex-col rounded-t-3xl bg-[#fff] sm:max-w-lg sm:rounded-3xl">
        <div className="flex items-start justify-between gap-3 px-6 pt-6">
          <div className="flex min-w-0 items-center gap-4">
            {item.imageUrl && <img src={item.imageUrl} alt="" className="h-[72px] w-[72px] shrink-0 rounded-2xl object-cover" style={{ background: SOFT }} />}
            <div className="min-w-0"><h2 id="choice-title" className="text-[22px] font-semibold" style={{ color: INK }}>{item.name}</h2>{item.words && <p className="mt-1 text-[14.5px]" style={{ color: MUTED }}>{item.words}</p>}</div>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className={`h-11 w-11 shrink-0 rounded-full border text-[20px] ${RING}`} style={{ borderColor: LINE, color: INK }}>×</button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5"><ChoicePicker item={item} picks={picks} onChange={setPicks} /></div>
        {!priced.ok && <p role="status" className="px-6 pb-2 text-[14px]" style={{ color: AMBER }}>{priced.error}</p>}
        <div className="flex items-center gap-3 border-t px-6 py-4" style={{ borderColor: LINE }}>
          <div className="flex shrink-0 items-center rounded-full" style={{ border: `1px solid ${LINE}` }} role="group" aria-label="How many">
            <button type="button" aria-label="One fewer" disabled={qty <= 1} onClick={() => setQty((n) => Math.max(1, n - 1))} className={`inline-flex h-12 w-12 items-center justify-center rounded-full disabled:opacity-30 ${RING}`}><Minus className="h-4 w-4" /></button>
            <span className="w-7 text-center text-[17px] font-semibold tabular-nums" aria-live="polite">{qty}</span>
            <button type="button" aria-label="One more" disabled={qty >= 20} onClick={() => setQty((n) => Math.min(20, n + 1))} className={`inline-flex h-12 w-12 items-center justify-center rounded-full disabled:opacity-30 ${RING}`}><Plus className="h-4 w-4" /></button>
          </div>
          <button type="button" disabled={!priced.ok} onClick={() => onAdd(picks, qty)} className={`${btn} min-h-[52px] flex-1 text-[16px]`} style={{ background: INK, color: '#fff' }}>Add{qty > 1 ? ` ${qty}` : ''}, {usd(each * qty)}</button>
        </div>
      </div>
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
export default function DriveThru() {
  const { tenantId } = useParams() as { tenantId: string };
  const { user } = useFirebase() as any;
  const [key, setKey] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [lane, setLane] = useState<Lane | null>(null);
  const [stopped, setStopped] = useState('');
  const [closed, setClosed] = useState('');
  const [lastOk, setLastOk] = useState(0);
  const [skew, setSkew] = useState(0);
  const [tick, setTick] = useState(() => Date.now());
  const [picked, setPicked] = useState<string | null>(null);
  const [section, setSection] = useState<string | null>(null);
  const [choiceFor, setChoiceFor] = useState<MenuItem | null>(null);
  const [staff, setStaff] = useState<ScreenStaff | null>(null);
  const [pinOpen, setPinOpen] = useState(false);
  const [soundOn, setSoundOn] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ text: string; tone: 'good' | 'warn' } | null>(null);
  const [cash, setCash] = useState<number | null | 'open'>(null);
  const [spotOpen, setSpotOpen] = useState(false);
  const [handAnyway, setHandAnyway] = useState(0);
  const [cardCheck, setCardCheck] = useState(false);
  // The card reader at this screen (kept on the device): one of the business's readers, or 'none' for a card machine of
  // their own. With nothing picked and only one reader, that one.
  const [readers, setReaders] = useState<Reader[] | null>(null);
  const [readerPick, setReaderPickState] = useState<string | null>(null);
  const [voidOpen, setVoidOpen] = useState(false);
  const [voidPin, setVoidPin] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [role, setRoleState] = useState<Role>('all');
  const manualAt = useRef(0);
  useEffect(() => { const r = read(`cf.drivethru.role.${tenantId}`) as Role | null; if (r && ROLES.some(([k]) => k === r)) setRoleState(r); }, [tenantId]);
  useEffect(() => { setReaderPickState(read(`cf.drivethru.reader.${tenantId}`)); }, [tenantId]);
  const setReaderPick = (v: string | null) => { setReaderPickState(v); write(`cf.drivethru.reader.${tenantId}`, v); };
  const setRole = (r: Role) => { setRoleState(r); manualAt.current = 0; write(`cf.drivethru.role.${tenantId}`, r === 'all' ? null : r); setMenuOpen(false); };
  const pickCar = (id: string) => { manualAt.current = Date.now(); setPicked(id); };
  // When someone last started or changed something on the car on screen (cash, a spot, a void...): a minute after, a screen
  // set to a spot goes back to following it, so a step left half done never pins it to one car.
  const midwayAt = useRef(0);
  const [justPaired, setJustPaired] = useState(false);
  const [voiceCfg, setVoiceCfg] = useState<{ on: boolean; publicKey: string | null } | null>(null);
  const audio = useRef<AudioContext | null>(null);
  const acted = useRef(0);
  const inFlight = useRef(false);
  const readyBefore = useRef<Set<string> | null>(null);
  const applied = useRef<Record<string, number>>({});
  const seq = useRef(0);
  // A tap whose answer never came back is sent again with the same key, so it's still one car, or one line.
  const retryKeys = useRef<Record<string, string>>({});
  const keyFor = (sig: string) => (retryKeys.current[sig] = retryKeys.current[sig] || rid());

  useEffect(() => {
    setKey(read(keyName(tenantId)));
    if (read('cf.drivethru.sound') === 'off') setSoundOn(false);
    const sec = read('cf.drivethru.section'); if (sec) setSection(sec);
    try { const s = JSON.parse(sessionStorage.getItem('cf.drivethru.staff') || 'null'); if (s?.name && s?.pass) setStaff(s); } catch { /* */ }
    setReady(true);
  }, [tenantId]);
  useEffect(() => { const i = setInterval(() => setTick(Date.now()), 1000); return () => clearInterval(i); }, []);
  // Whether the voice assistant takes orders here (and the public key for its live transcript).
  useEffect(() => {
    if (!key) return;
    void fetch('/api/counter/voice', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tenantId, key, action: 'config' }) })
      .then((r) => r.json()).then((d) => { if (d.ok) setVoiceCfg({ on: !!d.on, publicKey: d.publicKey || null }); }).catch(() => undefined);
  }, [tenantId, key]);
  useEffect(() => { if (!notice) return; const t = setTimeout(() => setNotice(null), 5000); return () => clearTimeout(t); }, [notice]);
  const now = tick + skew;

  // Sound needs one real tap before a browser (an iPad especially) lets it play.
  const unlock = useCallback(() => {
    try {
      const AC: any = (window as any).AudioContext || (window as any).webkitAudioContext; if (!AC) return;
      if (!audio.current) audio.current = new AC();
      if (audio.current!.state !== 'running') audio.current!.resume().catch(() => undefined);
    } catch { /* no sound here */ }
  }, []);
  useEffect(() => { const evs = ['click', 'touchend', 'keydown']; for (const e of evs) window.addEventListener(e, unlock, { passive: true }); return () => { for (const e of evs) window.removeEventListener(e, unlock); }; }, [unlock]);

  const post = useCallback(async (body: any) => {
    const r = await fetch('/api/counter', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tenantId, key, ...(staff ? { staffPass: staff.pass } : {}), ...body }) });
    const d = await r.json().catch(() => ({}));
    if (r.status === 401) { write(keyName(tenantId), null); setKey(null); setLane(null); setStopped(d.error || 'This screen was stopped. A manager can set it up again.'); }
    // The working person's own pass no longer counts (a one-off manager's PIN for a void is never theirs).
    if (d.staffOk === false && (!body.staffPass || body.staffPass === staff?.pass)) { setStaff(null); try { sessionStorage.removeItem('cf.drivethru.staff'); } catch { /* */ } setNotice({ text: 'Your name is no longer on this screen. Enter your PIN again to put it back.', tone: 'warn' }); }
    return { status: r.status, d };
  }, [tenantId, key, staff]);

  const loadReaders = useCallback(async () => {
    try { const { d } = await post({ action: 'readers' }); if (d.ok) setReaders(d.readers || []); } catch { /* asked again when the menu opens */ }
  }, [post]);
  useEffect(() => { if (key) void loadReaders(); }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (menuOpen && key) void loadReaders(); }, [menuOpen]); // eslint-disable-line react-hooks/exhaustive-deps
  const load = useCallback(async () => {
    if (!key || inFlight.current) return;
    inFlight.current = true; const at = acted.current;
    try {
      const { d } = await post({ action: 'lane' });
      if (at !== acted.current) return;   // a tap happened meanwhile: the next read has it
      if (d.closed) { setClosed(d.error || 'The lane screen is closed for now.'); return; }
      if (!d.ok) return;
      setClosed('');
      const next: Lane = d;
      // A chime when an order turns ready (for the window), never for what was already ready.
      const nowReady = new Set(Object.values(next.orders).filter((o) => o.kitchen === 'ready').map((o) => o.id));
      if (readyBefore.current && soundOn && audio.current?.state === 'running' && [...nowReady].some((id) => !readyBefore.current!.has(id))) chime(audio.current, [988, 1319]);
      readyBefore.current = nowReady;
      setSkew(Date.parse(next.now) - Date.now() || 0);
      setLane(next); setLastOk(Date.now());
    } catch { /* offline: keep what's here and try again */ } finally { inFlight.current = false; }
  }, [key, post, soundOn]);

  useEffect(() => {
    if (!key) return;
    load(); const i = setInterval(load, POLL_MS);
    const vis = () => { if (document.visibilityState === 'visible') load(); };
    document.addEventListener('visibilitychange', vis);
    return () => { clearInterval(i); document.removeEventListener('visibilitychange', vis); };
  }, [key, load]);

  const cars = lane?.cars || [];
  // The car someone at this tablet is talking to at the speaker (after taking over), wherever the screen has moved to.
  const onAirCalls = useOnTheSpeakerHere();
  const onAirCar = cars.find((c) => !!c.voice?.callId && onAirCalls.includes(String(c.voice.callId))) || null;
  const shownCars = role === 'runner' ? cars.filter((c) => c.stage === 'forward') : cars;
  const car = cars.find((c) => c.id === picked) || null;
  const order = car?.orderId ? lane?.orders[car.orderId] : undefined;
  const target = lane?.stats.target || 210;
  // The car on screen left the lane (handed over, or on another tablet): the next one that needs someone takes its place.
  // A screen set to a spot follows the car at that spot (the newest at the speaker; the first in line at a window), unless
  // someone picked a car by hand in the last half minute.
  useEffect(() => {
    if (!lane) return;
    if (role !== 'all') {
      const want = ROLE_STAGE[role]; const atSpot = cars.filter((c) => c.stage === want);
      const next = role === 'speaker' ? atSpot[atSpot.length - 1] : atSpot[0];
      const cur = cars.find((c) => c.id === picked);
      // Never while someone is in the middle of something on this car (cash, a spot, a void, a choice, a check).
      const midway = (cash !== null || spotOpen || voidOpen || cardCheck || handAnyway > 0 || !!choiceFor || voidPin !== null) && Date.now() - midwayAt.current < 60000;
      const byHand = !!cur && (midway || Date.now() - manualAt.current < 30000);
      if (!byHand && next && cur?.stage !== want) { setPicked(next.id); return; }
      if (role === 'runner' && !next && !byHand) { setPicked(null); return; }
      if (cur) return;
    }
    if (picked && cars.some((c) => c.id === picked)) return;
    const next = role === 'runner' ? shownCars[0] : cars.find((c) => c.stage === 'speaker') || cars.find((c) => c.stage === 'pay') || cars[0];
    setPicked(next ? next.id : null);
  }, [lane, role]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { midwayAt.current = Date.now(); }, [cash, spotOpen, voidOpen, cardCheck, handAnyway, choiceFor, voidPin]);
  useEffect(() => { setCash(null); setSpotOpen(false); setHandAnyway(0); setCardCheck(false); setVoidOpen(false); }, [picked, car?.stage]);
  // The Screen menu closes on Escape or a tap anywhere else.
  useEffect(() => {
    if (!menuOpen) return;
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') setMenuOpen(false); };
    const c = (e: MouseEvent) => { if (!(e.target as HTMLElement)?.closest?.('[data-screen-menu]')) setMenuOpen(false); };
    document.addEventListener('keydown', k); document.addEventListener('mousedown', c);
    return () => { document.removeEventListener('keydown', k); document.removeEventListener('mousedown', c); };
  }, [menuOpen]);

  // A change to one order, kept only if it's the newest answer for it (taps can come back out of order).
  const putOrder = (o: any, mySeq: number) => {
    if (!o?.id || (applied.current[o.id] || 0) > mySeq) return;
    applied.current[o.id] = mySeq;
    setLane((l) => (l ? { ...l, orders: { ...l.orders, [o.id]: { ...(l.orders[o.id] || {}), ...o } } } : l));
  };
  const act = async (label: string, body: any, after?: (d: any) => void, sig?: string, onFail?: (d: any) => void) => {
    // Working on a car that isn't at this screen's spot keeps it on screen (the half minute starts again).
    if (role !== 'all' && car && car.stage !== ROLE_STAGE[role]) manualAt.current = Date.now();
    acted.current++; setBusy(label); const mySeq = ++seq.current;
    try {
      const { d } = await post(body);
      if (sig) delete retryKeys.current[sig];   // answered (done or refused): the next tap is a new one
      if (d.ok) { if (d.order) putOrder(d.order, mySeq); after?.(d); } else { onFail?.(d); if (d.error && !d.needsManager) setNotice({ text: d.error, tone: 'warn' }); }
    } catch { setNotice({ text: 'No connection. Try again.', tone: 'warn' }); }
    finally { acted.current++; setBusy(null); load(); }
  };

  // A name is saved on its own, without holding up the screen: tapping Send straight after typing one still sends.
  const saveName = async (orderId: string, name: string): Promise<boolean> => {
    try {
      const { d } = await post({ action: 'name', orderId, name });
      if (!d.ok) { setNotice({ text: d.error || 'The name didn’t save. Try again.', tone: 'warn' }); return false; }
      setLane((l) => (l && l.orders[orderId] ? { ...l, orders: { ...l.orders, [orderId]: { ...l.orders[orderId], guestName: d.name || null } } } : l));
      return true;
    } catch { setNotice({ text: 'No connection. The name didn’t save.', tone: 'warn' }); return false; }
  };

  const newCar = () => act('car', { action: 'car', carKey: keyFor('car') }, (d) => {
    pickCar(d.carId);
    setLane((l) => (l ? { ...l, cars: [...l.cars.filter((c) => c.id !== d.carId), { id: d.carId, number: d.number, stage: 'speaker', arrivedAt: new Date(Date.now() + skew).toISOString(), stageAt: {}, orderId: d.orderId, takenBy: null, spot: null }],
      orders: { ...l.orders, [d.orderId]: l.orders[d.orderId] || { id: d.orderId, number: d.number, status: 'building', lines: [], subtotal: 0, tax: 0, taxLabel: 'Tax', total: 0, paidAt: null, payMethod: null, sentAt: null, dueAt: null, kitchen: 'not sent', waitingOn: [], readyCount: 0, ticketCount: 0 } } } : l));
  }, 'car');
  const add = (m: MenuItem, picks: Picks = {}, quantity = 1) => {
    if (!order) return; const sig = `add|${order.id}|${m.id}|${JSON.stringify(picks)}|${quantity}`;
    void act(`add-${m.id}`, { action: 'add', orderId: order.id, itemId: m.id, choices: picks, quantity, tapKey: keyFor(sig) }, undefined, sig);
  };
  const tapItem = (m: MenuItem) => { if (m.choices.length) setChoiceFor(m); else add(m); };
  const setQty = (l: Line, q: number) => {
    if (!order) return; const sig = `line|${l.lineId}|${q}`;
    void act(`line-${l.lineId}`, q < 1 ? { action: 'remove', orderId: order.id, lineId: l.lineId, tapKey: keyFor(sig) } : { action: 'qty', orderId: order.id, lineId: l.lineId, quantity: q, tapKey: keyFor(sig) }, undefined, sig);
  };
  const send = () => order && act('send', { action: 'send', orderId: order.id }, () => setNotice({ text: `Order ${order.number} is with the kitchen. ${usd(order.total)} at the window.`, tone: 'good' }));
  const cancel = () => order && act('cancel', { action: 'cancel', orderId: order.id }, () => setNotice({ text: `Car ${order.number} left the lane.`, tone: 'good' }));
  // What the server says was paid (and the change it worked out), even when it was paid already on another tablet or
  // the first answer was lost: never a guess here.
  const paid = (method: 'card' | 'cash', tendered?: number) => order && act('paid', { action: 'paid', orderId: order.id, method, ...(tendered !== undefined ? { tendered } : {}) }, (d) => {
    const how = d.payMethod || method;
    setNotice({ text: (d.already ? 'It was paid already. ' : '') + (how === 'cash' ? (d.change > 0 ? `Paid in cash. Give ${usd(d.change)} change.` : 'Paid in cash, no change.') + (d.inDrawer === false ? ' No drawer is open, so it’s kept with the order for the count.' : '') : 'Paid by card.'), tone: 'good' });
  });
  // The card reader at this screen: the one picked here, or the business's only one (lib/counter-card). The total goes to
  // it; the guest taps, inserts or swipes there, and the server says when it's gone through.
  const reader = readerPick === 'none' ? null : (readers || []).find((x) => x.id === readerPick) || (!readerPick && readers?.length === 1 ? readers[0] : null);
  const paidWords = (d: any) => (d.voided ? 'The order was voided, so the card isn’t charged.'
    : d.wrongAmount ? 'That card payment didn’t match the order’s total, so it was let go. Send it again.'
    : d.notKept || (d.already && d.payMethod && d.payMethod !== 'card') ? `It was paid already${d.payMethod === 'cash' ? ' in cash' : ''}, so the card isn’t charged.` : 'Paid by card.');
  const toReader = () => order && reader && act('card', { action: 'card', orderId: order.id, readerId: reader.id }, (d) => { if (d.state === 'paid') setNotice({ text: paidWords(d), tone: 'good' }); });
  const stopReader = () => order && act('cardStop', { action: 'cardStop', orderId: order.id }, (d) => {
    setNotice(d.state === 'paid' ? { text: d.justWent ? 'The card went through just before it was stopped, so it’s paid.' : paidWords(d), tone: 'good' } : { text: 'Stopped. Take it another way.', tone: 'good' });
  });
  const testCard = () => order && act('cardTest', { action: 'cardTest', orderId: order.id });
  const cardOn = !!order && !order.paidAt && ON_READER.includes(String(order.card?.state || ''));
  // While the reader asks for the card, how it's going (every two seconds, on every screen showing this order).
  useEffect(() => {
    const id = order?.id; if (!cardOn || !id) return;
    let live = true; let asking = false;
    const ask = async () => {
      if (asking) return; asking = true;
      try {
        const { d } = await post({ action: 'cardCheck', orderId: id });
        if (!live) return;
        if (d.ok && (d.state === 'paid' || d.voided || d.wrongAmount)) { setNotice({ text: paidWords(d), tone: d.wrongAmount ? 'warn' : 'good' }); load(); }
        else if (d.ok && d.state !== 'on_reader') load();
      } catch { /* asked again */ } finally { asking = false; }
    };
    const i = setInterval(ask, 2000); void ask();
    return () => { live = false; clearInterval(i); };
  }, [cardOn, order?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const move = (to: 'gone' | 'forward', spot?: string) => car && act(`move-${to}`, { action: 'move', carId: car.id, to, ...(spot ? { spot } : {}) }, () => {
    if (to === 'gone') setNotice({ text: `Car ${car.number} is on its way.`, tone: 'good' });
  });
  // "Not all ready" asks for a second tap, and a second tap within a moment (a double tap) doesn't count.
  const handOver = () => { if (order?.kitchen === 'ready' || (handAnyway && Date.now() - handAnyway > 700)) void move('gone'); else if (!handAnyway) setHandAnyway(Date.now()); };
  // Voiding a sent order nobody will pay for: a manager's PIN if whoever is working isn't one.
  const doVoid = (reason: string, pass?: string) => order && act('void', { action: 'void', orderId: order.id, reason, ...(pass ? { staffPass: pass } : {}) }, (d) => {
    setVoidOpen(false); setVoidPin(null);
    setNotice({ text: `Order ${order.number} voided.${d.returned ? ` ${d.returned} not yet made went back on the shelf.` : ''}`, tone: 'good' });
  }, undefined, (d) => { if (d.needsManager) setVoidPin(reason); });

  const checkPin = async (pin: string): Promise<{ ok: true; staff: ScreenStaff } | { ok: false; error: string }> => {
    try {
      const r = await fetch('/api/kitchen', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tenantId, key, action: 'pin', pin }) });
      const d = await r.json().catch(() => ({}));
      return d.ok ? { ok: true, staff: { id: String(d.staff.id), name: String(d.staff.name), pass: String(d.pass) } } : { ok: false, error: d.error || 'That PIN isn’t right.' };
    } catch { return { ok: false, error: 'No connection. Try again.' }; }
  };
  const pickStaff = (s: ScreenStaff | null) => { setStaff(s); try { if (s) sessionStorage.setItem('cf.drivethru.staff', JSON.stringify(s)); else sessionStorage.removeItem('cf.drivethru.staff'); } catch { /* */ } };
  const stopScreen = async () => {
    setMenuOpen(false);
    try { const r = await fetch('/api/kitchen', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tenantId, key, action: 'forget' }) }); if (r.ok || r.status === 401) { write(keyName(tenantId), null); setKey(null); setLane(null); setStopped('This screen was stopped. A manager can set it up again.'); return; } } catch { /* below */ }
    setNotice({ text: 'The screen couldn’t reach the server to stop. Try again.', tone: 'warn' });
  };

  // The menu, by section; members-only things aren't sold at the lane.
  const menu = useMemo(() => (lane?.menu || []).filter((m) => !m.membersOnly), [lane?.menu]);
  const sections = useMemo(() => Array.from(new Set(menu.map((m) => m.section))), [menu]);
  const shownSection = section && sections.includes(section) ? section : sections[0] || null;
  const withPhotos = menu.some((m) => !!m.imageUrl);
  const onOrder = useMemo(() => { const n: Record<string, number> = {}; for (const l of order?.lines || []) n[l.itemId] = (n[l.itemId] || 0) + l.quantity; return n; }, [order?.lines]);

  if (!ready) return <main className="min-h-dvh" style={{ background: SOFT }} />;
  if (!key) return <ScreenSetup tenantId={tenantId} stopped={stopped} onPaired={(k) => { write(keyName(tenantId), k); setKey(k); setStopped(''); setJustPaired(true); }} />;

  const st = lane?.stats;
  // A part that's running slower than usual right now (the last half hour, three cars or more, against today): a quarter
  // slower and 20 seconds more a car at least. Nothing is said when everything is running as usual.
  const slow = (() => {
    const r = st?.recent; if (!st || !r || r.count < 3) return null;
    const parts = (['ordering', 'toWindow', 'atWindow'] as (keyof Split)[]).map((k) => ({ k, now: r[k], day: st[k] }))
      .filter((x): x is { k: keyof Split; now: number; day: number } => x.now !== null && x.day !== null && x.now >= x.day * 1.25 && x.now - x.day >= 20);
    if (!parts.length) return null;
    const top = parts.sort((a, b) => b.now / b.day - a.now / a.day)[0];
    return [top.k, top.now, top.day] as [keyof Split, number, number];
  })();
  const stale = lastOk > 0 && Date.now() - lastOk > 10000;
  const carSeconds = car ? (now - Date.parse(car.arrivedAt)) / 1000 : 0;
  const due = order?.dueAt ? timeLeft(Date.parse(order.dueAt), now) : null;
  const items = (order?.lines || []).reduce((n, l) => n + l.quantity, 0);
  // Cash: the exact amount, and the notes a guest is likely to hand over.
  const tenders = order ? Array.from(new Set([order.total, Math.ceil(order.total), Math.ceil(order.total / 5) * 5, Math.ceil(order.total / 10) * 10, 20, 50, 100].filter((x) => x >= order.total).map((x) => Math.round(x * 100) / 100))).slice(0, 6) : [];

  const ticket = (editable: boolean) => (
    <section aria-label={`Order ${order?.number || ''}`} className="flex min-h-0 flex-col rounded-2xl bg-[#fff]" style={{ border: `1px solid ${LINE}` }}>
      <div className="flex items-center justify-between gap-2 px-4 pt-4">
        <h3 className="text-[17px] font-semibold" style={{ color: INK }}>Order {order?.number}</h3>
        <span className="text-[14px] tabular-nums" style={{ color: MUTED }}>{items} {items === 1 ? 'item' : 'items'}</span>
      </div>
      {editable && order ? <NameField key={order.id} value={order.guestName || ''} onSave={(v) => saveName(order.id, v)} />
        : order?.guestName ? <p className="px-4 pt-1 text-[14px]" style={{ color: MUTED }}>For <b className="font-semibold" style={{ color: INK }}>{order.guestName}</b></p> : null}
      {(order?.lines.length || 0) === 0
        ? <p className="mx-4 my-4 rounded-xl px-4 py-8 text-center text-[15px]" style={{ border: `1px dashed ${LINE}`, color: MUTED }}>Tap an item to start the order.</p>
        : <ul className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
          {order!.lines.map((l) => {
            const waiting = order!.waitingOn.some((w) => w.name === l.name);
            return (
              <li key={l.lineId} className="flex items-center gap-2 rounded-xl px-2 py-2" style={{ opacity: busy === `line-${l.lineId}` ? 0.6 : 1 }}>
                {editable ? (
                  <div className="flex shrink-0 items-center rounded-full" style={{ background: SOFT }}>
                    <button type="button" onClick={() => setQty(l, l.quantity - 1)} aria-label={l.quantity === 1 ? `Take ${l.name} off` : `One fewer ${l.name}`} className={`inline-flex h-11 w-11 items-center justify-center rounded-full ${RING}`}><Minus className="h-4 w-4" style={{ color: l.quantity === 1 ? RED : INK }} /></button>
                    <span className="w-6 text-center text-[16px] font-semibold tabular-nums">{l.quantity}</span>
                    <button type="button" onClick={() => setQty(l, l.quantity + 1)} disabled={l.quantity >= 20} aria-label={`One more ${l.name}`} className={`inline-flex h-11 w-11 items-center justify-center rounded-full disabled:opacity-30 ${RING}`}><Plus className="h-4 w-4" /></button>
                  </div>
                ) : <span className="w-9 shrink-0 text-center text-[16px] font-semibold tabular-nums" style={{ color: INK }}>{l.quantity}×</span>}
                <div className="min-w-0 flex-1">
                  <p className="text-[15.5px] font-semibold leading-snug" style={{ color: INK }}>{l.name}</p>
                  {l.choicesText && <p className="text-[14px] leading-snug" style={{ color: MUTED }}>{l.choicesText}</p>}
                  {!editable && order!.kitchen !== 'not sent' && <p className="text-[13px] font-medium" style={{ color: waiting ? MUTED : GREEN }}>{waiting ? 'Being made' : 'Ready'}</p>}
                </div>
                <span className="shrink-0 text-[15px] tabular-nums" style={{ color: INK }}>{usd(l.unitPrice * l.quantity)}</span>
              </li>
            );
          })}
        </ul>}
      <div className="space-y-1 border-t px-4 py-3 text-[14.5px]" style={{ borderColor: LINE }}>
        <div className="flex justify-between" style={{ color: MUTED }}><span>Subtotal</span><span className="tabular-nums">{usd(order?.subtotal || 0)}</span></div>
        {(order?.tax || 0) > 0 && <div className="flex justify-between" style={{ color: MUTED }}><span>{taxWords(order?.taxLabel || '')}</span><span className="tabular-nums">{usd(order!.tax)}</span></div>}
        <div className="flex items-baseline justify-between pt-1" style={{ color: INK }}><span className="text-[16px] font-semibold">Total</span><span className="text-[24px] font-semibold tabular-nums">{usd(order?.total || 0)}</span></div>
      </div>
      {editable && (order?.lines.length || 0) > 0 && <p className="mx-4 mb-3 rounded-xl px-3 py-2.5 text-[14px] leading-snug" style={{ background: SOFT, color: INK }}><span className="font-semibold">Read it back: </span>{readBack(order!.lines)} That’s {usd(order!.total)}.</p>}
    </section>
  );

  return (
    <div className="flex min-h-dvh flex-col" style={{ background: SOFT, color: INK }}>
      <header className="space-y-3 bg-[#fff] px-4 py-3 sm:px-6" style={{ borderBottom: `1px solid ${LINE}` }}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl" style={{ background: INK, color: '#fff' }}><Car className="h-5 w-5" aria-hidden /></span>
            <div className="min-w-0"><h1 className="truncate text-[20px] font-semibold leading-tight">{lane?.business.name || 'Drive-thru'}</h1>
              <p className="text-[13.5px]" style={{ color: MUTED }}>{lane?.screen || 'Drive-thru'}{role !== 'all' ? ` · ${ROLES.find(([k]) => k === role)?.[1]}` : ''} · {cars.length} {cars.length === 1 ? 'car' : 'cars'} in the lane</p></div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {staff
              ? <span className="inline-flex items-center gap-1 rounded-xl bg-[#fff] pl-3" style={{ border: `1px solid ${LINE}` }}><span className="text-[14px]">Working: <b className="font-semibold">{staff.name.split(' ')[0]}</b></span><button type="button" onClick={() => pickStaff(null)} className={`min-h-[44px] rounded-xl px-3 text-[14px] font-semibold ${RING}`} style={{ color: MUTED }}>Done</button></span>
              : <button type="button" onClick={() => setPinOpen(true)} className={btn} style={quiet}>Who’s working?</button>}
            <button type="button" onClick={() => { const v = !soundOn; setSoundOn(v); write('cf.drivethru.sound', v ? 'on' : 'off'); unlock(); }} aria-pressed={soundOn} aria-label={soundOn ? 'Sound on' : 'Sound off'} className={`${btn} inline-flex items-center gap-2`} style={quiet}>{soundOn ? <Volume2 className="h-4 w-4" aria-hidden /> : <VolumeX className="h-4 w-4" aria-hidden />}<span className="hidden sm:inline">{soundOn ? 'Sound on' : 'Sound off'}</span></button>
            <div className="relative" data-screen-menu>
              <button type="button" onClick={() => setMenuOpen((v) => !v)} className={btn} style={quiet} aria-expanded={menuOpen}>Screen</button>
              {menuOpen && (
                <div className="absolute right-0 z-40 mt-2 max-h-[80dvh] w-72 space-y-1 overflow-y-auto rounded-2xl bg-[#fff] p-2" style={{ border: `1px solid ${LINE}`, boxShadow: '0 8px 24px rgba(0,0,0,0.08)' }}>
                  <a href={`/drive-thru/${tenantId}/board`} target="_blank" rel="noopener" className={`flex min-h-[44px] items-center rounded-xl px-3 text-[14px] font-medium ${RING}`} style={{ color: INK }}>Open the order board</a>
                  <p className="px-3 pb-1 text-[13px]" style={{ color: MUTED }}>The board shows guests their order as it’s taken. Put it on a screen by the speaker.</p>
                  {voiceCfg?.on && <a href={`/drive-thru/${tenantId}/speaker`} target="_blank" rel="noopener" className={`flex min-h-[44px] items-center rounded-xl px-3 text-[14px] font-medium ${RING}`} style={{ color: INK }}>Open the speaker</a>}
                  {voiceCfg?.on && <p className="px-3 pb-1 text-[13px]" style={{ color: MUTED }}>The tablet wired to the speaker, where the voice assistant takes each car’s order.</p>}
                  <a href={`/drive-thru/${tenantId}/window`} target="_blank" rel="noopener" className={`flex min-h-[44px] items-center rounded-xl px-3 text-[14px] font-medium ${RING}`} style={{ color: INK }}>Open the window screen</a>
                  <p className="px-3 pb-1 text-[13px]" style={{ color: MUTED }}>Faces the guest at the window: their order, the total, how paying is going, and where to go next.</p>
                  <div className="my-1 border-t pt-2" style={{ borderColor: LINE }} role="group" aria-labelledby="screen-spot">
                    <p id="screen-spot" className="px-3 pb-1 text-[13px] font-semibold" style={{ color: MUTED }}>This screen is at</p>
                    {ROLES.map(([k, label, hint]) => (
                      <button key={k} type="button" aria-pressed={role === k} onClick={() => setRole(k)} className={`flex min-h-[44px] w-full items-center justify-between gap-3 rounded-xl px-3 text-left ${RING}`} style={{ background: role === k ? SOFT : 'transparent' }}>
                        <span><span className="block text-[14px] font-medium" style={{ color: INK }}>{label}</span><span className="block text-[12.5px]" style={{ color: MUTED }}>{hint}</span></span>
                        <span aria-hidden className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full" style={{ border: `2px solid ${role === k ? INK : LINE}` }}>{role === k && <span className="h-2.5 w-2.5 rounded-full" style={{ background: INK }} />}</span>
                      </button>))}
                  </div>
                  <div className="my-1 border-t pt-2" style={{ borderColor: LINE }} role="group" aria-labelledby="screen-reader">
                    <p id="screen-reader" className="px-3 pb-1 text-[13px] font-semibold" style={{ color: MUTED }}>Card reader here</p>
                    {readers === null ? <p className="px-3 pb-2 text-[13px]" style={{ color: MUTED }}>Looking for your card readers…</p>
                      : readers.length === 0 ? <p className="px-3 pb-2 text-[13px]" style={{ color: MUTED }}>No card reader is set up yet. Add one in Settings, under Card reader, and the total goes to it from this screen.</p>
                      : [...readers.map((x) => ({ id: x.id, label: x.label, hint: x.test ? 'Test reader, no real money' : x.online ? 'Online' : 'Offline right now' })), { id: 'none', label: 'None here', hint: 'Card is taken on a machine of your own' }].map((x) => {
                        const on = x.id === 'none' ? !reader : reader?.id === x.id;
                        return (
                          <button key={x.id} type="button" aria-pressed={on} onClick={() => setReaderPick(x.id)} className={`flex min-h-[44px] w-full items-center justify-between gap-3 rounded-xl px-3 text-left ${RING}`} style={{ background: on ? SOFT : 'transparent' }}>
                            <span className="min-w-0"><span className="block truncate text-[14px] font-medium" style={{ color: INK }}>{x.label}</span><span className="block text-[12.5px]" style={{ color: x.hint === 'Offline right now' ? AMBER : MUTED }}>{x.hint}</span></span>
                            <span aria-hidden className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full" style={{ border: `2px solid ${on ? INK : LINE}` }}>{on && <span className="h-2.5 w-2.5 rounded-full" style={{ background: INK }} />}</span>
                          </button>);
                      })}
                  </div>
                  <button type="button" onClick={stopScreen} className={`min-h-[44px] w-full rounded-xl px-3 text-left text-[14px] font-medium ${RING}`} style={{ color: RED }}>Stop this screen</button>
                </div>
              )}
            </div>
          </div>
        </div>
        {st && (
          <div className="flex flex-wrap items-center gap-x-6 gap-y-1.5 text-[14px]" style={{ color: MUTED }}>
            <span>Average today <b className="rounded-md px-1.5 py-0.5 font-semibold tabular-nums" style={st.average === null ? { color: INK } : st.average > st.target ? { background: AMBER, color: '#fff' } : st.average > st.target * 0.75 ? { background: AMBER_TINT, color: AMBER } : { background: GREEN_TINT, color: GREEN }}>{st.average === null ? 'none yet' : mmss(st.average)}</b> <span className="text-[13px]">target {mmss(st.target)}</span></span>
            <span>Under target <b className="font-semibold tabular-nums" style={{ color: INK }}>{st.servedToday ? `${Math.round((st.underTarget / st.servedToday) * 100)}%` : 'none yet'}</b></span>
            <span>Served <b className="font-semibold tabular-nums" style={{ color: INK }}>{st.servedToday}</b></span>
            <span>Last hour <b className="font-semibold tabular-nums" style={{ color: INK }}>{st.thisHour}</b></span>
            {slow && <span className="rounded-md px-2 py-0.5 text-[13.5px] font-semibold" style={{ background: AMBER_TINT, color: AMBER }}>Slower right now: {SLOW_WORD[slow[0]]}, {mmss(slow[1])} a car ({mmss(slow[2])} today)</span>}
            {st.average !== null && <span className="text-[13.5px]">Ordering {st.ordering === null ? '–' : mmss(st.ordering)} · to the window {st.toWindow === null ? '–' : mmss(st.toWindow)} · at the window {st.atWindow === null ? '–' : mmss(st.atWindow)}</span>}
          </div>
        )}
      </header>

      <div className="space-y-2 px-4 pt-3 sm:px-6">
        {closed && <div className="rounded-2xl px-4 py-3 text-[15px]" style={{ background: AMBER_TINT, color: AMBER }}>{closed}</div>}
        {st && (st.inLineNow ?? st.inLane) >= (st.rushAt || 6) && !closed && (
          <div className="rounded-2xl px-4 py-3 text-[15px]" style={{ background: AMBER_TINT, color: AMBER }} role="status">
            <b className="font-semibold">Busy: {st.inLineNow ?? st.inLane} cars in the lane.</b> {voiceCfg?.on ? 'The assistant is keeping orders short. ' : ''}Pull a car forward as soon as its food is slow, so the window keeps moving.
          </div>
        )}
        {stale && !closed && <div className="rounded-2xl px-4 py-3 text-[15px]" style={{ background: AMBER_TINT, color: AMBER }}>The screen can’t reach the server. What’s here may be out of date; it keeps trying.</div>}
        {justPaired && (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl px-4 py-3 text-[15px]" style={{ background: GREEN_TINT, color: GREEN }}>
            <span>This screen is set up and keeps working on its own.{user ? ' You can sign out of your account on this tablet now.' : ''}</span>
            <span className="flex gap-2">{user && <button type="button" onClick={() => { signOut(getAuth()).catch(() => {}); setJustPaired(false); }} className={btn} style={quiet}>Sign out</button>}<button type="button" onClick={() => setJustPaired(false)} className={btn} style={quiet}>Close</button></span>
          </div>
        )}
      </div>

      <main className="grid flex-1 grid-cols-1 gap-4 px-4 py-4 sm:px-6 lg:grid-cols-[300px_minmax(0,1fr)]">
        <aside aria-label="The lane" className="space-y-3">
          <button type="button" onClick={newCar} disabled={busy === 'car'} className={`${btn} flex min-h-[64px] w-full items-center justify-center gap-2 text-[17px]`} style={{ background: INK, color: '#fff' }}>
            <Plus className="h-5 w-5" aria-hidden />New car at the speaker
          </button>
          {!lane ? <div className="flex justify-center py-10"><div className="h-7 w-7 animate-spin rounded-full border-[3px]" style={{ borderColor: LINE, borderTopColor: INK }} role="status" aria-label="Loading the lane" /></div>
            : shownCars.length === 0 ? <p className="rounded-2xl px-4 py-10 text-center text-[15px]" style={{ border: `1px dashed ${LINE}`, color: MUTED }}>{role === 'runner' && cars.length ? 'No cars parked in a spot.' : 'No cars in the lane.'}</p>
            : <div className="flex gap-3 overflow-x-auto pb-1 lg:flex-col lg:overflow-visible">{shownCars.map((c) => <div key={c.id} className="w-[260px] shrink-0 lg:w-auto"><CarCard c={c} o={c.orderId ? lane.orders[c.orderId] : undefined} now={now} target={target} selected={c.id === picked} onAir={c.id === onAirCar?.id} onPick={() => pickCar(c.id)} /></div>)}</div>}
        </aside>

        <section aria-label={car ? `Car ${car.number}` : 'No car picked'} className="min-w-0">
          {!car || !order ? (
            <div className="flex h-full min-h-[320px] flex-col items-center justify-center gap-3 rounded-3xl bg-[#fff] p-8 text-center" style={{ border: `1px solid ${LINE}` }}>
              <span className="flex h-14 w-14 items-center justify-center rounded-2xl" style={{ background: SOFT }}><Car className="h-7 w-7" style={{ color: MUTED }} aria-hidden /></span>
              <p className="text-[18px] font-semibold">The lane is clear</p>
              <p className="max-w-sm text-[15px]" style={{ color: MUTED }}>When a car pulls up to the speaker, tap “New car at the speaker” and take the order.</p>
            </div>
          ) : (
            <div className="space-y-4">
              {onAirCar && onAirCar.id !== car.id && (
                <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl px-4 py-2.5" style={{ background: GREEN_TINT, border: '1px solid #cfe8da' }}>
                  <p className="flex items-center gap-2 text-[15px] font-semibold" style={{ color: GREEN }}><Mic className="h-4 w-4" aria-hidden />You’re still on the speaker with car {onAirCar.number}</p>
                  <button type="button" onClick={() => pickCar(onAirCar.id)} className={btn} style={{ background: GREEN, color: '#fff' }}>Back to car {onAirCar.number}</button>
                </div>
              )}
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-[#fff] px-4 py-3" style={{ border: `1px solid ${LINE}` }}>
                <div className="flex min-w-0 items-center gap-3">
                  <span className="text-[30px] font-semibold leading-none tracking-tight tabular-nums">{car.number}</span>
                  <div className="min-w-0"><p className="text-[16px] font-semibold">{order.guestName ? `${order.guestName} · ` : ''}{STAGE_WORD[car.stage]}{car.spot ? `, spot ${car.spot}` : ''}</p>
                    <p className="text-[13.5px]" style={{ color: MUTED }}>In the lane {mmss(carSeconds)}{car.voice?.status === 'live' ? ' · the voice assistant is taking it' : car.voice?.status === 'taken_over' ? ` · taken over by ${String(car.voice.takenOverBy || 'the team').split(' ')[0]}` : car.takenBy ? ` · taken by ${car.takenBy.split(' ')[0]}` : ''}</p></div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {due && order.kitchen !== 'ready' && <span className="rounded-full px-3 py-1.5 text-[14px] font-semibold tabular-nums" style={due.over ? { background: AMBER, color: '#fff' } : due.left < 60 ? { background: AMBER_TINT, color: AMBER } : { background: SOFT, color: INK }} aria-label={`Kitchen time: ${due.text}`}>Kitchen {due.text}</span>}
                  <KitchenPill o={order} />
                  <span className="rounded-full px-3 py-1.5 text-[14px] font-semibold tabular-nums" style={clockLook(carSeconds, target)}>{mmss(carSeconds)}</span>
                </div>
              </div>
              {voiceCfg?.on && car.voice && <VoiceBar tenantId={tenantId} screenKey={key} staffPass={staff?.pass || null} carNumber={car.number} voice={car.voice} publicKey={voiceCfg.publicKey} onNotice={(text, tone) => setNotice({ text, tone })} />}

              {car.stage === 'speaker' && order.status === 'building' ? (
                <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
                  <div className="min-w-0 space-y-3">
                    {sections.length > 1 && (
                      <div className="flex gap-2 overflow-x-auto pb-1" role="tablist" aria-label="Menu sections">
                        {sections.map((s) => <button key={s} type="button" role="tab" aria-selected={s === shownSection} onClick={() => { setSection(s); write('cf.drivethru.section', s); }}
                          className={`min-h-[48px] shrink-0 rounded-full px-5 text-[15px] font-semibold ${RING}`} style={s === shownSection ? { background: INK, color: '#fff' } : { background: '#fff', color: INK, border: `1px solid ${LINE}` }}>{s}</button>)}
                      </div>
                    )}
                    {menu.length === 0 ? <p className="rounded-2xl bg-[#fff] px-4 py-10 text-center text-[15px]" style={{ border: `1px dashed ${LINE}`, color: MUTED }}>Nothing is on the menu yet. A manager can add items on the Menu page.</p>
                      : <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 2xl:grid-cols-4" role="tabpanel">
                        {menu.filter((m) => m.section === shownSection).map((m) => {
                          // Switched to sold out, an ingredient run out, or none left of it (lib/menu-stock), said as such.
                          const why = outWords(m); const out = !!why; const n = onOrder[m.id] || 0;
                          const label = `${m.name}, ${m.from ? 'from ' : ''}${usd(m.from ? m.startPrice : m.price)}${why ? `, ${why.toLowerCase()}` : ''}${n ? `, ${n} on the order` : ''}`;
                          // With photos on the menu, every button is a picture first (the way a fast-food screen is read at a
                          // glance); an item without one keeps its place with its first letter. With none, the buttons stay compact.
                          if (withPhotos) return (
                            <button key={m.id} type="button" disabled={out || busy === `add-${m.id}`} onClick={() => tapItem(m)} aria-label={label}
                              className={`relative flex flex-col overflow-hidden rounded-2xl bg-[#fff] text-left transition-transform active:scale-[0.98] disabled:active:scale-100 ${RING}`}
                              style={{ border: `${n ? 2 : 1}px solid ${n ? INK : LINE}`, padding: n ? 5 : 6 }}>
                              <span className="relative block aspect-[16/10] w-full overflow-hidden rounded-xl" style={{ background: SOFT }}>
                                {m.imageUrl
                                  ? <img src={m.imageUrl} alt="" draggable={false} className="h-full w-full object-cover" style={out ? { filter: 'grayscale(1)', opacity: 0.45 } : undefined} />
                                  : <span className="flex h-full w-full items-center justify-center text-[30px] font-semibold" style={{ color: '#c4c6ca' }} aria-hidden>{m.name.trim().charAt(0).toUpperCase()}</span>}
                                {why && <span className="absolute left-2 top-2 max-w-[calc(100%-16px)] truncate rounded-full px-2.5 py-1 text-[12.5px] font-semibold" style={{ background: AMBER_TINT, color: AMBER }}>{why}</span>}
                                {n > 0 && <span className="absolute right-2 top-2 flex h-8 min-w-[32px] items-center justify-center rounded-full px-2 text-[15px] font-semibold tabular-nums" style={{ background: INK, color: '#fff', boxShadow: '0 0 0 2px #fff' }}>{n}</span>}
                              </span>
                              <span className="flex flex-1 flex-col justify-between gap-1 px-2 pb-1.5 pt-2.5">
                                <span className="text-[15.5px] font-semibold leading-snug" style={{ color: out ? MUTED : INK, textDecoration: out ? 'line-through' : undefined }}>{m.name}</span>
                                <span className="flex items-center justify-between gap-2">
                                  <span className="text-[14.5px] tabular-nums" style={{ color: MUTED }}>{m.from ? 'from ' : ''}{usd(m.from ? m.startPrice : m.price)}</span>
                                  {!out && m.choices.length > 0 && <span className="text-[12.5px] font-medium" style={{ color: MUTED }}>Choices</span>}
                                </span>
                              </span>
                            </button>
                          );
                          return (
                            <button key={m.id} type="button" disabled={out || busy === `add-${m.id}`} onClick={() => tapItem(m)} aria-label={label}
                              className={`relative flex min-h-[96px] flex-col justify-between rounded-2xl p-3.5 text-left transition-transform active:scale-[0.98] disabled:active:scale-100 ${RING}`}
                              style={{ background: out ? SOFT : '#fff', border: `${n ? 2 : 1}px solid ${n ? INK : LINE}`, padding: n ? 13 : 14 }}>
                              <span className="pr-7 text-[16px] font-semibold leading-snug" style={{ color: out ? MUTED : INK, textDecoration: out ? 'line-through' : undefined }}>{m.name}</span>
                              <span className="mt-2 flex items-center justify-between gap-2">
                                <span className="text-[14.5px] tabular-nums" style={{ color: MUTED }}>{m.from ? 'from ' : ''}{usd(m.from ? m.startPrice : m.price)}</span>
                                {why ? <span className="min-w-0 truncate rounded-full px-2 py-0.5 text-[12.5px] font-semibold" style={{ background: AMBER_TINT, color: AMBER }}>{why}</span>
                                  : m.choices.length > 0 && <span className="text-[12.5px] font-medium" style={{ color: MUTED }}>Choices</span>}
                              </span>
                              {n > 0 && <span className="absolute right-2.5 top-2.5 flex h-7 min-w-[28px] items-center justify-center rounded-full px-1.5 text-[14px] font-semibold tabular-nums" style={{ background: INK, color: '#fff' }}>{n}</span>}
                            </button>
                          );
                        })}
                      </div>}
                  </div>
                  <div className="flex flex-col gap-3 xl:sticky xl:top-4 xl:self-start">
                    {ticket(true)}
                    <button type="button" onClick={send} disabled={!order.lines.length || busy !== null} className={`${btn} min-h-[60px] text-[17px]`} style={{ background: GREEN, color: '#fff' }}>{busy === 'send' ? 'Sending…' : `Send to the kitchen${order.lines.length ? `, ${usd(order.total)}` : ''}`}</button>
                    <button type="button" onClick={cancel} disabled={busy === 'cancel'} className={btn} style={{ ...quiet, color: RED }}>The car left without ordering</button>
                  </div>
                </div>
              ) : (
                <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
                  <div className="min-w-0 space-y-4 rounded-3xl bg-[#fff] p-5 sm:p-6" style={{ border: `1px solid ${LINE}` }}>
                    {!order.paidAt ? (
                      <>
                        <div><p className="text-[15px] font-medium" style={{ color: MUTED }}>To pay</p><p className="text-[44px] font-semibold leading-tight tracking-tight tabular-nums">{usd(order.total)}</p></div>
                        {voidOpen ? (
                          <div className="space-y-3">
                            <p className="text-[15px] font-semibold">Why won’t this order be paid?</p>
                            <p className="text-[13.5px]" style={{ color: MUTED }}>The kitchen stops on it, and anything not started yet goes back on the shelf. A manager’s PIN is needed.</p>
                            <div className="grid gap-2 sm:grid-cols-3">
                              {['Drove off without paying', 'Couldn’t pay', 'Ordered by mistake'].map((r) => <button key={r} type="button" disabled={busy === 'void'} onClick={() => doVoid(r)} className={`${btn} min-h-[56px]`} style={{ ...quiet, color: RED }}>{r}</button>)}
                            </div>
                            <button type="button" onClick={() => setVoidOpen(false)} className={btn} style={quiet}>Back</button>
                          </div>
                        ) : cardOn || busy === 'card' ? (
                          <div className="space-y-3" role="status" aria-live="polite">
                            <div className="flex items-center gap-4 rounded-2xl px-4 py-4" style={{ background: SOFT }}>
                              <span aria-hidden className="relative flex h-12 w-12 shrink-0 items-center justify-center rounded-full" style={{ background: INK }}>
                                <span className="absolute inset-0 rounded-full motion-safe:animate-ping" style={{ background: INK, opacity: 0.18 }} />
                                <CreditCard className="relative h-6 w-6" color="#fff" />
                              </span>
                              <div className="min-w-0">
                                <p className="text-[18px] font-semibold">{cardOn ? 'On the reader' : 'Sending to the reader…'}</p>
                                <p className="text-[14px]" style={{ color: MUTED }}>Ask them to tap, insert or swipe their card{reader ? ` on ${reader.label}` : ''}. It’s marked paid by itself once it goes through.</p>
                              </div>
                            </div>
                            <div className="grid gap-2 sm:grid-cols-2">
                              {cardOn && readers?.find((x) => x.id === order.card?.readerId)?.test && <button type="button" onClick={testCard} disabled={busy !== null} className={`${btn} min-h-[56px]`} style={quiet}>Use a test card</button>}
                              <button type="button" onClick={stopReader} disabled={!cardOn || busy === 'cardStop'} className={`${btn} min-h-[56px]`} style={quiet}>{busy === 'cardStop' ? 'Stopping…' : 'Stop, and take it another way'}</button>
                            </div>
                          </div>
                        ) : cardCheck ? (
                          <div className="space-y-3">
                            <p className="text-[16px] font-semibold">Paid {usd(order.total)} by card on the machine?</p>
                            <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
                              <button type="button" onClick={() => paid('card')} disabled={busy === 'paid'} className={`${btn} min-h-[64px] text-[17px]`} style={{ background: GREEN, color: '#fff' }}>Yes, it went through</button>
                              <button type="button" onClick={() => setCardCheck(false)} className={btn} style={quiet}>Back</button>
                            </div>
                          </div>
                        ) : cash === null ? (
                          <div className="grid gap-3 sm:grid-cols-2">
                            {order.card?.state === 'declined' && <p role="status" className="rounded-2xl px-4 py-3 text-[15px] font-medium sm:col-span-2" style={{ background: AMBER_TINT, color: AMBER }}>{order.card.failed || 'The card didn’t go through.'} Try the card again, or take it another way.</p>}
                            <button type="button" onClick={() => (reader ? toReader() : setCardCheck(true))} className={`${btn} min-h-[72px] text-[18px]`} style={{ background: INK, color: '#fff' }}>{reader && order.card?.state === 'declined' ? 'Card again' : 'Card'}</button>
                            <button type="button" onClick={() => setCash('open')} className={`${btn} min-h-[72px] text-[18px]`} style={quiet}>Cash</button>
                            <p className="text-[13.5px] sm:col-span-2" style={{ color: MUTED }}>{reader ? `Card sends ${usd(order.total)} to ${reader.label}${reader.online ? '' : ', which looks offline right now'}.` : 'Card is taken on your card machine; this records it.'}</p>
                            <div className="flex flex-wrap gap-x-5 sm:col-span-2">
                              {reader && <button type="button" onClick={() => setCardCheck(true)} className={`min-h-[44px] rounded-lg text-[14px] font-medium underline underline-offset-4 ${RING}`} style={{ color: MUTED }}>Card on another machine</button>}
                              <button type="button" onClick={() => setVoidOpen(true)} className={`min-h-[44px] rounded-lg text-[14px] font-medium underline underline-offset-4 ${RING}`} style={{ color: MUTED }}>They drove off, or won’t pay</button>
                            </div>
                          </div>
                        ) : (
                          <div className="space-y-3">
                            <p className="text-[15px] font-semibold">What did they hand over?</p>
                            <div className="grid grid-cols-3 gap-2">
                              {tenders.map((t) => <button key={t} type="button" aria-pressed={cash === t} onClick={() => setCash(t)} className={`${btn} min-h-[56px] text-[17px] tabular-nums`} style={cash === t ? { background: INK, color: '#fff' } : quiet}>{t === order.total ? 'Exact' : usd(t)}</button>)}
                            </div>
                            {typeof cash === 'number' && (
                              <div className="flex items-center justify-between rounded-2xl px-4 py-3" style={{ background: GREEN_TINT, color: GREEN }}><span className="text-[16px] font-semibold">Change</span><span className="text-[30px] font-semibold tabular-nums">{usd(cash - order.total)}</span></div>
                            )}
                            <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
                              <button type="button" disabled={typeof cash !== 'number' || busy === 'paid'} onClick={() => typeof cash === 'number' && paid('cash', cash)} className={`${btn} min-h-[56px] text-[16px]`} style={{ background: GREEN, color: '#fff' }}>{typeof cash === 'number' ? (cash > order.total ? `Paid, give ${usd(cash - order.total)} change` : 'Paid, no change') : 'Pick what they handed over'}</button>
                              <button type="button" onClick={() => setCash(null)} className={btn} style={quiet}>Back</button>
                            </div>
                          </div>
                        )}
                      </>
                    ) : (
                      <>
                        <div className="flex flex-wrap items-baseline justify-between gap-2">
                          <div><p className="text-[15px] font-medium" style={{ color: MUTED }}>Paid {order.payMethod === 'cash' ? 'in cash' : 'by card'}</p><p className="text-[32px] font-semibold tracking-tight tabular-nums">{usd(order.total)}</p></div>
                          {order.kitchen === 'ready' ? <span className="rounded-full px-4 py-2 text-[16px] font-semibold" style={{ background: GREEN_TINT, color: GREEN }}>Everything is ready</span>
                            : <span className="rounded-full px-4 py-2 text-[16px] font-semibold" style={{ background: SOFT, color: INK }}>{order.waitingOn.length} still being made</span>}
                        </div>
                        {car.stage !== 'forward' && !spotOpen && (
                          <div className="grid gap-3 sm:grid-cols-2">
                            <button type="button" disabled={busy === 'move-gone'} onClick={handOver} className={`${btn} min-h-[72px] text-[18px]`} style={{ background: order.kitchen === 'ready' ? GREEN : INK, color: '#fff' }}>{handAnyway && order.kitchen !== 'ready' ? 'Not all ready. Tap again to hand over' : 'Handed over'}</button>
                            <button type="button" onClick={() => setSpotOpen(true)} className={`${btn} min-h-[72px] text-[18px]`} style={quiet}>Pull forward</button>
                            <p className="text-[13.5px] sm:col-span-2" style={{ color: MUTED }}>Waiting on something slow? Pull the car forward to a spot so the cars behind keep moving, and bring it out when it’s ready.</p>
                          </div>
                        )}
                        {car.stage !== 'forward' && spotOpen && (
                          <div className="space-y-3">
                            <p className="text-[15px] font-semibold">Which spot?</p>
                            <div className="grid grid-cols-4 gap-2">{Array.from({ length: lane?.settings?.spots || 4 }, (_, i) => String(i + 1)).map((s) => {
                              const there = cars.find((c) => c.stage === 'forward' && c.spot === s && Date.parse(c.arrivedAt) >= Date.now() - 3 * 3600000);
                              return <button key={s} type="button" disabled={busy === 'move-forward'} aria-disabled={!!there} onClick={() => { if (!there) move('forward', s); }} aria-label={there ? `Spot ${s}, car ${there.number} is there` : `Spot ${s}`}
                                className={`${btn} flex min-h-[64px] flex-col items-center justify-center text-[22px] leading-none tabular-nums`} style={there ? { background: SOFT, color: MUTED, border: `1px solid ${LINE}`, opacity: 1 } : quiet}>{s}{there && <span className="mt-1 text-[12px] font-medium">{there.number}</span>}</button>;
                            })}</div>
                            <button type="button" onClick={() => setSpotOpen(false)} className={btn} style={quiet}>Back</button>
                          </div>
                        )}
                        {car.stage === 'forward' && (
                          <div className="space-y-3">
                            <p className="rounded-2xl px-4 py-3 text-[16px]" style={{ background: SOFT }}>Parked{car.spot ? ` in spot ${car.spot}` : ''}. Bring it out when it’s ready.</p>
                            <button type="button" disabled={busy === 'move-gone'} onClick={handOver} className={`${btn} min-h-[72px] w-full text-[18px]`} style={{ background: order.kitchen === 'ready' ? GREEN : INK, color: '#fff' }}>{handAnyway && order.kitchen !== 'ready' ? 'Not all ready. Tap again to hand over' : 'Brought out and handed over'}</button>
                          </div>
                        )}
                      </>
                    )}
                  </div>
                  <div className="xl:sticky xl:top-4 xl:self-start">{ticket(false)}</div>
                </div>
              )}
            </div>
          )}
        </section>
      </main>

      {notice && <div role="status" className="fixed bottom-4 left-1/2 z-40 w-max max-w-[min(560px,calc(100vw-32px))] -translate-x-1/2 rounded-2xl px-5 py-3 text-[15px] font-medium" style={{ background: notice.tone === 'good' ? INK : AMBER, color: '#fff', boxShadow: '0 8px 24px rgba(0,0,0,0.18)' }}>{notice.text}</div>}
      {choiceFor && <ChoiceSheet item={choiceFor} onClose={() => setChoiceFor(null)} onAdd={(p, q) => { add(choiceFor, p, q); setChoiceFor(null); }} />}
      {voidPin !== null && <PinPad check={checkPin} onDone={(s) => { const reason = voidPin; setVoidPin(null); void doVoid(reason, s.pass); }} onClose={() => setVoidPin(null)} line="A manager’s PIN is needed to void an order. It doesn’t change who’s working here." />}
      {pinOpen && <PinPad check={checkPin} onDone={(s) => { pickStaff(s); setPinOpen(false); }} onClose={() => setPinOpen(false)} line="Your PIN puts your name on the orders and payments you take. The screen works without it." />}
    </div>
  );
}

